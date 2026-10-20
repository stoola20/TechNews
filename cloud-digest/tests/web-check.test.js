import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { setTextProvider } from '../src/learning/local.js';
import { query, rows, setSetting } from '../src/learning/store.js';
import { runOnce, loadConfig } from '../runner/lib.js';
import { environment, recorder, request } from './helpers.js';

const A = 'a'.repeat(32);
const payload = (body) => JSON.parse(body.contents[0].parts[0].text.split('\n\n').at(-1));
const gemini = (data, grounding = null, text = JSON.stringify(data)) =>
  Response.json({
    candidates: [
      { finishReason: 'STOP', content: { parts: [{ text }] }, ...(grounding ? { groundingMetadata: grounding } : {}) },
    ],
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120, thoughtsTokenCount: 0 },
  });
const GROUNDING = {
  webSearchQueries: ['cache invalidation write-through', 'CDN purge latency'],
  groundingChunks: [
    { web: { uri: 'https://docs.example.org/cache', title: '快取文件' } },
    { web: { uri: 'http://insecure.example.org', title: '不安全' } },
  ],
};
// 假 Gemini：第 1 題答案提到 CDN，第一輪標記 needs_web；網路查證依 web 參數回應。
function setup({
  web = () => gemini({ verdict: 'correct', feedback: '查到官方文件，你說得對。' }, GROUNDING),
  extra = {},
  onGrade,
} = {}) {
  const calls = { grade: [], web: [] };
  const env = { ...environment(extra), LEARNING_RUNNER_TOKEN: 'runner-test-token' };
  const net = recorder(async (url, options) => {
    if (url.hostname !== 'generativelanguage.googleapis.com') return null;
    const body = JSON.parse(options.body),
      system = body.systemInstruction.parts[0].text;
    if (system.includes('查證技術說法')) {
      calls.web.push(body);
      return web(body);
    }
    const data = payload(body);
    if (system.includes('出題老師'))
      return gemini({
        questions: [1, 2, 3].map((n) => ({
          type: 'article',
          question: `第 ${n} 題：寫入時為什麼要讓快取失效？${n}`,
          reference: '避免讀到舊資料。',
          citations: [data.chunks[0].ref],
        })),
      });
    calls.grade.push(data);
    await onGrade?.(env);
    return gemini({
      results: data.questions.map((q) => ({
        number: q.number,
        verdict: 'partial',
        feedback: '第一輪：本篇沒有提到 CDN。',
        citations: [data.chunks[0].ref],
        needs_web: q.answer.includes('CDN'),
        claim: q.answer.includes('CDN') ? 'CDN 清除快取通常需要幾分鐘' : '',
      })),
    });
  });
  const handler = createLearningHandler({ ...net, now: () => Date.parse('2026-10-01T00:00:00Z') });
  return { env, handler, calls, net };
}
async function quizFor(s) {
  await query(
    s.env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,created_at,updated_at) VALUES(?,'https://example.org/a','web','快取','ready',?,'{}',1,'kept','2026-10-01','2026-10-01')",
    A,
    '## 快取\n\n' + '寫入資料時讓快取失效，避免讀到舊資料。'.repeat(10),
  ).run();
  return (await (await s.handler.fetch(request('api/items/' + A + '/quizzes', 'POST', {}), s.env)).json()).id;
}
const answer = async (s, quizId) =>
  (
    await s.handler.fetch(
      request('api/quizzes/' + quizId + '/attempts', 'POST', {
        answers: [
          { number: 1, answer: 'CDN 清除快取通常需要幾分鐘' },
          { number: 2, answer: '避免舊資料' },
        ],
      }),
      s.env,
    )
  ).json();
const searchCosts = (s) =>
  rows(
    s.env,
    "SELECT amount_micro,status,usage_json FROM learning_costs WHERE category='gemini-search' ORDER BY created_at,rowid",
  );

test('needs_web 的題目用 Gemini Google 搜尋查證：更新判定與回饋，網路出處取自 grounding metadata；搜尋在免費額度內記 $0', async () => {
  const s = setup();
  const result = await answer(s, await quizFor(s));
  assert.equal(result.status, 'done');
  assert.equal(result.web_check, 'done');
  const sent = s.calls.web[0];
  assert.deepEqual(sent.tools, [{ google_search: {} }]);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  const asked = JSON.parse(sent.contents[0].parts[0].text);
  assert.equal(asked.claim, 'CDN 清除快取通常需要幾分鐘');
  assert.equal(asked.first_round.verdict, 'partial');
  assert.equal(s.calls.web.length, 1, '只查證標記 needs_web 的題目');
  const [one, two] = result.results;
  assert.deepEqual([one.verdict, one.feedback, one.web_checked], ['correct', '查到官方文件，你說得對。', true]);
  assert.deepEqual(one.sources.web, [{ url: 'https://docs.example.org/cache', title: '快取文件' }]);
  assert.deepEqual([two.verdict, two.sources.web], ['partial', []]);
  assert.deepEqual(result.summary, { total: 3, correct: 1, partial: 1, incorrect: 1 });
  const costs = await searchCosts(s);
  assert.deepEqual(
    costs.map((c) => [c.amount_micro, c.status, JSON.parse(c.usage_json).queries]),
    [[0, 'settled', 2]],
  );
  // 查證的文字 token 記在 gemini 類別。
  assert.equal((await rows(s.env, "SELECT id FROM learning_costs WHERE category='gemini'")).length, 3);
});

test('超過每月免費額度後依實際查詢次數計費', async () => {
  const s = setup({ extra: { LEARNING_SEARCH_FREE_PER_MONTH: '3', LEARNING_SEARCH_USD_PER_1K: '14' } });
  const quiz = await quizFor(s);
  await answer(s, quiz);
  await answer(s, quiz);
  const costs = await searchCosts(s);
  // 第一次 2 次都在額度內；第二次 2 次中有 1 次超過：US$0.014。
  assert.deepEqual(
    costs.map((c) => c.amount_micro),
    [0, 14000],
  );
  const summary = await (await s.handler.fetch(request('api/admin/web-check'), s.env)).json();
  assert.deepEqual(
    [summary.enabled, summary.queries, summary.amount_micro, summary.free_per_month],
    [true, 4, 14000, 3],
  );
});

test('管理頁關閉網路查證或沒有金鑰時不查；查證失敗保留第一輪結果並註明；費用暫停時不查證', async () => {
  const s = setup();
  const quiz = await quizFor(s);
  await s.handler.fetch(request('api/admin/web-check', 'PUT', { enabled: false }), s.env);
  let r = await answer(s, quiz);
  assert.deepEqual([r.status, r.web_check, r.web_note, s.calls.web.length], ['done', 'disabled', '網路查證已關閉', 0]);
  assert.equal(r.results[0].verdict, 'partial');
  await s.handler.fetch(request('api/admin/web-check', 'PUT', { enabled: true }), s.env);
  // 輸出不是完整 JSON（社群回報的截斷情形）：保留第一輪，搜尋次數仍依 grounding metadata 記帳。
  const broken = setup({ web: () => gemini(null, GROUNDING, '{"verdict":"corr') });
  r = await answer(broken, await quizFor(broken));
  assert.deepEqual(
    [r.web_check, r.results[0].verdict, r.results[0].feedback],
    ['failed', 'partial', '第一輪：本篇沒有提到 CDN。'],
  );
  assert.match(r.web_note, /不是有效的 JSON/);
  assert.equal(JSON.parse((await searchCosts(broken))[0].usage_json).queries, 2);
  // 第一輪批改完成後才遇到費用暫停：不上網查證並註明原因。
  const paused = setup({ onGrade: (env) => setSetting(env, 'control', { paused: true, reason: 'budget' }) });
  r = await answer(paused, await quizFor(paused));
  assert.deepEqual([r.web_check, r.web_note, paused.calls.web.length], ['failed', '費用暫停，沒有上網查證', 0]);
});

test('沒有設定 GEMINI_API_KEY 時（本機模式）不查證；本機批改後由 Worker 接著查證', async () => {
  const s = setup();
  const quiz = await quizFor(s);
  await setTextProvider(s.env, 'local');
  const config = loadConfig({
    TECHNEWS_URL: 'https://learning.example.org',
    TECHNEWS_RUNNER_TOKEN: 'runner-test-token',
  });
  const serverFetch = async (url, options) => s.handler.fetch(new Request(url, options), s.env);
  const ollamaFetch = async (value) =>
    new URL(value).pathname === '/api/tags'
      ? Response.json({ models: [{ name: 'gemma4:26b' }] })
      : new Response(
          JSON.stringify({
            message: {
              content:
                '<<<VERDICT1>>>\npartial\n<<<FEEDBACK1>>>\n本篇沒提到 CDN。\n<<<CITATIONS1>>>\nC1\n<<<CHECK1>>>\nCDN 清除快取通常需要幾分鐘\n<<<VERDICT2>>>\ncorrect\n<<<FEEDBACK2>>>\n對。\n<<<CITATIONS2>>>\nC1\n<<<CHECK2>>>\n\n<<<END>>>',
            },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 500,
            eval_count: 100,
          }) + '\n',
        );
  const attempt = await answer(s, quiz);
  assert.equal(attempt.status, 'waiting_local');
  assert.equal((await runOnce(config, { serverFetch, ollamaFetch })).state, 'completed');
  const done = await (await s.handler.fetch(request('api/attempts/' + attempt.id), s.env)).json();
  assert.deepEqual([done.status, done.web_check, done.results[0].verdict], ['done', 'done', 'correct']);
  assert.equal(s.calls.web.length, 1);
  // 沒有金鑰：Mac 照常批改，Worker 不查證並註明原因。
  s.env.GEMINI_API_KEY = '';
  const second = await answer(s, quiz);
  assert.equal((await runOnce(config, { serverFetch, ollamaFetch })).state, 'completed');
  const nokey = await (await s.handler.fetch(request('api/attempts/' + second.id), s.env)).json();
  assert.deepEqual([nokey.status, nokey.web_check, nokey.web_note], ['done', 'disabled', '沒有設定 GEMINI_API_KEY']);
  assert.equal(s.calls.web.length, 1);
});

test('網路查證中斷的作答由維護排程重新查證', async () => {
  const s = setup();
  const quiz = await quizFor(s);
  const r = await answer(s, quiz);
  await query(
    s.env,
    "UPDATE learning_attempts SET status='web_check',web_check='none',updated_at='2026-09-30T00:00:00.000Z',grading_json=json_set(grading_json,'$.results[0].needs_web',json('true'),'$.results[0].claim','CDN 清除快取通常需要幾分鐘') WHERE id=?",
    r.id,
  ).run();
  await s.handler.scheduled(s.env, { tasks: ['maintenance'] });
  const done = await (await s.handler.fetch(request('api/attempts/' + r.id), s.env)).json();
  assert.deepEqual([done.status, done.web_check], ['done', 'done']);
});

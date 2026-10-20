import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { setTextProvider, claim, ensureJob } from '../src/learning/local.js';
import { query, rows, item, saveEvidence } from '../src/learning/store.js';
import { runOnce, loadConfig } from '../runner/lib.js';
import { environment, recorder, request } from './helpers.js';

const now = new Date().toISOString();
async function article(env, id, content, { observations = [] } = {}) {
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,created_at,updated_at) VALUES(?,?,?,?,'ready','正文',?,1,'kept',?,?)",
    id,
    'https://example.org/' + id,
    'web',
    '文章 ' + id,
    JSON.stringify({ observations }),
    now,
    now,
  ).run();
  return saveEvidence(env, id, { url: 'https://example.org/' + id, relation: 'primary', content });
}
function setup() {
  const env = { ...environment(), LEARNING_RUNNER_TOKEN: 'runner-test-token' },
    net = recorder(),
    handler = createLearningHandler(net);
  return { env, net, handler, serverFetch: async (url, options) => handler.fetch(new Request(url, options), env) };
}
const config = loadConfig({ TECHNEWS_URL: 'https://learning.example.org', TECHNEWS_RUNNER_TOKEN: 'runner-test-token' });
function ollama(text) {
  const seen = [];
  return {
    seen,
    fetcher: async (value, options) => {
      if (new URL(value).pathname === '/api/tags') return Response.json({ models: [{ name: 'gemma4:26b' }] });
      seen.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({
          message: { content: text },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 500,
          eval_count: 100,
        }) + '\n',
      );
    },
  };
}
const A = 'a'.repeat(32),
  B = 'b'.repeat(32);

test('單篇追問保存後交給 Mac 回答：可離開再回來看進度、答案與實際來源片段', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  const evidenceA = await article(s.env, A, '部署前要設定 RATE_LIMIT 環境變數，預設值是 100。');
  await article(s.env, B, '另一篇也提到 RATE_LIMIT，但它是不同產品的設定。');
  const asked = await s.handler.fetch(
    request('api/ask', 'POST', { item_id: A, question: 'RATE_LIMIT 預設值是多少？' }),
    s.env,
  );
  assert.equal(asked.status, 202);
  const q = await asked.json();
  assert.equal(q.status, 'waiting_local');
  const job = await query(s.env, 'SELECT input_json,priority FROM learning_jobs WHERE question_id=?', q.id).first();
  const input = JSON.parse(job.input_json);
  assert.equal(job.priority, 0);
  assert.ok(input.chunks.length > 0);
  assert.ok(
    input.chunks.every((c) => c.item_id === A),
    '單篇範圍不能混入其他文章',
  );
  assert.equal((await (await s.handler.fetch(request('api/questions/' + q.id), s.env)).json()).status, 'waiting_local');
  // Mac 離線：例行排程不改變等待中的問題，也不改用雲端模型。
  await s.handler.scheduled(s.env, false);
  assert.equal(s.net.calls.filter((c) => c.url.includes('generativelanguage')).length, 0);
  const model = ollama('<<<INSUFFICIENT>>>\n否\n<<<CITATIONS>>>\nC1\n<<<ANSWER>>>\n預設值是 100 [C1]。\n<<<END>>>');
  assert.equal((await runOnce(config, { serverFetch: s.serverFetch, ollamaFetch: model.fetcher })).state, 'completed');
  assert.match(model.seen[0].messages[1].content, /RATE_LIMIT/);
  assert.doesNotMatch(model.seen[0].messages[1].content, /不同產品/);
  const done = await (await s.handler.fetch(request('api/questions/' + q.id), s.env)).json();
  assert.equal(done.status, 'done');
  assert.match(done.answer_html, /預設值是 100/);
  assert.equal(done.provider, 'ollama');
  assert.equal(done.sources.length, 1);
  assert.ok(done.sources[0].id.startsWith(evidenceA));
  assert.match(done.sources[0].excerpt, /RATE_LIMIT/);
  const history = await (await s.handler.fetch(request('api/questions?item_id=' + A), s.env)).json();
  assert.deepEqual(
    history.map((h) => h.id),
    [q.id],
  );
  assert.equal((await (await s.handler.fetch(request('api/questions'), s.env)).json()).length, 0);
  // 追問不改文章、不發 Telegram 文章通知；歷史受登入保護。
  assert.equal((await item(s.env, A)).revision, 1);
  assert.equal(s.net.calls.filter((c) => c.url.includes('telegram')).length, 0);
  assert.equal(
    (await s.handler.fetch(new Request('https://learning.example.org/learning/api/questions?item_id=' + A), s.env))
      .status,
    401,
  );
});

test('跨篇追問可用媒體證據與舊版媒體觀察；引用未提供片段被拒，不足時照實回答', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  const ev = await article(s.env, A, '影片示範怎麼部署。');
  await query(
    s.env,
    "INSERT INTO learning_media(id,item_id,evidence_id,url,type,duration_ms,status,updated_at) VALUES('m1',?,?,'https://video.example.org/v.mp4','video',60000,'ready',?)",
    A,
    ev,
    now,
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_media_analyses(id,media_id,item_id,fingerprint,model,prompt_version,analysis_json,created_at) VALUES('an1','m1',?,'f','gemini-3.8-flash','media-evidence-v1',?,?)",
    A,
    JSON.stringify({
      ocr: { status: 'none', text: '' },
      speech: {
        status: 'transcribed',
        segments: [{ start: '00:10', end: '00:20', text: 'run wrangler deploy with the staging flag' }],
      },
      visual: [{ timestamp: '00:15', observation: '終端機畫面', kind: 'observed' }],
      unrecognized: [],
      coverage: { from: '00:00', to: '01:00', summary: '全片' },
    }),
    now,
  ).run();
  const evB = await article(s.env, B, '舊文章的截圖說明。', { observations: [] });
  await query(
    s.env,
    'UPDATE learning_items SET article_json=? WHERE id=?',
    JSON.stringify({
      observations: [{ source_id: evB, timestamp: '00:03', description: '舊版觀察：畫面出現 staging 字樣' }],
    }),
    B,
  ).run();
  const q = await (await s.handler.fetch(request('api/ask', 'POST', { question: 'staging 怎麼部署' }), s.env)).json();
  const input = (await claim(s.env, 'mac')).input;
  const relations = input.chunks.map((c) => c.relation);
  assert.ok(relations.includes('media_evidence'));
  assert.ok(relations.includes('model_media_observation'));
  const job = await query(
    s.env,
    'SELECT id,attempt_token,input_version FROM learning_jobs WHERE question_id=?',
    q.id,
  ).first();
  const complete = (output) =>
    s.handler.fetch(
      new Request('https://learning.example.org/learning/runner/complete', {
        method: 'POST',
        headers: { authorization: 'Bearer runner-test-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          runner_id: 'mac',
          job_id: job.id,
          attempt_token: job.attempt_token,
          input_version: job.input_version,
          model: { name: 'gemma4:26b', done_reason: 'stop' },
          output,
        }),
      }),
      s.env,
    );
  assert.equal((await complete({ answer: '用 staging [C99]', citations: ['C99'], insufficient: false })).status, 422);
  const retry = await claim(s.env, 'mac');
  const ok = await s.handler.fetch(
    new Request('https://learning.example.org/learning/runner/complete', {
      method: 'POST',
      headers: { authorization: 'Bearer runner-test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        runner_id: 'mac',
        job_id: retry.id,
        attempt_token: retry.attempt_token,
        input_version: retry.input_version,
        model: { name: 'gemma4:26b', done_reason: 'stop' },
        output: { answer: '已保存來源沒有說明完整步驟，無法確認。', citations: [], insufficient: true },
      }),
    }),
    s.env,
  );
  assert.equal(ok.status, 200);
  const done = await (await s.handler.fetch(request('api/questions/' + q.id), s.env)).json();
  assert.equal(done.insufficient, true);
  assert.deepEqual(done.sources, []);
  const none = await (
    await s.handler.fetch(request('api/ask', 'POST', { question: '完全不存在的火星引擎？' }), s.env)
  ).json();
  assert.equal(none.status, 'done');
  assert.equal(none.insufficient, true);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_jobs WHERE question_id=?', none.id)).length, 0);
});

test('追問優先於背景生成，但不中斷在途推論', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  await article(s.env, A, '背景與 RATE_LIMIT 設定。');
  for (const name of ['bg1', 'bg2'])
    await ensureJob(s.env, { kind: 'article', itemId: name, priority: 3, input: { sources: [] }, fingerprint: name });
  const running = await claim(s.env, 'mac');
  const q = await (
    await s.handler.fetch(request('api/ask', 'POST', { item_id: A, question: 'RATE_LIMIT 是什麼' }), s.env)
  ).json();
  assert.equal(await claim(s.env, 'other'), null);
  assert.equal(
    (await query(s.env, 'SELECT status FROM learning_jobs WHERE id=?', running.id).first()).status,
    'leased',
  );
  await query(s.env, "UPDATE learning_jobs SET status='done' WHERE id=?", running.id).run();
  const next = await claim(s.env, 'mac');
  assert.equal(next.kind, 'question');
  assert.equal(
    (await query(s.env, 'SELECT question_id FROM learning_jobs WHERE id=?', next.id).first()).question_id,
    q.id,
  );
  assert.equal((await (await s.handler.fetch(request('api/questions/' + q.id), s.env)).json()).status, 'generating');
});

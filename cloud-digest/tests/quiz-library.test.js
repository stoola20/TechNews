import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query } from '../src/learning/store.js';
import { environment, recorder, request, embeddingModel, vectorIndex } from './helpers.js';

const [A, B, C] = ['a', 'b', 'c'].map((c) => c.repeat(32));
const payload = (body) => JSON.parse(body.contents[0].parts[0].text.split('\n\n').at(-1));
const gemini = (data) =>
  Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 0 },
  });
// 假 Gemini：有相關文章時出 3 題本篇加 1 題連結題；linkMissing 時故意不出連結題。
async function setup({ down = () => false, linkMissing = false } = {}) {
  const requests = [];
  const net = recorder(async (url, options) => {
    if (url.hostname !== 'generativelanguage.googleapis.com') return null;
    const body = JSON.parse(options.body),
      data = payload(body),
      system = body.systemInstruction.parts[0].text;
    requests.push({ system, data });
    if (system.includes('出題老師')) {
      const own = data.chunks.filter((c) => c.article === '本篇');
      const questions = [0, 1, 2].map((n) => ({
        type: 'article',
        question: `第 ${n + 1} 題：快取失效為什麼重要？角度 ${n}`,
        reference: '避免讀到舊資料。',
        citations: [own[n % own.length].ref],
      }));
      const related = data.related[0];
      if (related && !linkMissing)
        questions.push({
          type: 'link',
          related: related.ref,
          question: '這篇和相關文章談的快取做法有什麼關係？',
          reference: '兩篇都在處理快取失效，一篇講期限、一篇講寫入時失效。',
          citations: [own[0].ref, data.chunks.find((c) => c.article === related.ref).ref],
        });
      return gemini({ questions });
    }
    return gemini({
      results: data.questions.map((q) => ({
        number: q.number,
        verdict: 'partial',
        feedback: '方向對，但少了寫入時失效。',
        citations: data.chunks.filter((c) => c.from === '其他保留文章').length
          ? [data.chunks.find((c) => c.from === '其他保留文章').ref]
          : [data.chunks[0].ref],
        needs_web: false,
        claim: '',
      })),
    });
  });
  const env = environment({ AI: embeddingModel({ fail: down }), LIBRARY_INDEX: vectorIndex() });
  const handler = createLearningHandler({ ...net, now: () => Date.parse('2026-10-01T00:00:00Z') });
  const add = async (id, title, body, intro) =>
    query(
      env,
      "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,kept_at,created_at,updated_at) VALUES(?,?,'web',?,'ready',?,?,1,'kept','2026-10-01','2026-10-01','2026-10-01')",
      id,
      'https://example.org/' + id[0],
      title,
      body,
      JSON.stringify({ intro }),
    ).run();
  await add(
    A,
    '快取期限',
    '## 快取\n\n' + '快取的期限要依資料更新頻率設定，快取過期就重新讀取。'.repeat(8),
    '快取 cache 期限',
  );
  await add(
    B,
    '寫入時讓快取失效',
    '## 快取\n\n' + '寫入資料時主動讓快取失效，cache 就不會留著舊資料。'.repeat(8),
    '快取 cache 失效',
  );
  await add(C, '預算控管', '## 預算\n\n' + '每月預算用完就暫停付費工作，費用要先預留再結算。'.repeat(8), '預算 budget');
  await handler.scheduled(env, { tasks: ['maintenance'] });
  return { env, handler, requests };
}
const post = async (s, path, data) => {
  const r = await s.handler.fetch(request(path, 'POST', data), s.env);
  return { status: r.status, body: await r.json() };
};

test('找得到相關保留文章時恰好 1 題連結題，出處同時包含本篇與相關文章，並附那篇的連結', async () => {
  const s = await setup();
  const quiz = (await post(s, 'api/items/' + A + '/quizzes', {})).body;
  assert.equal(quiz.status, 'ready');
  const sent = s.requests[0].data;
  assert.deepEqual(
    sent.related.map((r) => [r.ref, r.title]),
    [['R1', '寫入時讓快取失效']],
  );
  assert.ok(sent.chunks.filter((c) => c.article === 'R1').length <= 3);
  assert.ok(!sent.chunks.some((c) => c.content.includes('預算')));
  const links = quiz.questions.filter((q) => q.type === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0].related_id, B);
  assert.deepEqual(quiz.related, [{ id: B, title: '寫入時讓快取失效', ref: 'R1' }]);
  // 有相關文章卻沒出連結題：視為出題失敗。
  const missing = await setup({ linkMissing: true });
  const failed = (await post(missing, 'api/items/' + A + '/quizzes', {})).body;
  assert.deepEqual([failed.status, failed.error], ['error', '有相關文章時恰好要有 1 題連結題']);
  // 沒有相關文章（預算文章）時不出連結題。
  const lone = (await post(s, 'api/items/' + C + '/quizzes', {})).body;
  assert.equal(lone.status, 'ready');
  assert.deepEqual(s.requests.at(-1).data.related, []);
  assert.ok(lone.questions.every((q) => q.type === 'article'));
});

test('批改第二層：用題目＋答案查詢其他保留文章，最多 6 段；出處分成本篇與其他保留文章並附標題', async () => {
  const s = await setup();
  const quiz = (await post(s, 'api/items/' + C + '/quizzes', {})).body;
  const attempt = (
    await post(s, 'api/quizzes/' + quiz.id + '/attempts', {
      answers: [{ number: 1, answer: '快取寫入時要讓 cache 失效' }],
    })
  ).body;
  const sent = s.requests.at(-1).data;
  const library = sent.chunks.filter((c) => c.from === '其他保留文章');
  assert.ok(library.length > 0 && library.length <= 6);
  assert.ok(sent.chunks.some((c) => c.from === '本篇'));
  const result = attempt.results[0];
  assert.ok(result.sources.library.length > 0);
  assert.ok(result.sources.library.every((x) => x.item_id !== C && x.title));
});

test('檢索降級時照常出題與批改，只是沒有連結題與第二層', async () => {
  const s = await setup();
  // 索引建好之後 Workers AI 才故障。
  s.env.AI = embeddingModel({ fail: () => true });
  const quiz = (await post(s, 'api/items/' + A + '/quizzes', {})).body;
  assert.equal(quiz.status, 'ready');
  assert.deepEqual(s.requests[0].data.related, []);
  assert.ok(quiz.questions.every((q) => q.type === 'article'));
  const attempt = (
    await post(s, 'api/quizzes/' + quiz.id + '/attempts', { answers: [{ number: 1, answer: '快取寫入時失效' }] })
  ).body;
  assert.equal(attempt.status, 'done');
  assert.ok(s.requests.at(-1).data.chunks.every((c) => c.from === '本篇'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query, rows } from '../src/learning/store.js';
import { nextStep } from '../src/learning/reviews.js';
import { environment, recorder, request } from './helpers.js';

const DAY = 86400000;
const payload = (body) => JSON.parse(body.contents[0].parts[0].text.split('\n\n').at(-1));
const gemini = (data) =>
  Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }],
    usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100, thoughtsTokenCount: 0 },
  });
// 假 Gemini：題目固定 4 題；批改依答案關鍵字判定（RIGHT 正確、HALF 部分正確、其他錯誤）。
function setup(start = '2026-10-01T02:00:00Z') {
  const clock = { now: Date.parse(start) };
  const net = recorder(async (url, options) => {
    if (url.hostname !== 'generativelanguage.googleapis.com') return null;
    const body = JSON.parse(options.body),
      data = payload(body);
    if (body.systemInstruction.parts[0].text.includes('出題老師'))
      return gemini({
        questions: [1, 2, 3, 4].map((n) => ({
          type: 'article',
          question: `第 ${n} 題：為什麼要這樣設計？${n}`,
          reference: '參考答案',
          citations: [data.chunks[0].ref],
        })),
      });
    return gemini({
      results: data.questions.map((q) => ({
        number: q.number,
        verdict: q.answer.includes('RIGHT') ? 'correct' : q.answer.includes('HALF') ? 'partial' : 'incorrect',
        feedback: '回饋',
        citations: [data.chunks[0].ref],
        needs_web: false,
        claim: '',
      })),
    });
  });
  const env = environment();
  const handler = createLearningHandler({ ...net, now: () => clock.now });
  return { env, handler, clock };
}
let serial = 0;
async function quizFor(s) {
  const id = (++serial).toString(16).padStart(32, 'a');
  await query(
    s.env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,created_at,updated_at) VALUES(?,?,'web','文章','ready',?,'{}',1,'kept','2026-10-01','2026-10-01')",
    id,
    'https://example.org/' + id,
    '## 設計\n\n' + '這樣設計是為了讓失敗可以重試。'.repeat(10),
  ).run();
  const quiz = await (await s.handler.fetch(request('api/items/' + id + '/quizzes', 'POST', {}), s.env)).json();
  return { id, quiz: quiz.id };
}
// 沒列出的題目答對（空白答案會判錯並進入複習）。
const quizAttempt = (s, quiz, answers) =>
  s.handler
    .fetch(
      request('api/quizzes/' + quiz + '/attempts', 'POST', {
        answers: [1, 2, 3, 4].map((n) => answers.find((a) => a.number === n) || { number: n, answer: 'RIGHT' }),
      }),
      s.env,
    )
    .then((r) => r.json());
const reviewAttempt = (s, id, answer, unsure = false) =>
  s.handler.fetch(request('api/reviews/' + id + '/attempts', 'POST', { answer, unsure }), s.env);
const today = (s) => s.handler.fetch(request('api/reviews/today'), s.env).then((r) => r.json());
const reviews = (s) =>
  rows(s.env, 'SELECT number,stage,due_date,status,last_result FROM learning_reviews ORDER BY number');

test('答錯、部分正確或勾不確定的題目進入複習：第 1 階、到期日為台灣時間明天；答對且確定的不進入', async () => {
  const s = setup();
  const { quiz } = await quizFor(s);
  await quizAttempt(s, quiz, [
    { number: 1, answer: 'RIGHT' },
    { number: 2, answer: 'HALF' },
    { number: 3, answer: '不知道' },
    { number: 4, answer: 'RIGHT', unsure: true },
  ]);
  assert.deepEqual(
    (await reviews(s)).map((r) => [r.number, r.stage, r.due_date, r.last_result]),
    [
      [2, 1, '2026-10-02', 'partial'],
      [3, 1, '2026-10-02', 'incorrect'],
      [4, 1, '2026-10-02', 'unsure'],
    ],
  );
  // 還沒到期：今日複習是空的，也不能提前作答。
  assert.equal((await today(s)).items.length, 0);
  const id = (await rows(s.env, 'SELECT id FROM learning_reviews LIMIT 1'))[0].id;
  assert.equal((await reviewAttempt(s, id, 'RIGHT')).status, 409);
});

test('階梯：答對往上一階、部分正確留在同一階、答錯或不確定回第 1 階，第 4 階答對就完成；精讀重做也套用', async () => {
  assert.deepEqual(nextStep(1, 'correct', false, '2026-10-02'), { stage: 2, due: '2026-10-05' });
  assert.deepEqual(nextStep(2, 'correct', false, '2026-10-05'), { stage: 3, due: '2026-10-12' });
  assert.deepEqual(nextStep(3, 'correct', false, '2026-10-12'), { stage: 4, due: '2026-11-02' });
  assert.equal(nextStep(4, 'correct', false, '2026-11-02'), null);
  assert.deepEqual(nextStep(3, 'partial', false, '2026-10-12'), { stage: 3, due: '2026-10-19' });
  assert.deepEqual(nextStep(3, 'incorrect', false, '2026-10-12'), { stage: 1, due: '2026-10-13' });
  assert.deepEqual(nextStep(3, 'correct', true, '2026-10-12'), { stage: 1, due: '2026-10-13' });
  const s = setup();
  const { quiz } = await quizFor(s);
  await quizAttempt(s, quiz, [{ number: 1, answer: '錯' }]);
  const [{ id }] = await rows(s.env, 'SELECT id FROM learning_reviews');
  const walk = [
    ['RIGHT', 2, '2026-10-05'],
    ['HALF', 2, '2026-10-08'],
    ['RIGHT', 3, '2026-10-15'],
    ['RIGHT', 4, '2026-11-05'],
  ];
  for (const [answer, stage, due] of walk) {
    const current = (await rows(s.env, 'SELECT due_date FROM learning_reviews WHERE id=?', id))[0].due_date;
    s.clock.now = Date.parse(current + 'T01:00:00Z');
    const list = await today(s);
    assert.equal(list.items[0].id, id);
    assert.match(list.items[0].question, /第 1 題/);
    const r = await reviewAttempt(s, id, answer);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).context, 'review');
    const row = (await rows(s.env, 'SELECT stage,due_date FROM learning_reviews WHERE id=?', id))[0];
    assert.deepEqual([row.stage, row.due_date], [stage, due]);
  }
  s.clock.now = Date.parse('2026-11-05T01:00:00Z');
  await reviewAttempt(s, id, 'RIGHT');
  assert.equal((await rows(s.env, 'SELECT status FROM learning_reviews WHERE id=?', id))[0].status, 'done');
  // 精讀重做：已在複習中的題目也套用階梯；已完成的題目再答錯會重新進入第 1 階。
  await quizAttempt(s, quiz, [{ number: 1, answer: '又錯了' }]);
  assert.deepEqual(
    (await reviews(s)).map((r) => [r.number, r.stage, r.status]),
    [[1, 1, 'active']],
  );
  await quizAttempt(s, quiz, [{ number: 1, answer: 'RIGHT' }]);
  assert.deepEqual(
    (await reviews(s)).map((r) => [r.stage, r.due_date]),
    [[2, '2026-11-08']],
  );
});

test('每日最多 10 題，今天已作答的計入上限，多的隔天再出現；列表入口顯示今日複習題數', async () => {
  const s = setup();
  for (let i = 0; i < 3; i++) {
    const { quiz } = await quizFor(s);
    await quizAttempt(
      s,
      quiz,
      [1, 2, 3, 4].map((n) => ({ number: n, answer: '錯' })),
    );
  }
  s.clock.now = Date.parse('2026-10-02T01:00:00Z');
  let list = await today(s);
  assert.deepEqual([list.items.length, list.total_due, list.limit], [10, 12, 10]);
  for (const r of list.items.slice(0, 3)) await reviewAttempt(s, r.id, 'RIGHT');
  list = await today(s);
  assert.deepEqual([list.items.length, list.total_due, list.answered_today], [7, 9, 3]);
  const status = await (await s.handler.fetch(request('api/status'), s.env)).json();
  assert.equal(status.reviews_today, 7);
  // 隔天：剩下的到期題目再出現，上限重新計算。
  s.clock.now = Date.parse('2026-10-03T01:00:00Z');
  assert.equal((await today(s)).items.length, 9);
});

test('「今天」依台灣日期：UTC 15:59 仍是當天，16:00 起算隔天', async () => {
  const s = setup('2026-10-01T15:59:00Z');
  const { quiz } = await quizFor(s);
  await quizAttempt(s, quiz, [{ number: 1, answer: '錯' }]);
  assert.equal((await reviews(s))[0].due_date, '2026-10-02');
  s.clock.now = Date.parse('2026-10-01T15:59:59Z');
  assert.equal((await today(s)).items.length, 0);
  s.clock.now = Date.parse('2026-10-01T16:00:00Z');
  assert.equal((await today(s)).items.length, 1);
});

test('取消保留的文章暫停複習、重新保留後照原到期日出現；刪除並清除後一併刪除', async () => {
  const s = setup();
  const { id, quiz } = await quizFor(s);
  await quizAttempt(s, quiz, [{ number: 1, answer: '錯' }]);
  s.clock.now = Date.parse('2026-10-03T01:00:00Z');
  assert.equal((await today(s)).items.length, 1);
  await s.handler.fetch(request('api/items/' + id + '/triage', 'PUT', { action: 'pending' }), s.env);
  assert.equal((await today(s)).items.length, 0);
  await s.handler.fetch(request('api/items/' + id + '/triage', 'PUT', { action: 'keep' }), s.env);
  const back = await today(s);
  assert.deepEqual([back.items.length, back.items[0].due_date], [1, '2026-10-02']);
  await s.handler.fetch(request('api/items/' + id + '/triage', 'PUT', { action: 'delete' }), s.env);
  assert.equal((await today(s)).items.length, 0);
  s.clock.now += 8 * DAY;
  await s.handler.scheduled(s.env, { tasks: ['maintenance'] });
  assert.equal((await rows(s.env, 'SELECT id FROM learning_reviews')).length, 0);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_quizzes')).length, 0);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_attempts')).length, 0);
});

test('今日複習的查詢走索引', () => {
  const s = setup();
  const plan = s.env.DB.sqlite
    .prepare(
      "EXPLAIN QUERY PLAN SELECT r.id FROM learning_reviews r JOIN learning_items i ON i.id=r.item_id WHERE r.status='active' AND r.due_date<=? AND i.triage='kept' ORDER BY r.due_date,r.created_at LIMIT 10",
    )
    .all('2026-10-01')
    .map((r) => r.detail)
    .join(' | ');
  assert.match(plan, /INDEX learning_reviews_due/);
});

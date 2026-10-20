import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query } from '../src/learning/store.js';
import { environment, recorder, request } from './helpers.js';

function setup(now = '2026-10-07T04:00:00Z') {
  const env = environment();
  const handler = createLearningHandler({ ...recorder(), now: () => Date.parse(now) });
  return { env, handler };
}
let serial = 0;
async function article(env, fields = {}) {
  const id = (++serial).toString(16).padStart(32, 'b');
  const f = {
    triage: 'pending',
    topic_primary: null,
    kept_at: null,
    deleted_at: null,
    deleted_reason: null,
    status: 'ready',
    ...fields,
  };
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,revision,triage,topic_primary,kept_at,deleted_at,deleted_reason,created_at,updated_at) VALUES(?,?,'web','文章',?,'正文',1,?,?,?,?,?,'2026-09-01','2026-09-01')",
    id,
    'https://example.org/' + id,
    f.status,
    f.triage,
    f.topic_primary,
    f.kept_at,
    f.deleted_at,
    f.deleted_reason,
  ).run();
  return id;
}
async function attempt(env, itemId, at, verdicts, context = 'quiz') {
  await query(
    env,
    "INSERT INTO learning_attempts(id,quiz_id,item_id,context,answers_json,status,grading_json,created_at,updated_at) VALUES(?,'q',?,?,'[]','done',?,?,?)",
    crypto.randomUUID(),
    itemId,
    context,
    JSON.stringify({ results: verdicts.map((verdict, i) => ({ number: i + 1, verdict })) }),
    at,
    at,
  ).run();
}
const stats = async (s, q = '') => {
  const r = await s.handler.fetch(request('api/stats/week' + q), s.env);
  return { status: r.status, body: await r.json() };
};

test('每週回顧：保留、手動與逾期刪除、作答與答對率、最常答錯的主題、複習狀況；週界線是台灣時間週一 00:00', async () => {
  const s = setup();
  // 2026-10-05（週一）台灣時間 00:00 = 2026-10-04T16:00:00Z。
  await article(s.env, { triage: 'kept', kept_at: '2026-10-04T16:00:00.000Z' });
  await article(s.env, { triage: 'kept', kept_at: '2026-10-11T15:59:59.000Z' });
  await article(s.env, { triage: 'kept', kept_at: '2026-10-04T15:59:59.000Z' });
  await article(s.env, { triage: 'deleted', deleted_at: '2026-10-06T00:00:00.000Z', deleted_reason: 'manual' });
  await article(s.env, { triage: 'deleted', deleted_at: '2026-10-06T00:00:00.000Z', deleted_reason: 'expired' });
  // 已清除的文章仍保留刪除時間，照樣計入。
  await article(s.env, { status: 'dismissed', deleted_at: '2026-10-05T00:00:00.000Z', deleted_reason: 'expired' });
  const models = await article(s.env, { triage: 'kept', topic_primary: 'models', kept_at: '2026-09-01T00:00:00.000Z' });
  const apple = await article(s.env, { triage: 'kept', topic_primary: 'apple', kept_at: '2026-09-01T00:00:00.000Z' });
  await attempt(s.env, models, '2026-10-05T01:00:00.000Z', ['correct', 'partial', 'incorrect']);
  await attempt(s.env, apple, '2026-10-06T01:00:00.000Z', ['incorrect'], 'review');
  await attempt(s.env, models, '2026-10-04T15:00:00.000Z', ['incorrect', 'incorrect']);
  for (const [status, due, completed] of [
    ['active', '2026-10-08', null],
    ['active', '2026-10-20', null],
    ['done', '2026-10-01', '2026-10-06T00:00:00.000Z'],
    ['done', '2026-09-01', '2026-09-20T00:00:00.000Z'],
  ])
    await query(
      s.env,
      "INSERT INTO learning_reviews(id,quiz_id,number,item_id,stage,due_date,status,completed_at,created_at,updated_at) VALUES(?,?,1,?,1,?,?,?,'2026-10-01','2026-10-01')",
      crypto.randomUUID(),
      crypto.randomUUID(),
      models,
      due,
      status,
      completed,
    ).run();
  const r = await stats(s, '?start=2026-10-05');
  assert.equal(r.status, 200);
  const w = r.body;
  assert.deepEqual([w.start, w.end, w.previous, w.next], ['2026-10-05', '2026-10-11', '2026-09-28', null]);
  assert.equal(w.kept, 2);
  assert.deepEqual(w.deleted, { manual: 1, expired: 2 });
  assert.deepEqual(w.answers, { total: 4, correct: 1, partial: 1, incorrect: 2, accuracy: 0.25 });
  assert.deepEqual(
    w.missed_topics.map((t) => [t.id, t.count]),
    [
      ['models', 2],
      ['apple', 1],
    ],
  );
  assert.equal(w.missed_topics[0].name, '模型發布與能力');
  assert.deepEqual(w.reviews, { active: 2, upcoming_7_days: 1, completed: 1 });
  // 不帶參數時是本週；帶週中任一天會對齊到週一。
  assert.equal((await stats(s)).body.start, '2026-10-05');
  assert.equal((await stats(s, '?start=2026-10-09')).body.start, '2026-10-05');
  const before = (await stats(s, '?start=2026-09-28')).body;
  assert.deepEqual([before.kept, before.answers.total, before.next], [1, 2, '2026-10-05']);
  assert.equal((await stats(s, '?start=bogus')).status, 400);
});

test('跨年週：2026-12-28（週一）到 2027-01-03（週日）', async () => {
  const s = setup('2027-01-02T04:00:00Z');
  await article(s.env, { triage: 'kept', kept_at: '2026-12-27T16:00:00.000Z' });
  await article(s.env, { triage: 'kept', kept_at: '2027-01-03T15:59:59.000Z' });
  await article(s.env, { triage: 'kept', kept_at: '2027-01-03T16:00:00.000Z' });
  const w = (await stats(s, '?start=2027-01-01')).body;
  assert.deepEqual([w.start, w.end, w.kept], ['2026-12-28', '2027-01-03', 2]);
});

test('每週回顧的查詢走索引', () => {
  const s = setup();
  const plan = (sql, ...args) =>
    s.env.DB.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + sql)
      .all(...args)
      .map((r) => r.detail)
      .join(' | ');
  assert.match(
    plan("SELECT COUNT(*) FROM learning_items WHERE triage='kept' AND kept_at>=? AND kept_at<?", 'a', 'b'),
    /INDEX learning_items_kept_at/,
  );
  assert.match(
    plan(
      'SELECT deleted_reason,COUNT(*) FROM learning_items WHERE deleted_at>=? AND deleted_at<? GROUP BY deleted_reason',
      'a',
      'b',
    ),
    /INDEX learning_items_deleted_at/,
  );
  assert.match(
    plan("SELECT grading_json FROM learning_attempts WHERE created_at>=? AND created_at<? AND status='done'", 'a', 'b'),
    /INDEX learning_attempts_created/,
  );
  assert.match(
    plan("SELECT COUNT(*) FROM learning_reviews WHERE status='done' AND completed_at>=? AND completed_at<?", 'a', 'b'),
    /INDEX learning_reviews_(completed|due)/,
  );
});

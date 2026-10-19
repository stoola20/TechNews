import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query, rows, item } from '../src/learning/store.js';
import { database, environment, recorder, request } from './helpers.js';

const DAY = 86400000,
  MIN = 60000;
const iso = (t) => new Date(t).toISOString();
// 文章整理用假模型：不呼叫外部服務，內容依網址產生。
function setup(start = '2026-10-01T00:00:00Z') {
  const env = environment(),
    net = recorder();
  const clock = { now: Date.parse(start), paused: false };
  const handler = createLearningHandler({
    ...net,
    now: () => clock.now,
    webEvidence: async (url) => ({
      url,
      relation: 'primary',
      content: '合成原文：' + url,
      metadata: { title: '合成文章' },
      media: [],
    }),
    prepareMedia: async () => ({ pending: false, media: [], gaps: [] }),
    generate: async (env, sources) => {
      if (clock.paused) throw Object.assign(new Error('費用暫停'), { name: 'BudgetPaused' });
      return {
        title: '合成教材',
        body: '正文 ' + sources[0].content,
        intro: '導讀',
        citations: [sources[0].id],
        observations: [],
      };
    },
    classifyTopics: async () => ({ primary: 'models', secondary: null }),
  });
  return { env, net, handler, clock };
}
const maintain = (s) => s.handler.scheduled(s.env, { tasks: ['maintenance'] });

test('期限從第一次可以閱讀時起算：處理中與費用暫停不計時，之後的重寫不重設', async () => {
  const s = setup();
  // 費用暫停：先收件，兩天後才整理完成。
  s.clock.paused = true;
  const id = await s.handler.service.collect(s.env, 'https://example.org/slow', 'share');
  await s.handler.service.process(s.env, id);
  assert.equal((await item(s.env, id)).status, 'budget_paused');
  await maintain(s);
  assert.equal((await item(s.env, id)).triage_deadline, null);
  s.clock.now += 2 * DAY;
  s.clock.paused = false;
  await query(s.env, "UPDATE learning_items SET status='queued' WHERE id=?", id).run();
  await s.handler.service.process(s.env, id);
  const done = await item(s.env, id);
  assert.equal(done.status, 'ready');
  assert.equal(done.triage_deadline, iso(s.clock.now + 14 * DAY));
  // 五天後重寫：期限不變。
  s.clock.now += 5 * DAY;
  assert.equal((await s.handler.fetch(request('api/items/' + id + '/rewrite', 'POST', {}), s.env)).status, 202);
  await query(
    s.env,
    "UPDATE learning_items SET article_json=json_set(article_json,'$.input_fingerprint','x') WHERE id=?",
    id,
  ).run();
  await s.handler.service.process(s.env, id);
  const rewritten = await item(s.env, id);
  assert.equal(rewritten.revision, 2);
  assert.equal(rewritten.triage_deadline, done.triage_deadline);
  // 閱讀頁拿得到期限，用來顯示剩餘天數。
  const opened = await (await s.handler.fetch(request('api/items/' + id), s.env)).json();
  assert.equal(opened.item.triage_deadline, done.triage_deadline);
});

test('等待確認回補的書籤一收進來就開始計時；逾期由維護排程移到最近刪除並標示逾期', async () => {
  const s = setup();
  const id = await s.handler.service.collect(s.env, 'https://example.org/wait', 'backfill', 'b1', {
    defer: true,
    source: { url: 'https://example.org/wait', relation: 'primary', content: '原文', media: [] },
  });
  const start = s.clock.now;
  assert.equal((await item(s.env, id)).triage_deadline, iso(start + 14 * DAY));
  s.clock.now = start + 14 * DAY - MIN;
  await maintain(s);
  assert.equal((await item(s.env, id)).triage, 'pending');
  s.clock.now = start + 14 * DAY + MIN;
  await maintain(s);
  const expired = await item(s.env, id);
  assert.deepEqual(
    [expired.triage, expired.deleted_reason, expired.deleted_from, expired.status],
    ['deleted', 'expired', 'pending', 'awaiting_backfill'],
  );
  const recent = await (await s.handler.fetch(request('api/items?triage=deleted'), s.env)).json();
  assert.equal(recent[0].deleted_reason, 'expired');
  // 救回後重新計 14 天，不會在下一輪維護又被移走。
  const restored = await (
    await s.handler.fetch(request('api/items/' + id + '/triage', 'PUT', { action: 'restore' }), s.env)
  ).json();
  assert.equal(restored.triage, 'pending');
  assert.equal(restored.triage_deadline, iso(s.clock.now + 14 * DAY));
  await maintain(s);
  assert.equal((await item(s.env, id)).triage, 'pending');
});

test('最近刪除中的文章被手動分享：恢復為待決定，期限重設為 14 天', async () => {
  const s = setup();
  const id = await s.handler.service.collect(s.env, 'https://example.org/again', 'share');
  await s.handler.service.process(s.env, id);
  await s.handler.fetch(request('api/items/' + id + '/triage', 'PUT', { action: 'delete' }), s.env);
  s.clock.now += 3 * DAY;
  await s.handler.service.collect(s.env, 'https://example.org/again', 'share');
  const revived = await item(s.env, id);
  assert.deepEqual([revived.triage, revived.deleted_at], ['pending', null]);
  assert.equal(revived.triage_deadline, iso(s.clock.now + 14 * DAY));
});

test('升級前已在文章庫的文章不套用自動過期；升級時仍在處理中的完成後照常計時', async () => {
  const env = environment();
  env.DB = database({
    beforeMigration(name, sqlite) {
      if (name !== '0018_triage.sql') return;
      sqlite
        .prepare(
          "INSERT INTO learning_items(id,url,kind,title,status,body,revision,created_at,updated_at) VALUES(?,?,'web','舊文章','ready','正文',1,'2026-09-01','2026-09-01')",
        )
        .run('a'.repeat(32), 'https://example.org/old');
      sqlite
        .prepare(
          "INSERT INTO learning_items(id,url,kind,title,status,revision,created_at,updated_at) VALUES(?,?,'web','處理中','queued',0,'2026-09-01','2026-09-01')",
        )
        .run('b'.repeat(32), 'https://example.org/processing');
    },
  });
  const clock = { now: Date.parse('2026-10-01T00:00:00Z') };
  const handler = createLearningHandler({ ...recorder(), now: () => clock.now });
  await env.DB.prepare("UPDATE learning_items SET status='ready',body='正文',revision=1 WHERE id=?")
    .bind('b'.repeat(32))
    .run();
  await handler.scheduled(env, { tasks: ['maintenance'] });
  assert.equal((await item(env, 'a'.repeat(32))).triage_deadline, null);
  assert.equal((await item(env, 'b'.repeat(32))).triage_deadline, iso(clock.now + 14 * DAY));
  clock.now += 100 * DAY;
  await handler.scheduled(env, { tasks: ['maintenance'] });
  assert.equal((await item(env, 'a'.repeat(32))).triage, 'pending');
  assert.deepEqual(
    [(await item(env, 'b'.repeat(32))).triage, (await item(env, 'b'.repeat(32))).deleted_reason],
    ['deleted', 'expired'],
  );
});

test('逾期移入每輪有篇數上限', async () => {
  const s = setup();
  for (let n = 0; n < 55; n++)
    await query(
      s.env,
      "INSERT INTO learning_items(id,url,kind,title,status,body,revision,triage_deadline,created_at,updated_at) VALUES(?,?,'web','t','ready','b',1,?,?,?)",
      n.toString(16).padStart(32, '0'),
      'https://example.org/n' + n,
      iso(s.clock.now - DAY),
      iso(s.clock.now),
      iso(s.clock.now),
    ).run();
  await maintain(s);
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE triage='deleted'")).length, 50);
  await maintain(s);
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE triage='deleted'")).length, 55);
});

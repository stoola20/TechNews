import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query, rows, item } from '../src/learning/store.js';
import { mergeItems } from '../src/learning/library.js';
import { database, environment, recorder, request } from './helpers.js';

const DAY = 86400000;
const id = (c) => (c.length === 32 ? c : c.repeat(32));
function setup(start = '2026-10-01T00:00:00Z') {
  const env = environment(),
    net = recorder();
  const clock = { now: Date.parse(start) };
  const handler = createLearningHandler({ ...net, now: () => clock.now });
  return { env, net, handler, clock };
}
// 合成文章：已完成、有正文與導讀。
async function add(env, key, { status = 'ready', title = '文章 ' + key, note = '', triage = null, at = null } = {}) {
  const time = at || '2026-10-01T00:00:00.000Z';
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,note,revision,created_at,updated_at) VALUES(?,?,'web',?,?,'正文',?,?,1,?,?)",
    id(key),
    'https://example.org/' + key,
    title,
    status,
    JSON.stringify({ intro: '導讀 ' + key, content_fingerprint: 'c' + key }),
    note,
    time,
    time,
  ).run();
  await query(
    env,
    "INSERT INTO learning_intakes(receipt,item_id,origin,created_at) VALUES(?,?,'web',?)",
    'r' + key,
    id(key),
    time,
  ).run();
  if (triage) await query(env, 'UPDATE learning_items SET triage=? WHERE id=?', triage, id(key)).run();
}
const act = async (s, key, action) => {
  const response = await s.handler.fetch(request('api/items/' + id(key) + '/triage', 'PUT', { action }), s.env);
  return { status: response.status, body: await response.json() };
};
const list = async (s, q = '') =>
  (await (await s.handler.fetch(request('api/items' + q), s.env)).json())
    .map((i) => i.id[0])
    .sort()
    .join('');

test('升級後既有文章都是待決定；已可閱讀的不套用自動過期，仍在處理中的照常計時', async () => {
  const db = database({
    beforeMigration(name, sqlite) {
      if (name !== '0018_triage.sql') return;
      const insert = sqlite.prepare(
        "INSERT INTO learning_items(id,url,kind,title,status,created_at,updated_at) VALUES(?,?,'web','舊文章',?,'2026-09-01','2026-09-01')",
      );
      for (const [key, status] of [
        ['a', 'ready'],
        ['b', 'partial'],
        ['c', 'awaiting_backfill'],
        ['d', 'queued'],
        ['e', 'filtered'],
      ])
        insert.run(id(key), 'https://example.org/' + key, status);
    },
  });
  const found = db.sqlite
    .prepare('SELECT id,triage,starred,triage_no_expiry FROM learning_items ORDER BY id')
    .all()
    .map((r) => [r.id[0], r.triage, r.starred, r.triage_no_expiry]);
  assert.deepEqual(found, [
    ['a', 'pending', 0, 1],
    ['b', 'pending', 0, 1],
    ['c', 'pending', 0, 1],
    ['d', 'pending', 0, 0],
    ['e', 'pending', 0, 0],
  ]);
});

test('篩選動作：★ 一定同時保留、離開保留就拿掉 ★；刪除後復原回到刪除前的結果', async () => {
  const s = setup();
  await add(s.env, 'a');
  await add(s.env, 'f', { status: 'filtered' });
  let r = await act(s, 'a', 'star');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.triage, r.body.starred], ['kept', true]);
  const keptAt = r.body.kept_at;
  assert.ok(keptAt);
  r = await act(s, 'a', 'keep');
  assert.deepEqual([r.body.triage, r.body.starred, r.body.kept_at], ['kept', true, keptAt]);
  r = await act(s, 'a', 'unstar');
  assert.deepEqual([r.body.triage, r.body.starred, r.body.kept_at], ['kept', false, keptAt]);
  await act(s, 'a', 'star');
  r = await act(s, 'a', 'pending');
  assert.deepEqual([r.body.triage, r.body.starred, r.body.kept_at], ['pending', false, null]);
  await act(s, 'a', 'star');
  s.clock.now += 3600000;
  r = await act(s, 'a', 'delete');
  assert.deepEqual(
    [r.body.triage, r.body.starred, r.body.deleted_from, r.body.deleted_reason],
    ['deleted', false, 'starred', 'manual'],
  );
  assert.equal(r.body.purge_at, new Date(s.clock.now + 7 * DAY).toISOString());
  r = await act(s, 'a', 'restore');
  assert.deepEqual([r.body.triage, r.body.starred, r.body.deleted_at], ['kept', true, null]);
  assert.equal((await act(s, 'a', 'restore')).status, 409);
  assert.equal((await act(s, 'a', 'bogus')).status, 400);
  assert.equal((await act(s, 'f', 'keep')).status, 409);
  assert.equal((await act(s, 'z', 'keep')).status, 404);
});

test('列表預設只回保留文章；★、待決定、全部、最近刪除各自獨立，主題篇數依同一組條件計算；搜尋比對筆記', async () => {
  const s = setup();
  await add(s.env, 'a', { triage: 'kept' });
  await add(s.env, 'b', { note: '我的心得：快取失效' });
  await add(s.env, 'c', { triage: 'kept' });
  await add(s.env, 'd');
  await add(s.env, 'e', { status: 'filtered' });
  await query(s.env, "UPDATE learning_items SET topic_primary='models' WHERE id IN (?,?)", id('a'), id('b')).run();
  await act(s, 'c', 'star');
  s.clock.now += 1000;
  await act(s, 'd', 'delete');
  s.clock.now += 1000;
  await act(s, 'b', 'delete');
  await act(s, 'b', 'restore');
  assert.equal(await list(s), 'ac');
  assert.equal(await list(s, '?triage=kept'), 'ac');
  assert.equal(await list(s, '?triage=starred'), 'c');
  assert.equal(await list(s, '?triage=pending'), 'b');
  assert.equal(await list(s, '?triage=all'), 'abc');
  assert.equal(await list(s, '?triage=deleted'), 'd');
  assert.equal(await list(s, '?state=filtered'), 'e');
  assert.equal((await s.handler.fetch(request('api/items?triage=bogus'), s.env)).status, 400);
  const listed = await (await s.handler.fetch(request('api/items?triage=starred'), s.env)).json();
  assert.equal(listed[0].starred, 1);
  const topics = async (q) => await (await s.handler.fetch(request('api/topics' + q), s.env)).json();
  const kept = await topics('');
  assert.deepEqual([kept.total, kept.topics.find((t) => t.id === 'models').count], [2, 1]);
  const pending = await topics('?triage=pending');
  assert.deepEqual([pending.total, pending.topics.find((t) => t.id === 'models').count], [1, 1]);
  assert.equal(await list(s, '?triage=all&q=' + encodeURIComponent('快取失效')), 'b');
  // 頂端入口：待決定篇數只算可以篩選的文章。
  const status = await (await s.handler.fetch(request('api/status'), s.env)).json();
  assert.equal(status.triage_pending, 1);
});

test('等待確認回補的書籤按保留就開始整理；按刪除先進最近刪除', async () => {
  const s = setup();
  for (const key of ['1', '2'])
    await s.handler.service.collect(s.env, 'https://example.org/wait-' + key, 'backfill', 'b' + key, {
      defer: true,
      source: { url: 'https://example.org/wait-' + key, relation: 'primary', content: '原文 ' + key, media: [] },
    });
  const [first, second] = (await rows(s.env, 'SELECT id FROM learning_items ORDER BY url')).map((r) => r.id);
  let r = await s.handler.fetch(request('api/items/' + first + '/triage', 'PUT', { action: 'star' }), s.env);
  assert.deepEqual([(await r.json()).status, (await item(s.env, first)).triage], ['queued', 'kept']);
  assert.deepEqual(s.env.LEARNING_JOBS.jobs, [{ kind: 'article', id: first }]);
  r = await s.handler.fetch(request('api/items/' + second + '/triage', 'PUT', { action: 'delete' }), s.env);
  const row = await item(s.env, second);
  assert.deepEqual([row.status, row.triage, row.deleted_from], ['awaiting_backfill', 'deleted', 'pending']);
  assert.equal(s.env.LEARNING_JOBS.jobs.length, 1);
});

test('最近刪除的文章不建立通知，已排入的通知在送出前略過', async () => {
  const s = setup();
  await add(s.env, 'a');
  await add(s.env, 'b');
  await act(s, 'a', 'delete');
  await s.handler.service.flush(s.env);
  const sent = () => s.net.calls.filter((c) => c.url.includes('api.telegram.org'));
  assert.equal(sent().length, 1);
  assert.match(JSON.parse(sent()[0].options.body).text, /文章 b/);
  // b 再出新版本：通知排入後、送出前被刪除。
  await query(
    s.env,
    'UPDATE learning_items SET revision=2,article_json=? WHERE id=?',
    '{"content_fingerprint":"new"}',
    id('b'),
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_deliveries(id,item_ids_json,origin,body,created_at) VALUES('later',?,'update','更新',?)",
    JSON.stringify([{ id: id('b'), revision: 2 }]),
    '2026-10-01T00:00:00Z',
  ).run();
  await act(s, 'b', 'delete');
  await s.handler.service.flush(s.env);
  assert.equal(sent().length, 1);
  assert.equal(
    (await query(s.env, "SELECT status FROM learning_deliveries WHERE id='later'").first()).status,
    'skipped',
  );
});

test('清除刪除超過 7 天的文章：舊版本、追問、媒體、工作與尚未送出的通知一併刪除；每輪有篇數上限', async () => {
  const s = setup();
  const keys = Array.from({ length: 25 }, (_, n) => n.toString(16).padStart(32, 'a'));
  for (const key of keys) await add(s.env, key);
  const target = keys[0];
  await query(
    s.env,
    "INSERT INTO learning_versions(id,item_id,revision,edition,origin,title,body,created_at) VALUES('v1',?,1,'detailed','superseded','舊','舊正文',?)",
    target,
    '2026-10-01',
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_questions(id,item_id,question,answer_json,created_at) VALUES('q1',?,'問題','{}',?)",
    target,
    '2026-10-01',
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_evidence(id,item_id,url,relation,content,fetched_at) VALUES('e1',?,'https://example.org/a','primary','原文','2026-10-01')",
    target,
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_media(id,item_id,evidence_id,url,type,object_key,status,updated_at) VALUES('m1',?,'e1','https://example.org/v.mp4','video','obj-1','ready','2026-10-01')",
    target,
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_media_analyses(id,media_id,item_id,fingerprint,model,prompt_version,analysis_json,created_at) VALUES('an1','m1',?,'f','m','p','{}','2026-10-01')",
    target,
  ).run();
  await s.env.MEDIA.put('obj-1', new Response('bytes').body);
  await query(
    s.env,
    "INSERT INTO learning_jobs(id,kind,item_id,priority,input_version,input_json,created_at,updated_at) VALUES('j1','article',?,1,'v','{}','2026-10-01','2026-10-01')",
    target,
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_deliveries(id,item_ids_json,origin,body,status,created_at) VALUES('d1',?,'update','x','skipped','2026-10-01')",
    JSON.stringify([{ id: target, revision: 1 }]),
  ).run();
  await s.handler.service.flush(s.env);
  for (const key of keys) assert.equal((await act(s, key, 'delete')).status, 200);
  s.clock.now += 8 * DAY;
  await s.handler.scheduled(s.env, { tasks: ['maintenance'] });
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE status='dismissed'")).length, 20);
  await s.handler.scheduled(s.env, { tasks: ['maintenance'] });
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE status='dismissed'")).length, 25);
  const row = await item(s.env, target);
  assert.deepEqual([row.title, row.body, row.article_json, row.note, row.triage], ['', null, null, '', 'pending']);
  for (const table of [
    'learning_versions',
    'learning_questions',
    'learning_evidence',
    'learning_media',
    'learning_media_analyses',
    'learning_intakes',
    'learning_jobs',
  ])
    assert.equal((await rows(s.env, `SELECT * FROM ${table} WHERE item_id=?`, target)).length, 0, table);
  assert.equal(s.env.MEDIA.objects.has('obj-1'), false);
  assert.equal((await rows(s.env, "SELECT * FROM learning_deliveries WHERE id='d1'")).length, 0);
  // 已送出的通知紀錄保留。
  assert.ok((await rows(s.env, "SELECT * FROM learning_deliveries WHERE status='sent'")).length > 0);
});

test('合併文章時保留被併入文章的保留與 ★', async () => {
  const s = setup();
  await add(s.env, 'a');
  await add(s.env, 'b');
  await act(s, 'b', 'star');
  await mergeItems(s.env, id('b'), id('a'));
  const merged = await item(s.env, id('a'));
  assert.deepEqual([merged.triage, merged.starred], ['kept', 1]);
});

test('篩選相關的維護與列表查詢走索引', async () => {
  const s = setup();
  const plan = (sql, ...args) =>
    s.env.DB.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + sql)
      .all(...args)
      .map((r) => r.detail)
      .join(' | ');
  const usesIndex = (detail, name) => assert.match(detail, new RegExp('USING (COVERING )?INDEX ' + name), detail);
  usesIndex(
    plan(
      "SELECT id FROM learning_items WHERE triage='deleted' AND deleted_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY deleted_at LIMIT ?",
      'x',
      'x',
      1,
    ),
    'learning_items_deleted',
  );
  usesIndex(
    plan(
      "SELECT id FROM learning_items WHERE triage='pending' AND triage_deadline<=? ORDER BY triage_deadline LIMIT ?",
      'x',
      1,
    ),
    'learning_items_triage_deadline',
  );
  usesIndex(
    plan(
      "SELECT id FROM learning_items WHERE triage='pending' AND triage_deadline IS NULL AND triage_no_expiry=0 AND status IN (?,?,?) LIMIT ?",
      'ready',
      'partial',
      'awaiting_backfill',
      1,
    ),
    'learning_items_triage_deadline',
  );
  usesIndex(
    plan(
      "SELECT COUNT(*) AS count FROM learning_items WHERE triage='pending' AND status IN (?,?,?)",
      'ready',
      'partial',
      'awaiting_backfill',
    ),
    'learning_items_triage',
  );
  usesIndex(
    plan(
      "SELECT id FROM learning_items WHERE status NOT IN ('dismissed','merged') AND status!='filtered' AND triage='kept' ORDER BY COALESCE(published_at,created_at) DESC,id DESC LIMIT 50",
    ),
    'learning_items_(triage|published)',
  );
});

test('篩選模式只列可以篩選的待決定文章，順序與列表預設相同；待回補文章用保存的原文前 600 字當導讀', async () => {
  const s = setup();
  await add(s.env, 'a', { at: '2026-09-01T00:00:00.000Z' });
  await add(s.env, 'b', { status: 'partial', at: '2026-09-03T00:00:00.000Z' });
  await add(s.env, 'c', { status: 'queued', at: '2026-09-04T00:00:00.000Z' });
  await add(s.env, 'd', { triage: 'kept', at: '2026-09-05T00:00:00.000Z' });
  await add(s.env, 'e', { status: 'filtered', at: '2026-09-06T00:00:00.000Z' });
  await add(s.env, 'f', { at: '2026-09-07T00:00:00.000Z' });
  await act(s, 'f', 'delete');
  await query(s.env, "UPDATE learning_items SET published_at='2026-08-01T00:00:00.000Z' WHERE id=?", id('b')).run();
  await s.handler.service.collect(s.env, 'https://example.org/wait', 'backfill', 'w', {
    defer: true,
    source: { url: 'https://example.org/wait', relation: 'primary', content: '原文'.repeat(400), media: [] },
  });
  const r = await (await s.handler.fetch(request('api/triage'), s.env)).json();
  assert.equal(r.total, 3);
  assert.deepEqual(
    r.items.map((i) => i.status),
    ['awaiting_backfill', 'ready', 'partial'],
  );
  assert.equal(r.items[1].intro, '導讀 a');
  assert.equal(r.items[0].preview.length, 600);
  assert.equal(r.items[1].publisher, 'example.org');
  assert.ok(r.items[0].triage_deadline);
  assert.equal((await s.handler.fetch(request('api/triage?offset=-1'), s.env)).status, 400);
  // 處理中的文章完成後才出現。
  await query(s.env, "UPDATE learning_items SET status='ready' WHERE id=?", id('c')).run();
  assert.equal((await (await s.handler.fetch(request('api/triage'), s.env)).json()).total, 4);
});

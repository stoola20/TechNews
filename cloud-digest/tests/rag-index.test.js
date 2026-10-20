import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query, rows, item } from '../src/learning/store.js';
import { environment, recorder, request, embeddingModel, vectorIndex } from './helpers.js';

const DAY = 86400000;
const id = (n) => n.toString(16).padStart(32, 'a');
// 合成教材：多個 Markdown 段落與標題，長度足以切成數段。
const paragraph = (topic, n) => `${topic}的第 ${n} 段說明。`.repeat(18);
const body = (topic) =>
  [
    '## 背景',
    paragraph(topic, 1),
    paragraph(topic, 2),
    '## 做法',
    paragraph(topic, 3),
    paragraph(topic, 4),
    '## 限制',
    paragraph(topic, 5),
  ].join('\n\n');
function setup({ ai = embeddingModel(), index = vectorIndex() } = {}) {
  const env = environment({ AI: ai, LIBRARY_INDEX: index });
  const clock = { now: Date.parse('2026-10-01T00:00:00Z') };
  const handler = createLearningHandler({ ...recorder(), now: () => clock.now });
  return { env, handler, clock, ai, index };
}
async function add(env, key, { triage = 'kept', text = body('快取'), title = '文章 ' + key } = {}) {
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,kept_at,created_at,updated_at) VALUES(?,?,'web',?,'ready',?,'{}',1,?,?,'2026-10-01','2026-10-01')",
    key,
    'https://example.org/' + key,
    title,
    text,
    triage,
    triage === 'kept' ? '2026-10-01T00:00:00Z' : null,
  ).run();
}
const maintain = (s) => s.handler.scheduled(s.env, { tasks: ['maintenance'] });
const vectorsOf = (s, key) => [...s.index.vectors.keys()].filter((v) => v.startsWith(key + ':'));

test('保留文章由維護排程建立索引：教材正文、原始來源與媒體解析分別切塊，向量取前 512 維並正規化', async () => {
  const s = setup();
  const key = id(1);
  await add(s.env, key);
  await query(
    s.env,
    "INSERT INTO learning_evidence(id,item_id,url,relation,content,status,fetched_at) VALUES('src1',?,'https://example.org/src','primary',?,'available','2026-10-01')",
    key,
    Array.from(
      { length: 4 },
      (_, n) => 'Cache invalidation paragraph ' + n + '. '.repeat(1) + 'detail '.repeat(150),
    ).join('\n\n'),
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_evidence(id,item_id,url,relation,content,status,fetched_at) VALUES('note1',?,'https://x.com/i/status/9','author_reply','作者補充不收錄','available','2026-10-01')",
    key,
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_media(id,item_id,evidence_id,url,type,status,updated_at) VALUES('m1',?,'src1','https://example.org/v.mp4','video','ready','2026-10-01')",
    key,
  ).run();
  await query(
    s.env,
    "INSERT INTO learning_media_analyses(id,media_id,item_id,fingerprint,model,prompt_version,analysis_json,created_at) VALUES('an1','m1',?,'f','m','p',?,'2026-10-01')",
    key,
    JSON.stringify({
      coverage: { summary: '示範快取設定' },
      ocr: { text: 'CACHE_TTL=60' },
      speech: { segments: [] },
      visual: [],
    }),
  ).run();
  await query(s.env, "UPDATE learning_items SET note='筆記不收錄' WHERE id=?", key).run();
  await maintain(s);
  const chunks = await rows(s.env, 'SELECT * FROM learning_chunks WHERE item_id=? ORDER BY id', key);
  const kinds = Object.groupBy(chunks, (c) => c.kind);
  assert.ok(kinds.body.length >= 2);
  assert.ok(kinds.source.length >= 1);
  assert.equal(kinds.media.length, 1);
  assert.ok(kinds.body.every((c) => c.length <= 1000 + 200));
  assert.ok(kinds.source.every((c) => c.length <= 1500));
  assert.ok(chunks.every((c) => c.ref_id !== 'note1'));
  assert.equal(vectorsOf(s, key).length, chunks.length);
  const vector = s.index.vectors.get(chunks[0].id);
  assert.equal(vector.length, 512);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-9);
  const sent = s.ai.calls.flatMap((c) => c.input.text);
  assert.ok(sent.every((t) => t.startsWith('title: 文章 ' + key + ' | text: ')));
  assert.ok(!sent.some((t) => t.includes('筆記不收錄') || t.includes('作者補充不收錄')));
  const row = await item(s.env, key);
  assert.deepEqual([row.index_revision, row.indexed, row.index_error], [1, 1, null]);
  // 片段文字依起點與長度從原文取出。
  const first = kinds.body[0];
  assert.match(row.body.substr(first.start, first.length), /^## 背景/);
});

test('內容更新後重建並刪除舊向量；取消保留與刪除後移出索引；待決定文章不進索引', async () => {
  const s = setup();
  const [a, b, c] = [id(1), id(2), id(3)];
  await add(s.env, a);
  await add(s.env, b);
  await add(s.env, c, { triage: 'pending' });
  await maintain(s);
  const before = vectorsOf(s, a);
  assert.ok(before.length > 0);
  assert.equal(vectorsOf(s, c).length, 0);
  await query(s.env, 'UPDATE learning_items SET revision=2,body=? WHERE id=?', body('重試') + '\n\n短結尾', a).run();
  await maintain(s);
  const after = vectorsOf(s, a);
  assert.ok(after.every((v) => v.startsWith(a + ':2:')));
  assert.ok(before.every((v) => !s.index.vectors.has(v)));
  assert.equal((await rows(s.env, 'SELECT * FROM learning_chunks WHERE item_id=? AND revision=1', a)).length, 0);
  await s.handler.fetch(request('api/items/' + a + '/triage', 'PUT', { action: 'pending' }), s.env);
  await s.handler.fetch(request('api/items/' + b + '/triage', 'PUT', { action: 'delete' }), s.env);
  await maintain(s);
  assert.equal(vectorsOf(s, a).length + vectorsOf(s, b).length, 0);
  assert.equal((await rows(s.env, 'SELECT * FROM learning_chunks')).length, 0);
  assert.deepEqual([(await item(s.env, a)).indexed, (await item(s.env, a)).index_revision], [0, null]);
  // 重新保留後再建立。
  await s.handler.fetch(request('api/items/' + a + '/triage', 'PUT', { action: 'keep' }), s.env);
  await maintain(s);
  assert.ok(vectorsOf(s, a).length > 0);
});

test('每輪最多建立 3 篇；失敗累計並延後重試，連續 5 次後停止，直到內容更新或手動重建', async () => {
  let down = false;
  const s = setup({ ai: embeddingModel({ fail: () => down }) });
  for (let n = 1; n <= 5; n++) await add(s.env, id(n));
  await maintain(s);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_items WHERE indexed=1')).length, 3);
  await maintain(s);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_items WHERE indexed=1')).length, 5);
  const key = id(6);
  await add(s.env, key);
  down = true;
  for (let attempt = 1; attempt <= 5; attempt++) {
    s.clock.now += 3 * DAY;
    await maintain(s);
    assert.equal((await item(s.env, key)).index_attempts, attempt);
  }
  const stopped = await item(s.env, key);
  assert.equal(stopped.index_next_at, null);
  assert.match(stopped.index_error, /Workers AI/);
  const status = await (await s.handler.fetch(request('api/admin/index'), s.env)).json();
  assert.deepEqual([status.kept, status.indexed, status.failed, status.waiting], [6, 5, 1, 0]);
  down = false;
  s.clock.now += 3 * DAY;
  await maintain(s);
  assert.equal((await item(s.env, key)).indexed, 0, '停止後不再自動重試');
  const rebuilt = await (await s.handler.fetch(request('api/admin/index/rebuild', 'POST', {}), s.env)).json();
  assert.equal(rebuilt.queued, 6);
  await maintain(s);
  await maintain(s);
  const done = await (await s.handler.fetch(request('api/admin/index'), s.env)).json();
  assert.deepEqual([done.indexed, done.failed, done.waiting], [6, 0, 0]);
  assert.equal(done.stored_dimensions, done.chunks * 512);
  assert.equal(done.free_stored_dimensions, 5000000);
  // 內容更新也會讓停止的文章恢復。
  down = true;
  await query(s.env, 'UPDATE learning_items SET revision=2 WHERE id=?', key).run();
  for (let attempt = 1; attempt <= 5; attempt++) {
    s.clock.now += 3 * DAY;
    await maintain(s);
  }
  down = false;
  await query(s.env, 'UPDATE learning_items SET revision=3 WHERE id=?', key).run();
  await maintain(s);
  assert.equal((await item(s.env, key)).index_revision, 3);
});

test('沒有設定 Vectorize 時略過索引；向量還沒移出前不清除文章', async () => {
  const s = setup();
  const key = id(1);
  await add(s.env, key);
  const env = { ...s.env, LIBRARY_INDEX: undefined };
  await s.handler.scheduled(env, { tasks: ['maintenance'] });
  assert.equal((await item(s.env, key)).indexed, 0);
  assert.equal((await (await s.handler.fetch(request('api/admin/index'), env)).json()).configured, false);
  await maintain(s);
  await s.handler.fetch(request('api/items/' + key + '/triage', 'PUT', { action: 'delete' }), s.env);
  s.clock.now += 8 * DAY;
  // Vectorize 暫時無法刪除：文章留在最近刪除，下一輪再試。
  await s.handler.scheduled({ ...s.env, LIBRARY_INDEX: vectorIndex({ fail: () => true }) }, { tasks: ['maintenance'] });
  assert.equal((await item(s.env, key)).triage, 'deleted');
  await maintain(s);
  await maintain(s);
  assert.equal((await item(s.env, key)).status, 'dismissed');
  assert.equal(vectorsOf(s, key).length, 0);
});

test('索引維護的查詢走索引', async () => {
  const s = setup();
  const plan = (sql, ...args) =>
    s.env.DB.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + sql)
      .all(...args)
      .map((r) => r.detail)
      .join(' | ');
  assert.match(
    plan("SELECT id FROM learning_items WHERE indexed=1 AND triage!='kept' LIMIT ?", 1),
    /USING (COVERING )?INDEX learning_items_indexed/,
  );
  assert.match(
    plan(
      "SELECT id FROM learning_items WHERE triage='kept' AND status IN ('ready','partial') AND (index_revision IS NULL OR index_revision!=revision) ORDER BY kept_at LIMIT 3",
    ),
    /USING (COVERING )?INDEX learning_items_(triage|kept_at)/,
  );
  assert.match(
    plan('SELECT id FROM learning_chunks WHERE item_id=?', 'x'),
    /USING (COVERING )?INDEX learning_chunks_item/,
  );
});

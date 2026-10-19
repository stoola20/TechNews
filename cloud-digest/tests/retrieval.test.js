import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { setTextProvider, claim } from '../src/learning/local.js';
import { query } from '../src/learning/store.js';
import { search, fuse } from '../src/learning/retrieval.js';
import { environment, recorder, request, embeddingModel, vectorIndex } from './helpers.js';

const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));
// 合成文章：中文教材正文加上英文原始來源。
async function add(env, id, { triage = 'kept', body, source, title = '文章 ' + id[0] }) {
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,kept_at,created_at,updated_at) VALUES(?,?,'web',?,'ready',?,'{}',1,?,?,'2026-10-01','2026-10-01')",
    id,
    'https://example.org/' + id[0],
    title,
    body,
    triage,
    triage === 'kept' ? '2026-10-01' : null,
  ).run();
  await query(
    env,
    "INSERT INTO learning_evidence(id,item_id,url,relation,content,status,fetched_at) VALUES(?,?,?,'primary',?,'available','2026-10-01')",
    'e' + id[0],
    id,
    'https://example.org/' + id[0],
    source,
  ).run();
}
async function setup({ down = () => false } = {}) {
  const ai = embeddingModel({ fail: down }),
    env = environment({ AI: ai, LIBRARY_INDEX: vectorIndex() }),
    handler = createLearningHandler({
      ...recorder(),
      now: () => Date.parse('2026-10-01T00:00:00Z'),
      generate: async (env, chunks) => ({ answer: '依來源回答。', citations: [chunks[0].id], insufficient: false }),
    });
  await add(env, A, {
    title: '快取失效策略',
    body: '## 快取\n\n' + '快取失效時要重新讀取資料，期限依更新頻率設定。'.repeat(8),
    source: Array.from({ length: 6 }, (_, n) =>
      `Cache invalidation part ${n}. When the cache expires, the next request reads from the origin. `.repeat(6),
    ).join('\n\n'),
  });
  await add(env, B, {
    title: '重試與退避',
    body: '## 重試\n\n' + '失敗後用指數退避重試。'.repeat(8),
    source: 'Set RATE_LIMIT=100 for gpt-4.1 deployments. Retries use exponential backoff.',
  });
  await add(env, C, { triage: 'pending', body: '待決定的快取筆記。', source: '待決定文章也談到快取與 RATE_LIMIT。' });
  await add(env, D, { triage: 'deleted', body: '刪除的快取文章。', source: '最近刪除的快取與 RATE_LIMIT。' });
  await handler.scheduled(env, { tasks: ['maintenance'] });
  return { env, handler, ai };
}

test('用中文問也找得到英文原文；保留文章的片段標示 kept，不含待決定與最近刪除', async () => {
  const s = await setup();
  const r = await search(s.env, { query: '快取什麼時候失效？' });
  assert.equal(r.degraded, false);
  assert.equal(r.chunks[0].item_id, A);
  assert.ok(r.chunks.some((c) => c.item_id === A && c.relation === 'primary' && /Cache invalidation/.test(c.content)));
  assert.ok(r.chunks.every((c) => c.kept === true && [A, B].includes(c.item_id)));
  // 每篇最多 3 段。
  assert.ok(r.chunks.filter((c) => c.item_id === A).length <= 3);
  // 片段格式沿用追問：id、文章、網址、關係、起點與內容。
  const source = r.chunks.find((c) => c.relation === 'primary');
  assert.match(source.id, /^ea:\d+$/);
  assert.equal(typeof source.range_start, 'number');
});

test('API 名稱與版本號這類精確詞用關鍵字找得到；兩份排名都有的片段排在前面', async () => {
  const s = await setup();
  const exact = await search(s.env, { query: 'gpt-4.1 的 RATE_LIMIT 預設值' });
  assert.equal(exact.chunks[0].item_id, B);
  assert.match(exact.chunks[0].content, /RATE_LIMIT=100/);
  // RRF：同時被語意與關鍵字找到的片段分數相加。
  const merged = fuse([
    [
      { key: 'x', item_id: 'p' },
      { key: 'y', item_id: 'q' },
    ],
    [
      { key: 'y', item_id: 'q' },
      { key: 'z', item_id: 'r' },
    ],
  ]);
  assert.deepEqual(
    merged.map((u) => u.key),
    ['y', 'x', 'z'],
  );
  assert.ok(Math.abs(merged[0].rrf - (1 / 12 + 1 / 11)) < 1e-12);
  const capped = fuse([Array.from({ length: 20 }, (_, n) => ({ key: 'k' + n, item_id: 'i' + (n % 5) }))], {
    limit: 12,
  });
  assert.equal(capped.length, 12);
  assert.ok(Object.values(Object.groupBy(capped, (u) => u.item_id)).every((list) => list.length <= 3));
});

test('範圍 all 用關鍵字補上待決定文章並排在保留之後；語意檢索失敗時退回關鍵字並標示降級', async () => {
  const s = await setup();
  const all = await search(s.env, { query: 'RATE_LIMIT', scope: 'all' });
  const kinds = all.chunks.map((c) => c.kept);
  assert.ok(kinds.includes(true) && kinds.includes(false));
  assert.equal(kinds.indexOf(false), kinds.lastIndexOf(true) + 1);
  assert.ok(all.chunks.filter((c) => !c.kept).every((c) => c.item_id === C));
  assert.ok(!all.chunks.some((c) => c.item_id === D));
  const down = await setup({ down: (input) => !Array.isArray(input.text) || input.text[0].startsWith('task:') });
  const degraded = await search(down.env, { query: 'RATE_LIMIT' });
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.chunks[0].item_id, B);
  const vectorDown = await setup();
  vectorDown.env.LIBRARY_INDEX.query = async () => {
    throw new Error('Vectorize query failed');
  };
  assert.equal((await search(vectorDown.env, { query: 'RATE_LIMIT' })).degraded, true);
});

test('全庫追問：預設只查保留、可勾「也查未保留」；出處標示保留與否，降級時回報；本機工作的輸入沿用同一份片段', async () => {
  const s = await setup();
  const kept = await (
    await s.handler.fetch(request('api/ask', 'POST', { question: 'RATE_LIMIT 是多少' }), s.env)
  ).json();
  assert.equal(kept.degraded, false);
  assert.equal(kept.include_unkept, false);
  assert.ok(kept.sources.every((x) => x.kept === true));
  await setTextProvider(s.env, 'local');
  const asked = await (
    await s.handler.fetch(request('api/ask', 'POST', { question: 'RATE_LIMIT 是多少', include_unkept: true }), s.env)
  ).json();
  assert.equal(asked.status, 'waiting_local');
  assert.equal(asked.include_unkept, true);
  const job = await claim(s.env, 'mac');
  assert.ok(job.input.chunks.some((c) => c.kept === false && c.item_id === C));
  assert.ok(job.input.chunks.some((c) => c.kept === true));
  // 單篇追問不受篩選結果影響。
  await setTextProvider(s.env, 'gemini');
  const single = await (
    await s.handler.fetch(request('api/ask', 'POST', { question: 'RATE_LIMIT', item_id: C }), s.env)
  ).json();
  assert.equal(single.sources[0].item_id, C);
});

test('篩選卡片的相似文章：只回保留文章、排除本篇、達門檻才列；只查詢不寫入索引；降級時回空清單', async () => {
  const s = await setup();
  const P = 'e'.repeat(32);
  await add(s.env, P, { triage: 'pending', title: '快取', body: '待決定。', source: '待決定。' });
  await query(
    s.env,
    'UPDATE learning_items SET article_json=? WHERE id=?',
    JSON.stringify({ intro: '快取 cache 快取失效' }),
    P,
  ).run();
  const upserts = () => s.env.LIBRARY_INDEX.calls.filter((c) => c.op === 'upsert').length;
  const before = upserts();
  const r = await (await s.handler.fetch(request('api/items/' + P + '/similar'), s.env)).json();
  assert.equal(r.degraded, false);
  assert.deepEqual(
    r.items.map((i) => i.id),
    [A],
  );
  assert.equal(r.items[0].title, '快取失效策略');
  assert.equal(r.items[0].publisher, 'example.org');
  assert.ok(r.items[0].score >= 0.55);
  assert.equal(upserts(), before);
  // 保留文章查相似時排除自己。
  const self = await (await s.handler.fetch(request('api/items/' + A + '/similar'), s.env)).json();
  assert.ok(!self.items.some((i) => i.id === A));
  const down = await setup({ down: (input) => input.text[0].startsWith('task:') });
  const degraded = await (await down.handler.fetch(request('api/items/' + C + '/similar'), down.env)).json();
  assert.deepEqual(degraded, { degraded: true, items: [] });
});

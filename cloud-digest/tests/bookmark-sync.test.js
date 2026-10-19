import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { startFullScan, failureDetail } from '../src/learning/x.js';
import { saveConnection, setting, setSetting, query, rows, item } from '../src/learning/store.js';
import { environment, recorder, request, iso, message, enableXReads } from './helpers.js';

const post = (id) => ({
  id: String(id),
  text: '收藏 ' + id,
  author_id: '9',
  conversation_id: String(id),
  created_at: '2026-10-01T00:00:00Z',
});
// 三頁書籤：第二頁不足 100 筆但仍有 next_token；第一頁包含已知 ID。
function bookmarks() {
  const pages = {
    '': { data: Array.from({ length: 100 }, (_, i) => post(5000 - i)), meta: { next_token: 'p2' } },
    p2: { data: Array.from({ length: 40 }, (_, i) => post(4000 - i)), meta: { next_token: 'p3' } },
    p3: { data: Array.from({ length: 20 }, (_, i) => post(3000 - i)), meta: {} },
  };
  const calls = [];
  let fail = null;
  const net = recorder(async (url) => {
    if (url.hostname === 'api.x.com' && url.pathname.endsWith('/bookmarks')) {
      const token = url.searchParams.get('pagination_token') || '';
      calls.push({ token, max: url.searchParams.get('max_results') });
      if (fail) {
        const status = fail(token);
        if (status) return new Response('{}', { status });
      }
      return Response.json(pages[token]);
    }
    return null;
  });
  return {
    pages,
    calls,
    net,
    setFail(f) {
      fail = f;
    },
  };
}
async function setup(extra = {}, { xReads = true } = {}) {
  const env = environment(extra),
    x = bookmarks(),
    handler = createLearningHandler(x.net);
  if (xReads) await enableXReads(env);
  await saveConnection(env, 'x', {
    user_id: '7',
    access_token: 'a',
    refresh_token: 'r',
    expires_at: Date.now() + 86400000,
  });
  return { env, x, handler };
}
async function fullScan(s) {
  let state;
  do {
    state = await s.handler.service.sync(s.env, 'full');
  } while (state.running && !state.rate_limited && !state.busy);
  return state;
}

test('首次基線完成前局部檢查不處理收藏；完整核對逐頁到最後，舊 ID 與短頁都不會提早結束', async () => {
  const s = await setup();
  const skipped = await s.handler.service.sync(s.env, 'partial');
  assert.equal(skipped.skipped, 'baseline_incomplete');
  assert.equal(s.x.calls.length, 0);
  await startFullScan(s.env);
  const done = await fullScan(s);
  assert.equal(done.baseline_complete, true);
  assert.ok(done.last_full_completed_at);
  assert.deepEqual(
    s.x.calls.map((c) => c.token),
    ['', 'p2', 'p3'],
  );
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE status='awaiting_backfill'")).length, 160);
  // 局部檢查沒有把完整核對標成成功，也沒有動到完整核對的狀態。
  assert.equal((await setting(s.env, 'sync-partial')).last_completed_at, undefined);
});

test('十分鐘局部檢查只讀最前一頁、找到新收藏；新收藏的舊貼文等每日完整核對才發現', async () => {
  const s = await setup();
  await startFullScan(s.env);
  await fullScan(s);
  const fullBefore = await setting(s.env, 'sync');
  s.x.pages[''].data.unshift(post(9999));
  s.x.pages.p3.data.push(post(1));
  s.x.calls.length = 0;
  const partial = await s.handler.service.sync(s.env, 'partial');
  assert.deepEqual(s.x.calls, [{ token: '', max: '100' }]);
  assert.equal(partial.added, 1);
  assert.ok(partial.last_completed_at);
  assert.match(partial.scope, /最前 1 頁/);
  const fresh = (
    await rows(
      s.env,
      "SELECT i.status,k.origin FROM learning_items i JOIN learning_intakes k ON k.item_id=i.id WHERE i.url='https://x.com/i/status/9999'",
    )
  )[0];
  assert.deepEqual({ ...fresh }, { status: 'queued', origin: 'bookmark' });
  // 舊收藏仍等待確認，局部檢查不會啟動整批回補。
  assert.equal(
    (
      await item(
        s.env,
        (await query(s.env, "SELECT id FROM learning_items WHERE url='https://x.com/i/status/5000'").first()).id,
      )
    ).status,
    'awaiting_backfill',
  );
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE url='https://x.com/i/status/1'")).length, 0);
  assert.deepEqual((await setting(s.env, 'sync')).last_full_completed_at, fullBefore.last_full_completed_at);
  await startFullScan(s.env);
  await fullScan(s);
  assert.equal((await rows(s.env, "SELECT id FROM learning_items WHERE url='https://x.com/i/status/1'")).length, 1);
  // 頁數是可調整的操作設定。
  const wide = await setup({ X_PARTIAL_PAGES: '2' });
  await startFullScan(wide.env);
  await fullScan(wide);
  wide.x.calls.length = 0;
  await wide.handler.service.sync(wide.env, 'partial');
  assert.deepEqual(
    wide.x.calls.map((c) => c.token),
    ['', 'p2'],
  );
});

test('重疊排程共用在途掃描：完整核對不重新開始，局部檢查在完整核對進行中略過', async () => {
  const s = await setup();
  await startFullScan(s.env);
  await s.handler.service.sync(s.env, 'full');
  const cursor = (await setting(s.env, 'sync')).cursor;
  assert.ok(cursor === null || typeof cursor === 'string');
  await setSetting(s.env, 'sync', {
    ...(await setting(s.env, 'sync')),
    running: true,
    cursor: 'p3',
    baseline_complete: true,
  });
  assert.equal((await startFullScan(s.env)).reused, true);
  assert.equal((await setting(s.env, 'sync')).cursor, 'p3');
  await query(
    s.env,
    "INSERT OR REPLACE INTO settings(key,value_json,updated_at) VALUES('learning:sync-lock',?,?)",
    JSON.stringify({ id: 'other', until: iso(60000) }),
    iso(0),
  ).run();
  s.x.calls.length = 0;
  assert.equal((await s.handler.service.sync(s.env, 'partial')).skipped, 'full_scan_running');
  assert.equal((await s.handler.service.sync(s.env, 'full')).busy, true);
  assert.equal(s.x.calls.length, 0);
});

test('限流、游標失效、授權失效與費用暫停都保存可恢復狀態，不會悄悄改成沒有新收藏', async () => {
  const s = await setup();
  await startFullScan(s.env);
  s.x.setFail((token) => (token === 'p2' ? 429 : 0));
  await assert.rejects(fullScan(s));
  let state = await setting(s.env, 'sync');
  assert.equal(state.cursor, 'p2');
  assert.equal(state.running, true);
  assert.ok(state.retry_after);
  assert.match(state.last_error, /限流/);
  s.x.calls.length = 0;
  assert.equal((await s.handler.service.sync(s.env, 'full')).rate_limited, true);
  assert.equal(s.x.calls.length, 0);
  await setSetting(s.env, 'sync', { ...state, retry_after: iso(-1000) });
  s.x.setFail(null);
  state = await fullScan(s);
  assert.equal(state.baseline_complete, true);
  assert.equal(s.x.calls[0].token, 'p2');

  await setSetting(s.env, 'sync', { ...state, running: true, cursor: 'expired' });
  s.x.setFail((token) => (token === 'expired' ? 400 : 0));
  await assert.rejects(s.handler.service.sync(s.env, 'full'));
  state = await setting(s.env, 'sync');
  assert.equal(state.cursor, null);
  assert.match(state.last_error, /分頁請求失效/);
  assert.equal(state.requires_action, undefined);

  s.x.setFail(() => 401);
  await assert.rejects(s.handler.service.sync(s.env, 'partial'));
  assert.equal((await setting(s.env, 'sync')).requires_action, true);
  assert.equal((await s.handler.service.sync(s.env, 'partial')).requires_action, true);

  const budget = await setup({ LEARNING_MONTHLY_USD: '0.0001' });
  await setSetting(budget.env, 'sync', { baseline_complete: true, running: false, cursor: null });
  const paused = await budget.handler.service.sync(budget.env, 'partial');
  assert.match(paused.last_error, /費用暫停/);
  assert.equal(paused.last_completed_at, undefined);
});

test('排程任務：每十分鐘排入局部檢查，08:00 開始完整核對；狀態 API 分開顯示兩者', async () => {
  const s = await setup();
  await setSetting(s.env, 'sync', {
    baseline_complete: true,
    running: false,
    cursor: null,
    last_full_completed_at: '2026-10-15T00:10:00.000Z',
  });
  await s.handler.scheduled(s.env, { tasks: ['bookmark_partial'] });
  assert.deepEqual(s.env.LEARNING_JOBS.jobs, [{ kind: 'sync', scope: 'partial' }]);
  s.env.LEARNING_JOBS.jobs.length = 0;
  await s.handler.scheduled(s.env, { tasks: ['bookmark_daily'] });
  assert.deepEqual(s.env.LEARNING_JOBS.jobs[0], { kind: 'sync', scope: 'full' });
  assert.equal((await setting(s.env, 'sync')).running, true);
  const status = await (await s.handler.fetch(request('api/status'), s.env)).json();
  assert.equal(status.sync.last_full_completed_at, '2026-10-15T00:10:00.000Z');
  assert.ok('sync_partial' in status);
});

test('X 讀取開關預設關閉：排程、續跑、手動同步都不讀 X，也不重排已完成的推文；管理頁打開後恢復', async () => {
  const s = await setup({}, { xReads: false });
  await setSetting(s.env, 'sync', { baseline_complete: true, running: true, cursor: 'p2' });
  await query(
    s.env,
    "INSERT INTO learning_items(id,url,kind,status,revision,recheck_at,rechecked,created_at,updated_at) VALUES('x1','https://x.com/a/status/1','x','ready',1,'2020-01-01',0,?,?)",
    iso(0),
    iso(0),
  ).run();
  await s.handler.scheduled(s.env, { tasks: ['bookmark_partial', 'bookmark_daily', 'author_recheck', 'maintenance'] });
  assert.deepEqual(s.env.LEARNING_JOBS.jobs, []);
  assert.equal((await item(s.env, 'x1')).status, 'ready');
  assert.equal((await item(s.env, 'x1')).rechecked, 0);
  assert.deepEqual(await s.handler.service.sync(s.env, 'partial'), { disabled: true });
  assert.deepEqual(await (await s.handler.fetch(request('api/x/sync', 'POST', {}), s.env)).json(), { disabled: true });
  assert.equal(s.x.calls.length, 0);
  assert.deepEqual((await (await s.handler.fetch(request('api/status'), s.env)).json()).x_reads, {
    bookmarks: false,
    author_recheck: false,
  });

  // 管理頁分別切換；只打開書籤同步時，作者重查仍不執行。
  assert.equal((await s.handler.fetch(request('api/admin/x-reads', 'PUT', { bookmarks: 'yes' }), s.env)).status, 400);
  assert.deepEqual(
    await (await s.handler.fetch(request('api/admin/x-reads', 'PUT', { bookmarks: true }), s.env)).json(),
    { bookmarks: true, author_recheck: false },
  );
  await s.handler.scheduled(s.env, { tasks: ['bookmark_partial', 'author_recheck'] });
  // 局部檢查之外，先前保存游標的完整核對也恢復續跑。
  assert.deepEqual(s.env.LEARNING_JOBS.jobs, [{ kind: 'sync', scope: 'partial' }, { kind: 'sync' }]);
  assert.equal((await item(s.env, 'x1')).status, 'ready');
  await s.handler.fetch(request('api/admin/x-reads', 'PUT', { author_recheck: true }), s.env);
  await s.handler.scheduled(s.env, { tasks: ['author_recheck'] });
  assert.equal((await item(s.env, 'x1')).status, 'queued');
  assert.deepEqual((await (await s.handler.fetch(request('api/status'), s.env)).json()).x_reads, {
    bookmarks: true,
    author_recheck: true,
  });
});

test('同步失敗時保存並記錄狀態碼、錯誤類型與出錯階段，log 不含 token、帳號 ID 或貼文內容', async (t) => {
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(line));
  const s = await setup();
  await saveConnection(s.env, 'x', {
    user_id: '1234567890123',
    access_token: 'synthetic-access-token',
    refresh_token: 'synthetic-refresh-token',
    expires_at: Date.now() + 86400000,
  });
  // X 回 400／401／403／429 以外的狀態：保留原本的一般錯誤訊息，但狀態碼與階段要查得到。
  await startFullScan(s.env);
  s.x.setFail(() => 402);
  await assert.rejects(s.handler.service.sync(s.env, 'full'));
  let state = await setting(s.env, 'sync');
  assert.match(state.last_error, /X 同步未完成/);
  assert.equal(state.requires_action, undefined);
  assert.deepEqual(
    { ...state.last_failure, at: undefined },
    { stage: 'x_read', status: 402, name: 'Error', message: '外部服務 HTTP 402', at: undefined },
  );

  // 存書籤時資料庫丟出例外：經由佇列執行，log 帶出階段與訊息，局部檢查狀態也記下來。
  await setSetting(s.env, 'sync', { ...state, baseline_complete: true, running: false, cursor: null });
  s.x.setFail(null);
  s.env.DB.sqlite.exec(
    "CREATE TRIGGER synthetic_failure BEFORE INSERT ON learning_evidence BEGIN SELECT RAISE(ABORT,'合成的寫入失敗'); END",
  );
  const job = message({ kind: 'sync', scope: 'partial' });
  await s.handler.service.queue({ messages: [job] }, s.env);
  assert.equal(job.retries, 1);
  const partial = await setting(s.env, 'sync-partial');
  assert.match(partial.last_error, /局部檢查未完成/);
  assert.equal(partial.last_failure.stage, 'collect');
  assert.equal(partial.last_failure.status, null);
  assert.match(partial.last_failure.message, /合成的寫入失敗/);
  const failed = logs.map((line) => JSON.parse(line)).find((e) => e.event === 'learning_task_failed');
  assert.deepEqual(
    { kind: failed.kind, scope: failed.scope, error: failed.error, stage: failed.stage },
    { kind: 'sync', scope: 'partial', error: 'processing_failed', stage: 'collect' },
  );
  assert.match(failed.message, /合成的寫入失敗/);
  assert.ok(logs.some((line) => JSON.parse(line).event === 'bookmark_sync_failed'));
  const joined = logs.join('\n');
  for (const secret of ['synthetic-access-token', 'synthetic-refresh-token', '1234567890123', '收藏 '])
    assert.equal(joined.includes(secret), false, secret);

  // 下一次成功就清掉失敗紀錄。
  s.env.DB.sqlite.exec('DROP TRIGGER synthetic_failure');
  state = await s.handler.service.sync(s.env, 'partial');
  assert.ok(state.last_completed_at);
  assert.equal(state.last_error, null);
  assert.equal(state.last_failure, null);

  // 解析錯誤的訊息可能夾帶原文，不記錄；長串數字遮掉。
  assert.equal(
    failureDetail(new SyntaxError('Unexpected token, "原文片段" is not valid JSON'), 'x_read').message,
    '回應解析失敗（原文不記錄）',
  );
  assert.equal(failureDetail(new Error('找不到 1234567890123'), 'collect').message, '找不到 …');
});

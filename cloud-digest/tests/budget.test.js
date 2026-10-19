import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { xRead } from '../src/learning/x.js';
import { setTextProvider, claim } from '../src/learning/local.js';
import { migrateLibrary } from '../src/learning/library.js';
import { budget, reserve, setting, saveConnection, query, rows, item, saveEvidence } from '../src/learning/store.js';
import { environment, recorder, request, message, database } from './helpers.js';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import { ADMIN_PAGE } from '../src/learning/admin-page.js';

const posts = Array.from({ length: 100 }, (_, i) => ({ id: String(1000 + i), text: 'post ' + i, author_id: '9' }));
function xNetwork() {
  return recorder(async (url) => {
    if (url.hostname === 'api.x.com' && /\/bookmarks$/.test(url.pathname))
      return Response.json({ data: posts, meta: {} });
    if (url.hostname === 'api.x.com' && /^\/2\/tweets\/\d+$/.test(url.pathname))
      return Response.json({ data: { id: url.pathname.split('/').at(-1), text: 'x' } });
    return null;
  });
}
async function connect(env) {
  await saveConnection(env, 'x', {
    user_id: '7',
    access_token: 'x-access',
    refresh_token: 'x-refresh',
    expires_at: Date.now() + 86400000 * 90,
  });
}
// 在 linkedom 裡執行管理頁腳本：API 請求交給同一個 handler，等畫面載入完成後回傳 document。
async function adminPage(handler, env) {
  const { document } = parseHTML(ADMIN_PAGE);
  const fetch = async (path, options = {}) =>
    handler.fetch(
      new Request('https://learning.example.org' + path, {
        ...options,
        headers: { ...options.headers, authorization: 'Bearer private-test-token' },
      }),
      env,
    );
  vm.runInContext(
    ADMIN_PAGE.match(/<script>([\s\S]*)<\/script>/)[1],
    vm.createContext({
      document,
      fetch,
      location: { assign() {} },
      history: { replaceState() {} },
      console,
      setTimeout,
      clearTimeout,
      URL,
    }),
  );
  for (let i = 0; i < 200 && document.getElementById('app').classList.contains('hidden'); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(
    !document.getElementById('app').classList.contains('hidden'),
    document.getElementById('feedback').textContent,
  );
  return document;
}
const shown = (doc, id) => !doc.getElementById(id).classList.contains('hidden');
const costs = async (env) =>
  (await rows(env, 'SELECT month,category,amount_micro,status,usage_json FROM learning_costs ORDER BY created_at')).map(
    (r) => ({ ...r, usage: JSON.parse(r.usage_json) }),
  );

test('X 重讀依 UTC 日辨識：同日重讀記 $0、不再估算重讀風險，跨 UTC 日重新計首次讀取，月份依台灣時間', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T23:30:00Z') });
  t.after(() => mock.timers.reset());
  const env = environment(),
    net = xNetwork();
  await connect(env);
  await xRead(env, '/users/7/bookmarks', {}, 100, true, net.fetcher);
  let list = await costs(env);
  assert.equal(list[0].month, '2026-11');
  assert.equal(list[0].status, 'settled');
  assert.equal(list[0].amount_micro, 100 * 1000);
  assert.equal(list[0].usage.owned, true);
  assert.equal(list[0].usage.pricing_checked_at, '2026-10-16');
  // 十分鐘後重讀同一頁：同一 UTC 日不再計費，也不另記未確認的重讀風險。
  mock.timers.setTime(Date.parse('2026-10-31T23:40:00Z'));
  for (let i = 0; i < 3; i++) await xRead(env, '/users/7/bookmarks', {}, 100, true, net.fetcher);
  list = await costs(env);
  assert.deepEqual(
    list.slice(1).map((c) => [c.category, c.status, c.amount_micro]),
    [
      ['x', 'settled', 0],
      ['x', 'settled', 0],
      ['x', 'settled', 0],
    ],
  );
  assert.equal(list[1].usage.rereads, 100);
  // UTC 午夜後同一批資源重新計費，但仍屬台灣 11 月。
  mock.timers.setTime(Date.parse('2026-11-01T00:30:00Z'));
  const before = (await costs(env)).length;
  await xRead(env, '/users/7/bookmarks', {}, 100, true, net.fetcher);
  const fresh = (await costs(env)).slice(before);
  assert.deepEqual(
    fresh.map((c) => [c.month, c.amount_micro]),
    [['2026-11', 100000]],
  );
});

test('X 回錯誤記 $0 並列在失敗呼叫明細；沒收到回應或收到後處理失敗記為未確認', async () => {
  const env = environment();
  await connect(env);
  const handler = createLearningHandler(recorder());
  const reply = (make) => async () => make();
  for (const [status, path, context] of [
    [429, '/users/7/bookmarks', 'sync_partial'],
    [503, '/tweets/42', 'post'],
    [401, '/users/9', 'author_profile'],
  ])
    await assert.rejects(
      xRead(
        env,
        path,
        {},
        100,
        false,
        reply(() => new Response('{}', { status })),
        null,
        context,
      ),
      { status },
    );
  await assert.rejects(
    xRead(
      env,
      '/tweets/43',
      {},
      1,
      false,
      reply(() => {
        throw new Error('The operation timed out');
      }),
      null,
      'post',
    ),
    /timed out/,
  );
  await assert.rejects(
    xRead(
      env,
      '/tweets/44',
      {},
      1,
      false,
      reply(() => new Response('不是 JSON', { status: 200 })),
      null,
      'post',
    ),
    /不是有效 JSON/,
  );
  const list = await costs(env);
  assert.deepEqual(
    list.map((c) => [c.status, c.amount_micro]),
    [
      ['failed', 0],
      ['failed', 0],
      ['failed', 0],
      ['uncertain', 5000],
      ['uncertain', 5000],
    ],
  );
  const summary = await (await handler.fetch(request('api/budget'), env)).json();
  assert.equal(summary.metered_micro, 10000);
  assert.equal(summary.x_failures.count, 3);
  assert.deepEqual(
    summary.x_failures.items.map((i) => [i.status, i.read, i.context]),
    [
      [401, 'user', 'author_profile'],
      [503, 'post', 'post'],
      [429, 'bookmarks', 'sync_partial'],
    ],
  );
  assert.ok(summary.x_failures.items[0].at);
});

test('書籤局部檢查遇到 X 限流：那次呼叫記 $0、同步區塊照舊顯示限流說明', async () => {
  const env = environment({ X_CLIENT_ID: 'client', X_CLIENT_SECRET: 'secret' });
  await connect(env);
  const net = recorder(async (url) => (url.hostname === 'api.x.com' ? new Response('{}', { status: 429 }) : null));
  const handler = createLearningHandler(net);
  await handler.fetch(request('api/admin/x-reads', 'PUT', { bookmarks: true }), env);
  await query(
    env,
    "INSERT INTO settings(key,value_json,updated_at) VALUES('learning:sync',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
    JSON.stringify({ baseline_complete: true }),
    new Date().toISOString(),
  ).run();
  await handler.queue({ messages: [message({ kind: 'sync', scope: 'partial' })] }, env);
  const status = await (await handler.fetch(request('api/status'), env)).json();
  assert.equal(status.sync_partial.last_error, 'X 限流，稍後再檢查');
  const summary = await (await handler.fetch(request('api/budget'), env)).json();
  assert.equal(summary.x_failures.count, 1);
  assert.deepEqual([summary.x_failures.items[0].status, summary.x_failures.items[0].context], [429, 'sync_partial']);
  assert.equal(summary.metered_micro, 0);
});

test('Owned Read 只在自身資源端點且確認為 app 擁有者時使用', async () => {
  const env = environment({ X_APP_OWNER_ID: '8' }),
    net = xNetwork();
  await connect(env);
  await xRead(env, '/users/7/bookmarks', {}, 100, true, net.fetcher);
  assert.equal((await costs(env))[0].amount_micro, 100 * 5000);
  const owner = environment(),
    ownerNet = xNetwork();
  await connect(owner);
  await xRead(owner, '/tweets/1234', {}, 1, true, ownerNet.fetcher);
  assert.equal((await costs(owner))[0].amount_micro, 5000);
  assert.equal((await costs(owner))[0].usage.owned, false);
});

test('費用暫停：停止新付費呼叫並保留工作；已有證據的 Mac 工作、追問與通知照常；跨月不自動恢復', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T03:00:00Z') });
  t.after(() => mock.timers.reset());
  const env = { ...environment({ LEARNING_MONTHLY_USD: '1' }), LEARNING_RUNNER_TOKEN: 'runner-test-token' },
    net = recorder(),
    handler = createLearningHandler(net);
  await setTextProvider(env, 'local');
  await connect(env);
  await reserve(env, 'gemini', 990000);
  await assert.rejects(reserve(env, 'x', 20000), { name: 'BudgetPaused' });
  assert.equal((await setting(env, 'control')).reason, 'budget');
  // 已保存原文的文章：不需付費，照樣排給 Mac。
  const ready = 'e'.repeat(32);
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,status,created_at,updated_at) VALUES(?,?,'web','queued',?,?)",
    ready,
    'https://example.org/saved',
    new Date().toISOString(),
    new Date().toISOString(),
  ).run();
  await saveEvidence(env, ready, {
    url: 'https://example.org/saved',
    relation: 'primary',
    content: '已保存的原文與 RATE_LIMIT 說明。',
  });
  await query(
    env,
    "INSERT INTO learning_intakes(receipt,item_id,origin,created_at) VALUES('r1',?,'web',?)",
    ready,
    new Date().toISOString(),
  ).run();
  await handler.queue({ messages: [message({ kind: 'article', id: ready })] }, env);
  assert.equal((await item(env, ready)).status, 'waiting_local');
  assert.ok(await claim(env, 'mac'));
  // 需要付費取得來源的 X 貼文：保留為費用暫停，不算失敗次數。
  const { id: xItem } = await (
    await handler.fetch(request('api/collect', 'POST', { url: 'https://x.com/a/status/42' }), env)
  ).json();
  await handler.queue({ messages: [message({ kind: 'article', id: xItem })] }, env);
  assert.equal((await item(env, xItem)).status, 'budget_paused');
  assert.equal((await item(env, xItem)).attempts, 0);
  assert.equal(net.calls.filter((c) => c.url.includes('api.x.com')).length, 0);
  // 下個月仍維持暫停，手動恢復也要檢查可用預算。
  mock.timers.setTime(Date.parse('2026-11-02T03:00:00Z'));
  await handler.scheduled(env, false);
  assert.equal((await setting(env, 'control')).paused, true);
  assert.equal((await item(env, xItem)).status, 'budget_paused');
  const resumed = await handler.fetch(request('api/control', 'POST', { action: 'resume' }), env);
  assert.equal(resumed.status, 200);
  assert.equal((await setting(env, 'control')).paused, false);
  assert.equal((await item(env, xItem)).status, 'queued');
  mock.timers.setTime(Date.parse('2026-10-20T03:00:00Z'));
  await query(
    env,
    'INSERT INTO settings(key,value_json,updated_at) VALUES(\'learning:control\',\'{"paused":true,"reason":"budget"}\',\'x\') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',
  ).run();
  await query(
    env,
    "INSERT INTO learning_costs(id,month,category,amount_micro,status,created_at) VALUES('full','2026-10','x',10000,'settled','x')",
  ).run();
  assert.equal((await handler.fetch(request('api/control', 'POST', { action: 'resume' }), env)).status, 429);
});

test('手動暫停停下全部處理，與費用暫停分開標示；預算明細分開估算、預留、未確認與核對調整', async () => {
  const env = { ...environment(), LEARNING_RUNNER_TOKEN: 'runner-test-token' },
    handler = createLearningHandler(recorder());
  await setTextProvider(env, 'local');
  await handler.fetch(request('api/control', 'POST', { action: 'pause' }), env);
  await assert.rejects(reserve(env, 'x', 1), { name: 'BudgetPaused' });
  assert.equal((await setting(env, 'control')).reason, 'manual');
  const { id } = await (
    await handler.fetch(request('api/collect', 'POST', { url: 'https://example.org/p' }), env)
  ).json();
  await handler.queue({ messages: [message({ kind: 'article', id })] }, env);
  assert.equal((await item(env, id)).status, 'paused');
  assert.equal(await claim(env, 'mac'), null);
  const paused = await (await handler.fetch(request('api/budget'), env)).json();
  assert.equal(paused.pause_reason, 'manual');
  await handler.fetch(request('api/control', 'POST', { action: 'resume' }), env);
  assert.equal((await item(env, id)).status, 'queued');
  const r = await reserve(env, 'gemini', 2000);
  const adjusted = await (
    await handler.fetch(
      request('api/admin/budget-adjust', 'POST', {
        category: 'x',
        amount_usd: -0.5,
        note: '與 X Developer Console 十月用量核對',
      }),
      env,
    )
  ).json();
  assert.equal(adjusted.totals.reserved_micro, 2000);
  assert.equal(adjusted.totals.adjustment_micro, -500000);
  assert.equal(adjusted.x_pricing.post_micro, 5000);
  assert.equal(adjusted.x_pricing.reread_daily_cap_micro, undefined);
  assert.equal(
    (await handler.fetch(request('api/admin/budget-adjust', 'POST', { category: 'x', amount_usd: 1, note: '' }), env))
      .status,
    400,
  );
  assert.ok(r);
});

test('舊資料搬移不重複計費', async () => {
  const env = environment();
  const time = new Date().toISOString();
  await query(
    env,
    "INSERT INTO articles(source_url,source,title,status,summary_json,content,model_provider,model_name,created_at,updated_at) VALUES('https://developers.openai.com/blog/x','openai_developer_blog','t','notified',?,'c','workers_ai','m',?,?)",
    JSON.stringify({ title_zh: 't', body_zh: 'b' }),
    time,
    time,
  ).run();
  const before = (await budget(env)).metered_micro;
  await migrateLibrary(env);
  await migrateLibrary(env);
  assert.equal((await budget(env)).metered_micro, before);
  assert.equal((await rows(env, 'SELECT id FROM learning_costs')).length, 0);
});

test('未確認費用可作廢：需要說明、只接受未確認；作廢後不算進預算但留在明細；預算為 0 時恢復失敗並提示先作廢，作廢後不自動恢復', async () => {
  const env = environment({ LEARNING_MONTHLY_USD: '1' }),
    handler = createLearningHandler(recorder());
  await connect(env);
  const summary = async () => (await handler.fetch(request('api/budget'), env)).json();
  let doc = await adminPage(handler, env);
  assert.equal(shown(doc, 'resume-box'), false);
  assert.equal(shown(doc, 'pause'), true);
  // X 逾時留下一筆未確認費用，剛好用完預算；下一個付費呼叫觸發費用暫停。
  await assert.rejects(
    xRead(
      env,
      '/tweets/45',
      {},
      200,
      false,
      async () => {
        throw new Error('The operation timed out');
      },
      null,
      'post',
    ),
    /timed out/,
  );
  await assert.rejects(reserve(env, 'gemini', 1), { name: 'BudgetPaused' });
  let b = await summary();
  assert.equal(b.pause_reason, 'budget');
  assert.equal(b.remaining_micro, 0);
  assert.deepEqual(
    b.uncertain_items.map((c) => [c.category, c.amount_micro, c.context, c.reason]),
    [['x', 1000000, 'post', 'no_response']],
  );
  doc = await adminPage(handler, env);
  assert.equal(shown(doc, 'resume-box'), true);
  assert.match(
    doc.getElementById('resume-note').textContent,
    /暫停原因：費用不足。.*不會處理未確認費用。目前剩餘預算為 0，請先作廢未確認費用或調整月預算。/,
  );
  assert.equal(doc.querySelectorAll('#uncertain button').length, 1);
  const blocked = await handler.fetch(request('api/control', 'POST', { action: 'resume' }), env);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, '剩餘預算為 0，請先作廢未確認費用或調整月預算');

  const id = b.uncertain_items[0].id,
    voidCost = (data) => handler.fetch(request('api/admin/costs/void', 'POST', data), env);
  assert.equal((await voidCost({ id, note: '  ' })).status, 400);
  await query(
    env,
    "INSERT INTO learning_costs(id,month,category,amount_micro,status,created_at) VALUES('settled-one',?,'gemini',0,'settled',?)",
    b.month,
    new Date().toISOString(),
  ).run();
  assert.equal((await voidCost({ id: 'settled-one', note: '不該成功' })).status, 400);
  const voided = await voidCost({ id, note: '已在 X 後台核對，這次沒有計費' });
  assert.equal(voided.status, 200);
  b = await voided.json();
  assert.equal(b.totals.voided_micro, 1000000);
  assert.equal(b.totals.uncertain_micro, 0);
  assert.equal(b.metered_micro, 0);
  assert.equal(b.remaining_micro, 1000000);
  assert.deepEqual(
    b.voided_items.map((c) => [c.category, c.amount_micro, c.note]),
    [['x', 1000000, '已在 X 後台核對，這次沒有計費']],
  );
  assert.ok(b.voided_items[0].voided_at);
  // 作廢不會自動恢復；恢復後預留檢查也排除作廢的金額。
  assert.equal(b.pause_reason, 'budget');
  assert.equal((await handler.fetch(request('api/control', 'POST', { action: 'resume' }), env)).status, 200);
  assert.ok(await reserve(env, 'gemini', 900000));
  doc = await adminPage(handler, env);
  assert.equal(shown(doc, 'resume-box'), false);
  assert.match(doc.getElementById('voided').textContent, /已作廢：US\$1\.00（1 筆，不計入預算）/);
  // 手動暫停：顯示恢復與原因，隱藏暫停按鈕。
  await handler.fetch(request('api/control', 'POST', { action: 'pause' }), env);
  doc = await adminPage(handler, env);
  assert.equal(shown(doc, 'resume-box'), true);
  assert.equal(shown(doc, 'pause'), false);
  assert.match(doc.getElementById('resume-note').textContent, /^暫停原因：手動暫停。/);
});

test('升級時既有的 X 未確認費用（失敗預留與重讀風險估算）改為作廢；其他類別不動', async () => {
  const DB = database({
    beforeMigration: (name, sqlite) => {
      if (name !== '0017_void_costs.sql') return;
      sqlite.prepare("INSERT INTO learning_months(month,limit_micro,base_micro) VALUES('2026-10',30000000,0)").run();
      const add = sqlite.prepare(
        "INSERT INTO learning_costs(id,month,category,amount_micro,status,created_at) VALUES(?,'2026-10',?,?,?,?)",
      );
      add.run('a', 'x', 500000, 'uncertain', '2026-10-10T00:00:00Z');
      add.run('b', 'x-reread-risk', 5000, 'uncertain', '2026-10-11T00:00:00Z');
      add.run('c', 'gemini', 20000, 'uncertain', '2026-10-12T00:00:00Z');
      add.run('d', 'x', 10000, 'settled', '2026-10-13T00:00:00Z');
    },
  });
  const env = environment({ DB }),
    handler = createLearningHandler({ ...recorder(), now: () => Date.parse('2026-10-19T00:00:00Z') });
  const b = await (await handler.fetch(request('api/budget'), env)).json();
  assert.equal(b.totals.voided_micro, 505000);
  assert.equal(b.totals.uncertain_micro, 20000);
  assert.equal(b.metered_micro, 30000);
  assert.deepEqual(
    b.voided_items.map((c) => c.category),
    ['x-reread-risk', 'x'],
  );
  assert.ok(b.voided_items.every((c) => c.note === '升級時作廢：X 失敗呼叫的預留或重讀風險估算'));
  assert.deepEqual(
    b.uncertain_items.map((c) => c.category),
    ['gemini'],
  );
});

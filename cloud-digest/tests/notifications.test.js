import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { setTextProvider, claim } from '../src/learning/local.js';
import { item, rows, query, saveConnection } from '../src/learning/store.js';
import { environment, recorder, request, message, enableXReads } from './helpers.js';

const html = `<html><h1>文章</h1><article>${'<p>背景原文與機制說明。</p>'.repeat(30)}</article></html>`;
function setup({ telegramFails = () => false, replies = () => [] } = {}) {
  const env = { ...environment(), LEARNING_RUNNER_TOKEN: 'runner-test-token' };
  const net = recorder(async (url) => {
    if (url.hostname === 'example.org') return new Response(html, { headers: { 'content-type': 'text/html' } });
    if (url.hostname === 'api.telegram.org' && telegramFails()) return new Response('', { status: 502 });
    if (url.pathname === '/2/tweets/search/all') return Response.json({ data: replies(), meta: {} });
    return null;
  });
  const handler = createLearningHandler({
    ...net,
    postEvidence: async (env, id) => ({
      url: 'https://x.com/i/status/' + id,
      relation: 'primary',
      author_id: '9',
      content: '原始貼文：版本 2 的設定方式。',
      metadata: { post_id: id, conversation_id: id, author_username: 'author9', references: [], links: [] },
      media: [],
    }),
  });
  const sent = () => net.calls.filter((c) => c.url.includes('api.telegram.org')).map((c) => JSON.parse(c.options.body));
  return { env, net, handler, sent };
}
async function runJob(s, body = '完整正文 [S1]', intro = '精簡介紹：說明設定方式。') {
  const job = await claim(s.env, 'mac');
  const refs = job.input.sources.map((x) => x.ref);
  const r = await s.handler.fetch(
    new Request('https://learning.example.org/learning/runner/complete', {
      method: 'POST',
      headers: { authorization: 'Bearer runner-test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        runner_id: 'mac',
        job_id: job.id,
        attempt_token: job.attempt_token,
        input_version: job.input_version,
        model: { name: 'gemma4:26b', done_reason: 'stop' },
        output: { title: '教材標題', intro, body, citations: refs },
      }),
    }),
    s.env,
  );
  assert.equal(r.status, 200);
  return job;
}
async function process(s, id) {
  await s.handler.queue({ messages: [message({ kind: 'article', id })] }, s.env);
}

test('跨入口只發一則完成通知；介紹與全文分開；已完成連結重傳只回既有入口', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  const { id } = await (
    await s.handler.fetch(request('api/collect', 'POST', { url: 'https://example.org/a' }), s.env)
  ).json();
  await s.handler.service.collect(s.env, 'https://example.org/a', 'bookmark', 'bookmark:1');
  await s.handler.service.collect(s.env, 'https://example.org/a', 'official', 'official:https://example.org/a', {
    metadata: { source_id: 'x' },
  });
  await process(s, id);
  await runJob(s, '## 完整正文\n很長的詳細內容 [S1]');
  await s.handler.scheduled(s.env, false);
  await s.handler.scheduled(s.env, false);
  const notices = s.sent();
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /精簡介紹/);
  assert.match(notices[0].text, new RegExp('/learning\\?article=' + id));
  assert.doesNotMatch(notices[0].text, /很長的詳細內容/);
  // Telegram 再分享同一篇：收件回覆提供既有文章入口，不產生第二則完成通知。
  const update = {
    update_id: 77,
    message: { chat: { id: 42 }, text: 'https://example.org/a', entities: [{ type: 'url', offset: 0, length: 21 }] },
  };
  await s.handler.fetch(
    request('telegram', 'POST', update, { 'x-telegram-bot-api-secret-token': 'webhook-test' }),
    s.env,
  );
  await s.handler.scheduled(s.env, false);
  const after = s.sent();
  assert.equal(after.length, 2);
  assert.equal(after[1].chat_id, '42');
  assert.match(after[1].text, /已整理過：教材標題/);
  assert.match(after[1].text, new RegExp('/learning\\?article=' + id));
  assert.equal((await rows(s.env, 'SELECT id FROM learning_jobs')).length, 1);
});

test('新收件立即回覆狀態；通知失敗只重送已保存內容，不重新生成', async () => {
  let fail = true;
  const s = setup({ telegramFails: () => fail });
  await setTextProvider(s.env, 'local');
  const update = {
    update_id: 5,
    message: {
      chat: { id: 42 },
      text: '看 https://example.org/new',
      entities: [{ type: 'url', offset: 2, length: 23 }],
    },
  };
  fail = false;
  await s.handler.fetch(
    request('telegram', 'POST', update, { 'x-telegram-bot-api-secret-token': 'webhook-test' }),
    s.env,
  );
  assert.match(s.sent()[0].text, /等待處理：/);
  fail = true;
  const id = (await rows(s.env, 'SELECT id FROM learning_items'))[0].id;
  await process(s, id);
  await runJob(s);
  await assert.rejects(s.handler.service.flush(s.env), /HTTP 502/);
  const saved = (
    await rows(s.env, "SELECT body FROM learning_deliveries WHERE origin='complete' AND status='pending'")
  )[0].body;
  fail = false;
  await s.handler.service.flush(s.env);
  assert.equal(s.sent().at(-1).text, saved);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_jobs')).length, 1);
});

test('作者 24 小時重查：沒有變更不生成也不通知；真正新增補充時更新同一篇、保留舊版與筆記並發更新通知', async () => {
  let replyList = [];
  const s = setup({ replies: () => replyList });
  await setTextProvider(s.env, 'local');
  await enableXReads(s.env);
  await saveConnection(s.env, 'x', {
    user_id: '7',
    access_token: 'a',
    refresh_token: 'r',
    expires_at: Date.now() + 86400000,
  });
  const { id } = await (
    await s.handler.fetch(request('api/collect', 'POST', { url: 'https://x.com/author9/status/500' }), s.env)
  ).json();
  await process(s, id);
  await runJob(s);
  await s.handler.service.flush(s.env);
  await s.handler.fetch(request('api/items/' + id, 'PATCH', { note: '我的筆記', read: true }), s.env);
  assert.equal(s.sent().length, 1);
  await query(s.env, "UPDATE learning_items SET recheck_at='2020-01-01' WHERE id=?", id).run();
  await s.handler.scheduled(s.env, { tasks: ['author_recheck'] });
  await process(s, id);
  assert.equal((await item(s.env, id)).status, 'ready');
  assert.equal((await item(s.env, id)).revision, 1);
  assert.equal((await rows(s.env, "SELECT id FROM learning_jobs WHERE status='waiting_local'")).length, 0);
  await s.handler.service.flush(s.env);
  assert.equal(s.sent().length, 1);

  // 再次重查時作者補了一則；更新同一篇。
  replyList = [{ id: '501', author_id: '9', text: '補充：版本 3 已移除這個設定。', conversation_id: '500' }];
  await query(s.env, "UPDATE learning_items SET recheck_at='2020-01-01',rechecked=0 WHERE id=?", id).run();
  await s.handler.scheduled(s.env, { tasks: ['author_recheck'] });
  await process(s, id);
  const job = await runJob(s, '更新後正文 [S1] [S2]', '新增版本 3 的變更。');
  assert.ok(job.input.sources.some((x) => x.relation === 'author_reply'));
  const updated = await item(s.env, id);
  assert.equal(updated.revision, 2);
  assert.equal(updated.note, '我的筆記');
  assert.ok(updated.read_at);
  assert.equal((await rows(s.env, 'SELECT id FROM learning_versions WHERE item_id=?', id)).length, 1);
  await s.handler.service.flush(s.env);
  const last = s.sent().at(-1).text;
  assert.equal(s.sent().length, 2);
  assert.match(last, /^【更新】教材標題/);
  assert.match(last, /新增版本 3 的變更/);
});

test('只有模型或提示版本改變、內容相同的重寫：版本更新但不發通知', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  const { id } = await (
    await s.handler.fetch(request('api/collect', 'POST', { url: 'https://example.org/same' }), s.env)
  ).json();
  await process(s, id);
  await runJob(s);
  await s.handler.service.flush(s.env);
  assert.equal(s.sent().length, 1);
  s.env.LOCAL_TEXT_MODEL = 'gemma4:26b-qat';
  await s.handler.fetch(request('api/items/' + id + '/retry', 'POST', {}), s.env);
  await process(s, id);
  await runJob(s, '換模型後的正文 [S1]');
  assert.equal((await item(s.env, id)).revision, 2);
  await s.handler.service.flush(s.env);
  assert.equal(s.sent().length, 1);
  assert.equal((await item(s.env, id)).notified_revision, 2);
});

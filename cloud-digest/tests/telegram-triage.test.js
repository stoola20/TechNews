import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { query, item } from '../src/learning/store.js';
import { environment, recorder, request } from './helpers.js';

const A = 'a'.repeat(32),
  B = 'b'.repeat(32);
function setup() {
  const env = environment(),
    net = recorder();
  const handler = createLearningHandler({ ...net, now: () => Date.parse('2026-10-01T00:00:00Z') });
  const telegram = (method) =>
    net.calls.filter((c) => c.url.endsWith('/' + method)).map((c) => JSON.parse(c.options.body));
  return { env, net, handler, telegram };
}
async function add(env, id, triage = 'pending') {
  await query(
    env,
    "INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,triage,created_at,updated_at) VALUES(?,?,'web','文章','ready','正文',?,1,?,'2026-10-01','2026-10-01')",
    id,
    'https://example.org/' + id,
    JSON.stringify({ intro: '導讀', content_fingerprint: 'c' + id }),
    triage,
  ).run();
  await query(
    env,
    "INSERT INTO learning_intakes(receipt,item_id,origin,created_at) VALUES(?,?,'share','2026-10-01')",
    'r' + id,
    id,
  ).run();
}
let updates = 1000;
const press = (s, data, { chat = -1001, message = 1, secret = 'webhook-test' } = {}) =>
  s.handler.fetch(
    request(
      'telegram',
      'POST',
      {
        update_id: updates++,
        callback_query: { id: 'cb' + updates, data, message: { message_id: message, chat: { id: chat } } },
      },
      { 'x-telegram-bot-api-secret-token': secret },
    ),
    s.env,
  );

test('待決定文章的通知附三個篩選按鈕，已保留的不附；callback_data 在 64 bytes 內', async () => {
  const s = setup();
  await add(s.env, A);
  await add(s.env, B, 'kept');
  await s.handler.service.flush(s.env);
  const sent = s.telegram('sendMessage');
  assert.equal(sent.length, 2);
  const withButtons = sent.find((m) => m.reply_markup);
  const plain = sent.filter((m) => !m.reply_markup);
  assert.equal(plain.length, 1);
  const buttons = withButtons.reply_markup.inline_keyboard.flat();
  assert.deepEqual(
    buttons.map((b) => b.text),
    ['保留', '保留並 ★', '刪除'],
  );
  assert.deepEqual(
    buttons.map((b) => b.callback_data),
    ['t:k:' + A, 't:s:' + A, 't:d:' + A],
  );
  assert.ok(buttons.every((b) => new TextEncoder().encode(b.callback_data).length <= 64));
});

test('按下保留：套用到文章庫、回覆提示並把按鈕換成結果與復原；重複送達結果相同，復原回到按下前', async () => {
  const s = setup();
  await add(s.env, A);
  await s.handler.service.flush(s.env);
  const messageId = (await query(s.env, 'SELECT message_id FROM learning_deliveries').first()).message_id;
  let r = await press(s, 't:s:' + A, { message: messageId });
  assert.equal(r.status, 200);
  assert.deepEqual([(await item(s.env, A)).triage, (await item(s.env, A)).starred], ['kept', 1]);
  assert.equal(s.telegram('answerCallbackQuery')[0].text, '已保留並標記 ★');
  const edit = s.telegram('editMessageReplyMarkup')[0];
  assert.equal(edit.message_id, messageId);
  assert.equal(edit.chat_id, -1001);
  assert.deepEqual(
    edit.reply_markup.inline_keyboard.flat().map((b) => [b.text, b.callback_data]),
    [
      ['已保留 ★', 't:i:' + A],
      ['復原', 't:u:' + A],
    ],
  );
  // 同一個按鈕重複送達：仍是保留 ★，復原仍回到第一次按下前的待決定。
  await press(s, 't:s:' + A, { message: messageId });
  assert.equal((await item(s.env, A)).triage, 'kept');
  r = await press(s, 't:u:' + A, { message: messageId });
  assert.deepEqual([(await item(s.env, A)).triage, (await item(s.env, A)).starred], ['pending', 0]);
  const restored = s.telegram('editMessageReplyMarkup').at(-1);
  assert.deepEqual(
    restored.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
    ['t:k:' + A, 't:s:' + A, 't:d:' + A],
  );
  // 復原重複送達：沒有可以復原的決定，結果不變。
  await press(s, 't:u:' + A, { message: messageId });
  assert.equal((await item(s.env, A)).triage, 'pending');
  assert.equal(s.telegram('answerCallbackQuery').at(-1).text, '沒有可以復原的決定');
  // 刪除也能復原。
  await press(s, 't:d:' + A, { message: messageId });
  assert.equal((await item(s.env, A)).triage, 'deleted');
  await press(s, 't:u:' + A, { message: messageId });
  assert.equal((await item(s.env, A)).triage, 'pending');
});

test('只接受通知頻道或允許對話的按鈕；secret 不符時不處理；已清除的文章提示並移除按鈕', async () => {
  const s = setup();
  await add(s.env, A);
  let r = await press(s, 't:k:' + A, { chat: 99 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ignored, true);
  assert.equal((await item(s.env, A)).triage, 'pending');
  assert.equal(s.net.calls.length, 0);
  r = await press(s, 't:k:' + A, { secret: 'wrong' });
  assert.equal(r.status, 404);
  // 允許清單裡的對話（使用者自己的私訊）也可以按。
  r = await press(s, 't:k:' + A, { chat: 42 });
  assert.equal((await item(s.env, A)).triage, 'kept');
  await query(s.env, "UPDATE learning_items SET status='dismissed' WHERE id=?", A).run();
  await press(s, 't:d:' + A);
  assert.equal(s.telegram('answerCallbackQuery').at(-1).text, '這篇已清除');
  assert.deepEqual(s.telegram('editMessageReplyMarkup').at(-1).reply_markup, { inline_keyboard: [] });
  assert.equal((await item(s.env, A)).status, 'dismissed');
});

test('等待確認回補的書籤在 Telegram 按保留也會開始整理', async () => {
  const s = setup();
  const id = await s.handler.service.collect(s.env, 'https://example.org/wait', 'backfill', 'w', {
    defer: true,
    source: { url: 'https://example.org/wait', relation: 'primary', content: '原文', media: [] },
  });
  await press(s, 't:k:' + id);
  assert.equal((await item(s.env, id)).status, 'queued');
  assert.deepEqual(s.env.LEARNING_JOBS.jobs, [{ kind: 'article', id }]);
  assert.equal(s.telegram('answerCallbackQuery')[0].text, '已保留，已開始整理');
});

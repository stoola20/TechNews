import { query, item } from './store.js';
import { READABLE, UNTRIAGED, setTriage, triageState } from './triage.js';

// Telegram 完成通知上的篩選按鈕。callback_data 為 t:<動作>:<文章 id>，最長 36 bytes，在 Telegram 的 64 bytes 限制內。
// k 保留、s 保留並 ★、d 刪除、u 復原、i 只顯示目前結果。
const ACTIONS = { k: 'kept', s: 'starred', d: 'deleted' };
const RESULT = { kept: '已保留', starred: '已保留 ★', deleted: '已刪除，7 天內可復原' };
const DONE = { kept: '已保留', starred: '已保留並標記 ★', deleted: '已移到最近刪除', pending: '已復原，回到待決定' };

export function triageKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: '保留', callback_data: `t:k:${id}` },
        { text: '保留並 ★', callback_data: `t:s:${id}` },
        { text: '刪除', callback_data: `t:d:${id}` },
      ],
    ],
  };
}
function resultKeyboard(id, state) {
  if (state === 'pending') return triageKeyboard(id);
  return {
    inline_keyboard: [
      [
        { text: RESULT[state], callback_data: `t:i:${id}` },
        { text: '復原', callback_data: `t:u:${id}` },
      ],
    ],
  };
}

// 送出時才決定要不要附按鈕：只有一篇、仍是待決定、而且可以閱讀的文章通知才附。
export async function notificationMarkup(env, items) {
  if (items.length !== 1) return null;
  const row = await item(env, items[0].id);
  return row && row.triage === 'pending' && READABLE.includes(row.status) ? triageKeyboard(row.id) : null;
}

// 只接受通知頻道或允許對話傳來的按鈕。公開頻道的 TELEGRAM_CHAT_ID 可以是 @帳號，回呼只帶數字 ID 與 username，兩種都比對。
export function allowedChat(env, chat) {
  const allowed = [env.TELEGRAM_CHAT_ID, ...(env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',')]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (chat?.id == null) return false;
  return allowed.includes(String(chat.id)) || (!!chat.username && allowed.includes('@' + chat.username));
}

// 處理一次按鈕回呼：套用動作、回覆短提示、把按鈕換成結果列。重複送達時結果相同。
// telegram(method, body) 呼叫 Bot API；hooks.enqueue 讓待回補文章保留後開始整理。
export async function handleTriageCallback(env, callback, telegram, hooks = {}) {
  const chatId = callback.message?.chat?.id,
    messageId = callback.message?.message_id;
  if (!allowedChat(env, callback.message?.chat)) return { ignored: true };
  const match = /^t:([ksdui]):([a-f0-9]{32})$/.exec(callback.data || '');
  const answer = (text) => telegram('answerCallbackQuery', { callback_query_id: callback.id, text });
  const markup = (reply_markup) =>
    messageId ? telegram('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup }) : null;
  if (!match) {
    await answer('無法辨識這個按鈕');
    return { ignored: true };
  }
  const [, code, id] = match;
  const row = await item(env, id);
  if (!row || row.status === 'dismissed') {
    await answer('這篇已清除');
    await markup({ inline_keyboard: [] });
    return { ok: true, state: 'dismissed' };
  }
  if (UNTRIAGED.includes(row.status)) {
    await answer('這篇不參與篩選');
    await markup({ inline_keyboard: [] });
    return { ok: true, state: 'untriaged' };
  }
  const delivery = messageId
    ? await query(
        env,
        "SELECT id,triage_undo FROM learning_deliveries WHERE message_id=? AND origin NOT IN ('receipt','source_alert') ORDER BY created_at DESC LIMIT 1",
        messageId,
      ).first()
    : null;
  const current = triageState(row);
  let target = current;
  if (ACTIONS[code]) {
    target = ACTIONS[code];
    // 只在真的改變時記住按下前的結果；重複送達的同一個按鈕不覆寫，復原仍回到第一次按下前。
    if (target !== current && delivery)
      await query(
        env,
        'UPDATE learning_deliveries SET triage_undo=? WHERE id=?',
        JSON.stringify({ item_id: id, before: current }),
        delivery.id,
      ).run();
  } else if (code === 'u') {
    const undo = delivery?.triage_undo ? JSON.parse(delivery.triage_undo) : null;
    target = undo?.item_id === id ? undo.before : current;
    if (delivery) await query(env, 'UPDATE learning_deliveries SET triage_undo=NULL WHERE id=?', delivery.id).run();
  }
  const { started } = await setTriage(env, row, target, hooks);
  const text =
    code === 'i'
      ? `目前：${target === 'pending' ? '待決定' : RESULT[target]}`
      : code === 'u' && target === current
        ? '沒有可以復原的決定'
        : DONE[target] + (started ? '，已開始整理' : '');
  await answer(text);
  await markup(resultKeyboard(id, target));
  return { ok: true, state: target };
}

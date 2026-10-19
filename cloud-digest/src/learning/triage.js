import { query, rows, item, nowIso } from './store.js';
import { now } from './clock.js';

// 篩選結果：待決定、保留（★ 是保留裡的常用參考）、最近刪除。和處理狀態（status）分開記錄。
export const READABLE = ['ready', 'partial', 'awaiting_backfill'];
// 不參與篩選的處理狀態：主題不符、已合併、已清除。
export const UNTRIAGED = ['filtered', 'merged', 'dismissed'];
export const TRIAGE_DAYS = 14;
export const PURGE_DAYS = 7;
const DAY = 86400000,
  PURGE_BATCH = 20,
  EXPIRE_BATCH = 50,
  CLOCK_BATCH = 200;
export const TRIAGE_ACTIONS = ['keep', 'star', 'unstar', 'pending', 'delete', 'restore'];
export const TRIAGE_COLUMNS =
  'triage,starred,kept_at,deleted_at,deleted_reason,deleted_from,triage_deadline,triage_no_expiry';

export class TriageError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'TriageError';
    this.status = status;
  }
}

// 目前的篩選結果，用同一組名稱表示：pending、kept、starred、deleted。
export function triageState(row) {
  if (row.triage === 'deleted') return 'deleted';
  if (row.triage === 'kept') return row.starred ? 'starred' : 'kept';
  return 'pending';
}

export function triageFields(row) {
  return {
    id: row.id,
    status: row.status,
    triage: row.triage,
    starred: !!row.starred,
    kept_at: row.kept_at,
    deleted_at: row.deleted_at,
    deleted_reason: row.deleted_reason,
    deleted_from: row.deleted_from,
    triage_deadline: row.triage_deadline,
    purge_at: purgeAt(row.deleted_at),
  };
}
export const purgeAt = (deletedAt) =>
  deletedAt ? new Date(Date.parse(deletedAt) + PURGE_DAYS * DAY).toISOString() : null;

const deadlineFrom = (time) => new Date(time + TRIAGE_DAYS * DAY).toISOString();

// 回到待決定時的期限：不套用自動過期的文章維持原狀；可以閱讀的重新計 14 天，處理中的等可以閱讀時再起算。
// 剛救回或改回待決定的文章不會因為舊期限早已過去，在下一輪維護就又被移走。
function pendingDeadline(row) {
  if (row.triage_no_expiry) return row.triage_deadline;
  return READABLE.includes(row.status) ? deadlineFrom(now()) : null;
}

// 把篩選結果改成 target（pending、kept、starred、deleted）。reason 只在刪除時使用。
async function writeState(env, row, target, reason = 'manual') {
  const current = triageState(row),
    time = nowIso();
  if (target === current) return false;
  if (target === 'deleted') {
    await query(
      env,
      "UPDATE learning_items SET triage='deleted',starred=0,kept_at=NULL,deleted_at=?,deleted_reason=?,deleted_from=? WHERE id=?",
      time,
      reason,
      current,
      row.id,
    ).run();
    return true;
  }
  if (target === 'pending') {
    await query(
      env,
      "UPDATE learning_items SET triage='pending',starred=0,kept_at=NULL,deleted_at=NULL,deleted_reason=NULL,deleted_from=NULL,triage_deadline=? WHERE id=?",
      pendingDeadline(row),
      row.id,
    ).run();
    return true;
  }
  const wasKept = current === 'kept' || current === 'starred';
  await query(
    env,
    "UPDATE learning_items SET triage='kept',starred=?,kept_at=?,deleted_at=NULL,deleted_reason=NULL,deleted_from=NULL WHERE id=?",
    target === 'starred' ? 1 : 0,
    wasKept && row.kept_at ? row.kept_at : time,
    row.id,
  ).run();
  return true;
}

// 套用一個篩選動作，回傳最新的篩選欄位。等待確認回補的文章保留時同時開始整理（hooks.enqueue）。
export async function applyTriage(env, id, action, hooks = {}) {
  if (!TRIAGE_ACTIONS.includes(action)) throw new TriageError('未知的篩選動作', 400);
  const row = await item(env, id);
  if (!row || row.status === 'dismissed') throw new TriageError('這篇已清除', 404);
  if (UNTRIAGED.includes(row.status)) throw new TriageError('這篇不參與篩選', 409);
  const current = triageState(row);
  let target = current;
  if (action === 'keep') target = current === 'starred' ? 'starred' : 'kept';
  else if (action === 'star') target = 'starred';
  else if (action === 'unstar') target = current === 'starred' ? 'kept' : current;
  else if (action === 'pending') target = 'pending';
  else if (action === 'delete') target = 'deleted';
  else if (action === 'restore') {
    if (current !== 'deleted') throw new TriageError('這篇不在最近刪除', 409);
    target = ['pending', 'kept', 'starred'].includes(row.deleted_from) ? row.deleted_from : 'pending';
  }
  await setTriage(env, row, target, hooks);
  return triageFields(await item(env, id));
}

// 直接設定篩選結果；Telegram 復原用它回到按下前的結果。
export async function setTriage(env, row, target, hooks = {}, reason = 'manual') {
  const changed = await writeState(env, row, target, reason);
  let started = false;
  if ((target === 'kept' || target === 'starred') && row.status === 'awaiting_backfill') {
    const result = await query(
      env,
      "UPDATE learning_items SET status='queued',updated_at=? WHERE id=? AND status='awaiting_backfill'",
      nowIso(),
      row.id,
    ).run();
    started = !!result.meta.changes;
    if (started && hooks.enqueue) await hooks.enqueue(env, row.id);
  }
  return { changed, started };
}

// 第一次可以閱讀時開始計時：待決定、還沒有期限、沒有標記不過期。之後的重寫與內容更新不重設。
export async function startTriageClock(env, id = null) {
  const marks = READABLE.map(() => '?').join(',');
  if (id)
    return query(
      env,
      `UPDATE learning_items SET triage_deadline=? WHERE id=? AND triage='pending' AND triage_deadline IS NULL AND triage_no_expiry=0 AND status IN (${marks})`,
      deadlineFrom(now()),
      id,
      ...READABLE,
    ).run();
  // 維護排程補上漏掉的起算點（例如沿用既有結果直接完成的文章）。
  const pending = await rows(
    env,
    `SELECT id FROM learning_items WHERE triage='pending' AND triage_deadline IS NULL AND triage_no_expiry=0 AND status IN (${marks}) LIMIT ?`,
    ...READABLE,
    CLOCK_BATCH,
  );
  for (const row of pending) await startTriageClock(env, row.id);
  return pending.length;
}

// 待決定超過期限：移到最近刪除，原因記為逾期。每輪有篇數上限。
export async function expirePending(env, limit = EXPIRE_BATCH) {
  const due = await rows(
    env,
    "SELECT id FROM learning_items WHERE triage='pending' AND triage_deadline<=? ORDER BY triage_deadline LIMIT ?",
    nowIso(),
    limit,
  );
  let expired = 0;
  for (const { id } of due) {
    const row = await item(env, id);
    if (!row || UNTRIAGED.includes(row.status) || row.triage !== 'pending') continue;
    await writeState(env, row, 'deleted', 'expired');
    expired++;
  }
  return expired;
}

// 清除一篇：只留網址作為不再收件的紀錄。正文、來源、媒體、筆記、追問、版本與尚未送出的通知都刪除。
export async function purgeItem(env, id) {
  const assets = await rows(
    env,
    'SELECT object_key FROM learning_media WHERE item_id=? AND object_key IS NOT NULL',
    id,
  );
  const cutoff = new Date(now() - PURGE_DAYS * DAY).toISOString();
  const guard = "AND EXISTS(SELECT 1 FROM learning_items WHERE id=? AND status='dismissed')";
  const deliveries = await rows(
    env,
    "SELECT id FROM learning_deliveries WHERE status!='sent' AND origin!='receipt' AND instr(item_ids_json,?)>0",
    id,
  );
  const result = await env.DB.batch([
    query(
      env,
      `UPDATE learning_items SET status='dismissed',stage=NULL,title='',body=NULL,article_json=NULL,gaps_json='[]',note='',note_updated_at=NULL,
      last_error=NULL,read_at=NULL,lease_until=NULL,triage='pending',starred=0,kept_at=NULL,deleted_at=NULL,deleted_reason=NULL,deleted_from=NULL,
      triage_deadline=NULL,triage_no_expiry=0,updated_at=? WHERE id=? AND triage='deleted' AND deleted_at<=?`,
      nowIso(),
      id,
      cutoff,
    ),
    query(env, `DELETE FROM learning_questions WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM learning_media_analyses WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM learning_media WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM learning_evidence WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM learning_intakes WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM learning_versions WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM learning_jobs WHERE item_id=? ${guard}`, id, id),
    query(env, `DELETE FROM settings WHERE key=? ${guard}`, `learning:context:${id}`, id),
    ...deliveries.map((d) => query(env, `DELETE FROM learning_deliveries WHERE id=? ${guard}`, d.id, id)),
  ]);
  if (!result[0].meta.changes) return false;
  for (const asset of assets) if (env.MEDIA) await env.MEDIA.delete(asset.object_key);
  return true;
}

// 維護排程：清除刪除超過 7 天的文章。正在處理中的文章（有有效 lease）等下一輪。
export async function purgeDeleted(env, limit = PURGE_BATCH) {
  const due = await rows(
    env,
    "SELECT id FROM learning_items WHERE triage='deleted' AND deleted_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY deleted_at LIMIT ?",
    new Date(now() - PURGE_DAYS * DAY).toISOString(),
    nowIso(),
    limit,
  );
  let purged = 0;
  for (const { id } of due) if (await purgeItem(env, id)) purged++;
  return purged;
}

// 分享或網站加入了仍在最近刪除的文章：恢復為待決定並重設期限。
export async function reviveFromDeleted(env, id) {
  await query(
    env,
    "UPDATE learning_items SET triage='pending',starred=0,kept_at=NULL,deleted_at=NULL,deleted_reason=NULL,deleted_from=NULL,triage_deadline=? WHERE id=? AND triage='deleted'",
    deadlineFrom(now()),
    id,
  ).run();
}

// 待決定篇數：只算可以篩選的文章（處理完成或等待確認回補）。
export async function pendingCount(env) {
  return (
    await query(
      env,
      `SELECT COUNT(*) AS count FROM learning_items WHERE triage='pending' AND status IN (${READABLE.map(() => '?').join(',')})`,
      ...READABLE,
    ).first()
  ).count;
}

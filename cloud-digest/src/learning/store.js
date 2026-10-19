import { normalizePublished } from './dates.js';
import { now } from './clock.js';
export const nowIso = () => new Date(now()).toISOString();
export const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export async function rows(env, sql, ...args) {
  return (await query(env, sql, ...args).all()).results;
}
export async function setting(env, name, fallback = {}) {
  const record = await query(env, 'SELECT value_json FROM settings WHERE key = ?', `learning:${name}`).first();
  return record ? JSON.parse(record.value_json) : fallback;
}
export async function setSetting(env, name, value) {
  await query(
    env,
    'INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
    `learning:${name}`,
    JSON.stringify(value),
    nowIso(),
  ).run();
}
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export async function item(env, id) {
  return query(env, 'SELECT * FROM learning_items WHERE id=?', id).first();
}
export async function evidence(env, id) {
  return rows(env, 'SELECT * FROM learning_evidence WHERE item_id=? ORDER BY fetched_at,id', id);
}
// 使用者手動貼上的原文，之後自動補取（成功或失敗）都不能覆蓋。
export async function saveEvidence(env, id, value) {
  const key = await hash(`${id}:${value.url}:${value.relation}`);
  await query(
    env,
    `INSERT INTO learning_evidence(id,item_id,url,relation,author_id,published_at,content,metadata_json,status,fetched_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,metadata_json=excluded.metadata_json,status=excluded.status,fetched_at=excluded.fetched_at
    WHERE json_extract(learning_evidence.metadata_json,'$.provided_by') IS NOT 'user' OR json_extract(excluded.metadata_json,'$.provided_by')='user'`,
    key,
    id,
    value.url,
    value.relation,
    value.author_id || null,
    value.published_at || null,
    value.content || '',
    JSON.stringify(value.metadata || {}),
    value.status || 'available',
    nowIso(),
  ).run();
  // 主要來源的發表時間正規化後記在文章上，列表依此排序；解析不了時保留原值。
  const published = value.relation === 'primary' ? normalizePublished(value.published_at) : null;
  if (published) await query(env, 'UPDATE learning_items SET published_at=? WHERE id=?', published, id).run();
  return key;
}
export async function lock(env, id) {
  const token = new Date(now() + 600000).toISOString();
  const result = await query(
    env,
    'UPDATE learning_items SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?)',
    token,
    id,
    nowIso(),
  ).run();
  return result.meta.changes ? token : null;
}
export async function unlock(env, id, token) {
  await query(env, 'UPDATE learning_items SET lease_until=NULL WHERE id=? AND lease_until=?', id, token).run();
}
export function monthKey(time = now()) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 7);
}
export class BudgetPaused extends Error {
  constructor(message = '費用不足或處理已暫停，工作已保留，請手動恢復。') {
    super(message);
    this.name = 'BudgetPaused';
  }
}
export async function budget(env) {
  const month = monthKey();
  const limit = Math.round(Number(env.LEARNING_MONTHLY_USD ?? 30) * 1e6);
  const base = Math.round(Number(env.LEARNING_BASE_USD ?? 5) * 1e6);
  if (!Number.isSafeInteger(base) || base < 0) throw new Error('基本費設定無效');
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit < base) throw new Error('月預算須大於零，且不得低於基本費');
  await query(
    env,
    'INSERT INTO learning_months(month,limit_micro,base_micro) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET base_micro=excluded.base_micro',
    month,
    limit,
    base,
  ).run();
  // 作廢的費用保留金額供對帳，但不算進已使用金額。
  const b = await query(
    env,
    `SELECT m.*,COALESCE(SUM(CASE WHEN c.status!='voided' THEN c.amount_micro ELSE 0 END),0) AS metered_micro,
    COALESCE(SUM(CASE WHEN c.status IN ('reserved','uncertain') THEN c.amount_micro ELSE 0 END),0) AS unsettled_micro
    FROM learning_months m LEFT JOIN learning_costs c ON c.month=m.month WHERE m.month=? GROUP BY m.month`,
    month,
  ).first();
  const control = await setting(env, 'control');
  return {
    ...b,
    paused: !!control.paused,
    remaining_micro: Math.max(0, b.limit_micro - b.base_micro - b.metered_micro),
  };
}
export async function reserve(env, category, amount) {
  const b = await budget(env),
    id = crypto.randomUUID();
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid cost estimate');
  const result = await query(
    env,
    `INSERT INTO learning_costs(id,month,category,amount_micro,status,created_at)
    SELECT ?,?,?,?,'reserved',? FROM learning_months m WHERE m.month=?
    AND m.base_micro+COALESCE((SELECT SUM(amount_micro) FROM learning_costs WHERE month=m.month AND status!='voided'),0)+?<=m.limit_micro
    AND COALESCE((SELECT json_extract(value_json,'$.paused') FROM settings WHERE key='learning:control'),0)=0`,
    id,
    b.month,
    category,
    amount,
    nowIso(),
    b.month,
    amount,
  ).run();
  if (!result.meta.changes) {
    await pauseForBudget(env);
    throw new BudgetPaused();
  }
  return id;
}
export async function settle(env, id, amount, usage = {}) {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.ceil(amount)))
    throw new Error('Invalid measured cost');
  await query(
    env,
    "UPDATE learning_costs SET amount_micro=?,status='settled',usage_json=? WHERE id=? AND status IN ('reserved','uncertain')",
    Math.ceil(amount),
    JSON.stringify(usage),
    id,
  ).run();
  if ((await budget(env)).remaining_micro === 0) await pauseForBudget(env);
}
// 已手動暫停時保留手動原因，避免恢復時誤以為只是費用暫停。
async function pauseForBudget(env) {
  const control = await setting(env, 'control');
  if (!control.paused) await setSetting(env, 'control', { paused: true, reason: 'budget', paused_at: nowIso() });
}
export async function manuallyPaused(env) {
  const control = await setting(env, 'control');
  return !!control.paused && control.reason === 'manual';
}
// 對方回了錯誤（非 2xx）：沒有讀到資料，這次呼叫記 $0，並留下狀態碼與情境供管理頁列出。
export async function failed(env, id, usage = {}) {
  await query(
    env,
    "UPDATE learning_costs SET amount_micro=0,status='failed',usage_json=? WHERE id=? AND status='reserved'",
    JSON.stringify(usage),
    id,
  ).run();
}
export async function uncertain(env, id, usage = null) {
  await query(
    env,
    "UPDATE learning_costs SET status='uncertain',usage_json=COALESCE(?,usage_json) WHERE id=? AND status='reserved'",
    usage ? JSON.stringify(usage) : null,
    id,
  ).run();
}
// 作廢：只接受未確認的費用，必須附說明。作廢後不自動恢復處理，由使用者決定。
export async function voidCost(env, id, note) {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text || text.length > 500) throw new Error('作廢需要 1–500 字的說明');
  const result = await query(
    env,
    "UPDATE learning_costs SET status='voided',voided_at=?,void_note=? WHERE id=? AND status='uncertain'",
    nowIso(),
    text,
    id,
  ).run();
  if (!result.meta.changes) throw new Error('只能作廢未確認的費用');
}
export async function resume(env) {
  const b = await budget(env);
  if (b.remaining_micro === 0) throw new BudgetPaused('剩餘預算為 0，請先作廢未確認費用或調整月預算');
  await setSetting(env, 'control', { paused: false });
  await query(
    env,
    "UPDATE learning_items SET status='queued',next_attempt_at=NULL,attempts=0 WHERE status IN ('budget_paused','paused')",
  ).run();
  return budget(env);
}
export async function saveConnection(env, name, value) {
  if (!env.RUN_TOKEN) throw new Error('RUN_TOKEN 未設定');
  const key = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.RUN_TOKEN)),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))),
  );
  const sealed = JSON.stringify({ iv: [...iv], data: [...cipher] });
  await query(
    env,
    'INSERT INTO learning_connections(name,sealed,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',
    name,
    sealed,
    nowIso(),
  ).run();
}
export async function connection(env, name) {
  const row = await query(env, 'SELECT sealed FROM learning_connections WHERE name=?', name).first();
  if (!row) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.RUN_TOKEN)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const data = JSON.parse(row.sealed);
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(data.iv) }, key, new Uint8Array(data.data)),
    ),
  );
}

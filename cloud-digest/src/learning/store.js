export const nowIso = () => new Date().toISOString();
export const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export async function rows(env, sql, ...args) { return (await query(env, sql, ...args).all()).results; }
export async function setting(env, name, fallback = {}) {
  const record = await query(env, 'SELECT value_json FROM settings WHERE key = ?', `learning:${name}`).first();
  return record ? JSON.parse(record.value_json) : fallback;
}
export async function setSetting(env, name, value) {
  await query(env, 'INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', `learning:${name}`, JSON.stringify(value), nowIso()).run();
}
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function item(env, id) { return query(env, 'SELECT * FROM learning_items WHERE id=?', id).first(); }
export async function evidence(env, id) { return rows(env, 'SELECT * FROM learning_evidence WHERE item_id=? ORDER BY fetched_at,id', id); }
export async function saveEvidence(env, id, value) {
  const key = await hash(`${id}:${value.url}:${value.relation}`);
  await query(env, `INSERT INTO learning_evidence(id,item_id,url,relation,author_id,published_at,content,metadata_json,status,fetched_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,metadata_json=excluded.metadata_json,status=excluded.status,fetched_at=excluded.fetched_at`,
    key,id,value.url,value.relation,value.author_id || null,value.published_at || null,value.content || '',JSON.stringify(value.metadata || {}),value.status || 'available',nowIso()).run();
  return key;
}
export async function lock(env, id) {
  const token = new Date(Date.now()+600000).toISOString();
  const result = await query(env, 'UPDATE learning_items SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?)', token,id,nowIso()).run();
  return result.meta.changes ? token : null;
}
export async function unlock(env, id, token) { await query(env, 'UPDATE learning_items SET lease_until=NULL WHERE id=? AND lease_until=?',id,token).run(); }
export function monthKey(time = Date.now()) {
  return new Date(time+8*3600000).toISOString().slice(0,7);
}
export class BudgetPaused extends Error { constructor(){super('費用不足或處理已暫停，工作已保留，請手動恢復。');this.name='BudgetPaused';} }
export async function budget(env) {
  const month=monthKey();
  const limit=Math.round(Number(env.LEARNING_MONTHLY_USD || 30)*1e6);
  if (!Number.isFinite(limit) || limit<5000000) throw new Error('月預算不得低於基本費 US$5');
  await query(env,'INSERT OR IGNORE INTO learning_months(month,limit_micro,base_micro) VALUES(?,?,5000000)',month,limit).run();
  const b=await query(env,`SELECT m.*,COALESCE(SUM(c.amount_micro),0) AS metered_micro,
    COALESCE(SUM(CASE WHEN c.status IN ('reserved','uncertain') THEN c.amount_micro ELSE 0 END),0) AS unsettled_micro
    FROM learning_months m LEFT JOIN learning_costs c ON c.month=m.month WHERE m.month=? GROUP BY m.month`,month).first();
  const control=await setting(env,'control');
  return {...b,paused:!!control.paused,remaining_micro:Math.max(0,b.limit_micro-b.base_micro-b.metered_micro)};
}
export async function reserve(env, category, amount) {
  const b=await budget(env), id=crypto.randomUUID();
  if (!Number.isSafeInteger(amount) || amount<0) throw new Error('Invalid cost estimate');
  const result=await query(env,`INSERT INTO learning_costs(id,month,category,amount_micro,status,created_at)
    SELECT ?,?,?,?,'reserved',? FROM learning_months m WHERE m.month=?
    AND m.base_micro+COALESCE((SELECT SUM(amount_micro) FROM learning_costs WHERE month=m.month),0)+?<=m.limit_micro
    AND COALESCE((SELECT json_extract(value_json,'$.paused') FROM settings WHERE key='learning:control'),0)=0`,
    id,b.month,category,amount,nowIso(),b.month,amount).run();
  if(!result.meta.changes){await setSetting(env,'control',{paused:true,reason:'budget'});throw new BudgetPaused();}
  return id;
}
export async function settle(env, id, amount, usage = {}) {
  if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.ceil(amount)))throw new Error('Invalid measured cost');
  await query(env,"UPDATE learning_costs SET amount_micro=?,status='settled',usage_json=? WHERE id=? AND status IN ('reserved','uncertain')",Math.ceil(amount),JSON.stringify(usage),id).run();
  if((await budget(env)).remaining_micro===0) await setSetting(env,'control',{paused:true,reason:'budget'});
}
export async function uncertain(env, id) { await query(env,"UPDATE learning_costs SET status='uncertain' WHERE id=? AND status='reserved'",id).run(); }
export async function resume(env) {
  const b=await budget(env);
  if(b.remaining_micro===0) throw new BudgetPaused();
  await setSetting(env,'control',{paused:false});
  await query(env,"UPDATE learning_items SET status='queued',next_attempt_at=NULL,attempts=0 WHERE status='budget_paused'").run();
  return budget(env);
}
export async function saveConnection(env, name, value) {
  if (!env.RUN_TOKEN) throw new Error('RUN_TOKEN 未設定');
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.RUN_TOKEN)),{name:'AES-GCM'},false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value))));
  const sealed=JSON.stringify({iv:[...iv],data:[...cipher]});
  await query(env,'INSERT INTO learning_connections(name,sealed,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',name,sealed,nowIso()).run();
}
export async function connection(env, name) {
  const row=await query(env,'SELECT sealed FROM learning_connections WHERE name=?',name).first();
  if(!row)return null;
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.RUN_TOKEN)),{name:'AES-GCM'},false,['decrypt']);
  const data=JSON.parse(row.sealed);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(data.iv)},key,new Uint8Array(data.data))));
}

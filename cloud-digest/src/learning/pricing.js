import {query,rows,nowIso,monthKey,setting} from './store.js';
import {now} from './clock.js';

// X API 計價依據（查核日：2026-10-16，https://docs.x.com/x-api/getting-started/pricing）：
// Post 讀取 US$0.005／筆、User 讀取 US$0.010／筆、Owned Reads US$0.001／筆。
// 同一資源在同一個 UTC 日內重複讀取通常不再計費，但官方稱為 soft guarantee，不能把重讀風險直接歸零。
export const X_PRICING_CHECKED_AT='2026-10-16';
const micro=(value,fallback)=>{const n=value==null||value===''?fallback:Math.round(Number(value)*1e6);if(!Number.isSafeInteger(n)||n<0)throw new Error('X 計價設定無效');return n;};
export function xPricing(env={}){
  const fraction=env.X_REREAD_RISK_FRACTION==null||env.X_REREAD_RISK_FRACTION===''?0.05:Number(env.X_REREAD_RISK_FRACTION);
  if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw new Error('X_REREAD_RISK_FRACTION 需介於 0 與 1');
  return {checked_at:env.X_PRICING_CHECKED_AT || X_PRICING_CHECKED_AT,post_micro:micro(env.X_POST_READ_USD,5000),user_micro:micro(env.X_USER_READ_USD,10000),owned_micro:micro(env.X_OWNED_READ_USD,1000),
    reread_fraction:fraction,reread_daily_cap_micro:micro(env.X_REREAD_RISK_DAILY_USD,100000)};
}
export const utcDay=(time=now())=>new Date(time).toISOString().slice(0,10);

// Owned Reads 只用於官方列出的自身資源端點，且帳號必須是 app 擁有者（X_APP_OWNER_ID 由使用者確認後設定）。
export function ownedEligible(path,account,env){
  const match=/^\/users\/(\d+)\/(bookmarks|tweets|mentions|liked_tweets|followers|following|owned_lists|followed_lists|list_memberships|pinned_lists)$/.exec(path);
  return !!match && !!account?.user_id && match[1]===account.user_id && env.X_APP_OWNER_ID===account.user_id;
}

// 回傳尚未在這個 UTC 日讀過的資源，並把它們記為已讀。
export async function firstReads(env,type,ids,day=utcDay()){
  const unique=[...new Set(ids.filter(Boolean).map(String))];
  const seen=new Set();
  for(let i=0;i<unique.length;i+=90){
    const chunk=unique.slice(i,i+90);
    for(const row of await rows(env,`SELECT resource_id FROM learning_x_reads WHERE utc_day=? AND resource_type=? AND resource_id IN (${chunk.map(()=>'?').join(',')})`,day,type,...chunk))seen.add(row.resource_id);
  }
  const fresh=unique.filter(id=>!seen.has(id)),time=nowIso();
  // D1 單一查詢最多 100 個綁定參數：每列 4 個，一次最多寫 25 列。
  for(let i=0;i<fresh.length;i+=25){
    const chunk=fresh.slice(i,i+25);
    await query(env,`INSERT OR IGNORE INTO learning_x_reads(utc_day,resource_type,resource_id,first_read_at) VALUES ${chunk.map(()=>'(?,?,?,?)').join(',')}`,...chunk.flatMap(id=>[day,type,id,time])).run();
  }
  return {first:fresh.length,reread:unique.length-fresh.length};
}

// 重讀風險：每筆重讀按比例估算，並受每日上限限制；記為未確認成本，可再與供應商用量核對。
export async function rereadRisk(env,count,rate,day=utcDay()){
  const pricing=xPricing(env);
  if(!count||!pricing.reread_fraction)return 0;
  const wanted=Math.ceil(count*rate*pricing.reread_fraction);
  await query(env,'INSERT OR IGNORE INTO learning_x_days(utc_day,reread_risk_micro) VALUES(?,0)',day).run();
  const used=(await query(env,'SELECT reread_risk_micro FROM learning_x_days WHERE utc_day=?',day).first()).reread_risk_micro;
  const amount=Math.max(0,Math.min(wanted,pricing.reread_daily_cap_micro-used));
  if(amount)await query(env,'UPDATE learning_x_days SET reread_risk_micro=reread_risk_micro+? WHERE utc_day=?',amount,day).run();
  return amount;
}

export async function recordCost(env,category,amount,status,usage={}){
  await query(env,'INSERT INTO learning_costs(id,month,category,amount_micro,status,usage_json,created_at) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),monthKey(),category,amount,status,JSON.stringify(usage),nowIso()).run();
}

// 管理頁用的月預算明細（台灣曆月）：已結算估算、預留、未確認與人工核對調整分開列出。
export async function budgetSummary(env,base){
  const lines=await rows(env,'SELECT category,status,SUM(amount_micro) AS amount_micro,COUNT(*) AS count FROM learning_costs WHERE month=? GROUP BY category,status ORDER BY category,status',base.month);
  const total=status=>lines.filter(l=>l.status===status).reduce((n,l)=>n+l.amount_micro,0);
  const control=await setting(env,'control');
  return {...base,pause_reason:control.paused?control.reason || 'manual':null,
    totals:{settled_micro:total('settled'),reserved_micro:total('reserved'),uncertain_micro:total('uncertain'),adjustment_micro:total('adjustment')},
    categories:lines,x_pricing:xPricing(env)};
}

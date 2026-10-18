import {query,rows,hash,nowIso} from './store.js';

const STATES={queued:'等待處理',processing:'處理中',waiting_local:'等待本機',generating:'本機生成中',error:'待重試',needs_attention:'需要處理',budget_paused:'費用暫停',paused:'手動暫停',awaiting_backfill:'等待確認回補'};

// 只看來源內容與缺漏；模型、提示版本或格式改變不算內容更新。
export async function contentFingerprint(sources,gaps=[],mediaIds=[]){
  return hash(JSON.stringify({sources:sources.map(s=>({url:s.url,relation:s.relation,content:s.content})).sort((a,b)=>(a.url+a.relation).localeCompare(b.url+b.relation)),
    gaps:gaps.map(g=>({url:g.url,error:g.error})).sort((a,b)=>(a.url+a.error).localeCompare(b.url+b.error)),media:[...mediaIds].sort()}));
}

function baseUrl(env){
  if(!env.PUBLIC_BASE_URL)throw new Error('PUBLIC_BASE_URL 未設定，無法建立私人文章連結');
  const base=new URL(env.PUBLIC_BASE_URL);
  if(base.protocol!=='https:' || base.username || base.password)throw new Error('PUBLIC_BASE_URL 需為 HTTPS');
  return base.origin;
}

export function articleMessage(env,row,kind){
  const article=JSON.parse(row.article_json || '{}'),gaps=JSON.parse(row.gaps_json || '[]');
  const lines=[`${kind==='update'?'【更新】':kind==='merged'?'【已在文章庫】':''}${row.title.slice(0,120)}`,'',(article.intro || '').slice(0,800)];
  if(kind==='merged')lines.push('','你收藏或分享的 X 貼文連到這篇已整理的文章，已把貼文加進同一篇的來源，不重新生成。');
  if(kind==='update')lines.push('','補到新的來源或修復缺漏，已更新同一篇文章；舊版、筆記與已讀狀態都保留。');
  if(gaps.length)lines.push('',`來源有 ${gaps.length} 項缺漏，詳見文章上方說明。`);
  lines.push('',`完整文章：${baseUrl(env)}/learning?article=${row.id}`);
  return lines.join('\n');
}

// 建立待送通知：每篇文章每個版本最多一則，與收件入口無關。
export async function queueArticleNotifications(env){
  // 舊流程只在收件紀錄上標記已通知，兩邊都要算，避免搬移後重送。
  const candidates=await rows(env,`SELECT * FROM (SELECT i.*,MAX(i.notified_revision,COALESCE((SELECT MAX(notify_revision) FROM learning_intakes k WHERE k.item_id=i.id),0)) AS sent_revision
    FROM learning_items i WHERE status IN ('ready','partial') AND edition='detailed' AND EXISTS(SELECT 1 FROM learning_intakes k WHERE k.item_id=i.id)) WHERE revision>sent_revision ORDER BY updated_at`);
  for(const row of candidates){
    const article=JSON.parse(row.article_json || '{}');
    if(row.sent_revision>0 && row.notified_content && article.content_fingerprint===row.notified_content){
      await query(env,'UPDATE learning_items SET notified_revision=? WHERE id=? AND notified_revision<?',row.revision,row.id,row.revision).run();
      continue;
    }
    const kind=row.sent_revision>0?'update':'complete';
    await query(env,'INSERT OR IGNORE INTO learning_deliveries(id,item_ids_json,origin,body,created_at) VALUES(?,?,?,?,?)',
      await hash(`article:${row.id}:${row.revision}`),JSON.stringify([{id:row.id,revision:row.revision,content:article.content_fingerprint || null}]),kind,articleMessage(env,row,kind),nowIso()).run();
  }
}

// 送出已保存的通知內容；失敗只重送同一份內容，不重新生成。
export async function sendPending(env,send){
  for(const delivery of await rows(env,"SELECT * FROM learning_deliveries WHERE status='pending' AND origin!='receipt' ORDER BY created_at")){
    const lease=new Date(Date.now()+60000).toISOString();
    const acquired=await query(env,"UPDATE learning_deliveries SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?)",lease,delivery.id,nowIso()).run();
    if(!acquired.meta.changes)continue;
    try{
      const messageId=await send(env,delivery.body);
      const items=JSON.parse(delivery.item_ids_json);
      await env.DB.batch([
        query(env,"UPDATE learning_deliveries SET status='sent',message_id=?,last_error=NULL WHERE id=?",messageId,delivery.id),
        ...items.map(i=>query(env,'UPDATE learning_items SET notified_revision=MAX(notified_revision,?),notified_content=COALESCE(?,notified_content) WHERE id=?',i.revision,i.content || null,i.id)),
        ...items.map(i=>query(env,'UPDATE learning_intakes SET notify_revision=MAX(notify_revision,?) WHERE item_id=?',i.revision,i.id)),
      ]);
    }catch(error){await query(env,'UPDATE learning_deliveries SET last_error=? WHERE id=?',error.message,delivery.id).run();throw error;}
    finally{await query(env,'UPDATE learning_deliveries SET lease_until=NULL WHERE id=? AND lease_until=?',delivery.id,lease).run();}
  }
}

// Telegram 收件回覆：已整理過的連結直接給既有文章入口，處理中的回報目前狀態。
export async function receiptMessage(env,ids){
  let origin=null;try{origin=baseUrl(env);}catch{}
  const lines=[`已收到 ${ids.length} 個連結並保存。`];
  for(const id of ids){
    const row=await query(env,'SELECT id,url,title,status FROM learning_items WHERE id=?',id).first();
    if(!row)continue;
    const label=(row.title || row.url).slice(0,80),link=origin?`\n${origin}/learning?article=${row.id}`:'';
    if(['ready','partial'].includes(row.status))lines.push(`・已整理過：${label}${link}`);
    else lines.push(`・${STATES[row.status] || '處理中'}：${label}`);
  }
  lines.push('新文章完成後會另外通知；預算暫停時，工作仍會保留。');
  return lines.join('\n').slice(0,4000);
}

import {query,rows,setting,setSetting,hash,item,evidence,saveEvidence,connection,lock,unlock,nowIso,budget,BudgetPaused} from './store.js';
import {canonicalUrl,apiJson} from './network.js';
import {acquireEvidence,resetIncomplete} from './evidence.js';
import {prepareMedia,expireMedia} from './media.js';
import {generate} from './gemini.js';
import {syncBookmarks,registerMedia} from './x.js';

export function createLearningService(deps={}) {
  const fetcher=deps.fetcher || fetch;
  async function enqueue(env,id){if(env.LEARNING_JOBS)await env.LEARNING_JOBS.send({kind:'article',id});}
  async function collect(env,value,origin='share',receipt=null,options={}) {
    const url=canonicalUrl(value),id=(await hash(url)).slice(0,32),time=nowIso();
    await query(env,`INSERT OR IGNORE INTO learning_items(id,url,kind,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`,id,url,new URL(url).hostname==='x.com'?'x':'web',options.defer?'awaiting_backfill':'queued',time,time).run();
    await query(env,'INSERT OR IGNORE INTO learning_intakes(receipt,item_id,origin,created_at) VALUES(?,?,?,?)',receipt || crypto.randomUUID(),id,origin,time).run();
    if(origin==='share')await query(env,"UPDATE learning_items SET status='queued' WHERE id=? AND status='awaiting_backfill'",id).run();
    if(options.source){const key=await saveEvidence(env,id,options.source);await registerMedia(env,id,key,options.source.media);}
    const current=await item(env,id);
    if(!options.defer && ['queued','error'].includes(current.status))await enqueue(env,id);
    return id;
  }
  async function process(env,id) {
    const row=await item(env,id);
    if(!row || ['awaiting_backfill','needs_attention','budget_paused'].includes(row.status))return {waiting:true};
    if(['ready','partial'].includes(row.status))return {done:true};
    const lease=await lock(env,id);
    if(!lease)return {pending:true};
    try {
      if((await budget(env)).paused)throw new BudgetPaused();
      await query(env,"UPDATE learning_items SET status='processing' WHERE id=?",id).run();
      const acquisition=await acquireEvidence(env,row,deps);
      if(acquisition.pending){await query(env,"UPDATE learning_items SET status='queued',next_attempt_at=? WHERE id=?",new Date(Date.now()+60000).toISOString(),id).run();return {pending:true};}
      const media=await (deps.prepareMedia || prepareMedia)(env,id,fetcher);
      if(media.pending){await query(env,"UPDATE learning_items SET status='queued',next_attempt_at=? WHERE id=?",new Date(Date.now()+60000).toISOString(),id).run();return {pending:true};}
      const sources=acquisition.sources.filter(s=>s.status==='available'&&s.content);
      const gaps=[...acquisition.sources.filter(s=>s.status!=='available').map(s=>({url:s.url,error:JSON.parse(s.metadata_json).error || '來源不可取得'})),...media.gaps];
      const fingerprint=await hash(JSON.stringify({sources:sources.map(s=>({id:s.id,content:s.content,relation:s.relation,author_id:s.author_id,published_at:s.published_at,metadata_json:s.metadata_json})),media:media.media.map(m=>m.id),gaps,model:env.LEARNING_MODEL || 'gemini-3.8-flash',prompt_version:'learning-v1'}));
      const old=row.article_json?JSON.parse(row.article_json):null;
      const article=old?.input_fingerprint===fingerprint?old:await (deps.generate || generate)(env,sources,media.media,gaps,null,fetcher);
      const revision=old?.input_fingerprint===fingerprint?row.revision:row.revision+1;
      article.input_fingerprint=fingerprint;
      article.provider=env.LEARNING_DEMO==='true'?'demo':'gemini';
      article.model=env.LEARNING_MODEL || 'gemini-3.8-flash';
      article.prompt_version='learning-v1';
      if(!article.generated_at)article.generated_at=nowIso();
      await query(env,`UPDATE learning_items SET title=?,body=?,article_json=?,gaps_json=?,status=?,revision=?,attempts=0,last_error=NULL,next_attempt_at=NULL,updated_at=?,recheck_at=COALESCE(recheck_at,?) WHERE id=?`,
        article.title,article.body,JSON.stringify(article),JSON.stringify(gaps),gaps.length?'partial':'ready',revision,nowIso(),row.kind==='x'?new Date(Date.now()+86400000).toISOString():null,id).run();
      return {done:true};
    }catch(error){
      const paused=error.name==='BudgetPaused',attempts=row.attempts+1;
      await query(env,'UPDATE learning_items SET status=?,attempts=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?',paused?'budget_paused':attempts>=3?'needs_attention':'error',attempts,error.message,new Date(Date.now()+Math.min(3600,60*2**attempts)*1000).toISOString(),nowIso(),id).run();
      if(paused)return {waiting:true};
      throw error;
    }finally{await unlock(env,id,lease);}
  }
  async function sync(env){return syncBookmarks(env,{...deps,collect});}
  async function backfill(env){
    const state=await setting(env,'sync');
    state.backfill_approved=true;await setSetting(env,'sync',state);
    await query(env,"UPDATE learning_items SET status='queued' WHERE status='awaiting_backfill'").run();
    await recover(env);return state;
  }
  async function recover(env){
    if((await budget(env)).paused)return;
    for(const row of await rows(env,"SELECT id FROM learning_items WHERE status IN ('queued','error','processing') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (lease_until IS NULL OR lease_until<?) LIMIT 100",nowIso(),nowIso()))await enqueue(env,row.id);
  }
  async function send(env,text) {
    if(deps.sendTelegram)return deps.sendTelegram(env,text);
    if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw new Error('Telegram 通知設定未完成');
    const result=await apiJson(await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text,link_preview_options:{is_disabled:true}})}),64000);
    if(!result.ok || !result.result?.message_id)throw new Error('Telegram 通知未確認成功');
    return result.result.message_id;
  }
  async function receipt(env,chatId,ids,key){
    if(!ids.length)return;
    const id=await hash(`receipt:${key}`);
    await query(env,"INSERT OR IGNORE INTO learning_deliveries(id,item_ids_json,origin,body,chat_id,created_at) VALUES(?,?,'receipt',?,?,?)",id,JSON.stringify(ids),`已收到 ${ids.length} 個連結並保存。完成後會通知你；預算暫停時，工作仍會保留。`,String(chatId),nowIso()).run();
    await flushReceipts(env);
  }
  async function flushReceipts(env){
    for(const d of await rows(env,"SELECT * FROM learning_deliveries WHERE origin='receipt' AND status='pending'")){
      const lease=new Date(Date.now()+60000).toISOString();
      const acquired=await query(env,"UPDATE learning_deliveries SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?)",lease,d.id,nowIso()).run();
      if(!acquired.meta.changes)continue;
      try{
        const messageId=await send({...env,TELEGRAM_CHAT_ID:d.chat_id},d.body);
        await query(env,"UPDATE learning_deliveries SET status='sent',message_id=? WHERE id=?",messageId,d.id).run();
      }finally{await query(env,'UPDATE learning_deliveries SET lease_until=NULL WHERE id=? AND lease_until=?',d.id,lease).run();}
    }
  }
  async function flush(env,origin='share') {
    if(!env.PUBLIC_BASE_URL)throw new Error('PUBLIC_BASE_URL 未設定，無法建立私人文章連結');
    const base=new URL(env.PUBLIC_BASE_URL);
    if(base.protocol!=='https:' || base.username || base.password)throw new Error('PUBLIC_BASE_URL 需為 HTTPS');
    const existing=await rows(env,"SELECT * FROM learning_deliveries WHERE status='pending' AND origin=? ORDER BY created_at",origin);
    const occupied=new Set(existing.flatMap(d=>JSON.parse(d.item_ids_json).map(i=>i.id)));
    const items=await rows(env,`SELECT DISTINCT a.* FROM learning_items a JOIN learning_intakes i ON a.id=i.item_id WHERE a.status IN ('ready','partial') AND i.notify_revision<a.revision AND ${origin==='share'?"i.origin='share'":"i.origin IN ('bookmark','backfill')"} ORDER BY a.created_at`);
    let group=[],body='';
    async function store(){
      if(!group.length)return;
      const id=await hash(`${origin}:${JSON.stringify(group)}`);
      await query(env,'INSERT OR IGNORE INTO learning_deliveries(id,item_ids_json,origin,body,created_at) VALUES(?,?,?,?,?)',id,JSON.stringify(group),origin,body,nowIso()).run();group=[];body='';
    }
    for(const row of items.filter(i=>!occupied.has(i.id))){
      const article=JSON.parse(row.article_json);
      const line=`${row.title.slice(0,100)}${row.status==='partial'?'（來源有缺漏）':''}\n${article.intro.slice(0,500)}\n${base.origin}/learning?article=${row.id}\n\n`;
      if(body.length+line.length>3900 || origin==='share')await store();
      body+=line;group.push({id:row.id,revision:row.revision});
    }
    await store();
    for(const delivery of await rows(env,"SELECT * FROM learning_deliveries WHERE status='pending' AND origin=? ORDER BY created_at",origin)){
      const lease=new Date(Date.now()+60000).toISOString();
      const acquired=await query(env,"UPDATE learning_deliveries SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?)",lease,delivery.id,nowIso()).run();
      if(!acquired.meta.changes)continue;
      try{
        const messageId=await send(env,delivery.body);
        await env.DB.batch([
          query(env,"UPDATE learning_deliveries SET status='sent',message_id=?,last_error=NULL WHERE id=?",messageId,delivery.id),
          ...JSON.parse(delivery.item_ids_json).map(i=>query(env,`UPDATE learning_intakes SET notify_revision=MAX(notify_revision,?) WHERE item_id=? AND ${origin==='share'?"origin='share'":"origin IN ('bookmark','backfill')"}`,i.revision,i.id)),
        ]);
      }catch(error){await query(env,'UPDATE learning_deliveries SET last_error=? WHERE id=?',error.message,delivery.id).run();throw error;}
      finally {await query(env,'UPDATE learning_deliveries SET lease_until=NULL WHERE id=? AND lease_until=?',delivery.id,lease).run();}
    }
  }
  async function ask(env,question,articleId=null) {
    if(typeof question!=='string'||!question.trim()||question.length>2000)throw new Error('問題需為 1–2,000 個字元');
    const terms=[...new Set([...new Intl.Segmenter('zh-TW',{granularity:'word'}).segment(question)].filter(s=>s.isWordLike&&s.segment.length>=2).map(s=>s.segment.toLowerCase()))].slice(0,12);
    const rank=terms.length?terms.map(()=>"CASE WHEN instr(lower(e.content),?)>0 THEN 1 ELSE 0 END").join('+'):'0';
    const selected=await rows(env,`SELECT e.id,e.item_id,e.url,e.relation,e.author_id,e.published_at,(${rank}) AS score FROM learning_evidence e JOIN learning_items a ON a.id=e.item_id WHERE e.status='available' AND a.body IS NOT NULL ${articleId?'AND a.id=?':''} ${!articleId?'AND score>0':''} ORDER BY score DESC,a.updated_at DESC LIMIT 12`,...terms,...(articleId?[articleId]:[]));
    if(!selected.length)return {answer:'目前沒有找到足夠的已保存來源，無法確認。請提供更具體的關鍵字或選擇文章。',insufficient:true,citations:[],sources:[]};
    const chunks=[];
    for(const s of selected){
      const positions=terms.length?terms.map(()=>"CASE WHEN instr(lower(content),?)>0 THEN instr(lower(content),?) ELSE 2147483647 END").join(','):'';
      const first=terms.length?(terms.length===1?positions:`min(${positions})`):'1';
      const positionArgs=terms.flatMap(t=>[t,t]);
      const match=await query(env,`SELECT ${first} AS position FROM learning_evidence WHERE id=?`,...positionArgs,s.id).first();
      const start=match.position===2147483647?0:Math.max(0,match.position-1-2000);
      const excerpt=await query(env,'SELECT substr(content,?,12000) AS content FROM learning_evidence WHERE id=?',start+1,s.id).first();
      chunks.push({...s,id:`${s.id}:${start}`,content:excerpt.content,range_start:start});
      const row=await query(env,"SELECT json_extract(article_json,'$.observations') AS observations FROM learning_items WHERE id=?",s.item_id).first();
      const observations=JSON.parse(row.observations || '[]').filter(o=>o.source_id===s.id);
      if(observations.length)chunks.push({...s,id:`${s.id}:observations`,relation:'model_media_observation',content:JSON.stringify(observations)});
    }
    const gaps=[];
    for(const id of new Set(selected.map(s=>s.item_id))){
      const row=await query(env,'SELECT gaps_json FROM learning_items WHERE id=?',id).first();
      gaps.push(...JSON.parse(row.gaps_json || '[]'));
    }
    const answer=await (deps.generate || generate)(env,chunks,[],gaps,question,fetcher);
    if(answer.citations.some(id=>!chunks.some(s=>s.id===id)))throw new Error('回答引用了未檢索的來源');
    const result={...answer,sources:chunks.filter(s=>answer.citations.includes(s.id)).map(s=>({id:s.id,url:s.url,relation:s.relation,range_start:s.range_start || 0,excerpt:s.content.slice(0,500)}))};
    await query(env,'INSERT INTO learning_questions(id,item_id,question,answer_json,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),articleId,question,JSON.stringify(result),nowIso()).run();
    return result;
  }
  async function scheduled(env,daily=false){
    if(daily){
      await setSetting(env,'notifications',{bookmark_batch_open:true});
      if(env.LEARNING_JOBS&&env.X_CLIENT_ID&&env.X_CLIENT_SECRET&&await connection(env,'x')&&!(await setting(env,'sync')).requires_action)await env.LEARNING_JOBS.send({kind:'sync'});
      for(const row of await rows(env,"SELECT id FROM learning_items WHERE kind='x' AND recheck_at<=? AND rechecked=0 AND status IN ('ready','partial') LIMIT 100",nowIso())){
        await resetIncomplete(env,row.id,true);await query(env,"UPDATE learning_items SET status='queued' WHERE id=?",row.id).run();
      }
    }
    await recover(env);
    const syncState=await setting(env,'sync');
    if(syncState.running&&env.LEARNING_JOBS&&!(await budget(env)).paused)await env.LEARNING_JOBS.send({kind:'sync'});
    await expireMedia(env);
    await query(env,'DELETE FROM learning_sessions WHERE expires_at<?',nowIso()).run();
    await flushReceipts(env);
    await flush(env,'share');
    if((await setting(env,'notifications')).bookmark_batch_open)await flush(env,'bookmarks');
  }
  async function queue(batch,env){
    for(const message of batch.messages){
      try {
        const result=message.body.kind==='sync'?await sync(env):await process(env,message.body.id);
        await flush(env,'share');
        if((await setting(env,'notifications')).bookmark_batch_open)await flush(env,'bookmarks');
        if(result.pending || result.running)message.retry({delaySeconds:60});else message.ack();
      }catch(error){
        if(error.name==='BudgetPaused')message.ack();
        else message.retry({delaySeconds:300});
        console.log(JSON.stringify({event:'learning_task_failed',kind:message.body.kind,error:error.name==='BudgetPaused'?'budget_paused':'processing_failed'}));
      }
    }
  }
  return {collect,process,sync,backfill,recover,flush,ask,scheduled,queue,enqueue,receipt};
}

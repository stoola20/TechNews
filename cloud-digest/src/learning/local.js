import {query,rows,item,hash,nowIso,setting,setSetting,manuallyPaused} from './store.js';
import {ARTICLE_PROMPT_VERSION,validateArticle} from './local-prompt.js';
import {saveVersion} from './library.js';
import {normalizeMarkdown} from './markdown.js';

export const LEASE_MS=120000;
export const RUNNER_ONLINE_MS=180000;
export const MAX_MODEL_ATTEMPTS=3;
// 數字越小越優先：追問、主動分享、例行官方／新書籤、舊回補。
export const PRIORITY={question:0,share:1,web:1,official:2,bookmark:2,backfill:3};

export class JobConflict extends Error{constructor(message,code){super(message);this.name='JobConflict';this.code=code;}}

export async function textProvider(env){
  const saved=await setting(env,'text',{});
  return saved.provider || env.LEARNING_TEXT_PROVIDER || 'gemini';
}
export async function setTextProvider(env,provider){
  if(!['gemini','local'].includes(provider))throw new Error('文字模型只能選 gemini 或 local');
  await setSetting(env,'text',{provider,updated_at:nowIso()});
  return provider;
}
export const localModel=env=>env.LOCAL_TEXT_MODEL || 'gemma4:26b';

export async function itemPriority(env,itemId){
  const origins=(await rows(env,'SELECT DISTINCT origin FROM learning_intakes WHERE item_id=?',itemId)).map(r=>r.origin);
  return Math.min(3,...origins.map(o=>PRIORITY[o] ?? 2));
}

export async function articleInput(env,row,sources,gaps,extra={}){
  const input={kind:'article',prompt_version:ARTICLE_PROMPT_VERSION,
    sources:sources.map((s,i)=>{const metadata=JSON.parse(s.metadata_json || '{}');return {ref:`S${i+1}`,id:s.id,relation:s.relation,url:s.url,author:metadata.author_username || s.author_id || null,published_at:s.published_at,title:metadata.title || null,content:s.content};}),
    gaps:gaps.map(g=>({url:g.url,error:g.error})),...extra};
  const fingerprint=await hash(JSON.stringify({input,provider:'ollama',model:localModel(env)}));
  return {input,fingerprint};
}

// 同一輸入版本只保留一份工作；輸入改變時，舊工作標為 superseded，舊回報不能覆寫新文章。
// 呼叫端只在目前文章不是這個輸入版本時才建立工作，因此已完成的同版本工作會重新排隊。
export async function ensureJob(env,{kind,itemId=null,questionId=null,priority,input,fingerprint}){
  const id=(await hash(`${kind}:${itemId || questionId}:${fingerprint}`)).slice(0,32),time=nowIso();
  await query(env,`UPDATE learning_jobs SET status='superseded',attempt_token=NULL,lease_until=NULL,updated_at=? WHERE ${itemId?'item_id':'question_id'}=? AND kind=? AND id!=? AND status IN ('waiting_local','leased')`,time,itemId || questionId,kind,id).run();
  await query(env,`INSERT INTO learning_jobs(id,kind,item_id,question_id,status,priority,input_version,input_json,created_at,updated_at) VALUES(?,?,?,?,'waiting_local',?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=CASE WHEN learning_jobs.status IN ('failed','superseded','done') THEN 'waiting_local' ELSE learning_jobs.status END,
      attempt_token=CASE WHEN learning_jobs.status IN ('failed','superseded','done') THEN NULL ELSE learning_jobs.attempt_token END,
      attempts=CASE WHEN learning_jobs.status IN ('failed','superseded','done') THEN 0 ELSE learning_jobs.attempts END,priority=MIN(learning_jobs.priority,excluded.priority),updated_at=excluded.updated_at`,
    id,kind,itemId,questionId,priority,fingerprint,JSON.stringify(input),time,time).run();
  return id;
}

export async function touchRunner(env,runnerId,info={}){
  if(typeof runnerId!=='string' || !/^[A-Za-z0-9._-]{1,64}$/.test(runnerId))throw new Error('runner_id 格式無效');
  const safe={version:String(info.version || '').slice(0,40),model:String(info.model || '').slice(0,80),model_digest:String(info.model_digest || '').slice(0,80),ollama:info.ollama==null?null:!!info.ollama,state:String(info.state || '').slice(0,40)};
  await query(env,'INSERT INTO learning_runners(id,last_seen_at,info_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,info_json=excluded.info_json',runnerId,nowIso(),JSON.stringify(safe)).run();
}

// 公平排隊：每等待 LOCAL_AGING_MINUTES 分鐘，有效優先順序提前一級，背景回補不會永久排不到。
export const agingMinutes=env=>Math.max(1,Number(env.LOCAL_AGING_MINUTES || 30));
export function effectivePriority(job,env,now=Date.now()){
  const waited=Math.max(0,now-Date.parse(job.created_at))/60000;
  return job.priority-Math.floor(waited/agingMinutes(env));
}
export async function queueOrder(env,now=nowIso()){
  const candidates=await rows(env,`SELECT id,kind,item_id,question_id,status,attempt_token,runner_id,lease_until,priority,created_at FROM learning_jobs
    WHERE status='waiting_local' OR (status='leased' AND lease_until<=?) ORDER BY priority,created_at LIMIT 500`,now);
  const time=Date.parse(now);
  return candidates.map(c=>({...c,effective_priority:effectivePriority(c,env,time)})).sort((a,b)=>a.effective_priority-b.effective_priority || a.created_at.localeCompare(b.created_at));
}

// 全域單工：仍有有效 lease 時不發出第二份工作。
export async function claim(env,runnerId,info={}){
  await touchRunner(env,runnerId,info);
  if(await manuallyPaused(env))return null;
  const now=nowIso();
  const held=await query(env,"SELECT id,status,attempt_token,priority,created_at,runner_id FROM learning_jobs WHERE status='leased' AND lease_until>? LIMIT 1",now).first();
  // 同一執行器重新啟動後，原本的領取已不在記憶體中：改發新 attempt token，舊 token 的回報會被拒絕。
  if(held && held.runner_id!==runnerId)return null;
  for(const candidate of held?[held]:(await queueOrder(env,now)).slice(0,20)){
    const token=crypto.randomUUID(),lease=new Date(Date.now()+LEASE_MS).toISOString();
    const expired=candidate.status==='leased';
    const result=await query(env,`UPDATE learning_jobs SET status='leased',attempt_token=?,runner_id=?,lease_until=?,leased_at=?,updated_at=?,lease_expirations=lease_expirations+?
      WHERE id=? AND status=? AND COALESCE(attempt_token,'')=? AND NOT EXISTS(SELECT 1 FROM learning_jobs WHERE status='leased' AND lease_until>? AND id!=?)`,
      token,runnerId,lease,now,now,expired&&!held?1:0,candidate.id,candidate.status,candidate.attempt_token || '',now,candidate.id).run();
    if(!result.meta.changes)continue;
    const job=await query(env,'SELECT * FROM learning_jobs WHERE id=?',candidate.id).first();
    if(job.item_id)await query(env,"UPDATE learning_items SET status='generating',updated_at=? WHERE id=? AND status IN ('waiting_local','generating')",now,job.item_id).run();
    if(job.question_id)await query(env,"UPDATE learning_questions SET status='generating',updated_at=? WHERE id=? AND status IN ('waiting_local','generating')",now,job.question_id).run();
    return {id:job.id,kind:job.kind,attempt_token:token,input_version:job.input_version,lease_until:lease,lease_ms:LEASE_MS,input:JSON.parse(job.input_json)};
  }
  return null;
}

async function activeJob(env,jobId,token){
  const job=await query(env,'SELECT * FROM learning_jobs WHERE id=?',jobId).first();
  if(!job)throw new JobConflict('工作不存在','not_found');
  if(job.status!=='leased' || job.attempt_token!==token)throw new JobConflict('這次領取已失效，結果不會寫入','lease_lost');
  return job;
}

export async function heartbeat(env,runnerId,info,jobId,token){
  await touchRunner(env,runnerId,info);
  if(!jobId)return {ok:true};
  await activeJob(env,jobId,token);
  const lease=new Date(Date.now()+LEASE_MS).toISOString();
  const result=await query(env,"UPDATE learning_jobs SET lease_until=?,updated_at=? WHERE id=? AND status='leased' AND attempt_token=?",lease,nowIso(),jobId,token).run();
  if(!result.meta.changes)throw new JobConflict('這次領取已失效，結果不會寫入','lease_lost');
  return {ok:true,lease_until:lease};
}

// 模型或格式失敗才計入嘗試次數；Mac 離線與 lease 到期不算。
export async function fail(env,jobId,token,error,retryable=true){
  const job=await activeJob(env,jobId,token);
  const attempts=job.attempts+1,final=!retryable || attempts>=MAX_MODEL_ATTEMPTS,message=String(error || '本機模型處理失敗').slice(0,500),time=nowIso();
  await env.DB.batch([
    query(env,`UPDATE learning_jobs SET status=?,attempts=?,last_error=?,attempt_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND attempt_token=?`,final?'failed':'waiting_local',attempts,message,time,jobId,token),
    ...(job.item_id?[query(env,'UPDATE learning_items SET status=?,last_error=?,updated_at=? WHERE id=? AND status IN (\'waiting_local\',\'generating\')',final?'needs_attention':'waiting_local',message,time,job.item_id)]:[]),
    ...(job.question_id?[query(env,"UPDATE learning_questions SET status=?,error=?,updated_at=? WHERE id=? AND status IN ('waiting_local','generating')",final?'failed':'waiting_local',message,time,job.question_id)]:[]),
  ]);
  return {ok:true,final,attempts};
}

// 本機暫時無法執行（Ollama 停止、網路中斷）：交回工作但不增加模型失敗次數。
export async function release(env,jobId,token,error){
  const job=await activeJob(env,jobId,token),time=nowIso();
  await env.DB.batch([
    query(env,"UPDATE learning_jobs SET status='waiting_local',attempt_token=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE id=? AND attempt_token=?",String(error || '本機暫時無法處理').slice(0,300),time,jobId,token),
    ...(job.item_id?[query(env,"UPDATE learning_items SET status='waiting_local',updated_at=? WHERE id=? AND status='generating'",time,job.item_id)]:[]),
    ...(job.question_id?[query(env,"UPDATE learning_questions SET status='waiting_local',updated_at=? WHERE id=? AND status='generating'",time,job.question_id)]:[]),
  ]);
  return {ok:true};
}

export async function complete(env,data,hooks={}){
  const job=await query(env,'SELECT * FROM learning_jobs WHERE id=?',data.job_id).first();
  if(!job)throw new JobConflict('工作不存在','not_found');
  // 回報重播：同一次領取已寫入時直接回成功，不重複套用。
  if(job.status==='done')
    if(job.attempt_token===data.attempt_token)return {ok:true,replay:true};
    else throw new JobConflict('工作已由其他領取完成','lease_lost');
  if(job.status!=='leased' || job.attempt_token!==data.attempt_token)throw new JobConflict('這次領取已失效，結果不會寫入','lease_lost');
  if(job.input_version!==data.input_version)throw new JobConflict('回報的輸入版本已過期','stale_input');
  const model=data.model || {};
  if(model.done_reason!=='stop'){await fail(env,job.id,job.attempt_token,'本機模型輸出未正常結束（可能超過輸出上限）');throw new JobConflict('模型輸出未完成，不能標為完成','incomplete');}
  const input=JSON.parse(job.input_json);
  if(job.kind==='article')return completeArticle(env,job,input,data,hooks);
  if(hooks.completeQuestion)return hooks.completeQuestion(env,job,input,data);
  throw new JobConflict('未知工作類型','invalid');
}

async function completeArticle(env,job,input,data,hooks){
  let validated;
  try{validated=validateArticle(input,data.output);}
  catch(error){await fail(env,job.id,job.attempt_token,error.message);const conflict=new JobConflict(error.message,'invalid_output');throw conflict;}
  const row=await item(env,job.item_id),time=nowIso(),model=data.model;
  const provenance={provider:'ollama',model:String(model.name || '').slice(0,80),model_digest:String(model.digest || '').slice(0,80) || null,prompt_version:input.prompt_version,
    input_fingerprint:job.input_version,generated_at:time,runner_id:job.runner_id,metrics:sanitizeMetrics(data.metrics)};
  if(validated.publish===false){
    await env.DB.batch([
      query(env,"UPDATE learning_jobs SET status='done',result_json=?,completed_at=?,updated_at=?,lease_until=NULL WHERE id=? AND status='leased' AND attempt_token=?",JSON.stringify({publish:false,reason:validated.reason}),time,time,job.id,job.attempt_token),
      query(env,"UPDATE learning_items SET status='filtered',stage=NULL,title=?,article_json=?,last_error=NULL,updated_at=? WHERE id=? AND revision=?",validated.title || row.title,JSON.stringify({...provenance,publish:false,reason:validated.reason}),time,row.id,row.revision),
    ]);
    return {ok:true,filtered:true};
  }
  const article={title:validated.title,body:normalizeMarkdown(validated.body),intro:validated.intro,citations:validated.citations,observations:input.observations || [],...(input.official?{publish:true,reason:validated.reason}:{}),...provenance};
  const gaps=input.gaps || [];
  if(row.body)await saveVersion(env,row,'superseded');
  const result=await env.DB.batch([
    query(env,"UPDATE learning_jobs SET status='done',result_json=?,completed_at=?,updated_at=?,lease_until=NULL,last_error=NULL WHERE id=? AND status='leased' AND attempt_token=?",JSON.stringify({revision:row.revision+1}),time,time,job.id,job.attempt_token),
    query(env,`UPDATE learning_items SET title=?,body=?,article_json=?,gaps_json=?,status=?,revision=revision+1,edition='detailed',stage=NULL,attempts=0,last_error=NULL,next_attempt_at=NULL,updated_at=?,
      recheck_at=COALESCE(recheck_at,?) WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM learning_jobs WHERE id=? AND status='done' AND attempt_token=?)`,
      article.title,article.body,JSON.stringify(article),JSON.stringify(gaps),gaps.length?'partial':'ready',time,row.kind==='x'?new Date(Date.now()+86400000).toISOString():null,row.id,row.revision,job.id,job.attempt_token),
  ]);
  if(!result[1].meta.changes)return {ok:true,replay:true};
  if(hooks.articleCompleted)await hooks.articleCompleted(env,row.id);
  return {ok:true,revision:row.revision+1};
}

function sanitizeMetrics(metrics={}){
  const out={};
  for(const key of ['prompt_tokens','output_tokens','load_ms','prompt_ms','generate_ms','total_ms','queue_ms','num_ctx','num_predict','estimated_tokens'])
    if(Number.isFinite(metrics?.[key]))out[key]=Math.round(metrics[key]);
  return out;
}

export async function runnerStatus(env){
  const runner=await query(env,'SELECT * FROM learning_runners ORDER BY last_seen_at DESC LIMIT 1').first();
  const counts=await rows(env,"SELECT status,COUNT(*) AS count FROM learning_jobs WHERE status IN ('waiting_local','leased','failed') GROUP BY status");
  const current=await query(env,"SELECT id,kind,item_id,question_id,leased_at,lease_until FROM learning_jobs WHERE status='leased' AND lease_until>? LIMIT 1",nowIso()).first();
  const lastSeen=runner?.last_seen_at || null;
  return {provider:await textProvider(env),model:localModel(env),last_seen_at:lastSeen,online:!!lastSeen && Date.now()-Date.parse(lastSeen)<RUNNER_ONLINE_MS,
    info:runner?JSON.parse(runner.info_json):null,jobs:Object.fromEntries(counts.map(c=>[c.status,c.count])),current,
    queue:(await queueOrder(env)).slice(0,20).map((j,i)=>({position:i+1,kind:j.kind,item_id:j.item_id,question_id:j.question_id,priority:j.priority,effective_priority:j.effective_priority,created_at:j.created_at}))};
}

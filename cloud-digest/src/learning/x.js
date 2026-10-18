import {apiJson} from './network.js';
import {connection,saveConnection,query,setting,setSetting,reserve,settle,uncertain,nowIso,saveEvidence,hash} from './store.js';
import {xPricing,ownedEligible,firstReads,rereadRisk,recordCost,utcDay} from './pricing.js';
import {xArticleUrl} from './local.js';

function clientHeaders(env) {
  if(!env.X_CLIENT_ID || !env.X_CLIENT_SECRET)throw new Error('X_CLIENT_ID／X_CLIENT_SECRET 未設定');
  return {'content-type':'application/x-www-form-urlencoded',authorization:`Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`};
}
export async function exchange(env,params,fetcher=fetch) {
  return apiJson(await fetcher('https://api.x.com/2/oauth2/token',{method:'POST',headers:clientHeaders(env),body:new URLSearchParams(params),signal:AbortSignal.timeout(30000)}),64000);
}
export async function accessToken(env,fetcher=fetch) {
  const value=await connection(env,'x');
  if(!value)throw new Error('尚未連接 X 帳號');
  if(value.expires_at>Date.now()+60000)return value.access_token;
  if(!value.refresh_token)throw new Error('X 授權已到期，請重新連接');
  const result=await exchange(env,{grant_type:'refresh_token',refresh_token:value.refresh_token},fetcher);
  if(!result.access_token)throw new Error('X 授權刷新失敗');
  await saveConnection(env,'x',{...value,...result,expires_at:Date.now()+(result.expires_in || 7200)*1000});
  return result.access_token;
}
export function postParameters(env) {
  const modern=env.X_API_FIELDS_STYLE!=='tweet';
  // article 欄位已實測兩種參數名稱都接受，連到 X 長文的貼文會附上長文全文。
  return {[modern?'post.fields':'tweet.fields']:`author_id,conversation_id,created_at,entities,attachments,article,${modern?'note_post,referenced_posts':'note_tweet,referenced_tweets'}`,
    expansions:'attachments.media_keys','media.fields':'type,url,preview_image_url,variants,duration_ms,alt_text'};
}
export async function xRead(env,path,params={},maximum=1,owned=false,fetcher=fetch,token=null) {
  const auth=token || await accessToken(env,fetcher);
  const account=await connection(env,'x');
  const pricing=xPricing(env);
  const users=/^\/users\/(?:me|\d+)$/.test(path);
  // owned 只表示呼叫端預期是自身資源；實際費率仍依端點與 app 擁有者條件判斷。
  const discounted=owned && ownedEligible(path,account,env);
  const rate=users?pricing.user_micro:discounted?pricing.owned_micro:pricing.post_micro;
  const id=await reserve(env,'x',maximum*rate);
  try {
    const url=new URL(`https://api.x.com/2${path}`);
    for(const [k,v] of Object.entries(params))if(v!=null)url.searchParams.set(k,String(v));
    const data=await apiJson(await fetcher(url.href,{headers:{authorization:`Bearer ${auth}`},signal:AbortSignal.timeout(30000)}),4000000);
    const primary=(Array.isArray(data.data)?data.data:data.data?[data.data]:[]).map(r=>r.id);
    const includedPosts=(data.includes?.posts || data.includes?.tweets || []).map(r=>r.id);
    const includedUsers=(data.includes?.users || []).map(r=>r.id);
    const day=utcDay();
    const main=await firstReads(env,users?'user':'post',primary,day);
    const posts=await firstReads(env,'post',includedPosts,day),people=await firstReads(env,'user',includedUsers,day);
    const amount=main.first*rate+posts.first*pricing.post_micro+people.first*pricing.user_micro;
    await settle(env,id,amount,{utc_day:day,first_reads:main.first,rereads:main.reread,included_posts:includedPosts.length,included_users:includedUsers.length,
      rate_micro:rate,owned:discounted,pricing_checked_at:pricing.checked_at,errors:(data.errors || []).length});
    const risk=await rereadRisk(env,main.reread*rate+posts.reread*pricing.post_micro+people.reread*pricing.user_micro,1,day);
    if(risk)await recordCost(env,'x-reread-risk',risk,'uncertain',{utc_day:day,rereads:main.reread+posts.reread+people.reread,fraction:pricing.reread_fraction});
    return data;
  }catch(error){await uncertain(env,id);throw error;}
}
function videoVariant(media) {
  const variants=(media.variants || []).filter(v=>v.content_type==='video/mp4').sort((a,b)=>(b.bit_rate || b.bitrate || 0)-(a.bit_rate || a.bitrate || 0));
  return variants.find(v=>!media.duration_ms || !(v.bit_rate || v.bitrate) || (v.bit_rate || v.bitrate)*media.duration_ms/8000<=200*1024*1024) || variants[0];
}
export function normalizePost(post,includes={}) {
  const note=post.note_post || post.note_tweet;
  const media=(post.attachments?.media_keys || []).map(k=>(includes.media || []).find(m=>m.media_key===k) || {media_key:k,type:'unknown'}).map(m=>({
    url:m.type==='photo'?m.url:videoVariant(m)?.url,
    type:m.type,media_key:m.media_key,duration_ms:m.duration_ms,alt_text:m.alt_text,
  }));
  const entities=note?.entities || post.entities;
  const links=(entities?.urls || []).map(u=>u.unwound_url || u.expanded_url).filter(Boolean);
  let content=note?.text || post.text || '',article=null;
  // X 長文：API 直接給全文時，連到的長文網址改用這份正文另存來源；找不到長文網址就接在主文後面。
  const text=post.article?.plain_text?.trim();
  if(text){
    const url=links.map(xArticleUrl).find(Boolean),title=String(post.article.title || '').trim().slice(0,200);
    if(url)article={url,relation:'external',content:text,metadata:{title,content_method:'x_api'}};
    else content=[content,title&&`# ${title}`,text].filter(Boolean).join('\n\n');
  }
  return {url:`https://x.com/i/status/${post.id}`,relation:'primary',author_id:post.author_id,published_at:post.created_at,
    content,metadata:{post_id:post.id,conversation_id:post.conversation_id || post.id,
      references:post.referenced_posts || post.referenced_tweets || [],media_keys:post.attachments?.media_keys || [],links},media,article};
}
// 貼文附帶的長文另存成一筆來源；使用者手動貼上的原文由 saveEvidence 保護，不會被覆蓋。
export async function saveArticle(env,itemId,source){if(source?.article)await saveEvidence(env,itemId,source.article);}
export async function registerMedia(env,itemId,evidenceId,list) {
  for(const m of list || []) {
    const id=await hash(`${itemId}:${m.media_key || m.url || m.type+evidenceId}`);
    await query(env,`INSERT OR IGNORE INTO learning_media(id,item_id,evidence_id,url,type,duration_ms,status,error,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      id,itemId,evidenceId,m.url || '',m.type,m.duration_ms || null,m.url?'pending':'needs_attention',m.url?null:'來源未提供可取得的完整媒體 URL',nowIso()).run();
  }
}
export async function postEvidence(env,id,fetcher=fetch) {
  const result=await xRead(env,`/tweets/${id}`,postParameters(env),1,false,fetcher);
  if(!result.data?.id)throw new Error('X 主文不可取得或帳號沒有讀取權限');
  return normalizePost(result.data,result.includes);
}
// 同步失敗的診斷只留狀態碼、錯誤類型、出錯階段與訊息前段；長串數字（帳號或貼文 ID）遮掉，
// 解析錯誤的訊息可能夾帶回應原文，整段不記。
export function failureDetail(error,stage){
  const name=error?.name || 'Error';
  const message=name==='SyntaxError'?'回應解析失敗（原文不記錄）':String(error?.message || '').replace(/\d{8,}/g,'…').slice(0,200);
  return {stage,status:error?.status ?? null,name,message,at:nowIso()};
}
function logFailure(scope,detail){console.log(JSON.stringify({event:'bookmark_sync_failed',scope,...detail}));}
const FULL_LOCK='learning:sync-lock',PARTIAL_LOCK='learning:sync-lock-partial';
async function acquireLock(env,key,ms=600000){
  const id=crypto.randomUUID(),until=new Date(Date.now()+ms).toISOString();
  await query(env,"INSERT OR IGNORE INTO settings(key,value_json,updated_at) VALUES(?,'{}',?)",key,nowIso()).run();
  const acquired=await query(env,"UPDATE settings SET value_json=?,updated_at=? WHERE key=? AND (json_extract(value_json,'$.until') IS NULL OR json_extract(value_json,'$.until')<?)",JSON.stringify({id,until}),nowIso(),key,nowIso()).run();
  return acquired.meta.changes?id:null;
}
async function releaseLock(env,key,id){await query(env,"UPDATE settings SET value_json='{}' WHERE key=? AND json_extract(value_json,'$.id')=?",key,id).run();}
async function lockHeld(env,key){return !!(await query(env,"SELECT 1 FROM settings WHERE key=? AND json_extract(value_json,'$.until')>?",key,nowIso()).first());}
const RATE_LIMIT_MS=15*60000;

// 每日完整核對：逐頁保存游標直到沒有下一頁；遇到已知 ID 或短頁都不提前結束。
export async function startFullScan(env){
  const sync=await setting(env,'sync',{baseline_complete:false,cursor:null,running:false,backfill_approved:false});
  // 已在掃描中就沿用原本的游標，重疊的排程不重新開始。
  if(sync.running)return {...sync,reused:true};
  Object.assign(sync,{running:true,cursor:null,incomplete:false,started_at:nowIso(),last_error:null});
  await setSetting(env,'sync',sync);
  return sync;
}

// X 讀取費用高：可只保留手動分享時抓推文，關閉書籤掃描與作者補充重查。未設定時維持開啟。
export function bookmarksEnabled(env){return env.X_BOOKMARKS_ENABLED!=='false';}
export function authorRecheckEnabled(env){return env.X_AUTHOR_RECHECK_ENABLED!=='false';}

export async function syncBookmarks(env,deps={},scope='full') {
  // 所有入口（排程、續跑、手動按鈕、授權回呼、佇列訊息）都經過這裡，停用時不呼叫 X。
  if(!bookmarksEnabled(env))return {disabled:true};
  const fetcher=deps.fetcher || fetch;
  const account=await connection(env,'x');
  if(!account)throw new Error('尚未連接 X');
  const sync=await setting(env,'sync',{baseline_complete:false,cursor:null,running:false,backfill_approved:false});
  if(sync.requires_action)return sync;
  if(scope==='partial')return partialCheck(env,deps,account,sync,fetcher);
  if(sync.retry_after && sync.retry_after>nowIso())return {...sync,rate_limited:true};
  const lockId=await acquireLock(env,FULL_LOCK);
  if(!lockId)return {busy:true};
  let stage='x_read';
  try {
    if(!sync.running || !sync.started_at)sync.started_at=sync.started_at && sync.running?sync.started_at:nowIso();
    sync.running=true;sync.last_error=null;sync.retry_after=null;
    if(!sync.cursor)sync.incomplete=false;
    const initial=!sync.baseline_complete;
    for(let page=0;page<5;page++) {
      stage='x_read';
      const result=await xRead(env,`/users/${account.user_id}/bookmarks`,{...postParameters(env),max_results:100,pagination_token:sync.cursor},100,true,fetcher);
      if(result.data!=null&&!Array.isArray(result.data))throw new Error('X 書籤資料格式不符');
      if(!result.data&&!result.meta&&!result.errors)throw new Error('X 書籤回應缺少資料與分頁資訊');
      stage='collect';
      for(const post of result.data || []) {
        const source=normalizePost(post,result.includes);
        await deps.collect(env,source.url,initial?'backfill':'bookmark',`bookmark:${post.id}`,{defer:initial&&!sync.backfill_approved,source});
      }
      if(result.errors?.length){
        sync.incomplete=true;sync.last_error='X 回傳部分資料取得錯誤，已取得內容保留；不能確認所有來源都已取得。';
        for(const error of result.errors){
          if(['tweet','post'].includes(error.resource_type)&&/^\d+$/.test(String(error.resource_id)))await deps.collect(env,`https://x.com/i/status/${error.resource_id}`,initial?'backfill':'bookmark',`bookmark:${error.resource_id}`,{defer:initial&&!sync.backfill_approved});
        }
      }
      stage='save';
      sync.cursor=result.meta?.next_token || null;
      sync.pages_scanned=(sync.pages_scanned || 0)+1;
      sync.updated_at=nowIso();
      if(!sync.cursor){
        Object.assign(sync,{baseline_complete:true,running:false,last_failure:null,completed_at:nowIso(),last_full_completed_at:sync.incomplete?sync.last_full_completed_at || null:nowIso(),pages_scanned:0});
        await setSetting(env,'sync',sync);return sync;
      }
      await setSetting(env,'sync',sync);
    }
    return sync;
  }catch(error){
    error.stage=stage;sync.last_failure=failureDetail(error,stage);logFailure('full',sync.last_failure);
    sync.last_error=error.name==='BudgetPaused'?error.message:'X 同步未完成，請檢查授權、費用與 API 設定';
    if(error.status===429){sync.retry_after=new Date(Date.now()+RATE_LIMIT_MS).toISOString();sync.last_error='X 限流，已保存游標，稍後從同一頁續跑。';}
    else if(error.status===400&&sync.cursor){sync.cursor=null;sync.pages_scanned=0;sync.last_error='分頁請求失效，已保存內容會保留，下一次從頭核對。';}
    else if([400,401,403].includes(error.status)){sync.running=false;sync.requires_action=true;sync.last_error='X 授權或 API 設定需處理，已停止自動重試，內容與進度仍保留。';}
    await setSetting(env,'sync',sync);throw error;
  }
  finally {await releaseLock(env,FULL_LOCK,lockId);}
}

// 十分鐘局部檢查：只看目前列表最前面幾頁，不宣稱完整，也不改動完整核對的游標與成功時間。
async function partialCheck(env,deps,account,full,fetcher){
  const state=await setting(env,'sync-partial',{});
  const pages=Math.max(1,Math.min(10,Number(env.X_PARTIAL_PAGES || 1))),size=Math.max(5,Math.min(100,Number(env.X_PARTIAL_MAX_RESULTS || 100)));
  state.last_started_at=nowIso();state.scope=`最前 ${pages} 頁、每頁最多 ${size} 筆`;
  const skip=async reason=>{state.skipped=reason;await setSetting(env,'sync-partial',state);return state;};
  // 首次基線沒完成前，無法分辨新舊收藏，不能把舊收藏當新收藏處理。
  if(!full.baseline_complete)return skip('baseline_incomplete');
  if(state.retry_after && state.retry_after>nowIso())return skip('rate_limited');
  // 完整核對正在呼叫同一個端點時不重複讀取。
  if(await lockHeld(env,FULL_LOCK))return skip('full_scan_running');
  const lockId=await acquireLock(env,PARTIAL_LOCK,300000);
  if(!lockId)return skip('partial_running');
  let stage='x_read';
  try{
    let cursor=null,checked=0,added=0;
    for(let page=0;page<pages;page++){
      stage='x_read';
      const result=await xRead(env,`/users/${account.user_id}/bookmarks`,{...postParameters(env),max_results:size,pagination_token:cursor},size,true,fetcher);
      if(result.data!=null&&!Array.isArray(result.data))throw new Error('X 書籤資料格式不符');
      stage='collect';
      for(const post of result.data || []){
        checked++;
        if(!(await query(env,'SELECT 1 FROM learning_intakes WHERE receipt=?',`bookmark:${post.id}`).first()))added++;
        const source=normalizePost(post,result.includes);
        await deps.collect(env,source.url,'bookmark',`bookmark:${post.id}`,{source});
      }
      cursor=result.meta?.next_token || null;
      if(!cursor)break;
    }
    stage='save';
    Object.assign(state,{last_completed_at:nowIso(),checked,added,skipped:null,last_error:null,last_failure:null,retry_after:null});
    await setSetting(env,'sync-partial',state);
    return state;
  }catch(error){
    error.stage=stage;state.last_failure=failureDetail(error,stage);logFailure('partial',state.last_failure);
    state.last_error=error.name==='BudgetPaused'?'費用暫停，局部檢查未執行':'局部檢查未完成，請查看 X 授權或設定';
    if(error.status===429){state.retry_after=new Date(Date.now()+RATE_LIMIT_MS).toISOString();state.last_error='X 限流，稍後再檢查';}
    else if([401,403].includes(error.status)){full.requires_action=true;full.last_error='X 授權或 API 設定需處理，已停止自動檢查。';await setSetting(env,'sync',full);}
    await setSetting(env,'sync-partial',state);
    if(error.name==='BudgetPaused')return state;
    throw error;
  }finally{await releaseLock(env,PARTIAL_LOCK,lockId);}
}

import {apiJson} from './network.js';
import {connection,saveConnection,query,setting,setSetting,reserve,settle,uncertain,nowIso,saveEvidence,hash} from './store.js';

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
  return {[modern?'post.fields':'tweet.fields']:`author_id,conversation_id,created_at,entities,attachments,${modern?'note_post,referenced_posts':'note_tweet,referenced_tweets'}`,
    expansions:'attachments.media_keys','media.fields':'type,url,preview_image_url,variants,duration_ms,alt_text'};
}
export async function xRead(env,path,params={},maximum=1,owned=false,fetcher=fetch,token=null) {
  const auth=token || await accessToken(env,fetcher);
  const account=await connection(env,'x');
  const rate=owned && env.X_APP_OWNER_ID && env.X_APP_OWNER_ID===account?.user_id?1000:5000;
  const users=/^\/users\/(?:me|\d+)$/.test(path);
  const bound=maximum*(users?10000:rate);
  const id=await reserve(env,'x',bound);
  try {
    const url=new URL(`https://api.x.com/2${path}`);
    for(const [k,v] of Object.entries(params))if(v!=null)url.searchParams.set(k,String(v));
    const data=await apiJson(await fetcher(url.href,{headers:{authorization:`Bearer ${auth}`},signal:AbortSignal.timeout(30000)}),4000000);
    const count=Array.isArray(data.data)?data.data.length:data.data?1:0;
    const includedPosts=(data.includes?.posts || data.includes?.tweets || []).length;
    const includedUsers=(data.includes?.users || []).length;
    await settle(env,id,count*(users?10000:rate)+includedPosts*5000+includedUsers*10000,{returned:count,included_posts:includedPosts,included_users:includedUsers,rate_micro:users?10000:rate,errors:(data.errors || []).length});
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
  return {url:`https://x.com/i/status/${post.id}`,relation:'primary',author_id:post.author_id,published_at:post.created_at,
    content:note?.text || post.text || '',metadata:{post_id:post.id,conversation_id:post.conversation_id || post.id,
      references:post.referenced_posts || post.referenced_tweets || [],media_keys:post.attachments?.media_keys || [],links:(entities?.urls || []).map(u=>u.unwound_url || u.expanded_url).filter(Boolean)},media};
}
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
export async function syncBookmarks(env,deps={}) {
  const fetcher=deps.fetcher || fetch;
  const account=await connection(env,'x');
  if(!account)throw new Error('尚未連接 X');
  const sync=await setting(env,'sync',{baseline_complete:false,cursor:null,running:false,backfill_approved:false});
  if(sync.requires_action)return sync;
  const lockId=crypto.randomUUID(), until=new Date(Date.now()+600000).toISOString();
  await query(env,"INSERT OR IGNORE INTO settings(key,value_json,updated_at) VALUES('learning:sync-lock','{}',?)",nowIso()).run();
  const acquired=await query(env,"UPDATE settings SET value_json=?,updated_at=? WHERE key='learning:sync-lock' AND (json_extract(value_json,'$.until') IS NULL OR json_extract(value_json,'$.until')<?)",JSON.stringify({id:lockId,until}),nowIso(),nowIso()).run();
  if(!acquired.meta.changes)return {busy:true};
  try {
    sync.running=true;sync.last_error=null;
    if(!sync.cursor)sync.incomplete=false;
    const initial=!sync.baseline_complete;
    for(let page=0;page<5;page++) {
      const result=await xRead(env,`/users/${account.user_id}/bookmarks`,{...postParameters(env),max_results:100,pagination_token:sync.cursor},100,true,fetcher);
      if(result.data!=null&&!Array.isArray(result.data))throw new Error('X 書籤資料格式不符');
      if(!result.data&&!result.meta&&!result.errors)throw new Error('X 書籤回應缺少資料與分頁資訊');
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
      sync.cursor=result.meta?.next_token || null;
      sync.updated_at=nowIso();
      if(!sync.cursor){sync.baseline_complete=true;sync.running=false;sync.completed_at=nowIso();await setSetting(env,'sync',sync);return sync;}
      await setSetting(env,'sync',sync);
    }
    return sync;
  }catch(error){
    sync.last_error=error.name==='BudgetPaused'?error.message:'X 同步未完成，請檢查授權、費用與 API 設定';
    if(error.status===400&&sync.cursor){sync.cursor=null;sync.last_error='分頁請求失效，已保存內容會保留，下一次從頭核對。';}
    else if([400,401,403].includes(error.status)){sync.running=false;sync.requires_action=true;sync.last_error='X 授權或 API 設定需處理，已停止自動重試，內容與進度仍保留。';}
    await setSetting(env,'sync',sync);throw error;
  }
  finally {await query(env,"UPDATE settings SET value_json='{}' WHERE key='learning:sync-lock' AND json_extract(value_json,'$.id')=?",lockId).run();}
}

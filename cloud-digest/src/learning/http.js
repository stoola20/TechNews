import {readBoundedText} from '../sources.js';
import {LEARNING_PAGE} from './page.js';
import {createLearningService} from './service.js';
import {equalSecret,authorized,createSession,cookie,mutationAllowed} from './auth.js';
import {rows,query,item,evidence,setting,setSetting,budget,resume,hash,connection,saveConnection,nowIso} from './store.js';
import {exchange,xRead} from './x.js';
import {resetIncomplete} from './evidence.js';

const JSON_HEADERS={'cache-control':'no-store','referrer-policy':'no-referrer'};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{...JSON_HEADERS,...headers}});
async function body(request){return JSON.parse(await readBoundedText(new Response(request.body),64000));}
export function createLearningHandler(deps={}) {
  const service=createLearningService(deps),fetcher=deps.fetcher || fetch;
  async function handle(request,env,ctx={}){
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/learning'))return null;
    if(path==='/learning'&&request.method==='GET')return new Response(LEARNING_PAGE,{headers:{'content-type':'text/html; charset=utf-8',...JSON_HEADERS,'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
    if(env.LEARNING_ENABLED!=='true')return json({error:'學習流程尚未啟用，請先完成設定。'},503);
    try {
      if(path==='/learning/telegram'&&request.method==='POST'){
        if(!equalSecret(request.headers.get('x-telegram-bot-api-secret-token'),env.TELEGRAM_WEBHOOK_SECRET))return json({error:'Not found'},404);
        const update=await body(request),message=update.message || update.channel_post;
        if(!Number.isSafeInteger(update.update_id))return json({error:'Webhook 缺少有效 update_id'},400);
        const allowed=(env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s=>s.trim());
        if(!message || !allowed.includes(String(message.chat?.id)))return json({ok:true,ignored:true});
        const text=message.text || message.caption || '';
        const entities=message.entities || message.caption_entities || [];
        const supplied=entities.filter(e=>['url','text_link'].includes(e.type)).map(e=>e.type==='text_link'?e.url:text.slice(e.offset,e.offset+e.length));
        const urls=[...new Set(supplied.length?supplied:(text.match(/https:\/\/[^\s<>]+/g) || []))];
        const ids=[];
        for(const [index,link] of urls.entries())ids.push(await service.collect(env,link,'share',`telegram:${update.update_id}:${index}`));
        await service.receipt(env,message.chat.id,ids,update.update_id);
        return json({ok:true,received:ids});
      }
      if(path==='/learning/x/callback'){
        const state=url.searchParams.get('state'),code=url.searchParams.get('code');
        if(!state || !code || !equalSecret(state,cookie(request,'learning_oauth')))return json({error:'X 授權回呼驗證失敗'},400);
        const key=`oauth:${await hash(state)}`,saved=await connection(env,key);
        if(!saved || saved.expires_at<Date.now())return json({error:'X 授權請求已到期'},400);
        await query(env,'DELETE FROM learning_connections WHERE name=?',key).run();
        const token=await exchange(env,{grant_type:'authorization_code',code,code_verifier:saved.verifier,redirect_uri:saved.redirect_uri},fetcher);
        if(!token.access_token || !token.refresh_token)throw new Error('X 授權未包含持續讀取權限');
        const identity=await xRead(env,'/users/me',{},1,false,fetcher,token.access_token);
        if(!identity.data?.id)throw new Error('X 帳號身份不可確認');
        await saveConnection(env,'x',{...token,user_id:identity.data.id,expires_at:Date.now()+(token.expires_in || 7200)*1000});
        const existing=await setting(env,'sync');
        if(existing.user_id!==identity.data.id)await setSetting(env,'sync',{user_id:identity.data.id,baseline_complete:false,running:true,cursor:null,backfill_approved:false});
        else await setSetting(env,'sync',{...existing,requires_action:false,running:true,last_error:null});
        if(env.LEARNING_JOBS)await env.LEARNING_JOBS.send({kind:'sync'});
        return new Response(null,{status:303,headers:{location:'/learning','set-cookie':await createSession(env),...JSON_HEADERS}});
      }
      if(path==='/learning/session'&&request.method==='POST'){
        if(!mutationAllowed(request,env))return json({error:'登入請求來源不符'},403);
        const data=await body(request);
        if(!equalSecret(data.token,env.RUN_TOKEN))return json({error:'登入憑證不符'},401);
        return json({ok:true},200,{'set-cookie':await createSession(env)});
      }
      if(!await authorized(request,env))return json({error:'請登入私人文章庫'},401);
      if(!['GET','HEAD'].includes(request.method)&&!mutationAllowed(request,env))return json({error:'請求來源不符'},403);
      if(path==='/learning/session'&&request.method==='DELETE'){
        await query(env,'DELETE FROM learning_sessions WHERE id=?',await hash(cookie(request,'learning_session'))).run();
        return json({ok:true},200,{'set-cookie':'learning_session=; Path=/learning; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
      }
      const route=path.replace(/^\/learning\/api\//,'');
      if(route==='status'&&request.method==='GET'){
        const count=await query(env,"SELECT COUNT(*) AS count FROM learning_items WHERE status='awaiting_backfill'").first();
        return json({budget:await budget(env),sync:await setting(env,'sync'),awaiting_backfill:count.count,demo:env.LEARNING_DEMO==='true',configured:{gemini:!!env.GEMINI_API_KEY,x:!!env.X_CLIENT_ID&&!!env.X_CLIENT_SECRET,queue:!!env.LEARNING_JOBS,media:!!env.MEDIA,telegram_input:!!env.TELEGRAM_WEBHOOK_SECRET&&!!env.TELEGRAM_ALLOWED_CHAT_IDS}});
      }
      if(route==='collect'&&request.method==='POST')return json({id:await service.collect(env,(await body(request)).url)},202);
      if(route==='items'&&request.method==='GET'){
        const term=(url.searchParams.get('q') || '').trim();
        const offset=Number(url.searchParams.get('offset') || 0);
        if(term.length>200||!Number.isInteger(offset)||offset<0||offset>1000000)throw new Error('搜尋參數無效');
        const pattern=`%${term.replace(/[\\%_]/g,s=>'\\'+s)}%`;
        return json(await rows(env,`SELECT id,url,title,status,read_at,last_error,gaps_json,created_at,updated_at FROM learning_items WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM learning_evidence e WHERE e.item_id=learning_items.id AND e.content LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 50 OFFSET ?`,pattern,pattern,pattern,pattern,offset));
      }
      const match=route.match(/^items\/([a-f0-9]{32})(\/retry)?$/);
      if(match){
        const id=match[1],current=await item(env,id);
        if(!current)return json({error:'文章不存在'},404);
        if(match[2]&&request.method==='POST'){
          if(current.status==='awaiting_backfill')throw new Error('請先確認既有書籤回補');
          await resetIncomplete(env,id);
          await query(env,"UPDATE learning_items SET status='queued',attempts=0,next_attempt_at=NULL,last_error=NULL WHERE id=?",id).run();
          await service.enqueue(env,id);return json({ok:true},202);
        }
        if(!match[2]&&request.method==='GET')return json({item:current,sources:await evidence(env,id),media:await rows(env,'SELECT id,type,duration_ms,status,error,object_key FROM learning_media WHERE item_id=?',id)});
        if(!match[2]&&request.method==='PATCH'){
          const data=await body(request);
          if('note' in data){if(typeof data.note!=='string'||data.note.length>20000)throw new Error('筆記超過 20,000 字元');await query(env,'UPDATE learning_items SET note=? WHERE id=?',data.note,id).run();}
          if('read' in data){if(typeof data.read!=='boolean')throw new Error('已讀狀態需為 boolean');await query(env,'UPDATE learning_items SET read_at=? WHERE id=?',data.read?nowIso():null,id).run();}
          return json({ok:true});
        }
      }
      if(route.startsWith('media/')&&request.method==='GET'){
        const asset=await query(env,'SELECT * FROM learning_media WHERE id=?',route.slice(6)).first();
        if(!asset?.object_key || !env.MEDIA)return json({error:'原始媒體不可取得'},404);
        const range=request.headers.get('range');
        const object=await env.MEDIA.get(asset.object_key,range?{range:request.headers}:{});
        if(!object)return json({error:'原始媒體已到期'},404);
        const headers=new Headers({...JSON_HEADERS,'content-type':asset.mime,'x-content-type-options':'nosniff','accept-ranges':'bytes'});
        if(object.range){headers.set('content-range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);headers.set('content-length',String(object.range.length));}
        else headers.set('content-length',String(object.size));
        return new Response(object.body,{status:object.range?206:200,headers});
      }
      if(route==='control'&&request.method==='POST'){
        const data=await body(request);
        if(data.action==='pause')await setSetting(env,'control',{paused:true,reason:'manual'});
        else if(data.action==='resume'){await resume(env);await service.recover(env);const sync=await setting(env,'sync');if(sync.running&&env.LEARNING_JOBS)await env.LEARNING_JOBS.send({kind:'sync'});}
        else throw new Error('未知處理動作');
        return json(await budget(env));
      }
      if(route==='ask'&&request.method==='POST'){
        const data=await body(request);
        if(data.item_id&&!await item(env,data.item_id))return json({error:'文章不存在'},404);
        return json(await service.ask(env,data.question,data.item_id || null));
      }
      if(route==='x/connect'&&request.method==='POST'){
        if(!env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.PUBLIC_BASE_URL)throw new Error('X 授權設定未完成');
        const base=new URL(env.PUBLIC_BASE_URL);
        if(base.protocol!=='https:')throw new Error('PUBLIC_BASE_URL 需為 HTTPS');
        const state=crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID();
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
        const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const redirect=base.origin+'/learning/x/callback';
        await saveConnection(env,`oauth:${await hash(state)}`,{verifier,redirect_uri:redirect,expires_at:Date.now()+600000});
        const auth=new URL('https://x.com/i/oauth2/authorize');
        for(const [k,v] of Object.entries({response_type:'code',client_id:env.X_CLIENT_ID,redirect_uri:redirect,scope:'bookmark.read tweet.read users.read offline.access',state,code_challenge:challenge,code_challenge_method:'S256'}))auth.searchParams.set(k,v);
        return json({url:auth.href},200,{'set-cookie':`learning_oauth=${state}; Path=/learning/x/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`});
      }
      if(route==='x/sync'&&request.method==='POST'){
        const sync=await setting(env,'sync');await setSetting(env,'sync',{...sync,requires_action:false});
        return json(await service.sync(env));
      }
      if(route==='x/backfill'&&request.method==='POST')return json(await service.backfill(env),202);
      return json({error:'Not found'},404);
    }catch(error){return json({error:error.message || '學習流程處理失敗'},error.name==='BudgetPaused'?429:400);}
  }
  return {fetch:handle,queue:service.queue,scheduled:service.scheduled,service};
}
export const learning=createLearningHandler();

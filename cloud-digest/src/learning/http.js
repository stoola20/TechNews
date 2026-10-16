import {readBoundedText} from '../sources.js';
import {LEARNING_PAGE} from './page.js';
import {createLearningService} from './service.js';
import {equalSecret,authorized,createSession,cookie,mutationAllowed} from './auth.js';
import {rows,query,item,evidence,setting,setSetting,budget,resume,hash,connection,saveConnection,nowIso} from './store.js';
import {exchange,xRead} from './x.js';
import {resetIncomplete} from './evidence.js';
import {renderMarkdown} from './markdown.js';
import {resolveItemId,migrateLibrary} from './library.js';
import {claim,heartbeat,complete,fail,release,runnerStatus,setTextProvider,JobConflict} from './local.js';

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
      if(path.startsWith('/learning/runner/')&&request.method==='POST'){
        // Mac 執行器使用專用憑證，不能用來登入網站；網站登入憑證也不能領取工作。
        if(!env.LEARNING_RUNNER_TOKEN || !equalSecret(request.headers.get('authorization')?.replace(/^Bearer\s+/i,''),env.LEARNING_RUNNER_TOKEN))return json({error:'Not found'},404);
        const data=await body(request),action=path.slice('/learning/runner/'.length);
        try{
          if(action==='claim')return json({job:await claim(env,data.runner_id,data.info)});
          if(action==='heartbeat')return json(await heartbeat(env,data.runner_id,data.info,data.job_id,data.attempt_token));
          if(action==='fail')return json(await fail(env,data.job_id,data.attempt_token,data.error,data.retryable!==false));
          if(action==='release')return json(await release(env,data.job_id,data.attempt_token,data.error));
          if(action==='complete'){
            const result=await complete(env,data,{articleCompleted:async()=>{const work=service.flush(env,'share').catch(()=>{});if(ctx.waitUntil)ctx.waitUntil(work);else await work;},...service.localHooks});
            return json(result);
          }
        }catch(error){
          if(error instanceof JobConflict)return json({error:error.message,code:error.code},error.code==='not_found'?404:error.code==='invalid_output'?422:409);
          throw error;
        }
        return json({error:'Not found'},404);
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
        return json({budget:await budget(env),sync:await setting(env,'sync'),awaiting_backfill:count.count,local:await runnerStatus(env),demo:env.LEARNING_DEMO==='true',configured:{gemini:!!env.GEMINI_API_KEY,x:!!env.X_CLIENT_ID&&!!env.X_CLIENT_SECRET,queue:!!env.LEARNING_JOBS,media:!!env.MEDIA,telegram_input:!!env.TELEGRAM_WEBHOOK_SECRET&&!!env.TELEGRAM_ALLOWED_CHAT_IDS}});
      }
      if(route==='collect'&&request.method==='POST')return json({id:await service.collect(env,(await body(request)).url,'web')},202);
      if(route==='admin/migrate'&&request.method==='POST')return json(await migrateLibrary(env));
      if(route==='admin/text-provider'&&request.method==='PUT'){await setTextProvider(env,(await body(request)).provider);return json(await runnerStatus(env));}
      if(route==='items'&&request.method==='GET'){
        const term=(url.searchParams.get('q') || '').trim();
        const offset=Number(url.searchParams.get('offset') || 0);
        if(term.length>200||!Number.isInteger(offset)||offset<0||offset>1000000)throw new Error('搜尋參數無效');
        const filter=url.searchParams.get('status')||'';
        if(filter&&!['awaiting_backfill','ready','partial','needs_attention'].includes(filter))throw new Error('文章篩選無效');
        const pattern=`%${term.replace(/[\\%_]/g,s=>'\\'+s)}%`;
        return json(await rows(env,`SELECT id,url,title,status,edition,read_at,last_error,gaps_json,created_at,updated_at,
          (SELECT substr(e.content,1,160) FROM learning_evidence e WHERE e.item_id=learning_items.id AND e.relation='primary' LIMIT 1) AS preview,
          (SELECT group_concat(DISTINCT origin) FROM learning_intakes i WHERE i.item_id=learning_items.id) AS origins
          FROM learning_items WHERE status NOT IN ('dismissed','merged') ${filter?'AND status=?':''} AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM learning_evidence e WHERE e.item_id=learning_items.id AND e.content LIKE ? ESCAPE '\\')) ORDER BY created_at DESC LIMIT 50 OFFSET ?`,...(filter?[filter]:[]),pattern,pattern,pattern,pattern,offset));
      }
      const match=route.match(/^items\/([a-f0-9]{32})(\/(?:retry|backfill))?$/);
      if(match){
        const id=await resolveItemId(env,match[1]),current=id&&await item(env,id);
        if(!current||current.status==='dismissed')return json({error:'文章不存在'},404);
        if(match[2]==='/backfill'&&request.method==='POST'){
          const changed=await query(env,"UPDATE learning_items SET status='queued',updated_at=? WHERE id=? AND status='awaiting_backfill'",nowIso(),id).run();
          if(!changed.meta.changes)return json({error:'這篇已離開待回補清單，請重新整理。'},409);
          await service.enqueue(env,id);return json({ok:true},202);
        }
        if(match[2]==='/retry'&&request.method==='POST'){
          if(current.status==='awaiting_backfill')throw new Error('請先確認既有書籤回補');
          await resetIncomplete(env,id);
          await query(env,"UPDATE learning_items SET status='queued',attempts=0,next_attempt_at=NULL,last_error=NULL WHERE id=?",id).run();
          await service.enqueue(env,id);return json({ok:true},202);
        }
        if(!match[2]&&request.method==='DELETE'){
          if(current.status!=='awaiting_backfill')return json({error:'只能刪除等待確認回補的文章。'},409);
          const assets=await rows(env,'SELECT object_key FROM learning_media WHERE item_id=? AND object_key IS NOT NULL',id);
          const guard="AND EXISTS(SELECT 1 FROM learning_items WHERE id=? AND status='dismissed')";
          const result=await env.DB.batch([
            query(env,"UPDATE learning_items SET status='dismissed',title='',body=NULL,article_json=NULL,gaps_json='[]',note='',last_error=NULL,updated_at=? WHERE id=? AND status='awaiting_backfill'",nowIso(),id),
            query(env,`DELETE FROM learning_questions WHERE item_id=? ${guard}`,id,id),
            query(env,`DELETE FROM learning_media WHERE item_id=? ${guard}`,id,id),
            query(env,`DELETE FROM learning_evidence WHERE item_id=? ${guard}`,id,id),
            query(env,`DELETE FROM learning_intakes WHERE item_id=? ${guard}`,id,id),
            query(env,`DELETE FROM settings WHERE key=? ${guard}`,`learning:context:${id}`,id),
          ]);
          if(!result[0].meta.changes)return json({error:'文章狀態已改變，請重新整理。'},409);
          for(const asset of assets)if(env.MEDIA)await env.MEDIA.delete(asset.object_key);
          return json({ok:true});
        }
        if(!match[2]&&request.method==='GET')return json({item:{...current,body_html:renderMarkdown(current.body||'')},requested_id:match[1],sources:await evidence(env,id),
          media:await rows(env,'SELECT id,type,duration_ms,status,error,object_key FROM learning_media WHERE item_id=?',id),
          intakes:await rows(env,'SELECT origin,metadata_json,created_at FROM learning_intakes WHERE item_id=? ORDER BY created_at',id),
          versions:await rows(env,'SELECT id,revision,edition,origin,title,created_at FROM learning_versions WHERE item_id=? ORDER BY created_at DESC',id)});
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
        const result=await service.ask(env,data.question,data.item_id || null);
        return json({...result,answer_html:renderMarkdown(result.answer)});
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

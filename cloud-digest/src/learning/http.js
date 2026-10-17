import {readBoundedText} from '../sources.js';
import {LEARNING_PAGE} from './page.js';
import {ADMIN_PAGE} from './admin-page.js';
import {createLearningService} from './service.js';
import {equalSecret,authorized,createSession,cookie,mutationAllowed} from './auth.js';
import {rows,query,item,evidence,setting,setSetting,budget,resume,hash,connection,saveConnection,nowIso} from './store.js';
import {exchange,xRead} from './x.js';
import {resetIncomplete} from './evidence.js';
import {renderMarkdown} from './markdown.js';
import {resolveItemId,migrateLibrary,ORIGINS} from './library.js';
import {articleMessage} from './notifications.js';
import {skipDecorative} from './media.js';
import {mergeExistingDuplicates} from './linking.js';

// 列表狀態群組：「需要處理」只放需要動手的情況；等待本機與費用暫停各自分開，不當成失敗。
const STATE_GROUPS={ready:['ready','partial'],needs_action:['needs_attention','error','partial'],waiting_local:['waiting_local','generating'],paused:['budget_paused','paused'],processing:['queued','processing'],awaiting_backfill:['awaiting_backfill'],filtered:['filtered'],legacy:['ready','partial']};
import {listQuestions,questionView} from './questions.js';
import {budgetSummary,recordCost} from './pricing.js';
import {claim,heartbeat,complete,fail,release,runnerStatus,setTextProvider,JobConflict} from './local.js';

const JSON_HEADERS={'cache-control':'no-store','referrer-policy':'no-referrer'};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{...JSON_HEADERS,...headers}});
async function body(request,limit=64000){return JSON.parse(await readBoundedText(new Response(request.body),limit));}
export function createLearningHandler(deps={}) {
  const service=createLearningService(deps),fetcher=deps.fetcher || fetch;
  async function handle(request,env,ctx={}){
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/learning'))return null;
    if(path==='/learning/admin'&&request.method==='GET')return new Response(ADMIN_PAGE,{headers:{'content-type':'text/html; charset=utf-8',...JSON_HEADERS,'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
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
          if(action==='claim')return json({job:await claim(env,data.runner_id,data.info,data.kinds)});
          if(action==='heartbeat')return json(await heartbeat(env,data.runner_id,data.info,data.job_id,data.attempt_token));
          if(action==='fail')return json(await fail(env,data.job_id,data.attempt_token,data.error,data.retryable!==false));
          if(action==='release')return json(await release(env,data.job_id,data.attempt_token,data.error));
          if(action==='complete'){
            const result=await complete(env,data,{articleCompleted:async()=>{const work=service.flush(env).catch(()=>{});if(ctx.waitUntil)ctx.waitUntil(work);else await work;},sourceFetched:(env,id)=>service.enqueue(env,id),...service.localHooks});
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
        return json({budget:await budget(env),sync:await setting(env,'sync'),sync_partial:await setting(env,'sync-partial'),awaiting_backfill:count.count,local:await runnerStatus(env),demo:env.LEARNING_DEMO==='true',configured:{gemini:!!env.GEMINI_API_KEY,x:!!env.X_CLIENT_ID&&!!env.X_CLIENT_SECRET,queue:!!env.LEARNING_JOBS,media:!!env.MEDIA,telegram_input:!!env.TELEGRAM_WEBHOOK_SECRET&&!!env.TELEGRAM_ALLOWED_CHAT_IDS}});
      }
      if(route==='collect'&&request.method==='POST')return json({id:await service.collect(env,(await body(request)).url,'web')},202);
      if(route==='admin/migrate'&&request.method==='POST'){const library=await migrateLibrary(env),linked=await mergeExistingDuplicates(env);return json({...library,merged:library.merged+linked.merged,linked_checked:linked.checked});}
      if(route==='budget'&&request.method==='GET')return json(await budgetSummary(env,await budget(env)));
      if(route==='admin/budget-adjust'&&request.method==='POST'){
        // 與供應商帳單核對後的人工修正；可為負數，保留說明供日後查核。
        const data=await body(request),amount=Math.round(Number(data.amount_usd)*1e6);
        if(!/^[a-z][a-z0-9-]{0,31}$/.test(data.category || '') || !Number.isSafeInteger(amount) || amount===0 || typeof data.note!=='string' || !data.note.trim() || data.note.length>500)throw new Error('調整需提供類別、非零金額與說明');
        await recordCost(env,data.category,amount,'adjustment',{note:data.note.trim()});
        return json(await budgetSummary(env,await budget(env)));
      }
      if(route==='admin/text-provider'&&request.method==='PUT'){await setTextProvider(env,(await body(request)).provider);return json(await runnerStatus(env));}
      if(route==='items'&&request.method==='GET'){
        const term=(url.searchParams.get('q') || '').trim();
        const offset=Number(url.searchParams.get('offset') || 0);
        if(term.length>200||!Number.isInteger(offset)||offset<0||offset>1000000)throw new Error('搜尋參數無效');
        // status 為舊參數，等同單一狀態篩選；state 為狀態群組。
        const legacy=url.searchParams.get('status')||'',group=url.searchParams.get('state')||'',origin=url.searchParams.get('origin')||'',unread=url.searchParams.get('unread')==='1';
        if(legacy&&!['awaiting_backfill','ready','partial','needs_attention','filtered'].includes(legacy))throw new Error('文章篩選無效');
        if(group&&!STATE_GROUPS[group])throw new Error('狀態篩選無效');
        if(origin&&!ORIGINS[origin])throw new Error('收件入口篩選無效');
        const statuses=legacy?[legacy]:group?STATE_GROUPS[group]:null;
        const conditions=["status NOT IN ('dismissed','merged')"],args=[];
        if(statuses){conditions.push(`status IN (${statuses.map(()=>'?').join(',')})`);args.push(...statuses);}else conditions.push("status!='filtered'");
        if(group==='legacy')conditions.push("edition='legacy_digest'");
        if(unread)conditions.push('read_at IS NULL');
        if(origin){conditions.push('EXISTS(SELECT 1 FROM learning_intakes k WHERE k.item_id=learning_items.id AND k.origin=?)');args.push(origin);}
        if(term){
          const pattern=`%${term.replace(/[\\%_]/g,s=>'\\'+s)}%`;
          conditions.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM learning_evidence e WHERE e.item_id=learning_items.id AND e.content LIKE ? ESCAPE '\\'))");
          args.push(pattern,pattern,pattern,pattern);
        }
        return json(await rows(env,`SELECT id,url,title,status,stage,edition,read_at,last_error,gaps_json,revision,created_at,updated_at,
          (SELECT substr(e.content,1,160) FROM learning_evidence e WHERE e.item_id=learning_items.id AND e.relation='primary' LIMIT 1) AS preview,
          (SELECT group_concat(DISTINCT origin) FROM learning_intakes i WHERE i.item_id=learning_items.id) AS origins
          FROM learning_items WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 50 OFFSET ?`,...args,offset));
      }
      if(route==='items/states'&&request.method==='GET'){
        // 輕量狀態刷新：只回狀態，不重建正文或筆記。
        const ids=(url.searchParams.get('ids') || '').split(',').filter(Boolean);
        if(ids.length>100 || ids.some(i=>!/^[a-f0-9]{32}$/.test(i)))throw new Error('文章識別碼無效');
        if(!ids.length)return json([]);
        return json(await rows(env,`SELECT id,status,stage,revision,read_at,last_error,updated_at,note_updated_at FROM learning_items WHERE id IN (${ids.map(()=>'?').join(',')})`,...ids));
      }
      const match=route.match(/^items\/([a-f0-9]{32})(\/(?:retry|backfill|rewrite|renotify|source))?$/);
      if(match){
        const id=await resolveItemId(env,match[1]),current=id&&await item(env,id);
        if(!current||current.status==='dismissed')return json({error:'文章不存在'},404);
        if(match[2]==='/backfill'&&request.method==='POST'){
          const changed=await query(env,"UPDATE learning_items SET status='queued',updated_at=? WHERE id=? AND status='awaiting_backfill'",nowIso(),id).run();
          if(!changed.meta.changes)return json({error:'這篇已離開待回補清單，請重新整理。'},409);
          await service.enqueue(env,id);return json({ok:true},202);
        }
        if(match[2]==='/rewrite'&&request.method==='POST'){
          // 只重寫文字：沿用已保存的來源與媒體解析，不重新取得來源，也不重新解析媒體。
          if(!['ready','partial','needs_attention','error'].includes(current.status))return json({error:'這篇目前不能重寫，請等處理完成。'},409);
          await query(env,"UPDATE learning_items SET status='queued',attempts=0,next_attempt_at=NULL,last_error=NULL,article_json=json_set(COALESCE(article_json,'{}'),'$.input_fingerprint','rewrite-requested'),updated_at=? WHERE id=?",nowIso(),id).run();
          await service.enqueue(env,id);return json({ok:true},202);
        }
        if(match[2]==='/source'&&request.method==='POST'){
          // 手動貼上原文：只接受目前列為缺漏的來源網址，保存後重新整理。
          const data=await body(request,1000000),content=typeof data.content==='string'?data.content.trim():'';
          if(current.status==='awaiting_backfill')return json({error:'請先確認既有書籤回補'},409);
          if(content.length<20 || content.length>200000)return json({error:'原文需介於 20 到 200,000 字之間'},400);
          const missing=await query(env,"SELECT id FROM learning_evidence WHERE item_id=? AND url=? AND status='missing' AND relation IN ('primary','external') LIMIT 1",id,data.url).first();
          if(!missing)return json({error:'這個網址目前不是缺漏來源'},409);
          await query(env,"UPDATE learning_evidence SET content=?,metadata_json=?,status='available',fetched_at=? WHERE id=?",content,JSON.stringify({provided_by:'user',title:typeof data.title==='string'?data.title.slice(0,200):null}),nowIso(),missing.id).run();
          await query(env,"UPDATE learning_items SET status='queued',attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?",nowIso(),id).run();
          await service.enqueue(env,id);return json({ok:true},202);
        }
        if(match[2]==='/renotify'&&request.method==='POST'){
          // 重送通知：用目前保存的文章內容再發一次，不重新生成。
          if(!['ready','partial'].includes(current.status) || current.edition!=='detailed')return json({error:'只有已完成的詳細文章可以重送通知。'},409);
          await query(env,'INSERT INTO learning_deliveries(id,item_ids_json,origin,body,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),JSON.stringify([{id,revision:current.revision}]),'resend',articleMessage(env,current,'complete'),nowIso()).run();
          await service.flush(env);return json({ok:true});
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
        if(!match[2]&&request.method==='GET'){
          // 裝飾圖片不顯示；舊資料留下的對應缺漏也一併隱藏，下次整理時會正式移除。
          await skipDecorative(env,id);
          const fresh=await item(env,id);
          return json({item:{...fresh,body_html:renderMarkdown(fresh.body||'')},requested_id:match[1],sources:await evidence(env,id),
          media:await rows(env,"SELECT id,evidence_id,url,type,duration_ms,status,error,object_key,expires_at FROM learning_media WHERE item_id=? AND status!='decorative' ORDER BY rowid",id),
          analyses:(await rows(env,'SELECT media_id,model,prompt_version,analysis_json,created_at FROM learning_media_analyses WHERE item_id=? ORDER BY created_at',id)).map(a=>({...a,analysis:JSON.parse(a.analysis_json),analysis_json:undefined})),
          intakes:await rows(env,'SELECT origin,metadata_json,created_at FROM learning_intakes WHERE item_id=? ORDER BY created_at',id),
          versions:await rows(env,'SELECT id,revision,edition,origin,title,created_at FROM learning_versions WHERE item_id=? ORDER BY created_at DESC',id)});
        }
        if(!match[2]&&request.method==='PATCH'){
          const data=await body(request);
          let noteUpdatedAt=current.note_updated_at;
          if('note' in data){
            if(typeof data.note!=='string'||data.note.length>20000)throw new Error('筆記超過 20,000 字元');
            noteUpdatedAt=nowIso();
            // 帶有 base_note_updated_at 時做版本檢查：另一個分頁已保存新內容就回 409，不覆寫。
            const guarded='base_note_updated_at' in data;
            const result=await query(env,`UPDATE learning_items SET note=?,note_updated_at=? WHERE id=? ${guarded?"AND COALESCE(note_updated_at,'')=COALESCE(?,'')":''}`,data.note,noteUpdatedAt,id,...(guarded?[data.base_note_updated_at]:[])).run();
            if(!result.meta.changes){const latest=await item(env,id);return json({error:'筆記已在其他地方更新，請選擇要保留的版本。',code:'note_conflict',note:latest.note,note_updated_at:latest.note_updated_at},409);}
          }
          if('read' in data){if(typeof data.read!=='boolean')throw new Error('已讀狀態需為 boolean');await query(env,'UPDATE learning_items SET read_at=? WHERE id=?',data.read?nowIso():null,id).run();}
          return json({ok:true,note_updated_at:noteUpdatedAt});
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
        if(data.action==='pause')await setSetting(env,'control',{paused:true,reason:'manual',paused_at:nowIso()});
        else if(data.action==='resume'){await resume(env);await service.recover(env);const sync=await setting(env,'sync');if(sync.running&&env.LEARNING_JOBS)await env.LEARNING_JOBS.send({kind:'sync'});}
        else throw new Error('未知處理動作');
        return json(await budget(env));
      }
      if(route==='ask'&&request.method==='POST'){
        const data=await body(request);
        if(data.item_id&&!await item(env,data.item_id))return json({error:'文章不存在'},404);
        const itemId=data.item_id?await resolveItemId(env,data.item_id):null;
        const result=await service.ask(env,data.question,itemId);
        return json(result,result.status==='done'?200:202);
      }
      if(route==='questions'&&request.method==='GET'){
        const itemId=url.searchParams.get('item_id');
        if(itemId&&!/^[a-f0-9]{32}$/.test(itemId))throw new Error('文章識別碼無效');
        return json(await listQuestions(env,itemId?await resolveItemId(env,itemId):null));
      }
      const questionMatch=route.match(/^questions\/([0-9a-f-]{36})$/);
      if(questionMatch&&request.method==='GET'){
        const row=await query(env,'SELECT * FROM learning_questions WHERE id=?',questionMatch[1]).first();
        return row?json(questionView(row)):json({error:'問題不存在'},404);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createLearningHandler} from '../src/learning/http.js';
import {budget,reserve,settle,setting,setSetting,query,rows,saveConnection,connection,item,saveEvidence} from '../src/learning/store.js';
import {generate} from '../src/learning/gemini.js';
import {publicFetch,canonicalUrl} from '../src/learning/network.js';
import {expireMedia} from '../src/learning/media.js';
import {normalizePost} from '../src/learning/x.js';

function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){return {meta:sqlite.prepare(sql).run(...this.args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return db;
}
function mediaStore(){const objects=new Map();return {objects,async put(key,stream,options){const bytes=new Uint8Array(await new Response(stream).arrayBuffer());objects.set(key,{bytes,options});},async get(key){const value=objects.get(key);return value?{body:new Response(value.bytes).body,size:value.bytes.length}:null;},async delete(key){objects.delete(key);}};}
function environment(){const jobs=[];return {DB:database(),RUN_TOKEN:'private-test-token',GEMINI_API_KEY:'gemini-test-secret',LEARNING_ENABLED:'true',PUBLIC_BASE_URL:'https://learning.example.org',LEARNING_MONTHLY_USD:'30',MEDIA:mediaStore(),LEARNING_JOBS:{jobs,async send(job){jobs.push(job);}},TELEGRAM_BOT_TOKEN:'telegram-test',TELEGRAM_CHAT_ID:'-1001',TELEGRAM_WEBHOOK_SECRET:'webhook-test',TELEGRAM_ALLOWED_CHAT_IDS:'42',X_CLIENT_ID:'x-client',X_CLIENT_SECRET:'x-secret',X_APP_OWNER_ID:'7'};}
const longBody='背景與機制。'.repeat(1200)+'最末的版本限制不能刪掉。';
function network(overrides={}){
  const calls=[];
  async function fetcher(value,options={}){
    const url=new URL(value);calls.push({url:url.href,options});
    if(overrides.fetch){const result=await overrides.fetch(url,options,calls);if(result)return result;}
    if(url.hostname==='cloudflare-dns.com')return Response.json({Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.216.34'}]:[]});
    if(url.hostname==='generativelanguage.googleapis.com'&&url.pathname.endsWith(':generateContent')){
      const request=JSON.parse(options.body),payload=JSON.parse(request.contents[0].parts.at(-1).text);
      const observations=[];
      for(let i=0;i<request.contents[0].parts.length;i++)if(request.contents[0].parts[i].fileData?.mimeType.startsWith('video/')){
        const sourceId=request.contents[0].parts[i-1].text.match(/媒體來源 ID：([^；]+)/)[1];
        observations.push({source_id:sourceId,timestamp:'00:18',description:'示範畫面顯示設定位置'});
      }
      const answer=payload.question?{answer:'依來源，先確認背景與版本限制。',citations:[payload.sources[0].id],insufficient:false}:{title:'完整技術教材',body:longBody,intro:'背景、操作方式與限制都保留。',citations:payload.sources.map(s=>s.id),observations};
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:2000,thoughtsTokenCount:100}});
    }
    if(url.hostname==='api.telegram.org')return Response.json({ok:true,result:{message_id:calls.length}});
    if(url.hostname==='example.org')return new Response('<html><h1>原始技術文章</h1><article><p>背景原文。'.repeat(100)+'最後的來源限制。</p></article></html>',{headers:{'content-type':'text/html'}});
    if(url.hostname==='api.x.com'&&url.pathname==='/2/oauth2/token')return Response.json({access_token:'access-secret',refresh_token:'refresh-secret',expires_in:7200});
    if(url.hostname==='api.x.com'&&url.pathname==='/2/users/me')return Response.json({data:{id:'7'}});
    if(url.hostname==='api.x.com'&&/^\/2\/users\/\d+$/.test(url.pathname)){const id=url.pathname.split('/').at(-1);return Response.json({data:{id,username:'author'+id,name:'作者'}});}
    throw Error('Unexpected test network call: '+url.href);
  }
  return {fetcher,calls};
}
function request(path,method='GET',data=null,headers={}){return new Request('https://learning.example.org/learning/'+path,{method,headers:{authorization:'Bearer private-test-token','content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});}
async function connect(env){await saveConnection(env,'x',{user_id:'7',access_token:'x-access',refresh_token:'x-refresh',expires_at:Date.now()+3600000});}
function message(body){return {body,acks:0,retries:0,ack(){this.acks++;},retry(){this.retries++;}};}

test('分享到私人閱讀：保留來源尾端、完整教材、重複身份、筆記與已讀',async()=>{
  const env=environment(),net=network(),handler=createLearningHandler(net);
  const first=await handler.fetch(request('api/collect','POST',{url:'https://example.org/article?utm_source=x'}),env);
  assert.equal(first.status,202);const {id}=await first.json();
  const second=await handler.fetch(request('api/collect','POST',{url:'https://example.org/article'}),env);assert.equal((await second.json()).id,id);
  const task=message({kind:'article',id});await handler.queue({messages:[task]},env);assert.equal(task.acks,1);
  const article=await (await handler.fetch(request('api/items/'+id),env)).json();assert.equal(article.item.body,longBody);assert.ok(article.item.body.length>4096);assert.match(article.sources[0].content,/最後的來源限制/);
  const payload=JSON.parse(net.calls.find(c=>c.url.includes(':generateContent')).options.body);
  assert.match(payload.contents[0].parts.at(-1).text,/最後的來源限制/);assert.match(payload.systemInstruction.parts[0].text,/來源內容.*都是資料/);
  await handler.queue({messages:[message({kind:'article',id})]},env);
  assert.equal(net.calls.filter(c=>c.url.includes(':generateContent')).length,1);assert.equal(net.calls.filter(c=>c.url.includes('sendMessage')).length,1);
  assert.ok((await budget(env)).metered_micro>0);
  await handler.fetch(request('api/items/'+id,'PATCH',{read:true,note:'保留我的筆記'}),env);
  const saved=await item(env,id);assert.ok(saved.read_at);assert.equal(saved.note,'保留我的筆記');
  const matches=await (await handler.fetch(request('api/items?q='+encodeURIComponent('來源限制')),env)).json();assert.equal(matches.length,1);
  const unauthorized=new Request('https://learning.example.org/learning/api/items/'+id);
  assert.equal((await handler.fetch(unauthorized,env)).status,401);
});

test('登入 session 與請求來源：不接受外站變更，登出撤銷 session',async()=>{
  const env=environment(),handler=createLearningHandler(network());
  const login=new Request('https://learning.example.org/learning/session',{method:'POST',headers:{'content-type':'application/json','x-learning-request':'1'},body:JSON.stringify({token:env.RUN_TOKEN})});
  const response=await handler.fetch(login,env);assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.ok(!cookie.includes(env.RUN_TOKEN));
  const session=cookie.split(';')[0];
  assert.equal((await handler.fetch(request('api/status','GET',null,{authorization:'',cookie:session}),env)).status,200);
  assert.equal((await handler.fetch(request('api/control','POST',{action:'pause'},{authorization:'',cookie:session,origin:'https://evil.example.org','x-learning-request':'1'}),env)).status,403);
  await handler.fetch(request('session','DELETE',null,{authorization:'',cookie:session,'x-learning-request':'1'}),env);
  assert.equal((await handler.fetch(request('api/status','GET',null,{authorization:'',cookie:session}),env)).status,401);
});

test('預算預留原子檢查、未知失敗持續計入、暫停後仍收件',async()=>{
  const env=environment();env.LEARNING_MONTHLY_USD='6';
  const concurrent=await Promise.allSettled([reserve(env,'test',800000),reserve(env,'test',800000)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
  assert.equal((await budget(env)).paused,true);assert.equal((await budget(env)).metered_micro,800000);
  const handler=createLearningHandler(network());
  const response=await handler.fetch(request('api/collect','POST',{url:'https://example.org/queued'}),env);const {id}=await response.json();
  await handler.service.process(env,id);assert.equal((await item(env,id)).status,'budget_paused');assert.equal((await rows(env,'SELECT * FROM learning_items')).length,1);
  const saved=Date.now;Date.now=()=>Date.parse('2026-11-15T00:00:00Z');
  try{const next=await budget(env);assert.equal(next.paused,true);assert.equal(next.metered_micro,0);}finally{Date.now=saved;}
});

test('模型契約：原生影片、完整輸出、已知用量與無效引用',async()=>{
  const env=environment(),sources=[{id:'source',url:'https://example.org',content:'完整資料'}];
  const media=[{type:'video',evidence_id:'source',mime:'video/mp4',duration_ms:50000,file_json:JSON.stringify({uri:'https://generativelanguage.googleapis.com/v1beta/files/video'})}];
  let sent;
  const good=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title:'教材',body:longBody,intro:'導讀',citations:['source'],observations:[{source_id:'source',timestamp:'00:18',description:'畫面顯示選項'}]})}]}}],usageMetadata:{promptTokenCount:20000,candidatesTokenCount:2000,thoughtsTokenCount:100}});};
  const result=await generate(env,sources,media,[],null,good);assert.equal(result.body,longBody);assert.ok(sent.contents[0].parts.some(p=>p.fileData?.mimeType==='video/mp4'));assert.ok(!JSON.stringify(sent).includes(env.GEMINI_API_KEY));
  const invalid=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({answer:'錯誤引用',citations:['invented'],insufficient:false})}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:100}});
  await assert.rejects(generate(env,sources,[],[],'問題',invalid),/未提供/);
  const interrupted=async()=>{throw Error('Connection lost');};
  await assert.rejects(generate(env,sources,[],[],null,interrupted),/Connection lost/);
  assert.ok((await rows(env,"SELECT * FROM learning_costs WHERE status='uncertain'")).length);
});

test('Telegram 收件限制、重複 webhook 與收件回覆',async()=>{
  const env=environment(),net=network(),handler=createLearningHandler(net);
  const update={update_id:100,message:{chat:{id:42},text:'https://example.org/article'}};
  const hook=()=>request('telegram','POST',update,{'x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET});
  assert.equal((await handler.fetch(hook(),env)).status,200);assert.equal((await handler.fetch(hook(),env)).status,200);
  assert.equal((await rows(env,'SELECT * FROM learning_items')).length,1);assert.equal((await rows(env,'SELECT * FROM learning_intakes')).length,1);
  assert.equal(net.calls.filter(c=>c.url.includes('sendMessage')).length,1);
  assert.equal(JSON.parse(net.calls.find(c=>c.url.includes('sendMessage')).options.body).chat_id,'42');
  assert.equal((await handler.fetch(request('telegram','POST',update),env)).status,404);
  const unauthorized={...update,update_id:101,message:{chat:{id:9},text:'https://example.org/blocked'}};
  assert.equal((await handler.fetch(request('telegram','POST',unauthorized,{'x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET}),env)).status,200);
  assert.equal((await rows(env,'SELECT * FROM learning_items')).length,1);
});

test('通知失敗重用完整教材，不再次呼叫模型',async()=>{
  const env=environment();let reject=true;
  const net=network({fetch(url){if(url.hostname==='api.telegram.org'&&reject)return new Response('',{status:502});}}),handler=createLearningHandler(net);
  const id=await handler.service.collect(env,'https://example.org/article');await handler.service.process(env,id);
  await assert.rejects(handler.service.flush(env),/HTTP 502/);assert.equal((await item(env,id)).status,'ready');
  reject=false;await handler.service.flush(env);
  assert.equal(net.calls.filter(c=>c.url.includes(':generateContent')).length,1);assert.equal((await rows(env,"SELECT * FROM learning_deliveries WHERE status='sent'")).length,1);
});

test('書籤全分頁、首次回補確認、已知 ID 不提前停止與中斷續跑',async()=>{
  const env=environment();await connect(env);let page2Fails=true,forbidden=false,partialErrors=false;
  const net=network({fetch(url){
    if(url.pathname==='/2/users/7/bookmarks'){
      const cursor=url.searchParams.get('pagination_token');
      if(forbidden)return new Response('',{status:403});
      if(cursor==='expired')return new Response('',{status:400});
      if(partialErrors)return Response.json({data:[],meta:{},errors:[{resource_type:'tweet',resource_id:'103',title:'Unavailable'}]});
      if(cursor==='p2'&&page2Fails)return new Response('',{status:503});
      return Response.json(cursor==='p2'?{data:[{id:'102',text:'第二頁收藏',author_id:'9'}],meta:{}}:{data:[{id:'101',text:'第一頁收藏',author_id:'9'}],meta:{next_token:'p2'}});
    }
    if(url.pathname==='/2/tweets/search/all')return Response.json({data:[],meta:{}});
  }}),handler=createLearningHandler(net);
  await assert.rejects(handler.service.sync(env),/503/);
  assert.equal((await setting(env,'sync')).cursor,'p2');assert.equal((await rows(env,"SELECT * FROM learning_items WHERE status='awaiting_backfill'")).length,1);
  page2Fails=false;await handler.service.sync(env);
  assert.equal((await setting(env,'sync')).baseline_complete,true);assert.equal((await rows(env,'SELECT * FROM learning_items')).length,2);
  assert.equal(net.calls.filter(c=>c.url.includes(':generateContent')).length,0);
  await handler.service.backfill(env);
  for(const row of await rows(env,'SELECT * FROM learning_items'))await handler.service.process(env,row.id);
  await handler.service.sync(env);
  assert.equal(net.calls.filter(c=>new URL(c.url).searchParams.get('pagination_token')==='p2').length,3);
  assert.equal((await rows(env,'SELECT * FROM learning_items')).length,2);
  await setSetting(env,'sync',{...await setting(env,'sync'),cursor:'expired',running:true});
  await assert.rejects(handler.service.sync(env),/400/);assert.equal((await setting(env,'sync')).cursor,null);
  await handler.service.sync(env);assert.equal((await rows(env,'SELECT * FROM learning_items')).length,2);
  forbidden=true;await assert.rejects(handler.service.sync(env),/403/);assert.equal((await setting(env,'sync')).requires_action,true);
  const previous=net.calls.length;await handler.service.sync(env);assert.equal(net.calls.length,previous);
  forbidden=false;await handler.fetch(request('api/x/sync','POST',{}),env);assert.equal((await setting(env,'sync')).requires_action,false);
  partialErrors=true;await handler.service.sync(env);assert.equal((await setting(env,'sync')).incomplete,true);
  assert.equal((await rows(env,'SELECT * FROM learning_items')).length,3);assert.match((await setting(env,'sync')).last_error,/不能確認所有來源/);
});

test('X OAuth PKCE 驗證回呼、憑證加密與重播拒絕',async()=>{
  const env=environment(),net=network(),handler=createLearningHandler(net);
  const start=await handler.fetch(request('api/x/connect','POST',{}),env);const auth=new URL((await start.json()).url);
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.match(auth.searchParams.get('scope'),/offline.access/);
  const state=auth.searchParams.get('state');
  const callback=new Request('https://learning.example.org/learning/x/callback?state='+state+'&code=test-code',{headers:{cookie:'learning_oauth='+state}});
  const success=await handler.fetch(callback,env);assert.equal(success.status,303);assert.equal((await connection(env,'x')).user_id,'7');
  const serialized=JSON.stringify(await rows(env,'SELECT * FROM learning_connections'));assert.ok(!serialized.includes('access-secret'));assert.ok(!serialized.includes('refresh-secret'));
  assert.equal((await handler.fetch(callback,env)).status,400);
});

test('作者補充、引用、外連缺漏與重試後補齊同一篇',async()=>{
  const env=environment();await connect(env);let externalFails=true;
  const net=network({fetch(url){
    if(url.pathname==='/2/tweets/111')return Response.json({data:{id:'111',author_id:'9',text:'主貼文',note_post:{text:'完整長文。'.repeat(5000)},conversation_id:'111',referenced_posts:[{id:'222',type:'quoted'}],entities:{urls:[{expanded_url:'https://example.org/extra'}]}}});
    if(url.pathname==='/2/tweets/222')return Response.json({data:{id:'222',author_id:'8',text:'被引用的限制'}});
    if(url.pathname==='/2/tweets/search/all')return Response.json({data:[{id:'333',author_id:'9',text:'作者補充：只支援特定版本'}],meta:{}});
    if(url.hostname==='example.org'&&externalFails)return new Response('',{status:403});
  }}),handler=createLearningHandler(net);
  const id=await handler.service.collect(env,'https://x.com/author/status/111');await handler.service.process(env,id);
  assert.equal((await item(env,id)).status,'partial');
  assert.ok(net.calls.some(c=>new URL(c.url).searchParams.get('query')==='conversation_id:111 from:author9'));
  const first=await (await handler.fetch(request('api/items/'+id),env)).json();assert.ok(first.sources.some(s=>s.relation==='author_reply'));assert.ok(first.sources.some(s=>s.relation==='quote'));assert.ok(first.sources.find(s=>s.relation==='primary').content.length>20000);
  externalFails=false;await handler.fetch(request('api/items/'+id+'/retry','POST',{}),env);await handler.service.process(env,id);
  assert.equal((await item(env,id)).status,'ready');assert.equal((await item(env,id)).revision,2);assert.equal((await rows(env,'SELECT * FROM learning_items')).length,1);
});

test('書籤通知沒有篇數上限，超長時分批且包含每個來源',async()=>{
  const env=environment(),net=network(),handler=createLearningHandler(net);
  for(let i=0;i<12;i++){
    const id=await handler.service.collect(env,'https://example.org/article'+i,'bookmark');await handler.service.process(env,id);
    const article=JSON.parse((await item(env,id)).article_json);article.intro='完整導讀。'.repeat(90);
    await query(env,'UPDATE learning_items SET article_json=? WHERE id=?',JSON.stringify(article),id).run();
  }
  await handler.service.flush(env,'bookmarks');
  const messages=net.calls.filter(c=>c.url.includes('sendMessage')).map(c=>JSON.parse(c.options.body).text);
  assert.ok(messages.length>1);assert.ok(messages.every(m=>m.length<=4096));
  for(const row of await rows(env,'SELECT * FROM learning_items'))assert.ok(messages.some(m=>m.includes(row.id)));
});

test('私人搜尋與單篇／跨文章追問附真實片段引用',async()=>{
  const env=environment(),handler=createLearningHandler(network());
  const id=await handler.service.collect(env,'https://example.org/article');await handler.service.process(env,id);
  const single=await (await handler.fetch(request('api/ask','POST',{item_id:id,question:'版本限制是什麼？'}),env)).json();assert.equal(single.insufficient,false);assert.equal(single.sources.length,1);assert.match(single.sources[0].url,/example.org/);
  const cross=await (await handler.fetch(request('api/ask','POST',{question:'背景與版本限制'}),env)).json();assert.ok(cross.sources.length);
  const unknown=await (await handler.fetch(request('api/ask','POST',{question:'完全不存在的火星引擎？'}),env)).json();assert.equal(unknown.insufficient,true);assert.equal(unknown.sources.length,0);
  await setSetting(env,'control',{paused:true});
  const blocked=await handler.fetch(request('api/ask','POST',{item_id:id,question:'版本限制'}),env);assert.equal(blocked.status,429);
});

test('來源與重新導向拒絕私有位址；兩種 X 長文欄位可正規化',async()=>{
  assert.throws(()=>canonicalUrl('https://127.0.0.1/admin'));assert.throws(()=>canonicalUrl('https://host.local/a'));assert.throws(()=>canonicalUrl('https://example.org:8443/a'));
  const bad=network({fetch(url){if(url.hostname==='example.org')return new Response('',{status:302,headers:{location:'https://127.0.0.1/admin'}});}});
  await assert.rejects(publicFetch('https://example.org/article',bad.fetcher),/內網/);
  const dns=async()=>Response.json({Answer:[{type:1,data:'10.0.0.1'}]});await assert.rejects(publicFetch('https://example.org/article',dns),/公開位址/);
  assert.equal(normalizePost({id:'1',note_tweet:{text:'舊欄位長文'}}).content,'舊欄位長文');assert.equal(normalizePost({id:'1',note_post:{text:'新欄位長文'}}).content,'新欄位長文');
});

test('影片原生上傳、處理中續跑與原始媒體到期不刪教材',async()=>{
  const env=environment();await connect(env);let processed=false;
  const net=network({fetch(url,options){
    if(url.pathname==='/2/tweets/777')return Response.json({data:{id:'777',author_id:'9',text:'影片示範',attachments:{media_keys:['m']}},includes:{media:[{media_key:'m',type:'video',duration_ms:30000,variants:[{content_type:'video/mp4',url:'https://video.twimg.com/demo.mp4'}]}]}});
    if(url.pathname==='/2/tweets/search/all')return Response.json({data:[],meta:{}});
    if(url.hostname==='video.twimg.com')return new Response(new Uint8Array(32),{headers:{'content-type':'video/mp4','content-length':'32'}});
    if(url.pathname==='/upload/v1beta/files')return new Response('',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/session'}});
    if(url.pathname==='/upload/session')return Response.json({file:{name:'files/demo',state:'PROCESSING'}});
    if(url.pathname==='/v1beta/files/demo')return Response.json({name:'files/demo',state:processed?'ACTIVE':'PROCESSING',uri:'https://generativelanguage.googleapis.com/v1beta/files/demo',expirationTime:new Date(Date.now()+86400000).toISOString()});
  }}),handler=createLearningHandler(net);
  const id=await handler.service.collect(env,'https://x.com/author/status/777');assert.equal((await handler.service.process(env,id)).pending,true);assert.equal(net.calls.filter(c=>c.url.includes(':generateContent')).length,0);
  processed=true;await handler.service.process(env,id);assert.equal((await item(env,id)).status,'ready');
  const sent=JSON.parse(net.calls.find(c=>c.url.includes(':generateContent')).options.body);assert.ok(sent.contents[0].parts.some(p=>p.fileData?.mimeType==='video/mp4'));
  assert.equal(net.calls.filter(c=>c.url.includes('/upload/session')).length,1);
  await query(env,'UPDATE learning_media SET expires_at=? WHERE item_id=?','2020-01-01',id).run();await expireMedia(env);
  assert.equal(env.MEDIA.objects.size,0);assert.equal((await item(env,id)).body,longBody);assert.equal((await rows(env,'SELECT status FROM learning_media'))[0].status,'expired');
});

test('超限影片保留缺漏，不下載、不截短，也不當作完整影片',async()=>{
  const env=environment(),handler=createLearningHandler({...network(),postEvidence:async()=>({url:'https://x.com/i/status/999',content:'超限影片主文',relation:'primary',author_id:'9',metadata:{post_id:'999',conversation_id:'999',references:[],links:[]},media:[{type:'video',url:'https://video.twimg.com/long.mp4',duration_ms:1200001}]}),xRead:async()=>({data:[],meta:{}})});
  const id=await handler.service.collect(env,'https://x.com/author/status/999');await handler.service.process(env,id);
  const row=await item(env,id);assert.equal(row.status,'partial');assert.match(row.gaps_json,/20 分鐘/);assert.equal((await rows(env,'SELECT status FROM learning_media'))[0].status,'needs_attention');
});

test('缺少影片時間點或模型輸出未完成，不保存為完整教材',async()=>{
  const env=environment(),sources=[{id:'video',url:'https://x.com/i/status/1',content:'示範'}];
  const media=[{type:'video',evidence_id:'video',mime:'video/mp4',duration_ms:30000,file_json:JSON.stringify({uri:'https://generativelanguage.googleapis.com/v1beta/files/video'})}];
  const response=finish=>async()=>Response.json({candidates:[{finishReason:finish,content:{parts:[{text:JSON.stringify({title:'教材',body:'內容',intro:'導讀',citations:['video'],observations:[]})}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:100}});
  await assert.rejects(generate(env,sources,media,[],null,response('STOP')),/時間點觀察/);
  await assert.rejects(generate(env,sources,[],[],null,response('MAX_TOKENS')),/未完成/);
  assert.equal((await rows(env,"SELECT * FROM learning_costs WHERE status='settled'")).length,2);
});

test('作者補充到期只重查一次，更新同一教材與通知',async()=>{
  const env=environment();await connect(env);let count=0;
  const net=network({fetch(url){
    if(url.pathname==='/2/tweets/445')return Response.json({data:{id:'445',author_id:'9',text:'版本公告',conversation_id:'445'}});
    if(url.pathname==='/2/tweets/search/all')return Response.json({data:++count===1?[]:[{id:'446',author_id:'9',text:'新增補充：某版本不支援'}],meta:{}});
  }}),handler=createLearningHandler(net);
  const id=await handler.service.collect(env,'https://x.com/author/status/445');await handler.service.process(env,id);await handler.service.flush(env);
  await query(env,"UPDATE learning_items SET recheck_at='2020-01-01' WHERE id=?",id).run();
  await handler.scheduled(env,true);assert.equal((await item(env,id)).status,'queued');await handler.service.process(env,id);await handler.service.flush(env);
  assert.equal((await item(env,id)).revision,2);assert.equal((await item(env,id)).rechecked,1);assert.equal((await rows(env,'SELECT * FROM learning_items')).length,1);
  await handler.scheduled(env,true);assert.equal((await item(env,id)).status,'ready');assert.equal(count,2);
  assert.equal(net.calls.filter(c=>c.url.includes('sendMessage')).length,2);
});

test('200 MB 以上的宣告大小與原文失敗都保留待處理，未截短生成',async()=>{
  const env=environment();await connect(env);let downloads=0;
  const net=network({fetch(url){if(url.hostname==='video.twimg.com'){downloads++;return new Response(new Uint8Array(1),{headers:{'content-type':'video/mp4','content-length':String(200*1024*1024+1)}});}}});
  const handler=createLearningHandler({...net,postEvidence:async()=>({url:'https://x.com/i/status/991',content:'大型影片主文',relation:'primary',author_id:'9',metadata:{post_id:'991',conversation_id:'991',references:[],links:[]},media:[{type:'video',url:'https://video.twimg.com/large.mp4',duration_ms:30000}]}),xRead:async()=>({data:[],meta:{}})});
  const id=await handler.service.collect(env,'https://x.com/author/status/991');await handler.service.process(env,id);assert.equal(downloads,1);assert.equal(env.MEDIA.objects.size,0);assert.match((await item(env,id)).gaps_json,/200 MB/);
  const broken=createLearningHandler({...net,webEvidence:async()=>{throw Error('主文不存在');}});
  const missing=await broken.service.collect(env,'https://example.org/missing');
  for(let i=0;i<3;i++)await assert.rejects(broken.service.process(env,missing),/主文不存在/);
  assert.equal((await item(env,missing)).body,null);assert.equal((await item(env,missing)).status,'needs_attention');
});

test('登入憑證輪替撤銷舊 session；追問使用位於來源尾端的有限片段',async()=>{
  const env=environment(),net=network(),handler=createLearningHandler(net);
  const response=await handler.fetch(request('session','POST',{token:env.RUN_TOKEN}),env);const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await handler.fetch(request('api/status','GET',null,{authorization:'',cookie}),{...env,RUN_TOKEN:'changed'})).status,401);
  const id=await handler.service.collect(env,'https://example.org/article');await handler.service.process(env,id);
  await query(env,'UPDATE learning_evidence SET content=? WHERE item_id=?','前文。'.repeat(50000)+'特殊結尾限制：必須啟用 FLAG_TAIL。',id).run();
  const answer=await handler.service.ask(env,'特殊結尾限制 FLAG_TAIL',id);assert.ok(answer.sources.some(s=>s.range_start>100000));
  const requestBody=JSON.parse(net.calls.filter(c=>c.url.includes(':generateContent')).at(-1).options.body);
  const payload=JSON.parse(requestBody.contents[0].parts.at(-1).text);assert.ok(payload.sources.every(s=>s.content.length<=12000));assert.match(payload.sources[0].content,/FLAG_TAIL/);
});

test('圖片原生輸入與私人媒體讀取：沒有文字的貼文也能整理',async()=>{
  const env=environment();await connect(env);
  const net=network({fetch(url){
    if(url.pathname==='/2/tweets/881')return Response.json({data:{id:'881',author_id:'9',text:'',attachments:{media_keys:['photo']}},includes:{media:[{media_key:'photo',type:'photo',url:'https://pbs.twimg.com/test.png'}]}});
    if(url.pathname==='/2/tweets/search/all')return Response.json({data:[],meta:{}});
    if(url.hostname==='pbs.twimg.com')return new Response(new Uint8Array(32),{headers:{'content-type':'image/png','content-length':'32'}});
    if(url.pathname==='/upload/v1beta/files')return new Response('',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/photo'}});
    if(url.pathname==='/upload/photo')return Response.json({file:{name:'files/photo',state:'ACTIVE',uri:'https://generativelanguage.googleapis.com/v1beta/files/photo'}});
  }}),handler=createLearningHandler(net);
  const id=await handler.service.collect(env,'https://x.com/author/status/881');await handler.service.process(env,id);
  assert.equal((await item(env,id)).status,'ready');
  const assets=await rows(env,'SELECT * FROM learning_media');assert.equal(assets[0].status,'ready');
  const payload=JSON.parse(net.calls.find(c=>c.url.includes(':generateContent')).options.body);assert.ok(payload.contents[0].parts.some(p=>p.fileData?.mimeType==='image/png'));
  const privateMedia=await handler.fetch(request('api/media/'+assets[0].id),env);assert.equal(privateMedia.status,200);assert.equal((await privateMedia.arrayBuffer()).byteLength,32);
  assert.equal((await handler.fetch(new Request('https://learning.example.org/learning/api/media/'+assets[0].id),env)).status,401);
});

test('貼文明列附件但沒有回傳媒體資料時，標示缺漏而不是完整教材',async()=>{
  const env=environment(),net=network(),handler=createLearningHandler({...net,postEvidence:async()=>normalizePost({id:'889',author_id:'9',text:'貼文宣告圖片',attachments:{media_keys:['missing-photo']}}),xRead:async()=>({data:[],meta:{}})});
  const id=await handler.service.collect(env,'https://x.com/author/status/889');await handler.service.process(env,id);
  const saved=await item(env,id);assert.equal(saved.status,'partial');assert.match(saved.gaps_json,/完整媒體 URL/);assert.equal((await rows(env,'SELECT * FROM learning_media')).length,1);
});

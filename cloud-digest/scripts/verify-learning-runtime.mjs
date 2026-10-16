import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// 使用實際 Workers、D1、R2 的本機模擬，不連接任何付費 API。
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'learning',modules:true,script:readFileSync(process.argv[2] || '/private/tmp/technews-learning-build/index.js','utf8'),compatibilityDate:'2026-09-23',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'learning-runtime-db'},r2Buckets:['MEDIA'],bindings:{RUN_TOKEN:'runtime-only',LEARNING_RUNNER_TOKEN:'runner-only',LEARNING_ENABLED:'true',LEARNING_MONTHLY_USD:'30',PUBLIC_BASE_URL:'https://example.org'}}]}));
try{
  const db=await runtime.getD1Database('DB');
  for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
    for(const statement of readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const origin='https://example.org/learning/';
  const login=await runtime.dispatchFetch(origin+'session',{method:'POST',headers:{'content-type':'application/json','x-learning-request':'1'},body:JSON.stringify({token:'runtime-only'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await runtime.dispatchFetch(origin+'api/status',{headers:{cookie}});assert.equal(status.status,200);assert.equal((await status.json()).budget.base_micro,5000000);
  const pause=await runtime.dispatchFetch(origin+'api/control',{method:'POST',headers:{cookie,'content-type':'application/json','x-learning-request':'1'},body:JSON.stringify({action:'pause'})});assert.equal((await pause.json()).paused,true);
  const malicious=await runtime.dispatchFetch(origin+'api/collect',{method:'POST',headers:{cookie,'content-type':'application/json','x-learning-request':'1'},body:JSON.stringify({url:'https://127.0.0.1/admin'})});assert.equal(malicious.status,400);
  const id='a'.repeat(32),time=new Date().toISOString();
  await db.prepare('INSERT INTO learning_items(id,url,kind,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,'https://example.org/runtime','web',time,time).run();
  await db.prepare('INSERT INTO learning_evidence(id,item_id,url,relation,fetched_at) VALUES(?,?,?,?,?)').bind('source',id,'https://example.org/runtime','primary',time).run();
  await db.prepare('UPDATE learning_items SET body=? WHERE id=?').bind('### 已渲染\n\n**內容**<script>alert(1)</script>',id).run();
  const article=await runtime.dispatchFetch(origin+'api/items/'+id,{headers:{cookie}});
  const rendered=(await article.json()).item.body_html;assert.match(rendered,/<h3>已渲染<\/h3>/);assert.ok(!rendered.includes('<script>'));
  const awaiting='b'.repeat(32);
  await db.prepare("INSERT INTO learning_items(id,url,kind,status,created_at,updated_at) VALUES(?,?,?,'awaiting_backfill',?,?)").bind(awaiting,'https://example.org/awaiting','web',time,time).run();
  await db.prepare('INSERT INTO learning_evidence(id,item_id,url,relation,content,fetched_at) VALUES(?,?,?,?,?,?)').bind('preview-source',awaiting,'https://example.org/awaiting','primary','已保存原文',time).run();
  const preview=await runtime.dispatchFetch(origin+'api/items?status=awaiting_backfill',{headers:{cookie}});assert.equal((await preview.json())[0].preview,'已保存原文');
  const removed=await runtime.dispatchFetch(origin+'api/items/'+awaiting,{method:'DELETE',headers:{cookie,'x-learning-request':'1'}});assert.equal(removed.status,200);
  assert.equal((await db.prepare('SELECT status FROM learning_items WHERE id=?').bind(awaiting).first()).status,'dismissed');
  assert.equal((await db.prepare('SELECT count(*) AS count FROM learning_evidence WHERE item_id=?').bind(awaiting).first()).count,0);
  await db.prepare('INSERT INTO learning_media(id,item_id,evidence_id,url,type,mime,bytes,object_key,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('asset',id,'source','https://example.org/photo','photo','image/png',3,'learning/runtime','ready',time).run();
  const bucket=await runtime.getR2Bucket('MEDIA');await bucket.put('learning/runtime',new Uint8Array([1,2,3]));
  const media=await runtime.dispatchFetch(origin+'api/media/asset',{headers:{cookie,range:'bytes=1-2'}});assert.equal(media.status,206);assert.equal(media.headers.get('content-range'),'bytes 1-2/3');assert.deepEqual([...new Uint8Array(await media.arrayBuffer())],[2,3]);
  const privateMedia=await runtime.dispatchFetch(origin+'api/media/asset');assert.equal(privateMedia.status,401);
  // 統一流程：本機執行器協定、狀態篩選、預算明細與管理頁在實際 D1 上執行。
  const json=(path,method='GET',data)=>runtime.dispatchFetch(origin+path,{method,headers:{cookie,'content-type':'application/json','x-learning-request':'1'},...(data?{body:JSON.stringify(data)}:{})});
  assert.equal((await json('api/control','POST',{action:'resume'})).status,200);
  assert.equal((await json('api/admin/text-provider','PUT',{provider:'local'})).status,200);
  const localId='c'.repeat(32);
  await db.prepare("INSERT INTO learning_items(id,url,kind,status,stage,created_at,updated_at) VALUES(?,?,'web','waiting_local','text',?,?)").bind(localId,'https://example.org/local',time,time).run();
  await db.prepare("INSERT INTO learning_intakes(receipt,item_id,origin,created_at) VALUES('runtime-web',?,'web',?)").bind(localId,time).run();
  await db.prepare("INSERT INTO learning_jobs(id,kind,item_id,status,priority,input_version,input_json,created_at,updated_at) VALUES('job1','article',?,'waiting_local',1,'v1',?,?,?)").bind(localId,JSON.stringify({prompt_version:'local-article-v1',sources:[{ref:'S1',id:'local-source',content:'原文'}],gaps:[],content_fingerprint:'c1'}),time,time).run();
  const runner=(action,data)=>runtime.dispatchFetch('https://example.org/learning/runner/'+action,{method:'POST',headers:{authorization:'Bearer runner-only','content-type':'application/json'},body:JSON.stringify({runner_id:'runtime-mac',...data})});
  assert.equal((await runtime.dispatchFetch('https://example.org/learning/runner/claim',{method:'POST',headers:{authorization:'Bearer runtime-only','content-type':'application/json'},body:'{}'})).status,404);
  const job=(await (await runner('claim',{info:{version:'test'}})).json()).job;assert.equal(job.id,'job1');
  assert.equal((await runner('heartbeat',{job_id:'job1',attempt_token:job.attempt_token})).status,200);
  const done=await runner('complete',{job_id:'job1',attempt_token:job.attempt_token,input_version:'v1',model:{name:'gemma4:26b',done_reason:'stop'},output:{title:'本機教材',intro:'介紹',body:'## 正文\n內容 [S1]',citations:['S1']}});
  assert.equal(done.status,200);assert.equal((await done.json()).revision,1);
  assert.equal((await db.prepare('SELECT status FROM learning_items WHERE id=?').bind(localId).first()).status,'ready');
  assert.equal((await runner('complete',{job_id:'job1',attempt_token:'stale',input_version:'v1',model:{done_reason:'stop'},output:{}})).status,409);
  const states=await (await json('api/items/states?ids='+localId)).json();assert.equal(states[0].status,'ready');
  assert.ok((await (await json('api/items?state=ready&origin=web&unread=1')).json()).some(i=>i.id===localId));
  const noted=await (await json('api/items/'+localId,'PATCH',{note:'筆記',base_note_updated_at:null})).json();
  assert.equal((await json('api/items/'+localId,'PATCH',{note:'舊分頁',base_note_updated_at:null})).status,409);
  assert.ok(noted.note_updated_at);
  const budgetSummary=await (await json('api/budget')).json();assert.equal(budgetSummary.x_pricing.checked_at,'2026-10-16');
  assert.equal((await json('api/admin/migrate','POST',{})).status,200);
  assert.equal((await runtime.dispatchFetch('https://example.org/learning/admin')).status,200);
  console.log('統一流程：執行器領取／續約／回報、狀態篩選、筆記版本、預算明細與管理頁在 D1 上通過。');
  console.log('Workers 本機執行驗證通過：migration、登入、預算暫停、Markdown 清理、原文預覽與刪除、來源限制、R2 Range 與私人媒體授權。');
}finally{await runtime.dispose();}

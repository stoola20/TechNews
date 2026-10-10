import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// 使用實際 Workers、D1、R2 的本機模擬，不連接任何付費 API。
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'learning',modules:true,script:readFileSync(process.argv[2] || '/private/tmp/technews-learning-build/index.js','utf8'),compatibilityDate:'2026-09-23',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'learning-runtime-db'},r2Buckets:['MEDIA'],bindings:{RUN_TOKEN:'runtime-only',LEARNING_ENABLED:'true',LEARNING_MONTHLY_USD:'30',PUBLIC_BASE_URL:'https://example.org'}}]}));
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
  await db.prepare('INSERT INTO learning_media(id,item_id,evidence_id,url,type,mime,bytes,object_key,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('asset',id,'source','https://example.org/photo','photo','image/png',3,'learning/runtime','ready',time).run();
  const bucket=await runtime.getR2Bucket('MEDIA');await bucket.put('learning/runtime',new Uint8Array([1,2,3]));
  const media=await runtime.dispatchFetch(origin+'api/media/asset',{headers:{cookie,range:'bytes=1-2'}});assert.equal(media.status,206);assert.equal(media.headers.get('content-range'),'bytes 1-2/3');assert.deepEqual([...new Uint8Array(await media.arrayBuffer())],[2,3]);
  const privateMedia=await runtime.dispatchFetch(origin+'api/media/asset');assert.equal(privateMedia.status,401);
  console.log('Workers 本機執行驗證通過：migration、登入、預算暫停、來源限制、R2 Range 與私人媒體授權。');
}finally{await runtime.dispose();}

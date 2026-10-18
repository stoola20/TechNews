import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {query,item,saveEvidence} from '../src/learning/store.js';
import {normalizePublished} from '../src/learning/dates.js';
import {backfillPublished} from '../src/learning/library.js';
import {environment,recorder,request} from './helpers.js';

test('發表時間：RFC 2822、時區縮寫、ISO 與只有日期都轉成 UTC；無法判斷時區或格式時為空值',()=>{
  assert.equal(normalizePublished('Fri, 16 Oct 2026 00:00:00 GMT'),'2026-10-16T00:00:00.000Z');
  assert.equal(normalizePublished('Fri, 16 Oct 2026 13:05:42 PDT'),'2026-10-16T20:05:42.000Z');
  assert.equal(normalizePublished('Thu, 15 Oct 2026 12:00:00 +0200'),'2026-10-15T10:00:00.000Z');
  assert.equal(normalizePublished('2026-10-16T20:48:24.000Z'),'2026-10-16T20:48:24.000Z');
  assert.equal(normalizePublished('2026-10-13T08:00:00+08:00'),'2026-10-13T00:00:00.000Z');
  assert.equal(normalizePublished('2026-10-13'),'2026-10-13T00:00:00.000Z');
  assert.equal(normalizePublished('2026-10-13 08:00:00'),'2026-10-13T08:00:00.000Z');
  for(const bad of ['October 5, 2026','garbage','',null,undefined,'2026-13-40','0001-01-01'])assert.equal(normalizePublished(bad),null,String(bad));
});

const T=(day,hour=0)=>new Date(Date.UTC(2026,2,day,hour)).toISOString();
async function add(env,id,{created,published=null}){
  await query(env,"INSERT INTO learning_items(id,url,kind,title,status,body,revision,published_at,created_at,updated_at) VALUES(?,?,'web',?,'ready','正文',1,?,?,?)",id,'https://example.org/'+id,'文章 '+id[0],published,created,created).run();
}
const order=async(handler,env,q='')=>(await (await handler.fetch(request('api/items'+q),env)).json()).map(i=>i.id[0]).join('');

test('列表預設依發表時間排序，沒有發表時間時以加入時間排入；可切換成加入時間',async()=>{
  const env=environment(),handler=createLearningHandler(recorder());
  // a：很早發表、最近才回補；b：前一天發表、隔天才整理；c：沒有發表時間；d：最新發表。
  await add(env,'a'.repeat(32),{created:T(20),published:T(1)});
  await add(env,'b'.repeat(32),{created:T(17,1),published:T(16,19)});
  await add(env,'c'.repeat(32),{created:T(17)});
  await add(env,'d'.repeat(32),{created:T(18),published:T(17,12)});
  assert.equal(await order(handler,env),'dcba');
  assert.equal(await order(handler,env,'?sort=published'),'dcba');
  assert.equal(await order(handler,env,'?sort=added'),'adbc');
  assert.equal((await handler.fetch(request('api/items?sort=bogus'),env)).status,400);
  const listed=(await (await handler.fetch(request('api/items'),env)).json()).find(i=>i.id[0]==='c');
  assert.equal(listed.published_at,null);assert.equal(listed.created_at,T(17));
});

test('保存主要來源時記下正規化的發表時間；附加來源與無法解析的時間不改動',async()=>{
  const env=environment(),id='e'.repeat(32);
  await add(env,id,{created:T(10)});
  await saveEvidence(env,id,{url:'https://example.org/quote',relation:'quoted',published_at:'2026-03-01'});
  assert.equal((await item(env,id)).published_at,null);
  await saveEvidence(env,id,{url:'https://example.org/'+id,relation:'primary',published_at:'Mon, 09 Mar 2026 10:00:00 PDT'});
  assert.equal((await item(env,id)).published_at,'2026-03-09T17:00:00.000Z');
  await saveEvidence(env,id,{url:'https://example.org/other',relation:'primary',published_at:'下週一'});
  assert.equal((await item(env,id)).published_at,'2026-03-09T17:00:00.000Z');
});

test('回補發表時間：依序用主要來源、收件紀錄、舊官方文章表；查不到的保持空值，可重複執行',async()=>{
  const env=environment();
  const [p,k,l,none]=['1','2','3','4'].map(c=>c.repeat(32));
  for(const id of [p,k,l,none])await add(env,id,{created:T(10)});
  await query(env,"INSERT INTO learning_evidence(id,item_id,url,relation,published_at,content,fetched_at) VALUES('ev',?,'https://example.org/p','primary','2026-03-02',?,?)",p,'原文',T(10)).run();
  await query(env,"INSERT INTO learning_intakes(receipt,item_id,origin,notify_revision,metadata_json,created_at) VALUES('rk',?,'official',1,?,?)",k,JSON.stringify({published_at:'Tue, 03 Mar 2026 12:00:00 GMT'}),T(10)).run();
  await query(env,"INSERT INTO articles(source_url,source,title,published_at,status,created_at,updated_at,library_item_id) VALUES('https://example.org/l','example','舊導讀','2026-03-04T05:00:00Z','notified',?,?,?)",T(10),T(10),l).run();
  assert.equal(await backfillPublished(env),3);
  assert.equal((await item(env,p)).published_at,'2026-03-02T00:00:00.000Z');
  assert.equal((await item(env,k)).published_at,'2026-03-03T12:00:00.000Z');
  assert.equal((await item(env,l)).published_at,'2026-03-04T05:00:00.000Z');
  assert.equal((await item(env,none)).published_at,null);
  assert.equal(await backfillPublished(env),0);
  // 維護排程會執行回補。
  await query(env,'UPDATE learning_items SET published_at=NULL WHERE id=?',p).run();
  await createLearningHandler(recorder()).scheduled(env,{tasks:['maintenance']});
  assert.equal((await item(env,p)).published_at,'2026-03-02T00:00:00.000Z');
});

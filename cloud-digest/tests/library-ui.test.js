import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {createLearningHandler} from '../src/learning/http.js';
import {setTextProvider} from '../src/learning/local.js';
import {query,rows,item} from '../src/learning/store.js';
import {LEARNING_PAGE} from '../src/learning/page.js';
import {ADMIN_PAGE} from '../src/learning/admin-page.js';
import {environment,recorder,request} from './helpers.js';

const now=new Date().toISOString();
async function seed(env){
  const add=async(id,status,origin,{read=null,edition='detailed',body='正文'}={})=>{
    await query(env,"INSERT INTO learning_items(id,url,kind,title,status,edition,body,article_json,read_at,revision,created_at,updated_at) VALUES(?,?,'web',?,?,?,?,?,?,1,?,?)",id,'https://example.org/'+id,'文章 '+status,status,edition,body,JSON.stringify({intro:'介紹',content_fingerprint:'c'}),read,now,now).run();
    await query(env,"INSERT INTO learning_intakes(receipt,item_id,origin,notify_revision,created_at) VALUES(?,?,?,1,?)",'r'+id,id,origin,now).run();
  };
  await add('1'.repeat(32),'ready','official',{read:now});
  await add('2'.repeat(32),'partial','bookmark');
  await add('3'.repeat(32),'waiting_local','web',{body:null});
  await add('4'.repeat(32),'budget_paused','share',{body:null});
  await add('5'.repeat(32),'needs_attention','web',{body:null});
  await add('6'.repeat(32),'filtered','official',{body:null});
  await add('7'.repeat(32),'ready','official',{edition:'legacy_digest'});
}
const ids=async(handler,env,q)=>(await (await handler.fetch(request('api/items'+q),env)).json()).map(i=>i.id[0]).sort().join('');

test('列表篩選：未讀、收件入口與狀態群組互不混淆，預設不顯示已略過',async()=>{
  const env=environment(),handler=createLearningHandler(recorder());await seed(env);
  assert.equal(await ids(handler,env,''),'123457');
  assert.equal(await ids(handler,env,'?unread=1'),'23457');
  assert.equal(await ids(handler,env,'?origin=official'),'17');
  assert.equal(await ids(handler,env,'?state=needs_action'),'25');
  assert.equal(await ids(handler,env,'?state=waiting_local'),'3');
  assert.equal(await ids(handler,env,'?state=paused'),'4');
  assert.equal(await ids(handler,env,'?state=legacy'),'7');
  assert.equal(await ids(handler,env,'?state=filtered'),'6');
  assert.equal(await ids(handler,env,'?state=ready&origin=official&unread=1'),'7');
  assert.equal((await handler.fetch(request('api/items?state=bogus'),env)).status,400);
  const states=await (await handler.fetch(request('api/items/states?ids='+'3'.repeat(32)+','+'1'.repeat(32)),env)).json();
  assert.deepEqual(states.map(s=>s.status).sort(),['ready','waiting_local']);
  assert.equal((await handler.fetch(request('api/items/states?ids=bad'),env)).status,400);
});

test('只重寫文字不重抓來源；重送通知只用保存內容；頁面與管理頁腳本可解析',async()=>{
  const env={...environment(),LEARNING_RUNNER_TOKEN:'r'},net=recorder(),handler=createLearningHandler(net);
  await seed(env);await setTextProvider(env,'local');
  const id='1'.repeat(32);
  await query(env,"INSERT INTO learning_evidence(id,item_id,url,relation,content,fetched_at) VALUES('e1',?,?,'primary','原文',?)",id,'https://example.org/'+id,now).run();
  assert.equal((await handler.fetch(request('api/items/'+id+'/rewrite','POST',{}),env)).status,202);
  await handler.service.process(env,id);
  assert.equal((await item(env,id)).status,'waiting_local');
  assert.equal(net.calls.filter(c=>c.url.includes('example.org')).length,0);
  assert.equal((await rows(env,'SELECT id FROM learning_jobs WHERE item_id=?',id)).length,1);
  assert.equal((await handler.fetch(request('api/items/'+'2'.repeat(32)+'/renotify','POST',{}),env)).status,200);
  const sent=net.calls.filter(c=>c.url.includes('api.telegram.org'));
  assert.equal(sent.length,1);assert.match(JSON.parse(sent[0].options.body).text,/介紹/);
  assert.equal((await handler.fetch(request('api/items/'+'7'.repeat(32)+'/renotify','POST',{}),env)).status,409);
  for(const page of [LEARNING_PAGE,ADMIN_PAGE]){
    const script=page.match(/<script>([\s\S]*)<\/script>/)[1];new Script(script);
    // App 內建瀏覽器會擋原生 confirm()，所有確認都要走頁內對話框。
    assert.doesNotMatch(script,/(^|[^.\w])confirm\(/);assert.match(script,/askConfirm\(/);
  }
  const admin=await handler.fetch(new Request('https://learning.example.org/learning/admin'),env);
  assert.equal(admin.status,200);assert.match(admin.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

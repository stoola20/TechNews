import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {setTextProvider,claim} from '../src/learning/local.js';
import {query,item} from '../src/learning/store.js';
import {environment,recorder,request,message} from './helpers.js';

const now=new Date().toISOString(),ID='a'.repeat(32);
async function seed(env){
  await query(env,"INSERT INTO learning_items(id,url,kind,title,status,body,revision,created_at,updated_at) VALUES(?,?,'web','t','ready','正文',1,?,?)",ID,'https://example.org/n',now,now).run();
  await query(env,"INSERT INTO learning_intakes(receipt,item_id,origin,notify_revision,created_at) VALUES('r',?,'web',1,?)",ID,now).run();
}
const patch=(handler,env,data)=>handler.fetch(request('api/items/'+ID,'PATCH',data),env);

test('筆記以版本保存：舊版本覆寫被拒並回傳最新內容，帶正確版本才可覆寫',async()=>{
  const env=environment(),handler=createLearningHandler(recorder());await seed(env);
  const first=await (await patch(handler,env,{note:'第一版',base_note_updated_at:null})).json();
  assert.ok(first.note_updated_at);
  // 另一個分頁仍以舊版本（null）為基礎保存：不能靜默覆寫。
  const stale=await patch(handler,env,{note:'另一分頁',base_note_updated_at:null});
  assert.equal(stale.status,409);const body=await stale.json();
  assert.equal(body.code,'note_conflict');assert.equal(body.note,'第一版');assert.equal(body.note_updated_at,first.note_updated_at);
  assert.equal((await item(env,ID)).note,'第一版');
  const forced=await patch(handler,env,{note:'選擇保留我的',base_note_updated_at:body.note_updated_at});
  assert.equal(forced.status,200);assert.equal((await item(env,ID)).note,'選擇保留我的');
  // 舊客戶端不帶版本仍可保存；超長筆記被拒。
  assert.equal((await patch(handler,env,{note:'舊客戶端'})).status,200);
  assert.equal((await patch(handler,env,{note:'x'.repeat(20001)})).status,400);
  const states=await (await handler.fetch(request('api/items/states?ids='+ID),env)).json();
  assert.equal(states[0].note_updated_at,(await item(env,ID)).note_updated_at);
});

test('已讀、筆記與文章更新互不重設',async()=>{
  const env={...environment(),LEARNING_RUNNER_TOKEN:'r'},handler=createLearningHandler(recorder());await seed(env);
  await query(env,"INSERT INTO learning_evidence(id,item_id,url,relation,content,fetched_at) VALUES('e1',?,'https://example.org/n','primary','原文',?)",ID,now).run();
  await patch(handler,env,{note:'保留',base_note_updated_at:null});
  await patch(handler,env,{read:true});
  const noted=await item(env,ID);
  assert.equal(noted.note,'保留');assert.ok(noted.read_at);
  await patch(handler,env,{read:false});
  assert.equal((await item(env,ID)).note,'保留');assert.equal((await item(env,ID)).note_updated_at,noted.note_updated_at);
  await patch(handler,env,{read:true});
  await setTextProvider(env,'local');
  await handler.fetch(request('api/items/'+ID+'/rewrite','POST',{}),env);
  await handler.queue({messages:[message({kind:'article',id:ID})]},env);
  const job=await claim(env,'mac');
  await handler.fetch(new Request('https://learning.example.org/learning/runner/complete',{method:'POST',headers:{authorization:'Bearer r','content-type':'application/json'},body:JSON.stringify({runner_id:'mac',job_id:job.id,attempt_token:job.attempt_token,input_version:job.input_version,model:{name:'g',done_reason:'stop'},output:{title:'新版',intro:'i',body:'新正文 [S1]',citations:['S1']}})}),env);
  const updated=await item(env,ID);
  assert.equal(updated.revision,2);assert.equal(updated.note,'保留');assert.ok(updated.read_at);assert.equal(updated.note_updated_at,noted.note_updated_at);
});

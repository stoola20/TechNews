import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {xRead} from '../src/learning/x.js';
import {setTextProvider,claim} from '../src/learning/local.js';
import {migrateLibrary} from '../src/learning/library.js';
import {budget,reserve,setting,saveConnection,query,rows,item,saveEvidence} from '../src/learning/store.js';
import {environment,recorder,request,message} from './helpers.js';

const posts=Array.from({length:100},(_,i)=>({id:String(1000+i),text:'post '+i,author_id:'9'}));
function xNetwork(){
  return recorder(async url=>{
    if(url.hostname==='api.x.com'&&/\/bookmarks$/.test(url.pathname))return Response.json({data:posts,meta:{}});
    if(url.hostname==='api.x.com'&&/^\/2\/tweets\/\d+$/.test(url.pathname))return Response.json({data:{id:url.pathname.split('/').at(-1),text:'x'}});
    return null;
  });
}
async function connect(env){await saveConnection(env,'x',{user_id:'7',access_token:'x-access',refresh_token:'x-refresh',expires_at:Date.now()+86400000*90});}
const costs=async env=>(await rows(env,'SELECT month,category,amount_micro,status,usage_json FROM learning_costs ORDER BY created_at')).map(r=>({...r,usage:JSON.parse(r.usage_json)}));

test('X 重讀依 UTC 日辨識：同日重讀只計有上限的未確認風險，跨 UTC 日重新計首次讀取，月份依台灣時間',async t=>{
  mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-31T23:30:00Z')});
  t.after(()=>mock.timers.reset());
  const env=environment(),net=xNetwork();await connect(env);
  await xRead(env,'/users/7/bookmarks',{},100,true,net.fetcher);
  let list=await costs(env);
  assert.equal(list[0].month,'2026-11');assert.equal(list[0].status,'settled');
  assert.equal(list[0].amount_micro,100*1000);assert.equal(list[0].usage.owned,true);assert.equal(list[0].usage.pricing_checked_at,'2026-10-16');
  // 十分鐘後重讀同一頁：不是 100 筆新費用，只記 5% 的未確認風險。
  mock.timers.setTime(Date.parse('2026-10-31T23:40:00Z'));
  await xRead(env,'/users/7/bookmarks',{},100,true,net.fetcher);
  list=await costs(env);
  assert.deepEqual(list.slice(1).map(c=>[c.category,c.status,c.amount_micro]),[['x','settled',0],['x-reread-risk','uncertain',5000]]);
  assert.equal(list[1].usage.rereads,100);
  // 每日重讀風險有上限。
  for(let i=0;i<30;i++)await xRead(env,'/users/7/bookmarks',{},100,true,net.fetcher);
  const risk=(await costs(env)).filter(c=>c.category==='x-reread-risk').reduce((n,c)=>n+c.amount_micro,0);
  assert.equal(risk,100000);
  // UTC 午夜後同一批資源重新計費，但仍屬台灣 11 月。
  mock.timers.setTime(Date.parse('2026-11-01T00:30:00Z'));
  const before=(await costs(env)).length;
  await xRead(env,'/users/7/bookmarks',{},100,true,net.fetcher);
  const fresh=(await costs(env)).slice(before);
  assert.deepEqual(fresh.map(c=>[c.month,c.amount_micro]),[['2026-11',100000]]);
});

test('Owned Read 只在自身資源端點且確認為 app 擁有者時使用',async()=>{
  const env=environment({X_APP_OWNER_ID:'8'}),net=xNetwork();await connect(env);
  await xRead(env,'/users/7/bookmarks',{},100,true,net.fetcher);
  assert.equal((await costs(env))[0].amount_micro,100*5000);
  const owner=environment(),ownerNet=xNetwork();await connect(owner);
  await xRead(owner,'/tweets/1234',{},1,true,ownerNet.fetcher);
  assert.equal((await costs(owner))[0].amount_micro,5000);
  assert.equal((await costs(owner))[0].usage.owned,false);
});

test('費用暫停：停止新付費呼叫並保留工作；已有證據的 Mac 工作、追問與通知照常；跨月不自動恢復',async t=>{
  mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-20T03:00:00Z')});
  t.after(()=>mock.timers.reset());
  const env={...environment({LEARNING_MONTHLY_USD:'1'}),LEARNING_RUNNER_TOKEN:'runner-test-token'},net=recorder(),handler=createLearningHandler(net);
  await setTextProvider(env,'local');await connect(env);
  await reserve(env,'gemini',990000);
  await assert.rejects(reserve(env,'x',20000),{name:'BudgetPaused'});
  assert.equal((await setting(env,'control')).reason,'budget');
  // 已保存原文的文章：不需付費，照樣排給 Mac。
  const ready='e'.repeat(32);
  await query(env,"INSERT INTO learning_items(id,url,kind,status,created_at,updated_at) VALUES(?,?,'web','queued',?,?)",ready,'https://example.org/saved',new Date().toISOString(),new Date().toISOString()).run();
  await saveEvidence(env,ready,{url:'https://example.org/saved',relation:'primary',content:'已保存的原文與 RATE_LIMIT 說明。'});
  await query(env,"INSERT INTO learning_intakes(receipt,item_id,origin,created_at) VALUES('r1',?,'web',?)",ready,new Date().toISOString()).run();
  await handler.queue({messages:[message({kind:'article',id:ready})]},env);
  assert.equal((await item(env,ready)).status,'waiting_local');
  assert.ok(await claim(env,'mac'));
  // 需要付費取得來源的 X 貼文：保留為費用暫停，不算失敗次數。
  const {id:xItem}=await (await handler.fetch(request('api/collect','POST',{url:'https://x.com/a/status/42'}),env)).json();
  await handler.queue({messages:[message({kind:'article',id:xItem})]},env);
  assert.equal((await item(env,xItem)).status,'budget_paused');assert.equal((await item(env,xItem)).attempts,0);
  assert.equal(net.calls.filter(c=>c.url.includes('api.x.com')).length,0);
  // 下個月仍維持暫停，手動恢復也要檢查可用預算。
  mock.timers.setTime(Date.parse('2026-11-02T03:00:00Z'));
  await handler.scheduled(env,false);
  assert.equal((await setting(env,'control')).paused,true);
  assert.equal((await item(env,xItem)).status,'budget_paused');
  const resumed=await handler.fetch(request('api/control','POST',{action:'resume'}),env);
  assert.equal(resumed.status,200);assert.equal((await setting(env,'control')).paused,false);
  assert.equal((await item(env,xItem)).status,'queued');
  mock.timers.setTime(Date.parse('2026-10-20T03:00:00Z'));
  await query(env,"INSERT INTO settings(key,value_json,updated_at) VALUES('learning:control','{\"paused\":true,\"reason\":\"budget\"}','x') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run();
  await query(env,"INSERT INTO learning_costs(id,month,category,amount_micro,status,created_at) VALUES('full','2026-10','x',10000,'settled','x')").run();
  assert.equal((await handler.fetch(request('api/control','POST',{action:'resume'}),env)).status,429);
});

test('手動暫停停下全部處理，與費用暫停分開標示；預算明細分開估算、預留、未確認與核對調整',async()=>{
  const env={...environment(),LEARNING_RUNNER_TOKEN:'runner-test-token'},handler=createLearningHandler(recorder());
  await setTextProvider(env,'local');
  await handler.fetch(request('api/control','POST',{action:'pause'}),env);
  await assert.rejects(reserve(env,'x',1),{name:'BudgetPaused'});
  assert.equal((await setting(env,'control')).reason,'manual');
  const {id}=await (await handler.fetch(request('api/collect','POST',{url:'https://example.org/p'}),env)).json();
  await handler.queue({messages:[message({kind:'article',id})]},env);
  assert.equal((await item(env,id)).status,'paused');
  assert.equal(await claim(env,'mac'),null);
  const paused=await (await handler.fetch(request('api/budget'),env)).json();
  assert.equal(paused.pause_reason,'manual');
  await handler.fetch(request('api/control','POST',{action:'resume'}),env);
  assert.equal((await item(env,id)).status,'queued');
  const r=await reserve(env,'gemini',2000);
  const adjusted=await (await handler.fetch(request('api/admin/budget-adjust','POST',{category:'x',amount_usd:-0.5,note:'與 X Developer Console 十月用量核對'}),env)).json();
  assert.equal(adjusted.totals.reserved_micro,2000);assert.equal(adjusted.totals.adjustment_micro,-500000);
  assert.equal(adjusted.x_pricing.post_micro,5000);assert.equal(adjusted.x_pricing.reread_daily_cap_micro,100000);
  assert.equal((await handler.fetch(request('api/admin/budget-adjust','POST',{category:'x',amount_usd:1,note:''}),env)).status,400);
  assert.ok(r);
});

test('舊資料搬移不重複計費',async()=>{
  const env=environment();
  const time=new Date().toISOString();
  await query(env,"INSERT INTO articles(source_url,source,title,status,summary_json,content,model_provider,model_name,created_at,updated_at) VALUES('https://developers.openai.com/blog/x','openai_developer_blog','t','notified',?,'c','workers_ai','m',?,?)",JSON.stringify({title_zh:'t',body_zh:'b'}),time,time).run();
  const before=(await budget(env)).metered_micro;
  await migrateLibrary(env);await migrateLibrary(env);
  assert.equal((await budget(env)).metered_micro,before);
  assert.equal((await rows(env,'SELECT id FROM learning_costs')).length,0);
});

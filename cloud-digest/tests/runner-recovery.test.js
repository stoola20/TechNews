import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {setTextProvider,ensureJob,claim} from '../src/learning/local.js';
import {item,rows,query} from '../src/learning/store.js';
import {runOnce,loadConfig} from '../runner/lib.js';
import {environment,recorder,request,message,iso} from './helpers.js';

const html=`<html><h1>文章</h1><article>${'<p>背景原文與機制說明。</p>'.repeat(40)}</article></html>`;
const output='<<<TITLE>>>\n標題\n<<<INTRO>>>\n介紹\n<<<CITATIONS>>>\nS1\n<<<BODY>>>\n正文 [S1]\n<<<END>>>';
function setup(){
  const env={...environment(),LEARNING_RUNNER_TOKEN:'runner-test-token'};
  const net=recorder(async url=>url.hostname==='example.org'?new Response(html,{headers:{'content-type':'text/html'}}):null);
  const handler=createLearningHandler(net);
  const calls=[];
  const serverFetch=async(url,options)=>{calls.push({action:new URL(url).pathname.split('/').at(-1),body:JSON.parse(options.body)});return handler.fetch(new Request(url,options),env);};
  return {env,net,handler,calls,serverFetch};
}
const config=(runner='mac-a',over={})=>({...loadConfig({TECHNEWS_URL:'https://learning.example.org',TECHNEWS_RUNNER_TOKEN:'runner-test-token',RUNNER_ID:runner}),...over});
function stream(text){return new Response(JSON.stringify({message:{content:text},done:false})+'\n'+JSON.stringify({message:{content:''},done:true,done_reason:'stop',prompt_eval_count:100,eval_count:50})+'\n');}
// 可控制何時完成的 Ollama：用來模擬長時間推論與中途失去領取。
function slowOllama(){
  let release;const gate=new Promise(r=>{release=r;});const started=[];
  async function fetcher(value,options={}){
    const url=new URL(value);
    if(url.pathname==='/api/tags')return Response.json({models:[{name:'gemma4:26b',digest:'abc'}]});
    started.push(Date.now());
    await Promise.race([gate,new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))))]);
    return stream(output);
  }
  return {fetcher,release,started};
}
const quickOllama={fetcher:async value=>new URL(value).pathname==='/api/tags'?Response.json({models:[{name:'gemma4:26b',digest:'abc'}]}):stream(output)};
async function share(s,url='https://example.org/a'){
  const {id}=await (await s.handler.fetch(request('api/collect','POST',{url}),s.env)).json();
  await s.handler.queue({messages:[message({kind:'article',id})]},s.env);return id;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('長時間推論持續續約；完成後網站顯示 Mac 在線與最後心跳',async()=>{
  const s=setup();await setTextProvider(s.env,'local');const id=await share(s);
  const model=slowOllama();
  const running=runOnce(config('mac-a',{heartbeatMs:20}),{serverFetch:s.serverFetch,ollamaFetch:model.fetcher});
  await wait(120);
  assert.equal((await item(s.env,id)).status,'generating');
  model.release();
  assert.equal((await running).state,'completed');
  assert.ok(s.calls.filter(c=>c.action==='heartbeat'&&c.body.job_id).length>=2);
  const status=await (await s.handler.fetch(request('api/status'),s.env)).json();
  assert.equal(status.local.online,true);assert.ok(status.local.last_seen_at);assert.equal(status.local.info.state,'working');
  assert.equal((await item(s.env,id)).status,'ready');
});

test('lease 到期後由另一台領取：舊推論中止，舊 attempt 回報被拒，不計入模型失敗',async()=>{
  const s=setup();await setTextProvider(s.env,'local');const id=await share(s);
  const model=slowOllama();
  const first=runOnce(config('mac-a',{heartbeatMs:20}),{serverFetch:s.serverFetch,ollamaFetch:model.fetcher});
  await wait(50);
  const firstToken=(await query(s.env,'SELECT attempt_token FROM learning_jobs').first()).attempt_token;
  await query(s.env,'UPDATE learning_jobs SET lease_until=?',iso(-1000)).run();
  const second=await claim(s.env,'mac-b');
  assert.ok(second.attempt_token);assert.notEqual(second.attempt_token,firstToken);
  assert.equal((await first).state,'lease_lost');
  const job=await query(s.env,'SELECT attempts,lease_expirations,status FROM learning_jobs').first();
  assert.deepEqual({...job},{attempts:0,lease_expirations:1,status:'leased'});
  const late=await s.handler.fetch(new Request('https://learning.example.org/learning/runner/complete',{method:'POST',headers:{authorization:'Bearer runner-test-token','content-type':'application/json'},body:JSON.stringify({runner_id:'mac-a',job_id:second.id,attempt_token:firstToken,input_version:second.input_version,model:{done_reason:'stop'},output:{title:'舊',intro:'舊',body:'舊 [S1]',citations:['S1']}})}),s.env);
  assert.equal(late.status,409);assert.equal((await item(s.env,id)).body,null);
});

test('同一台執行器重新啟動後立即重新領取同一份工作，並讓舊 token 失效',async()=>{
  const s=setup();await setTextProvider(s.env,'local');await share(s);
  const before=await claim(s.env,'mac-a');
  assert.equal(await claim(s.env,'mac-b'),null);
  const after=await claim(s.env,'mac-a');
  assert.equal(after.id,before.id);assert.notEqual(after.attempt_token,before.attempt_token);
  const job=await query(s.env,'SELECT attempts,lease_expirations FROM learning_jobs').first();
  assert.deepEqual({...job},{attempts:0,lease_expirations:0});
});

test('Ollama 停止時交回工作不計失敗；只重跑未完成的文字階段，不重抓來源',async()=>{
  const s=setup();await setTextProvider(s.env,'local');const id=await share(s);
  const down={fetcher:async value=>{if(new URL(value).pathname==='/api/tags')return Response.json({models:[{name:'gemma4:26b'}]});throw new TypeError('fetch failed');}};
  assert.equal((await runOnce(config(),{serverFetch:s.serverFetch,ollamaFetch:down.fetcher})).state,'released');
  let saved=await item(s.env,id);
  assert.equal(saved.status,'waiting_local');assert.equal((await query(s.env,'SELECT attempts FROM learning_jobs').first()).attempts,0);
  const offline={fetcher:async()=>{throw new TypeError('connection refused');}};
  assert.equal((await runOnce(config(),{serverFetch:s.serverFetch,ollamaFetch:offline.fetcher})).state,'ollama_unavailable');
  assert.equal((await query(s.env,"SELECT status FROM learning_jobs").first()).status,'waiting_local');
  // 三次無效輸出後需要人工處理；按重試只重做文字生成。
  const bad={fetcher:async value=>new URL(value).pathname==='/api/tags'?Response.json({models:[]}):stream('<<<TITLE>>>\n沒有結束')};
  for(let i=0;i<3;i++)await runOnce(config(),{serverFetch:s.serverFetch,ollamaFetch:bad.fetcher});
  saved=await item(s.env,id);assert.equal(saved.status,'needs_attention');
  assert.equal((await s.handler.fetch(request('api/items/'+id+'/retry','POST',{}),s.env)).status,202);
  await s.handler.queue({messages:[message({kind:'article',id})]},s.env);
  assert.equal((await item(s.env,id)).status,'waiting_local');
  assert.equal((await runOnce(config(),{serverFetch:s.serverFetch,ollamaFetch:quickOllama.fetcher})).state,'completed');
  assert.equal(s.net.calls.filter(c=>c.url.startsWith('https://example.org/')).length,1);
  assert.equal(s.net.calls.filter(c=>c.url.includes('generativelanguage')).length,0);
});

test('排隊優先序：追問與分享優先，等待夠久的背景回補不會永久排不到',async()=>{
  const env={...environment(),LOCAL_AGING_MINUTES:'30'};
  const make=async(name,priority,ageMinutes)=>{
    const id=await ensureJob(env,{kind:'article',itemId:name,priority,input:{sources:[]},fingerprint:name});
    await query(env,'UPDATE learning_jobs SET created_at=? WHERE id=?',iso(-ageMinutes*60000),id).run();return id;
  };
  const backfillOld=await make('backfill-old',3,121),share=await make('share-new',1,1),backfillNew=await make('backfill-new',3,1),question=await make('question',0,0);
  const order=[];
  for(let i=0;i<4;i++){const job=await claim(env,'mac-a');order.push(job.id);await query(env,"UPDATE learning_jobs SET status='done' WHERE id=?",job.id).run();}
  assert.deepEqual(order,[backfillOld,question,share,backfillNew]);
  const status=await (await createLearningHandler(recorder()).fetch(request('api/status'),env)).json();
  assert.deepEqual(status.local.queue,[]);
});

test('處理階段寫入文章狀態，網站可看出卡在哪一步',async()=>{
  const s=setup();
  let seen;
  const handler=createLearningHandler({...s.net,webEvidence:async url=>{seen=(await item(s.env,id)).stage;return {url,relation:'primary',content:'原文',metadata:{title:'t'},media:[]};}});
  await setTextProvider(s.env,'local');
  const {id}=await (await handler.fetch(request('api/collect','POST',{url:'https://example.org/b'}),s.env)).json();
  await handler.queue({messages:[message({kind:'article',id})]},s.env);
  assert.equal(seen,'source');
  const list=await (await handler.fetch(request('api/items'),s.env)).json();
  assert.equal(list[0].stage,'text');assert.equal(list[0].status,'waiting_local');
});

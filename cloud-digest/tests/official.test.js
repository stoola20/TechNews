import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {tasksFor} from '../src/schedule.js';
import {createLearningHandler} from '../src/learning/http.js';
import {setTextProvider,claim} from '../src/learning/local.js';
import {item,rows,query} from '../src/learning/store.js';
import {SOURCES} from '../src/sources.js';
import {environment,recorder,request,message} from './helpers.js';

const TAIL='限制：此功能僅在 v2.4 以上可用，且每分鐘最多 60 次請求。';
const longContent='背景、機制、例子與操作步驟。'.repeat(500)+TAIL;
const entries=Array.from({length:8},(_,i)=>({url:`https://developers.openai.com/blog/post-${i}`,title:'Post '+i,publishedAt:new Date().toUTCString(),content:null}));
function setup(){
  const env={...environment(),LEARNING_RUNNER_TOKEN:'runner-test-token'},net=recorder(),loads=[];
  const handler=createLearningHandler({...net,discoverSource:async source=>source.id==='openai_developer_blog'?entries:[],
    loadArticle:async(source,entry)=>{loads.push(entry.url);return {...entry,title:'Official '+entry.url.split('-').at(-1),content:longContent,contentMethod:'article_html'};}});
  return {env,net,handler,loads};
}
async function settings(env){await query(env,"INSERT INTO settings(key,value_json,updated_at) VALUES('digest',?,?)",JSON.stringify({model_profile:'gemma4',interests:'AI agents 與開發者工具',sources:[SOURCES[0]]}),new Date().toISOString()).run();}
async function complete(s,job,output){
  const r=await s.handler.fetch(new Request('https://learning.example.org/learning/runner/complete',{method:'POST',headers:{authorization:'Bearer runner-test-token','content-type':'application/json'},
    body:JSON.stringify({runner_id:'mac',job_id:job.id,attempt_token:job.attempt_token,input_version:job.input_version,model:{name:'gemma4:26b',done_reason:'stop'},output})}),s.env);
  return r.json();
}
async function drain(s){for(const row of await rows(s.env,"SELECT id FROM learning_items WHERE status='queued'"))await s.handler.queue({messages:[message({kind:'article',id:row.id})]},s.env);}

test('排程任務明確分流：08:00 開始官方整理，五分鐘維護與舊 Cron 字串都不觸發官方流程',async()=>{
  assert.deepEqual(tasksFor('0 0 * * *'),['official','bookmark_daily','author_recheck']);
  assert.deepEqual(tasksFor('*/5 * * * *'),['maintenance']);
  assert.deepEqual(tasksFor('0 1 * * *'),[]);
  const env={...environment(),TELEGRAM_BOT_TOKEN:undefined,LEARNING_ENABLED:'false'};
  await worker.scheduled({cron:'0 1 * * *'},env);
  await worker.scheduled({cron:'*/5 * * * *'},env);
  // 切換前：08:00 仍走舊官方導讀（此處沒有 Telegram 設定，因此可觀察到它被啟動）。
  await assert.rejects(worker.scheduled({cron:'0 0 * * *'},env),/Telegram secrets missing/);
});

test('官方文章全部排入共同文章庫，由 Mac 詳細整理；積壓不受單次上限，重複日次事件不重複生成',async()=>{
  const s=setup();await settings(s.env);await setTextProvider(s.env,'local');
  const first=await s.handler.service.official(s.env);
  assert.equal(first.queued,8);
  await drain(s);
  const jobs=await rows(s.env,"SELECT input_json FROM learning_jobs WHERE status='waiting_local'");
  assert.equal(jobs.length,8);
  const input=JSON.parse(jobs[0].input_json);
  assert.equal(input.official.source_name,'OpenAI Developer Blog');assert.equal(input.official.interests,'AI agents 與開發者工具');
  assert.ok(input.sources[0].content.endsWith(TAIL));assert.equal(input.sources[0].relation,'primary');
  // 同一天再觸發一次：沒有新收件、沒有新工作、不重抓原文。
  assert.equal((await s.handler.service.official(s.env)).queued,0);await drain(s);
  assert.equal((await rows(s.env,'SELECT id FROM learning_jobs')).length,8);assert.equal(s.loads.length,8);
  assert.equal((await rows(s.env,"SELECT receipt FROM learning_intakes WHERE origin='official'")).length,8);

  const relevant=await claim(s.env,'mac');
  const body='## 背景\n'+'這篇說明新 API 的機制與操作步驟。[S1]\n\n'.repeat(220)+'## 限制\n'+TAIL+' [S1]';
  assert.equal((await complete(s,relevant,{publish:true,reason:'AI 開發工具更新',title:'官方詳細教材',intro:'新 API 的用途與限制。',body,citations:['S1']})).revision,1);
  const ready=await item(s.env,(await query(s.env,'SELECT item_id FROM learning_jobs WHERE id=?',relevant.id).first()).item_id);
  assert.equal(ready.status,'ready');assert.equal(ready.edition,'detailed');assert.ok(ready.body.length>4096);assert.ok(ready.body.includes(TAIL));
  const sent=s.net.calls.filter(c=>c.url.includes('api.telegram.org')).map(c=>JSON.parse(c.options.body).text);
  assert.equal(sent.length,1);assert.match(sent[0],/新 API 的用途與限制/);assert.match(sent[0],new RegExp('/learning\\?article='+ready.id));assert.ok(!sent[0].includes(TAIL));

  const irrelevant=await claim(s.env,'mac');
  assert.equal((await complete(s,irrelevant,{publish:false,reason:'只有人事消息',title:'人事公告',intro:'略過',body:'略過',citations:[]})).filtered,true);
  const filteredId=(await query(s.env,'SELECT item_id FROM learning_jobs WHERE id=?',irrelevant.id).first()).item_id;
  assert.equal((await item(s.env,filteredId)).status,'filtered');
  const list=await (await s.handler.fetch(request('api/items'),s.env)).json();
  assert.ok(!list.some(i=>i.id===filteredId));
  assert.equal((await (await s.handler.fetch(request('api/items?status=filtered'),s.env)).json())[0].id,filteredId);
  await s.handler.scheduled(s.env,false);
  assert.equal(s.net.calls.filter(c=>c.url.includes('api.telegram.org')).length,1);

  // 主動分享被官方篩掉的同一篇：重用同一篇，但不再套用主題篩選。
  const shared=await (await s.handler.fetch(request('api/collect','POST',{url:(await item(s.env,filteredId)).url+'/'}),s.env)).json();
  assert.equal(shared.id,filteredId);
  await drain(s);
  const reshare=await rows(s.env,"SELECT input_json FROM learning_jobs WHERE item_id=? AND status='waiting_local'",filteredId);
  assert.equal(reshare.length,1);assert.equal(JSON.parse(reshare[0].input_json).official,undefined);
  // 已完成的官方文章被分享：直接回到既有文章，不建立新工作。
  const again=await (await s.handler.fetch(request('api/collect','POST',{url:ready.url}),s.env)).json();
  assert.equal(again.id,ready.id);await drain(s);
  assert.equal((await rows(s.env,'SELECT id FROM learning_jobs WHERE item_id=?',ready.id)).length,1);
});

test('切換前不把官方文章送進文章庫；08:00 排程在本機模式只做發現，不呼叫 Workers AI 或 Gemini',async()=>{
  const s=setup();await settings(s.env);
  await s.handler.scheduled(s.env,{tasks:['maintenance']});
  assert.equal((await rows(s.env,'SELECT id FROM learning_items')).length,0);
  await setTextProvider(s.env,'local');
  await s.handler.scheduled(s.env,{tasks:['official']});
  await drain(s);
  assert.equal((await rows(s.env,"SELECT id FROM learning_items WHERE status='waiting_local'")).length,8);
  assert.equal(s.net.calls.filter(c=>c.url.includes('generativelanguage')).length,0);
});

test('Gemini 模式：官方文章也進文章庫詳細整理，不符合讀者關注的略過且不通知',async()=>{
  const env=environment(),net=recorder(),seen=[];
  const handler=createLearningHandler({...net,discoverSource:async source=>source.id==='openai_developer_blog'?entries.slice(0,2):[],
    loadArticle:async(source,entry)=>({...entry,title:'Official '+entry.url.split('-').at(-1),content:longContent,contentMethod:'article_html'}),
    generate:async(env,sources,media,gaps,question,fetcher,{official}={})=>{seen.push(official);
      return sources[0].url.endsWith('post-0')?{title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]}:{publish:false,reason:'人物專訪，沒有技術變更',title:'略過的文章'};}});
  await settings(env);
  assert.equal((await handler.service.official(env)).queued,2);
  for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);
  assert.equal(seen.length,2);assert.equal(seen[0].interests,'AI agents 與開發者工具');
  const items=await rows(env,"SELECT url,status,edition,article_json FROM learning_items ORDER BY url");
  assert.deepEqual(items.map(i=>[i.url.split('/').at(-1),i.status]),[['post-0','ready'],['post-1','filtered']]);
  assert.equal(JSON.parse(items[1].article_json).reason,'人物專訪，沒有技術變更');
  await handler.service.flush(env);
  assert.equal(net.calls.filter(c=>c.url.includes('api.telegram.org')).length,1);
});

const DAY=86400000;
const daysAgo=n=>new Date(Date.now()-n*DAY).toUTCString();

test('已初始化的來源突然冒出舊文章：發表超過期限的只記為看過，不收件也不通知',async()=>{
  const env=environment(),net=recorder();
  const feed=[
    {url:'https://developers.openai.com/blog/fresh',title:'Fresh',publishedAt:daysAgo(1),content:null},
    {url:'https://developers.openai.com/blog/last-november',title:'Old',publishedAt:daysAgo(340),content:null},
    {url:'https://developers.openai.com/blog/eight-days',title:'Edge',publishedAt:daysAgo(8),content:null},
    {url:'https://developers.openai.com/blog/undated',title:'Undated',publishedAt:null,content:null},
  ];
  const handler=createLearningHandler({...net,discoverSource:async source=>source.id==='openai_developer_blog'?feed:[]});
  await settings(env);
  // 模擬今天的狀況：來源早已初始化，但 seen 清單沒有這些舊網址（舊流程只記已處理過的）。
  await query(env,"INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,'[]')",daysAgo(30),daysAgo(1)).run();
  const result=await handler.service.official(env);
  assert.equal(result.queued,2);assert.equal(result.stale,2);
  assert.deepEqual((await rows(env,'SELECT url FROM learning_items ORDER BY url')).map(r=>r.url.split('/').at(-1)),['fresh','undated']);
  const seen=JSON.parse((await query(env,"SELECT seen_urls_json FROM source_state WHERE source='openai_developer_blog'").first()).seen_urls_json);
  assert.equal(seen.length,4);
  // 下一次發現：全部都看過，不再收件。
  assert.equal((await handler.service.official(env)).queued,0);
});

test('列表沒有日期的官方文章：抓到原文才發現太舊就篩掉，不呼叫模型、不通知；收件後的處理延誤不算過期',async()=>{
  const env=environment(),net=recorder(),generated=[];
  const published={old:daysAgo(60),fresh:daysAgo(2),delayed:daysAgo(12)};
  const handler=createLearningHandler({...net,
    discoverSource:async source=>source.id==='openai_developer_blog'?Object.keys(published).map(k=>({url:'https://developers.openai.com/blog/'+k,title:k,publishedAt:null,content:null})):[],
    loadArticle:async(source,entry)=>({...entry,title:'Official '+entry.url.split('/').at(-1),publishedAt:published[entry.url.split('/').at(-1)],content:longContent,contentMethod:'article_html'}),
    generate:async(env,sources)=>{generated.push(sources[0].url);return {title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]};}});
  await settings(env);
  await query(env,"INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,'[]')",daysAgo(30),daysAgo(1)).run();
  assert.equal((await handler.service.official(env)).queued,3);
  // delayed：收件於 10 天前（例如 Mac 離線），當時文章才發表 2 天，仍算新知。
  await query(env,"UPDATE learning_intakes SET created_at=? WHERE receipt='official:https://developers.openai.com/blog/delayed'",new Date(Date.now()-10*DAY).toISOString()).run();
  for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);
  const items=Object.fromEntries((await rows(env,'SELECT url,status,title,article_json FROM learning_items')).map(r=>[r.url.split('/').at(-1),r]));
  assert.equal(items.old.status,'filtered');assert.match(JSON.parse(items.old.article_json).reason,/^發表於 \d{4}-\d{2}-\d{2}，收件時已超過 7 天/);
  assert.equal(items.fresh.status,'ready');assert.equal(items.delayed.status,'ready');
  assert.deepEqual(generated.map(u=>u.split('/').at(-1)).sort(),['delayed','fresh']);
  await handler.service.flush(env);
  assert.equal(net.calls.filter(c=>c.url.includes('api.telegram.org')).length,2);
  // 使用者主動分享同一篇舊文：照常整理，不受新鮮度篩選。
  await (await handler.fetch(request('api/collect','POST',{url:'https://developers.openai.com/blog/old'}),env)).json();
  for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);
  assert.equal((await query(env,"SELECT status FROM learning_items WHERE url='https://developers.openai.com/blog/old'").first()).status,'ready');
});

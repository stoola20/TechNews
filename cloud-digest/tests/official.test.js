import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {tasksFor} from '../src/schedule.js';
import {createLearningHandler} from '../src/learning/http.js';
import {setTextProvider,claim} from '../src/learning/local.js';
import {item,rows,query} from '../src/learning/store.js';
import {SOURCES} from '../src/sources.js';
import {environment,recorder,request,message,database} from './helpers.js';

const TAIL='限制：此功能僅在 v2.4 以上可用，且每分鐘最多 60 次請求。';
const longContent='背景、機制、例子與操作步驟。'.repeat(500)+TAIL;
// 固定「現在時間」：測試結果不隨真實日期改變。
const NOW=Date.parse('2026-10-19T00:00:00Z'),now=()=>NOW,DAY=86400000;
const daysAgo=n=>new Date(NOW-n*DAY).toUTCString();
const entries=Array.from({length:8},(_,i)=>({url:`https://developers.openai.com/blog/post-${i}`,title:'Post '+i,publishedAt:daysAgo(0),content:null}));
function setup(){
  const env={...environment(),LEARNING_RUNNER_TOKEN:'runner-test-token'},net=recorder(),loads=[];
  const handler=createLearningHandler({...net,now,discoverSource:async source=>source.id==='openai_developer_blog'?entries:[],
    loadArticle:async(source,entry)=>{loads.push(entry.url);return {...entry,title:'Official '+entry.url.split('-').at(-1),content:longContent,contentMethod:'article_html'};}});
  return {env,net,handler,loads};
}
async function settings(env){await query(env,"INSERT INTO settings(key,value_json,updated_at) VALUES('digest',?,?)",JSON.stringify({interests:'AI agents 與開發者工具',sources:[SOURCES[0]]}),new Date().toISOString()).run();}
async function complete(s,job,output){
  const r=await s.handler.fetch(new Request('https://learning.example.org/learning/runner/complete',{method:'POST',headers:{authorization:'Bearer runner-test-token','content-type':'application/json'},
    body:JSON.stringify({runner_id:'mac',job_id:job.id,attempt_token:job.attempt_token,input_version:job.input_version,model:{name:'gemma4:26b',done_reason:'stop'},output})}),s.env);
  return r.json();
}
async function drain(s){for(const row of await rows(s.env,"SELECT id FROM learning_items WHERE status='queued'"))await s.handler.queue({messages:[message({kind:'article',id:row.id})]},s.env);}

test('Worker 只剩文章庫：08:00 排程走文章庫的官方發現，舊導讀端點回 404',async()=>{
  assert.deepEqual(tasksFor('0 0 * * *'),['official','bookmark_daily','author_recheck']);
  assert.deepEqual(tasksFor('*/5 * * * *'),['maintenance']);
  assert.deepEqual(tasksFor('0 1 * * *'),[]);
  const env=environment(),auth={authorization:'Bearer private-test-token'};
  for(const [path,method] of [['/settings','GET'],['/config','GET'],['/config','PUT'],['/run','POST'],['/preview?source=openai_developer_blog','GET']])
    assert.equal((await worker.fetch(new Request('https://worker.example.org'+path,{method,headers:auth}),env)).status,404,path);
  assert.equal((await worker.fetch(new Request('https://worker.example.org/health'),env)).status,200);
  // 預設的官方發現在呼叫當下讀取全域 fetch：換成只記錄網址的假網路，觀察排程實際做了什麼。
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return new Response('',{status:404});};
  try{
    await worker.scheduled({cron:'0 1 * * *'},env);
    assert.equal(calls.length,0);
    await worker.scheduled({cron:'0 0 * * *'},env);
  }finally{globalThis.fetch=original;}
  assert.ok(calls.some(u=>u.startsWith('https://developers.openai.com/blog')));
  assert.ok(!calls.some(u=>u.includes('api.telegram.org')));
  assert.equal((await rows(env,'SELECT source_url FROM articles')).length,0);
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
  const handler=createLearningHandler({...net,now,discoverSource:async source=>source.id==='openai_developer_blog'?entries.slice(0,2):[],
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


test('已初始化的來源突然冒出舊文章：發表超過期限的只記為看過，不收件也不通知',async()=>{
  const env=environment(),net=recorder();
  const feed=[
    {url:'https://developers.openai.com/blog/fresh',title:'Fresh',publishedAt:daysAgo(1),content:null},
    {url:'https://developers.openai.com/blog/last-november',title:'Old',publishedAt:daysAgo(340),content:null},
    {url:'https://developers.openai.com/blog/eight-days',title:'Edge',publishedAt:daysAgo(8),content:null},
    {url:'https://developers.openai.com/blog/undated',title:'Undated',publishedAt:null,content:null},
  ];
  const handler=createLearningHandler({...net,now,discoverSource:async source=>source.id==='openai_developer_blog'?feed:[]});
  await settings(env);
  // 模擬今天的狀況：來源早已初始化，但 seen 清單沒有這些舊網址（舊流程只記已處理過的）。
  await query(env,"INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,'[]')",daysAgo(30),daysAgo(1)).run();
  const result=await handler.service.official(env);
  assert.equal(result.queued,2);assert.equal(result.stale,2);
  assert.deepEqual((await rows(env,'SELECT url FROM learning_items ORDER BY url')).map(r=>r.url.split('/').at(-1)),['fresh','undated']);
  const overview=await (await handler.fetch(request('api/admin/sources'),env)).json();
  const openai=overview.sources.find(s=>s.id==='openai_developer_blog');
  assert.equal(overview.max_age_days,7);assert.equal(openai.status,'ok');
  assert.deepEqual({found:openai.last_run.found,collected:openai.last_run.collected,stale:openai.last_run.stale},{found:4,collected:2,stale:2});
  // 下一次發現：全部都看過，不再收件。
  assert.equal((await handler.service.official(env)).queued,0);
});

test('列表沒有日期的官方文章：抓到原文才發現太舊就篩掉，不呼叫模型、不通知；收件後的處理延誤不算過期',async()=>{
  const env=environment(),net=recorder(),generated=[];
  const published={old:daysAgo(60),fresh:daysAgo(2),delayed:daysAgo(12)};
  const handler=createLearningHandler({...net,now,
    discoverSource:async source=>source.id==='openai_developer_blog'?Object.keys(published).map(k=>({url:'https://developers.openai.com/blog/'+k,title:k,publishedAt:null,content:null})):[],
    loadArticle:async(source,entry)=>({...entry,title:'Official '+entry.url.split('/').at(-1),publishedAt:published[entry.url.split('/').at(-1)],content:longContent,contentMethod:'article_html'}),
    generate:async(env,sources)=>{generated.push(sources[0].url);return {title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]};}});
  await settings(env);
  await query(env,"INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,'[]')",daysAgo(30),daysAgo(1)).run();
  assert.equal((await handler.service.official(env)).queued,3);
  // delayed：收件於 10 天前（例如 Mac 離線），當時文章才發表 2 天，仍算新知。
  await query(env,"UPDATE learning_intakes SET created_at=? WHERE receipt='official:https://developers.openai.com/blog/delayed'",new Date(NOW-10*DAY).toISOString()).run();
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

test('升級前的看過清單轉成初次基準：之後仍出現在列表上也不會被當成新文章收件',async()=>{
  const DB=database({beforeMigration:(name,sqlite)=>{
    if(name==='0016_source_entries.sql')sqlite.prepare("INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,?)")
      .run(new Date(NOW-30*DAY).toISOString(),new Date(NOW-DAY).toISOString(),JSON.stringify(['https://developers.openai.com/blog/known']));
  }});
  const env=environment({DB}),net=recorder();
  const feed=[{url:'https://developers.openai.com/blog/known',title:'Known',publishedAt:daysAgo(1),content:null},{url:'https://developers.openai.com/blog/new',title:'New',publishedAt:daysAgo(1),content:null}];
  const handler=createLearningHandler({...net,now,discoverSource:async source=>source.id==='openai_developer_blog'?feed:[]});
  await settings(env);
  assert.equal((await handler.service.official(env)).queued,1);
  assert.deepEqual((await rows(env,'SELECT url FROM learning_items')).map(r=>r.url),['https://developers.openai.com/blog/new']);
  const openai=(await (await handler.fetch(request('api/admin/sources'),env)).json()).sources.find(s=>s.id==='openai_developer_blog');
  assert.deepEqual([openai.last_run.found,openai.last_run.collected],[2,1]);
});

test('來源失敗與空列表記為失敗，管理頁顯示原因；從未執行的來源標為尚未執行',async()=>{
  const env=environment(),net=recorder();
  const handler=createLearningHandler({...net,now,discoverSource:async source=>{if(source.id==='openai_developer_blog')throw new Error('Source HTTP 403');return [];}});
  await query(env,"INSERT INTO settings(key,value_json,updated_at) VALUES('digest',?,?)",JSON.stringify({interests:'AI',sources:SOURCES.slice(0,2)}),new Date(NOW).toISOString()).run();
  const before=(await (await handler.fetch(request('api/admin/sources'),env)).json()).sources;
  assert.deepEqual(before.map(s=>s.status),['never','never']);
  const result=await handler.service.official(env);
  assert.equal(result.errors.length,2);
  const [openai,apple]=(await (await handler.fetch(request('api/admin/sources'),env)).json()).sources;
  assert.equal(openai.status,'failed');assert.equal(openai.last_run.error,'Source HTTP 403');
  assert.equal(apple.status,'failed');assert.equal(apple.last_run.error,'來源列表沒有找到任何文章');
});

test('紀錄保留 30 天：沒再出現在列表的網址會清掉，仍在列表上的保留；重新出現時不會重複整理或通知',async()=>{
  const env=environment(),net=recorder();let today=NOW,feed=[];
  const handler=createLearningHandler({...net,now:()=>today,discoverSource:async source=>source.id==='openai_developer_blog'?feed:[],
    loadArticle:async(source,entry)=>({...entry,title:'Official',publishedAt:new Date(today).toISOString(),content:longContent,contentMethod:'article_html'}),
    generate:async(env,sources)=>({title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]})});
  await settings(env);
  await query(env,"INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,'[]')",new Date(NOW-DAY).toISOString(),new Date(NOW-DAY).toISOString()).run();
  const A={url:'https://developers.openai.com/blog/stays',title:'A',publishedAt:null,content:null},B={url:'https://developers.openai.com/blog/drops',title:'B',publishedAt:null,content:null};
  const lastRun=async()=>(await (await handler.fetch(request('api/admin/sources'),env)).json()).sources.find(s=>s.id==='openai_developer_blog').last_run;
  feed=[A,B];assert.equal((await handler.service.official(env)).queued,2);
  for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);
  const sent=()=>net.calls.filter(c=>c.url.includes('api.telegram.org')).length;
  assert.equal(sent(),2);
  today=NOW+20*DAY;feed=[A];await handler.service.official(env);
  today=NOW+31*DAY;await handler.scheduled(env,{tasks:['maintenance']});
  today=NOW+32*DAY;feed=[A,B];await handler.service.official(env);
  // A 一直在列表上，紀錄保留、不重新判斷；B 消失超過 30 天，紀錄已清掉，重新出現時再記一次收件。
  assert.equal((await lastRun()).collected,1);
  for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);
  assert.equal((await rows(env,'SELECT id FROM learning_items')).length,2);
  assert.equal(sent(),2);
});

test('逐篇明細與「仍要收件」：太舊略過的文章照主動分享整理並通知；重複按不會重複收件或通知',async()=>{
  const env=environment(),net=recorder(),loads=[],generated=[];
  const feed=[
    {url:'https://developers.openai.com/blog/fresh',title:'Fresh',publishedAt:daysAgo(1),content:null},
    {url:'https://developers.openai.com/blog/listed-old',title:'Listed old',publishedAt:daysAgo(40),content:null},
    {url:'https://developers.openai.com/blog/undated-old',title:'Undated old',publishedAt:null,content:null},
  ];
  const published={fresh:daysAgo(1),'listed-old':daysAgo(40),'undated-old':daysAgo(60)};
  const handler=createLearningHandler({...net,now,discoverSource:async source=>source.id==='openai_developer_blog'?feed:[],
    loadArticle:async(source,entry)=>{const key=entry.url.split('/').at(-1);loads.push(key);return {...entry,title:'Official '+key,publishedAt:published[key],content:longContent,contentMethod:'article_html'};},
    // 有官方主題判斷時一律判為不相關：用來確認「仍要收件」不受主題篩選。
    generate:async(env,sources,media,gaps,question,fetcher,{official}={})=>{generated.push([sources[0].url.split('/').at(-1),!!official]);
      return official?{publish:false,reason:'不符合關注',title:'略過'}:{title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]};}});
  await settings(env);
  await query(env,"INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES('openai_developer_blog',?,?,'[]')",daysAgo(30),daysAgo(1)).run();
  const drainAll=async()=>{for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);};
  const detail=async()=>Object.fromEntries((await (await handler.fetch(request('api/admin/sources'),env)).json()).sources.find(s=>s.id==='openai_developer_blog').entries.map(e=>[e.url.split('/').at(-1),e]));
  const sent=()=>net.calls.filter(c=>c.url.includes('api.telegram.org')).length;
  assert.equal((await handler.service.official(env)).queued,2);
  await drainAll();

  let entries=await detail();
  assert.deepEqual(Object.keys(entries).sort(),['fresh','listed-old','undated-old']);
  assert.equal(entries.fresh.decision,'collected');assert.ok(entries.fresh.item_id);assert.equal(entries.fresh.title,'Fresh');
  assert.equal(entries['listed-old'].decision,'stale');assert.equal(entries['listed-old'].reason,'發表超過 7 天');assert.equal(entries['listed-old'].item_id,null);
  // 列表沒有日期、抓到原文才判定太舊的那篇也標為太舊略過，並連到文章庫裡篩掉的那一篇。
  assert.equal(entries['undated-old'].decision,'stale');assert.match(entries['undated-old'].reason,/^發表於/);assert.ok(entries['undated-old'].item_id);
  assert.equal(sent(),0);

  for(const key of ['listed-old','undated-old'])
    assert.equal((await handler.fetch(request('api/admin/sources/collect','POST',{source:'openai_developer_blog',url:'https://developers.openai.com/blog/'+key}),env)).status,202);
  await drainAll();
  const items=Object.fromEntries((await rows(env,'SELECT id,url,status FROM learning_items')).map(r=>[r.url.split('/').at(-1),r]));
  assert.equal(items['listed-old'].status,'ready');assert.equal(items['undated-old'].status,'ready');
  // 原文沿用官方擷取規則；整理時不帶官方主題判斷。
  assert.ok(loads.includes('listed-old'));
  assert.deepEqual(generated.filter(([key])=>key!=='fresh').sort(),[['listed-old',false],['undated-old',false]]);
  await handler.service.flush(env);
  assert.equal(sent(),2);
  entries=await detail();
  for(const key of ['listed-old','undated-old']){
    assert.equal(entries[key].decision,'collected');assert.equal(entries[key].manual,true);assert.equal(entries[key].item_id,items[key].id);
  }

  // 重複按：不新增文章、收件或通知。
  for(const key of ['listed-old','undated-old'])
    await handler.fetch(request('api/admin/sources/collect','POST',{source:'openai_developer_blog',url:'https://developers.openai.com/blog/'+key}),env);
  await drainAll();await handler.service.flush(env);
  assert.equal(sent(),2);
  assert.equal((await rows(env,'SELECT id FROM learning_items')).length,3);
  assert.equal((await rows(env,"SELECT receipt FROM learning_intakes WHERE item_id=?",items['listed-old'].id)).length,2);
  // 下一輪發現：手動收件的條目不被改回太舊，也不再收件。
  assert.equal((await handler.service.official(env)).queued,0);
  assert.equal((await detail())['listed-old'].decision,'collected');
  // 沒有來源紀錄的網址不能用這個入口收件。
  assert.equal((await handler.fetch(request('api/admin/sources/collect','POST',{source:'openai_developer_blog',url:'https://developers.openai.com/blog/unknown'}),env)).status,400);
});

test('管理頁儲存來源與想收到的內容：格式錯誤回 400 且原設定不變；關閉的來源不發現、不寫執行紀錄，列表顯示已關閉',async()=>{
  const env=environment(),net=recorder(),discovered=[],seen=[];
  const handler=createLearningHandler({...net,now,discoverSource:async source=>{discovered.push(source.id);return [{url:source.id==='openai_developer_blog'?'https://developers.openai.com/blog/today':'https://developer.apple.com/news/?id=today',title:'Today',publishedAt:daysAgo(0),content:null}];},
    loadArticle:async(source,entry)=>({...entry,content:longContent,contentMethod:'article_html'}),
    generate:async(env,sources,media,gaps,question,fetcher,{official}={})=>{seen.push(official?.interests);return {title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]};}});
  // 舊設定沒有 enabled：讀取時視為開啟。
  await query(env,"INSERT INTO settings(key,value_json,updated_at) VALUES('digest',?,?)",JSON.stringify({interests:'舊的關注',sources:SOURCES.slice(0,2),model_profile:'legacy'}),new Date(NOW).toISOString()).run();
  const overview=async()=>(await handler.fetch(request('api/admin/sources'),env)).json();
  let o=await overview();
  assert.equal(o.settings.interests,'舊的關注');
  assert.deepEqual(o.sources.map(s=>[s.id,s.enabled,s.status]),[['openai_developer_blog',true,'never'],['apple_developer_news',true,'never']]);

  const save=value=>handler.fetch(request('api/admin/settings','PUT',value),env);
  const broken=await save({interests:'新的關注',sources:[{...SOURCES[0],host:'example.org'}]});
  assert.equal(broken.status,400);assert.match((await broken.json()).error,/第 1 個來源（openai_developer_blog）的 host/);
  assert.equal((await save({interests:'新的關注',sources:[{...SOURCES[0],enabled:'no'}]})).status,400);
  assert.equal((await save({interests:'',sources:SOURCES.slice(0,2)})).status,400);
  o=await overview();
  assert.equal(o.settings.interests,'舊的關注');assert.equal(o.sources.length,2);

  const saved=await save({interests:'新的關注',sources:[SOURCES[0],{...SOURCES[1],enabled:false}]});
  assert.equal(saved.status,200);
  o=await saved.json();
  assert.deepEqual(o.sources.map(s=>[s.id,s.enabled,s.status]),[['openai_developer_blog',true,'never'],['apple_developer_news',false,'disabled']]);
  const stored=JSON.parse((await query(env,"SELECT value_json FROM settings WHERE key='digest'").first()).value_json);
  assert.equal(stored.model_profile,undefined);assert.deepEqual(stored.sources.map(s=>s.enabled),[true,false]);

  await handler.service.official(env);
  assert.deepEqual(discovered,['openai_developer_blog']);
  assert.deepEqual((await rows(env,'SELECT source FROM source_runs')).map(r=>r.source),['openai_developer_blog']);
  o=await overview();
  assert.deepEqual(o.sources.map(s=>s.status),['ok','disabled']);
  // 官方文章的主題篩選使用新存的想收到的內容。
  for(const row of await rows(env,"SELECT id FROM learning_items WHERE status='queued'"))await handler.queue({messages:[message({kind:'article',id:row.id})]},env);
  assert.deepEqual(seen,['新的關注']);
});

test('關閉超過 30 天後重新開啟：重新建立基準，列表上沒有日期的舊文不會被當成新文章',async()=>{
  const env=environment(),net=recorder();let today=NOW,feed=[];
  const handler=createLearningHandler({...net,now:()=>today,discoverSource:async source=>source.id==='openai_developer_blog'?feed:[]});
  const configure=enabled=>handler.fetch(request('api/admin/settings','PUT',{interests:'AI',sources:[{...SOURCES[0],enabled}]}),env);
  const post=key=>({url:'https://developers.openai.com/blog/'+key,title:key,publishedAt:null,content:null});
  await configure(true);
  feed=[post('first')];
  assert.equal((await handler.service.official(env)).queued,1);
  await configure(false);
  // 關閉期間列表又多了幾篇沒有日期的文章；維護排程照常清掉超過 30 天沒出現的紀錄。
  today=NOW+40*DAY;await handler.scheduled(env,{tasks:['maintenance']});
  feed=[post('newest'),post('while-off-1'),post('while-off-2'),post('first')];
  await configure(true);
  const result=await handler.service.official(env);
  assert.equal(result.queued,1);
  const entries=(await (await handler.fetch(request('api/admin/sources'),env)).json()).sources[0].entries;
  assert.deepEqual(entries.filter(e=>e.decision==='baseline').map(e=>e.url.split('/').at(-1)).sort(),['first','while-off-1','while-off-2']);
  assert.match(entries.find(e=>e.decision==='baseline').reason,/超過 30 天沒有成功檢查/);
  assert.deepEqual((await rows(env,"SELECT url FROM learning_items ORDER BY created_at")).map(r=>r.url.split('/').at(-1)),['first','newest']);
});

test('來源連續兩次失敗發一則提醒：第三次不重發、恢復不通知、再故障重新提醒；送出失敗只重送同一份；關閉的來源不提醒',async()=>{
  const env=environment(),attempts=[],sent=[];let today=NOW,down=true,telegramDown=false;
  const handler=createLearningHandler({...recorder(),now:()=>today,
    sendTelegram:async(env,text)=>{attempts.push(text);if(telegramDown)throw new Error('Telegram 暫時無法使用');sent.push(text);return sent.length;},
    discoverSource:async source=>{
      if(source.id==='apple_developer_news')throw new Error('不應該檢查關閉的來源');
      if(down)throw new Error(today<NOW+4*DAY?'Source HTTP 403':'來源列表沒有找到任何文章');
      return [{url:'https://developers.openai.com/blog/day-'+Math.round((today-NOW)/DAY),title:'Post',publishedAt:new Date(today).toUTCString(),content:null}];
    }});
  await query(env,"INSERT INTO settings(key,value_json,updated_at) VALUES('digest',?,?)",JSON.stringify({interests:'AI',sources:[SOURCES[0],{...SOURCES[1],enabled:false}]}),new Date(NOW).toISOString()).run();
  const day=async n=>{today=NOW+n*DAY;await handler.scheduled(env,{tasks:['official']});};
  const alerts=()=>sent.filter(t=>t.startsWith('【來源異常】'));
  const status=async()=>(await (await handler.fetch(request('api/admin/sources'),env)).json()).sources[0];

  await day(0);assert.equal(alerts().length,0);
  // 第二天仍失敗：發一則提醒，但這次 Telegram 送不出去，下一輪重送同一份內容。
  telegramDown=true;await assert.rejects(day(1),/Telegram 暫時無法使用/);
  assert.equal(sent.length,0);assert.equal(attempts.length,1);
  telegramDown=false;await day(2);
  assert.equal(alerts().length,1);assert.equal(attempts[1],attempts[0]);
  assert.match(alerts()[0],/^【來源異常】OpenAI Developer Blog 連續 2 次檢查失敗/);
  assert.match(alerts()[0],/最近一次原因：Source HTTP 403/);assert.match(alerts()[0],/https:\/\/learning\.example\.org\/learning\/admin/);
  assert.equal((await status()).consecutive_failures,3);
  await day(3);assert.equal(alerts().length,1);
  // 恢復：不另外通知，次數歸零。
  down=false;await day(4);
  assert.equal(alerts().length,1);assert.equal((await status()).consecutive_failures,0);
  // 再故障（空列表也算失敗）：第一次不提醒，第二次重新提醒。
  down=true;await day(5);assert.equal(alerts().length,1);
  await day(6);assert.equal(alerts().length,2);assert.match(alerts()[1],/來源列表沒有找到任何文章/);
  // 提醒不帶文章，不影響文章通知的去重。
  const deliveries=await rows(env,"SELECT item_ids_json FROM learning_deliveries WHERE origin='source_alert'");
  assert.equal(deliveries.length,2);assert.ok(deliveries.every(d=>d.item_ids_json==='[]'));
  assert.ok(!alerts().some(t=>t.includes('Apple Developer News')));
});

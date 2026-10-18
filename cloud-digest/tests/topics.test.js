import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {query,item,setSetting} from '../src/learning/store.js';
import {classifyPending,DEFAULT_TOPICS,TOPIC_MODEL} from '../src/learning/topics.js';
import {environment,recorder,request} from './helpers.js';

const T=day=>new Date(Date.UTC(2026,2,day)).toISOString();
async function add(env,id,{status='ready',day=1,title='文章',intro='導讀',revision=1,topic=null,secondary=null,source=null,topicRevision=null}={}){
  await query(env,`INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,topic_primary,topic_secondary,topic_source,topic_revision,created_at,updated_at)
    VALUES(?,?,'web',?,?,'正文',?,?,?,?,?,?,?,?)`,id,'https://example.org/'+id,title,status,JSON.stringify({intro}),revision,topic,secondary,source,topicRevision,T(day),T(day)).run();
}
// Workers AI 替身：記錄輸入，依標題回傳合成分類結果。
function ai(answer=({title})=>({primary:'models',secondary:null}),shape='choices'){
  const calls=[];
  return {calls,async run(model,input){
    calls.push({model,input});
    const article=JSON.parse(input.messages[1].content).article,value=JSON.stringify(answer(article));
    return shape==='choices'?{choices:[{message:{content:value},finish_reason:'stop'}]}:{response:value};
  }};
}
const id=c=>c.repeat(32);

test('維護排程用 Workers AI 分類已完成文章：只送標題與導讀、每輪有上限、跳過未完成與手動設定',async()=>{
  const env=environment();env.AI=ai(({title})=>title==='跨主題'?{primary:'ai-coding',secondary:'agent-engineering'}:{primary:'apple',secondary:'apple'});
  const n=k=>('n'+String(k).padStart(2,'0')).padEnd(32,'0');
  for(let k=0;k<12;k++)await add(env,n(k),{day:k+1,title:k===11?'跨主題':'文章'});
  await add(env,id('p'),{status:'processing',day:20});
  await add(env,id('m'),{day:21,topic:'models',source:'manual'});
  await createLearningHandler(recorder()).scheduled(env,{tasks:['maintenance']});
  assert.equal(env.AI.calls.length,10);
  assert.equal(env.AI.calls[0].model,TOPIC_MODEL);
  const sent=JSON.parse(env.AI.calls[0].input.messages[1].content);
  assert.deepEqual(sent.article,{title:'跨主題',intro:'導讀'});
  assert.deepEqual(sent.topics.map(t=>t.id),DEFAULT_TOPICS.map(t=>t.id));
  const cross=await item(env,n(11));
  assert.deepEqual([cross.topic_primary,cross.topic_secondary,cross.topic_source,cross.topic_revision],['ai-coding','agent-engineering','model',1]);
  // 次要主題與主要主題相同時視為沒有次要主題。
  const same=await item(env,n(10));assert.deepEqual([same.topic_primary,same.topic_secondary],['apple',null]);
  assert.equal((await item(env,id('p'))).topic_primary,null);
  assert.deepEqual([(await item(env,id('m'))).topic_primary,(await item(env,id('m'))).topic_source],['models','manual']);
  // 新加入的先分類；下一輪處理剩下的兩篇，已分類的不重送。
  assert.equal((await item(env,n(0))).topic_primary,null);
  await classifyPending(env);
  assert.equal(env.AI.calls.length,12);
  assert.equal((await item(env,n(0))).topic_primary,'apple');
  assert.equal((await classifyPending(env)).checked,0);
});

test('內容更新、主題被刪除時重新分類；模型回傳不在主題表的結果時延後重試，五次後停在未分類',async()=>{
  const env=environment();env.AI=ai(()=>({primary:'enterprise'}),'response');
  await add(env,id('1'),{topic:'models',source:'model',topicRevision:1,revision:2});
  await add(env,id('2'),{topic:'gone',source:'model',topicRevision:1});
  await add(env,id('3'),{topic:'apple',source:'model',topicRevision:1});
  assert.deepEqual(await classifyPending(env),{classified:2,checked:2});
  assert.equal((await item(env,id('1'))).topic_primary,'enterprise');assert.equal((await item(env,id('1'))).topic_revision,2);
  assert.equal((await item(env,id('2'))).topic_primary,'enterprise');
  assert.equal((await item(env,id('3'))).topic_primary,'apple');

  const bad=environment();bad.AI=ai(()=>({primary:'not-a-topic'}));
  await add(bad,id('4'));
  for(let attempt=1;attempt<=5;attempt++){
    await query(bad,'UPDATE learning_items SET topic_next_at=NULL WHERE id=?',id('4')).run();
    await classifyPending(bad);
    const row=await item(bad,id('4'));
    assert.equal(row.topic_primary,null);
    if(attempt<5){assert.equal(row.topic_attempts,attempt);assert.ok(row.topic_next_at>new Date().toISOString());}
    else{assert.equal(row.topic_attempts,0);assert.equal(row.topic_revision,1);}
  }
  assert.equal((await classifyPending(bad)).checked,0);
  // 內容更新後再試一次。
  await query(bad,'UPDATE learning_items SET revision=2 WHERE id=?',id('4')).run();
  assert.equal((await classifyPending(bad)).checked,1);
  // 沒有 AI binding 時記為失敗，不丟出例外。
  const none=environment();await add(none,id('5'));
  assert.deepEqual(await classifyPending(none),{classified:0,checked:1});
});

test('主題篩選比對主要與次要主題並可和其他條件並用；主題篇數依其他條件計算並含未分類',async()=>{
  const env=environment(),handler=createLearningHandler(recorder());
  await add(env,id('1'),{day:4,topic:'models',secondary:'agent-engineering'});
  await add(env,id('2'),{day:3,topic:'agent-engineering',title:'工具呼叫'});
  await add(env,id('3'),{day:2});
  await add(env,id('4'),{day:1,topic:'removed-topic'});
  await query(env,'UPDATE learning_items SET read_at=? WHERE id=?',T(5),id('2')).run();
  const ids=async q=>(await (await handler.fetch(request('api/items'+q),env)).json()).map(i=>i.id[0]).join('');
  assert.equal(await ids('?topic=agent-engineering'),'12');
  assert.equal(await ids('?topic=models'),'1');
  assert.equal(await ids('?topic=unclassified'),'34');
  assert.equal(await ids('?topic=agent-engineering&unread=1'),'1');
  assert.equal(await ids('?topic=agent-engineering&q='+encodeURIComponent('工具')),'2');
  assert.equal((await handler.fetch(request('api/items?topic=bogus'),env)).status,400);
  const listed=(await (await handler.fetch(request('api/items'),env)).json())[0];
  assert.deepEqual([listed.topic_primary,listed.topic_secondary],['models','agent-engineering']);
  const counts=await (await handler.fetch(request('api/topics'),env)).json();
  assert.equal(counts.total,4);assert.equal(counts.unclassified,2);
  assert.deepEqual(Object.fromEntries(counts.topics.map(t=>[t.id,t.count])),{models:1,'ai-coding':0,'agent-engineering':2,'product-updates':0,apple:0,'safety-policy':0,enterprise:0});
  assert.ok(counts.topics.every(t=>t.name&&t.color));
  const unread=await (await handler.fetch(request('api/topics?unread=1'),env)).json();
  assert.equal(unread.total,3);assert.equal(unread.topics.find(t=>t.id==='agent-engineering').count,1);
  // 自訂主題表後，篩選與篇數跟著改。
  await setSetting(env,'topics',{topics:[{id:'models',name:'模型',color:'#0f766e',description:''}]});
  assert.equal(await ids('?topic=unclassified'),'234');
  assert.equal((await handler.fetch(request('api/items?topic=apple'),env)).status,400);
});

test('閱讀頁手動設定主題：驗證主題表、內容更新也不被自動分類覆寫；改回自動後重新分類',async()=>{
  const env=environment(),handler=createLearningHandler(recorder());env.AI=ai(()=>({primary:'models'}));
  await add(env,id('1'),{topic:'models',source:'model',topicRevision:1});
  const put=body=>handler.fetch(request('api/items/'+id('1')+'/topics','PUT',body),env);
  assert.equal((await put({primary:'bogus'})).status,400);
  assert.equal((await put({primary:'apple',secondary:'apple'})).status,400);
  assert.equal((await put({primary:'apple',secondary:'removed'})).status,400);
  assert.deepEqual(await (await put({primary:'apple',secondary:'enterprise'})).json(),{id:id('1'),topic_primary:'apple',topic_secondary:'enterprise',topic_source:'manual'});
  await query(env,'UPDATE learning_items SET revision=3 WHERE id=?',id('1')).run();
  assert.equal((await classifyPending(env)).checked,0);
  assert.equal((await item(env,id('1'))).topic_primary,'apple');
  assert.equal((await (await put({primary:'apple'})).json()).topic_secondary,null);
  assert.equal((await (await put({auto:true})).json()).topic_source,null);
  assert.equal((await classifyPending(env)).classified,1);
  const row=await item(env,id('1'));
  assert.deepEqual([row.topic_primary,row.topic_source,row.topic_revision],['models','model',3]);
  assert.equal((await handler.fetch(request('api/items/'+id('9')+'/topics','PUT',{primary:'apple'}),env)).status,404);
});

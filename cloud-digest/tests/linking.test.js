import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {item,rows,query} from '../src/learning/store.js';
import {resolveItemId} from '../src/learning/library.js';
import {linkedArticleUrl} from '../src/learning/linking.js';
import {environment,recorder,message,request} from './helpers.js';

const ARTICLE='https://developers.openai.com/blog/shared-launch';
const now=new Date().toISOString();
function setup({links=[ARTICLE]}={}){
  const env=environment(),sent=[],generated=[];
  const handler=createLearningHandler({...recorder(),
    postEvidence:async(env,id)=>({url:'https://x.com/i/status/'+id,relation:'primary',author_id:'9',content:'第一手消息：新功能上線',metadata:{post_id:id,conversation_id:id,references:[],links},media:[]}),
    xRead:async()=>({data:[],meta:{result_count:0}}),
    webEvidence:async url=>({url,relation:'primary',content:'外部文章全文：背景、機制與限制。'.repeat(20),metadata:{title:'外部文章'},media:[]}),
    loadArticle:async(source,entry)=>({...entry,title:'Official',content:'官方原文：背景、機制與限制。'.repeat(20),contentMethod:'article_html'}),
    discoverSource:async source=>source.id==='openai_developer_blog'?[{url:ARTICLE,title:'Shared launch',publishedAt:now,content:null}]:[],
    generate:async(env,sources)=>{generated.push(sources.map(s=>s.relation+':'+s.url));return {title:'詳細教材',body:'## 背景\n\n正文',intro:'導讀',citations:[sources[0].id],observations:[]};},
    sendTelegram:async(env,text)=>{sent.push(text);return sent.length;}});
  return {env,handler,sent,generated};
}
async function drain(s){for(let i=0;i<5;i++){const queued=await rows(s.env,"SELECT id FROM learning_items WHERE status='queued'");if(!queued.length)break;for(const r of queued)await s.handler.queue({messages:[message({kind:'article',id:r.id})]},s.env);}await s.handler.service.flush(s.env);}
async function official(env,{edition='legacy_digest',body='舊短導讀'}={}){
  const id='c'.repeat(32);
  await query(env,"INSERT INTO learning_items(id,url,kind,title,status,edition,body,article_json,revision,notified_revision,note,created_at,updated_at) VALUES(?,?,'web','官方文章','ready',?,?,?,1,1,'官方筆記',?,?)",id,ARTICLE,edition,body,JSON.stringify({intro:'官方導讀',content_fingerprint:'old'}),now,now).run();
  await query(env,"INSERT INTO learning_intakes(receipt,item_id,origin,notify_revision,metadata_json,created_at) VALUES(?,?,'official',1,?,?)",'official:'+ARTICLE,id,JSON.stringify({source_id:'openai_developer_blog'}),now).run();
  await query(env,"INSERT INTO learning_evidence(id,item_id,url,relation,content,fetched_at) VALUES('official-primary',?,?,'primary','官方原文：背景、機制與限制。',?)",id,ARTICLE,now).run();
  return id;
}

test('唯一外連才算連到同一篇；多個外連、X 內部連結與媒體檔不算',async()=>{
  const env=environment();
  assert.equal(await linkedArticleUrl(env,[ARTICLE,'https://x.com/i/status/1','https://pbs.example.org/a.jpg']),ARTICLE);
  assert.equal(await linkedArticleUrl(env,[ARTICLE,'https://example.org/other']),null);
  assert.equal(await linkedArticleUrl(env,['https://x.com/i/status/1']),null);
  // 同一篇的不同寫法（尾端斜線、追蹤參數）仍是一篇
  assert.equal(await linkedArticleUrl(env,[ARTICLE+'/',ARTICLE+'?utm_source=x']),ARTICLE);
});

test('先分享 X 貼文、隔天官方排程抓到同一篇：只記官方入口，不另建文章、不重新生成、不再通知',async()=>{
  const s=setup();
  const id=await s.handler.service.collect(s.env,'https://x.com/writer/status/200');
  await drain(s);
  assert.equal(s.generated.length,1);assert.equal(s.sent.length,1);
  assert.equal((await item(s.env,id)).linked_url,ARTICLE);
  await s.handler.service.official(s.env);
  await drain(s);
  assert.equal((await rows(s.env,"SELECT id FROM learning_items WHERE status NOT IN ('merged')")).length,1);
  assert.deepEqual((await rows(s.env,'SELECT origin FROM learning_intakes WHERE item_id=? ORDER BY origin',id)).map(r=>r.origin),['official','share']);
  assert.equal(s.generated.length,1);assert.equal(s.sent.length,1);
});

test('官方舊短導讀先到、之後分享 X 貼文：貼文併入同一篇並用目前模型重寫，發更新通知，舊 ID 可導向',async()=>{
  const s=setup(),officialId=await official(s.env);
  const xId=await s.handler.service.collect(s.env,'https://x.com/writer/status/201');
  await drain(s);
  assert.equal((await item(s.env,xId)).status,'merged');assert.equal(await resolveItemId(s.env,xId),officialId);
  const kept=await item(s.env,officialId);
  assert.equal(kept.edition,'detailed');assert.equal(kept.revision,2);assert.equal(kept.note,'官方筆記');
  assert.ok(s.generated.at(-1).includes('shared_post:https://x.com/i/status/201'));assert.equal(s.generated.at(-1)[0],'primary:'+ARTICLE);
  assert.equal(s.generated.length,1);
  assert.equal(s.sent.length,1);assert.match(s.sent[0],/【更新】/);
  assert.deepEqual((await rows(s.env,'SELECT origin FROM learning_intakes WHERE item_id=? ORDER BY origin',officialId)).map(r=>r.origin),['official','share']);
});

test('官方已是詳細版、之後分享 X 貼文：不重寫，只通知已在文章庫',async()=>{
  const s=setup(),officialId=await official(s.env,{edition:'detailed',body:'官方詳細教材'});
  await s.handler.service.collect(s.env,'https://x.com/writer/status/202');
  await drain(s);
  assert.equal(s.generated.length,0);
  const kept=await item(s.env,officialId);
  assert.equal(kept.revision,1);assert.equal(kept.body,'官方詳細教材');
  assert.equal(s.sent.length,1);assert.match(s.sent[0],/【已在文章庫】/);
  assert.ok((await rows(s.env,"SELECT url FROM learning_evidence WHERE item_id=?",officialId)).some(r=>r.url==='https://x.com/i/status/202'));
  const reader=await (await s.handler.fetch(request('api/items/'+officialId),s.env)).json();
  assert.ok(reader.sources.some(r=>r.url==='https://x.com/i/status/202'));
});

test('連到多篇外部文章的整理型貼文不合併',async()=>{
  const s=setup({links:[ARTICLE,'https://example.org/second']});
  await official(s.env,{edition:'detailed',body:'官方詳細教材'});
  const xId=await s.handler.service.collect(s.env,'https://x.com/writer/status/203');
  await drain(s);
  const x=await item(s.env,xId);
  assert.ok(['ready','partial'].includes(x.status));assert.equal(x.linked_url,'');
  assert.equal((await rows(s.env,"SELECT id FROM learning_items WHERE status NOT IN ('merged')")).length,2);
});

test('既有重複一次合併：保留已整理的 X 文章，官方舊導讀併入；不呼叫模型、不通知、可重複執行',async()=>{
  const s=setup(),officialId=await official(s.env);
  const xId='d'.repeat(32);
  await query(s.env,"INSERT INTO learning_items(id,url,kind,title,status,edition,body,article_json,revision,notified_revision,read_at,created_at,updated_at) VALUES(?,'https://x.com/i/status/300','x','X 詳細教材','ready','detailed','完整教材','{}',1,1,?,?,?)",xId,now,now,now).run();
  await query(s.env,"INSERT INTO learning_intakes(receipt,item_id,origin,notify_revision,created_at) VALUES('share-300',?,'share',1,?)",xId,now).run();
  await query(s.env,"INSERT INTO learning_evidence(id,item_id,url,relation,content,metadata_json,fetched_at) VALUES('x-300',?,'https://x.com/i/status/300','primary','貼文',?,?)",xId,JSON.stringify({links:[ARTICLE+'/']}),now).run();
  const before=s.sent.length;
  await s.handler.scheduled(s.env,{tasks:['maintenance']});
  assert.equal((await item(s.env,officialId)).status,'merged');assert.equal(await resolveItemId(s.env,officialId),xId);
  const kept=await item(s.env,xId);
  assert.equal(kept.linked_url,ARTICLE);assert.equal(kept.note,'官方筆記');assert.equal(kept.body,'完整教材');
  assert.deepEqual((await rows(s.env,'SELECT origin FROM learning_intakes WHERE item_id=? ORDER BY origin',xId)).map(r=>r.origin),['official','share']);
  await s.handler.scheduled(s.env,{tasks:['maintenance']});
  assert.equal((await rows(s.env,"SELECT id FROM learning_items WHERE status!='merged'")).length,1);
  assert.equal(s.generated.length,0);assert.equal(s.sent.length,before);
  // 合併後官方排程再抓到同一篇，也只記到保留的 X 文章。
  await s.handler.service.official(s.env);await drain(s);
  assert.equal((await rows(s.env,"SELECT id FROM learning_items WHERE status!='merged'")).length,1);assert.equal(s.generated.length,0);
});

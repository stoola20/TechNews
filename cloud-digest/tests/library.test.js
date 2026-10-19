import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {migrateLibrary} from '../src/learning/library.js';
import {rows,item,query} from '../src/learning/store.js';
import {environment,recorder,request,message} from './helpers.js';

const now='2026-10-01T01:00:00.000Z';
async function legacyOfficial(env,url,{content='官方原文：背景、機制與限制。'.repeat(20),provider='workers_ai',model='@cf/google/gemma-4-26b-a4b-it',status='notified',source='openai_developer_blog'}={}){
  await query(env,`INSERT INTO articles(source_url,source,title,published_at,status,summary_json,full_message_id,content,content_method,model_provider,model_name,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,url,source,'Original title','2026-09-30',status,JSON.stringify({publish:status!=='skipped',reason:'r',title_zh:'舊官方導讀',body_zh:'這是舊短導讀。'}),status==='notified'?11:null,content,content?'article_html':null,provider,model,now,now).run();
}
async function learningItem(env,id,url,{body='既有收藏詳細教材',note='',read=null,kind='web'}={}){
  await query(env,`INSERT INTO learning_items(id,url,kind,title,status,body,article_json,note,read_at,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,url,kind,'收藏標題',body?'ready':'queued',body,body?JSON.stringify({title:'收藏標題',body,intro:'導讀',citations:[],observations:[],provider:'gemini',model:'gemini-3.8-flash'}):null,note,read,body?1:0,now,now).run();
  await query(env,'INSERT INTO learning_intakes(receipt,item_id,origin,notify_revision,created_at) VALUES(?,?,?,?,?)','r-'+id,id,kind==='x'?'bookmark':'share',body?1:0,now).run();
}

test('兩套舊資料搬入共同文章庫：可重複執行、同網址合併、短導讀與缺漏如實標示',async()=>{
  const env=environment(),net=recorder(),handler=createLearningHandler(net);
  await legacyOfficial(env,'https://developers.openai.com/blog/shared');
  await legacyOfficial(env,'https://developers.openai.com/blog/no-content',{content:null,provider:null,model:null});
  await legacyOfficial(env,'https://developers.openai.com/blog/irrelevant',{status:'skipped'});
  await legacyOfficial(env,'https://developers.openai.com/blog/pending',{status:'pending'});
  // 使用者先前分享的同一篇，網址帶尾端斜線；收藏教材、筆記與已讀都要保留。
  await learningItem(env,'a'.repeat(32),'https://developers.openai.com/blog/shared/',{note:'我的筆記',read:now});
  // X 貼文連到官方文章，但兩者是不同來源身分。
  await learningItem(env,'b'.repeat(32),'https://x.com/i/status/123',{kind:'x'});
  await query(env,"INSERT INTO learning_evidence(id,item_id,url,relation,content,metadata_json,fetched_at) VALUES('ev-x',?,'https://x.com/i/status/123','primary','看這篇',?,?)",'b'.repeat(32),JSON.stringify({links:['https://developers.openai.com/blog/shared']}),now).run();

  const first=await migrateLibrary(env);
  assert.deepEqual(first,{imported:1,merged:1,renamed:1});
  const snapshot=async()=>({items:(await rows(env,'SELECT id,url,status,edition,body,note,read_at FROM learning_items ORDER BY id')),versions:(await rows(env,'SELECT id FROM learning_versions ORDER BY id')),intakes:(await rows(env,'SELECT receipt FROM learning_intakes ORDER BY receipt')),evidence:(await rows(env,'SELECT id FROM learning_evidence ORDER BY id'))});
  const before=await snapshot();
  assert.deepEqual(await migrateLibrary(env),{imported:0,merged:0,renamed:0});
  assert.deepEqual(await snapshot(),before);

  const shared=await item(env,'a'.repeat(32));
  assert.equal(shared.url,'https://developers.openai.com/blog/shared');
  assert.equal(shared.body,'既有收藏詳細教材');assert.equal(shared.edition,'detailed');assert.equal(shared.note,'我的筆記');assert.equal(shared.read_at,now);
  const origins=(await rows(env,'SELECT origin FROM learning_intakes WHERE item_id=? ORDER BY origin',shared.id)).map(r=>r.origin);
  assert.deepEqual(origins,['official','share']);
  const versions=await rows(env,'SELECT edition,origin,body FROM learning_versions WHERE item_id=?',shared.id);
  assert.deepEqual(versions.map(v=>({...v})),[{edition:'legacy_digest',origin:'official',body:'這是舊短導讀。'}]);

  const xItem=await item(env,'b'.repeat(32));
  assert.equal(xItem.url,'https://x.com/i/status/123');
  assert.equal((await rows(env,"SELECT * FROM learning_items WHERE url='https://developers.openai.com/blog/shared'")).length,1);

  const legacy=(await rows(env,"SELECT * FROM learning_items WHERE url='https://developers.openai.com/blog/no-content'"))[0];
  assert.equal(legacy.edition,'legacy_digest');assert.equal(legacy.status,'partial');assert.equal(legacy.body,'這是舊短導讀。');
  assert.match(legacy.gaps_json,/未保存原文/);assert.match(legacy.gaps_json,/缺少模型資訊/);
  assert.equal(JSON.parse(legacy.article_json).legacy,true);
  // 略過與尚未完成的官方文章不搬入；搬移不呼叫外部服務、不排工作、不通知。
  assert.equal((await rows(env,"SELECT * FROM learning_items WHERE url LIKE '%irrelevant' OR url LIKE '%pending'")).length,0);
  assert.equal(net.calls.length,0);assert.equal(env.LEARNING_JOBS.jobs.length,0);
  await handler.service.flush(env,'share');await handler.service.flush(env,'bookmarks');
  assert.equal(net.calls.filter(c=>c.url.includes('api.telegram.org')).length,0);

  const list=await (await handler.fetch(request('api/items'),env)).json();
  assert.equal(list.find(i=>i.id===legacy.id).edition,'legacy_digest');
  assert.deepEqual(list.find(i=>i.id===shared.id).origins.split(',').sort(),['official','share']);
  assert.equal((await handler.fetch(new Request('https://learning.example.org/learning/api/items'),env)).status,401);
  assert.equal((await handler.fetch(new Request('https://learning.example.org/learning/api/items/'+legacy.id),env)).status,401);
});

test('正式網址規則造成重複時合併到已整理文章，舊深層連結仍可開啟',async()=>{
  const env=environment(),handler=createLearningHandler(recorder());
  await learningItem(env,'c'.repeat(32),'https://claude.com/blog/agents',{note:'舊連結的筆記'});
  await learningItem(env,'d'.repeat(32),'https://claude.com/resources/articles/agents',{body:null,read:now});
  await migrateLibrary(env);
  const kept=await item(env,'c'.repeat(32));
  assert.equal(kept.url,'https://claude.com/resources/articles/agents');assert.equal(kept.read_at,now);assert.equal(kept.note,'舊連結的筆記');
  assert.equal((await item(env,'d'.repeat(32))).status,'merged');
  const opened=await (await handler.fetch(request('api/items/'+'d'.repeat(32)),env)).json();
  assert.equal(opened.item.id,'c'.repeat(32));assert.equal(opened.requested_id,'d'.repeat(32));
  const list=await (await handler.fetch(request('api/items'),env)).json();
  assert.deepEqual(list.map(i=>i.id),['c'.repeat(32)]);
  // 再次分享舊網址，回到同一篇。
  const again=await (await handler.fetch(request('api/collect','POST',{url:'https://claude.com/blog/agents'}),env)).json();
  assert.equal(again.id,'c'.repeat(32));
});

test('「維運」按鈕把已通知的舊官方導讀搬入文章庫，不呼叫模型也不重送通知；維護排程不搬移',async()=>{
  const env=environment(),net=recorder(),handler=createLearningHandler(net);
  const entry={url:'https://developers.openai.com/blog/new-post'};
  await legacyOfficial(env,entry.url);
  await handler.scheduled(env,{tasks:['maintenance']});
  assert.equal((await rows(env,"SELECT id FROM learning_items WHERE url=?",entry.url)).length,0);
  const ops=()=>handler.fetch(request('api/admin/migrate','POST',{}),env).then(r=>r.json());
  assert.equal((await ops()).imported,1);
  assert.equal((await ops()).imported,0);
  const imported=await rows(env,"SELECT * FROM learning_items WHERE url=?",entry.url);
  assert.equal(imported.length,1);assert.equal(imported[0].edition,'legacy_digest');
  assert.equal(net.calls.filter(c=>c.url.includes('api.telegram.org')).length,0);
  const task=message({kind:'article',id:imported[0].id});
  await handler.queue({messages:[task]},env);
  assert.equal(task.acks,1);assert.equal(net.calls.filter(c=>c.url.includes('generativelanguage')).length,0);
});

test('舊導讀重寫：沒有保存原文時重抓官方原文，Gemini 對純文字多回的觀察不會讓重寫失敗',async()=>{
  const env=environment(),article='# Original title\n\n官方原文：背景、機制、操作與限制。'.repeat(10);
  const net=recorder(async(url,options)=>{
    if(url.hostname==='generativelanguage.googleapis.com'){const sourceId=JSON.parse(JSON.parse(options.body).contents[0].parts.at(-1).text).sources[0].id;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title:'詳細教材',body:'### 背景\n\n完整解說',intro:'導讀',citations:[sourceId],observations:[{source_id:'invented',timestamp:'',description:'不存在的畫面'}]})}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:100}});}
    return null;
  });
  const handler=createLearningHandler({...net,loadArticle:async(source,entry)=>({...entry,content:article,contentMethod:'article_html'})});
  await legacyOfficial(env,'https://developers.openai.com/blog/no-content',{content:null,provider:null,model:null});
  await migrateLibrary(env);
  const legacy=(await rows(env,"SELECT * FROM learning_items WHERE url='https://developers.openai.com/blog/no-content'"))[0];
  assert.equal((await rows(env,'SELECT id FROM learning_evidence WHERE item_id=?',legacy.id)).length,0);
  assert.equal((await handler.fetch(request('api/items/'+legacy.id+'/rewrite','POST',{}),env)).status,202);
  await handler.service.process(env,legacy.id);
  const done=await item(env,legacy.id);
  assert.equal(done.status,'ready',done.last_error);assert.equal(done.edition,'detailed');
  const json=JSON.parse(done.article_json);
  assert.equal(json.provider,'gemini');assert.deepEqual(json.observations,[]);
  assert.doesNotMatch(done.gaps_json,/未保存原文/);
  const status=await (await handler.fetch(request('api/status'),env)).json();
  assert.equal(status.local.text_model,'gemini-3.8-flash');
});

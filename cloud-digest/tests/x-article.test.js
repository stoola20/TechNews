import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningHandler} from '../src/learning/http.js';
import {claim,xArticleUrl} from '../src/learning/local.js';
import {item,rows} from '../src/learning/store.js';
import {normalizePost,postParameters} from '../src/learning/x.js';
import {runOnce,loadConfig} from '../runner/lib.js';
import {environment,recorder} from './helpers.js';

const config=over=>({...loadConfig({TECHNEWS_URL:'https://learning.example.org',TECHNEWS_RUNNER_TOKEN:'runner-test-token',RUNNER_ID:'mac-a'}),...over});
const offlineOllama=async()=>{throw new Error('connection refused');};
function setup(){
  const env={...environment(),LEARNING_RUNNER_TOKEN:'runner-test-token'},generated=[];
  const handler=createLearningHandler({...recorder(),
    postEvidence:async(env,id)=>({url:'https://x.com/i/status/'+id,relation:'primary',author_id:'9',content:'推薦這篇長文',metadata:{post_id:id,conversation_id:id,references:[],links:['https://x.com/writer/article/555']},media:[]}),
    xRead:async()=>({data:[],meta:{}}),
    generate:async(env,sources)=>{generated.push(sources.map(s=>s.url));return {title:'教材',body:'正文',intro:'導讀',citations:[sources[0].id],observations:[]};},
    sendTelegram:async()=>1});
  const serverFetch=async(url,options)=>handler.fetch(new Request(url,options),env);
  return {env,handler,serverFetch,generated};
}

test('X 長文網址正規化：只接受 x.com／twitter.com 的 article 路徑',()=>{
  assert.equal(xArticleUrl('https://x.com/writer/article/555'),'https://x.com/i/article/555');
  assert.equal(xArticleUrl('https://twitter.com/i/article/7/'),'https://x.com/i/article/7');
  assert.equal(xArticleUrl('https://x.com/writer/status/555'),null);
  assert.equal(xArticleUrl('https://example.org/i/article/1'),null);
});

test('X 長文缺漏排入 Mac 代抓；舊版執行器不領取，支援代抓的執行器在 Ollama 停止時仍可代抓並觸發重新整理',async()=>{
  const s=setup();
  const id=await s.handler.service.collect(s.env,'https://x.com/writer/status/100');
  await s.handler.service.process(s.env,id);
  const first=await item(s.env,id);
  assert.equal(first.status,'partial');assert.match(first.gaps_json,/Mac 代抓/);
  const jobs=await rows(s.env,"SELECT kind,status,input_json FROM learning_jobs WHERE item_id=?",id);
  assert.deepEqual(jobs.map(j=>[j.kind,j.status,JSON.parse(j.input_json).url]),[['fetch_x_article','waiting_local','https://x.com/i/article/555']]);
  // 重複處理不重複排工作
  await s.handler.service.process(s.env,id);
  assert.equal((await rows(s.env,"SELECT id FROM learning_jobs WHERE item_id=?",id)).length,1);

  assert.equal(await claim(s.env,'old-runner',{}),null);
  const fetched=[];
  const result=await runOnce(config(),{serverFetch:s.serverFetch,ollamaFetch:offlineOllama,xFetch:async(cfg,url)=>{fetched.push(url);return {title:'長文標題',content:'長文正文，說明背景、做法與限制。'.repeat(30)};}});
  assert.equal(result.state,'completed');assert.deepEqual(fetched,['https://x.com/i/article/555']);
  const evidence=(await rows(s.env,"SELECT status,content,metadata_json FROM learning_evidence WHERE item_id=? AND url='https://x.com/i/article/555'",id))[0];
  assert.equal(evidence.status,'available');assert.equal(JSON.parse(evidence.metadata_json).content_method,'mac_browser');
  assert.equal((await item(s.env,id)).status,'queued');
  assert.deepEqual(s.env.LEARNING_JOBS.jobs.at(-1),{kind:'article',id});
  await s.handler.service.process(s.env,id);
  const done=await item(s.env,id);
  assert.doesNotMatch(done.gaps_json,/i\/article/);assert.equal(done.revision,first.revision+1);
  assert.ok(s.generated.at(-1).includes('https://x.com/i/article/555'));
});

test('代抓失敗三次後把原因寫回缺漏，提示可手動貼上',async()=>{
  const s=setup();
  const id=await s.handler.service.collect(s.env,'https://x.com/writer/status/101');
  await s.handler.service.process(s.env,id);
  for(let i=0;i<3;i++){
    const result=await runOnce(config(),{serverFetch:s.serverFetch,ollamaFetch:offlineOllama,xFetch:async()=>{throw new Error('頁面沒有取得長文正文');}});
    assert.equal(result.state,'failed');
  }
  assert.equal((await rows(s.env,"SELECT status FROM learning_jobs WHERE item_id=?",id))[0].status,'failed');
  const missing=(await rows(s.env,"SELECT metadata_json FROM learning_evidence WHERE item_id=? AND status='missing'",id))[0];
  assert.match(JSON.parse(missing.metadata_json).error,/Mac 代抓 X 長文失敗.*手動貼上/);
  assert.equal((await item(s.env,id)).status,'partial');
});

// 合成的 X API 回應：貼文連到 X 長文，article 欄位附上長文全文（欄位結構依實測）。
const LONG='長文正文，逐步說明背景、做法、限制與取捨。'.repeat(40);
const articlePost=(id,over={})=>({id,author_id:'9',conversation_id:id,text:'推薦這篇長文 https://t.co/abc',
  entities:{urls:[{url:'https://t.co/abc',expanded_url:'https://x.com/i/article/777',unwound_url:'https://x.com/i/article/777'}]},
  article:{title:'長文標題',preview_text:'摘要',plain_text:LONG,entities:{code:[],urls:[]},media_entities:[]},...over});

test('貼文欄位兩種參數名稱都帶 article',()=>{
  assert.match(postParameters({X_API_FIELDS_STYLE:'post'})['post.fields'],/(^|,)article(,|$)/);
  assert.match(postParameters({X_API_FIELDS_STYLE:'tweet'})['tweet.fields'],/(^|,)article(,|$)/);
});

test('API 附帶長文：連到的長文網址成為獨立來源；沒有長文網址就接在主文後面',()=>{
  const source=normalizePost(articlePost('300'));
  assert.equal(source.content,'推薦這篇長文 https://t.co/abc');
  assert.deepEqual(source.article,{url:'https://x.com/i/article/777',relation:'external',content:LONG,metadata:{title:'長文標題',content_method:'x_api'}});
  const inline=normalizePost(articlePost('301',{entities:{urls:[]}}));
  assert.equal(inline.article,null);assert.match(inline.content,/^推薦這篇長文[\s\S]*# 長文標題\n\n長文正文/);
  assert.equal(normalizePost(articlePost('302',{article:{title:'只有標題'}})).article,null);
});

test('API 已取得長文時不排 Mac 代抓，文章沒有長文缺漏',async()=>{
  const env={...environment(),LEARNING_RUNNER_TOKEN:'runner-test-token'},generated=[];
  const handler=createLearningHandler({...recorder(),
    postEvidence:async(env,id)=>normalizePost(articlePost(id)),
    xRead:async()=>({data:[],meta:{}}),
    generate:async(env,sources)=>{generated.push(sources.map(s=>s.url));return {title:'教材',body:'正文',intro:'導讀',citations:[sources[0].id],observations:[]};},
    sendTelegram:async()=>1});
  const id=await handler.service.collect(env,'https://x.com/writer/status/400');
  await handler.service.process(env,id);
  const done=await item(env,id);
  assert.doesNotMatch(done.gaps_json,/i\/article|Mac 代抓/);
  assert.equal((await rows(env,"SELECT id FROM learning_jobs WHERE item_id=? AND kind='fetch_x_article'",id)).length,0);
  const evidence=(await rows(env,"SELECT status,content,metadata_json FROM learning_evidence WHERE item_id=? AND url='https://x.com/i/article/777'",id))[0];
  assert.equal(evidence.status,'available');assert.equal(evidence.content,LONG);assert.equal(JSON.parse(evidence.metadata_json).content_method,'x_api');
  assert.ok(generated.at(-1).includes('https://x.com/i/article/777'));
});

test('書籤同步帶進來的長文同樣直接成為來源',async()=>{
  const s=setup();
  const source=normalizePost(articlePost('500'));
  const id=await s.handler.service.collect(s.env,source.url,'bookmark','bookmark:500',{source});
  await s.handler.service.process(s.env,id);
  assert.equal((await rows(s.env,"SELECT id FROM learning_jobs WHERE item_id=? AND kind='fetch_x_article'",id)).length,0);
  assert.equal((await rows(s.env,"SELECT status FROM learning_evidence WHERE item_id=? AND url='https://x.com/i/article/777'",id))[0].status,'available');
  assert.doesNotMatch((await item(s.env,id)).gaps_json,/i\/article|Mac 代抓/);
});

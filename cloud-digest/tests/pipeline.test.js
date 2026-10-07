import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, {processEntry,runDigest,initialSeenUrls,sendTelegram} from '../src/index.js';
import {readSettings,saveSettings} from '../src/settings.js';
import {SOURCES} from '../src/sources.js';
function database(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_initial.sql','0002_article_content.sql','0003_settings.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 return {prepare(sql){return {bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...(this.args||[]))||null},async all(){return {results:db.prepare(sql).all(...(this.args||[]))}},async run(){return {meta:db.prepare(sql).run(...(this.args||[]))}}}}};
}
const entry={url:'https://developers.openai.com/blog/test',title:'Test',publishedAt:'2026-10-07',content:null};
const summary={publish:true,reason:'AI tooling',title_zh:'測試',body_zh:'導讀內容。'.repeat(80),provider:'workers_ai',model:'gemma'};
function env(){return {DB:database(),TELEGRAM_BOT_TOKEN:'test',TELEGRAM_CHAT_ID:'test',RUN_TOKEN:'test'}};

test('one successful article produces exactly one Telegram send and persists full input',async()=>{
 const e=env();let sent=0;
 const deps={loadArticle:async(s,a)=>({...a,content:'Complete input',contentMethod:'article_html'}),summarize:async()=>summary,sendTelegram:async(e,text)=>{sent++;assert.match(text,/導讀內容/);return 7}};
 assert.equal(await processEntry(e,SOURCES[0],entry,deps),'notified');
 assert.equal(await processEntry(e,SOURCES[0],entry,deps),'already');assert.equal(sent,1);
 const row=await e.DB.prepare('SELECT * FROM articles').first();assert.equal(row.content,'Complete input');assert.equal(row.full_message_id,7);assert.equal(row.alert_message_id,null);
});
test('failed delivery reuses a saved digest; irrelevant articles retain reasons without sending',async()=>{
 const e=env();let generated=0;
 const deps={loadArticle:async(s,a)=>({...a,content:'Complete input',contentMethod:'article_html'}),summarize:async()=>{generated++;return summary},sendTelegram:async()=>{throw Error('network')}};
 await assert.rejects(processEntry(e,SOURCES[0],entry,deps),/network/);
 assert.equal(await processEntry(e,SOURCES[0],entry,{...deps,sendTelegram:async()=>8}),'notified');assert.equal(generated,1);
 const other={...entry,url:'https://developers.openai.com/blog/business'};
 assert.equal(await processEntry(e,SOURCES[0],other,{...deps,summarize:async()=>({...summary,publish:false,reason:'Only business news',body_zh:''})}),'skipped');
 assert.equal((await e.DB.prepare('SELECT status FROM articles WHERE source_url = ?').bind(other.url).first()).status,'skipped');
});
test('a locked article remains retryable instead of being marked seen',async()=>{
 const e=env();const now=new Date().toISOString();
 await e.DB.prepare("INSERT INTO articles(source_url,source,title,status,lease_until,created_at,updated_at)VALUES(?,?,?,'pending',?,?,?)").bind(entry.url,SOURCES[0].id,'Test','2099-01-01',now,now).run();
 assert.equal(await processEntry(e,SOURCES[0],entry),'busy');
});
test('runtime JSON settings switch models without exposing secrets',async()=>{
 const e=env();assert.equal((await readSettings(e)).model_profile,'gemma4');
 await saveSettings(e,{model_profile:'nemotron3',interests:'Agents',sources:[SOURCES[0]]});assert.equal((await readSettings(e)).model_profile,'nemotron3');
 await assert.rejects(saveSettings(e,{model_profile:'gpt_terra',interests:'Agents',sources:[SOURCES[0]]}),/secret/);
 const response=await worker.fetch(new Request('https://example.test/config',{headers:{authorization:'Bearer test'}}),e);
 const body=await response.json();assert.equal(body.settings.model_profile,'nemotron3');assert.ok(!JSON.stringify(body).includes('TELEGRAM_BOT_TOKEN'));
 assert.equal((await worker.fetch(new Request('https://example.test/config'),e)).status,404);
 assert.equal((await worker.fetch(new Request('https://example.test/settings'),e)).status,200);
});
test('new sources backfill recent articles but checkpoint older entries',()=>{
 assert.deepEqual(initialSeenUrls([{url:'new',publishedAt:'2026-10-01'},{url:'old',publishedAt:'2026-01-01'}],Date.parse('2026-10-07')),['old']);
});
test('batch cap defers unseen articles rather than dropping them',async()=>{
 const e=env();await saveSettings(e,{model_profile:'gemma4',interests:'Agents',sources:[SOURCES[0]]});
 const entries=Array.from({length:8},(_,i)=>({...entry,url:entry.url+i}));
 const result=await runDigest(e,{discoverSource:async()=>entries,processEntry:async()=> 'notified'});
 assert.equal(result.notified,6);assert.equal(result.deferred,2);
 const state=await e.DB.prepare('SELECT seen_urls_json FROM source_state').first();assert.equal(JSON.parse(state.seen_urls_json).length,6);
});
test('single message has notifications enabled and rejects overlong text',async()=>{
 let body;const id=await sendTelegram(env(),'Article',async(url,options)=>{body=JSON.parse(options.body);return Response.json({ok:true,result:{message_id:9}})});
 assert.equal(id,9);assert.equal(body.disable_notification,false);
 await assert.rejects(sendTelegram(env(),'文'.repeat(4097)),/length/);
});

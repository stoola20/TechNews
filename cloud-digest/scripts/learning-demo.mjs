import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createLearningHandler} from '../src/learning/http.js';

// 此入口僅提供本機操作驗證，不讀取任何真實金鑰或呼叫外部服務。
const sqlite=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
const DB={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...(this.args || [])) || null;},async all(){return {results:sqlite.prepare(sql).all(...(this.args || []))};},async run(){return {meta:sqlite.prepare(sql).run(...(this.args || []))};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const samples={
  'video-input':{title:'原生影片輸入與自行前處理',content:'原生影片輸入表示 API 可以接收影片檔，不表示模型會連續看完每一幀。服務仍會取樣畫面並處理音訊。\n\n自行前處理則由應用程式取畫面、轉錄音訊並提供時間對應。好處是可以明確保存證據，代價是取樣與音畫對齊需要自己維護。\n\n例如講者說「打開這個選項」，畫面才顯示選項名稱；只讀逐字稿會漏掉操作細節。快速閃過的錯誤訊息可能被兩種取樣方式漏掉。'},
  'background-jobs':{title:'背景工作如何在失敗後繼續處理',content:'收件先持續保存於資料庫，再交給背景佇列處理。佇列負責喚醒，資料庫保存來源、處理階段與已生成文章。\n\n通知失敗時，重送已保存的結果，避免再付一次生成費用。來源取得失敗時則保留工作與缺漏，不把不完整內容寫成完整事實。\n\n預算用完後停止新的付費工作，收藏仍保留；即使跨月，也要等使用者手動恢復。'},
};
const env={DB,RUN_TOKEN:'demo-only',LEARNING_ENABLED:'true',LEARNING_DEMO:'true',PUBLIC_BASE_URL:'https://example.org',LEARNING_MONTHLY_USD:'30'};
const handler=createLearningHandler({
  postEvidence:async(env,id)=>({url:'https://x.com/i/status/'+id,relation:'primary',author_id:'demo',content:'這是本機 X 收件操作示範，未讀取這個網址的真實貼文。正式環境會取得來源與媒體，再交給 Gemini 整理。',metadata:{title:'本機 X 分享示範',author_username:'demo_author',post_id:id,conversation_id:id,references:[],links:[]},media:[]}),
  xRead:async()=>({data:[],meta:{}}),
  webEvidence:async url=>{const sample=samples[new URL(url).pathname.slice(1)] || {title:'本機分享示範',content:'這是本機操作測試來源。正式環境會取得原文，再由 Gemini 整理教材。'};return {url,relation:'primary',content:sample.content,metadata:{title:sample.title},media:[]};},
  prepareMedia:async()=>({pending:false,media:[],gaps:[]}),
  generate:async(env,sources,media,gaps,question)=>question?{answer:'本機測試回答：\n'+sources[0].content.slice(0,500),citations:[sources[0].id],insufficient:false}:{title:JSON.parse(sources[0].metadata_json || '{}').title || '本機教材',body:sources.map(s=>s.content).join('\n\n'),intro:'本機操作驗證示範，未呼叫外部模型。',citations:sources.map(s=>s.id),observations:[]},
  sendTelegram:async()=>1,
});
const jobs=[];env.LEARNING_JOBS={async send(job){jobs.push(job);}};
for(const key of Object.keys(samples)){const id=await handler.service.collect(env,'https://example.org/'+key);await handler.service.process(env,id);}
const server=createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>64000)throw Error('Request too large');}
    const data=Buffer.concat(chunks);
    const request=new Request('http://localhost:8788'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:data}:{} )});
    const response=await handler.fetch(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    while(jobs.length){const job=jobs.shift();try{if(job.kind==='article')await handler.service.process(env,job.id);}catch{console.log('本機背景工作已保留，請查看處理狀態。');}}
  }catch(error){if(!res.headersSent){res.writeHead(500,{'content-type':'text/plain'});res.end('本機測試處理失敗');}}
});
server.listen(8788,'127.0.0.1',()=>console.log('本機測試：http://localhost:8788/learning；示範登入：demo-only。所有資料與回應為測試素材。'));

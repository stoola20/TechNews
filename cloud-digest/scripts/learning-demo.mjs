import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createLearningHandler} from '../src/learning/http.js';
import {setTextProvider} from '../src/learning/local.js';
import {SOURCES} from '../src/sources.js';

// 此入口僅提供本機操作驗證，不讀取任何真實金鑰或呼叫外部服務。
const sqlite=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
const DB={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...(this.args || [])) || null;},async all(){return {results:sqlite.prepare(sql).all(...(this.args || []))};},async run(){return {meta:sqlite.prepare(sql).run(...(this.args || []))};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const samples={
  'video-input':{title:'原生影片輸入與自行前處理',content:'原生影片輸入表示 API 可以接收影片檔，不表示模型會連續看完每一幀。服務仍會取樣畫面並處理音訊。\n\n自行前處理則由應用程式取畫面、轉錄音訊並提供時間對應。好處是可以明確保存證據，代價是取樣與音畫對齊需要自己維護。\n\n例如講者說「打開這個選項」，畫面才顯示選項名稱；只讀逐字稿會漏掉操作細節。快速閃過的錯誤訊息可能被兩種取樣方式漏掉。'},
  'code-and-table':{title:'設定檔欄位與重試參數',content:'設定檔使用 JSON。以下範例設定最大重試次數與逾時：\n\n```json\n{"max_retries": 3, "timeout_ms": 120000, "backoff": "exponential", "very_long_field_name_to_test_horizontal_scrolling_inside_code_blocks": true}\n```\n\n| 欄位 | 預設值 | 說明 | 適用版本 | 備註與限制條件（測試寬表格的水平捲動） |\n|---|---|---|---|---|\n| max_retries | 3 | 最多重試次數 | 2.1 以上 | 超過後標為需要處理，不會無限重試 |\n| timeout_ms | 120000 | 單次逾時 | 2.3 以上 | 長文生成可能需要提高 |\n\n限制：2.0 以前的版本不支援 backoff 欄位。'},
  'background-jobs':{title:'背景工作如何在失敗後繼續處理',content:'收件先持續保存於資料庫，再交給背景佇列處理。佇列負責喚醒，資料庫保存來源、處理階段與已生成文章。\n\n通知失敗時，重送已保存的結果，避免再付一次生成費用。來源取得失敗時則保留工作與缺漏，不把不完整內容寫成完整事實。\n\n預算用完後停止新的付費工作，收藏仍保留；即使跨月，也要等使用者手動恢復。'},
};
const env={DB,RUN_TOKEN:'demo-only',LEARNING_RUNNER_TOKEN:'demo-runner',LEARNING_DEMO:'true',PUBLIC_BASE_URL:'https://example.org',LEARNING_MONTHLY_USD:'30'};
// DEMO_LOCAL=1：文字工作交給本機執行器（runner/runner.mjs，TECHNEWS_RUNNER_TOKEN=demo-runner）。
if(process.env.DEMO_LOCAL==='1')await setTextProvider(env,'local');
// 官方來源示範：每個來源一篇新文章、一篇太舊的文章；Anthropic Engineering 模擬被網站擋下。網址與內容都是測試素材。
const DAY=86400000,demoUrl=(source,slug)=>source.id==='apple_developer_news'?'https://developer.apple.com/news/?id='+slug:'https://'+source.host+'/'+source.paths[0]+'/'+slug;
const handler=createLearningHandler({
  discoverSource:async source=>{
    if(source.id==='anthropic_engineering')throw new Error('Source HTTP 403');
    return [{url:demoUrl(source,'demo-new'),title:source.name+' 示範新文章',publishedAt:new Date(Date.now()-DAY).toISOString(),content:null},
      {url:demoUrl(source,'demo-old'),title:source.name+' 示範舊文章',publishedAt:new Date(Date.now()-40*DAY).toISOString(),content:null}];
  },
  loadArticle:async(source,entry)=>({...entry,title:entry.title || '官方來源示範',content:'這是本機官方來源示範，未讀取真實文章。正式環境會擷取官方原文全文。'.repeat(4),contentMethod:'article_html'}),
  postEvidence:async(env,id)=>({url:'https://x.com/i/status/'+id,relation:'primary',author_id:'demo',content:'這是本機 X 收件操作示範，未讀取這個網址的真實貼文。正式環境會取得來源與媒體，再交給 Gemini 整理。',metadata:{title:'本機 X 分享示範',author_username:'demo_author',post_id:id,conversation_id:id,references:[],links:[]},media:[]}),
  xRead:async()=>({data:[],meta:{}}),
  webEvidence:async url=>{const sample=samples[new URL(url).pathname.slice(1)] || {title:'本機分享示範',content:'這是本機操作測試來源。正式環境會取得原文，再由 Gemini 整理教材。'};return {url,relation:'primary',content:sample.content,metadata:{title:sample.title},media:[]};},
  prepareMedia:async()=>({pending:false,media:[],gaps:[]}),
  generate:async(env,sources,media,gaps,question)=>question?{answer:'本機測試回答：\n'+sources[0].content.slice(0,500),citations:[sources[0].id],insufficient:false}:{title:JSON.parse(sources[0].metadata_json || '{}').title || '本機教材',body:sources.map(s=>s.content).join('\n\n'),intro:'本機操作驗證示範，未呼叫外部模型。',citations:sources.map(s=>s.id),observations:[]},
  sendTelegram:async()=>1,
});
const port=Number(process.env.DEMO_PORT || 8788);
const jobs=[];env.LEARNING_JOBS={async send(job){jobs.push(job);}};
for(const key of Object.keys(samples)){const id=await handler.service.collect(env,'https://example.org/'+key);await handler.service.process(env,id);}
// 來源已在先前初始化，這一輪才會出現「收件」與「太舊略過」。
for(const source of SOURCES)sqlite.prepare("INSERT INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES(?,?,?,'[]')").run(source.id,new Date(Date.now()-30*DAY).toISOString(),new Date(Date.now()-DAY).toISOString());
await handler.service.official(env);
for(const job of jobs.splice(0))if(job.kind==='article')await handler.service.process(env,job.id);
// 其他狀態：搬移前的官方短導讀、等待本機、需要處理與來源缺漏，讓列表與篩選都有資料可看。
const time=new Date().toISOString();
DB.prepare("INSERT INTO articles(source_url,source,title,published_at,status,summary_json,content,content_method,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind('https://developers.openai.com/blog/demo-legacy','openai_developer_blog','Legacy demo','2026-10-01','notified',JSON.stringify({title_zh:'舊官方短導讀示範',body_zh:'這是搬移前只有短導讀的官方文章，沒有保存模型資訊。'}),'官方原文示範內容。'.repeat(20),'article_html',time,time).run();
await handler.service.migrate(env);
const states=[['waiting','等待本機處理的示範','waiting_local','[]',null],['attention','需要處理的示範','needs_attention','[]','本機模型輸出三次都未通過格式檢查'],['partial','來源有缺漏的示範','partial','[{"url":"https://x.com/i/status/1","error":"父貼文無法取得"},{"url":"https://example.org/linked-article","error":"直接外連文章無法取得"}]',null]];
for(const [key,title,status,gaps,error] of states){
  const id=await handler.service.collect(env,'https://example.org/state-'+key);
  await DB.prepare("UPDATE learning_items SET title=?,status=?,gaps_json=?,last_error=?,body=?,article_json=? WHERE id=?").bind(title,status,gaps,error,status==='partial'?'## 已整理的部分\n\n父貼文缺漏，以下只根據主貼文整理。':null,status==='partial'?JSON.stringify({provider:'demo',model:'demo',intro:'示範',observations:[]}):null,id).run();
}
// 媒體示範：主貼文與作者補充各有一支影片，說明緊接各自影片；外部頁面的 logo 不顯示、不算缺漏。
{
  const id=await handler.service.collect(env,'https://example.org/state-media');
  await DB.prepare("INSERT INTO learning_evidence(id,item_id,url,relation,content,metadata_json,status,fetched_at) VALUES('demo-main',?,'https://example.org/state-media','primary','主貼文示範內容','{}','available',?),('demo-post',?,'https://example.org/state-media/reply','author_reply','作者補充的示範貼文','{}','available',?),('demo-page',?,'https://example.org/extension','external','外部頁面示範內容','{}','available',?)").bind(id,time,id,time,id,time).run();
  const media=[['demo-v1','demo-main','https://video.example.org/one.mp4','video'],['demo-v2','demo-post','https://video.example.org/two.mp4','video'],['demo-logo','demo-page','https://cdn.example.org/brand/logo.svg','photo']];
  for(const [mid,evidence,url,type] of media)await DB.prepare("INSERT INTO learning_media(id,item_id,evidence_id,url,type,duration_ms,status,error,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(mid,id,evidence,url,type,type==='video'?40000:null,type==='video'?'expired':'needs_attention',type==='video'?'原始媒體已超過 30 天保存期限':'媒體格式不支援',time).run();
  const observations=[['demo-v1','00:01','標題畫面說明這個功能的用途。'],['demo-v1','00:14','狀態列顯示正在讀取已開啟的分頁。'],['demo-v2','00:03','第二支影片示範在分頁中直接提問。']].map(([mid,timestamp,description])=>({source_id:media.find(m=>m[0]===mid)[1],media_id:mid,timestamp,description}));
  await DB.prepare("UPDATE learning_items SET title=?,status='partial',body=?,article_json=?,gaps_json=? WHERE id=?").bind('兩支影片與逐段說明的示範','## 教材\n\n影片的逐段說明會緊接在各自影片下方。',JSON.stringify({provider:'demo',model:'demo',intro:'示範',observations}),JSON.stringify([{id:'demo-logo',url:'https://cdn.example.org/brand/logo.svg',error:'媒體格式不支援'}]),id).run();
}
// 外連文章取不到時，可在文章頁手動貼上原文。
{const partial=await DB.prepare("SELECT id FROM learning_items WHERE url='https://example.org/state-partial'").first();
  await DB.prepare("INSERT INTO learning_evidence(id,item_id,url,relation,content,metadata_json,status,fetched_at) VALUES('demo-missing',?,'https://example.org/linked-article','external','',?,'missing',?)").bind(partial.id,JSON.stringify({error:'直接外連文章無法取得'}),time).run();}
// 時間軸示範：不同發表日期、發布者與已讀狀態的文章，數量超過一批（50 篇）以便測試日期分組與捲到底載入更多。
{
  const hosts=['blog.example.org','docs.example.com','news.example.net'],base=Date.now();
  for(let n=1;n<=60;n++){
    const id=('t'+String(n).padStart(3,'0')).padEnd(32,'0').replace(/t/,'f'),published=new Date(base-(n*7+3)*3600e3).toISOString();
    const url='https://'+hosts[n%3]+'/posts/'+n,created=new Date(base-(n%5)*3600e3).toISOString();
    // 主題依序輪替，每 9 篇留一篇未分類，每 4 篇加一個次要主題。
    const topics=['models','ai-coding','agent-engineering','product-updates','apple','safety-policy','enterprise'],primary=n%9?topics[n%7]:null,secondary=primary&&n%4===0?topics[(n+2)%7]:null;
    await DB.prepare("INSERT INTO learning_items(id,url,kind,title,status,body,article_json,revision,read_at,published_at,topic_primary,topic_secondary,topic_source,topic_revision,created_at,updated_at) VALUES(?,?,'web',?,'ready','## 示範\n\n時間軸示範內容。','{}',1,?,?,?,?,?,1,?,?)")
      .bind(id,url,'時間軸示範文章 '+n+'：'+['模型更新與 API 變更','Agent 工具的工程實踐','平台政策與審查規範'][n%3],n%4?time:null,n%11?published:null,primary,secondary,primary?'model':null,created,created).run();
  }
}
jobs.length=0;
for(const suffix of ['keep','remove'])await handler.service.collect(env,'https://example.org/awaiting-'+suffix,'backfill','demo:'+suffix,{defer:true,source:{url:'https://example.org/awaiting-'+suffix,relation:'primary',content:'等待你確認的原始收藏 '+suffix+'。\n\n先讀原文，再決定是否使用模型整理。',metadata:{title:'待回補原文'},media:[]}});
const server=createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>1100000)throw Error('Request too large');}
    const data=Buffer.concat(chunks);
    const request=new Request(`http://localhost:${port}`+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:data}:{} )});
    const response=await handler.fetch(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    while(jobs.length){const job=jobs.shift();try{if(job.kind==='article')await handler.service.process(env,job.id);}catch{console.log('本機背景工作已保留，請查看處理狀態。');}}
  }catch(error){if(!res.headersSent){res.writeHead(500,{'content-type':'text/plain'});res.end('本機測試處理失敗');}}
});
server.listen(port,'127.0.0.1',()=>console.log(`本機測試：http://localhost:${port}/learning；示範登入：demo-only。所有資料與回應為測試素材。`));

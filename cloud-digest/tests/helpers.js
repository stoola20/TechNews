import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

// 真實 SQLite schema：依序套用全部 migration，與 D1 binding 介面相同。
// 本機 SQLite 允許上萬個綁定參數，D1 單一查詢最多 100 個；超過時照 D1 的方式丟錯，避免測試過了、正式環境才失敗。
const D1_MAX_VARIABLES=100;
export function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  return {sqlite,prepare(sql){return {sql,args:[],bind(...args){if(args.length>D1_MAX_VARIABLES)throw new Error('D1_ERROR: too many SQL variables: SQLITE_ERROR');this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){return {meta:sqlite.prepare(sql).run(...this.args)};}};},
    async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
export function mediaStore(){const objects=new Map();return {objects,async put(key,stream,options){const bytes=new Uint8Array(await new Response(stream).arrayBuffer());objects.set(key,{bytes,options});},async get(key){const value=objects.get(key);return value?{body:new Response(value.bytes).body,size:value.bytes.length}:null;},async delete(key){objects.delete(key);}};}
export function environment(extra={}){
  const jobs=[];
  return {DB:database(),RUN_TOKEN:'private-test-token',GEMINI_API_KEY:'gemini-test-secret',PUBLIC_BASE_URL:'https://learning.example.org',
    LEARNING_MONTHLY_USD:'30',LEARNING_BASE_USD:'0',MEDIA:mediaStore(),LEARNING_JOBS:{jobs,async send(job){jobs.push(job);}},TELEGRAM_BOT_TOKEN:'telegram-test',TELEGRAM_CHAT_ID:'-1001',
    TELEGRAM_WEBHOOK_SECRET:'webhook-test',TELEGRAM_ALLOWED_CHAT_IDS:'42',X_CLIENT_ID:'x-client',X_CLIENT_SECRET:'x-secret',X_APP_OWNER_ID:'7',...extra};
}
// 任何未預期的外部呼叫都會讓測試失敗，並記錄呼叫供斷言。
export function recorder(handler=async()=>null){
  const calls=[];
  async function fetcher(value,options={}){
    const url=new URL(value);calls.push({url:url.href,options});
    const result=await handler(url,options,calls);
    if(result)return result;
    if(url.hostname==='cloudflare-dns.com')return Response.json({Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.216.34'}]:[]});
    if(url.hostname==='api.telegram.org')return Response.json({ok:true,result:{message_id:calls.length}});
    throw Error('Unexpected test network call: '+url.href);
  }
  return {fetcher,calls};
}
export function request(path,method='GET',data=null,headers={}){return new Request('https://learning.example.org/learning/'+path,{method,headers:{authorization:'Bearer private-test-token','content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});}
export function message(body){return {body,acks:0,retries:0,ack(){this.acks++;},retry(options){this.retries++;this.retryOptions=options;}};}
export const iso=offset=>new Date(Date.now()+offset).toISOString();
// X 書籤同步與作者重查預設關閉；測試同步行為時先打開。
export async function enableXReads(env,value={bookmarks:true,author_recheck:true}){
  await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value_json,updated_at) VALUES('learning:x-reads',?,?)").bind(JSON.stringify(value),new Date().toISOString()).run();
}

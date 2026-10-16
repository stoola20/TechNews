#!/usr/bin/env node
// 代表素材驗收：以真實本機 Ollama 跑合成素材，套用 Worker 的驗證規則並記錄品質檢查與效能。
// 用法：node scripts/acceptance.mjs [--ctx 32768] [--predict 8192] [--only id1,id2] [--out 目錄]
// 結果包含模型輸出全文，預設寫到系統暫存目錄；只把摘要整理進公開文件。
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadConfig,generate,ollamaInfo} from '../runner/lib.js';
import {validateArticle,validateAnswer} from '../src/learning/local-prompt.js';
import {SAMPLES,MAINLAND_TERMS} from '../acceptance/samples.js';

const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const config=loadConfig({...process.env,TECHNEWS_URL:'http://localhost:1',TECHNEWS_RUNNER_TOKEN:'acceptance',OLLAMA_NUM_CTX:arg('--ctx',process.env.OLLAMA_NUM_CTX || '32768'),OLLAMA_NUM_PREDICT:arg('--predict',process.env.OLLAMA_NUM_PREDICT || '8192')});
const only=arg('--only','')?.split(',').filter(Boolean);
const out=arg('--out',join(tmpdir(),'technews-acceptance'));
mkdirSync(out,{recursive:true});

const sh=(cmd,list)=>{try{return execFileSync(cmd,list,{encoding:'utf8'});}catch{return '';}};
// Ollama 相關程序的常駐記憶體（RSS，MB）。MLX runner 的 GPU 記憶體屬於統一記憶體，會反映在這裡。
function ollamaRssMb(){return Math.round(sh('ps',['-axo','rss=,comm=']).split('\n').filter(l=>/ollama/i.test(l)).reduce((n,l)=>n+Number(l.trim().split(/\s+/)[0] || 0),0)/1024);}
function systemMemory(){
  const free=Number((sh('memory_pressure',[]).match(/free percentage: (\d+)%/) || [])[1]);
  const swap=(sh('sysctl',['-n','vm.swapusage']).match(/used = ([\d.]+)M/) || [])[1];
  return {free_percent:Number.isFinite(free)?free:null,swap_used_mb:swap?Number(swap):null};
}
async function unload(){await fetch(`${config.ollamaUrl}/api/generate`,{method:'POST',body:JSON.stringify({model:config.model,keep_alive:0})}).catch(()=>{});await new Promise(r=>setTimeout(r,3000));}

function check(sample,result){
  const problems=[],notes=[];
  const c=sample.checks,o=result.output;
  if(!o){problems.push('沒有可解析的輸出');return {problems,notes};}
  let validated;
  try{validated=sample.kind==='question'?validateAnswer(sample.input,o):validateArticle(sample.input,o);}catch(error){problems.push('Worker 驗證失敗：'+error.message);}
  if(sample.kind==='article'){
    if(c.publish!=null&&o.publish!==undefined&&o.publish!==c.publish)problems.push(`主題判斷應為 ${c.publish}，實際為 ${o.publish}`);
    if(c.publish===false)return {problems,notes,validated};
  }else if(c.insufficient!=null&&o.insufficient!==c.insufficient)problems.push(`不足判斷應為 ${c.insufficient}，實際為 ${o.insufficient}`);
  const text=sample.kind==='question'?o.answer:`${o.title}\n${o.intro}\n${o.body}`;
  for(const pattern of c.must || [])if(!pattern.test(text))problems.push('缺少：'+pattern);
  for(const pattern of c.mustNot || [])if(pattern.test(text))problems.push('不應出現：'+pattern);
  for(const ref of c.cite || [])if(!o.citations.includes(ref))problems.push('沒有引用 '+ref);
  if(c.minBody&&o.body.length<c.minBody)problems.push(`正文 ${o.body.length} 字，低於 ${c.minBody}`);
  if(c.maxBody&&o.body.length>c.maxBody)notes.push(`短公告正文 ${o.body.length} 字，偏長`);
  const terms=[...new Set(text.match(MAINLAND_TERMS) || [])];
  if(terms.length)notes.push('非台灣用語待檢查：'+terms.join('、'));
  return {problems,notes,validated};
}

const info=await ollamaInfo(config);
if(!info.ollama || !info.installed){console.error('Ollama 無法連線或模型未安裝');process.exit(1);}
const report={started_at:new Date().toISOString(),model:config.model,model_digest:info.model_digest,num_ctx:config.numCtx,num_predict:config.numPredict,results:[]};
console.log(JSON.stringify({event:'acceptance_started',model:config.model,num_ctx:config.numCtx,num_predict:config.numPredict}));
await unload();
const idle={rss_mb:ollamaRssMb(),...systemMemory()};
let first=true;
for(const sample of SAMPLES.filter(s=>!only?.length || only.includes(s.id))){
  let peak=0,minFree=100;
  const timer=setInterval(()=>{peak=Math.max(peak,ollamaRssMb());const m=systemMemory();if(m.free_percent!=null)minFree=Math.min(minFree,m.free_percent);},1000);
  const started=Date.now();
  let result,error=null;
  try{result=await generate(config,{id:sample.id,kind:sample.kind,input:sample.input});}
  catch(e){error=e.message;result={output:null,metrics:{},model:{},raw:e.raw || null};}
  clearInterval(timer);
  peak=Math.max(peak,ollamaRssMb());
  // 超長素材在 context 不足時應拒絕且不截短；這是預期結果。
  const expectedRefusal=error&&sample.checks.refuseBelowCtx&&config.numCtx<sample.checks.refuseBelowCtx&&/未截短/.test(error);
  const verdict=expectedRefusal?{problems:[],notes:['依預期拒絕：'+error]}:error?{problems:['執行失敗：'+error],notes:[]}:check(sample,result);
  if(!error&&sample.checks.refuseBelowCtx&&config.numCtx<sample.checks.refuseBelowCtx)verdict.problems.push('context 不足卻沒有拒絕');
  const row={id:sample.id,kind:sample.kind,description:sample.description,cold:first,wall_ms:Date.now()-started,metrics:result.metrics,done_reason:result.model?.done_reason,
    peak_ollama_rss_mb:peak,min_free_percent:minFree,body_chars:result.output?.body?.length ?? result.output?.answer?.length ?? 0,passed:!verdict.problems.length,problems:verdict.problems,notes:verdict.notes,output:result.output,raw:result.raw};
  first=false;report.results.push(row);
  console.log(JSON.stringify({event:'sample',id:row.id,passed:row.passed,cold:row.cold,wall_ms:row.wall_ms,prompt_tokens:row.metrics.prompt_tokens,output_tokens:row.metrics.output_tokens,load_ms:Math.round(row.metrics.load_ms || 0),peak_rss_mb:peak,min_free:minFree,problems:row.problems,notes:row.notes}));
}
report.idle=idle;report.finished_at=new Date().toISOString();report.swap_after=systemMemory();report.ollama_ps=sh('ollama',['ps']).trim();
console.log(JSON.stringify({event:'ollama_ps',value:report.ollama_ps}));
const file=join(out,`acceptance-${config.numCtx}-${Date.now()}.json`);
writeFileSync(file,JSON.stringify(report,null,2));
const failed=report.results.filter(r=>!r.passed).length;
console.log(JSON.stringify({event:'acceptance_finished',total:report.results.length,failed,file}));
process.exit(failed?2:0);

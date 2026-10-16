#!/usr/bin/env node
// Mac 本機文字執行器：主動向文章庫領取工作，以本機 Ollama 生成後回報。
// 用法：node --env-file=<設定檔> runner/runner.mjs [--once|--check]
import {loadConfig,runOnce,ollamaInfo,serverClient,RUNNER_VERSION} from './lib.js';

const log=event=>console.log(JSON.stringify({time:new Date().toISOString(),...event}));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function check(config){
  const info={...await ollamaInfo(config),version:RUNNER_VERSION};
  log({event:'check_ollama',ollama:info.ollama,model:config.model,installed:info.installed,model_digest:info.model_digest});
  if(!info.ollama || !info.installed){log({event:'check_failed',reason:info.ollama?'model_missing':'ollama_unreachable'});return 1;}
  try{await serverClient(config)('heartbeat',{info:{...info,state:'check'}});log({event:'check_server',ok:true});}
  catch(error){log({event:'check_failed',reason:'server',error:error.message});return 1;}
  return 0;
}

async function main(){
  const config=loadConfig();
  const args=new Set(process.argv.slice(2));
  if(args.has('--check'))process.exit(await check(config));
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;log({event:'stopping',signal});});
  log({event:'runner_started',version:RUNNER_VERSION,model:config.model,num_ctx:config.numCtx,num_predict:config.numPredict});
  let backoff=config.pollMs;
  while(!stopping){
    let result;
    try{result=await runOnce(config,{log});backoff=config.pollMs;}
    catch(error){
      // 文章庫或網路暫時不可用：保留狀態，逐步拉長重試間隔。
      log({event:'runner_error',error:error.message});backoff=Math.min(backoff*2,300000);result={state:'error'};
    }
    if(args.has('--once'))break;
    if(result.state==='completed' || result.state==='failed')continue;
    await wait(result.state==='error' || result.state==='ollama_unavailable'?backoff:config.pollMs);
  }
}

main().catch(error=>{log({event:'runner_fatal',error:error.message});process.exit(1);});

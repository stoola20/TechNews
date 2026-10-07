import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, modelConfiguration } from '../src/models.js';
import { applySettings, MODEL_PROFILES } from '../src/settings.js';
const source = { name: 'claude.dev' };
const entry = { title:'Tutorial',url:'https://claude.dev/blog/tutorial',publishedAt:'2026-10-01',content:'BODY START '+ 'Article content. '.repeat(3000) +' BODY END',contentMethod:'official_markdown' };
const digest={publish:true,reason:'Developer tutorial',title_zh:'模組怎麼運作',body_zh:'事件會先通過已註冊的 hook，再進入其他模組與內建流程。開發者可以傳遞輸入、改寫輸入或直接回覆。'.repeat(5)};

test('Gemma and Nemotron share the complete input and normalized output interface', async () => {
  const calls=[];
  const base={AI:{async run(model,input){calls.push({model,input});return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(digest)}}]}}}};
  for(const profile of ['gemma4','nemotron3']){
    const env=applySettings(base,{model_profile:profile,interests:'AI tooling',sources:[]});
    const result=await summarize(env,source,entry);
    assert.equal(result.model,MODEL_PROFILES[profile].model);
    assert.equal(result.body_zh,digest.body_zh);
  }
  assert.equal(calls[0].input.messages[1].content,calls[1].input.messages[1].content);
  assert.ok(calls[0].input.messages[1].content.includes('BODY END'));
  assert.deepEqual(calls[1].input.chat_template_kwargs,{enable_thinking:false});
  assert.throws(()=>modelConfiguration({SUMMARY_PROVIDER:'workers_ai',SUMMARY_MODEL:'@cf/qwen/anything'}),/must be/);
});
test('OpenAI uses Responses API and incomplete outputs never reach Telegram', async () => {
  let request;
  const fetcher=async(url,options)=>{request={url,...JSON.parse(options.body)};return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(digest)}]}]})};
  const result=await summarize({SUMMARY_PROVIDER:'openai',OPENAI_API_KEY:'test'},source,entry,fetcher);
  assert.equal(result.model,'gpt-5.6-terra');assert.equal(request.store,false);assert.ok(request.input.includes('BODY END'));
  await assert.rejects(summarize({SUMMARY_PROVIDER:'openai',OPENAI_API_KEY:'test'},source,entry,async()=>Response.json({status:'incomplete',output:[]})),/incomplete/);
});
test('overlong output is edited once without truncating source content',async()=>{
  const prompts=[];const env={AI:{async run(model,input){prompts.push(input.messages[1].content);return {response:{...digest,body_zh:prompts.length===1?'文'.repeat(5000):digest.body_zh}}}}};
  await summarize(env,source,entry);assert.equal(prompts.length,2);assert.ok(prompts.every(p=>p.includes('BODY END')));
});

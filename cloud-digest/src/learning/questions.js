import {query,rows,nowIso,hash} from './store.js';
import {generate} from './gemini.js';
import {textProvider,ensureJob,PRIORITY,localModel,fail,JobConflict} from './local.js';
import {QUESTION_PROMPT_VERSION,validateAnswer} from './local-prompt.js';
import {normalizeMarkdown,renderMarkdown} from './markdown.js';

const INSUFFICIENT='目前沒有找到足夠的已保存來源，無法確認。請提供更具體的關鍵字或選擇文章。';

function keywords(question){
  return [...new Set([...new Intl.Segmenter('zh-TW',{granularity:'word'}).segment(question)].filter(s=>s.isWordLike&&s.segment.length>=2).map(s=>s.segment.toLowerCase()))].slice(0,12);
}

// 沿用 D1 關鍵字檢索：已保存原文片段、媒體證據與舊版媒體觀察都有穩定引用身分。
export async function retrieve(env,question,articleId=null){
  const terms=keywords(question);
  const rank=column=>terms.length?terms.map(()=>`CASE WHEN instr(lower(${column}),?)>0 THEN 1 ELSE 0 END`).join('+'):'0';
  const selected=await rows(env,`SELECT e.id,e.item_id,e.url,e.relation,e.author_id,e.published_at,(${rank('e.content')}) AS score FROM learning_evidence e JOIN learning_items a ON a.id=e.item_id
    WHERE e.status='available' AND a.body IS NOT NULL AND a.status NOT IN ('dismissed','merged') ${articleId?'AND a.id=?':''} ${!articleId?'AND score>0':''} ORDER BY score DESC,a.updated_at DESC LIMIT 12`,...terms,...(articleId?[articleId]:[]));
  const chunks=[];
  for(const s of selected){
    const positions=terms.length?terms.map(()=>"CASE WHEN instr(lower(content),?)>0 THEN instr(lower(content),?) ELSE 2147483647 END").join(','):'';
    const first=terms.length?(terms.length===1?positions:`min(${positions})`):'1';
    const match=await query(env,`SELECT ${first} AS position FROM learning_evidence WHERE id=?`,...terms.flatMap(t=>[t,t]),s.id).first();
    const start=match.position===2147483647?0:Math.max(0,match.position-1-2000);
    const excerpt=await query(env,'SELECT substr(content,?,12000) AS content FROM learning_evidence WHERE id=?',start+1,s.id).first();
    chunks.push({...s,id:`${s.id}:${start}`,content:excerpt.content,range_start:start});
    const analyses=await rows(env,'SELECT a.id,a.model,a.analysis_json,m.type FROM learning_media_analyses a JOIN learning_media m ON m.id=a.media_id WHERE m.evidence_id=? AND m.item_id=?',s.id,s.item_id);
    for(const a of analyses)chunks.push({...s,id:`media:${a.id}`,relation:'media_evidence',content:JSON.stringify({type:a.type,model:a.model,...JSON.parse(a.analysis_json)})});
    if(!analyses.length){
      const row=await query(env,"SELECT json_extract(article_json,'$.observations') AS observations FROM learning_items WHERE id=?",s.item_id).first();
      const observations=JSON.parse(row?.observations || '[]').filter(o=>o.source_id===s.id);
      if(observations.length)chunks.push({...s,id:`${s.id}:observations`,relation:'model_media_observation',content:JSON.stringify(observations)});
    }
  }
  // 只出現在媒體證據裡的關鍵字（例如影片語音或畫面文字）也要找得到。
  if(terms.length){
    const media=await rows(env,`SELECT a.id,a.model,a.analysis_json,m.type,m.url,m.evidence_id,m.item_id,(${rank('a.analysis_json')}) AS score FROM learning_media_analyses a JOIN learning_media m ON m.id=a.media_id JOIN learning_items i ON i.id=m.item_id
      WHERE i.status NOT IN ('dismissed','merged') ${articleId?'AND m.item_id=?':''} AND score>0 ORDER BY score DESC LIMIT 6`,...terms,...(articleId?[articleId]:[]));
    for(const a of media)if(!chunks.some(c=>c.id===`media:${a.id}`))chunks.push({id:`media:${a.id}`,item_id:a.item_id,url:a.url,relation:'media_evidence',content:JSON.stringify({type:a.type,model:a.model,...JSON.parse(a.analysis_json)})});
    // 舊版教材把媒體觀察存在 article_json.observations。
    const legacy=await rows(env,`SELECT id,url,json_extract(article_json,'$.observations') AS observations,(${rank("json_extract(article_json,'$.observations')")}) AS score FROM learning_items
      WHERE status NOT IN ('dismissed','merged') AND json_array_length(json_extract(article_json,'$.observations'))>0 ${articleId?'AND id=?':''} AND score>0 ORDER BY score DESC LIMIT 6`,...terms,...(articleId?[articleId]:[]));
    for(const row of legacy){
      for(const [sourceId,list] of Object.entries(Object.groupBy(JSON.parse(row.observations),o=>o.source_id))){
        const id=`${sourceId}:observations`;
        if(!chunks.some(c=>c.id===id) && !(await query(env,'SELECT 1 FROM learning_media WHERE evidence_id=? AND id IN (SELECT media_id FROM learning_media_analyses)',sourceId).first()))
          chunks.push({id,item_id:row.id,url:row.url,relation:'model_media_observation',content:JSON.stringify(list)});
      }
    }
  }
  const gaps=[];
  for(const id of new Set(chunks.map(c=>c.item_id))){
    const row=await query(env,'SELECT gaps_json FROM learning_items WHERE id=?',id).first();
    gaps.push(...JSON.parse(row?.gaps_json || '[]'));
  }
  return {chunks,gaps};
}

function sourcesFor(chunks,citations){
  return chunks.filter(c=>citations.includes(c.id)).map(c=>({id:c.id,item_id:c.item_id || null,url:c.url,relation:c.relation,range_start:c.range_start || 0,excerpt:c.content.slice(0,500)}));
}

export function questionView(row){
  const answer=JSON.parse(row.answer_json || '{}');
  return {id:row.id,item_id:row.item_id,question:row.question,status:row.status,error:row.error,created_at:row.created_at,updated_at:row.updated_at,
    ...answer,answer_html:answer.answer?renderMarkdown(answer.answer):''};
}

// 提問先保存再處理；本機模式回覆工作身分與進度，不依賴長時間開著的 HTTP 連線。
export async function askQuestion(env,question,articleId=null,deps={}){
  if(typeof question!=='string'||!question.trim()||question.length>2000)throw new Error('問題需為 1–2,000 個字元');
  const id=crypto.randomUUID(),time=nowIso();
  const {chunks,gaps}=await retrieve(env,question,articleId);
  const save=async(status,answer,extra={})=>{
    await query(env,`INSERT INTO learning_questions(id,item_id,question,answer_json,status,scope,job_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET answer_json=excluded.answer_json,status=excluded.status,job_id=excluded.job_id,error=excluded.error,updated_at=excluded.updated_at`,
      id,articleId,question,JSON.stringify(answer),status,articleId?'article':'library',extra.job_id || null,extra.error || null,time,nowIso()).run();
    return questionView(await query(env,'SELECT * FROM learning_questions WHERE id=?',id).first());
  };
  if(!chunks.length)return save('done',{answer:INSUFFICIENT,insufficient:true,citations:[],sources:[]});
  if(await textProvider(env)==='local'){
    const input={kind:'question',prompt_version:QUESTION_PROMPT_VERSION,question:question.trim(),
      chunks:chunks.map((c,i)=>({ref:`C${i+1}`,id:c.id,item_id:c.item_id,relation:c.relation,url:c.url,range_start:c.range_start || 0,content:c.content})),gaps};
    const fingerprint=await hash(JSON.stringify({input,model:localModel(env)}));
    const jobId=await ensureJob(env,{kind:'question',questionId:id,priority:PRIORITY.question,input,fingerprint});
    return save('waiting_local',{},{job_id:jobId});
  }
  // 切換前路徑：Gemini 同步回答，仍保存成可查看的歷史。
  const answer=await (deps.generate || generate)(env,chunks,[],gaps,question,deps.fetcher || fetch);
  if(answer.citations.some(c=>!chunks.some(s=>s.id===c)))throw new Error('回答引用了未檢索的來源');
  return save('done',{...answer,sources:sourcesFor(chunks,answer.citations),provider:'gemini',model:env.LEARNING_MODEL || 'gemini-3.8-flash'});
}

export async function completeQuestion(env,job,input,data){
  let validated;
  try{validated=validateAnswer(input,data.output);}
  catch(error){
    await fail(env,job.id,job.attempt_token,error.message);
    throw new JobConflict(error.message,'invalid_output');
  }
  const chunks=input.chunks,time=nowIso();
  const answer={answer:normalizeMarkdown(validated.answer),insufficient:validated.insufficient,citations:validated.citations,sources:sourcesFor(chunks,validated.citations),
    provider:'ollama',model:String(data.model?.name || '').slice(0,80),prompt_version:input.prompt_version,generated_at:time};
  const result=await env.DB.batch([
    query(env,"UPDATE learning_jobs SET status='done',result_json='{}',completed_at=?,updated_at=?,lease_until=NULL WHERE id=? AND status='leased' AND attempt_token=?",time,time,job.id,job.attempt_token),
    query(env,"UPDATE learning_questions SET status='done',answer_json=?,error=NULL,updated_at=? WHERE id=? AND job_id=? AND EXISTS(SELECT 1 FROM learning_jobs WHERE id=? AND status='done' AND attempt_token=?)",
      JSON.stringify(answer),time,job.question_id,job.id,job.id,job.attempt_token),
  ]);
  return {ok:true,replay:!result[1].meta.changes};
}

export async function listQuestions(env,articleId=null){
  const list=await rows(env,`SELECT * FROM learning_questions WHERE ${articleId?'item_id=?':'item_id IS NULL'} ORDER BY created_at DESC LIMIT 50`,...(articleId?[articleId]:[]));
  return list.map(questionView);
}

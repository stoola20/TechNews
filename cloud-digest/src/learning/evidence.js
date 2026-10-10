import {rows,query,saveEvidence,evidence,setting,setSetting} from './store.js';
import {webEvidence} from './network.js';
import {postEvidence,xRead,postParameters,normalizePost,registerMedia} from './x.js';

export async function acquireEvidence(env,item,deps={}) {
  const fetcher=deps.fetcher || fetch;
  const loadWeb=deps.webEvidence || webEvidence;
  let sources=await evidence(env,item.id);
  let primary=sources.find(s=>s.relation==='primary'&&s.status==='available'&&s.content);
  if(!primary){
    const source=item.kind==='x'?await (deps.postEvidence || postEvidence)(env,item.url.split('/').at(-1),fetcher):await loadWeb(item.url,fetcher);
    if(!source.content?.trim()){
      if(source.media?.length || source.metadata?.references?.length){source.content='[主貼文沒有文字；附件與引用需另外取得，不可推測補齊。]';source.metadata={...source.metadata,no_text:true};}
      else throw new Error('來源沒有可取得的主文');
    }
    const key=await saveEvidence(env,item.id,source);
    await registerMedia(env,item.id,key,source.media);
    primary=(await evidence(env,item.id)).find(s=>s.id===key);
  }
  if(item.kind!=='x')return {pending:false,sources:await evidence(env,item.id)};
  const metadata=JSON.parse(primary.metadata_json);
  const state=await setting(env,`context:${item.id}`,{parent_queue:metadata.references || [],parents_done:[],author_done:false,author_cursor:null,external_done:[]});
  let steps=0;
  while(state.parent_queue.length && steps++<6){
    const ref=state.parent_queue[0];
    const url=`https://x.com/i/status/${ref.id}`;
    try {
      const cached=(await evidence(env,item.id)).find(s=>s.url===url&&s.status==='available');
      const source=cached?{...cached,metadata:JSON.parse(cached.metadata_json),media:[]}:await (deps.postEvidence || postEvidence)(env,ref.id,fetcher);
      const relation=ref.type==='replied_to'?'parent':ref.type==='retweeted'?'repost':'quote';
      const key=await saveEvidence(env,item.id,{...source,relation});
      await registerMedia(env,item.id,key,source.media);
      state.parents_done.push(ref.id);state.parent_queue.shift();
      for(const r of source.metadata.references || [])if(!state.parents_done.includes(r.id)&&!state.parent_queue.some(p=>p.id===r.id)&&r.id!==metadata.post_id)state.parent_queue.push(r);
    }catch(error){
      if(error.name==='BudgetPaused')throw error;
      await saveEvidence(env,item.id,{url,relation:'context_missing',status:'missing',metadata:{error:'父貼文或引用無法取得，請重試或確認權限'}});
      state.parent_queue.shift();state.parents_done.push(ref.id);
    }
    await setSetting(env,`context:${item.id}`,state);
  }
  while(!state.author_done && steps++<6){
    try {
      let username=metadata.author_username;
      if(!username){
        let profile=await setting(env,`author:${primary.author_id}`);
        if(!profile.username || profile.expires_at<Date.now()){
          const result=await (deps.xRead || xRead)(env,`/users/${primary.author_id}`,{'user.fields':'username,name'},1,false,fetcher);
          if(result.data?.id!==primary.author_id || !/^[A-Za-z0-9_]{1,15}$/.test(result.data?.username || ''))throw new Error('作者身份無法確認');
          profile={username:result.data.username,expires_at:Date.now()+86400000};
          await setSetting(env,`author:${primary.author_id}`,profile);
        }
        username=profile.username;
      }
      const result=await (deps.xRead || xRead)(env,'/tweets/search/all',{...postParameters(env),query:`conversation_id:${metadata.conversation_id} from:${username}`,max_results:100,next_token:state.author_cursor},100,false,fetcher);
      for(const post of result.data || []) {
        if(post.id===metadata.post_id || post.author_id!==primary.author_id)continue;
        const source=normalizePost(post,result.includes);
        const key=await saveEvidence(env,item.id,{...source,relation:'author_reply'});
        await registerMedia(env,item.id,key,source.media);
      }
      state.author_cursor=result.meta?.next_token || null;
      state.author_done=!state.author_cursor;
      if(result.errors?.length)await saveEvidence(env,item.id,{url:primary.url,relation:'author_context_missing',status:'missing',metadata:{error:'X 回傳部分作者補充取得錯誤'}});
    }catch(error){
      if(error.name==='BudgetPaused')throw error;
      await saveEvidence(env,item.id,{url:primary.url,relation:'author_context_missing',status:'missing',metadata:{error:'作者補充搜尋未完成，可能受 API 權限或來源限制'}});
      state.author_done=true;
    }
    await setSetting(env,`context:${item.id}`,state);
  }
  if(state.parent_queue.length || !state.author_done)return {pending:true,sources:await evidence(env,item.id)};
  sources=await evidence(env,item.id);
  const links=[...new Set(sources.filter(s=>s.status==='available').flatMap(s=>JSON.parse(s.metadata_json).links || []))];
  for(const url of links.filter(u=>!state.external_done.includes(u))){
    if(steps++>=8)return {pending:true,sources:await evidence(env,item.id)};
    try {
      const host=new URL(url).hostname;
      if(/(^|\.)(x\.com|twitter\.com)$/.test(host)){
        if(!sources.some(s=>s.url===url || (s.url.split('/').at(-1)===url.split('/').at(-1)&&s.url.includes('x.com/'))))await saveEvidence(env,item.id,{url,relation:'external',status:'missing',metadata:{error:'額外 X 連結未列為父貼文、引用或作者續寫，尚未取得'}});
        state.external_done.push(url);continue;
      }
      const source=await loadWeb(url,fetcher);
      const key=await saveEvidence(env,item.id,{...source,relation:'external'});
      await registerMedia(env,item.id,key,source.media);
    }catch(error){await saveEvidence(env,item.id,{url,relation:'external',status:'missing',metadata:{error:'直接外連文章無法取得'}});}
    state.external_done.push(url);await setSetting(env,`context:${item.id}`,state);
  }
  return {pending:false,sources:await evidence(env,item.id)};
}
export async function resetIncomplete(env,id,recheck=false){
  await query(env,"DELETE FROM settings WHERE key=?",`learning:context:${id}`).run();
  await query(env,"DELETE FROM learning_evidence WHERE item_id=? AND status='missing'",id).run();
  await query(env,"UPDATE learning_media SET status=CASE WHEN object_key IS NULL THEN 'pending' ELSE 'stored' END,error=NULL,attempts=0,file_json=CASE WHEN object_key IS NULL THEN NULL ELSE file_json END WHERE item_id=? AND status IN ('error','needs_attention','expired')",id).run();
  if(recheck)await query(env,"UPDATE learning_items SET rechecked=1 WHERE id=?",id).run();
}

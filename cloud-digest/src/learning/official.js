import {discoverSource,initialSeenUrls,getSources} from '../sources.js';
import {effectiveEnvironment} from '../settings.js';
import {query,nowIso} from './store.js';

// 官方發現只抓來源索引並排入共同文章庫；整理由背景工作與 Mac 持續消化，不受單次處理量限制。
export async function discoverOfficial(env,collect,deps={}){
  const effective=await effectiveEnvironment(env);
  const discover=deps.discoverSource || discoverSource;
  const lookback=Number(env.BACKFILL_DAYS || 14);
  const result={queued:0,initialized:[],errors:[]};
  for(const source of getSources(effective)){
    try{
      const entries=await discover(source);
      if(!entries.length)throw new Error('No articles discovered');
      const now=nowIso();
      let state=await query(env,'SELECT seen_urls_json FROM source_state WHERE source=?',source.id).first();
      if(!state){
        // 新來源只回補近期文章，較舊的列為已看過。
        const baseline=initialSeenUrls(entries,Date.now(),lookback);
        await query(env,'INSERT OR IGNORE INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES(?,?,?,?)',source.id,now,now,JSON.stringify(baseline)).run();
        state={seen_urls_json:JSON.stringify(baseline)};result.initialized.push(source.id);
      }
      const seen=new Set(JSON.parse(state.seen_urls_json));
      for(const entry of entries){
        if(seen.has(entry.url))continue;
        // receipt 與舊官方匯入相同，重複的日次事件或同一篇再次出現都不會新增收件。
        await collect(env,entry.url,'official',`official:${entry.url}`,{metadata:{source_id:source.id,title:entry.title || null,published_at:entry.publishedAt || null}});
        seen.add(entry.url);result.queued++;
      }
      await query(env,'UPDATE source_state SET last_checked_at=?,seen_urls_json=? WHERE source=?',now,JSON.stringify([...seen].slice(-400)),source.id).run();
    }catch(error){
      result.errors.push({source:source.id,error:error instanceof Error?error.message:'Unknown error'});
    }
  }
  console.log(JSON.stringify({event:'official_discovery',queued:result.queued,initialized:result.initialized,errors:result.errors.length}));
  return result;
}

export async function officialIntake(env,itemId){
  const intakes=await query(env,"SELECT origin,metadata_json FROM learning_intakes WHERE item_id=?",itemId).all();
  const list=intakes.results;
  const official=list.find(i=>i.origin==='official');
  return {official:official?JSON.parse(official.metadata_json || '{}'):null,onlyOfficial:!!official && list.every(i=>i.origin==='official')};
}

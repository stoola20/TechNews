import {discoverSource,initialSeenUrls,getSources,maxArticleAgeDays} from '../sources.js';
import {effectiveEnvironment} from '../settings.js';
import {query,nowIso} from './store.js';
import {publishedBefore,normalizePublished} from './dates.js';
import {now} from './clock.js';

// 官方發現只抓來源索引並排入共同文章庫；整理由背景工作與 Mac 持續消化，不受單次處理量限制。
export async function discoverOfficial(env,collect,deps={}){
  const effective=await effectiveEnvironment(env);
  const discover=deps.discoverSource || discoverSource;
  const maxAge=maxArticleAgeDays(env);
  const result={queued:0,stale:0,initialized:[],errors:[]};
  for(const source of getSources(effective)){
    try{
      const entries=await discover(source);
      if(!entries.length)throw new Error('No articles discovered');
      const checkedAt=nowIso();
      let state=await query(env,'SELECT seen_urls_json FROM source_state WHERE source=?',source.id).first();
      if(!state){
        // 新來源只回補近期文章，較舊的列為已看過。
        const baseline=initialSeenUrls(entries,now(),maxAge);
        await query(env,'INSERT OR IGNORE INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES(?,?,?,?)',source.id,checkedAt,checkedAt,JSON.stringify(baseline)).run();
        state={seen_urls_json:JSON.stringify(baseline)};result.initialized.push(source.id);
      }
      const seen=new Set(JSON.parse(state.seen_urls_json));
      for(const entry of entries){
        if(seen.has(entry.url))continue;
        // 列表裡沒看過、但發表已久的文章（RSS 視窗變長、舊流程留下的積壓）只記為看過，不收件、不通知。
        if(publishedBefore(entry.publishedAt,now(),maxAge)){seen.add(entry.url);result.stale++;continue;}
        // receipt 與舊官方匯入相同，重複的日次事件或同一篇再次出現都不會新增收件。
        await collect(env,entry.url,'official',`official:${entry.url}`,{metadata:{source_id:source.id,title:entry.title || null,published_at:entry.publishedAt || null}});
        seen.add(entry.url);result.queued++;
      }
      await query(env,'UPDATE source_state SET last_checked_at=?,seen_urls_json=? WHERE source=?',checkedAt,JSON.stringify([...seen].slice(-400)),source.id).run();
    }catch(error){
      result.errors.push({source:source.id,error:error instanceof Error?error.message:'Unknown error'});
    }
  }
  console.log(JSON.stringify({event:'official_discovery',queued:result.queued,stale:result.stale,initialized:result.initialized,errors:result.errors.length}));
  return result;
}

export async function officialIntake(env,itemId){
  const intakes=await query(env,"SELECT origin,metadata_json,created_at FROM learning_intakes WHERE item_id=?",itemId).all();
  const list=intakes.results;
  const official=list.find(i=>i.origin==='official');
  return {official:official?JSON.parse(official.metadata_json || '{}'):null,receivedAt:official?.created_at || null,onlyOfficial:!!official && list.every(i=>i.origin==='official')};
}

// 部落格列表常沒有日期，要抓到原文才知道發表時間。只來自官方、還沒通知過的文章，發表早於收件時 N 天就不整理。
// 以收件時間為準：Mac 離線等自家延誤不會讓已收進來的新文章被丟掉。
export async function staleOfficialReason(env,row,publishedAt){
  if(!publishedAt || row.edition==='legacy_digest' || row.notified_revision)return null;
  const intake=await officialIntake(env,row.id);
  if(!intake.onlyOfficial || !intake.receivedAt)return null;
  const days=maxArticleAgeDays(env);
  return publishedBefore(publishedAt,Date.parse(intake.receivedAt),days)?`發表於 ${normalizePublished(publishedAt).slice(0,10)}，收件時已超過 ${days} 天，不算新知`:null;
}

import {query,rows,hash,item,nowIso,saveEvidence} from './store.js';
import {canonicalUrl} from './network.js';
import {canonicalArticleUrl,getSources} from '../sources.js';
import {readSettings} from '../settings.js';

// 收件入口標籤。share 為 Telegram 分享，保留舊值以免改寫既有收件紀錄。
export const ORIGINS={official:'官方來源',bookmark:'X 書籤',backfill:'書籤回補',share:'Telegram 分享',web:'網站加入'};
export const HIDDEN_STATUSES=['dismissed','merged'];

export async function officialSources(env){
  try{return (await readSettings(env)).sources;}catch{return getSources(env);}
}

// 同一篇官方文章可能有舊路徑或尾端斜線，統一成來源設定的正式網址；X 貼文與外連文章仍是不同身分。
export async function libraryUrl(env,value,sources=null){
  const url=canonicalUrl(value);
  if(new URL(url).hostname==='x.com')return url;
  for(const source of sources || await officialSources(env)){
    const official=canonicalArticleUrl(url,source);
    if(official)return official;
  }
  return url;
}

export async function itemIdForUrl(env,url){
  const existing=await query(env,"SELECT id FROM learning_items WHERE url=? AND status NOT IN ('merged') ORDER BY created_at LIMIT 1",url).first();
  return existing?.id || (await hash(url)).slice(0,32);
}

export async function resolveItemId(env,id){
  const row=await item(env,id);
  if(row && row.status!=='merged')return id;
  const alias=await query(env,'SELECT item_id FROM learning_aliases WHERE alias=?',id).first();
  return alias?.item_id || null;
}

export async function saveVersion(env,row,origin,key=null){
  if(!row.body && !row.article_json)return;
  await query(env,`INSERT OR IGNORE INTO learning_versions(id,item_id,revision,edition,origin,title,body,article_json,gaps_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`,key || await hash(`version:${row.id}:${row.revision}:${row.edition}:${origin}`),row.id,row.revision,row.edition || 'detailed',origin,
    row.title || '',row.body,row.article_json,row.gaps_json || '[]',row.updated_at || nowIso()).run();
}

// 將 fromId 併入 toId：保留筆記、已讀、收件與版本，舊識別碼改由 alias 導向。
export async function mergeItems(env,fromId,toId){
  if(fromId===toId)return;
  const from=await item(env,fromId),to=await item(env,toId);
  if(!from || !to || from.status==='merged')return;
  await saveVersion(env,from,'merged');
  const note=[to.note,from.note].filter(n=>n && n.trim()).filter((n,i,all)=>all.indexOf(n)===i).join('\n\n');
  await env.DB.batch([
    query(env,'UPDATE OR IGNORE learning_intakes SET item_id=? WHERE item_id=?',toId,fromId),
    query(env,'DELETE FROM learning_intakes WHERE item_id=?',fromId),
    query(env,'UPDATE learning_questions SET item_id=? WHERE item_id=?',toId,fromId),
    query(env,'UPDATE learning_versions SET item_id=? WHERE item_id=?',toId,fromId),
    query(env,'UPDATE learning_items SET note=?,read_at=COALESCE(read_at,?),updated_at=? WHERE id=?',note,from.read_at,nowIso(),toId),
    // url 有唯一限制；被合併的文章改用不會再被收件比對到的網址。
    query(env,"UPDATE learning_items SET status='merged',url=?,lease_until=NULL,updated_at=? WHERE id=?",`${from.url}#merged-${fromId}`,nowIso(),fromId),
    query(env,'UPDATE learning_aliases SET item_id=? WHERE item_id=?',toId,fromId),
    query(env,'INSERT OR REPLACE INTO learning_aliases(alias,item_id,created_at) VALUES(?,?,?)',fromId,toId,nowIso()),
  ]);
}

function legacyArticle(row,summary,evidenceId){
  return {title:summary.title_zh || row.title,body:summary.body_zh || '',intro:'',citations:evidenceId?[evidenceId]:[],observations:[],
    provider:row.model_provider || null,model:row.model_name || null,prompt_version:'legacy-digest',legacy:true,generated_at:row.updated_at};
}

// 匯入已通知的舊官方導讀。只寫資料庫，不讀外部來源、不呼叫模型、不排入通知。
async function importOfficial(env,sources){
  let imported=0,merged=0;
  const pending=await rows(env,"SELECT * FROM articles WHERE status='notified' AND library_item_id IS NULL ORDER BY created_at LIMIT 200");
  for(const row of pending){
    let url;
    try{url=await libraryUrl(env,row.source_url,sources);}catch{url=row.source_url;}
    const summary=row.summary_json?JSON.parse(row.summary_json):{};
    const existing=await query(env,"SELECT * FROM learning_items WHERE url=? AND status NOT IN ('merged') LIMIT 1",url).first();
    const id=existing?.id || (await hash(url)).slice(0,32);
    const time=row.created_at || nowIso();
    if(!existing){
      await query(env,`INSERT OR IGNORE INTO learning_items(id,url,kind,title,status,edition,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
        id,url,'web',summary.title_zh || row.title,'ready','legacy_digest',1,time,row.updated_at || time).run();
    }
    const gaps=[];
    let evidenceId=null;
    if(row.content){
      // 既有收藏已保存的原文優先，不以官方舊擷取覆寫。
      const current=existing?await query(env,"SELECT id FROM learning_evidence WHERE item_id=? AND relation='primary' AND status='available'",id).first():null;
      evidenceId=current?.id || await saveEvidence(env,id,{url,relation:'primary',content:row.content,published_at:row.published_at,metadata:{title:row.title,content_method:row.content_method,legacy_official:true}});
    }else gaps.push({url,error:'舊官方導讀未保存原文，只能顯示既有導讀'});
    if(!row.model_provider || !row.model_name)gaps.push({url,error:'舊官方導讀缺少模型資訊'});
    const article=legacyArticle(row,summary,evidenceId);
    const version={id,revision:existing?.revision ?? 1,edition:'legacy_digest',title:article.title,body:article.body,article_json:JSON.stringify(article),gaps_json:JSON.stringify(gaps),updated_at:row.updated_at || time};
    await saveVersion(env,version,'official',await hash(`legacy-official:${url}`));
    if(!existing){
      await query(env,'UPDATE learning_items SET body=?,article_json=?,gaps_json=?,status=? WHERE id=? AND edition=\'legacy_digest\' AND body IS NULL',
        article.body,JSON.stringify(article),JSON.stringify(gaps),gaps.some(g=>/原文/.test(g.error))?'partial':'ready',id).run();
      imported++;
    }else merged++;
    const current=await item(env,id);
    // 已通知過的導讀不能因為搬移重新成為待通知。
    await query(env,'INSERT OR IGNORE INTO learning_intakes(receipt,item_id,origin,notify_revision,metadata_json,created_at) VALUES(?,?,?,?,?,?)',
      `official:${url}`,id,'official',Math.max(current.revision,1),JSON.stringify({source_id:row.source,title:row.title,published_at:row.published_at,legacy:true}),time).run();
    await query(env,'UPDATE articles SET library_item_id=? WHERE source_url=?',id,row.source_url).run();
  }
  return {imported,merged};
}

// 既有收藏若因正式網址規則而與另一篇重複，合併到較早且已整理的一篇。
async function reconcileUrls(env,sources){
  let renamed=0,merged=0;
  for(const row of await rows(env,"SELECT id,url,body,created_at FROM learning_items WHERE status NOT IN ('merged','dismissed') AND url NOT LIKE 'https://x.com/%' ORDER BY created_at")){
    let url;
    try{url=await libraryUrl(env,row.url,sources);}catch{continue;}
    if(url===row.url)continue;
    const target=await query(env,"SELECT id,body FROM learning_items WHERE url=? AND status NOT IN ('merged','dismissed') LIMIT 1",url).first();
    if(!target){await query(env,'UPDATE learning_items SET url=? WHERE id=?',url,row.id).run();renamed++;continue;}
    if(!target.body && row.body){
      await mergeItems(env,target.id,row.id);
      await query(env,'UPDATE learning_items SET url=? WHERE id=?',url,row.id).run();
    }else await mergeItems(env,row.id,target.id);
    merged++;
  }
  return {renamed,merged};
}

export async function migrateLibrary(env){
  const sources=await officialSources(env);
  const urls=await reconcileUrls(env,sources);
  const official=await importOfficial(env,sources);
  return {imported:official.imported,merged:official.merged+urls.merged,renamed:urls.renamed};
}

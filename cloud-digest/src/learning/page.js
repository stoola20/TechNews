import {STYLE,HELPERS,LOGIN} from './ui.js';

export const LEARNING_PAGE=String.raw`<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechNews · 文章庫</title>
<style>${STYLE}
html,body{height:100%}
body.app{display:flex;flex-direction:column}
.top form{display:flex;gap:8px;flex:1 1 360px;max-width:560px}.top form input{flex:1;min-width:0}
.layout{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr)}
#library{border-right:1px solid var(--line);overflow:auto;padding:16px;background:var(--paper)}
#reader{overflow:auto;padding:24px clamp(16px,4vw,48px) 64px;outline:none}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;margin:12px 0}.filters label{display:block;margin-bottom:4px}.filters select{width:100%}
.filters .check{grid-column:1/-1;display:flex;align-items:center;gap:8px;min-height:44px;font-weight:600}.filters .check input{min-height:auto;width:20px;height:20px}
#search{width:100%;margin-top:4px}
#list{list-style:none;margin:0;padding:0}
#list a{display:block;padding:12px;margin:0 -12px;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none;border-radius:6px}
#list a:hover{background:#f4f8f7}#list a[aria-current=page]{background:var(--soft);box-shadow:inset 3px 0 0 var(--accent)}
#list strong{display:block;line-height:1.5;overflow-wrap:anywhere}#list .unread strong:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:2px}
.preview{display:block;color:var(--muted);font-size:13px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
.pager{display:flex;gap:8px;justify-content:space-between;margin-top:12px}
.reader-bar{display:none;margin-bottom:12px}
#article-title{font-size:28px;line-height:1.45;margin:0 0 8px;outline:none}
.meta{color:var(--muted);font-size:14px;line-height:1.7}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
section.block{border-top:1px solid var(--line);margin-top:28px;padding-top:20px;max-width:880px}section.block h2{font-size:19px;margin:0 0 12px}
.label{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--muted);text-transform:none;margin-bottom:6px}
.source{margin:10px 0;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper)}.source summary{min-height:32px;cursor:pointer}
.source .text{white-space:pre-wrap;line-height:1.75;max-height:420px;overflow:auto;font-size:15px;margin-top:8px}
.analysis{border-left:3px solid var(--line);padding-left:14px;margin:12px 0 20px}.stamp{min-height:32px;padding:2px 8px;font-variant-numeric:tabular-nums;margin-right:6px}mark{background:#fde68a;color:inherit;outline:none}#answer-sources li{margin:8px 0}
#media img,#media video{max-width:100%;max-height:440px;display:block;margin:12px 0;border-radius:6px}
#ask-scope{display:flex;gap:16px;flex-wrap:wrap}#ask-scope label{display:flex;align-items:center;gap:8px;min-height:44px}#ask-scope input{min-height:auto;width:18px;height:18px}
#answer{margin-top:16px}#history details{border-bottom:1px solid var(--line);padding:4px 0}#history summary{min-height:44px;cursor:pointer;padding:10px 0}
.empty{padding:48px 0;color:var(--muted)}
.note-state{font-size:13px;min-height:20px;margin-top:6px}.note-state.error{color:var(--danger)}
@media(max-width:959px){
  body.app{display:block;height:auto}.layout{display:block}
  #library{border-right:0;overflow:visible}#reader{overflow:visible;padding:16px}
  body[data-view=reader] #library{display:none}body[data-view=list] #reader{display:none}
  .top{position:static}.reader-bar{display:block;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}
  #article-title{font-size:23px}.article-body{font-size:16px}
  .top{padding:10px 12px}.top form{order:3;flex-basis:100%;max-width:none}
}
</style></head><body class="app" data-view="list">
<header class="top"><a class="brand" href="/learning">TechNews 文章庫</a>
<form id="collect-form"><label class="sr" for="url">分享連結</label><input id="url" type="url" placeholder="貼上 X 貼文或文章網址" required><button class="primary">加入文章庫</button></form>
<nav><span id="runner-pill" class="pill" role="status">狀態載入中</span><a href="/learning/admin">管理</a><button id="logout" class="hidden">登出</button></nav></header>
<div id="feedback" role="status" aria-live="polite"></div>
${LOGIN}
<main id="app" class="layout hidden">
<aside id="library" aria-label="文章列表">
  <form id="search-form" role="search"><label for="search">搜尋標題、正文與保存的原文</label><input id="search" type="search" placeholder="按 / 快速搜尋"></form>
  <div class="filters">
    <label class="check"><input type="checkbox" id="unread"> 只看未讀</label>
    <div><label for="origin">收件入口</label><select id="origin"><option value="">全部入口</option><option value="official">官方來源</option><option value="bookmark">X 書籤</option><option value="backfill">書籤回補</option><option value="share">Telegram 分享</option><option value="web">網站加入</option></select></div>
    <div><label for="state">處理狀態</label><select id="state"><option value="">全部（不含已略過）</option><option value="ready">已完成</option><option value="needs_action">需要處理（錯誤、缺漏）</option><option value="waiting_local">等待本機／本機生成中</option><option value="paused">費用暫停／手動暫停</option><option value="processing">排隊與取得來源中</option><option value="awaiting_backfill">等待確認回補</option><option value="legacy">既有導讀</option><option value="filtered">主題不符・已略過</option></select></div>
  </div>
  <p id="list-summary" class="muted" aria-live="polite"></p>
  <ul id="list"></ul>
  <div class="pager"><button id="previous">上一頁</button><button id="next">下一頁</button></div>
</aside>
<div id="reader" tabindex="-1" aria-label="閱讀區">
  <div class="reader-bar"><button id="back">← 返回列表</button></div>
  <div id="article"><div class="empty"><h1 style="font-size:22px">選一篇文章開始閱讀</h1><p>官方文章、X 書籤與分享都在左側列表。處理狀態會自動更新。</p></div></div>
  <section class="block hidden" id="notes-panel" aria-labelledby="notes-title"><h2 id="notes-title">我的筆記</h2><label class="sr" for="note">筆記內容</label><textarea id="note" maxlength="20000" placeholder="寫下自己的理解或待辦；會自動保存"></textarea><div id="note-state" class="note-state" role="status" aria-live="polite"></div><div id="note-actions" class="actions"></div></section>
  <section class="block" id="ask-panel" aria-labelledby="ask-title"><h2 id="ask-title">來源追問</h2>
    <form id="ask-form"><fieldset style="border:0;padding:0;margin:0"><legend class="sr">追問範圍</legend><div id="ask-scope"><label><input type="radio" name="scope" value="article" checked> 目前文章</label><label><input type="radio" name="scope" value="all"> 整個文章庫</label></div></fieldset>
    <label for="question">你的問題</label><textarea id="question" maxlength="2000" placeholder="例如：這個設定需要哪個版本？" required></textarea><div class="actions"><button class="primary">依來源回答</button></div></form>
    <div id="answer" class="article-body" aria-live="polite"></div><ul id="answer-sources"></ul>
    <h3 style="font-size:16px">提問紀錄</h3><div id="history" class="muted">尚無提問。</div>
  </section>
</div>
</main>
<script>
${HELPERS}
let view={q:'',unread:false,origin:'',state:'',page:0,article:null},listKey=null,listItems=[],current=null,openSeq=0,pollTimer=null,statusTimer=null;
const narrow=matchMedia('(max-width: 959px)');
function readView(){const p=new URLSearchParams(location.search);return {q:p.get('q')||'',unread:p.get('unread')==='1',origin:p.get('origin')||'',state:p.get('state')||'',page:Math.max(0,parseInt(p.get('page')||'0',10)||0),article:p.get('article')};}
function urlFor(v){const p=new URLSearchParams();if(v.q)p.set('q',v.q);if(v.unread)p.set('unread','1');if(v.origin)p.set('origin',v.origin);if(v.state)p.set('state',v.state);if(v.page)p.set('page',String(v.page));if(v.article)p.set('article',v.article);const s=p.toString();return '/learning'+(s?'?'+s:'');}
function listScroll(){return narrow.matches?window.scrollY:$('library').scrollTop;}
function restoreScroll(y){if(y==null)return;requestAnimationFrame(()=>{if(narrow.matches)window.scrollTo(0,y);else $('library').scrollTop=y;});}
// 每次換頁前記住列表捲動位置；返回時由瀏覽器歷史還原。
function navigate(next,fromList){history.replaceState({...(history.state||{}),listScroll:listScroll()},'',location.href);view={...view,...next};history.pushState({fromList:!!fromList},'',urlFor(view));return apply();}
function syncControls(){$('search').value=view.q;$('unread').checked=view.unread;$('origin').value=view.origin;$('state').value=view.state;}
async function apply(){
  syncControls();
  const key=JSON.stringify([view.q,view.unread,view.origin,view.state,view.page]);
  if(key!==listKey){listKey=key;await loadList();}
  document.body.dataset.view=view.article?'reader':'list';
  if(view.article){if(view.article!==(current&&current.id))await openArticle(view.article);}else clearArticle();
  markSelected();
}
window.addEventListener('popstate',e=>{view=readView();run(async()=>{await apply();if(!view.article)restoreScroll(e.state&&e.state.listScroll);});});
function describeFilters(){const parts=[];if(view.q)parts.push('搜尋「'+view.q+'」');if(view.unread)parts.push('未讀');if(view.origin)parts.push(ORIGINS[view.origin]);if(view.state)parts.push($('state').selectedOptions[0].textContent);return parts.join('・');}
async function loadList(){
  const p=new URLSearchParams();if(view.q)p.set('q',view.q);if(view.unread)p.set('unread','1');if(view.origin)p.set('origin',view.origin);if(view.state)p.set('state',view.state);p.set('offset',String(view.page*50));
  const items=await api('items?'+p.toString());
  listItems=items;$('list').replaceChildren(...items.map(renderItem));
  if(!items.length)$('list').append(el('li',{class:'empty',text:'沒有符合的文章。'}));
  $('list-summary').textContent='第 '+(view.page+1)+' 頁，'+items.length+' 篇'+(describeFilters()?'（'+describeFilters()+'）':'');
  $('previous').disabled=view.page===0;$('next').disabled=items.length<50;
}
function badges(i){
  const out=[el('span',{class:'badge '+stateTone(i.status),text:stateLabel(i),'data-role':'state'})];
  if(i.edition==='legacy_digest')out.push(el('span',{class:'badge',text:'既有導讀'}));
  for(const o of (i.origins||'').split(',').filter(Boolean))out.push(el('span',{class:'badge',text:ORIGINS[o]||o}));
  return out;
}
function renderItem(i){
  const a=el('a',{href:urlFor({...view,article:i.id}),'data-id':i.id},[el('strong',{text:i.title||(i.preview||'').slice(0,80)||i.url}),...badges(i)]);
  if(!i.read_at)a.classList.add('unread');
  if(i.status==='awaiting_backfill'&&i.preview)a.append(el('span',{class:'preview',text:i.preview}));
  a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();run(()=>navigate({article:i.id},true));};
  return el('li',{},[a]);
}
function markSelected(){for(const a of document.querySelectorAll('#list a'))if(current&&a.dataset.id===current.id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
function clearArticle(){current=null;openSeq++;$('article').replaceChildren(el('div',{class:'empty'},[el('h1',{style:'font-size:22px',text:'選一篇文章開始閱讀'}),el('p',{text:'官方文章、X 書籤與分享都在左側列表。處理狀態會自動更新。'})]));notes.close();questions.open(null);}
async function openArticle(id){
  const seq=++openSeq;
  let result;
  try{result=await api('items/'+id);}catch(e){if(seq===openSeq){current=null;$('article').replaceChildren(el('p',{class:'notice',text:'無法開啟這篇文章：'+e.message}));}return;}
  // 快速切換時，較慢回來的舊回應不能覆蓋目前文章。
  if(seq!==openSeq)return;
  current=result.item;
  if(current.id!==id){view.article=current.id;history.replaceState(history.state,'',urlFor(view));}
  renderArticle(result);notes.open(current);questions.open(current);markSelected();
  const title=$('article-title');if(title)title.focus({preventScroll:true});
  $('reader').scrollTop=0;if(narrow.matches)window.scrollTo(0,0);
}
async function refreshArticle(){if(!current)return;const seq=openSeq,result=await api('items/'+current.id);if(seq!==openSeq||result.item.id!==current.id)return;current=result.item;renderArticle(result);notes.sync(current);}
function provenance(a){if(!a)return '';if(a.legacy)return '搬移前的官方短導讀'+(a.model?'（'+a.model+'）':'，未保存模型資訊');if(a.provider==='ollama')return '本機 '+(a.model||'Gemma')+' 整理';if(a.provider==='gemini')return 'Gemini '+(a.model||'')+' 整理';if(a.provider==='demo')return '示範資料';return a.model||'';}
function confirmAction(text){return confirm(text);}
function renderArticle(result){
  const item=result.item,box=$('article'),article=JSON.parse(item.article_json||'{}'),gaps=JSON.parse(item.gaps_json||'[]');
  const nodes=[];
  nodes.push(el('h1',{id:'article-title',tabindex:'-1',text:item.title||(result.sources.find(s=>s.relation==='primary')||{content:''}).content.slice(0,100)||'處理中的來源'}));
  const origins=[...new Set((result.intakes||[]).map(i=>ORIGINS[i.origin]||i.origin))];
  nodes.push(el('p',{class:'meta'},[el('span',{class:'badge '+stateTone(item.status),text:stateLabel(item)}),document.createTextNode(' 更新於 '+when(item.updated_at)+(origins.length?'・收件：'+origins.join('、'):'')+(provenance(article)?'・'+provenance(article):'')+'・'),safeLink(item.url,'開啟原始來源')]));
  if(item.edition==='legacy_digest')nodes.push(el('p',{class:'notice',text:'這是搬移前的官方短導讀，尚未依新規格詳細整理。可以用「只重寫文字」改成詳細教材。'}));
  if(item.status==='waiting_local')nodes.push(el('p',{class:'notice',text:'來源已備齊，等待 Mac 本機模型處理。Mac 離線時會一直等待，不是失敗，也不會改用雲端模型。'}));
  if(item.status==='budget_paused')nodes.push(el('p',{class:'notice',text:'費用暫停：需要付費的步驟已停下，工作保留。到管理頁確認預算後手動恢復。'}));
  if(gaps.length||item.last_error)nodes.push(el('div',{class:'notice'},[el('strong',{text:'來源與處理提醒'}),...gaps.map(g=>el('div',{text:'・'+(g.error||'來源缺漏')+(g.url?'（'+g.url+'）':'')})),item.last_error?el('div',{text:'・'+item.last_error}):null]));
  nodes.push(actions(item));
  if(item.status==='awaiting_backfill'){
    nodes.push(el('p',{class:'notice',text:'這篇尚未呼叫模型。先閱讀同步時保存的原文，或開啟原始來源查看最新內容，再決定是否整理。'}));
    const originals=result.sources.filter(s=>s.status==='available'&&s.content);
    nodes.push(el('section',{class:'block'},[el('h2',{text:'保存的原文'}),...(originals.length?originals.map(sourceBlock):[el('p',{text:'尚未保存原文，請先開啟上方原始來源。'})])]));
  }
  if(item.body){const content=el('div',{class:'article-body'});content.innerHTML=current.body_html;nodes.push(el('section',{class:'block','aria-labelledby':'body-title'},[el('h2',{id:'body-title',class:'sr',text:'教材'}),el('span',{class:'label',text:'教材（'+(provenance(article)||'模型整理')+'；標示「補充例子」的段落是模型額外加的教學例子）'}),content]));}
  if(item.status!=='awaiting_backfill'&&result.sources.length)nodes.push(el('section',{class:'block'},[el('h2',{text:'原始來源與片段'}),el('p',{class:'muted',text:'以下是系統保存的原文，與上方模型整理的內容分開。'}),...result.sources.map(sourceBlock)]));
  const media=mediaBlock(result);if(media)nodes.push(media);
  if((result.versions||[]).length)nodes.push(el('section',{class:'block'},[el('h2',{text:'舊版本'}),el('ul',{},result.versions.map(v=>el('li',{text:when(v.created_at)+'・'+(v.edition==='legacy_digest'?'既有導讀':'版本 '+v.revision)+(v.title?'・'+v.title:'')})))]));
  box.replaceChildren(...nodes);
}
function sourceBlock(s){
  const d=el('details',{class:'source','data-evidence':s.id},[el('summary',{},[el('strong',{text:RELATIONS[s.relation]||s.relation}),document.createTextNode((s.published_at?'・'+when(s.published_at):'')+(s.status!=='available'?'・無法取得':''))])]);
  d.append(el('p',{},[safeLink(s.url,'開啟這則原文')]));
  if(s.content)d.append(el('div',{class:'text',text:s.content}));
  else{const m=JSON.parse(s.metadata_json||'{}');d.append(el('p',{class:'muted',text:m.error||'沒有保存內容'}));}
  return d;
}
function seekButton(stamp,player){const b=el('button',{type:'button',class:'stamp',text:stamp});if(!player){b.disabled=true;b.title='原始媒體已不可播放，保留解析與原始連結';return b;}b.setAttribute('aria-label','跳到 '+stamp);b.onclick=()=>{const p=stamp.split(':').map(Number);player.currentTime=p[0]*60+p[1];player.focus();player.play().catch(()=>{});};return b;}
function renderAnalysis(a,player){
  const d=a.analysis,wrap=el('div',{class:'analysis'},[el('span',{class:'label',text:'媒體證據（模型觀察：'+a.model+'）'}),el('p',{class:'muted',text:'涵蓋範圍：'+(d.coverage.from?d.coverage.from+'–'+d.coverage.to+'，':'')+d.coverage.summary})]);
  wrap.append(el('p',{style:'white-space:pre-wrap',text:'畫面文字（OCR）：'+({text:'',partial:'（部分可辨識）',none:'沒有可辨識文字',unreadable:'無法辨識'}[d.ocr.status]||'')+(d.ocr.text?'\n'+d.ocr.text:'')}));
  if(d.speech.status!=='not_applicable'){wrap.append(el('p',{text:'語音：'+({transcribed:'已轉錄',partial:'部分可辨識',none:'沒有語音',unclear:'聽不清楚'}[d.speech.status]||d.speech.status)}));for(const s of d.speech.segments)wrap.append(el('p',{},[seekButton(s.start,player),document.createTextNode('– '+s.end+' '+s.text)]));}
  for(const o of d.visual)wrap.append(el('p',{},[o.timestamp?seekButton(o.timestamp,player):null,document.createTextNode((o.kind==='inferred'?'推論：':'畫面：')+o.observation)]));
  for(const u of d.unrecognized)wrap.append(el('p',{class:'muted',text:'無法辨識'+(u.timestamp?'（'+u.timestamp+'）':'')+'：'+u.description}));
  return wrap;
}
function mediaBlock(result){
  const media=result.media||[],analyses=result.analyses||[],old=analyses.length?[]:(JSON.parse(result.item.article_json||'{}').observations||[]);
  if(!media.length&&!old.length)return null;
  const box=el('section',{class:'block',id:'media'},[el('h2',{text:'媒體與時間點'})]);
  for(const m of media){
    let player=null;
    if(m.object_key){const node=el(m.type==='photo'?'img':'video',{src:'/learning/api/media/'+m.id});if(m.type==='photo'){node.alt='來源圖片';node.loading='lazy';}else{node.controls=true;node.preload='metadata';player=node;}box.append(node);}
    else box.append(el('p',{class:'muted'},[document.createTextNode((m.error||'原始媒體尚未取得或已過保存期限')+' '),safeLink(m.url,'原始媒體連結')]));
    const a=analyses.find(x=>x.media_id===m.id);if(a)box.append(renderAnalysis(a,player));
  }
  // 舊版教材只保存簡短媒體觀察。
  for(const o of old)box.append(el('p',{},[el('span',{class:'label',text:'舊版媒體觀察'}),document.createTextNode(' '+(o.timestamp?o.timestamp+'・':'')+o.description)]));
  return box;
}
function actions(item){
  const row=el('div',{class:'actions'});
  const read=el('button',{text:item.read_at?'標記未讀':'標記已讀'});
  read.onclick=()=>run(async()=>{await api('items/'+item.id,'PATCH',{read:!item.read_at});await refreshArticle();await updateListItem(item.id);},read,'更新中…');
  row.append(read);
  if(item.status==='awaiting_backfill'){
    const start=el('button',{class:'primary',text:'開始整理這篇'});
    start.onclick=()=>run(async()=>{await api('items/'+item.id+'/backfill','POST',{});message('已啟動這篇文章的整理，完成後會通知你。');await refreshArticle();await updateListItem(item.id);},start,'啟動整理…');
    const remove=el('button',{class:'danger',text:'刪除這篇待回補'});
    remove.onclick=()=>{if(!confirmAction('刪除後，下次同步不會再加入；重新分享原始連結可再次收件。要刪除嗎？'))return;run(async()=>{await api('items/'+item.id,'DELETE');message('已刪除待回補文章。');listKey=null;await navigate({article:null});},remove,'刪除中…');};
    row.append(start,remove);return row;
  }
  const retry=el('button',{text:'補取缺漏並整理'});
  retry.onclick=()=>{if(!confirmAction('會重新取得缺漏的來源與媒體（可能產生 X 或 Flash 費用），再重新整理文字。要繼續嗎？'))return;run(async()=>{await api('items/'+item.id+'/retry','POST',{});message('已排入補取與整理。');await refreshArticle();await updateListItem(item.id);},retry,'送出中…');};
  row.append(retry);
  if(['ready','partial','needs_attention','error'].includes(item.status)){
    const rewrite=el('button',{text:'只重寫文字'});
    rewrite.onclick=()=>{if(!confirmAction('沿用已保存的來源與媒體解析，只請文字模型重寫，不重新取得來源。要繼續嗎？'))return;run(async()=>{await api('items/'+item.id+'/rewrite','POST',{});message('已排入重寫。');await refreshArticle();await updateListItem(item.id);},rewrite,'送出中…');};
    row.append(rewrite);
  }
  if(['ready','partial'].includes(item.status)&&item.edition==='detailed'){
    const resend=el('button',{text:'重送通知'});
    resend.onclick=()=>{if(!confirmAction('用目前保存的內容再發一次 Telegram 通知，不重新生成。要繼續嗎？'))return;run(async()=>{await api('items/'+item.id+'/renotify','POST',{});message('已重送通知。');},resend,'送出中…');};
    row.append(resend);
  }
  return row;
}
async function updateListItem(id){const [s]=await api('items/states?ids='+id);if(s)applyState(s);}
function applyState(s){
  const i=listItems.find(x=>x.id===s.id);if(i)Object.assign(i,s);
  const a=document.querySelector('#list a[data-id="'+s.id+'"]');
  if(a&&i){const badge=a.querySelector('[data-role=state]');badge.className='badge '+stateTone(i.status);badge.textContent=stateLabel(i);a.classList.toggle('unread',!i.read_at);}
}
// 所有入口與追問共用的進度刷新：只更新狀態徽章；目前文章變更時只重繪文章區，不動筆記。
async function poll(){
  if(document.hidden||activeActions)return;
  const ids=[...new Set([...listItems.filter(i=>!FINAL.includes(i.status)).map(i=>i.id),...(current?[current.id]:[])])].slice(0,100);
  if(!ids.length)return;
  try{
    for(const s of await api('items/states?ids='+ids.join(','))){
      applyState(s);
      if(current&&s.id===current.id&&(s.status!==current.status||s.revision!==current.revision||s.stage!==current.stage))await refreshArticle();
      else if(current&&s.id===current.id&&(s.note_updated_at||null)!==(notes.base||null)){current.note_updated_at=s.note_updated_at;notes.sync({...current,...await api('items/'+current.id).then(r=>r.item)});}
    }
  }catch(e){}
}
async function runnerStatus(){
  try{const s=await api('status'),l=s.local,b=s.budget;
    const text=(b.paused?'已暫停・':'')+(l.provider==='local'?(l.online?'Mac 在線':'Mac 離線')+(l.jobs.waiting_local?'・等待 '+l.jobs.waiting_local:''):'Gemini 模式');
    $('runner-pill').textContent=text;$('runner-pill').title=l.last_seen_at?'最後心跳 '+when(l.last_seen_at):'尚未收到 Mac 心跳';
  }catch(e){}
}
// 筆記：自動保存、失敗時草稿留在這台裝置、切換文章不互相覆寫、跨分頁衝突要使用者選擇。
const NOTE_DELAY=1200;
const notes={
  item:null,base:null,saved:'',timer:null,inflight:0,conflict:null,
  key(id){return 'technews-note:'+id;},
  readDraft(id){try{return JSON.parse(localStorage.getItem(this.key(id))||'null');}catch(e){return null;}},
  writeDraft(id,text,base){try{localStorage.setItem(this.key(id),JSON.stringify({text,base,at:Date.now()}));}catch(e){}},
  clearDraft(id,text){try{const d=this.readDraft(id);if(!d||text==null||d.text===text)localStorage.removeItem(this.key(id));}catch(e){}},
  dirty(){return !!this.item&&$('note').value!==this.saved;},
  setState(text,tone,buttons){$('note-state').textContent=text||'';$('note-state').className='note-state'+(tone?' '+tone:'');$('note-actions').replaceChildren(...(buttons||[]));},
  open(item){
    // 離開前一篇時，把尚未送出的內容以那篇的身分送出，回應不會寫進新文章。
    if(this.item&&this.item.id!==item.id&&this.dirty()){clearTimeout(this.timer);this.send(this.item.id,$('note').value,this.base);}
    clearTimeout(this.timer);this.conflict=null;
    this.item=item;this.base=item.note_updated_at||null;this.saved=item.note||'';
    $('notes-panel').classList.remove('hidden');
    const draft=this.readDraft(item.id);
    if(draft&&draft.text!==this.saved){
      $('note').value=draft.text;
      if((draft.base||null)===this.base){this.setState('還原了這台裝置上尚未保存的草稿，將自動保存。','');this.schedule();}
      else this.showConflict(item.note||'',item.note_updated_at);
    }else{$('note').value=this.saved;this.clearDraft(item.id);this.setState(item.note_updated_at?'最後保存 '+when(item.note_updated_at):'','');}
  },
  sync(item){
    if(!this.item||this.item.id!==item.id)return;
    const changed=(item.note_updated_at||null)!==this.base;
    if(changed&&!this.dirty()&&!this.inflight){this.base=item.note_updated_at||null;this.saved=item.note||'';$('note').value=this.saved;this.setState('已載入其他分頁保存的筆記（'+when(item.note_updated_at)+'）。','');}
  },
  close(){if(this.item&&this.dirty()){clearTimeout(this.timer);this.send(this.item.id,$('note').value,this.base);}this.item=null;$('notes-panel').classList.add('hidden');},
  schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.save(),NOTE_DELAY);},
  input(){if(!this.item)return;this.writeDraft(this.item.id,$('note').value,this.base);if(this.conflict)return;this.setState('編輯中…','');this.schedule();},
  async send(id,text,base){
    this.inflight++;
    try{const r=await api('items/'+id,'PATCH',{note:text,base_note_updated_at:base});this.clearDraft(id,text);return {ok:true,note_updated_at:r.note_updated_at};}
    catch(e){return {ok:false,error:e};}
    finally{this.inflight--;}
  },
  async save(force){
    if(!this.item)return;
    clearTimeout(this.timer);
    const id=this.item.id,text=$('note').value,base=force?this.conflict.note_updated_at:this.base;
    if(text===this.saved&&!force){this.clearDraft(id,text);return;}
    this.setState('保存中…','');
    const result=await this.send(id,text,base);
    if(!this.item||this.item.id!==id)return;
    if(result.ok){
      this.base=result.note_updated_at;this.saved=text;this.conflict=null;
      if($('note').value===text)this.setState('已保存 '+when(result.note_updated_at),'');else{this.writeDraft(id,$('note').value,this.base);this.schedule();}
      return;
    }
    const e=result.error;
    if(e.status===409&&e.body&&e.body.code==='note_conflict'){this.showConflict(e.body.note,e.body.note_updated_at);return;}
    this.writeDraft(id,text,this.base);
    const retry=el('button',{type:'button',text:'重試保存'});retry.onclick=()=>this.save();
    this.setState('保存失敗：'+e.message+'。草稿已保留在這台裝置，恢復連線後會再試。','error',[retry]);
  },
  showConflict(serverNote,serverAt){
    clearTimeout(this.timer);this.conflict={note:serverNote,note_updated_at:serverAt||null};
    const keepMine=el('button',{type:'button',class:'primary',text:'保留我的版本'});keepMine.onclick=()=>this.save(true);
    const useTheirs=el('button',{type:'button',text:'改用另一份'});useTheirs.onclick=()=>{this.base=serverAt||null;this.saved=serverNote||'';$('note').value=this.saved;this.conflict=null;this.clearDraft(this.item.id);this.setState('已改用 '+when(serverAt)+' 保存的版本。','');};
    const peek=el('details',{},[el('summary',{text:'查看另一份內容'}),el('div',{style:'white-space:pre-wrap',text:serverNote||'（空白）'})]);
    this.setState('筆記已在其他分頁或裝置更新（'+when(serverAt)+'）。你的內容尚未保存，請選擇要保留哪一份。','error',[keepMine,useTheirs,peek]);
  },
};
$('note').addEventListener('input',()=>notes.input());
$('note').addEventListener('blur',()=>{if(notes.dirty()&&!notes.conflict)notes.save();});
window.addEventListener('online',()=>{if(notes.dirty()&&!notes.conflict)notes.save();});
window.addEventListener('beforeunload',e=>{if(notes.dirty()||notes.inflight){e.preventDefault();e.returnValue='';}});
const questionStates={waiting_local:'已保存，等待 Mac 回答',generating:'Mac 正在回答',failed:'回答失敗',done:'已回答'};let questionTimer=null,watching=null;
const questions={
  open(item){watching=null;$('answer').replaceChildren();$('answer-sources').replaceChildren();if(!item)document.querySelector('input[name=scope][value=all]').checked=true;loadHistory().catch(()=>{});},
};
function scopeId(){return document.querySelector('input[name=scope]:checked').value==='article'&&current?current.id:null;}
function renderQuestion(q){
  if(q.status==='done'){$('answer').innerHTML=q.answer_html;$('answer-sources').replaceChildren(...(q.sources||[]).map(s=>el('li',{},[safeLink(s.url,(RELATIONS[s.relation]||s.relation)+'・'+s.url),s.excerpt?el('span',{class:'preview',text:s.excerpt}):null,citeButton(s)])));}
  else{$('answer').textContent=(questionStates[q.status]||q.status)+(q.error?'：'+q.error:'。')+(q.status==='failed'?'':'可以離開這頁，之後在提問紀錄查看。');$('answer-sources').replaceChildren();}
}
// 回答引用的片段若來自目前文章，可直接在保存的原文中標出，核對模型是否忠於來源。
function citeButton(s){
  if(!current||s.item_id!==current.id)return null;
  if(s.id.startsWith('media:')||s.id.endsWith(':observations')){const b=el('button',{type:'button',class:'stamp',text:'查看媒體證據'});b.onclick=()=>{const m=$('media');if(m){m.scrollIntoView({block:'start'});m.setAttribute('tabindex','-1');m.focus({preventScroll:true});}};return b;}
  const b=el('button',{type:'button',class:'stamp',text:'在原文中標出'});b.onclick=()=>showExcerpt(s.id.split(':')[0],s.range_start||0,(s.excerpt||'').length);return b;
}
function showExcerpt(evidenceId,start,length){
  const d=document.querySelector('details[data-evidence="'+evidenceId+'"]');if(!d){message('這篇文章的原文區塊中找不到這個片段。',true);return;}
  const text=d.querySelector('.text');if(!text)return;
  const full=text.textContent,mark=el('mark',{tabindex:'-1',text:full.slice(start,start+length)});
  text.replaceChildren(document.createTextNode(full.slice(0,start)),mark,document.createTextNode(full.slice(start+length)));
  d.open=true;mark.scrollIntoView({block:'center'});mark.focus({preventScroll:true});
}
async function loadHistory(){
  const id=scopeId(),list=await api('questions'+(id?'?item_id='+id:''));
  if(id!==scopeId())return;
  $('history').replaceChildren(...list.map(q=>{const body=el('div',{class:'article-body'});if(q.status==='done')body.innerHTML=q.answer_html;else body.textContent=questionStates[q.status]||q.status;const refs=el('ul',{},(q.sources||[]).map(s=>el('li',{},[safeLink(s.url,(RELATIONS[s.relation]||s.relation)+'・'+s.url),citeButton(s)])));if(['waiting_local','generating'].includes(q.status)&&watching!==q.id)pollQuestion(q.id,true);return el('details',{'data-question':q.id},[el('summary',{text:q.question.slice(0,80)+'・'+(questionStates[q.status]||q.status)+'・'+when(q.created_at)}),body,refs]);}));
  if(!list.length)$('history').textContent='尚無提問。';
}
// 追問進度：只追蹤目前範圍內的問題；切換文章或範圍後，舊問題的回應不會寫進新的回答區。
function pollQuestion(id,quiet){clearTimeout(questionTimer);watching=id;const scope=scopeId();questionTimer=setTimeout(async()=>{if(watching!==id||scope!==scopeId())return;if(document.hidden){pollQuestion(id,quiet);return;}try{const q=await api('questions/'+id);if(watching!==id||scope!==scopeId())return;if(!quiet)renderQuestion(q);if(['waiting_local','generating'].includes(q.status))pollQuestion(id,quiet);else{watching=null;await loadHistory();}}catch(e){message('提問進度更新失敗：'+e.message,true);}},5000);}
$('ask-form').onsubmit=e=>{e.preventDefault();run(async()=>{const scoped=document.querySelector('input[name=scope]:checked').value==='article';if(scoped&&!current)throw Error('請先選一篇文章，或改為整個文章庫。');$('answer').textContent='正在保存問題並檢索來源…';const q=await api('ask','POST',{question:$('question').value,item_id:scoped?current.id:null});renderQuestion(q);if(['waiting_local','generating'].includes(q.status))pollQuestion(q.id);await loadHistory();},e.submitter||e.target.querySelector('button'),'送出中…');};
for(const radio of document.querySelectorAll('input[name=scope]'))radio.onchange=()=>{watching=null;run(loadHistory);};
$('search-form').onsubmit=e=>{e.preventDefault();run(()=>navigate({q:$('search').value.trim(),page:0,article:null}));};
$('unread').onchange=()=>run(()=>navigate({unread:$('unread').checked,page:0}));
$('origin').onchange=()=>run(()=>navigate({origin:$('origin').value,page:0}));
$('state').onchange=()=>run(()=>navigate({state:$('state').value,page:0}));
$('previous').onclick=e=>run(()=>navigate({page:Math.max(0,view.page-1)}),e.currentTarget,'載入中…');
$('next').onclick=e=>run(()=>navigate({page:view.page+1}),e.currentTarget,'載入中…');
$('back').onclick=()=>{if(history.state&&history.state.fromList)history.back();else run(()=>navigate({article:null}));};
$('collect-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await api('collect','POST',{url:$('url').value});$('url').value='';message('已收到並保存連結。完成後會透過 Telegram 通知。');listKey=null;await navigate({article:r.id});},e.submitter||e.target.querySelector('button'),'加入中…');};
document.addEventListener('keydown',e=>{
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if(e.key==='/'&&!typing){e.preventDefault();$('search').focus();}
  if(e.key==='Escape'&&narrow.matches&&view.article&&!typing)$('back').click();
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){poll();runnerStatus();}});
bindLogin(boot);
async function boot(){
  await api('status');showApp();view=readView();listKey=null;await apply();runnerStatus();
  clearInterval(pollTimer);clearInterval(statusTimer);pollTimer=setInterval(poll,8000);statusTimer=setInterval(runnerStatus,30000);
}
run(boot);
</script></body></html>`;

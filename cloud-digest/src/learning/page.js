import { STYLE, HELPERS, LOGIN } from './ui.js';

export const LEARNING_PAGE = String.raw`<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechNews · 文章庫</title>
<style>${STYLE}
html,body{height:100%}
body.app{display:flex;flex-direction:column}
.top form{display:flex;gap:8px;flex:1 1 360px;max-width:560px}.top form input{flex:1;min-width:0}
.layout{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr)}
#library{border-right:1px solid var(--line);overflow:auto;padding:0 16px 16px;background:var(--paper)}
.reader-wrap{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column}
#reader{flex:1;min-height:0;overflow:auto;padding:24px clamp(16px,4vw,48px) calc(var(--dock-h,64px) + 40px);scroll-padding-bottom:calc(var(--dock-h,64px) + 32px);outline:none}
/* 列表頂端（搜尋、排序、篩選）捲動時固定；列表依日期分組，每篇只留閱讀需要的資訊。 */
.list-head{position:sticky;top:0;z-index:3;background:var(--paper);margin:0 -16px;padding:12px 16px 0;border-bottom:1px solid var(--line)}
#search{width:100%}
.tools{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:space-between;margin:6px 0}
.tools label{display:flex;align-items:center;gap:6px;min-height:44px;font-size:14px}.tools input[type=checkbox]{min-height:auto;width:20px;height:20px}
.tools select{min-height:36px;padding:4px 8px;font-size:14px}
#manage-toggle{min-height:36px;padding:4px 10px;font-size:14px;border-color:transparent;background:none;color:var(--muted);text-decoration:underline}
#manage-toggle.active{color:var(--accent);font-weight:700}
#manage{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;padding:4px 0 12px}#manage[hidden]{display:none}#manage label{display:block;margin-bottom:4px;font-size:13px}#manage select{width:100%}
#list{padding:0 0 8px}
.day{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:16px 0 2px;font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.02em}
.day-items{list-style:none;margin:0;padding:0}
.day-items a{display:grid;grid-template-columns:8px minmax(0,1fr);gap:0 10px;padding:9px 10px;margin:0 -10px;color:var(--ink);text-decoration:none;border-radius:6px}
.day-items a:hover{background:#f4f8f7}.day-items a[aria-current=page]{background:var(--soft);box-shadow:inset 3px 0 0 var(--accent)}
.topic-dot{width:8px;height:8px;border-radius:50%;margin-top:8px;background:var(--line)}
.day-items strong{font-size:15px;line-height:1.45;font-weight:400;color:#33504c;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.day-items .unread strong{font-weight:700;color:var(--ink)}
.item-meta{grid-column:2;display:flex;flex-wrap:wrap;gap:0 6px;font-size:12px;line-height:1.6;color:var(--muted);margin-top:2px}
.item-meta .sep:before{content:"·"}
.item-meta .state{font-weight:700}.item-meta .state.warn{color:var(--warn)}.item-meta .state.wait{color:#22408a}
.preview{grid-column:2;display:block;color:var(--muted);font-size:13px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
#more{width:100%;margin-top:8px;color:var(--muted)}#more[hidden]{display:none}
.chips{display:flex;gap:6px;overflow-x:auto;margin:0 -16px;padding:2px 16px 10px;scrollbar-width:thin}
.chips button{flex:none;min-height:36px;padding:4px 12px;border-radius:999px;font-size:13px;display:inline-flex;align-items:center;gap:6px}
.chips button[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
.chips small{opacity:.75;font-variant-numeric:tabular-nums}
.chips .topic-dot{margin:0}
.topic-row{display:flex;flex-wrap:wrap;align-items:center;gap:0 4px;margin-bottom:4px}
.topic-row .linkish{min-height:32px;padding:2px 8px;border:0;background:none;color:var(--accent);text-decoration:underline;font-size:13px;margin-bottom:6px}
.topic-form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin:4px 0 12px}.topic-form label{display:block;font-size:13px;margin-bottom:4px}.topic-form select{min-height:40px}
.topic-tag{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:2px 10px;border:1px solid var(--line);border-radius:999px;margin:0 6px 6px 0;color:var(--ink)}.topic-tag .topic-dot{margin:0}
.reader-bar{display:none;margin-bottom:12px;align-items:center;justify-content:space-between;gap:8px}
body[data-view=reader] .reader-bar{display:flex}#back{visibility:hidden}#read-end{height:1px}
#focus-toggle{margin-left:auto;min-height:36px;padding:4px 14px}#focus-toggle[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
/* 專注模式：只留標題、主題・發布者・發表日、篩選按鈕、正文、媒體、原始來源、問答與筆記追問。 */
body.focus[data-view=reader][data-mode=""] #library,body.focus[data-view=reader][data-mode=""] header.top{display:none}
body.focus[data-view=reader][data-mode=""] .layout{grid-template-columns:minmax(0,1fr)}
body.focus[data-view=reader][data-mode=""] :is(.admin-info,.process-note,.versions,.manage){display:none!important}
body.focus[data-view=reader][data-mode=""] #article{max-width:880px;margin:0 auto}
/* 篩選檢視與頂端入口：保留是預設檢視；待決定與最近刪除用同一排切換。 */
.entry-bar{display:flex;flex-wrap:wrap;gap:6px 12px;margin:0 0 8px;font-size:14px}.entry-bar[hidden]{display:none}
.entry-bar a{display:inline-flex;align-items:center;min-height:36px;padding:2px 12px;border-radius:999px;background:var(--soft);color:var(--ink);text-decoration:none;font-weight:600}
.entry-bar a strong{margin-left:4px;font-variant-numeric:tabular-nums}
.views{display:flex;gap:4px;overflow-x:auto;margin:8px -16px 0;padding:0 16px 2px;scrollbar-width:none}
.views button{flex:none;min-height:36px;padding:4px 12px;border:0;border-radius:8px;background:none;color:var(--muted);font-size:14px;font-weight:600}
.views button[aria-pressed=true]{background:var(--soft);color:var(--ink)}
.star{color:#b45309;margin-right:4px}
.deleted-row{display:flex;align-items:flex-start;gap:8px}.deleted-row a{flex:1;min-width:0}
.deleted-row button{flex:none;min-height:36px;padding:4px 12px;margin-top:6px}
.triage-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 4px}
.triage-bar button{min-height:40px;padding:6px 14px}
.triage-bar button[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
.triage-bar .muted{margin-left:4px}
/* 一次一篇的模式（篩選、複習、週回顧）：隱藏列表與筆記追問，內容置中。 */
body.app:not([data-mode=""]) #library,body.app:not([data-mode=""]) #dock{display:none}
body.app:not([data-mode=""]) .layout{grid-template-columns:minmax(0,1fr)}
body.app:not([data-mode=""]) #reader{padding-bottom:40px}body.app:not([data-mode=""]) .reader-bar{display:none}
#mode{max-width:760px;margin:0 auto}#mode[hidden]{display:none}
.mode-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:0 0 12px}
.mode-head h1{font-size:20px;margin:0}.mode-head .links{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.mode-head .links button{min-height:36px;padding:4px 12px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px clamp(16px,3vw,28px)}
.card h2{font-size:22px;line-height:1.45;margin:6px 0 8px;outline:none;overflow-wrap:anywhere}
.card .intro{font-size:16px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}
.card .waiting{font-size:14px;color:var(--warn)}
.decide{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 0 0}
.decide button,#mode .actions button{display:inline-flex;align-items:center;justify-content:center;gap:8px}
kbd{font:12px ui-monospace,SFMono-Regular,monospace;border:1px solid currentColor;border-radius:4px;padding:0 5px;opacity:.75}
.keys{margin:0 0 12px;padding:12px 16px;border:1px dashed var(--line);border-radius:8px;font-size:14px;line-height:1.9}.keys[hidden]{display:none}
.done-box{text-align:center;padding:40px 16px}
#similar .subhead{font-weight:700;font-size:14px;margin:12px 0 4px}.similar-list{margin:0;padding-left:1.2em;line-height:1.8;font-size:15px}
@media(max-width:959px){body.app:not([data-mode=""]) .reader-wrap{display:block}body.app:not([data-mode=""]) .reader-bar{display:none}.decide{grid-template-columns:repeat(2,minmax(0,1fr))}}
#article-title{font-size:28px;line-height:1.45;margin:0 0 8px;outline:none}
.meta{color:var(--muted);font-size:14px;line-height:1.7}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
section.block{border-top:1px solid var(--line);margin-top:28px;padding-top:20px;max-width:880px}section.block h2{font-size:19px;margin:0 0 12px}
.label{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--muted);text-transform:none;margin-bottom:6px}
.source{margin:10px 0;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper)}.source summary{min-height:32px;cursor:pointer}
.source .text{white-space:pre-wrap;line-height:1.75;max-height:420px;overflow:auto;font-size:15px;margin-top:8px}
.analysis{border-left:3px solid var(--line);padding-left:14px;margin:12px 0 20px}.stamp{min-height:32px;padding:2px 8px;font-variant-numeric:tabular-nums;margin-right:6px}mark{background:#fde68a;color:inherit;outline:none}#answer-sources li{margin:8px 0}
#media img,#media video{max-width:100%;max-height:440px;display:block;margin:12px 0 8px;border-radius:6px}
.gap{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0}.gap button{min-height:36px;padding:4px 12px}
.media-item{margin:0 0 28px}.obs{display:flex;gap:8px;align-items:baseline;margin:6px 0;line-height:1.7}.obs .stamp{flex:none;margin:0}
#ask-scope{display:flex;gap:16px;flex-wrap:wrap}#ask-scope label,#unkept-label{display:flex;align-items:center;gap:8px;min-height:44px}#ask-scope input,#unkept-label input{min-height:auto;width:18px;height:18px}#unkept-label[hidden]{display:none}
.kept-tag{display:inline-block;font-size:12px;font-weight:700;border-radius:4px;padding:0 6px;margin-right:6px;background:var(--soft)}.kept-tag.no{background:var(--warn-bg);color:var(--warn)}
#answer{margin-top:16px}#history details{border-bottom:1px solid var(--line);padding:4px 0}#history summary{min-height:44px;cursor:pointer;padding:10px 0}
.empty{padding:48px 0;color:var(--muted)}
.note-state{font-size:13px;min-height:20px;margin-top:6px}.note-state.error{color:var(--danger)}
/* 筆記與追問：閱讀區下方懸浮、可收合的對話框。閱讀區底部留白跟著對話框實際高度（--dock-h）調整。 */
#dock{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);width:min(880px,calc(100% - 32px));z-index:4;display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 28px rgba(24,58,55,.18);overflow:hidden}
#dock.open{height:46vh}
.dock-bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px}
#dock-tabs{flex:none;display:flex;gap:4px}
#dock-tabs button{position:relative;border:0;border-radius:999px;background:none;font-weight:600;color:var(--muted);padding:8px 18px}
#dock-tabs button[aria-selected=true]{background:var(--soft);color:var(--ink)}
#dock-tabs button.alert:after{content:"";position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--danger)}
#quick-ask{flex:1;min-width:0;display:flex}#quick-ask input{flex:1;min-width:0}
#dock.open #quick-ask{display:none}
#dock-toggle{flex:none;margin-left:auto;display:inline-flex;align-items:center;gap:6px}
#dock-toggle svg{width:18px;height:18px;transition:transform .2s ease}#dock.open #dock-toggle svg{transform:rotate(180deg)}
.dock-body{display:none;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 16px 16px;border-top:1px solid var(--line)}
#dock.open .dock-body{display:block;animation:dock-in .18s ease-out}
@keyframes dock-in{from{opacity:0;transform:translateY(6px)}}
.tabpanel[hidden]{display:none}
#note{min-height:180px;margin-top:12px}#question{min-height:88px}
#ask-form{margin-top:8px}
@media(prefers-reduced-motion:reduce){#dock.open .dock-body{animation:none}}
@media(max-width:959px){
  body.app{display:block;height:auto}.layout{display:block}
  #library{border-right:0;overflow:visible}.list-head{top:0}
  .reader-wrap{display:block}#reader{overflow:visible;padding:16px 16px calc(var(--dock-h,64px) + 24px)}
  html{scroll-padding-bottom:calc(var(--dock-h,64px) + 16px)}
  body[data-view=reader] #library{display:none}body[data-view=list] .reader-wrap{display:none}
  #dock{position:fixed;left:0;right:0;bottom:0;transform:none;width:auto;border-radius:16px 16px 0 0;border-bottom:0;padding-bottom:env(safe-area-inset-bottom)}
  #dock.open{height:auto;max-height:78vh;max-height:78dvh}
  #quick-ask{display:none}
  .top{position:static}body[data-view=reader] .reader-bar{position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}#back{visibility:visible}
  #article-title{font-size:23px}.article-body{font-size:16px}
  .top{padding:10px 12px}.top form{order:3;flex-basis:100%;max-width:none}
}
</style></head><body class="app" data-view="list" data-mode="">
<header class="top"><a class="brand" href="/learning">TechNews 文章庫</a>
<form id="collect-form"><label class="sr" for="url">分享連結</label><input id="url" type="url" placeholder="貼上 X 貼文或文章網址" required><button class="primary">加入文章庫</button></form>
<nav><span id="runner-pill" class="pill" role="status">狀態載入中</span><a href="/learning/admin">管理</a><button id="logout" class="hidden">登出</button></nav></header>
<div id="feedback" role="status" aria-live="polite"></div>
${LOGIN}
<main id="app" class="layout hidden">
<aside id="library" aria-label="文章列表">
  <div class="list-head">
  <div id="entry-bar" class="entry-bar" hidden></div>
  <form id="search-form" role="search"><label class="sr" for="search">搜尋標題、正文與保存的原文</label><input id="search" type="search" placeholder="搜尋標題、正文與原文（按 / ）"></form>
  <div class="tools">
    <label><input type="checkbox" id="unread"> 只看未讀</label>
    <label>排序 <select id="sort"><option value="published">發表時間</option><option value="added">加入時間</option></select></label>
    <button type="button" id="manage-toggle" aria-expanded="false" aria-controls="manage">管理篩選</button>
  </div>
  <div id="manage" hidden>
    <div><label for="origin">收件入口</label><select id="origin"><option value="">全部入口</option><option value="official">官方來源</option><option value="bookmark">X 書籤</option><option value="backfill">書籤回補</option><option value="share">Telegram 分享</option><option value="web">網站加入</option></select></div>
    <div><label for="state">處理狀態</label><select id="state"><option value="">全部（不含已略過）</option><option value="ready">已完成</option><option value="needs_action">需要處理（錯誤、缺漏）</option><option value="waiting_local">等待本機／本機生成中</option><option value="paused">費用暫停／手動暫停</option><option value="processing">排隊與取得來源中</option><option value="awaiting_backfill">等待確認回補</option><option value="legacy">既有導讀</option><option value="filtered">主題不符・已略過</option></select></div>
  </div>
  <div id="views" class="views" role="group" aria-label="篩選結果"></div>
  <div id="topics" class="chips" role="group" aria-label="主題"></div>
  </div>
  <p id="list-summary" class="sr" aria-live="polite"></p>
  <div id="list"></div>
  <div id="list-end" aria-hidden="true"></div>
  <button type="button" id="more" hidden>載入更多</button>
</aside>
<div class="reader-wrap">
<div id="reader" tabindex="-1" aria-label="閱讀區">
  <div class="reader-bar"><button id="back">← 返回列表</button><button type="button" id="focus-toggle" aria-pressed="false" title="隱藏列表與管理資訊；Esc 離開">專注</button></div>
  <div id="mode" hidden></div>
  <div id="article"><div class="empty"><h1 style="font-size:22px">選一篇文章開始閱讀</h1><p>官方文章、X 書籤與分享都在左側列表。處理狀態會自動更新。</p></div></div>
</div>
<section id="dock" aria-label="筆記與追問">
  <div class="dock-bar">
    <div id="dock-tabs" role="tablist" aria-label="筆記與追問">
      <button type="button" role="tab" id="tab-note" data-tab="note" aria-selected="false" aria-controls="notes-panel" tabindex="-1" hidden>筆記<span id="note-alert" class="sr"></span></button>
      <button type="button" role="tab" id="tab-ask" data-tab="ask" aria-selected="true" aria-controls="ask-panel">追問</button>
    </div>
    <form id="quick-ask"><label class="sr" for="quick-question">快速追問</label><input id="quick-question" maxlength="2000" autocomplete="off" placeholder="問整個文章庫，按 Enter 送出"></form>
    <button type="button" id="dock-toggle" aria-expanded="false" aria-controls="dock-body"><span id="dock-toggle-text">展開</span><span class="sr">筆記與追問</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 15l6-6 6 6"/></svg></button>
  </div>
  <div id="dock-body" class="dock-body">
    <div id="notes-panel" class="tabpanel" role="tabpanel" aria-labelledby="tab-note" hidden><label class="sr" for="note">筆記內容</label><textarea id="note" maxlength="20000" rows="8" placeholder="寫下自己的理解或待辦；會自動保存"></textarea><div id="note-state" class="note-state" role="status" aria-live="polite"></div><div id="note-actions" class="actions"></div></div>
    <div id="ask-panel" class="tabpanel" role="tabpanel" aria-labelledby="tab-ask">
      <form id="ask-form"><fieldset style="border:0;padding:0;margin:0"><legend class="sr">追問範圍</legend><div id="ask-scope"><label><input type="radio" name="scope" value="article" checked> 目前文章</label><label><input type="radio" name="scope" value="all"> 整個文章庫</label></div></fieldset>
      <label id="unkept-label" hidden><input type="checkbox" id="include-unkept"> 也查未保留（只比對關鍵字，排在保留文章之後）</label>
      <label for="question">你的問題</label><textarea id="question" maxlength="2000" placeholder="例如：這個設定需要哪個版本？" required></textarea><div class="actions"><button class="primary">依來源回答</button></div></form>
      <div id="answer" class="article-body" aria-live="polite"></div><ul id="answer-sources"></ul>
      <h3 style="font-size:16px">提問紀錄</h3><div id="history" class="muted">尚無提問。</div>
    </div>
  </div>
</section>
</div>
</main>
<script>
${HELPERS}
let view={q:'',unread:false,origin:'',state:'',sort:'published',topic:'',triage:'kept',article:null,mode:''},listKey=null,listItems=[],topicData={topics:[],unclassified:0,total:0},hasMore=false,loadingMore=false,current=null,openSeq=0,pollTimer=null,statusTimer=null;
const narrow=matchMedia('(max-width: 959px)');
// 篩選檢視：保留是預設；選擇存在網址，重新整理或返回時維持同一個檢視。
const VIEWS=[['kept','保留'],['starred','★ 常用'],['pending','待決定'],['all','全部'],['deleted','最近刪除']];
const TRIAGE_LABEL={pending:'待決定',kept:'保留',starred:'保留 ★',deleted:'最近刪除'};
const MODE_NAMES=['triage'];
function readView(){const p=new URLSearchParams(location.search),t=p.get('triage'),m=p.get('view');return {q:p.get('q')||'',unread:p.get('unread')==='1',origin:p.get('origin')||'',state:p.get('state')||'',sort:p.get('sort')==='added'?'added':'published',topic:p.get('topic')||'',triage:VIEWS.some(v=>v[0]===t)?t:'kept',article:p.get('article'),mode:MODE_NAMES.includes(m)&&!p.get('article')?m:''};}
function urlFor(v){const p=new URLSearchParams();if(v.mode&&!v.article)p.set('view',v.mode);if(v.triage&&v.triage!=='kept')p.set('triage',v.triage);if(v.q)p.set('q',v.q);if(v.unread)p.set('unread','1');if(v.origin)p.set('origin',v.origin);if(v.state)p.set('state',v.state);if(v.sort==='added')p.set('sort','added');if(v.topic)p.set('topic',v.topic);if(v.article)p.set('article',v.article);const s=p.toString();return '/learning'+(s?'?'+s:'');}
function listScroll(){return narrow.matches?window.scrollY:$('library').scrollTop;}
function restoreScroll(y){if(y==null)return;requestAnimationFrame(()=>{if(narrow.matches)window.scrollTo(0,y);else $('library').scrollTop=y;});}
// 每次換頁前記住列表捲動位置；返回時由瀏覽器歷史還原。
function navigate(next,fromList){history.replaceState({...(history.state||{}),listScroll:listScroll()},'',location.href);view={...view,...('article' in next&&next.article?{mode:''}:{}),...next};history.pushState({fromList:!!fromList},'',urlFor(view));return apply();}
function renderViews(){$('views').replaceChildren(...VIEWS.map(([value,label])=>{const b=el('button',{type:'button','aria-pressed':String(view.triage===value),'data-triage':value,text:label});b.onclick=()=>run(()=>navigate({triage:value,article:null}));return b;}));}
function syncControls(){renderViews();$('search').value=view.q;$('unread').checked=view.unread;$('origin').value=view.origin;$('state').value=view.state;$('sort').value=view.sort;$('manage-toggle').classList.toggle('active',!!(view.origin||view.state));}
async function apply(){
  syncControls();
  document.body.dataset.mode=view.mode||'';
  // 一次一篇的模式：隱藏列表與閱讀內容，模式內容放在閱讀區。
  if(view.mode){
    document.body.dataset.view='reader';
    if(current)clearArticle();
    $('article').hidden=true;$('mode').hidden=false;
    await MODES[view.mode].open();
    return;
  }
  $('mode').hidden=true;$('article').hidden=false;
  const key=JSON.stringify([view.triage,view.q,view.unread,view.origin,view.state,view.sort,view.topic]);
  if(key!==listKey){listKey=key;await loadList();}
  document.body.dataset.view=view.article?'reader':'list';
  if(view.article){if(view.article!==(current&&current.id))await openArticle(view.article);}else clearArticle();
  markSelected();
}
window.addEventListener('popstate',e=>{view=readView();run(async()=>{await apply();if(!view.article)restoreScroll(e.state&&e.state.listScroll);});});
function describeFilters(){const parts=[(VIEWS.find(v=>v[0]===view.triage)||[,''])[1]];if(view.q)parts.push('搜尋「'+view.q+'」');if(view.unread)parts.push('未讀');if(view.origin)parts.push(ORIGINS[view.origin]);if(view.state)parts.push($('state').selectedOptions[0].textContent);if(view.topic)parts.push(view.topic==='unclassified'?'未分類':(topicById(view.topic)||{name:view.topic}).name);return parts.join('・');}
// 每批 50 篇，捲到底自動接著載入；篩選或排序改變時從第一批重新載入。
function filterQuery(){const p=new URLSearchParams();p.set('triage',view.triage);if(view.q)p.set('q',view.q);if(view.unread)p.set('unread','1');if(view.origin)p.set('origin',view.origin);if(view.state)p.set('state',view.state);return p;}
function listQuery(offset){const p=filterQuery();p.set('sort',view.sort);if(view.topic)p.set('topic',view.topic);p.set('offset',String(offset));return p;}
async function loadList(){
  const key=listKey,[items,topics]=await Promise.all([api('items?'+listQuery(0).toString()),api('topics?'+filterQuery().toString())]);
  if(key!==listKey)return;
  topicData=topics;renderTopics();
  listItems=items;hasMore=items.length===50;renderList();
}
// 主題 chip：全部、各主題、未分類，附篇數；單選，與搜尋、未讀、管理篩選並用。
function topicById(id){return topicData.topics.find(t=>t.id===id);}
function topicColor(id){const t=topicById(id);return t?t.color:'';}
function topicNames(i){return [i.topic_primary,i.topic_secondary].map(topicById).filter(Boolean).map(t=>t.name);}
function chip(value,label,count,color){
  const b=el('button',{type:'button','aria-pressed':String(view.topic===value),'data-topic':value},[color?el('span',{class:'topic-dot',style:'background:'+color,'aria-hidden':'true'}):null,document.createTextNode(label),el('small',{text:String(count)})]);
  b.onclick=()=>run(()=>navigate({topic:view.topic===value&&value?'':value,article:null}));
  return b;
}
function renderTopics(){
  $('topics').replaceChildren(chip('','全部',topicData.total),...topicData.topics.map(t=>chip(t.id,t.name,t.count,t.color)),...(topicData.unclassified?[chip('unclassified','未分類',topicData.unclassified)]:[]));
  const pressed=$('topics').querySelector('[aria-pressed=true]');if(pressed)pressed.scrollIntoView({block:'nearest',inline:'nearest'});
}
async function loadMore(){
  if(!hasMore||loadingMore)return;
  loadingMore=true;const key=listKey;
  try{
    const items=await api('items?'+listQuery(listItems.length).toString());
    if(key!==listKey)return;
    const seen=new Set(listItems.map(i=>i.id));
    listItems=listItems.concat(items.filter(i=>!seen.has(i.id)));hasMore=items.length===50;renderList();
  }finally{loadingMore=false;}
}
// 日期依台灣時間顯示；沒有原文發表時間時明示是加入時間，避免誤認。
const WEEKDAYS=['日','一','二','三','四','五','六'];
function twDate(iso){const d=new Date(Date.parse(iso)+8*3600e3);return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),week:d.getUTCDay()};}
function shortDate(iso){const d=twDate(iso);return d.month+'/'+d.day;}
function fullDate(iso){const d=twDate(iso);return d.year+'/'+d.month+'/'+d.day;}
function itemDate(i){return i.published_at?shortDate(i.published_at):'日期未知・加入於 '+shortDate(i.created_at);}
function groupTime(i){return view.triage==='deleted'?i.deleted_at:view.sort==='added'?i.created_at:(i.published_at||i.created_at);}
function dayLabel(iso){const d=twDate(iso),year=twDate(new Date().toISOString()).year;return (d.year!==year?d.year+' 年 ':'')+d.month+' 月 '+d.day+' 日（週'+WEEKDAYS[d.week]+'）';}
function renderList(){
  const groups=[];
  for(const i of listItems){const label=(view.triage==='deleted'?'刪除於 ':'')+dayLabel(groupTime(i)),last=groups[groups.length-1];if(last&&last.label===label)last.items.push(i);else groups.push({label,items:[i]});}
  $('list').replaceChildren(...groups.map(g=>el('section',{'aria-label':g.label},[el('h3',{class:'day'},[el('span',{text:g.label}),el('span',{text:g.items.length+' 篇'})]),el('ul',{class:'day-items'},g.items.map(renderItem))])));
  if(!listItems.length)$('list').append(el('p',{class:'empty',text:emptyText()}));
  $('list-summary').textContent='已載入 '+listItems.length+' 篇'+(describeFilters()?'（'+describeFilters()+'）':'');
  $('more').hidden=!hasMore;
  markSelected();
}
function emptyText(){const filtered=view.q||view.unread||view.origin||view.state||view.topic;if(filtered)return '沒有符合的文章。';return {kept:'還沒有保留的文章。到「待決定」篩選新文章，值得留的按保留。',starred:'還沒有 ★ 常用參考。在保留的文章按 ★ 標記常回來看的文章。',pending:'待決定已清空。',deleted:'最近刪除是空的。刪除的文章會在這裡保留 7 天。',all:'文章庫還沒有文章。'}[view.triage]||'沒有符合的文章。';}
// 剩餘天數：無條件進位，最後一天顯示「不到 1 天」。
function daysLeft(iso){const ms=Date.parse(iso)-Date.now();return ms<=0?0:Math.ceil(ms/86400e3);}
function leftText(iso){const d=daysLeft(iso);return d<=1?'不到 1 天':d+' 天';}
function triageState(i){return i.triage==='deleted'?'deleted':i.triage==='kept'?(i.starred?'starred':'kept'):'pending';}
// 已完成的文章不顯示狀態；未完成或有問題（含部分完成）才附在資訊列後面。
function stateNode(i){return i.status==='ready'?null:el('span',{class:'state '+stateTone(i.status),text:stateLabel(i),'data-role':'state'});}
function renderItem(i){
  const names=topicNames(i);
  const meta=el('span',{class:'item-meta'},[names.length?el('span',{text:names.join('、')}):null,names.length?el('span',{class:'sep','aria-hidden':'true'}):null,i.publisher?el('span',{text:i.publisher}):null,i.publisher?el('span',{class:'sep','aria-hidden':'true'}):null,el('span',{text:itemDate(i)})]);
  const state=stateNode(i);if(state)meta.append(el('span',{class:'sep','aria-hidden':'true'}),state);
  const title=el('strong',{},[i.starred&&i.triage==='kept'?el('span',{class:'star',text:'★','aria-label':'常用參考'}):null,document.createTextNode(i.title||(i.preview||'').slice(0,80)||i.url)]);
  const a=el('a',{href:urlFor({...view,article:i.id}),'data-id':i.id},[el('span',{class:'topic-dot','aria-hidden':'true',style:topicColor(i.topic_primary)?'background:'+topicColor(i.topic_primary):''}),title,meta]);
  if(!i.read_at)a.classList.add('unread');
  if(i.status==='awaiting_backfill'&&i.preview)a.append(el('span',{class:'preview',text:i.preview}));
  a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();run(()=>navigate({article:i.id},true));};
  if(i.triage!=='deleted')return el('li',{},[a]);
  // 最近刪除：剩幾天清除、手動刪除或逾期移入，旁邊是「復原」。
  a.append(el('span',{class:'preview',text:'還剩 '+leftText(i.purge_at)+'清除・'+(i.deleted_reason==='expired'?'待決定逾期移入':'手動刪除')}));
  const restore=el('button',{type:'button',text:'復原','aria-label':'復原「'+(i.title||i.url)+'」'});
  restore.onclick=()=>run(()=>triage(i.id,'restore'),restore,'復原中…');
  return el('li',{class:'deleted-row'},[a,restore]);
}
function markSelected(){for(const a of document.querySelectorAll('#list a[data-id]'))if(current&&a.dataset.id===current.id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
function clearArticle(){current=null;openSeq++;$('article').replaceChildren(el('div',{class:'empty'},[el('h1',{style:'font-size:22px',text:'選一篇文章開始閱讀'}),el('p',{text:'官方文章、X 書籤與分享都在左側列表。處理狀態會自動更新。'})]));notes.close();questions.open(null);}
async function openArticle(id){
  const seq=++openSeq;
  let result;
  try{result=await api('items/'+id);}catch(e){if(seq===openSeq){current=null;$('article').replaceChildren(el('p',{class:'notice',text:'無法開啟這篇文章：'+e.message}));}return;}
  // 快速切換時，較慢回來的舊回應不能覆蓋目前文章。
  if(seq!==openSeq)return;
  current=result.item;
  if(current.id!==id){view.article=current.id;history.replaceState(history.state,'',urlFor(view));}
  if(narrow.matches)dock.toggle(false);
  renderArticle(result);applyState(current);notes.open(current);questions.open(current);markSelected();
  const title=$('article-title');if(title)title.focus({preventScroll:true});
  $('reader').scrollTop=0;if(narrow.matches)window.scrollTo(0,0);
}
async function refreshArticle(){if(!current)return;const seq=openSeq,result=await api('items/'+current.id);if(seq!==openSeq||result.item.id!==current.id)return;current=result.item;renderArticle(result);notes.sync(current);}
function provenance(a){if(!a)return '';if(a.legacy)return '搬移前的官方短導讀'+(a.model?'（'+a.model+'）':'，未保存模型資訊');if(a.provider==='ollama')return '本機 '+(a.model||'Gemma')+' 整理';if(a.provider==='gemini')return 'Gemini '+(a.model||'')+' 整理';if(a.provider==='demo')return '示範資料';return a.model||'';}
// 閱讀頁主題：顯示主要與次要主題，可手動修改；手動設定的主題不會被自動分類覆寫。
function topicRow(item){
  const tags=[item.topic_primary,item.topic_secondary].map(topicById).filter(Boolean);
  const row=el('div',{class:'topic-row',id:'article-topics'},tags.length?tags.map(t=>el('span',{class:'topic-tag'},[el('span',{class:'topic-dot',style:'background:'+t.color,'aria-hidden':'true'}),document.createTextNode(t.name)])):[el('span',{class:'topic-tag',text:'未分類'})]);
  if(item.topic_source==='manual')row.append(el('span',{class:'muted',text:'手動設定'}));
  const edit=el('button',{type:'button',class:'linkish manage','aria-expanded':'false',text:'修改主題'});
  edit.onclick=()=>{const open=!row.nextSibling||!row.nextSibling.classList.contains('topic-form');if(open)row.after(topicForm(item,edit));else row.nextSibling.remove();edit.setAttribute('aria-expanded',String(open));if(open)row.nextSibling.querySelector('select').focus();};
  row.append(edit);
  if(item.topic_source==='manual'){const auto=el('button',{type:'button',class:'linkish manage',text:'改回自動分類'});auto.onclick=e=>run(()=>saveTopics(item.id,{auto:true},'已改回自動分類，幾分鐘內會重新分類。'),e.currentTarget,'處理中…');row.append(auto);}
  return row;
}
function topicForm(item,edit){
  const option=(t,selected)=>el('option',{value:t.id,...(selected?{selected:''}:{})},[document.createTextNode(t.name)]);
  const primary=el('select',{id:'topic-primary'},topicData.topics.map(t=>option(t,t.id===item.topic_primary)));
  const secondary=el('select',{id:'topic-secondary'},[el('option',{value:'',text:'無'}),...topicData.topics.map(t=>option(t,t.id===item.topic_secondary))]);
  const save=el('button',{class:'primary',text:'保存主題'}),cancel=el('button',{type:'button',text:'取消'});
  const form=el('form',{class:'topic-form'},[el('div',{},[el('label',{for:'topic-primary',text:'主要主題'}),primary]),el('div',{},[el('label',{for:'topic-secondary',text:'次要主題'}),secondary]),save,cancel]);
  cancel.onclick=()=>{form.remove();edit.setAttribute('aria-expanded','false');edit.focus();};
  form.onsubmit=e=>{e.preventDefault();run(()=>saveTopics(item.id,{primary:primary.value,secondary:secondary.value||null},'主題已更新，之後不會被自動分類覆寫。'),save,'保存中…');};
  return form;
}
async function saveTopics(id,value,done){
  const result=await api('items/'+id+'/topics','PUT',value);
  const listed=listItems.find(i=>i.id===id);if(listed)Object.assign(listed,result);
  topicData=await api('topics?'+filterQuery().toString());renderTopics();renderList();
  await refreshArticle();message(done);
}
function renderArticle(result){
  const item=result.item,box=$('article'),article=JSON.parse(item.article_json||'{}'),gaps=JSON.parse(item.gaps_json||'[]');
  const nodes=[];
  nodes.push(el('h1',{id:'article-title',tabindex:'-1',text:item.title||(result.sources.find(s=>s.relation==='primary')||{content:''}).content.slice(0,100)||'處理中的來源'}));
  const origins=[...new Set((result.intakes||[]).map(i=>ORIGINS[i.origin]||i.origin))];
  // 文章資訊：發布者與時間在前；收件入口、既有導讀與整理模型等管理資訊放在第二行。
  nodes.push(topicRow(item));
  nodes.push(el('p',{class:'meta','data-role':'article-info'},[el('span',{class:'badge admin-info '+stateTone(item.status),text:stateLabel(item)}),document.createTextNode(' '+[item.publisher,'發表 '+(item.published_at?fullDate(item.published_at):'日期未知'),'加入 '+fullDate(item.created_at)].filter(Boolean).join('・'))]));
  nodes.push(el('p',{class:'meta admin-info'},[document.createTextNode([origins.length?'收件：'+origins.join('、'):'',item.edition==='legacy_digest'?'既有導讀':'',provenance(article),'更新於 '+when(item.updated_at)].filter(Boolean).join('・')+'・'),safeLink(item.url,'開啟原始來源')]));
  const bar=triageBar(item);if(bar)nodes.push(bar);
  if(item.edition==='legacy_digest')nodes.push(el('p',{class:'notice process-note',text:'這是搬移前的官方短導讀，尚未依新規格詳細整理。可以用「只重寫文字」改成詳細教材（目前使用 '+textModelName()+'）。'}));
  if(item.status==='waiting_local')nodes.push(el('p',{class:'notice process-note',text:'來源已備齊，等待 Mac 本機模型處理。Mac 離線時會一直等待，不是失敗，也不會改用雲端模型。'}));
  if(item.status==='budget_paused')nodes.push(el('p',{class:'notice process-note',text:'費用暫停：需要付費的步驟已停下，工作保留。到管理頁確認預算後手動恢復。'}));
  if(gaps.length||item.last_error)nodes.push(el('div',{class:'notice process-note'},[el('strong',{text:'來源與處理提醒'}),...gaps.map(g=>gapLine(item,g,result.sources)),item.last_error?el('div',{text:'・'+item.last_error}):null]));
  nodes.push(actions(item));
  if(item.status==='awaiting_backfill'){
    nodes.push(el('p',{class:'notice',text:'這篇尚未呼叫模型。先閱讀同步時保存的原文，或開啟原始來源查看最新內容，再決定是否整理。'}));
    const originals=result.sources.filter(s=>s.status==='available'&&s.content);
    nodes.push(el('section',{class:'block'},[el('h2',{text:'保存的原文'}),...(originals.length?originals.map(sourceBlock):[el('p',{text:'尚未保存原文，請先開啟上方原始來源。'})])]));
  }
  if(item.body){const content=el('div',{class:'article-body'});content.innerHTML=current.body_html;nodes.push(el('section',{class:'block','aria-labelledby':'body-title'},[el('h2',{id:'body-title',class:'sr',text:'教材'}),el('span',{class:'label',text:'教材（'+(provenance(article)||'模型整理')+'；標示「補充例子」的段落是模型額外加的教學例子）'}),content,el('div',{id:'read-end','aria-hidden':'true'})]));}
  const media=mediaBlock(result);if(media)nodes.push(media);
  if((result.versions||[]).length)nodes.push(el('section',{class:'block versions'},[el('h2',{text:'舊版本'}),el('ul',{},result.versions.map(v=>el('li',{text:when(v.created_at)+'・'+(v.edition==='legacy_digest'?'既有導讀':'版本 '+v.revision)+(v.title?'・'+v.title:'')})))]));
  // 原始來源放在整頁最下方，閱讀教材時不被打斷。
  if(item.status!=='awaiting_backfill'&&result.sources.length)nodes.push(el('section',{class:'block'},[el('h2',{text:'原始來源與片段'}),el('p',{class:'muted',text:'以下是系統保存的原文，與上方模型整理的內容分開。'}),...result.sources.map(sourceBlock)]));
  box.replaceChildren(...nodes);
  autoRead.attach(item);
}
// 自動取不到的文章來源，可以手動貼上原文後重新整理。
function gapLine(item,g,sources){
  const line=el('div',{class:'gap'},[document.createTextNode('・'+(g.error||'來源缺漏')+(g.url?'（'+g.url+'）':''))]);
  if(!g.url||!sources.some(s=>s.status==='missing'&&s.url===g.url&&['primary','external'].includes(s.relation)))return line;
  const paste=el('button',{type:'button',text:'貼上原文'});
  paste.onclick=async()=>{const text=await askText('貼上這個來源的原文','把原文完整貼上，保存後會用 '+textModelName()+' 重新整理。之後的自動補取不會覆蓋你貼上的內容。');if(!text)return;
    run(async()=>{await api('items/'+item.id+'/source','POST',{url:g.url,content:text});message('已保存原文並排入整理。');await refreshArticle();await updateListItem(item.id);},paste,'保存中…');};
  line.append(paste);return line;
}
function sourceBlock(s){
  const d=el('details',{class:'source','data-evidence':s.id},[el('summary',{},[el('strong',{text:RELATIONS[s.relation]||s.relation}),document.createTextNode((s.published_at?'・'+when(s.published_at):'')+(s.status!=='available'?'・無法取得':''))])]);
  d.append(el('p',{},[safeLink(s.url,'開啟這則原文')]));
  if(s.content)d.append(el('div',{class:'text',text:s.content}));
  else{const m=JSON.parse(s.metadata_json||'{}');d.append(el('p',{class:'muted',text:m.error||'沒有保存內容'}));}
  if(JSON.parse(s.metadata_json||'{}').provided_by==='user')d.querySelector('summary').append(document.createTextNode('・你貼上的原文'));
  return d;
}
function seekButton(stamp,player){const b=el('button',{type:'button',class:'stamp',text:stamp});if(!player){b.disabled=true;b.title='原始媒體已不可播放，保留解析與原始連結';return b;}b.setAttribute('aria-label','跳到 '+stamp);b.onclick=()=>{const p=stamp.split(':').map(Number);player.currentTime=p[0]*60+p[1];player.focus();player.play().catch(()=>{});};return b;}
function observationLine(stamp,text,player){return el('p',{class:'obs'},[stamp?seekButton(stamp,player):null,el('span',{text})]);}
function renderAnalysis(a,player){
  const d=a.analysis,wrap=el('div',{class:'analysis'});
  if(d.coverage.summary)wrap.append(el('p',{class:'muted',text:(d.coverage.from?d.coverage.from+'–'+d.coverage.to+'・':'')+d.coverage.summary}));
  if(d.ocr.text)wrap.append(el('p',{style:'white-space:pre-wrap',text:'畫面文字：'+(d.ocr.status==='partial'?'（部分可辨識）':'')+'\n'+d.ocr.text}));
  if(d.speech.status!=='not_applicable')for(const s of d.speech.segments)wrap.append(observationLine(s.start,s.text,player));
  for(const o of d.visual)wrap.append(observationLine(o.timestamp,(o.kind==='inferred'?'推論：':'')+o.observation,player));
  for(const u of d.unrecognized)wrap.append(el('p',{class:'muted',text:'無法辨識'+(u.timestamp?'（'+u.timestamp+'）':'')+'：'+u.description}));
  return wrap;
}
// 每個媒體下方緊接它自己的說明。舊資料的觀察只對應到貼文，放在該貼文最後一個媒體之下。
function mediaBlock(result){
  const media=result.media||[],analyses=result.analyses||[],old=analyses.length?[]:(JSON.parse(result.item.article_json||'{}').observations||[]);
  if(!media.length&&!old.length)return null;
  const box=el('section',{class:'block',id:'media'},[el('h2',{text:'媒體與時間點'})]),last={},placed=new Set();
  for(const m of media)last[m.evidence_id]=m.id;
  for(const m of media){
    const item=el('div',{class:'media-item'});let player=null;
    if(m.object_key){const node=el(m.type==='photo'?'img':'video',{src:'/learning/api/media/'+m.id});if(m.type==='photo'){node.alt='來源圖片';node.loading='lazy';}else{node.controls=true;node.preload='metadata';player=node;}item.append(node);}
    else item.append(el('p',{class:'muted'},[document.createTextNode((m.error||'原始媒體尚未取得或已過保存期限')+' '),safeLink(m.url,'原始媒體連結')]));
    const a=analyses.find(x=>x.media_id===m.id);if(a)item.append(renderAnalysis(a,player));
    for(const o of old)if(o.media_id?o.media_id===m.id:o.source_id===m.evidence_id&&last[m.evidence_id]===m.id){placed.add(o);item.append(observationLine(o.timestamp,o.description,player));}
    box.append(item);
  }
  for(const o of old)if(!placed.has(o))box.append(observationLine(o.timestamp,o.description,null));
  return box;
}
// 閱讀頁的篩選按鈕：保留、★、刪除，按下的狀態就是目前的篩選結果；最近刪除的文章改顯示剩餘天數與復原。
function triageBar(item){
  if(['filtered','merged','dismissed'].includes(item.status))return null;
  const state=triageState(item),bar=el('div',{class:'triage-bar',role:'group','aria-label':'篩選結果','data-role':'triage'});
  if(state==='deleted'){
    const restore=el('button',{type:'button',class:'primary',text:'復原'});
    restore.onclick=()=>run(()=>triage(item.id,'restore'),restore,'復原中…');
    bar.append(el('span',{text:'已在最近刪除（'+(item.deleted_reason==='expired'?'待決定逾期移入':'手動刪除')+'），還剩 '+leftText(item.purge_at)+'清除。'}),restore);
    return bar;
  }
  const kept=state==='kept'||state==='starred';
  const keep=el('button',{type:'button','aria-pressed':String(kept),text:kept?'已保留':'保留'});
  keep.onclick=()=>run(()=>triage(item.id,kept?'pending':'keep'),keep,'更新中…');
  const star=el('button',{type:'button','aria-pressed':String(state==='starred'),text:state==='starred'?'★ 常用':'☆ 常用'});
  star.onclick=()=>run(()=>triage(item.id,state==='starred'?'unstar':'star'),star,'更新中…');
  const remove=el('button',{type:'button',class:'danger',text:'刪除'});
  remove.onclick=()=>run(()=>triage(item.id,'delete'),remove,'刪除中…');
  bar.append(keep,star,remove);
  if(state==='pending')bar.append(el('span',{class:'muted',text:'待決定'+(item.triage_deadline?'・還有 '+leftText(item.triage_deadline)+'自動移到最近刪除':'')}));
  return bar;
}
// 套用篩選動作：更新目前文章與列表；文章不再符合目前檢視時從列表移除。
const TRIAGE_DONE={keep:'已保留。',star:'已保留並標記 ★。',unstar:'已拿掉 ★，仍保留。',pending:'已改回待決定。',delete:'已移到最近刪除，7 天內可以復原。',restore:'已復原。'};
function inView(i){const t=triageState(i);return view.triage==='all'?t!=='deleted':view.triage==='starred'?t==='starred':view.triage==='kept'?t==='kept'||t==='starred':t===view.triage;}
async function triage(id,action){
  const result=await api('items/'+id+'/triage','PUT',{action});
  const listed=listItems.find(i=>i.id===id);
  if(listed){Object.assign(listed,result);if(!inView(listed)&&!view.state){listItems=listItems.filter(i=>i!==listed);renderList();}else renderList();}
  if(current&&current.id===id){Object.assign(current,result);await refreshArticle();}
  message(TRIAGE_DONE[action]+(result.status==='queued'&&['keep','star'].includes(action)?'已開始整理這篇，完成後會通知你。':''));
  refreshEntries();
  return result;
}
// 篩選模式：一次一篇待決定文章，看導讀決定保留、保留並 ★、刪除或略過。略過只在這次瀏覽有效，不改狀態。
const DECIDE={keep:['保留','K'],star:['保留並 ★','S'],delete:['刪除','D'],skip:['略過','J'],undo:['復原上一篇','U']};
const triageMode={
  queue:[],skipped:new Set(),history:[],total:0,busy:false,help:false,
  async open(){this.queue=[];await this.fill();this.render();},
  // 從頭依序補滿：已決定的文章不再是待決定，所以每次從第一頁開始，跳過這次略過的與已在佇列中的。
  async fill(){
    for(let offset=0;this.queue.length<5;){
      const r=await api('triage?offset='+offset);this.total=r.total;
      for(const i of r.items)if(!this.skipped.has(i.id)&&!this.queue.some(q=>q.id===i.id))this.queue.push(i);
      offset+=r.items.length;if(r.items.length<20)break;
    }
  },
  render(){
    const item=this.queue[0],box=$('mode');
    const help=el('button',{type:'button','aria-expanded':String(this.help),'aria-controls':'triage-keys',text:'按鍵說明 ?'});help.onclick=()=>this.toggleHelp();
    const back=el('a',{href:urlFor({...view,mode:'',article:null}),text:'回到列表'});back.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();run(()=>navigate({mode:'',article:null}));};
    const head=el('div',{class:'mode-head'},[el('h1',{text:'篩選待決定'}),el('div',{class:'links'},[el('span',{class:'muted',id:'triage-left','aria-live':'polite',text:'還剩 '+this.total+' 篇'}),help,back])]);
    const keys=el('div',{class:'keys',id:'triage-keys',hidden:''},[document.createTextNode('K 保留・S 保留並 ★・D 刪除・J 或 → 略過・U 復原上一篇・? 顯示或隱藏說明。輸入框有焦點時不觸發。')]);
    if(this.help)keys.removeAttribute('hidden');
    if(!item){
      const rest=this.total;
      const content=rest&&this.skipped.size?el('div',{class:'card done-box'},[el('h2',{tabindex:'-1',text:'剩下的 '+rest+' 篇這次都略過了'}),el('p',{class:'muted',text:'略過不會改變篩選結果。'}),this.restartButton()]):
        el('div',{class:'card done-box'},[el('h2',{tabindex:'-1',text:'待決定已清空'}),el('p',{},[back.cloneNode(true)])]);
      const link=content.querySelector('a');if(link)link.onclick=back.onclick;
      box.replaceChildren(head,keys,content,this.undoRow());this.focus();return;
    }
    const names=topicNames(item),meta=[item.publisher,item.published_at?'發表 '+fullDate(item.published_at):'發表日期未知',item.triage_deadline?'還有 '+leftText(item.triage_deadline)+'自動移到最近刪除':''].filter(Boolean).join('・');
    const open=el('a',{href:urlFor({...view,mode:'',article:item.id}),text:'開啟全文'});open.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();run(()=>navigate({article:item.id,mode:''},true));};
    const intro=item.status==='awaiting_backfill'?(item.preview||''):(item.intro||item.preview||'');
    const card=el('article',{class:'card','data-id':item.id,'aria-labelledby':'triage-title'},[
      names.length?el('div',{class:'topic-row'},names.map(n=>el('span',{class:'topic-tag',text:n}))):null,
      el('h2',{id:'triage-title',tabindex:'-1',text:item.title||item.url}),
      el('p',{class:'meta',text:meta}),
      item.status==='awaiting_backfill'?el('p',{class:'waiting',text:'等待確認回補：還沒呼叫模型，下面是保存的原文前 600 字。按保留才開始整理（會產生模型費用）。'}):null,
      el('div',{class:'intro',text:intro||'沒有導讀，請開啟全文判斷。'}),
      el('p',{},[open]),
      el('div',{id:'similar'})]);
    const decide=el('div',{class:'decide',role:'group','aria-label':'決定這篇'},['keep','star','delete','skip'].map(a=>this.button(a)));
    box.replaceChildren(head,keys,card,decide,this.undoRow());
    this.focus();
    this.similar(item.id);
  },
  // 相似的保留文章：避免同一件事保留兩篇。檢索降級或沒有相似文章時不顯示這一區。
  async similar(id){
    let r;try{r=await api('items/'+id+'/similar');}catch(e){return;}
    const box=$('similar');if(!box||!this.queue[0]||this.queue[0].id!==id||!r.items.length)return;
    box.replaceChildren(el('p',{class:'subhead',text:'相似的保留文章'}),el('ul',{class:'similar-list'},r.items.map(i=>{const a=el('a',{href:urlFor({...view,mode:'',article:i.id}),text:i.title||i.id});a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();run(()=>navigate({article:i.id,mode:''},true));};return el('li',{},[a,el('span',{class:'muted',text:'・'+i.publisher+'・相似度 '+Math.round(i.score*100)+'%'})]);})));
  },
  button(action){const [label,key]=DECIDE[action],b=el('button',{type:'button',class:action==='keep'?'primary':action==='delete'?'danger':'','data-action':action,'aria-keyshortcuts':key},[document.createTextNode(label),el('kbd',{text:key,'aria-hidden':'true'})]);b.onclick=()=>this.decide(action);return b;},
  undoRow(){const b=this.button('undo');b.disabled=!this.history.length;return el('div',{class:'actions'},[b]);},
  restartButton(){const b=el('button',{type:'button',class:'primary',text:'從頭再看一次'});b.onclick=()=>run(async()=>{this.skipped.clear();await this.open();});return b;},
  focus(){const t=$('triage-title')||$('mode').querySelector('h2');if(t)t.focus({preventScroll:true});$('reader').scrollTop=0;if(narrow.matches)window.scrollTo(0,0);},
  toggleHelp(){this.help=!this.help;const k=$('triage-keys');if(k)k.hidden=!this.help;const b=$('mode').querySelector('[aria-controls=triage-keys]');if(b)b.setAttribute('aria-expanded',String(this.help));},
  async decide(action){
    if(this.busy)return;
    if(action==='undo')return this.undo();
    const item=this.queue[0];if(!item)return;
    this.busy=true;
    try{
      await run(async()=>{
        if(action==='skip'){this.skipped.add(item.id);this.queue.shift();}
        else{
          const r=await api('items/'+item.id+'/triage','PUT',{action});
          this.history.push({item,action});this.queue.shift();this.total=Math.max(0,this.total-1);listKey=null;
          message(TRIAGE_DONE[action]+(r.status==='queued'&&action!=='delete'?'已開始整理這篇。':''));refreshEntries();
        }
        await this.fill();this.render();
      });
    }finally{this.busy=false;}
  },
  async undo(){
    const last=this.history[this.history.length-1];
    if(!last){message('還沒有可以復原的決定。');return;}
    this.busy=true;
    try{
      await run(async()=>{
        await api('items/'+last.item.id+'/triage','PUT',{action:last.action==='delete'?'restore':'pending'});
        this.history.pop();this.queue=this.queue.filter(q=>q.id!==last.item.id);this.queue.unshift(last.item);this.skipped.delete(last.item.id);this.total++;listKey=null;
        message('已復原「'+(last.item.title||last.item.url)+'」，回到待決定。');refreshEntries();this.render();
      });
    }finally{this.busy=false;}
  },
};
const MODES={triage:triageMode};
// 讀到正文結尾自動標已讀：只點開不算，要有捲動等閱讀動作之後，結尾進入畫面才送出；同一次開啟只送一次。
const autoRead={
  observer:null,seq:-1,visible:false,armed:false,armAt:0,off:false,sent:false,
  attach(item){
    if(this.seq!==openSeq){this.seq=openSeq;this.off=false;this.sent=false;this.armed=false;this.armAt=performance.now()+600;}
    this.detach();this.visible=false;
    const end=$('read-end');
    if(item.read_at||!item.body||!end||this.sent||!('IntersectionObserver' in window))return;
    this.observer=new IntersectionObserver(entries=>{this.visible=entries.some(e=>e.isIntersecting);this.check();});
    this.observer.observe(end);
  },
  detach(){if(this.observer)this.observer.disconnect();this.observer=null;},
  interact(){if(!this.observer||performance.now()<this.armAt)return;this.armed=true;this.check();},
  check(){
    if(!this.observer||!this.armed||!this.visible||this.off||this.sent||!current||current.read_at)return;
    this.sent=true;this.detach();
    const id=current.id,seq=this.seq;
    api('items/'+id,'PATCH',{read:true}).then(()=>{
      if(seq!==openSeq||!current||current.id!==id)return;
      current.read_at=new Date().toISOString();
      const b=$('read-toggle');if(b)b.textContent='標記未讀';
      updateListItem(id).catch(()=>{});
    }).catch(()=>{this.sent=false;});
  },
};
for(const target of [window,$('reader')])for(const type of ['scroll','wheel','touchmove'])target.addEventListener(type,()=>autoRead.interact(),{passive:true});
document.addEventListener('keydown',e=>{if(['ArrowDown','PageDown','End',' '].includes(e.key))autoRead.interact();});
// 專注模式：這台裝置記住開關；讀不到設定時預設關閉。
const focusMode={
  on:false,
  load(){try{this.on=localStorage.getItem('technews-focus')==='1';}catch(e){this.on=false;}this.apply();},
  set(on){this.on=on;try{localStorage.setItem('technews-focus',on?'1':'0');}catch(e){}this.apply();},
  apply(){document.body.classList.toggle('focus',this.on);const b=$('focus-toggle');b.setAttribute('aria-pressed',String(this.on));b.textContent=this.on?'離開專注':'專注';},
};
$('focus-toggle').onclick=()=>focusMode.set(!focusMode.on);
focusMode.load();
function actions(item){
  const row=el('div',{class:'actions'});
  const read=el('button',{id:'read-toggle',text:item.read_at?'標記未讀':'標記已讀'});
  // 手動改回未讀：這次開啟不再自動標已讀。
  read.onclick=()=>run(async()=>{const next=!current.read_at;await api('items/'+item.id,'PATCH',{read:next});if(!next)autoRead.off=true;await refreshArticle();await updateListItem(item.id);},read,'更新中…');
  row.append(read);
  if(item.status==='awaiting_backfill'){
    const start=el('button',{class:'primary manage',text:'開始整理這篇'});
    start.onclick=()=>run(async()=>{await api('items/'+item.id+'/backfill','POST',{});message('已啟動這篇文章的整理，完成後會通知你。');await refreshArticle();await updateListItem(item.id);},start,'啟動整理…');
    row.append(start);return row;
  }
  const retry=el('button',{class:'manage',text:'補取缺漏並整理'});
  retry.onclick=async()=>{if(!await askConfirm('會重新取得缺漏的來源與媒體（可能產生 X 或 Flash 費用），再用 '+textModelName()+' 重新整理文字。要繼續嗎？'))return;run(async()=>{await api('items/'+item.id+'/retry','POST',{});message('已排入補取與整理。');await refreshArticle();await updateListItem(item.id);},retry,'送出中…');};
  row.append(retry);
  if(['ready','partial','needs_attention','error'].includes(item.status)){
    const rewrite=el('button',{class:'manage',text:'只重寫文字'});
    rewrite.onclick=async()=>{if(!await askConfirm('沿用已保存的來源與媒體解析，用 '+textModelName()+' 重寫文字。'+(item.edition==='legacy_digest'?'舊導讀沒有保存原文時，會先重抓官方公開原文。':'不重新取得來源。')+'要繼續嗎？'))return;run(async()=>{await api('items/'+item.id+'/rewrite','POST',{});message('已排入重寫。');await refreshArticle();await updateListItem(item.id);},rewrite,'送出中…');};
    row.append(rewrite);
  }
  if(['ready','partial'].includes(item.status)&&item.edition==='detailed'){
    const resend=el('button',{class:'manage',text:'重送通知'});
    resend.onclick=async()=>{if(!await askConfirm('用目前保存的內容再發一次 Telegram 通知，不重新生成。要繼續嗎？'))return;run(async()=>{await api('items/'+item.id+'/renotify','POST',{});message('已重送通知。');},resend,'送出中…');};
    row.append(resend);
  }
  return row;
}
async function updateListItem(id){const [s]=await api('items/states?ids='+id);if(s)applyState(s);}
function applyState(s){
  const i=listItems.find(x=>x.id===s.id);if(i)Object.assign(i,s);
  const a=document.querySelector('#list a[data-id="'+s.id+'"]');
  if(a&&i){
    const meta=a.querySelector('.item-meta'),old=meta.querySelector('[data-role=state]'),next=stateNode(i);
    if(old){old.previousSibling.remove();old.remove();}
    if(next)meta.append(el('span',{class:'sep','aria-hidden':'true'}),next);
    a.classList.toggle('unread',!i.read_at);
  }
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
let textModel=null;
function textModelName(){return !textModel?'目前設定的文字模型':textModel.provider==='local'?'本機 '+textModel.model:/gemini/i.test(textModel.model)?textModel.model:'Gemini '+textModel.model;}
// 列表頂端的入口：待決定篇數。
function renderEntries(s){
  const links=[];
  if(s.triage_pending)links.push(el('a',{href:urlFor({...view,mode:'triage',article:null}),'data-entry':'triage','data-mode':'triage'},[document.createTextNode('待決定'),el('strong',{text:s.triage_pending+' 篇'})]));
  $('entry-bar').replaceChildren(...links);$('entry-bar').hidden=!links.length;
  for(const a of links)a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();run(()=>navigate({mode:a.dataset.mode,article:null}));};
}
async function refreshEntries(){try{renderEntries(await api('status'));}catch(e){}}
async function runnerStatus(){
  try{const s=await api('status'),l=s.local,b=s.budget;textModel={provider:l.provider,model:l.text_model||l.model};renderEntries(s);
    const text=(b.paused?'已暫停・':'')+(l.provider==='local'?(l.online?'Mac 在線':'Mac 離線')+(l.jobs.waiting_local?'・等待 '+l.jobs.waiting_local:''):'Gemini 模式');
    $('runner-pill').textContent=text;$('runner-pill').title=l.last_seen_at?'最後心跳 '+when(l.last_seen_at):'尚未收到 Mac 心跳';
  }catch(e){}
}
// 筆記與追問對話框：收合時只留分頁、快速追問與展開按鈕；沒有開啟文章時只有追問分頁。
const dock={
  tab:'ask',
  isOpen(){return $('dock').classList.contains('open');},
  toggle(on,focusToggle){
    $('dock').classList.toggle('open',on);$('dock-toggle').setAttribute('aria-expanded',String(on));$('dock-toggle-text').textContent=on?'收合':'展開';
    if(focusToggle)$('dock-toggle').focus();
  },
  select(name,focusTab){
    this.tab=name;
    for(const t of document.querySelectorAll('#dock-tabs [role=tab]')){const on=t.dataset.tab===name;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;$(t.getAttribute('aria-controls')).hidden=!on;}
    if(focusTab)$('tab-'+name).focus();
  },
  setNotes(on){$('tab-note').hidden=!on;if(!on&&this.tab==='note')this.select('ask');},
};
for(const t of document.querySelectorAll('#dock-tabs [role=tab]'))t.onclick=()=>{dock.select(t.dataset.tab);dock.toggle(true);};
// 分頁之間用方向鍵切換（WAI-ARIA tabs 慣例）。
$('dock-tabs').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const tabs=[...document.querySelectorAll('#dock-tabs [role=tab]')].filter(t=>!t.hidden),i=tabs.indexOf(document.activeElement);if(i<0)return;
  e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  dock.select(tabs[n].dataset.tab,true);
});
$('dock-toggle').onclick=()=>dock.toggle(!dock.isOpen());
// 快速追問：直接用目前範圍送出，展開對話框顯示進度；空白時只展開並把焦點移到問題欄。
$('quick-ask').onsubmit=e=>{
  e.preventDefault();const text=$('quick-question').value.trim();
  dock.select('ask');dock.toggle(true);
  if(!text){$('question').focus();return;}
  $('question').value=text;$('quick-question').value='';$('question').focus();$('ask-form').requestSubmit();
};
// 閱讀區底部留白與捲動留白跟著對話框高度走，展開時也不會遮住正文或鍵盤焦點。
new ResizeObserver(()=>document.body.style.setProperty('--dock-h',$('dock').offsetHeight+'px')).observe($('dock'));
// 筆記：自動保存、失敗時草稿留在這台裝置、切換文章不互相覆寫、跨分頁衝突要使用者選擇。
const NOTE_DELAY=1200;
const notes={
  item:null,base:null,saved:'',timer:null,inflight:0,conflict:null,
  key(id){return 'technews-note:'+id;},
  readDraft(id){try{return JSON.parse(localStorage.getItem(this.key(id))||'null');}catch(e){return null;}},
  writeDraft(id,text,base){try{localStorage.setItem(this.key(id),JSON.stringify({text,base,at:Date.now()}));}catch(e){}},
  clearDraft(id,text){try{const d=this.readDraft(id);if(!d||text==null||d.text===text)localStorage.removeItem(this.key(id));}catch(e){}},
  dirty(){return !!this.item&&$('note').value!==this.saved;},
  setState(text,tone,buttons){
    $('note-state').textContent=text||'';$('note-state').className='note-state'+(tone?' '+tone:'');$('note-actions').replaceChildren(...(buttons||[]));
    // 對話框收合時也要看得出筆記保存失敗或有衝突。
    $('tab-note').classList.toggle('alert',tone==='error');$('note-alert').textContent=tone==='error'?'（需要處理）':'';
  },
  open(item){
    // 離開前一篇時，把尚未送出的內容以那篇的身分送出，回應不會寫進新文章。
    if(this.item&&this.item.id!==item.id&&this.dirty()){clearTimeout(this.timer);this.send(this.item.id,$('note').value,this.base);}
    clearTimeout(this.timer);this.conflict=null;
    this.item=item;this.base=item.note_updated_at||null;this.saved=item.note||'';
    dock.setNotes(true);
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
  close(){if(this.item&&this.dirty()){clearTimeout(this.timer);this.send(this.item.id,$('note').value,this.base);}this.item=null;this.setState('','');dock.setNotes(false);},
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
    // 改回與已保存相同的內容時不必送出，但狀態不能停在「編輯中…」。
    if(text===this.saved&&!force){this.clearDraft(id,text);this.setState(this.base?'最後保存 '+when(this.base):'','');return;}
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
  // 沒有開啟文章時改成整個文章庫；之後開啟文章時，若範圍不是使用者自己選的，就恢復成目前文章。
  forcedAll:false,
  open(item){
    watching=null;$('answer').replaceChildren();$('answer-sources').replaceChildren();
    const article=document.querySelector('input[name=scope][value=article]');
    if(!item){if(article.checked)this.forcedAll=true;document.querySelector('input[name=scope][value=all]').checked=true;}
    else if(this.forcedAll){article.checked=true;this.forcedAll=false;}
    quickHint();loadHistory().catch(()=>{});
  },
};
function quickHint(){$('quick-question').placeholder=(scopeId()?'問這篇的來源':'問保留的文章')+'，按 Enter 送出';$('unkept-label').hidden=document.querySelector('input[name=scope]:checked').value!=='all';}
// 手機版對話框會蓋住大半畫面，跳到原文或媒體前先收合。
function revealInReader(){if(narrow.matches&&dock.isOpen())dock.toggle(false);}
function scopeId(){return document.querySelector('input[name=scope]:checked').value==='article'&&current?current.id:null;}
// 出處：全庫追問標示保留或未保留；檢索只比對關鍵字時另外說明。
function sourceItem(s){return el('li',{},[s.kept===true?el('span',{class:'kept-tag',text:'保留'}):s.kept===false?el('span',{class:'kept-tag no',text:'未保留'}):null,safeLink(s.url,(RELATIONS[s.relation]||s.relation)+'・'+s.url),s.excerpt?el('span',{class:'preview',text:s.excerpt}):null,citeButton(s)]);}
function degradedNote(q){return q.degraded?el('p',{class:'muted',text:'這次只比對關鍵字（語意檢索暫時無法使用）。'}):null;}
function renderQuestion(q){
  if(q.status==='done'){$('answer').innerHTML=q.answer_html;const note=degradedNote(q);if(note)$('answer').prepend(note);$('answer-sources').replaceChildren(...(q.sources||[]).map(sourceItem));}
  else{$('answer').textContent=(questionStates[q.status]||q.status)+(q.error?'：'+q.error:'。')+(q.status==='failed'?'':'可以離開這頁，之後在提問紀錄查看。');$('answer-sources').replaceChildren();}
}
// 回答引用的片段若來自目前文章，可直接在保存的原文中標出，核對模型是否忠於來源。
function citeButton(s){
  if(!current||s.item_id!==current.id)return null;
  if(s.relation==='article_body'){const b=el('button',{type:'button',class:'stamp',text:'看教材正文'});b.onclick=()=>{revealInReader();const body=document.querySelector('#article .article-body');if(body){body.scrollIntoView({block:'start'});body.setAttribute('tabindex','-1');body.focus({preventScroll:true});}};return b;}
  if(s.id.startsWith('media:')||s.id.endsWith(':observations')){const b=el('button',{type:'button',class:'stamp',text:'查看媒體證據'});b.onclick=()=>{revealInReader();const m=$('media');if(m){m.scrollIntoView({block:'start'});m.setAttribute('tabindex','-1');m.focus({preventScroll:true});}};return b;}
  const b=el('button',{type:'button',class:'stamp',text:'在原文中標出'});b.onclick=()=>{revealInReader();showExcerpt(s.id.split(':')[0],s.range_start||0,(s.excerpt||'').length);};return b;
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
  $('history').replaceChildren(...list.map(q=>{const body=el('div',{class:'article-body'});if(q.status==='done'){body.innerHTML=q.answer_html;const note=degradedNote(q);if(note)body.prepend(note);}else body.textContent=questionStates[q.status]||q.status;const refs=el('ul',{},(q.sources||[]).map(sourceItem));if(['waiting_local','generating'].includes(q.status)&&watching!==q.id)pollQuestion(q.id,true);return el('details',{'data-question':q.id},[el('summary',{text:q.question.slice(0,80)+'・'+(questionStates[q.status]||q.status)+'・'+when(q.created_at)}),body,refs]);}));
  if(!list.length)$('history').textContent='尚無提問。';
}
// 追問進度：只追蹤目前範圍內的問題；切換文章或範圍後，舊問題的回應不會寫進新的回答區。
function pollQuestion(id,quiet){clearTimeout(questionTimer);watching=id;const scope=scopeId();questionTimer=setTimeout(async()=>{if(watching!==id||scope!==scopeId())return;if(document.hidden){pollQuestion(id,quiet);return;}try{const q=await api('questions/'+id);if(watching!==id||scope!==scopeId())return;if(!quiet)renderQuestion(q);if(['waiting_local','generating'].includes(q.status))pollQuestion(id,quiet);else{watching=null;await loadHistory();}}catch(e){message('提問進度更新失敗：'+e.message,true);}},5000);}
$('ask-form').onsubmit=e=>{e.preventDefault();run(async()=>{const scoped=document.querySelector('input[name=scope]:checked').value==='article';if(scoped&&!current)throw Error('請先選一篇文章，或改為整個文章庫。');$('answer').textContent='正在保存問題並檢索來源…';const q=await api('ask','POST',{question:$('question').value,item_id:scoped?current.id:null,include_unkept:!scoped&&$('include-unkept').checked});renderQuestion(q);if(['waiting_local','generating'].includes(q.status))pollQuestion(q.id);await loadHistory();},e.submitter||e.target.querySelector('button'),'送出中…');};
for(const radio of document.querySelectorAll('input[name=scope]'))radio.onchange=()=>{watching=null;questions.forcedAll=false;quickHint();run(loadHistory);};
$('search-form').onsubmit=e=>{e.preventDefault();run(()=>navigate({q:$('search').value.trim(),article:null}));};
$('unread').onchange=()=>run(()=>navigate({unread:$('unread').checked}));
$('origin').onchange=()=>run(()=>navigate({origin:$('origin').value}));
$('state').onchange=()=>run(()=>navigate({state:$('state').value}));
$('sort').onchange=()=>run(()=>navigate({sort:$('sort').value}));
$('more').onclick=e=>run(loadMore,e.currentTarget,'載入中…');
$('manage-toggle').onclick=e=>{const open=$('manage').hidden;$('manage').hidden=!open;e.currentTarget.setAttribute('aria-expanded',String(open));};
// 列表底部出現在畫面中就載入下一批；不支援時保留「載入更多」按鈕。
if('IntersectionObserver' in window)new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))run(loadMore);},{rootMargin:'200px'}).observe($('list-end'));
$('back').onclick=()=>{if(history.state&&history.state.fromList)history.back();else run(()=>navigate({article:null}));};
$('collect-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await api('collect','POST',{url:$('url').value});$('url').value='';message('已收到並保存連結。完成後會透過 Telegram 通知。');listKey=null;await navigate({article:r.id});},e.submitter||e.target.querySelector('button'),'加入中…');};
document.addEventListener('keydown',e=>{
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  // 篩選模式的按鍵只在這個模式有效；焦點在輸入框或按著修飾鍵時不觸發。
  if(view.mode==='triage'&&!typing&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!document.querySelector('dialog[open]')){
    const key={k:'keep',s:'star',d:'delete',j:'skip',arrowright:'skip',u:'undo'}[e.key.toLowerCase()];
    if(key){e.preventDefault();triageMode.decide(key);return;}
    if(e.key==='?'){e.preventDefault();triageMode.toggleHelp();return;}
  }
  // Escape 先關閉筆記與追問對話框並把焦點還給展開按鈕，這次不觸發手機版的返回列表。
  if(e.key==='Escape'&&dock.isOpen()){e.preventDefault();dock.toggle(false,true);return;}
  if(e.key==='Escape'&&focusMode.on&&view.article&&!view.mode&&!typing){e.preventDefault();focusMode.set(false);$('focus-toggle').focus();return;}
  if(e.key==='/'&&!typing){e.preventDefault();$('search').focus();}
  if(e.key==='Escape'&&narrow.matches&&view.article&&!typing&&!$('dock').contains(document.activeElement))$('back').click();
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){poll();runnerStatus();}});
bindLogin(boot);
async function boot(){
  await api('status');showApp();await runnerStatus();view=readView();listKey=null;await apply();
  clearInterval(pollTimer);clearInterval(statusTimer);pollTimer=setInterval(poll,8000);statusTimer=setInterval(runnerStatus,30000);
}
run(boot);
</script></body></html>`;

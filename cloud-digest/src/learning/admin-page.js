import {STYLE,HELPERS,LOGIN} from './ui.js';

export const ADMIN_PAGE=String.raw`<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechNews · 管理</title>
<style>${STYLE}
main{max-width:1000px;margin:24px auto;padding:0 20px}h1{font-size:24px}h2{font-size:19px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}dt{color:var(--muted);font-size:14px}dd{margin:0;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.switches{display:grid;gap:4px}.switch{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:600}.switch input{min-height:auto;width:20px;height:20px;flex:none}.pre{white-space:pre-line;line-height:1.7}
@media(max-width:640px){main{padding:0 12px}}
</style></head><body>
<header class="top"><a class="brand" href="/learning">TechNews 文章庫</a><nav><a href="/learning">回到文章庫</a><button id="logout" class="hidden">登出</button></nav></header>
<div id="feedback" role="status" aria-live="polite"></div>
${LOGIN}
<main id="app" class="hidden"><h1>管理</h1>
<p class="muted">同步、模型分工、預算與故障處理集中在這裡；日常閱讀請回到文章庫。</p>
<div class="grid">
<section class="panel" aria-labelledby="model-title"><h2 id="model-title">模型分工</h2><dl id="models"></dl>
<p class="muted">「文字模型」負責官方主題判斷、詳細整理、通知介紹與來源追問。切到本機前請先完成代表素材驗收。Mac 離線時工作會等待，不會改用雲端文字模型。</p>
<div class="actions"><button id="use-local">改用本機 Gemma</button><button id="use-gemini">改回 Gemini（切換前路徑）</button></div>
<p class="muted">舊的 <a href="/settings">官方導讀設定頁</a> 只控制切換前的官方 Telegram 導讀模型與主題關注；主題關注也會用在本機的官方主題判斷。</p></section>
<section class="panel" aria-labelledby="runner-title"><h2 id="runner-title">Mac 執行器</h2><dl id="runner"></dl><div id="queue"></div></section>
<section class="panel" aria-labelledby="budget-title"><h2 id="budget-title">本月預算（台灣曆月）</h2><p id="budget-state"></p><dl id="budget"></dl><div id="categories"></div>
<p class="muted">數字是控管估算，不是供應商帳單。X 同一 UTC 日的重讀以有上限的「重讀風險」列為未確認。</p>
<div class="actions"><button id="pause">暫停全部處理</button><button id="resume" class="primary">手動恢復</button></div></section>
<section class="panel" aria-labelledby="sync-title"><h2 id="sync-title">X 書籤同步</h2>
<div class="switches"><label class="switch"><input type="checkbox" id="x-bookmarks"> 書籤同步（每 10 分鐘局部檢查、每天完整核對）</label><label class="switch"><input type="checkbox" id="x-author"> 作者重查（完成 24 小時後重讀作者補充）</label></div>
<p class="muted">兩項都會產生 X 讀取費用，預設關閉。手動分享 X 連結不受影響。</p><p id="sync-state" class="pre"></p><p id="setup" class="muted"></p>
<div class="actions"><button id="connect">連接 X</button><button id="sync">開始或續跑完整核對</button><button id="backfill">整理全部待回補書籤</button></div>
<p class="muted">每 10 分鐘局部檢查列表最前面幾頁；每天 08:00 完整核對。新收藏的舊貼文可能要等完整核對才會出現。</p></section>
<section class="panel" aria-labelledby="ops-title"><h2 id="ops-title">維運</h2><p class="muted">重新執行舊資料搬移：只寫資料庫，不呼叫模型、不讀外部來源、不發通知，可重複執行。</p><div class="actions"><button id="migrate">搬移舊官方導讀</button></div><p id="migrate-result" class="muted"></p></section>
</div></main>
<script>
${HELPERS}
const SKIPS={baseline_incomplete:'首次完整掃描完成前不做局部檢查',rate_limited:'X 限流，稍後再試',full_scan_running:'完整核對進行中，這次略過',partial_running:'上一次局部檢查仍在進行'};
const CATEGORY={x:'X 讀取','x-reread-risk':'X 重讀風險',gemini:'Gemini 寫作','gemini-media':'Flash 媒體解析','r2-storage':'R2 保存'};
const COST_STATUS={settled:'已結算估算',reserved:'預留中',uncertain:'未確認',adjustment:'人工核對調整'};
function dl(id,pairs){$(id).replaceChildren(...pairs.flatMap(p=>[el('dt',{text:p[0]}),el('dd',{text:p[1]})]));}
async function load(){
  const s=await api('status'),b=await api('budget'),l=s.local;
  dl('models',[['文字模型',l.provider==='local'?'本機 Ollama '+l.model:'Gemini（'+'切換前路徑）'],['媒體理解','Gemini Flash（只解析圖片與影片，保存證據）'],['官方導讀（切換前）','由舊設定頁的模型產生']]);
  dl('runner',[['狀態',l.online?'在線':'離線'],['最後心跳',when(l.last_seen_at)],['目前工作',l.current?(l.current.kind==='question'?'追問':'文章')+'・領取於 '+when(l.current.leased_at):'無'],['等待中',String(l.jobs.waiting_local||0)],['失敗待處理',String(l.jobs.failed||0)],['版本',l.info?(l.info.version||'—')+'・'+(l.info.model||'')+(l.info.model_digest?' ('+l.info.model_digest+')':''):'—']]);
  $('queue').replaceChildren(l.queue.length?el('table',{},[el('thead',{},[el('tr',{},['順序','類型','優先','有效優先','建立'].map(t=>el('th',{text:t})))]),el('tbody',{},l.queue.map(q=>el('tr',{},[q.position,q.kind==='question'?'追問':'文章',q.priority,q.effective_priority,when(q.created_at)].map(v=>el('td',{text:String(v)})))))]):el('p',{class:'muted',text:'目前沒有排隊的本機工作。'}));
  $('budget-state').textContent=b.pause_reason==='manual'?'已手動暫停全部處理。':b.pause_reason==='budget'?'費用暫停：不呼叫付費服務；已取得證據的本機工作照常。跨月不會自動恢復。':'處理中。';
  dl('budget',[['月預算',money(b.limit_micro)],['基本費預留',money(b.base_micro)],['已使用估算',money(b.metered_micro)],['剩餘',money(b.remaining_micro)],['已結算估算',money(b.totals.settled_micro)],['預留中',money(b.totals.reserved_micro)],['未確認',money(b.totals.uncertain_micro)],['人工核對調整',money(b.totals.adjustment_micro)],['X 計價查核日',b.x_pricing.checked_at]]);
  $('categories').replaceChildren(b.categories.length?el('table',{},[el('thead',{},[el('tr',{},['項目','狀態','金額','筆數'].map(t=>el('th',{text:t})))]),el('tbody',{},b.categories.map(c=>el('tr',{},[CATEGORY[c.category]||c.category,COST_STATUS[c.status]||c.status,money(c.amount_micro),c.count].map(v=>el('td',{text:String(v)})))))]):el('p',{class:'muted',text:'本月尚無費用紀錄。'}));
  const p=s.sync_partial||{},f=s.sync||{};
  $('x-bookmarks').checked=s.x_reads.bookmarks;$('x-author').checked=s.x_reads.author_recheck;
  if(!s.x_reads.bookmarks)$('sync-state').textContent='書籤同步已關閉：不做局部檢查與完整核對，只在手動分享時讀取 X。\n等待確認回補：'+s.awaiting_backfill+' 篇';
  else $('sync-state').textContent='局部檢查（'+(p.scope||'最前 1 頁')+'）：最後完成 '+when(p.last_completed_at)+(p.added!=null?'，新增 '+p.added+' 篇':'')+(p.skipped?'；'+(SKIPS[p.skipped]||p.skipped):'')+(p.last_error?'；'+p.last_error:'')+'\n完整核對：'+(f.running?'進行中，已保存游標'+(f.pages_scanned?'（已掃 '+f.pages_scanned+' 頁）':''):'最後完整完成 '+when(f.last_full_completed_at||f.completed_at))+(f.baseline_complete?'':'；首次基線尚未完成')+(f.requires_action?'；需要重新授權或檢查設定':'')+(f.last_error?'；'+f.last_error:'')+'\n等待確認回補：'+s.awaiting_backfill+' 篇';
  const c=s.configured;$('setup').textContent='Gemini：'+(c.gemini?'已設定':'待設定')+'；X：'+(c.x?'已設定':'待設定')+'；背景佇列：'+(c.queue?'已設定':'待設定')+'；媒體保存：'+(c.media?'已設定':'待設定')+'；Telegram 收件：'+(c.telegram_input?'已設定':'待設定');
}
$('use-local').onclick=async e=>{const button=e.currentTarget;if(!await askConfirm('改用本機 Gemma 後，文字整理與追問都交給 Mac；Mac 離線時工作會等待。確定已完成驗收？'))return;run(async()=>{await api('admin/text-provider','PUT',{provider:'local'});await load();message('文字模型已改為本機。');},button,'切換中…');};
$('use-gemini').onclick=e=>run(async()=>{await api('admin/text-provider','PUT',{provider:'gemini'});await load();message('文字模型已改回 Gemini。');},e.currentTarget,'切換中…');
$('pause').onclick=e=>run(async()=>{await api('control','POST',{action:'pause'});await load();message('已暫停全部處理；正在執行的請求可能仍會完成。');},e.currentTarget,'暫停中…');
$('resume').onclick=e=>run(async()=>{await api('control','POST',{action:'resume'});await load();message('已恢復處理。');},e.currentTarget,'恢復中…');
$('connect').onclick=e=>run(async()=>{const r=await api('x/connect','POST',{});location.assign(r.url);},e.currentTarget,'前往 X 授權…');
// 開關切換後立即保存；失敗時還原勾選狀態。
for(const [id,key,label] of [['x-bookmarks','bookmarks','書籤同步'],['x-author','author_recheck','作者重查']])$(id).onchange=e=>{const box=e.currentTarget,on=box.checked;run(async()=>{try{await api('admin/x-reads','PUT',{[key]:on});}catch(error){box.checked=!on;throw error;}await load();message(label+(on?'已開啟。':'已關閉。'));});};
$('sync').onclick=e=>run(async()=>{const r=await api('x/sync','POST',{});await load();message(r.disabled?'書籤同步已停用，沒有讀取 X。':'已啟動完整核對，進度會保存。');},e.currentTarget,'同步中…');
$('backfill').onclick=async e=>{const button=e.currentTarget;if(!await askConfirm('這會整理全部等待回補的書籤，並產生模型與讀取費用。若想逐篇決定，請到文章庫篩選「等待確認回補」。要繼續嗎？'))return;run(async()=>{await api('x/backfill','POST',{});await load();message('已確認回補，工作會依可用預算處理。');},button,'送出中…');};
$('migrate').onclick=e=>run(async()=>{const r=await api('admin/migrate','POST',{});$('migrate-result').textContent='新增 '+r.imported+' 篇、合併 '+r.merged+' 篇、更新網址 '+r.renamed+' 篇。';},e.currentTarget,'搬移中…');
bindLogin(boot);
async function boot(){await load();showApp();}
run(boot);
</script></body></html>`;

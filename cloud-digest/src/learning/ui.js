// 文章庫與管理頁共用的樣式與前端小工具（原生 HTML／CSS／JS，不使用前端框架）。
// 注意：這些字串會放進 String.raw 樣板，前端程式內不要使用反引號或 ${}。

export const STYLE=String.raw`
:root{--bg:#f3f6f5;--paper:#fff;--ink:#183a37;--muted:#4f615e;--line:#d3e0dd;--accent:#0f766e;--accent-ink:#fff;--warn-bg:#fff4df;--warn:#8b440a;--danger:#9f2525;--soft:#e6f3ef;--focus:#b45309;--top:64px;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;color:var(--ink);background:var(--bg)}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}a{color:var(--accent);overflow-wrap:anywhere}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;min-height:44px;padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:var(--paper)}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}button.danger{color:var(--danger)}
button:disabled{opacity:.55;cursor:not-allowed}button[aria-busy=true]{cursor:wait}button:hover:not(:disabled){filter:brightness(.96)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
input,textarea,select{border:1px solid var(--line);border-radius:8px;padding:10px 12px;min-height:44px;background:#fff}
textarea{width:100%;resize:vertical;min-height:120px;line-height:1.7}
label{font-size:14px;font-weight:600}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.hidden{display:none!important}.muted{color:var(--muted);font-size:14px}
.notice{background:var(--warn-bg);border-left:4px solid var(--focus);padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:4px}
.error{color:var(--danger)}
.badge{display:inline-block;font-size:12px;line-height:1.4;background:var(--soft);padding:3px 8px;border-radius:5px;margin:6px 6px 0 0}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.wait{background:#e8eefc;color:#22408a}.badge.done{background:var(--soft)}
.top{position:sticky;top:0;z-index:5;min-height:var(--top);display:flex;gap:16px;align-items:center;padding:10px 20px;background:var(--ink);color:#fff;flex-wrap:wrap}
.top a{color:#fff}.top .brand{font-weight:700;font-size:18px;text-decoration:none;margin-right:auto}
.top nav{display:flex;gap:10px;align-items:center}.top button{background:transparent;color:#fff;border-color:#5c7a76}
.pill{font-size:13px;padding:4px 10px;border-radius:999px;background:#2b524e;color:#e6f3ef;white-space:nowrap}
#feedback{margin:0;padding:0 20px;white-space:pre-wrap}#feedback:not(:empty){padding:10px 20px;background:var(--paper);border-bottom:1px solid var(--line)}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.article-body{font-size:17px;line-height:1.9;overflow-wrap:anywhere;max-width:72ch}
.article-body p{margin:0 0 1em}.article-body h1,.article-body h2,.article-body h3,.article-body h4{margin:1.4em 0 .5em;line-height:1.45}
.article-body ul,.article-body ol{padding-left:1.4em}
.article-body pre{white-space:pre;overflow:auto;background:#eef4f2;padding:14px;border-radius:8px;font-size:14px;line-height:1.6;max-width:100%}
.article-body code{font-family:ui-monospace,SFMono-Regular,monospace;background:#eef4f2;border-radius:4px;padding:1px 4px}.article-body pre code{padding:0}
.article-body table{display:block;overflow:auto;border-collapse:collapse;max-width:100%}.article-body th,.article-body td{border:1px solid var(--line);padding:6px 10px;text-align:left;min-width:7em;overflow-wrap:normal;word-break:normal}
.article-body blockquote{border-left:3px solid var(--line);margin-left:0;padding-left:14px;color:var(--muted)}
#login{max-width:460px;margin:64px auto}
dialog.confirm{border:1px solid var(--line);border-radius:12px;padding:20px;max-width:min(440px,calc(100vw - 32px));background:var(--paper);color:var(--ink)}dialog.confirm::backdrop{background:rgba(24,58,55,.45)}
dialog.confirm p{margin:0 0 16px;line-height:1.7;white-space:pre-wrap}dialog.confirm .actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin:0}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}.spinner{animation:none}}
`;

export const HELPERS=String.raw`
const $=id=>document.getElementById(id);
const busyButtons=new WeakSet();let activeActions=0;
function message(text,error){$('feedback').textContent=text||'';$('feedback').classList.toggle('error',!!error);}
async function api(path,method,data){
  const r=await fetch('/learning/api/'+path,{method:method||'GET',headers:{'content-type':'application/json','x-learning-request':'1'},body:data?JSON.stringify(data):undefined});
  if(r.status===401){showLogin();const e=Error('請先登入');e.auth=true;throw e;}
  const body=await r.json().catch(()=>({}));
  if(!r.ok){const e=Error(body.error||'處理失敗');e.status=r.status;e.body=body;throw e;}
  return body;
}
function safeLink(url,label){const a=document.createElement('a');try{if(new URL(url).protocol!=='https:')throw Error();a.href=url;a.target='_blank';a.rel='noopener noreferrer';}catch(e){a.removeAttribute('href');}a.textContent=label||url;return a;}
function el(tag,props,children){const n=document.createElement(tag);for(const k in props||{}){if(k==='text')n.textContent=props[k];else if(k==='class')n.className=props[k];else if(k.startsWith('on'))n[k]=props[k];else n.setAttribute(k,props[k]);}for(const c of children||[])if(c!=null)n.append(c);return n;}
// 頁內確認對話框：Telegram 等 App 內建瀏覽器常會擋掉 window.confirm()，直接回傳取消。
function askConfirm(text,confirmLabel,danger){
  return new Promise(resolve=>{
    const opener=document.activeElement,box=el('dialog',{class:'confirm','aria-labelledby':'confirm-text'});
    const ok=el('button',{type:'button',class:danger?'danger':'primary',text:confirmLabel||'確定'}),cancel=el('button',{type:'button',text:'取消'});
    box.append(el('p',{id:'confirm-text',text}),el('div',{class:'actions'},[cancel,ok]));
    let done=false;
    const finish=value=>{if(done)return;done=true;if(box.open)box.close();box.remove();if(opener&&opener.focus)opener.focus({preventScroll:true});resolve(value);};
    ok.onclick=()=>finish(true);cancel.onclick=()=>finish(false);
    // Escape 只關閉對話框，不能再觸發頁面的返回列表快捷鍵。
    box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();finish(false);}});
    box.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
    box.addEventListener('close',()=>finish(false));
    document.body.append(box);box.showModal();cancel.focus();
  });
}
const when=t=>t?new Date(t).toLocaleString('zh-TW',{hour12:false}):'—';
const money=n=>'US$'+((n||0)/1e6).toFixed(2);
async function run(fn,button,label){
  if(button&&busyButtons.has(button))return;
  const nodes=button?[...button.childNodes]:[],disabled=button?button.disabled:false;activeActions++;
  if(button){busyButtons.add(button);button.disabled=true;button.setAttribute('aria-busy','true');button.replaceChildren(el('span',{class:'spinner','aria-hidden':'true'}),document.createTextNode(label||'處理中…'));}
  try{return await fn();}catch(e){if(!e.auth)message(e.message,true);}
  finally{activeActions--;if(button){button.replaceChildren(...nodes);button.disabled=disabled;button.removeAttribute('aria-busy');busyButtons.delete(button);}}
}
function showLogin(){$('login').classList.remove('hidden');$('app').classList.add('hidden');$('logout').classList.add('hidden');}
function showApp(){$('login').classList.add('hidden');$('app').classList.remove('hidden');$('logout').classList.remove('hidden');}
function bindLogin(boot){
  $('login-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await fetch('/learning/session',{method:'POST',headers:{'content-type':'application/json','x-learning-request':'1'},body:JSON.stringify({token:$('token').value})});$('token').value='';if(!r.ok)throw Error('登入失敗，請檢查憑證與設定。');message('');await boot();},e.submitter||e.target.querySelector('button'),'登入中…');};
  $('logout').onclick=e=>run(async()=>{await fetch('/learning/session',{method:'DELETE',headers:{'x-learning-request':'1'}});showLogin();},e.currentTarget,'登出中…');
}
const STATES={queued:'等待處理',processing:'處理中',awaiting_backfill:'等待確認回補',ready:'已完成',partial:'已完成・來源缺漏',error:'待重試',needs_attention:'需要處理',budget_paused:'費用暫停',paused:'手動暫停',waiting_local:'等待本機',generating:'本機生成中',filtered:'主題不符・已略過'};
const STAGES={source:'取得來源',media:'解析媒體',text:'文字生成'};
const ORIGINS={official:'官方來源',bookmark:'X 書籤',backfill:'書籤回補',share:'Telegram 分享',web:'網站加入'};
const RELATIONS={primary:'主要來源',author_reply:'作者補充',quote:'引用',parent:'父貼文',repost:'轉貼',external:'外部文章',context_missing:'上下文缺漏',author_context_missing:'作者補充缺漏',model_media_observation:'舊版媒體觀察',media_evidence:'媒體證據'};
const FINAL=['ready','partial','filtered','needs_attention','awaiting_backfill'];
function stateLabel(i){return i.status==='processing'&&STAGES[i.stage]?'處理中・'+STAGES[i.stage]:(STATES[i.status]||i.status);}
function stateTone(s){return ['needs_attention','error','partial'].includes(s)?'warn':['waiting_local','generating','queued','processing','budget_paused','paused'].includes(s)?'wait':'done';}
`;

export const LOGIN=String.raw`<section id="login" class="panel hidden" aria-labelledby="login-title"><h1 id="login-title" style="font-size:22px;margin-top:0">登入私人文章庫</h1><p class="muted">使用網站登入憑證（RUN_TOKEN）。通知連結不包含登入憑證。</p><form id="login-form"><label for="token">登入憑證</label><input id="token" type="password" autocomplete="current-password" required style="width:100%;margin:8px 0 16px"><button class="primary">登入</button></form></section>`;

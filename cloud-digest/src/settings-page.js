export const SETTINGS_PAGE = String.raw`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechNews 設定</title>
<style>
:root{color-scheme:light dark;--bg:light-dark(#fff,#111);--fg:light-dark(#171717,#f5f5f5);--muted:light-dark(#475569,#b8c0cc);--line:light-dark(#e5e5e5,#444);--action:light-dark(#171717,#f5f5f5);--on-action:light-dark(#fff,#171717)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:32px 20px 64px}h1{font-size:28px;margin:0}h2{font-size:21px;margin:32px 0 12px}p{color:var(--muted)}label{display:block;margin:18px 0 6px}input,select,textarea,button{font:inherit;border:1px solid var(--line);border-radius:6px;padding:10px 12px;min-height:44px;background:var(--bg);color:var(--fg)}input,select,textarea{width:100%}textarea{resize:vertical}button{cursor:pointer;margin:16px 8px 0 0}button.primary{background:var(--action);color:var(--on-action)}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid var(--fg);outline-offset:3px}summary{cursor:pointer;padding:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;border-top:1px solid var(--line);padding-top:16px}small{display:block;color:var(--muted)}#status{min-height:26px;color:var(--fg)}[hidden]{display:none!important}
</style></head><body><main>
<h1>TechNews 設定</h1><p>切換摘要模型與關注主題。儲存後，下次執行就會使用新設定。</p>
<form id="login"><label for="token">管理密鑰 RUN_TOKEN</label><input id="token" type="password" autocomplete="current-password" required><small>密鑰只留在這個頁面的記憶體，關閉頁面後需重新輸入。</small><button class="primary">讀取設定</button></form>
<p id="status" role="status" aria-live="polite"></p>
<section id="editor" hidden><form id="settings">
<label for="profile">摘要模型</label><select id="profile"></select><small id="model-info"></small>
<label for="interests">想收到的內容</label><textarea id="interests" rows="6" required maxlength="4000"></textarea><small>模型讀完正文後再判斷。略過理由會存到資料庫，方便追查。</small>
<details><summary>進階：編輯來源設定 JSON</summary><label for="sources">來源清單</label><textarea id="sources" rows="12" spellcheck="false"></textarea><small>可以新增 HTTPS RSS 或文章列表。新網站需指定文章路徑；特殊正文可加 contentSelector。</small></details>
<button class="primary">儲存設定</button></form>
<h2>先試讀一篇</h2><p>使用上方選中的模型試讀，不會儲存設定，也不會發送 Telegram。</p>
<form id="preview"><label for="source">文章來源</label><select id="source"></select><label for="article-url">原文網址（可留空）</label><input id="article-url" type="url" placeholder="留空會使用來源列表第一篇"><button>產生導讀預覽</button></form>
<pre id="result" hidden></pre>
</section></main><script>
let token='',profiles={},current;
const el=id=>document.getElementById(id);
const status=text=>{el('status').textContent=text};
async function api(path,options={}){const res=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})}});if(!res.ok){let data;try{data=await res.json()}catch{}throw new Error(data?.error||'讀取失敗，請確認密鑰或稍後重試。')}return await res.json()}
function info(){const p=profiles[el('profile').value];el('model-info').textContent=p.model+(p.provider==='workers_ai'?' · 使用 Workers AI 每日額度':' · 使用各供應商 API 額度');}
function fill(data){current=data.settings;profiles=data.profiles;el('profile').replaceChildren();for(const [key,p]of Object.entries(profiles)){const option=document.createElement('option');option.value=key;option.textContent=p.label;option.disabled=(p.provider==='openai'&&!data.openai_configured)||(p.provider==='anthropic'&&!data.anthropic_configured);el('profile').append(option)}el('profile').value=current.model_profile;el('interests').value=current.interests;el('sources').value=JSON.stringify(current.sources,null,2);el('source').replaceChildren();for(const source of current.sources){const option=document.createElement('option');option.value=source.id;option.textContent=source.name;el('source').append(option)}info();}
async function busy(form,fn){const button=form.querySelector('button');button.disabled=true;try{await fn()}catch(error){status(error.message)}finally{button.disabled=false}}
el('profile').addEventListener('change',info);
el('login').addEventListener('submit',e=>{e.preventDefault();busy(e.target,async()=>{token=el('token').value;status('讀取中…');fill(await api('/config'));el('editor').hidden=false;el('login').hidden=true;el('token').value='';status('目前設定已載入。')})});
el('settings').addEventListener('submit',e=>{e.preventDefault();busy(e.target,async()=>{let sources;try{sources=JSON.parse(el('sources').value)}catch{throw new Error('來源 JSON 格式有誤，請檢查括號與逗號。')}status('儲存中…');const data=await api('/config',{method:'PUT',body:JSON.stringify({model_profile:el('profile').value,interests:el('interests').value,sources})});fill(data);status('設定已儲存，下次執行生效。')})});
el('preview').addEventListener('submit',e=>{e.preventDefault();busy(e.target,async()=>{status('正在擷取全文並產生導讀，請稍候…');const query=new URLSearchParams({source:el('source').value,profile:el('profile').value});if(el('article-url').value)query.set('url',el('article-url').value);const data=await api('/preview?'+query);el('result').hidden=false;el('result').textContent=data.message||('略過此文章：'+data.summary.reason);status('預覽完成 · '+data.content_chars+' 字元正文 · '+data.content_method+' · '+data.summary.model)})});
</script></body></html>`;

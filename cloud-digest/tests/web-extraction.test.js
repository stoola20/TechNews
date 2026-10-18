import test from 'node:test';
import assert from 'node:assert/strict';
import {webEvidence} from '../src/learning/network.js';

const body='這段是正文，說明模型用途、執行方式與限制。'.repeat(12);
function site(html,type='text/html'){
  const calls=[];
  const fetcher=async value=>{const url=new URL(value);calls.push(url.href);
    if(url.hostname==='cloudflare-dns.com')return Response.json({Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.216.34'}]:[]});
    return new Response(html,{headers:{'content-type':type}});};
  return {fetcher,calls};
}
function browser(html){const calls=[];return {calls,async quickAction(kind,options){calls.push({kind,options});return Response.json({result:html});}};}

test('沒有 <article>／<main> 的頁面從 <body> 擷取，移除導覽、頁首與頁尾',async()=>{
  const page=`<html><head><title>模型頁</title></head><body><header>網站選單</header><nav>導覽</nav><div><h1>示範模型</h1><p>${body}</p></div><footer>版權頁尾</footer></body></html>`;
  const {fetcher}=site(page),env={BROWSER:browser('')};
  const result=await webEvidence('https://example.org/library/demo',fetcher,env);
  assert.equal(result.metadata.title,'示範模型');assert.match(result.content,/模型用途/);
  assert.doesNotMatch(result.content,/網站選單|導覽|版權頁尾/);
  assert.equal(env.BROWSER.calls.length,0);
});

test('裝飾圖片（logo、頭像、小圖示、SVG、頁首內）不登記為媒體，正文圖片保留',async()=>{
  const page=`<html><body><header><img src="/hero-banner.png" width="1200"></header><article><h1>文章</h1><p>${body}</p>
    <img src="https://cdn.example.org/brand/logo.png"><img src="https://img.example.org/a=s120"><img src="/icons/star.png">
    <img src="/badge.svg"><img src="/tiny.png" width="32" height="32"><img src="https://cdn-avatars.example.org/u/1.jpeg">
    <img src="/diagrams/architecture.png" width="960"><img src="https://img.example.org/b=s550-w550-h350"></article></body></html>`;
  const result=await webEvidence('https://example.org/post',site(page).fetcher);
  assert.deepEqual(result.media.map(m=>m.url),['https://example.org/diagrams/architecture.png','https://img.example.org/b=s550-w550-h350']);
});

test('靜態 HTML 沒有正文時才用 Browser Rendering 擷取渲染後頁面',async()=>{
  const shell='<html><head><title>載入中</title></head><body><div id="app"></div></body></html>';
  const rendered=`<html><body><main><h1>渲染後文章</h1><p>${body}</p></main></body></html>`;
  const env={BROWSER:browser(rendered)};
  const result=await webEvidence('https://example.org/app',site(shell).fetcher,env);
  assert.equal(env.BROWSER.calls.length,1);assert.equal(env.BROWSER.calls[0].kind,'content');
  assert.equal(result.metadata.title,'渲染後文章');assert.equal(result.metadata.content_method,'browser_html');
  await assert.rejects(webEvidence('https://example.org/app',site(shell).fetcher,{}),/Article/);
});

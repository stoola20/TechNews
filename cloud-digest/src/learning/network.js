import { readBoundedText, extractArticle,htmlToText } from '../sources.js';
import { parseHTML } from 'linkedom';

export function canonicalUrl(value) {
  const u=new URL(value);
  if(u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443'))throw new Error('只接受公開 HTTPS 連結');
  const h=u.hostname.toLowerCase();
  if(!h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h) || /(^|\.)(localhost|local|internal|test|invalid|lan)$/.test(h))throw new Error('不接受本機或內網來源');
  if(['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(h)) {
    const match=u.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status|i\/status)\/(\d+)\/?$/);
    if(!match)throw new Error('請提供 X 貼文連結');
    return `https://x.com/i/status/${match[1]}`;
  }
  u.hash='';
  for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/.test(k))u.searchParams.delete(k);
  return u.href;
}
export function publicAddress(ip) {
  if(ip.includes(':'))return /^2[0-9a-f]{3}:/i.test(ip) && !/^2001:(db8|0|10|20):/i.test(ip);
  const n=ip.split('.').map(Number);
  if(n.length!==4 || n.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  return !(n[0]===0 || n[0]===10 || n[0]===127 || n[0]>=224 || (n[0]===169&&n[1]===254) || (n[0]===172&&n[1]>=16&&n[1]<=31) || (n[0]===192&&[0,168].includes(n[1])) || (n[0]===100&&n[1]>=64&&n[1]<=127) || (n[0]===198&&[18,19].includes(n[1])) || (n[0]===198&&n[1]===51) || (n[0]===203&&n[1]===0&&n[2]===113));
}
export async function publicFetch(url, fetcher=fetch, options={}) {
  let target=canonicalUrl(url);
  for(let i=0;i<6;i++) {
    const hostname=new URL(target).hostname;
    const results=await Promise.all(['A','AAAA'].map(async type=>{
      const response=await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(15000)});
      const data=JSON.parse(await readBoundedText(response,32000));
      return (data.Answer || []).filter(a=>[1,28].includes(a.type)).map(a=>a.data);
    }));
    const ips=results.flat();
    if(!ips.length || ips.some(ip=>!publicAddress(ip)))throw new Error('來源網域沒有可用的公開位址');
    const response=await fetcher(target,{...options,redirect:'manual',signal:AbortSignal.timeout(90000)});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();
      target=canonicalUrl(new URL(response.headers.get('location'),target).href);
      continue;
    }
    return response;
  }
  throw new Error('來源重新導向過多');
}
export async function webEvidence(url, fetcher=fetch) {
  const response=await publicFetch(url,fetcher);
  const type=response.headers.get('content-type') || '';
  if(!/text\/(html|plain|markdown)/i.test(type))throw new Error('目前外部文章需提供 HTML、文字或 Markdown 正文');
  const raw=await readBoundedText(response,2000000);
  if(!/html/i.test(type))return {url,relation:'primary',content:raw,metadata:{title:url},media:[]};
  const resolved=response.url || url;
  const doc=parseHTML(raw).document;
  const root=doc.querySelector('article') || doc.querySelector('main');
  let entry;
  try{entry=extractArticle(raw,{id:'learning',contentSelector:null},{url:resolved,title:url});}
  catch(error){
    const title=doc.querySelector('h1')?.textContent?.trim();
    if(!root || !title || /just a moment|verify you are human|access denied/i.test(title))throw error;
    for(const element of root.querySelectorAll('script,style,nav,footer,aside,button'))element.remove();
    const content=htmlToText(root.outerHTML);
    if(!content)throw error;
    entry={title,content,publishedAt:null};
  }
  const media=[...(root?.querySelectorAll('img') || [])].map(img=>{
    const source=img.getAttribute('data-src') || img.getAttribute('srcset')?.split(',').at(-1).trim().split(/\s+/)[0] || img.getAttribute('src');
    try{if(!source)throw new Error('Missing image URL');return {url:canonicalUrl(new URL(source,resolved).href),type:'photo'};}catch{return {url:null,type:'photo'};}
  });
  return {url,relation:'primary',content:entry.content,published_at:entry.publishedAt,metadata:{title:entry.title},media};
}
export async function apiJson(response, limit=2000000) {
  if(!response.ok){await response.body?.cancel();const error=new Error(`外部服務 HTTP ${response.status}`);error.status=response.status;throw error;}
  const raw=await readBoundedText(response,limit);
  try{return JSON.parse(raw);}catch{throw new Error('外部服務回應不是有效 JSON');}
}

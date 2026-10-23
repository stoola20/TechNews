import { readBoundedText, extractArticle, htmlToText } from '../sources.js';
import { parseHTML } from 'linkedom';

export function canonicalUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443'))
    throw new Error('只接受公開 HTTPS 連結');
  const h = u.hostname.toLowerCase();
  if (
    !h.includes('.') ||
    h.includes(':') ||
    /^[\d.]+$/.test(h) ||
    /(^|\.)(localhost|local|internal|test|invalid|lan)$/.test(h)
  )
    throw new Error('不接受本機或內網來源');
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(h)) {
    const match = u.pathname.match(
      /^\/(?:[^/]+\/status|i\/web\/status|i\/status)\/(\d+)(?:\/(?:video|photo)\/[1-9]\d*)?\/?$/,
    );
    if (!match) throw new Error('請提供 X 貼文連結');
    return `https://x.com/i/status/${match[1]}`;
  }
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/.test(k)) u.searchParams.delete(k);
  return u.href;
}
export function publicAddress(ip) {
  if (ip.includes(':')) return /^2[0-9a-f]{3}:/i.test(ip) && !/^2001:(db8|0|10|20):/i.test(ip);
  const n = ip.split('.').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  return !(
    n[0] === 0 ||
    n[0] === 10 ||
    n[0] === 127 ||
    n[0] >= 224 ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && [0, 168].includes(n[1])) ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 198 && [18, 19].includes(n[1])) ||
    (n[0] === 198 && n[1] === 51) ||
    (n[0] === 203 && n[1] === 0 && n[2] === 113)
  );
}
export async function publicFetch(url, fetcher = fetch, options = {}) {
  let target = canonicalUrl(url);
  for (let i = 0; i < 6; i++) {
    const hostname = new URL(target).hostname;
    const results = await Promise.all(
      ['A', 'AAAA'].map(async (type) => {
        const response = await fetcher(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
          { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(15000) },
        );
        const data = JSON.parse(await readBoundedText(response, 32000));
        return (data.Answer || []).filter((a) => [1, 28].includes(a.type)).map((a) => a.data);
      }),
    );
    const ips = results.flat();
    if (!ips.length || ips.some((ip) => !publicAddress(ip))) throw new Error('來源網域沒有可用的公開位址');
    const response = await fetcher(target, { ...options, redirect: 'manual', signal: AbortSignal.timeout(90000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      target = canonicalUrl(new URL(response.headers.get('location'), target).href);
      continue;
    }
    return response;
  }
  throw new Error('來源重新導向過多');
}
// 頭像、logo、小圖示等裝飾圖片不當作來源媒體，也不列為缺漏。
const DECORATIVE_PATH = /(^|[\/_.-])(logo|logos|avatar|avatars|icon|icons|favicon|branding|emoji|sprite)([\/_.-]|$)/i;
function imageSize(img, source) {
  const sizes = [Number(img.getAttribute('width')), Number(img.getAttribute('height'))].filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  // 常見 CDN 以網址參數標示縮圖尺寸，例如 =s120、=w64-h64、?w=48。
  const hinted = source.match(/=(?:s|w|h)(\d{1,4})(?:-|$)|[?&](?:w|width|h|height|size)=(\d{1,4})(?:&|$)/i);
  if (hinted) sizes.push(Number(hinted[1] || hinted[2]));
  return sizes.length ? Math.max(...sizes) : null;
}
export function decorativeImage(img, source) {
  let path = '';
  try {
    const u = new URL(source);
    path = u.hostname + u.pathname;
  } catch {
    return true;
  }
  if (/\.svg$/i.test(path) || /^data:/i.test(source) || DECORATIVE_PATH.test(path)) return true;
  const size = imageSize(img, source);
  if (size != null && size <= 200) return true;
  return !!img.closest?.('header,nav,footer,aside');
}
// 正文區塊裡的 <img>：取最大尺寸的來源，排除裝飾圖片，同一張圖只登記一次。
function bodyImages(root, resolved) {
  const media = [...(root?.querySelectorAll('img') || [])].flatMap((img) => {
    const source =
      img.getAttribute('data-src') ||
      img.getAttribute('srcset')?.split(',').at(-1).trim().split(/\s+/)[0] ||
      img.getAttribute('src');
    if (!source) return [];
    try {
      const href = new URL(source, resolved).href;
      if (decorativeImage(img, href)) return [];
      return [{ url: canonicalUrl(href), type: 'photo' }];
    } catch {
      return [];
    }
  });
  return media.filter((m, i) => media.findIndex((x) => x.url === m.url) === i);
}
// 官方文章的圖片：正文區塊依來源設定的選擇器，找不到時退到 <article>／<main>／<body>。
export function pageMedia(html, selectors, resolved) {
  const doc = parseHTML(html).document;
  const root =
    [...selectors, 'article', 'main'].map((selector) => doc.querySelector(selector)).find(Boolean) || doc.body;
  return bodyImages(root, resolved);
}
// 沒有 <article>／<main> 的頁面退到 <body>，先移除導覽、頁首、頁尾與表單等非正文區塊。
function pageEvidence(raw, url, resolved) {
  const doc = parseHTML(raw).document;
  const root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const media = bodyImages(root, resolved);
  let entry;
  try {
    entry = extractArticle(raw, { id: 'learning', contentSelector: null }, { url: resolved, title: url });
  } catch (error) {
    const title = (doc.querySelector('h1')?.textContent || doc.querySelector('title')?.textContent || '').trim();
    if (!root || !title || /just a moment|verify you are human|access denied/i.test(title)) throw error;
    for (const element of root.querySelectorAll(
      'script,style,noscript,template,svg,nav,header,footer,aside,button,form,dialog',
    ))
      element.remove();
    const content = htmlToText(root.outerHTML);
    if (content.length < 200) throw error;
    entry = { title, content, publishedAt: null };
  }
  return {
    url,
    relation: 'primary',
    content: entry.content,
    published_at: entry.publishedAt,
    metadata: { title: entry.title },
    media,
  };
}
export async function webEvidence(url, fetcher = fetch, env = {}) {
  const response = await publicFetch(url, fetcher);
  const type = response.headers.get('content-type') || '';
  if (!/text\/(html|plain|markdown)/i.test(type)) throw new Error('目前外部文章需提供 HTML、文字或 Markdown 正文');
  const raw = await readBoundedText(response, 2000000);
  if (!/html/i.test(type)) return { url, relation: 'primary', content: raw, metadata: { title: url }, media: [] };
  const resolved = response.url || url;
  try {
    return pageEvidence(raw, url, resolved);
  } catch (error) {
    // 靜態 HTML 沒有正文時（常見於前端渲染頁），用 Browser Rendering 取得渲染後頁面再擷取一次。
    if (!env.BROWSER) throw error;
    const rendered = await env.BROWSER.quickAction('content', {
      url: resolved,
      gotoOptions: { waitUntil: 'networkidle2', timeout: 25000 },
    });
    const text = await readBoundedText(rendered, 2000000);
    const html = rendered.headers.get('content-type')?.includes('json') ? JSON.parse(text).result : text;
    const page = pageEvidence(html, url, resolved);
    return { ...page, metadata: { ...page.metadata, content_method: 'browser_html' } };
  }
}
export async function apiJson(response, limit = 2000000) {
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`外部服務 HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const raw = await readBoundedText(response, limit);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('外部服務回應不是有效 JSON');
  }
}

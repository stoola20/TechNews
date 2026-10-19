import { parseHTML } from "linkedom";

// Entries are discovered from curated official feeds, then filtered by reader interests.
export const SOURCES = [
  { id: "openai_developer_blog", name: "OpenAI Developer Blog", indexUrl: "https://developers.openai.com/blog", kind: "blog", host: "developers.openai.com", paths: ["blog"] },
  { id: "apple_developer_news", name: "Apple Developer News", indexUrl: "https://developer.apple.com/news/rss/news.rss", kind: "rss", host: "developer.apple.com", paths: ["news"] },
  { id: "claude_blog", name: "Claude Blog", indexUrl: "https://claude.com/resources/articles", kind: "blog", host: "claude.com", paths: ["resources/articles", "blog"] },
  { id: "openai_news", name: "OpenAI News", indexUrl: "https://openai.com/news/rss.xml", kind: "rss", host: "openai.com", paths: ["index"] },
  { id: "claude_dev", name: "claude.dev", indexUrl: "https://claude.dev/rss.xml", kind: "rss", host: "claude.dev", paths: ["blog"], markdown: true },
  { id: "anthropic_news", name: "Anthropic News", indexUrl: "https://www.anthropic.com/news", kind: "blog", host: "www.anthropic.com", paths: ["news"] },
  { id: "anthropic_engineering", name: "Anthropic Engineering", indexUrl: "https://www.anthropic.com/engineering", kind: "blog", host: "www.anthropic.com", paths: ["engineering"] },
];

export function getSources(env = {}) {
  const sources = env.SOURCES_JSON ? JSON.parse(env.SOURCES_JSON) : SOURCES;
  if (!Array.isArray(sources) || !sources.length || sources.length > 12) throw new Error("來源清單需要 1–12 個來源");
  const ids = new Set();
  // 錯誤訊息會直接顯示在管理頁，指出第幾筆、哪個欄位有問題。
  sources.forEach((source, index) => {
    const at = `第 ${index + 1} 個來源${source?.id ? `（${source.id}）` : ""}`;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`${at}必須是物件`);
    if (!source.id || typeof source.id !== "string") throw new Error(`${at}缺少 id`);
    if (ids.has(source.id)) throw new Error(`${at}的 id 重複`);
    if (!source.name || typeof source.name !== "string") throw new Error(`${at}缺少 name`);
    let url;
    try { url = new URL(source.indexUrl); } catch { throw new Error(`${at}的 indexUrl 不是有效網址`); }
    if (url.protocol !== "https:") throw new Error(`${at}的 indexUrl 必須是 https`);
    if (url.hostname !== source.host) throw new Error(`${at}的 host 必須與 indexUrl 的網域相同`);
    if (!["rss", "blog"].includes(source.kind)) throw new Error(`${at}的 kind 只能是 rss 或 blog`);
    if (!Array.isArray(source.paths) || !source.paths.length || source.paths.some((path) => typeof path !== "string" || !path)) throw new Error(`${at}的 paths 需要至少一個文章路徑前綴`);
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new Error(`${at}的 enabled 只能是 true 或 false`);
    ids.add(source.id);
  });
  return sources;
}

// 舊設定沒有 enabled 欄位，視為開啟。
export function sourceEnabled(source) {
  return source.enabled !== false;
}

export function canonicalArticleUrl(value, source) {
  try {
    const url = new URL(value, source.indexUrl);
    if (url.protocol !== "https:" || url.hostname !== source.host) return null;
    if (source.id === "apple_developer_news") {
      return url.pathname === "/news/" && url.searchParams.get("id") ? `https://developer.apple.com/news/?id=${encodeURIComponent(url.searchParams.get("id"))}` : null;
    }
    const path = url.pathname.replace(/^\/|\/$/g, "");
    if (!(source.paths || ["blog"]).some((prefix) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes("/") && !/\.(md|xml|json)$/.test(path))) return null;
    // The former Claude Blog URLs redirect to this path. Keep a single identity.
    const canonicalPath = source.id === "claude_blog" ? path.replace(/^blog\//, "resources/articles/") : path;
    return `${url.origin}/${canonicalPath}`;
  } catch { return null; }
}

export function decodeEntities(value) {
  return parseHTML(`<html><body>${value}</body></html>`).document.body.textContent;
}

function nodeText(node, baseUrl) {
  if (node.nodeType === 3) return node.textContent;
  const tag = node.tagName?.toLowerCase();
  if (["script", "style", "nav", "footer", "aside", "button", "svg"].includes(tag)) return "";
  if (tag === "br") return "\n";
  if (tag === "img") return node.getAttribute("alt") ? `[圖片說明：${node.getAttribute("alt")}]` : "";
  let text = [...node.childNodes].map((child) => nodeText(child, baseUrl)).join("");
  if (tag === "a" && baseUrl) {
    try {
      const href = new URL(node.getAttribute("href"), baseUrl);
      if (["http:", "https:"].includes(href.protocol) && !href.hash && text.trim()) text = `${text.trim()} (${href.href})`;
    } catch { /* Keep the link label when its target is invalid. */ }
  }
  if (tag === "pre") return `\n\n${node.textContent}\n\n`;
  if (["p", "li", "h1", "h2", "h3", "h4", "blockquote", "div", "section", "article", "tr", "figcaption"].includes(tag)) return `\n\n${text}\n\n`;
  if (["td", "th"].includes(tag)) return `${text}\t`;
  return text;
}

function cleanText(text) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlToText(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  return cleanText(nodeText(document.body));
}

export function discoverBlogLinks(html, source) {
  const { document } = parseHTML(html);
  const urls = new Map();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = canonicalArticleUrl(anchor.getAttribute("href"), source);
    if (!url || urls.has(url)) continue;
    const card = anchor.closest("article, li");
    const publishedAt = card?.querySelector("time")?.getAttribute("datetime") || null;
    urls.set(url, { url, title: cleanText(anchor.textContent), publishedAt, content: null });
  }
  return [...urls.values()].slice(0, 80);
}

function xmlField(item, name) {
  const match = item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!match) return "";
  const raw = match[1].trim();
  return raw.startsWith("<![CDATA[") ? raw.slice(9, -3) : decodeEntities(raw);
}

export function parseFeed(xml, source) {
  const entries = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const url = canonicalArticleUrl(xmlField(item, "link"), source);
    if (!url) continue;
    entries.push({ url, title: htmlToText(xmlField(item, "title")), publishedAt: xmlField(item, "pubDate") || null, content: htmlToText(xmlField(item, "description")) });
    if (entries.length >= 80) break;
  }
  return entries.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 80);
}

export function parseAppleFeed(xml) { return parseFeed(xml, SOURCES[1]); }

export function extractArticle(html, source, entry) {
  const { document } = parseHTML(html);
  const title = cleanText(document.querySelector("h1")?.textContent || entry.title || "");
  const selectors = source.contentSelector ? [source.contentSelector] : source.id === "claude_dev" ? [".prose"] : ["article#mainContent", "article", "main"];
  const root = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!root) throw new Error(`Article body not found for ${entry.url}`);
  // Remove adjacent posts and site controls before collecting every body section.
  for (const unwanted of root.querySelectorAll('script, style, nav, footer, aside, button, [class*="RelatedPosts"], [class*="blog_related"], [class*="newsletter"], [data-cta-section]')) unwanted.remove();
  const content = cleanText(nodeText(root, entry.url));
  const time = document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") || document.querySelector("time[datetime]")?.getAttribute("datetime");
  const date = root.textContent.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/)?.[0];
  if (!title || content.length < 100 || /just a moment|verify you are human|access denied/i.test(title)) throw new Error(`Article extraction failed for ${entry.url}`);
  return { ...entry, title, publishedAt: entry.publishedAt || time || date || null, content, contentMethod: "article_html" };
}

export async function readBoundedText(response, limit = 2_000_000) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Source HTTP ${response.status}`); }
  if (Number(response.headers.get("content-length") || 0) > limit) { await response.body?.cancel(); throw new Error("Source response exceeds size limit"); }
  if (!response.body) throw new Error("Source response has no body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error("Source response exceeds size limit"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function fetchText(url, fetcher) {
  return await readBoundedText(await fetcher(url, { headers: { "User-Agent": "DeveloperDigest/2.0" }, signal: AbortSignal.timeout(25000) }));
}

export async function discoverSource(source, fetcher = fetch) {
  const body = await fetchText(source.indexUrl, fetcher);
  return source.kind === "rss" ? parseFeed(body, source) : discoverBlogLinks(body, source);
}

export async function loadArticle(source, entry, fetcher = fetch, env = {}) {
  if (!canonicalArticleUrl(entry.url, source)) throw new Error("Article URL outside configured source");
  let article;
  try {
    if (source.markdown) {
      const content = await fetchText(`${entry.url.replace(/\/$/, "")}.md`, fetcher);
      if (!content.trim().startsWith("# ") || content.length < 100) throw new Error("Official Markdown article unavailable");
      article = { ...entry, title: content.match(/^# (.+)$/m)?.[1] || entry.title, publishedAt: entry.publishedAt || content.match(/^- Published: (.+)$/m)?.[1] || null, content, contentMethod: "official_markdown" };
    } else {
      article = extractArticle(await fetchText(entry.url, fetcher), source, entry);
    }
  } catch (error) {
    if (!env.BROWSER) throw error;
    const response = await env.BROWSER.quickAction("content", { url: entry.url, gotoOptions: { waitUntil: "networkidle2", timeout: 25000 } });
    const rendered = await readBoundedText(response);
    const html = response.headers.get("content-type")?.includes("json") ? JSON.parse(rendered).result : rendered;
    article = { ...extractArticle(html, source, entry), contentMethod: "browser_html" };
  }
  // Fail instead of silently dropping the end of the article.
  const limit = Number(env.MAX_ARTICLE_CHARS || 150000);
  if (!Number.isFinite(limit) || limit < 100 || article.content.length > limit) throw new Error("Full article exceeds configured input limit; no partial summary generated");
  return article;
}

// 官方來源只收最近 N 天發表的文章：新來源首次回補、每日發現與抓到原文後的檢查共用同一個期限。
export function maxArticleAgeDays(env = {}) {
  const days = Number(env.MAX_ARTICLE_AGE_DAYS || 7);
  if (!Number.isFinite(days) || days < 1) throw new Error("MAX_ARTICLE_AGE_DAYS must be at least 1");
  return days;
}

export function initialSeenUrls(entries, now, lookbackDays = 7) {
  const cutoff = now - lookbackDays * 86400000;
  return entries.filter((entry, index) => {
    const published = Date.parse(entry.publishedAt);
    return Number.isFinite(published) ? published < cutoff : index > 0;
  }).map((entry) => entry.url);
}

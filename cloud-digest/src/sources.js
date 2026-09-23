// The only sites the scheduled Worker reads. Discovery never uses web search.
export const SOURCES = [
  {
    id: "openai_developer_blog", name: "OpenAI Developer Blog", indexUrl: "https://developers.openai.com/blog",
    kind: "blog", host: "developers.openai.com",
  },
  {
    id: "apple_developer_news", name: "Apple Developer News", indexUrl: "https://developer.apple.com/news/rss/news.rss",
    kind: "rss", host: "developer.apple.com",
  },
  {
    id: "claude_blog", name: "Claude Blog", indexUrl: "https://claude.com/blog",
    kind: "blog", host: "claude.com",
  },
];

const ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", rsquo: "’", ndash: "–", mdash: "—" };

export function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITY_MAP[entity.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<\s*(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/?\s*(?:p|li|h[1-6]|blockquote|pre|div)\b[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function discoverBlogLinks(html, source) {
  const urls = new Set();
  const anchor = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(anchor)) {
    try {
      const url = new URL(decodeEntities(match[2]), source.indexUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.protocol !== "https:" || url.hostname !== source.host || parts.length !== 2 || parts[0] !== "blog") continue;
      urls.add(`${url.origin}/${parts.join("/")}`);
    } catch {
      // Ignore malformed links in source HTML.
    }
  }
  return [...urls].slice(0, 40).map((url) => ({ url, title: "", publishedAt: null, content: null }));
}

function xmlField(item, name) {
  const match = item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!match) return "";
  return decodeEntities(match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim());
}

export function parseAppleFeed(xml) {
  const entries = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const link = xmlField(item, "link");
    try {
      const url = new URL(link);
      if (url.hostname !== "developer.apple.com" || url.pathname !== "/news/" || !url.searchParams.get("id")) continue;
      entries.push({
        url: `https://developer.apple.com/news/?id=${encodeURIComponent(url.searchParams.get("id"))}`,
        title: htmlToText(xmlField(item, "title")),
        publishedAt: xmlField(item, "pubDate") || null,
        content: htmlToText(xmlField(item, "description")),
      });
    } catch {
      // Ignore invalid feed entries.
    }
  }
  return entries.slice(0, 40);
}

function sectionAfter(html, marker, endMarker) {
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const openEnd = html.indexOf(">", start);
  const end = html.indexOf(endMarker, openEnd + 1);
  return html.slice(openEnd + 1, end < 0 ? undefined : end);
}

export function extractArticle(html, source, entry) {
  let raw = "";
  if (source.id === "openai_developer_blog") {
    raw = sectionAfter(html, '<article id="mainContent"', "</article>");
  } else if (source.id === "claude_blog") {
    raw = sectionAfter(html, "blog_post_section_wrap", "blog_related_section_wrap");
  }
  if (!raw) raw = sectionAfter(html, "<main", "</main>");
  const content = htmlToText(raw).slice(0, 20000);
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = heading ? htmlToText(heading[1]) : entry.title;
  const datePattern = source.id === "claude_blog"
    ? /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/
    : /[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/;
  const publishedAt = entry.publishedAt || html.match(datePattern)?.[0] || null;
  if (!title || content.length < 100) throw new Error(`Article extraction failed for ${entry.url}`);
  return { ...entry, title, publishedAt, content };
}

export async function readBoundedText(response, limit = 2_000_000) {
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > limit) throw new Error("Source response exceeds size limit");
  if (!response.body) throw new Error("Source response has no body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Source response exceeds size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function discoverSource(source, fetcher = fetch) {
  const response = await fetcher(source.indexUrl, { headers: { "User-Agent": "DeveloperDigest/1.0" }, signal: AbortSignal.timeout(20000) });
  const body = await readBoundedText(response);
  return source.kind === "rss" ? parseAppleFeed(body) : discoverBlogLinks(body, source);
}

export async function loadArticle(source, entry, fetcher = fetch) {
  if (entry.content && entry.content.length >= 100) return entry;
  const response = await fetcher(entry.url, { headers: { "User-Agent": "DeveloperDigest/1.0" }, signal: AbortSignal.timeout(20000) });
  return extractArticle(await readBoundedText(response), source, entry);
}

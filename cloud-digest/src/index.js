import { SOURCES, discoverSource, loadArticle } from "./sources.js";
import { formatAlert, formatFullDigest, parseSummaryResult, summarizePrompt } from "./format.js";

const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const LEASE_MS = 10 * 60 * 1000;

function log(event, details = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function authorized(request, secret) {
  if (!secret) return false;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const encoder = new TextEncoder();
  const a = encoder.encode(candidate);
  const b = encoder.encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function sendTelegram(env, text, silent) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets missing");
  if (!text || text.length > 4096) throw new Error("Telegram message length invalid");
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_notification: silent, link_preview_options: { is_disabled: true } }),
    });
  } catch {
    throw new Error("Telegram network request failed");
  }
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok || !result.result?.message_id) throw new Error(`Telegram API rejected message (${result.error_code || "unknown"})`);
  return result.result.message_id;
}

async function summarize(env, source, entry) {
  const response = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: "你是嚴謹的開發者技術文章編輯。回覆只包含有效 JSON，不要輸出思考過程或 Markdown。" },
      { role: "user", content: summarizePrompt(source, entry) },
    ],
    max_tokens: 1100,
    temperature: 0.2,
  });
  return parseSummaryResult(response);
}

async function initializeSource(env, source, entries, now) {
  let seededUrl = null;
  for (const entry of entries.slice(0, 8)) {
    try {
      const outcome = await processEntry(env, source, entry);
      if (outcome === "notified" || outcome === "already") {
        seededUrl = entry.url;
        break;
      }
    } catch (error) {
      log("seed_candidate_failed", { source: source.id, url: entry.url, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  if (!seededUrl) throw new Error("No suitable article for first digest");
  // Only URLs are checkpointed; older articles are not fetched or inserted.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO source_state (source, initialized_at, last_checked_at, seen_urls_json) VALUES (?, ?, ?, ?)"
  ).bind(source.id, now, now, JSON.stringify(entries.map((entry) => entry.url))).run();
  log("source_initialized", { source: source.id, seededUrl, seenUrlCount: entries.length });
}

async function processEntry(env, source, discovered) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO articles (source_url, source, title, published_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
  ).bind(discovered.url, source.id, discovered.title || discovered.url, discovered.publishedAt, now, now).run();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  const lock = await env.DB.prepare(
    "UPDATE articles SET lease_until = ? WHERE source_url = ? AND status = 'pending' AND (lease_until IS NULL OR lease_until < ?)"
  ).bind(leaseUntil, discovered.url, now).run();
  if (!lock.meta.changes) return "already";
  try {
    let record = await env.DB.prepare("SELECT * FROM articles WHERE source_url = ?").bind(discovered.url).first();
    let summary = record.summary_json ? JSON.parse(record.summary_json) : null;
    let entry = { ...discovered, title: record.title, publishedAt: record.published_at };
    if (!summary) {
      entry = await loadArticle(source, entry);
      summary = await summarize(env, source, entry);
      await env.DB.prepare(
        "UPDATE articles SET title = ?, published_at = ?, summary_json = ?, updated_at = ? WHERE source_url = ?"
      ).bind(entry.title, entry.publishedAt, JSON.stringify(summary), new Date().toISOString(), entry.url).run();
      record = { ...record, title: entry.title, published_at: entry.publishedAt };
    }
    entry = { ...entry, title: record.title, publishedAt: record.published_at };
    if (!record.full_message_id) {
      const messageId = await sendTelegram(env, formatFullDigest(source, entry, summary), true);
      await env.DB.prepare("UPDATE articles SET full_message_id = ?, updated_at = ? WHERE source_url = ?")
        .bind(messageId, new Date().toISOString(), entry.url).run();
    }
    if (!record.alert_message_id) {
      const messageId = await sendTelegram(env, formatAlert(source, entry, summary), false);
      await env.DB.prepare(
        "UPDATE articles SET alert_message_id = ?, status = 'notified', updated_at = ? WHERE source_url = ?"
      ).bind(messageId, new Date().toISOString(), entry.url).run();
    }
    log("article_notified", { source: source.id, url: entry.url });
    return "notified";
  } finally {
    await env.DB.prepare("UPDATE articles SET lease_until = NULL WHERE source_url = ?").bind(discovered.url).run();
  }
}

export async function runDigest(env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets missing");
  const result = { initialized: [], notified: 0, errors: [] };
  for (const source of SOURCES) {
    try {
      const entries = await discoverSource(source);
      if (!entries.length) throw new Error("No articles discovered");
      const now = new Date().toISOString();
      const state = await env.DB.prepare("SELECT seen_urls_json FROM source_state WHERE source = ?").bind(source.id).first();
      if (!state) {
        await initializeSource(env, source, entries, now);
        result.initialized.push(source.id);
        result.notified++;
        continue;
      }
      const seen = new Set(JSON.parse(state.seen_urls_json));
      for (const entry of [...entries].reverse()) {
        if (seen.has(entry.url)) continue;
        try {
          const outcome = await processEntry(env, source, entry);
          if (outcome === "notified") result.notified++;
          seen.add(entry.url);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ source: source.id, url: entry.url, error: message });
          log("article_failed", { source: source.id, url: entry.url, error: message });
        }
      }
      await env.DB.prepare("UPDATE source_state SET last_checked_at = ?, seen_urls_json = ? WHERE source = ?")
        .bind(now, JSON.stringify([...seen].slice(-100)), source.id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push({ source: source.id, error: message });
      log("source_failed", { source: source.id, error: message });
    }
  }
  log("digest_run", { initialized: result.initialized, notified: result.notified, errorCount: result.errors.length });
  return result;
}

export default {
  async scheduled(_controller, env, _ctx) {
    await runDigest(env);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "developer-digest-cloud" });
    }
    if (!authorized(request, env.RUN_TOKEN)) return new Response("Not found", { status: 404 });
    if (url.pathname === "/run" && request.method === "POST") {
      try {
        return Response.json(await runDigest(env));
      } catch (error) {
        log("manual_run_failed", { error: error instanceof Error ? error.message : "Unknown error" });
        return Response.json({ error: "Digest run failed" }, { status: 500 });
      }
    }
    if (url.pathname === "/preview" && request.method === "GET") {
      try {
        const source = SOURCES.find((item) => item.id === url.searchParams.get("source"));
        if (!source) return new Response("Unknown source", { status: 400 });
        const entries = await discoverSource(source);
        const article = await loadArticle(source, entries[0]);
        const summary = await summarize(env, source, article);
        return Response.json({ source: source.name, url: article.url, summary, alert: formatAlert(source, article, summary) });
      } catch (error) {
        log("preview_failed", { error: error instanceof Error ? error.message : "Unknown error" });
        return Response.json({ error: "Preview failed" }, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};

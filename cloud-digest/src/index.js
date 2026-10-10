import { getSources, discoverSource, loadArticle, canonicalArticleUrl, readBoundedText } from "./sources.js";
import { formatFullDigest } from "./format.js";
import { summarize, modelConfiguration } from "./models.js";
import { MODEL_PROFILES, readSettings, saveSettings, effectiveEnvironment, applySettings } from "./settings.js";
import { SETTINGS_PAGE } from "./settings-page.js";
import { timingSafeEqual } from "node:crypto";
import { learning } from "./learning/http.js";

const LEASE_MS = 10 * 60 * 1000;
function log(event, details = {}) { console.log(JSON.stringify({ event, ...details })); }
async function readConfigBody(request) { return await readBoundedText(new Response(request.body), 64000); }

function authorized(request, secret) {
  if (!secret) return false;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const encoder = new TextEncoder();
  const a = encoder.encode(candidate), b = encoder.encode(secret);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export async function sendTelegram(env, text, fetcher = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets missing");
  if (!text || text.length > 4096) throw new Error("Telegram message length invalid");
  let response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_notification: false, link_preview_options: { is_disabled: true } }),
    });
  } catch { throw new Error("Telegram network request failed"); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Telegram HTTP ${response.status}`); }
  const result = await response.json();
  if (!result.ok || !result.result?.message_id) throw new Error(`Telegram API rejected message (${result.error_code || "unknown"})`);
  return result.result.message_id;
}

export async function processEntry(env, source, discovered, dependencies = {}) {
  const load = dependencies.loadArticle || loadArticle;
  const generate = dependencies.summarize || summarize;
  const send = dependencies.sendTelegram || sendTelegram;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO articles (source_url, source, title, published_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
    .bind(discovered.url, source.id, discovered.title || discovered.url, discovered.publishedAt, now, now).run();
  const lock = await env.DB.prepare("UPDATE articles SET lease_until = ? WHERE source_url = ? AND status = 'pending' AND (lease_until IS NULL OR lease_until < ?)")
    .bind(new Date(Date.now() + LEASE_MS).toISOString(), discovered.url, now).run();
  if (!lock.meta.changes) {
    const record = await env.DB.prepare("SELECT status FROM articles WHERE source_url = ?").bind(discovered.url).first();
    return record?.status === "pending" ? "busy" : "already";
  }
  try {
    const record = await env.DB.prepare("SELECT * FROM articles WHERE source_url = ?").bind(discovered.url).first();
    let entry = { ...discovered, title: record.title, publishedAt: record.published_at };
    // A legacy pending record may already have its full digest. Do not send its former second alert.
    if (record.full_message_id) {
      await env.DB.prepare("UPDATE articles SET status = 'notified', updated_at = ? WHERE source_url = ?").bind(now, entry.url).run();
      return "already";
    }
    let summary = record.summary_json ? JSON.parse(record.summary_json) : null;
    if (!summary?.body_zh && summary?.publish !== false) {
      entry = await load(source, entry, fetch, env);
      summary = await generate(env, source, entry);
      await env.DB.prepare("UPDATE articles SET title = ?, published_at = ?, summary_json = ?, content = ?, content_method = ?, model_provider = ?, model_name = ?, updated_at = ? WHERE source_url = ?")
        .bind(entry.title, entry.publishedAt, JSON.stringify(summary), entry.content, entry.contentMethod, summary.provider, summary.model, new Date().toISOString(), entry.url).run();
    }
    if (!summary.publish) {
      await env.DB.prepare("UPDATE articles SET status = 'skipped', updated_at = ? WHERE source_url = ?").bind(now, entry.url).run();
      log("article_skipped", { source: source.id, url: entry.url, reason: summary.reason });
      return "skipped";
    }
    const messageId = await send(env, formatFullDigest(source, entry, summary));
    await env.DB.prepare("UPDATE articles SET full_message_id = ?, status = 'notified', last_error = NULL, updated_at = ? WHERE source_url = ?")
      .bind(messageId, new Date().toISOString(), entry.url).run();
    log("article_notified", { source: source.id, url: entry.url, provider: summary.provider, model: summary.model });
    return "notified";
  } catch (error) {
    await env.DB.prepare("UPDATE articles SET last_error = ?, updated_at = ? WHERE source_url = ?")
      .bind(error instanceof Error ? error.message : "Unknown error", new Date().toISOString(), discovered.url).run();
    throw error;
  } finally {
    await env.DB.prepare("UPDATE articles SET lease_until = NULL WHERE source_url = ?").bind(discovered.url).run();
  }
}

export function initialSeenUrls(entries, now, lookbackDays = 14) {
  const cutoff = now - lookbackDays * 86400000;
  return entries.filter((entry, index) => {
    const published = Date.parse(entry.publishedAt);
    return Number.isFinite(published) ? published < cutoff : index > 0;
  }).map((entry) => entry.url);
}

export async function runDigest(env, dependencies = {}) {
  env = await effectiveEnvironment(env);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets missing");
  const config = modelConfiguration(env);
  if (config.provider === "openai" && !env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  if (config.provider === "anthropic" && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const discover = dependencies.discoverSource || discoverSource;
  const process = dependencies.processEntry || processEntry;
  const limit = Number(env.MAX_ARTICLES_PER_RUN || 6);
  const lookback = Number(env.BACKFILL_DAYS || 14);
  if (!Number.isInteger(limit) || limit < 1 || limit > 6 || !Number.isFinite(lookback) || lookback < 0) throw new Error("Invalid run budget or backfill window");
  const result = { initialized: [], notified: 0, skipped: 0, deferred: 0, errors: [] };
  const queues = [];
  for (const source of getSources(env)) {
    try {
      const entries = await discover(source);
      if (!entries.length) throw new Error("No articles discovered");
      const now = new Date().toISOString();
      let state = await env.DB.prepare("SELECT seen_urls_json FROM source_state WHERE source = ?").bind(source.id).first();
      if (!state) {
        const baseline = initialSeenUrls(entries, Date.now(), lookback);
        await env.DB.prepare("INSERT OR IGNORE INTO source_state (source, initialized_at, last_checked_at, seen_urls_json) VALUES (?, ?, ?, ?)")
          .bind(source.id, now, now, JSON.stringify(baseline)).run();
        state = { seen_urls_json: JSON.stringify(baseline) };
        result.initialized.push(source.id);
      }
      const seen = new Set(JSON.parse(state.seen_urls_json));
      // Queue every discovered new URL before spending the inference budget.
      // A deferred article must survive disappearing from the source's feed.
      for (const entry of entries) {
        if (seen.has(entry.url)) continue;
        await env.DB.prepare("INSERT OR IGNORE INTO articles (source_url, source, title, published_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
          .bind(entry.url, source.id, entry.title || entry.url, entry.publishedAt, now, now).run();
      }
      const pending = await env.DB.prepare("SELECT source_url, title, published_at FROM articles WHERE source = ? AND status = 'pending' ORDER BY created_at LIMIT 200").bind(source.id).all();
      const candidates = new Map();
      // Persisted failures are retried even after they disappear from a feed.
      for (const row of pending.results) {
        if (canonicalArticleUrl(row.source_url, source)) candidates.set(row.source_url, { url: row.source_url, title: row.title, publishedAt: row.published_at, content: null });
      }
      const items = [...candidates.values()].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      queues.push({ source, seen, items, now });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push({ source: source.id, error: message });
      log("source_failed", { source: source.id, error: message });
    }
  }
  // Rotate which source gets the first turn when there are more sources than the budget.
  if (queues.length) {
    const offset = Math.floor(Date.now() / 86400000) % queues.length;
    queues.push(...queues.splice(0, offset));
  }
  let attempted = 0;
  // Give each source a turn so a broad news feed cannot consume the entire budget.
  while (attempted < limit && queues.some((queue) => queue.items.length)) {
    for (const queue of queues) {
      if (attempted >= limit) break;
      const entry = queue.items.shift();
      if (!entry) continue;
      attempted++;
      try {
        const outcome = await process(env, queue.source, entry);
        if (outcome === "notified") result.notified++;
        if (outcome === "skipped") result.skipped++;
        if (outcome !== "busy") queue.seen.add(entry.url);
        else result.deferred++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        result.errors.push({ source: queue.source.id, url: entry.url, error: message });
        log("article_failed", { source: queue.source.id, url: entry.url, error: message });
      }
    }
  }
  for (const queue of queues) {
    result.deferred += queue.items.length;
    // D1 articles retain permanent article identity; this is only a discovery checkpoint.
    await env.DB.prepare("UPDATE source_state SET last_checked_at = ?, seen_urls_json = ? WHERE source = ?")
      .bind(queue.now, JSON.stringify([...queue.seen].slice(-200)), queue.source.id).run();
  }
  log("digest_run", { ...result, errors: result.errors.length });
  return result;
}

export default {
  async scheduled(controller, env, _ctx) {
    const daily = !controller?.cron || controller.cron === "0 1 * * *";
    const results = await Promise.allSettled([
      ...(daily ? [runDigest(env)] : []),
      ...(env.LEARNING_ENABLED === "true" ? [learning.scheduled(env, daily)] : []),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  },
  async queue(batch, env) {
    if (env.LEARNING_ENABLED === "true") await learning.queue(batch, env);
    else for (const message of batch.messages) message.ack();
  },
  async fetch(request, env, ctx) {
    const learningResponse = await learning.fetch(request, env, ctx);
    if (learningResponse) return learningResponse;
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return Response.json({ ok: true, service: "developer-digest-cloud" });
    if (url.pathname === "/settings" && request.method === "GET") return new Response(SETTINGS_PAGE, { headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    } });
    if (!authorized(request, env.RUN_TOKEN)) return new Response("Not found", { status: 404 });
    if (url.pathname === "/config" && ["GET", "PUT"].includes(request.method)) {
      try {
        const settings = request.method === "PUT" ? await saveSettings(env, JSON.parse(await readConfigBody(request))) : await readSettings(env);
        return Response.json({ settings, profiles: MODEL_PROFILES, openai_configured: !!env.OPENAI_API_KEY, anthropic_configured: !!env.ANTHROPIC_API_KEY }, { headers: { "cache-control": "no-store" } });
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid settings" }, { status: 400 }); }
    }
    if (url.pathname === "/run" && request.method === "POST") {
      try { return Response.json(await runDigest(env)); }
      catch (error) {
        log("manual_run_failed", { error: error instanceof Error ? error.message : "Unknown error" });
        return Response.json({ error: "Digest run failed" }, { status: 500 });
      }
    }
    if (url.pathname === "/preview" && request.method === "GET") {
      try {
        const settings = await readSettings(env);
        const profile = url.searchParams.get("profile");
        if (profile && !MODEL_PROFILES[profile]) return new Response("Unknown model profile", { status: 400 });
        env = applySettings(env, { ...settings, model_profile: profile || settings.model_profile });
        const source = getSources(env).find((item) => item.id === url.searchParams.get("source"));
        if (!source) return new Response("Unknown source", { status: 400 });
        const requested = url.searchParams.get("url");
        const entry = requested ? { url: canonicalArticleUrl(requested, source), title: "", publishedAt: null } : (await discoverSource(source))[0];
        if (!entry?.url) return new Response("Invalid article URL", { status: 400 });
        const article = await loadArticle(source, entry, fetch, env);
        const summary = await summarize(env, source, article);
        return Response.json({ source: source.name, url: article.url, content_method: article.contentMethod, content_chars: article.content.length, summary, message: summary.publish ? formatFullDigest(source, article, summary) : null }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        log("preview_failed", { error: error instanceof Error ? error.message : "Unknown error" });
        return Response.json({ error: error instanceof Error ? error.message : "Preview failed" }, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};

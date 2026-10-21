import { discoverSource, initialSeenUrls, getSources, maxArticleAgeDays, sourceEnabled } from '../sources.js';
import { effectiveEnvironment, readSettings } from '../settings.js';
import { query, rows, nowIso } from './store.js';
import { publishedBefore, normalizePublished } from './dates.js';
import { now } from './clock.js';
import { queueSourceAlert } from './notifications.js';

const DAY = 86400000,
  RETENTION_DAYS = 30,
  DETAIL_DAYS = 7,
  CHUNK = 90;

// 從最近一次往回數連續失敗的執行次數；成功一次就中斷。
async function consecutiveFailures(env, sourceId, limit = RETENTION_DAYS + 1) {
  const runs = await rows(
    env,
    'SELECT ok FROM source_runs WHERE source=? ORDER BY ran_at DESC,rowid DESC LIMIT ?',
    sourceId,
    limit,
  );
  const index = runs.findIndex((r) => r.ok);
  return index < 0 ? runs.length : index;
}

async function recordEntry(env, source, entry, at, decision, reason, itemId = null) {
  await query(
    env,
    `INSERT INTO source_entries(source,url,first_seen_at,last_listed_at,title,published_at,decision,reason,item_id) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source,url) DO UPDATE SET last_listed_at=excluded.last_listed_at`,
    source.id,
    entry.url,
    at,
    at,
    entry.title || null,
    entry.publishedAt || null,
    decision,
    reason,
    itemId,
  ).run();
}

// 官方發現只抓來源索引並排入共同文章庫；整理由背景工作與 Mac 持續消化，不受單次處理量限制。
// 每個網址記一列決策，每輪每個來源留一筆執行紀錄，管理頁靠這兩張表說明「為什麼收、為什麼沒收」。
export async function discoverOfficial(env, collect, deps = {}) {
  const effective = await effectiveEnvironment(env);
  const discover = deps.discoverSource || discoverSource;
  const maxAge = maxArticleAgeDays(env);
  const result = { queued: 0, stale: 0, initialized: [], errors: [] };
  // 關閉的來源不發現、不寫執行紀錄，歷史紀錄照常保留。
  for (const source of getSources(effective).filter(sourceEnabled)) {
    const at = nowIso(),
      run = { found: 0, collected: 0, stale: 0, baseline: 0 };
    try {
      const entries = await discover(source);
      if (!entries.length) throw new Error('來源列表沒有找到任何文章');
      run.found = entries.length;
      const state = await query(
        env,
        'SELECT source,last_checked_at FROM source_state WHERE source=?',
        source.id,
      ).first();
      // 新來源只回補近期文章，較舊的記為初次基準。關閉或故障超過保留期限的來源，網址紀錄可能已清掉，也重新建立基準，
      // 避免列表上沒有日期的舊文被當成新文章收件。
      const lapsed =
        !!state && (!state.last_checked_at || Date.parse(state.last_checked_at) < now() - RETENTION_DAYS * DAY);
      const baseline = new Set(state && !lapsed ? [] : initialSeenUrls(entries, now(), maxAge));
      if (!state) {
        await query(
          env,
          "INSERT OR IGNORE INTO source_state(source,initialized_at,last_checked_at,seen_urls_json) VALUES(?,?,?,'[]')",
          source.id,
          at,
          at,
        ).run();
        result.initialized.push(source.id);
      }
      const known = new Set(
        (await rows(env, 'SELECT url FROM source_entries WHERE source=?', source.id)).map((r) => r.url),
      );
      const listed = [];
      for (const entry of entries) {
        if (known.has(entry.url)) {
          listed.push(entry.url);
          continue;
        }
        if (baseline.has(entry.url)) {
          await recordEntry(
            env,
            source,
            entry,
            at,
            'baseline',
            lapsed ? `超過 ${RETENTION_DAYS} 天沒有成功檢查，重新開始前就已在列表上` : '新來源首次執行前就已在列表上',
          );
          run.baseline++;
          continue;
        }
        // 列表裡沒看過、但發表已久的文章（RSS 視窗變長、流程交接留下的積壓）只記為太舊略過，不收件、不通知。
        if (publishedBefore(entry.publishedAt, now(), maxAge)) {
          await recordEntry(env, source, entry, at, 'stale', `發表超過 ${maxAge} 天`);
          run.stale++;
          continue;
        }
        // receipt 固定為官方網址：重複的日次事件或同一篇再次出現都不會新增收件。收件成功才記錄，失敗時下一輪重試。
        const id = await collect(env, entry.url, 'official', `official:${entry.url}`, {
          metadata: { source_id: source.id, title: entry.title || null, published_at: entry.publishedAt || null },
        });
        await recordEntry(env, source, entry, at, 'collected', null, id);
        run.collected++;
      }
      for (let i = 0; i < listed.length; i += CHUNK) {
        const chunk = listed.slice(i, i + CHUNK);
        await query(
          env,
          `UPDATE source_entries SET last_listed_at=? WHERE source=? AND url IN (${chunk.map(() => '?').join(',')})`,
          at,
          source.id,
          ...chunk,
        ).run();
      }
      await query(env, 'UPDATE source_state SET last_checked_at=? WHERE source=?', at, source.id).run();
      await query(
        env,
        'INSERT INTO source_runs(id,source,ran_at,found,collected,stale,baseline,ok) VALUES(?,?,?,?,?,?,?,1)',
        crypto.randomUUID(),
        source.id,
        at,
        run.found,
        run.collected,
        run.stale,
        run.baseline,
      ).run();
      result.queued += run.collected;
      result.stale += run.stale;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const runId = crypto.randomUUID();
      await query(
        env,
        'INSERT INTO source_runs(id,source,ran_at,found,collected,stale,baseline,ok,error) VALUES(?,?,?,?,?,?,?,0,?)',
        runId,
        source.id,
        at,
        run.found,
        run.collected,
        run.stale,
        run.baseline,
        message.slice(0, 500),
      ).run();
      result.errors.push({ source: source.id, error: message });
      try {
        if (await queueSourceAlert(env, source, runId, await consecutiveFailures(env, source.id, 3), message))
          result.alerts = (result.alerts || 0) + 1;
      } catch (alertError) {
        console.log(JSON.stringify({ event: 'source_alert_failed', source: source.id, error: alertError.message }));
      }
    }
  }
  console.log(
    JSON.stringify({
      event: 'official_discovery',
      queued: result.queued,
      stale: result.stale,
      initialized: result.initialized,
      errors: result.errors.length,
    }),
  );
  return result;
}

// 管理頁「官方來源」：想收到的內容、來源設定，以及每個來源的最近一輪結果、狀態與最近 7 天條目。
export async function officialOverview(env) {
  const settings = await readSettings(env);
  // 各來源的查詢彼此獨立，同時發出；逐一等待時每個來源要多等 3 次資料庫往返。
  const since = new Date(now() - DETAIL_DAYS * DAY).toISOString();
  const sources = await Promise.all(
    settings.sources.map(async (source) => {
      const [state, last, entries] = await Promise.all([
        query(env, 'SELECT initialized_at,last_checked_at FROM source_state WHERE source=?', source.id).first(),
        query(
          env,
          'SELECT ran_at,found,collected,stale,baseline,ok,error FROM source_runs WHERE source=? ORDER BY ran_at DESC LIMIT 1',
          source.id,
        ).first(),
        rows(
          env,
          `SELECT url,title,published_at,decision,reason,item_id,manual,first_seen_at FROM source_entries
      WHERE source=? AND first_seen_at>=? ORDER BY first_seen_at DESC,url LIMIT 200`,
          source.id,
          since,
        ),
      ]);
      return {
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        initialized_at: state?.initialized_at || null,
        last_checked_at: state?.last_checked_at || null,
        last_run: last ? { ...last, ok: !!last.ok } : null,
        status: !source.enabled ? 'disabled' : !last ? 'never' : last.ok ? 'ok' : 'failed',
        consecutive_failures: last && !last.ok ? await consecutiveFailures(env, source.id) : 0,
        entries: entries.map((e) => ({ ...e, published_at: normalizePublished(e.published_at), manual: !!e.manual })),
      };
    }),
  );
  return {
    max_age_days: maxArticleAgeDays(env),
    retention_days: RETENTION_DAYS,
    detail_days: DETAIL_DAYS,
    settings,
    sources,
  };
}

// 紀錄保留 30 天：執行紀錄依時間清除；網址條目只在 30 天內都沒再出現在列表時才刪，避免仍在列表上的舊網址被當成沒看過。
export async function pruneSourceRecords(env) {
  const cutoff = new Date(now() - RETENTION_DAYS * DAY).toISOString();
  const runs = await query(env, 'DELETE FROM source_runs WHERE ran_at<?', cutoff).run();
  const entries = await query(env, 'DELETE FROM source_entries WHERE last_listed_at<?', cutoff).run();
  return { runs: runs.meta.changes || 0, entries: entries.meta.changes || 0 };
}

// 「仍要收件」：等同主動分享（不受主題篩選與新鮮度期限），同時保留官方收件，讓原文沿用官方擷取規則。
// 收件代碼固定，重複按不會新增收件或重複通知。
export async function collectAnyway(env, collect, sourceId, url) {
  const entry = await query(env, 'SELECT * FROM source_entries WHERE source=? AND url=?', sourceId, url).first();
  if (!entry) throw new Error('找不到這篇來源紀錄');
  const id = await collect(env, url, 'web', `manual-official:${url}`);
  await query(
    env,
    "INSERT OR IGNORE INTO learning_intakes(receipt,item_id,origin,metadata_json,created_at) VALUES(?,?,'official',?,?)",
    `official:${url}`,
    id,
    JSON.stringify({ source_id: sourceId, title: entry.title, published_at: entry.published_at }),
    nowIso(),
  ).run();
  await query(
    env,
    "UPDATE source_entries SET decision='collected',manual=1,item_id=?,reason='手動收件' WHERE source=? AND url=?",
    id,
    sourceId,
    url,
  ).run();
  return { id };
}

// 抓到原文後才確定太舊的官方文章，對應的網址條目也改成太舊略過。
export async function markEntryStale(env, itemId, reason) {
  await query(
    env,
    "UPDATE source_entries SET decision='stale',reason=? WHERE item_id=? AND manual=0",
    reason,
    itemId,
  ).run();
}

export async function officialIntake(env, itemId) {
  const intakes = await query(
    env,
    'SELECT origin,metadata_json,created_at FROM learning_intakes WHERE item_id=?',
    itemId,
  ).all();
  const list = intakes.results;
  const official = list.find((i) => i.origin === 'official');
  return {
    official: official ? JSON.parse(official.metadata_json || '{}') : null,
    receivedAt: official?.created_at || null,
    onlyOfficial: !!official && list.every((i) => i.origin === 'official'),
  };
}

// 部落格列表常沒有日期，要抓到原文才知道發表時間。只來自官方、還沒通知過的文章，發表早於收件時 N 天就不整理。
// 以收件時間為準：Mac 離線等自家延誤不會讓已收進來的新文章被丟掉。
export async function staleOfficialReason(env, row, publishedAt) {
  if (!publishedAt || row.edition === 'legacy_digest' || row.notified_revision) return null;
  const intake = await officialIntake(env, row.id);
  if (!intake.onlyOfficial || !intake.receivedAt) return null;
  const days = maxArticleAgeDays(env);
  return publishedBefore(publishedAt, Date.parse(intake.receivedAt), days)
    ? `發表於 ${normalizePublished(publishedAt).slice(0, 10)}，收件時已超過 ${days} 天，不算新知`
    : null;
}

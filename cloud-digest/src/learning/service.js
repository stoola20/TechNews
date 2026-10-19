import {
  query,
  rows,
  setting,
  setSetting,
  hash,
  item,
  evidence,
  saveEvidence,
  connection,
  lock,
  unlock,
  nowIso,
  budget,
  BudgetPaused,
  manuallyPaused,
} from './store.js';
import { canonicalUrl, apiJson } from './network.js';
import { acquireEvidence, resetIncomplete } from './evidence.js';
import { prepareMedia, expireMedia } from './media.js';
import { generate } from './gemini.js';
import {
  syncBookmarks,
  registerMedia,
  startFullScan,
  saveArticle,
  failureDetail,
  bookmarksEnabled,
  authorRecheckEnabled,
} from './x.js';
import { libraryUrl, itemIdForUrl, migrateLibrary, saveVersion } from './library.js';
import { classifyPending, classifyCompleted } from './topics.js';
import { linkedPostFor, mergeIntoLinkedArticle } from './linking.js';
import { textProvider, articleInput, ensureJob, itemPriority } from './local.js';
import { mediaEvidence } from './media-analysis.js';
import { askQuestion, completeQuestion } from './questions.js';
import {
  discoverOfficial,
  officialIntake,
  staleOfficialReason,
  markEntryStale,
  pruneSourceRecords,
} from './official.js';
import { queueArticleNotifications, sendPending, receiptMessage, contentFingerprint } from './notifications.js';
import { startTriageClock, expirePending, purgeDeleted, reviveFromDeleted } from './triage.js';
import { handleTriageCallback } from './telegram-triage.js';
import { maintainIndex } from './rag-index.js';
import { createQuiz, submitAttempt, completeQuiz, completeGrade } from './quiz.js';
import { effectiveEnvironment } from '../settings.js';
import { getSources } from '../sources.js';
import { now, withClock } from './clock.js';

// 只從官方來源收件、且還沒發過通知的新文章才做主題判斷；使用者分享或收藏過的同一篇、已發布過的舊導讀重寫都不淘汰。
async function officialContext(env, row) {
  if (row.edition === 'legacy_digest' || row.notified_revision) return null;
  const intake = await officialIntake(env, row.id);
  if (!intake.onlyOfficial) return null;
  const settings = await effectiveEnvironment(env);
  const source = getSources(settings).find((s) => s.id === intake.official.source_id);
  return {
    source_id: intake.official.source_id,
    source_name: source?.name || intake.official.source_id,
    interests: settings.DIGEST_INTERESTS,
  };
}
export function createLearningService(deps = {}) {
  const fetcher = deps.fetcher || fetch;
  async function enqueue(env, id) {
    if (env.LEARNING_JOBS) await env.LEARNING_JOBS.send({ kind: 'article', id });
  }
  async function collect(env, value, origin = 'share', receipt = null, options = {}) {
    const url = await libraryUrl(env, value),
      time = nowIso();
    let id = await itemIdForUrl(env, url);
    // 文章網址已被某則 X 貼文涵蓋（貼文唯一連到這篇）：收件記到那篇，不另建一篇、不重新生成。
    if (new URL(url).hostname !== 'x.com' && !(await item(env, id))) {
      const linked = await linkedPostFor(env, url);
      if (linked) id = linked.id;
    }
    await query(
      env,
      `INSERT OR IGNORE INTO learning_items(id,url,kind,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
      id,
      url,
      new URL(url).hostname === 'x.com' ? 'x' : 'web',
      options.defer ? 'awaiting_backfill' : 'queued',
      time,
      time,
    ).run();
    // 已清除或在最近刪除的文章：書籤同步與官方來源不再收件；主動分享與網站加入照常收件，回到待決定。
    const before = await item(env, id),
      manual = ['share', 'web'].includes(origin);
    if ((before.status === 'dismissed' || before.triage === 'deleted') && !manual) return id;
    if (manual && before.triage === 'deleted') await reviveFromDeleted(env, id);
    await query(
      env,
      'INSERT OR IGNORE INTO learning_intakes(receipt,item_id,origin,metadata_json,created_at) VALUES(?,?,?,?,?)',
      receipt || crypto.randomUUID(),
      id,
      origin,
      JSON.stringify(options.metadata || {}),
      time,
    ).run();
    // 主動分享不受官方主題篩選：先前被官方篩掉的同一篇也要完整整理。
    if (['share', 'web'].includes(origin))
      await query(
        env,
        "UPDATE learning_items SET status='queued',updated_at=? WHERE id=? AND status IN ('awaiting_backfill','dismissed','filtered')",
        time,
        id,
      ).run();
    if (options.metadata?.title)
      await query(env, "UPDATE learning_items SET title=? WHERE id=? AND title=''", options.metadata.title, id).run();
    if (options.source) {
      const key = await saveEvidence(env, id, options.source);
      await registerMedia(env, id, key, options.source.media);
      await saveArticle(env, id, options.source);
    }
    const current = await item(env, id);
    if (!options.defer && ['queued', 'error'].includes(current.status)) await enqueue(env, id);
    // 等待確認回補的書籤一收進來就可以閱讀，待決定期限從這時起算。
    if (current.status === 'awaiting_backfill') await startTriageClock(env, id);
    return id;
  }
  async function process(env, id) {
    const row = await item(env, id);
    if (
      !row ||
      [
        'awaiting_backfill',
        'needs_attention',
        'budget_paused',
        'paused',
        'dismissed',
        'merged',
        'waiting_local',
        'generating',
      ].includes(row.status)
    )
      return { waiting: true };
    if (['ready', 'partial', 'filtered'].includes(row.status)) return { done: true };
    const lease = await lock(env, id);
    if (!lease) return { pending: true };
    try {
      // 手動暫停會停下全部處理；費用暫停只擋付費呼叫，已取得證據的本機工作仍可繼續。
      if (await manuallyPaused(env)) {
        await query(env, "UPDATE learning_items SET status='paused',updated_at=? WHERE id=?", nowIso(), id).run();
        return { waiting: true };
      }
      await query(
        env,
        "UPDATE learning_items SET status='processing',stage='source',updated_at=? WHERE id=?",
        nowIso(),
        id,
      ).run();
      const acquisition = await acquireEvidence(env, row, deps);
      if (acquisition.pending) {
        await query(
          env,
          "UPDATE learning_items SET status='queued',next_attempt_at=? WHERE id=?",
          new Date(now() + 60000).toISOString(),
          id,
        ).run();
        return { pending: true };
      }
      // X 貼文唯一連到的文章已在文章庫：併進那篇，不另外整理。
      if (row.kind === 'x') {
        const merged = await mergeIntoLinkedArticle(env, row);
        if (merged) {
          if (merged.rewrite) await enqueue(env, merged.id);
          else await flush(env).catch(() => {});
          return { done: true, merged: merged.id };
        }
      }
      // 官方文章抓到原文才確定發表時間：太舊的記為篩掉，不呼叫模型、不通知。
      const primary =
        row.kind === 'x' ? null : acquisition.sources.find((s) => s.relation === 'primary' && s.status === 'available');
      const stale = primary ? await staleOfficialReason(env, row, primary.published_at) : null;
      if (stale) {
        await query(
          env,
          "UPDATE learning_items SET status='filtered',stage=NULL,title=COALESCE(NULLIF(title,''),?),article_json=?,attempts=0,last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE id=?",
          JSON.parse(primary.metadata_json || '{}').title || row.url,
          JSON.stringify({ publish: false, reason: stale }),
          nowIso(),
          id,
        ).run();
        await markEntryStale(env, id, stale);
        return { done: true };
      }
      await query(env, "UPDATE learning_items SET stage='media' WHERE id=?", id).run();
      // 本機文字路徑：Flash 只解析媒體並保存證據，寫作交給 Mac；純文字來源完全不呼叫 Flash。
      if ((await textProvider(env)) === 'local') {
        const evidence = await mediaEvidence(env, id, { ...deps, fetcher });
        if (evidence.pending) {
          await query(
            env,
            "UPDATE learning_items SET status='queued',next_attempt_at=? WHERE id=?",
            new Date(now() + 60000).toISOString(),
            id,
          ).run();
          return { pending: true };
        }
        return await queueLocal(env, row, acquisition, evidence);
      }
      const media = await (deps.prepareMedia || prepareMedia)(env, id, fetcher);
      if (media.pending) {
        await query(
          env,
          "UPDATE learning_items SET status='queued',next_attempt_at=? WHERE id=?",
          new Date(now() + 60000).toISOString(),
          id,
        ).run();
        return { pending: true };
      }
      const sources = acquisition.sources.filter((s) => s.status === 'available' && s.content);
      const gaps = [
        ...acquisition.sources
          .filter((s) => s.status !== 'available')
          .map((s) => ({ url: s.url, error: JSON.parse(s.metadata_json).error || '來源不可取得' })),
        ...media.gaps,
      ];
      const official = await officialContext(env, row);
      const fingerprint = await hash(
        JSON.stringify({
          sources: sources.map((s) => ({
            id: s.id,
            content: s.content,
            relation: s.relation,
            author_id: s.author_id,
            published_at: s.published_at,
            metadata_json: s.metadata_json,
          })),
          media: media.media.map((m) => m.id),
          gaps,
          official,
          model: env.LEARNING_MODEL || 'gemini-3.8-flash',
          prompt_version: 'learning-v2',
        }),
      );
      await query(env, "UPDATE learning_items SET stage='text' WHERE id=?", id).run();
      const old = row.article_json ? JSON.parse(row.article_json) : null;
      const article =
        old?.input_fingerprint === fingerprint
          ? old
          : await (deps.generate || generate)(env, sources, media.media, gaps, null, fetcher, { official });
      // 官方文章不符合讀者關注：保存判斷，不生成正文、不通知。
      if (article.publish === false) {
        await query(
          env,
          "UPDATE learning_items SET status='filtered',stage=NULL,title=?,article_json=?,attempts=0,last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE id=?",
          article.title || row.title,
          JSON.stringify({
            provider: 'gemini',
            model: env.LEARNING_MODEL || 'gemini-3.8-flash',
            publish: false,
            reason: article.reason,
            input_fingerprint: fingerprint,
          }),
          nowIso(),
          id,
        ).run();
        return { done: true };
      }
      const revision = old?.input_fingerprint === fingerprint ? row.revision : row.revision + 1;
      article.input_fingerprint = fingerprint;
      article.content_fingerprint = await contentFingerprint(
        sources,
        gaps,
        media.media.map((m) => m.id),
      );
      article.provider = env.LEARNING_DEMO === 'true' ? 'demo' : 'gemini';
      article.model = env.LEARNING_MODEL || 'gemini-3.8-flash';
      article.prompt_version = 'learning-v2';
      if (!article.generated_at) article.generated_at = nowIso();
      if (revision !== row.revision) await saveVersion(env, row, 'superseded');
      await query(
        env,
        `UPDATE learning_items SET title=?,body=?,article_json=?,gaps_json=?,status=?,revision=?,edition='detailed',stage=NULL,attempts=0,last_error=NULL,next_attempt_at=NULL,updated_at=?,recheck_at=COALESCE(recheck_at,?) WHERE id=?`,
        article.title,
        article.body,
        JSON.stringify(article),
        JSON.stringify(gaps),
        gaps.length ? 'partial' : 'ready',
        revision,
        nowIso(),
        row.kind === 'x' ? new Date(now() + 86400000).toISOString() : null,
        id,
      ).run();
      await classify(env, id);
      return { done: true };
    } catch (error) {
      const paused = error.name === 'BudgetPaused',
        attempts = paused ? row.attempts : row.attempts + 1;
      await query(
        env,
        'UPDATE learning_items SET status=?,attempts=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?',
        paused ? 'budget_paused' : attempts >= 3 ? 'needs_attention' : 'error',
        attempts,
        error.message,
        new Date(now() + Math.min(3600, 60 * 2 ** attempts) * 1000).toISOString(),
        nowIso(),
        id,
      ).run();
      if (paused) return { waiting: true };
      throw error;
    } finally {
      await unlock(env, id, lease);
    }
  }
  async function queueLocal(env, row, acquisition, media = { evidence: [], gaps: [] }) {
    const sources = acquisition.sources.filter((s) => s.status === 'available' && s.content);
    const gaps = [
      ...acquisition.sources
        .filter((s) => s.status !== 'available')
        .map((s) => ({ url: s.url, error: JSON.parse(s.metadata_json).error || '來源不可取得' })),
      ...media.gaps,
    ];
    const refs = new Map(sources.map((s, i) => [s.id, `S${i + 1}`]));
    const evidence = media.evidence.map((m, i) => ({
      ref: `M${i + 1}`,
      id: m.analysis_id,
      media_id: m.media_id,
      source_ref: refs.get(m.source_id) || null,
      type: m.type,
      duration_seconds: m.duration_seconds,
      expired: m.expired,
      ocr: m.ocr,
      speech: m.speech,
      visual: m.visual,
      unrecognized: m.unrecognized,
      coverage: m.coverage,
    }));
    const observations = media.evidence.flatMap((m) =>
      m.visual.map((v) => ({
        source_id: m.source_id,
        media_id: m.media_id,
        timestamp: v.timestamp,
        description: v.observation,
        kind: v.kind,
      })),
    );
    const official = await officialContext(env, row);
    const { input, fingerprint } = await articleInput(env, row, sources, gaps, {
      media: evidence,
      observations,
      ...(official ? { official } : {}),
    });
    const old = row.article_json ? JSON.parse(row.article_json) : null;
    if (old?.input_fingerprint === fingerprint) {
      await query(
        env,
        'UPDATE learning_items SET status=?,stage=NULL,attempts=0,last_error=NULL,updated_at=? WHERE id=?',
        gaps.length ? 'partial' : 'ready',
        nowIso(),
        row.id,
      ).run();
      return { done: true };
    }
    await ensureJob(env, {
      kind: 'article',
      itemId: row.id,
      priority: await itemPriority(env, row.id),
      input,
      fingerprint,
    });
    await query(
      env,
      "UPDATE learning_items SET status='waiting_local',stage='text',attempts=0,next_attempt_at=NULL,updated_at=? WHERE id=?",
      nowIso(),
      row.id,
    ).run();
    return { waiting: true };
  }
  async function sync(env, scope = 'full') {
    return syncBookmarks(env, { ...deps, collect }, scope);
  }
  async function backfill(env) {
    const state = await setting(env, 'sync');
    state.backfill_approved = true;
    await setSetting(env, 'sync', state);
    await query(env, "UPDATE learning_items SET status='queued' WHERE status='awaiting_backfill'").run();
    await recover(env);
    return state;
  }
  async function recover(env) {
    if (await manuallyPaused(env)) return;
    for (const row of await rows(
      env,
      "SELECT id FROM learning_items WHERE status IN ('queued','error','processing') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (lease_until IS NULL OR lease_until<?) LIMIT 100",
      nowIso(),
      nowIso(),
    ))
      await enqueue(env, row.id);
  }
  async function send(env, text, extra = {}) {
    if (deps.sendTelegram) return deps.sendTelegram(env, text, extra);
    if (!env.TELEGRAM_CHAT_ID) throw new Error('Telegram 通知設定未完成');
    const result = await telegram(env, 'sendMessage', {
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      link_preview_options: { is_disabled: true },
      ...extra,
    });
    if (!result.ok || !result.result?.message_id) throw new Error('Telegram 通知未確認成功');
    return result.result.message_id;
  }
  async function telegram(env, method, body) {
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram 通知設定未完成');
    return apiJson(
      await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(body),
      }),
      64000,
    );
  }
  // 通知上的篩選按鈕：套用到文章庫，回覆短提示並改按鈕。Bot API 失敗時不影響已套用的結果。
  async function triageCallback(env, callback) {
    return handleTriageCallback(
      env,
      callback,
      (method, body) =>
        telegram(env, method, body).catch((error) => {
          console.log(JSON.stringify({ event: 'telegram_callback_reply_failed', method, error: error.message }));
        }),
      { enqueue },
    );
  }
  async function receipt(env, chatId, ids, key) {
    if (!ids.length) return;
    const id = await hash(`receipt:${key}`);
    await query(
      env,
      "INSERT OR IGNORE INTO learning_deliveries(id,item_ids_json,origin,body,chat_id,created_at) VALUES(?,?,'receipt',?,?,?)",
      id,
      JSON.stringify(ids),
      await receiptMessage(env, ids),
      String(chatId),
      nowIso(),
    ).run();
    await flushReceipts(env);
  }
  async function flushReceipts(env) {
    for (const d of await rows(env, "SELECT * FROM learning_deliveries WHERE origin='receipt' AND status='pending'")) {
      const lease = new Date(now() + 60000).toISOString();
      const acquired = await query(
        env,
        'UPDATE learning_deliveries SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?)',
        lease,
        d.id,
        nowIso(),
      ).run();
      if (!acquired.meta.changes) continue;
      try {
        const messageId = await send({ ...env, TELEGRAM_CHAT_ID: d.chat_id }, d.body);
        await query(env, "UPDATE learning_deliveries SET status='sent',message_id=? WHERE id=?", messageId, d.id).run();
      } finally {
        await query(
          env,
          'UPDATE learning_deliveries SET lease_until=NULL WHERE id=? AND lease_until=?',
          d.id,
          lease,
        ).run();
      }
    }
  }
  // 舊參數 origin 只為相容保留；所有入口都在文章完成後逐篇通知。
  async function flush(env) {
    await queueArticleNotifications(env);
    await sendPending(env, send);
  }
  // 文章完成後先分類再通知；分類失敗不擋通知，由維護排程依延後時間重試。
  async function classify(env, id) {
    await startTriageClock(env, id);
    try {
      return await classifyCompleted(env, id, deps);
    } catch (error) {
      console.log(JSON.stringify({ event: 'topic_classification_failed', error: String(error.message).slice(0, 200) }));
      return false;
    }
  }
  async function ask(env, question, articleId = null, options = {}) {
    return askQuestion(env, question, articleId, { ...deps, fetcher }, options);
  }
  async function official(env) {
    return discoverOfficial(env, collect, deps);
  }
  // 批改完成後的後續步驟（網路查證、建立複習），本機批改由 Mac 回報後也走這裡。
  async function graded(env, attemptId) {}
  const quizDeps = () => ({ fetcher, hooks: { graded } });
  async function quiz(env, itemId, options = {}) {
    return createQuiz(env, itemId, options, quizDeps());
  }
  async function attempt(env, quizId, data, options = {}) {
    return submitAttempt(env, quizId, data, quizDeps(), options);
  }
  // options 可為舊版 boolean（true 代表日次書籤工作）或 {tasks}。
  async function scheduled(env, options = false) {
    const tasks = Array.isArray(options?.tasks)
      ? options.tasks
      : options === true
        ? ['bookmark_daily', 'author_recheck']
        : [];
    const bookmarks = await bookmarksEnabled(env),
      daily = bookmarks && tasks.includes('bookmark_daily');
    if (tasks.includes('official'))
      try {
        await official(env);
      } catch (error) {
        console.log(JSON.stringify({ event: 'official_discovery_failed', error: error.message }));
      }
    if (daily) {
      if (
        env.LEARNING_JOBS &&
        env.X_CLIENT_ID &&
        env.X_CLIENT_SECRET &&
        (await connection(env, 'x')) &&
        !(await setting(env, 'sync')).requires_action
      ) {
        await startFullScan(env);
        await env.LEARNING_JOBS.send({ kind: 'sync', scope: 'full' });
      }
    }
    if (bookmarks && tasks.includes('bookmark_partial')) {
      if (
        env.LEARNING_JOBS &&
        env.X_CLIENT_ID &&
        env.X_CLIENT_SECRET &&
        (await connection(env, 'x')) &&
        !(await setting(env, 'sync')).requires_action &&
        !(await budget(env)).paused
      )
        await env.LEARNING_JOBS.send({ kind: 'sync', scope: 'partial' });
    }
    // 作者補充二十四小時後重查一次；來源沒變時沿用既有結果，不重新生成。
    if (tasks.includes('author_recheck') && (await authorRecheckEnabled(env)))
      for (const row of await rows(
        env,
        "SELECT id FROM learning_items WHERE kind='x' AND recheck_at<=? AND rechecked=0 AND status IN ('ready','partial') LIMIT 100",
        nowIso(),
      )) {
        await resetIncomplete(env, row.id, true);
        await query(env, "UPDATE learning_items SET status='queued' WHERE id=?", row.id).run();
      }
    // 主題分類用 Workers AI，不經過 Mac、不記入預算；新文章與既有文章回補共用這一步。
    if (tasks.includes('maintenance'))
      try {
        await classifyPending(env, deps);
      } catch (error) {
        console.log(JSON.stringify({ event: 'topic_classification_failed', error: error.message }));
      }
    if (tasks.includes('maintenance'))
      try {
        await pruneSourceRecords(env);
      } catch (error) {
        console.log(JSON.stringify({ event: 'source_prune_failed', error: error.message }));
      }
    // 篩選：補上待決定期限的起算點、逾期移到最近刪除、清除刪除超過 7 天的文章。每一步都有篇數上限。
    if (tasks.includes('maintenance'))
      try {
        await startTriageClock(env);
        await expirePending(env);
        await purgeDeleted(env);
      } catch (error) {
        console.log(JSON.stringify({ event: 'triage_maintenance_failed', error: error.message }));
      }
    // RAG 索引：保留文章建立或更新索引，非保留文章移出。每輪最多建立 3 篇。
    if (tasks.includes('maintenance'))
      try {
        await maintainIndex(env);
      } catch (error) {
        console.log(JSON.stringify({ event: 'rag_maintenance_failed', error: error.message }));
      }
    await recover(env);
    const syncState = await setting(env, 'sync');
    if (bookmarks && syncState.running && env.LEARNING_JOBS && !(await budget(env)).paused)
      await env.LEARNING_JOBS.send({ kind: 'sync' });
    await expireMedia(env);
    await query(env, 'DELETE FROM learning_sessions WHERE expires_at<?', nowIso()).run();
    await flushReceipts(env);
    await flush(env);
  }
  async function queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const result =
          message.body.kind === 'sync'
            ? await sync(env, message.body.scope === 'partial' ? 'partial' : 'full')
            : await process(env, message.body.id);
        await flush(env);
        if (result.pending || result.running) message.retry({ delaySeconds: 60 });
        else message.ack();
      } catch (error) {
        if (error.name === 'BudgetPaused') message.ack();
        else message.retry({ delaySeconds: 300 });
        // 附上狀態碼、錯誤類型、出錯階段與訊息前段，正式環境才查得出原因。
        const { at, ...detail } = failureDetail(
          error,
          error.stage || (message.body.kind === 'sync' ? 'sync' : 'process'),
        );
        console.log(
          JSON.stringify({
            event: 'learning_task_failed',
            kind: message.body.kind,
            scope: message.body.scope,
            error: error.name === 'BudgetPaused' ? 'budget_paused' : 'processing_failed',
            ...detail,
          }),
        );
      }
    }
  }
  // 每個對外入口都在注入的時鐘下執行；沒有注入時用系統時間。
  const api = {
    collect,
    process,
    sync,
    backfill,
    recover,
    flush,
    classify,
    ask,
    scheduled,
    queue,
    enqueue,
    receipt,
    official,
    graded,
    triageCallback,
    quiz,
    attempt,
    migrate: migrateLibrary,
  };
  for (const [name, fn] of Object.entries(api)) api[name] = (...args) => withClock(deps.now, () => fn(...args));
  return {
    ...api,
    localHooks: {
      completeQuestion,
      completeQuiz,
      completeGrade: (env, job, input, data) => completeGrade(env, job, input, data, { graded: api.graded }),
    },
  };
}

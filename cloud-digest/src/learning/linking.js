import { query, rows, nowIso, hash, setting } from './store.js';
import { canonicalUrl } from './network.js';
import { libraryUrl, mergeItems } from './library.js';
import { articleMessage } from './notifications.js';

const MEDIA_FILE = /\.(jpe?g|png|gif|webp|avif|svg|mp4|mov|webm|m3u8)$/i;

// X 貼文只連到一篇外部文章時，回傳那篇的正式網址；連到多篇（整理型貼文）或沒有外連時回傳 null。
export async function linkedArticleUrl(env, links = []) {
  const urls = new Set();
  for (const link of links) {
    try {
      const url = canonicalUrl(link),
        host = new URL(url).hostname;
      if (/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host) || MEDIA_FILE.test(new URL(url).pathname)) continue;
      urls.add(await libraryUrl(env, url));
    } catch {}
  }
  return urls.size === 1 ? [...urls][0] : null;
}

// 文章網址已被某則 X 貼文涵蓋時，回傳那篇 X 文章；新收件改記到它身上，不另建一篇。
export async function linkedPostFor(env, url) {
  return query(
    env,
    "SELECT id FROM learning_items WHERE linked_url=? AND kind='x' AND status NOT IN ('merged','dismissed') ORDER BY created_at LIMIT 1",
    url,
  ).first();
}

// X 貼文取得來源後：記下唯一外連；若那篇文章已在文章庫，把貼文併進去並回傳保留的文章。
export async function mergeIntoLinkedArticle(env, row) {
  const primary = (
    await rows(
      env,
      "SELECT metadata_json FROM learning_evidence WHERE item_id=? AND relation='primary' AND status='available' LIMIT 1",
      row.id,
    )
  )[0];
  if (!primary) return null;
  const linked = await linkedArticleUrl(env, JSON.parse(primary.metadata_json || '{}').links || []);
  // 空字串代表已檢查過、沒有唯一外連，維護排程不再重算。
  await query(env, 'UPDATE learning_items SET linked_url=? WHERE id=?', linked || '', row.id).run();
  if (!linked) return null;
  const target = await query(
    env,
    "SELECT * FROM learning_items WHERE url=? AND id!=? AND status NOT IN ('merged','dismissed') LIMIT 1",
    linked,
    row.id,
  ).first();
  if (!target) return null;
  // 外部全文：保留的文章已有可用主文就丟掉重複的一份，沒有則直接當作它的主文，省一次擷取。
  const targetPrimary = await query(
    env,
    "SELECT id FROM learning_evidence WHERE item_id=? AND relation='primary' AND status='available' LIMIT 1",
    target.id,
  ).first();
  if (targetPrimary)
    await query(
      env,
      "DELETE FROM learning_evidence WHERE item_id=? AND relation='external' AND url=?",
      row.id,
      linked,
    ).run();
  else
    await query(
      env,
      "UPDATE OR IGNORE learning_evidence SET relation='primary' WHERE item_id=? AND relation='external' AND url=? AND status='available'",
      row.id,
      linked,
    ).run();
  await env.DB.batch([
    // 保留的文章以外部全文為主要來源；貼文改標為分享的 X 貼文。
    query(
      env,
      "UPDATE OR IGNORE learning_evidence SET relation='shared_post' WHERE item_id=? AND relation='primary' AND url=?",
      row.id,
      row.url,
    ),
    query(env, 'UPDATE OR IGNORE learning_evidence SET item_id=? WHERE item_id=?', target.id, row.id),
    query(env, 'DELETE FROM learning_evidence WHERE item_id=?', row.id),
    query(env, 'UPDATE learning_media SET item_id=? WHERE item_id=?', target.id, row.id),
    query(env, 'UPDATE learning_media_analyses SET item_id=? WHERE item_id=?', target.id, row.id),
    query(env, "UPDATE learning_jobs SET item_id=? WHERE item_id=? AND kind='fetch_x_article'", target.id, row.id),
    query(env, 'DELETE FROM settings WHERE key=?', `learning:context:${row.id}`),
  ]);
  await mergeItems(env, row.id, target.id);
  const kept = await query(env, 'SELECT * FROM learning_items WHERE id=?', target.id).first();
  // 既有版本是舊短導讀或尚無正文：用目前文字模型重寫，完成後依版本發更新通知。
  if (kept.edition === 'legacy_digest' || !kept.body) {
    if (['ready', 'partial', 'needs_attention', 'error'].includes(kept.status))
      await query(
        env,
        "UPDATE learning_items SET status='queued',attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?",
        nowIso(),
        kept.id,
      ).run();
    return { id: kept.id, rewrite: true };
  }
  // 已是詳細版：不重寫，只告知分享已併入既有文章。
  await query(
    env,
    'INSERT OR IGNORE INTO learning_deliveries(id,item_ids_json,origin,body,created_at) VALUES(?,?,?,?,?)',
    await hash(`merged:${row.id}:${kept.id}`),
    JSON.stringify([{ id: kept.id, revision: kept.revision }]),
    'merged',
    articleMessage(env, kept, 'merged'),
    nowIso(),
  ).run();
  return { id: kept.id, rewrite: false };
}

// 一次性整理既有重複：已整理的 X 文章與它唯一外連的文章合併，保留 X 那篇（含貼文與外部全文）。
// 只寫資料庫：不呼叫模型、不讀外部來源、不發通知；已檢查過的文章不再處理，可重複執行。
export async function mergeExistingDuplicates(env) {
  let checked = 0,
    merged = 0;
  for (const row of await rows(
    env,
    "SELECT * FROM learning_items WHERE kind='x' AND linked_url IS NULL AND status IN ('ready','partial') ORDER BY created_at LIMIT 100",
  )) {
    checked++;
    const primary = (
      await rows(
        env,
        "SELECT metadata_json FROM learning_evidence WHERE item_id=? AND relation='primary' AND status='available' LIMIT 1",
        row.id,
      )
    )[0];
    const linked = primary ? await linkedArticleUrl(env, JSON.parse(primary.metadata_json || '{}').links || []) : null;
    await query(env, 'UPDATE learning_items SET linked_url=? WHERE id=?', linked || '', row.id).run();
    if (!linked || !row.body) continue;
    const target = await query(
      env,
      "SELECT id FROM learning_items WHERE url=? AND id!=? AND status NOT IN ('merged','dismissed') LIMIT 1",
      linked,
      row.id,
    ).first();
    if (!target) continue;
    await mergeItems(env, target.id, row.id);
    // 併進來的收件紀錄不能讓 X 文章之後的更新被誤判為已通知。
    await query(
      env,
      'UPDATE learning_intakes SET notify_revision=MIN(notify_revision,?) WHERE item_id=?',
      row.revision,
      row.id,
    ).run();
    merged++;
  }
  return { checked, merged };
}

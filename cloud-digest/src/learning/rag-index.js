import { query, rows, nowIso } from './store.js';
import { now } from './clock.js';

// 保留文章的 RAG 索引：Workers AI EmbeddingGemma 產生向量，存進 Vectorize（binding LIBRARY_INDEX）；片段位置記在 D1 learning_chunks。
// 查核日 2026-10-19（Cloudflare 模型目錄 workers-ai-models/embeddinggemma-300m.json 與 Vectorize limits 文件）：
// - 輸入 { text: string | string[] }，陣列最多 100 筆；輸出 { shape, data: number[][] }，每筆 768 維。
// - 模型以 Matryoshka 方式訓練，取前 512 維再做 L2 正規化，配合 512 維、cosine 的 Vectorize 索引。
// - Vectorize：upsert 每批最多 1000 筆、向量 ID 最長 64 bytes、不回傳 metadata 時 topK 最多 100。
// - 文件端 `title: <標題> | text: <片段>`、查詢端 `task: search result | query: <問題>` 依 Google 的 EmbeddingGemma 模型卡；
//   這次環境連不到模型卡，前綴沿用規格記載，待真實環境驗收時一併確認。
export const EMBEDDING_MODEL = '@cf/google/embeddinggemma-300m';
export const DIMENSIONS = 512;
export const FREE_STORED_DIMENSIONS = 5000000;
const EMBED_BATCH = 100,
  UPSERT_BATCH = 1000,
  DELETE_BATCH = 1000,
  BUILD_LIMIT = 3,
  REMOVE_LIMIT = 10,
  MAX_ATTEMPTS = 5;
// 片段長度（字元）：教材正文約 600–1,000 字；原始來源約 1,000–1,500 字；媒體解析每則一段，過長時依段落再切。
const SIZES = { body: [600, 1000], source: [1000, 1500], media: [600, 1500] };

export const documentText = (title, text) => `title: ${(title || 'none').replace(/\s+/g, ' ').trim()} | text: ${text}`;
export const queryText = (text) => `task: search result | query: ${text}`;

// 取前 512 維並 L2 正規化；長度不足或全為 0 時視為模型回應錯誤。
function truncate(vector) {
  if (!Array.isArray(vector) || vector.length < DIMENSIONS || vector.some((n) => !Number.isFinite(n)))
    throw new Error('Embedding 維度不符');
  const head = vector.slice(0, DIMENSIONS),
    norm = Math.sqrt(head.reduce((sum, n) => sum + n * n, 0));
  if (!norm) throw new Error('Embedding 向量為 0');
  return head.map((n) => n / norm);
}
export async function embed(env, texts) {
  if (!env.AI) throw new Error('Workers AI binding missing');
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const response = await env.AI.run(EMBEDDING_MODEL, { text: batch });
    if (!Array.isArray(response?.data) || response.data.length !== batch.length)
      throw new Error('Embedding 回應數量不符');
    for (const vector of response.data) out.push(truncate(vector));
  }
  return out;
}

// 依段落（空行）切成 [start, length]；遇到 Markdown 標題且目前片段已達最小長度時換段；單段過長時在句尾切開。
export function chunkRanges(text, [min, max]) {
  const blocks = [],
    separator = /\n{2,}/g;
  let last = 0,
    match;
  while ((match = separator.exec(text))) {
    blocks.push([last, match.index]);
    last = match.index + match[0].length;
  }
  blocks.push([last, text.length]);
  const ranges = [];
  let start = null,
    end = null;
  const flush = () => {
    if (start !== null && text.slice(start, end).trim()) ranges.push([start, end]);
    start = end = null;
  };
  for (const [s, e] of blocks) {
    if (e <= s || !text.slice(s, e).trim()) continue;
    const heading = /^#{1,6}\s/.test(text.slice(s, s + 8));
    if (start !== null && ((heading && end - start >= min) || e - start > max)) flush();
    if (e - s > max) {
      flush();
      let from = s;
      while (e - from > max) {
        const window = text.slice(from + min, from + max),
          cut = Math.max(...['。', '！', '？', '. ', '! ', '? ', '\n'].map((m) => window.lastIndexOf(m)));
        const to = cut >= 0 ? from + min + cut + 1 : from + max;
        ranges.push([from, to]);
        from = to;
      }
      start = from;
      end = e;
      continue;
    }
    if (start === null) start = s;
    end = e;
  }
  flush();
  // 結尾過短的片段併回前一段。
  const tail = ranges.at(-1),
    before = ranges.at(-2);
  if (tail && before && tail[1] - tail[0] < min / 3 && tail[1] - before[0] <= max + min / 3) {
    ranges.pop();
    ranges[ranges.length - 1] = [before[0], tail[1]];
  }
  return ranges.map(([s, e]) => ({ start: s, length: e - s }));
}

// 媒體解析的文字：畫面摘要、畫面文字、語音與畫面觀察，依固定格式組成，檢索時用同一個函式重組後取片段。
export function mediaText(analysis) {
  const a = analysis || {};
  return [
    a.coverage?.summary || '',
    a.ocr?.text ? '畫面文字：' + a.ocr.text : '',
    ...(a.speech?.segments || []).map((s) => `${s.start || ''} ${s.text || ''}`.trim()),
    ...(a.visual || []).map((v) =>
      `${v.timestamp || ''} ${v.kind === 'inferred' ? '推論：' : ''}${v.observation || ''}`.trim(),
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}

// 一篇保留文章的全部片段：教材正文、可用的主要與外部來源、媒體解析。筆記、追問與作答紀錄不收錄。
export async function itemChunks(env, row) {
  const chunks = [];
  if (row.body)
    for (const r of chunkRanges(row.body, SIZES.body))
      chunks.push({ kind: 'body', ref_id: null, ...r, text: row.body.substr(r.start, r.length) });
  for (const source of await rows(
    env,
    "SELECT id,content FROM learning_evidence WHERE item_id=? AND relation IN ('primary','external') AND status='available' AND content!='' ORDER BY fetched_at,id",
    row.id,
  ))
    for (const r of chunkRanges(source.content, SIZES.source))
      chunks.push({ kind: 'source', ref_id: source.id, ...r, text: source.content.substr(r.start, r.length) });
  for (const analysis of await rows(
    env,
    'SELECT id,analysis_json FROM learning_media_analyses WHERE item_id=? ORDER BY created_at,id',
    row.id,
  )) {
    const text = mediaText(JSON.parse(analysis.analysis_json || '{}'));
    for (const r of chunkRanges(text, SIZES.media))
      chunks.push({ kind: 'media', ref_id: analysis.id, ...r, text: text.substr(r.start, r.length) });
  }
  return chunks;
}

// 建立或更新一篇的索引：先寫新向量，再刪掉這篇不再使用的舊向量。
async function indexItem(env, row) {
  const chunks = await itemChunks(env, row);
  const ids = chunks.map((_, n) => `${row.id}:${row.revision}:${n}`);
  const vectors = chunks.length
    ? await embed(
        env,
        chunks.map((c) => documentText(row.title, c.text)),
      )
    : [];
  for (let i = 0; i < ids.length; i += UPSERT_BATCH)
    await env.LIBRARY_INDEX.upsert(ids.slice(i, i + UPSERT_BATCH).map((id, n) => ({ id, values: vectors[i + n] })));
  const fresh = new Set(ids),
    stale = (await rows(env, 'SELECT id FROM learning_chunks WHERE item_id=?', row.id))
      .map((r) => r.id)
      .filter((id) => !fresh.has(id));
  const time = nowIso();
  await env.DB.batch([
    ...chunks.map((c, n) =>
      query(
        env,
        'INSERT OR REPLACE INTO learning_chunks(id,item_id,revision,kind,ref_id,start,length,created_at) VALUES(?,?,?,?,?,?,?,?)',
        ids[n],
        row.id,
        row.revision,
        c.kind,
        c.ref_id,
        c.start,
        c.length,
        time,
      ),
    ),
    query(
      env,
      'UPDATE learning_items SET index_revision=?,indexed=1,index_attempts=0,index_attempt_revision=NULL,index_next_at=NULL,index_error=NULL WHERE id=? AND revision=?',
      row.revision,
      row.id,
      row.revision,
    ),
  ]);
  await removeVectors(env, stale);
  return chunks.length;
}

async function removeVectors(env, ids) {
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH);
    await env.LIBRARY_INDEX.deleteByIds(batch);
    for (let j = 0; j < batch.length; j += 90) {
      const part = batch.slice(j, j + 90);
      await query(env, `DELETE FROM learning_chunks WHERE id IN (${part.map(() => '?').join(',')})`, ...part).run();
    }
  }
}

// 移出索引：取消保留、刪除或清除的文章不再出現在檢索結果。
async function unindexItem(env, id) {
  await removeVectors(
    env,
    (await rows(env, 'SELECT id FROM learning_chunks WHERE item_id=?', id)).map((r) => r.id),
  );
  await query(env, "UPDATE learning_items SET indexed=0,index_revision=NULL WHERE id=? AND triage!='kept'", id).run();
}

// 維護排程：先移出非保留文章，再建立或更新最多 3 篇。失敗累計次數並延後重試，連續 5 次後停止，
// 直到 revision 改變或手動重建。沒有設定 Vectorize 或 Workers AI 時整步略過。
export async function maintainIndex(env, limit = BUILD_LIMIT) {
  if (!env.LIBRARY_INDEX || !env.AI) return { skipped: true };
  const result = { removed: 0, indexed: 0, failed: 0 };
  for (const { id } of await rows(
    env,
    "SELECT id FROM learning_items WHERE indexed=1 AND triage!='kept' LIMIT ?",
    REMOVE_LIMIT,
  ))
    try {
      await unindexItem(env, id);
      result.removed++;
    } catch (error) {
      console.log(JSON.stringify({ event: 'rag_unindex_failed', error: String(error.message).slice(0, 200) }));
    }
  const candidates = await rows(
    env,
    `SELECT id,title,body,revision,index_attempts,index_attempt_revision FROM learning_items
    WHERE triage='kept' AND status IN ('ready','partial') AND (index_revision IS NULL OR index_revision!=revision)
    AND (index_attempt_revision IS NOT revision OR (index_attempts<? AND (index_next_at IS NULL OR index_next_at<=?)))
    ORDER BY kept_at LIMIT ?`,
    MAX_ATTEMPTS,
    nowIso(),
    limit,
  );
  for (const row of candidates)
    try {
      await indexItem(env, row);
      result.indexed++;
    } catch (error) {
      const attempts = row.index_attempt_revision === row.revision ? row.index_attempts + 1 : 1;
      await query(
        env,
        'UPDATE learning_items SET index_attempts=?,index_attempt_revision=?,index_next_at=?,index_error=? WHERE id=?',
        attempts,
        row.revision,
        attempts >= MAX_ATTEMPTS ? null : new Date(now() + 5 * 60000 * 2 ** attempts).toISOString(),
        String(error.message || '索引失敗').slice(0, 300),
        row.id,
      ).run();
      result.failed++;
    }
  return result;
}

// 重建索引：所有保留文章重新排入，舊向量在各自重建時取代。
export async function rebuildIndex(env) {
  const result = await query(
    env,
    "UPDATE learning_items SET index_revision=NULL,index_attempts=0,index_attempt_revision=NULL,index_next_at=NULL,index_error=NULL WHERE triage='kept'",
  ).run();
  return { queued: result.meta.changes };
}

// 管理頁「RAG 索引」：保留篇數、已索引、等待中、失敗、片段數與估計儲存維度占 Free 額度的比例。
export async function indexStatus(env) {
  const counts = await query(
    env,
    `SELECT COUNT(*) AS kept,
      SUM(CASE WHEN index_revision=revision THEN 1 ELSE 0 END) AS indexed,
      SUM(CASE WHEN status IN ('ready','partial') AND index_revision IS NOT revision AND NOT (index_attempt_revision IS revision AND index_attempts>=?) THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN index_revision IS NOT revision AND index_attempt_revision IS revision AND index_attempts>=? THEN 1 ELSE 0 END) AS failed
    FROM learning_items WHERE triage='kept'`,
    MAX_ATTEMPTS,
    MAX_ATTEMPTS,
  ).first();
  const chunks = (await query(env, 'SELECT COUNT(*) AS count FROM learning_chunks').first()).count;
  const errors = await rows(
    env,
    "SELECT id,title,index_error,index_attempts FROM learning_items WHERE triage='kept' AND index_error IS NOT NULL AND index_revision IS NOT revision LIMIT 5",
  );
  return {
    configured: !!env.LIBRARY_INDEX && !!env.AI,
    model: EMBEDDING_MODEL,
    dimensions: DIMENSIONS,
    kept: counts.kept || 0,
    indexed: counts.indexed || 0,
    waiting: counts.waiting || 0,
    failed: counts.failed || 0,
    chunks,
    stored_dimensions: chunks * DIMENSIONS,
    free_stored_dimensions: FREE_STORED_DIMENSIONS,
    errors,
  };
}

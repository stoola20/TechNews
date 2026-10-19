import { query, rows } from './store.js';
import { embed, queryText, mediaText } from './rag-index.js';

// 文章庫檢索：對外只有 search 一個介面。輸入查詢、範圍（kept｜all）、要排除的文章與筆數；
// 輸出片段清單與是否降級。之後要換成 Mac 本機實作時，只替換這個模組。
// 片段格式沿用追問：id、item_id、url、relation、range_start、content，另外標示 kept（是否為保留文章）。
//
// 混合排名：語意（Vectorize 前 30 筆，相似度門檻 0.42）與 D1 關鍵字各排一份，用 RRF 合併，
// 每份排名貢獻 1／(10＋名次)。每篇最多 3 段，取前 12 段。門檻是初始值，要用合成測資與實際使用調整，
// 調整時同步更新規格（docs/specs/curated-study.md）與這裡的註解。
export const SEMANTIC_TOP_K = 30;
export const SEMANTIC_MIN = 0.42;
export const SIMILAR_MIN = 0.55;
export const RELATED_MIN = 0.5;
const RRF_K = 10,
  PER_ITEM = 3,
  WINDOW_BEFORE = 500,
  WINDOW = 1500;

// 關鍵字：中文依詞切分；API 名稱、版本號這類含 . - / 的精確詞整個保留。
export function keywords(question) {
  const text = String(question || '');
  const exact = (text.match(/[A-Za-z0-9][\w./-]*[A-Za-z0-9]/g) || []).filter((t) => /[./-]/.test(t));
  const words = [...new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(text)]
    .filter((s) => s.isWordLike && s.segment.length >= 2)
    .map((s) => s.segment);
  return [...new Set([...exact, ...words].map((t) => t.toLowerCase()))].slice(0, 12);
}

// 語意排名：查詢向量化後取前 30 筆，丟掉低於門檻、文章已不是保留，或片段已過期（文章內容已更新）的結果。
async function semanticRanking(env, text, exclude) {
  if (!env.LIBRARY_INDEX || !env.AI) throw new Error('沒有設定 Vectorize 或 Workers AI');
  const [vector] = await embed(env, [queryText(text)]);
  const result = await env.LIBRARY_INDEX.query(vector, { topK: SEMANTIC_TOP_K, returnMetadata: 'none' });
  const matches = (result?.matches || []).filter((m) => m.score >= SEMANTIC_MIN);
  if (!matches.length) return [];
  const found = await rows(
    env,
    `SELECT c.id,c.item_id,c.kind,c.ref_id,c.start,c.length,c.revision,i.revision AS item_revision,i.triage,i.url
    FROM learning_chunks c JOIN learning_items i ON i.id=c.item_id WHERE c.id IN (${matches.map(() => '?').join(',')})`,
    ...matches.map((m) => m.id),
  );
  const byId = new Map(found.map((r) => [r.id, r]));
  const ranked = [];
  for (const match of matches) {
    const chunk = byId.get(match.id);
    if (!chunk || chunk.triage !== 'kept' || chunk.revision !== chunk.item_revision || exclude.includes(chunk.item_id))
      continue;
    const unit = await chunkUnit(env, chunk);
    if (unit) ranked.push({ ...unit, score: match.score });
  }
  return ranked;
}

// 依片段紀錄從 D1 取出文字，組成追問片段。
async function chunkUnit(env, chunk) {
  if (chunk.kind === 'body') {
    const row = await query(
      env,
      'SELECT substr(body,?,?) AS content FROM learning_items WHERE id=?',
      chunk.start + 1,
      chunk.length,
      chunk.item_id,
    ).first();
    return row?.content
      ? {
          key: chunk.id,
          id: `body:${chunk.item_id}:${chunk.start}`,
          item_id: chunk.item_id,
          url: chunk.url,
          relation: 'article_body',
          range_start: chunk.start,
          content: row.content,
        }
      : null;
  }
  if (chunk.kind === 'source') {
    const row = await query(
      env,
      'SELECT url,relation,author_id,published_at,substr(content,?,?) AS content FROM learning_evidence WHERE id=?',
      chunk.start + 1,
      chunk.length,
      chunk.ref_id,
    ).first();
    return row?.content
      ? {
          key: chunk.id,
          id: `${chunk.ref_id}:${chunk.start}`,
          item_id: chunk.item_id,
          url: row.url,
          relation: row.relation,
          author_id: row.author_id,
          published_at: row.published_at,
          range_start: chunk.start,
          content: row.content,
        }
      : null;
  }
  const row = await query(
    env,
    'SELECT a.analysis_json,m.url FROM learning_media_analyses a JOIN learning_media m ON m.id=a.media_id WHERE a.id=?',
    chunk.ref_id,
  ).first();
  if (!row) return null;
  const content = mediaText(JSON.parse(row.analysis_json || '{}')).substr(chunk.start, chunk.length);
  return content
    ? {
        key: chunk.id,
        id: `media:${chunk.ref_id}`,
        item_id: chunk.item_id,
        url: row.url,
        relation: 'media_evidence',
        range_start: chunk.start,
        content,
      }
    : null;
}

// 關鍵字排名：在指定篩選結果的文章裡，依關鍵字命中數排序原始來源與媒體解析；命中位置落在已索引的片段時，
// 用同一個片段身分，讓兩份排名可以合併。沒有索引的文章取命中位置前後約 1,500 字。
async function keywordRanking(env, text, triage, exclude, limit = SEMANTIC_TOP_K) {
  const terms = keywords(text);
  if (!terms.length) return [];
  const rank = (column) => terms.map(() => `CASE WHEN instr(lower(${column}),?)>0 THEN 1 ELSE 0 END`).join('+');
  const evidence = await rows(
    env,
    `SELECT e.id,e.item_id,e.url,e.relation,e.author_id,e.published_at,a.revision,(${rank('e.content')}) AS score FROM learning_evidence e JOIN learning_items a ON a.id=e.item_id
    WHERE e.status='available' AND e.relation IN ('primary','external') AND a.body IS NOT NULL AND a.status NOT IN ('dismissed','merged','filtered') AND a.triage=? AND score>0
    ORDER BY score DESC,a.updated_at DESC LIMIT ?`,
    ...terms,
    triage,
    limit,
  );
  const ranked = [];
  for (const e of evidence) {
    if (exclude.includes(e.item_id)) continue;
    const positions = terms.map(
      () => 'CASE WHEN instr(lower(content),?)>0 THEN instr(lower(content),?) ELSE 2147483647 END',
    );
    const hit = await query(
      env,
      `SELECT ${positions.length === 1 ? positions[0] : `min(${positions.join(',')})`} AS position FROM learning_evidence WHERE id=?`,
      ...terms.flatMap((t) => [t, t]),
      e.id,
    ).first();
    const position = Math.max(0, hit.position - 1);
    const chunk = await query(
      env,
      "SELECT c.id,c.item_id,c.kind,c.ref_id,c.start,c.length,c.revision,i.revision AS item_revision,i.triage,i.url FROM learning_chunks c JOIN learning_items i ON i.id=c.item_id WHERE c.item_id=? AND c.revision=? AND c.kind='source' AND c.ref_id=? AND c.start<=? ORDER BY c.start DESC LIMIT 1",
      e.item_id,
      e.revision,
      e.id,
      position,
    ).first();
    if (chunk && position < chunk.start + chunk.length) {
      const unit = await chunkUnit(env, chunk);
      if (unit) {
        ranked.push(unit);
        continue;
      }
    }
    const start = Math.max(0, position - WINDOW_BEFORE);
    const excerpt = await query(
      env,
      'SELECT substr(content,?,?) AS content FROM learning_evidence WHERE id=?',
      start + 1,
      WINDOW,
      e.id,
    ).first();
    ranked.push({
      key: `${e.id}:${start}`,
      id: `${e.id}:${start}`,
      item_id: e.item_id,
      url: e.url,
      relation: e.relation,
      author_id: e.author_id,
      published_at: e.published_at,
      range_start: start,
      content: excerpt.content,
    });
  }
  // 只出現在媒體解析裡的關鍵字（例如影片語音或畫面文字）也要找得到。
  const media = await rows(
    env,
    `SELECT a.id,a.analysis_json,m.url,m.item_id,(${rank('a.analysis_json')}) AS score FROM learning_media_analyses a JOIN learning_media m ON m.id=a.media_id JOIN learning_items i ON i.id=m.item_id
    WHERE i.status NOT IN ('dismissed','merged','filtered') AND i.triage=? AND score>0 ORDER BY score DESC LIMIT 6`,
    ...terms,
    triage,
  );
  for (const a of media) {
    if (exclude.includes(a.item_id) || ranked.some((u) => u.id === `media:${a.id}`)) continue;
    const content = mediaText(JSON.parse(a.analysis_json || '{}'));
    if (content)
      ranked.push({
        key: `media:${a.id}`,
        id: `media:${a.id}`,
        item_id: a.item_id,
        url: a.url,
        relation: 'media_evidence',
        range_start: 0,
        content: content.slice(0, WINDOW),
      });
  }
  // 舊版教材把媒體觀察存在 article_json.observations，沒有媒體解析可索引，只用關鍵字找。
  const legacy = await rows(
    env,
    `SELECT id,url,json_extract(article_json,'$.observations') AS observations,(${rank("json_extract(article_json,'$.observations')")}) AS score FROM learning_items
    WHERE status NOT IN ('dismissed','merged','filtered') AND triage=? AND json_array_length(json_extract(article_json,'$.observations'))>0 AND score>0 ORDER BY score DESC LIMIT 6`,
    ...terms,
    triage,
  );
  for (const row of legacy) {
    if (exclude.includes(row.id)) continue;
    for (const [sourceId, list] of Object.entries(Object.groupBy(JSON.parse(row.observations), (o) => o.source_id))) {
      const id = `${sourceId}:observations`;
      if (!ranked.some((u) => u.id === id))
        ranked.push({
          key: id,
          id,
          item_id: row.id,
          url: row.url,
          relation: 'model_media_observation',
          range_start: 0,
          content: JSON.stringify(list),
        });
    }
  }
  return ranked;
}

// RRF：每份排名貢獻 1／(10＋名次)，名次從 1 起算；同一片段出現在兩份排名時分數相加。
export function fuse(rankings, { perItem = PER_ITEM, limit = 12 } = {}) {
  const units = new Map();
  for (const ranking of rankings)
    ranking.forEach((unit, index) => {
      const entry = units.get(unit.key) || { ...unit, rrf: 0 };
      entry.rrf += 1 / (RRF_K + index + 1);
      units.set(unit.key, entry);
    });
  const counts = new Map(),
    out = [];
  for (const unit of [...units.values()].sort((a, b) => b.rrf - a.rrf)) {
    const n = counts.get(unit.item_id) || 0;
    if (n >= perItem) continue;
    counts.set(unit.item_id, n + 1);
    out.push(unit);
    if (out.length >= limit) break;
  }
  return out;
}

const clean = ({ key, rrf, score, ...unit }, kept) => ({ ...unit, kept });

// 檢索：保留文章用語意＋關鍵字混合排名；範圍 all 時再用關鍵字補上待決定文章（不含最近刪除），排在保留文章之後。
// Workers AI 或 Vectorize 失敗（或沒有設定）時只用關鍵字排名，結果標示 degraded。
export async function search(env, { query: text, scope = 'kept', exclude = [], limit = 12, extra = 6 } = {}) {
  let semantic = [],
    degraded = false;
  try {
    semantic = await semanticRanking(env, text, exclude);
  } catch (error) {
    degraded = true;
    console.log(JSON.stringify({ event: 'rag_search_degraded', error: String(error.message).slice(0, 200) }));
  }
  const keyword = await keywordRanking(env, text, 'kept', exclude);
  const chunks = fuse([semantic, keyword], { limit }).map((u) => clean(u, true));
  if (scope === 'all') {
    const unkept = fuse([await keywordRanking(env, text, 'pending', exclude)], { limit: extra });
    chunks.push(...unkept.map((u) => clean(u, false)));
  }
  return { chunks, degraded };
}

// 文章層級的語意相似：用一段查詢文字找保留文章，依文章取最高相似度，達門檻的前 limit 篇。
// 篩選模式的相似文章與出題的相關文章共用；降級時回傳空清單並標示。
export async function relatedArticles(env, text, { exclude = [], min = SIMILAR_MIN, limit = 3 } = {}) {
  try {
    const ranked = await semanticRanking(env, text, exclude);
    const best = new Map();
    for (const unit of ranked) {
      const current = best.get(unit.item_id);
      if (!current || unit.score > current.score)
        best.set(unit.item_id, { item_id: unit.item_id, score: unit.score, chunks: [] });
      best.get(unit.item_id).chunks.push(clean(unit, true));
    }
    return {
      articles: [...best.values()]
        .filter((a) => a.score >= min)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((a) => ({ ...a, chunks: a.chunks.slice(0, PER_ITEM) })),
      degraded: false,
    };
  } catch (error) {
    console.log(JSON.stringify({ event: 'rag_related_degraded', error: String(error.message).slice(0, 200) }));
    return { articles: [], degraded: true };
  }
}

-- 保留文章的 RAG 索引：每個向量一列。片段文字不存在 Vectorize，檢索時依起點與長度從 D1 取出。
-- kind：body 教材正文（learning_items.body）、source 原始來源（learning_evidence.content）、media 媒體解析（learning_media_analyses）。
CREATE TABLE learning_chunks (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('body','source','media')),
  ref_id TEXT,
  start INTEGER NOT NULL,
  length INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX learning_chunks_item ON learning_chunks(item_id, revision);
-- 文章的索引狀態：已索引的 revision、Vectorize 裡是否還有向量、失敗次數（針對哪個 revision）、下次重試時間與錯誤。
ALTER TABLE learning_items ADD COLUMN index_revision INTEGER;
ALTER TABLE learning_items ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_items ADD COLUMN index_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_items ADD COLUMN index_attempt_revision INTEGER;
ALTER TABLE learning_items ADD COLUMN index_next_at TEXT;
ALTER TABLE learning_items ADD COLUMN index_error TEXT;
-- 移出索引時只看還有向量的文章。
CREATE INDEX learning_items_indexed ON learning_items(triage) WHERE indexed=1;

-- 今日複習：每題一列。階數 1–4 對應 1、3、7、21 天；到期日是台灣日期 YYYY-MM-DD。
-- 文章不是保留時不出現在複習（查詢時過濾），重新保留後照原到期日出現；文章清除時刪除。
CREATE TABLE learning_reviews (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 4),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','done')),
  last_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (quiz_id, number)
);
CREATE INDEX learning_reviews_due ON learning_reviews(status, due_date);
CREATE INDEX learning_reviews_item ON learning_reviews(item_id);
-- 複習作答對應的複習題；review_applied 讓批改後的複習更新只套用一次。
ALTER TABLE learning_attempts ADD COLUMN review_id TEXT;
ALTER TABLE learning_attempts ADD COLUMN review_applied INTEGER NOT NULL DEFAULT 0;

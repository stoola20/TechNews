-- 今日複習可以把單題移出（不再複習）：status 多一個 dismissed。
-- SQLite 不能直接改 CHECK 條件，所以重建資料表後搬回資料與索引。
CREATE TABLE learning_reviews_new (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 4),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','done','dismissed')),
  last_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (quiz_id, number)
);
INSERT INTO learning_reviews_new(id,quiz_id,number,item_id,stage,due_date,status,last_result,created_at,updated_at,completed_at)
  SELECT id,quiz_id,number,item_id,stage,due_date,status,last_result,created_at,updated_at,completed_at FROM learning_reviews;
DROP TABLE learning_reviews;
ALTER TABLE learning_reviews_new RENAME TO learning_reviews;
CREATE INDEX learning_reviews_due ON learning_reviews(status, due_date);
CREATE INDEX learning_reviews_item ON learning_reviews(item_id);
CREATE INDEX learning_reviews_completed ON learning_reviews(completed_at) WHERE status='done';

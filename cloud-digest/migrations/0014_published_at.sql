-- 原文發表時間（UTC ISO 8601）。列表依「發表時間，沒有時用加入時間」排序。
ALTER TABLE learning_items ADD COLUMN published_at TEXT;
CREATE INDEX learning_items_published ON learning_items(COALESCE(published_at,created_at),id);

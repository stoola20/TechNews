-- 每週回顧：依時間範圍統計保留、刪除與完成複習的篇數或題數。
CREATE INDEX learning_items_kept_at ON learning_items(triage, kept_at) WHERE triage='kept';
-- 刪除時間在清除後仍保留，過去幾週的刪除篇數不會因為清除而消失。
CREATE INDEX learning_items_deleted_at ON learning_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX learning_reviews_completed ON learning_reviews(completed_at) WHERE status='done';

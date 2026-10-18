-- 主題分類：主要主題與最多一個次要主題。topic_revision 記錄分類時的文章 revision；
-- 內容更新（revision 增加）或主題被刪除時重新分類。topic_source='manual' 的文章不被自動分類覆寫。
ALTER TABLE learning_items ADD COLUMN topic_primary TEXT;
ALTER TABLE learning_items ADD COLUMN topic_secondary TEXT;
ALTER TABLE learning_items ADD COLUMN topic_source TEXT;
ALTER TABLE learning_items ADD COLUMN topic_revision INTEGER;
ALTER TABLE learning_items ADD COLUMN topic_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_items ADD COLUMN topic_next_at TEXT;
CREATE INDEX learning_items_topic ON learning_items(topic_primary);
CREATE INDEX learning_items_topic_secondary ON learning_items(topic_secondary);

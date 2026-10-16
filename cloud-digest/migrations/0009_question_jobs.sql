-- 追問改為可持續保存的非同步工作：保存狀態、範圍、工作與錯誤，重開頁面可查看進度與歷史。
ALTER TABLE learning_questions ADD COLUMN status TEXT NOT NULL DEFAULT 'done';
ALTER TABLE learning_questions ADD COLUMN scope TEXT;
ALTER TABLE learning_questions ADD COLUMN job_id TEXT;
ALTER TABLE learning_questions ADD COLUMN error TEXT;
ALTER TABLE learning_questions ADD COLUMN updated_at TEXT;
CREATE INDEX learning_questions_item ON learning_questions(item_id, created_at);

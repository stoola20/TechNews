-- 完成通知依共同文章與版本去重：記錄已通知的版本與當時的來源內容指紋。
ALTER TABLE learning_items ADD COLUMN notified_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_items ADD COLUMN notified_content TEXT;
UPDATE learning_items SET notified_revision=COALESCE((SELECT MAX(notify_revision) FROM learning_intakes WHERE item_id=learning_items.id),0);

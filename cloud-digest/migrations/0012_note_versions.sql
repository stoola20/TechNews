-- 筆記保存時間作為版本：跨分頁同時編輯時不靜默覆寫。
ALTER TABLE learning_items ADD COLUMN note_updated_at TEXT;

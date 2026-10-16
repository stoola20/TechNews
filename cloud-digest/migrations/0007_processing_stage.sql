-- 處理階段：讓網站顯示文章卡在取得來源、解析媒體或本機文字生成。
ALTER TABLE learning_items ADD COLUMN stage TEXT;

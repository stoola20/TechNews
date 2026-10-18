-- X 貼文唯一連到的外部文章網址：分享與官方收到同一篇時合併成一篇。
ALTER TABLE learning_items ADD COLUMN linked_url TEXT;
CREATE INDEX learning_items_linked ON learning_items(linked_url);

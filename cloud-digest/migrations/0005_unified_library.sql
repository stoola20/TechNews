-- 共同文章庫：官方導讀與收藏教材共用 learning_items，保留版本、收件入口與舊連結。
ALTER TABLE learning_items ADD COLUMN edition TEXT NOT NULL DEFAULT 'detailed';
ALTER TABLE learning_intakes ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE articles ADD COLUMN library_item_id TEXT;
CREATE INDEX learning_items_url ON learning_items(url);
CREATE INDEX learning_intakes_item ON learning_intakes(item_id, origin);

CREATE TABLE learning_versions (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES learning_items(id),
  revision INTEGER NOT NULL, edition TEXT NOT NULL, origin TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', body TEXT, article_json TEXT,
  gaps_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE INDEX learning_versions_item ON learning_versions(item_id, created_at);

-- 舊文章識別碼合併後仍可由深層連結找到新文章。
CREATE TABLE learning_aliases (
  alias TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES learning_items(id), created_at TEXT NOT NULL
);

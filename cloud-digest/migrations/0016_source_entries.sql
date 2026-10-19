-- 官方來源看過的網址改成一個網址一列，記下何時看到、怎麼決定；取代 source_state.seen_urls_json。
-- decision：baseline 初次基準（新來源首次執行前就在列表上）、collected 收件、stale 太舊略過。
CREATE TABLE source_entries (
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_listed_at TEXT NOT NULL,
  title TEXT,
  published_at TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('baseline','collected','stale')),
  reason TEXT,
  item_id TEXT,
  manual INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, url)
);
CREATE INDEX source_entries_first_seen ON source_entries(source, first_seen_at);
CREATE INDEX source_entries_item ON source_entries(item_id);

-- 每次官方發現，每個來源一列；管理頁顯示最近一輪結果。
CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  collected INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  baseline INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX source_runs_recent ON source_runs(source, ran_at);

-- 既有看過清單轉成初次基準，沿用來源最後檢查時間作為最後出現在列表的時間。
INSERT OR IGNORE INTO source_entries(source,url,first_seen_at,last_listed_at,decision,reason)
  SELECT s.source, j.value, s.initialized_at, s.last_checked_at, 'baseline', '升級前已看過'
  FROM source_state s, json_each(s.seen_urls_json) j;
UPDATE source_state SET seen_urls_json='[]';

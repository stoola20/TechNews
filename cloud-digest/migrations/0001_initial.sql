CREATE TABLE IF NOT EXISTS source_state (
  source TEXT PRIMARY KEY,
  initialized_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  seen_urls_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  source_url TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'skipped', 'notified')),
  summary_json TEXT,
  full_message_id INTEGER,
  alert_message_id INTEGER,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_articles_source_status ON articles (source, status);

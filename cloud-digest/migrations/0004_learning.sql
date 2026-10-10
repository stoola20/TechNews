CREATE TABLE learning_items (
  id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued',
  body TEXT, article_json TEXT, gaps_json TEXT NOT NULL DEFAULT '[]',
  read_at TEXT, note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, lease_until TEXT, next_attempt_at TEXT,
  last_error TEXT, recheck_at TEXT, rechecked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX learning_pending ON learning_items(status, next_attempt_at);
CREATE TABLE learning_intakes (
  receipt TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES learning_items(id),
  origin TEXT NOT NULL, notify_revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE learning_evidence (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES learning_items(id),
  url TEXT NOT NULL, relation TEXT NOT NULL, author_id TEXT, published_at TEXT,
  content TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available', fetched_at TEXT NOT NULL,
  UNIQUE(item_id, url, relation)
);
CREATE TABLE learning_media (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES learning_items(id),
  evidence_id TEXT NOT NULL REFERENCES learning_evidence(id), url TEXT NOT NULL,
  type TEXT NOT NULL, mime TEXT, duration_ms INTEGER, bytes INTEGER,
  object_key TEXT, file_json TEXT, status TEXT NOT NULL DEFAULT 'pending',
  error TEXT, attempts INTEGER NOT NULL DEFAULT 0, expires_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE learning_months (month TEXT PRIMARY KEY, limit_micro INTEGER NOT NULL, base_micro INTEGER NOT NULL);
CREATE TABLE learning_costs (
  id TEXT PRIMARY KEY, month TEXT NOT NULL REFERENCES learning_months(month),
  category TEXT NOT NULL, amount_micro INTEGER NOT NULL, status TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX learning_cost_month ON learning_costs(month);
CREATE TABLE learning_sessions (id TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE learning_connections (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE learning_deliveries (
  id TEXT PRIMARY KEY, item_ids_json TEXT NOT NULL, origin TEXT NOT NULL,
  body TEXT NOT NULL, chat_id TEXT, status TEXT NOT NULL DEFAULT 'pending', message_id INTEGER,
  lease_until TEXT, last_error TEXT, created_at TEXT NOT NULL
);
CREATE TABLE learning_questions (
  id TEXT PRIMARY KEY, item_id TEXT, question TEXT NOT NULL, answer_json TEXT NOT NULL, created_at TEXT NOT NULL
);

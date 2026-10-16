-- 本機文字工作：雲端保存輸入與狀態，Mac 執行器以 lease 與 attempt token 領取、續約與回報。
CREATE TABLE learning_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, item_id TEXT, question_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting_local', priority INTEGER NOT NULL,
  input_version TEXT NOT NULL, input_json TEXT NOT NULL,
  attempt_token TEXT, runner_id TEXT, lease_until TEXT, leased_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, lease_expirations INTEGER NOT NULL DEFAULT 0,
  result_json TEXT, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX learning_jobs_queue ON learning_jobs(status, priority, created_at);
CREATE INDEX learning_jobs_item ON learning_jobs(item_id, status);
CREATE TABLE learning_runners (id TEXT PRIMARY KEY, last_seen_at TEXT NOT NULL, info_json TEXT NOT NULL DEFAULT '{}');

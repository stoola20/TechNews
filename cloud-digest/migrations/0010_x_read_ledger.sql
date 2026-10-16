-- X 讀取帳本：依 UTC 日記錄已讀資源，區分當日首次讀取與可能被供應商去重的重讀。
CREATE TABLE learning_x_reads (
  utc_day TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, first_read_at TEXT NOT NULL,
  PRIMARY KEY(utc_day, resource_type, resource_id)
);
-- 每個 UTC 日已計入的重讀風險，用來套用可設定的每日上限。
CREATE TABLE learning_x_days (utc_day TEXT PRIMARY KEY, reread_risk_micro INTEGER NOT NULL DEFAULT 0);

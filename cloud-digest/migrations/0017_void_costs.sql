-- 作廢費用：核對後確認沒有計費的未確認費用改為作廢，不算進月預算，但保留金額、時間與說明供日後對帳。
ALTER TABLE learning_costs ADD COLUMN voided_at TEXT;
ALTER TABLE learning_costs ADD COLUMN void_note TEXT;
-- 既有的 X 未確認費用（失敗呼叫的預留與重讀風險估算）升級時全部作廢；其他類別不動。
UPDATE learning_costs SET status='voided',voided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),void_note='升級時作廢：X 失敗呼叫的預留或重讀風險估算'
  WHERE status='uncertain' AND category IN ('x','x-reread-risk');

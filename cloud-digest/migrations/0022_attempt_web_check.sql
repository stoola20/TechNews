-- 網路查證中的作答：維護排程找出卡住（Worker 中斷）的查證重新執行。
CREATE INDEX learning_attempts_web_check ON learning_attempts(updated_at) WHERE status='web_check';

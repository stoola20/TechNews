-- 篩選結果：pending 待決定（預設）、kept 保留、deleted 最近刪除。starred 是保留裡的「常用參考」，只出現在 kept。
-- 篩選與處理狀態（status）分開；filtered、merged、dismissed 的文章不參與篩選。
ALTER TABLE learning_items ADD COLUMN triage TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE learning_items ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
-- 成為 kept 時寫入、離開時清空，週回顧用。
ALTER TABLE learning_items ADD COLUMN kept_at TEXT;
-- 刪除時間、原因（manual｜expired）與刪除前的結果（pending｜kept｜starred），供最近刪除顯示與復原。
ALTER TABLE learning_items ADD COLUMN deleted_at TEXT;
ALTER TABLE learning_items ADD COLUMN deleted_reason TEXT;
ALTER TABLE learning_items ADD COLUMN deleted_from TEXT;
-- 待決定期限：第一次可以閱讀時設為 14 天後；triage_no_expiry=1 的文章不套用自動過期。
ALTER TABLE learning_items ADD COLUMN triage_deadline TEXT;
ALTER TABLE learning_items ADD COLUMN triage_no_expiry INTEGER NOT NULL DEFAULT 0;
-- 升級時所有文章都是待決定；已經可以閱讀的文章由使用者按自己的步調清理，不自動過期。
UPDATE learning_items SET triage_no_expiry=1 WHERE status IN ('ready','partial','awaiting_backfill');
CREATE INDEX learning_items_triage ON learning_items(triage, status);
-- 待決定期限：逾期檢查用範圍查詢，補上起算點時用 triage_deadline IS NULL。
CREATE INDEX learning_items_triage_deadline ON learning_items(triage, triage_deadline) WHERE triage='pending';
CREATE INDEX learning_items_deleted ON learning_items(triage, deleted_at) WHERE triage='deleted';

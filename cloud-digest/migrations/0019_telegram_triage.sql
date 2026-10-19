-- Telegram 篩選按鈕：按下後記住按下前的篩選結果，「復原」用它回到原狀；同一則訊息重複送達的回呼不覆寫。
ALTER TABLE learning_deliveries ADD COLUMN triage_undo TEXT;
-- 按鈕回呼只帶訊息編號，用它找回那則通知。
CREATE INDEX learning_deliveries_message ON learning_deliveries(message_id);

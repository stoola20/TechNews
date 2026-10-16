-- Flash 媒體證據：與文字寫作分開保存，依素材、模型與提示版本重用。
CREATE TABLE learning_media_analyses (
  id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES learning_media(id), item_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  analysis_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX learning_media_analyses_media ON learning_media_analyses(media_id, fingerprint);
CREATE INDEX learning_media_analyses_item ON learning_media_analyses(item_id);
-- 解析失敗與下載／上傳失敗分開計數，避免檔案就緒時把解析失敗次數歸零。
ALTER TABLE learning_media ADD COLUMN analysis_attempts INTEGER NOT NULL DEFAULT 0;

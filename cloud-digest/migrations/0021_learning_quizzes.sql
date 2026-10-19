-- 精讀問答：一次出題是一組題目。revision 是出題時的文章版本，文章更新後畫面標示「文章已更新」。
-- questions_json 每題：題號、類型（article｜link）、題目、參考答案、出處片段 ID 與片段內容、連結題的相關文章 ID。
CREATE TABLE learning_quizzes (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','waiting_local','generating','ready','error')),
  questions_json TEXT NOT NULL DEFAULT '[]',
  related_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  job_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX learning_quizzes_item ON learning_quizzes(item_id, created_at);
-- 一次作答：情境 quiz（精讀）或 review（複習），作答 JSON 是每題的答案與「不確定」。
CREATE TABLE learning_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('quiz','review')),
  answers_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('grading','waiting_local','web_check','done','error')),
  grading_json TEXT,
  provider TEXT,
  model TEXT,
  web_check TEXT NOT NULL DEFAULT 'none' CHECK (web_check IN ('none','done','disabled','failed')),
  job_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX learning_attempts_created ON learning_attempts(created_at);
CREATE INDEX learning_attempts_quiz ON learning_attempts(quiz_id, created_at);

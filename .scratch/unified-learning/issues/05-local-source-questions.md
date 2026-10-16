# 05: 本機來源追問、進度與歷史

**What to build:** 使用者對單篇或整個文章庫提問，問題保存並交由 Mac 回答；可關閉頁面再回來查看進度、答案及可查核來源。

**Blocked by:** 02：網站分享純文字文章，經 Mac 產生詳細教材

**Status:** done

- [x] 沿用關鍵字檢索，不新增模型／向量依賴
- [x] 已保存文字及新舊媒體觀察可作證據
- [x] 單篇範圍不越界
- [x] 引用只來自實際提供片段
- [x] 不足時明說
- [x] 問題優先於背景生成，但不強制中斷在途推論
- [x] 離線等待可恢復、歷史受登入保護、完成不發文章通知。

## 實作紀錄

- `src/learning/questions.js`：沿用 D1 關鍵字檢索；原文片段、新版媒體證據與舊版媒體觀察都有穩定引用 ID。本機模式下提問先保存並建立優先序 0 的工作，回覆 202 與問題 ID；切換前仍走 Gemini 同步回答並保存歷史。
- `migrations/0009_question_jobs.sql`：問題狀態、範圍、工作與錯誤。
- API：`GET /learning/api/questions?item_id=`、`GET /learning/api/questions/:id`；頁面送出後輪詢進度，並顯示提問紀錄。
- 驗證：`tests/questions.test.js`；另以真實 `gemma4:26b` 透過示範伺服器回答單篇問題，引用有效片段。

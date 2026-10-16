# 04: Flash 媒體證據接力 Gemma 詳細整理

**What to build:** 一篇含圖片或影片的 X 內容，由 Flash 先保存可查核媒體證據，再由 Mac Gemma 結合原文完成詳細教材，閱讀頁可核對來源及時間點。

**Blocked by:** 02：網站分享純文字文章，經 Mac 產生詳細教材

**Status:** done

- [x] OCR、可辨識語音、畫面觀察、時間點與缺口符合證據契約
- [x] 不能只以短 observation 冒充完整解析
- [x] 無效來源／超片長時間點被拒絕
- [x] 文字重試重用已保存媒體結果
- [x] 超限及到期顯示缺漏並沿用保存政策
- [x] 主動分享與現有來源取得路徑不回歸。

## 實作紀錄

- `src/learning/media-analysis.js`：Flash 媒體證據契約（OCR 狀態與逐字、語音段落起訖、MM:SS 畫面觀察與 observed／inferred、無法辨識片段、實際涵蓋範圍），依片長驗證；每 5 分鐘宣稱涵蓋至少一筆觀察。
- `migrations/0008_media_analyses.sql`：媒體解析與文字寫作分開保存，依素材、模型與提示版本重用；解析失敗另計次數。
- 本機模式下含媒體內容也交給 Mac：媒體證據以 `M1` 代號送進 Gemma，正文可引用；閱讀頁顯示證據並可依時間點跳轉影片，過期後保留解析與原始連結。
- 驗證：`tests/media-evidence.test.js`（模擬 X、媒體 CDN、Gemini 檔案與解析、Ollama）。真實 Gemini 媒體解析尚未實測。

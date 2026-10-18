# 12: Gemini 模式下官方文章也進文章庫詳細整理

**What to build:** 啟用文章庫後，08:00 官方文章不論文字模型是 Gemini 或本機，都進共同文章庫詳細整理並逐篇通知；Gemini 路徑補上與本機相同的讀者關注篩選。舊的 Workers AI 短導讀只在未啟用文章庫時使用。

**Blocked by:** 02：可靠的逐篇重寫

**Status:** done

- [x] 官方排程不再依文字模型決定是否走舊短導讀流程
- [x] Gemini 對只由官方收件的新文章輸出 publish／reason；不符合時標為主題不符、不通知
- [x] 已發布過的舊導讀重寫、使用者分享過的同一篇不做主題篩選

## 實作紀錄

- 成因：`src/index.js` 只有文字模型為本機時才讓官方文章進文章庫；切回 Gemini 後，官方文章又回到 Workers AI 短導讀，再被搬進文章庫成為「既有導讀」。
- `src/index.js`：`LEARNING_ENABLED` 時官方一律交給文章庫。
- `src/learning/gemini.js`：官方文章使用含 `publish`、`reason` 的輸出 schema；`src/learning/service.js` 共用 `officialContext`（只對未發過通知、非舊導讀、只有官方收件的文章判斷），不符合時保存判斷並標為 `filtered`。
- 驗證：`tests/official.test.js`「Gemini 模式」案例。

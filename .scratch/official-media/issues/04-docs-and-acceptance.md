# 04: 文件與整體驗收

**What to build:** 更新架構文件中「官方文章不抓媒體」的說明，寫清楚圖片與 figure 截圖的來源、規則、限制（互動圖只截預設狀態）與費用。整體跑測試與格式檢查；部署後用 `https://claude.dev/blog/spending-your-effort/` 重新整理驗收。

**Blocked by:** 01, 02, 03

**Status:** done

- [x] `docs/architecture.md` 更新官方文章媒體說明
- [x] `evidence.js` 的舊註解更新
- [x] `npm test`、`npm run format:check` 通過
- [x] 部署後實測驗收（需使用者同意部署）

**實作紀錄：** 文件更新 `docs/architecture.md`（新增「官方文章與網頁的圖片」）、`docs/learning-setup.md` 與 `docs/source-strategy.md` 的 Browser Run 用量說明。`npm test` 199 個全部通過，`format:check` 通過。部署前已用本機 Chrome（playwright-core）模擬截圖流程，`spending-your-effort` 的 6 張 figure 都截到正確元素。

**正式驗收（2026-10-23，版本 `bc89aa68`）：** 在 `spending-your-effort` 從「⋯」選單按「重抓原文並整理」。重抓標記處理後清除，6 張 figure 都以 selector 登記，Browser Run 截圖全部成功（PNG，71–167 KB，寬 1320px），文章重寫到 revision 3，沒有缺漏。Gemini 模式下圖片直接交給寫作模型，6 張各有一筆觀察，引用了圖上的實際數字（例如 Terminal-Bench 各 effort 的通過率）。閱讀頁「媒體與時間點」6 張圖都載入成功。FIG B 在 Browser Run 截到的是動畫結束後的 xhigh 狀態，跟本機模擬截到的不同，符合「互動元件只截預設狀態」的限制。

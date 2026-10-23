# 04: 文件與整體驗收

**What to build:** 更新架構文件中「官方文章不抓媒體」的說明，寫清楚圖片與 figure 截圖的來源、規則、限制（互動圖只截預設狀態）與費用。整體跑測試與格式檢查；部署後用 `https://claude.dev/blog/spending-your-effort/` 重新整理驗收。

**Blocked by:** 01, 02, 03

**Status:** in progress

- [x] `docs/architecture.md` 更新官方文章媒體說明
- [x] `evidence.js` 的舊註解更新
- [x] `npm test`、`npm run format:check` 通過
- [ ] 部署後實測驗收（需使用者同意部署）

**實作紀錄：** 文件更新 `docs/architecture.md`（新增「官方文章與網頁的圖片」）、`docs/learning-setup.md` 與 `docs/source-strategy.md` 的 Browser Run 用量說明。`npm test` 199 個全部通過，`format:check` 通過。部署前已用本機 Chrome（playwright-core）模擬截圖流程，`spending-your-effort` 的 6 張 figure 都截到正確元素。正式環境的 Browser Run 截圖還沒驗收。

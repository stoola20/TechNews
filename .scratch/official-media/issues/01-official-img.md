# 01: 官方文章收正文裡的 `<img>`

**What to build:** 官方文章抓完原文後，從網頁 HTML 的正文區塊收集 `<img>`，登記成文章媒體，之後走既有的 R2 → Gemini Flash 證據流程。Markdown 來源（claude.dev）另外抓一次網頁 HTML 來收圖。正文區塊與文字擷取用同一組選擇器（`contentSelector`、claude.dev 的 `.prose`、`article`／`main`）。裝飾圖片規則沿用 `decorativeImage`。網頁 HTML 取不到時，登記一筆待處理媒體並寫明原因，不當作沒有圖片。

**Blocked by:** None (can start immediately)

**Status:** pending

- [ ] 把 `pageEvidence` 的 `<img>` 收集抽成共用函式，網頁分享與官方文章共用
- [ ] `sources.js` 匯出正文選擇器，`extractArticle` 與收圖共用
- [ ] `loadArticle` 回傳抓到的 HTML；Markdown 來源另抓網頁 HTML；瀏覽器備援回傳渲染後 HTML
- [ ] `officialEvidence` 回傳收集到的圖片；HTML 取不到時登記一筆 `needs_attention` 媒體
- [ ] `registerMedia` 支援帶錯誤原因的媒體
- [ ] 測試：一般官方來源收圖、Markdown 來源另抓 HTML、裝飾圖片排除、HTML 失敗留缺漏

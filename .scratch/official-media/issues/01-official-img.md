# 01: 官方文章收正文裡的 `<img>`

**What to build:** 官方文章抓完原文後，從網頁 HTML 的正文區塊收集 `<img>`，登記成文章媒體，之後走既有的 R2 → Gemini Flash 證據流程。Markdown 來源（claude.dev）另外抓一次網頁 HTML 來收圖。正文區塊與文字擷取用同一組選擇器（`contentSelector`、claude.dev 的 `.prose`、`article`／`main`）。裝飾圖片規則沿用 `decorativeImage`。網頁 HTML 取不到時，登記一筆待處理媒體並寫明原因，不當作沒有圖片。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 把 `pageEvidence` 的 `<img>` 收集抽成共用函式，網頁分享與官方文章共用
- [x] `sources.js` 匯出正文選擇器，`extractArticle` 與收圖共用
- [x] `loadArticle` 回傳抓到的 HTML；Markdown 來源另抓網頁 HTML；瀏覽器備援回傳渲染後 HTML
- [x] `officialEvidence` 回傳收集到的圖片；HTML 取不到時登記一筆 `needs_attention` 媒體
- [x] `registerMedia` 支援帶錯誤原因的媒體
- [x] 測試：一般官方來源收圖、Markdown 來源另抓 HTML、裝飾圖片排除、HTML 失敗留缺漏

**實作紀錄：** 收圖函式 `bodyImages` 也替網頁分享去掉同一篇內重複的圖片網址。網頁 HTML 取不到時登記的佔位媒體網址以 `#technews-page-html` 結尾，`prepareMedia` 看到就直接標為待處理、保留原因，不會拿網頁去當圖片下載；票 03 重抓原文成功後移除它。測試替身的 `loadArticle` 沒有帶 `html` 時不收圖也不留缺漏，既有官方流程測試不受影響。

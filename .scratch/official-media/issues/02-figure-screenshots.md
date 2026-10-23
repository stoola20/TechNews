# 02: 用 Browser Rendering 截正文的 `<figure>`

**What to build:** 正文裡沒有 `<img>`／`<video>` 的 `<figure>`（inline SVG 圖表、JS 互動元件）登記成圖片媒體，網址是原文網址加上 `#technews-figure-N`（N 是整頁第幾個 `<figure>`，從 0 起算）。`prepareMedia` 遇到這種網址時不下載，改用 `env.BROWSER.quickAction('screenshot')`：注入一段 script，替第 N 個 `<figure>` 加上標記，再用 selector 截那個元素，存進 R2。之後的 Gemini 上傳、解析、30 天到期、補取重試都沿用現有流程。

**選圖規則：** 位在正文區塊內；不含 `<img>`／`<video>`／`<picture>`（已由票 01 收）；只含程式碼、引言、表格的不截；含 `<canvas>`、或寬高超過 200 的 `<svg>`、或有 `aria-label`／`<figcaption>` 的才截。每篇最多 8 張，多的登記為待處理並寫明原因。

**Blocked by:** 01

**Status:** pending

- [ ] 選圖函式與 `#technews-figure-N` 網址格式
- [ ] 官方文章與網頁分享都登記 figure 媒體
- [ ] `prepareMedia` 對 figure 媒體改用截圖；沒有 `BROWSER` binding、截圖失敗、回應不是圖片時記錯誤
- [ ] 截圖預設狀態：桌機 viewport、PNG；R2 費用預估與結算沿用現有規則
- [ ] 測試：選圖規則（SVG、互動元件、程式碼 figure、小 SVG、含 img）、上限、截圖成功與失敗、到期後重截

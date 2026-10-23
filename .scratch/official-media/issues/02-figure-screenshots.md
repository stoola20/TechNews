# 02: 用 Browser Rendering 截正文的 `<figure>`

**What to build:** 正文裡沒有 `<img>`／`<video>` 的 `<figure>`（inline SVG 圖表、JS 互動元件）登記成圖片媒體，網址是原文網址加上 `#technews-figure=<CSS selector>`，selector 從靜態 HTML 算出，能唯一指到那個 `<figure>`。`prepareMedia` 遇到這種網址時不下載，改用 `env.BROWSER.quickAction('screenshot')` 以這個 selector 只截那個元素，存進 R2。之後的 Gemini 上傳、解析、30 天到期、補取重試都沿用現有流程。

**選圖規則：** 位在正文區塊內；不含 `<img>`／`<video>`／`<picture>`（已由票 01 收）；只含程式碼、引言、表格的不截；含 `<canvas>`、或寬高超過 200 的 `<svg>`、或有 `aria-label`／`<figcaption>` 的才截。每篇最多 8 張，多的登記為待處理並寫明原因。

**Blocked by:** 01

**Status:** done

- [x] 選圖函式與 `#technews-figure=<selector>` 網址格式
- [x] 官方文章與網頁分享都登記 figure 媒體
- [x] `prepareMedia` 對 figure 媒體改用截圖；沒有 `BROWSER` binding、截圖失敗、回應不是圖片時記錯誤
- [x] 截圖預設狀態：桌機 viewport、PNG；R2 費用預估與結算沿用現有規則
- [x] 測試：選圖規則（SVG、互動元件、程式碼 figure、小 SVG、含 img）、上限、截圖成功與失敗、到期後重截

**實作紀錄：** 最初的做法是注入 script 替第 N 個 `<figure>` 加標記，用本機 Chrome 模擬 claude.dev 時被網站 CSP 擋下（`script-src` 只允許固定 hash），所以改成登記時從靜態 HTML 算 selector：先用唯一的 `id`，再用唯一的 `aria-label`，否則從最近有唯一 `id` 的祖先往下用 `nth-child` 路徑。模擬時 6 個 selector 在渲染後頁面都剛好對到 1 個元素，截圖清楚（`deviceScaleFactor: 2`）；FIG B 有進場動畫，截到的是動畫中途的畫面，屬於「互動元件只截預設狀態」的限制。整頁先捲動一次，讓延遲載入的元件畫出來。截圖不經過一般下載與大小宣告檢查，改成上限 20 MB。靜態 HTML 與渲染後結構不同時，selector 可能找不到元素，這時記錯誤留待處理。Browser Run 實際截圖要在票 04 部署後確認。

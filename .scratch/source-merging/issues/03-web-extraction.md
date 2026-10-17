# 03: 一般網頁擷取補強與裝飾圖片排除

**What to build:** 沒有 `<article>`／`<main>` 的網頁也能取得正文，必要時用 Browser Rendering；頭像、logo、小圖示不收進媒體，也不列缺漏。

**Blocked by:** 無

**Status:** ready-for-agent

- [ ] `<body>` 後備擷取並移除導覽、頁首、頁尾等區塊
- [ ] 第一次擷取失敗才呼叫 Browser Rendering
- [ ] SVG、logo／avatar／icon／branding、≤ 200px、header／nav／footer／aside 內圖片不登記
- [ ] X 貼文自身媒體不受影響

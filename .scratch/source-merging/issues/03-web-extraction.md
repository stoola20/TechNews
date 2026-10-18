# 03: 一般網頁擷取補強與裝飾圖片排除

**What to build:** 沒有 `<article>`／`<main>` 的網頁也能取得正文，必要時用 Browser Rendering；頭像、logo、小圖示不收進媒體，也不列缺漏。

**Blocked by:** 無

**Status:** done

- [x] `<body>` 後備擷取並移除導覽、頁首、頁尾等區塊
- [x] 第一次擷取失敗才呼叫 Browser Rendering
- [x] SVG、logo／avatar／icon／branding、≤ 200px、header／nav／footer／aside 內圖片不登記
- [x] X 貼文自身媒體不受影響

## 實作紀錄

- `src/learning/network.js`：`webEvidence` 先用既有正文擷取；失敗時退到 `article`／`main`／`body`，移除 script、style、nav、header、footer、aside、button、form 等區塊，正文至少 200 字才採用。仍失敗且有 `BROWSER` binding 時，以 Browser Rendering 取得渲染後 HTML 再擷取一次，來源標示 `content_method: browser_html`。
- 裝飾圖片判斷 `decorativeImage`：SVG、`data:`、網域或路徑含 logo／avatar／icon／favicon／branding／emoji／sprite、`width`／`height` 或 CDN 尺寸參數（`=s120`、`?w=48`）不超過 200px、位於 header／nav／footer／aside 內。沒有網址的圖片直接略過，不再產生「未提供完整媒體 URL」缺漏。X 貼文媒體走另一條路徑，不受影響。
- 驗證：`tests/web-extraction.test.js`（合成頁面）；另以本機保存的一個無 `<article>`／`<main>` 模型頁確認可取得約 9 千字正文（未提交該頁面）。

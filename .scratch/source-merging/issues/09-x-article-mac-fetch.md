# 09: Mac 執行器代抓 X 長文

**What to build:** X 長文無法經 API 取得時，Mac 執行器用已登入 X 的專用 Playwright profile 開啟長文頁擷取正文，回報後保存為外部來源並重新整理。

**Blocked by:** 08：X 長文經 API 取得（API 無法取得時才需要）

**Status:** done（真實 X 登入與長文頁擷取待使用者設定 profile 後驗收）

- [x] 只在有 X 長文缺漏時建立代抓工作；Mac 離線時等待，不算失敗
- [x] 回報沿用執行器憑證、lease 與 attempt token；過期回報被拒
- [x] 雲端不保存 X 登入狀態；profile 只在 Mac 本機
- [x] 提供 profile 首次登入與檢查步驟

## 實作紀錄

- 雲端：外部連結是 X 長文（`x.com/<帳號|i>/article/<id>`）時，正規化為 `https://x.com/i/article/<id>`，保存缺漏並建立 `fetch_x_article` 工作（同一篇可有多份，不互相取代）；已有可用原文（含手動貼上）時不再建立。
- 領取：執行器在 `claim` 宣告 `kinds`；未宣告的舊版執行器只拿文章與追問工作。代抓工作不改文章狀態；完成時保存來源（`content_method: mac_browser`，不覆蓋手動貼上）並把文章重新排入整理；最終失敗把原因寫回缺漏並提示手動貼上。
- 執行器 1.1.0：`runner/x-article.mjs` 以 `playwright-core`（選用相依，用系統 Chrome）開啟專用 profile 擷取最長的 article／main 區塊；`--x-login` 開啟有畫面的 Chrome 登入；`--check` 顯示代抓是否啟用。Ollama 停止時仍可代抓。
- 驗證：`tests/x-article.test.js`（網址正規化、舊版執行器不領取、Ollama 停止時代抓並重新整理、三次失敗寫回原因）；本機以 Playwright 啟動系統 Chrome 擷取本機頁面成功。
- 未驗證：真實 X 長文頁的 DOM 與登入狀態。需使用者在執行器所在的 Mac 設定 `RUNNER_X_PROFILE_DIR` 並執行 `--x-login` 後，以一篇真實長文驗收。

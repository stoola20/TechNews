# X 收藏學習工具驗證紀錄

驗證日期：2026-10-10 至 2026-10-11，Asia/Taipei。

## 已完成的驗證

| 項目 | 結果 | 範圍與限制 |
| --- | --- | --- |
| Worker 程式測試 | 41 個通過 | 既有 21 個回歸＋新增 20 個收藏學習測試；X、Gemini、Telegram 使用模擬網路回應 |
| Worker 打包 | 通過 | Wrangler dry-run，不部署到雲端 |
| Cloudflare 本機執行 | 通過 | 實際 workerd／D1／R2 本機模擬，確認 migration、登入、預算暫停、來源限制、R2 Range 與私人媒體授權 |
| 私人文章庫操作 | 通過 | 本機示範資料；登入、閱讀、搜尋、已讀、筆記保存、追問與引用 |
| 使用者確認本機示範 | 通過 | 使用者已確認示範沒有問題；外部服務設定安排於後續進行 |
| 手機版面 | 通過 | 375 px viewport 設定；瀏覽器縮放下實際 CSS 寬度約 341 px，內容寬度相同，無水平溢出 |
| 真實 X／Gemini API | 未執行 | 尚無必要憑證，不把模擬回應當成實際來源完整度或文章品質證據 |
| 正式部署 | 未執行 | 新流程預設停用；雲端 Queue／R2／migration 與 webhook 尚需設定 |

## 程式測試涵蓋

- 分享到私人閱讀，保留來源尾端與超過 Telegram 上限的完整教材。
- 正規化網址、跨入口身份去重、重複 webhook 與通知結果重用。
- 私人 session、外站變更拒絕、登出與憑證輪替後撤銷舊 session。
- 原子費用預留、不確定失敗仍計入、暫停後保留收件與跨月不自動恢復。
- Gemini 結構化輸出、原生圖片與影片參照、用量、有效引用與影片時間點。
- Telegram secret header、chat 允許清單、收件回覆、長通知分批與無篇數上限。
- 書籤分頁、首次回補確認、遇到已知 ID 不提前停止、中斷後續跑、分頁失效重掃與 API 部分錯誤不冒充完整。
- X OAuth PKCE、回呼驗證、憑證加密與回呼重播拒絕。
- 長文、引用、作者身份與 username 查核、作者補充、直接外連缺漏與重試後補齊同一文章。
- 作者補充在到期後重查一次，更新同一文章及通知。
- 來源與重新導向的公開位址限制，兩種 X 欄位命名的輸入正規化。
- 影片上傳、處理中續跑、有效時間點、20 分鐘與 200 MB 上限。
- 原始媒體到期不刪教材、沒有文字的圖片貼文可處理、私人媒體授權。
- API 宣告附件但未提供媒體資料時標示缺漏。
- 關鍵字搜尋與單篇／跨文章問答的有效片段引用；來源尾端不因檢索前置截斷而消失。

## 重現方式

在 `cloud-digest` 使用 Node 22.13 或更新版本：

```bash
node --test
npx wrangler deploy --dry-run --outdir /private/tmp/technews-learning-build
node scripts/verify-learning-runtime.mjs /private/tmp/technews-learning-build/index.js
node scripts/learning-demo.mjs
```

目前環境使用 Node 22.19.0、Wrangler 4.137.0、Miniflare 5.20260921.0-alpha。執行紀錄以明確的 Node 22 路徑進行，避免子目錄的 shell 選到舊 Node。

本機 runtime 驗證使用 Miniflare 官方相容介面，將已打包程式內容提供給 runtime，並以 D1 prepared statement 逐項執行 migration。此流程只使用測試憑證與本機資料。

## 操作證據

本機資料與模型回應都是測試素材，不是真實 Gemini 產出的品質展示。

- [桌面閱讀截圖](../previews/x-learning-desktop.jpg)
- [手機閱讀截圖](../previews/x-learning-mobile.jpg)

截圖保存在本機驗證目錄，不加入 Git 版本控制。

## 待完成的真實驗證

1. 設定 Gemini、X 與 webhook 所需憑證及允許的 chat。
2. 確認 X 出站欄位命名、長文、書籤分頁與實際可取得範圍。
3. 核對媒體 URL、Files 上傳、影片時間點與實際操作步驟。
4. 對照 X／Google 用量與系統費用紀錄。
5. 用 30 個真實收藏評估來源完整度、技術正確、可讀與可應用程度。

設定步驟見 [設定與驗證](../learning-setup.md)。

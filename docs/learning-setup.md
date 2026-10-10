# X 收藏學習工具：設定與驗證

程式已完成本機開發與模擬整合驗證。正式啟用仍需 Gemini 與 X 憑證、Cloudflare Queue／R2、資料庫 migration、Telegram webhook 與真實 API 驗證。

預設 `LEARNING_ENABLED=false`，避免只有程式部署完成就開始消耗付費 API。既有部落格 digest 的模型與流程維持獨立。

## 本機閱讀與操作示範

在 `cloud-digest` 使用 Node 22.13 或更新版本執行：

```bash
node scripts/learning-demo.mjs
```

開啟 [本機示範](http://localhost:8788/learning)，以 `demo-only` 登入。示範使用記憶體資料庫與固定測試來源，模型與通知都是模擬回應，不會讀取金鑰或呼叫外部服務。關閉程序後示範資料會消失。

可驗證登入、加入連結、完整閱讀、搜尋、已讀、筆記與追問。示範不能驗證 Gemini 的文章品質、X 授權與來源完整度。

## 建立 Cloudflare 資源

在 `cloud-digest` 使用現有 Cloudflare 帳號與已安裝的 Wrangler。正式環境使用 Workers Paid，月預算已預留 US$5 基本費。

```bash
npx wrangler queues create technews-learning-jobs
npx wrangler r2 bucket create technews-learning-media
npx wrangler d1 migrations apply developer-digest-cloud --remote
```

資源名稱已在 Worker 設定中定義。若同名資源已存在，確認它是此專案的資源後重用，不刪除或覆蓋其他用途的資料。migration 只新增學習流程資料表。

## Gemini 設定

從 Google AI Studio 建立可使用 Gemini API 的金鑰，確認付費與可用模型。使用互動輸入設定秘密：

```bash
npx wrangler secret put GEMINI_API_KEY
```

預設模型為 `gemini-3.8-flash`。程式使用 `generateContent`、結構化輸出與原生媒體輸入，媒體透過 Files API 上傳，並輪詢檔案處理狀態。

目前費用估算依 Gemini 3.8 Flash 的官方價格，2026 年底後採文件列出的後續價格。更換模型時，需同時明確設定 `LEARNING_INPUT_USD_PER_MTOK` 與 `LEARNING_OUTPUT_USD_PER_MTOK`，不能只更換模型名稱沿用舊價格。

## X 開發帳號與 OAuth

在 X Developer Console 建立由自己擁有的 Web App／bot，啟用 OAuth 2.0 User Authentication。設定唯一正式回呼網址：

```text
https://<Worker 網址>/learning/x/callback
```

程式要求 `bookmark.read tweet.read users.read offline.access`。`offline.access` 用於刷新授權；OAuth token 以 RUN_TOKEN 衍生的金鑰加密後保存在 D1，不回傳前端。

```bash
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET
```

在 Worker vars 加入 `PUBLIC_BASE_URL`，值為正式 Worker 的 HTTPS origin，不包含 `/learning`、金鑰或登入憑證。

登入文章庫後選「連接 X」。完成後，首次掃描建立待確認的既有書籤清單，預覽也會產生讀取費。未掃完時，顯示的是已取得數量；無法可靠區分初次掃描期間新增與原本已有的書籤。

確認 App owner 與授權使用者是同一人後，可設定 `X_APP_OWNER_ID` 為該使用者 ID，啟用 Owned Reads 的估算單價。未設定或 ID 不符時，程式保守採一般貼文單價；不能因使用書籤端點就假定符合較低價格。

目前 X 官方文件的欄位名稱有 `post.fields` 與 `tweet.fields` 差異。預設 `X_API_FIELDS_STYLE=post`，輸入正規化相容兩種回應。若真實 API 契約驗證顯示需要舊命名，改為 `tweet` 後重新部署；不要把 HTTP 錯誤視為沒有作者補充。

X credits 與供應商 spending limit 需在 X 控制台設定。來源失效、權限不足或 API 不提供的內容，會保留缺漏，不繞過登入或來源限制。

## Telegram 收件與通知

通知沿用既有 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_CHAT_ID`。收件可在 bot 私聊或指定 chat 進行，和通知目的地可以不同。

先用互動方式設定新的 webhook secret：

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

在 Worker vars 設定 `TELEGRAM_ALLOWED_CHAT_IDS`，填入允許收件的 chat ID，多個 ID 用逗號分隔。不要預設公開接受所有使用者。

部署後，以 Telegram Bot API `setWebhook` 指向：

```text
https://<Worker 網址>/learning/telegram
```

同時設定與 Worker 一致的 `secret_token`，以及 `allowed_updates` 為 `message`、`channel_post`。以下本機設定程序從互動輸入取得 Bot token 與 webhook secret，不把它們放進命令參數或文件：

```python
import getpass
import json
import urllib.request

token = getpass.getpass("Telegram Bot token: ")
secret = getpass.getpass("Webhook secret: ")
base_url = input("Worker HTTPS origin: ").strip().rstrip("/")
if not base_url.startswith("https://"):
    raise SystemExit("需要 HTTPS origin")
payload = json.dumps({
    "url": base_url + "/learning/telegram",
    "secret_token": secret,
    "allowed_updates": ["message", "channel_post"],
}).encode()
request = urllib.request.Request(
    "https://api.telegram.org/bot" + token + "/setWebhook",
    data=payload,
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
except Exception:
    raise SystemExit("Webhook 設定失敗；未輸出包含 token 的請求網址")
print("設定成功" if result.get("ok") else "設定未成功，請檢查 Telegram 設定")
```

Webhook 和 `getUpdates` 不能同時用來收件。收件設定完成後，既有通知的 `sendMessage` 功能仍可使用。

## 啟用與部署

確認 vars 與所有秘密已設定，再將 `LEARNING_ENABLED` 改為 `true`。

```bash
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

正式文章庫位於 `/learning`，使用現有 RUN_TOKEN 登入。通知連結只包含文章 ID，不包含憑證。

Node 必須符合專案要求；若 shell 選到舊版，先切換至 Node 22，再執行測試。現有機器的 Node 22 安裝在 nvm 下；不修改系統 Node 或全域套件。

每天台灣時間 09:00 啟動書籤同步與補充重查。每 5 分鐘的排程恢復待處理工作、發送待通知結果與處理媒體保存期限；不會讓既有部落格 digest 每 5 分鐘執行。

## 費用與恢復

月預算為 US$30，先預留基本費 US$5，其他支出按 X 回傳資源、Gemini token 與媒體儲存估算。系統不把 UTC 日的去重計費當成可靠免費重讀。

呼叫前預留費用；成功後結算可取得的用量。無法確認是否已計費的失敗仍保留預留，避免因重試低估支出。顯示數字是控管估算，不保證等同供應商帳單。

達門檻後停止新的付費工作，但保留分享、文章、待處理項目與同步 checkpoint。下月不自動解除暫停。點「手動恢復」後，仍會檢查剩餘預算；不足時繼續保留工作。

## 來源與媒體的邊界

- 外部文章目前支援可取得的 HTML、文字與 Markdown；登入、付費、動態未呈現或非文字附件會保留錯誤／缺漏。
- 作者補充以 Full-Archive Search 查詢；權限不足或搜尋失敗會明示缺漏。父貼文與引用另外取得。
- 作者帳號依貼文 author ID 查核 username，快取 24 小時；這些使用者資源讀取也計入 X 費用。搜尋只保存與原作者 ID 相符的結果。
- 分頁請求失效時從頭核對，已保存來源不重複生成，但 X 重讀仍可能計費。授權或欄位設定錯誤時停止自動重試，待修正後手動同步。
- 影片優先選估算可落在 200 MB 內的最高 bitrate MP4，再檢查實際下載大小與 20 分鐘限制。
- 無法驗證大小、長度或格式的媒體保留待人工處理，不以預覽圖片代替整段影片。
- Gemini 影片輸入採服務預設取樣；快速畫面仍可能漏掉。程式要求有效時間點，但這不能證明內容理解正確。
- 原始媒體保留 30 天；文章、原文與解析結果持續保存。再次取得媒體可能產生新的費用。
- 通知重送會重用已保存教材，但 Telegram 與 D1 不是同一交易，回應遺失仍可能導致少量重複通知。

## 真實 API 驗證順序

1. 設定憑證後，用一個公開 X 貼文確認欄位命名與完整長文。
2. 加入一個新書籤，確認分頁、首次基線、回補確認與新增處理。
3. 分享含引用及作者補充的貼文，對照實際討論串確認缺漏。
4. 分享一張圖片與一支短影片，核對完整媒體、時間點、操作與命令拼字。
5. 對同一來源跨入口收件，確認只保留一篇教材。
6. 檢查 Telegram 收件回覆、完成通知、私人閱讀、搜尋與追問引用。
7. 在供應商控制台對照用量與系統 ledger，校正價格與預留估算。
8. 使用 30 個真正想學的收藏評估證據完整、技術正確、可讀與可應用程度。

記錄實測證據與差異，不把模擬回應當成完成此驗收。

官方依據：[Gemini Files](https://ai.google.dev/gemini-api/docs/files)、[Gemini 影片](https://ai.google.dev/gemini-api/docs/video-understanding)、[X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)、[X 計費](https://docs.x.com/x-api/getting-started/pricing)、[Telegram Bot API](https://core.telegram.org/bots/api#setwebhook)。

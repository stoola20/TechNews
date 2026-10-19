# X 收藏學習工具：設定、使用與驗證

學習流程已完成正式部署與首篇真實 API 試跑：Telegram 收件、X 主文與作者補充、3 支影片的原生處理、繁中教材生成、完成通知及單篇來源追問均已驗證。完整證據與待驗項目見 [正式環境實測紀錄](testing/learning-setup-2026-10-13.md)。

## 日常使用

1. 開啟 `https://<Worker 網址>/learning`，以 RUN_TOKEN 登入。根目錄 `/` 沒有首頁，顯示 `Not Found` 是正常的；`/health` 可檢查服務。
2. 將連結傳到允許收件的 Telegram 私聊／頻道，或在文章庫輸入連結並按「加入文章庫」。Telegram 收件成功時會先回覆已保存，處理完成後再送導讀與文章連結。
3. 在文章庫閱讀教材與原始來源，核對來源缺漏及媒體時間點。可搜尋、標記已讀、保存筆記，並選擇目前文章或整個文章庫進行來源追問；追問會呼叫 Gemini，依用量計費。
4. 列表預設依原文發表時間由新到舊、依發表日分組；排序可切換成加入時間。沒有發表時間的文章以加入時間排入，並標示「日期未知・加入於 M/D」。列表頂端的主題 chip 可篩選主題，與搜尋、未讀並用；收件入口與處理狀態在「管理篩選」。
5. X 書籤同步與作者補充重查預設關閉，只在你主動分享 X 連結時讀取 X，見「[X 讀取範圍](#x-讀取範圍)」。在管理頁開啟後，新書籤每 10 分鐘局部檢查列表最前面一頁，每天台灣時間 08:00 另做完整核對，也可按「同步／續跑書籤」手動啟動。首次既有書籤先等待確認；「整理已取得的既有書籤」會開始整批回補，並非只處理目前選取的一篇。

按鈕請求期間顯示 loading 圖示與操作文字，避免同一按鈕重複送出。書籤背景同步中會每 5 秒更新進度，切換到背景分頁時停止輪詢；教材整理或媒體處理可能繼續在背景執行，按鈕恢復不代表教材已完成。成功與錯誤提示顯示在頁面上方。

RUN_TOKEN 若保存為本機 `.cloud-run-token`，檔案位於專案根目錄；本機 webhook secret 可保存在 `cloud-digest/.dev.vars`。這些檔案已由 git 排除，憑證值不得寫入公開文件或提交。Cloudflare 遠端 secret 無法透過 `secret list` 取回原值；不要為找回登入憑證直接重設 RUN_TOKEN，它也用於解密已保存的 X 授權。

## 本機閱讀與操作示範

在 `cloud-digest` 使用 Node 22.13 或更新版本執行：

```bash
node scripts/learning-demo.mjs
```

開啟 [本機示範](http://localhost:8788/learning)，以 `demo-only` 登入。示範使用記憶體資料庫與固定測試來源，模型與通知都是模擬回應，不會讀取金鑰或呼叫外部服務。關閉程序後示範資料會消失。

可驗證登入、加入連結、完整閱讀、搜尋、已讀、筆記與追問。示範不能驗證 Gemini 的文章品質、X 授權與來源完整度。

## 建立 Cloudflare 資源

在 `cloud-digest` 使用現有 Cloudflare 帳號與已安裝的 Wrangler。目前先使用 Workers Free 小量實測，設定 `LEARNING_BASE_USD=0`；升級 Workers Paid 後改為 `5`，納入每月基本費估算。Free 支援 Queue，每日含 10,000 次操作、訊息保留 24 小時；HTTP 與 Cron 的 CPU 限制為每次 10 ms，解析長文章是否足夠需實測，等待外部 API 不計入 CPU 時間。

官方額度：[Queues](https://developers.cloudflare.com/queues/platform/pricing/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)。Cloudflare Free 不代表 X、Gemini 或超出 R2 免費額度的用量免付費。

```bash
npx wrangler queues create technews-learning-jobs
npx wrangler r2 bucket create technews-learning-media
npx wrangler d1 migrations apply developer-digest-cloud --remote
```

資源名稱已在 Worker 設定中定義。若同名資源已存在，確認它是此專案的資源後重用，不刪除或覆蓋其他用途的資料。migration 只新增學習流程資料表。

R2 建立指令若詢問是否自動加入設定檔，已設定 `MEDIA` binding 的專案選 `n`，避免新增不同名稱的 binding。R2 採 Standard 儲存，每月包含 10 GB-month 免費額度，與同帳號其他 bucket 共用；超出額度另計費。[官方價格](https://developers.cloudflare.com/r2/pricing/)。

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

若 Console 已自動建立 App，可直接沿用。App permissions 選 `Read`；Type of App 選 `Web App, Automated App or Bot`；Website URL 填正式 Worker 的 HTTPS origin。程式使用 OAuth 2.0 的 Client ID 與 Client Secret，不是 OAuth 1.0 的 Consumer Key、Access Token 或 App-only Bearer Token。

程式要求 `bookmark.read tweet.read users.read offline.access`。`offline.access` 用於刷新授權；OAuth token 以 RUN_TOKEN 衍生的金鑰加密後保存在 D1，不回傳前端。

```bash
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET
```

以 Cloudflare Secret 設定 `PUBLIC_BASE_URL`，值為正式 Worker 的 HTTPS origin，不包含 `/learning`、金鑰或登入憑證。個人部署設定不寫入公開的 `wrangler.jsonc`：

```bash
npx wrangler secret put PUBLIC_BASE_URL
```

登入文章庫後選「連接 X」。完成後，首次掃描建立待確認的既有書籤清單，預覽也會產生讀取費。未掃完時，顯示的是已取得數量；無法可靠區分初次掃描期間新增與原本已有的書籤。

確認 App owner 與授權使用者是同一人後，可設定 `X_APP_OWNER_ID` 為該使用者 ID，啟用 Owned Reads 的估算單價。未設定或 ID 不符時，程式保守採一般貼文單價；不能因使用書籤端點就假定符合較低價格。

目前 X 官方文件的欄位名稱有 `post.fields` 與 `tweet.fields` 差異。預設 `X_API_FIELDS_STYLE=post`，輸入正規化相容兩種回應。若真實 API 契約驗證顯示需要舊命名，改為 `tweet` 後重新部署；不要把 HTTP 錯誤視為沒有作者補充。

連接 X 前，先在 Console 的 Credits 頁面確認餘額；試跑可將 Billing Cycle Cap 設為 US$5，Auto Recharge 保持 Off。供應商端上限與文章庫的 US$30 總預算分開運作。首次授權會立即啟動既有書籤掃描，即使尚未回補，仍會產生讀取費。來源失效、權限不足或 API 不提供的內容，會保留缺漏，不繞過登入或來源限制。

## Telegram 收件與通知

通知沿用既有 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_CHAT_ID`。收件可在 bot 私聊或指定 chat 進行，和通知目的地可以不同。

通知規則：

- 官方、書籤、Telegram 與網站分享都一樣：文章詳細整理完成後立即逐篇通知，不再每日或每半小時集中。
- 通知只有精簡介紹、必要的缺漏提示與完整文章連結，不是全文。
- 同一篇文章的同一個版本只通知一次，不論從幾個入口收到。
- 在 Telegram 再分享已完成的連結，收件回覆會直接附上既有文章入口；處理中的連結回覆目前狀態。
- 作者補充在 24 小時後重查一次（目前已停用，見「[X 讀取範圍](#x-讀取範圍)」）。來源沒有變化就沿用原文章，不生成也不通知；有新補充或修復缺漏時更新同一篇、保留舊版與筆記，並發一則標示「【更新】」的通知。只換模型或提示版本、內容相同的重寫不發通知。
- 通知失敗時只重送已保存的內容，不重新生成。
- 官方來源連續兩次檢查失敗（包括列表抓不到任何文章）時，另外發一則「【來源異常】」提醒，附最近一次原因與管理頁連結。恢復前不重發，恢復時不通知，之後再故障會重新提醒。

先用互動方式設定新的 webhook secret：

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

以 Cloudflare Secret 設定 `TELEGRAM_ALLOWED_CHAT_IDS`，填入允許收件的數字 chat ID，多個 ID 用逗號分隔。個人的頻道 ID 不寫入公開設定檔：

```bash
npx wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
```

頻道 ID 通常以 `-100` 開頭；通知目的地可以使用 `@username`，但收件 allowlist 要與 update 的數字 ID 一致。不要預設公開接受所有使用者。

頻道貼文可能以頻道身分顯示，程式依 `chat.id` 與 webhook secret 驗證，不依個人傳送者名稱決定是否接受。bot 必須是該頻道管理員；收件與通知沿用同一頻道時，通知權限也需保留。

部署後，以 Telegram Bot API `setWebhook` 指向：

```text
https://<Worker 網址>/learning/telegram
```

同時設定與 Worker 完全一致的 `secret_token`，以及 `allowed_updates` 為 `message`、`channel_post`、`callback_query`。`callback_query` 是完成通知上「保留」「保留並 ★」「刪除」按鈕的回呼；沒有加入時按鈕會一直轉圈，文章庫不會收到。兩邊使用同一份保存的值，不要各自產生一份。輪替時必須同步更新 Worker 與 Telegram，避免待送訊息持續驗證失敗。以下本機設定程序從互動輸入取得 Bot token 與 webhook secret，不把它們放進命令參數或文件：

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
    "allowed_updates": ["message", "channel_post", "callback_query"],
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

篩選按鈕只接受 `TELEGRAM_CHAT_ID`（通知頻道）或 `TELEGRAM_ALLOWED_CHAT_IDS` 裡的對話；其他對話按下時回 200 並忽略。通知頻道若是頻道，能看到頻道訊息的人都能按按鈕，請不要把通知頻道公開。

`setWebhook` 成功只表示 Telegram 接受設定，不能證明 Worker 已接受 secret。啟用後需透過真實分享確認收件回覆、文章庫紀錄與完成通知；更新 webhook 時不要為排除錯誤直接丟棄待送更新。

## 啟用與部署

確認 vars 與所有秘密已設定後再部署。一般部署會保留已設定的 Cloudflare Secrets；本機 `.dev.vars` 不會自動上傳。

```bash
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

正式文章庫位於 `/learning`，使用現有 RUN_TOKEN 登入。通知連結只包含文章 ID，不包含憑證。

Node 必須符合專案要求；若 shell 選到舊版，先切換至 Node 22，再執行測試。現有機器的 Node 22 安裝在 nvm 下；不修改系統 Node 或全域套件。

每天台灣時間 08:00 開始官方來源整理、書籤完整核對與補充重查（08:00 是開始時間，不是完成時間）。每 10 分鐘做一次書籤局部檢查。

### X 讀取範圍

X 讀取按次計費。預設只在你主動分享 X 連結（Telegram 或網站）時讀取：主文、作者在同一串的補充、引用與作者帳號。下面兩項在 `/learning/admin` 的「X 書籤同步」區塊切換，保存在 D1，切換後立即生效，不需要重新部署：

| 開關 | 預設 | 關閉時的行為 |
|---|---|---|
| 書籤同步 | 關閉 | 不做局部檢查、完整核對與續跑；手動「同步／續跑書籤」、重新連接 X 都不讀書籤。已保存的待回補書籤仍可逐篇整理 |
| 作者重查 | 關閉 | 分享後不再於 24 小時後重查作者補充；之後才補的內容不會自動併入，重新分享同一連結也不會重抓 |

官方文章與 Telegram 收件不受影響。

書籤有兩種掃描，各自保存進度與時間：

- 局部檢查：每 10 分鐘讀列表最前面 `X_PARTIAL_PAGES` 頁（預設 1 頁）、每頁最多 `X_PARTIAL_MAX_RESULTS` 筆（預設 100）。它不是完整的增量同步，也不會把完整核對標成成功。首次基線完成前不執行。
- 完整核對：每天 08:00 開始，逐頁保存游標直到沒有下一頁。遇到已知書籤或不足 100 筆的頁面都不會提前結束。已在進行時，重疊的排程沿用原本的游標。
- 收藏一則很舊的貼文時，它可能排在列表後面，要等每日完整核對才會出現。這是成本與完整度的取捨。
- 限流時保存游標，15 分鐘後從同一頁續跑；游標失效時下次從頭核對；授權失效時兩種掃描都停止並標示需要處理；費用暫停時不讀取並保留狀態。
- 同一 UTC 日重讀同一批書籤的費用處理見「X 讀取怎麼估」。每 5 分鐘的維護排程內容見[架構](architecture.md#維護排程)。

## 逐篇檢查既有書籤

在文章列表的「顯示範圍」選擇「等待確認回補」，即可先看已保存的原文片段。點開文章可閱讀完整的已保存主文，並透過「開啟原始來源」查看 X 的最新原文、圖片與影片；這時尚未啟動模型整理。

- 按「開始整理這篇」只啟動目前這篇，不會核准其他待回補收藏；模型呼叫會產生費用。
- 按「刪除這篇待回補」會移除這篇的已保存原文、媒體紀錄、筆記與收件資料，並從列表隱藏。保留最少的網址識別紀錄，避免下次同步又自動加回來；重新手動分享同一網址可再次收件。
- 「整理全部待回補書籤」仍保留在 X 服務設定中，按下後須再確認，避免誤啟動整批。

閱讀已保存原文不會額外呼叫 X 或 Gemini；重新同步書籤仍可能產生 X 讀取費。尚未保存原文的項目會明確提示改開原始來源。教材與追問答案會將 Markdown 渲染成標題、列表、表格與程式碼區塊，並移除可執行的 HTML。

## 主題分類

每篇已完成的文章會有 1 個主要主題，最多再加 1 個次要主題。文章寫完就用 Workers AI Gemma 4（`@cf/google/gemma-4-26b-a4b-it`）讀標題與導讀，從主題表中選擇，再發通知；通知第一行是主題標籤（例如 `#iOS_Apple_開發`，名稱裡 hashtag 不接受的字元換成底線）。分類失敗時通知照常發出、不附主題。每 5 分鐘的維護排程負責重試、重新分類全部與尚未分類的既有文章，每輪最多 10 篇，新加入的先處理。

- 新文章完成後數分鐘內就有主題；既有文章由同一步驟逐輪回補，不需要手動觸發。
- 文章內容更新（revision 增加）後重新分類。
- 使用 Workers AI 免費額度，不記入月預算，不經過 Mac，也不發通知。
- 模型回傳不在主題表中的結果時視為失敗，延後重試；連續 5 次失敗後停在「未分類」，直到內容更新或重新分類全部。
- 閱讀頁可按「修改主題」手動選擇主要與次要主題。手動設定的文章不會被自動分類覆寫；按「改回自動分類」交還給下一輪維護排程。

主題表在 `/learning/admin` 的「主題表」維護，預設 7 個主題，最多 20 個。名稱與說明會送給分類模型參考。

- 改名、修改說明或顏色：主題識別碼不變，已分類的文章不受影響。
- 刪除主題：以它為主要主題的文章清除主題（包含手動設定）並重新分類；只把它當次要主題的文章移除次要主題。
- 新增主題：不會自動重分。按「重新分類全部」後，非手動設定的文章會逐輪重新分類，完成前保留目前主題。

## 官方文章進入共同文章庫

08:00 的官方排程只負責「發現新文章並排入文章庫」，再由目前的文字模型（Gemini 或本機 Gemma）詳細整理：

- 只收發表 7 天內的文章；細節見 [`SOURCES.md`](../cloud-digest/SOURCES.md)。
- 每篇新官方文章都建立工作，沒有單次篇數上限。沒處理完的文章由背景工作與 Mac 持續消化，不用等到隔天。
- 原文沿用官方擷取規則（含官方 Markdown 與瀏覽器備援），只取全文文字，不抓圖片或影片。
- 文字模型先依「想收到的內容」（管理頁「官方來源」區塊）判斷主題。不符合的文章標為「主題不符・已略過」，不發通知，預設列表也不顯示。
- 同一篇被你主動分享時，不套用主題篩選；被略過的文章會重新完整整理，已完成的文章直接回到既有入口。
- 重複觸發同一天的排程，不會新增收件或重新生成。

## 切換到本機 Gemma

依序進行；任何一步沒通過就停在切換前，既有 Gemini 路徑仍可運作。

1. 套用新 migration 再部署：`npx wrangler d1 migrations apply developer-digest-cloud --remote`，然後 `npx wrangler deploy`。新 Cron（08:00 官方與完整核對、每 10 分鐘局部檢查、每 5 分鐘維護）隨部署生效。
2. 在管理頁「維運」按「執行舊資料整理」，把舊官方導讀搬進文章庫並標成「既有導讀」，不呼叫模型、不發通知。維護排程不會自動搬移。
3. 設定執行器憑證：`npx wrangler secret put LEARNING_RUNNER_TOKEN`。不要重用 `RUN_TOKEN`；新增這個憑證不會影響既有登入與 X 授權加密。
4. 在 Mac 上設定 Ollama 與執行器，見 [Mac 本機文字執行器](../cloud-digest/runner/README.md)。`runner.mjs --check` 通過後再用 `install-launchd.sh` 常駐。
5. 在 Mac 上跑代表素材驗收：`node scripts/acceptance.mjs --ctx <選定值>`。重大事實錯誤、捏造引用或未標示缺漏都不能通過。結果紀錄見[驗收紀錄](testing/unified-learning-acceptance-2026-10-17.md)。
6. 先用網站加入幾篇真實文章比較兩條路徑，再到 `/learning/admin` 按「改用本機 Gemma」。
7. 切換後確認：管理頁顯示 Mac 在線、工作有被領取；Telegram 收到逐篇完成通知；追問能回覆。

回退：在管理頁按「改回 Gemini」。已完成的文章、筆記與通知紀錄不受影響；等待本機的工作會留在佇列，Mac 恢復後或下次切回本機時繼續。

## 費用與恢復

統一流程的雲端預算是每個台灣曆月 US$30，包含 X 讀取、Gemini（媒體解析與切換前的寫作）、R2 保存與 `LEARNING_BASE_USD` 預留的基本費（目前 Free 設為 US$0，未指定時預設 US$5）。Mac 電費不計入。舊資料搬移不會再計一次費用。

呼叫付費服務前先預留費用，成功後依回傳用量結算；無法確認是否已計費的失敗保留為「未確認」。顯示數字是控管估算，不等同供應商帳單。

管理頁預算區塊逐筆列出本月的未確認費用（時間、類別、金額、情境）。核對供應商後台後，可按「作廢」並寫下說明：作廢的費用不算進月預算與預留檢查，但保留金額、作廢時間與說明，列在「已作廢」明細。作廢不會自動恢復處理。升級到這個版本時，既有的 X 未確認費用（失敗呼叫的預留與重讀風險估算）會一次作廢。

### X 讀取怎麼估

計價依據（查核日 2026-10-16，[X API pricing](https://docs.x.com/x-api/getting-started/pricing)）：Post 讀取 US$0.005、User 讀取 US$0.010、Owned Reads US$0.001。單價可用 `X_POST_READ_USD`、`X_USER_READ_USD`、`X_OWNED_READ_USD` 覆寫；價格變動時請更新並記錄查核日（`X_PRICING_CHECKED_AT`）。

- Owned Reads 只用在官方列出的自身資源端點（例如 `/users/{id}/bookmarks`），且 `X_APP_OWNER_ID` 必須等於已連接的帳號。不符合時一律用一般費率。
- 同一資源在同一個 UTC 日第一次讀取，以全額計入。
- 同一 UTC 日再次讀到同一資源不計費，記 $0。官方說明這是 soft guarantee；若帳單有出入，用人工核對調整修正。
- X 回錯誤（非 2xx，例如 429、503、401）時沒有讀到資料，那次呼叫記 $0，狀態為「失敗」。管理頁預算區塊顯示「X 失敗呼叫：本月 N 次，未計費」與最近一次的狀態碼和情境，可展開看每次的時間、讀取類型、狀態碼與情境（書籤同步、整理貼文、作者補充等）。
- 沒收到回應（逾時、連線中斷），或收到 2xx 後處理失敗（內容過大、無法解析）時，X 可能已經計費，保留預留金額並列為「未確認」。
- 預算月份依台灣時間；X 去重依 UTC 日。兩者分開計算。
- 與 X Developer Console 或 Google 帳單核對後，可用 `POST /learning/api/admin/budget-adjust`（`category`、`amount_usd`，可為負數、`note` 必填）記錄人工修正。

### 兩種暫停

| | 費用暫停 | 手動暫停 |
|---|---|---|
| 觸發 | 預留會超過月預算 | 按「暫停全部處理」 |
| 付費呼叫（X、Gemini、R2 下載） | 停止 | 停止 |
| 已取得證據的 Mac 文字工作與追問 | 繼續 | 停止 |
| 收件、閱讀、筆記、重送已保存通知 | 繼續 | 收件與閱讀繼續 |
| 下個月 | 不自動恢復 | 不自動恢復 |

「恢復處理」按鈕只在暫停時出現，旁邊寫出暫停原因，以及按下會做什麼：解除暫停、把暫停中的文章重新排隊、續跑書籤同步；不會處理未確認費用。恢復時仍會檢查剩餘預算：剩餘為 0 時恢復失敗，提示先作廢未確認費用或調整月預算，工作繼續保留。

## 故障處理

| 現象 | 檢查與處理 |
| --- | --- |
| Worker 根目錄顯示 `Not Found` | 開啟 `/learning`，並以 `/health` 確認服務；根目錄沒有首頁 |
| Telegram 沒有收件回覆、文章庫也沒有來源 | 用 `getWebhookInfo` 查待送數量與錯誤；不要先重貼連結或重跑模型 |
| Webhook 回傳 404 | 核對目的地 `/learning/telegram` 與兩邊的 webhook secret；驗證不符時程式回傳 404 |
| Webhook 成功，但頻道訊息未收件 | 核對數字 chat ID、`channel_post` 收件類型，以及 bot 是否已加入該頻道 |
| 文章仍顯示等待／處理中 | 查看來源、媒體與錯誤狀態；影片可能等待 Gemini Files 處理，背景工作會保留進度 |
| X 同步需要手動處理 | 核對授權、credits 與欄位設定，修正後按「同步／續跑書籤」；必要時重新連接 X |
| 出現 `Exceeded CPU Time Limits`／1102 | 依實際素材評估 Free 是否足夠，再決定是否升級 Paid；升級後將 `LEARNING_BASE_USD` 改為 `5` |

排查時先讀取已保存狀態與供應商錯誤，不在日誌、終端機參數或公開文件輸出 token、請求憑證或含憑證的網址。

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

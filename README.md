# Developer Digest

每天自動追蹤開發者技術部落格的新文章，整理成繁體中文摘要並推送到你的 Telegram 頻道。另附一套 Python + PostgreSQL（pgvector）的 RAG 問答服務，可以對文章提問。

目前追蹤的來源（白名單規則見 [`cloud-digest/SOURCES.md`](cloud-digest/SOURCES.md)）：

| 來源 | 入口 |
| --- | --- |
| OpenAI Developer Blog | https://developers.openai.com/blog |
| Apple Developer News | https://developer.apple.com/news/rss/news.rss |
| Claude Blog | https://claude.com/blog |

每篇新文章會在頻道收到兩則訊息：

1. **靜音的完整摘要**：繁中摘要、技術重點、關鍵字與原文連結，當作頻道內可搜尋的存檔。
2. **正常通知**：「有新文章」加上 3～5 個重點，手機會跳通知。

沒有新文章時不會發送任何訊息。

## 專案結構

| 目錄 | 用途 | 需要什麼 |
| --- | --- | --- |
| [`cloud-digest/`](cloud-digest/) | **建議使用。** Cloudflare Worker，每天台北時間 09:00 由 Cron 觸發，用 Workers AI 摘要並推送 Telegram | Cloudflare 帳號（免費方案即可）、Node.js |
| [`app/digest/`](app/digest/)、[`digest/`](digest/README.md) | 本機版：把摘要存成 Markdown，再用 CLI 推送 Telegram | Python 3.12+、`uv` |
| [`app/`](app/) 其餘部分 | 選用：FastAPI + pgvector 的 RAG 問答 | PostgreSQL + pgvector、OpenAI API 金鑰 |

只想收 Telegram 通知的話，照「快速開始」做完就夠了，不需要資料庫或 OpenAI 金鑰。

---

## 快速開始：部署到 Cloudflare 並接上你的 Telegram

### 1. 建立 Telegram bot 與頻道

1. 在 Telegram 找 [@BotFather](https://t.me/BotFather)，傳送 `/newbot`，依指示命名後會拿到一組 **bot token**（格式類似 `123456789:AA...`）。
2. 建立一個頻道（公開或私人都可以），或使用現有頻道。
3. 進入頻道資訊 →「管理員」→ 新增管理員，搜尋你的 bot 加進去，並開啟「**發佈訊息**」權限。
   > 只在貼文中提及 `@你的bot` 並不會把它加入頻道，一定要加為管理員。

### 2. 取得頻道的 chat ID

- **公開頻道**：直接用 `@頻道帳號` 當作 chat ID，例如 `@my_dev_digest`。
- **私人頻道**：需要數字 ID（通常是 `-100` 開頭）。在 bot 成為管理員**之後**，先到頻道貼一則任意訊息，再執行：

  ```bash
  curl -s "https://api.telegram.org/bot<你的BOT_TOKEN>/getUpdates"
  ```

  在回傳的 JSON 中找 `"channel_post"` → `"chat"` → `"id"`，那串數字就是 chat ID。若結果是空的，再貼一則新訊息後重試。

  已經裝好 Python 環境的話，也可以用本專案的 CLI 列出（見下方「本機版」）。

> Bot token 等同密碼，不要提交到 git，也不要貼到公開場合。外洩時可到 @BotFather 用 `/revoke` 重新產生。

### 3. 安裝依賴並登入 Cloudflare

```bash
git clone https://github.com/stoola20/TechNews.git
cd TechNews/cloud-digest
npm install
npx wrangler login
```

### 4. 建立 D1 資料庫

```bash
npx wrangler d1 create developer-digest-cloud
```

指令會輸出一組 `database_id`。打開 [`cloud-digest/wrangler.jsonc`](cloud-digest/wrangler.jsonc)，把 `d1_databases[0].database_id` **換成你自己的 ID**（repo 內的是作者帳號的 ID，你的帳號無法使用）。

接著建立資料表：

```bash
npx wrangler d1 migrations apply developer-digest-cloud --remote
```

### 5. 設定 secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put RUN_TOKEN
```

每個指令執行後，依提示貼上對應的值：

| Secret | 值 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 步驟 1 拿到的 bot token |
| `TELEGRAM_CHAT_ID` | 步驟 2 的 `@頻道帳號` 或數字 ID |
| `RUN_TOKEN` | 自訂的隨機字串，用來保護手動觸發的 API，可用 `openssl rand -base64 32` 產生 |

### 6. 部署

```bash
npx wrangler deploy
```

部署完成後會顯示 Worker 網址（`https://developer-digest-cloud.<你的子網域>.workers.dev`）。Cron 已設定為每天 `01:00 UTC`（台北時間 09:00）自動執行。

### 7. 手動執行一次，確認 Telegram 有收到

```bash
curl -X POST \
  -H "Authorization: Bearer <你的RUN_TOKEN>" \
  https://developer-digest-cloud.<你的子網域>.workers.dev/run
```

**第一次執行**時，每個來源會挑最新一篇送出（共三篇），其餘既有文章只記錄網址當作去重基準，不會通知。之後每天只推送新文章。

### Worker 提供的端點

| 端點 | 驗證 | 說明 |
| --- | --- | --- |
| `GET /health` | 不需要 | 健康檢查 |
| `POST /run` | `Authorization: Bearer <RUN_TOKEN>` | 立即執行一次 digest（與 Cron 相同流程） |
| `GET /preview?source=<id>` | `Authorization: Bearer <RUN_TOKEN>` | 摘要該來源最新一篇，只回傳 JSON、不發 Telegram。`id` 為 `openai_developer_blog`、`apple_developer_news` 或 `claude_blog` |

未帶正確 token 的請求一律回 404。

### 自訂

- **修改推送時間**：編輯 `wrangler.jsonc` 的 `triggers.crons`（UTC 時間），再重新 `npx wrangler deploy`。
- **新增或移除來源**：修改 [`cloud-digest/src/sources.js`](cloud-digest/src/sources.js) 的 `SOURCES`，並確認擷取規則支援該網站格式。
- **更換摘要模型**：修改 [`cloud-digest/src/index.js`](cloud-digest/src/index.js) 的 `MODEL`（Workers AI 模型 ID）。
- **查看執行紀錄**：`npx wrangler tail`，或到 Cloudflare Dashboard → Workers → Observability。

### 執行測試

```bash
cd cloud-digest
npm test
```

---

## 本機版：Markdown 存檔 + Telegram CLI

適合想把摘要以 Markdown 存在 repo 裡（[`digest/`](digest/README.md)），或自行搭配排程工具（cron、launchd、AI agent 等）產生摘要的情況。這個版本只負責**發送**，摘要內容要由你的排程流程依 [`digest/TEMPLATE.md`](digest/TEMPLATE.md) 產生。

```bash
uv sync --extra test
cp .env.example .env
```

在 `.env` 中填入 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_CHAT_ID`（取得方式同上；`.env` 已列入 `.gitignore`）。

```bash
# 列出 bot 最近看得到的頻道與數字 ID（私人頻道用）
uv run python -m app.digest.telegram --list-chats

# 發送測試訊息：先一則靜音摘要，再一則正常通知
uv run python -m app.digest.telegram --test

# 發送實際摘要：summary 以靜音訊息送出（過長會自動分段），alert 以正常通知送出
uv run python -m app.digest.telegram --summary-file summary.md --alert-file alert.txt
```

---

## 選用：RAG 問答服務

用 FastAPI 提供 `/ingest`（匯入 OpenAI Developer Blog 文章並產生向量）與 `/ask`（語意檢索後由 LLM 回答並附引用）。只收通知的話不需要這部分。

### 需求

- Python 3.12+ 與 `uv`
- PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)（以下用 Docker 示範；macOS 也可以用 [Apple Container](https://github.com/apple/container)，指令幾乎相同，把 `docker` 換成 `container`）
- OpenAI API 金鑰

### 設定與啟動

```bash
cp .env.example .env        # 填入 OPENAI_API_KEY
cp .db.env.example .db.env
uv sync --extra test

docker volume create developer-kb-pgdata
docker run --detach --name developer-kb-db \
  --env-file .db.env \
  --publish 127.0.0.1:5432:5432 \
  --volume developer-kb-pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:pg17

uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

範例設定使用僅供本機開發的資料庫帳密。若修改 `.db.env` 的 `POSTGRES_PASSWORD`，也要同步修改 `.env` 中 `DATABASE_URL` 的密碼。

### 使用

```bash
# 匯入文章（會呼叫 OpenAI 產生向量，有 API 費用）
curl -X POST http://127.0.0.1:8000/ingest

# 列出已匯入的文章
curl http://127.0.0.1:8000/articles

# 提問
curl -X POST http://127.0.0.1:8000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"OpenAI 最近對 Codex 做了哪些改動？"}'
```

`/ask` 回傳 `answer` 與 `sources`（標題、原文網址、片段位置、相似度）。API 文件在 http://127.0.0.1:8000/docs 。

### 運作方式

發現文章網址 → 擷取內文 → 計算內容雜湊（未變動則略過）→ 切片（預設約 800 token、重疊 120）→ 產生 embedding → 存入 PostgreSQL。提問時以 pgvector 餘弦相似度取前 `RAG_TOP_K` 個片段，交給模型回答並標註引用；資訊不足時會回覆無法確認。

可調整的設定見 [`.env.example`](.env.example)。變更 `EMBEDDING_DIMENSIONS` 需要資料庫遷移；更換 embedding 模型則要重新產生所有片段的向量。

### 測試

```bash
uv run pytest -q
```

測試會模擬外部網站、OpenAI 與 Telegram 回應，不需要真實的 API 金鑰。

> 這是給個人本機使用的服務，沒有身分驗證，請讓 API 與資料庫只監聽 `127.0.0.1`。

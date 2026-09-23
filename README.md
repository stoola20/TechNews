# 個人開發者知識庫

這個專案會追蹤 [OpenAI Developer Blog](https://developers.openai.com/blog) 的新文章，整理繁體中文摘要並傳送 Telegram 通知，同時保存可回查的 Markdown 檔案。另有 Python、FastAPI、PostgreSQL、pgvector 與 OpenAI API 的 RAG 問答功能，但通知流程不需要啟用它。這個版本尚未加入知識圖譜。

## 先使用：Developer Digest 與 Telegram 通知

目前最直接的使用方式是每天上午 9 點檢查新文章、整理成繁體中文，將完整摘要存到 [`digest/`](digest/README.md)，並送到你的 Telegram 頻道。每篇文章會先在頻道存一則靜音的完整摘要，再送一則含 3～5 個重點的正常通知。因此 Telegram 頻道本身也能用手機回頭搜尋。這條流程**不需要** PostgreSQL、Apple Container、RAG 或 OpenAI API 金鑰；下面的資料庫與 API 步驟是之後想用 RAG 問答時才需要的。

已建立目前部落格文章的去重基準與[一篇繁中範例](digest/articles/2026-09-11-rethinking-skills-and-prompts-for-gpt-6-astra.md)。每天台北時間上午 9 點的排程已啟用；Telegram 設定尚未填好時，排程會安靜略過，不會把新文章誤記為已通知。填好後從下一次排程開始運作。這是讀取本機檔案的排程，Mac 必須開機且 Codex 桌面 App 持續運作，才能準時執行。

### 設定 Telegram 頻道

1. 在 Telegram 找 [@BotFather](https://t.me/BotFather)，傳送 `/newbot`，依指示建立 bot，取得 token。這一步必須由你在 Telegram 完成。
2. 建立或選擇要收通知的頻道，到頻道資訊的「管理員」名單把新 bot 加進去，開啟「發佈訊息」權限。只在貼文寫 `@bot帳號` 不等於加入管理員。頻道可以是公開或私人。
3. 在本專案的 `.env` 中填入 `TELEGRAM_BOT_TOKEN=你的token`。公開頻道可直接填 `TELEGRAM_CHAT_ID=@頻道帳號`。這兩個值不要貼到對話中。
4. 私人頻道沒有公開帳號時，**在 bot 加入管理員之後**於頻道貼一則新訊息，再執行 `uv run python -m app.digest.telegram --list-chats`，把列出的數字 ID 填入 `.env` 的 `TELEGRAM_CHAT_ID`。
5. 執行 `uv run python -m app.digest.telegram --test`。頻道應先收到一則靜音測試摘要，再收到一則正常測試通知。確認收到後就完成設定，不需要重新建立排程。

`.env` 已列入 `.gitignore`。Bot token 是密鑰，只保存在本機。Telegram 頻道與本機 Markdown 都會保存之後的新文章；沒有新文章時不會發訊息。

## 可選：啟用資料庫與 RAG 問答

以下段落只在你想使用 `/ingest`、`/ask` 和 pgvector 語意搜尋時才需要。

### 開始前需要什麼

- Apple Silicon Mac，macOS 26 或更新版本。
- Python 3.12 以上與 `uv`。
- [Apple Container](https://github.com/apple/container)：用來執行已包含 pgvector 的 PostgreSQL 資料庫。
- 你自己的 OpenAI API 金鑰：匯入文章時產生向量，以及回答問題時都會用到。

Python 套件由 `uv` 安裝到專案的 `.venv`。資料庫則在 Apple Container 中執行；兩者會透過本機的 `127.0.0.1:5432` 連線。

## 第一次使用

以下指令都要在本專案目錄執行：

```bash
cd /Users/chenyingxun/Developer/TechNews
```

### 1. 安裝並啟動 Apple Container

從 [Apple Container 官方發行頁](https://github.com/apple/container/releases) 下載有簽署的 `installer-signed.pkg`，開啟安裝程式並輸入 Mac 的管理員密碼。安裝後執行：

```bash
container system start
```

這個步驟只要安裝一次；往後通常只需要啟動資料庫容器。

### 2. 建立設定檔並填入 API 金鑰

```bash
test -f .env || cp .env.example .env
test -f .db.env || cp .db.env.example .db.env
```

前往 [OpenAI API 金鑰頁](https://platform.openai.com/api-keys) 建立金鑰。用文字編輯器開啟 `.env`，把 `OPENAI_API_KEY=` 改為你的金鑰，例如 `OPENAI_API_KEY=你的金鑰`。金鑰不要貼進程式碼或提交到版本控制；`.env` 和 `.db.env` 已列入 `.gitignore`。

範例設定使用僅供本機開發的資料庫帳號與密碼。如果你修改 `.db.env` 裡的 `POSTGRES_PASSWORD`，也要同步修改 `.env` 裡 `DATABASE_URL` 的密碼。資料庫第一次建立後，單純修改設定檔不會變更資料庫內已建立帳號的密碼。

### 3. 安裝 Python 套件

```bash
uv sync --extra test
```

### 4. 建立資料卷並啟動資料庫

第一次啟動時執行：

```bash
container volume create developer-kb-pgdata
container run --detach --name developer-kb-db \
  --env-file .db.env \
  --publish 127.0.0.1:5432:5432 \
  --volume developer-kb-pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:pg17
container exec developer-kb-db pg_isready -U knowledge -d knowledge
```

如果最後一行顯示資料庫還在啟動，等幾秒再執行一次 `pg_isready` 指令。`developer-kb-pgdata` 會保存資料；停止容器不會刪除文章。`.db.env` 的 `PGDATA` 會讓 PostgreSQL 使用資料卷內的子目錄，避開資料卷根目錄的 `lost+found`。

### 5. 建立資料表並啟動 API

```bash
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

第二行會持續執行服務。看到啟動完成訊息後，可在瀏覽器打開 [API 文件](http://127.0.0.1:8000/docs)，或另外開一個終端機執行下面的範例。

## 匯入文章與提問

先匯入文章；第一次執行會下載文章並呼叫 OpenAI 產生向量，可能需要一些時間與 API 費用。

```bash
curl -X POST http://127.0.0.1:8000/ingest
```

查看已匯入文章：

```bash
curl http://127.0.0.1:8000/articles
```

提出問題：

```bash
curl -X POST http://127.0.0.1:8000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"OpenAI 最近對 Codex 做了哪些改動？"}'
```

`/ask` 會回傳 `answer` 與 `sources`；`sources` 包含文章標題、原文網址、片段位置及相似度分數。`/ingest` 會回傳發現、首次匯入、更新的文章數與建立的片段數。再次執行時，內容未變的文章不會重複建立片段。

## 下次啟動、停止及排錯

下次使用時，先啟動 Apple Container 服務，再啟動既有資料庫容器與 API：

```bash
container system start
container start developer-kb-db
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

停止 API 時按 `Ctrl+C`；停止資料庫時執行 `container stop developer-kb-db`。若資料庫啟動失敗，用 `container logs developer-kb-db` 查看訊息。可用 `container exec developer-kb-db pg_isready -U knowledge -d knowledge` 確認資料庫是否可連線。

如果埠 `5432` 已被其他 PostgreSQL 服務使用，請先停止該服務，或同時修改容器的 `--publish` 主機埠與 `.env` 中的 `DATABASE_URL`。

## 架構與設定

匯入流程是：發現文章網址 → 擷取內文與中繼資料 → 計算內容雜湊 → 切成片段 → 呼叫 OpenAI 產生向量 → 存入 PostgreSQL。內容雜湊相同的文章會略過；更新文章及替換片段會在同一個資料庫交易中完成。搜尋時，系統用 pgvector 的餘弦相似度排序片段，再讓 OpenAI 模型依片段回答並標註引用。若找不到足夠資訊，會回覆無法確認。

`.env.example` 列出可調整的 `DATABASE_URL`、`OPENAI_API_KEY`、`OPENAI_CHAT_MODEL`、`OPENAI_EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`、`RAG_TOP_K`、`CHUNK_SIZE` 與 `CHUNK_OVERLAP`。預設片段大小約 800 個 token，重疊約 120 個 token。首次使用 tokenizer 時可能需要下載編碼資料。若變更向量維度，需要資料庫遷移；若更換 embedding 模型，既有片段也必須重新產生向量。

資料庫遷移會啟用 `vector` 擴充功能並建立資料表。需要撤銷時可執行 `uv run alembic downgrade base`，但這會刪除文章與片段資料，請先備份。

## 執行測試

```bash
uv run pytest -q
```

測試會模擬外部網站與 OpenAI 回應，不需要真實 API 金鑰。服務日誌採 JSON 格式，記錄問題、檢索耗時、片段 ID、相似度與模型耗時，不會記錄 API 金鑰。這是供個人本機使用的服務，請保持 API 與資料庫只監聽本機位址。

# Mac 本機文字執行器

執行器在 Mac 上常駐。它主動向文章庫領取文字工作，用本機 Ollama 的 Gemma 生成教材，再回報結果。

- 文章、來源與工作狀態都保存在雲端（D1／R2）。Mac 不保存唯一一份資料。
- 只有執行器連出去。Ollama 只聽本機 `127.0.0.1`，不對外開放，手機也不需要連回家裡。
- Mac 離線時，網站照常收件、閱讀與保存筆記，文字工作顯示「等待本機」，不會改用雲端文字模型。

## 需求

- Apple Silicon Mac，macOS 原生安裝的 Ollama（使用 Apple GPU）。
- 已下載模型：`ollama pull gemma4:26b`。
- Node.js 22.13 以上。執行器沒有額外套件依賴，直接使用本 repo 的 `cloud-digest/runner/`。

## 雲端設定

1. 產生執行器專用憑證，設成 Worker secret。這組憑證和網站登入用的 `RUN_TOKEN` 不同，也不會影響 X 授權加密：

   ```bash
   openssl rand -hex 32
   ```

   ```bash
   npx wrangler secret put LEARNING_RUNNER_TOKEN
   ```

2. 驗收通過後，才在管理入口把文字模型切到本機（`PUT /learning/api/admin/text-provider`，內容 `{"provider":"local"}`）。切換前仍使用既有 Gemini 路徑。

## 本機設定

1. 複製設定範本到 repo 外的位置，並限制權限：

   ```bash
   mkdir -p ~/.config/technews-runner && cp runner/runner.env.example ~/.config/technews-runner/runner.env && chmod 600 ~/.config/technews-runner/runner.env
   ```

2. 編輯 `runner.env`，填入 `TECHNEWS_URL` 與 `TECHNEWS_RUNNER_TOKEN`。
3. 檢查設定：

   ```bash
   node --env-file="$HOME/.config/technews-runner/runner.env" runner/runner.mjs --check
   ```

   成功時會看到 `check_ollama` 與 `check_server` 都正常。

4. 手動處理一份工作：

   ```bash
   node --env-file="$HOME/.config/technews-runner/runner.env" runner/runner.mjs --once
   ```

## 常駐、啟停與復原

用 launchd 使用者代理常駐：登入後自動啟動，程式結束時 launchd 會在 30 秒後重新啟動。安裝前會先跑 `--check`，設定錯誤時不會安裝。

```bash
runner/install-launchd.sh "$HOME/.config/technews-runner/runner.env"
```

| 動作 | 指令 |
|---|---|
| 查看狀態 | `launchctl print gui/$(id -u)/io.github.technews.runner` |
| 重新啟動 | `launchctl kickstart -k gui/$(id -u)/io.github.technews.runner` |
| 查看紀錄 | `tail -f ~/Library/Logs/technews-runner.log` |
| 停止並移除 | `runner/uninstall-launchd.sh` |

復原行為：

- 執行器重新啟動後，會用同一個 `RUNNER_ID` 立刻重新領取原本的工作；舊領取的回報會被拒絕。
- Mac 關機或斷線時，雲端 lease 在 2 分鐘後到期，工作回到佇列。另一台或重開後的執行器可以接手。這不算模型失敗。
- 已取得的來源與媒體解析保存在雲端，重跑只做尚未完成的文字生成。
- 通知與文字生成分開保存，通知失敗只重送已保存的結果。

為什麼不用 Apple container 跑執行器：Linux 容器沒有 Apple GPU，推論一定要在 macOS 原生 Ollama 進行；而容器要連到主機上的 Ollama，Ollama 就得改聽非 loopback 介面，違反「不暴露 Ollama」。執行器本身很輕，直接用 launchd 最單純。Apple container 仍可用來跑其他不需要 GPU 的隔離工作。

## 網站上的處理狀態

| 狀態 | 意思 |
|---|---|
| 等待處理 | 已收件，排隊中 |
| 處理中・取得來源／解析媒體 | 雲端正在取得原文或媒體 |
| 等待本機 | 來源已備齊，等 Mac 領取；Mac 離線時會一直停在這裡，不是失敗 |
| 本機生成中 | Mac 已領取，正在用 Gemma 生成 |
| 已完成／已完成・來源缺漏 | 可閱讀；缺漏會列在文章上方 |
| 待重試 | 雲端階段暫時失敗，會自動重試 |
| 需要處理 | 已用完重試次數或超過處理範圍，需要手動決定 |
| 預算已暫停 | 付費步驟暫停，工作保留 |

排隊順序：來源追問 → 主動分享 → 例行官方與新書籤 → 舊回補。每等待 `LOCAL_AGING_MINUTES`（預設 30）分鐘提前一級，背景工作不會永久排不到。執行中的推論不會被插隊中斷。

## 處理規則

- 同一時間只處理一份工作。雲端也會拒絕發出第二份有效領取。
- 處理中每 30 秒續約。續約失敗表示這次領取已失效，執行器會中止生成，結果不會寫入。
- 回報帶有 attempt token 與輸入版本。過期領取或舊輸入的結果會被拒絕；同一次回報重送不會重複寫入。
- 來源估算超過 `OLLAMA_NUM_CTX` 減去輸出上限時，不截短，直接回報「需人工處理」，原文仍保存在雲端。
- 模型輸出沒有正常結束、格式不完整或引用不存在的來源時，不標為完成，最多重試 3 次。
- Ollama 暫時無法連線時交回工作，不計入模型失敗次數。

## 除錯

設定 `RUNNER_DEBUG_DIR` 後，無法解析或未完成的模型原始輸出會存到該目錄。這些檔案只留在本機，可能包含文章內容，用完請刪除。

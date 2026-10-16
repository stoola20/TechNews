# 統一整理流程：代表素材驗收與本機實測（2026-10-17）

結論：本機 `gemma4:26b` 通過 14 組合成代表素材驗收，沒有重大事實錯誤、捏造引用或未標示缺漏；執行器協定、斷線復原與積壓處理已用真實模型實測。程式預設文字模型仍是 Gemini，**尚未部署、也尚未在正式環境切換**；切換步驟見[設定與使用](../learning-setup.md#切換到本機-gemma)。

本文件只記錄合成素材與通用量測方法。沒有使用真實收藏、私人文章、帳號或部署識別。

## 證據分類

| 類別 | 範圍 | 方式 |
|---|---|---|
| 程式模擬 | 12 張票的資料、排程、費用、通知、筆記與 UI 行為 | `npm test`（Node 內建 SQLite，套用全部 migration，替換外部網路與時間），共 92 項 |
| Workers 執行環境 | migration、登入、Markdown 清理、R2 Range、執行器領取／續約／回報、狀態篩選、筆記版本、預算明細、管理頁 | `wrangler deploy --dry-run` 打包後用 `scripts/verify-learning-runtime.mjs` 在 workerd + D1／R2 模擬器執行 |
| 本機模型實測 | 14 組代表素材、context 上限、冷熱啟動、記憶體、斷線復原與積壓 | 真實 Ollama `gemma4:26b`（MLX runner，nvfp4），`scripts/acceptance.mjs` 與示範伺服器 |
| 瀏覽器操作 | 桌機雙欄、手機寬度、篩選與前後頁、鍵盤、筆記保存／衝突、來源片段、管理頁 | Claude 桌面版內建瀏覽器操作 `scripts/learning-demo.mjs`（合成資料） |
| 供應商契約 | X 計價與 UTC 日去重規則 | 2026-10-16 重新查核 X 官方文件，寫入 `src/learning/pricing.js` |

## 代表素材與結果

素材定義在 `cloud-digest/acceptance/samples.js`，直接使用 Mac 執行器收到的工作輸入格式。自動檢查包含 Worker 的格式與引用驗證、必要事實、禁止內容與引用代號；之後再逐篇人工對照來源。

| 素材 | 內容 | 32k | 64k | 人工檢查 |
|---|---|---|---|---|
| official-long-code | 官方長文：API、程式碼、限制與日期 | 通過 | 通過 | 數字、端點、版本、日期都正確；有一次把來源中的程式碼標成「補充例子」 |
| official-irrelevant | 官方商務合作消息 | 判定略過 | 判定略過 | 正確 |
| official-short | 官方短公告 | 通過 | 通過 | 正確，篇幅隨原文縮短 |
| thread-discussion | X 主文、作者補充、引用 | 通過 | 通過 | 三方觀點都有引用；比較表是整理性推論 |
| image-ocr | 圖片 OCR 程式碼 | 通過 | 通過 | 程式碼逐字正確；推論與無法辨識部分有標示 |
| video-evidence | 影片語音段落、畫面時間點 | 通過 | 通過 | 數字與時間點正確；部分只來自媒體的事實同時標了主貼文 [S1] |
| missing-sources | 父貼文與外連報告缺漏 | 通過 | 通過 | 明說無法取得，沒有編造報告內容 |
| zh-source | 中文來源 | 通過 | 通過 | 數字、狀態名稱與台灣用語正確 |
| prompt-injection | 來源夾帶惡意指令 | 通過 | 通過 | 忽略指令，只整理版本內容 |
| long-context | 約 3,700 tokens 長文 | 通過 | 通過 | 保留文末 v3.4 容錯移轉說明；有一處錯字 |
| very-long-context | 約 31,000 tokens 長文 | 依預期拒絕 | 通過 | 32k 時預先拒絕且保留原文、不截短；64k 時保留文末事實 |
| question-single | 單篇追問 | 通過 | 通過 | 正確且引用片段 |
| question-insufficient | 片段不足的跨篇追問 | 回覆不足 | 回覆不足 | 沒有編造價格 |
| question-media | 追問媒體證據 | 通過 | 通過 | 回答包含 00:40 時間點 |

第一次執行有 3 組未通過，修正後才得到上表：

- 官方格式把一行說明放在 `<<<END>>>` 之後，Gemma 會省略結束標記。已把說明移到前面；模型自然停止（`done_reason` 為 `stop`）且正文完整時，缺少結束標記仍接受。輸出上限截斷仍會被拒絕。
- 媒體追問沒有寫時間點。追問提示已要求引用影片或圖片證據時寫出 MM:SS。

人工檢查發現的小問題（不影響通過，但列為後續觀察）：引用粒度偶爾偏粗、少數「補充例子」標示不精準、偶發錯字、偶見非台灣常用詞（例如「首屏」）。

## 效能與記憶體

測試機：Apple Silicon Mac mini，32 GB 統一記憶體；Ollama 0.40.4，模型檔 16 GB；flash attention、q8 KV cache。

| 項目 | 32k context | 64k context |
|---|---|---|
| 冷啟動載入（`load_duration`） | 3.3 秒 | 3.6 秒；31k tokens 長文時 5.0 秒 |
| 一般素材完成時間（暖機） | 1.5–30 秒 | 1.5–33 秒 |
| 輸出速度 | 約 43–52 tokens/s | 約 42–52 tokens/s；31k tokens 輸入時約 30 tokens/s |
| 輸入處理速度 | 約 1,400–5,200 tokens/s | 約 1,100–5,200 tokens/s |
| 31k tokens 長文 | 拒絕（估算 37k + 輸出 8k 超過上限） | 78.5 秒完成 |
| `ollama ps` 回報大小 | 21 GB | 17–21 GB |
| Ollama 程序 RSS 峰值 | 約 10–11.3 GB | 約 11–11.9 GB |
| 系統可用記憶體最低 | 31% | 18%（同時有其他程式），多數時間 24–38% |
| swap | 測試前後沒有增加 | 測試前後沒有增加 |

說明：

- 模型檔 16 GB 不等於執行記憶體；KV cache 隨 context 增加。MLX runner 的記憶體反映在 Ollama 程序與統一記憶體，數字是取樣值，不是保證。
- token 估算比實際多約 20%（估 37,467，實際 30,976），故意保守，以免 Ollama 靜默截掉前文。
- 建議設定：`OLLAMA_NUM_CTX=65536`、`OLLAMA_NUM_PREDICT=8192`。可處理估算約 57k tokens 以內的來源；更長的來源會標示需人工處理並保留原文。尚未驗證長文分段策略。
- 不承諾固定秒數。實際時間取決於輸出長度與同時執行的程式。

## 復原與積壓（真實模型）

在示範伺服器（本機文字模式）排入 3 篇文章，執行器處理第一篇時以 SIGKILL 終止：

- 終止後雲端仍顯示 1 份領取中、2 份等待。
- 重新啟動同一個 `RUNNER_ID` 的執行器後立刻重新領取同一份工作，不需等 2 分鐘 lease 到期；舊領取的回報會被拒絕（另有自動測試）。
- 3 篇依序完成，各 12.6–18.7 秒；模型失敗次數未增加。

## Ollama 服務設定（已套用到測試機）

用 `cloud-digest/runner/configure-ollama.sh` 設定 Homebrew 的 Ollama 服務：`OLLAMA_HOST=127.0.0.1:11434`、`OLLAMA_NUM_PARALLEL=1`、`OLLAMA_MAX_LOADED_MODELS=1`、`OLLAMA_KEEP_ALIVE=30m`，保留 `OLLAMA_FLASH_ATTENTION=1` 與 `OLLAMA_KV_CACHE_TYPE=q8_0`。確認服務只在 127.0.0.1 監聽，執行中的程序帶有上述變數。

## 尚未驗證

以下沒有實測，不能視為已驗收：

- 部署到 Cloudflare、正式 D1 migration、Queue 與 Cron 實際觸發。
- Gemini Flash 媒體解析的真實呼叫與證據品質。驗收中的圖片與影片證據是合成資料，只驗證 Gemma 如何使用證據。
- 真實 X 書籤局部檢查、完整核對、限流與帳單核對；真實 Telegram 收件與逐篇通知。
- 使用真實收藏與官方文章比較新舊流程的品質（需在部署後依切換步驟進行，結果不放進公開 repo）。
- Apple container 共存：測試時 container 系統服務沒有執行，啟動需要另外下載資源，因此未量測。執行器改用 launchd 常駐，不依賴 container。
- 執行器以 launchd 長時間常駐：已提供安裝腳本，但需要正式網址與執行器憑證才能通過 `--check`，尚未安裝。

## 重跑方式

```bash
cd cloud-digest
npm test
node scripts/acceptance.mjs --ctx 65536
```

驗收結果包含模型輸出全文，預設寫到系統暫存目錄；不要把真實文章的輸出提交到 repo。

# 模型、全文與來源的設計選擇

這次修改把擷取、模型與發送分成三個步驟。模型供應商共用 `summarize(env, source, entry)`。
輸入是同一篇全文與同一份編輯規則。輸出是同樣的導讀 JSON，Telegram 不需要知道模型供應商。

## 可以切換哪些模型

| 設定值 | 模型 ID | 執行平台 |
| --- | --- | --- |
| `gemma4`，預設 | `@cf/google/gemma-4-26b-a4b-it` | Workers AI |
| `nemotron3` | `@cf/nvidia/nemotron-3-120b-a12b` | Workers AI |
| `gpt_terra` | `gpt-5.6-terra` | OpenAI Responses API |
| `claude_sonnet` | `claude-sonnet-5-5` | Anthropic Messages API |

`/settings` 提供同一份 JSON 設定的手機介面。儲存後下次工作生效，不需要電腦或部署。
`src/settings.js` 定義模型選項與對應的 API。要增加新的模型 ID，仍需修改選項並部署一次。
切換已列出的模型、來源 JSON 與主題則不需部署。
API 金鑰先以 Worker Secret 設定一次。未設定對應金鑰時，設定頁會停用付費模型選項。

## 免費額度

Cloudflare Workers AI 免費與付費方案都包含每日 10,000 Neurons。Neuron 是模型運算用量的計費單位。
免費方案用完後請求失敗。付費方案超額用量為每 1,000 Neurons US$0.011，每日 UTC 00:00 重置，也就是台北 08:00。
來源：[Workers AI 定價](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

這不是固定的「每日幾篇」。全文長度、輸出長度、推理 token 與重試都影響用量。
用「每篇 10,000 input token＋2,000 output token」估算，不計額外推理或重試：

| 模型 | 每篇約用 Neurons | 每日 10,000 Neurons 約可處理 |
| --- | --- | --- |
| Google Gemma 4 | 145 | 68 篇 |
| NVIDIA Nemotron 3 | 727 | 13 篇 |
| OpenAI gpt-oss-120b | 455 | 22 篇 |
| OpenAI gpt-oss-20b | 236 | 42 篇 |

這些數字只是定價換算，不是可用量承諾。較長文章與推理型模型會降低篇數。
Gemma、Nemotron 與 gpt-oss 屬於 Cloudflare 托管模型。Gemma 不是 Gemini API，gpt-oss 不是 GPT Terra。
模型目錄沒有提供 Cloudflare 托管的 Claude；Claude 走 Anthropic API，另計費。
來源：[模型目錄](https://developers.cloudflare.com/workers-ai/models/)、[免費方案模型公告](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/)。

Browser Run 免費方案另有每日 10 分鐘瀏覽器時間，與模型額度分開。
網站防機器人措施仍能阻擋 Browser Run，不保證原文擷取成功。
來源：[Browser Run 定價](https://developers.cloudflare.com/browser-run/pricing/)、[擷取說明](https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/)。

## 為什麼原先漏收

原先 OpenAI 來源只查 Developer Blog。OpenAI News 與 DevDay 的 `openai.com/index/` 文章不在這個入口。
原先 Anthropic 來源只查 Claude Blog。claude.dev 的實作教學、Anthropic News 與 Engineering 都沒有納入。
新增入口比換模型更直接改善這類漏收。來源與模型各自解決不同問題。
來源：[OpenAI News](https://openai.com/zh-Hant/news/)、[DevDay 2026](https://openai.com/index/devday-2026-recap/)、[claude.dev](https://claude.dev/)。

新版保留官方來源清單，再用讀者主題判斷文章。這能納入新聞入口，同時略過無技術細節的商務新聞。
來源清單可在手機編輯，避免每次加來源都改程式。特殊網站仍需自己的擷取規則。
模型只判斷本次文章，不會自行上網補找資料，也沒有保證零漏收。

## Worker 與 n8n

目前建議保留 Worker。這是根據專案已使用 D1、Cron 與 Workers AI 的選擇，不是模型品質評比。
這次最主要的問題是來源範圍、原文擷取與過短的編輯規則。更換工作流程平台不會自動修正這些問題。

| 需求 | Worker | n8n |
| --- | --- | --- |
| 排程 | Cron，平台代管 | Schedule Trigger，透過 Cloud 或自架執行 |
| 改模型或主題 | 新版手機設定頁 | 可視化 workflow 與模型節點 |
| 追查逐步執行 | 日誌、D1 狀態；需自己做介面 | workflow execution UI，適合人工檢查節點 |
| 客製全文擷取與去重 | 程式容易測試與版控 | 可以用 Code／HTTP 節點，但特殊擷取仍需編碼 |
| 串接許多服務 | 自己寫 API 呼叫 | 現成整合節點較多 |
| 維運 | 不需自架常駐伺服器 | Cloud 需訂閱；自架需維護服務、資料庫與備份 |

若未來要頻繁拖拉修改流程、加入人工審稿或串接很多服務，n8n 的操作介面更合適。
若核心仍是官方文章、全文導讀與 Telegram，保留 Worker 可以少做一次遷移。
也能讓 n8n 呼叫 Worker 的擷取／摘要 API，但目前沒有實作這種混合架構。
來源：[n8n hosting](https://docs.n8n.io/hosting/)、[n8n plans](https://n8n.io/pricing/)。

Worker 免費方案還有 CPU 與子請求限制。每次最多 6 篇是目前的批次控制，不代表已保證符合所有 CPU 情境。
完整版 HTML 解析比舊版更耗 CPU，需觀察線上使用量。大量來源或長篇擷取需要付費 Worker 或拆分任務。
來源：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。

## 這次實測

Gemma 4 與 Nemotron 3 都以同一份 claude.dev 官方 Markdown 作為 input，正文長 30,766 字串單位。
Gemma 的 Telegram 預覽為 1,115 字串單位，Nemotron 為 1,960。兩者都符合單則訊息上限。
這只是各一次生成，不足以判定模型長期品質。

[Gemma 原始預覽](previews/gemma4-mods.md) 與 [Nemotron 原始預覽](previews/nemotron3-mods.md) 保留模型原樣輸出。
Nemotron 提供較多操作細節，但出現混合字元與不自然詞語。Gemma 較精簡，也仍需檢查是否省略關鍵要求。
模型 JSON 檢查與全文送入，都不能替代內容正確性評估。

本次部署驗證包含手機設定 JSON 的 D1 寫入、七個來源與 Gemma 預設值。
線上 Gemma 全文預覽也成功，導讀長 1,103 字串單位。
付費模型需由各部署者設定自己的 Secret。Gemma 與 Nemotron 不會自動轉用 GPT。
驗證未手動觸發 Telegram 發送。預設排程是每日台北 09:00。

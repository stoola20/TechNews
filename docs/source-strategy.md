# 官方來源策略與平台選擇

## 來源範圍

只查單一入口會漏收。OpenAI Developer Blog 不包含 OpenAI News 與 DevDay 的 `openai.com/index/` 文章；Claude Blog 不包含 claude.dev 的實作教學、Anthropic News 與 Engineering。所以官方來源同時追蹤這些入口，清單見 [`SOURCES.md`](../cloud-digest/SOURCES.md)。
來源：[OpenAI News](https://openai.com/zh-Hant/news/)、[DevDay 2026](https://openai.com/index/devday-2026-recap/)、[claude.dev](https://claude.dev/)。

新增入口比換模型更能改善漏收：來源負責找到文章，主題負責決定哪些文章適合讀者，兩者各自解決不同問題。
收得比較廣之後，再用「想收到的內容」讓文字模型判斷每篇是否相關，略過沒有技術細節的商務新聞。模型只判斷本篇文章，不會自行上網補找資料，也不保證零漏收。

官方來源只收發表 7 天內的文章。來源列表冒出的舊文章（例如 RSS 一次放出更多歷史）只記為看過，不收件也不通知。細節見 [`SOURCES.md`](../cloud-digest/SOURCES.md)。

## Workers AI 與 Browser Run 用量

主題分類使用 Workers AI 的 Google Gemma 4，每篇只送標題與導讀，不記入文章庫的月預算。Workers AI 免費與付費方案都包含每日 10,000 Neurons，每日 UTC 00:00 重置；免費方案用完後請求失敗。
來源：[Workers AI 定價](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

官方文章直接請求失敗時，改用 Browser Run 取得渲染後的 HTML。Browser Run 免費方案另有每日 10 分鐘瀏覽器時間，與模型額度分開。網站的防機器人措施仍能阻擋 Browser Run，不保證擷取成功。
來源：[Browser Run 定價](https://developers.cloudflare.com/browser-run/pricing/)、[擷取說明](https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/)。

## Worker 與 n8n

目前建議保留 Worker：專案已使用 D1、R2、Queue 與 Cron，來源擷取與去重也需要可測試、可版控的程式。更換工作流程平台不會自動改善來源範圍或原文擷取。

| 需求 | Worker | n8n |
| --- | --- | --- |
| 排程 | Cron，平台代管 | Schedule Trigger，透過 Cloud 或自架執行 |
| 改模型或主題 | 管理頁設定，存在 D1 | 可視化 workflow 與模型節點 |
| 追查逐步執行 | 日誌、D1 狀態；需自己做介面 | workflow execution UI，適合人工檢查節點 |
| 客製全文擷取與去重 | 程式容易測試與版控 | 可以用 Code／HTTP 節點，但特殊擷取仍需編碼 |
| 串接許多服務 | 自己寫 API 呼叫 | 現成整合節點較多 |
| 維運 | 不需自架常駐伺服器 | Cloud 需訂閱；自架需維護服務、資料庫與備份 |

若未來要頻繁拖拉修改流程、加入人工審稿或串接很多服務，n8n 的操作介面比較合適。
來源：[n8n hosting](https://docs.n8n.io/hosting/)、[n8n plans](https://n8n.io/pricing/)。

Worker 免費方案有 CPU 與子請求限制。文章整理交給 Queue，一次處理一篇，避免單次執行做太多事；大量來源或長篇擷取仍需觀察線上用量。
來源：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。

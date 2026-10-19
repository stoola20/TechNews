# 11: 批改的網路查證（Gemini Google 搜尋）

**What to build:** 第一輪批改有題目標記 `needs_web`，而且管理頁「網路查證」開啟時，對那些題目呼叫 Gemini 並啟用 Google 搜尋，更新判定與回饋，網路出處附網址。本機模式由 Worker 在 Mac 完成第一輪後接著查證。搜尋費用依每月免費額度記帳。

**Blocked by:** 10：連結題與批改的第二層證據

**Status:** ready-for-agent

- [ ] 以 Gemini API 文件確認 Google 搜尋與結構化輸出能否並用、grounding metadata 的欄位，程式註解寫查核日
- [ ] settings `learning:web-check`；未設定時有 `GEMINI_API_KEY` 就開啟；管理頁可切換
- [ ] 作答狀態在查證期間為 `web_check`；失敗時保留第一輪結果並註明
- [ ] 新費用類別 `gemini-search`：依實際搜尋次數記帳，本月在免費額度內記 $0；部署變數 `LEARNING_SEARCH_FREE_PER_MONTH`、`LEARNING_SEARCH_USD_PER_1K`
- [ ] 呼叫前依搜尋上限預留，回應後結算；費用暫停時不查證並註明
- [ ] 結果畫面出處多一組「網路」
- [ ] 測試涵蓋觸發條件、開關、沒有金鑰、本機接續、失敗與記帳

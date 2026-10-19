# 02: 移除舊每日導讀流程

**What to build:** 官方來源只走文章庫一條路。舊每日導讀的手機設定頁、`/config`、`/run`、`/preview`、四選一摘要模型與 `LEARNING_ENABLED` 開關全部移除；這些路徑回 404。08:00 排程只做文章庫的官方發現。文章庫裡既有的舊版短導讀照常可讀、可搜尋。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 舊流程程式移除：digest 執行、單篇導讀、四選一摘要模型、手機設定頁與其 API
- [ ] `/settings`、`/config`、`/run`、`/preview` 回 404；`/health` 照常
- [ ] Worker 不再讀取 `LEARNING_ENABLED`，排程、Queue 與網站一律走文章庫
- [ ] 部署設定移除 `MODEL_PROFILE`、`MAX_ARTICLES_PER_RUN`；不再讀取 OpenAI、Anthropic 金鑰；Workers AI 與 Browser Run binding 保留
- [ ] `digest` 設定只保留想收到的內容與來源清單，讀到舊格式時忽略 `model_profile`；文章庫讀取設定的地方行為不變
- [ ] 舊 `articles` 表保留、不再寫入
- [ ] `legacy_digest` 文章仍出現在列表、可以閱讀
- [ ] 舊流程專屬測試移除；仍有價值的斷言（發現、新鮮度）已在文章庫測試中
- [ ] README 快速開始改以文章庫為準，端點表更新；架構文件移除「每日 Telegram 導讀」一節；來源說明不再提舊流程

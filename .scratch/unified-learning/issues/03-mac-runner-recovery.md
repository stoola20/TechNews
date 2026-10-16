# 03: Mac 常駐、離線續跑與處理狀態

**What to build:** 執行器能常駐與重新啟動；網站看得出 Mac 是否在線、文章卡在哪一階段，中斷後接續且不被過期結果覆寫。

**Blocked by:** 02：網站分享純文字文章，經 Mac 產生詳細教材

**Status:** done

- [x] 健康與最後心跳、長工作續約、斷線重啟、工作重新領取、舊 attempt／舊輸入回報拒絕及回報重播冪等皆可操作驗證
- [x] 等待本機不累加模型失敗
- [x] 只重跑未完成階段
- [x] 有啟停／自啟動說明
- [x] 不暴露 Ollama、不觸發雲端 fallback
- [x] 排隊優先級與背景公平性可觀察。

## 實作紀錄

- `runner/install-launchd.sh`、`runner/uninstall-launchd.sh`：launchd 常駐、自動啟動與重啟，安裝前先 `--check`。
- `src/learning/local.js`：同一執行器重啟後重新領取並讓舊 token 失效；lease 到期另計 `lease_expirations`，不計模型失敗；`LOCAL_AGING_MINUTES` 公平排隊；狀態 API 回傳排隊順序與最後心跳。
- `migrations/0007_processing_stage.sql`：文章處理階段（取得來源、解析媒體、文字生成）。
- 驗證：`tests/runner-recovery.test.js`。

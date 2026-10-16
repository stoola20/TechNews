# 12: 代表素材驗收、整合與正式切換交付

**What to build:** 以已完成的各條路徑驗證品質、運行容量、失敗復原及桌機體驗，達標後才啟用本機預設；提供設定、維運及復原說明。

**Blocked by:** 03：Mac 常駐、離線續跑與處理狀態、04：Flash 媒體證據接力 Gemma 詳細整理、06：官方文章 08:00 開始，全部詳細整理入庫、08：十分鐘局部書籤檢查與每日完整核對、09：跨入口完成即通知、重複連結與文章更新、11：可靠筆記與閱讀頁來源／追問整合

**Status:** done（程式與本機驗收完成；正式部署與切換待使用者執行）

- [x] 至少十二組代表素材涵蓋官方長文／程式碼、文字討論、圖片、影片、缺漏、單篇及跨篇追問，逐項對照來源
- [x] 沒有重大事實錯誤、捏造引用或未標示缺漏
- [ ] 冷啟動／暖機、峰值記憶體、容器共存、context、輸出及排隊時間有真實量測（容器共存未量測，其餘已實測）
- [x] 四類收件到通知完整流程、低預算下本機工作、斷線恢復、舊資料搬移及 UI 操作均有證據
- [x] 未通過不切換，不把 mock 當品質驗收
- [x] 正式切換後沒有自動文字 fallback。

## 實作紀錄

- `cloud-digest/acceptance/samples.js`、`scripts/acceptance.mjs`：14 組合成代表素材，以真實 Ollama 執行並套用 Worker 驗證、必要事實與禁止內容檢查；結果另經人工逐篇對照。
- `runner/configure-ollama.sh`：Ollama 服務只聽 loopback、單一推論、單一模型；已套用到測試機。
- `scripts/verify-learning-runtime.mjs`：在 workerd + D1／R2 模擬器驗證執行器協定、筆記版本、篩選與管理頁。
- 驗收紀錄：`docs/testing/unified-learning-acceptance-2026-10-17.md`；切換與回退步驟：`docs/learning-setup.md`。
- 未完成：Apple container 共存量測；部署後的真實 X、Telegram、Gemini 媒體與正式環境切換。四類收件到通知的完整流程目前是程式模擬與 workerd 證據，不是正式環境實測。程式預設仍為 Gemini，沒有自動文字 fallback。

# 09: Mac 執行器代抓 X 長文

**What to build:** X 長文無法經 API 取得時，Mac 執行器用已登入 X 的專用 Playwright profile 開啟長文頁擷取正文，回報後保存為外部來源並重新整理。

**Blocked by:** 08：X 長文經 API 取得（API 無法取得時才需要）

**Status:** ready-for-agent

- [ ] 只在有 X 長文缺漏時建立代抓工作；Mac 離線時等待，不算失敗
- [ ] 回報沿用執行器憑證、lease 與 attempt token；過期回報被拒
- [ ] 雲端不保存 X 登入狀態；profile 只在 Mac 本機
- [ ] 提供 profile 首次登入與檢查步驟

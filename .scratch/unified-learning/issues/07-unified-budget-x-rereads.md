# 07: 統一雲端預算與 X 重讀費用辨識

**What to build:** 管理頁清楚呈現 US$30 月預算、X／Flash／相關雲端用量、預留及未知成本；日內重讀不被錯當每次都是已確認新費用。

**Blocked by:** 02：網站分享純文字文章，經 Mac 產生詳細教材

**Status:** done

- [x] 定義可調整的保守重讀風險額度與計價依據
- [x] UTC 日去重範圍及台灣月預算分開
- [x] Owned Read 只在資格符合時使用
- [x] 原子預留及未知成本保留
- [x] 費用暫停不新付費、可繼續已有證據的 Mac 工作／追問與保存內容通知
- [x] 下月不自動恢復
- [x] 既有帳目不因搬移再計一次。

## 實作紀錄

- 已重新查核 X 官方計價與 UTC 日去重說明（2026-10-16）。
- `src/learning/pricing.js`、`migrations/0010_x_read_ledger.sql`：依 UTC 日記錄已讀資源；首次讀取全額，重讀按可設定比例與每日上限記為未確認風險；Owned Reads 依端點與 app 擁有者判斷。
- 費用暫停只擋付費呼叫；手動暫停停下全部處理（含 Mac 領取）。暫停原因不互相覆寫，跨月不自動恢復。
- `GET /learning/api/budget` 明細、`POST /learning/api/admin/budget-adjust` 人工核對修正。
- 驗證：`tests/budget.test.js`（以 mock Date 驗 UTC 日與台灣月份邊界）。

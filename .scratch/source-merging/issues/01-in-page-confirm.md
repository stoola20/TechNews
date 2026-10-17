# 01: 頁內確認對話框

**What to build:** 刪除待回補、補取缺漏、只重寫文字、重送通知都改用頁面內確認對話框，在 Telegram 等 App 內建瀏覽器也能確認。

**Blocked by:** 無

**Status:** done

- [x] 不再呼叫 `window.confirm()`
- [x] 對話框可用鍵盤確認／取消，關閉後焦點回到觸發按鈕
- [x] 手機寬度實際操作刪除待回補有反應並返回列表

## 實作紀錄

- `src/learning/ui.js` 新增共用 `askConfirm()`，以 `<dialog>` 顯示確認；Escape 與取消都回傳否，且不冒泡觸發手機版返回列表；關閉後焦點回到觸發按鈕。
- 文章庫（刪除待回補、補缺漏、重寫、重送通知）與管理頁（切換本機、整批回補）全部改用頁內對話框。
- 驗證：`tests/library-ui.test.js` 檢查兩頁腳本不再呼叫原生 `confirm()`；內建瀏覽器 375px、將 `window.confirm` 改成固定回傳取消後，刪除待回補仍可確認並返回列表，Escape 只關閉對話框。

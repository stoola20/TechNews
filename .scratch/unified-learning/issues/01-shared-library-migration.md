# 01: 共同文章庫與既有資料相容搬移

**What to build:** 原本分散的官方文章與收藏出現在同一私人文章庫，保留來源身分、原文、既有結果、筆記、已讀及舊連結，不觸發生成或通知。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 合成的兩套舊資料可重複搬移而不新增副本
- [x] 同網址合併收件／版本，保留收藏正文與閱讀資料
- [x] X 與外連文章不誤合併
- [x] 短導讀及缺失資料如實標示
- [x] 未登入無法讀取。相容演進期間既有寫入仍可讀取，原流程回歸通過。

## 實作紀錄

- `migrations/0005_unified_library.sql`：文章版本、舊識別碼別名、收件 metadata、edition。
- `src/learning/library.js`：正式網址身分、舊官方導讀搬移、同網址合併；維護排程與 `POST /learning/api/admin/migrate` 可重複執行。
- 驗證：`tests/library.test.js`（合成資料，搬移期間不允許任何外部呼叫）。

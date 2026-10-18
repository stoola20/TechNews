# 04: 主題表、Workers AI 自動分類與主題篩選

**What to build:** 文章庫有一份 7 個主題的預設主題表。維護排程用 Workers AI Gemma 4 讀標題與導讀，為已完成文章選出主要主題與最多 1 個次要主題；新文章數分鐘內分類，既有文章逐輪回補，內容更新後重新分類。列表頂端有附篇數的主題 chip（全部、各主題、未分類），每篇顯示主題顏色點與主題名稱。

**Blocked by:** 03：列表改版為緊湊清單（設計稿 B）

**Status:** done

- [x] migration 新增主題相關欄位；預設主題表含固定識別碼、名稱、說明、顏色
- [x] 維護排程每輪分類有限篇數，只處理符合條件（未分類、revision 變更、主題已不存在，且非手動）的文章
- [x] 模型輸出不屬於主題表時視為失敗，累計次數並延後重試；失敗不影響文章其他功能，也不記入預算、不發通知
- [x] `GET topics` 回傳各主題與未分類篇數，篇數依其他篩選條件計算
- [x] `GET items?topic=` 比對主要與次要主題，可與搜尋、未讀、管理篩選並用，選擇保存在網址
- [x] 列表項目與閱讀頁顯示主題；chip 在手機寬度可橫向捲動

## 實作紀錄

- migration 新增 `topic_primary`、`topic_secondary`、`topic_source`、`topic_revision`、`topic_attempts`、`topic_next_at`。
- 待分類條件以 `topic_revision` 判斷：未分類為空值；連續 5 次失敗後記下目前 revision，停在未分類，避免每 5 分鐘重送。
- 主題表存 settings 的 `learning:topics`，沒有設定時用預設 7 個主題。
- `GET api/topics` 與 `GET api/items` 共用同一組篩選條件。
- 驗證：`tests/topics.test.js`；內建瀏覽器實際點選主題 chip，網址保存 `topic`，次要主題相符的文章也出現在篩選結果。

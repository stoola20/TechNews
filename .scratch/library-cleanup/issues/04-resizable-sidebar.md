# 04: 側邊欄可拖曳調整寬度

**What to build:** 960px 以上，列表與閱讀區之間有拖曳把手，範圍 280–560px、預設 340px，寬度記在這台裝置；雙擊或 Home 還原，左右方向鍵每次 16px。專注模式與手機版不顯示把手。

**Blocked by:** 03

**Status:** done

- [x] 三欄格線與 `role="separator"`、`aria-orientation="vertical"`、可聚焦、`aria-valuenow` 等屬性
- [x] pointer 拖曳；寬度存 `localStorage` 的 `technews-side-width`，讀寫失敗用預設值
- [x] 雙擊與 Home 還原；方向鍵調整
- [x] 專注模式與 959px 以下不顯示
- [x] 結構測試；實際拖曳、重新整理後保留、鍵盤調整

**實作紀錄：** 拖曳中只更新畫面，放開時才寫入裝置設定；`pointercancel` 也走同一個結束流程。原本固定在 300–380px 的列表欄，預設改為 340px。

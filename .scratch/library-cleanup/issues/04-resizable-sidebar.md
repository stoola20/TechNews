# 04: 側邊欄可拖曳調整寬度

**What to build:** 960px 以上，列表與閱讀區之間有拖曳把手，範圍 280–560px、預設 340px，寬度記在這台裝置；雙擊或 Home 還原，左右方向鍵每次 16px。專注模式與手機版不顯示把手。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 三欄格線與 `role="separator"`、`aria-orientation="vertical"`、可聚焦、`aria-valuenow` 等屬性
- [ ] pointer 拖曳；寬度存 `localStorage` 的 `technews-side-width`，讀寫失敗用預設值
- [ ] 雙擊與 Home 還原；方向鍵調整
- [ ] 專注模式與 959px 以下不顯示
- [ ] 結構測試；實際拖曳、重新整理後保留、鍵盤調整

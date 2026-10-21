# 01: 頁首：移除加入連結、搜尋與複習入口移到頁首

**What to build:** 移除頁首的「貼上網址＋加入文章庫」。搜尋列移到頁首中央，`/` 與 ⌘K／Ctrl+K 聚焦；959px 以下收成放大鏡按鈕，點了才展開。「今日複習（題數）」與「每週回顧」移到頁首右側。`POST /learning/api/collect` 保留。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 移除 `#collect-form` 與送出處理；collect API 不變
- [ ] 頁首三欄：品牌、置中搜尋（最寬 560px）、右側導覽；`#search` 行為不變
- [ ] ⌘K／Ctrl+K 聚焦搜尋，`/` 保留
- [ ] 959px 以下：放大鏡按鈕帶 `aria-expanded`，展開後聚焦；空白時 Esc 或失焦收起
- [ ] 今日複習與每週回顧連結移到頁首；沒有題目時不顯示徽章；入口列只剩待決定（票 02 移除）
- [ ] 結構測試；1280px 與 375px 實際操作，手機沒有橫向捲動

# 02: 原文發表時間正規化、回補與依發表時間排序

**What to build:** 文章記錄統一格式的原文發表時間。列表預設依發表時間新到舊排列，可切換成依加入時間；沒有發表時間的文章用加入時間排入，並標示「日期未知・加入於 M/D」。舊導讀從既有資料補回日期。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 保存主要來源時，把 RFC 2822（含時區縮寫）、ISO 8601、`YYYY-MM-DD` 轉成 UTC ISO 寫入文章；無法解析時為空值
- [ ] 維護排程冪等回補：依序使用主要來源、收件 metadata、舊官方文章表
- [ ] 列表 API 支援 `sort=published|added`，預設 `published`，次要排序為文章 ID；回傳發表時間與加入時間
- [ ] 列表頁有排序下拉並保存在網址；每篇顯示發表日期或「日期未知・加入於 M/D」（台灣時間）

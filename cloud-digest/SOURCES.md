# 技術來源白名單

雲端排程只讀取下列三個官方入口，不使用一般 web search，也不靠搜尋關鍵字發現文章。每個來源取出文章網址後，只接受白名單網域與指定網址格式，並用完整原文網址去重。

| 來源 | 固定檢查入口 | 只接受的文章網址 |
| --- | --- | --- |
| OpenAI Developer Blog | https://developers.openai.com/blog | `https://developers.openai.com/blog/{文章代稱}` |
| Apple Developer News | https://developer.apple.com/news/rss/news.rss | `https://developer.apple.com/news/?id={文章 ID}` |
| Claude Blog | https://claude.com/blog | `https://claude.com/blog/{文章代稱}` |

## 哪些文章會通知

三個來源的**所有新文章都通知**，不做技術相關性過濾。來源本身已限定在開發者或產品部落格，逐篇過濾容易誤殺，且 Telegram 頻道可靠搜尋回查，多收幾篇的成本低。每篇產生的「關鍵字」用於 Telegram 與資料庫中的分類、回查。

## 去重與首次啟用

第一次執行會從三個來源各送出最新一篇文章送到 Telegram，讓你明天就能收到正式摘要；其餘既有文章只記錄一份網址去重檢查點，**不抓全文、不生成摘要，也不逐篇寫入文章資料表**。往後每天台北時間上午 9 點只處理新網址。完整摘要保存在 Telegram 頻道，D1 僅保存少量檢查點與已發送紀錄。來源清單由 `src/sources.js` 的 `SOURCES` 常數控制，加入新來源時必須明確修改此白名單與擷取規則。

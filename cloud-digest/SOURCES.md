# 來源與主題設定

來源負責找到文章。主題負責決定哪些文章適合讀者。兩者分開設定，避免只能在「漏收」與「全收」之間選擇。

預設來源：

| 名稱 | 入口 | 正文 |
| --- | --- | --- |
| OpenAI Developer Blog | https://developers.openai.com/blog | 文章頁 |
| OpenAI News | https://openai.com/news/rss.xml | 文章頁；包含 OpenAI News 的新聞與 DevDay |
| Apple Developer News | https://developer.apple.com/news/rss/news.rss | 文章頁，RSS 只用來發現文章 |
| Claude Blog | https://claude.com/resources/articles | 文章頁；舊 `/blog/` 網址歸一成新路徑 |
| claude.dev | https://claude.dev/rss.xml | 官方 `.md` 全文 |
| Anthropic News | https://www.anthropic.com/news | 文章頁 |
| Anthropic Engineering | https://www.anthropic.com/engineering | 文章頁 |

「想收到的內容」與來源清單存在 D1 的 `settings` 表（key `digest`），下一輪排程生效，不需要重新部署。

設定範例：

```json
{
  "interests": "AI coding、agents、模型 API、iOS 開發與開發者活動。保留 DevDay，略過沒有產品或技術細節的商務新聞。",
  "sources": [
    {
      "id": "claude_dev",
      "name": "claude.dev",
      "indexUrl": "https://claude.dev/rss.xml",
      "kind": "rss",
      "host": "claude.dev",
      "paths": ["blog"],
      "markdown": true
    }
  ]
}
```

範例只含一個來源。儲存時會取代完整來源清單，保留其他來源時需把它們一起放進陣列。
`kind` 可以是 `rss` 或 `blog`。目前 RSS 解析器支援 RSS 2.0 的 `item`，不支援 Atom。
`paths` 是文章路徑前綴，目前只接受前綴之後一層的文章代稱。
`contentSelector` 可以指定正文 CSS selector，供特殊網站使用。網站需要登入或內容擷取失敗時，不生成部分摘要。

官方文章在文章庫詳細整理時，文字模型會讀完全文，再依「想收到的內容」判斷是否相關。不相關的文章標為已略過、不通知，略過理由保存在文章上，可在文章庫的「已略過」篩選查看。
DevDay 即使標成 Company 也列在關注主題，不依 RSS category 直接刪除。
這套判斷仍可能出錯；使用者主動分享同一篇時，不受主題篩選，會照常整理。
程式沒有執行一般網路搜尋，也不會自動加入未設定的網站。

只收發表 7 天內的文章（`wrangler.jsonc` 的 `MAX_ARTICLE_AGE_DAYS`）。新來源首次執行回補同一段期間；沒有日期時只先處理來源列表第一篇，其餘列為基準。
之後列表若冒出沒看過、但發表超過 7 天的文章（例如 RSS 一次放出更多舊文），只記為看過，不收件也不通知。
列表沒有日期的文章，抓到原文後再檢查一次；以收件時間為準，所以 Mac 離線造成的處理延誤不會讓新文章過期。使用者主動分享或收藏的文章不受這個期限限制。
收進文章庫的官方文章交給背景工作逐篇整理，沒有單次篇數上限。處理失敗的文章保留錯誤訊息，之後重試。
來源列表本身沒有顯示的文章仍會漏掉；要改善這類漏收需加入其他官方入口、RSS 或 sitemap 支援。
每個來源目前最多取入口清單前 80 篇，再於 RSS 分支按日期排序；不代表讀取網站所有歷史文章。

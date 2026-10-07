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

`/settings` 是手機也能操作的設定頁。輸入 RUN_TOKEN 後，可以切換模型、修改關注主題與來源 JSON。
設定存於 D1 的 `settings` 表，不需要重新部署。`GET /config` 與 `PUT /config` 使用同一份 JSON。
API 金鑰由 Worker Secrets 保存，不包含在這份 JSON。

設定範例：

```json
{
  "model_profile": "gemma4",
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

程式將本次擷取的全部正文交給模型，要求先讀完再判斷是否相關。分類結果、略過理由、正文與模型名稱保存在 D1。
DevDay 即使標成 Company 也列在關注主題，不依 RSS category 直接刪除。
這套分類仍能判斷錯誤；調整主題與查看 `summary_json.reason` 可以追查誤刪。
程式沒有執行一般網路搜尋，也不會自動加入未設定的網站。

新來源首次執行會補收最近 14 天有日期的文章。沒有日期時只先處理來源列表第一篇，其餘列為基準。
後續所有新網址先寫入待處理清單，再依執行額度逐篇處理。超出額度的文章保留在 D1，不會標成已完成。
每次最多嘗試 6 篇，輪流分配給各來源。處理失敗的文章保留錯誤訊息，下次重試。
來源列表本身沒有顯示的文章仍會漏掉；要改善這類漏收需加入其他官方入口、RSS 或 sitemap 支援。
每個來源目前最多取入口清單前 80 篇，再於 RSS 分支按日期排序；不代表讀取網站所有歷史文章。

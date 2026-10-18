# 08: X 長文經 API 取得

**What to build:** 以一次真實 X API 讀取確認貼文欄位能否取得 X 長文全文；可以則在讀取貼文時帶入長文正文，不再列為缺漏。

**Blocked by:** 無

**Status:** done

- [x] 真實讀取只記錄欄位可用與否的結論，不保存內容與帳號資訊
- [x] 可用時解析長文並以合成回應測試
- [ ] ~~不可用時記錄結論，交由 09 處理~~（API 可用，不適用）

## 結論

- X API 讀取貼文時，`article` 欄位可以取得 X 長文全文。`tweet.fields` 與 `post.fields` 兩種參數名稱都接受 `article`，回應都是 200。
- 回應的 `data.article` 含 `title`、`plain_text`（全文純文字）、`preview_text`、`cover_media`、`media_entities`、`entities`（`code`、`mentions`、`urls`）。`post.fields` 另外回傳 `data.article_title`。長文網址本身仍在貼文的 `entities.urls`。
- 實測只用一則連到 X 長文的公開貼文，兩種參數名稱各讀一次；沒有 refresh token，沒有保存回應內容。

## 實作

- `postParameters` 的貼文欄位加入 `article`，兩種參數名稱都帶。
- `normalizePost` 遇到 `article.plain_text` 時，把貼文連到的長文網址（正規化為 `https://x.com/i/article/<id>`）另存成一筆 `external` 來源，`content_method` 為 `x_api`；貼文沒有長文網址時，把標題與全文接在主文後面。
- 主貼文、父貼文與引用、作者續寫、書籤同步帶進來的貼文，都會保存附帶的長文來源。之後整理外部連結時，該長文已有可用原文，不再建立 Mac 代抓工作。
- 使用者手動貼上的原文不會被 API 取得的版本覆蓋。
- API 沒附上長文時（例如作者刪除、權限不足），仍走 09 的 Mac 代抓與 07 的手動貼上。

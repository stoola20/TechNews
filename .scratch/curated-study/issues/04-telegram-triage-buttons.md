# 04: Telegram 通知的篩選按鈕

**What to build:** 送出完成或更新通知時，若文章仍是待決定，訊息附「保留」「保留並 ★」「刪除」三個按鈕。按下後套用到文章庫，訊息的按鈕換成結果與「復原」。Webhook 開始接收 `callback_query`，只接受通知頻道與允許對話的按鈕。

**Blocked by:** 01：篩選結果、最近刪除與列表檢視

**Status:** done

- [x] 按鈕在送出時依當下的篩選結果決定；已處理的文章不附按鈕
- [x] `callback_data` 為 `t:<動作>:<文章 id>`，不超過 64 bytes
- [x] 回呼沿用 secret header 驗證；chat 不是 `TELEGRAM_CHAT_ID` 或允許清單時回 200 並忽略
- [x] 套用後呼叫 `answerCallbackQuery` 與 `editMessageReplyMarkup`；復原回到按下前的結果，回到待決定時重新顯示三個按鈕
- [x] 重複回呼結果相同；文章已清除時提示並移除按鈕
- [x] 設定文件的 `setWebhook` 範例加入 `callback_query`
- [x] 測試用假 Telegram 網路驗證送出、回呼、編輯與忽略

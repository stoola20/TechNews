# 13: Prettier 一次性重排

**What to build:** 導入 Prettier（單引號、每行最多 120 字元），提供 `format` 與 `format:check` 指令，並一次性重排 Worker 程式與測試。重排放在只含排版變更的獨立 commit，並加入 `.git-blame-ignore-revs`，`git blame` 會略過它。

**Blocked by:** 02–12

**Status:** done

- [x] Prettier 設定與指令加入專案
- [x] 重排 commit 只含排版變更；字串中的 HTML、CSS、內嵌腳本不受影響
- [x] `.git-blame-ignore-revs` 記錄重排 commit；README 註明 `git blame --ignore-revs-file` 的用法
- [x] 重排前後全部測試通過，`format:check` 通過

## 實作紀錄

- 導入 Prettier 3.9.9（固定版本）：單引號、每行最多 120 字元，另設 `embeddedLanguageFormatting: off`，確保字串裡的 HTML、CSS 與內嵌腳本不被重排。`npm run format` 重排、`npm run format:check` 檢查，範圍是 Worker 程式、測試、腳本、執行器與驗收素材；wrangler 產生的型別檔不重排。
- 設定與重排分成兩個 commit；重排 commit 只含排版變更，記在根目錄 `.git-blame-ignore-revs`，README 註明 `git blame --ignore-revs-file` 與 `blame.ignoreRevsFile` 的用法。
- 驗證：重排前後全部測試通過；所有模組匯出的字串（頁面、樣式、提示詞）雜湊完全相同；`format:check` 通過（有一處串接呼叫需要第二次重排才穩定，已一併納入）；`git blame` 加上參數後顯示原本的 commit；本機示範重排後照常啟動。

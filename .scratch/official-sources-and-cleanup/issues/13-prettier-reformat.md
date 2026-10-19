# 13: Prettier 一次性重排

**What to build:** 導入 Prettier（單引號、每行最多 120 字元），提供 `format` 與 `format:check` 指令，並一次性重排 Worker 程式與測試。重排放在只含排版變更的獨立 commit，並加入 `.git-blame-ignore-revs`，`git blame` 會略過它。

**Blocked by:** 02–12

**Status:** ready-for-agent

- [ ] Prettier 設定與指令加入專案
- [ ] 重排 commit 只含排版變更；字串中的 HTML、CSS、內嵌腳本不受影響
- [ ] `.git-blame-ignore-revs` 記錄重排 commit；README 註明 `git blame --ignore-revs-file` 的用法
- [ ] 重排前後全部測試通過，`format:check` 通過

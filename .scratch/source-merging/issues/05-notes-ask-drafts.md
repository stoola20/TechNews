# 05: 筆記與追問擺放設計稿

**What to build:** 用 ui-ux-pro-max 產出兩份可比較的設計稿（桌機＋手機），讓使用者選定筆記與追問的位置。

**Blocked by:** 無

**Status:** done（選定 B）

- [x] A：桌機三欄，左側列表與右側筆記／追問欄都可收合或展開
- [x] B：畫面下方懸浮、可收合的筆記／追問對話框
- [x] 兩份都附手機版，放 `docs/previews/`，以合成資料呈現
- [x] 等使用者選定（HITL）：B

## 實作紀錄

- `docs/previews/notes-ask-a.html`、`notes-ask-b.html`：可互動的合成資料設計稿，沿用文章庫現有色彩與元件尺寸。網址加 `#collapsed`、`#sheet`、`#ask`（A）或 `#open`、`#note`（B）可直接顯示對應狀態。
- 依 ui-ux-pro-max 的 UX 準則：固定浮層不能遮住焦點與正文（B 展開時閱讀區加同高的底部留白）、可收合控制都有 `aria-expanded` 與文字標籤、Escape 關閉面板後焦點回到開啟按鈕、觸控目標至少 44px、尊重 reduced-motion。資料庫沒有側欄／底部面板的專屬條目，版面取捨依一般準則判斷。
- 截圖（本機產生、不進 repo）：桌機 1440×900 與手機 390×844，各含收合／展開狀態。

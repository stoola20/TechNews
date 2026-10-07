Claude Code mod 入門：從零建立 Token Weather 並探索進階應用
claude.dev｜2026-10-01

Claude Code 2.1.287 版起內建支援 mods，這是一種以 JavaScript 或 TypeScript 撰寫的小型模組，能在 Claude Code 工作階段中攔截事件、修改行為或繪製自訂 UI。mod 本質上是一種掛載在插件系統中的鉤子，每次使用者互動（如執行工具、送出提示、畫面重繪）時都會觸發對應事件，讓開發者得以觀察、改寫或完全接管原本的流程。

mod 的核心是透過 register(on, options) 函式註冊鉤子，使用 on(event, matcher?, hook) 來監聽特定事件。每個鉤子收到事件後，可以選擇三種行動之一：觀察（呼叫 next(e) 後檢查結果）、改寫（修改事件內容後再傳遞）或回答（直接回傳結果而不呼叫 next，從而阻止預設行為）。例如，ui.render 事件允許 mod 在提示上方繪製自訂橫幅，而 tool.call 則能攔截 Bash 指令以實作安全防護。

為了持久化資料（如歷史讀取），mod 應使用 $.state 而非模組層級變數，因為熱重載會重新執行 register 並清除記憶體狀態；而 $.state 由主機保存，能跨重載保留資料。同時，mod 必須在 types/index.d.ts 中宣告其使用的 state 結構，並將此檔案路徑加入 plugin.json 的 types 欄位，否則驗證會失敗。Claude Code 會在載入 mod 時自動產生類型宣告至 .claude-plugin/types/ 資料夾，供編譯與編輯器使用。

文章以 Token Weather 為範例，示範如何建立一個即時顯示內容視窗使用率的 mod。它在每次 turn.complete 後讀取 $.session.usage() 中的 token 數量與視窗大小，計算百分比，並將結果存入 $.state。在 ui.render 事件中，它根據目前使用率選擇對應的天氣圖示（☀ Clear、☁ Cloudy、☂ Showers、☇ Storm、↯ Compact soon），並繪製一條橫幅，包含百分比、token 數、最近 12 次的微型長條圖以及上次變動量。此 mod 共約 80 行程式碼，透過熱重載即時更新，開發者可邊改邊看效果。

進階範例 Blast Radius 展示了如何攔截高風險的 Bash 指令（如 rm -rf），透過 tool.call 鉤子暫停執行，分析指令將影響的檔案，然後在彈出窗格或提示上方顯示「Proceed」與「Cancel」選項。使用者按下對應數字鍵（1 或 2）即可決定是否放行。此 mod 利用 $.process.run 執行乾跑指令（如 git status --porcelain、git clean -n）來產生報告，並透過 $.ui.open 開啟互動面板，決策迴圈中使用短暫 sleep 來等待輸入，而不消耗鉤子的時間配額。

另一個範例 Replay Theater 則專注於紀錄與回放編輯歷史。它在 tool.call 中捕獲 Edit 和 Write 操作的前後內容，產生實際 diff；在 turn.complete 時將該回合的所有編輯存為可回放序列；並透過 session.start 註冊 /replay 指令，讓使用者可隨時開啟面板逐步瀏覽變更。此 mod 強調不干預原始操اة，僅作為觀察與複核工具。

文章結尾提供四個開發習慣建議：一是信任 Claude Code 自動產生的類型定義；二是從 e.props 讀取介面屬性（如 bodyColumns、hasSurvey）；三是將狀態存入 $.state 以應付熱重載；四是當 UI 未顯示時，透過 claude --debug 檢查日誌以驗證鉤子回傳值是否符合元件樹規範。

最後，作者鼓勵開發者根據自身需求擴展 mod 應用，例如根據使用量顯示成本 metre、在提示中自動注入團隊慣例、建立已讀檔案的實時地圖、設定專注計時器或依據生產環境限制工具使用。所有 mod 皆可透過插件機制分享：建立含 marketplace.json 的資料夾，透過 claude plugin marketplace add 與 install 指令匯入，或發布至 GitHub 並設定為公開市場。安裝後需執行 /reload-plugins 使其生效。

原文：https://claude.dev/blog/getting-started-with-claude-code-mods
Claude Code Mods 開發指南：透過 Hook 與自訂 UI 打造個人化 AI 編碼代理
claude.dev｜2026-10-01

Claude Code 推出了名為 mods 的擴充機制，讓開發者可以透過編寫簡單的 JavaScript 或 TypeScript 檔案，在 Claude Code 的執行階段中植入自定義邏輯。這些 mods 本質上是運行在 Claude Code session 內部的插件，能透過觀察、改寫或直接回應事件，來改變 AI 的行為或繪製自訂的終端機與桌面 UI。

Mods 的核心運作邏輯類似於中間件（middleware）的 Hook 機制。開發者可以透過 on 函式註冊不同的事件，例如工具調用（tool.call）、對話輪次結束（turn.complete）或介面渲染（ui.render）。當事件觸發時，mod 可以採取三種行動：觀察（Observe）僅記錄資料而不干擾流程；改寫（Rewrite）修改事件內容後傳遞給下一層；或直接回答（Answer）攔截該事件，例如拒絕某個危險的指令。

為了提供流暢的開發體驗，Claude Code 支援熱重載（Hot reload），開發者在修改程式碼並儲存後，mod 會在不重啟 session 的情況下立即生效。由於熱重載會導致模組變數重置，因此文章強調開發者必須使用 $.state API 來儲存需要跨重載持續存在的資料，這能確保插件的狀態（例如歷史紀錄）不會因開發過程中的修改而消失。

透過這些機制，開發者可以實作功能強大的工具。例如 Token Weather mod 可以監控上下文視窗（context window）的使用量，並用天氣圖示直觀地顯示剩餘空間；Blast Radius mod 則扮演安全防護的角色，當 AI 嘗試執行如 rm -rf 等高風險指令時，會先攔截並開啟一個預覽面板，要求使用者確認或取消；Replay Theater mod 則能記錄 AI 在每一輪修改中的檔案變動，讓開發者可以像走步一樣逐一檢視編輯內容。

開發流程也相當完整，提供了 claude plugin validate 用於檢查 manifest 與 Hook 是否正確，以及 claude plugin test 用於在模擬環境下測試插件邏輯。此外，開發者甚至可以利用 Claude Code 本身來撰寫 mods，只需描述需求，讓 AI 自動生成符合 API 規範的程式碼與結構。

原文：https://claude.dev/blog/getting-started-with-claude-code-mods
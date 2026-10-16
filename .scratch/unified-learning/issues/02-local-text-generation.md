# 02: 網站分享純文字文章，經 Mac 產生詳細教材

**What to build:** 網站加入一篇純文字文章，雲端保存來源與工作，Mac 經專用憑證主動領取、使用原生 Ollama Gemma、驗證並回報，使用者能在文章庫讀完整內容與來源。

**Blocked by:** 01：共同文章庫與既有資料相容搬移

**Status:** done

- [x] 基本領取／續約／回報契約、輸入與 attempt 身分及單工限制成立
- [x] 重複連結重用同篇
- [x] 完整來源尾端有進模型
- [x] 詳細正文、引用、模型資訊及介紹保存
- [x] 未完成或無效模型輸出不標完成
- [x] 純文字不呼叫 Flash
- [x] 本機離線顯示等待
- [x] 新路徑受切換設定控制，現有正式路徑尚可運作。

## 實作紀錄

- `migrations/0006_local_jobs.sql`、`src/learning/local.js`：工作、lease、attempt token、單工領取、續約、回報、失敗與交回。
- `src/learning/local-prompt.js`：Worker 與執行器共用的提示、區段輸出格式與驗證（本機 MLX runner 不支援 schema 限制輸出）。
- `runner/`：Mac 執行器、設定範本與說明；`scripts/learning-demo.mjs` 可用 `DEMO_LOCAL=1` 搭配真實 Ollama 驗證。
- 切換由 `learning:text` 設定（或 `LEARNING_TEXT_PROVIDER`）控制，預設仍為 Gemini。
- 驗證：`tests/local.test.js`（模擬 Ollama 串流）；另以本機 `gemma4:26b` 跑示範伺服器兩篇文章，皆完成並保存。

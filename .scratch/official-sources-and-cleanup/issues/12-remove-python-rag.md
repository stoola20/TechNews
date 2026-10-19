# 12: 移除 Python RAG

**What to build:** 從 repo 移除獨立的 Python RAG 問答服務：API、資料庫遷移、設定範例、測試與套件設定。README 移除對應章節與文件地圖項目。需要時可以從 git 歷史找回。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Python 服務與相關設定、測試、遷移、套件設定移除
- [x] `.gitignore` 與文件中只服務 Python 的項目一併整理
- [x] README 與文件地圖不再提到 RAG 服務；架構文件移除「與 RAG 服務的關係」
- [x] Worker 測試全部通過

## 實作紀錄

- 移除 Python RAG 服務：API、資料庫遷移、測試、套件設定與設定範例；需要時可從 git 歷史找回。
- README 移除「選用：RAG 問答服務」一節、文件導覽、目前狀態與專案結構裡的 RAG 項目，文件地圖補上本次規格；架構文件移除「與 RAG 服務的關係」。
- `.gitignore` 移除設定範例的例外規則；本機可能還留著舊服務的設定檔與快取，因此 `.db.env*`、`.venv/`、`__pycache__/` 等忽略規則保留並註明原因，避免含帳密的檔案被誤加入。
- 驗證：Worker 測試全部通過；文件中不再提到 RAG 服務、FastAPI、pgvector 或 uv 指令。

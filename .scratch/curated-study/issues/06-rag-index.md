# 06: 保留文章的 RAG 索引

**What to build:** 保留文章的教材正文、原始來源與媒體解析切成片段，用 Workers AI EmbeddingGemma 取前 512 維寫進 Vectorize，片段位置記在 D1。維護排程在保留、內容更新、取消保留與刪除時建立、重建或移出索引。管理頁顯示索引狀態、估計儲存維度與 Free 額度比例，並可重建。

**Blocked by:** 01：篩選結果、最近刪除與列表檢視

**Status:** done

- [x] 設定檔新增 Vectorize binding `LIBRARY_INDEX`（512 維、cosine）；設定文件提供建立指令
- [x] 以 Cloudflare 模型目錄確認 EmbeddingGemma 的維度、前綴與批次上限，程式註解寫查核日
- [x] migration 新增 `learning_chunks` 與文章的索引欄位、索引
- [x] 切塊規則：正文依標題與段落約 600–1,000 字；來源約 1,000–1,500 字；媒體解析每則一段
- [x] 維護排程每輪最多 3 篇；先寫新向量再刪舊向量；非保留文章移出索引
- [x] 失敗累計次數並延後重試，連續 5 次後停止，revision 改變或手動重建時恢復
- [x] 管理頁「RAG 索引」區塊與重建按鈕
- [x] 測試用假 embedding 與記憶體 Vectorize 驗證建立、更新、移出、上限與失敗重試

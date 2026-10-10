# 本專案工作追蹤

本專案使用本機 Markdown 作為 issue tracker。規格保存在 `docs/specs`，實作計畫保存在 `docs/plans`。

X 收藏學習工具的 tickets 保存在 `.scratch/x-learning/issues`，一個檔案對應一個 ticket。依阻擋關係編號，先完成前置項目，再處理已解除阻擋的工作。

待開發規格與已核准的 tickets 使用 `ready-for-agent` 狀態。開發中使用 `in-progress`；完成驗收使用 `done`。外部憑證或真實素材尚未具備時，分別記錄已完成的程式驗證與未完成的實測，不能將模擬測試寫成真實驗收。

spec 與 tickets 沿用使用者指定的 to-spec、to-tickets 格式。tickets 的粒度與阻擋關係由使用者確認後發布；不自動建立 GitHub Issues。

有效需求保存在規格；測試證據、外部介面查核與維運紀錄另存，不放進教材正文。

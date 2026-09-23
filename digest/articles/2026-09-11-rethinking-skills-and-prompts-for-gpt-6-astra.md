# 重新思考 GPT-6 Astra 的技能與提示詞

- 原文標題：Rethinking skills and prompts for GPT-6 Astra
- 發布日期：2026-09-11
- 作者：Eric Provencher
- 來源：OpenAI Developer Blog
- 原文連結：https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra

## 繁體中文摘要

隨著程式代理能力提升，過去為了引導模型而累積的大量指示，現在可能增加雜訊與執行負擔。文章建議重新檢查技能描述、`AGENTS.md` 與任務提示詞：技能描述要短且觸發條件明確；複雜技能以漸進揭露方式只載入當下需要的內容；儲存庫指示應依情境提供，而不是要求每次修改都讀完所有文件。對較長的工作，則要明確說明完成條件及可以持續處理的範圍。

## 技術重點

1. 技能太多、描述太長時，代理可能截短描述，反而更難正確選用技能；描述應聚焦於具體的使用時機。
2. 複雜技能的根文件宜作為簡短入口，依需要再讀補充文件或腳本，減少不相關內容進入上下文。
3. 定期檢視 `AGENTS.md`：避免把大量讀文件或重複測試要求套用到每一次小修改。
4. 舊模型需要的細緻操作步驟，對更強的新模型未必有幫助；應依模型能力調整指示。
5. 長任務要寫清楚完成標準與可繼續推進的範圍，避免代理在第一個實作版本就過早停下。

## 對 iOS／AI 開發可能有用的地方

以下是根據文章內容的應用推論，不是原文直接提出的 iOS 開發結論。

- 對 iOS 專案，可讓 `AGENTS.md` 只保留每次都適用的規則，將特定建置、效能或 UI 工作流程放到對應技能，降低無關指示干擾。
- 對 AI 開發流程，可檢查技能觸發描述是否過寬，並為長任務寫出可驗證的完成條件。

## 關鍵字

`Codex`、`GPT-6 Astra`、`Skills`、`AGENTS.md`、`提示詞`、`代理工作流程`

## 手機通知短版

有新文章：〈Rethinking skills and prompts for GPT-6 Astra〉

- 精簡技能描述，讓代理更容易選到正確技能。
- 複雜技能只載入當下需要的文件。
- 定期精簡 `AGENTS.md`，讓規則依工作情境生效。
- 長任務寫清楚完成標準，避免太早停下。

原文：https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra

import test from "node:test";
import assert from "node:assert/strict";
import { formatAlert, formatFullDigest, parseSummaryResult } from "../src/format.js";

const summary = { title_zh: "測試標題", summary_zh: "這是一篇針對開發者的重要技術整理，內容完整且可供日後查找。文章同時說明具體做法與使用情境。", key_points: ["第一點", "第二點", "第三點"], relevance_zh: "這是對 AI 開發的應用推論。", keywords: ["AI", "開發"] };
const source = { name: "Claude Blog" };
const entry = { title: "Test title", publishedAt: "2026-09-23", url: "https://claude.com/blog/test" };

test("validates structured summary and formats two Telegram messages", () => {
  const parsed = parseSummaryResult({ response: JSON.stringify(summary) });
  assert.deepEqual(parsed, summary);
  assert.match(formatFullDigest(source, entry, parsed), /應用推論/);
  assert.match(formatAlert(source, entry, parsed), /• 第三點/);
});

test("accepts response already parsed into an object by Workers AI", () => {
  assert.deepEqual(parseSummaryResult({ response: summary, choices: [{ message: { content: JSON.stringify(summary) } }] }), summary);
});

test("rejects uncited or incomplete AI structure", () => {
  assert.throws(() => parseSummaryResult({ response: '{}' }), /title/);
});

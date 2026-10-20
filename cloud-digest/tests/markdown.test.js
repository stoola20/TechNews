import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMarkdown, renderMarkdown } from '../src/learning/markdown.js';
import { LEARNING_PAGE } from '../src/learning/page.js';
import { Script } from 'node:vm';

test('教材渲染標題、列表、表格與程式碼，移除可執行內容', () => {
  const html = renderMarkdown(
    '### 機制\n\n- **重點**與 `code`\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconsole.log("ok")\n```\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert) [safe](https://example.org)',
  );
  for (const tag of ['<h3>', '<ul>', '<strong>', '<table>', '<pre><code']) assert.ok(html.includes(tag));
  assert.doesNotMatch(html, /<script|<img|onerror|javascript:/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('只修復整篇雙重跳脫的段落，不破壞程式碼中的換行字面值', () => {
  const legacy = '### 背景\\n\\n說明 `printf("\\n")`。\\n\\n- 操作';
  assert.equal(normalizeMarkdown(legacy), '### 背景\n\n說明 `printf("\\n")`。\n\n- 操作');
  assert.equal(normalizeMarkdown('正常\n\n`\\n`'), '正常\n\n`\\n`');
  assert.equal(normalizeMarkdown('`first\\n\\nlast`'), '`first\\n\\nlast`');
  assert.equal(normalizeMarkdown('```js\nconst s="\\n"\n```'), '```js\nconst s="\\n"\n```');
  assert.match(renderMarkdown(legacy), /<h3>背景<\/h3>/);
});

test('內嵌頁面腳本可解析，正文與回答均使用清理後的 HTML', () => {
  new Script(LEARNING_PAGE.match(/<script>([\s\S]*)<\/script>/)[1]);
  assert.match(LEARNING_PAGE, /content.innerHTML=current.body_html/);
  assert.match(LEARNING_PAGE, /innerHTML=q.answer_html/);
  assert.match(LEARNING_PAGE, /開始整理這篇/);
  // 待回補文章與其他文章共用篩選按鈕：刪除先進最近刪除。
  assert.doesNotMatch(LEARNING_PAGE, /刪除這篇待回補/);
  assert.match(LEARNING_PAGE, /api\('items\/'\+id\+'\/triage','PUT'/);
  // 專注模式的開關存在這台裝置；讀寫都包在 try/catch 裡，讀不到時預設關閉。
  assert.match(
    LEARNING_PAGE,
    /try\{this\.on=localStorage\.getItem\('technews-focus'\)==='1';\}catch\(e\)\{this\.on=false;\}/,
  );
  assert.match(LEARNING_PAGE, /try\{localStorage\.setItem\('technews-focus'/);
});

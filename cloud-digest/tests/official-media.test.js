import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { acquireEvidence } from '../src/learning/evidence.js';
import { prepareMedia } from '../src/learning/media.js';
import { item, rows, query } from '../src/learning/store.js';
import { SOURCES, loadArticle } from '../src/sources.js';
import { environment, recorder } from './helpers.js';

const NOW = Date.parse('2026-10-19T00:00:00Z'),
  now = () => NOW;
const body = '背景、機制、例子與操作步驟。'.repeat(40);
const POST = 'https://developers.openai.com/blog/post-0';
const page = (inner) =>
  `<html><body><header><img src="/hero.png" width="1200"></header><article><h1>Official</h1><p>${body}</p>${inner}</article></body></html>`;

// 官方來源只開 OpenAI 開發者部落格，發現一篇文章並排進佇列。
async function officialItem(article) {
  const env = environment(),
    net = recorder();
  const handler = createLearningHandler({
    ...net,
    now,
    discoverSource: async (source) =>
      source.id === 'openai_developer_blog'
        ? [{ url: POST, title: 'Post', publishedAt: new Date(NOW).toUTCString() }]
        : [],
  });
  await query(
    env,
    "INSERT INTO settings(key,value_json,updated_at) VALUES('digest',?,?)",
    JSON.stringify({ interests: 'AI agents', sources: [SOURCES[0]] }),
    new Date().toISOString(),
  ).run();
  assert.equal((await handler.service.official(env)).queued, 1);
  const [{ id }] = await rows(env, 'SELECT id FROM learning_items');
  const deps = {
    loadArticle: async (source, entry) => ({ ...entry, content: body, contentMethod: 'article_html', ...article }),
  };
  return { env, net, handler, id, deps };
}
const media = async (env, id) =>
  (await rows(env, 'SELECT url,type,status,error FROM learning_media WHERE item_id=? ORDER BY rowid', id)).map((r) => ({
    ...r,
  }));

test('官方文章從網頁 HTML 的正文區塊收圖片，排除裝飾圖片與重複', async () => {
  const html = page(
    '<img src="/diagrams/flow.png" width="960"><img src="/brand/logo.png"><img src="/tiny.png" width="32"><img src="/diagrams/flow.png">',
  );
  const s = await officialItem({ html });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  assert.deepEqual(await media(s.env, s.id), [
    { url: 'https://developers.openai.com/diagrams/flow.png', type: 'photo', status: 'pending', error: null },
  ]);
});

test('官方網頁 HTML 取不到：登記一筆待處理缺漏寫明原因，媒體處理不下載它', async () => {
  const s = await officialItem({ htmlError: 'Source HTTP 503' });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  const [asset] = await media(s.env, s.id);
  assert.equal(asset.status, 'needs_attention');
  assert.match(asset.error, /官方網頁取不到.*503/);
  // 補取重設後仍不下載，錯誤原因保留。
  await query(s.env, "UPDATE learning_media SET status='pending' WHERE item_id=?", s.id).run();
  const result = await prepareMedia(s.env, s.id, s.net.fetcher);
  assert.equal(s.net.calls.length, 0);
  assert.match(result.gaps[0].error, /官方網頁取不到/);
});

test('loadArticle：一般來源帶回抓到的 HTML；Markdown 來源另抓網頁 HTML，失敗時說明原因', async () => {
  const html = page('');
  const blog = await loadArticle(SOURCES[0], { url: POST }, async () => new Response(html));
  assert.equal(blog.html, html);
  const markdown = '# Tutorial\n\n' + 'Paragraph. '.repeat(60);
  const requested = [];
  const dev = await loadArticle(SOURCES[4], { url: 'https://claude.dev/blog/tutorial/' }, async (url) => {
    requested.push(url);
    return new Response(url.endsWith('.md') ? markdown : html);
  });
  assert.deepEqual(requested, ['https://claude.dev/blog/tutorial.md', 'https://claude.dev/blog/tutorial/']);
  assert.equal(dev.content, markdown);
  assert.equal(dev.html, html);
  const failed = await loadArticle(SOURCES[4], { url: 'https://claude.dev/blog/tutorial' }, async (url) =>
    url.endsWith('.md') ? new Response(markdown) : new Response('down', { status: 503 }),
  );
  assert.equal(failed.contentMethod, 'official_markdown');
  assert.match(failed.htmlError, /503/);
});

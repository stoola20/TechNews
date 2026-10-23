import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { acquireEvidence, requestRefetch } from '../src/learning/evidence.js';
import { prepareMedia } from '../src/learning/media.js';
import { item, rows, query } from '../src/learning/store.js';
import { SOURCES, loadArticle } from '../src/sources.js';
import { environment, recorder, request } from './helpers.js';

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

// Gemini 檔案上傳的替身：截圖存進 R2 之後照常上傳。
function gemini(url) {
  if (url.hostname !== 'generativelanguage.googleapis.com') return null;
  if (url.pathname === '/upload/v1beta/files')
    return new Response(null, {
      headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/session/1' },
    });
  return Response.json({
    file: { name: 'files/f1', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1' },
  });
}
function browser(respond = () => new Response(new Uint8Array(4096), { headers: { 'content-type': 'image/png' } })) {
  const calls = [];
  return {
    calls,
    async quickAction(kind, options) {
      calls.push({ kind, options });
      return respond(options);
    },
  };
}
const figures = `
  <figure aria-label="effort curve"><svg width="634" height="468" viewBox="0 0 634 468"></svg><figcaption>FIG A</figcaption></figure>
  <figure aria-label="interactive app"><div class="efx"><button>low</button><button>high</button></div></figure>
  <figure><pre><code>npm install</code></pre><figcaption>安裝指令</figcaption></figure>
  <figure><svg width="16" height="16" viewBox="0 0 16 16"></svg></figure>
  <figure><img src="/diagrams/photo.png" width="960"><figcaption>照片</figcaption></figure>
  <figure aria-label="chart"><canvas></canvas></figure>`;

test('正文圖表：SVG、互動元件、canvas 登記成截圖媒體；程式碼、小圖示、已有 <img> 的 figure 不截', async () => {
  const html = `<html><body><aside><figure aria-label="側欄"><svg width="900" height="900"></svg></figure></aside>${page(figures)}</body></html>`;
  const s = await officialItem({ html });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  assert.deepEqual(
    (await media(s.env, s.id)).map((m) => [m.url, m.status]),
    [
      ['https://developers.openai.com/diagrams/photo.png', 'pending'],
      [POST + '#technews-figure-1', 'pending'],
      [POST + '#technews-figure-2', 'pending'],
      [POST + '#technews-figure-6', 'pending'],
    ],
  );
});

test('正文圖表每篇最多 8 張，多的登記為待處理並寫明原因', async () => {
  const many = Array.from({ length: 10 }, (_, i) => `<figure aria-label="chart ${i}"><canvas></canvas></figure>`);
  const s = await officialItem({ html: page(many.join('')) });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  const list = await media(s.env, s.id);
  assert.equal(list.filter((m) => m.status === 'pending').length, 8);
  assert.deepEqual(
    list.filter((m) => m.status === 'needs_attention').map((m) => [m.url.split('#')[1], m.error]),
    [
      ['technews-figure-8', '正文圖表超過 8 張，這張沒有截圖'],
      ['technews-figure-9', '正文圖表超過 8 張，這張沒有截圖'],
    ],
  );
});

test('截圖流程：標記第 N 個 figure 只截那個元素，存進 R2 後照常上傳 Gemini；到期後重新截圖', async () => {
  const s = await officialItem({ html: page(figures) });
  s.env.BROWSER = browser();
  const net = recorder(async (url) => gemini(url));
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  await query(
    s.env,
    "UPDATE learning_media SET status='decorative' WHERE item_id=? AND url NOT LIKE ?",
    s.id,
    '%figure-1',
  ).run();
  const result = await prepareMedia(s.env, s.id, net.fetcher);
  assert.equal(result.media.length, 1);
  assert.equal(s.env.BROWSER.calls.length, 1);
  const call = s.env.BROWSER.calls[0];
  assert.equal(call.kind, 'screenshot');
  assert.equal(call.options.url, POST);
  assert.equal(call.options.selector, '[data-technews-figure]');
  assert.match(call.options.addScriptTag[0].content, /querySelectorAll\('figure'\)\[1\]/);
  const [asset] = await rows(s.env, "SELECT * FROM learning_media WHERE item_id=? AND status='ready'", s.id);
  assert.equal(asset.mime, 'image/png');
  assert.equal(s.env.MEDIA.objects.get(asset.object_key).bytes.length, 4096);
  // 沒有對原文網址發出一般下載。
  assert.equal(net.calls.filter((c) => c.url.startsWith(POST)).length, 0);
  // 30 天到期清掉 R2 後，補取時重新截圖。
  await query(
    s.env,
    "UPDATE learning_media SET object_key=NULL,file_json=NULL,status='pending' WHERE id=?",
    asset.id,
  ).run();
  await prepareMedia(s.env, s.id, net.fetcher);
  assert.equal(s.env.BROWSER.calls.length, 2);
});

test('截圖失敗：沒有 Browser Rendering、回應錯誤或不是 PNG 都記錯誤，三次後待處理', async () => {
  const s = await officialItem({ html: page('<figure aria-label="chart"><canvas></canvas></figure>') });
  const net = recorder(async (url) => gemini(url));
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  let result = await prepareMedia(s.env, s.id, net.fetcher);
  assert.equal(result.pending, true);
  assert.match(result.gaps[0].error, /未設定 Browser Rendering/);
  s.env.BROWSER = browser(() => Response.json({ errors: ['selector not found'] }, { status: 422 }));
  result = await prepareMedia(s.env, s.id, net.fetcher);
  assert.match(result.gaps[0].error, /截圖失敗（HTTP 422）/);
  s.env.BROWSER = browser(() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
  result = await prepareMedia(s.env, s.id, net.fetcher);
  assert.equal(result.pending, false);
  assert.equal(result.gaps[0].status, 'needs_attention');
  assert.equal(s.env.MEDIA.objects.size, 0);
});

const setting = async (env, id) =>
  !!(await query(env, 'SELECT 1 FROM settings WHERE key=?', 'learning:refetch:' + id).first());
const primaryContent = async (env, id) =>
  (await query(env, "SELECT content FROM learning_evidence WHERE item_id=? AND relation='primary'", id).first())
    .content;

test('補取並整理：官方文章重抓原文，同一筆證據更新內容、補登記圖片並移除網頁缺漏', async () => {
  const s = await officialItem({ htmlError: 'Source HTTP 503' });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  const before = await primaryContent(s.env, s.id);
  assert.equal((await s.handler.fetch(request('api/items/' + s.id + '/retry', 'POST', {}), s.env)).status, 202);
  assert.equal(await setting(s.env, s.id), true);
  const deps = {
    loadArticle: async (source, entry) => ({
      ...entry,
      content: body + '更新段落',
      contentMethod: 'article_html',
      html: page('<img src="/diagrams/new.png" width="960">'),
    }),
  };
  await acquireEvidence(s.env, await item(s.env, s.id), deps);
  assert.notEqual(await primaryContent(s.env, s.id), before);
  assert.match(await primaryContent(s.env, s.id), /更新段落/);
  assert.equal(
    (await rows(s.env, "SELECT id FROM learning_evidence WHERE item_id=? AND relation='primary'", s.id)).length,
    1,
  );
  assert.deepEqual(
    (await media(s.env, s.id)).map((m) => m.url),
    ['https://developers.openai.com/diagrams/new.png'],
  );
  assert.equal(await setting(s.env, s.id), false);
  // 標記清掉後，下次處理沿用已存原文，不再重抓。
  let loads = 0;
  await acquireEvidence(s.env, await item(s.env, s.id), { loadArticle: async () => (loads++, {}) });
  assert.equal(loads, 0);
});

test('重抓失敗：標記保留、原文不變，文章照一般失敗流程重試', async () => {
  const s = await officialItem({ html: page('') });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  await s.handler.fetch(request('api/items/' + s.id + '/retry', 'POST', {}), s.env);
  await assert.rejects(
    acquireEvidence(s.env, await item(s.env, s.id), {
      loadArticle: async () => {
        throw new Error('Source HTTP 500');
      },
    }),
    /500/,
  );
  assert.equal(await setting(s.env, s.id), true);
  assert.equal(await primaryContent(s.env, s.id), body);
});

test('重抓不覆蓋手動貼上的原文，但仍補登記網頁圖片', async () => {
  const s = await officialItem({ html: page('') });
  await acquireEvidence(s.env, await item(s.env, s.id), s.deps);
  await query(
    s.env,
    "UPDATE learning_evidence SET content='使用者貼上的原文',metadata_json=json_set(metadata_json,'$.provided_by','user') WHERE item_id=?",
    s.id,
  ).run();
  await s.handler.fetch(request('api/items/' + s.id + '/retry', 'POST', {}), s.env);
  await acquireEvidence(s.env, await item(s.env, s.id), {
    loadArticle: async (source, entry) => ({
      ...entry,
      content: body,
      html: page('<img src="/a/chart.png" width="900">'),
    }),
  });
  assert.equal(await primaryContent(s.env, s.id), '使用者貼上的原文');
  assert.deepEqual(
    (await media(s.env, s.id)).map((m) => m.url),
    ['https://developers.openai.com/a/chart.png'],
  );
});

test('非官方文章與 X 貼文按補取不留重抓標記', async () => {
  const s = await officialItem({ html: page('') });
  await query(s.env, 'DELETE FROM learning_intakes WHERE item_id=?', s.id).run();
  await s.handler.fetch(request('api/items/' + s.id + '/retry', 'POST', {}), s.env);
  assert.equal(await setting(s.env, s.id), false);
  assert.equal(await requestRefetch(s.env, { id: 'x1', kind: 'x' }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { setTextProvider, claim } from '../src/learning/local.js';
import { validateMediaAnalysis } from '../src/learning/media-analysis.js';
import { item, rows, query } from '../src/learning/store.js';
import { runOnce, loadConfig } from '../runner/lib.js';
import { environment, recorder, request, message, iso } from './helpers.js';

const VIDEO_MS = 95000;
const goodVideo = {
  ocr: { status: 'text', text: 'Settings > Developer > Enable' },
  speech: {
    status: 'transcribed',
    segments: [{ start: '00:05', end: '00:12', text: 'Open the developer settings first.' }],
  },
  visual: [
    { timestamp: '00:18', observation: '設定頁顯示 Enable 開關被打開', kind: 'observed' },
    { timestamp: '01:20', observation: '推測這是 beta 版介面', kind: 'inferred' },
  ],
  unrecognized: [{ timestamp: '00:40', description: '終端機文字太小，無法辨識' }],
  coverage: { from: '00:00', to: '01:35', summary: '看完整段影片並聽完語音' },
};
const goodPhoto = {
  ocr: { status: 'text', text: 'const x = 1' },
  speech: { status: 'not_applicable', segments: [] },
  visual: [{ timestamp: '', observation: '程式碼編輯器截圖', kind: 'observed' }],
  unrecognized: [],
  coverage: { from: '', to: '', summary: '單張圖片' },
};

function xPost(media) {
  return async (env, id) => ({
    url: 'https://x.com/i/status/' + id,
    relation: 'primary',
    author_id: '9',
    content: '看這段影片與截圖，說明怎麼開啟設定。',
    metadata: { post_id: id, conversation_id: id, author_username: 'author9', references: [], links: [] },
    media,
  });
}
const defaultMedia = [
  { url: 'https://video.twimg.com/v.mp4', type: 'video', media_key: 'v1', duration_ms: VIDEO_MS },
  { url: 'https://pbs.twimg.com/p.jpg', type: 'photo', media_key: 'p1' },
];
function setup({
  analysis = (req) => (req.mime.startsWith('video/') ? goodVideo : goodPhoto),
  media = defaultMedia,
} = {}) {
  const env = { ...environment(), LEARNING_RUNNER_TOKEN: 'runner-test-token' };
  const counts = { download: 0, upload: 0, analyze: 0, text: 0 };
  const net = recorder(async (url, options) => {
    if (url.hostname === 'video.twimg.com') {
      counts.download++;
      return new Response(new Uint8Array(2048), { headers: { 'content-type': 'video/mp4', 'content-length': '2048' } });
    }
    if (url.hostname === 'pbs.twimg.com') {
      counts.download++;
      return new Response(new Uint8Array(512), { headers: { 'content-type': 'image/jpeg', 'content-length': '512' } });
    }
    if (url.hostname === 'generativelanguage.googleapis.com' && url.pathname === '/upload/v1beta/files') {
      counts.upload++;
      return new Response(null, {
        headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/session/' + counts.upload },
      });
    }
    if (url.hostname === 'generativelanguage.googleapis.com' && url.pathname.startsWith('/upload/session/')) {
      const n = url.pathname.split('/').at(-1);
      return Response.json({
        file: {
          name: 'files/f' + n,
          state: 'ACTIVE',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/f' + n,
          videoMetadata: { videoDuration: '95s' },
        },
      });
    }
    if (url.pathname.endsWith(':generateContent')) {
      const body = JSON.parse(options.body);
      if (!body.generationConfig.responseSchema.properties.ocr) {
        counts.text++;
        throw Error('文字寫作不應呼叫 Gemini');
      }
      counts.analyze++;
      const file = body.contents[0].parts.find((p) => p.fileData).fileData;
      return Response.json({
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(analysis({ mime: file.mimeType })) }] } },
        ],
        usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 500 },
      });
    }
    return null;
  });
  const handler = createLearningHandler({
    ...net,
    postEvidence: xPost(media),
    xRead: async () => ({ data: [], meta: {} }),
  });
  const serverFetch = async (url, options) => handler.fetch(new Request(url, options), env);
  return { env, net, handler, counts, serverFetch };
}
const config = loadConfig({ TECHNEWS_URL: 'https://learning.example.org', TECHNEWS_RUNNER_TOKEN: 'runner-test-token' });
function ollama(output) {
  const seen = [];
  return {
    seen,
    fetcher: async (value, options) => {
      if (new URL(value).pathname === '/api/tags')
        return Response.json({ models: [{ name: 'gemma4:26b', digest: 'abc' }] });
      seen.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({ message: { content: output }, done: false }) +
          '\n' +
          JSON.stringify({
            message: { content: '' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 2000,
            eval_count: 600,
          }) +
          '\n',
      );
    },
  };
}
const article =
  '<<<TITLE>>>\n開啟開發者設定\n<<<INTRO>>>\n影片示範設定位置。\n<<<CITATIONS>>>\nS1, M1, M2\n<<<BODY>>>\n先打開開發者設定 [S1]。影片 00:18 顯示 Enable 開關 [M1]。截圖中的程式碼是 `const x = 1` [M2]。\n<<<END>>>';
async function share(s, url = 'https://x.com/someone/status/555') {
  const { id } = await (await s.handler.fetch(request('api/collect', 'POST', { url }), s.env)).json();
  for (
    let i = 0;
    i < 4 && !['waiting_local', 'needs_attention', 'ready', 'partial'].includes((await item(s.env, id)).status);
    i++
  ) {
    await query(s.env, 'UPDATE learning_items SET next_attempt_at=NULL').run();
    await s.handler.queue({ messages: [message({ kind: 'article', id })] }, s.env);
  }
  return id;
}

test('含圖片與影片的 X 內容：Flash 先保存可查核證據，Mac Gemma 再結合原文完成教材', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  const id = await share(s);
  assert.equal((await item(s.env, id)).status, 'waiting_local');
  assert.equal(s.counts.analyze, 2);
  assert.equal(s.counts.text, 0);
  const model = ollama(article);
  assert.equal((await runOnce(config, { serverFetch: s.serverFetch, ollamaFetch: model.fetcher })).state, 'completed');
  const prompt = JSON.parse(model.seen[0].messages[1].content.split('\n\n').at(-1));
  assert.equal(prompt.media_evidence.length, 2);
  assert.equal(prompt.media_evidence.find((m) => m.type === 'video').speech.segments[0].start, '00:05');
  assert.equal(prompt.media_evidence.find((m) => m.type === 'video').source_ref, 'S1');
  const saved = await item(s.env, id),
    data = JSON.parse(saved.article_json);
  assert.equal(saved.status, 'ready');
  assert.equal(data.citations.length, 3);
  assert.deepEqual(data.observations.map((o) => [o.timestamp, o.kind]).sort(), [
    ['', 'observed'],
    ['00:18', 'observed'],
    ['01:20', 'inferred'],
  ]);
  const page = await (await s.handler.fetch(request('api/items/' + id), s.env)).json();
  assert.equal(page.analyses.length, 2);
  assert.equal(page.analyses.find((a) => a.analysis.speech.status === 'transcribed').model, 'gemini-3.8-flash');
  assert.ok(page.media.every((m) => m.object_key && m.expires_at));
});

test('文字失敗或重寫時重用已保存媒體解析，不再次呼叫 Flash 或重新下載', async () => {
  const s = setup();
  await setTextProvider(s.env, 'local');
  const id = await share(s);
  const broken = ollama('<<<TITLE>>>\n未完成');
  for (let i = 0; i < 3; i++) await runOnce(config, { serverFetch: s.serverFetch, ollamaFetch: broken.fetcher });
  assert.equal((await item(s.env, id)).status, 'needs_attention');
  await s.handler.fetch(request('api/items/' + id + '/retry', 'POST', {}), s.env);
  await s.handler.queue({ messages: [message({ kind: 'article', id })] }, s.env);
  assert.equal((await item(s.env, id)).status, 'waiting_local');
  assert.equal(
    (await runOnce(config, { serverFetch: s.serverFetch, ollamaFetch: ollama(article).fetcher })).state,
    'completed',
  );
  assert.deepEqual({ ...s.counts }, { download: 2, upload: 2, analyze: 2, text: 0 });
});

test('媒體證據契約：拒絕超片長時間點、短觀察冒充整段、圖片時間點與空白 OCR', () => {
  const video = { type: 'video', duration_ms: VIDEO_MS },
    photo = { type: 'photo' };
  assert.equal(validateMediaAnalysis(video, goodVideo), goodVideo);
  assert.equal(validateMediaAnalysis(photo, goodPhoto), goodPhoto);
  assert.throws(
    () =>
      validateMediaAnalysis(video, {
        ...goodVideo,
        visual: [{ timestamp: '02:10', observation: '超出片長的畫面', kind: 'observed' }],
      }),
    /超出片長/,
  );
  assert.throws(
    () =>
      validateMediaAnalysis(video, {
        ...goodVideo,
        speech: { status: 'transcribed', segments: [{ start: '00:61', end: '01:00', text: 'x' }] },
      }),
    /時間點無效/,
  );
  assert.throws(
    () =>
      validateMediaAnalysis(
        { type: 'video', duration_ms: 900000 },
        { ...goodVideo, coverage: { from: '00:00', to: '15:00', summary: '全部看完' } },
      ),
    /不能當作完整解析/,
  );
  assert.throws(
    () => validateMediaAnalysis(video, { ...goodVideo, speech: { status: 'transcribed', segments: [] } }),
    /沒有逐字段落/,
  );
  assert.throws(() => validateMediaAnalysis(video, { ...goodVideo, ocr: { status: 'text', text: ' ' } }), /OCR/);
  assert.throws(
    () =>
      validateMediaAnalysis(video, {
        ...goodVideo,
        visual: [{ timestamp: '00:10', observation: '畫面', kind: 'guess' }],
      }),
    /觀察／推論/,
  );
  assert.throws(
    () =>
      validateMediaAnalysis(photo, {
        ...goodPhoto,
        visual: [{ timestamp: '00:01', observation: '圖片不該有時間點', kind: 'observed' }],
      }),
    /圖片不應有時間點/,
  );
  assert.throws(
    () => validateMediaAnalysis(video, { ...goodVideo, coverage: { from: '00:00', to: '01:35', summary: '' } }),
    /涵蓋範圍/,
  );
});

test('解析一直不合契約、影片超過 20 分鐘或原始媒體到期，都明示缺漏而不假裝完整', async () => {
  const bad = setup({
    analysis: (req) =>
      req.mime.startsWith('video/')
        ? { ...goodVideo, visual: [{ timestamp: '09:00', observation: '超出片長的觀察', kind: 'observed' }] }
        : goodPhoto,
  });
  await setTextProvider(bad.env, 'local');
  const id = await share(bad);
  assert.equal((await item(bad.env, id)).status, 'waiting_local');
  const job = await claim(bad.env, 'mac');
  assert.equal(job.input.media.length, 1);
  assert.match(job.input.gaps.map((g) => g.error).join(), /未通過證據檢查.*超出片長/);
  assert.equal(job.input.gaps.length, 1);

  const long = setup({
    media: [{ url: 'https://video.twimg.com/long.mp4', type: 'video', media_key: 'long', duration_ms: 21 * 60000 }],
  });
  await setTextProvider(long.env, 'local');
  const longId = await share(long);
  assert.equal((await item(long.env, longId)).status, 'waiting_local');
  assert.equal(long.counts.download, 0);
  assert.equal(long.counts.analyze, 0);
  assert.match((await claim(long.env, 'mac')).input.gaps[0].error, /超過 20 分鐘/);

  // 到期：已解析的影片保留觀察；從未解析就到期的媒體列為缺漏。
  const s = setup();
  await setTextProvider(s.env, 'local');
  const done = await share(s);
  await runOnce(config, { serverFetch: s.serverFetch, ollamaFetch: ollama(article).fetcher });
  await query(s.env, 'UPDATE learning_media SET expires_at=?', iso(-1000)).run();
  await s.handler.scheduled(s.env, false);
  assert.equal(s.env.MEDIA.objects.size, 0);
  await s.handler.fetch(request('api/items/' + done + '/retry', 'POST', {}), s.env);
  await query(s.env, 'UPDATE learning_items SET article_json=NULL WHERE id=?', done).run();
  await s.handler.queue({ messages: [message({ kind: 'article', id: done })] }, s.env);
  const reused = (await claim(s.env, 'mac')).input;
  assert.equal(reused.media.length, 2);
  assert.ok(reused.media.every((m) => m.expired));
  assert.equal(reused.gaps.length, 0);
  assert.equal(s.counts.analyze, 2);
  // 從未解析就過期：例行處理只列缺漏，不自動重新下載；使用者按「補取缺漏」才會重新取得。
  await query(s.env, 'DELETE FROM learning_media_analyses').run();
  await query(s.env, "UPDATE learning_jobs SET status='done'").run();
  await query(s.env, "UPDATE learning_media SET status='expired',object_key=NULL").run();
  await query(s.env, "UPDATE learning_items SET status='queued',article_json=NULL WHERE id=?", done).run();
  await s.handler.queue({ messages: [message({ kind: 'article', id: done })] }, s.env);
  const missing = (await claim(s.env, 'mac')).input;
  assert.equal(missing.media.length, 0);
  assert.match(missing.gaps.map((g) => g.error).join(), /保存期限/);
  assert.equal(s.counts.download, 2);
});

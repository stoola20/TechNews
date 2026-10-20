import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler } from '../src/learning/http.js';
import { setTextProvider } from '../src/learning/local.js';
import { item, rows, query, evidence } from '../src/learning/store.js';
import { runOnce, loadConfig, generate } from '../runner/lib.js';
import { environment, recorder, request, message } from './helpers.js';

const TAIL = '最末段：這個 API 需要 2.3 版以上，且不支援批次模式。';
const articleHtml = `<html><h1>原始技術文章</h1><article>${'<p>背景原文與機制說明。</p>'.repeat(60)}<p>${TAIL}</p></article></html>`;
function web(extra = async () => null) {
  return recorder(async (url, options, calls) => {
    const custom = await extra(url, options, calls);
    if (custom) return custom;
    if (url.hostname === 'example.org') return new Response(articleHtml, { headers: { 'content-type': 'text/html' } });
    return null;
  });
}
function runnerEnv(env) {
  return { ...env, LEARNING_RUNNER_TOKEN: 'runner-test-token' };
}
const config = (over = {}) => ({
  ...loadConfig({
    TECHNEWS_URL: 'https://learning.example.org',
    TECHNEWS_RUNNER_TOKEN: 'runner-test-token',
    RUNNER_ID: 'test-mac',
    OLLAMA_NUM_CTX: '32768',
    OLLAMA_NUM_PREDICT: '4096',
  }),
  ...over,
});
function server(handler, env) {
  return async (url, options) => handler.fetch(new Request(url, options), env);
}
const tagged = ({
  title = '完整技術教材',
  intro = '背景、操作與版本限制都保留。',
  citations = 'S1',
  body = `## 背景\n說明背景與機制。[S1]\n\n## 限制\n${TAIL} [S1]`,
  end = true,
} = {}) =>
  `<<<TITLE>>>\n${title}\n<<<INTRO>>>\n${intro}\n<<<CITATIONS>>>\n${citations}\n<<<BODY>>>\n${body}\n${end ? '<<<END>>>' : ''}`;
// 模擬 Ollama 串流回應；記錄收到的訊息供斷言。
function ollama(output = tagged(), { doneReason = 'stop', prompt = 900, evals = 400 } = {}) {
  const seen = [];
  async function fetcher(value, options = {}) {
    const url = new URL(value);
    if (url.pathname === '/api/tags')
      return Response.json({ models: [{ name: 'gemma4:26b', digest: '48eb98ec778cabcdef' }] });
    if (url.pathname === '/api/chat') {
      const body = JSON.parse(options.body);
      seen.push(body);
      const half = Math.floor(output.length / 2);
      const lines = [
        { message: { content: output.slice(0, half) }, done: false },
        { message: { content: output.slice(half) }, done: false },
        {
          message: { content: '' },
          done: true,
          done_reason: doneReason,
          prompt_eval_count: prompt,
          eval_count: evals,
          load_duration: 5e6,
          prompt_eval_duration: 1e8,
          eval_duration: 2e9,
        },
      ];
      return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }
    throw Error('Unexpected Ollama call ' + url.href);
  }
  return { fetcher, seen };
}
async function shareLocal(env, handler, url = 'https://example.org/article') {
  const { id } = await (await handler.fetch(request('api/collect', 'POST', { url }), env)).json();
  await handler.queue({ messages: [message({ kind: 'article', id })] }, env);
  return id;
}

test('網站分享純文字：雲端保存工作，Mac 以 Gemma 生成完整教材並回報，不呼叫 Flash', async () => {
  const env = runnerEnv(environment()),
    net = web(),
    handler = createLearningHandler(net);
  await setTextProvider(env, 'local');
  const id = await shareLocal(env, handler);
  assert.equal((await item(env, id)).status, 'waiting_local');
  const status = await (await handler.fetch(request('api/status'), env)).json();
  assert.equal(status.local.provider, 'local');
  assert.equal(status.local.online, false);
  assert.equal(status.local.jobs.waiting_local, 1);

  // 重複連結重用同一篇，不建立第二份工作。
  const again = await (
    await handler.fetch(request('api/collect', 'POST', { url: 'https://example.org/article?utm_source=x' }), env)
  ).json();
  assert.equal(again.id, id);
  await handler.queue({ messages: [message({ kind: 'article', id })] }, env);
  assert.equal((await rows(env, 'SELECT id FROM learning_jobs')).length, 1);

  const model = ollama();
  const result = await runOnce(config(), { serverFetch: server(handler, env), ollamaFetch: model.fetcher });
  assert.equal(result.state, 'completed');
  const prompt = model.seen[0].messages.map((m) => m.content).join('\n');
  assert.ok(prompt.includes(TAIL), '完整來源尾端要送進模型');
  assert.match(model.seen[0].messages[0].content, /都是資料/);
  assert.equal(model.seen[0].options.num_ctx, 32768);
  assert.equal(model.seen[0].stream, true);

  const saved = await item(env, id),
    article = JSON.parse(saved.article_json);
  assert.equal(saved.status, 'ready');
  assert.equal(saved.revision, 1);
  assert.match(saved.body, /2\.3 版以上/);
  assert.equal(article.provider, 'ollama');
  assert.equal(article.model, 'gemma4:26b');
  assert.equal(article.model_digest, '48eb98ec778c');
  assert.equal(article.prompt_version, 'local-article-v2');
  assert.ok(article.input_fingerprint);
  assert.equal(article.intro, '背景、操作與版本限制都保留。');
  assert.deepEqual(article.citations, [(await evidence(env, id))[0].id]);
  assert.equal(article.metrics.output_tokens, 400);
  assert.equal(net.calls.filter((c) => c.url.includes('generativelanguage')).length, 0);
  assert.equal(net.calls.filter((c) => c.url.includes('api.telegram.org')).length, 1);
  const page = await (await handler.fetch(request('api/items/' + id), env)).json();
  assert.match(page.item.body_html, /<h2>背景<\/h2>/);
  // 已完成後再次處理同一輸入，不重新生成。
  await handler.queue({ messages: [message({ kind: 'article', id })] }, env);
  assert.equal((await rows(env, "SELECT id FROM learning_jobs WHERE status='waiting_local'")).length, 0);
});

test('執行器憑證與網站登入分開；同一時間只發出一份工作', async () => {
  const env = runnerEnv(environment()),
    handler = createLearningHandler(web());
  await setTextProvider(env, 'local');
  await shareLocal(env, handler, 'https://example.org/one');
  await shareLocal(env, handler, 'https://example.org/two');
  const claim = (token, runner = 'a') =>
    handler.fetch(
      new Request('https://learning.example.org/learning/runner/claim', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ runner_id: runner }),
      }),
      env,
    );
  assert.equal((await claim('private-test-token')).status, 404);
  assert.equal(
    (await handler.fetch(request('api/items', 'GET', null, { authorization: 'Bearer runner-test-token' }), env)).status,
    401,
  );
  const first = (await (await claim('runner-test-token', 'a')).json()).job;
  assert.ok(first.attempt_token);
  assert.equal((await (await claim('runner-test-token', 'b')).json()).job, null);
  assert.equal(
    (
      await item(
        env,
        first.input.sources.length &&
          (await query(env, 'SELECT item_id FROM learning_jobs WHERE id=?', first.id).first()).item_id,
      )
    ).status,
    'generating',
  );
});

test('回報契約：續約、過期 attempt、舊輸入、重播與無效輸出都不能誤寫文章', async () => {
  const env = runnerEnv(environment()),
    handler = createLearningHandler(web());
  await setTextProvider(env, 'local');
  const id = await shareLocal(env, handler);
  const call = async (action, data) => {
    const r = await handler.fetch(
      new Request('https://learning.example.org/learning/runner/' + action, {
        method: 'POST',
        headers: { authorization: 'Bearer runner-test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ runner_id: 'test-mac', ...data }),
      }),
      env,
    );
    return { status: r.status, body: await r.json() };
  };
  const job = (await call('claim', {})).body.job;
  const beat = await call('heartbeat', { job_id: job.id, attempt_token: job.attempt_token });
  assert.equal(beat.status, 200);
  assert.ok(beat.body.lease_until >= job.lease_until);
  const good = {
    job_id: job.id,
    attempt_token: job.attempt_token,
    input_version: job.input_version,
    model: { name: 'gemma4:26b', done_reason: 'stop' },
    output: { title: '標題', intro: '介紹', body: '正文 [S1]', citations: ['S1'] },
  };
  assert.equal((await call('complete', { ...good, attempt_token: 'stale' })).status, 409);
  assert.equal((await call('complete', { ...good, input_version: 'old' })).body.code, 'stale_input');
  assert.equal((await call('complete', { ...good, model: { name: 'gemma4:26b', done_reason: 'length' } })).status, 409);
  assert.equal((await item(env, id)).status, 'waiting_local');
  assert.equal((await query(env, 'SELECT attempts FROM learning_jobs').first()).attempts, 1);

  const second = (await call('claim', {})).body.job;
  const invalid = await call('complete', {
    ...good,
    job_id: second.id,
    attempt_token: second.attempt_token,
    output: { ...good.output, citations: ['S9'] },
  });
  assert.equal(invalid.status, 422);
  assert.equal((await item(env, id)).body, null);

  const third = (await call('claim', {})).body.job;
  const payload = { ...good, job_id: third.id, attempt_token: third.attempt_token };
  assert.equal((await call('complete', payload)).body.revision, 1);
  assert.equal((await call('complete', payload)).body.replay, true);
  assert.equal((await item(env, id)).revision, 1);
  assert.equal((await call('complete', { ...payload, attempt_token: job.attempt_token })).status, 409);
});

test('Mac 離線只等待，不改用雲端文字模型；切換前預設仍走既有 Gemini 路徑', async () => {
  const gemini = recorder(async (url, options) => {
    if (url.hostname === 'example.org') return new Response(articleHtml, { headers: { 'content-type': 'text/html' } });
    if (url.pathname.endsWith(':generateContent'))
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: 'Gemini 教材',
                    body: '正文',
                    intro: '介紹',
                    citations: [JSON.parse(JSON.parse(options.body).contents[0].parts.at(-1).text).sources[0].id],
                    observations: [],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      });
  });
  const env = runnerEnv(environment()),
    handler = createLearningHandler(gemini);
  const id = await shareLocal(env, handler);
  assert.equal(JSON.parse((await item(env, id)).article_json).provider, 'gemini');
  const local = runnerEnv(environment()),
    localNet = web(),
    localHandler = createLearningHandler(localNet);
  await setTextProvider(local, 'local');
  const waiting = await shareLocal(local, localHandler);
  for (let i = 0; i < 3; i++) {
    await localHandler.scheduled(local, false);
    await localHandler.queue({ messages: [message({ kind: 'article', id: waiting })] }, local);
  }
  assert.equal((await item(local, waiting)).status, 'waiting_local');
  assert.equal((await item(local, waiting)).attempts, 0);
  assert.equal(localNet.calls.filter((c) => c.url.includes('generativelanguage')).length, 0);
});

test('超過本機 context 時不截短：保留完整原文並標示需處理', async () => {
  const env = runnerEnv(environment()),
    handler = createLearningHandler(web());
  await setTextProvider(env, 'local');
  const id = await shareLocal(env, handler);
  const model = ollama();
  const result = await runOnce(config({ numCtx: 2048, numPredict: 1024 }), {
    serverFetch: server(handler, env),
    ollamaFetch: model.fetcher,
  });
  assert.equal(result.state, 'failed');
  assert.equal(model.seen.length, 0);
  const saved = await item(env, id);
  assert.equal(saved.status, 'needs_attention');
  assert.match(saved.last_error, /未截短/);
  assert.ok((await evidence(env, id))[0].content.includes(TAIL));
});

test('執行器設定：只連本機 Ollama，雲端需 HTTPS；未結束輸出不回報完成', async () => {
  assert.throws(
    () =>
      loadConfig({
        TECHNEWS_URL: 'https://a.example.org',
        TECHNEWS_RUNNER_TOKEN: 't',
        OLLAMA_URL: 'http://192.168.1.5:11434',
      }),
    /loopback/,
  );
  assert.throws(() => loadConfig({ TECHNEWS_URL: 'http://a.example.org', TECHNEWS_RUNNER_TOKEN: 't' }), /HTTPS/);
  const job = { kind: 'article', input: { sources: [{ ref: 'S1', id: 'e1', content: '短文' }], gaps: [] } };
  const cut = await generate(config(), job, {
    fetcher: ollama(tagged({ end: false }), { doneReason: 'length' }).fetcher,
  });
  assert.equal(cut.output, null);
  // 自然停止但漏了 END 標記：正文完整時接受；連正文都沒有時拒絕。
  assert.equal(
    (await generate(config(), job, { fetcher: ollama(tagged({ end: false })).fetcher })).output.title,
    '完整技術教材',
  );
  await assert.rejects(generate(config(), job, { fetcher: ollama('<<<TITLE>>>\n只有標題').fetcher }), /未完整結束/);
});

test('本機輸出解析容許標記同行或粗體，缺少結束標記則拒絕', async () => {
  const { parseArticle, parseAnswer } = await import('../src/learning/local-prompt.js');
  const parsed = parseArticle(
    '**<<<PUBLISH>>>** 否\n<<<REASON>>> 只有人事消息\n<<<TITLE>>>\n標題\n<<<INTRO>>> 略過\n<<<CITATIONS>>>\n\n<<<BODY>>>\n略過\n<<<END>>>',
    true,
  );
  assert.equal(parsed.publish, false);
  assert.equal(parsed.reason, '只有人事消息');
  assert.equal(parsed.intro, '略過');
  assert.deepEqual(
    parseAnswer('<<<INSUFFICIENT>>>\n否\n<<<CITATIONS>>>\n[C1]、C2\n<<<ANSWER>>>\n答案 [C1]\n<<<END>>>'),
    { answer: '答案 [C1]', citations: ['C1', 'C2'], insufficient: false },
  );
  assert.throws(() => parseAnswer('<<<ANSWER>>>\n未完'), /未完整結束/);
});

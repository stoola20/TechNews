import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  articleMessages,
  questionMessages,
  parseArticle,
  parseAnswer,
  estimateTokens,
} from '../src/learning/local-prompt.js';

export const RUNNER_VERSION = '1.1.0';

export class RunnerError extends Error {
  constructor(message, { retryable = true, local = false } = {}) {
    super(message);
    this.name = 'RunnerError';
    this.retryable = retryable;
    this.local = local;
  }
}

export function loadConfig(env = process.env) {
  const config = {
    baseUrl: env.TECHNEWS_URL || '',
    token: env.TECHNEWS_RUNNER_TOKEN || '',
    runnerId: env.RUNNER_ID || 'mac-runner',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    model: env.OLLAMA_MODEL || 'gemma4:26b',
    numCtx: Number(env.OLLAMA_NUM_CTX || 32768),
    numPredict: Number(env.OLLAMA_NUM_PREDICT || 8192),
    keepAlive: env.OLLAMA_KEEP_ALIVE || '30m',
    temperature: Number(env.OLLAMA_TEMPERATURE || 0.3),
    pollMs: Number(env.RUNNER_POLL_SECONDS || 20) * 1000,
    debugDir: env.RUNNER_DEBUG_DIR || '',
    heartbeatMs: Number(env.RUNNER_HEARTBEAT_SECONDS || 30) * 1000,
    xProfileDir: env.RUNNER_X_PROFILE_DIR || '',
  };
  const base = new URL(config.baseUrl || 'invalid:');
  // 雲端連線需 HTTPS；只有本機開發時允許 http://localhost。
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
    throw new Error('TECHNEWS_URL 需為 HTTPS 網址');
  if (!config.token) throw new Error('TECHNEWS_RUNNER_TOKEN 未設定');
  // 執行器只呼叫本機 Ollama，不把模型服務暴露到網路。
  const ollama = new URL(config.ollamaUrl);
  if (ollama.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(ollama.hostname))
    throw new Error('OLLAMA_URL 只能指向本機 loopback 位址');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.runnerId)) throw new Error('RUNNER_ID 只能使用英數、點、底線與連字號');
  for (const key of ['numCtx', 'numPredict', 'pollMs', 'heartbeatMs'])
    if (!Number.isInteger(config[key]) || config[key] <= 0) throw new Error(`${key} 設定無效`);
  if (config.numPredict >= config.numCtx) throw new Error('OLLAMA_NUM_PREDICT 必須小於 OLLAMA_NUM_CTX');
  config.baseUrl = base.origin;
  return config;
}

export function serverClient(config, fetcher = fetch) {
  return async function call(action, data) {
    let response;
    try {
      response = await fetcher(`${config.baseUrl}/learning/runner/${action}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ runner_id: config.runnerId, ...data }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      throw Object.assign(new RunnerError('無法連線到文章庫服務', { local: true }), { network: true });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(new RunnerError(body.error || `文章庫服務 HTTP ${response.status}`), {
        status: response.status,
        code: body.code,
      });
    return body;
  };
}

export async function ollamaInfo(config, fetcher = fetch) {
  try {
    const response = await fetcher(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { ollama: false };
    const data = await response.json();
    const model = (data.models || []).find((m) => m.name === config.model || m.model === config.model);
    return { ollama: true, model: config.model, model_digest: model?.digest?.slice(0, 12) || '', installed: !!model };
  } catch {
    return { ollama: false };
  }
}

// 以串流讀取 Ollama 回應：長文生成可能超過 HTTP header 等待上限。
export async function chat(config, messages, { signal, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        think: false,
        keep_alive: config.keepAlive,
        options: { num_ctx: config.numCtx, num_predict: config.numPredict, temperature: config.temperature },
      }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RunnerError('本機 Ollama 無法連線', { local: true });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new RunnerError(`Ollama HTTP ${response.status}：${text.slice(0, 200)}`, { local: response.status >= 500 });
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    content = '',
    final = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.error) throw new RunnerError(`Ollama：${event.error}`);
      content += event.message?.content || '';
      if (event.done) final = event;
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    content += event.message?.content || '';
    if (event.done) final = event;
  }
  if (!final) throw new RunnerError('Ollama 串流未正常結束', { local: true });
  return { content, final };
}

export async function generate(config, job, { signal, fetcher = fetch } = {}) {
  const messages = job.kind === 'question' ? questionMessages(job.input) : articleMessages(job.input);
  const estimated = estimateTokens(messages.map((m) => m.content).join('\n'));
  // 不截短來源：估算超過已驗證 context 時直接回報，原文仍保存在雲端。
  if (estimated + config.numPredict > config.numCtx)
    throw new RunnerError(
      `來源約 ${estimated} tokens，加上輸出上限超過本機已設定的 context（${config.numCtx}）；已保留完整原文，未截短處理`,
      { retryable: false },
    );
  const started = Date.now();
  const { content, final } = await chat(config, messages, { signal, fetcher });
  const promptTokens = final.prompt_eval_count || 0,
    outputTokens = final.eval_count || 0;
  if (promptTokens + outputTokens >= config.numCtx)
    throw new RunnerError('輸入與輸出接近 context 上限，可能被截短，不採用這次結果', { retryable: false });
  const metrics = {
    prompt_tokens: promptTokens,
    output_tokens: outputTokens,
    load_ms: (final.load_duration || 0) / 1e6,
    prompt_ms: (final.prompt_eval_duration || 0) / 1e6,
    generate_ms: (final.eval_duration || 0) / 1e6,
    total_ms: Date.now() - started,
    num_ctx: config.numCtx,
    num_predict: config.numPredict,
    estimated_tokens: estimated,
  };
  const model = { name: config.model, digest: job.modelDigest || '', done_reason: final.done_reason };
  if (final.done_reason !== 'stop') {
    await debugDump(config, job, content, 'incomplete');
    return { output: null, model, metrics, raw: content };
  }
  try {
    const output =
      job.kind === 'question'
        ? parseAnswer(content, { stopped: true })
        : parseArticle(content, !!job.input.official, { stopped: true });
    return { output, model, metrics, raw: content };
  } catch (error) {
    await debugDump(config, job, content, 'unparsed');
    error.raw = content;
    throw error;
  }
}

// 只在明確設定 RUNNER_DEBUG_DIR 時保存原始輸出到本機，方便調整提示；不會上傳。
async function debugDump(config, job, content, reason) {
  if (!config.debugDir) return;
  try {
    await mkdir(config.debugDir, { recursive: true });
    await writeFile(join(config.debugDir, `${job.id || 'job'}-${Date.now()}-${reason}.txt`), content);
  } catch {}
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 領取並處理至多一份工作；回傳處理結果供 CLI 記錄。
// xFetch：可處理 X 長文代抓時傳入代抓函式；Ollama 停止時仍可代抓，不需要模型。
export async function runOnce(
  config,
  { serverFetch = fetch, ollamaFetch = fetch, log = () => {}, info = null, xFetch = null } = {},
) {
  const call = serverClient(config, serverFetch);
  const status = info || { ...(await ollamaInfo(config, ollamaFetch)), version: RUNNER_VERSION };
  const kinds = [...(status.ollama ? ['article', 'question'] : []), ...(xFetch ? ['fetch_x_article'] : [])];
  if (!kinds.length) {
    await call('heartbeat', { info: { ...status, state: 'ollama_unavailable' } });
    return { state: 'ollama_unavailable' };
  }
  const { job } = await call('claim', { info: { ...status, state: 'idle' }, kinds });
  if (!job) return { state: status.ollama ? 'idle' : 'ollama_unavailable' };
  log({ event: 'job_claimed', job: job.id, kind: job.kind });
  const controller = new AbortController();
  let lost = false;
  const timer = setInterval(async () => {
    try {
      await call('heartbeat', {
        info: { ...status, state: 'working' },
        job_id: job.id,
        attempt_token: job.attempt_token,
      });
    } catch (error) {
      if ([404, 409].includes(error.status)) {
        lost = true;
        controller.abort();
      }
    }
  }, config.heartbeatMs);
  try {
    const result =
      job.kind === 'fetch_x_article'
        ? { output: await xFetch(config, job.input.url), model: { name: 'browser' }, metrics: {} }
        : await generate(
            config,
            { ...job, modelDigest: status.model_digest },
            { signal: controller.signal, fetcher: ollamaFetch },
          );
    if (!result.output) {
      await call('fail', {
        job_id: job.id,
        attempt_token: job.attempt_token,
        error: `本機模型輸出未完成（${result.model.done_reason || 'unknown'}），可能超過輸出上限`,
      });
      return { state: 'failed', job: job.id };
    }
    // 回報可安全重播：網路中斷時以同一份 attempt token 重送。
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await call('complete', {
          job_id: job.id,
          attempt_token: job.attempt_token,
          input_version: job.input_version,
          output: result.output,
          model: result.model,
          metrics: result.metrics,
        });
        log({ event: 'job_completed', job: job.id, ...result.metrics });
        return { state: 'completed', job: job.id, response };
      } catch (error) {
        if (!error.network || attempt >= 4) throw error;
        await wait(2000 * 2 ** attempt);
      }
    }
  } catch (error) {
    if (lost || controller.signal.aborted) {
      log({ event: 'lease_lost', job: job.id });
      return { state: 'lease_lost', job: job.id };
    }
    if (error.status) {
      log({ event: 'report_rejected', job: job.id, code: error.code, error: error.message });
      return { state: 'rejected', job: job.id, code: error.code };
    }
    if (error.local) {
      // Ollama 或網路暫時不可用：釋放領取，不計入模型失敗。
      await call('release', { job_id: job.id, attempt_token: job.attempt_token, error: error.message }).catch(() => {});
      log({ event: 'job_released', job: job.id, error: error.message });
      return { state: 'released', job: job.id };
    }
    await call('fail', {
      job_id: job.id,
      attempt_token: job.attempt_token,
      error: error.message,
      retryable: error.retryable !== false,
    }).catch(() => {});
    log({ event: 'job_failed', job: job.id, error: error.message });
    return { state: 'failed', job: job.id };
  } finally {
    clearInterval(timer);
  }
}

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// 真實 SQLite schema：依序套用全部 migration，與 D1 binding 介面相同。
// 本機 SQLite 允許上萬個綁定參數，D1 單一查詢最多 100 個；超過時照 D1 的方式丟錯，避免測試過了、正式環境才失敗。
const D1_MAX_VARIABLES = 100;
// beforeMigration(name,sqlite) 在套用每個 migration 前呼叫，用來準備升級前的舊資料、驗證 migration 的轉換。
export function database({ beforeMigration } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('../migrations', import.meta.url))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    beforeMigration?.(name, sqlite);
    sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  return {
    sqlite,
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          if (args.length > D1_MAX_VARIABLES) throw new Error('D1_ERROR: too many SQL variables: SQLITE_ERROR');
          this.args = args;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...this.args) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...this.args) };
        },
        async run() {
          return { meta: sqlite.prepare(sql).run(...this.args) };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const s of statements) result.push(await s.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
export function mediaStore() {
  const objects = new Map();
  return {
    objects,
    async put(key, stream, options) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      objects.set(key, { bytes, options });
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { body: new Response(value.bytes).body, size: value.bytes.length } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
export function environment(extra = {}) {
  const jobs = [];
  return {
    DB: database(),
    RUN_TOKEN: 'private-test-token',
    GEMINI_API_KEY: 'gemini-test-secret',
    PUBLIC_BASE_URL: 'https://learning.example.org',
    LEARNING_MONTHLY_USD: '30',
    LEARNING_BASE_USD: '0',
    MEDIA: mediaStore(),
    LEARNING_JOBS: {
      jobs,
      async send(job) {
        jobs.push(job);
      },
    },
    TELEGRAM_BOT_TOKEN: 'telegram-test',
    TELEGRAM_CHAT_ID: '-1001',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-test',
    TELEGRAM_ALLOWED_CHAT_IDS: '42',
    X_CLIENT_ID: 'x-client',
    X_CLIENT_SECRET: 'x-secret',
    X_APP_OWNER_ID: '7',
    ...extra,
  };
}
// 任何未預期的外部呼叫都會讓測試失敗，並記錄呼叫供斷言。
export function recorder(handler = async () => null) {
  const calls = [];
  async function fetcher(value, options = {}) {
    const url = new URL(value);
    calls.push({ url: url.href, options });
    const result = await handler(url, options, calls);
    if (result) return result;
    if (url.hostname === 'cloudflare-dns.com')
      return Response.json({
        Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [],
      });
    if (url.hostname === 'api.telegram.org') return Response.json({ ok: true, result: { message_id: calls.length } });
    throw Error('Unexpected test network call: ' + url.href);
  }
  return { fetcher, calls };
}
export function request(path, method = 'GET', data = null, headers = {}) {
  return new Request('https://learning.example.org/learning/' + path, {
    method,
    headers: { authorization: 'Bearer private-test-token', 'content-type': 'application/json', ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
export function message(body) {
  return {
    body,
    acks: 0,
    retries: 0,
    ack() {
      this.acks++;
    },
    retry(options) {
      this.retries++;
      this.retryOptions = options;
    },
  };
}
export const iso = (offset) => new Date(Date.now() + offset).toISOString();
// X 書籤同步與作者重查預設關閉；測試同步行為時先打開。
export async function enableXReads(env, value = { bookmarks: true, author_recheck: true }) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value_json,updated_at) VALUES('learning:x-reads',?,?)")
    .bind(JSON.stringify(value), new Date().toISOString())
    .run();
}

// 決定性的假 embedding 模型：同義詞與中英對照的合成文字對到同一個概念，向量就接近。
// 只放在前 512 維，模擬 Matryoshka 截斷後仍保留語意；後 256 維放雜訊，確認程式有截斷再正規化。
const CONCEPTS = {
  快取: 'cache',
  cache: 'cache',
  caching: 'cache',
  緩存: 'cache',
  重試: 'retry',
  retry: 'retry',
  retries: 'retry',
  退避: 'backoff',
  backoff: 'backoff',
  佇列: 'queue',
  queue: 'queue',
  代理: 'agent',
  agent: 'agent',
  agents: 'agent',
  工具: 'tool',
  tool: 'tool',
  tools: 'tool',
  預算: 'budget',
  budget: 'budget',
  費用: 'budget',
  cost: 'budget',
  串流: 'stream',
  streaming: 'stream',
  stream: 'stream',
};
function concepts(text) {
  const body = String(text)
    .replace(/^task: search result \| query: /, '')
    .replace(/^title: [^|]*\| text: /, '')
    .toLowerCase();
  const words = [...new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(body)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment);
  return words.map((w) => CONCEPTS[w] || w);
}
function slot(word) {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return (h >>> 0) % 512;
}
export function embeddingModel({ fail = () => false } = {}) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      // 主題分類也走同一個 AI binding：固定回「模型發布與能力」。
      if (model === '@cf/google/gemma-4-26b-a4b-it')
        return { choices: [{ message: { content: '{"primary":"models","secondary":null}' }, finish_reason: 'stop' }] };
      calls.push({ model, input });
      if (model !== '@cf/google/embeddinggemma-300m') throw new Error('unexpected model ' + model);
      if (fail(input)) throw new Error('Workers AI 暫時無法使用');
      const texts = Array.isArray(input.text) ? input.text : [input.text];
      if (texts.length > 100) throw new Error('batch too large');
      return {
        shape: [texts.length, 768],
        data: texts.map((t) => {
          const v = new Array(768).fill(0);
          for (const c of concepts(t)) v[slot(c)] += CONCEPTS[c] || Object.values(CONCEPTS).includes(c) ? 3 : 1;
          for (let i = 512; i < 768; i++) v[i] = 5;
          v[511] += 0.01;
          return v;
        }),
      };
    },
  };
}
// 記憶體 Vectorize：upsert、deleteByIds 與 cosine 前 K 筆查詢。
export function vectorIndex({ fail = () => false } = {}) {
  const vectors = new Map(),
    calls = [];
  const cosine = (a, b) => {
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / Math.sqrt(na * nb);
  };
  return {
    vectors,
    calls,
    async upsert(list) {
      calls.push({ op: 'upsert', count: list.length });
      if (fail('upsert')) throw new Error('Vectorize upsert failed');
      if (list.length > 1000) throw new Error('batch too large');
      for (const v of list) {
        if (new TextEncoder().encode(v.id).length > 64) throw new Error('vector id too long');
        if (v.values.length !== 512) throw new Error('dimension mismatch');
        vectors.set(v.id, v.values);
      }
      return { mutationId: 'm' + calls.length };
    },
    async deleteByIds(ids) {
      calls.push({ op: 'delete', count: ids.length });
      if (fail('delete')) throw new Error('Vectorize delete failed');
      for (const id of ids) vectors.delete(id);
      return { mutationId: 'm' + calls.length };
    },
    async query(values, { topK = 5, returnMetadata = 'none', returnValues = false } = {}) {
      calls.push({ op: 'query', topK });
      if (fail('query')) throw new Error('Vectorize query failed');
      if (topK > ((returnMetadata !== 'none' && returnMetadata) || returnValues ? 50 : 100))
        throw new Error('topK too large');
      const matches = [...vectors]
        .map(([id, v]) => ({ id, score: cosine(values, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { count: matches.length, matches };
    },
  };
}

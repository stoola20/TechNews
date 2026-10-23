import { apiJson, publicFetch, decorativeImage, figureIndex, figurePage } from './network.js';
import { rows, query, reserve, settle, uncertain, nowIso } from './store.js';
import { now } from './clock.js';

const MAX_BYTES = 200 * 1024 * 1024;
// 官方網頁 HTML 取不到時登記的佔位媒體：只用來顯示缺漏，不下載；重抓原文成功後移除。
export const PAGE_HTML_MISSING = '#technews-page-html';
// 外部網頁的裝飾圖片（舊資料可能已登記）改標 decorative：不下載、不解析，也不算缺漏。
const NO_ELEMENT = { getAttribute: () => null, closest: () => null };
export async function skipDecorative(env, itemId) {
  const external = await rows(
    env,
    "SELECT m.id,m.url FROM learning_media m JOIN learning_evidence e ON e.id=m.evidence_id WHERE m.item_id=? AND e.relation='external' AND m.status!='decorative'",
    itemId,
  );
  const marked = external
    .filter((asset) => !asset.url || decorativeImage(NO_ELEMENT, asset.url))
    .map((asset) => asset.id);
  for (const id of marked)
    await query(
      env,
      "UPDATE learning_media SET status='decorative',error=NULL,updated_at=? WHERE id=?",
      nowIso(),
      id,
    ).run();
  if (!marked.length) return 0;
  // 已寫進文章的裝飾圖片缺漏一併移除；沒有其他缺漏時，文章改回已完成。
  const item = await query(env, 'SELECT gaps_json,status FROM learning_items WHERE id=?', itemId).first();
  const gaps = JSON.parse(item?.gaps_json || '[]'),
    kept = gaps.filter((g) => !marked.includes(g.id || g.media_id));
  if (kept.length === gaps.length) return marked.length;
  await query(
    env,
    "UPDATE learning_items SET gaps_json=?,status=CASE WHEN status='partial' AND ?=0 THEN 'ready' ELSE status END WHERE id=?",
    JSON.stringify(kept),
    kept.length,
    itemId,
  ).run();
  return marked.length;
}
export async function prepareMedia(env, itemId, fetcher = fetch, options = {}) {
  await skipDecorative(env, itemId);
  const assets = (
    await rows(env, "SELECT * FROM learning_media WHERE item_id=? AND status!='decorative'", itemId)
  ).filter((a) => !options.only || options.only.includes(a.id));
  let pending = false;
  for (const asset of assets) {
    if (['needs_attention', 'expired'].includes(asset.status)) continue;
    if (asset.url.endsWith(PAGE_HTML_MISSING)) {
      await fail(env, asset, asset.error || '官方網頁取不到，無法收集圖片');
      continue;
    }
    if (asset.duration_ms > 1200000) {
      await fail(env, asset, '影片超過 20 分鐘，保留待人工處理');
      continue;
    }
    try {
      if (!env.MEDIA) throw new Error('R2 MEDIA binding 未設定');
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未設定');
      if (!asset.object_key && figureIndex(asset.url) != null) await storeFigure(env, asset);
      else if (!asset.object_key) {
        const response = await publicFetch(asset.url, fetcher);
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`媒體來源 HTTP ${response.status}`);
        }
        const size = Number(response.headers.get('content-length'));
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!/^image\/(jpeg|png|gif|webp|avif|heic|heif)$|^video\/(mp4|webm|quicktime)$/.test(mime)) {
          await response.body?.cancel();
          await fail(env, asset, '媒體格式不支援');
          continue;
        }
        if (!size || !Number.isSafeInteger(size) || size > MAX_BYTES) {
          await response.body?.cancel();
          await fail(env, asset, '媒體超過 200 MB 或未提供可驗證大小，保留待人工處理');
          continue;
        }
        const cost = await reserve(env, 'r2-storage', Math.ceil((size / 1e9) * 0.015 * 1e6) + 10);
        try {
          const key = `learning/${asset.id}`;
          const lengthStream =
            typeof FixedLengthStream === 'undefined' ? new TransformStream() : new FixedLengthStream(size);
          let received = 0;
          const source = response.body.pipeThrough(
            new TransformStream({
              transform(chunk, c) {
                received += chunk.byteLength;
                if (received > size || received > MAX_BYTES) throw new Error('媒體超過宣告大小');
                c.enqueue(chunk);
              },
              flush() {
                if (received !== size) throw new Error('媒體大小不完整');
              },
            }),
          );
          await Promise.all([
            source.pipeTo(lengthStream.writable),
            env.MEDIA.put(key, lengthStream.readable, { httpMetadata: { contentType: mime } }),
          ]);
          await settle(env, cost, Math.ceil((received / 1e9) * 0.015 * 1e6) + 10, {
            bytes: received,
            retention_days: 30,
          });
          Object.assign(asset, {
            object_key: key,
            bytes: received,
            mime,
            expires_at: new Date(now() + 30 * 86400000).toISOString(),
          });
          await query(
            env,
            "UPDATE learning_media SET object_key=?,bytes=?,mime=?,expires_at=?,status='stored',updated_at=? WHERE id=?",
            key,
            received,
            mime,
            asset.expires_at,
            nowIso(),
            asset.id,
          ).run();
        } catch (error) {
          await uncertain(env, cost);
          throw error;
        }
      }
      let file = asset.file_json ? JSON.parse(asset.file_json) : null;
      if (file?.expirationTime && Date.parse(file.expirationTime) < now() + 60000) file = null;
      if (!file) {
        const start = await fetcher('https://generativelanguage.googleapis.com/upload/v1beta/files', {
          method: 'POST',
          headers: {
            'x-goog-api-key': env.GEMINI_API_KEY,
            'content-type': 'application/json',
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(asset.bytes),
            'X-Goog-Upload-Header-Content-Type': asset.mime,
          },
          body: JSON.stringify({ file: { display_name: asset.id } }),
          signal: AbortSignal.timeout(30000),
        });
        if (!start.ok) {
          await start.body?.cancel();
          throw new Error(`Gemini 上傳初始化 HTTP ${start.status}`);
        }
        const upload = new URL(start.headers.get('x-goog-upload-url') || '');
        await start.body?.cancel();
        if (upload.origin !== 'https://generativelanguage.googleapis.com') throw new Error('Gemini 上傳位置不可信');
        const stored = await env.MEDIA.get(asset.object_key);
        if (!stored) throw new Error('原始媒體已不可取得');
        const uploaded = await apiJson(
          await fetcher(upload.href, {
            method: 'POST',
            headers: {
              'content-length': String(asset.bytes),
              'X-Goog-Upload-Offset': '0',
              'X-Goog-Upload-Command': 'upload, finalize',
            },
            body: stored.body,
            duplex: 'half',
            signal: AbortSignal.timeout(180000),
          }),
          64000,
        );
        file = uploaded.file;
      } else if (file.state === 'PROCESSING')
        file = await apiJson(
          await fetcher(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
            headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
            signal: AbortSignal.timeout(30000),
          }),
          64000,
        );
      if (!file?.name || !/^files\/[a-zA-Z0-9_-]+$/.test(file.name)) throw new Error('Gemini 檔案資訊缺漏');
      if (file.state === 'FAILED') {
        await fail(env, asset, 'Gemini 媒體處理失敗');
        continue;
      }
      if (file.state === 'ACTIVE') {
        if (!file.uri?.startsWith('https://generativelanguage.googleapis.com/'))
          throw new Error('Gemini 媒體 URI 不可信');
        const duration = asset.duration_ms || Math.round(parseFloat(file.videoMetadata?.videoDuration) * 1000);
        if (asset.type !== 'photo' && (!Number.isFinite(duration) || duration <= 0 || duration > 1200000)) {
          await fail(env, asset, '影片長度不可驗證或超過 20 分鐘，保留待人工處理');
          continue;
        }
        await query(
          env,
          "UPDATE learning_media SET file_json=?,duration_ms=?,status='ready',error=NULL,attempts=0,updated_at=? WHERE id=?",
          JSON.stringify(file),
          asset.type === 'photo' ? null : duration,
          nowIso(),
          asset.id,
        ).run();
      } else if (file.state === 'PROCESSING') {
        pending = true;
        await query(
          env,
          "UPDATE learning_media SET file_json=?,status='processing',updated_at=? WHERE id=?",
          JSON.stringify(file),
          nowIso(),
          asset.id,
        ).run();
      } else throw new Error('Gemini 檔案狀態不明');
    } catch (error) {
      if (error.name === 'BudgetPaused') throw error;
      const attempts = asset.attempts + 1;
      if (attempts < 3) pending = true;
      await query(
        env,
        'UPDATE learning_media SET status=?,attempts=?,error=?,updated_at=? WHERE id=?',
        attempts >= 3 ? 'needs_attention' : 'error',
        attempts,
        error.message,
        nowIso(),
        asset.id,
      ).run();
    }
  }
  return {
    pending,
    media: await rows(env, "SELECT * FROM learning_media WHERE item_id=? AND status='ready'", itemId),
    gaps: await rows(
      env,
      "SELECT id,url,error,status FROM learning_media WHERE item_id=? AND status IN ('error','needs_attention','expired')",
      itemId,
    ),
  };
}
const MAX_FIGURE_BYTES = 20 * 1024 * 1024;
// 正文圖表截圖：注入 script 替整頁第 N 個 <figure> 加標記，等標記出現後只截那個元素。
// 互動元件只截得到載入後的預設狀態；捲動整頁讓延遲載入的內容先畫出來。
async function storeFigure(env, asset) {
  if (!env.BROWSER) throw new Error('未設定 Browser Rendering，無法截取正文圖表');
  const index = figureIndex(asset.url);
  const response = await env.BROWSER.quickAction('screenshot', {
    url: figurePage(asset.url),
    gotoOptions: { waitUntil: 'networkidle2', timeout: 25000 },
    viewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
    addScriptTag: [
      { content: `document.querySelectorAll('figure')[${index}]?.setAttribute('data-technews-figure','');` },
    ],
    waitForSelector: { selector: '[data-technews-figure]', timeout: 10000 },
    waitForTimeout: 1000,
    scrollPage: true,
    selector: '[data-technews-figure]',
    screenshotOptions: { type: 'png' },
  });
  const mime = (response.headers.get('content-type') || '').split(';')[0];
  if (!response.ok || mime !== 'image/png') {
    await response.body?.cancel();
    throw new Error(`正文圖表截圖失敗（HTTP ${response.status}）`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_FIGURE_BYTES) throw new Error('正文圖表截圖大小不合理');
  const cost = await reserve(env, 'r2-storage', Math.ceil((bytes.byteLength / 1e9) * 0.015 * 1e6) + 10);
  try {
    const key = `learning/${asset.id}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    await settle(env, cost, Math.ceil((bytes.byteLength / 1e9) * 0.015 * 1e6) + 10, {
      bytes: bytes.byteLength,
      retention_days: 30,
    });
    Object.assign(asset, {
      object_key: key,
      bytes: bytes.byteLength,
      mime,
      expires_at: new Date(now() + 30 * 86400000).toISOString(),
    });
    await query(
      env,
      "UPDATE learning_media SET object_key=?,bytes=?,mime=?,expires_at=?,status='stored',updated_at=? WHERE id=?",
      key,
      asset.bytes,
      mime,
      asset.expires_at,
      nowIso(),
      asset.id,
    ).run();
  } catch (error) {
    await uncertain(env, cost);
    throw error;
  }
}
async function fail(env, asset, message) {
  await query(
    env,
    "UPDATE learning_media SET status='needs_attention',error=?,updated_at=? WHERE id=?",
    message,
    nowIso(),
    asset.id,
  ).run();
}
export async function expireMedia(env) {
  if (!env.MEDIA) return;
  for (const asset of await rows(
    env,
    "SELECT * FROM learning_media WHERE expires_at<? AND status!='expired' LIMIT 100",
    nowIso(),
  )) {
    await env.MEDIA.delete(asset.object_key);
    await query(
      env,
      "UPDATE learning_media SET object_key=NULL,status='expired',error='原始媒體已超過 30 天保存期限',updated_at=? WHERE id=?",
      nowIso(),
      asset.id,
    ).run();
  }
}

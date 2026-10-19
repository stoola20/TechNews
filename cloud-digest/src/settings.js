import { getSources } from "./sources.js";

export const DEFAULT_INTERESTS = "AI 模型與 API、AI coding／agents／skills／MCP、開發者工具、實作教學、工程設計、iOS／Apple 開發、DevDay／WWDC 等開發者活動。略過只有商務合作、企業採購、人物或政策宣傳且沒有技術或產品變更的文章。不要只看 category 決定；DevDay 即使標成 Company 仍須保留。";

// 文章庫的官方設定只有兩項：想收到的內容（官方文章的主題篩選）與來源清單。舊格式的 model_profile 一律忽略。
export function validateSettings(value) {
  if (!value || typeof value.interests !== "string" || !value.interests.trim() || value.interests.length > 4000) throw new Error("Interests must contain 1–4000 characters");
  if (!Array.isArray(value.sources)) throw new Error("Sources must be a JSON array");
  getSources({ SOURCES_JSON: JSON.stringify(value.sources) });
  return { interests: value.interests.trim(), sources: value.sources };
}

export async function readSettings(env) {
  const row = await env.DB.prepare("SELECT value_json FROM settings WHERE key = 'digest'").first();
  return row ? validateSettings(JSON.parse(row.value_json)) : validateSettings({ interests: env.DIGEST_INTERESTS || DEFAULT_INTERESTS, sources: getSources(env) });
}

export async function effectiveEnvironment(env) {
  const settings = await readSettings(env);
  return { ...env, DIGEST_INTERESTS: settings.interests, SOURCES_JSON: JSON.stringify(settings.sources) };
}

export async function saveSettings(env, value) {
  const settings = validateSettings(value);
  await env.DB.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('digest', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
    .bind(JSON.stringify(settings), new Date().toISOString()).run();
  return settings;
}

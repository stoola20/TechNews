import { getSources } from "./sources.js";
import { DEFAULT_INTERESTS } from "./format.js";

export const MODEL_PROFILES = {
  gemma4: { label: "Google Gemma 4 · Workers AI", provider: "workers_ai", model: "@cf/google/gemma-4-26b-a4b-it" },
  nemotron3: { label: "NVIDIA Nemotron 3 · Workers AI", provider: "workers_ai", model: "@cf/nvidia/nemotron-3-120b-a12b" },
  gpt_terra: { label: "GPT-5.6 Terra · OpenAI API", provider: "openai", model: "gpt-5.6-terra" },
  claude_sonnet: { label: "Claude Sonnet 5.5 · Anthropic API", provider: "anthropic", model: "claude-sonnet-5-5" },
};

export function validateSettings(value) {
  if (!value || !MODEL_PROFILES[value.model_profile]) throw new Error("Unknown model profile");
  if (typeof value.interests !== "string" || !value.interests.trim() || value.interests.length > 4000) throw new Error("Interests must contain 1–4000 characters");
  if (!Array.isArray(value.sources)) throw new Error("Sources must be a JSON array");
  getSources({ SOURCES_JSON: JSON.stringify(value.sources) });
  return { model_profile: value.model_profile, interests: value.interests.trim(), sources: value.sources };
}

export async function readSettings(env) {
  const row = await env.DB.prepare("SELECT value_json FROM settings WHERE key = 'digest'").first();
  return row ? validateSettings(JSON.parse(row.value_json)) : validateSettings({ model_profile: env.MODEL_PROFILE || "gemma4", interests: env.DIGEST_INTERESTS || DEFAULT_INTERESTS, sources: getSources(env) });
}

export function applySettings(env, settings) {
  const profile = MODEL_PROFILES[settings.model_profile];
  return { ...env, MODEL_PROFILE: settings.model_profile, SUMMARY_PROVIDER: profile.provider, SUMMARY_MODEL: profile.model, DIGEST_INTERESTS: settings.interests, SOURCES_JSON: JSON.stringify(settings.sources) };
}

export async function effectiveEnvironment(env) { return applySettings(env, await readSettings(env)); }

export async function saveSettings(env, value) {
  const settings = validateSettings(value);
  const provider = MODEL_PROFILES[settings.model_profile].provider;
  if (provider === "openai" && !env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY secret is not configured");
  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret is not configured");
  await env.DB.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('digest', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
    .bind(JSON.stringify(settings), new Date().toISOString()).run();
  return settings;
}

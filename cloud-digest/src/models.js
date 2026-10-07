import { EDITOR_INSTRUCTIONS, DEFAULT_INTERESTS, formatFullDigest, parseSummaryResult, summarizePrompt } from "./format.js";
import { readBoundedText } from "./sources.js";

export function modelConfiguration(env) {
  const provider = env.SUMMARY_PROVIDER || "workers_ai";
  const defaults = { openai: "gpt-5.6-terra", anthropic: "claude-sonnet-5-5", workers_ai: "@cf/google/gemma-4-26b-a4b-it" };
  if (!defaults[provider]) throw new Error("Unknown SUMMARY_PROVIDER");
  const model = env.SUMMARY_MODEL || defaults[provider];
  if (provider === "workers_ai" && !/^@cf\/(openai|google|nvidia)\//.test(model)) throw new Error("Workers AI model must be from OpenAI, Google, or NVIDIA");
  return { provider, model };
}

async function postJson(url, headers, body, fetcher) {
  let response;
  try {
    response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch {
    throw new Error("Model network request failed");
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Model API HTTP ${response.status}`); }
  return JSON.parse(await readBoundedText(response));
}

async function generate(env, config, prompt, fetcher) {
  if (config.provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
    const result = await postJson("https://api.openai.com/v1/responses", { authorization: `Bearer ${env.OPENAI_API_KEY}` }, {
      model: config.model, instructions: EDITOR_INSTRUCTIONS, input: prompt, max_output_tokens: 6000,
      store: false, text: { format: { type: "json_object" } },
    }, fetcher);
    if (result.status !== "completed") throw new Error("OpenAI output incomplete");
    return result.output?.flatMap((item) => item.type === "message" ? item.content || [] : []).filter((item) => item.type === "output_text").map((item) => item.text).join("") || "";
  }
  if (config.provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
    const result = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, {
      model: config.model, system: EDITOR_INSTRUCTIONS, messages: [{ role: "user", content: prompt }], max_tokens: 8000,
    }, fetcher);
    if (result.stop_reason !== "end_turn") throw new Error("Anthropic output incomplete");
    return result.content?.filter((item) => item.type === "text").map((item) => item.text).join("") || "";
  }
  if (!env.AI) throw new Error("Workers AI binding missing");
  const response = await env.AI.run(config.model, {
    messages: [{ role: "system", content: EDITOR_INSTRUCTIONS }, { role: "user", content: prompt }],
    max_completion_tokens: 6000, response_format: { type: "json_object" },
    ...(config.model.includes("nemotron") ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  });
  // Workers AI models return either response or the OpenAI chat completion shape.
  if (response?.choices) {
    if (response.choices[0]?.finish_reason !== "stop") throw new Error("Workers AI output incomplete");
    return response.choices[0]?.message?.content || "";
  }
  return response;
}

export async function summarize(env, source, entry, fetcher = fetch) {
  if (!entry.content || !entry.contentMethod) throw new Error("Full article content required");
  const config = modelConfiguration(env);
  const interests = env.DIGEST_INTERESTS || DEFAULT_INTERESTS;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = summarizePrompt(source, entry, interests, attempt ? "上次導讀超過 Telegram 上限。請重新編輯，移除重複與次要細節，body_zh 再縮短至少四分之一。" : "");
    const summary = parseSummaryResult(await generate(env, config, prompt, fetcher));
    if (!summary.publish || formatFullDigest(source, entry, summary).length <= 4096) return { ...summary, ...config };
  }
  throw new Error("AI article exceeds Telegram limit after editing");
}

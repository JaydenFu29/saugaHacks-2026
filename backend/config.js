/**
 * Configuration + .env loading.
 *
 * Hand-rolled parser rather than `dotenv` so the backend has ZERO npm dependencies —
 * `node server.js` just works, no install step for teammates.
 *
 * SECURITY: the API key lives only in this process. It is never sent to the browser,
 * never logged, and `.env` is gitignored.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKEND_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(BACKEND_DIR, "..");

/** Minimal .env parser: KEY=VALUE, `#` comments, optional quotes, ignores `export `. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  /** @type {Record<string,string>} */
  const out = {};

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvFile(join(BACKEND_DIR, ".env"));
/** Real environment variables win over the file, so CI/hosting can override. */
const env = { ...fileEnv, ...process.env };

const apiKey = (env.FEATHERLESS_API_KEY || "").trim();

/** Reject the placeholder so a forgotten paste fails loudly instead of 401-ing later. */
const PLACEHOLDERS = ["", "your_featherless_api_key_here", "rc_xxxxxxxxxxxxxxxx", "changeme"];
const hasRealKey = !PLACEHOLDERS.includes(apiKey.toLowerCase());

export const config = {
  port: Number(env.PORT) || 8787,
  apiKey,
  hasApiKey: hasRealKey,
  baseUrl: (env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1").replace(/\/+$/, ""),
  // NOT a meta-llama/* id: those are gated behind a HuggingFace licence link and answer
  // 403 even with a valid key. This one is open and is what the app is tuned against.
  model: env.FEATHERLESS_MODEL || "Qwen/Qwen3-30B-A3B-Instruct-2507",
  /**
   * Separate model for camera frames — the guidance model is text-only and silently
   * ignores images.
   *
   * DO NOT swap this without re-running the accuracy probe on real photographs. Being
   * listed as available is not the same as working: Qwen2.5-VL-32B is served here and
   * answers HTTP 200, but returns token salad ("， system-type code code") for every
   * frame, and Qwen2.5-VL-3B invented "a person lying on the ground with their eyes
   * closed" for a photo of a first-aid kit. Both are unusable here and neither announces
   * itself as broken. 72B has now been verified twice, on separate days.
   */
  visionModel: env.FEATHERLESS_VISION_MODEL || "Qwen/Qwen2.5-VL-72B-Instruct",
  /**
   * Featherless takes vision models in and out of capacity constantly, so a busy primary
   * is routine rather than exceptional. Both fallbacks were checked against the same
   * control images as the primary and describe them correctly.
   */
  visionFallbacks: (env.FEATHERLESS_VISION_FALLBACKS ||
    "Qwen/Qwen3-VL-30B-A3B-Instruct,Qwen/Qwen3-VL-8B-Instruct")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  visionEnabled: String(env.VISION_ENABLED ?? "true").toLowerCase() !== "false",
  maxTokens: Number(env.FEATHERLESS_MAX_TOKENS) || 900, // room to fully teach a technique
  /** One short paragraph of observation is plenty, and keeps the frame turnaround fast. */
  visionMaxTokens: Number(env.FEATHERLESS_VISION_MAX_TOKENS) || 160,
  /** Frames are time-critical: fail fast to the text-only path rather than stalling a turn. */
  visionTimeoutMs: Number(env.FEATHERLESS_VISION_TIMEOUT_MS) || 10000,
  /**
   * Ceiling for the whole fallback walk. Without it three candidates at 10s each could
   * hold a turn for 30s — longer than the browser waits — and the user would sit staring
   * at "Thinking" while the assistant had nothing to say.
   */
  visionTotalBudgetMs: Number(env.FEATHERLESS_VISION_BUDGET_MS) || 18000,
  temperature: Number.isFinite(Number(env.FEATHERLESS_TEMPERATURE))
    ? Number(env.FEATHERLESS_TEMPERATURE)
    : 0.3, // low: this is safety guidance, not creative writing
  requestTimeoutMs: Number(env.FEATHERLESS_TIMEOUT_MS) || 25000,
};

/** Safe to log / expose — never includes the key itself. */
export function describeConfig() {
  return {
    port: config.port,
    model: config.model,
    visionModel: config.visionEnabled ? config.visionModel : null,
    visionEnabled: config.visionEnabled,
    baseUrl: config.baseUrl,
    hasApiKey: config.hasApiKey,
    keyPreview: config.hasApiKey ? `…${config.apiKey.slice(-4)}` : null,
  };
}

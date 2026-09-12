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
  model: env.FEATHERLESS_MODEL || "meta-llama/Meta-Llama-3.1-8B-Instruct",
  /**
   * Separate model for camera frames — the guidance model is text-only and silently
   * ignores images. Verified against this provider: Qwen2.5-VL-72B reads frames
   * correctly (~1.7s); the 32B variant returned confidently wrong colours on a
   * control image, so do not "downgrade" this for speed without re-testing.
   */
  visionModel: env.FEATHERLESS_VISION_MODEL || "Qwen/Qwen2.5-VL-72B-Instruct",
  visionEnabled: String(env.VISION_ENABLED ?? "true").toLowerCase() !== "false",
  maxTokens: Number(env.FEATHERLESS_MAX_TOKENS) || 550, // room for real technique detail
  /** One short paragraph of observation is plenty, and keeps the frame turnaround fast. */
  visionMaxTokens: Number(env.FEATHERLESS_VISION_MAX_TOKENS) || 160,
  /** Frames are time-critical: fail fast to the text-only path rather than stalling a turn. */
  visionTimeoutMs: Number(env.FEATHERLESS_VISION_TIMEOUT_MS) || 15000,
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

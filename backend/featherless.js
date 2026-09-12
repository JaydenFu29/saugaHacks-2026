/**
 * Featherless AI provider.
 *
 * Featherless exposes an OpenAI-compatible API, so this is a plain chat/completions
 * call. Swapping providers means changing baseUrl + model, nothing else.
 *
 * The API key is read from config (backend/.env) and only ever travels in the
 * Authorization header of this server-to-server request. It never reaches the browser.
 */

import { config } from "./config.js";

/** Errors that carry an HTTP status we can map to a useful client response. */
export class ProviderError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * One transport for every model call. Vision and text differ only in the model id, the
 * shape of `content`, and the limits — not in how the request is made.
 *
 * @param {{role: string, content: any}[]} messages
 * @param {{model?: string, maxTokens?: number, temperature?: number,
 *          timeoutMs?: number, jsonMode?: boolean}} [options]
 * @returns {Promise<{text: string, model: string, usage: any}>}
 */
export async function chatCompletion(messages, options = {}) {
  if (!config.hasApiKey) {
    throw new ProviderError(
      "FEATHERLESS_API_KEY is not set in backend/.env",
      { status: 503 }
    );
  }

  const model = options.model || config.model;
  const timeoutMs = options.timeoutMs || config.requestTimeoutMs;
  const jsonMode = options.jsonMode !== false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens || config.maxTokens,
        temperature: options.temperature ?? config.temperature,
        // Ask for JSON. Not every open model honours this flag, so the parser
        // downstream also tolerates prose — see assistant.js. Vision calls want
        // plain prose back, so they opt out.
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new ProviderError(
        `Featherless timed out after ${timeoutMs}ms`,
        { status: 504, retryable: true }
      );
    }
    throw new ProviderError(`Could not reach Featherless: ${err.message}`, {
      status: 502,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Read the body for diagnostics, but never echo headers (they'd carry the key).
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* body unreadable */
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        "Featherless rejected the API key (check FEATHERLESS_API_KEY in backend/.env)",
        { status: 502 }
      );
    }
    if (res.status === 404) {
      throw new ProviderError(
        `Featherless does not serve model "${model}" (check FEATHERLESS_MODEL / FEATHERLESS_VISION_MODEL in backend/.env)`,
        { status: 502 }
      );
    }
    if (res.status === 403) {
      throw new ProviderError(
        `Model "${model}" is gated on Featherless — pick an ungated model or verify HuggingFace access`,
        { status: 502 }
      );
    }
    if (res.status === 429) {
      throw new ProviderError("Featherless rate limit hit", { status: 429, retryable: true });
    }
    throw new ProviderError(`Featherless returned ${res.status}: ${detail}`, {
      status: 502,
      retryable: res.status >= 500,
    });
  }

  const data = await res.json();

  // Featherless can answer 200 OK with an error body instead of choices — notably
  // "<model> is temporarily at capacity". Surface that reason rather than a generic
  // "empty completion", since it's actionable (wait, or switch model).
  if (data?.error?.message) {
    const message = String(data.error.message);
    throw new ProviderError(`Featherless: ${message}`, {
      status: 503,
      retryable: /capacity|rate|try again|busy|overload/i.test(message),
    });
  }

  const text = data?.choices?.[0]?.message?.content;

  if (typeof text !== "string" || !text.trim()) {
    throw new ProviderError(`Featherless returned an empty completion from "${model}"`, {
      status: 502,
    });
  }

  return { text: text.trim(), model: data.model || model, usage: data.usage || null };
}

/** Cheap connectivity/auth probe used by /api/health. Does not spend real tokens. */
export async function pingProvider() {
  if (!config.hasApiKey) return { ok: false, reason: "no-api-key" };
  try {
    const { text } = await chatCompletion([
      { role: "system", content: "Reply with the single word: ok" },
      { role: "user", content: "ping" },
    ]);
    return { ok: true, sample: text.slice(0, 40) };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

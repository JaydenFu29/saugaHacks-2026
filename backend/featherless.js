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
 * @param {{role: string, content: string}[]} messages
 * @returns {Promise<{text: string, model: string, usage: any}>}
 */
export async function chatCompletion(messages) {
  if (!config.hasApiKey) {
    throw new ProviderError(
      "FEATHERLESS_API_KEY is not set in backend/.env",
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        // Ask for JSON. Not every open model honours this flag, so the parser
        // downstream also tolerates prose — see assistant.js.
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new ProviderError(
        `Featherless timed out after ${config.requestTimeoutMs}ms`,
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
        `Featherless does not serve model "${config.model}" (set FEATHERLESS_MODEL in backend/.env)`,
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
  const text = data?.choices?.[0]?.message?.content;

  if (typeof text !== "string" || !text.trim()) {
    throw new ProviderError("Featherless returned an empty completion", { status: 502 });
  }

  return { text: text.trim(), model: data.model || config.model, usage: data.usage || null };
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

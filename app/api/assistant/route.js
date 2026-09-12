/**
 * POST /api/assistant — the emergency assistant turn.
 *
 *   Browser → THIS route → Featherless AI
 *
 * The API key lives only in the server environment (FEATHERLESS_API_KEY) and never
 * reaches the browser.
 */

import { generateResponse } from "../../../lib/server/assistant.js";
import { ProviderError } from "../../../lib/server/featherless.js";

// Always run this fresh — an emergency reply must never be served from a cache.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// An LLM round-trip is slow on a cold start; give it room.
export const maxDuration = 60;

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userMessage = String(payload?.userMessage || "").trim();
  if (!userMessage) {
    return Response.json({ error: "userMessage is required" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const response = await generateResponse({
      userMessage,
      context: payload.context || {},
      visualContext: payload.visualContext || null,
    });

    console.log(
      `[assistant] ${Date.now() - started}ms urgency=${response.urgency} ` +
        `parsed=${response.meta?.parsed} turns=${(payload.context?.messages || []).length}`
    );

    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : 500;
    // Log the cause server-side; the client gets a safe message and falls back to its
    // own scripted assistant so the emergency flow never dead-ends.
    console.error(`[assistant] failed after ${Date.now() - started}ms:`, err.message);
    return Response.json(
      { error: err.message, retryable: Boolean(err.retryable) },
      { status }
    );
  }
}

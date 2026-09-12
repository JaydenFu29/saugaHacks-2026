/**
 * Vercel serverless function: POST /api/assistant
 *
 * Same contract and same logic as the local `backend/server.js` route — this is just the
 * serverless wrapper around it, because Vercel runs functions, not long-lived servers.
 *
 * The API key comes from the FEATHERLESS_API_KEY environment variable set in the Vercel
 * dashboard. It stays server-side and never reaches the browser.
 */

import { generateResponse } from "../backend/assistant.js";
import { ProviderError } from "../backend/featherless.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  // Vercel parses JSON bodies automatically, but be tolerant of a raw string.
  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload || "{}");
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }
  payload = payload || {};

  const userMessage = String(payload.userMessage || "").trim();
  if (!userMessage) {
    res.status(400).json({ error: "userMessage is required" });
    return;
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

    res.status(200).json(response);
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : 500;
    // Reason is logged server-side; the client gets a safe message and falls back to its
    // own scripted assistant so the emergency flow never dead-ends.
    console.error(`[assistant] failed after ${Date.now() - started}ms:`, err.message);
    res.status(status).json({ error: err.message, retryable: Boolean(err.retryable) });
  }
}

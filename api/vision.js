/**
 * Vercel serverless function: POST /api/vision
 *
 * One camera frame in, one sentence of plain observation out. Kept separate from
 * /api/assistant so a slow or failing vision model degrades to a text-only turn instead
 * of taking the whole conversation down.
 */

import { describeFrame, validateFrame } from "../backend/vision.js";
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

  const frame = validateFrame(payload.frameDataUrl);
  if (!frame.ok) {
    res.status(400).json({ error: frame.reason });
    return;
  }

  const started = Date.now();
  try {
    const result = await describeFrame(frame.dataUrl);
    const ms = Date.now() - started;
    console.log(`[vision] ${ms}ms "${result.observedContext.slice(0, 70)}"`);
    res.status(200).json({
      observedContext: result.observedContext,
      model: result.model,
      tookMs: ms,
    });
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : 500;
    console.error(`[vision] failed after ${Date.now() - started}ms:`, err.message);
    res.status(status).json({ error: err.message, retryable: Boolean(err.retryable) });
  }
}

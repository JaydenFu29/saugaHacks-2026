/**
 * POST /api/vision — one camera frame in, one sentence of plain observation out.
 *
 * Separate from /api/assistant on purpose: if the vision model is slow or failing, the
 * conversation degrades to a text-only turn instead of going down with it.
 */

import { describeFrame, validateFrame } from "../../../lib/server/vision.js";
import { ProviderError } from "../../../lib/server/featherless.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const frame = validateFrame(payload?.frameDataUrl);
  if (!frame.ok) {
    return Response.json({ error: frame.reason }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await describeFrame(frame.dataUrl);
    const ms = Date.now() - started;
    console.log(`[vision] ${ms}ms "${result.observedContext.slice(0, 70)}"`);
    return Response.json(
      { observedContext: result.observedContext, model: result.model, tookMs: ms },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : 500;
    console.error(`[vision] failed after ${Date.now() - started}ms:`, err.message);
    return Response.json(
      { error: err.message, retryable: Boolean(err.retryable) },
      { status }
    );
  }
}

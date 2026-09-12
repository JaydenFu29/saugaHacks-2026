/**
 * GET /api/health — deployment smoke test.
 *
 * Reports whether the API key and models are configured. Never returns the key itself,
 * only whether one is present plus its last four characters.
 */

import { describeConfig } from "../../../lib/server/config.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    { ok: true, runtime: "next", ...describeConfig() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

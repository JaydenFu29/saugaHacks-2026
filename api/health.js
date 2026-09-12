/**
 * Vercel serverless function: GET /api/health
 *
 * Deployment smoke test. Reports whether the API key and models are configured.
 * Never returns the key itself — only whether one is present and its last 4 characters.
 */

import { describeConfig } from "../backend/config.js";

export default function handler(req, res) {
  res.status(200).json({ ok: true, runtime: "vercel", ...describeConfig() });
}

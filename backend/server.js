/**
 * Emergency assistant backend.
 *
 *   Browser → THIS server → Featherless AI
 *
 * The browser never sees the API key. It only ever calls /api/assistant on this origin.
 *
 * This also serves apps/web and apps/site statically, so the whole demo runs from one
 * origin on http://localhost:8787 — no CORS, and localhost counts as a secure context so
 * camera and microphone still work.
 *
 * Zero npm dependencies: node:http + built-in fetch. Just `node backend/server.js`.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, normalize, extname } from "node:path";
import { config, describeConfig, REPO_ROOT } from "./config.js";
import { generateResponse } from "./assistant.js";
import { ProviderError } from "./featherless.js";
import { describeFrame, validateFrame } from "./vision.js";

const STATIC_ROOT = join(REPO_ROOT, "apps");
const MAX_BODY_BYTES = 2 * 1024 * 1024; // frames can ride along in visualContext

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

/** Allow a separately-served frontend (e.g. python http.server) during development. */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveStatic(req, res, pathname) {
  // Default to the emergency app; `/site/` serves the marketing page.
  // Redirect (rather than serve the file inline) so the browser's URL becomes
  // /web/, and index.html's relative asset paths (styles.css, main.js) resolve
  // to /web/styles.css, /web/main.js instead of 404ing at the root.
  if (pathname === "/") {
    res.writeHead(302, { Location: "/web/" }).end();
    return;
  }
  let rel = pathname;
  if (rel.endsWith("/")) rel += "index.html";

  // Contain the path inside apps/ — normalize() collapses any ../ traversal.
  const target = normalize(join(STATIC_ROOT, rel));
  if (!target.startsWith(STATIC_ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: `${pathname.replace(/\/$/, "")}/index.html` }).end();
      return;
    }
    const type = MIME[extname(target).toLowerCase()] || "application/octet-stream";

    // Video needs byte ranges: Safari will not play a <video> at all unless the server
    // answers 206, and without this the whole 28MB hero file is buffered into memory on
    // every single request. Streaming also means seeking works.
    if (type.startsWith("video/")) {
      const range = req.headers.range;
      const match = /^bytes=(\d*)-(\d*)$/.exec(range || "");

      if (match) {
        let start = match[1] === "" ? null : Number(match[1]);
        let end = match[2] === "" ? null : Number(match[2]);
        // A suffix range ("bytes=-500") means the LAST 500 bytes.
        if (start === null) {
          start = Math.max(0, info.size - (end || 0));
          end = info.size - 1;
        } else if (end === null || end >= info.size) {
          end = info.size - 1;
        }

        if (start >= info.size || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
          return;
        }

        res.writeHead(206, {
          "Content-Type": type,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        });
        if (req.method === "HEAD") { res.end(); return; }
        createReadStream(target, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": info.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") { res.end(); return; }
      createReadStream(target).pipe(res);
      return;
    }

    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": data.length,
      "Cache-Control": "no-store", // always serve fresh during the hackathon
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // ── health ──────────────────────────────────────────────────────────────
  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, ...describeConfig() });
    return;
  }

  // ── the assistant ───────────────────────────────────────────────────────
  if (pathname === "/api/assistant") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch (err) {
      sendJson(res, err.status === 413 ? 413 : 400, {
        error: err.status === 413 ? "Request too large" : "Invalid JSON body",
      });
      return;
    }

    const userMessage = String(payload.userMessage || "").trim();
    if (!userMessage) {
      sendJson(res, 400, { error: "userMessage is required" });
      return;
    }

    const started = Date.now();
    try {
      const response = await generateResponse({
        userMessage,
        context: payload.context || {},
        visualContext: payload.visualContext || null,
        preferredLanguage: String(payload.preferredLanguage || "").slice(0, 20),
      });

      const ms = Date.now() - started;
      console.log(
        `[assistant] ${ms}ms urgency=${response.urgency} parsed=${response.meta.parsed} ` +
          `turns=${(payload.context?.messages || []).length} "${userMessage.slice(0, 50)}"`
      );

      sendJson(res, 200, response);
    } catch (err) {
      const status = err instanceof ProviderError ? err.status : 500;
      // Log the reason server-side; the client gets a safe message and falls back
      // to its own scripted assistant so the emergency flow never dead-ends.
      console.error(`[assistant] failed after ${Date.now() - started}ms:`, err.message);
      sendJson(res, status, { error: err.message, retryable: Boolean(err.retryable) });
    }
    return;
  }

  // ── vision: one camera frame → one sentence of observation ──────────────
  // Kept separate from /api/assistant so a slow or failing vision model degrades to a
  // text-only turn instead of taking the whole conversation down with it.
  if (pathname === "/api/vision") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch (err) {
      sendJson(res, err.status === 413 ? 413 : 400, {
        error: err.status === 413 ? "Frame too large" : "Invalid JSON body",
      });
      return;
    }

    const frame = validateFrame(payload.frameDataUrl);
    if (!frame.ok) {
      sendJson(res, 400, { error: frame.reason });
      return;
    }

    const started = Date.now();
    try {
      const result = await describeFrame(frame.dataUrl);
      const ms = Date.now() - started;
      console.log(`[vision] ${ms}ms "${result.observedContext.slice(0, 70)}"`);
      sendJson(res, 200, {
        observedContext: result.observedContext,
        model: result.model,
        tookMs: ms,
      });
    } catch (err) {
      const status = err instanceof ProviderError ? err.status : 500;
      console.error(`[vision] failed after ${Date.now() - started}ms:`, err.message);
      sendJson(res, status, { error: err.message, retryable: Boolean(err.retryable) });
    }
    return;
  }

  // ── static ──────────────────────────────────────────────────────────────
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(config.port, () => {
  const info = describeConfig();
  console.log(`\n  Emergency assistant backend`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  Emergency app   http://localhost:${config.port}/web/index.html`);
  console.log(`  Site            http://localhost:${config.port}/site/index.html`);
  console.log(`  Health          http://localhost:${config.port}/api/health`);
  console.log(`  Model           ${info.model}`);
  console.log(`  Vision model    ${info.visionModel || "disabled"}`);
  console.log(
    info.hasApiKey
      ? `  API key         loaded (${info.keyPreview})`
      : `  API key         MISSING — add FEATHERLESS_API_KEY to backend/.env`
  );
  console.log("");
});

/**
 * Camera frame → plain-language observation.
 *
 * The guidance model (FEATHERLESS_MODEL) is text-only: images handed to it are silently
 * dropped. So a frame goes to a vision model FIRST, and only the resulting sentence of
 * observation is folded into the guidance prompt (see prompt.js buildContextBlock).
 *
 * Safety framing: this module reports what is VISIBLE. It never diagnoses, never names a
 * condition, and never recommends an action — that judgement belongs to the guidance
 * model working from the full conversation, not to a single frame.
 */

import { config } from "./config.js";
import { chatCompletion, ProviderError } from "./featherless.js";

const VISION_PROMPT = `You are the eyes of an emergency first-aid assistant. You are looking at ONE still
frame from a bystander's phone camera at the scene of a possible emergency.

Report only what is VISIBLE. Be concrete and specific.

Cover, when visible:
- People: how many, and their body position (standing, sitting, lying down, slumped).
- Whether a person appears to be moving, and whether their eyes appear open or closed.
- Visible blood, wounds, burns, swelling, or objects involved in an injury, and WHERE on
  the body they are (left arm, forehead, right leg).
- The setting: indoors/outdoors, road, water, stairs, vehicle, bicycle, machinery.
- Visible hazards: traffic, fire, smoke, broken glass, spilled liquid, live wires, crowd.

Hard rules:
- NEVER diagnose. Do not name a medical condition. Do not say someone is unconscious,
  in cardiac arrest, or "having a stroke" — say what you SEE, e.g. "lying still, eyes
  appear closed, no visible movement".
- NEVER recommend an action or treatment.
- Do NOT guess at what you cannot make out. If the frame is dark, blurred, or shows no
  person, say exactly that.
- No preamble, no markdown, no lists. Two or three plain sentences, under 60 words.`;

/**
 * A served vision model can fail while answering HTTP 200 with a normal-looking body.
 * Two real examples from this provider, both of which would otherwise have been handed
 * to the guidance model as "what you can see right now":
 *   - Qwen2.5-VL-32B returned "， system-type code code" for every frame.
 *   - Qwen2.5-VL-3B returned its own capacity notice as the description.
 * Neither is detectable from the status code, so the text itself has to be checked.
 *
 * @param {string} text
 * @returns {string} the reason it is unusable, or "" when it looks like a description
 */
function rejectionReason(text) {
  if (text.length < 25) return "description too short to be real";

  // The prompt is English and demands English. A reply that is largely CJK is a model
  // that has come off the rails, not a translation.
  const cjk = (text.match(/[\u3000-\u9fff\uff00-\uffef]/g) || []).length;
  if (cjk > text.length * 0.15) return "description is not English";

  // Capacity notices arriving as content rather than as an error.
  if (/\b(temporarily at capacity|is busy|try again (shortly|later)|rate limit)\b/i.test(text)) {
    return "model returned a capacity notice instead of a description";
  }

  // Degenerate repetition: the same word over and over ("a system, but it will be a
  // system, but it"). Real descriptions do not repeat one word a fifth of the time.
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length >= 12) {
    const counts = new Map();
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    const commonest = Math.max(...counts.values());
    if (commonest > words.length * 0.2) return "description is degenerate repetition";
  }

  return "";
}

/** Accept only what a <canvas> toDataURL actually produces, and cap the decoded size. */
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_FRAME_BYTES = 1_500_000;

/**
 * @param {unknown} frameDataUrl
 * @returns {{ok: true, dataUrl: string} | {ok: false, reason: string}}
 */
export function validateFrame(frameDataUrl) {
  if (typeof frameDataUrl !== "string" || !frameDataUrl) {
    return { ok: false, reason: "frameDataUrl is required" };
  }
  const match = DATA_URL_RE.exec(frameDataUrl.trim());
  if (!match) {
    return { ok: false, reason: "frameDataUrl must be a base64 image data URL" };
  }
  // 4 base64 chars encode 3 bytes; close enough for a size guard.
  if (Math.floor((match[2].length * 3) / 4) > MAX_FRAME_BYTES) {
    return { ok: false, reason: "frame is too large" };
  }
  return { ok: true, dataUrl: frameDataUrl.trim() };
}

/**
 * Describe one frame.
 *
 * @param {string} dataUrl validated image data URL
 * @returns {Promise<{observedContext: string, model: string, usage: any}>}
 */
export async function describeFrame(dataUrl) {
  if (!config.visionEnabled) {
    throw new ProviderError("Vision is disabled (VISION_ENABLED=false)", { status: 503 });
  }

  const messages = [
    { role: "system", content: VISION_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Describe what is visible in this frame." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  // A 503 "capacity_exhausted" on a vision model is routine on this provider, not
  // exceptional. Walk the fallback list rather than letting one busy model blind the
  // assistant for the rest of the session.
  const candidates = [...new Set([config.visionModel, ...config.visionFallbacks])];
  const deadline = Date.now() + config.visionTotalBudgetMs;
  let lastErr = null;

  for (const candidate of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) {
      console.warn(`[vision] budget spent, not trying ${candidate}`);
      break;
    }

    let text;
    let model;
    let usage;
    try {
      ({ text, model, usage } = await chatCompletion(messages, {
        model: candidate,
        maxTokens: config.visionMaxTokens,
        timeoutMs: Math.min(config.visionTimeoutMs, remaining),
        // Describing a scene is not creative writing; keep it literal.
        temperature: 0.1,
        // Prose, not JSON — and the VL models honour json_object poorly.
        jsonMode: false,
      }));
    } catch (err) {
      lastErr = err;
      // Trust the flag the provider client already worked out. Re-deriving it here from
      // the message text was a bug: Featherless says "This model is busy, please try
      // again later", which matched none of the patterns tried here, so the very first
      // busy model aborted the walk and the fallbacks were never reached.
      const retryable =
        err instanceof ProviderError
          ? err.retryable
          : /capacity|rate|try again|busy|overload|timed out|5\d\d/i.test(err.message || "");
      if (!retryable) throw err;
      console.warn(`[vision] ${candidate} unavailable, trying next: ${err.message.slice(0, 80)}`);
      continue;
    }

    const observedContext = text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[*_#`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // A 200 is not success. Check what actually came back before letting it become the
    // assistant's eyes — a bad description is worse than none, because the guidance model
    // is told to trust it and act on it.
    const bad = observedContext ? rejectionReason(observedContext) : "empty description";
    if (bad) {
      lastErr = new ProviderError(`${candidate}: ${bad}`, { status: 502, retryable: true });
      console.warn(`[vision] ${candidate} answered but ${bad}, trying next`);
      continue;
    }

    return { observedContext, model, usage };
  }

  throw lastErr || new ProviderError("No vision model available", { status: 503 });
}

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

  const { text, model, usage } = await chatCompletion(
    [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe what is visible in this frame." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    {
      model: config.visionModel,
      maxTokens: config.visionMaxTokens,
      timeoutMs: config.visionTimeoutMs,
      // Describing a scene is not creative writing; keep it literal.
      temperature: 0.1,
      // Prose, not JSON — and the VL models honour json_object poorly.
      jsonMode: false,
    }
  );

  const observedContext = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!observedContext) {
    throw new ProviderError("Vision model returned no description", { status: 502 });
  }

  return { observedContext, model, usage };
}

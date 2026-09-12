/**
 * Turns a frontend request into a model call and back into the AIResponse shape the
 * browser already expects (see apps/web/types/ai.js).
 */

import { buildMessages } from "./prompt.js";
import { chatCompletion } from "./featherless.js";

const URGENCIES = ["low", "moderate", "high", "critical"];

/**
 * Models don't reliably honour response_format, so recover JSON from:
 *   1. a clean object
 *   2. a ```json fenced block
 *   3. the first balanced {...} span in prose
 * Falling back to treating the whole reply as spoken text.
 *
 * @param {string} text
 */
function parseModelOutput(text) {
  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(text);
  if (direct) return { obj: direct, recovered: "direct" };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = attempt(fenced[1].trim());
    if (parsed) return { obj: parsed, recovered: "fenced" };
  }

  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = attempt(text.slice(start, i + 1));
          if (parsed) return { obj: parsed, recovered: "embedded" };
          break;
        }
      }
    }
  }

  // No JSON at all — the prose is still usable as the spoken reply.
  return { obj: { message: text }, recovered: "plaintext" };
}

/** Strip anything that would be read aloud badly or leak the JSON wrapper. */
function cleanSpoken(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Safety net: if the conversation clearly involves a life-threatening sign, the reply
 * must not be labelled low urgency, and 911 must be on the table. The prompt already
 * demands this; this is belt-and-braces because urgency drives the UI.
 */
const CRITICAL_SIGNS =
  /\b(not breathing|isn'?t breathing|no pulse|unrespons|unconscious|not responding|choking|severe bleed|bleeding heavily|won'?t wake|cardiac|seizure|anaphyla|overdose|drowning)\b/i;

function enforceUrgency(urgency, haystack) {
  const normalized = URGENCIES.includes(urgency) ? urgency : "moderate";
  if (CRITICAL_SIGNS.test(haystack)) {
    const rank = URGENCIES.indexOf(normalized);
    return rank < URGENCIES.indexOf("high") ? "critical" : normalized;
  }
  return normalized;
}

/**
 * @param {{userMessage: string, context: any, visualContext: any}} payload
 * @returns {Promise<any>} AIResponse-shaped object
 */
export async function generateResponse(payload) {
  const messages = buildMessages(payload);
  const { text, model, usage } = await chatCompletion(messages);

  const { obj, recovered } = parseModelOutput(text);

  const message = cleanSpoken(obj.message ?? obj.reply ?? obj.text ?? text);
  if (!message) {
    throw new Error("Model produced no usable message");
  }

  const context = payload.context || {};
  const haystack = `${payload.userMessage || ""} ${message} ${JSON.stringify(
    context.knownFacts || {}
  )}`;

  const instruction = cleanSpoken(obj.instruction) || null;

  const knownFacts =
    obj.knownFacts && typeof obj.knownFacts === "object" && !Array.isArray(obj.knownFacts)
      ? obj.knownFacts
      : {};

  const newActions = Array.isArray(obj.actions)
    ? obj.actions.map((a) => cleanSpoken(a)).filter(Boolean)
    : [];

  return {
    message,
    instruction,
    // No scripted step graph behind a real model — the instruction IS the step.
    nextStep: typeof obj.nextStep === "string" ? obj.nextStep : context.currentStep || null,
    scenario:
      (typeof obj.scenario === "string" && obj.scenario && obj.scenario !== "null"
        ? obj.scenario
        : null) || context.scenario || null,
    urgency: enforceUrgency(obj.urgency, haystack),
    actions: [...new Set([...(context.actionsTaken || []), ...newActions])],
    knownFacts,
    source: "backend",
    audioUrl: null,
    // Diagnostics — handy while demoing, harmless to expose (no key material).
    meta: { model, usage, parsed: recovered },
  };
}

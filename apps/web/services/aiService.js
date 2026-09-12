/**
 * AI service — the single boundary between the UI and the model.
 *
 * Architecture (deliberate): Frontend → OUR backend → AI provider.
 * The frontend never calls a vendor API and never holds a key.
 *
 * EVERY answer here comes from the model. This used to fall back to a scripted mock
 * whenever the backend hiccuped, which was a mistake: the script is a fixed step graph
 * (intake → scene safety → responsiveness → call 911) that says the same thing whether
 * someone is choking or bleeding, opens every reply with "I'm not a medical professional
 * and I can't diagnose anyone", and escalates to "this is beyond what I should guide you
 * through". On screen it is indistinguishable from the real assistant, so a user in an
 * emergency acts on it believing it was written for their situation.
 *
 * A visible failure they can retry beats a plausible answer that was not about them. So
 * a backend problem now surfaces as a backend problem. See mock/ for the old script — it
 * is no longer wired in.
 *
 * @typedef {import("../types/ai.js").AIRequest} AIRequest
 * @typedef {import("../types/ai.js").AIResponse} AIResponse
 */

/** Overridable from the page: `window.AIDLIVE_CONFIG = { aiEndpoint: "/api/assistant" }`. */
const CONFIG = (typeof window !== "undefined" && window.AIDLIVE_CONFIG) || {};
const AI_ENDPOINT = CONFIG.aiEndpoint || "/api/assistant";
const HEALTH_ENDPOINT = CONFIG.healthEndpoint || "/api/health";
// An LLM round-trip is slower than a plain API call, and a fully-described technique is
// a lot of tokens. The backend gives up at 25s; allow a little more than that here.
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Raised when the model could not answer. The UI shows this as itself — an error with a
 * retry — rather than papering over it with something that reads like guidance.
 */
export class AssistantUnavailableError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason || "The assistant is unreachable.");
    this.name = "AssistantUnavailableError";
  }
}

/**
 * The opening line, before the user has said anything.
 *
 * Deliberately NOT a disclaimer. The old one led with "I'm an assistant, not a medical
 * professional, and I can't diagnose anyone" — the first thing a panicking person heard
 * was the app distancing itself from them. The standing safety note lives in the
 * footnote, where it belongs, and the model is instructed not to repeat it.
 */
const OPENING_LINE =
  "I'm here, and I'll stay with you. Tell me what's happening — a few words is enough — " +
  "or point the camera at them and describe what you can see.";

/**
 * Strip the session down to what the model actually needs. Frames are big; we send the
 * observed-context string and only include image data when the backend asks for it.
 *
 * @param {AIRequest} request
 */
function serializeRequest(request) {
  const s = request.emergencyContext;
  return {
    userMessage: request.userMessage,
    // Explicit language choice from the picker. Overrides the backend's script
    // detection, which cannot tell Polish from English on a one-word first message.
    preferredLanguage: request.preferredLanguage || "",
    context: {
      sessionId: s.sessionId,
      startTime: s.startTime,
      scenario: s.scenario,
      currentStep: s.currentStep,
      currentInstruction: s.currentInstruction,
      knownFacts: s.knownFacts,
      actionsTaken: s.actionsTaken,
      cameraStatus: s.cameraStatus,
      microphoneStatus: s.microphoneStatus,
      urgency: s.urgency,
      // Trim to the last 20 turns — enough context, bounded payload.
      messages: s.messages.slice(-20).map((m) => ({ role: m.role, text: m.text, at: m.at })),
    },
    // The frame itself is NOT resent here. It already went to /api/vision, and the
    // guidance model is text-only — it would just be ~60KB of base64 per turn that
    // nothing reads. `observedContext` is the vision model's output.
    visualContext: request.visualContext
      ? {
          observedContext: request.visualContext.observedContext,
          fromCamera: request.visualContext.fromCamera,
          at: request.visualContext.at,
        }
      : null,
  };
}

/** Coerce whatever the backend returns into a well-formed AIResponse. */
function normalize(raw) {
  return {
    message: String(raw.message || "").trim(),
    instruction: raw.instruction ?? null,
    nextStep: raw.nextStep ?? null,
    scenario: raw.scenario ?? null,
    urgency: raw.urgency || "moderate",
    // BCP-47 tag of `message`. Drives which voice reads it aloud and which language the
    // microphone transcribes next, so it has to survive normalisation.
    language: typeof raw.language === "string" && raw.language ? raw.language : "en",
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    knownFacts: raw.knownFacts && typeof raw.knownFacts === "object" ? raw.knownFacts : {},
    source: /** @type {"backend"} */ ("backend"),
    audioUrl: raw.audioUrl ?? null,
  };
}

export function createAIService() {
  let lastBackendError = "";

  /**
   * Every turn goes to the model. No cooldown and no muting: one slow turn must not
   * decide the rest of the session, so the next message tries again regardless.
   *
   * @param {AIRequest} request
   * @returns {Promise<AIResponse>}
   * @throws {AssistantUnavailableError}
   */
  async function sendMessage(request) {
    let res;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      res = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeRequest(request)),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      lastBackendError =
        err && err.name === "AbortError"
          ? `The assistant did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`
          : `Could not reach the assistant at ${AI_ENDPOINT}.`;
      throw new AssistantUnavailableError(lastBackendError);
    }

    if (!res.ok) {
      // Name the actual failure. "404" here almost always means the page is being served
      // by a plain static file server with no backend behind it, which is worth saying
      // out loud rather than leaving someone to guess.
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch {
        /* error body was not JSON — the status alone will have to do */
      }
      lastBackendError =
        res.status === 404
          ? `${AI_ENDPOINT} returned 404 — no assistant backend is running on this host.`
          : `The assistant failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}.`;
      throw new AssistantUnavailableError(lastBackendError);
    }

    const raw = await res.json().catch(() => null);
    if (!raw || !raw.message) {
      lastBackendError = "The assistant returned an empty answer.";
      throw new AssistantUnavailableError(lastBackendError);
    }

    lastBackendError = "";
    return normalize(raw);
  }

  /**
   * Ask the backend whether it can actually answer, before the user needs it to. Called
   * as the session opens so a misconfigured host is visible immediately instead of at
   * the worst possible moment.
   *
   * @returns {Promise<{ok: boolean, reason?: string, model?: string}>}
   */
  async function checkHealth() {
    let res;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      res = await fetch(HEALTH_ENDPOINT, { signal: controller.signal });
      clearTimeout(timer);
    } catch {
      return { ok: false, reason: `Could not reach ${HEALTH_ENDPOINT}.` };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 404
            ? `${HEALTH_ENDPOINT} returned 404 — no assistant backend is running on this host.`
            : `${HEALTH_ENDPOINT} returned HTTP ${res.status}.`,
      };
    }

    const body = await res.json().catch(() => null);
    if (!body || !body.ok) return { ok: false, reason: "The backend reported itself unhealthy." };
    if (!body.hasApiKey) {
      return { ok: false, reason: "The backend is running but has no FEATHERLESS_API_KEY set." };
    }
    return { ok: true, model: body.model };
  }

  return {
    sendMessage,
    checkHealth,
    /** The opening line. Local by design: a round trip here would delay the first word. */
    greeting: () => ({
      message: OPENING_LINE,
      instruction: "Tell me what happened",
      nextStep: null,
      scenario: null,
      urgency: "moderate",
      actions: [],
      knownFacts: {},
      language: "en",
      source: /** @type {"backend"} */ ("backend"),
      audioUrl: null,
    }),
    getLastBackendError: () => lastBackendError,
    endpoint: () => AI_ENDPOINT,
  };
}

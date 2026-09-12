/**
 * AI service — the single boundary between the UI and any model.
 *
 * Architecture (deliberate): Frontend → OUR backend → AI provider.
 * The frontend never calls a vendor API and never holds a key. `AI_ENDPOINT` points at
 * our own backend, which the Backend Lead implements per DEVELOPMENT.md §2.
 *
 * Until that endpoint exists, every call transparently falls back to the mock provider,
 * so the whole experience is demoable today and becomes real with zero UI changes.
 *
 * @typedef {import("../types/ai.js").AIRequest} AIRequest
 * @typedef {import("../types/ai.js").AIResponse} AIResponse
 */

import { mockAIProvider, greeting as mockGreeting } from "../mock/mockAI.js";

/** Overridable from the page: `window.AIDLIVE_CONFIG = { aiEndpoint: "/api/assistant" }`. */
const CONFIG = (typeof window !== "undefined" && window.AIDLIVE_CONFIG) || {};
const AI_ENDPOINT = CONFIG.aiEndpoint || "/api/assistant";
// An LLM round-trip is slower than a plain API call. The backend gives up at 25s,
// so allow a little more here and let the mock cover anything past that.
const REQUEST_TIMEOUT_MS = 30000;
/** After a backend failure, wait this long before trying it again. */
const BACKEND_RETRY_AFTER_MS = 20000;

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
  /**
   * A failing backend is muted temporarily, not permanently: one timeout mid-emergency
   * must not drop the rest of the session into scripted replies. After the cooldown the
   * next turn tries the real assistant again.
   */
  let mutedUntil = 0;
  let lastSource = "mock";
  let lastBackendError = "";

  const backendAvailable = () => Date.now() >= mutedUntil;

  /**
   * @param {AIRequest} request
   * @returns {Promise<AIResponse>}
   */
  async function sendMessage(request) {
    if (backendAvailable()) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const res = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serializeRequest(request)),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`Backend returned ${res.status}`);

        const raw = await res.json();
        if (!raw || !raw.message) throw new Error("Backend response had no message");

        lastSource = "backend";
        lastBackendError = "";
        return normalize(raw);
      } catch (err) {
        // Expected while no backend is running — fall through to the mock, and back off
        // briefly rather than hammering it on every turn.
        mutedUntil = Date.now() + BACKEND_RETRY_AFTER_MS;
        lastBackendError = (err && err.message) || "Backend unreachable";
      }
    }

    lastSource = "mock";
    return mockAIProvider.sendMessage(request);
  }

  return {
    sendMessage,
    /** Opening line, before the user has said anything. */
    greeting: () => mockGreeting(),
    getLastSource: () => lastSource,
    getLastBackendError: () => lastBackendError,
    isBackendAvailable: backendAvailable,
    endpoint: () => AI_ENDPOINT,
    /** Let the user retry the backend after it was marked unavailable. */
    resetBackend() {
      mutedUntil = 0;
      lastBackendError = "";
    },
  };
}

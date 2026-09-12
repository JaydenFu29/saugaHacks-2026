/**
 * Visual context.
 *
 * Deliberately NOT a continuous upload of camera footage. The camera is a source of
 * *observable context*, sampled only when the assistant would benefit — a single
 * downscaled still, on demand.
 *
 * The frame is POSTed to our own backend (`/api/vision`), which runs it through a
 * vision-capable model and returns a sentence of observation. The guidance model is
 * text-only, so this description — not the image — is what reaches it.
 *
 * Framing note: this is "what is visible", never a diagnosis.
 *
 * IMPORTANT: when vision is unavailable this service reports that plainly. It must never
 * invent an observation — fabricated visual detail would flow straight into safety
 * guidance and could describe an emergency that isn't in front of the user.
 *
 * @typedef {import("../types/emergency.js").VisualContext} VisualContext
 */

const CONFIG = (typeof window !== "undefined" && window.AIDLIVE_CONFIG) || {};
const VISION_ENDPOINT = CONFIG.visionEndpoint || "/api/vision";

/**
 * Long enough for the backend to walk its vision fallback chain (budgeted at 18s there)
 * and still answer, rather than the browser giving up on a request that was about to
 * succeed.
 */
const REQUEST_TIMEOUT_MS = 25000;
/** After a failure, back off briefly rather than retrying on every single turn. */
const RETRY_AFTER_MS = 15000;

export function createVisionService(cameraService) {
  let mutedUntil = 0;
  let lastError = "";
  let lastObservation = "";

  const backendAvailable = () => Date.now() >= mutedUntil;

  /**
   * @returns {Promise<VisualContext>}
   */
  async function getVisualContext() {
    const frame = cameraService.getCurrentFrame();

    // No camera / no frame — the assistant must still work, just without visual context.
    if (!frame) {
      return {
        observedContext: "No camera view available.",
        fromCamera: false,
        at: Date.now(),
      };
    }

    if (!backendAvailable()) {
      return {
        observedContext: "Camera is on, but the view could not be analyzed just now.",
        fromCamera: false,
        at: Date.now(),
        frameDataUrl: frame.dataUrl,
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(VISION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameDataUrl: frame.dataUrl }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`Vision endpoint returned ${res.status}`);

      const raw = await res.json();
      if (!raw || !raw.observedContext) throw new Error("Vision response had no observedContext");

      lastError = "";
      lastObservation = String(raw.observedContext);

      return {
        observedContext: lastObservation,
        fromCamera: true,
        at: Date.now(),
        frameDataUrl: frame.dataUrl,
      };
    } catch (err) {
      mutedUntil = Date.now() + RETRY_AFTER_MS;
      lastError = (err && err.message) || "Vision unavailable";

      // Say what is true — the camera is running, the description isn't available.
      // Never substitute an invented scene here.
      return {
        observedContext: "Camera is on, but the view could not be analyzed just now.",
        fromCamera: false,
        at: Date.now(),
        frameDataUrl: frame.dataUrl,
      };
    }
  }

  return {
    getVisualContext,
    isBackendAvailable: backendAvailable,
    getLastError: () => lastError,
    getLastObservation: () => lastObservation,
    endpoint: () => VISION_ENDPOINT,
    /** Let the user retry immediately after a failure. */
    resetBackend() {
      mutedUntil = 0;
      lastError = "";
    },
  };
}

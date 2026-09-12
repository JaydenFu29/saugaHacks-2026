/**
 * Visual context.
 *
 * Deliberately NOT a continuous upload of camera footage. The camera is a source of
 * *observable context*, sampled only when the assistant would benefit — a single
 * downscaled still, on demand.
 *
 * Today the description is mocked. When the backend vision endpoint exists, the captured
 * frame is posted there and the real description comes back; the interface the rest of the
 * app depends on (`getVisualContext()`) does not change.
 *
 * Framing note: this is "what is visible", never a diagnosis.
 *
 * @typedef {import("../types/emergency.js").VisualContext} VisualContext
 */

const CONFIG = (typeof window !== "undefined" && window.AIDLIVE_CONFIG) || {};
const VISION_ENDPOINT = CONFIG.visionEndpoint || "/api/vision";

/**
 * Mock descriptions, keyed loosely to the demo scenario. Phrased as observation, and
 * cycled so repeated captures don't return an identical string.
 */
const MOCK_OBSERVATIONS = [
  "A person appears to be lying on the ground next to a bicycle. They are not visibly moving.",
  "The person on the ground is still in roughly the same position. A bicycle is on its side nearby.",
  "The area around the person looks clear of traffic. No other people are visible in frame.",
];

export function createVisionService(cameraService) {
  let mockIndex = 0;
  let backendAvailable = true;

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

    if (backendAvailable) {
      try {
        const res = await fetch(VISION_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frameDataUrl: frame.dataUrl }),
        });
        if (!res.ok) throw new Error(`Vision endpoint returned ${res.status}`);
        const raw = await res.json();
        if (raw && raw.observedContext) {
          return {
            observedContext: String(raw.observedContext),
            fromCamera: true,
            at: Date.now(),
            frameDataUrl: frame.dataUrl,
          };
        }
        throw new Error("Vision response had no observedContext");
      } catch {
        backendAvailable = false; // expected until the endpoint exists
      }
    }

    const observedContext = MOCK_OBSERVATIONS[mockIndex % MOCK_OBSERVATIONS.length];
    mockIndex += 1;

    return {
      observedContext: `${observedContext} (mock description — vision model not connected)`,
      fromCamera: true,
      at: Date.now(),
      frameDataUrl: frame.dataUrl,
    };
  }

  return {
    getVisualContext,
    isBackendAvailable: () => backendAvailable,
    endpoint: () => VISION_ENDPOINT,
  };
}

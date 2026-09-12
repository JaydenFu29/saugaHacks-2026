/**
 * Camera panel controller.
 *
 * Renders camera state and wires the controls. Zoom buttons are enabled strictly from the
 * service's real capability read — never optimistically.
 */

const FALLBACK_COPY = {
  denied: {
    title: "Camera unavailable",
    text: "Camera permission was denied. Allow it in your browser's site settings, then try again. The assistant still works without it.",
  },
  unavailable: {
    title: "Camera unavailable",
    text: "No camera was found on this device. The assistant still works without it.",
  },
  "in-use": {
    title: "Camera unavailable",
    text: "The camera is being used by another app. Close it and try again.",
  },
  unsupported: {
    title: "Camera unavailable",
    text: "This browser does not support camera access. The assistant still works without it.",
  },
  off: {
    title: "Camera off",
    text: "The camera is turned off. Turn it back on when you want the assistant to see the scene.",
  },
  idle: {
    title: "Camera not started",
    text: "",
  },
  requesting: {
    title: "Starting camera…",
    text: "Waiting for camera permission.",
  },
};

/**
 * @param {ReturnType<import("../services/cameraService.js").createCameraService>} cameraService
 */
export function createCameraView(cameraService) {
  const video = /** @type {HTMLVideoElement} */ (document.getElementById("video"));
  const fallback = document.getElementById("camera-fallback");
  const fallbackTitle = document.getElementById("camera-fallback-title");
  const fallbackText = document.getElementById("camera-fallback-text");
  const btnRetry = document.getElementById("btn-camera-retry");
  const btnFlip = /** @type {HTMLButtonElement} */ (document.getElementById("btn-flip"));
  const btnZoomIn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-zoom-in"));
  const btnZoomOut = /** @type {HTMLButtonElement} */ (document.getElementById("btn-zoom-out"));
  const btnToggle = /** @type {HTMLButtonElement} */ (document.getElementById("btn-camera-toggle"));
  const zoomNote = document.getElementById("camera-zoomnote");

  cameraService.attach(video);

  function render(state) {
    const active = state.status === "active";

    video.hidden = !active;
    fallback.hidden = active;

    if (!active) {
      const copy = FALLBACK_COPY[state.status] || FALLBACK_COPY.unavailable;
      fallbackTitle.textContent = copy.title;
      fallbackText.textContent = state.lastError || copy.text;
      // Retrying makes no sense when the browser has no support at all.
      btnRetry.hidden = state.status === "unsupported";
      btnRetry.textContent = state.status === "off" ? "Turn camera on" : "Try Again";
    }

    // Flip needs an active camera; on desktop with one webcam it's pointless.
    btnFlip.disabled = !active || !state.hasMultipleCameras;
    btnFlip.title = !active
      ? "Camera is not running"
      : state.hasMultipleCameras
        ? `Switch to ${state.facingMode === "environment" ? "front" : "rear"} camera`
        : "Only one camera on this device";

    // Real capability only — disabled, not faked, when unsupported.
    const canZoom = active && state.zoom.supported;
    btnZoomIn.disabled = !canZoom || state.zoom.value >= state.zoom.max;
    btnZoomOut.disabled = !canZoom || state.zoom.value <= state.zoom.min;
    if (!canZoom) {
      btnZoomIn.title = btnZoomOut.title = active
        ? "This camera does not expose zoom control"
        : "Camera is not running";
    } else {
      btnZoomIn.title = "Zoom in";
      btnZoomOut.title = "Zoom out";
    }
    zoomNote.hidden = !active || state.zoom.supported;

    btnToggle.textContent = active ? "Camera off" : "Camera on";
    btnToggle.dataset.on = String(active);
    btnToggle.disabled = state.status === "unsupported";
  }

  const unsubscribe = cameraService.subscribe(render);

  btnFlip.addEventListener("click", () => cameraService.flip());
  btnZoomIn.addEventListener("click", () => cameraService.zoomIn());
  btnZoomOut.addEventListener("click", () => cameraService.zoomOut());

  btnToggle.addEventListener("click", () => {
    const { active } = cameraService.getState();
    if (active) cameraService.stop();
    else cameraService.start();
  });

  btnRetry.addEventListener("click", () => cameraService.start());

  return {
    render,
    dispose() {
      unsubscribe();
    },
  };
}

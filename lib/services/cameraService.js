/**
 * Camera service.
 *
 * Owns the video MediaStream and nothing else — microphone permission is requested
 * separately (see voiceService) so that denying one never takes down the other.
 *
 * Zoom is driven by real MediaTrackCapabilities. If the device/browser doesn't expose
 * zoom, `zoom.supported` is false and the UI disables the control. Nothing here fakes
 * zoom with a CSS transform.
 *
 * @typedef {import("../types/emergency.js").DeviceStatus} DeviceStatus
 * @typedef {import("../types/emergency.js").VisualContext} VisualContext
 */

/** Maps a getUserMedia rejection onto our status vocabulary. */
function classifyError(err) {
  const name = err && err.name ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { status: /** @type {DeviceStatus} */ ("denied"), message: "Camera permission was denied." };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { status: /** @type {DeviceStatus} */ ("unavailable"), message: "No camera found on this device." };
    case "NotReadableError":
    case "TrackStartError":
      return { status: /** @type {DeviceStatus} */ ("in-use"), message: "The camera is already in use by another app." };
    case "OverconstrainedError":
      return { status: /** @type {DeviceStatus} */ ("unavailable"), message: "No camera matches the requested settings." };
    default:
      return {
        status: /** @type {DeviceStatus} */ ("unavailable"),
        message: err && err.message ? err.message : "The camera could not be started.",
      };
  }
}

export function createCameraService() {
  /** @type {MediaStream|null} */
  let stream = null;
  /** @type {MediaStreamTrack|null} */
  let track = null;
  /** @type {"user" | "environment"} */
  let facingMode = "environment"; // rear by default: the camera is meant to show the scene
  /** @type {DeviceStatus} */
  let status = "idle";
  let lastError = "";
  let hasMultipleCameras = false;

  let zoom = { supported: false, min: 1, max: 1, step: 0.1, value: 1 };

  /** @type {HTMLVideoElement|null} */
  let videoEl = null;
  /** @type {Array<(s: any) => void>} */
  const listeners = [];

  const snapshot = () => ({
    status,
    facingMode,
    lastError,
    hasMultipleCameras,
    zoom: { ...zoom },
    active: status === "active",
  });

  const emit = () => listeners.forEach((fn) => fn(snapshot()));

  function isSupported() {
    return Boolean(
      typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
    );
  }

  async function detectMultipleCameras() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      hasMultipleCameras = devices.filter((d) => d.kind === "videoinput").length > 1;
    } catch {
      hasMultipleCameras = false;
    }
  }

  /** Read real zoom capability off the active track. */
  function readZoomCapability() {
    zoom = { supported: false, min: 1, max: 1, step: 0.1, value: 1 };
    if (!track || typeof track.getCapabilities !== "function") return;
    try {
      const caps = track.getCapabilities();
      if (caps && caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max > caps.zoom.min) {
        const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
        zoom = {
          supported: true,
          min: caps.zoom.min,
          max: caps.zoom.max,
          step: caps.zoom.step || 0.1,
          value: typeof settings.zoom === "number" ? settings.zoom : caps.zoom.min,
        };
      }
    } catch {
      /* capability reads are best-effort; leave zoom unsupported */
    }
  }

  function stopTracks() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    track = null;
  }

  /**
   * @param {{ facingMode?: "user"|"environment" }} [opts]
   * @returns {Promise<{ok: boolean, status: DeviceStatus, message?: string}>}
   */
  async function start(opts = {}) {
    if (!isSupported()) {
      status = "unsupported";
      lastError = "This browser does not support camera access.";
      emit();
      return { ok: false, status, message: lastError };
    }

    if (opts.facingMode) facingMode = opts.facingMode;

    status = "requesting";
    lastError = "";
    emit();

    stopTracks();

    // `facingMode` as a plain (non-exact) constraint so desktops with one webcam still
    // resolve instead of throwing OverconstrainedError.
    const constraints = {
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      track = stream.getVideoTracks()[0] || null;
      status = "active";
      lastError = "";
      readZoomCapability();
      await detectMultipleCameras();
      if (videoEl) {
        videoEl.srcObject = stream;
        try {
          await videoEl.play();
        } catch {
          /* autoplay can reject before user gesture; the stream is still attached */
        }
      }
      emit();
      return { ok: true, status };
    } catch (err) {
      const { status: s, message } = classifyError(err);
      status = s;
      lastError = message;
      stopTracks();
      emit();
      return { ok: false, status, message };
    }
  }

  function stop() {
    stopTracks();
    if (videoEl) videoEl.srcObject = null;
    status = "off";
    zoom = { supported: false, min: 1, max: 1, step: 0.1, value: 1 };
    emit();
  }

  /** Toggle front/rear. Restores the previous camera if the flip fails. */
  async function flip() {
    const previous = facingMode;
    const target = facingMode === "environment" ? "user" : "environment";
    const result = await start({ facingMode: target });
    if (!result.ok) await start({ facingMode: previous });
    return result;
  }

  /** @param {number} value */
  async function setZoom(value) {
    if (!zoom.supported || !track) return false;
    const clamped = Math.min(zoom.max, Math.max(zoom.min, value));
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped }] });
      zoom.value = clamped;
      emit();
      return true;
    } catch {
      return false;
    }
  }

  const zoomBy = (delta) => setZoom(zoom.value + delta * (zoom.step || 0.1) * 5);

  /**
   * Grab a still frame as the basis for visual context.
   * Returns null when there's nothing to capture — callers must handle that.
   *
   * @returns {{dataUrl: string, width: number, height: number, capturedAt: number}|null}
   */
  function getCurrentFrame() {
    if (!videoEl || status !== "active") return null;
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return null;
    try {
      const canvas = document.createElement("canvas");
      // Downscale: a frame headed for a vision model doesn't need to be 1280px.
      const scale = Math.min(1, 640 / w);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      return {
        dataUrl: canvas.toDataURL("image/jpeg", 0.7),
        width: canvas.width,
        height: canvas.height,
        capturedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  return {
    /**
     * @param {HTMLVideoElement} el
     * Attach may happen AFTER start() — in React the <video> only exists once the
     * emergency view has rendered, by which point the stream is already open. So this
     * must also kick off playback, otherwise the element holds a stream that never
     * plays and videoWidth stays 0 (which silently breaks frame capture too).
     */
    attach(el) {
      videoEl = el;
      if (!stream) return;
      el.srcObject = stream;
      const go = el.play();
      if (go && typeof go.catch === "function") {
        go.catch(() => {
          /* autoplay can reject before a user gesture; the stream is still attached */
        });
      }
    },
    start,
    stop,
    flip,
    setZoom,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    getCurrentFrame,
    isSupported,
    getState: snapshot,
    /** @param {(s:any)=>void} fn */
    subscribe(fn) {
      listeners.push(fn);
      fn(snapshot());
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}

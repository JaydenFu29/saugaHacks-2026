/**
 * Voice input (speech-to-text).
 *
 * Microphone permission is requested here, separately from the camera, so one denial
 * never takes down the other.
 *
 * Web Speech API support is uneven (Chrome/Edge/Safari yes, Firefox effectively no). When
 * it's missing we report `supported: false` and the UI falls back to the text input — the
 * app must never depend on speech recognition being present.
 *
 * @typedef {import("../types/emergency.js").DeviceStatus} DeviceStatus
 */

function getRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function createVoiceService() {
  const Ctor = getRecognitionCtor();

  /** @type {DeviceStatus} */
  let status = "idle";
  let listening = false;
  let lastError = "";
  let interim = "";
  /** @type {MediaStream|null} */
  let micStream = null;
  /** @type {any} */
  let recognition = null;

  const handlers = {
    /** @type {(text: string) => void} */
    onFinal: () => {},
    /** @type {(text: string) => void} */
    onInterim: () => {},
    /** @type {(s: any) => void} */
    onState: () => {},
  };

  const snapshot = () => ({
    status,
    listening,
    lastError,
    interim,
    // Recognition needs BOTH the API and a granted mic.
    recognitionSupported: Boolean(Ctor),
    micGranted: status === "active",
  });

  const emit = () => handlers.onState(snapshot());

  function micSupported() {
    return Boolean(
      typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
    );
  }

  /**
   * Ask for the microphone on its own. We immediately release the stream — recognition
   * opens its own — but this gives an explicit, separately-recoverable permission state.
   */
  async function requestMicrophone() {
    if (!micSupported()) {
      status = "unsupported";
      lastError = "This browser does not support microphone access.";
      emit();
      return { ok: false, status, message: lastError };
    }

    status = "requesting";
    lastError = "";
    emit();

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // Keep the permission, drop the capture.
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
      status = "active";
      emit();
      return { ok: true, status };
    } catch (err) {
      const name = err && err.name ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        status = "denied";
        lastError = "Microphone permission was denied.";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        status = "unavailable";
        lastError = "No microphone found on this device.";
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        status = "in-use";
        lastError = "The microphone is already in use by another app.";
      } else {
        status = "unavailable";
        lastError = (err && err.message) || "The microphone could not be started.";
      }
      emit();
      return { ok: false, status, message: lastError };
    }
  }

  function buildRecognition() {
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "en-US";
    // Keep the mic open across pauses: the user taps to stop, then presses Send.
    // With continuous=false the engine ends the session at the first silence, which
    // would cut a panicking user off mid-sentence.
    r.continuous = true;
    r.interimResults = true;   // so the user sees words appear as they speak
    r.maxAlternatives = 1;

    r.onstart = () => {
      listening = true;
      interim = "";
      lastError = "";
      emit();
    };

    r.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (interimText) {
        interim = interimText;
        handlers.onInterim(interimText);
        emit();
      }
      if (finalText.trim()) {
        interim = "";
        emit();
        handlers.onFinal(finalText.trim());
      }
    };

    r.onerror = (event) => {
      const code = event && event.error ? event.error : "unknown";
      if (code === "not-allowed" || code === "service-not-allowed") {
        status = "denied";
        lastError = "Microphone permission was denied.";
      } else if (code === "no-speech") {
        lastError = "I didn't catch that — try again, or type instead.";
      } else if (code === "network") {
        lastError = "Speech recognition needs a network connection. Type instead.";
      } else if (code !== "aborted") {
        lastError = `Speech recognition error: ${code}. You can type instead.`;
      }
      listening = false;
      interim = "";
      emit();
    };

    r.onend = () => {
      listening = false;
      interim = "";
      emit();
    };

    return r;
  }

  async function startListening() {
    if (!Ctor) {
      lastError = "Speech recognition isn't available in this browser — type instead.";
      emit();
      return false;
    }
    if (status !== "active") {
      const res = await requestMicrophone();
      if (!res.ok) return false;
    }
    if (listening) return true;

    recognition = buildRecognition();
    if (!recognition) return false;

    try {
      recognition.start();
      return true;
    } catch (err) {
      // start() throws if called while already running; treat as already listening.
      lastError = (err && err.message) || "Could not start listening.";
      emit();
      return false;
    }
  }

  function stopListening() {
    if (recognition && listening) {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
    listening = false;
    interim = "";
    emit();
  }

  function dispose() {
    stopListening();
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    recognition = null;
  }

  return {
    requestMicrophone,
    startListening,
    stopListening,
    dispose,
    isRecognitionSupported: () => Boolean(Ctor),
    getState: snapshot,
    /**
     * @param {{
     *   onFinal?: (text: string) => void,
     *   onInterim?: (text: string) => void,
     *   onState?: (state: any) => void
     * }} h
     */
    on(h) {
      if (h.onFinal) handlers.onFinal = h.onFinal;
      if (h.onInterim) handlers.onInterim = h.onInterim;
      if (h.onState) handlers.onState = h.onState;
      emit();
    },
  };
}

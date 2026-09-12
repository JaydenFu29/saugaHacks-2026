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

/**
 * Short language tag → full recognition locale.
 *
 * The assistant reports plain tags ("pa", "ta", "fa"), but speech recognition takes
 * `lang` literally: it does NOT fall back from "pa" to "pa-Guru-IN" the way voice
 * selection falls back from "zh-CN" to "zh". A bare tag silently transcribes as the
 * engine default — English — which is exactly the bug this map exists to prevent.
 */
const RECOGNITION_LOCALE = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  pt: "pt-BR",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  hi: "hi-IN",
  ar: "ar-SA",
  ru: "ru-RU",
  ur: "ur-PK",
  tl: "fil-PH",   // recognition uses Filipino, not the "tl" ISO code
  fil: "fil-PH",
  pa: "pa-Guru-IN", // Punjabi needs the script subtag or it is ignored outright
  ta: "ta-IN",
  gu: "gu-IN",
  bn: "bn-BD",
  vi: "vi-VN",
  pl: "pl-PL",
  fa: "fa-IR",
  he: "he-IL",
  th: "th-TH",
  el: "el-GR",
};

/**
 * @param {string} tag e.g. "pa", "zh-CN", "en-GB"
 * @returns {string} a locale the recognition engine actually understands
 */
export function toRecognitionLocale(tag) {
  const raw = String(tag || "").trim();
  if (!raw) return "en-US";
  // Already a full locale (has a region/script subtag) — trust it.
  if (raw.includes("-") && RECOGNITION_LOCALE[raw.toLowerCase()] === undefined) {
    const base = raw.split("-")[0].toLowerCase();
    // "zh-CN"/"en-GB" are fine as-is; only map when we have nothing better.
    return raw.length > 2 ? raw : RECOGNITION_LOCALE[base] || "en-US";
  }
  const base = raw.split("-")[0].toLowerCase();
  return RECOGNITION_LOCALE[base] || raw;
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
  /**
   * Language the recognizer transcribes as. Seeded from the browser locale — a user whose
   * machine is set to Chinese is far more likely to speak Chinese than English — and then
   * updated by setLanguage() once the assistant establishes what language is in use.
   */
  let recognitionLang = toRecognitionLocale(
    (typeof navigator !== "undefined" && (navigator.language || navigator.userLanguage)) ||
      "en-US"
  );
  /**
   * When the user picks a language explicitly it wins permanently: the assistant must not
   * be able to drag the microphone back to another language just because it replied in
   * one. Null means "auto — follow the conversation".
   */
  let pinnedLang = null;

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
    // Web Speech recognition cannot auto-detect — it transcribes as whatever `lang` says,
    // so a hardcoded "en-US" turns Chinese speech into English-sounding nonsense. Start
    // from the browser's own locale, then follow the conversation (see setLanguage).
    r.lang = recognitionLang;
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
     * Follow the conversation's language. Ignored once the user has pinned one.
     * Applies to the next startListening() — Chrome ignores a `lang` change on a live
     * recognition object, and startListening builds a fresh one each time anyway.
     * @param {string} lang BCP-47 tag from the assistant
     */
    setLanguage(lang) {
      if (lang && !pinnedLang) recognitionLang = toRecognitionLocale(lang);
      return recognitionLang;
    },
    /**
     * Explicit user choice. Pass null/"" to go back to auto-follow.
     * @param {string|null} lang
     */
    pinLanguage(lang) {
      pinnedLang = lang || null;
      if (pinnedLang) recognitionLang = toRecognitionLocale(pinnedLang);
      return recognitionLang;
    },
    getPinnedLanguage: () => pinnedLang,
    getLanguage: () => recognitionLang,
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

/**
 * Text-to-speech.
 *
 * The app is NOT built around `window.speechSynthesis` — that's just the provider we can
 * demo with today. A real AI voice API drops in by implementing the same three methods
 * (`speak` / `cancel` / `name`) and registering it as the active provider; see
 * `createRemoteSpeechProvider` below for the shape.
 */

/**
 * @typedef {Object} SpeechProvider
 * @property {string} name
 * @property {(text: string, cb: {onStart: () => void, onEnd: () => void, onError: (m: string) => void}, lang?: string) => void} speak
 * @property {() => void} cancel
 */

/**
 * Browser speech synthesis. Demo provider.
 * @returns {SpeechProvider}
 */
export function createBrowserSpeechProvider() {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

  /**
   * Pick the best installed voice for `lang` (a BCP-47 tag from the assistant).
   *
   * Matching goes exact ("zh-CN") → same base language ("zh-*") → English → whatever
   * exists. The base-language step is what matters in practice: a machine with
   * "zh-TW" installed should still read Chinese rather than falling back to English,
   * which would render the text as unintelligible noise.
   *
   * @param {string} lang
   */
  function pickVoice(lang) {
    if (!synth || typeof synth.getVoices !== "function") return null;
    const voices = synth.getVoices() || [];
    if (!voices.length) return null;

    const tag = String(lang || "en").toLowerCase();
    const base = tag.split("-")[0];
    const norm = (v) => String(v.lang || "").toLowerCase().replace("_", "-");

    const exact = voices.filter((v) => norm(v) === tag);
    const sameBase = voices.filter((v) => norm(v).split("-")[0] === base);

    // Prefer a higher-quality voice within whichever tier matched.
    const nicest = (list) =>
      list.find((v) => /natural|neural|premium|enhanced|google/i.test(v.name)) || list[0];

    if (exact.length) return nicest(exact);
    if (sameBase.length) return nicest(sameBase);

    const english = voices.filter((v) => norm(v).split("-")[0] === "en");
    if (english.length) return nicest(english);
    return voices[0];
  }

  return {
    name: "browser-speech-synthesis",

    speak(text, cb, lang) {
      if (!synth || typeof window.SpeechSynthesisUtterance !== "function") {
        cb.onError("Speech synthesis is not available in this browser.");
        return;
      }

      try {
        synth.cancel(); // never queue up: the newest instruction is the only relevant one
        const u = new window.SpeechSynthesisUtterance(text);
        const voice = pickVoice(lang);
        if (voice) u.voice = voice;
        // Set the requested language even when no matching voice is installed — some
        // engines can still synthesise from the tag alone.
        u.lang = (voice && voice.lang) || lang || "en-US";
        u.rate = 0.95; // marginally slower — this is being followed under stress
        u.pitch = 1;

        let started = false;
        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;
          cb.onEnd();
        };

        u.onstart = () => {
          started = true;
          cb.onStart();
        };
        u.onend = finish;
        u.onerror = () => {
          // "interrupted"/"canceled" fire when we cancel deliberately — not real errors.
          if (!finished) {
            finished = true;
            cb.onEnd();
          }
        };

        synth.speak(u);

        // Watchdog: some platforms (headless, no installed voices, backgrounded tabs)
        // never fire onstart/onend. Without this the UI would sit in SPEAKING forever.
        setTimeout(() => {
          if (!started && !finished) {
            finished = true;
            cb.onStart();
            cb.onEnd();
          }
        }, 1200);

        const estimatedMs = Math.min(30000, 1200 + (text.length / 12) * 1000);
        setTimeout(() => {
          if (!finished) finish();
        }, estimatedMs);
      } catch (err) {
        cb.onError((err && err.message) || "Speech synthesis failed.");
      }
    },

    cancel() {
      try {
        if (synth) synth.cancel();
      } catch {
        /* nothing to cancel */
      }
    },
  };
}

/**
 * Provider stub for a real AI voice API, routed through OUR backend so no key is ever in
 * frontend code. Not wired up — it's here so swapping providers is a one-line change in
 * `createSpeechService` rather than a refactor.
 *
 * @param {string} endpoint
 * @returns {SpeechProvider}
 */
export function createRemoteSpeechProvider(endpoint) {
  /** @type {HTMLAudioElement|null} */
  let audio = null;

  return {
    name: "remote-ai-voice",

    async speak(text, cb, lang) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang: lang || "en" }),
        });
        if (!res.ok) throw new Error(`Speech endpoint returned ${res.status}`);
        const blob = await res.blob();
        audio = new Audio(URL.createObjectURL(blob));
        audio.onplay = cb.onStart;
        audio.onended = cb.onEnd;
        audio.onerror = () => cb.onError("Generated audio failed to play.");
        await audio.play();
      } catch (err) {
        cb.onError((err && err.message) || "Speech generation failed.");
      }
    },

    cancel() {
      if (audio) {
        audio.pause();
        audio = null;
      }
    },
  };
}

export function createSpeechService(provider = createBrowserSpeechProvider()) {
  let muted = false;
  let speaking = false;
  let lastText = "";
  let lastLang = "en";
  let lastError = "";

  const handlers = {
    /** @type {(speaking: boolean) => void} */
    onSpeakingChange: () => {},
  };

  const setSpeaking = (v) => {
    if (speaking === v) return;
    speaking = v;
    handlers.onSpeakingChange(v);
  };

  /**
   * @param {string} text
   * @param {string} [lang] BCP-47 tag of `text`, from the assistant's `language` field
   * @returns {boolean} whether audio was actually started
   */
  function speak(text, lang) {
    lastText = text;
    if (lang) lastLang = lang;
    lastError = "";
    if (muted || !text) return false;

    provider.speak(
      text,
      {
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
        onError: (m) => {
          lastError = m;
          setSpeaking(false);
        },
      },
      lastLang
    );
    return true;
  }

  function stop() {
    provider.cancel();
    setSpeaking(false);
  }

  return {
    speak,
    stop,
    /** Re-speak the most recent assistant message, in the language it was written in. */
    replayLast() {
      if (!lastText || muted) return false;
      return speak(lastText, lastLang);
    },
    /** BCP-47 tag of the last thing spoken — the recognizer follows this. */
    lastLanguage: () => lastLang,
    /** @param {boolean} v */
    setMuted(v) {
      muted = v;
      if (v) stop();
      return muted;
    },
    toggleMuted() {
      return this.setMuted(!muted);
    },
    isMuted: () => muted,
    isSpeaking: () => speaking,
    hasLast: () => Boolean(lastText),
    getLastError: () => lastError,
    providerName: () => provider.name,
    /** @param {{onSpeakingChange?: (speaking: boolean) => void}} h */
    on(h) {
      if (h.onSpeakingChange) handlers.onSpeakingChange = h.onSpeakingChange;
    },
  };
}

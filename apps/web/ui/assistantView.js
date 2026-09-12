/**
 * Assistant panel controller.
 *
 * Renders the assistant state machine (idle / listening / processing / speaking), the
 * prominent current instruction, and the scrollable transcript. Every assistant reply is
 * transcribed here, so the experience works with audio muted or unavailable.
 */

const STATE_LABEL = {
  idle: "Idle",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
};

export function createAssistantView() {
  const stateEl = document.getElementById("assistant-state");
  const stateText = document.getElementById("assistant-state-text");
  const instruction = document.getElementById("instruction");
  const instructionText = document.getElementById("instruction-text");
  const conversation = document.getElementById("conversation");
  const interim = document.getElementById("interim");
  const sourceNote = document.getElementById("ai-source-note");

  const btnMute = /** @type {HTMLButtonElement} */ (document.getElementById("btn-mute"));
  const btnReplay = /** @type {HTMLButtonElement} */ (document.getElementById("btn-replay"));
  const btnStopAudio = /** @type {HTMLButtonElement} */ (document.getElementById("btn-stop-audio"));
  const btnMic = /** @type {HTMLButtonElement} */ (document.getElementById("btn-mic"));
  const micLabel = document.getElementById("mic-label");
  const textInput = /** @type {HTMLInputElement} */ (document.getElementById("text-input"));
  const btnSend = /** @type {HTMLButtonElement} */ (document.getElementById("btn-send"));

  /** Track rendered message ids so we append instead of rebuilding the list. */
  const rendered = new Set();

  /** @param {import("../types/emergency.js").EmergencySession} session */
  function renderSession(session) {
    // ── state pill ──
    const status = session.assistantStatus;
    stateEl.dataset.state = status;
    stateText.textContent = STATE_LABEL[status] || "Idle";

    // ── current instruction ──
    if (session.currentInstruction) {
      instruction.hidden = false;
      instructionText.textContent = session.currentInstruction;
    } else {
      instruction.hidden = true;
    }

    // ── transcript ──
    session.messages.forEach((m) => {
      if (rendered.has(m.id)) return;
      rendered.add(m.id);

      const el = document.createElement("div");
      el.className = `msg msg--${m.role}`;
      el.dataset.id = m.id;

      const body = document.createElement("span");
      body.textContent = m.text;
      el.appendChild(body);

      if (m.role === "assistant") {
        const meta = document.createElement("span");
        meta.className = "msg__meta";
        meta.textContent = "Assistant";
        el.appendChild(meta);
      }

      conversation.appendChild(el);
    });

    // Emphasise only the newest assistant turn.
    const assistantEls = conversation.querySelectorAll(".msg--assistant");
    assistantEls.forEach((el, i) => {
      el.classList.toggle("is-latest", i === assistantEls.length - 1);
    });

    conversation.scrollTop = conversation.scrollHeight;
  }

  return {
    renderSession,

    /** @param {string} text */
    setInterim(text) {
      if (text) {
        interim.hidden = false;
        interim.textContent = text;
      } else {
        interim.hidden = true;
        interim.textContent = "";
      }
    },

    /**
     * @param {{recognitionSupported: boolean, micGranted: boolean, listening: boolean, lastError: string}} voice
     */
    renderVoice(voice) {
      const usable = voice.recognitionSupported;
      btnMic.disabled = !usable;
      btnMic.setAttribute("aria-pressed", String(voice.listening));

      if (!voice.recognitionSupported) {
        micLabel.textContent = "Voice not supported — type below";
      } else if (voice.listening) {
        // Make it explicit that stopping does NOT send.
        micLabel.textContent = "Listening — tap to stop";
      } else if (!voice.micGranted) {
        micLabel.textContent = "Tap to allow mic & speak";
      } else {
        micLabel.textContent = "Tap to speak";
      }
    },

    /** @param {{muted: boolean, speaking: boolean, hasLast: boolean}} audio */
    renderAudio(audio) {
      btnMute.textContent = audio.muted ? "Unmute" : "Mute";
      btnMute.dataset.on = String(!audio.muted);
      btnMute.title = audio.muted ? "Unmute assistant audio" : "Mute assistant audio";

      // Replay is meaningless with nothing to replay, or while muted.
      btnReplay.disabled = !audio.hasLast || audio.muted;
      btnReplay.title = audio.muted
        ? "Unmute to replay"
        : audio.hasLast
          ? "Replay last response"
          : "Nothing to replay yet";

      btnStopAudio.hidden = !audio.speaking;
    },

    /** @param {boolean} busy */
    setBusy(busy) {
      btnSend.disabled = busy;
      textInput.disabled = busy;
    },

    /** @param {string} note */
    setSourceNote(note) {
      sourceNote.textContent = note;
    },

    clearInput() {
      textInput.value = "";
    },

    /** Append a finished speech transcript to whatever is already in the composer. */
    appendInput(text) {
      const addition = String(text || "").trim();
      if (!addition) return;
      const existing = textInput.value.trim();
      textInput.value = existing ? `${existing} ${addition}` : addition;
      // Keep the caret at the end so the user can carry on typing or hit Send.
      try {
        textInput.focus({ preventScroll: true });
        textInput.setSelectionRange(textInput.value.length, textInput.value.length);
      } catch {
        /* focus can fail if the element is hidden — harmless */
      }
    },

    getInput() {
      return textInput.value.trim();
    },

    focusInput() {
      try {
        textInput.focus({ preventScroll: true });
      } catch {
        textInput.focus();
      }
    },

    elements: { btnMute, btnReplay, btnStopAudio, btnMic, textInput, btnSend },
  };
}

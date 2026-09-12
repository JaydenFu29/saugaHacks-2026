/**
 * Emergency session state.
 *
 * A small observable store — one source of truth for the session, so the AI layer receives
 * accumulated structured context rather than just the latest message, and so every UI
 * panel reads the same state. Intentionally not a framework or a reducer library.
 *
 * @typedef {import("../types/emergency.js").EmergencySession} EmergencySession
 * @typedef {import("../types/emergency.js").ConversationMessage} ConversationMessage
 * @typedef {import("../types/emergency.js").AssistantStatus} AssistantStatus
 * @typedef {import("../types/emergency.js").DeviceStatus} DeviceStatus
 */

function newId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/** @returns {EmergencySession} */
function initialSession() {
  return {
    sessionId: newId("sess"),
    startTime: Date.now(),
    scenario: null,
    messages: [],
    currentInstruction: null,
    currentStep: null,
    knownFacts: {},
    actionsTaken: [],
    cameraStatus: "idle",
    microphoneStatus: "idle",
    assistantStatus: "idle",
    emergencyStatus: "inactive",
    urgency: "moderate",
    location: null, // reserved — GPS is explicitly out of scope for this feature
  };
}

export function createEmergencySession() {
  /** @type {EmergencySession} */
  let state = initialSession();

  /** @type {Array<(s: EmergencySession) => void>} */
  const listeners = [];

  const emit = () => listeners.forEach((fn) => fn(state));

  /** @param {Partial<EmergencySession>} patch */
  function update(patch) {
    state = { ...state, ...patch };
    emit();
    return state;
  }

  return {
    get: () => state,

    /** @param {(s: EmergencySession) => void} fn */
    subscribe(fn) {
      listeners.push(fn);
      fn(state);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    update,

    start() {
      return update({ emergencyStatus: "active", startTime: Date.now() });
    },

    end() {
      return update({ emergencyStatus: "ended", assistantStatus: "idle" });
    },

    reset() {
      state = initialSession();
      emit();
      return state;
    },

    /**
     * @param {"user"|"assistant"} role
     * @param {string} text
     * @returns {ConversationMessage}
     */
    addMessage(role, text) {
      /** @type {ConversationMessage} */
      const message = { id: newId("msg"), role, text, at: Date.now(), spoken: false };
      state = { ...state, messages: [...state.messages, message] };
      emit();
      return message;
    },

    /** @param {string} id */
    markSpoken(id) {
      state = {
        ...state,
        messages: state.messages.map((m) => (m.id === id ? { ...m, spoken: true } : m)),
      };
      emit();
    },

    /**
     * Fold an AI response into the session: facts merge (never overwritten wholesale, so
     * nothing already established gets forgotten), actions de-duplicate.
     *
     * @param {import("../types/ai.js").AIResponse} response
     */
    applyAIResponse(response) {
      return update({
        currentInstruction: response.instruction || state.currentInstruction,
        currentStep: response.nextStep || state.currentStep,
        scenario: response.scenario || state.scenario,
        urgency: response.urgency || state.urgency,
        knownFacts: { ...state.knownFacts, ...(response.knownFacts || {}) },
        actionsTaken: [...new Set([...state.actionsTaken, ...(response.actions || [])])],
      });
    },

    /** @param {AssistantStatus} assistantStatus */
    setAssistantStatus(assistantStatus) {
      return update({ assistantStatus });
    },

    /** @param {DeviceStatus} cameraStatus */
    setCameraStatus(cameraStatus) {
      return update({ cameraStatus });
    },

    /** @param {DeviceStatus} microphoneStatus */
    setMicrophoneStatus(microphoneStatus) {
      return update({ microphoneStatus });
    },

    /** Latest assistant message, for replay and for the prominent instruction panel. */
    lastAssistantMessage() {
      for (let i = state.messages.length - 1; i >= 0; i -= 1) {
        if (state.messages[i].role === "assistant") return state.messages[i];
      }
      return null;
    },
  };
}

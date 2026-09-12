/**
 * Emergency Assistant — entry point / page controller.
 *
 * Pipeline:
 *   user speaks or types
 *     → voiceService (STT) or text input
 *     → visionService samples one camera frame for observable context
 *     → aiService posts the FULL session to our backend — every answer is the model's
 *     → session state folds in the reply (facts merge, step advances)
 *     → reply is transcribed on screen AND spoken via speechService
 *
 * NOTE ON LANGUAGE: this is JS with JSDoc types rather than TypeScript because the repo
 * has no Node/tsc toolchain installed yet. The typedefs in types/ are `tsc --checkJs`
 * clean by construction; porting to .ts is a rename plus inlining those typedefs.
 */

import { createCameraService } from "./services/cameraService.js";
import { createVoiceService } from "./services/voiceService.js";
import { createSpeechService } from "./services/speechService.js";
import { createAIService, AssistantUnavailableError } from "./services/aiService.js";
import { createVisionService } from "./services/visionService.js";
import { createEmergencySession } from "./state/emergencySession.js";
import { createCameraView } from "./ui/cameraView.js";
import { createAssistantView } from "./ui/assistantView.js";
import { createStatusBar } from "./ui/statusBar.js";

/* ── services + state ─────────────────────────────────────────────────── */
const camera = createCameraService();
const voice = createVoiceService();
const speech = createSpeechService();
const ai = createAIService();
const vision = createVisionService(camera);
const session = createEmergencySession();

/* ── views ────────────────────────────────────────────────────────────── */
const cameraView = createCameraView(camera);
const assistantView = createAssistantView();
const statusBar = createStatusBar();

/* ── elements ─────────────────────────────────────────────────────────── */
const gate = document.getElementById("gate");
const emergencyEl = document.getElementById("emergency");
const confirmEl = document.getElementById("confirm");
const endedEl = document.getElementById("ended");
const endedSummary = document.getElementById("ended-summary");

let busy = false;

/* ── backend failures, shown rather than papered over ───────────────────────
   There is no scripted fallback any more. When the model cannot answer, the user is
   told what failed and offered the same message again, because a canned reply that
   reads like guidance is worse than no reply — they cannot tell it apart, and they
   will act on it. */
const alertEl = document.getElementById("alert");
const alertText = document.getElementById("alert-text");
const btnAlertRetry = document.getElementById("alert-retry");
/** The message to resend if they hit Try again; empty when there is nothing to retry. */
let failedMessage = "";

/**
 * @param {string} text
 * @param {string} [retryMessage]
 */
function showAlert(text, retryMessage = "") {
  alertText.textContent = text;
  failedMessage = retryMessage;
  btnAlertRetry.hidden = !retryMessage;
  alertEl.hidden = false;
}

function clearAlert() {
  alertEl.hidden = true;
  failedMessage = "";
}

btnAlertRetry.addEventListener("click", () => {
  const text = failedMessage;
  clearAlert();
  if (text) submitUserMessage(text);
});

/* ── Language picker ──────────────────────────────────────────────────────
   Speech recognition transcribes as whatever language it is told, so on "Auto" the
   first spoken sentence is only correct if the user happens to speak the browser's
   locale. Choosing here pins the microphone AND tells the assistant which language to
   answer in, so turn one works instead of turn two. */
const langSelect = document.getElementById("lang-select");
/** @type {string} "" means auto-detect. */
let preferredLanguage = "";

langSelect.addEventListener("change", () => {
  preferredLanguage = langSelect.value;
  voice.pinLanguage(preferredLanguage || null);
});

/* ── wiring: session → UI ─────────────────────────────────────────────── */
session.subscribe((s) => {
  assistantView.renderSession(s);
  statusBar.render(s);
});

/* Camera service state mirrors into the session so the AI sees cameraStatus. */
camera.subscribe((s) => {
  if (session.get().cameraStatus !== s.status) session.setCameraStatus(s.status);
});

/* ── wiring: audio state ──────────────────────────────────────────────── */
function renderAudio() {
  assistantView.renderAudio({
    muted: speech.isMuted(),
    speaking: speech.isSpeaking(),
    hasLast: speech.hasLast(),
  });
}

speech.on({
  onSpeakingChange(speaking) {
    if (speaking) {
      session.setAssistantStatus("speaking");
    } else if (session.get().assistantStatus === "speaking") {
      // Only drop to idle from speaking — never stomp listening/processing.
      session.setAssistantStatus("idle");
    }
    renderAudio();
  },
});

/* ── wiring: voice (STT) ──────────────────────────────────────────────── */
voice.on({
  onState(v) {
    assistantView.renderVoice(v);
    if (session.get().microphoneStatus !== v.status) session.setMicrophoneStatus(v.status);

    if (v.listening) {
      session.setAssistantStatus("listening");
    } else if (session.get().assistantStatus === "listening" && !busy) {
      session.setAssistantStatus("idle");
    }
    if (v.lastError) assistantView.setInterim(v.lastError);
  },
  onInterim(text) {
    assistantView.setInterim(text);
  },
  onFinal(text) {
    // Speech fills the composer — it is NEVER sent automatically. The user reads it,
    // edits if the transcription got it wrong, and presses Send when ready.
    assistantView.setInterim("");
    assistantView.appendInput(text);
  },
});

/* ── the turn pipeline ────────────────────────────────────────────────── */

/** @param {string} text */
async function submitUserMessage(text) {
  const clean = (text || "").trim();
  if (!clean || busy) return;

  busy = true;
  assistantView.setBusy(true);
  assistantView.setInterim("");

  // Barge-in: if the assistant is mid-sentence, stop so it isn't talking over the reply.
  speech.stop();

  session.addMessage("user", clean);
  session.setAssistantStatus("processing");

  /** @type {import("./types/emergency.js").VisualContext|null} */
  let visualContext = null;
  try {
    visualContext = await vision.getVisualContext();
  } catch {
    visualContext = null; // camera trouble must never block the conversation
  }

  try {
    const response = await ai.sendMessage({
      userMessage: clean,
      emergencyContext: session.get(),
      visualContext,
      preferredLanguage,
    });

    clearAlert();
    session.applyAIResponse(response);
    const message = session.addMessage("assistant", response.message);

    assistantView.setSourceNote("Live assistant");

    // Speak it in the language it was written in — a Chinese reply read by an English
    // voice is unintelligible. If muted or synthesis is unavailable, the text is already
    // on screen. Point the recognizer at the same language so the user's next spoken
    // turn is transcribed correctly instead of as English-sounding nonsense.
    if (response.language) voice.setLanguage(response.language);
    const started = speech.speak(response.message, response.language);
    session.markSpoken(message.id);
    if (!started) session.setAssistantStatus("idle");
    renderAudio();
  } catch (err) {
    // Nothing is added to the transcript here on purpose: a failure is not something the
    // assistant said, and writing one in would feed it back to the model as context.
    const reason =
      err instanceof AssistantUnavailableError ? err.message : "The assistant could not answer.";
    showAlert(reason, clean);
    speech.speak("I could not get an answer. Tap try again.");
    session.setAssistantStatus("idle");
  } finally {
    busy = false;
    assistantView.setBusy(false);
  }
}

/** Assistant speaks first, before the user has said anything. */
function openingTurn() {
  const response = ai.greeting();
  session.applyAIResponse(response);
  const message = session.addMessage("assistant", response.message);
  const started = speech.speak(response.message);
  session.markSpoken(message.id);
  if (!started) session.setAssistantStatus("idle");
  renderAudio();
}

/* ── permission gate ──────────────────────────────────────────────────── */

/**
 * Camera and microphone are requested SEPARATELY and sequentially, so denying one
 * leaves the other working. Neither is required to use the assistant.
 */
async function enterEmergency({ requestDevices }) {
  gate.hidden = true;
  emergencyEl.hidden = false;
  session.start();

  if (requestDevices) {
    await camera.start({ facingMode: "environment" });
    await voice.requestMicrophone();
  } else {
    session.setCameraStatus("off");
    session.setMicrophoneStatus("off");
  }

  assistantView.renderVoice(voice.getState());
  renderAudio();
  openingTurn();
  assistantView.focusInput();

  // Ask the backend whether it can actually answer, now, rather than letting someone
  // discover mid-emergency that the host has no assistant behind it. Not awaited: the
  // opening line should not wait on a health check.
  ai.checkHealth().then((health) => {
    if (health.ok) {
      assistantView.setSourceNote("Live assistant");
      return;
    }
    assistantView.setSourceNote("Assistant offline");
    showAlert(`${health.reason} I will not be able to answer until that is fixed.`);
  });
}

document.getElementById("gate-allow").addEventListener("click", () => {
  enterEmergency({ requestDevices: true });
});
document.getElementById("gate-skip").addEventListener("click", () => {
  enterEmergency({ requestDevices: false });
});

/* ── layout: split view vs. bigger text ───────────────────────────────────
   A fully-described first-aid technique runs well over a hundred words, which does not
   fit in half a phone screen. This trades camera height for reading room. The camera
   keeps running either way, so the vision model still sees the scene. */
const LAYOUT_KEY = "aidlive.layout";
const btnLayout = document.getElementById("btn-layout");

/** @param {"split"|"text"} mode */
function setLayout(mode) {
  emergencyEl.dataset.layout = mode;
  btnLayout.textContent = mode === "text" ? "Show camera" : "Bigger text";
  btnLayout.title =
    mode === "text"
      ? "Go back to the split camera view"
      : "Give the assistant's text more room";
  btnLayout.dataset.on = String(mode === "text");
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    /* private browsing can refuse storage — the toggle still works for this session */
  }
}

btnLayout.addEventListener("click", () => {
  setLayout(emergencyEl.dataset.layout === "text" ? "split" : "text");
});

/* ── assistant controls ───────────────────────────────────────────────── */
const { btnMute, btnReplay, btnStopAudio, btnMic } = assistantView.elements;

btnMute.addEventListener("click", () => {
  speech.setMuted(!speech.isMuted());
  renderAudio();
});

btnReplay.addEventListener("click", () => {
  if (speech.replayLast()) renderAudio();
});

btnStopAudio.addEventListener("click", () => {
  speech.stop();
  renderAudio();
});

btnMic.addEventListener("click", async () => {
  const state = voice.getState();
  if (state.listening) {
    voice.stopListening();
    return;
  }
  // Don't listen to our own audio.
  speech.stop();
  await voice.startListening();
});

document.getElementById("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  // Sending ends the dictation — otherwise the mic keeps running into the next reply.
  if (voice.getState().listening) voice.stopListening();
  const text = assistantView.getInput();
  if (!text) return;
  assistantView.clearInput();
  submitUserMessage(text);
});

/* ── end emergency (confirmed) ────────────────────────────────────────── */
document.getElementById("btn-end").addEventListener("click", () => {
  confirmEl.hidden = false;
  document.getElementById("btn-continue").focus();
});

document.getElementById("btn-continue").addEventListener("click", () => {
  confirmEl.hidden = true;
});

document.getElementById("btn-confirm-end").addEventListener("click", () => {
  confirmEl.hidden = true;
  teardown();

  const s = session.end();
  const minutes = Math.max(1, Math.round((Date.now() - s.startTime) / 60000));
  const turns = s.messages.filter((m) => m.role === "user").length;
  endedSummary.textContent =
    `${minutes} min · ${turns} message${turns === 1 ? "" : "s"} · ` +
    `${s.actionsTaken.length} step${s.actionsTaken.length === 1 ? "" : "s"} covered.`;

  emergencyEl.hidden = true;
  endedEl.hidden = false;
});

document.getElementById("btn-restart").addEventListener("click", () => {
  window.location.reload();
});

/** Release every device and stop all audio. */
function teardown() {
  speech.stop();
  voice.dispose();
  camera.stop();
}

window.addEventListener("pagehide", teardown);
window.addEventListener("beforeunload", teardown);

/* Escape closes the confirm dialog rather than trapping the user in it. */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !confirmEl.hidden) confirmEl.hidden = true;
});

/* ── initial paint ────────────────────────────────────────────────────── */
let savedLayout = null;
try {
  savedLayout = localStorage.getItem(LAYOUT_KEY);
} catch {
  /* storage unavailable — fall back to the default split */
}
setLayout(savedLayout === "text" ? "text" : "split");

assistantView.renderVoice(voice.getState());
renderAudio();
cameraView.render(camera.getState());

// Exposed for automated checks and manual poking in the console during the hackathon.
window.__emergency = { camera, voice, speech, ai, vision, session, submitUserMessage };

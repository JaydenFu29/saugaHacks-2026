"use client";

/**
 * The emergency session, as a React hook.
 *
 * This is a direct port of the old `apps/web/main.js` controller. The service layer
 * underneath (camera, voice, speech, ai, vision, session) is reused unchanged — it was
 * always framework-agnostic, so only the wiring moved. Services live in refs so they are
 * created exactly once; their state is mirrored into React state for rendering.
 *
 * Pipeline:
 *   user speaks or types
 *     → voiceService (STT) fills the composer — never auto-sends
 *     → visionService samples one camera frame for observable context
 *     → aiService posts the FULL session to /api/assistant
 *     → session folds in the reply
 *     → reply is transcribed on screen AND spoken
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createCameraService } from "./services/cameraService.js";
import { createVoiceService } from "./services/voiceService.js";
import { createSpeechService } from "./services/speechService.js";
import { createAIService } from "./services/aiService.js";
import { createVisionService } from "./services/visionService.js";
import { createEmergencySession } from "./state/emergencySession.js";

export function useEmergency() {
  /** Services are built lazily on the client — never during SSR. */
  const svc = useRef(null);
  if (svc.current === null && typeof window !== "undefined") {
    const camera = createCameraService();
    const voice = createVoiceService();
    const speech = createSpeechService();
    const ai = createAIService();
    const vision = createVisionService(camera);
    const session = createEmergencySession();
    svc.current = { camera, voice, speech, ai, vision, session };
  }

  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const languageRef = useRef("");

  const [phase, setPhase] = useState("gate"); // gate | active | ended
  const [sessionState, setSessionState] = useState(() =>
    svc.current ? svc.current.session.get() : null
  );
  const [cameraState, setCameraState] = useState(null);
  const [voiceState, setVoiceState] = useState(null);
  const [audio, setAudio] = useState({ muted: false, speaking: false, hasLast: false });
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceNote, setSourceNote] = useState("Demo assistant — scripted responses");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [language, setLanguage] = useState("");

  const refreshAudio = useCallback(() => {
    const { speech } = svc.current;
    setAudio({ muted: speech.isMuted(), speaking: speech.isSpeaking(), hasLast: speech.hasLast() });
  }, []);

  /* ── subscriptions ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!svc.current) return undefined;
    const { camera, voice, speech, session } = svc.current;

    const unsubSession = session.subscribe(setSessionState);

    const unsubCamera = camera.subscribe((s) => {
      setCameraState(s);
      // Mirror into the session so the AI sees cameraStatus.
      if (session.get().cameraStatus !== s.status) session.setCameraStatus(s.status);
    });

    speech.on({
      onSpeakingChange(speaking) {
        if (speaking) session.setAssistantStatus("speaking");
        else if (session.get().assistantStatus === "speaking") {
          // Only drop to idle from speaking — never stomp listening/processing.
          session.setAssistantStatus("idle");
        }
        refreshAudio();
      },
    });

    voice.on({
      onState(v) {
        setVoiceState(v);
        if (session.get().microphoneStatus !== v.status) session.setMicrophoneStatus(v.status);

        if (v.listening) session.setAssistantStatus("listening");
        else if (session.get().assistantStatus === "listening" && !busyRef.current) {
          session.setAssistantStatus("idle");
        }
        if (v.lastError) setInterim(v.lastError);
      },
      onInterim: setInterim,
      onFinal(text) {
        // Speech fills the composer — it is NEVER sent automatically. The user reads it,
        // edits if the transcription got it wrong, and presses Send when ready.
        setInterim("");
        const addition = String(text || "").trim();
        if (!addition) return;
        setDraft((prev) => (prev.trim() ? `${prev.trim()} ${addition}` : addition));
        try {
          inputRef.current?.focus({ preventScroll: true });
        } catch {
          /* focus can fail if hidden — harmless */
        }
      },
    });

    refreshAudio();
    setVoiceState(voice.getState());
    setCameraState(camera.getState());

    return () => {
      unsubSession();
      unsubCamera();
    };
  }, [refreshAudio]);

  /* Hand the <video> element to the camera service once it exists. */
  useEffect(() => {
    if (svc.current && videoRef.current) svc.current.camera.attach(videoRef.current);
  }, [phase]);

  /** Release every device and stop all audio. */
  const teardown = useCallback(() => {
    if (!svc.current) return;
    svc.current.speech.stop();
    svc.current.voice.dispose();
    svc.current.camera.stop();
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", teardown);
    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, [teardown]);

  /* ── the turn pipeline ─────────────────────────────────────────────── */
  const submitUserMessage = useCallback(
    async (text) => {
      const clean = (text || "").trim();
      if (!clean || busyRef.current || !svc.current) return;
      const { speech, session, vision, ai, voice } = svc.current;

      busyRef.current = true;
      setBusy(true);
      setInterim("");

      // Barge-in: if the assistant is mid-sentence, stop so it isn't talking over itself.
      speech.stop();

      session.addMessage("user", clean);
      session.setAssistantStatus("processing");

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
          preferredLanguage: languageRef.current,
        });

        session.applyAIResponse(response);
        const message = session.addMessage("assistant", response.message);

        setSourceNote(
          response.source === "backend" ? "Live assistant" : "Demo assistant — scripted responses"
        );

        // Speak it in the language it was written in, and point the recognizer at the
        // same language so the next spoken turn transcribes correctly.
        if (response.language) voice.setLanguage(response.language);
        const started = speech.speak(response.message, response.language);
        session.markSpoken(message.id);
        if (!started) session.setAssistantStatus("idle");
        refreshAudio();
      } catch {
        session.addMessage(
          "assistant",
          "Something went wrong on my side. If this is life-threatening, call 911 now. " +
            "You can keep typing and I'll try again."
        );
        session.setAssistantStatus("idle");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refreshAudio]
  );

  /* ── entering the emergency ────────────────────────────────────────── */
  const enterEmergency = useCallback(
    async ({ requestDevices }) => {
      if (!svc.current) return;
      const { camera, voice, speech, session, ai } = svc.current;

      setPhase("active");
      session.start();

      // Camera and microphone are requested SEPARATELY so denying one leaves the other
      // working. Neither is required to use the assistant.
      if (requestDevices) {
        await camera.start({ facingMode: "environment" });
        await voice.requestMicrophone();
      } else {
        session.setCameraStatus("off");
        session.setMicrophoneStatus("off");
      }

      setVoiceState(voice.getState());
      refreshAudio();

      // Assistant speaks first, before the user has said anything.
      const response = ai.greeting();
      session.applyAIResponse(response);
      const message = session.addMessage("assistant", response.message);
      const started = speech.speak(response.message);
      session.markSpoken(message.id);
      if (!started) session.setAssistantStatus("idle");
      refreshAudio();
    },
    [refreshAudio]
  );

  /* ── controls ──────────────────────────────────────────────────────── */
  const toggleMic = useCallback(async () => {
    if (!svc.current) return;
    const { voice, speech } = svc.current;
    if (voice.getState().listening) {
      voice.stopListening();
      return;
    }
    speech.stop(); // don't listen to our own audio
    await voice.startListening();
  }, []);

  const send = useCallback(() => {
    if (!svc.current) return;
    // Sending ends dictation — otherwise the mic runs on into the next reply.
    if (svc.current.voice.getState().listening) svc.current.voice.stopListening();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    submitUserMessage(text);
  }, [draft, submitUserMessage]);

  const endSession = useCallback(() => {
    if (!svc.current) return;
    setConfirmOpen(false);
    teardown();
    const s = svc.current.session.end();
    const minutes = Math.max(1, Math.round((Date.now() - s.startTime) / 60000));
    const turns = s.messages.filter((m) => m.role === "user").length;
    setSummary(
      `${minutes} min · ${turns} message${turns === 1 ? "" : "s"} · ` +
        `${s.actionsTaken.length} step${s.actionsTaken.length === 1 ? "" : "s"} covered.`
    );
    setPhase("ended");
  }, [teardown]);

  const chooseLanguage = useCallback((value) => {
    setLanguage(value);
    languageRef.current = value;
    svc.current?.voice.pinLanguage(value || null);
  }, []);

  /* Expose the live services for automated checks and console debugging. */
  useEffect(() => {
    if (svc.current) {
      window.__emergency = { ...svc.current, submitUserMessage };
    }
  }, [submitUserMessage]);

  return {
    refs: { videoRef, inputRef },
    phase,
    session: sessionState,
    camera: cameraState,
    voice: voiceState,
    audio,
    interim,
    draft,
    setDraft,
    busy,
    sourceNote,
    confirmOpen,
    setConfirmOpen,
    summary,
    language,
    chooseLanguage,
    enterEmergency,
    submitUserMessage,
    send,
    toggleMic,
    endSession,
    services: svc.current,
    refreshAudio,
  };
}

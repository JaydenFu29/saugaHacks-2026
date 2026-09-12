"use client";

/**
 * The emergency assistant UI.
 *
 * A React port of the original apps/web markup. The logic all lives in useEmergency();
 * this file is presentation only, so the behaviour that was already tested (permission
 * handling, tap-to-speak, capability-gated zoom, confirm-to-end) is preserved rather
 * than reinvented.
 */

import { useEmergency } from "../lib/useEmergency.js";

const LANGUAGES = [
  ["", "Auto"], ["en", "English"], ["pa", "ਪੰਜਾਬੀ · Punjabi"], ["ur", "اردو · Urdu"],
  ["hi", "हिन्दी · Hindi"], ["gu", "ગુજરાતી · Gujarati"], ["bn", "বাংলা · Bengali"],
  ["ta", "தமிழ் · Tamil"], ["zh-CN", "中文 · Chinese"], ["tl", "Tagalog"],
  ["es", "Español · Spanish"], ["pt", "Português · Portuguese"], ["fr", "Français · French"],
  ["pl", "Polski · Polish"], ["vi", "Tiếng Việt · Vietnamese"], ["fa", "فارسی · Persian"],
  ["ar", "العربية · Arabic"], ["ru", "Русский · Russian"], ["ko", "한국어 · Korean"],
  ["ja", "日本語 · Japanese"],
];

const STATE_LABEL = { idle: "Idle", listening: "Listening", processing: "Thinking", speaking: "Speaking" };

const DEVICE_LABEL = {
  idle: "not started", requesting: "asking…", active: "on", denied: "blocked",
  unavailable: "none", "in-use": "busy", unsupported: "n/a", off: "off",
};

const CAMERA_FALLBACK = {
  denied: ["Camera unavailable", "Camera permission was denied. Allow it in your browser's site settings, then try again. The assistant still works without it."],
  unavailable: ["Camera unavailable", "No camera was found on this device. The assistant still works without it."],
  "in-use": ["Camera unavailable", "The camera is being used by another app. Close it and try again."],
  unsupported: ["Camera unavailable", "This browser does not support camera access. The assistant still works without it."],
  off: ["Camera off", "The camera is turned off. Turn it back on when you want the assistant to see the scene."],
  idle: ["Camera not started", ""],
  requesting: ["Starting camera…", "Waiting for camera permission."],
};

export default function EmergencyApp() {
  const e = useEmergency();
  const { refs, session, camera, voice, audio, services } = e;

  /* ── permission gate ── */
  if (e.phase === "gate") {
    return (
      <section className="gate">
        <div className="gate__inner">
          <p className="gate__kicker">Emergency Assistant</p>
          <h1 className="gate__title">Before we start</h1>

          <ul className="gate__reasons">
            <li><strong>Camera</strong><span>Lets the assistant understand the situation around you.</span></li>
            <li><strong>Microphone</strong><span>Lets you talk to the assistant hands-free, so you can keep helping.</span></li>
          </ul>

          <p className="gate__note">
            Nothing is recorded or uploaded in this prototype. You can continue without
            either one — typing always works.
          </p>

          <button className="btn btn--emergency btn--block" type="button"
                  onClick={() => e.enterEmergency({ requestDevices: true })}>
            Allow camera &amp; microphone
          </button>
          <button className="btn btn--quiet btn--block" type="button"
                  onClick={() => e.enterEmergency({ requestDevices: false })}>
            Continue without them
          </button>

          <p className="gate__911">
            For life-threatening emergencies, <a href="tel:911">call 911</a> now.
          </p>
        </div>
      </section>
    );
  }

  /* ── ended ── */
  if (e.phase === "ended") {
    return (
      <section className="ended">
        <div className="ended__inner">
          <h2 className="ended__title">Session ended</h2>
          <p className="ended__text">{e.summary}</p>
          <a className="btn btn--dark btn--block" href="/site/index.html">Back to site</a>
          <button className="btn btn--quiet btn--block" type="button"
                  onClick={() => window.location.reload()}>
            Start a new session
          </button>
        </div>
      </section>
    );
  }

  /* ── active emergency ── */
  const camStatus = camera?.status ?? "idle";
  const active = camStatus === "active";
  const [fbTitle, fbText] = CAMERA_FALLBACK[camStatus] || CAMERA_FALLBACK.unavailable;
  const zoomOK = active && camera?.zoom?.supported;
  const assistantStatus = session?.assistantStatus ?? "idle";
  const messages = session?.messages ?? [];
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <>
      <main className="emergency">
        {/* status strip */}
        <header className="status">
          <span className="status__live"><span className="status__dot" />Emergency active</span>
          <span className="chip" data-state={camStatus}>
            Camera {DEVICE_LABEL[camStatus] ?? camStatus}
          </span>
          <span className="chip" data-state={session?.microphoneStatus ?? "idle"}>
            Mic {DEVICE_LABEL[session?.microphoneStatus] ?? session?.microphoneStatus}
          </span>
          <button className="status__end" type="button" onClick={() => e.setConfirmOpen(true)}>
            End
          </button>
        </header>

        {/* ── TOP ~50%: CAMERA ── */}
        <section className="camera">
          <video className="camera__video" ref={refs.videoRef} playsInline autoPlay muted hidden={!active} />

          {!active && (
            <div className="camera__fallback">
              <p className="camera__fallback-title">{fbTitle}</p>
              <p className="camera__fallback-text">{camera?.lastError || fbText}</p>
              {camStatus !== "unsupported" && (
                <button className="btn btn--ghost btn--sm" type="button"
                        onClick={() => services?.camera.start()}>
                  {camStatus === "off" ? "Turn camera on" : "Try Again"}
                </button>
              )}
            </div>
          )}

          <div className="camera__controls">
            <button className="cbtn" type="button" disabled={!active || !camera?.hasMultipleCameras}
                    title={!active ? "Camera is not running" : camera?.hasMultipleCameras
                      ? `Switch to ${camera.facingMode === "environment" ? "front" : "rear"} camera`
                      : "Only one camera on this device"}
                    onClick={() => services?.camera.flip()}>Flip</button>

            <button className="cbtn" type="button"
                    disabled={!zoomOK || camera.zoom.value <= camera.zoom.min}
                    title={zoomOK ? "Zoom out" : active ? "This camera does not expose zoom control" : "Camera is not running"}
                    onClick={() => services?.camera.zoomOut()}>Zoom −</button>

            <button className="cbtn" type="button"
                    disabled={!zoomOK || camera.zoom.value >= camera.zoom.max}
                    title={zoomOK ? "Zoom in" : active ? "This camera does not expose zoom control" : "Camera is not running"}
                    onClick={() => services?.camera.zoomIn()}>Zoom +</button>

            <button className="cbtn" type="button" data-on={String(active)}
                    disabled={camStatus === "unsupported"}
                    onClick={() => (active ? services?.camera.stop() : services?.camera.start())}>
              {active ? "Camera off" : "Camera on"}
            </button>
          </div>

          {active && !camera?.zoom?.supported && (
            <p className="camera__zoomnote">Zoom not supported on this camera</p>
          )}
        </section>

        {/* ── BOTTOM ~50%: ASSISTANT ── */}
        <section className="assistant">
          <div className="assistant__head">
            <span className="state" data-state={assistantStatus}>
              <span className="state__dot" />{STATE_LABEL[assistantStatus] || "Idle"}
            </span>
            <div className="assistant__audio">
              <button className="cbtn" type="button" data-on={String(!audio.muted)}
                      title={audio.muted ? "Unmute assistant audio" : "Mute assistant audio"}
                      onClick={() => { services?.speech.setMuted(!audio.muted); e.refreshAudio(); }}>
                {audio.muted ? "Unmute" : "Mute"}
              </button>
              <button className="cbtn" type="button" disabled={!audio.hasLast || audio.muted}
                      title={audio.muted ? "Unmute to replay" : audio.hasLast ? "Replay last response" : "Nothing to replay yet"}
                      onClick={() => { services?.speech.replayLast(); e.refreshAudio(); }}>
                Replay
              </button>
              {audio.speaking && (
                <button className="cbtn" type="button" title="Stop audio"
                        onClick={() => { services?.speech.stop(); e.refreshAudio(); }}>Stop</button>
              )}
            </div>
          </div>

          {/* the single most important thing on the page */}
          {session?.currentInstruction && (
            <div className="instruction">
              <p className="instruction__label">Do this now</p>
              <p className="instruction__text">{session.currentInstruction}</p>
            </div>
          )}

          <div className="conversation" aria-live="polite">
            {messages.map((m) => (
              <div key={m.id}
                   className={`msg msg--${m.role}${m.id === lastAssistantId ? " is-latest" : ""}`}>
                <span>{m.text}</span>
                {m.role === "assistant" && <span className="msg__meta">Assistant</span>}
              </div>
            ))}
          </div>

          {e.interim && <p className="interim">{e.interim}</p>}

          <div className="controls">
            <button className="mic" type="button" aria-pressed={String(Boolean(voice?.listening))}
                    disabled={!voice?.recognitionSupported} onClick={e.toggleMic}>
              <svg className="mic__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
                   stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
                <path d="M12 17.5V21" />
              </svg>
              <span className="mic__label">
                {!voice?.recognitionSupported ? "Voice not supported — type below"
                  : voice.listening ? "Listening — tap to stop"
                  : !voice.micGranted ? "Tap to allow mic & speak"
                  : "Tap to speak"}
              </span>
            </button>

            <label className="sr-only" htmlFor="lang-select">Language you will speak</label>
            <select className="langpick" id="lang-select" value={e.language}
                    onChange={(ev) => e.chooseLanguage(ev.target.value)}>
              {LANGUAGES.map(([v, label]) => <option key={v || "auto"} value={v}>{label}</option>)}
            </select>

            <form className="composer" onSubmit={(ev) => { ev.preventDefault(); e.send(); }}>
              <label className="sr-only" htmlFor="text-input">Type a message to the assistant</label>
              <input className="composer__input" id="text-input" type="text" ref={refs.inputRef}
                     placeholder="…or type what's happening" autoComplete="off" disabled={e.busy}
                     value={e.draft} onChange={(ev) => e.setDraft(ev.target.value)} />
              <button className="composer__send" type="submit" disabled={e.busy}>Send</button>
            </form>
          </div>

          <p className="footnote">
            {e.sourceNote} · For life-threatening emergencies, <a href="tel:911">call 911</a>.
          </p>
        </section>
      </main>

      {/* end confirmation */}
      {e.confirmOpen && (
        <div className="confirm" onKeyDown={(ev) => ev.key === "Escape" && e.setConfirmOpen(false)}>
          <div className="confirm__box" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 className="confirm__title" id="confirm-title">End this emergency session?</h2>
            <p className="confirm__text">
              The assistant will stop, and the camera and microphone will be released.
            </p>
            <button className="btn btn--dark btn--block" type="button" autoFocus
                    onClick={() => e.setConfirmOpen(false)}>Continue Emergency</button>
            <button className="btn btn--emergency btn--block" type="button"
                    onClick={e.endSession}>End Emergency</button>
          </div>
        </div>
      )}
    </>
  );
}

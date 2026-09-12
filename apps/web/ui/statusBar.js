/**
 * Status strip controller — camera / microphone state at a glance.
 */

const LABEL = {
  idle: "not started",
  requesting: "asking…",
  active: "on",
  denied: "blocked",
  unavailable: "none",
  "in-use": "busy",
  unsupported: "n/a",
  off: "off",
};

export function createStatusBar() {
  const chipCamera = document.getElementById("chip-camera");
  const chipMic = document.getElementById("chip-mic");
  const live = document.getElementById("status-live");

  /** @param {import("../types/emergency.js").EmergencySession} session */
  function render(session) {
    chipCamera.dataset.state = session.cameraStatus;
    chipCamera.textContent = `Camera ${LABEL[session.cameraStatus] || session.cameraStatus}`;

    chipMic.dataset.state = session.microphoneStatus;
    chipMic.textContent = `Mic ${LABEL[session.microphoneStatus] || session.microphoneStatus}`;

    live.hidden = session.emergencyStatus !== "active";
  }

  return { render };
}

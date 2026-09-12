/**
 * Emergency session types.
 *
 * These are JSDoc typedefs rather than TypeScript interfaces because this repo has no
 * Node/tsc toolchain yet (see the note in main.js). They are checkable with
 * `tsc --checkJs` the moment Node exists, and converting this file to
 * `types/emergency.ts` is a mechanical rename.
 */

/** @typedef {"idle" | "requesting" | "active" | "denied" | "unavailable" | "in-use" | "unsupported" | "off"} DeviceStatus */

/** @typedef {"idle" | "listening" | "processing" | "speaking"} AssistantStatus */

/** @typedef {"inactive" | "active" | "ended"} EmergencyStatus */

/** @typedef {"low" | "moderate" | "high" | "critical"} Urgency */

/** @typedef {"user" | "assistant"} MessageRole */

/**
 * @typedef {Object} ConversationMessage
 * @property {string} id
 * @property {MessageRole} role
 * @property {string} text
 * @property {number} at              Epoch ms.
 * @property {boolean} [spoken]       Assistant messages only: has TTS played this?
 */

/**
 * Facts the assistant has established. Kept flat and free-form on purpose — the point is
 * that the AI receives accumulated context instead of only the latest message, so it
 * never re-asks something already answered.
 *
 * @typedef {Object.<string, string|boolean|number>} KnownFacts
 */

/**
 * @typedef {Object} VisualContext
 * @property {string} observedContext   Plain-language description of what's visible.
 * @property {boolean} fromCamera       False when no frame was available.
 * @property {number} at
 * @property {string} [frameDataUrl]    JPEG data URL, when a frame was captured.
 */

/**
 * The structured context handed to the AI layer on every turn.
 *
 * @typedef {Object} EmergencySession
 * @property {string} sessionId
 * @property {number} startTime
 * @property {string|null} scenario              e.g. "bicycle-fall-unresponsive"
 * @property {ConversationMessage[]} messages    Full ordered transcript.
 * @property {string|null} currentInstruction    What the user should be doing right now.
 * @property {string|null} currentStep           Step id within the scenario flow.
 * @property {KnownFacts} knownFacts
 * @property {string[]} actionsTaken
 * @property {DeviceStatus} cameraStatus
 * @property {DeviceStatus} microphoneStatus
 * @property {AssistantStatus} assistantStatus
 * @property {EmergencyStatus} emergencyStatus
 * @property {Urgency} urgency
 * @property {null} location                     Reserved. GPS is explicitly out of scope.
 */

export {};

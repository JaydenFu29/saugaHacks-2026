/**
 * AI service contract.
 *
 * This is the boundary a real multimodal provider plugs into. The shape is deliberately
 * provider-agnostic: the frontend never talks to an AI vendor directly, it posts this
 * request to our own backend, which holds the key and calls the provider.
 */

/**
 * @typedef {import("./emergency.js").EmergencySession} EmergencySession
 * @typedef {import("./emergency.js").VisualContext} VisualContext
 * @typedef {import("./emergency.js").Urgency} Urgency
 * @typedef {import("./emergency.js").KnownFacts} KnownFacts
 */

/**
 * @typedef {Object} AIRequest
 * @property {string} userMessage
 * @property {EmergencySession} emergencyContext
 * @property {VisualContext|null} visualContext
 */

/**
 * @typedef {Object} AIResponse
 * @property {string} message              Spoken + transcribed reply.
 * @property {string|null} nextStep        Step id the session should move to.
 * @property {string|null} scenario        Scenario the assistant believes it's in.
 * @property {Urgency} urgency
 * @property {string[]} actions            Actions the user has been asked to take.
 * @property {KnownFacts} knownFacts       Facts newly established this turn (merged in).
 * @property {string|null} [instruction]   The single most important action right now.
 * @property {"mock" | "backend"} source   Where this reply came from — surfaced in the UI.
 * @property {string|null} [audioUrl]      Set when the provider returns generated speech.
 */

/**
 * Every AI provider implementation satisfies this.
 *
 * @typedef {Object} AIProvider
 * @property {string} name
 * @property {(request: AIRequest) => Promise<AIResponse>} sendMessage
 */

export {};

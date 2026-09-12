/**
 * DEMO / MOCK CONTENT — NOT A VETTED MEDICAL PROTOCOL.
 *
 * This is a scripted step graph used to demonstrate the assistant architecture while no
 * real AI provider is connected. It deliberately stays at the level of widely-published
 * first-aid basics (scene safety, check responsiveness, call 911, check breathing, don't
 * move someone unnecessarily, keep monitoring) and hands off to the 911 dispatcher for
 * anything beyond that. It does not invent procedures and does not diagnose.
 *
 * Replace this wholesale with a vetted protocol source before this is used by anyone.
 */

export const SAFETY_PREAMBLE =
  "I'm an assistant, not a medical professional, and I can't diagnose anyone. " +
  "For anything life-threatening, call 911 now — don't wait for me.";

/** Words that read as "yes" / "no" under stress, including terse replies. */
const YES = [
  "yes", "yeah", "yep", "yup", "ya", "correct", "affirmative", "i did", "did it",
  "done", "ok", "okay", "sure", "they are", "he is", "she is", "it is", "i have",
  "already", "calling", "called", "on it",
];
const NO = [
  "no", "nope", "nah", "negative", "not really", "isn't", "is not", "aren't",
  "are not", "didn't", "did not", "haven't", "have not", "nothing", "none",
  "not responding", "unresponsive", "no response",
];

/**
 * @param {string} text
 * @returns {"yes" | "no" | "unclear"}
 */
export function detectYesNo(text) {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ")} `;
  const hit = (list) => list.some((w) => t.includes(` ${w} `) || t.startsWith(` ${w}`));
  // Check "no" first: "no, he isn't responding" contains "is" from the YES list.
  if (hit(NO)) return "no";
  if (hit(YES)) return "yes";
  return "unclear";
}

/** Keyword sets that identify the scenario from a free-text description. */
const SCENARIO_HINTS = {
  "bicycle-fall-unresponsive": [
    "bike", "bicycle", "cycling", "cyclist", "fell off", "fell of", "crash",
    "knocked off", "scooter",
  ],
};

/**
 * @param {string} text
 * @returns {string|null}
 */
export function detectScenario(text) {
  const t = text.toLowerCase();
  for (const [scenario, words] of Object.entries(SCENARIO_HINTS)) {
    if (words.some((w) => t.includes(w))) return scenario;
  }
  return null;
}

/** Extract facts worth remembering from any free-text message. */
export function extractFacts(text) {
  const t = text.toLowerCase();
  /** @type {Record<string, string|boolean>} */
  const facts = {};

  if (/\bnot responding|unresponsive|won'?t respond|no response|not moving|unconscious|passed out\b/.test(t)) {
    facts.responsive = "no";
  }
  if (/\bbreathing\b/.test(t) && /\bnot|isn'?t|no\b/.test(t)) facts.breathing = "no";
  else if (/\bbreathing\b/.test(t)) facts.breathing = "yes";

  if (/\bbleed|blood\b/.test(t)) facts.bleeding = "reported";
  if (/\bhelmet\b/.test(t)) facts.helmet = /\bno helmet|wasn'?t wearing|not wearing\b/.test(t) ? "no" : "yes";
  if (/\bcalled|calling|911|ambulance|paramedic\b/.test(t)) facts.emergencyServicesCalled = "yes";
  if (/\btraffic|road|street|highway|cars\b/.test(t)) facts.nearTraffic = "possible";
  if (/\bchild|kid|son|daughter|baby\b/.test(t)) facts.patientAge = "child reported";

  return facts;
}

/**
 * The step graph. Each step is one assistant turn: something it tells the user to do
 * (`instruction`) plus how it interprets the reply (`next`).
 *
 * `next` maps a detected intent ("yes" | "no" | "unclear") to the next step id.
 *
 * @typedef {Object} ScenarioStep
 * @property {string} id
 * @property {(ctx: {facts: Record<string, any>, first: boolean}) => string} say
 * @property {string|null} instruction
 * @property {import("../types/emergency.js").Urgency} urgency
 * @property {string|null} [factKey]     Fact this step establishes from a yes/no reply.
 * @property {string|null} [action]      Recorded into actionsTaken when reached.
 * @property {Object.<string, string>} next
 */

/** @type {Object.<string, ScenarioStep>} */
export const STEPS = {
  intake: {
    id: "intake",
    say: () =>
      "Tell me what happened, in a few words. If anyone is unconscious, not breathing, " +
      "or bleeding heavily, call 911 first.",
    instruction: "Describe what happened",
    urgency: "moderate",
    next: { any: "scene_safety" },
  },

  scene_safety: {
    id: "scene_safety",
    say: () =>
      "First, make sure the area around you is safe. Do not put yourself in danger. " +
      "Are you both clear of traffic and any other hazard?",
    instruction: "Check the area is safe before you approach",
    urgency: "high",
    factKey: "sceneSafe",
    action: "Checked scene safety",
    next: { yes: "responsiveness", no: "move_to_safety", unclear: "responsiveness" },
  },

  move_to_safety: {
    id: "move_to_safety",
    say: () =>
      "Your safety comes first — if there's traffic, get someone to stop or divert it " +
      "before you go closer. Only move an injured person if staying put is more " +
      "dangerous than moving them. Tell me when the area is safer.",
    instruction: "Make the area safe — do not put yourself at risk",
    urgency: "critical",
    action: "Advised making scene safe",
    next: { any: "responsiveness" },
  },

  responsiveness: {
    id: "responsiveness",
    say: ({ facts }) =>
      facts.responsive === "no"
        ? "You said they're not responding — I've got that. Stay with me."
        : "Are they responding when you speak to them or gently tap their shoulder?",
    instruction: "Speak to them and gently tap their shoulder",
    urgency: "high",
    factKey: "responsive",
    action: "Checked responsiveness",
    next: { yes: "responsive_path", no: "call_911", unclear: "call_911" },
  },

  call_911: {
    id: "call_911",
    say: ({ facts }) =>
      (facts.emergencyServicesCalled === "yes"
        ? "Good — help is on the way. "
        : "Call 911 now if you haven't already. ") +
      "Put your phone on speaker so you can keep your hands free and stay with them. " +
      "Have you got 911 on the line?",
    instruction: "Call 911 now — put the phone on speaker",
    urgency: "critical",
    factKey: "emergencyServicesCalled",
    action: "Told to call 911",
    next: { yes: "breathing", no: "breathing", unclear: "breathing" },
  },

  breathing: {
    id: "breathing",
    say: () =>
      "Now look at their chest and listen. Are they breathing normally — regular, " +
      "steady breaths?",
    instruction: "Look and listen — are they breathing normally?",
    urgency: "critical",
    factKey: "breathing",
    action: "Checked breathing",
    next: { yes: "recovery_monitor", no: "dispatcher_handoff", unclear: "dispatcher_handoff" },
  },

  dispatcher_handoff: {
    id: "dispatcher_handoff",
    say: () =>
      "This is beyond what I should guide you through. Tell the 911 dispatcher right now " +
      "that they are not breathing normally — the dispatcher will talk you through chest " +
      "compressions step by step and can time them with you. Follow the dispatcher, not me.",
    instruction: "Follow the 911 dispatcher's instructions now",
    urgency: "critical",
    action: "Handed off to 911 dispatcher",
    next: { any: "monitor" },
  },

  recovery_monitor: {
    id: "recovery_monitor",
    say: () =>
      "Good — they're breathing. Don't move them unless they're in danger, especially " +
      "after a fall, and don't remove a helmet. Keep them warm and keep watching their " +
      "breathing. Tell me straight away if anything changes.",
    instruction: "Don't move them — keep watching their breathing",
    urgency: "high",
    action: "Monitoring breathing",
    next: { any: "monitor" },
  },

  responsive_path: {
    id: "responsive_path",
    say: () =>
      "Good, they're responding. Ask them to stay still rather than getting up — after a " +
      "fall there could be an injury they can't feel yet. Can they tell you where it hurts?",
    instruction: "Keep them still — ask where it hurts",
    urgency: "moderate",
    action: "Keeping patient still",
    next: { any: "monitor" },
  },

  monitor: {
    id: "monitor",
    say: ({ facts }) =>
      "I'm still here. Keep watching their breathing and stay on the line with 911" +
      (facts.bleeding === "reported"
        ? ". For heavy bleeding, press firmly on the wound with a cloth and keep the pressure on."
        : ". Tell me anything that changes — breathing, consciousness, or new bleeding."),
    instruction: "Stay with them and report any change",
    urgency: "high",
    next: { any: "monitor" },
  },
};

export const FIRST_STEP = "intake";

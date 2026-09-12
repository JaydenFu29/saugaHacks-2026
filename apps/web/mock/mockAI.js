/**
 * Mock AI provider.
 *
 * Stands in for a real multimodal model until the backend endpoint exists. It is a state
 * machine over the demo scenario, not a canned string: it reads the session's current
 * step and accumulated facts, interprets the reply, records what it learned, and advances.
 * The same question is never asked twice because answered facts live in `knownFacts`.
 *
 * @typedef {import("../types/ai.js").AIRequest} AIRequest
 * @typedef {import("../types/ai.js").AIResponse} AIResponse
 */

import {
  STEPS,
  FIRST_STEP,
  SAFETY_PREAMBLE,
  detectYesNo,
  detectScenario,
  extractFacts,
} from "./demoScenario.js";

/** Simulated provider latency so the PROCESSING state is actually visible. */
const THINK_MS = 700;

/**
 * @param {AIRequest} request
 * @returns {Promise<AIResponse>}
 */
export async function sendMessage(request) {
  await new Promise((r) => setTimeout(r, THINK_MS));

  const session = request.emergencyContext;
  const userText = (request.userMessage || "").trim();
  const isFirstTurn = session.messages.filter((m) => m.role === "user").length <= 1;

  // Facts known BEFORE this turn, kept separate so we can tell "answered just now"
  // from "answered earlier" when choosing a branch.
  /** @type {Record<string, any>} */
  const priorFacts = { ...session.knownFacts };
  /** @type {Record<string, any>} */
  const facts = { ...priorFacts, ...extractFacts(userText) };

  const currentId = session.currentStep && STEPS[session.currentStep]
    ? session.currentStep
    : FIRST_STEP;
  const current = STEPS[currentId];

  // Interpret the reply against the question the current step asked.
  const intent = detectYesNo(userText);
  if (current.factKey && intent !== "unclear") {
    facts[current.factKey] = intent;
  }

  // Scenario detection, and let an explicit description skip past the yes/no branch.
  const scenario = detectScenario(userText) || session.scenario || null;

  // Pick the next step. Branch on the reply to THIS question when there is one;
  // otherwise fall back to a fact established earlier, so an unclear or off-topic reply
  // doesn't stall the flow on something we already know.
  const prior = current.factKey ? priorFacts[current.factKey] : undefined;
  const branch =
    intent !== "unclear" ? intent : prior === "yes" || prior === "no" ? prior : "unclear";

  const map = current.next || {};
  let nextId = map[branch] || map.any || "monitor";

  // Safety override: not breathing normally outranks wherever the graph was headed.
  // Scene safety is deliberately NOT skippable — never send someone into traffic first.
  if (facts.breathing === "no" && currentId !== "dispatcher_handoff") {
    nextId = "dispatcher_handoff";
  }

  const next = STEPS[nextId] || STEPS.monitor;

  // Compose the reply. The safety framing is stated once, on the first turn only, so it
  // doesn't become noise the user learns to skip.
  const body = next.say({ facts, first: isFirstTurn });
  const visual = request.visualContext;
  const visualLine =
    visual && visual.fromCamera && isFirstTurn
      ? ` From your camera I can see: ${visual.observedContext}`
      : "";

  const message = (isFirstTurn ? `${SAFETY_PREAMBLE} ` : "") + body + visualLine;

  const actions = next.action
    ? [...new Set([...session.actionsTaken, next.action])]
    : session.actionsTaken;

  return {
    message,
    instruction: next.instruction,
    nextStep: next.id,
    scenario,
    urgency: next.urgency,
    actions,
    knownFacts: facts,
    source: "mock",
    audioUrl: null,
  };
}

/**
 * The opening line, before the user has said anything.
 * @returns {AIResponse}
 */
export function greeting() {
  return {
    message:
      `${SAFETY_PREAMBLE} I'm here with you. ` + STEPS[FIRST_STEP].say({ facts: {}, first: true }),
    instruction: STEPS[FIRST_STEP].instruction,
    nextStep: FIRST_STEP,
    scenario: null,
    urgency: "moderate",
    actions: [],
    knownFacts: {},
    source: "mock",
    audioUrl: null,
  };
}

/** @type {import("../types/ai.js").AIProvider} */
export const mockAIProvider = { name: "mock", sendMessage };

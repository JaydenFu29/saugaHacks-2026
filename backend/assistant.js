/**
 * Turns a frontend request into a model call and back into the AIResponse shape the
 * browser already expects (see apps/web/types/ai.js).
 */

import { buildMessages, detectScript } from "./prompt.js";
import { chatCompletion } from "./featherless.js";

const URGENCIES = ["low", "moderate", "high", "critical"];

/**
 * Models don't reliably honour response_format, so recover JSON from:
 *   1. a clean object
 *   2. a ```json fenced block
 *   3. the first balanced {...} span in prose
 * Falling back to treating the whole reply as spoken text.
 *
 * @param {string} text
 */
function parseModelOutput(text) {
  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(text);
  if (direct) return { obj: direct, recovered: "direct" };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = attempt(fenced[1].trim());
    if (parsed) return { obj: parsed, recovered: "fenced" };
  }

  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = attempt(text.slice(start, i + 1));
          if (parsed) return { obj: parsed, recovered: "embedded" };
          break;
        }
      }
    }
  }

  // No JSON at all — the prose is still usable as the spoken reply.
  return { obj: { message: text }, recovered: "plaintext" };
}

/** Strip anything that would be read aloud badly or leak the JSON wrapper. */
function cleanSpoken(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Safety net: if the conversation clearly involves a life-threatening sign, the reply
 * must not be labelled low urgency, and 911 must be on the table. The prompt already
 * demands this; this is belt-and-braces because urgency drives the UI.
 */
const CRITICAL_SIGNS = new RegExp(
  [
    // Breathing
    "not breathing", "isn'?t breathing", "stopped breathing", "barely breathing",
    "can'?t breathe", "cannot breathe", "struggling to breathe", "gasping", "agonal",
    "chest (is |isn'?t |is not )?(not )?moving", "no chest rise", "not breathing right",
    // Circulation / responsiveness. Stems end in \w*, NOT \b — a trailing \b can never
    // match inside "unresponsive", so the original `\b(unrespons)\b` never fired at all.
    "no pulse", "can'?t find a pulse", "unrespons\\w*", "unconscious",
    "not respond\\w*", "won'?t respond", "wont respond", "won'?t wake", "wont wake",
    "not waking", "passed out", "blacked out", "collaps\\w*", "gone limp", "lifeless",
    "barely awake", "won'?t move", "not moving",
    // Colour / perfusion
    "turning blue", "(lips|skin) (are |is |look |looks )?(blue|purple|grey|gray|ashen)",
    "going (grey|gray|blue)", "dusky",
    // Named emergencies
    "choking", "can'?t cough", "cardiac", "heart attack", "seizure", "seizing",
    "chest pain", "pain in (his|her|their|my) chest", "tightness in.{0,12}chest",
    "crushing.{0,15}chest", "pressure in.{0,12}chest",
    "convuls\\w*", "anaphyla\\w*", "allergic reaction", "throat (is )?clos\\w*",
    "throat (is )?(tight|swelling)", "overdos\\w*", "took .{0,25}pills", "drown\\w*",
    "electrocut\\w*", "stroke", "face (is )?droop\\w*", "slurr\\w*",
    // Bleeding
    "severe bleed\\w*", "bleeding heavily", "bleeding badly", "blood everywhere",
    "soaking through", "spurting", "gushing", "won'?t stop bleeding",
    // Major trauma
    "impaled", "amputat\\w*", "arterial",
  ].join("|"),
  "i"
);

function enforceUrgency(urgency, haystack) {
  const normalized = URGENCIES.includes(urgency) ? urgency : "moderate";
  if (CRITICAL_SIGNS.test(haystack)) {
    const rank = URGENCIES.indexOf(normalized);
    return rank < URGENCIES.indexOf("high") ? "critical" : normalized;
  }
  return normalized;
}

/**
 * @param {unknown} claimed  the model's own "language" field
 * @param {string} message   the reply text
 * @param {string} userText  what the user just said
 */
function resolveLanguage(claimed, message, userText, preferred) {
  // A non-Latin script in the reply is hard evidence and outranks a claimed tag, since a
  // model that writes Chinese but labels it "en" would silently break the voice.
  const fromReply = detectScript(message);
  if (fromReply) return fromReply.tag;

  // Reply is Latin-script, where detection is useless. An explicit pick from the UI is
  // more trustworthy than the model's self-report: it was told to answer in this
  // language, and it cannot mislabel Polish as English if we never ask it.
  if (preferred) return preferred;

  if (typeof claimed === "string") {
    const tag = claimed.trim();
    // Shape check only — a full BCP-47 registry is overkill here.
    if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag)) return tag;
  }

  // Reply is Latin-script and the model gave nothing usable: if the USER wrote in another
  // script, the reply is in the wrong language anyway — report theirs so the UI can tell.
  const fromUser = detectScript(String(userText || ""));
  return (fromUser && fromUser.tag) || "en";
}

/**
 * The forced 911 reminder has to be in the same language as the reply it is attached to.
 * Covers the languages most likely at a Mississauga demo; anything else gets English,
 * which is still better than dropping the reminder entirely.
 */
const CALL_PROMPT = {
  en: "Call 911 now if you have not already.",
  es: "Llama al 911 ahora si aún no lo has hecho.",
  fr: "Appelez le 911 tout de suite si ce n'est pas déjà fait.",
  pt: "Ligue para o 911 agora, se ainda não ligou.",
  "zh-CN": "如果还没有打，请立即拨打911。",
  ja: "まだなら、今すぐ911に電話してください。",
  ko: "아직 하지 않았다면 지금 바로 911에 전화하세요.",
  hi: "अगर अभी तक नहीं किया है, तो तुरंत 911 पर कॉल करें।",
  ar: "اتصل بالرقم 911 الآن إن لم تكن قد فعلت ذلك.",
  ru: "Если ещё не позвонили, немедленно звоните 911.",
  ur: "اگر ابھی تک نہیں کیا تو فوراً 911 پر کال کریں۔",
  tl: "Tumawag sa 911 ngayon kung hindi mo pa nagagawa.",
  // Added for Peel Region's largest language communities.
  pa: "ਜੇ ਤੁਸੀਂ ਅਜੇ ਤੱਕ ਨਹੀਂ ਕੀਤਾ, ਤਾਂ ਹੁਣੇ 911 'ਤੇ ਕਾਲ ਕਰੋ।",
  ta: "இன்னும் அழைக்கவில்லை என்றால், உடனே 911 ஐ அழையுங்கள்.",
  gu: "જો હજી સુધી ન કર્યું હોય, તો તરત જ 911 પર કૉલ કરો.",
  bn: "এখনও না করে থাকলে এখনই 911 নম্বরে ফোন করুন।",
  vi: "Hãy gọi 911 ngay bây giờ nếu bạn chưa gọi.",
  pl: "Zadzwoń teraz pod 911, jeśli jeszcze tego nie zrobiłeś.",
  fa: "اگر هنوز تماس نگرفته‌اید، همین حالا با 911 تماس بگیرید.",
};

function callPrompt(language) {
  const tag = String(language || "en");
  return CALL_PROMPT[tag] || CALL_PROMPT[tag.split("-")[0]] || CALL_PROMPT.en;
}

/**
 * @param {{userMessage: string, context: any, visualContext: any}} payload
 * @returns {Promise<any>} AIResponse-shaped object
 */
export async function generateResponse(payload) {
  const messages = buildMessages(payload);
  const { text, model, usage } = await chatCompletion(messages);

  const { obj, recovered } = parseModelOutput(text);

  const message = cleanSpoken(obj.message ?? obj.reply ?? obj.text ?? text);
  if (!message) {
    throw new Error("Model produced no usable message");
  }

  const context = payload.context || {};
  const haystack = `${payload.userMessage || ""} ${message} ${JSON.stringify(
    context.knownFacts || {}
  )}`;

  const instruction = cleanSpoken(obj.instruction) || null;

  const knownFacts =
    obj.knownFacts && typeof obj.knownFacts === "object" && !Array.isArray(obj.knownFacts)
      ? obj.knownFacts
      : {};

  // Whether the USER said they called is the only thing that settles this, in either
  // direction — see both guards below.
  const said = String(payload.userMessage || "");
  const userConfirmedCall =
    /\b(i|we)\b[^.?!]{0,25}\b(called|calling|phoned|dialed|dialled)\b[^.?!]{0,20}\b(911|9-1-1|ambulance|emergency)\b/i.test(said) ||
    /\b(911|ambulance|paramedics|dispatcher)\b[^.?!]{0,25}\b(on the (phone|line|way)|coming|here|en route|answered)\b/i.test(said);

  // The model routinely encodes "I told them to call 911" as "they called 911". That
  // fabricated fact then comes back as established (buildContextBlock renders known facts
  // as "do NOT ask about these again"), so the assistant stops prompting and starts
  // referring to a dispatcher nobody ever reached. Only the USER may establish this.
  const priorCalled = (context.knownFacts || {}).emergencyServicesCalled;
  if ("emergencyServicesCalled" in knownFacts) {
    const claimed = String(knownFacts.emergencyServicesCalled).toLowerCase();
    if (claimed === "yes" && !userConfirmedCall && priorCalled !== "yes") {
      knownFacts.emergencyServicesCalled = priorCalled || "unknown";
    }
  } else if (userConfirmedCall) {
    // The mirror image, and the one the user actually notices: they say "I called 911,
    // they're on the way", the model forgets to record it, and the reminder below fires
    // anyway — so the assistant nags about calling an ambulance that is already coming.
    // Record it here so this turn and every later one treat the call as made.
    knownFacts.emergencyServicesCalled = "yes";
  }

  const urgency = enforceUrgency(obj.urgency, haystack);

  // Which language the reply is actually in. The model reports it; script detection is
  // the fallback, because the frontend picks its text-to-speech voice from this and a
  // wrong tag means the user hears their own language in a foreign accent, or silence.
  const language = resolveLanguage(
    obj.language,
    message,
    payload.userMessage,
    payload.preferredLanguage
  );

  // While the scene is critical and no call is confirmed, keep the reminder alive — the
  // model reliably says it once on turn 1 and then never mentions it again.
  // WHERE it goes matters, though. The first time, it has to be the first thing they
  // hear. Every turn after that, prefixing it makes the assistant sound like it is
  // stalling — the user hears "call 911" again instead of the instruction they are
  // waiting for — so it trails the guidance instead of leading it.
  // "911" stays as digits in every language (the prompt requires it), so this test works
  // regardless of what language `message` is written in.
  const called = knownFacts.emergencyServicesCalled ?? priorCalled;
  const priorAssistant = (Array.isArray(context.messages) ? context.messages : []).filter(
    (m) => m && m.role === "assistant" && typeof m.text === "string"
  );
  const everRaised = priorAssistant.some((m) => /\b911\b/.test(m.text));
  // Whether the turn immediately before this one already carried it. Appending on every
  // single turn is what makes the assistant feel like it is nagging instead of helping,
  // so it alternates: present on this turn, absent on the next, back on the one after.
  // Never more than one turn goes by without it while the scene is still critical.
  const lastCarriedIt = priorAssistant.length
    ? /\b911\b/.test(priorAssistant[priorAssistant.length - 1].text)
    : false;

  let finalMessage = message;
  if (urgency === "critical" && called !== "yes" && !/\b911\b/.test(message) && !lastCarriedIt) {
    // The first time, it has to be the first thing they hear. After that the guidance
    // leads and the reminder trails, so the reply is not "call 911" all over again.
    finalMessage = everRaised
      ? `${message} ${callPrompt(language)}`
      : `${callPrompt(language)} ${message}`;
  }

  const newActions = Array.isArray(obj.actions)
    ? obj.actions.map((a) => cleanSpoken(a)).filter(Boolean)
    : [];

  return {
    message: finalMessage,
    instruction,
    // No scripted step graph behind a real model — the instruction IS the step.
    nextStep: typeof obj.nextStep === "string" ? obj.nextStep : context.currentStep || null,
    scenario:
      (typeof obj.scenario === "string" && obj.scenario && obj.scenario !== "null"
        ? obj.scenario
        : null) || context.scenario || null,
    urgency,
    language,
    actions: [...new Set([...(context.actionsTaken || []), ...newActions])],
    knownFacts,
    source: "backend",
    audioUrl: null,
    // Diagnostics — handy while demoing, harmless to expose (no key material).
    meta: { model, usage, parsed: recovered },
  };
}

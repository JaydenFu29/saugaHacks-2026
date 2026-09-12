/**
 * System prompt + context construction for the emergency assistant.
 *
 * The prompt is the safety boundary. It is deliberately strict: the model guides, it
 * does not diagnose, it does not invent procedure, and it escalates to 911 early.
 */

export const SYSTEM_PROMPT = `You are the voice of an emergency first-aid assistant. An untrained bystander is
speaking to you during a real emergency. Your words are read aloud to them while they
are panicking and looking at an injured person.

WHO YOU ARE
- You are NOT a doctor, paramedic, nurse, or certified first aider.
- You NEVER diagnose. You describe what is observable and what to do next.
- You are a calm, steady guide who keeps an untrained person useful until professional
  help arrives.

WHAT YOU CAN SEE
- You DO have a camera view. The user's phone camera is pointed at the scene, and each
  time they speak you are given a fresh description of that frame under "Camera view" in
  the situation state below. Treat it as your own eyes.
- So NEVER say you cannot see, that you have no camera, that you are text-only, or that
  you need them to describe the scene to you — when a "Camera view" line is present, you
  can see it. Saying otherwise is wrong and wastes seconds in an emergency.
- Use it: refer naturally to what is visible ("I can see they're lying on their side"),
  and let it tell you what NOT to ask. Do not ask about something the camera already
  shows you.
- The camera view is an observation, not proof. It can be wrong, dark, or partial. It is
  NEVER a diagnosis and never on its own a reason to skip calling 911. If what they tell
  you contradicts the camera, believe the person.
- A still frame CANNOT show whether someone responds or is breathing. Never claim either
  from the camera ("lying still" is not "unresponsive") — have the user check.
- If the "Camera view" line says no view is available or that it could not be analyzed,
  then you genuinely cannot see right now — say so plainly, once, and ask them to
  describe what they see instead.

CALLING 911 (highest priority)
- If there is ANY sign of a serious or life-threatening situation, tell them to call 911
  IMMEDIATELY, in your very first sentence, before anything else.
- Serious signs include: unresponsiveness, not breathing or abnormal breathing, severe or
  uncontrolled bleeding, choking, suspected head/neck/spine injury, chest pain, stroke
  signs, seizure, drowning, severe burns, anaphylaxis, overdose, or anything you are
  unsure about.
- Never tell the user to wait, to answer more questions first, or to hold off on calling
  911. Calling always comes first. Tell them to put the phone on speaker so their hands
  stay free.
- Once 911 is on the line, the dispatcher outranks you. Say so plainly and tell the user
  to follow the dispatcher.

GIVE REAL, USABLE FIRST AID — THIS IS YOUR MAIN JOB
Calling 911 is step one, NOT the whole answer. Help arrives in minutes; what the
bystander does in those minutes matters. After telling them to call, always give the
actual technique, named, with concrete physical detail they can follow without training.
Say where to put their hands, how hard, how fast, how many times.

You MAY and SHOULD walk them through these established bystander protocols:

- CHOKING, adult or child over 1, still conscious: lean them forward, give 5 sharp back
  blows between the shoulder blades with the heel of your hand. If that fails, 5
  abdominal thrusts — stand behind, fist just above the navel, grab it with your other
  hand, pull sharply inward and upward. Alternate 5 and 5 until it clears.
- CHOKING, infant under 1: face down along your forearm, head lower than chest, 5 back
  blows between the shoulder blades. Then face up, 5 chest thrusts with two fingers on
  the breastbone. NEVER abdominal thrusts on an infant.
- NOT BREATHING / NO NORMAL BREATHING: start hands-only CPR. Heel of one hand in the
  centre of the chest, other hand on top, fingers interlocked, arms straight, shoulders
  over your hands. Push hard and fast, about 5 centimetres or 2 inches deep, 100 to 120
  pushes a minute. Let the chest come all the way back up between pushes. Do not stop
  until help takes over.
- AIRWAY: tilt the head back gently and lift the chin. If you suspect a neck or spine
  injury, do NOT tilt the head — use a jaw thrust instead: push the angles of the jaw
  forward with your fingers while keeping the head still.
- SEVERE BLEEDING: press hard directly on the wound with a cloth and keep pressing. Do
  not lift it to look. If blood soaks through, add another layer on top. Raise the limb
  above the heart if you can. For a limb bleed that will not stop and is life
  threatening, apply a tourniquet high and tight above the wound and note the time.
- UNCONSCIOUS BUT BREATHING: recovery position. Roll them onto their side, lower arm
  out, upper hand under the cheek, upper knee bent forward to stop them rolling back.
  Keeps the airway clear if they vomit.
- BURNS: cool under running water for 20 minutes. No ice, no butter, no creams. Cover
  loosely with cling film or a clean non-fluffy cloth. Do not pop blisters.
- SEIZURE: clear hard objects away, cushion the head, time it, and put nothing in the
  mouth. When it stops, recovery position.
- SHOCK: lie them flat, raise the legs about 30 centimetres, keep them warm.
- SUSPECTED BROKEN BONE: support it in the position found. Do not straighten it.

HARD LIMITS — these never change
- Never diagnose or name a medical condition as fact.
- Never suggest any medication, drug, or dosage.
- Never invent or improvise a technique that is not established first aid. If you are not
  certain of the correct procedure, say so and tell them to ask the 911 dispatcher.
- Nothing invasive: do not remove an impaled object, do not push anything back in, do not
  reposition a suspected spinal injury.
- If 911 is already on the line, the dispatcher outranks you — say so, and let them lead
  while you keep the user steady.

HOW YOU SPEAK
- Calm, warm, direct. Short sentences. Plain words. No jargon.
- Reply in the SAME language the user is speaking. Spanish in, Spanish out; Mandarin in,
  Mandarin out. Match them every turn, including the sentence about calling 911. Keep
  "911" as the number whatever the language.
- Exactly ONE instruction per reply. At most three short sentences, containing at most
  one thing you are telling them to do. If you catch yourself adding "and then", "also",
  or a second action, stop — save it for the next turn. They are hearing this aloud once,
  with no way to replay it.
- Ask at MOST one question per reply, and only if the answer changes what they do next.
- If something you need is genuinely not in the known facts and would change what they do
  next, ASK for it. Never assume it and never fill it in yourself.
- Keep replies under 70 words. They are spoken aloud to someone under stress: long
  enough to actually describe the technique, short enough to act on immediately.
- Never repeat a question that the known facts already answer. Acknowledge what you were
  already told and move forward.
- Never tell someone they do not need medical care. You may say what to watch for and
  when to get it looked at.
- No lists, no markdown, no headings, no emoji. This is spoken text.

OUTPUT FORMAT
Reply with ONLY a JSON object, no code fences and no text around it:
{
  "message": "what you say out loud (under 70 words, with concrete technique detail)",
  "instruction": "the single action they should take right now (under 10 words)",
  "urgency": "low" | "moderate" | "high" | "critical",
  "scenario": "short kebab-case label for the situation, or null",
  "language": "BCP-47 tag of the language you wrote message in, e.g. en, es, zh-CN, fr",
  "knownFacts": { "factName": "value" },
  "actions": ["short label for what you just told them to do"]
}
- "language" MUST describe the language of "message", and "message" MUST be in the same
  language the user just used. If they wrote Chinese, "message" is Chinese and "language"
  is "zh-CN". The app uses this tag to choose the voice that reads your words aloud, so a
  wrong tag means the user hears their own language read in a foreign accent, or silence.
- "knownFacts" holds anything NEW you learned this turn (for example
  {"responsive":"no"}). Use {} if nothing new.
- Record a fact ONLY if the user stated it in their own words. Never record something you
  inferred, assumed, or instructed. Telling them to call 911 does NOT make
  "emergencyServicesCalled" "yes" — only the user saying they called does. Never record a
  breathing, pulse, or responsiveness value they did not actually describe to you. If you
  have not been told, leave the key out.
- "urgency" is "critical" whenever 911 should already be on the line.`;

/**
 * Writing-system detection. Script is a reliable signal; telling apart languages that
 * share the Latin alphabet is not, so those return null and the model decides.
 *
 * This exists because the model cannot be trusted to notice the user's language on its
 * own — Qwen answers Japanese prompts in Chinese, since the two share kanji. Detecting
 * the script here and stating it as an instruction fixes that deterministically.
 */
const SCRIPTS = [
  // Kana before Han: Japanese contains kanji too, so testing Han first would call
  // every Japanese sentence Chinese — exactly the bug this is here to prevent.
  [/[぀-ゟ゠-ヿ]/, "ja", "Japanese"],
  [/[가-힯ᄀ-ᇿ]/, "ko", "Korean"],
  [/[一-鿿㐀-䶿]/, "zh-CN", "Chinese"],

  // Arabic-script languages, most specific first. Urdu and Persian both render in the
  // Arabic script, so a bare Arabic-block test would answer an Urdu speaker in Arabic.
  // Urdu is checked before Persian because Urdu also uses the four Persian letters.
  [/[ٹڈڑںےھ]/, "ur", "Urdu"],          // retroflex + yeh barree + noon ghunna
  [/[پچژگ]/, "fa", "Persian"],            // Persian letters absent from Arabic
  [/[؀-ۿݐ-ݿ]/, "ar", "Arabic"],

  // South Asian scripts, each in its own Unicode block — but Devanagari must come LAST.
  // The danda "।" (U+0964) and double danda (U+0965) are the full stop in Punjabi,
  // Bengali and Hindi alike, yet they live in the Devanagari block. Testing Devanagari
  // first therefore tagged every Punjabi or Bengali sentence that ended in a full stop as
  // Hindi. Both dandas are excluded from the Hindi class below, and Hindi is checked
  // after the others, so a real Devanagari letter is required to match it.
  [/[ਅ-੿]/, "pa", "Punjabi"],             // gurmukhi
  [/[ઁ-૿]/, "gu", "Gujarati"],            // gujarati
  [/[ঁ-৿]/, "bn", "Bengali"],             // bengali
  [/[஁-௿]/, "ta", "Tamil"],               // tamil
  [/[ऀ-ॣ०-ॿ]/, "hi", "Hindi"],            // devanagari, minus U+0964–U+0965 dandas

  [/[Ѐ-ӿ]/, "ru", "Russian"],
  [/[֐-׿]/, "he", "Hebrew"],
  [/[฀-๿]/, "th", "Thai"],
  [/[Ͱ-Ͽ]/, "el", "Greek"],
];

/**
 * @param {string} text
 * @returns {{tag: string, name: string}|null}
 */
export function detectScript(text) {
  for (const [re, tag, name] of SCRIPTS) {
    if (re.test(String(text || ""))) return { tag, name };
  }
  return null;
}

/**
 * Build the compact state block the model sees alongside the transcript. This is what
 * stops it re-asking things and lets it reason about where the guidance has got to.
 *
 * @param {any} context
 * @param {any} visualContext
 */
export function buildContextBlock(context = {}, visualContext = null) {
  const lines = [];

  const facts = context.knownFacts || {};
  const factEntries = Object.entries(facts);
  lines.push(
    factEntries.length
      ? `Already established (do NOT ask about these again): ${factEntries
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
      : "Already established: nothing yet."
  );

  if (context.currentInstruction) {
    lines.push(`Last instruction you gave: ${context.currentInstruction}`);
  }
  if (Array.isArray(context.actionsTaken) && context.actionsTaken.length) {
    lines.push(`Steps already covered: ${context.actionsTaken.join("; ")}`);
  }
  if (context.scenario) lines.push(`Working scenario: ${context.scenario}`);

  // The camera is a source of observable context only — say so, so the model never
  // treats it as diagnostic evidence. `fromCamera` is true only when a vision model
  // actually described a real frame; anything else must not read as sight.
  if (visualContext && visualContext.fromCamera && visualContext.observedContext) {
    const age = visualContext.at ? Math.round((Date.now() - visualContext.at) / 1000) : null;
    const freshness = age !== null && age >= 0 && age < 600 ? ` [captured ${age}s ago]` : "";
    lines.push(
      `Camera view — this is what you can see right now${freshness} ` +
        `(observation only, may be wrong, NOT diagnostic): ${visualContext.observedContext}`
    );
  } else if (visualContext && visualContext.observedContext) {
    lines.push(`Camera view: NOT available — ${visualContext.observedContext}`);
  } else {
    lines.push("Camera view: NOT available — no view.");
  }

  const cam = context.cameraStatus || "unknown";
  const mic = context.microphoneStatus || "unknown";
  lines.push(`Device status: camera=${cam}, microphone=${mic}.`);

  return `CURRENT SITUATION STATE\n${lines.join("\n")}`;
}

/**
 * Assemble the full OpenAI-style message array: system prompt, prior transcript, the
 * live state block, then this turn's user message.
 *
 * @param {{userMessage: string, context: any, visualContext: any}} payload
 */
/** Tag → English name, for the directive. Covers what the UI picker offers. */
const LANGUAGE_NAMES = {
  en: "English", es: "Spanish", fr: "French", pt: "Portuguese",
  "zh-CN": "Chinese", zh: "Chinese", ja: "Japanese", ko: "Korean",
  hi: "Hindi", ar: "Arabic", ru: "Russian", ur: "Urdu", tl: "Tagalog",
  pa: "Punjabi", ta: "Tamil", gu: "Gujarati", bn: "Bengali",
  vi: "Vietnamese", pl: "Polish", fa: "Persian", he: "Hebrew",
  th: "Thai", el: "Greek",
};

/**
 * @param {string} tag
 * @returns {{tag: string, name: string}|null}
 */
export function namedLanguage(tag) {
  const raw = String(tag || "").trim();
  if (!raw) return null;
  const name = LANGUAGE_NAMES[raw] || LANGUAGE_NAMES[raw.split("-")[0].toLowerCase()];
  return name ? { tag: raw, name } : null;
}

export function buildMessages({
  userMessage,
  context = {},
  visualContext = null,
  preferredLanguage = "",
}) {
  const history = Array.isArray(context.messages) ? context.messages : [];

  /** @type {{role: string, content: string}[]} */
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  // Prior turns. The frontend appends the current user message to the session before
  // calling, so drop a trailing duplicate of it rather than sending it twice.
  const prior = history.filter((m) => m && typeof m.text === "string" && m.text.trim());
  const last = prior[prior.length - 1];
  const trimmed =
    last && last.role === "user" && last.text.trim() === String(userMessage || "").trim()
      ? prior.slice(0, -1)
      : prior;

  for (const m of trimmed.slice(-20)) {
    messages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      // Assistant turns were emitted as JSON; the model only needs the spoken text back.
      content: m.text,
    });
  }

  const said = String(userMessage || "").trim();

  // An explicit choice from the UI outranks detection: script detection cannot tell
  // Polish from English, and on the user's very first word there may be nothing to go on.
  // Detection still beats the model's own judgement. Stated last, right before the reply,
  // where instructions carry the most weight.
  const detected = namedLanguage(preferredLanguage) || detectScript(said);
  const languageDirective = detected
    ? `\n\nThe user is writing in ${detected.name}. Your "message" MUST be written in ` +
      `${detected.name}, and "language" MUST be "${detected.tag}". Do not answer in any ` +
      `other language, and do not switch to a related one.`
    : "";

  messages.push({
    role: "user",
    content: `${buildContextBlock(context, visualContext)}\n\nThey just said: "${said}"${languageDirective}`,
  });

  return messages;
}

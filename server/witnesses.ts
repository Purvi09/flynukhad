// Giving the witnesses faces and voices.
//
// The geometry — where they stand and what they truthfully know — is worked out
// in the browser, from data it already holds. Only the *phrasing* comes here.
// A witness can therefore be wrong on purpose, but never wrong by accident.

import { factToWords, STAGE_LABEL, type Turn, type Witness, type WitnessSpot } from "../shared/history";
import { askGeminiJson } from "./gemini";

/**
 * Roles that make sense almost anywhere, used when there is no model available.
 * Deliberately unnamed: inventing culturally specific names for a real city we
 * know nothing about is worse than an honest "the tea-seller".
 */
const FALLBACK_ROLES = [
  { name: "The tea-seller", role: "runs a stall on this corner", look: "an apron, a kettle always on", opener: "Sit, sit. You look lost." },
  { name: "The caretaker", role: "sweeps these steps every morning", look: "a broom, and no hurry at all", opener: "You're not from this street." },
  { name: "The shopkeeper", role: "has traded here for thirty years", look: "leaning in the doorway, watching", opener: "Buying, or asking?" },
  { name: "The old resident", role: "has lived on this street since childhood", look: "a folding chair set out on the pavement", opener: "Whatever it is, it happened before your time." },
  { name: "The delivery rider", role: "knows every shortcut in the district", look: "engine still running", opener: "Make it quick, I'm on a drop." },
];

/** "Go and find X, they're on Y" — written by us, so it is never wrong. */
const pointerTo = (next: { name: string; street: string | null; setting: string } | undefined) => {
  if (!next) return null;
  const where = next.street ? `on ${next.street}` : next.setting;
  return `If you want more than that, find ${next.name} — ${where}. Tell them I sent you.`;
};

export const castWitnesses = async (city: string, spots: WitnessSpot[]): Promise<{ witnesses: Witness[]; source: string }> => {
  const fallback = (): Witness[] => {
    const named = spots.map((spot, index) => ({
      ...spot,
      ...FALLBACK_ROLES[index % FALLBACK_ROLES.length],
      testimony: factToWords(spot.fact),
    }));
    return named.map((w, index) => ({ ...w, pointer: pointerTo(named[index + 1]) }));
  };

  const manifest = spots.map((spot) => ({
    id: spot.id,
    stage: `${spot.stage}. ${STAGE_LABEL[spot.fact.kind]}`,
    standing: spot.street ? `on ${spot.street}, ${spot.setting}` : spot.setting,
    knows: factToWords(spot.fact),
  }));

  const parsed = await askGeminiJson<{ witnesses?: Array<Record<string, string>> }>({
    // The player is hovering over an empty street while this runs. Past twenty
    // seconds the unnamed locals will do.
    timeoutMs: 12_000,
    budgetMs: 20_000,
    prompt:
`You are casting minor characters for a game set in the real streets of ${city}.

For each person below, invent someone who plausibly stands exactly where they stand. Use the location to decide who they are — someone outside a temple is not the same person as someone outside a metro station.

These are a chain. The player meets them in order, and each one narrows the search a little further: first what happened, then which part of the city, then what stands around the place, and finally which landmark it sits beside. Nobody knows the whole answer.

For each, return:
- "name": how the player sees them. A short, ordinary name or an epithet ("Old Farid", "The tea-seller"). Do not use famous people.
- "role": five to eight words on what they do here.
- "look": a short physical detail, for the label above their head.
- "opener": the first thing they say when approached, under 15 words, in their own voice. Wary or busy, not eager.
- "testimony": rewrite the "knows" line in their voice, 1-2 sentences. You MUST preserve every direction, distance, street name and date exactly as given. Do not add facts. Do not name the place being searched for.

Respect the real city: do not caricature, do not write accents phonetically, and keep everyone ordinary.

Return JSON: {"witnesses":[{"id":"...","name":"...","role":"...","look":"...","opener":"...","testimony":"..."}]}

People: ${JSON.stringify(manifest)}`,
  });

  const written = new Map<string, Record<string, string>>();
  if (Array.isArray(parsed?.witnesses)) {
    for (const w of parsed.witnesses) {
      if (w?.id && typeof w.testimony === "string") written.set(w.id, w);
    }
  }

  if (written.size === 0) return { witnesses: fallback(), source: "local" };

  const merged = spots.map((spot, index) => {
    const w = written.get(spot.id);
    const role = FALLBACK_ROLES[index % FALLBACK_ROLES.length];
    return {
      ...spot,
      name: w?.name ?? role.name,
      role: w?.role ?? role.role,
      look: w?.look ?? role.look,
      opener: w?.opener ?? role.opener,
      // if the model dropped the detail, fall back to the plain true sentence;
      // and never let a redaction mark reach a speech bubble
      testimony: (w?.testimony ?? factToWords(spot.fact)).replace(/▁+/g, "the place"),
    };
  });

  // The hand-off is written here, not by the model, so the name and street it
  // gives you are always the ones actually standing there.
  return {
    witnesses: merged.map((w, index) => ({ ...w, pointer: pointerTo(merged[index + 1]) })),
    source: "gemini",
  };
};

// ---- talking to one of them ------------------------------------------------------

/** Do they seem to be asking about the thing this person knows? */
const ASKING_ABOUT_IT = /\b(where|which way|direction|how far|near|close|street|road|place|happen|happened|know|remember|tell|heard|saw|when|year|what year)\b/i;
const GREETING = /^\s*(hi|hey|hello|namaste|ola|olá|excuse me|good (morning|evening|afternoon))\b/i;

const DEFLECTIONS = [
  "I've work to do. Ask me something useful.",
  "Plenty happens here. You'll have to be clearer than that.",
  "Mm. And what is it you actually want to know?",
  "I mind my own business, mostly.",
];

export type AskedWitness = {
  name?: string; role?: string; standing?: string; testimony?: string; opener?: string;
  sentBy?: string | null; pointer?: string | null;
};

export const witnessReply = async (
  witness: AskedWitness,
  history: Turn[],
  question: string,
  told: boolean,
): Promise<{ reply: string; revealed: boolean; source: string }> => {
  // Without a model, answer on keywords. The player still gets the real fact,
  // just without the character work.
  const localReply = () => {
    if (GREETING.test(question) && !ASKING_ABOUT_IT.test(question)) {
      return { reply: witness.opener ?? "Yes? What is it?", revealed: false, source: "local" };
    }
    if (ASKING_ABOUT_IT.test(question)) {
      return { reply: witness.testimony ?? "I couldn't say.", revealed: true, source: "local" };
    }
    return { reply: DEFLECTIONS[question.length % DEFLECTIONS.length], revealed: false, source: "local" };
  };

  const recent = history.slice(-8);
  const transcript = recent
    .map((turn) => `${turn.from === "player" ? "Stranger" : witness.name ?? "You"}: ${turn.text}`)
    .join("\n");

  const parsed = await askGeminiJson<{ reply?: string; revealed?: boolean }>({
    tier: "cheap",
    temperature: 0.9,
    // Somebody is hovering in the street waiting for this line. Past twelve
    // seconds the keyword reply, which carries the same fact, is kinder.
    timeoutMs: 8_000,
    budgetMs: 12_000,
    prompt:
`You are ${witness.name ?? "a local"}, who ${witness.role ?? "lives around here"}. You are standing ${witness.standing ?? "on the street"}. A stranger has stopped you.

THE ONE THING YOU KNOW:
"${witness.testimony ?? "nothing much"}"
${witness.sentBy ? `${witness.sentBy} sent this stranger to you. You trust ${witness.sentBy}. If they mention that name, warm up a little.` : ""}
${witness.pointer ? `Once you have told them, you also point them onward: "${witness.pointer}"` : ""}

HOW TO SPEAK IT:
- Never quote that line word for word. Say it the way THIS person would say it, in their own rhythm.
- But every concrete detail inside it — compass directions, distances, street names, dates, years — must survive EXACTLY as written. Change "south-east" and you have lied to them.
- Two or three sentences at most. No stage directions, no asterisks, no accents written phonetically.

WHEN TO SPEAK IT — only if they are actually asking about it:
- Asking where it happened, which way, how far, what happened here, what this place was, or when: TELL THEM.
- Anything vaguer than that — "do you know this street?", "been here long?", questions about you: answer in character, in one line, and do NOT tell them. Let them ask properly.
- You know nothing beyond that one line. If they push for more, say plainly that you do not know.
- Never invent another place, date, direction or name. Not even a small one.
${told ? "- You have ALREADY told them. Do not say it again in full. One short line referring back to it, and only the specific part they asked about." : ""}

Set "revealed" true only if your reply actually contains the detail.

Conversation so far:
${transcript || "(nothing yet)"}
Stranger: ${question}

Return JSON: {"reply":"...","revealed":true|false}`,
  });

  if (!parsed || typeof parsed.reply !== "string") return localReply();

  return { reply: parsed.reply.slice(0, 400), revealed: !!parsed.revealed, source: "gemini" };
};

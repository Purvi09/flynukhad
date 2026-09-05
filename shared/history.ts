// The history game: what happened in a city, and the people who will tell you.
//
// A *site* is a real place something happened, taken from Wikipedia's
// geolocated articles. Its name is the answer, so the player never sees it —
// only a clue, and four witnesses who each know one piece of where it is.
//
// These types cross the wire in both directions, so they live here.

/** A place something happened, in metres from the city centre (x east, y south). */
export type Site = {
  /** Wikipedia page id. */
  id: string;
  /** The answer. Never sent to the browser until the round is over. */
  title: string;
  x: number;
  y: number;
  /** The opening paragraphs, used to write the clue and the first witness's fact. */
  summary: string;
  /** What the player reads: the summary with every giveaway taken out. */
  clue: string;
  /** A year, a century, or "undated". */
  era: string;
  url: string;
};

/**
 * The four stages of a search. Each narrows it further: what happened, which
 * part of the city, what stands around the place, and which landmark it sits
 * beside. Alone none of them find the spot; together they do.
 */
export type WitnessFact =
  | { kind: "context"; era: string; detail: string }
  | { kind: "quadrant"; bearing: string; band: string }
  | { kind: "surroundings"; street: string | null; terrain: string }
  | { kind: "landmark"; landmark: string; bearing: string; band: string };

export const STAGE_LABEL: Record<WitnessFact["kind"], string> = {
  context: "What happened",
  quadrant: "Which part of the city",
  surroundings: "What stands around it",
  landmark: "Which landmark it sits by",
};

/** A spot on a real street where somebody is standing, and what they know. */
export type WitnessSpot = {
  id: string;
  x: number;
  y: number;
  /** The street they are standing on, for grounding the persona. */
  street: string | null;
  setting: string;
  fact: WitnessFact;
  /** Exactly one witness per case is honestly mistaken. Never the first. */
  reliable: boolean;
  /** Position in the chain. Witness n only talks once n-1 has. */
  stage: number;
  /** The id of the witness who sends the player here. */
  unlockedBy: string | null;
};

/** A witness with a face and a voice on top of the geometry. */
export type Witness = WitnessSpot & {
  name: string;
  role: string;
  look: string;
  opener: string;
  /** What they say when they finally give up what they know. */
  testimony: string;
  /** Where they send you next. Written by us, so it is never wrong. */
  pointer: string | null;
};

export type Turn = { from: "player" | "witness"; text: string };

const COMPASS = [
  "north", "north-east", "east", "south-east",
  "south", "south-west", "west", "north-west",
];

/** Words for the direction of (dx, dy), where x is east and y is south. */
export const bearingOf = (dx: number, dy: number) => {
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return COMPASS[Math.round(((angle + 360) % 360) / 45) % 8];
};

export const rotateBearing = (bearing: string, steps: number) => {
  const at = COMPASS.indexOf(bearing);
  if (at < 0) return bearing;
  return COMPASS[(at + steps + COMPASS.length) % COMPASS.length];
};

/**
 * Plain-language version of a fact. This is the fallback testimony, and also
 * what the model is asked to paraphrase — so it is the single source of the
 * truth a witness carries.
 */
export const factToWords = (fact: WitnessFact) => {
  switch (fact.kind) {
    case "context":
      return fact.era === "undated" ? fact.detail : `That was ${fact.era}. ${fact.detail}`;
    case "quadrant":
      return `It happened in the ${fact.bearing} of the city — ${fact.band}.`;
    case "surroundings":
      return fact.street
        ? `The place sits just off ${fact.street}, ${fact.terrain}.`
        : `The place sits ${fact.terrain}.`;
    case "landmark":
      return `You'll find it beside ${fact.landmark} — ${fact.band}.`;
  }
};

/** How close your locked-in answer must be to count as dead on. */
export const FOUND_WITHIN_M = 45;

/** A perfect answer. Every case is worth this much and no more. */
export const MAX_POINTS = 1000;
/** Beyond the ring, the score halves every this many metres. */
const HALF_LIFE_M = 250;

/**
 * What an answer this far from the place is worth. Inside the ring is full
 * marks; after that it falls away fast enough that a guess from the wrong
 * neighbourhood scores nothing, but a near miss still pays.
 */
export const scoreFor = (metres: number): number => {
  if (metres <= FOUND_WITHIN_M) return MAX_POINTS;
  const points = Math.round(MAX_POINTS * Math.pow(0.5, (metres - FOUND_WITHIN_M) / HALF_LIFE_M));
  // a score of 12 reads as a consolation prize; it is not one
  return points < 25 ? 0 : points;
};

/** How the answer is put to the player, worst to best. */
export const verdictFor = (metres: number): string => {
  if (metres <= FOUND_WITHIN_M) return "Dead on.";
  if (metres <= 150) return "Near as makes no difference.";
  if (metres <= 400) return "Close. You were on the right street.";
  if (metres <= 900) return "Warm. The right corner of the city, at least.";
  if (metres <= 2000) return "Cold. Not this part of town.";
  return "Nowhere near.";
};
/**
 * How close you must fly to a witness before they will talk to you. Generous:
 * hovering a pod onto an exact corner is fiddly, and the game is the finding,
 * not the parking.
 */
export const WITNESS_WITHIN_M = 50;

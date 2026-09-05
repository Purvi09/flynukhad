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

/** How close you must be to a site for it to count as found. */
export const FOUND_WITHIN_M = 45;
/** How close you must fly to a witness before they will talk to you. */
export const WITNESS_WITHIN_M = 30;

// A run of the history game: which cases you are dealt, and how one is solved.
//
// A case is a real place something happened. You are given a clue with the name
// taken out, and four people standing on real streets who each know one piece of
// where it is. Fly to where you think it is and lock the answer in; how far off
// you were is what you are scored on.

import { distance, type CityData } from "@shared/geo";
import { FOUND_WITHIN_M, scoreFor, type Site, type Turn, type Witness } from "@shared/history";
import { castWitnesses, fetchHistory } from "../net/api";
import { placeWitnesses } from "../world/witnesses";
import { stored } from "../ui/dom";

const PLAYED_KEY = "played";

const played = (): Record<string, number> => {
  try { return JSON.parse(stored.get(PLAYED_KEY, "{}")); } catch { return {}; }
};

export const markPlayed = (sites: Site[]) => {
  const seen = played();
  const now = Date.now();
  sites.forEach((s) => { seen[s.id] = now; });
  // keep the most recent 200, so old cities come round again eventually
  const trimmed = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200);
  stored.set(PLAYED_KEY, JSON.stringify(Object.fromEntries(trimmed)));
};

/** Cases dealt together should not share a square: solving one must not solve the next. */
const MIN_APART_M = 260;

const spread = (ordered: Site[], count: number): Site[] => {
  for (const apart of [MIN_APART_M, 160, 80, 0]) {
    const chosen: Site[] = [];
    for (const site of ordered) {
      if (chosen.length >= count) break;
      if (!chosen.some((c) => distance(c.x, c.y, site.x, site.y) < apart)) chosen.push(site);
    }
    if (chosen.length >= count) return chosen;
  }
  return ordered.slice(0, count);
};

/**
 * Deal `count` cases, preferring ones this player has not had before, and
 * shuffling within each group so repeat visits are not in the same order.
 */
export const dealCases = (pool: Site[], count: number): Site[] => {
  const seen = played();
  const shuffle = (list: Site[]) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const fresh = shuffle(pool.filter((s) => !seen[s.id]));
  // fall back to the oldest-played once the pool is exhausted
  const stale = pool.filter((s) => seen[s.id]).sort((a, b) => (seen[a.id] ?? 0) - (seen[b.id] ?? 0));
  return spread([...fresh, ...stale], count);
};

// ---- one case in progress ---------------------------------------------------------

/** What the player has got out of one witness so far. */
export type WitnessState = {
  witness: Witness;
  /** Only witness n+1 will talk once n has told you what they know. */
  unlocked: boolean;
  /** They have given up their fact. */
  told: boolean;
  turns: Turn[];
};

export type CaseRun = {
  site: Site;
  witnesses: WitnessState[];
  startedAt: number;
  solved: boolean;
  /** Set when the player gives up rather than answering. */
  surrendered: boolean;
  /** Where they locked the answer in, and what it cost them to be wrong. */
  guess: { x: number; y: number } | null;
  away: number | null;
  points: number;
};

export class HistoryGame {
  /** Every case this city can offer, dealt from once per session. */
  private pool: Site[] = [];
  private dealt: Site[] = [];
  private at = -1;
  current: CaseRun | null = null;
  /** How many cases were answered inside the ring: dead on. */
  found = 0;
  /** Points across the whole set. */
  score = 0;

  constructor(private city: CityData) {}

  get ready() { return this.pool.length > 0; }
  get remaining() { return Math.max(0, this.dealt.length - this.at - 1); }
  get roundNumber() { return this.at + 1; }
  get total() { return this.dealt.length; }

  /** Fetch the city's history once. Slow the first time, cached after. */
  async load(rounds = 8) {
    if (this.pool.length > 0) return;
    const radius = this.city.span * 400;
    const { sites } = await fetchHistory(this.city.centre, radius, Math.max(rounds * 2, 12));
    this.pool = sites;
    this.dealt = dealCases(sites, Math.min(rounds, sites.length));
    markPlayed(this.dealt);
  }

  /**
   * Start the next case. The witnesses are placed here, from the streets the
   * player can see, and only their phrasing is fetched.
   */
  async next(): Promise<CaseRun | null> {
    if (this.at + 1 >= this.dealt.length) return null;
    this.at += 1;
    const site = this.dealt[this.at];

    const spots = placeWitnesses(this.city, site);
    let witnesses: Witness[] = [];
    if (spots.length > 0) {
      try {
        witnesses = (await castWitnesses(this.city.label, spots)).witnesses;
      } catch {
        // The case still works without them: the clue alone is playable.
        witnesses = [];
      }
    }

    this.current = {
      site,
      witnesses: witnesses.map((witness, index) => ({
        witness,
        unlocked: index === 0,
        told: false,
        turns: [],
      })),
      startedAt: Date.now(),
      solved: false,
      surrendered: false,
      guess: null,
      away: null,
      points: 0,
    };
    return this.current;
  }

  /** Deal a fresh set from the same pool, preferring cases not yet played. */
  reset(rounds = 8) {
    this.dealt = dealCases(this.pool, Math.min(rounds, this.pool.length));
    markPlayed(this.dealt);
    this.at = -1;
    this.current = null;
    this.found = 0;
    this.score = 0;
  }

  /** Mark a witness as having told what they know, which unlocks the next. */
  tell(id: string) {
    const run = this.current;
    if (!run) return;
    const index = run.witnesses.findIndex((w) => w.witness.id === id);
    if (index < 0) return;
    run.witnesses[index].told = true;
    if (run.witnesses[index + 1]) run.witnesses[index + 1].unlocked = true;
  }

  /**
   * Lock this spot in as the answer. Closes the case whether or not it is
   * right — being sure and wrong is the risk the game is made of.
   */
  lockIn(x: number, y: number): CaseRun | null {
    const run = this.current;
    if (!run || run.solved) return null;
    const away = distance(x, y, run.site.x, run.site.y);
    run.guess = { x, y };
    run.away = away;
    run.points = scoreFor(away);
    run.solved = true;
    this.score += run.points;
    if (away <= FOUND_WITHIN_M) this.found += 1;
    return run;
  }

  giveUp() {
    if (!this.current || this.current.solved) return;
    this.current.solved = true;
    this.current.surrendered = true;
  }
}

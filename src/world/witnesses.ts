// Where the witnesses stand, and what each of them truthfully knows.
//
// All of this is computed in the browser from the city the player is already
// flying, so a witness's directions are checked against the same streets they
// are looking at. Only the phrasing is handed to a model, on the server.

import { distance, type CityData, type Way } from "@shared/geo";
import { bearingOf, rotateBearing, type WitnessFact, type Site, type WitnessSpot } from "@shared/history";

/** The tiled city, flattened into the feature lists this file reasons over. */
type Flat = { roads: Way[]; buildings: Way[]; water: Way[]; parks: Way[]; radius: number };

export const flatten = (city: CityData): Flat => {
  const roads: Way[] = [];
  const buildings: Way[] = [];
  const water: Way[] = [];
  const parks: Way[] = [];
  for (const tile of city.tiles) {
    roads.push(...tile.roads);
    buildings.push(...tile.buildings);
    water.push(...tile.water);
    parks.push(...tile.parks);
  }
  return { roads, buildings, water, parks, radius: city.span * 400 };
};

const centroid = (pts: number[]) => {
  let sx = 0;
  let sy = 0;
  const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; }
  return { x: sx / n, y: sy / n };
};

/** Significant words of a title, for spotting when a "clue" is the answer. */
const keyWords = (title: string) =>
  title.split(/[\s,'’\-—()]+/).filter((w) => w.length >= 4).map((w) => w.toLowerCase());

/** Would naming this give the game away? */
const givesItAway = (name: string, site: Site) => {
  const lower = name.toLowerCase();
  const title = site.title.toLowerCase();
  if (lower.includes(title) || title.includes(lower)) return true;
  return keyWords(site.title).some((w) => lower.includes(w));
};

const PLACEHOLDER = /▁▁▁▁/g;

/** Strip the answer, and any bracketed pronunciation noise, out of a sentence. */
const redactTitle = (text: string, site: Site) => {
  let out = text.replace(/\([^)]*\)/g, " ");
  for (const term of [site.title, ...keyWords(site.title)].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "▁▁▁▁");
  }
  return out.replace(/(▁▁▁▁[\s,]*){2,}/g, "▁▁▁▁ ").replace(/\s+/g, " ").trim();
};

/**
 * The opening fact: what happened, told in the sentences that still make sense
 * once the name is taken out. "The Queen ▁▁ II ▁▁ is a ▁▁ in Lisbon" is not a
 * clue, it is a form with the answers missing.
 */
const openingFact = (site: Site) => {
  const sentences = site.summary
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .slice(0, 5);

  const scored = sentences
    .map((sentence, index) => {
      const hidden = redactTitle(sentence, site);
      const holes = (hidden.match(PLACEHOLDER) ?? []).length;
      const words = sentence.split(/\s+/).length;
      let score = words > 6 ? 1 : -2;
      if (/\b(1[0-9]{3}|20[0-2][0-9])\b/.test(sentence)) score += 2;
      score -= holes * 2;
      if (holes / Math.max(1, words) > 0.2) score -= 6; // more hole than sentence
      return { index, score, hidden };
    })
    .filter((s) => s.score > -4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index);

  let seen = false;
  const text = scored
    .map((s) => s.hidden)
    .join(" ")
    .replace(PLACEHOLDER, () => { if (seen) return "it"; seen = true; return "the place"; })
    // "the historic the place" -> "the historic place"
    .replace(/\b(the|a|an)\s+((?:\w+\s+)?)the place\b/gi, "the $2place")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 30) return text.slice(0, 220);
  return site.era === "undated"
    ? "Something happened at the place worth remembering. Ask around."
    : `Something happened at the place around ${site.era}. Ask around.`;
};

/** The nearest named thing to a point, for describing where something is. */
const nearestNamed = (
  ways: Way[],
  x: number,
  y: number,
  within: number,
  reject?: (name: string, d: number) => boolean,
) => {
  let best: { name: string; d: number } | null = null;
  for (const way of ways) {
    if (!way.name) continue;
    const c = centroid(way.pts);
    const d = distance(c.x, c.y, x, y);
    if (d >= within) continue;
    if (reject?.(way.name, d)) continue;
    if (!best || d < best.d) best = { name: way.name, d };
  }
  return best?.name ?? null;
};

/** The name of the street a point sits on, if it has one. */
const streetAt = (roads: Way[], x: number, y: number) => {
  let best: { name: string; d: number } | null = null;
  for (const road of roads) {
    if (!road.name) continue;
    for (let i = 0; i < road.pts.length - 2; i += 2) {
      const ax = road.pts[i];
      const ay = road.pts[i + 1];
      const dx = road.pts[i + 2] - ax;
      const dy = road.pts[i + 3] - ay;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < 30 && (!best || d < best.d)) best = { name: road.name, d };
    }
  }
  return best?.name ?? null;
};

const describeSetting = (city: Flat, x: number, y: number) => {
  const park = nearestNamed(city.parks, x, y, 90);
  if (park) return `beside ${park}`;
  const water = nearestNamed(city.water, x, y, 120);
  if (water) return `near the water at ${water}`;
  const building = nearestNamed(city.buildings, x, y, 70);
  if (building) return `outside ${building}`;
  const shop = city.buildings.find((b) => {
    const c = centroid(b.pts);
    return distance(c.x, c.y, x, y) < 60 && ["retail", "shop", "cafe", "restaurant"].includes(b.kind);
  });
  if (shop) return "outside a row of shops";
  return "on a quiet stretch of street";
};

/**
 * Pick spots that are on real streets, spread around the target, and not all
 * clustered on the same side of it.
 */
export const placeWitnesses = (source: CityData, site: Site, count = 4): WitnessSpot[] => {
  const city = flatten(source);
  type Candidate = { x: number; y: number; street: string | null; d: number; bearing: string };
  const candidates: Candidate[] = [];

  for (const road of city.roads) {
    if (road.pts.length < 4) continue;
    // one candidate per road, at its midpoint
    const i = Math.floor(road.pts.length / 4) * 2;
    const x = road.pts[i];
    const y = road.pts[i + 1];
    const d = distance(x, y, site.x, site.y);
    if (d < 120 || d > 850) continue;
    if (Math.hypot(x, y) > city.radius * 0.9) continue;
    candidates.push({ x, y, street: road.name ?? null, d, bearing: bearingOf(x - site.x, y - site.y) });
  }

  if (candidates.length === 0) return [];

  // One witness near, one far, and the rest between — so the case sends you
  // across the city rather than round one block. Different compass points too.
  const BANDS = [180, 340, 520, 720];
  const chosen: Candidate[] = [];
  const usedBearings = new Set<string>();

  const take = (wantBearingSpread: boolean) => {
    for (let b = 0; b < count && chosen.length < count; b++) {
      const want = BANDS[b % BANDS.length];
      let best: Candidate | null = null;
      let bestScore = Infinity;
      for (const candidate of candidates) {
        if (chosen.includes(candidate)) continue;
        if (wantBearingSpread && usedBearings.has(candidate.bearing)) continue;
        if (chosen.some((c) => distance(c.x, c.y, candidate.x, candidate.y) < 170)) continue;
        const score = Math.abs(candidate.d - want) + (candidate.street ? 0 : 120);
        if (score < bestScore) { bestScore = score; best = candidate; }
      }
      if (best) { usedBearings.add(best.bearing); chosen.push(best); }
    }
  };

  take(true);
  if (chosen.length < count) take(false);

  // The chain should walk you outward, so start with whoever is easiest to
  // stumble across and let each one send you further out.
  chosen.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  // Facts that only make sense together.
  const notTheAnswer = (name: string, d: number) => givesItAway(name, site) || d < 45;
  const forgettable = new Set(["retail", "shop", "supermarket", "cafe", "restaurant", "fast_food", "convenience", "garage", "garages", "kiosk"]);
  const substantial = city.buildings.filter((b) => !forgettable.has(b.kind));

  const streetName = streetAt(city.roads, site.x, site.y);
  const nearStreet = streetName && !givesItAway(streetName, site) ? streetName : null;

  const nearWater = nearestNamed(city.water, site.x, site.y, 320, notTheAnswer);
  const nearPark = nearestNamed(city.parks, site.x, site.y, 220, notTheAnswer);
  const nearLandmark = nearestNamed(substantial, site.x, site.y, 260, notTheAnswer)
    ?? nearestNamed(city.parks, site.x, site.y, 300, notTheAnswer)
    ?? nearestNamed(city.water, site.x, site.y, 380, notTheAnswer);

  const terrain = nearWater ? `close enough to the water at ${nearWater} to smell it`
    : nearPark ? `where the ground opens out at ${nearPark}`
    : "in among the built-up streets, hemmed in on every side";

  // Where it sits relative to the whole city, which is what "north of the old
  // town" actually means to someone giving directions.
  const fromCentre = bearingOf(site.x, site.y);
  const outFromCentre = Math.hypot(site.x, site.y);
  const centreBand = outFromCentre < 250 ? "right in the middle of everything"
    : outFromCentre < 600 ? "a short way out from the centre"
    : "well out from the centre";

  // Build the strongest chain this city's data can support.
  const facts: WitnessFact[] = [
    { kind: "context", era: site.era, detail: openingFact(site) },
    { kind: "quadrant", bearing: fromCentre, band: centreBand },
  ];
  if (nearStreet || nearPark || nearWater) facts.push({ kind: "surroundings", street: nearStreet, terrain });
  if (nearLandmark) {
    facts.push({ kind: "landmark", landmark: nearLandmark, bearing: fromCentre, band: "a minute's flight at most" });
  }

  const chain = chosen.slice(0, Math.min(chosen.length, facts.length));

  // Exactly one link is honestly mistaken, and never the first — a chain that
  // lies at the very first step is just unfair.
  const seed = site.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const liar = chain.length > 2 ? 1 + (seed % (chain.length - 1)) : -1;

  return chain.map((c, index) => {
    const reliable = index !== liar;
    let fact = facts[index];

    if (!reliable) {
      // bend the geography, never the history — a wrong date is not a red herring
      if (fact.kind === "quadrant") {
        fact = { ...fact, bearing: rotateBearing(fact.bearing, index % 2 === 0 ? 2 : -2) };
      } else if (fact.kind === "landmark") {
        fact = { ...fact, bearing: rotateBearing(fact.bearing, 3) };
      } else if (fact.kind === "surroundings") {
        fact = { ...fact, terrain: "in among the built-up streets, hemmed in on every side" };
      }
    }

    return {
      id: `w${index}`,
      x: c.x,
      y: c.y,
      street: c.street,
      setting: describeSetting(city, c.x, c.y),
      fact,
      reliable,
      stage: index + 1,
      unlockedBy: index === 0 ? null : `w${index - 1}`,
    } satisfies WitnessSpot;
  });
};

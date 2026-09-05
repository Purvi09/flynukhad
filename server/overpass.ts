// Talking to OpenStreetMap's Overpass API without getting throttled.
//
// The public servers ration requests per address and answer 429 to anything
// more, so requests from this process go out one at a time, urgent ones first,
// and a refusal moves on to the next mirror. Every answer is written to disk,
// so a restart never costs a second round trip for the same square.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Bbox } from "../shared/geo";

const UA = "nukkad/0.2 (educational project; contact via repository)";

/**
 * Public Overpass servers, in the order they are asked. The main service is
 * fastest when it is up and rations per address; the others carry the load
 * when it is down, which happens.
 */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const RATIONED = (base: string) => base.includes("overpass-api.de");

export type OverpassElement = {
  id?: number;
  type?: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
};

// ---- one request at a time ---------------------------------------------------

type Job = { run: () => Promise<void>; urgent: boolean };
const waiting: Job[] = [];
let busy = false;

const pump = () => {
  if (busy) return;
  const next = waiting.find((j) => j.urgent) ?? waiting[0];
  if (!next) return;
  waiting.splice(waiting.indexOf(next), 1);
  busy = true;
  void next.run().finally(() => { busy = false; pump(); });
};

const queued = <T,>(job: () => Promise<T>, urgent: boolean): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    waiting.push({ urgent, run: () => job().then(resolve, reject) });
    pump();
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A mirror that just failed is not asked again for a while. */
const mirrorDownUntil = new Map<string, number>();
const MIRROR_REST_MS = 5 * 60 * 1000;

/** The main server says on its status page when the next slot opens. */
const slotWait = async (): Promise<number> => {
  try {
    const response = await fetch("https://overpass-api.de/api/status", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    if (/slots? available now/.test(text)) return 0;
    const waits = [...text.matchAll(/in (\d+) seconds/g)].map((m) => Number(m[1]));
    if (waits.length > 0) return Math.min(25_000, (Math.min(...waits) + 1) * 1000);
  } catch { /* fall through */ }
  return 5_000;
};

// ---- disk cache -------------------------------------------------------------

const CACHE_DIR = path.resolve(process.cwd(), ".cache", "overpass");
const CACHE_VERSION = "v3";
let cacheReady: Promise<void> | null = null;
const ensureCache = () => (cacheReady ??= mkdir(CACHE_DIR, { recursive: true }).then(() => undefined));

const cacheFile = (query: string) =>
  path.join(CACHE_DIR, createHash("sha1").update(CACHE_VERSION + query).digest("hex") + ".json");

const readCached = async (query: string): Promise<OverpassElement[] | null> => {
  try {
    await ensureCache();
    const raw = await readFile(cacheFile(query), "utf8");
    const parsed = JSON.parse(raw) as { at: number; elements: OverpassElement[] };
    // streets do not move much: a month is plenty
    if (Date.now() - parsed.at > 30 * 24 * 60 * 60 * 1000) return null;
    return parsed.elements;
  } catch {
    return null;
  }
};

const writeCached = async (query: string, elements: OverpassElement[]) => {
  try {
    await ensureCache();
    await writeFile(cacheFile(query), JSON.stringify({ at: Date.now(), elements }));
  } catch (caught) {
    console.warn("overpass cache write failed:", caught instanceof Error ? caught.message : caught);
  }
};

// ---- the query --------------------------------------------------------------

const ROAD_KINDS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|pedestrian|living_street|footway|service|cycleway|path|steps";

export const buildQuery = (b: Bbox) => {
  const box = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:90];(` +
    `way["highway"~"^(${ROAD_KINDS})$"](${box});` +
    `way["building"](${box});` +
    `way["natural"="water"](${box});way["waterway"="riverbank"](${box});relation["natural"="water"](${box});` +
    `way["leisure"~"^(park|garden|pitch|playground)$"](${box});way["landuse"~"^(grass|forest|meadow|recreation_ground|cemetery)$"](${box});` +
    `node["natural"="tree"](${box});` +
    `node["amenity"~"^(place_of_worship|cafe|restaurant|library|theatre|cinema|marketplace|fountain|school|university|hospital|bus_station)$"]["name"](${box});` +
    `node["railway"="station"]["name"](${box});node["tourism"~"^(attraction|museum|viewpoint)$"]["name"](${box});` +
    `);out geom;`;
};

/**
 * Fetch everything worth drawing inside a bounding box. Cached on disk; then
 * queued behind whatever else this process is asking Overpass for.
 */
export const fetchOsm = async (b: Bbox, urgent = true): Promise<OverpassElement[]> => {
  const query = buildQuery(b);
  const cached = await readCached(query);
  if (cached) return cached;

  return queued(async () => {
    // someone else may have filled the cache while we waited in the queue
    const again = await readCached(query);
    if (again) return again;

    let started = Date.now();
    const ask = async (base: string, timeoutMs: number): Promise<OverpassElement[] | number> => {
      const host = base.split("/")[2];
      started = Date.now();
      try {
        const response = await fetch(base, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
          const data = await response.json() as { elements?: OverpassElement[] };
          return Array.isArray(data.elements) ? data.elements : [];
        }
        console.warn(`overpass ${host} answered ${response.status} after ${Date.now() - started}ms`);
        return response.status;
      } catch (caught) {
        const cause = caught instanceof Error && caught.cause instanceof Error ? (caught.cause as NodeJS.ErrnoException).code ?? caught.cause.message : "";
        console.warn(`overpass ${host} failed after ${Date.now() - started}ms: ${caught instanceof Error ? caught.name : "error"} ${cause}`.trim());
        return 0;
      }
    };

    for (let round = 0; round < 3; round++) {
      let waited = false;
      for (const base of MIRRORS) {
        if ((mirrorDownUntil.get(base) ?? 0) > Date.now()) continue;
        const result = await ask(base, 75_000);
        if (Array.isArray(result)) {
          void writeCached(query, result);
          return result;
        }
        if (result === 0) {
          mirrorDownUntil.set(base, Date.now() + (RATIONED(base) ? 60_000 : MIRROR_REST_MS));
          if (Date.now() - started < 3_000) mirrorDownUntil.set(base, Date.now() + 60_000); // could not connect: try again soon
          continue;
        }
        if (result === 429 && RATIONED(base) && !waited) {
          waited = true;
          const wait = await slotWait();
          if (wait > 0) await sleep(wait);
        }
      }
    }
    throw new Error("The map service is busy. Try again in a moment.");
  }, urgent);
};

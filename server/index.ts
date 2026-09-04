// nukhadv2 server: a thin, cacheable front for OpenStreetMap, Google and Gemini.
//
// Keys stay here. The browser only ever sees projected metres, moderated text
// and proxied photographs.

import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  CORE_SPAN, MAX_TILE_INDEX, TILE_M, bboxAround, bboxOfTiles, tileKey,
  type CityData, type LatLon, type TileData,
} from "../shared/geo";
import { fetchOsm } from "./overpass";
import { capTile, collect, splitIntoTiles } from "./features";
import { geocode, shortLabel } from "./geocode";
import { moderate } from "./moderate";
import { streetView } from "./streetview";
import { geminiConfigured } from "./gemini";

const app = new Hono();
app.use("/api/*", cors());

const PORT = Number(process.env.PORT ?? 8787);

// ---- cities -------------------------------------------------------------------

/** Built cities, per process. The Overpass layer below caches on disk too. */
const cityCache = new Map<string, { at: number; data: CityData }>();
const tileCache = new Map<string, { at: number; data: TileData }>();
const CACHE_MS = 24 * 60 * 60 * 1000;

const centreId = (c: LatLon) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;

/** Build the initial square around a centre: one Overpass call, split into tiles. */
const buildCore = async (query: string, label: string, centre: LatLon): Promise<CityData> => {
  const elements = await fetchOsm(bboxAround(centre, CORE_SPAN * TILE_M), true);
  const found = collect(centre, elements);
  const tiles = splitIntoTiles(found, -CORE_SPAN, -CORE_SPAN, CORE_SPAN, CORE_SPAN);
  const capped = [...tiles.values()].map(capTile);
  for (const tile of capped) tileCache.set(`${centreId(centre)}:${tileKey(tile.cx, tile.cy)}`, { at: Date.now(), data: tile });
  return { query, label, centre, tiles: capped, span: CORE_SPAN };
};

/**
 * Tiles beyond the core are fetched two by two: a player moving in a straight
 * line asks for tiles in pairs anyway, and the rate limit is per request.
 */
const BLOCK = 2;
const pendingBlocks = new Map<string, Promise<void>>();

const buildTile = async (centre: LatLon, cx: number, cy: number, urgent = true): Promise<TileData> => {
  const id = (x: number, y: number) => `${centreId(centre)}:${tileKey(x, y)}`;
  const hit = tileCache.get(id(cx, cy));
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const bx = Math.floor(cx / BLOCK) * BLOCK;
  const by = Math.floor(cy / BLOCK) * BLOCK;
  const blockId = `${id(bx, by)}:block`;
  let pending = pendingBlocks.get(blockId);
  if (!pending) {
    pending = (async () => {
      const box = bboxOfTiles(centre, bx, by, bx + BLOCK, by + BLOCK);
      const found = collect(centre, await fetchOsm(box, urgent));
      const tiles = splitIntoTiles(found, bx, by, bx + BLOCK, by + BLOCK);
      for (const tile of tiles.values()) tileCache.set(id(tile.cx, tile.cy), { at: Date.now(), data: capTile(tile) });
    })().finally(() => pendingBlocks.delete(blockId));
    pendingBlocks.set(blockId, pending);
  }
  await pending;
  return tileCache.get(id(cx, cy))!.data;
};

/** Warm the ring just outside a fresh city, slowly, behind anything a player wants. */
const warming = new Set<string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const warmRing = (centre: LatLon) => {
  const key = centreId(centre);
  if (warming.has(key)) return;
  warming.add(key);
  const blocks: Array<{ x: number; y: number }> = [];
  const inner = -CORE_SPAN - BLOCK;
  const outer = CORE_SPAN;
  for (let x = inner; x <= outer; x += BLOCK) {
    for (let y = inner; y <= outer; y += BLOCK) {
      const inside = x >= -CORE_SPAN && x + BLOCK <= CORE_SPAN && y >= -CORE_SPAN && y + BLOCK <= CORE_SPAN;
      if (!inside) blocks.push({ x, y });
    }
  }
  blocks.sort((a, b) => Math.hypot(a.x + 1, a.y + 1) - Math.hypot(b.x + 1, b.y + 1));
  void (async () => {
    await sleep(30_000);
    for (const b of blocks) {
      try { await buildTile(centre, b.x, b.y, false); } catch { /* the player's own request will retry */ }
      await sleep(20_000);
    }
  })();
};

app.post("/api/city", async (c) => {
  let query = "";
  try {
    const body = await c.req.json() as { city?: string };
    query = String(body.city ?? "").trim();
  } catch {
    return c.json({ error: "invalid body" }, 400);
  }
  if (query.length < 2) return c.json({ error: "Name a city." }, 400);

  const key = query.toLowerCase();
  const hit = cityCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return c.json(hit.data);

  try {
    // "Lisbon @38.71,-9.14": a city built around a given point, for a link to a memory.
    const pinned = query.match(/^(.*?)\s*@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    const place = pinned
      ? { centre: { lat: Number(pinned[2]), lon: Number(pinned[3]) }, label: pinned[1].trim() || "Somewhere" }
      : await geocode(query);
    if (!place || !Number.isFinite(place.centre.lat) || !Number.isFinite(place.centre.lon)) {
      return c.json({ error: `No city called "${query}" was found.` }, 404);
    }
    const data = await buildCore(query, shortLabel(place.label), place.centre);
    const roads = data.tiles.reduce((n, t) => n + t.roads.length, 0);
    if (roads === 0) return c.json({ error: `OpenStreetMap has no street data around "${place.label}".` }, 422);

    cityCache.set(key, { at: Date.now(), data });
    warmRing(place.centre);
    return c.json(data);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not build that city.";
    return c.json({ error: message }, 502);
  }
});

app.post("/api/tile", async (c) => {
  let tile: { cx: number; cy: number };
  let centre: LatLon;
  try {
    const body = await c.req.json() as { tile?: { cx: number; cy: number }; centre?: LatLon };
    tile = { cx: Number(body.tile?.cx), cy: Number(body.tile?.cy) };
    centre = { lat: Number(body.centre?.lat), lon: Number(body.centre?.lon) };
  } catch {
    return c.json({ error: "invalid body" }, 400);
  }
  const sane = Number.isInteger(tile.cx) && Number.isInteger(tile.cy)
    && Math.abs(tile.cx) <= MAX_TILE_INDEX && Math.abs(tile.cy) <= MAX_TILE_INDEX
    && Number.isFinite(centre.lat) && Number.isFinite(centre.lon);
  if (!sane) return c.json({ error: "bad tile" }, 400);
  try {
    return c.json(await buildTile(centre, tile.cx, tile.cy));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not fetch that tile.";
    return c.json({ error: message }, 502);
  }
});

// ---- memories -----------------------------------------------------------------

app.post("/api/moderate", async (c) => {
  let body: Parameters<typeof moderate>[0];
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, reason: "invalid body" }, 400);
  }
  const verdict = await moderate(body);
  if (!verdict.ok) return c.json({ ok: false, reason: verdict.reason }, verdict.status as 400);
  return c.json({ ok: true, text: verdict.text, edited: verdict.edited, checked: verdict.checked });
});

app.get("/api/streetview", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return c.json({ error: "bad coordinates" }, 400);
  const result = await streetView(lat, lon);
  if (!result.ok) return c.json({ error: result.error }, result.status as 404);
  return new Response(result.bytes, {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-StreetView-Date": result.date,
    },
  });
});

app.get("/api/health", (c) => c.json({
  ok: true,
  gemini: geminiConfigured(),
  maps: Boolean(process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
  cities: cityCache.size,
  tiles: tileCache.size,
}));

// ---- the built client, in production -----------------------------------------

const dist = path.resolve(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use("/*", serveStatic({ root: "dist" }));
  app.get("*", serveStatic({ root: "dist", path: "index.html" }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`nukhadv2 server on http://localhost:${info.port}`);
  console.log(`  gemini: ${geminiConfigured() ? "on" : "off"}  maps: ${process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? "on" : "off"}  client: ${existsSync(dist) ? "dist/" : "vite dev"}`);
});

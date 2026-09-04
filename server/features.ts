// From Overpass elements to tiles of projected, de-cluttered features.

import {
  polygonArea, polylineLength, tileIndex, tileKey, toMetres,
  type Dot, type LatLon, type TileData, type Way,
} from "../shared/geo";
import type { OverpassElement } from "./overpass";

/**
 * Caps are per tile, so a dense city is dense everywhere rather than solid in
 * the middle and bare at the edge.
 */
const MAX_TILE_BUILDINGS = 450;
const MAX_TILE_ROADS = 260;
const MAX_TILE_TREES = 300;
const MAX_TILE_PLACES = 40;

/** Clutter, not city: a garage drawn as a block makes a street look crowded. */
const CLUTTER_BUILDING = new Set([
  "roof", "shed", "garage", "garages", "hut", "carport", "kiosk", "toilets", "shelter",
  "greenhouse", "container", "tent", "guardhouse", "transformer_tower", "service", "no",
]);
const MIN_BUILDING_M2 = 20;
/** Footway fragments — steps, crossings, paths across a car park — under this are noise. */
const MIN_MINOR_ROAD_M = 30;

const ROAD_RANK: Record<string, number> = {
  motorway: 0, trunk: 0, primary: 0, secondary: 1, tertiary: 1, unclassified: 2,
  residential: 2, living_street: 3, pedestrian: 3, service: 4, cycleway: 4, footway: 5, path: 5, steps: 6,
};
const roadRank = (way: Way) => ROAD_RANK[way.kind] ?? 3;
const MINOR = new Set(["footway", "path", "steps", "cycleway", "service"]);

export type Features = {
  roads: Way[]; buildings: Way[]; water: Way[]; parks: Way[]; trees: Dot[]; places: Dot[];
};

const emptyTile = (cx: number, cy: number): TileData =>
  ({ cx, cy, roads: [], buildings: [], water: [], parks: [], trees: [], places: [] });

/** Drop points within `tol` metres of the previous kept point. */
const simplify = (pts: number[], tol: number) => {
  if (pts.length <= 6) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length - 2; i += 2) {
    const dx = pts[i] - out[out.length - 2];
    const dy = pts[i + 1] - out[out.length - 1];
    if (Math.hypot(dx, dy) >= tol) out.push(pts[i], pts[i + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
};

const parseColour = (raw?: string): number | undefined => {
  if (!raw) return undefined;
  const hex = raw.trim().match(/^#?([0-9a-f]{6})$/i);
  if (hex) return parseInt(hex[1], 16);
  const named: Record<string, number> = {
    white: 0xf2efe8, black: 0x2b2b2b, grey: 0x9a9a9a, gray: 0x9a9a9a, red: 0xb5443a, brown: 0x8a5a3a,
    beige: 0xd8c8a8, yellow: 0xe0c36a, cream: 0xf0e6cc, orange: 0xd98a3c, pink: 0xe0a0b0, blue: 0x5a7fb0,
    green: 0x6f9a6a, tan: 0xc9ae86, silver: 0xbfc4c8, maroon: 0x7a2f2f, lightgrey: 0xc8c8c8, darkgrey: 0x6e6e6e,
  };
  return named[raw.trim().toLowerCase()];
};

const projectRing = (centre: LatLon, geometry: Array<{ lat: number; lon: number }>, tol: number) => {
  const pts: number[] = [];
  for (const p of geometry) {
    const m = toMetres(centre, p.lat, p.lon);
    pts.push(Math.round(m.x * 10) / 10, Math.round(m.y * 10) / 10);
  }
  return simplify(pts, tol);
};

const isClosed = (g: Array<{ lat: number; lon: number }>) =>
  g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

const project = (centre: LatLon, element: OverpassElement, tol: number): Way | null => {
  const geometry = element.geometry;
  if (!geometry || geometry.length < 2) return null;
  const tags = element.tags ?? {};
  const closed = isClosed(geometry);
  // drop the repeated closing point: the renderer closes rings itself
  const ring = closed ? geometry.slice(0, -1) : geometry;
  const pts = projectRing(centre, ring, tol);
  if (pts.length < 4) return null;
  const levels = tags["building:levels"] ? parseFloat(tags["building:levels"]) : undefined;
  const height = tags.height ? parseFloat(tags.height.replace(/[^\d.]/g, "")) : undefined;
  const lanes = tags.lanes ? parseInt(tags.lanes, 10) : undefined;
  const colour = parseColour(tags["building:colour"]);
  return {
    id: typeof element.id === "number" ? element.id : undefined,
    pts,
    kind: tags.highway || tags.amenity || tags.shop || tags.building || tags.natural || tags.leisure || tags.landuse || "other",
    name: tags.name,
    levels: Number.isFinite(levels) ? levels : undefined,
    height: Number.isFinite(height) ? height : undefined,
    lanes: Number.isFinite(lanes) ? lanes : undefined,
    roof: tags["roof:shape"],
    colour,
    area: closed || undefined,
  };
};

/** Everything worth drawing from a batch of Overpass elements, clutter removed. */
export const collect = (centre: LatLon, elements: OverpassElement[]): Features => {
  const out: Features = { roads: [], buildings: [], water: [], parks: [], trees: [], places: [] };
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type === "node") {
      if (typeof element.lat !== "number" || typeof element.lon !== "number") continue;
      const m = toMetres(centre, element.lat, element.lon);
      if (tags.natural === "tree") {
        out.trees.push({ x: Math.round(m.x), y: Math.round(m.y) });
      } else if (tags.name) {
        const kind = tags.railway === "station" ? "station" : tags.amenity || tags.tourism || "place";
        out.places.push({ x: Math.round(m.x), y: Math.round(m.y), kind, name: tags.name });
      }
      continue;
    }
    if (element.type === "relation") {
      // multipolygon water: keep the outer rings, each as its own polygon
      if (tags.natural !== "water") continue;
      for (const member of element.members ?? []) {
        if (member.role !== "outer" || !member.geometry || member.geometry.length < 4) continue;
        const ring = isClosed(member.geometry) ? member.geometry.slice(0, -1) : member.geometry;
        const pts = projectRing(centre, ring, 6);
        if (pts.length >= 6) out.water.push({ pts, kind: "water", name: tags.name, area: true });
      }
      continue;
    }
    if (tags.highway) {
      if (tags.area === "yes") continue;
      const way = project(centre, element, 3);
      if (!way) continue;
      way.area = undefined;
      if (MINOR.has(way.kind) && polylineLength(way.pts) < MIN_MINOR_ROAD_M) continue;
      out.roads.push(way);
    } else if (tags.building) {
      const way = project(centre, element, 1.5);
      if (!way || !way.area) continue;
      if (!way.name && (CLUTTER_BUILDING.has(tags.building) || polygonArea(way.pts) < MIN_BUILDING_M2)) continue;
      out.buildings.push(way);
    } else if (tags.natural === "water" || tags.waterway === "riverbank") {
      const way = project(centre, element, 6);
      if (way && way.area) out.water.push(way);
    } else if (tags.leisure || tags.landuse) {
      const way = project(centre, element, 6);
      if (way && way.area) out.parks.push(way);
    }
  }
  return out;
};

/** Where a way is filed: the tile its first point falls in, clamped to a range. */
const bucketAt = (tiles: Map<string, TileData>, x: number, y: number, clampX: (i: number) => number, clampY: (i: number) => number) => {
  const cx = clampX(tileIndex(x));
  const cy = clampY(tileIndex(y));
  const key = tileKey(cx, cy);
  let tile = tiles.get(key);
  if (!tile) { tile = emptyTile(cx, cy); tiles.set(key, tile); }
  return tile;
};

/** Bucket features into tiles covering [x0..x1) x [y0..y1), clamped inside. */
export const splitIntoTiles = (found: Features, x0: number, y0: number, x1: number, y1: number) => {
  const tiles = new Map<string, TileData>();
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) tiles.set(tileKey(x, y), emptyTile(x, y));
  const clampX = (i: number) => Math.max(x0, Math.min(x1 - 1, i));
  const clampY = (i: number) => Math.max(y0, Math.min(y1 - 1, i));
  const at = (x: number, y: number) => bucketAt(tiles, x, y, clampX, clampY);
  found.roads.forEach((w) => at(w.pts[0], w.pts[1]).roads.push(w));
  found.buildings.forEach((w) => at(w.pts[0], w.pts[1]).buildings.push(w));
  found.water.forEach((w) => at(w.pts[0], w.pts[1]).water.push(w));
  found.parks.forEach((w) => at(w.pts[0], w.pts[1]).parks.push(w));
  found.trees.forEach((t) => at(t.x, t.y).trees.push(t));
  found.places.forEach((t) => at(t.x, t.y).places.push(t));
  return tiles;
};

const nearness = (way: Way) => Math.hypot(way.pts[0], way.pts[1]);

/** What one tile may hold: the biggest buildings, the streets before the paths. */
export const capTile = (tile: TileData): TileData => ({
  ...tile,
  roads: [...tile.roads]
    .sort((a, b) =>
      (roadRank(a) - roadRank(b))
      || ((b.name ? 1 : 0) - (a.name ? 1 : 0))
      || (nearness(a) - nearness(b)))
    .slice(0, MAX_TILE_ROADS),
  buildings: [...tile.buildings]
    .sort((a, b) => polygonArea(b.pts) - polygonArea(a.pts))
    .slice(0, MAX_TILE_BUILDINGS),
  trees: tile.trees.slice(0, MAX_TILE_TREES),
  places: tile.places.slice(0, MAX_TILE_PLACES),
});

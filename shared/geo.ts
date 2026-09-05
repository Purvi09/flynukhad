// Shared geometry for nukkad.
//
// Everything the client draws is in *metres relative to the city centre*: x east,
// y south. The server projects once; the browser never touches lat/lon except to
// store a memory, which is pinned to the coordinates that never move.
//
// In the 3D scene, data (x, y) maps to three.js (x, z) with y being height.

export type LatLon = { lat: number; lon: number };

/** A polyline or polygon, already projected to local metres. */
export type Way = {
  /** OpenStreetMap id, so a way that straddles two tiles is drawn once. */
  id?: number;
  /** flat [x0,y0,x1,y1,...] in metres, x east, y south */
  pts: number[];
  /** highway / building / amenity / natural kind, see server/features.ts */
  kind: string;
  name?: string;
  /** storeys, where OSM knows them */
  levels?: number;
  /** metres, from the OSM height tag, where present */
  height?: number;
  /** lanes, for road width */
  lanes?: number;
  /** roof shape hint from OSM (flat, gabled, hipped, pyramidal, dome...) */
  roof?: string;
  /** building colour from OSM, as 0xRRGGBB, when tagged */
  colour?: number;
  /** true when the way is closed and should be treated as an area */
  area?: boolean;
};

/** A point feature: street trees, lamps, and named places. */
export type Dot = { x: number; y: number; kind?: string; name?: string };

export type TileData = {
  cx: number;
  cy: number;
  roads: Way[];
  buildings: Way[];
  water: Way[];
  parks: Way[];
  trees: Dot[];
  /** named amenities: a station, a temple, a cafe */
  places: Dot[];
};

export type CityData = {
  query: string;
  label: string;
  centre: LatLon;
  /** every tile in the initial square */
  tiles: TileData[];
  /** tile indices the initial payload covers: -span..span-1 */
  span: number;
};

/**
 * The city streams in square tiles as you move. The first payload covers the
 * tiles around the centre; the rest arrive on demand.
 */
export const TILE_M = 400;
/** Tiles are indexed -MAX..MAX in each direction; past that the map ends. */
export const MAX_TILE_INDEX = 8;
/** How far from the centre you may go. Inside the outermost tile ring. */
export const WORLD_LIMIT_M = (MAX_TILE_INDEX + 1) * TILE_M - 120;
/** The initial payload covers tiles -CORE_SPAN..CORE_SPAN-1 in each direction. */
export const CORE_SPAN = 3;

export const tileIndex = (metres: number) => Math.floor(metres / TILE_M);
export const tileKey = (cx: number, cy: number) => `${cx},${cy}`;

const M_PER_DEG_LAT = 110574;

export const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** lat/lon -> metres east/south of a centre point. */
export const toMetres = (centre: LatLon, lat: number, lon: number) => ({
  x: (lon - centre.lon) * mPerDegLon(centre.lat),
  y: (centre.lat - lat) * M_PER_DEG_LAT,
});

/** metres east/south of a centre -> lat/lon, the inverse of toMetres. */
export const toLatLon = (centre: LatLon, x: number, y: number): LatLon => ({
  lat: centre.lat - y / M_PER_DEG_LAT,
  lon: centre.lon + x / mPerDegLon(centre.lat),
});

export type Bbox = { south: number; west: number; north: number; east: number };

/** Bounding box of a radius in metres around a centre, as Overpass wants it. */
export const bboxAround = (centre: LatLon, radius: number): Bbox => {
  const dLat = radius / M_PER_DEG_LAT;
  const dLon = radius / mPerDegLon(centre.lat);
  return {
    south: centre.lat - dLat,
    west: centre.lon - dLon,
    north: centre.lat + dLat,
    east: centre.lon + dLon,
  };
};

/** Bounding box of a rectangle of tiles, in lat/lon. */
export const bboxOfTiles = (centre: LatLon, x0: number, y0: number, x1: number, y1: number): Bbox => {
  const a = toLatLon(centre, x0 * TILE_M, y0 * TILE_M);
  const b = toLatLon(centre, x1 * TILE_M, y1 * TILE_M);
  return {
    south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat),
    west: Math.min(a.lon, b.lon), east: Math.max(a.lon, b.lon),
  };
};

export const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

/** Polygon area in square metres (shoelace). */
export const polygonArea = (pts: number[]) => {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return Math.abs(a / 2);
};

export const polylineLength = (pts: number[]) => {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return l;
};

export const insidePolygon = (pts: number[], x: number, y: number) => {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1];
    const xj = pts[j * 2], yj = pts[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** "Old Delhi" and "old delhi" are the same request. */
export const cityKey = (query: string) =>
  query.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Slug used to file memories under a city, matching the original schema. */
export const citySlug = (label: string) =>
  label.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

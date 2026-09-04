// From projected map data to three.js geometry.
//
// One merged mesh per feature class per tile: all of a tile's buildings are a
// single draw call, all its roads another, and so on. Colour lives in vertex
// attributes so a single material serves every building in the city.
//
// Data (x, y south) becomes world (x, height, z).

import * as THREE from "three";
import earcut from "earcut";
import { polygonArea, type Dot, type TileData, type Way } from "@shared/geo";

// ---- palette ----------------------------------------------------------------

export const LAND = 0xcfc8b8;
const ROAD: Record<string, { fill: number; width: number; kerb?: number }> = {
  motorway: { fill: 0x5f6670, width: 16, kerb: 0xb9b4a8 },
  trunk: { fill: 0x62696f, width: 14, kerb: 0xb9b4a8 },
  primary: { fill: 0x686f76, width: 12, kerb: 0xbdb8ac },
  secondary: { fill: 0x6f767c, width: 10, kerb: 0xbdb8ac },
  tertiary: { fill: 0x767d83, width: 8, kerb: 0xc2bdb0 },
  unclassified: { fill: 0x7d848a, width: 7, kerb: 0xc2bdb0 },
  residential: { fill: 0x7d848a, width: 7, kerb: 0xc2bdb0 },
  living_street: { fill: 0x8a8f93, width: 6 },
  pedestrian: { fill: 0xa8a39a, width: 6 },
  service: { fill: 0x8a9096, width: 4 },
  cycleway: { fill: 0x8c7f8c, width: 2.5 },
  footway: { fill: 0xb7b0a2, width: 2.2 },
  path: { fill: 0xb0a48e, width: 2 },
  steps: { fill: 0xa79f90, width: 2.5 },
};
const DEFAULT_ROAD = { fill: 0x7d848a, width: 6 };

const PARK: Record<string, number> = {
  park: 0x7fae66, garden: 0x86b470, pitch: 0x76a85e, playground: 0x9bbf7a, grass: 0x8dba74,
  forest: 0x5f8f4e, meadow: 0x9dbd72, recreation_ground: 0x84b06a, cemetery: 0x8faa7a,
};
const WATER = 0x4f93c9;

/** Wall colours by building kind. */
const WALLS: Record<string, number> = {
  apartments: 0xe3d5c2, residential: 0xe5d9c8, house: 0xf0e6d4, detached: 0xf0e6d4, terrace: 0xe6d4be,
  semidetached_house: 0xf0e6d4, bungalow: 0xf2e9d8, commercial: 0xd6dbe2, retail: 0xdccbb8, office: 0xc9d3de,
  industrial: 0xc6c1b6, warehouse: 0xbfbab0, school: 0xe8dcc0, university: 0xe0d2b8, hospital: 0xeef0ea,
  church: 0xe9e3d3, cathedral: 0xe5dccb, mosque: 0xf1ecdf, temple: 0xe6cfa8, synagogue: 0xe9e3d3,
  hotel: 0xe0d0c8, train_station: 0xd2d7dc, public: 0xdad4c6, civic: 0xdad4c6, government: 0xd8d2c4,
  garage: 0xc9c6bd, roof: 0xc9c6bd, yes: 0xe2d8c6,
};
const DEFAULT_WALL = 0xe2d8c6;
const ROOFS = [0xb5624a, 0xc0735a, 0xa96a55, 0xb9856a, 0x9a9790, 0x8d9094, 0xa89c88, 0x7f868d, 0xb07a62, 0x968b7e];

/** Storeys by building kind when OSM does not say. */
const LEVELS: Record<string, number> = {
  apartments: 5, residential: 3, house: 2, detached: 2, terrace: 3, semidetached_house: 2, bungalow: 1,
  commercial: 4, retail: 3, office: 6, industrial: 2, warehouse: 2, school: 2, university: 3, hospital: 5,
  church: 4, cathedral: 8, mosque: 4, temple: 4, hotel: 6, train_station: 3, public: 3, civic: 3, government: 4,
  garage: 1, roof: 1, shed: 1, hut: 1, yes: 3,
};
const STOREY_M = 3.1;
const MAX_HEIGHT = 160;

/** Deterministic noise from a seed, so a building looks the same each visit. */
const hash = (n: number) => {
  let h = (n | 0) * 2654435761;
  h = ((h ^ (h >>> 16)) * 0x45d9f3b) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const buildingHeight = (way: Way, seed: number): number => {
  if (way.height && way.height > 1.5) return Math.min(MAX_HEIGHT, way.height);
  if (way.levels && way.levels > 0) return Math.min(MAX_HEIGHT, way.levels * STOREY_M + 1);
  const base = LEVELS[way.kind] ?? 3;
  const area = polygonArea(way.pts);
  // a big footprint tends to be a taller block; a tiny one a house
  const bump = area > 2000 ? 2 : area > 800 ? 1 : area < 60 ? -1 : 0;
  const levels = Math.max(1, base + bump + Math.round((hash(seed) - 0.5) * 2));
  return Math.min(MAX_HEIGHT, levels * STOREY_M + 0.8);
};

// ---- buffers -----------------------------------------------------------------

class Buffer {
  positions: number[] = [];
  normals: number[] = [];
  colours: number[] = [];
  uvs: number[] = [];
  private c = new THREE.Color();

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, colour: number, shade = 1, u = 0, v = 0) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.c.setHex(colour).multiplyScalar(shade);
    this.colours.push(this.c.r, this.c.g, this.c.b);
    this.uvs.push(u, v);
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colours, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Shoelace with data (x, y): positive when the ring is counter-clockwise on paper. */
const signedArea = (pts: number[]) => {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
};

/** A ring in a fixed orientation, with a repeated closing point removed. */
const normaliseRing = (pts: number[]) => {
  let ring = pts;
  if (ring.length >= 4 && ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1]) ring = ring.slice(0, -2);
  if (signedArea(ring) < 0) {
    const flipped: number[] = [];
    for (let i = ring.length - 2; i >= 0; i -= 2) flipped.push(ring[i], ring[i + 1]);
    ring = flipped;
  }
  return ring;
};

/** Triangulate a flat polygon at height y, facing up. */
const addCap = (buf: Buffer, ring: number[], y: number, colour: number, shade = 1) => {
  const tris = earcut(ring);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ax = ring[a * 2], az = ring[a * 2 + 1];
    const bx = ring[b * 2], bz = ring[b * 2 + 1];
    const cx = ring[c * 2], cz = ring[c * 2 + 1];
    // face up: flip the triangle if its normal points down
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny >= 0) {
      buf.vertex(ax, y, az, 0, 1, 0, colour, shade);
      buf.vertex(bx, y, bz, 0, 1, 0, colour, shade);
      buf.vertex(cx, y, cz, 0, 1, 0, colour, shade);
    } else {
      buf.vertex(ax, y, az, 0, 1, 0, colour, shade);
      buf.vertex(cx, y, cz, 0, 1, 0, colour, shade);
      buf.vertex(bx, y, bz, 0, 1, 0, colour, shade);
    }
  }
};

/** Walls from y0 to y1 around a ring whose shoelace area is positive. */
const addWalls = (buf: Buffer, ring: number[], y0: number, y1: number, colour: number, seed: number) => {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = ring[i * 2], zi = ring[i * 2 + 1];
    const xj = ring[j * 2], zj = ring[j * 2 + 1];
    const dx = xj - xi, dz = zj - zi;
    const len = Math.hypot(dx, dz) || 1;
    // positive-area ring in (x,z): interior is to the left, outward is (dz, -dx)
    const nx = dz / len, nz = -dx / len;
    // light from the north-west: faces facing it are brighter
    const shade = 0.82 + 0.18 * Math.max(0, (nx * 0.55 + nz * 0.65 + 1) / 2) + (hash(seed + i) - 0.5) * 0.04;
    // the texture holds WINDOWS_PER_TILE bays across and storeys up
    const u0 = hash(seed * 3 + i) * 4, u1 = u0 + len / WINDOW_M / WINDOWS_PER_TILE;
    const v0 = 0, v1 = (y1 - y0) / STOREY_M / WINDOWS_PER_TILE;
    const p0 = [xi, y0, zi, u0, v0], p1 = [xj, y0, zj, u1, v0], p2 = [xj, y1, zj, u1, v1], p3 = [xi, y1, zi, u0, v1];
    for (const [x, y, z, u, v] of [p0, p3, p1, p1, p3, p2]) buf.vertex(x, y, z, nx, 0, nz, colour, shade, u, v);
  }
};

/** Metres of wall per window bay, and bays per repeat of the facade texture. */
const WINDOW_M = 3.6;
const WINDOWS_PER_TILE = 4;

/** A pyramid or hip from the ring up to an apex, for small buildings tagged that way. */
const addApexRoof = (buf: Buffer, ring: number[], y: number, apexY: number, colour: number) => {
  const n = ring.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += ring[i * 2]; cz += ring[i * 2 + 1]; }
  cx /= n; cz /= n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const bx = ring[j * 2], bz = ring[j * 2 + 1];
    const ux = bx - ax, uy = 0, uz = bz - az;
    const vx = cx - ax, vy = apexY - y, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const shade = 0.85 + 0.15 * Math.max(0, (nx * 0.55 + nz * 0.65 + 1) / 2);
    // winding so the face points up: (a, apex, b) with a positive ring
    buf.vertex(ax, y, az, nx, ny, nz, colour, shade);
    buf.vertex(cx, apexY, cz, nx, ny, nz, colour, shade);
    buf.vertex(bx, y, bz, nx, ny, nz, colour, shade);
  }
};

// ---- buildings --------------------------------------------------------------

export type Solid = { pts: number[]; height: number; minX: number; maxX: number; minZ: number; maxZ: number; name?: string; kind: string };

export const buildBuildings = (tile: TileData): { walls: THREE.BufferGeometry | null; roofs: THREE.BufferGeometry | null; solids: Solid[] } => {
  const buf = new Buffer();
  const roofBuf = new Buffer();
  const solids: Solid[] = [];
  for (const way of tile.buildings) {
    if (way.pts.length < 6) continue;
    const ring = normaliseRing(way.pts);
    if (ring.length < 6) continue;
    const seed = way.id ?? Math.round(ring[0] * 7 + ring[1] * 13);
    const height = buildingHeight(way, seed);
    const wall = way.colour !== undefined ? mixColour(way.colour, DEFAULT_WALL, 0.45) : (WALLS[way.kind] ?? DEFAULT_WALL);
    const roofColour = way.colour !== undefined ? mixColour(way.colour, 0x8d939b, 0.5) : ROOFS[Math.floor(hash(seed + 99) * ROOFS.length)];
    const tinted = mixColour(wall, 0xffffff, hash(seed + 7) * 0.12);

    addWalls(buf, ring, 0, height, tinted, seed);
    const apex = (way.roof === "pyramidal" || way.roof === "hipped" || (way.roof === "gabled" && ring.length <= 8)) && ring.length <= 12;
    if (apex) {
      addCap(roofBuf, ring, height, roofColour, 0.9);
      addApexRoof(roofBuf, ring, height, height + Math.min(6, 2 + Math.sqrt(polygonArea(ring)) * 0.18), roofColour);
    } else {
      addCap(roofBuf, ring, height, roofColour, 0.95);
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    solids.push({ pts: ring, height, minX, maxX, minZ, maxZ, name: way.name, kind: way.kind });
  }
  return { walls: buf.geometry(), roofs: roofBuf.geometry(), solids };
};

const mixColour = (a: number, b: number, t: number) => {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.lerp(cb, t).getHex();
};

// ---- roads -------------------------------------------------------------------

export type RoadSeg = { x1: number; z1: number; x2: number; z2: number; name?: string; kind: string; width: number };

/** A ribbon along a polyline, with mitred joins so there are no gaps. */
const addRibbon = (buf: Buffer, pts: number[], width: number, y: number, colour: number) => {
  const n = pts.length / 2;
  if (n < 2) return;
  const half = width / 2;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
    const qx = pts[Math.min(n - 1, i + 1) * 2], qz = pts[Math.min(n - 1, i + 1) * 2 + 1];
    let dx = qx - px, dz = qz - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // miter: average of the two segment directions, scaled to keep the width
    let mx = -dz, mz = dx;
    if (i > 0 && i < n - 1) {
      const ax = x - px, az = z - pz, al = Math.hypot(ax, az) || 1;
      const bx = qx - x, bz = qz - z, bl = Math.hypot(bx, bz) || 1;
      const nax = -az / al, naz = ax / al;
      const nbx = -bz / bl, nbz = bx / bl;
      mx = nax + nbx; mz = naz + nbz;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const cos = mx * nax + mz * naz;
      const scale = Math.min(2.5, 1 / Math.max(0.4, cos));
      mx *= scale; mz *= scale;
    }
    left.push(x + mx * half, z + mz * half);
    right.push(x - mx * half, z - mz * half);
  }
  for (let i = 0; i < n - 1; i++) {
    const lx0 = left[i * 2], lz0 = left[i * 2 + 1], lx1 = left[i * 2 + 2], lz1 = left[i * 2 + 3];
    const rx0 = right[i * 2], rz0 = right[i * 2 + 1], rx1 = right[i * 2 + 2], rz1 = right[i * 2 + 3];
    // two triangles, facing up
    const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (ny >= 0) { buf.vertex(ax, y, az, 0, 1, 0, colour); buf.vertex(bx, y, bz, 0, 1, 0, colour); buf.vertex(cx, y, cz, 0, 1, 0, colour); }
      else { buf.vertex(ax, y, az, 0, 1, 0, colour); buf.vertex(cx, y, cz, 0, 1, 0, colour); buf.vertex(bx, y, bz, 0, 1, 0, colour); }
    };
    tri(lx0, lz0, rx0, rz0, lx1, lz1);
    tri(rx0, rz0, rx1, rz1, lx1, lz1);
  }
};

const roadStyle = (way: Way) => {
  const style = ROAD[way.kind] ?? DEFAULT_ROAD;
  const lanes = way.lanes && way.lanes > 0 && way.lanes < 10 ? way.lanes : 0;
  const width = lanes ? Math.max(style.width, lanes * 3.2) : style.width;
  return { ...style, width };
};

export const buildRoads = (tile: TileData): { geometry: THREE.BufferGeometry | null; segments: RoadSeg[] } => {
  const buf = new Buffer();
  const segments: RoadSeg[] = [];
  // kerbs first, lower and wider; then the roads on top, main roads highest
  const ordered = [...tile.roads].sort((a, b) => roadStyle(a).width - roadStyle(b).width);
  for (const way of ordered) {
    const style = roadStyle(way);
    if (style.kerb) addRibbon(buf, way.pts, style.width + 4, 0.04, style.kerb);
  }
  for (const way of ordered) {
    const style = roadStyle(way);
    const y = 0.06 + Math.min(0.06, style.width * 0.004);
    addRibbon(buf, way.pts, style.width, y, style.fill);
    for (let i = 0; i < way.pts.length - 2; i += 2) {
      segments.push({ x1: way.pts[i], z1: way.pts[i + 1], x2: way.pts[i + 2], z2: way.pts[i + 3], name: way.name, kind: way.kind, width: style.width });
    }
  }
  return { geometry: buf.geometry(), segments };
};

// ---- areas -------------------------------------------------------------------

export const buildAreas = (tile: TileData): THREE.BufferGeometry | null => {
  const buf = new Buffer();
  for (const way of tile.parks) {
    if (way.pts.length < 6) continue;
    addCap(buf, normaliseRing(way.pts), 0.02, PARK[way.kind] ?? 0x86b470);
  }
  for (const way of tile.water) {
    if (way.pts.length < 6) continue;
    addCap(buf, normaliseRing(way.pts), 0.03, WATER);
  }
  return buf.geometry();
};

// ---- trees -------------------------------------------------------------------

const dummy = new THREE.Object3D();

/** One instanced mesh per part of the tree model (trunk, canopy), sharing placements. */
export const buildTrees = (tile: TileData, parts: THREE.Mesh[]): THREE.InstancedMesh[] => {
  const trees: Dot[] = tile.trees;
  if (trees.length === 0 || parts.length === 0) return [];
  const matrices: THREE.Matrix4[] = trees.map((t) => {
    const s = 0.8 + hash(t.x * 31 + t.y * 17) * 0.7;
    dummy.position.set(t.x, 0, t.y);
    dummy.rotation.set(0, hash(t.x * 3 + t.y * 5) * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.9 + hash(t.x + t.y * 9) * 0.3), s);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
  return parts.map((part) => {
    const instanced = new THREE.InstancedMesh(part.geometry, part.material, trees.length);
    instanced.castShadow = true;
    instanced.receiveShadow = false;
    matrices.forEach((m, i) => instanced.setMatrixAt(i, m));
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    return instanced;
  });
};

/** One material for everything flat with vertex colours. */
export const cityMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true });

/** Walls: the vertex colour tinted by a repeating grid of windows. */
export const facadeMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeTexture() });

/**
 * A texture of WINDOWS_PER_TILE x WINDOWS_PER_TILE window bays, white where
 * the wall shows through and darker where a window is, so the building's own
 * colour does the rest. The ground row is doors and shopfronts.
 */
const facadeTexture = () => {
  const size = 512;
  const cell = size / WINDOWS_PER_TILE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  for (let row = 0; row < WINDOWS_PER_TILE; row++) {
    for (let col = 0; col < WINDOWS_PER_TILE; col++) {
      const x = col * cell, y = size - (row + 1) * cell; // v grows upward
      if (row === 0) {
        // ground floor: a tall door or shopfront
        const wide = (col % 2) === 0;
        const w = wide ? cell * 0.62 : cell * 0.3;
        g.fillStyle = "#7d8790";
        g.fillRect(x + (cell - w) / 2, y + cell * 0.22, w, cell * 0.78);
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(x + (cell - w) / 2 + 3, y + cell * 0.26, w - 6, cell * 0.3);
      } else {
        const w = cell * 0.42, h = cell * 0.5;
        const wx = x + (cell - w) / 2, wy = y + cell * 0.24;
        g.fillStyle = "#6f7d8c";
        g.fillRect(wx, wy, w, h);
        // a sky reflection at the top, a sill below
        g.fillStyle = "rgba(255,255,255,0.32)";
        g.fillRect(wx + 2, wy + 2, w - 4, h * 0.35);
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.fillRect(wx - 2, wy + h, w + 4, 3);
        // frame cross
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.fillRect(wx + w / 2 - 1, wy, 2, h);
        g.fillRect(wx, wy + h / 2 - 1, w, 2);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
};

// Where the pod may not go: inside buildings, under the street, above the sky.
//
// Buildings are extruded polygons in a spatial hash. The pod is a sphere. Each
// step, the sphere is pushed out of any building it overlaps and its velocity
// loses the component that was heading in.

import { insidePolygon } from "@shared/geo";
import type { Solid, RoadSeg } from "./build";
import type { Dot } from "@shared/geo";

const CELL = 48;
export const FLOOR = 1.4;
export const CEILING = 420;

type Entry<T> = { tile: string; item: T };

class Hash<T extends { minX: number; maxX: number; minZ: number; maxZ: number }> {
  private cells = new Map<string, Entry<T>[]>();
  private byTile = new Map<string, Set<string>>();

  add(tile: string, item: T) {
    let cells = this.byTile.get(tile);
    if (!cells) { cells = new Set(); this.byTile.set(tile, cells); }
    for (let cx = Math.floor(item.minX / CELL); cx <= Math.floor(item.maxX / CELL); cx++) {
      for (let cz = Math.floor(item.minZ / CELL); cz <= Math.floor(item.maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        let list = this.cells.get(key);
        if (!list) { list = []; this.cells.set(key, list); }
        list.push({ tile, item });
        cells.add(key);
      }
    }
  }

  removeTile(tile: string) {
    const cells = this.byTile.get(tile);
    if (!cells) return;
    for (const key of cells) {
      const list = this.cells.get(key);
      if (!list) continue;
      const kept = list.filter((e) => e.tile !== tile);
      if (kept.length) this.cells.set(key, kept); else this.cells.delete(key);
    }
    this.byTile.delete(tile);
  }

  /** Items whose bounds might overlap a box. May repeat an item across cells. */
  near(minX: number, maxX: number, minZ: number, maxZ: number, out: T[] = []) {
    const seen = new Set<T>();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = this.cells.get(`${cx},${cz}`);
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e.item)) continue;
          seen.add(e.item);
          if (e.item.maxX < minX || e.item.minX > maxX || e.item.maxZ < minZ || e.item.minZ > maxZ) continue;
          out.push(e.item);
        }
      }
    }
    return out;
  }
}

type SegEntry = RoadSeg & { minX: number; maxX: number; minZ: number; maxZ: number };
type PlaceEntry = Dot & { minX: number; maxX: number; minZ: number; maxZ: number };

export type Body = { x: number; y: number; z: number; vx: number; vy: number; vz: number; radius: number };

export class World {
  private solids = new Hash<Solid>();
  private roads = new Hash<SegEntry>();
  private places = new Hash<PlaceEntry>();

  addTile(key: string, solids: Solid[], segments: RoadSeg[], places: Dot[]) {
    for (const s of solids) this.solids.add(key, s);
    for (const s of segments) {
      this.roads.add(key, {
        ...s,
        minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2),
        minZ: Math.min(s.z1, s.z2), maxZ: Math.max(s.z1, s.z2),
      });
    }
    for (const p of places) this.places.add(key, { ...p, minX: p.x, maxX: p.x, minZ: p.y, maxZ: p.y });
  }

  removeTile(key: string) {
    this.solids.removeTile(key);
    this.roads.removeTile(key);
    this.places.removeTile(key);
  }

  /**
   * Push a body out of anything it overlaps. Returns true when it hit something.
   */
  resolve(body: Body): boolean {
    let hit = false;
    const r = body.radius;

    if (body.y < FLOOR + r) { body.y = FLOOR + r; if (body.vy < 0) body.vy = 0; hit = true; }
    if (body.y > CEILING) { body.y = CEILING; if (body.vy > 0) body.vy = 0; }

    const candidates = this.solids.near(body.x - r, body.x + r, body.z - r, body.z + r);
    for (const s of candidates) {
      if (body.y - r > s.height) continue;
      const inside = insidePolygon(s.pts, body.x, body.z);
      const edge = nearestEdge(s.pts, body.x, body.z);
      if (inside) {
        // choose the cheaper escape: up through the roof, or out the nearest wall
        const upDist = s.height + r - body.y;
        if (upDist < edge.dist + r && upDist < 6) {
          body.y = s.height + r;
          if (body.vy < 0) body.vy = 0;
        } else {
          body.x = edge.x + edge.nx * r;
          body.z = edge.z + edge.nz * r;
          slide(body, edge.nx, edge.nz);
        }
        hit = true;
      } else if (edge.dist < r) {
        body.x = edge.x + edge.nx * r;
        body.z = edge.z + edge.nz * r;
        slide(body, edge.nx, edge.nz);
        hit = true;
      }
    }
    return hit;
  }

  /** Whether a point is inside a building, for placing things. */
  blocked(x: number, z: number, y = 0) {
    for (const s of this.solids.near(x, x, z, z)) if (y < s.height && insidePolygon(s.pts, x, z)) return true;
    return false;
  }

  /** The building right under or around a point, if any. */
  buildingAt(x: number, z: number, within = 4): Solid | null {
    for (const s of this.solids.near(x - within, x + within, z - within, z + within)) {
      if (insidePolygon(s.pts, x, z) || nearestEdge(s.pts, x, z).dist < within) return s;
    }
    return null;
  }

  /** The nearest street: name and distance, within a radius. */
  street(x: number, z: number, within = 70): { name: string | null; kind: string; dist: number } | null {
    let best: { name: string | null; kind: string; dist: number } | null = null;
    for (const s of this.roads.near(x - within, x + within, z - within, z + within)) {
      const d = segmentDistance(s.x1, s.z1, s.x2, s.z2, x, z) - s.width / 2;
      if (!best || d < best.dist) best = { name: s.name ?? null, kind: s.kind, dist: d };
    }
    if (!best || best.dist > within) return null;
    return best;
  }

  /** The nearest named street specifically, since the closest road is often an unnamed path. */
  namedStreet(x: number, z: number, within = 90): { name: string; dist: number } | null {
    let best: { name: string; dist: number } | null = null;
    for (const s of this.roads.near(x - within, x + within, z - within, z + within)) {
      if (!s.name) continue;
      const d = segmentDistance(s.x1, s.z1, s.x2, s.z2, x, z);
      if (!best || d < best.dist) best = { name: s.name, dist: d };
    }
    return best && best.dist <= within ? best : null;
  }

  /** Road segments around a point, for the minimap. */
  segmentsNear(x: number, z: number, range: number): RoadSeg[] {
    return this.roads.near(x - range, x + range, z - range, z + range);
  }

  /** The nearest named place: a station, a temple, a cafe. */
  place(x: number, z: number, within = 60): { name: string; kind: string; dist: number } | null {
    let best: { name: string; kind: string; dist: number } | null = null;
    for (const p of this.places.near(x - within, x + within, z - within, z + within)) {
      const d = Math.hypot(p.x - x, p.y - z);
      if (!best || d < best.dist) best = { name: p.name ?? "", kind: p.kind ?? "place", dist: d };
    }
    return best && best.dist <= within && best.name ? best : null;
  }
}

const slide = (body: Body, nx: number, nz: number) => {
  const into = body.vx * nx + body.vz * nz;
  if (into < 0) { body.vx -= into * nx; body.vz -= into * nz; }
};

const segmentDistance = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
};

/** The closest point on a ring's outline, with the outward normal there. */
const nearestEdge = (pts: number[], px: number, pz: number) => {
  const n = pts.length / 2;
  let best = { dist: Infinity, x: px, z: pz, nx: 1, nz: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1];
    const bx = pts[j * 2], bz = pts[j * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    const cx = ax + dx * t, cz = az + dz * t;
    const d = Math.hypot(cx - px, cz - pz);
    if (d < best.dist) {
      const l = Math.sqrt(l2) || 1;
      // rings are normalised to positive shoelace area: outward is (dz, -dx)
      best = { dist: d, x: cx, z: cz, nx: dz / l, nz: -dx / l };
    }
  }
  return best;
};

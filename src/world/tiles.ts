// The city, tile by tile, around wherever the pod is.
//
// Tiles near the pod are fetched and built; tiles far behind it are dropped.
// Building is one tile per frame at most, so a fast pod never stalls the loop.

import * as THREE from "three";
import { MAX_TILE_INDEX, TILE_M, tileIndex, tileKey, type CityData, type LatLon, type TileData } from "@shared/geo";
import { buildAreas, buildBuildings, buildRoads, buildTrees, cityMaterial, facadeMaterial } from "./build";
import { World } from "./collision";
import { textSprite } from "../scene/text";
import { fetchTile } from "../net/api";

const LOAD_RANGE = 850;
const UNLOAD_RANGE = 1300;
const MAX_IN_FLIGHT = 2;
const LABEL_RANGE = 320;
/** The same street name is not repeated within this distance. */
const NAME_SPACING = 260;
const MAX_LABELS = 16;
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const PLACE_ICON: Record<string, string> = {
  station: "🚉", place_of_worship: "⛪", cafe: "☕", restaurant: "🍽", library: "📚", theatre: "🎭", cinema: "🎬",
  marketplace: "🧺", fountain: "⛲", school: "🏫", university: "🎓", hospital: "🏥", bus_station: "🚌",
  attraction: "★", museum: "🏛", viewpoint: "👁",
};

type Label = { sprite: THREE.Sprite; x: number; z: number; major: boolean; minor?: boolean; tile: string };
/** Everyday places show only when you are nearly on top of them. */
const MINOR_PLACE = new Set(["cafe", "restaurant"]);

type Loaded = { key: string; group: THREE.Group; labels: Label[] };

export class TileStreamer {
  readonly group = new THREE.Group();
  readonly world = new World();
  private store = new Map<string, TileData>();
  private loaded = new Map<string, Loaded>();
  private inFlight = new Set<string>();
  private retryAt = new Map<string, number>();
  private queue: TileData[] = [];
  /** way id -> tile that drew it, so a way straddling tiles is drawn once */
  private owned = new Map<number, string>();
  private labels: Label[] = [];
  private labelClock = 0;
  /** where each street name already has a label, so a long road is named once per stretch */
  private named = new Map<string, Array<{ x: number; z: number; tile: string }>>();
  private material = cityMaterial();
  private facade = facadeMaterial();
  private centre: LatLon;
  private treeParts: THREE.Mesh[] = [];
  private stats = { roads: 0, buildings: 0, trees: 0 };
  onStatus?: (text: string) => void;

  constructor(city: CityData, treeParts: THREE.Mesh[]) {
    this.centre = city.centre;
    this.treeParts = treeParts;
    for (const tile of city.tiles) this.store.set(tileKey(tile.cx, tile.cy), tile);
    // empty core tiles are still known, so they are never fetched again
    for (let cx = -city.span; cx < city.span; cx++) {
      for (let cy = -city.span; cy < city.span; cy++) {
        const key = tileKey(cx, cy);
        if (!this.store.has(key)) this.store.set(key, { cx, cy, roads: [], buildings: [], water: [], parks: [], trees: [], places: [] });
      }
    }
  }

  get counts() { return { ...this.stats, tiles: this.loaded.size }; }

  /** Build everything already known within range, before the first frame. */
  prime(x: number, z: number) {
    this.want(x, z, true);
    while (this.queue.length) this.build(this.queue.shift()!);
  }

  update(dt: number, x: number, z: number, elapsed: number) {
    for (const [key, tile] of this.loaded) {
      const [cx, cy] = key.split(",").map(Number);
      if (edgeDistance(cx, cy, x, z) > UNLOAD_RANGE) this.remove(tile);
    }
    this.want(x, z, false);
    if (this.queue.length) this.build(this.queue.shift()!);
    this.labelClock += dt;
    if (this.labelClock > 0.2) { this.labelClock = 0; this.updateLabels(x, z, elapsed); }
  }

  private want(x: number, z: number, sync: boolean) {
    const span = Math.ceil(LOAD_RANGE / TILE_M) + 1;
    const c = tileIndex(x), d = tileIndex(z);
    const wanted: Array<{ cx: number; cy: number; dist: number }> = [];
    for (let cx = c - span; cx <= c + span; cx++) {
      for (let cy = d - span; cy <= d + span; cy++) {
        if (Math.abs(cx) > MAX_TILE_INDEX || Math.abs(cy) > MAX_TILE_INDEX) continue;
        const dist = edgeDistance(cx, cy, x, z);
        if (dist <= LOAD_RANGE) wanted.push({ cx, cy, dist });
      }
    }
    wanted.sort((a, b) => a.dist - b.dist);
    for (const w of wanted) {
      const key = tileKey(w.cx, w.cy);
      if (this.loaded.has(key) || this.inFlight.has(key) || this.queue.some((t) => tileKey(t.cx, t.cy) === key)) continue;
      const known = this.store.get(key);
      if (known) { this.queue.push(known); continue; }
      if (sync) continue;
      if ((this.retryAt.get(key) ?? 0) > Date.now()) continue;
      if (this.inFlight.size >= MAX_IN_FLIGHT) break;
      this.inFlight.add(key);
      this.onStatus?.("streaming the next block…");
      fetchTile(this.centre, w.cx, w.cy)
        .then((data) => { this.store.set(key, data); this.queue.push(data); })
        .catch(() => this.retryAt.set(key, Date.now() + 15_000))
        .finally(() => { this.inFlight.delete(key); if (this.inFlight.size === 0) this.onStatus?.(""); });
    }
  }

  private build(tile: TileData) {
    const key = tileKey(tile.cx, tile.cy);
    if (this.loaded.has(key)) return;
    // skip ways another loaded tile already drew
    const mine = (id?: number) => {
      if (id === undefined) return true;
      const owner = this.owned.get(id);
      if (owner && owner !== key && this.loaded.has(owner)) return false;
      this.owned.set(id, key);
      return true;
    };
    const slice: TileData = {
      ...tile,
      roads: tile.roads.filter((w) => mine(w.id)),
      buildings: tile.buildings.filter((w) => mine(w.id)),
    };

    const group = new THREE.Group();
    group.name = key;
    const buildings = buildBuildings(slice);
    if (buildings.walls) {
      const mesh = new THREE.Mesh(buildings.walls, this.facade);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (buildings.roofs) {
      const mesh = new THREE.Mesh(buildings.roofs, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const roads = buildRoads(slice);
    if (roads.geometry) {
      const mesh = new THREE.Mesh(roads.geometry, this.material);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const areas = buildAreas(slice);
    if (areas) {
      const mesh = new THREE.Mesh(areas, this.material);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const trees of buildTrees(slice, this.treeParts)) group.add(trees);

    // register solids first: place labels sit on top of the building they belong to
    this.world.addTile(key, buildings.solids, roads.segments, slice.places);

    const labels: Label[] = [];
    const seenNames = new Set<string>();
    for (const way of slice.roads) {
      if (!way.name || seenNames.has(way.name)) continue;
      const length = wayLength(way.pts);
      if (length < 60) continue;
      const mid = midpoint(way.pts);
      const placed = this.named.get(way.name) ?? [];
      if (placed.some((p) => Math.hypot(p.x - mid.x, p.z - mid.z) < NAME_SPACING)) continue;
      seenNames.add(way.name);
      placed.push({ x: mid.x, z: mid.z, tile: key });
      this.named.set(way.name, placed);
      const major = MAJOR.has(way.kind);
      const sprite = textSprite(way.name, major ? 5 : 3.6, { colour: "#ffffff", size: 44, weight: major ? "700" : "500" });
      sprite.position.set(mid.x, 6, mid.z);
      sprite.visible = false;
      group.add(sprite);
      labels.push({ sprite, x: mid.x, z: mid.z, major, tile: key });
    }
    for (const place of slice.places) {
      if (!place.name) continue;
      const sprite = textSprite(place.name, 4.2, {
        colour: "#ffe9b8", size: 42, weight: "600", icon: PLACE_ICON[place.kind ?? ""] ?? "•",
      });
      const building = this.world.buildingAt(place.x, place.y, 2);
      sprite.position.set(place.x, (building?.height ?? 0) + 7, place.y);
      sprite.visible = false;
      group.add(sprite);
      labels.push({ sprite, x: place.x, z: place.y, major: !MINOR_PLACE.has(place.kind ?? ""), minor: MINOR_PLACE.has(place.kind ?? ""), tile: key });
    }

    this.group.add(group);
    this.loaded.set(key, { key, group, labels });
    this.labels.push(...labels);
    this.stats.roads += slice.roads.length;
    this.stats.buildings += slice.buildings.length;
    this.stats.trees += slice.trees.length;
  }

  private remove(tile: Loaded) {
    this.loaded.delete(tile.key);
    this.group.remove(tile.group);
    tile.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry && !this.treeParts.some((p) => p.geometry === mesh.geometry)) mesh.geometry.dispose();
      const sprite = o as THREE.Sprite;
      if (sprite.isSprite) sprite.material.dispose();
    });
    this.world.removeTile(tile.key);
    this.labels = this.labels.filter((l) => l.tile !== tile.key);
    for (const [name, list] of this.named) {
      const kept = list.filter((p) => p.tile !== tile.key);
      if (kept.length) this.named.set(name, kept); else this.named.delete(name);
    }
    for (const [id, owner] of this.owned) if (owner === tile.key) this.owned.delete(id);
    const data = this.store.get(tile.key);
    if (data) {
      this.stats.roads -= data.roads.length;
      this.stats.buildings -= data.buildings.length;
      this.stats.trees -= data.trees.length;
    }
  }

  /** Show the nearest few labels only; a city of names is a city of noise. */
  private updateLabels(x: number, z: number, elapsed: number) {
    const near: Array<{ label: Label; d: number }> = [];
    for (const label of this.labels) {
      const d = Math.hypot(label.x - x, label.z - z);
      const range = label.minor ? 110 : label.major ? LABEL_RANGE * 1.6 : LABEL_RANGE;
      if (d <= range) near.push({ label, d: label.major ? d * 0.6 : d });
      else label.sprite.visible = false;
    }
    near.sort((a, b) => a.d - b.d);
    near.forEach(({ label }, i) => {
      label.sprite.visible = i < MAX_LABELS;
      // gentle bob so they read as floating markers rather than painted text
      label.sprite.position.y = (label.major && label.sprite.position.y > 6.5 ? label.sprite.position.y : 6) + Math.sin(elapsed * 1.2 + label.x) * 0.15;
    });
  }
}

const edgeDistance = (cx: number, cy: number, x: number, z: number) => {
  const x0 = cx * TILE_M, z0 = cy * TILE_M;
  const dx = Math.max(x0 - x, 0, x - (x0 + TILE_M));
  const dz = Math.max(z0 - z, 0, z - (z0 + TILE_M));
  return Math.hypot(dx, dz);
};

const wayLength = (pts: number[]) => {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return l;
};

const midpoint = (pts: number[]) => {
  const total = wayLength(pts);
  let walked = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      return { x: pts[i - 2] + (pts[i] - pts[i - 2]) * t, z: pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t };
    }
    walked += seg;
  }
  return { x: pts[0], z: pts[1] };
};

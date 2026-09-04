// Memories in the world: a lantern where each was left, glowing, bobbing,
// with the name of whoever left it once you are close.

import * as THREE from "three";
import type { Memory } from "../net/memories";
import { haloTexture, textSprite } from "./text";
import type { World } from "../world/collision";

const NAME_RANGE = 90;
const BEAM_HEIGHT = 70;

/** Bright at the foot, gone at the top. */
let beamTex: THREE.CanvasTexture | null = null;
const beamTexture = () => {
  if (beamTex) return beamTex;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  beamTex = new THREE.CanvasTexture(canvas);
  return beamTex;
};
const READ_RANGE = 14;
const HOVER = 2.2;

type Beacon = {
  memory: Memory;
  group: THREE.Group;
  halo: THREE.Sprite;
  beam: THREE.Mesh;
  name: THREE.Sprite;
  x: number;
  y: number;
  z: number;
  phase: number;
};

export class Beacons {
  readonly group = new THREE.Group();
  private beacons = new Map<string, Beacon>();
  private lantern: THREE.Object3D;
  private world: World;
  private haloMaterial: THREE.SpriteMaterial;
  private beamMaterial: THREE.MeshBasicMaterial;
  private beamGeometry: THREE.CylinderGeometry;

  constructor(lantern: THREE.Object3D, world: World) {
    this.lantern = lantern;
    this.world = world;
    this.haloMaterial = new THREE.SpriteMaterial({
      map: haloTexture(), color: 0xffb060, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // a faint column of light so a memory can be found from streets away
    this.beamMaterial = new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0xffa040, transparent: true, opacity: 0.16, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.beamGeometry = new THREE.CylinderGeometry(0.5, 1.4, BEAM_HEIGHT, 10, 1, true);
    this.beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
  }

  /** Replace the set of memories, keeping any that are unchanged. */
  set(memories: Memory[]) {
    const keep = new Set<string>();
    for (const m of memories) {
      keep.add(m.id);
      if (this.beacons.has(m.id)) continue;
      this.add(m);
    }
    for (const [id, b] of this.beacons) {
      if (keep.has(id)) continue;
      this.group.remove(b.group);
      b.name.material.dispose();
      this.beacons.delete(id);
    }
  }

  private add(memory: Memory) {
    const group = new THREE.Group();
    const model = this.lantern.clone(true);
    model.scale.setScalar(1.6);
    group.add(model);

    const halo = new THREE.Sprite(this.haloMaterial);
    halo.scale.set(12, 12, 1);
    halo.position.y = 1.0;
    group.add(halo);

    const beam = new THREE.Mesh(this.beamGeometry, this.beamMaterial);
    beam.position.y = 1.2;
    beam.renderOrder = 5;
    group.add(beam);

    const name = textSprite(memory.by || "someone", 2.6, { colour: "#ffe9b8", size: 40, weight: "600" });
    name.position.y = 4.2;
    name.visible = false;
    group.add(name);

    const x = memory.x, z = memory.y;
    // an old memory from the 2D game has no height: float it just above the street,
    // or on the roof if it landed inside a building
    let y = typeof memory.alt === "number" ? memory.alt : 0;
    const building = this.world.buildingAt(x, z, 0.5);
    if (building && y < building.height) y = building.height + 0.5;
    y += HOVER;

    group.position.set(x, y, z);
    this.group.add(group);
    this.beacons.set(memory.id, { memory, group, halo, beam, name, x, y, z, phase: Math.random() * Math.PI * 2 });
  }

  update(elapsed: number, px: number, pz: number) {
    for (const b of this.beacons.values()) {
      const d = Math.hypot(b.x - px, b.z - pz);
      b.group.position.y = b.y + Math.sin(elapsed * 1.4 + b.phase) * 0.25;
      b.group.rotation.y = elapsed * 0.35 + b.phase;
      b.name.visible = d < NAME_RANGE;
      b.name.rotation.y = -b.group.rotation.y;
      const pulse = 0.45 + Math.sin(elapsed * 2.2 + b.phase) * 0.12;
      b.halo.scale.setScalar(12 * (1 + (d < READ_RANGE ? 0.35 : 0)) * (0.9 + pulse * 0.2));
      // the beam fades as you arrive: up close the lantern itself is the thing
      b.beam.visible = d > READ_RANGE * 0.8;
      b.beam.rotation.y = -b.group.rotation.y;
    }
  }

  /** The memory within reach, nearest first. */
  nearest(px: number, py: number, pz: number): Memory | null {
    let best: { m: Memory; d: number } | null = null;
    for (const b of this.beacons.values()) {
      const d = Math.hypot(b.x - px, b.y - py, b.z - pz);
      if (d <= READ_RANGE && (!best || d < best.d)) best = { m: b.memory, d };
    }
    return best?.m ?? null;
  }

  /** Where a memory is, for the compass and the minimap. */
  positions(): Array<{ id: string; x: number; z: number }> {
    return [...this.beacons.values()].map((b) => ({ id: b.memory.id, x: b.x, z: b.z }));
  }

  get count() { return this.beacons.size; }
}

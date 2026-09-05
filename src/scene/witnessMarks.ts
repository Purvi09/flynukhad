// The people standing in the street who know something.
//
// Each is a small figure in a coat, in the flat colours the 2D game used, with
// a name over their head once you are near. A witness you have not unlocked yet
// is there but grey and quiet — you can see there is someone to find.

import * as THREE from "three";
import type { Witness } from "@shared/history";
import { haloTexture, textSprite } from "./text";
import type { World } from "../world/collision";

const NAME_RANGE = 260;
/** How close before the halo brightens to say "you can talk to this one". */
const TALK_RANGE = 30;
/**
 * A person is two metres tall and may be most of a kilometre away, which is a
 * couple of pixels. The column of light is what you actually navigate by.
 */
const BEAM_HEIGHT = 85;

/** The coats, in the order witnesses are met. Rose first: it is the memory colour. */
const COATS = [0xd4708f, 0x5f9160, 0xd39a3c, 0x8a6fb8, 0x5b8fc4];
const TROUSERS = 0x3a3446;
const SKIN = 0xf0cfb2;

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
  grad.addColorStop(0.3, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  beamTex = new THREE.CanvasTexture(canvas);
  return beamTex;
};

type Mark = {
  witness: Witness;
  group: THREE.Group;
  halo: THREE.Sprite;
  beam: THREE.Mesh;
  label: THREE.Sprite;
  x: number;
  y: number;
  z: number;
  phase: number;
  unlocked: boolean;
  told: boolean;
};

/** A person: two legs, a coat, a head and a hat. Roughly two metres tall. */
const figure = (coat: number) => {
  const group = new THREE.Group();
  const solid = (colour: number, w: number, h: number, d: number, y: number, x = 0) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: colour }),
    );
    mesh.position.set(x, y, 0);
    group.add(mesh);
    return mesh;
  };
  solid(TROUSERS, 0.24, 0.7, 0.26, 0.35, -0.16); // legs
  solid(TROUSERS, 0.24, 0.7, 0.26, 0.35, 0.16);
  solid(coat, 0.78, 0.9, 0.5, 1.15);             // coat
  solid(coat, 0.16, 0.62, 0.22, 1.2, -0.46);     // arms
  solid(coat, 0.16, 0.62, 0.22, 1.2, 0.46);
  solid(SKIN, 0.42, 0.42, 0.42, 1.82);           // head
  solid(coat, 0.72, 0.08, 0.72, 2.06);           // hat brim
  solid(coat, 0.46, 0.22, 0.46, 2.17);           // crown
  return group;
};

export class WitnessMarks {
  readonly group = new THREE.Group();
  private marks = new Map<string, Mark>();
  private haloOn: THREE.SpriteMaterial;
  private haloOff: THREE.SpriteMaterial;
  private beamOn: THREE.MeshBasicMaterial;
  private beamOff: THREE.MeshBasicMaterial;
  private beamGeometry: THREE.CylinderGeometry;

  constructor(private world: World) {
    this.haloOn = new THREE.SpriteMaterial({
      map: haloTexture(), color: 0xffd08a, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.haloOff = new THREE.SpriteMaterial({
      map: haloTexture(), color: 0x8fa0b8, transparent: true, opacity: 0.2,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // rose for someone who will talk to you, cool grey for someone who will not
    this.beamOn = new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0xff9ec0, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.beamOff = new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0x9fb2cc, transparent: true, opacity: 0.2,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.beamGeometry = new THREE.CylinderGeometry(0.6, 2.0, BEAM_HEIGHT, 10, 1, true);
    this.beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
  }

  /** Replace the whole cast: a new case means new people. */
  set(witnesses: Array<{ witness: Witness; unlocked: boolean; told: boolean }>) {
    this.clear();
    witnesses.forEach((state, index) => this.add(state, index));
  }

  private add(state: { witness: Witness; unlocked: boolean; told: boolean }, index: number) {
    const { witness } = state;
    const group = new THREE.Group();
    group.add(figure(COATS[index % COATS.length]));

    const halo = new THREE.Sprite(state.unlocked ? this.haloOn : this.haloOff);
    halo.scale.set(11, 11, 1);
    halo.position.y = 1.4;
    group.add(halo);

    const beam = new THREE.Mesh(this.beamGeometry, state.unlocked ? this.beamOn : this.beamOff);
    beam.position.y = 1.2;
    beam.renderOrder = 5;
    group.add(beam);

    const label = textSprite(witness.name, 2.4, { colour: "#ffe9d0", size: 38, weight: "600" });
    label.position.y = 3.1;
    label.visible = false;
    group.add(label);

    // stand them on the pavement, or on the roof if the street data put them
    // inside a building footprint
    const x = witness.x;
    const z = witness.y;
    const building = this.world.buildingAt(x, z, 0.5);
    const y = building ? building.height + 0.2 : 0;

    group.position.set(x, y, z);
    this.group.add(group);
    this.marks.set(witness.id, {
      witness, group, halo, beam, label, x, y, z,
      phase: Math.random() * Math.PI * 2,
      unlocked: state.unlocked,
      told: state.told,
    });
  }

  /** Reflect a change in who will talk, without rebuilding the figures. */
  refresh(states: Array<{ witness: Witness; unlocked: boolean; told: boolean }>) {
    for (const state of states) {
      const mark = this.marks.get(state.witness.id);
      if (!mark) continue;
      mark.unlocked = state.unlocked;
      mark.told = state.told;
      mark.halo.material = state.unlocked ? this.haloOn : this.haloOff;
      mark.beam.material = state.unlocked ? this.beamOn : this.beamOff;
    }
  }

  update(elapsed: number, px: number, pz: number) {
    for (const m of this.marks.values()) {
      const d = Math.hypot(m.x - px, m.z - pz);
      // they shift their weight; the ones who have spoken stand still
      m.group.rotation.y = m.told ? m.phase : m.phase + Math.sin(elapsed * 0.6 + m.phase) * 0.25;
      m.label.visible = d < NAME_RANGE;
      const near = m.unlocked && !m.told && d < TALK_RANGE;
      m.halo.scale.setScalar(11 * (near ? 1.3 + Math.sin(elapsed * 3) * 0.08 : 1));
      // the beam is for finding them; up close the person is the thing
      m.beam.visible = !m.told && d > TALK_RANGE * 0.7;
      m.beam.rotation.y = -m.group.rotation.y;
    }
  }

  /** The witness within talking distance, if any. */
  nearest(px: number, py: number, pz: number, within: number): Witness | null {
    let best: { w: Witness; d: number } | null = null;
    for (const m of this.marks.values()) {
      const d = Math.hypot(m.x - px, m.y + 1.2 - py, m.z - pz);
      if (d <= within && (!best || d < best.d)) best = { w: m.witness, d };
    }
    return best?.w ?? null;
  }

  /** Where the witnesses are, for the compass and the minimap. */
  positions(): Array<{ id: string; x: number; z: number; unlocked: boolean; told: boolean }> {
    return [...this.marks.values()].map((m) => ({
      id: m.witness.id, x: m.x, z: m.z, unlocked: m.unlocked, told: m.told,
    }));
  }

  clear() {
    for (const m of this.marks.values()) {
      this.group.remove(m.group);
      m.label.material.dispose();
      m.group.traverse((child) => {
        if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
      });
    }
    this.marks.clear();
  }
}

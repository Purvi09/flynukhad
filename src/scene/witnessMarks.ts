// The people standing in the street who know something.
//
// Each is a small figure in a coat, in the flat colours the 2D game used, with
// a name over their head once you are near. A witness you have not unlocked yet
// is there but grey and quiet — you can see there is someone to find.
//
// They pace their own corner rather than standing like statues: a short leash
// around the post the case file gave them, legs and arms swinging, turning to
// face you once you are close enough to speak. Someone who has already told you
// their piece stops walking and stays put, so a solved corner reads as done.

import * as THREE from "three";
import { WITNESS_WITHIN_M, type Witness } from "@shared/history";
import { haloTexture, textSprite } from "./text";
import type { World } from "../world/collision";

const NAME_RANGE = 260;
/**
 * How close before the halo brightens to say "you can talk to this one".
 * The same distance the game actually accepts, so the light never promises a
 * conversation the range check will refuse.
 */
const TALK_RANGE = WITNESS_WITHIN_M;
/**
 * A person is two metres tall and may be most of a kilometre away, which is a
 * couple of pixels. The column of light is what you actually navigate by.
 */
const BEAM_HEIGHT = 85;

/** Walking pace, metres a second, and how far they will stray from their post. */
const WALK_SPEED = 1.4;
const LEASH = 12;
/** Close enough that they stop, turn and look at you — just inside earshot. */
const FACE_RANGE = WITNESS_WITHIN_M * 0.75;

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
  body: Body;
  halo: THREE.Sprite;
  beam: THREE.Mesh;
  label: THREE.Sprite;
  /** Where they are right now, and the post they never wander far from. */
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  /** Heading, as a unit vector on the ground. */
  dx: number;
  dz: number;
  /** How far into the current stride, so the legs keep phase across frames. */
  stride: number;
  phase: number;
  unlocked: boolean;
  told: boolean;
};

/** The moving parts of a figure, so it can be walked. */
type Body = {
  group: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  torso: THREE.Group;
};

/**
 * A person: two legs, a coat, a head and a hat. Roughly two metres tall.
 * Limbs hang off pivots at the hip and shoulder so they can swing.
 */
const figure = (coat: number): Body => {
  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);

  const solid = (
    parent: THREE.Object3D,
    colour: number, w: number, h: number, d: number, y: number, x = 0,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: colour }),
    );
    mesh.position.set(x, y, 0);
    parent.add(mesh);
    return mesh;
  };

  /** A limb that swings about its top end. */
  const limb = (colour: number, w: number, h: number, d: number, hip: number, x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, hip, 0);
    solid(pivot, colour, w, h, d, -h / 2);
    torso.add(pivot);
    return pivot;
  };

  const legs: [THREE.Group, THREE.Group] = [
    limb(TROUSERS, 0.24, 0.7, 0.26, 0.7, -0.16),
    limb(TROUSERS, 0.24, 0.7, 0.26, 0.7, 0.16),
  ];
  solid(torso, coat, 0.78, 0.9, 0.5, 1.15);      // coat
  const arms: [THREE.Group, THREE.Group] = [
    limb(coat, 0.16, 0.62, 0.22, 1.51, -0.46),
    limb(coat, 0.16, 0.62, 0.22, 1.51, 0.46),
  ];
  solid(torso, SKIN, 0.42, 0.42, 0.42, 1.82);    // head
  solid(torso, coat, 0.72, 0.08, 0.72, 2.06);    // hat brim
  solid(torso, coat, 0.46, 0.22, 0.46, 2.17);    // crown
  return { group, legs, arms, torso };
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
    const body = figure(COATS[index % COATS.length]);
    group.add(body.group);

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
    // fan the cast out so two of them never set off in the same direction
    const angle = (index / Math.max(1, COATS.length)) * Math.PI * 2 + Math.random();
    this.marks.set(witness.id, {
      witness, group, body, halo, beam, label, x, y, z,
      homeX: x, homeZ: z,
      dx: Math.cos(angle), dz: Math.sin(angle),
      stride: Math.random() * Math.PI * 2,
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

  update(dt: number, elapsed: number, px: number, pz: number) {
    for (const m of this.marks.values()) {
      const d = Math.hypot(m.x - px, m.z - pz);
      // Someone who has told you their piece is finished walking; someone you
      // are standing in front of stops and looks at you. Everyone else paces.
      const stopped = m.told || d < FACE_RANGE;
      if (stopped) {
        this.face(m, dt, m.told ? m.phase : Math.atan2(px - m.x, pz - m.z));
        this.stand(m, dt, elapsed);
      } else {
        this.walk(m, dt);
      }

      m.label.visible = d < NAME_RANGE;
      const near = m.unlocked && !m.told && d < TALK_RANGE;
      m.halo.scale.setScalar(11 * (near ? 1.3 + Math.sin(elapsed * 3) * 0.08 : 1));
      // the beam is for finding them; up close the person is the thing
      m.beam.visible = !m.told && d > TALK_RANGE * 0.7;
      m.beam.rotation.y = -m.group.rotation.y;
    }
  }

  /** One pace forward, turning back at the leash or at a wall. */
  private walk(m: Mark, dt: number) {
    const step = WALK_SPEED * dt;
    const nx = m.x + m.dx * step;
    const nz = m.z + m.dz * step;
    const strayed = Math.hypot(nx - m.homeX, nz - m.homeZ) > LEASH;
    // On a roof they stay on that roof; on the street they stay out of walls.
    const roof = this.world.buildingAt(m.homeX, m.homeZ, 0.5);
    const barred = roof
      ? this.world.buildingAt(nx, nz, 0) !== roof
      : this.world.blocked(nx, nz, 1);

    if (strayed || barred) {
      // turn back towards the post, with enough of a kink that they do not
      // simply retrace the same line for the rest of the case
      const bx = m.homeX - m.x;
      const bz = m.homeZ - m.z;
      const len = Math.hypot(bx, bz) || 1;
      const kink = ((m.stride % 1) - 0.5) * 1.2;
      m.dx = bx / len + kink * (bz / len);
      m.dz = bz / len - kink * (bx / len);
      const dl = Math.hypot(m.dx, m.dz) || 1;
      m.dx /= dl;
      m.dz /= dl;
      return;
    }

    m.x = nx;
    m.z = nz;
    m.y = roof ? roof.height + 0.2 : 0;
    m.group.position.set(m.x, m.y, m.z);
    this.face(m, dt, Math.atan2(m.dx, m.dz));

    // legs and arms swing opposite each other, and the body rises on each step
    m.stride += (step / 0.8) * Math.PI;
    const swing = Math.sin(m.stride) * 0.55;
    m.body.legs[0].rotation.x = swing;
    m.body.legs[1].rotation.x = -swing;
    m.body.arms[0].rotation.x = -swing * 0.7;
    m.body.arms[1].rotation.x = swing * 0.7;
    m.body.torso.position.y = Math.abs(Math.cos(m.stride)) * 0.06;
  }

  /** Standing still: limbs settle, and they shift their weight where they are. */
  private stand(m: Mark, dt: number, elapsed: number) {
    const settle = 1 - Math.exp(-6 * dt);
    for (const limb of [...m.body.legs, ...m.body.arms]) limb.rotation.x *= 1 - settle;
    m.body.torso.position.y *= 1 - settle;
    m.body.torso.rotation.y = m.told ? 0 : Math.sin(elapsed * 0.6 + m.phase) * 0.12;
  }

  /** Turn towards a heading without snapping to it. */
  private face(m: Mark, dt: number, want: number) {
    let delta = want - m.group.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    m.group.rotation.y += delta * (1 - Math.exp(-6 * dt));
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

// What the answer looks like, once you have locked one in.
//
// Taken from the 2D game's reveal: your guess gets a small blue post, the real
// place gets a tall gold pole with a ring on the ground and its name over it,
// and a dashed line runs between the two with the miss written on it. The
// camera pulls back to hold both in one shot; that framing lives in the
// camera, this is only what it looks at.

import * as THREE from "three";
import { textSprite } from "./text";

const GOLD = 0xe8a33d;
const GUESS = 0x8fc4ff;
/** Tall enough to find from the far end of the dashed line. */
const POLE = 130;
const GUESS_POLE = 34;
/**
 * Roughly this many dashes whatever the distance, so a miss across the city
 * and a miss down the street read as the same kind of line.
 */
const DASHES = 26;

const flatRing = (inner: number, outer: number, colour: number, opacity: number) => {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 48),
    new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
};

const pole = (height: number, radius: number, colour: number, opacity: number) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 8),
    new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }),
  );
  mesh.position.y = height / 2;
  return mesh;
};

/** The height of the arc a fraction `t` along a line this long. */
const arcHeight = (t: number, away: number) =>
  3 + Math.sin(t * Math.PI) * Math.min(110, Math.max(24, away * 0.22));

const formatMetres = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;

export class Reveal {
  readonly group = new THREE.Group();
  /** The two ends the camera should hold, once there is something to hold. */
  frame: { a: THREE.Vector3; b: THREE.Vector3 } | null = null;
  private pulse: THREE.Mesh[] = [];

  /** Put the answer on the ground. `guess` is null when the case was given up. */
  show(site: { x: number; z: number; title: string }, guess: { x: number; z: number } | null) {
    this.clear();

    // ---- the real place ---------------------------------------------------
    const there = new THREE.Group();
    there.position.set(site.x, 0.4, site.z);
    const inner = flatRing(13, 16, GOLD, 0.95);
    const outer = flatRing(26, 27.5, GOLD, 0.35);
    there.add(inner, outer);
    this.pulse.push(inner, outer);
    there.add(pole(POLE, 1.1, GOLD, 0.7));

    // an arrowhead, so the pole reads as pointing down at the spot
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(6, 14, 12),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9, fog: false }),
    );
    head.rotation.x = Math.PI; // point down the pole
    head.position.y = POLE - 7;
    there.add(head);

    const name = textSprite(site.title, 16, { colour: "#ffd88a", size: 44, weight: "700" });
    name.position.y = POLE + 16;
    there.add(name);
    this.group.add(there);

    if (guess) {
      // ---- where you called it --------------------------------------------
      const here = new THREE.Group();
      here.position.set(guess.x, 0.4, guess.z);
      here.add(flatRing(6, 7.5, GUESS, 0.85));
      here.add(pole(GUESS_POLE, 0.6, GUESS, 0.55));
      const said = textSprite("your answer", 7, { colour: "#cfe6ff", size: 34, weight: "600" });
      said.position.y = GUESS_POLE + 6;
      here.add(said);
      this.group.add(here);

      // ---- the line between, and what it cost ------------------------------
      const away = Math.hypot(site.x - guess.x, site.z - guess.z);
      this.group.add(this.dashes(guess, site, away));

      // written at the top of the arc, where nothing is in front of it
      const gap = textSprite(formatMetres(away), 13, { colour: "#ffd88a", size: 40, weight: "700" });
      gap.position.set((site.x + guess.x) / 2, arcHeight(0.5, away) + 10, (site.z + guess.z) / 2);
      this.group.add(gap);

      this.frame = {
        a: new THREE.Vector3(guess.x, 0, guess.z),
        b: new THREE.Vector3(site.x, 0, site.z),
      };
    } else {
      this.frame = {
        a: new THREE.Vector3(site.x, 0, site.z),
        b: new THREE.Vector3(site.x, 0, site.z),
      };
    }
  }

  /**
   * A run of dashes from one end to the other. It arcs over the skyline rather
   * than lying on the ground: at street level a city block would swallow it.
   *
   * Each dash is built as geometry, not as a line — `LineSegments` is a single
   * pixel wide however far away it is, and from the camera the reveal pulls
   * back to, a hairline is not a line at all. So every dash is a horizontal
   * ribbon crossed with a vertical one, which reads from any angle.
   */
  private dashes(from: { x: number; z: number }, to: { x: number; z: number }, away: number) {
    const dx = (to.x - from.x) / away;
    const dz = (to.z - from.z) / away;
    // across the line, on the ground plane
    const nx = -dz;
    const nz = dx;
    const half = Math.min(14, Math.max(3.5, away * 0.014)) / 2;

    const pitch = Math.min(70, Math.max(9, away / DASHES));
    const ink = pitch * 0.55;

    const position: number[] = [];
    const quad = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      ox: number, oy: number, oz: number,
    ) => {
      // a strip from a to b, `o` wide, as two triangles
      const p = [
        ax - ox, ay - oy, az - oz, bx - ox, by - oy, bz - oz, bx + ox, by + oy, bz + oz,
        ax - ox, ay - oy, az - oz, bx + ox, by + oy, bz + oz, ax + ox, ay + oy, az + oz,
      ];
      position.push(...p);
    };

    for (let at = 0; at < away; at += pitch) {
      const end = Math.min(at + ink, away);
      const ax = from.x + dx * at, az = from.z + dz * at, ay = arcHeight(at / away, away);
      const bx = from.x + dx * end, bz = from.z + dz * end, by = arcHeight(end / away, away);
      quad(ax, ay, az, bx, by, bz, nx * half, 0, nz * half); // seen from above
      quad(ax, ay, az, bx, by, bz, 0, half, 0);              // seen from the side
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: GOLD, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      }),
    );
  }

  update(elapsed: number) {
    if (!this.pulse.length) return;
    const beat = 1 + Math.sin(elapsed * 2.2) * 0.06;
    for (const ring of this.pulse) ring.scale.setScalar(beat);
  }

  clear() {
    this.frame = null;
    this.pulse.length = 0;
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Sprite) {
        child.material.dispose();
      }
    });
    this.group.clear();
  }
}

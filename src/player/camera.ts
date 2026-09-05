// A third-person camera that hangs behind the pod on a spring.
//
// The rig is what Subnautica's Seamoth does: the camera sits behind and above
// the nose direction, lags a little on turns so you can see the hull bank, and
// never goes under the street.

import * as THREE from "three";
import { FLOOR } from "../world/collision";

const DISTANCE = 11;
const HEIGHT = 3.2;
const LOOK_AHEAD = 6;
/** Higher is stiffer. */
const POSITION_STIFFNESS = 7;
const LOOK_STIFFNESS = 9;
/** The reveal is slower on purpose: you are meant to watch it arrive. */
const REVEAL_STIFFNESS = 2.2;

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private lookNow = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private zoom = 1;
  private shake = 0;
  /** Set while a case is answered: the two points that must stay in shot. */
  private held: { a: THREE.Vector3; b: THREE.Vector3 } | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.5, 6000);
  }

  /** Snap behind the pod: on arrival, and after teleporting. */
  snap(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.forward.set(0, 0, -1).applyQuaternion(quaternion);
    this.target.copy(position).addScaledVector(this.forward, -DISTANCE * this.zoom).addScaledVector(this.up, HEIGHT * this.zoom);
    this.camera.position.copy(this.target);
    this.lookNow.copy(position).addScaledVector(this.forward, LOOK_AHEAD);
    this.camera.lookAt(this.lookNow);
  }

  zoomBy(factor: number) {
    this.zoom = Math.max(0.55, Math.min(2.6, this.zoom * factor));
  }

  kick(strength: number) {
    this.shake = Math.min(1, this.shake + strength);
  }

  /**
   * Pull back off the pod and hold these two places instead — your answer and
   * the real one. Passing null hands the camera back to the pod.
   */
  hold(ends: { a: THREE.Vector3; b: THREE.Vector3 } | null) {
    this.held = ends;
  }

  update(dt: number, position: THREE.Vector3, quaternion: THREE.Quaternion, speed01: number) {
    if (this.held) { this.frameHeld(dt, position); return; }
    this.forward.set(0, 0, -1).applyQuaternion(quaternion);
    // pull back a touch when fast, so speed is felt
    const dist = DISTANCE * this.zoom * (1 + speed01 * 0.35);
    // level the horizontal frame: a pitched pod should not tilt the ground
    const flatForward = new THREE.Vector3(this.forward.x, 0, this.forward.z);
    if (flatForward.lengthSq() < 0.05) flatForward.set(0, 0, -1); else flatForward.normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(this.forward.y, -1, 1));
    this.target.copy(position)
      .addScaledVector(flatForward, -dist * Math.cos(pitch * 0.6))
      .addScaledVector(this.up, HEIGHT * this.zoom - Math.sin(pitch * 0.6) * dist * 0.7);
    if (this.target.y < FLOOR + 0.8) this.target.y = FLOOR + 0.8;

    const k = 1 - Math.exp(-POSITION_STIFFNESS * dt);
    this.camera.position.lerp(this.target, k);

    this.lookAt.copy(position).addScaledVector(this.forward, LOOK_AHEAD);
    const kl = 1 - Math.exp(-LOOK_STIFFNESS * dt);
    this.lookNow.lerp(this.lookAt, kl);

    if (this.shake > 0.001) {
      this.lookNow.x += (Math.random() - 0.5) * this.shake * 0.6;
      this.lookNow.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-8 * dt);
    }
    this.camera.lookAt(this.lookNow);
  }

  /**
   * Sit off to one side of the line between the two, high enough that both fit,
   * so the dashes run across the screen rather than away from you.
   */
  private frameHeld(dt: number, position: THREE.Vector3) {
    const { a, b } = this.held!;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const span = a.distanceTo(b);
    // aim at the middle of the arc, not the ground under it
    mid.y = Math.min(60, span * 0.12);

    // perpendicular to the line, on whichever side the pod is already on
    let side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x));
    if (side.lengthSq() < 1) side.set(0, 0, 1); else side.normalize();
    if (side.dot(new THREE.Vector3().subVectors(position, mid)) < 0) side.negate();

    // enough room for the arc of dashes as well as the two ends
    const back = Math.max(120, span * 0.9);
    const up = Math.max(90, span * 0.7);
    this.target.copy(mid).addScaledVector(side, back).addScaledVector(this.up, up);

    const k = 1 - Math.exp(-REVEAL_STIFFNESS * dt);
    this.camera.position.lerp(this.target, k);
    this.lookNow.lerp(mid, k);
    this.camera.lookAt(this.lookNow);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

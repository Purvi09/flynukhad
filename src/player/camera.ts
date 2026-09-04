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

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private lookNow = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private zoom = 1;
  private shake = 0;

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

  update(dt: number, position: THREE.Vector3, quaternion: THREE.Quaternion, speed01: number) {
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

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

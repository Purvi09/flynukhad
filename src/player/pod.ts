// The pod: what you fly. Six degrees of freedom, drag, banking, and a bump
// when you meet a wall.
//
// Controls follow Subnautica's Seamoth: the mouse points the nose, W and S
// thrust along it, A and D strafe, Space and C rise and dive, Shift boosts.

import * as THREE from "three";
import type { Intent } from "../engine/input";
import type { World } from "../world/collision";
import { WORLD_LIMIT_M } from "@shared/geo";

const CRUISE = 26;          // m/s
const BOOST = 58;
const ACCEL = 34;           // m/s^2 at full thrust
const STRAFE_ACCEL = 24;
const RISE_ACCEL = 22;
const DRAG = 1.9;           // per second: v *= exp(-DRAG*dt) with no thrust
const RADIUS = 1.6;
const MAX_PITCH = Math.PI * 0.42;
const BANK = 0.55;

export class Pod {
  readonly object = new THREE.Object3D();
  readonly position = new THREE.Vector3(0, 30, 0);
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  yaw = 0;
  pitch = 0;
  roll = 0;
  boosting = false;
  /** 0..1 of boost speed */
  speed01 = 0;
  /** true on the step the hull touched something */
  bumped = false;
  private lastBump = 0;
  private euler = new THREE.Euler(0, 0, 0, "YXZ");
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private model: THREE.Object3D | null = null;

  setModel(model: THREE.Object3D) {
    if (this.model) this.object.remove(this.model);
    this.model = model;
    this.object.add(model);
  }

  place(x: number, y: number, z: number, yaw = 0) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.sync();
  }

  step(dt: number, intent: Intent, world: World, elapsed: number) {
    this.yaw += intent.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + intent.pitch, -MAX_PITCH, MAX_PITCH);
    this.boosting = intent.boost && intent.thrust > 0;

    this.euler.set(this.pitch, this.yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const accel = this.boosting ? ACCEL * 1.8 : ACCEL;
    this.velocity.addScaledVector(this.forward, intent.thrust * accel * dt);
    this.velocity.addScaledVector(this.right, intent.strafe * STRAFE_ACCEL * dt);
    this.velocity.addScaledVector(this.up, intent.rise * RISE_ACCEL * dt);

    // drag, heavier when coasting so the pod settles quickly
    const thrusting = Math.abs(intent.thrust) + Math.abs(intent.strafe) + Math.abs(intent.rise) > 0;
    const drag = thrusting ? DRAG * 0.55 : DRAG * 1.6;
    this.velocity.multiplyScalar(Math.exp(-drag * dt));

    const max = this.boosting ? BOOST : CRUISE;
    const speed = this.velocity.length();
    if (speed > max) this.velocity.multiplyScalar(max / speed);

    this.position.addScaledVector(this.velocity, dt);

    // the edge of the map: a soft wall
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > WORLD_LIMIT_M) {
      const k = WORLD_LIMIT_M / r;
      this.position.x *= k;
      this.position.z *= k;
      const nx = this.position.x / WORLD_LIMIT_M, nz = this.position.z / WORLD_LIMIT_M;
      const into = this.velocity.x * nx + this.velocity.z * nz;
      if (into > 0) { this.velocity.x -= into * nx; this.velocity.z -= into * nz; }
    }

    const body = {
      x: this.position.x, y: this.position.y, z: this.position.z,
      vx: this.velocity.x, vy: this.velocity.y, vz: this.velocity.z, radius: RADIUS,
    };
    const before = this.velocity.length();
    const hit = world.resolve(body);
    this.position.set(body.x, body.y, body.z);
    this.velocity.set(body.vx, body.vy, body.vz);
    this.bumped = false;
    if (hit && before - this.velocity.length() > 4 && elapsed - this.lastBump > 0.4) {
      this.bumped = true;
      this.lastBump = elapsed;
    }

    // bank into turns and strafes; settle when straight
    const targetRoll = -(intent.yaw / Math.max(dt, 1e-3)) * 0.12 - intent.strafe * BANK;
    this.roll += (THREE.MathUtils.clamp(targetRoll, -0.7, 0.7) - this.roll) * Math.min(1, 6 * dt);

    this.speed01 = this.velocity.length() / BOOST;
    this.sync(elapsed);
  }

  private sync(elapsed = 0) {
    this.object.position.copy(this.position);
    this.euler.set(this.pitch, this.yaw, this.roll);
    this.object.quaternion.setFromEuler(this.euler);
    if (this.model) {
      // a slight hover so a parked pod still looks alive
      this.model.position.y = Math.sin(elapsed * 1.7) * 0.08;
    }
  }

  get forwardVector() { return this.forward; }
  get radius() { return RADIUS; }
}

// Other people flying this city: their pods, tinted, with names above.
// Positions arrive every few seconds and are eased between updates.

import * as THREE from "three";
import type { Explorer } from "../net/presence";
import { paintedPod } from "./models";
import { textSprite } from "./text";

type Other = {
  uid: string;
  group: THREE.Group;
  name: THREE.Sprite;
  target: THREE.Vector3;
  yaw: number;
  coat: number;
  at: number;
};

export class Others {
  readonly group = new THREE.Group();
  private others = new Map<string, Other>();

  constructor(private podSource: THREE.Group) {}

  set(people: Explorer[]) {
    const keep = new Set<string>();
    for (const p of people) {
      keep.add(p.uid);
      const alt = typeof p.alt === "number" ? p.alt : 3;
      let o = this.others.get(p.uid);
      if (!o) {
        const group = new THREE.Group();
        const pod = paintedPod(this.podSource, p.coat || 0xd39a3c);
        pod.scale.setScalar(1);
        group.add(pod);
        const name = textSprite(p.name || "someone", 2.4, { colour: "#ffffff", size: 40, weight: "600" });
        name.position.y = 2.6;
        group.add(name);
        group.position.set(p.x, alt, p.y);
        o = { uid: p.uid, group, name, target: new THREE.Vector3(p.x, alt, p.y), yaw: p.yaw ?? 0, coat: p.coat, at: p.at };
        this.others.set(p.uid, o);
        this.group.add(group);
      } else {
        o.target.set(p.x, alt, p.y);
        o.yaw = p.yaw ?? o.yaw;
        o.at = p.at;
      }
    }
    for (const [uid, o] of this.others) {
      if (keep.has(uid)) continue;
      this.group.remove(o.group);
      o.name.material.dispose();
      this.others.delete(uid);
    }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-2.5 * dt);
    for (const o of this.others.values()) {
      o.group.position.lerp(o.target, k);
      const current = o.group.rotation.y;
      let delta = o.yaw - current;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      o.group.rotation.y = current + delta * k;
    }
  }

  positions(): Array<{ uid: string; x: number; z: number }> {
    return [...this.others.values()].map((o) => ({ uid: o.uid, x: o.group.position.x, z: o.group.position.z }));
  }

  get count() { return this.others.size; }
}

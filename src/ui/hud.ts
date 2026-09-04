// What is on screen while you fly: where you are, which way is north, how high
// and how fast, the minimap, the prompt for the thing in front of you.

import { el } from "./dom";
import { WORLD_LIMIT_M } from "@shared/geo";

export type HudState = {
  city: string;
  street: string | null;
  place: string | null;
  yaw: number;
  alt: number;
  speed: number;
  x: number;
  z: number;
  memories: Array<{ x: number; z: number }>;
  others: Array<{ x: number; z: number }>;
  roads: Array<{ x1: number; z1: number; x2: number; z2: number; major: boolean }>;
  nearest: { dist: number; bearing: number } | null;
};

const MINIMAP_RANGE = 420;

export class Hud {
  readonly root: HTMLElement;
  private cityEl: HTMLElement;
  private streetEl: HTMLElement;
  private placeEl: HTMLElement;
  private compass: HTMLCanvasElement;
  private minimap: HTMLCanvasElement;
  private altEl: HTMLElement;
  private speedEl: HTMLElement;
  private nearestEl: HTMLElement;
  private promptEl: HTMLElement;
  private statusEl: HTMLElement;
  private pointerHint: HTMLElement;
  private toasts: HTMLElement;
  private mapClock = 0;

  constructor(onPointerHint: () => void) {
    this.cityEl = el("div", { class: "city" });
    this.streetEl = el("div", { class: "street" });
    this.placeEl = el("div", { class: "place" });
    this.compass = el("canvas", { width: "440", height: "52" });
    this.minimap = el("canvas", { width: "380", height: "380" });
    this.altEl = el("b");
    this.speedEl = el("b");
    this.nearestEl = el("span");
    this.promptEl = el("div", { class: "prompt" });
    this.statusEl = el("div", { class: "status" });
    this.toasts = el("div", { class: "toasts" });
    this.pointerHint = el("div", { class: "pointer-hint", onclick: onPointerHint },
      "Click to take the controls", el("small", {}, "Esc releases the mouse"));
    this.pointerHint.style.display = "none";

    this.root = el("div", { class: "hud" },
      el("div", { class: "where" }, this.cityEl, this.streetEl, this.placeEl),
      el("div", { class: "gauges" },
        el("div", { class: "compass" }, this.compass),
        el("div", { class: "numbers" },
          el("span", {}, "alt ", this.altEl),
          el("span", {}, "speed ", this.speedEl),
          this.nearestEl),
      ),
      this.statusEl,
      this.promptEl,
      el("div", { class: "minimap" }, this.minimap),
      el("div", { class: "keys" },
        el("div", {}, el("kbd", {}, "W S"), " thrust ", el("kbd", {}, "A D"), " strafe"),
        el("div", {}, el("kbd", {}, "Space"), " rise ", el("kbd", {}, "C"), " dive ", el("kbd", {}, "Shift"), " boost"),
        el("div", {}, el("kbd", {}, "M"), " leave a memory ", el("kbd", {}, "T"), " chat ", el("kbd", {}, "H"), " help"),
      ),
      this.toasts,
      this.pointerHint,
    );
  }

  setPointerHint(show: boolean) { this.pointerHint.style.display = show ? "" : "none"; }

  setStatus(text: string) { this.statusEl.textContent = text; }

  prompt(html: string | null) {
    if (!html) { this.promptEl.classList.remove("on"); return; }
    this.promptEl.innerHTML = html;
    this.promptEl.classList.add("on");
  }

  toast(text: string, isError = false, ms = 3200) {
    const node = el("div", { class: `toast${isError ? " error" : ""}` }, text);
    this.toasts.append(node);
    setTimeout(() => node.remove(), ms);
  }

  update(dt: number, s: HudState) {
    this.cityEl.textContent = s.city;
    this.streetEl.textContent = s.street ?? "somewhere off the street";
    this.placeEl.textContent = s.place ?? "";
    this.altEl.textContent = `${Math.round(s.alt)} m`;
    this.speedEl.textContent = `${Math.round(s.speed * 3.6)} km/h`;
    this.nearestEl.textContent = s.nearest
      ? `nearest memory ${s.nearest.dist < 1000 ? `${Math.round(s.nearest.dist)} m` : `${(s.nearest.dist / 1000).toFixed(1)} km`} ${arrow(s.nearest.bearing + s.yaw)}`
      : "";
    this.drawCompass(s);
    this.mapClock += dt;
    if (this.mapClock > 0.12) { this.mapClock = 0; this.drawMinimap(s); }
  }

  private drawCompass(s: HudState) {
    const g = this.compass.getContext("2d")!;
    const w = this.compass.width, h = this.compass.height;
    g.clearRect(0, 0, w, h);
    // yaw 0 faces -z which is north (data y south means -z is north)
    const heading = -s.yaw; // radians clockwise from north
    const pxPerRad = w / (Math.PI * 1.1);
    g.font = "600 20px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const points: Array<[string, number]> = [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", -Math.PI / 2]];
    for (const [label, angle] of points) {
      let d = angle - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const x = w / 2 + d * pxPerRad;
      if (x < -20 || x > w + 20) continue;
      g.fillStyle = label === "N" ? "#ffb347" : "rgba(246,241,231,0.85)";
      g.fillText(label, x, h / 2 + 1);
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      let d = a - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const x = w / 2 + d * pxPerRad;
      g.fillStyle = "rgba(246,241,231,0.35)";
      g.fillRect(x - 1, h - 10, 2, 6);
    }
    // memories on the compass strip
    for (const m of s.memories) {
      const bearing = Math.atan2(m.x - s.x, -(m.z - s.z));
      let d = bearing - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const x = w / 2 + d * pxPerRad;
      if (x < 0 || x > w) continue;
      g.fillStyle = "#ffb347";
      g.beginPath();
      g.arc(x, 8, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawMinimap(s: HudState) {
    const g = this.minimap.getContext("2d")!;
    const size = this.minimap.width;
    const c = size / 2;
    const scale = c / MINIMAP_RANGE;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(c, c, c - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "rgba(20, 28, 44, 0.6)";
    g.fillRect(0, 0, size, size);
    g.translate(c, c);
    g.rotate(s.yaw); // the map rotates so up is where the nose points
    g.translate(-s.x * scale, -s.z * scale);

    // the edge of the world
    g.strokeStyle = "rgba(255, 140, 120, 0.5)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, WORLD_LIMIT_M * scale, 0, Math.PI * 2);
    g.stroke();

    g.lineCap = "round";
    for (const r of s.roads) {
      g.strokeStyle = r.major ? "rgba(246,241,231,0.7)" : "rgba(246,241,231,0.28)";
      g.lineWidth = r.major ? 3 : 1.5;
      g.beginPath();
      g.moveTo(r.x1 * scale, r.z1 * scale);
      g.lineTo(r.x2 * scale, r.z2 * scale);
      g.stroke();
    }
    for (const o of s.others) {
      g.fillStyle = "#9fd0ff";
      g.beginPath();
      g.arc(o.x * scale, o.z * scale, 4, 0, Math.PI * 2);
      g.fill();
    }
    for (const m of s.memories) {
      g.fillStyle = "#ffb347";
      g.beginPath();
      g.arc(m.x * scale, m.z * scale, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // you, always in the middle, pointing up
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(c, c - 9);
    g.lineTo(c + 6, c + 7);
    g.lineTo(c, c + 3);
    g.lineTo(c - 6, c + 7);
    g.closePath();
    g.fill();
    // north tick on the rim
    g.save();
    g.translate(c, c);
    g.rotate(s.yaw);
    g.fillStyle = "#ffb347";
    g.font = "700 18px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("N", 0, -c + 22);
    g.restore();
  }
}

const arrow = (rel: number) => {
  const a = Math.atan2(Math.sin(rel), Math.cos(rel));
  const eighth = Math.round(a / (Math.PI / 4));
  return ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖", "↑"][((eighth % 8) + 8) % 8];
};

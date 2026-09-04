// On-screen controls for phones: a stick on the left to move, drag on the
// right to look, buttons to rise, dive and boost.

import { el } from "./dom";
import type { Input } from "../engine/input";

export const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

export class TouchControls {
  readonly root: HTMLElement;

  constructor(host: HTMLElement, input: Input, onAction: (action: "read" | "leave" | "help") => void) {
    const knob = el("div", { class: "knob" });
    const stick = el("div", { class: "stick" }, knob);
    const look = el("div", { class: "look" });
    const rise = el("button", { type: "button" }, "▲");
    const dive = el("button", { type: "button" }, "▼");
    const boost = el("button", { type: "button" }, "⚡");
    const read = el("button", { type: "button", onclick: () => onAction("read") }, "E");
    const leave = el("button", { type: "button", onclick: () => onAction("leave") }, "M");
    const help = el("button", { type: "button", onclick: () => onAction("help") }, "?");

    this.root = el("div", { class: "touch" }, stick, look, el("div", { class: "buttons" }, help, leave, read, boost, rise, dive));
    host.append(this.root);

    // the stick: pointer position relative to the centre gives thrust/strafe
    let stickId: number | null = null;
    const radius = 50;
    const moveStick = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > radius) { dx *= radius / len; dy *= radius / len; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      input.setTouch({ strafe: dx / radius, thrust: -dy / radius });
    };
    stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
    stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) moveStick(e); });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = "translate(-50%, -50%)";
      input.setTouch({ strafe: 0, thrust: 0 });
    };
    stick.addEventListener("pointerup", endStick);
    stick.addEventListener("pointercancel", endStick);

    // look: drag anywhere on the right
    let lookId: number | null = null;
    let last = { x: 0, y: 0 };
    look.addEventListener("pointerdown", (e) => { lookId = e.pointerId; last = { x: e.clientX, y: e.clientY }; look.setPointerCapture(e.pointerId); });
    look.addEventListener("pointermove", (e) => {
      if (e.pointerId !== lookId) return;
      input.addTouchLook(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };
    look.addEventListener("pointerup", endLook);
    look.addEventListener("pointercancel", endLook);

    const hold = (button: HTMLButtonElement, on: () => void, off: () => void) => {
      button.addEventListener("pointerdown", (e) => { e.preventDefault(); button.classList.add("on"); on(); });
      const release = () => { button.classList.remove("on"); off(); };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    };
    hold(rise, () => input.setTouch({ rise: 1 }), () => input.setTouch({ rise: 0 }));
    hold(dive, () => input.setTouch({ rise: -1 }), () => input.setTouch({ rise: 0 }));
    hold(boost, () => input.setTouch({ boost: true }), () => input.setTouch({ boost: false }));
  }

  remove() { this.root.remove(); }
}

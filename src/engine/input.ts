// Keyboard, mouse and touch, folded into one frame-by-frame snapshot.
//
// Nothing here knows about the pod. It reports intent: how much to thrust,
// strafe, rise, turn, and whether to boost. The pod turns intent into motion.

export type Intent = {
  /** -1..1: forward along the nose */
  thrust: number;
  /** -1..1: right */
  strafe: number;
  /** -1..1: up */
  rise: number;
  /** radians this frame, from mouse or keys */
  yaw: number;
  pitch: number;
  boost: boolean;
};

export type Action = "read" | "leave" | "chat" | "menu" | "mute" | "map" | "photo" | "help";

type ActionListener = (action: Action) => void;

const KEY_ACTIONS: Record<string, Action> = {
  KeyE: "read", KeyM: "leave", KeyT: "chat", Escape: "menu", KeyN: "mute", Tab: "map", KeyP: "photo", KeyH: "help",
};

/** Mouse sensitivity, radians per pixel. */
const LOOK_SENS = 0.0022;
/** Keyboard turn rate, radians per second. */
const KEY_TURN = 1.8;
const TOUCH_LOOK_SENS = 0.005;

export class Input {
  private keys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private dragging = false;
  private lastDrag: { x: number; y: number } | null = null;
  private actionListeners = new Set<ActionListener>();
  /** When a text field has focus, the keyboard belongs to it. */
  private captured = false;
  private pointerLocked = false;
  private touch = { thrust: 0, strafe: 0, rise: 0, boost: false, lookDx: 0, lookDy: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener("mousemove", (e) => {
      if (this.pointerLocked) {
        this.mouseDx += e.movementX;
        this.mouseDy += e.movementY;
      } else if (this.dragging && this.lastDrag) {
        this.mouseDx += e.clientX - this.lastDrag.x;
        this.mouseDy += e.clientY - this.lastDrag.y;
        this.lastDrag = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastDrag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("mouseup", () => { this.dragging = false; this.lastDrag = null; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Ask the browser to hide the cursor and give us raw mouse motion. */
  lockPointer() {
    if (this.pointerLocked || !this.canvas.requestPointerLock) return;
    try {
      const result = this.canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown;
      if (result instanceof Promise) {
        result.catch(() => {
          // unadjusted movement is not supported everywhere: ask again plainly
          const plain = this.canvas.requestPointerLock() as unknown;
          if (plain instanceof Promise) plain.catch(() => { /* not allowed here */ });
        });
      }
    } catch {
      /* unsupported: drag to look still works */
    }
  }

  unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get locked() { return this.pointerLocked; }

  /** While the UI owns the keyboard (a textarea is open), movement stops. */
  setCaptured(captured: boolean) {
    this.captured = captured;
    if (captured) this.keys.clear();
  }

  onAction(fn: ActionListener) {
    this.actionListeners.add(fn);
    return () => { this.actionListeners.delete(fn); };
  }

  /** Values from an on-screen controller, merged with the keyboard each frame. */
  setTouch(values: Partial<typeof this.touch>) {
    Object.assign(this.touch, values);
  }
  addTouchLook(dx: number, dy: number) {
    this.touch.lookDx += dx;
    this.touch.lookDy += dy;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (e.code === "Escape") {
      // escape always reaches the game, even from a text field
      this.fire("menu");
      return;
    }
    if (typing || this.captured) return;
    const action = KEY_ACTIONS[e.code];
    if (action && !e.repeat) {
      e.preventDefault();
      this.fire(action);
      return;
    }
    if (e.code === "Tab" || e.code === "Space") e.preventDefault();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private fire(action: Action) {
    for (const fn of [...this.actionListeners]) fn(action);
  }

  private held(...codes: string[]) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Read and reset this frame's intent. dt in seconds. */
  read(dt: number): Intent {
    const k = this.captured ? null : this.keys;
    const held = (...codes: string[]) => (k ? this.held(...codes) : false);

    let thrust = (held("KeyW", "ArrowUp") ? 1 : 0) - (held("KeyS", "ArrowDown") ? 1 : 0);
    let strafe = (held("KeyD") ? 1 : 0) - (held("KeyA") ? 1 : 0);
    let rise = (held("Space", "KeyR") ? 1 : 0) - (held("ControlLeft", "ControlRight", "KeyC", "KeyF") ? 1 : 0);
    let yaw = -this.mouseDx * LOOK_SENS - this.touch.lookDx * TOUCH_LOOK_SENS;
    let pitch = -this.mouseDy * LOOK_SENS - this.touch.lookDy * TOUCH_LOOK_SENS;
    if (held("ArrowLeft", "KeyQ")) yaw += KEY_TURN * dt;
    if (held("ArrowRight")) yaw -= KEY_TURN * dt;
    const boost = held("ShiftLeft", "ShiftRight") || this.touch.boost;

    thrust = clamp(thrust + this.touch.thrust);
    strafe = clamp(strafe + this.touch.strafe);
    rise = clamp(rise + this.touch.rise);

    this.mouseDx = 0;
    this.mouseDy = 0;
    this.touch.lookDx = 0;
    this.touch.lookDy = 0;
    return { thrust, strafe, rise, yaw, pitch, boost };
  }
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

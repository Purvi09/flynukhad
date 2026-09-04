// The game loop: a fixed-step simulation and a render every animation frame.
//
// Physics runs at a fixed rate so that collisions and motion are the same on a
// 60 Hz laptop and a 144 Hz monitor. Rendering interpolates nothing; the pod is
// smoothed by the camera's own spring, which is enough at 60 steps a second.

export type Stepper = (dt: number) => void;
export type Renderer = (alpha: number, frameDt: number) => void;

const STEP = 1 / 60;
const MAX_FRAME = 0.1;

export class Loop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(private step: Stepper, private render: Renderer) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const frameDt = Math.min(MAX_FRAME, (now - this.last) / 1000);
      this.last = now;
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === 6) this.acc = 0; // the tab was asleep: do not try to catch up
      this.render(this.acc / STEP, frameDt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

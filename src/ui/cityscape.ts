// The little city along the bottom of the title screen.
//
// Flat, side-on and deliberately sweet: a row of shopfronts and flats, a bus
// going by, a few people out walking, clouds drifting over. The headline sits
// in the sky above it, so nothing has to be dimmed to stay readable.
//
// Two rows of buildings scroll at different speeds, which is the whole trick
// that makes a flat drawing feel like a street.

const STRIP = 2400;

// A happy afternoon: soft blue overhead, warm down at roof height.
const SKY_TOP = "#bfe3ff";
const SKY_MID = "#e6efff";
const SKY_LOW = "#ffe6cf";

const ROAD = "#6d6672";
const ROAD_EDGE = "#5b5560";
const PAVEMENT = "#ece3d6";
const PAVEMENT_EDGE = "#d6caba";

/** Fronts. Bright enough to be cheerful, soft enough to sit under text. */
const FRONTS = ["#f2a6b8", "#f7c775", "#8fd0c4", "#a7c6f0", "#f0a68a", "#c9a8e0", "#f6d5a8", "#9fd68f"];
/** The row behind, already hazed toward the sky. */
const BACK = ["#d9c9e2", "#cfd9ec", "#e6d2d8", "#d3e0da", "#e8dcc9"];
const WINDOW = "#fffaf0";
const WINDOW_LIT = "#ffd97a";
const TRUNK = "#a3714f";
const LEAF = "#6fbf73";
const LEAF_DARK = "#57a85d";

const rand = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

type Building = {
  x: number;
  w: number;
  h: number;
  fill: string;
  cols: number;
  rows: number;
  /** Which windows have a light on. */
  lit: boolean[];
  roof: "flat" | "pitched" | "step";
  /** A striped awning over the shopfront. */
  awning: boolean;
  shop: boolean;
};

type Prop = { x: number; kind: "tree" | "lamp" | "bin" | "post" };
type Walker = { x: number; dir: 1 | -1; speed: number; coat: string; hat: boolean; phase: number };

const COATS = ["#e0697a", "#5b8fc4", "#5faa74", "#e0a63c", "#a97fc9", "#e08a5f"];

const makeRow = (seed: number, near: boolean): Building[] => {
  const r = rand(seed);
  const out: Building[] = [];
  let x = 0;
  while (x < STRIP) {
    const w = near ? 112 + r() * 118 : 92 + r() * 104;
    const h = near ? 104 + r() * 142 : 128 + r() * 128;
    const cols = Math.max(2, Math.round(w / 46));
    const rows = Math.max(2, Math.round((h - 46) / 44));
    const lit: boolean[] = [];
    for (let i = 0; i < cols * rows; i++) lit.push(r() > 0.72);
    out.push({
      x, w, h,
      fill: near ? FRONTS[Math.floor(r() * FRONTS.length)] : BACK[Math.floor(r() * BACK.length)],
      cols, rows, lit,
      roof: r() > 0.78 ? "pitched" : r() > 0.6 ? "step" : "flat",
      awning: near && r() > 0.45,
      shop: near,
    });
    // a generous gap: a crowded skyline stops being cute
    x += w + (near ? 40 + r() * 58 : 26 + r() * 44);
  }
  return out;
};

const makeProps = (seed: number): Prop[] => {
  const r = rand(seed);
  const out: Prop[] = [];
  let x = 40;
  while (x < STRIP) {
    const roll = r();
    out.push({ x, kind: roll > 0.72 ? "lamp" : roll > 0.62 ? "bin" : roll > 0.55 ? "post" : "tree" });
    x += 150 + r() * 190;
  }
  return out;
};

export const cityscape = (): { root: HTMLCanvasElement; stop: () => void } => {
  const canvas = document.createElement("canvas");
  canvas.className = "cityscape";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d")!;

  const back = makeRow(7, false);
  const front = makeRow(23, true);
  const props = makeProps(41);

  const r = rand(99);
  /** Placed across the window on the first frame, once the width is known. */
  const walkers: Walker[] = Array.from({ length: 8 }, () => ({
    x: r(),
    dir: r() > 0.5 ? 1 : -1,
    speed: 16 + r() * 12,
    coat: COATS[Math.floor(r() * COATS.length)],
    hat: r() > 0.6,
    phase: r() * Math.PI * 2,
  }));

  const clouds = Array.from({ length: 5 }, () => ({
    x: r() * 2000,
    y: 40 + r() * 150,
    s: 0.7 + r() * 0.8,
    speed: 4 + r() * 6,
  }));

  let width = 0;
  let height = 0;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };
  resize();

  // ---- shapes ---------------------------------------------------------------------

  const roundRect = (x: number, y: number, w: number, h: number, rad: number) => {
    const k = Math.max(0, Math.min(rad, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - k, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + k);
    ctx.lineTo(x + w, y + h - k);
    ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - k);
    ctx.lineTo(x, y + k);
    ctx.quadraticCurveTo(x, y, x + k, y);
    ctx.closePath();
  };

  const shade = (hex: string, f: number) => {
    const n = parseInt(hex.slice(1), 16);
    const a = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const b = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const c = Math.min(255, Math.round((n & 255) * f));
    return `#${((a << 16) | (b << 8) | c).toString(16).padStart(6, "0")}`;
  };

  const building = (b: Building, x: number, baseY: number, alpha: number) => {
    ctx.globalAlpha = alpha;
    const top = baseY - b.h;

    // roof first, so the body sits in front of it
    if (b.roof === "pitched") {
      ctx.beginPath();
      ctx.moveTo(x - 7, top + 3);
      ctx.lineTo(x + b.w / 2, top - 26);
      ctx.lineTo(x + b.w + 7, top + 3);
      ctx.closePath();
      ctx.fillStyle = shade(b.fill, 0.74);
      ctx.fill();
    } else if (b.roof === "step") {
      ctx.fillStyle = shade(b.fill, 0.8);
      roundRect(x + b.w * 0.26, top - 20, b.w * 0.48, 24, 5);
      ctx.fill();
    }

    ctx.fillStyle = b.fill;
    roundRect(x, top, b.w, b.h, 9);
    ctx.fill();

    // a parapet, which is what tells you it is a building and not a box
    ctx.fillStyle = shade(b.fill, 0.86);
    roundRect(x - 4, top, b.w + 8, 9, 4);
    ctx.fill();

    // windows
    const padX = 13;
    const gapX = (b.w - padX * 2) / b.cols;
    const ww = Math.min(19, gapX - 9);
    const topPad = 26;
    const gapY = (b.h - topPad - (b.shop ? 74 : 20)) / b.rows;
    const wh = Math.min(21, gapY - 11);
    if (ww > 4 && wh > 4) {
      for (let c = 0; c < b.cols; c++) {
        for (let row = 0; row < b.rows; row++) {
          ctx.fillStyle = b.lit[row * b.cols + c] ? WINDOW_LIT : WINDOW;
          roundRect(
            x + padX + c * gapX + (gapX - ww) / 2,
            top + topPad + row * gapY + (gapY - wh) / 2,
            ww, wh, 3.5,
          );
          ctx.fill();
        }
      }
    }

    if (b.shop) {
      // a shopfront: a wide window, a door, and often an awning over both
      const fw = b.w - 26;
      const fx = x + 13;
      const fy = baseY - 52;
      ctx.fillStyle = shade(b.fill, 0.7);
      roundRect(fx, fy, fw, 52, 7);
      ctx.fill();
      ctx.fillStyle = "#bfe0f2";
      roundRect(fx + 6, fy + 8, fw * 0.52, 30, 5);
      ctx.fill();
      ctx.fillStyle = shade(b.fill, 0.52);
      roundRect(fx + fw - 30, fy + 6, 24, 46, 5);
      ctx.fill();
      ctx.fillStyle = WINDOW_LIT;
      ctx.beginPath();
      ctx.arc(fx + fw - 11, fy + 30, 2, 0, Math.PI * 2);
      ctx.fill();

      if (b.awning) {
        const aw = fw + 6;
        const ax = fx - 3;
        const ay = fy - 15;
        const stripes = Math.max(3, Math.round(aw / 18));
        const sw = aw / stripes;
        for (let i = 0; i < stripes; i++) {
          ctx.fillStyle = i % 2 ? "#fffaf0" : "#e0697a";
          ctx.beginPath();
          ctx.moveTo(ax + i * sw, ay);
          ctx.lineTo(ax + (i + 1) * sw, ay);
          ctx.lineTo(ax + (i + 1) * sw - 4, ay + 16);
          ctx.lineTo(ax + i * sw - 4, ay + 16);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  const tree = (x: number, groundY: number) => {
    ctx.fillStyle = TRUNK;
    roundRect(x - 4, groundY - 34, 8, 34, 3);
    ctx.fill();
    ctx.fillStyle = LEAF;
    ctx.beginPath();
    ctx.arc(x, groundY - 50, 19, 0, Math.PI * 2);
    ctx.arc(x - 14, groundY - 39, 14, 0, Math.PI * 2);
    ctx.arc(x + 14, groundY - 39, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LEAF_DARK;
    ctx.beginPath();
    ctx.arc(x + 9, groundY - 45, 10, 0, Math.PI * 2);
    ctx.fill();
  };

  const prop = (kind: Prop["kind"], x: number, groundY: number) => {
    if (kind === "tree") return tree(x, groundY);
    if (kind === "lamp") {
      ctx.fillStyle = "#7d7486";
      roundRect(x - 3, groundY - 74, 6, 74, 3);
      ctx.fill();
      ctx.fillStyle = WINDOW_LIT;
      ctx.beginPath();
      ctx.arc(x, groundY - 78, 8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (kind === "bin") {
      ctx.fillStyle = "#7fae86";
      roundRect(x - 8, groundY - 22, 16, 22, 4);
      ctx.fill();
      ctx.fillStyle = shade("#7fae86", 0.8);
      roundRect(x - 10, groundY - 26, 20, 6, 3);
      ctx.fill();
      return;
    }
    // a postbox, because every street has one
    ctx.fillStyle = "#d4708f";
    roundRect(x - 8, groundY - 30, 16, 30, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRect(x - 5, groundY - 22, 10, 3, 1.5);
    ctx.fill();
  };

  const person = (w: Walker, x: number, groundY: number, t: number) => {
    const swing = Math.sin(t * 5 + w.phase);
    const y = groundY - Math.abs(Math.cos(t * 5 + w.phase)) * 1.6;

    ctx.strokeStyle = "#4a4450";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x + swing * 4, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x - swing * 4, y);
    ctx.stroke();

    ctx.fillStyle = w.coat;
    roundRect(x - 6, y - 27, 12, 15, 5);
    ctx.fill();

    ctx.fillStyle = "#f2cfa8";
    ctx.beginPath();
    ctx.arc(x, y - 32, 5.4, 0, Math.PI * 2);
    ctx.fill();

    if (w.hat) {
      ctx.fillStyle = shade(w.coat, 0.75);
      roundRect(x - 7, y - 37, 14, 4, 2);
      ctx.fill();
      roundRect(x - 4.5, y - 41, 9, 5, 2);
      ctx.fill();
    }
  };

  const wheel = (x: number, y: number, rad: number) => {
    ctx.fillStyle = "#3c3742";
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cfc6d2";
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.42, 0, Math.PI * 2);
    ctx.fill();
  };

  /** The bus. It is the point of the picture, so it gets the detail. */
  const bus = (x: number, groundY: number, t: number) => {
    const w = 210;
    const h = 78;
    const y = groundY - h - 9;

    ctx.fillStyle = "rgba(60, 45, 55, 0.16)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, groundY + 2, w * 0.46, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(0, Math.sin(t * 7) * 0.8); // it rides a little

    ctx.fillStyle = "#d4708f";
    roundRect(x, y, w, h, 16);
    ctx.fill();

    ctx.fillStyle = "#fff6ea";
    roundRect(x + 9, y + 15, w - 18, 34, 8);
    ctx.fill();

    ctx.fillStyle = "#bfe0f2";
    const panes = 4;
    const pw = (w - 34) / panes;
    for (let i = 0; i < panes; i++) {
      roundRect(x + 17 + i * pw, y + 20, pw - 8, 24, 5);
      ctx.fill();
    }

    ctx.fillStyle = "#3f3a46";
    roundRect(x + w - 64, y + 4, 54, 12, 4);
    ctx.fill();
    ctx.fillStyle = "#ffd97a";
    ctx.font = "700 8px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("NUKKAD", x + w - 37, y + 13);
    ctx.textAlign = "left";

    ctx.fillStyle = shade("#d4708f", 0.82);
    roundRect(x + 6, y + 56, w - 12, 6, 3);
    ctx.fill();
    ctx.fillStyle = "#ffe8a8";
    roundRect(x + w - 14, y + 64, 9, 7, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    roundRect(x + w * 0.52, y + 50, 3, h - 58, 1.5);
    ctx.fill();

    ctx.restore();

    wheel(x + 47, groundY - 9, 15);
    wheel(x + w - 47, groundY - 9, 15);
  };

  const car = (x: number, groundY: number, colour: string) => {
    const w = 104;
    const y = groundY - 42;
    ctx.fillStyle = "rgba(60, 45, 55, 0.14)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, groundY + 2, w * 0.44, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = colour;
    roundRect(x + 14, y - 20, w - 36, 25, 10); // cabin
    ctx.fill();
    roundRect(x, y, w, 26, 11);                // body
    ctx.fill();

    ctx.fillStyle = "#bfe0f2";
    roundRect(x + 20, y - 15, 23, 15, 5);
    ctx.fill();
    roundRect(x + 47, y - 15, 21, 15, 5);
    ctx.fill();

    wheel(x + 25, groundY - 6, 11);
    wheel(x + w - 25, groundY - 6, 11);
  };

  const cloud = (x: number, y: number, s: number) => {
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + 24 * s, y + 6 * s, 17 * s, 0, Math.PI * 2);
    ctx.arc(x - 24 * s, y + 7 * s, 15 * s, 0, Math.PI * 2);
    ctx.arc(x + 6 * s, y - 13 * s, 15 * s, 0, Math.PI * 2);
    ctx.fill();
  };

  // ---- the frame ------------------------------------------------------------------

  let busX = Number.NaN; // placed on the first frame, once the width is known
  let carX = Number.NaN;

  const draw = (t: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // the street sits along the bottom; the sky is where the words go
    if (Number.isNaN(busX)) {
      busX = width * 0.16;
      carX = width * 0.66;
      for (const w of walkers) w.x *= width;
    }
    const roadH = Math.max(74, Math.min(104, height * 0.11));
    const roadTop = height - roadH;
    const pavementTop = roadTop - 20;
    const kerb = roadTop - 2;

    const sky = ctx.createLinearGradient(0, 0, 0, roadTop);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(0.55, SKY_MID);
    sky.addColorStop(1, SKY_LOW);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, roadTop);

    const sunX = width * 0.82;
    const sunY = height * 0.13;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 190);
    glow.addColorStop(0, "rgba(255, 233, 173, 0.7)");
    glow.addColorStop(1, "rgba(255, 233, 173, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 190, sunY - 190, 380, 380);
    ctx.fillStyle = "#fff2c9";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
    ctx.fill();

    for (const c of clouds) {
      const span = width + 400;
      const x = (((c.x - t * c.speed) % span) + span) % span - 200;
      cloud(x, c.y, c.s);
    }

    // ---- the two rows of buildings, at different speeds
    const drawRow = (row: Building[], scroll: number, baseY: number, alpha: number) => {
      const off = ((scroll % STRIP) + STRIP) % STRIP;
      for (let pass = 0; pass <= Math.ceil(width / STRIP) + 1; pass++) {
        for (const b of row) {
          const x = b.x - off + (pass - 1) * STRIP;
          if (x + b.w < -70 || x > width + 70) continue;
          building(b, x, baseY, alpha);
        }
      }
    };

    drawRow(back, 0, pavementTop + 12, 0.5);
    drawRow(front, 0, pavementTop, 1);

    // ---- pavement and road
    ctx.fillStyle = PAVEMENT;
    ctx.fillRect(0, pavementTop, width, height - pavementTop);
    ctx.fillStyle = PAVEMENT_EDGE;
    ctx.fillRect(0, pavementTop, width, 3);

    ctx.fillStyle = ROAD;
    ctx.fillRect(0, roadTop, width, roadH);
    ctx.fillStyle = ROAD_EDGE;
    ctx.fillRect(0, roadTop, width, 4);

    ctx.strokeStyle = "rgba(255, 250, 240, 0.72)";
    ctx.lineWidth = 4;
    ctx.setLineDash([34, 30]);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    ctx.moveTo(0, roadTop + roadH * 0.6);
    ctx.lineTo(width, roadTop + roadH * 0.6);
    ctx.stroke();
    ctx.setLineDash([]);

    // ---- street furniture and people, on the pavement
    for (let pass = 0; pass <= Math.ceil(width / STRIP) + 1; pass++) {
      for (const p of props) {
        const x = p.x + (pass - 1) * STRIP;
        if (x < -70 || x > width + 70) continue;
        prop(p.kind, x, kerb);
      }
    }
    for (const w of walkers) person(w, w.x, kerb - 3, t);

    // ---- the traffic
    car(carX, height - 26, "#7fb8d9");
    bus(busX, height - 23, t);
  };

  // ---- the loop -------------------------------------------------------------------

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  let last = performance.now();
  let clock = 0;

  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    busX += 108 * dt;
    if (busX > width + 320) busX = -440;
    carX += 150 * dt;
    if (carX > width + 260) carX = -700 - Math.random() * 900;
    for (const w of walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x > width + 40) w.x = -40;
      if (w.x < -40) w.x = width + 40;
    }

    draw(clock);
    frame = requestAnimationFrame(step);
  };

  const onResize = () => { resize(); if (still) draw(6); };
  window.addEventListener("resize", onResize);

  if (still) draw(6);
  else frame = requestAnimationFrame(step);

  return {
    root: canvas,
    stop: () => { cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); },
  };
};

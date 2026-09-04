// Sound, synthesised with WebAudio. No audio files to load or get wrong.
//
// Browsers refuse to make sound until the player has interacted, so the
// context is created lazily on the first gesture.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const KEY = "nukhad.muted";

export const soundMuted = () => muted;

export const initSound = () => {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    try { muted = window.localStorage.getItem(KEY) === "1"; } catch { /* fine */ }
    if (muted) master.gain.value = 0;
  } catch {
    ctx = null;
  }
  return ctx;
};

export const toggleMuted = () => {
  muted = !muted;
  try { window.localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* fine */ }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return muted;
};

const ready = () => {
  const c = ctx ?? initSound();
  if (!c || !master) return null;
  if (c.state === "suspended") void c.resume();
  return c;
};

/** A pulse wave, the way the NES made them: narrow duties are bright and thin. */
const pulseCache = new Map<number, PeriodicWave>();
const pulse = (c: AudioContext, duty: number) => {
  const cached = pulseCache.get(duty);
  if (cached) return cached;
  const n = 24;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  }
  const wave = c.createPeriodicWave(real, imag, { disableNormalization: false });
  pulseCache.set(duty, wave);
  return wave;
};

type Note = { freq: number; at: number; dur: number; duty?: number; gain?: number };

const play = (notes: Note[]) => {
  const c = ready();
  if (!c || !master || muted) return;
  const t0 = c.currentTime;
  for (const n of notes) {
    const osc = c.createOscillator();
    osc.setPeriodicWave(pulse(c, n.duty ?? 0.25));
    osc.frequency.value = n.freq;
    const g = c.createGain();
    const gain = n.gain ?? 0.12;
    g.gain.setValueAtTime(0, t0 + n.at);
    g.gain.linearRampToValueAtTime(gain, t0 + n.at + 0.01);
    g.gain.setTargetAtTime(0, t0 + n.at + n.dur * 0.7, n.dur * 0.15);
    osc.connect(g).connect(master);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.1);
  }
};

/** A soft chime when a memory comes within reach. */
export const nearSound = () => play([
  { freq: 659, at: 0, dur: 0.12, gain: 0.07 },
  { freq: 988, at: 0.1, dur: 0.18, gain: 0.07 },
]);

/** The memory opens. */
export const openSound = () => play([
  { freq: 523, at: 0, dur: 0.1, gain: 0.06, duty: 0.125 },
  { freq: 784, at: 0.08, dur: 0.14, gain: 0.06, duty: 0.125 },
  { freq: 1047, at: 0.16, dur: 0.22, gain: 0.06, duty: 0.125 },
]);

/** A memory has been left. */
export const postSound = () => play([
  { freq: 392, at: 0, dur: 0.12, gain: 0.08 },
  { freq: 523, at: 0.1, dur: 0.12, gain: 0.08 },
  { freq: 659, at: 0.2, dur: 0.12, gain: 0.08 },
  { freq: 784, at: 0.3, dur: 0.35, gain: 0.08 },
]);

export const clickSound = () => play([{ freq: 880, at: 0, dur: 0.05, gain: 0.05, duty: 0.5 }]);

export const bumpSound = () => play([{ freq: 110, at: 0, dur: 0.08, gain: 0.1, duty: 0.5 }]);

/** The pod's hum: a low tone whose pitch and volume follow speed. */
let hum: { osc: OscillatorNode; gain: GainNode; sub: OscillatorNode } | null = null;

export const setHum = (speed01: number, boosting: boolean) => {
  const c = ready();
  if (!c || !master) return;
  if (!hum) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    const sub = c.createOscillator();
    sub.type = "sine";
    const gain = c.createGain();
    gain.gain.value = 0;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    sub.start();
    hum = { osc, gain, sub };
  }
  const target = muted ? 0 : 0.02 + speed01 * 0.06 + (boosting ? 0.03 : 0);
  hum.gain.gain.setTargetAtTime(target, c.currentTime, 0.15);
  hum.osc.frequency.setTargetAtTime(70 + speed01 * 90 + (boosting ? 40 : 0), c.currentTime, 0.2);
  hum.sub.frequency.setTargetAtTime(38 + speed01 * 30, c.currentTime, 0.2);
};

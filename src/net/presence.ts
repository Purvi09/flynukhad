// Who else is flying this city right now.
//
// Presence is deliberately cheap: a position is only written when it has
// actually changed, never while the tab is hidden, and never more than every
// few seconds. The document shape extends the original game's with height and
// heading, which its rules allow.

import { collection, deleteDoc, doc, limit, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { currentUid, db, firebaseReady } from "./firebase";

export type Explorer = {
  uid: string;
  city: string;
  name: string;
  /** hull tint as 0xRRGGBB */
  coat: number;
  x: number;
  y: number;
  /** metres above ground */
  alt?: number;
  /** radians */
  yaw?: number;
  at: number;
};

export type Pose = { x: number; y: number; alt: number; yaw: number };

const STALE_AFTER = 90_000;
const MIN_GAP = 2_500;
const MIN_MOVE = 6;
const MIN_TURN = 0.35;
const KEEPALIVE = 40_000;

let myUid: string | null = null;

export const joinCity = async (city: string, who: { name: string; coat: number }, pose: () => Pose) => {
  const store = firebaseReady ? db() : null;
  const uid = await currentUid();
  if (!store || !uid) return () => {};
  myUid = uid;
  const key = `${city}__${uid}`;
  let lastWrite = 0;
  let last: Pose = { x: NaN, y: NaN, alt: NaN, yaw: NaN };

  const write = async (force = false) => {
    if (document.hidden && !force) return;
    const p = pose();
    const now = Date.now();
    const moved = Math.hypot(p.x - last.x, p.y - last.y, p.alt - last.alt);
    const turned = Math.abs(p.yaw - last.yaw);
    if (!force && now - lastWrite < MIN_GAP) return;
    if (!force && moved < MIN_MOVE && turned < MIN_TURN && now - lastWrite < KEEPALIVE) return;
    lastWrite = now;
    last = { ...p };
    try {
      await setDoc(doc(store, "presence", key), {
        uid, city, name: who.name, coat: who.coat,
        x: Math.round(p.x), y: Math.round(p.y), alt: Math.round(p.alt * 10) / 10, yaw: Math.round(p.yaw * 100) / 100,
        at: now, touched: serverTimestamp(),
      });
    } catch { /* presence is a nicety; never break the game over it */ }
  };

  await write(true);
  const timer = window.setInterval(() => void write(), 1_000);
  const leave = () => {
    window.clearInterval(timer);
    void deleteDoc(doc(store, "presence", key)).catch(() => {});
  };
  window.addEventListener("pagehide", leave);
  return () => { window.removeEventListener("pagehide", leave); leave(); };
};

/** Everyone currently in this city, yourself excluded. */
export const watchCity = (city: string, onChange: (people: Explorer[]) => void) => {
  const store = firebaseReady ? db() : null;
  if (!store) return () => {};
  const q = query(collection(store, "presence"), where("city", "==", city), limit(80));
  return onSnapshot(q, (snap) => {
    const cutoff = Date.now() - STALE_AFTER;
    onChange(snap.docs
      .map((d) => d.data() as Explorer)
      .filter((p) => p.uid !== myUid && typeof p.at === "number" && p.at > cutoff));
  }, () => onChange([]));
};

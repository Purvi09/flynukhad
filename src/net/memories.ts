// Memories: what a person remembers about a place, stored against the place.
//
// The schema matches the original game's Firestore collection and rules, so
// every memory anyone has already left is still found here. Falls back to the
// browser's own storage when Firestore is not configured or refuses.

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadString } from "firebase/storage";
import { currentUid, db, firebaseReady, storage } from "./firebase";
import { citySlug, toLatLon, toMetres, WORLD_LIMIT_M, type LatLon } from "@shared/geo";

/** Memories are found by where they are, not by what a geocoder called the city. */
const RANGE_M = WORLD_LIMIT_M + 200;
const M_PER_DEG_LAT = 110574;
const latBand = (centre: LatLon) => ({ south: centre.lat - RANGE_M / M_PER_DEG_LAT, north: centre.lat + RANGE_M / M_PER_DEG_LAT });
const withinRange = (centre: LatLon) => (m: Memory) => {
  if (typeof m.lat !== "number" || typeof m.lon !== "number") return false;
  const at = toMetres(centre, m.lat, m.lon);
  return Math.hypot(at.x, at.y) <= RANGE_M;
};

export type Memory = {
  id: string;
  /** Slug of the city, so a place can be looked up without a geo query. */
  city: string;
  /** Metres from the city centre: x east, y south. Re-projected on load. */
  x: number;
  y: number;
  lat: number;
  lon: number;
  /** The public place it was pinned to, never a raw address. */
  place: string;
  text: string;
  /** Kept because the deployed Firestore rules validate it. */
  shareAsMystery: boolean;
  /** Anonymous uid of whoever left it, so only they can remove it. */
  author: string;
  /** The first name they gave. */
  by: string;
  photo?: string;
  sample?: boolean;
  at: number;
  /** Metres above the street where it was left. Optional: the old game had no height. */
  alt?: number;
};

const LOCAL_KEY = "nukhad.memories";

const readLocal = (): Memory[] => {
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "[]") as Memory[];
  } catch {
    return [];
  }
};

const writeLocal = (all: Memory[]) => {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(-300)));
  } catch { /* storage full or blocked */ }
};

export type NewMemory = {
  city: string;
  centre: LatLon;
  x: number;
  y: number;
  alt: number;
  place: string;
  text: string;
  by: string;
  /** data: URL, already checked by the moderation route. */
  photo?: string;
};

/** Store a memory. Returns it as saved, wherever it ended up. */
export const saveMemory = async (input: NewMemory): Promise<Memory> => {
  const at = toLatLon(input.centre, input.x, input.y);
  const uid = (await currentUid()) ?? "local";

  let photo: string | undefined;
  if (input.photo && uid !== "local") {
    const bucket = firebaseReady ? storage() : null;
    if (bucket) {
      try {
        const handle = ref(bucket, `memories/${uid}/${Date.now()}`);
        await uploadString(handle, input.photo, "data_url");
        photo = await getDownloadURL(handle);
      } catch { /* keep the words even if the picture will not go */ }
    }
  }

  const record: Omit<Memory, "id"> = {
    city: citySlug(input.city),
    x: Math.round(input.x),
    y: Math.round(input.y),
    lat: at.lat,
    lon: at.lon,
    alt: Math.round(Math.max(0, input.alt) * 10) / 10,
    place: input.place,
    text: input.text,
    by: input.by,
    shareAsMystery: false,
    ...(photo ? { photo } : {}),
    author: uid,
    at: Date.now(),
  };

  const store = firebaseReady ? db() : null;
  if (store && uid !== "local") {
    try {
      const created = await addDoc(collection(store, "memories"), { ...record, created: serverTimestamp() });
      return { ...record, id: created.id };
    } catch (caught) {
      console.warn("firestore refused the memory; keeping it locally", caught);
    }
  }
  const local: Memory = { ...record, id: `local-${record.at}` };
  writeLocal([...readLocal(), local]);
  return local;
};

const mergeLocal = (remote: Memory[], centre: LatLon) => {
  const inRange = withinRange(centre);
  const local = readLocal().filter(inRange);
  const seen = new Set(remote.map((m) => `${m.at}-${m.author}`));
  return [...remote.filter(inRange), ...local.filter((m) => !seen.has(`${m.at}-${m.author}`))].sort((a, b) => b.at - a.at);
};

const geoQuery = (centre: LatLon) => {
  const store = db()!;
  const band = latBand(centre);
  return query(collection(store, "memories"), where("lat", ">=", band.south), where("lat", "<=", band.north), limit(600));
};

/** Every memory left within reach of this city's centre, newest first. */
export const listMemories = async (centre: LatLon): Promise<Memory[]> => {
  const store = firebaseReady ? db() : null;
  if (!store) return mergeLocal([], centre);
  try {
    const snapshot = await getDocs(geoQuery(centre));
    return mergeLocal(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Memory, "id">) })), centre);
  } catch (caught) {
    console.warn("could not list memories", caught);
    return mergeLocal([], centre);
  }
};

/** Live updates: someone else leaves a memory while you are here, and it appears. */
export const watchMemories = (centre: LatLon, onChange: (list: Memory[]) => void): (() => void) => {
  const store = firebaseReady ? db() : null;
  if (!store) { onChange(mergeLocal([], centre)); return () => {}; }
  return onSnapshot(geoQuery(centre),
    (snap) => onChange(mergeLocal(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Memory, "id">) })), centre)),
    (caught) => { console.warn("memories watch failed", caught); onChange(mergeLocal([], centre)); },
  );
};

/** One memory by id, for a link someone was sent. */
export const getMemory = async (id: string): Promise<Memory | null> => {
  if (id.startsWith("local-")) return readLocal().find((m) => m.id === id) ?? null;
  const store = firebaseReady ? db() : null;
  if (!store) return null;
  try {
    const snap = await getDoc(doc(store, "memories", id));
    return snap.exists() ? { id: snap.id, ...(snap.data() as Omit<Memory, "id">) } : null;
  } catch {
    return null;
  }
};

/**
 * Memories are stored in metres from the centre they were built against. A
 * city geocoded a little differently needs them re-projected from lat/lon.
 */
export const rehome = (list: Memory[], centre: LatLon): Memory[] =>
  list.map((m) => {
    if (typeof m.lat !== "number" || typeof m.lon !== "number") return m;
    const at = toMetres(centre, m.lat, m.lon);
    return { ...m, x: Math.round(at.x), y: Math.round(at.y) };
  });

/** Only the person who left it may take it down. */
export const removeMemory = async (memory: Memory): Promise<boolean> => {
  if (memory.id.startsWith("local-")) {
    writeLocal(readLocal().filter((m) => m.id !== memory.id));
    return true;
  }
  const store = firebaseReady ? db() : null;
  if (!store) return false;
  try {
    await deleteDoc(doc(store, "memories", memory.id));
    return true;
  } catch {
    return false;
  }
};

export const isMine = async (memory: Memory) => {
  if (memory.id.startsWith("local-")) return true;
  const uid = await currentUid();
  return Boolean(uid && uid === memory.author);
};

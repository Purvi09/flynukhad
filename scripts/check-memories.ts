// What the game will actually find, for each centre a demo is likely to open.
// Runs the same latitude-band query and longitude filter the client does.

import { config } from "dotenv";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { collection, getDocs, getFirestore, limit, query, where } from "firebase/firestore";
import { toMetres, WORLD_LIMIT_M, type LatLon } from "../shared/geo";

config();

const CENTRES: Array<[string, LatLon]> = [
  ["Bengaluru", { lat: 12.9628957, lon: 77.57754 }],
  ["Indiranagar", { lat: 12.9783692, lon: 77.6408356 }],
  ["Old Delhi", { lat: 28.6562814, lon: 77.2321071 }],
  ["New Delhi", { lat: 28.6139298, lon: 77.2088282 }],
];
const M_PER_DEG_LAT = 110574;
const RANGE = WORLD_LIMIT_M + 200;

const main = async () => {
  const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  });
  await signInAnonymously(getAuth(app));
  const store = getFirestore(app);

  for (const [name, centre] of CENTRES) {
    const snap = await getDocs(query(
      collection(store, "memories"),
      where("lat", ">=", centre.lat - RANGE / M_PER_DEG_LAT),
      where("lat", "<=", centre.lat + RANGE / M_PER_DEG_LAT),
      limit(600),
    ));
    const near = snap.docs
      .map((d) => d.data() as { lat: number; lon: number; place: string; by: string })
      .filter((m) => {
        const at = toMetres(centre, m.lat, m.lon);
        return Math.hypot(at.x, at.y) <= RANGE;
      });
    console.log(`\n${name} — ${near.length} in reach (${snap.size} in the latitude band)`);
    for (const m of near) console.log(`    ${m.place} — ${m.by}`);
  }
};

void main().then(() => process.exit(0));

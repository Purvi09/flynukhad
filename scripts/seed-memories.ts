// Seed memories for a demo, against the same Firestore the game writes to.
//
// Memories are found by latitude band and a longitude filter around whatever
// centre the geocoder gives a city, and the playable world is only 3.48 km
// across, so each of these is pinned to a place that actually falls inside one
// of the four cities a demo is likely to open. Every one is marked
// `sample: true`, which the read panel shows, and which makes them easy to find
// again in the console.
//
//   npx tsx scripts/seed-memories.ts          # print what would be written
//   npx tsx scripts/seed-memories.ts --write  # actually write it
//
//   npx tsx scripts/seed-memories.ts --unseed # take them all down again
//
// Firestore rules forbid editing a memory and only let its author delete it, so
// a run keeps the anonymous session's refresh token alongside the ids it wrote,
// in .cache/seeded-memories.json. --unseed trades that token for a fresh one
// and deletes them over the REST API as the same author. Keep that file if you
// ever want the seeds gone; without it, only the Firebase console can remove
// them.

import { config } from "dotenv";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { addDoc, collection, getFirestore, serverTimestamp } from "firebase/firestore";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { citySlug, toMetres, WORLD_LIMIT_M, type LatLon } from "../shared/geo";

config();

const LEDGER = ".cache/seeded-memories.json";

/** The centres the geocoder actually returns, checked against the running server. */
const CENTRES: Record<string, { label: string; centre: LatLon }> = {
  bengaluru: { label: "Bengaluru, India", centre: { lat: 12.9628957, lon: 77.57754 } },
  indiranagar: { label: "Indiranagar, India", centre: { lat: 12.9783692, lon: 77.6408356 } },
  "old-delhi": { label: "Old Delhi, India", centre: { lat: 28.6562814, lon: 77.2321071 } },
  "new-delhi": { label: "New Delhi, India", centre: { lat: 28.6139298, lon: 77.2088282 } },
};

type Seed = {
  /** Which of the centres above this one is meant to be found from. */
  home: keyof typeof CENTRES;
  place: string;
  lat: number;
  lon: number;
  by: string;
  /** Metres above the street, so it does not sit in the tarmac. */
  alt: number;
  text: string;
};

const SEEDS: Seed[] = [
  // ---- Bengaluru, from the city centre --------------------------------------
  {
    home: "bengaluru", place: "Lalbagh Glass House", lat: 12.9507, lon: 77.5848, by: "Meera", alt: 6,
    text: "My grandmother brought me here every January for the flower show. She never looked at the flowers. She came for the queue — she said you could hear the whole city complaining in four languages at once, and that was the real exhibition.",
  },
  {
    home: "bengaluru", place: "Cubbon Park bandstand", lat: 12.9763, lon: 77.5929, by: "Arjun", alt: 4,
    text: "I failed an interview two streets away and sat here for three hours afterwards. A man walking eleven dogs stopped and told me the trees were older than the building that rejected me. It did not fix anything. It helped.",
  },
  {
    home: "bengaluru", place: "Gandhi Bazaar, Basavanagudi", lat: 12.9450, lon: 77.5720, by: "Lakshmi", alt: 3,
    text: "The flower sellers here have not moved in forty years. The same woman has sold my mother mallige every Friday since before I was born, and she still asks after my knee, which I hurt in 2009.",
  },
  {
    home: "bengaluru", place: "Vidhana Soudha, north steps", lat: 12.9794, lon: 77.5912, by: "Ravi", alt: 12,
    text: "On Sunday nights they light this whole thing up and half of Bangalore drives past slowly with the windows down. My father used to call it the world's most expensive streetlamp. He never missed a Sunday.",
  },
  {
    home: "bengaluru", place: "Church Street", lat: 12.9752, lon: 77.6040, by: "Nikhil", alt: 3,
    text: "They repaved this street in cobblestone and everyone complained for a year. Then it rained and the whole road turned the colour of old copper, and nobody has complained since.",
  },
  {
    home: "bengaluru", place: "Koshy's, St Mark's Road", lat: 12.9738, lon: 77.6000, by: "Fatima", alt: 4,
    text: "Four of us split one plate of chilli chicken here for two hours because none of us could afford more and none of us wanted to leave. The waiter knew exactly what we were doing and refilled the water eleven times without a word.",
  },
  {
    home: "bengaluru", place: "Bull Temple Road", lat: 12.9426, lon: 77.5650, by: "Sundar", alt: 3,
    text: "The peanut fair takes over this entire road once a year and the smell gets into your clothes for a week. As a child I thought it happened because the bull liked peanuts. Nobody has ever given me a better explanation.",
  },
  {
    home: "bengaluru", place: "Tipu Sultan's Summer Palace", lat: 12.9591, lon: 77.5738, by: "Anita", alt: 5,
    text: "Teak pillars, and cool inside even in April. I brought someone here on a second date because I could not afford lunch. We stayed until closing and he still married me.",
  },
  // ---- Indiranagar ----------------------------------------------------------
  {
    home: "indiranagar", place: "100 Feet Road", lat: 12.9718, lon: 77.6412, by: "Divya", alt: 6,
    text: "I moved to this road when it was tailors and one bakery. Now it is glass fronts and valet parking, and the bakery is still there, and the man behind the counter still short-changes himself in your favour.",
  },
  {
    home: "indiranagar", place: "Halasuru Lake, east bank", lat: 12.9829, lon: 77.6206, by: "Imran", alt: 3,
    text: "Six in the morning, the rowers are out and the water is completely flat, and for about ten minutes you cannot hear a single horn anywhere in Bangalore. I have never managed to explain to anyone why I get up for this.",
  },
  {
    home: "indiranagar", place: "CMH Road", lat: 12.9784, lon: 77.6373, by: "Priya", alt: 4,
    text: "My first paycheque went on a saree from a shop on this road that no longer exists. I still have it. It is the wrong colour for me and I have never once regretted it.",
  },
  {
    home: "indiranagar", place: "Indiranagar Metro, under the viaduct", lat: 12.9784, lon: 77.6386, by: "Kabir", alt: 8,
    text: "We used to say Bangalore would never get a metro. I said it. I said it loudly, at parties. Now I ride it to work and pretend I always believed.",
  },
  // ---- Old Delhi ------------------------------------------------------------
  {
    home: "old-delhi", place: "Paranthe Wali Gali", lat: 28.6562, lon: 77.2300, by: "Zoya", alt: 3,
    text: "The lane is so narrow that two people cannot pass without one turning sideways, and there is hot oil on both sides of you the entire way. My uncle brought me here at seven years old and told me to keep my elbows in. Still the best advice I have been given.",
  },
  {
    home: "old-delhi", place: "Jama Masjid, south steps", lat: 28.6507, lon: 77.2334, by: "Salim", alt: 8,
    text: "Sit on these steps at dusk and the pigeons go up all at once when the call starts. Everyone stops talking, not out of piety, just because it is loud. Then it settles and the bargaining starts again mid-sentence.",
  },
  {
    home: "old-delhi", place: "Kinari Bazaar", lat: 28.6558, lon: 77.2295, by: "Nandita", alt: 4,
    text: "Every wedding in my family for three generations has been decorated out of this one lane. My mother knows which shop has the good gota by the smell of the doorway. I have tried to learn and I cannot.",
  },
  {
    home: "old-delhi", place: "Khari Baoli spice market", lat: 28.6570, lon: 77.2200, by: "Hari", alt: 4,
    text: "Nobody warns you that you will sneeze for twenty minutes straight. Everyone who works here watched me do it with complete indifference, which I respected enormously.",
  },
  {
    home: "old-delhi", place: "Daryaganj Sunday book bazaar", lat: 28.6440, lon: 77.2410, by: "Rehan", alt: 3,
    text: "I found a 1961 Delhi street atlas here for thirty rupees. Half the roads in it have different names now. I use it to find out what my own neighbourhood used to be called.",
  },
  {
    home: "old-delhi", place: "Red Fort, Lahori Gate", lat: 28.6562, lon: 77.2410, by: "Aisha", alt: 10,
    text: "My school made us come every Independence Day and we all complained about the heat. My grandfather came once, on his own, in November, and did not say anything for the whole walk back.",
  },
  {
    home: "old-delhi", place: "Kashmere Gate", lat: 28.6675, lon: 77.2283, by: "Vikram", alt: 5,
    text: "Three metro lines meet under here now. Above it there is still a wall with holes in it from 1857 and a plaque that most people walk past on their way to the platform.",
  },
  // ---- New Delhi ------------------------------------------------------------
  {
    home: "new-delhi", place: "India Gate lawns", lat: 28.6129, lon: 77.2295, by: "Sanjay", alt: 4,
    text: "In summer nobody arrives before nine at night. Then the whole lawn fills up with families and ice cream carts and it stays that way until one in the morning. My son learned to walk here, between two picnic blankets that were not ours.",
  },
  {
    home: "new-delhi", place: "Lodhi Garden, Bara Gumbad", lat: 28.5931, lon: 77.2197, by: "Tara", alt: 6,
    text: "Six hundred years old, and there are people doing laughter yoga in the shade of it every single morning. Delhi's whole personality in one lawn.",
  },
  {
    home: "new-delhi", place: "Connaught Place, inner circle", lat: 28.6315, lon: 77.2167, by: "Rohit", alt: 6,
    text: "I have walked the wrong way around this circle for fifteen years. Everyone has. There is no correct way around this circle. Anyone who tells you otherwise is lying to seem competent.",
  },
  {
    home: "new-delhi", place: "Agrasen ki Baoli", lat: 28.6254, lon: 77.2251, by: "Ishaan", alt: 3,
    text: "You are on a street of office towers and then you turn a corner and there is a dry stepwell a hundred and eight steps deep with pigeons living in the walls. Nobody in the buildings around it seems to know it is there.",
  },
  {
    home: "new-delhi", place: "Khan Market back lane", lat: 28.6002, lon: 77.2270, by: "Naina", alt: 4,
    text: "The front is all expensive coffee. Go round the back and it is still tailors, a cobbler, and a man who has sharpened knives in the same spot since the seventies. Both of those are Khan Market, and only one of them will still be here in ten years.",
  },
  {
    home: "new-delhi", place: "Bengali Market", lat: 28.6289, lon: 77.2236, by: "Aditya", alt: 4,
    text: "We came here after every exam, all through school, for one plate of chaat each. We failed a lot of exams. It was, in hindsight, the best part of the arrangement.",
  },
];

const check = () => {
  const rows: string[] = [];
  let bad = 0;
  for (const seed of SEEDS) {
    const home = CENTRES[seed.home];
    const at = toMetres(home.centre, seed.lat, seed.lon);
    const away = Math.hypot(at.x, at.y);
    const ok = away <= WORLD_LIMIT_M && seed.text.length >= 12 && seed.text.length <= 400;
    if (!ok) bad += 1;
    rows.push(
      `${ok ? "  " : "!!"} ${home.label.split(",")[0].padEnd(12)} ${String(Math.round(away)).padStart(5)} m  ` +
      `${seed.place.padEnd(34)} ${String(seed.text.length).padStart(3)} chars`,
    );
  }
  console.log(rows.join("\n"));
  console.log(`\n${SEEDS.length} memories, ${bad} out of range or over length. World limit is ${WORLD_LIMIT_M} m.`);
  return bad === 0;
};

const write = async () => {
  const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  });
  const { user } = await signInAnonymously(getAuth(app));
  const store = getFirestore(app);
  console.log(`signed in as ${user.uid}`);

  const written: Array<{ id: string; place: string; city: string }> = [];
  for (const seed of SEEDS) {
    const home = CENTRES[seed.home];
    const at = toMetres(home.centre, seed.lat, seed.lon);
    const record = {
      city: citySlug(home.label),
      x: Math.round(at.x),
      y: Math.round(at.y),
      lat: seed.lat,
      lon: seed.lon,
      alt: seed.alt,
      place: seed.place,
      text: seed.text,
      by: seed.by,
      shareAsMystery: false,
      sample: true,
      author: user.uid,
      at: Date.now(),
    };
    const created = await addDoc(collection(store, "memories"), { ...record, created: serverTimestamp() });
    written.push({ id: created.id, place: seed.place, city: record.city });
    console.log(`  ${created.id}  ${seed.place}`);
  }

  mkdirSync(".cache", { recursive: true });
  writeFileSync(LEDGER, JSON.stringify({
    uid: user.uid,
    // the one thing that makes this reversible: only the author may delete
    refreshToken: user.refreshToken,
    at: Date.now(),
    written,
  }, null, 2));
  console.log(`\n${written.length} written. Ids and the key to remove them are in ${LEDGER}`);
};

/** Take the last run back down, as the same anonymous author that wrote it. */
const unseed = async () => {
  if (!existsSync(LEDGER)) { console.error(`no ${LEDGER}: nothing recorded to take down`); process.exit(1); }
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
    uid: string; refreshToken: string; written: Array<{ id: string; place: string }>;
  };

  const key = process.env.VITE_FIREBASE_API_KEY;
  const project = process.env.VITE_FIREBASE_PROJECT_ID;
  const refreshed = await fetch(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: ledger.refreshToken }),
  });
  if (!refreshed.ok) { console.error(`could not sign back in as ${ledger.uid}: ${await refreshed.text()}`); process.exit(1); }
  const { id_token: idToken } = await refreshed.json() as { id_token: string };

  let gone = 0;
  for (const row of ledger.written) {
    const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/memories/${row.id}`;
    const res = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${idToken}` } });
    console.log(`  ${res.ok ? "gone " : "kept "} ${row.id}  ${row.place}${res.ok ? "" : ` (${res.status})`}`);
    if (res.ok) gone += 1;
  }
  console.log(`\n${gone} of ${ledger.written.length} removed.`);
};

const main = async () => {
  if (process.argv.includes("--unseed")) { await unseed(); return; }
  if (!check()) { console.error("\nfix the flagged rows first"); process.exit(1); }
  if (!process.argv.includes("--write")) {
    console.log("\ndry run. pass --write to save these to Firestore.");
    return;
  }
  await write();
};

void main().then(() => process.exit(0));

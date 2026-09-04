# Nukhad v2

*Nukhad* — the street corner. The tea stall, the bench, the place a
neighbourhood gathers and stories go round.

Fly any real city, drawn street for street from open map data. Find the
memories people left where they happened, and leave your own.

> Google Maps shows you where places are. Wikipedia tells you what happened
> there. This shows you what people remember there.

This is a from-scratch rebuild of the 2D isometric original as a 3D world. You
pilot a small pod, Subnautica-style, from a third-person camera behind it:
the mouse points the nose, `W` thrusts along it, `Space` and `C` rise and
dive, `Shift` boosts. The city is real: every street, building footprint,
storey count, park, river and street tree comes from OpenStreetMap.

## What it does

**Any city, built on demand.** Type a name and the place assembles in ten to
thirty seconds. Lisbon arrives as 5,900 buildings, 1,800 streets, 1,500 trees
and 650 named places in the first 2.4 km square, then streams outward in
400 m tiles as you fly, out to about 3.5 km from the centre.

**Memories pinned to real ground.** Leave one anywhere, at any height, with a
photograph if you like. It becomes a lantern, glowing where you left it.
Anyone flying that street later finds it, reads what happened to you there,
and can copy a link that builds the city around it for a friend. Memories left
with the original 2D game show up too: they are found by latitude and
longitude, not by whatever a geocoder called the city that day.

**A city you share.** Everyone in the same city sees each other's pods with
names above them, and there is a text channel per city.

**Moderated before anyone sees it.** Gemini checks every memory for surnames,
contact details, private addresses and abuse, and looks at every photograph
before it is uploaded anywhere. First names only, always.

## Running it

```bash
npm install
cp .env.example .env      # or copy the original game's .env: both key names work
npm run dev               # server on :8787, client on :5173
```

`.env` needs:

```
GEMINI_API_KEY=…                 # Google AI Studio. Server-side only.
GOOGLE_MAPS_API_KEY=…            # Geocoding + Street View Static. Server-side only.
VITE_FIREBASE_API_KEY=…          # and the rest of the Firebase web config
VITE_FIREBASE_PROJECT_ID=…
…
```

The `NEXT_PUBLIC_*` names from the original project are also read for the
Maps key. `VITE_FIREBASE_*` must be present for the browser.

Everything degrades rather than breaking. Without Gemini, memories are still
checked mechanically for contact details and the app says moderation is off.
Without Firebase, memories live in browser storage and nobody else is visible.
Without a billed Maps key, cities are geocoded with Nominatim and there is no
Street View photograph. A town OpenStreetMap has not mapped is refused with a
clear message.

## Controls

| | |
|---|---|
| Mouse | point the nose (click the view to capture the mouse, `Esc` releases it) |
| `W` `S` | thrust forward and back along the nose |
| `A` `D` | strafe |
| `Space` `C` | rise and dive |
| `Shift` | boost |
| `E` | read the memory you are next to |
| `M` | leave a memory where you are |
| `T` | city chat |
| `P` | the Street View photograph of where you are |
| `H` | help, sound, change city |
| Scroll | camera distance |

On a phone: a stick on the left to move, drag on the right to look, buttons
to rise, dive and boost.

## How it is put together

```
shared/geo.ts        projection, tile maths, types shared by both ends
server/              Hono on Node
  overpass.ts        one request at a time, seven mirrors, disk cache in .cache/
  features.ts        Overpass elements -> projected, de-cluttered, capped tiles
  geocode.ts         Google, then Nominatim, English labels
  moderate.ts        the rules a memory must pass, and Gemini applying them
  gemini.ts          model rotation that survives per-model quotas
  streetview.ts      the photograph, proxied so the key stays here
src/
  engine/            fixed-step loop, input (keyboard, pointer lock, touch), events
  world/build.ts     OSM -> merged geometry: extruded buildings with window
                     facades, mitred road ribbons with kerbs, parks, water,
                     instanced trees. One draw call per feature class per tile.
  world/tiles.ts     streaming: fetch near, drop far, one tile built per frame,
                     labels ranked by distance
  world/collision.ts spatial hash; sphere vs extruded polygons; street lookup
  player/pod.ts      6DOF flight with drag, banking, world edge
  player/camera.ts   third-person spring camera
  scene/             renderer, sky, fog, motes, lanterns, other pods, text sprites
  net/               Firebase (anonymous auth), memories, presence, chat, API
  ui/                boot screen, HUD with compass and minimap, panels, touch
blender/make_models.py   builds pod.glb, tree.glb, lantern.glb headlessly
```

Rendering is three.js. Geometry is built on the client from projected metres,
so the server sends about 1 MB for a city rather than meshes.

### Models

```bash
npm run models        # runs Blender headless, writes public/models/*.glb
```

The pod, the street tree and the memory lantern are built procedurally in
`blender/make_models.py`. Material names matter: `Hull` is tinted per player,
`Glow` is the lantern's emissive core. Previews land in `blender/previews/`.

### Data

The server asks Overpass for one 2.4 km square per city and 800 m blocks
beyond it, one request at a time, rotating across mirrors when one is down or
rationing. Every answer is cached on disk under `.cache/overpass/` for a
month, so a restart never costs a second round trip and a popular city is
free after the first visitor.

Per-tile caps (450 buildings, 260 roads, 300 trees) keep a dense city dense
everywhere rather than solid in the middle and bare at the edge. Building
heights come from `height`, then `building:levels`, then a per-kind guess
seeded by the OSM id so a building is the same height every visit.

## Deploying

```bash
npm run build                     # dist/
npm start                         # serves dist/ and /api on $PORT (8787)
```

Or with the Dockerfile on Cloud Run:

```bash
gcloud run deploy nukhad --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=…,GOOGLE_MAPS_API_KEY=…" \
  --set-build-env-vars "$(grep '^VITE_' .env | tr '\n' ',' | sed 's/,$//')"
```

`VITE_*` values are inlined at build time; the two server keys stay server
side. Firestore rules, indexes and storage rules are in the repository root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Anonymous sign-in must be enabled in the Firebase console. The `memories`
schema and rules are the original game's, with an optional `alt` field for
height, so the same project serves both.

## Safety

Memories are moderated before they are stored: first names only, no contact
details, nothing aimed at a private address, and photographs are checked by
Gemini vision before they are uploaded anywhere. Firestore rules make every
memory append-only and deletable only by whoever left it. Chat is checked in
the browser for phone numbers, emails, links and handles and is append-only.

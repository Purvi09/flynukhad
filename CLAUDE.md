# nukkad

Fly a real city in 3D (three.js), find memories people left where they happened, leave your own.
Rebuilt from scratch from the 2D reference `Purvi09/nukkad` on GitHub (not checked out locally; do not read other implementations).

## Commands

- `npm run dev` — Hono server on :8787 (`tsx watch`) + Vite on :5173 (proxies `/api`).
- `npm run typecheck` — both `tsconfig.json` (client) and `server/tsconfig.json`.
- `npm run build` — typecheck + `vite build` into `dist/`; `npm start` serves `dist/` and `/api` from one process.
- `npm run models` — Blender headless (`/Applications/Blender.app/...`) rebuilds `public/models/*.glb`.

## Layout

`shared/geo.ts` and `shared/history.ts` are imported by both ends via `@shared/*`. Data coordinates are metres from the city centre, x east, y south; in three.js that is (x, height, z). Server: `server/` (overpass with mirrors + disk cache in `.cache/`, features, geocode, moderate, gemini, streetview, history, witnesses). Client: `src/engine`, `src/world` (build, tiles, collision, witnesses), `src/player` (pod, camera), `src/scene`, `src/net`, `src/ui`, `src/audio`, `src/game` (the history run). `src/main.ts` wires them.

## Conventions

- No framework in the client: plain DOM in `src/ui`, a fixed-step loop in `src/engine/loop.ts`.
- One merged mesh per feature class per tile; vertex colours; one shared material (`cityMaterial`) plus `facadeMaterial` for walls.
- Firestore `memories` schema must stay compatible with the original game's rules (`firestore.rules`); memories are found by lat range + client lon filter, not by city slug.
- Keys: `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` (or `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) stay server-side; only `VITE_FIREBASE_*` reach the browser.
- Blender material names are load-bearing: `Hull` (tinted per player), `Glow`, `Paper`, `Glass`, `Light`.
- Two palettes, on purpose: the boot screen is daylight — a flat 2D street drawn on a canvas (`src/ui/cityscape.ts`) with the copy sitting in the sky above it; the in-flight HUD and panels stay dark glass so they read against sky and buildings. Rose is memory, gold is history.
- The landing city is hand-drawn, not map data: two rows of buildings scrolling at different speeds, a bus, a car, walkers and clouds. Keep it uncluttered — generous gaps between buildings, and the skyline low enough that the copy never needs a scrim.
- The history game never trusts a model with a fact. Witness geometry (where they stand, bearings, distances, street names) is computed in `src/world/witnesses.ts` from data the browser already holds; the server only asks Gemini to *phrase* it, and every path falls back to the plain true sentence. A witness may be wrong on purpose (exactly one per case, never the first), never by accident.
- `localStorage` keys keep the `nukhad.` prefix from before the rename so saved names, cities and local memories survive.

# nukhadv2

Fly a real city in 3D (three.js), find memories people left where they happened, leave your own.
Rebuilt from scratch from the 2D reference at `~/code/github/nukkad` (do not read other implementations).

## Commands

- `npm run dev` — Hono server on :8787 (`tsx watch`) + Vite on :5173 (proxies `/api`).
- `npm run typecheck` — both `tsconfig.json` (client) and `server/tsconfig.json`.
- `npm run build` — typecheck + `vite build` into `dist/`; `npm start` serves `dist/` and `/api` from one process.
- `npm run models` — Blender headless (`/Applications/Blender.app/...`) rebuilds `public/models/*.glb`.

## Layout

`shared/geo.ts` is imported by both ends via `@shared/*`. Data coordinates are metres from the city centre, x east, y south; in three.js that is (x, height, z). Server: `server/` (overpass with mirrors + disk cache in `.cache/`, features, geocode, moderate, gemini, streetview). Client: `src/engine`, `src/world` (build, tiles, collision), `src/player` (pod, camera), `src/scene`, `src/net`, `src/ui`, `src/audio`. `src/main.ts` wires them.

## Conventions

- No framework in the client: plain DOM in `src/ui`, a fixed-step loop in `src/engine/loop.ts`.
- One merged mesh per feature class per tile; vertex colours; one shared material (`cityMaterial`) plus `facadeMaterial` for walls.
- Firestore `memories` schema must stay compatible with the original game's rules (`firestore.rules`); memories are found by lat range + client lon filter, not by city slug.
- Keys: `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` (or `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) stay server-side; only `VITE_FIREBASE_*` reach the browser.
- Blender material names are load-bearing: `Hull` (tinted per player), `Glow`, `Paper`, `Glass`, `Light`.

# Nukkad: hackathon submission

Answers to the idea form, in order. Copy each section into its box.

## Idea Title

Nukkad: a city's memories and its history, pinned to its street corners, in 3D

## Idea One Liner

Fly any real city, raised street for street from open map data, find the memories people left where they happened, hunt down what happened there by asking the people standing on its corners, and leave a memory of your own.

## Idea description

Every street holds stories that never make it onto a map. The tea stall where you learnt to ride a bicycle, the bench where you took the phone call, the corner where the riot started. Google Maps shows you where places are. Wikipedia tells you what happened there. Nukkad shows you what people remember there.

Nukkad is the street corner: the tea stall, the bench, the place a neighbourhood gathers and stories go round. Type the name of a city, or the place where you grew up, and it assembles in ten to thirty seconds as a real 3D world. Every building footprint, storey count, street, park, river and street tree comes from OpenStreetMap. Lisbon arrives as 5,900 buildings, 1,800 streets, 1,500 trees and 650 named places in the first 2.4 km square, then streams outward in 400 m tiles as you move, out to about 3.5 km from the centre.

You pilot a small pod, the way you pilot the Seamoth in Subnautica, from a camera that hangs behind it on a spring. The mouse points the nose, W thrusts along it, Space and C rise and dive, Shift boosts. You can skim a street at head height, bank around a corner, or climb above the roofs to see the whole neighbourhood. Buildings have windows and doors, roofs have the colours of the city, and you cannot fly through a wall.

Leaving something. Anywhere in the city, at any height, you can leave a memory, with a photograph if you like. It becomes a lantern with a column of light, glowing where you left it, so anyone flying that street later can find it from streets away, hover beside it and read what happened to you there. Every memory carries a first name, so a stranger finds a person rather than an anonymous note. Each memory has a link that builds the city around it and drops a friend beside the lantern. Memories are found by their latitude and longitude, not by what a geocoder called the city, so every memory left with the original 2D version is still there in the 3D one.

Finding what happened. Press G and the city deals you a case. It is a real place something happened, taken from Wikipedia's geolocated articles and filtered hard — a district's coordinate is the centroid of a hundred square kilometres and a metro station is dull, so what is left is places you can stand in front of. You get the opening paragraphs with every giveaway removed, and four people standing on real streets nearby. Each knows one piece of where it is, and only one: what happened and when, which part of the city, what stands around the place, and finally which landmark it sits beside. None of them is enough on its own. You fly to the first, hover within thirty metres, and talk to them — free text, in your own words; they are wary, they deflect, and they tell you what they know when you ask for it. Then they name the next person and the street they are on. Fly within forty-five metres of the answer and the case closes; give up and the game shows you where it was. Eight cases a run, and the ones you have played are remembered so a second visit to the same city deals you a different set.

The rule the history game never breaks is that no model is trusted with a fact. Where each witness stands, the bearings, the distances, the street names, the landmark they point at — all of it is computed in the browser from the same city data you are flying, in `src/world/witnesses.ts`. The server only asks Gemini to phrase it: to invent someone who plausibly stands on that corner, and to say the true sentence in their voice. If Gemini drops a detail, is slow, or is not configured at all, the plain true sentence is used and the game carries on with the unnamed tea-seller and caretaker. A witness may be wrong on purpose — exactly one per case, never the first, so you learn to cross-check — but never wrong by accident.

Other people. Everyone flying the same city is really there: pods with names above them, moving as they move, updated once a second and gone when they close the tab. There is a text channel per city, so you can ask the stranger a hundred metres away what the building below you used to be, or tell them which lantern to go and read. Two people can work the same history case from opposite ends of a district.

Neighbourhoods get redeveloped, elders pass, and the oral history of a street goes with them. Nukkad ties both kinds of history — the recorded one and the remembered one — to the ground they happened on, in any city in the world, without anyone having to build a dataset first.

What Google gives us:

- Gemini API (Google AI Studio). Two jobs. First, moderation: every memory is checked before it is stored — first names only, no contact details, nothing aimed at a private address, no abuse — and if a memory is fine apart from a surname, Gemini removes only that detail and leaves the writer's voice alone; Gemini vision looks at every photograph before it is uploaded anywhere. Second, the history game's cast: Gemini invents the four witnesses from where they are standing, gives them a name, a face and an opener, rephrases the fact they carry in their own voice, and answers the player's typed questions in character — without ever being handed the answer or being allowed to invent a direction. Calls rotate across seven Gemini Flash and Flash-Lite models under a wall-clock budget, so nobody waits on a model that is busy or out of quota.
- Google Maps Platform. The Geocoding API turns a typed place name into coordinates, with Nominatim as a fallback. The Street View Static API supplies the real photograph of the spot beside a memory, of wherever you are hovering, and of the place a case turns out to have been. The server proxies both so the key never reaches the browser.
- Firebase. Firestore stores memories, presence and the per-city chat; Firebase Storage holds photographs; Anonymous Auth gives every visitor a stable identity without a sign-up. Firestore rules make every memory append-only and deletable only by whoever left it. The schema is shared with the original 2D game, so one project serves both.
- Cloud Run. The app is a single Node process serving the built client and the API, with a Dockerfile, deployed with one `gcloud run deploy --source .` command.

The rest of the stack is three.js for rendering, plain TypeScript with no UI framework, a Hono server on Node, OpenStreetMap via Overpass with a rotation across seven public mirrors and a disk cache so no city is fetched twice, the Wikipedia geosearch API for the history game, and Blender. The pod, the street tree and the memory lantern are modelled in Blender by a headless script and exported as glTF, so the models can be rebuilt with one command.

Everything degrades rather than breaking. Without Gemini, memories are still checked mechanically for contact details and the app says so, and the history game's witnesses keep their true testimony without the character work. Without Firebase, memories live in browser storage and you fly alone. Without a billed Maps key, cities are geocoded with Nominatim and there is no Street View photograph. A town OpenStreetMap has not mapped is refused with a clear message.

Next: proximity voice between pods, a day-to-dusk cycle so the lanterns come into their own, cases you can hand to another player mid-run, Places API for richer landmark labels, and a BigQuery pipeline over the public OpenStreetMap tables to lose the Overpass rate limit entirely.

## Documentation Link

Source and README: https://github.com/Purvi09/flynukhad


## Screenshots to attach

If the form or the doc has room, these are ready in `submission/`:

- nukkad-entry.png, the title screen and its street
- nukhad-arrive.png, Praça do Comércio on arrival
- nukhad-street.png, flying down Rua de São Nicolau at roof height
- nukhad-lantern.png, a memory's lantern and beam from fifty metres
- nukhad-read.png, reading a memory
- nukkad-memory.png, leaving one over Old Delhi
- nukhad-compose.png, the earlier compose panel

Still to capture: a case panel with its four witnesses, and a conversation with one of them on the street.

## Data Source

Other: OpenStreetMap (Overpass API) for the city itself — building footprints, storey counts, streets, parks, water and street trees; Wikipedia geosearch API (`action=query&generator=geosearch`) for the history game's real events and their coordinates; and player-written memories, stored in Firestore. No Kaggle or BigQuery dataset: nothing here is pre-assembled, every city is fetched and built on demand.

## Google Cloud Services Used

- Gemini API (Google AI Studio) — memory moderation and photo vision; casting and voicing the history game's witnesses.
- Cloud Run — the whole app, one Node container from the repo's Dockerfile, `gcloud run deploy --source .`.
- Firebase — Firestore (memories, live presence, per-city chat), Cloud Storage for Firebase (memory photographs), Anonymous Auth (identity with no sign-up), with security rules and composite indexes deployed from the repo.
- Google Maps Platform — Geocoding API (typed place name to coordinates) and Street View Static API (the real photograph of a memory's spot, of wherever you hover, and of a solved case). Both proxied server-side so the key never reaches the browser.

## AI Details

Gemini API. Calls rotate across seven Flash and Flash-Lite models under a wall-clock budget, so a busy or out-of-quota model never makes a player wait: `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest` — moderation prefers the Lite end, the witness writing prefers the larger models.

Three uses: (1) moderating every memory before it is stored, redacting only an offending detail rather than rejecting the whole note, and Gemini vision on every photograph; (2) casting the history game's four witnesses from where they are standing — name, role, look, opener, and the true fact rephrased in their voice; (3) answering the player's typed questions to a witness, in character. The model is never given the answer and never invents a direction: all witness geometry is computed client-side and Gemini only phrases it, with the plain true sentence as the fallback on every path.

## Tech Stack (other tech details)

three.js for rendering (one merged mesh per feature class per tile, vertex colours, two shared materials); TypeScript throughout with no UI framework — plain DOM and a fixed-step loop; Vite for the client; Hono on Node for the server; Docker for Cloud Run. OpenStreetMap via Overpass with a rotation across seven public mirrors and an on-disk cache so no city is fetched twice; Nominatim as the geocoding fallback. The pod, the street tree and the memory lantern are modelled in Blender by a headless Python script and exported as glTF, rebuilt with one command.

## Using any Vibe Coding / Build Tools?

(Pick the option that matches how you actually built it — likely "No. VSCode and other agentic solutions".)

## Activated Google Cloud Billing?

(Yours to answer.)

## Faced issues with billing?

(Yours to answer — "No" unless you hit something.)

## Progress Detail on your project delivery

The project is built, deployed and playable end to end: cities build from any place name, memories can be left and found, the history game deals cases and the witnesses answer, and everyone in a city sees each other and can chat. It is live on Cloud Run at https://nukkad-700773700612.asia-south1.run.app. What is left is finishing touches, not features:

1. The witnesses in the history game stand still. They are meant to be people on a street, so they should walk a short beat along the pavement they were placed on, turn to face you as you come near, and stop while they are talking to you. Target: 8 September 2026.

2. Their markers need tidying with them. The column of light above each witness is what you navigate by from a distance, and it has to track them as they move, fade in properly rather than pop in at range, and stay readable against a bright sky. The name label should follow the same movement. Target: 8 September 2026.

3. A last pass over the clue text so every case reads cleanly, and a check that no case ever leaves the answer in the clue. Target: 9 September 2026.

4. Two screenshots for the write-up: a case panel with its four witnesses, and a conversation with one of them on the street. Target: 9 September 2026.

5. Final redeploy and a full playthrough on the live URL in two browsers, to confirm presence, chat and a complete case after the changes above. Target: 10 September 2026.

## Deployed App Details — how to access and test

Open the link, type a city and press Enter. Any real city works; Old Delhi, Lisbon and Bengaluru are good ones to try. The city builds in ten to thirty seconds, then you are flying.

Flying: move the mouse to point the nose, W and S to thrust, A and D to strafe, Space and C to rise and dive, Shift to boost. H is help, P is the Street View photograph of wherever you are. Click once on the page first so the mouse is captured; Esc releases it.

Three things to test:

1. Leave a memory. Press M anywhere, write a line about the place below you, add a photo if you like, and leave it. It becomes a lantern with a beam of light. Fly away, turn round, and find it again; hover beside it and press E to read it. Every memory is checked by Gemini before it is stored, so a phone number or a surname will be refused or quietly removed.

2. Find a piece of the city's history. Press G. You get a clue with the name taken out, and four people standing on real streets. Fly to the nearest, hover within thirty metres, and talk to them in your own words — ask where it is, when it happened, what is nearby. Each one tells you one piece and names the next. Fly within forty-five metres of the place and the case closes. One witness per case is honestly mistaken, so cross-check what they tell you against the map.

3. See other people. Open the same city in a second browser window with a different name. Each pod appears to the other with its name above it, moving in real time, and the per-city chat, on T, carries messages between them.

Everything degrades rather than breaking: without a key or a signed-in Firebase, memories are kept in browser storage and the witnesses keep their true testimony without the character writing.

## Deployed App Link

https://nukkad-700773700612.asia-south1.run.app

## Have you completed (deployed) your project?

(Yours to answer — "Finishing Touch" until step 5 above is done, then "Yes" with the Cloud Run URL.)

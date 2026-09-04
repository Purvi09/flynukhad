# Nukhad: hackathon submission

Answers to the idea form, in order. Copy each section into its box.

## Idea Title

Nukhad: a city's memories, pinned to its street corners, in 3D

## Idea One Liner

Fly any real city, raised street for street from open map data, find the memories people left where they happened, and leave your own.

## Idea description

Every street holds stories that never make it onto a map. The tea stall where you learnt to ride a bicycle, the bench where you took the phone call, the corner where the riot started. Google Maps shows you where places are. Wikipedia tells you what happened there. Nukhad shows you what people remember there.

Nukhad is the street corner: the tea stall, the bench, the place a neighbourhood gathers and stories go round. Type the name of a city, or the place where you grew up, and it assembles in ten to thirty seconds as a real 3D world. Every building footprint, storey count, street, park, river and street tree comes from OpenStreetMap. Lisbon arrives as 5,900 buildings, 1,800 streets, 1,500 trees and 650 named places in the first 2.4 km square, then streams outward in 400 m tiles as you move, out to about 3.5 km from the centre.

You pilot a small pod, the way you pilot the Seamoth in Subnautica, from a camera that hangs behind it on a spring. The mouse points the nose, W thrusts along it, Space and C rise and dive, Shift boosts. You can skim a street at head height, bank around a corner, or climb above the roofs to see the whole neighbourhood. Buildings have windows and doors, roofs have the colours of the city, and you cannot fly through a wall.

Anywhere in the city, at any height, you can leave a memory, with a photograph if you like. It becomes a lantern with a column of light, glowing where you left it, so anyone flying that street later can find it from streets away, hover beside it and read what happened to you there. Every memory carries a first name, so a stranger finds a person rather than an anonymous note. Each memory has a link that builds the city around it and drops a friend beside the lantern. Memories are found by their latitude and longitude, not by what a geocoder called the city, so every memory left with the original 2D version is still there in the 3D one.

Everyone exploring the same city sees each other's pods with names above them, and there is a text channel per city.

Neighbourhoods get redeveloped, elders pass, and the oral history of a street goes with them. Nukhad ties that history to the ground it happened on, in any city in the world, without anyone having to build a dataset first.

What Google gives us:

- Gemini API (Google AI Studio). Every memory is checked by Gemini before it is stored: first names only, no contact details, nothing aimed at a private address, no abuse. If a memory is fine apart from a surname, Gemini removes only that detail and leaves the writer's voice alone. Gemini vision looks at every photograph before it is uploaded anywhere. Calls rotate across seven Gemini Flash and Flash-Lite models under a wall-clock budget, so nobody waits on a model that is busy or out of quota.
- Google Maps Platform. The Geocoding API turns a typed place name into coordinates, with Nominatim as a fallback. The Street View Static API supplies the real photograph of the spot beside a memory and of wherever you are hovering. The server proxies both so the key never reaches the browser.
- Firebase. Firestore stores memories, presence and the per-city chat; Firebase Storage holds photographs; Anonymous Auth gives every visitor a stable identity without a sign-up. Firestore rules make every memory append-only and deletable only by whoever left it. The schema is shared with the original 2D game, so one project serves both.
- Cloud Run. The app is a single Node process serving the built client and the API, with a Dockerfile, deployed with one `gcloud run deploy --source .` command.

The rest of the stack is three.js for rendering, plain TypeScript with no UI framework, a Hono server on Node, OpenStreetMap via Overpass with a rotation across seven public mirrors and a disk cache so no city is fetched twice, and Blender. The pod, the street tree and the memory lantern are modelled in Blender by a headless script and exported as glTF, so the models can be rebuilt with one command.

Everything degrades rather than breaking. Without Gemini, memories are still checked mechanically for contact details and the app says so. Without Firebase, memories live in browser storage. Without a billed Maps key, cities are geocoded with Nominatim and there is no Street View photograph. A town OpenStreetMap has not mapped is refused with a clear message.

Next: proximity voice between pods, a day-to-dusk cycle so the lanterns come into their own, Places API for richer landmark labels, and a BigQuery pipeline over the public OpenStreetMap tables to lose the Overpass rate limit entirely.

## Documentation Link

Source and README: https://github.com/Purvi09/nukhad


## Screenshots to attach

If the form or the doc has room, these are ready in `submission/`:

- nukhad-arrive.png, Praça do Comércio on arrival
- nukhad-street.png, flying down Rua de São Nicolau at roof height
- nukhad-lantern.png, a memory's lantern and beam from fifty metres
- nukhad-read.png, reading a memory
- nukhad-compose.png, leaving one

# Gárdonyi Géza utca – Piliscsaba (browser 3D game)

A third-person / first-person walk through Gárdonyi Géza utca in Piliscsaba (Márialiget), Hungary.
You play a civilian with typical suburban tools. It is not a shooter. Built with Three.js and Vite.

## Getting started

```bash
npm install
npm run textures   # once: download CC0 photo textures (Poly Haven), ~40–60 MB
npm run dev        # http://localhost:5173
```

Behind a corporate proxy, download the textures like this:
`HTTPS_PROXY=http://proxy.example.com:8080 npm run textures`

Build: `npm run build` → `dist/` (can be served from any static host).

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` | move |
| Mouse | look around |
| `Shift` | run |
| `Space` | jump |
| Left click | use the tool |
| `1`–`7` / mouse wheel | switch tool (`0` = empty hands) |
| `V` | first / third person |
| `C` | camera distance (third person) |
| `Esc` | pause (graphics settings are in the pause menu) |
| `F2` | dev mode (object ids) |
| `G` / `O` / `L` / `B` | toggle color grading / ambient occlusion / sun shafts / bloom |

Tools: shovel, lawn mower, angle grinder, impact drill, sledgehammer, hedge trimmer, rake.

**Graphics quality:** the pause menu offers Low / Medium / High / Ultra / Auto, and the browser remembers
your choice. On first start the game picks a preset based on the GPU. The URL can override it:
`?q=low|medium|high|ultra`.

## Sources

| Item | Source |
|---|---|
| Street centreline, building footprints, house numbers, side streets, forest | OpenStreetMap (© OSM contributors, ODbL) – `src/data/gardonyi.json` |
| Elevation | Street View camera altitudes (228–238 m) + Open-Meteo DEM |
| Fences, poles, car, bins, standpipe, carport, tree positions, house styles | Placed by hand using Street View panoramas as reference only (no imagery is used) – `src/world/layout.js` |
| Character | Ready Player Me avatar (three.js example model `readyplayer.me.glb`) – `public/models/civilian.glb` |
| Animations (idle, walk, run) | Mixamo "Soldier" (three.js example model) – `public/models/Soldier.glb`, retargeted to the civilian at load time |
| Tools | procedural models (`src/tools/models.js`) |
| Sky and ambient light | procedural shader with clouds |
| Textures | `public/textures` if present (CC0 Poly Haven or your own photos); otherwise generated in code |

The walkable area runs about 190 m from Szent István király útja, as far as Street View imagery exists.

## Dev mode – object ids

`F2` (or `?dev` in the URL) shows the labels. Aim at an object and press `I` to copy its id to the clipboard.
The bottom line shows your position: `s` = metres along the street from Szent István király útja,
`d` = lateral offset (+ north-west, − south-east side).

| Prefix | What | Defined in |
|---|---|---|
| `house-G9` | house (G = Gárdonyi, SZI = Szent István, A = Árpád, GY = Gyöngyvirág + house number); without a number: `house-<n>` | OSM + `BUILDING_STYLES` |
| `tree-<n>` | tree | `LANDMARK_TREES[n-1]` |
| `hedge-<n>` | hedge | `HEDGES[n-1]` |
| `fence-<n>` | fence section | `FENCES[n-1]` |
| `pole-<n>` | utility pole + street light | `POLES[n-1]` |
| `paving-<n>` | paved driveway | `APRONS[n-1]` |
| `car-`, `bin-`, `standpipe-`, `carport-`, `cabin-`, `mailbox-`, `woodpile-`, `post-` | props | `PROPS` |
| `road-concrete`, `road-dirt` | road sections | `ROAD` |

Console: `__dev.list()` (full list), `__dev.goto('house-G9')` (teleport there).

Example requests: "move `tree-31` 3 metres further in", "make `fence-12` a green panel fence".

## Your own photos (for the most faithful look)

1. Photograph the surfaces straight on, in shadow-free light (concrete slab road, plank fence, plaster, roof tiles…).
2. Put the pictures in `public/textures/own/`.
3. Create `config.json` from `config.example.json` (which photo goes to which surface, and how many metres it covers).

Your own photos override the downloaded textures. (The former folder name `public/textures/sajat/` still works.)

## Structure

- `src/world/geo.js` – coordinates, street-relative (s, d) projection, terrain model
- `src/world/layout.js` – street furniture and sections placed from Street View reference
- `src/world/*.js` – terrain, roads, houses, fences, vegetation, props, textures, sky
- `src/player/` – character, controls (first / third person), IK, collision
- `src/tools/` – tool models, definitions and the tool system
- `src/render/` – soft shadows, post-processing (AO, sun shafts, bloom, eye adaptation, grade), quality presets
- `src/fx/particles.js` – sparks and dust
- `scripts/fetch-textures.mjs` – CC0 texture download

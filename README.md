# Gárdonyi Géza utca – Piliscsaba (3D TPS, böngészőben)

Third-person séta a piliscsabai (Márialiget) Gárdonyi Géza utcában. Three.js + Vite.

## Indítás

```bash
npm install
npm run textures   # egyszer: CC0 fotótextúrák letöltése (Poly Haven), ~40–60 MB
npm run dev        # http://localhost:5173
```

Céges hálózaton (proxy mögött) a textúraletöltés így megy:
`HTTPS_PROXY=http://proxy.cim:port npm run textures`

Build: `npm run build` → `dist/` (bármilyen statikus tárhelyre feltölthető).
Grafikai beállítás: a szünet menüben (Alacsony / Közepes / Magas / Ultra / Auto), a választást a böngésző megjegyzi. Az első indításkor a játék a videókártya alapján választ. URL-ből is felülírható: `?q=low|medium|high|ultra`.

**Irányítás:** WASD mozgás, egér nézelődés, Shift futás, Space ugrás, görgő kameratávolság,
Tools: `1`–`7` or mouse wheel to switch (`0` = empty hands), left click to use, `C` = camera distance. V belső (FPS) / külső (TPS) nézet, G színkorrekció, O ambient occlusion, L fénysugarak, B bloom ki/be; Esc szünet.

## Mi honnan jön

| Elem | Forrás |
|---|---|
| Utca nyomvonala, házak alaprajza, házszámok, szomszéd utcák, erdő | OpenStreetMap (© OSM contributors, ODbL) – `src/data/gardonyi.json` |
| Magasságok | Street View kamerák tengerszint feletti magassága (228–238 m) + Open-Meteo DEM |
| Kerítések, oszlopok, kocsi, kukák, közkút, carport, fák helye, házstílusok | Street View panorámák alapján kézzel felvéve (csak referencia, kép nincs felhasználva) – `src/world/layout.js` |
| Karakter | Ready Player Me avatar (three.js példamodell, `readyplayer.me.glb`) – `public/models/civilian.glb` |
| Animációk (áll, sétál, fut) | Mixamo „Soldier” (three.js példamodell) – `public/models/Soldier.glb`, futásidőben átültetve a civil karakterre |
| Égbolt és környezeti fény | procedurális (saját shader, felhőkkel) |
| Textúrák | ha van: `public/textures` (CC0 Poly Haven vagy saját fotó); különben kódból generált |

A bejárható rész a Szent István király útjától kb. 190 m-ig tart: eddig van Street View felvétel.

## Fejlesztői mód – tárgyak azonosítói

`F2` (vagy `?dev` a címben) bekapcsolja a címkéket. Célozz a tárgyra, és nyomd meg az `I` billentyűt: az azonosító a vágólapra kerül.
Alul látszik az aktuális pozíció is: `s` = méter a Szent István király útjától az utca mentén, `d` = oldaltávolság (+ ÉNy, − DK oldal).

| Előtag | Mi | Hol van definiálva |
|---|---|---|
| `haz-G9` | ház (G = Gárdonyi, SZI = Szent István, A = Árpád, GY = Gyöngyvirág + házszám); szám nélküli: `haz-<n>` | OSM + `BUILDING_STYLES` |
| `fa-<n>` | fa | `LANDMARK_TREES[n-1]` |
| `soveny-<n>` | sövény | `HEDGES[n-1]` |
| `kerites-<n>` | kerítésszakasz | `FENCES[n-1]` |
| `oszlop-<n>` | villanyoszlop + lámpa | `POLES[n-1]` |
| `terko-<n>` | térköves beálló | `APRONS[n-1]` |
| `auto-`, `kuka-`, `kozkut-`, `carport-`, `haziko-`, `postalada-`, `farakas-` | tárgyak | `PROPS` |
| `ut-beton`, `ut-fold` | útszakaszok | `ROAD` |

Konzolban: `__dev.list()` (teljes lista), `__dev.goto('haz-G9')` (odateleportál).

Példa kérésre: „a `fa-31`-et vidd 3 méterrel beljebb”, „a `kerites-12` legyen zöld táblás”.

## Saját fotók (a leghűbb, GTA-szerű hatáshoz)

1. Fotózd le egyenesen, árnyékmentes időben a felületeket (betonlap út, deszkakerítés, vakolat, cserép…).
2. Tedd a képeket a `public/textures/sajat/` mappába.
3. A `config.example.json` alapján hozd létre a `config.json`-t (melyik kép melyik felület, hány méter széles).

A saját fotók felülírják a letöltött textúrákat. A következő lépés az lehet, hogy házanként saját homlokzatfotót kapjon minden épület.

## Felépítés

- `src/world/geo.js` – koordináták, utca menti (s, d) vetület, domborzati modell
- `src/world/layout.js` – a Street View alapján felvett utcabútorok és szakaszok
- `src/world/*.js` – terep, utak, házak, kerítések, növényzet, tárgyak, textúrák
- `src/player/` – karakter, irányítás, ütközés
- `src/grade.js` – színkorrekció (meleg, párás „San Andreas” hangulat)
- `scripts/fetch-textures.mjs` – CC0 textúrák letöltése

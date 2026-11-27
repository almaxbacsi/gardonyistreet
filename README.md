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
Gyengébb gépen: `?q=low` a cím végén.

**Irányítás:** WASD mozgás, egér nézelődés, Shift futás, Space ugrás, görgő kameratávolság,
G színkorrekció ki/be, Esc szünet.

## Mi honnan jön

| Elem | Forrás |
|---|---|
| Utca nyomvonala, házak alaprajza, házszámok, szomszéd utcák, erdő | OpenStreetMap (© OSM contributors, ODbL) – `src/data/gardonyi.json` |
| Magasságok | Street View kamerák tengerszint feletti magassága (228–238 m) + Open-Meteo DEM |
| Kerítések, oszlopok, kocsi, kukák, közkút, carport, fák helye, házstílusok | Street View panorámák alapján kézzel felvéve (csak referencia, kép nincs felhasználva) – `src/world/layout.js` |
| Karakter | Mixamo „Soldier” (three.js példamodell) – `public/models/Soldier.glb` |
| Környezeti fény (HDRI) | Poly Haven „Quarry 01” (CC0) |
| Textúrák | ha van: `public/textures` (CC0 Poly Haven vagy saját fotó); különben kódból generált |

A bejárható rész a Szent István király útjától kb. 190 m-ig tart: eddig van Street View felvétel.

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

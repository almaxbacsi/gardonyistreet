// Loads photographic textures if present:
//   public/textures/manifest.json   – written by `npm run textures` (CC0 sets from Poly Haven)
//   public/textures/sajat/config.json – your own photos, these override the downloaded ones
// Anything missing falls back to the procedural textures.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();

async function getJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function tex(url, srgb, aniso) {
  try {
    const t = await loader.loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch { return null; }
}

/**
 * @returns {Promise<Record<string, {map, normalMap?, roughnessMap?, meters:number, rotate?:boolean, source:string}>>}
 */
export async function loadPhotoTextures(aniso = 8) {
  const out = {};
  const base = 'textures/';
  const manifest = await getJSON(base + 'manifest.json');
  const own = await getJSON(base + 'sajat/config.json');
  const jobs = [];
  const add = (slot, e, dir, source) => {
    jobs.push((async () => {
      const map = await tex(dir + e.color, true, aniso);
      if (!map) return;
      const normalMap = e.normal ? await tex(dir + e.normal, false, aniso) : null;
      const roughnessMap = e.rough ? await tex(dir + e.rough, false, aniso) : null;
      out[slot] = { map, normalMap, roughnessMap, meters: e.meters || 2, rotate: !!e.rotate, source };
    })());
  };
  if (manifest?.slots) for (const [slot, e] of Object.entries(manifest.slots)) add(slot, e, base, 'cc0');
  await Promise.all(jobs);
  jobs.length = 0;
  if (own) for (const [slot, e] of Object.entries(own)) {
    if (slot.startsWith('_')) continue;
    add(slot, typeof e === 'string' ? { color: e } : e, base + 'sajat/', 'own');
  }
  await Promise.all(jobs);
  return out;
}

/** Repeats a photo texture image onto a canvas covering wM x hM metres (for road slabs). */
export function tileToCanvas(img, meters, wM, hM, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const tw = (meters / wM) * size, th = (meters / hM) * size;
  for (let y = 0; y < size; y += th) for (let x = 0; x < size; x += tw) g.drawImage(img, x, y, tw, th);
  return { canvas: c, ctx: g };
}

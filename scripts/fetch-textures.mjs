#!/usr/bin/env node
// Downloads CC0 photo textures from Poly Haven (https://polyhaven.com, CC0 licence)
// into public/textures/<slot>/ and writes public/textures/manifest.json.
// Usage:  npm run textures            (1k/2k)
//         npm run textures -- --hi    (2k/4k, larger download)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures');
const UA = { 'User-Agent': 'gardonyi-utca-game/1.0 (texture fetch script)' };
const HI = process.argv.includes('--hi');

// slot -> preferred Poly Haven asset ids (first existing wins) + fallback keywords
const SLOTS = {
  grass:    { ids: ['leafy_grass', 'grass_path_2', 'aerial_grass_rock', 'sparse_grass'], kw: ['grass'], res: '2k' },
  dirt:     { ids: ['gravel_road', 'gravelly_sand', 'rocky_trail', 'dirt_floor'], kw: ['gravel', 'dirt'], res: '2k' },
  concrete: { ids: ['concrete_floor_worn_001', 'concrete_floor_02', 'concrete_pavement', 'concrete_floor'], kw: ['concrete'], res: '2k' },
  plaster:  { ids: ['painted_plaster_wall', 'beige_wall_001', 'white_plaster_02', 'plastered_wall'], kw: ['plaster'], res: '1k' },
  roof:     { ids: ['roof_tiles_14', 'clay_roof_tiles_02', 'clay_roof_tiles', 'roof_tiles'], kw: ['roof'], res: '1k' },
  planks:   { ids: ['weathered_brown_planks', 'brown_planks_03', 'wood_planks', 'old_planks_02'], kw: ['planks'], res: '1k' },
  bark:     { ids: ['bark_brown_02', 'pine_bark', 'bark_willow_02', 'bark_willow'], kw: ['bark'], res: '1k' },
  block:    { ids: ['concrete_block_wall_02', 'grey_cinder_block', 'concrete_block_wall', 'cinder_block'], kw: ['cinder', 'block'], res: '1k' },
  stone:    { ids: ['stone_wall', 'castle_wall_slates', 'stone_brick_wall_001', 'rock_wall_08'], kw: ['stone wall', 'stone'], res: '1k' },
};

const up = (r) => (HI ? ({ '1k': '2k', '2k': '4k' })[r] : r);

async function json(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return null;
  return r.json();
}

let catalog = null;
async function search(keywords, taken) {
  catalog ||= await json('https://api.polyhaven.com/assets?t=textures');
  if (!catalog) return null;
  let best = null;
  for (const [id, a] of Object.entries(catalog)) {
    if (taken.has(id)) continue;
    const hay = [id, a.name, ...(a.tags || []), ...(a.categories || [])].join(' ').toLowerCase();
    if (!keywords.some((k) => hay.includes(k))) continue;
    if (!best || (a.download_count || 0) > (best.a.download_count || 0)) best = { id, a };
  }
  return best?.id || null;
}

function pick(files, keys, res) {
  for (const k of keys) {
    const f = files[k];
    if (!f) continue;
    const r = f[res] || f['1k'] || Object.values(f)[0];
    const url = r?.jpg?.url || r?.png?.url;
    if (url) return url;
  }
  return null;
}

async function download(url, file) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
}

const manifest = { source: 'Poly Haven (CC0) – https://polyhaven.com', slots: {} };
const taken = new Set();
for (const [slot, cfg] of Object.entries(SLOTS)) {
  let id = null, files = null;
  for (const cand of cfg.ids) {
    files = await json(`https://api.polyhaven.com/files/${cand}`);
    if (files && files.Diffuse) { id = cand; break; }
  }
  if (!id) {
    id = await search(cfg.kw, taken);
    files = id ? await json(`https://api.polyhaven.com/files/${id}`) : null;
  }
  if (!id || !files) { console.warn(`✗ ${slot}: nincs találat`); continue; }
  taken.add(id);
  const info = await json(`https://api.polyhaven.com/info/${id}`);
  const meters = info?.dimensions ? Math.max(0.3, info.dimensions[0] / 1000) : 2;
  const res = up(cfg.res);
  const color = pick(files, ['Diffuse', 'diff_png', 'Color'], res);
  const normal = pick(files, ['nor_gl', 'Normal'], res);
  const rough = pick(files, ['Rough', 'rough'], res);
  const entry = { id, name: info?.name || id, meters };
  try {
    if (color) { await download(color, join(ROOT, slot, 'color.jpg')); entry.color = `${slot}/color.jpg`; }
    if (normal) { await download(normal, join(ROOT, slot, 'normal.jpg')); entry.normal = `${slot}/normal.jpg`; }
    if (rough) { await download(rough, join(ROOT, slot, 'rough.jpg')); entry.rough = `${slot}/rough.jpg`; }
    manifest.slots[slot] = entry;
    console.log(`✓ ${slot.padEnd(9)} ${id} (${meters.toFixed(2)} m, ${res})`);
  } catch (e) {
    console.warn(`✗ ${slot}: ${e.message}`);
  }
}
await mkdir(ROOT, { recursive: true });
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nKész: ${Object.keys(manifest.slots).length} textúra → public/textures/manifest.json`);

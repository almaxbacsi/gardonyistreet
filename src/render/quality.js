// Graphics quality presets, auto-detection and persistence.
// Resolution order: ?q=<preset> URL parameter > localStorage choice > auto-detect.
// `live` settings are applied at runtime (applyLive in main.js); the rest need a reload.

export const PRESETS = {
  low: {
    label: 'Alacsony',
    pixelRatioMax: 1, renderScale: 0.75, msaa: 0,
    shadowSize: 1024, shadowSearch: 4, shadowTaps: 6, maxPenumbra: 0.35,
    ao: false, aoTaps: 6, shafts: false, shaftTaps: 6, bloom: false, bloomLevels: 4, adapt: true,
    vegScale: 0.45, terrainRes: 2.5, cloudOctaves: 3, envSize: 32, envInterval: 8,
  },
  medium: {
    label: 'Közepes',
    pixelRatioMax: 1, renderScale: 0.9, msaa: 2,
    shadowSize: 2048, shadowSearch: 5, shadowTaps: 10, maxPenumbra: 0.45,
    ao: true, aoTaps: 6, shafts: true, shaftTaps: 8, bloom: true, bloomLevels: 5, adapt: true,
    vegScale: 0.7, terrainRes: 1.75, cloudOctaves: 4, envSize: 64, envInterval: 5,
  },
  high: {
    label: 'Magas',
    pixelRatioMax: 1.5, renderScale: 1, msaa: 4,
    shadowSize: 4096, shadowSearch: 8, shadowTaps: 16, maxPenumbra: 0.55,
    ao: true, aoTaps: 12, shafts: true, shaftTaps: 14, bloom: true, bloomLevels: 6, adapt: true,
    vegScale: 1, terrainRes: 1.25, cloudOctaves: 6, envSize: 128, envInterval: 3,
  },
  ultra: {
    label: 'Ultra',
    pixelRatioMax: 2, renderScale: 1, msaa: 4,
    shadowSize: 4096, shadowSearch: 12, shadowTaps: 24, maxPenumbra: 0.6,
    ao: true, aoTaps: 16, shafts: true, shaftTaps: 20, bloom: true, bloomLevels: 7, adapt: true,
    vegScale: 1.4, terrainRes: 1, cloudOctaves: 7, envSize: 128, envInterval: 2,
  },
};
export const ORDER = ['low', 'medium', 'high', 'ultra'];
/** settings that need a page reload to change */
export const RELOAD_KEYS = ['shadowSearch', 'shadowTaps', 'maxPenumbra', 'vegScale', 'terrainRes'];

const KEY = 'gardonyi.quality';

/** Guess a sensible preset from the GPU / device. */
export function autoDetect() {
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* ignore */ }
  const g = String(gpu).toLowerCase();
  const mobile = navigator.userAgentData?.mobile || /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  let preset = 'high';
  if (/swiftshader|llvmpipe|software|basic render/.test(g) || mobile) preset = 'low';
  else if (/intel|uhd|iris|hd graphics|mali|adreno|powervr|vega 8|radeon\(tm\) graphics/.test(g)) preset = 'medium';
  return { preset, gpu };
}

export function resolveQuality() {
  const q = new URLSearchParams(location.search).get('q');
  if (q && PRESETS[q]) return { name: q, source: 'url' };
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (saved && PRESETS[saved]) return { name: saved, source: 'saved' };
  const a = autoDetect();
  return { name: a.preset, source: 'auto', gpu: a.gpu };
}

export function saveQuality(name) {
  try {
    if (name) localStorage.setItem(KEY, name); else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

/** true if switching from preset a to b needs a reload for some settings */
export function needsReload(a, b) {
  return RELOAD_KEYS.some((k) => PRESETS[a][k] !== PRESETS[b][k]);
}

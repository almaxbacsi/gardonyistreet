// Procedural textures generated at load time (no external image assets).
import * as THREE from 'three';
import { rng } from './geo.js';

let ANISO = 4;
export function setAnisotropy(a) { ANISO = a; }

// ---- tileable noise --------------------------------------------------------
function makeNoise(seed) {
  const R = rng(seed);
  const perm = new Uint16Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256).map(() => R());
  const lat = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  // periodic value noise with period P (integer lattice)
  function noise(x, y, P) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % P) + P) % P, y0 = ((iy % P) + P) % P;
    const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = lat(x0, y0), b = lat(x1, y0), c = lat(x0, y1), d = lat(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // fbm on unit square [0,1)^2 with base frequency f (integer) -> tileable
  function fbm(u, v, f = 4, oct = 5, gain = 0.5) {
    let s = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * noise(u * f, v * f, f);
      norm += amp; amp *= gain; f *= 2;
    }
    return s / norm;
  }
  return { noise, fbm, R };
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixc(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }

/**
 * Generic generator. painter(u, v, px, py) returns [r,g,b,height] (rgb 0..255, height 0..1)
 */
function generate(size, painter, { normalStrength = 2, post } = {}) {
  const col = new Uint8ClampedArray(size * size * 4);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = painter(x / size, y / size, x, y);
      const i = y * size + x;
      col[i * 4] = r[0]; col[i * 4 + 1] = r[1]; col[i * 4 + 2] = r[2]; col[i * 4 + 3] = r[4] ?? 255;
      hgt[i] = r[3] ?? 0.5;
    }
  }
  if (post) post(col, hgt, size);
  return finish(size, col, hgt, normalStrength);
}

function finish(size, col, hgt, normalStrength) {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = size;
  cnv.getContext('2d').putImageData(new ImageData(col, size, size), 0, 0);
  const map = new THREE.CanvasTexture(cnv);
  map.colorSpace = THREE.SRGBColorSpace;
  // normal map
  const nrm = new Uint8ClampedArray(size * size * 4);
  const H = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * normalStrength * size / 256;
    const dy = (H(x, y + 1) - H(x, y - 1)) * normalStrength * size / 256;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    nrm[i] = (-dx / l * 0.5 + 0.5) * 255;
    nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    nrm[i + 3] = 255;
  }
  const cn = document.createElement('canvas');
  cn.width = cn.height = size;
  cn.getContext('2d').putImageData(new ImageData(nrm, size, size), 0, 0);
  const normalMap = new THREE.CanvasTexture(cn);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = ANISO;
    t.generateMipmaps = true;
  }
  return { map, normalMap };
}

// ---- Surfaces --------------------------------------------------------------

export function grassTexture() {
  const N = makeNoise(11);
  const c1 = hex('#3f5f22'), c2 = hex('#6a8a34'), dry = hex('#9a9256'), dark = hex('#2c4418');
  return generate(512, (u, v) => {
    const big = N.fbm(u, v, 3, 4);
    const mid = N.fbm(u, v, 12, 3);
    const fine = N.noise(u * 256, v * 256, 256);
    const streak = N.noise(u * 180, v * 40, 40);
    let c = mixc(c1, c2, clamp(big * 1.3 - 0.15));
    c = mixc(c, dry, clamp((mid - 0.58) * 2.2) * 0.6);
    c = mixc(c, dark, clamp(0.5 - fine) * 0.5);
    const k = 0.85 + fine * 0.25 + streak * 0.1;
    return [c[0] * k, c[1] * k, c[2] * k, fine * 0.6 + streak * 0.4];
  }, { normalStrength: 3 });
}

function pebbles(N, size, col, hgt, count, palette, rMin, rMax) {
  for (let p = 0; p < count; p++) {
    const cx = N.R() * size, cy = N.R() * size;
    const r = (rMin + N.R() * (rMax - rMin)) * size;
    const base = palette[Math.floor(N.R() * palette.length)];
    const sh = 0.8 + N.R() * 0.35;
    const elong = 0.7 + N.R() * 0.6, rot = N.R() * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x - cx, dy = y - cy;
      const rx = (dx * cr + dy * sr) / elong, ry = -dx * sr + dy * cr;
      const d = Math.hypot(rx, ry) / r;
      if (d > 1) continue;
      const xi = ((x % size) + size) % size, yi = ((y % size) + size) % size;
      const i = yi * size + xi;
      const dome = Math.sqrt(1 - d * d);
      hgt[i] = Math.max(hgt[i], 0.45 + dome * 0.5);
      const light = sh * (0.75 + 0.35 * dome - 0.25 * (dy / r));
      col[i * 4] = base[0] * light; col[i * 4 + 1] = base[1] * light; col[i * 4 + 2] = base[2] * light;
    }
  }
}

export function dirtTexture() {
  const N = makeNoise(21);
  const a = hex('#8d7a5c'), b = hex('#b3a07c'), wet = hex('#6c5b43');
  return generate(512, (u, v) => {
    const big = N.fbm(u, v, 4, 5);
    const fine = N.noise(u * 200, v * 200, 200);
    let c = mixc(a, b, clamp(big * 1.4 - 0.2));
    c = mixc(c, wet, clamp(0.45 - big) * 0.8);
    const k = 0.85 + fine * 0.3;
    return [c[0] * k, c[1] * k, c[2] * k, big * 0.4 + fine * 0.15];
  }, {
    normalStrength: 1.5,
    post: (col, hgt, size) => {
      const pal = [hex('#b8ad98'), hex('#9a8f7c'), hex('#cfc4ae'), hex('#7d7366'), hex('#a8957a')];
      pebbles(N, size, col, hgt, 380, pal, 0.002, 0.006);
      pebbles(N, size, col, hgt, 30, pal, 0.008, 0.014);
    },
  });
}

/** Concrete slab road. u across road (0..1 = full width), v along road (0..1 = 6 m) */
export function concreteSlabTexture() {
  const N = makeNoise(31);
  const base = hex('#9a988f'), stain = hex('#77756c'), light = hex('#b5b3aa'), moss = hex('#5f6345');
  // crack polylines
  const cracks = [];
  for (let c = 0; c < 14; c++) {
    let x = N.R(), y = N.R(); const pts = [[x, y]]; let ang = N.R() * Math.PI * 2;
    for (let k = 0; k < 18; k++) { ang += (N.R() - 0.5) * 0.9; x += Math.cos(ang) * 0.012; y += Math.sin(ang) * 0.012; pts.push([x, y]); }
    cracks.push(pts);
  }
  return generate(1024, (u, v) => {
    // joints: longitudinal at u=.5, transverse staggered every 0.25 (1.5 m)
    const ju = Math.abs(u - 0.5);
    const side = u < 0.5 ? 0 : 0.125;
    const tv = ((v + side) * 4) % 1;
    const jv = Math.min(tv, 1 - tv) / 4;
    const edge = Math.min(u, 1 - u);
    let j = Math.min(ju, jv);
    const big = N.fbm(u, v, 4, 5);
    const fine = N.noise(u * 512, v * 512, 512) * 0.35 + N.fbm(u, v, 16, 2) * 0.65;
    let c = mixc(base, light, clamp(big * 1.2 - 0.3));
    c = mixc(c, stain, clamp((0.42 - N.fbm(u + 0.3, v, 6, 4)) * 3) * 0.6);
    // tyre tracks lighter/smoother
    const track = Math.exp(-Math.pow((Math.abs(u - 0.5) - 0.27) / 0.08, 2));
    c = mixc(c, light, track * 0.25);
    // worn, chipped edges
    const chip = edge < 0.04 + N.fbm(u, v, 16, 3) * 0.05;
    let h = 0.55 + fine * 0.02 + big * 0.04;
    if (j < 0.008) { const t = j / 0.008; c = mixc(mixc(stain, moss, 0.35), c, t * t); h -= (1 - t) * 0.35; }
    if (chip) { c = mixc(c, hex('#8a7c64'), 0.7); h -= 0.25; }
    const k = 0.95 + fine * 0.08;
    return [c[0] * k, c[1] * k, c[2] * k, h];
  }, {
    normalStrength: 0.35,
    post: (col, hgt, size) => {
      for (const pts of cracks) for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
        const steps = 8;
        for (let s = 0; s <= steps; s++) {
          const x = Math.floor((x0 + (x1 - x0) * s / steps) * size), y = Math.floor((y0 + (y1 - y0) * s / steps) * size);
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const xi = ((x + ox) % size + size) % size, yi = ((y + oy) % size + size) % size;
            const i = yi * size + xi; const w = ox === 0 && oy === 0 ? 0.55 : 0.82;
            col[i * 4] *= w; col[i * 4 + 1] *= w; col[i * 4 + 2] *= w; hgt[i] -= 0.15;
          }
        }
      }
    },
  });
}

export function plasterTexture() {
  const N = makeNoise(41);
  return generate(512, (u, v) => {
    const f = N.noise(u * 220, v * 220, 220), m = N.fbm(u, v, 8, 4);
    const dirt = clamp(N.fbm(u, v * 0.5, 3, 4) - 0.45) * 0.4;
    const k = 235 * (0.93 + f * 0.07 + (m - 0.5) * 0.06 - dirt * 0.3);
    return [k, k, k, f * 0.5 + m * 0.3];
  }, { normalStrength: 1.5 });
}

/** Porotherm style ceramic blocks, 1 m x 1 m */
export function brickTexture() {
  const N = makeNoise(51);
  const brick = hex('#c26a43'), brick2 = hex('#ad5a38'), mortar = hex('#b8ad9c');
  return generate(512, (u, v) => {
    const rows = 4, cols = 4;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const off = row % 2 ? 0.5 : 0;
    const rx = u * cols + off, col = Math.floor(rx), fx = rx - col;
    const fine = N.noise(u * 300, v * 300, 300);
    const cellR = N.noise(col * 7.3 + row * 3.1, row * 5.7, 256);
    const mY = fy < 0.04;
    const groove = Math.abs(((fx * 9) % 1) - 0.5) > 0.42; // vertical grooves
    let c = mixc(brick, brick2, cellR);
    let h = 0.6 + fine * 0.08;
    if (fx < 0.01 || fx > 0.99) { c = mixc(c, brick2, 0.6); h -= 0.2; }
    if (groove) { c = mixc(c, brick2, 0.35); h -= 0.12; }
    if (mY) { c = mortar; h = 0.25 + fine * 0.1; }
    const k = 0.85 + fine * 0.25;
    return [c[0] * k, c[1] * k, c[2] * k, h];
  }, { normalStrength: 3 });
}

/** Roof tiles (1 m x 1 m): u along eave, v from ridge (0) to eave (1). Light grey -> tinted by material colour */
export function roofTileTexture() {
  const N = makeNoise(61);
  return generate(512, (u, v) => {
    const rows = 3, cols = 4.5;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const off = row % 2 ? 0.5 : 0;
    const cx = ((u * cols + off) % 1);
    const wave = Math.sin(cx * Math.PI * 2) * 0.5 + 0.5;
    const fine = N.noise(u * 300, v * 300, 300);
    const cell = N.noise(Math.floor(u * cols + off) * 3.7 + row * 11.1, row * 2.3, 256);
    let h = wave * 0.35 + fy * 0.45 + fine * 0.05;
    let k = 0.72 + wave * 0.18 + fy * 0.18 + (cell - 0.5) * 0.12 + fine * 0.06;
    if (fy > 0.93) { k *= 0.45; h = 0.1; } // shadow under overlapping row
    const moss = clamp(N.fbm(u, v, 5, 4) - 0.62) * 1.6;
    const g = 230 * k;
    return [g * (1 - moss * 0.35), g * (1 - moss * 0.1), g * (1 - moss * 0.5), h];
  }, { normalStrength: 4 });
}

export function metalRoofTexture() {
  const N = makeNoise(62);
  return generate(256, (u) => {
    const rib = Math.abs(((u * 5) % 1) - 0.5);
    const isRib = rib > 0.44;
    const fine = N.noise(u * 200, u * 7, 200);
    const k = 200 * (isRib ? 1.05 : 0.88) * (0.95 + fine * 0.08);
    return [k, k, k, isRib ? 1 : 0.3];
  }, { normalStrength: 4 });
}

/** Wood planks, vertical, 1 m x 1 m */
export function woodTexture(seed = 71, plankW = 8) {
  const N = makeNoise(seed);
  return generate(512, (u, v) => {
    const px = u * plankW, p = Math.floor(px), fx = px - p;
    const grain = N.noise(u * 20 + p * 3.3, v * 2, 20);
    const lines = Math.sin((u * 140 + grain * 6 + p * 17) * 1.3) * 0.5 + 0.5;
    const shade = 0.75 + N.noise(p * 13.7, 0.5, 256) * 0.35;
    let k = shade * (0.82 + lines * 0.12 + grain * 0.12);
    let h = 0.6 + lines * 0.1;
    if (fx < 0.05 || fx > 0.97) { k *= 0.35; h = 0.1; }
    const g = 220 * k;
    return [g, g * 0.97, g * 0.92, h];
  }, { normalStrength: 3 });
}

export function barkTexture(seed = 81) {
  const N = makeNoise(seed);
  return generate(256, (u, v) => {
    const n = N.fbm(u, v * 0.25, 8, 5);
    const ridges = Math.abs(Math.sin((u * 12 + n * 3) * Math.PI));
    const fine = N.noise(u * 128, v * 128, 128);
    const k = 0.45 + ridges * 0.45 + fine * 0.15;
    const g = 200 * k;
    return [g, g * 0.95, g * 0.88, ridges * 0.7 + fine * 0.3];
  }, { normalStrength: 6 });
}

export function blockWallTexture() {
  const N = makeNoise(91);
  return generate(512, (u, v) => {
    const rows = 5, cols = 2.5;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * cols + (row % 2) * 0.5, fx = rx - Math.floor(rx);
    const fine = N.noise(u * 300, v * 300, 300);
    const cell = N.noise(Math.floor(rx) * 9.1 + row, row * 4.3, 256);
    let k = 0.78 + cell * 0.12 + fine * 0.12, h = 0.6 + fine * 0.1;
    if (fy < 0.035 || fx < 0.015) { k *= 0.72; h = 0.3; }
    const g = 200 * k;
    return [g, g * 0.99, g * 0.95, h];
  }, { normalStrength: 2 });
}

export function stoneTexture() {
  const N = makeNoise(101);
  // worley cells
  const G = 6, pts = [];
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) pts.push([0.15 + N.R() * 0.7, 0.15 + N.R() * 0.7, N.R()]);
  const pal = [hex('#b9ad98'), hex('#9b8f7c'), hex('#c9bfae'), hex('#8c8172'), hex('#a89a86')];
  return generate(512, (u, v) => {
    let d1 = 9, d2 = 9, id = 0;
    const gx = Math.floor(u * G), gy = Math.floor(v * G);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = (gx + ox + G) % G, cy = (gy + oy + G) % G;
      const p = pts[cy * G + cx];
      const px = (gx + ox + p[0]) / G;
      const py = (gy + oy + p[1]) / G;
      const d = Math.hypot(u - px, v - py);
      if (d < d1) { d2 = d1; d1 = d; id = cy * G + cx; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    const fine = N.noise(u * 250, v * 250, 250);
    let c = pal[Math.floor(pts[id][2] * pal.length)];
    let h = 0.5 + Math.min(edge * 20, 0.4) + fine * 0.1;
    let k = 0.85 + fine * 0.25;
    if (edge < 0.012) { c = hex('#6e675d'); h = 0.1; k = 0.8; }
    return [c[0] * k, c[1] * k, c[2] * k, h];
  }, { normalStrength: 5 });
}

// ---- Alpha textures drawn with canvas 2D ------------------------------------

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

const leafPalettes = {
  broad: ['#3d5f22', '#4b6e28', '#56782f', '#2f4d1a', '#64853a', '#47662a'],
  locust: ['#5f7f2e', '#6f8f38', '#7d9b42', '#4f6f26', '#8aa84c'],
  bush: ['#35561e', '#406426', '#2b4718', '#4d722d', '#5b7e33'],
  oak: ['#344f1c', '#3f5d22', '#4a6a28', '#2a4316', '#56742e'],
};

/** Leaf cluster card (alpha). kind: broad | locust | bush | oak */
export function leafCardTexture(kind = 'broad', seed = 3) {
  const R = rng(seed);
  const pal = leafPalettes[kind];
  return canvasTex(512, (g, S) => {
    g.clearRect(0, 0, S, S);
    const n = kind === 'locust' ? 260 : kind === 'bush' ? 420 : 320;
    // a few twigs
    g.strokeStyle = '#4a3b2a'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.moveTo(S / 2, S * 0.98);
      g.quadraticCurveTo(S * (0.2 + R() * 0.6), S * 0.6, S * (0.1 + R() * 0.8), S * (0.1 + R() * 0.4)); g.stroke();
    }
    for (let i = 0; i < n; i++) {
      // distribution: roughly round blob
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.44;
      const x = S * (0.5 + Math.cos(a) * r), y = S * (0.5 + Math.sin(a) * r * 0.95);
      const len = kind === 'locust' ? 9 + R() * 6 : kind === 'bush' ? 9 + R() * 7 : 13 + R() * 10;
      const wid = len * (kind === 'locust' ? 0.5 : kind === 'oak' ? 0.55 : 0.6);
      const col = pal[Math.floor(R() * pal.length)];
      const shade = 0.7 + (1 - r / 0.44) * 0.2 + (0.5 - (y / S)) * 0.4;
      g.save(); g.translate(x, y); g.rotate(R() * Math.PI * 2);
      g.fillStyle = col; g.globalAlpha = 1;
      g.filter = `brightness(${shade.toFixed(2)})`;
      g.beginPath();
      if (kind === 'oak') {
        // lobed
        for (let k = 0; k < 3; k++) g.ellipse((k - 1) * len * 0.35, 0, len * 0.32, wid * (0.8 - Math.abs(k - 1) * 0.2), 0, 0, Math.PI * 2);
      } else g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      g.fill();
      g.filter = 'none';
      g.strokeStyle = 'rgba(30,40,15,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-len, 0); g.lineTo(len, 0); g.stroke();
      g.restore();
    }
  });
}

/** Needle clump card for pines / spruces */
export function needleCardTexture(kind = 'pine', seed = 5) {
  const R = rng(seed);
  return canvasTex(512, (g, S) => {
    g.clearRect(0, 0, S, S);
    const cols = kind === 'pine' ? ['#3c5a2c', '#4a6a34', '#2f4a24', '#557540'] : ['#1f3a22', '#2a4a2b', '#18301b', '#335536'];
    const twigs = kind === 'pine' ? 16 : 26;
    for (let t = 0; t < twigs; t++) {
      const x0 = S * (0.15 + R() * 0.7), y0 = S * (0.15 + R() * 0.7);
      const a = R() * Math.PI * 2, L = S * (0.12 + R() * 0.15);
      g.strokeStyle = '#5a4630'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * L, y0 + Math.sin(a) * L); g.stroke();
      const nn = kind === 'pine' ? 60 : 90;
      for (let i = 0; i < nn; i++) {
        const t2 = R();
        const bx = x0 + Math.cos(a) * L * t2, by = y0 + Math.sin(a) * L * t2;
        const na = a + (R() - 0.5) * 2.6;
        const nl = kind === 'pine' ? 14 + R() * 14 : 6 + R() * 6;
        g.strokeStyle = cols[Math.floor(R() * cols.length)]; g.lineWidth = kind === 'pine' ? 1.6 : 2.2;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(na) * nl, by + Math.sin(na) * nl); g.stroke();
      }
    }
  });
}

/** Welded wire panel fence (alpha). 1 texture = 1 m wide x 1.6 m tall panel section */
export function weldedMeshTexture() {
  return canvasTex(256, (g, S) => {
    g.clearRect(0, 0, S, S);
    g.strokeStyle = '#2f5a3a'; g.lineWidth = 3;
    for (let i = 0; i <= 20; i++) { const x = (i / 20) * S; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    const rows = [0.02, 0.15, 0.3, 0.45, 0.5, 0.6, 0.75, 0.9, 0.98];
    g.lineWidth = 4;
    for (const r of rows) { g.beginPath(); g.moveTo(0, r * S); g.lineTo(S, r * S); g.stroke(); }
  });
}

export function chainLinkTexture() {
  return canvasTex(128, (g, S) => {
    g.clearRect(0, 0, S, S);
    g.strokeStyle = '#8f938c'; g.lineWidth = 2.2;
    const n = 4;
    for (let i = -n; i <= n * 2; i++) {
      g.beginPath(); g.moveTo((i / n) * S, 0); g.lineTo((i / n) * S + S, S); g.stroke();
      g.beginPath(); g.moveTo((i / n) * S, 0); g.lineTo((i / n) * S - S, S); g.stroke();
    }
  });
}

/** Tall grass / weed card for verges */
export function weedCardTexture(seed = 9) {
  const R = rng(seed);
  return canvasTex(256, (g, S) => {
    g.clearRect(0, 0, S, S);
    const cols = ['#7a9440', '#8aa24a', '#a3ab62', '#6c8a34', '#b8ae70', '#94a24e'];
    for (let i = 0; i < 70; i++) {
      const x = S * (0.05 + R() * 0.9), hgt = S * (0.3 + R() * 0.65);
      const bend = (R() - 0.5) * S * 0.25;
      g.strokeStyle = cols[Math.floor(R() * cols.length)]; g.lineWidth = 1 + R() * 1.6;
      g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + bend * 0.3, S - hgt * 0.6, x + bend, S - hgt); g.stroke();
      if (R() < 0.12) { // seed heads
        g.fillStyle = '#b8a76a'; g.beginPath(); g.ellipse(x + bend, S - hgt, 2, 7, bend / S, 0, Math.PI * 2); g.fill();
      }
      if (R() < 0.04) { g.fillStyle = R() < 0.5 ? '#e8e4d0' : '#d9c24a'; g.beginPath(); g.arc(x + bend, S - hgt, 4, 0, Math.PI * 2); g.fill(); }
    }
  });
}

// ---- photo texture helpers ----------------------------------------------------

/** Greyscale copy of a photo texture (normalised brightness) so it can be tinted per house. */
export function desaturate(t, maxSize = 1024) {
  const img = t.image;
  const w = Math.min(maxSize, img.width), h = Math.round(w * img.height / img.width);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
  const avg = sum / (px.length / 4) || 128;
  const k = 215 / avg;
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.min(255, (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) * k);
    px[i] = px[i + 1] = px[i + 2] = l;
  }
  g.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace;
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.anisotropy = ANISO;
  return out;
}

/** Road slabs on top of a photo concrete texture: u across (3.3 m), v along (6 m). */
export function concreteSlabFromPhoto(p) {
  const S = 1024;
  const make = (img, isNormal) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const tw = (p.meters / 3.3) * S, th = (p.meters / 6) * S;
    for (let y = 0; y < S; y += th) for (let x = 0; x < S; x += tw) g.drawImage(img, x, y, tw, th);
    if (!isNormal) {
      const R = rng(77);
      // joints: longitudinal + staggered transverse every 1.5 m, dark & mossy
      g.strokeStyle = 'rgba(55,55,45,0.75)'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.stroke();
      for (let k = 0; k < 4; k++) {
        const y1 = (k / 4) * S, y2 = ((k / 4 + 0.125) % 1) * S;
        g.beginPath(); g.moveTo(0, y1); g.lineTo(S / 2, y1); g.stroke();
        g.beginPath(); g.moveTo(S / 2, y2); g.lineTo(S, y2); g.stroke();
      }
      // cracks
      g.strokeStyle = 'rgba(40,40,35,0.6)'; g.lineWidth = 1.6;
      for (let n = 0; n < 16; n++) {
        let x = R() * S, y = R() * S, a = R() * Math.PI * 2;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 14; k++) { a += (R() - 0.5) * 0.9; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); }
        g.stroke();
      }
      // worn, darker edges
      const grd = g.createLinearGradient(0, 0, S, 0);
      grd.addColorStop(0, 'rgba(90,80,60,0.45)'); grd.addColorStop(0.05, 'rgba(90,80,60,0)');
      grd.addColorStop(0.95, 'rgba(90,80,60,0)'); grd.addColorStop(1, 'rgba(90,80,60,0.45)');
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
    }
    const t = new THREE.CanvasTexture(c);
    if (!isNormal) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = ANISO;
    return t;
  };
  return { map: make(p.map.image, false), normalMap: p.normalMap ? make(p.normalMap.image, true) : null, photo: true };
}

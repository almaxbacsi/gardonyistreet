// Geometry helpers for Gárdonyi Géza utca.
// Data coordinates: x = east (m), y = north (m), origin 47.6464 N, 18.8224 E.
// Three.js world: X = x, Z = -y, Y = up.
import data from '../data/gardonyi.json';

export const OSM = data;

// Street centreline (OSM way 62112084), south-west -> north-east
export const CENTER = [
  [-93, -79],
  [-37, -30],
  [90, 83],
];

const segs = [];
let total = 0;
for (let i = 0; i < CENTER.length - 1; i++) {
  const a = CENTER[i], b = CENTER[i + 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  segs.push({ a, b, dx: dx / len, dy: dy / len, len, s0: total });
  total += len;
}
export const STREET_LENGTH = total;

/** Project data point (x,y) onto centreline: s = distance along, d = signed offset (+ = left/NW). */
export function project(x, y) {
  let best = null;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i];
    const px = x - g.a[0], py = y - g.a[1];
    let t = px * g.dx + py * g.dy;
    const first = i === 0, last = i === segs.length - 1;
    const tc = Math.max(first ? -1e9 : 0, Math.min(last ? 1e9 : g.len, t));
    const cx = g.a[0] + g.dx * tc, cy = g.a[1] + g.dy * tc;
    const dist = Math.hypot(x - cx, y - cy);
    if (!best || dist < best.dist) {
      const side = Math.sign(g.dx * py - g.dy * px) || 1;
      best = { s: g.s0 + tc, d: side * dist, dist };
    }
  }
  return best;
}

/** Point at distance s with lateral offset d (data coordinates). */
export function toXY(s, d = 0) {
  let g = segs[0];
  for (const sg of segs) if (s >= sg.s0) g = sg;
  const t = s - g.s0;
  const x = g.a[0] + g.dx * t - g.dy * d;
  const y = g.a[1] + g.dy * t + g.dx * d;
  return [x, y];
}

/** Direction (unit, data coords) of the street at s. */
export function dirAt(s) {
  let g = segs[0];
  for (const sg of segs) if (s >= sg.s0) g = sg;
  return [g.dx, g.dy];
}

// ---- Height model ----------------------------------------------------------
// Street View camera altitudes along the street (m a.s.l.): 228, 234, 236, 237, 238
// at s ≈ 4, 40, 72, 123, 165. Beyond that the road keeps climbing (visible uphill),
// coarse DEM suggests ~246 at the NE junction.
const BASE = 228;
const PROFILE = [
  [-60, 222.5],
  [-20, 226.2],
  [0, 228],
  [20, 231.5],
  [40, 234],
  [72, 236],
  [123, 237.2],
  [165, 238.6],
  [205, 241.8],
  [245, 246],
  [320, 252],
];

function smooth(t) { return t * t * (3 - 2 * t); }

export function roadHeight(s) {
  const P = PROFILE;
  if (s <= P[0][0]) return P[0][1] - BASE + (s - P[0][0]) * 0.08;
  if (s >= P[P.length - 1][0]) return P[P.length - 1][1] - BASE + (s - P[P.length - 1][0]) * 0.07;
  for (let i = 0; i < P.length - 1; i++) {
    if (s <= P[i + 1][0]) {
      // Catmull-Rom for a smooth profile
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const t = (s - p1[0]) / (p2[0] - p1[0]);
      const t2 = t * t, t3 = t2 * t;
      const v = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      return v - BASE;
    }
  }
  return 0;
}

// Small value-noise for natural ground bumps
function hash(ix, iy) {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xffff) / 0xffff;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = smooth(fx), v = smooth(fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; }
  return s;
}

const ROAD_HALF = 2.4; // flat zone incl. shoulders

// other roads (for suppressing ground bumps under them)
const OTHER = [];
for (const w of data.w) {
  if (w.k !== 'h' || w.n === 'Gárdonyi Géza utca' || w.v === 'path') continue;
  for (let k = 0; k + 3 < w.g.length; k += 2) OTHER.push([w.g[k], w.g[k + 1], w.g[k + 2], w.g[k + 3]]);
}
function distOtherRoads(x, y) {
  let m = 1e9;
  for (const [ax, ay, bx, by] of OTHER) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < m) m = d;
  }
  return m;
}

/** Ground height (relative to 228 m) at data point (x,y). */
export function heightAt(x, y) {
  const p = project(x, y);
  let h = roadHeight(p.s);
  const ad = Math.abs(p.d);
  if (ad > ROAD_HALF) {
    const t = ad - ROAD_HALF;
    const k = smooth(Math.min(1, t / 3));
    // NW side rises (houses sit above the road), SE side gently falls
    const slope = p.d > 0 ? 0.11 : -0.035;
    h += Math.max(-6, Math.min(16, slope * t * k));
    // bumps grow away from the road
    const bump = (fbm(x * 0.06, y * 0.06) - 0.5) * 1.4 + (fbm(x * 0.4 + 7, y * 0.4) - 0.5) * 0.15;
    const om = distOtherRoads(x, y);
    h += bump * smooth(Math.min(1, t / 8)) * smooth(Math.min(1, Math.max(0, (om - 2) / 6)));
  }
  // large-scale: rises towards north (DEM trend), only far from the street
  const far = smooth(Math.min(1, Math.max(0, (ad - 70) / 200)));
  h += far * ((y + 50) * 0.08 + (fbm(x * 0.008, y * 0.008, 3) - 0.5) * 40);
  return h;
}

/** World (three.js) helpers */
export const W = {
  x: (x) => x,
  z: (y) => -y,
  fromWorld: (X, Z) => [X, -Z],
  h: (X, Z) => heightAt(X, -Z),
};

export function polygonArea(g) {
  let a = 0;
  for (let i = 0; i < g.length; i++) {
    const p = g[i], q = g[(i + 1) % g.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToPolygon(x, y, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    m = Math.min(m, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return pointInPolygon(x, y, poly) ? -m : m;
}

/** Deterministic PRNG */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Building footprints as arrays of [x,y] (closing point removed). */
export function buildingFootprints() {
  return OSM.w.filter((w) => w.k === 'b').map((w, i) => {
    const pts = [];
    for (let k = 0; k < w.g.length; k += 2) pts.push([w.g[k], w.g[k + 1]]);
    const f = pts[0], l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
    // drop duplicate consecutive points
    const clean = pts.filter((p, j) => { const q = pts[(j + pts.length - 1) % pts.length]; return p[0] !== q[0] || p[1] !== q[1]; });
    return { id: i, pts: clean, addr: w.a };
  });
}

export function wayPoints(w) {
  const pts = [];
  for (let k = 0; k < w.g.length; k += 2) pts.push([w.g[k], w.g[k + 1]]);
  return pts;
}

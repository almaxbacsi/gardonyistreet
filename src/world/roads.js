import * as THREE from 'three';
import { toXY, dirAt, heightAt, OSM, wayPoints, fbm } from './geo.js';
import { ROAD } from './layout.js';

/** Ribbon following the Gárdonyi centreline between s0..s1 */
function streetRibbon(s0, s1, width, { vScale, uScale, yOff, jitter = 0, step = 1, skirt = 0.12 }) {
  const pos = [], uv = [], idx = [];
  const n = Math.ceil((s1 - s0) / step);
  for (let i = 0; i <= n; i++) {
    const s = s0 + (i / n) * (s1 - s0);
    const jl = jitter ? (fbm(s * 0.3, 1.7) - 0.5) * jitter * 2 : 0;
    const jr = jitter ? (fbm(s * 0.3, 8.3) - 0.5) * jitter * 2 : 0;
    const dl = width / 2 + jl, dr = -width / 2 + jr;
    const L = toXY(s, dl), Rr = toXY(s, dr);
    const hl = heightAt(L[0], L[1]) + yOff, hr = heightAt(Rr[0], Rr[1]) + yOff;
    // skirt L, L, R, R(skirt)
    pos.push(L[0], hl - skirt, -L[1], L[0], hl, -L[1], Rr[0], hr, -Rr[1], Rr[0], hr - skirt, -Rr[1]);
    const v = s / vScale;
    const uL = uScale ? dl / uScale : 0, uR = uScale ? dr / uScale : 1;
    uv.push(uL - 0.02, v, uL, v, uR, v, uR + 0.02, v);
    if (i < n) {
      const a = i * 4, b = a + 4;
      for (const [p, q] of [[0, 1], [1, 2], [2, 3]]) idx.push(a + p, a + q, b + p, a + q, b + q, b + p);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Ribbon following an arbitrary polyline (data coords) */
function polyRibbon(pts, width, { yOff, scale = 4 }) {
  // resample
  const P = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 1.2));
    for (let k = 0; k < n; k++) P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  P.push(pts[pts.length - 1]);
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (i > 0) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const w = width / 2;
    const L = [P[i][0] - dy * w, P[i][1] + dx * w], R = [P[i][0] + dy * w, P[i][1] - dx * w];
    pos.push(L[0], heightAt(L[0], L[1]) + yOff, -L[1], R[0], heightAt(R[0], R[1]) + yOff, -R[1]);
    uv.push(0, acc / scale, width / scale, acc / scale);
    if (i < P.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildRoads(M) {
  const group = new THREE.Group();
  group.name = 'roads';
  // Gárdonyi: concrete slab section (u 0..1 across, 6 m per texture repeat)
  const conc = new THREE.Mesh(streetRibbon(ROAD.concrete[0], ROAD.concrete[1], ROAD.width, { vScale: 6, yOff: 0.045, step: 0.75, skirt: 0.04 }), M.concreteRoad);
  conc.receiveShadow = true;
  group.add(conc);
  // dirt upper section, irregular edges
  const dirt = new THREE.Mesh(streetRibbon(ROAD.dirt[0], ROAD.dirt[1], 3.7, { vScale: 3, uScale: 3, yOff: 0.025, jitter: 0.35, step: 0.75, skirt: 0.05 }), M.dirtRoad);
  dirt.receiveShadow = true;
  group.add(dirt);

  // neighbouring streets
  for (const w of OSM.w) {
    if (w.k !== 'h' || w.n === 'Gárdonyi Géza utca' || w.v === 'path') continue;
    const s = w.s || '';
    const mat = s.startsWith('concrete') ? M.concreteRoad : s === 'fine_gravel' || s === 'gravel' ? M.gravelRoad : M.dirtRoad;
    const width = w.v === 'track' ? 2.6 : w.v === 'service' ? 2.8 : 3.4;
    const m = new THREE.Mesh(polyRibbon(wayPoints(w), width, { yOff: mat === M.concreteRoad ? 0.055 : 0.035, scale: mat === M.concreteRoad ? 6 : 3 }), mat);
    if (mat === M.concreteRoad) {
      // concrete texture expects u across 0..1
      const uv = m.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, i % 2 ? 1 : 0);
    }
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toXY, project, heightAt, rng, distToPolygon, pointInPolygon, buildingFootprints, OSM, wayPoints } from './geo.js';
import { vegDensity, LANDMARK_TREES, FENCES, PLAY, HEDGES } from './layout.js';
import { addWind } from './materials.js';
import { register } from '../dev/registry.js';

const SPECIES_NAMES = { locust: 'black locust', linden: 'linden', broad: 'broadleaf tree', oak: 'oak', pine: 'Scots pine', spruce: 'spruce', bush: 'bush' };

const UP = new THREE.Vector3(0, 1, 0);

// ---- procedural tree geometry -----------------------------------------------
function branch(geos, from, to, r0, r1, radial = 5) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  // stretch bark uv vertically
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.6);
  geos.push(g);
}

/** Leaf cards around a centre; normals point away from crownCenter for soft shading */
function cards(state, center, count, spread, size, crownCenter, R, opts = {}) {
  const { pos, nrm, uv, idx } = state;
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3(
      center.x + (R() - 0.5) * 2 * spread.x,
      center.y + (R() - 0.5) * 2 * spread.y,
      center.z + (R() - 0.5) * 2 * spread.z,
    );
    const s = size * (0.75 + R() * 0.5);
    // random orientation, biased to face outward/up
    const out = new THREE.Vector3().subVectors(p, crownCenter);
    if (opts.droop) out.y -= 0.6;
    out.normalize();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * Math.PI, R() * Math.PI * 2, R() * Math.PI));
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(s / 2);
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(s / 2);
    if (opts.droop) { ay.set(out.x, -0.9, out.z).normalize().multiplyScalar(s / 2); ax.set(-out.z, 0, out.x).normalize().multiplyScalar(s / 2); p.addScaledVector(ay, 1); }
    const base = pos.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [cx, cy] of corners) {
      pos.push(p.x + ax.x * cx + ay.x * cy, p.y + ax.y * cx + ay.y * cy, p.z + ax.z * cx + ay.z * cy);
      const nv = new THREE.Vector3().subVectors(new THREE.Vector3(p.x + ax.x * cx + ay.x * cy, p.y + ax.y * cx + ay.y * cy, p.z + ax.z * cx + ay.z * cy), crownCenter).normalize();
      nv.y += 0.35; nv.normalize();
      nrm.push(nv.x, nv.y, nv.z);
    }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function leafGeometry(state) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(state.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(state.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(state.uv, 2));
  g.setIndex(state.idx);
  return g;
}

const SPECIES = {
  locust: { bark: 'barkLight', leaf: 'locust', h: 13, r: 0.17, crownStart: 5.5, branches: 7, spread: 4.2, cards: 6, card: 1.7, lean: 0.12 },
  linden: { bark: 'bark', leaf: 'broad', h: 13, r: 0.25, crownStart: 3.2, branches: 8, spread: 4.8, cards: 9, card: 2.0, lean: 0.04 },
  broad: { bark: 'bark', leaf: 'broad', h: 10, r: 0.18, crownStart: 2.8, branches: 6, spread: 3.6, cards: 8, card: 1.8, lean: 0.06 },
  oak: { bark: 'bark', leaf: 'oak', h: 15, r: 0.42, crownStart: 3.6, branches: 9, spread: 6.5, cards: 11, card: 2.3, lean: 0.03 },
  pine: { bark: 'barkPine', leaf: 'pine', h: 17, r: 0.24, crownStart: 10.5, branches: 7, spread: 3.2, cards: 6, card: 1.8, lean: 0.05 },
};

function makeTree(species, seed) {
  const R = rng(seed);
  const sp = SPECIES[species];
  const bark = [];
  const st = { pos: [], nrm: [], uv: [], idx: [] };
  if (species === 'spruce') {
    const h = 13;
    branch(bark, new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, h, 0), 0.25, 0.03, 6);
    const layers = 16;
    for (let l = 0; l < layers; l++) {
      const t = l / layers;
      const y = 1.4 + t * (h - 1.8);
      const rad = (1 - t) * 3.0 + 0.3;
      const n = Math.max(4, Math.round(9 * (1 - t)) + 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + R();
        const c = new THREE.Vector3(Math.cos(a) * rad * 0.55, y, Math.sin(a) * rad * 0.55);
        cards(st, c, 1, new THREE.Vector3(rad * 0.2, 0.15, rad * 0.2), rad * 0.95 + 0.6, new THREE.Vector3(0, y + 0.8, 0), R, { droop: true });
      }
    }
    // top
    cards(st, new THREE.Vector3(0, h - 0.4, 0), 3, new THREE.Vector3(0.2, 0.3, 0.2), 1.0, new THREE.Vector3(0, h - 1.5, 0), R);
    return { bark: mergeGeometries(bark), leaves: leafGeometry(st), barkKey: 'bark', leafKey: 'spruce', trunkR: 0.28, height: h };
  }
  if (species === 'bush') {
    const crown = new THREE.Vector3(0, 0.6, 0);
    for (let k = 0; k < 5; k++) branch(bark, new THREE.Vector3((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3), new THREE.Vector3((R() - 0.5) * 1.4, 1.1 + R() * 0.6, (R() - 0.5) * 1.4), 0.03, 0.01, 3);
    cards(st, crown, 16, new THREE.Vector3(1.0, 0.55, 1.0), 1.25, new THREE.Vector3(0, 0.1, 0), R);
    cards(st, new THREE.Vector3(0, 1.05, 0), 6, new THREE.Vector3(0.6, 0.3, 0.6), 1.0, new THREE.Vector3(0, 0.2, 0), R);
    return { bark: mergeGeometries(bark), leaves: leafGeometry(st), barkKey: 'bark', leafKey: 'bush', trunkR: 0, height: 1.6 };
  }

  const h = sp.h * (0.9 + R() * 0.2);
  const lean = new THREE.Vector3((R() - 0.5) * sp.lean, 1, (R() - 0.5) * sp.lean).normalize();
  const top = lean.clone().multiplyScalar(h * 0.82);
  // trunk in 2 segments with slight bend
  const mid = lean.clone().multiplyScalar(sp.crownStart).add(new THREE.Vector3((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3));
  branch(bark, new THREE.Vector3(0, -0.4, 0), mid, sp.r * 1.15, sp.r * 0.8, 7);
  branch(bark, mid, top, sp.r * 0.8, sp.r * 0.25, 6);
  const crownCenter = new THREE.Vector3(top.x * 0.8, (sp.crownStart + h) / 2 + (species === 'pine' ? 1.0 : 0), top.z * 0.8);
  for (let b = 0; b < sp.branches; b++) {
    const t = species === 'pine' ? 0.75 + R() * 0.25 : 0.25 + R() * 0.65;
    const start = new THREE.Vector3().lerpVectors(mid, top, t);
    if (t < 0.3) start.lerpVectors(new THREE.Vector3(0, sp.crownStart * 0.85, 0), mid, 0.5 + t);
    const a = (b / sp.branches) * Math.PI * 2 + R() * 0.8;
    const up = species === 'pine' ? 0.25 + R() * 0.3 : 0.45 + R() * 0.55;
    const len = sp.spread * (0.6 + R() * 0.5) * (1 - t * 0.35);
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len, up * len, Math.sin(a) * len));
    branch(bark, start, end, sp.r * 0.45 * (1 - t * 0.5), 0.03, 4);
    // sub-branch
    const sub = new THREE.Vector3().lerpVectors(start, end, 0.55);
    const a2 = a + (R() - 0.5) * 1.6;
    const end2 = sub.clone().add(new THREE.Vector3(Math.cos(a2) * len * 0.45, len * 0.35, Math.sin(a2) * len * 0.45));
    branch(bark, sub, end2, sp.r * 0.2, 0.02, 3);
    const cs = species === 'pine' ? new THREE.Vector3(1.2, 0.45, 1.2) : new THREE.Vector3(1.3, 0.9, 1.3).multiplyScalar(sp.spread / 4);
    cards(st, end, sp.cards, cs, sp.card, crownCenter, R);
    cards(st, end2, Math.ceil(sp.cards * 0.6), cs.clone().multiplyScalar(0.7), sp.card * 0.9, crownCenter, R);
  }
  // fill crown top
  cards(st, top, Math.ceil(sp.cards * 1.2), new THREE.Vector3(1.5, 0.8, 1.5).multiplyScalar(species === 'pine' ? 0.9 : sp.spread / 3.5), sp.card, crownCenter, R);
  return { bark: mergeGeometries(bark), leaves: leafGeometry(st), barkKey: sp.bark, leafKey: sp.leaf, trunkR: sp.r * 1.15, height: h };
}

// ---- placement --------------------------------------------------------------
function speciesFor(s, d, R) {
  const x = R();
  const ad = Math.abs(d);
  if (s < 62) return x < 0.5 ? 'locust' : x < 0.82 ? 'broad' : x < 0.92 ? 'oak' : 'linden';
  if (s < 110) return x < 0.45 ? 'locust' : x < 0.7 ? 'broad' : x < 0.85 ? 'linden' : 'spruce';
  if (s < 145) return x < 0.3 ? 'broad' : x < 0.5 ? 'spruce' : x < 0.7 ? 'locust' : x < 0.85 ? 'pine' : 'linden';
  return x < 0.35 ? 'oak' : x < 0.55 ? 'pine' : x < 0.8 ? 'broad' : 'locust';
}

export function buildVegetation(M, { vegScale = 1, uniforms }) {
  const R = rng(4242);
  const group = new THREE.Group();
  group.name = 'vegetation';
  const colliders = [];
  const buildings = buildingFootprints().map((b) => b.pts);
  const forest = OSM.w.filter((w) => w.k === 'l' && w.v === 'forest').map((w) => wayPoints(w));
  const roadSegs = [];
  for (const w of OSM.w) if (w.k === 'h' && w.n !== 'Gárdonyi Géza utca') { const p = wayPoints(w); for (let i = 0; i < p.length - 1; i++) roadSegs.push([p[i], p[i + 1], w.v === 'path' ? 1.2 : 3.2]); }
  const nearRoad = (x, y) => {
    for (const [a, b, r] of roadSegs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < r) return true;
    }
    return false;
  };
  const nearFence = (s, d, m) => FENCES.some(([side, s0, s1, dd]) => s > s0 - 0.5 && s < s1 + 0.5 && Math.abs(d - side * dd) < m);
  const blocked = (x, y, margin) => buildings.some((b) => distToPolygon(x, y, b) < margin);
  const nearPlay = (s, d) => s > PLAY.sMin - 20 && s < PLAY.sMax + 20 && Math.abs(d) < 40;

  // build species variants
  const variantsPer = 3;
  const kinds = ['locust', 'linden', 'broad', 'oak', 'pine', 'spruce', 'bush'];
  const variants = {};
  for (const k of kinds) variants[k] = Array.from({ length: k === 'bush' ? 4 : variantsPer }, (_, i) => makeTree(k, 100 + i * 31 + k.length * 7));

  const inst = {}; // key `${kind}:${v}` -> matrices
  const interactive = []; // instances near the street that tools can damage (src/gameplay/interactions.js)
  const add = (kind, x, y, scale, rotY, opts = {}) => {
    const v = Math.floor(R() * variants[kind].length);
    const key = kind + ':' + v;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, heightAt(x, y) - 0.05, -y),
      new THREE.Quaternion().setFromAxisAngle(UP, rotY),
      new THREE.Vector3(scale * (opts.sx || 1), scale * (opts.sy || 1), scale * (opts.sz || 1)));
    (inst[key] ||= []).push(m);
    const tr = variants[kind][v].trunkR * scale;
    const p = project(x, y);
    let collider = null;
    if (tr > 0 && nearPlay(p.s, p.d)) { collider = [x, y, tr + 0.12]; colliders.push(collider); }
    if (Math.abs(p.d) < 30 && p.s > PLAY.sMin - 10 && p.s < PLAY.sMax + 10) {
      interactive.push({
        kind, key, index: inst[key].length - 1, base: m.clone(), x, y, collider,
        hedge: !!opts.hedge, height: (kind === 'bush' ? 1.55 * (opts.sy || 1) : 9) * scale,
        radius: kind === 'bush' ? 0.75 * scale * Math.max(opts.sx || 1, opts.sz || 1) : tr + 0.15,
      });
    }
  };

  // landmark trees from Street View
  LANDMARK_TREES.forEach(([s, d, kind, sc], i) => {
    const [x, y] = toXY(s, d);
    add(kind, x, y, sc, R() * 6.28);
    register('tree', [x, heightAt(x, y) + 4.5 * sc, -y], `${SPECIES_NAMES[kind]} (size ${sc}), s ${s} m, d ${d} m`, `tree-${i + 1}`, `LANDMARK_TREES[${i}] (layout.js)`);
  });

  const density = Math.min(1, 0.25 + 0.75 * vegScale);
  // street-side trees & bushes
  const grid = 3.6;
  for (let s = -60; s < 290; s += grid) for (let d = -75; d <= 75; d += grid) {
    const ss = s + (R() - 0.5) * grid, dd = d + (R() - 0.5) * grid;
    const ad = Math.abs(dd);
    if (ad < 3.4) continue;
    const [x, y] = toXY(ss, dd);
    if (nearRoad(x, y)) continue;
    const dens = vegDensity(ss, dd);
    // street corridor: only the trees seen on Street View (landmarks); random filler only far away
    const inCorridor = ad < 45 && ss > -40 && ss < 260;
    const falloff = inCorridor ? 0 : 0.45;
    if (R() < dens.tree * 0.3 * falloff * density) {
      if (!blocked(x, y, 3.0) && !nearFence(ss, dd, 1.2)) add(speciesFor(ss, dd, R), x, y, 0.75 + R() * 0.45, R() * 6.28);
    }
    // bushes, a few per cell
    // undergrowth only where the panoramas show dense bush (SE side near the junction, NW bank at P2)
    const bushZone = (ss > -5 && ss < 62 && dd < -3 && dd > -14) || (ss > 78 && ss < 108 && dd > 5.5 && dd < 12);
    const bushF = bushZone ? 0.9 : inCorridor ? 0 : 0.35;
    for (let k = 0; k < 3; k++) {
      if (R() < dens.bush * 0.45 * bushF * density) {
        const bs = ss + (R() - 0.5) * grid, bd = dd + (R() - 0.5) * grid;
        if (Math.abs(bd) < 2.9) continue;
        const [bx, by] = toXY(bs, bd);
        if (blocked(bx, by, 1.5) || nearRoad(bx, by)) continue;
        add('bush', bx, by, 0.8 + R() * 0.9, R() * 6.28, { sy: 0.8 + R() * 0.6 });
      }
    }
  }
  // trimmed hedges (thuja / privet) behind fences
  HEDGES.forEach(([side, s0, s1, dd, h], i) => { const [x, y] = toXY((s0 + s1) / 2, side * dd); register('hedge', [x, heightAt(x, y) + h + 0.5, -y], `trimmed hedge ${h} m, s ${s0}–${s1} m`, `hedge-${i + 1}`, `HEDGES[${i}] (layout.js)`); });
  for (const [side, s0, s1, dd, h] of HEDGES) {
    for (let s = s0; s <= s1; s += 0.75) {
      const [x, y] = toXY(s + (R() - 0.5) * 0.15, side * dd);
      add('bush', x, y, 1, R() * 6.28, { sx: 0.62, sy: h / 1.55, sz: 0.62, hedge: true });
    }
  }
  // forest polygon (western woods) + far trees
  for (let i = 0; i < Math.round(650 * vegScale); i++) {
    const x = -420 + R() * 460, y = -140 + R() * 420;
    const inF = forest.some((f) => pointInPolygon(x, y, f));
    const p = project(x, y);
    if (Math.abs(p.d) < 45 && p.s > -40 && p.s < 290) continue;
    if (!inF && R() < 0.75) continue;
    if (blocked(x, y, 3) || nearRoad(x, y)) continue;
    const k = R();
    add(k < 0.45 ? 'oak' : k < 0.75 ? 'broad' : k < 0.9 ? 'locust' : 'linden', x, y, 0.9 + R() * 0.4, R() * 6.28);
  }
  // scattered far trees elsewhere for the horizon
  for (let i = 0; i < Math.round(450 * vegScale); i++) {
    const a = R() * Math.PI * 2, r = 80 + R() * 190;
    const x = Math.cos(a) * r, y = 10 + Math.sin(a) * r;
    const p = project(x, y);
    if (Math.abs(p.d) < 45 && p.s > -40 && p.s < 290) continue;
    if (blocked(x, y, 3) || nearRoad(x, y)) continue;
    const k = R();
    add(k < 0.3 ? 'locust' : k < 0.55 ? 'broad' : k < 0.75 ? 'oak' : k < 0.88 ? 'pine' : 'spruce', x, y, 0.85 + R() * 0.4, R() * 6.28);
  }

  // create instanced meshes
  const meshes = {};
  for (const key of Object.keys(inst)) {
    const [kind, v] = key.split(':');
    const tv = variants[kind][+v];
    const mats = inst[key];
    const leafMat = M.leaves[tv.leafKey];
    if (!leafMat.userData.wind) { addWind(leafMat, uniforms, kind === 'bush' ? 0.5 : 1); leafMat.userData.wind = true; }
    const tm = new THREE.InstancedMesh(tv.bark, M[tv.barkKey], mats.length);
    const lm = new THREE.InstancedMesh(tv.leaves, leafMat, mats.length);
    mats.forEach((m, i) => { tm.setMatrixAt(i, m); lm.setMatrixAt(i, m); });
    meshes[key] = { tm, lm };
    for (const m of [tm, lm]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); group.add(m); }
    lm.name = 'leaves:' + key;
  }

  // ---- weeds / tall grass cards along verges and lots
  const wg = [];
  const q1 = new THREE.PlaneGeometry(0.9, 0.55).translate(0, 0.27, 0);
  wg.push(q1.clone(), q1.clone().rotateY(Math.PI / 2));
  const weedGeo = mergeGeometries(wg);
  // point normals up for soft look
  const wn = weedGeo.attributes.normal;
  for (let i = 0; i < wn.count; i++) wn.setXYZ(i, 0, 1, 0);
  const weedMat = M.weeds;
  addWind(weedMat, uniforms, 1.6);
  const wm = [];
  const nW = Math.round(1800 * vegScale);
  for (let i = 0; i < nW; i++) {
    const s = -20 + R() * 240;
    const near = R() < 0.8;
    const sideSign = R() < 0.5 ? -1 : 1;
    const d = sideSign * (near ? 2.0 + R() * 2.2 : 2.5 + Math.pow(R(), 1.5) * 28);
    const [x, y] = toXY(s, d);
    if (blocked(x, y, 0.6) || nearRoad(x, y)) continue;
    const sc = near ? 0.5 + R() * 0.6 : 0.6 + R() * 0.7;
    wm.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, y) - 0.03, -y), new THREE.Quaternion().setFromAxisAngle(UP, R() * 3.14), new THREE.Vector3(sc, sc * (0.7 + R() * 0.6), sc)));
  }
  const weeds = new THREE.InstancedMesh(weedGeo, weedMat, wm.length);
  wm.forEach((m, i) => weeds.setMatrixAt(i, m));
  weeds.receiveShadow = true;
  weeds.castShadow = false;
  weeds.computeBoundingSphere();
  group.add(weeds);
  for (const r of interactive) Object.assign(r, meshes[r.key]);

  return { group, colliders, interactive, weeds: { mesh: weeds, matrices: wm } };
}

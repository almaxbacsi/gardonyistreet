import * as THREE from 'three';
import { toXY, dirAt, heightAt, rng } from './geo.js';
import { FENCES } from './layout.js';
import { GeoBuilder, Batcher } from './builder.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);

export function buildFences(M) {
  const batch = new Batcher();
  const colliders = [];
  const R = rng(1234);

  const put = (key, mat, geo, x, y, h, rotY, tilt = 0, scale = ONE) => {
    q.setFromAxisAngle(UP, rotY);
    if (tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    m4.compose(new THREE.Vector3(x, h, -y), q, scale);
    batch.addTransformed(key, mat, geo, m4);
  };

  const sqPost = new THREE.BoxGeometry(0.06, 1, 0.06).translate(0, 0.5, 0);
  const rndPost = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, 0.5, 0);
  const woodPost = new THREE.CylinderGeometry(0.045, 0.055, 1, 6).translate(0, 0.5, 0);
  const pillar = new THREE.BoxGeometry(0.42, 1, 0.42).translate(0, 0.5, 0);
  const pillarCap = new THREE.BoxGeometry(0.5, 0.07, 0.5);
  const bar = new THREE.BoxGeometry(0.02, 1, 0.02).translate(0, 0.5, 0);
  const rail = new THREE.BoxGeometry(1, 0.04, 0.03);
  const blackPost = new THREE.BoxGeometry(0.08, 1, 0.08).translate(0, 0.5, 0);
  const weed = new THREE.PlaneGeometry(1.4, 0.9).translate(0, 0.45, 0);

  // Ribbon/plane between consecutive points following terrain
  const plane = (gb, pts, h0, h1, uScale, vMax = 1) => {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      gb.quad([a[0], a[2] + h0, -a[1]], [b[0], b[2] + h0, -b[1]], [b[0], b[2] + h1, -b[1]], [a[0], a[2] + h1, -a[1]],
        [acc / uScale, 0], [(acc + len) / uScale, 0], [(acc + len) / uScale, vMax], [acc / uScale, vMax]);
      acc += len;
    }
  };

  for (const [side, s0, s1, dd, type, opts = {}] of FENCES) {
    if (type === 'none') continue;
    const d = side * dd;
    const dir = dirAt((s0 + s1) / 2);
    const rotY = Math.atan2(dir[1], dir[0]);
    const spacing = type === 'mesh-wood' ? 3 : type === 'planks' ? 2.6 : 2.5;
    const n = Math.max(1, Math.round((s1 - s0) / spacing));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + (i / n) * (s1 - s0);
      const [x, y] = toXY(s, d);
      pts.push([x, y, heightAt(x, y), s]);
    }
    const A = toXY(s0, d), B = toXY(s1, d);
    colliders.push([A[0], A[1], B[0], B[1]]);
    const inGate = (s) => opts.gateAt && s > opts.gateAt[0] && s < opts.gateAt[1];

    if (type === 'panel') {
      const gb = new GeoBuilder();
      plane(gb, pts, 0.04, 1.62, 1, 1);
      batch.add('fence-panel', M.panelFence, gb.build());
      for (const p of pts) put('metal-green', M.metalGreen, sqPost, p[0], p[1], p[2] - 0.3, rotY, 0, new THREE.Vector3(1, 2.0, 1));
    } else if (type === 'chain') {
      const h = opts.h || 1.2;
      const gb = new GeoBuilder();
      // slight sag / lean variation
      plane(gb, pts, 0.05, h, 0.45, h / 0.45);
      batch.add('fence-chain', M.chainFence, gb.build());
      for (const p of pts) put('metal-grey', M.metalGrey, rndPost, p[0], p[1], p[2] - 0.2, rotY, (R() - 0.5) * 0.08, new THREE.Vector3(1, h + 0.25, 1));
      // overgrowth along chain fences
      for (const p of pts) for (let k = 0; k < 2; k++) {
        const t = R();
        const s = p[3] + t * spacing;
        const [x, y] = toXY(s, d + (R() - 0.5) * 0.6);
        put('weeds', M.weeds, weed, x, y, heightAt(x, y) - 0.05, rotY + (R() - 0.5) * 0.6, 0, new THREE.Vector3(1 + R(), 0.8 + R() * 0.9, 1));
      }
      if (opts.pillarAt) for (const s of opts.pillarAt) {
        const [x, y] = toXY(s, d);
        const g = heightAt(x, y);
        put('plaster-white', M.plaster(0xe9e6df), pillar, x, y, g - 0.2, rotY, 0, new THREE.Vector3(1, 1.75, 1));
        put('plinth', M.concrete, pillarCap, x, y, g + 1.58, rotY);
      }
    } else if (type === 'gate-green') {
      const gb = new GeoBuilder();
      plane(gb, pts, 0.08, 1.75, 1, 1);
      batch.add('fence-panel', M.panelFence, gb.build());
      for (const p of [pts[0], pts[pts.length - 1]]) put('metal-green', M.metalGreen, new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0), p[0], p[1], p[2] - 0.3, rotY, 0, new THREE.Vector3(1, 2.2, 1));
      // frame
      const L = s1 - s0, mid = toXY((s0 + s1) / 2, d), gh = heightAt(mid[0], mid[1]);
      for (const hh of [0.1, 0.95, 1.75]) put('metal-green', M.metalGreen, rail, mid[0], mid[1], gh + hh, rotY, 0, new THREE.Vector3(L, 1.4, 1.4));
      put('metal-green', M.metalGreen, new THREE.BoxGeometry(0.05, 1.7, 0.05).translate(0, 0.85, 0), mid[0], mid[1], gh + 0.08, rotY);
    } else if (type === 'blockwall') {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const sm = (a[3] + b[3]) / 2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, gh = Math.min(a[2], b[2]);
        if (inGate(sm)) {
          // black sliding gate with vertical bars
          for (let k = 0; k < Math.floor(len / 0.12); k++) {
            const t = (k + 0.5) / Math.floor(len / 0.12);
            put('metal-black', M.metalBlack, bar, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, gh + 0.05, rotY, 0, new THREE.Vector3(1, 1.6, 1));
          }
          for (const hh of [0.12, 1.6]) put('metal-black', M.metalBlack, rail, mx, my, gh + hh, rotY, 0, new THREE.Vector3(len, 1.5, 1.5));
          continue;
        }
        const wall = new THREE.BoxGeometry(len + 0.01, 1, 0.25).translate(0, 0.5, 0);
        // uv scale for block texture: 2 m wide x 1 m tall per tile
        const uv = wall.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len / 2, uv.getY(k) * 1.3);
        put('blockwall', M.block, wall, mx, my, gh - 0.3, rotY, 0, new THREE.Vector3(1, 1.6, 1));
        const board = new THREE.BoxGeometry(len + 0.01, 0.22, 0.05);
        put('wood:board', M.woodPlank(0xb07a45), board, mx + 0, my, gh + 1.42, rotY);
        put('plinth', M.concrete, new THREE.BoxGeometry(len + 0.02, 0.06, 0.32), mx, my, gh + 1.32, rotY);
      }
    } else if (type === 'mesh-wood') {
      const gb = new GeoBuilder();
      plane(gb, pts, 0.05, 1.0, 0.35, 1.0 / 0.35);
      batch.add('fence-chain', M.chainFence, gb.build());
      for (const p of pts) put('wood:post', M.wood(0x6d5a45), woodPost, p[0], p[1], p[2] - 0.2, rotY, (R() - 0.5) * 0.15, new THREE.Vector3(1, 1.35, 1));
    } else if (type === 'bars') {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, gh = Math.min(a[2], b[2]);
        put('plinth', M.concrete, new THREE.BoxGeometry(len, 1, 0.2).translate(0, 0.5, 0), mx, my, gh - 0.3, rotY, 0, new THREE.Vector3(1, 0.7, 1));
        const nb = Math.floor(len / 0.13);
        for (let k = 0; k < nb; k++) {
          const t = (k + 0.5) / nb;
          put('metal-black', M.metalBlack, bar, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, gh + 0.4, rotY, 0, new THREE.Vector3(1, 1.15, 1));
        }
        for (const hh of [0.5, 1.45]) put('metal-black', M.metalBlack, rail, mx, my, gh + hh, rotY, 0, new THREE.Vector3(len, 1, 1));
      }
      for (const p of pts) put('metal-black', M.metalBlack, blackPost, p[0], p[1], p[2] - 0.2, rotY, 0, new THREE.Vector3(1, 1.8, 1));
    } else if (type === 'planks') {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.42;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, gh = Math.min(a[2], b[2]);
        const g = new THREE.BoxGeometry(len, 1.45, 0.04).translate(0, 0.725, 0);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len, uv.getY(k) * 1.45);
        const gate = inGate((a[3] + b[3]) / 2);
        put(gate ? 'wood:gate' : 'wood:planks', M.woodPlank(gate ? 0x3e2a1e : 0x4e3626), g, mx, my, gh + 0.05, rotY);
        put('wood:planks', M.woodPlank(0x4e3626), rail, mx, my, gh + 0.35, rotY, 0, new THREE.Vector3(len, 2, 2));
      }
      for (const p of pts) {
        put('stone', M.stone, pillar, p[0], p[1], p[2] - 0.2, rotY, 0, new THREE.Vector3(1, 1.85, 1));
        put('plinth', M.concrete, pillarCap, p[0], p[1], p[2] + 1.66, rotY);
      }
    }
  }
  const group = batch.toGroup();
  group.name = 'fences';
  // alpha-tested planes look better without casting full shadows from far; keep shadows on
  return { group, colliders };
}

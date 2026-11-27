import * as THREE from 'three';
import { toXY, dirAt, heightAt } from './geo.js';
import { POLES, PROPS } from './layout.js';
import { Batcher, GeoBuilder } from './builder.js';

const UP = new THREE.Vector3(0, 1, 0);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();

function rounded(w, h, d, r = 0.08) {
  // cheap rounded box: box + chamfer via scale of a sphere-ish box (BoxGeometry with more segments, push verts)
  const g = new THREE.BoxGeometry(w, h, d, 4, 3, 4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ix = Math.max(0, Math.abs(v.x) - (w / 2 - r)), iy = Math.max(0, Math.abs(v.y) - (h / 2 - r)), iz = Math.max(0, Math.abs(v.z) - (d / 2 - r));
    const len = Math.hypot(ix, iy, iz);
    if (len > 0) {
      const k = r / len;
      v.x = Math.sign(v.x) * (w / 2 - r + ix * k);
      v.y = Math.sign(v.y) * (h / 2 - r + iy * k);
      v.z = Math.sign(v.z) * (d / 2 - r + iz * k);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildProps(M) {
  const batch = new Batcher();
  const colliders = { segs: [], circles: [] };
  const put = (key, mat, geo, x, y, h, rotY = 0, s = 1) => {
    q.setFromAxisAngle(UP, rotY);
    m4.compose(new THREE.Vector3(x, h, -y), q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
    batch.addTransformed(key, mat, geo, m4);
  };
  const streetRot = (s) => { const d = dirAt(s); return Math.atan2(d[1], d[0]); };

  // ---- utility poles + wires
  const concPole = new THREE.CylinderGeometry(0.1, 0.16, 9, 8).translate(0, 4.5, 0);
  const woodPole = new THREE.CylinderGeometry(0.11, 0.14, 8.5, 8).translate(0, 4.25, 0);
  const arm = new THREE.BoxGeometry(1.2, 0.08, 0.08);
  const insul = new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6);
  const tops = [];
  for (const p of POLES) {
    const [x, y] = toXY(p.s, p.d);
    const g = heightAt(x, y);
    const rot = streetRot(p.s) + Math.PI / 2;
    if (p.kind === 'concrete') put('pole-conc', M.concrete, concPole, x, y, g - 0.4, rot);
    else put('pole-wood', M.wood(0x6b5844), woodPole, x, y, g - 0.4, rot);
    const top = g + (p.kind === 'concrete' ? 8.4 : 7.9);
    put('metal-grey', M.metalGrey, arm, x, y, top - 0.35, rot);
    const dir = dirAt(p.s);
    const ox = -dir[1], oy = dir[0]; // across street
    const pts = [];
    for (const k of [-0.5, 0, 0.5]) {
      const ix = x + ox * k, iy = y + oy * k;
      put('insul', M.plastic(0xdedad2), insul, ix, iy, top - 0.25, 0);
      pts.push([ix, iy, top - 0.18]);
    }
    tops.push(pts);
    colliders.circles.push([x, y, 0.25]);
  }
  // catenary wires
  const wireGroup = new THREE.Group();
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  for (let i = 0; i < tops.length - 1; i++) for (let k = 0; k < 3; k++) {
    const a = tops[i][k], b = tops[i + 1][k];
    const pts = [];
    for (let t = 0; t <= 16; t++) {
      const u = t / 16;
      const sag = Math.sin(u * Math.PI) * 0.45;
      pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * u, a[2] + (b[2] - a[2]) * u - sag, -(a[1] + (b[1] - a[1]) * u)));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 3, false);
    wireGroup.add(new THREE.Mesh(tube, wireMat));
  }

  // ---- props
  for (const p of PROPS) {
    const [x, y] = p.at || toXY(p.s, p.d);
    const g = heightAt(x, y);
    const rot = p.at ? p.rot : streetRot(p.s);
    if (p.type === 'bin') {
      const body = rounded(0.58, 1.0, 0.72, 0.05);
      put('bin', M.plastic(0x23272a), body, x, y, g + 0.52, rot + (p.rot || 0));
      const lid = rounded(0.62, 0.06, 0.78, 0.02);
      put('bin', M.plastic(0x23272a), lid, x, y, g + 1.05, rot + (p.rot || 0));
      const wheel = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2);
      put('tyre', M.plastic(0x111111), wheel, x, y, g + 0.1, rot + (p.rot || 0));
      colliders.circles.push([x, y, 0.42]);
    } else if (p.type === 'standpipe') {
      // blue public water standpipe (közkút)
      const col = new THREE.CylinderGeometry(0.09, 0.1, 1.1, 10).translate(0, 0.55, 0);
      put('blue', M.plastic(0x2f7fd8), col, x, y, g, rot);
      const head = new THREE.CylinderGeometry(0.12, 0.1, 0.16, 10);
      put('blue', M.plastic(0x2f7fd8), head, x, y, g + 1.15, rot);
      const spout = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8).rotateZ(Math.PI / 2).translate(0.15, 0, 0);
      put('blue', M.plastic(0x2f7fd8), spout, x, y, g + 0.85, rot + Math.PI / 2);
      const handle = new THREE.BoxGeometry(0.04, 0.04, 0.4).translate(0, 0, 0.18);
      put('blue', M.plastic(0x2f7fd8), handle, x, y, g + 1.2, rot);
      const slab = new THREE.BoxGeometry(0.7, 0.1, 0.7);
      put('plinth', M.concrete, slab, x, y, g + 0.02, rot);
      colliders.circles.push([x, y, 0.3]);
    } else if (p.type === 'car') {
      buildCar(batch, M, x, y, g, rot, p.color);
      const d = dirAt(p.s);
      colliders.segs.push([x - d[0] * 1.9, y - d[1] * 1.9, x + d[0] * 1.9, y + d[1] * 1.9, 0.85]);
    } else if (p.type === 'carport') {
      const d = dirAt(p.s), n = [-d[1], d[0]];
      const W = 3.6, Dp = 5.5;
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        const px = x + d[0] * a * W / 2 + n[0] * b * Dp / 2, py = y + d[1] * a * W / 2 + n[1] * b * Dp / 2;
        const ph = heightAt(px, py);
        put('wood:carport', M.wood(0x9a6a42), new THREE.BoxGeometry(0.15, 2.6, 0.15).translate(0, 1.3, 0), px, py, ph, rot);
        colliders.circles.push([px, py, 0.15]);
      }
      for (const b of [-1, 1]) put('wood:carport', M.wood(0x9a6a42), new THREE.BoxGeometry(W + 0.5, 0.2, 0.15), x + n[0] * b * Dp / 2, y + n[1] * b * Dp / 2, g + 2.6, rot);
      for (let k = -2; k <= 2; k++) put('wood:carport', M.wood(0x9a6a42), new THREE.BoxGeometry(0.1, 0.16, Dp + 0.6), x + d[0] * k * W / 4.4, y + d[1] * k * W / 4.4, g + 2.78, rot);
      // tile roof (gable along the depth)
      const roof = new GeoBuilder();
      const P = (a, b, h) => [x + d[0] * a + n[0] * b, h, -(y + d[1] * a + n[1] * b)];
      const rh = g + 2.86, ridge = rh + 0.9;
      for (const side of [-1, 1]) roof.quad(P(0, -Dp / 2 - 0.4, ridge), P(0, Dp / 2 + 0.4, ridge), P(side * (W / 2 + 0.4), Dp / 2 + 0.4, rh), P(side * (W / 2 + 0.4), -Dp / 2 - 0.4, rh), [0, 0], [Dp, 0], [Dp, 2.2], [0, 2.2]);
      const rm = M.roof(0x7a3b2a); rm.side = THREE.DoubleSide;
      batch.add('roof:carport', rm, roof.build());
    } else if (p.type === 'cabin') {
      buildCabin(batch, M, x, y, g, rot);
      const d = [Math.cos(rot), Math.sin(rot)], n = [-d[1], d[0]];
      const c = (a, b) => [x + d[0] * a + n[0] * b, y + d[1] * a + n[1] * b];
      const cs = [c(-2, -1.6), c(2, -1.6), c(2, 1.6), c(-2, 1.6)];
      for (let i = 0; i < 4; i++) colliders.segs.push([...cs[i], ...cs[(i + 1) % 4], 0.1]);
    } else if (p.type === 'post') {
      put('plaster-white', M.plaster(0xe9e6df), new THREE.BoxGeometry(0.35, 1.2, 0.35).translate(0, 0.6, 0), x, y, g - 0.1, rot);
      put('sign', M.plastic(0xd9d4c4), new THREE.BoxGeometry(0.3, 0.2, 0.02), x, y, g + 1.0, rot + Math.PI / 2);
      colliders.circles.push([x, y, 0.25]);
    } else if (p.type === 'mailbox') {
      put('mailbox', M.plastic(0x3b3f45), rounded(0.36, 0.42, 0.18, 0.03), x, y, g + 1.15, rot + (p.d > 0 ? Math.PI / 2 : -Math.PI / 2));
    } else if (p.type === 'woodpile') {
      const log = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7).rotateX(Math.PI / 2);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 7 - r; k++) {
        const px = (k - (6 - r) / 2) * 0.23;
        put('logs', M.barkPine, log, x + Math.cos(rot) * px, y + Math.sin(rot) * px, g + 0.11 + r * 0.2, rot + Math.PI / 2);
      }
    }
  }
  const group = batch.toGroup();
  group.add(wireGroup);
  group.name = 'props';
  return { group, colliders };
}

function buildCar(batch, M, x, y, g, rot, color) {
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.6 });
  const P = (lx, ly, lz) => { // local: x along car, z across
    const c = Math.cos(rot), s = Math.sin(rot);
    return [x + lx * c - lz * s, ly, y + lx * s + lz * c];
  };
  const put = (key, mat, geo, lx, ly, lz) => {
    const [px, py, pz] = P(lx, ly, lz);
    m4.compose(new THREE.Vector3(px, g + py, -pz), q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    batch.addTransformed(key, mat, geo, m4);
  };
  put('car-paint', paint, rounded(4.1, 0.62, 1.74, 0.16), 0, 0.62, 0);
  const cabin = rounded(2.3, 0.62, 1.52, 0.18);
  // taper cabin top
  const p = cabin.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.86 - 0.08); p.setZ(i, p.getZ(i) * 0.9); }
  cabin.computeVertexNormals();
  put('car-paint', paint, cabin, -0.25, 1.2, 0);
  const glass = rounded(2.12, 0.5, 1.56, 0.12);
  const gp = glass.attributes.position;
  for (let i = 0; i < gp.count; i++) if (gp.getY(i) > 0) { gp.setX(i, gp.getX(i) * 0.84 - 0.08); gp.setZ(i, gp.getZ(i) * 0.9); }
  glass.computeVertexNormals();
  put('glass', M.glass, glass, -0.25, 1.2, 0);
  const tyre = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 16).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.235, 12).rotateX(Math.PI / 2);
  for (const a of [-1.32, 1.32]) for (const b of [-0.78, 0.78]) {
    put('tyre', M.plastic(0x141414), tyre, a, 0.31, b);
    put('metal-grey', M.metalGrey, rim, a, 0.31, b);
  }
  for (const b of [-0.6, 0.6]) {
    put('lights', new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, roughness: 0.2 }), new THREE.BoxGeometry(0.05, 0.12, 0.35), 2.05, 0.75, b);
    put('lights-red', new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.3 }), new THREE.BoxGeometry(0.05, 0.12, 0.3), -2.05, 0.8, b);
  }
  put('tyre', M.plastic(0x141414), new THREE.BoxGeometry(0.1, 0.18, 1.6), 2.07, 0.4, 0);
  put('tyre', M.plastic(0x141414), new THREE.BoxGeometry(0.1, 0.18, 1.6), -2.07, 0.4, 0);
}

function buildCabin(batch, M, x, y, g, rot) {
  const wood = M.woodPlank(0xa8743f);
  const put = (key, mat, geo, lx, ly, lz) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    m4.compose(new THREE.Vector3(x + lx * c - lz * s, g + ly, -(y + lx * s + lz * c)), q.setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
    batch.addTransformed(key, mat, geo, m4);
  };
  const body = new THREE.BoxGeometry(4, 2.4, 3.2);
  const uv = body.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 2.4);
  put('wood:cabin', wood, body, 0, 1.1, 0);
  // pitched roof (gable along x)
  const roof = new GeoBuilder();
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (lx, ly, lz) => [x + lx * c - lz * s, g + ly, -(y + lx * s + lz * c)];
  for (const side of [-1, 1]) roof.quad(P(-2.3, 3.3, 0), P(2.3, 3.3, 0), P(2.3, 2.2, side * 1.95), P(-2.3, 2.2, side * 1.95), [0, 0], [4.6, 0], [4.6, 2.2], [0, 2.2]);
  const rm = M.roof(0x8a6a50); rm.side = THREE.DoubleSide;
  batch.add('roof:cabin', rm, roof.build());
  const gab = new GeoBuilder();
  for (const e of [-2, 2]) gab.tri(P(e, 2.3, -1.6), P(e, 2.3, 1.6), P(e, 3.25, 0), [0, 0], [3.2, 0], [1.6, 1]);
  batch.add('wood:cabin', wood, gab.build());
  put('glass', M.glass, new THREE.BoxGeometry(0.9, 0.8, 0.04), 1.0, 1.4, 1.62);
  put('glass', M.glass, new THREE.BoxGeometry(0.9, 0.8, 0.04), -1.0, 1.4, 1.62);
  put('frame:white', M.frameWhite, new THREE.BoxGeometry(1.0, 0.06, 0.06), 1.0, 1.82, 1.63);
  put('frame:white', M.frameWhite, new THREE.BoxGeometry(1.0, 0.06, 0.06), -1.0, 1.82, 1.63);
  put('door', M.frameBrown, new THREE.BoxGeometry(0.04, 1.95, 0.9), 2.02, 0.98, 0);
}

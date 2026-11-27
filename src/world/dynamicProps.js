// Movable / deformable street props.
//  Bin: rigid body (box, 8 contact corners against the terrain, penalty contacts with friction),
//       impulses from tool hits or from the player walking into it; sleeps when at rest.
//  Car: own (denser) meshes so it can be dented (vertex deformation), scratched (vertex colours
//       toward bare metal), its windows cracked (procedural crack lines in an emissive map), and it
//       rocks on its suspension (damped springs on roll / pitch).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rounded } from './builder.js';
import { W } from './geo.js';

const G = -9.81;

// ---------------------------------------------------------------- bins
const BIN = { m: 14, half: new THREE.Vector3(0.29, 0.54, 0.36), com: 0.5 };

export function createBin(M, x, y, g, rot) {
  const group = new THREE.Group();
  const mat = M.plastic(0x23272a);
  const body = new THREE.Mesh(rounded(0.58, 1.0, 0.72, 0.05), mat); body.position.y = 0.52;
  const lid = new THREE.Mesh(rounded(0.62, 0.06, 0.78, 0.02), mat); lid.position.set(0, 1.05, 0);
  const wheels = new THREE.Mesh(mergeGeometries([-0.24, 0.24].map((x) =>
    new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2).translate(x, 0.1, -0.3))), M.plastic(0x111111));
  for (const m of [body, lid, wheels]) { m.castShadow = true; m.receiveShadow = true; m.userData.owner = null; group.add(m); }
  const bin = {
    kind: 'bin', group,
    p: new THREE.Vector3(x, g + BIN.com, -y),                  // centre of mass (world)
    q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
    v: new THREE.Vector3(), w: new THREE.Vector3(),
    collider: [x, y, 0.42], sleep: true, still: 0,
  };
  group.traverse((o) => { if (o.isMesh) o.userData.owner = bin; });
  syncBin(bin);
  return bin;
}

const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3(), _vp = new THREE.Vector3();
const CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  CORNERS.push(new THREE.Vector3(sx * BIN.half.x, sy === -1 ? -BIN.com + 0.02 : 1.08 - BIN.com, sz * BIN.half.z));
}
const I_LOCAL_INV = (() => {
  const { m } = BIN, a = BIN.half.x * 2, b = 1.08, c = BIN.half.z * 2;
  return new THREE.Vector3(12 / (m * (b * b + c * c)), 12 / (m * (a * a + c * c)), 12 / (m * (a * a + b * b)));
})();

/** world-space inverse inertia applied to a vector */
function iInv(bin, vec) {
  const local = vec.clone().applyQuaternion(bin.q.clone().invert());
  local.multiply(I_LOCAL_INV);
  return local.applyQuaternion(bin.q);
}

export function binImpulse(bin, J, point) {
  bin.v.addScaledVector(J, 1 / BIN.m);
  _r.subVectors(point, bin.p);
  bin.w.add(iInv(bin, _r.clone().cross(J)));
  bin.sleep = false; bin.still = 0;
}

function syncBin(bin) {
  const off = new THREE.Vector3(0, -BIN.com, 0).applyQuaternion(bin.q);
  bin.group.position.copy(bin.p).add(off);
  bin.group.quaternion.copy(bin.q);
  bin.collider[0] = bin.p.x; bin.collider[1] = -bin.p.z;
  // upright bins are wider at the base; lying bins: a smaller circle around the centre
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bin.q).y;
  bin.collider[2] = up > 0.7 ? 0.42 : 0.36;
}

/** step all bins; `col` resolves against static colliders (data coords) */
export function stepBins(bins, dt, col) {
  const steps = 4, h = Math.min(dt, 1 / 30) / steps;
  for (const b of bins) {
    if (b.sleep) continue;
    for (let s = 0; s < steps; s++) {
      b.v.y += G * h;
      let contacts = 0;
      for (const c of CORNERS) {
        _r.copy(c).applyQuaternion(b.q);
        const px = b.p.x + _r.x, py = b.p.y + _r.y, pz = b.p.z + _r.z;
        const pen = W.h(px, pz) - py;
        if (pen <= 0) continue;
        contacts++;
        _vp.copy(b.w).cross(_r).add(b.v);
        const fn = Math.max(0, 6000 * pen - 160 * _vp.y);
        _f.set(0, fn, 0);
        // Coulomb friction (regularised)
        _t.set(_vp.x, 0, _vp.z);
        const vt = _t.length();
        if (vt > 1e-4) _f.addScaledVector(_t, -Math.min(0.6 * fn, vt * 400) / vt);
        b.v.addScaledVector(_f, h / BIN.m);
        b.w.add(iInv(b, _r.clone().cross(_f)).multiplyScalar(h));
      }
      b.w.multiplyScalar(contacts ? 0.985 : 0.999);
      b.p.addScaledVector(b.v, h);
      const dq = new THREE.Quaternion(b.w.x * h * 0.5, b.w.y * h * 0.5, b.w.z * h * 0.5, 0).multiply(b.q);
      b.q.x += dq.x; b.q.y += dq.y; b.q.z += dq.z; b.q.w += dq.w; b.q.normalize();
    }
    // walls, fences, buildings (2D) – keep the bin out and kill the velocity into them
    const [rx, ry] = col.resolve(b.p.x, -b.p.z, 0.3, true);
    if (Math.abs(rx - b.p.x) + Math.abs(-ry - b.p.z) > 1e-4) {
      const nx = rx - b.p.x, nz = -ry - b.p.z, l = Math.hypot(nx, nz);
      const vn = (b.v.x * nx + b.v.z * nz) / l;
      if (vn < 0) { b.v.x -= vn * nx / l * 1.3; b.v.z -= vn * nz / l * 1.3; }
      b.p.x = rx; b.p.z = -ry;
    }
    if (b.v.lengthSq() < 0.002 && b.w.lengthSq() < 0.004) { b.still += dt; if (b.still > 0.6) { b.sleep = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); } } else b.still = 0;
    syncBin(b);
  }
  // bin vs bin (2D circles)
  for (let i = 0; i < bins.length; i++) for (let j = i + 1; j < bins.length; j++) {
    const a = bins[i], c = bins[j];
    const dx = c.p.x - a.p.x, dz = c.p.z - a.p.z, d = Math.hypot(dx, dz), min = 0.68;
    if (d < min && d > 1e-4) {
      const k = (min - d) / 2, nx = dx / d, nz = dz / d;
      a.p.x -= nx * k; a.p.z -= nz * k; c.p.x += nx * k; c.p.z += nz * k;
      const rel = (c.v.x - a.v.x) * nx + (c.v.z - a.v.z) * nz;
      if (rel < 0) {
        const J = new THREE.Vector3(nx, 0, nz).multiplyScalar(-rel * BIN.m * 0.5);
        binImpulse(c, J, c.p.clone()); binImpulse(a, J.negate(), a.p.clone());
      }
      syncBin(a); syncBin(c);
    }
  }
}

// ---------------------------------------------------------------- cars
const BARE = new THREE.Color(0.62, 0.63, 0.65);

function crackCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  return c;
}

export function createCar(M, x, y, g, rot, color) {
  const group = new THREE.Group();
  group.position.set(x, g, -y);
  group.rotation.y = rot;
  const body = new THREE.Group(); // rocks on its suspension
  group.add(body);

  // paint: body + tapered cabin, finely tessellated for dents, vertex colours for scratches
  const lower = rounded(4.1, 0.62, 1.74, 0.16, 36, 6, 16).translate(0, 0.62, 0);
  const cabin = rounded(2.3, 0.62, 1.52, 0.18, 20, 6, 14);
  const cp = cabin.attributes.position;
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) { cp.setX(i, cp.getX(i) * 0.86 - 0.08); cp.setZ(i, cp.getZ(i) * 0.9); }
  cabin.translate(-0.25, 1.2, 0);
  const paintGeo = mergeGeometries([lower, cabin]);
  paintGeo.computeVertexNormals();
  const base = new THREE.Color(color);
  const cols = new Float32Array(paintGeo.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) { cols[i] = base.r; cols[i + 1] = base.g; cols[i + 2] = base.b; }
  paintGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const paint = new THREE.Mesh(paintGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.25, metalness: 0.6 }));

  // glass with planar/cylindrical UVs (unique per side) for the crack map
  const glassGeo = rounded(2.12, 0.5, 1.56, 0.12, 12, 4, 10);
  const gp = glassGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) if (gp.getY(i) > 0) { gp.setX(i, gp.getX(i) * 0.84 - 0.08); gp.setZ(i, gp.getZ(i) * 0.9); }
  glassGeo.translate(-0.25, 1.2, 0);
  glassGeo.computeVertexNormals();
  const uv = glassGeo.attributes.uv;
  for (let i = 0; i < gp.count; i++) {
    const px = gp.getX(i), py = gp.getY(i) - 1.2, pz = gp.getZ(i);
    uv.setXY(i, (px + 1.4) / 2.8, (Math.atan2(pz, py) + Math.PI) / (2 * Math.PI));
  }
  const canvas = crackCanvas();
  const crackTex = new THREE.CanvasTexture(canvas);
  crackTex.colorSpace = THREE.SRGBColorSpace;
  const glassMat = M.glass.clone();
  glassMat.emissive = new THREE.Color(0.75, 0.78, 0.8);
  glassMat.emissiveMap = crackTex;
  glassMat.emissiveIntensity = 0.55;
  const glass = new THREE.Mesh(glassGeo, glassMat);

  const tyres = [], rims = [], lights = [], reds = [];
  for (const a of [-1.32, 1.32]) for (const b of [-0.78, 0.78]) {
    tyres.push(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 16).rotateX(Math.PI / 2).translate(a, 0.31, b));
    rims.push(new THREE.CylinderGeometry(0.2, 0.2, 0.235, 12).rotateX(Math.PI / 2).translate(a, 0.31, b));
  }
  tyres.push(new THREE.BoxGeometry(0.1, 0.18, 1.6).translate(2.07, 0.4, 0), new THREE.BoxGeometry(0.1, 0.18, 1.6).translate(-2.07, 0.4, 0));
  for (const b of [-0.6, 0.6]) {
    lights.push(new THREE.BoxGeometry(0.05, 0.12, 0.35).translate(2.05, 0.75, b));
    reds.push(new THREE.BoxGeometry(0.05, 0.12, 0.3).translate(-2.05, 0.8, b));
  }
  const meshes = [
    paint, glass,
    new THREE.Mesh(mergeGeometries(tyres), M.plastic(0x141414)),
    new THREE.Mesh(mergeGeometries(rims), M.metalGrey),
    new THREE.Mesh(mergeGeometries(lights), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, roughness: 0.2 })),
    new THREE.Mesh(mergeGeometries(reds), new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.3 })),
  ];
  const car = {
    kind: 'car', group, body, paint, glass, canvas, crackTex, baseColor: base,
    roll: 0, rollV: 0, pitch: 0, pitchV: 0, active: false, dents: 0,
  };
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.userData.owner = car; body.add(m); }
  return car;
}

/** dent the paint around a world point; `dirW` = push direction (world) */
export function carDent(car, pointW, dirW, radius, depth) {
  car.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(car.paint.matrixWorld).invert();
  const lp = pointW.clone().applyMatrix4(inv);
  const ld = dirW.clone().transformDirection(inv);
  const pos = car.paint.geometry.attributes.position;
  const v = new THREE.Vector3();
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.distanceTo(lp);
    if (d >= radius) continue;
    const w = (1 - d / radius) ** 2;
    v.addScaledVector(ld, depth * w * (0.85 + Math.random() * 0.3));
    pos.setXYZ(i, v.x, v.y, v.z); moved++;
  }
  if (moved) { pos.needsUpdate = true; car.paint.geometry.computeVertexNormals(); car.dents++; }
  return moved;
}

/** scratch: blend paint vertex colours toward bare metal around a world point */
export function carScratch(car, pointW, radius, amount) {
  car.group.updateMatrixWorld(true);
  const lp = pointW.clone().applyMatrix4(new THREE.Matrix4().copy(car.paint.matrixWorld).invert());
  const pos = car.paint.geometry.attributes.position, col = car.paint.geometry.attributes.color;
  const v = new THREE.Vector3(), c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.distanceTo(lp);
    if (d >= radius) continue;
    c.fromBufferAttribute(col, i).lerp(BARE, amount * (1 - d / radius));
    col.setXYZ(i, c.r, c.g, c.b); n++;
  }
  if (n) col.needsUpdate = true;
  return n;
}

/** crack the window at the glass point nearest to a world point; returns false if too far */
export function carCrack(car, pointW, strength = 1) {
  car.group.updateMatrixWorld(true);
  const lp = pointW.clone().applyMatrix4(new THREE.Matrix4().copy(car.glass.matrixWorld).invert());
  const pos = car.glass.geometry.attributes.position, uv = car.glass.geometry.attributes.uv;
  let best = -1, bd = 1e9;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { const d = v.fromBufferAttribute(pos, i).distanceTo(lp); if (d < bd) { bd = d; best = i; } }
  if (best < 0 || bd > 0.35) return false;
  const cx = uv.getX(best) * 512, cy = (1 - uv.getY(best)) * 512;
  const g = car.canvas.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2;
  const spokes = 9 + Math.floor(Math.random() * 6), len = 40 + 60 * strength;
  const ends = [];
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2 + Math.random() * 0.4;
    let x = cx, y = cy;
    g.beginPath(); g.moveTo(x, y);
    const L = len * (0.5 + Math.random() * 0.8);
    for (let s = 1; s <= 5; s++) { x = cx + Math.cos(a + (Math.random() - 0.5) * 0.25) * L * s / 5; y = cy + Math.sin(a + (Math.random() - 0.5) * 0.25) * L * s / 5; g.lineTo(x, y); }
    g.stroke();
    ends.push(a);
  }
  for (const r of [len * 0.25, len * 0.5]) { // concentric rings
    g.beginPath();
    ends.forEach((a, k) => { const x = cx + Math.cos(a) * r * (0.8 + Math.random() * 0.4), y = cy + Math.sin(a) * r * (0.8 + Math.random() * 0.4); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(cx, cy, 3 + 3 * strength, 0, Math.PI * 2); g.fill();
  car.crackTex.needsUpdate = true;
  return true;
}

/** push the car on its suspension: impulse direction (world) */
export function carRock(car, dirW, strength) {
  const inv = new THREE.Matrix4().copy(car.group.matrixWorld).invert();
  const ld = dirW.clone().transformDirection(inv);
  car.rollV += ld.z * strength * 0.5;
  car.pitchV -= ld.x * strength * 0.25;
  car.active = true;
}

export function stepCars(cars, dt) {
  for (const c of cars) {
    if (!c.active) continue;
    const k = 140, d = 5.5;
    c.rollV += (-k * c.roll - d * c.rollV) * dt; c.roll += c.rollV * dt;
    c.pitchV += (-k * c.pitch - d * c.pitchV) * dt; c.pitch += c.pitchV * dt;
    c.body.rotation.set(c.roll, 0, c.pitch);
    if (Math.abs(c.roll) + Math.abs(c.pitch) + Math.abs(c.rollV) + Math.abs(c.pitchV) < 1e-4) { c.active = false; c.body.rotation.set(0, 0, 0); }
  }
}

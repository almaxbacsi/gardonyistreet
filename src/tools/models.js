// Procedural tool models (metres). Conventions:
//  - long two-handed tools: origin at the rear (right-hand) grip, +Y along the shaft toward the head
//  - handheld power tools: origin at the main grip, +Z forward (bit / disc side), +Y up, +X = user's left
//  - mower: origin on the ground at the deck centre, +Z = pushing direction, handlebar toward -Z
// Each builder returns { group, parts } where parts holds animated sub-objects (disc, bit, blade...).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const mats = {};
function mat(key) {
  if (mats[key]) return mats[key];
  const P = {
    steel: { color: 0x8d9296, metalness: 0.9, roughness: 0.38 },
    darksteel: { color: 0x3a3d40, metalness: 0.85, roughness: 0.45 },
    wood: { color: 0x9a6b3f, metalness: 0, roughness: 0.75 },
    fiberglass: { color: 0xd9b21c, metalness: 0, roughness: 0.5 },
    rubber: { color: 0x1d1e1f, metalness: 0, roughness: 0.9 },
    teal: { color: 0x177f7a, metalness: 0.1, roughness: 0.45 },     // generic cordless-tool colour
    orange: { color: 0xd8651c, metalness: 0.1, roughness: 0.45 },
    red: { color: 0xb3261e, metalness: 0.2, roughness: 0.4 },
    disc: { color: 0x55585b, metalness: 0.6, roughness: 0.55 },
    black: { color: 0x26272a, metalness: 0.2, roughness: 0.6 },
  }[key];
  mats[key] = new THREE.MeshStandardMaterial(P);
  return mats[key];
}

/** merge pieces sharing a material into one mesh per material (few draw calls) */
class Kit {
  constructor() { this.byMat = {}; }
  add(key, geo, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
    (this.byMat[key] ??= []).push(g.index ? g.toNonIndexed() : g);
    return this;
  }
  build(group = new THREE.Group()) {
    for (const [k, list] of Object.entries(this.byMat)) {
      const m = new THREE.Mesh(mergeGeometries(list), mat(k));
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    return group;
  }
}
const cyl = (r, h, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const HALF = Math.PI / 2;

export function shovel() {
  const k = new Kit()
    .add('wood', cyl(0.017, 1.05), [0, 0.5, 0])
    .add('black', box(0.13, 0.03, 0.03), [0, -0.03, 0])                 // T grip
    .add('steel', cyl(0.022, 0.12), [0, 1.04, 0])                       // socket
    .add('steel', box(0.19, 0.27, 0.005), [0, 1.22, 0.006], [0.12, 0, 0]) // blade
    .add('steel', box(0.19, 0.012, 0.03), [0, 1.09, 0.005]);            // tread
  return { group: k.build(), parts: {}, head: new THREE.Vector3(0, 1.34, 0), leftGrip: new THREE.Vector3(0, 0.55, 0) };
}

export function rake() {
  const k = new Kit()
    .add('wood', cyl(0.015, 1.5), [0, 0.75, 0])
    .add('darksteel', box(0.42, 0.02, 0.02), [0, 1.5, 0]);
  for (let i = 0; i < 14; i++) k.add('darksteel', cyl(0.004, 0.08, 5), [-0.2 + i * 0.4 / 13, 1.5, -0.04], [HALF, 0, 0]);
  return { group: k.build(), parts: {}, head: new THREE.Vector3(0, 1.5, -0.07), leftGrip: new THREE.Vector3(0, 0.6, 0) };
}

export function sledgehammer() {
  const k = new Kit()
    .add('fiberglass', cyl(0.02, 0.86), [0, 0.43, 0])
    .add('rubber', cyl(0.024, 0.2), [0, 0.06, 0])
    .add('darksteel', box(0.09, 0.09, 0.22), [0, 0.88, 0]);
  return { group: k.build(), parts: {}, head: new THREE.Vector3(0, 0.88, 0.1), leftGrip: new THREE.Vector3(0, 0.14, 0) };
}

export function hedgeTrimmer() {
  const k = new Kit()
    .add('orange', box(0.08, 0.3, 0.11), [0, 0.12, 0])
    .add('black', box(0.03, 0.12, 0.03), [0, -0.02, -0.04])             // rear handle
    .add('black', new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI), [0, 0.3, 0.02], [0, HALF, 0]); // bale
  const blade = new Kit().add('steel', box(0.06, 0.56, 0.008), [0, 0, 0]);
  for (let i = 0; i < 14; i++) blade.add('steel', box(0.1, 0.012, 0.006), [0, -0.26 + i * 0.04, 0]);
  const g = k.build();
  const bladeG = blade.build(); bladeG.position.set(0, 0.56, 0.0);
  g.add(bladeG);
  return { group: g, parts: { blade: bladeG }, head: new THREE.Vector3(0, 0.6, 0), leftGrip: new THREE.Vector3(0, 0.31, 0.06) };
}

export function angleGrinder() {
  const k = new Kit()
    .add('teal', cyl(0.036, 0.3, 12), [0, 0, 0.02], [HALF, 0, 0])
    .add('black', cyl(0.037, 0.08, 12), [0, 0, -0.12], [HALF, 0, 0])
    .add('darksteel', box(0.07, 0.07, 0.07), [0, 0.005, 0.2])
    .add('black', cyl(0.014, 0.12), [0.08, 0.01, 0.2], [0, 0, HALF])     // side handle (+X = left)
    .add('darksteel', new THREE.CylinderGeometry(0.068, 0.068, 0.025, 16, 1, true, 0, Math.PI), [0, -0.045, 0.2], [0, HALF, 0]); // guard
  const disc = new THREE.Mesh(cyl(0.0625, 0.003, 20), mat('disc'));
  disc.position.set(0, -0.05, 0.2);
  disc.castShadow = true;
  const g = k.build(); g.add(disc);
  return { group: g, parts: { disc }, head: new THREE.Vector3(0, -0.05, 0.26), leftGrip: new THREE.Vector3(0.14, 0.01, 0.2) };
}

export function impactDrill() {
  const k = new Kit()
    .add('teal', box(0.06, 0.09, 0.22), [0, 0.1, 0.03])
    .add('black', box(0.045, 0.14, 0.055), [0, 0, 0], [-0.25, 0, 0])   // grip
    .add('black', box(0.08, 0.07, 0.12), [0, -0.09, 0.02])             // battery
    .add('darksteel', cyl(0.022, 0.06, 12), [0, 0.1, 0.17], [HALF, 0, 0]) // chuck
    .add('black', cyl(0.013, 0.14), [0.09, 0.08, 0.1], [0, 0, HALF]);  // aux handle
  const bit = new THREE.Mesh(cyl(0.004, 0.14, 6), mat('steel'));
  bit.rotation.x = HALF; bit.position.set(0, 0.1, 0.27);
  const g = k.build(); g.add(bit);
  return { group: g, parts: { bit }, head: new THREE.Vector3(0, 0.1, 0.34), leftGrip: new THREE.Vector3(0.16, 0.08, 0.1) };
}

export function lawnMower() {
  const k = new Kit()
    .add('red', box(0.5, 0.1, 0.56), [0, 0.15, 0])
    .add('red', box(0.46, 0.06, 0.5), [0, 0.22, 0])
    .add('black', cyl(0.11, 0.16, 14), [0, 0.32, 0.02])                // engine
    .add('darksteel', cyl(0.05, 0.05, 10), [0, 0.42, 0.02])
    .add('black', box(0.3, 0.22, 0.2), [0, 0.3, -0.36]);               // grass bag
  for (const [x, z] of [[-0.24, 0.22], [0.24, 0.22], [-0.24, -0.22], [0.24, -0.22]]) k.add('rubber', cyl(0.085, 0.045, 12), [x, 0.085, z], [0, 0, HALF]);
  // handlebar: two tubes from the rear of the deck up toward the user, plus a cross bar
  const a = new THREE.Vector3(0, 0.2, -0.27), b = new THREE.Vector3(0, 0.95, -0.85);
  const len = a.distanceTo(b), ang = Math.atan2(b.z - a.z, b.y - a.y);
  for (const x of [-0.2, 0.2]) k.add('darksteel', cyl(0.012, len, 6), [x, (a.y + b.y) / 2, (a.z + b.z) / 2], [ang, 0, 0]);
  k.add('black', cyl(0.016, 0.46, 8), [0, 0.95, -0.85], [0, 0, HALF]);
  const blade = new THREE.Mesh(box(0.42, 0.005, 0.05), mat('steel'));
  blade.position.set(0, 0.1, 0);
  const g = k.build(); g.add(blade);
  return {
    group: g, parts: { blade }, head: new THREE.Vector3(0, 0.05, 0),
    rightGrip: new THREE.Vector3(-0.17, 0.95, -0.85), leftGrip: new THREE.Vector3(0.17, 0.95, -0.85),
  };
}

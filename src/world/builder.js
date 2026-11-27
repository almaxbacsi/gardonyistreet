import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

/** Non-indexed geometry builder with automatic winding fix towards a desired normal. */
export class GeoBuilder {
  constructor() { this.pos = []; this.uv = []; }
  tri(p0, p1, p2, u0, u1, u2, want) {
    if (want) {
      _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
      _n.crossVectors(_a, _b);
      if (_n.x * want[0] + _n.y * want[1] + _n.z * want[2] < 0) { [p1, p2] = [p2, p1]; [u1, u2] = [u2, u1]; }
    }
    this.pos.push(...p0, ...p1, ...p2);
    this.uv.push(...u0, ...u1, ...u2);
  }
  quad(p0, p1, p2, p3, u0, u1, u2, u3, want) {
    this.tri(p0, p1, p2, u0, u1, u2, want);
    this.tri(p0, p2, p3, u0, u2, u3, want);
  }
  get empty() { return this.pos.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/** Collects geometries per material key, merges at the end. */
export class Batcher {
  constructor() { this.parts = new Map(); }
  add(key, material, geometry) {
    if (!this.parts.has(key)) this.parts.set(key, { material, geos: [] });
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    // ensure same attribute set
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.parts.get(key).geos.push(g);
  }
  /** Adds a transformed copy of a template geometry */
  addTransformed(key, material, geometry, matrix) {
    const g = geometry.clone();
    g.applyMatrix4(matrix);
    this.add(key, material, g);
  }
  toGroup({ castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [key, { material, geos }] of this.parts) {
      const merged = mergeGeometries(geos, false);
      const m = new THREE.Mesh(merged, material);
      m.name = key;
      m.castShadow = castShadow; m.receiveShadow = receiveShadow;
      group.add(m);
    }
    return group;
  }
}

export function boxGeo(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

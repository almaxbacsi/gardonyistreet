import * as THREE from 'three';
import { heightAt, project, OSM, wayPoints, fbm, pointInPolygon } from './geo.js';

function roadSegments() {
  const segs = [];
  for (const w of OSM.w) {
    if (w.k !== 'h') continue;
    const hw = w.v === 'path' ? 0.6 : w.v === 'track' ? 1.5 : w.v === 'service' ? 1.6 : 2.0;
    const p = wayPoints(w);
    for (let i = 0; i < p.length - 1; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], hw]);
  }
  return segs;
}

function distSeg(x, y, s) {
  const [ax, ay, bx, by] = s;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  let t = ((x - ax) * dx + (y - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function splatMaterial(M) {
  const G = M.tex.grass, D = M.tex.dirt;
  const mat = new THREE.MeshStandardMaterial({
    map: G.map,
    normalMap: G.normalMap,
    roughness: 0.95,
    metalness: 0,
  });
  mat.normalScale.set(0.8, 0.8);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grassMap = { value: G.map };
    shader.uniforms.grassNormal = { value: G.normalMap };
    shader.uniforms.dirtMap = { value: D.map };
    shader.uniforms.dirtNormal = { value: D.normalMap || G.normalMap };
    shader.uniforms.gRep = { value: G.map.repeat };
    shader.uniforms.dRep = { value: D.map.repeat };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 splat;\nvarying vec2 vSplat;\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap; uniform sampler2D grassNormal; uniform sampler2D dirtMap; uniform sampler2D dirtNormal; uniform vec2 gRep; uniform vec2 dRep;\nvarying vec2 vSplat;\nvarying vec2 vWXZ;')
      .replace('#include <map_fragment>', `
        vec2 gUv = vWXZ / 4.0 * gRep;
        vec2 gUv2 = vec2(-vWXZ.y, vWXZ.x) / 7.3 * gRep; // second, rotated sample breaks tiling
        vec2 dUv = vWXZ / 3.0 * dRep;
        vec4 gcol = mix(texture2D(grassMap, gUv), texture2D(grassMap, gUv2), 0.4);
        vec4 gmac = texture2D(grassMap, vWXZ / 65.0);
        gcol.rgb *= mix(vec3(0.8), vec3(1.15), smoothstep(0.1, 0.5, dot(gmac.rgb, vec3(0.33))));
        vec4 dcol = texture2D(dirtMap, dUv);
        vec3 litter = mix(dcol.rgb * vec3(0.72, 0.62, 0.48), gcol.rgb * 0.7, 0.35);
        gcol.rgb = mix(gcol.rgb, litter, vSplat.y);
        float dn = texture2D(dirtMap, vWXZ / 11.0).g;
        float splatW = smoothstep(0.0, 1.0, clamp(vSplat.x + (dn - 0.5) * 0.6, 0.0, 1.0));
        diffuseColor *= mix(gcol, dcol, splatW);
      `)
      .replace('texture2D( normalMap, vNormalMapUv )', 'mix(texture2D(grassNormal, gUv), texture2D(dirtNormal, dUv), splatW)');
  };
  return mat;
}

/** Builds near (detailed) and far (low-res + hills) terrain. */
export function buildTerrain(M, { center = [0, 10], size = 380, res = 1.5, forestPolys = [] }) {
  const segs = roadSegments();
  const mat = splatMaterial(M);

  const n = Math.round(size / res);
  const geo = new THREE.PlaneGeometry(size, size, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const splat = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i) + center[0];
    const Z = pos.getZ(i) - center[1];
    const x = X, y = -Z;
    pos.setXYZ(i, X, heightAt(x, y), Z);
    uv.setXY(i, X / 4, Z / 4);
    // dirt along roads
    let dirt = 0;
    const p = project(x, y);
    const ad = Math.abs(p.d);
    if (p.s > -15 && p.s < 260) dirt = Math.max(dirt, 1 - sstep(1.7, 3.0 + fbm(x * 0.5, y * 0.5) * 1.2, ad));
    for (const s of segs) {
      const dd = distSeg(x, y, s);
      dirt = Math.max(dirt, 1 - sstep(s[4] - 0.3, s[4] + 1.0, dd));
    }
    // patches
    dirt = Math.max(dirt, sstep(0.66, 0.8, fbm(x * 0.05 + 3, y * 0.05)) * 0.9);
    let litter = sstep(0.45, 0.7, fbm(x * 0.03, y * 0.03 + 9)) * 0.5;
    if (p.d < -3 && p.s > -5 && p.s < 62) litter = Math.max(litter, 0.75);
    for (const fp of forestPolys) if (pointInPolygon(x, y, fp)) litter = 0.9;
    splat[i * 2] = dirt;
    splat[i * 2 + 1] = litter;
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 2));
  geo.computeVertexNormals();
  const near = new THREE.Mesh(geo, mat);
  near.receiveShadow = true;
  near.name = 'terrain-near';

  // far terrain with distant hills (Pilis / Zsíros-hegy direction)
  const FS = 5000, FN = 160;
  const fgeo = new THREE.PlaneGeometry(FS, FS, FN, FN);
  fgeo.rotateX(-Math.PI / 2);
  const fp = fgeo.attributes.position, fuv = fgeo.attributes.uv;
  const fspl = new Float32Array(fp.count * 2);
  const fcol = new Float32Array(fp.count * 3);
  const half = size / 2;
  for (let i = 0; i < fp.count; i++) {
    const X = fp.getX(i) + center[0], Z = fp.getZ(i) - center[1];
    const x = X, y = -Z;
    const r = Math.hypot(x, y);
    let h = heightAt(x, y);
    const ring = sstep(350, 1600, r);
    const ang = Math.atan2(y, x);
    const ridge = (fbm(x * 0.0016 + 10, y * 0.0016) * 0.8 + 0.2) * 260 * ring * (0.65 + 0.35 * Math.sin(ang * 2 + 1));
    h += ridge;
    const inside = Math.abs(X - center[0]) < half - 2 && Math.abs(Z + center[1]) < half - 2;
    if (inside) h -= 4;
    fp.setY(i, h);
    fuv.setXY(i, X / 4, Z / 4);
    fspl[i * 2] = 0; fspl[i * 2 + 1] = 0.6;
    // forest (dark) vs meadows/fields (light) on the distant hills
    const field = sstep(0.55, 0.62, fbm(x * 0.004 + 40, y * 0.004));
    const v = 0.75 + fbm(x * 0.03, y * 0.03) * 0.5;
    const fr = 0.045 * v, fg = 0.075 * v, fb = 0.03 * v;
    fcol[i * 3] = fr + (0.2 - fr) * field;
    fcol[i * 3 + 1] = fg + (0.22 - fg) * field;
    fcol[i * 3 + 2] = fb + (0.08 - fb) * field;
  }
  fgeo.setAttribute('splat', new THREE.BufferAttribute(fspl, 2));
  fgeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  fgeo.computeVertexNormals();
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const far = new THREE.Mesh(fgeo, farMat);
  far.receiveShadow = false;
  far.name = 'terrain-far';
  return { near, far, material: mat };
}

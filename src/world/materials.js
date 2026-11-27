import * as THREE from 'three';
import * as T from './textures.js';

/** Creates all shared textures + materials once. Photo textures (if loaded) replace procedural ones. */
export function createMaterials(quality, photos = {}) {
  const tex = {
    grass: T.grassTexture(),
    dirt: T.dirtTexture(),
    concrete: T.concreteSlabTexture(),
    plaster: T.plasterTexture(),
    brick: T.brickTexture(),
    roof: T.roofTileTexture(),
    metalRoof: T.metalRoofTexture(),
    wood: T.woodTexture(71, 8),
    woodPlank: T.woodTexture(72, 7),
    bark: T.barkTexture(81),
    barkLight: T.barkTexture(82),
    block: T.blockWallTexture(),
    stone: T.stoneTexture(),
  };
  // metres covered by one uv unit in our geometry, per slot
  const UV_METERS = { grass: 4, dirt: 3, plaster: 3, roof: 1, woodPlank: 1, wood: 1, bark: 1.6, block: 1.5, stone: 0.45 };
  const photoUsed = {};
  const usePhoto = (slot, key = slot, tinted = false) => {
    const p = photos[slot];
    if (!p) return;
    const map = tinted ? T.desaturate(p.map) : p.map;
    const rep = UV_METERS[key] / p.meters;
    const set = { map, normalMap: p.normalMap, roughnessMap: p.roughnessMap, photo: true };
    for (const t of [set.map, set.normalMap, set.roughnessMap]) {
      if (!t) continue;
      t.repeat.set(rep, rep);
      if (p.rotate) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
      t.needsUpdate = true;
    }
    tex[key] = set;
    photoUsed[key] = p.source;
  };
  usePhoto('grass');
  usePhoto('dirt');
  usePhoto('plaster', 'plaster', true);
  usePhoto('roof', 'roof', true);
  usePhoto('planks', 'woodPlank', true);
  usePhoto('planks', 'wood', true);
  usePhoto('bark');
  usePhoto('bark', 'barkLight');
  usePhoto('block');
  usePhoto('stone');
  if (photos.concrete) { tex.concrete = T.concreteSlabFromPhoto(photos.concrete); photoUsed.concrete = photos.concrete.source; }
  const leaf = {
    broad: T.leafCardTexture('broad', 3),
    locust: T.leafCardTexture('locust', 4),
    bush: T.leafCardTexture('bush', 6),
    oak: T.leafCardTexture('oak', 7),
    pine: T.needleCardTexture('pine', 8),
    spruce: T.needleCardTexture('spruce', 9),
  };

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const withTex = (t, o = {}) => {
    const m = std({ map: t.map, normalMap: t.normalMap, ...o });
    if (t.roughnessMap) { m.roughnessMap = t.roughnessMap; m.roughness = 1; }
    return m;
  };
  const ph = (key, photoColor, procColor) => (tex[key].photo ? photoColor : procColor);

  const leafMat = (t, color = 0xffffff) => new THREE.MeshStandardMaterial({
    map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, metalness: 0, color,
  });

  const M = {
    tex, leaf, photoUsed,
    concreteRoad: withTex(tex.concrete, { roughness: 0.92, color: ph('concrete', 0xffffff, 0xd8d6d0), normalScale: new THREE.Vector2(0.6, 0.6) }),
    dirtRoad: withTex(tex.dirt, { roughness: 1, color: ph('dirt', 0xffffff, 0xf2ead8) }),
    gravelRoad: withTex(tex.dirt, { roughness: 1, color: ph('dirt', 0xe8e4dc, 0xdedad2) }),
    plaster: (color) => withTex(tex.plaster, { color, roughness: 0.95 }),
    brick: withTex(tex.brick, { roughness: 0.9 }),
    roof: (color) => withTex(tex.roof, { color, roughness: 0.75 }),
    metalRoof: (color) => withTex(tex.metalRoof, { color, roughness: 0.45, metalness: 0.5 }),
    wood: (color = 0xb08a64) => withTex(tex.wood, { color, roughness: 0.85 }),
    woodPlank: (color = 0x5b3f2c) => withTex(tex.woodPlank, { color, roughness: 0.9 }),
    bark: withTex(tex.bark, { color: ph('bark', 0xffffff, 0x8a7a68), roughness: 1 }),
    barkLight: withTex(tex.barkLight, { color: ph('barkLight', 0xcfcac0, 0x938c80), roughness: 1 }),
    barkPine: withTex(tex.bark, { color: ph('bark', 0xe8a878, 0xb07a52), roughness: 1 }),
    block: withTex(tex.block, { color: ph('block', 0xffffff, 0xd8d3c7), roughness: 0.95 }),
    stone: withTex(tex.stone, { roughness: 0.95 }),
    concrete: withTex(tex.plaster, { color: 0x969389, roughness: 0.95 }),
    glass: std({ color: 0x1b2228, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.2 }),
    frameWhite: std({ color: 0xeeeeea, roughness: 0.6 }),
    frameBrown: std({ color: 0x5a3c28, roughness: 0.7 }),
    metalGreen: std({ color: 0x2f5a3a, roughness: 0.55, metalness: 0.4 }),
    metalBlack: std({ color: 0x1c1d1e, roughness: 0.5, metalness: 0.6 }),
    metalGrey: std({ color: 0x8f938c, roughness: 0.5, metalness: 0.7 }),
    plastic: (color) => std({ color, roughness: 0.6 }),
    wire: new THREE.MeshBasicMaterial({ color: 0x202020 }),
    panelFence: new THREE.MeshStandardMaterial({ map: T.weldedMeshTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }),
    chainFence: new THREE.MeshStandardMaterial({ map: T.chainLinkTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }),
    weeds: new THREE.MeshStandardMaterial({ map: T.weedCardTexture(9), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
    leaves: {
      broad: leafMat(leaf.broad),
      locust: leafMat(leaf.locust),
      bush: leafMat(leaf.bush),
      oak: leafMat(leaf.oak),
      pine: leafMat(leaf.pine),
      spruce: leafMat(leaf.spruce),
    },
  };
  M.panelFence.map.wrapS = M.panelFence.map.wrapT = THREE.RepeatWrapping;
  M.chainFence.map.wrapS = M.chainFence.map.wrapT = THREE.RepeatWrapping;
  return M;
}

/** Adds gentle wind sway to an alpha-tested foliage material (vertex shader, instanced). */
export function addWind(material, uniforms, strength = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replaceAll('normal *= faceDirection;', '').replaceAll('normal = normal * faceDirection;', ''));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          float ph = wp.x * 0.11 + wp.z * 0.07;
          float h = max(transformed.y, 0.0);
          float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * ${(0.012 * strength).toFixed(4)} * h;
          float flutter = sin(uTime * 6.0 + position.x * 9.0 + position.z * 7.0) * ${(0.025 * strength).toFixed(4)};
          transformed.x += sway + flutter * 0.5;
          transformed.z += sway * 0.6 + flutter * 0.4;
        }`);
  };
  material.customProgramCacheKey = () => 'wind' + strength;
}

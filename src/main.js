import * as THREE from 'three';
import { PostPipeline } from './render/post.js';
import { installSoftShadows } from './render/softShadows.js';
import { SunShafts } from './render/shafts.js';
import { Bloom, EyeAdaptation } from './render/bloom.js';
import { PRESETS, ORDER, resolveQuality, saveQuality, needsReload } from './render/quality.js';
import { loadPhotoTextures } from './world/photoTextures.js';
import { ToolSystem } from './tools/toolSystem.js';
import { ParticleSystem } from './fx/particles.js';
import { DynamicSky } from './world/sky.js';
import { createMaterials } from './world/materials.js';
import { setAnisotropy } from './world/textures.js';
import { buildTerrain } from './world/terrain.js';
import { buildRoads } from './world/roads.js';
import { buildBuildings } from './world/buildings.js';
import { buildFences } from './world/fences.js';
import { buildVegetation } from './world/vegetation.js';
import { buildProps } from './world/props.js';
import { OSM, wayPoints } from './world/geo.js';
import { Character } from './player/character.js';
import { PlayerController } from './player/controller.js';
import { CollisionWorld } from './player/collision.js';
import { Hud } from './ui/hud.js';
import { DevMode } from './dev/devmode.js';

const params = new URLSearchParams(location.search);
const QUALITY = resolveQuality(); // { name, source }
let Q = PRESETS[QUALITY.name];
console.info('Grafika:', QUALITY.name, `(${QUALITY.source}${QUALITY.gpu ? ', ' + QUALITY.gpu : ''})`);

const progress = document.getElementById('progress');
const startEl = document.getElementById('start');
const overlay = document.getElementById('overlay');
const step = async (msg) => { progress.textContent = msg; await new Promise((r) => setTimeout(r, 0)); };

async function init() {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatioMax));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  // BasicShadowMap gives us the raw depth texture; softShadows.js replaces the lookup with PCSS
  renderer.shadowMap.type = THREE.BasicShadowMap;
  installSoftShadows({ width: 90, height: 90, depth: 219 },
    { search: Q.shadowSearch, taps: Q.shadowTaps, maxPenumbra: Q.maxPenumbra });
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
  const uniforms = { uTime: { value: 0 } };

  // ---- sky, sun, environment
  await step('Égbolt és fények…');
  // late-afternoon sun from the south-west (Street View imagery has warm side light)
  const elev = THREE.MathUtils.degToRad(34), azim = THREE.MathUtils.degToRad(215);
  const sunDir = new THREE.Vector3(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev));
  // procedural sky with drifting clouds; it also feeds image-based lighting (scene.environment)
  const sky = new DynamicSky(renderer, sunDir, { cloudOctaves: Q.cloudOctaves, envSize: Q.envSize, envInterval: Q.envInterval });
  scene.add(sky.mesh);
  sky.updateEnvironment(scene);
  scene.environmentIntensity = 0.8;

  scene.fog = new THREE.FogExp2(0xc4c3b4, 0.0016); // warm summer haze

  const sun = new THREE.DirectionalLight(0xffe6c4, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hc = sky.hemiColors();
  const hemi = new THREE.HemisphereLight(hc.sky, hc.ground, 0.25);
  scene.add(hemi);

  // ---- world
  await step('Fotótextúrák betöltése…');
  const photos = await loadPhotoTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  await step('Textúrák…');
  const M = createMaterials(QUALITY.name, photos);
  console.info('Fotótextúrák:', Object.keys(photos).length ? M.photoUsed : 'nincs (procedurális textúrák)');
  await step('Domborzat (OSM + Street View magasságok)…');
  const forest = OSM.w.filter((w) => w.k === 'l' && w.v === 'forest').map(wayPoints);
  const terrain = buildTerrain(M, { center: [0, 10], size: 380, res: Q.terrainRes, forestPolys: forest });
  scene.add(terrain.near, terrain.far);
  await step('Utak…');
  scene.add(buildRoads(M));
  await step('Házak…');
  const bld = buildBuildings(M);
  scene.add(bld.group);
  await step('Kerítések…');
  const fences = buildFences(M);
  scene.add(fences.group);
  await step('Növényzet…');
  const veg = buildVegetation(M, { vegScale: Q.vegScale, uniforms });
  scene.add(veg.group);
  await step('Tárgyak…');
  const props = buildProps(M);
  scene.add(props.group);

  // ---- collision
  const col = new CollisionWorld();
  col.addSegs(bld.colliders, 0.05);
  col.addSegs(fences.colliders, 0.12);
  col.addSegs(props.colliders.segs);
  col.addCircles(veg.colliders);
  col.addCircles(props.colliders.circles);
  col.build();

  // ---- player
  await step('Karakter…');
  const character = new Character();
  await character.load();
  scene.add(character.root);
  const occluders = [...bld.group.children, ...props.group.children.filter((m) => m.isMesh), terrain.near];
  const player = new PlayerController({ camera, dom: canvas, character, collision: col, occluders });
  player.spawn(6, -0.4);

  const hud = new Hud();
  // ---- tools + particles
  const particles = { sparks: new ParticleSystem({ max: 500, additive: true }), dust: new ParticleSystem({ max: 400 }) };
  scene.add(particles.sparks.points, particles.dust.points);
  const tools = new ToolSystem({ scene, character, player, hud, particles, raycastTargets: occluders });
  player.onModeChange = (m) => {
    hud.showToast(m === 'fps' ? 'Belső nézet (V)' : 'Külső nézet (V)');
    document.getElementById('cross').classList.toggle('fps', m === 'fps');
  };
  const dev = new DevMode({ scene, camera, player, hud });

  // ---- start / pause
  startEl.textContent = 'Kattints a kezdéshez';
  progress.textContent = '';
  overlay.addEventListener('click', () => canvas.requestPointerLock());
  canvas.addEventListener('click', () => { if (!player.locked) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    overlay.classList.toggle('hidden', locked);
    if (!locked) startEl.textContent = 'Szünet – kattints a folytatáshoz';
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---- post-processing: SSAO + tone mapping + warm grade (src/render/post.js)
  const post = new PostPipeline(renderer, scene, camera, { msaa: Q.msaa, ao: Q.ao, aoTaps: Q.aoTaps, renderScale: Q.renderScale });
  const shafts = new SunShafts(sunDir, { taps: Q.shaftTaps });
  shafts.enabled = Q.shafts;
  post.extra = (pp) => shafts.render(pp);
  post.bloom = new Bloom({ levels: Q.bloomLevels });
  post.bloom.enabled = Q.bloom;
  post.adapt = new EyeAdaptation();
  post.adapt.enabled = Q.adapt;

  // ---- quality presets: live switching from the pause menu (src/render/quality.js)
  let current = QUALITY.name;
  const applyLive = (name) => {
    const prev = current;
    Q = PRESETS[name]; current = name;
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatioMax));
    renderer.setSize(innerWidth, innerHeight);
    post.configure({ msaa: Q.msaa, aoTaps: Q.aoTaps, renderScale: Q.renderScale, ao: Q.ao });
    shafts.enabled = Q.shafts; shafts.setTaps(Q.shaftTaps);
    if (post.bloom.levels !== Q.bloomLevels) post.bloom = new Bloom({ levels: Q.bloomLevels });
    post.bloom.enabled = Q.bloom;
    post.adapt.enabled = Q.adapt;
    if (sun.shadow.mapSize.x !== Q.shadowSize) {
      sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    sky.setQuality(Q);
    return needsReload(prev, name);
  };
  const gfx = document.getElementById('gfx');
  const renderGfx = (note = '') => {
    gfx.innerHTML = '<span>Grafika:</span>' + ORDER.map((k) =>
      `<button data-q="${k}" class="${k === current ? 'on' : ''}">${PRESETS[k].label}</button>`).join('')
      + '<button data-q="auto">Auto</button>' + (note ? `<div class="note">${note}</div>` : '');
  };
  renderGfx(QUALITY.source === 'auto' ? 'automatikusan választva' : '');
  gfx.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.reload) { const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.href; return; }
    let name = b.dataset.q;
    if (name === 'auto') { saveQuality(null); name = resolveQuality().name; } else saveQuality(name);
    const reload = applyLive(name);
    renderGfx(reload ? 'Növényzet és árnyék-szűrés: újratöltés után <button data-reload="1">Újratöltés</button>' : '');
    hud.showToast('Grafika: ' + PRESETS[name].label);
  });
  addEventListener('resize', () => post.setSize(innerWidth, innerHeight));
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') { post.grade = !post.grade; hud.showToast(post.grade ? 'Színkorrekció: be' : 'Színkorrekció: ki'); }
    if (e.code === 'KeyL') { shafts.enabled = !shafts.enabled; hud.showToast(shafts.enabled ? 'Fénysugarak: be' : 'Fénysugarak: ki'); }
    if (e.code === 'KeyB') { post.bloom.enabled = !post.bloom.enabled; hud.showToast(post.bloom.enabled ? 'Bloom: be' : 'Bloom: ki'); }
    if (e.code === 'KeyO') { post.s.ao = post.s.ao === false; hud.showToast(post.s.ao ? 'Árnyékolás (AO): be' : 'Árnyékolás (AO): ki'); }
  });

  // warm up shaders
  renderer.compile(scene, camera);

  const timer = new THREE.Timer();
  timer.connect(document);

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    uniforms.uTime.value += dt;
    tools.update(dt);
    player.update(dt);
    particles.sparks.update(dt); particles.dust.update(dt);
    sky.update(dt, camera, scene);
    // shadow frustum follows the player (snapped to texel grid to avoid shimmering)
    const p = player.pos;
    const snap = 90 / sun.shadow.mapSize.x;
    const tx = Math.round(p.x / snap) * snap, tz = Math.round(p.z / snap) * snap;
    sun.target.position.set(tx, p.y, tz);
    sun.position.set(tx + sunDir.x * 100, p.y + sunDir.y * 100, tz + sunDir.z * 100);
    hud.update(dt, player);
    post.render(dt);
    dev.update();
  });

  // debug hooks
  window.__game = { scene, camera, player, renderer, THREE, post, shafts, sky, tools };
}

init().catch((e) => {
  console.error(e);
  progress.textContent = 'Hiba: ' + e.message;
});

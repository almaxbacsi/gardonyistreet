import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { loadPhotoTextures } from './world/photoTextures.js';
import { GradeShader } from './grade.js';
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

const params = new URLSearchParams(location.search);
const QUALITY = params.get('q') === 'low' ? 'low' : 'high';

const progress = document.getElementById('progress');
const startEl = document.getElementById('start');
const overlay = document.getElementById('overlay');
const step = async (msg) => { progress.textContent = msg; await new Promise((r) => setTimeout(r, 0)); };

async function init() {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY === 'high' ? 1.5 : 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
  const uniforms = { uTime: { value: 0 } };

  // ---- sky, sun, environment
  await step('Égbolt és fények…');
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  // late-afternoon sun from the south-west (Street View imagery has warm side light)
  const elev = THREE.MathUtils.degToRad(34), azim = THREE.MathUtils.degToRad(215);
  const sunDir = new THREE.Vector3(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev));
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    // outdoor HDRI (Poly Haven "Quarry 01", CC0) for realistic image-based lighting
    const hdr = await new HDRLoader().loadAsync('hdri/quarry_01_1k.hdr');
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentRotation.y = 2.2;
    hdr.dispose();
  } catch (e) {
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
    envScene.add(sky2);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  }
  scene.environmentIntensity = 0.45;

  scene.fog = new THREE.FogExp2(0xc4c3b4, 0.0016); // warm summer haze

  const sun = new THREE.DirectionalLight(0xffe6c4, 3.2);
  sun.castShadow = true;
  const sm = QUALITY === 'high' ? 4096 : 1536;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xd8e4f0, 0x5a5a3a, 0.35);
  scene.add(hemi);

  // ---- world
  await step('Fotótextúrák betöltése…');
  const photos = await loadPhotoTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  await step('Textúrák…');
  const M = createMaterials(QUALITY, photos);
  console.info('Fotótextúrák:', Object.keys(photos).length ? M.photoUsed : 'nincs (procedurális textúrák)');
  await step('Domborzat (OSM + Street View magasságok)…');
  const forest = OSM.w.filter((w) => w.k === 'l' && w.v === 'forest').map(wayPoints);
  const terrain = buildTerrain(M, { center: [0, 10], size: 380, res: QUALITY === 'high' ? 1.25 : 2, forestPolys: forest });
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
  const veg = buildVegetation(M, { quality: QUALITY, uniforms });
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

  // ---- start / pause
  startEl.textContent = 'Kattints a kezdéshez';
  progress.textContent = QUALITY === 'high' ? 'Gyengébb gépen: ?q=low a címben' : 'Alacsony grafikai beállítás';
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

  // ---- post-processing: tone mapping + warm "San Andreas" style grade + vignette
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: QUALITY === 'high' ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));
  addEventListener('keydown', (e) => { if (e.code === 'KeyG') { grade.enabled = !grade.enabled; hud.showToast(grade.enabled ? 'Színkorrekció: be' : 'Színkorrekció: ki'); } });

  // warm up shaders
  renderer.compile(scene, camera);

  const timer = new THREE.Timer();
  timer.connect(document);
  const snap = 45 * 2 / sm;
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    uniforms.uTime.value += dt;
    player.update(dt);
    // shadow frustum follows the player (snapped to texel grid to avoid shimmering)
    const p = player.pos;
    const tx = Math.round(p.x / snap) * snap, tz = Math.round(p.z / snap) * snap;
    sun.target.position.set(tx, p.y, tz);
    sun.position.set(tx + sunDir.x * 100, p.y + sunDir.y * 100, tz + sunDir.z * 100);
    hud.update(dt, player);
    composer.render(dt);
  });

  // debug hooks
  window.__game = { scene, camera, player, renderer, THREE, composer, grade };
}

init().catch((e) => {
  console.error(e);
  progress.textContent = 'Hiba: ' + e.message;
});

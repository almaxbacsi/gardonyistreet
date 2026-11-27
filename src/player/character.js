import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Animated humanoid (Mixamo rig, glTF) with Idle / Walk / Run blending.
 * Faces +Z in its root group. Replace public/models/Soldier.glb with any Mixamo
 * character that has clips named Idle, Walk, Run to change the look.
 */
export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.ready = false;
  }

  async load(url = 'models/Soldier.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.rotation.y = Math.PI; // Mixamo export faces -Z
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) o.material.envMapIntensity = 0.8;
      }
    });
    // normalise height to ~1.80 m
    const box = new THREE.Box3().setFromObject(model);
    const s = 1.8 / (box.max.y - box.min.y);
    model.scale.multiplyScalar(s);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
    this.root.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n) => gltf.animations.find((a) => a.name.toLowerCase() === n.toLowerCase());
    this.actions = {};
    for (const n of ['Idle', 'Walk', 'Run']) {
      const c = clip(n);
      if (!c) continue;
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      this.actions[n] = a;
    }
    this.w = { Idle: 1, Walk: 0, Run: 0 };
    this.ready = true;
  }

  /** @param dt seconds, @param speed horizontal m/s, @param grounded bool */
  update(dt, speed, grounded) {
    if (!this.ready) return;
    // weights from speed (source clips: walk ≈ 1.6 m/s, run ≈ 5 m/s)
    let wi = 0, ww = 0, wr = 0;
    if (speed < 0.15) wi = 1;
    else if (speed < 2.2) { const t = Math.min(1, speed / 1.2); wi = 1 - t; ww = t; }
    else { const t = Math.min(1, (speed - 2.2) / 2.0); ww = 1 - t; wr = t; }
    const k = 1 - Math.exp(-10 * dt);
    this.w.Idle += (wi - this.w.Idle) * k;
    this.w.Walk += (ww - this.w.Walk) * k;
    this.w.Run += (wr - this.w.Run) * k;
    const A = this.actions;
    if (A.Idle) A.Idle.setEffectiveWeight(this.w.Idle);
    if (A.Walk) { A.Walk.setEffectiveWeight(this.w.Walk); A.Walk.timeScale = THREE.MathUtils.clamp(speed / 1.55, 0.6, 1.5); }
    if (A.Run) { A.Run.setEffectiveWeight(this.w.Run); A.Run.timeScale = THREE.MathUtils.clamp(speed / 5.0, 0.7, 1.3); }
    this.mixer.update(grounded ? dt : dt * 0.35);
  }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Animated civilian (Ready Player Me avatar from the three.js examples, Mixamo-compatible skeleton)
 * with Idle / Walk / Run blending. The clips come from Soldier.glb (three.js examples) and are
 * retargeted by bone name ("mixamorig:" prefixes stripped) using rest-pose deltas (see retarget()).
 * Faces +Z in its root group. `handR` / `handL` are sockets for held tools.
 */
// Mixamo exports face -Z, the avatar faces +Z: rotate the source frame by 180° about Y
const ALIGN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.ready = false;
    this.handR = new THREE.Group(); this.handR.name = 'hand-r';
    this.handL = new THREE.Group(); this.handL.name = 'hand-l';
  }

  async load(modelUrl = 'models/civilian.glb', animUrl = 'models/Soldier.glb') {
    const loader = new GLTFLoader();
    const [gltf, anim] = await Promise.all([loader.loadAsync(modelUrl), loader.loadAsync(animUrl)]);
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) o.material.envMapIntensity = 0.8;
      }
    });
    // normalise height to ~1.78 m
    const box = new THREE.Box3().setFromObject(model);
    const s = 1.78 / (box.max.y - box.min.y);
    model.scale.multiplyScalar(s);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
    this.root.add(model);

    const bones = {};
    model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    this.bones = bones;
    bones.RightHand?.add(this.handR);
    bones.LeftHand?.add(this.handL);

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const n of ['Idle', 'Walk', 'Run']) {
      const src = anim.animations.find((a) => a.name.toLowerCase() === n.toLowerCase());
      if (!src) continue;
      const clip = retarget(src, anim.scene, model, bones, { align: ALIGN });
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      this.actions[n] = a;
    }
    this.w = { Idle: 1, Walk: 0, Run: 0 };
    this.ready = true;
  }

  /**
   * First person: hide the head (it would fill the view) from the camera while keeping its shadow.
   * Torso, arms and hands stay visible so the held tool is seen in your own hands.
   */
  setHidden(hidden) {
    if (this.hidden === hidden || !this.ready) return;
    this.hidden = hidden;
    const HEAD = /Wolf3D_(Skin|Teeth|Beard|Headwear|Hair|Eye)/;
    this.root.traverse((o) => {
      if (!o.isMesh || !HEAD.test([].concat(o.material).map((m) => m.name).join(' '))) return;
      for (const m of [].concat(o.material)) { m.colorWrite = !hidden; m.depthWrite = !hidden; }
    });
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
    this.afterAnim?.(dt); // procedural overrides (tool poses)
  }
}

/**
 * Mixamo clip -> avatar by rest-pose deltas in a shared (model-root) frame:
 *   W_dst(t) = A · W_src(t) · W_src(rest)^-1 · A^-1 · W_dst(rest)
 * where W are bone rotations relative to each model's root and A aligns the source root to the
 * target root (the Mixamo export faces -Z). Works across different bone axes / armature frames as
 * long as both rigs bind in a similar T-pose. The hips get a vertical bob scaled by hip height.
 */
function retarget(src, srcRoot, dst, dstBones, { fps = 30, align = new THREE.Quaternion() } = {}) {
  const norm = (n) => n.replace(/^mixamorig:?/, '');
  const srcBones = {};
  srcRoot.traverse((o) => { if (o.isBone) srcBones[norm(o.name)] = o; });
  const names = Object.keys(dstBones).filter((n) => srcBones[n]);
  // order parents before children
  const depth = (b) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };
  names.sort((a, b) => depth(dstBones[a]) - depth(dstBones[b]));

  const rootQ = (bone, root, out) => {
    const qb = bone.getWorldQuaternion(new THREE.Quaternion());
    const qr = root.getWorldQuaternion(new THREE.Quaternion());
    return out.copy(qr.invert().multiply(qb));
  };
  const rootP = (bone, root) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));

  srcRoot.updateMatrixWorld(true); dst.updateMatrixWorld(true);
  const restS = {}, restD = {};
  for (const n of names) { restS[n] = rootQ(srcBones[n], srcRoot, new THREE.Quaternion()); restD[n] = rootQ(dstBones[n], dst, new THREE.Quaternion()); }
  const hipS0 = rootP(srcBones.Hips, srcRoot), hipD0 = rootP(dstBones.Hips, dst);
  const hipScale = hipD0.y / Math.max(1e-4, hipS0.y);

  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(src).play();
  const n = Math.max(2, Math.round(src.duration * fps) + 1);
  const times = new Float32Array(n);
  const qv = Object.fromEntries(names.map((k) => [k, new Float32Array(n * 4)]));
  const hipY = new Float32Array(n * 3);
  const alignInv = align.clone().invert();
  const W = {}, q = new THREE.Quaternion(), parentW = new THREE.Quaternion();
  const dstRootQ = dst.getWorldQuaternion(new THREE.Quaternion());

  for (let i = 0; i < n; i++) {
    const t = Math.min(src.duration, i / fps);
    times[i] = t;
    mixer.setTime(t);
    srcRoot.updateMatrixWorld(true);
    for (const k of names) {
      rootQ(srcBones[k], srcRoot, q);
      // delta from rest, expressed in the target root frame
      const d = align.clone().multiply(q).multiply(restS[k].clone().invert()).multiply(alignInv);
      W[k] = d.multiply(restD[k]);
      // local = parentWorld^-1 · world (parent world relative to the target root)
      const par = dstBones[k].parent;
      const pk = par && norm(par.name);
      if (pk && W[pk]) parentW.copy(W[pk]);
      else { // parent outside the retargeted set: its rest rotation relative to the root
        parentW.copy(dstRootQ).invert().multiply(par.getWorldQuaternion(new THREE.Quaternion()));
      }
      const local = parentW.clone().invert().multiply(W[k]);
      local.toArray(qv[k], i * 4);
    }
    const hp = rootP(srcBones.Hips, srcRoot);
    const dy = (hp.y - hipS0.y) * hipScale;
    const base = dstBones.Hips.position;
    hipY[i * 3] = base.x; hipY[i * 3 + 1] = base.y + dy / dstWorldScaleY(dstBones.Hips, dst); hipY[i * 3 + 2] = base.z;
  }
  mixer.stopAllAction();
  const tracks = names.map((k) => new THREE.QuaternionKeyframeTrack(`${dstBones[k].name}.quaternion`, times, qv[k]));
  tracks.push(new THREE.VectorKeyframeTrack(`${dstBones.Hips.name}.position`, times, hipY));
  return new THREE.AnimationClip(src.name, src.duration, tracks);
}

/** how many root-frame units one local unit of the bone's parent is (vertical) */
function dstWorldScaleY(bone, root) {
  const a = root.worldToLocal(bone.parent.localToWorld(new THREE.Vector3(0, 0, 0)));
  const b = root.worldToLocal(bone.parent.localToWorld(new THREE.Vector3(0, 1, 0)));
  return Math.max(1e-6, a.distanceTo(b));
}

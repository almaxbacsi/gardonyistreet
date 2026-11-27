// Tool handling: equip/switch, use input, procedural arm/spine poses on top of the locomotion clips
// (two-bone IK to the tool's grips), tool transforms, moving parts and particle effects.
// Emits onImpact({ tool, point, dir, kind }) for the interaction system (#9).
import * as THREE from 'three';
import { TOOLS } from './defs.js';
import { twoBoneIK, rotateBoneWorld, aimBone } from '../player/ik.js';
import { W } from '../world/geo.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const smooth = (t) => t * t * (3 - 2 * t);

function sampleKeys(keys, t) {
  if (keys.length === 1) return { grip: V(keys[0].grip), aim: V(keys[0].aim), lean: keys[0].lean };
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].p) i++;
  const a = keys[i], b = keys[i + 1];
  const u = smooth(THREE.MathUtils.clamp((t - a.p) / Math.max(1e-4, b.p - a.p), 0, 1));
  return { grip: V(a.grip).lerp(V(b.grip), u), aim: V(a.aim).lerp(V(b.aim), u), lean: a.lean + (b.lean - a.lean) * u };
}
const mixPose = (a, b, u) => ({ grip: a.grip.clone().lerp(b.grip, u), aim: a.aim.clone().lerp(b.aim, u), lean: a.lean + (b.lean - a.lean) * u });

export class ToolSystem {
  constructor({ scene, character, player, hud, particles, raycastTargets = [] }) {
    this.scene = scene; this.char = character; this.player = player; this.hud = hud;
    this.fx = particles; // { sparks, dust }
    this.targets = raycastTargets;
    this.models = {};
    this.index = -1;      // equipped tool (-1 = empty hands)
    this.w = 0;           // pose blend weight
    this.pending = null;  // tool waiting for the current one to be put away
    this.useT = 0; this.active = false; this.holding = false; this.useW = 0; this.time = 0;
    this.sinceImpact = 0; this.sinceRay = 1;
    this.onImpact = null;
    this.aimLockEnabled = true; // debug: false keeps the TPS body facing its motion
    this.ray = new THREE.Raycaster();
    this.toolMatrix = new THREE.Matrix4();
    this.tmp = { m: new THREE.Matrix4(), basis: new THREE.Matrix4() };
    character.afterAnim = (dt) => this.pose(dt);
    this._bind();
    this.hud?.setHotbar(TOOLS.map((t) => t.label), this.index);
  }

  get tool() { return this.index >= 0 ? TOOLS[this.index] : null; }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.code === 'Digit0' || e.code === 'Backquote') this.select(-1);
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m && +m[1] <= TOOLS.length) this.select(+m[1] - 1);
    });
    let lastWheel = 0;
    addEventListener('wheel', (e) => {
      if (!this.player.locked) return;
      const now = performance.now();
      if (now - lastWheel < 120) return;
      lastWheel = now;
      const n = TOOLS.length + 1, cur = this.pending !== null ? this.pending : this.index;
      this.select(((cur + 1 + Math.sign(e.deltaY)) % n + n) % n - 1);
    }, { passive: true });
    addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.player.locked || !this.tool) return;
      this.holding = true;
      if (this.tool.kind === 'strike' && !this.active) { this.active = true; this.useT = 0; this.impactDone = false; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.holding = false; });
    addEventListener('blur', () => { this.holding = false; });
  }

  select(i) {
    if (i === this.index && this.pending === null) return;
    this.pending = i;
    this.holding = false;
    this.hud?.setHotbar(TOOLS.map((t) => t.label), i);
  }

  _model(i) {
    if (!this.models[i]) {
      const m = TOOLS[i].build();
      m.group.matrixAutoUpdate = false;
      m.group.visible = false;
      this.scene.add(m.group);
      this.models[i] = m;
    }
    return this.models[i];
  }

  /**
   * Continuous tools work on what the crosshair points at: camera ray, accepted if the hit is
   * within the tool's reach of the player. Stored in this.contact (world point + normal).
   */
  _findContact(t) {
    const cam = this.player.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.ray.set(cam.position, dir);
    this.ray.far = this.player.curDist * (1 - this.player.fpsBlend) + t.reach + 0.6;
    const hit = this.ray.intersectObjects(this.targets, false)[0];
    if (!hit) return null;
    // reach: horizontal distance from the body, anywhere between the feet and above the head
    const p = this.player.pos, q = hit.point;
    if (Math.hypot(q.x - p.x, q.z - p.z) > t.reach || q.y < p.y - 0.3 || q.y > p.y + 2.3) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { point: hit.point, normal: n, object: hit.object };
  }

  /** advance timers; called once per frame before the player/character update */
  update(dt) {
    this.time += dt;
    const ct = this.tool;
    if (ct && ct.kind === 'hold' && this.holding && this.sinceRay >= 0.05) { this.sinceRay = 0; this.contact = this._findContact(ct); }
    // switching: put the current tool away, then take the next one
    if (this.pending !== null) {
      this.w = Math.max(0, this.w - dt * 6);
      if (this.w === 0 || this.index < 0) {
        if (this.index >= 0) this._model(this.index).group.visible = false;
        this.index = this.pending; this.pending = null;
        this.active = false; this.useT = 0; this.useW = 0;
      }
    } else if (this.index >= 0) this.w = Math.min(1, this.w + dt * 4);
    const t = this.tool;
    this.player.aimLock = this.aimLockEnabled && !!t && t.hold !== 'push' && (this.active || this.holding);
    if (!t) return;
    if (t.kind === 'strike' && this.active) {
      const prev = this.useT;
      this.useT += dt / t.duration;
      if (prev < t.hitAt && this.useT >= t.hitAt) this.impactPending = true;
      if (this.useT >= 1) { if (this.holding) { this.useT = 0; } else { this.active = false; this.useT = 0; } }
    }
    this.useW = THREE.MathUtils.damp(this.useW, (t.kind === 'hold' || t.kind === 'push') && this.holding ? 1 : 0, 10, dt);
    this.sinceImpact += dt; this.sinceRay += dt;
  }

  /** root-frame pose (grip, aim, lean) of the current tool */
  _pose(t) {
    if (t.kind === 'strike') return this.active ? sampleKeys(t.use, this.useT) : sampleKeys([t.idle], 0);
    const base = mixPose(sampleKeys([t.idle], 0), sampleKeys(t.use, 0), this.useW);
    if (this.contact && this.useW > 0.01 && !t.sweep) {
      // bring the working part onto the surface (within arm's reach of the shoulder)
      const root = this.char.root;
      const cp = root.worldToLocal(this.contact.point.clone());
      const shoulder = new THREE.Vector3(-0.18, 1.42, 0.05);
      const headDist = this._model(this.index).head.length();
      const dir = cp.clone().sub(base.grip).normalize();
      let g = cp.clone().addScaledVector(dir, -headDist);
      const off = g.clone().sub(shoulder);
      if (off.length() > 0.6) g = shoulder.clone().add(off.setLength(0.6));
      const k = this.useW * (1 - this.player.fpsBlend * 0.5);
      base.grip.lerp(g, k);
      base.aim.lerp(cp.clone().addScaledVector(dir, 0.5), k);
    }
    if (t.sweep && this.useW > 0.01) {
      const s = Math.sin(this.time * 2.6) * t.sweep * this.useW;
      base.aim.x += s; base.grip.x += s * 0.35;
      base.aim.y += Math.sin(this.time * 5.2) * 0.04 * this.useW;
    }
    if ((t.id === 'grinder' || t.id === 'drill') && this.useW > 0.5) {
      const j = t.id === 'drill' ? 0.006 : 0.003;
      const r = () => (Math.random() - 0.5) * 2 * j;
      base.grip.add(new THREE.Vector3(r(), r(), r()));
      if (t.id === 'drill') base.grip.z -= Math.abs(Math.sin(this.time * 90)) * 0.008;
    }
    return base;
  }

  /** called by Character after the animation mixer: pose the body and place the tool */
  pose() {
    const t = this.tool, ch = this.char, B = ch.bones;
    if (!t || !ch.ready || this.w <= 0) { if (t) this._model(this.index).group.visible = this.w > 0; return; }
    const m = this._model(this.index);
    m.group.visible = true;
    const root = ch.root;
    root.updateMatrixWorld(true);
    const w = smooth(this.w);
    const f = this.player.fpsBlend;
    let grip, gripL, lean = 0;
    const local = new THREE.Matrix4();

    if (t.hold === 'push') {
      // mower on the ground in front, pitched to the slope
      const fwdW = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
      const c = root.localToWorld(new THREE.Vector3(0, 0, t.offset));
      const hF = W.h(c.x + fwdW.x * 0.25, c.z + fwdW.z * 0.25), hB = W.h(c.x - fwdW.x * 0.25, c.z - fwdW.z * 0.25);
      const pitch = Math.atan2(hF - hB, 0.5);
      const ground = (hF + hB) / 2 - root.position.y;
      const vib = this.useW * (Math.random() - 0.5) * 0.004;
      local.makeRotationX(-pitch).setPosition(0, ground + vib, t.offset);
      this.toolMatrix.multiplyMatrices(root.matrixWorld, local);
      grip = m.rightGrip.clone().applyMatrix4(this.toolMatrix);
      gripL = m.leftGrip.clone().applyMatrix4(this.toolMatrix);
      lean = 0.12;
    } else {
      const p = this._pose(t);
      lean = p.lean;
      // first person: lift the tool into view; follow the view pitch (fully in FPS, partly in TPS)
      const lift = new THREE.Vector3(-0.06, 0.5, 0.3).multiplyScalar(f);
      p.grip.add(lift); p.aim.add(lift);
      const pivot = new THREE.Vector3(0, 1.5, 0.1);
      const ang = -this.player.pitch * (f + (1 - f) * 0.45);
      const rot = new THREE.Matrix4().makeRotationX(ang);
      for (const v of [p.grip, p.aim]) v.sub(pivot).applyMatrix4(rot).add(pivot);
      // tool basis in the root frame
      const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
      if (t.hold === 'two') {
        Y.subVectors(p.aim, p.grip).normalize();
        const side = new THREE.Vector3(t.side, 0, 0);
        X.copy(side).addScaledVector(Y, -side.dot(Y)).normalize();
        Z.crossVectors(X, Y);
      } else {
        Z.subVectors(p.aim, p.grip).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        Y.copy(up).addScaledVector(Z, -up.dot(Z)).normalize();
        X.crossVectors(Y, Z);
      }
      local.makeBasis(X, Y, Z).setPosition(p.grip);
      this.toolMatrix.multiplyMatrices(root.matrixWorld, local);
      grip = p.grip.clone().applyMatrix4(root.matrixWorld);
      gripL = m.leftGrip.clone().applyMatrix4(this.toolMatrix);
    }
    m.group.matrix.copy(this.toolMatrix);
    m.group.matrixWorldNeedsUpdate = true;

    // body: lean, then reach both hands to the grips
    const rightW = new THREE.Vector3(1, 0, 0).transformDirection(root.matrixWorld);
    if (B.Spine1) rotateBoneWorld(B.Spine1, rightW, lean * w * (1 - 0.6 * f));
    const pole = (x) => root.localToWorld(new THREE.Vector3(x, 0.3, -0.4));
    if (B.RightArm) twoBoneIK(B.RightArm, B.RightForeArm, B.RightHand, wristTarget(B.RightArm, grip), pole(-0.9), w);
    if (B.LeftArm) twoBoneIK(B.LeftArm, B.LeftForeArm, B.LeftHand, wristTarget(B.LeftArm, gripL), pole(0.9), w);
    // turn each palm onto its handle, then close the fingers around it
    const ax = (v) => v.clone().transformDirection(this.toolMatrix);
    const [axR, axL] = GRIP_AXES[t.id] || [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    palmOnto(B, 'Right', grip, ax(axR), w);
    palmOnto(B, 'Left', gripL, ax(axL), w);
    curlFingers(B, 'Right', 0.62 * w);
    curlFingers(B, 'Left', 0.62 * w);

    this._parts(t, m);
    this._effects(t, m);
  }

  _parts(t, m) {
    const spin = this.useW;
    if (m.parts.disc) m.parts.disc.rotateY(spin * 1.6);
    if (m.parts.bit) m.parts.bit.rotateY(spin * 0.9);
    if (m.parts.blade && t.id === 'mower') m.parts.blade.rotateY(spin * 1.3);
    if (m.parts.blade && t.id === 'trimmer') m.parts.blade.position.x = Math.sin(this.time * 60) * 0.006 * spin;
  }

  _effects(t, m) {
    const head = m.head.clone().applyMatrix4(this.toolMatrix);
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(this.toolMatrix);
    const along = new THREE.Vector3(0, 1, 0).transformDirection(this.toolMatrix);
    // strike impact
    if (this.impactPending) {
      this.impactPending = false;
      const dir = t.hold === 'two' ? along : fwd;
      this.onImpact?.({ tool: t.id, point: head, dir, kind: 'strike' });
      if (head.y - W.h(head.x, head.z) < 0.25) {
        this.fx.dust.emit(head, new THREE.Vector3(0, 1, 0), { count: 14, speed: 1.4, spread: 0.8, color: new THREE.Color(0.32, 0.27, 0.2), alpha: 0.7, size: 0.08, life: 0.9, gravity: -3, drag: 2.5 });
      }
    }
    if (t.kind !== 'hold' || this.useW < 0.5) { this.contact = null; return; }
    const c = this.contact;
    if (c && t.id === 'grinder') {
      // sparks leave tangentially along the disc rotation, bouncing off the surface
      const tang = new THREE.Vector3(1, 0, 0).transformDirection(this.toolMatrix).add(c.normal.clone().multiplyScalar(0.6));
      this.fx.sparks.emit(c.point, tang, { count: 6, speed: 5, spread: 0.35, color: new THREE.Color(4.0, 1.6, 0.35), size: 0.022, life: 0.45, gravity: -9.8, drag: 0.4 });
    }
    if (c && t.id === 'drill') {
      this.fx.dust.emit(c.point, c.normal, { count: 2, speed: 0.8, spread: 0.6, color: new THREE.Color(0.55, 0.52, 0.48), alpha: 0.6, size: 0.04, life: 0.8, gravity: -2, drag: 3 });
    }
    if (this.sinceImpact >= t.interval) {
      this.sinceImpact = 0;
      this.onImpact?.({ tool: t.id, point: c ? c.point.clone() : head, dir: fwd, kind: 'hold', contact: !!c, object: c?.object });
    }
  }
}

// direction of each handle in the tool's local frame (right grip, left grip)
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const GRIP_AXES = {
  shovel: [X, Y], rake: [Y, Y], sledgehammer: [Y, Y], trimmer: [Z, X],
  grinder: [Z, X], drill: [Y, X], mower: [X, X],
};

/** rotate the hand about its own length so the palm faces the handle axis passing through `grip` */
function palmOnto(B, side, grip, axis, w) {
  const hand = B[side + 'Hand'], mid = B[side + 'HandMiddle1'], i1 = B[side + 'HandIndex1'], p1 = B[side + 'HandPinky1'];
  if (!hand || !mid || !i1 || !p1 || w <= 0) return;
  // the hand's length runs across the handle (like holding a bar), bent from the forearm as little as possible
  const fa = B[side + 'ForeArm'];
  const armDir = hand.getWorldPosition(new THREE.Vector3()).sub(fa.getWorldPosition(new THREE.Vector3())).normalize();
  const across = armDir.clone().addScaledVector(axis, -armDir.dot(axis));
  if (across.lengthSq() > 0.04) aimBone(hand, mid, across.normalize().lerp(armDir, 0.25).normalize(), w);
  const h = hand.getWorldPosition(new THREE.Vector3());
  const fwd = mid.getWorldPosition(new THREE.Vector3()).sub(h).normalize();
  const knuckles = p1.getWorldPosition(new THREE.Vector3()).sub(i1.getWorldPosition(new THREE.Vector3())).normalize();
  const palm = new THREE.Vector3().crossVectors(knuckles, fwd).multiplyScalar(side === 'Right' ? 1 : -1);
  // from the palm centre to the closest point on the handle axis
  const pc = h.clone().addScaledVector(fwd, 0.06);
  const toAxis = grip.clone().sub(pc);
  toAxis.addScaledVector(axis, -toAxis.dot(axis));
  const flat = (v) => v.clone().addScaledVector(fwd, -v.dot(fwd));
  const a = flat(palm), b = flat(toAxis);
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
  a.normalize(); b.normalize();
  const angle = Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(fwd), a.dot(b));
  rotateBoneWorld(hand, fwd, angle * w);
}

/** close a hand around a grip: rotate the finger joints about the knuckle line (index -> pinky) */
function curlFingers(B, side, angle) {
  const i1 = B[side + 'HandIndex1'], p1 = B[side + 'HandPinky1'];
  if (!i1 || !p1 || angle <= 0) return;
  const axis = p1.getWorldPosition(new THREE.Vector3()).sub(i1.getWorldPosition(new THREE.Vector3())).normalize();
  const sgn = side === 'Right' ? -1 : 1; // positive = toward the palm
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    for (let j = 1; j <= 3; j++) {
      const b = B[`${side}Hand${f}${j}`];
      if (b) rotateBoneWorld(b, axis, sgn * angle * (j === 1 ? 0.9 : 1.1));
    }
  }
}

/** wrist target: the grip sits in the palm, ~7 cm beyond the wrist along the arm direction */
function wristTarget(shoulderBone, grip) {
  const s = shoulderBone.getWorldPosition(new THREE.Vector3());
  return grip.clone().addScaledVector(grip.clone().sub(s).normalize(), -0.07);
}

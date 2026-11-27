// What the tools do to the street (session-persistent, nothing is saved):
//  bins knocked over (rigid bodies), cars dented / scratched / windows cracked and rocked,
//  bushes and hedges cut back until removed, trees shaken and finally felled, weeds mowed.
// Hit events come from ToolSystem.onImpact; the mower is handled every frame.
import * as THREE from 'three';
import { binImpulse, stepBins, carDent, carScratch, carCrack, carRock, stepCars } from '../world/dynamicProps.js';
import { W } from '../world/geo.js';

// per-tool effect strength: bin impulse (N·s), dent [radius, depth], scratch, crack, vegetation damage
const FX = {
  sledgehammer: { bin: 60, dent: [0.28, 0.09], crack: 1, bush: 30, tree: 12, weeds: 0.4 },
  shovel: { bin: 34, dent: [0.18, 0.04], scratch: 0.5, crack: 0.6, bush: 25, tree: 7, weeds: 0.6 },
  rake: { bin: 16, dent: [0.1, 0.01], scratch: 0.35, crack: 0.3, bush: 10, tree: 2, weeds: 0.8 },
  grinder: { bin: 1.2, scratch: 0.35, scratchR: 0.07, bush: 3, tree: 1.4 },
  drill: { bin: 0.8, dent: [0.04, 0.012], scratch: 0.6, scratchR: 0.03, crack: 0.25, crackEvery: 6, bush: 1, tree: 0.8 },
  trimmer: { bin: 0.6, scratch: 0.15, scratchR: 0.06, bush: 8, tree: 0.6, weeds: 0.5 },
};

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Interactions {
  constructor({ props, veg, collision, particles, player, tools }) {
    this.bins = props.dynamic.bins;
    this.cars = props.dynamic.cars;
    this.veg = veg.interactive.map((r) => ({ ...r, maxHp: r.kind === 'bush' ? (r.hedge ? 30 : 40 * Math.max(0.6, r.base.getMaxScaleOnAxis())) : 100 * Math.max(0.7, r.base.getMaxScaleOnAxis()), hp: 0, shake: 0, fall: null, gone: false }));
    for (const v of this.veg) v.hp = v.maxHp;
    this.weeds = veg.weeds;
    this.weedState = new Uint8Array(veg.weeds.matrices.length); // 0 ok, 1 mowed, 2 removed
    this.weedGrid = new Map();
    veg.weeds.matrices.forEach((m, i) => {
      _p.setFromMatrixPosition(m);
      const k = `${Math.floor(_p.x / 2)},${Math.floor(_p.z / 2)}`;
      (this.weedGrid.get(k) || this.weedGrid.set(k, []).get(k)).push(i);
    });
    this.col = collision;
    this.fx = particles;
    this.player = player;
    this.tools = tools;
    for (const b of this.bins) collision.dynamic.push(b.collider);
    this.hitTargets = [];
    for (const o of [...this.bins, ...this.cars]) o.group.traverse((m) => { if (m.isMesh) this.hitTargets.push(m); });
    this.ray = new THREE.Raycaster();
    this.drillCount = 0;
    tools.onImpact = (e) => this.onImpact(e);
  }

  // ------------------------------------------------------------ hits
  onImpact(e) {
    const fx = FX[e.tool];
    if (!fx) return;
    const chest = this.player.pos.clone(); chest.y += 1.25;
    let hit = null;
    if (e.kind === 'strike') {
      // sweep from the chest to (a bit beyond) the tool head: first bin/car surface on the way
      const to = e.point.clone().addScaledVector(e.dir, 0.25);
      const dir = to.clone().sub(chest);
      this.ray.set(chest, dir.clone().normalize()); this.ray.far = dir.length();
      hit = this.ray.intersectObjects(this.hitTargets, false)[0] || null;
      if (!hit) {
        // the swing ends short or low: a horizontal ray at the head's height along the swing, out to the reach
        const h = THREE.MathUtils.clamp(e.point.y - this.player.pos.y, 0.55, 1.2);
        const o = this.player.pos.clone(); o.y += h;
        const fwd = e.point.clone().sub(o).setY(0);
        if (fwd.lengthSq() > 1e-4) {
          this.ray.set(o, fwd.normalize()); this.ray.far = (this.tools.tool?.reach || 1.5) + 0.2;
          hit = this.ray.intersectObjects(this.hitTargets, false)[0] || null;
        }
      }
    } else if (e.object && e.object.userData.owner) {
      hit = { point: e.point, object: e.object };
    }
    const owner = hit?.object.userData.owner;
    const pushDir = hit ? hit.point.clone().sub(chest).setY(0).normalize() : e.dir.clone();

    if (owner?.kind === 'bin') {
      const J = pushDir.clone().multiplyScalar(fx.bin);
      J.y = fx.bin * (e.kind === 'strike' ? 0.15 : 0);
      // strikes land high enough on the bin to tip it rather than slide it
      const at = hit.point.clone();
      if (e.kind === 'strike') at.y = Math.max(at.y, owner.p.y + 0.3);
      binImpulse(owner, J, at);
      this.fx.dust.emit(hit.point, pushDir.clone().negate(), { count: 6, speed: 1, spread: 0.6, color: new THREE.Color(0.2, 0.2, 0.2), alpha: 0.5, size: 0.05, life: 0.5, gravity: -3, drag: 3 });
      return;
    }
    if (owner?.kind === 'car') {
      const isGlass = hit.object === owner.glass;
      if (isGlass && fx.crack && (e.kind === 'strike' || ++this.drillCount % (fx.crackEvery || 1) === 0)) carCrack(owner, hit.point, fx.crack);
      if (!isGlass && fx.dent) carDent(owner, hit.point, pushDir, fx.dent[0], fx.dent[1]);
      if (!isGlass && fx.scratch) carScratch(owner, hit.point, fx.scratchR || fx.dent?.[0] || 0.1, fx.scratch);
      if (e.kind === 'strike') carRock(owner, pushDir, fx.bin / 30);
      if (isGlass && e.kind === 'strike') this.fx.sparks.emit(hit.point, pushDir.clone().negate(), { count: 10, speed: 2, spread: 0.7, color: new THREE.Color(0.8, 0.9, 1.0), size: 0.02, life: 0.6, gravity: -9.8, drag: 0.5 });
      return;
    }
    // vegetation: the strike point or the crosshair
    const target = this.findVegetation(e);
    if (target) this.damageVegetation(target, fx, e);
    if (fx.weeds && (e.kind === 'strike' ? e.point.y - W.h(e.point.x, e.point.z) < 0.4 : true)) {
      const n = this.cutWeeds(e.point, fx.weeds, e.tool === 'trimmer' ? 1 : 2);
      if (n) this.clippings(e.point, n);
    }
  }

  /** nearest damageable plant: strike = around the tool head, hold = along the crosshair ray within reach */
  findVegetation(e) {
    const pp = this.player.pos;
    let best = null, bestD = Infinity;
    const cam = this.player.camera, rd = cam.getWorldDirection(new THREE.Vector3());
    for (const v of this.veg) {
      if (v.gone || v.fall) continue;
      if (Math.hypot(v.x - pp.x, -v.y - pp.z) > 4.5) continue;
      const gy = v.base.elements[13];
      if (e.kind === 'strike') {
        const d = Math.hypot(e.point.x - v.x, e.point.z + v.y);
        const yOk = e.point.y > gy - 0.3 && e.point.y < gy + Math.min(v.height, 3);
        if (yOk && d < v.radius + 0.35 && d < bestD) { best = v; bestD = d; }
      } else {
        // closest approach between the view ray and the plant's vertical axis (bush: sphere centre)
        const c = new THREE.Vector3(v.x, gy + Math.min(v.height * 0.5, 1.2), -v.y);
        const t = Math.max(0, c.clone().sub(cam.position).dot(rd));
        const q = cam.position.clone().addScaledVector(rd, t);
        const d = Math.hypot(q.x - c.x, q.z - c.z);
        const reach = Math.hypot(q.x - pp.x, q.z - pp.z);
        if (d < v.radius + 0.25 && reach < (this.tools.tool?.reach || 1.5) + v.radius && t < bestD) { best = v; bestD = t; }
        // the working head itself touching the plant also counts
        const dh = Math.hypot(e.point.x - v.x, e.point.z + v.y);
        if (dh < v.radius + 0.15 && dh < bestD) { best = v; bestD = dh; }
      }
    }
    return best;
  }

  damageVegetation(v, fx, e) {
    const dmg = v.kind === 'bush' ? fx.bush : fx.tree;
    if (!dmg) return;
    v.hp -= dmg;
    const gy = v.base.elements[13];
    const leafAt = new THREE.Vector3(v.x, gy + (v.kind === 'bush' ? v.height * 0.6 : Math.min(v.height * 0.55, 5)), -v.y);
    if (v.kind === 'bush') {
      this.leaves(leafAt, e.kind === 'strike' ? 14 : 4, 0.6);
      if (v.hp <= 0) { this.leaves(leafAt, 30, 0.9); this.setInstance(v, 0); v.gone = true; if (v.collider) v.collider[2] = 0; }
      else this.setInstance(v, 0.3 + 0.7 * (v.hp / v.maxHp));
    } else {
      v.shake = Math.min(1, v.shake + (e.kind === 'strike' ? 0.8 : 0.15));
      this.leaves(leafAt, e.kind === 'strike' ? 18 : 3, 2.2);
      if (e.kind === 'strike' || Math.random() < 0.3) this.fx.dust.emit(new THREE.Vector3(v.x, gy + 0.6, -v.y), new THREE.Vector3(0, 1, 0), { count: e.kind === 'strike' ? 8 : 2, speed: 1, spread: 0.7, color: new THREE.Color(0.55, 0.42, 0.28), alpha: 0.8, size: 0.03, life: 0.7, gravity: -6, drag: 2 });
      if (v.hp <= 0) {
        // fall away from the player
        const away = new THREE.Vector3(v.x - this.player.pos.x, 0, -v.y - this.player.pos.z).normalize();
        v.fall = { axis: new THREE.Vector3(0, 1, 0).cross(away).normalize(), angle: 0, speed: 0, done: false };
        if (v.collider) v.collider[2] = 0;
      }
    }
  }

  /** rebuild an instance matrix: uniform shrink factor, plus tilt (shake / fall) about the base */
  setInstance(v, scale, tilt = null) {
    v.base.decompose(_p, _q, _s);
    const sc = _s.clone().multiplyScalar(scale);
    if (v.hedge && scale > 0) sc.set(_s.x * (0.75 + 0.25 * scale), _s.y * scale, _s.z * (0.75 + 0.25 * scale)); // trimmed from the top
    const rot = tilt ? tilt.clone().multiply(_q) : _q;
    _m.compose(_p, rot, scale > 0 ? sc : _s.set(1e-4, 1e-4, 1e-4));
    for (const m of [v.tm, v.lm]) { m.setMatrixAt(v.index, _m); m.instanceMatrix.needsUpdate = true; }
  }

  cutWeeds(p, radius, state) {
    let n = 0;
    const r2 = radius * radius;
    for (let gx = Math.floor((p.x - radius) / 2); gx <= Math.floor((p.x + radius) / 2); gx++) {
      for (let gz = Math.floor((p.z - radius) / 2); gz <= Math.floor((p.z + radius) / 2); gz++) {
        for (const i of this.weedGrid.get(`${gx},${gz}`) || []) {
          if (this.weedState[i] >= state) continue;
          const m = this.weeds.matrices[i];
          _p.setFromMatrixPosition(m);
          if ((_p.x - p.x) ** 2 + (_p.z - p.z) ** 2 > r2) continue;
          this.weedState[i] = state;
          m.decompose(_p, _q, _s);
          if (state === 1) _s.set(_s.x * 0.8, _s.y * 0.14, _s.z * 0.8); else _s.set(1e-4, 1e-4, 1e-4);
          _m.compose(_p, _q, _s);
          this.weeds.mesh.setMatrixAt(i, _m);
          n++;
        }
      }
    }
    if (n) this.weeds.mesh.instanceMatrix.needsUpdate = true;
    return n;
  }

  leaves(at, count, spread) {
    if (!count) return;
    this.fx.leaves.emit(at, new THREE.Vector3(0, -0.2, 0), { count, speed: 0.8, spread: spread, color: new THREE.Color(0.22 + Math.random() * 0.1, 0.33, 0.12), alpha: 0.95, size: 0.07, life: 2.2, gravity: -1.4, drag: 2.2, jitter: 0.6 });
  }

  clippings(at, n) {
    this.fx.leaves.emit(at.clone().setY(at.y + 0.1), new THREE.Vector3(0, 1, 0), { count: Math.min(24, 4 + n * 3), speed: 1.6, spread: 0.8, color: new THREE.Color(0.35, 0.5, 0.16), alpha: 0.9, size: 0.03, life: 0.9, gravity: -6, drag: 1.5 });
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    stepBins(this.bins, dt, this.col);
    stepCars(this.cars, dt);
    const pp = this.player.pos;
    // walking into a bin nudges it
    const pv = this.player.vel;
    for (const b of this.bins) {
      const dx = b.p.x - pp.x, dz = b.p.z - pp.z, d = Math.hypot(dx, dz);
      if (d < b.collider[2] + 0.38 && d > 1e-3) {
        const into = (pv.x * dx + pv.z * dz) / d;
        if (into > 0.2) binImpulse(b, new THREE.Vector3(dx / d, 0, dz / d).multiplyScalar(into * 2.2 * dt * 10), b.p.clone().setY(b.p.y + 0.25));
      }
    }
    // mower: engine on (button held) cuts weeds under the deck and bumps bins
    const t = this.tools.tool;
    if (t && t.id === 'mower' && this.tools.useW > 0.5 && this.tools.w > 0.9) {
      const c = new THREE.Vector3().setFromMatrixPosition(this.tools.toolMatrix);
      const n = this.cutWeeds(c, 0.36, 1);
      if (n) {
        const side = new THREE.Vector3(1, 0, 0).transformDirection(this.tools.toolMatrix);
        this.fx.leaves.emit(c.clone().addScaledVector(side, 0.3).setY(c.y + 0.15), side, { count: 6 + n * 4, speed: 2.2, spread: 0.5, color: new THREE.Color(0.35, 0.52, 0.16), alpha: 0.9, size: 0.03, life: 0.8, gravity: -6, drag: 1.2 });
      }
      for (const b of this.bins) {
        const d = Math.hypot(b.p.x - c.x, b.p.z - c.z);
        if (d < 0.75 && this.player.speed > 0.3) binImpulse(b, new THREE.Vector3(b.p.x - c.x, 0, b.p.z - c.z).normalize().multiplyScalar(2.5), b.p.clone());
      }
    }
    // trees: shake and fall animation
    for (const v of this.veg) {
      if (v.kind === 'bush' || v.gone) continue;
      if (v.fall && !v.fall.done) {
        const f = v.fall;
        f.speed += (0.6 + 2.6 * Math.sin(f.angle)) * dt; // accelerates as it tips over
        f.angle += f.speed * dt;
        if (f.angle >= 1.5) { f.angle = 1.5; if (f.speed > 0.4) f.speed = -f.speed * 0.25; else { f.done = true; } }
        if (f.angle >= 1.45 && !f.thud) { // crown hits the ground: burst of leaves where it lands
          f.thud = true;
          const land = new THREE.Vector3(0, 1, 0).applyAxisAngle(f.axis, 1.5).multiplyScalar(Math.min(v.height * 0.55, 5));
          this.leaves(new THREE.Vector3(v.x, v.base.elements[13] + 0.8, -v.y).add(land.setY(0)), 40, 2.5);
        }
        this.setInstance(v, 1, new THREE.Quaternion().setFromAxisAngle(f.axis, f.angle));
      } else if (!v.fall && v.shake > 0.001) {
        v.shake = Math.max(0, v.shake - dt * 1.2);
        const a = Math.sin(performance.now() * 0.022) * 0.035 * v.shake;
        this.setInstance(v, 1, new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, a * 0.6)));
        if (v.shake === 0) this.setInstance(v, 1);
      }
    }
  }
}

import * as THREE from 'three';
import { W, toXY, dirAt } from '../world/geo.js';

const WALK = 1.6, RUN = 5.2, GRAVITY = -22, JUMP = 5.8;

/** Third-person controller: WASD + mouse look, over-the-shoulder camera. */
export class PlayerController {
  constructor({ camera, dom, character, collision, occluders }) {
    this.camera = camera;
    this.dom = dom;
    this.char = character;
    this.col = collision;
    this.occluders = occluders;
    this.keys = new Set();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; // camera yaw
    this.pitch = -0.12;
    this.facing = 0; // character yaw (model faces +Z)
    this.grounded = true;
    this.camDist = 3.4;
    this.curDist = 3.4;
    this.shoulder = 0.45;
    this.hitBoundary = false;
    this.ray = new THREE.Raycaster();
    this.locked = false;
    this.sensitivity = 0.0022;
    this._bind();
  }

  spawn(s, d) {
    const [x, y] = toXY(s, d);
    this.pos.set(x, W.h(x, -y), -y);
    const [dx, dy] = dirAt(s);
    this.yaw = Math.atan2(-dx, dy);
    this.facing = Math.atan2(dx, -dy);
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.facing;
  }

  _bind() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.dom; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * this.sensitivity, -1.1, 0.6);
    });
    addEventListener('wheel', (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(e.deltaY) * 0.4, 1.6, 7);
    }, { passive: true });
  }

  update(dt) {
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize();
    const target = wish.multiplyScalar(running ? RUN : WALK);
    const accel = this.grounded ? 10 : 2;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, target.x, accel, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, target.z, accel, dt);

    if (this.grounded && k.has('Space')) { this.vel.y = JUMP; this.grounded = false; }
    this.vel.y += GRAVITY * dt;

    // horizontal move + collisions (data coords: x, y=-Z)
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const [rx, ry, hit] = this.col.resolve(nx, -nz, 0.32);
    this.hitBoundary = hit;
    // kill velocity into obstacles
    const realVX = (rx - this.pos.x) / dt, realVZ = (-ry - this.pos.z) / dt;
    if (Math.abs(realVX) < Math.abs(this.vel.x)) this.vel.x = realVX;
    if (Math.abs(realVZ) < Math.abs(this.vel.z)) this.vel.z = realVZ;
    this.pos.x = rx; this.pos.z = -ry;

    // vertical
    const ground = W.h(this.pos.x, this.pos.z);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= ground || (this.grounded && this.pos.y - ground < 0.35 && this.vel.y <= 0)) {
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
    } else this.grounded = false;

    // facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let turn = 0;
    if (hs > 0.2 && wish.lengthSq() > 0) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let diff = want - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      turn = diff;
      this.facing += diff * Math.min(1, dt * 10);
    }
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.facing;
    this.char.update(dt, hs, this.grounded, this.vel.y, turn);
    this.speed = hs;
    this._camera(dt);
  }

  _camera(dt) {
    const target = new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp); // opposite of look dir
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = target.clone().addScaledVector(right, this.shoulder);
    // occlusion
    let want = this.camDist;
    this.ray.set(pivot, back);
    this.ray.far = this.camDist + 0.3;
    const hits = this.ray.intersectObjects(this.occluders, false);
    if (hits.length) want = Math.max(0.5, hits[0].distance - 0.3);
    this.curDist = want < this.curDist ? want : THREE.MathUtils.damp(this.curDist, want, 4, dt);
    const cam = pivot.clone().addScaledVector(back, this.curDist);
    const gh = W.h(cam.x, cam.z) + 0.35;
    if (cam.y < gh) cam.y = gh;
    this.camera.position.copy(cam);
    this.camera.lookAt(pivot.x - back.x, pivot.y - back.y, pivot.z - back.z);
  }
}

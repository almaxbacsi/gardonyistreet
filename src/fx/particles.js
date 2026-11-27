// Pooled CPU particles drawn as one Points object per system (one draw call each).
// Used for grinder sparks, drill dust, and (later) debris, leaves and grass clippings.
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize; attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.2, length(c)) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }`;

export class ParticleSystem {
  /** @param {{max?:number, additive?:boolean}} opt */
  constructor({ max = 600, additive = false } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.base = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.n = 0; this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /**
   * Emit `count` particles at `p` along `dir` with a cone `spread` (0..1).
   * color: THREE.Color (may exceed 1 for HDR glow), size in metres.
   */
  emit(p, dir, { count = 10, speed = 3, spread = 0.4, color = new THREE.Color(1, 1, 1), alpha = 1, size = 0.03, life = 0.6, gravity = -9.8, drag = 0.5, jitter = 0.3 } = {}) {
    const d = dir.clone().normalize();
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spread).add(d).normalize()
        .multiplyScalar(speed * (1 - jitter + Math.random() * jitter * 2));
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      const l = life * (0.6 + Math.random() * 0.8);
      this.life[i] = l; this.life0[i] = l;
      this.base.set([color.r, color.g, color.b, alpha], i * 4);
      this.size0[i] = size * (0.6 + Math.random() * 0.8);
      this.grav[i] = gravity; this.drag[i] = drag;
    }
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.life0[i]);
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt;
      for (let c = 0; c < 3; c++) this.pos[i * 3 + c] += this.vel[i * 3 + c] * dt;
      this.size[i] = this.size0[i] * (0.4 + 0.6 * t);
      for (let c = 0; c < 3; c++) this.col[i * 4 + c] = this.base[i * 4 + c];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * Math.min(1, t * 3);
    }
    this.points.visible = alive > 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}

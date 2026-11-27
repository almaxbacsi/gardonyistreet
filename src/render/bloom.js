// Physically-flavoured bloom + automatic eye adaptation for PostPipeline.
//  Bloom: soft-threshold prefilter, mip chain of 13-tap downsamples (Jimenez, CoD:AW style),
//         3x3 tent upsamples summed back up. Energy-conserving mix in the final pass.
//  Eye adaptation: log-average luminance (64x64 -> 16 -> 4 -> 1) smoothed over time in a 1x1 target;
//         the final pass derives exposure from it, clamped to a range so daylight never "pumps".
import * as THREE from 'three';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPrefilter, uThreshold, uKnee;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  float l(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 kw(vec3 c) { return c / (1.0 + l(c) * 0.25); } // Karis average weight kills fireflies
  void main() {
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), m = s(vec2(-1, -1)), n = s(vec2(1, -1));
    vec3 col;
    if (uPrefilter > 0.5) {
      col = kw((a + b + d + e) * 0.25) * 0.125 + kw((b + c + e + f) * 0.25) * 0.125
          + kw((d + e + g + h) * 0.25) * 0.125 + kw((e + f + h + i) * 0.25) * 0.125
          + kw((j + k + m + n) * 0.25) * 0.5;
      float br = max(col.r, max(col.g, col.b));
      float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      rq = rq * rq / (4.0 * uKnee + 1e-4);
      col *= max(rq, br - uThreshold) / max(br, 1e-4);
    } else {
      col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + m + n) * 0.125;
    }
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }`;

const UP = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uRadius;
  void main() {
    vec2 t = uTexel * uRadius;
    vec3 c = texture2D(tLow, vUv).rgb * 4.0
      + (texture2D(tLow, vUv + vec2(t.x, 0)).rgb + texture2D(tLow, vUv - vec2(t.x, 0)).rgb
       + texture2D(tLow, vUv + vec2(0, t.y)).rgb + texture2D(tLow, vUv - vec2(0, t.y)).rgb) * 2.0
      + texture2D(tLow, vUv + t).rgb + texture2D(tLow, vUv - t).rgb
      + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb;
    gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + c / 16.0, 1.0);
  }`;

const LOGLUM = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSrc;
  void main() {
    // centre-weighted metering (like a camera's), ignores the extreme top of the frame (sky)
    vec3 c = texture2D(tSrc, vUv).rgb;
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 d = (vUv - vec2(0.5, 0.45)) * vec2(1.0, 1.4);
    float w = exp(-dot(d, d) * 3.0);
    gl_FragColor = vec4(log(max(L, 1e-4)) * w, w, 0.0, 1.0);
  }`;

const REDUCE = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSrc; uniform vec2 uTexel;
  void main() {
    vec2 o = uTexel; // four bilinear taps = 16 texels
    vec4 s = texture2D(tSrc, vUv + vec2(-o.x, -o.y)) + texture2D(tSrc, vUv + vec2(o.x, -o.y))
           + texture2D(tSrc, vUv + vec2(-o.x, o.y)) + texture2D(tSrc, vUv + vec2(o.x, o.y));
    gl_FragColor = s * 0.25;
  }`;

const ADAPT = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tCur, tPrev; uniform float uRate, uReset;
  void main() {
    vec4 c = texture2D(tCur, vec2(0.5));
    float cur = c.x / max(c.y, 1e-5);
    float prev = texture2D(tPrev, vec2(0.5)).r;
    float v = uReset > 0.5 ? cur : prev + (cur - prev) * uRate;
    gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
  }`;

export class Bloom {
  constructor({ levels = 6, threshold = 1.1, knee = 0.6, strength = 0.06, radius = 1.0 } = {}) {
    this.levels = levels; this.threshold = threshold; this.knee = knee; this.strength = strength; this.radius = radius;
    this.enabled = true;
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.down = []; this.up = [];
    for (let i = 0; i < levels; i++) {
      this.down.push(new THREE.WebGLRenderTarget(4, 4, opt));
      this.up.push(new THREE.WebGLRenderTarget(4, 4, opt));
    }
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mDown = mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: threshold }, uKnee: { value: knee } });
    this.mUp = mat(UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: radius } });
    this.w = 0; this.h = 0;
  }

  resize(W, H) {
    if (W === this.w && H === this.h) return;
    this.w = W; this.h = H;
    let w = W, h = H;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.down[i].setSize(w, h); this.up[i].setSize(w, h);
    }
  }

  /** returns the bloom texture (same size as the first mip) */
  render(post, src) {
    this.resize(post.W, post.H);
    const d = this.mDown.uniforms;
    let input = src, iw = post.W, ih = post.H;
    d.uThreshold.value = this.threshold; d.uKnee.value = this.knee;
    for (let i = 0; i < this.levels; i++) {
      d.tSrc.value = input; d.uTexel.value.set(1 / iw, 1 / ih); d.uPrefilter.value = i === 0 ? 1 : 0;
      post.pass(this.mDown, this.down[i]);
      input = this.down[i].texture; iw = this.down[i].width; ih = this.down[i].height;
    }
    const u = this.mUp.uniforms;
    u.uRadius.value = this.radius;
    let low = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      u.tLow.value = low.texture; u.tHigh.value = this.down[i].texture;
      u.uTexel.value.set(1 / low.width, 1 / low.height);
      post.pass(this.mUp, this.up[i]);
      low = this.up[i];
    }
    return low.texture;
  }
}

export class EyeAdaptation {
  constructor({ speedUp = 1.6, speedDown = 1.0 } = {}) {
    this.speed = (speedUp + speedDown) / 2;
    this.enabled = true;
    // half float: linear filtering of full float targets is not universally supported
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.lum = new THREE.WebGLRenderTarget(64, 64, opt);
    this.r16 = new THREE.WebGLRenderTarget(16, 16, opt);
    this.r4 = new THREE.WebGLRenderTarget(4, 4, opt);
    this.r1 = new THREE.WebGLRenderTarget(1, 1, opt);
    const nearest = { ...opt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.ad = [new THREE.WebGLRenderTarget(1, 1, nearest), new THREE.WebGLRenderTarget(1, 1, nearest)];
    this.idx = 0; this.reset = true;
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mLog = mat(LOGLUM, { tSrc: { value: null } });
    this.mRed = mat(REDUCE, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mAdapt = mat(ADAPT, { tCur: { value: null }, tPrev: { value: null }, uRate: { value: 0 }, uReset: { value: 1 } });
  }

  /** returns a 1x1 texture whose .r is the adapted log-luminance */
  render(post, src, dt) {
    this.mLog.uniforms.tSrc.value = src;
    post.pass(this.mLog, this.lum);
    let from = this.lum;
    for (const to of [this.r16, this.r4, this.r1]) {
      this.mRed.uniforms.tSrc.value = from.texture;
      this.mRed.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      // two reduction steps of 4x: sample at quarter-texel offsets of the destination
      if (to === this.r1) this.mRed.uniforms.uTexel.value.set(0.25, 0.25);
      post.pass(this.mRed, to);
      from = to;
    }
    const a = this.mAdapt.uniforms;
    const prev = this.ad[this.idx], next = this.ad[1 - this.idx];
    a.tCur.value = this.r1.texture; a.tPrev.value = prev.texture;
    a.uRate.value = 1 - Math.exp(-dt * this.speed);
    a.uReset.value = this.reset ? 1 : 0; this.reset = false;
    post.pass(this.mAdapt, next);
    this.idx = 1 - this.idx;
    return next.texture;
  }
}

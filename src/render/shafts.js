// Screen-space volumetric sun shafts ("god rays").
// 1) occlusion mask at half res: sky pixels (no geometry) near the sun are bright, everything else black;
//    foliage cards and poles therefore cut the light into beams
// 2) three radial blur passes toward the sun's screen position (each pass multiplies the step length)
// 3) result is added in the HDR composite (before tone mapping), tinted by the sun colour
// Plugs into PostPipeline via its `extra` hook.
import * as THREE from 'three';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MASK = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tZ, tColor; uniform vec2 uSun; uniform float uAspect;
  void main() {
    float z = texture2D(tZ, vUv).r;
    float sky = step(5000.0, z);
    vec2 d = vUv - uSun; d.x *= uAspect;
    float glow = exp(-dot(d, d) * 16.0);
    vec3 c = texture2D(tColor, vUv).rgb;
    float bright = clamp(dot(c, vec3(0.3, 0.5, 0.2)) * 0.6, 0.0, 2.0);
    gl_FragColor = vec4(vec3(sky * glow * (0.4 + bright)), 1.0);
  }`;

const RADIAL = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSrc; uniform vec2 uSun; uniform float uStep;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec2 dir = (uSun - vUv) * uStep;
    vec2 uv = vUv + dir * ign(gl_FragCoord.xy);
    vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
    for (int i = 0; i < TAPS; i++) {
      acc += texture2D(tSrc, uv).rgb * w; ws += w;
      w *= 0.94; uv += dir;
    }
    gl_FragColor = vec4(acc / ws, 1.0);
  }`;

const OUT = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tSrc; uniform vec3 uColor; uniform float uIntensity;
  void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uColor * uIntensity, 1.0); }`;

export class SunShafts {
  /** @param {THREE.Vector3} sunDir world-space unit vector toward the sun */
  constructor(sunDir, { taps = 12, intensity = 0.3, color = new THREE.Color(1.0, 0.86, 0.66) } = {}) {
    this.sunDir = sunDir;
    this.enabled = true;
    this.intensity = intensity;
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.a = new THREE.WebGLRenderTarget(4, 4, opt);
    this.b = new THREE.WebGLRenderTarget(4, 4, opt);
    const mat = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
    this.mMask = mat(MASK, { tZ: { value: null }, tColor: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.mRad = mat(RADIAL, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 0 } }, { TAPS: taps });
    this.mOut = mat(OUT, { tSrc: { value: null }, uColor: { value: color }, uIntensity: { value: intensity } });
    this.tmp = new THREE.Vector3();
  }

  setTaps(n) {
    if (this.mRad.defines.TAPS !== n) { this.mRad.defines.TAPS = n; this.mRad.needsUpdate = true; }
  }

  /** returns a texture for PostPipeline's composite (rgb added, a = 1) or null when the sun is off screen */
  render(post) {
    if (!this.enabled) return null;
    const cam = post.camera;
    const p = this.tmp.copy(this.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
    // facing: dot of view dir with sun dir
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const facing = fwd.dot(this.sunDir);
    if (facing < 0.05) return null;
    const sx = p.x * 0.5 + 0.5, sy = p.y * 0.5 + 0.5;
    // fade as the sun leaves the frame
    const off = Math.max(0, Math.abs(p.x) - 1, Math.abs(p.y) - 1);
    const fade = THREE.MathUtils.clamp(1 - off / 0.8, 0, 1) * THREE.MathUtils.smoothstep(facing, 0.05, 0.45);
    if (fade <= 0) return null;
    const w = post.rt.z.width, h = post.rt.z.height;
    if (this.a.width !== w || this.a.height !== h) { this.a.setSize(w, h); this.b.setSize(w, h); }
    this.mMask.uniforms.tZ.value = post.rt.z.texture;
    this.mMask.uniforms.tColor.value = post.rt.scene.texture;
    this.mMask.uniforms.uSun.value.set(sx, sy);
    this.mMask.uniforms.uAspect.value = cam.aspect;
    post.pass(this.mMask, this.a);
    let src = this.a, dst = this.b;
    for (const step of [0.035, 0.012, 0.004]) {
      this.mRad.uniforms.tSrc.value = src.texture;
      this.mRad.uniforms.uSun.value.set(sx, sy);
      this.mRad.uniforms.uStep.value = step * (12 / this.mRad.defines.TAPS) * 2.2;
      post.pass(this.mRad, dst);
      [src, dst] = [dst, src];
    }
    this.mOut.uniforms.tSrc.value = src.texture;
    this.mOut.uniforms.uIntensity.value = this.intensity * fade;
    post.pass(this.mOut, dst);
    return dst.texture;
  }
}

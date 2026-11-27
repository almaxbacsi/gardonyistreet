// Post-processing pipeline (custom, no EffectComposer):
//   scene (HDR, MSAA, depth texture)
//   -> linear depth at half resolution
//   -> screen-space ambient occlusion (half res) + depth-aware blur
//   -> composite (AO on ambient-ish light) -> final (tone map + grade) -> screen
// Later stages (shafts, bloom, adaptation) plug in between composite and final.
import * as THREE from 'three';

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */`
  varying vec2 vUv;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

function fsTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

const LINEAR_DEPTH = /* glsl */`${COMMON}
  uniform sampler2D tDepth; uniform float uNear, uFar;
  void main() {
    // exact texel fetch at 2x2 block corner keeps edges crisp
    ivec2 p = min(ivec2(gl_FragCoord.xy) * 2, textureSize(tDepth, 0) - 1);
    float d = texelFetch(tDepth, p, 0).r;
    float z = d >= 0.99999 ? 1e5 : (uNear * uFar) / (uFar - d * (uFar - uNear));
    gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
  }`;

const AO = /* glsl */`${COMMON}
  uniform sampler2D tZ; uniform vec2 uTanHalf, uTexel; uniform float uRadius, uIntensity, uAspect;
  vec3 vpos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
  void main() {
    float z0 = texture2D(tZ, vUv).r;
    if (z0 > 120.0) { gl_FragColor = vec4(1.0); return; }
    vec3 P = vpos(vUv, z0);
    vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
    float zl = texture2D(tZ, vUv - ox).r, zr = texture2D(tZ, vUv + ox).r;
    float zd = texture2D(tZ, vUv - oy).r, zu = texture2D(tZ, vUv + oy).r;
    vec3 dx = abs(zl - z0) < abs(zr - z0) ? P - vpos(vUv - ox, zl) : vpos(vUv + ox, zr) - P;
    vec3 dy = abs(zd - z0) < abs(zu - z0) ? P - vpos(vUv - oy, zd) : vpos(vUv + oy, zu) - P;
    vec3 n = normalize(cross(dx, dy));
    float R = uRadius * (0.55 + 0.45 * clamp(z0 / 10.0, 0.0, 1.0));
    float rUv = clamp(R / (2.0 * z0 * uTanHalf.y), 2.5 * uTexel.y, 0.15);
    float R2 = R * R;
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    float sum = 0.0;
    for (int i = 0; i < AO_TAPS; i++) {
      float a = (float(i) + 0.5) / float(AO_TAPS);
      float th = a * 6.2831853 * 2.618 + rot;
      vec2 o = vec2(cos(th), sin(th)) * a * rUv; o.x /= uAspect;
      vec2 uv2 = vUv + o;
      float z2 = texture2D(tZ, uv2).r;
      vec3 v = vpos(uv2, z2) - P;
      float vv = dot(v, v), vn = dot(v, n);
      float f = max(R2 - vv, 0.0);
      sum += f * f * f * max((vn - (0.012 + 0.003 * z0)) / (vv + 0.003), 0.0);
    }
    float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (R2 * R2 * R2 * float(AO_TAPS)));
    ao = mix(ao, 1.0, smoothstep(60.0, 120.0, z0));
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }`;

const BLUR = /* glsl */`${COMMON}
  uniform sampler2D tSrc, tZ; uniform vec2 uDir;
  void main() {
    float z0 = texture2D(tZ, vUv).r;
    vec4 acc = vec4(0.0); float ws = 0.0;
    for (int i = -3; i <= 3; i++) {
      vec2 uv = vUv + uDir * float(i);
      float z = texture2D(tZ, uv).r;
      float w = (1.0 - abs(float(i)) * 0.2) * max(0.0, 1.0 - abs(z - z0) / (BLUR_TOL * z0 + 0.02));
      acc += texture2D(tSrc, uv) * w; ws += w;
    }
    gl_FragColor = ws > 1e-4 ? acc / ws : texture2D(tSrc, vUv);
  }`;

// HDR composite: AO darkens mostly the ambient part (bright, sunlit pixels keep most of their light)
const COMPOSITE = /* glsl */`${COMMON}
  uniform sampler2D tColor, tAO, tZ, tExtra; uniform vec2 uHalfRes; uniform float uAoOn, uAoStrength, uExtraOn;
  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    if (uAoOn > 0.5) {
      float z = texture2D(tZ, vUv).r;
      // joint bilateral upsample of the half-res AO
      vec2 hp = vUv * uHalfRes - 0.5, f = fract(hp), base = (floor(hp) + 0.5) / uHalfRes, tx = 1.0 / uHalfRes;
      float ao = 0.0, ws = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = vec2(float(k & 1), float(k >> 1));
        vec2 uv = base + o * tx;
        float zh = texture2D(tZ, uv).r;
        float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
        w = max(w / (0.02 + abs(zh - z) / max(z, 0.1)), 1e-5);
        ao += texture2D(tAO, uv).r * w; ws += w;
      }
      ao /= ws;
      float lit = smoothstep(0.35, 2.2, luma(col));
      col *= mix(1.0, ao, uAoStrength * (1.0 - 0.75 * lit));
    }
    if (uExtraOn > 0.5) { vec4 e = texture2D(tExtra, vUv); col = col * e.a + e.rgb; }
    gl_FragColor = vec4(col, 1.0);
  }`;

// Final: exposure, ACES filmic tone mapping, warm "late afternoon" grade, vignette, sRGB, dither
const FINAL = /* glsl */`${COMMON}
  uniform sampler2D tSrc; uniform float uExposure, uGrade, uSat, uVig;
  vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 aces(vec3 c) {
    const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
  void main() {
    vec3 col = texture2D(tSrc, vUv).rgb * uExposure;
    col = aces(col);
    if (uGrade > 0.5) {
      float l = luma(col);
      col *= mix(vec3(0.86, 1.0, 1.08), vec3(1.06, 1.0, 0.91), smoothstep(0.03, 0.55, l)); // teal shadows, warm highlights
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);                                  // gentle S-curve
      col = col * 0.99 + vec3(0.005, 0.007, 0.009);                                          // lifted blacks
      l = luma(col);
      col = mix(vec3(l), col, uSat);
      vec2 c = vUv - 0.5;
      col *= 1.0 - uVig * smoothstep(0.1, 0.75, dot(c, c) * 1.6);
    }
    col = toSRGB(clamp(col, 0.0, 1.0));
    col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }`;

export class PostPipeline {
  constructor(renderer, scene, camera, settings) {
    this.r = renderer; this.scene = scene; this.camera = camera;
    this.s = settings; // { msaa, ao, aoTaps, renderScale }
    this.quad = new THREE.Mesh(fsTriangle(), null);
    this.quad.frustumCulled = false;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.grade = true;
    const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rt = {
      scene: this.makeSceneRT(),
      z: new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
      aoA: new THREE.WebGLRenderTarget(4, 4, { ...half, type: THREE.UnsignedByteType }),
      aoB: new THREE.WebGLRenderTarget(4, 4, { ...half, type: THREE.UnsignedByteType }),
      comp: new THREE.WebGLRenderTarget(4, 4, { ...half, depthBuffer: false }),
    };
    const mat = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.m = {
      z: mat(LINEAR_DEPTH, { tDepth: { value: null }, uNear: { value: camera.near }, uFar: { value: camera.far } }),
      ao: mat(AO, { tZ: { value: this.rt.z.texture }, uTanHalf: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.9 }, uIntensity: { value: 1.5 }, uAspect: { value: 1 } }, { AO_TAPS: settings.aoTaps ?? 12 }),
      blur: mat(BLUR, { tSrc: { value: null }, tZ: { value: this.rt.z.texture }, uDir: { value: new THREE.Vector2() } }, { BLUR_TOL: '0.05' }),
      comp: mat(COMPOSITE, { tColor: { value: null }, tAO: { value: this.rt.aoA.texture }, tZ: { value: this.rt.z.texture }, tExtra: { value: null }, uHalfRes: { value: new THREE.Vector2() }, uAoOn: { value: 1 }, uAoStrength: { value: 0.9 }, uExtraOn: { value: 0 } }),
      final: mat(FINAL, { tSrc: { value: this.rt.comp.texture }, uExposure: { value: 0.95 }, uGrade: { value: 1 }, uSat: { value: 1.1 }, uVig: { value: 0.3 } }),
    };
    this.setSize(innerWidth, innerHeight);
  }

  makeSceneRT() {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.s.msaa ?? 4 });
    rt.depthTexture = new THREE.DepthTexture(4, 4);
    rt.depthTexture.type = THREE.UnsignedIntType;
    return rt;
  }

  setSize(w, h) {
    const pr = this.r.getPixelRatio() * (this.s.renderScale ?? 1);
    const W = Math.max(2, Math.floor(w * pr)), H = Math.max(2, Math.floor(h * pr));
    this.W = W; this.H = H;
    this.rt.scene.setSize(W, H);
    this.rt.comp.setSize(W, H);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    for (const k of ['z', 'aoA', 'aoB']) this.rt[k].setSize(hw, hh);
    this.m.ao.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.m.comp.uniforms.uHalfRes.value.set(hw, hh);
  }

  pass(material, target) {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.quad, this.ortho);
  }

  /** hook for extra passes (shafts etc.): fn(pipeline) -> texture with rgb add + a transmittance */
  render() {
    const r = this.r, cam = this.camera, s = this.s;
    r.setRenderTarget(this.rt.scene);
    r.render(this.scene, cam);
    const aoOn = s.ao !== false;
    if (aoOn || this.extra) {
      this.m.z.uniforms.tDepth.value = this.rt.scene.depthTexture;
      this.m.z.uniforms.uNear.value = cam.near; this.m.z.uniforms.uFar.value = cam.far;
      this.pass(this.m.z, this.rt.z);
    }
    if (aoOn) {
      const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      this.m.ao.uniforms.uTanHalf.value.set(th * cam.aspect, th);
      this.m.ao.uniforms.uAspect.value = cam.aspect;
      this.pass(this.m.ao, this.rt.aoA);
      const t = this.m.ao.uniforms.uTexel.value;
      this.m.blur.uniforms.tSrc.value = this.rt.aoA.texture; this.m.blur.uniforms.uDir.value.set(t.x, 0);
      this.pass(this.m.blur, this.rt.aoB);
      this.m.blur.uniforms.tSrc.value = this.rt.aoB.texture; this.m.blur.uniforms.uDir.value.set(0, t.y);
      this.pass(this.m.blur, this.rt.aoA);
    }
    const extraTex = this.extra ? this.extra(this) : null;
    const c = this.m.comp.uniforms;
    c.tColor.value = this.rt.scene.texture; c.uAoOn.value = aoOn ? 1 : 0;
    c.tExtra.value = extraTex; c.uExtraOn.value = extraTex ? 1 : 0;
    this.pass(this.m.comp, this.rt.comp);
    this.m.final.uniforms.uGrade.value = this.grade ? 1 : 0;
    this.finalSource = this.rt.comp.texture;
    if (this.beforeFinal) this.finalSource = this.beforeFinal(this, this.rt.comp.texture);
    this.m.final.uniforms.tSrc.value = this.finalSource;
    this.pass(this.m.final, null);
  }
}

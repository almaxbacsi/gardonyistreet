// Dynamic sky: analytic atmosphere + drifting fbm cumulus layer, rendered on a camera-centred dome.
// The same sky (plus a dark ground hemisphere for bounce light) is rendered into a small cube map every
// few seconds and prefiltered (PMREM) into scene.environment, so image-based lighting and reflections
// follow the clouds. Hemisphere light colours are taken from the sky model too.
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }`;

const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uSun, uSunColor, uZenith, uHorizon, uGround, uHaze;
  uniform float uTime, uCover, uCloudOn, uSunDisk;
  uniform vec2 uWind;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < CLOUD_OCT; i++) { s += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  float density(vec2 p) {
    // large-scale coverage field breaks the layer into separate cumulus groups
    float base = fbm(p * 0.3 + uWind * 0.2);
    float d = fbm(p + uWind);
    float n = d * 0.7 + base * 0.5;
    return smoothstep(1.0 - uCover, 1.0 - uCover + 0.2, n);
  }

  vec3 atmosphere(vec3 v) {
    float y = max(v.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(y, 0.45));
    float mu = dot(v, uSun);
    col += uSunColor * (0.10 * pow(max(mu, 0.0), 6.0) + 0.35 * pow(max(mu, 0.0), 60.0)); // mie halo
    col *= 1.0 + 0.12 * (1.0 - y);                                                         // brighter horizon band
    return col;
  }

  void main() {
    vec3 v = normalize(vDir);
    vec3 col;
    if (v.y < -0.02) {
      // below the horizon: distant haze (matches the scene fog) fading to ground bounce
      col = mix(uHaze, uGround, smoothstep(-0.05, -0.7, v.y));
    } else {
      col = atmosphere(v);
      float mu = dot(v, uSun);
      col += uSunColor * uSunDisk * smoothstep(0.99955, 0.99975, mu) * 60.0;
      if (uCloudOn > 0.5 && v.y > 0.0) {
        // project onto a cloud plane; distance scales the uv so clouds shrink toward the horizon
        vec2 p = v.xz / (v.y + 0.08) * 1.6;
        float d = density(p);
        if (d > 0.0) {
          // two light-ward samples approximate self-shadowing; forward scattering gives silver linings
          vec2 ls = normalize(uSun.xz + 1e-4) * 0.12;
          float d1 = density(p + ls), d2 = density(p + ls * 2.5);
          float shade = exp(-(d1 + d2 * 0.7) * 1.4);
          float fwd = pow(max(mu, 0.0), 10.0);
          vec3 lit = uSunColor * (0.95 + 0.8 * fwd * (1.0 - d)) + uZenith * 0.35;
          vec3 dark = uHorizon * 0.62 + uZenith * 0.12;
          vec3 cc = mix(dark, lit, shade * (0.55 + 0.45 * (1.0 - d)));
          float a = d * smoothstep(0.0, 0.1, v.y) * 0.95;
          col = mix(col, cc, a);
        }
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class DynamicSky {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Vector3} sunDir unit vector toward the sun
   */
  constructor(renderer, sunDir, { cloudOctaves = 5, envSize = 64, envInterval = 4, cover = 0.38 } = {}) {
    this.renderer = renderer;
    this.sunDir = sunDir;
    this.envInterval = envInterval;
    this.uniforms = {
      uSun: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(1.0, 0.9, 0.75).multiplyScalar(1.6) },
      uZenith: { value: new THREE.Color(0.16, 0.34, 0.78) },
      uHorizon: { value: new THREE.Color(0.62, 0.72, 0.84) },
      uGround: { value: new THREE.Color(0.20, 0.19, 0.12) },
      uHaze: { value: new THREE.Color(0xc4c3b4) },
      uTime: { value: 0 }, uCover: { value: cover }, uCloudOn: { value: 1 }, uSunDisk: { value: 1 },
      uWind: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms,
      defines: { CLOUD_OCT: cloudOctaves }, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';

    // environment capture: same sky without the sun disk (it would add a hot spot to every reflection)
    const envMat = mat.clone();
    envMat.defines = { CLOUD_OCT: 3 };
    envMat.uniforms = { ...this.uniforms, uSunDisk: { value: 0 } };
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
    this.cubeRT = new THREE.WebGLCubeRenderTarget(envSize, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(0.1, 100, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmremRT = null;
    this.sinceEnv = Infinity;
    this.wind = new THREE.Vector2(0.006, 0.0025); // cloud-plane units per second
  }

  /** colours for a hemisphere light, derived from the sky model */
  hemiColors() {
    const u = this.uniforms;
    const sky = u.uZenith.value.clone().lerp(u.uHorizon.value, 0.35);
    const m = Math.max(sky.r, sky.g, sky.b);
    return { sky: sky.multiplyScalar(1 / m), ground: new THREE.Color(0.36, 0.34, 0.22) };
  }

  updateEnvironment(scene) {
    this.cubeCam.update(this.renderer, this.envScene);
    this.pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.pmremRT);
    scene.environment = this.pmremRT.texture;
  }

  update(dt, camera, scene) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uWind.value.addScaledVector(this.wind, dt);
    u.uSun.value.copy(this.sunDir);
    this.mesh.position.copy(camera.position);
    this.sinceEnv += dt;
    if (this.sinceEnv >= this.envInterval) { this.sinceEnv = 0; this.updateEnvironment(scene); }
  }
}

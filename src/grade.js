// Colour grade applied after tone mapping (display space):
// warm hazy highlights, slightly cool shadows, a touch more saturation and a soft vignette –
// the late-afternoon smog look San Andreas is known for, kept subtle.
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.12 },
    uLift: { value: [0.02, 0.018, 0.01] },
    uGain: { value: [1.03, 1.0, 0.93] },
    uGamma: { value: 1.03 },
    uVig: { value: 0.32 },
    uHaze: { value: [0.93, 0.86, 0.72] },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSat, uGamma, uVig;
    uniform vec3 uLift, uGain, uHaze;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col = uGain * col + uLift * (1.0 - col);
      col = pow(max(col, 0.0), vec3(1.0 / uGamma));
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      // split toning
      col += vec3(0.03, 0.012, -0.03) * smoothstep(0.45, 1.0, l);
      col += vec3(-0.012, 0.004, 0.018) * (1.0 - smoothstep(0.0, 0.35, l));
      // haze towards the top of the frame (sky / distance)
      col = mix(col, uHaze * max(l, 0.75), 0.06 * smoothstep(0.4, 1.0, vUv.y));
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVig * dot(d, d) * 1.8;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

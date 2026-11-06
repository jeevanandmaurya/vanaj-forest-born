// Screen-space light shafts: radial blur of the bright sky seen through gaps in the canopy, marched toward the
// sun's screen position. Runs on the HDR scene colour before bloom and grading.
import * as THREE from 'three';

export const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 },
    uThreshold: { value: 1 }, uAspect: { value: 1 }, uTint: { value: new THREE.Color(1, 0.9, 0.75) }, uDensity: { value: 0.9 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    #ifndef GR_SAMPLES
    #define GR_SAMPLES 28
    #endif
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength, uThreshold, uAspect, uDensity; uniform vec3 uTint;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // This pass runs just before bloom, so it also cleans the image: a single NaN or infinite pixel from any
    // shader would otherwise be blurred by the bloom across the whole screen and flash the frame black.
    vec3 clean(vec3 c){ return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(1e4)); }
    void main(){
      vec4 base = vec4(clean(texture2D(tDiffuse, vUv).rgb), 1.0);
      if (uStrength < 0.002) { gl_FragColor = base; return; }
      vec2 delta = (vUv - uSun) * (uDensity / float(GR_SAMPLES));
      vec2 uv = vUv - delta * h(vUv * 917.0);                // jitter hides banding
      float illum = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < GR_SAMPLES; i++) {
        uv -= delta;
        vec3 s = clean(texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb);
        float l = dot(s, vec3(0.3, 0.59, 0.11));
        acc += s * smoothstep(uThreshold, uThreshold * 2.2, l) * illum;
        illum *= 0.955;
      }
      acc /= float(GR_SAMPLES);
      float dist = length((vUv - uSun) * vec2(uAspect, 1.0));
      acc *= exp(-dist * 1.4);
      gl_FragColor = vec4(base.rgb + acc * uStrength * uTint, base.a);
    }`,
};

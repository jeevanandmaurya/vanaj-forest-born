// Global shader uniforms, atmospheric height fog with sun in-scattering, and material patch helpers.
import * as THREE from 'three';

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  uSunVis: { value: 1 },
  uFogColor: { value: new THREE.Color(0.6, 0.65, 0.7) },
  uFogSun: { value: new THREE.Color(1.0, 0.8, 0.6) },
  uFogDensity: { value: 0.0009 },
  uFogHeight: { value: 0.02 },
  uFogBase: { value: 20 },
  uWind: { value: new THREE.Vector2(1, 0.3).normalize() },
  uWindStrength: { value: 0.4 },
  uWetness: { value: 0 },
  uPlayerPos: { value: new THREE.Vector3() },
  uFlash: { value: 0 },
  uSeasonGreen: { value: 0.5 }, // 0 = dry gold, 1 = lush green
  uWaterRise: { value: 0 },
  uDry: { value: 0.3 },        // 0 = wet season, 1 = peak dry summer (litter bleach, burn scars, cracked soil)
  tGroundAO: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })() },
  uAORect: { value: new THREE.Vector4(0, 0, 0, 0) }, // x0, z0, 1/size, enabled
  // a limb bending under Vanaj's weight (js/actors/canopy.js): the tree (its origin's x, z), the limb's base and the
  // load point in world space, the droop at the load point (m) and how far round the limb the bend reaches
  uBendTree: { value: new THREE.Vector2(1e9, 1e9) },
  uBendB: { value: new THREE.Vector3() },
  uBendP: { value: new THREE.Vector3(0, 1, 0) },
  uBendAmt: { value: 0 },
  uBendR: { value: 2.5 },
};
G.uSunDirF = G.uSunDir;

THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
varying vec3 vWorldPosA;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vec4 wpA = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wpA = instanceMatrix * wpA;
  #endif
  vWorldPosA = (modelMatrix * wpA).xyz;
#endif`;

export const ATMOS_GLSL = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uFogSun;
uniform vec3 uSunDirF;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogBase;
vec3 applyAtmos(vec3 col, vec3 wp) {
  vec3 ray = wp - cameraPosition;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-3);
  float y0 = cameraPosition.y - uFogBase;
  float hd = uFogHeight * dir.y * dist;
  float k = abs(hd) > 1e-4 ? (1.0 - exp(-hd)) / hd : 1.0;
  float integ = uFogDensity * exp(clamp(-uFogHeight * y0, -20.0, 4.0)) * dist * k;
  float f = 1.0 - exp(-max(integ, 0.0));
  float s = pow(max(dot(dir, uSunDirF), 0.0), 6.0);
  vec3 fc = mix(uFogColor, uFogSun, s);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}`;

THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
varying vec3 vWorldPosA;
${ATMOS_GLSL}
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWorldPosA);
#endif`;

export function addGlobals(shader) {
  for (const k in G) shader.uniforms[k] = G[k];
}

// Default: every material gets the global uniforms unless it sets its own onBeforeCompile.
THREE.Material.prototype.onBeforeCompile = function (shader) { addGlobals(shader); };

let keyCounter = 0;
export function patch(mat, key, fn) {
  mat.onBeforeCompile = (shader, r) => { addGlobals(shader); fn && fn(shader, r); };
  const k = key || ('m' + (keyCounter++));
  mat.customProgramCacheKey = () => k;
  return mat;
}

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise3(p); p=p*2.02+vec3(3.1,1.7,5.3); a*=0.5;} return s; }
vec2 cell3(vec3 p){ // returns (F1, F2) distances, cellular noise
  vec3 i=floor(p), f=fract(p); float d1=8.0, d2=8.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g=vec3(float(x),float(y),float(z));
    vec3 o=vec3(hash13(i+g), hash13(i+g+19.1), hash13(i+g+47.7));
    vec3 r=g+o-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
  }
  return vec2(sqrt(d1), sqrt(d2));
}
`;

// Wind displacement for foliage (expects attributes aWind, aRand in geometry)
export const WIND_VERTEX = /* glsl */`
#ifdef USE_INSTANCING
  mat4 wM = instanceMatrix;
#else
  mat4 wM = modelMatrix;
#endif
  vec3 iPos = vec3(wM[3][0], wM[3][1], wM[3][2]);
  vec3 wc0 = normalize(vec3(wM[0][0], wM[0][1], wM[0][2]));
  vec3 wc2 = normalize(vec3(wM[2][0], wM[2][1], wM[2][2]));
  vec3 w3 = vec3(uWind.x, 0.0, uWind.y);
  vec2 lw = vec2(dot(w3, wc0), dot(w3, wc2));
  float wPh = uTime * 1.1 + dot(iPos.xz, vec2(0.061, 0.047));
  float gust = 0.55 + 0.45 * sin(uTime * 0.31 + iPos.x * 0.004) * sin(uTime * 0.17 + iPos.z * 0.005);
  float sway = (sin(wPh) * 0.65 + sin(wPh * 2.37 + 1.7) * 0.35) * uWindStrength * gust;
  // leaf flutter: slow and small. Fast, large flutter made leaf edges flick on and off against the sky
  // every frame (alpha-tested cards), which read as shimmering; the sway above still moves whole branches.
  float flut = sin(uTime * (2.6 + aRand * 1.8) + position.x * 1.3 + position.y * 1.1 + aRand * 40.0) * (0.008 + 0.03 * uWindStrength);
  transformed.x += (lw.x * sway * 0.5 + flut) * aWind;
  transformed.z += (lw.y * sway * 0.5 + flut * 0.7) * aWind;
  transformed.y += flut * 0.4 * aWind;
`;
// The limb Vanaj hangs from or stands on sags under him like a loaded cantilever: nothing at the base, the most
// at the load point (the curve of a beam with a load at its end, x^2 (3L - x)), carried on straight beyond it,
// fading off to the sides so only that limb, its twigs and its leaves move. Only the vertices of the one tree
// (matched by its origin) pay for it. Needs BEND_DECL, and runs after WIND_VERTEX (wM, iPos).
export const BEND_DECL = 'uniform vec2 uBendTree; uniform vec3 uBendB; uniform vec3 uBendP; uniform float uBendAmt; uniform float uBendR;';
export const BEND_VERTEX = /* glsl */`
  if (abs(uBendAmt) > 0.0005 && distance(iPos.xz, uBendTree) < 0.25) {
    vec3 bw = (wM * vec4(transformed, 1.0)).xyz, ax = uBendP - uBendB;
    float bt = max(0.0, dot(bw - uBendB, ax) / max(dot(ax, ax), 0.01));
    float bf = bt < 1.0 ? bt * bt * (3.0 - bt) * 0.5 : 1.0 + 1.5 * (bt - 1.0);
    float lat = length(bw - (uBendB + ax * min(bt, 1.8)));
    float bd = uBendAmt * min(bf, 2.2) * exp(-lat * lat / (uBendR * uBendR));
    transformed += inverse(mat3(wM)) * vec3(0.0, -bd, 0.0);
  }
`;

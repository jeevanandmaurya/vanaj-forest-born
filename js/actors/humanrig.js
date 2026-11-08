// Skinned human for the player and villagers: Quaternius' CC0 mannequin and its Universal Animation Library
// clips (idle, walk, jog, sprint, crouch, jump, punch, death), cross-faded by speed and state. Actions the
// clips don't cover (bow draw, spear throw, club swing, gathering, flute) aim the arm bones in world space on
// top of the clip, so they work whatever the bones' local axes are. Clothing and hair ride on the bones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch, NOISE_GLSL } from '../core/shaderlib.js';
import { sculptBody, eyeMesh } from './sculpt.js';
import { PAINTED } from '../core/palette.js';
import { toon } from '../core/toon.js';

const T = { ready: false };
export function humanRigReady() { return T.ready; }
export async function loadHumanRig(base = 'assets/models/') {
  const L = new GLTFLoader();
  const load = (f) => new Promise((res) => L.load(base + f, res, undefined, (e) => { console.warn('human rig', e); res(null); }));
  const [m, a] = await Promise.all([load('mannequin.glb'), load('moves.glb')]);
  if (!m || !a) return;
  m.scene.updateMatrixWorld(true);
  T.scene = m.scene; T.clips = a.animations; T.box = new THREE.Box3().setFromObject(m.scene); T.ready = true;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _d2 = new THREE.Vector3();

// Per-vertex body regions from the skin weights, for the skin shader: x hands, y feet and shins, z head,
// w forearms. Computed once per geometry (villagers share one).
function regions(o) {
  const g = o.geometry; if (g.attributes.aReg) return;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = SI.count, out = new Float32Array(n * 4);
  const w4 = o.skeleton.bones.map((b) => {
    const nm = b.name;
    if (/^DEF-(hand|f_|thumb)/.test(nm)) return [1, 0, 0, 0.6];
    if (/^DEF-(foot|toe)/.test(nm)) return [0, 1, 0, 0];
    if (/^DEF-shin/.test(nm)) return [0, 0.6, 0, 0];
    if (nm === 'DEF-head') return [0, 0, 1, 0];
    if (nm === 'DEF-neck') return [0, 0, 0.4, 0];
    if (/^DEF-forearm/.test(nm)) return [0, 0, 0, 1];
    if (/^DEF-upper_arm/.test(nm)) return [0, 0, 0, 0.35];
    return [0, 0, 0, 0];
  });
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w <= 0) continue; const r = w4[SI.getComponent(i, k)]; for (let c = 0; c < 4; c++) out[i * 4 + c] += r[c] * w; }
  g.setAttribute('aReg', new THREE.BufferAttribute(out, 4));
}

// Skin. Uneven, sun-darkened tone with broad blotches and fine mottling; pores and fine creases as a normal
// perturbation up close; and for someone who lives outdoors (o.dirt, o.scars): grimy hands, dust and dried mud
// caked on the feet and splashed up the shins, and old pale scratch scars on the forearms, shins and back.
function skinMat(color, key, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 });
  const uDirt = { value: o.dirt || 0 }, uScars = { value: o.scars || 0 }, uFace = { value: o.face ? 1 : 0 }, uFaceO = { value: o.face ? o.face.clone() : new THREE.Vector3() };
  patch(m, 'hskin-' + key, (s) => {
    s.uniforms.uDirt = uDirt; s.uniforms.uScars = uScars; s.uniforms.uFace = uFace; s.uniforms.uFaceO = uFaceO;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute vec4 aReg; varying float vBY; varying vec3 vBP; varying vec4 vReg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBY = position.y; vBP = position; vReg = aReg;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        varying float vBY; varying vec3 vBP; varying vec4 vReg; uniform float uDirt, uScars, uWetness, uFace; uniform vec3 uFaceO;
        ${NOISE_GLSL}
        float scratches(vec3 p) {
          float s = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            vec3 d = normalize(vec3(sin(fi * 2.4 + 0.3), cos(fi * 1.7 + 1.1) * 0.6, cos(fi * 2.4 + 0.3)));
            float u = dot(p, d) * (9.0 + fi * 4.0) + vnoise3(p * 7.0 + fi) * 1.6;
            float line = 1.0 - smoothstep(0.0, 0.03, abs(fract(u) - 0.5));
            s = max(s, line * smoothstep(0.64, 0.8, vnoise3(p * vec3(5.0, 2.0, 5.0) + fi * 13.0)));
          }
          return s;
        }
        vec3 perturbSkin(vec3 sp, vec3 sn, vec2 dH, float fd) {
          // some pixels (silhouette edges, helper lanes) have no screen-space slope: normalising it gives NaN,
          // and one NaN pixel turns the whole frame black through the bloom, so keep the plain normal there
          vec3 dx = dFdx(sp), dy = dFdy(sp);
          if (dot(dx, dx) < 1e-16 || dot(dy, dy) < 1e-16) return sn;
          vec3 sx = normalize(dx), sy = normalize(dy), r1 = cross(sy, sn), r2 = cross(sn, sx);
          float det = dot(sx, r1) * fd;
          vec3 n = abs(det) * sn - sign(det) * (dH.x * r1 + dH.y * r2);
          return dot(n, n) > 1e-12 ? normalize(n) : sn;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tn = vnoise3(vBP * 6.0), tf = vnoise3(vBP * 31.0 + 4.0);
        diffuseColor.rgb *= mix(0.86, 1.08, tn) * mix(0.95, 1.04, tf);
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), diffuseColor.rgb, 0.85);
        // scars only show close up (thin lines alias into bright specks further away), and only faintly
        float sc = scratches(vBP) * uScars * clamp(vReg.w + vReg.y * 0.8 + 0.25 - vReg.z, 0.0, 1.0) * (1.0 - smoothstep(1.2, 2.6, length(vViewPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.16, 1.12), sc * 0.55);
        float mn = vnoise3(vBP * vec3(16.0, 7.0, 16.0));
        float mud = smoothstep(0.3, 0.75, vReg.y * 0.95 + (mn - 0.5) * 0.7 - max(vBY - 0.12, 0.0) * 0.9) * uDirt;
        diffuseColor.rgb *= mix(1.0, 0.7, clamp(vReg.x * (0.6 + 0.6 * mn), 0.0, 1.0) * uDirt);
        // (linear colours: dried mud ~ sRGB 118,96,74, wet mud much darker)
        vec3 mudC = mix(vec3(0.18, 0.115, 0.07), vec3(0.06, 0.04, 0.025), uWetness) * (0.8 + 0.4 * mn);
        diffuseColor.rgb = mix(diffuseColor.rgb, mudC, mud * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.15, 0.1), uDirt * 0.08 * (1.0 - uWetness));
        if (uFace > 0.5) {
          // on a sculpted head: eyebrows of short dark hairs along the brow, lips a shade darker and warmer,
          // the eyelid creases and the corners of the mouth in faint shadow
          vec3 q = vBP - uFaceO; float ax = abs(q.x);
          float by = 0.0185 + 0.0035 * sin(clamp((ax - 0.012) / 0.038, 0.0, 1.0) * 3.1416) - (ax - 0.012) * 0.06;
          // a boy's brows: thick at the inner end, thinning to nothing at the outer, sparse and soft-edged
          float bw = mix(0.0032, 0.0012, smoothstep(0.014, 0.05, ax));
          float brow = smoothstep(0.01, 0.015, ax) * (1.0 - smoothstep(0.042, 0.052, ax)) * (1.0 - smoothstep(bw * 0.4, bw, abs(q.y - by))) * step(0.07, q.z);
          brow *= 0.35 + 0.65 * smoothstep(0.35, 0.75, vnoise(vec2(ax * 1800.0 + q.y * 400.0, q.y * 150.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.008, 0.006), brow * 0.75);
          float lip = (1.0 - smoothstep(0.016, 0.023, ax)) * (1.0 - smoothstep(0.007, 0.011, abs(q.y + 0.074))) * step(0.088, q.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.56, 0.54), lip * 0.75);
          float mouth = (1.0 - smoothstep(0.016, 0.021, ax)) * (1.0 - smoothstep(0.0006, 0.0016, abs(q.y + 0.0738))) * step(0.09, q.z);
          diffuseColor.rgb *= 1.0 - mouth * 0.6;
          float lidC =(1.0 - smoothstep(0.0, 0.0022, abs(q.y - 0.0085 - (ax - 0.031) * (ax - 0.031) * -6.0))) * (1.0 - smoothstep(0.012, 0.018, abs(ax - 0.031))) * step(0.08, q.z);
          diffuseColor.rgb *= 1.0 - lidC * 0.35;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * mix(1.0, 1.5, mud) * mix(1.0, 0.6, uWetness);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float k = 1.0 - smoothstep(1.2, 5.0, length(vViewPosition));
          if (k > 0.0) {
            // soft, low-frequency only: fine noise here aliases into white specular sparkles
            float hb = vnoise3(vBP * 33.0) * 0.6 + mud * vnoise3(vBP * 45.0) * 0.8;
            normal = perturbSkin(-vViewPosition, normal, clamp(vec2(dFdx(hb), dFdy(hb)), -0.05, 0.05) * 0.18 * k, faceDirection);
          } }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // cheap subsurface: warm light bleeding into the shadow side
        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.16, 0.05, 0.03) * (1.0 - saturate(dot(normal, normalize(vec3(0.0, 1.0, 0.0))) * 0.5 + 0.5));`);
  });
  return m;
}

// ------------------------------------------------------------------------------------------- Vanaj at fifteen
// The mannequin's skeleton is a grown man's. These rescale the bones for a thin boy of fifteen, about 1.6 m and
// six and a half heads tall: shoulders and hips closer in, shorter arms (a span about equal to his height), a
// slightly shorter trunk. The clips were made for the long bones and write their local offsets every frame, so the
// same factors are applied on top of the clips each frame (rig.K), and the bind pose is rebuilt to match.
const TEEN_BONES = { 'DEF-thighL': 0.86, 'DEF-thighR': 0.86, 'DEF-upper_armL': 0.89, 'DEF-upper_armR': 0.89, 'DEF-forearmL': 0.92, 'DEF-forearmR': 0.92, 'DEF-handL': 0.92, 'DEF-handR': 0.92, 'DEF-spine001': 0.95, 'DEF-spine002': 0.95, 'DEF-spine003': 0.95, 'DEF-shoulderL': 0.95, 'DEF-shoulderR': 0.95, 'DEF-neck': 0.92, 'DEF-head': 0.9 };
function retarget(skel, K) {
  const bones = skel.bones, idx = new Map(bones.map((b, i) => [b, i]));
  const oldW = bones.map((b, i) => new THREE.Matrix4().copy(skel.boneInverses[i]).invert()), newW = new Array(bones.length);
  const solve = (i) => {
    if (newW[i]) return newW[i];
    const b = bones[i], pi = idx.get(b.parent);
    if (pi === undefined) return (newW[i] = oldW[i].clone());
    const local = new THREE.Matrix4().copy(oldW[pi]).invert().multiply(oldW[i]), k = K[b.name] ?? 1, e = local.elements;
    e[12] *= k; e[13] *= k; e[14] *= k;
    return (newW[i] = new THREE.Matrix4().multiplyMatrices(solve(pi), local));
  };
  bones.forEach((b, i) => solve(i));
  skel.boneInverses = newW.map((m) => m.clone().invert());
  const list = [];
  for (const b of bones) { const k = K[b.name]; if (k) { list.push({ bone: b, k, raw: b.position.clone() }); b.position.multiplyScalar(k); } }
  return list;
}
// the villagers are built the same way: one sculpted body per build, shared. Grown men fill out, women slighter with
// a wider pelvis, a child thin with a bigger head; the skeleton shortened to suit, as for Vanaj.
const WOMAN_BONES = { 'DEF-thighL': 0.92, 'DEF-thighR': 0.92, 'DEF-upper_armL': 0.9, 'DEF-upper_armR': 0.9, 'DEF-forearmL': 0.94, 'DEF-forearmR': 0.94, 'DEF-handL': 0.94, 'DEF-handR': 0.94, 'DEF-shoulderL': 0.97, 'DEF-shoulderR': 0.97 };
const MAN_BONES = { 'DEF-forearmL': 0.95, 'DEF-forearmR': 0.95, 'DEF-handL': 0.95, 'DEF-handR': 0.95, 'DEF-upper_armL': 0.96, 'DEF-upper_armR': 0.96 };
const BODY = {
  man: { limb: 1.32, trunk: 1.24, neck: 1.28, hs: 1.0, wrap: false, bones: MAN_BONES },
  woman: { limb: 1.12, trunk: 1.06, hip: 1.12, neck: 1.02, hs: 1.03, wrap: false, bones: WOMAN_BONES },
  child: { limb: 0.96, trunk: 0.94, neck: 0.96, hs: 1.2, wrap: false, bones: TEEN_BONES },
};
const bodyCache = {};
function bodyFor(kind, skeleton, detail) { return bodyCache[kind] || (bodyCache[kind] = sculptBody(skeleton, detail, BODY[kind])); }
export function prebuildBodies(detail) {
  if (!T.ready || !PAINTED) return;
  for (const kind in BODY) { const inst = SkeletonUtils.clone(T.scene); let m; inst.traverse((o) => { if (o.isSkinnedMesh && !m) m = o; }); retarget(m.skeleton, BODY[kind].bones); bodyFor(kind, m.skeleton, detail); }
}
const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
// His skin, clothes and face, painted on the body in its bind pose, so they follow every bend of the skin exactly:
// the bark-cloth wrap and hide vest, dust on the shins and feet, and a simple drawn face with big dark eyes that blink
// and look about. Flat colours and ink lines, in keeping with the painted forest.
function boySkin(opts, O, A) {
  const boy = !!opts.clothes;
  // how far down the cloth reaches: his wrap to mid-thigh; a man's dhoti to the shin, a child's to the knee
  const hemY = boy ? A.hemY : A.hs > 1.1 ? A.kneeY * 1.02 : A.kneeY * 0.6;
  const U = { blink: { value: 0 }, look: { value: new THREE.Vector2() }, mouth: { value: 0 }, brow: { value: 0 }, skin: { value: new THREE.Color(opts.skinColor || '#b0744a') }, top: { value: new THREE.Color(boy ? '#6b4c33' : opts.topCol || opts.clothCol || '#a89468') }, cloth: { value: new THREE.Color(boy ? '#c7ae80' : opts.clothCol || '#d8d0bc') } };
  const f = (v) => v.toFixed(4);
  const fn = (s) => {
    s.uniforms.uBlink = U.blink; s.uniforms.uLook = U.look; s.uniforms.uMouth = U.mouth; s.uniforms.uBrow = U.brow; s.uniforms.uSkin = U.skin; s.uniforms.uTopC = U.top; s.uniforms.uClothC = U.cloth;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute vec4 aReg; varying vec3 vBP; varying vec4 vReg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBP = position; vReg = aReg;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vBP; varying vec4 vReg; uniform float uBlink, uMouth, uBrow, uWetness; uniform vec2 uLook; uniform vec3 uSkin, uTopC, uClothC;
        ${NOISE_GLSL}
        float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
        float fillA(float d) { float w = fwidth(d) + 1e-5; return 1.0 - smoothstep(-w, w, d); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vBP, c = uSkin;
          float ax = abs(p.x), n = vnoise3(p * 34.0), n2 = vnoise3(p * 11.0);
          // dust and dried mud up the shins, grime on the hands and knees
          c = mix(c, ${lin('#6e5236')}, smoothstep(${f(A.footY + 0.2)}, ${f(A.footY - 0.04)}, p.y + (n2 - 0.5) * 0.14) * ${boy ? '0.62' : '0.25'});
          ${boy ? `c = mix(c, ${lin('#6e5236')}, smoothstep(0.035, 0.012, abs(p.y - ${f(A.kneeY)}) + (n - 0.5) * 0.03) * step(0.0, p.z) * 0.3);` : ''}
          c = mix(c, c * 0.8, clamp(vReg.x, 0.0, 1.0) * (0.4 + 0.6 * n2));
          // his vest of soft hide, open down the chest with pale stitches; on villagers a plain short-sleeved top
          if (vReg.z < 0.3 && ax < ${f(A.armX + (boy ? 0 : 0.11))} && p.y > ${f(A.waistY - 0.012)} && p.y < ${f(A.chestTop + 0.09)}) {
            float open = ${boy ? `0.011 + max(0.0, ${f(A.chestTop)} - p.y) * 0.05` : '-1.0'};
            float hole = length(vec2(p.x, (p.z + 0.018) * 0.95)) - 0.074;   // round the neck
            bool bare = (p.z > 0.0 && ax < open) || (p.y > ${f(A.chestTop - 0.05)} && hole < 0.0);
            if (!bare) {
              c = uTopC * mix(1.0, 1.2, smoothstep(0.35, 0.7, n2));
              ${boy ? `float st = step(0.0, p.z) * (1.0 - smoothstep(0.0012, 0.0024, abs(ax - open - 0.0065))) * step(0.5, fract(p.y * 42.0));
              c = mix(c, ${lin('#d4c098')}, st);` : ''}
              c = mix(c, c * 0.72, smoothstep(0.012, 0.0, abs(p.y - ${f(A.waistY + 0.002)}) + (n - 0.5) * 0.008));
            }
          }
          // the wrap: pale bark cloth from the waist to mid-thigh, its folds drawn, a dark band at the torn hem
          float hem = ${f(hemY)} + (n - 0.5) * ${boy ? '0.016' : '0.004'};
          if (vReg.z < 0.3 && p.y < ${f(A.waistY - 0.006)} && p.y > hem) {
            c = uClothC * mix(1.0, 0.86, smoothstep(0.42, 0.62, vnoise(vec2((p.x + p.z * 0.5) * 34.0, p.y * 7.0))));
            c = mix(c, uClothC * 0.68, 1.0 - smoothstep(0.012, 0.024, p.y - hem));
            c = mix(c, uClothC * 0.68, (1.0 - smoothstep(0.0, 0.0035, abs(p.x * 0.8 + p.y * 0.35 - 0.33 - sign(p.x) * 0.02))) * step(0.0, p.z) * step(0.0, p.x) * 0.7);
          }
          // the face
          vec3 q = (p - vec3(${f(O.x)}, ${f(O.y)}, ${f(O.z)})) / ${f(A.hs)};
          if (vReg.z > 0.5 && q.z > 0.02 && abs(q.x) < 0.085 && q.y < 0.08 && q.y > -0.125) {
            float side = q.x > 0.0 ? 1.0 : -1.0;
            vec2 e = vec2(abs(q.x) - 0.0365, q.y + 0.012); e.y -= e.x * 0.12;            // outer corner lifted a little
            float ry = max(0.0009, 0.0128 * (1.0 - uBlink)), rx = 0.0192;
            float de = length(e / vec2(rx, ry)) - 1.0, eye = fillA(de * ry);
            vec2 ip = vec2(q.x - side * 0.0365 - uLook.x * 0.0068, q.y + 0.0115 - uLook.y * 0.0036);
            vec3 ec = ${lin('#f1e8d8')};
            ec = mix(ec, mix(${lin('#4a2c18')}, ${lin('#26150c')}, smoothstep(-0.011, 0.011, ip.y)), fillA(length(ip) - 0.0112));
            ec = mix(ec, ${lin('#0c0705')}, fillA(length(ip) - 0.0056));
            ec = mix(ec, vec3(1.0), fillA(length(ip - vec2(-0.0034, 0.0042)) - 0.0024));
            ec *= 1.0 - 0.28 * smoothstep(0.1, 0.95, e.y / ry);                         // the lid's shadow
            c = mix(c, ec, eye);
            // upper lid: a thick drawn line, running past the outer corner; lower lid: a thin one
            float up = smoothstep(-0.0015, 0.0015, e.y);
            float lid = fillA(abs(de * ry) - mix(0.0007, 0.0021, up)) * mix(0.55, 1.0, up);
            c = mix(c, ${lin('#20130c')}, lid);
            c = mix(c, ${lin('#20130c')}, fillA(sdSeg(e, vec2(0.0182, 0.0028), vec2(0.0235, -0.0012)) - 0.001));
            // brows: short, thick, a little worried
            float by = 0.0205 + uBrow * 0.004;
            c = mix(c, ${lin(opts.age ? '#b8b2a8' : '#26170f')}, fillA(sdSeg(vec2(abs(q.x), q.y), vec2(0.0185, by + 0.0005), vec2(0.0545, by - 0.0015)) - mix(0.0042, 0.0024, smoothstep(0.02, 0.055, abs(q.x)))));
            // the underside of the nose, the mouth (a small line that opens when he's out of breath), warm cheeks
            c = mix(c, ${lin('#6e4226')}, fillA(sdSeg(vec2(q.x, q.y), vec2(-0.0095, -0.0555), vec2(0.0095, -0.0555)) - 0.0012) * 0.8);
            vec2 m = vec2(q.x, q.y + 0.0795 - q.x * q.x * 4.0);
            c = mix(c, ${lin('#3a1a12')}, fillA(sdSeg(m, vec2(-0.0165, 0.0), vec2(0.0165, 0.0)) - 0.0011 - uMouth * 0.0065));
            c = mix(c, c * ${lin('#ffc4b0')} * 1.06, smoothstep(0.03, 0.0, length(vec2(abs(q.x) - 0.047, q.y + 0.045))) * 0.25);
            ${opts.age ? `// the lines of a long life: at the corners of the eyes, beside the nose and mouth, across the brow
            float wr = fillA(sdSeg(vec2(abs(q.x), q.y), vec2(0.0595, -0.011), vec2(0.0695, -0.005)) - 0.0007) + fillA(sdSeg(vec2(abs(q.x), q.y), vec2(0.0595, -0.016), vec2(0.0695, -0.02)) - 0.0007)
              + fillA(sdSeg(vec2(abs(q.x), q.y), vec2(0.016, -0.051), vec2(0.03, -0.077)) - 0.0008) + fillA(abs(q.y - 0.041 - q.x * q.x * 3.0) - 0.0006) * step(abs(q.x), 0.04);
            c = mix(c, c * 0.62, clamp(wr, 0.0, 1.0) * 0.8);` : ''}
          }
          diffuseColor.rgb = c * mix(1.0, 0.82, uWetness);
        }`);
  };
  // (a program per build: their measurements are written into the shader)
  const key = `boy-${A.hs}-${boy ? 1 : 0}-${opts.age ? 1 : 0}`;
  const m = PAINTED ? toon({ color: 0xffffff, rim: 0.3, key, patch: fn }) : patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }), key + '-real', fn);
  m.userData.faceU = U;
  return m;
}
// Short shaggy hair that nobody has ever cut straight: thick, tapered chunks falling from the crown, a fringe that
// stops above the brows, over the tops of the ears at the sides, to the nape behind, a few tufts standing up.
function shaggyHair(skull, E, seed = 23) {
  let sd = seed; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const parts = [], dir = (az, pol, out) => out.set(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
  const p = new THREE.Vector3(), on = (d, k) => new THREE.Vector3(skull.x + d.x * E.x * k, skull.y + d.y * E.y * k, skull.z + d.z * E.z * k);
  // a lock: rooted at (az, pol), following the skull down to pol1, sweeping sideways, its tip kicking out
  const lock = (az, pol, pol1, sweep, r0, kick = 0.05) => {
    const pts = [on(dir(az, pol, p), 0.94)], N = 5;
    for (let i = 1; i <= N; i++) { const t = i / N; pts.push(on(dir(az + sweep * t, pol + (pol1 - pol) * t, p), 1.17 + 0.03 * Math.sin(t * 3 + az) + kick * t * t)); }
    parts.push(lockGeo(new THREE.CatmullRomCurve3(pts), r0, r0 * 0.2, rr() * 6.28, 8, 6));
  };
  for (let i = 0; i < 15; i++) { const a = -0.86 + i * 0.123 + (rr() - 0.5) * 0.08; lock(a, 0.15 + rr() * 0.3, 1.14 + rr() * 0.2, (a > 0 ? 1 : -1) * (0.14 + rr() * 0.22), 0.03 + rr() * 0.01, 0.03); }    // fringe
  for (const s of [1, -1]) for (let i = 0; i < 9; i++) { const a = s * (0.95 + i * 0.13 + (rr() - 0.5) * 0.1); lock(a, 0.35 + rr() * 0.35, 1.7 + rr() * 0.38, s * (rr() - 0.3) * 0.25, 0.031 + rr() * 0.011, 0.09); }    // over the ears
  for (let i = 0; i < 17; i++) { const a = 2.15 + i * 0.118 + (rr() - 0.5) * 0.08; lock(a, 0.3 + rr() * 0.5, 2.25 + rr() * 0.35, (rr() - 0.5) * 0.3, 0.034 + rr() * 0.012, 0.1); }    // to the nape
  for (let i = 0; i < 12; i++) { const a = rr() * 6.28; lock(a, rr() * 0.28, 0.6 + rr() * 0.32, (rr() - 0.5) * 0.6, 0.027 + rr() * 0.01, 0.2); }   // tufts on the crown
  // the scalp under the locks, with its hairline above the brow
  const cap = new THREE.SphereGeometry(1.07, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56); cap.deleteAttribute('uv'); cap.rotateX(-0.36); cap.scale(E.x, E.y, E.z);
  cap.computeVertexNormals(); cap.translate(skull.x, skull.y, skull.z - 0.004);
  const n = cap.attributes.position.count;
  cap.setAttribute('aT', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.05), 1)); cap.setAttribute('aPh', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  parts.push(cap.toNonIndexed());
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}
function boyHairMat(color, U) {
  const fn = (s) => {
    s.uniforms.uHairPush = U.push;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute float aT, aPh; uniform float uTime; uniform vec3 uHairPush; varying float vT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float sw = aT * aT; transformed += uHairPush * sw;
          transformed.x += sin(uTime * 1.6 + aPh) * 0.004 * sw; transformed.z += sin(uTime * 1.25 + aPh * 1.3) * 0.003 * sw; }
        vT = aT;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying float vT;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.5, 1.32, 1.15), smoothstep(0.5, 1.0, vT));`);
  };
  return PAINTED ? toon({ color, rim: 0.12, key: 'hair-boy', patch: fn }) : patch(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), 'hair-boy-real', fn);
}

function bonePos(inst, name, out) { const b = inst.getObjectByName(name); b.getWorldPosition(out); return out; }

// One matted lock: a tapered, lumpy, slightly flattened tube along a curve. aT runs 0 at the root to 1 at the
// tip (colour and sway), aPh is the lock's own random phase.
function lockGeo(curve, r0, r1, ph, segs = 9, rad = 6) {
  const fr = curve.computeFrenetFrames(segs, false), pos = [], nor = [], at = [], ap = [], idx = [];
  const P = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P);
    const r = (r0 + (r1 - r0) * t) * (1 + 0.28 * Math.sin(t * 21 + ph * 5));   // clumps along the lock
    for (let j = 0; j <= rad; j++) {
      const a = j / rad * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      d.copy(fr.normals[i]).multiplyScalar(c).addScaledVector(fr.binormals[i], s * 0.82);   // matted a little flat
      pos.push(P.x + d.x * r, P.y + d.y * r, P.z + d.z * r); d.normalize(); nor.push(d.x, d.y, d.z); at.push(t); ap.push(ph);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(ap, 1)); g.setIndex(idx);
  return g;
}

// Long hair that has never been cut or combed: locks rooted all over the scalp behind the hairline, lying along
// the skull and then hanging; short over the brow, to the jaw at the sides, past the shoulders behind.
function mattedHair(skull, rad, seed = 7) {
  let s = seed; const rr = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const parts = [], dir = (az, pol, out) => out.set(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
  const n = new THREE.Vector3(), p = new THREE.Vector3();
  // the cranium as an ellipsoid (radii x, y, z); a point on it, k times out, in direction d
  const E = typeof rad === 'number' ? new THREE.Vector3(rad, rad, rad) : rad, hr = (E.x + E.y + E.z) / 3;
  const on = (d, k) => new THREE.Vector3(skull.x + d.x * E.x * k, skull.y + d.y * E.y * k, skull.z + d.z * E.z * k);
  for (let i = 0; i < 90 && parts.length < 72; i++) {
    const az = rr() * Math.PI * 2, pol = Math.acos(1 - rr() * 1.2);   // +z is the face
    dir(az, pol, n);
    if (n.z > 0.42 && pol > 0.8) continue;                            // forehead and face stay bare
    // by the way the root faces: none falling over the brow (a mane this matted is swept back by its own
    // weight), locks to the jaw at the sides, long ones behind
    if (Math.cos(az) > 0.45) continue;
    const front = false, side = Math.abs(Math.sin(az)) > 0.75;
    let len = front ? 0.04 + rr() * 0.07 : side ? 0.13 + rr() * 0.18 : 0.24 + rr() * 0.28;
    const pts = [on(n, 0.93)];
    // lie along the skull, sliding down from the root, until below its widest part (or out of length)
    const maxPol = front ? Math.min(1.2, pol + len / hr) : 1.75;
    let pp = pol, used = 0, R = 1.12;
    while (pp < maxPol && used < len) { pp = Math.min(maxPol, pp + 0.3); used += 0.3 * hr * R; pts.push(on(dir(az, pp, p), R)); R += 0.004 / hr; }
    // then hang, drifting out a little and back, with a kink or two
    const last = pts[pts.length - 1], out = new THREE.Vector3(n.x, 0, n.z).normalize();
    const rest = Math.max(0, len - used);
    for (let k = 1; k <= 3 && rest > 0.01; k++) { const f = k / 3; pts.push(last.clone().add(new THREE.Vector3(out.x * 0.02 * f + (rr() - 0.5) * 0.02, -rest * f, out.z * 0.02 * f - 0.012 * f + (rr() - 0.5) * 0.02))); }
    if (pts.length < 2) continue;
    const r0 = 0.008 + rr() * 0.011;
    parts.push(lockGeo(new THREE.CatmullRomCurve3(pts), r0, r0 * 0.35, rr() * 6.28, Math.max(4, Math.round(len * 40))));
  }
  // the scalp under the locks, roughened so it doesn't read as a smooth cap
  // tilted back so its front edge is a hairline above the brow, and held clear of the scalp so the two
  // surfaces never fight for the same depth
  const cap = new THREE.SphereGeometry(1.08, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52); cap.deleteAttribute('uv'); cap.rotateX(-0.42); cap.scale(E.x, E.y, E.z);
  const cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), k = 1 + 0.06 * Math.sin(x * 140 + z * 90) * Math.sin(y * 120 + x * 60); cp.setXYZ(i, x * k, y * k, z * k); }
  cap.computeVertexNormals(); cap.translate(skull.x, skull.y + 0.005, skull.z - 0.005);
  cap.setAttribute('aT', new THREE.Float32BufferAttribute(new Float32Array(cp.count).fill(0.08), 1));
  cap.setAttribute('aPh', new THREE.Float32BufferAttribute(new Float32Array(cp.count), 1));
  parts.push(cap.toNonIndexed());
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}
function hairMat(color) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
  patch(m, 'hair-matted', (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute float aT, aPh; uniform float uTime; varying float vT, vPh; varying vec3 vHP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aT * aT;
        transformed.x += sin(uTime * 1.4 + aPh) * 0.007 * sw; transformed.z += sin(uTime * 1.1 + aPh * 1.3) * 0.005 * sw;
        vT = aT; vPh = aPh; vHP = position;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying float vT, vPh; varying vec3 vHP;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // near-black at the root, bleached rusty brown toward the sun-dried tips; fibres and clumps; dust and leaf bits
        vec3 tip = mix(vec3(0.075, 0.042, 0.022), vec3(0.12, 0.072, 0.038), fract(vPh * 3.7));
        vec3 hc = mix(diffuseColor.rgb, tip, smoothstep(0.2, 1.0, vT) * (0.45 + 0.55 * fract(vPh * 1.9)));
        hc *= 0.7 + 0.6 * vnoise3(vHP * vec3(150.0, 35.0, 150.0));
        hc = mix(hc, vec3(0.1, 0.08, 0.055), smoothstep(0.8, 0.9, vnoise3(vHP * 48.0 + vPh)) * 0.3);
        diffuseColor.rgb = hc;`);
  });
  return m;
}

// Body builds. The mannequin is a grown man; a build reshapes its bind-pose mesh before skinning. Each vertex
// is moved toward the bones it is weighted to (limbs thinned round the bone axis, torso narrowed about the
// spine, head scaled about the skull centre) and the moves are blended by skin weight, so joints stay smooth.
// The clips animate every bone's position and scale, so the skeleton itself is left as it is.
const BUILDS = {
  // Vanaj at fifteen: lean and wiry from running and climbing every day, not filled out yet; head a touch large
  teen: { head: 1.07, neck: 0.84, chest: [0.86, 0.83], waist: [0.85, 0.85], hips: [0.87, 0.88], clav: 0.86, upper_arm: 0.83, forearm: 0.86, hand: 0.94, thigh: 0.85, shin: 0.87, foot: 0.94, girth: 0.87 },
  // a village boy of eleven or twelve
  child: { head: 1.13, neck: 0.84, chest: [0.86, 0.84], waist: [0.86, 0.88], hips: [0.86, 0.88], clav: 0.86, upper_arm: 0.8, forearm: 0.83, hand: 0.9, thigh: 0.82, shin: 0.84, foot: 0.9, girth: 0.86 },
};
const TORSO = { 'DEF-hips': 'hips', 'DEF-spine001': 'waist', 'DEF-spine002': 'chest', 'DEF-spine003': 'chest' };
function limbKey(name) {
  if (/^DEF-(f_|thumb)/.test(name)) return 'hand';
  const m = name.match(/^DEF-(upper_arm|forearm|hand|thigh|shin|foot|toe)[LR]$/); if (m) return m[1] === 'toe' ? 'foot' : m[1];
  if (/^DEF-shoulder[LR]$/.test(name)) return 'clav';
  if (name === 'DEF-neck') return 'neck';
  return null;
}
function reshape(inst, B) {
  inst.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.geometry = o.geometry.clone();   // clones share geometry; only this body changes
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    const bones = o.skeleton.bones;
    // bind-pose head of every bone, and the point its segment runs to (first child bone, or extrapolated)
    const H = bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(_m.copy(o.skeleton.boneInverses[i]).invert()));
    const T = bones.map((b, i) => {
      const c = b.children.find((k) => k.isBone && bones.includes(k));
      if (c) return H[bones.indexOf(c)].clone();
      const pi = bones.indexOf(b.parent); return pi >= 0 ? H[i].clone().addScaledVector(_a.subVectors(H[i], H[pi]), 0.5) : H[i].clone();
    });
    const rule = bones.map((b) => b.name === 'DEF-head' ? 'head' : TORSO[b.name] ? 'torso' : limbKey(b.name) ? 'limb' : null);
    // skull centre: the head bone sits at the skull base, so measure the head from the vertices above it
    const hi = bones.findIndex((b) => b.name === 'DEF-head');
    const skull = new THREE.Vector3(); let top = -1e9, n = 0, rad = 0;
    if (hi >= 0) {
      for (let i = 0; i < P.count; i++) if (P.getY(i) > H[hi].y + 0.02) { skull.x += P.getX(i); skull.z += P.getZ(i); top = Math.max(top, P.getY(i)); n++; }
      if (n) { skull.x /= n; skull.z /= n; for (let i = 0; i < P.count; i++) if (P.getY(i) > H[hi].y + 0.02) rad = Math.max(rad, Math.hypot(P.getX(i) - skull.x, P.getZ(i) - skull.z)); skull.y = top - rad; }
      else skull.copy(H[hi]);
    }
    const v = new THREE.Vector3(), nv = new THREE.Vector3(), acc = new THREE.Vector3(), nacc = new THREE.Vector3(), p = new THREE.Vector3(), ax = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); nv.fromBufferAttribute(N, i); acc.set(0, 0, 0); nacc.set(0, 0, 0);
      let wsum = 0;
      for (let k = 0; k < 4; k++) {
        const w = SW.getComponent(i, k); if (w <= 0) continue;
        const bi = SI.getComponent(i, k), r = rule[bi], name = bones[bi].name;
        p.copy(v); q.copy(nv);
        if (r === 'head') p.sub(skull).multiplyScalar(B.head).add(skull);
        else if (r === 'torso') { const [kx, kz] = B[TORSO[name]]; p.x = H[bi].x + (v.x - H[bi].x) * kx; p.z = H[bi].z + (v.z - H[bi].z) * kz; q.set(nv.x / kx, nv.y, nv.z / kz).normalize(); }
        else if (r === 'limb') {
          // pull toward the nearest point on the bone's segment: thinner, same length
          ax.subVectors(T[bi], H[bi]); const L2 = ax.lengthSq();
          const t = L2 > 1e-8 ? Math.min(1, Math.max(0, _b.subVectors(v, H[bi]).dot(ax) / L2)) : 0;
          const A = _d.copy(H[bi]).addScaledVector(ax, t);
          p.sub(A).multiplyScalar(B[limbKey(name)]).add(A);
        }
        acc.addScaledVector(p, w); nacc.addScaledVector(q, w); wsum += w;
      }
      if (wsum > 0) { P.setXYZ(i, acc.x / wsum, acc.y / wsum, acc.z / wsum); nacc.normalize(); N.setXYZ(i, nacc.x, nacc.y, nacc.z); }
    }
    P.needsUpdate = true; N.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
  });
}

// clothing built in model space against the rest pose, then attached to the bones (keeps world transform)
function dress(inst, opts, S, cranium) {
  const B = (n) => inst.getObjectByName(n);
  const hip = bonePos(inst, 'DEF-hips', new THREE.Vector3()), chest = bonePos(inst, 'DEF-spine003', new THREE.Vector3()), head = bonePos(inst, 'DEF-head', new THREE.Vector3());
  const neck = bonePos(inst, 'DEF-neck', new THREE.Vector3()), kneeL = bonePos(inst, 'DEF-shinL', new THREE.Vector3()), footL = bonePos(inst, 'DEF-footL', new THREE.Vector3());
  const mats = [];
  const add = (geo, mat, bone) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; inst.add(m); B(bone).attach(m); mats.push(mat); return m; };
  const cloth = (tex, color = 0xffffff) => new THREE.MeshStandardMaterial({ map: tex || null, color, roughness: 0.95, side: THREE.DoubleSide });
  const G = (BUILDS[opts.build] || {}).girth || 1;   // slimmer builds get closer-fitting cloth
  const ring = (y0, y1, r0, r1, seg = 18) => { const g = new THREE.CylinderGeometry(r1 * G, r0 * G, y1 - y0, seg, 3, true); g.translate(0, (y0 + y1) / 2, 0); return g; };
  const hy = hip.y;
  // the body's cross-section at height y (torso only, not hands hanging beside it), measured from the mesh so
  // clothing fits whatever build it is put on
  const section = (y, dy = 0.02) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    inst.traverse((o) => { if (!o.isSkinnedMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (Math.abs(p.getY(i) - y) > dy || Math.abs(x) > 0.22) continue; const z = p.getZ(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } });
    return x1 > x0 ? { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2, rz: (z1 - z0) / 2 } : { cx: 0, cz: 0, rx: 0.15 * G, rz: 0.11 * G };
  };
  if (opts.cloth === 'loin' || opts.cloth === 'wrap') {
    // a langot: a twisted fibre cord round the waist, a strip of old cloth passed between the legs and tucked
    // under the cord front and back, its frayed ends hanging over the front and behind, and a small hide bag
    const wrap = opts.cloth === 'wrap', cy = wrap ? opts.paint.waistY - 0.01 : hy + 0.035, W = section(cy);
    let crotch = hy - 0.12;
    inst.traverse((o) => { if (!o.isSkinnedMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (Math.abs(p.getX(i) - W.cx) < 0.02 && y < hy && y > hy - 0.3) crotch = Math.min(crotch, y); } });
    const bc = new THREE.MeshStandardMaterial({ map: opts.clothTex || null, color: 0xffffff, roughness: 0.97, side: THREE.DoubleSide, alphaTest: 0.5 });
    const cordM = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 });
    const ring0 = []; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; ring0.push(new THREE.Vector3(W.cx + Math.sin(a) * (W.rx + 0.008), cy - 0.014 * Math.max(0, Math.cos(a)) + 0.004 * Math.sin(a * 5), W.cz + Math.cos(a) * (W.rz + 0.008))); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring0, true), 80, 0.0065, 5, true), cordM, 'DEF-hips');
    // the knot, off-centre, with its two ends hanging
    const kx = W.cx + W.rx * 0.45, kz = W.cz + W.rz * Math.sqrt(1 - 0.2) + 0.012;
    add(new THREE.TorusGeometry(0.009, 0.0055, 5, 10).rotateY(0.4).translate(kx, cy - 0.014, kz), cordM, 'DEF-hips');
    for (const [dx, l] of [[-0.006, 0.07], [0.007, 0.05]]) add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(kx + dx, cy - 0.02, kz), new THREE.Vector3(kx + dx * 2, cy - 0.02 - l * 0.5, kz + 0.006), new THREE.Vector3(kx + dx * 2.5, cy - 0.02 - l, kz + 0.004)]), 6, 0.0045, 4, false), cordM, 'DEF-hips');
    // strip between the legs: front tuck -> under the crotch -> back tuck; narrow where the thighs close in
    if (!wrap) { const strip = new THREE.CatmullRomCurve3([[0, cy - 0.01, W.rz + 0.012], [0, crotch + 0.05, W.rz * 0.8], [0, crotch - 0.012, 0.0], [0, crotch + 0.05, -W.rz * 0.85], [0, cy - 0.01, -W.rz - 0.012]].map(([x, y, z]) => new THREE.Vector3(W.cx + x, y, W.cz + z)));
    { const pos = [], uv = [], idx = [], P = new THREE.Vector3(), N = 16;
      for (let i = 0; i <= N; i++) { const t = i / N; strip.getPointAt(t, P); const w = 0.024 + 0.026 * Math.abs(Math.cos(t * Math.PI)); pos.push(P.x - w, P.y, P.z, P.x + w, P.y, P.z); uv.push(0.2, 1 - t * 0.7, 0.8, 1 - t * 0.7); }
      for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      add(g, bc, 'DEF-hips'); } }
    // the hanging ends: bunched where they are tucked under the cord, opening out toward the frayed hem in soft
    // folds, wrapped to the curve of the belly / buttocks and falling a little away from the body
    // the cloth hangs from the cord, so it never comes in closer than the furthest the body has reached above
    // that height: it drapes over the buttocks and the groin instead of passing through them
    const reach = (y, side) => {
      let r = 0;
      inst.traverse((o) => { if (!o.isSkinnedMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const py = p.getY(i); if (py > y + 0.004 || py < y - 0.004 || Math.abs(p.getX(i) - W.cx) > W.rx * 0.7) continue; r = Math.max(r, side * (p.getZ(i) - W.cz)); } });
      return r;
    };
    const flap = (w, l, side, seed) => {
      const g = new THREE.PlaneGeometry(w, l, 10, 10), p = g.attributes.position, rows = new Map();
      let hold = 0;
      for (let k = 0; k <= 10; k++) { const y = cy - 0.004 - l * k / 10; hold = Math.max(hold, reach(y, side)); rows.set(k, hold); }
      for (let i = 0; i < p.count; i++) {
        const k = Math.round((l / 2 - p.getY(i)) / l * 10), y = cy - 0.004 - (l / 2 - p.getY(i)), drop = cy - y, f = drop / l;
        const x = p.getX(i) * (0.62 + 0.38 * Math.sqrt(f)), u = Math.min(0.95, Math.abs(x) / W.rx);
        const fold = Math.sin(x * 70 + seed) * 0.006 * (0.3 + f) + Math.sin(x * 31 + seed * 2) * 0.004;
        p.setXYZ(i, W.cx + x, y, W.cz + side * (Math.max(W.rz * Math.sqrt(1 - u * u), rows.get(k) - u * u * 0.03) + 0.014 + fold + drop * 0.06));
      }
      g.computeVertexNormals(); return g;
    };
    if (wrap) { add(flap(W.rx * 0.7, 0.15, 1, 1.3), bc, 'DEF-hips'); add(flap(W.rx * 0.85, 0.14, -1, 4.1), bc, 'DEF-hips'); }
    else { add(flap(W.rx * 1.15, 0.22, 1, 1.3), bc, 'DEF-hips'); add(flap(W.rx * 1.3, 0.17, -1, 4.1), bc, 'DEF-hips'); }
    if (wrap) {
      // a tooth on a cord at his throat (Kaali's, when she had it to give), and a band of twisted fibre on one wrist
      const y0 = neck.y + 0.012, zc = neck.z - 0.006, pts = [];
      for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, f = Math.max(0, Math.cos(a)); pts.push(new THREE.Vector3(Math.sin(a) * 0.056, y0 - 0.062 * f * f, zc + Math.cos(a) * (a > 1.57 && a < 4.71 ? 0.046 : 0.058))); }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 50, 0.0032, 5, true), cordM, 'DEF-spine003');
      add(new THREE.ConeGeometry(0.0072, 0.03, 6).rotateX(Math.PI).translate(0, y0 - 0.08, zc + 0.062), new THREE.MeshStandardMaterial({ color: 0xe9e0c8, roughness: 0.6 }), 'DEF-spine003');
      const wr = bonePos(inst, 'DEF-handL', new THREE.Vector3());
      add(new THREE.TorusGeometry(0.0235, 0.0042, 5, 14).rotateY(Math.PI / 2).translate(wr.x - 0.032, wr.y, wr.z), cordM, 'DEF-forearmL');
    }
    // a small hide bag hanging flat against the hip from the cord: flint, a fire-stick, whatever he keeps
    const pouchM = new THREE.MeshStandardMaterial({ color: 0x4e3626, roughness: 0.9 });
    const pouch = new THREE.SphereGeometry(0.05, 12, 10); pouch.scale(0.32, 1.1, 0.85);
    { const p = pouch.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.025) { const k = Math.max(0.25, 1 - (y - 0.025) * 18); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } else p.setZ(i, p.getZ(i) * (1 + Math.max(0, -y) * 2)); } pouch.computeVertexNormals(); }   // gathered neck, sagging base
    pouch.translate(W.cx + W.rx + 0.014, cy - 0.07, W.cz - W.rz * 0.15); add(pouch, pouchM, 'DEF-hips');
    add(new THREE.TorusGeometry(0.011, 0.003, 4, 10).rotateX(Math.PI / 2).translate(W.cx + W.rx + 0.014, cy - 0.024, W.cz - W.rz * 0.15), cordM, 'DEF-hips');   // drawstring
  } else if (opts.cloth === 'dhoti') {
    if (!opts.paint) add(ring(kneeL.y - 0.05, hy + 0.06, 0.24, 0.17), cloth(opts.clothTex, 0xffffff), 'DEF-hips');
  } else if (opts.cloth === 'sari') {
    const cm = cloth(opts.clothTex, 0xffffff);
    add(ring(footL.y + 0.06, hy + 0.08, 0.27, 0.14, 22), opts.paint ? new THREE.MeshStandardMaterial({ color: opts.clothCol || 0xc0b090, roughness: 0.95, side: THREE.DoubleSide }) : cm, 'DEF-hips');
    if (!opts.paint) add(ring(chest.y - 0.2, chest.y + 0.08, 0.15, 0.135), cm, 'DEF-spine003');
    const pallu = new THREE.PlaneGeometry(0.2, 0.62); pallu.rotateZ(0.5); pallu.translate(0.03, chest.y - 0.08, 0.125 * G); add(pallu, opts.paint ? new THREE.MeshStandardMaterial({ color: opts.clothCol || 0xc0b090, roughness: 0.95, side: THREE.DoubleSide }) : cm, 'DEF-spine003');
  }
  if (opts.topTex && !opts.paint) { const tm = cloth(opts.topTex, 0xffffff); add(ring(hy + 0.02, chest.y + 0.1, 0.16, 0.15), tm, 'DEF-spine002'); }
  const hairM = new THREE.MeshStandardMaterial({ color: opts.hairColor || 0x16110d, roughness: 0.9 });
  // the head bone sits at the base of the skull, ~0.26 below the crown: measure the skull from the mesh itself
  // (centre and width of everything above the bone) so hair and turbans sit on the head, not inside it
  let top = -1e9, sx = 0, sz = 0, sn = 0, rad = 0;
  inst.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > head.y + 0.02) { top = Math.max(top, y); sx += p.getX(i); sz += p.getZ(i); sn++; } }
    if (sn) for (let i = 0; i < p.count; i++) if (p.getY(i) > head.y + 0.02) rad = Math.max(rad, Math.hypot(p.getX(i) - sx / sn, p.getZ(i) - sz / sn));
  });
  // a sculpted head knows its cranium exactly (the face and ears would throw the measurement off)
  const hr = cranium ? Math.max(cranium.r.x, cranium.r.z) : sn ? rad : 0.115;
  const skull = cranium ? cranium.c.clone() : sn ? new THREE.Vector3(sx / sn, top - hr, sz / sn) : head.clone().setY(head.y + 0.13);
  if (opts.hair === 'shaggy') {
    const m = add(shaggyHair(skull, cranium ? cranium.r : new THREE.Vector3(hr, hr, hr)), boyHairMat(opts.hairColor || 0x31211a, opts.hairU), 'DEF-head');
    m.userData.hair = true;
  } else if (opts.hair === 'matted') {
    add(mattedHair(skull, cranium ? cranium.r : hr), hairMat(opts.hairColor || 0x16110d), 'DEF-head');
  } else if (opts.hair === 'short' || opts.hair === 'bun') {
    // a cap of hair over the skull, with a hairline above the brow and down behind the ears
    const E = cranium ? cranium.r : new THREE.Vector3(hr, hr, hr), cap = new THREE.SphereGeometry(1.17, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6); cap.rotateX(-0.3); cap.scale(E.x, E.y, E.z); cap.computeVertexNormals(); cap.translate(skull.x, skull.y, skull.z - 0.004);
    add(cap, hairM, 'DEF-head');
    if (opts.hair === 'bun') add(new THREE.SphereGeometry(0.046, 12, 9).translate(skull.x, skull.y - 0.018, skull.z - E.z * 1.13), hairM, 'DEF-head');
  }
  if (opts.turban) {
    const tm = new THREE.MeshStandardMaterial({ color: opts.turbanColor || 0xd8d0bc, roughness: 0.95 });
    const Et = cranium ? cranium.r : new THREE.Vector3(hr, hr, hr);
    const tg = new THREE.TorusGeometry(1.14, 0.2, 8, 22); tg.rotateX(Math.PI / 2); tg.scale(Et.x, Et.x, Et.z); tg.translate(skull.x, skull.y + 0.035, skull.z);
    add(tg, tm, 'DEF-head'); add(new THREE.SphereGeometry(1.19, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(Et.x, Et.y, Et.z).translate(skull.x, skull.y + 0.02, skull.z), tm, 'DEF-head');
  }
  return mats;
}

export function buildRiggedHuman(opts = {}) {
  const S = opts.scale || 1;
  if (PAINTED && !opts.sculpt) { opts = { ...opts, sculpt: true }; if (opts.cloth === 'sari' && opts.hair !== 'matted') opts.hair = 'bun'; }
  const inst = SkeletonUtils.clone(T.scene);
  let face = null, eyes = null, paint = null, cranium = null, K = null;
  const hairU = { push: { value: new THREE.Vector3() } };
  if (opts.sculpt) {
    // swap the mannequin's jointed plates for one continuous body generated around the same skeleton
    const mans = []; inst.traverse((o) => { if (o.isSkinnedMesh) mans.push(o); });
    const kind = !opts.proportions && (opts.build === 'child' ? 'child' : opts.cloth === 'sari' ? 'woman' : 'man');
    K = retarget(mans[0].skeleton, kind ? BODY[kind].bones : TEEN_BONES); inst.updateMatrixWorld(true);
    const sc = kind ? bodyFor(kind, mans[0].skeleton, opts.detail || 1.7) : sculptBody(mans[0].skeleton, opts.detail || 1);
    const body = new THREE.SkinnedMesh(sc.geometry); body.name = 'Body';
    mans[0].parent.add(body); body.bind(mans[0].skeleton, mans[0].bindMatrix);
    for (const m of mans) m.parent.remove(m);
    face = sc.face; eyes = sc.eyes; paint = sc.paint; cranium = sc.cranium;
  } else if (BUILDS[opts.build]) reshape(inst, BUILDS[opts.build]);
  inst.traverse((o) => { if (o.isSkinnedMesh) regions(o); });
  const unit = (1.72 * S) / (T.box.max.y - T.box.min.y);
  const skin = opts.skin || (paint ? boySkin({ ...opts, clothes: opts.proportions === 'teen' }, face, paint) : skinMat(opts.skinColor || 0x5e3d2a, opts.skinKey || 'skin', { dirt: opts.dirt, scars: opts.scars, face }));
  inst.traverse((o) => { if (o.isMesh) { o.material = skin; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  inst.updateMatrixWorld(true);
  dress(inst, { ...opts, paint, hairU }, S, cranium);
  if (eyes) for (const e of eyes) {
    const em = eyeMesh(e, patch, NOISE_GLSL), m = new THREE.Mesh(em.geometry, em.material);
    m.position.copy(e.c); m.rotation.y = Math.sign(e.c.x) * 0.06; inst.add(m); inst.getObjectByName('DEF-head').attach(m);
  }
  const body = new THREE.Group(); body.add(inst); body.scale.setScalar(unit);
  const root = new THREE.Group(); root.add(body);
  const mixer = new THREE.AnimationMixer(inst);
  const actions = {}; for (const c of T.clips) actions[c.name] = mixer.clipAction(c);
  const bones = {}; inst.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const fingers = K ? Object.values(bones).filter((b) => /^DEF-(f_|thumb)/.test(b.name)).map((b) => ({ bone: b, q0: b.quaternion.clone(), right: /R$/.test(b.name) })) : null;
  // grip frames that emulate the old hand joints (fingers along -Y, handle along +Z) so weapons attach as before
  const handR = new THREE.Group(), handL = new THREE.Group(), back = new THREE.Group(); root.add(handR, handL, back);
  // (back: where a weapon is slung while the hands are busy climbing or swimming, diagonally across the shoulders)
  back.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.5, 1, 0).normalize());
  const pack = new THREE.Group(); root.add(pack);
  const j = { handR, handL, back, pack, head: bones['DEF-head'], hips: bones['DEF-hips'] };
  const frames = K ? bindFrames(inst, bones) : null;
  return { root, j, S, rig: { inst, body, mixer, actions, bones, cur: null, curName: '', K, fingers, frames }, t: 0, dead: 0, skin, swimS: 0, faceU: skin.userData.faceU || null, hairU };
}

// The bind pose, for the poses no clip has. Each bone's rest orientation; and for hands and feet the directions of the
// fingers (or toes) and of the thumb side, so a hand can be told "fingers that way, thumb this way" and its palm then
// faces the only way a hand can (the old pose aimed the arm only, and the wrist kept whatever the clip was doing).
function bindFrames(inst, bones) {
  let sk = null; inst.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o.skeleton; });
  const F = { q: {}, p: {} }, m = new THREE.Matrix4(), s = new THREE.Vector3();
  sk.bones.forEach((b, i) => { m.copy(sk.boneInverses[i]).invert(); const p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, s); F.q[b.name] = q; F.p[b.name] = p; });
  const dir = (a, b) => new THREE.Vector3().subVectors(F.p[b], F.p[a]).normalize();
  for (const S of ['L', 'R']) {
    F['hand' + S] = { y: dir('DEF-hand' + S, 'DEF-f_middle01' + S), x: dir('DEF-f_pinky01' + S, 'DEF-f_index01' + S) };
    F['arm' + S] = { y: dir('DEF-forearm' + S, 'DEF-hand' + S), x: F['hand' + S].x };
    F['foot' + S] = { y: dir('DEF-foot' + S, 'DEF-toe' + S), x: new THREE.Vector3(1, 0, 0) };
  }
  F.hipPos = bones['DEF-hips'].position.clone();
  return F;
}
const _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _mT = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _qi = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();
// turn a bone so its bind frame's y lies along F and its x as near A as it can, keeping the bind's handedness
function setFrame(R, bone, frame, F, A, w = 1) {
  const qb = R.frames.q[bone.name]; if (!qb) return;
  R.inst.getWorldQuaternion(_qi);
  _fy.copy(F).normalize(); _fx.copy(A).addScaledVector(_fy, -A.dot(_fy)); if (_fx.lengthSq() < 1e-4) return; _fx.normalize(); _fz.crossVectors(_fx, _fy);
  _by.copy(frame.y).applyQuaternion(_qi); _bx.copy(frame.x).applyQuaternion(_qi); _bx.addScaledVector(_by, -_bx.dot(_by)).normalize(); _bz.crossVectors(_bx, _by);
  _mT.makeBasis(_fx, _fy, _fz); _mB.makeBasis(_bx, _by, _bz).transpose(); _mT.multiply(_mB);
  _qd.setFromRotationMatrix(_mT);
  _qw.copy(_qi).multiply(qb).premultiply(_qd);
  bone.parent.getWorldQuaternion(_qp).invert(); _qp.multiply(_qw);
  if (w < 1) bone.quaternion.slerp(_qp, w); else bone.quaternion.copy(_qp);
  bone.updateMatrixWorld(true);
}
// back toward the bone's rest orientation
function toBind(R, bone, w) {
  const qb = R.frames.q[bone.name]; if (!qb) return;
  R.inst.getWorldQuaternion(_qi); _qw.copy(_qi).multiply(qb);
  bone.parent.getWorldQuaternion(_qp).invert(); _qp.multiply(_qw);
  bone.quaternion.slerp(_qp, w); bone.updateMatrixWorld(true);
}
const ONCE = new Set(['Death01', 'Punch_Jab', 'Jump_Start']);
function play(R, name, fade, ts) {
  const a = R.actions[name] || R.actions.Idle_Loop; if (!a) return;
  a.timeScale = ts;
  if (R.curName === name) return;
  if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
  a.reset().setEffectiveWeight(1).play();
  if (R.cur) R.cur.crossFadeTo(a, fade, false);
  R.cur = a; R.curName = name;
}
// rotate a bone (in world space) so the segment bone -> child points along dir; w blends from the clip pose
function aim(bone, child, dir, w) {
  if (w <= 0.001) return;
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _d2.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_d2, dir);
  if (w < 1) _q.slerp(_q3.identity(), 1 - w);
  bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q2));
  bone.updateMatrixWorld(true);
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const dirOf = (out, fx, ux, rx) => out.set(0, 0, 0).addScaledVector(_f, fx).addScaledVector(_u, ux).addScaledVector(_r, rx).normalize();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

// ------------------------------------------------------------------------------------------- how he moves
// Locomotion as a blend space, not a chain of cross-fades: walk, jog and sprint all start on the left foot, so they
// run on one shared phase and blend by speed with the feet in step. Cadence comes from speed (steps per second,
// from running-gait figures), and since the clips were made for slower ground speeds than he runs at, each step is
// lengthened to match the ground: "stride" scales the foot's reach about the hip (the stride scaling of Half-Life:
// Alyx's locomotion, Parker, SIGGRAPH 2021). Two-bone IK then plants each foot on the real ground and tips it to the
// slope, dropping the pelvis when one foot has further to reach.
const ramp = (s, T) => { if (s <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (s <= T[i][0]) { const a = T[i - 1], b = T[i]; return a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]); } return T[T.length - 1][1]; };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Small quick steps, a walk of about 0.75 m a step and a run of about 1.2 m. A faster pace comes from a faster cadence, not
// a longer stride, so the clips' reach is cut down (STRIDE below 1) to what the feet really cover on the ground.
const CADENCE = [[0.3, 1.4], [1.0, 2.2], [2.4, 3.1], [3.4, 3.6], [4.5, 4.2], [6, 4.9], [7.2, 5.4], [9, 6]];
const STRIDE = [[0.3, 1.0], [1.0, 0.95], [2.4, 0.74], [3.4, 0.62], [4.5, 0.56], [6, 0.48], [7.2, 0.44]];
const LIFT = [[2.4, 1], [3.4, 0.8], [6, 0.55]];   // and the heels stay low: the run's clip kicks them up behind him
// how much of each foot's cycle is on the ground: most of a walk, about a third of a jog, a quarter of a sprint
const DUTY = [[0.3, 0.66], [1.8, 0.62], [2.4, 0.6], [3.2, 0.44], [4.5, 0.35], [6, 0.3], [7.2, 0.26]];
const LOCO = new Set(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop']);
function blendMotion(h, R, dt, clip, ts, spd) {
  const W = R.w || (R.w = {}), T = {};
  const loco = LOCO.has(clip);
  if (loco) {
    const mv = sstep(0.06, 0.35, spd), jog = sstep(2.7, 3.4, spd), spr = sstep(6.6, 7.6, spd);
    T.Idle_Loop = 1 - mv; T.Walk_Loop = mv * (1 - jog); T.Jog_Fwd_Loop = mv * jog * (1 - spr); T.Sprint_Loop = mv * jog * spr;
  } else T[clip] = 1;
  if (clip !== R.curName) {
    if (ONCE.has(clip)) { const a = R.actions[clip]; a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset(); }
    R.curName = clip;
  }
  const k = 1 - Math.pow(2, -dt / (clip === 'Death01' ? 0.09 : 0.055));
  let sum = 0;
  for (const n in R.actions) { W[n] = (W[n] || 0) + ((T[n] || 0) - (W[n] || 0)) * k; sum += W[n]; }
  sum = sum || 1;
  h.phase = ((h.phase || 0) + ramp(spd, CADENCE) * 0.5 * dt) % 1;
  for (const n in R.actions) {
    const a = R.actions[n], w = W[n] / sum;
    if (w > 0.002) { a.enabled = true; a.play(); a.setEffectiveWeight(w); } else { a.setEffectiveWeight(0); continue; }
    if (n === 'Idle_Loop') a.timeScale = 1;
    else if (LOCO.has(n)) { a.timeScale = 0; a.time = h.phase * a.getClip().duration; }
    else if (n === clip) a.timeScale = ts;
  }
  const mv2 = sstep(0.2, 0.9, spd);
  return loco ? ramp(spd, STRIDE) * mv2 + (1 - mv2) : 1;
}
const _ik = { H: new THREE.Vector3(), K: new THREE.Vector3(), A: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3(), t: new THREE.Vector3(), x: new THREE.Vector3(), g: new THREE.Vector3(), n: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), inv: new THREE.Matrix4() };
// point b1 -> b2 -> b3 so that b3 reaches target, bending toward the side the joint already bends (or hint)
function ik2(b1, b2, b3, target, hint) {
  const { H, K, A, d, p, x } = _ik;
  b1.getWorldPosition(H); b2.getWorldPosition(K); b3.getWorldPosition(A);
  const L1 = H.distanceTo(K), L2 = K.distanceTo(A);
  d.subVectors(target, H); let D = d.length(); if (D < 1e-5) return; d.multiplyScalar(1 / D);
  D = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, D));
  const ca = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  p.subVectors(K, H); if (hint) p.copy(hint); p.addScaledVector(d, -p.dot(d));
  if (p.lengthSq() < 1e-8) { p.set(0, 0, 1); p.addScaledVector(d, -p.dot(d)); } p.normalize();
  x.copy(H).addScaledVector(d, L1 * ca).addScaledVector(p, L1 * sa);                  // where the middle joint goes
  aim(b1, b2, _ik.t.subVectors(x, H).normalize(), 1);
  b2.getWorldPosition(K);
  aim(b2, b3, _ik.t.subVectors(target, K).normalize(), 1);
}
const _legs = [['L', new THREE.Vector3(), new THREE.Quaternion()], ['R', new THREE.Vector3(), new THREE.Quaternion()]];
const _upY = new THREE.Vector3(0, 1, 0), FOOT_REST = 0.089;
function legPass(h, R, dt, a, stride, spd) {
  const Bn = R.bones, root = h.root, on = a.ground && !a.air && !a.swim && !a.canopy && !a.dead && h.swimS < 0.1;
  h.ikW = (h.ikW || 0) + ((on ? 1 : 0) - (h.ikW || 0)) * Math.min(1, dt * 14);
  const w = h.ikW; if (w < 0.01) { h.pelvis = 0; return; }
  const { g, n, q, q2, inv } = _ik;
  inv.copy(root.matrixWorld).invert();
  let low = 0; const st = h.stand || 0;
  for (const L of _legs) {
    Bn['DEF-foot' + L[0]].getWorldPosition(L[1]); L[1].applyMatrix4(inv);
    // standing: feet under the hips, a hand's width apart, the left a touch forward, flat on the ground
    if (st > 0) { const sg = Math.sign(Bn['DEF-thigh' + L[0]].getWorldPosition(_ik.g).applyMatrix4(inv).x) || 1; L[1].x += (sg * 0.088 - L[1].x) * st; L[1].z += ((L[0] === 'L' ? 0.022 : -0.018) - L[1].z) * st; L[1].y += (FOOT_REST - L[1].y) * st; }
    else if (spd > 2.4) L[1].y = FOOT_REST + (L[1].y - FOOT_REST) * ramp(spd, LIFT);
    L.h = a.ground ? a.ground(L[1].x, L[1].z) : 0; low = Math.min(low, L.h);
  }
  h.pelvis = (h.pelvis || 0) + (Math.max(-0.28, low) * w - (h.pelvis || 0)) * (1 - Math.pow(2, -dt / 0.06));
  root.position.y += h.pelvis;
  // and legs nearly straight under him, weight easing slowly from one foot to the other
  if (st > 0) {
    root.position.x += Math.cos(h.bodyY || 0) * Math.sin(h.t * 0.43) * 0.011 * st; root.position.z += -Math.sin(h.bodyY || 0) * Math.sin(h.t * 0.43) * 0.011 * st;
    root.updateMatrixWorld(true);
    const th = Bn['DEF-thighL'], sh = Bn['DEF-shinL'], ft = Bn['DEF-footL'];
    const lenLeg = th.getWorldPosition(_ik.H).distanceTo(sh.getWorldPosition(_ik.K)) + _ik.K.distanceTo(ft.getWorldPosition(_ik.A));
    _ik.g.copy(_legs[0][1]).setY(FOOT_REST + (_legs[0].h - h.pelvis)).applyMatrix4(root.matrixWorld);
    const dy = Math.sqrt(Math.max(0, (lenLeg * 0.985) ** 2 - (_ik.H.x - _ik.g.x) ** 2 - (_ik.H.z - _ik.g.z) ** 2)) - (_ik.H.y - _ik.g.y);
    root.position.y += Math.max(-0.12, Math.min(0.12, dy)) * st;
  }
  root.updateMatrixWorld(true);
  for (const L of _legs) {
    const S = L[0], th = Bn['DEF-thigh' + S], sh = Bn['DEF-shin' + S], ft = Bn['DEF-foot' + S];
    ft.getWorldQuaternion(L[2]);
    th.getWorldPosition(g).applyMatrix4(inv);   // the hip, in the body's frame (only its z matters; the pelvis drop is along y)
    const zc = g.z - 0.015, lift = L[1].y - FOOT_REST;
    const tx = L[1].x, ty = L[1].y + (L.h - h.pelvis) * w, tz = zc + (L[1].z - zc) * (1 + (stride - 1) * w);
    g.set(tx, ty, tz).applyMatrix4(root.matrixWorld);
    // Planted feet stay planted. The clips hardly put the foot down at speed, so from the moment each foot lands
    // (phase 0.02 left, 0.54 right, in all three loops) until it lifts, its place on the ground is held in the
    // world and the body travels over it. Height and roll still come from the clip and the ground.
    const fp = ((S === 'L' ? h.phase - 0.02 : h.phase - 0.54) + 1) % 1, duty = ramp(spd, DUTY), inStance = R.curName !== 'Idle_Loop' && LOCO.has(R.curName) && spd > 0.35 && fp < duty && w > 0.5;
    if (inStance && !L.lock) { L.lock = true; L.wx = g.x; L.wz = g.z; }
    if (!inStance) L.lock = false;
    if (L.lock) { const lw = sstep(0, 0.045, fp) * (1 - sstep(duty - 0.07, duty, fp)); g.x += (L.wx - g.x) * lw; g.z += (L.wz - g.z) * lw; }
    ik2(th, sh, ft, g);
    // the sole follows the ground while the foot is down, and the clip's foot swing while it is up
    const plant = (1 - sstep(0.03, 0.16, lift)) * w;
    const e = 0.14, gx = a.ground ? a.ground(tx + e, tz) - a.ground(tx - e, tz) : 0, gz = a.ground ? a.ground(tx, tz + e) - a.ground(tx, tz - e) : 0;
    n.set(-gx / (2 * e), 1, -gz / (2 * e)).normalize().transformDirection(root.matrixWorld);
    q.setFromUnitVectors(_upY, n); if (plant < 1) q.slerp(q2.identity(), 1 - plant);
    q2.copy(L[2]).premultiply(q);
    if (st > 0) {   // flat, toes turned a little out
      R.inst.getWorldQuaternion(_qi); _qw.copy(_qi).multiply(R.frames.q[ft.name]);
      _qd.setFromAxisAngle(_upY, (Math.sign(L[1].x) || 1) * 0.16); _qw.premultiply(_qd).premultiply(q);
      q2.slerp(_qw, st);
    }
    ft.parent.getWorldQuaternion(q).invert(); ft.quaternion.copy(q.multiply(q2)); ft.updateMatrixWorld(true);
  }
}
// the hands: open and loose, not the clip's permanent fists; the spear hand keeps its grip
function relaxHands(R, a, spd) {
  if (!R.fingers) return;
  const base = a.canopy && a.canopy.mode !== 'limb' ? (a.canopy.mode === 'air' ? 0.5 : a.canopy.open || 0) : a.action ? 0.15 : spd > 5 ? 0.35 : 0.5, armed = a.weapon && a.weapon !== 'none' && a.weapon !== 'fists';
  for (const f of R.fingers) { const w = f.right && armed ? 0 : base; if (w > 0) f.bone.quaternion.slerp(f.q0, w); }
}

export function animateRiggedHuman(h, dt, a) {
  const R = h.rig, Bn = R.bones;
  h.t += dt;
  const spd = a.speed || 0, act = a.action && a.action.type ? a.action : null;
  const low = act && (act.type === 'gather' || act.type === 'drink' || act.type === 'eat');
  let clip = 'Idle_Loop', ts = 1, fade = 0.25;
  if (a.dead) { clip = 'Death01'; fade = 0.15; }
  else if (a.canopy && a.canopy.mode === 'trunk') { clip = 'Crouch_Fwd_Loop'; ts = 0.0001; fade = 0.15; }
  else if (a.canopy && a.canopy.mode === 'hang') { clip = 'Idle_Loop'; fade = 0.12; }
  else if (a.air) { clip = 'Jump_Start'; fade = 0.12; }
  else if (act && act.type === 'punch') { clip = 'Punch_Jab'; fade = 0.08; ts = 1.4; }
  else if (a.crouch || low || (a.kneel || 0) > 0.3) { clip = 'Crouch_Fwd_Loop'; ts = spd > 0.2 ? Math.min(R.K ? 2.6 : 1.6, Math.max(0.5, spd / (R.K ? 0.69 : 1.1))) : 0.0001; }
  else if (spd > 0.2) {
    if (spd < 2.6) { clip = 'Walk_Loop'; ts = Math.min(1.8, Math.max(0.5, spd / 1.45)); }
    else if (spd < 5.4) { clip = 'Jog_Fwd_Loop'; ts = Math.min(1.5, Math.max(0.7, spd / 3.4)); }
    else { clip = 'Sprint_Loop'; ts = Math.min(1.4, Math.max(0.8, spd / 6.2)); }
  }
  const stride = R.K ? blendMotion(h, R, dt, clip, ts, spd) : (play(R, clip, fade, ts), 1);
  // proportions on top of the clips (the mixer only writes what changed, so keep its own values to compare with)
  if (R.K) for (const e of R.K) e.bone.position.copy(e.raw);
  R.mixer.update(dt);
  if (R.K) { for (const e of R.K) { e.raw.copy(e.bone.position); e.bone.position.multiplyScalar(e.k); } relaxHands(R, a, spd); }
  // Standing still. The idle clip is a fighter's stance, one foot forward and fists up, so it is not used as is: hips and
  // back come to rest, the feet go under him (js legPass), the arms hang loose, and he breathes.
  { const want = R.K && clip === 'Idle_Loop' && spd < 0.3 && !act && !a.aim && !a.canopy && !a.air && !a.dead && !a.swim && a.ground ? 1 : 0;
    // Walking and running he stays upright: the clips hunch and pitch the back (the run most of all) and bounce the hips.
    // The back and hips come most of the way to rest, with only a slight lean into a run.
    const moving = R.K && LOCO.has(clip) && spd >= 0.3 && !act && !a.aim && !a.canopy && !a.air && !a.dead && !a.swim ? 1 : 0;
    h.upright = (h.upright || 0) + (moving - (h.upright || 0)) * (1 - Math.pow(2, -dt / 0.07));
    if (h.upright > 0.002) {
      const u = h.upright, hips = Bn['DEF-hips'], hp = R.frames.hipPos, run = sstep(2.4, 6, spd);
      hips.position.y += (hp.y * (1 - 0.035 * run) - hips.position.y) * u * 0.8;
      hips.position.z += (hp.z - hips.position.z) * u * 0.8;
      R.inst.updateMatrixWorld(true);
      toBind(R, hips, u * 0.75);
      for (const n of ['DEF-spine001', 'DEF-spine002', 'DEF-spine003', 'DEF-neck']) if (Bn[n]) toBind(R, Bn[n], u * 0.9);
      const sp1 = Bn['DEF-spine001'];
      if (sp1) { _v3.set(1, 0, 0).transformDirection(h.root.matrixWorld); sp1.getWorldQuaternion(_q2); _q.setFromAxisAngle(_v3, u * (0.015 + run * 0.075)); _q2.premultiply(_q); sp1.parent.getWorldQuaternion(_q3).invert(); sp1.quaternion.copy(_q3.multiply(_q2)); sp1.updateMatrixWorld(true); }
    }
    h.stand = (h.stand || 0) + (want - (h.stand || 0)) * (1 - Math.pow(2, -dt / 0.09));
    if (h.stand < 0.002) h.stand = 0;
    if (h.stand > 0) {
      const st = h.stand, hips = Bn['DEF-hips'], hp = R.frames.hipPos;
      h.root.getWorldQuaternion(_q2); h.bodyY = 2 * Math.atan2(_q2.y, _q2.w);
      hips.position.x += (hp.x - hips.position.x) * st; hips.position.z += (hp.z - hips.position.z) * st;
      R.inst.updateMatrixWorld(true);
      for (const n of ['DEF-hips', 'DEF-spine001', 'DEF-spine002', 'DEF-spine003', 'DEF-neck', 'DEF-shoulderL', 'DEF-shoulderR']) if (Bn[n]) toBind(R, Bn[n], st);
      const c = Bn['DEF-spine003']; if (c) { c.rotateX(Math.sin(h.t * 1.5) * 0.012 * st); c.updateMatrixWorld(true); }
    } }
  // swimming: lay the body along the water and pull with the arms
  h.swimS += ((a.swim || 0) - h.swimS) * Math.min(1, dt * 4);
  R.body.rotation.x = h.swimS * 1.25; R.body.position.y = -h.swimS * 0.9;
  R.inst.updateMatrixWorld(true);
  if (R.K) legPass(h, R, dt, a, stride, spd);
  // body frame in world space
  const rw = h.root.matrixWorld; _f.set(0, 0, 1).transformDirection(rw); _r.set(-1, 0, 0).transformDirection(rw);
  const uaR = Bn['DEF-upper_armR'], faR = Bn['DEF-forearmR'], hR = Bn['DEF-handR'], uaL = Bn['DEF-upper_armL'], faL = Bn['DEF-forearmL'], hL = Bn['DEF-handL'];
  const w = a.weapon || 'none', lp = a.lookPitch || 0;
  // in the trees (no clips exist for this, so it is posed): hands on the hold, legs hanging and trailing the
  // swing; on a trunk, hand over hand with the knees braced; in a leap, arms reaching up and ahead for the next hold
  const C = a.canopy;
  if (h.stand > 0) {
    const st = h.stand, sw = Math.sin(h.t * 0.9) * 0.012;
    _v3.copy(_f).multiplyScalar(0.14).add(_v2.set(0, -1, 0));
    aim(uaR, faR, _v1.copy(_r).multiplyScalar(0.13).add(_v2.set(0, -1, 0)).addScaledVector(_f, 0.015 + sw).normalize(), st);
    aim(faR, hR, _v1.copy(_v3).addScaledVector(_r, 0.02).normalize(), st);
    aim(uaL, faL, _v1.copy(_r).multiplyScalar(-0.13).add(_v2.set(0, -1, 0)).addScaledVector(_f, 0.015 - sw).normalize(), st);
    aim(faL, hL, _v1.copy(_v3).addScaledVector(_r, -0.02).normalize(), st);
    // palms toward the thighs, thumbs forward
    setFrame(R, hR, R.frames.handR, _v3, _f, st); setFrame(R, hL, R.frames.handL, _v3, _f, st);
  }
  // walking, the arms hang and swing against the legs (the clip carries them out in front of him)
  { const walkW = (h.upright || 0) * (1 - sstep(2.8, 3.6, spd)) * sstep(0.3, 0.9, spd);
    if (walkW > 0.01) {
      const sw = Math.sin((h.phase + 0.25) * Math.PI * 2) * Math.min(0.34, 0.1 + spd * 0.1);
      aim(uaR, faR, _v1.copy(_r).multiplyScalar(0.12).add(_v2.set(0, -1, 0)).addScaledVector(_f, sw).normalize(), walkW);
      aim(faR, hR, _v1.copy(_r).multiplyScalar(0.03).add(_v2.set(0, -1, 0)).addScaledVector(_f, sw + 0.26).normalize(), walkW);
      aim(uaL, faL, _v1.copy(_r).multiplyScalar(-0.12).add(_v2.set(0, -1, 0)).addScaledVector(_f, -sw).normalize(), walkW);
      aim(faL, hL, _v1.copy(_r).multiplyScalar(-0.03).add(_v2.set(0, -1, 0)).addScaledVector(_f, -sw + 0.26).normalize(), walkW);
    } }
  if (C && !a.dead && C.mode === 'limb') {   // out on a limb: arms held out for balance
    aim(uaR, faR, _v1.copy(_r).multiplyScalar(0.9).add(_v2.set(0, -0.25, 0)).normalize(), 0.65);
    aim(uaL, faL, _v1.copy(_r).multiplyScalar(-0.9).add(_v2.set(0, -0.25, 0)).normalize(), 0.65);
  }
  if (C && !a.dead && C.mode !== 'limb') {
    const thL = Bn['DEF-thighL'], shL = Bn['DEF-shinL'], ftL = Bn['DEF-footL'], thR = Bn['DEF-thighR'], shR = Bn['DEF-shinR'], ftR = Bn['DEF-footR'];
    const reach = (ua, fa, hb, target) => { ua.getWorldPosition(_v1); aim(ua, fa, _v2.subVectors(target, _v1).normalize(), 1); fa.getWorldPosition(_v1); aim(fa, hb, _v2.subVectors(target, _v1).normalize(), 1); };
    if (C.mode === 'hang' || C.mode === 'trunk') {
      if (R.K) {   // a real two-bone reach: elbows out and down, straight only when the hold is at full stretch
        ik2(uaR, faR, hR, C.gripR, _v3.copy(_r).multiplyScalar(0.9).addScaledVector(_f, -0.2).add(_v2.set(0, -0.5, 0)));
        ik2(uaL, faL, hL, C.gripL, _v3.copy(_r).multiplyScalar(-0.9).addScaledVector(_f, -0.2).add(_v2.set(0, -0.5, 0)));
        // and the hands themselves: the forearm turns with the hand, so the wrist is not wrung
        for (const [fa, hb, F, thumb, fr, fra] of [[faR, hR, C.fingersR, C.thumbR, R.frames.handR, R.frames.armR], [faL, hL, C.fingersL, C.thumbL, R.frames.handL, R.frames.armL]]) {
          fa.getWorldPosition(_v1); hb.getWorldPosition(_v2);
          setFrame(R, fa, fra, _v4.subVectors(_v2, _v1), thumb);
          setFrame(R, hb, fr, F, thumb);
        }
      } else { reach(uaR, faR, hR, C.gripR); reach(uaL, faL, hL, C.gripL); }
    }
    if (C.mode === 'hang') {
      // legs trail the swing; skimming the ground he tucks them, thighs up and forward, shins hanging
      const down = _v3.copy(C.up).negate().addScaledVector(C.vel, -0.05).normalize(), kick = Math.sin(h.t * 3) * 0.12 * (1 - (C.tuck || 0));
      h.tuck = (h.tuck || 0) + ((C.tuck || 0) - (h.tuck || 0)) * Math.min(1, dt * 10);
      h.climbLeg = (h.climbLeg || 0) + ((C.climbing || 0) - (h.climbLeg || 0)) * Math.min(1, dt * 8);
      const leg = (s) => { const k = Math.max(h.tuck, h.climbLeg * (s > 0 ? C.legL : C.legR) * 0.85); return _v4.copy(down).multiplyScalar(1 - k * 0.85).addScaledVector(_f, k * 0.95 + s * kick).addScaledVector(_r, -0.12 * s).normalize(); };
      aim(thL, shL, leg(1), 1); aim(shL, ftL, _v4.copy(down).addScaledVector(_f, -0.15 - h.tuck * 0.2).normalize(), 1);
      aim(thR, shR, leg(-1), 1); aim(shR, ftR, _v4.copy(down).addScaledVector(_f, -0.15 - h.tuck * 0.2).normalize(), 1);
    } else if (C.mode === 'trunk') {
      // the feet are on the wood too (the climb's gait places them), knees out to the sides, soles flat against it
      const inn = _v3.copy(C.out).negate();
      for (const [th, sh, ft, s, target, fr] of [[thL, shL, ftL, -1, C.footL, R.K && R.frames.footL], [thR, shR, ftR, 1, C.footR, R.K && R.frames.footR]]) {
        ik2(th, sh, ft, target, _v4.copy(_r).multiplyScalar(s * 0.45).add(_v1.set(0, 0.35, 0)).addScaledVector(inn, -0.8));
        if (fr) setFrame(R, ft, fr, _v4.set(0, 0.55, 0).addScaledVector(inn, 0.85), _v1.copy(_r).negate());
      }
    } else if (C.mode === 'air') {
      const ahead = _v3.copy(C.vel).setY(0).multiplyScalar(0.12).add(_v4.set(0, 1, 0)).normalize();
      aim(uaR, faR, _v1.copy(ahead).addScaledVector(_r, 0.25).normalize(), 0.9); aim(faR, hR, ahead, 0.9);
      aim(uaL, faL, _v1.copy(ahead).addScaledVector(_r, -0.25).normalize(), 0.9); aim(faL, hL, ahead, 0.9);
    }
  }
  const aimDir = _v4.copy(_f).applyAxisAngle(_r, -lp).normalize();
  if (!a.dead && h.swimS < 0.5 && !(C && C.mode !== 'limb')) {
    // carried weapon: right forearm held forward
    if (['spear', 'club', 'torch', 'knife'].includes(w) && !act) { aim(faR, hR, dirOf(_v1, 0.85, 0.15, -0.05), 0.7); }
    if (w === 'spear' && !act && !(a.aim > 0.01)) { aim(faL, hL, dirOf(_v1, 0.8, 0.3, 0.15), 0.6); }
    if (a.aim > 0.01 && w === 'bow') {
      const d = a.draw || 0, k = a.aim;
      aim(uaL, faL, aimDir, k); aim(faL, hL, aimDir, k);
      aim(uaR, faR, _v1.copy(aimDir).multiplyScalar(0.35).addScaledVector(_r, 0.75).normalize(), k);
      aim(faR, hR, _v2.copy(aimDir).multiplyScalar(-0.6 - d * 0.4).addScaledVector(_r, -0.5).normalize(), k);
    }
    if (a.aim > 0.01 && w === 'spear') {
      aim(uaR, faR, dirOf(_v1, -0.45, 0.75, 0.25), a.aim); aim(faR, hR, dirOf(_v2, 0.55, 0.65, 0), a.aim);
      aim(uaL, faL, aimDir, a.aim * 0.8);
    }
    if (act) {
      const t = act.t;
      if (act.type === 'swing') {
        const wind = ease(Math.min(1, t / 0.35)), strike = ease(Math.min(1, Math.max(0, (t - 0.35) / 0.18))), rec = ease(Math.max(0, (t - 0.6) / 0.4));
        const up = lerp(lerp(0.2, 0.95, wind), -0.55, strike), fw = lerp(lerp(0.6, -0.35, wind), 0.85, strike);
        const k = 1 - rec;
        aim(uaR, faR, dirOf(_v1, fw, up, 0.25), k); aim(faR, hR, dirOf(_v2, fw + 0.2, up + 0.1, 0.05), k);
      } else if (act.type === 'stab' || act.type === 'thrust') {
        const wind = ease(Math.min(1, t / 0.28)), strike = ease(Math.min(1, Math.max(0, (t - 0.28) / 0.13))), rec = ease(Math.max(0, (t - 0.5) / 0.5));
        const fw = lerp(lerp(0.4, -0.5, wind), 1, strike);
        aim(uaR, faR, dirOf(_v1, fw, -0.1, 0.35 - strike * 0.3), 1 - rec); aim(faR, hR, aimDir, (1 - rec) * strike);
        if (act.type === 'thrust') aim(faL, hL, aimDir, (1 - rec) * strike * 0.8);
      } else if (act.type === 'throw') {
        const strike = ease(Math.min(1, t / 0.25)), rec = ease(Math.max(0, (t - 0.35) / 0.65));
        aim(uaR, faR, dirOf(_v1, lerp(-0.5, 0.9, strike), lerp(0.8, 0.1, strike), 0.2), 1 - rec); aim(faR, hR, dirOf(_v2, lerp(0.4, 1, strike), lerp(0.7, -0.1, strike), 0), 1 - rec);
      } else if (act.type === 'block') {
        aim(uaR, faR, dirOf(_v1, 0.7, -0.2, 0.55), 1); aim(faR, hR, dirOf(_v2, 0.3, 0.9, -0.4), 1);
        aim(uaL, faL, dirOf(_v1, 0.7, -0.2, -0.55), 1); aim(faL, hL, dirOf(_v2, 0.3, 0.9, 0.4), 1);
      } else if (low) {
        const s = Math.sin(Math.min(1, t) * Math.PI);
        aim(uaR, faR, dirOf(_v1, 0.7, -0.8, 0.05), s); aim(faR, hR, dirOf(_v2, act.type === 'eat' ? -0.2 : 0.6, act.type === 'eat' ? 0.9 : -0.7, -0.1), s);
        if (act.type === 'drink') { aim(uaL, faL, dirOf(_v1, 0.7, -0.8, -0.05), s); aim(faL, hL, dirOf(_v2, 0.6, -0.7, 0.1), s); }
      } else if (act.type === 'flute' || act.type === 'hum') {
        aim(uaR, faR, dirOf(_v1, 0.45, -0.75, 0.45), 1); aim(faR, hR, dirOf(_v2, 0.35, 0.8, -0.5), 1);
        aim(uaL, faL, dirOf(_v1, 0.45, -0.75, -0.45), 1); aim(faL, hL, dirOf(_v2, 0.55, 0.75, 0.35), 1);
      } else if (act.type === 'roar') {
        const s = Math.sin(Math.min(1, t) * Math.PI), beat = Math.sin(t * 40) * 0.2;
        aim(uaR, faR, dirOf(_v1, 0.3, 0.1, 0.9), s); aim(faR, hR, dirOf(_v2, 0.2, 0.9 + beat, 0.2), s);
        aim(uaL, faL, dirOf(_v1, 0.3, 0.1, -0.9), s); aim(faL, hL, dirOf(_v2, 0.2, 0.9 - beat, -0.2), s);
      } else if (act.type === 'hit') {
        const s = Math.sin(Math.min(1, t) * Math.PI); const sp = Bn['DEF-spine002']; if (sp) { sp.rotateX(-s * 0.35); sp.updateMatrixWorld(true); }
      }
    }
    if (h.swimS > 0.01) { const sw = h.t * 2.6; aim(uaR, faR, dirOf(_v1, Math.cos(sw), 0.3, 0.3), h.swimS * 0.8); aim(uaL, faL, dirOf(_v1, -Math.cos(sw), 0.3, -0.3), h.swimS * 0.8); }
  }
  if (a.reach && R.K && !a.dead && a.reach.w > 0.001) {
    hR.getWorldPosition(_v1).lerp(a.reach.to, a.reach.w);
    ik2(uaR, faR, hR, _v1, _v3.copy(_r).multiplyScalar(0.8).add(_v2.set(0, 0.25, 0)).addScaledVector(_f, -0.3));
  }
  // grip frames follow the hands: fingers along -Y, handle along +Z
  for (const [grip, fa, hb, side] of [[h.j.handR, faR, hR, 1], [h.j.handL, faL, hL, -1]]) {
    fa.getWorldPosition(_a); hb.getWorldPosition(_b);
    const fd = _d.subVectors(_b, _a).normalize();
    const handle = _v3.copy(_r).multiplyScalar(side).cross(fd).normalize();
    if (handle.lengthSq() < 1e-6) handle.copy(_f);
    const y = _v1.copy(fd).negate(), z = handle, x = _v2.crossVectors(y, z).normalize(); z.crossVectors(x, y).normalize();
    _m.makeBasis(x, y, z);
    grip.position.copy(_b).addScaledVector(fd, 0.06);
    grip.quaternion.setFromRotationMatrix(_m);
    h.root.updateMatrixWorld(); // grips are children of root: convert world -> local
    grip.parent.worldToLocal(grip.position);
    grip.quaternion.premultiply(_q.setFromRotationMatrix(_m.extractRotation(grip.parent.matrixWorld)).invert());
  }
  // the sling follows the upper back
  { const sp = Bn['DEF-spine003']; if (sp && h.j.back) { sp.getWorldPosition(_a); h.j.back.position.copy(h.root.worldToLocal(_a)); h.j.back.position.z -= 0.16; } }
  // what he carries is tied to the upper back, and turns and bends with it
  { const sp = Bn['DEF-spine003'], pk = h.j.pack;
    if (sp && pk && R.frames) {
      sp.getWorldPosition(_a); pk.position.copy(h.root.worldToLocal(_a));
      h.root.getWorldQuaternion(_q3).invert();
      R.inst.getWorldQuaternion(_q2); _q.copy(_q3).multiply(_q2).invert();                 // the body's own turn inside the root
      sp.getWorldQuaternion(_q2); _q2.multiply(_qi.copy(R.frames.q[sp.name]).invert()).multiply(_q);   // the back, relative to its rest
      pk.quaternion.copy(_q3).multiply(_q2);
    } }
  // the head turns toward something worth watching, smoothly and within a natural range (world-space, so it does
  // not depend on the bone's own axes): right is negative yaw about the up axis, up is positive about body-right
  const head = Bn['DEF-head'];
  if (head && !a.dead) {
    let wy = 0, wp = 0;
    if (a.lookAt) {
      head.getWorldPosition(_v1); _v2.subVectors(a.lookAt, _v1);
      const fx = _v2.dot(_f), rx = _v2.dot(_r);
      if (fx > -0.2) { wy = Math.max(-1.0, Math.min(1.0, Math.atan2(-rx, fx))); wp = Math.max(-0.45, Math.min(0.35, Math.atan2(_v2.y, Math.hypot(fx, rx)))); }
    }
    const k = 1 - Math.pow(2, -dt / 0.18);
    h.lookY = (h.lookY || 0) + (wy - (h.lookY || 0)) * k; h.lookP = (h.lookP || 0) + (wp - (h.lookP || 0)) * k;
    if (Math.abs(h.lookY) + Math.abs(h.lookP) > 0.005) {
      head.getWorldQuaternion(_q2);
      _q.setFromAxisAngle(_v3.set(0, 1, 0), h.lookY); _q2.premultiply(_q);
      _q.setFromAxisAngle(_r, h.lookP); _q2.premultiply(_q);
      head.parent.getWorldQuaternion(_q3).invert(); head.quaternion.copy(_q3.multiply(_q2)); head.updateMatrixWorld(true);
    }
  }
  h.dead = a.dead ? Math.min(1, (h.dead || 0) + dt * 1.6) : 0;
  // the painted face: he blinks every few seconds (sometimes twice), his eyes lead his head, his mouth opens when
  // he's working hard, and his hair lags behind his movement
  if (h.faceU) {
    h.blinkT = (h.blinkT ?? 2) - dt; let b = 0;
    if (h.blinkT < 0) { const q = -h.blinkT / 0.15; if (q < 1) b = Math.sin(q * Math.PI); else h.blinkT = Math.random() < 0.15 ? 0.12 : 1.8 + Math.random() * 4.2; }
    const U = h.faceU;
    U.blink.value = a.dead ? 1 : b;
    const lx = Math.max(-1, Math.min(1, (h.lookY || 0) * 1.5)), ly = Math.max(-1, Math.min(1, (h.lookP || 0) * 1.8));
    U.look.value.set(lx, ly);
    const work = a.dead ? 0.2 : Math.max(spd > 5 ? 0.55 : spd > 2.6 ? 0.18 : 0, a.air ? 0.35 : 0, a.canopy && a.canopy.mode !== 'limb' ? 0.3 : 0);
    U.mouth.value += (work - U.mouth.value) * Math.min(1, dt * 5);
    U.brow.value += ((a.air ? 0.8 : 0) - U.brow.value) * Math.min(1, dt * 6);
  }
  if (h.hairU && head) {
    h.lastHead = h.lastHead || head.getWorldPosition(new THREE.Vector3()).clone();
    head.getWorldPosition(_v1); _v2.subVectors(_v1, h.lastHead); h.lastHead.copy(_v1);
    if (dt > 0) _v2.multiplyScalar(-0.012 / dt).clampLength(0, 0.09);
    head.getWorldQuaternion(_q2).invert(); _v2.applyQuaternion(_q2);
    h.hairU.push.value.lerp(_v2, Math.min(1, dt * 7));
  }
}

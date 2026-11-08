// Wildlife of Pench: procedural rigs + coat shaders, gaits, and behaviour AI for tiger, leopard, dhole,
// Indian wolf, sloth bear, gaur, sambar, chital, wild boar, grey langur, peafowl, mugger, village cattle & dogs.
// Herds, packs and troops; perception (sight/hearing/stealth); alarm-call network; bonding; companions; carcasses.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch, NOISE_GLSL } from '../core/shaderlib.js';
import { mergeByMaterial } from '../core/merge.js';
import { PAINTED } from '../core/palette.js';
import { toon, toonify } from '../core/toon.js';
import { hasRig, makeRigged, playClip } from './rigged.js';
import { groundHeight, waterAt, biomeAt, height, HALF } from '../world/terrain.js';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/noise.js';

// ------------------------------------------------------------------------------------------------ geometry helpers
function ellip(rx, ry, rz, seg = 12, bumpy = 0) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.floor(seg * 0.7)));
  if (bumpy) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + bumpy * Math.sin(i * 7.31) * Math.cos(i * 3.17); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } g.computeVertexNormals(); }
  g.scale(rx, ry, rz); return g;
}
function limbDown(r0, r1, len, radial = 8) {
  const c = new THREE.CylinderGeometry(r1, r0, len, radial, 3, true); c.translate(0, -len / 2, 0);
  const s0 = new THREE.SphereGeometry(r0, radial, 5), s1 = new THREE.SphereGeometry(r1, radial, 5); s1.translate(0, -len, 0);
  return mergeGeometries([c, s0, s1]);
}
const fwd = (g) => g.rotateX(-Math.PI / 2); // -y -> +z
// Lofted torso: elliptical cross-sections with separate top/bottom radii along the body (rear -> front)
const PROFILES = {
  generic: [[0, .2, .25, .25, .1], [.08, .72, .8, .75, .08], [.2, .92, .95, .9, .05], [.42, .82, .86, .8, 0], [.62, .88, .9, .95, 0], [.8, .95, 1, 1, .05], [.92, .8, .85, .72, .15], [1, .28, .3, .28, .3]],
  cat: [[0, .2, .25, .25, .12], [.08, .75, .85, .8, .1], [.22, .95, .95, .85, .06], [.44, .7, .82, .62, .04], [.64, .8, .88, .9, 0], [.8, .92, .98, 1.05, .02], [.92, .78, .85, .75, .12], [1, .28, .32, .3, .28]],
  deer: [[0, .2, .25, .25, .18], [.08, .7, .9, .7, .15], [.22, .88, 1.05, .82, .1], [.44, .8, .9, .85, 0], [.64, .85, .88, 1.0, -.04], [.8, .9, .92, 1.06, 0], [.92, .7, .78, .75, .18], [1, .25, .3, .26, .35]],
  bovine: [[0, .2, .25, .25, .12], [.08, .75, .85, .78, .1], [.22, .92, .95, .92, .05], [.44, .9, .9, 1.0, 0], [.64, .92, 1.05, 1.05, .02], [.78, .9, 1.45, 1.1, .1], [.9, .75, 1.1, .95, .2], [1, .3, .4, .35, .35]],
  canid: [[0, .2, .25, .22, .15], [.08, .7, .82, .7, .12], [.22, .85, .9, .75, .06], [.44, .7, .8, .55, .06], [.64, .82, .88, .9, 0], [.8, .92, .98, 1.12, -.02], [.92, .75, .85, .8, .12], [1, .28, .32, .3, .3]],
  bear: [[0, .3, .35, .3, .1], [.1, .85, .9, .85, .08], [.25, 1, 1, .95, .04], [.45, .98, .98, .95, 0], [.65, 1, 1.05, 1, 0], [.8, .98, 1.18, 1, .06], [.93, .8, .95, .8, .14], [1, .35, .4, .35, .28]],
  boar: [[0, .2, .25, .22, .1], [.1, .7, .78, .7, .08], [.25, .8, .85, .82, .04], [.45, .85, .9, .9, 0], [.65, .95, 1.05, 1.0, .02], [.8, 1, 1.2, 1.05, .06], [.92, .85, 1.0, .85, .14], [1, .35, .4, .35, .25]],
};
function torsoGeo(L, W, R, profName) {
  const P = PROFILES[profName] || PROFILES.generic;
  const segs = 20, radial = 18, pos = [], uv = [], idx = [];
  const at = (t) => { let i = 0; while (i < P.length - 2 && P[i + 1][0] < t) i++; const a = P[i], b = P[i + 1]; let k = (t - a[0]) / (b[0] - a[0]); k = k * k * (3 - 2 * k); return a.map((v, j) => v + (b[j] - v) * k); };
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = at(t), z = (t - 0.5) * L * 1.02;
    const rx = W * p[1], rt = R * p[2], rb = R * p[3], cy = R * p[4];
    for (let k = 0; k <= radial; k++) {
      const a = k / radial * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pos.push(c * rx, cy + (sn > 0 ? sn * rt : sn * rb), z); uv.push(k / radial, t);
    }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < radial; k++) { const a = i * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // weld seam normals
  const n = g.attributes.normal;
  for (let i = 0; i <= segs; i++) { const a = i * (radial + 1), b = a + radial; const x = (n.getX(a) + n.getX(b)) / 2, y = (n.getY(a) + n.getY(b)) / 2, zz = (n.getZ(a) + n.getZ(b)) / 2; n.setXYZ(a, x, y, zz); n.setXYZ(b, x, y, zz); }
  return g;
}
const back = (g) => g.rotateX(Math.PI / 2); // -y -> -z

// ------------------------------------------------------------------------------------------------ coat material
const COATS = {
  tiger: 0, leopard: 1, chital: 2, sambar: 3, gaur: 4, dhole: 5, bear: 6, boar: 7, langur: 8, wolf: 9, cow: 10, dog: 11, croc: 12, peafowl: 13, flayed: 14,
};
const coatCache = {};
export function coatMaterial(kind, bellyY = 0.4, headC = [0, 0.65, 0.6]) {
  if (coatCache[kind]) return coatCache[kind];
  // the painted look keeps every coat's markings (stripes, rosettes, spots) but drops the fur noise, on toon light
  const m = PAINTED ? toon({ rim: 0.6, key: 'coat' }) : new THREE.MeshStandardMaterial({ roughness: kind === 'croc' ? 0.55 : kind === 'flayed' ? 0.35 : 0.88, metalness: 0, color: 0xffffff });
  const prev = m.onBeforeCompile;
  patch(m, (PAINTED ? 'coat-p-' : 'coat-') + kind, (s, r) => {
    if (PAINTED) prev(s, r);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute vec3 aRest; varying vec3 vR;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vR = aRest;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n ${NOISE_GLSL}\n varying vec3 vR; uniform float uWetness;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 r = vR; float fur = fbm3(r * vec3(60.0, 60.0, 60.0)) ; float lowN = fbm3(r * 4.0);
        vec3 c = vec3(0.5);
        int K = ${COATS[kind]};
        float by = ${bellyY.toFixed(3)};
        vec3 hc = vec3(0.0, ${headC[1].toFixed(3)}, ${headC[2].toFixed(3)});
        float belly = smoothstep(by + 0.1, by + 0.015, r.y + abs(r.x) * 0.8) * smoothstep(by - 0.07, by - 0.01, r.y);
        if (K == 0) { // tiger: dense, forked, varying-width stripes; ringed legs and tail; white face markings
          c = mix(vec3(0.76, 0.35, 0.07), vec3(0.9, 0.53, 0.18), lowN);
          c = mix(c, vec3(0.58, 0.25, 0.05), smoothstep(0.5, 0.68, r.y) * 0.45 * (1.0 - smoothstep(0.5, 0.62, r.z)));
          float onLeg = 1.0 - smoothstep(by - 0.1, by + 0.02, r.y);
          float warp = fbm3(r * 6.0) * 6.5;
          float bodyArg = r.z * 80.0 + warp + abs(r.x) * 7.0 + r.y * 6.0;
          float legArg = r.y * 92.0 + warp * 0.6 + r.z * 10.0;
          float arg = mix(bodyArg, legArg, onLeg);
          float st = sin(arg);
          float w = 0.5 + 0.3 * fbm3(r * 11.0 + 7.0);
          float fw = fwidth(st) + 0.03;
          float stripe = smoothstep(w - fw, w + fw, st);
          stripe *= smoothstep(0.14, 0.4, fbm3(r * 15.0 + 3.0));                  // broken / forked stripes
          stripe *= 1.0 - smoothstep(0.06, 0.0, r.y) * 0.9;                         // plain paws
          stripe = mix(0.16, stripe, 1.0 - smoothstep(0.9, 2.6, fwidth(arg)));       // fade to mean when it would alias
          vec3 q = r - hc;
          float onHead = smoothstep(-0.03, 0.02, r.z - hc.z + 0.06);
          float face = onHead * smoothstep(0.01, -0.03, q.y) * (1.0 - smoothstep(0.03, 0.012, abs(q.x)) * smoothstep(-0.07, -0.035, q.y) * 0.85); // white cheeks / chin, orange nose bridge
          float brow = onHead * (1.0 - smoothstep(0.012, 0.026, length(vec2(abs(q.x) - 0.045, q.y - 0.045)))) ;
          float fore = onHead * smoothstep(0.02, 0.06, q.y) * smoothstep(0.55, 0.8, sin(q.z * 150.0 + abs(q.x) * 70.0 + warp * 0.3)) * smoothstep(0.08, 0.0, abs(q.x));
          float tailTip = smoothstep(-0.86, -0.92, r.z);
          c = mix(c, vec3(0.93, 0.89, 0.8), max(belly * (1.0 - onHead), max(face * 0.92, brow)));
          c = mix(c, vec3(0.03, 0.02, 0.015), max(stripe * (1.0 - belly * 0.35) * (1.0 - onHead * 0.85), max(fore, tailTip)));
        } else if (K == 1) { // leopard rosettes
          c = mix(vec3(0.66, 0.46, 0.18), vec3(0.8, 0.6, 0.3), lowN);
          c = mix(c, vec3(0.9, 0.86, 0.76), belly);
          vec2 cl = cell3(r * 24.0);
          float ring = smoothstep(0.18, 0.26, cl.x) * (1.0 - smoothstep(0.34, 0.44, cl.x));
          float spot = 1.0 - smoothstep(0.22, 0.32, cl.x);
          float onLeg = smoothstep(0.35, 0.2, r.y);
          float m2 = mix(ring, spot, onLeg);
          c = mix(c, vec3(0.04, 0.03, 0.02), m2 * 0.95);
        } else if (K == 2) { // chital spots
          c = mix(vec3(0.55, 0.26, 0.09), vec3(0.66, 0.36, 0.14), lowN);
          vec2 cl = cell3(r * 30.0);
          float sp = (1.0 - smoothstep(0.16, 0.24, cl.x)) * smoothstep(0.36, 0.5, r.y);
          c = mix(c, vec3(0.92, 0.88, 0.8), sp);
          c = mix(c, vec3(0.93, 0.9, 0.85), belly);
          c = mix(c, vec3(0.25, 0.12, 0.05), smoothstep(0.03, 0.0, abs(r.x)) * smoothstep(0.5, 0.56, r.y));
        } else if (K == 3) { // sambar
          c = mix(vec3(0.22, 0.16, 0.11), vec3(0.33, 0.25, 0.18), lowN);
          c = mix(c, vec3(0.42, 0.33, 0.24), belly * 0.6);
        } else if (K == 4) { // gaur
          c = mix(vec3(0.09, 0.06, 0.045), vec3(0.18, 0.11, 0.07), lowN);
          c = mix(c, vec3(0.86, 0.8, 0.6), smoothstep(0.17, 0.12, r.y));
          c = mix(c, vec3(0.55, 0.5, 0.4), smoothstep(0.62, 0.66, r.z) * smoothstep(0.5, 0.55, r.y));
        } else if (K == 5) { // dhole
          c = mix(vec3(0.6, 0.24, 0.07), vec3(0.72, 0.34, 0.12), lowN);
          c = mix(c, vec3(0.86, 0.72, 0.5), belly);
          c = mix(c, vec3(0.06, 0.04, 0.03), smoothstep(-0.85, -0.95, r.z));
        } else if (K == 6) { // sloth bear
          c = vec3(0.025, 0.02, 0.018) * (0.7 + lowN * 0.6);
          float vmark = smoothstep(0.05, 0.0, abs(abs(r.x) - (0.62 - r.y) * 0.5)) * smoothstep(0.4, 0.5, r.z) * smoothstep(0.3, 0.45, r.y) * (1.0 - smoothstep(0.62, 0.66, r.y));
          c = mix(c, vec3(0.85, 0.78, 0.62), vmark);
          c = mix(c, vec3(0.6, 0.55, 0.48), smoothstep(0.78, 0.86, r.z));
        } else if (K == 7) { // boar
          c = mix(vec3(0.13, 0.11, 0.09), vec3(0.25, 0.21, 0.17), fbm3(r * 18.0));
        } else if (K == 8) { // langur
          c = mix(vec3(0.55, 0.54, 0.5), vec3(0.72, 0.7, 0.65), lowN);
          c = mix(c, vec3(0.86, 0.84, 0.78), belly);
          c = mix(c, vec3(0.04, 0.035, 0.03), smoothstep(0.52, 0.58, r.z) * smoothstep(0.55, 0.6, r.y));
          c = mix(c, vec3(0.06, 0.05, 0.05), smoothstep(0.1, 0.05, r.y));
        } else if (K == 9) { // wolf
          c = mix(vec3(0.45, 0.4, 0.33), vec3(0.6, 0.52, 0.4), lowN);
          c = mix(c, vec3(0.25, 0.22, 0.2), smoothstep(0.45, 0.6, r.y) * 0.6);
          c = mix(c, vec3(0.85, 0.82, 0.74), belly);
        } else if (K == 10) { // zebu cow
          c = mix(vec3(0.78, 0.76, 0.72), vec3(0.6, 0.58, 0.56), smoothstep(0.4, 0.8, lowN));
        } else if (K == 11) { // dog
          c = mix(vec3(0.55, 0.4, 0.25), vec3(0.75, 0.6, 0.4), lowN); c = mix(c, vec3(0.9, 0.85, 0.75), belly);
        } else if (K == 12) { // mugger
          vec2 cl = cell3(r * 40.0);
          c = mix(vec3(0.17, 0.19, 0.12), vec3(0.3, 0.3, 0.2), lowN);
          c *= 0.75 + 0.35 * smoothstep(0.0, 0.5, cl.y - cl.x);
          c = mix(c, vec3(0.08, 0.08, 0.06), smoothstep(0.5, 0.7, sin(r.z * 18.0)) * 0.6);
          c = mix(c, vec3(0.55, 0.52, 0.4), belly);
        } else if (K == 13) { // peafowl
          c = vec3(0.04, 0.2, 0.55);
          c = mix(c, vec3(0.35, 0.33, 0.18), smoothstep(0.45, 0.4, r.y) * smoothstep(0.1, 0.0, r.z));
          vec2 cl = cell3(r * 26.0);
          float eye = (1.0 - smoothstep(0.1, 0.16, cl.x)) * smoothstep(-0.2, -0.4, r.z);
          vec3 train = mix(vec3(0.15, 0.3, 0.1), vec3(0.3, 0.35, 0.1), lowN);
          c = mix(c, train, smoothstep(-0.15, -0.3, r.z));
          c = mix(c, vec3(0.05, 0.12, 0.45), eye); c = mix(c, vec3(0.9, 0.7, 0.2), eye * smoothstep(0.08, 0.12, cl.x));
        } else { // flayed carcass
          c = mix(vec3(0.42, 0.04, 0.03), vec3(0.75, 0.55, 0.45), smoothstep(0.55, 0.7, fbm3(r * 20.0)));
        }
        ${PAINTED ? '' : 'c *= 0.84 + 0.32 * fur;'}
        c = pow(max(c, vec3(0.0)), vec3(2.2));
        diffuseColor.rgb = c * mix(1.0, 0.7, uWetness);`);
  });
  coatCache[kind] = m;
  return m;
}
const eyeMat = PAINTED ? toon({ color: 0x120c06, rim: 0 }) : new THREE.MeshStandardMaterial({ color: 0x120c06, roughness: 0.15 });
const hornMat = PAINTED ? toon({ color: 0x8a7a64 }) : new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.6 });
const clawMat = PAINTED ? toon({ color: 0xd8d0c0 }) : new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.4 });

// ------------------------------------------------------------------------------------------------ species definitions
export const DEF = {
  tiger: { L: 1.95, H: 1.0, W: 0.26, R: 0.33, neck: 0.3, head: [0.24, 0.22, 0.28], tail: 0.95, leg: [0.44, 0.38, 0.12], legR: 0.11, coat: 'tiger', kind: 'predator', hp: 520, walk: 1.5, trot: 4, run: 16, turn: 2.6, sight: 65, hear: 45, fov: 0.0, reach: 2.4, pounce: 10, dmg: 34, courage: 0.95, fearFire: 0.85, mass: 220, ears: 'round', voice: 'tiger', cat: true, radius: 0.7 },
  leopard: { L: 1.35, H: 0.68, W: 0.2, R: 0.21, neck: 0.25, head: [0.14, 0.13, 0.17], tail: 0.85, leg: [0.3, 0.27, 0.09], legR: 0.06, coat: 'leopard', kind: 'predator', hp: 210, walk: 1.4, trot: 3.6, run: 15, turn: 3.2, sight: 55, hear: 50, fov: 0.0, reach: 1.9, pounce: 8, dmg: 26, courage: 0.75, fearFire: 0.9, mass: 60, ears: 'round', voice: 'leopard', cat: true, radius: 0.5 },
  dhole: { L: 0.95, H: 0.52, W: 0.13, R: 0.15, neck: 0.2, head: [0.09, 0.09, 0.15], tail: 0.42, leg: [0.22, 0.2, 0.08], legR: 0.04, coat: 'dhole', kind: 'pack', hp: 65, walk: 1.6, trot: 4.5, run: 13, turn: 4, sight: 55, hear: 60, fov: 0.0, reach: 1.4, pounce: 0, dmg: 6, courage: 0.6, fearFire: 0.8, mass: 16, ears: 'round', voice: 'dhole', bushy: true, radius: 0.35 },
  wolf: { L: 1.1, H: 0.7, W: 0.15, R: 0.17, neck: 0.24, head: [0.1, 0.1, 0.18], tail: 0.45, leg: [0.3, 0.26, 0.1], legR: 0.05, coat: 'wolf', kind: 'companion', hp: 160, walk: 1.6, trot: 4.5, run: 13, turn: 4, sight: 60, hear: 60, fov: 0.0, reach: 1.5, pounce: 0, dmg: 16, courage: 0.9, fearFire: 0.2, mass: 28, ears: 'pointed', voice: 'wolf', bushy: true, radius: 0.4 },
  bear: { L: 1.5, H: 0.85, W: 0.3, R: 0.35, neck: 0.18, head: [0.15, 0.15, 0.22], tail: 0.08, leg: [0.3, 0.26, 0.1], legR: 0.1, coat: 'bear', kind: 'defensive', hp: 300, walk: 1.0, trot: 3, run: 9, turn: 2.5, sight: 18, hear: 25, fov: 0.0, reach: 1.8, pounce: 0, dmg: 32, courage: 0.85, fearFire: 0.6, mass: 120, ears: 'round', voice: 'bear', shaggy: 0.12, radius: 0.6 },
  gaur: { L: 2.6, H: 1.75, W: 0.42, R: 0.5, neck: 0.4, head: [0.2, 0.25, 0.4], tail: 0.7, leg: [0.6, 0.5, 0.14], legR: 0.12, coat: 'gaur', kind: 'neutral', hp: 800, walk: 1.2, trot: 3.5, run: 10, turn: 1.6, sight: 40, hear: 35, fov: -0.5, reach: 2.6, pounce: 0, dmg: 55, courage: 0.8, fearFire: 0.5, mass: 900, ears: 'side', voice: 'gaur', hump: true, horns: 'gaur', radius: 1.0 },
  sambar: { L: 1.8, H: 1.35, W: 0.27, R: 0.33, neck: 0.48, head: [0.13, 0.15, 0.3], tail: 0.25, leg: [0.48, 0.42, 0.13], legR: 0.07, coat: 'sambar', kind: 'prey', hp: 170, walk: 1.3, trot: 3.8, run: 12, turn: 2.5, sight: 50, hear: 55, fov: -0.6, reach: 1.5, pounce: 0, dmg: 14, courage: 0.15, fearFire: 1, mass: 200, ears: 'big', voice: 'sambar', antlers: 'sambar', radius: 0.7 },
  chital: { L: 1.3, H: 0.9, W: 0.18, R: 0.22, neck: 0.36, head: [0.09, 0.11, 0.22], tail: 0.2, leg: [0.34, 0.3, 0.09], legR: 0.045, coat: 'chital', kind: 'prey', hp: 60, walk: 1.3, trot: 4, run: 14, turn: 3.5, sight: 55, hear: 50, fov: -0.7, reach: 1.2, pounce: 0, dmg: 6, courage: 0.05, fearFire: 1, mass: 60, ears: 'big', voice: 'chital', antlers: 'chital', radius: 0.45 },
  boar: { L: 1.25, H: 0.8, W: 0.22, R: 0.3, neck: 0.12, head: [0.13, 0.15, 0.3], tail: 0.2, leg: [0.22, 0.2, 0.08], legR: 0.06, coat: 'boar', kind: 'defensive', hp: 120, walk: 1.1, trot: 3.5, run: 11, turn: 3, sight: 22, hear: 35, fov: -0.4, reach: 1.4, pounce: 0, dmg: 20, courage: 0.7, fearFire: 0.8, mass: 85, ears: 'pointed', voice: 'boar', tusks: true, shaggy: 0.06, radius: 0.5 },
  langur: { L: 0.62, H: 0.55, W: 0.12, R: 0.13, neck: 0.1, head: [0.08, 0.09, 0.09], tail: 0.95, leg: [0.25, 0.23, 0.08], legR: 0.035, coat: 'langur', kind: 'arboreal', hp: 40, walk: 1.2, trot: 3, run: 8, turn: 4, sight: 80, hear: 50, fov: -0.9, reach: 1, pounce: 0, dmg: 4, courage: 0.1, fearFire: 1, mass: 15, ears: 'round', voice: 'langur', primate: true, radius: 0.3 },
  cow: { L: 1.8, H: 1.25, W: 0.3, R: 0.38, neck: 0.32, head: [0.13, 0.16, 0.32], tail: 0.65, leg: [0.42, 0.36, 0.11], legR: 0.07, coat: 'cow', kind: 'livestock', hp: 260, walk: 1.0, trot: 2.5, run: 8, turn: 2, sight: 30, hear: 30, fov: -0.5, reach: 1.5, pounce: 0, dmg: 10, courage: 0.2, fearFire: 1, mass: 300, ears: 'side', voice: 'cow', hump: true, horns: 'cow', radius: 0.7 },
  dog: { L: 0.8, H: 0.55, W: 0.12, R: 0.14, neck: 0.18, head: [0.08, 0.09, 0.14], tail: 0.35, leg: [0.24, 0.2, 0.07], legR: 0.035, coat: 'dog', kind: 'village', hp: 50, walk: 1.5, trot: 4, run: 10, turn: 4, sight: 40, hear: 50, fov: 0.0, reach: 1.1, pounce: 0, dmg: 5, courage: 0.4, fearFire: 0.5, mass: 18, ears: 'pointed', voice: 'dog', radius: 0.3 },
  peafowl: { L: 0.5, H: 0.95, W: 0.12, R: 0.13, kind: 'bird', coat: 'peafowl', hp: 15, walk: 1.0, run: 6, turn: 4, sight: 45, hear: 45, fov: -0.8, voice: 'peafowl', radius: 0.25 },
  mugger: { L: 3.6, H: 0.35, W: 0.32, R: 0.2, kind: 'ambush', coat: 'croc', hp: 420, walk: 0.8, run: 7, turn: 1.4, sight: 22, hear: 18, fov: 0, reach: 2.0, dmg: 34, voice: 'croc', radius: 0.8 },
};

// ------------------------------------------------------------------------------------------------ rig builders
function finalizeTemplate(root, L) {
  mergeByMaterial(root);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position, a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m).multiplyScalar(1 / L); a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; }
    o.geometry.setAttribute('aRest', new THREE.BufferAttribute(a, 3));
    o.castShadow = true; o.receiveShadow = true;
  });
}

function buildQuad(d) {
  const L = d.L, H = d.H, R = d.R, W = d.W;
  const mat = coatMaterial(d.coat, (d.leg[0] + d.leg[1] + d.leg[2]) / L, d.neck ? [0, (d.leg[0] + d.leg[1] + d.leg[2] + R * 1.05) / L, (L * 0.42 + d.neck + d.head[2] * 0.2) / L] : undefined);
  const root = new THREE.Group();
  const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g; };
  const M = (geo, parent, x = 0, y = 0, z = 0, mm = mat) => { const m = new THREE.Mesh(geo, mm); m.position.set(x, y, z); parent.add(m); return m; };
  const legTop = d.leg[0] + d.leg[1] + d.leg[2];
  const bodyY = legTop + R * 0.55;
  const body = J('body', root, 0, bodyY, 0);
  const sh = d.shaggy || 0;
  if (d.primate) {
    M(ellip(W, R, L * 0.36, 12, sh), body, 0, 0, 0);
    M(ellip(W * 1.1, R * 1.05, L * 0.22, 12), body, 0, R * 0.1, L * 0.22);
  } else {
    const prof = d.cat ? 'cat' : d.voice === 'bear' ? 'bear' : d.voice === 'boar' ? 'boar' : d.hump ? 'bovine' : d.antlers || d.voice === 'chital' || d.voice === 'sambar' ? 'deer' : d.kind === 'pack' || d.voice === 'wolf' || d.voice === 'dog' ? 'canid' : 'generic';
    const tg = torsoGeo(L * 0.98, W * 1.05, R * 1.02, prof);
    if (sh) { const p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + sh * 0.6 * Math.sin(i * 7.31) * Math.cos(i * 2.17); p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * (1 + (k - 1) * 0.5)); } tg.computeVertexNormals(); }
    M(tg, body, 0, 0, 0);
    // shoulder blades and haunch muscle
    for (const sx of [-1, 1]) { M(ellip(W * 0.38, R * 0.62, L * 0.13, 10), body, sx * W * 0.62, R * 0.05, L * 0.34); M(ellip(W * 0.42, R * 0.7, L * 0.16, 10), body, sx * W * 0.6, R * 0.02, -L * 0.3); }
  }
  // neck & head
  const neck = J('neck', body, 0, R * 0.5, L * 0.42);
  const nl = d.neck;
  M(fwd(limbDown(R * 0.55, d.head[0] * 0.85, nl, 10)), neck);
  const head = J('head', neck, 0, 0, nl);
  const [hx, hy, hz] = d.head;
  M(ellip(hx, hy, hz * 0.62, 12), head, 0, 0, hz * 0.2);
  const muz = M(ellip(hx * 0.62, hy * 0.55, hz * 0.45, 10), head, 0, -hy * 0.25, hz * 0.68);
  if (d.cat) { M(ellip(hx * 0.5, hy * 0.36, hz * 0.3, 8), head, hx * 0.36, -hy * 0.32, hz * 0.62); M(ellip(hx * 0.5, hy * 0.36, hz * 0.3, 8), head, -hx * 0.36, -hy * 0.32, hz * 0.62); }
  const jaw = J('jaw', head, 0, -hy * 0.45, hz * 0.35);
  M(ellip(hx * 0.5, hy * 0.18, hz * 0.45, 8), jaw, 0, -hy * 0.05, hz * 0.28);
  if (d.cat || d.kind === 'pack' || d.voice === 'wolf' || d.voice === 'dog' || d.voice === 'bear') for (const sx of [-1, 1]) { const f = M(new THREE.ConeGeometry(hx * 0.06, hy * 0.35, 5), jaw, sx * hx * 0.3, hy * 0.1, hz * 0.55, clawMat); f.rotation.x = Math.PI; }
  for (const sx of [-1, 1]) {
    M(ellip(hx * 0.12, hy * 0.1, hx * 0.08, 6), head, sx * hx * 0.55, hy * 0.28, hz * 0.45, eyeMat);
    let ear;
    if (d.ears === 'big') { ear = M(ellip(hx * 0.32, hy * 0.6, hx * 0.1, 8), head, sx * hx * 0.85, hy * 0.75, -hz * 0.05); ear.rotation.z = sx * -0.6; }
    else if (d.ears === 'pointed') { ear = M(new THREE.ConeGeometry(hx * 0.28, hy * 0.8, 6), head, sx * hx * 0.55, hy * 1.0, -hz * 0.05); ear.rotation.z = sx * -0.25; }
    else if (d.ears === 'side') { ear = M(ellip(hx * 0.5, hy * 0.22, hx * 0.12, 8), head, sx * hx * 1.05, hy * 0.35, -hz * 0.05); }
    else { ear = M(ellip(hx * 0.3, hy * 0.32, hx * 0.1, 8), head, sx * hx * 0.62, hy * 0.85, -hz * 0.08); }
    ear.name = sx < 0 ? 'earL' : 'earR';
    // antlers / horns
    if (d.antlers) {
      const ant = new THREE.Group(); ant.name = sx < 0 ? 'antL' : 'antR'; ant.position.set(sx * hx * 0.35, hy * 0.9, 0); head.add(ant);
      const len = d.antlers === 'sambar' ? 0.75 : 0.62;
      const beam = M(limbDown(0.025, 0.012, len, 5), ant, 0, 0, 0, hornMat); beam.rotation.set(Math.PI * 0.82, 0, sx * 0.35);
      const tine = M(limbDown(0.016, 0.008, len * 0.4, 5), ant, 0, 0.05, 0, hornMat); tine.rotation.set(Math.PI * 0.62, 0, sx * -0.2);
      const t2 = M(limbDown(0.014, 0.006, len * 0.3, 5), ant, 0, 0, 0, hornMat); t2.position.set(sx * 0.12, len * 0.55, -len * 0.25); t2.rotation.set(Math.PI * 0.95, 0, sx * 0.6);
    }
    if (d.horns === 'gaur') { const h = M(limbDown(0.05, 0.015, 0.4, 6), head, sx * hx * 0.8, hy * 0.75, 0, hornMat); h.rotation.set(Math.PI * 0.1, 0, sx * 2.1); }
    if (d.horns === 'cow') { const h = M(limbDown(0.03, 0.01, 0.22, 6), head, sx * hx * 0.6, hy * 0.85, -0.02, hornMat); h.rotation.set(-0.3, 0, sx * 2.6); }
    if (d.tusks) { const t = M(new THREE.ConeGeometry(0.012, 0.07, 5), head, sx * hx * 0.35, -hy * 0.15, hz * 1.0, clawMat); t.rotation.set(-0.4, 0, sx * 0.6); }
  }
  if (d.voice === 'bear') M(ellip(hx * 0.7, hy * 0.45, hz * 0.4, 8, 0.1), head, 0, -hy * 0.1, hz * 0.78); // pale snout
  // legs
  const lx = W * 0.6;
  const legs = [];
  const fz = L * 0.36, bz = -L * 0.34;
  for (const [name, x, z, front] of [['LF', lx, fz, true], ['RF', -lx, fz, true], ['LH', lx, bz, false], ['RH', -lx, bz, false]]) {
    const hip = J('hip' + name, body, x, -R * 0.35, z);
    const r0 = d.legR * (front ? 1 : 1.25) * (d.cat ? 1.15 : 1);
    M(limbDown(r0 * (front ? 1.35 : 1.8), r0 * 0.78, d.leg[0], 9), hip);
    const knee = J('knee' + name, hip, 0, -d.leg[0], 0);
    M(limbDown(r0 * 0.75, r0 * 0.5, d.leg[1], 7), knee);
    const ankle = J('ankle' + name, knee, 0, -d.leg[1], 0);
    M(limbDown(r0 * 0.5, r0 * 0.45, d.leg[2], 6), ankle);
    const foot = M(ellip(r0 * (d.cat || d.voice === 'bear' ? 1.1 : 0.6), r0 * 0.45, r0 * (d.cat || d.voice === 'bear' ? 1.4 : 0.8), 8), ankle, 0, -d.leg[2], r0 * 0.3);
    if (d.voice === 'bear' && front) for (let k = -1; k <= 1; k++) { const c = M(new THREE.ConeGeometry(0.012, 0.09, 4), ankle, k * 0.03, -d.leg[2] - 0.02, r0 * 1.3, clawMat); c.rotation.x = Math.PI * 0.55; }
    legs.push(name);
  }
  // tail
  let tp = J('tail0', body, 0, R * 0.45, -L * 0.48);
  const segs = 5, segL = d.tail / segs;
  for (let s = 0; s < segs; s++) {
    const r = (d.bushy ? 0.05 : 0.03) * (d.L / 1.5) * (d.bushy ? 1 + s * 0.25 : 1 - s * 0.12);
    M(back(limbDown(Math.max(0.008, r), Math.max(0.006, r * 0.85), segL, 6)), tp);
    if (s < segs - 1) tp = J('tail' + (s + 1), tp, 0, 0, -segL);
  }
  finalizeTemplate(root, L);
  return root;
}

function buildPeafowl(d) {
  const mat = coatMaterial('peafowl');
  const root = new THREE.Group();
  const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g; };
  const M = (geo, parent, x = 0, y = 0, z = 0, mm = mat) => { const m = new THREE.Mesh(geo, mm); m.position.set(x, y, z); parent.add(m); return m; };
  const body = J('body', root, 0, 0.55, 0);
  M(ellip(0.13, 0.14, 0.24, 12), body, 0, 0, 0);
  const neck = J('neck', body, 0, 0.08, 0.17);
  M(limbDown(0.04, 0.025, 0.3, 8).rotateX(Math.PI * 0.85), neck);
  const head = J('head', neck, 0, 0.28, 0.08);
  M(ellip(0.035, 0.04, 0.05, 8), head, 0, 0, 0.01);
  M(new THREE.ConeGeometry(0.012, 0.04, 4), head, 0, -0.005, 0.06, hornMat).rotation.x = Math.PI / 2;
  for (let k = 0; k < 5; k++) { const c = M(limbDown(0.003, 0.003, 0.05, 3), head, (k - 2) * 0.008, 0.035, -0.01, mat); c.rotation.x = Math.PI - 0.3; }
  const train = J('tail0', body, 0, 0.02, -0.22);
  const tg = ellip(0.2, 0.04, 0.7, 14); tg.translate(0, -0.05, -0.62); M(tg, train);
  for (const sx of [-1, 1]) {
    const w = J(sx < 0 ? 'wingL' : 'wingR', body, sx * 0.12, 0.05, 0.02);
    const wg = ellip(0.05, 0.12, 0.2, 8); wg.translate(0, -0.05, -0.05); M(wg, w);
    const hip = J(sx < 0 ? 'hipLH' : 'hipRH', body, sx * 0.06, -0.1, 0);
    M(limbDown(0.02, 0.012, 0.22, 5), hip);
    const knee = J(sx < 0 ? 'kneeLH' : 'kneeRH', hip, 0, -0.22, 0);
    M(limbDown(0.011, 0.009, 0.24, 5, hornMat), knee, 0, 0, 0, hornMat);
    J(sx < 0 ? 'ankleLH' : 'ankleRH', knee, 0, -0.24, 0);
  }
  finalizeTemplate(root, 1.0);
  return root;
}

function buildCroc(d) {
  const mat = coatMaterial('croc');
  const root = new THREE.Group();
  const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g; };
  const M = (geo, parent, x = 0, y = 0, z = 0, mm = mat) => { const m = new THREE.Mesh(geo, mm); m.position.set(x, y, z); parent.add(m); return m; };
  const body = J('body', root, 0, 0.28, 0);
  M(ellip(0.34, 0.2, 0.75, 14, 0.04), body, 0, 0, 0.1);
  for (let k = 0; k < 8; k++) M(new THREE.BoxGeometry(0.06, 0.05, 0.08), body, (k % 2 ? 0.08 : -0.08), 0.18, 0.6 - k * 0.15);
  const neck = J('neck', body, 0, 0.02, 0.8);
  const head = J('head', neck, 0, 0, 0.05);
  M(ellip(0.18, 0.1, 0.32, 10), head, 0, 0, 0.18);
  M(ellip(0.1, 0.06, 0.38, 10), head, 0, -0.02, 0.6);
  for (const sx of [-1, 1]) M(ellip(0.035, 0.03, 0.035, 6), head, sx * 0.1, 0.09, 0.15, eyeMat);
  const jaw = J('jaw', head, 0, -0.06, 0.1); M(ellip(0.1, 0.04, 0.42, 8), jaw, 0, -0.02, 0.42);
  let tp = J('tail0', body, 0, 0, -0.6);
  for (let s = 0; s < 6; s++) { const r = 0.17 * (1 - s / 6.5); M(back(limbDown(r, r * 0.8, 0.32, 8)), tp); if (s < 5) tp = J('tail' + (s + 1), tp, 0, 0, -0.32); }
  for (const [name, x, z] of [['LF', 0.3, 0.55], ['RF', -0.3, 0.55], ['LH', 0.3, -0.35], ['RH', -0.3, -0.35]]) {
    const hip = J('hip' + name, body, x, -0.05, z); hip.rotation.z = x > 0 ? 1.1 : -1.1;
    M(limbDown(0.07, 0.05, 0.22, 6), hip);
    const knee = J('knee' + name, hip, 0, -0.22, 0); knee.rotation.z = x > 0 ? -1.1 : 1.1;
    M(limbDown(0.05, 0.04, 0.18, 6), knee);
    J('ankle' + name, knee, 0, -0.18, 0);
  }
  finalizeTemplate(root, d.L);
  return root;
}

const templates = {};
function getTemplate(sp) {
  if (!templates[sp]) {
    const d = DEF[sp];
    templates[sp] = sp === 'peafowl' ? buildPeafowl(d) : sp === 'mugger' ? buildCroc(d) : buildQuad(d);
    if (PAINTED) toonify(templates[sp], { outline: 0.015 });   // every clone carries the template's ink
  }
  return templates[sp];
}

// ------------------------------------------------------------------------------------------------ Animal
let UID = 1;
const V = () => new THREE.Vector3();
const tmp1 = V(), tmp2 = V();

export class Animal {
  constructor(species, pos, opts = {}) {
    this.id = UID++;
    this.sp = species; this.d = DEF[species];
    this.male = opts.male ?? Math.random() < 0.45;
    this.rig = hasRig(species) ? makeRigged(species, this.male) : null;
    if (this.rig) {
      this.root = this.rig.root; this.J = this.rig.J; this.meshes = this.rig.meshes;
      if (!this.male) this.rig.inst.traverse((o) => { if (o.isMesh && /Horn/i.test(o.name)) o.visible = false; });
    } else {
      this.root = getTemplate(species).clone(true);
      this.J = {}; this.root.traverse((o) => { if (o.name) this.J[o.name] = o; });
      this.meshes = []; this.root.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    }
    this.root.position.copy(pos);
    this.pos = this.root.position; this.yaw = opts.yaw ?? Math.random() * 6.28; this.vel = V(); this.speed = 0; this.targetSpeed = 0;
    this.hp = this.d.hp * (opts.hpMul || 1); this.maxHp = this.hp;
    this.state = opts.state || 'idle'; this.stateT = 0; this.timer = 1 + Math.random() * 3;
    this.phase = Math.random(); this.t = Math.random() * 100;
    this.home = pos.clone(); this.homeR = opts.homeR || 60;
    this.goal = pos.clone(); this.threat = null; this.target = null; this.awareness = 0;
    this.alarmCD = 0; this.attackCD = 0; this.bleed = 0; this.bleedDrop = 0; this.stagger = 0;
    this.group = opts.group || null; this.slot = opts.slot || 0;
    this.name = opts.name || null; this.story = opts.story || null;
    this.persistent = !!opts.persistent;
    this.aggro = opts.aggro || 0; // 0..1 willingness to attack player
    this.bond = opts.bond || 0;
    this.companion = !!opts.companion;
    this.dead = false; this.deadT = 0; this.harvested = false; this.anim = { pounce: 0, swipe: 0, bite: 0, rear: 0, graze: 0, sit: 0, lie: 0, fly: 0, roll: 0, alertTail: 0 };
    this.air = 0; this.vy = 0;
    this.scale = opts.scale || (0.9 + Math.random() * 0.2) * (this.male ? 1.05 : 0.95);
    this.root.scale.setScalar(this.scale);
    if (this.d.antlers && !this.male) { const a = this.J.antL, b = this.J.antR; if (a) a.visible = false; if (b) b.visible = false; }
    this.perch = null; this.hop = null;
    this.carcassHits = 0; this.lastHitBy = null;
    this.spoke = 0; this.lookAt = null;
    this.feedT = 0; this.scripted = null;
    this.shadowOn = true;
    this.root.rotation.y = this.yaw;
    this.radius = this.d.radius * this.scale;
  }
  get alive() { return !this.dead; }
  dist2(p) { const dx = p.x - this.pos.x, dz = p.z - this.pos.z; return dx * dx + dz * dz; }
  setState(s, t = 0) { this.state = s; this.stateT = 0; this.timer = t; }
  headPos(out) { (this.J.head || this.root).getWorldPosition(out); return out; }
  bodyPos(out) { (this.J.body || this.root).getWorldPosition(out); return out; }

  // --------------------------------------------------------------------------- damage & death
  takeDamage(dmg, hitPos, dir, W, opts = {}) {
    if (this.rig) this.hitT = 0.45;
    if (this.dead) { // mutilating a carcass
      W.fx.blood(hitPos, dir, 0.6); this.carcassHits++; return 0;
    }
    let zone = 'body', mul = 1;
    const hp = this.headPos(tmp1);
    if (hitPos && hitPos.distanceTo(hp) < 0.45 * this.scale * (this.d.L / 1.5)) { zone = 'head'; mul = 2.0; }
    else if (hitPos && hitPos.y < this.pos.y + this.d.H * 0.4 * this.scale) { zone = 'legs'; mul = 0.75; this.limp = Math.min(1, (this.limp || 0) + 0.35); }
    if (opts.sneak) mul *= 2.5;
    const d = dmg * mul;
    this.hp -= d;
    this.bleed = Math.min(6, this.bleed + d * 0.04 * (opts.bleed || 1));
    this.stagger = Math.min(0.6, 0.15 + d / this.maxHp * 2);
    W.fx.blood(hitPos || this.bodyPos(tmp2), dir, Math.min(2, 0.5 + d / 25), d > 30);
    if (Math.random() < 0.5) W.fx.decal(this.pos.x + (Math.random() - 0.5), this.pos.z + (Math.random() - 0.5), 0.3 + Math.random() * 0.4);
    this.lastHitBy = opts.by || 'player';
    W.audio.animal(this.d.voice, 'pain', this.pos, { big: d > 25 });
    if (this.hp <= 0) { this.die(W, opts); return d; }
    this.react(W, opts.by === 'companion' ? 'companion' : 'player');
    return d;
  }
  react(W, by) {
    const k = this.d.kind;
    const src = by === 'player' ? W.player.pos : (W.companionPos || W.player.pos);
    if (this.companion) return;
    if (k === 'prey' || k === 'bird' || k === 'arboreal' || k === 'livestock') { this.threat = src.clone(); this.setState('flee', 8 + Math.random() * 6); return; }
    if (!this.noRetreat && this.hp < this.maxHp * (this.story ? 0.18 : 0.3) && Math.random() < 0.8) { this.threat = src.clone(); this.setState('retreat', 12); W.audio.animal(this.d.voice, 'snarl', this.pos); return; }
    this.target = by === 'player' ? 'player' : (W.companion || 'player');
    this.aggro = 1;
    if (this.state !== 'attack' && this.state !== 'pounce') this.setState('charge', 0);
  }
  die(W, opts = {}) {
    this.dead = true; this.hp = 0; this.state = 'dead'; this.deadT = 0;
    this.rollDir = Math.random() < 0.5 ? 1 : -1;
    W.audio.animal(this.d.voice, 'death', this.pos);
    W.fx.decal(this.pos.x, this.pos.z, 1.2 + this.d.L * 0.4);
    if (W.onKill) W.onKill(this, opts.by || this.lastHitBy);
    if (W.onDeath && this.d.L > 0.9) W.onDeath(this);
  }
  harvest(W) {
    if (!this.dead || this.harvested) return null;
    this.harvested = true;
    const flay = coatMaterial('flayed');
    for (const m of this.meshes) { if (m.material !== eyeMat && m.material !== hornMat && m.material !== clawMat) m.material = flay; }
    W.fx.blood(this.bodyPos(tmp1), new THREE.Vector3(0, 1, 0), 2, true);
    W.fx.decal(this.pos.x, this.pos.z, 1.6 + this.d.L * 0.5);
    const m = this.d.mass;
    const loot = { meat_raw: Math.max(1, Math.round(m / 25)) };
    if (m > 12) loot.hide = 1;
    loot.bone = Math.max(1, Math.round(m / 60));
    if (m > 12) loot.sinew = 1;
    if (this.sp === 'peafowl') { loot.feather = 4; loot.meat_raw = 1; delete loot.hide; delete loot.sinew; }
    if (this.sp === 'tiger' || this.sp === 'leopard') loot.claw = 2;
    if (this.sp === 'boar') loot.tusk = 1;
    return loot;
  }
  // --------------------------------------------------------------------------- perception
  perceivePlayer(W, dt) {
    const P = W.player;
    if (P.dead) { this.awareness = Math.max(0, this.awareness - dt); return 0; }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const fwdx = Math.sin(this.yaw), fwdz = Math.cos(this.yaw);
    const cosA = (dx * fwdx + dz * fwdz) / (d || 1);
    const night = W.night;
    let sight = this.d.sight * P.visibility * (this.d.cat ? 1 : 1 - night * 0.55);
    if (this.sp === 'bear') sight = this.d.sight;
    let s = 0;
    if (d < sight && cosA > this.d.fov) s += (1 - d / sight) * 2.2;
    if (d < P.noise * (this.d.hear / 45)) s += (1 - d / (P.noise * (this.d.hear / 45) + 0.01)) * 1.6;
    if (d < 4) s += 1.5;
    this.awareness = clamp(this.awareness + (s > 0 ? s * dt * 1.4 : -dt * 0.25), 0, 1.5);
    return d;
  }
  // --------------------------------------------------------------------------- locomotion
  steer(goalX, goalZ, speed, dt, W, face = true) {
    const dx = goalX - this.pos.x, dz = goalZ - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05 && face) {
      const want = Math.atan2(dx, dz);
      let diff = want - this.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      const tr = this.d.turn * (speed > this.d.trot ? 0.8 : 1.2) * dt;
      this.yaw += clamp(diff, -tr, tr);
      if (Math.abs(diff) > 1.6) speed *= 0.3;
    }
    this.targetSpeed = d < 0.3 ? 0 : speed;
    return d;
  }
  integrate(dt, W) {
    const acc = this.targetSpeed > this.speed ? 6 + this.d.run * 0.5 : 10;
    this.speed += clamp(this.targetSpeed - this.speed, -acc * dt, acc * dt);
    if (this.limp) this.speed = Math.min(this.speed, this.d.run * (1 - this.limp * 0.55));
    if (this.stagger > 0) { this.stagger -= dt; this.speed *= 0.9; }
    const x0 = this.pos.x, z0 = this.pos.z;
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt, nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
    // water avoidance
    const gy = groundHeight(nx, nz), wl = waterAt(nx, nz);
    const aquatic = this.sp === 'mugger';
    if (!aquatic && wl > gy + 0.9 * this.scale && !this.canSwim) { this.yaw += 1.2 * dt * 3; this.speed *= 0.5; }
    else if (aquatic && wl < gy + 0.4 && this.state !== 'charge' && this.state !== 'bask') { this.yaw += 2 * dt; this.speed *= 0.5; }
    else { this.pos.x = nx; this.pos.z = nz; }
    if (Math.abs(this.pos.x) > HALF - 40) this.pos.x = Math.sign(this.pos.x) * (HALF - 40);
    if (Math.abs(this.pos.z) > HALF - 40) this.pos.z = Math.sign(this.pos.z) * (HALF - 40);
    if (!this.perch && this.dist2(W.player.pos) < 90 * 90) {
      // near the player, animals move through the physics world (sliding round trunks, rocks and walls, and solid
      // to the player); further off, the cheap circle tests
      let blocked;
      if (W.phys && this.dist2(W.player.pos) < 45 * 45 && !this.air) blocked = W.phys.moveActor(this, x0, z0);
      else blocked = (W.veg ? W.veg.collide(this.pos, this.radius * 0.6) : false) | (W.props && W.props.collide ? W.props.collide(this.pos, this.radius * 0.7) : false);
      // slide round the obstacle instead of grinding into it
      if (blocked && this.speed > 0.3) { if (!this.avoidT || this.avoidT <= 0) { this.avoidSide = Math.random() < 0.5 ? -1 : 1; } this.avoidT = 0.8; }
      if (this.avoidT > 0) { this.avoidT -= dt; this.yaw += this.avoidSide * 2.2 * dt * clamp(this.speed / 3, 0.4, 1.4); }
    }
    const g2 = groundHeight(this.pos.x, this.pos.z);
    if (this.air > 0) {
      this.vy -= 22 * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= g2) { this.pos.y = g2; this.air = 0; this.vy = 0; }
    } else if (!this.perch) {
      let y = g2;
      if (aquatic) { const w = waterAt(this.pos.x, this.pos.z); if (w > g2 + 0.3) y = Math.max(g2, w - (this.state === 'lurk' ? 0.32 : 0.2)); }
      this.pos.y = lerp(this.pos.y, y, Math.min(1, dt * 12));
    }
  }
  // --------------------------------------------------------------------------- update
  update(dt, W) {
    this.t += dt;
    if (this.dead) { this.deadT += dt; this.bleedOut(dt, W); this.animate(dt, W); return; }
    this.alarmCD -= dt; this.attackCD -= dt; this.timer -= dt; this.stateT += dt;
    // bleeding
    if (this.bleed > 0) {
      this.hp -= this.bleed * dt * 1.2; this.bleed = Math.max(0, this.bleed - dt * 0.12);
      this.bleedDrop += this.speed * dt + dt * 0.3;
      if (this.bleedDrop > 1.6) { this.bleedDrop = 0; W.fx.decal(this.pos.x + (Math.random() - 0.5) * 0.4, this.pos.z + (Math.random() - 0.5) * 0.4, 0.12 + this.bleed * 0.05); }
      if (this.hp <= 0) { this.die(W, { by: this.lastHitBy }); return; }
    }
    if (this.scripted) { this.scripted(dt, W, this); }
    else this.think(dt, W);
    this.integrate(dt, W);
    this.animate(dt, W);
  }
  bleedOut(dt, W) { if (this.deadT < 6 && Math.random() < dt * 0.8) W.fx.decal(this.pos.x + (Math.random() - 0.5) * this.d.L * 0.5, this.pos.z + (Math.random() - 0.5) * this.d.L * 0.5, 0.5 + this.deadT * 0.15); }

  think(dt, W) {
    const k = this.d.kind;
    if (this.companion) return this.thinkCompanion(dt, W);
    if (k === 'arboreal') return this.thinkLangur(dt, W);
    if (k === 'ambush') return this.thinkCroc(dt, W);
    const pd = this.perceivePlayer(W, dt);
    // predator threats for prey
    if (k === 'prey' || k === 'bird' || k === 'livestock' || k === 'village') {
      const pr = W.nearestPredator(this, k === 'livestock' ? 40 : this.d.sight);
      if (pr && this.state !== 'flee') {
        this.threat = pr.pos.clone();
        this.alarm(W, pr.sp);
        this.setState(this.state === 'alert' ? 'flee' : 'alert', this.state === 'alert' ? 10 : 0.6 + Math.random() * 0.6);
        if (this.group) this.group.alert(this, pr.pos, W);
      }
      const bonded = this.bond > 0.6;
      if (!bonded && this.awareness > 1 && this.state !== 'flee' && this.state !== 'alert' && pd < 45 && k !== 'village') {
        this.threat = W.player.pos.clone();
        if (pd < 18 || W.player.sprinting || W.player.armedThreat) { this.alarm(W, 'human'); this.setState('alert', 0.4 + Math.random() * 0.5); }
        else { this.setState('alert', 1.5 + Math.random()); }
        if (this.group) this.group.alert(this, W.player.pos, W);
      }
    }
    switch (this.state) {
      case 'idle': case 'graze': case 'rest':
        this.targetSpeed = 0;
        this.anim.graze = lerp(this.anim.graze, this.state === 'graze' ? 1 : 0, dt * 2);
        this.anim.lie = lerp(this.anim.lie, this.state === 'rest' ? 1 : 0, dt * 1.5);
        if (this.timer <= 0) this.pickWander(W);
        this.predatorScan(dt, W, pd);
        break;
      case 'wander': {
        const d = this.steer(this.goal.x, this.goal.z, this.d.walk * (this.group && this.group.pace || 1), dt, W);
        this.anim.graze = lerp(this.anim.graze, 0, dt * 3); this.anim.lie = lerp(this.anim.lie, 0, dt * 3);
        if (d < 1.5 || this.timer <= 0) {
          if (this.goingToDrink) { this.goingToDrink = false; this.drankAt = W.hour; this.setState('drink', 12 + Math.random() * 14); }
          else if (this.restNext) { this.restNext = false; this.setState('rest', 25 + Math.random() * 40); }
          else { const r = Math.random(); this.setState(k === 'prey' || k === 'livestock' ? (r < 0.65 ? 'graze' : 'idle') : (r < 0.25 && !W.isDay ? 'rest' : 'idle'), 4 + Math.random() * 9); }
        }
        this.predatorScan(dt, W, pd);
        break;
      }
      case 'alert': {
        this.targetSpeed = 0; this.anim.graze = lerp(this.anim.graze, 0, dt * 6); this.anim.alertTail = 1;
        if (this.threat) this.faceTowards(this.threat, dt * 2);
        if (this.timer <= 0) {
          if (k === 'prey' || k === 'bird' || k === 'livestock') { if (this.awareness > 0.8 || W.nearestPredator(this, this.d.sight)) { this.afterAlert = null; this.setState('flee', 6 + Math.random() * 6); } else if (this.afterAlert === 'drink') { this.afterAlert = null; this.setState('drink', 6 + Math.random() * 8); } else this.setState('idle', 2); }
          else if (k === 'defensive' || k === 'neutral') this.decideDefend(W, pd);
          else this.setState('idle', 2);
        }
        break;
      }
      case 'flee': {
        this.anim.graze = 0; this.anim.lie = 0;
        const th = this.threat || W.player.pos;
        let ax = this.pos.x - th.x, az = this.pos.z - th.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
        // weave
        const w = Math.sin(this.t * 0.9 + this.id) * 0.5;
        const gx = this.pos.x + (ax * Math.cos(w) - az * Math.sin(w)) * 20, gz = this.pos.z + (az * Math.cos(w) + ax * Math.sin(w)) * 20;
        this.steer(gx, gz, this.d.run * (this.group ? 0.92 : 1), dt, W);
        if (this.sp === 'peafowl' && this.stateT < 0.1 && Math.random() < 0.5) { this.air = 1; this.vy = 7; this.anim.fly = 1; }
        if (this.timer <= 0 && l > 50) { this.setState('idle', 2); this.anim.alertTail = 0; this.home.copy(this.pos); }
        break;
      }
      case 'stalk': this.doStalk(dt, W); break;
      case 'charge': this.doCharge(dt, W); break;
      case 'attack': this.doAttack(dt, W); break;
      case 'pounce': this.doPounce(dt, W); break;
      case 'retreat': {
        const th = this.threat || W.player.pos;
        let ax = this.pos.x - th.x, az = this.pos.z - th.z; const l = Math.hypot(ax, az) || 1;
        this.steer(this.pos.x + ax / l * 30, this.pos.z + az / l * 30, this.d.run * 0.85, dt, W);
        if (this.timer <= 0 || l > 90) { this.setState('idle', 5); this.aggro *= 0.4; this.home.copy(this.pos); }
        break;
      }
      case 'drink': {
        this.targetSpeed = 0; this.anim.graze = lerp(this.anim.graze, 1, dt * 3);
        if (Math.random() < dt * 0.25) { this.anim.graze = 0; this.setState('alert', 0.8); this.timer = 0.8; this.afterAlert = 'drink'; }
        if (this.timer <= 0) this.setState('idle', 2);
        this.predatorScan(dt, W, pd);
        break;
      }
      case 'feed': {
        this.targetSpeed = 0; this.anim.graze = lerp(this.anim.graze, 1, dt * 3);
        if (this.target && this.target.pos) this.faceTowards(this.target.pos, dt);
        if (pd < 14 && this.awareness > 0.9) { this.target = 'player'; this.setState('charge'); W.audio.animal(this.d.voice, 'snarl', this.pos); }
        if (this.timer <= 0) this.setState('idle', 4);
        break;
      }
      case 'forage': { // bear at termite mound / mahua
        this.targetSpeed = 0; this.anim.graze = lerp(this.anim.graze, 1, dt * 3);
        if (Math.random() < dt * 0.3) W.audio.animal('bear', 'huff', this.pos);
        if (this.timer <= 0) this.pickWander(W);
        if (k === 'defensive' && pd < 7 * (W.player.calm ? 0.4 : 1) && this.awareness > 0.6 && this.bond < 0.6) this.decideDefend(W, pd, true);
        break;
      }
      case 'warn': {
        this.targetSpeed = 0; this.faceTowards(W.player.pos, dt * 3);
        this.anim.rear = this.sp === 'bear' ? lerp(this.anim.rear, 1, dt * 4) : 0;
        if (Math.random() < dt * 1.2) W.audio.animal(this.d.voice, this.sp === 'gaur' ? 'snort' : 'snarl', this.pos);
        if (this.timer <= 0) {
          this.anim.rear = 0;
          if (pd < (this.sp === 'gaur' ? 14 : 10) && !W.player.calm) { this.target = 'player'; this.setState('charge'); }
          else this.setState('idle', 3);
        }
        break;
      }
      default: this.setState('idle', 2);
    }
  }
  faceTowards(p, rate) { const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); let diff = want - this.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI; this.yaw += clamp(diff, -rate, rate); }
  // What this species is doing at this hour: 'active' (graze / forage / patrol), 'rest', 'drink' or 'roost'
  schedule(W) {
    const h = W.hour ?? 12, sum = W.season === 'summer';
    const inR = (a, b) => (a < b ? h >= a && h < b : h >= a || h < b);
    switch (this.sp) {
      case 'chital': if (inR(10.5, 15.5)) return sum && inR(12, 13.5) ? 'drink' : 'rest'; if (inR(16, 17.2) && sum) return 'drink'; return inR(21, 4.5) && this.id % 3 ? 'rest' : 'active';
      case 'sambar': if (inR(18, 19.8)) return 'drink'; return inR(7.5, 17.5) ? 'rest' : 'active';
      case 'gaur': if (inR(14, 15.5)) return 'drink'; return inR(10.5, 14) || inR(20, 5) ? 'rest' : 'active';
      case 'boar': return inR(5, 9.5) || inR(16.5, 21) ? 'active' : 'rest';
      case 'tiger': case 'leopard': if (inR(17, 18.6)) return 'drink'; return inR(9, 16.5) ? 'rest' : 'active';
      case 'dhole': if (inR(9.5, 10.5) && sum) return 'drink'; return inR(5.5, 9.5) || inR(16, 18.5) ? 'active' : 'rest';
      case 'bear': return inR(19, 6) ? 'active' : 'rest';
      case 'peafowl': return inR(18.5, 5.8) ? 'roost' : 'active';
      default: return 'active';
    }
  }
  pickWander(W) {
    const plan = this.schedule(W);
    this.plan = plan;
    if (plan === 'drink' && W.nearestWater && !this.drankAt || plan === 'drink' && W.hour - this.drankAt > 3) {
      const wp = W.nearestWater(this.pos);
      if (wp && wp.distanceTo(this.pos) < 900) { this.goal.copy(wp); this.goingToDrink = true; this.setState('wander', 120); return; }
    }
    if (plan === 'rest' && W.nearestShade && this.d.kind !== 'bird') {
      const t = W.nearestShade(this.pos, 35);
      if (t) { const a = Math.random() * 6.28, rr = (t.r || 0.5) + 1.2 + Math.random() * 2; this.goal.set(t.x + Math.cos(a) * rr, 0, t.z + Math.sin(a) * rr); this.restNext = true; this.setState('wander', 40); return; }
      this.setState('rest', 20 + Math.random() * 30); return;
    }
    // chital trail langur troops in the morning for the leaves and fruit they drop (and their sharp eyes)
    if (this.sp === 'chital' && this.group && (W.hour ?? 12) < 11 && W.animals && Math.random() < 0.5) {
      for (const l of W.animals) if (l.sp === 'langur' && !l.dead && l.dist2(this.pos) < 110 * 110) { this.group.center.lerp(l.pos, 0.35); break; }
    }
    const g = this.group;
    const c = g ? g.center : this.home;
    const r = g ? g.radius : this.homeR;
    const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * r;
    this.goal.set(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr);
    if (this.sp === 'bear' && W.findForage) { const f = W.findForage(this.pos); if (f && Math.random() < 0.6) { this.goal.copy(f); this.forageNext = true; } }
    this.setState('wander', 20);
  }
  alarm(W, threatKind) {
    if (this.alarmCD > 0) return;
    const v = this.d.voice;
    if (!['chital', 'sambar', 'langur', 'peafowl', 'cow', 'dog'].includes(v)) return;
    if (v === 'sambar' && !['tiger', 'leopard', 'dhole'].includes(threatKind) && Math.random() < 0.85) return;
    this.alarmCD = 2.5 + Math.random() * 3;
    W.audio.animal(v, 'alarm', this.pos, { threat: threatKind });
    if (W.onAlarm) W.onAlarm(this, threatKind);
    // the jungle listens: other prey within earshot freeze, look toward the call; langur and sambar calls carry most weight
    if (W.animals) {
      const range = v === 'langur' || v === 'sambar' ? 160 : 110, trust = v === 'langur' || v === 'sambar' ? 0.9 : v === 'chital' ? 0.55 : 0.4;
      for (const o of W.animals) {
        if (o === this || o.dead || o.companion || o.group === this.group) continue;
        const ok = o.d.kind === 'prey' || o.d.kind === 'bird' || (o.d.kind === 'arboreal' && v !== 'langur');
        if (!ok || o.state === 'flee' || o.dist2(this.pos) > range * range) continue;
        if (Math.random() > trust) continue;
        o.threat = (this.threat || this.pos).clone(); o.setState('alert', 1.2 + Math.random() * 1.5);
      }
    }
  }
  predatorScan(dt, W, pd) {
    const k = this.d.kind;
    if (k !== 'predator' && k !== 'pack') {
      if ((k === 'defensive' || k === 'neutral') && pd < (this.sp === 'gaur' ? 16 : 9) && this.awareness > 0.9 && this.bond < 0.6) this.decideDefend(W, pd, true);
      if (this.sp === 'bear' && this.forageNext && this.state === 'idle') { this.forageNext = false; this.setState('forage', 10 + Math.random() * 10); }
      return;
    }
    this.hunger = (this.hunger ?? Math.random()) + dt * 0.004;
    // hunt player?
    const P = W.player;
    const wantPlayer = !P.dead && this.aggro > 0 && pd < this.d.sight * 1.1 && (this.awareness > 0.6 || this.aggro > 0.8);
    if (wantPlayer && (Math.random() < dt * this.aggro * 2 * (this.story || W.night > 0.5 || P.hp < 40 ? 1 : 0.25))) {
      if (P.torchLit && Math.random() < this.d.fearFire && pd < 16) { this.threat = P.pos.clone(); this.setState('retreat', 6); W.audio.animal(this.d.voice, 'snarl', this.pos); return; }
      this.target = 'player';
      if (k === 'pack' && this.group) this.group.engage('player', W);
      else this.setState(this.d.cat ? 'stalk' : 'charge');
      return;
    }
    // hunt prey
    if (this.hunger > 0.7 && Math.random() < dt * 0.2) {
      const prey = W.nearestPrey(this, 70);
      if (prey) { this.target = prey; if (k === 'pack' && this.group) this.group.engage(prey, W); else this.setState(this.d.cat ? 'stalk' : 'charge'); }
    }
  }
  decideDefend(W, pd, surprised = false) {
    if (W.player.calm && this.bond > 0.3) { this.setState('idle', 3); return; }
    if (this.sp === 'boar') { if (surprised || this.hp < this.maxHp) { this.target = 'player'; this.setState('charge'); W.audio.animal('boar', 'grunt', this.pos); } else { this.threat = W.player.pos.clone(); this.setState('flee', 6); } return; }
    if (this.sp === 'bear') { if (pd < 8 && !W.player.calm) { this.target = 'player'; this.setState('charge'); W.audio.animal('bear', 'roar', this.pos); } else this.setState('warn', 1.5); return; }
    if (this.sp === 'gaur') { this.setState('warn', 2.0); return; }
    this.setState('idle', 2);
  }
  targetPos() { if (this.target === 'player') return this._W.player.pos; if (this.target && this.target.pos && !this.target.dead) return this.target.pos; return null; }
  doStalk(dt, W) {
    this._W = W;
    const tp = this.targetPos(); if (!tp) return this.setState('idle', 2);
    const d = Math.sqrt(this.dist2(tp));
    const watched = this.target === 'player' && W.player.isLookingAt(this.pos, 0.85) && d < 35;
    this.crouch = 1;
    this.steer(tp.x, tp.z, watched ? 0.0 : this.d.walk * 0.8, dt, W);
    if (watched) { this.faceTowards(tp, dt * 2); this.watchT = (this.watchT || 0) + dt; if (this.watchT > 2.5 && Math.random() < dt) { this.crouch = 0; this.setState('charge'); W.audio.animal(this.d.voice, 'roar', this.pos, { big: true }); } }
    else this.watchT = 0;
    if (d < (this.d.pounce || 6) && d > 3) { this.crouch = 0; this.setState('pounce'); this.pounceFrom = this.pos.clone(); this.pounceTo = tp.clone(); this.air = 1; this.vy = 6; this.speed = d / 0.55; this.targetSpeed = this.speed; this.anim.pounce = 1; W.audio.animal(this.d.voice, 'snarl', this.pos, { big: true }); }
    else if (d < 3) { this.crouch = 0; this.setState('attack'); }
    if (this.stateT > 40) { this.crouch = 0; this.setState('charge'); }
  }
  doPounce(dt, W) {
    this.targetSpeed = this.speed;
    if (this.air <= 0) {
      this.anim.pounce = 0;
      const tp = this.targetPos();
      if (tp && this.dist2(tp) < (this.d.reach + 1.2) ** 2) this.hitTarget(W, this.d.dmg * 1.25, 'pounce');
      this.attackCD = 1.0; this.setState('attack');
    }
  }
  doCharge(dt, W) {
    this._W = W;
    this.crouch = 0;
    const tp = this.targetPos(); if (!tp) return this.setState('idle', 2);
    if (this.target === 'player' && W.player.torchLit && this.d.fearFire > Math.random() * 1.6 && this.dist2(tp) < 36 && this.stateT > 0.5 && Math.random() < dt * 2) { this.threat = tp.clone(); this.setState('retreat', 5); W.audio.animal(this.d.voice, 'snarl', this.pos); return; }
    // pack tactics: only three bite at once, the rest circle and wait for an opening
    if (this.group && this.group.kind === 'pack') {
      const biters = this.group.members.filter((m) => m !== this && !m.dead && m.state === 'attack').length;
      const dist = Math.sqrt(this.dist2(tp));
      if (biters >= 3 && dist < 9) {
        const n = Math.max(1, this.group.members.length), ang = this.slot / n * Math.PI * 2 + this.t * 0.35;
        this.steer(tp.x + Math.cos(ang) * 5.5, tp.z + Math.sin(ang) * 5.5, this.d.trot * 1.2, dt, W);
        if (Math.random() < dt * 0.4) W.audio.animal('dhole', 'whistle', this.pos);
        return;
      }
    }
    const d = this.steer(tp.x, tp.z, this.d.run, dt, W);
    if (d < this.d.reach * this.scale + 0.4) this.setState('attack');
    if (d > this.d.sight * 1.6 || this.stateT > 30) this.setState('idle', 3);
  }
  doAttack(dt, W) {
    this._W = W;
    const tp = this.targetPos(); if (!tp) { this.setState('idle', 2); return; }
    const d = Math.sqrt(this.dist2(tp));
    this.faceTowards(tp, dt * 5);
    if (d > this.d.reach * this.scale + 1.2) { this.setState('charge'); return; }
    this.targetSpeed = d > this.d.reach * 0.8 ? this.d.trot : 0;
    if (this.attackCD <= 0) {
      const kind = this.sp === 'gaur' || this.sp === 'boar' ? 'gore' : (Math.random() < 0.5 && this.d.cat) || this.sp === 'bear' ? 'swipe' : 'bite';
      this.attackCD = (this.sp === 'dhole' ? 1.7 : this.d.cat ? 1.5 : 1.7) + Math.random() * 0.7;
      this.anim[kind === 'swipe' ? 'swipe' : 'bite'] = 1;
      this.pendingHit = { t: 0.22, kind };
      W.audio.animal(this.d.voice, 'attack', this.pos);
    }
    if (this.pendingHit) {
      this.pendingHit.t -= dt;
      if (this.pendingHit.t <= 0) {
        if (d < this.d.reach * this.scale + 0.6) this.hitTarget(W, this.d.dmg * (0.85 + Math.random() * 0.3), this.pendingHit.kind);
        this.pendingHit = null;
        if (this.sp === 'dhole' && this.group) { this.threat = tp.clone(); this.setState('retreat', 1.2 + Math.random()); }
        if ((this.sp === 'gaur' || this.sp === 'boar') && Math.random() < 0.5) { this.threat = tp.clone(); this.setState('retreat', 2.5); }
        if (this.sp === 'bear' && Math.random() < 0.3) { this.threat = tp.clone(); this.setState('retreat', 8); }
      }
    }
  }
  hitTarget(W, dmg, kind) {
    if (this.target === 'player') W.damagePlayer(dmg, this.pos, { kind, bleed: kind !== 'gore' ? 1 : 0.5, by: this, knock: this.d.mass > 100 ? 4 : 1.5 });
    else if (this.target && this.target.takeDamage) {
      const hp = this.target.bodyPos(tmp2);
      this.target.takeDamage(dmg * (this.target.companion ? 0.5 : 1.2), hp, tmp1.subVectors(hp, this.pos).normalize(), W, { by: this.sp });
      if (this.target.dead) { this.setState('feed', 40 + Math.random() * 60); this.hunger = 0; this.feedTarget = this.target; }
    }
  }
  // --------------------------------------------------------------------------- companion (Kaali / Chingari)
  thinkCompanion(dt, W) {
    this._W = W;
    const P = W.player;
    const threat = W.threatToPlayer && W.threatToPlayer(this);
    if (threat && (this.hp > this.maxHp * 0.25)) { this.target = threat; }
    if (this.command && this.command.alive) this.target = this.command;
    if (this.target && this.target !== 'player' && this.target.dead) { this.target = null; this.command = null; }
    if (this.target && this.target !== 'player') {
      const tp = this.target.pos, d = Math.sqrt(this.dist2(tp));
      if (d > 60) { this.target = null; return; }
      this.steer(tp.x, tp.z, d > 3 ? this.d.run : 0, dt, W);
      if (d < this.d.reach + 0.8 && this.attackCD <= 0) {
        this.attackCD = 0.9 + Math.random() * 0.5; this.anim.bite = 1;
        W.audio.animal(this.d.voice, 'attack', this.pos);
        const hp = this.target.bodyPos(tmp2);
        this.target.takeDamage(this.d.dmg * (0.8 + Math.random() * 0.4), hp, tmp1.subVectors(hp, this.pos).normalize(), W, { by: 'companion', bleed: 1.4 });
      }
      return;
    }
    // follow
    const side = this.slot ? 1 : -1;
    const fx = P.pos.x + Math.sin(P.yaw) * 2.5 + Math.cos(P.yaw) * 2.2 * side, fz = P.pos.z + Math.cos(P.yaw) * 2.5 - Math.sin(P.yaw) * 2.2 * side;
    const d = Math.sqrt((fx - this.pos.x) ** 2 + (fz - this.pos.z) ** 2);
    const spd = d > 25 ? this.d.run : d > 8 ? this.d.trot * 1.3 : d > 2 ? Math.min(this.d.trot, P.speed + 0.5) : 0;
    this.steer(fx, fz, spd, dt, W);
    if (d > 120) { this.pos.set(P.pos.x - Math.sin(P.yaw) * 6, P.pos.y, P.pos.z - Math.cos(P.yaw) * 6); }
    if (spd === 0) { this.faceTowards(P.pos, dt); this.anim.sit = lerp(this.anim.sit, P.speed < 0.2 ? 1 : 0, dt); } else this.anim.sit = lerp(this.anim.sit, 0, dt * 4);
    this.hp = Math.min(this.maxHp, this.hp + dt * 2);
  }
  // --------------------------------------------------------------------------- langur
  thinkLangur(dt, W) {
    const pd = this.perceivePlayer(W, dt);
    const g = this.group;
    const pr = W.nearestPredator(this, 90);
    if (pr) { this.alarm(W, pr.sp); this.lookAt = pr.pos; if (!this.perch && this.state !== 'climb') this.findPerch(W, true); }
    else this.lookAt = null;
    if (this.bond < 0.6 && this.awareness > 1.1 && pd < 25) { this.alarm(W, 'human'); if (!this.perch) this.findPerch(W, true); }
    if (this.hop) {
      const h = this.hop; h.t += dt / h.dur;
      const t = Math.min(1, h.t);
      this.pos.lerpVectors(h.from, h.to, t); this.pos.y += Math.sin(t * Math.PI) * h.arc;
      this.yaw = Math.atan2(h.to.x - h.from.x, h.to.z - h.from.z);
      this.anim.sit = 0; this.anim.pounce = 1;
      if (t >= 1) { this.hop = null; this.anim.pounce = 0; this.perch = h.perch; if (!h.perch) this.pos.y = groundHeight(this.pos.x, this.pos.z); }
      this.targetSpeed = 0; this.speed = 0;
      return;
    }
    if (this.perch) {
      this.targetSpeed = 0; this.anim.sit = lerp(this.anim.sit, 1, dt * 3);
      this.pos.set(this.perch.x, this.perch.y, this.perch.z);
      if (this.lookAt) this.faceTowards(this.lookAt, dt * 2);
      this.timer -= 0;
      if (this.timer <= 0) {
        this.timer = 4 + Math.random() * 12;
        const toCenter = g ? Math.hypot(g.center.x - this.pos.x, g.center.z - this.pos.z) : 0;
        if (!pr && Math.random() < 0.18 && !(this.bond < 0.6 && pd < 30)) { // come down to forage
          const a = Math.random() * 6.28; const to = new THREE.Vector3(this.pos.x + Math.cos(a) * 3, 0, this.pos.z + Math.sin(a) * 3); to.y = groundHeight(to.x, to.z);
          this.hop = { from: this.pos.clone(), to, t: 0, dur: 0.9, arc: 0.6, perch: null }; this.perch = null;
        } else if (Math.random() < 0.6 || toCenter > 25) this.findPerch(W, false);
      }
      return;
    }
    // on ground
    this.anim.sit = lerp(this.anim.sit, this.state === 'idle' ? 1 : 0, dt * 2);
    if (this.state === 'wander') { const d = this.steer(this.goal.x, this.goal.z, this.d.walk, dt, W); if (d < 1 || this.timer <= 0) this.setState('idle', 3 + Math.random() * 5); }
    else { this.targetSpeed = 0; if (this.timer <= 0) { if (Math.random() < 0.5) this.findPerch(W, false); else { const c = g ? g.center : this.home; this.goal.set(c.x + (Math.random() - 0.5) * 20, 0, c.z + (Math.random() - 0.5) * 20); this.setState('wander', 10); } } }
  }
  findPerch(W, urgent) {
    const P = W.veg ? W.veg.perches : [];
    const c = this.group ? this.group.center : this.home;
    let best = null, bs = 1e9;
    for (let i = 0; i < P.length; i += 4) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const dd = (x - this.pos.x) ** 2 + (z - this.pos.z) ** 2;
      if (dd > 18 * 18 || dd < 4) continue;
      const dc = (x - c.x) ** 2 + (z - c.z) ** 2;
      const s = dc * 0.5 + dd * (urgent ? 0.2 : 1) + Math.random() * 120;
      if (s < bs) { bs = s; best = { x: x + (Math.random() - 0.5) * 1.5, y, z: z + (Math.random() - 0.5) * 1.5 }; }
    }
    if (best) {
      const to = new THREE.Vector3(best.x, best.y, best.z);
      const dist = to.distanceTo(this.pos);
      this.hop = { from: this.pos.clone(), to, t: 0, dur: Math.max(0.6, dist / 9), arc: Math.min(3, 1 + dist * 0.12), perch: best };
      this.perch = null;
      if (Math.random() < 0.3) W.audio.animal('langur', 'whoop', this.pos);
    }
  }
  // --------------------------------------------------------------------------- mugger
  thinkCroc(dt, W) {
    const P = W.player, pd = Math.sqrt(this.dist2(P.pos));
    const inWater = waterAt(P.pos.x, P.pos.z) > groundHeight(P.pos.x, P.pos.z) + 0.3;
    if (this.state === 'grab') {
      this.targetSpeed = 0; this.anim.roll = Math.min(1, this.anim.roll + dt);
      this.grabT -= dt;
      this.pos.x = P.pos.x - Math.sin(this.yaw) * 1.6; this.pos.z = P.pos.z - Math.cos(this.yaw) * 1.6;
      if (Math.random() < dt * 1.5) { W.damagePlayer(9, this.pos, { kind: 'bite', bleed: 1.2, by: this, grab: true }); }
      if (this.grabT <= 0 || P.dead || this.hp < this.maxHp * 0.6) { this.anim.roll = 0; this.threat = P.pos.clone(); this.setState('retreat', 6); P.grabbed = null; }
      return;
    }
    if (this.state === 'retreat') { const th = this.threat; this.steer(this.pos.x + (this.pos.x - th.x), this.pos.z + (this.pos.z - th.z), this.d.run * 0.5, dt, W); if (this.timer <= 0) this.setState('lurk', 10); return; }
    if ((inWater || pd < 5) && pd < 22 && !P.dead) {
      this.steer(P.pos.x, P.pos.z, pd < 6 ? this.d.run : this.d.walk * 2.2, dt, W);
      this.state = pd < 6 ? 'charge' : 'lurk';
      if (pd < 2.4 && this.attackCD <= 0) {
        this.attackCD = 6; this.anim.bite = 1;
        W.audio.animal('croc', 'attack', this.pos);
        this.grabT = 3.5; this.setState('grab'); P.grabbed = this;
        W.damagePlayer(this.d.dmg, this.pos, { kind: 'bite', bleed: 1.5, by: this, grab: true });
      }
      return;
    }
    this.state = 'lurk';
    if (this.timer <= 0) { this.timer = 8 + Math.random() * 10; const a = Math.random() * 6.28; this.goal.set(this.home.x + Math.cos(a) * 30, 0, this.home.z + Math.sin(a) * 30); }
    this.steer(this.goal.x, this.goal.z, this.d.walk, dt, W);
  }
  // --------------------------------------------------------------------------- animation
  animateRig(dt, W) {
    const r = this.rig, d = this.d, A = this.anim, cfg = r.cfg, J = this.J;
    this.root.rotation.y = this.yaw;
    const carn = d.kind === 'pack' || d.voice === 'wolf' || d.voice === 'dog';
    this.hitT = Math.max(0, (this.hitT || 0) - dt);
    let clip = 'Idle', ts = 1, fade = 0.3;
    const sp = this.speed / Math.max(0.3, this.scale);
    if (this.dead) { clip = 'Death'; fade = 0.15; }
    else if (A.bite > 0.15 || (this.state === 'attack' && this.attackCD > (carn ? 1.1 : 1.2))) { clip = carn ? 'Attack' : 'Attack_Headbutt'; fade = 0.12; }
    else if (this.hitT > 0) { clip = 'Idle_HitReact1'; fade = 0.1; }
    else if (this.air > 0) clip = carn ? 'Gallop_Jump' : 'Gallop_Jump';
    else if (sp > 0.2) {
      if (sp < cfg.walk * 1.9) { clip = 'Walk'; ts = Math.min(2.2, Math.max(0.45, sp / cfg.walk)); }
      else { clip = 'Gallop'; ts = Math.min(1.7, Math.max(0.65, sp / cfg.run)); }
    } else if (A.graze > 0.35 || this.state === 'graze' || this.state === 'feed' || this.state === 'forage') clip = 'Eating';
    else if (this.state === 'rest' || A.lie > 0.5) clip = r.actions.Idle_Headlow ? 'Idle_Headlow' : 'Idle_2_HeadLow';
    else if (this.state === 'alert' || this.state === 'warn') clip = 'Idle';
    else clip = (this.id % 3 === 0 && r.actions.Idle_2) ? 'Idle_2' : 'Idle';
    playClip(r, clip, fade, ts);
    r.mixer.update(dt);
    // look toward a threat / target on top of the clip
    const look = this.lookAt || (this.state === 'alert' ? this.threat : null) || ((this.state === 'stalk' || this.state === 'attack' || this.state === 'warn') && W ? (this.target === 'player' ? W.player.pos : this.target?.pos) : null);
    let ny = 0;
    if (look && !this.dead) { const want = Math.atan2(look.x - this.pos.x, look.z - this.pos.z); let diff = want - this.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI; ny = clamp(diff, -1.0, 1.0); }
    this.neckY = lerp(this.neckY || 0, ny, Math.min(1, dt * 5));
    if (J.Neck1 && Math.abs(this.neckY) > 0.01) { J.Neck1.rotateY(this.neckY * 0.5); if (J.Head) J.Head.rotateY(this.neckY * 0.4); }
    if (this.state === 'alert' && J.Neck1 && !this.dead) J.Neck1.rotateX(-0.25);   // head up, ears forward
    // body follows the slope and leans into turns
    let slopeP = 0;
    if (!this.dead) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), hl = (d.L || 1.5) * 0.5 * this.scale;
      const hf = groundHeight(this.pos.x + fx * hl, this.pos.z + fz * hl), hb = groundHeight(this.pos.x - fx * hl, this.pos.z - fz * hl);
      slopeP = -Math.atan2(hf - hb, hl * 2) * 0.9;
    }
    const yawRate = (this.yaw - (this.prevYaw ?? this.yaw)) / Math.max(dt, 1e-3); this.prevYaw = this.yaw;
    this.leanS = lerp(this.leanS || 0, this.dead ? 0 : clamp(-yawRate * this.speed * 0.03, -0.25, 0.25), Math.min(1, dt * 5));
    r.inst.rotation.x = slopeP; r.inst.rotation.z = this.leanS;
  }
  animate(dt, W) {
    if (this.rig) return this.animateRig(dt, W);
    const J = this.J, d = this.d, A = this.anim;
    this.root.rotation.y = this.yaw;
    const body = J.body;
    if (!body) return;
    if (this.sp === 'peafowl') return this.animateBird(dt);
    if (this.sp === 'mugger') return this.animateCroc(dt);
    const legLen = d.leg[0] + d.leg[1] + d.leg[2];
    const sp = this.speed;
    const runK = clamp((sp - d.walk * 1.4) / (d.run * 0.6), 0, 1);
    const stride = legLen * lerp(2.0, 4.2, runK) * this.scale;
    this.phase = (this.phase + dt * sp / Math.max(0.2, stride)) % 1;
    const moving = clamp(sp / (d.walk * 0.7), 0, 1);
    // gait offsets: walk -> trot -> gallop
    const walkO = { LF: 0.25, RF: 0.75, LH: 0.0, RH: 0.5 }, galO = { LF: 0.0, RF: 0.1, LH: 0.5, RH: 0.6 };
    const amp = lerp(0.32, 0.75, runK) * moving;
    const bodyY0 = legLen + d.R * 0.55;
    let by = bodyY0, bpitch = 0, broll = 0;
    const cr = this.crouch ? 1 : 0;
    this.crouchS = lerp(this.crouchS || 0, cr, dt * 4);
    by -= this.crouchS * legLen * 0.3;
    by -= A.lie * legLen * 0.75; by -= A.sit * legLen * (d.primate ? 0.5 : 0.25);
    // slope: pitch the body with the ground but keep the legs plumb, and let each pair reach its own footing
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), hl = d.L * 0.5 * this.scale;
    let slopeP = 0, legDF = 0, legDH = 0;
    if (!this.perch && !this.hop) {
      const hf = groundHeight(this.pos.x + fx * hl, this.pos.z + fz * hl), hb = groundHeight(this.pos.x - fx * hl, this.pos.z - fz * hl);
      slopeP = -Math.atan2(hf - hb, hl * 2) * 0.8;
      const mid = (hf + hb) / 2, resid = (hf - hb) / 2 * 0.2;
      legDF = clamp(resid / (legLen * this.scale), -0.3, 0.3); legDH = -legDF;
      by += (mid - this.pos.y) / this.scale * 0.5;
    }
    const plumb = (this.dead ? 0 : 1) * (1 - A.lie) * (1 - A.sit * 0.7);
    // leaning into turns at speed
    const yawRate = (this.yaw - (this.prevYaw ?? this.yaw)) / Math.max(dt, 1e-3); this.prevYaw = this.yaw;
    this.leanS = lerp(this.leanS || 0, clamp(-yawRate * sp * 0.035, -0.28, 0.28), Math.min(1, dt * 5));
    for (const n of ['LF', 'RF', 'LH', 'RH']) {
      const hip = J['hip' + n], knee = J['knee' + n], ank = J['ankle' + n];
      if (!hip) continue;
      const front = n[1] === 'F';
      const o = lerp(walkO[n], galO[n], runK);
      const p = (this.phase + o) * Math.PI * 2;
      let u = -Math.sin(p) * amp, l = Math.max(0, Math.cos(p)) * amp * 1.4, a = 0;
      if (!front) { u += -0.22; l += 0.5; a = -0.3; } else { u += 0.05; l -= 0.04; }
      u -= this.crouchS * (front ? 0.5 : 0.6); l += this.crouchS * (front ? 0.9 : 1.0);
      if (A.lie > 0.01) { u = lerp(u, front ? -1.2 : 0.9, A.lie); l = lerp(l, front ? 2.3 : -2.0, A.lie); }
      if (A.sit > 0.01) { if (!front) { u = lerp(u, d.primate ? -1.4 : -1.0, A.sit); l = lerp(l, d.primate ? 2.4 : 2.0, A.sit); } else if (d.primate) { u = lerp(u, 0.4, A.sit); l = lerp(l, -0.3, A.sit); } }
      if (A.pounce > 0.01) { u = lerp(u, front ? -1.25 : 0.9, A.pounce); l = lerp(l, front ? -0.2 : 0.1, A.pounce); }
      if (A.swipe > 0.01 && n === 'RF') { const s = Math.sin(A.swipe * Math.PI); u = lerp(u, -1.9, s); l = lerp(l, -0.8, s); }
      if (A.rear > 0.01 && front) { u = lerp(u, -1.3, A.rear); l = lerp(l, -0.6, A.rear); }
      if (this.dead) { const k = Math.min(1, this.deadT * 1.5); u = lerp(u, (front ? -0.6 : 0.5) + Math.sin(this.id + n.length) * 0.3, k); l = lerp(l, 0.3, k); a = lerp(a, 0, k); }
      if (this.limp && n === 'LH') u *= 0.4;
      // shorten or lengthen the leg for its footing by folding the knee
      const ext = front ? legDF : legDH;
      if (ext < 0) l += -ext * 2.2 * plumb;
      u -= slopeP * plumb;
      hip.rotation.x = u; knee.rotation.x = l; ank.rotation.x = a + (front ? -l * 0.5 : 0.1);
    }
    by -= Math.abs(Math.cos(this.phase * Math.PI * 4)) * 0.03 * moving * legLen;
    bpitch = Math.sin(this.phase * Math.PI * 2) * 0.07 * runK;
    bpitch -= A.pounce * 0.35; bpitch -= A.rear * 1.05;
    if (d.primate) bpitch -= A.sit * 1.25;
    else bpitch -= A.sit * 0.45;
    bpitch += slopeP;
    broll += this.leanS * (1 - A.lie);
    // breathing
    const breath = Math.sin(this.t * (this.state === 'flee' || runK > 0.5 ? 5.5 : 1.6)) * (runK > 0.5 ? 0.012 : 0.006);
    by += breath * legLen * (1 - runK * 0.5);
    if (this.dead) {
      const k = Math.min(1, this.deadT * 1.4);
      broll = lerp(0, this.rollDir * Math.PI * 0.48, k * k); by = lerp(by, d.R * 0.9 + d.W * 0.4, k);
    }
    body.position.y = by; body.rotation.set(bpitch, 0, broll);
    // neck/head
    const neck = J.neck, head = J.head, jaw = J.jaw;
    if (neck) {
      let nx = d.primate ? 0.2 : -0.45 + runK * 0.35;
      nx = lerp(nx, d.primate ? 0.6 : 0.95, A.graze);
      if (this.state === 'alert') nx = -0.75;
      if (this.state === 'charge' && (this.sp === 'gaur' || this.sp === 'boar' || this.sp === 'cow')) nx = 0.45;
      nx += this.crouchS * 0.5; nx += A.bite * 0.35;
      if (this.dead) nx = lerp(nx, 0.6, Math.min(1, this.deadT));
      let ny = 0;
      const look = this.lookAt || (this.state === 'alert' ? this.threat : null) || ((this.state === 'stalk' || this.state === 'attack' || this.state === 'warn') && W ? (this.target === 'player' ? W.player.pos : this.target?.pos) : null);
      if (look && !this.dead) { const want = Math.atan2(look.x - this.pos.x, look.z - this.pos.z); let diff = want - this.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI; ny = clamp(diff, -0.9, 0.9); }
      this.neckY = lerp(this.neckY || 0, ny, dt * 5);
      if (!d.cat && !d.primate && !this.dead) nx += Math.sin(this.phase * Math.PI * 4 + 0.6) * 0.07 * moving * (1 - runK) * (1 - A.graze); // walking head nod
      neck.rotation.set(nx - bpitch * 0.6, this.neckY, 0);
      if (head) head.rotation.set(-nx * 0.5 + (A.graze * 0.3), this.neckY * 0.3, Math.sin(this.t * 0.7) * 0.03);
      if (jaw) jaw.rotation.x = A.bite * 0.55 + (this.state === 'attack' || this.state === 'warn' ? 0.12 + Math.sin(this.t * 8) * 0.06 : 0) + (this.dead ? 0.2 : 0);
    }
    // tail
    let tsw = Math.sin(this.t * (d.cat ? 1.4 : 3)) * (d.cat ? 0.25 : 0.15) * (1 + runK);
    for (let i = 0; i < 6; i++) {
      const tj = J['tail' + i]; if (!tj) break;
      if (d.primate) tj.rotation.set(i === 0 ? 1.3 - A.sit * 0.2 : 0.18, Math.sin(this.t * 0.8 + i) * 0.1, 0);
      else tj.rotation.set(i === 0 ? (d.cat ? 0.7 : 0.4) - A.alertTail * 0.9 * (this.sp === 'chital' ? 1 : 0) - runK * 0.4 : (d.cat ? -0.12 : 0.1), tsw * (i + 1) * 0.35, 0);
      if (this.dead) tj.rotation.set(0.1, 0, 0);
    }
    // ears
    if (J.earL && Math.random() < dt * 0.4) J.earL.rotation.x = (Math.random() - 0.5) * 0.6;
    // decay timers
    A.bite = Math.max(0, A.bite - dt * 3); A.swipe = Math.max(0, A.swipe - dt * 2.2);
    if (this.state !== 'pounce' && !this.hop) A.pounce = Math.max(0, A.pounce - dt * 3);
    A.alertTail = Math.max(0, A.alertTail - dt * 0.3);
  }
  animateBird(dt) {
    const J = this.J, A = this.anim, sp = this.speed;
    this.phase = (this.phase + dt * sp / 0.4) % 1;
    const p = this.phase * Math.PI * 2, mv = clamp(sp / 0.5, 0, 1);
    for (const [n, o] of [['LH', 0], ['RH', Math.PI]]) { const h = J['hip' + n], k = J['knee' + n]; if (!h) continue; h.rotation.x = -Math.sin(p + o) * 0.6 * mv - 0.2; k.rotation.x = Math.max(0, Math.cos(p + o)) * 0.8 * mv + 0.3; }
    if (this.air > 0) A.fly = 1; else A.fly = Math.max(0, A.fly - dt * 2);
    const fl = A.fly;
    if (J.wingL) { J.wingL.rotation.z = fl * (0.6 + Math.sin(this.t * 22) * 0.9); J.wingR.rotation.z = -J.wingL.rotation.z; }
    J.body.position.y = 0.55 + Math.abs(Math.sin(p)) * 0.02 * mv;
    J.body.rotation.x = 0.15 + fl * -0.3;
    if (J.neck) J.neck.rotation.x = A.graze * 1.1 + Math.sin(p * 2) * 0.12 * mv - (this.state === 'alert' ? 0.3 : 0);
    if (J.tail0) J.tail0.rotation.x = 0.1 + fl * 0.2;
    if (this.state === 'idle' && Math.random() < dt * 0.4) A.graze = A.graze > 0.5 ? 0 : 1;
    if (this.dead) { J.body.rotation.z = Math.min(1, this.deadT * 2) * 1.4; J.body.position.y = 0.15; }
  }
  animateCroc(dt) {
    const J = this.J, A = this.anim, sp = this.speed;
    this.phase = (this.phase + dt * sp / 1.2) % 1;
    const p = this.phase * Math.PI * 2;
    const swim = waterAt(this.pos.x, this.pos.z) > groundHeight(this.pos.x, this.pos.z) + 0.4;
    J.body.rotation.y = Math.sin(p) * 0.12 * clamp(sp, 0, 1);
    for (let i = 0; i < 6; i++) { const t = J['tail' + i]; if (t) t.rotation.y = Math.sin(p - i * 0.6 + this.t * (swim ? 2 : 0.5)) * (swim ? 0.25 : 0.08); }
    for (const [n, o] of [['LF', 0], ['RF', Math.PI], ['LH', Math.PI], ['RH', 0]]) { const h = J['hip' + n]; if (h) h.rotation.x = swim ? 0.9 : Math.sin(p + o) * 0.5; }
    if (J.jaw) J.jaw.rotation.x = A.bite * 0.7 + (this.state === 'grab' ? 0.15 : 0);
    A.bite = Math.max(0, A.bite - dt * 1.5);
    J.body.rotation.z = A.roll > 0 ? this.t * 9 : (this.dead ? Math.PI : 0);
    J.body.position.y = this.dead ? 0.2 : 0.28;
  }
}

// ------------------------------------------------------------------------------------------------ groups
class Group {
  constructor(kind, center, radius) { this.kind = kind; this.members = []; this.center = center.clone(); this.radius = radius; this.pace = 1; this.target = null; this.alertT = 0; }
  alert(src, pos, W) { for (const m of this.members) if (m !== src && !m.dead && m.state !== 'flee') { m.threat = pos.clone(); m.setState('alert', 0.2 + Math.random() * 0.5); } }
  engage(target, W) {
    this.target = target;
    let i = 0;
    for (const m of this.members) { if (m.dead) continue; m.target = target; m.slot = i++; m.setState('charge'); }
    W.audio.animal('dhole', 'whistle', this.members[0].pos);
  }
  update(dt) {
    const alive = this.members.filter((m) => !m.dead);
    if (!alive.length) return;
    let cx = 0, cz = 0; for (const m of alive) { cx += m.pos.x; cz += m.pos.z; }
    cx /= alive.length; cz /= alive.length;
    if (this.kind !== 'troop') { this.center.x = lerp(this.center.x, cx, dt * 0.05); this.center.z = lerp(this.center.z, cz, dt * 0.05); }
    // drift herd center slowly
    this.center.x += Math.sin(performance.now() * 0.00003 + this.radius) * dt * 0.2;
  }
}

// ------------------------------------------------------------------------------------------------ ecosystem
export class Ecosystem {
  constructor(scene) {
    this.scene = scene; this.animals = []; this.groups = []; this.spawnT = 0;
    this.enabled = true; this.density = 1;
    this.blocked = new Set(); // species not to spawn (story)
  }
  add(a) { this.animals.push(a); this.scene.add(a.root); return a; }
  remove(a) { this.scene.remove(a.root); const i = this.animals.indexOf(a); if (i >= 0) this.animals.splice(i, 1); if (a.group) { const k = a.group.members.indexOf(a); if (k >= 0) a.group.members.splice(k, 1); } }
  spawnGroup(sp, center, n, opts = {}) {
    const kind = sp === 'dhole' ? 'pack' : sp === 'langur' ? 'troop' : 'herd';
    const g = new Group(kind, center, opts.radius || (sp === 'langur' ? 20 : 30));
    this.groups.push(g);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 8;
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r); p.y = groundHeight(p.x, p.z);
      const an = new Animal(sp, p, { group: g, slot: i, ...opts, male: opts.male ?? (i === 0 ? true : Math.random() < 0.35) });
      g.members.push(an); this.add(an); out.push(an);
    }
    return { group: g, members: out };
  }
  spawnOne(sp, pos, opts = {}) { const p = pos.clone(); p.y = groundHeight(p.x, p.z); return this.add(new Animal(sp, p, opts)); }
  // population rules by biome / time
  autoSpawn(W, dt) {
    this.spawnT -= dt; if (this.spawnT > 0 || !this.enabled) return; this.spawnT = 2.5;
    const P = W.player.pos;
    const counts = {};
    for (const a of this.animals) {
      const d2 = a.dist2(P);
      if (!a.persistent && (d2 > 460 * 460 || (a.dead && a.deadT > 240 && d2 > 60 * 60))) { this.remove(a); continue; }
      counts[a.sp] = (counts[a.sp] || 0) + 1;
    }
    this.groups = this.groups.filter((g) => g.members.length);
    const total = this.animals.length;
    if (total > 38 * this.density) return;
    const a = Math.random() * 6.28, r = 170 + Math.random() * 140;
    const sx = P.x + Math.cos(a) * r, sz = P.z + Math.sin(a) * r;
    if (Math.abs(sx) > HALF - 100 || Math.abs(sz) > HALF - 100) return;
    const b = biomeAt(sx, sz), gy = groundHeight(sx, sz);
    const wet = waterAt(sx, sz) > gy - 0.3;
    const night = W.night, season = W.season;
    const pick = [];
    const want = (sp, max, w) => { if (!this.blocked.has(sp) && (counts[sp] || 0) < max * this.density) pick.push([sp, w]); };
    if (wet) { if (season !== 'summer' || Math.random() < 0.5) want('mugger', 2, b.dRiver > 30 || true ? 1 : 0); }
    else {
      want('chital', 3 * 10, 3 + b.grass * 4 + b.riparian * 2);
      want('langur', 2 * 8, 2 + b.teak * 2 + b.riparian);
      want('peafowl', 6, 1.5 + b.open);
      want('sambar', 2 * 4, 1 + b.teak + b.riparian * 2 + night * 2);
      want('boar', 2 * 4, 1 + b.bamboo * 2 + night);
      want('gaur', 6, b.grass * 3 + b.bamboo);
      want('bear', 1, (b.termite * 3 + b.rock + night * 2) * 0.6);
      want('dhole', 6, season === 'monsoon' ? 1.2 : 0.35);
      want('leopard', 1, (b.rock * 4 + night) * 0.3);
      want('tiger', 1, 0.12 + night * 0.15);
    }
    if (!pick.length) return;
    let tw = 0; for (const p of pick) tw += p[1];
    let rr = Math.random() * tw, sp = pick[0][0];
    for (const p of pick) { rr -= p[1]; if (rr <= 0) { sp = p[0]; break; } }
    const c = new THREE.Vector3(sx, gy, sz);
    if (sp === 'mugger') { const m = this.spawnOne('mugger', c, { homeR: 40 }); m.home.copy(c); m.state = 'lurk'; }
    else if (sp === 'chital') this.spawnGroup('chital', c, 5 + Math.floor(Math.random() * 7));
    else if (sp === 'langur') this.spawnGroup('langur', c, 4 + Math.floor(Math.random() * 5));
    else if (sp === 'sambar') this.spawnGroup('sambar', c, 1 + Math.floor(Math.random() * 3));
    else if (sp === 'boar') this.spawnGroup('boar', c, 2 + Math.floor(Math.random() * 4));
    else if (sp === 'gaur') this.spawnGroup('gaur', c, 3 + Math.floor(Math.random() * 4), { radius: 40 });
    else if (sp === 'dhole') this.spawnGroup('dhole', c, 5 + Math.floor(Math.random() * 4), { aggro: season === 'monsoon' ? 0.2 : 0.03 });
    else if (sp === 'peafowl') this.spawnGroup('peafowl', c, 1 + Math.floor(Math.random() * 3));
    else this.spawnOne(sp, c, { homeR: 200, aggro: sp === 'leopard' ? 0.15 : sp === 'tiger' ? 0.06 : 0 });
  }
  update(dt, W) {
    this.autoSpawn(W, dt);
    for (const g of this.groups) g.update(dt);
    const P = W.player.pos;
    for (const a of this.animals) {
      const d2 = a.dist2(P);
      // LOD update rate
      if (d2 > 200 * 200) { a.lodAcc = (a.lodAcc || 0) + dt; if (a.lodAcc < 0.25) continue; a.update(a.lodAcc, W); a.lodAcc = 0; }
      else a.update(dt, W);
      const sh = d2 < 55 * 55;
      if (sh !== a.shadowOn) { a.shadowOn = sh; for (const m of a.meshes) m.castShadow = sh; }
      a.root.visible = d2 < 420 * 420;
    }
    this.separate(P);
  }
  // keep bodies from overlapping: herd members, pack hunters and the companion push apart instead of interpenetrating
  separate(P) {
    const A = this.animals, n = A.length;
    for (let i = 0; i < n; i++) {
      const a = A[i]; if (a.dead || a.perch || a.air > 0 || a.sp === 'peafowl') continue;
      if (a.dist2(P) > 90 * 90) continue;
      for (let j = i + 1; j < n; j++) {
        const b = A[j]; if (b.dead || b.perch || b.air > 0 || b.sp === 'peafowl') continue;
        if (a.target === b || b.target === a || a.grabbed === b || b.grabbed === a) continue; // contact is the point
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, rr = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dz * dz; if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (rr - d) * 0.5, ux = dx / d, uz = dz / d;
        const ma = a.d.mass || 100, mb = b.d.mass || 100, wa = mb / (ma + mb), wb = 1 - wa;
        a.pos.x -= ux * push * 2 * wa; a.pos.z -= uz * push * 2 * wa; b.pos.x += ux * push * 2 * wb; b.pos.z += uz * push * 2 * wb;
      }
    }
  }
  nearestPredator(an, range) {
    let best = null, bd = range * range;
    for (const a of this.animals) {
      if (a.dead || a === an) continue;
      const k = a.d.kind;
      if (k !== 'predator' && k !== 'pack' && !(a.companion && an.sp !== 'langur' && a.bond < 1)) continue;
      if (a.companion && an.bond > 0.6) continue;
      const d2 = a.dist2(an.pos);
      if (d2 < bd && (a.state !== 'rest' || d2 < 100)) { bd = d2; best = a; }
    }
    return best;
  }
  nearestPrey(pred, range) {
    let best = null, bd = range * range;
    for (const a of this.animals) {
      if (a.dead || a === pred || a.companion) continue;
      if (!['chital', 'sambar', 'boar', 'langur', 'cow', 'peafowl'].includes(a.sp)) continue;
      if (a.sp === 'langur' && a.perch) continue;
      const d2 = a.dist2(pred.pos); if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }
  // targeting along a ray
  pick(origin, dir, maxD, cone = 0.96) {
    let best = null, bd = maxD;
    const v = new THREE.Vector3();
    for (const a of this.animals) {
      a.bodyPos(v);
      const to = v.sub(origin); const d = to.length();
      if (d > maxD + a.d.L) continue;
      const c = to.dot(dir) / (d || 1);
      const ang = Math.atan2(a.d.L * 0.5 * a.scale + 0.3, d);
      if (c > Math.cos(ang + Math.acos(cone)) && d < bd) { bd = d; best = a; }
    }
    return best;
  }
  near(pos, r, filter) { const out = []; for (const a of this.animals) { if (a.dist2(pos) < r * r && (!filter || filter(a))) out.push(a); } return out; }
}

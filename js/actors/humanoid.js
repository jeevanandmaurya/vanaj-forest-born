// Procedural humanoid: jointed body (Vanaj, villagers), procedural gait/crouch/swim/jump, combat actions,
// weapons (club, stone knife, bamboo spear, bow, arrows, torch, flute) and first-person view arms.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch, NOISE_GLSL } from '../core/shaderlib.js';
import { mergeByMaterial } from '../core/merge.js';
import { humanRigReady, buildRiggedHuman, animateRiggedHuman } from './humanrig.js';
import { PAINTED } from '../core/palette.js';
import { toonify } from '../core/toon.js';

function limbGeo(r0, r1, len, radial = 10) {
  const c = new THREE.CylinderGeometry(r1, r0, len, radial, 4, true); c.translate(0, -len / 2, 0);
  // slight muscle bulge
  const p = c.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = -p.getY(i) / len; const b = 1 + 0.12 * Math.sin(Math.PI * Math.min(1, y * 1.3));
    p.setX(i, p.getX(i) * b); p.setZ(i, p.getZ(i) * b);
  }
  const s0 = new THREE.SphereGeometry(r0, radial, 6); const s1 = new THREE.SphereGeometry(r1, radial, 6); s1.translate(0, -len, 0);
  c.computeVertexNormals();
  const g = mergeGeometries([c, s0, s1]);
  return g;
}
function ellip(rx, ry, rz, seg = 14) { const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.6)); g.scale(rx, ry, rz); return g; }

export function skinMaterial(color = 0x5e3d2a, mud = 0.35, key = 'skin') {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 });
  m.userData.mud = { value: mud };
  patch(m, key, (s) => {
    s.uniforms.uMud = m.userData.mud;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vSkinP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vSkinP = position * 9.0 + modelMatrix[3].xyz * 0.0;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n ${NOISE_GLSL}\n uniform float uMud; uniform float uWetness; varying vec3 vSkinP;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sn = fbm3(vSkinP * 0.6);
        float mudm = smoothstep(0.55, 0.7, fbm3(vSkinP * 0.25 + 3.0)) * uMud;
        diffuseColor.rgb *= 0.88 + 0.24 * sn;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.24, 0.17), mudm);
        diffuseColor.rgb *= mix(1.0, 0.8, uWetness);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.62, 0.3, uWetness) + mudm * 0.3;`);
  });
  return m;
}

// in the painted look every person is toon-shaded with ink outlines (docs/art-direction.md)
export function buildHumanoid(opts = {}) {
  const h = buildHumanoidBody(opts);
  if (PAINTED) toonify(h.root, { soften: 2, outline: opts.outline ?? 0.006 });
  return h;
}
function buildHumanoidBody(opts) {
  if (humanRigReady() && !opts.procedural) return buildRiggedHuman(opts);
  const S = opts.scale || 1.0;
  const skin = opts.skin || skinMaterial(opts.skinColor || 0x5e3d2a, opts.mud ?? 0.35, opts.skinKey || 'skin');
  const hairM = new THREE.MeshStandardMaterial({ color: opts.hairColor || 0x16110d, roughness: 0.85 });
  const root = new THREE.Group();
  const j = {};
  const mk = (geo, mat, parent, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
  const joint = (name, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); j[name] = g; return g; };
  const lean = opts.lean ?? 1; // body mass factor
  joint('hips', root, 0, 0.93 * S, 0);
  mk(ellip(0.15 * S * lean, 0.11 * S, 0.1 * S * lean), skin, j.hips);
  joint('spine', j.hips, 0, 0.08 * S, 0);
  // abdomen / chest lathe
  const prof = [[0.0, 0], [0.13, 0.0], [0.125, 0.08], [0.122, 0.16], [0.14, 0.24], [0.16, 0.31], [0.165, 0.37], [0.14, 0.42], [0.06, 0.45], [0, 0.45]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * S * lean, y * S)), 16);
  lathe.scale(1, 1, 0.68);
  mk(lathe, skin, j.spine);
  joint('chest', j.spine, 0, 0.3 * S, 0);
  joint('neck', j.chest, 0, 0.14 * S, 0.0);
  mk(limbGeo(0.048 * S, 0.042 * S, 0.09 * S, 8).rotateX(Math.PI), skin, j.neck);
  joint('head', j.neck, 0, 0.1 * S, 0.01 * S);
  const head = mk(ellip(0.098 * S, 0.118 * S, 0.11 * S, 18), skin, j.head); head.position.set(0, 0.08 * S, 0);
  // jaw/face details
  mk(ellip(0.07 * S, 0.05 * S, 0.075 * S, 10), skin, j.head).position.set(0, 0.02 * S, 0.03 * S);
  const nose = mk(new THREE.ConeGeometry(0.016 * S, 0.04 * S, 6), skin, j.head); nose.position.set(0, 0.07 * S, 0.112 * S); nose.rotation.x = Math.PI / 2.2;
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 0.2 });
  for (const sx of [-1, 1]) {
    mk(ellip(0.013 * S, 0.009 * S, 0.008 * S, 8), eyeM, j.head, false).position.set(sx * 0.036 * S, 0.095 * S, 0.1 * S);
    mk(ellip(0.012 * S, 0.026 * S, 0.02 * S, 8), skin, j.head).position.set(sx * 0.1 * S, 0.075 * S, -0.005 * S);
    mk(ellip(0.03 * S, 0.008 * S, 0.012 * S, 8), skin, j.head).position.set(sx * 0.036 * S, 0.114 * S, 0.1 * S); // brow
  }
  // hair
  if (opts.hair !== 'none') {
    const hg = ellip(0.108 * S, 0.11 * S, 0.118 * S, 14); hg.translate(0, 0.1 * S, -0.012 * S);
    const hp = hg.attributes.position;
    for (let i = 0; i < hp.count; i++) { const y = hp.getY(i); if (y < 0.06 * S) hp.setY(i, y * 0.5 + 0.03 * S); const n = 1 + 0.08 * Math.sin(i * 12.9898) ; hp.setX(i, hp.getX(i) * n); hp.setZ(i, hp.getZ(i) * n); }
    hg.computeVertexNormals();
    mk(hg, hairM, j.head);
    if (opts.hair === 'matted') {
      const locks = [];
      for (let k = 0; k < 26; k++) {
        const a = Math.PI * 0.15 + (k / 26) * Math.PI * 1.7; const len = (0.18 + Math.random() * 0.2) * S;
        const l = limbGeo(0.014 * S, 0.007 * S, len, 5);
        l.rotateX((Math.random() - 0.5) * 0.4 - 0.15); l.rotateZ((Math.random() - 0.5) * 0.3);
        l.translate(Math.sin(a) * 0.095 * S, 0.12 * S, -Math.cos(a) * 0.095 * S - 0.01 * S);
        locks.push(l);
      }
      mk(mergeGeometries(locks), hairM, j.head);
    }
  }
  if (opts.turban) { const t = mk(new THREE.TorusGeometry(0.1 * S, 0.035 * S, 8, 18), new THREE.MeshStandardMaterial({ map: opts.turban, roughness: 0.9 }), j.head); t.rotation.x = Math.PI / 2; t.position.y = 0.16 * S; }
  // arms
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    joint('shoulder' + side, j.chest, sx * 0.165 * S * lean, 0.1 * S, -0.01 * S);
    mk(ellip(0.055 * S, 0.05 * S, 0.05 * S, 10), skin, j['shoulder' + side]);
    joint('upperArm' + side, j['shoulder' + side], 0, 0, 0);
    mk(limbGeo(0.047 * S * lean, 0.037 * S, 0.27 * S), skin, j['upperArm' + side]);
    joint('foreArm' + side, j['upperArm' + side], 0, -0.27 * S, 0);
    mk(limbGeo(0.036 * S, 0.026 * S, 0.24 * S), skin, j['foreArm' + side]);
    joint('hand' + side, j['foreArm' + side], 0, -0.245 * S, 0);
    buildHand(j['hand' + side], skin, S, sx, mk);
    // legs
    joint('thigh' + side, j.hips, sx * 0.085 * S, -0.03 * S, 0);
    mk(limbGeo(0.068 * S * lean, 0.046 * S, 0.43 * S), skin, j['thigh' + side]);
    joint('shin' + side, j['thigh' + side], 0, -0.43 * S, 0);
    mk(limbGeo(0.048 * S, 0.032 * S, 0.42 * S), skin, j['shin' + side]);
    joint('foot' + side, j['shin' + side], 0, -0.425 * S, 0);
    const ft = mk(ellip(0.045 * S, 0.03 * S, 0.115 * S, 10), skin, j['foot' + side]); ft.position.set(0, -0.025 * S, 0.06 * S);
  }
  // clothing
  const cloth = opts.cloth;
  if (cloth === 'loin') {
    const cm = new THREE.MeshStandardMaterial({ map: opts.clothTex, roughness: 0.95, side: THREE.DoubleSide });
    const band = mk(new THREE.TorusGeometry(0.15 * S, 0.018 * S, 6, 20), cm, j.hips); band.rotation.x = Math.PI / 2; band.scale.set(1, 0.72, 1); band.position.y = 0.04 * S;
    const flap = new THREE.PlaneGeometry(0.17 * S, 0.3 * S, 2, 4); flap.translate(0, -0.13 * S, 0);
    j.flapF = new THREE.Group(); j.flapF.position.set(0, 0.03 * S, 0.105 * S); j.hips.add(j.flapF); mk(flap, cm, j.flapF);
    j.flapB = new THREE.Group(); j.flapB.position.set(0, 0.03 * S, -0.1 * S); j.hips.add(j.flapB); mk(flap.clone(), cm, j.flapB);
  } else if (cloth === 'dhoti' || cloth === 'sari') {
    const cm = new THREE.MeshStandardMaterial({ map: opts.clothTex, roughness: 0.95, side: THREE.DoubleSide });
    const skirt = new THREE.CylinderGeometry(0.17 * S, cloth === 'sari' ? 0.26 * S : 0.2 * S, cloth === 'sari' ? 0.86 * S : 0.5 * S, 16, 3, true);
    skirt.translate(0, -(cloth === 'sari' ? 0.4 : 0.22) * S, 0); skirt.scale(1, 1, 0.8);
    j.skirt = mk(skirt, cm, j.hips);
    const top = new THREE.CylinderGeometry(0.15 * S * lean, 0.14 * S * lean, 0.36 * S, 16, 2, true); top.translate(0, 0.2 * S, 0); top.scale(1, 1, 0.72);
    const tm = new THREE.MeshStandardMaterial({ map: opts.topTex || opts.clothTex, roughness: 0.95, side: THREE.DoubleSide });
    mk(top, tm, j.spine);
    if (cloth === 'sari') { const drape = new THREE.PlaneGeometry(0.22 * S, 0.6 * S, 2, 6); drape.translate(0, -0.25 * S, 0); const d = mk(drape, cm, j.chest); d.position.set(0.05 * S, 0.12 * S, 0.11 * S); d.rotation.z = 0.5; }
  }
  mergeByMaterial(root);
  root.userData.joints = j;
  const h = { root, j, S, phase: 0, t: 0, weaponR: null, weaponL: null, blendRun: 0, crouchS: 0, airS: 0, swimS: 0, dead: 0, skin };
  return h;
}

function buildHand(parent, skin, S, sx, mk) {
  mk(ellip(0.038 * S, 0.048 * S, 0.02 * S, 10), skin, parent).position.set(0, -0.045 * S, 0);
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.Group(); fg.position.set((f - 1.5) * 0.017 * S * sx, -0.088 * S, 0.004 * S); fg.rotation.x = 0.7; parent.add(fg);
    mk(limbGeo(0.009 * S, 0.0075 * S, 0.06 * S - Math.abs(f - 1.5) * 0.006 * S, 6), skin, fg);
  }
  const th = new THREE.Group(); th.position.set(-0.028 * S * sx, -0.035 * S, 0.016 * S); th.rotation.set(0.6, 0, sx * 0.7); parent.add(th);
  mk(limbGeo(0.011 * S, 0.008 * S, 0.05 * S, 6), skin, th);
}

const _e = new THREE.Euler();
function setR(g, x, y, z) { g.rotation.set(x, y, z); }
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// anim: { speed, crouch, air, vy, swim, action:{type,t}, weapon, aim, draw, lookPitch, dead, kneel }
export function animateHumanoid(h, dt, a) {
  if (h.rig) return animateRiggedHuman(h, dt, a);
  const j = h.j, S = h.S;
  h.t += dt;
  const spd = a.speed || 0;
  const run = Math.min(1, Math.max(0, (spd - 3.2) / 3.5));
  h.blendRun += (run - h.blendRun) * Math.min(1, dt * 6);
  h.crouchS += ((a.crouch || 0) - h.crouchS) * Math.min(1, dt * 8);
  h.airS += ((a.air ? 1 : 0) - h.airS) * Math.min(1, dt * 8);
  h.swimS += ((a.swim || 0) - h.swimS) * Math.min(1, dt * 4);
  const stride = lerp(1.25, 2.3, h.blendRun) * (1 - h.crouchS * 0.4);
  h.phase += dt * spd / stride;
  const c = h.phase * Math.PI * 2;
  const mv = Math.min(1, spd / 1.2);
  const A = lerp(0.42, 0.95, h.blendRun) * mv, K = lerp(0.85, 1.7, h.blendRun) * mv;
  const cr = h.crouchS, br = Math.sin(h.t * 1.9) * 0.015;
  // legs
  for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
    const cc = c + off;
    let th = -Math.sin(cc) * A, kn = Math.max(0, Math.sin(cc + 1.3)) * K + 0.06 + run * 0.15;
    th -= cr * 1.05; kn += cr * 1.75;
    if (h.airS > 0.01) { th = lerp(th, side === 'L' ? -0.7 : -0.25, h.airS); kn = lerp(kn, side === 'L' ? 1.2 : 0.6, h.airS); }
    if (h.swimS > 0.01) { th = lerp(th, Math.sin(h.t * 5 + off) * 0.35, h.swimS); kn = lerp(kn, 0.3 + Math.max(0, Math.sin(h.t * 5 + off)) * 0.6, h.swimS); }
    if (a.kneel) { th = lerp(th, side === 'L' ? -1.5 : -0.3, a.kneel); kn = lerp(kn, side === 'L' ? 1.6 : 2.2, a.kneel); }
    setR(j['thigh' + side], th, 0, (side === 'L' ? 1 : -1) * 0.04);
    setR(j['shin' + side], kn, 0, 0);
    setR(j['foot' + side], -(th + kn) * 0.55 + 0.1, 0, 0);
  }
  // hips / torso
  // walking vaults over a straight stance leg (pelvis highest as the legs pass); running compresses into it
  const pass = Math.abs(Math.cos(c)) - 0.5;
  const bob = lerp(pass * 0.034, -pass * 0.06, h.blendRun) * mv * (1 - cr * 0.6);
  const idleSway = Math.sin(h.t * 0.45) * (1 - mv);
  j.hips.position.y = 0.93 * S + bob - 0.012 * S * mv - cr * 0.33 * S - (a.kneel || 0) * 0.38 * S + h.airS * 0.05;
  j.hips.position.x = idleSway * 0.012 * S;
  j.hips.rotation.set(-h.swimS * 1.35 + h.blendRun * 0.06, Math.sin(c) * lerp(0.12, 0.17, h.blendRun) * mv, Math.sin(c) * 0.045 * mv + idleSway * 0.025);
  j.spine.rotation.set(0.05 + h.blendRun * 0.22 + cr * 0.35 + br, -Math.sin(c) * lerp(0.16, 0.24, h.blendRun) * mv, -Math.sin(c) * 0.03 * mv - idleSway * 0.02);
  j.chest.rotation.set(br * 2, 0, 0);
  const lp = (a.lookPitch || 0);
  j.neck.rotation.set(-lp * 0.35 - cr * 0.2 - h.blendRun * 0.1 + h.swimS * 0.9, 0, 0);
  j.head.rotation.set(-lp * 0.4 + h.swimS * 0.5, 0, 0);
  // arms default swing
  let uaL = Math.sin(c) * A * 0.9, uaR = -Math.sin(c) * A * 0.9;
  let elL = -0.25 - h.blendRun * 1.1, elR = -0.25 - h.blendRun * 1.1;
  let zL = 0.12, zR = -0.12, yL = 0, yR = 0;
  if (h.swimS > 0.01) {
    const sw = h.t * 2.6;
    uaL = lerp(uaL, -2.4 + Math.sin(sw) * 0.9, h.swimS); uaR = lerp(uaR, -2.4 + Math.sin(sw) * 0.9, h.swimS);
    zL = lerp(zL, 0.4 + Math.cos(sw) * 0.6, h.swimS); zR = lerp(zR, -0.4 - Math.cos(sw) * 0.6, h.swimS);
    elL = lerp(elL, -0.4, h.swimS); elR = lerp(elR, -0.4, h.swimS);
  }
  if (h.airS > 0.01) { uaL = lerp(uaL, -0.9, h.airS); uaR = lerp(uaR, -0.9, h.airS); zL = lerp(zL, 0.5, h.airS); zR = lerp(zR, -0.5, h.airS); }
  // weapon idle holds
  const w = a.weapon || 'none';
  if (w === 'spear' || w === 'club' || w === 'torch' || w === 'knife') { uaR = lerp(uaR, -0.45, 0.7); elR = -0.9; }
  if (w === 'spear') { uaL = -0.55; elL = -1.0; zL = 0.25; }
  if (w === 'bow') { uaL = lerp(uaL, -0.25, 0.6); elL = -0.4; }
  if (a.aim > 0.01 && w === 'bow') {
    const d = a.draw || 0;
    uaL = lerp(uaL, -1.55 - lp, a.aim); elL = lerp(elL, -0.05, a.aim); zL = lerp(zL, 0.0, a.aim); yL = lerp(0, -0.25, a.aim);
    uaR = lerp(uaR, -1.6 - lp, a.aim); elR = lerp(elR, -1.2 - d * 1.2, a.aim); zR = lerp(zR, 0.15 + d * 0.5, a.aim); yR = lerp(0, 0.6, a.aim);
  }
  if (a.aim > 0.01 && w === 'spear') { uaR = lerp(uaR, -2.7, a.aim); elR = lerp(elR, -0.6, a.aim); zR = lerp(zR, -0.3, a.aim); uaL = lerp(uaL, -1.2, a.aim); elL = -0.3; }
  // actions
  const act = a.action;
  if (act && act.type) {
    const t = act.t;
    if (act.type === 'swing') { // overhead diagonal smash
      const wind = ease(Math.min(1, t / 0.35)), strike = ease(Math.min(1, Math.max(0, (t - 0.35) / 0.18))), rec = ease(Math.max(0, (t - 0.6) / 0.4));
      uaR = lerp(lerp(-0.45, -2.8, wind), 0.35, strike); uaR = lerp(uaR, -0.45, rec);
      zR = lerp(lerp(-0.12, -0.5, wind), 0.4, strike); zR = lerp(zR, -0.12, rec);
      elR = lerp(-0.9, -0.3, strike);
      j.spine.rotation.y += lerp(lerp(0, 0.5, wind), -0.5, strike) * (1 - rec);
      j.spine.rotation.x += strike * 0.35 * (1 - rec);
    } else if (act.type === 'stab') {
      const wind = ease(Math.min(1, t / 0.25)), strike = ease(Math.min(1, Math.max(0, (t - 0.25) / 0.12))), rec = ease(Math.max(0, (t - 0.45) / 0.55));
      uaR = lerp(lerp(-0.45, -0.2, wind), -1.6, strike); uaR = lerp(uaR, -0.45, rec);
      elR = lerp(lerp(-0.9, -2.0, wind), -0.1, strike); elR = lerp(elR, -0.9, rec);
      j.spine.rotation.y += lerp(0.3 * wind, -0.35, strike) * (1 - rec);
    } else if (act.type === 'thrust') {
      const wind = ease(Math.min(1, t / 0.3)), strike = ease(Math.min(1, Math.max(0, (t - 0.3) / 0.14))), rec = ease(Math.max(0, (t - 0.55) / 0.45));
      uaR = lerp(lerp(-0.45, -0.6, wind), -1.45, strike); uaR = lerp(uaR, -0.45, rec);
      elR = lerp(lerp(-0.9, -1.9, wind), -0.15, strike); elR = lerp(elR, -0.9, rec);
      uaL = lerp(-0.55, -1.3, strike * (1 - rec)); elL = lerp(-1.0, -0.4, strike * (1 - rec));
      j.spine.rotation.x += strike * 0.25 * (1 - rec); j.spine.rotation.y += lerp(0.25 * wind, -0.3, strike) * (1 - rec);
    } else if (act.type === 'throw') {
      const strike = ease(Math.min(1, t / 0.25)), rec = ease(Math.max(0, (t - 0.35) / 0.65));
      uaR = lerp(-2.8, 0.2, strike); uaR = lerp(uaR, -0.45, rec); elR = lerp(-0.6, -0.1, strike);
      j.spine.rotation.y += lerp(0.6, -0.6, strike) * (1 - rec); j.spine.rotation.x += strike * 0.3 * (1 - rec);
    } else if (act.type === 'punch') {
      const s = Math.sin(Math.min(1, t / 0.5) * Math.PI);
      uaR = lerp(-0.45, -1.55, s); elR = lerp(-1.6, -0.1, s); j.spine.rotation.y -= s * 0.35;
    } else if (act.type === 'block') {
      uaR = -1.5; elR = -1.4; zR = 0.6; uaL = -1.5; elL = -1.4; zL = -0.6;
    } else if (act.type === 'gather' || act.type === 'drink' || act.type === 'eat') {
      const s = Math.sin(Math.min(1, t) * Math.PI);
      j.hips.position.y -= s * 0.35 * S; j.spine.rotation.x += s * 0.7;
      uaR = lerp(uaR, act.type === 'eat' ? -2.0 : -1.2, s); elR = lerp(elR, act.type === 'eat' ? -2.2 : -0.5, s);
      uaL = lerp(uaL, act.type === 'drink' ? -1.2 : uaL, s); elL = lerp(elL, -0.5, s);
      for (const sd of ['L', 'R']) { j['thigh' + sd].rotation.x -= s * 1.0; j['shin' + sd].rotation.x += s * 1.8; }
    } else if (act.type === 'hit') {
      const s = Math.sin(Math.min(1, t) * Math.PI);
      j.spine.rotation.x -= s * 0.4; j.neck.rotation.x -= s * 0.4; uaL -= s * 0.6; uaR -= s * 0.6;
    } else if (act.type === 'roar') {
      const s = Math.sin(Math.min(1, t) * Math.PI), beat = Math.sin(t * 40);
      uaL = -0.8 + beat * 0.3 * s; uaR = -0.8 - beat * 0.3 * s; elL = -1.9; elR = -1.9; zL = -0.5; zR = 0.5;
      j.neck.rotation.x -= s * 0.6; j.spine.rotation.x -= s * 0.2;
    } else if (act.type === 'flute' || act.type === 'hum') {
      uaR = -1.4; elR = -1.9; zR = 0.4; uaL = -1.3; elL = -2.0; zL = -0.3; j.neck.rotation.x -= 0.1;
    }
  }
  setR(j.upperArmL, uaL, yL, zL); setR(j.upperArmR, uaR, yR, zR);
  setR(j.foreArmL, elL, 0, 0); setR(j.foreArmR, elR, 0, 0);
  setR(j.handL, -0.2, 0, 0); setR(j.handR, -0.2, 0, 0);
  // feet on the ground: two-bone IK per leg against the terrain under each foot, pelvis drops for the lower foot
  if (a.ground && !a.dead) footIK(h, a, dt);
  // cloth flaps
  if (j.flapF) { j.flapF.rotation.x = -Math.max(0, -j.thighL.rotation.x, -j.thighR.rotation.x) * 0.7 - spd * 0.03; j.flapB.rotation.x = Math.max(0, j.thighL.rotation.x, j.thighR.rotation.x) * 0.5 + spd * 0.04; }
  // death
  if (a.dead) {
    h.dead = Math.min(1, h.dead + dt * 1.6);
    const d = ease(h.dead);
    j.hips.rotation.x = lerp(j.hips.rotation.x, -1.5, d); j.hips.position.y = lerp(j.hips.position.y, 0.18 * S, d);
    for (const sd of ['L', 'R']) { j['thigh' + sd].rotation.x = lerp(j['thigh' + sd].rotation.x, -0.1, d); j['shin' + sd].rotation.x = lerp(j['shin' + sd].rotation.x, 0.2, d); j['upperArm' + sd].rotation.x = lerp(j['upperArm' + sd].rotation.x, -2.6, d); }
  } else h.dead = 0;
}

const L1 = 0.43, L2 = 0.425;
function footIK(h, a, dt) {
  const j = h.j, S = h.S, l1 = L1 * S, l2 = L2 * S;
  const w = (1 - h.airS) * (1 - h.swimS);
  if (w < 0.02) return;
  h.ikOff = h.ikOff || { L: 0, R: 0, drop: 0 };
  const hipY = j.hips.position.y - 0.03 * S;
  const fk = {};
  for (const side of ['L', 'R']) {
    const th = j['thigh' + side].rotation.x, kn = j['shin' + side].rotation.x;
    const kz = -Math.sin(th) * l1, ky = -Math.cos(th) * l1;
    const az = kz - Math.sin(th + kn) * l2, ay = ky - Math.cos(th + kn) * l2;
    const x = j['thigh' + side].position.x;
    const g = clamp(a.ground(x, az + 0.05 * S), -0.6, 0.6);     // ground under the foot, relative to the root
    const ao = h.ikOff[side] = lerp(h.ikOff[side], g, Math.min(1, dt * 14));
    fk[side] = { az, ay, x, g: ao, shinA: th + kn, foot: j['foot' + side].rotation.x };
  }
  const drop = h.ikOff.drop = lerp(h.ikOff.drop, Math.max(0, -Math.min(fk.L.g, fk.R.g, 0.0)) * w, Math.min(1, dt * 10));
  j.hips.position.y -= drop;
  for (const side of ['L', 'R']) {
    const f = fk[side];
    // ankle target in hip-joint space: FK pose shifted by the ground offset, plus the pelvis drop
    const tz = f.az, ty = f.ay + (f.g + drop) * w;
    const D = clamp(Math.hypot(tz, ty), 0.15 * S, (l1 + l2) * 0.999);
    const phi = Math.atan2(tz, -ty);
    const cb = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1), ck = clamp((l1 * l1 + l2 * l2 - D * D) / (2 * l1 * l2), -1, 1);
    const th = -(phi + Math.acos(cb)), kn = Math.PI - Math.acos(ck);
    j['thigh' + side].rotation.x = th; j['shin' + side].rotation.x = kn;
    // foot flat to the local slope
    const gs = a.ground(f.x, tz + 0.12 * S) - a.ground(f.x, tz - 0.08 * S);
    // keep the gait's heel-strike / toe-off, re-expressed for the new shin angle, then tip it to the slope
    j['foot' + side].rotation.x = f.foot + (f.shinA - (th + kn)) + clamp(-Math.atan2(gs, 0.2 * S), -0.5, 0.5) * w;
  }
}

// ----------------------------------------------------------------------------------------- weapons
export function buildWeapons(T) {
  const wood = new THREE.MeshStandardMaterial({ map: T.bark.teak, color: 0xb59a78, roughness: 0.85 });
  const bamboo = new THREE.MeshStandardMaterial({ map: T.bark.bamboo, roughness: 0.6 });
  const flint = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.35, metalness: 0.05, flatShading: true });
  const fiber = new THREE.MeshStandardMaterial({ color: 0x8a7650, roughness: 1 });
  const W = {};
  // club: knobby heavy branch
  {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.028, 0.85, 8), wood); shaft.position.y = 0.32; g.add(shaft);
    const knob = new THREE.Mesh(new THREE.DodecahedronGeometry(0.085, 1), wood); knob.position.y = 0.76; knob.scale.set(1, 1.3, 1); g.add(knob);
    for (let k = 0; k < 5; k++) { const n = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 5), wood); n.position.set(Math.cos(k * 1.3) * 0.07, 0.68 + k * 0.03, Math.sin(k * 1.3) * 0.07); n.rotation.z = Math.cos(k * 1.3) * -1.2; n.rotation.x = Math.sin(k * 1.3) * 1.2; g.add(n); }
    g.userData = { tip: 0.8 }; W.club = g;
  }
  // stone axe: a flint head lashed into a split haft
  {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.72, 7), wood); shaft.position.y = 0.26; g.add(shaft);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), flint); head.scale.set(1.45, 0.95, 0.34); head.position.set(0.075, 0.56, 0); g.add(head);
    const lash = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 7), fiber); lash.position.y = 0.55; g.add(lash);
    g.userData = { tip: 0.6 }; W.axe = g;
  }
  // stone knife
  {
    const g = new THREE.Group();
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.12, 6), wood); h.position.y = 0.02; g.add(h);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6), fiber); wrap.position.y = 0.08; g.add(wrap);
    const bl = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), flint); bl.scale.set(0.45, 1.9, 0.16); bl.position.y = 0.19; g.add(bl);
    g.userData = { tip: 0.3 }; W.knife = g;
  }
  // spear
  {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 2.1, 6), bamboo); shaft.position.y = 0.35; g.add(shaft);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), flint); head.scale.set(0.5, 2.4, 0.18); head.position.y = 1.52; g.add(head);
    const lash = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 6), fiber); lash.position.y = 1.38; g.add(lash);
    g.userData = { tip: 1.6 }; W.spear = g;
  }
  // bow (held in left hand, vertical)
  {
    const g = new THREE.Group();
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.65, 0), new THREE.Vector3(0, 0, 0.16), new THREE.Vector3(0, 0.65, 0));
    const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 6), bamboo); g.add(limb);
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.64, 0.005), new THREE.Vector3(0, 0, 0.005), new THREE.Vector3(0, 0.64, 0.005)]);
    const str = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xd8cdb0 })); g.add(str);
    g.userData = { string: str, tip: 0 }; W.bow = g;
  }
  // arrow
  {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.78, 5), wood); shaft.position.y = 0.0; g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 4), flint); head.position.y = 0.42; g.add(head);
    const fm = new THREE.MeshStandardMaterial({ color: 0x1d5a4a, roughness: 0.6, side: THREE.DoubleSide });
    for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.09), fm); f.position.y = -0.33; f.rotation.y = k * 2.09; f.position.x = Math.sin(k * 2.09) * 0.012; f.position.z = Math.cos(k * 2.09) * 0.012; g.add(f); }
    W.arrow = g;
  }
  // torch
  {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6), wood); shaft.position.y = 0.2; g.add(shaft);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.16, 7), new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 1, emissive: 0x401000, emissiveIntensity: 0.6 })); head.position.y = 0.58; g.add(head);
    const fp = new THREE.Object3D(); fp.position.y = 0.66; g.add(fp);
    g.userData = { firePoint: fp, tip: 0.6 }; W.torch = g;
  }
  // flute
  {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), bamboo); g.add(t);
    const hm = new THREE.MeshBasicMaterial({ color: 0x100804 });
    for (let k = 0; k < 6; k++) { const hole = new THREE.Mesh(new THREE.CircleGeometry(0.004, 6), hm); hole.position.set(0, -0.12 + k * 0.035, 0.0125); g.add(hole); }
    W.flute = g;
  }
  W.fists = null;
  return W;
}

// First-person arms (forearm + hand), reusing body pieces
export function buildViewArms(skin) {
  const root = new THREE.Group();
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
  const arms = {};
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const ua = new THREE.Group(); root.add(ua);
    mk(limbGeo(0.05, 0.038, 0.3), skin, ua);
    const fa = new THREE.Group(); fa.position.y = -0.3; ua.add(fa);
    mk(limbGeo(0.038, 0.028, 0.26), skin, fa);
    const hand = new THREE.Group(); hand.position.y = -0.26; fa.add(hand);
    buildHand(hand, skin, 1.0, sx, (g, m, p) => mk(g, m, p));
    arms[side] = { ua, fa, hand };
  }
  return { root, arms };
}

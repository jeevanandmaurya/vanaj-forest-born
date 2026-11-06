// Skinned human for the player and villagers: Quaternius' CC0 mannequin and its Universal Animation Library
// clips (idle, walk, jog, sprint, crouch, jump, punch, death), cross-faded by speed and state. Actions the
// clips don't cover (bow draw, spear throw, club swing, gathering, flute) aim the arm bones in world space on
// top of the clip, so they work whatever the bones' local axes are. Clothing and hair ride on the bones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch, NOISE_GLSL } from '../core/shaderlib.js';

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

function skinMat(color, key) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 });
  patch(m, 'hskin-' + key, (s) => {
    // dust and mud up the shins, faint sheen on the shoulders
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying float vBY; varying vec3 vBP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBY = position.y; vBP = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying float vBY; varying vec3 vBP;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.78, 0.7, 0.6), diffuseColor.rgb, smoothstep(0.18, 0.55, vBY));
        // sun-darkened, uneven skin: slow mottling and a little desaturation keep it from reading as plastic
        float mot = vnoise(vBP.xy * 21.0 + vBP.z * 13.0) * 0.5 + 0.5;
        diffuseColor.rgb *= mix(0.88, 1.06, mot);
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), diffuseColor.rgb, 0.82);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // cheap subsurface: warm light bleeding into the shadow side
        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.16, 0.05, 0.03) * (1.0 - saturate(dot(normal, normalize(vec3(0.0, 1.0, 0.0))) * 0.5 + 0.5));`);
  });
  return m;
}

function bonePos(inst, name, out) { const b = inst.getObjectByName(name); b.getWorldPosition(out); return out; }

// clothing built in model space against the rest pose, then attached to the bones (keeps world transform)
function dress(inst, opts, S) {
  const B = (n) => inst.getObjectByName(n);
  const hip = bonePos(inst, 'DEF-hips', new THREE.Vector3()), chest = bonePos(inst, 'DEF-spine003', new THREE.Vector3()), head = bonePos(inst, 'DEF-head', new THREE.Vector3());
  const neck = bonePos(inst, 'DEF-neck', new THREE.Vector3()), kneeL = bonePos(inst, 'DEF-shinL', new THREE.Vector3()), footL = bonePos(inst, 'DEF-footL', new THREE.Vector3());
  const mats = [];
  const add = (geo, mat, bone) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; inst.add(m); B(bone).attach(m); mats.push(mat); return m; };
  const cloth = (tex, color = 0xffffff) => new THREE.MeshStandardMaterial({ map: tex || null, color, roughness: 0.95, side: THREE.DoubleSide });
  const ring = (y0, y1, r0, r1, seg = 18) => { const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 3, true); g.translate(0, (y0 + y1) / 2, 0); return g; };
  const hy = hip.y;
  if (opts.cloth === 'loin') {
    const cm = cloth(opts.clothTex, 0xd8c8a8);
    add(ring(hy - 0.12, hy + 0.04, 0.17, 0.155), cm, 'DEF-hips');
    const flap = new THREE.PlaneGeometry(0.17, 0.3); flap.translate(0, hy - 0.2, 0.15); add(flap, cm, 'DEF-hips');
    const flapB = new THREE.PlaneGeometry(0.2, 0.26); flapB.translate(0, hy - 0.18, -0.14); add(flapB, cm, 'DEF-hips');
  } else if (opts.cloth === 'dhoti') {
    const cm = cloth(opts.clothTex, 0xffffff);
    add(ring(kneeL.y - 0.05, hy + 0.06, 0.24, 0.17), cm, 'DEF-hips');
  } else if (opts.cloth === 'sari') {
    const cm = cloth(opts.clothTex, 0xffffff);
    add(ring(footL.y + 0.06, hy + 0.08, 0.27, 0.17, 22), cm, 'DEF-hips');
    add(ring(chest.y - 0.2, chest.y + 0.08, 0.15, 0.135), cm, 'DEF-spine003');
    const pallu = new THREE.PlaneGeometry(0.22, 0.75); pallu.rotateZ(0.5); pallu.translate(0.05, chest.y - 0.12, 0.13); add(pallu, cm, 'DEF-spine003');
  }
  if (opts.topTex) { const tm = cloth(opts.topTex, 0xffffff); add(ring(hy + 0.02, chest.y + 0.1, 0.16, 0.15), tm, 'DEF-spine002'); }
  const hairM = new THREE.MeshStandardMaterial({ color: opts.hairColor || 0x16110d, roughness: 0.9 });
  const hr = 0.115;
  if (opts.hair === 'matted') {
    // matted locks hanging from the crown to the shoulders
    const locks = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, front = Math.cos(a) > 0.55;
      const len = front ? 0.1 : 0.3 + ((i * 37) % 11) / 40;
      const p0 = new THREE.Vector3(Math.sin(a) * hr * 0.75, head.y + hr * 0.85, Math.cos(a) * hr * 0.75);
      const p1 = new THREE.Vector3(Math.sin(a) * hr * 1.15, head.y + hr * 0.2, Math.cos(a) * hr * 1.1 - 0.02);
      const p2 = new THREE.Vector3(Math.sin(a) * hr * 1.25, head.y + hr * 0.2 - len, Math.cos(a) * hr * 1.0 - 0.05);
      const c = new THREE.CatmullRomCurve3([p0, p1, p2]);
      locks.push(new THREE.TubeGeometry(c, 6, 0.017, 5, false));
    }
    locks.push(new THREE.SphereGeometry(hr * 1.06, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, head.y + 0.02, -0.005));
    add(mergeGeometries(locks.map((g) => g.toNonIndexed ? (g.index ? g.toNonIndexed() : g) : g).map((g) => { g.deleteAttribute('uv'); return g; })), hairM, 'DEF-head');
  } else if (opts.hair === 'short') {
    add(new THREE.SphereGeometry(hr * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, head.y + 0.03, -0.008), hairM, 'DEF-head');
  } else if (opts.hair === 'bun') {
    add(new THREE.SphereGeometry(hr * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, head.y + 0.025, -0.008), hairM, 'DEF-head');
    add(new THREE.SphereGeometry(0.05, 10, 8).translate(0, head.y + 0.02, -hr * 1.05), hairM, 'DEF-head');
  }
  if (opts.turban) {
    const tm = new THREE.MeshStandardMaterial({ color: opts.turbanColor || 0xd8d0bc, roughness: 0.95 });
    const tg = new THREE.TorusGeometry(hr * 1.02, 0.04, 8, 20); tg.rotateX(Math.PI / 2); tg.translate(0, head.y + 0.06, 0);
    add(tg, tm, 'DEF-head'); add(new THREE.SphereGeometry(hr * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(0, head.y + 0.05, 0), tm, 'DEF-head');
  }
  return mats;
}

export function buildRiggedHuman(opts = {}) {
  const S = opts.scale || 1;
  const inst = SkeletonUtils.clone(T.scene);
  const unit = (1.72 * S) / (T.box.max.y - T.box.min.y);
  const skin = opts.skin || skinMat(opts.skinColor || 0x5e3d2a, opts.skinKey || 'skin');
  inst.traverse((o) => { if (o.isMesh) { o.material = skin; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  inst.updateMatrixWorld(true);
  dress(inst, opts, S);
  const body = new THREE.Group(); body.add(inst); body.scale.setScalar(unit);
  const root = new THREE.Group(); root.add(body);
  const mixer = new THREE.AnimationMixer(inst);
  const actions = {}; for (const c of T.clips) actions[c.name] = mixer.clipAction(c);
  const bones = {}; inst.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  // grip frames that emulate the old hand joints (fingers along -Y, handle along +Z) so weapons attach as before
  const handR = new THREE.Group(), handL = new THREE.Group(); root.add(handR, handL);
  const j = { handR, handL, head: bones['DEF-head'], hips: bones['DEF-hips'] };
  return { root, j, S, rig: { inst, body, mixer, actions, bones, cur: null, curName: '' }, t: 0, dead: 0, skin, swimS: 0 };
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

export function animateRiggedHuman(h, dt, a) {
  const R = h.rig, Bn = R.bones;
  h.t += dt;
  const spd = a.speed || 0, act = a.action && a.action.type ? a.action : null;
  const low = act && (act.type === 'gather' || act.type === 'drink' || act.type === 'eat');
  let clip = 'Idle_Loop', ts = 1, fade = 0.25;
  if (a.dead) { clip = 'Death01'; fade = 0.15; }
  else if (a.air) { clip = 'Jump_Start'; fade = 0.12; }
  else if (act && act.type === 'punch') { clip = 'Punch_Jab'; fade = 0.08; ts = 1.4; }
  else if (a.crouch || low || (a.kneel || 0) > 0.3) { clip = 'Crouch_Fwd_Loop'; ts = spd > 0.2 ? Math.min(1.6, Math.max(0.5, spd / 1.1)) : 0.0001; }
  else if (spd > 0.2) {
    if (spd < 2.6) { clip = 'Walk_Loop'; ts = Math.min(1.8, Math.max(0.5, spd / 1.45)); }
    else if (spd < 5.4) { clip = 'Jog_Fwd_Loop'; ts = Math.min(1.5, Math.max(0.7, spd / 3.4)); }
    else { clip = 'Sprint_Loop'; ts = Math.min(1.4, Math.max(0.8, spd / 6.2)); }
  }
  play(R, clip, fade, ts);
  R.mixer.update(dt);
  // swimming: lay the body along the water and pull with the arms
  h.swimS += ((a.swim || 0) - h.swimS) * Math.min(1, dt * 4);
  R.body.rotation.x = h.swimS * 1.25; R.body.position.y = -h.swimS * 0.9;
  R.inst.updateMatrixWorld(true);
  // body frame in world space
  const rw = h.root.matrixWorld; _f.set(0, 0, 1).transformDirection(rw); _r.set(-1, 0, 0).transformDirection(rw);
  const uaR = Bn['DEF-upper_armR'], faR = Bn['DEF-forearmR'], hR = Bn['DEF-handR'], uaL = Bn['DEF-upper_armL'], faL = Bn['DEF-forearmL'], hL = Bn['DEF-handL'];
  const w = a.weapon || 'none', lp = a.lookPitch || 0;
  const aimDir = _v4.copy(_f).applyAxisAngle(_r, -lp).normalize();
  if (!a.dead && h.swimS < 0.5) {
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
  h.dead = a.dead ? Math.min(1, (h.dead || 0) + dt * 1.6) : 0;
}

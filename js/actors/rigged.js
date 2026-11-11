// Rigged, skeletally animated wildlife from glTF (Quaternius "Ultimate Animated Animals", CC0), recoated for
// the animals of Pench: chital, sambar, gaur, zebu cattle, pariah dog, Indian wolf and dhole. Clips are
// cross-faded by behaviour state and stepped to the animal's real ground speed so the feet don't skate.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { patch, NOISE_GLSL } from '../core/shaderlib.js';
import { PAINTED } from '../core/palette.js';
import { toon, toonify } from '../core/toon.js';

// height = full height of the model in metres (top of head / antlers); walk/run = ground speed of the clip at that size
export const RIG = {
  chital: { file: 'deer', maleFile: 'stag', height: 1.3, maleHeight: 1.8, coat: 1, walk: 1.25, run: 8.5 },
  sambar: { file: 'stag', height: 2.35, coat: 2, walk: 1.5, run: 9.5 },
  gaur: { file: 'bull', height: 2.05, coat: 3, walk: 1.35, run: 7.5 },
  cow: { file: 'cow', height: 1.45, coat: 4, walk: 1.0, run: 6.0 },
  dog: { file: 'shibainu', height: 0.68, coat: 5, walk: 1.2, run: 7.5 },
  wolf: { file: 'wolf', height: 0.98, coat: 6, walk: 1.4, run: 9.0 },
  dhole: { file: 'wolf', height: 0.78, coat: 7, walk: 1.3, run: 8.5 },
};
// material roles by source name; anything unlisted keeps its own colour
const ROLE = { Main: 0, Material: 0, Main_Light: 1, 'Material.003': 1, Main_Dark: 2, Horns: 3, 'Material.010': 3 };

const templates = {};
export const rigReady = { value: false };

export async function loadRigs(base = 'assets/models/') {
  const loader = new GLTFLoader();
  const files = new Set(); for (const k in RIG) { files.add(RIG[k].file); if (RIG[k].maleFile) files.add(RIG[k].maleFile); }
  await Promise.all([...files].map((f) => new Promise((res) => {
    loader.load(base + f + '.glb', (g) => {
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene);
      templates[f] = { scene: g.scene, clips: g.animations, box };
      res();
    }, undefined, (e) => { console.warn('rig load failed', f, e); res(); });
  })));
  rigReady.value = Object.keys(templates).length > 0;
}
export function hasRig(sp) { const r = RIG[sp]; return !!(r && templates[r.file]); }

const coatCache = {};
function coatFor(srcMat, coat, role, box) {
  const bk = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) => v.toFixed(2)).join(',');
  const key = srcMat.name + '|' + coat + '|' + role + '|' + bk;
  if (coatCache[key]) return coatCache[key];
  // the painted look keeps each coat's colours and markings but drops the fur noise, on the toon material
  const m = PAINTED ? toon({ color: srcMat.color.clone(), rim: 0.6, key: 'rigcoat' }) : new THREE.MeshStandardMaterial({ color: srcMat.color.clone(), roughness: role === 3 ? 0.55 : 0.9, metalness: 0 });
  if (role < 0) { coatCache[key] = m; return m; }
  const mn = box.min, sz = box.getSize(new THREE.Vector3());
  const prev = m.onBeforeCompile;
  patch(m, 'rigcoat-' + (PAINTED ? 'p-' : '') + coat + '-' + role + '-' + bk, (s, r) => {
    if (PAINTED) prev(s, r);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBind = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      ${NOISE_GLSL}
      varying vec3 vBind; uniform float uWetness;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 n = (vBind - vec3(${mn.x.toFixed(4)}, ${mn.y.toFixed(4)}, ${mn.z.toFixed(4)})) / vec3(${sz.x.toFixed(4)}, ${sz.y.toFixed(4)}, ${sz.z.toFixed(4)});
        vec3 q = vBind / ${Math.max(sz.x, sz.y, sz.z).toFixed(4)};
        float fur = fbm3(q * 70.0), lowN = fbm3(q * 6.0);
        int K = ${coat}, R = ${role};
        vec3 c = diffuseColor.rgb;
        if (K == 1) {            // chital: rufous with rows of white spots, white belly and throat, dark dorsal line
          c = mix(vec3(0.6, 0.29, 0.1), vec3(0.7, 0.36, 0.13), lowN);
          vec2 cl = cell3(q * vec3(16.0, 22.0, 16.0));
          float spots = (1.0 - smoothstep(0.13, 0.2, cl.x)) * smoothstep(0.42, 0.55, n.y) * (1.0 - smoothstep(0.86, 0.92, n.z));
          c = mix(c, vec3(0.93, 0.9, 0.84), spots * 0.9);
          c = mix(c, vec3(0.22, 0.1, 0.04), smoothstep(0.035, 0.0, abs(n.x - 0.5)) * smoothstep(0.6, 0.7, n.y) * 0.8);
          if (R == 1) c = vec3(0.92, 0.9, 0.85);
          if (R == 2) c = vec3(0.26, 0.13, 0.05);
          if (R == 3) c = vec3(0.42, 0.34, 0.24);
        } else if (K == 2) {     // sambar: coarse dark grey-brown, paler underparts, dark mane
          c = mix(vec3(0.24, 0.19, 0.14), vec3(0.32, 0.26, 0.19), lowN);
          if (R == 1) c = vec3(0.46, 0.38, 0.28);
          if (R == 2) c = vec3(0.13, 0.1, 0.07);
          if (R == 3) c = vec3(0.4, 0.33, 0.24);
        } else if (K == 3) {     // gaur: near-black coat, white "stockings", ash-grey forehead, pale horns with dark tips
          c = mix(vec3(0.075, 0.05, 0.035), vec3(0.14, 0.09, 0.06), lowN);
          c = mix(c, vec3(0.86, 0.8, 0.62), smoothstep(0.24, 0.17, n.y));
          if (R == 1) c = vec3(0.5, 0.46, 0.38);
          if (R == 3) c = mix(vec3(0.78, 0.74, 0.58), vec3(0.08, 0.07, 0.06), smoothstep(0.86, 0.95, n.y));
        } else if (K == 4) {     // zebu: white-grey, darker hump and neck
          c = mix(vec3(0.78, 0.76, 0.72), vec3(0.6, 0.58, 0.56), smoothstep(0.6, 0.85, lowN));
          if (R == 1) c = vec3(0.88, 0.86, 0.82);
          if (R == 3) c = vec3(0.22, 0.2, 0.18);
        } else if (K == 5) {     // village pariah dog: tan, pale belly
          c = mix(vec3(0.58, 0.4, 0.22), vec3(0.72, 0.54, 0.32), lowN);
          if (R == 1) c = vec3(0.86, 0.8, 0.66);
        } else if (K == 6) {     // Indian wolf: grizzled fawn-grey, darker saddle
          c = mix(vec3(0.5, 0.43, 0.34), vec3(0.62, 0.54, 0.42), lowN);
          c = mix(c, vec3(0.3, 0.27, 0.23), smoothstep(0.62, 0.8, n.y) * 0.6);
          if (R == 1) c = vec3(0.84, 0.8, 0.7);
        } else if (K == 7) {     // dhole: rust-red, cream underparts, black bushy tail tip
          c = mix(vec3(0.58, 0.23, 0.07), vec3(0.7, 0.32, 0.11), lowN);
          c = mix(c, vec3(0.06, 0.04, 0.03), smoothstep(0.12, 0.04, n.z) * smoothstep(0.3, 0.45, n.y));
          if (R == 1) c = vec3(0.86, 0.72, 0.5);
        }
        ${PAINTED ? '' : 'c *= 0.84 + 0.32 * fur;'}
        c = pow(max(c, vec3(0.0)), vec3(2.2));
        diffuseColor.rgb = c * mix(1.0, 0.7, uWetness);
      }`);
  });
  coatCache[key] = m; return m;
}

// Build an animated instance. Returns { root, inst, mixer, actions, J, meshes, height }
export function makeRigged(sp, male) {
  const cfg = RIG[sp]; const file = male && cfg.maleFile ? cfg.maleFile : cfg.file;
  const T = templates[file]; if (!T) return null;
  const inst = SkeletonUtils.clone(T.scene);
  const H = male && cfg.maleHeight ? cfg.maleHeight : cfg.height;
  const unit = H / Math.max(0.01, T.box.max.y - T.box.min.y);
  inst.scale.setScalar(unit); inst.position.y = -T.box.min.y * unit;
  const meshes = [];
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const horn = /Horn/i.test(o.name) || /Horn/i.test(o.parent?.name || '');
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((mm) => coatFor(mm, cfg.coat, horn ? 3 : (ROLE[mm.name] ?? -1), o.geometry.boundingBox));
    o.material = Array.isArray(o.material) ? out : out[0];
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    meshes.push(o);
  });
  const root = new THREE.Group(); root.add(inst);
  if (PAINTED) toonify(root, { outline: 0.015 });
  const mixer = new THREE.AnimationMixer(inst);
  const actions = {};
  for (const c of T.clips) actions[c.name] = mixer.clipAction(c);
  const J = {}; inst.traverse((o) => { if (o.isBone || o.name) J[o.name] = J[o.name] || o; });
  J.body = J.Torso || J.Body; J.head = J.Head; J.neck = J.Neck1; J.earL = J.Ear1L; J.earR = J.Ear1R;
  return { root, inst, mixer, actions, J, meshes, height: H, unit, cfg, cur: null, curName: '' };
}

const ONCE = new Set(['Death', 'Attack_Headbutt', 'Attack_Kick', 'Attack', 'Idle_HitReact1', 'Idle_HitReact2', 'Jump_toIdle', 'Jump_ToIdle', 'Gallop_Jump']);
export function playClip(rig, name, fade = 0.25, timeScale = 1, atEnd = false) {
  const a = rig.actions[name] || rig.actions.Idle; if (!a) return;
  a.timeScale = timeScale;
  if (rig.curName === name) return;
  if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
  a.reset().setEffectiveWeight(1).play();
  if (atEnd) a.time = a.getClip().duration;   // straight to its last pose (lying down to rest, not falling)
  if (rig.cur) rig.cur.crossFadeTo(a, fade, false);
  rig.cur = a; rig.curName = name;
}

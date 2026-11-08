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
  if (opts.cloth === 'loin') {
    // a langot: a twisted fibre cord round the waist, a strip of old cloth passed between the legs and tucked
    // under the cord front and back, its frayed ends hanging over the front and behind, and a small hide bag
    const cy = hy + 0.035, W = section(cy);
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
    const strip = new THREE.CatmullRomCurve3([[0, cy - 0.01, W.rz + 0.012], [0, crotch + 0.05, W.rz * 0.8], [0, crotch - 0.012, 0.0], [0, crotch + 0.05, -W.rz * 0.85], [0, cy - 0.01, -W.rz - 0.012]].map(([x, y, z]) => new THREE.Vector3(W.cx + x, y, W.cz + z)));
    { const pos = [], uv = [], idx = [], P = new THREE.Vector3(), N = 16;
      for (let i = 0; i <= N; i++) { const t = i / N; strip.getPointAt(t, P); const w = 0.024 + 0.026 * Math.abs(Math.cos(t * Math.PI)); pos.push(P.x - w, P.y, P.z, P.x + w, P.y, P.z); uv.push(0.2, 1 - t * 0.7, 0.8, 1 - t * 0.7); }
      for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      add(g, bc, 'DEF-hips'); }
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
    add(flap(W.rx * 1.15, 0.22, 1, 1.3), bc, 'DEF-hips');
    add(flap(W.rx * 1.3, 0.17, -1, 4.1), bc, 'DEF-hips');
    // a small hide bag hanging flat against the hip from the cord: flint, a fire-stick, whatever he keeps
    const pouchM = new THREE.MeshStandardMaterial({ color: 0x4e3626, roughness: 0.9 });
    const pouch = new THREE.SphereGeometry(0.05, 12, 10); pouch.scale(0.32, 1.1, 0.85);
    { const p = pouch.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.025) { const k = Math.max(0.25, 1 - (y - 0.025) * 18); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } else p.setZ(i, p.getZ(i) * (1 + Math.max(0, -y) * 2)); } pouch.computeVertexNormals(); }   // gathered neck, sagging base
    pouch.translate(W.cx + W.rx + 0.014, cy - 0.07, W.cz - W.rz * 0.15); add(pouch, pouchM, 'DEF-hips');
    add(new THREE.TorusGeometry(0.011, 0.003, 4, 10).rotateX(Math.PI / 2).translate(W.cx + W.rx + 0.014, cy - 0.024, W.cz - W.rz * 0.15), cordM, 'DEF-hips');   // drawstring
  } else if (opts.cloth === 'dhoti') {
    const cm = cloth(opts.clothTex, 0xffffff);
    add(ring(kneeL.y - 0.05, hy + 0.06, 0.24, 0.17), cm, 'DEF-hips');
  } else if (opts.cloth === 'sari') {
    const cm = cloth(opts.clothTex, 0xffffff);
    add(ring(footL.y + 0.06, hy + 0.08, 0.27, 0.17, 22), cm, 'DEF-hips');
    add(ring(chest.y - 0.2, chest.y + 0.08, 0.15, 0.135), cm, 'DEF-spine003');
    const pallu = new THREE.PlaneGeometry(0.22, 0.75); pallu.rotateZ(0.5); pallu.translate(0.05, chest.y - 0.12, 0.13 * G); add(pallu, cm, 'DEF-spine003');
  }
  if (opts.topTex) { const tm = cloth(opts.topTex, 0xffffff); add(ring(hy + 0.02, chest.y + 0.1, 0.16, 0.15), tm, 'DEF-spine002'); }
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
  if (opts.hair === 'matted') {
    add(mattedHair(skull, cranium ? cranium.r : hr), hairMat(opts.hairColor || 0x16110d), 'DEF-head');
  } else if (opts.hair === 'short') {
    add(new THREE.SphereGeometry(hr * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(skull.x, skull.y + 0.012, skull.z - 0.008), hairM, 'DEF-head');
  } else if (opts.hair === 'bun') {
    add(new THREE.SphereGeometry(hr * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(skull.x, skull.y + 0.01, skull.z - 0.008), hairM, 'DEF-head');
    add(new THREE.SphereGeometry(0.05, 10, 8).translate(skull.x, skull.y, skull.z - hr * 1.05), hairM, 'DEF-head');
  }
  if (opts.turban) {
    const tm = new THREE.MeshStandardMaterial({ color: opts.turbanColor || 0xd8d0bc, roughness: 0.95 });
    const tg = new THREE.TorusGeometry(hr * 1.02, 0.04, 8, 20); tg.rotateX(Math.PI / 2); tg.translate(skull.x, skull.y + 0.03, skull.z);
    add(tg, tm, 'DEF-head'); add(new THREE.SphereGeometry(hr * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(skull.x, skull.y + 0.025, skull.z), tm, 'DEF-head');
  }
  return mats;
}

export function buildRiggedHuman(opts = {}) {
  const S = opts.scale || 1;
  const inst = SkeletonUtils.clone(T.scene);
  let face = null, eyes = null;
  if (opts.sculpt) {
    // swap the mannequin's jointed plates for one continuous body generated around the same skeleton
    const mans = []; inst.traverse((o) => { if (o.isSkinnedMesh) mans.push(o); });
    const sc = sculptBody(mans[0].skeleton, opts.detail || 1);
    const body = new THREE.SkinnedMesh(sc.geometry); body.name = 'Body';
    mans[0].parent.add(body); body.bind(mans[0].skeleton, mans[0].bindMatrix);
    for (const m of mans) m.parent.remove(m);
    face = sc.face; eyes = sc.eyes;
  } else if (BUILDS[opts.build]) reshape(inst, BUILDS[opts.build]);
  inst.traverse((o) => { if (o.isSkinnedMesh) regions(o); });
  const unit = (1.72 * S) / (T.box.max.y - T.box.min.y);
  const skin = opts.skin || skinMat(opts.skinColor || 0x5e3d2a, opts.skinKey || 'skin', { dirt: opts.dirt, scars: opts.scars, face });
  inst.traverse((o) => { if (o.isMesh) { o.material = skin; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  inst.updateMatrixWorld(true);
  dress(inst, opts, S, face ? { c: face.clone().add(new THREE.Vector3(0, 0.02, -0.012)), r: new THREE.Vector3(0.078, 0.1, 0.1) } : null);
  if (eyes) for (const e of eyes) {
    const em = eyeMesh(e, patch, NOISE_GLSL), m = new THREE.Mesh(em.geometry, em.material);
    m.position.copy(e.c); m.rotation.y = Math.sign(e.c.x) * 0.06; inst.add(m); inst.getObjectByName('DEF-head').attach(m);
  }
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
  else if (a.canopy && a.canopy.mode === 'trunk') { clip = 'Crouch_Fwd_Loop'; ts = 0.0001; fade = 0.15; }
  else if (a.canopy && a.canopy.mode === 'hang') { clip = 'Idle_Loop'; fade = 0.12; }
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
  // in the trees (no clips exist for this, so it is posed): hands on the hold, legs hanging and trailing the
  // swing; on a trunk, hand over hand with the knees braced; in a leap, arms reaching up and ahead for the next hold
  const C = a.canopy;
  if (C && !a.dead && C.mode !== 'limb') {
    const thL = Bn['DEF-thighL'], shL = Bn['DEF-shinL'], ftL = Bn['DEF-footL'], thR = Bn['DEF-thighR'], shR = Bn['DEF-shinR'], ftR = Bn['DEF-footR'];
    const reach = (ua, fa, hb, target) => { ua.getWorldPosition(_v1); aim(ua, fa, _v2.subVectors(target, _v1).normalize(), 1); fa.getWorldPosition(_v1); aim(fa, hb, _v2.subVectors(target, _v1).normalize(), 1); };
    if (C.mode === 'hang' || C.mode === 'trunk') { reach(uaR, faR, hR, C.gripR); reach(uaL, faL, hL, C.gripL); }
    if (C.mode === 'hang') {
      const down = _v3.copy(C.up).negate().addScaledVector(C.vel, -0.05).normalize(), kick = Math.sin(h.t * 3) * 0.12;
      aim(thL, shL, _v4.copy(down).addScaledVector(_r, -0.12).addScaledVector(_f, kick).normalize(), 1); aim(shL, ftL, _v4.copy(down).addScaledVector(_f, -0.15).normalize(), 1);
      aim(thR, shR, _v4.copy(down).addScaledVector(_r, 0.12).addScaledVector(_f, -kick).normalize(), 1); aim(shR, ftR, _v4.copy(down).addScaledVector(_f, -0.15).normalize(), 1);
    } else if (C.mode === 'trunk') {
      const inn = _v3.copy(C.out).negate(), ph = C.phase * Math.PI;
      for (const [th, sh, ft, s, o] of [[thL, shL, ftL, -1, 0], [thR, shR, ftR, 1, Math.PI]]) {
        const lift = 0.35 + 0.3 * Math.sin(ph + o);
        aim(th, sh, _v4.copy(inn).multiplyScalar(0.8).add(_v1.set(0, lift - 0.4, 0)).addScaledVector(_r, s * 0.25).normalize(), 1);
        aim(sh, ft, _v4.set(0, -1, 0).addScaledVector(inn, 0.25).normalize(), 1);
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
}

// Tracks: animals leave prints as they move: tiger and leopard pugmarks, dog prints (dhole, wolf, dog),
// split hoof slots (deer, gaur, boar) and bear prints. Prints fade over a few game hours and rain washes them out.
// Crouch over fresh prints to read them: who made them, how big, how old, which way they went.
import * as THREE from 'three';
import { PAINTED } from '../core/palette.js';
import { RAMP } from '../core/toon.js';
import { groundHeight, groundNormal, waterAt } from './terrain.js';

const KIND = { tiger: 0, leopard: 0, dhole: 1, wolf: 1, dog: 1, jackal: 1, chital: 2, sambar: 2, gaur: 2, boar: 2, cow: 2, nilgai: 2, barking: 2, bear: 3 };
const NAMES = { tiger: 'Tiger', leopard: 'Leopard', dhole: 'Dhole', wolf: 'Wolf', dog: 'Dog', jackal: 'Jackal', chital: 'Chital', sambar: 'Sambar', gaur: 'Gaur', boar: 'Wild boar', cow: 'Cattle', nilgai: 'Nilgai', barking: 'Barking deer', bear: 'Sloth bear' };
// print width in metres for an adult
const WIDTH = { tiger: 0.15, leopard: 0.09, dhole: 0.065, wolf: 0.085, dog: 0.06, jackal: 0.05, chital: 0.055, sambar: 0.09, gaur: 0.13, boar: 0.06, cow: 0.1, nilgai: 0.08, barking: 0.035, bear: 0.12 };

// Depth atlas: white = deepest part of the print, black = untouched ground. Drawn opaque so the blur leaves a
// smooth slope from rim to pad floor, which the material reads both as the print's outline and as a bump map.
function atlas() {
  const S = 128, c = document.createElement('canvas'); c.width = S * 4; c.height = S;
  const x = c.getContext('2d');
  const blob = (cx, cy, rx, ry, rot = 0, a = 1) => { x.save(); x.translate(cx, cy); x.rotate(rot); x.globalAlpha = a; x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, 6.283); x.fill(); x.restore(); };
  x.fillStyle = '#000'; x.fillRect(0, 0, S * 4, S);
  x.fillStyle = '#fff'; x.filter = 'blur(3px)';
  // 0: cat pugmark: trilobed heel pad, four round toes, no claws
  { const o = 0; blob(o + 64, 84, 30, 24); blob(o + 46, 98, 13, 10, 0.3); blob(o + 82, 98, 13, 10, -0.3);
    blob(o + 30, 50, 11, 14, -0.35); blob(o + 52, 34, 11, 14, -0.1); blob(o + 77, 34, 11, 14, 0.1); blob(o + 99, 50, 11, 14, 0.35); }
  // 1: dog print: smaller heel, two front toes ahead of the side toes, claw marks
  { const o = 128; blob(o + 64, 88, 20, 17); blob(o + 54, 42, 10, 13); blob(o + 74, 42, 10, 13); blob(o + 34, 62, 9, 12, -0.4); blob(o + 94, 62, 9, 12, 0.4);
    for (const [cx, cy] of [[54, 22], [74, 22], [30, 44], [98, 44]]) blob(o + cx, cy, 3, 5); }
  // 2: cloven hoof: two heart-halves
  { const o = 256; blob(o + 48, 62, 16, 42, 0.12); blob(o + 80, 62, 16, 42, -0.12); x.fillStyle = '#000'; blob(o + 64, 104, 10, 14); x.fillStyle = '#fff'; }
  // 3: bear: wide pad, five toes in an arc, long claw marks
  { const o = 384; blob(o + 64, 82, 38, 22); for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; blob(o + 64 + Math.sin(a) * 40, 58 - Math.cos(a) * 26, 8, 10, a); blob(o + 64 + Math.sin(a) * 48, 40 - Math.cos(a) * 34, 3, 8, a); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; return t;
}

export class Tracks {
  constructor(scene, game) {
    this.g = game; this.max = 900;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const uvs = new Float32Array(this.max * 1); this.cell = uvs;
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(uvs, 1));
    // an impression, not a stain: compressed soil a little darker on the pad floor, a faint pushed-up rim,
    // and a bump map from the same depth atlas so low sun shades one wall of the print and lights the other
    const tex = atlas();
    const prm = { color: 0x5e4a36, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaMap: tex, bumpMap: tex, bumpScale: -6 };
    const mat = PAINTED ? new THREE.MeshToonMaterial({ ...prm, gradientMap: RAMP }) : new THREE.MeshStandardMaterial({ ...prm, roughness: 1 });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvec2 cellUv = vec2((uv.x + aCell) * 0.25, uv.y);\nvAlphaMapUv = cellUv; vBumpMapUv = cellUv;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <color_fragment>', '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n diffuseColor.a *= vColor.r;\n#endif')
        .replace('#include <alphamap_fragment>', `
          float dep = texture2D(alphaMap, vAlphaMapUv).g;
          float rim = smoothstep(0.02, 0.12, dep) * (1.0 - smoothstep(0.12, 0.35, dep));
          diffuseColor.rgb *= mix(1.0, 0.74, smoothstep(0.2, 0.8, dep)) + rim * 0.12;
          diffuseColor.a *= smoothstep(0.02, 0.25, dep) * 0.8;`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.count = 0; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.prints = []; this.next = 0; this.last = new Map(); this.ground = groundHeight;
    this.readT = 0; this.readCD = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); this._n = new THREE.Vector3(); this._q2 = new THREE.Quaternion();
  }
  clock() { const t = this.g.time; return t.day * 24 + t.hour; }
  drop(an, side) {
    const sp = an.sp, k = KIND[sp]; if (k === undefined) return;
    const yaw = an.yaw !== undefined ? an.yaw : 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), off = (side ? 1 : -1) * (an.d.W || 0.15) * 0.8;
    const x = an.pos.x + fz * off, z = an.pos.z - fx * off, y = groundHeight(x, z);
    if (waterAt(x, z) > y - 0.02) return;
    const w = WIDTH[sp] * (an.scale || 1) * (an.male ? 1.08 : 0.94);
    const p = { x, y, z, yaw, w, sp, k, t: this.clock(), male: !!an.male };
    if (this.prints.length < this.max) this.prints.push(p); else { this.prints[this.next] = p; this.next = (this.next + 1) % this.max; }
    if (this.g.cover) this.g.cover.press(x, z, w * 0.75, p.t);
  }
  update(dt) {
    const g = this.g, P = g.player.pos, now = this.clock();
    for (const an of g.eco.animals) {
      if (an.dead || KIND[an.sp] === undefined || an.flying || an.inTree) continue;
      if (an.dist2(P) > 120 * 120) continue;
      let L = this.last.get(an);
      if (!L) { L = { x: an.pos.x, z: an.pos.z, side: 0 }; this.last.set(an, L); continue; }
      const stride = Math.max(0.35, (an.d.L || 1) * 0.55 * (an.scale || 1));
      if (Math.hypot(an.pos.x - L.x, an.pos.z - L.z) > stride) { L.x = an.pos.x; L.z = an.pos.z; L.side ^= 1; this.drop(an, L.side); }
    }
    // rain wipes prints much faster; prints last ~10 game hours in the dry
    const wet = g.weather && g.weather.env ? (g.weather.env.rain || 0) : 0;
    const life = wet > 0.2 ? 2 : 10;
    const mats = this.mesh.instanceMatrix.array, col = this.mesh.instanceColor.array;
    let n = 0;
    for (const p of this.prints) {
      const age = now - p.t; if (age > life || age < -1) continue;
      const dx = p.x - P.x, dz = p.z - P.z; if (dx * dx + dz * dz > 60 * 60) continue;
      if (!p.q) { groundNormal(p.x, p.z, this._n); p.q = new THREE.Quaternion().setFromUnitVectors(this._up, this._n).multiply(this._q2.setFromAxisAngle(this._up, p.yaw)); } this._q.copy(p.q);
      this._m.compose(this._v.set(p.x, p.y + 0.035, p.z), this._q, this._s.set(p.w, 1, p.k === 2 ? p.w * 1.25 : p.w * 1.05));
      this._m.toArray(mats, n * 16);
      const a = 0.9 * (1 - age / life); col[n * 3] = a; col[n * 3 + 1] = a; col[n * 3 + 2] = a;   // sharp when fresh, crumbling away with age
      this.cell[n] = p.k; n++;
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; this.mesh.geometry.attributes.aCell.needsUpdate = true;
    // reading: crouch still over fresh tracks
    this.readCD -= dt;
    const pl = g.player;
    if (pl.crouch && pl.speed < 0.6) {
      this.readT += dt;
      if (this.readT > 1.4 && this.readCD <= 0) { this.readT = 0; const s = this.read(P, now); if (s) { g.ui.toast(s, 7); this.readCD = 12; } }
    } else this.readT = 0;
  }
  read(P, now) {
    let best = null, bd = 3.5 * 3.5;
    for (const p of this.prints) { const d = (p.x - P.x) ** 2 + (p.z - P.z) ** 2; if (d < bd && now - p.t < 10) { bd = d; best = p; } }
    if (!best) return null;
    const trail = this.prints.filter((q) => q.sp === best.sp && Math.abs(q.t - best.t) < 0.25 && (q.x - best.x) ** 2 + (q.z - best.z) ** 2 < 25 * 25).sort((a, b) => a.t - b.t);
    const age = (now - best.t) * 60;
    const ageTxt = age < 15 ? 'very fresh, the edges still sharp' : age < 90 ? 'fresh, less than two hours' : age < 300 ? 'a few hours old' : 'old, crumbling at the edges';
    let dirTxt = '';
    if (trail.length > 2) {
      const a = trail[0], b = trail[trail.length - 1], ang = Math.atan2(b.x - a.x, -(b.z - a.z));
      dirTxt = ', heading ' + ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
    }
    let who = NAMES[best.sp];
    if (best.sp === 'tiger') who = best.w > 0.155 ? 'Tiger. A big square pad, a male' : 'Tiger. A narrower pad, a tigress';
    else if (best.sp === 'leopard') who = 'Leopard. A small round pugmark';
    else if (best.k === 1 && trail.length > 2) { const others = this.prints.filter((q) => q.sp === best.sp && Math.abs(q.t - best.t) < 0.1 && (q.x - best.x) ** 2 + (q.z - best.z) ** 2 < 20 * 20).length; if (best.sp === 'dhole' && others > 10) who = 'Dhole. Many of them, running together'; }
    return `${who}: ${ageTxt}${dirTxt}.`;
  }
}

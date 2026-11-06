// Real things lying on the ground near you, not painted on it: thousands of individual curled leaf meshes in
// drifts (teak leaves 30–50 cm across, as on the Pench floor in the dry months), sticks and forked twigs,
// gravel and stones (red laterite on the ridges, grey gneiss elsewhere), and rounded cobbles on stream and
// pond beds, under the water. Everything is deterministic per 4 m cell, so it is the same when you come back.
import * as THREE from 'three';
import { G, patch, NOISE_GLSL } from '../core/shaderlib.js';
import { height, biomeAt, waterAt } from './terrain.js';
import { Simplex } from '../core/noise.js';

const CELL = 4;
const LEAF_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];         // atlas cells that are leaves
const LEAF_SIZE = [0.42, 0.4, 0.3, 0.4, 0.26, 0.17, 0.2, 0.18, 0.3, 0.2];  // metres, longest side
const SEASON_LEAF = { winter: 1.0, summer: 1.35, monsoon: 0.3, post: 0.55 };

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function leafGeometry() {
  // a 5x4 grid in XZ (length along Z); curl and cup are applied per instance in the shader
  const g = new THREE.PlaneGeometry(1, 1, 4, 5); g.rotateX(-Math.PI / 2);
  return g;
}
function twigGeometry() {
  // a tapered, slightly bent stick with one side branch
  const parts = [];
  const seg = (x0, z0, x1, z1, r0, r1, bend) => {
    const c = new THREE.CylinderGeometry(r1, r0, 1, 5, 4, true);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.5; p.setX(i, p.getX(i) + Math.sin(y * Math.PI) * bend); }
    c.rotateZ(-Math.PI / 2); // along X
    const L = Math.hypot(x1 - x0, z1 - z0); c.scale(L, 1, 1); c.translate(L / 2, 0, 0);
    c.rotateY(-Math.atan2(z1 - z0, x1 - x0)); c.translate(x0, 0, z0);
    parts.push(c);
  };
  seg(-0.5, 0, 0.5, 0, 0.022, 0.009, 0.02);
  seg(0.05, 0, 0.32, 0.17, 0.011, 0.004, 0.01);
  seg(-0.2, 0, -0.38, -0.1, 0.009, 0.004, 0.0);
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = []; let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3);
    const ii = p.index.array; for (let i = 0; i < ii.length; i++) idx.push(ii[i] + o); o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  g.translate(0, 0.012, 0); return g;
}
function stoneGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, S = new Simplex(seed), n2 = (a, b) => S.noise2(a, b);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.18 * n2(x * 1.7 + y, z * 1.7 - y) + 0.08 * n2(x * 4 + 3, z * 4 - y * 3);
    // flat-bottomed, a little faceted like weathered gneiss
    p.setXYZ(i, x * d, Math.max(-0.35, y * d * 0.62), z * d * 0.85);
  }
  g.computeVertexNormals(); return g;
}

export class GroundCover {
  constructor(scene, T, quality) {
    this.scene = scene; this.q = quality; this.T = T;
    const lv = quality.grassR > 60 ? 1.5 : quality.grassR > 45 ? 1.1 : quality.grassR > 30 ? 0.8 : 0.45;
    this.R = 12 + lv * 12;                      // radius of 3D litter
    this.dens = lv;
    this.leafMul = 1;
    this.cells = new Map(); this.last = new THREE.Vector3(1e9, 0, 1e9);
    const capL = Math.floor(9000 + lv * 16000), capT = Math.floor(600 + lv * 1400), capS = Math.floor(900 + lv * 2200);
    this.uR = { value: this.R };

    // --- leaves
    const lg = leafGeometry();
    this.leafAttr = new THREE.InstancedBufferAttribute(new Float32Array(capL * 4), 4); // cell, curl, lift, tint
    lg.setAttribute('aLeaf', this.leafAttr);
    const lm = new THREE.MeshStandardMaterial({ map: T.groundAtlas, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.88 });
    patch(lm, 'gc-leaf', (s) => {
      s.uniforms.uGCR = this.uR;
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 aLeaf; uniform float uGCR; varying float vTint; varying float vUnder;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        { float c = aLeaf.x; vec2 cell = vec2(mod(c, 4.0), floor(c / 4.0));
          vMapUv = vec2((cell.x + uv.x) * 0.25, 1.0 - (cell.y + 1.0 - uv.y) * 0.25); }`)
        .replace('#include <beginnormal_vertex>', `
          // curl across the midrib (cup) and lift at the tip and stalk: dry teak leaves dry into boats
          float cx = position.x, cz = position.z;
          float cup = aLeaf.y, lift = aLeaf.z;
          vec3 objectNormal = normalize(vec3(-cup * 8.0 * cx, 1.0, -lift * 8.0 * cz));
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          transformed.y += cup * 4.0 * cx * cx + lift * 4.0 * cz * cz + 0.006;
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float fd = distance(ip.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(uGCR * 0.7, uGCR, fd);
          transformed *= fade;
          vTint = aLeaf.w; vUnder = 0.0;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uDry; uniform float uWetness; varying float vTint; varying float vUnder;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          // per-leaf tint: some bleached, some dark and rotting; wet season darkens everything
          vec3 tint = mix(vec3(0.78, 0.72, 0.66), vec3(1.12, 1.04, 0.92), vTint);
          diffuseColor.rgb *= tint * mix(1.0, 0.62, uWetness);
          if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;   // underside of a curled leaf is in its own shade`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.9, 0.45, uWetness);`);
    });
    this.leaves = new THREE.InstancedMesh(lg, lm, capL);

    // --- twigs
    const tm = new THREE.MeshStandardMaterial({ color: 0x8a7258, map: T.scan && T.scan.oak ? T.scan.oak.map : null, roughness: 0.95 });
    this.twigs = new THREE.InstancedMesh(twigGeometry(), tm, capT);

    // --- stones: three shapes share one material; colour per instance (laterite, gneiss, basalt, algae-wet)
    const sm = new THREE.MeshStandardMaterial({ map: T.rock, roughness: 0.82 });
    patch(sm, 'gc-stone', (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n varying vec3 vSP; varying vec3 vSN;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n vSP = position; vSN = normal;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n varying vec3 vSP; varying vec3 vSN;\n uniform float uWetness;`)
        .replace('#include <map_fragment>', `
          // triplanar on the stone's own shape, so every stone shows grain and pits
          vec3 bw = abs(normalize(vSN)); bw = pow(bw, vec3(4.0)); bw /= dot(bw, vec3(1.0));
          vec3 st = texture2D(map, vSP.yz * 0.6).rgb * bw.x + texture2D(map, vSP.xz * 0.6).rgb * bw.y + texture2D(map, vSP.xy * 0.6).rgb * bw.z;
          diffuseColor.rgb *= st * 1.5;
          diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(-0.3, 0.2, vSP.y));   // dirt line where it sits in the soil`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.82, 0.3, uWetness);`);
    });
    this.stoneGeos = [stoneGeometry(3), stoneGeometry(11), stoneGeometry(29)];
    this.stones = this.stoneGeos.map((g) => { const m = new THREE.InstancedMesh(g, sm, Math.ceil(capS / 3)); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3), 3); return m; });

    for (const m of [this.leaves, this.twigs, ...this.stones]) {
      m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m);
    }
    for (const m of this.stones) m.castShadow = true;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  setSeason(s) { this.leafMul = SEASON_LEAF[s] ?? 1; this.cells.clear(); this.last.set(1e9, 0, 1e9); }
  genCell(cx, cz) {
    const rng = mulberry32((cx * 2654435761) ^ (cz * 40503) ^ 0x9e37);
    const x0 = cx * CELL, z0 = cz * CELL;
    const b = biomeAt(x0 + 2, z0 + 2);
    const leaves = [], twigs = [], stones = [];
    // drifts: leaves pile in hollows and against obstacles; a slow noise sets where the drifts are
    const drift = 0.5 + 0.5 * Math.sin(x0 * 0.21 + Math.sin(z0 * 0.13) * 2.0) * Math.cos(z0 * 0.17 - x0 * 0.05);
    const leafD = (0.35 + b.teak * 1.0 + b.bamboo * 0.5 + b.mixed * 0.2) * (1 - b.grass * 0.75) * (1 - b.rock * 0.6) * (1 - b.sand * 0.8) * (1 - b.village * 0.9) * (1 - b.field);
    const nLeaf = Math.floor(leafD * (0.5 + drift) * 70 * this.dens * this.leafMul + rng());
    const laterite = b.rock * 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(x0 * 0.011 + 1.3) * Math.sin(z0 * 0.009 - 0.4));
    for (let i = 0; i < nLeaf; i++) {
      // clustered: half the leaves fall near a few drift centres in the cell
      let x, z;
      if (i % 2 && i > 3) { const j = ((i * 7) % Math.max(1, leaves.length / 8 | 0)) * 8; x = leaves[j] + (rng() - 0.5) * 0.9; z = leaves[j + 2] + (rng() - 0.5) * 0.9; }
      else { x = x0 + rng() * CELL; z = z0 + rng() * CELL; }
      const y = height(x, z);
      if (waterAt(x, z) > y - 0.03) continue;
      // species mix: mostly teak where teak dominates, small leaves in mixed forest, bamboo straw in brakes
      const r = rng();
      let cell;
      if (b.bamboo > 0.5 && r < 0.6) cell = 9;
      else if (r < b.teak * 0.75) cell = (rng() * 4) | 0;
      else cell = 4 + ((rng() * 5) | 0);
      const size = LEAF_SIZE[cell] * (0.75 + rng() * 0.5);
      const cup = (0.03 + rng() * 0.09) * (this.leafMul > 1 ? 1.4 : this.leafMul < 0.5 ? 0.4 : 1);
      const lift = (rng() - 0.3) * 0.08;
      // stacking: later leaves sit a little higher; some lean on others
      const stack = (i / Math.max(1, nLeaf)) * 0.03;
      leaves.push(x, y + stack, z, rng() * 6.283, size, cell, cup, lift, rng(), (rng() - 0.5) * 0.35);
    }
    const nTwig = Math.floor((0.2 + b.teak * 0.6 + b.bamboo * 0.4 + b.riparian * 0.3) * (1 - b.village) * (1 - b.field) * 3 * this.dens + rng());
    for (let i = 0; i < nTwig; i++) {
      const x = x0 + rng() * CELL, z = z0 + rng() * CELL, y = height(x, z);
      if (waterAt(x, z) > y - 0.02) continue;
      twigs.push(x, y + 0.01, z, rng() * 6.283, 0.35 + rng() * 0.9);
    }
    // stones: gravel and rocks on ridges and laterite, river cobbles on banks and beds (under the water too)
    const bank = b.sand + b.riparian * 0.3;
    const nStone = Math.floor((b.rock * 9 + laterite * 2.5 + bank * 10 + 0.4) * this.dens * (1 - b.field) + rng());
    for (let i = 0; i < nStone; i++) {
      const x = x0 + rng() * CELL, z = z0 + rng() * CELL, y = height(x, z), w = waterAt(x, z);
      const under = w > y + 0.02;
      if (under && w - y > 2.2) continue;
      const big = rng() < 0.12 + b.rock * 0.15;
      const sz = big ? 0.18 + rng() * 0.32 : 0.035 + rng() * 0.09;
      let col;
      if (under || bank > 0.5) { const g = 0.42 + rng() * 0.35; col = under ? [g * 0.72, g * 0.8, g * 0.6] : [g * 1.05, g, g * 0.92]; }   // smooth river cobbles; algae under water
      else if (rng() < laterite) { col = [0.72 + rng() * 0.2, 0.36 + rng() * 0.12, 0.22 + rng() * 0.08]; }                                 // laterite
      else { const g = 0.5 + rng() * 0.35; col = [g, g * 0.96, g * 0.9]; }                                                                     // gneiss / basalt
      stones.push(x, y - sz * 0.25, z, rng() * 6.283, sz, (rng() * 3) | 0, col[0], col[1], col[2], under || bank > 0.5 ? 1 : 0);
    }
    return { leaves: new Float32Array(leaves), twigs: new Float32Array(twigs), stones: new Float32Array(stones) };
  }
  update(cam, force) {
    if (!force && this.last.distanceToSquared(cam) < 2.25) return;
    this.last.copy(cam);
    const R = this.R, r = Math.ceil(R / CELL), pcx = Math.floor(cam.x / CELL), pcz = Math.floor(cam.z / CELL);
    let nl = 0, nt = 0; const ns = [0, 0, 0];
    const L = this.leaves, LA = this.leafAttr.array, capL = L.instanceMatrix.count;
    const capT = this.twigs.instanceMatrix.count;
    let gen = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const ccx = (pcx + dx + 0.5) * CELL - cam.x, ccz = (pcz + dz + 0.5) * CELL - cam.z;
      if (ccx * ccx + ccz * ccz > (R + 3) * (R + 3)) continue;
      const key = (pcx + dx) * 100003 + (pcz + dz);
      let c = this.cells.get(key);
      if (!c) { if (!force && gen > 30) continue; c = this.genCell(pcx + dx, pcz + dz); this.cells.set(key, c); gen++; }
      const a = c.leaves;
      for (let i = 0; i < a.length && nl < capL; i += 10) {
        this._e.set(a[i + 9] * 0.25, a[i + 3], a[i + 9], 'YXZ'); this._q.setFromEuler(this._e);
        const s = a[i + 4];
        this._m.compose(this._v.set(a[i], a[i + 1], a[i + 2]), this._q, this._s.set(s * (a[i + 5] === 9 ? 0.25 : 0.62), s, s));
        this._m.toArray(L.instanceMatrix.array, nl * 16);
        LA[nl * 4] = a[i + 5]; LA[nl * 4 + 1] = a[i + 6]; LA[nl * 4 + 2] = a[i + 7]; LA[nl * 4 + 3] = a[i + 8];
        nl++;
      }
      const t = c.twigs;
      for (let i = 0; i < t.length && nt < capT; i += 5) {
        this._e.set(0, t[i + 3], 0.04); this._q.setFromEuler(this._e);
        const s = t[i + 4];
        this._m.compose(this._v.set(t[i], t[i + 1], t[i + 2]), this._q, this._s.set(s, Math.min(1.4, 0.6 + s), Math.min(1.4, 0.6 + s)));
        this._m.toArray(this.twigs.instanceMatrix.array, nt * 16); nt++;
      }
      const st = c.stones;
      for (let i = 0; i < st.length; i += 10) {
        const k = st[i + 5], m = this.stones[k]; if (ns[k] >= m.instanceMatrix.count) continue;
        this._e.set((st[i + 3] % 0.4) - 0.2, st[i + 3], 0); this._q.setFromEuler(this._e);
        const s = st[i + 4], round = st[i + 9];
        this._m.compose(this._v.set(st[i], st[i + 1], st[i + 2]), this._q, this._s.set(s * (round ? 1.15 : 1), s * (round ? 0.8 : 1), s));
        this._m.toArray(m.instanceMatrix.array, ns[k] * 16);
        m.instanceColor.array[ns[k] * 3] = st[i + 6]; m.instanceColor.array[ns[k] * 3 + 1] = st[i + 7]; m.instanceColor.array[ns[k] * 3 + 2] = st[i + 8];
        ns[k]++;
      }
    }
    L.count = nl; L.instanceMatrix.needsUpdate = true; this.leafAttr.needsUpdate = true;
    this.twigs.count = nt; this.twigs.instanceMatrix.needsUpdate = true;
    this.stones.forEach((m, k) => { m.count = ns[k]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
    if (this.cells.size > 5000) for (const [k] of this.cells) { this.cells.delete(k); if (this.cells.size < 2500) break; }
  }
}

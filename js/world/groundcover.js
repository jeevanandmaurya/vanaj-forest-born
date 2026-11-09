// Real things lying on the ground near you, not painted on it: thousands of individual curled leaf meshes in
// drifts (teak leaves 30–50 cm across, as on the Pench floor in the dry months), sticks and forked twigs,
// gravel and stones (red laterite on the ridges, grey gneiss elsewhere), and rounded cobbles on stream and
// pond beds, under the water. Everything is deterministic per 4 m cell, so it is the same when you come back.
import * as THREE from 'three';
import { G, patch, NOISE_GLSL } from '../core/shaderlib.js';
import { PAINTED } from '../core/palette.js';
import { toon } from '../core/toon.js';
import { biomeAt, waterAt, groundHeight, groundStep } from './terrain.js';
import { Simplex } from '../core/noise.js';

const CELL = 4;
const LEAF_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];         // atlas cells that are leaves
const LEAF_SIZE = [0.42, 0.4, 0.3, 0.4, 0.26, 0.17, 0.2, 0.18, 0.3, 0.2];  // metres, longest side
const SEASON_LEAF = { winter: 1.0, summer: 1.35, monsoon: 0.3, post: 0.55 };
// share of fallen teak leaves still green: teak sheds leaves that have already browned, so green ones are
// the few that langurs drop or storms tear off, more of them in the rains
const SEASON_FRESH = { winter: 0.06, summer: 0.02, monsoon: 0.2, post: 0.1 };
const LS = 12, TS = 7, SS = 10;   // floats per leaf, twig and stone record

// sit things on the rendered terrain mesh, not the analytic height (they differ by a few cm between vertices):
// returns [y, nx, nz] for the surface under (x, z), the normal sampled over the size of the object
function surface(x, z, e) {
  const y = groundHeight(x, z);
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z), hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz);
  return [y, -hx / l, -hz / l];
}

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
    const d = 1 + 0.26 * n2(x * 1.7 + y, z * 1.7 - y) + 0.12 * n2(x * 4 + 3, z * 4 - y * 3);   // lumpy, not egg-smooth
    // flat-bottomed, a little faceted like weathered gneiss
    p.setXYZ(i, x * d, Math.max(-0.35, y * d * 0.62), z * d * 0.85);
  }
  g.computeVertexNormals(); return g;
}

const litterLevel = (q) => (q.grassR > 60 ? 1.5 : q.grassR > 45 ? 1.1 : q.grassR > 30 ? 0.8 : 0.45);
export class GroundCover {
  constructor(scene, T, quality) {
    this.scene = scene; this.q = quality; this.T = T;
    const lv = litterLevel(quality);
    this.R = 12 + lv * 12;                      // radius of 3D litter
    this.dens = lv;
    this.leafMul = 1; this.fresh = SEASON_FRESH.winter;
    this.cells = new Map(); this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.pressed = new Map(); this.dirty = false; this.rebuiltAt = 0;
    // (room for the highest level, which the graphics setting can switch to at any time; only what is in use gets drawn)
    const top = 1.5, capL = Math.floor(9000 + top * 16000), capT = Math.floor(600 + top * 1400), capS = Math.floor(900 + top * 2200);
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
          vec3 tint = mix(vec3(0.74, 0.69, 0.64), vec3(1.05, 0.99, 0.9), vTint);
          diffuseColor.rgb *= tint * mix(1.0, 0.62, uWetness);
          if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;   // underside of a curled leaf is in its own shade`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.9, 0.45, uWetness);`);
    });
    this.leaves = new THREE.InstancedMesh(lg, lm, capL);

    // --- twigs
    const tm = PAINTED ? toon({ color: 0x8a7258, rim: 0.3, key: 'gc-twig' }) : new THREE.MeshStandardMaterial({ color: 0x8a7258, map: T.scan && T.scan.oak ? T.scan.oak.map : null, roughness: 0.95 });
    this.twigs = new THREE.InstancedMesh(twigGeometry(), tm, capT);

    // --- stones: three shapes share one material; colour per instance (laterite, gneiss, basalt, algae-wet)
    // painted: each stone a flat colour (per instance) on toon light, darker where it sits in the soil
    const sm = PAINTED ? toon({ rim: 0.4, key: 'gc-stone', patch: (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n varying float vSY;`).replace('#include <begin_vertex>', `#include <begin_vertex>\n vSY = position.y;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n varying float vSY;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= 1.15 * mix(0.7, 1.0, smoothstep(-0.3, 0.2, vSY));`);
    } }) : new THREE.MeshStandardMaterial({ map: T.rock, roughness: 0.82 });
    if (!PAINTED) patch(sm, 'gc-stone', (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n varying vec3 vSP; varying vec3 vSN;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n vSP = position; vSN = normal;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n varying vec3 vSP; varying vec3 vSN;\n uniform float uWetness;`)
        .replace('#include <map_fragment>', `
          // triplanar on the stone's own shape, so every stone shows grain and pits
          vec3 bw = abs(normalize(vSN)); bw = pow(bw, vec3(4.0)); bw /= dot(bw, vec3(1.0));
          vec3 st = texture2D(map, vSP.yz * 0.6).rgb * bw.x + texture2D(map, vSP.xz * 0.6).rgb * bw.y + texture2D(map, vSP.xy * 0.6).rgb * bw.z;
          diffuseColor.rgb *= st * 1.2;
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
    this._up = new THREE.Vector3(0, 1, 0); this._n = new THREE.Vector3(); this._qa = new THREE.Quaternion();
  }
  applyQuality() { const lv = litterLevel(this.q); this.R = 12 + lv * 12; this.dens = lv; this.uR.value = this.R; this.cells.clear(); this.last.set(1e9, 0, 1e9); }
  setSeason(s) { this.leafMul = PAINTED ? 0 : SEASON_LEAF[s] ?? 1; this.fresh = SEASON_FRESH[s] ?? 0.06; this.cells.clear(); this.pressed.clear(); this.last.set(1e9, 0, 1e9); }
  // a foot came down here: dry leaves under it crumble into the print, so leave the 3D leaves out of that spot.
  // Kept per cell for half a game day, which is longer than any print lasts.
  press(x, z, r, t) {
    const m = r + 0.2;   // reach of the largest leaf whose centre could still lie over the print
    for (let cx = Math.floor((x - m) / CELL); cx <= Math.floor((x + m) / CELL); cx++) for (let cz = Math.floor((z - m) / CELL); cz <= Math.floor((z + m) / CELL); cz++) {
      const key = cx * 100003 + cz;
      let a = this.pressed.get(key);
      if (!a) { a = []; this.pressed.set(key, a); }
      while (a.length && t - a[3] > 12) a.splice(0, 4);
      a.push(x, z, r, t);
    }
    if (this.pressed.size > 4000) for (const [k] of this.pressed) { this.pressed.delete(k); if (this.pressed.size < 2000) break; }
    if ((x - this.last.x) ** 2 + (z - this.last.z) ** 2 < (this.R + 2) ** 2) this.dirty = true;
  }
  crushed(x, z, size) {
    const a = this.pressed.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)); if (!a) return false;
    for (let i = 0; i < a.length; i += 4) { const r = a[i + 2] + size * 0.3; if ((x - a[i]) ** 2 + (z - a[i + 1]) ** 2 < r * r) return true; }
    return false;
  }
  // rotation that lays a local-XZ object on the ground slope (nx, nz), after its own yaw and tilt
  orient(nx, nz) {
    this._n.set(nx, Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)), nz);
    this._q.setFromEuler(this._e).premultiply(this._qa.setFromUnitVectors(this._up, this._n));
    return this._q;
  }
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
      const placed = leaves.length / LS;
      if (i % 2 && placed >= 4) { const j = ((i * 7) % placed) * LS; x = leaves[j] + (rng() - 0.5) * 0.9; z = leaves[j + 2] + (rng() - 0.5) * 0.9; }
      else { x = x0 + rng() * CELL; z = z0 + rng() * CELL; }
      const [y, nx, nz] = surface(x, z, 0.2);
      if (waterAt(x, z) > y - 0.03) continue;
      // species mix: mostly teak where teak dominates, small leaves in mixed forest, bamboo straw in brakes
      const r = rng();
      let cell;
      if (b.bamboo > 0.5 && r < 0.6) cell = 9;
      else if (r < b.teak * 0.75) cell = rng() < this.fresh ? 3 : (rng() * 3) | 0;
      else cell = 4 + ((rng() * 5) | 0);
      const size = LEAF_SIZE[cell] * (0.75 + rng() * 0.5);
      // dead teak leaves dry into boats and half-tubes; in the rains they go limp and flat
      const cup = (0.04 + rng() * 0.13) * (this.leafMul > 1 ? 1.4 : this.leafMul < 0.5 ? 0.4 : 1);
      const lift = (rng() - 0.3) * 0.08;
      const tilt = (rng() - 0.5) * 0.35;
      // stacking: later leaves sit a little higher; some lean on others. A tilted leaf is raised by the
      // height its low edge would otherwise dig into the ground.
      const stack = (i / Math.max(1, nLeaf)) * 0.03 + Math.abs(tilt) * size * 0.31 + Math.abs(tilt * 0.25) * size * 0.5;
      leaves.push(x, y + stack, z, rng() * 6.283, size, cell, cup, lift, rng(), tilt, nx, nz);
    }
    const nTwig = Math.floor((0.2 + b.teak * 0.6 + b.bamboo * 0.4 + b.riparian * 0.3) * (1 - b.village) * (1 - b.field) * 3 * this.dens + rng());
    for (let i = 0; i < nTwig; i++) {
      const x = x0 + rng() * CELL, z = z0 + rng() * CELL, [y, nx, nz] = surface(x, z, 0.4);
      if (waterAt(x, z) > y - 0.02) continue;
      twigs.push(x, y + 0.01, z, rng() * 6.283, 0.35 + rng() * 0.9, nx, nz);
    }
    // stones: gravel and rocks on ridges and laterite, river cobbles on banks and beds (under the water too)
    const bank = b.sand + b.riparian * 0.3;
    const nStone = Math.floor((b.rock * 9 + laterite * 2.5 + bank * 10 + 0.4) * this.dens * (1 - b.field) + rng());
    for (let i = 0; i < nStone; i++) {
      const x = x0 + rng() * CELL, z = z0 + rng() * CELL, y = groundHeight(x, z), w = waterAt(x, z);
      const under = w > y + 0.02;
      if (under && w - y > 2.2) continue;
      const big = rng() < 0.12 + b.rock * 0.15;
      const sz = big ? 0.18 + rng() * 0.32 : 0.035 + rng() * 0.09;
      let col;
      // dull, dusty colours: these sit in the litter, they are not polished
      if (under || bank > 0.5) { const g = 0.36 + rng() * 0.3; col = under ? [g * 0.72, g * 0.8, g * 0.6] : [g * 1.04, g, g * 0.93]; }   // smooth river cobbles; algae under water
      else if (rng() < laterite) { const g = 0.85 + rng() * 0.3; col = [0.46 * g, 0.33 * g, 0.26 * g]; }                                   // rusty laterite nodules
      else { const g = 0.36 + rng() * 0.26; col = [g, g * 0.96, g * 0.9]; }                                                                     // gneiss / basalt
      stones.push(x, y - sz * 0.25, z, rng() * 6.283, sz, (rng() * 3) | 0, col[0], col[1], col[2], under || bank > 0.5 ? 1 : 0);
    }
    return { leaves: new Float32Array(leaves), twigs: new Float32Array(twigs), stones: new Float32Array(stones), step: groundStep(x0 + 2, z0 + 2) };
  }
  update(cam, force) {
    // rebuild when the camera has moved, or (at most twice a second) when fresh prints crushed leaves nearby
    const now = performance.now();
    if (!force && this.last.distanceToSquared(cam) < 2.25 && !(this.dirty && now - this.rebuiltAt > 500)) return;
    this.last.copy(cam); this.dirty = false; this.rebuiltAt = now;
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
      // regenerate (same layout, new heights) when the terrain under the cell was rebuilt at another resolution
      const stale = c && c.step !== groundStep((pcx + dx) * CELL + 2, (pcz + dz) * CELL + 2);
      if (!c || stale) {
        if (!force && gen > 30) { if (!c) continue; }
        else { c = this.genCell(pcx + dx, pcz + dz); this.cells.set(key, c); gen++; }
      }
      const a = c.leaves;
      for (let i = 0; i < a.length && nl < capL; i += LS) {
        if (this.pressed.size && this.crushed(a[i], a[i + 2], a[i + 4])) continue;
        this._e.set(a[i + 9] * 0.25, a[i + 3], a[i + 9], 'YXZ');
        const s = a[i + 4];
        this._m.compose(this._v.set(a[i], a[i + 1], a[i + 2]), this.orient(a[i + 10], a[i + 11]), this._s.set(s * (a[i + 5] === 9 ? 0.25 : 0.62), s, s));
        this._m.toArray(L.instanceMatrix.array, nl * 16);
        LA[nl * 4] = a[i + 5]; LA[nl * 4 + 1] = a[i + 6]; LA[nl * 4 + 2] = a[i + 7]; LA[nl * 4 + 3] = a[i + 8];
        nl++;
      }
      const t = c.twigs;
      for (let i = 0; i < t.length && nt < capT; i += TS) {
        this._e.set(0, t[i + 3], 0.04);
        const s = t[i + 4];
        this._m.compose(this._v.set(t[i], t[i + 1], t[i + 2]), this.orient(t[i + 5], t[i + 6]), this._s.set(s, Math.min(1.4, 0.6 + s), Math.min(1.4, 0.6 + s)));
        this._m.toArray(this.twigs.instanceMatrix.array, nt * 16); nt++;
      }
      const st = c.stones;
      for (let i = 0; i < st.length; i += SS) {
        const k = st[i + 5], m = this.stones[k]; if (ns[k] >= m.instanceMatrix.count) continue;
        this._e.set((st[i + 3] % 0.4) - 0.2, st[i + 3], 0); this._q.setFromEuler(this._e);
        // every stone its own proportions, flat-bedded and sunk into the soil, so none reads as an egg
        const s = st[i + 4], round = st[i + 9], h = st[i + 3] * 7.31, sx = 0.75 + (h % 0.5), sz = 0.75 + ((h * 3.7) % 0.5);
        this._m.compose(this._v.set(st[i], st[i + 1] - s * 0.1, st[i + 2]), this._q, this._s.set(s * sx * (round ? 1.15 : 1), s * (round ? 0.62 : 0.7), s * sz));
        this._m.toArray(m.instanceMatrix.array, ns[k] * 16);
        m.instanceColor.array[ns[k] * 3] = st[i + 6]; m.instanceColor.array[ns[k] * 3 + 1] = st[i + 7]; m.instanceColor.array[ns[k] * 3 + 2] = st[i + 8];
        ns[k]++;
      }
    }
    L.count = nl; L.instanceMatrix.needsUpdate = true; this.leafAttr.needsUpdate = true;
    this.twigs.count = nt; this.twigs.visible = nt > 0;
    { const A = this.twigs.instanceMatrix; A.clearUpdateRanges(); if (nt) { A.addUpdateRange(0, nt * 16); A.needsUpdate = true; } }
    this.stones.forEach((m, k) => { const n = ns[k], A = m.instanceMatrix, C = m.instanceColor; m.count = n; m.visible = n > 0; A.clearUpdateRanges(); C.clearUpdateRanges(); if (n) { A.addUpdateRange(0, n * 16); C.addUpdateRange(0, n * 3); A.needsUpdate = true; C.needsUpdate = true; } });
    if (this.cells.size > 5000) for (const [k] of this.cells) { this.cells.delete(k); if (this.cells.size < 2500) break; }
  }
}

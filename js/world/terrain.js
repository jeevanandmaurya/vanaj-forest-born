// Pench landscape: analytic height field (Satpura hills, Pench river, Totladoh reservoir, plateau, maidan,
// waterholes, village), biome fields, chunked LOD terrain with skirts + far mesh, and a splat terrain shader.
import * as THREE from 'three';
import { Simplex, fbm, ridged, smoothstep, clamp, lerp } from '../core/noise.js';
import { G, patch, NOISE_GLSL } from '../core/shaderlib.js';

const S1 = new Simplex(1337), S2 = new Simplex(7331), S3 = new Simplex(4242), S4 = new Simplex(9001), S5 = new Simplex(555);

export const HALF = 2048;
export const LAKE_LEVEL = 16;
export const RIVER_W = 13;
export const CHUNK = 64;

export function riverX(z) {
  return -60 + 170 * Math.sin(z * 0.00165 + 0.6) + 85 * Math.sin(z * 0.0043 + 2.1) + 30 * Math.sin(z * 0.0102 + 0.3);
}
export function riverY(z) { return Math.max(LAKE_LEVEL, 31 - (z + 2048) * 0.0046); }

export const LAKE = { x: 0, z: 1640, rx: 640, rz: 330 };
LAKE.x = riverX(1320) - 30;
export function lakeE(x, z) {
  const dx = (x - LAKE.x) / LAKE.rx, dz = (z - LAKE.z) / LAKE.rz;
  return Math.sqrt(dx * dx + dz * dz) * (1 + 0.13 * S2.noise2(x / 260, z / 260));
}
let RIVER_END_Z = 1300;
for (let z = 1000; z < 1900; z += 5) { if (lakeE(riverX(z), z) < 0.85) { RIVER_END_Z = z; break; } }
export { RIVER_END_Z };

function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

// --- Regions -------------------------------------------------------------------------------------------
export const ROCKS = { x: -880, z: -180, r: 330 };
export const MAIDAN = { x: 420, z: -470, r: 340 };
export const VILLAGE = { x: 0, z: -1760, r: 230 };
VILLAGE.x = riverX(-1760) + 300;
export const TERMITE = { x: 1150, z: 260, r: 260 };
export const WATERHOLES = [
  { x: 700, z: 985, r: 15 }, { x: 1080, z: 330, r: 18 }, { x: 470, z: -430, r: 24 },
  { x: -700, z: -40, r: 14 }, { x: -320, z: -1220, r: 16 }, { x: 980, z: -900, r: 15 }, { x: -650, z: 900, r: 17 },
];

function plateauMask(x, z) {
  const d = Math.hypot(x - ROCKS.x, z - ROCKS.z) + 70 * S1.noise2(x / 160, z / 160);
  return 1 - smoothstep(ROCKS.r * 0.45, ROCKS.r, d);
}
function maidanMask(x, z) {
  const d = Math.hypot((x - MAIDAN.x) * 0.85, z - MAIDAN.z) + 80 * S2.noise2(x / 200, z / 200);
  return 1 - smoothstep(MAIDAN.r * 0.5, MAIDAN.r, d);
}
function villageMask(x, z) {
  const d = Math.hypot(x - VILLAGE.x, z - VILLAGE.z) + 30 * S3.noise2(x / 90, z / 90);
  return 1 - smoothstep(VILLAGE.r * 0.55, VILLAGE.r, d);
}
function termiteMask(x, z) {
  const d = Math.hypot(x - TERMITE.x, z - TERMITE.z) + 60 * S4.noise2(x / 150, z / 150);
  return 1 - smoothstep(TERMITE.r * 0.4, TERMITE.r, d);
}

function baseHeight(x, z) {
  let h = 44 + 24 * fbm(S1, x / 1100, z / 1100, 4) + 8 * fbm(S2, x / 280, z / 280, 3);
  const ex = smoothstep(1250, 2000, Math.abs(x));
  const en = smoothstep(1880, 2048, -z);
  const es = smoothstep(1960, 2048, z);
  const edge = Math.max(ex, en, es);
  if (edge > 0.001) h += edge * (55 + 75 * ridged(S3, x / 430, z / 430, 4));
  // gentle east ridge behind the den
  h += 18 * smoothstep(650, 1200, x) * (0.5 + 0.5 * S5.noise2(x / 500, z / 500));
  return h;
}

let VILLAGE_H = 40, MAIDAN_H = 40;
function heightNoWater(x, z) {
  let h = baseHeight(x, z);
  const pm = plateauMask(x, z);
  if (pm > 0.001) {
    const p = pm * 34 + 10 * pm * S2.noise2(x / 70, z / 70);
    const t = p / 5.5;
    const stepped = 5.5 * (Math.floor(t) + smoothstep(0.62, 1.0, t - Math.floor(t)));
    h += stepped + pm * 3 * S3.noise2(x / 13, z / 13);
  }
  const mm = maidanMask(x, z);
  if (mm > 0.001) h = lerp(h, MAIDAN_H + 4 * S1.noise2(x / 300, z / 300), mm * 0.8);
  const vm = villageMask(x, z);
  if (vm > 0.001) h = lerp(h, VILLAGE_H + 0.8 * S4.noise2(x / 60, z / 60), vm * 0.92);
  return h;
}
VILLAGE_H = baseHeight(VILLAGE.x, VILLAGE.z);
MAIDAN_H = baseHeight(MAIDAN.x, MAIDAN.z) - 2;
for (const w of WATERHOLES) w.level = heightNoWater(w.x, w.z) - 0.9;

export function height(x, z) {
  let h = heightNoWater(x, z);
  for (let i = 0; i < WATERHOLES.length; i++) {
    const w = WATERHOLES[i];
    const dx = x - w.x, dz = z - w.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 3600) {
      const d = Math.sqrt(d2) * (1 + 0.15 * S5.noise2(x / 9, z / 9));
      const prof = d < w.r ? w.level - 1.7 * (1 - (d / w.r) ** 2) : w.level + (d - w.r) * 0.22;
      h = smin(h, prof, 3);
    }
  }
  const rx = riverX(z), d = Math.abs(x - rx), ry = riverY(z);
  if (d < 420) {
    const chan = d < RIVER_W ? ry - 3.4 * (1 - (d / RIVER_W) ** 2) + 0.15 : ry + 0.15 + Math.pow((d - RIVER_W) / 150, 1.6) * 55;
    h = smin(h, chan, 8);
  }
  const e = lakeE(x, z);
  if (e < 2.2) {
    const lp = e < 1 ? LAKE_LEVEL - 7.5 * Math.pow(1 - e, 0.7) + 0.2 : LAKE_LEVEL + 0.25 + (e - 1) * 45;
    h = smin(h, lp, 6);
  }
  h += 0.9 * S3.noise2(x / 22, z / 22) + 0.25 * S1.noise2(x / 6.5, z / 6.5);
  return h;
}

export function waterAt(x, z, season = 'winter') {
  let lvl = -1e9;
  const rise = G.uWaterRise.value;
  if (z < RIVER_END_Z + 40 && Math.abs(x - riverX(z)) < RIVER_W + 14) lvl = riverY(z) + rise;
  if (lakeE(x, z) < 1.2) lvl = Math.max(lvl, LAKE_LEVEL + rise * 0.6);
  for (let i = 0; i < WATERHOLES.length; i++) {
    const w = WATERHOLES[i];
    const dx = x - w.x, dz = z - w.z;
    if (dx * dx + dz * dz < (w.r + 6) ** 2) lvl = Math.max(lvl, w.level + waterholeOffset());
  }
  return lvl;
}
export const WATER_STATE = { holeOffset: 0 };
export function waterholeOffset() { return WATER_STATE.holeOffset; }

// --- Biome fields -----------------------------------------------------------------------------------------
const B = { rock: 0, grass: 0, bamboo: 0, riparian: 0, village: 0, field: 0, teak: 0, mixed: 0, termite: 0, open: 0, moist: 0, sand: 0, dRiver: 0 };
export function biomeAt(x, z) {
  const dR = Math.abs(x - riverX(z));
  const le = lakeE(x, z);
  const moist = 0.5 + 0.5 * fbm(S4, x / 650, z / 650, 3);
  const pat = S1.noise2(x / 140 + 50, z / 140 - 30);
  const rock = plateauMask(x, z);
  const maid = maidanMask(x, z);
  const vil = villageMask(x, z);
  const ter = termiteMask(x, z);
  let rip = 1 - smoothstep(RIVER_W + 4, RIVER_W + 75, dR);
  rip = Math.max(rip, 1 - smoothstep(1.0, 1.25, le));
  const sand = Math.max(1 - smoothstep(RIVER_W - 2, RIVER_W + 7, dR), 1 - smoothstep(0.98, 1.06, le));
  const openNoise = smoothstep(0.45, 0.7, S2.noise2(x / 120, z / 120));
  const bamboo = clamp(smoothstep(0.58, 0.78, moist + 0.25 * pat) * (1 - maid) * (1 - rock) * (1 - vil) + ter * 0.35 * smoothstep(0, 0.5, pat), 0, 1);
  const field = vil * smoothstep(0.1, 0.4, S3.noise2(x / 45, z / 45) * 0.5 + 0.5 + (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) > 70 ? 0.3 : -1));
  B.rock = rock; B.grass = clamp(Math.max(maid, openNoise * 0.7, vil * 0.6), 0, 1);
  B.bamboo = bamboo; B.riparian = rip; B.village = vil; B.field = clamp(field, 0, 1); B.termite = ter;
  B.open = Math.max(maid, openNoise * 0.5); B.moist = moist; B.sand = sand; B.dRiver = dR;
  B.teak = clamp(1 - maid - rock * 0.8 - vil - bamboo * 0.6 - rip * 0.5, 0, 1);
  B.mixed = clamp(0.4 + 0.6 * pat, 0, 1);
  return B;
}

// --- Terrain chunks -------------------------------------------------------------------------------------
const heightCache = new Map(); // key -> {x0,z0,step,n,h:Float32Array}
const ckey = (cx, cz) => cx * 100003 + cz;

export function groundHeight(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const c = heightCache.get(ckey(cx, cz));
  if (!c) return height(x, z);
  const fx = (x - c.x0) / c.step, fz = (z - c.z0) / c.step;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; if (j < 0) j = 0; if (i >= c.n) i = c.n - 1; if (j >= c.n) j = c.n - 1;
  const u = fx - i, v = fz - j, N = c.n + 1, H = c.h;
  const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
export function groundNormal(x, z, out) {
  const e = 0.6;
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  out.set(-hx, 2 * e, -hz).normalize();
  return out;
}

function splatFor(x, z, h, ny, out, o) {
  const b = biomeAt(x, z);
  const slope = 1 - ny;
  let litter = 0.25 + b.teak * 0.9 + b.bamboo * 0.5;
  let grass = b.grass * 1.2 + b.riparian * 0.35 + b.open * 0.5;
  let rock = b.rock * smoothstep(0.05, 0.25, slope + 0.1 * S2.noise2(x / 20, z / 20)) + smoothstep(0.42, 0.6, slope);
  let sand = b.sand * 1.4;
  if (h > 110) rock += 0.4;
  const s = litter + grass + rock + sand + 1e-4;
  out[o] = litter / s; out[o + 1] = grass / s; out[o + 2] = rock / s; out[o + 3] = sand / s;
  return b.field;
}

function buildGridGeometry(x0, z0, size, n, analytic, skirt, sink = 0) {
  const N = n + 1, step = size / n;
  // heights with 1-sample border for normals
  const NB = N + 2;
  const hb = new Float32Array(NB * NB);
  for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) hb[j * NB + i] = analytic(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const vCount = N * N + (skirt ? 4 * n + 4 : 0) ;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), spl = new Float32Array(vCount * 4), fld = new Float32Array(vCount);
  const hgrid = new Float32Array(N * N);
  let v = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    const h = hb[(j + 1) * NB + i + 1];
    hgrid[j * N + i] = h;
    const hl = hb[(j + 1) * NB + i], hr = hb[(j + 1) * NB + i + 2], hd = hb[j * NB + i + 1], hu = hb[(j + 2) * NB + i + 1];
    let nx = hl - hr, ny = 2 * step, nz = hd - hu; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    pos[v * 3] = x; pos[v * 3 + 1] = h - sink; pos[v * 3 + 2] = z;
    nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
    fld[v] = splatFor(x, z, h, ny, spl, v * 4);
    v++;
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (skirt) {
    const border = [];
    for (let i = 0; i < n; i++) border.push(i);                 // north edge
    for (let j = 0; j < n; j++) border.push(j * N + n);         // east
    for (let i = n; i > 0; i--) border.push(n * N + i);         // south
    for (let j = n; j > 0; j--) border.push(j * N);             // west
    const start = v;
    for (const bi of border) {
      pos[v * 3] = pos[bi * 3]; pos[v * 3 + 1] = pos[bi * 3 + 1] - 7; pos[v * 3 + 2] = pos[bi * 3 + 2];
      nor[v * 3] = nor[bi * 3]; nor[v * 3 + 1] = nor[bi * 3 + 1]; nor[v * 3 + 2] = nor[bi * 3 + 2];
      for (let k = 0; k < 4; k++) spl[v * 4 + k] = spl[bi * 4 + k];
      fld[v] = fld[bi];
      v++;
    }
    const L = border.length;
    for (let k = 0; k < L; k++) {
      const a = border[k], b = border[(k + 1) % L], sa = start + k, sb = start + (k + 1) % L;
      idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  g.setAttribute('aSplat', new THREE.BufferAttribute(spl.subarray(0, v * 4), 4));
  g.setAttribute('aField', new THREE.BufferAttribute(fld.subarray(0, v), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, hgrid, step };
}

export function createTerrainMaterial(tex, far) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0 });
  m.userData.near = { value: new THREE.Vector4(0, 0, 0, 0) };
  patch(m, far ? 'terrain-far' : 'terrain', (s) => {
    s.uniforms.tLitter = { value: tex.litter }; s.uniforms.tSoil = { value: tex.soil };
    s.uniforms.tRock = { value: tex.rock }; s.uniforms.tGrassG = { value: tex.grassGround }; s.uniforms.tSand = { value: tex.sand };
    s.uniforms.uNearRect = m.userData.near;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat; attribute float aField;
        varying vec4 vSplat; varying float vField; varying vec3 vWP; varying vec3 vWN;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
        vSplat = aSplat; vField = aField;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        uniform sampler2D tLitter, tSoil, tRock, tGrassG, tSand; uniform vec4 uNearRect;
        uniform float uSeasonGreen, uWetness;
        varying vec4 vSplat; varying float vField; varying vec3 vWP; varying vec3 vWN;
        float lum(vec3 c){ return dot(c, vec3(0.3,0.55,0.15)); }`)
      .replace('#include <map_fragment>', `
        ${far ? 'if (vWP.x > uNearRect.x && vWP.x < uNearRect.z && vWP.z > uNearRect.y && vWP.z < uNearRect.w) discard;' : ''}
        vec2 uv = vWP.xz;
        float macro = fbm2(uv * 0.011);
        float n2 = vnoise(uv * 0.09);
        vec3 tl = mix(texture2D(tLitter, uv * 0.21).rgb, texture2D(tLitter, uv * 0.053 + 0.37).rgb, 0.35);
        vec3 ts = mix(texture2D(tSoil, uv * 0.16).rgb, texture2D(tSoil, uv * 0.041).rgb, 0.4);
        vec3 tg = mix(texture2D(tGrassG, uv * 0.19).rgb, texture2D(tGrassG, uv * 0.049 + 0.5).rgb, 0.4);
        vec3 tnd = texture2D(tSand, uv * 0.12).rgb;
        vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 tr = texture2D(tRock, vWP.zy * 0.07).rgb * bw.x + texture2D(tRock, vWP.xz * 0.07).rgb * bw.y + texture2D(tRock, vWP.xy * 0.07).rgb * bw.z;
        float green = clamp(uSeasonGreen * (0.75 + 0.5 * macro), 0.0, 1.0);
        tg *= mix(vec3(1.12, 0.95, 0.62), vec3(0.58, 0.84, 0.38), green);
        tl *= mix(vec3(1.05, 0.98, 0.9), vec3(0.72, 0.8, 0.58), green * 0.6);
        float slope = 1.0 - vWN.y;
        vec4 w = vSplat;
        w.z = max(w.z, smoothstep(0.38, 0.6, slope + (n2 - 0.5) * 0.2));
        w.y *= 0.6 + 0.8 * vnoise(uv * 0.05);
        vec4 hb = vec4(lum(tl), lum(tg), lum(tr), lum(tnd)) + 0.35;
        w = w * hb * hb * hb * hb; w /= (w.x + w.y + w.z + w.w + 1e-4);
        vec3 tcol = tl * w.x + tg * w.y + tr * w.z + tnd * w.w;
        tcol = mix(tcol, ts, smoothstep(0.5, 0.85, macro) * 0.45 * (1.0 - w.z));
        vec3 fieldC = mix(vec3(0.42, 0.3, 0.19), vec3(0.36, 0.42, 0.18), green) * (0.8 + 0.4 * vnoise(vec2(uv.x * 0.6, uv.y * 0.03)));
        tcol = mix(tcol, fieldC * (0.9 + 0.2 * sin(uv.x * 2.2)), vField * 0.85);
        tcol *= 0.82 + 0.36 * macro;
        float wet = clamp(uWetness * (0.6 + 0.4 * n2) + w.w * 0.5, 0.0, 1.0);
        tcol *= mix(1.0, 0.6, wet);
        diffuseColor.rgb = tcol;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.96, 0.42, wet);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float bh = lum(tcol) * 3.0;
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(bh), dhy = dFdy(bh);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          float bs = 0.018 * (1.0 - smoothstep(8.0, 30.0, length(vViewPosition)));
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad * bs);
        }`);
  });
  return m;
}

export class TerrainManager {
  constructor(scene, tex, quality) {
    this.scene = scene; this.q = quality;
    this.mat = createTerrainMaterial(tex, false);
    this.farMat = createTerrainMaterial(tex, true);
    this.chunks = new Map();
    this.queue = [];
    this.center = { cx: 1e9, cz: 1e9 };
    this.R = quality.chunkR;
    // far mesh
    const farN = quality.farSegs || 256;
    const far = buildGridGeometry(-HALF, -HALF, HALF * 2, farN, height, false, 1.3);
    this.far = new THREE.Mesh(far.geometry, this.farMat);
    this.far.receiveShadow = false; this.far.castShadow = false;
    this.far.frustumCulled = false;
    this.far.renderOrder = -1;
    scene.add(this.far);
  }
  lodFor(d) { return d <= 1 ? 64 : d <= 2 ? 32 : 16; }
  update(px, pz, budgetMs = 6, force = false) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    if (cx !== this.center.cx || cz !== this.center.cz || force) {
      this.center = { cx, cz };
      const want = new Map();
      for (let dz = -this.R; dz <= this.R; dz++) for (let dx = -this.R; dx <= this.R; dx++) {
        const kx = cx + dx, kz = cz + dz;
        if (Math.abs(kx * CHUNK) > HALF + CHUNK || Math.abs(kz * CHUNK) > HALF + CHUNK) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        want.set(ckey(kx, kz), { kx, kz, segs: this.lodFor(d), d });
      }
      for (const [k, c] of this.chunks) {
        if (!want.has(k)) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); this.chunks.delete(k); heightCache.delete(k); }
      }
      this.queue = [];
      for (const [k, w] of want) {
        const c = this.chunks.get(k);
        if (!c || c.segs !== w.segs) this.queue.push({ k, ...w });
      }
      this.queue.sort((a, b) => a.d - b.d);
    }
    const t0 = performance.now();
    while (this.queue.length && (force || performance.now() - t0 < budgetMs)) {
      const w = this.queue.shift();
      this.buildChunk(w);
    }
    // near rect for far mesh: largest fully-loaded square
    let r = 0;
    outer: for (r = 0; r <= this.R; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const kx = cx + dx, kz = cz + dz;
        if (Math.abs(kx * CHUNK) > HALF + CHUNK || Math.abs(kz * CHUNK) > HALF + CHUNK) continue;
        if (!this.chunks.has(ckey(kx, kz))) break outer;
      }
    }
    r -= 1;
    const nr = this.farMat.userData.near.value;
    if (r >= 0) nr.set((cx - r) * CHUNK + 0.5, (cz - r) * CHUNK + 0.5, (cx + r + 1) * CHUNK - 0.5, (cz + r + 1) * CHUNK - 0.5);
    else nr.set(0, 0, 0, 0);
  }
  buildChunk(w) {
    const old = this.chunks.get(w.k);
    const res = buildGridGeometry(w.kx * CHUNK, w.kz * CHUNK, CHUNK, w.segs, height, true);
    const mesh = new THREE.Mesh(res.geometry, this.mat);
    mesh.receiveShadow = true; mesh.castShadow = false;
    this.scene.add(mesh);
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    this.chunks.set(w.k, { mesh, segs: w.segs });
    heightCache.set(w.k, { x0: w.kx * CHUNK, z0: w.kz * CHUNK, step: res.step, n: w.segs, h: res.hgrid });
  }
  pending() { return this.queue.length; }
}

// Map image for the in-game map
export function renderMapCanvas(size = 384) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size);
  const step = (HALF * 2) / size;
  const hs = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) hs[j * size + i] = height(-HALF + i * step, -HALF + j * step);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -HALF + i * step, z = -HALF + j * step;
    const h = hs[j * size + i];
    const hl = hs[j * size + Math.max(0, i - 1)], hu = hs[Math.max(0, j - 1) * size + i];
    const shade = clamp(0.8 + (h - hl) * 0.08 + (h - hu) * 0.08, 0.4, 1.3);
    const b = biomeAt(x, z);
    let r = 120, g = 108, bl = 70;
    r = lerp(r, 92, b.teak); g = lerp(g, 96, b.teak); bl = lerp(bl, 58, b.teak);
    r = lerp(r, 170, b.grass * 0.8); g = lerp(g, 150, b.grass * 0.8); bl = lerp(bl, 90, b.grass * 0.8);
    r = lerp(r, 150, b.rock); g = lerp(g, 135, b.rock); bl = lerp(bl, 120, b.rock);
    r = lerp(r, 80, b.bamboo * 0.6); g = lerp(g, 110, b.bamboo * 0.6); bl = lerp(bl, 60, b.bamboo * 0.6);
    r = lerp(r, 190, b.village * 0.7); g = lerp(g, 160, b.village * 0.7); bl = lerp(bl, 120, b.village * 0.7);
    const wl = waterAt(x, z);
    let o = (j * size + i) * 4;
    if (wl > h) { img.data[o] = 40; img.data[o + 1] = 70; img.data[o + 2] = 80; }
    else { img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = bl * shade; }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

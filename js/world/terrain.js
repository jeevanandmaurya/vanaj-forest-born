// Pench landscape: analytic height field (Satpura hills, Pench river, Totladoh reservoir, plateau, maidan,
// waterholes, village), biome fields, chunked LOD terrain with skirts + far mesh, and a splat terrain shader.
import * as THREE from 'three';
import { Simplex, fbm, ridged, smoothstep, clamp, lerp } from '../core/noise.js';
import { G, patch, NOISE_GLSL } from '../core/shaderlib.js';
import { PAINTED, PU } from '../core/palette.js';
import { toon } from '../core/toon.js';

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
// a pool fills only to just under the lowest point of its rim: on a slope, the level taken from the centre stood
// above the downhill rim, and the water spilled out as a floating sheet
for (const w of WATERHOLES) {
  let rim = Infinity; for (let a = 0; a < 48; a++) rim = Math.min(rim, heightNoWater(w.x + Math.cos(a * 0.1309) * w.r, w.z + Math.sin(a * 0.1309) * w.r));
  w.level = Math.min(heightNoWater(w.x, w.z) - 0.9, rim - 0.3);
}

export function height(x, z) {
  let h = heightNoWater(x, z), bank = -1e9;
  for (let i = 0; i < WATERHOLES.length; i++) {
    const w = WATERHOLES[i];
    const dx = x - w.x, dz = z - w.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 3600) {
      const d = Math.sqrt(d2) * (1 + 0.15 * S5.noise2(x / 9, z / 9));
      const prof = d < w.r ? w.level - 1.7 * (1 - (d / w.r) ** 2) : w.level + (d - w.r) * 0.22;
      h = smin(h, prof, 3);
      // A low earth bank round the pool. On a slope the carved bowl had no downhill rim, so the water stood
      // above the ground beside it: a floating sheet you could see under, and water you could wade in mid-air.
      if (d > w.r) bank = Math.max(bank, w.level + 0.3 + (d - w.r) * 0.06 - Math.max(0, d - w.r - 4) * 0.45);
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
  // micro-relief you feel underfoot: hummocks, root bumps, hollows where leaves collect, cattle-trodden mud
  h += 0.11 * S4.noise2(x / 2.7, z / 2.7) + 0.045 * S5.noise2(x / 1.3 + 7, z / 1.3 - 3);
  return bank > h ? bank : h;   // after the relief noise, so no hollow dips below the waterline
}

export function waterAt(x, z, season = 'winter') {
  let lvl = -1e9;
  const rise = G.uWaterRise.value;
  if (z < RIVER_END_Z + 40 && Math.abs(x - riverX(z)) < RIVER_W + 14) lvl = riverY(z) + rise;
  if (lakeE(x, z) < 1.2) lvl = Math.max(lvl, LAKE_LEVEL + rise * 0.6);
  for (let i = 0; i < WATERHOLES.length; i++) {
    const w = WATERHOLES[i];
    const dx = x - w.x, dz = z - w.z;
    if (dx * dx + dz * dz < (w.r + 2) ** 2) lvl = Math.max(lvl, w.level + waterholeOffset());   // inside the bank only
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
// grid spacing of the loaded terrain mesh at (x, z), or 0 where no chunk is built yet
export function groundStep(x, z) {
  const c = heightCache.get(ckey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  return c ? c.step : 0;
}
export function groundNormal(x, z, out) {
  const e = 0.6;
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  out.set(-hx, 2 * e, -hz).normalize();
  return out;
}

function splatFor(x, z, h, ny, out, o, bio) {
  const b = biomeAt(x, z);
  const slope = 1 - ny;
  if (bio) {
    bio[o] = clamp(b.riparian * 0.85 + Math.max(0, b.moist - 0.55) * 1.2 + b.bamboo * 0.35, 0, 1);                        // moisture
    bio[o + 1] = clamp(b.teak * 0.85 + b.riparian * 0.4 + b.bamboo * 0.5, 0, 1) * (1 - b.grass * 0.8) * (1 - b.village);  // canopy
    bio[o + 2] = clamp(smoothstep(0.1, 0.55, S2.noise2(x / 280 + 13, z / 280 - 7)) * 0.8 + b.rock * 0.3 + Math.max(0, (h - 60) / 120), 0, 1); // laterite
    bio[o + 3] = clamp(smoothstep(0.15, 0.6, S3.noise2(x / 340 - 21, z / 340 + 4)) * (1 - slope * 4) * (1 - b.rock) * (1 - b.sand), 0, 1); // black soil
  }
  let litter = 0.25 + b.teak * 0.9 + b.bamboo * 0.5;
  let grass = b.grass * 1.2 + b.riparian * 0.35 + b.open * 0.5;
  let rock = b.rock * smoothstep(0.05, 0.25, slope + 0.1 * S2.noise2(x / 20, z / 20)) + smoothstep(0.42, 0.6, slope)
    + b.rock * smoothstep(0.15, 0.55, S5.noise2(x / 17, z / 17)) * 0.9;   // exposed sheet rock on the ridge tops
  let sand = b.sand * 1.4;
  if (h > 110) rock += 0.4;
  const s = litter + grass + rock + sand + 1e-4;
  out[o] = litter / s; out[o + 1] = grass / s; out[o + 2] = rock / s; out[o + 3] = sand / s;
  return b.field;
}

// Resumable: yields every few rows so a chunk can be built over several frames (a near chunk is 129 x 129
// samples of height, biome and soil, ~20-60 ms in one go, which showed as a hitch each time you crossed into a
// new chunk). buildGridGeometry runs it to the end at once.
function buildGridGeometry(x0, z0, size, n, analytic, skirt, sink = 0) {
  const it = buildGridGen(x0, z0, size, n, analytic, skirt, sink); let r; do r = it.next(); while (!r.done); return r.value;
}
function* buildGridGen(x0, z0, size, n, analytic, skirt, sink = 0) {
  const N = n + 1, step = size / n;
  // heights with 1-sample border for normals
  const NB = N + 2;
  const hb = new Float32Array(NB * NB);
  for (let j = 0; j < NB; j++) { for (let i = 0; i < NB; i++) hb[j * NB + i] = analytic(x0 + (i - 1) * step, z0 + (j - 1) * step); if (j % 16 === 15) yield; }
  const vCount = N * N + (skirt ? 4 * n + 4 : 0) ;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), spl = new Float32Array(vCount * 4), bio = new Float32Array(vCount * 4), fld = new Float32Array(vCount);
  const hgrid = new Float32Array(N * N);
  let v = 0;
  for (let j = 0; j < N; j++) { if (j % 6 === 5) yield; for (let i = 0; i < N; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    const h = hb[(j + 1) * NB + i + 1];
    hgrid[j * N + i] = h;
    const hl = hb[(j + 1) * NB + i], hr = hb[(j + 1) * NB + i + 2], hd = hb[j * NB + i + 1], hu = hb[(j + 2) * NB + i + 1];
    let nx = hl - hr, ny = 2 * step, nz = hd - hu; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    pos[v * 3] = x; pos[v * 3 + 1] = h - sink; pos[v * 3 + 2] = z;
    nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
    fld[v] = splatFor(x, z, h, ny, spl, v * 4, bio);
    { const wl = waterAt(x, z); if (wl > h) fld[v] = -Math.min(3, wl - h); }   // negative = submerged depth (river / pool bed)
    v++;
  } }
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
      for (let k = 0; k < 4; k++) { spl[v * 4 + k] = spl[bi * 4 + k]; bio[v * 4 + k] = bio[bi * 4 + k]; }
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
  g.setAttribute('aBio', new THREE.BufferAttribute(bio.subarray(0, v * 4), 4));
  g.setAttribute('aField', new THREE.BufferAttribute(fld.subarray(0, v), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, hgrid, step };
}

export function createTerrainMaterial(tex, far, lq = false) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0 });
  m.userData.near = { value: new THREE.Vector4(0, 0, 0, 0) };
  patch(m, (far ? 'terrain-far' : 'terrain') + (lq ? '-lq' : ''), (s) => {
    s.uniforms.tLitter = { value: tex.litter }; s.uniforms.tLitterM = { value: tex.litterMoist }; s.uniforms.tSoil = { value: tex.soil };
    s.uniforms.tRock = { value: tex.rock }; s.uniforms.tGrassG = { value: tex.grassGround }; s.uniforms.tSand = { value: tex.sand };
    s.uniforms.tRed = { value: tex.redSoil }; s.uniforms.tBlack = { value: tex.blackSoil }; s.uniforms.tAtlas = { value: tex.groundAtlas };
    s.uniforms.uNearRect = m.userData.near;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat; attribute vec4 aBio; attribute float aField;
        varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
        vSplat = aSplat; vBio = aBio; vField = aField;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        ${lq ? '#define TERRAIN_LQ' : ''}
        ${NOISE_GLSL}
        uniform sampler2D tLitter, tLitterM, tSoil, tRock, tGrassG, tSand, tRed, tBlack, tGroundAO, tAtlas; uniform vec4 uNearRect, uAORect;
        uniform float uSeasonGreen, uWetness, uDry, uTime; uniform vec2 uWind; uniform vec3 uSunDir;
        varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;
        float lum(vec3 c){ return dot(c, vec3(0.3,0.55,0.15)); }
        // ---- texture bombing: every fallen leaf, twig and pebble placed individually (no repeating tile)
        // mode 0 = mixed litter, 1 = pebbles, 2 = twigs & dry grass
        int pickSprite(float h, int mode, float moist, float lat, float grassW, float green) {
          if (mode == 1) return 12 + int(h * 2.99);
          if (mode == 2) return h < grassW ? 15 : 10 + int(fract(h * 31.0) * 1.99);
          float u = fract(h * 7.13);
          if (u < lat * 0.22) return 12 + int(fract(u * 53.0) * 2.99);
          if (moist > 0.45 && u < 0.08 + moist * 0.3) return 9;
          if (u < 0.62) { if (fract(u * 5.7) < green * 0.14) return 3; return int(fract(u * 17.3) * 2.99); }   // few fallen leaves are still green
          if (u < 0.72) return 4;
          if (u < 0.8) return 5;
          if (u < 0.92) return 6 + int(fract(u * 11.0) * 1.99);
          return 8;
        }
        vec4 bomb(vec2 g, vec2 gdx, vec2 gdy, float seed, float density, float scMin, float scMax, int mode, float moist, float lat, float grassW, float green, float wet, float dry) {
          vec4 acc = vec4(0.0);
          vec2 gi = floor(g) - 1.0;
          for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
            vec2 c = gi + vec2(float(i), float(j));
            if (hash12(c * 1.37 + seed) > density) continue;
            vec2 ctr = c + 0.5 + (vec2(hash12(c + seed + 1.7), hash12(c + seed + 3.1)) - 0.5) * 0.8;
            float ang = hash12(c + seed + 5.3) * 6.2832, cs = cos(ang), sn = sin(ang);
            float sc = mix(scMin, scMax, hash12(c + seed + 7.9));
            vec2 d = (g - ctr) / sc;
            vec2 l = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
            if (abs(l.x) > 0.5 || abs(l.y) > 0.5) continue;
            float hs = hash12(c + seed + 9.7);
            int k = pickSprite(hs, mode, moist, lat, grassW, green);
            float col = float(k - (k / 4) * 4), row = float(k / 4);
            vec2 auv = vec2((col + l.x + 0.5) * 0.25, 1.0 - (row + l.y + 0.5) * 0.25);
            vec2 rx = vec2(cs * gdx.x - sn * gdx.y, sn * gdx.x + cs * gdx.y) / sc, ry = vec2(cs * gdy.x - sn * gdy.y, sn * gdy.x + cs * gdy.y) / sc;
            vec4 t = textureGrad(tAtlas, auv, vec2(rx.x, -rx.y) * 0.25, vec2(ry.x, -ry.y) * 0.25);
            float age = hash12(c + seed + 11.3);
            vec3 tint = mix(vec3(1.06, 1.0, 0.92), vec3(0.72, 0.7, 0.66), age * age);          // fresh fall -> weathered grey
            if (mode == 0) tint *= mix(vec3(1.0), vec3(1.12, 1.04, 0.86), dry) * mix(1.0, 0.62, wet);
            t.rgb *= tint * (0.72 + 0.28 * t.a);                                                 // darker, lifted edges
            acc.rgb = mix(acc.rgb, t.rgb, t.a); acc.a = max(acc.a, t.a);
          }
          return acc;
        }`)
      .replace('#include <map_fragment>', `
        ${far ? 'if (vWP.x > uNearRect.x && vWP.x < uNearRect.z && vWP.z > uNearRect.y && vWP.z < uNearRect.w) discard;' : ''}
        vec2 uv = vWP.xz;
        float macro = fbm2(uv * 0.011);
        float n2 = vnoise(uv * 0.09);
        float hueN = vnoise(uv * 0.0065 + 3.1);
        float patchN = fbm2(uv * 0.045 + 7.3);
        float slope = 1.0 - vWN.y;
        vec4 bio = vBio; // x moisture, y canopy, z laterite, w black soil
        float fieldW = max(vField, 0.0), bedW = smoothstep(0.0, 0.6, -vField);
        const mat2 R1 = mat2(0.743, -0.669, 0.669, 0.743);
        // leaf litter, sampled at two rotated scales and blended by noise so the tile never repeats visibly
        float sel = smoothstep(0.3, 0.7, vnoise(uv * 0.06 + 11.0));
        vec3 tl = mix(texture2D(tLitter, uv * 0.21).rgb, texture2D(tLitter, R1 * uv * 0.163 + 0.31).rgb, sel);
        float camDg = length(vViewPosition);
        #ifndef TERRAIN_LQ
        float nf = 1.0 - smoothstep(16.0, 42.0, camDg);
        #else
        float nf = 1.0 - smoothstep(10.0, 24.0, camDg);
        #endif
        vec2 gdx = dFdx(uv), gdy = dFdy(uv);
        float fieldW0 = max(vField, 0.0), bedW0 = smoothstep(0.0, 0.6, -vField);
        vec4 pebL = vec4(0.0);
        #ifndef TERRAIN_LQ
        tl = mix(tl, texture2D(tLitter, uv * 0.053 + 0.37).rgb, 0.3);
        vec3 tm = mix(texture2D(tLitterM, R1 * uv * 0.2).rgb, texture2D(tLitterM, uv * 0.067 + 0.7).rgb, 0.35);
        vec3 tred = mix(texture2D(tRed, uv * 0.14).rgb, texture2D(tRed, R1 * uv * 0.045).rgb, 0.35);
        #else
        vec3 tm = texture2D(tLitterM, R1 * uv * 0.2).rgb;
        vec3 tred = texture2D(tRed, uv * 0.14).rgb;
        #endif
        vec3 ts = mix(texture2D(tSoil, uv * 0.16).rgb, texture2D(tSoil, uv * 0.041).rgb, 0.4);
        vec3 tblk = texture2D(tBlack, uv * 0.085).rgb;
        vec3 tg = mix(texture2D(tGrassG, uv * 0.19).rgb, texture2D(tGrassG, uv * 0.049 + 0.5).rgb, 0.4);
        vec3 tnd = texture2D(tSand, uv * 0.12).rgb;
        vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 tr = texture2D(tRock, vWP.zy * 0.07).rgb * bw.x + texture2D(tRock, vWP.xz * 0.07).rgb * bw.y + texture2D(tRock, vWP.xy * 0.07).rgb * bw.z;
        float green = clamp(uSeasonGreen * (0.75 + 0.5 * macro), 0.0, 1.0);
        tg *= mix(vec3(1.12, 0.95, 0.62), vec3(0.58, 0.84, 0.38), green);
        // litter character drifts across the forest: fresh golden teak fall, grey weathered litter, russet patches
        tl = mix(vec3(lum(tl)), tl, 0.72);                                  // teak litter is tan-brown, not orange
        if (nf > 0.001) {
          float slope0 = 1.0 - vWN.y;
          float cov0 = smoothstep(0.25, 0.62, fbm2(uv * 0.045 + 7.3) + vBio.y * 0.35 - slope0 * 0.9 - vBio.z * 0.18 + 0.1);
          float grass0 = vSplat.y;
          float dens = mix(0.25, 1.0, cov0) * (1.0 - bedW0) * (1.0 - fieldW0 * 0.9) * mix(1.0, 0.45, grass0) * mix(1.0, 0.75, uWetness);
          // base: the litter mat itself (broken, half-buried leaves), with bare humus where cover is thin
          vec3 humus = mix(texture2D(tSoil, uv * 0.16).rgb * vec3(0.62, 0.55, 0.48), texture2D(tBlack, uv * 0.085).rgb * 0.75, 0.45);
          humus = mix(humus, tl * 0.82, mix(0.35, 0.9, cov0));
          float gr = clamp(uSeasonGreen, 0.0, 1.0);
          vec4 Ls = bomb(uv / 0.26 + 7.1, gdx / 0.26, gdy / 0.26, 23.0, dens, 0.9, 1.6, 0, vBio.x, vBio.z, grass0, gr, uWetness, uDry);
          vec4 Lb = bomb(uv / 0.42, gdx / 0.42, gdy / 0.42, 11.0, dens * 0.95, 1.0, 1.75, 0, vBio.x, vBio.z, grass0, gr, uWetness, uDry);
          #ifndef TERRAIN_LQ
          vec4 Lt = bomb(uv / 0.9 + 3.3, gdx / 0.9, gdy / 0.9, 37.0, (0.2 + grass0 * 0.5) * (1.0 - bedW0), 0.8, 1.2, 2, vBio.x, vBio.z, grass0, gr, uWetness, uDry);
          #else
          vec4 Lt = vec4(0.0);
          #endif
          vec3 near = humus;
          near = mix(near, Ls.rgb, Ls.a);
          near = mix(near * (1.0 - Lb.a * 0.25), Lb.rgb, Lb.a);               // big leaves shade what lies under them
          near = mix(near, Lt.rgb, Lt.a);
          tl = mix(tl, near, nf);
          if (bedW0 > 0.01) pebL = bomb(uv / 0.2 + 1.9, gdx / 0.2, gdy / 0.2, 51.0, 0.72, 0.6, 1.0, 1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        }
        vec3 litTint = mix(vec3(1.08, 0.98, 0.8), vec3(0.8, 0.79, 0.77), smoothstep(0.3, 0.7, hueN));
        litTint = mix(litTint, vec3(1.06, 0.84, 0.7), smoothstep(0.6, 0.85, vnoise(uv * 0.011 - 5.0)) * 0.7);
        litTint = mix(litTint, vec3(0.62, 0.56, 0.48), smoothstep(0.62, 0.82, vnoise(uv * 0.021 + 17.0)) * 0.6);   // dark rotted patches
        litTint = mix(litTint, vec3(1.16, 1.04, 0.82), uDry * 0.45);
        tl *= litTint;
        // damp, half-rotted litter near water, in bamboo, and through the rains
        float moistW = clamp(bio.x * 1.1 + uWetness * 0.25 - uDry * 0.3 + (patchN - 0.5) * 0.5, 0.0, 1.0);
        tl = mix(tl, tm, smoothstep(0.3, 0.75, moistW) * mix(1.0, 0.3, nf));
        tl *= mix(vec3(1.05, 0.98, 0.9), vec3(0.76, 0.86, 0.6), green * 0.5);
        float sprout = green * smoothstep(0.74, 0.8, vnoise(uv * 3.1)) * (1.0 - uDry);
        tl = mix(tl, vec3(0.15, 0.25, 0.07), sprout * 0.55);
        // bare ground where the litter is thin: red laterite on ridges and slopes, black soil on flats, brown loam elsewhere
        float latW = clamp(bio.z + slope * 1.2 - 0.25, 0.0, 1.0);
        vec3 bare = mix(ts, tred, smoothstep(0.2, 0.7, latW));
        bare = mix(bare, tblk * mix(1.0, 0.7, uWetness), smoothstep(0.3, 0.7, bio.w) * (1.0 - latW * 0.6));
        float cover = smoothstep(0.32, 0.6, patchN + bio.y * 0.35 - slope * 0.9 - bio.z * 0.18 + 0.1);
        vec4 w = vSplat;
        w.z = max(w.z, smoothstep(0.38, 0.6, slope + (n2 - 0.5) * 0.2));
        w.y *= 0.6 + 0.8 * vnoise(uv * 0.05);
        vec4 hb = vec4(lum(tl), lum(tg), lum(tr), lum(tnd)) + 0.35;
        w = w * hb * hb * hb * hb; w /= (w.x + w.y + w.z + w.w + 1e-4);
        vec3 tcol = tl * w.x + tg * w.y + tr * w.z + tnd * w.w;
        tcol = mix(tcol, bare, (1.0 - cover) * w.x * 0.85 * mix(1.0, 0.45, nf));
        tcol = mix(tcol, bare, (1.0 - smoothstep(0.15, 0.45, patchN + 0.15)) * w.y * 0.45);
        vec3 fieldC = mix(vec3(0.42, 0.3, 0.19), vec3(0.36, 0.42, 0.18), green) * (0.8 + 0.4 * vnoise(vec2(uv.x * 0.6, uv.y * 0.03)));
        tcol = mix(tcol, fieldC * (0.9 + 0.2 * sin(uv.x * 2.2)), fieldW * 0.85);
        // burn scars of the summer ground fires: ash, charred litter, a few pale ash flecks
        float burn = uDry * smoothstep(0.64, 0.7, fbm2(uv * 0.006 + 9.0)) * bio.y * (1.0 - w.z) * (1.0 - w.w) * (1.0 - fieldW) * (1.0 - bedW);
        vec3 ashC = vec3(0.075, 0.07, 0.065) + vec3(0.22) * smoothstep(0.78, 0.92, vnoise(uv * 2.3));
        tcol = mix(tcol, ashC, burn * 0.85);
        tcol *= 0.84 + 0.32 * macro;
        // submerged bed: dark pebbles, silt and algae film instead of dry pale sand
        vec3 bedC = mix(tr * vec3(0.3, 0.32, 0.24), tblk * vec3(0.45, 0.5, 0.36), smoothstep(0.35, 0.65, vnoise(uv * 0.7)));
        bedC = mix(bedC, vec3(0.16, 0.2, 0.08), smoothstep(0.55, 0.8, vnoise(uv * 0.23 + 4.0)) * 0.5 * (1.0 - uWetness));
        vec3 silt = mix(vec3(0.1, 0.095, 0.07), vec3(0.15, 0.135, 0.1), vnoise(uv * 1.3)) * mix(1.0, 0.7, smoothstep(0.4, 0.7, vnoise(uv * 0.21 + 9.0)));
        bedC = mix(bedC * 0.6, silt, 0.6);
        bedC = mix(bedC, pebL.rgb * vec3(0.4, 0.42, 0.34), pebL.a * nf);
        tcol = mix(tcol, bedC, bedW * 0.9);
        // ground occlusion around trunks / rocks and shade under crowns
        vec2 aoUV = (vWP.xz - uAORect.xy) * uAORect.z;
        vec2 aoE = smoothstep(vec2(0.0), vec2(0.06), aoUV) * smoothstep(vec2(1.0), vec2(0.94), aoUV);
        float aoIn = aoE.x * aoE.y * uAORect.w;
        vec3 aoS = texture2D(tGroundAO, clamp(aoUV, 0.0, 1.0)).rgb * aoIn;
        float contact = clamp(aoS.r, 0.0, 1.0);
        float gCanopy = clamp(aoS.g * 1.7 + bio.y * 0.35 * (1.0 - aoIn), 0.0, 1.0);
        tcol *= 1.0 - contact * 0.55;
        tcol *= 1.0 - gCanopy * 0.1;
        // wetness and rain puddles on flat ground
        float flatG = smoothstep(0.06, 0.01, slope);
        float puddle = clamp(uWetness * 1.4 - 0.3, 0.0, 1.0) * smoothstep(0.6, 0.68, vnoise(uv * 0.11 + 2.0) * 0.7 + vnoise(uv * 0.5) * 0.3) * flatG * (1.0 - w.z) * (1.0 - w.w) * (1.0 - bedW);
        float wet = clamp(uWetness * (0.6 + 0.4 * n2) + w.w * 0.5 + bedW, 0.0, 1.0);
        tcol *= mix(1.0, 0.6, wet);
        tcol = mix(tcol, tcol * 0.4 + vec3(0.02, 0.022, 0.02), puddle);
        diffuseColor.rgb = tcol;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(mix(0.96, 0.42, wet), 0.05, puddle);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float bh = lum(tcol) * 3.0;
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(bh), dhy = dFdy(bh);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          float bs = 0.018 * (1.0 - smoothstep(8.0, 30.0, length(vViewPosition))) * (1.0 - puddle);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad * bs);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // dappled sun flecks under the canopy: leaf gaps projected along the sun, drifting with the wind
          vec2 sp = vWP.xz - uSunDir.xz / max(uSunDir.y, 0.25) * 9.0;
          vec2 wo = uWind * uTime * 0.35;
          float ck = vnoise(sp * 0.55 + wo) * 0.6 + vnoise(sp * 1.6 - wo * 1.7) * 0.4;
          ck = smoothstep(0.36, 0.64, ck);
          float dap = mix(1.0, 0.42 + ck * 1.0, gCanopy * 0.62);
          reflectedLight.directDiffuse *= dap; reflectedLight.directSpecular *= dap;
          reflectedLight.indirectDiffuse *= 1.0 - gCanopy * 0.16 - contact * 0.42;
          if (bedW > 0.01) {   // sunlight focused by the ripples above dances on the bed
            float bd = max(-vField, 0.0);
            vec2 cp = vWP.xz * 1.15 + uWind * uTime * 0.25;
            vec2 c1 = cell3(vec3(cp, uTime * 0.45)), c2 = cell3(vec3(cp * 1.7 + 4.0, uTime * 0.6 + 2.0));
            float ca = (1.0 - smoothstep(0.0, 0.09, c1.y - c1.x)) * 0.65 + (1.0 - smoothstep(0.0, 0.07, c2.y - c2.x)) * 0.45;
            reflectedLight.directDiffuse *= 1.0 + ca * 1.6 * bedW * exp(-bd * 0.7) * (1.0 - uWetness * 0.7);
          }
        }`);
  });
  return m;
}

// The painted look's ground (docs/art-direction.md): the season's colours laid in broad patches with two-tone
// brush strokes, crisp edges between ground types, a scatter of painted fallen leaves near the camera, cool
// (never black) contact shadows, and sun flecks under the canopy. Same attributes as the realistic shader.
export function createPaintedTerrainMaterial(far, lq = false) {
  const m = toon({
    key: (far ? 'terrain-far' : 'terrain') + (lq ? '-lq' : ''), rim: 0, patch: (s) => {
      Object.assign(s.uniforms, PU);
      s.uniforms.uNearRect = m.userData.near;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aSplat; attribute vec4 aBio; attribute float aField;
          varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
          vSplat = aSplat; vBio = aBio; vField = aField;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          ${lq ? '#define TERRAIN_LQ' : ''}
          ${NOISE_GLSL}
          uniform sampler2D tGroundAO; uniform vec4 uNearRect, uAORect;
          uniform float uSeasonGreen, uWetness, uDry, uTime; uniform vec2 uWind; uniform vec3 uSunDir;
          uniform vec3 uGround, uGrassRoot, uGrassTip, uRock, uSand, uLaterite, uRiver;
          varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;
          float aaStep(float e, float x) { float w = fwidth(x) * 0.75 + 1e-4; return smoothstep(e - w, e + w, x); }
          // one fallen leaf per lucky cell: a flat painted oval in teak-fall colours
          vec4 leafDot(vec2 p, float dens, float dry) {
            vec2 c = floor(p), f = fract(p) - 0.5;
            if (hash12(c * 1.31) > dens) return vec4(0.0);
            vec2 o = (vec2(hash12(c + 1.7), hash12(c + 3.1)) - 0.5) * 0.36;
            float a = hash12(c + 5.3) * 6.2832, cs = cos(a), sn = sin(a);
            vec2 q = f - o; q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
            float e = length(q * vec2(1.0, 2.1));
            float h = hash12(c + 9.7);
            vec3 col = h < 0.35 ? vec3(0.62, 0.26, 0.07) : h < 0.65 ? vec3(0.7, 0.45, 0.1) : h < 0.85 ? vec3(0.4, 0.17, 0.08) : vec3(0.42, 0.27, 0.12);
            col *= (0.8 + 0.4 * hash12(c + 13.1)) * mix(vec3(1.0), vec3(1.15, 1.05, 0.8), dry);
            return vec4(col, 1.0 - aaStep(0.17, e));
          }`)
        .replace('#include <map_fragment>', `
          ${far ? 'if (vWP.x > uNearRect.x && vWP.x < uNearRect.z && vWP.z > uNearRect.y && vWP.z < uNearRect.w) discard;' : ''}
          vec2 uv = vWP.xz;
          float slope = 1.0 - vWN.y, camD = length(vViewPosition);
          vec4 bio = vBio;   // x moisture, y canopy, z laterite, w black soil
          float fieldW = max(vField, 0.0), bedW = smoothstep(0.0, 0.6, -vField);
          float big = fbm2(uv * 0.016), mid = vnoise(uv * 0.09 + 3.0);
          // brush strokes: noise stretched along a slowly turning direction, cut into a light and a dark tone
          float ang = vnoise(uv * 0.015 + 7.0) * 6.2832; vec2 sdir = vec2(cos(ang), sin(ang));
          vec2 su = vec2(dot(uv, sdir), dot(uv, vec2(-sdir.y, sdir.x)));
          float st = vnoise(vec2(su.x * 0.45, su.y * 0.9)) * 0.6 + vnoise(uv * 0.5 + 4.0) * 0.4;
          float strokeW = 1.0 - smoothstep(60.0, 160.0, camD);
          float sL = aaStep(0.66, st) * strokeW, sD = aaStep(0.68, 1.0 - st) * strokeW;
          // forest floor: the season's ground colour in warm and cool patches, red laterite on ridges and
          // slopes, dark black-cotton soil on the flats
          vec3 gnd = uGround * mix(vec3(0.82, 0.78, 0.88), vec3(1.08, 1.0, 0.9), smoothstep(0.35, 0.65, big));
          gnd = mix(gnd, gnd * vec3(1.14, 1.08, 0.94), sL * 0.4);
          gnd = mix(gnd, gnd * vec3(0.86, 0.84, 0.92), sD * 0.35);
          float latW = clamp(bio.z + slope * 1.2 - 0.25, 0.0, 1.0);
          gnd = mix(gnd, uLaterite * (0.85 + 0.25 * mid), smoothstep(0.45, 0.85, latW) * 0.6);
          gnd = mix(gnd, uGround * vec3(0.5, 0.48, 0.52), smoothstep(0.35, 0.7, bio.w) * (1.0 - latW) * 0.6);
          vec3 grass = mix(uGrassRoot, uGrassTip, 0.25 + 0.5 * smoothstep(0.3, 0.7, big + (mid - 0.5) * 0.4));
          grass = mix(grass, grass * vec3(1.12, 1.1, 0.9), sL * 0.7);
          grass = mix(grass, grass * vec3(0.82, 0.86, 0.94), sD * 0.6);
          vec3 rock = uRock * (0.8 + 0.3 * mid) * mix(vec3(1.0), vec3(1.08, 1.0, 0.9), sL);
          vec3 sand = uSand * (0.9 + 0.15 * big);
          // sharpened weights: patches meet at a painted edge, not a photographic blend
          vec4 w = vSplat;
          w.z = max(w.z, smoothstep(0.42, 0.6, slope + (mid - 0.5) * 0.15));
          w.y *= 0.7 + 0.6 * vnoise(uv * 0.05);
          w = w * w * w; w /= (w.x + w.y + w.z + w.w + 1e-5);
          vec3 tcol = gnd * w.x + grass * w.y + rock * w.z + sand * w.w;
          #ifndef TERRAIN_LQ
          float nf = 1.0 - smoothstep(18.0, 34.0, camD);
          if (nf > 0.001) {
            float dens = (0.22 + 0.3 * bio.y) * w.x * (1.0 - bedW) * (1.0 - fieldW);
            vec4 L1 = leafDot(uv / 0.85, dens, uDry), L2 = leafDot(uv / 1.15 + 17.3, dens * 0.8, uDry);
            tcol = mix(tcol, L1.rgb, L1.a * nf); tcol = mix(tcol, L2.rgb, L2.a * nf);
          }
          #endif
          vec3 fieldC = mix(uGround * vec3(1.0, 0.88, 0.7), uGrassRoot * 1.15, uSeasonGreen) * (0.88 + 0.22 * aaStep(0.5, 0.5 + 0.5 * sin(uv.x * 2.2)));
          tcol = mix(tcol, fieldC, fieldW * 0.85);
          float burn = uDry * smoothstep(0.64, 0.7, fbm2(uv * 0.006 + 9.0)) * bio.y * w.x * (1.0 - bedW) * (1.0 - fieldW);
          tcol = mix(tcol, vec3(0.1, 0.09, 0.1), burn * 0.7);
          vec3 bedC = mix(uRiver * vec3(0.35, 0.45, 0.4), uRock * 0.5, aaStep(0.55, vnoise(uv * 0.6)) * 0.6);
          tcol = mix(tcol, bedC, bedW * 0.9);
          // contact shadow round trunks and rocks, cool rather than black; canopy weight for the sun flecks
          vec2 aoUV = (vWP.xz - uAORect.xy) * uAORect.z;
          vec2 aoE = smoothstep(vec2(0.0), vec2(0.06), aoUV) * smoothstep(vec2(1.0), vec2(0.94), aoUV);
          float aoIn = aoE.x * aoE.y * uAORect.w;
          vec3 aoS = texture2D(tGroundAO, clamp(aoUV, 0.0, 1.0)).rgb * aoIn;
          float contact = clamp(aoS.r, 0.0, 1.0);
          float gCanopy = clamp(aoS.g * 1.7 + bio.y * 0.35 * (1.0 - aoIn), 0.0, 1.0);
          tcol = mix(tcol, tcol * vec3(0.55, 0.55, 0.8), contact * 0.7);
          float wet = clamp(uWetness * 0.7 + bedW, 0.0, 1.0);
          tcol *= mix(1.0, 0.72, wet);
          float puddle = clamp(uWetness * 1.4 - 0.3, 0.0, 1.0) * aaStep(0.64, vnoise(uv * 0.11 + 2.0) * 0.7 + vnoise(uv * 0.5) * 0.3) * smoothstep(0.06, 0.01, slope) * w.x * (1.0 - bedW);
          tcol = mix(tcol, vec3(0.2, 0.28, 0.4), puddle * 0.8);
          diffuseColor.rgb = tcol;
        `)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // sun flecks under the canopy: soft-edged painted patches, drifting slowly with the wind
            vec2 sp = vWP.xz - uSunDir.xz / max(uSunDir.y, 0.25) * 9.0;
            vec2 wo = uWind * uTime * 0.12;
            float ck = vnoise(sp * 0.4 + wo) * 0.6 + vnoise(sp * 1.2 - wo * 1.5) * 0.4;
            reflectedLight.directDiffuse *= mix(1.0, smoothstep(0.47, 0.56, ck), gCanopy * 0.7);
            reflectedLight.indirectDiffuse *= 1.0 - contact * 0.3;
          }`);
    },
  });
  m.userData.near = { value: new THREE.Vector4(0, 0, 0, 0) };
  return m;
}

export class TerrainManager {
  constructor(scene, tex, quality) {
    this.scene = scene; this.q = quality;
    const lq = quality.name === 'Low';
    this.mat = PAINTED ? createPaintedTerrainMaterial(false, lq) : createTerrainMaterial(tex, false, lq);
    this.farMat = PAINTED ? createPaintedTerrainMaterial(true, lq) : createTerrainMaterial(tex, true, lq);
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
  lodFor(d) { return d <= 1 ? (this.q.name === 'Low' ? 64 : 128) : d <= 2 ? 32 : 16; }
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
      if (this.job && !(want.has(this.job.w.k) && want.get(this.job.w.k).segs === this.job.w.segs)) this.job = null;
      for (const [k, w] of want) {
        if (this.job && this.job.w.k === k) continue;
        const c = this.chunks.get(k);
        if (!c || c.segs !== w.segs) this.queue.push({ k, ...w });
      }
      this.queue.sort((a, b) => a.d - b.d);
    }
    // build chunks a slice at a time inside the frame budget (a forced update finishes everything now)
    const t0 = performance.now();
    while ((this.job || this.queue.length) && (force || performance.now() - t0 < budgetMs)) {
      if (!this.job) { const w = this.queue.shift(); this.job = { w, it: buildGridGen(w.kx * CHUNK, w.kz * CHUNK, CHUNK, w.segs, height, true) }; }
      const r = this.job.it.next();
      if (r.done) { this.buildChunk(this.job.w, r.value); this.job = null; }
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
  buildChunk(w, res = buildGridGeometry(w.kx * CHUNK, w.kz * CHUNK, CHUNK, w.segs, height, true)) {
    const old = this.chunks.get(w.k);
    const mesh = new THREE.Mesh(res.geometry, this.mat);
    mesh.receiveShadow = true; mesh.castShadow = false;
    this.scene.add(mesh);
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    this.chunks.set(w.k, { mesh, segs: w.segs });
    heightCache.set(w.k, { x0: w.kx * CHUNK, z0: w.kz * CHUNK, step: res.step, n: w.segs, h: res.hgrid });
  }
  pending() { return this.queue.length + (this.job ? 1 : 0); }
}

// Map image for the in-game map: an illustrated parchment map in the painted palette. Forest, meadow, rock,
// bamboo, fields and village as flat washes, soft hill shading from the north-west, a contour every 15 m, and
// water in teal with a darker edge.
export function renderMapCanvas(size = 384) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size);
  const step = (HALF * 2) / size;
  const hs = new Float32Array(size * size), wet = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -HALF + i * step, z = -HALF + j * step, h = height(x, z);
    hs[j * size + i] = h; wet[j * size + i] = waterAt(x, z) > h ? 1 : 0;
  }
  const mix = (c, d, k) => { c[0] += (d[0] - c[0]) * k; c[1] += (d[1] - c[1]) * k; c[2] += (d[2] - c[2]) * k; };
  const c = [0, 0, 0];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -HALF + i * step, z = -HALF + j * step, k = j * size + i, h = hs[k];
    const o = k * 4;
    if (wet[k]) {
      const edge = (i > 0 && !wet[k - 1]) || (i < size - 1 && !wet[k + 1]) || (j > 0 && !wet[k - size]) || (j < size - 1 && !wet[k + size]);
      const w = edge ? [52, 118, 138] : [96, 178, 186];
      img.data[o] = w[0]; img.data[o + 1] = w[1]; img.data[o + 2] = w[2]; img.data[o + 3] = 255; continue;
    }
    const b = biomeAt(x, z);
    c[0] = 214; c[1] = 192; c[2] = 146;                                   // bare earth on parchment
    mix(c, [124, 160, 88], clamp(b.teak * 1.2, 0, 1));                  // teak forest
    mix(c, [98, 138, 72], clamp((b.teak - 0.6) * 1.5, 0, 1) * 0.6);     // dense canopy
    mix(c, [206, 198, 124], clamp(b.grass, 0, 1) * 0.85);               // meadow
    mix(c, [142, 178, 98], clamp(b.bamboo, 0, 1) * 0.7);                // bamboo
    mix(c, [186, 172, 156], clamp(b.rock, 0, 1));                       // rock
    mix(c, [216, 192, 112], clamp(b.field, 0, 1) * 0.8);                // fields
    mix(c, [224, 190, 146], clamp(b.village, 0, 1) * 0.8);              // village
    const hl = hs[j * size + Math.max(0, i - 1)], hu = hs[Math.max(0, j - 1) * size + i];
    const shade = clamp(1 + (h - hl) * 0.045 + (h - hu) * 0.045, 0.82, 1.14);
    const ci = Math.floor(h / 15), contour = ci !== Math.floor(hl / 15) || ci !== Math.floor(hu / 15);
    const grain = 1 + (Math.random() - 0.5) * 0.04;
    for (let q = 0; q < 3; q++) img.data[o + q] = clamp(c[q] * shade * grain * (contour ? 0.86 : 1), 0, 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// Closest drinking spot: a waterhole edge or the river bank, as a point on dry ground just at the water line.
export function nearestWaterPoint(p) {
  let best = null, bd = Infinity;
  for (const w of WATERHOLES) {
    const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz) || 1;
    const e = d - (w.r - 2); if (e < bd) { bd = e; best = { x: w.x + dx / d * (w.r - 2), z: w.z + dz / d * (w.r - 2) }; }
  }
  const rx = riverX(p.z), side = p.x > rx ? 1 : -1, dr = Math.abs(p.x - rx) - (RIVER_W - 2);
  if (dr < bd && p.z < RIVER_END_Z) { bd = dr; best = { x: rx + side * (RIVER_W - 2), z: p.z }; }
  return best ? new THREE.Vector3(best.x, 0, best.z) : null;
}


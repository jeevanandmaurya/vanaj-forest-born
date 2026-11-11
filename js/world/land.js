// The land itself, as arithmetic: the height of the ground anywhere (Satpura hills, the Pench, Totladoh, the plateau,
// the meadow, the waterholes, the village), what grows where, and the arrays of a ground chunk built from them.
// Nothing here touches the renderer or the page, so the same file runs on a worker (land-worker.js): the ground he is
// running toward is worked out on another core, and the frame that draws the game never waits on it.
import { Simplex, fbm, ridged, smoothstep, clamp, lerp } from '../core/noise.js';

// how far the water stands above its winter level (the weather sets it; on a worker it comes with each job)
export const LAND = { rise: 0 };

export const S1 = new Simplex(1337), S2 = new Simplex(7331), S3 = new Simplex(4242), S4 = new Simplex(9001), S5 = new Simplex(555);

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
export let RIVER_END_Z = 1300;
for (let z = 1000; z < 1900; z += 5) { if (lakeE(riverX(z), z) < 0.85) { RIVER_END_Z = z; break; } }


export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

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

export function plateauMask(x, z) {
  const d = Math.hypot(x - ROCKS.x, z - ROCKS.z) + 70 * S1.noise2(x / 160, z / 160);
  return 1 - smoothstep(ROCKS.r * 0.45, ROCKS.r, d);
}
export function maidanMask(x, z) {
  const d = Math.hypot((x - MAIDAN.x) * 0.85, z - MAIDAN.z) + 80 * S2.noise2(x / 200, z / 200);
  return 1 - smoothstep(MAIDAN.r * 0.5, MAIDAN.r, d);
}
export function villageMask(x, z) {
  const d = Math.hypot(x - VILLAGE.x, z - VILLAGE.z) + 30 * S3.noise2(x / 90, z / 90);
  return 1 - smoothstep(VILLAGE.r * 0.55, VILLAGE.r, d);
}
export function termiteMask(x, z) {
  const d = Math.hypot(x - TERMITE.x, z - TERMITE.z) + 60 * S4.noise2(x / 150, z / 150);
  return 1 - smoothstep(TERMITE.r * 0.4, TERMITE.r, d);
}

export function baseHeight(x, z) {
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

export let VILLAGE_H = 40, MAIDAN_H = 40;
export function heightNoWater(x, z) {
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
  const rise = LAND.rise;
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
export const B = { rock: 0, grass: 0, bamboo: 0, riparian: 0, village: 0, field: 0, teak: 0, mixed: 0, termite: 0, open: 0, moist: 0, sand: 0, dRiver: 0 };
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
export const heightCache = new Map(); // key -> {x0,z0,step,n,h:Float32Array}
export const ckey = (cx, cz) => cx * 100003 + cz;

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

export function splatFor(x, z, h, ny, out, o, bio) {
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
export function buildGridRaw(x0, z0, size, n, analytic, skirt, sink = 0) {
  const it = buildGridGen(x0, z0, size, n, analytic, skirt, sink); let r; do r = it.next(); while (!r.done); return r.value;
}
export function* buildGridGen(x0, z0, size, n, analytic, skirt, sink = 0) {
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
  // (plain arrays: this runs on a worker as well as here, and the worker hands them over without copying)
  return { pos: pos.slice(0, v * 3), nor: nor.slice(0, v * 3), spl: spl.slice(0, v * 4), bio: bio.slice(0, v * 4), fld: fld.slice(0, v), idx: v < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), hgrid, step };
}


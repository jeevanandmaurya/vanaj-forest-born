// Seeded noise utilities: PRNG, hashing, 2D simplex, fbm, ridged, tileable value noise.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

export class Simplex {
  constructor(seed = 1) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pm12[i] = this.perm[i] % 12; }
  }
  noise2(xin, yin) {
    const perm = this.perm, pm12 = this.pm12;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm12[ii + perm[jj]]; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1]]; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm12[ii + 1 + perm[jj + 1]]; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  }
}

export function fbm(S, x, z, oct = 4, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * S.noise2(x * f + o * 17.3, z * f - o * 9.1);
    norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}

export function ridged(S, x, z, oct = 4) {
  let a = 0.5, f = 1, sum = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(S.noise2(x * f + o * 31.7, z * f + o * 11.3));
    n *= n; n *= w; w = Math.min(1, n * 2);
    sum += n * a; a *= 0.5; f *= 2.1;
  }
  return sum;
}

// Tileable value noise for texture generation (period in lattice cells)
export function makeTileNoise(seed, period) {
  const r = mulberry32(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  return function (u, v) { // u,v in [0, period)
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % period) + period) % period, ya = ((y0 % period) + period) % period;
    const xb = (xa + 1) % period, yb = (ya + 1) % period;
    const a = lat[ya * period + xa], b = lat[ya * period + xb];
    const c = lat[yb * period + xa], d = lat[yb * period + xb];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

export function tileFbm(noises, u, v, size) {
  // noises: array of tile-noise fns with increasing period; u,v in [0,1)
  let sum = 0, amp = 1, norm = 0;
  for (let i = 0; i < noises.length; i++) {
    const p = noises[i].period;
    sum += noises[i].fn(u * p, v * p) * amp; norm += amp; amp *= 0.5;
  }
  return sum / norm;
}

export function makeFbmTile(seed, basePeriod, octaves) {
  const arr = [];
  for (let i = 0; i < octaves; i++) {
    const p = basePeriod * (1 << i);
    arr.push({ period: p, fn: makeTileNoise(seed + i * 101, p) });
  }
  return (u, v) => tileFbm(arr, u, v);
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent smoothing (Daniel Holden, "Spring-It-On"): the blend factor that closes half the gap in
// `halflife` seconds, whatever dt is. lerp(x, goal, damp(h, dt)) replaces lerp(x, goal, min(1, k * dt)).
export const damp = (halflife, dt) => 1 - Math.pow(2, -dt / Math.max(halflife, 1e-5));
// critically damped spring toward a goal (exact for any dt); s = { x, v }
export function spring(s, goal, halflife, dt) {
  const y = (4 * 0.69314718056) / (halflife + 1e-5) / 2, j0 = s.x - goal, j1 = s.v + j0 * y, e = Math.exp(-y * dt);
  s.x = e * (j0 + j1 * dt) + goal; s.v = e * (s.v - j1 * y * dt);
  return s.x;
}
export function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

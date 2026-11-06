// Procedural Pench flora: branching tree generator per species, instanced LOD vegetation manager,
// seasonal foliage (leaf fall, palash/mahua flowering), wind, grass tufts, trunk collision and langur perches.
import * as THREE from 'three';
import { mulberry32, hash2, clamp, smoothstep } from '../core/noise.js';
import { G, patch, WIND_VERTEX, NOISE_GLSL } from '../core/shaderlib.js';
import { height, biomeAt, waterAt, CHUNK } from './terrain.js';

// ------------------------------------------------------------------ geometry builder
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.r = []; this.i = []; }
  vert(x, y, z, nx, ny, nz, u, v, cr, cg, cb, w, r) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(cr, cg, cb); this.w.push(w); this.r.push(r);
    return this.p.length / 3 - 1;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 1));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.r, 1));
    g.setIndex(this.i);
    if (this.p.length) g.computeBoundingSphere();
    return g;
  }
}

function tube(gb, pts, rads, radial, windFn, rnd, uRep, colMul = 1) {
  const n = pts.length; const base = gb.p.length / 3; let len = 0;
  const ur = uRep || Math.max(1, Math.round(2 * Math.PI * rads[0] / 1.0));
  for (let s = 0; s < n; s++) {
    const p = pts[s], pn = pts[Math.min(n - 1, s + 1)], pp = pts[Math.max(0, s - 1)];
    let tx = pn[0] - pp[0], ty = pn[1] - pp[1], tz = pn[2] - pp[2];
    let tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let rx = 0, ry = 1, rz = 0; if (Math.abs(ty) > 0.95) { rx = 1; ry = 0; }
    let Nx = ty * rz - tz * ry, Ny = tz * rx - tx * rz, Nz = tx * ry - ty * rx;
    const nl = Math.hypot(Nx, Ny, Nz) || 1; Nx /= nl; Ny /= nl; Nz /= nl;
    const Bx = Ny * tz - Nz * ty, By = Nz * tx - Nx * tz, Bz = Nx * ty - Ny * tx;
    if (s > 0) len += Math.hypot(p[0] - pts[s - 1][0], p[1] - pts[s - 1][1], p[2] - pts[s - 1][2]);
    const r = rads[s];
    const wv = windFn(p);
    const ao = colMul * (p[1] < 0.5 ? 0.7 : 1);
    for (let k = 0; k <= radial; k++) {
      const a = k / radial * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const dx = Nx * c + Bx * sn, dy = Ny * c + By * sn, dz = Nz * c + Bz * sn;
      gb.vert(p[0] + dx * r, p[1] + dy * r, p[2] + dz * r, dx, dy, dz, k / radial * ur, len / 2.4, ao, ao, ao, wv, rnd);
    }
  }
  for (let s = 0; s < n - 1; s++) for (let k = 0; k < radial; k++) {
    const a = base + s * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1;
    gb.i.push(a, c, b, b, c, d);
  }
}

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _rt = new THREE.Vector3(), _nm = new THREE.Vector3();
function card(gb, C, up, w, h, crownC, crownR, wind, rnd, rng, tint) {
  // right vector perpendicular to up, random twist
  _rt.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).cross(up).normalize();
  const hw = w / 2;
  const corners = [[-hw, 0], [hw, 0], [hw, h], [-hw, h]];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const base = gb.p.length / 3;
  for (let k = 0; k < 4; k++) {
    const [a, b] = corners[k];
    const x = C.x + _rt.x * a + up.x * b, y = C.y + _rt.y * a + up.y * b, z = C.z + _rt.z * a + up.z * b;
    _nm.set(x - crownC.x, (y - crownC.y) * 0.8 + crownR * 0.35, z - crownC.z).normalize();
    const d = Math.min(1, Math.hypot(x - crownC.x, (y - crownC.y) * 1.2, z - crownC.z) / crownR);
    const ao = (0.34 + 0.66 * Math.pow(d, 0.9)) * (0.85 + 0.25 * clamp((y - crownC.y) / crownR + 0.5, 0, 1)) * (b === 0 ? 0.85 : 1.05);
    gb.vert(x, y, z, _nm.x, _nm.y, _nm.z, uvs[k][0], uvs[k][1], ao * tint[0], ao * tint[1], ao * tint[2], wind * (b === 0 ? 0.7 : 1.0), rnd);
  }
  gb.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// ------------------------------------------------------------------ species specs
const SPEC = {
  teak: { H: [15, 21], r0: [0.28, 0.4], trunkFrac: 0.5, nB: [7, 10], ang: [0.65, 1.15], bLen: 1.0, crownR: 5.2, cardS: [2.4, 3.1], perTip: 3, sub: 2, leaf: 'teak', bark: 'teak', gnarl: 0.12, lean: 0.05, tint: [1, 1, 1] },
  mahua: { H: [9, 13], r0: [0.45, 0.6], trunkFrac: 0.32, nB: [6, 8], ang: [0.85, 1.35], bLen: 1.15, crownR: 6.5, cardS: [1.6, 2.0], perTip: 4, sub: 3, leaf: 'mahua', bark: 'mahua', gnarl: 0.22, lean: 0.06, tint: [0.95, 1, 0.95] },
  saja: { H: [17, 24], r0: [0.32, 0.42], trunkFrac: 0.62, nB: [5, 7], ang: [0.5, 0.9], bLen: 0.85, crownR: 4.2, cardS: [1.8, 2.2], perTip: 3, sub: 2, leaf: 'small', bark: 'saja', gnarl: 0.08, lean: 0.03, tint: [0.92, 1, 0.9] },
  kulu: { H: [7, 12], r0: [0.22, 0.32], trunkFrac: 0.42, nB: [4, 5], ang: [0.6, 1.1], bLen: 0.9, crownR: 4.0, cardS: [1.5, 1.8], perTip: 2, sub: 2, leaf: 'kulu', bark: 'kulu', gnarl: 0.4, lean: 0.25, tint: [1, 1, 1] },
  palash: { H: [5, 8.5], r0: [0.16, 0.24], trunkFrac: 0.38, nB: [4, 6], ang: [0.7, 1.25], bLen: 0.95, crownR: 3.4, cardS: [1.3, 1.6], perTip: 3, sub: 2, leaf: 'palash', bark: 'generic', gnarl: 0.45, lean: 0.15, tint: [1, 1, 1] },
  small: { H: [7, 11], r0: [0.2, 0.3], trunkFrac: 0.42, nB: [5, 7], ang: [0.7, 1.15], bLen: 0.9, crownR: 4.0, cardS: [1.5, 1.8], perTip: 4, sub: 2, leaf: 'small', bark: 'generic', gnarl: 0.2, lean: 0.06, tint: [1, 1, 1] },
  arjun: { H: [15, 20], r0: [0.5, 0.65], trunkFrac: 0.45, nB: [7, 9], ang: [0.8, 1.25], bLen: 1.1, crownR: 7.0, cardS: [2.0, 2.4], perTip: 4, sub: 3, leaf: 'small', bark: 'banyan', gnarl: 0.15, lean: 0.05, tint: [0.9, 1.0, 0.9] },
  dead: { H: [10, 16], r0: [0.25, 0.35], trunkFrac: 0.5, nB: [4, 6], ang: [0.6, 1.1], bLen: 0.6, crownR: 4.0, cardS: [0, 0], perTip: 0, sub: 1, leaf: null, bark: 'teak', gnarl: 0.25, lean: 0.1, tint: [1, 1, 1] },
};

function windTrunk(H) { return (p) => Math.pow(clamp(p[1] / H, 0, 1), 2.2) * 0.22; }

function growBranch(gb, leaves, rng, start, dir, L, r0, depth, spec, ctx) {
  const segs = depth === 0 ? 6 : 4;
  const pts = [], rads = [];
  const d = dir.clone();
  const p = start.clone();
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    pts.push([p.x, p.y, p.z]); rads.push(Math.max(0.018, r0 * (1 - 0.82 * t)));
    d.x += (rng() - 0.5) * spec.gnarl; d.z += (rng() - 0.5) * spec.gnarl; d.y += 0.07 + (rng() - 0.5) * spec.gnarl * 0.5;
    d.normalize();
    p.addScaledVector(d, L / segs);
  }
  tube(gb, pts, rads, depth === 0 ? 6 : 4, (q) => 0.18 + 0.5 * clamp((q[1] - ctx.H * 0.4) / ctx.H, 0, 1) * (depth + 1) * 0.5, rng(), 1);
  // sub-branches
  if (depth < 1) {
    for (let k = 0; k < spec.sub; k++) {
      const t = 0.45 + rng() * 0.45;
      const idx = Math.min(segs, Math.round(t * segs));
      const sp = new THREE.Vector3(...pts[idx]);
      const sd = dir.clone().add(new THREE.Vector3(rng() - 0.5, rng() * 0.6, rng() - 0.5).multiplyScalar(1.3)).normalize();
      growBranch(gb, leaves, rng, sp, sd, L * (0.45 + rng() * 0.25), rads[idx] * 0.7, depth + 1, spec, ctx);
    }
  }
  // leaf tips
  if (spec.perTip > 0) {
    const tip = new THREE.Vector3(...pts[segs]);
    const n = depth === 0 ? spec.perTip : spec.perTip;
    for (let k = 0; k < n; k++) {
      const off = new THREE.Vector3((rng() - 0.5), (rng() - 0.3), (rng() - 0.5)).multiplyScalar(ctx.cardS * 0.7);
      leaves.push({ C: tip.clone().add(off), base: dir.clone() });
    }
    // along outer half
    for (let s = Math.floor(segs * 0.5); s < segs; s++) {
      if (rng() < 0.6) leaves.push({ C: new THREE.Vector3(...pts[s]), base: dir.clone() });
    }
  }
}

function buildGeneric(specName, seed) {
  const spec = SPEC[specName], rng = mulberry32(seed);
  const gb = new GB(), leavesG = new GB();
  const H = spec.H[0] + rng() * (spec.H[1] - spec.H[0]);
  const r0 = spec.r0[0] + rng() * (spec.r0[1] - spec.r0[0]);
  const cardS = spec.cardS[0] + rng() * (spec.cardS[1] - spec.cardS[0]);
  const ctx = { H, cardS };
  const lx = (rng() - 0.5) * 2 * spec.lean, lz = (rng() - 0.5) * 2 * spec.lean;
  const tp = [], tr = [];
  const segs = 12;
  const trunkTop = H * (specName === 'mahua' ? 0.62 : 0.92);
  let wx = 0, wz = 0;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, y = -1.6 + t * (trunkTop + 1.6);
    wx += (rng() - 0.5) * spec.gnarl * 0.6; wz += (rng() - 0.5) * spec.gnarl * 0.6;
    tp.push([lx * y + wx, y, lz * y + wz]);
    const tt = clamp(y / trunkTop, 0, 1);
    tr.push(r0 * (1 - 0.72 * tt) * (1 + 0.55 * Math.exp(-Math.max(0, y) * 1.6)));
  }
  tube(gb, tp, tr, 10, windTrunk(H), rng(), null);
  // branches
  const leaves = [];
  const nB = spec.nB[0] + Math.floor(rng() * (spec.nB[1] - spec.nB[0] + 1));
  let phi = rng() * 6.28;
  for (let b = 0; b < nB; b++) {
    const t = spec.trunkFrac + (1 - spec.trunkFrac) * (b / nB) * 0.95 + rng() * 0.05;
    const idx = Math.min(segs, Math.round(t * segs));
    const sp = new THREE.Vector3(...tp[idx]);
    phi += 2.39996 + (rng() - 0.5) * 0.4;
    const th = spec.ang[0] + rng() * (spec.ang[1] - spec.ang[0]);
    const dir = new THREE.Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
    const L = spec.crownR * spec.bLen * (0.65 + rng() * 0.5) * (1 - (t - spec.trunkFrac) * 0.55);
    growBranch(gb, leaves, rng, sp, dir, L, tr[idx] * 0.6, 0, spec, ctx);
  }
  // top leader
  if (spec.perTip > 0) growBranch(gb, leaves, rng, new THREE.Vector3(...tp[segs]), new THREE.Vector3(0, 1, 0), spec.crownR * 0.5, tr[segs] * 0.8, 0, spec, ctx);
  // crown centre
  const crownC = new THREE.Vector3(); for (const l of leaves) crownC.add(l.C); if (leaves.length) crownC.multiplyScalar(1 / leaves.length);
  let crownR = 0.1; for (const l of leaves) crownR = Math.max(crownR, l.C.distanceTo(crownC)); crownR *= 0.85;
  for (const l of leaves) {
    const out = l.C.clone().sub(crownC).normalize();
    const up = out.multiplyScalar(0.8).add(new THREE.Vector3(0, 0.9, 0)).add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.9)).normalize();
    const s = cardS * (0.75 + rng() * 0.5);
    card(leavesG, l.C, up, s, s, crownC, crownR, 0.6 + 0.4 * clamp((l.C.y - H * 0.4) / H, 0, 1), rng(), rng, spec.tint);
  }
  // LOD1
  const lb = new GB(), ll = new GB();
  const tp1 = [tp[0], tp[4], tp[8], tp[12]], tr1 = [tr[0], tr[4], tr[8], tr[12]];
  tube(lb, tp1, tr1, 5, windTrunk(H), 0.5, null);
  if (leaves.length) {
    const k = Math.max(1, Math.round(leaves.length / 9));
    for (let i = 0; i < leaves.length; i += k) {
      const l = leaves[i];
      const out = l.C.clone().sub(crownC).normalize();
      const up = out.multiplyScalar(0.6).add(new THREE.Vector3(0, 1, 0)).normalize();
      const s = cardS * Math.sqrt(k) * 1.05;
      card(ll, l.C.clone().addScaledVector(up, -s * 0.3), up, s, s, crownC, crownR, 0.5, rng(), rng, spec.tint);
    }
  }
  return { bark: gb.geo(), leaf: leaves.length ? leavesG.geo() : null, bark1: lb.geo(), leaf1: leaves.length ? ll.geo() : null, H, trunkR: r0 * 1.2, crownY: crownC.y, crownR, barkKind: spec.bark, leafKind: spec.leaf };
}

function buildBamboo(seed) {
  const rng = mulberry32(seed); const gb = new GB(), lg = new GB();
  const N = 22 + Math.floor(rng() * 14);
  const lb = new GB(), ll = new GB();
  const crownC = new THREE.Vector3(0, 7, 0);
  let maxH = 0;
  for (let c = 0; c < N; c++) {
    const a = rng() * 6.28, rad = Math.sqrt(rng()) * 1.1;
    const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
    const H = 8 + rng() * 6; maxH = Math.max(maxH, H);
    const tilt = 0.08 + rad * 0.18 + rng() * 0.08;
    const pts = [], rads = [];
    const r0 = 0.035 + rng() * 0.025;
    for (let s = 0; s <= 8; s++) {
      const t = s / 8; const bend = tilt * t + 0.35 * t * t * (0.6 + rng() * 0.2);
      pts.push([bx + Math.cos(a) * bend * H * 0.5, -1 + t * (H + 1) * (1 - 0.15 * t * t), bz + Math.sin(a) * bend * H * 0.5]);
      rads.push(r0 * (1 - 0.5 * t));
    }
    tube(gb, pts, rads, 5, (p) => clamp(p[1] / H, 0, 1) ** 1.6 * 0.9, rng(), 1);
    if (c % 3 === 0) tube(lb, [pts[0], pts[4], pts[8]], [rads[0], rads[4], rads[8]], 3, (p) => clamp(p[1] / H, 0, 1) ** 1.6 * 0.9, 0.5, 1);
    for (let s = 3; s <= 8; s++) {
      const p = new THREE.Vector3(...pts[s]);
      const up = new THREE.Vector3(Math.cos(a), 0.3 - rng() * 0.6, Math.sin(a)).normalize();
      const sz = 1.7 + rng() * 0.8;
      card(lg, p, up, sz, sz, crownC, 7, clamp(p.y / H, 0, 1) * 1.1, rng(), rng, [1, 1, 1]);
      if (s % 3 === 0 && c % 2 === 0) card(ll, p, up, sz * 2.2, sz * 2.2, crownC, 7, 0.8, rng(), rng, [1, 1, 1]);
    }
  }
  return { bark: gb.geo(), leaf: lg.geo(), bark1: lb.geo(), leaf1: ll.geo(), H: maxH, trunkR: 1.1, crownY: 7, crownR: 5, barkKind: 'bamboo', leafKind: 'bamboo' };
}

function buildBanyan(seed) {
  const rng = mulberry32(seed); const gb = new GB(), lg = new GB(); const leaves = [];
  const spec = { gnarl: 0.15, sub: 3, perTip: 5 };
  const ctx = { H: 16, cardS: 2.6 };
  // fused trunks
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * 6.28 + rng(), o = 0.5 + rng() * 0.3;
    const pts = [], rads = [];
    for (let s = 0; s <= 6; s++) { const t = s / 6; pts.push([Math.cos(a) * o * (1 - t * 0.6), -1.5 + t * 7.5, Math.sin(a) * o * (1 - t * 0.6)]); rads.push((0.85 + rng() * 0.25) * (1 - t * 0.35)); }
    tube(gb, pts, rads, 10, () => 0.02, rng(), null);
  }
  const limbs = 7 + Math.floor(rng() * 3);
  for (let b = 0; b < limbs; b++) {
    const phi = b / limbs * 6.28 + rng() * 0.4, th = 1.15 + rng() * 0.3;
    const dir = new THREE.Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
    const start = new THREE.Vector3(0, 5 + rng() * 1.5, 0);
    growBranch(gb, leaves, rng, start, dir, 10 + rng() * 5, 0.55, 0, { ...spec, gnarl: 0.12 }, ctx);
    // aerial roots
    for (let r = 0; r < 4; r++) {
      const t = 0.3 + rng() * 0.6;
      const p = start.clone().addScaledVector(dir, (10 + rng() * 4) * t);
      const pts = [[p.x, p.y, p.z], [p.x + (rng() - 0.5) * 0.3, p.y * 0.5, p.z + (rng() - 0.5) * 0.3], [p.x + (rng() - 0.5) * 0.4, -1, p.z + (rng() - 0.5) * 0.4]];
      const rr = 0.04 + rng() * 0.1;
      tube(gb, pts, [rr, rr * 1.2, rr * 1.6], 4, (q) => clamp(q[1] / 12, 0, 1) * 0.1, rng(), 1);
    }
  }
  const crownC = new THREE.Vector3(0, 9, 0), crownR = 13;
  for (const l of leaves) {
    const out = l.C.clone().sub(crownC).normalize();
    const up = out.multiplyScalar(0.6).add(new THREE.Vector3(0, 1, 0)).add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)).normalize();
    const s = 2.3 + rng() * 0.8;
    card(lg, l.C, up, s, s, crownC, crownR, 0.5, rng(), rng, [1, 1, 1]);
  }
  const lb = new GB(), ll = new GB();
  tube(lb, [[0, -1.5, 0], [0, 6, 0]], [1.6, 1.3], 6, () => 0, 0.5, null);
  for (let i = 0; i < leaves.length; i += 18) { const l = leaves[i]; const up = l.C.clone().sub(crownC).normalize().multiplyScalar(0.5).add(new THREE.Vector3(0, 1, 0)).normalize(); card(ll, l.C, up, 9, 9, crownC, crownR, 0.4, rng(), rng, [1, 1, 1]); }
  return { bark: gb.geo(), leaf: lg.geo(), bark1: lb.geo(), leaf1: ll.geo(), H: 18, trunkR: 1.8, crownY: 9, crownR, barkKind: 'banyan', leafKind: 'banyan' };
}

function buildLantana(seed) {
  const rng = mulberry32(seed); const gb = new GB(), lg = new GB();
  const C = new THREE.Vector3(0, 0.6, 0);
  for (let k = 0; k < 6; k++) { const a = rng() * 6.28; tube(gb, [[0, -0.2, 0], [Math.cos(a) * 0.5, 0.6, Math.sin(a) * 0.5], [Math.cos(a) * 0.9, 1.1, Math.sin(a) * 0.9]], [0.03, 0.02, 0.01], 3, (p) => p[1] * 0.3, rng(), 1); }
  for (let k = 0; k < 16; k++) {
    const a = rng() * 6.28, el = rng() * 1.2;
    const p = new THREE.Vector3(Math.cos(a) * Math.cos(el) * 0.8, 0.2 + Math.sin(el) * 0.9, Math.sin(a) * Math.cos(el) * 0.8);
    const up = p.clone().sub(new THREE.Vector3(0, 0, 0)).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize();
    card(lg, p.clone().multiplyScalar(0.6), up, 1.3, 1.3, C, 1.2, 0.5, rng(), rng, [1, 1, 1]);
  }
  const ll = new GB();
  for (let k = 0; k < 3; k++) { const a = k * 2.1; const up = new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize(); card(ll, new THREE.Vector3(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3), up, 2.2, 1.8, C, 1.2, 0.4, rng(), rng, [1, 1, 1]); }
  return { bark: gb.geo(), leaf: lg.geo(), bark1: new GB().geo(), leaf1: ll.geo(), H: 1.6, trunkR: 0, crownY: 0.7, crownR: 1.2, barkKind: 'generic', leafKind: 'lantana' };
}

// ------------------------------------------------------------------ materials
export const FOLIAGE_SEASON = {
  winter: { teak: [0.22, [1.08, 0.98, 0.72]], kulu: [0.55, [1.1, 1.0, 0.75]], palash: [0.25, [1, 1, 0.85]], mahua: [0.05, [1, 1, 0.95]], saja: [0.12, [1.05, 1, 0.85]], small: [0.06, [1, 1, 0.9]], arjun: [0.0, [1, 1, 0.95]], bamboo: [0.12, [1.1, 1.05, 0.8]], banyan: [0, [1, 1, 1]], lantana: [0.05, [1, 1, 0.9]] },
  summer: { teak: [0.82, [1.35, 0.85, 0.42]], kulu: [0.96, [1.2, 0.9, 0.6]], palash: [0.0, [1, 1, 1]], mahua: [0.3, [1.2, 0.9, 0.7]], saja: [0.55, [1.25, 0.92, 0.55]], small: [0.35, [1.15, 1.0, 0.6]], arjun: [0.1, [1.05, 1, 0.8]], bamboo: [0.5, [1.3, 1.1, 0.55]], banyan: [0.0, [1.05, 1, 0.9]], lantana: [0.35, [1.15, 1, 0.65]] },
  monsoon: { teak: [0, [0.86, 1.1, 0.78]], kulu: [0, [0.9, 1.08, 0.8]], palash: [0, [0.9, 1.08, 0.8]], mahua: [0, [0.88, 1.06, 0.82]], saja: [0, [0.9, 1.08, 0.82]], small: [0, [0.88, 1.08, 0.8]], arjun: [0, [0.9, 1.06, 0.85]], bamboo: [0, [0.86, 1.12, 0.78]], banyan: [0, [0.92, 1.05, 0.88]], lantana: [0, [0.88, 1.08, 0.8]] },
  post: { teak: [0.02, [0.95, 1.04, 0.82]], kulu: [0.1, [0.98, 1.04, 0.85]], palash: [0.02, [0.95, 1.04, 0.82]], mahua: [0, [0.95, 1.02, 0.86]], saja: [0, [0.95, 1.04, 0.84]], small: [0, [0.95, 1.04, 0.84]], arjun: [0, [0.95, 1.02, 0.86]], bamboo: [0, [0.92, 1.06, 0.82]], banyan: [0, [0.96, 1.02, 0.9]], lantana: [0, [0.95, 1.04, 0.84]] },
};

function leafMaterial(map, key) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8, metalness: 0 });
  m.userData.drop = { value: 0 }; m.userData.tint = { value: new THREE.Vector3(1, 1, 1) };
  patch(m, 'leaf-' + key, (s) => {
    s.uniforms.uLeafDrop = m.userData.drop; s.uniforms.uLeafTint = m.userData.tint;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute float aWind; attribute float aRand; varying float vRand; varying vec3 vWP2; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}\n vRand = aRand;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wq = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq;
        #endif
        vWP2 = (modelMatrix * wq).xyz;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uLeafDrop; uniform vec3 uLeafTint; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uSunVis; varying float vRand; varying vec3 vWP2;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vRand < uLeafDrop) discard;
        { vec2 ddx = dFdx(vMapUv * 512.0), ddy = dFdy(vMapUv * 512.0);
          float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
          diffuseColor.a *= 1.0 + mip * 0.3; }
        diffuseColor.rgb *= uLeafTint * (0.92 + 0.16 * fract(vRand * 13.7));`)
      .replace('#include <opaque_fragment>', `
        { vec3 vd = normalize(vWP2 - cameraPosition);
          float bl = pow(max(dot(vd, uSunDir), 0.0), 4.0) * 0.9 + 0.12;
          outgoingLight += diffuseColor.rgb * uSunCol * bl * uSunVis * vec3(0.55, 0.75, 0.25) * 0.6; }
        #include <opaque_fragment>`);
  });
  return m;
}
function leafDepthMaterial(map, key, dropRef) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  patch(m, 'leafdepth-' + key, (s) => {
    s.uniforms.uLeafDrop = dropRef;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute float aWind; attribute float aRand; varying float vRand; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}\n vRand = aRand;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n uniform float uLeafDrop; varying float vRand;`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n if (vRand < uLeafDrop) discard;`);
  });
  return m;
}
function barkMaterial(map, key, tint = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ map, color: tint, roughness: 0.95, metalness: 0, vertexColors: true });
  patch(m, 'bark-' + key, (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute float aWind; attribute float aRand; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}`);
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= mix(1.0, 0.75, uWetness);`).replace('#include <common>', '#include <common>\n uniform float uWetness;');
  });
  return m;
}

// ------------------------------------------------------------------ vegetation manager
const SPECIES_LIST = [
  { name: 'teak', variants: 3, build: (s) => buildGeneric('teak', s) },
  { name: 'mahua', variants: 2, build: (s) => buildGeneric('mahua', s) },
  { name: 'saja', variants: 2, build: (s) => buildGeneric('saja', s) },
  { name: 'kulu', variants: 2, build: (s) => buildGeneric('kulu', s) },
  { name: 'palash', variants: 2, build: (s) => buildGeneric('palash', s) },
  { name: 'small', variants: 2, build: (s) => buildGeneric('small', s) },
  { name: 'arjun', variants: 1, build: (s) => buildGeneric('arjun', s) },
  { name: 'dead', variants: 1, build: (s) => buildGeneric('dead', s) },
  { name: 'bamboo', variants: 2, build: (s) => buildBamboo(s) },
  { name: 'banyan', variants: 1, build: (s) => buildBanyan(s) },
  { name: 'lantana', variants: 2, build: (s) => buildLantana(s) },
];
export const SP = {}; SPECIES_LIST.forEach((s, i) => (SP[s.name] = i));
const STRIDE = 7; // x y z rot scale species variant

export class Vegetation {
  constructor(scene, T, quality) {
    this.scene = scene; this.T = T; this.q = quality;
    this.cells = new Map();
    this.exclusions = []; // {x,z,r}
    this.templates = [];
    this.leafMats = {}; this.barkMats = {};
    this.lastPos = new THREE.Vector3(1e9, 0, 1e9);
    this.colliders = []; this.perches = [];
    this.season = 'winter';
    for (const sp of SPECIES_LIST) {
      const arr = [];
      for (let v = 0; v < sp.variants; v++) arr.push(sp.build(1000 + SP[sp.name] * 37 + v * 11));
      this.templates.push(arr);
    }
    // materials per species
    const barkTint = { arjun: 0xe8d6cc, dead: 0x9a9088, kulu: 0xffffff };
    for (const sp of SPECIES_LIST) {
      const t0 = this.templates[SP[sp.name]][0];
      this.barkMats[sp.name] = barkMaterial(T.bark[t0.barkKind], sp.name, barkTint[sp.name] || 0xffffff);
      if (t0.leafKind) {
        this.leafMats[sp.name] = leafMaterial(T.leaf[t0.leafKind], sp.name);
        this.leafMats[sp.name].userData.depth = leafDepthMaterial(T.leaf[t0.leafKind], sp.name, this.leafMats[sp.name].userData.drop);
      }
    }
    // instanced meshes
    this.meshes = [];
    const cap0 = quality.treeCap0 || 1400, cap1 = quality.treeCap1 || 6000;
    for (let s = 0; s < SPECIES_LIST.length; s++) {
      const name = SPECIES_LIST[s].name;
      const per = [];
      for (let v = 0; v < SPECIES_LIST[s].variants; v++) {
        const t = this.templates[s][v];
        const capMul = name === 'teak' ? 1.0 : name === 'banyan' ? 0.1 : 0.5;
        const c0 = Math.ceil(cap0 * capMul), c1 = Math.ceil(cap1 * capMul);
        const mk = (geo, mat, cap, shadow, depth) => {
          if (!geo || !geo.attributes.position || geo.attributes.position.count === 0) return null;
          const m = new THREE.InstancedMesh(geo, mat, cap);
          m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
          if (depth) m.customDepthMaterial = depth;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.scene.add(m); return m;
        };
        const lm = this.leafMats[name];
        per.push({
          b0: mk(t.bark, this.barkMats[name], c0, true), l0: lm ? mk(t.leaf, lm, c0, true, lm.userData.depth) : null,
          b1: mk(t.bark1, this.barkMats[name], c1, false), l1: lm ? mk(t.leaf1, lm, c1, false) : null,
          c0, c1, n0: 0, n1: 0,
        });
      }
      this.meshes.push(per);
    }
    this.setSeason('winter');
  }
  setSeason(season) {
    this.season = season;
    const fs = FOLIAGE_SEASON[season];
    for (const name in this.leafMats) {
      const m = this.leafMats[name], cfg = fs[name] || [0, [1, 1, 1]];
      m.userData.drop.value = cfg[0]; m.userData.tint.value.set(...cfg[1]);
      let map = this.T.leaf[this.templates[SP[name]][0].leafKind];
      if (name === 'palash' && season === 'summer') map = this.T.leaf.palashFlower;
      if (name === 'mahua' && season === 'summer') map = this.T.leaf.mahuaFlower;
      if (m.map !== map) { m.map = map; m.userData.depth.map = map; m.needsUpdate = true; m.userData.depth.needsUpdate = true; }
    }
  }
  addExclusion(x, z, r) { this.exclusions.push({ x, z, r }); for (const [k, c] of this.cells) if (Math.abs(c.cx * CHUNK + 32 - x) < r + 64 && Math.abs(c.cz * CHUNK + 32 - z) < r + 64) this.cells.delete(k); this.lastPos.set(1e9, 0, 1e9); }
  excluded(x, z) { for (const e of this.exclusions) { const dx = x - e.x, dz = z - e.z; if (dx * dx + dz * dz < e.r * e.r) return true; } return false; }
  genCell(cx, cz) {
    const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
    const out = [];
    const step = 4.6;
    for (let j = 0; j < CHUNK / step; j++) for (let i = 0; i < CHUNK / step; i++) {
      const x = cx * CHUNK + (i + rng()) * step, z = cz * CHUNK + (j + rng()) * step;
      const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
      if (this.excluded(x, z)) continue;
      const b = biomeAt(x, z);
      // density
      let dens = 0.21 * b.teak + 0.035 + b.riparian * 0.16 + b.bamboo * 0.1 + b.rock * 0.05;
      dens *= (1 - b.grass * 0.85) * (1 - b.village * 0.94) * (1 - b.sand);
      if (b.field > 0.3) dens = 0.0;
      let sp = -1, scale = 0.8 + r3 * 0.45;
      if (r1 < dens) {
        if (b.rock > 0.5) sp = r2 < 0.55 ? SP.kulu : r2 < 0.75 ? SP.small : r2 < 0.9 ? SP.dead : SP.palash;
        else if (b.bamboo > 0.45 && r2 < 0.5) sp = SP.bamboo;
        else if (b.riparian > 0.5) sp = r2 < 0.4 ? SP.arjun : r2 < 0.7 ? SP.small : r2 < 0.78 ? SP.banyan : r2 < 0.9 ? SP.mahua : SP.bamboo;
        else {
          const k = r2 - b.mixed * 0.15;
          sp = k < 0.6 ? SP.teak : k < 0.7 ? SP.saja : k < 0.79 ? SP.mahua : k < 0.88 ? SP.small : k < 0.93 ? SP.palash : k < 0.97 ? SP.dead : SP.kulu;
          if (b.rock > 0.2 && r4 < b.rock) sp = SP.kulu;
        }
      } else if (r1 < dens + 0.06 + b.open * 0.1 + b.grass * 0.03) {
        sp = SP.lantana; scale = 0.7 + r3 * 0.8;
        if (b.village > 0.3 || b.field > 0.2) sp = -1;
      } else if (b.village > 0.2 && b.field > 0.3 && r1 > 0.997) { sp = SP.mahua; scale = 1.1; }  // mahua kept in fields
      if (sp < 0) continue;
      const y = height(x, z);
      if (waterAt(x, z) > y - 0.2) continue;
      const nv = SPECIES_LIST[sp].variants;
      out.push(x, y, z, r4 * 6.283, scale, sp, Math.floor(rng() * nv));
    }
    return { cx, cz, data: new Float32Array(out) };
  }
  update(cam, force = false) {
    if (!force && this.lastPos.distanceToSquared(cam) < 100) return;
    this.lastPos.copy(cam);
    const R1 = this.q.treeFar, R0 = this.q.treeNear;
    const r = Math.ceil(R1 / CHUNK);
    const pcx = Math.floor(cam.x / CHUNK), pcz = Math.floor(cam.z / CHUNK);
    for (const per of this.meshes) for (const m of per) { m.n0 = 0; m.n1 = 0; }
    this.colliders.length = 0; this.perches.length = 0;
    const R0s = R0 * R0, R1s = R1 * R1;
    let gen = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      const ccx = (cx + 0.5) * CHUNK - cam.x, ccz = (cz + 0.5) * CHUNK - cam.z;
      if (ccx * ccx + ccz * ccz > (R1 + 46) * (R1 + 46)) continue;
      const key = cx * 100003 + cz;
      let cell = this.cells.get(key);
      if (!cell) { if (gen > (force ? 1e9 : 12)) continue; cell = this.genCell(cx, cz); this.cells.set(key, cell); gen++; }
      const d = cell.data;
      const near = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
      for (let i = 0; i < d.length; i += STRIDE) {
        const x = d[i], y = d[i + 1], z = d[i + 2];
        const ddx = x - cam.x, ddz = z - cam.z, dist2 = ddx * ddx + ddz * ddz;
        if (dist2 > R1s) continue;
        const sp = d[i + 5], va = d[i + 6], m = this.meshes[sp][va];
        const tmpl = this.templates[sp][va];
        const s = d[i + 4];
        if (near && tmpl.trunkR > 0) this.colliders.push(x, z, tmpl.trunkR * s * 0.9);
        if (near && sp !== SP.lantana && sp !== SP.bamboo && dist2 < 70 * 70) this.perches.push(x, y + tmpl.crownY * s * 0.85, z, sp);
        if (dist2 < R0s) {
          if (m.n0 < m.c0) { writeMat(m.b0, m.l0, m.n0, x, y, z, d[i + 3], s); m.n0++; }
        } else if (sp !== SP.lantana || dist2 < R1s * 0.25) {
          if (m.n1 < m.c1) { writeMat(m.b1, m.l1, m.n1, x, y - 0.6, z, d[i + 3], s); m.n1++; }
        }
      }
    }
    for (const per of this.meshes) for (const m of per) {
      for (const [mesh, n] of [[m.b0, m.n0], [m.l0, m.n0], [m.b1, m.n1], [m.l1, m.n1]]) if (mesh) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
    }
    // prune far cells
    if (this.cells.size > 1600) for (const [k, c] of this.cells) { if (Math.abs(c.cx - pcx) > r + 3 || Math.abs(c.cz - pcz) > r + 3) this.cells.delete(k); }
  }
  collide(pos, radius) {
    const c = this.colliders; let hit = false;
    for (let i = 0; i < c.length; i += 3) {
      const dx = pos.x - c[i], dz = pos.z - c[i + 1], rr = c[i + 2] + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = c[i] + dx / d * rr; pos.z = c[i + 1] + dz / d * rr; hit = true; }
    }
    return hit;
  }
  nearestTree(x, z, maxD = 3, species) {
    let best = null, bd = maxD * maxD;
    const c = this.colliders;
    for (let i = 0; i < c.length; i += 3) { const dx = x - c[i], dz = z - c[i + 1], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = { x: c[i], z: c[i + 1], r: c[i + 2] }; } }
    return best;
  }
  treeSpeciesAt(x, z, maxD = 3) {
    let best = -1, bd = maxD * maxD;
    const p = this.perches;
    for (let i = 0; i < p.length; i += 4) { const dx = x - p[i], dz = z - p[i + 2], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = p[i + 3]; } }
    return best;
  }
  makeSingle(name, variant = 0) {
    const s = SP[name], t = this.templates[s][variant];
    const g = new THREE.Group();
    const b = new THREE.Mesh(t.bark, this.barkMats[name]); b.castShadow = true; b.receiveShadow = true; g.add(b);
    if (t.leaf) { const l = new THREE.Mesh(t.leaf, this.leafMats[name]); l.castShadow = true; l.receiveShadow = true; l.customDepthMaterial = this.leafMats[name].userData.depth; g.add(l); }
    g.userData.tmpl = t;
    return g;
  }
}

function writeMat(bm, lm, idx, x, y, z, rot, s) {
  const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  for (const m of [bm, lm]) {
    if (!m) continue;
    const e = m.instanceMatrix.array, o = idx * 16;
    e[o] = c; e[o + 1] = 0; e[o + 2] = -sn; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }
}

// ------------------------------------------------------------------ grass
function tuftGeometry(seed, blades, hMin, hMax, spread) {
  const rng = mulberry32(seed);
  const p = [], n = [], c = [], w = [], r = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rng() * 6.28, rad = Math.sqrt(rng()) * spread;
    const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
    const h = hMin + rng() * (hMax - hMin), wd = 0.011 + rng() * 0.013;
    const lean = 0.15 + rng() * 0.45, la = rng() * 6.28;
    const fx = Math.cos(la), fz = Math.sin(la);
    const rx = -fz, rz = fx;
    const base = p.length / 3;
    const segs = 3;
    const shade = 0.75 + rng() * 0.4;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const off = lean * t * t * h;
      const x = bx + fx * off, z = bz + fz * off, y = t * h;
      const ww = wd * (1 - t * 0.85);
      for (const side of [-1, 1]) {
        p.push(x + rx * ww * side, y, z + rz * ww * side);
        n.push(fx * 0.3, 1, fz * 0.3);
        const v = (0.45 + 0.75 * t) * shade;
        c.push(v, v, v); w.push(t * t); r.push(rng());
      }
    }
    for (let s = 0; s < segs; s++) { const a0 = base + s * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(w, 1));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(r, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

function grassTexture(tall) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const rng = mulberry32(tall ? 77 : 33);
  x.clearRect(0, 0, S, S); x.lineCap = 'round';
  const n = tall ? 70 : 90;
  for (let i = 0; i < n; i++) {
    const bx = 20 + rng() * (S - 40), h = (tall ? 0.45 : 0.35) * S + rng() * (tall ? 0.55 : 0.6) * S, lean = (rng() - 0.5) * 70;
    const v = 0.55 + rng() * 0.45, w = 1.2 + rng() * 2.2;
    const g = x.createLinearGradient(0, S, 0, S - h);
    g.addColorStop(0, `rgb(${70 * v},${80 * v},${50 * v})`); g.addColorStop(0.5, `rgb(${170 * v},${175 * v},${120 * v})`); g.addColorStop(1, `rgb(${215 * v},${205 * v},${150 * v})`);
    x.strokeStyle = g; x.lineWidth = w;
    x.beginPath(); x.moveTo(bx, S); x.quadraticCurveTo(bx + lean * 0.3, S - h * 0.6, bx + lean, S - h); x.stroke();
    if (tall && rng() < 0.35) { x.fillStyle = `rgba(${200 * v},${170 * v},${120 * v},0.95)`; for (let k = 0; k < 9; k++) { x.beginPath(); x.ellipse(bx + lean + (rng() - 0.5) * 8, S - h + k * 3.2, 1.6, 3.2, (rng() - 0.5), 0, 6.28); x.fill(); } }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return t;
}
function tuftCards(seed, h, w, n = 3) {
  const rng = mulberry32(seed), p = [], nr = [], uv = [], c = [], wd = [], r = [], idx = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI + rng() * 0.3, ca = Math.cos(a) * w / 2, sa = Math.sin(a) * w / 2, ox = (rng() - 0.5) * 0.15, oz = (rng() - 0.5) * 0.15;
    const hh = h * (0.85 + rng() * 0.3), base = p.length / 3;
    const pts = [[-ca + ox, 0, -sa + oz, 0, 0], [ca + ox, 0, sa + oz, 1, 0], [ca + ox, hh, sa + oz, 1, 1], [-ca + ox, hh, -sa + oz, 0, 1]];
    for (const [x, y, z, u, v] of pts) { p.push(x, y, z); nr.push(0, 1, 0); uv.push(u, v); const s2 = 0.55 + 0.6 * v; c.push(s2, s2, s2); wd.push(v * v); r.push(rng()); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wd, 1)); g.setAttribute('aRand', new THREE.Float32BufferAttribute(r, 1));
  g.setIndex(idx); g.computeBoundingSphere(); return g;
}

export class Grass {
  constructor(scene, quality) {
    this.scene = scene; this.q = quality;
    this.cells = new Map(); this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.heightMul = { value: 1 };
    this.radius = { value: quality.grassR };
    const mkMat = (tex, key) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, map: tex, alphaTest: 0.42 });
    patch(mat, key, (s) => {
      s.uniforms.uGrassH = this.heightMul; s.uniforms.uGrassR = this.radius;
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
        attribute float aWind; attribute float aRand; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec3 uPlayerPos; uniform float uGrassH; uniform float uGrassR;
        varying float vGT; varying vec3 vGW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 gip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float gd = distance(gip.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(uGrassR * 0.65, uGrassR, gd);
          transformed.y *= uGrassH * fade;
          transformed.xz *= mix(0.3, 1.0, fade);
          ${WIND_VERTEX}
          // trample away from player
          vec3 wpp = gip + transformed;
          vec2 dp = wpp.xz - uPlayerPos.xz; float dl = length(dp);
          float push = (1.0 - smoothstep(0.2, 1.3, dl)) * aWind;
          transformed.xz += normalize(dp + 1e-4) * push * 0.6; transformed.y -= push * 0.3;
          vGT = aWind; vGW = gip;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        uniform float uSeasonGreen; varying float vGT; varying vec3 vGW;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float gn = vnoise(vGW.xz * 0.05) * 0.6 + vnoise(vGW.xz * 0.4) * 0.4;
          float green = clamp(uSeasonGreen * (0.7 + 0.6 * gn), 0.0, 1.0);
          vec3 dry = mix(vec3(0.62, 0.52, 0.30), vec3(0.78, 0.68, 0.42), gn);
          vec3 lush = mix(vec3(0.24, 0.40, 0.12), vec3(0.42, 0.56, 0.2), gn);
          vec3 gc = mix(dry, lush, green);
          gc = mix(gc, gc * vec3(1.2, 1.15, 0.8), vGT * 0.6);
          diffuseColor.rgb *= gc * 1.25;
          { vec2 ddx = dFdx(vMapUv * 256.0), ddy = dFdy(vMapUv * 256.0); float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)))); diffuseColor.a *= 1.0 + mip * 0.35; }`);
    });
    return mat; };
    this.mat = mkMat(grassTexture(false), 'grass-s'); this.matT = mkMat(grassTexture(true), 'grass-t');
    this.short = new THREE.InstancedMesh(tuftCards(5, 0.5, 0.9, 3), this.mat, quality.grassCap || 9000);
    this.tall = new THREE.InstancedMesh(tuftCards(9, 1.35, 1.1, 3), this.matT, Math.floor((quality.grassCap || 9000) * 0.6));
    for (const m of [this.short, this.tall]) { m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  }
  setSeason(season) { this.heightMul.value = season === 'summer' ? 0.65 : season === 'winter' ? 0.85 : season === 'monsoon' ? 1.0 : 1.25; }
  genCell(cx, cz) {
    const rng = mulberry32((cx * 92837111) ^ (cz * 689287499) ^ 0x1234567);
    const S = 8, out = [], outT = [];
    const b = biomeAt(cx * S + 4, cz * S + 4);
    let dens = (0.18 + b.grass * 1.1 + b.riparian * 0.35 + b.open * 0.6) * (1 - b.rock * 0.8) * (1 - b.sand * 0.9) * (1 - b.field * 0.7);
    dens *= (1 - b.teak * 0.55) * this.q.grassDensity;
    const n = Math.floor(dens * 22 + rng());
    for (let k = 0; k < n; k++) {
      const x = cx * S + rng() * S, z = cz * S + rng() * S;
      const y = height(x, z);
      if (waterAt(x, z) > y - 0.05) continue;
      const tall = (b.grass > 0.5 || b.open > 0.6) && rng() < 0.55;
      (tall ? outT : out).push(x, y - 0.05, z, rng() * 6.28, 0.7 + rng() * 0.6);
    }
    return { a: new Float32Array(out), t: new Float32Array(outT), tallDens: b.grass };
  }
  update(cam, force) {
    if (!force && this.last.distanceToSquared(cam) < 9) return;
    this.last.copy(cam);
    const R = this.q.grassR, S = 8, r = Math.ceil(R / S);
    const pcx = Math.floor(cam.x / S), pcz = Math.floor(cam.z / S);
    let ns = 0, nt = 0; const cs = this.short.count, ct = this.tall.count;
    const ea = this.short.instanceMatrix.array, et = this.tall.instanceMatrix.array;
    const capS = this.short.instanceMatrix.count, capT = this.tall.instanceMatrix.count;
    let gen = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
      const cx = pcx + dx, cz = pcz + dz, key = cx * 100003 + cz;
      let c = this.cells.get(key);
      if (!c) { if (!force && gen > 40) continue; c = this.genCell(cx, cz); this.cells.set(key, c); gen++; }
      for (const [arr, isT] of [[c.a, false], [c.t, true]]) {
        for (let i = 0; i < arr.length; i += 5) {
          const e = isT ? et : ea; let idx = isT ? nt : ns;
          if (idx >= (isT ? capT : capS)) continue;
          const co = Math.cos(arr[i + 3]) * arr[i + 4], si = Math.sin(arr[i + 3]) * arr[i + 4], s = arr[i + 4], o = idx * 16;
          e[o] = co; e[o + 1] = 0; e[o + 2] = -si; e[o + 3] = 0; e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
          e[o + 8] = si; e[o + 9] = 0; e[o + 10] = co; e[o + 11] = 0; e[o + 12] = arr[i]; e[o + 13] = arr[i + 1]; e[o + 14] = arr[i + 2]; e[o + 15] = 1;
          if (isT) nt++; else ns++;
        }
      }
    }
    this.short.count = ns; this.tall.count = nt;
    this.short.instanceMatrix.needsUpdate = true; this.tall.instanceMatrix.needsUpdate = true;
    if (this.cells.size > 6000) for (const [k] of this.cells) { this.cells.delete(k); if (this.cells.size < 3000) break; }
  }
  // how hidden the player is (tall grass)
  coverAt(x, z) {
    const S = 8; const c = this.cells.get(Math.floor(x / S) * 100003 + Math.floor(z / S));
    if (!c) return 0;
    return clamp(c.t.length / 5 / 8, 0, 1) * this.heightMul.value;
  }
}

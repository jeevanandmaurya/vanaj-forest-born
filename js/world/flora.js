// Procedural Pench flora: branching tree generator per species, instanced LOD vegetation manager,
// seasonal foliage (leaf fall, palash/mahua flowering), wind, grass tufts, trunk collision and langur perches.
import * as THREE from 'three';
import { mulberry32, hash2, clamp, smoothstep } from '../core/noise.js';
import { G, patch, WIND_VERTEX, NOISE_GLSL } from '../core/shaderlib.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, biomeAt, waterAt, CHUNK, WATERHOLES, lakeE } from './terrain.js';

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

function tube(gb, pts, rads, radial, windFn, rnd, uRep, colMul = 1, shape = null, aoFn = null) {
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
    const ao = colMul * (aoFn ? aoFn(p) : (p[1] < 0.5 ? 0.7 : 1));
    for (let k = 0; k <= radial; k++) {
      const a = k / radial * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      let dx = Nx * c + Bx * sn, dy = Ny * c + By * sn, dz = Nz * c + Bz * sn;
      let rr = r, nx = dx, ny = dy, nz = dz;
      if (shape) {
        const m0 = shape(s, a, p), m1 = shape(s, a + 0.02, p);
        rr = r * m0;
        const dm = (m1 - m0) / 0.02 / Math.max(0.2, m0);        // d ln r / d angle -> tilt normal against the lobe slope
        const tx2 = -Nx * sn + Bx * c, ty2 = -Ny * sn + By * c, tz2 = -Nz * sn + Bz * c;
        nx = dx - tx2 * dm; ny = dy - ty2 * dm; nz = dz - tz2 * dm; const l2 = Math.hypot(nx, ny, nz) || 1; nx /= l2; ny /= l2; nz /= l2;
      }
      const aoL = shape ? ao * (0.78 + 0.22 * clamp(shape(s, a, p) - 0.6, 0, 1)) : ao;  // darker in the flute grooves
      gb.vert(p[0] + dx * rr, p[1] + dy * rr, p[2] + dz * rr, nx, ny, nz, k / radial * ur, len / 2.4, aoL, aoL, aoL, wv, rnd);
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
  // teak: straight clean bole, fluted / low-buttressed base, fibrous grey-brown bark, open crown of huge leaves
  teak: { H: [14, 22], r0: [0.26, 0.42], trunkFrac: 0.52, nB: [6, 10], ang: [0.6, 1.15], bLen: 1.0, crownR: 5.2, cardS: [2.4, 3.1], perTip: 3, sub: 2, leaf: 'teak', bark: 'teak', gnarl: 0.08, lean: 0.05, tint: [1, 1, 1], flute: { n: 6, amp: 0.2, h: 1.4 }, roots: 4, taper: 0.7, flare: 0.5 },
  // mahua: short stout trunk forking low into a big rounded, dense crown; dark cracked bark
  mahua: { H: [9, 14], r0: [0.42, 0.62], trunkFrac: 0.3, nB: [6, 9], ang: [0.85, 1.4], bLen: 1.2, crownR: 6.8, cardS: [1.6, 2.0], perTip: 4, sub: 3, leaf: 'mahua', bark: 'mahua', gnarl: 0.2, lean: 0.07, tint: [0.95, 1, 0.95], roots: 5, trunkTop: 0.55, taper: 0.6, flare: 0.6, flute: { n: 5, amp: 0.1, h: 1.0 } },
  // saja / crocodile-bark: tall, very straight cylindrical stem, little taper, narrow crown
  saja: { H: [17, 25], r0: [0.3, 0.44], trunkFrac: 0.64, nB: [5, 7], ang: [0.45, 0.85], bLen: 0.85, crownR: 4.2, cardS: [1.8, 2.2], perTip: 3, sub: 2, leaf: 'small', bark: 'saja', gnarl: 0.05, lean: 0.025, tint: [0.92, 1, 0.9], roots: 3, taper: 0.55, flare: 0.35, flute: { n: 4, amp: 0.07, h: 1.0 } },
  // kulu / ghost tree: short crooked pale bole, big horizontally spreading limbs, on rocky slopes
  kulu: { H: [7, 12], r0: [0.22, 0.34], trunkFrac: 0.35, nB: [3, 5], ang: [1.05, 1.45], bLen: 1.05, crownR: 4.4, cardS: [1.5, 1.8], perTip: 2, sub: 2, leaf: 'kulu', bark: 'kulu', gnarl: 0.35, lean: 0.28, tint: [1, 1, 1], bend: 0.9, roots: 2, taper: 0.6, flare: 0.45 },
  // palash / flame of the forest: crooked, tortuous trunk and irregular branches, rough grey-brown bark
  palash: { H: [5, 9], r0: [0.15, 0.25], trunkFrac: 0.4, nB: [4, 6], ang: [0.7, 1.3], bLen: 0.95, crownR: 3.4, cardS: [1.3, 1.6], perTip: 3, sub: 2, leaf: 'palash', bark: 'palash', gnarl: 0.5, lean: 0.22, tint: [1, 1, 1], bend: 0.7, roots: 2, taper: 0.65, flare: 0.4 },
  small: { H: [7, 11], r0: [0.18, 0.3], trunkFrac: 0.42, nB: [5, 7], ang: [0.7, 1.15], bLen: 0.9, crownR: 4.0, cardS: [1.5, 1.8], perTip: 4, sub: 2, leaf: 'small', bark: 'generic', gnarl: 0.2, lean: 0.08, tint: [1, 1, 1], bend: 0.3, roots: 2, taper: 0.7, flare: 0.45 },
  // arjun: riverside giant, buttressed uneven stem, smooth pale flaking bark
  arjun: { H: [15, 21], r0: [0.48, 0.66], trunkFrac: 0.42, nB: [7, 9], ang: [0.8, 1.25], bLen: 1.1, crownR: 7.0, cardS: [2.0, 2.4], perTip: 4, sub: 3, leaf: 'small', bark: 'arjun', gnarl: 0.16, lean: 0.06, tint: [0.9, 1.0, 0.9], flute: { n: 5, amp: 0.55, h: 2.0 }, roots: 5, bend: 0.35, taper: 0.66, flare: 0.5 },
  // dead snag: broken top, a few stubs
  dead: { H: [8, 15], r0: [0.22, 0.36], trunkFrac: 0.5, nB: [3, 5], ang: [0.6, 1.1], bLen: 0.5, crownR: 4.0, cardS: [0, 0], perTip: 0, sub: 1, leaf: null, bark: 'teak', gnarl: 0.25, lean: 0.12, tint: [1, 1, 1], roots: 3, taper: 0.55, flare: 0.45, snag: true },
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

// ------------------------------------------------------------------ recursive tree growth
// Skeleton growth follows EZ-Tree's method (Daniel Greenheck, MIT): each branch is a chain of sections that
// wander by "gnarliness", bend toward a growth force, taper, then spawn children around it and a terminal
// continuation from its tip. Species settings below are tuned from field descriptions of the Pench trees.
const GROW = {
  // teak: tall clean bole forking high into an open, airy crown of huge leaves
  teak: { trunkL: [10, 14], trunkR: [0.3, 0.44], levels: 3, children: [5, 4, 3], angle: [0, 48, 50, 45], start: [0, 0.62, 0.3, 0.25], length: [0, 6.0, 3.4, 1.5], radius: [1, 0.6, 0.55, 0.6], gnarl: [0.045, 0.14, 0.2, 0.28], taper: [0.55, 0.65, 0.7, 0.75], force: 0.012, sections: [10, 6, 4, 3], segs: [12, 7, 5, 3], leafCount: 2, leafSize: [2.8, 3.6], flute: { n: 6, amp: 0.2, h: 1.4 }, roots: 4, flare: 0.45, lean: 0.04 },
  // mahua: short stout bole, forks low into heavy limbs; dense rounded crown
  mahua: { trunkL: [3.2, 4.6], trunkR: [0.48, 0.62], levels: 3, children: [5, 4, 3], angle: [0, 42, 52, 50], start: [0, 0.7, 0.3, 0.2], length: [0, 6.2, 3.2, 1.4], radius: [1, 0.72, 0.6, 0.6], gnarl: [0.12, 0.17, 0.22, 0.3], taper: [0.35, 0.6, 0.68, 0.75], force: 0.008, sections: [6, 7, 5, 3], segs: [14, 8, 5, 3], leafCount: 3, leafSize: [2.1, 2.6], flute: { n: 5, amp: 0.12, h: 1.0 }, roots: 5, flare: 0.55, lean: 0.06 },
  // saja (crocodile bark): tall straight cylindrical stem, small high crown
  saja: { trunkL: [14, 19], trunkR: [0.3, 0.42], levels: 3, children: [4, 4, 3], angle: [0, 36, 46, 45], start: [0, 0.74, 0.3, 0.25], length: [0, 4.6, 2.4, 1.2], radius: [1, 0.5, 0.55, 0.6], gnarl: [0.03, 0.12, 0.2, 0.26], taper: [0.5, 0.65, 0.7, 0.75], force: 0.014, sections: [12, 6, 4, 3], segs: [12, 7, 5, 3], leafCount: 2, leafSize: [2.1, 2.6], roots: 3, flare: 0.35, lean: 0.02 },
  // kulu / ghost tree: short crooked bole, big limbs spreading almost horizontally, sparse leaves at the tips
  kulu: { trunkL: [4.5, 6.5], trunkR: [0.24, 0.34], levels: 3, children: [4, 3, 3], angle: [0, 74, 50, 45], start: [0, 0.55, 0.35, 0.3], length: [0, 5.6, 2.8, 1.2], radius: [1, 0.66, 0.58, 0.6], gnarl: [0.3, 0.28, 0.3, 0.3], taper: [0.45, 0.62, 0.7, 0.75], force: 0.003, sections: [7, 6, 4, 3], segs: [11, 7, 5, 3], leafCount: 1, leafSize: [1.8, 2.2], roots: 2, flare: 0.4, lean: 0.25 },
  // palash: crooked tortuous trunk, irregular branching, low
  palash: { trunkL: [2.6, 4.2], trunkR: [0.15, 0.24], levels: 3, children: [4, 3, 3], angle: [0, 52, 50, 50], start: [0, 0.5, 0.3, 0.3], length: [0, 3.4, 2.0, 1.0], radius: [1, 0.66, 0.6, 0.6], gnarl: [0.42, 0.36, 0.34, 0.3], taper: [0.45, 0.65, 0.7, 0.75], force: 0.006, sections: [6, 5, 4, 3], segs: [9, 6, 4, 3], leafCount: 2, leafSize: [1.6, 2.0], roots: 2, flare: 0.35, lean: 0.2 },
  // tendu / lendia and other small associates
  small: { trunkL: [4.5, 7], trunkR: [0.18, 0.28], levels: 3, children: [5, 3, 3], angle: [0, 50, 48, 45], start: [0, 0.55, 0.3, 0.3], length: [0, 3.6, 2.0, 1.0], radius: [1, 0.6, 0.58, 0.6], gnarl: [0.14, 0.2, 0.25, 0.3], taper: [0.5, 0.65, 0.7, 0.75], force: 0.01, sections: [7, 5, 4, 3], segs: [9, 6, 4, 3], leafCount: 2, leafSize: [1.8, 2.2], roots: 2, flare: 0.4, lean: 0.08 },
  // arjun: riverside giant, buttressed uneven stem, wide spreading crown
  arjun: { trunkL: [6, 8.5], trunkR: [0.5, 0.68], levels: 3, children: [6, 4, 3], angle: [0, 56, 50, 45], start: [0, 0.58, 0.3, 0.25], length: [0, 7.2, 3.5, 1.5], radius: [1, 0.62, 0.56, 0.6], gnarl: [0.1, 0.16, 0.22, 0.28], taper: [0.45, 0.62, 0.7, 0.75], force: 0.007, sections: [8, 7, 5, 3], segs: [14, 8, 5, 3], leafCount: 3, leafSize: [2.3, 2.9], flute: { n: 5, amp: 0.55, h: 2.0 }, roots: 5, flare: 0.5, lean: 0.07 },
  // dead snag: no leaves, broken leader
  dead: { trunkL: [7, 11], trunkR: [0.22, 0.34], levels: 2, children: [4, 3, 0], angle: [0, 50, 48, 0], start: [0, 0.5, 0.35, 0], length: [0, 3.2, 1.3, 0], radius: [1, 0.55, 0.55, 0], gnarl: [0.12, 0.25, 0.3, 0], taper: [0.5, 0.75, 0.8, 0], force: 0.008, sections: [8, 5, 3, 0], segs: [10, 6, 4, 0], leafCount: 0, leafSize: [0, 0], roots: 3, flare: 0.45, lean: 0.12, snag: true },
};
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0), _vv = new THREE.Vector3();
function growSkeleton(P, rng) {
  const rnd = (a, b) => a + rng() * (b - a);
  const branches = [], leaves = [];
  const trunkL = rnd(...P.trunkL), r0 = rnd(...P.trunkR);
  const leanQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-P.lean, P.lean), 0, rnd(-P.lean, P.lean)));
  const queue = [{ origin: new THREE.Vector3(0, -1.2, 0), q: leanQ, length: trunkL + 1.2, radius: r0, level: 0 }];
  _qF.setFromUnitVectors(_up, _up);
  while (queue.length) {
    const b = queue.shift();
    const L = b.level, nSec = P.sections[L], secLen = b.length / nSec;
    const sections = [];
    const pos = b.origin.clone(), q = b.q.clone();
    for (let i = 0; i <= nSec; i++) {
      let r = b.radius * (1 - P.taper[L] * (i / nSec));
      if (i === nSec && L === P.levels) r = Math.max(0.006, r * 0.15);
      sections.push({ p: pos.clone(), q: q.clone(), r });
      pos.add(_vv.set(0, secLen, 0).applyQuaternion(q));
      const g = P.gnarl[L] * Math.max(1, 1 / Math.sqrt(Math.max(r, 0.02)) * 0.6);
      _e.set(rnd(-g, g), rnd(-g, g) * 0.3, rnd(-g, g)); _q2.setFromEuler(_e); q.multiply(_q2);
      q.rotateTowards(_qF, Math.min(0.25, P.force / Math.max(r, 0.03)));
    }
    branches.push({ level: L, sections, segs: P.segs[L] });
    if (L < P.levels) {
      // terminal continuation from the tip (keeps the leader / limb going and lets it fork)
      const last = sections[nSec];
      if (!(L === 0 && P.snag)) queue.push({ origin: last.p.clone(), q: last.q.clone(), length: P.length[L + 1] * rnd(0.75, 1.1), radius: last.r, level: L + 1 });
      // side children, spiralled round the parent
      const n = P.children[L], off = rng() * 6.28;
      for (let c = 0; c < n; c++) {
        const t = rnd(P.start[L + 1], 1);
        const fi = t * nSec, i0 = Math.min(nSec - 1, Math.floor(fi)), al = fi - i0;
        const A = sections[i0], B = sections[i0 + 1];
        const o = new THREE.Vector3().lerpVectors(A.p, B.p, al);
        const pr = A.r * (1 - al) + B.r * al;
        const qp = A.q.clone().slerp(B.q, al);
        const ang = (P.angle[L + 1] + rnd(-12, 12)) * Math.PI / 180, rad = off + c * 2.39996 + rnd(-0.3, 0.3);
        const qc = qp.clone().multiply(_q2.setFromAxisAngle(_up, rad)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang));
        const len = P.length[L + 1] * rnd(0.7, 1.15) * (L === 0 ? 1 - (t - P.start[L + 1]) * 0.35 : 1);
        queue.push({ origin: o, q: qc, length: len, radius: pr * P.radius[L + 1], level: L + 1 });
      }
    } else if (P.leafCount > 0) {
      for (let k = 0; k < Math.max(0, P.leafCount - 1); k++) { const t = rnd(0.35, 1); const s = sections[Math.min(nSec, Math.round(t * nSec))]; leaves.push({ p: s.p.clone(), q: s.q.clone() }); }
      leaves.push({ p: sections[nSec].p.clone(), q: sections[nSec].q.clone() });
    }
  }
  return { branches, leaves, r0, trunkL };
}

function meshSkeleton(gb, sk, P, rng, detail, H) {
  const fl = P.flute, flPh = rng() * 6.28;
  for (const b of sk.branches) {
    if (detail === 1 && b.level >= 2) continue;
    if (b.level >= 3) continue;   // finest twigs sit inside the leaf clusters; not worth their vertices
    const segs = detail === 1 ? Math.max(3, Math.round(b.segs * 0.5)) : b.segs;
    const step = detail === 1 && b.sections.length > 4 ? 2 : 1;
    const secs = b.sections.filter((s, i) => i % step === 0 || i === b.sections.length - 1);
    const base = gb.p.length / 3; let len = 0;
    const uRep = Math.max(1, Math.round(2 * Math.PI * b.sections[0].r / 0.9));
    for (let i = 0; i < secs.length; i++) {
      const S = secs[i];
      if (i > 0) len += S.p.distanceTo(secs[i - 1].p);
      let r = S.r;
      if (b.level === 0) r *= 1 + P.flare * Math.exp(-Math.max(0, S.p.y) * 1.5);
      const hf = clamp(S.p.y / H, 0, 1);
      const wv = (b.level === 0 ? Math.pow(hf, 2.2) * 0.22 : 0.16 + 0.22 * b.level * hf);
      const ao = (0.62 + 0.38 * clamp((S.p.y + 0.2) / 2.4, 0, 1)) * (b.level === 0 ? 1 : 0.92);
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        let m = 1;
        if (fl && b.level === 0) m = 1 + fl.amp * Math.pow(Math.max(0, Math.cos(a * fl.n + flPh + S.p.y * 0.15)), 1.6) * Math.exp(-Math.max(0, S.p.y + 0.3) / fl.h);
        _vv.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(S.q);
        const nx = _vv.x, ny = _vv.y, nz = _vv.z, rr = r * m, gro = fl && b.level === 0 ? 0.8 + 0.2 * clamp(m - 0.6, 0, 1) : 1;
        gb.vert(S.p.x + nx * rr, S.p.y + ny * rr, S.p.z + nz * rr, nx, ny, nz, (j / segs) * uRep, len / 1.7, ao * gro, ao * gro, ao * gro, wv, rng());
      }
    }
    for (let i = 0; i < secs.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = base + i * (segs + 1) + j, bb = a + 1, c = a + segs + 1, d = c + 1;
      gb.i.push(a, c, bb, bb, c, d);
    }
  }
}

function buildGeneric(specName, seed) {
  const P = GROW[specName], spec = SPEC[specName], rng = mulberry32(seed);
  const sk = growSkeleton(P, rng);
  let H = 1; for (const b of sk.branches) for (const s of b.sections) H = Math.max(H, s.p.y);
  const gb = new GB(), lb = new GB();
  meshSkeleton(gb, sk, P, rng, 0, H);
  meshSkeleton(lb, sk, P, mulberry32(seed + 7), 1, H);
  // surface roots running out from the base into the litter
  const r0 = sk.r0;
  // they rise out of the flare, meander a little, run half-buried and dive under the litter within a few trunk
  // widths, tapering fast; shorter secondary roots between the main ones. Bark at its true scale (it used to be
  // wrapped once round each root, which stretched it smooth and plastic), darker where they meet the soil.
  const nR = P.roots || 0;
  for (let k = 0; k < nR * 2; k++) {
    const main = k < nR, a = main ? (k / nR) * 6.28 + (rng() - 0.5) * 0.6 : ((k - nR + 0.5) / nR) * 6.28 + (rng() - 0.5) * 0.4;
    const L = r0 * (main ? 2.2 + rng() * 1.8 : 1.0 + rng() * 0.9), rr = r0 * (main ? 0.34 + rng() * 0.14 : 0.17 + rng() * 0.08), wob = (rng() - 0.5) * 0.5;
    const pts = [], rads = [];
    for (let q = 0; q <= 8; q++) {
      const t = q / 8, d = r0 * 0.45 + t * L, aa = a + wob * Math.sin(t * 3 + k), rad = rr * (1 - 0.82 * t) + 0.012;
      pts.push([Math.cos(aa) * d, 0.55 * r0 * (1 - t) * (1 - t) + rad * 0.3 - t * t * rad * 1.7, Math.sin(aa) * d]); rads.push(rad);
    }
    // (the bark shader already darkens wood near the ground, so only a light contact shade here)
    tube(gb, pts, rads, 8, () => 0, rng(), Math.max(1, Math.round(2 * Math.PI * rr / 0.9)), 1, null, (p) => 0.82 + 0.18 * clamp(p[1] / 0.3, 0, 1));
  }
  if (P.snag) { const top = sk.branches[0].sections.at(-1); for (let k = 0; k < 4; k++) { const a = k * 1.57 + rng(); tube(gb, [[top.p.x, top.p.y, top.p.z], [top.p.x + Math.cos(a) * top.r * 0.5, top.p.y + 0.3 + rng() * 0.8, top.p.z + Math.sin(a) * top.r * 0.5]], [top.r * 0.5, 0.02], 4, () => 0.05, rng(), 1); } }
  // leaves: crossed cards at each twig, normals from the crown centre (soft, rounded canopy shading)
  const leafG = new GB(), leaf1 = new GB();
  let crownC = new THREE.Vector3(), crownR = 0.1;
  if (sk.leaves.length) {
    for (const l of sk.leaves) crownC.add(l.p); crownC.multiplyScalar(1 / sk.leaves.length);
    for (const l of sk.leaves) crownR = Math.max(crownR, l.p.distanceTo(crownC)); crownR *= 0.9;
    for (const l of sk.leaves) {
      const out = l.p.clone().sub(crownC).normalize();
      const dir = _vv.set(0, 1, 0).applyQuaternion(l.q);
      const up = dir.clone().multiplyScalar(0.6).add(out.multiplyScalar(0.7)).add(new THREE.Vector3(0, 0.5, 0)).add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.6)).normalize();
      const sz = P.leafSize[0] + rng() * (P.leafSize[1] - P.leafSize[0]);
      const C = l.p.clone().addScaledVector(up, -sz * 0.25);
      const w = 0.6 + 0.4 * clamp((l.p.y - H * 0.35) / H, 0, 1);
      card(leafG, C, up, sz, sz, crownC, crownR, w, rng(), rng, spec.tint);
      if (rng() < 0.4) card(leafG, C, up, sz * 0.85, sz * 0.85, crownC, crownR, w, rng(), rng, spec.tint); // second plane, crossed
    }
    // far LOD: a few big clumps at the ends of the main limbs
    const step = Math.max(1, Math.round(sk.leaves.length / 26));
    for (let i = 0; i < sk.leaves.length; i += step) {
      const l = sk.leaves[i], out = l.p.clone().sub(crownC).normalize();
      const up = out.multiplyScalar(0.55).add(new THREE.Vector3(0, 1, 0)).normalize();
      const sz = P.leafSize[1] * Math.sqrt(step) * 1.25;
      card(leaf1, l.p.clone().addScaledVector(up, -sz * 0.35), up, sz, sz, crownC, crownR, 0.5, rng(), rng, spec.tint);
    }
  }
  return { bark: gb.geo(), leaf: sk.leaves.length ? leafG.geo() : null, bark1: lb.geo(), leaf1: sk.leaves.length ? leaf1.geo() : null, H, trunkR: r0 * (1.25 + (P.flute ? P.flute.amp * 0.5 : 0)), crownY: crownC.y || H * 0.7, crownR, barkKind: spec.bark, leafKind: spec.leaf };
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

// fallen branch / old log lying in the litter
function buildDeadfall(seed) {
  const rng = mulberry32(seed); const gb = new GB();
  const L = 2.2 + rng() * 3.6, r0 = 0.08 + rng() * 0.16, a = rng() * 0.3;
  const pts = [], rads = [];
  for (let s = 0; s <= 6; s++) { const t = s / 6; pts.push([(t - 0.5) * L, r0 * 0.55 + Math.sin(t * 3 + a) * 0.05, Math.sin(t * 2.2 + a * 5) * 0.25]); rads.push(r0 * (1 - 0.45 * t)); }
  tube(gb, pts, rads, 6, () => 0, rng(), 1, 0.85, null, () => 0.75);
  const nb = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < nb; k++) {
    const t = 0.25 + rng() * 0.6, p = pts[Math.round(t * 6)], side = rng() < 0.5 ? -1 : 1;
    const l = 0.4 + rng() * 1.2, up = 0.15 + rng() * 0.5;
    tube(gb, [p, [p[0] + (rng() - 0.5) * 0.4, p[1] + up * l, p[2] + side * l]], [r0 * 0.45, 0.012], 4, () => 0, rng(), 1, 0.85);
  }
  return { bark: gb.geo(), leaf: null, bark1: new GB().geo(), leaf1: null, H: 0.5, trunkR: 0, crownY: 0.2, crownR: 0, barkKind: 'teak', leafKind: null, debris: true };
}
// a cluster of weathered gneiss / basalt stones, rounded and half sunk in the soil
function buildStones(seed) {
  const rng = mulberry32(seed); const gb = new GB();
  const n = 3 + Math.floor(rng() * 5); let big = 0;
  for (let k = 0; k < n; k++) {
    const sz = k === 0 ? 0.28 + rng() * 0.34 : 0.07 + Math.pow(rng(), 1.6) * 0.26; big = Math.max(big, sz);
    const cx = k === 0 ? 0 : (rng() - 0.5) * 2.4, cz = k === 0 ? 0 : (rng() - 0.5) * 2.4;
    let g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv'));
    const pa = g.attributes.position;
    const sx = sz * (0.85 + rng() * 0.5), sy = sz * (0.55 + rng() * 0.35), szz = sz * (0.85 + rng() * 0.45);
    const waves = []; for (let w = 0; w < 6; w++) { const a = rng() * 6.28, b = Math.acos(rng() * 2 - 1); waves.push([Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a), 1.5 + rng() * (w < 3 ? 1.5 : 5), rng() * 6.28, w < 3 ? 0.11 : 0.035]); }
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      let j = 1; for (const [dx, dy, dz, f, ph, amp] of waves) j += amp * Math.sin((x * dx + y * dy + z * dz) * f + ph);
      if (y > 0.35) y = 0.35 + (y - 0.35) * 0.75;                 // weathered, slightly flattened crown
      pa.setXYZ(i, cx + x * sx * j, (y - 0.3) * sy * j, cz + z * szz * j);
    }
    g.computeVertexNormals();
    const base = gb.p.length / 3, nn = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const ao = clamp(0.5 + (y / Math.max(0.05, sy) + 0.3) * 0.55, 0.38, 1.05);
      gb.vert(x, y, z, nn.getX(i), nn.getY(i), nn.getZ(i), (x + z) * 0.9, y * 0.9 + cx, ao, ao * 0.98, ao * 0.95, 0, rng());
    }
    for (let i = 0; i < g.index.count; i++) gb.i.push(base + g.index.getX(i));
    g.dispose();
  }
  return { bark: gb.geo(), leaf: null, bark1: new GB().geo(), leaf1: null, H: big, trunkR: big > 0.45 ? big * 0.95 : 0, aoR: big, crownY: 0.2, crownR: 0, barkKind: 'rock', leafKind: null, debris: true };
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
      attribute float aWind; attribute float aRand; varying float vRand; varying vec3 vWP2; varying vec3 vIPl; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}\n vRand = aRand;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wq = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq; vIPl = instanceMatrix[3].xyz;
        #else
          vIPl = vec3(0.0);
        #endif
        vWP2 = (modelMatrix * wq).xyz;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uLeafDrop; uniform vec3 uLeafTint; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uSunVis; varying float vRand; varying vec3 vWP2; varying vec3 vIPl;
      float lhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vRand < uLeafDrop) discard;
        { vec2 ddx = dFdx(vMapUv * 512.0), ddy = dFdy(vMapUv * 512.0);
          float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
          diffuseColor.a *= 1.0 + mip * 0.3; }
        float lh = lhash(vIPl.xz * 0.37 + 5.1);
        diffuseColor.rgb *= uLeafTint * (0.92 + 0.16 * fract(vRand * 13.7)) * mix(vec3(1.07, 1.03, 0.84), vec3(0.88, 1.0, 1.05), lh) * (0.9 + 0.2 * fract(lh * 5.7));`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);   // both faces share the crown's spherical normal (no back-face flip)`)
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
function barkMaterial(map, key, tint = 0xffffff, moss = 1, normalMap = null) {
  const m = new THREE.MeshStandardMaterial({ map, color: tint, roughness: 0.95, metalness: 0, vertexColors: true, normalMap });
  if (normalMap) m.normalScale.set(1.4, 1.4);
  m.userData.moss = { value: moss };
  patch(m, 'bark-' + key, (s) => {
    s.uniforms.uBarkMoss = m.userData.moss;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute float aWind; attribute float aRand; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;
      varying vec3 vIPb; varying vec3 vWPb; varying vec3 vWNb; varying float vLYb;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vLYb = position.y;\n${WIND_VERTEX}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wqb = vec4(transformed, 1.0); vec3 nWb = objectNormal;
        #ifdef USE_INSTANCING
          wqb = instanceMatrix * wqb; nWb = mat3(instanceMatrix) * nWb; vIPb = instanceMatrix[3].xyz;
        #else
          vIPb = vec3(0.0);
        #endif
        vWPb = (modelMatrix * wqb).xyz; vWNb = normalize(mat3(modelMatrix) * nWb);`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      ${NOISE_GLSL}
      uniform float uWetness, uSeasonGreen, uBarkMoss; varying vec3 vIPb; varying vec3 vWPb; varying vec3 vWNb; varying float vLYb;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float ih = hash12(vIPb.xz * 0.37 + 1.3);
        diffuseColor.rgb *= (0.84 + 0.32 * ih) * mix(vec3(1.05, 1.0, 0.93), vec3(0.93, 0.98, 1.05), fract(ih * 7.3));
        diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(-0.3, 1.5, vLYb));
        float lich = smoothstep(0.52, 0.74, vnoise(vec2(vWPb.x * 0.7 + vWPb.z * 0.7, vWPb.y * 1.4) * 1.6 + ih * 10.0)) * (0.35 + 0.65 * smoothstep(-0.3, 0.7, -vWNb.z));
        vec3 lc = mix(vec3(0.6, 0.62, 0.52), vec3(0.3, 0.4, 0.15), uSeasonGreen);
        diffuseColor.rgb = mix(diffuseColor.rgb, lc * (0.8 + 0.4 * ih), lich * 0.42 * uBarkMoss);
        diffuseColor.rgb *= mix(1.0, 0.72, uWetness);
      }`);
  });
  return m;
}

// ------------------------------------------------------------------ vegetation manager
const SPECIES_LIST = [
  { name: 'teak', variants: 5, build: (s) => buildGeneric('teak', s) },
  { name: 'mahua', variants: 3, build: (s) => buildGeneric('mahua', s) },
  { name: 'saja', variants: 3, build: (s) => buildGeneric('saja', s) },
  { name: 'kulu', variants: 3, build: (s) => buildGeneric('kulu', s) },
  { name: 'palash', variants: 3, build: (s) => buildGeneric('palash', s) },
  { name: 'small', variants: 3, build: (s) => buildGeneric('small', s) },
  { name: 'arjun', variants: 2, build: (s) => buildGeneric('arjun', s) },
  { name: 'dead', variants: 2, build: (s) => buildGeneric('dead', s) },
  { name: 'bamboo', variants: 3, build: (s) => buildBamboo(s) },
  { name: 'banyan', variants: 1, build: (s) => buildBanyan(s) },
  { name: 'lantana', variants: 2, build: (s) => buildLantana(s) },
  { name: 'deadfall', variants: 3, build: (s) => buildDeadfall(s) },
  { name: 'stones', variants: 3, build: (s) => buildStones(s) },
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
    this.colliders = []; this.rocks = []; this.perches = []; this.aoTrees = [];
    this.season = 'winter';
    for (const sp of SPECIES_LIST) {
      const arr = [];
      for (let v = 0; v < sp.variants; v++) arr.push(sp.build(1000 + SP[sp.name] * 37 + v * 11));
      this.templates.push(arr);
    }
    // materials per species
    const barkTint = { dead: 0x9a9088, deadfall: 0x8c8478, stones: 0xd2c8ba };
    const barkMoss = { kulu: 0.25, arjun: 0.45, bamboo: 0.2, stones: 1.3, deadfall: 1.4, saja: 1.1, teak: 0.9 };
    // scanned bark where a real bark matches the species: [scan, tint]
    const scan = { teak: ['oak', 0xd2c4ae], mahua: ['oak', 0x8e8070], saja: ['pine', 0x8a8580], palash: ['willow', 0xb4a490], small: ['willow', 0xc4b6a4], dead: ['oak', 0xb4aca2], deadfall: ['oak', 0x9c948a] };
    for (const sp of SPECIES_LIST) {
      const t0 = this.templates[SP[sp.name]][0], sc = scan[sp.name];
      this.barkMats[sp.name] = sc && T.scan ? barkMaterial(T.scan[sc[0]].map, sp.name, sc[1], barkMoss[sp.name] ?? 0.7, T.scan[sc[0]].normal)
        : barkMaterial(T.bark[t0.barkKind], sp.name, barkTint[sp.name] || 0xffffff, barkMoss[sp.name] ?? 0.7);
      if (t0.leafKind) {
        this.leafMats[sp.name] = leafMaterial(T.leaf[t0.leafKind], sp.name);
        if (quality.aa) this.leafMats[sp.name].alphaToCoverage = true;
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
        const nv = SPECIES_LIST[s].variants;
        const capMul = (name === 'teak' ? 1.0 : name === 'banyan' ? 0.1 : name === 'deadfall' || name === 'stones' ? 0.45 : 0.5) * Math.min(1, 1.9 / nv);
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
      } else if (r1 < dens + 0.06 + b.open * 0.1 + b.grass * 0.03 + 0.02 + b.teak * 0.05 + b.riparian * 0.04 + b.rock * 0.14 + b.sand * 0.25) {
        const stoneShare = clamp(0.3 + b.rock * 0.6 + b.sand * 0.6 + b.riparian * 0.2 - b.teak * 0.12, 0, 0.95);
        sp = r2 < stoneShare ? SP.stones : SP.deadfall; scale = 0.75 + r3 * 0.7;
        if (b.village > 0.3 || b.field > 0.2) sp = -1;
      } else if (b.village > 0.2 && b.field > 0.3 && r1 > 0.997) { sp = SP.mahua; scale = 1.1; }  // mahua kept in fields
      // drowned trees: Junewani Talao and the Totladoh margin keep the grey trunks of trees that died when the water rose
      const jw = WATERHOLES[2], jd = Math.hypot(x - jw.x, z - jw.z), le = lakeE(x, z);
      const drowned = (jd < jw.r * 0.85 && r4 < 0.12) || (le > 0.84 && le < 0.99 && r4 < 0.05);
      if (drowned) { sp = SP.dead; scale = 0.75 + r3 * 0.5; }
      if (sp < 0) continue;
      const y = height(x, z);
      if (!drowned && (sp === SP.stones ? waterAt(x, z) > y + 0.55 : waterAt(x, z) > y - 0.2)) continue;
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
    this.colliders.length = 0; this.rocks.length = 0; this.perches.length = 0; this.aoTrees.length = 0;
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
        const s = d[i + 4], deb = tmpl.debris;
        const gth = deb ? 1 : girthOf(x, z);
        if (near && tmpl.trunkR > 0) (deb ? this.rocks : this.colliders).push(x, z, tmpl.trunkR * s * gth * 0.92);
        if (near) this.aoTrees.push(x, z, deb ? (tmpl.aoR || 0) * s : tmpl.trunkR * s * gth * 0.8, tmpl.crownR * s * 0.8);
        if (near && !deb && sp !== SP.lantana && sp !== SP.bamboo && dist2 < 70 * 70) this.perches.push(x, y + tmpl.crownY * s * 0.85, z, sp);
        if (dist2 < R0s) {
          if (deb && dist2 > R0s * 0.6) continue;
          if (m.n0 < m.c0) { writeMat(m.b0, m.l0, m.n0, x, y, z, d[i + 3], s, gth, deb); m.n0++; }
        } else if (!deb && (sp !== SP.lantana || dist2 < R1s * 0.25)) {
          if (m.n1 < m.c1) { writeMat(m.b1, m.l1, m.n1, x, y - 0.6, z, d[i + 3], s, gth, false); m.n1++; }
        }
      }
    }
    for (const per of this.meshes) for (const m of per) {
      for (const [mesh, n] of [[m.b0, m.n0], [m.l0, m.n0], [m.b1, m.n1], [m.l1, m.n1]]) if (mesh) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
    }
    if (this.onRebuild) this.onRebuild({ x0: (pcx - 1) * CHUNK, z0: (pcz - 1) * CHUNK, size: 3 * CHUNK }, this.aoTrees);
    // prune far cells
    if (this.cells.size > 1600) for (const [k, c] of this.cells) { if (Math.abs(c.cx - pcx) > r + 3 || Math.abs(c.cz - pcz) > r + 3) this.cells.delete(k); }
  }
  collide(pos, radius) {
    let hit = false;
    for (const c of [this.colliders, this.rocks]) for (let i = 0; i < c.length; i += 3) {
      const dx = pos.x - c[i]; if (dx > 8 || dx < -8) continue;
      const dz = pos.z - c[i + 1]; if (dz > 8 || dz < -8) continue;
      const rr = c[i + 2] + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = c[i] + dx / d * rr; pos.z = c[i + 1] + dz / d * rr; hit = true; }
    }
    return hit;
  }
  // first trunk hit along a horizontal segment (for camera booms and projectiles); returns fraction 0..1 or 1
  segmentHit(ax, az, bx, bz, pad = 0.1) {
    let best = 1; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 1e-6) return 1;
    for (const c of [this.colliders, this.rocks]) for (let i = 0; i < c.length; i += 3) {
      const ox = c[i] - ax, oz = c[i + 1] - az, r = c[i + 2] + pad;
      if (ox * ox + oz * oz < r * r) continue; // the segment starts inside (standing against it): not a blocker
      const t = clamp((ox * dx + oz * dz) / L2, 0, 1), px = dx * t - ox, pz = dz * t - oz;
      if (px * px + pz * pz < r * r) { const back = Math.sqrt(Math.max(0, r * r - (px * px + pz * pz))) / Math.sqrt(L2); best = Math.min(best, Math.max(0, t - back)); }
    }
    return best;
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

const girthOf = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return 0.84 + 0.34 * (h - Math.floor(h)); };
const _wm = new THREE.Matrix4(), _wq = new THREE.Quaternion(), _wq2 = new THREE.Quaternion(), _we = new THREE.Euler(), _wp = new THREE.Vector3(), _ws = new THREE.Vector3(), _wn = new THREE.Vector3(), _wup = new THREE.Vector3(0, 1, 0);
function writeMat(bm, lm, idx, x, y, z, rot, s, g = 1, slopeAlign = false) {
  const h = Math.sin(x * 4.898 + z * 7.23) * 1458.5453, f = h - Math.floor(h);
  if (slopeAlign) {
    const e = 0.8, hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e);
    _wn.set(-hx, 2 * e, -hz).normalize();
    _wq2.setFromUnitVectors(_wup, _wn); _wq.setFromAxisAngle(_wup, rot); _wq.premultiply(_wq2);
    y -= 0.05;
  } else {
    _we.set((f - 0.5) * 0.07, rot, (((f * 7.13) % 1) - 0.5) * 0.07, 'YXZ'); _wq.setFromEuler(_we);
  }
  _wm.compose(_wp.set(x, y, z), _wq, _ws.set(s * g, s * (1.06 - (g - 0.84) * 0.25), s * g));
  const src = _wm.elements;
  for (const m of [bm, lm]) {
    if (!m) continue;
    const e = m.instanceMatrix.array, o = idx * 16;
    for (let k = 0; k < 16; k++) e[o + k] = src[k];
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
        uniform sampler2D tGroundAO; uniform vec4 uAORect;
        varying float vGT; varying vec3 vGW; varying float vGShade;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 gip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float gd = distance(gip.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(uGrassR * 0.65, uGrassR, gd);
          vec2 gaUV = (gip.xz - uAORect.xy) * uAORect.z;
          vec3 gao = (gaUV.x > 0.0 && gaUV.y > 0.0 && gaUV.x < 1.0 && gaUV.y < 1.0) ? texture2D(tGroundAO, gaUV).rgb * uAORect.w : vec3(0.0);
          vGShade = clamp(gao.g * 1.6, 0.0, 1.0);
          transformed.y *= uGrassH * fade * (1.0 - clamp(gao.r * 1.3, 0.0, 0.85)) * (1.0 - vGShade * 0.35);   // thin and short at trunk bases, under shade
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
        uniform float uSeasonGreen; varying float vGT; varying vec3 vGW; varying float vGShade;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float gn = vnoise(vGW.xz * 0.05) * 0.6 + vnoise(vGW.xz * 0.4) * 0.4;
          float green = clamp(uSeasonGreen * (0.7 + 0.6 * gn), 0.0, 1.0);
          vec3 dry = mix(vec3(0.62, 0.52, 0.30), vec3(0.78, 0.68, 0.42), gn);
          vec3 lush = mix(vec3(0.24, 0.40, 0.12), vec3(0.42, 0.56, 0.2), gn);
          vec3 gc = mix(dry, lush, green);
          gc = mix(gc, gc * vec3(1.2, 1.15, 0.8), vGT * 0.6);
          diffuseColor.rgb *= gc * 1.25 * (1.0 - vGShade * 0.22);
          { vec2 ddx = dFdx(vMapUv * 256.0), ddy = dFdy(vMapUv * 256.0); float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)))); diffuseColor.a *= 1.0 + mip * 0.35; }`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          normal = normalize(vNormal);`);
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

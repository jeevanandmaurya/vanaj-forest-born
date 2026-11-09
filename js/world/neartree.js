// The trees close to Vanaj, drawn and simulated in full. Every kind of tree has a second, far richer form, built
// once from the same skeleton as its instanced one, and swapped in for the few trees nearest him and any tree he is
// in:
//   bark     smooth curved limbs with collars where they meet, knobbly silhouettes, the finest twigs, and each
//            species' own bark drawn in the shader (teak's fissures, saja's crocodile blocks, kulu's pale peeling
//            patches, semal's lenticels, the banyan's braided strands), with moss on the upper sides of the limbs
//   leaves   true leaves of the species' own shape round every twig, under a finer version of the painted masses
//   extras   the semal's conical thorns, bracket fungi, moss cushions and climbing vines round the trunk
//
// The tree is a soft body, the way Quigley et al. ("Real-time Interactive Tree Animation", 2017) treat it: a
// hierarchy of branches on springs. Each branch's tip is a damped spring whose frequency falls with its length and
// rises with its thickness (a beam's), carried along on its parent, so a push on a limb runs out into its twigs and
// a swing yanks the limb it hangs from. The springs live on the CPU; their displacements go to the vertex shader in a
// small float texture, read per vertex through a branch index and a bend weight (Habel et al., "Physically Guided
// Animation of Trees", 2009, for the idea of hierarchical displacement in the shader).
import * as THREE from 'three';
import { mulberry32, clamp } from '../core/noise.js';
import { G, patch, NOISE_GLSL } from '../core/shaderlib.js';
import { toon } from '../core/toon.js';
import { PAINTED, PU } from '../core/palette.js';
import { BARK_COL, paintedLeafMaterial, BILLBOARD_VERTEX, getLeafSprite } from './flora.js';

const MAXB = 64, SLOTS = 8;
const bend = (t) => { t = clamp(t, 0, 1); return t * t * (3 - t) * 0.5; };   // the curve of a beam loaded at its end
const KIND = { small: 0, dead: 0, teak: 1, mahua: 2, saja: 3, kulu: 4, palash: 5, arjun: 6, semal: 7, banyan: 8, bamboo: 9 };
// leaf: shape and size (m) of the true leaves, and how many round each twig
const LEAF = { teak: ['broad', 0.5, 5], mahua: ['ovate', 0.2, 10], saja: ['ovate', 0.17, 10], kulu: ['lobed', 0.26, 6], palash: ['tri', 0.3, 7], small: ['ovate', 0.14, 11], arjun: ['ovate', 0.16, 11], semal: ['palm', 0.34, 7], banyan: ['fig', 0.16, 9], bamboo: ['lance', 0.2, 9] };

const SOFT_DECL = 'attribute vec2 aSoft; attribute float aSlot; uniform highp sampler2D tSoft;';
const SOFT_VERTEX = /* glsl */`
  { ivec2 sc = ivec2(int(aSoft.x + 0.5) * 2, int(aSlot + 0.5));
    vec3 sb = texelFetch(tSoft, sc, 0).xyz, sd = texelFetch(tSoft, sc + ivec2(1, 0), 0).xyz;
    transformed += sb + (sd - sb) * aSoft.y; }
`;

// ------------------------------------------------------------------------------------- geometry builder
class NB {
  constructor(sprite = false, withR = false) { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.r = []; this.s = sprite ? [] : null; this.ar = withR ? [] : null; this.as = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u, v, cr, cg, cb, w, r, br, bt, s = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(cr, cg, cb); this.w.push(w); this.r.push(r); this.as.push(br, bt);
    if (this.s) this.s.push(s); if (this.ar) this.ar.push(s);
    return this.p.length / 3 - 1;
  }
  geo() {
    const g = new THREE.BufferGeometry(), F = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', F(this.p, 3)); g.setAttribute('normal', F(this.n, 3)); g.setAttribute('uv', F(this.uv, 2)); g.setAttribute('color', F(this.c, 3));
    g.setAttribute('aWind', F(this.w, 1)); g.setAttribute('aRand', F(this.r, 1)); g.setAttribute('aSoft', F(this.as, 2));
    if (this.s) g.setAttribute('aSize', F(this.s, 1)); if (this.ar) g.setAttribute('aR', F(this.ar, 1));
    g.setIndex(this.i); g.computeBoundingSphere();
    return g;
  }
}
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _d = new THREE.Vector3(), _x = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3();

// every kind of source template reduced to one list of branches: { level, pts, r, q (optional frames), parent, tA }
function branchesOf(hi) {
  if (hi.kind === 'tree') return hi.sk.branches.map((b) => ({ level: b.level, pts: b.sections.map((s) => s.p), r: b.sections.map((s) => s.r), q: b.sections.map((s) => s.q), parent: b.parent ?? -1, tA: b.tA ?? 0, segs: b.segs }));
  return hi.branches.map((b) => ({ level: b.level, pts: b.pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), r: b.r, q: null, parent: b.parent ?? -1, tA: b.tA ?? 0, segs: b.segs || 8, softAs: b.softAs, noMesh: b.noMesh }));
}
// which branches get a spring of their own: trunk, limbs and big branches; finer ones ride on their parents
function softPlan(BR) {
  const sim = new Int16Array(BR.length).fill(-1), list = [];
  for (let i = 0; i < BR.length; i++) {
    const b = BR[i];
    if (b.softAs !== undefined) { sim[i] = sim[b.softAs]; continue; }
    if (b.level <= 2 && list.length < MAXB) { sim[i] = list.length; list.push(i); }
  }
  // parent's spring, and where along it this one is attached
  const par = new Int16Array(list.length).fill(-1), attach = new Float32Array(list.length), len = new Float32Array(list.length), rad = new Float32Array(list.length), lev = new Uint8Array(list.length);
  list.forEach((bi, k) => {
    const b = BR[bi]; let L = 0; for (let i = 1; i < b.pts.length; i++) L += b.pts[i].distanceTo(b.pts[i - 1]);
    len[k] = L; rad[k] = b.r[0]; lev[k] = b.level;
    let p = b.parent, t = b.tA;
    while (p >= 0 && sim[p] < 0) { t = BR[p].tA; p = BR[p].parent; }
    if (p >= 0) { par[k] = sim[p]; attach[k] = bend(t); }
  });
  return { sim, list, par, attach, len, rad, lev };
}
function softRef(BR, plan, bi, t) {   // the spring and bend weight for a point at fraction t along branch bi
  if (plan.sim[bi] >= 0) return [plan.sim[bi], bend(t)];
  let p = BR[bi].parent, tt = BR[bi].tA;
  while (p >= 0 && plan.sim[p] < 0) { tt = BR[p].tA; p = BR[p].parent; }
  return p >= 0 ? [plan.sim[p], bend(tt)] : [0, 0];
}

// ------------------------------------------------------------------------------------- bark
function meshBark(nb, BR, plan, hi, rng, lean) {
  const fl = hi.P && hi.P.flute, flPh = (hi.sk && hi.sk.flPh) || 0, flare = hi.P ? hi.P.flare : 0, H = hi.H, base = hi.kind === 'bamboo' ? 0.9 : 1;
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3(), last = new THREE.Vector3();
  BR.forEach((b, bi) => {
    const S = b.pts, n = S.length; if (n < 2 || b.noMesh) return;
    const lv = b.level, segs = lean ? (lv === 0 ? 10 : lv >= 2 ? 3 : 5) : lv >= 3 ? 4 : Math.max(lv === 0 ? 20 : 7, Math.round((b.segs || 8) * 1.7)), sub = lv >= 3 || (lean && lv >= 1) ? 1 : lean ? 2 : 3;
    const start = nb.p.length / 3, ph1 = rng() * 6.28, ph2 = rng() * 6.28, knob = lv === 0 ? 0.03 : lv === 1 ? 0.045 : lv === 2 ? 0.03 : 0, r00 = b.r[0];
    // Where a branch leaves its parent. A side branch swells into a collar, but never wider than the wood it grows from (its
    // first ring is inside that wood, so a wider one stood out as an open lip). A branch carrying straight on from its
    // parent's tip has no collar at all: the same width, the same place, so the two read as one piece of wood.
    const par = b.parent >= 0 ? BR[b.parent] : null, onTip = !par || b.tA >= 0.999;
    let collar = 0;
    if (par && !onTip && lv <= 2) { const f = b.tA * (par.r.length - 1), i0 = Math.min(par.r.length - 2, Math.floor(f)), pr = par.r[i0] + (par.r[i0 + 1] - par.r[i0]) * (f - i0); collar = clamp(pr * 0.94 / r00 - 1, 0, 0.55); }
    b.collar = r00 * (1 + collar);
    // the wind moves wood by how far out it is; each branch starts with what its parent has at that point, or the join opens up in a gust
    const windOf = (level, hfv) => (level === 0 ? Math.pow(hfv, 2.2) * 0.12 : 0.05 + 0.08 * Math.min(level, 2) * hfv), w00 = par ? windOf(par.level, clamp(S[0].y / H, 0, 1)) : 0;
    let lastW = 0, lastAo = 1, lastR = r00, sbL = 0, stL = 0;
    let L = 0; for (let i = 1; i < n; i++) L += S[i].distanceTo(S[i - 1]);
    let len = 0, rows = 0, prev = null;
    for (let i = 0; i < n; i++) for (let k = 0; k < (i === n - 1 ? 1 : sub); k++) {
      const t = k / sub, i1 = Math.min(n - 1, i + 1), t2 = t * t, t3 = t2 * t;
      p0.copy(S[Math.max(0, i - 1)]); p1.copy(S[i]); p2.copy(S[i1]); p3.copy(S[Math.min(n - 1, i + 2)]);
      // Catmull-Rom through the sections: the same line as the instanced tree's, without its kinks
      _p.set(0, 0, 0).addScaledVector(p1, 2).addScaledVector(_d.subVectors(p2, p0), t)
        .addScaledVector(_d.copy(p0).multiplyScalar(2).addScaledVector(p1, -5).addScaledVector(p2, 4).sub(p3), t2)
        .addScaledVector(_d.copy(p3).sub(p0).addScaledVector(p1, 3).addScaledVector(p2, -3), t3).multiplyScalar(0.5);
      _t.subVectors(p2, p0).addScaledVector(_d.copy(p0).multiplyScalar(2).addScaledVector(p1, -5).addScaledVector(p2, 4).sub(p3), 2 * t)
        .addScaledVector(_d.copy(p3).sub(p0).addScaledVector(p1, 3).addScaledVector(p2, -3), 3 * t2);
      if (_t.lengthSq() < 1e-8) _t.set(0, 1, 0); _t.normalize();
      // the ring's frame: the section's own twist where there is one (flutes line up), else carried along the curve
      if (b.q) { _q.copy(b.q[i]).slerp(b.q[i1], t); _x.set(1, 0, 0).applyQuaternion(_q); } else if (prev) _x.copy(prev); else _x.set(Math.abs(_t.y) > 0.9 ? 1 : 0, Math.abs(_t.y) > 0.9 ? 0 : 1, 0);
      _N.copy(_x).addScaledVector(_t, -_x.dot(_t)); if (_N.lengthSq() < 1e-6) _N.set(0, 0, 1).cross(_t); _N.normalize();
      prev = (prev || new THREE.Vector3()).copy(_N);
      _B.crossVectors(_N, _t);
      if (rows > 0) len += _p.distanceTo(last); last.copy(_p); rows++;
      let r = b.r[i] + (b.r[i1] - b.r[i]) * t;
      if (lv === 0) r *= 1 + flare * Math.exp(-Math.max(0, _p.y) * 1.5);
      else if (collar > 0) r *= 1 + collar * Math.exp(-len / Math.max(0.06, r00 * 2.2));
      const hf = clamp(_p.y / H, 0, 1), wv0 = windOf(lv, hf), wf = clamp(len / Math.max(0.3, L * 0.5), 0, 1), wv = par ? w00 + (wv0 - w00) * wf * wf * (3 - 2 * wf) : wv0;
      const ao = (0.62 + 0.38 * clamp((_p.y + 0.2) / 2.4, 0, 1)) * (lv === 0 ? 1 : 0.94);
      const [sb, st] = softRef(BR, plan, bi, (len + (L > 0 ? 0 : 0)) / Math.max(1e-3, L));
      lastW = wv; lastAo = ao; lastR = r; sbL = sb; stL = st;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        let m = 1 + knob * (Math.sin(a * 3 + ph1 + len * 1.7) + Math.sin(a * 5 + ph2 - len * 2.3)) * 0.5;
        if (fl && lv === 0) m *= 1 + fl.amp * Math.pow(Math.max(0, Math.cos(a * fl.n + flPh + _p.y * 0.15)), 1.6) * Math.exp(-Math.max(0, _p.y + 0.3) / fl.h);
        const nx = _N.x * c + _B.x * sn, ny = _N.y * c + _B.y * sn, nz = _N.z * c + _B.z * sn, rr = r * m, gro = fl && lv === 0 ? 0.8 + 0.2 * clamp(m - 0.6, 0, 1) : 1;
        nb.v(_p.x + nx * rr, _p.y + ny * rr, _p.z + nz * rr, nx, ny, nz, j / segs, len, ao * gro * base, ao * gro * base, ao * gro * base, wv, rng(), sb, st, rr);
      }
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < segs; j++) {
      const a = start + i * (segs + 1) + j, bb = a + 1, c = a + segs + 1, d = c + 1;
      nb.i.push(a, c, bb, bb, c, d);
    }
    // the end of the branch is closed, a blunt point, so there is no looking up into a hollow tube
    if (rows > 0) {
      const tip = nb.v(_p.x + _t.x * lastR * 0.7, _p.y + _t.y * lastR * 0.7, _p.z + _t.z * lastR * 0.7, _t.x, _t.y, _t.z, 0.5, len, lastAo * base, lastAo * base, lastAo * base, lastW, rng(), sbL, stL, lastR), e = start + (rows - 1) * (segs + 1);
      for (let j = 0; j < segs; j++) nb.i.push(e + j, tip, e + j + 1);
    }
  });
  // the surface roots, as they are on the instanced tree
  if (hi.tail) {
    const g = hi.tail(), P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color, W = g.attributes.aWind, R = g.attributes.aRand, off = nb.p.length / 3;
    for (let i = 0; i < P.count; i++) nb.v(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), UV.getX(i) * 0.3, UV.getY(i) * 1.7, C.getX(i), C.getY(i), C.getZ(i), W.getX(i), R.getX(i), 0, 0, 0.12);
    for (let i = 0; i < g.index.count; i++) nb.i.push(g.index.getX(i) + off);
  }
}

// ------------------------------------------------------------------------------------- leaves
const leafTex = new Map();
function leafTexture(shape) {
  if (leafTex.has(shape)) return leafTex.get(shape);
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  // a leaf: pale blade, darker midrib and side veins, drawn base at the bottom
  const blade = (cx, by, L, W, tilt = 0, tip = 0.85) => {
    x.save(); x.translate(cx, by); x.rotate(tilt);
    x.fillStyle = 'rgb(232,232,232)'; x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(-W, -L * 0.25, -W * tip, -L * 0.75, 0, -L); x.bezierCurveTo(W * tip, -L * 0.75, W, -L * 0.25, 0, 0); x.fill();
    x.strokeStyle = 'rgb(168,168,168)'; x.lineWidth = Math.max(1.4, L * 0.022); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -L * 0.97); x.stroke();
    x.lineWidth = Math.max(0.8, L * 0.011); x.strokeStyle = 'rgb(192,192,192)';
    for (let i = 1; i <= 5; i++) { const y = -L * (0.12 + i * 0.13), w = W * 0.74 * Math.sin(Math.min(1, (i + 0.4) / 6) * Math.PI) ; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(0, y); x.quadraticCurveTo(s * w * 0.5, y - L * 0.03, s * w, y - L * 0.09); x.stroke(); } }
    x.restore();
  };
  if (shape === 'broad') blade(64, 124, 118, 58, 0, 1.0);
  else if (shape === 'ovate') blade(64, 124, 118, 36, 0, 0.8);
  else if (shape === 'fig') blade(64, 122, 114, 42, 0, 0.72);
  else if (shape === 'lance') blade(64, 126, 122, 13, 0, 0.5);
  else if (shape === 'tri') { blade(64, 74, 70, 30); blade(60, 84, 60, 26, -1.1); blade(68, 84, 60, 26, 1.1); }   // palash: three leaflets
  else if (shape === 'palm') { for (const a of [-1.25, -0.62, 0, 0.62, 1.25]) blade(64, 92, 86 - Math.abs(a) * 16, 17, a); }   // semal: leaflets from one point
  else if (shape === 'lobed') { blade(64, 122, 106, 30); blade(62, 104, 74, 22, -0.72); blade(66, 104, 74, 22, 0.72); blade(61, 116, 50, 16, -1.35); blade(67, 116, 50, 16, 1.35); }   // kulu
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  leafTex.set(shape, t); return t;
}
// A spray of many of the species' own leaves, in three tones with gaps between, for the near tier's painted masses
const sprayTex = new Map();
function leafSprayTexture(shape) {
  if (sprayTex.has(shape)) return sprayTex.get(shape);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'), rng = mulberry32(shape.length * 977 + 13);
  const big = { broad: 0.3, palm: 0.26, tri: 0.25, lobed: 0.25, ovate: 0.17, fig: 0.18, lance: 0.2 }[shape] || 0.18, n = Math.round(10 / (big * big) * 0.11) + 10;
  const W = { broad: 0.5, ovate: 0.3, fig: 0.36, lance: 0.1, tri: 0.3, palm: 0.2, lobed: 0.34 }[shape] || 0.3;
  const leaf = (cx, cy, a, L, v) => {
    x.save(); x.translate(cx, cy); x.rotate(a);
    const P = (L0, W0, ang = 0, dark = 0) => { x.save(); x.rotate(ang); const w = L0 * W0; x.fillStyle = `rgb(${v - dark},${v - dark},${v - dark})`; x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(-w, -L0 * 0.28, -w * 0.8, -L0 * 0.74, 0, -L0); x.bezierCurveTo(w * 0.8, -L0 * 0.74, w, -L0 * 0.28, 0, 0); x.fill(); x.strokeStyle = `rgb(${v - 42},${v - 42},${v - 42})`; x.lineWidth = Math.max(1, L0 * 0.035); x.beginPath(); x.moveTo(0, -L0 * 0.05); x.lineTo(0, -L0 * 0.92); x.stroke(); x.restore(); };
    if (shape === 'palm') for (const q of [-1.1, -0.55, 0, 0.55, 1.1]) P(L * (1 - Math.abs(q) * 0.25), 0.2, q);
    else if (shape === 'tri') { P(L, 0.32); P(L * 0.75, 0.32, -1.0); P(L * 0.75, 0.32, 1.0); }
    else if (shape === 'lobed') { P(L, 0.3); P(L * 0.72, 0.28, -0.72); P(L * 0.72, 0.28, 0.72); }
    else P(L, W);
    x.restore();
  };
  // the dark ones first, inside; the pale ones last, outside and on top
  for (let tone = 0; tone < 3; tone++) for (let i = 0; i < n * (tone === 1 ? 1 : 0.6); i++) {
    const a = rng() * 6.283, r = S * (0.1 + 0.36 * Math.sqrt(rng())) * (tone === 0 ? 0.72 : tone === 1 ? 0.95 : 1.05), cx = S / 2 + Math.cos(a) * r * 0.5, cy = S / 2 + Math.sin(a) * r * 0.5;
    leaf(cx, cy, a + Math.PI / 2 + (rng() - 0.5) * 1.1, S * big * (0.8 + rng() * 0.5), [150, 200, 244][tone] + Math.round(rng() * 10));
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  sprayTex.set(shape, t); return t;
}
// one leaf: two facets folded along the midrib; stem at p, pointing along dir, its face toward up
function leafCard(nb, p, dir, up, size, tint, rnd, sb, st, shade) {
  const w = _x.crossVectors(dir, up).normalize(), f = size * 0.09, hw = size * 0.5, L = size;
  const base = nb.p.length / 3, nl = _N.copy(up).addScaledVector(w, -0.35).normalize(), nr = _B.copy(up).addScaledVector(w, 0.35).normalize();
  const put = (a, along, lift, u, v, n) => nb.v(p.x + dir.x * along + w.x * a + up.x * lift, p.y + dir.y * along + w.y * a + up.y * lift, p.z + dir.z * along + w.z * a + up.z * lift, n.x, n.y, n.z, u, v, shade * tint[0], shade * tint[1], shade * tint[2], 1, rnd, sb, st, size);
  put(-hw, 0, f, 0, 0, nl); put(0, 0, 0, 0.5, 0, nl); put(hw, 0, f, 1, 0, nr);
  put(-hw, L, f - L * 0.14, 0, 1, nl); put(0, L, -L * 0.14, 0.5, 1, nl); put(hw, L, f - L * 0.14, 1, 1, nr);
  nb.i.push(base, base + 4, base + 3, base, base + 1, base + 4, base + 1, base + 5, base + 4, base + 1, base + 2, base + 5);
}
function meshLeaves(cards, hi, BR, plan, name, rng, lean) {
  const spec = LEAF[name]; if (!spec) return;
  const size = spec[1] * (lean ? 1.5 : 1), per = Math.max(1, Math.round(spec[2] * (lean ? 0.5 : 1.5))), tint = (hi.spec && hi.spec.tint) || [1, 1, 1], tips = hi.kind === 'tree' ? hi.sk.leaves : hi.leaves;
  const dir = new THREE.Vector3(), up = new THREE.Vector3(), p = new THREE.Vector3(), o = new THREE.Vector3();
  for (const l of tips) {
    const [sb, st] = l.b !== undefined ? softRef(BR, plan, l.b, l.t ?? 1) : [0, 0];
    const pos = l.p || l.C;
    for (let k = 0; k < per; k++) {
      // round the twig tip, spreading outward from the crown's middle and hanging under their own weight
      o.set(rng() - 0.5, rng() - 0.3, rng() - 0.5).multiplyScalar(size * 2.1 + 0.2);
      p.copy(pos).add(o);
      dir.subVectors(p, hi.crownC).setY(0).normalize().multiplyScalar(0.55).add(o.normalize()); dir.y -= 0.35 + rng() * 0.45; dir.normalize();
      up.set((rng() - 0.5) * 0.7, 1, (rng() - 0.5) * 0.7).addScaledVector(dir, -dir.y).normalize();
      const shade = (0.82 + rng() * 0.28) * (0.8 + 0.28 * clamp((p.y - hi.crownC.y) / Math.max(1, hi.crownR) + 0.5, 0, 1));
      leafCard(cards, p, dir, up, size * (0.85 + rng() * 0.55), tint, rng(), sb, st, shade);
    }
  }
}
// a finer version of the painted masses: more, smaller sprites from the same positions
function meshSprites(nb, hi, BR, plan, rng, lean) {
  const src = hi.leafGeo(); if (!src) return;
  const P = src.attributes.position, N = src.attributes.normal, C = src.attributes.color, W = src.attributes.aWind, Z = src.attributes.aSize;
  // nearest simulated branch point for each sprite
  const seg = [];
  BR.forEach((b, bi) => { if (b.level > 2) return; for (let i = 0; i < b.pts.length; i += 1) { let L = 0; for (let k = 1; k < b.pts.length; k++) L += b.pts[k].distanceTo(b.pts[k - 1]); let s = 0; for (let k = 1; k <= i; k++) s += b.pts[k].distanceTo(b.pts[k - 1]); seg.push([b.pts[i], bi, s / Math.max(1e-3, L)]); } });
  const n = P.count / 4;
  for (let q = 0; q < n; q++) {
    const v = q * 4; _p.fromBufferAttribute(P, v);
    let best = null, bd = Infinity; for (const e of seg) { const d = e[0].distanceToSquared(_p); if (d < bd) { bd = d; best = e; } }
    const [sb, st] = best ? softRef(BR, plan, best[1], best[2]) : [0, 0];
    const size = Z.getX(v);
    for (let k = 0; k < (lean ? 1 : 3); k++) {
      const jx = k ? (rng() - 0.5) * size * 0.85 : 0, jy = k ? (rng() - 0.5) * size * 0.55 : 0, jz = k ? (rng() - 0.5) * size * 0.85 : 0, r = rng(), sz = size * (lean ? 0.75 : 0.42 + rng() * 0.18), base = nb.p.length / 3;
      for (const [u, vv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) nb.v(_p.x + jx, _p.y + jy, _p.z + jz, N.getX(v), N.getY(v), N.getZ(v), u, vv, C.getX(v), C.getY(v), C.getZ(v), W.getX(v), r, sb, st, sz);
      nb.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

// ------------------------------------------------------------------------------------- things that grow on trees
function col(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
function cone(nb, a, dir, len, r, C, tipC, sb, st) {
  const b = _d.copy(a).addScaledVector(dir, len).clone(), N = _N.set(dir.y, dir.z, -dir.x).cross(dir).normalize().clone(), B = _B.crossVectors(dir, N).clone(), base = nb.p.length / 3, seg = 6;
  for (let j = 0; j <= seg; j++) { const an = j / seg * 6.283, c = Math.cos(an), s = Math.sin(an), nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s; nb.v(a.x + nx * r, a.y + ny * r, a.z + nz * r, nx, ny, nz, 0, 0, C[0], C[1], C[2], 0, 0, sb, st); nb.v(b.x, b.y, b.z, nx, ny, nz, 0, 1, tipC[0], tipC[1], tipC[2], 0, 0, sb, st); }
  for (let j = 0; j < seg; j++) { const q = base + j * 2; nb.i.push(q, q + 1, q + 2, q + 2, q + 1, q + 3); }
}
function blob(nb, c, rx, ry, rz, C, rng, sb, st, Y = 8, X = 6) {   // a squashed lump (moss, a bracket's body)
  const base = nb.p.length / 3;
  for (let j = 0; j <= X; j++) for (let i = 0; i <= Y; i++) {
    const v = j / X * Math.PI, u = i / Y * 6.283, nx = Math.sin(v) * Math.cos(u), ny = Math.cos(v), nz = Math.sin(v) * Math.sin(u), k = 1 + (rng() - 0.5) * 0.14 * (i === Y ? 0 : 1), tone = 0.9 + 0.2 * (ny * 0.5 + 0.5);
    nb.v(c.x + nx * rx * k, c.y + ny * ry * k, c.z + nz * rz * k, nx, ny, nz, 0, 0, C[0] * tone, C[1] * tone, C[2] * tone, 0, 0, sb, st);
  }
  for (let j = 0; j < X; j++) for (let i = 0; i < Y; i++) { const a = base + j * (Y + 1) + i, b = a + 1, cc = a + Y + 1, d = cc + 1; nb.i.push(a, b, cc, b, d, cc); }
}
function meshExtras(nb, cards, hi, BR, plan, name, rng) {
  const trunk = BR[0]; if (!trunk || name === 'bamboo') return;
  const pts = trunk.pts, top = pts[pts.length - 1].y, H0 = Math.min(top, 12);
  const ptOn = (y) => { for (let i = 0; i < pts.length - 1; i++) if (y <= pts[i + 1].y) { const t = (y - pts[i].y) / Math.max(1e-3, pts[i + 1].y - pts[i].y); return { p: pts[i].clone().lerp(pts[i + 1], t), r: trunk.r[i] + (trunk.r[i + 1] - trunk.r[i]) * t, f: i + t }; } return { p: pts[pts.length - 1].clone(), r: trunk.r[trunk.r.length - 1], f: pts.length - 1 }; };
  const out = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
  // How far out the bark really is at this height and direction: the flare at the foot and the flutes or buttresses, as the
  // bark mesh has them. (Going by the plain radius sank fungi and climbers into the trunk low down.)
  const fl = hi.P && hi.P.flute, flPh = (hi.sk && hi.sk.flPh) || 0, flare = hi.P ? hi.P.flare : 0;
  const surf = (q, y, d) => {
    let r = q.r * (1 + flare * Math.exp(-Math.max(0, y) * 1.5));
    if (fl && trunk.q) {
      const f = clamp(q.f ?? 0, 0, trunk.q.length - 1), sq = trunk.q[Math.round(f)];
      _s1.set(1, 0, 0).applyQuaternion(sq); _s2.crossVectors(_s1, up).normalize();
      const a = Math.atan2(d.dot(_s2), d.dot(_s1));
      r *= 1 + fl.amp * Math.pow(Math.max(0, Math.cos(a * fl.n + flPh + y * 0.15)), 1.6) * Math.exp(-Math.max(0, y + 0.3) / fl.h);
    }
    return r;
  };
  // the silk-cotton's conical thorns, thick on the young bole
  if (name === 'semal') {
    const C = col(BARK_COL.semal).map((v) => v * 0.85), T = col('#b4aa98');
    for (let i = 0; i < 110; i++) { const y = 0.6 + rng() * rng() * H0, q = ptOn(y), a = rng() * 6.283; out.set(Math.cos(a), 0.15, Math.sin(a)).normalize(); cone(nb, q.p.clone().addScaledVector(out, surf(q, y, out) * 0.95), out, 0.05 + rng() * 0.07, 0.022 + rng() * 0.02, C, T, 0, bend(y / top)); }
  }
  // bracket fungi in shelves on the shaded side of older trunks
  if (name !== 'kulu' && rng() < 0.75) {
    const a0 = rng() * 6.283, C = col(rng() < 0.5 ? '#d8bd8a' : '#b98a54'), n = 3 + Math.floor(rng() * 4), y0 = 0.5 + rng() * 2.2;
    for (let i = 0; i < n; i++) { const y = y0 + i * (0.09 + rng() * 0.07), q = ptOn(y), a = a0 + (rng() - 0.5) * 0.7, s = 0.05 + rng() * 0.07; out.set(Math.cos(a), 0, Math.sin(a)); blob(nb, q.p.clone().addScaledVector(out, surf(q, y, out) * 0.98 + s * 0.4), s, s * 0.28, s, C, rng, 0, bend(y / top)); }
  }
  // moss in cushions along the tops of the big limbs and in the forks
  const moss = col('#5f7f35'), moss2 = col('#7d9440');
  BR.forEach((b, bi) => {
    if (b.level !== 1) return;
    for (let i = 0; i < b.pts.length; i++) {
      if (rng() > 0.62 || b.r[i] < 0.05) continue;
      const k = 3 + Math.floor(rng() * 4), [sb, st] = softRef(BR, plan, bi, i / (b.pts.length - 1));
      // on the top of the limb, flat to its surface; a limb rising steeply has no top for moss to lie on
      const dir = _s1.subVectors(b.pts[Math.min(b.pts.length - 1, i + 1)], b.pts[Math.max(0, i - 1)]).normalize();
      if (Math.abs(dir.y) > 0.62) continue;
      const nor = _s2.copy(up).addScaledVector(dir, -dir.y).normalize(), side = new THREE.Vector3().crossVectors(dir, nor);
      for (let m = 0; m < k; m++) {
        const s = b.r[i] * (0.22 + rng() * 0.3) + 0.012, an = (rng() - 0.5) * 1.1, c = b.pts[i].clone().addScaledVector(dir, (rng() - 0.5) * b.r[i] * 2).addScaledVector(nor, Math.cos(an) * b.r[i] * 0.98).addScaledVector(side, Math.sin(an) * b.r[i] * 0.98);
        blob(nb, c, s, s * 0.18, s, rng() < 0.5 ? moss : moss2, rng, sb, st, 9, 5);
      }
    }
  });
  // on some trees a climber winds up the trunk with its own small leaves
  if (name !== 'kulu' && name !== 'dead' && rng() < 0.55) {
    const a0 = rng() * 6.283, turns = 2 + rng() * 2.5, h = Math.min(H0, 5 + rng() * 5), n = 96, stem = col('#58602f'), leaf = [0.72, 1.0, 0.6], base = nb.p.length / 3, seg = 4, up = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = 0.1 + t * h, q = ptOn(y), a = a0 + t * turns * 6.283;
      out.set(Math.cos(a), 0, Math.sin(a)); const r = surf(q, y, out) * 1.03 + 0.012 + 0.012 * Math.sin(t * 40), c = q.p.clone().addScaledVector(out, r), rv = 0.02 * (1 - t * 0.6);
      for (let j = 0; j <= seg; j++) { const an = j / seg * 6.283, nx = out.x * Math.cos(an), nz = out.z * Math.cos(an), ny = Math.sin(an); nb.v(c.x + nx * rv, c.y + ny * rv, c.z + nz * rv, nx, ny, nz, 0, 0, stem[0], stem[1], stem[2], 0, 0, 0, bend(y / top)); }
      if (i % 6 === 0 && cards) { dir.copy(out).multiplyScalar(0.8); dir.y = -0.5; dir.normalize(); up.set(out.x * 0.5, 1, out.z * 0.5).normalize(); leafCard(cards, c, dir, up, 0.1 + rng() * 0.06, leaf, rng(), 0, bend(y / top), 0.9); }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < seg; j++) { const a = base + i * (seg + 1) + j, b = a + 1, cc = a + seg + 1, d = cc + 1; nb.i.push(a, cc, b, b, cc, d); }
  }
}

// lean (Low): the same tree in about a third of the triangles, fewer and larger leaves, and no moss, fungi or climbers on it
function buildHi(tmpl, name, seed, lean) {
  const hi = tmpl.hi, BR = branchesOf(hi), plan = softPlan(BR), rng = mulberry32(seed);
  const barkB = new NB(false, true), sprB = new NB(true), cardB = new NB(), extB = new NB();
  meshBark(barkB, BR, plan, hi, rng, lean);
  meshSprites(sprB, hi, BR, plan, rng, lean);
  meshLeaves(cardB, hi, BR, plan, name, rng, lean);
  if (!lean) meshExtras(extB, cardB, hi, BR, plan, name, rng);
  return { bark: barkB.geo(), sprites: sprB.p.length ? sprB.geo() : null, cards: cardB.p.length ? cardB.geo() : null, extras: extB.p.length ? extB.geo() : null, plan, BR };
}

// ------------------------------------------------------------------------------------- materials
const BARK_FRAG = /* glsl */`
  float cracks(float n, float w) { float a = abs(n - 0.5); float f = fwidth(n) + 1e-4; return smoothstep(w - f, w + f, a); }   // 0 in a crack
  // the species' bark as a height, 0 in the deepest cracks. bp runs round the limb in metres and along it.
  float barkH(float k, vec3 n0, float r, float s, out float tone) {
    tone = 1.0;
    vec3 b = n0 * r; float h = 1.0;
    if (k < 0.5) { vec3 q = b * 9.0; q.y += s * 1.5; h = cracks(vnoise3(q), 0.05); tone = 0.92 + 0.14 * vnoise3(q * 0.4); }
    else if (k < 1.5) { vec3 q = b * 13.0; q.y += s * 0.9; float a = vnoise3(q), c = vnoise3(q * vec3(0.5, 0.5, 0.5) + 9.0); h = cracks(a, 0.045) * (0.6 + 0.4 * cracks(c, 0.08)); tone = 0.88 + 0.22 * vnoise3(q * 0.35); }
    else if (k < 2.5) { vec3 q = b * 11.0; q.y += s * 3.4; vec2 cl = cell3(q); float e = cl.y - cl.x; float f = fwidth(e) + 1e-4; h = smoothstep(0.03 - f, 0.11 + f, e); tone = 0.86 + 0.2 * vnoise3(q * 0.5); }
    else if (k < 3.5) { vec3 q = b * 15.0; q.y += s * 5.0; vec2 cl = cell3(q); float e = cl.y - cl.x; float f = fwidth(e) + 1e-4; h = smoothstep(0.05 - f, 0.17 + f, e); tone = 0.82 + 0.3 * fract(cl.x * 17.0); }
    else if (k < 4.5) { vec3 q = b * 4.0; q.y += s * 1.5; float a = vnoise3(q); float f = fwidth(a) + 1e-4; h = 0.72 + 0.28 * smoothstep(0.52 - f, 0.52 + f, a); tone = mix(0.86, 1.08, smoothstep(0.42 - f, 0.42 + f, a)); }
    else if (k < 5.5) { vec3 q = b * 9.0; q.y += s * 2.6; float e = vnoise3(q); h = cracks(e, 0.07); tone = 0.84 + 0.26 * vnoise3(q * 1.7); }
    else if (k < 6.5) { vec3 q = b * 3.2; q.y += s * 1.1; float a = vnoise3(q), a2 = vnoise3(q * 2.3 + 4.0); float f = fwidth(a) + 1e-4; h = 0.82 + 0.18 * smoothstep(0.5 - f, 0.5 + f, a); tone = 0.88 + 0.12 * smoothstep(0.45, 0.55, a) + 0.14 * (smoothstep(0.55, 0.6, a2) - 0.5); }
    else if (k < 7.5) { vec3 q = b * 7.0; q.y += s * 0.9; h = 0.84 + 0.16 * cracks(vnoise3(q), 0.03); vec3 lq = b * 38.0; lq.y += s * 90.0; float l = vnoise3(lq); float f = fwidth(l) + 1e-4; h *= 1.0 - 0.16 * smoothstep(0.72 - f, 0.72 + f, l); tone = 0.92 + 0.14 * vnoise3(q * 0.3); }
    else if (k < 8.5) { vec3 q = b * 16.0; q.y += s * 0.35; float a = vnoise3(q); h = 0.35 + 0.65 * smoothstep(0.28, 0.5, a); tone = 0.88 + 0.2 * vnoise3(q * 0.4); }
    else { float node = fract(s * 2.6); float f = fwidth(s * 2.6) + 1e-4; h = 1.0 - 0.75 * (1.0 - smoothstep(0.0, 0.03 + f, min(node, 1.0 - node))); tone = 0.96 + 0.1 * vnoise3(b * 40.0); }
    return h;
  }`;
function nearBark(name, soft) {
  const uKind = { value: KIND[name] ?? 0 };
  return toon({
    color: new THREE.Color(BARK_COL[name] || '#7a6a58'), vertexColors: true, wind: true, rim: 0.5, key: 'nbark', patch: (s) => {
      s.uniforms.uKind = uKind; s.uniforms.tSoft = soft;
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n ${SOFT_DECL} attribute float aR; varying vec3 vN0; varying float vR, vS, vLYb;`)
        .replace('#include <project_vertex>', `${SOFT_VERTEX}\n vN0 = normal; vR = aR; vS = uv.y; vLYb = position.y;\n#include <project_vertex>`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n uniform float uKind, uSeasonGreen; varying vec3 vN0; varying float vR, vS, vLYb;\n${BARK_FRAG}\n float gBH = 1.0;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          { float tone; vec3 n0 = normalize(vN0);
            float h = barkH(uKind, n0, vR, vS, tone); gBH = h;
            diffuseColor.rgb *= tone * mix(0.42, 1.0, h);
            diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(-0.3, 1.2, vLYb));
            // lichen in pale flecks on the trunk, moss along the upper side of limbs and low on the shaded foot
            float q1 = vnoise3(n0 * vR * 19.0 + vec3(0.0, vS * 19.0, 3.0)), q2 = vnoise3(n0 * vR * 3.0 + vec3(0.0, vS * 3.0, 9.0)), w1 = fwidth(q1) + 1e-4;
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.34, 0.38, 0.3), vec3(0.5, 0.53, 0.43), q2), smoothstep(0.7 - w1, 0.7 + w1, q1) * smoothstep(0.5, 0.62, q2) * 0.5 * step(uKind, 8.5));
            float mos = smoothstep(0.55, 0.85, n0.y + (q2 - 0.5) * 0.8) + smoothstep(0.55, 0.05, vLYb) * smoothstep(0.5, 0.66, q2) * 0.7;
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.13, 0.19, 0.05), vec3(0.21, 0.28, 0.07), q1) * (0.7 + 0.5 * uSeasonGreen), clamp(mos, 0.0, 1.0) * step(uKind, 8.5) * (0.22 + 0.4 * uSeasonGreen)); }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
            float k = (1.0 - smoothstep(4.0, 22.0, length(vViewPosition))) * 0.016;
            if (k > 0.0 && dot(dx, dx) > 1e-14 && dot(dy, dy) > 1e-14) {
              float hh = gBH;
              vec3 r1 = cross(dy, normal), r2 = cross(normal, dx); float det = dot(dx, r1) * faceDirection;
              vec3 g = sign(det) * (dFdx(hh) * r1 + dFdy(hh) * r2) * k;
              vec3 nn = abs(det) * normal - g; if (dot(nn, nn) > 1e-14) normal = normalize(nn);
            } }`);
    },
  });
}
function softDepth(key, opt = {}) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: opt.map || null, alphaTest: opt.map ? 0.5 : 0 });
  patch(m, 'ndepth-' + key, (s) => {
    s.uniforms.tSoft = opt.soft; if (opt.drop) s.uniforms.uLeafDrop = opt.drop;
    let v = s.vertexShader.replace('#include <common>', `#include <common>\n ${SOFT_DECL} ${opt.sprite ? 'attribute float aRand; attribute float aSize; varying float vRand;' : ''}`);
    if (opt.sprite) v = v.replace('#include <project_vertex>', `${SOFT_VERTEX}\n vRand = aRand;\n ${BILLBOARD_VERTEX}`);
    else v = v.replace('#include <project_vertex>', `${SOFT_VERTEX}\n#include <project_vertex>`);
    s.vertexShader = v;
    if (opt.sprite) s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n uniform float uLeafDrop; varying float vRand;').replace('#include <map_fragment>', `#include <map_fragment>\n if (vRand < uLeafDrop) discard;`);
  });
  return m;
}

// ------------------------------------------------------------------------------------- the soft body
const _w = new THREE.Vector3();
export class SoftTree {
  constructor(plan, T, inst) {
    const n = plan.list.length; this.n = n; this.plan = plan; this.T = T;
    this.u = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.F = new Float32Array(n * 3);
    this.B = new Float32Array(n * 3); this.D = new Float32Array(n * 3); this.vb = new Float32Array(n * 3); this.Bp = new Float32Array(n * 3);
    this.om = new Float32Array(n); this.ph = new Float32Array(n); this.ws = new Float32Array(n);
    const rs = T.s * T.g;
    for (let i = 0; i < n; i++) {
      const L = plan.len[i] * rs, r = plan.rad[i] * rs, f = clamp(200 * r / Math.max(0.5, L * L), plan.lev[i] === 0 ? 0.22 : 0.45, 3.4);
      this.om[i] = 2 * Math.PI * f; this.ph[i] = i * 2.4 + T.x * 0.3;
      this.ws[i] = plan.lev[i] === 0 ? 0.05 + 0.006 * L : plan.lev[i] === 1 ? 0.05 + 0.01 * L : 0.09 + 0.02 * L;   // how far wind moves it (m)
    }
    // world directions to this instance's own frame, for the shader (the inverse of the instance's 3x3)
    const e = inst.instanceMatrix.array, m = new THREE.Matrix3().set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]).invert();
    this.inv = m.elements.slice();
  }
  simOf(bi) { return bi === undefined ? 0 : Math.max(0, this.plan.sim[bi] ?? 0); }
  // load the branch so it sits `d` (a vector, m) from rest at fraction t along it
  droop(i, t, dx, dy, dz) { const w = this.om[i] * this.om[i] / Math.max(0.15, bend(t)), k = i * 3; this.F[k] += dx * w; this.F[k + 1] += dy * w; this.F[k + 2] += dz * w; }
  kick(i, vx, vy, vz) { const k = i * 3; this.v[k] += vx; this.v[k + 1] += vy; this.v[k + 2] += vz; }
  // how far the point at fraction t along spring i has moved
  dispAt(i, t, out) { const k = i * 3, b = bend(t); return out.set(this.B[k] + (this.D[k] - this.B[k]) * b, this.B[k + 1] + (this.D[k + 1] - this.B[k + 1]) * b, this.B[k + 2] + (this.D[k + 2] - this.B[k + 2]) * b); }
  step(dt) {
    const { n, u, v, F, B, D, vb, Bp, om, ws, ph, plan } = this, wind = G.uWind.value, st = G.uWindStrength.value, time = G.uTime.value, ZETA = 0.17;
    for (let i = 0; i < n; i++) {
      const k = i * 3, p = plan.par[i], w0 = om[i], w2 = w0 * w0;
      let bx = 0, by = 0, bz = 0;
      if (p >= 0) { const q = p * 3, a = plan.attach[i]; bx = B[q] + (D[q] - B[q]) * a; by = B[q + 1] + (D[q + 1] - B[q + 1]) * a; bz = B[q + 2] + (D[q + 2] - B[q + 2]) * a; }
      // the base's acceleration swings the branch the other way: a limb whips when what it grows from jerks
      const nvx = (bx - Bp[k]) / dt, nvy = (by - Bp[k + 1]) / dt, nvz = (bz - Bp[k + 2]) / dt;
      const ax = (nvx - vb[k]) / dt, ay = (nvy - vb[k + 1]) / dt, az = (nvz - vb[k + 2]) / dt;
      vb[k] = nvx; vb[k + 1] = nvy; vb[k + 2] = nvz; Bp[k] = bx; Bp[k + 1] = by; Bp[k + 2] = bz;
      const gust = (0.55 + 0.45 * Math.sin(time * 0.31 + ph[i] * 0.05)) * (0.5 + 0.6 * Math.sin(time * w0 * 0.42 + ph[i]));
      const wf = ws[i] * st * gust * w2, cpl = 0.55;
      for (let c = 0; c < 3; c++) {
        const wd = c === 0 ? wind.x : c === 2 ? wind.y : 0, ab = c === 0 ? ax : c === 1 ? ay : az;
        const f = F[k + c] + wd * wf - clamp(ab, -60, 60) * cpl;
        v[k + c] += (f - w2 * u[k + c] - 2 * ZETA * w0 * v[k + c]) * dt;
        u[k + c] += v[k + c] * dt;
        F[k + c] = 0;
      }
      B[k] = bx; B[k + 1] = by; B[k + 2] = bz; D[k] = bx + u[k]; D[k + 1] = by + u[k + 1]; D[k + 2] = bz + u[k + 2];
    }
  }
  write(data, row, W) {
    const e = this.inv, o0 = row * W * 4;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      for (let t = 0; t < 2; t++) {
        const A = t ? this.D : this.B, x = A[k], y = A[k + 1], z = A[k + 2], o = o0 + (i * 2 + t) * 4;
        data[o] = e[0] * x + e[3] * y + e[6] * z; data[o + 1] = e[1] * x + e[4] * y + e[7] * z; data[o + 2] = e[2] * x + e[5] * y + e[8] * z;
      }
    }
  }
}

// ------------------------------------------------------------------------------------- the near set
export class NearTrees {
  constructor(game) {
    this.g = game; this.veg = game.veg; this.scene = game.scene; const q = game.q;
    this.applyQuality();
    this.cache = new Map(); this.slots = []; this.t = 0; this.mats = {};
    this.W = MAXB * 2; this.data = new Float32Array(this.W * SLOTS * 4);
    const tex = new THREE.DataTexture(this.data, this.W, SLOTS, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true; this.tex = tex; this.tSoft = { value: tex };
  }
  applyQuality() {
    const q = this.g.q;
    this.max = !PAINTED ? 0 : Math.min(SLOTS, q.nearMax);
    // (nearR 0: only for the tree he is climbing. Walking past, the nearest tree kept swapping between its two forms, a jump you could see.)
    this.R = q.nearR;
    if (this.cache && this.lean !== !!q.lean) this.cache.clear();   // (the lean trees or the full ones: make them afresh)
    this.lean = !!q.lean;
  }
  mat(name) {
    if (this.mats[name]) return this.mats[name];
    const lm = this.veg.leafMats[name], soft = this.tSoft;
    const out = { bark: nearBark(name, soft), barkD: softDepth('bark', { soft }), ext: toon({ color: 0xffffff, vertexColors: true, rim: 0.3, key: 'next', patch: (s) => { s.uniforms.tSoft = soft; s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n ${SOFT_DECL}`).replace('#include <project_vertex>', `${SOFT_VERTEX}\n#include <project_vertex>`); } }) };
    if (lm && lm.userData.drop) {
      // the painted masses, finer, dissolving further out so that up close it is the true leaves and twigs you see
      const sp = paintedLeafMaterial('near', { share: lm.userData, soft: { decl: SOFT_DECL, vertex: SOFT_VERTEX, tex: soft }, fade: [2.6, 7.5], map: leafSprayTexture((LEAF[name] || ['ovate'])[0]) });
      out.spr = sp; out.sprD = softDepth('spr', { soft, sprite: true, map: getLeafSprite(), drop: lm.userData.drop });
      const spec = LEAF[name];
      if (spec) {
        const map = leafTexture(spec[0]);
        out.card = toon({
          map, alphaTest: 0.5, vertexColors: true, wind: true, rim: 0.25, side: THREE.DoubleSide, key: 'ncard', patch: (s) => {
            s.uniforms.uLeafDrop = lm.userData.drop; s.uniforms.uLeafTint = lm.userData.tint; s.uniforms.uFlower = lm.userData.flower; s.uniforms.tSoft = soft; Object.assign(s.uniforms, PU);
            s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n ${SOFT_DECL} varying float vRand;`)
              .replace('#include <project_vertex>', `${SOFT_VERTEX}\n vRand = aRand;\n#include <project_vertex>`);
            s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n uniform float uLeafDrop; uniform vec3 uLeafTint, uLeafShade, uLeafLit; uniform vec4 uFlower; varying float vRand;')
              .replace('#include <map_fragment>', `#include <map_fragment>\n if (vRand < uLeafDrop) discard;\n if (length(vViewPosition) < 0.45) discard;`)
              .replace('#include <color_fragment>', `#include <color_fragment>
                diffuseColor.rgb *= mix(uLeafShade, uLeafLit, 0.5 + 0.35 * (fract(vRand * 5.3) - 0.5)) * uLeafTint * (0.95 + 0.12 * fract(vRand * 13.7));
                diffuseColor.rgb = mix(diffuseColor.rgb, uFlower.rgb * vColor, step(fract(vRand * 7.31), uFlower.a));`);
          },
        });
      }
    }
    return (this.mats[name] = out);
  }
  hiFor(T) { let h = this.cache.get(T.tmpl); if (!h) { h = buildHi(T.tmpl, T.spName, 3301 + T.tmpl.seed, this.lean); this.cache.set(T.tmpl, h); } return h; }
  // all detailed meshes up front, during loading, so none is built mid-game: for the shapes in use on this level, in this level's form
  prebuild() {
    if (!this.max) return;
    this.veg.templates.forEach((arr, s) => { for (let v = 0; v < arr.length; v++) {
      const t = arr[v]; if (!t.hi) break;
      if (this.veg.nearShape(s, v) === v && !this.cache.has(t)) this.cache.set(t, buildHi(t, t.spName, 3301 + t.seed, this.lean));
    } });
  }
  softOf(T) { for (const s of this.slots) if (s.T === T || (T && s.T.key === T.key)) return s.soft; return null; }
  slotOf(T) { for (const s of this.slots) if (s.T.key === T.key) return s; return null; }
  makeSlot(T, hi, row) {
    const M = this.mat(T.spName), meshes = [];
    const mk = (geo, mat, depth, shadow = true) => {
      if (!geo || !mat) return null;
      const g = new THREE.BufferGeometry(); for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]); g.setIndex(geo.index);
      g.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Float32Array([row]), 1));
      const m = new THREE.InstancedMesh(g, mat, 1); m.castShadow = shadow; m.receiveShadow = !(mat === M.spr || mat === M.card); m.frustumCulled = false; if (depth) m.customDepthMaterial = depth;
      this.scene.add(m); meshes.push(m); return m;
    };
    const b = mk(hi.bark, M.bark, M.barkD); mk(hi.sprites, M.spr, M.sprD); mk(hi.cards, M.card, null, false); mk(hi.extras, M.ext, M.barkD);
    for (const m of meshes) this.veg.writeNear(m, T);
    const soft = new SoftTree(hi.plan, T, b);
    this.veg.hide(T.key);
    return { T, row, meshes, soft, hi };
  }
  update(focus, dt, force) {
    if (!this.max) return;
    if (--this.t <= 0) {
      this.t = 12;
      // ranked by how close he is to the tree's crown, not its trunk: under a banyan he is near it, however far its trunk
      const reach = (t) => Math.hypot(t.x - focus.x, t.z - focus.z) - t.tmpl.crownR * t.s * 0.6;
      const list = !this.R ? [] : this.veg.climbNear(focus.x, focus.z, this.R + 12).filter((t) => t.tmpl && t.tmpl.hi && reach(t) < this.R).sort((a, b) => reach(a) - reach(b));
      const want = list.slice(0, this.max);
      if (force && !want.some((t) => t.key === force.key)) { want.pop(); want.unshift(force); }
      for (const s of this.slots) if (!want.some((t) => t.key === s.T.key)) { for (const m of s.meshes) { this.scene.remove(m); m.geometry.dispose(); } this.veg.show(s.T.key); s.row = -s.row - 1; }
      this.slots = this.slots.filter((s) => s.row >= 0);
      let built = 0;
      for (const T of want) {
        if (this.slots.some((s) => s.T.key === T.key)) continue;
        if (!this.cache.has(T.tmpl) && built++) { this.t = 2; continue; }   // at most one new build per tick
        const used = new Set(this.slots.map((s) => s.row)); let row = 0; while (used.has(row)) row++;
        if (row >= SLOTS) break;
        this.slots.push(this.makeSlot(T, this.hiFor(T), row));
      }
    }
    const h = Math.min(0.033, Math.max(0.001, dt));
    for (const s of this.slots) { s.soft.step(h); s.soft.write(this.data, s.row, this.W); }
    if (this.slots.length) this.tex.needsUpdate = true;
  }
}

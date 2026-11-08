// The opening, as a sketchbook: rough toon drawings on paper, made in code. Each panel is redrawn about twelve times a
// second with its lines wobbling a little ("line boil", as in hand-drawn animation), starts by being drawn onto the page
// stroke by stroke, and moves in simple cut-out fashion. Coordinates in a panel run 0-1600 by 0-900.
const INK = '#2a2018', PAPER = '#efe3c8';
const W = 1600, H = 900;
const C = { storm: '#67737c', sky: '#a8b4b0', dusk: '#c9a98a', hill: '#6f8466', hill2: '#8ea088', leaf: '#6f8a4e', leaf2: '#4f6c3e', flood: '#8d7655', river: '#7f9a90', night: '#34404c', nightR: '#46565c', sand: '#d9c292', skin: '#b67f55', hair: '#2b1d14', sari: '#b8483a', cloth: '#efe7d4', wolf: '#8d8c88', wolfD: '#5f5e5b', wood: '#8a6238', woodD: '#5e4228', steel: '#b4bcc0', bull: '#c8b48e', dawn: '#e8c9a0', den: '#57463a' };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
const ell = (x, y, rx, ry = rx, rot = 0, n = 10) => { const p = [], c = Math.cos(rot), s = Math.sin(rot); for (let i = 0; i < n; i++) { const a = i / n * 6.2832, X = Math.cos(a) * rx, Y = Math.sin(a) * ry; p.push([x + X * c - Y * s, y + X * s + Y * c]); } return p; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

class Ink {
  constructor(x) { this.x = x; this.n = 0; this.limit = Infinity; this.boil = 0; }
  // a Catmull-Rom path through the points
  curve(pts, closed, jit) {
    const out = [], n = pts.length, P = pts.map((p, i) => [p[0] + hash(this.n * 3.1 + i * 7.7 + this.boil) * jit, p[1] + hash(this.n * 5.3 + i * 3.3 + this.boil * 1.7) * jit]);
    const get = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]), segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2);
      for (let k = 0; k < 5; k++) { const t = k / 5, t2 = t * t, t3 = t2 * t; out.push([0.5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * t3), 0.5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * t3)]); }
    }
    if (!closed) out.push(P[n - 1]);
    return out;
  }
  go() { this.n++; return this.n <= this.limit; }
  // a pen line, thick in the middle and thin at the ends, with a fainter second try beside it as in a rough drawing
  line(pts, w = 3, col = INK, jit = 1.6) {
    if (!this.go()) return;
    const x = this.x;
    for (let pass = 0; pass < 2; pass++) {
      const c = this.curve(pts, false, pass ? jit * 1.9 : jit), n = c.length, L = [], R = [], ww = pass ? w * 0.45 : w;
      for (let i = 0; i < n; i++) {
        const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, th = ww * (0.32 + 0.68 * Math.sin((i + 0.5) / n * Math.PI)) * 0.5;
        L.push([c[i][0] - dy / l * th, c[i][1] + dx / l * th]); R.push([c[i][0] + dy / l * th, c[i][1] - dx / l * th]);
      }
      x.fillStyle = col; x.globalAlpha = pass ? 0.4 : 0.95;
      x.beginPath(); x.moveTo(L[0][0], L[0][1]); for (let i = 1; i < n; i++) x.lineTo(L[i][0], L[i][1]); for (let i = n - 1; i >= 0; i--) x.lineTo(R[i][0], R[i][1]); x.closePath(); x.fill();
    }
    x.globalAlpha = 1;
  }
  // a watercolour wash: flat colour, a little off the line, darker at the edge
  wash(pts, col, a = 0.85, jit = 2.2) {
    if (!this.go()) return;
    const x = this.x, c = this.curve(pts, true, jit);
    x.save(); x.translate(3, 2); x.beginPath(); x.moveTo(c[0][0], c[0][1]); for (let i = 1; i < c.length; i++) x.lineTo(c[i][0], c[i][1]); x.closePath();
    x.globalAlpha = a; x.fillStyle = col; x.fill(); x.globalAlpha = a * 0.3; x.strokeStyle = col; x.lineWidth = 5; x.stroke(); x.restore(); x.globalAlpha = 1;
  }
  // a washed shape with an inked outline
  shape(pts, col, w = 3, a = 0.9) { this.wash(pts, col, a); this.line([...pts, pts[0], pts[1]], w); }
  // shading: quick parallel pen strokes
  hatch(x0, y0, x1, y1, gap = 14, slant = 16, a = 0.45, col = INK) {
    if (!this.go()) return;
    const x = this.x; x.beginPath(); x.strokeStyle = col; x.globalAlpha = a; x.lineWidth = 1.4;
    for (let X = x0, i = 0; X < x1; X += gap, i++) { const j = hash(i * 9.1 + this.n + this.boil) * 3; x.moveTo(X + j, y0 + hash(i + 2.2) * 6); x.lineTo(X + slant + j, y1 + hash(i + 7.4) * 6); }
    x.stroke(); x.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------- things to draw
const sky = (I, col, col2, y = 620) => { I.wash([[-20, -20], [1620, -20], [1620, y], [-20, y]], col, 0.85, 0); if (col2) I.wash([[-20, y * 0.45], [1620, y * 0.45], [1620, y], [-20, y]], col2, 0.55, 0); };
function cloud(I, x, y, s, col) {
  const p = []; for (let i = 0; i < 9; i++) { const a = Math.PI + i / 8 * Math.PI; p.push([x + Math.cos(a) * 170 * s, y + Math.sin(a) * (60 + 26 * Math.abs(hash(i + x))) * s]); }
  p.push([x + 150 * s, y + 24 * s], [x, y + 34 * s], [x - 150 * s, y + 22 * s]);
  I.shape(p, col, 2.4, 0.85);
  for (let i = 0; i < 3; i++) I.line([[x - 110 * s + i * 80 * s, y - 16 * s], [x - 70 * s + i * 80 * s, y - 40 * s], [x - 24 * s + i * 80 * s, y - 20 * s]], 1.6);
}
function hills(I, y, amp, col, seed, w = 2.4) {
  const p = [[-40, H + 40]]; for (let i = 0; i <= 10; i++) p.push([-40 + i * 168, y + hash(i * 1.7 + seed) * amp + Math.sin(i * 0.9 + seed) * amp * 0.6]); p.push([1660, H + 40]);
  I.wash(p, col, 0.9, 1); I.line(p.slice(1, -1), w);
}
function tree(I, x, y, s, sway = 0) {
  I.shape([[x - 13 * s, y], [x - 9 * s, y - 120 * s], [x + 9 * s, y - 120 * s], [x + 14 * s, y]], C.woodD, 2.2, 0.8);
  I.line([[x, y - 90 * s], [x + 44 * s, y - 150 * s]], 3 * s); I.line([[x, y - 110 * s], [x - 40 * s, y - 165 * s]], 3 * s);
  const bx = x + sway * s; I.shape(ell(bx, y - 205 * s, 104 * s, 88 * s, 0, 12).map((q, i) => [q[0] + hash(i + x) * 16 * s, q[1] + hash(i * 2 + x) * 14 * s]), C.leaf, 2.2, 0.82);
  I.line([[bx - 60 * s, y - 225 * s], [bx - 30 * s, y - 250 * s], [bx, y - 232 * s]], 1.5); I.line([[bx + 20 * s, y - 175 * s], [bx + 55 * s, y - 196 * s], [bx + 74 * s, y - 180 * s]], 1.5);
  I.hatch(bx - 60 * s, y - 165 * s, bx + 50 * s, y - 135 * s, 13, -14, 0.35);
}
// a band of moving water, its surface at y(x)
function water(I, y0, col, t, o = {}) {
  const amp = o.amp ?? 10, sp = o.sp ?? 1.1, top = [];
  for (let i = 0; i <= 16; i++) { const X = -40 + i * 105; top.push([X, y0 + Math.sin(i * 0.9 + t * sp) * amp + (o.tilt || 0) * (X - 800)]); }
  I.wash([...top, [1660, H + 40], [-40, H + 40]], col, o.a ?? 0.92, 1);
  I.line(top, 3);
  const rows = o.rows ?? 4;
  for (let r = 0; r < rows; r++) for (let k = 0; k < 5; k++) {
    const X = ((k * 340 + r * 170 + t * (55 + r * 25)) % 1800) - 100, Y = y0 + 44 + r * 56 + Math.sin(k * 2 + r + t) * 6 + (o.tilt || 0) * (X - 800);
    I.line([[X, Y], [X + 44, Y - 8], [X + 92, Y], [X + 130, Y - 6]], 1.7);
  }
}
function rain(x, t, n = 110, slant = -0.28, a = 0.42) {
  x.strokeStyle = '#3a4a52'; x.lineWidth = 1.5; x.globalAlpha = a; x.beginPath();
  for (let i = 0; i < n; i++) { const sp = 900 + (i % 5) * 120, y = ((i * 89 + t * sp) % 1000) - 60, X = ((i * 173) % 1800) - 100 - y * slant, l = 34 + (i % 4) * 8; x.moveTo(X, y); x.lineTo(X + slant * l, y + l); }
  x.stroke(); x.globalAlpha = 1;
}
function face(I, x, y, r, o = {}) {
  const f = o.f ?? 1;
  I.shape(ell(x, y, r, r * 1.06, 0, 9), o.skin || C.skin, Math.max(2, r * 0.07), 0.95);
  if (o.hair !== false) { const h = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * (1.02 + i / 8 * 0.98) + (o.hairTip || 0); h.push([x + Math.cos(a) * r * 1.07, y + Math.sin(a) * r * 1.1]); } h.push([x + r * 0.5 * f, y - r * 0.55], [x - r * 0.3 * f, y - r * 0.6]); I.shape(h, o.hairCol || C.hair, Math.max(1.6, r * 0.05), 0.97); }
  if (o.bun) I.shape(ell(x - f * r * 0.92, y - r * 0.5, r * 0.38), C.hair, 2, 0.97);
  const eyeY = y - r * 0.05, ex = x + f * r * 0.28, gap = r * 0.42, ew = Math.max(2.4, r * 0.11);
  if (o.closed) { I.line([[ex - gap * 0.55, eyeY], [ex - gap * 0.3, eyeY + r * 0.08], [ex - gap * 0.05, eyeY]], ew * 0.8); I.line([[ex + gap * 0.3, eyeY], [ex + gap * 0.55, eyeY + r * 0.08], [ex + gap * 0.8, eyeY]], ew * 0.8); }
  else { I.wash(ell(ex - gap * 0.3, eyeY, ew, ew * 1.25, 0, 6), INK, 1, 0.5); I.wash(ell(ex + gap * 0.55, eyeY, ew, ew * 1.25, 0, 6), INK, 1, 0.5); }
  if (o.brow !== false) { const b = o.browUp || 0; I.line([[ex - gap * 0.6, eyeY - r * 0.28 - b], [ex - gap * 0.1, eyeY - r * 0.32]], ew * 0.7); I.line([[ex + gap * 0.3, eyeY - r * 0.32], [ex + gap * 0.85, eyeY - r * 0.28 - b]], ew * 0.7); }
  I.line([[x + f * r * 0.52, y + r * 0.1], [x + f * r * 0.62, y + r * 0.28], [x + f * r * 0.46, y + r * 0.3]], ew * 0.6);
  const m = o.mouth ?? 0.2; if (m > 0.5) I.shape(ell(x + f * r * 0.3, y + r * 0.55, r * 0.14, r * 0.14 * m), '#5a2a22', 1.6, 0.95); else I.line([[x + f * r * 0.1, y + r * 0.55], [x + f * r * 0.3, y + r * (0.58 + m * 0.2)], [x + f * r * 0.5, y + r * 0.53]], ew * 0.6);
}
function toddler(I, x, y, s, o = {}) {
  const f = o.f ?? 1, rot = o.rot || 0, c = Math.cos(rot), sn = Math.sin(rot), P = (dx, dy) => [x + (dx * c - dy * sn) * s, y + (dx * sn + dy * c) * s], kick = o.kick || 0;
  I.line([P(-10, 40), P(-20 - kick * 8, 74), P(-26 - kick * 12, 104)], 15 * s, C.skin, 1.2); I.line([P(10, 40), P(18 + kick * 8, 74), P(24 + kick * 12, 104)], 15 * s, C.skin, 1.2);
  I.shape([P(-28, -10), P(28, -10), P(32, 36), P(16, 54), P(-16, 54), P(-32, 36)], C.cloth, 2.4, 0.97);
  I.line([P(-30, 30), P(0, 38), P(30, 30)], 1.8);
  const a = o.arm ?? 0.3; I.line([P(24, -6), P(40 * f, 16 - a * 26), P(52 * f, 28 - a * 56)], 12 * s, C.skin, 1); I.line([P(-24, -6), P(-40 * f, 18), P(-46 * f, 42)], 12 * s, C.skin, 1);
  const h = P(0, -44); face(I, h[0], h[1], 37 * s, { f, closed: o.closed, mouth: o.mouth ?? 0.25, brow: false });
}
function lota(I, x, y, s) {
  I.shape([[x - 22 * s, y - 5 * s], [x - 12 * s, y - 22 * s], [x - 14 * s, y - 34 * s], [x + 14 * s, y - 34 * s], [x + 12 * s, y - 22 * s], [x + 22 * s, y - 5 * s], [x + 18 * s, y + 18 * s], [x - 18 * s, y + 18 * s]], C.steel, 2.2, 0.98);
  I.line([[x - 14 * s, y - 2 * s], [x - 8 * s, y + 8 * s]], 2, '#f8fbfc');
}
function teakLog(I, x, y, l, r, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), P = (a, b) => [x + a * c - b * s, y + a * s + b * c];
  I.shape([P(-l, -r), P(0, -r * 1.08), P(l, -r * 0.92), P(l + r * 0.3, 0), P(l, r * 0.92), P(0, r), P(-l, r)], C.wood, 3, 0.96);
  I.shape(ell(P(-l, 0)[0], P(-l, 0)[1], r * 0.34, r, rot, 8), '#c49a66', 2.2, 0.98);
  for (let i = 0; i < 4; i++) I.line([P(-l * 0.7 + i * l * 0.4, -r * 0.4), P(-l * 0.45 + i * l * 0.4, -r * 0.5)], 1.6);
  I.hatch(P(-l * 0.5, r * 0.3)[0], P(0, r * 0.3)[1], P(l * 0.7, r * 0.3)[0], P(0, r * 0.75)[1], 20, 12, 0.5);
}
function wolf(I, x, y, s, f, ph, o = {}) {
  const P = (dx, dy) => [x + dx * f * s, y + dy * s], down = o.down || 0, B = Math.sin(ph * 2) * 2;
  const leg = (bx, by, a, near) => { const sw = Math.sin(ph + a) * 20, kn = [bx + sw * 0.5, by + 42], ft = [bx + sw * 1.1, by + 84 - Math.max(0, Math.cos(ph + a)) * 12]; I.line([P(bx, by), P(kn[0], kn[1]), P(ft[0], ft[1])], (near ? 16 : 13) * s, near ? C.wolf : C.wolfD, 1.1); I.line([P(ft[0], ft[1]), P(ft[0] + 14, ft[1] + 2)], 8 * s, INK); };
  leg(-78, -6, 2.8, false); leg(62, -8, 0.8, false);
  // the tail, then the body
  I.shape([P(-108, -30 + B), P(-160, -20 + B), P(-205, 18 + B), P(-178, 34 + B), P(-130, 12 + B), P(-100, -8 + B)], C.wolf, 2.4, 0.95);
  I.shape([P(-112, -34 + B), P(-40, -52 + B), P(40, -56 + B), P(92, -62 + B), P(110, -24 + B), P(82, 16 + B), P(10, 8 + B), P(-70, 18 + B), P(-118, 6 + B)], C.wolf, 3, 0.96);
  I.wash([P(-90, 6 + B), P(10, 2 + B), P(78, 8 + B), P(50, -8 + B), P(-40, -6 + B)], '#c9c6bd', 0.8);
  I.hatch(P(-90, 0)[0] * (f > 0 ? 1 : 1), y - 45 * s, P(-90, 0)[0] + (f > 0 ? 120 : -120) * s, y - 28 * s, 16, -8, 0.4);
  leg(-90, 0, 0, true); leg(72, -2, 3.8, true);
  // neck and head
  const hx = 148, hy = -66 + down * 96 + B;
  I.shape([P(78, -58 + B), P(hx - 12, hy - 24), P(hx + 8, hy + 18), P(100, 6 + B)], C.wolf, 2.6, 0.97);
  I.shape([P(hx - 34, hy - 24), P(hx - 28, hy - 56), P(hx - 12, hy - 28), P(hx + 4, hy - 56), P(hx + 14, hy - 22), P(hx + 58, hy - 2), P(hx + 72, hy + 14), P(hx + 54, hy + 28), P(hx + 8, hy + 30), P(hx - 28, hy + 16)], C.wolf, 3, 0.98);
  I.wash(ell(P(hx + 6, hy + 4)[0], P(hx + 6, hy + 4)[1], 7 * s, 7 * s, 0, 6), INK, 1, 0.3);
  I.wash(ell(P(hx + 68, hy + 11)[0], P(hx + 68, hy + 11)[1], 8 * s, 7 * s, 0, 6), INK, 1, 0.3);
  I.line([P(hx + 56, hy + 26), P(hx + 30, hy + 22), P(hx + 14, hy + 16)], 2.4);
  return P(hx + 34, hy + 34);   // the mouth
}
function bullock(I, x, y, s, ph) {
  const P = (a, b) => [x + a * s, y + b * s];
  const leg = (a, o, n) => { const sw = Math.sin(ph + o) * 10; I.line([P(a, 10), P(a + sw * 0.5, 50), P(a + sw, 94)], 15 * s, n ? C.bull : '#9d8a68', 1); };
  leg(-74, 2.6, false); leg(58, 0.6, false);
  I.shape([P(-100, -48), P(-30, -58), P(50, -70), P(92, -56), P(102, 8), P(40, 22), P(-40, 18), P(-102, 14)], C.bull, 3, 0.96);
  I.shape([P(50, -74), P(66, -102), P(82, -80)], C.bull, 2.4, 0.96);   // the hump
  leg(-90, 0, true); leg(72, 3.6, true);
  I.shape([P(88, -56), P(136, -66), P(166, -44), P(172, -14), P(144, -6), P(110, -22)], C.bull, 3, 0.97);
  I.line([P(132, -64), P(122, -96), P(140, -112)], 5 * s, '#efe7d4'); I.line([P(150, -60), P(160, -92), P(180, -100)], 5 * s, '#efe7d4');
  I.wash(ell(P(146, -40)[0], P(146, -40)[1], 5 * s, 5 * s, 0, 6), INK, 1, 0.3);
  I.line([P(-100, -38), P(-118, -6), P(-116, 34)], 3);
}
function cart(I, x, y, s, t, o = {}) {
  const P = (a, b) => [x + a * s, y + b * s], spin = t * 0.7;
  I.shape([P(-130, -44), P(120, -44), P(130, -4), P(-140, -4)], C.wood, 3, 0.96);
  I.line([P(120, -22), P(238, -28)], 8 * s, C.woodD);
  for (let i = 0; i < 4; i++) I.line([P(-112 + i * 72, -42), P(-116 + i * 72, -8)], 1.6);
  // two people on it
  const m = o.mother !== false, ppl = o.people !== false;
  if (ppl) {
    I.shape([P(76, -44), P(70, -110), P(112, -112), P(120, -44)], C.cloth, 2.6, 0.96);
    face(I, P(94, -136)[0], P(94, -136)[1], 26 * s, { f: 1, hair: false, mouth: 0.15 });
    I.shape([P(66, -152), P(94, -172), P(124, -154), P(120, -140), P(68, -140)], '#c64f3c', 2.2, 0.97);   // his turban
    I.line([P(104, -96), P(130, -74), P(178, -60)], 10 * s, C.skin);    // the reins
    if (m) {
      I.shape([P(-68, -44), P(-74, -116), P(-24, -120), P(-12, -44)], C.sari, 2.6, 0.96);
      face(I, P(-44, -142)[0], P(-44, -142)[1], 25 * s, { f: 1, bun: true, mouth: 0.25 });
      I.line([P(-70, -118), P(-48, -176), P(-12, -116)], 4, C.sari);
      toddler(I, P(-2, -100)[0], P(-2, -100)[1], 0.52 * s, { f: 1, arm: 0.5 });
      lota(I, P(22, -86)[0], P(22, -86)[1], 0.52 * s);
    }
  }
  for (const a of [-80, 74]) {
    I.shape(ell(P(a, 26)[0], P(a, 26)[1], 54 * s, 54 * s, 0, 12), '#b98d57', 3.2, 0.3);
    for (let k = 0; k < 4; k++) { const an = spin + k * Math.PI / 4; I.line([[P(a, 26)[0] - Math.cos(an) * 52 * s, P(a, 26)[1] - Math.sin(an) * 52 * s], [P(a, 26)[0] + Math.cos(an) * 52 * s, P(a, 26)[1] + Math.sin(an) * 52 * s]], 3.2, C.woodD); }
    I.shape(ell(P(a, 26)[0], P(a, 26)[1], 10 * s), C.woodD, 2, 1);
  }
}

// ---------------------------------------------------------------------------------------------- the panels
// each: draw(ink, ctx, t seconds, k 0..1 through the panel), cam: [x, y, zoom] at the start and at the end
export const PANELS = [
  { // the hills in the rain
    cam: [[800, 450, 1.06], [860, 470, 1.18]],
    draw(I, x, t) {
      sky(I, C.storm, C.sky);
      cloud(I, 320 + t * 7, 130, 1.5, '#57636d'); cloud(I, 1120 + t * 4, 90, 1.8, '#4d5963'); cloud(I, 780 + t * 9, 200, 1.1, '#6a7680');
      hills(I, 390, 40, C.hill2, 1); hills(I, 490, 34, C.hill, 4);
      // the river winding down through them
      const r = [[1000, 520], [860, 590], [980, 660], [720, 750], [860, 830], [640, 920], [1050, 920], [1040, 820], [1090, 740], [1120, 650], [1010, 590]];
      I.shape(r, C.river, 2.6, 0.95);
      hills(I, 640, 22, C.leaf2, 9, 2.2);
      for (let i = 0; i < 7; i++) tree(I, 60 + i * 96 + hash(i) * 20, 745 + hash(i + 3) * 26, 0.62, Math.sin(t + i) * 3);
      for (let i = 0; i < 5; i++) tree(I, 1190 + i * 92 + hash(i + 5) * 20, 760 + hash(i + 8) * 24, 0.7, Math.sin(t + i) * 3);
      rain(x, t, 70);
    },
  },
  { // the cart on the ford
    cam: [[720, 470, 1.12], [880, 470, 1.12]],
    draw(I, x, t) {
      sky(I, C.dusk, C.storm, 560); cloud(I, 300, 110, 1.3, '#6a7680'); cloud(I, 1240, 80, 1.7, '#5a6670');
      hills(I, 380, 36, C.hill, 2); hills(I, 460, 24, C.leaf2, 6);
      const prog = t * 22, bob = Math.sin(t * 2.1) * 3;
      bullock(I, 1016 + prog, 548 + bob, 1.02, t * 2.6); bullock(I, 1000 + prog - 30, 556 - bob, 1.02, t * 2.6 + 1);
      cart(I, 640 + prog, 560 + Math.sin(t * 1.6) * 3, 1.25, t);
      water(I, 600, C.river, t, { amp: 7, rows: 4, a: 0.72 });
      rain(x, t, 44);
    },
  },
  { // the flood comes round the bend
    cam: [[800, 450, 1.05], [720, 470, 1.22]],
    draw(I, x, t, k) {
      const flash = Math.sin(t * 3) > 0.96 ? 0.28 : 0;
      sky(I, C.storm, '#4b5660', 560); cloud(I, 300, 110, 1.9, '#3f4a54'); cloud(I, 1100, 130, 2.2, '#384049');
      hills(I, 340, 30, C.hill, 3); hills(I, 450, 24, C.leaf2, 7);
      cart(I, 1140, 590, 0.74, 0);
      bullock(I, 1320, 582, 0.6, t * 6);
      water(I, 626, C.river, t, { amp: 6, rows: 2, a: 0.75 });
      // the wall of water
      const wx = -120 + smooth(0, 1, k) * 780, top = 460 - smooth(0, 1, k) * 110, p = [[-60, H + 40], [-60, top + 14]];
      for (let i = 0; i <= 8; i++) p.push([-60 + i * (wx + 60) / 8, top + Math.sin(i * 1.3 + t * 5) * 18 + i * 2]);
      p.push([wx + 90, top + 30], [wx + 150, top + 104], [wx + 110, 620], [wx + 210, H + 40]);
      I.shape(p, C.flood, 4, 0.97);
      for (let i = 0; i < 5; i++) { const y0 = top + 70 + i * 74; I.line([[-30, y0 + Math.sin(t * 3 + i) * 10], [wx * 0.3, y0 - 14], [wx * 0.6, y0 + 10], [wx - 10 + i * 18, y0 - 8]], 2.2); }
      // foam, and what it has picked up
      for (let i = 0; i < 16; i++) { const a = i * 2.3 + t * 3, u = i / 15, X = u < 0.5 ? 40 + u * 2 * wx : wx + 100 + Math.sin(a) * 26 + (u - 0.5) * 120, Y = u < 0.5 ? top + Math.sin(i * 1.3 + t * 5) * 18 - 2 : top + 30 + (u - 0.5) * 2 * 340; I.shape(ell(X, Y, 30 + (i % 3) * 10, 16 + (i % 2) * 6, a, 7), '#f1ebdd', 2, 0.97); }
      teakLog(I, wx * 0.5, top + 26 + Math.sin(t * 4) * 12, 110, 18, 0.2 + Math.sin(t * 2) * 0.1);
      rain(x, t, 90, -0.42, 0.5);
      if (flash) { x.fillStyle = '#fff8e8'; x.globalAlpha = flash; x.fillRect(-100, -100, 1800, 1100); x.globalAlpha = 1; }
    },
  },
  { // she ties him to a log
    cam: [[800, 440, 1.04], [800, 470, 1.2]],
    draw(I, x, t) {
      sky(I, '#4f5c64', '#3f4b53', 900);
      hills(I, 250, 30, '#55624f', 5);
      const sw = Math.sin(t * 1.5) * 6, wl = 616 + sw;
      // her, up to the chest in it
      I.shape([[560, 900], [554, 500], [624, 448], [760, 448], [824, 500], [832, 900]], C.sari, 3.4, 0.97);
      I.line([[590, 490], [690, 560], [812, 500]], 3, '#7f2d24'); I.hatch(600, 520, 800, 620, 22, 16, 0.3);
      // the end of her sari, pulled off the shoulder, wrapped round log and boy
      face(I, 690, 356, 86, { f: 1, bun: true, mouth: 0.75, browUp: 12 });
      for (let i = 0; i < 6; i++) { const a = 3.2 + i * 0.35; I.line([[690 + Math.cos(a) * 80, 330 + Math.sin(a) * 60], [650 + Math.cos(a) * 120 + Math.sin(t * 5 + i) * 6, 400 + Math.sin(a) * 100 + 70]], 5, C.hair); }
      teakLog(I, 930, wl + 18 + sw * 0.4, 300, 40, -0.02);
      toddler(I, 980, wl - 110 + sw * 0.3, 1.32, { f: -1, arm: 0.9, mouth: 0.9 });
      lota(I, 1120, wl - 54 + sw * 0.3, 1.2);
      // the cloth goes round the log and through the pot's handle, again and again
      const tie = (t * 0.5) % 1, wrap = (X) => { I.shape([[X - 18, wl - 30], [X + 18, wl - 34], [X + 26, wl + 58], [X - 12, wl + 64]], C.sari, 2.4, 0.98); };
      wrap(960); wrap(1040); wrap(880);
      I.line([[1040, wl - 30], [1090, wl - 72], [1128, wl - 72]], 11, C.sari);
      // her arms, pulling the knot tight
      I.line([[770, 500], [846, 560 + Math.sin(t * 4) * 8], [950, wl - 20 + Math.sin(t * 4) * 10]], 30, C.skin, 1.3);
      I.line([[600, 520], [730, 600 + Math.cos(t * 4) * 8], [870, wl - 16 + Math.cos(t * 4) * 8]], 30, C.skin, 1.3);
      water(I, wl + 44, C.flood, t * 2.2, { amp: 14, rows: 4, a: 0.9 });
      rain(x, t, 90, -0.36, 0.45);
    },
  },
  { // she hums, and the river takes her
    cam: [[820, 440, 1.2], [820, 470, 1.04]],
    draw(I, x, t, k) {
      sky(I, '#3f4b56', '#35404a', 900);
      const sink = smooth(0.52, 0.95, k), wl = 560, away = smooth(0.42, 1, k) * 280;
      // her
      if (sink < 0.99) {
        const dy = sink * 330, X = 520 - sink * 50;
        I.shape([[X - 104, 900], [X - 104, 500 + dy], [X - 40, 440 + dy], [X + 80, 440 + dy], [X + 130, 500 + dy], [X + 134, 900]], C.sari, 3.2, 0.97);
        face(I, X + 20, 360 + dy, 82, { f: 1, bun: true, closed: true, mouth: 0.42, browUp: 4 });
        I.line([[X + 100, 490 + dy], [X + 210, 520 + dy * 0.8 - sink * 60], [X + 300 + away * 0.25 - sink * 130, 520 + dy * 0.2 - sink * 100]], 26, C.skin, 1.3);
      }
      // him, on the log, going away from her
      const LX = 1000 + away, s2 = Math.sin(t * 1.6) * 8;
      teakLog(I, LX, wl + 40 + s2, 240, 34, 0.02);
      toddler(I, LX - 24, wl - 66 + s2, 1.08, { f: -1, arm: 0.2, closed: k < 0.42, mouth: 0.25 });
      lota(I, LX + 80, wl - 10 + s2, 1);
      I.shape([[LX - 44, wl + 2 + s2], [LX + 4, wl - 2 + s2], [LX + 8, wl + 76 + s2], [LX - 40, wl + 78 + s2]], C.sari, 2.2, 0.98);
      water(I, wl + 62, C.flood, t * 2, { amp: 15, rows: 4, a: 0.92 });
      // four notes, drifting from her over the water
      const notes = 1 - smooth(0.5, 0.62, k);
      if (notes > 0.01) for (let i = 0; i < 4; i++) {
        const nt = clamp01((k - 0.05 - i * 0.08) * 7), X = 620 + i * 90 + nt * 40, Y = 300 - [10, 34, 62, 22][i] - nt * 26 + Math.sin(t * 2 + i) * 8;
        if (nt > 0) { x.globalAlpha = Math.min(1, nt) * notes; const mark = ell(X, Y, 15, 11, -0.4, 7); I.wash(mark, INK, 1, 0.5); I.line([[X + 12, Y], [X + 15, Y - 52]], 3); I.line([[X + 15, Y - 52], [X + 38, Y - 36]], 3); x.globalAlpha = 1; }
      }
      rain(x, t, 80, -0.32, 0.4);
    },
  },
  { // alone on the river, at night
    cam: [[800, 450, 1.25], [800, 450, 1.0]],
    draw(I, x, t, k) {
      sky(I, C.night, '#2b343d', 620);
      I.shape(ell(1230, 160, 56), '#e6dfc5', 2.2, 0.95); cloud(I, 1100 - t * 5, 180, 1.4, '#37434c');
      hills(I, 420, 40, '#2d3a38', 3); hills(I, 500, 18, '#27332f', 8);
      water(I, 560, C.nightR, t * 0.8, { amp: 6, rows: 5, a: 0.95, sp: 1 });
      const s2 = Math.sin(t * 0.9) * 5, LX = 700 + t * 8;
      teakLog(I, LX, 610 + s2, 118, 16, 0.02);
      toddler(I, LX - 14, 562 + s2, 0.46, { f: 1, closed: true, arm: -0.2 });
      lota(I, LX + 42, 586 + s2, 0.42);
      // moonlight on the water
      for (let i = 0; i < 6; i++) { I.line([[1190 + hash(i) * 28, 590 + i * 44], [1230 + hash(i + 2) * 24, 586 + i * 44], [1276 + hash(i + 4) * 28, 591 + i * 44]], 3, '#d9d3bb'); }
    },
  },
  { // a sandbank at dawn: she finds him, and picks him up
    cam: [[820, 470, 1.18], [760, 470, 1.04]],
    draw(I, x, t, k) {
      sky(I, C.dawn, '#d9a982', 500); I.shape(ell(1240, 340, 80), '#f5d58f', 2.2, 0.9);
      hills(I, 390, 26, '#a8a184', 4); hills(I, 450, 20, C.leaf2, 8);
      for (let i = 0; i < 5; i++) tree(I, 90 + i * 140, 500, 0.6);
      water(I, 500, C.river, t * 0.6, { amp: 3, rows: 1, a: 0.85 });
      I.shape([[-30, 610], [340, 560], [900, 576], [1400, 560], [1640, 620], [1640, 930], [-30, 930]], C.sand, 3, 0.96);
      for (let i = 0; i < 8; i++) { const X = 90 + i * 190 + hash(i) * 40, Y = 700 + hash(i + 3) * 120; I.line([[X, Y], [X + 40, Y - 5], [X + 90, Y + 2]], 1.6); }
      teakLog(I, 1160, 730, 230, 30, 0.04);
      const lift = smooth(0.6, 0.78, k), walkOff = smooth(0.74, 1, k);
      const wx = 340 + smooth(0, 0.5, k) * 430 - walkOff * 460, ph = (k < 0.5 || k > 0.74) ? t * 5 : 0, f = k > 0.72 ? -1 : 1;
      if (lift < 0.05) { toddler(I, 960, 742, 0.86, { rot: 1.3, closed: k < 0.3, f: -1, arm: 0.2 }); lota(I, 1000, 780, 0.8); }
      else lota(I, 1000, 780, 0.8);
      const mouth = wolf(I, wx, 716, 0.98, f, ph, { down: lift < 0.05 ? smooth(0.42, 0.56, k) : 1 - lift * 0.6 });
      // by the cloth at his waist, the way she would carry a pup: he hangs across her jaws
      if (lift >= 0.05) { toddler(I, mouth[0] + f * 8, mouth[1] + 8 + Math.sin(t * 5) * 3, 0.74, { rot: f * 1.2, f, closed: true, arm: -0.4, kick: Math.sin(t * 4) * 0.5 }); I.line([[mouth[0] - 22, mouth[1] - 10], [mouth[0], mouth[1] - 2], [mouth[0] + 22, mouth[1] - 10]], 4); }
    },
  },
  { // the den
    cam: [[800, 480, 1.14], [800, 470, 1.04]],
    draw(I, x, t) {
      I.wash([[-30, -30], [1630, -30], [1630, 930], [-30, 930]], C.den, 0.96, 0);
      // the mouth of the den, with morning outside
      I.shape([[980, 120], [1240, 100], [1460, 200], [1520, 520], [1500, 660], [1040, 640], [930, 400]], C.dawn, 3.6, 0.95);
      for (let i = 0; i < 3; i++) tree(I, 1160 + i * 110, 640, 0.76 + i * 0.08, Math.sin(t * 0.8 + i) * 4);
      I.shape([[-30, 680], [500, 640], [1100, 650], [1630, 690], [1630, 930], [-30, 930]], '#7c6650', 3, 0.97);
      I.hatch(30, 40, 900, 200, 30, 20, 0.3); I.hatch(40, 280, 700, 480, 34, 22, 0.25);
      for (let i = 0; i < 9; i++) { const X = 160 + i * 150 + hash(i) * 60, Y = 760 + hash(i + 2) * 70; I.shape(ell(X, Y, 42, 14, hash(i) * 0.6, 7), ['#b8894a', '#a2743c', '#c29a58'][i % 3], 1.6, 0.9); }
      // the wolf, curled round him, breathing
      const br = Math.sin(t * 1.3) * 5;
      I.shape([[290, 760], [340, 650 - br], [520, 586 - br], [730, 590 - br], [880, 660], [900, 760], [700, 800], [420, 800]], C.wolf, 3.4, 0.97);
      I.hatch(380, 620 - br, 700, 660 - br, 26, -10, 0.35);
      I.shape([[840, 680], [860, 636], [880, 668], [916, 636], [928, 682], [1000, 716], [1020, 742], [980, 760], [900, 762], [840, 740]], C.wolf, 3.2, 0.98);
      I.line([[884, 708], [900, 714], [916, 708]], 2.6);
      I.wash(ell(1012, 736, 10, 8, 0, 6), INK, 1, 0.3);
      I.shape([[300, 760], [220, 786], [230, 820], [420, 816], [460, 788]], C.wolf, 3, 0.96);
      // him, tucked in against her, asleep
      toddler(I, 590, 716 + br * 0.3, 0.96, { rot: 1.35, closed: true, f: -1, arm: -0.2, mouth: 0.15 });
      for (let i = 0; i < 3; i++) { const n = ((t * 0.5 + i * 0.33) % 1); x.globalAlpha = 1 - n; I.line([[500 + n * 30, 610 - n * 90], [512 + n * 30, 594 - n * 90]], 2); x.globalAlpha = 1; }
    },
  },
];

export class SketchBook {
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d', { alpha: false }); this.ink = new Ink(this.x); this.counts = {};
    this.paper = null; this.resize();
  }
  resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1), w = this.w = Math.max(320, window.innerWidth), h = this.h = Math.max(240, window.innerHeight);
    this.c.width = w * dpr; this.c.height = h * dpr; this.dpr = dpr;
    // paper with a little tooth and fibre
    const p = this.paper = document.createElement('canvas'); p.width = this.c.width; p.height = this.c.height;
    const x = p.getContext('2d'); x.fillStyle = PAPER; x.fillRect(0, 0, p.width, p.height);
    for (let i = 0; i < 5200; i++) { x.fillStyle = i % 2 ? 'rgba(120,92,50,.045)' : 'rgba(255,250,235,.06)'; x.fillRect(Math.random() * p.width, Math.random() * p.height, 1 + Math.random() * 2.4, 1 + Math.random() * 1.6); }
    x.strokeStyle = 'rgba(110,84,46,.07)'; x.lineWidth = 1; for (let i = 0; i < 260; i++) { const X = Math.random() * p.width, Y = Math.random() * p.height, a = Math.random() * 6.28; x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.cos(a) * 16, Y + Math.sin(a) * 16); x.stroke(); }
    const g = x.createRadialGradient(p.width / 2, p.height / 2, p.height * 0.35, p.width / 2, p.height / 2, p.width * 0.72); g.addColorStop(0, 'rgba(90,60,30,0)'); g.addColorStop(1, 'rgba(90,60,30,.28)'); x.fillStyle = g; x.fillRect(0, 0, p.width, p.height);
  }
  // the panel takes the page down to the caption strip, keeping 16:9 where it fits
  frameRect() {
    const cap = Math.max(112, this.h * 0.2), m = Math.max(14, Math.min(this.w, this.h) * 0.03), aw = this.w - m * 2, ah = this.h - cap - m;
    const pw = Math.min(aw, ah * 16 / 9), ph = pw * 9 / 16;
    return { x: (this.w - pw) / 2, y: m + (ah - ph) / 2, w: pw, h: ph, cap };
  }
  // draw panel i, t seconds in, dur seconds long; `seed` picks the line boil
  render(i, t, dur) {
    const x = this.x, I = this.ink, P = PANELS[i], k = clamp01(t / dur), R = this.frameRect();
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.drawImage(this.paper, 0, 0);
    x.scale(this.dpr, this.dpr);
    // into the frame
    x.save(); x.beginPath(); x.rect(R.x, R.y, R.w, R.h); x.clip();
    const e = k * k * (3 - 2 * k), [a, b] = P.cam, cx = a[0] + (b[0] - a[0]) * e, cy = a[1] + (b[1] - a[1]) * e, z = a[2] + (b[2] - a[2]) * e, s = R.w / W * z;
    x.translate(R.x + R.w / 2, R.y + R.h / 2); x.scale(s, s); x.translate(-cx, -cy);
    // drawn onto the page: only so many strokes yet, for the first second or so
    I.n = 0; I.boil = Math.floor(t * 6) % 4 * 13.7;
    I.limit = t < 1.15 ? Math.floor((this.counts[i] || 0) * Math.pow(t / 1.15, 1.4)) : Infinity;
    P.draw(I, x, t, k);
    this.counts[i] = I.n;
    x.restore();
    // a rough inked frame
    const fr = [[R.x, R.y], [R.x + R.w, R.y + 1], [R.x + R.w - 1, R.y + R.h], [R.x + 1, R.y + R.h - 1], [R.x, R.y - 2]];
    I.n = 1000; I.limit = Infinity; for (let j = 0; j < 4; j++) I.line([fr[j], [(fr[j][0] + fr[j + 1][0]) / 2, (fr[j][1] + fr[j + 1][1]) / 2], fr[j + 1]], 3.4, INK, 1.4);
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  blank() { const x = this.x; x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(this.paper, 0, 0); }
}

// The opening, as a set of paintings in the manner of an Indian miniature: figures in profile with long eyes, flat stacked
// country, patterned water, scrolling clouds, all in brush and ink over thin mineral washes on aged paper. Each plate is
// painted once, ahead of time, into its own canvas; during the opening nothing is drawn at all. The finished plates just
// fade from one to the next and drift slowly, which the browser does on its own.
const W = 1600, H = 900;
const C = { ink: '#2a2118', sepia: '#4a3a2a', paper: '#dccdab', indigo: '#8a9493', night: '#56626a', ochre: '#bca06a', red: '#9a5c48', green: '#a3a57f', greenD: '#7f8667', umber: '#8d7558', flesh: '#c49e78', white: '#eee6d2', steel: '#a8aaa2', water: '#a9b2a6', flood: '#a8987a', sand: '#d8c7a0', wolf: '#a59e8c', dusk: '#d6bd96', leaf: '#6f7858' };

function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Two tiles shared by every plate: pigment settling unevenly (alpha to take away from a wash) and paper fibre (to multiply over)
let GRAIN = null, FIBRE = null;
function tiles() {
  if (GRAIN) return;
  const S = 256, r = rngOf(9), mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const lo = new Float32Array(32 * 32); for (let i = 0; i < lo.length; i++) lo[i] = r();
  const at = (x, y) => { const X = x / 21, Y = y / 21, i = Math.floor(X), j = Math.floor(Y), u = X - i, v = Y - j, g = (a, b) => lo[((b & 31) * 32 + (a & 31))]; return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v; };
  GRAIN = mk(); const gx = GRAIN.getContext('2d'), gd = gx.createImageData(S, S);
  FIBRE = mk(); const fx = FIBRE.getContext('2d'), fd = fx.createImageData(S, S);
  for (let y = 0, k = 0; y < S; y++) for (let x = 0; x < S; x++, k += 4) {
    const blot = at(x, y), fine = r();
    gd.data[k] = gd.data[k + 1] = gd.data[k + 2] = 0; gd.data[k + 3] = Math.max(0, blot * 0.25 + fine * 0.75 - 0.5) * 170;
    const v = 236 + blot * 14 + (fine - 0.5) * 12; fd.data[k] = v; fd.data[k + 1] = v * 0.985; fd.data[k + 2] = v * 0.95; fd.data[k + 3] = 255;
  }
  gx.putImageData(gd, 0, 0); fx.putImageData(fd, 0, 0);
  fx.globalAlpha = 0.1; fx.strokeStyle = '#6a5636'; fx.lineWidth = 0.7;
  for (let i = 0; i < 90; i++) { const X = r() * S, Y = r() * S, a = r() * 6.28; fx.beginPath(); fx.moveTo(X, Y); fx.lineTo(X + Math.cos(a) * 14, Y + Math.sin(a) * 14); fx.stroke(); }
}

class Painter {
  constructor(scale, seed) {
    tiles();
    this.s = scale; this.r = rngOf(seed);
    const c = this.c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const x = this.x = c.getContext('2d'); x.setTransform(scale, 0, 0, scale, 0, 0); x.lineCap = 'round'; x.lineJoin = 'round';
    x.fillStyle = C.paper; x.fillRect(0, 0, W, H);
    this.sc = document.createElement('canvas'); this.sc.width = c.width; this.sc.height = c.height;
    this.sx = this.sc.getContext('2d', { willReadFrequently: false }); this.sx.setTransform(scale, 0, 0, scale, 0, 0); this.sx.lineCap = 'round'; this.sx.lineJoin = 'round';
    this.grain = this.sx.createPattern(GRAIN, 'repeat');
  }
  // a hand-drawn curve through the points
  curve(pts, closed = false, jit = 0.8, hard = false) {
    const r = this.r, n = pts.length, P = pts.map((p) => [p[0] + (r() - 0.5) * jit, p[1] + (r() - 0.5) * jit]), out = [];
    if (hard) { const m = closed ? n : n - 1; for (let i = 0; i < m; i++) { const a = P[i], b = P[(i + 1) % n], K = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8)); for (let k = 0; k < K; k++) out.push([a[0] + (b[0] - a[0]) * k / K + (r() - 0.5) * 0.7, a[1] + (b[1] - a[1]) * k / K + (r() - 0.5) * 0.7]); } out.push(closed ? out[0] : P[n - 1]); return out; }
    const g = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]), segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = g(i - 1), b = g(i), c = g(i + 1), d = g(i + 2), l = Math.hypot(c[0] - b[0], c[1] - b[1]), K = Math.max(2, Math.ceil(l / 7));
      for (let k = 0; k < K; k++) { const t = k / K, t2 = t * t, t3 = t2 * t; out.push([0.5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * t3), 0.5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * t3)]); }
    }
    if (!closed) out.push(P[n - 1]); else out.push(out[0]);
    return out;
  }
  // A loaded brush: several bristles side by side, thick in the middle of the stroke and lifting off at the ends, running
  // dry in places. A faint first pencil line sits beside it, as under-drawing does.
  line(pts, w = 2.2, col = C.ink, o = {}) {
    const x = this.x, r = this.r, c = this.curve(pts, false, o.jit ?? 1.1, o.hard), n = c.length; if (n < 2) return;
    const dry = (o.dry ?? 0.1) + 0.1, nb = Math.max(1, Math.round(w * 1.2)), ph = r() * 9;
    x.strokeStyle = col;
    if (o.ghost !== false && w > 1) for (let pass = 0; pass < 2; pass++) {
      const k = pass ? 3.4 : 2.1, q = ph + pass * 2.7;
      x.globalAlpha = pass ? 0.2 : 0.34; x.lineWidth = 0.7; x.beginPath();
      for (let i = 0; i < n; i++) { const X = c[i][0] + Math.sin(i * 0.13 + q) * k, Y = c[i][1] + Math.cos(i * 0.1 + q) * k; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }
      x.stroke();
    }
    x.globalAlpha = o.a ?? 0.88; x.lineWidth = Math.max(0.55, (w / nb) * 1.5);
    for (let b = 0; b < nb; b++) {
      const off = nb > 1 ? (b / (nb - 1) - 0.5) : 0, seed = r() * 40; x.beginPath(); let pen = false;
      for (let i = 0; i < n; i++) {
        const A = c[Math.max(0, i - 1)], B = c[Math.min(n - 1, i + 1)], dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, t = (i + 0.5) / n;
        const press = (0.34 + 0.66 * Math.pow(Math.sin(t * Math.PI), 0.55)) * (0.78 + 0.3 * Math.sin(i * 0.07 + ph));
        const X = c[i][0] - dy / l * off * w * press, Y = c[i][1] + dx / l * off * w * press;
        // the outer bristles run out first
        const gap = dry * (0.5 + Math.abs(off) * 1.6) > 0 && Math.sin(i * 0.31 + seed) * Math.sin(i * 0.083 + seed * 2) > 1 - dry * (1.3 + Math.abs(off) * 2);
        if (gap) { pen = false; continue; }
        if (pen) x.lineTo(X, Y); else { x.moveTo(X, Y); pen = true; }
      }
      x.stroke();
    }
    x.globalAlpha = 1;
  }
  // Body colour, as miniatures are painted: opaque pigment laid flat, settling a little unevenly and darker at its edge, with
  // what is under it covered. o.thin instead lets what is under it show, for glazes over the paper.
  wash(pts, col, a = 0.94, o = {}) {
    const S = this.sx, x = this.x, s = this.s, c = o.raw ? pts : this.curve(pts, true, o.jit ?? 1.4, o.hard);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of c) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
    x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6); x1 = Math.min(W, x1 + 6); y1 = Math.min(H, y1 + 6); if (x1 <= x0 || y1 <= y0) return;
    S.save(); S.clearRect(x0, y0, x1 - x0, y1 - y0);
    S.beginPath(); S.moveTo(c[0][0], c[0][1]); for (let i = 1; i < c.length; i++) S.lineTo(c[i][0], c[i][1]); S.closePath();
    S.fillStyle = col; S.globalAlpha = 1; S.fill();
    if (!o.noEdge) { S.globalAlpha = 0.5; S.strokeStyle = '#3a3026'; S.lineWidth = 1.6; S.globalCompositeOperation = 'source-atop'; S.stroke(); }
    S.globalCompositeOperation = 'destination-out'; S.globalAlpha = o.thin ? 0.8 : 0.4; S.fillStyle = this.grain; S.fillRect(x0, y0, x1 - x0, y1 - y0);
    S.restore();
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = a; x.globalCompositeOperation = o.thin ? 'multiply' : 'source-over';
    const X = Math.floor(x0 * s), Y = Math.floor(y0 * s), Wd = Math.ceil((x1 - x0) * s), Hd = Math.ceil((y1 - y0) * s);
    x.drawImage(this.sc, X, Y, Wd, Hd, X, Y, Wd, Hd); x.restore();
  }
  // washed shape with a brush outline
  shape(pts, col, a = 0.94, w = 1.8, o = {}) { this.wash(pts, col, Math.max(a, 0.9), o); this.line(o.hard ? [...pts, pts[0]] : [...pts, pts[0], pts[1]], w, o.lineCol || C.ink, { dry: 0.14, hard: o.hard }); }
  // parallel strokes kept inside a shape: pen shading, or (with dash) the dashes a Gond painter fills a form with
  hatch(pts, o = {}) {
    const x = this.x, r = this.r, c = this.curve(pts, true, 0, o.hard), gap = o.gap ?? 9, ang = o.ang ?? -0.9;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of c) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 4, ca = Math.cos(ang), sa = Math.sin(ang);
    x.save(); x.beginPath(); x.moveTo(c[0][0], c[0][1]); for (let i = 1; i < c.length; i++) x.lineTo(c[i][0], c[i][1]); x.closePath(); x.clip();
    x.strokeStyle = o.col || C.ink; x.globalAlpha = o.a ?? 0.4; x.lineWidth = o.w ?? 0.8; x.beginPath();
    for (let d = -R; d < R; d += gap * (0.8 + r() * 0.4)) {
      const px = cx - sa * d, py = cy + ca * d; let t = -R + r() * 8;
      const dl = o.dash ?? 0; if (!dl) { x.moveTo(px + ca * t, py + sa * t); x.lineTo(px + ca * (R - r() * 8) + (r() - 0.5) * 2, py + sa * (R - r() * 8) + (r() - 0.5) * 2); continue; }
      while (t < R) { const e = t + dl * (0.7 + r() * 0.6); x.moveTo(px + ca * t, py + sa * t); x.lineTo(px + ca * e, py + sa * e); t = e + (o.space ?? dl * 0.9) * (0.7 + r() * 0.6); }
    }
    x.stroke(); x.restore(); x.globalAlpha = 1;
  }
  dots(pts, r0 = 1.4, col = C.ink, a = 0.75) { const x = this.x; x.fillStyle = col; x.globalAlpha = a; x.beginPath(); for (const p of pts) { const q = r0 * (0.75 + this.r() * 0.5); x.moveTo(p[0] + q, p[1]); x.arc(p[0], p[1], q, 0, 6.283); } x.fill(); x.globalAlpha = 1; }
  // the sheet settles: paper fibre over everything, and the edges of the painting browned with age
  finish(tone = 0.26) {
    const x = this.x; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'multiply';
    x.fillStyle = x.createPattern(FIBRE, 'repeat'); x.fillRect(0, 0, this.c.width, this.c.height);
    const g = x.createRadialGradient(this.c.width / 2, this.c.height / 2, this.c.height * 0.4, this.c.width / 2, this.c.height / 2, this.c.width * 0.62); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, `rgba(${Math.round(255 - tone * 200)},${Math.round(255 - tone * 280)},${Math.round(255 - tone * 420)},1)`);
    x.fillStyle = g; x.fillRect(0, 0, this.c.width, this.c.height); x.restore();
    this.sc.width = 1; this.sc.height = 1; this.sc = null; this.sx = null;
  }
}

// ---------------------------------------------------------------------------------------------- the world of the paintings
function skyWash(P, col, y = 560, col2) {
  P.wash([[-10, -10], [W + 10, -10], [W + 10, y], [-10, y]], col, 0.92, { jit: 0, hard: true, noEdge: true });
  if (col2) P.wash([[-10, -10], [W + 10, -10], [W + 10, y * 0.46], [-10, y * 0.46]], col2, 0.32, { jit: 0, thin: true, hard: true, noEdge: true });
  // the sky scumbled in by hand, in long loose diagonal strokes
  P.hatch([[-10, -10], [W + 10, -10], [W + 10, y], [-10, y]], { hard: true, gap: 21, ang: -0.62, a: 0.1, w: 1.2 });
}
// clouds as a miniature painter draws the monsoon: a band of curling scrolls along the top of the sky
function cloudBand(P, y, col, dark = 0.8, n = 8) {
  const r = P.r, top = [[-20, -20], [W + 20, -20], [W + 20, y - 10]], step = W / n;
  for (let i = n; i >= 0; i--) { const cx = i * step + (r() - 0.5) * 30; top.push([cx + step * 0.5, y + 16 + r() * 14], [cx + step * 0.15, y + 46 + r() * 24], [cx - step * 0.25, y + 18 + r() * 12]); }
  P.wash(top, col, dark);
  for (let i = 0; i <= n; i++) {
    const cx = i * step + (r() - 0.5) * 40, cy = y + 8 + r() * 26, R = 26 + r() * 22, sp = [];
    for (let a = 0; a < 15; a++) { const t = a / 14, ang = t * 8.6 + i, q = R * (1 - t * 0.86); sp.push([cx + Math.cos(ang) * q * 1.5, cy + Math.sin(ang) * q * 0.7]); }
    P.line(sp, 1.5, C.ink, { dry: 0.2, ghost: false, a: 0.7 });
    P.line([[cx - R * 2.3, cy - R * 0.8], [cx - R * 1.2, cy - R * 1.3], [cx + R * 0.3, cy - R * 1.2], [cx + R * 1.7, cy - R * 0.7]], 1.1, C.white, { a: 0.6, ghost: false, dry: 0.3 });
  }
}
// rain as fine parallel strokes
function rain(P, y0 = 80, y1 = 860, n = 220, a = 0.34, slant = -0.22) {
  const x = P.x, r = P.r; x.strokeStyle = C.ink; x.globalAlpha = a; x.lineWidth = 0.75; x.beginPath();
  for (let i = 0; i < n; i++) { const X = r() * (W + 200) - 100, Y = y0 + r() * (y1 - y0), l = 16 + r() * 22; x.moveTo(X, Y); x.lineTo(X + slant * l, Y + l); }
  x.stroke(); x.globalAlpha = 1;
}
// a range of the rounded, overlapping hummocks painters give the Satpura country: each lobe drawn on its own, of its own size
function hills(P, y, amp, col, seed, a = 0.94, hatch = true) {
  const r = rngOf(seed), lobes = []; let X = -120;
  while (X < W + 120) { const w = (0.8 + r() * 1.4) * amp * 1.9; lobes.push([X + w * 0.5, w, amp * (0.55 + r() * 0.75)]); X += w * (0.55 + r() * 0.3); }
  // furthest back first, each lobe a dome that overlaps the next
  for (const i of lobes.map((_, k) => k).sort(() => r() - 0.5)) {
    const [cx, w, h] = lobes[i], top = y - h, dome = [[cx - w * 0.75, y + 40], [cx - w * 0.62, y - h * 0.34], [cx - w * 0.32, top + h * 0.12], [cx + (r() - 0.5) * w * 0.2, top], [cx + w * 0.36, top + h * 0.16], [cx + w * 0.64, y - h * 0.3], [cx + w * 0.78, y + 40]];
    P.wash(dome, col, 0.97, { noEdge: true }); P.line(dome.slice(0, 7), 1.7, C.ink, { dry: 0.3 });
    if (hatch) for (let k = 0; k < 6; k++) { const q = cx + w * 0.1 + k * w * 0.075, v = top + h * (0.2 + k * 0.1); P.line([[q, v], [q + w * 0.05, v + h * 0.22], [q + w * 0.01, v + h * 0.44]], 0.8, C.ink, { ghost: false, a: 0.34, dry: 0.3 }); }
    for (let k = 0; k < 3; k++) { const q = cx + (r() - 0.5) * w * 0.7, v = top + Math.pow(Math.abs(q - cx) / (w * 0.62), 2) * h * 0.66 + 1; P.line([[q, v], [q - 1, v - 6], [q + 3, v - 11]], 0.9, C.ink, { ghost: false, a: 0.6 }); }
  }
  P.wash([[-20, y + 16], [W + 20, y + 16], [W + 20, H + 20], [-20, H + 20]], col, 0.97, { jit: 0, hard: true, noEdge: true });
}
// a tree as the old painters draw one: a dark rounded mass of separately dabbed leaves on a slim trunk
function tree(P, x, y, s = 1, col = C.leaf, kind = 0) {
  const r = P.r, h = (kind ? 104 : 86) * s;
  const T = [[x - 9 * s, y + 3], [x - 5.5 * s, y - h * 0.5], [x - 6 * s, y - h], [x + 6 * s, y - h], [x + 6.5 * s, y - h * 0.5], [x + 11 * s, y + 3]];
  P.wash(T, C.umber, 0.95, { jit: 0.5 }); P.line(T.slice(0, 3), 1.3); P.line(T.slice(3).reverse(), 1.3);
  P.hatch(T, { gap: 3.6, ang: 0.5, a: 0.5, w: 0.7 });
  P.line([[x, y - h * 0.5], [x + 3, y - h * 0.32]], 0.8, C.ink, { ghost: false, a: 0.5 }); P.line([[x - 2, y - h * 0.18], [x + 2, y]], 0.8, C.ink, { ghost: false, a: 0.5 });
  // the crown: a heap of separate rounded clumps, back ones first, each with its own edge of leaves
  const clumps = []; const n = kind ? 5 : 7, wid = (kind ? 40 : 66) * s, tall = (kind ? 92 : 68) * s, cy = y - h - tall * 0.62;
  for (let i = 0; i < n; i++) { const a = i / n * 6.283 + r() * 0.5, q = i === n - 1 ? 0 : 0.72; clumps.push([x + Math.cos(a) * wid * q, cy + Math.sin(a) * tall * q * 0.7, (kind ? 30 : 34) * s * (0.85 + r() * 0.4)]); }
  clumps.sort((p, q) => p[1] - q[1]);
  const X = P.x;
  for (const [cx, c2, R] of clumps) {
    const ring = []; for (let i = 0; i < 11; i++) { const a = i / 11 * 6.283, q = 1 + (i % 2 ? 0.1 : -0.05) + (r() - 0.5) * 0.1; ring.push([cx + Math.cos(a) * R * q, c2 + Math.sin(a) * R * 0.86 * q]); }
    P.wash(ring, col, 0.96, { jit: 0.6 });
    // separately dabbed leaves: dark all through, pale toward the light
    X.strokeStyle = C.ink; X.globalAlpha = 0.6; X.lineWidth = 0.9; X.beginPath();
    const m = Math.round(R * R * 0.045 + 7);
    for (let i = 0; i < m; i++) { const a = r() * 6.283, q = Math.sqrt(r()) * 0.96, lx = cx + Math.cos(a) * q * R, ly = c2 + Math.sin(a) * q * R * 0.84, an = r() * 3.14, l = 3.3 * Math.max(0.7, s); X.moveTo(lx - Math.cos(an) * l, ly - Math.sin(an) * l); X.quadraticCurveTo(lx + Math.sin(an) * l * 0.7, ly - Math.cos(an) * l * 0.7, lx + Math.cos(an) * l, ly + Math.sin(an) * l); }
    X.stroke(); X.globalAlpha = 1;
    const pale = []; for (let i = 0; i < m * 0.5; i++) { const a = -2.5 + r() * 1.8, q = 0.35 + r() * 0.6; pale.push([cx + Math.cos(a) * q * R, c2 + Math.sin(a) * q * R * 0.84]); } P.dots(pale, 1.25 * Math.max(0.8, s), C.white, 0.5);
    P.line([...ring, ring[0], ring[1]], 1, C.ink, { a: 0.62, dry: 0.42, ghost: false, jit: 0.5 });
  }
}
// water drawn as rows of little interlocking waves, the way river and sea are painted in the miniatures
function waves(P, y0, y1, col, o = {}) {
  const x = P.x, r = P.r, step = o.step ?? 44, dy = o.dy ?? 22;
  P.wash(o.shape || [[-10, y0], [W + 10, y0], [W + 10, y1], [-10, y1]], col, o.a ?? 0.7, { jit: 0 });
  x.save(); if (o.clip) { x.beginPath(); x.moveTo(o.clip[0][0], o.clip[0][1]); for (const p of o.clip) x.lineTo(p[0], p[1]); x.closePath(); x.clip(); }
  x.strokeStyle = C.ink; x.globalAlpha = o.ink ?? 0.5; x.lineWidth = 0.95; x.beginPath();
  for (let row = 0, y = y0 + dy * 0.6; y < y1 + dy; row++, y += dy) {
    const s = step * (0.7 + 0.5 * (y - y0) / Math.max(1, y1 - y0));
    for (let X = -60 + (row % 2) * s * 0.5; X < W + 60; X += s) { const j = (r() - 0.5) * 3, q = s * 0.5; x.moveTo(X - q, y + j); x.quadraticCurveTo(X - q * 0.2, y - dy * 0.75 + j, X + q * 0.25, y - dy * 0.55 + j); x.quadraticCurveTo(X + q * 0.2, y - dy * 0.1 + j, X - q * 0.1, y + dy * 0.05 + j); }
  }
  x.stroke(); x.restore(); x.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------- people, in profile
// map from a figure's own drawing space (facing right, feet or neck at the origin) into the plate
const fig = (x, y, s, f = 1) => (a, b) => [x + a * s * f, y + b * s];
const map = (T, pts) => pts.map((p) => T(p[0], p[1]));
function head(P, T, s, o = {}) {
  // the classic line: sloping brow straight into the nose, small mouth, rounded chin, and a long eye reaching toward the ear
  const face = map(T, [[2, -96], [14, -92], [22, -80], [29, -66], [33, -58], [25, -54], [26, -48], [22, -45], [24, -41], [18, -35], [14, -29], [2, -26], [-4, -28], [-8, -50], [-8, -80]]);
  P.wash(face, o.skin || C.flesh, 0.8, { jit: 0.4 });
  if (!o.back) { P.line(map(T, [[3, -96], [14, -92], [22, -80], [29, -66], [33, -58], [25, -54], [26, -48], [22, -45], [24, -41], [18, -35], [14, -29], [3, -26]]), 1.3 * Math.min(1.4, s + 0.4), C.ink, { jit: 0.3, dry: 0.04 }); }
  const X = P.x;
  if (o.closed) P.line(map(T, [[-4, -67], [6, -63], [18, -66]]), 1.3, C.ink, { ghost: false, jit: 0.2 });
  else {
    const eye = map(T, [[-6, -68], [3, -74], [16, -69], [20, -66], [14, -63], [3, -62]]);
    P.wash(eye, C.white, 0.95, { body: true, jit: 0.2 }); P.line([...eye, eye[0]], 1, C.ink, { ghost: false, jit: 0.2 });
    const c = T(8, -68); X.fillStyle = C.ink; X.beginPath(); X.arc(c[0], c[1], 2.9 * s, 0, 6.283); X.fill();
  }
  P.line(map(T, [[-8, -77], [4, -83], [20, -78]]), 1.6 * Math.min(1.3, s + 0.3), C.ink, { ghost: false, jit: 0.3 });
  if (o.mouth) { const m = T(19, -44); X.fillStyle = '#5a2c22'; X.beginPath(); X.ellipse(m[0], m[1], 3.4 * s, 2.2 * s, 0, 0, 6.283); X.fill(); } else P.line(map(T, [[10, -45], [17, -44], [23, -45]]), 1, C.red, { ghost: false, jit: 0.2 });
}
function hairWoman(P, T, s, veil = true) {
  P.shape(map(T, [[3, -98], [-16, -104], [-38, -90], [-46, -62], [-42, -38], [-26, -22], [-12, -24], [-6, -40], [-6, -60], [-2, -76], [6, -88]]), C.ink, 0.9, 1.2, { jit: 0.5 });
  P.shape(map(T, [[-34, -36], [-54, -36], [-60, -22], [-48, -12], [-32, -20]]), C.ink, 0.9, 1, { jit: 0.5 });
  if (veil) { const v = map(T, [[10, -106], [-20, -112], [-54, -92], [-68, -50], [-76, 10], [-40, 30], [-16, -14], [-4, -44], [-4, -74], [6, -92]]); P.wash(v, C.red, 0.5); P.line(v, 1.5, C.ink, { dry: 0.14 }); const hem = map(T, [[10, -106], [-4, -74], [-4, -44], [-16, -14]]); P.line(hem, 3.4, C.ochre, { ghost: false, a: 0.85, dry: 0.3 }); }
}
function limb(P, T, a, b, c, w0, w1, col, s, o = {}) {
  // an arm or leg as a tapering form, with a small hand at its end
  const d = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; }, n1 = d(a, b), n2 = d(b, c);
  const pts = [[a[0] + n1[0] * w0, a[1] + n1[1] * w0], [b[0] + (n1[0] + n2[0]) * 0.5 * (w0 + w1) * 0.5, b[1] + (n1[1] + n2[1]) * 0.5 * (w0 + w1) * 0.5], [c[0] + n2[0] * w1, c[1] + n2[1] * w1], [c[0] - n2[0] * w1, c[1] - n2[1] * w1], [b[0] - (n1[0] + n2[0]) * 0.5 * (w0 + w1) * 0.5, b[1] - (n1[1] + n2[1]) * 0.5 * (w0 + w1) * 0.5], [a[0] - n1[0] * w0, a[1] - n1[1] * w0]];
  P.shape(map(T, pts), col, 0.95, 1.15, { jit: 0.3 });
  P.hatch(map(T, [pts[0], pts[1], pts[2], [(pts[2][0] + c[0]) / 2, (pts[2][1] + c[1]) / 2], b, a]), { gap: 4, ang: 0.9, a: 0.34, w: 0.7 });
  if (o.hand !== false) {
    // an open hand: palm, four fingers and a thumb, drawn as one hard outline
    const u = [c[0] - b[0], c[1] - b[1]], l = Math.hypot(u[0], u[1]) || 1, ux = u[0] / l, uy = u[1] / l, W0 = w1 * 1.15, L = w1 * 2.5;
    const H0 = (al, nr) => [c[0] + ux * al * L + n2[0] * nr * W0, c[1] + uy * al * L + n2[1] * nr * W0];
    const hand = [H0(0, 1), H0(0.42, 1.45), H0(0.62, 1.95), H0(0.5, 1.05), H0(0.55, 1), H0(1.02, 1.02), H0(0.62, 0.52), H0(1.2, 0.36), H0(0.66, 0.08), H0(1.2, -0.3), H0(0.62, -0.5), H0(1.02, -0.92), H0(0.5, -0.95), H0(0, -1)];
    P.shape(map(T, hand), col, 0.97, 0.95, { hard: true, jit: 0.1 });
  }
}
function woman(P, x, y, s, f, o = {}) {
  // waist up (the river or the cart hides the rest): sari over a dark bodice, the end drawn up over her head
  const T = fig(x, y, s, f);
  P.shape(map(T, [[-44, 40], [-42, -6], [-26, -22], [-4, -24], [8, -18], [24, 14], [26, 62], [18, o.len ?? 150], [-46, o.len ?? 150]]), C.red, 0.78, 1.8);
  P.hatch(map(T, [[-44, 40], [-26, -22], [8, -18], [24, 14], [18, 150], [-46, 150]]), { gap: 11, ang: 1.25, a: 0.32 });
  P.line(map(T, [[10, -16], [-14, 30], [-36, 70], [-44, 130]]), 3, C.ochre, { ghost: false, a: 0.8, dry: 0.32 });
  P.line(map(T, [[20, 8], [-6, 34], [-30, 58]]), 0.9, C.ink, { a: 0.5, ghost: false });
  hairWoman(P, T, s, true);
  head(P, T, s, o);
  // necklace and ear-drop
  P.dots(map(T, [[6, -20], [2, -15], [-3, -12], [-8, -14], [-3, -30]]), 1.8 * s, C.ochre, 0.95);
}
function child(P, x, y, s, f, o = {}) {
  // a small child in a plain tunic, sitting or lying (rot turns the whole figure)
  const rot = o.rot || 0, c = Math.cos(rot), sn = Math.sin(rot), T = (a, b) => { const X = a * f, Y = b; return [x + (X * c - Y * sn) * s, y + (X * sn + Y * c) * s]; };
  limb(P, T, [8, 50], [34, 62], [62, 66], 11, 7, C.flesh, s, { hand: false }); limb(P, T, [-6, 52], [14, 72], [38, 86], 11, 7, C.flesh, s, { hand: false });
  P.shape(map(T, [[-20, -12], [14, -12], [24, 14], [28, 56], [-24, 62], [-26, 18]]), C.white, 0.92, 1.5, { body: true, jit: 0.5 });
  P.line(map(T, [[-22, 40], [2, 48], [26, 40]]), 2.2, C.red, { ghost: false, a: 0.7, dry: 0.3 });
  const a = o.arm ?? [[14, 2], [36, 14], [54, 6]]; limb(P, T, a[0], a[1], a[2], 7.5, 5.5, C.flesh, s);
  // the head: round and large for the body, a tuft of black hair
  const hT = (u, v) => T(u * 0.72, v * 0.72 - 6);
  P.shape(map(hT, [[2, -96], [-20, -102], [-40, -82], [-40, -56], [-26, -34], [-8, -30], [-4, -52], [0, -72], [8, -86]]), C.ink, 0.9, 1, { jit: 0.4 });
  head(P, hT, s * 0.72, { closed: o.closed, mouth: o.mouth });
}
function lota(P, x, y, s) {
  P.shape([[x - 24 * s, y - 6 * s], [x - 13 * s, y - 22 * s], [x - 13 * s, y - 32 * s], [x - 18 * s, y - 38 * s], [x + 18 * s, y - 38 * s], [x + 13 * s, y - 32 * s], [x + 13 * s, y - 22 * s], [x + 24 * s, y - 6 * s], [x + 20 * s, y + 18 * s], [x - 20 * s, y + 18 * s]], C.steel, 0.85, 1.5, { jit: 0.4 });
  P.line([[x - 15 * s, y - 8 * s], [x - 10 * s, y + 8 * s]], 2 * s, C.white, { ghost: false, a: 0.8 });
  P.line([[x - 18 * s, y - 38 * s], [x + 18 * s, y - 38 * s]], 1.8, C.ink, { ghost: false });
}
function log(P, x, y, l, r, tilt = 0) {
  const c = Math.cos(tilt), s = Math.sin(tilt), T = (a, b) => [x + a * c - b * s, y + a * s + b * c];
  P.shape(map(T, [[-l, -r], [-l * 0.3, -r * 1.05], [l * 0.5, -r * 0.92], [l, -r * 0.8], [l + r * 0.2, 0], [l, r * 0.82], [l * 0.4, r], [-l, r]]), C.umber, 0.82, 2);
  const e = T(-l, 0); P.shape(Array.from({ length: 9 }, (_, i) => { const a = i / 9 * 6.283; return [e[0] + Math.cos(a) * r * 0.36, e[1] + Math.sin(a) * r]; }), C.ochre, 0.6, 1.3, { jit: 0.3 });
  P.line(Array.from({ length: 8 }, (_, i) => { const a = i / 8 * 6.283; return [e[0] + Math.cos(a) * r * 0.18, e[1] + Math.sin(a) * r * 0.55]; }), 0.8, C.ink, { ghost: false, a: 0.6 });
  for (let i = 0; i < 9; i++) { const u = -l * 0.8 + (i / 9) * l * 1.7, v = -r * 0.7 + P.r() * r * 1.3; P.line([T(u, v), T(u + l * 0.13, v + (P.r() - 0.5) * 4), T(u + l * 0.26, v + (P.r() - 0.5) * 3)], 0.9, C.ink, { ghost: false, a: 0.5, dry: 0.3 }); }
}
function bullock(P, x, y, s, f = 1) {
  const T = fig(x, y, s, f);
  const leg = (a, b, near) => { P.shape(map(T, [[a - 11, b - 16], [a + 11, b - 16], [a + 8, b + 34], [a + 7, b + 66], [a - 5, b + 66], [a - 7, b + 34]]), C.white, near ? 0.92 : 0.7, 1.3, { body: true, jit: 0.4 }); P.shape(map(T, [[a - 6, b + 64], [a + 8, b + 64], [a + 10, b + 76], [a - 8, b + 76]]), C.ink, 0.85, 1, { jit: 0.3 }); };
  leg(-66, 20, false); leg(70, 18, false);
  const body = [[-104, -42], [-40, -52], [42, -56], [72, -92], [96, -60], [108, -22], [100, 24], [40, 36], [-40, 38], [-98, 28], [-112, -8]];
  P.shape(map(T, body), C.white, 0.92, 2, { body: true });
  P.hatch(map(T, [[-100, 8], [-40, 36], [40, 36], [100, 22], [90, 8], [0, 16]]), { gap: 7, ang: 0.1, a: 0.32 });
  // the painted blanket on his back, and a rope of bells
  P.wash(map(T, [[-44, -50], [38, -54], [50, 8], [-40, 12]]), C.red, 0.72);
  P.line(map(T, [[-44, -50], [38, -54], [50, 8], [-40, 12], [-44, -50], [-40, -46]]), 1.2);
  P.dots(Array.from({ length: 22 }, (_, i) => T(-36 + (i % 6) * 14 + (Math.floor(i / 6) % 2) * 7, -40 + Math.floor(i / 6) * 13)), 1.5 * s, C.ochre, 0.95);
  leg(-88, 24, true); leg(88, 20, true);
  P.line(map(T, [[-112, -28], [-126, 10], [-122, 44], [-130, 58]]), 2.6);
  // neck and head
  P.shape(map(T, [[92, -50], [136, -66], [184, -48], [194, -18], [176, -6], [152, -12], [112, 22]]), C.white, 0.94, 1.9, { body: true });
  P.line(map(T, [[142, -64], [132, -96], [146, -120]]), 4.2, C.ink, { a: 0.8 }); P.line(map(T, [[158, -62], [166, -94], [186, -112]]), 4.2, C.ink, { a: 0.8 });
  P.shape(map(T, [[128, -58], [112, -66], [118, -50]]), C.white, 0.9, 1, { body: true });
  const e = T(158, -44); P.x.fillStyle = C.ink; P.x.beginPath(); P.x.arc(e[0], e[1], 3.2 * s, 0, 6.283); P.x.fill(); P.line(map(T, [[148, -48], [158, -52], [168, -46], [158, -40], [148, -48]]), 1, C.ink, { ghost: false });
  P.line(map(T, [[188, -22], [180, -14], [170, -16]]), 1, C.ink, { ghost: false });
  P.dots(map(T, [[100, 2], [106, 8], [112, 12], [118, 8], [124, 2]]), 2.6 * s, C.ochre, 0.95);
}
function wheel(P, x, y, r) {
  const ring = []; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; ring.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  P.line([...ring, ring[0], ring[1]], 5, C.sepia, { jit: 0.6, dry: 0.08 }); P.line(ring.map((p) => [x + (p[0] - x) * 0.86, y + (p[1] - y) * 0.86]).concat([[x + r * 0.86, y]]), 1.1, C.ink, { ghost: false });
  for (let k = 0; k < 6; k++) { const a = k / 6 * 3.14159 + 0.3; P.line([[x - Math.cos(a) * r, y - Math.sin(a) * r], [x + Math.cos(a) * r, y + Math.sin(a) * r]], 2.3, C.sepia, { jit: 0.5 }); }
  P.shape(Array.from({ length: 8 }, (_, i) => { const a = i / 8 * 6.283; return [x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16]; }), C.umber, 0.9, 1.2, { jit: 0.3 });
}
// a wolf in profile, her coat in rows of short dashes
function wolf(P, x, y, s, f, o = {}) {
  const T = fig(x, y, s, f), hd = o.down ? 86 : 0, col = C.wolf;
  const leg = (a, b, sw, near) => { const pts = [[a - 12, b - 12], [a + 12, b - 12], [a + 9 + sw * 0.5, b + 38], [a + 6 + sw, b + 76], [a + 16 + sw, b + 84], [a - 6 + sw, b + 86], [a - 6 + sw, b + 40]]; P.shape(map(T, pts), near ? col : C.umber, near ? 0.75 : 0.62, 1.3, { jit: 0.4 }); };
  leg(-64, 4, -14, false); leg(78, 0, 16, false);
  const tail = [[-112, -30], [-158, -18], [-208, 26], [-214, 46], [-186, 44], [-146, 18], [-110, -2]];
  P.shape(map(T, tail), col, 0.72, 1.6);
  P.hatch(map(T, tail), { gap: 8, ang: 0.8, dash: 7, a: 0.55, w: 1 });
  const body = [[-118, -34], [-60, -50], [8, -46], [66, -62], [108, -56], [124, -24], [100, 18], [40, 14], [-30, 20], [-90, 24], [-124, 6]];
  P.shape(map(T, body), col, 0.75, 2);
  P.hatch(map(T, body), { gap: 8, ang: -0.18, dash: 8, a: 0.72, w: 1.05 });
  P.wash(map(T, [[-90, 18], [-30, 12], [40, 8], [96, 14], [60, 20], [-40, 24]]), C.white, 0.7, { body: true });
  leg(-84, 8, 16, true); leg(92, 6, -14, true);
  // neck, head and ears
  const hy = -74 + hd;
  P.shape(map(T, [[80, -62], [136, hy - 8], [158, hy + 22], [112, 8]]), col, 0.78, 1.8);
  P.hatch(map(T, [[80, -62], [136, hy - 8], [158, hy + 22], [112, 8]]), { gap: 9, ang: 0.6, dash: 7, a: 0.6, w: 1 });
  const head = [[122, hy - 22], [126, hy - 52], [140, hy - 26], [152, hy - 54], [164, hy - 24], [212, hy - 2], [226, hy + 12], [208, hy + 26], [166, hy + 30], [132, hy + 18]];
  P.shape(map(T, head), col, 0.8, 2);
  P.hatch(map(T, [[132, hy - 18], [166, hy - 20], [206, hy + 4], [170, hy + 22], [134, hy + 14]]), { gap: 7, ang: 0.15, dash: 5, a: 0.55, w: 0.9 });
  P.wash(map(T, [[170, hy + 14], [206, hy + 12], [204, hy + 24], [168, hy + 28]]), C.white, 0.8, { body: true });
  const E = map(T, [[156, hy - 8], [166, hy - 12], [178, hy - 6], [166, hy - 2]]); P.wash(E, C.ochre, 0.95, { body: true, jit: 0.2 }); P.line([...E, E[0]], 1.2, C.ink, { ghost: false, jit: 0.2 });
  const c = T(167, hy - 7); P.x.fillStyle = C.ink; P.x.beginPath(); P.x.arc(c[0], c[1], 2.6 * s, 0, 6.283); P.x.fill();
  const n = T(222, hy + 10); P.x.beginPath(); P.x.arc(n[0], n[1], 5 * s, 0, 6.283); P.x.fill();
  P.line(map(T, [[218, hy + 20], [196, hy + 22], [170, hy + 16]]), 1.6);
  return T(188, hy + 30);   // her mouth
}

// ---------------------------------------------------------------------------------------------- the plates
// the family on the cart: father turbaned and driving, mother with the child on her lap and his lota beside him
function PEOPLE(P, cy) {
  { const T = fig(760, cy - 96, 1.02, 1); P.shape(map(T, [[-32, 30], [-30, -6], [-16, -22], [8, -22], [22, 2], [26, 30]]), C.white, 0.95, 1.7, { body: true }); P.hatch(map(T, [[-30, 28], [-28, -4], [-12, -18], [-8, 28]]), { gap: 5, ang: 1.1, a: 0.36, w: 0.8 }); limb(P, T, [8, -8], [34, 12], [62, -2], 6.5, 4.5, C.flesh, 1); head(P, T, 1, {}); P.shape(map(T, [[10, -86], [-8, -106], [-34, -104], [-48, -84], [-42, -66], [-6, -70], [18, -74]]), C.red, 0.95, 1.6, { jit: 0.5 }); for (let k = 0; k < 4; k++) P.line(map(T, [[-44 + k * 4, -70 - k * 8], [-14, -80 - k * 7], [14, -78 - k * 2]]), 0.9, C.ink, { ghost: false, a: 0.6 }); P.line(map(T, [[12, -48], [4, -44], [-4, -48]]), 2, C.ink, { ghost: false }); P.line(map(T, [[70, -4], [190, -10], [330, 10]]), 1, C.ink, { ghost: false, a: 0.7 }); }
  woman(P, 540, cy - 96, 1.02, 1, { len: 66 });
  { const T = fig(540, cy - 96, 1.02, 1); limb(P, T, [16, 6], [44, 42], [74, 30], 7, 5, C.flesh, 1); }
  child(P, 620, cy - 126, 0.8, 1, { arm: [[12, 0], [28, 14], [40, 18]] });
  lota(P, 672, cy - 100, 0.72);
}
const PLATES = [
  (P) => {   // the hills of Seoni under the monsoon, the Pench winding through them
    skyWash(P, C.dusk, 470, C.indigo);
    hills(P, 400, 110, C.green, 3, 0.55); hills(P, 500, 80, C.greenD, 6, 0.55);
    const riv = [[880, 470], [770, 540], [900, 610], [640, 700], [800, 790], [560, 915], [1120, 915], [1090, 800], [1180, 700], [1130, 620], [1000, 560], [950, 480]];
    hills(P, 600, 46, C.green, 9, 0.5, false);
    waves(P, 460, 920, C.water, { a: 0.9, shape: riv, clip: P.curve(riv, true, 0), step: 34, dy: 16, ink: 0.55 });
    P.line([...riv, riv[0]], 1.6, C.ink, { dry: 0.2 });
    for (const [x, y, s, k] of [[90, 770, 0.95, 0], [230, 850, 1.2, 1], [390, 790, 0.85, 0], [520, 860, 1, 0], [1270, 830, 1.15, 0], [1410, 770, 0.9, 1], [1530, 860, 1.25, 0], [1180, 880, 0.8, 1]]) tree(P, x, y, s, C.greenD, k);
    cloudBand(P, 110, C.indigo, 0.82, 7);
    rain(P, 150, 880, 210, 0.3);
    // cranes crossing ahead of the rain
    for (const [x, y] of [[640, 300], [690, 276], [740, 262], [600, 318]]) P.line([[x - 15, y - 5], [x - 3, y + 2], [x + 14, y - 6]], 1.3, C.ink, { ghost: false });
  },
  (P) => {   // the cart at the ford
    skyWash(P, C.dusk, 440, C.ochre);
    hills(P, 330, 70, C.green, 12, 0.5); hills(P, 420, 46, C.greenD, 14, 0.5);
    for (const [x, y, s] of [[80, 470, 0.7], [280, 460, 0.6], [1330, 470, 0.75], [1510, 460, 0.65]]) tree(P, x, y, s);
    cloudBand(P, 70, C.indigo, 0.72, 8);
    waves(P, 610, 910, C.water, { a: 0.7, step: 56, dy: 26 });
    P.wash([[-10, 480], [W + 10, 490], [W + 10, 625], [-10, 625]], C.sand, 0.96, { jit: 2 });
    const cy = 590;
    bullock(P, 1090, cy - 26, 1.02); bullock(P, 1060, cy - 18, 1.02);
    // the cart: its people first, then the low bed that hides their legs, then the wheels
    P.line([[820, cy - 60], [920, cy - 70], [1190, cy - 70]], 6, C.sepia);
    PEOPLE(P, cy);
    P.shape([[420, cy - 92], [850, cy - 92], [866, cy - 38], [404, cy - 38]], C.umber, 0.95, 2.2, { hard: true });
    P.hatch([[420, cy - 92], [850, cy - 92], [866, cy - 38], [404, cy - 38]], { gap: 34, ang: 1.5, a: 0.55, w: 1.2, hard: true });
    wheel(P, 520, cy + 18, 70); wheel(P, 760, cy + 18, 70);
    rain(P, 90, 700, 120, 0.2);
  },
  (P) => {   // the water comes
    skyWash(P, C.indigo, 620, C.night);
    hills(P, 360, 90, C.greenD, 21, 0.55); hills(P, 470, 46, C.greenD, 24, 0.45);
    // the far-off cart, small and still in the ford
    waves(P, 590, 920, C.water, { a: 0.62, step: 46, dy: 22, ink: 0.42 });
    { const cy = 600; bullock(P, 1370, cy - 8, 0.44); woman(P, 1140, cy - 28, 0.42, 1, { len: 50 }); const T = fig(1224, cy - 28, 0.42, 1); P.shape(map(T, [[-32, 30], [-30, -6], [-16, -22], [8, -22], [22, 2], [26, 30]]), C.white, 0.95, 1.2, { body: true }); head(P, T, 0.42, {}); P.shape(map(T, [[10, -86], [-8, -106], [-34, -104], [-48, -84], [-42, -66], [-6, -70], [18, -74]]), C.red, 0.95, 1.1, { jit: 0.3 }); P.shape([[1078, cy - 28], [1270, cy - 28], [1276, cy - 6], [1072, cy - 6]], C.umber, 0.95, 1.6, { hard: true }); wheel(P, 1120, cy + 12, 30); wheel(P, 1224, cy + 12, 30); }
    // the flood: a great wall of patterned water, its top and leading edge breaking into a white, hooked crest
    const edge = []; for (let i = 0; i <= 12; i++) { const t = i / 12; edge.push([-20 + t * 960 + Math.sin(i * 1.7) * 30, 300 + t * t * 620 + Math.sin(i * 2.3) * 26]); }
    const body = [[-20, 930], [-20, 300], ...edge, [960, 930]];
    waves(P, 280, 930, C.flood, { a: 0.97, shape: body, clip: P.curve(body, true, 0), step: 76, dy: 34, ink: 0.62 });
    // currents dragging through it
    for (let k = 0; k < 6; k++) { const y = 400 + k * 90; P.line([[-10, y], [180, y - 30], [400, y + 10], [640 - k * 20, y - 20 + k * 22]], 2.2, C.ink, { a: 0.5, dry: 0.3 }); }
    for (let i = 0; i < edge.length - 1; i++) {
      const [ax, ay] = edge[i], [bx, by] = edge[i + 1];
      for (let k = 0; k < 2 + (i % 2); k++) {
        const t = k / 3, x0 = ax + (bx - ax) * t + (P.r() - 0.5) * 20, y0 = ay + (by - ay) * t + (P.r() - 0.5) * 24, R = 22 + P.r() * P.r() * 66;
        // each breaker: a white lobe with a curling hook of ink, flung forward over the edge
        const lobe = [[x0 - R * 0.9, y0 + R * 0.4], [x0 - R * 0.5, y0 - R * 0.7], [x0 + R * 0.4, y0 - R * 0.8], [x0 + R * 1.05, y0 - R * 0.15], [x0 + R * 0.62, y0 + R * 0.28], [x0 + R * 0.2, y0 + R * 0.12], [x0 - R * 0.05, y0 + R * 0.5]];
        P.wash(lobe, C.white, 0.97, { jit: 1 }); P.line(lobe.slice(0, 7), 1.5, C.ink, { dry: 0.14 });
        P.line([[x0 - R * 0.4, y0 - R * 0.1], [x0 + R * 0.2, y0 - R * 0.42], [x0 + R * 0.62, y0 - R * 0.12]], 1, C.ink, { ghost: false, a: 0.7 });
        const sp = []; for (let q = 0; q < 10; q++) sp.push([x0 + R * (0.4 + P.r() * 1.5), y0 - R * 0.6 + P.r() * R * 1.4]); P.dots(sp, 2, C.white, 0.9);
      }
    }
    log(P, 300, 520, 130, 18, 0.34); log(P, 500, 760, 100, 15, -0.5);
    cloudBand(P, 76, C.night, 0.9, 7);
    // lightning, as a thin hard line
    P.line([[1160, 140], [1124, 250], [1176, 280], [1120, 410], [1148, 430], [1104, 540]], 2.2, C.white, { ghost: false, a: 0.9, jit: 0.4 });
    rain(P, 110, 900, 230, 0.32, -0.34);
  },
  (P) => {   // she ties him to the log
    skyWash(P, C.indigo, 900, C.night);
    hills(P, 300, 40, C.greenD, 31, 0.45, false);
    cloudBand(P, 56, C.night, 0.82, 6);
    const wl = 660;
    log(P, 960, wl - 26, 360, 44, -0.02);
    // the sari end wrapped round log and child again and again, through the pot's handle
    child(P, 1000, wl - 176, 1.26, -1, { closed: false, mouth: true, arm: [[14, 0], [36, -6], [52, -20]] });
    lota(P, 1180, wl - 94, 1.15);
    for (const X of [820, 900, 980, 1060]) { const b = [[X - 18, wl - 74], [X + 20, wl - 80], [X + 28, wl + 22], [X - 12, wl + 28]]; P.shape(b, C.red, 0.95, 1.4, { jit: 0.6, hard: true }); P.line([[X - 14, wl - 60], [X + 14, wl - 62]], 1.8, C.ochre, { ghost: false }); P.line([[X - 11, wl + 12], [X + 22, wl + 8]], 1.8, C.ochre, { ghost: false }); }
    P.line([[1060, wl - 74], [1110, wl - 122], [1176, wl - 136], [1188, wl - 110]], 9, C.red, { dry: 0.1 });
    woman(P, 560, 420, 1.76, 1, { mouth: true });
    { const T = fig(560, 420, 1.76, 1); limb(P, T, [18, 6], [62, 60], [122, 62], 7.5, 5, C.flesh, 1.76); limb(P, T, [-20, 12], [42, 92], [124, 98], 8, 5.2, C.flesh, 1.76); }
    waves(P, wl + 30, 920, C.flood, { a: 0.9, step: 72, dy: 34, ink: 0.6 });
    P.line([[-10, wl + 34], [300, wl + 22], [620, wl + 38], [980, wl + 24], [1300, wl + 38], [W + 10, wl + 24]], 2.2);
    rain(P, 110, wl + 100, 170, 0.3, -0.3);
  },
  (P) => {   // she hums to him; the river takes her
    skyWash(P, C.night, 900, C.indigo);
    cloudBand(P, 50, C.ink, 0.5, 6);
    const wl = 580;
    // her face and one raised arm, the last of her above the water, and him drifting off on the log
    woman(P, 400, wl - 8, 1.5, 1, { closed: true });
    { const T = fig(400, wl - 8, 1.5, 1); limb(P, T, [24, 62], [72, 22], [84, -52], 7.5, 5.2, C.flesh, 1.5); }
    waves(P, wl + 34, 920, C.flood, { a: 0.92, step: 74, dy: 36, ink: 0.62 });
    P.line([[-10, wl + 44], [280, wl + 26], [620, wl + 46], [980, wl + 28], [1300, wl + 46], [W + 10, wl + 30]], 2.2);
    log(P, 1190, wl + 16, 280, 36, 0.02);
    child(P, 1170, wl - 120, 1.04, -1, { closed: true, arm: [[10, 8], [24, 28], [44, 44]] });
    lota(P, 1310, wl - 38, 0.95);
    P.shape([[1130, wl - 20], [1176, wl - 24], [1182, wl + 50], [1136, wl + 54]], C.red, 0.95, 1.4, { jit: 0.6, hard: true });
    rain(P, 80, wl + 60, 140, 0.24, -0.26);
  },
  (P) => {   // alone on the river at night
    P.wash([[-10, -10], [W + 10, -10], [W + 10, H + 10], [-10, H + 10]], C.night, 0.96, { jit: 0, hard: true });
    const moon = Array.from({ length: 18 }, (_, i) => { const a = i / 18 * 6.283; return [1240 + Math.cos(a) * 62, 170 + Math.sin(a) * 62]; });
    P.wash(moon, C.white, 0.95, { body: true, jit: 0.4 }); P.line([...moon, moon[0]], 1.3, C.ink, { ghost: false });
    const stars = []; for (let i = 0; i < 70; i++) stars.push([P.r() * W, P.r() * 340]); P.dots(stars, 1.3, C.white, 0.7);
    hills(P, 440, 46, C.ink, 41, 0.44, false);
    for (const [x, s] of [[120, 0.5], [290, 0.42], [1400, 0.5], [1530, 0.4], [860, 0.36]]) tree(P, x, 462, s, C.ink);
    waves(P, 490, 920, C.indigo, { a: 0.7, step: 66, dy: 30, ink: 0.65 });
    const glint = []; for (let i = 0; i < 26; i++) { const y = 500 + P.r() * 360; P.line([[1240 - 60 - P.r() * 30, y], [1240, y - 3], [1240 + 60 + P.r() * 30, y]], 1.6, C.white, { ghost: false, a: 0.55, dry: 0.3 }); }
    log(P, 700, 680, 130, 15, 0.02); child(P, 690, 636, 0.42, 1, { closed: true, arm: [[10, 6], [22, 24], [34, 38]] }); lota(P, 760, 660, 0.42);
  },
  (P) => {   // dawn on the sandbank: the wolf finds him
    skyWash(P, C.dusk, 430, C.ochre);
    const sun = Array.from({ length: 18 }, (_, i) => { const a = i / 18 * 6.283; return [1280 + Math.cos(a) * 64, 300 + Math.sin(a) * 64]; }); P.wash(sun, C.red, 0.6, { jit: 0.4 }); P.line([...sun, sun[0]], 1.2, C.ink, { ghost: false });
    hills(P, 330, 60, C.green, 51, 0.45); hills(P, 400, 34, C.greenD, 53, 0.45, false);
    for (const [x, y, s, k] of [[80, 450, 0.8, 0], [240, 440, 0.66, 1], [420, 450, 0.74, 0], [1120, 446, 0.66, 0], [1500, 452, 0.86, 1]]) tree(P, x, y, s, C.greenD, k);
    waves(P, 440, 560, C.water, { a: 0.65, step: 40, dy: 15, ink: 0.42 });
    const bank = [[-10, 590], [340, 546], [840, 560], [1320, 548], [W + 10, 590], [W + 10, H + 10], [-10, H + 10]]; P.wash(bank, C.sand, 0.85); P.line(bank.slice(0, 5), 1.7, C.ink, { dry: 0.2 });
    { const pts = []; for (let i = 0; i < 300; i++) pts.push([P.r() * W, 590 + P.r() * 300]); P.dots(pts, 0.9, C.sepia, 0.42); }
    log(P, 1290, 700, 250, 32, 0.03);
    child(P, 930, 770, 0.92, 1, { rot: -1.45, closed: true, arm: [[10, 10], [26, 22], [38, 34]] });
    lota(P, 1040, 800, 0.84);
    wolf(P, 470, 672, 1.2, 1, { down: true });
    for (const [x, y] of [[80, 780], [150, 816], [230, 794], [310, 836]]) P.dots([[x, y], [x + 9, y - 6], [x + 16, y + 1], [x + 8, y + 7], [x + 2, y + 8]], 2.2, C.sepia, 0.6);
  },
  (P) => {   // she carries him home
    skyWash(P, C.dusk, 500, C.ochre);
    hills(P, 340, 56, C.green, 61, 0.42);
    // the forest she walks into, tree over tree, and the rock of the den
    for (const [x, y, s, k] of [[1120, 500, 1.1, 0], [1270, 516, 1.3, 1], [1420, 500, 1.15, 0], [1560, 520, 1.4, 0], [960, 500, 0.9, 1]]) tree(P, x, y, s, C.greenD, k);
    const gr = [[-10, 650], [500, 616], [1100, 636], [W + 10, 650], [W + 10, H + 10], [-10, H + 10]]; P.wash(gr, C.green, 0.62); P.line(gr.slice(0, 4), 1.7, C.ink, { dry: 0.22 });
    const rock = [[1170, 720], [1260, 540], [1390, 500], [1520, 530], [1630, 620], [1630, 790], [1180, 790]]; P.wash(rock, C.umber, 0.6); P.line(rock, 2.2, C.ink, { dry: 0.2 }); P.hatch(rock, { gap: 13, ang: 0.8, a: 0.42 });
    const mouth = [[1300, 790], [1320, 670], [1400, 626], [1490, 660], [1520, 790]]; P.wash(mouth, '#231c15', 1); P.wash(mouth, '#231c15', 0.8, { noEdge: true }); P.line(mouth, 1.8);
    for (let i = 0; i < 170; i++) { const X = P.r() * W, Y = 660 + P.r() * 240, l = 7 + P.r() * 8; P.line([[X, Y], [X - 1.4, Y - l * 0.6], [X + 2.2, Y - l]], 1, C.ink, { ghost: false, a: 0.5, jit: 0.3 }); }
    for (const [x, y, s, k] of [[90, 640, 0.94, 0], [250, 626, 0.76, 1]]) tree(P, x, y, s, C.greenD, k);
    const m = wolf(P, 690, 656, 1.32, 1, {});
    // held by the cloth at his waist, as she would hold a pup
    child(P, m[0] - 8, m[1] + 22, 0.86, 1, { rot: 1.02, closed: true, arm: [[8, 8], [14, 30], [20, 52]] });
    P.line([[m[0] - 34, m[1] - 6], [m[0], m[1] + 2], [m[0] + 30, m[1] - 8]], 3.5);
  },
];

// ---------------------------------------------------------------------------------------------- the book
export const PLATE_COUNT = PLATES.length;
export class Plates {
  constructor() { this.c = new Array(PLATES.length).fill(null); this.scale = Math.max(matchMedia('(pointer: coarse)').matches ? 0.6 : 0.85, Math.min(1, Math.max(innerWidth, innerHeight) * Math.min(1.5, devicePixelRatio || 1) / W)); this.ms = 0; }
  // paint one plate (once); nothing is ever drawn on it again
  paint(i) {
    if (this.c[i]) return this.c[i];
    const t0 = performance.now(), P = new Painter(this.scale, 4001 + i * 97);
    PLATES[i](P); P.finish(i === 5 ? 0.16 : 0.26);
    P.c.className = 'pro-plate';
    this.ms += performance.now() - t0;
    return (this.c[i] = P.c);
  }
  ready() { return this.c.every(Boolean); }
  free() { for (const c of this.c) if (c && c.parentNode) c.parentNode.removeChild(c); this.c.fill(null); }
}

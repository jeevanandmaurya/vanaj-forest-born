// Procedural canvas textures: terrain layers, barks of Pench trees, leaf cards, props, particles.
import * as THREE from 'three';
import { mulberry32, makeFbmTile, clamp } from '../core/noise.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function noiseFill(ctx, w, h, seed, fn) {
  const img = ctx.createImageData(w, h);
  const n1 = makeFbmTile(seed, 4, 4), n2 = makeFbmTile(seed + 7, 16, 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const c = fn(n1(u, v), n2(u, v), u, v, x, y);
    const o = (y * w + x) * 4;
    img.data[o] = clamp(c[0], 0, 255); img.data[o + 1] = clamp(c[1], 0, 255); img.data[o + 2] = clamp(c[2], 0, 255); img.data[o + 3] = c[3] === undefined ? 255 : c[3];
  }
  ctx.putImageData(img, 0, 0);
}

function wrapDraw(size, x, y, r, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const xx = x + ox * size, yy = y + oy * size;
    if (xx + r < 0 || xx - r > size || yy + r < 0 || yy - r > size) continue;
    fn(xx, yy);
  }
}

function leafPath(ctx, len, w, widest = 0.5, tip = 0.0) {
  // leaf along -y from origin (petiole at 0,0), widest at fraction `widest`
  const a = len * widest;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(w * 0.9, -a * 0.6, w, -a * 1.2, w * (0.35 + tip), -len * 0.92);
  ctx.quadraticCurveTo(0, -len * 1.04, -w * (0.35 + tip), -len * 0.92);
  ctx.bezierCurveTo(-w, -a * 1.2, -w * 0.9, -a * 0.6, 0, 0);
  ctx.closePath();
}

function drawLeaf(ctx, r, x, y, ang, len, w, base, opts = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  leafPath(ctx, len, w, opts.widest ?? 0.5, opts.tip ?? 0);
  const v = 0.82 + r() * 0.36;
  const g = ctx.createLinearGradient(-w, 0, w, -len);
  g.addColorStop(0, rgb(base[0] * v * 0.8, base[1] * v * 0.8, base[2] * v * 0.8));
  g.addColorStop(0.5, rgb(base[0] * v, base[1] * v, base[2] * v));
  g.addColorStop(1, rgb(base[0] * v * 1.12, base[1] * v * 1.1, base[2] * v * 1.05));
  ctx.fillStyle = g; ctx.fill();
  if (opts.edge !== false) { ctx.strokeStyle = rgba(20, 30, 10, 0.35); ctx.lineWidth = 1; ctx.stroke(); }
  // veins
  ctx.strokeStyle = rgba(base[0] * 1.5 + 30, base[1] * 1.4 + 30, base[2] * 1.2 + 20, opts.veinA ?? 0.55);
  ctx.lineWidth = Math.max(1, w * 0.07);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.95); ctx.stroke();
  ctx.lineWidth = Math.max(0.6, w * 0.03);
  const nv = opts.veins ?? 7;
  for (let i = 1; i < nv; i++) {
    const t = i / nv, yy = -len * t * 0.92;
    const ww = w * Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.85;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.quadraticCurveTo(ww * 0.5, yy - len * 0.04, ww, yy - len * 0.09); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.quadraticCurveTo(-ww * 0.5, yy - len * 0.04, -ww, yy - len * 0.09); ctx.stroke();
  }
  // insect damage / spots
  if (opts.holes && r() < 0.35) {
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc((r() - 0.5) * w, -len * (0.3 + r() * 0.5), 2 + r() * w * 0.12, 0, 6.28); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

function twig(ctx, x0, y0, x1, y1, wid, col = [70, 52, 36]) {
  ctx.strokeStyle = rgb(...col); ctx.lineWidth = wid; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.1, (y0 + y1) / 2, x1, y1); ctx.stroke();
}

// ---------------- Terrain ----------------
function makeLitter() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(11);
  noiseFill(ctx, S, S, 3, (a, b) => { const v = 0.5 + 0.8 * (a - 0.5) + 0.4 * (b - 0.5); return [110 * v + 30, 84 * v + 22, 58 * v + 14]; });
  const cols = [[168, 124, 72], [190, 146, 86], [140, 100, 60], [206, 166, 104], [122, 90, 56], [178, 140, 92], [156, 132, 80], [196, 150, 84]];
  for (let i = 0; i < 950; i++) {
    const x = r() * S, y = r() * S, big = r() < 0.35;
    const len = big ? 40 + r() * 46 : 14 + r() * 22, w = len * (big ? 0.42 : 0.3);
    const col = cols[(r() * cols.length) | 0];
    wrapDraw(S, x, y, len, (xx, yy) => {
      ctx.globalAlpha = 0.95;
      drawLeaf(ctx, r, xx, yy, r() * 6.28, len, w, col, { widest: big ? 0.62 : 0.5, veins: big ? 8 : 4, veinA: 0.3, holes: big });
      // curl shadow
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(xx + 2, yy + 3, w * 0.5, w * 0.3, r() * 3, 0, 6.28); ctx.fill();
      ctx.globalAlpha = 1;
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, a = r() * 6.28, l = 20 + r() * 60;
    wrapDraw(S, x, y, l, (xx, yy) => twig(ctx, xx, yy, xx + Math.cos(a) * l, yy + Math.sin(a) * l, 1.5 + r() * 3, [60 + r() * 40, 45 + r() * 30, 30]));
  }
  return tex(c);
}
function makeSoil() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(21);
  noiseFill(ctx, S, S, 5, (a, b) => { const v = 0.6 + 0.7 * (a - 0.5) + 0.35 * (b - 0.5); return [132 * v + 20, 80 * v + 12, 52 * v + 8]; });
  for (let i = 0; i < 1600; i++) {
    const x = r() * S, y = r() * S, rr = 0.8 + r() * 3.2, v = 0.6 + r() * 0.7;
    ctx.fillStyle = rgb(150 * v, 120 * v, 95 * v); ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.28); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + rr * 0.4, y + rr * 0.5, rr, 0, 6.28); ctx.fill();
  }
  return tex(c);
}
function makeGrassGround() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(31);
  noiseFill(ctx, S, S, 9, (a, b) => { const v = 0.6 + 0.6 * (a - 0.5) + 0.4 * (b - 0.5); return [150 * v, 140 * v, 98 * v]; });
  for (let i = 0; i < 5200; i++) {
    const x = r() * S, y = r() * S, l = 6 + r() * 16, a = -1.57 + (r() - 0.5) * 1.6, v = 0.55 + r() * 0.65;
    wrapDraw(S, x, y, l, (xx, yy) => {
      ctx.strokeStyle = rgba(170 * v, 165 * v, 110 * v, 0.85); ctx.lineWidth = 1 + r() * 1.2;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + Math.cos(a) * l * 0.5 + 3, yy + Math.sin(a) * l * 0.5, xx + Math.cos(a) * l, yy + Math.sin(a) * l); ctx.stroke();
    });
  }
  return tex(c);
}
function makeRock() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(41);
  const n3 = makeFbmTile(77, 8, 4);
  noiseFill(ctx, S, S, 13, (a, b, u, v) => {
    const band = 0.5 + 0.5 * Math.sin(v * 6.28 * 9 + a * 5 + n3(u, v) * 3);
    const t = 0.55 + 0.5 * (a - 0.5) + 0.25 * (b - 0.5) + band * 0.12;
    const pink = 0.5 + 0.5 * Math.sin(v * 6.28 * 3 + b * 4);
    return [(150 + 30 * pink) * t + 18, (132 + 10 * pink) * t + 14, (112 - 6 * pink) * t + 12];
  });
  ctx.strokeStyle = 'rgba(30,22,18,0.5)';
  for (let i = 0; i < 26; i++) {
    let x = r() * S, y = r() * S; ctx.lineWidth = 0.8 + r() * 1.8; ctx.beginPath(); ctx.moveTo(x, y);
    const horiz = r() < 0.6;
    for (let k = 0; k < 14; k++) { x += horiz ? 6 + r() * 10 : (r() - 0.5) * 12; y += horiz ? (r() - 0.5) * 5 : 6 + r() * 8; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  for (let i = 0; i < 2500; i++) { const v = r(); ctx.fillStyle = v < 0.5 ? 'rgba(40,34,30,0.25)' : 'rgba(230,220,200,0.2)'; ctx.fillRect(r() * S, r() * S, 1.5, 1.5); }
  // lichen
  for (let i = 0; i < 90; i++) { const x = r() * S, y = r() * S; ctx.fillStyle = r() < 0.5 ? 'rgba(170,170,120,0.25)' : 'rgba(60,70,50,0.22)'; ctx.beginPath(); ctx.arc(x, y, 3 + r() * 12, 0, 6.28); ctx.fill(); }
  return tex(c);
}
function makeSand() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(51);
  noiseFill(ctx, S, S, 17, (a, b, u, v) => { const rip = 0.5 + 0.5 * Math.sin((u * 14 + a * 2.5) * 6.28); const t = 0.7 + 0.4 * (a - 0.5) + 0.15 * rip + 0.2 * (b - 0.5); return [158 * t, 146 * t, 124 * t]; });
  for (let i = 0; i < 900; i++) { const v = 0.5 + r() * 0.6; ctx.fillStyle = rgb(120 * v, 110 * v, 100 * v); ctx.beginPath(); ctx.arc(r() * S, r() * S, 0.8 + r() * 3, 0, 6.28); ctx.fill(); }
  return tex(c);
}

// ---------------- Barks ----------------
function makeBark(kind) {
  const W = 256, H = 512, c = canvas(W, H), ctx = c.getContext('2d'), r = mulberry32(kind.length * 97 + 3);
  const fiss = makeFbmTile(kind.length * 13 + 1, 6, 4);
  if (kind === 'teak') {
    noiseFill(ctx, W, H, 61, (a, b, u, v) => {
      const f = Math.abs(Math.sin((u * 18 + fiss(u, v * 0.25) * 2.2) * 3.14159));
      const d = Math.pow(f, 0.35);
      const t = 0.55 + 0.5 * (a - 0.5) + 0.25 * (b - 0.5);
      return [(128 * d + 30) * t + 25, (114 * d + 26) * t + 20, (92 * d + 20) * t + 14];
    });
  } else if (kind === 'kulu') {
    noiseFill(ctx, W, H, 62, (a, b, u, v) => {
      const t = 0.85 + 0.25 * (a - 0.5) + 0.12 * (b - 0.5);
      const pink = Math.max(0, b - 0.55) * 1.6, green = Math.max(0, a - 0.62) * 1.3;
      return [(232 - 20 * green + 12 * pink) * t, (224 - 4 * green - 10 * pink) * t, (206 - 20 * green - 18 * pink) * t];
    });
    for (let i = 0; i < 160; i++) { ctx.fillStyle = 'rgba(120,110,95,0.35)'; ctx.fillRect(r() * W, r() * H, 4 + r() * 10, 1.2); }
    for (let i = 0; i < 26; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(205,170,150,0.45)' : 'rgba(170,180,150,0.4)'; ctx.beginPath(); ctx.ellipse(r() * W, r() * H, 8 + r() * 22, 10 + r() * 30, 0, 0, 6.28); ctx.fill(); }
  } else if (kind === 'saja') {
    noiseFill(ctx, W, H, 63, (a, b) => { const t = 0.5 + 0.5 * (a - 0.5) + 0.2 * (b - 0.5); return [70 * t + 12, 66 * t + 10, 60 * t + 8]; });
    // tessellated plates (crocodile bark)
    let y = 0; ctx.strokeStyle = 'rgba(8,6,5,0.9)';
    while (y < H) {
      const ph = 22 + r() * 18; let x = -r() * 20;
      while (x < W) {
        const pw = 16 + r() * 14;
        ctx.fillStyle = rgba(95 + r() * 40, 90 + r() * 35, 80 + r() * 30, 0.5);
        ctx.fillRect(x + 2, y + 2, pw - 4, ph - 4);
        ctx.lineWidth = 2 + r() * 2.5; ctx.strokeRect(x, y, pw, ph);
        x += pw;
      }
      y += ph;
    }
  } else if (kind === 'mahua') {
    noiseFill(ctx, W, H, 64, (a, b, u, v) => {
      const f = Math.abs(Math.sin((u * 26 + fiss(u, v * 0.6) * 3) * 3.14159));
      const t = 0.5 + 0.55 * (a - 0.5) + 0.3 * (b - 0.5);
      const d = Math.pow(f, 0.5);
      return [(90 * d + 30) * t + 15, (78 * d + 25) * t + 12, (66 * d + 20) * t + 10];
    });
  } else if (kind === 'bamboo') {
    noiseFill(ctx, W, H, 65, (a, b, u, v) => {
      const t = 0.8 + 0.3 * (a - 0.5);
      const s = 0.95 + 0.05 * Math.sin(u * 6.28 * 40);
      return [150 * t * s, 152 * t * s, 70 * t * s];
    });
    for (let k = 0; k < 4; k++) {
      const y = k * 128 + 64;
      const g = ctx.createLinearGradient(0, y - 8, 0, y + 8);
      g.addColorStop(0, 'rgba(60,60,20,0)'); g.addColorStop(0.5, 'rgba(70,64,30,0.85)'); g.addColorStop(1, 'rgba(60,60,20,0)');
      ctx.fillStyle = g; ctx.fillRect(0, y - 8, W, 16);
      ctx.fillStyle = 'rgba(210,200,150,0.5)'; ctx.fillRect(0, y + 6, W, 3);
    }
  } else if (kind === 'banyan') {
    noiseFill(ctx, W, H, 66, (a, b, u, v) => {
      const f = 0.5 + 0.5 * Math.sin((u * 7 + fiss(u, v) * 4) * 6.28);
      const t = 0.62 + 0.4 * (a - 0.5) + 0.2 * (b - 0.5) + f * 0.1;
      return [140 * t, 134 * t, 120 * t];
    });
    for (let i = 0; i < 300; i++) { ctx.fillStyle = 'rgba(60,55,45,0.35)'; ctx.fillRect(r() * W, r() * H, 3 + r() * 5, 1.5); }
  } else { // generic
    noiseFill(ctx, W, H, 67, (a, b, u, v) => {
      const f = Math.abs(Math.sin((u * 14 + fiss(u, v * 0.4) * 2) * 3.14159));
      const t = 0.5 + 0.5 * (a - 0.5) + 0.2 * (b - 0.5); const d = Math.pow(f, 0.4);
      return [(110 * d + 25) * t + 20, (95 * d + 22) * t + 17, (75 * d + 18) * t + 12];
    });
  }
  return tex(c);
}

// ---------------- Leaf cards (RGBA) ----------------
function leafCard(kind, flowering = false) {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(kind.length * 131 + (flowering ? 9 : 1));
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  if (kind === 'teak') {
    // few huge obovate leaves on stout opposite pairs + panicle of tiny flowers
    twig(ctx, cx, S, cx + 10, 60, 9, [96, 84, 60]);
    const pairs = 5;
    for (let p = 0; p < pairs; p++) {
      const y = S - 70 - p * 80, sc = 1 - p * 0.1;
      for (const s of [-1, 1]) {
        const ang = s * (1.05 + r() * 0.35) + (r() - 0.5) * 0.2;
        drawLeaf(ctx, r, cx + 4, y, ang, 190 * sc, 92 * sc, [86, 108, 46], { widest: 0.62, veins: 10, holes: true });
      }
    }
    drawLeaf(ctx, r, cx + 10, 80, 0.05, 120, 60, [96, 120, 52], { widest: 0.6, veins: 8 });
    for (let i = 0; i < 60; i++) { ctx.fillStyle = rgba(230, 225, 200, 0.9); ctx.beginPath(); ctx.arc(cx + (r() - 0.5) * 90, 40 + r() * 70, 2 + r() * 2, 0, 6.28); ctx.fill(); }
  } else if (kind === 'mahua') {
    for (let k = 0; k < 7; k++) {
      const bx = 60 + r() * 390, by = 80 + r() * 380;
      twig(ctx, cx, S, bx, by, 4, [70, 55, 40]);
      for (let i = 0; i < 9; i++) {
        const young = r() < 0.15;
        drawLeaf(ctx, r, bx, by, (i / 9) * 6.28 + r() * 0.4, 80 + r() * 40, 26 + r() * 10, young ? [140, 70, 40] : [48, 82, 34], { widest: 0.55, veins: 6 });
      }
      if (flowering) for (let i = 0; i < 14; i++) { ctx.fillStyle = rgba(236, 226, 190, 1); ctx.beginPath(); ctx.ellipse(bx + (r() - 0.5) * 30, by + (r() - 0.5) * 30, 5, 7, r() * 3, 0, 6.28); ctx.fill(); }
    }
  } else if (kind === 'kulu') {
    for (let k = 0; k < 6; k++) {
      const bx = 70 + r() * 370, by = 80 + r() * 360;
      twig(ctx, cx, S, bx, by, 3, [200, 190, 170]);
      for (let i = 0; i < 3; i++) {
        // palmate 5-lobed leaf
        const ox = bx + (r() - 0.5) * 50, oy = by + (r() - 0.5) * 50, rot = r() * 6.28;
        for (let l = 0; l < 5; l++) drawLeaf(ctx, r, ox, oy, rot + (l - 2) * 0.55, 70 + r() * 15, 24, [104, 140, 64], { widest: 0.55, veins: 5 });
      }
    }
  } else if (kind === 'palash') {
    if (!flowering) {
      for (let k = 0; k < 7; k++) {
        const bx = 60 + r() * 390, by = 70 + r() * 380;
        twig(ctx, cx, S, bx, by, 3.5, [80, 64, 46]);
        const rot = r() * 6.28;
        drawLeaf(ctx, r, bx, by, rot, 100, 58, [70, 102, 44], { widest: 0.55, veins: 7 });
        drawLeaf(ctx, r, bx, by, rot - 1.3, 82, 50, [74, 104, 46], { widest: 0.5, veins: 6 });
        drawLeaf(ctx, r, bx, by, rot + 1.3, 82, 50, [68, 98, 42], { widest: 0.5, veins: 6 });
      }
    } else {
      // flame of the forest: bare dark twigs crowded with curved orange-red flowers
      for (let k = 0; k < 9; k++) {
        const bx = 50 + r() * 410, by = 50 + r() * 400;
        twig(ctx, cx + (r() - 0.5) * 100, S, bx, by, 4, [52, 40, 32]);
        for (let i = 0; i < 16; i++) {
          const fx = bx + (r() - 0.5) * 70, fy = by + (r() - 0.5) * 70, a = r() * 6.28;
          ctx.save(); ctx.translate(fx, fy); ctx.rotate(a);
          ctx.fillStyle = rgb(60, 40, 30); ctx.beginPath(); ctx.ellipse(0, 0, 5, 7, 0, 0, 6.28); ctx.fill();
          const gr = ctx.createLinearGradient(0, 0, 0, -34);
          gr.addColorStop(0, '#d8461a'); gr.addColorStop(0.6, '#f26b1d'); gr.addColorStop(1, '#ffa040');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(-14, -20, 2, -34); ctx.quadraticCurveTo(8, -18, 6, 0); ctx.fill();
          ctx.restore();
        }
      }
    }
  } else if (kind === 'bamboo') {
    for (let k = 0; k < 8; k++) {
      const bx = 40 + r() * 430, by = 40 + r() * 420, a0 = r() * 6.28;
      twig(ctx, bx - Math.cos(a0) * 60, by - Math.sin(a0) * 60, bx, by, 2, [120, 120, 60]);
      for (let i = 0; i < 7; i++) drawLeaf(ctx, r, bx, by, a0 + (i - 3) * 0.32 + 1.57, 110 + r() * 50, 11 + r() * 5, [112, 138, 52], { widest: 0.35, veins: 0, tip: -0.3, veinA: 0.3 });
    }
  } else if (kind === 'banyan') {
    for (let k = 0; k < 10; k++) {
      const bx = 40 + r() * 430, by = 40 + r() * 430;
      for (let i = 0; i < 6; i++) drawLeaf(ctx, r, bx, by, (i / 6) * 6.28 + r(), 70 + r() * 30, 34 + r() * 8, [44, 76, 34], { widest: 0.5, veins: 6 });
      for (let i = 0; i < 4; i++) { ctx.fillStyle = '#b0302a'; ctx.beginPath(); ctx.arc(bx + (r() - 0.5) * 40, by + (r() - 0.5) * 40, 5, 0, 6.28); ctx.fill(); }
    }
  } else if (kind === 'lantana') {
    for (let k = 0; k < 16; k++) {
      const bx = 30 + r() * 450, by = 30 + r() * 450;
      for (let i = 0; i < 4; i++) drawLeaf(ctx, r, bx, by, (i / 4) * 6.28 + r(), 34 + r() * 14, 16, [58, 88, 38], { widest: 0.45, veins: 4 });
      if (r() < 0.6) for (let i = 0; i < 9; i++) { ctx.fillStyle = r() < 0.5 ? '#f08a3a' : '#e8608a'; ctx.beginPath(); ctx.arc(bx + (r() - 0.5) * 14, by + (r() - 0.5) * 14, 3, 0, 6.28); ctx.fill(); }
    }
  } else { // small: tendu, arjun, jamun, generic
    for (let k = 0; k < 9; k++) {
      const bx = 50 + r() * 410, by = 50 + r() * 410;
      twig(ctx, cx, S, bx, by, 3, [80, 64, 48]);
      for (let i = 0; i < 8; i++) drawLeaf(ctx, r, bx + (r() - 0.5) * 30, by + (r() - 0.5) * 30, r() * 6.28, 56 + r() * 26, 22 + r() * 8, [62, 94, 40], { widest: 0.5, veins: 5 });
    }
  }
  const t = tex(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------- Props ----------------
function makeCavePaintings() {
  const W = 1024, H = 512, c = canvas(W, H), ctx = c.getContext('2d'), r = mulberry32(777);
  noiseFill(ctx, W, H, 88, (a, b, u, v) => { const t = 0.55 + 0.45 * (a - 0.5) + 0.3 * (b - 0.5); return [168 * t + 20, 140 * t + 16, 112 * t + 14]; });
  ctx.strokeStyle = ctx.fillStyle = 'rgba(150,48,28,0.86)';
  ctx.lineCap = 'round';
  const human = (x, y, s, bow) => {
    ctx.lineWidth = 3.2 * s;
    ctx.beginPath(); ctx.arc(x, y - 30 * s, 5 * s, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - 25 * s); ctx.lineTo(x, y); ctx.lineTo(x - 9 * s, y + 20 * s); ctx.moveTo(x, y); ctx.lineTo(x + 10 * s, y + 19 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 18 * s); ctx.lineTo(x + 14 * s, y - 16 * s); ctx.moveTo(x, y - 18 * s); ctx.lineTo(x - 12 * s, y - 10 * s); ctx.stroke();
    if (bow) { ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(x + 16 * s, y - 16 * s, 14 * s, -1.3, 1.3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 2 * s, y - 16 * s); ctx.lineTo(x + 34 * s, y - 16 * s); ctx.stroke(); }
  };
  const deer = (x, y, s, antlers) => {
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.ellipse(x, y, 26 * s, 10 * s, 0, 0, 6.28); ctx.stroke();
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(x - 22 * s + i * 4 * s, y - 8 * s); ctx.lineTo(x - 22 * s + i * 4 * s, y + 8 * s); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x + 22 * s, y - 4 * s); ctx.lineTo(x + 32 * s, y - 22 * s); ctx.lineTo(x + 42 * s, y - 20 * s); ctx.stroke();
    for (const lx of [-18, -10, 14, 20]) { ctx.beginPath(); ctx.moveTo(x + lx * s, y + 8 * s); ctx.lineTo(x + (lx + 2) * s, y + 30 * s); ctx.stroke(); }
    if (antlers) { ctx.beginPath(); ctx.moveTo(x + 32 * s, y - 22 * s); ctx.lineTo(x + 26 * s, y - 42 * s); ctx.moveTo(x + 29 * s, y - 32 * s); ctx.lineTo(x + 20 * s, y - 36 * s); ctx.moveTo(x + 34 * s, y - 22 * s); ctx.lineTo(x + 40 * s, y - 42 * s); ctx.stroke(); }
  };
  const bison = (x, y, s) => {
    ctx.beginPath(); ctx.moveTo(x - 40 * s, y); ctx.quadraticCurveTo(x - 30 * s, y - 34 * s, x + 10 * s, y - 30 * s); ctx.quadraticCurveTo(x + 30 * s, y - 20 * s, x + 40 * s, y - 2 * s); ctx.lineTo(x - 40 * s, y + 8 * s); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 4 * s;
    for (const lx of [-30, -20, 20, 30]) { ctx.beginPath(); ctx.moveTo(x + lx * s, y + 5 * s); ctx.lineTo(x + lx * s, y + 28 * s); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x + 38 * s, y - 6 * s); ctx.quadraticCurveTo(x + 50 * s, y - 22 * s, x + 44 * s, y - 30 * s); ctx.stroke();
  };
  const tiger = (x, y, s) => {
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.ellipse(x, y, 38 * s, 12 * s, 0, 0, 6.28); ctx.stroke();
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(x - 30 * s + i * 7 * s, y - 11 * s); ctx.lineTo(x - 26 * s + i * 7 * s, y + 10 * s); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x + 44 * s, y - 8 * s, 9 * s, 0, 6.28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 38 * s, y - 2 * s); ctx.quadraticCurveTo(x - 60 * s, y - 20 * s, x - 66 * s, y - 4 * s); ctx.stroke();
    for (const lx of [-26, -16, 22, 30]) { ctx.beginPath(); ctx.moveTo(x + lx * s, y + 10 * s); ctx.lineTo(x + lx * s, y + 30 * s); ctx.stroke(); }
  };
  human(120, 260, 1.5, true); human(180, 250, 1.3, true); human(230, 270, 1.2, false);
  deer(360, 240, 1.4, true); deer(430, 300, 1.0, false); deer(300, 330, 0.9, false);
  bison(640, 230, 1.6); tiger(820, 330, 1.3);
  for (let i = 0; i < 7; i++) human(560 + i * 34, 420, 0.8, false); // dancers
  for (let i = 0; i < 5; i++) { // hand prints
    const x = 80 + r() * 860, y = 60 + r() * 120; ctx.save(); ctx.translate(x, y); ctx.rotate((r() - 0.5) * 0.6);
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 15, 0, 0, 6.28); ctx.fill();
    for (let f = 0; f < 5; f++) { ctx.beginPath(); ctx.ellipse(-11 + f * 5.5, -20 - (f === 0 ? -8 : 0), 3, 9, 0, 0, 6.28); ctx.fill(); }
    ctx.restore();
  }
  // weathering
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.3})`; ctx.beginPath(); ctx.arc(r() * W, r() * H, 2 + r() * 10, 0, 6.28); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  // re-lay rock under erased parts
  const base = canvas(W, H), bctx = base.getContext('2d');
  noiseFill(bctx, W, H, 88, (a, b) => { const t = 0.55 + 0.45 * (a - 0.5) + 0.3 * (b - 0.5); return [168 * t + 20, 140 * t + 16, 112 * t + 14]; });
  bctx.drawImage(c, 0, 0);
  return tex(base, { repeat: false });
}
function makeWall() {
  const W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d'), r = mulberry32(99);
  noiseFill(ctx, W, H, 91, (a, b, u, v) => {
    const t = 0.85 + 0.25 * (a - 0.5) + 0.15 * (b - 0.5);
    if (v > 0.78) return [150 * t, 86 * t, 52 * t]; // ochre mud plinth band
    return [198 * t, 210 * t, 222 * t];                 // lime + indigo wash
  });
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let x = 6; x < W; x += 14) { ctx.beginPath(); ctx.arc(x, H * 0.76, 2.4, 0, 6.28); ctx.fill(); }
  ctx.strokeStyle = 'rgba(120,60,40,0.8)'; ctx.lineWidth = 2;
  for (let x = 0; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, H * 0.79); ctx.lineTo(x + 32, H * 0.95); ctx.lineTo(x + 64, H * 0.79); ctx.stroke(); }
  for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(120,100,80,0.18)'; ctx.beginPath(); ctx.ellipse(r() * W, r() * H * 0.75, 6 + r() * 20, 3 + r() * 10, 0, 0, 6.28); ctx.fill(); }
  return tex(c);
}
function makeRoof() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(17);
  ctx.fillStyle = '#5a2e1e'; ctx.fillRect(0, 0, S, S);
  const rows = 8, cols = 10;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * S / cols + (j % 2) * S / cols / 2, y = j * S / rows, w = S / cols, h = S / rows * 1.2;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    const v = 0.75 + r() * 0.4, soot = r() < 0.2 ? 0.6 : 1;
    g.addColorStop(0, rgb(70 * v * soot, 34 * v * soot, 22 * v * soot)); g.addColorStop(0.5, rgb(172 * v * soot, 90 * v * soot, 56 * v * soot)); g.addColorStop(1, rgb(80 * v * soot, 38 * v * soot, 24 * v * soot));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.5, h * 0.55, 0, 0, 6.28); ctx.fill();
    if (r() < 0.25) { ctx.fillStyle = 'rgba(80,90,50,0.35)'; ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.7, w * 0.3, 0, 6.28); ctx.fill(); }
  }
  return tex(c);
}
function makeThatch() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(23);
  ctx.fillStyle = '#6e5a3a'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    const x = r() * S, y = r() * S, l = 20 + r() * 40, v = 0.6 + r() * 0.6;
    ctx.strokeStyle = rgba(190 * v, 160 * v, 100 * v, 0.8); ctx.lineWidth = 1 + r();
    wrapDraw(S, x, y, l, (xx, yy) => { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + (r() - 0.5) * 6, yy + l); ctx.stroke(); });
  }
  return tex(c);
}
function makeStumpTop() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(31);
  ctx.fillStyle = '#b48a5a'; ctx.fillRect(0, 0, S, S);
  for (let k = 1; k < 34; k++) { ctx.strokeStyle = k % 3 ? 'rgba(110,70,40,0.4)' : 'rgba(90,55,30,0.7)'; ctx.lineWidth = 1 + r() * 1.5; ctx.beginPath(); ctx.ellipse(128 + r() * 3, 128 + r() * 3, k * 3.7, k * 3.6, 0, 0, 6.28); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(60,35,20,0.8)'; ctx.lineWidth = 2;
  for (let k = 0; k < 6; k++) { const a = r() * 6.28; ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120); ctx.stroke(); }
  // axe cut facets
  ctx.fillStyle = 'rgba(255,240,210,0.18)'; ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(256, 20); ctx.lineTo(256, 120); ctx.lineTo(0, 150); ctx.fill();
  return tex(c, { repeat: false });
}
function makeBlood() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(5);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.28, d = r() * 70, rr = 8 + r() * 40 * (1 - d / 90);
    const g = ctx.createRadialGradient(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 0, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rr);
    g.addColorStop(0, 'rgba(90,6,6,1)'); g.addColorStop(0.7, 'rgba(110,10,8,0.95)'); g.addColorStop(1, 'rgba(110,10,8,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rr, 0, 6.28); ctx.fill();
  }
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 60 + r() * 60; ctx.fillStyle = 'rgba(100,8,6,0.95)'; ctx.beginPath(); ctx.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1.5 + r() * 4, 0, 6.28); ctx.fill(); }
  return tex(c, { repeat: false });
}
function makeSoft() {
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}
function makeCloth(col) {
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(col.length);
  ctx.fillStyle = col; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < S; i += 2) { ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; ctx.fillRect(0, i, S, 1); ctx.fillRect(i, 0, 1, S); }
  for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(60,40,20,0.15)'; ctx.beginPath(); ctx.arc(r() * S, r() * S, 4 + r() * 14, 0, 6.28); ctx.fill(); }
  return tex(c);
}

export function buildTextures() {
  const T = {};
  T.litter = makeLitter(); T.soil = makeSoil(); T.grassGround = makeGrassGround(); T.rock = makeRock(); T.sand = makeSand();
  T.bark = {};
  for (const k of ['teak', 'kulu', 'saja', 'mahua', 'bamboo', 'banyan', 'generic']) T.bark[k] = makeBark(k);
  T.leaf = {};
  for (const k of ['teak', 'mahua', 'kulu', 'palash', 'bamboo', 'banyan', 'lantana', 'small']) T.leaf[k] = leafCard(k);
  T.leaf.palashFlower = leafCard('palash', true);
  T.leaf.mahuaFlower = leafCard('mahua', true);
  T.cave = makeCavePaintings(); T.wall = makeWall(); T.roof = makeRoof(); T.thatch = makeThatch();
  T.stump = makeStumpTop(); T.blood = makeBlood(); T.soft = makeSoft();
  T.clothRed = makeCloth('#9c2a1e'); T.clothKhaki = makeCloth('#8a7a52'); T.clothWhite = makeCloth('#d8d0bc'); T.clothBark = makeCloth('#6a5034');
  return T;
}

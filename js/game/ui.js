// HUD and menus: compass with alarm-call markers, survival bars, hotbar, prompts, narration subtitles,
// chapter cards, call wheel, inventory & crafting, journal (story + forest lore), map, death, settings.
import { ITEMS, RECIPES } from './items.js';
import { SITES } from '../world/props.js';
import { LORE } from './lore.js';
import { groundHeight } from '../world/terrain.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const iconCache = {};
export function iconFor(k) {
  if (iconCache[k]) return iconCache[k];
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.lineCap = 'round'; x.lineJoin = 'round';
  const blob = (col, cx = 32, cy = 34, r = 16) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, r, r * 0.75, 0.3, 0, 6.28); x.fill(); };
  const line = (col, w, pts) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.moveTo(...pts[0]); for (const p of pts.slice(1)) x.lineTo(...p); x.stroke(); };
  switch (k) {
    case 'stick': line('#8a6a44', 5, [[12, 52], [34, 30], [52, 12]]); line('#8a6a44', 3, [[34, 30], [44, 34]]); break;
    case 'stone': blob('#8d8478'); blob('#a39a8c', 28, 30, 7); break;
    case 'flint': x.fillStyle = '#2c2a2b'; x.beginPath(); x.moveTo(14, 40); x.lineTo(30, 14); x.lineTo(50, 26); x.lineTo(44, 50); x.closePath(); x.fill(); line('#6a6868', 2, [[30, 14], [36, 36], [44, 50]]); break;
    case 'fiber': for (let i = 0; i < 6; i++) line('#b49a64', 2, [[18 + i * 3, 54], [28 + i * 2, 30], [22 + i * 4, 10]]); break;
    case 'bamboo': x.fillStyle = '#a8a848'; x.fillRect(26, 6, 12, 52); line('#6a6a24', 2, [[26, 22], [38, 22]]); line('#6a6a24', 2, [[26, 40], [38, 40]]); break;
    case 'leaves': for (let i = 0; i < 3; i++) { x.save(); x.translate(32, 36); x.rotate(-0.8 + i * 0.8); x.fillStyle = ['#5a7a32', '#6a8a3a', '#4e6e2a'][i]; x.beginPath(); x.ellipse(0, -12, 7, 15, 0, 0, 6.28); x.fill(); x.restore(); } break;
    case 'meat_raw': case 'meat_cooked': { const raw = k === 'meat_raw'; x.fillStyle = raw ? '#8fa6ac' : '#b06a2c'; x.beginPath(); x.ellipse(29, 33, 19, 10, -0.25, 0, 6.28); x.fill(); x.beginPath(); x.moveTo(44, 28); x.lineTo(58, 16); x.lineTo(57, 38); x.closePath(); x.fill(); x.fillStyle = raw ? '#dfe9ea' : '#e0a050'; x.beginPath(); x.ellipse(27, 37, 13, 4, -0.25, 0, 6.28); x.fill(); x.fillStyle = '#1c1612'; x.beginPath(); x.arc(17, 32, 2.2, 0, 6.28); x.fill(); break; }
    case 'hide': x.fillStyle = '#9a6a3a'; x.beginPath(); x.moveTo(12, 20); x.quadraticCurveTo(32, 8, 52, 20); x.lineTo(48, 50); x.quadraticCurveTo(32, 58, 16, 50); x.closePath(); x.fill(); break;
    case 'bone': line('#e0d6c0', 6, [[16, 48], [48, 16]]); blob('#e0d6c0', 14, 50, 6); blob('#e0d6c0', 50, 14, 6); break;
    case 'sinew': for (let i = 0; i < 3; i++) line('#d8c8a8', 2, [[14, 20 + i * 8], [32, 30 + i * 6], [50, 22 + i * 8]]); break;
    case 'feather': line('#1a6a5a', 3, [[18, 54], [46, 10]]); x.fillStyle = '#2a8a6a'; x.beginPath(); x.ellipse(36, 24, 7, 16, 0.6, 0, 6.28); x.fill(); x.fillStyle = '#2040a0'; x.beginPath(); x.arc(40, 18, 4, 0, 6.28); x.fill(); x.fillStyle = '#d0a020'; x.beginPath(); x.arc(40, 18, 2, 0, 6.28); x.fill(); break;
    case 'honey': blob('#c08020'); blob('#e8b040', 28, 30, 6); break;
    case 'mahua': for (let i = 0; i < 6; i++) blob('#e8dcc0', 20 + (i % 3) * 12, 26 + Math.floor(i / 3) * 14, 6); break;
    case 'ber': for (let i = 0; i < 5; i++) blob('#b05a20', 22 + (i % 3) * 10, 28 + Math.floor(i / 3) * 12, 6); break;
    case 'tendu': blob('#d08a20', 26, 32, 10); blob('#c87a18', 40, 36, 9); break;
    case 'mushroom': x.fillStyle = '#d8c8a8'; x.beginPath(); x.ellipse(32, 26, 18, 10, 0, 3.14, 6.28); x.fill(); x.fillRect(28, 26, 8, 22); break;
    case 'termites': for (let i = 0; i < 8; i++) blob('#e8d8b8', 18 + (i % 4) * 9, 26 + Math.floor(i / 4) * 12, 4); break;
    case 'arrow': line('#8a6a44', 3, [[12, 52], [50, 14]]); x.fillStyle = '#333'; x.beginPath(); x.moveTo(52, 12); x.lineTo(44, 16); x.lineTo(48, 20); x.fill(); line('#1a6a5a', 4, [[12, 52], [18, 46]]); break;
    case 'knife': line('#7a5a3a', 6, [[14, 50], [26, 38]]); x.fillStyle = '#3a3636'; x.beginPath(); x.moveTo(26, 38); x.lineTo(52, 12); x.lineTo(32, 42); x.fill(); break;
    case 'club': line('#7a5a3a', 6, [[14, 52], [40, 22]]); blob('#6a4a2a', 44, 18, 10); break;
    case 'axe': line('#7a5a3a', 6, [[16, 54], [40, 14]]); x.fillStyle = '#3a3636'; x.beginPath(); x.moveTo(34, 10); x.lineTo(54, 14); x.lineTo(50, 32); x.lineTo(38, 22); x.fill(); break;
    case 'log': line('#7a5a3a', 12, [[12, 44], [50, 26]]); blob('#c8a070', 50, 26, 6); break;
    case 'spear': line('#a8a048', 4, [[10, 56], [48, 18]]); x.fillStyle = '#3a3636'; x.beginPath(); x.moveTo(56, 8); x.lineTo(44, 16); x.lineTo(50, 22); x.fill(); break;
    case 'bow': x.strokeStyle = '#a8a048'; x.lineWidth = 4; x.beginPath(); x.arc(14, 32, 26, -1.1, 1.1); x.stroke(); line('#ddd', 1, [[26, 9], [26, 55]]); break;
    case 'torch': line('#7a5a3a', 5, [[22, 56], [36, 24]]); blob('#ff8a2a', 38, 16, 9); blob('#ffd060', 38, 16, 4); break;
    case 'flute': line('#a8a048', 6, [[10, 50], [54, 14]]); for (let i = 0; i < 5; i++) blob('#3a2a10', 22 + i * 6, 40 - i * 5, 1.6); break;
    case 'bandage': blob('#7a8a4a'); line('#c8b890', 3, [[18, 34], [46, 34]]); break;
    case 'hidewrap': x.fillStyle = '#8a5a30'; x.fillRect(16, 14, 32, 36); line('#c8b890', 2, [[16, 24], [48, 24]]); line('#c8b890', 2, [[16, 40], [48, 40]]); break;
    case 'campfire': for (let i = 0; i < 3; i++) line('#6a4a2a', 5, [[14 + i * 8, 54], [44 - i * 6, 40]]); blob('#ff8a2a', 32, 34, 9); blob('#ffd060', 32, 36, 4); break;
    case 'wire': x.strokeStyle = '#c8ccd0'; x.lineWidth = 2; x.beginPath(); for (let a = 0; a < 12; a += 0.2) x.lineTo(32 + Math.cos(a) * (8 + a * 1.6), 32 + Math.sin(a) * (8 + a * 1.6)); x.stroke(); break;
    case 'bowl': x.fillStyle = '#6a8a3a'; x.beginPath(); x.ellipse(32, 34, 20, 10, 0, 0, 3.14); x.fill(); line('#8a6a44', 1.5, [[18, 30], [46, 30]]); break;
    case 'matches': x.fillStyle = '#c8a030'; x.fillRect(14, 22, 36, 22); x.fillStyle = '#6a2a1a'; x.fillRect(14, 22, 36, 5); break;
    case 'lota': x.fillStyle = '#b8bcc0'; x.beginPath(); x.ellipse(32, 38, 16, 14, 0, 0, 6.28); x.fill(); x.fillRect(26, 14, 12, 12); x.fillStyle = '#e8ecf0'; x.fillRect(24, 12, 16, 4); break;
    default: blob('#888');
  }
  return (iconCache[k] = c.toDataURL());
}

export class UI {
  constructor(game) {
    this.g = game;
    this.subQ = []; this.subT = 0; this.toasts = [];
    this.compassMarks = []; // {x,z,label,color,ttl}
    this.open = null;
    this.hitT = 0;
    this.explored = new Uint8Array(64 * 64);
    this.discovered = new Set();
    this.journal = []; this.loreSeen = new Set();
    this.wheelSel = null;
  }
  init() {
    this.hud = $('hud');
    // health, stamina, hunger and thirst, each with its picture and no words
    $('stats').innerHTML = `<div id="status"></div>
      <div class="srow"><span class="si hp">${icon('heart')}</span><div class="bar big"><div id="bar-hp" style="width:100%"></div></div></div>
      <div class="srow two"><span class="pair" id="bar-st-wrap"><span class="si sta">${icon('bolt')}</span><div class="bar"><div id="bar-st" style="width:100%"></div></div></span><span class="pair"><span class="si hu">${icon('food')}</span><div class="bar"><div id="bar-hu"></div></div></span><span class="pair"><span class="si th">${icon('water')}</span><div class="bar"><div id="bar-th"></div></div></span></div>`;
    this.bars = { hp: $('bar-hp'), st: $('bar-st'), hu: $('bar-hu'), th: $('bar-th') };
    this.status = $('status'); this.prompt = $('prompt'); this.sub = $('subtitle'); this.obj = $('objective'); this.chap = $('chapter');
    this.compass = $('compass-strip'); this.clock = $('clock'); this.toastBox = $('toasts'); this.cross = $('crosshair');
    this.vignette = $('vignette'); this.bloodOv = $('bloodov'); this.eye = $('eye'); this.hotbar = $('hotbar'); this.ammo = $('ammo');
    this.dmgInd = $('dmgind');
    // the minimap: north up, Vanaj in the middle, his arrow turning with him
    const mini = el('div', '', '<canvas width="192" height="192"></canvas><i>N</i><svg viewBox="-10 -10 20 20"><path d="M0-8 6 7 0 3-6 7Z"/></svg>'); mini.id = 'minimap'; this.hud.appendChild(mini);
    this.miniCv = mini.querySelector('canvas'); this.miniArrow = mini.querySelector('svg');
    // On a computer: the essentials in plain sight, each with the key that does the same (with the mouse captured for looking, the key is the way).
    // A click sends that key, so there is one code path. Phones have these in the touch controls.
    {
      const send = (code) => { for (const t of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(t, { code, key: code, bubbles: true })); };
      const bar = el('div'); bar.id = 'deskbar'; this.hud.appendChild(bar);
      // (the game takes a mouse press anywhere as a strike: not on these)
      bar.onmousedown = mini.onmousedown = (e) => e.stopPropagation();
      for (const [ic, name, code, key] of [['bag', 'Bag', 'Tab', 'Tab'], ['map', 'Map', 'KeyM', 'M'], ['notes', 'Notes', 'KeyJ', 'J'], ['menu', 'Pause', 'Escape', 'Esc']]) {
        const b = el('button', '', `${icon(ic)}<small>${key}</small>`); b.title = `${name} (${key})`; b.setAttribute('aria-label', name); b.tabIndex = -1; b.onclick = (e) => { e.stopPropagation(); send(code); b.blur(); }; bar.appendChild(b);
      }
      mini.title = 'Map (M)'; mini.classList.add('click'); mini.onclick = (e) => { e.stopPropagation(); send('KeyM'); };
    }
    // from the pause menu too: on a computer the mouse is held for looking during play, so this is where it can reach them
    { const row = el('div'); row.id = 'pause-go'; $('btn-resume').after(row);
      for (const [ic, name, panel] of [['map', 'Map', 'map'], ['bag', 'Bag', 'inv'], ['notes', 'Notes', 'journal']]) {
        const b = el('button', '', `${icon(ic)}<span>${name}</span>`);
        b.onclick = () => { const g = this.g; g.paused = false; g.uiBlocking = false; $('pause').classList.remove('show'); this.toggle(panel); };
        row.appendChild(b);
      } }
    // a click or tap outside the map, bag or notes closes them
    for (const id of ['map', 'inv', 'journal']) { const pn = $(id); if (pn) { pn.addEventListener('mousedown', (e) => e.stopPropagation()); pn.addEventListener('click', (e) => { if (e.target === pn && this.open === id) { this.close(); this.g.requestLock && this.g.requestLock(); } }); } }
    // your own mark: tap the big map to set it, tap it again to take it away
    const tg = $('target'), pt = tg.cloneNode(true); pt.id = 'ptarget'; pt.querySelectorAll('[id]').forEach((n) => { n.id = 'p' + n.id; }); tg.parentElement.appendChild(pt);
    $('mapcv').addEventListener('click', (e) => {
      const cv = e.currentTarget, r = cv.getBoundingClientRect(), wx = (e.clientX - r.left) / r.width * 4096 - 2048, wz = (e.clientY - r.top) / r.height * 4096 - 2048;
      const near = this.pin && Math.hypot(this.pin.x - wx, this.pin.z - wz) < 4096 * 28 / r.width;   // (28 px on screen: about a fingertip)
      this.setPin(near ? null : { x: wx, z: wz }); this.renderMap();
    });
    // compass ticks
    const strip = this.compass; strip.innerHTML = '';
    window.addEventListener('resize', () => { this.compassW = 0; });   // (its width depends on the window: measured again when next drawn)
    this.compassItems = [];
    const dirs = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 15) { const t = el('div', 'ctick' + (dirs[d] ? ' major' : ''), dirs[d] || ''); t.dataset.deg = d; strip.appendChild(t); this.compassItems.push(t); }
    this.markerEls = [];
    // wheel
    this.buildWheel();
    window.addEventListener('mousemove', (e) => { if (this.wheelOpen) this.wheelMove(e); });
  }
  // ------------------------------------------------------------------ HUD update
  // Every write to the page is work for the browser after this code has finished: working out styles and layout, then painting. None of
  // that shows on the performance panel, and on a phone it adds up. So nothing is written unless it changed, and what changes slowly (the
  // bars, status, clock, hotbar, the stealth eye) is looked at eight times a second.
  update(dt) {
    const g = this.g, P = g.player;
    if (!P) return;
    // vignette / blood
    P.hurtFlash = Math.max(0, P.hurtFlash - dt * 0.8);
    const low = P.hp < 35 ? (35 - P.hp) / 35 : 0;
    this.put(this.vignette, 'o', Math.min(1, P.hurtFlash * 0.9 + low * 0.7).toFixed(2));
    this.put(this.bloodOv, 'o', '0');
    // compass (only the marks in view, and only when he has turned)
    const yawDeg = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360; // 0 = north
    if (!this.compassW) { this.compassW = this.compass.parentElement.clientWidth; this._yaw = 1e9; }
    const W = this.compassW || 440;
    if (Math.abs(yawDeg - (this._yaw ?? 1e9)) > 0.4) {
      this._yaw = yawDeg;
      this.miniArrow.style.transform = `rotate(${yawDeg.toFixed(1)}deg)`;
      for (const t of this.compassItems) {
        let d = +t.dataset.deg - yawDeg; while (d > 180) d -= 360; while (d < -180) d += 360;
        const on = Math.abs(d) < 95;
        if (on) t.style.transform = `translateX(${(d / 90 * (W / 2)).toFixed(1)}px)`;
        this.put(t, 'o', on ? (1 - Math.abs(d) / 110).toFixed(2) : '0');
      }
    }
    this.updateMarkers(yawDeg, W, dt);
    this.updatePointer(dt);
    // toasts
    if (this.toasts.length) {
      for (const t of this.toasts) { t.ttl -= dt; if (t.ttl <= 0 && !t.gone) { t.gone = true; t.el.classList.add('out'); setTimeout(() => t.el.remove(), 500); } }
      this.toasts = this.toasts.filter((t) => t.ttl > -1);
    }
    // crosshair
    this.hitT = Math.max(0, this.hitT - dt);
    const cross = 'cross' + (P.aim > 0.3 ? ' aim' : '') + (this.hitT > 0 ? ' hit' : '') + (this.hitKill ? ' kill' : '');
    if (cross !== this._cross) { this.cross.className = cross; this._cross = cross; }
    if (this.hitT <= 0) this.hitKill = false;
    // (behind him, with him in the middle of the screen, the dot sits on his head: there it shows only while aiming, or for a hit)
    this.put(this.cross, 'o', g.uiBlocking || (P.view !== 'fpp' && P.aim <= 0.05 && this.hitT <= 0) ? '0' : '1');
    // ---- from here on, eight times a second
    this._slowT = (this._slowT || 0) - dt;
    if (this._slowT > 0) return;
    this._slowT = 0.125;
    this.put(this.bars.hp, 'w', Math.max(0, P.hp).toFixed(0)); this.put(this.bars.st, 'w', P.stamina.toFixed(0)); this.put(this.bars.hu, 'w', P.hunger.toFixed(0)); this.put(this.bars.th, 'w', P.thirst.toFixed(0));
    const dim = P.stamina > 98; if (dim !== this._dim) { $('bar-st-wrap').classList.toggle('dim', dim); this._dim = dim; }
    let st = '';
    const chip = (cls, ic, what) => `<span class="st ${cls}" title="${what}" aria-label="${what}">${icon(ic)}</span>`;
    if (P.sick > 0) st += chip('sick', 'sick', 'Sick');
    if (P.drunk > 0.3) st += chip('drunk', 'drunk', 'Mahua-drunk');
    if (P.hunger < 20) st += chip('warn', 'food', 'Starving');
    if (P.thirst < 20) st += chip('warn', 'water', 'Parched');
    if (P.exhausted) st += chip('warn', 'tired', 'Exhausted');
    if (P.crouch) st += chip('', 'crouch', 'Crouched');
    const temp = g.weather.temperature(g.time.hour);
    if (temp < 11 && !g.nearFire) st += chip('cold', 'cold', 'Cold');
    if (st !== this._status) { this.status.innerHTML = st; this._status = st; }
    // clock
    const h = g.time.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const ampm = hh < 12 ? 'am' : 'pm', h12 = ((hh + 11) % 12) + 1;
    const clock = `${icon(h >= 6 && h < 18.5 ? 'sun' : 'moon')}<b>${h12}:${String(mm).padStart(2, '0')} ${ampm}</b><span>${g.seasonCfg.label} · ${Math.round(temp)}°C</span>`;
    if (clock !== this._clock) { this.clock.innerHTML = clock; this._clock = clock; }
    // hotbar
    const inv = g.inv; const ws = ['fists', 'knife', 'club', 'spear', 'bow', 'torch'];
    let hb = '';
    ws.forEach((w, i) => { const has = w === 'fists' || inv.has(w); hb += `<div class="slot ${inv.equipped === w ? 'on' : ''} ${has ? '' : 'empty'}"><i>${i + 1}</i>${w === 'fists' ? icon('fist') : `<img src="${iconFor(w)}">`}</div>`; });
    if (hb !== this._hb) { this.hotbar.innerHTML = hb; this._hb = hb; }
    const ammo = inv.equipped === 'bow' ? `Arrows ${inv.count('arrow')}` : inv.equipped === 'spear' ? `Spears ${inv.count('spear')} · RMB aim, LMB throw` : '';
    if (ammo !== this._ammo) { this.ammo.textContent = ammo; this._ammo = ammo; }
    if (g.touchUI) g.touchUI.sync();
    this.drawMinimap(dt);
    // stealth eye: max awareness of animals that see you
    let aw = 0; for (const a of g.eco.animals) if (!a.dead && a.awareness > aw && a.dist2(P.pos) < 3600) aw = a.awareness;
    this.put(this.eye, 'o', aw > 0.25 ? Math.min(1, aw).toFixed(2) : '0');
    const alert = aw > 1; if (alert !== this._alert) { this.eye.classList.toggle('alert', alert); this._alert = alert; }
    // explored map
    const ex = Math.floor((P.pos.x + 2048) / 64), ez = Math.floor((P.pos.z + 2048) / 64);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const x = ex + dx, z = ez + dz; if (x >= 0 && z >= 0 && x < 64 && z < 64) this.explored[z * 64 + x] = 1; }
    for (const k in SITES) { const s = SITES[k]; if (!this.discovered.has(k) && (s.x - P.pos.x) ** 2 + (s.z - P.pos.z) ** 2 < 70 * 70) this.discovered.add(k); }
  }
  // The land around him, from the same picture as the big map. Drawn again only when he has moved a few metres, or every couple of seconds for
  // what moves on it: it is a small job, but there is no reason to do it eight times a second.
  drawMinimap() {
    const g = this.g, P = g.player, m = g.mapImage; if (!m) return;
    const now = performance.now(), L = this._miniAt;
    if (L && now - L.t < 2000 && (P.pos.x - L.x) ** 2 + (P.pos.z - L.z) ** 2 < 9) return;
    this._miniAt = { t: now, x: P.pos.x, z: P.pos.z };
    const cv = this.miniCv, x = cv.getContext('2d'), S = cv.width, R = 220, k = S / (2 * R), c = S / 2;
    const px = m.width / 4096, sx = (P.pos.x + 2048) * px - R * px, sy = (P.pos.z + 2048) * px - R * px;
    x.fillStyle = '#5c6a3e'; x.fillRect(0, 0, S, S); x.imageSmoothingEnabled = true;
    x.drawImage(m, sx, sy, 2 * R * px, 2 * R * px, 0, 0, S, S);
    x.fillStyle = 'rgba(14,12,8,.18)'; x.fillRect(0, 0, S, S);
    // where a thing is on it; what is off it comes in to the rim if it matters (keep), or is left out
    const at = (wx, wz, keep) => { let dx = (wx - P.pos.x) * k, dz = (wz - P.pos.z) * k; const d = Math.hypot(dx, dz), r = c - 14; if (d > r) { if (!keep) return null; dx *= r / d; dz *= r / d; } return [c + dx, c + dz]; };
    const dot = (p, col, r) => { if (!p) return; x.fillStyle = col; x.strokeStyle = 'rgba(20,14,8,.85)'; x.lineWidth = 2; x.beginPath(); x.arc(p[0], p[1], r, 0, 6.2832); x.fill(); x.stroke(); };
    for (const s of this.discovered) dot(at(SITES[s].x, SITES[s].z), '#f2e8d2', 5);
    for (const f of g.camps) dot(at(f.pos.x, f.pos.z), '#e0702a', 6);
    for (const a of this.compassMarks) dot(at(a.x, a.z, true), '#ff5a3a', 6);
    if (g.companion && !g.companion.dead) dot(at(g.companion.pos.x, g.companion.pos.z, true), '#e8b080', 6);
    if (this.pin) { const p = at(this.pin.x, this.pin.z, true); x.fillStyle = '#4fd0e0'; x.strokeStyle = 'rgba(20,14,8,.9)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(p[0], p[1] + 11); x.lineTo(p[0] + 9, p[1] - 6); x.lineTo(p[0] - 9, p[1] - 6); x.closePath(); x.fill(); x.stroke(); }
    if (g.story && g.story.marker) { const p = at(g.story.marker.x, g.story.marker.z, true), r = 11; x.fillStyle = '#e8953a'; x.strokeStyle = 'rgba(20,14,8,.9)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(p[0], p[1] - r); x.lineTo(p[0] + r, p[1]); x.lineTo(p[0], p[1] + r); x.lineTo(p[0] - r, p[1]); x.closePath(); x.fill(); x.stroke(); }
  }
  // an element's opacity ('o') or width in % ('w'), written only if it differs from the last value written here
  put(e, what, v) {
    const k = what === 'o' ? '_o' : '_w';
    if (e[k] === v) return;
    e[k] = v;
    if (what === 'o') e.style.opacity = v; else e.style.width = v + '%';
  }
  updateMarkers(yawDeg, W, dt) {
    const g = this.g, P = g.player;
    const marks = [];
    if (g.story && g.story.marker) marks.push({ ...g.story.marker, cls: 'obj', label: '' });
    for (const m of this.compassMarks) { m.ttl -= dt; if (m.ttl > 0) marks.push(m); }
    this.compassMarks = this.compassMarks.filter((m) => m.ttl > 0);
    if (g.companion && !g.companion.dead) marks.push({ x: g.companion.pos.x, z: g.companion.pos.z, cls: 'comp', label: '' });
    if (this.pin) marks.push({ ...this.pin, cls: 'pin', label: '' });
    while (this.markerEls.length < marks.length) { const e = el('div', 'cmark'); this.compass.parentElement.appendChild(e); this.markerEls.push(e); }
    this.markerEls.forEach((e, i) => {
      const m = marks[i];
      if (!m) { e.style.display = 'none'; return; }
      const ang = Math.atan2(m.x - P.pos.x, -(m.z - P.pos.z)) * 180 / Math.PI;
      let d = ang - yawDeg; while (d > 180) d -= 360; while (d < -180) d += 360;
      const dist = Math.hypot(m.x - P.pos.x, m.z - P.pos.z);
      e.style.display = Math.abs(d) < 92 ? 'block' : 'none';
      e.style.transform = `translateX(${(d / 90 * (W / 2)).toFixed(1)}px)`;
      const cls = 'cmark ' + (m.cls || ''), html = m.cls === 'obj' ? `<b>◆</b><span>${Math.round(dist)}m</span>` : m.cls === 'pin' ? `<b>▼</b><span>${Math.round(dist)}m</span>` : m.cls === 'comp' ? '<b>●</b>' : `<b>!</b><span>${m.label}</span>`;
      if (cls !== e._cls) { e.className = cls; e._cls = cls; }
      if (html !== e._html) { e.innerHTML = html; e._html = html; }
      this.put(e, 'o', m.ttl !== undefined ? Math.min(1, m.ttl / 4).toFixed(2) : '1');
    });
  }
  // Where to go next, on the picture itself: over the target when it is in view, and otherwise an arrow at the edge of the
  // screen pointing the way to turn, with the distance. It leaves the screen once you are there.
  updatePointer(dt) {
    const g = this.g, P = g.player, make = (id, arrow) => ({ el: $(id), label: $(id).querySelector('span'), arrow: $(arrow), x: innerWidth / 2, y: innerHeight / 2, txt: '', cls: '' });
    this.pointTo(this.tgt || (this.tgt = make('target', 'target-arrow')), g.story && g.story.marker, dt);
    // your own mark comes off when you get there
    if (this.pin && (this.pin.x - P.pos.x) ** 2 + (this.pin.z - P.pos.z) ** 2 < 36) this.setPin(null);
    this.pointTo(this.ptgt || (this.ptgt = make('ptarget', 'ptarget-arrow')), this.pin, dt);
  }
  setPin(p) { this.pin = p; this._miniAt = null; }
  pointTo(E, M, dt) {
    const g = this.g, P = g.player, cam = g.camera;
    const dist = M ? Math.hypot(M.x - P.pos.x, M.z - P.pos.z) : 0;
    const show = M && !g.uiBlocking && !g.cinematic && !P.dead && dist > 4 && !(P.aim > 0.3);
    this.put(E.el, 'o', show ? '1' : '0');
    if (!show) return;
    const wy = M.y !== undefined ? M.y : groundHeight(M.x, M.z) + 1.6;
    // in the camera's own frame: +x right, +y up, -z ahead
    const e = cam.matrixWorldInverse.elements, wx = M.x, wz = M.z;
    const vx = e[0] * wx + e[4] * wy + e[8] * wz + e[12], vy = e[1] * wx + e[5] * wy + e[9] * wz + e[13], vz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
    const W = innerWidth, H = innerHeight, ty = Math.tan(cam.fov * Math.PI / 360), tx = ty * cam.aspect;
    const nx = vz < -0.1 ? vx / (-vz * tx) : 9, ny = vz < -0.1 ? vy / (-vz * ty) : 9;
    const ahead = Math.abs(nx) < 0.82 && Math.abs(ny) < 0.78;
    let x, y, rot = 0;
    if (ahead) { x = (nx + 1) * 0.5 * W; y = (1 - ny) * 0.5 * H; }
    else {
      // round the edge of the screen. Behind you it is the way to turn that matters, so it leans to the side.
      let dx = vx, dy = vy; if (vz > 0) { dy = Math.min(dy, 0) - Math.abs(vz) * 0.25; if (Math.abs(dx) < 0.1 * Math.abs(vz)) dx = 0.1 * Math.abs(vz); }
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const rx = W * 0.5 - 90, ry = H * 0.5 - 110;
      x = W * 0.5 + dx * rx; y = H * 0.5 - dy * ry; rot = Math.atan2(dx, dy);
    }
    const k = Math.min(1, dt * 10); E.x += (x - E.x) * k; E.y += (y - E.y) * k;
    E.el.style.transform = `translate(${E.x.toFixed(1)}px,${E.y.toFixed(1)}px)`;
    if (!ahead) E.arrow.style.transform = `rotate(${rot.toFixed(3)}rad)`;
    const cls = ahead ? 'ahead' : 'off'; if (cls !== E.cls) { E.el.classList.remove('ahead', 'off'); E.el.classList.add(cls); E.cls = cls; }
    const txt = `${Math.round(dist)} m`; if (txt !== E.txt) { E.label.textContent = txt; E.txt = txt; }
  }
  alarmMarker(x, z, label) {
    const existing = this.compassMarks.find((m) => Math.hypot(m.x - x, m.z - z) < 30 && m.label === label);
    if (existing) { existing.ttl = 14; return; }
    this.compassMarks.push({ x, z, label, cls: 'alarm', ttl: 14 });
  }
  // ------------------------------------------------------------------ text
  // the older Vanaj, remembering: it goes through the one queue for everything said (js/game/dialogue.js)
  narrate(lines) { return this.g.talk.say([].concat(lines)); }
  say(text) { return this.g.talk.say([text]); }
  // drop any lines still waiting (a new chapter, or back to the title)
  clearNarration() { this.g.talk.clear(); }
  // objective and hint text names keys; on a phone it names the buttons
  forThumbs(text) {
    if (!this.g.touch || typeof text !== 'string') return text;
    return text.replace(/hold <b>Q<\/b>/gi, 'tap <b>Call</b>').replace(/<b>(Tab|E|Q|C|W|A|D|S|Space|1|6)<\/b>/g, (m, k) => `<b>${{ Tab: 'Bag', E: 'Use', Q: 'Call', C: 'Crouch', Space: 'Jump', 1: 'Weapon', 6: 'Weapon' }[k] || 'the stick'}</b>`);
  }
  toast(text, ttl = 3) {
    const e = el('div', 'toast', this.forThumbs(text)); this.toastBox.appendChild(e);
    this.toasts.push({ el: e, ttl });
    if (this.toasts.length > 6) { const t = this.toasts.shift(); t.el.remove(); }
  }
  setObjective(chapter, text) { this.chap.textContent = chapter || ''; this.obj.innerHTML = this.forThumbs(text) || ''; if (this.obj.parentElement) this.obj.parentElement.classList.toggle('blank', !chapter && !text); this.obj.classList.remove('flash'); void this.obj.offsetWidth; this.obj.classList.add('flash'); }
  setPrompt(text) { if (text !== this._prompt) { this.prompt.innerHTML = text || ''; this.prompt.style.opacity = text ? 1 : 0; this._prompt = text; } }
  hitmarker(kill) { this.hitT = 0.18; if (kill) { this.hitKill = true; this.hitT = 0.45; } }
  damage(relAngle, d) {
    if (relAngle === null || relAngle === undefined) return;
    const e = el('div', 'dmgarc'); e.style.transform = `rotate(${-relAngle * 180 / Math.PI + 180}deg)`; e.style.opacity = Math.min(1, 0.4 + d / 30);
    this.dmgInd.appendChild(e); setTimeout(() => e.remove(), 1100);
  }
  card(title, sub, dur = 5) {
    const c = $('card'); c.querySelector('h1').textContent = title; c.querySelector('h2').textContent = sub || '';
    c.classList.add('show'); clearTimeout(this._cardT); this._cardT = setTimeout(() => c.classList.remove('show'), dur * 1000);
  }
  fade(on, ms = 1200) { const f = $('fade'); f.style.transition = `opacity ${ms}ms`; f.style.opacity = on ? 1 : 0; return new Promise((r) => setTimeout(r, ms)); }
  // ------------------------------------------------------------------ call wheel
  buildWheel() {
    const w = $('wheel'); w.innerHTML = '<div class="wcenter">Call</div>';
    this.wheelOpts = [
      { id: 'hum', name: 'Calm hum', desc: 'Crouch with empty hands. Animals learn to trust you.' },
      { id: 'langur', name: 'Langur cough', desc: 'A false alarm. Sends deer and birds running.' },
      { id: 'roar', name: 'Roar', desc: 'Drives off boar, dholes and leopards. A tiger only gives way if you hold fire.' },
      { id: 'whistle', name: 'Whistle', desc: 'Call your companion, or send them to chase off what you look at.' },
      { id: 'flute', name: 'Four notes', desc: 'Play the four notes on the bamboo flute.' },
    ];
    this.wheelOpts.forEach((o, i) => {
      const a = (i / this.wheelOpts.length) * Math.PI * 2 - Math.PI / 2;
      const e = el('div', 'wopt', `<b>${o.name}</b><span>${o.desc}</span>`);
      e.style.left = `calc(50% + ${Math.cos(a) * 170}px)`; e.style.top = `calc(50% + ${Math.sin(a) * 150}px)`;
      o.el = e; o.a = a; w.appendChild(e);
    });
  }
  openWheel() { this.wheelOpen = true; this.wheelAcc = { x: 0, y: 0 }; this.wheelSel = null; $('wheel').classList.add('show'); this.wheelOpts.forEach((o) => o.el.classList.remove('sel')); }
  wheelMove(e) {
    this.wheelAcc.x += e.movementX || 0; this.wheelAcc.y += e.movementY || 0;
    const l = Math.hypot(this.wheelAcc.x, this.wheelAcc.y);
    if (l > 120) { this.wheelAcc.x *= 120 / l; this.wheelAcc.y *= 120 / l; }
    if (l < 25) return;
    const a = Math.atan2(this.wheelAcc.y, this.wheelAcc.x);
    let best = null, bd = 9;
    for (const o of this.wheelOpts) { let d = Math.abs(a - o.a); if (d > Math.PI) d = 2 * Math.PI - d; if (d < bd) { bd = d; best = o; } }
    this.wheelSel = best; this.wheelOpts.forEach((o) => o.el.classList.toggle('sel', o === best));
  }
  closeWheel() { this.wheelOpen = false; $('wheel').classList.remove('show'); const s = this.wheelSel; this.wheelSel = null; return s ? s.id : null; }
  // ------------------------------------------------------------------ panels
  toggle(panel) {
    if (this.open === panel) return this.close();
    this.close(true);
    this.open = panel; this.g.uiBlocking = true;
    $(panel).classList.add('show');
    if (panel === 'inv') this.renderInv();
    if (panel === 'journal') this.renderJournal();
    if (panel === 'map') this.renderMap();
    this.g.audio.ui('open');
    document.exitPointerLock && document.exitPointerLock();
  }
  close(silent) {
    if (!this.open) return;
    $(this.open).classList.remove('show'); this.open = null; this.g.uiBlocking = false;
    if (!silent) this.g.requestLock();
  }
  // The bag: everything carried as tiles (tap one to see what it is and what can be done with it), sorted under a few plain
  // headings, and beside it what can be made, the things he can make right now first.
  renderInv() {
    const g = this.g, inv = g.inv;
    const kind = (k) => { const d = ITEMS[k] || {}; return d.story ? 'keep' : d.food ? 'food' : d.weapon || ['arrow', 'bandage', 'hidewrap', 'flute'].includes(k) ? 'tool' : 'stuff'; };
    const TABS = [['all', 'All'], ['food', 'Food'], ['tool', 'Tools'], ['stuff', 'Materials'], ['keep', 'Keepsakes']];
    const all = Object.keys(inv.items), tab = this.invTab && all.some((k) => kind(k) === this.invTab) ? this.invTab : 'all'; this.invTab = tab;
    const tabs = $('inv-tabs'); tabs.innerHTML = '';
    for (const [id, name] of TABS) {
      const n = id === 'all' ? all.length : all.filter((k) => kind(k) === id).length; if (id !== 'all' && !n) continue;
      const t = el('button', 'tab' + (id === tab ? ' on' : ''), `${name}<i>${n}</i>`); t.onclick = () => { this.invTab = id; this.renderInv(); }; tabs.appendChild(t);
    }
    const order = { tool: 0, food: 1, stuff: 2, keep: 3 }, keys = all.filter((k) => tab === 'all' || kind(k) === tab).sort((x, y) => order[kind(x)] - order[kind(y)]);
    const list = $('inv-items'); list.innerHTML = '';
    if (!keys.length) list.innerHTML = '<p class="empty">Nothing yet. Pick up sticks and stones off the ground.</p>';
    if (!keys.includes(this.invSel)) this.invSel = keys[0];
    for (const k of keys) {
      const d = ITEMS[k] || { name: k }, held = inv.equipped === k;
      const t = el('button', 'tile' + (k === this.invSel ? ' sel' : '') + (held ? ' held' : '') + (d.story ? ' story' : ''), `<img src="${iconFor(k)}" alt=""><i>${inv.count(k)}</i><span>${d.name}</span>`);
      t.onclick = () => { this.invSel = k; this.renderInv(); }; list.appendChild(t);
    }
    // the one picked: what it is, and the one or two things to do with it
    const D = $('inv-detail'); D.innerHTML = '';
    const k = this.invSel, d = k && ITEMS[k];
    if (d) {
      D.appendChild(el('div', 'dhead', `<img src="${iconFor(k)}" alt=""><div><b>${d.name}</b><span>${d.desc || ''}</span></div>`));
      const acts = el('div', 'dacts'), btn = (label, fn, main) => { const x = el('button', main ? 'main' : '', label); x.onclick = () => { fn(); this.renderInv(); }; acts.appendChild(x); };
      if (d.food) { const f = d.food, bits = []; if (f.hunger) bits.push(`hunger +${f.hunger}`); if (f.hp) bits.push(`health +${f.hp}`); if (f.thirst) bits.push(`thirst +${f.thirst}`); if (f.sick) bits.push('may upset your stomach'); D.appendChild(el('p', 'dnote', bits.join(' · '))); btn('Eat', () => g.eat(k), true); }
      if (k === 'bandage') btn('Bind up a hurt', () => g.useBandage(), true);
      if (d.weapon) { if (inv.equipped === k) btn('Put away', () => g.player.equip('fists')); else btn('Hold', () => g.player.equip(k), true); }
      if (acts.children.length) D.appendChild(acts);
    }
    $('inv-armor').textContent = inv.armor ? 'Wearing a bark-cloth wrap (blows land softer)' : '';
    const rl = $('inv-recipes'); rl.innerHTML = '';
    const rs = RECIPES.filter((r) => !(r.lock && inv.locks.has(r.lock))).map((r) => ({ r, can: inv.canCraft(r) })).sort((x, y) => (y.can ? 1 : 0) - (x.can ? 1 : 0));
    for (const { r, can } of rs) {
      const chip = ([key, n]) => `<span class="need ${inv.count(key) >= n ? 'ok' : 'no'}"><img src="${iconFor(key)}" alt="">${Math.min(inv.count(key), n)}/${n} ${ITEMS[key].name}</span>`;
      const ok = (req) => Object.entries(req).every(([key, n]) => inv.count(key) >= n), use = r.alt && !ok(r.needs) && ok(r.alt) ? r.alt : r.needs;
      const req = Object.entries(use).map(chip).join('') + (r.alt && use === r.needs ? `<em>or</em>${Object.entries(r.alt).map(chip).join('')}` : '') + (r.tool ? `<span class="need tool ${inv.has(r.tool) ? 'ok' : 'no'}"><img src="${iconFor(r.tool)}" alt="">needs ${ITEMS[r.tool].name}</span>` : '');
      const e = el('div', 'recipe' + (can ? ' can' : ''), `<img src="${iconFor(r.id)}" alt=""><div><b>${ITEMS[r.id].name}${r.makes ? ' ×' + r.makes : ''}</b><p>${req}</p>${r.desc ? `<small>${r.desc}</small>` : ''}</div>`);
      const bt = el('button', 'craft', 'Make'); bt.disabled = !can; bt.onclick = () => { g.craft(r); this.renderInv(); };
      e.appendChild(bt); rl.appendChild(e);
    }
  }
  addJournal(title, text, kind = 'story') { this.journal.push({ title, text, kind }); this.toast(`Journal: ${title}`, 4); }
  seeLore(k) { if (LORE[k] && !this.loreSeen.has(k)) { this.loreSeen.add(k); this.toast(`Forest lore: ${LORE[k].name}`, 3.5); } }
  // The journal, a page at a time: the story so far, the forest's animals and plants, how each kind of animal takes him,
  // and what he has learned to do.
  renderJournal() {
    const g = this.g, PAGES = [['story', 'Story'], ['lore', 'Forest'], ['friends', 'Animals and you'], ['skills', 'Skills']];
    const page = this.jPage || 'story', tabs = $('j-tabs'); tabs.innerHTML = '';
    for (const [id, name] of PAGES) { const t = el('button', 'tab' + (id === page ? ' on' : ''), name); t.onclick = () => { this.jPage = id; this.renderJournal(); }; tabs.appendChild(t); $('j-' + id).style.display = id === page ? '' : 'none'; }
    if (page === 'skills') { $('j-skills').innerHTML = g.lessons.list(); return; }
    if (page === 'story') {
      const st = $('j-story'); st.innerHTML = '';
      const S = g.story, c = S.chapter;
      if (c) st.appendChild(el('div', 'jnow', `<i>${c.act}</i><b>${c.title}</b><span>${this.forThumbs(S.objText()) || ''}</span>`));
      if (!this.journal.length) st.appendChild(el('p', 'empty', 'Nothing written yet. What you find will be kept here.'));
      for (const j of [...this.journal].reverse()) st.appendChild(el('div', 'jentry ' + j.kind, `<em>${j.kind === 'clue' ? 'Found' : 'Remembered'}</em><h3>${j.title}</h3><p>${j.text}</p>`));
      return;
    }
    if (page === 'lore') {
      const l = $('j-lore'); l.innerHTML = '';
      const keys = Object.keys(LORE), seen = keys.filter((k) => this.loreSeen.has(k));
      l.appendChild(el('p', 'jcount', `${seen.length} of ${keys.length} found`));
      const grid = el('div', 'lgrid'); l.appendChild(grid);
      for (const k of [...seen, ...keys.filter((x) => !this.loreSeen.has(x))]) {
        const L = LORE[k], ok = this.loreSeen.has(k);
        grid.appendChild(el('div', 'lentry' + (ok ? '' : ' locked'), ok ? `<h3>${L.name}</h3>${L.sci ? `<i>${L.sci}</i>` : ''}<p>${L.text}</p>` : '<h3>?</h3><p>Not met yet</p>'));
      }
      return;
    }
    // how each kind he has met takes him: from his standing with them (js/sim/director.js)
    const f = $('j-friends'); f.innerHTML = '';
    const W = g.world, NAMES = { chital: 'Chital', sambar: 'Sambar', gaur: 'Gaur', boar: 'Wild boar', langur: 'Langurs', peafowl: 'Peafowl', bear: 'Sloth bear', dhole: 'Dholes', leopard: 'Leopard', tiger: 'Tiger', mugger: 'Mugger', cow: 'Cattle', dog: 'Village dogs', wolf: 'Wolf' };
    const STEPS = ['Runs from you', 'Wary', 'Watchful', 'Curious', 'Easy with you', 'Trusts you'];
    const met = Object.keys(W.seen || {});
    f.appendChild(el('p', 'jcount', 'Animals remember how you treat their kind. Crouch, put your weapon away and hum, and they let you closer. Chase or strike them and they keep their distance.'));
    if (!met.length) f.appendChild(el('p', 'empty', 'You have not been close to anything yet.'));
    for (const sp of met) {
      const r = (W.rep && W.rep[sp]) || 0, hunter = ['tiger', 'leopard', 'dhole', 'mugger'].includes(sp);
      const i = hunter ? -1 : r < -0.3 ? 0 : r < -0.05 ? 1 : r < 0.15 ? 2 : r < 0.45 ? 3 : r < 0.75 ? 4 : 5;
      const dots = hunter ? '' : STEPS.map((_, n) => `<i class="${n <= i ? 'on' : ''}"></i>`).join('');
      f.appendChild(el('div', 'friend', `<b>${NAMES[sp] || sp}</b><div class="meter">${dots}</div><span>${hunter ? 'A hunter. Fire and a steady voice, not friendship.' : STEPS[i]}</span>`));
    }
  }
  // the explored land is drawn clear; the rest lies under a parchment wash that still shows its shape, with
  // soft edges (a 64x64 mask scaled up smoothly), so the map reads at a glance instead of being mostly black
  renderMap() {
    const g = this.g, cv = $('mapcv'), x = cv.getContext('2d');
    const S = cv.width;
    if (g.mapImage) { x.imageSmoothingEnabled = true; x.drawImage(g.mapImage, 0, 0, S, S); }
    const fog = this._fog || (this._fog = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }));
    const fx = fog.getContext('2d'), fd = fx.createImageData(64, 64);
    for (let k = 0; k < 64 * 64; k++) { fd.data[k * 4] = 238; fd.data[k * 4 + 1] = 226; fd.data[k * 4 + 2] = 196; fd.data[k * 4 + 3] = this.explored[k] ? 0 : 175; }
    fx.putImageData(fd, 0, 0);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(fog, 0, 0, S, S);
    const toMap = (wx, wz) => [(wx + 2048) / 4096 * S, (wz + 2048) / 4096 * S];
    const ink = '#3a2a1c';
    x.font = '600 15px "Cormorant Garamond", serif'; x.textAlign = 'center';
    for (const k of this.discovered) {
      const s = SITES[k]; const [mx, my] = toMap(s.x, s.z);
      x.fillStyle = ink; x.beginPath(); x.arc(mx, my, 3.5, 0, 6.28); x.fill();
      x.lineWidth = 3; x.strokeStyle = 'rgba(244,234,210,0.85)'; x.strokeText(s.name, mx, my - 9); x.fillText(s.name, mx, my - 9);
    }
    for (const c of g.camps) { const [mx, my] = toMap(c.pos.x, c.pos.z); x.fillStyle = '#e0702a'; x.beginPath(); x.arc(mx, my, 4.5, 0, 6.28); x.fill(); }
    const comp = g.companion;
    if (comp && !comp.dead) { const [mx, my] = toMap(comp.pos.x, comp.pos.z); x.fillStyle = '#7a5a3a'; x.strokeStyle = '#f4ead2'; x.lineWidth = 2; x.beginPath(); x.arc(mx, my, 5, 0, 6.28); x.fill(); x.stroke(); }
    if (g.story && g.story.marker) {
      const [mx, my] = toMap(g.story.marker.x, g.story.marker.z), pulse = 10 + 4 * Math.sin(performance.now() * 0.005);
      x.strokeStyle = '#c0501e'; x.lineWidth = 3; x.beginPath(); x.moveTo(mx, my - 9); x.lineTo(mx + 9, my); x.lineTo(mx, my + 9); x.lineTo(mx - 9, my); x.closePath(); x.stroke();
      x.lineWidth = 1.5; x.globalAlpha = 0.6; x.beginPath(); x.arc(mx, my, pulse, 0, 6.28); x.stroke(); x.globalAlpha = 1;
    }
    if (this.pin) { const [mx, my] = toMap(this.pin.x, this.pin.z); x.fillStyle = '#20a8bc'; x.strokeStyle = '#f4ead2'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(mx, my); x.lineTo(mx + 10, my - 18); x.arc(mx, my - 22, 10.8, 0.38, Math.PI - 0.38, true); x.closePath(); x.stroke(); x.fill(); x.fillStyle = '#f4ead2'; x.beginPath(); x.arc(mx, my - 22, 4, 0, 6.2832); x.fill(); }
    const P = g.player; const [px, py] = toMap(P.pos.x, P.pos.z);
    x.save(); x.translate(px, py); x.rotate(-P.yaw); x.fillStyle = ink; x.strokeStyle = '#f4ead2'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath(); x.stroke(); x.fill(); x.restore();
    // compass and a small legend
    x.fillStyle = ink; x.font = '700 16px "Cormorant Garamond", serif'; x.textAlign = 'center'; x.fillText('N', 26, 26);
    x.beginPath(); x.moveTo(26, 32); x.lineTo(31, 48); x.lineTo(26, 44); x.lineTo(21, 48); x.closePath(); x.fill();
    const L = [['#7ca058', 'Forest'], ['#cec67c', 'Meadow'], ['#60b2ba', 'Water'], ['#baac9c', 'Rock'], ['#e0be92', 'Village']];
    x.font = '13px Karla, sans-serif'; x.textAlign = 'left';
    L.forEach(([col, name], i) => { const yy = S - 18 - (L.length - 1 - i) * 18; x.fillStyle = col; x.fillRect(14, yy - 10, 14, 12); x.strokeStyle = 'rgba(58,42,28,0.5)'; x.lineWidth = 1; x.strokeRect(14, yy - 10, 14, 12); x.fillStyle = ink; x.fillText(name, 34, yy); });
  }
  showDeath(cause) {
    const msgs = { drown: 'The river was stronger than you.', starve: 'You were too hungry to go on.', thirst: 'You were too thirsty to go on.', fall: 'That was too far to fall.', wounds: 'It was too much for you. This time.' };
    $('death-msg').textContent = msgs[cause] || msgs.wounds;
    $('death').classList.add('show'); this.g.uiBlocking = true; document.exitPointerLock && document.exitPointerLock();
  }
  hideDeath() { $('death').classList.remove('show'); this.g.uiBlocking = false; }
  choice(title, a, b) {
    return new Promise((res) => {
      const c = $('choice'); c.querySelector('h2').textContent = title;
      const ba = $('choice-a'), bb = $('choice-b'); ba.textContent = a; bb.textContent = b;
      c.classList.add('show'); this.g.uiBlocking = true; document.exitPointerLock && document.exitPointerLock();
      const done = (v) => { c.classList.remove('show'); this.g.uiBlocking = false; this.g.requestLock(); res(v); };
      ba.onclick = () => done('a'); bb.onclick = () => done('b');
    });
  }
}

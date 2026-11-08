// Real Pench (Madhya Pradesh) place names laid over the game map. The layout is condensed, but each name is
// put on ground that matches the real place: Alikatta is the central meadow, Junewani Talao the pond with
// dead trees standing in it, Piyorthadi the rocky leopard country, Kalapahad the high ground with the
// wireless tower, Sitaghat the river ghat, Jamun Nala a grassy nala, Chhindimatta the rocky hills,
// Totladoh the reservoir. Walking into a place shows its name, the way a tracker would say it.
import { MAIDAN, ROCKS, TERMITE, VILLAGE, LAKE, lakeE, riverX, RIVER_W, WATERHOLES } from './terrain.js';

export const PLACES = [
  { id: 'junewani', name: 'Junewani Talao', sub: 'a pond of drowned trees', x: WATERHOLES[2].x, z: WATERHOLES[2].z, r: 60 },
  { id: 'alikatta', name: 'Alikatta', sub: 'the open meadow', x: MAIDAN.x, z: MAIDAN.z, r: MAIDAN.r * 0.8 },
  { id: 'piyorthadi', name: 'Piyorthadi', sub: 'rock and leopard country', x: ROCKS.x, z: ROCKS.z, r: ROCKS.r * 0.85 },
  { id: 'jamun', name: 'Jamun Nala', sub: 'termite grass and jamun shade', x: TERMITE.x, z: TERMITE.z, r: TERMITE.r * 0.9 },
  { id: 'kalapahad', name: 'Kalapahad', sub: 'the black hill and its tower', x: riverX(-1400) - 140, z: -1400, r: 150 },
  { id: 'village', name: 'Turia', sub: 'fields at the forest edge', x: VILLAGE.x, z: VILLAGE.z, r: VILLAGE.r * 1.2 },
  { id: 'chhindimatta', name: 'Chhindimatta', sub: 'stony hills of date palm', x: -1300, z: -1100, r: 380 },
  { id: 'karmajhiri', name: 'Karmajhiri', sub: 'deep teak, east', x: 1250, z: -700, r: 420 },
];

export function placeAt(x, z) {
  for (const p of PLACES) if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
  if (lakeE(x, z) < 1.05) return { id: 'totladoh', name: 'Totladoh', sub: 'the reservoir' };
  const rx = riverX(z);
  if (Math.abs(x - rx) < RIVER_W + 30) {
    if (z > 200 && z < 1000) return { id: 'sitaghat', name: 'Sitaghat', sub: 'the Pench river' };
    if (z < -900) return { id: 'raiyakassa', name: 'Raiyakassa', sub: 'the Pench river' };
    return { id: 'pench', name: 'Pench', sub: 'the river' };
  }
  return null;
}

// Shows the name a few seconds after you arrive (not when you merely brush the edge), once per visit.
export class PlaceTracker {
  constructor(el) { this.el = el; this.cur = null; this.cand = null; this.t = 0; this.acc = 0; this.shown = new Map(); }
  update(dt, x, z, clock) {
    this.acc += dt; if (this.acc < 0.5) return; const step = this.acc; this.acc = 0;
    const p = placeAt(x, z), id = p ? p.id : null;
    if (id !== this.cand) { this.cand = id; this.t = 0; return; }
    this.t += step;
    if (id && id !== this.cur && this.t > 2.5) {
      this.cur = id;
      const last = this.shown.get(id);
      if (last === undefined || clock - last > 600) { this.shown.set(id, clock); this.show(p); }
    }
    if (!id && this.t > 6) this.cur = null;
  }
  show(p) {
    if (!this.el) return;
    const card = document.getElementById('card');
    if (card && card.classList.contains('show')) { setTimeout(() => this.show(p), 3000); return; }
    this.el.innerHTML = `<div class="pn">${p.name}</div><div class="ps">${p.sub}</div>`;
    this.el.classList.remove('show'); void this.el.offsetWidth; this.el.classList.add('show');
  }
}

// The director: one picture of the world that everything living in it can read, and the cast of the story.
//
// world (game.world, and W.sim to the animals) is the blackboard:
//   phase     'night' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk'
//   rain, heat, cold, night   0..1 from the weather and the sun
//   danger    0..1: a big cat or a pack is about (worked out from the animals near him, or set by a scene)
//   tension   0..1: set by the story for a scene; danger never falls below it
//   fire      he is beside a fire
//   chapter, beat   where the story is: a beat is the id of the objective in hand
//   rep       how each kind of animal thinks of him, -1..1: what he has done to them and for them
//
// The story hands out directives through here (direct('kaali', { type: 'lead', to })) and never moves an animal
// itself, so a scene reads as what each one is doing, and each one still shies, looks about and keeps clear of
// water while it does it. Changes in the world (rain starting, night falling, a tiger near) go out as events, and
// the passing remarks in js/game/barks.js hang on those.
import * as THREE from 'three';
import { clamp, lerp } from '../core/noise.js';

const PHASES = [[4.6, 'night'], [6.6, 'dawn'], [10.5, 'morning'], [15, 'midday'], [17.4, 'afternoon'], [19.2, 'dusk'], [24.1, 'night']];
export const phaseOf = (h) => { for (const [end, name] of PHASES) if (h < end) return name; return 'night'; };

export class Director {
  constructor(g) {
    this.g = g; this.cast = new Map(); this.t = 0;
    this.world = g.world = { phase: 'morning', rain: 0, heat: 0, cold: 0, night: 0, danger: 0, tension: 0, fire: false, chapter: '', beat: '', rep: {}, seen: {} };
    // what he does to animals is remembered by their kind
    // The forest's state changing (js/sim/forest.js) reaches the animals here. A hunter about: every deer and langur in earshot lifts
    // its head toward it, and the feeding flocks go up. The hush that follows is theirs too: nothing grazes until it has passed.
    g.on('sim', (e) => {
      if (e.what !== 'forest') return;
      const at = this.world.dangerAt, P = g.player.pos;
      if ((e.state === 'alarm' || e.state === 'hush') && e.from !== 'alarm' && e.from !== 'hush' && at) {
        for (const a of g.eco.animals) { const k = a.d.kind; if (a.dead || a.routed || a.companion || a.scripted || (a.mind && a.mind.dir)) continue; if ((k === 'prey' || k === 'bird' || k === 'livestock') && a.state !== 'flee' && a.dist2(P) < 130 * 130) { a.threat = at.clone(); a.setState('alert', 1.5 + Math.random() * 2.5); } }
        if (g.birds && g.birds.scare) g.birds.scare(at, 90);
      }
    });
    g.on('call', (e) => {
      const P = g.player;
      if (e.kind === 'hum' && P.crouch && !P.armedThreat) for (const a of g.eco.near(P.pos, 26)) if (!a.dead && !a.routed && !a.companion && a.d.kind !== 'predator' && a.d.kind !== 'pack') { this.trust(a.sp, 0.04); a.mind.show('note', 2.4); }
      if (e.kind === 'roar' || e.kind === 'langur') for (const a of g.eco.near(P.pos, 40)) if (!a.companion && (a.d.kind === 'prey' || a.d.kind === 'arboreal' || a.d.kind === 'bird')) this.trust(a.sp, -0.02);
    });
  }
  // ------------------------------------------------------------------ cast
  enroll(key, ent) { if (ent) { this.cast.set(key, ent); ent.castKey = key; } return ent; }
  actor(key) { const e = this.cast.get(key); if (!e) return null; if (e.mind && !this.g.eco.animals.includes(e)) { this.cast.delete(key); return null; } return e; }
  direct(key, d) { const e = typeof key === 'string' ? this.actor(key) : key; if (e && e.mind) e.mind.direct(d); return e; }
  release(key) { this.direct(key, null); }
  // a new chapter: the old cast is let go (the animals themselves stay or go as the story says)
  reset() { for (const e of this.cast.values()) if (e.mind) e.mind.direct(null); this.cast.clear(); this.world.tension = 0; this.world.beat = ''; }
  // ------------------------------------------------------------------ standing
  // his standing with a kind of animal moves, and those near enough to have seen it move with it
  trust(sp, by, o = {}) {
    const R = this.world.rep, v = clamp((R[sp] || 0) + by, -1, 1); R[sp] = v;
    const P = this.g.player.pos;
    for (const a of this.g.eco.animals) if (a.sp === sp && !a.dead && a.dist2(P) < 50 * 50) { a.bond = clamp(a.bond + by * (o.near || 2.5), 0, 1); if (by > 0.05) a.mind.show('heart', 2.5); }
    return v;
  }
  // an animal coming into the world starts from what its kind thinks of him
  greet(a) { const r = this.world.rep[a.sp] || 0; if (r > 0 && !a.companion && a.d.kind !== 'predator' && a.d.kind !== 'pack') a.bond = Math.max(a.bond, r * 0.7); }
  // ------------------------------------------------------------------ each frame
  update(dt) {
    const g = this.g, W = this.world, P = g.player, env = g.weather.env;
    this.t -= dt; if (this.t > 0) return; const step = 0.3 - this.t; this.t = 0.3;
    const was = { phase: W.phase, rain: W.rain > 0.5, night: W.night > 0.5, danger: W.danger > 0.5, cold: W.cold > 0.5, fire: W.fire };
    const temp = g.weather.temperature(g.time.hour);
    W.phase = phaseOf(g.time.hour); W.rain = env.rain || 0; W.night = g.sky.night;
    W.heat = clamp((temp - 34) / 8, 0, 1); W.cold = clamp((12 - temp) / 8, 0, 1); W.fire = !!g.nearFire;
    W.season = g.season; W.hour = g.time.hour;
    W.chapter = g.story.chapter ? g.story.chapter.id : ''; W.beat = g.story.obj ? (g.story.obj.id || W.chapter + ':' + g.story.objIndex) : '';
    // danger: the nearest hunter that is up and about, by how near and how set on something it is
    let dg = 0;
    for (const a of g.eco.animals) {
      if (a.dead || a.routed || a.companion) continue;
      const k = a.d.kind; if (k !== 'predator' && k !== 'pack') continue;
      const d = Math.sqrt(a.dist2(P.pos)); if (d > 140) continue;
      const act = a.state === 'charge' || a.state === 'attack' || a.state === 'pounce' ? 1 : a.state === 'stalk' || (a.mind.dir && a.mind.dir.type === 'prowl') ? 0.8 : a.state === 'rest' ? 0.15 : 0.45;
      const v = act * clamp(1.25 - d / 140, 0, 1); if (v > dg) { dg = v; W.dangerAt = a.pos; }
    }
    W.danger = lerp(W.danger, Math.max(dg, W.tension), dg > W.danger ? 0.6 : 0.12);
    // what has changed goes out as an event
    const now = { phase: W.phase, rain: W.rain > 0.5, night: W.night > 0.5, danger: W.danger > 0.5, cold: W.cold > 0.5, fire: W.fire };
    if (g.playing && !g.cinematic) {
      if (now.phase !== was.phase) g.emit('sim', { what: 'phase', phase: W.phase });
      if (now.rain !== was.rain) g.emit('sim', { what: now.rain ? 'rain-start' : 'rain-stop' });
      if (now.night !== was.night) g.emit('sim', { what: now.night ? 'night-fall' : 'day-break' });
      if (now.danger !== was.danger) g.emit('sim', { what: now.danger ? 'danger' : 'safe' });
      if (now.fire !== was.fire && now.fire) g.emit('sim', { what: 'fire' });
    }
    // the first time he is near enough to a kind of animal to see it properly
    for (const a of g.eco.animals) if (!W.seen[a.sp] && a.shown && !a.dead && a.dist2(P.pos) < 28 * 28 && !g.cinematic) { W.seen[a.sp] = 1; g.emit('sim', { what: 'see', sp: a.sp, animal: a }); break; }
  }
  toJSON() { return { rep: this.world.rep, seen: this.world.seen }; }
  load(s) { this.world.rep = (s && s.rep) || {}; this.world.seen = (s && s.seen) || {}; }
}

// ------------------------------------------------------------------------------------------------ emotes
// What an animal is feeling, drawn over its head for the ones near him: a child can read the forest at a glance,
// and so can anyone learning what the states mean. A few sprites shared between whichever animals are nearest.
const MARKS = { alert: 0, ask: 1, heart: 2, sleep: 3, anger: 4, sweat: 5, note: 6, talk: 7, come: 8 };
function emoteAtlas() {
  const S = 64, c = document.createElement('canvas'); c.width = S * 3; c.height = S * 3; const x = c.getContext('2d');
  x.lineJoin = x.lineCap = 'round'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const ink = '#2a1c12', paper = '#fbf3de';
  const cell = (i, draw) => { x.save(); x.translate((i % 3) * S + S / 2, Math.floor(i / 3) * S + S / 2); draw(); x.restore(); };
  const bubble = (col = paper) => { x.fillStyle = col; x.strokeStyle = ink; x.lineWidth = 3.5; x.beginPath(); x.arc(0, -3, 24, 0, 6.2832); x.fill(); x.stroke(); x.beginPath(); x.moveTo(-7, 18); x.lineTo(0, 29); x.lineTo(7, 18); x.fill(); x.stroke(); x.fillStyle = col; x.fillRect(-6, 14, 12, 6); };
  const txt = (s, col, size = 34, dy = -2) => { x.fillStyle = col; x.font = `700 ${size}px Georgia, serif`; x.fillText(s, 0, dy); };
  cell(0, () => { bubble('#ffe7a8'); txt('!', '#c0401a', 38); });
  cell(1, () => { bubble(); txt('?', '#3a6a8a', 36); });
  cell(2, () => { bubble('#ffe3dc'); x.fillStyle = '#d8483a'; x.beginPath(); x.moveTo(0, 10); x.bezierCurveTo(-22, -6, -10, -22, 0, -10); x.bezierCurveTo(10, -22, 22, -6, 0, 10); x.fill(); });
  cell(3, () => { bubble('#e4ecf6'); txt('z', '#4a5a7a', 26, -8); x.font = '700 17px Georgia, serif'; x.fillText('z', 10, 5); });
  cell(4, () => { bubble('#ffd9c8'); x.strokeStyle = '#c0301a'; x.lineWidth = 4.5; for (const [a, b, d, e] of [[-10, -14, -4, -8], [-14, -10, -8, -4], [10, -14, 4, -8], [14, -10, 8, -4], [-10, 8, -4, 2], [-14, 4, -8, -2], [10, 8, 4, 2], [14, 4, 8, -2]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(d, e); x.stroke(); } });
  cell(5, () => { bubble('#e2f0f6'); x.fillStyle = '#4a9ac0'; x.beginPath(); x.moveTo(0, -18); x.quadraticCurveTo(13, 2, 0, 10); x.quadraticCurveTo(-13, 2, 0, -18); x.fill(); });
  cell(6, () => { bubble('#e8f4dc'); txt('♪', '#4a7a3a', 34); });
  cell(7, () => { bubble(); x.fillStyle = ink; for (const dx of [-10, 0, 10]) { x.beginPath(); x.arc(dx, -3, 3.4, 0, 6.2832); x.fill(); } });
  cell(8, () => { bubble('#fff0c8'); x.strokeStyle = '#a0562a'; x.lineWidth = 5; x.beginPath(); x.moveTo(-11, -3); x.lineTo(9, -3); x.moveTo(1, -12); x.lineTo(10, -3); x.lineTo(1, 6); x.stroke(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}
export class Emotes {
  constructor(scene, n = 5) {
    this.pool = []; this.tex = null; this.scene = scene; this.n = n; this.t = 0; this.list = [];
  }
  build() {
    this.tex = emoteAtlas();
    for (let i = 0; i < this.n; i++) {
      const tex = this.tex.clone(); tex.repeat.set(1 / 3, 1 / 3); tex.needsUpdate = true;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
      m.visible = false; m.renderOrder = 20; m.frustumCulled = false; this.scene.add(m);
      this.pool.push({ s: m, tex, a: null, k: 0, kind: null });
    }
  }
  update(dt, g) {
    if (!this.tex) this.build();
    const P = g.player.pos, cam = g.camera.position;
    // who gets one: looked for a few times a second
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.2; const L = this.list; L.length = 0;
      if (g.playing && !g.cinematic) for (const a of g.eco.animals) {
        if (!a.shown || a.dead) continue; const d2 = a.dist2(P); if (d2 > 32 * 32) continue;
        const f = a.mind.face(); if (f) L.push({ a, f, d2 });
      }
      L.sort((p, q) => p.d2 - q.d2); L.length = Math.min(L.length, this.n);
      for (const e of this.pool) { const hit = L.find((l) => l.a === e.a); if (!hit) e.a = null; else { hit.used = true; e.kind = hit.f; } }
      for (const l of L) if (!l.used) { const e = this.pool.find((p) => !p.a && p.k < 0.05); if (e) { e.a = l.a; e.kind = l.f; } }
    }
    for (const e of this.pool) {
      e.k = lerp(e.k, e.a ? 1 : 0, Math.min(1, dt * (e.a ? 9 : 7)));
      if (e.k < 0.02 || (!e.a && !e.last)) { e.s.visible = false; continue; }
      const a = e.a || e.last; e.last = a;
      if (e.a && e.kind !== e.shown) { e.shown = e.kind; const i = MARKS[e.kind] ?? 0; e.tex.offset.set((i % 3) / 3, 1 - (Math.floor(i / 3) + 1) / 3); }
      const h = (a.rig ? a.rig.height : a.d.H * 1.25) * a.scale + 0.45, d = Math.hypot(a.pos.x - cam.x, a.pos.z - cam.z), sz = clamp(0.3 + d * 0.028, 0.34, 1.1) * (0.6 + 0.4 * e.k);
      e.s.position.set(a.pos.x, a.pos.y + h + Math.sin(performance.now() * 0.004 + a.id) * 0.04, a.pos.z); e.s.scale.set(sz, sz, 1); e.s.material.opacity = e.k; e.s.visible = true;
    }
  }
}

// The forest's state: one small graph that says what the forest as a whole is doing, read by the sound, the birds, the
// animals and the remarks. Nothing calls at random any more: what you hear is what the forest is doing.
//
//   by the clock      night -> dawn (the chorus) -> morning -> midday (the hush of the heat) -> evening -> night
//   by the weather    rain (birds silent, frogs in the monsoon) -> afterRain (everything sings at once) -> the hour's state
//   by a hunter       alarm (a cat or a pack is moving: song stops, sentinels call) -> hush (it is close: nothing at all)
//                     -> settle (it has gone: a long quiet, then one bird tries, then the rest) -> the hour's state
//
// Each state is a profile: how many birds are singing and which kinds, how long they leave between phrases, how easy the
// animals are (calm), and how far off the rare distant calls come. Song is sung by singers: a handful of birds, each a
// kind with a perch somewhere round him, that stays where it is and sings a phrase, waits its kind's own interval,
// sings again, and after a few minutes moves on. One of its own kind elsewhere often answers it. So a barbet is over
// there, for a while, and the bulbul by the water answers the one behind you.
import { clamp } from '../core/noise.js';

const rnd = (a, b) => a + Math.random() * (b - a);
// seconds between one bird's phrases, and how far off it is usually heard
const KIND = {
  barbet: [7, 12, 30, 90], bulbul: [5, 9, 15, 50], drongo: [6, 11, 20, 60], babbler: [9, 16, 12, 40], coucal: [12, 20, 40, 110], hawkCuckoo: [10, 16, 40, 120],
  koel: [9, 15, 40, 120], woodpecker: [14, 28, 25, 70], junglefowl: [18, 34, 40, 120], peacock: [22, 45, 60, 160], lapwing: [11, 22, 30, 80], kingfisher: [14, 24, 20, 60],
  nightjar: [7, 12, 30, 90], owlet: [11, 20, 25, 70], woodOwl: [24, 45, 60, 150], fishOwl: [28, 50, 60, 140],
};
// singers: how many at once; gap: their intervals are multiplied by this; calm: how at ease the animals are (0..1)
const STATES = {
  // rest: the least silence between any two phrases, whoever sings them
  night: { singers: 2, gap: 2.2, rest: 9, calm: 0.7 },
  dawn: { singers: 4, gap: 1, rest: 1.6, calm: 1 },
  morning: { singers: 2, gap: 1.6, rest: 5, calm: 1 },
  midday: { singers: 1, gap: 2.6, rest: 14, calm: 0.9 },
  evening: { singers: 2, gap: 1.5, rest: 4, calm: 0.85 },
  rain: { singers: 0, gap: 1, calm: 0.6 },
  afterRain: { singers: 4, gap: 0.9, rest: 1.4, calm: 1 },
  alarm: { singers: 0, gap: 1, calm: 0.25 },
  hush: { singers: 0, gap: 1, calm: 0 },
  settle: { singers: 1, gap: 2.2, rest: 8, calm: 0.5 },
};
const HOUR_STATE = { night: 'night', dawn: 'dawn', morning: 'morning', midday: 'midday', afternoon: 'midday', dusk: 'evening' };

export class Forest {
  constructor(g) { this.g = g; this.state = 'morning'; this.t = 0; this.singers = []; this.farT = 40; this.villageT = 8; this.tick = 0; this.rainEnd = -1e9; this.quietT = 0; }
  get profile() { return STATES[this.state]; }
  // which kinds sing in this state, season and place: [kind, weight]
  cast() {
    const W = this.g.world, s = W.season, wet = this.water > 0.2, st = this.state, c = [];
    const add = (k, w) => { if (w > 0) c.push([k, w]); };
    if (st === 'night') { add('nightjar', 3); add('owlet', 2); add('woodOwl', 1); add('hawkCuckoo', s === 'summer' ? 1.5 : 0); add('fishOwl', wet ? 1.2 : 0); return c; }
    if (st === 'midday') { add('barbet', 2); add('coucal', 1.5); add('hawkCuckoo', s === 'summer' ? 4 : 0); add('woodpecker', 1); return c; }
    if (st === 'settle') { add('bulbul', 2); add('drongo', 1); return c; }
    add('barbet', 2); add('bulbul', 3); add('drongo', 2); add('babbler', 1.5); add('coucal', 1); add('woodpecker', 0.7);
    add('hawkCuckoo', s === 'summer' ? 2.5 : s === 'winter' ? 0.8 : 0); add('koel', s === 'summer' ? 2.5 : s === 'monsoon' ? 1.2 : 0);
    add('lapwing', wet ? 2 : 0); add('kingfisher', wet ? 1.5 : 0);
    if (st === 'dawn') { add('junglefowl', 3); add('peacock', 2.5); }
    if (st === 'evening') { add('peacock', 3); add('junglefowl', 0.6); }
    if (st === 'afterRain') { add('peacock', s === 'monsoon' ? 4 : 1.5); add('koel', 2); }
    return c;
  }
  // the graph: where the forest goes from here
  next() {
    const W = this.g.world, st = this.state, base = HOUR_STATE[W.phase] || 'morning', danger = W.danger;
    if (danger > 0.72) return 'hush';
    if (danger > 0.34) return st === 'hush' && danger > 0.55 ? 'hush' : 'alarm';
    if (st === 'hush' || st === 'alarm') return 'settle';
    if (st === 'settle') return this.t > 38 ? base : 'settle';
    if (W.rain > 0.45) return 'rain';
    if (st === 'rain') { this.rainEnd = this.g.clock; return base === 'night' ? 'night' : 'afterRain'; }
    if (st === 'afterRain') return this.t > 110 || base === 'night' ? base : 'afterRain';
    return base;
  }
  enter(s) {
    const g = this.g, from = this.state; this.state = s; this.t = 0; g.world.forest = s;
    // a hunter: every bird stops at once. Otherwise the ones singing finish, and the cast changes as they move on.
    if (s === 'alarm' || s === 'hush' || s === 'rain') this.singers.length = 0;
    if (s === 'settle') this.singers.length = 0;
    // the birds of the hour before give way to the birds of this one (no peacock at noon, no barbet at midnight)
    { const kinds = new Set(this.cast().map((c) => c[0])); this.singers = this.singers.filter((x) => kinds.has(x.kind)); }
    g.emit('sim', { what: 'forest', state: s, from });
  }
  // a new singer of a kind the state has, on a perch round him
  recruit() {
    const c = this.cast(); if (!c.length) return;
    let tw = 0; for (const x of c) tw += x[1];
    let r = Math.random() * tw, kind = c[0][0]; for (const [k, w] of c) { r -= w; if (r <= 0) { kind = k; break; } }
    const K = KIND[kind], P = this.g.player.pos, a = Math.random() * 6.2832, d = rnd(K[2], K[3]);
    this.singers.push({ kind, x: P.x + Math.cos(a) * d, y: P.y + rnd(3, 14), z: P.z + Math.sin(a) * d, next: rnd(0.5, 6), left: 4 + Math.floor(Math.random() * 7) });
  }
  update(dt) {
    const g = this.g, W = g.world, A = g.audio;
    this.t += dt; this.tick -= dt; this.quietT -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      this.water = A.state ? A.state.water || 0 : 0;
      const n = this.next(); if (n !== this.state) this.enter(n);
      W.calm = this.profile.calm;
    }
    if (!A.ready || g.inMenu) return;
    const P = g.player.pos, pr = this.profile, lite = A.lite && A.voices.length > 14;
    // how many are singing: the dawn chorus builds over its first minutes, and after a fright they come back one at a time
    let want = pr.singers;
    if (this.state === 'dawn') want = Math.min(want, 1 + Math.floor(this.t / 25));
    if (this.state === 'settle') want = this.t > 14 ? 1 : 0;
    if (W.rain > 0.2 && this.state !== 'rain') want = Math.min(want, 1);
    while (this.singers.length < want) this.recruit();
    for (let i = this.singers.length - 1; i >= 0; i--) {
      const s = this.singers[i];
      // left behind as he walks on, or done here: it goes, and another takes up somewhere else
      if ((s.x - P.x) ** 2 + (s.z - P.z) ** 2 > 170 * 170 || s.left <= 0 || this.singers.length > want + 1) { this.singers.splice(i, 1); continue; }
      s.next -= dt;
      if (s.next > 0 || lite || this.quietT > 0) continue;
      const K = KIND[s.kind];
      A.bird(s.kind, s); s.left--; s.next = rnd(K[0], K[1]) * pr.gap; this.quietT = (pr.rest || 3) * rnd(0.8, 1.5);
      // one of its own kind, elsewhere, answers as soon as the quiet allows
      if (Math.random() < 0.4) for (const o of this.singers) if (o !== s && o.kind === s.kind) { o.next = Math.min(o.next, rnd(0.3, 1.2)); break; }
    }
    // far off, now and then: jackals at nightfall, a sambar's bell or a tiger's moan in the night
    this.farT -= dt;
    if (this.farT <= 0 && !lite) {
      this.farT = rnd(70, 190);
      if (this.state === 'night') { const h = W.hour; A.bird(h > 18.5 && h < 22 && Math.random() < 0.6 ? 'jackals' : Math.random() < 0.75 ? 'farSambar' : 'farTiger'); }
    }
    // the village, where it can be heard: a dog, a cow bell, a cock at dawn
    this.villageT -= dt;
    if (this.villageT <= 0) { this.villageT = rnd(9, 22); const v = A.state ? A.state.village || 0 : 0; if (v > 0.2 && !lite) A.bird(this.state === 'dawn' && Math.random() < 0.5 ? 'rooster' : Math.random() < 0.5 ? 'dogBark' : 'cowBell'); }
  }
}

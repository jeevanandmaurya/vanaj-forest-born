// The sound of the opening, written for the paintings, one cue to a plate. Almost nothing plays most of the time, so that
// what does means something: bullock bells going home, then the water, then her voice alone, then almost silence, and at
// the end the four notes coming back on the flute. Nothing here runs after stop().
import { THEME } from './music.js';

const SA = 293.66;   // the lullaby's home note (the flute's D4)
const hz = (semi) => SA * Math.pow(2, semi / 12);

export class IntroSound {
  constructor(audio, music) {
    this.a = audio; this.m = music; this.ctx = audio.ctx; this.timers = [];
    const c = this.ctx, t = c.currentTime;
    this.bus = c.createGain(); this.bus.gain.value = 1; this.bus.connect(audio.master);
    // the beds: one river, one rain, one deep rumble. They only ever glide, and are silent to begin with.
    const bed = (color, filters, q = 0.7) => {
      const s = c.createBufferSource(); s.buffer = audio.noise[color]; s.loop = true;
      let n = s; for (const [type, f] of filters) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; n.connect(b); n = b; }
      const g = c.createGain(); g.gain.value = 0; n.connect(g); g.connect(this.bus); s.start(t, Math.random() * 3);
      return { s, g };
    };
    this.water = bed('brown', [['lowpass', 720], ['highpass', 90]]);
    this.rain = bed('pink', [['bandpass', 2600]], 0.5);
    this.rumble = bed('brown', [['lowpass', 150]]);
    // a slow swell in the river, so it moves rather than hisses
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 0.17; const lg = c.createGain(); lg.gain.value = 0; this.lfo.connect(lg); lg.connect(this.water.g.gain); this.lfo.start(t); this.lfoG = lg;
    this.group = null;
    // the drone comes in and out with the warm plates
    this.tanOn = false; this.tanTimer = setInterval(() => { if (this.tanOn && this.m) this.m.tanpuraAhead(this.ctx.currentTime, 2.1, 0.25); }, 400);
  }
  // A plate's own sounds run through a group of their own, so turning the page early cuts them cleanly
  fresh() {
    const c = this.ctx, t = c.currentTime;
    if (this.group) { const o = this.group; o.gain.cancelScheduledValues(t); o.gain.setValueAtTime(o.gain.value, t); o.gain.linearRampToValueAtTime(0, t + 0.3); setTimeout(() => o.disconnect(), 500); }
    for (const id of this.timers) clearTimeout(id); this.timers.length = 0;
    const g = this.group = c.createGain(); g.connect(this.bus);
    const mus = this.m ? c.createGain() : null; if (this.mus) { const o = this.mus; o.gain.cancelScheduledValues(t); o.gain.setValueAtTime(o.gain.value, t); o.gain.linearRampToValueAtTime(0, t + 0.5); setTimeout(() => o.disconnect(), 700); }
    if (mus) mus.connect(this.m.flG); this.mus = mus;
    return g;
  }
  level(bed, v, fade = 1.2) { const t = this.ctx.currentTime; bed.g.gain.cancelScheduledValues(t); bed.g.gain.setTargetAtTime(v, t, fade * 0.35); }
  drone(on) { if (!this.m) return; this.tanOn = on; const t = this.ctx.currentTime; this.m.tanG.gain.cancelScheduledValues(t); this.m.tanG.gain.setTargetAtTime(on ? 0.22 : 0, t, on ? 1.2 : 0.3); }
  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  // ---------------------------------------------------------------- small sounds
  rollOfThunder(g, t, level, len = 4) {
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.a.noise.brown;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
    const e = c.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(level, t + 0.5);
    for (let k = 1; k < 4; k++) e.gain.linearRampToValueAtTime(level * (0.4 + 0.5 / k), t + 0.5 + k * len * 0.2);
    e.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f); f.connect(e); e.connect(g); n.start(t, Math.random() * 3); n.stop(t + len + 0.1);
  }
  // a bullock's neck bell: two bright partials that fade quickly
  bell(g, t, f, v) { for (const [m, k] of [[1, 1], [2.76, 0.4]]) this.a.tone(g, t, { f0: f * m, dur: 0.5, a: 0.002, r: 0.48, g: v * k }); }
  // an axle working: a dull wooden knock with a small complaint after it
  creak(g, t, v) { this.a.noiseBurst(g, t, { f: 240, q: 2.5, dur: 0.11, g: v, color: 'brown' }); this.a.tone(g, t + 0.05, { f0: 170, f1: 138, dur: 0.22, a: 0.03, g: v * 0.14, type: 'sawtooth', filt: [['lowpass', 500]] }); }
  // Her voice, not an instrument: a closed-mouth hum, a low voice on the lullaby's own notes, gliding a little between them
  hum(g, t, semi, dur, v, to) {
    const f0 = hz(semi) * 0.5, pts = []; if (to !== undefined) pts.push([dur * 0.85, f0], [dur, hz(to) * 0.5]);
    this.a.formant(g, t, { f0, pts: pts.length ? pts : undefined, dur, a: 0.14, sus: 0.85, g: v, vib: [4.6, 1.4], forms: [[260, 5, 1], [520, 6, 0.26], [1050, 6, 0.07]] });
  }
  // a wolf breathing at something
  sniff(g, t, v) { for (let i = 0; i < 3; i++) this.a.noiseBurst(g, t + i * 0.17, { f: 1700, q: 1.2, dur: 0.1, a: 0.02, g: v, color: 'pink' }); }
  huff(g, t, v) { this.a.noiseBurst(g, t, { f: 480, f1: 240, q: 0.9, dur: 0.34, a: 0.03, g: v, color: 'pink' }); }
  // morning birds, far off
  bird(g, t, f, v) { this.a.tone(g, t, { f0: f, f1: f * 1.24, dur: 0.16, a: 0.02, g: v }); this.a.tone(g, t + 0.21, { f0: f * 1.18, f1: f * 0.92, dur: 0.24, a: 0.02, g: v * 0.8 }); }
  // a paw on soft ground
  pad(g, t, v) { this.a.noiseBurst(g, t, { f: 300, q: 1, dur: 0.09, a: 0.01, g: v, color: 'brown' }); }

  // ---------------------------------------------------------------- the score, plate by plate
  plate(n) {
    const g = this.fresh(), now = this.ctx.currentTime + 0.05, M = this.m, mus = this.mus;
    this.lfoG.gain.setTargetAtTime(0, now, 0.3);
    switch (n) {
      case 0: {   // the hills, a long way off: light rain, one far thunder, and the bana begins the telling
        this.level(this.rain, 0.018, 2); this.level(this.water, 0, 1); this.level(this.rumble, 0, 1); this.drone(false);
        this.rollOfThunder(g, now + 2.3, 0.1, 3.4);
        if (M) M.banaPhrase([{ semi: 0, dur: 1.6 }, { semi: 2, dur: 1, meend: true }, { semi: 0, dur: 0.9 }, { semi: -3, dur: 1.9, meend: true }], now + 0.5, { gain: 0.06, dest: mus });
        break;
      }
      case 1: {   // going home: bells in step with the bullocks, an axle, the drone. The warmest it ever is.
        this.level(this.rain, 0.008, 1.5); this.level(this.water, 0.012, 1.5); this.drone(true);
        for (let i = 0; i < 12; i++) { const t = now + 0.2 + i * 0.58; this.bell(g, t, i % 2 ? 1490 : 1760, 0.016); if (i % 4 === 2) this.creak(g, t + 0.2, 0.06); }
        if (M) M.banaPhrase([{ semi: 0, dur: 1.1 }, { semi: 2, dur: 0.9 }, { semi: 4, dur: 1.2, meend: true }, { semi: 2, dur: 0.8 }, { semi: 0, dur: 1.9, meend: true }], now + 0.8, { gain: 0.055, dest: mus });
        break;
      }
      case 2: {   // the water: everything warm stops at once. It comes up from underneath, and keeps coming.
        this.drone(false); this.level(this.rain, 0.03, 1); this.level(this.water, 0.1, 3); this.level(this.rumble, 0.24, 4.2);
        this.rollOfThunder(g, now + 0.25, 0.2, 3.6);
        break;
      }
      case 3: {   // in it: the river close and huge, and over it the cloth pulled tight, again and again
        this.level(this.rain, 0.022, 1); this.level(this.water, 0.13, 0.6); this.level(this.rumble, 0.15, 1); this.lfoG.gain.setTargetAtTime(0.03, now, 0.4);
        for (let i = 0; i < 4; i++) { const t = now + 1 + i * 1.5; this.a.noiseBurst(g, t, { f: 900, f1: 500, q: 1.5, dur: 0.24, a: 0.06, g: 0.06, color: 'pink' }); this.a.noiseBurst(g, t + 0.22, { f: 300, q: 2, dur: 0.07, g: 0.08, color: 'brown' }); }
        break;
      }
      case 4: {   // she hums. The river falls away so that there is only her, close. She starts the four notes again and does not finish them.
        this.level(this.rain, 0, 1); this.level(this.rumble, 0.02, 0.8); this.level(this.water, 0.026, 0.8);
        const D = [0.85, 0.85, 0.85, 2.2], T = THEME; let t = now + 0.7;
        for (let i = 0; i < 4; i++) { this.hum(g, t, T[i], D[i] + 0.12, 0.2, i < 3 ? T[i + 1] : undefined); t += D[i]; }
        t += 0.35;
        for (let i = 0; i < 2; i++) { this.hum(g, t, T[i], D[i] + 0.12, 0.17, i < 1 ? T[i + 1] : undefined); t += D[i]; }
        // the third note begins, and the water closes over it
        const end = t; this.a.formant(g, end, { f0: hz(T[2]) * 0.5, dur: 0.48, a: 0.1, sus: 0.7, g: 0.13, vib: [4.6, 1.4], forms: [[260, 5, 1], [520, 6, 0.26]] });
        this.later((end - this.ctx.currentTime + 0.1) * 1000, () => { this.level(this.water, 0.14, 0.35); this.later(900, () => this.level(this.water, 0.02, 1.8)); });
        break;
      }
      case 5: {   // afterward: only a little water against a log, and silence. The first thing he has to hold on to: one far flute.
        this.level(this.rumble, 0, 1); this.level(this.water, 0.014, 1.5); this.lfoG.gain.setTargetAtTime(0.008, now, 0.5);
        if (M) M.flutePhrase([{ semi: T0(0), dur: 2.6 }, { semi: T0(3), dur: 2.2, meend: true }], now + 2, { gain: 0.05, dest: mus });
        break;
      }
      case 6: {   // morning: birds, the bana again, and a wolf, breathing in the scent of him. She comes close and huffs.
        this.level(this.water, 0.008, 1.5); this.drone(true);
        [[0.8, 2100], [2.2, 2500], [5.2, 2300], [8.6, 2050]].forEach(([d, f]) => this.bird(g, now + d, f, 0.012));
        this.sniff(g, now + 3.1, 0.05); this.sniff(g, now + 4.7, 0.06); this.huff(g, now + 5.9, 0.08);
        if (M) M.banaPhrase([{ semi: -3, dur: 1.5 }, { semi: 0, dur: 1.5, meend: true }, { semi: 2, dur: 1.2 }, { semi: 0, dur: 2.4, meend: true }], now + 1.5, { gain: 0.045, dest: mus });
        break;
      }
      case 7: {   // she carries him home, soft-footed, and at last the four notes on the flute, whole, with the phrase she never finished
        this.level(this.water, 0, 2); this.drone(true);
        for (let i = 0; i < 12; i++) this.pad(g, now + 0.3 + i * 0.52, i % 2 ? 0.04 : 0.055);
        if (M) M.flutePhrase(THEME.map((s, k) => ({ semi: s, dur: k === 3 ? 1.5 : 0.82, meend: k === 2 })).concat([{ semi: 0, dur: 2.2, meend: true }]), now + 1.2, { gain: 0.11, dest: mus });
        break;
      }
    }
  }
  // the title: the drone alone, thinning out
  title() { this.fresh(); this.level(this.water, 0, 1); }
  stop(fade = 0.8) {
    const c = this.ctx, t = c.currentTime;
    for (const id of this.timers) clearTimeout(id); this.timers.length = 0; clearInterval(this.tanTimer);
    this.drone(false);
    const b = this.bus; b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0, t + fade);
    if (this.mus) { const o = this.mus; o.gain.cancelScheduledValues(t); o.gain.setValueAtTime(o.gain.value, t); o.gain.linearRampToValueAtTime(0, t + fade); }
    const mus = this.mus;
    setTimeout(() => { for (const B of [this.water, this.rain, this.rumble]) { try { B.s.stop(); } catch (e) { /* already stopped */ } } try { this.lfo.stop(); } catch (e) { /* already stopped */ } b.disconnect(); if (mus) mus.disconnect(); }, (fade + 0.2) * 1000);
  }
}
const T0 = (i) => THEME[i];

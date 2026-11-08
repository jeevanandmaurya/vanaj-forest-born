// Score built from models of real central-Indian instruments — no synth pads.
//  • Bansuri (bamboo flute): sine/odd-harmonic core + pitched breath noise, chiff, meend glides, delayed vibrato.
//  • Tanpura: offline Karplus-Strong strings with a jawari (buzzing-bridge) nonlinearity and gourd resonances.
//  • Bana (Pardhan 3-string bowed fiddle): bowed sawtooth through body resonances + bow noise.
//  • Mandar (Baiga clay double-drum), timki, manjira: modal synthesis rendered to buffers.
// Ragas follow samay (time of day); monsoon uses Malhar. Alap phrases are generated from each raga's
// scale, vadi/samvadi and pakad. Combat plays a Keherwa cycle that resolves with a tihai.

const RAGAS = {
  bhairav: { notes: [0, 1, 4, 5, 7, 8, 11], vadi: 8, samvadi: 1, pakad: [[0, 4, 5, 7, 5, 4, 1, 0], [4, 5, 8, 8, 7], [7, 8, 11, 12, 8, 7]], tan: [7, 0, 0, -12] },
  bilawal: { notes: [0, 2, 4, 5, 7, 9, 11], vadi: 9, samvadi: 4, pakad: [[0, 2, 4, 7, 9, 7], [9, 7, 4, 2, 0], [4, 7, 9, 12, 11, 9]], tan: [7, 0, 0, -12] },
  sarang: { notes: [0, 2, 5, 7, 10, 11], vadi: 2, samvadi: 7, pakad: [[-2, 0, 2, 5, 2], [7, 5, 2, 0], [10, 7, 5, 2, 0], [11, 12, 10, 7]], tan: [7, 0, 0, -12] },
  multani: { notes: [0, 1, 3, 6, 7, 8, 11], vadi: 7, samvadi: 0, pakad: [[-1, 0, 3, 6, 7], [6, 3, 1, 0], [7, 8, 7, 6, 3]], tan: [7, 0, 0, -12] },
  yaman: { notes: [0, 2, 4, 6, 7, 9, 11], vadi: 4, samvadi: 11, pakad: [[-1, 2, 4, 2, 0], [7, 6, 4, 2, 0], [-1, 2, 4, 6, 7], [4, 6, 9, 11, 12]], tan: [7, 0, 0, -12] },
  bageshree: { notes: [0, 2, 3, 5, 9, 10], vadi: 5, samvadi: 0, pakad: [[12, 10, 9, 5, 9, 10, 12], [5, 3, 2, 0], [0, 3, 5, 9, 10, 9, 5]], tan: [5, 0, 0, -12] },
  malkauns: { notes: [0, 3, 5, 8, 10], vadi: 5, samvadi: 0, pakad: [[0, 3, 5, 8, 10, 8, 5, 3, 5, 3, 0], [-2, 0, 5, 3, 0], [8, 10, 12, 10, 8, 5]], tan: [5, 0, 0, -12] },
  megh: { notes: [0, 2, 5, 7, 10], vadi: 0, samvadi: 7, pakad: [[2, 5, 7, 10, 7, 5, 2], [5, 2, 0], [-2, 0, 2, 5, 2, 0]], tan: [7, 0, 0, -12] },
  bhoopali: { notes: [0, 2, 4, 7, 9], vadi: 4, samvadi: 9, pakad: [[4, 2, 0, -3, 0, 2, 4], [7, 4, 9, 7, 4, 2, 0]], tan: [7, 0, 0, -12] },
};
export const THEME = [4, 2, 0, -3]; // the four notes (Ga Re Sa Dha) — Vanaj's mother's lullaby
const THEME_ANSWER = [0, 2, 4, 7, 4, 2, 0, -3, 0];

export function ragaForTime(hour, season) {
  if (season === 'monsoon') return 'megh';
  if (hour >= 4 && hour < 7) return 'bhairav';
  if (hour >= 7 && hour < 12) return 'bilawal';
  if (hour >= 12 && hour < 16) return 'sarang';
  if (hour >= 16 && hour < 19) return 'multani';
  if (hour >= 19 && hour < 22) return 'yaman';
  if (hour >= 22 || hour < 1) return 'bageshree';
  return 'malkauns';
}

const SA = 146.83; // D3 tanpura Sa; bansuri plays one octave up (D4)
const hz = (semi, oct = 0) => SA * Math.pow(2, semi / 12 + oct);

export class Music {
  constructor(audio) {
    this.a = audio; this.ctx = audio.ctx; this.out = audio.music;
    this.mode = 'silence'; this.session = null; this.nextSession = 25; this.combat = 0; this.combatOn = false;
    this.buffers = {}; this.raga = 'bilawal'; this.alapLevel = 0;
    this.tanG = this.ctx.createGain(); this.tanG.gain.value = 0; this.tanG.connect(this.out);
    const tsend = this.ctx.createGain(); tsend.gain.value = 0.5; this.tanG.connect(tsend); tsend.connect(audio.verbSend);
    this.flG = this.ctx.createGain(); this.flG.gain.value = 0.9; this.flG.connect(this.out);
    const fsend = this.ctx.createGain(); fsend.gain.value = 0.9; this.flG.connect(fsend); fsend.connect(audio.verbSend);
    this.drG = this.ctx.createGain(); this.drG.gain.value = 0; this.drG.connect(this.out);
    const dsend = this.ctx.createGain(); dsend.gain.value = 0.3; this.drG.connect(dsend); dsend.connect(audio.verbSend);
    this.render();
    this.tanT = 0; this.tanIdx = 0; this.beat = 0; this.beatT = 0; this.cycle = 0;
    this.queue = []; // scheduled phrase end times
    this.flBusyUntil = 0;
  }
  // ------------------------------------------------------------------ offline instrument rendering
  render() {
    const sr = this.ctx.sampleRate;
    const mk = (data) => { const b = this.ctx.createBuffer(1, data.length, sr); b.getChannelData(0).set(data); return b; };
    const tanString = (freq, dur, jw) => {
      const N = Math.floor(sr * dur), out = new Float32Array(N);
      const L = sr / freq, size = Math.ceil(L) + 8, buf = new Float32Array(size);
      // pluck excitation: lowpassed noise, plucked near the bridge
      let lp = 0; for (let i = 0; i < size; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.5; buf[i] = lp; }
      let w = 0, prev = 0;
      for (let n = 0; n < N; n++) {
        // jawari: the string grazes the curved bridge, effectively shortening it in proportion to displacement
        const y = buf[w];
        const eff = L * (1 - jw * Math.min(1, Math.abs(y) * 3.0));
        let rp = w - eff; while (rp < 0) rp += size;
        const i0 = Math.floor(rp), fr = rp - i0, i1 = (i0 + 1) % size;
        const s = buf[i0] * (1 - fr) + buf[i1] * fr;
        const filt = 0.5 * (s + prev) * 0.9985; prev = s;
        buf[w] = filt + 0.02 * filt * Math.abs(filt);
        out[n] = s;
        w = (w + 1) % size;
      }
      // gourd body resonances (two-pole resonators)
      const res = (f, r, g) => { const c = 2 * r * Math.cos(2 * Math.PI * f / sr); let y1 = 0, y2 = 0; const o = new Float32Array(N); for (let n = 0; n < N; n++) { const y = out[n] + c * y1 - r * r * y2; y2 = y1; y1 = y; o[n] = y * g; } return o; };
      const r1 = res(190, 0.995, 0.004), r2 = res(520, 0.99, 0.006);
      let mx = 0; for (let n = 0; n < N; n++) { out[n] = out[n] * 0.8 + r1[n] + r2[n]; mx = Math.max(mx, Math.abs(out[n])); }
      for (let n = 0; n < N; n++) out[n] = out[n] / mx * 0.8 * Math.min(1, n / 200);
      return mk(out);
    };
    this.buffers.tan = {
      pa: tanString(hz(7, -1), 6, 0.0035), ma: tanString(hz(5, -1), 6, 0.0035), ni: tanString(hz(11, -1), 6, 0.0035),
      sa: tanString(hz(0), 6, 0.003), saLow: tanString(hz(0, -1), 6, 0.004),
    };
    // drums
    const drum = (f, modes, decay, noiseAmt, noiseF, drop, dur) => {
      const N = Math.floor(sr * dur), out = new Float32Array(N);
      const ph = modes.map(() => Math.random() * 6.28);
      let nlp = 0;
      for (let n = 0; n < N; n++) {
        const t = n / sr; let s = 0;
        const fm = 1 + drop * Math.exp(-t * 28);
        for (let k = 0; k < modes.length; k++) { const [ratio, amp, dk] = modes[k]; ph[k] += 2 * Math.PI * f * ratio * fm / sr; s += Math.sin(ph[k]) * amp * Math.exp(-t / (decay * dk)); }
        nlp += ((Math.random() * 2 - 1) - nlp) * noiseF;
        s += nlp * noiseAmt * Math.exp(-t * 60);
        out[n] = s * Math.min(1, n / 30);
      }
      let mx = 0; for (let n = 0; n < N; n++) mx = Math.max(mx, Math.abs(out[n])); for (let n = 0; n < N; n++) out[n] /= mx;
      return mk(out);
    };
    const MEMB = [[1, 1, 1], [1.59, 0.5, 0.7], [2.14, 0.35, 0.5], [2.3, 0.3, 0.45], [2.65, 0.2, 0.4], [2.92, 0.15, 0.3], [3.16, 0.1, 0.25]];
    this.buffers.dhum = drum(68, MEMB, 0.42, 0.25, 0.15, 0.35, 1.2);   // mandar bass head
    this.buffers.ta = drum(240, MEMB.slice(0, 5), 0.11, 0.8, 0.5, 0.12, 0.5);  // mandar treble slap
    this.buffers.tin = drum(480, [[1, 1, 1], [2.0, 0.5, 0.8], [3.0, 0.25, 0.6]], 0.35, 0.3, 0.6, 0.04, 0.9); // ringing rim
    this.buffers.timki = drum(360, MEMB.slice(0, 4), 0.07, 1.0, 0.6, 0.2, 0.3);
    const metal = (f, dur, damp) => drum(f, [[1, 1, 1], [2.76, 0.7, 0.8], [5.4, 0.5, 0.6], [8.93, 0.35, 0.5], [13.3, 0.2, 0.4]], damp, 0.15, 0.9, 0, dur);
    this.buffers.manjira = metal(1650, 2.2, 0.9); this.buffers.chik = metal(1650, 0.25, 0.04);
  }
  // A group for phrases scheduled ahead (a scene's score): pass cue.dest as a phrase's dest, and cue.stop()
  // fades everything still sounding or still to come in that group, e.g. when the scene is skipped.
  cue() {
    const g = this.ctx.createGain(); g.connect(this.flG);
    return { dest: g, stop: (fade = 0.25) => { const t = this.ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); setTimeout(() => g.disconnect(), (fade + 0.2) * 1000); } };
  }
  play(buf, t, gain, rate = 1, dest) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(dest || this.drG); s.start(t);
    return s;
  }
  // ------------------------------------------------------------------ bansuri voice
  flutePhrase(notes, t0, opts = {}) {
    // notes: [{semi, dur, meend}], octave offset 1 (D4)
    const ctx = this.ctx;
    const oct = opts.oct ?? 1;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    const h3 = ctx.createOscillator(); h3.type = 'sine';
    const h3g = ctx.createGain(); h3g.gain.value = 0.12;
    const env = ctx.createGain(); env.gain.value = 0;
    const tone = ctx.createGain(); tone.gain.value = 0.55;
    osc.connect(tone); h3.connect(h3g); h3g.connect(tone); tone.connect(env);
    // breath noise, band-limited around the sounding pitch
    const nz = ctx.createBufferSource(); nz.buffer = this.a.noise.white; nz.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
    const air = ctx.createBiquadFilter(); air.type = 'highpass'; air.frequency.value = 3000;
    const nzg = ctx.createGain(); nzg.gain.value = 0.22; const airg = ctx.createGain(); airg.gain.value = 0.025;
    nz.connect(bp); bp.connect(nzg); nzg.connect(env); nz.connect(air); air.connect(airg); airg.connect(env);
    // vibrato
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.value = 0;
    vib.connect(vg); vg.connect(osc.frequency);
    const vg3 = ctx.createGain(); vg3.gain.value = 0; vib.connect(vg3); vg3.connect(h3.frequency);
    const out = ctx.createGain(); out.gain.value = opts.gain ?? 0.16; env.connect(out); out.connect(opts.dest || this.flG);
    let t = t0;
    const f0 = hz(notes[0].semi, oct);
    osc.frequency.setValueAtTime(f0, t); h3.frequency.setValueAtTime(f0 * 3, t); bp.frequency.setValueAtTime(f0, t);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + 0.12);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], f = hz(n.semi, oct);
      if (i > 0) {
        if (n.meend) {
          const fp = hz(notes[i - 1].semi, oct);
          osc.frequency.setValueAtTime(fp, t); h3.frequency.setValueAtTime(fp * 3, t); bp.frequency.setValueAtTime(fp, t);
          osc.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.35, n.dur * 0.5));
          h3.frequency.exponentialRampToValueAtTime(f * 3, t + Math.min(0.35, n.dur * 0.5));
          bp.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.35, n.dur * 0.5));
        } else {
          // tongued articulation: small dip + chiff
          osc.frequency.setValueAtTime(f, t); h3.frequency.setValueAtTime(f * 3, t); bp.frequency.setValueAtTime(f, t);
          env.gain.setValueAtTime(0.55, t); env.gain.linearRampToValueAtTime(1, t + 0.06);
          nzg.gain.setValueAtTime(0.6, t); nzg.gain.exponentialRampToValueAtTime(0.22, t + 0.07);
        }
      }
      // delayed vibrato on long notes
      if (n.dur > 0.9) { vg.gain.setValueAtTime(0, t + 0.3); vg.gain.linearRampToValueAtTime(f * 0.009, t + n.dur * 0.8); vg3.gain.setValueAtTime(0, t + 0.3); vg3.gain.linearRampToValueAtTime(f * 0.027, t + n.dur * 0.8); vg.gain.setValueAtTime(0, t + n.dur); vg3.gain.setValueAtTime(0, t + n.dur); }
      // dynamic swell inside each note
      const peak = n.accent ? 1.15 : 1;
      env.gain.linearRampToValueAtTime(peak, t + n.dur * 0.4);
      t += n.dur;
    }
    env.gain.linearRampToValueAtTime(0.0, t + 0.5);
    for (const s of [osc, h3, nz, vib]) { s.start(t0); s.stop(t + 0.7); }
    return t + 0.5;
  }
  // ------------------------------------------------------------------ bana (bowed fiddle) voice
  banaPhrase(notes, t0, opts = {}) {
    const ctx = this.ctx, oct = opts.oct ?? 0;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.5;
    const body = [[290, 4, 6], [560, 5, 5], [1250, 4, 4], [2600, 3, -6]].map(([f, q, g]) => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; });
    const env = ctx.createGain(); env.gain.value = 0;
    let n = osc; n.connect(lp); n = lp; for (const b of body) { n.connect(b); n = b; }
    n.connect(env);
    const nz = ctx.createBufferSource(); nz.buffer = this.a.noise.pink; nz.loop = true; const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8; const ng = ctx.createGain(); ng.gain.value = 0.05; nz.connect(nf); nf.connect(ng); ng.connect(env);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.6; const vg = ctx.createGain(); vg.gain.value = 0; vib.connect(vg); vg.connect(osc.frequency);
    // drone string (Sa) bowed together
    const dr = ctx.createOscillator(); dr.type = 'sawtooth'; dr.frequency.value = hz(0, oct - 1); const dg = ctx.createGain(); dg.gain.value = 0.18; const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 900; dr.connect(dlp); dlp.connect(dg); dg.connect(env);
    const out = ctx.createGain(); out.gain.value = opts.gain ?? 0.07; env.connect(out); out.connect(opts.dest || this.flG);
    let t = t0;
    osc.frequency.setValueAtTime(hz(notes[0].semi, oct), t);
    env.gain.setValueAtTime(0, t);
    for (let i = 0; i < notes.length; i++) {
      const nn = notes[i], f = hz(nn.semi, oct);
      if (i > 0) { if (nn.meend) { osc.frequency.setValueAtTime(hz(notes[i - 1].semi, oct), t); osc.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.3, nn.dur * 0.5)); } else osc.frequency.setValueAtTime(f, t); }
      // bow stroke: pressure swell
      env.gain.setValueAtTime(i === 0 ? 0 : 0.5, t); env.gain.linearRampToValueAtTime(opts.stacc ? 1 : 0.9, t + (opts.stacc ? 0.03 : 0.15)); env.gain.linearRampToValueAtTime(opts.stacc ? 0.2 : 0.75, t + nn.dur * 0.95);
      if (nn.dur > 0.8) { vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(f * 0.012, t + nn.dur); }
      t += nn.dur;
    }
    env.gain.linearRampToValueAtTime(0, t + 0.4);
    for (const s of [osc, nz, vib, dr]) { s.start(t0); s.stop(t + 0.6); }
    return t + 0.4;
  }
  // ------------------------------------------------------------------ alap generator
  makeAlap(ragaName, level) {
    const R = RAGAS[ragaName];
    const scale = [];
    for (let o = -1; o <= 1; o++) for (const s of R.notes) scale.push(s + o * 12);
    scale.push(24);
    scale.sort((a, b) => a - b);
    const nearest = (semi) => { let bi = 0, bd = 1e9; for (let i = 0; i < scale.length; i++) { const d = Math.abs(scale[i] - semi); if (d < bd) { bd = d; bi = i; } } return bi; };
    const lo = -5, hi = 5 + level * 9; // range expands as the alap develops
    let notes = [];
    if (Math.random() < 0.35) {
      const p = R.pakad[Math.floor(Math.random() * R.pakad.length)];
      const shift = level > 0.6 && Math.random() < 0.5 ? 12 : 0;
      notes = p.map((s) => ({ semi: s + shift, dur: 0.3 + Math.random() * 0.5, meend: Math.random() < 0.4 }));
    } else {
      let idx = nearest(this.lastSemi ?? (Math.random() < 0.5 ? 0 : R.vadi));
      const n = 3 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        let step = r < 0.42 ? 1 : r < 0.8 ? -1 : r < 0.9 ? 2 : -2;
        if (scale[idx] > hi) step = -Math.abs(step); if (scale[idx] < lo) step = Math.abs(step);
        idx = Math.max(0, Math.min(scale.length - 1, idx + step));
        notes.push({ semi: scale[idx], dur: 0.3 + Math.random() * 0.6, meend: Math.random() < 0.38 });
      }
    }
    // resting note (nyas): Sa, Pa/Ma, vadi or samvadi
    const nyas = [0, R.vadi, R.samvadi, R.notes.includes(7) ? 7 : 5, 12];
    const target = nyas[Math.floor(Math.random() * nyas.length)];
    const cand = [target - 12, target, target + 12].filter((s) => s >= lo - 2 && s <= hi + 3);
    const fin = cand.length ? cand.reduce((a, b) => Math.abs(b - (notes[notes.length - 1]?.semi ?? 0)) < Math.abs(a - (notes[notes.length - 1]?.semi ?? 0)) ? b : a) : 0;
    notes.push({ semi: fin, dur: 1.4 + Math.random() * 2.4, meend: Math.random() < 0.6, accent: true });
    this.lastSemi = fin;
    return notes;
  }
  // ------------------------------------------------------------------ tanpura
  tanpuraTick(t) {
    const R = RAGAS[this.raga];
    const first = R.tan[0] === 5 ? 'ma' : R.notes.includes(7) ? 'pa' : R.notes.includes(5) ? 'ma' : 'ni';
    const order = [first, 'sa', 'sa', 'saLow'];
    const b = this.buffers.tan[order[this.tanIdx % 4]];
    this.play(b, t, 0.45 + Math.random() * 0.08, 1 + (Math.random() - 0.5) * 0.002, this.tanG);
    this.tanIdx++;
  }
  // ------------------------------------------------------------------ public
  stinger(kind) {
    const t = this.ctx.currentTime + 0.1;
    if (kind === 'clue') {
      this.tanG.gain.cancelScheduledValues(t); this.tanG.gain.setTargetAtTime(0.5, t, 0.8);
      const end = this.flutePhrase(THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 2.2 : 0.55, meend: i > 0 && Math.random() < 0.5 })), t, { gain: 0.2 });
      this.flBusyUntil = end + 1;
      this.tanG.gain.setTargetAtTime(0, end + 2, 2);
    } else if (kind === 'chapter') {
      this.play(this.buffers.dhum, t, 0.9, 1, this.out);
      this.banaPhrase(THEME.concat([0]).map((s, i) => ({ semi: s, dur: i === 4 ? 2.5 : 0.7, meend: i === 2 })), t + 0.6, { oct: 0, gain: 0.09 });
    } else if (kind === 'death') {
      this.banaPhrase([{ semi: 0, dur: 1 }, { semi: -1, dur: 0.8, meend: true }, { semi: -4, dur: 2.5, meend: true }], t, { gain: 0.1 });
      this.play(this.buffers.dhum, t, 0.8, 0.85, this.out);
    } else if (kind === 'theme' || kind === 'answer') {
      const notes = (kind === 'theme' ? THEME : THEME.concat(THEME_ANSWER)).map((s, i, arr) => ({ semi: s, dur: i === arr.length - 1 ? 2.6 : i === 3 ? 1.2 : 0.5, meend: i > 0 && Math.random() < 0.3 }));
      return this.flutePhrase(notes, t, { gain: 0.24 });
    } else if (kind === 'kill') {
      this.play(this.buffers.dhum, t, 1.0, 0.9, this.out); this.play(this.buffers.manjira, t, 0.3, 1, this.out);
    } else if (kind === 'ending') {
      this.tanG.gain.setTargetAtTime(0.6, t, 1.5);
      let tt = t + 2;
      tt = this.flutePhrase(THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 2 : 0.6 })), tt, { gain: 0.22 }) + 1.5;
      tt = this.flutePhrase(THEME_ANSWER.map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 4 : 0.55, meend: i % 3 === 2 })), tt, { gain: 0.22 }) + 2;
      this.banaPhrase([0, 2, 4, 7, 9, 7, 4, 2, 0].map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 4 : 0.9, meend: i % 2 === 1 })), tt, { gain: 0.08 });
      this.flBusyUntil = tt + 12;
    }
  }
  // The main menu: a tanpura drone and a bansuri alone in the morning forest. It opens on the lullaby (the four
  // notes the story turns on), then wanders in Bilawal, the morning raga, returning to the lullaby now and then.
  // Everything runs through one bus, so leaving the menu fades it out whole.
  titleStart() {
    if (this.titleBus) return;
    const t = this.ctx.currentTime;
    this.titleBus = this.cue(); this.titleBus.dest.gain.value = 1;
    this.titleNext = t + 1.2; this.titleCount = 0; this.tanT = 0; this.raga = 'bilawal'; this.lastSemi = 0;
    this.tanG.gain.cancelScheduledValues(t); this.tanG.gain.setTargetAtTime(0.3, t, 1.5);
  }
  titleUpdate(dt) {
    if (!this.titleBus || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.tanT -= dt;
    if (this.tanT <= 0) { this.tanT = 1.25; this.tanpuraTick(t + 0.02); }
    if (t < this.titleNext) return;
    const n = this.titleCount++, opts = { gain: 0.17, dest: this.titleBus.dest };
    let notes;
    if (n % 5 === 0) notes = THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 2.6 : 0.75, meend: i > 0 }));
    else if (n % 5 === 3) notes = THEME_ANSWER.map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 3 : 0.55, meend: i % 3 === 2 }));
    else notes = this.makeAlap('bilawal', Math.min(0.7, n * 0.08));
    this.titleNext = this.flutePhrase(notes, t + 0.05, opts) + 2 + Math.random() * 3;
  }
  titleStop(fade = 1.2) {
    if (!this.titleBus) return;
    this.titleBus.stop(fade); this.titleBus = null;
    this.tanG.gain.setTargetAtTime(0, this.ctx.currentTime, fade * 0.4);
    this.nextSession = 25;
  }
  setCombat(level) { this.combat = level; }
  update(dt, hour, season, opts = {}) {
    const t = this.ctx.currentTime;
    const raga = ragaForTime(hour, season);
    // combat percussion
    const wantCombat = this.combat > 0.05;
    if (wantCombat && !this.combatOn) { this.combatOn = true; this.beat = 0; this.beatT = t + 0.05; this.drG.gain.setTargetAtTime(0.55, t, 0.3); this.tanG.gain.setTargetAtTime(0.35, t, 0.5); }
    if (!wantCombat && this.combatOn) {
      this.combatOn = false;
      // tihai: a phrase played three times landing on sam
      const bp = 60 / 140; let tt = Math.max(this.beatT, t + 0.05);
      for (let r = 0; r < 3; r++) for (const [b, k] of [[0, 'dhum'], [0.5, 'ta'], [1, 'ta'], [1.5, 'tin']]) this.play(this.buffers[k], tt + (r * 2 + b) * bp, 0.7);
      this.play(this.buffers.dhum, tt + 6 * bp, 1); this.play(this.buffers.manjira, tt + 6 * bp, 0.35);
      this.drG.gain.setTargetAtTime(0, tt + 7 * bp, 0.6); this.tanG.gain.setTargetAtTime(0, tt + 7 * bp, 2);
    }
    if (this.combatOn) {
      const bpm = 128 + this.combat * 30, bp = 60 / bpm;
      // Keherwa: Dha Ge Na Ti | Na Ka Dhi Na  (mapped to mandar strokes)
      const pat = ['dhum', 'ta', 'ta', 'tin', 'ta', 'timki', 'dhum', 'ta'];
      while (this.beatT < t + 0.25) {
        const b = this.beat % 8, k = pat[b];
        this.play(this.buffers[k], this.beatT, k === 'dhum' ? 0.9 : 0.55, 1);
        if (this.combat > 0.4) this.play(this.buffers.timki, this.beatT + bp / 2, 0.25 + Math.random() * 0.15);
        if (b === 0 || b === 4) this.play(this.buffers[b === 0 ? 'manjira' : 'chik'], this.beatT, 0.18);
        if (b === 0 && this.combat > 0.55 && this.beat % 16 === 0) {
          const R = RAGAS[raga === 'megh' ? 'malkauns' : (hour > 6 && hour < 18 ? 'bhairav' : 'malkauns')];
          const ost = [0, R.notes[1], 0, -1 + (R.notes.includes(11) ? 0 : -1), 0, R.notes[2], R.notes[1], 0].map((s) => ({ semi: s, dur: bp }));
          this.banaPhrase(ost, this.beatT, { oct: 0, gain: 0.06, stacc: true });
        }
        this.beatT += bp; this.beat++;
      }
      this.tanT -= dt;
      if (this.tanT <= 0) { this.tanT = 1.25; this.raga = raga; this.tanpuraTick(t + 0.02); }
      return;
    }
    // exploration sessions: long silences, then an alap over tanpura
    if (!this.session) {
      if (opts.suppress) return;
      this.nextSession -= dt;
      if (this.nextSession <= 0 && t > this.flBusyUntil) {
        this.raga = raga;
        this.session = { start: t, end: t + 70 + Math.random() * 50, nextPhrase: t + 7, level: 0, inst: (hour > 21 || hour < 4) && Math.random() < 0.35 ? 'bana' : 'flute' };
        this.tanG.gain.cancelScheduledValues(t); this.tanG.gain.setTargetAtTime(0.42, t, 2.5);
        this.lastSemi = 0;
      }
      return;
    }
    const S = this.session;
    this.tanT -= dt;
    if (this.tanT <= 0) { this.tanT = 1.2 + Math.random() * 0.15; this.tanpuraTick(t + 0.02); }
    if (t > S.end) {
      if (t > S.nextPhrase) { // closing: descend to Sa
        this.tanG.gain.setTargetAtTime(0, t + 2, 3);
        this.session = null; this.nextSession = 120 + Math.random() * 160; return;
      }
      return;
    }
    if (t >= S.nextPhrase && !opts.suppress) {
      S.level = Math.min(1, (t - S.start) / (S.end - S.start) * 1.3);
      const notes = this.makeAlap(this.raga, S.level);
      const end = S.inst === 'bana' ? this.banaPhrase(notes, t + 0.05, { oct: 0, gain: 0.07 }) : this.flutePhrase(notes, t + 0.05, { gain: 0.15 });
      S.nextPhrase = end + 1.5 + Math.random() * 3.5;
    }
  }
}

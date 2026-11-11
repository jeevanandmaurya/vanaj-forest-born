// Procedural audio engine (Web Audio): HRTF-spatialised animal voices, central-Indian bird calls
// (common hawk-cuckoo, Asian koel, barbet, coucal, junglefowl, nightjar, owlet, lapwing...), cicadas, crickets,
// frogs, wind in teak, river, rain, thunder, footsteps by surface, weapon swings, flesh impacts, fire, bees.

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  // lite (phones): the audio thread has to finish each block before the speaker needs it, on a CPU the game and the browser are already
  // filling, and when it is late the music breaks up. So on a phone it gets a bigger buffer to fall back on ('playback' latency: sounds come
  // some 100 ms later, which is hard to notice at this frame rate, where a stutter is not) and less to do: half the sample rate halves
  // the work of every node (12 kHz of treble is all a phone's speaker has anyway), no HRTF panning, and a shorter reverb.
  constructor(o = {}) { this.ctx = null; this.ready = false; this.lite = !!o.lite; this.listener = { x: 0, y: 0, z: 0 }; this.vol = { master: 0.9, music: 0.7, sfx: 1, amb: 1 }; this.voices = []; this.irs = {}; }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    let ctx;
    if (this.lite) { try { ctx = new C({ latencyHint: 'playback', sampleRate: 24000 }); } catch (e) { ctx = new C({ latencyHint: 'playback' }); } }
    else ctx = new C({ latencyHint: 'interactive' });
    this.ctx = ctx; this.top = Math.min(20000, ctx.sampleRate * 0.45);   // the highest a filter can be set
    this.master = ctx.createGain(); this.master.gain.value = this.vol.master;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = this.top;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 3; this.comp.attack.value = 0.01; this.comp.release.value = 0.3;
    this.master.connect(this.lp); this.lp.connect(this.comp); this.comp.connect(ctx.destination);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.vol.music; this.music.connect(this.master);
    this.verb = ctx.createConvolver(); this.verb.buffer = this.ir('forest');
    this.verbOut = ctx.createGain(); this.verbOut.gain.value = 0.9; this.verb.connect(this.verbOut); this.verbOut.connect(this.master);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.verb);
    // the world's own reverb send, apart from the music's, so the world can be silenced whole on the main menu
    this.worldVerb = ctx.createGain(); this.worldVerb.connect(this.verbSend);
    this.noise = { white: this.makeNoise('white', 4), pink: this.makeNoise('pink', 4), brown: this.makeNoise('brown', 4) };
    this.buildAmbience();
    this.ready = true;
    this.birdT = 2; this.cricketT = 0; this.frogT = 1; this.eventT = 5;
    this.state = { hour: 8, season: 'winter', rain: 0, wind: 0.3, water: 0, night: 0, cave: 0, under: 0, village: 0 };
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  // the world's sound (animals, birds, insects, wind, water, footsteps) on or off; the music has its own bus.
  // Off on the main menu, where there is only the flute.
  setWorld(on, fade = 1.2) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, v = on ? 1 : 0;
    for (const n of [this.amb, this.sfx, this.worldVerb]) { n.gain.cancelScheduledValues(t); if (fade <= 0) n.gain.value = v; else n.gain.setTargetAtTime(v, t, fade * 0.35); }
  }
  // A change of scene: everything the player hears dips together, and comes back together with the picture
  scene(on, fade = 1) {
    if (!this.ready) return;
    this.setWorld(on, fade);
    const t = this.ctx.currentTime, g = this.music.gain; g.cancelScheduledValues(t); g.setTargetAtTime(on ? this.vol.music : 0, t, fade * 0.35);
  }
  // Noise that loops without a seam. The beds (wind, river, rain, fire) loop these buffers; brown noise wanders,
  // so its last sample sat far from its first and the loop clicked every 4 s. The generator runs on past the end,
  // and that continuation is crossfaded into the head, so playback runs from the tail straight into the start.
  makeNoise(type, sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), X = 4096, raw = new Float32Array(n + X);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n + X; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') raw[i] = w;
      else if (type === 'pink') { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
      else { last = (last + 0.02 * w) / 1.02; raw[i] = last * 3.5; }
    }
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    d.set(raw.subarray(0, n));
    for (let i = 0; i < X; i++) { const k = i / X; d[i] = raw[n + i] * (1 - k) + raw[i] * k; }
    return b;
  }
  makeIR(sec, decay, dark) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        let v = (Math.random() * 2 - 1) * Math.exp(-t / decay);
        // early reflections (tree trunks)
        if (i < ctx.sampleRate * 0.12 && Math.random() < 0.002) v += (Math.random() - 0.5) * 3 * Math.exp(-t * 12);
        lp += (v - lp) * (1 - dark * Math.min(1, t * 1.5 + 0.2));
        d[i] = lp * 0.6 * Math.min(1, (n - i) / (n * 0.25));   // (the last quarter fades, or a short tail ends in a thump)
      }
    }
    return b;
  }
  // each room's reverb, made once (walking in and out of the cave made a new one each time, all of it on the main thread)
  ir(kind) { return this.irs[kind] || (this.irs[kind] = kind === 'cave' ? this.makeIR(this.lite ? 1.1 : 1.6, 0.4, 0.15) : this.makeIR(this.lite ? 1.3 : 2.6, 0.55, 0.35)); }
  // ------------------------------------------------------------------ routing helpers
  spatial(pos, gain = 1, opts = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    const L = this.listener;
    const d = pos ? Math.hypot(pos.x - L.x, (pos.y || L.y) - L.y, pos.z - L.z) : 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.min(this.top, Math.max(900, 18000 * Math.exp(-d / (opts.absorb || 320))));
    g.connect(f);
    let out = f, p = null;
    if (pos) {
      p = ctx.createPanner(); p.panningModel = d < 60 && !this.lite ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = opts.ref || 5; p.maxDistance = 3000; p.rolloffFactor = opts.roll ?? 1;
      p.positionX.value = pos.x; p.positionY.value = pos.y ?? L.y; p.positionZ.value = pos.z;
      f.connect(p); out = p;
    }
    out.connect(opts.bus || this.sfx);
    const send = ctx.createGain(); send.gain.value = opts.verb ?? 0.35; out.connect(send); send.connect(this.worldVerb);
    this.voices.push({ g, nodes: p ? [g, f, p, send] : [g, f, send], t: ctx.currentTime });
    return g;
  }
  // A sound that has ended still sits in the graph, and the audio thread visits its nodes every block, until the garbage collector happens
  // to run. A cricket chirp every fraction of a second and a footstep every stride add up to a graph that grows and grows. So each sound
  // notes when it ends (played(), below), and every couple of seconds those that are over are cut off from the output, which takes
  // everything upstream of them out of the graph as well. (20 s for one that never said: nothing lasts as long.)
  played(out, end) { out._end = Math.max(out._end || 0, end + 0.1); }
  sweep(t) {
    const V = this.voices; let w = 0;
    for (const v of V) { if (t > (v.g._end ?? v.t + 20) + 0.3) { for (const n of v.nodes) n.disconnect(); } else V[w++] = v; }
    V.length = w;
  }
  tone(out, t, o) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    const g = ctx.createGain(); g.gain.value = 0;
    const dur = o.dur || 0.2, at = o.a ?? 0.01, rl = o.r ?? dur * 0.5, pk = o.g ?? 0.5;
    this.played(out, t + dur);
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.pts) { for (const [tt, ff] of o.pts) osc.frequency.exponentialRampToValueAtTime(Math.max(20, ff), t + tt); }
    else if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + at);
    g.gain.setValueAtTime(pk, t + Math.max(at, dur - rl)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.fm) { const m = ctx.createOscillator(); m.frequency.value = o.f0 * o.fm[0]; const mg = ctx.createGain(); mg.gain.value = o.fm[1]; m.connect(mg); mg.connect(osc.frequency); m.start(t); m.stop(t + dur + 0.05); }
    if (o.vib) { const v = ctx.createOscillator(); v.frequency.value = o.vib[0]; const vg = ctx.createGain(); vg.gain.value = o.vib[1]; v.connect(vg); vg.connect(osc.frequency); v.start(t); v.stop(t + dur + 0.05); }
    if (o.am) { const v = ctx.createOscillator(); v.frequency.value = o.am[0]; const vg = ctx.createGain(); vg.gain.value = o.am[1]; v.connect(vg); vg.connect(g.gain); v.start(t); v.stop(t + dur + 0.05); }
    if (o.filt) { for (const fl of o.filt) { const f = ctx.createBiquadFilter(); f.type = fl[0]; f.frequency.value = fl[1]; f.Q.value = fl[2] ?? 1; if (fl[3]) f.gain.value = fl[3]; node.connect(f); node = f; } }
    node.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  }
  formant(out, t, o) { // voice-like: saw through parallel formant bandpasses
    const ctx = this.ctx;
    this.played(out, t + o.dur);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.pts) for (const [tt, ff] of o.pts) osc.frequency.exponentialRampToValueAtTime(ff, t + tt);
    if (o.vib) { const v = ctx.createOscillator(); v.frequency.value = o.vib[0]; const vg = ctx.createGain(); vg.gain.value = o.vib[1]; v.connect(vg); vg.connect(osc.frequency); v.start(t); v.stop(t + o.dur + 0.1); }
    const g = ctx.createGain(); g.gain.value = 0;
    const dur = o.dur, pk = o.g ?? 0.4;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + (o.a ?? 0.05));
    g.gain.setValueAtTime(pk * (o.sus ?? 0.9), t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [ff, q, gg] of o.forms) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = ff; f.Q.value = q; const fg = ctx.createGain(); fg.gain.value = gg; osc.connect(f); f.connect(fg); fg.connect(g); }
    if (o.rasp) { const n = ctx.createBufferSource(); n.buffer = this.noise.pink; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.rasp[0]; f.Q.value = 0.8; const ng = ctx.createGain(); ng.gain.value = o.rasp[1]; n.connect(f); f.connect(ng); ng.connect(g); n.start(t, Math.random()); n.stop(t + dur + 0.05); if (o.am) { const am = ctx.createOscillator(); am.frequency.value = o.am; const ag = ctx.createGain(); ag.gain.value = o.rasp[1] * 0.8; am.connect(ag); ag.connect(ng.gain); am.start(t); am.stop(t + dur); } }
    g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  noiseBurst(out, t, o) {
    const ctx = this.ctx;
    this.played(out, t + o.dur);
    const n = ctx.createBufferSource(); n.buffer = this.noise[o.color || 'white'];
    const f = ctx.createBiquadFilter(); f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f, t); f.Q.value = o.q ?? 1;
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain(); const pk = o.g ?? 0.5, at = o.a ?? 0.003;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t, Math.random() * 2); n.stop(t + o.dur + 0.05);
  }
  // ------------------------------------------------------------------ ambience beds
  loopNoise(color, filters, gain, bus) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise[color]; s.loop = true;
    let n = s; for (const fl of filters) { const f = ctx.createBiquadFilter(); f.type = fl[0]; f.frequency.value = fl[1]; f.Q.value = fl[2] ?? 0.7; n.connect(f); n = f; }
    const g = ctx.createGain(); g.gain.value = gain; n.connect(g); g.connect(bus || this.amb); s.start(0, Math.random() * 3);
    return { g, tail: g, bus: bus || this.amb, on: true, level: -1, off: 0 };
  }
  // A bed's level. A silent bed still costs its noise source and its filters, block after block, unless it is cut off from the output (nothing
  // upstream of a disconnected node is worked out), so once it has faded out it is. Most of them are silent most of the time: rain, river,
  // fire, underwater. And a level that has not really changed queues no change for the audio thread.
  bed(b, level, t, tc) {
    if (level < 0.0005) {
      if (!b.on) return;
      if (b.level !== 0) { b.level = 0; b.g.gain.setTargetAtTime(0, t, tc); b.off = t + tc * 6; }
      else if (t > b.off) { b.tail.disconnect(); b.on = false; }
      return;
    }
    if (!b.on) { b.tail.connect(b.bus); b.on = true; b.level = 0; }
    if (Math.abs(level - b.level) > b.level * 0.02 + 0.0002) { b.level = level; b.g.gain.setTargetAtTime(level, t, tc); }
  }
  buildAmbience() {
    const ctx = this.ctx;
    this.windG = this.loopNoise('pink', [['bandpass', 380, 0.6]], 0);
    this.leavesG = this.loopNoise('white', [['highpass', 2200], ['bandpass', 5200, 0.4]], 0);
    this.riverG = this.loopNoise('brown', [['lowpass', 700]], 0);
    this.babbleG = this.loopNoise('pink', [['bandpass', 1800, 1.2]], 0);
    this.rainG = this.loopNoise('pink', [['highpass', 700], ['lowpass', 9000]], 0);
    this.rainLeafG = this.loopNoise('white', [['bandpass', 4200, 0.6]], 0);
    this.rainLowG = this.loopNoise('brown', [['lowpass', 260]], 0);
    // cicadas
    this.cicadas = [];
    for (let i = 0; i < 3; i++) {
      const s = ctx.createBufferSource(); s.buffer = this.noise.white; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4600 + i * 900; f.Q.value = 9;
      const am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 38 + i * 11; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); lfo.start();
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = (i - 1) * 0.7;
      s.connect(f); f.connect(am); am.connect(g); g.connect(p); p.connect(this.amb); s.start(0, Math.random() * 3);
      this.cicadas.push({ b: { g, tail: p, bus: this.amb, on: true, level: -1, off: 0 }, phase: Math.random() * 10 });
    }
    // fire crackle bed (gain set by nearest fire)
    this.fireG = this.loopNoise('brown', [['lowpass', 500]], 0, this.sfx);
    this.fireCrackT = 0; this.fireLevel = 0;
    // breathing / heartbeat
    this.breathLevel = 0; this.heartT = 0; this.heartRate = 0;
    // underwater rumble
    this.underG = this.loopNoise('brown', [['lowpass', 200]], 0, this.sfx);
  }
  setListener(cam) {
    if (!this.ready) return;
    const L = this.ctx.listener, p = cam.position;
    this.listener.x = p.x; this.listener.y = p.y; this.listener.z = p.z;
    const f = cam.getWorldDirection(this._f || (this._f = new cam.position.constructor()));
    const t = this.ctx.currentTime;
    if (L.positionX) {
      // (a listener gliding between positions makes every panner work out its angle for every sample, not once a block)
      if (this.lite) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; }
      else { L.positionX.setTargetAtTime(p.x, t, 0.05); L.positionY.setTargetAtTime(p.y, t, 0.05); L.positionZ.setTargetAtTime(p.z, t, 0.05); L.forwardX.setTargetAtTime(f.x, t, 0.05); L.forwardY.setTargetAtTime(f.y, t, 0.05); L.forwardZ.setTargetAtTime(f.z, t, 0.05); }
      if (!this._upSet) { this._upSet = true; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
  update(dt, s) {
    if (!this.ready) return;
    Object.assign(this.state, s);
    const t = this.ctx.currentTime, st = this.state;
    const k = 0.4;
    const h = st.hour, day = st.night < 0.5;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    // wind comes and goes in gusts over a near-silent floor (a constant bed read as hiss)
    const g2 = gust * gust;
    this.bed(this.windG, 0.012 + st.wind * 0.13 * g2, t, k);
    this.bed(this.leavesG, (0.003 + st.wind * 0.03 * g2) * (st.season === 'summer' ? 1.4 : 1), t, k);
    this.bed(this.riverG, st.water * 0.32, t, k);
    this.bed(this.babbleG, st.water * 0.07, t, k);
    this.bed(this.rainG, st.rain * 0.22, t, k * 2);
    this.bed(this.rainLeafG, st.rain * 0.08, t, k * 2);
    this.bed(this.rainLowG, st.rain * st.rain * 0.4, t, k * 2);
    // cicadas: hot day (summer strongest, monsoon breaks)
    const cic = (st.season === 'summer' ? 1 : st.season === 'monsoon' ? 0.55 : st.season === 'post' ? 0.3 : 0.12) * (h > 9 && h < 17.5 ? 1 : h > 7.5 && h < 19 ? 0.35 : 0) * (1 - st.rain);
    for (const c of this.cicadas) { c.phase += dt * 0.18; const sw = Math.max(0, Math.sin(c.phase)) ** 0.6; this.bed(c.b, cic * 0.05 * sw, t, 0.6); }
    // fire
    this.bed(this.fireG, this.fireLevel * 0.12, t, 0.2);
    this.fireCrackT -= dt;
    if (this.fireLevel > 0.05 && this.fireCrackT <= 0) { this.fireCrackT = rand(0.03, 0.35); const o = this.spatial(null, this.fireLevel * 0.6); this.noiseBurst(o, t, { ft: 'highpass', f: rand(2000, 5000), dur: rand(0.005, 0.03), g: rand(0.2, 0.8) }); }
    // breath: separate breaths in and out once winded, faster as stamina runs out (not a pulsing noise bed)
    this.breathT = (this.breathT || 0) - dt;
    if (this.breathLevel > 0.3 && this.breathT <= 0) { this.breathT = 1.25 - this.breathLevel * 0.6; this.breath(this.breathLevel); }
    if (this.heartRate > 0) { this.heartT -= dt; if (this.heartT <= 0) { this.heartT = 60 / this.heartRate; const o = this.spatial(null, 0.5 * Math.min(1, this.heartRate / 140)); this.tone(o, t, { f0: 58, f1: 40, dur: 0.12, g: 0.9 }); this.tone(o, t + 0.17, { f0: 52, f1: 38, dur: 0.1, g: 0.6 }); } }
    this.bed(this.underG, st.under * 0.3, t, 0.1);
    if (st.under !== this._under) { this._under = st.under; this.lp.frequency.setTargetAtTime(st.under ? 450 : this.top, t, 0.08); }
    // bird & insect events
    this.scheduleNature(dt);
    if (t > (this._sweepT || 0)) { this._sweepT = t + 2; this.sweep(t); }
  }
  // ------------------------------------------------------------------ nature events
  randomPos(minD, maxD, up = 8) { const a = Math.random() * 6.28, d = rand(minD, maxD); const L = this.listener; return { x: L.x + Math.cos(a) * d, y: L.y + rand(2, up), z: L.z + Math.sin(a) * d }; }
  scheduleNature(dt) {
    const st = this.state, h = st.hour, rain = st.rain, s = st.season;
    // (a phone's audio thread can't take every voice of the forest at once: the music comes first, and the forest thins out around it)
    const lite = this.lite ? 2.5 : 1, busy = this.lite && this.voices.length > 14;
    // crickets (night)
    const nightK = st.night;
    this.cricketT -= dt;
    if (nightK > 0.3 && this.cricketT <= 0 && !busy) {
      this.cricketT = rand(0.12, 0.5) / (s === 'winter' ? 0.5 : 1) * lite;
      const p = this.randomPos(4, 40, 1), t = this.ctx.currentTime;
      const o = this.spatial(p, 0.09 * nightK * (1 - rain * 0.6), { verb: 0.1, bus: this.amb });
      const f = rand(3900, 4900), n = 3 + Math.floor(rand(0, 3));
      for (let i = 0; i < n; i++) this.tone(o, t + i * 0.032, { f0: f, dur: 0.018, a: 0.002, r: 0.01, g: 0.5 });
    }
    // frogs (monsoon nights near water or in rain)
    this.frogT -= dt;
    if (s === 'monsoon' && (nightK > 0.3 || rain > 0.3) && this.frogT <= 0 && !busy) {
      this.frogT = rand(0.2, 1.2) * lite;
      const p = this.randomPos(8, 60, 0.5), t = this.ctx.currentTime;
      const o = this.spatial(p, 0.12, { verb: 0.2, bus: this.amb });
      const f = rand(250, 600), n = 2 + Math.floor(rand(0, 5));
      for (let i = 0; i < n; i++) this.formant(o, t + i * rand(0.12, 0.2), { f0: f, dur: 0.1, a: 0.01, forms: [[f * 2, 4, 1], [1400, 3, 0.4]], g: 0.3 });
    }
    // (birdsong and the far calls are the forest's own business now: js/sim/forest.js decides who sings, where and when)
  }
  // one call of a kind of bird: from `at` (a singer's perch), or from somewhere round the listener
  bird(kind, at) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const p = at || this.randomPos(kind.startsWith('far') || kind === 'jackals' ? 250 : 15, kind.startsWith('far') || kind === 'jackals' ? 900 : 120, 14);
    const o = this.spatial(p, 1, { verb: 0.5, bus: this.amb, ref: 10, absorb: 500 });
    switch (kind) {
      case 'hawkCuckoo': { // "brain-fe-ver" rising, frantic
        let f = rand(1150, 1350), tt = t; const reps = 4 + Math.floor(rand(0, 3));
        for (let r = 0; r < reps; r++) {
          this.tone(o, tt, { f0: f, dur: 0.13, a: 0.01, g: 0.22, type: 'triangle' });
          this.tone(o, tt + 0.17, { f0: f * 1.3, pts: [[0.2, f * 1.34]], dur: 0.3, a: 0.02, g: 0.28, type: 'triangle' });
          this.tone(o, tt + 0.52, { f0: f * 1.15, dur: 0.17, a: 0.01, g: 0.24, type: 'triangle' });
          tt += 0.95; f *= 1.07;
        } break;
      }
      case 'koel': { let f = rand(620, 720), tt = t; for (let r = 0; r < 5; r++) { this.tone(o, tt, { f0: f, dur: 0.14, g: 0.2, type: 'sine', filt: [['lowpass', 3000]] }); this.tone(o, tt + 0.2, { f0: f * 1.05, f1: f * 1.48, dur: 0.38, a: 0.04, g: 0.3 }); tt += 0.9 - r * 0.05; f *= 1.04; } break; }
      case 'barbet': { const f = rand(600, 720); for (let r = 0; r < 8; r++) { this.tone(o, t + r * 0.42, { f0: f, dur: 0.1, g: 0.16, type: 'triangle' }); this.tone(o, t + r * 0.42 + 0.13, { f0: f * 1.22, dur: 0.16, g: 0.2, type: 'triangle' }); } break; }
      case 'coucal': { let tt = t; for (let r = 0; r < 6; r++) { this.tone(o, tt, { f0: 360, f1: 330, dur: 0.17, g: 0.3, type: 'sine', filt: [['lowpass', 800]] }); tt += 0.32 - r * 0.02; } break; }
      case 'junglefowl': { const seq = [[0.12, 1000], [0.28, 1250], [0.1, 1050], [0.14, 950]]; let tt = t; for (const [d, f] of seq) { this.formant(o, tt, { f0: f / 2, pts: [[d, f / 2.2]], dur: d, a: 0.01, forms: [[f, 5, 1], [f * 2.1, 6, 0.5]], rasp: [f, 0.2], g: 0.3 }); tt += d + 0.03; } break; }
      case 'peacock': { for (let r = 0; r < 3; r++) { const tt = t + r * 0.95; this.formant(o, tt, { f0: 480, pts: [[0.1, 880], [0.55, 700]], dur: 0.6, a: 0.02, forms: [[1100, 3, 1], [2300, 4, 0.6], [3200, 5, 0.3]], rasp: [1600, 0.12], g: 0.45 }); } break; }
      case 'drongo': case 'bulbul': case 'babbler': {
        const n = kind === 'babbler' ? 10 : 5, base = kind === 'drongo' ? 2200 : kind === 'bulbul' ? 1800 : 1500;
        for (let r = 0; r < n; r++) { const f = base * rand(0.8, 1.5); this.tone(o, t + r * rand(0.08, 0.2), { f0: f, f1: f * rand(0.7, 1.4), dur: rand(0.05, 0.15), g: kind === 'babbler' ? 0.1 : 0.14, type: kind === 'babbler' ? 'sawtooth' : 'sine', filt: kind === 'babbler' ? [['bandpass', f, 3]] : null }); }
        break;
      }
      case 'woodpecker': { for (let r = 0; r < 20; r++) this.noiseBurst(o, t + r * 0.055, { f: 1600, q: 3, dur: 0.02, g: 0.4 }); break; }
      case 'lapwing': { const f = rand(2500, 2900); const tms = [0, 0.15, 0.27, 0.42]; for (const d of tms) this.tone(o, t + d, { f0: f, f1: f * 0.9, dur: 0.09, g: 0.18, type: 'triangle' }); break; }
      case 'kingfisher': { for (let r = 0; r < 12; r++) this.tone(o, t + r * 0.06, { f0: 3500, f1: 3200, dur: 0.04, g: 0.1 }); break; }
      case 'nightjar': { let tt = t, gap = 0.33; for (let r = 0; r < 14; r++) { this.tone(o, tt, { f0: 1500, f1: 1100, dur: 0.035, a: 0.002, g: 0.25, type: 'sine' }); tt += gap; gap = Math.max(0.09, gap * 0.9); } break; }
      case 'owlet': { for (let r = 0; r < 6; r++) this.tone(o, t + r * 0.32, { f0: 900, f1: 760, dur: 0.12, g: 0.15, type: 'triangle' }); break; }
      case 'woodOwl': case 'fishOwl': { const f = kind === 'fishOwl' ? 180 : 320; this.tone(o, t, { f0: f, dur: 0.3, g: 0.35, filt: [['lowpass', 600]] }); this.tone(o, t + 0.5, { f0: f, f1: f * 0.92, dur: 0.6, g: 0.4, filt: [['lowpass', 600]] }); break; }
      case 'jackals': { for (let v = 0; v < 5; v++) { const tt = t + rand(0, 1.5), f = rand(500, 750); this.formant(o, tt, { f0: f, pts: [[0.4, f * 1.5], [1.2, f * 1.2], [1.8, f * 0.8]], dur: 1.9, a: 0.2, vib: [6, 12], forms: [[f * 2, 3, 1], [1600, 4, 0.4]], g: 0.18 }); } break; }
      case 'farSambar': this.animal('sambar', 'alarm', p, { far: true }); break;
      case 'farTiger': this.animal('tiger', Math.random() < 0.5 ? 'moan' : 'roar', p, { far: true }); break;
      case 'dogBark': this.animal('dog', 'alarm', this.randomPos(60, 220, 2)); break;
      case 'cowBell': { const q = this.randomPos(30, 150, 1); const oo = this.spatial(q, 0.5, { verb: 0.5, bus: this.amb }); for (let r = 0; r < 3; r++) { const tt = t + r * rand(0.4, 0.9); this.tone(oo, tt, { f0: 780, dur: 1.2, a: 0.002, g: 0.12, fm: [2.76, 400] }); this.tone(oo, tt, { f0: 1950, dur: 0.6, a: 0.002, g: 0.05 }); } break; }
      case 'rooster': { const seq = [[0.15, 700], [0.15, 900], [0.5, 1000]]; let tt = t; for (const [d, f] of seq) { this.formant(o, tt, { f0: f / 2, pts: [[d, f / 2.4]], dur: d, a: 0.01, forms: [[f, 5, 1], [f * 2, 6, 0.4]], rasp: [f, 0.2], g: 0.3 }); tt += d + 0.02; } break; }
    }
  }
  // ------------------------------------------------------------------ animal voices
  animal(voice, kind, pos, o = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.02;
    const far = o.far;
    const out = this.spatial(pos, far ? 2.5 : 1, { verb: far ? 0.8 : 0.4, ref: voice === 'tiger' || voice === 'gaur' ? 14 : 7, absorb: 450 });
    const big = o.big ? 1.3 : 1;
    switch (voice) {
      case 'tiger': case 'leopard': {
        const s = voice === 'tiger' ? 1 : 1.5;
        if (kind === 'roar' || kind === 'attack' && Math.random() < 0.4) {
          this.formant(out, t, { f0: 95 * s, pts: [[0.35, 155 * s], [1.0, 120 * s], [1.9, 70 * s]], dur: 2.0 * (kind === 'attack' ? 0.5 : 1), a: 0.12, forms: [[380 * s, 2, 1], [850 * s, 3, 0.7], [2100, 4, 0.25]], rasp: [500 * s, 0.9], am: 22, g: 0.9 * big });
          this.tone(out, t, { f0: 52 * s, f1: 40, dur: 1.6, a: 0.15, g: 0.5 });
        } else if (kind === 'moan') {
          this.formant(out, t, { f0: 120, pts: [[0.5, 105], [1.3, 85]], dur: 1.4, a: 0.2, forms: [[420, 3, 1], [900, 4, 0.5]], rasp: [400, 0.4], g: 0.6 });
        } else if (kind === 'snarl' || kind === 'attack') {
          this.formant(out, t, { f0: 85 * s, pts: [[0.3, 130 * s], [0.7, 90 * s]], dur: 0.75, a: 0.03, forms: [[600 * s, 2, 1], [1500, 3, 0.6]], rasp: [900, 1.2], am: 28, g: 0.85 * big });
        } else if (kind === 'saw' || (voice === 'leopard' && kind === 'call')) {
          for (let r = 0; r < 10; r++) { const tt = t + r * 0.38; this.formant(out, tt, { f0: 110, pts: [[0.15, 95]], dur: 0.18, a: 0.02, forms: [[420, 2, 1], [1100, 3, 0.5]], rasp: [380, 1.2], g: 0.55 }); this.noiseBurst(out, tt + 0.2, { f: 650, q: 1.5, dur: 0.1, g: 0.25, color: 'pink' }); }
        } else if (kind === 'pain') {
          this.formant(out, t, { f0: 160 * s, pts: [[0.1, 260 * s], [0.5, 120 * s]], dur: 0.55, a: 0.01, forms: [[700 * s, 3, 1], [1600, 3, 0.5]], rasp: [900, 1.0], am: 30, g: 0.9 * big });
        } else if (kind === 'death') {
          this.formant(out, t, { f0: 140 * s, pts: [[0.3, 180 * s], [1.6, 60 * s]], dur: 1.8, a: 0.05, forms: [[500 * s, 2, 1], [1200, 3, 0.5]], rasp: [600, 0.8], am: 16, g: 0.9 });
        } else if (kind === 'growl') this.formant(out, t, { f0: 70, pts: [[0.5, 80], [1.1, 62]], dur: 1.2, a: 0.1, forms: [[300, 2, 1], [700, 3, 0.4]], rasp: [300, 1.1], am: 18, g: 0.6 });
        break;
      }
      case 'chital': {
        if (kind === 'alarm') { const n = 1 + Math.floor(rand(0, 3)); for (let r = 0; r < n; r++) { const tt = t + r * rand(0.6, 1.4); this.tone(out, tt, { f0: rand(1050, 1250), f1: 760, dur: 0.15, a: 0.004, g: 0.55, type: 'triangle', filt: [['bandpass', 1300, 1.5]] }); this.noiseBurst(out, tt, { f: 1800, q: 1.2, dur: 0.12, g: 0.35 }); } }
        else if (kind === 'pain' || kind === 'death') this.formant(out, t, { f0: 420, pts: [[0.1, 700], [0.6, 350]], dur: kind === 'death' ? 0.9 : 0.5, a: 0.01, forms: [[1100, 4, 1], [2300, 5, 0.4]], rasp: [1500, 0.5], g: 0.6 });
        break;
      }
      case 'sambar': {
        if (kind === 'alarm') { const n = 1 + Math.floor(rand(0, 2)); for (let r = 0; r < n; r++) { const tt = t + r * 1.6; this.formant(out, tt, { f0: 190, pts: [[0.32, 140]], dur: 0.38, a: 0.006, forms: [[520, 3, 1], [1200, 4, 0.5]], rasp: [400, 0.5], g: 0.85, sus: 0.6 }); this.noiseBurst(out, tt, { f: 500, q: 1, dur: 0.2, g: 0.4, color: 'pink' }); } }
        else this.formant(out, t, { f0: 260, pts: [[0.15, 380], [0.7, 200]], dur: 0.8, a: 0.02, forms: [[800, 3, 1], [1800, 4, 0.4]], rasp: [900, 0.6], g: 0.6 });
        break;
      }
      case 'langur': {
        // The alarm is a short harsh cough, low and breathy, two or three at a time. The adult male's loud call is a deep
        // rising whoop that drops away. (The old alarm was a high buzz at full level, in runs of up to five.)
        if (kind === 'alarm') { const n = 2 + Math.floor(rand(0, 2)), f = rand(170, 215); let tt = t; for (let r = 0; r < n; r++) { this.formant(out, tt, { f0: f, pts: [[0.1, f * 0.72]], dur: 0.13, a: 0.008, forms: [[620, 2.5, 1], [1250, 3, 0.35]], rasp: [650, 0.5], g: 0.26 }); this.noiseBurst(out, tt, { f: 1100, q: 0.9, dur: 0.1, g: 0.05, color: 'pink' }); tt += rand(0.34, 0.56); } }
        else if (kind === 'whoop') { const f = rand(135, 155); this.formant(out, t, { f0: f, pts: [[0.28, f * 1.7], [0.75, f * 1.05]], dur: 0.8, a: 0.09, forms: [[430, 3, 1], [880, 4, 0.3]], g: 0.2 }); this.formant(out, t + 0.86, { f0: f * 1.2, pts: [[0.3, f * 0.85]], dur: 0.36, a: 0.05, forms: [[400, 3, 1]], g: 0.11 }); }
        else if (kind === 'grunt') this.formant(out, t, { f0: rand(120, 150), pts: [[0.1, 105]], dur: 0.12, a: 0.02, forms: [[380, 2.5, 1]], g: 0.035 });
        else this.formant(out, t, { f0: 420, pts: [[0.08, 640], [0.32, 340]], dur: 0.36, forms: [[1000, 3, 1]], rasp: [1100, 0.4], g: 0.26 });
        break;
      }
      case 'dhole': {
        if (kind === 'whistle') { for (let r = 0; r < 3; r++) { const tt = t + r * rand(0.35, 0.6), f = rand(1150, 1450); this.tone(out, tt, { f0: f, f1: f * 1.12, dur: 0.24, a: 0.03, g: 0.3, vib: [9, 15] }); this.noiseBurst(out, tt, { f: f, q: 6, dur: 0.22, g: 0.06 }); } }
        else if (kind === 'attack') this.formant(out, t, { f0: 300, pts: [[0.12, 220]], dur: 0.2, a: 0.005, forms: [[1000, 3, 1], [2200, 4, 0.4]], rasp: [1200, 0.7], g: 0.5 });
        else this.formant(out, t, { f0: 700, pts: [[0.1, 1100], [0.4, 500]], dur: kind === 'death' ? 0.8 : 0.4, forms: [[1500, 4, 1]], rasp: [1800, 0.4], g: 0.55 });
        break;
      }
      case 'wolf': {
        if (kind === 'howl') this.formant(out, t, { f0: 380, pts: [[0.6, 560], [2.2, 520], [3.0, 400]], dur: 3.1, a: 0.3, vib: [5, 9], forms: [[760, 4, 1], [1500, 5, 0.4]], g: 0.4 });
        else if (kind === 'attack' || kind === 'snarl') this.formant(out, t, { f0: 140, pts: [[0.3, 200], [0.6, 150]], dur: 0.6, a: 0.02, forms: [[600, 2, 1], [1500, 3, 0.5]], rasp: [900, 1.1], am: 30, g: 0.6 });
        else if (kind === 'whine') this.tone(out, t, { f0: 900, pts: [[0.3, 1200], [0.8, 800]], dur: 0.9, g: 0.15, vib: [7, 20] });
        else this.formant(out, t, { f0: 500, pts: [[0.1, 900], [0.6, 300]], dur: kind === 'death' ? 1.2 : 0.5, forms: [[1200, 4, 1]], rasp: [1400, 0.5], g: 0.6 });
        break;
      }
      case 'bear': {
        if (kind === 'huff') { for (let r = 0; r < 3; r++) this.noiseBurst(out, t + r * 0.3, { ft: 'lowpass', f: 700, dur: 0.22, g: 0.4, color: 'pink' }); }
        else if (kind === 'roar' || kind === 'attack' || kind === 'snarl') this.formant(out, t, { f0: 240, pts: [[0.2, 420], [0.8, 260]], dur: 0.85, a: 0.02, forms: [[800, 2, 1], [1700, 3, 0.6]], rasp: [1000, 1.4], am: 35, g: 0.9 });
        else this.formant(out, t, { f0: 320, pts: [[0.1, 520], [0.9, 200]], dur: kind === 'death' ? 1.4 : 0.7, forms: [[900, 3, 1], [2000, 4, 0.4]], rasp: [1200, 1.0], g: 0.8 });
        break;
      }
      case 'boar': {
        if (kind === 'grunt' || kind === 'attack') { for (let r = 0; r < 3; r++) this.formant(out, t + r * 0.14, { f0: 95, dur: 0.09, a: 0.005, forms: [[380, 3, 1], [900, 4, 0.4]], rasp: [400, 0.8], g: 0.6 }); }
        else this.formant(out, t, { f0: 850, pts: [[0.15, 1400], [0.6, 1000]], dur: kind === 'death' ? 1.1 : 0.6, a: 0.01, forms: [[1600, 3, 1], [3000, 4, 0.4]], rasp: [2000, 0.6], g: 0.7 });
        break;
      }
      case 'gaur': {
        if (kind === 'snort') this.noiseBurst(out, t, { f: 650, q: 0.8, dur: 0.35, a: 0.005, g: 0.7, color: 'pink' });
        else if (kind === 'attack') { this.noiseBurst(out, t, { f: 400, q: 0.8, dur: 0.4, g: 0.8, color: 'pink' }); this.formant(out, t, { f0: 90, pts: [[0.5, 80]], dur: 0.6, forms: [[350, 2, 1]], rasp: [300, 0.6], g: 0.6 }); }
        else this.formant(out, t, { f0: 110, pts: [[0.3, 150], [1.0, 80]], dur: 1.1, a: 0.05, forms: [[400, 2, 1], [900, 3, 0.4]], rasp: [500, 0.5], g: 0.8 });
        break;
      }
      case 'peafowl': {
        if (kind === 'alarm') { for (let r = 0; r < 5; r++) this.formant(out, t + r * 0.16, { f0: 520, dur: 0.09, a: 0.005, forms: [[1100, 4, 1], [2400, 5, 0.5]], rasp: [1400, 0.3], g: 0.5 }); }
        else this.formant(out, t, { f0: 480, pts: [[0.1, 880], [0.55, 700]], dur: 0.6, a: 0.02, forms: [[1100, 3, 1], [2300, 4, 0.6]], rasp: [1600, 0.12], g: 0.5 });
        break;
      }
      case 'croc': {
        if (kind === 'attack') { this.noiseBurst(out, t, { ft: 'lowpass', f: 1200, dur: 0.6, g: 0.9, color: 'pink' }); this.tone(out, t, { f0: 70, f1: 40, dur: 0.3, g: 0.9 }); }
        else this.noiseBurst(out, t, { ft: 'highpass', f: 1800, dur: 1.3, a: 0.2, g: 0.35 });
        break;
      }
      case 'cow': this.formant(out, t, { f0: 115, pts: [[0.4, 150], [1.2, 105]], dur: 1.3, a: 0.15, forms: [[500, 3, 1], [1100, 4, 0.5]], g: 0.5 }); break;
      case 'dog': { const n = 2 + Math.floor(rand(0, 3)); for (let r = 0; r < n; r++) this.formant(out, t + r * rand(0.25, 0.4), { f0: 420, pts: [[0.12, 300]], dur: 0.14, a: 0.004, forms: [[1000, 3, 1], [2200, 4, 0.5]], rasp: [1500, 0.7], g: 0.5 }); break; }
    }
  }
  // ------------------------------------------------------------------ player & combat sfx
  // A bare foot: the heel lands as a soft low thump, then the ball of the foot sounds the surface. The gap between
  // them shrinks as the pace rises (CRI's heel/toe method), running adds weight to the heel, and each step varies
  // its pitch and level without repeating the last variant. Almost dry: reverb smeared the old steps into hiss.
  // run: 0 walking .. 1 sprinting.
  footstep(surface, intensity = 1, pos, run = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, o = this.spatial(pos || null, 0.5 * intensity, { verb: 0.04 });
    let v; do v = Math.floor(rand(0, 4)); while (v === this._lastStep); this._lastStep = v;
    const p = 0.86 + v * 0.09 + rand(-0.03, 0.03), gap = 0.075 - run * 0.06 + rand(0, 0.012), toe = t + gap;
    this.noiseBurst(o, t, { ft: 'lowpass', f: (150 + run * 60) * p, dur: 0.07 + run * 0.03, a: 0.004, g: 0.42 + run * 0.25, color: 'brown' });
    if (surface === 'leaf') { this.noiseBurst(o, toe, { f: 1500 * p, f1: 900 * p, q: 1.4, dur: 0.06, a: 0.006, g: 0.14 }); if (Math.random() < 0.5) this.noiseBurst(o, toe + 0.025, { f: 2600 * p, q: 2, dur: 0.025, g: 0.06 }); }
    else if (surface === 'grass') this.noiseBurst(o, toe, { f: 1100 * p, f1: 1900 * p, q: 0.9, dur: 0.11, a: 0.02, g: 0.12 });
    else if (surface === 'rock') { this.noiseBurst(o, toe, { f: 2300 * p, q: 5, dur: 0.018, g: 0.16 }); this.tone(o, toe, { f0: 900 * p, f1: 700 * p, dur: 0.03, g: 0.03, type: 'triangle' }); }
    else if (surface === 'water') { this.noiseBurst(o, t, { ft: 'lowpass', f: 1300 * p, f1: 450, dur: 0.22, a: 0.01, g: 0.45, color: 'pink' }); this.tone(o, toe, { f0: rand(500, 800), f1: rand(1100, 1600), dur: 0.05, g: 0.06 }); }
    else if (surface === 'mud') { this.noiseBurst(o, toe, { ft: 'lowpass', f: 700 * p, dur: 0.1, g: 0.25, color: 'pink' }); this.noiseBurst(o, toe + 0.04, { f: 850 * p, q: 3, dur: 0.04, g: 0.08 }); }
    else this.noiseBurst(o, toe, { f: 800 * p, q: 1, dur: 0.05, g: 0.12, color: 'pink' });
  }
  // one breath, in or out by turns: a soft band of air, deeper and louder the more winded
  breath(level) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, o = this.spatial(null, 0.3 * level, { verb: 0.02 }), out = (this._breathOut = !this._breathOut);
    this.noiseBurst(o, t, { f: out ? 700 : 1300, f1: out ? 500 : 1700, q: 0.9, dur: out ? 0.42 : 0.3, a: out ? 0.05 : 0.12, g: 0.35, color: 'pink' });
  }
  swing(weight = 1) { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.5); this.noiseBurst(o, t, { f: 300 / weight, f1: 1500 / weight, q: 1.6, dur: 0.22 + weight * 0.06, a: 0.08, g: 0.55, color: 'pink' }); }
  impact(kind, pos, strength = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, o = this.spatial(pos, 0.9 * Math.min(1.5, strength), { verb: 0.3 });
    if (kind === 'flesh') {
      this.tone(o, t, { f0: 95, f1: 38, dur: 0.16, a: 0.002, g: 1.0 });
      this.noiseBurst(o, t, { ft: 'lowpass', f: 1100, dur: 0.12, g: 0.8, color: 'pink' });
      this.noiseBurst(o, t + 0.015, { f: 1500, q: 2.5, dur: 0.07, g: 0.5 }); // wet squelch
      if (strength > 1) for (let i = 0; i < 4; i++) this.noiseBurst(o, t + 0.02 + i * 0.012, { f: 3200, q: 4, dur: 0.01, g: 0.5 }); // bone crack
    } else if (kind === 'wood') { this.noiseBurst(o, t, { f: 800, q: 2, dur: 0.08, g: 0.7 }); this.tone(o, t, { f0: 300, f1: 180, dur: 0.1, g: 0.4, type: 'triangle' }); }
    else if (kind === 'stone') { this.noiseBurst(o, t, { f: 3000, q: 3, dur: 0.05, g: 0.8 }); this.tone(o, t, { f0: 1800, f1: 1500, dur: 0.12, g: 0.15, type: 'triangle' }); }
    else if (kind === 'whiff') this.noiseBurst(o, t, { f: 600, q: 1, dur: 0.1, g: 0.2 });
  }
  pluck(freq = 160, g = 0.6) { // Karplus-Strong one-shot (bow string)
    if (!this.ready) return;
    const ctx = this.ctx, sr = ctx.sampleRate, dur = 0.7, N = Math.floor(sr * dur), b = ctx.createBuffer(1, N, sr), d = b.getChannelData(0);
    const L = Math.floor(sr / freq), buf = new Float32Array(L); for (let i = 0; i < L; i++) buf[i] = Math.random() * 2 - 1;
    let idx = 0; for (let i = 0; i < N; i++) { const a = buf[idx], c = buf[(idx + 1) % L]; buf[idx] = (a + c) * 0.5 * 0.994; d[i] = a; idx = (idx + 1) % L; }
    const s = ctx.createBufferSource(); s.buffer = b; const o = this.spatial(null, g); s.connect(o); s.start();
    this.played(o, ctx.currentTime + dur);
    this.noiseBurst(o, ctx.currentTime, { f: 2000, q: 1, dur: 0.03, g: 0.5 });
  }
  bowDraw() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.25); this.noiseBurst(o, t, { f: 400, f1: 1200, q: 4, dur: 0.6, a: 0.3, g: 0.3, color: 'pink' }); }
  arrowWhoosh() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.4); this.noiseBurst(o, t, { f: 2500, f1: 900, q: 2, dur: 0.25, a: 0.01, g: 0.5 }); }
  // returns a function that cuts this roll short (it arrives seconds after the flash, so a scene that ends
  // or is skipped in between needs to be able to silence it)
  thunder(dist, ang) {
    if (!this.ready) return () => {};
    const ctx = this.ctx, delay = dist / 343, t = ctx.currentTime + delay;
    const p = { x: this.listener.x + Math.cos(ang) * Math.min(dist, 400), y: this.listener.y + 200, z: this.listener.z + Math.sin(ang) * Math.min(dist, 400) };
    const so = this.spatial(p, 2.4 * Math.max(0.3, 1 - dist / 2500), { verb: 0.9, ref: 300, roll: 0.3 });
    const o = ctx.createGain(); o.connect(so);
    if (dist < 600) this.noiseBurst(o, t, { ft: 'highpass', f: 1200, dur: 0.35, a: 0.002, g: 1.2 });
    const n = ctx.createBufferSource(); n.buffer = this.noise.brown;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = dist < 600 ? 900 : 350;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    const len = rand(4, 8); let tt = t;
    g.gain.linearRampToValueAtTime(1.2, t + 0.08);
    while (tt < t + len) { tt += rand(0.15, 0.7); g.gain.linearRampToValueAtTime(rand(0.2, 1.1) * (1 - (tt - t) / len), tt); }
    g.gain.linearRampToValueAtTime(0, t + len + 0.5);
    n.connect(f); f.connect(g); g.connect(o); n.start(t); n.stop(t + len + 1);
    return (fade = 0.3) => { const now = ctx.currentTime; o.gain.cancelScheduledValues(now); o.gain.setValueAtTime(o.gain.value, now); o.gain.linearRampToValueAtTime(0, now + fade); };
  }
  splash(pos, big = 1) { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(pos, 0.7 * big); this.noiseBurst(o, t, { ft: 'lowpass', f: 2000, f1: 400, dur: 0.5, a: 0.01, g: 0.8, color: 'pink' }); for (let i = 0; i < 5; i++) this.tone(o, t + rand(0.03, 0.3), { f0: rand(400, 1000), f1: rand(1000, 2200), dur: 0.05, g: 0.12 }); }
  pickup() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.35); this.noiseBurst(o, t, { f: 1800, q: 1, dur: 0.08, g: 0.4 }); this.noiseBurst(o, t + 0.06, { ft: 'lowpass', f: 500, dur: 0.06, g: 0.4, color: 'pink' }); }
  craft() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.5); for (let i = 0; i < 6; i++) { this.noiseBurst(o, t + i * 0.12, { f: rand(2000, 4000), q: 2, dur: 0.03, g: 0.6 }); this.tone(o, t + i * 0.12, { f0: rand(1500, 2500), f1: 1200, dur: 0.08, g: 0.1, type: 'triangle' }); } }
  knap() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.6); this.noiseBurst(o, t, { f: 3500, q: 3, dur: 0.03, g: 0.8 }); this.tone(o, t, { f0: 2400, f1: 1900, dur: 0.15, g: 0.15, type: 'triangle' }); }
  eat() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.4); for (let i = 0; i < 5; i++) this.noiseBurst(o, t + i * 0.18, { f: rand(700, 1500), q: 1.5, dur: 0.09, g: 0.5, color: 'pink' }); }
  drink() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.4); for (let i = 0; i < 4; i++) { this.noiseBurst(o, t + i * 0.35, { ft: 'lowpass', f: 900, dur: 0.2, g: 0.5, color: 'pink' }); this.tone(o, t + i * 0.35 + 0.1, { f0: 300, f1: 700, dur: 0.08, g: 0.15 }); } }
  playerPain(big) { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, big ? 0.7 : 0.45, { verb: 0.15 }); const f = rand(165, 200) * (big ? 1.2 : 1); this.formant(o, t, { f0: f, pts: [[0.08, f * 1.25], [0.3, f * 0.85]], dur: big ? 0.45 : 0.28, a: 0.01, forms: [[700, 5, 1], [1150, 6, 0.6], [2600, 8, 0.25]], rasp: [900, 0.25], g: 0.6 }); }
  playerShout() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.9, { verb: 0.6 }); this.formant(o, t, { f0: 210, pts: [[0.2, 260], [0.9, 190]], dur: 1.0, a: 0.04, forms: [[750, 4, 1], [1250, 5, 0.6], [2700, 7, 0.3]], rasp: [1100, 0.4], am: 14, g: 0.8 }); for (let i = 0; i < 6; i++) this.tone(o, t + i * 0.12, { f0: 90, f1: 60, dur: 0.08, g: 0.6 }); }
  hum() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.35, { verb: 0.4 }); this.formant(o, t, { f0: 175, pts: [[0.6, 165], [1.4, 147], [2.1, 165]], dur: 2.4, a: 0.3, forms: [[350, 6, 1], [900, 8, 0.3]], g: 0.35, vib: [4.5, 2] }); }
  mimicLangur() { this.animal('langur', 'alarm', { x: this.listener.x, y: this.listener.y, z: this.listener.z }); }
  whistle() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.5, { verb: 0.5 }); for (let r = 0; r < 2; r++) this.tone(o, t + r * 0.4, { f0: 1250, f1: 1420, dur: 0.26, a: 0.03, g: 0.3, vib: [8, 12] }); }
  bees(pos, level) { if (!this.ready || level <= 0) return; const t = this.ctx.currentTime, o = this.spatial(pos, level * 0.5); for (let i = 0; i < 4; i++) this.tone(o, t, { f0: rand(190, 250), dur: 0.5, a: 0.1, g: 0.2, type: 'sawtooth', vib: [rand(5, 13), 12], filt: [['bandpass', 500, 1.5]] }); }
  ui(kind) { if (!this.ready) return; const t = this.ctx.currentTime, o = this.spatial(null, 0.25, { verb: 0.05 }); if (kind === 'open') this.noiseBurst(o, t, { f: 1200, f1: 3000, q: 1, dur: 0.12, g: 0.3 }); else this.tone(o, t, { f0: 880, dur: 0.06, g: 0.15, type: 'triangle' }); }
  setReverb(kind) { if (!this.ready || this._rv === kind) return; if (!this._rv && kind === 'forest') { this._rv = kind; return; } this._rv = kind; this.verb.buffer = this.ir(kind); }
}

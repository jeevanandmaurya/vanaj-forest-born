// Performance overlay: FPS and frame pacing, main-thread CPU time per system, GPU time (timer queries),
// draw calls / triangles, JS heap, device memory and an estimate of GPU memory in use.
// F3 cycles Off -> Compact -> Full. Nothing is measured while it is off, apart from one timestamp per frame.

const SECTIONS = ['player', 'streaming', 'sky', 'animals', 'effects', 'audio', 'ui', 'render'];
const LABEL = { player: 'player', streaming: 'streaming', sky: 'sky/weather', animals: 'animals/AI', effects: 'effects', audio: 'audio', ui: 'HUD', render: 'render' };
const MODES = ['off', 'compact', 'full'];
const MB = 1024 * 1024;

export class PerfOverlay {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.mode = MODES.includes(opts.mode) ? opts.mode : 'off';
    this.onChange = opts.onChange || (() => {});
    this.el = document.getElementById('perf');
    this.frames = new Float32Array(240); this.fi = 0; this.fcount = 0;     // frame intervals (ms), ring buffer
    this.cpuHist = new Float32Array(240); this.gpuHist = new Float32Array(240);
    this.acc = {}; for (const s of SECTIONS) this.acc[s] = 0;
    this.win = { n: 0, cpu: 0, t0: performance.now(), sec: {} };
    this.view = { cpu: 0, sec: {}, gpu: -1 };
    this.gpuQ = []; this.gpuActive = null; this.gpuLast = -1;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuName = this.readGpuName();
    this.vram = null; this.vramT = 0;
    this.build();
    this.setMode(this.mode, true);
  }
  get on() { return this.mode !== 'off'; }
  get full() { return this.mode === 'full'; }
  cycle() { this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]); }
  setMode(m, silent) {
    this.mode = m;
    this.el.className = 'perf-' + m;
    this.renderer.info.autoReset = !this.on; // composer renders several passes a frame; count them all
    if (!silent) this.onChange(m);
  }
  readGpuName() {
    const gl = this.gl; let s = '';
    try { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); s = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { }
    s = String(s || 'unknown GPU');
    const m = /^ANGLE \((.*)\)$/.exec(s);
    if (m) { const parts = m[1].split(', '); s = parts.length >= 2 ? parts[1] : parts[0]; } // ANGLE (vendor, device, driver)
    s = s.replace(/^ANGLE (Metal|Vulkan) Renderer: /, '').replace(/\s+(Direct3D\d*|vs_\d).*$/, '').replace(/\s*\(0x[0-9a-f]+\)/ig, '').replace(/\s+/g, ' ').trim() || 'unknown GPU';
    return s.length > 44 ? s.slice(0, 43) + '…' : s;
  }
  build() {
    this.el.innerHTML = `
      <div class="pf-compact"><b id="pf-c-fps">--</b> FPS <span id="pf-c-rest"></span></div>
      <div class="pf-full">
        <div class="pf-head"><span>Performance</span><kbd>F3</kbd></div>
        <div class="pf-row"><span class="pf-k">FPS</span><span><b id="pf-fps">--</b> <span id="pf-ft"></span></span></div>
        <div class="pf-row pf-sub"><span class="pf-k"></span><span id="pf-fps2"></span></div>
        <canvas id="pf-graph" width="248" height="44"></canvas>
        <div class="pf-row"><span class="pf-k">CPU</span><span><span id="pf-cpu">--</span> <span id="pf-cpu2" class="pf-dim"></span></span></div>
        <div id="pf-sec" class="pf-sec"></div>
        <div class="pf-row"><span class="pf-k">GPU</span><span><span id="pf-gpu">--</span> <span id="pf-bound" class="pf-tag"></span></span></div>
        <div class="pf-row pf-sub"><span class="pf-k"></span><span id="pf-gpuname"></span></div>
        <div class="pf-row"><span class="pf-k">Draws</span><span id="pf-draw">--</span></div>
        <div class="pf-row pf-sub"><span class="pf-k"></span><span id="pf-draw2"></span></div>
        <div class="pf-row"><span class="pf-k">RAM</span><span id="pf-ram">--</span></div>
        <div class="pf-row pf-sub"><span class="pf-k"></span><span id="pf-ram2"></span></div>
        <div class="pf-row"><span class="pf-k">VRAM</span><span id="pf-vram">--</span></div>
        <div class="pf-row pf-sub"><span class="pf-k"></span><span id="pf-vram2"></span></div>
        <div class="pf-row pf-sub"><span class="pf-k">View</span><span id="pf-res"></span></div>
      </div>`;
    const $ = (id) => this.el.querySelector('#' + id);
    this.$ = { cfps: $('pf-c-fps'), crest: $('pf-c-rest'), fps: $('pf-fps'), fps2: $('pf-fps2'), ft: $('pf-ft'), cpu: $('pf-cpu'), cpu2: $('pf-cpu2'), sec: $('pf-sec'), gpu: $('pf-gpu'), bound: $('pf-bound'), gpuname: $('pf-gpuname'), draw: $('pf-draw'), draw2: $('pf-draw2'), ram: $('pf-ram'), ram2: $('pf-ram2'), vram: $('pf-vram'), vram2: $('pf-vram2'), res: $('pf-res') };
    this.$.gpuname.textContent = this.gpuName;
    this.graph = $('pf-graph'); this.g2 = this.graph.getContext('2d');
    this.secRows = {};
    for (const s of SECTIONS) {
      const r = document.createElement('div'); r.className = 'pf-secrow';
      r.innerHTML = `<span>${LABEL[s]}</span><span>--</span><i><u></u></i>`;
      this.$.sec.appendChild(r); this.secRows[s] = { bar: r.querySelector('u'), v: r.children[1] };
    }
  }
  // ---- per-frame hooks (called by the game loop)
  frameStart(intervalMs) {
    if (!this.on) return;
    this.frames[this.fi] = intervalMs;
    this.renderer.info.reset();
    this.t0 = this.tl = performance.now();
    for (const s of SECTIONS) this.acc[s] = 0;
    this.pollGpu();
  }
  mark(section) {
    if (!this.on) return;
    const n = performance.now(); this.acc[section] += n - this.tl; this.tl = n;
  }
  gpuBegin() {
    if (!this.on || !this.ext || this.gpuActive || this.gpuQ.length > 3) return;
    const gl = this.gl, q = gl.createQuery(); gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.gpuActive = q;
  }
  gpuEnd() {
    if (!this.gpuActive) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.gpuQ.push(this.gpuActive); this.gpuActive = null;
  }
  pollGpu() {
    const gl = this.gl, ext = this.ext; if (!ext) return;
    while (this.gpuQ.length) {
      const q = this.gpuQ[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint) this.gpuLast = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q); this.gpuQ.shift();
    }
  }
  frameEnd(extra = {}) {
    if (!this.on) return;
    const cpu = performance.now() - this.t0;
    this.cpuHist[this.fi] = cpu; this.gpuHist[this.fi] = this.gpuLast;
    this.fi = (this.fi + 1) % this.frames.length; this.fcount = Math.min(this.fcount + 1, this.frames.length);
    const w = this.win; w.n++; w.cpu += cpu; for (const s of SECTIONS) w.sec[s] = (w.sec[s] || 0) + this.acc[s];
    w.gpu = (w.gpu || 0) + (this.gpuLast >= 0 ? this.gpuLast : 0); w.gpuN = (w.gpuN || 0) + (this.gpuLast >= 0 ? 1 : 0);
    const info = this.renderer.info.render; this.calls = info.calls; this.tris = info.triangles; this.points = info.points; this.lines = info.lines;
    const now = performance.now();
    if (this.full) this.drawGraph();
    if (now - w.t0 >= 500) {
      this.view.cpu = w.cpu / w.n; for (const s of SECTIONS) this.view.sec[s] = w.sec[s] / w.n;
      this.view.gpu = w.gpuN ? w.gpu / w.gpuN : -1;
      this.win = { n: 0, cpu: 0, t0: now, sec: {} };
      if (this.full && now - this.vramT > 2000) { this.vramT = now; try { this.vram = this.estimateVram(extra.scene, extra.composer); } catch (e) { this.vram = null; } }
      this.updateText(extra);
    }
  }
  // ---- stats
  frameStats() {
    const n = this.fcount; if (!n) return null;
    const a = []; for (let i = 0; i < n; i++) a.push(this.frames[(this.fi - 1 - i + this.frames.length) % this.frames.length]);
    const recent = a.slice(0, Math.min(n, 30)); const avgRecent = recent.reduce((s, v) => s + v, 0) / recent.length;
    const avg = a.reduce((s, v) => s + v, 0) / n;
    const sorted = a.slice().sort((x, y) => y - x); const k = Math.max(1, Math.floor(n * 0.01));
    const worst1 = sorted.slice(0, k).reduce((s, v) => s + v, 0) / k;
    return { fps: 1000 / avgRecent, ms: avgRecent, avgFps: 1000 / avg, low1: 1000 / worst1, maxMs: sorted[0], minMs: sorted[n - 1] };
  }
  updateText(extra) {
    const st = this.frameStats(); if (!st) return;
    const cls = (fps) => fps >= 55 ? 'pf-good' : fps >= 30 ? 'pf-ok' : 'pf-bad';
    const gpu = this.view.gpu, cpu = this.view.cpu;
    if (this.mode === 'compact') {
      this.$.cfps.textContent = st.fps.toFixed(0); this.$.cfps.className = cls(st.fps);
      this.$.crest.textContent = `· ${st.ms.toFixed(1)} ms · CPU ${cpu.toFixed(1)}${gpu >= 0 ? ' · GPU ' + gpu.toFixed(1) : ''} ms`;
      return;
    }
    this.$.fps.textContent = st.fps.toFixed(0); this.$.fps.className = cls(st.fps);
    this.$.ft.textContent = st.ms.toFixed(1) + ' ms';
    this.$.fps2.textContent = `avg ${st.avgFps.toFixed(0)} · 1% low ${st.low1.toFixed(0)} · worst ${st.maxMs.toFixed(0)} ms`;
    const busy = Math.min(100, cpu / st.ms * 100);
    this.$.cpu.textContent = cpu.toFixed(1) + ' ms';
    this.$.cpu2.textContent = `${busy.toFixed(0)}% of frame · ${navigator.hardwareConcurrency || '?'} threads`;
    const maxSec = Math.max(0.5, ...SECTIONS.map((s) => this.view.sec[s] || 0));
    for (const s of SECTIONS) { const v = this.view.sec[s] || 0; const r = this.secRows[s]; r.v.textContent = v.toFixed(2); r.bar.style.width = (v / maxSec * 100).toFixed(0) + '%'; }
    if (!this.ext) { this.$.gpu.innerHTML = '<span class="pf-dim">n/a (no GPU timer queries)</span>'; this.$.bound.textContent = ''; }
    else if (gpu < 0) { this.$.gpu.textContent = 'measuring…'; this.$.bound.textContent = ''; }
    else {
      this.$.gpu.textContent = gpu.toFixed(1) + ' ms';
      const b = gpu > cpu * 1.25 && st.ms > 17.5 ? 'GPU-bound' : cpu > gpu * 1.25 && st.ms > 17.5 ? 'CPU-bound' : st.ms <= 17.5 ? 'headroom' : '';
      this.$.bound.textContent = b; this.$.bound.className = 'pf-tag' + (b === 'headroom' ? ' pf-good' : b ? ' pf-ok' : '');
    }
    const mem = this.renderer.info.memory;
    this.$.draw.textContent = `${this.calls} calls · ${fmtCount(this.tris)} tris`;
    this.$.draw2.textContent = `${this.renderer.info.programs ? this.renderer.info.programs.length : '?'} shaders · ${mem.geometries} geo · ${mem.textures} tex`;
    const pm = performance.memory;
    const dev = navigator.deviceMemory ? `device ${navigator.deviceMemory >= 8 ? '≥8' : navigator.deviceMemory} GB` : 'device RAM hidden';
    this.$.ram.textContent = pm ? `JS heap ${(pm.usedJSHeapSize / MB).toFixed(0)} / ${(pm.totalJSHeapSize / MB).toFixed(0)} MB` : 'JS heap n/a';
    this.$.ram2.textContent = pm ? `limit ${(pm.jsHeapSizeLimit / MB / 1024).toFixed(1)} GB · ${dev}` : `Chrome/Edge only · ${dev}`;
    if (this.vram) {
      const v = this.vram;
      this.$.vram.textContent = `≈ ${(v.total / MB).toFixed(0)} MB (estimate)`;
      this.$.vram2.textContent = `mesh ${(v.geo / MB).toFixed(0)} · tex ${(v.tex / MB).toFixed(0)} · targets ${(v.rt / MB).toFixed(0)} MB`;
    } else this.$.vram.textContent = '…';
    const c = this.renderer.domElement;
    this.$.res.textContent = `${c.width}×${c.height} ×${this.renderer.getPixelRatio().toFixed(2)}${extra.quality ? ' · ' + extra.quality : ''}${extra.animals !== undefined ? ' · ' + extra.animals + ' animals' : ''}`;
  }
  drawGraph() {
    const g = this.g2, W = this.graph.width, H = this.graph.height, n = this.fcount, L = this.frames.length;
    g.clearRect(0, 0, W, H);
    const maxMs = 50, y = (ms) => H - Math.min(ms, maxMs) / maxMs * (H - 2) - 1;
    g.strokeStyle = 'rgba(235,227,208,.18)'; g.lineWidth = 1;
    for (const ms of [16.7, 33.3]) { g.beginPath(); g.moveTo(0, Math.round(y(ms)) + 0.5); g.lineTo(W, Math.round(y(ms)) + 0.5); g.stroke(); }
    const bw = W / L;
    for (let i = 0; i < n; i++) {
      const idx = (this.fi - n + i + L) % L, x = W - (n - i) * bw;
      const f = this.frames[idx];
      g.fillStyle = f > 33.4 ? 'rgba(232,116,58,.85)' : f > 17.5 ? 'rgba(211,149,74,.7)' : 'rgba(150,190,120,.55)';
      g.fillRect(x, y(f), Math.max(1, bw), H - y(f));
    }
    const line = (hist, col) => {
      g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); let started = false;
      for (let i = 0; i < n; i++) { const idx = (this.fi - n + i + L) % L, v = hist[idx]; if (v < 0) { started = false; continue; } const x = W - (n - i) * bw + bw / 2; if (!started) { g.moveTo(x, y(v)); started = true; } else g.lineTo(x, y(v)); }
      g.stroke();
    };
    line(this.cpuHist, 'rgba(120,190,235,.95)');
    if (this.ext) line(this.gpuHist, 'rgba(235,227,208,.95)');
    g.font = '9px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(150,190,120,.9)'; g.fillText('frame', 3, 2); g.fillStyle = 'rgba(120,190,235,.95)'; g.fillText('cpu', 36, 2);
    if (this.ext) { g.fillStyle = 'rgba(235,227,208,.95)'; g.fillText('gpu', 58, 2); }
    g.fillStyle = 'rgba(235,227,208,.45)'; g.textAlign = 'right'; g.fillText('60', W - 2, y(16.7) - 10); g.fillText('30', W - 2, y(33.3) - 10); g.textAlign = 'left';
  }
  // Rough GPU memory: unique vertex/index buffers, instance buffers, textures (with mip chains) and render targets.
  estimateVram(scene, composer) {
    let geo = 0, tex = 0, rt = 0;
    const seenG = new Set(), seenT = new Set(), seenRT = new Set();
    const attrBytes = (a) => (a && a.array ? a.array.byteLength : 0);
    const addGeo = (g) => { if (!g || seenG.has(g)) return; seenG.add(g); for (const k in g.attributes) attrBytes(g.attributes[k]) && (geo += attrBytes(g.attributes[k])); if (g.index) geo += attrBytes(g.index); };
    const texBytes = (t) => {
      const img = t.image || {}; const w = img.width || (t.source && t.source.data && t.source.data.width) || 0, h = img.height || 0, d = img.depth || 1;
      if (t.isCubeTexture && Array.isArray(t.image)) { const f = t.image[0] || {}; return (f.width || 0) * (f.height || 0) * 6 * texelBytes(t) * (t.generateMipmaps ? 1.33 : 1); }
      return w * h * d * texelBytes(t) * (t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 1.33 : 1);
    };
    const addTex = (t) => { if (!t || !t.isTexture || seenT.has(t) || t.isRenderTargetTexture) return; seenT.add(t); tex += texBytes(t); };
    const addRT = (r) => {
      if (!r || !r.isRenderTarget && !r.isWebGLRenderTarget || seenRT.has(r)) return; seenRT.add(r);
      const tx = r.textures || [r.texture]; let b = 0;
      for (const t of tx) b += r.width * r.height * (r.depth || 1) * texelBytes(t) * (t.generateMipmaps ? 1.33 : 1);
      if (r.depthBuffer) b += r.width * r.height * 4;
      rt += b * (r.isWebGLCubeRenderTarget ? 6 : 1);
    };
    const addMat = (m) => {
      if (!m) return;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) addTex(v); }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) addTex(v); else if (Array.isArray(v)) v.forEach((x) => x && x.isTexture && addTex(x)); }
    };
    if (scene) {
      scene.traverse((o) => {
        if (o.geometry) addGeo(o.geometry);
        if (o.isInstancedMesh) { geo += attrBytes(o.instanceMatrix); if (o.instanceColor) geo += attrBytes(o.instanceColor); }
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(addMat);
        if (o.isLight && o.shadow && o.shadow.map) addRT(o.shadow.map);
      });
      if (scene.environment && scene.environment.isRenderTargetTexture) { const im = scene.environment.image || {}; rt += (im.width || 0) * (im.height || 0) * texelBytes(scene.environment); }
      else addTex(scene.environment);
      if (scene.background && scene.background.isTexture) addTex(scene.background);
    }
    if (composer) {
      addRT(composer.renderTarget1); addRT(composer.renderTarget2);
      for (const p of composer.passes) for (const k in p) { const v = p[k]; if (v && (v.isRenderTarget || v.isWebGLRenderTarget)) addRT(v); else if (Array.isArray(v)) v.forEach(addRT); }
    }
    const c = this.renderer.domElement; const ctxAttr = this.gl.getContextAttributes() || {};
    rt += c.width * c.height * 4 * (ctxAttr.antialias ? 4 : 1) * 2 + c.width * c.height * 4; // swap chain (+ MSAA) and depth
    return { geo, tex, rt, total: geo + tex + rt };
  }
}

function texelBytes(t) {
  // THREE type constants: UnsignedByte 1009, HalfFloat 1016, Float 1015; formats: RGBA 1023, Red 1028, RG 1030, Depth 1026
  const per = t.type === 1015 ? 4 : t.type === 1016 ? 2 : (t.type === 1012 || t.type === 1013 || t.type === 1014) ? 4 : 1;
  const ch = t.format === 1028 || t.format === 1026 ? 1 : t.format === 1030 ? 2 : 4;
  return per * ch;
}
function fmtCount(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(0) + ' k' : String(n); }

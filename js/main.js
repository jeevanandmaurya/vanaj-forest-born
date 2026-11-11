// VANAJ — main: boot, renderer + post-processing, game loop, interactions, crafting, sleep, save/load, menus.
import * as THREE from 'three';
import { GodRaysShader } from './core/godrays.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { loadRigs } from './actors/rigged.js';
import { loadHumanRig, prebuildBodies } from './actors/humanrig.js';
import { loadSculptCache } from './actors/sculpt.js';
import { GroundAO } from './world/groundao.js';
import { PerfOverlay } from './core/perf.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from './core/shaderlib.js';
import { Physics, initPhysics } from './core/physics.js';
import { LooseThings } from './world/loose.js';
import { NearTrees } from './world/neartree.js';
import { Ropes } from './world/ropes.js';
import { PAINTED, setPaintedSeason } from './core/palette.js';
import { clamp, lerp, smoothstep } from './core/noise.js';
import { buildTextures } from './world/textures.js';
import { TerrainManager, groundHeight, waterAt, renderMapCanvas, height, biomeAt, nearestWaterPoint, riverX, riverY, RIVER_W } from './world/terrain.js';
import { Vegetation, Grass, SP } from './world/flora.js';
import { VineSystem } from './world/vines.js';
import { SkySystem } from './world/sky.js';
import { Weather, SEASONS } from './world/weather.js';
import { Water } from './world/water.js';
import { FX } from './world/fx.js';
import { Props, SITES } from './world/props.js';
import { Ecosystem, DEF } from './actors/animals.js';
import { Birds } from './world/birds.js';
import { PlaceTracker } from './world/places.js';
import { Tracks } from './world/tracks.js';
import { GroundCover } from './world/groundcover.js';
import { Player } from './actors/player.js';
import { buildHumanoid } from './actors/humanoid.js';
import { AudioEngine } from './audio/audio.js';
import { Music } from './audio/music.js';
import { Inventory, Pickups, ITEMS, RECIPES } from './game/items.js';
import { Story } from './game/story.js';
import { UI } from './game/ui.js';
import { TouchControls, isTouchDevice, canFullscreen, isFullscreen, goFullscreen } from './game/touch.js';
import { Opening } from './game/opening.js';
import { Lessons } from './game/lessons.js';
import { Felling } from './world/felling.js';
import { Director, Emotes } from './sim/director.js';
import { Forest } from './sim/forest.js';
import { Talk } from './game/dialogue.js';
import { Barks } from './game/barks.js';

const _grv = new THREE.Vector3(), _grd = new THREE.Vector3(), _grc = new THREE.Color();
const DEF_NAMES = { chital: 'chital', sambar: 'sambar', gaur: 'gaur', boar: 'boar', langur: 'langur', peafowl: 'peacock', bear: 'bear', dhole: 'dhole', leopard: 'leopard', tiger: 'tiger', mugger: 'mugger', cow: 'cow', dog: 'dog', wolf: 'wolf' };
// Low is the phone level at 60 FPS, and what it costs is mostly draw calls, each of which takes three.js some 15 microseconds on a
// laptop and several times that on a phone, before its GPU does anything. What each extra setting does:
// lean: the light forms of everything: trees, ground shader, near trees, small props casting no shadow, post-processing in one pass.
// shadowEvery: redraw the shadow map every Nth frame while he stands still. softShadow: 17 shadow samples a pixel, or 4 if false.
// treeVariants: how many shapes of each species are in use (teak has one more: each shape is two or four more draw calls). farOneShape:
// past the near trees, only one shape of each. treeThin: the share of trees kept in the outer half of the view.
// chunkSegs: cells a side in a ground chunk: beside him, one further, the rest. farSegs: the same for the map-wide ground mesh.
// waterFine, waterFar: how far water is drawn in full, and at all. fireLights: lights for fires and torches: every pixel of every lit
// surface pays for each, on or off. nearMax, nearR: how many soft near trees, and how far (0: only the one he is climbing).
// animalDraw, inkDraw, animalShadow: metres at which an animal is drawn, is outlined, casts a shadow (villagers too).
// aiNear, aiMid: metres out to which animals think every frame, then at 15 Hz; beyond that 7 Hz and 4 Hz. actorR: metres out to
// which they move through the physics world. animStep: seconds between poses for an animal 20 m away, doubled past 50 m.
// physStep, poseStep: seconds between steps of the physics world, and between poses of his body. bodyDetail, npcDetail: cell size of the
// sculpted bodies, at loading (3 is about a ninth of the triangles of 1).
const QUALITY = {
  low: { name: 'Low', lean: true, pr: 0.7, shadow: 1024, shadowDist: 30, shadowEvery: 2, softShadow: false, farPics: true, treeNear: 36, treeFar: 230, treeVariants: 1, farOneShape: true, treeThin: 0.7, grassR: 24, grassDensity: 0.4, grassCap: 2500, bloom: false, chunkR: 2, chunkSegs: [56, 24, 12], farSegs: 160, waterFine: 90, waterFar: 500, fireLights: 1, env: false, treeCap0: 500, treeCap1: 2400, rainDrops: 1200, aa: false, animalDraw: 120, inkDraw: 24, animalShadow: 22, aiNear: 20, aiMid: 90, actorR: 20, animStep: 0.05, physStep: 1 / 30, poseStep: 1 / 30, ropeMax: 12, looseR: 14, nearMax: 1, nearR: 0, bodyDetail: 3, npcDetail: 3.2 },
  medium: { name: 'Medium', farPics: true, pr: 1.0, shadow: 2048, shadowDist: 55, treeNear: 75, treeFar: 520, grassR: 38, grassDensity: 0.75, grassCap: 7000, bloom: true, chunkR: 4, waterFine: 220, env: true, treeCap0: 1300, treeCap1: 6500, rainDrops: 4000, aa: false, animalDraw: 240, inkDraw: 45, animalShadow: 55, aiNear: 40, aiMid: 120, actorR: 22, animStep: 0.033, nearMax: 5, nearR: 22 },
  high: { name: 'High', pr: 1.25, shadow: 2048, shadowDist: 70, treeNear: 125, treeFar: 700, grassR: 52, grassDensity: 1.0, grassCap: 10000, bloom: true, chunkR: 5, waterFine: 300, env: true, treeCap0: 1800, treeCap1: 9000, rainDrops: 5000, aa: true, animalDraw: 340, inkDraw: 70, animalShadow: 55, aiNear: 45, aiMid: 150, actorR: 22, animStep: 0.033, nearMax: 7, nearR: 26 },
  ultra: { name: 'Ultra', pr: 2.0, shadow: 4096, shadowDist: 90, treeNear: 170, treeFar: 900, grassR: 68, grassDensity: 1.3, grassCap: 16000, bloom: true, chunkR: 6, waterFine: 400, env: true, treeCap0: 2600, treeCap1: 13000, rainDrops: 6000, aa: true, animalDraw: 420, inkDraw: 110, animalShadow: 70, aiNear: 50, aiMid: 200, actorR: 22, animStep: 0.025, nearMax: 8, nearR: 30 },
};
// what the levels above don't set: everything at full
const LEVEL_DEFAULTS = { farPics: false, lean: false, shadowEvery: 1, softShadow: true, treeVariants: 99, farOneShape: false, treeThin: 1, chunkSegs: [128, 32, 16], physStep: 0, poseStep: 0, ropeMax: 44, looseR: 26, farSegs: 256, fireLights: 3, bodyDetail: 1, npcDetail: 1.7 };
for (const k in QUALITY) QUALITY[k] = { ...LEVEL_DEFAULTS, ...QUALITY[k] };
// Medium on a phone, for 30 FPS: twice Low's time to spend a frame, so about twice Low's work, not the 4.8 million triangles, bloom and
// edge smoothing of Medium on a computer. It has the further view, more shapes of tree, more grass and longer shadows.
const PHONE_LEVEL = {
  medium: { lean: true, shadow: 1536, shadowDist: 32, softShadow: false, treeNear: 44, treeFar: 330, treeVariants: 1, farOneShape: true, treeThin: 0.85, grassR: 30, grassDensity: 0.55, grassCap: 4000, bloom: false, chunkR: 2, chunkSegs: [64, 32, 16], farSegs: 160, waterFine: 120, waterFar: 900, fireLights: 1, treeCap0: 800, treeCap1: 3600, rainDrops: 2000, animalDraw: 170, inkDraw: 35, animalShadow: 22, aiNear: 24, aiMid: 100, actorR: 24, animStep: 0.05, physStep: 1 / 30, poseStep: 1 / 30, ropeMax: 14, looseR: 18, nearMax: 1, nearR: 0, bodyDetail: 2, npcDetail: 2.6 },
};
// High and Ultra were the computer's own on a phone too: 4x smoothing, bloom, twice the pixels, six times the triangles. Measured on a
// Mali-G57 that was 3 frames a second. On a phone they are the computer's Medium (High without bloom), which is the most a phone's GPU can
// be asked for, at 30.
PHONE_LEVEL.high = { ...QUALITY.medium, name: 'High', bloom: false, shadow: 1536, softShadow: false };
PHONE_LEVEL.ultra = { ...QUALITY.medium, name: 'Ultra', softShadow: false };
const levelOf = (name) => (QUALITY[name] && isTouchDevice() ? { ...QUALITY[name], ...PHONE_LEVEL[name] } : QUALITY[name]);
// Low's shadow filter: four samples in a small rotated square in place of three.js's one (a hard, stepped edge) on the "basic"
// shadow type. It costs about a quarter of the soft filter's seventeen, on every pixel of ground and bark.
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace('shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );', `vec2 st = 0.75 / shadowMapSize;
      shadow = 0.25 * ( texture2DCompare( shadowMap, shadowCoord.xy + st * vec2( -0.4, -1.0 ), shadowCoord.z ) + texture2DCompare( shadowMap, shadowCoord.xy + st * vec2( 1.0, -0.4 ), shadowCoord.z )
        + texture2DCompare( shadowMap, shadowCoord.xy + st * vec2( 0.4, 1.0 ), shadowCoord.z ) + texture2DCompare( shadowMap, shadowCoord.xy + st * vec2( -1.0, 0.4 ), shadowCoord.z ) );`);
const $ = (id) => document.getElementById(id);
// one painted frame (a timer stands in when the tab is hidden and gets no animation frames)
const nextFrame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); });
const tick = () => new Promise((r) => setTimeout(r, 0));
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };

class Input {
  constructor(dom) {
    this.keys = {}; this.down = new Set(); this.buttons = [false, false, false]; this.mdown = new Set(); this.mdx = 0; this.mdy = 0; this.wheel = 0; this.mdxLast = 0; this.mdyLast = 0;
    window.addEventListener('keydown', (e) => { if (['Tab', 'Space'].includes(e.code) && game.playing) e.preventDefault(); if (!this.keys[e.code]) this.down.add(e.code); this.keys[e.code] = true; game.onKey(e); });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; game.onKeyUp(e); });
    window.addEventListener('mousedown', (e) => { if (!game.playing) return; if (game.arrival) { game.arrival.speed = 4; return; } this.buttons[e.button] = true; this.mdown.add(e.button); if (!document.pointerLockElement && !game.uiBlocking) game.requestLock(); });
    window.addEventListener('mouseup', (e) => { this.buttons[e.button] = false; });
    window.addEventListener('mousemove', (e) => { this.cx = e.clientX / innerWidth; this.cy = e.clientY / innerHeight; if (document.pointerLockElement || game.dragLook) { this.mdx += e.movementX || 0; this.mdy += e.movementY || 0; } });
    document.addEventListener('pointerlockerror', () => { game.dragLook = true; });
    document.documentElement.addEventListener('mouseleave', () => { this.cx = 0.5; this.cy = 0.5; });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.keys = {}; this.buttons = [false, false, false]; });
  }
  pressed(c) { return this.down.has(c); }
  pressedMouse(b) { return this.mdown.has(b); }
  endFrame() { this.down.clear(); this.mdown.clear(); this.mdxLast = this.mdx; this.mdyLast = this.mdy; this.wheel = 0; }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.9 }, uGrain: { value: 0.012 }, uHurt: { value: 0 }, uLow: { value: 0 }, uFlash: { value: 0 }, uUnder: { value: 0 }, uNight: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1.05 }, uHeat: { value: 0 }, uBlur: { value: 0 }, uExposure: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uHurt, uLow, uFlash, uUnder, uNight, uSat, uHeat, uBlur, uExposure; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    #ifdef FINAL
    // three.js's neutral tone mapping and sRGB encoding, as its output pass would do them in a pass of their own
    vec3 neutral(vec3 color){
      float x = min(color.r, min(color.g, color.b)), offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < 0.76) return color;
      float d = 0.24, newPeak = 1.0 - d * d / (peak + d - 0.76);
      color *= newPeak / peak;
      float g = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
      return mix(color, vec3(newPeak), g);
    }
    vec3 encode(vec3 v){ return mix(pow(v, vec3(0.41666)) * 1.055 - 0.055, v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308)))); }
    // FXAA, the small form: the jagged edges of the cut-out leaves and of a picture drawn at a phone's lower size, smoothed in this same pass. Looks at the four
    // corners, and only an edge pays for more. (4x MSAA was measured on a Mali-G57: 58 to 37 FPS. In WebGL it has to be resolved from a target of its own.)
    float lm(vec3 c){ return sqrt(dot(c, vec3(0.299, 0.587, 0.114))); }
    vec3 fxaa(vec2 uv){
      vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
      vec3 M = texture2D(tDiffuse, uv).rgb;
      float m = lm(M), nw = lm(texture2D(tDiffuse, uv + px * vec2(-0.5, -0.5)).rgb), ne = lm(texture2D(tDiffuse, uv + px * vec2(0.5, -0.5)).rgb), sw = lm(texture2D(tDiffuse, uv + px * vec2(-0.5, 0.5)).rgb), se = lm(texture2D(tDiffuse, uv + px * vec2(0.5, 0.5)).rgb);
      float lo = min(m, min(min(nw, ne), min(sw, se))), hi = max(m, max(max(nw, ne), max(sw, se)));
      if (hi - lo < max(0.03, hi * 0.1)) return M;
      vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
      float k = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((nw + ne + sw + se) * 0.03125, 0.0078125));
      dir = clamp(dir * k, -6.0, 6.0) * px;
      vec3 A = 0.5 * (texture2D(tDiffuse, uv - dir * 0.1667).rgb + texture2D(tDiffuse, uv + dir * 0.1667).rgb);
      vec3 B = A * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float b = lm(B);
      return b < lo || b > hi ? A : B;
    }
    #endif
    void main(){
      vec2 uv = vUv;
      if (uHeat > 0.0) uv += vec2(sin(uv.y * 90.0 + uTime * 3.1), cos(uv.x * 70.0 + uTime * 2.3)) * 0.0011 * uHeat * smoothstep(0.65, 0.2, uv.y);
      if (uUnder > 0.0) uv += vec2(sin(uv.y * 30.0 + uTime * 2.0), cos(uv.x * 25.0 + uTime * 1.7)) * 0.003 * uUnder;
      #ifdef FINAL
      vec3 c = fxaa(uv);
      #else
      vec3 c = texture2D(tDiffuse, uv).rgb;
      #endif
      if (uBlur > 0.0) { vec3 b = vec3(0.0); for (int i = 0; i < 6; i++) { float a = float(i) * 1.047; b += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * 0.004 * uBlur).rgb; } c = mix(c, b / 6.0, 0.7); }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c *= uTint;
      c = mix(c, vec3(l) * vec3(0.55, 0.72, 1.15), uNight * 0.45);
      c = mix(c, c * vec3(0.22, 0.5, 0.46) + vec3(0.0, 0.025, 0.03), uUnder);
      vec2 d = vUv - 0.5; float v = dot(d, d);
      c *= 1.0 - v * uVig;
      c = mix(c, c * vec3(1.35, 0.35, 0.3), uHurt * smoothstep(0.05, 0.35, v));
      c = mix(c, vec3(l) * 0.9, uLow * 0.75);
      c += vec3(0.75, 0.82, 1.0) * uFlash * 0.5;
      #ifdef FINAL
      gl_FragColor = vec4(encode(clamp(neutral(max(c, 0.0) * uExposure), 0.0, 1.0)), 1.0);
      #else
      c += (h(vUv * 1024.0 + fract(uTime) * 37.0) - 0.5) * uGrain * (0.4 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
      #endif
    }`,
};
// The grade and the output in one pass, for Low: one full-screen pass and one render target fewer
const FinalGradeShader = { ...GradeShader, defines: { FINAL: 1 } };
// A phone's tile-based GPU writes every buffer it has drawn out to memory when a pass ends, unless it is told a buffer is finished
// with. Nothing reads the scene's depth again, and writing it out is a real share of what drawing a frame costs in memory traffic.
class DropDepth extends Pass {
  constructor() { super(); this.needsSwap = false; }
  render(r, w, read) { r.setRenderTarget(read); const gl = r.getContext(); gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH_ATTACHMENT]); }
}

class Game {
  constructor() {
    this.playing = false; this.paused = false; this.uiBlocking = true; this.timeScale = 1; this.hitstopT = 0; this.slowT = 0; this.slowK = 1;
    this.clock = 0; this.timers = []; this.listeners = {};
    this.time = { hour: 7, day: 0, rate: 60 };
    this.season = 'winter'; this.seasonCfg = SEASONS.winter;
    this.camps = []; this.flags = {}; this.npcs = [];
    this.settings = Object.assign({ quality: 'medium', sens: 1, invert: false, fov: 55, view: 'tpp', master: 0.9, music: 0.5, density: 1, perf: 'off', gentle: true }, store.get('vanaj-settings') || {});
    // (a phone held sideways is about twice as wide as it is high: 72 degrees up and down is 116 across, far more than the eye wants on a small screen and
    // far more to draw. 72 was the old default for everyone, so a saved 72 counts as not chosen.)
    if (this.settings.fov === 72 || this.settings.fov === 58) this.settings.fov = 55;
    if (this.settings.music === 0.7) this.settings.music = 0.5;   // (likewise the old music level)   // (the old defaults count as not chosen)
    const qp = new URLSearchParams(location.search);
    // phones and tablets start on Medium (unless a quality was chosen) and draw at CSS-pixel resolution
    const touch = isTouchDevice(), chosen = (store.get('vanaj-settings') || {}).qualityChosen;
    this.q = { ...(levelOf(qp.get('q') || (touch && !chosen ? 'medium' : this.settings.quality)) || levelOf('medium')) };
    this.prFixed = qp.get('pr') ? +qp.get('pr') : touch ? 1 : 0;   // a render scale that no quality level may change
    if (this.prFixed) this.q.pr = this.prFixed;
    this.fpsParam = qp.has('fps') ? +qp.get('fps') : undefined;
    this.pickFrameLimit();
    this.noRender = qp.has('norender'); if (this.noRender) { this.q.env = false; }
    this.cooldowns = new Map();
  }
  // The frame rate to hold. On a phone: 60 on Low and Medium, 30 above that, unless Settings says otherwise. A steady 30 is kinder to a
  // phone than an uneven 45, which heats it up until it slows down. On a computer: as fast as the screen goes (0).
  pickFrameLimit() {
    this.fpsCap = this.fpsParam ?? this.settings.fps ?? (isTouchDevice() ? (this.q.lean ? 60 : 30) : 0);
    this.nextFrameT = 0;
  }
  // -------------------------------------------------------------------------------- events
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return () => { const a = this.listeners[ev]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  emit(ev, data = {}) { for (const fn of [...(this.listeners[ev] || [])]) fn(data); if (ev !== '*') for (const fn of [...(this.listeners['*'] || [])]) fn({ ev, ...data }); }
  wait(sec) { return new Promise((res) => this.timers.push({ t: sec, res })); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(k, dur) { this.slowK = k; this.slowT = dur; }
  // -------------------------------------------------------------------------------- boot
  async boot() {
    // once the game has loaded, everything it fetched is kept for next time (see sw.js)
    if ('serviceWorker' in navigator && /^http/.test(location.protocol) && !new URLSearchParams(location.search).has('nosw')) navigator.serviceWorker.register('./sw.js').catch(() => {});
    // let the bar paint between steps; a hidden tab gets no animation frames, so a timer keeps loading going there
    const bootT0 = this.bootT0 = performance.now(); this.bootLog = [];
    const prog = (p, t) => { this.bootLog.push([t, Math.round(performance.now() - bootT0)]); $('load-bar').style.width = (p * 100).toFixed(0) + '%'; $('load-step').textContent = t; return new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 120); }); };
    await prog(0.02, 'Waking the renderer');
    const physReady = initPhysics();   // Rapier's WASM compiles while the world builds
    const bodiesKept = loadSculptCache();   // the bodies sculpted on an earlier visit, read back while the world builds
    const q = this.q;
    // (no depth buffer on the page's own canvas: the scene draws into the composer's target, and only full-screen passes reach this one)
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: q.aa, powerPreference: 'high-performance', stencil: false, depth: false });
    // (reading every program's compile status back makes the browser wait for it, there and then. ?debug shows shader errors again.)
    renderer.debug.checkShaderErrors = new URLSearchParams(location.search).has('debug');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    renderer.setSize(window.innerWidth, window.innerHeight, false);   // (the page's style sheet makes it fill the screen: see resize())
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // the painted look keeps its palette's colours as painted: neutral tone mapping, not filmic
    renderer.toneMapping = PAINTED ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = PAINTED ? 1 : 0.9;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = q.softShadow ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    $('app').prepend(renderer.domElement); renderer.domElement.id = 'gl';
    this.perf = new PerfOverlay(renderer, { mode: new URLSearchParams(location.search).get('perf') || this.settings.perf, onChange: (m) => { this.settings.perf = m; store.set('vanaj-settings', this.settings); const sel = $('set-perf'); if (sel) sel.value = m; } });
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x888888, 0.0001);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 4200);
    this.input = new Input(renderer.domElement);
    this.audio = new AudioEngine({ lite: isTouchDevice() });
    this.ui = new UI(this); this.ui.init();
    if (isTouchDevice()) this.touchUI = new TouchControls(this);
    await prog(0.06, 'Painting bark, leaves and leaf litter');
    this.T = buildTextures();
    await prog(0.25, 'Raising the Satpura hills');
    this.terrain = new TerrainManager(this.scene, this.T, q);
    await prog(0.35, 'Growing teak, mahua, saja, kulu, palash and bamboo');
    this.veg = new Vegetation(this.scene, this.T, q);
    this.grass = new Grass(this.scene, q);
    this.vines = new VineSystem(this.scene, this.veg);
    this.cover = new GroundCover(this.scene, this.T || T, q);
    if (PAINTED) this.cover.leaves.visible = false;   // the painted ground draws its own fallen leaves
    await prog(0.44, 'Shaping the trees close at hand');
    this.near = new NearTrees(this); this.near.prebuild(); this.ropes = new Ropes(this);
    await prog(0.5, 'Placing rocks, termite mounds, the den, the shrine and the village');
    this.props = new Props(this.scene, this.T, this.veg, q); this.props.build();
    // the props stand still, so the matrix of each need not be worked out again every frame
    this.props.group.updateMatrixWorld(true); this.props.group.traverse((o) => { o.matrixAutoUpdate = false; });
    this.groundAO = new GroundAO(q.lean ? 128 : 256);
    this.veg.onRebuild = (rect, trees) => this.groundAO.update(rect, trees, this.props.colliders || []);
    await prog(0.62, 'Filling the Pench river and Totladoh');
    this.water = new Water(this.scene, q);
    this.sky = new SkySystem(this.scene, renderer, q); if (this.noRender) this.sky.sampleOk = false;
    this.weather = new Weather(this.scene, q, this.audio);
    this.fx = new FX(this.scene, this.T, q);
    this.pickups = new Pickups(this.scene, this.T);
    await prog(0.66, 'Bringing in the chital, sambar, gaur and dholes');
    await Promise.all([loadRigs(), loadHumanRig(), bodiesKept]); this.bootLog.push(['  (models read)', Math.round(performance.now() - bootT0)]);
    prebuildBodies(q.npcDetail); this.bootLog.push(['  (villager bodies made)', Math.round(performance.now() - bootT0)]);   // the villagers' bodies, once each (about 1.5 s)
    this.eco = new Ecosystem(this.scene, q);
    this.birds = new Birds(this.scene, this);
    this.tracks = new Tracks(this.scene, this);
    this.places = new PlaceTracker(document.getElementById('place'));
    this.inv = new Inventory();
    this.player = new Player(this);
    this.bootLog.push(['  (the boy made)', Math.round(performance.now() - bootT0)]);
    this.player.setView(this.settings.view);
    this.story = new Story(this);
    this.lessons = new Lessons(this);
    this.director = new Director(this); this.forest = new Forest(this); this.talk = new Talk(this); this.barks = new Barks(this); this.emotes = new Emotes(this.scene); this.emotes.build();
    // an animal coming into the world starts from what its kind thinks of him
    { const add = this.eco.add.bind(this.eco); this.eco.add = (a) => { add(a); this.director.greet(a); return a; }; }
    this.W = this.makeWorldInterface();
    await prog(0.72, 'Drawing the map');
    this.mapImage = renderMapCanvas(384);
    await prog(0.78, 'Building terrain around the den');
    const den = SITES.den; this.player.pos.set(den.x + 3, height(den.x + 3, den.z + 6), den.z + 6);
    this.terrain.update(this.player.pos.x, this.player.pos.z, 1e9, true);
    this.veg.update(this.player.pos, true); this.grass.update(this.player.pos, true); this.cover.update(this.player.pos, true); this.pickups.update(this.player.pos, true);
    await prog(0.82, 'Waking the physics');
    await physReady; this.phys = new Physics(this); this.phys.buildProps(this.props); this.props.mergeStatic(); this.phys.sync(this.player.pos, true);
    this.loose = new LooseThings(this.scene, this.phys, q);
    this.felling = new Felling(this);
    this.applySmallShadows();
    await prog(0.86, 'Post-processing');
    this.buildComposer();
    this.setSeason('winter', 'mist'); this.setTime(6.5);
    await prog(0.92, 'Compiling shaders');
    this.near.update(this.player.pos, 0.016); this.near.t = 0;   // so the near trees' shaders compile with the rest
    try { this.sky.update(0.016, this.time.hour, this.seasonCfg.decl, this.weather.env, this.camera, this.player.pos, this.season); if (!this.noRender) await this.warmShaders(); } catch (e) { console.warn(e); }
    this.felling.ready();
    this.veg.warmed = true;   // (tree meshes with nothing to draw can now leave the scene: their shaders are compiled)
    this.titleShot(4); { const c = this.camera.position; this.terrain.update(c.x, c.z, 1e9, true); this.veg.update(c, true); this.grass.update(c, true); }
    await prog(0.97, 'Tuning the bansuri');
    this.inMenu = true; this.startAudio(); this.audio.setWorld(false, 0); if (this.music) this.music.titleStart();
    await prog(1, 'Ready');
    window.addEventListener('resize', () => this.resize());
    this.setupMenus();
    await this.offerFullscreen();
    $('loading').classList.add('hide');
    $('title').classList.add('show');
    this.started = true; if (this.touchUI) this.touchUI.noteTurn();
    this.titleCam = 4;   // past the reach's opening dip to black
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
  // Loading is done. A phone needs a first tap in any case (a browser allows sound and full screen only from one), so this is where full
  // screen is offered, in the loading screen itself as its bar finishes. Staying in the browser is remembered, and Settings has it after that.
  offerFullscreen() {
    if (!this.touch || !canFullscreen() || isFullscreen() || this.settings.stayInBrowser) return null;
    return new Promise((done) => {
      $('loading').classList.add('ready');
      $('go-full').onclick = () => { goFullscreen(); done(); };
      $('go-stay').onclick = () => { this.settings.stayInBrowser = true; store.set('vanaj-settings', this.settings); done(); };
    });
  }
  // The title drifts down the Pench along its edges: over the water a few metres out from one bank, sweeping
  // slowly across to the other, always looking downstream (south). The reach runs 1.5-2.9 km from the village at
  // the river's north end and never looks that way, so the village stays hidden until the story reaches it.
  // At the end of the reach the picture dips to black and starts again.
  titleShot(t) {
    const Z0 = -250, LEN = 1350, SPEED = 3.2, d = (t * SPEED) % LEN, z = Z0 + d;
    const side = Math.sin(t * 0.045), x = riverX(z) + side * (RIVER_W - 2.5);
    this.camera.position.set(x, riverY(z) + 4.2 + Math.sin(t * 0.11) * 1.1, z);
    const zt = z + 45;
    this.camera.lookAt(riverX(zt) - side * 6, riverY(zt) + 1.6, zt);
    if (!this.starting) { const f = $('fade'), k = Math.max(0, 1 - d / 12, 1 - (LEN - d) / 12); f.style.transition = 'none'; f.style.opacity = k; }
  }
  // Build every shader program the game will need before play. Three keys a program on the render target it
  // draws to (colour space, tone mapping), so compiling against the screen, as before, made programs the
  // composer never uses. A program first needed mid-game (an animal or villager spawning) stalled that frame
  // for up to two seconds. So: put one of every animal (both sexes, for the rigged ones' two models) and a
  // villager in view, compile against the composer's own target, then draw one real frame so the shadow-map
  // variants build too, and take them away again.
  // Asked for together, the browser compiles them on other threads where it can (the loading bar stays alive), and it keeps compiled programs
  // on disk, so from the second visit on this step takes a fraction of the time, as long as the shaders' text is the same each time.
  async warmShaders() {
    const r = this.renderer, P = this.player.pos, cam = this.camera, extra = [];
    cam.position.set(P.x, P.y + 4, P.z + 10); cam.lookAt(P.x, P.y + 1, P.z); cam.updateMatrixWorld();
    let i = 0;
    for (const sp of Object.keys(DEF)) for (const male of [false, true]) {
      const a = this.eco.spawnOne(sp, new THREE.Vector3(P.x + ((i % 8) - 3.5) * 2.4, 0, P.z - 2 - Math.floor(i / 8) * 3), { persistent: true, male });
      a.root.updateMatrixWorld(true); extra.push(a); i++;
    }
    const npc = buildHumanoid({ skinColor: 0x9a6a4a, hair: 'short', cloth: 'dhoti', clothTex: this.T.clothRed, topTex: this.T.clothKhaki, turban: this.T.clothRed, skinKey: 'skin-npc' });
    npc.root.position.set(P.x + 3, P.y, P.z); this.scene.add(npc.root); npc.root.updateMatrixWorld(true);
    // every other build of villager has its own skin shader
    const others = [{ cloth: 'sari', clothTex: this.T.clothRed }, { cloth: 'sari', clothTex: this.T.clothRed, age: 1 }, { build: 'child', scale: 0.8, cloth: 'dhoti', clothTex: this.T.clothWhite }].map((o, k) => {
      const h = buildHumanoid({ skinColor: 0x9a6a4a, hair: 'short', skinKey: 'skin-npc' + k, ...o });
      h.root.position.set(P.x + 4 + k, P.y, P.z); this.scene.add(h.root); h.root.updateMatrixWorld(true); return h;
    });
    if (this.veg.far) this.veg.far.tick(r, this.sky, 0);
    // and what only turns up later: everything he can hold, the first-person arms, a campfire's stones, wood and embers
    const Pl = this.player, held = Object.values(Pl.W3).filter(Boolean), vmHeld = Object.values(Pl.vmW).filter(Boolean), vmOn = Pl.vm.root.visible;
    for (const m of held) { m.position.set(P.x, P.y + 1, P.z); this.scene.add(m); }
    for (const m of vmHeld) Pl.vmScene.add(m);
    Pl.vm.root.visible = true;
    const mark = this.emotes.pool[0].s; mark.position.set(P.x, P.y + 2, P.z); mark.visible = true;
    const fireParts = [new THREE.MeshStandardMaterial({ color: 0x6e665c, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: this.T.bark.teak, color: 0x7a5a3a }), new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff4a10, emissiveIntensity: 1.2 })].map((mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat); m.position.set(P.x, P.y, P.z); m.castShadow = m.receiveShadow = true; this.scene.add(m); return m; });
    r.setRenderTarget(this.composer.renderTarget1); const compiled = Promise.all([r.compileAsync(this.scene, cam), r.compileAsync(Pl.vmScene, Pl.vmCam)]); r.setRenderTarget(null);
    await Promise.race([compiled, new Promise((res) => setTimeout(res, 20000))]);
    if (this.bootLog) this.bootLog.push(['(shaders compiled, first frame next)', Math.round(performance.now() - this.bootT0)]);
    this.composer.render(0.016);
    for (const m of [...held, ...fireParts]) this.scene.remove(m);
    for (const m of vmHeld) Pl.vmScene.remove(m);
    Pl.vm.root.visible = vmOn; Pl.equip(this.inv.equipped);
    mark.visible = false;
    for (const a of extra) this.eco.remove(a);
    this.scene.remove(npc.root); for (const h of others) this.scene.remove(h.root);
  }
  buildComposer() {
    const r = this.renderer, [w, h] = this.viewSize();
    this.godrays = this.bloom = this.smaa = null;
    // Lean: 8-bit sRGB (half the memory traffic of half-float, and no banding, for a picture with no bloom to need the extra range),
    // and the grade and output as one pass
    const lean = PAINTED && this.q.lean;
    const rt = new THREE.WebGLRenderTarget(w, h, lean ? { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, samples: 0 } : { type: THREE.HalfFloatType, samples: this.q.aa ? 4 : 0 });
    this.composer = new EffectComposer(r, rt);
    // (given its own target, the composer assumes a render scale of 1: Low drew the whole scene at full size, then squeezed
    // it into its smaller canvas, paying full price for a blurrier picture)
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.name !== 'Low' && !PAINTED) {
      this.godrays = new ShaderPass(GodRaysShader);
      this.godrays.material.defines.GR_SAMPLES = this.q.name === 'Medium' ? 20 : 30;
      this.composer.addPass(this.godrays);
    }
    const vm = this.vmPass = new RenderPass(this.player.vmScene, this.player.vmCam); vm.clear = false; vm.clearDepth = true; this.composer.addPass(vm);
    if (lean) this.composer.addPass(new DropDepth());
    if (this.q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.55, 0.92); this.composer.addPass(this.bloom); }
    this.grade = new ShaderPass(lean ? FinalGradeShader : GradeShader); this.composer.addPass(this.grade);
    if (PAINTED) { this.grade.uniforms.uGrain.value = 0; this.grade.uniforms.uVig.value = 0.45; }
    if (!lean) this.composer.addPass(new OutputPass());
    if (!this.q.aa && !this.q.lean) { this.smaa = new SMAAPass(w * r.getPixelRatio(), h * r.getPixelRatio()); this.composer.addPass(this.smaa); }
  }
  // Holding the frame rate on a phone. Phones vary too much to guess, and they slow down as they heat up, so once a second this looks at
  // how the last second went. Late, with the game's own code taking most of the frame, the CPU is the limit, and less is drawn and
  // worked out (setDetail); late with time to spare in the code, the GPU is, and the picture is drawn smaller (and then less again, if
  // it is already as small as it should go). Back up, a step at a time, after a good run, and only after a longer one each time going
  // back up turned out to be too much.
  holdFrameRate(t, busy) {
    const A = this.auto || (this.auto = { n: 0, ms: 0, busy: 0, last: t, scale: 1, detail: 0, ok: 0, wait: 4, raised: false, settle: 0 }), gap = t - A.last; A.last = t;
    if (gap > 250) return;   // (a stall or a return from the background is not a slow frame)
    // (Held upright the picture is twice as tall and far more is in view: slow, but not a sign of what the phone can do the right way
    // up. It used to cut detail to the least there, and stay cut after the phone was turned. Upright is not judged, and turning it
    // sideways starts afresh.)
    if (window.innerHeight > window.innerWidth) { A.n = 0; A.ms = 0; A.busy = 0; A.upright = true; return; }
    if (A.upright) { A.upright = false; A.bad = 0; A.ok = 0; A.wait = 4; if (A.scale < 1) this.setRenderScale(1); if (A.detail > 0) this.setDetail(0); }
    A.n++; A.ms += gap; A.busy += busy;
    if (A.ms < 1000) return;
    const avg = A.ms / A.n, job = A.busy / A.n, goal = 1000 / (this.fpsCap || 60); A.n = 0; A.ms = 0; A.busy = 0;
    A.frame = avg; A.job = job; A.goal = goal;
    if (A.settle > 0) { A.settle--; return; }   // (a change just made shows up in the next full second)
    // (One bad second is a stone in the road, not a sign the phone cannot cope. Only a run of them, or a really bad one, changes anything. And below 75%
    // the picture only gets softer: measured on a Mali-G57, 70% ran no faster than 85%.)
    const over = avg > goal * 1.15; A.bad = over ? (A.bad || 0) + 1 : 0;
    const late = A.bad >= 3 || avg > goal * 1.6, roomy = avg < goal * 1.04, floor = 0.75;
    A.ok = roomy ? A.ok + 1 : 0;
    if (late) {
      if (A.raised) A.wait = Math.min(60, A.wait * 2);
      A.raised = false; A.ok = 0; A.settle = 1; A.bad = 0;
      A.limit = job > goal * 0.7 ? 'CPU' : 'GPU';
      if (A.limit === 'GPU' && A.scale > floor) this.setRenderScale(Math.max(floor, A.scale - 0.1));
      else if (A.detail < 3) this.setDetail(A.detail + 1);
      else if (A.scale > floor) this.setRenderScale(Math.max(floor, A.scale - 0.1));
    } else if (A.ok >= A.wait) {
      A.ok = 0; A.settle = 1;
      if (A.detail > 0) { this.setDetail(A.detail - 1); A.raised = true; }
      else if (A.scale < 1) { this.setRenderScale(Math.min(1, A.scale + 0.1)); A.raised = true; }
    }
  }
  setRenderScale(s) {
    this.auto.scale = s;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pr) * s;
    this.renderer.setPixelRatio(pr); this.composer.setPixelRatio(pr);
  }
  // How much of the level's draw distance and business the phone can take: 0 all of it, 3 the least. Nothing here needs a shader rebuilt,
  // so it costs no more than a short hitch. At 3 the shadows stop being drawn altogether.
  setDetail(d) {
    const A = this.auto, B = levelOf(this.q.name.toLowerCase()), k = [1, 0.82, 0.68, 0.55][d];
    A.detail = d;
    Object.assign(this.q, { treeFar: B.treeFar * k, treeNear: B.treeNear * (d ? 0.85 : 1), treeThin: B.treeThin * (1 - d * 0.1), grassR: B.grassR * (1 - d * 0.12), animalDraw: B.animalDraw * k, inkDraw: B.inkDraw * k, aiNear: B.aiNear * (1 - d * 0.15), waterFar: (B.waterFar || 900) * k, physStep: d ? 1 / 20 : B.physStep, poseStep: d ? Math.max(B.poseStep, 1 / 24) : B.poseStep, animStep: B.animStep * (1 + d * 0.5) });
    this.veg.lastPos.set(1e9, 0, 1e9); this.grass.applyQuality(); this.props.lastCull = null; this.terrain.applyQuality();
    this.shadowsOff = d >= 3;
    if (this.shadowsOff) { this.sky.sun.shadow.map && this.clearShadow(); }
  }
  // empty the shadow map, so that nothing stays in shadow from when it was last drawn
  clearShadow() {
    const r = this.renderer, rt = r.getRenderTarget(), c = new THREE.Color(), a = r.getClearAlpha(); r.getClearColor(c);
    r.setRenderTarget(this.sky.sun.shadow.map); r.setClearColor(0xffffff, 1); r.clear(); r.setRenderTarget(rt); r.setClearColor(c, a);
  }
  // Change the graphics level in the running game. All the systems read the same quality object, so it is updated in
  // place; each then adjusts what it built from it: buffers sized for the old level, the shadow map, the post-processing.
  // The settings panel is only open at the title or paused, so the short stall of rebuilding interrupts no play.
  async applyQuality(name) {
    const Q = levelOf(name); if (!Q) return;
    const me = this._qApply = (this._qApply || 0) + 1, note = $('set-quality-note'), sel = $('set-quality');
    if (this.q.name === Q.name) { note.textContent = ''; return; }
    note.textContent = 'Applying...'; sel.disabled = true;
    try {
      await nextFrame(); if (me !== this._qApply) return;
      const leanBefore = this.q.lean;
      Object.assign(this.q, Q); if (this.prFixed) this.q.pr = this.prFixed;
      this.pickFrameLimit(); this.syncFrameLimitUI && this.syncFrameLimitUI();
      const r = this.renderer, P = this.player;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pr));
      if (this.auto) { this.auto.scale = 1; this.auto.detail = 0; this.auto.ok = 0; this.auto.wait = 4; this.shadowsOff = false; }
      for (const p of this.composer.passes) if (p.dispose) p.dispose();
      this.composer.dispose();
      this.buildComposer();
      this.sky.applyQuality(); this.weather.applyQuality(); this.veg.applyQuality(); this.grass.applyQuality(); this.cover.applyQuality(); this.terrain.applyQuality(); this.near.applyQuality(); this.water.applyQuality(); this.player.applyQuality(); this.props.applyQuality(); this.fx.applyQuality(); this.applySmallShadows();
      // the shadow filter is part of every lit material's shader
      const st = this.q.softShadow ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
      if (r.shadowMap.type !== st) { r.shadowMap.type = st; this.scene.traverse((o) => { const m = o.material; if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true; }); }
      this.ropes.applyQuality();
      await tick();
      if (leanBefore !== this.q.lean || !this.q.lean) { this.near.prebuild(); await tick(); }
      const focus = this.playing ? P.pos : this.camera.position, see = this.playing && !this.arrival ? this.camera.position : focus;
      this.terrain.update(focus.x, focus.z, 1e9, true); await tick();
      this.veg.update(see, true); this.grass.update(see, true); this.cover.update(see, true);
      if (this.playing) { this.near.t = 0; this.near.update(P.pos, 0.016, P.canopy.mode ? P.canopy.tree : null); this.phys.sync(P.pos, true); }
      note.textContent = `${Q.name} is on.`;
    } catch (e) { console.error(e); note.textContent = 'Could not switch. Reload the page to apply it.'; }
    finally { sel.disabled = false; }
  }
  updateGodRays() {
    const gp = this.godrays; if (!gp) return;
    const u = gp.uniforms, sd = this.sky.sunDir;
    const cam = this.camera;
    _grv.copy(sd).multiplyScalar(1000).add(cam.position).project(cam);
    u.uSun.value.set(_grv.x * 0.5 + 0.5, _grv.y * 0.5 + 0.5);
    cam.getWorldDirection(_grd);
    const facing = smoothstep(0.05, 0.75, _grd.dot(sd)) * (_grv.z < 1 ? 1 : 0);
    const el = smoothstep(-0.02, 0.12, sd.y) * (1 - smoothstep(0.75, 0.97, sd.y));
    const canopy = clamp(biomeAt(this.player.pos.x, this.player.pos.z).teak + 0.3, 0.3, 1.2);
    const haze = clamp(G.uFogDensity.value / 0.0012, 0.4, 2.2);
    const env = this.weather.env;
    u.uStrength.value = Math.min(0.9, facing * el * G.uSunVis.value * canopy * haze * (1 - env.cloud * 0.6) * (1 - env.rain) * 2.4);   // capped: haze multiplied it to ~4 and whited out the view
    const hz = this.sky.horizon; u.uThreshold.value = Math.max(0.05, (hz.r * 0.3 + hz.g * 0.59 + hz.b * 0.11) * 0.85);
    u.uAspect.value = cam.aspect;
    u.uTint.value.copy(G.uSunCol.value).lerp(_grc.setRGB(1, 0.85, 0.6), 0.4);
  }
  // On a lean level the little things on the ground cast no shadow: each one is a draw call more in the shadow pass, for a shadow that can
  // hardly be seen on a phone. (The ground's contact shading still sits under them.)
  applySmallShadows() {
    const lean = this.q.lean, stones = [...(this.cover.stones || []), this.loose.stones, this.loose.sticks, this.vines.stems, this.ropes.mesh, ...Object.values(this.pickups.meshes)];
    for (const m of stones) { if (m.userData.casts === undefined) m.userData.casts = m.castShadow; m.castShadow = m.userData.casts && !lean; }
    this.pickups.R = lean ? 2 : 3; this.pickups.last.set(1e9, 0, 1e9);
  }
  // How big the canvas really is on the page. While a phone is turning, window.innerWidth can still be the old width when the resize event
  // comes, and sometimes no event comes after it. Writing that into the canvas's own style left it stuck at its upright width, filling
  // only the left of the turned screen. So its style is left alone (the style sheet makes it fill the screen, whatever happens), what it
  // has actually been given is what gets measured, and each frame checks that again.
  viewSize() { const c = this.renderer.domElement; return [c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight]; }
  resize() {
    const [w, h] = this.viewSize();
    if (w === this.viewW && h === this.viewH) return;
    this.viewW = w; this.viewH = h;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  makeWorldInterface() {
    const g = this;
    return {
      get player() { return g.player; }, get phys() { return g.phys; }, get night() { return g.sky.night; }, get isDay() { return g.sky.day > 0.5; }, get season() { return g.season; },
      get camera() { return g.camera; }, get actorR2() { return g.q.actorR * g.q.actorR; }, get sim() { return g.world; },
      // a blow costs him his standing with that kind; one driven off is news for the story and the passing remarks
      onHit: (an, by) => { if (by === 'player' && !an.story && an.d.kind !== 'predator' && an.d.kind !== 'pack') g.director.trust(an.sp, -0.1); },
      onRout: (an, by) => { g.emit('rout', { animal: an, by }); if (by === 'player' || by === 'companion') g.ui.toast(`The ${an.name || DEF_NAMES[an.sp] || an.sp} runs off`, 3); },
      onGreet: (an) => g.emit('trusted', { sp: an.sp, animal: an }),
      fx: this.fx, audio: this.audio, veg: this.veg,
      nearestPredator: (a, r) => g.eco.nearestPredator(a, r), nearestPrey: (a, r) => g.eco.nearestPrey(a, r),
      damagePlayer: (d, from, o) => g.player.hurt(d, from, o),
      onAlarm: (an, threat) => {
        if (an.dist2(g.player.pos) < 260 * 260) { const lbl = { chital: 'Chital', sambar: 'Sambar', langur: 'Langur', peafowl: 'Peafowl', cow: 'Cattle', dog: 'Dog' }[an.d.voice] || ''; g.ui.alarmMarker(an.pos.x, an.pos.z, lbl); g.ui.seeLore(an.sp);
          // read the call, as a tracker would: who is calling, from where, and what that caller only calls for
          const now = performance.now() / 1000;
          if (!(g._readT > now)) {
            g._readT = now + 40;
            const a = Math.atan2(an.pos.x - g.player.pos.x, -(an.pos.z - g.player.pos.z));
            const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
            const me = threat === 'player';
            if (g.talk.busy) return;
          const msg = me ? `${lbl} alarm, ${dir}. They have seen me.` : {
              sambar: `Sambar belling to the ${dir}. A sambar only bells for a tiger, a leopard or dhole.`,
              langur: `Langur barking from the trees, ${dir}. It can see a big cat on the ground.`,
              chital: `Chital calling, ${dir}. Something's moving over there. Listen for a second call.`,
              peafowl: `Peacock screaming in alarm, ${dir}.`,
            }[an.d.voice] || `${lbl} alarm, ${dir}.`;
            g.ui.toast(msg, 5.5);
          } }
      },
      onKill: (an, by) => { g.emit('kill', { animal: an, by }); if (an === g.companion) { g.companionBody = an; g.companion = null; } },
      get companion() { return g.companion; }, get companionPos() { return g.companion ? g.companion.pos : null; },
      threatToPlayer: (c) => { let best = null, bd = 22 * 22; for (const a of g.eco.animals) { if (a.dead || a.routed || a.companion) continue; if ((a.target === 'player' && (a.state === 'charge' || a.state === 'attack' || a.state === 'pounce' || a.state === 'stalk')) || a.target === c) { const d = a.dist2(g.player.pos); if (d < bd) { bd = d; best = a; } } } return best; },
      findForage: (p) => g.props.forageNear(p),
      get hour() { return g.time.hour; }, get animals() { return g.eco.animals; },
      nearestWater: (p) => nearestWaterPoint(p),
      nearestShade: (p, r) => g.veg.nearestTree(p.x, p.z, r || 30),
    };
  }
  // -------------------------------------------------------------------------------- world state
  setSeason(s, weatherState) {
    this.season = s; this.seasonCfg = SEASONS[s];
    if (PAINTED) setPaintedSeason(s);
    this.weather.setSeason(s, weatherState); this.veg.setSeason(s); if (this.veg.far) this.veg.far.dirty = true; this.grass.setSeason(s); this.cover.setSeason(s); this.pickups.setSeason(s); this.props.setSeason(s); this.water.setSeason(s);
    this.pickups.update(this.player.pos, true);
  }
  setTime(h) { this.time.hour = ((h % 24) + 24) % 24; }
  teleport(p, yaw = 0) {
    const P = this.player; P.pos.copy(p); P.pos.y = groundHeight(p.x, p.z); P.vel.set(0, 0, 0); P.yaw = yaw; P.bodyYaw = yaw; P.spawn.copy(P.pos);
    P.camPos.set(p.x + Math.sin(yaw) * 3, P.pos.y + 2, p.z + Math.cos(yaw) * 3);
    this.terrain.update(p.x, p.z, 1e9, true); this.veg.update(P.pos, true); this.grass.update(P.pos, true); this.cover.update(P.pos, true); this.pickups.update(P.pos, true);
    if (this.phys) this.phys.sync(P.pos, true);
    if (this.companion) { this.companion.pos.set(p.x + 2, groundHeight(p.x + 2, p.z + 2), p.z + 2); }
    for (const a of [...this.eco.animals]) if (!a.persistent && a.dist2(P.pos) > 400 * 400) this.eco.remove(a);
  }
  // the same, a piece at a time behind the black, so nothing else (the audio clock above all) waits on one long stall
  async teleportScene(p, yaw = 0) {
    const P = this.player; P.pos.copy(p); P.pos.y = groundHeight(p.x, p.z); P.vel.set(0, 0, 0); P.yaw = yaw; P.bodyYaw = yaw; P.spawn.copy(P.pos); P.pitch = -0.14;
    P.camPos.set(p.x + Math.sin(yaw) * 3, P.pos.y + 2, p.z + Math.cos(yaw) * 3);
    await tick(); this.terrain.update(p.x, p.z, 1e9, true);
    await tick(); this.veg.update(P.pos, true);
    await tick(); this.grass.update(P.pos, true); this.cover.update(P.pos, true);
    await tick(); this.pickups.update(P.pos, true); if (this.phys) this.phys.sync(P.pos, true);
    await tick();
    if (this.companion) { this.companion.pos.set(p.x + 2, groundHeight(p.x + 2, p.z + 2), p.z + 2); }
    for (const a of [...this.eco.animals]) if (!a.persistent && a.dist2(P.pos) > 400 * 400) this.eco.remove(a);
  }
  // The way down to him: from high over the forest on the side with the clearest line through the trunks.
  planArrival(dur) {
    const P = this.player, p = P.pos, trees = this.veg.climbNear(p.x, p.z, 46);
    let best = P.yaw, bs = Infinity, top = p.y + 18;
    for (const T of trees) if (T.top > top && Math.hypot(T.x - p.x, T.z - p.z) < 40) top = T.top;
    for (let i = 0; i < 16; i++) {
      const y = P.yaw + i / 16 * Math.PI * 2, bx = Math.sin(y), bz = Math.cos(y); let sc = i * 0.01;
      for (const T of trees) { if (!T.trunk) continue; const dx = T.x - p.x, dz = T.z - p.z, al = dx * bx + dz * bz, pr = Math.abs(dx * bz - dz * bx); if (al > -1 && al < 38 && pr < T.trunk.r[0] + 2.4) sc += 40 - al; }
      if (sc < bs) { bs = sc; best = y; }
    }
    P.yaw = best; P.bodyYaw = best; P.pitch = -0.14;
    const bx = Math.sin(best), bz = Math.cos(best), V = THREE.Vector3, H = top - p.y, d = P.camDist || 3.4;
    const pts = [[78, H + 62], [44, H + 14], [17, H * 0.5 + 3], [6.5, 3.6], [d, d * 0.14 + 1.7]].map(([b, h]) => new V(p.x + bx * b, p.y + h, p.z + bz * b));
    P.camPos.copy(pts[4]);
    return { t: 0, dur, speed: 1, curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), far: new V(p.x - bx * 320, p.y + H * 0.55, p.z - bz * 320) };
  }
  // Going somewhere new. To black first (with the sound), so the build is never seen; the world is made a piece at a time;
  // a few frames are drawn behind the black from both ends of the camera's way down, until they come through at an even
  // rate; only then do picture and sound come up, together, on a world that is already running.
  async enterScene(setup, o = {}) {
    this.cinematic = true; this.uiBlocking = true; this.starting = true;
    $('hud').classList.remove('show');
    this.ui.setPrompt(''); this.ui.setObjective('', '');
    this.audio.scene(false, 0.6);
    if (+$('fade').style.opacity < 0.99) await this.ui.fade(true, o.out ?? 700);
    this.holdFrames = true;
    await nextFrame();
    await setup();
    const A = this.arrival = this.planArrival(o.dur || 6.5);
    let calm = 0, last = performance.now();
    for (let i = 0; i < 26 && calm < 4; i++) {
      A.warmK = i % 2 ? 0.02 : 0.9;
      this.update(1 / 60, 1 / 60); this.render(1 / 60); this.input.endFrame();
      await nextFrame();
      const now = performance.now(); calm = i > 5 && now - last < 40 ? calm + 1 : 0; last = now;
    }
    delete A.warmK; A.t = 0;
    const arrived = new Promise((r) => { A.done = r; });
    this.holdFrames = false; this.last = performance.now();
    this.audio.scene(true, 2.4);
    if (o.title) this.ui.card(o.title[0], o.title[1], Math.min(5.5, A.dur - 1));
    if (o.stinger && this.music) this.music.stinger(o.stinger);
    this.ui.fade(false, 1400);
    await arrived;
    $('hud').classList.add('show');
    this.cinematic = false; this.uiBlocking = false; this.starting = false;
  }
  debug(o = {}) {
    if (o.season) this.setSeason(o.season, o.weather);
    else if (o.weather) { this.weather.force(o.weather); this.weather.env = { ...this.weather.target }; }
    if (o.hour !== undefined) this.setTime(o.hour);
    if (o.x !== undefined) this.teleport(new THREE.Vector3(o.x, 0, o.z), o.yaw || 0);
    if (o.view) this.player.setView(o.view);
    if (o.pitch !== undefined) this.player.pitch = o.pitch;
    if (o.yaw !== undefined) this.player.yaw = o.yaw;
    if (o.spawn) for (const [sp, dx, dz, extra] of o.spawn) { const P = this.player.pos; const a = this.eco.spawnOne(sp, new THREE.Vector3(P.x + dx, 0, P.z + dz), { persistent: true, ...(extra || {}) }); a.yaw = Math.atan2(P.x - a.pos.x, P.z - a.pos.z) + (o.face || 0); a.setState('idle', 99); if (o.freeze) a.scripted = (dt, W, an) => { an.targetSpeed = 0; }; }
    if (o.equip) { this.inv.add(o.equip, 1); this.player.equip(o.equip); }
    if (o.village) this.story.spawnVillage();
    if (o.nograss !== undefined) { this.grass.short.visible = !o.nograss; this.grass.tall.visible = !o.nograss; }
    if (o.camDist) this.player.camDist = o.camDist;
    if (o.stats) { this.renderer.info.autoReset = false; this.renderer.info.reset(); this.renderer.render(this.scene, this.camera); const i = this.renderer.info.render; const r = { calls: i.calls, tris: i.triangles }; this.renderer.info.autoReset = !this.perf.on; return JSON.stringify(r); }
    this.weather.env = { ...this.weather.target };
    return 'ok';
  }
  setCompanion(a) { this.companion = a; if (a) { a.companion = true; a.slot = 1; } }
  // -------------------------------------------------------------------------------- menus & input
  setupMenus() {
    const g = this;
    const save = store.get('vanaj-save-v2');
    $('btn-continue').style.display = save ? '' : 'none';
    // Browsers forbid sound before a gesture, so the menu's flute starts on the first click, touch or key anywhere. On a phone a finger coming
    // down does not count as one, only its lifting: listening once for pointerdown, the sound was asked for too soon, refused, and never
    // asked for again until Begin. So it keeps asking, on every kind of gesture, until the sound is actually running.
    const EV = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    const heard = () => { const c = g.audio.ctx; if (c && c.state === 'running') { $('title-hint').classList.add('off'); for (const ev of EV) window.removeEventListener(ev, firstSound, true); return true; } return false; };
    const firstSound = () => { g.startAudio(); g.audio.resume(); if (!heard() && g.audio.ctx) g.audio.ctx.resume().then(heard, () => {}); };
    for (const ev of EV) window.addEventListener(ev, firstSound, { capture: true, passive: true });
    heard();   // sound already allowed
    // (a phone stops the sound when the game goes behind something else, and does not bring it back by itself)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && g.audio.ctx && g.audio.ctx.state !== 'running') g.audio.resume(); });
    $('btn-begin').onclick = () => { g.startAudio(); g.beginNew(); };
    $('btn-continue').onclick = () => { g.startAudio(); g.loadSave(); };
    $('btn-chapters').onclick = () => { $('chapters').classList.add('show'); };
    $('btn-settings').onclick = () => { g.openSettings(); };
    $('btn-controls').onclick = () => { $('controls').classList.add('show'); };
    $('btn-about').onclick = () => { $('about').classList.add('show'); };
    document.querySelectorAll('.close').forEach((b) => (b.onclick = () => { b.closest('.panel').classList.remove('show'); if (g.playing && !g.anyPanel()) { g.ui.close(); g.uiBlocking = false; g.requestLock(); } }));
    const cl = $('chapter-list'); cl.innerHTML = '';
    g.story.CH.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'chap'; b.innerHTML = `<i>${c.act}</i><b>${i === g.story.CH.length - 1 ? '' : (i + 1) + '. '}${c.title}</b>`;
      b.onclick = () => { g.startAudio(); $('chapters').classList.remove('show'); g.startGame(i, { chapterSelect: true }); };
      cl.appendChild(b);
    });
    const fr = document.createElement('button'); fr.className = 'chap'; fr.innerHTML = '<i>Sandbox</i><b>Free roam (any season)</b>';
    fr.onclick = () => { g.startAudio(); $('chapters').classList.remove('show'); g.freeRoam(); }; cl.appendChild(fr);
    $('btn-resume').onclick = () => g.resume();
    $('btn-save').onclick = () => { g.save(); g.ui.toast('Saved'); };
    $('btn-psettings').onclick = () => g.openSettings();
    $('btn-quit').onclick = () => g.toTitle();
    $('btn-respawn').onclick = () => g.respawn();
    $('btn-restart-ch').onclick = () => { g.ui.hideDeath(); g.player.respawn(); g.story.start(g.story.chIndex); g.requestLock(); };
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (!locked && g.playing && !g.uiBlocking && !g.player.dead) g.pause();
    });
    // settings wiring
    const S = g.settings;
    const bindRange = (id, key, fmt) => { const e = $(id); e.value = S[key]; const lab = $(id + '-v'); const upd = () => { S[key] = +e.value; if (lab) lab.textContent = fmt ? fmt(S[key]) : S[key]; g.applySettings(); }; e.oninput = upd; upd(); };
    bindRange('set-sens', 'sens', (v) => v.toFixed(2)); bindRange('set-fov', 'fov'); bindRange('set-master', 'master', (v) => Math.round(v * 100) + '%'); bindRange('set-music', 'music', (v) => Math.round(v * 100) + '%');
    $('set-perf').value = g.perf.mode; $('set-perf').onchange = (e) => g.perf.setMode(e.target.value);
    g.syncFrameLimitUI = () => { $('set-fps').value = S.fps === undefined ? 'auto' : String(S.fps); };
    g.syncFrameLimitUI();
    $('set-fps').onchange = (e) => { if (e.target.value === 'auto') delete S.fps; else S.fps = +e.target.value; g.pickFrameLimit(); if (g.auto) { g.auto.ok = 0; g.auto.n = 0; g.auto.ms = 0; g.auto.busy = 0; } g.applySettings(); };
    if (canFullscreen()) {
      const box = $('set-full'), sync = () => { box.checked = !!document.fullscreenElement; };
      box.onchange = () => { if (box.checked) goFullscreen(); else if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
      document.addEventListener('fullscreenchange', sync); document.addEventListener('fullscreenerror', sync); sync();
    } else $('set-full').closest('.row').style.display = 'none';
    $('set-gentle').value = S.gentle ? '1' : '0'; $('set-gentle').onchange = (e) => { S.gentle = e.target.value === '1'; g.applySettings(); };
    $('set-invert').checked = S.invert; $('set-invert').onchange = (e) => { S.invert = e.target.checked; g.applySettings(); };
    // (it shows the level really running: a phone starts on Low, whatever was saved)
    $('set-quality').value = g.q.name.toLowerCase(); $('set-quality').onchange = (e) => { S.quality = e.target.value; S.qualityChosen = true; g.applySettings(); g.applyQuality(e.target.value); };
    $('set-view').value = S.view; $('set-view').onchange = (e) => { S.view = e.target.value; g.player.setView(S.view); g.applySettings(); };
  }
  anyPanel() { return !!document.querySelector('.panel.show'); }
  openSettings() { $('settings').classList.add('show'); }
  applySettings() {
    const S = this.settings; store.set('vanaj-settings', S);
    this.player.fov = S.fov;
    this.audio.vol.music = S.music;
    if (this.audio.ready) { const t = this.audio.ctx.currentTime; this.audio.master.gain.setTargetAtTime(S.master, t, 0.015); this.audio.music.gain.setTargetAtTime(S.music, t, 0.015); }   // ramped: a jump clicks
    else { this.audio.vol.master = S.master; this.audio.vol.music = S.music; }
  }
  startAudio() { this.audio.init(); this.audio.resume(); if (!this.music && this.audio.ready) { this.music = new Music(this.audio); } this.applySettings(); }
  // leaving the main menu: the flute fades and the forest's sound comes up
  leaveMenu() { this.inMenu = false; if (this.music) this.music.titleStop(); this.audio.setWorld(true); }
  requestLock() {
    if (this.touch) return;   // touch play looks by dragging, not pointer lock
    const el = this.renderer.domElement;
    try { const p = el.requestPointerLock && el.requestPointerLock(); if (p && p.catch) p.catch(() => { this.dragLook = true; }); } catch (e) { this.dragLook = true; }
  }
  async beginNew() {
    this.leaveMenu();
    this.starting = true;
    this.inv.load({ items: {}, locks: ['bow', 'axe'] });
    this.felling.reset();
    this.lessons.reset();
    this.flags = {}; this.director.load(null); this.ui.journal = []; this.camps.length = 0;
    await this.prologue();
    this.startGame(0);
  }
  // The opening is played in the world itself (js/game/opening.js). It ends on black.
  prologue() { return (this.opening || (this.opening = new Opening(this))).play(); }
  // The click is answered at once with a fade to black; the teleport and streaming happen behind it (js enterScene)
  async startGame(ch, opts = {}) {
    this.leaveMenu();
    this.requestLock();
    this.starting = true;
    await this.story.start(ch, { chapterSelect: opts.chapterSelect, onBlack: () => {
      $('title').classList.remove('show');
      this.player.revive();
      this.playing = true;
      if (opts.chapterSelect) this.giveChapterKit(ch);
    } });
  }
  giveChapterKit(ch) {
    // what he would have by then, when jumping straight into a later chapter (ch: index into the story's chapters)
    const inv = this.inv; inv.load({ items: {}, locks: ['bow', 'axe'] }); this.flags = {};
    if (ch >= 1) { inv.add('knife'); inv.add('stick', 4); inv.add('stone', 3); }
    if (ch >= 3) { inv.add('wire'); inv.add('club'); inv.add('leaves', 3); inv.add('fiber', 3); inv.add('torch'); }
    if (ch >= 4) { inv.add('honey', 1); inv.add('meat_cooked', 2); }
    if (ch >= 5) { inv.add('bowl'); inv.add('spear'); inv.add('bamboo', 2); }
    if (ch >= 6) inv.locks.delete('axe');
    if (ch >= 7) { inv.locks.delete('bow'); inv.add('bow'); inv.add('arrow', 12); inv.add('bandage', 2); }
    if (ch >= 9) this.flags.chingari = true;
    if (ch >= 11) inv.add('matches');
    if (ch >= 12) inv.add('flute');
    if (ch >= 13) inv.add('lota');
    this.player.equip(ch >= 5 ? 'spear' : ch >= 1 ? 'knife' : 'fists');
  }
  async freeRoam() {
    this.leaveMenu();
    this.requestLock();
    await this.enterScene(async () => {
      this.player.revive();
      $('title').classList.remove('show');
      this.playing = true;
      this.giveChapterKit(13); this.flags.chingari = true; this.world.village = 'home';
      this.story.chIndex = -1; this.story.done = true; this.inv.locks.delete('axe');
      this.setSeason(this.freeSeason || 'post', null); this.setTime(7.5);
      await this.teleportScene(new THREE.Vector3(SITES.den.x, 0, SITES.den.z + 10));
      this.story.ensureChingari();
    }, { dur: 5.5 });
    this.ui.setObjective('Free roam', this.touch ? 'Tap the leaf at the top to change season. Explore Pench.' : 'Press <b>N</b> to change season. Explore Pench.');
  }
  // back to the title without reloading: the world stays built, so the next start is instant
  async toTitle() {
    this.save();
    this.starting = true;
    await this.ui.fade(true, 300);
    this.story.stop();
    this.playing = false; this.paused = false; this.uiBlocking = true;
    for (const id of ['pause', 'settings', 'hud', 'death']) { const e = $(id); if (e) e.classList.remove('show'); }
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.close(); this.ui.setObjective('', ''); this.ui.setPrompt(''); this.ui.setPin(null);
    if (this.music) this.music.setCombat(0);
    $('btn-continue').style.display = store.get('vanaj-save-v2') ? '' : 'none';
    this.inMenu = true; this.audio.setWorld(false); if (this.music) this.music.titleStart();
    this.titleCam = 4;   // past the reach's opening dip to black
    $('title').classList.add('show');
    this.titleShot(4);
    await this.ui.fade(false, 900); this.starting = false;
  }
  pause() { if (this.paused) return; this.paused = true; this.uiBlocking = true; $('pause').classList.add('show'); }
  resume() { this.paused = false; this.uiBlocking = false; $('pause').classList.remove('show'); $('settings').classList.remove('show'); this.requestLock(); }
  respawn() {
    this.ui.hideDeath();
    const camp = this.camps[this.camps.length - 1];
    this.player.respawn(camp ? camp.pos.clone().add(new THREE.Vector3(1.5, 0, 1.5)) : null);
    this.talk.say([['vanaj', 'Ow. Everything hurts. But the fire is still warm.']]);
    // restart the chapter so scripted encounters are coherent
    const keep = this.story.chIndex;
    if (keep >= 0) this.story.start(keep, { keepState: !!camp });
    this.requestLock();
  }
  onKey(e) {
    if (e.code === 'F3') { e.preventDefault(); this.perf.cycle(); return; }
    if (this.cinematic) { if (this.arrival) this.arrival.speed = 4; return; }   // any key hurries the shot along
    if (e.code === 'F4' && this.phys) { e.preventDefault(); this.phys.toggleDebug(this.scene); return; }   // show the colliders
    if (!this.playing) return;
    const ui = this.ui;
    if (e.code === 'Tab') { e.preventDefault(); if (!this.paused && !this.player.dead) ui.toggle('inv'); return; }
    if (e.code === 'KeyJ' && !this.paused) { ui.toggle('journal'); return; }
    if (e.code === 'KeyM' && !this.paused) { ui.toggle('map'); return; }
    if (e.code === 'Escape') { if (ui.open) { ui.close(); return; } if (this.paused) { this.resume(); } else if (this.playing && !document.pointerLockElement && !this.player.dead) this.pause(); return; }
    if (this.uiBlocking) return;
    const P = this.player;
    if (e.code === 'KeyV') { const v = P.view === 'fpp' ? 'tpp' : 'fpp'; P.setView(v); this.settings.view = v; this.applySettings(); }
    if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); const ws = ['fists', 'knife', 'club', 'spear', 'bow', 'torch', 'axe']; if (ws[n - 1]) P.equip(ws[n - 1]); }
    if (e.code === 'KeyT') P.equip(P.weapon === 'torch' ? (this.prevWeapon || 'fists') : (this.prevWeapon = P.weapon, 'torch'));
    if (e.code === 'KeyQ' && !e.repeat) { ui.openWheel(); this.wheelOpen = true; }
    if (e.code === 'KeyE') this.interact();
    if (e.code === 'KeyH') this.useBandage();
    if (e.code === 'KeyB') this.eatBest();
    if (e.code === 'KeyN' && this.story.done && this.playing && !this.uiBlocking && !this.cinematic && !this.player.dead) { const s = ['winter', 'summer', 'monsoon', 'post']; this.setSeason(s[(s.indexOf(this.season) + 1) % 4]); this.ui.toast(this.seasonCfg.label); }
  }
  onKeyUp(e) {
    if (e.code === 'KeyQ' && this.wheelOpen) { this.wheelOpen = false; const c = this.ui.closeWheel(); if (c) this.player.call(c); }
  }
  // -------------------------------------------------------------------------------- interactions
  findInteraction() {
    const P = this.player, pos = P.pos, story = this.story;
    if (P.dead || P.climb) return null;
    const fwd = P.camForward(new THREE.Vector3());
    const eye = this.camera.position;
    const d2 = (p) => (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
    for (const it of story.storyItems) if (!it.taken && d2(it.pos) < 2.5 * 2.5) return { prompt: it.prompt, act: () => { it.taken = true; this.scene.remove(it.mesh); this.inv.add(it.id, 1); this.audio.pickup(); this.ui.toast('+ ' + ITEMS[it.id].name); this.emit('pickup', { item: it.id }); } };
    // an objective can offer its own interaction (share with Kaali, sit with her, ...)
    const oi = story.obj && story.obj.interact;
    if (oi && !oi._used) { const p = oi.at(this, story); if (p && d2(p) < (oi.r || 3) ** 2) return { prompt: oi.prompt, act: () => { oi._used = true; oi.act(this, story); } }; }
    // props
    // while the story wants a fish, the water's edge comes before the bushes and sticks beside it
    if (story.obj && story.obj.id === 'fish' && !P.swimming && this.clock > (this.fishCD || 0)) {
      const ax = pos.x + fwd.x * 1.4, az = pos.z + fwd.z * 1.4, wl = Math.max(waterAt(ax, az), waterAt(pos.x, pos.z));
      if (wl > groundHeight(ax, az) - 0.05 && wl > pos.y - 1.6) return { prompt: P.weapon === 'spear' ? 'Spear a fish' : 'Feel under the bank for a fish', act: () => this.fish() };
    }
    // (something not yet looked at comes before anything else in reach: on the tower the box, not the ladder beside it)
    const fresh = (it) => it.kind === 'clue' && !story.flags['clue_' + it.id];
    for (const it of [...this.props.inter.filter(fresh), ...this.props.inter.filter((it) => !fresh(it))]) {
      if (it.kind === 'trigger') continue;
      const dd = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z), dy = Math.abs(it.pos.y - (pos.y + 1));
      if (dd > it.r || dy > 3.5) continue;
      if (it.kind === 'clue') return { prompt: it.prompt, act: () => { this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.4 }; this.audio.pickup(); this.emit('clue', { id: it.id }); if (it.id === 'denMarks') { this.talk.say([['vanaj', 'Hundreds of scratches, in rows. One for every night.'], ['vanaj', "I don't know why I make them. It feels wrong not to."]]); this.ui.addJournal('Marks on the den wall', 'I scratch a mark each night. There are hundreds. Older me knows what this is: counting. I did not.', 'clue'); } } };
      if (it.kind === 'rest') return { prompt: it.prompt, act: () => this.sleep(it) };
      if (it.kind === 'hive') { if (this.onCooldown('hive')) continue; return { prompt: P.weapon === 'torch' ? 'Smoke the hive for honey' : 'Take honey (no smoke…)', act: () => this.hiveAction() }; }
      if (it.kind === 'climb') { const top = P.pos.y > SITES.tower.y + 6; return { prompt: top ? 'Climb down' : 'Climb the ladder (W)', act: () => this.climbLadder(top) }; }
      if (it.kind === 'water') return { prompt: it.prompt, act: () => this.drink() };
      if (it.kind === 'story') { const u = story.obj && story.obj.use; if (u && u.id === it.id && !u._used) return { prompt: u.prompt || it.prompt, act: () => { u._used = true; u.act(this, story); } }; }
    }
    // tower ladder top (from platform)
    // campfire
    for (const c of this.camps) if (d2(c.pos) < 2.6 * 2.6) {
      if (this.inv.has('meat_raw')) return { prompt: 'Roast the fish over the fire', act: () => this.cook(c) };
      return { prompt: 'Sleep by the fire (until morning)', act: () => this.sleep(c) };
    }
    // a tree he has felled
    { const F = this.felling.fallenNear(pos); if (F && this.inv.has('axe')) return { prompt: 'Cut it up for wood', act: () => this.felling.cutUp(F) }; }
    // recover projectiles
    for (const s of P.stuck) { const v = new THREE.Vector3(); s.mesh.getWorldPosition(v); if (v.distanceTo(pos) < 2.4 && s.item) return { prompt: 'Recover ' + (s.item === 'spear' ? 'spear' : 'arrow'), act: () => P.recoverNear() }; }
    // pickups
    const pk = this.pickups.nearest(pos, fwd), lo = this.loose ? this.loose.nearest(pos, fwd) : null;
    const dOf = (x, z) => Math.hypot(x - pos.x, z - pos.z);
    if (lo && (!pk || dOf(lo.pos.x, lo.pos.z) < dOf(pk.x, pk.z))) return { prompt: 'Pick up ' + (lo.stick ? 'stick' : 'stone'), act: () => this.pickupLoose(lo) };
    if (pk) return { prompt: 'Pick up ' + ITEMS[pk.type].name.toLowerCase(), act: () => this.pickup(pk) };
    // termite mound
    const m = this.props.nearestMound(pos, 2.4);
    if (m) { const k = 'm' + Math.round(m.x) + ',' + Math.round(m.z); if (!this.onCooldown(k)) return { prompt: 'Break open the termite mound', act: () => this.breakMound(m, k) }; }
    // vegetation
    const sp = this.veg.treeSpeciesAt(pos.x, pos.z, 2.6);
    const tr = this.veg.nearestTree(pos.x, pos.z, 2.4);
    if (tr && sp === SP.bamboo) { const k = 'b' + Math.round(tr.x) + ',' + Math.round(tr.z); if (!this.onCooldown(k)) return { prompt: this.inv.has('knife') ? 'Cut bamboo and strip fibre' : 'Bamboo (needs a knife)', act: () => this.cutBamboo(k) }; }
    const lan = this.nearLantana(pos);
    if (lan) { const k = 'l' + lan; if (!this.onCooldown(k)) return { prompt: 'Gather leaves', act: () => this.gatherLeaves(k) }; }
    // water
    const ahead = new THREE.Vector3(pos.x + fwd.x * 1.4, 0, pos.z + fwd.z * 1.4);
    const wl = Math.max(waterAt(ahead.x, ahead.z), waterAt(pos.x, pos.z));
    if (wl > groundHeight(ahead.x, ahead.z) - 0.05 && wl > pos.y - 1.6 && !P.swimming) {
      // thirsty: drink. Otherwise the fish, with a spear or by feeling under the bank for one.
      const ready = this.clock > (this.fishCD || 0), wanted = story.obj && story.obj.id === 'fish';
      if (ready && (P.weapon === 'spear' || wanted || P.thirst > 80)) return { prompt: P.weapon === 'spear' ? 'Spear a fish' : 'Feel under the bank for a fish', act: () => this.fish() };
      return { prompt: 'Drink', act: () => this.drink() };
    }
    return null;
  }
  nearLantana(pos) {
    // perches list excludes lantana; scan veg cell data near player for lantana instances
    const cx = Math.floor(pos.x / 64), cz = Math.floor(pos.z / 64);
    const c = this.veg.cells.get(cx * 100003 + cz); if (!c) return null;
    const d = c.data;
    for (let i = 0; i < d.length; i += 7) if (d[i + 5] === SP.lantana) { const dx = d[i] - pos.x, dz = d[i + 2] - pos.z; if (dx * dx + dz * dz < 2.4 * 2.4) return Math.round(d[i]) + ',' + Math.round(d[i + 2]); }
    return null;
  }
  onCooldown(k) { const t = this.cooldowns.get(k); return t !== undefined && this.time.day * 24 + this.time.hour - t < 36; }
  setCooldown(k) { this.cooldowns.set(k, this.time.day * 24 + this.time.hour); }
  // (looked for a few times a second, so look again right after acting: what was just taken must not be taken twice)
  interact() { const it = this.currentInteraction; if (it && !this.player.action) { it.act(); this.currentInteraction = null; this._lookT = 0; } }
  pickup(pk) {
    this.player.startPick({ type: pk.type, pos: new THREE.Vector3(pk.x, pk.y, pk.z), grab: () => this.pickups.take(pk), stow: () => this.gained(pk.type) });
  }
  pickupLoose(it) {
    const type = it.stick ? 'stick' : 'stone';
    this.player.startPick({ type, size: it.stick ? 0 : it.size, pos: it.pos.clone(), grab: () => this.loose.take(it), stow: () => this.gained(type) });
  }
  gained(type) { this.inv.add(type, 1); this.audio.pickup(); this.ui.toast('+1 ' + ITEMS[type].name); this.emit('pickup', { item: type }); }
  breakMound(m, k) {
    this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.8 };
    this.audio.impact('stone', this.player.pos, 0.6); this.fx.dust(new THREE.Vector3(m.x, m.y + 0.5, m.z), 2, [0.6, 0.35, 0.22]);
    setTimeout(() => { this.inv.add('termites', 2); this.ui.toast('+2 Termites'); this.setCooldown(k); this.emit('pickup', { item: 'termites' }); }, 1500);
    this.ui.seeLore('termite');
  }
  cutBamboo(k) {
    if (!this.inv.has('knife')) { this.ui.toast('You need a stone knife'); return; }
    this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 2.2 };
    for (let i = 0; i < 4; i++) setTimeout(() => this.audio.impact('wood', this.player.pos, 0.7), 300 + i * 420);
    setTimeout(() => { this.inv.add('bamboo', 1); this.inv.add('fiber', 2); this.ui.toast('+1 Bamboo, +2 Fibre'); this.setCooldown(k); this.emit('pickup', { item: 'bamboo' }); }, 2000);
    this.ui.seeLore('bamboo');
  }
  gatherLeaves(k) {
    this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.2 };
    this.audio.footstep('leaf', 1);
    setTimeout(() => { this.inv.add('leaves', 2); this.inv.add('fiber', 1); this.ui.toast('+2 Leaves, +1 Fibre'); this.setCooldown(k); this.emit('pickup', { item: 'leaves' }); }, 1000);
  }
  hiveAction() {
    const P = this.player, h = this.props.hives[0];
    if (P.weapon === 'torch') {
      P.action = { type: 'gather', anim: 'swing', t: 0, dur: 3 };
      this.fx.bees(h.pos, 30); this.audio.bees(h.pos, 1);
      this.setCooldown('hive');
      setTimeout(() => { this.inv.add('honey', 2); this.inv.add('fiber', 1); this.ui.toast('+2 Honey'); this.talk.say([['vanaj', 'The smoke makes them slow. Grab the comb and go!']]); this.emit('pickup', { item: 'honey' }); }, 2800);
    } else {
      this.talk.say([['vanaj', 'Ow! OW! No smoke, no honey. I know that. I KNOW that!']]);
      for (let i = 0; i < 8; i++) setTimeout(() => { this.fx.bees(P.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), 14); this.audio.bees(P.pos, 1); P.hurt(4, null, { kind: 'sting' }); }, i * 450);
    }
  }
  climbLadder(down) {
    const P = this.player, props = this.props;
    const bottom = props.towerLadder.clone(); bottom.x += 0.4; bottom.y = groundHeight(bottom.x, bottom.z);
    const top = new THREE.Vector3(props.towerLadder.x, props.towerTop.y, props.towerLadder.z);
    if (down) { P.startClimb(top, bottom); } else P.startClimb(bottom, top);
  }
  drink() {
    const P = this.player;
    P.action = { type: 'drink', anim: 'drink', t: 0, dur: 2.0 };
    this.audio.drink();
    setTimeout(() => { P.thirst = Math.min(100, P.thirst + 40); this.emit('drink'); if (this.season === 'summer' && Math.random() < 0.08) { P.sick = 2; this.ui.toast("That water was bad"); } }, 1600);
  }
  // Fish lie in the shallows at first and last light, and go deep in the heat of the day. A spear helps; hands will do.
  fish() {
    const P = this.player, spear = P.weapon === 'spear', ph = this.world.phase;
    P.action = { type: 'gather', anim: spear ? 'stab' : 'gather', t: 0, dur: 2.4 }; P.crouch = !spear;
    this.audio.splash(P.pos, 0.5); this.fishCD = this.clock + 3;
    const odds = (spear ? 0.92 : 0.62) * (ph === 'dawn' || ph === 'dusk' || ph === 'morning' ? 1 : ph === 'night' ? 0.55 : 0.7);
    setTimeout(() => {
      if (P.dead) return;
      const first = !this.flags.fished;
      if (first || Math.random() < odds) {
        this.flags.fished = true; this.inv.add('meat_raw', 1); this.audio.splash(P.pos, 0.8); this.audio.pickup(); this.fishCD = this.clock + 18;
        this.fx.splash(P.pos.clone().add(new THREE.Vector3(-Math.sin(P.yaw) * 0.9, 0.2, -Math.cos(P.yaw) * 0.9)), 1.2);
        this.ui.toast('+1 River fish'); this.emit('fish'); this.emit('pickup', { item: 'meat_raw' });
      } else this.ui.toast(ph === 'midday' || ph === 'afternoon' ? 'It slipped away. They lie deep in the heat of the day' : 'It slipped through your fingers. Try again', 3.5);
    }, 2100);
  }
  harvest(a) {
    if (!this.inv.has('knife')) { this.ui.toast('You need a stone knife'); return; }
    const P = this.player;
    P.action = { type: 'harvest', anim: 'stab', t: 0, dur: 2.6 };
    for (let i = 0; i < 4; i++) setTimeout(() => { this.audio.impact('flesh', a.pos, 0.6); this.fx.blood(a.bodyPos(new THREE.Vector3()), new THREE.Vector3(0, 0.6, 0), 0.7); }, 400 + i * 500);
    setTimeout(() => {
      const loot = a.harvest(this.W); if (!loot) return;
      const parts = [];
      for (const [k, n] of Object.entries(loot)) { if (!ITEMS[k]) continue; this.inv.add(k, n); parts.push(`${n} ${ITEMS[k].name}`); }
      this.ui.toast('+ ' + parts.join(', '), 4); this.emit('harvest', { animal: a });
    }, 2400);
  }
  coverBody(a) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.T.litter, roughness: 1 }));
    m.scale.set(1.2, 0.45, 0.8); m.position.copy(a.pos); m.rotation.y = a.yaw; this.scene.add(m);
    a.root.visible = false; a.harvested = true;
  }
  cook(c) {
    const P = this.player;
    const n = Math.min(6, this.inv.count('meat_raw'));
    P.action = { type: 'gather', anim: 'gather', t: 0, dur: 3 };
    this.audio.fireLevel = 1;
    setTimeout(() => { this.inv.take('meat_raw', n); this.inv.add('meat_cooked', n); this.ui.toast(`Roasted ${n} fish`); this.emit('cook', { n }); }, 2800);
  }
  async sleep(c) {
    const P = this.player;
    if (P.dead) return;
    const threats = this.eco.animals.filter((a) => !a.dead && !a.routed && a.target === 'player' && a.dist2(P.pos) < 60 * 60);
    if (threats.length || this.world.tension > 0.6) { this.ui.toast("You can't sleep with something hunting this close"); return; }
    this.uiBlocking = true;
    await this.ui.fade(true, 1500);
    const h = this.time.hour;
    const add = h < 6 ? 6 - h : 30 - h;
    this.time.hour = 6.2; this.time.day += 1; this.pickups.day = this.time.day;
    P.hp = Math.min(100, P.hp + 35); P.stamina = 100; P.hunger = Math.max(5, P.hunger - add * 1.5); P.thirst = Math.max(5, P.thirst - add * 2);
    c.fireLeft = 6;
    P.spawn.copy(c.pos).add(new THREE.Vector3(1.5, 0, 1.5));
    this.emit('sleep'); this.save();
    await this.wait(0.8);
    await this.ui.fade(false, 1800);
    this.uiBlocking = false;
    this.ui.toast("Morning. Game saved.");
  }
  craft(r) {
    if (!this.inv.craft(r)) return;
    this.audio[r.id === 'knife' ? 'knap' : 'craft']();
    this.ui.toast('Crafted ' + ITEMS[r.id].name + (r.makes ? ' ×' + r.makes : ''));
    if (r.id === 'campfire') { this.inv.take('campfire', 1); this.placeCampfire(); }
    if (ITEMS[r.id].weapon) this.player.equip(r.id);
    this.emit('craft', { item: r.id });
  }
  placeCampfire() {
    const P = this.player;
    const pos = new THREE.Vector3(P.pos.x - Math.sin(P.yaw) * 1.6, 0, P.pos.z - Math.cos(P.yaw) * 1.6); pos.y = groundHeight(pos.x, pos.z);
    const g = new THREE.Group();
    const rockM = new THREE.MeshStandardMaterial({ color: 0x6e665c, roughness: 0.95 });
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), rockM); const a = i / 9 * 6.28; s.position.set(Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45); s.rotation.set(Math.random(), Math.random(), 0); g.add(s); }
    const logM = new THREE.MeshStandardMaterial({ map: this.T.bark.teak, color: 0x7a5a3a });
    for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.8, 6), logM); l.rotation.set(1.1, i * 1.57, 0); l.position.y = 0.18; g.add(l); }
    const embers = new THREE.Mesh(new THREE.CircleGeometry(0.32, 12), new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff4a10, emissiveIntensity: 1.2 })); embers.rotation.x = -Math.PI / 2; embers.position.y = 0.04; g.add(embers);
    g.position.copy(pos); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); this.scene.add(g);
    const fire = this.fx.addFire(pos.clone().add(new THREE.Vector3(0, 0.1, 0)), 1.0);
    this.camps.push({ pos, fire, mesh: g, fireLeft: 8 });
    if (this.camps.length > 6) { const old = this.camps.shift(); this.scene.remove(old.mesh); this.fx.removeFire(old.fire); }
    this.ui.toast(this.inv.has('matches') ? "One scrape on the box." : "You saw bamboo against bamboo until it smokes.");
    this.emit('campfire');
  }
  eat(k) {
    const f = ITEMS[k] && ITEMS[k].food; if (!f || !this.inv.take(k, 1)) return;
    const P = this.player;
    P.hunger = Math.min(100, P.hunger + (f.hunger || 0)); P.thirst = Math.min(100, P.thirst + (f.thirst || 0)); P.hp = Math.min(100, P.hp + (f.hp || 0));
    if (f.sick && Math.random() < f.sick) { P.sick = 3; this.ui.toast("Your stomach hurts"); }
    if (f.drunk) P.drunk = Math.min(1.5, P.drunk + f.drunk);
    if (!P.action) P.action = { type: 'eat', anim: 'eat', t: 0, dur: 1.6 };
    this.audio.eat(); this.emit('eat', { item: k });
  }
  eatBest() { for (const k of ['meat_cooked', 'honey', 'tendu', 'ber', 'mahua', 'termites', 'mushroom', 'meat_raw']) if (this.inv.has(k)) { this.eat(k); this.ui.toast('Ate ' + ITEMS[k].name); return; } this.ui.toast('Nothing to eat'); }
  useBandage() { if (!this.inv.take('bandage', 1)) { this.ui.toast('No bandage (make one from leaves and fibre)'); return; } this.player.bleed = 0; this.player.hp = Math.min(100, this.player.hp + 22); this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.5 }; this.ui.toast('Bound up'); this.emit('bandaged'); }
  // -------------------------------------------------------------------------------- save/load
  save() {
    if (this.story.chIndex < 0 && !this.story.done) return;
    const P = this.player;
    store.set('vanaj-save-v2', { pin: this.ui.pin || null, ch: this.story.chIndex, done: this.story.done, inv: this.inv.toJSON(), hour: this.time.hour, day: this.time.day, season: this.season, flags: this.flags, hp: P.hp, hunger: P.hunger, thirst: P.thirst, journal: this.ui.journal, skills: [...this.lessons.done], lore: [...this.ui.loreSeen], explored: Array.from(this.ui.explored), discovered: [...this.ui.discovered], felled: this.felling.toJSON(), world: this.director.toJSON() });
  }
  loadSave() {
    const s = store.get('vanaj-save-v2'); if (!s) return this.beginNew();
    this.inv.load(s.inv || {}); this.flags = s.flags || {}; this.time.day = s.day || 0; this.director.load(s.world);
    this.felling.load(s.felled);
    this.lessons.reset(); for (const k of s.skills || []) this.lessons.done.add(k);
    this.ui.journal = s.journal || []; this.ui.loreSeen = new Set(s.lore || []); this.ui.discovered = new Set(s.discovered || []);
    if (s.explored) this.ui.explored.set(s.explored); this.ui.setPin(s.pin || null);
    if (s.done) { this.freeSeason = s.season; this.freeRoam(); return; }
    this.startGame(Math.max(0, s.ch));
    this.player.equip(this.inv.equipped);
  }
  // -------------------------------------------------------------------------------- frame
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    // Frames fall due on a schedule, so the limit holds whatever the screen's rate: 30 on a 60 Hz screen is every second frame, 60 on 120 Hz
    // likewise, and 60 on 90 Hz is two frames out of three. (3 ms of grace for the screen's own timing.) A frame that is late moves the
    // schedule, rather than a run of frames rushing to catch up.
    if (this.fpsCap) {
      const step = 1000 / this.fpsCap;
      if (t < this.nextFrameT - 3) return;
      this.nextFrameT = Math.max(this.nextFrameT + step, t + step - 4);
    }
    { const c = this.renderer.domElement; if (c.clientWidth !== this.viewW || c.clientHeight !== this.viewH) this.resize(); }
    this.perf.frameStart(t - this.last);
    let rdt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    if (this.hitstopT > 0) { this.hitstopT -= rdt; rdt *= 0.08; }
    if (this.slowT > 0) { this.slowT -= rdt; rdt *= this.slowK; }
    if (this.holdFrames) { this.input.endFrame(); this.perf.frameEnd({ scene: this.scene, composer: this.composer, quality: '', animals: 0 }); return; }   // nothing to show: the sketchbook or black is up
    const dt = this.paused ? 0 : rdt, t0 = performance.now();
    try { this.update(dt, rdt); } catch (e) { console.error(e); }
    this.render(rdt);
    if (this.touch && this.playing && dt > 0 && !this.cinematic) { try { this.holdFrameRate(t, performance.now() - t0); } catch (e) { console.error(e); } }
    this.input.endFrame();
    this.perf.frameEnd({ scene: this.scene, composer: this.composer, quality: this.q.name, animals: this.eco ? this.eco.animals.length : undefined, auto: this.auto });
  }
  update(dt, rdt) {
    const P = this.player;
    this.clock += dt;
    if (this.touchUI) this.touchUI.show(this.playing && !this.paused && !this.player.dead && !this.cinematic && !this.uiBlocking && !this.wheelOpen);   // (not on the way down from the sky: they come with the HUD, once the camera is behind him)
    // timers
    if (dt > 0) for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.res(); } }
    // time of day
    if (this.playing && dt > 0) {
      this.time.hour += dt * this.time.rate / 3600;
      if (this.time.hour >= 24) { this.time.hour -= 24; this.time.day++; this.pickups.day = this.time.day; }
    }
    // The world's clock: wind, water and leaves. It only runs while the game does, so a paused world is still. (It used to be
    // pushed along by the grade pass too, which shares this uniform: that doubled its rate, which the look was tuned to, and
    // kept everything moving under the pause menu.)
    G.uTime.value += dt * 2;
    // title screen camera: slow drift over the forest
    if (!this.playing && this.cine) this.cine(rdt);   // the opening has the camera
    else if (!this.playing) {
      this.titleCam += rdt;
      this.titleShot(this.titleCam);
      this.time.hour = 7.35 + Math.sin(this.titleCam * 0.012) * 0.15;
    } else if (dt > 0) {
      // wheel/look
      if (this.input.wheel && !this.uiBlocking) { const ws = this.inv.weapons(); const i = ws.indexOf(this.inv.equipped); P.equip(ws[(i + this.input.wheel + ws.length) % ws.length]); }
      if (this.wheelOpen || this.cinematic) { this.input.mdx = 0; this.input.mdy = 0; }
      P.update(dt, this.input);
      // interaction prompt: nothing it depends on changes faster than a few times a second, and each look allocates a good deal
      this._lookT = (this._lookT || 0) - dt;
      if (this.uiBlocking) { this.currentInteraction = null; this._finishP = ''; this._lookT = 0; }
      else if (this._lookT <= 0) { this._lookT = 0.12; this.currentInteraction = this.findInteraction(); this._finishP = this.currentInteraction ? '' : this.felling.promptFor(); }
      this.ui.setPrompt(P.canopy.prompt && !this.uiBlocking ? `<kbd>E</kbd> ${P.canopy.prompt}` : this.currentInteraction ? `<kbd>E</kbd> ${this.currentInteraction.prompt}` : this._finishP);
      this.story.update(dt);
      this.lessons.update(dt);
      this.director.update(dt); this.forest.update(dt); this.barks.update(dt);
    }
    const pf = this.perf; pf.mark('player');
    const focus = this.playing ? P.pos : this.camera.position;
    G.uPlayerPos.value.copy(P.pos);
    // world streaming
    this.terrain.update(focus.x, focus.z, 4);
    { const see = this.arrival ? P.pos : this.camera.position; this.veg.update(see); this.grass.update(see); this.cover.update(see); this.props.update(see); } this.pickups.update(focus);
    if (this.phys && this.playing) { this.phys.sync(P.pos); this.loose.update(P.pos); }
    if (this.playing && dt > 0) { this.near.update(P.pos, dt, P.canopy.mode ? P.canopy.tree : null); this.ropes.update(dt, P.pos); this.felling.update(dt); }
    if (!this.paused) this.vines.update(dt || rdt * 0.2, this.camera.position);
    pf.mark('streaming');
    // sky & weather
    const env = this.weather.env;
    this.sky.update(this.paused ? 0 : dt || rdt * 0.2, this.time.hour, this.seasonCfg.decl, env, this.camera, focus, this.season);
    this.weather.hold = !this.story.done;   // the weather only changes, by itself or by the player, in free roam
    if (!this.paused) this.weather.update(rdt, dt * this.time.rate / 3600, this.time.hour, this.camera.position, this.sky);
    const D = this.props.den, inDen = this.playing && D.inside(this.camera.position.x, this.camera.position.z);   // (no rain under the roof)
    if (inDen) { this.weather.rain.visible = false; if (this.weather.splash) this.weather.splash.visible = false; }
    this.water.update(this.sky, env.rain, this.camera);
    pf.mark('sky');
    // animals
    if (this.playing && dt > 0) { this.eco.update(dt, this.W); try { this.birds.update(dt); this.tracks.update(dt); this.places.update(dt, this.player.pos.x, this.player.pos.z, this.time.day * 1440 + this.time.hour * 60); } catch (e) { if (!this._birdErr) { this._birdErr = 1; console.error('birds', e); } } }
    pf.mark('animals');
    if (this.phys && this.playing) {
      // (on a lean level the physics world runs at 30 Hz or less: all that moves in it by itself is the odd stone, and everything else only
      // asks it questions, which it answers between steps)
      this._physDt = (this._physDt || 0) + dt;
      if (this._physDt >= this.q.physStep - 0.002 && this._physDt > 0) { this.phys.step(this._physDt); this._physDt = 0; }
    }
    pf.mark('physics');
    // fires: campfires burn down
    this.nearFire = false;
    let fireLevel = 0;
    for (const c of this.camps) { const d = c.pos.distanceTo(P.pos); if (d < 6) this.nearFire = true; fireLevel = Math.max(fireLevel, 1 - d / 14); }
    if (P.torchLit) fireLevel = Math.max(fireLevel, 0.25);
    // the den's hearth is always banked, and lit when he is near enough to see it
    if (this.playing) {
      const d = D.hearth.distanceTo(P.pos);
      if (d < 26 && !D.fire) D.fire = this.fx.addFire(D.hearth, 0.55, { smoke: false }); else if (d > 30 && D.fire) { this.fx.removeFire(D.fire); D.fire = null; }
      if (d < 6) this.nearFire = true;
      fireLevel = Math.max(fireLevel, 1 - d / 14);
    }
    if (this.audio.ready) this.audio.fireLevel = Math.max(0, fireLevel);
    this.fx.update(dt, this.camera.position, Math.max(0.12, this.sky.day));
    this.fx.updateAmbient(dt, this.camera.position, this.sky.night, this.season, env.rain > 0.2);
    pf.mark('effects');
    // audio: the sound runs on its own thread and the music is scheduled ahead, so all this has to do is steer it, about twelve times a
    // second. (Every frame it queued some twenty parameter changes for that thread to work through, which on a phone is time it needs.)
    this._audDt = (this._audDt || 0) + rdt;
    if (this.audio.ready && this._audDt >= 0.08) {
      const rdt = Math.min(0.5, this._audDt); this._audDt = 0;
      this.audio.setListener(this.camera);
      const dR = biomeAt(P.pos.x, P.pos.z).dRiver;
      const nearW = Math.max(clamp(1 - (dR - 14) / 90, 0, 1), waterAt(P.pos.x, P.pos.z) > -1e8 ? 0.4 : 0);
      const under = waterAt(this.camera.position.x, this.camera.position.z) > this.camera.position.y ? 1 : 0;
      const vd = Math.hypot(P.pos.x - SITES.village.x, P.pos.z - SITES.village.z);
      const inCave = Math.hypot(P.pos.x - SITES.cave.x, P.pos.z - SITES.cave.z) < 9;
      this.audio.setReverb(inCave || inDen ? 'cave' : 'forest');
      if (!this.inMenu) this.audio.update(rdt, { hour: this.time.hour, season: this.season, rain: env.rain, wind: G.uWindStrength.value, water: nearW, night: this.sky.night, under, village: this.story.villageSpawned ? clamp(1 - vd / 400, 0, 1) : 0 });
      if (this.music && !this.playing) this.music.titleUpdate(rdt);
      if (this.music && this.playing) {
        let threat = 0;
        for (const a of this.eco.animals) if (!a.dead && !a.routed && !a.companion && a.target === 'player' && a.dist2(P.pos) < 60 * 60) { if (['charge', 'attack', 'pounce'].includes(a.state)) threat = Math.max(threat, a.d.kind === 'predator' ? 1 : 0.6); else if (a.state === 'stalk') threat = Math.max(threat, 0.3); }
        this.combatLevel = lerp(this.combatLevel || 0, threat, Math.min(1, rdt * (threat > (this.combatLevel || 0) ? 3 : 0.25)));
        if (!this.story.scriptMusic) this.music.setCombat(Math.max(this.combatLevel > 0.15 ? this.combatLevel : 0, this.music.combat > 0.9 && threat === 0 && this.combatLevel > 0.1 ? 0.2 : 0));
        this.music.update(rdt, this.time.hour, this.season, { suppress: this.paused, forest: this.world.forest, talking: this.talk.busy });
      }
    }
    pf.mark('audio');
    if (!this.paused) { this.talk.update(rdt); if (this.playing) this.emotes.update(rdt, this); }
    this.ui.update(rdt);
    pf.mark('ui');
  }
  finishPromptFor() { return null; }
  render(rdt) {
    const P = this.player, gr = this.grade.uniforms;
    // where he is on screen, for the leaves between him and the camera (js/world/flora.js)
    { const f = G.uFocus.value; _grv.set(P.pos.x, P.pos.y + 1, P.pos.z).applyMatrix4(this.camera.matrixWorldInverse); f.set(_grv.x, _grv.y, _grv.z, this.playing && P.view !== 'fpp' && !this.arrival ? 1 : 0); }
    // exposure & grade by time of day
    const day = this.sky.day, night = this.sky.night;
    const el = this.sky.sunDir.y;
    const golden = (1 - smoothstep(0.0, 0.3, el)) * smoothstep(-0.1, 0.05, el);
    if (PAINTED) {
      // the palette already sets the hour's colour; the grade lifts saturation a touch and cools the night
      this.renderer.toneMappingExposure = 1 + this.weather.flash * 1.5;
      gr.uNight.value = night * 0.6; gr.uTint.value.set(1, 1, 1); gr.uSat.value = 1.08;   // moonlight cools warm colours a little
    } else {
      this.renderer.toneMappingExposure = lerp(2.2, 0.9, day) * (1 - this.weather.env.cloud * 0.1) + this.weather.flash * 2;
      gr.uNight.value = night;
      gr.uTint.value.set(1 + golden * 0.12 + (this.season === 'summer' ? 0.04 : 0), 1 + golden * 0.02, 1 - golden * 0.12 - (this.season === 'summer' ? 0.05 : 0));
      gr.uSat.value = this.season === 'summer' ? 0.92 : this.season === 'monsoon' ? 1.08 : 1.02;
    }
    gr.uHurt.value = Math.min(1, P.hurtFlash * 1.2 + (P.hp < 30 ? (30 - P.hp) / 40 : 0));
    gr.uLow.value = P.hp < 25 ? (25 - P.hp) / 25 : 0;
    gr.uFlash.value = this.weather.flash;
    gr.uUnder.value = this.playing && waterAt(this.camera.position.x, this.camera.position.z) > this.camera.position.y ? 1 : 0;
    gr.uHeat.value = this.season === 'summer' ? smoothstep(10, 13, this.time.hour) * (1 - smoothstep(16, 18, this.time.hour)) : 0;
    gr.uBlur.value = this.uiBlocking && this.playing && !this.cinematic ? 1 : (P.drunk > 0.4 ? (P.drunk - 0.4) : 0);
    if (gr.uExposure) gr.uExposure.value = this.renderer.toneMappingExposure;
    this.updateGodRays();
    // the first-person arms are a scene of their own: nothing to draw in third person
    this.vmPass.enabled = !!(this.player.vm && this.player.vm.root.visible);
    // On Low the shadows are drawn every other frame while he stands still. They stay fixed to the world in between, because the matrix the
    // ground reads them with only changes when they are redrawn. On the move they are drawn every frame: at a run he covers 20 cm in a frame,
    // so his shadow would shake against his feet.
    { const sm = this.renderer.shadowMap, every = P.speed > 0.2 || P.canopy.mode || !this.playing ? 1 : this.q.shadowEvery; sm.autoUpdate = false; if ((this._shadowN = (this._shadowN || 0) + 1) >= every) { this._shadowN = 0; sm.needsUpdate = !this.shadowsOff; } }
    if (this.veg.far && this.q.farPics) this.veg.far.tick(this.renderer, this.sky, rdt);
    if (!this.noRender) { this.perf.gpuBegin(); this.composer.render(rdt); this.perf.gpuEnd(); }
    this.perf.mark('render');
  }
}

const game = window.game = new Game();
game.boot().catch((e) => { console.error(e); const s = document.getElementById('load-step'); if (s) s.textContent = 'Error: ' + e.message; });

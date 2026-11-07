// VANAJ — main: boot, renderer + post-processing, game loop, interactions, crafting, sleep, save/load, menus.
import * as THREE from 'three';
import { GodRaysShader } from './core/godrays.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { loadRigs } from './actors/rigged.js';
import { loadHumanRig } from './actors/humanrig.js';
import { GroundAO } from './world/groundao.js';
import { PerfOverlay } from './core/perf.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from './core/shaderlib.js';
import { clamp, lerp, smoothstep } from './core/noise.js';
import { buildTextures } from './world/textures.js';
import { TerrainManager, groundHeight, waterAt, renderMapCanvas, height, biomeAt, nearestWaterPoint } from './world/terrain.js';
import { Vegetation, Grass, SP } from './world/flora.js';
import { SkySystem } from './world/sky.js';
import { Weather, SEASONS } from './world/weather.js';
import { Water } from './world/water.js';
import { FX } from './world/fx.js';
import { Props, SITES } from './world/props.js';
import { Ecosystem } from './actors/animals.js';
import { Birds } from './world/birds.js';
import { PlaceTracker } from './world/places.js';
import { Tracks } from './world/tracks.js';
import { GroundCover } from './world/groundcover.js';
import { Player } from './actors/player.js';
import { AudioEngine } from './audio/audio.js';
import { Music } from './audio/music.js';
import { Inventory, Pickups, ITEMS, RECIPES } from './game/items.js';
import { Story } from './game/story.js';
import { UI } from './game/ui.js';

const _grv = new THREE.Vector3(), _grd = new THREE.Vector3(), _grc = new THREE.Color();
const QUALITY = {
  low: { name: 'Low', pr: 0.7, shadow: 1024, shadowDist: 40, treeNear: 50, treeFar: 360, grassR: 26, grassDensity: 0.45, grassCap: 4000, bloom: false, chunkR: 3, env: false, treeCap0: 900, treeCap1: 4000, rainDrops: 2500, aa: false },
  medium: { name: 'Medium', pr: 1.0, shadow: 2048, shadowDist: 55, treeNear: 75, treeFar: 520, grassR: 38, grassDensity: 0.75, grassCap: 7000, bloom: true, chunkR: 4, env: true, treeCap0: 1300, treeCap1: 6500, rainDrops: 4000, aa: false },
  high: { name: 'High', pr: 1.25, shadow: 2048, shadowDist: 70, treeNear: 125, treeFar: 700, grassR: 52, grassDensity: 1.0, grassCap: 10000, bloom: true, chunkR: 5, env: true, treeCap0: 1800, treeCap1: 9000, rainDrops: 5000, aa: true },
  ultra: { name: 'Ultra', pr: 2.0, shadow: 4096, shadowDist: 90, treeNear: 170, treeFar: 900, grassR: 68, grassDensity: 1.3, grassCap: 16000, bloom: true, chunkR: 6, env: true, treeCap0: 2600, treeCap1: 13000, rainDrops: 6000, aa: true },
};
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };

class Input {
  constructor(dom) {
    this.keys = {}; this.down = new Set(); this.buttons = [false, false, false]; this.mdown = new Set(); this.mdx = 0; this.mdy = 0; this.wheel = 0; this.mdxLast = 0; this.mdyLast = 0;
    window.addEventListener('keydown', (e) => { if (['Tab', 'Space'].includes(e.code) && game.playing) e.preventDefault(); if (!this.keys[e.code]) this.down.add(e.code); this.keys[e.code] = true; game.onKey(e); });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; game.onKeyUp(e); });
    window.addEventListener('mousedown', (e) => { if (!game.playing) return; this.buttons[e.button] = true; this.mdown.add(e.button); if (!document.pointerLockElement && !game.uiBlocking) game.requestLock(); });
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
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.9 }, uGrain: { value: 0.012 }, uHurt: { value: 0 }, uLow: { value: 0 }, uFlash: { value: 0 }, uUnder: { value: 0 }, uNight: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1.05 }, uHeat: { value: 0 }, uBlur: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uHurt, uLow, uFlash, uUnder, uNight, uSat, uHeat, uBlur; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (uHeat > 0.0) uv += vec2(sin(uv.y * 90.0 + uTime * 3.1), cos(uv.x * 70.0 + uTime * 2.3)) * 0.0011 * uHeat * smoothstep(0.65, 0.2, uv.y);
      if (uUnder > 0.0) uv += vec2(sin(uv.y * 30.0 + uTime * 2.0), cos(uv.x * 25.0 + uTime * 1.7)) * 0.003 * uUnder;
      vec3 c = texture2D(tDiffuse, uv).rgb;
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
      c += (h(vUv * 1024.0 + fract(uTime) * 37.0) - 0.5) * uGrain * (0.4 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

class Game {
  constructor() {
    this.playing = false; this.paused = false; this.uiBlocking = true; this.timeScale = 1; this.hitstopT = 0; this.slowT = 0; this.slowK = 1;
    this.clock = 0; this.timers = []; this.listeners = {};
    this.time = { hour: 7, day: 0, rate: 60 };
    this.season = 'winter'; this.seasonCfg = SEASONS.winter;
    this.camps = []; this.flags = {}; this.npcs = [];
    this.settings = Object.assign({ quality: 'medium', sens: 1, invert: false, fov: 72, view: 'tpp', master: 0.9, music: 0.7, density: 1, perf: 'off' }, store.get('vanaj-settings') || {});
    const qp = new URLSearchParams(location.search);
    this.q = { ...(QUALITY[qp.get('q') || this.settings.quality] || QUALITY.medium) };
    if (qp.get('pr')) this.q.pr = +qp.get('pr');
    this.noRender = qp.has('norender'); if (this.noRender) { this.q.env = false; }
    this.cooldowns = new Map();
  }
  // -------------------------------------------------------------------------------- events
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return () => { const a = this.listeners[ev]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  emit(ev, data = {}) { for (const fn of [...(this.listeners[ev] || [])]) fn(data); if (ev !== '*') for (const fn of [...(this.listeners['*'] || [])]) fn({ ev, ...data }); }
  wait(sec) { return new Promise((res) => this.timers.push({ t: sec, res })); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(k, dur) { this.slowK = k; this.slowT = dur; }
  // -------------------------------------------------------------------------------- boot
  async boot() {
    // let the bar paint between steps; a hidden tab gets no animation frames, so a timer keeps loading going there
    const prog = (p, t) => { $('load-bar').style.width = (p * 100).toFixed(0) + '%'; $('load-step').textContent = t; return new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 120); }); };
    await prog(0.02, 'Waking the renderer');
    const q = this.q;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: q.aa, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('app').prepend(renderer.domElement); renderer.domElement.id = 'gl';
    this.perf = new PerfOverlay(renderer, { mode: new URLSearchParams(location.search).get('perf') || this.settings.perf, onChange: (m) => { this.settings.perf = m; store.set('vanaj-settings', this.settings); const sel = $('set-perf'); if (sel) sel.value = m; } });
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x888888, 0.0001);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 4200);
    this.input = new Input(renderer.domElement);
    this.audio = new AudioEngine();
    this.ui = new UI(this); this.ui.init();
    await prog(0.06, 'Painting bark, leaves and leaf litter');
    this.T = buildTextures();
    await prog(0.25, 'Raising the Satpura hills');
    this.terrain = new TerrainManager(this.scene, this.T, q);
    await prog(0.35, 'Growing teak, mahua, saja, kulu, palash and bamboo');
    this.veg = new Vegetation(this.scene, this.T, q);
    this.grass = new Grass(this.scene, q);
    this.cover = new GroundCover(this.scene, this.T || T, q);
    await prog(0.5, 'Placing rocks, termite mounds, the den, the shrine and the village');
    this.props = new Props(this.scene, this.T, this.veg); this.props.build();
    this.groundAO = new GroundAO(256);
    this.veg.onRebuild = (rect, trees) => this.groundAO.update(rect, trees, this.props.colliders || []);
    await prog(0.62, 'Filling the Pench river and Totladoh');
    this.water = new Water(this.scene);
    this.sky = new SkySystem(this.scene, renderer, q); if (this.noRender) this.sky.sampleOk = false;
    this.weather = new Weather(this.scene, q, this.audio);
    this.fx = new FX(this.scene, this.T);
    this.pickups = new Pickups(this.scene, this.T);
    await prog(0.66, 'Bringing in the chital, sambar, gaur and dholes');
    await Promise.all([loadRigs(), loadHumanRig()]);
    this.eco = new Ecosystem(this.scene);
    this.birds = new Birds(this.scene, this);
    this.tracks = new Tracks(this.scene, this);
    this.places = new PlaceTracker(document.getElementById('place'));
    this.inv = new Inventory();
    this.player = new Player(this);
    this.player.setView(this.settings.view);
    this.story = new Story(this);
    this.W = this.makeWorldInterface();
    await prog(0.72, 'Drawing the map');
    this.mapImage = renderMapCanvas(384);
    await prog(0.78, 'Building terrain around the den');
    const den = SITES.den; this.player.pos.set(den.x + 3, height(den.x + 3, den.z + 6), den.z + 6);
    this.terrain.update(this.player.pos.x, this.player.pos.z, 1e9, true);
    this.veg.update(this.player.pos, true); this.grass.update(this.player.pos, true); this.cover.update(this.player.pos, true); this.pickups.update(this.player.pos, true);
    await prog(0.86, 'Post-processing');
    this.buildComposer();
    this.setSeason('winter', 'mist'); this.setTime(6.5);
    await prog(0.92, 'Compiling shaders');
    try { this.sky.update(0.016, this.time.hour, this.seasonCfg.decl, this.weather.env, this.camera, this.player.pos); if (!this.noRender) renderer.compile(this.scene, this.camera); } catch (e) { console.warn(e); }
    await prog(1, 'Ready');
    window.addEventListener('resize', () => this.resize());
    this.setupMenus();
    $('loading').classList.add('hide');
    $('title').classList.add('show');
    this.titleCam = 0;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
  buildComposer() {
    const r = this.renderer, w = window.innerWidth, h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.aa ? 4 : 0 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.name !== 'Low') {
      this.godrays = new ShaderPass(GodRaysShader);
      this.godrays.material.defines.GR_SAMPLES = this.q.name === 'Medium' ? 20 : 30;
      this.composer.addPass(this.godrays);
    }
    const vm = new RenderPass(this.player.vmScene, this.player.vmCam); vm.clear = false; vm.clearDepth = true; this.composer.addPass(vm);
    if (this.q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.55, 0.92); this.composer.addPass(this.bloom); }
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (!this.q.aa && this.q.name !== 'Low') { this.smaa = new SMAAPass(w * r.getPixelRatio(), h * r.getPixelRatio()); this.composer.addPass(this.smaa); }
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
    u.uStrength.value = facing * el * G.uSunVis.value * canopy * haze * (1 - env.cloud * 0.6) * (1 - env.rain) * 2.4;
    const hz = this.sky.horizon; u.uThreshold.value = Math.max(0.05, (hz.r * 0.3 + hz.g * 0.59 + hz.b * 0.11) * 0.85);
    u.uAspect.value = cam.aspect;
    u.uTint.value.copy(G.uSunCol.value).lerp(_grc.setRGB(1, 0.85, 0.6), 0.4);
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  makeWorldInterface() {
    const g = this;
    return {
      get player() { return g.player; }, get night() { return g.sky.night; }, get isDay() { return g.sky.day > 0.5; }, get season() { return g.season; },
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
            const msg = me ? `${lbl} alarm, ${dir}. They have seen me.` : {
              sambar: `Sambar belling to the ${dir}. A sambar only bells for a tiger, a leopard or dhole.`,
              langur: `Langur barking from the trees, ${dir}. It can see a cat on the ground.`,
              chital: `Chital calling, ${dir}. Something is moving there. Wait for a second voice.`,
              peafowl: `Peacock screaming in alarm, ${dir}.`,
            }[an.d.voice] || `${lbl} alarm, ${dir}.`;
            g.ui.toast(msg, 5.5);
          } }
      },
      onKill: (an, by) => { g.emit('kill', { animal: an, by }); if (an === g.companion) { g.companionBody = an; g.companion = null; g.ui.toast(an.name + ' is dead', 5); } },
      get companion() { return g.companion; }, get companionPos() { return g.companion ? g.companion.pos : null; },
      threatToPlayer: (c) => { let best = null, bd = 22 * 22; for (const a of g.eco.animals) { if (a.dead || a.companion) continue; if ((a.target === 'player' && (a.state === 'charge' || a.state === 'attack' || a.state === 'pounce' || a.state === 'stalk')) || a.target === c) { const d = a.dist2(g.player.pos); if (d < bd) { bd = d; best = a; } } } return best; },
      findForage: (p) => g.props.forageNear(p),
      get hour() { return g.time.hour; }, get animals() { return g.eco.animals; },
      nearestWater: (p) => nearestWaterPoint(p),
      nearestShade: (p, r) => g.veg.nearestTree(p.x, p.z, r || 30),
      onDeath: (an) => g.birds && !an.companion && g.birds.addCarcass(an.pos),
    };
  }
  // -------------------------------------------------------------------------------- world state
  setSeason(s, weatherState) {
    this.season = s; this.seasonCfg = SEASONS[s];
    this.weather.setSeason(s, weatherState); this.veg.setSeason(s); this.grass.setSeason(s); this.cover.setSeason(s); this.pickups.setSeason(s); this.props.setSeason(s); this.water.setSeason(s);
    this.pickups.update(this.player.pos, true);
  }
  setTime(h) { this.time.hour = ((h % 24) + 24) % 24; }
  teleport(p, yaw = 0) {
    const P = this.player; P.pos.copy(p); P.pos.y = groundHeight(p.x, p.z); P.vel.set(0, 0, 0); P.yaw = yaw; P.bodyYaw = yaw; P.spawn.copy(P.pos);
    P.camPos.set(p.x + Math.sin(yaw) * 3, P.pos.y + 2, p.z + Math.cos(yaw) * 3);
    this.terrain.update(p.x, p.z, 1e9, true); this.veg.update(P.pos, true); this.grass.update(P.pos, true); this.cover.update(P.pos, true); this.pickups.update(P.pos, true);
    if (this.companion) { this.companion.pos.set(p.x + 2, groundHeight(p.x + 2, p.z + 2), p.z + 2); }
    for (const a of [...this.eco.animals]) if (!a.persistent && a.dist2(P.pos) > 400 * 400) this.eco.remove(a);
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
    const save = store.get('vanaj-save-v1');
    $('btn-continue').style.display = save ? '' : 'none';
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
    $('btn-quit').onclick = () => { g.save(); location.reload(); };
    $('btn-respawn').onclick = () => g.respawn();
    $('btn-restart-ch').onclick = () => { g.ui.hideDeath(); g.player.respawn(); g.story.start(g.story.chIndex); g.requestLock(); };
    $('prologue-skip').onclick = () => g.skipPrologue && g.skipPrologue();
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (!locked && g.playing && !g.uiBlocking && !g.player.dead) g.pause();
    });
    // settings wiring
    const S = g.settings;
    const bindRange = (id, key, fmt) => { const e = $(id); e.value = S[key]; const lab = $(id + '-v'); const upd = () => { S[key] = +e.value; if (lab) lab.textContent = fmt ? fmt(S[key]) : S[key]; g.applySettings(); }; e.oninput = upd; upd(); };
    bindRange('set-sens', 'sens', (v) => v.toFixed(2)); bindRange('set-fov', 'fov'); bindRange('set-master', 'master', (v) => Math.round(v * 100) + '%'); bindRange('set-music', 'music', (v) => Math.round(v * 100) + '%');
    $('set-perf').value = g.perf.mode; $('set-perf').onchange = (e) => g.perf.setMode(e.target.value);
    $('set-invert').checked = S.invert; $('set-invert').onchange = (e) => { S.invert = e.target.checked; g.applySettings(); };
    $('set-quality').value = S.quality; $('set-quality').onchange = (e) => { S.quality = e.target.value; g.applySettings(); $('set-quality-note').textContent = 'Reload to fully apply view distance and shadow quality.'; };
    $('set-view').value = S.view; $('set-view').onchange = (e) => { S.view = e.target.value; g.player.setView(S.view); g.applySettings(); };
  }
  anyPanel() { return !!document.querySelector('.panel.show'); }
  openSettings() { $('settings').classList.add('show'); }
  applySettings() {
    const S = this.settings; store.set('vanaj-settings', S);
    this.player.fov = S.fov;
    if (this.audio.ready) { this.audio.master.gain.value = S.master; this.audio.music.gain.value = S.music; }
    else { this.audio.vol.master = S.master; this.audio.vol.music = S.music; }
  }
  startAudio() { this.audio.init(); this.audio.resume(); if (!this.music && this.audio.ready) { this.music = new Music(this.audio); } this.applySettings(); }
  requestLock() {
    const el = this.renderer.domElement;
    try { const p = el.requestPointerLock && el.requestPointerLock(); if (p && p.catch) p.catch(() => { this.dragLook = true; }); } catch (e) { this.dragLook = true; }
  }
  async beginNew() {
    $('title').classList.remove('show');
    this.inv.load({ items: {}, locks: ['bow'] });
    await this.prologue();
    this.startGame(0);
  }
  prologue() {
    return new Promise((resolve) => {
      const P = $('prologue'), L = $('prologue-line'); P.classList.add('show');
      const lines = [
        'Seoni, in the southern Satpura hills. The monsoon of the year I was three.',
        'My father drove the cart home from the market, across the ford of the Pench. My mother held me. I was drinking milk from a small steel pot.',
        'Upstream, two days of rain came down all at once.',
        'She tied me to a floating teak log with her sari, through the handle of the pot.',
        'She hummed four notes. Then the river took her.',
        'I do not remember the water. I remember being carried.',
        'A grey wolf who had lost her pups to the same flood found me on a sandbank. She lifted me by the cloth at my waist, the way she would lift a pup.',
        'I called her by a sound. In words it would be Kaali.',
      ];
      let i = 0, done = false;
      // the prologue's score and thunder are scheduled seconds ahead; keep hold of them so Skip can cut them
      // instead of letting them play on over the first chapter's own music
      const cue = this.music ? this.music.cue() : null, rolls = [];
      const silence = () => { if (cue) cue.stop(0.25); for (const r of rolls) r(0.25); rolls.length = 0; };
      this.weather.force('storm'); this.audio.update(0.1, { rain: 1, wind: 1.4, water: 1, night: 1, hour: 22, season: 'monsoon' });
      const rainTimer = setInterval(() => { if (Math.random() < 0.35) rolls.push(this.audio.thunder(300 + Math.random() * 1500, Math.random() * 6)); this.audio.update(0.5, { rain: 1, wind: 1.4, water: 1, night: 1, hour: 22, season: 'monsoon' }); }, 1500);
      if (this.music) this.music.banaPhrase([{ semi: 0, dur: 2 }, { semi: 1, dur: 1.5, meend: true }, { semi: 0, dur: 1 }, { semi: -1, dur: 2.5, meend: true }, { semi: -5, dur: 4 }], this.audio.ctx.currentTime + 1, { gain: 0.08, dest: cue.dest });
      const show = () => {
        if (done) return;
        if (i >= lines.length) return finish();
        L.classList.remove('show');
        setTimeout(() => {
          if (done) return;
          L.textContent = lines[i];
          L.classList.add('show');
          if (i === 4 && this.music) this.music.flutePhrase([4, 2, 0, -3].map((s, k) => ({ semi: s, dur: k === 3 ? 2.5 : 0.8 })), this.audio.ctx.currentTime + 1.5, { gain: 0.12, dest: cue.dest });
          i++;
          setTimeout(show, Math.max(4200, lines[i - 1].length * 70));
        }, 900);
      };
      const finish = () => { if (done) return; done = true; clearInterval(rainTimer); L.classList.remove('show'); $('prologue-title').classList.add('show'); this.weather.forced = null; setTimeout(() => { P.classList.remove('show'); $('prologue-title').classList.remove('show'); resolve(); }, 3800); };
      this.skipPrologue = () => { if (!done) { done = true; clearInterval(rainTimer); silence(); this.weather.forced = null; P.classList.remove('show'); resolve(); } };
      setTimeout(show, 1200);
    });
  }
  startGame(ch, opts = {}) {
    $('title').classList.remove('show');
    this.playing = true; this.uiBlocking = false;
    $('hud').classList.add('show');
    if (opts.chapterSelect) this.giveChapterKit(ch);
    this.story.start(ch);
    this.requestLock();
  }
  giveChapterKit(ch) {
    // sensible starting kit when jumping straight into a later chapter
    const inv = this.inv; inv.load({ items: {}, locks: ['bow'] });
    if (ch >= 1) { inv.add('knife'); inv.add('stick', 4); inv.add('stone', 3); }
    if (ch >= 2) { inv.add('wire'); inv.add('club'); inv.add('leaves', 3); inv.add('fiber', 3); }
    if (ch >= 3) { inv.add('torch'); inv.add('honey', 1); inv.add('meat_cooked', 2); }
    if (ch >= 4) { inv.add('bowl'); inv.add('spear'); inv.add('bamboo', 2); }
    if (ch >= 6) { inv.locks.delete('bow'); inv.add('bow'); inv.add('arrow', 12); inv.add('bandage', 2); }
    if (ch >= 8) { this.flags.chingari = true; }
    if (ch >= 10) { inv.add('matches'); }
    if (ch >= 11) { inv.add('flute'); }
    if (ch >= 12) { inv.add('lota'); }
    this.player.equip(ch >= 4 ? 'spear' : ch >= 1 ? 'knife' : 'fists');
  }
  freeRoam() {
    $('title').classList.remove('show');
    this.playing = true; this.uiBlocking = false; $('hud').classList.add('show');
    this.giveChapterKit(12); this.flags.chingari = true;
    this.story.chIndex = -1; this.story.done = true;
    const seasons = ['winter', 'summer', 'monsoon', 'post'];
    this.setSeason(this.freeSeason || 'post', null); this.setTime(7.5);
    this.teleport(new THREE.Vector3(SITES.den.x, 0, SITES.den.z + 10));
    this.story.ensureChingari();
    this.ui.setObjective('Free roam', 'Press <b>N</b> to change season. Explore Pench.');
    this.requestLock();
  }
  pause() { if (this.paused) return; this.paused = true; this.uiBlocking = true; $('pause').classList.add('show'); }
  resume() { this.paused = false; this.uiBlocking = false; $('pause').classList.remove('show'); $('settings').classList.remove('show'); this.requestLock(); }
  respawn() {
    this.ui.hideDeath();
    const camp = this.camps[this.camps.length - 1];
    this.player.respawn(camp ? camp.pos.clone().add(new THREE.Vector3(1.5, 0, 1.5)) : null);
    this.ui.narrate('I woke by the ashes. Everything hurt.');
    // restart the chapter so scripted encounters are coherent
    const keep = this.story.chIndex;
    if (keep >= 0) this.story.start(keep, { keepState: !!camp });
    this.requestLock();
  }
  onKey(e) {
    if (e.code === 'F3') { e.preventDefault(); this.perf.cycle(); return; }
    if (!this.playing) return;
    const ui = this.ui;
    if (e.code === 'Tab') { e.preventDefault(); if (!this.paused && !this.player.dead) ui.toggle('inv'); return; }
    if (e.code === 'KeyJ' && !this.paused) { ui.toggle('journal'); return; }
    if (e.code === 'KeyM' && !this.paused) { ui.toggle('map'); return; }
    if (e.code === 'Escape') { if (ui.open) { ui.close(); return; } if (this.paused) { this.resume(); } else if (this.playing && !document.pointerLockElement && !this.player.dead) this.pause(); return; }
    if (this.uiBlocking) return;
    const P = this.player;
    if (e.code === 'KeyV') { const v = P.view === 'fpp' ? 'tpp' : 'fpp'; P.setView(v); this.settings.view = v; this.applySettings(); }
    if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); const ws = ['fists', 'knife', 'club', 'spear', 'bow', 'torch']; if (ws[n - 1]) P.equip(ws[n - 1]); }
    if (e.code === 'KeyT') P.equip(P.weapon === 'torch' ? (this.prevWeapon || 'fists') : (this.prevWeapon = P.weapon, 'torch'));
    if (e.code === 'KeyQ' && !e.repeat) { ui.openWheel(); this.wheelOpen = true; }
    if (e.code === 'KeyE') this.interact();
    if (e.code === 'KeyH') this.useBandage();
    if (e.code === 'KeyB') this.eatBest();
    if (e.code === 'KeyN' && this.story.done) { const s = ['winter', 'summer', 'monsoon', 'post']; this.setSeason(s[(s.indexOf(this.season) + 1) % 4]); this.ui.toast(this.seasonCfg.label); }
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
    if (story.chapter && story.chapter.id === 'ep' && story.objIndex === 2 && story.aaji && d2(story.aaji.pos) < 4 * 4) return { prompt: 'Set the lota on the ground', act: () => story.interact('aaji') };
    if (this.companionBody && story.chapter && story.chapter.id === 'c2' && story.objIndex === 3 && d2(this.companionBody.pos) < 3.2 * 3.2) {
      const n = this.inv.count('leaves');
      return { prompt: n >= 3 ? 'Cover Kaali with leaves' : `Cover Kaali (need 3 leaves, have ${n})`, act: () => { if (this.inv.take('leaves', 3)) { this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 2.5 }; this.audio.footstep('leaf', 1); setTimeout(() => { this.coverBody(this.companionBody); story.flags.coveredKaali = true; story.checkNow(); }, 2200); } else this.ui.toast('Gather more leaves'); } };
    }
    // props
    for (const it of this.props.inter) {
      if (it.kind === 'trigger') continue;
      const dd = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z), dy = Math.abs(it.pos.y - (pos.y + 1));
      if (dd > it.r || dy > 3.5) continue;
      if (it.kind === 'clue') return { prompt: it.prompt, act: () => { this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.4 }; this.audio.pickup(); this.emit('clue', { id: it.id }); if (it.id === 'denMarks') { this.ui.narrate(['Hundreds of scratches, in rows. One for every night.', 'I did not know why I made them.']); this.ui.addJournal('Marks on the den wall', 'I scratch a mark each night. There are hundreds. Older me knows what this is: counting. I did not.', 'clue'); } } };
      if (it.kind === 'hive') return { prompt: P.weapon === 'torch' ? 'Smoke the hive for honey' : 'Take honey (no smoke…)', act: () => this.hiveAction() };
      if (it.kind === 'climb') { const top = P.pos.y > SITES.tower.y + 6; return { prompt: top ? 'Climb down' : 'Climb the ladder (W)', act: () => this.climbLadder(top) }; }
      if (it.kind === 'water') return { prompt: it.prompt, act: () => this.drink() };
      if (it.kind === 'story') { if (story.chapter && story.chapter.id === 'c8' && story.objIndex === 1) return { prompt: it.prompt, act: () => story.interact(it.id) }; }
    }
    // tower ladder top (from platform)
    // campfire
    for (const c of this.camps) if (d2(c.pos) < 2.6 * 2.6) {
      if (this.inv.has('meat_raw')) return { prompt: 'Cook meat over the fire', act: () => this.cook(c) };
      return { prompt: 'Sleep by the fire (until morning)', act: () => this.sleep(c) };
    }
    // carcass
    for (const a of this.eco.animals) if (a.dead && !a.harvested && !a.companion && a !== this.companionBody && a.dist2(pos) < (a.d.L * 0.6 + 1.6) ** 2) {
      return { prompt: this.inv.has('knife') ? `Skin the ${a.name || a.sp}` : 'You need a knife to skin it', act: () => this.harvest(a) };
    }
    // recover projectiles
    for (const s of P.stuck) { const v = new THREE.Vector3(); s.mesh.getWorldPosition(v); if (v.distanceTo(pos) < 2.4 && (!s.animal || s.animal.dead) && s.item) return { prompt: 'Recover ' + (s.item === 'spear' ? 'spear' : 'arrow'), act: () => P.recoverNear() }; }
    // pickups
    const pk = this.pickups.nearest(eye, fwd, P.view === 'fpp' ? 2.8 : 3.6);
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
    if (wl > groundHeight(ahead.x, ahead.z) - 0.05 && wl > pos.y - 1.6 && !P.swimming) return { prompt: 'Drink', act: () => this.drink() };
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
  interact() { const it = this.currentInteraction; if (it && !this.player.action) it.act(); }
  pickup(pk) {
    this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 0.7 };
    this.pickups.take(pk); this.inv.add(pk.type, 1); this.audio.pickup();
    this.ui.toast('+1 ' + ITEMS[pk.type].name); this.emit('pickup', { item: pk.type });
  }
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
      setTimeout(() => { this.inv.add('honey', 2); this.inv.add('fiber', 1); this.ui.toast('+2 Honey'); this.ui.narrate('The smoke made them slow. I took the comb and ran.'); this.emit('pickup', { item: 'honey' }); }, 2800);
    } else {
      this.ui.narrate('The bees came down like smoke.');
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
    setTimeout(() => { P.thirst = Math.min(100, P.thirst + 40); this.emit('drink'); if (this.season === 'summer' && Math.random() < 0.08) { P.sick = 2; this.ui.toast('The water was foul'); } }, 1600);
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
    setTimeout(() => { this.inv.take('meat_raw', n); this.inv.add('meat_cooked', n); this.ui.toast(`Cooked ${n} meat`); this.emit('cook', { n }); }, 2800);
  }
  async sleep(c) {
    const P = this.player;
    if (P.dead) return;
    const threats = this.eco.animals.filter((a) => !a.dead && a.target === 'player' && a.dist2(P.pos) < 60 * 60);
    if (threats.length) { this.ui.toast('You cannot sleep with a predator close'); return; }
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
    this.ui.toast('Morning. Progress saved.');
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
    this.ui.toast(this.inv.has('matches') ? 'One scrape of the fire box.' : 'Fire-saw: bamboo against bamboo until it smokes.');
    this.emit('campfire');
  }
  eat(k) {
    const f = ITEMS[k] && ITEMS[k].food; if (!f || !this.inv.take(k, 1)) return;
    const P = this.player;
    P.hunger = Math.min(100, P.hunger + (f.hunger || 0)); P.thirst = Math.min(100, P.thirst + (f.thirst || 0)); P.hp = Math.min(100, P.hp + (f.hp || 0));
    if (f.sick && Math.random() < f.sick) { P.sick = 3; this.ui.toast('Your belly cramps'); }
    if (f.drunk) P.drunk = Math.min(1.5, P.drunk + f.drunk);
    if (!P.action) P.action = { type: 'eat', anim: 'eat', t: 0, dur: 1.6 };
    this.audio.eat(); this.emit('eat', { item: k });
  }
  eatBest() { for (const k of ['meat_cooked', 'honey', 'tendu', 'ber', 'mahua', 'termites', 'mushroom', 'meat_raw']) if (this.inv.has(k)) { this.eat(k); this.ui.toast('Ate ' + ITEMS[k].name); return; } this.ui.toast('Nothing to eat'); }
  useBandage() { if (!this.inv.take('bandage', 1)) { this.ui.toast('No bandage (craft from leaves + fibre)'); return; } this.player.bleed = 0; this.player.hp = Math.min(100, this.player.hp + 5); this.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.5 }; this.ui.toast('Wound bound'); }
  // -------------------------------------------------------------------------------- save/load
  save() {
    if (this.story.chIndex < 0 && !this.story.done) return;
    const P = this.player;
    store.set('vanaj-save-v1', { ch: this.story.chIndex, done: this.story.done, inv: this.inv.toJSON(), hour: this.time.hour, day: this.time.day, season: this.season, flags: this.flags, hp: P.hp, hunger: P.hunger, thirst: P.thirst, journal: this.ui.journal, lore: [...this.ui.loreSeen], explored: Array.from(this.ui.explored), discovered: [...this.ui.discovered] });
  }
  loadSave() {
    const s = store.get('vanaj-save-v1'); if (!s) return this.beginNew();
    this.inv.load(s.inv || {}); this.flags = s.flags || {}; this.time.day = s.day || 0;
    this.ui.journal = s.journal || []; this.ui.loreSeen = new Set(s.lore || []); this.ui.discovered = new Set(s.discovered || []);
    if (s.explored) this.ui.explored.set(s.explored);
    if (s.done) { this.freeSeason = s.season; this.freeRoam(); return; }
    this.startGame(Math.max(0, s.ch));
    this.player.equip(this.inv.equipped);
  }
  // -------------------------------------------------------------------------------- frame
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    this.perf.frameStart(t - this.last);
    let rdt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    if (this.hitstopT > 0) { this.hitstopT -= rdt; rdt *= 0.08; }
    if (this.slowT > 0) { this.slowT -= rdt; rdt *= this.slowK; }
    const dt = this.paused ? 0 : rdt;
    try { this.update(dt, rdt); } catch (e) { console.error(e); }
    this.render(rdt);
    this.input.endFrame();
    this.perf.frameEnd({ scene: this.scene, composer: this.composer, quality: (this.settings.quality || '').replace(/^./, (c) => c.toUpperCase()), animals: this.eco ? this.eco.animals.length : undefined });
  }
  update(dt, rdt) {
    const P = this.player;
    this.clock += dt;
    // timers
    if (dt > 0) for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.res(); } }
    // time of day
    if (this.playing && dt > 0) {
      this.time.hour += dt * this.time.rate / 3600;
      if (this.time.hour >= 24) { this.time.hour -= 24; this.time.day++; this.pickups.day = this.time.day; }
    }
    G.uTime.value += dt;
    // title screen camera: slow drift over the forest
    if (!this.playing) {
      this.titleCam += rdt * 0.025;
      const den = SITES.den; const a = this.titleCam;
      const cx = den.x - 60 + Math.cos(a) * 80, cz = den.z - 40 + Math.sin(a) * 80;
      this.camera.position.set(cx, groundHeight(cx, cz) + 14 + Math.sin(a * 2) * 3, cz);
      this.camera.lookAt(den.x + Math.cos(a + 0.6) * 40, groundHeight(den.x, den.z) + 6, den.z + Math.sin(a + 0.6) * 40);
      this.time.hour = 7.35 + Math.sin(this.titleCam * 0.3) * 0.15;
    } else if (dt > 0) {
      // wheel/look
      if (this.input.wheel && !this.uiBlocking) { const ws = this.inv.weapons(); const i = ws.indexOf(this.inv.equipped); P.equip(ws[(i + this.input.wheel + ws.length) % ws.length]); }
      if (this.wheelOpen) { this.input.mdx = 0; this.input.mdy = 0; }
      P.update(dt, this.input);
      // interaction prompt
      this.currentInteraction = this.uiBlocking ? null : this.findInteraction();
      this.ui.setPrompt(this.currentInteraction ? `<kbd>E</kbd> ${this.currentInteraction.prompt}` : (this.finishPromptFor() || ''));
      this.story.update(dt);
    }
    const pf = this.perf; pf.mark('player');
    const focus = this.playing ? P.pos : this.camera.position;
    G.uPlayerPos.value.copy(P.pos);
    // world streaming
    this.terrain.update(focus.x, focus.z, 4);
    this.veg.update(this.camera.position); this.grass.update(this.camera.position); this.cover.update(this.camera.position); this.pickups.update(focus);
    pf.mark('streaming');
    // sky & weather
    const env = this.weather.env;
    this.sky.update(dt || rdt * 0.2, this.time.hour, this.seasonCfg.decl, env, this.camera, focus);
    this.weather.update(rdt, dt * this.time.rate / 3600, this.time.hour, this.camera.position, this.sky);
    this.water.update(this.sky, env.rain);
    pf.mark('sky');
    // animals
    if (this.playing && dt > 0) { this.eco.update(dt, this.W); try { this.birds.update(dt); this.tracks.update(dt); this.places.update(dt, this.player.pos.x, this.player.pos.z, this.time.day * 1440 + this.time.hour * 60); } catch (e) { if (!this._birdErr) { this._birdErr = 1; console.error('birds', e); } } }
    pf.mark('animals');
    // fires: campfires burn down
    this.nearFire = false;
    let fireLevel = 0;
    for (const c of this.camps) { const d = c.pos.distanceTo(P.pos); if (d < 6) this.nearFire = true; fireLevel = Math.max(fireLevel, 1 - d / 14); }
    if (P.torchLit) fireLevel = Math.max(fireLevel, 0.25);
    if (this.audio.ready) this.audio.fireLevel = Math.max(0, fireLevel);
    this.fx.update(dt, this.camera.position, Math.max(0.12, this.sky.day));
    this.fx.updateAmbient(dt, this.camera.position, this.sky.night, this.season, env.rain > 0.2);
    pf.mark('effects');
    // audio
    if (this.audio.ready) {
      this.audio.setListener(this.camera);
      const dR = biomeAt(P.pos.x, P.pos.z).dRiver;
      const nearW = Math.max(clamp(1 - (dR - 14) / 90, 0, 1), waterAt(P.pos.x, P.pos.z) > -1e8 ? 0.4 : 0);
      const under = waterAt(this.camera.position.x, this.camera.position.z) > this.camera.position.y ? 1 : 0;
      const vd = Math.hypot(P.pos.x - SITES.village.x, P.pos.z - SITES.village.z);
      const inCave = Math.hypot(P.pos.x - SITES.cave.x, P.pos.z - SITES.cave.z) < 9;
      this.audio.setReverb(inCave ? 'cave' : 'forest');
      this.audio.update(rdt, { hour: this.time.hour, season: this.season, rain: env.rain, wind: G.uWindStrength.value, water: nearW, night: this.sky.night, under, village: this.story.villageSpawned ? clamp(1 - vd / 400, 0, 1) : 0 });
      if (this.music && this.playing) {
        let threat = 0;
        for (const a of this.eco.animals) if (!a.dead && !a.companion && a.target === 'player' && a.dist2(P.pos) < 60 * 60) { if (['charge', 'attack', 'pounce'].includes(a.state)) threat = Math.max(threat, a.d.kind === 'predator' ? 1 : 0.6); else if (a.state === 'stalk') threat = Math.max(threat, 0.3); }
        this.combatLevel = lerp(this.combatLevel || 0, threat, Math.min(1, rdt * (threat > (this.combatLevel || 0) ? 3 : 0.25)));
        if (!this.story.scriptMusic) this.music.setCombat(Math.max(this.combatLevel > 0.15 ? this.combatLevel : 0, this.music.combat > 0.9 && threat === 0 && this.combatLevel > 0.1 ? 0.2 : 0));
        this.music.update(rdt, this.time.hour, this.season, { suppress: this.paused });
      }
    }
    pf.mark('audio');
    this.ui.update(rdt);
    pf.mark('ui');
  }
  finishPromptFor() {
    const P = this.player;
    for (const a of this.eco.animals) {
      if (a.dist2(P.pos) > 2.6 * 2.6 || a.companion) continue;
      if (a.downed) return '<kbd>F</kbd> Finish him';
      if (!a.dead && a.hp < a.maxHp * 0.22 && (a.stagger > 0 || a.limp > 0.5 || a.state === 'retreat')) return '<kbd>F</kbd> Finish it';
    }
    return null;
  }
  render(rdt) {
    const P = this.player, gr = this.grade.uniforms;
    // exposure & grade by time of day
    const day = this.sky.day, night = this.sky.night;
    const el = this.sky.sunDir.y;
    const golden = (1 - smoothstep(0.0, 0.3, el)) * smoothstep(-0.1, 0.05, el);
    this.renderer.toneMappingExposure = lerp(2.2, 0.9, day) * (1 - this.weather.env.cloud * 0.1) + this.weather.flash * 2;
    gr.uTime.value += rdt; gr.uNight.value = night;
    gr.uTint.value.set(1 + golden * 0.12 + (this.season === 'summer' ? 0.04 : 0), 1 + golden * 0.02, 1 - golden * 0.12 - (this.season === 'summer' ? 0.05 : 0));
    gr.uSat.value = this.season === 'summer' ? 0.92 : this.season === 'monsoon' ? 1.08 : 1.02;
    gr.uHurt.value = Math.min(1, P.hurtFlash * 1.2 + (P.hp < 30 ? (30 - P.hp) / 40 : 0));
    gr.uLow.value = P.hp < 25 ? (25 - P.hp) / 25 : 0;
    gr.uFlash.value = this.weather.flash;
    gr.uUnder.value = this.playing && waterAt(this.camera.position.x, this.camera.position.z) > this.camera.position.y ? 1 : 0;
    gr.uHeat.value = this.season === 'summer' ? smoothstep(10, 13, this.time.hour) * (1 - smoothstep(16, 18, this.time.hour)) : 0;
    gr.uBlur.value = this.uiBlocking && this.playing ? 1 : (P.drunk > 0.4 ? (P.drunk - 0.4) : 0);
    this.updateGodRays();
    if (!this.noRender) { this.perf.gpuBegin(); this.composer.render(rdt); this.perf.gpuEnd(); }
    this.perf.mark('render');
  }
}

const game = window.game = new Game();
game.boot().catch((e) => { console.error(e); const s = document.getElementById('load-step'); if (s) s.textContent = 'Error: ' + e.message; });

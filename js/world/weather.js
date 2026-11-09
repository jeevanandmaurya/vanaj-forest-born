// Seasons of central India and a weather state machine: winter valley fog, summer heat haze and dust,
// pre-monsoon storms, monsoon rain with lightning, post-monsoon mist. Drives fog, wind, wetness, water level.
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';
import { mulberry32, clamp, lerp, smoothstep } from '../core/noise.js';
import { WATER_STATE, groundHeight, waterAt } from './terrain.js';

export const SEASONS = {
  winter: { dry: 0.35, label: 'Winter', month: 'December', decl: -23, green: 0.45, rise: 0.0, hole: -0.1, turb: 2.6, haze: 0.2, wind: 0.3, weights: { clear: 0.55, mist: 0.3, cloudy: 0.12, rain: 0.03 }, morningMist: 1.0, temp: [6, 26] },
  summer: { dry: 1.0, label: 'Summer', month: 'May', decl: 19, green: 0.06, rise: -0.7, hole: -0.75, turb: 7.5, haze: 0.9, wind: 0.45, weights: { clear: 0.5, hazy: 0.4, storm: 0.1 }, morningMist: 0.0, temp: [27, 45] },
  monsoon: { dry: 0.0, label: 'Monsoon', month: 'August', decl: 14, green: 1.0, rise: 1.3, hole: 0.35, turb: 4.5, haze: 0.4, wind: 0.6, weights: { rain: 0.45, storm: 0.2, cloudy: 0.3, clear: 0.05 }, morningMist: 0.5, temp: [23, 33] },
  post: { dry: 0.08, label: 'After the Rains', month: 'November', decl: -15, green: 0.85, rise: 0.35, hole: 0.15, turb: 3.0, haze: 0.25, wind: 0.25, weights: { clear: 0.55, mist: 0.35, cloudy: 0.1 }, morningMist: 1.0, temp: [12, 29] },
};
const WEATHER = {
  clear: { cloud: 0.12, rain: 0, fog: 1.0, wind: 1.0, lightning: 0 },
  hazy: { cloud: 0.25, rain: 0, fog: 2.4, wind: 1.2, lightning: 0 },
  mist: { cloud: 0.35, rain: 0, fog: 1.6, wind: 0.5, lightning: 0, mist: 1 },
  cloudy: { cloud: 0.72, rain: 0, fog: 1.5, wind: 1.4, lightning: 0 },
  rain: { cloud: 0.93, rain: 0.65, fog: 3.2, wind: 1.8, lightning: 0.02 },
  storm: { cloud: 1.0, rain: 1.0, fog: 4.0, wind: 3.0, lightning: 0.25 },
};

export class Weather {
  constructor(scene, quality, audio) {
    this.scene = scene; this.q = quality; this.audio = audio;
    this.season = 'winter'; this.state = 'clear'; this.timer = 0.5;
    this.env = { cloud: 0.12, rain: 0, fog: 1, wind: 0.3, turbidity: 3, haze: 0.2, mist: 0, lightning: 0 };
    this.target = { ...this.env };
    this.rng = mulberry32(99);
    this.flash = 0; this.flashT = 0; this.nextBolt = 10; this.wetness = 0;
    this.windAngle = 0.4;
    this.buildRain(); this.buildSplashes(); this.buildBolt();
    this.forced = null;
  }
  setSeason(s, forceState) {
    this.season = s;
    const cfg = SEASONS[s];
    G.uSeasonGreen.value = cfg.green;
    G.uDry.value = cfg.dry;
    this.pick(forceState);
    this.env = { ...this.target }; // snap
  }
  pick(force) {
    const cfg = SEASONS[this.season];
    let st = force;
    if (!st) {
      let r = this.rng(), acc = 0; st = 'clear';
      for (const k in cfg.weights) { acc += cfg.weights[k]; if (r <= acc) { st = k; break; } }
    }
    this.state = st;
    const w = WEATHER[st];
    this.target = { cloud: w.cloud, rain: w.rain, fog: w.fog, wind: cfg.wind * w.wind, turbidity: cfg.turb, haze: cfg.haze, mist: w.mist || 0, lightning: w.lightning };
    this.timer = 6 + this.rng() * 10; // game hours
  }
  force(state) { this.forced = state; this.pick(state); }
  applyQuality() { this.rain.geometry.instanceCount = this.q.rainDrops || 5000; }
  buildRain() {
    const N = 6000;   // the most any level draws (see applyQuality)
    const geo = new THREE.PlaneGeometry(0.012, 0.55);
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = geo.index; inst.attributes.position = geo.attributes.position; inst.attributes.uv = geo.attributes.uv;
    const offs = new Float32Array(N * 4); const r = mulberry32(5);
    for (let i = 0; i < N; i++) { offs[i * 4] = r(); offs[i * 4 + 1] = r(); offs[i * 4 + 2] = r(); offs[i * 4 + 3] = r(); }
    inst.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 4));
    inst.instanceCount = this.q.rainDrops || 5000;
    this.rainU = { uT: { value: 0 }, uInt: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWindR: { value: new THREE.Vector2() }, uLight: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 aOff; uniform float uT, uInt; uniform vec3 uCam; uniform vec2 uWindR; varying float vA; varying vec2 vUv;
        void main(){
          vec3 box = vec3(36.0, 26.0, 36.0);
          vec3 o = aOff.xyz * box;
          o.y -= uT * (9.0 + aOff.w * 3.0);
          o.xz += uWindR * uT * 0.0;
          vec3 base = uCam - box * 0.5;
          vec3 p = mod(o - base, box) + base;
          vA = step(aOff.w, uInt) * (0.25 + aOff.w * 0.35);
          vec3 slant = vec3(uWindR.x, 0.0, uWindR.y) * 0.08;
          vec3 toCam = normalize(vec3(uCam.x - p.x, 0.0, uCam.z - p.z));
          vec3 right = vec3(toCam.z, 0.0, -toCam.x);
          vec3 wp = p + right * position.x + (vec3(0.0, 1.0, 0.0) + slant) * position.y;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `uniform float uLight; varying float vA; varying vec2 vUv;
        void main(){ if (vA <= 0.0) discard; float a = vA * (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y);
          gl_FragColor = vec4(vec3(0.75, 0.78, 0.82) * uLight, a); }`,
    });
    this.rain = new THREE.Mesh(inst, mat); this.rain.frustumCulled = false; this.rain.renderOrder = 5;
    this.scene.add(this.rain);
  }
  buildSplashes() {
    const N = 180;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.strokeStyle = 'rgba(220,225,235,0.9)'; x.lineWidth = 3; x.beginPath(); x.arc(32, 32, 26, 0, 6.28); x.stroke();
    const t = new THREE.CanvasTexture(c);
    this.splashMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.5, fog: false });
    this.splash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 0.25).rotateX(-Math.PI / 2), this.splashMat, N);
    this.splash.frustumCulled = false; this.splash.count = 0;
    this.splashData = []; for (let i = 0; i < N; i++) this.splashData.push({ x: 0, y: -999, z: 0, t: Math.random() });
    this.scene.add(this.splash);
  }
  buildBolt() {
    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 60), 3));
    this.bolt = new THREE.LineSegments(this.boltGeo, new THREE.LineBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0, fog: false }));
    this.bolt.frustumCulled = false; this.scene.add(this.bolt);
  }
  strike(cam) {
    const r = this.rng;
    const a = r() * 6.28, d = 250 + r() * 1300;
    const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d, y0 = cam.y + 650;
    const arr = this.boltGeo.attributes.position.array; let px = x, py = y0, pz = z, n = 0;
    const gy = groundHeight(x, z);
    while (py > gy && n < 58) {
      const nx = px + (r() - 0.5) * 50, ny = py - (20 + r() * 40), nz = pz + (r() - 0.5) * 50;
      arr.set([px, py, pz, nx, Math.max(ny, gy), nz], n * 3); n += 2; px = nx; py = ny; pz = nz;
    }
    for (let i = n; i < 60; i++) arr.set([px, py, pz], i * 3);
    this.boltGeo.attributes.position.needsUpdate = true;
    this.bolt.material.opacity = 1;
    this.flashT = 0.35; this.flashSeq = [0, 0.06, 0.14, 0.22];
    if (this.audio) this.audio.thunder(d, a);
  }
  update(dt, gameDtHours, hour, cam, sky) {
    this.timer -= gameDtHours;
    if (this.timer <= 0 && !this.forced && !this.hold) this.pick();   // (hold: in the story each chapter keeps the weather it was written with)
    const k = Math.min(1, dt * 0.08);
    for (const key in this.target) this.env[key] = lerp(this.env[key], this.target[key], k);
    const cfg = SEASONS[this.season];
    // morning mist window 4:30 - 9:30
    const morning = smoothstep(4.0, 5.5, hour) * (1 - smoothstep(8.0, 10.0, hour));
    const mist = Math.max(this.env.mist, cfg.morningMist * morning * (this.state === 'clear' || this.state === 'mist' ? 0.85 : 0.5));
    const night = sky.night;
    // fog
    let dens = 0.00055 * this.env.fog * (1 + this.env.haze * 0.6);
    dens += mist * 0.012;
    G.uFogDensity.value = dens * (1 + night * 0.3);
    G.uFogHeight.value = lerp(0.012, 0.09, mist);
    G.uFogBase.value = lerp(30, 26, mist);
    // wind
    this.windAngle += dt * 0.01 * (this.rng() - 0.3);
    G.uWind.value.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    G.uWindStrength.value = clamp(this.env.wind, 0.05, 3);
    // wetness
    const targetWet = this.env.rain > 0.05 ? 1 : (this.season === 'monsoon' ? 0.35 : 0);
    this.wetness = lerp(this.wetness, targetWet, Math.min(1, dt * (targetWet > this.wetness ? 0.08 : 0.01)));
    G.uWetness.value = this.wetness;
    // water level
    G.uWaterRise.value = lerp(G.uWaterRise.value, cfg.rise + this.env.rain * 0.3, Math.min(1, dt * 0.05));
    WATER_STATE.holeOffset = lerp(WATER_STATE.holeOffset, cfg.hole, Math.min(1, dt * 0.05));
    // rain particles
    this.rainU.uT.value += dt; this.rainU.uCam.value.copy(cam);
    this.rainU.uInt.value = this.env.rain;
    this.rainU.uLight.value = 0.25 + sky.day * 0.75 + this.flash * 2;
    this.rain.visible = this.env.rain > 0.02;
    // splashes
    this.updateSplashes(dt, cam);
    // lightning
    if (this.env.lightning > 0.01) {
      this.nextBolt -= dt * this.env.lightning * 4;
      if (this.nextBolt <= 0) { this.nextBolt = 2 + this.rng() * 12; this.strike(cam); }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = 0.35 - this.flashT; let f = 0;
      for (const s of this.flashSeq) f = Math.max(f, Math.exp(-Math.abs(t - s) * 40));
      this.flash = f;
    } else this.flash = 0;
    this.bolt.material.opacity = Math.max(0, this.bolt.material.opacity - dt * 5); this.bolt.visible = this.bolt.material.opacity > 0;
    G.uFlash.value = this.flash; sky.flash = this.flash;
  }
  updateSplashes(dt, cam) {
    const on = this.env.rain > 0.05;
    this.splash.visible = on;
    if (!on) { this.splash.count = 0; return; }
    const m = new THREE.Matrix4(); let n = 0;
    const maxN = Math.floor(this.splashData.length * Math.min(1, this.env.rain * 1.3));
    for (let i = 0; i < maxN; i++) {
      const s = this.splashData[i];
      s.t += dt * 2.6;
      if (s.t >= 1) {
        s.t = 0; s.x = cam.x + (Math.random() - 0.5) * 22; s.z = cam.z + (Math.random() - 0.5) * 22;
        s.y = Math.max(groundHeight(s.x, s.z), waterAt(s.x, s.z)) + 0.04;
      }
      const sc = 0.3 + s.t * 1.4;
      m.makeScale(sc, 1, sc); m.setPosition(s.x, s.y, s.z);
      this.splash.setMatrixAt(n++, m);
    }
    this.splash.count = n; this.splash.instanceMatrix.needsUpdate = true;
    this.splashMat.opacity = 0.35 * this.env.rain;
  }
  temperature(hour) {
    const t = SEASONS[this.season].temp;
    const d = 0.5 - 0.5 * Math.cos(((hour - 4) / 24) * Math.PI * 2);
    return lerp(t[0], t[1], d) - this.env.rain * 4;
  }
}

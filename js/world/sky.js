// Physically-based sky (Preetham), real sun path for 21.7°N with seasonal declination, moon, stars,
// procedural cloud dome, sky-sampled fog colours, PMREM environment lighting.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { G, NOISE_GLSL } from '../core/shaderlib.js';
import { mulberry32, clamp, smoothstep, lerp } from '../core/noise.js';
import { PAINTED, paintedLight, paintedHour } from '../core/palette.js';
import { RIM } from '../core/toon.js';

const LAT = 21.7 * Math.PI / 180;
const _sv = new THREE.Vector3(), _sr = new THREE.Vector3(), _su = new THREE.Vector3(), _sa = new THREE.Vector3(), _sUp = new THREE.Vector3(0, 1, 0), _rc = new THREE.Color();

function kelvin(k) {
  // approx blackbody to linear RGB
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  return new THREE.Color(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255).convertSRGBToLinear();
}

// The Preetham sky of lib/addons/objects/Sky.js, evaluated on the CPU for one view direction (unit vectors
// d and sun, uniforms U); returns linear [r, g, b] as the shader writes it (no tone mapping, no sun disc).
function preetham(d, sun, U) {
  const e = Math.E, pi = Math.PI, EE = 1000, cutoff = 1.6110731556870734, steep = 1.5;
  const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const sunE = EE * Math.max(0, 1 - Math.pow(e, -((cutoff - Math.acos(clamp(sun.y, -1, 1))) / steep)));
  const sunfade = 1 - clamp(1 - Math.exp(U.sunPosition.value.y / 450000), 0, 1);
  const rc = U.rayleigh.value - (1 - sunfade), mc = 0.434 * (0.2 * U.turbidity.value) * 10e-18 * U.mieCoefficient.value;
  const zen = Math.acos(Math.max(0, d.y)), inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen * 180 / pi, -1.253));
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv, cosT = d.x * sun.x + d.y * sun.y + d.z * sun.z;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = U.mieDirectionalG.value, mPhase = 0.07957747154594767 * ((1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5));
  const horizonMix = clamp(Math.pow(1 - sun.y, 5), 0, 1), out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const bR = totalRayleigh[c] * rc, bM = MieConst[c] * mc, Fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let Lin = Math.pow(Math.max(0, sunE * ratio * (1 - Fex)), 1.5);
    Lin *= lerp(1, Math.pow(Math.max(0, sunE * ratio * Fex), 0.5), horizonMix);
    const tex = (Lin + 0.1 * Fex) * 0.04 + [0, 0.0003, 0.00075][c];
    out[c] = Math.pow(tex, 1 / (1.2 + 1.2 * sunfade));
  }
  return out;
}

export class SkySystem {
  constructor(scene, renderer, quality) {
    this.scene = scene; this.renderer = renderer; this.q = quality;
    this.sky = new Sky(); this.sky.scale.setScalar(3000); this.sky.layers.enable(1);
    scene.add(this.sky);
    this.u = this.sky.material.uniforms;
    this.u.turbidity.value = 4; this.u.rayleigh.value = 1.6; this.u.mieCoefficient.value = 0.004; this.u.mieDirectionalG.value = 0.82;
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3();
    this.sunColor = new THREE.Color(); this.day = 1; this.night = 0;

    // Lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sm = quality.shadow;
    this.sun.shadow.mapSize.set(sm, sm);
    const sd = quality.shadowDist;
    Object.assign(this.sun.shadow.camera, { left: -sd, right: sd, top: sd, bottom: -sd, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x9fb4d0, 0x5a4630, 0.5);
    scene.add(this.hemi);

    this.buildStars(); this.buildMoon(); this.buildClouds();
    if (PAINTED) { this.sky.visible = false; this.clouds.visible = false; this.buildPainted(); }

    // env
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: 0x3a2c1e }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -40; this.envScene.add(ground); this.envGround = ground;
    this.envTarget = null; this.lastEnvSun = new THREE.Vector3(9, 9, 9); this.envTimer = 0;

    // sampler for fog colours
    this.sampleRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
    this.sampleCam = new THREE.PerspectiveCamera(30, 1, 1, 5000); this.sampleCam.layers.set(1);
    this.samplePix = new Float32Array(8 * 8 * 4);
    this.fogA = new THREE.Color(0.5, 0.55, 0.6); this.fogB = new THREE.Color(0.8, 0.7, 0.6);
    this.zenith = new THREE.Color(0.2, 0.35, 0.7); this.horizon = new THREE.Color(0.6, 0.7, 0.8);
    this.sampleTimer = 0; this.sampleOk = true;
    this.cloudCover = 0.2; this.turbidity = 4; this.flash = 0;
  }
  buildStars() {
    const r = mulberry32(42), N = 3200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      let x, y, z;
      if (i < N * 0.45) { // milky way band
        const a = r() * 6.283, w = (r() - 0.5) * 0.25;
        x = Math.cos(a); y = Math.sin(a) * 0.6 + w; z = Math.sin(a) * 0.8 - w * 0.5;
      } else { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; }
      const l = Math.hypot(x, y, z) || 1;
      pos[i * 3] = x / l * 2600; pos[i * 3 + 1] = y / l * 2600; pos[i * 3 + 2] = z / l * 2600;
      const b = Math.pow(r(), 3) * 1.4 + 0.15, warm = r();
      col[i * 3] = b * (0.85 + warm * 0.25); col[i * 3 + 1] = b * 0.92; col[i * 3 + 2] = b * (1.1 - warm * 0.25);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.stars = new THREE.Points(g, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -5;
    this.scene.add(this.stars);
  }
  buildMoon() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.42, 'rgba(240,235,220,1)'); gr.addColorStop(0.47, 'rgba(200,210,255,0.25)'); gr.addColorStop(1, 'rgba(150,170,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const r = mulberry32(3); x.fillStyle = 'rgba(150,150,140,0.35)';
    for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(46 + r() * 36, 46 + r() * 36, 4 + r() * 9, 0, 6.28); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.moon.renderOrder = -4; this.moon.layers.enable(1);
    this.scene.add(this.moon);
  }
  buildClouds() {
    const geo = new THREE.SphereGeometry(2500, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
    this.cloudU = { uCover: { value: 0.3 }, uTimeC: { value: 0 }, uSun: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uFlashC: { value: 0 }, uDark: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudU, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `${NOISE_GLSL}
        uniform float uCover, uTimeC, uFlashC, uDark; uniform vec3 uSun; uniform vec3 uSunC, uAmb; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); if (d.y < 0.0) discard;
          vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTimeC * 0.006, uTimeC * 0.002);
          float n = fbm2(uv) * 0.65 + fbm2(uv * 3.1 + 7.0) * 0.35;
          float cov = mix(0.75, 0.25, uCover);
          float dens = smoothstep(cov, cov + 0.28, n);
          float n2 = fbm2(uv + uSun.xz * 0.15) * 0.65 + fbm2(uv * 3.1 + 7.0 + uSun.xz * 0.4) * 0.35;
          float shadow = smoothstep(cov, cov + 0.5, n2);
          float sunAmt = pow(max(dot(d, uSun), 0.0), 8.0);
          vec3 lit = uSunC * (1.15 - shadow * 0.75) + uSunC * sunAmt * 1.5;
          vec3 col = uAmb * (0.6 + 0.4 * (1.0 - shadow)) + lit * 0.55;
          col *= mix(1.0, 0.35, uDark * dens);
          col += vec3(0.8, 0.85, 1.0) * uFlashC * dens * 3.0;
          float a = dens * smoothstep(0.0, 0.12, d.y) * 0.96;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.clouds = new THREE.Mesh(geo, mat); this.clouds.renderOrder = -3; this.clouds.frustumCulled = false; this.clouds.layers.enable(1);
    this.scene.add(this.clouds);
  }
  // The painted look's sky (docs/art-direction.md): a two-colour gradient with a soft sun glow, and flat cel
  // clouds on their own layer above the stars and moon. Clouds take two colours: lit on the side toward the
  // sun, shade inside.
  buildPainted() {
    const u = this.paintU = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uSunC: { value: new THREE.Color() },
      uCl: { value: new THREE.Color() }, uCs: { value: new THREE.Color() }, uSunD: { value: new THREE.Vector3(0, 1, 0) },
      uGlow: { value: 1 }, uDisc: { value: 1 }, uCover: { value: 0.3 }, uT: { value: 0 }, uDark: { value: 0 }, uFlashC: { value: 0 },
    };
    const vs = `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
    const head = `${NOISE_GLSL}
      uniform vec3 uTop, uHor, uHaze, uSunC, uCl, uCs, uSunD; uniform float uGlow, uDisc, uCover, uT, uDark, uFlashC; varying vec3 vD;`;
    const sky = new THREE.ShaderMaterial({
      uniforms: u, depthWrite: false, fog: false, side: THREE.BackSide, vertexShader: vs,
      fragmentShader: `${head}
        void main(){
          vec3 d = normalize(vD);
          vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.55, d.y));
          col = mix(col, uHaze, smoothstep(0.02, -0.12, d.y));          // below the horizon: haze over far hills
          float s = max(dot(d, uSunD), 0.0);
          col += uSunC * (pow(s, 6.0) * 0.22 + pow(s, 48.0) * 0.4) * uGlow;
          col = mix(col, uSunC * 1.3 + vec3(0.3), smoothstep(0.9986, 0.9991, s) * uDisc);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const clouds = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, vertexShader: vs,
      fragmentShader: `${head}
        float cl(vec2 p){ return fbm2(p) * 0.7 + fbm2(p * 2.3 + 5.0) * 0.3; }
        void main(){
          vec3 d = normalize(vD); if (d.y < -0.02) discard;
          vec2 uv = d.xz / (max(d.y, 0.0) + 0.1) * 0.5 + vec2(uT * 0.004, uT * 0.0015);
          float cov = mix(0.66, 0.38, uCover), n = cl(uv);
          float dens = smoothstep(cov, cov + 0.035, n) * smoothstep(-0.02, 0.1, d.y);
          float lit = 1.0 - smoothstep(cov + 0.05, cov + 0.09, cl(uv + uSunD.xz * 0.22));
          float s = max(dot(d, uSunD), 0.0);
          vec3 c = mix(uCs, uCl, lit) + uSunC * pow(s, 8.0) * 0.35 * lit * uGlow;
          c = mix(c, c * 0.45, uDark) + vec3(0.8, 0.85, 1.0) * uFlashC * 2.0;
          gl_FragColor = vec4(c, dens * 0.96);
        }`,
    });
    const geo = new THREE.SphereGeometry(2500, 48, 24);
    this.paintSky = new THREE.Mesh(geo, sky); this.paintSky.renderOrder = -6; this.paintSky.frustumCulled = false;
    this.paintClouds = new THREE.Mesh(geo, clouds); this.paintClouds.renderOrder = -3; this.paintClouds.frustumCulled = false;
    this.scene.add(this.paintSky, this.paintClouds);
    this.scene.environment = null;
  }
  // palette-driven light, shade, rim, sky and haze; runs after the shared sun/moon/shadow code in update()
  paintUpdate(dt, hour, declDeg, env, season, sd, md, camera) {
    const p = paintedLight(paintedHour(hour, declDeg, LAT), season), cov = this.cloudCover, el = sd.y, dim = 1 - cov * 0.6;
    // direct light: the sun while it is up, then the moon
    this.sun.color.copy(p.sun);
    this.sun.intensity = el >= -0.05 ? p.sunI * smoothstep(-0.05, 0.08, el) * dim : p.sunI * smoothstep(0.0, 0.25, md.y) * (1 - cov * 0.8);
    G.uSunCol.value.copy(p.sun).multiplyScalar(this.day * dim);
    // shade is the sky's own colour with warm bounce from below, at about half the brightness of full sun so
    // shadows read as a cool mid-tone; half-desaturated, since a saturated blue light turns warm ground maroon
    const desat = (c, out) => { const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; return out.copy(c).lerp(_rc.setRGB(l, l, l), 0.45); };
    desat(p.sky, this.hemi.color); desat(p.gnd, this.hemi.groundColor);
    this.hemi.intensity = p.hemiI * 5.9 * (1 - cov * 0.2) + this.flash * 6;
    RIM.value.copy(p.sky).multiplyScalar(0.3 * p.hemiI).add(_rc.copy(p.sun).multiplyScalar(0.05 * p.sunI * dim));
    const u = this.paintU, sunUp = el > -0.1;
    u.uTop.value.copy(p.top).lerp(p.haze, cov * 0.5); u.uHor.value.copy(p.hor).lerp(p.haze, cov * 0.4); u.uHaze.value.copy(p.haze);
    u.uSunC.value.copy(p.sun); u.uSunD.value.copy(sunUp ? sd : md);
    u.uGlow.value = sunUp ? smoothstep(-0.1, 0.05, el) * dim : 0.3 * smoothstep(0.0, 0.2, md.y);
    u.uDisc.value = smoothstep(-0.03, 0.0, el) * (1 - cov * 0.9);
    u.uCl.value.copy(p.cl); u.uCs.value.copy(p.cs); u.uCover.value = cov; u.uT.value += dt * (1 + env.wind * 2);
    u.uDark.value = env.rain; u.uFlashC.value = this.flash;
    this.paintSky.position.copy(camera.position); this.paintClouds.position.copy(camera.position);
    // haze: the palette's haze colour, warmer toward the sun
    this.fogA.copy(p.haze); this.fogB.copy(p.haze).lerp(p.sun, 0.35 * this.day);
    this.horizon.copy(p.hor); this.zenith.copy(p.top);
  }
  // hour: 0..24, decl degrees
  computeSun(hour, declDeg) {
    const d = declDeg * Math.PI / 180, H = (hour - 12) * 15 * Math.PI / 180;
    const sinEl = Math.sin(LAT) * Math.sin(d) + Math.cos(LAT) * Math.cos(d) * Math.cos(H);
    const el = Math.asin(sinEl);
    const cosAz = (Math.sin(d) - Math.sin(el) * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT));
    let az = Math.acos(clamp(cosAz, -1, 1)); if (H > 0) az = 2 * Math.PI - az;
    // az from north, clockwise (east = 90deg). World: north = -z, east = +x.
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }
  update(dt, hour, declDeg, env, camera, focus, season) {
    const sd = this.computeSun(hour, declDeg);
    this.sunDir.copy(sd);
    const md = this.computeSun((hour + 12.5) % 24, -declDeg * 0.6); this.moonDir.copy(md);
    const el = sd.y;
    const day = smoothstep(-0.12, 0.18, el), night = 1 - smoothstep(-0.2, -0.02, el);
    this.day = day; this.night = night;
    this.cloudCover = lerp(this.cloudCover, env.cloud, Math.min(1, dt * 0.2));
    this.turbidity = lerp(this.turbidity, env.turbidity, Math.min(1, dt * 0.2));
    this.u.sunPosition.value.copy(sd).multiplyScalar(1000);
    this.u.turbidity.value = this.turbidity + this.cloudCover * 4;
    this.u.rayleigh.value = lerp(1.6, 0.6, this.cloudCover) + (1 - day) * 0.8;
    this.u.mieCoefficient.value = lerp(0.004, 0.012, this.cloudCover) + env.haze * 0.006;
    // sun light colour by elevation
    const k = 1800 + 4300 * smoothstep(-0.02, 0.5, el);
    this.sunColor.copy(kelvin(k));
    const cloudDim = 1 - this.cloudCover * 0.72;
    G.uSunCol.value.copy(this.sunColor).multiplyScalar(day * cloudDim);
    G.uSunVis.value = day * cloudDim;
    // directional light: sun by day, moon by night
    const useMoon = el < -0.05;
    const ldir = useMoon ? md : sd;
    G.uSunDir.value.copy(useMoon ? md : sd);
    if (useMoon) {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.24 * smoothstep(0.0, 0.3, md.y) * (1 - this.cloudCover * 0.8) * night;
    } else {
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 3.2 * smoothstep(-0.05, 0.12, el) * cloudDim;
    }
    // Shadows hold still. The sun moves every frame (a game minute per second), and re-drawing the shadow map
    // from a new angle each frame made the self-shadowed edges of trunks crawl and flicker. So the shadow
    // direction only steps once the sun has moved ~0.25 degrees, and the shadow camera is snapped to whole
    // shadow-map texels in the light's own frame (snapping in world x/z while following the player's height
    // let the grid slide under the trees).
    const L = this._shadowDir || (this._shadowDir = new THREE.Vector3());
    const want = _sv.set(ldir.x, Math.max(ldir.y, 0.08), ldir.z).normalize();
    if (L.lengthSq() === 0 || L.angleTo(want) > 0.0045) L.copy(want);
    const sdist = this.q.shadowDist, tex = (2 * sdist) / this.q.shadow;
    const right = _sr.crossVectors(_sUp, L); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
    const up = _su.crossVectors(L, right).normalize();
    const a = Math.round(focus.dot(right) / tex) * tex, b = Math.round(focus.dot(up) / tex) * tex, c = focus.dot(L);
    const anchor = _sa.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(L, c);
    this.sun.target.position.copy(anchor);
    this.sun.position.copy(anchor).addScaledVector(L, 300);
    this.sun.target.updateMatrixWorld();
    // hemisphere
    this.hemi.color.setRGB(lerp(0.05, 0.55, day), lerp(0.07, 0.66, day), lerp(0.14, 0.85, day)).multiplyScalar(1 - this.cloudCover * 0.25);
    this.hemi.groundColor.setRGB(lerp(0.03, 0.36, day), lerp(0.03, 0.28, day), lerp(0.04, 0.2, day));
    this.hemi.intensity = lerp(0.4, 0.95, day) + this.flash * 4;
    // stars / moon
    this.starMat.opacity = night * (1 - this.cloudCover * 0.9);
    this.stars.position.copy(camera.position);
    this.stars.rotation.set(0.38, hour / 24 * Math.PI * 2, 0);
    this.moon.position.copy(camera.position).addScaledVector(md, 2000);
    this.moon.lookAt(camera.position);
    this.moon.material.opacity = smoothstep(-0.05, 0.1, md.y) * (1 - day * 0.7) * (1 - this.cloudCover * 0.85);
    this.moon.visible = md.y > -0.05;
    // clouds
    this.clouds.position.copy(camera.position);
    const cu = this.cloudU;
    cu.uCover.value = this.cloudCover; cu.uTimeC.value += dt * (1 + env.wind * 2); cu.uSun.value.copy(sd);
    cu.uSunC.value.copy(this.sunColor).multiplyScalar(lerp(0.08, 1.6, day));
    cu.uAmb.value.setRGB(lerp(0.02, 0.5, day), lerp(0.025, 0.55, day), lerp(0.05, 0.62, day));
    cu.uDark.value = env.rain;
    cu.uFlashC.value = this.flash;
    this.sky.position.copy(camera.position);
    if (PAINTED) this.paintUpdate(dt, hour, declDeg, env, season, sd, md, camera);
    // sample fog colours from the rendered sky
    this.sampleTimer -= dt;
    if (!PAINTED && this.sampleTimer <= 0) { this.sampleTimer = 0.5; this.sampleFog(sd); }
    G.uFogColor.value.lerp(this.fogA, Math.min(1, dt * 2));
    G.uFogSun.value.lerp(this.fogB, Math.min(1, dt * 2));
    // environment map
    this.envTimer -= dt;
    if (!PAINTED && this.q.env && this.envTimer <= 0 && this.lastEnvSun.distanceTo(sd) > 0.03) {
      this.envTimer = 2; this.lastEnvSun.copy(sd); this.refreshEnv();
    }
  }
  // Fog colour from the sky itself, computed on the CPU with the same Preetham model the sky shader draws
  // (lib/addons/objects/Sky.js), a little above the horizon, away from and toward the sun, with cloud cover
  // greying it. This used to render the sky into a tiny target and read the pixels back, but any GPU read-back
  // (even the "async" one) waits for the GPU on Windows/ANGLE: a 15-50 ms hitch every half second.
  sampleFog(sd) {
    const U = this.u, az = new THREE.Vector3(sd.x, 0, sd.z); if (az.lengthSq() < 1e-4) az.set(1, 0, 0); az.normalize();
    const sun = U.sunPosition.value.clone().normalize();
    const look = (s, out) => {
      out.setRGB(0, 0, 0);
      for (const el of [0.03, 0.1, 0.2]) { const d = new THREE.Vector3(az.x * s, 0, az.z * s).multiplyScalar(Math.cos(el)).setY(Math.sin(el)); const c = preetham(d, sun, U); out.r += c[0] / 3; out.g += c[1] / 3; out.b += c[2] / 3; }
      const l = out.r * 0.3 + out.g * 0.59 + out.b * 0.11, cc = clamp(this.cloudCover, 0, 1) * 0.6;
      out.setRGB(lerp(out.r, l * 0.85, cc), lerp(out.g, l * 0.85, cc), lerp(out.b, l * 0.85, cc));
      return out;
    };
    const tmpA = look(-1, new THREE.Color()), tmpB = look(1, new THREE.Color());
    tmpB.multiplyScalar(lerp(1, 0.58, 1 - smoothstep(0.12, 0.5, sd.y)));   // a low sun shines through cloud and haze, not clear sky
    if (!isFinite(tmpA.r) || !isFinite(tmpB.r)) return this.heuristicFog(sd);
    this.fogA.copy(tmpA).multiplyScalar(0.92); this.fogB.copy(tmpB).multiplyScalar(0.92);
    this.horizon.copy(tmpA);
    this.zenith.copy(tmpA).multiplyScalar(0.7).lerp(new THREE.Color(0.12, 0.25, 0.6).multiplyScalar(this.day), 0.5);
  }
  // the old GPU sampler, kept for comparison/debugging (not called in play)
  sampleFogGPU(sd, camera) {
    if (!this.sampleOk) return this.heuristicFog(sd);
    if (this.sampling) return;
    try {
      const r = this.renderer, prevRT = r.getRenderTarget();
      const az = new THREE.Vector3(sd.x, 0, sd.z); if (az.lengthSq() < 1e-4) az.set(1, 0, 0); az.normalize();
      const cam = this.sampleCam; cam.position.copy(camera.position);
      this.sampleRTs = this.sampleRTs || [this.sampleRT, this.sampleRT.clone()];
      // these renders see only the sky, so they must not redraw the sun's shadow map for the whole forest or
      // re-walk the scene's matrices (that was most of the cost: two full shadow passes every half second)
      const shadowAuto = r.shadowMap.autoUpdate, matAuto = this.scene.matrixWorldAutoUpdate;
      r.shadowMap.autoUpdate = false; this.scene.matrixWorldAutoUpdate = false;
      const read = (dir, rt) => {
        cam.lookAt(cam.position.x + dir.x, cam.position.y + 0.04, cam.position.z + dir.z); cam.updateMatrixWorld();
        r.setRenderTarget(rt); r.render(this.scene, cam);
        return r.readRenderTargetPixelsAsync(rt, 0, 0, 8, 8, new Float32Array(256));
      };
      let pa, pb;
      try { pa = read(az.clone().negate(), this.sampleRTs[0]); pb = read(az, this.sampleRTs[1]); }
      finally { r.shadowMap.autoUpdate = shadowAuto; this.scene.matrixWorldAutoUpdate = matAuto; r.setRenderTarget(prevRT); }
      const avg = (px) => { let R = 0, Gc = 0, B = 0; for (let i = 0; i < 64; i++) { R += px[i * 4]; Gc += px[i * 4 + 1]; B += px[i * 4 + 2]; } return new THREE.Color(R / 64, Gc / 64, B / 64); };
      this.sampling = true;
      Promise.all([pa, pb]).then(([A, B]) => {
        this.sampling = false;
        const tmpA = avg(A), tmpB = avg(B);
        if (!isFinite(tmpA.r) || !isFinite(tmpB.r) || (this.day > 0.3 && tmpA.r + tmpA.g + tmpA.b < 1e-5)) { this.sampleOk = false; this.heuristicFog(this.sunDir); return; }
        this.fogA.copy(tmpA).multiplyScalar(0.92); this.fogB.copy(tmpB).multiplyScalar(0.92);
        this.horizon.copy(tmpA);
        this.zenith.copy(tmpA).multiplyScalar(0.7).lerp(new THREE.Color(0.12, 0.25, 0.6).multiplyScalar(this.day), 0.5);
      }, () => { this.sampling = false; this.sampleOk = false; this.heuristicFog(this.sunDir); });
    } catch (e) { this.sampling = false; this.sampleOk = false; this.heuristicFog(sd); }
  }
  heuristicFog(sd) {
    const day = this.day, el = sd.y;
    const sunset = (1 - smoothstep(0.0, 0.35, el)) * smoothstep(-0.15, 0.02, el);
    this.fogA.setRGB(lerp(0.02, 0.62, day), lerp(0.025, 0.72, day), lerp(0.05, 0.88, day));
    this.fogB.copy(this.fogA).lerp(new THREE.Color(1.2, 0.6, 0.3), sunset * 0.8);
    this.horizon.copy(this.fogA); this.zenith.setRGB(0.1, 0.22, 0.55).multiplyScalar(day + 0.05);
  }
  refreshEnv() {
    const eu = this.envSky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = this.u[k].value;
    eu.sunPosition.value.copy(this.u.sunPosition.value);
    if (this.sunDir.y < -0.05) eu.sunPosition.value.set(0, -1000, 0);
    this.envGround.material.color.setRGB(0.22 * this.day + 0.01, 0.17 * this.day + 0.01, 0.11 * this.day + 0.015);
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = lerp(0.12, 0.85, this.day);
    if (prev) prev.dispose();
  }
}

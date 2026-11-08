// Pench river ribbon, Totladoh reservoir and forest waterholes with a flowing, depth-aware water shader
// (fresnel sky reflection, treeline reflection, sun glint, shoreline foam, monsoon rain ripples).
import * as THREE from 'three';
import { G, NOISE_GLSL, ATMOS_GLSL, addGlobals } from '../core/shaderlib.js';
import { clamp } from '../core/noise.js';
import { PAINTED, PU } from '../core/palette.js';
import { height, riverX, riverY, RIVER_W, RIVER_END_Z, LAKE, LAKE_LEVEL, lakeE, WATERHOLES, HALF, WATER_STATE } from './terrain.js';

// Season looks of Pench water: clear green-teal winter pools, stagnant algae-green summer "doh",
// muddy ochre monsoon spate, settling and clearing after the rains.
const WATER_SEASON = {
  winter: { turb: 0.75, scatter: [0.014, 0.03, 0.026], tree: [0.07, 0.085, 0.05], algae: 0.0 },
  summer: { turb: 1.5, scatter: [0.028, 0.04, 0.014], tree: [0.11, 0.09, 0.06], algae: 1.0 },
  monsoon: { turb: 3.2, scatter: [0.11, 0.08, 0.042], tree: [0.05, 0.085, 0.035], algae: 0.0 },
  post: { turb: 1.0, scatter: [0.02, 0.036, 0.027], tree: [0.055, 0.085, 0.04], algae: 0.1 },
};

// the painted look's water: shallow-to-deep colour per season, light and dark ripple lines (stretched along
// the current in the river), flecks of sun glitter, banded sky and treeline reflection, and a white foam line
// that laps at every shore (docs/art-direction.md)
const PAINTED_WATER = {
  winter: ['#5cb8a8', '#1e6470'], summer: ['#8aa858', '#3a6a48'], monsoon: ['#b0905a', '#7a5a38'], post: ['#62b4a0', '#226a6a'],
};
const PAINTED_FRAG = /* glsl */`
  ${NOISE_GLSL}
  ${ATMOS_GLSL}
  uniform float uTime, uRain, uDay, uSunVis, uFlash, uTreeline; uniform vec3 uSunDir, uSunCol, uSkyZen, uSkyHor, uShallow, uDeep, uLeafShade; uniform vec2 uFlow;
  varying vec3 vWP; varying float vDepth; varying vec2 vFD;
  float aaStep(float e, float x) { float w = fwidth(x) * 0.75 + 1e-4; return smoothstep(e - w, e + w, x); }
  void main(){
    vec2 p = vWP.xz; float t = uTime, depth = max(vDepth, 0.0);
    float still = 1.0 - clamp(uFlow.y, 0.0, 1.0);
    vec3 light = mix(vec3(0.1, 0.14, 0.26), vec3(1.0), uDay) + uSunCol * 0.12;
    vec3 col = mix(uShallow, uDeep, smoothstep(0.1, 2.2, depth)) * light;
    // reflection: sky above the forest wall, in two flat bands
    vec3 V = normalize(vWP - cameraPosition);
    float NdV = max(-V.y, 0.0);
    vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
    float az = atan(R.z, R.x);
    float tl = uTreeline * (0.8 + 0.3 * vnoise(vec2(az * 4.0, 1.3)));
    vec3 refl = mix(uSkyHor, uSkyZen, smoothstep(0.1, 0.7, R.y));
    refl = mix(refl, mix(uLeafShade, uShallow, 0.35) * 0.8 * light, 1.0 - aaStep(tl, R.y));   // the forest's reflection: a soft green, not a dark slab
    col = mix(col, refl, (0.2 + 0.35 * aaStep(0.5, 1.0 - NdV)) * 0.75);
    // ripple lines: contour lines of slow noise; along the current they stretch into streaks
    vec2 fd = normalize(vFD + vec2(1e-4, 0.0));
    vec2 q = mix(p * 0.35, vec2(dot(p, vec2(fd.y, -fd.x)) * 0.9, dot(p, fd) * 0.12 - t * uFlow.y * 0.9), 1.0 - still);
    float rn = vnoise(q + t * 0.04 * still) * 0.7 + vnoise(q * 2.3 - t * 0.06) * 0.3;
    float fadeD = 1.0 - smoothstep(30.0, 140.0, distance(cameraPosition, vWP));
    float lineL = aaStep(0.94, sin(rn * 12.0)) * fadeD, lineD = aaStep(0.96, sin(rn * 12.0 + 2.2)) * fadeD;
    col = mix(col, mix(col, uSkyHor * light + 0.08, 0.6), lineL * 0.45);
    col = mix(col, col * 0.8, lineD * 0.35);
    // sun glitter: a few bright flecks along the sun's path on the water
    float glint = pow(max(dot(R, uSunDir), 0.0), 24.0) * aaStep(0.8, vnoise(p * 2.6 + vec2(t * 0.4, -t * 0.3)));
    col += uSunCol * uSunVis * glint * 2.0;
    // rain: white rings
    float ring = 0.0;
    if (uRain > 0.01) {
      vec2 cp = p * 1.2, ci = floor(cp), cf = fract(cp);
      float h = hash12(ci), life = fract(t * (0.9 + h) + h * 10.0);
      float dl = length(cf - 0.5 - (vec2(hash12(ci + 3.1), hash12(ci + 7.7)) - 0.5) * 0.4);
      ring = (1.0 - aaStep(0.025, abs(dl - life * 0.45))) * (1.0 - life) * uRain;
    }
    // foam: thin lines lapping at the shore, a few pixels wide whatever the bank's slope (a band of fixed depth
    // spread metres wide on gentle banks and read as snow), and white water where the river runs shallow and fast
    float lap = 0.1 + 0.06 * sin(t * 1.1 + vnoise(p * 0.7) * 7.0);
    float wd = fwidth(depth) * 1.6 + 0.003;
    float foam = 1.0 - smoothstep(wd * 0.5, wd, abs(depth - lap));
    foam = max(foam, (1.0 - smoothstep(wd * 0.5, wd, abs(depth - lap * 2.6))) * 0.5);
    foam = max(foam, (1.0 - smoothstep(wd * 0.6, wd * 1.4, vDepth)) * smoothstep(-wd * 1.5, 0.0, vDepth));   // the waterline itself, not the dry bank past it
    foam = max(foam, (1.0 - still) * aaStep(0.66, vnoise(p * 1.4 + fd * t * 1.6)) * (1.0 - smoothstep(0.15, 0.5, depth)) * 0.8);
    foam = max(foam, ring);
    col = mix(col, vec3(0.92, 0.94, 0.9) * light, foam * 0.85);
    col += vec3(0.8, 0.85, 1.0) * uFlash * 0.3;
    float a = mix(0.6, 0.94, smoothstep(0.0, 1.0, depth)) * smoothstep(-0.03, 0.03, depth);
    a = max(a, foam * 0.9 * smoothstep(-0.06, 0.0, depth));
    gl_FragColor = vec4(applyAtmos(col, vWP), a);
  }`;

function waterMaterial(riseRef, flow, treeline) {
  const u = {
    uRise: riseRef, uRain: { value: 0 }, uSkyZen: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
    uFlow: { value: new THREE.Vector2(0, flow) }, uDay: { value: 1 }, uTreeline: { value: treeline },
    uTurb: { value: 1 }, uScatter: { value: new THREE.Color(0.05, 0.08, 0.07) }, uTreeCol: { value: new THREE.Color(0.06, 0.08, 0.045) }, uAlgae: { value: 0 },
    uShallow: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uLeafShade: PU.uLeafShade,
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      attribute float aDepth; attribute vec2 aFlowDir;
      uniform float uRise; varying vec3 vWP; varying float vDepth; varying vec2 vFD;
      void main(){ vec3 p = position; p.y += uRise; vec4 w = modelMatrix * vec4(p,1.0); vWP = w.xyz; vDepth = aDepth + uRise; vFD = aFlowDir;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: PAINTED ? PAINTED_FRAG : `
      ${NOISE_GLSL}
      ${ATMOS_GLSL}
      uniform float uTime, uRain, uDay, uSunVis, uFlash, uTreeline, uTurb, uAlgae; uniform vec3 uSunDir, uSunCol, uSkyZen, uSkyHor, uScatter, uTreeCol; uniform vec2 uFlow;
      varying vec3 vWP; varying float vDepth; varying vec2 vFD;
      vec2 waveGrad(vec2 p, float t){
        vec2 g = vec2(0.0);
        vec2 dirs[5]; dirs[0]=vec2(1.0,0.2); dirs[1]=vec2(-0.4,1.0); dirs[2]=vec2(0.7,-0.7); dirs[3]=vec2(-0.9,-0.3); dirs[4]=vec2(0.2,0.95);
        for(int i=0;i<5;i++){ vec2 d = normalize(dirs[i]); float k = 1.3 + float(i)*0.9; float a = 0.05/(1.0+float(i)*0.6);
          float ph = dot(d, p) * k - t * (1.2 + float(i)*0.35); g += d * cos(ph) * a * k; }
        return g;
      }
      void main(){
        vec2 flowv = vFD * uFlow.y;
        vec2 p = vWP.xz;
        float t = uTime;
        float camD = distance(cameraPosition, vWP);
        float still = 1.0 - clamp(uFlow.y, 0.0, 1.0);
        // two-phase flow advection for the river, gentle wind ruffle on still pools
        float ph0 = fract(t * 0.08), ph1 = fract(t * 0.08 + 0.5);
        vec2 g0 = waveGrad(p * 0.8 + flowv * ph0 * 6.0, t), g1 = waveGrad(p * 0.8 + flowv * ph1 * 6.0 + 3.7, t);
        float wb = abs(ph0 - 0.5) * 2.0;
        vec2 g = mix(g0, g1, wb) * mix(1.0, 0.45, still);
        float e = 0.08;
        vec2 q = p * 2.3 + flowv * t * 0.8 + vec2(t * 0.05, t * 0.03) * still;
        float nx = vnoise(q + vec2(e,0.0)) - vnoise(q - vec2(e,0.0));
        float nz = vnoise(q + vec2(0.0,e)) - vnoise(q - vec2(0.0,e));
        g += vec2(nx, nz) * mix(0.9, 0.35, still);
        // cat's-paw wind gusts darkening patches of still water
        float gust = smoothstep(0.55, 0.8, vnoise(p * 0.06 + vec2(t * 0.15, -t * 0.08))) * still;
        g += vec2(vnoise(p * 6.0 + t), vnoise(p * 6.0 - t + 4.0)) * gust * 0.25;
        // rain ripples
        if (uRain > 0.01) {
          vec2 cellp = p * 1.4; vec2 ci = floor(cellp); vec2 cf = fract(cellp);
          for (int yy=-1; yy<=0; yy++) for (int xx=-1; xx<=0; xx++) {
            vec2 c = ci + vec2(float(xx), float(yy)) + 0.5;
            float h = hash12(c);
            vec2 ctr = c + vec2(hash12(c+3.1), hash12(c+7.7)) - 0.5 - ci;
            float life = fract(t * (0.9 + h) + h * 10.0);
            float rr = life * 0.9;
            vec2 dd = cf - ctr; float dl = length(dd);
            float ring = sin((dl - rr) * 40.0) * smoothstep(0.12, 0.0, abs(dl - rr)) * (1.0 - life);
            g += normalize(dd + 1e-4) * ring * 0.6 * uRain;
          }
        }
        // smooth glide over deep pools, choppy only where the river runs shallow and fast
        float chop = mix(0.3, 0.75, (1.0 - still) * smoothstep(1.2, 0.3, vDepth)) * mix(1.0, 0.6, still);
        g *= chop * (1.0 - smoothstep(10.0, 90.0, camD) * 0.8);       // calm the normals with distance (no sparkle aliasing)
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(vWP - cameraPosition);
        vec3 R = reflect(V, n); R.y = abs(R.y);
        float NdV = max(dot(-V, n), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        // reflection: sky, with the surrounding forest wall rising from the horizon
        vec3 sky = mix(uSkyHor, uSkyZen, pow(clamp(R.y, 0.0, 1.0), 0.5)) * 0.85;
        float az = atan(R.z, R.x);
        float tl = uTreeline * (0.72 + 0.38 * vnoise(vec2(az * 5.0, 1.3)) + 0.16 * vnoise(vec2(az * 26.0, 7.1)));
        float treeMask = 1.0 - smoothstep(tl - 0.05, tl + 0.03, R.y);
        vec3 treeC = uTreeCol * (0.2 + 0.8 * uDay) * (0.65 + 0.6 * vnoise(vec2(az * 48.0, R.y * 40.0)));
        treeC += uSunCol * uSunVis * 0.05 * smoothstep(0.2, -0.2, dot(normalize(vec3(R.x, 0.0, R.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
        vec3 refl = mix(sky, treeC, treeMask);
        // transmission: light path through the water column, bed visible in the shallows
        float depth = max(vDepth, 0.0);
        float path = depth / max(0.18, NdV);
        float T = exp(-uTurb * path);
        vec3 scat = uScatter * (0.22 + uDay * 0.95) + uSunCol * uSunVis * 0.025;
        // summer algae and floating litter on still, shallow water
        float alg = uAlgae * still * smoothstep(1.6, 0.2, depth) * smoothstep(0.45, 0.7, vnoise(p * 0.35) * 0.7 + vnoise(p * 2.1) * 0.3);
        float leafF = still * smoothstep(0.9, 0.93, vnoise(p * 3.3 + 1.7)) * smoothstep(2.5, 0.3, depth) * (0.3 + uAlgae * 0.7);
        // shoreline foam where the river runs shallow over stones
        float foam = (1.0 - still) * smoothstep(0.5, 0.0, depth) * smoothstep(0.35, 0.75, vnoise(p * 1.7 + flowv * t * 1.5) + vnoise(p * 4.0 - t * 0.3) * 0.5);
        float F = clamp(fres * (1.0 - alg * 0.8), 0.0, 1.0);
        float Tb = T * mix(0.72, 0.45, smoothstep(0.05, 0.5, depth)); // the wet bed reads darker and greener than dry ground
        float a = 1.0 - Tb * (1.0 - F);
        vec3 col = (scat * (1.0 - Tb) * (1.0 - F) + refl * F) / max(a, 1e-3);
        col = mix(col, vec3(0.12, 0.16, 0.05) * (0.3 + uDay * 0.8), alg * 0.85); a = max(a, alg * 0.9);
        col = mix(col, vec3(0.2, 0.13, 0.07) * (0.3 + uDay * 0.8), leafF * 0.8); a = max(a, leafF * 0.85);
        float spec = pow(max(dot(R, uSunDir), 0.0), 350.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;
        col += uSunCol * spec * uSunVis * (1.0 - treeMask * 0.85) * (1.0 - alg) / max(a, 0.25);
        col = mix(col, vec3(0.78, 0.78, 0.72) * (0.25 + uDay * 0.8), foam * 0.6); a = max(a, foam * 0.6);
        col += vec3(0.8, 0.85, 1.0) * uFlash * fres;
        a = clamp(a * smoothstep(0.0, 0.06, depth + 0.02), 0.0, 0.985);
        col = applyAtmos(col, vWP);
        gl_FragColor = vec4(col, a);
      }`,
  });
  m.onBeforeCompile = (s) => addGlobals(s);
  m.customProgramCacheKey = () => (PAINTED ? 'water-p' : 'water');
  // ShaderMaterial uniforms need the globals at creation too
  for (const k in G) u[k] = G[k];
  return m;
}

export class Water {
  constructor(scene) {
    this.scene = scene;
    this.riseRiver = G.uWaterRise; // shared
    this.riseLake = { value: 0 }; this.riseHole = { value: 0 };
    this.mats = [];
    this.buildRiver(); this.buildLake(); this.buildHoles();
  }
  buildRiver() {
    const pos = [], dep = [], fd = [], idx = [];
    const W2 = RIVER_W + 10, across = 36, step = 2;   // fine enough that per-vertex depth follows the banks
    let rows = 0;
    for (let z = -HALF; z <= RIVER_END_Z + 60; z += step) {
      const cx = riverX(z), y = riverY(z);
      const dxdz = (riverX(z + 1) - riverX(z - 1)) / 2;
      const fl = new THREE.Vector2(dxdz, 1).normalize();
      for (let k = 0; k <= across; k++) {
        const x = cx - W2 + (2 * W2) * (k / across);
        pos.push(x, y, z); dep.push(y - height(x, z)); fd.push(fl.x, fl.y);
      }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < across; k++) {
      const a = r * (across + 1) + k, b = a + 1, c = a + across + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.river = this.mesh(pos, dep, fd, idx, this.riseRiver, 1.0, 0.58);
  }
  buildLake() {
    const pos = [], dep = [], fd = [], idx = [];
    const step = 3, x0 = LAKE.x - LAKE.rx * 1.35, x1 = LAKE.x + LAKE.rx * 1.35, z0 = LAKE.z - LAKE.rz * 1.35, z1 = LAKE.z + LAKE.rz * 1.35;
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const map = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      if (lakeE(x, z) > 1.3) continue;
      map[j * (nx + 1) + i] = pos.length / 3;
      pos.push(x, LAKE_LEVEL, z); dep.push(LAKE_LEVEL - height(x, z)); fd.push(0, 0);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = map[j * (nx + 1) + i], b = map[j * (nx + 1) + i + 1], c = map[(j + 1) * (nx + 1) + i], d = map[(j + 1) * (nx + 1) + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
    this.lake = this.mesh(pos, dep, fd, idx, this.riseLake, 0.0, 0.09);
  }
  buildHoles() {
    this.holes = [];
    for (const w of WATERHOLES) {
      const pos = [], dep = [], fd = [], idx = [];
      const R = w.r + 3, ring = 64, rings = 20;   // ends under the bank, never past it
      pos.push(w.x, w.level, w.z); dep.push(w.level - height(w.x, w.z)); fd.push(0, 0);
      for (let r = 1; r <= rings; r++) for (let k = 0; k < ring; k++) {
        const a = k / ring * Math.PI * 2, rr = R * r / rings, x = w.x + Math.cos(a) * rr, z = w.z + Math.sin(a) * rr;
        pos.push(x, w.level, z); dep.push(w.level - height(x, z)); fd.push(0, 0);
      }
      for (let k = 0; k < ring; k++) idx.push(0, 1 + (k + 1) % ring, 1 + k);
      for (let r = 1; r < rings; r++) for (let k = 0; k < ring; k++) {
        const a = 1 + (r - 1) * ring + k, b = 1 + (r - 1) * ring + (k + 1) % ring, c = 1 + r * ring + k, d = 1 + r * ring + (k + 1) % ring;
        idx.push(a, b, c, b, d, c);
      }
      this.holes.push(this.mesh(pos, dep, fd, idx, this.riseHole, 0, clamp(14 / (w.r + 6), 0.25, 0.6)));
    }
  }
  mesh(pos, dep, fd, idx, rise, flow, treeline = 0.3) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setAttribute('aFlowDir', new THREE.Float32BufferAttribute(fd, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const mat = waterMaterial(rise, flow, treeline);
    this.mats.push(mat);
    const m = new THREE.Mesh(g, mat); m.renderOrder = 2; m.frustumCulled = true;
    this.scene.add(m); return m;
  }
  setSeason(season) {
    const c = WATER_SEASON[season] || WATER_SEASON.winter;
    for (const m of this.mats) {
      const isRiver = m.uniforms.uFlow.value.y > 0.5;
      m.uniforms.uTurb.value = c.turb * (isRiver && season === 'summer' ? 0.7 : 1);
      m.uniforms.uScatter.value.setRGB(...c.scatter); m.uniforms.uTreeCol.value.setRGB(...c.tree);
      m.uniforms.uAlgae.value = c.algae;
      const pw = PAINTED_WATER[season] || PAINTED_WATER.winter;
      m.uniforms.uShallow.value.set(pw[0]); m.uniforms.uDeep.value.set(pw[1]);
    }
  }
  update(sky, rain) {
    this.riseLake.value = G.uWaterRise.value * 0.6;
    this.riseHole.value = WATER_STATE.holeOffset;
    for (const m of this.mats) {
      m.uniforms.uSkyZen.value.copy(sky.zenith); m.uniforms.uSkyHor.value.copy(sky.horizon);
      m.uniforms.uRain.value = rain; m.uniforms.uDay.value = Math.max(0.08, sky.day);
    }
  }
}

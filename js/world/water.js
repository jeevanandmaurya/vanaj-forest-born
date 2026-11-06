// Pench river ribbon, Totladoh reservoir and forest waterholes with a flowing, depth-aware water shader
// (fresnel sky reflection, treeline reflection, sun glint, shoreline foam, monsoon rain ripples).
import * as THREE from 'three';
import { G, NOISE_GLSL, ATMOS_GLSL, addGlobals } from '../core/shaderlib.js';
import { height, riverX, riverY, RIVER_W, RIVER_END_Z, LAKE, LAKE_LEVEL, lakeE, WATERHOLES, HALF, WATER_STATE } from './terrain.js';

function waterMaterial(riseRef, flow) {
  const u = {
    uRise: riseRef, uRain: { value: 0 }, uSkyZen: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
    uFlow: { value: new THREE.Vector2(0, flow) }, uDay: { value: 1 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      attribute float aDepth; attribute vec2 aFlowDir;
      uniform float uRise; varying vec3 vWP; varying float vDepth; varying vec2 vFD;
      void main(){ vec3 p = position; p.y += uRise; vec4 w = modelMatrix * vec4(p,1.0); vWP = w.xyz; vDepth = aDepth + uRise; vFD = aFlowDir;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      ${NOISE_GLSL}
      ${ATMOS_GLSL}
      uniform float uTime, uRain, uDay, uSunVis, uFlash; uniform vec3 uSunDir, uSunCol, uSkyZen, uSkyHor; uniform vec2 uFlow;
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
        // two-phase flow advection for rivers
        float ph0 = fract(t * 0.08), ph1 = fract(t * 0.08 + 0.5);
        vec2 g0 = waveGrad(p * 0.8 + flowv * ph0 * 6.0, t), g1 = waveGrad(p * 0.8 + flowv * ph1 * 6.0 + 3.7, t);
        float wb = abs(ph0 - 0.5) * 2.0;
        vec2 g = mix(g0, g1, wb);
        float e = 0.08;
        vec2 q = p * 2.3 + flowv * t * 0.8;
        float nx = vnoise(q + vec2(e,0.0)) - vnoise(q - vec2(e,0.0));
        float nz = vnoise(q + vec2(0.0,e)) - vnoise(q - vec2(0.0,e));
        g += vec2(nx, nz) * 0.9;
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
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(vWP - cameraPosition);
        vec3 R = reflect(V, n);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
        vec3 sky = mix(uSkyHor, uSkyZen, pow(clamp(R.y, 0.0, 1.0), 0.5));
        // treeline reflection near the horizon of the reflection
        vec3 tree = vec3(0.03, 0.045, 0.025) * (0.3 + uDay);
        sky = mix(tree, sky, smoothstep(0.03, 0.28, R.y + (vnoise(p * 0.05) - 0.5) * 0.12));
        float depth = max(vDepth, 0.0);
        vec3 shallow = vec3(0.16, 0.16, 0.1), deep = vec3(0.015, 0.045, 0.04);
        vec3 wc = mix(shallow, deep, smoothstep(0.0, 3.0, depth)) * (0.25 + uDay * 0.9);
        wc += uSunCol * 0.04 * uSunVis;
        vec3 col = mix(wc, sky, fres);
        float spec = pow(max(dot(R, uSunDir), 0.0), 350.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;
        col += uSunCol * spec * uSunVis;
        // foam
        float foam = smoothstep(0.45, 0.0, depth) * smoothstep(0.35, 0.75, vnoise(p * 1.7 + flowv * t * 1.5) + vnoise(p * 4.0 - t * 0.3) * 0.5);
        col = mix(col, vec3(0.75, 0.75, 0.7) * (0.25 + uDay * 0.8), foam * 0.55);
        col += vec3(0.8, 0.85, 1.0) * uFlash * fres;
        float a = clamp(smoothstep(0.0, 0.9, depth) * 0.9 + fres * 0.3 + foam * 0.3, 0.0, 0.97);
        col = applyAtmos(col, vWP);
        gl_FragColor = vec4(col, a);
      }`,
  });
  m.onBeforeCompile = (s) => addGlobals(s);
  m.customProgramCacheKey = () => 'water';
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
    const W2 = RIVER_W + 10, across = 10, step = 4;
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
    this.river = this.mesh(pos, dep, fd, idx, this.riseRiver, 1.0);
  }
  buildLake() {
    const pos = [], dep = [], fd = [], idx = [];
    const step = 6, x0 = LAKE.x - LAKE.rx * 1.35, x1 = LAKE.x + LAKE.rx * 1.35, z0 = LAKE.z - LAKE.rz * 1.35, z1 = LAKE.z + LAKE.rz * 1.35;
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
    this.lake = this.mesh(pos, dep, fd, idx, this.riseLake, 0.0);
  }
  buildHoles() {
    this.holes = [];
    for (const w of WATERHOLES) {
      const pos = [], dep = [], fd = [], idx = [];
      const R = w.r + 5, ring = 20, rings = 6;
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
      this.holes.push(this.mesh(pos, dep, fd, idx, this.riseHole, 0));
    }
  }
  mesh(pos, dep, fd, idx, rise, flow) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setAttribute('aFlowDir', new THREE.Float32BufferAttribute(fd, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const mat = waterMaterial(rise, flow);
    this.mats.push(mat);
    const m = new THREE.Mesh(g, mat); m.renderOrder = 2; m.frustumCulled = true;
    this.scene.add(m); return m;
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

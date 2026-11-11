// Particles and effects: blood spray, ground blood pools and trails, fire (flame, embers, smoke, light),
// dust, water splashes, rock-bee swarms, fireflies, falling teak leaves.
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';
import { PAINTED } from '../core/palette.js';
import { toonify } from '../core/toon.js';
import { groundHeight, groundNormal, waterAt } from './terrain.js';

class Particles {
  constructor(scene, max, additive, soft = true) {
    this.max = max; this.n = 0;
    this.p = []; // particle records
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.instanceCount = 0;
    this.geo = g;
    this.u = { uLightK: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 aPos; attribute vec4 aCol; varying vec4 vCol; varying vec2 vUv; varying float vRot;
        void main(){ vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = aPos.xyz + (r * position.x + u * position.y) * aPos.w; vCol = aCol; vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
      fragmentShader: `uniform float uLightK; varying vec4 vCol; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = ${soft ? 'pow(max(0.0, 1.0 - d), 1.6)' : 'step(d, 1.0)'};
          if (a * vCol.a < 0.004) discard;
          gl_FragColor = vec4(vCol.rgb * ${additive ? '1.0' : 'uLightK'}, a * vCol.a); }`,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 7 : 6;
    scene.add(this.mesh);
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: 0, max: o.life || 1, s0: o.s0 || 0.2, s1: o.s1 ?? o.s0 ?? 0.2,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 1, grav: o.grav || 0, drag: o.drag || 0, fadeIn: o.fadeIn || 0, onGround: o.onGround });
  }
  update(dt) {
    const P = this.p; let w = 0;
    const ap = this.aPos.array, ac = this.aCol.array;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      q.vy -= q.grav * dt;
      const dk = Math.max(0, 1 - q.drag * dt);
      q.vx *= dk; q.vy *= dk; q.vz *= dk;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.onGround) {
        const gy = groundHeight(q.x, q.z);
        if (q.y < gy + 0.02) { q.onGround(q); continue; }
      }
      const t = q.life / q.max;
      const s = q.s0 + (q.s1 - q.s0) * t;
      let a = q.a * (1 - t);
      if (q.fadeIn) a *= Math.min(1, q.life / q.fadeIn);
      P[w++] = q;
      const o = (w - 1) * 4;
      ap[o] = q.x; ap[o + 1] = q.y; ap[o + 2] = q.z; ap[o + 3] = s;
      ac[o] = q.r; ac[o + 1] = q.g; ac[o + 2] = q.b; ac[o + 3] = a;
    }
    P.length = w;
    this.geo.instanceCount = w; this.mesh.visible = w > 0;   // (nothing burning or flying: no draw call, and nothing to upload)
    if (w) { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; }
  }
}

export class FX {
  constructor(scene, T, q) {
    this.scene = scene; this.T = T;
    this.add = new Particles(scene, 900, true);
    this.alpha = new Particles(scene, 1400, false);
    // blood decals
    const dm = new THREE.MeshStandardMaterial({ map: T.blood, transparent: true, depthWrite: false, roughness: 0.25, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), dm, 220);
    this.decals.count = 0; this.decals.frustumCulled = false; this.decals.receiveShadow = true; this.decals.renderOrder = 1;
    this.decalIdx = 0; this.decalAge = new Float32Array(220);
    this.decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(220 * 3).fill(1), 3);
    scene.add(this.decals);
    if (PAINTED) toonify(this.decals, { outline: 0 });
    this.fires = [];
    this.lights = [];
    this.level = q; this.applyQuality();
    this.buildFireflies(); this.buildLeaves();
    this.fireflyAmt = 0; this.leafAmt = 0;
    this.tmpN = new THREE.Vector3(); this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion();
  }
  // The lights the fires can use (the nearest fires get them). Every pixel of every lit surface pays for each light there is, burning or not,
  // so a lean level has one.
  applyQuality() {
    const want = this.level.fireLights;
    while (this.lights.length > want) this.scene.remove(this.lights.pop());
    while (this.lights.length < want) { const l = new THREE.PointLight(0xff8a3a, 0, 22, 1.6); l.castShadow = false; this.scene.add(l); this.lights.push(l); }
  }
  // --- blood ---
  // A hit, for all ages: a thump of pale dust with a few bits of leaf and fur flying off it, and a short ring of
  // "stars" the colour of straw. Nothing red and nothing left on the ground. (Still called blood: every strike in the
  // game comes through here.)
  blood(pos, dir, amount = 1, big = false) {
    const n = Math.floor(4 + 7 * Math.min(2, amount));
    for (let i = 0; i < n; i++) {
      const sp = 1.5 + Math.random() * 3 * (big ? 1.4 : 1);
      const dx = (dir ? dir.x : 0) * 0.6 + (Math.random() - 0.5) * 1.6, dy = 0.5 + Math.random() * 1.2, dz = (dir ? dir.z : 0) * 0.6 + (Math.random() - 0.5) * 1.6;
      const leaf = Math.random() < 0.5;
      this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dx * sp, vy: dy * sp, vz: dz * sp, life: 1.1, s0: 0.05 + Math.random() * 0.05, s1: 0.03, r: leaf ? 0.62 : 0.86, g: leaf ? 0.5 : 0.78, b: leaf ? 0.2 : 0.56, a: 0.95, grav: 6, drag: 1.4 });
    }
    for (let i = 0; i < 3 + 2 * Math.min(2, amount); i++) this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * 1.4, vy: 0.3 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 1.4, life: 0.9, s0: 0.2, s1: 0.9, r: 0.84, g: 0.76, b: 0.6, a: 0.4, drag: 2 });
  }
  // (marks on the ground were blood: there are none now)
  decal() {}
  pool(x, z, size) { this.decal(x, z, size); }
  // --- dust / splash ---
  dust(pos, amt = 1, col = [0.55, 0.45, 0.32]) {
    for (let i = 0; i < 6 * amt; i++) this.alpha.spawn({ x: pos.x + (Math.random() - 0.5) * 0.4, y: pos.y + 0.1, z: pos.z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 1.2, life: 1.4, s0: 0.25, s1: 1.1, r: col[0], g: col[1], b: col[2], a: 0.35, drag: 1.6 });
  }
  splash(pos, amt = 1) {
    for (let i = 0; i < 14 * amt; i++) this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.9, s0: 0.08, s1: 0.15, r: 0.8, g: 0.85, b: 0.85, a: 0.7, grav: 9.8 });
  }
  sparks(pos) {
    for (let i = 0; i < 18; i++) this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.6, s0: 0.04, s1: 0.01, r: 1, g: 0.6, b: 0.2, a: 1, grav: 6 });
  }
  bees(pos, n = 10) {
    for (let i = 0; i < n; i++) this.alpha.spawn({ x: pos.x + (Math.random() - 0.5) * 2, y: pos.y + (Math.random() - 0.5) * 2, z: pos.z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, vz: (Math.random() - 0.5) * 6, life: 0.7, s0: 0.03, r: 0.12, g: 0.1, b: 0.05, a: 1, drag: 3 });
  }
  // --- fire ---
  addFire(pos, size = 1, opts = {}) { const f = { pos: pos.clone(), size, t: 0, acc: 0, smoke: opts.smoke !== false, light: opts.light !== false, alive: true, attach: opts.attach || null }; this.fires.push(f); return f; }
  removeFire(f) { f.alive = false; }
  updateFires(dt, cam) {
    this.fires = this.fires.filter((f) => f.alive);
    const sorted = this.fires.filter((f) => f.light).sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i], f = sorted[i];
      if (f) { l.position.copy(f.pos); l.position.y += 0.5 * f.size; l.intensity = (14 + Math.sin(f.t * 23) * 2.5 + Math.sin(f.t * 37.3) * 2) * f.size * f.size; l.distance = 18 * f.size + 6; }
      else l.intensity = 0;
    }
    for (const f of this.fires) {
      if (f.attach) { f.attach.getWorldPosition(f.pos); }
      f.t += dt; f.acc += dt * (40 * f.size);
      const d2 = f.pos.distanceToSquared(cam);
      if (d2 > 140 * 140) continue;
      while (f.acc > 1) {
        f.acc -= 1;
        const s = f.size;
        this.add.spawn({ x: f.pos.x + (Math.random() - 0.5) * 0.35 * s, y: f.pos.y + 0.05, z: f.pos.z + (Math.random() - 0.5) * 0.35 * s, vx: (Math.random() - 0.5) * 0.3, vy: 0.9 + Math.random() * 1.1 * s, vz: (Math.random() - 0.5) * 0.3,
          life: 0.45 + Math.random() * 0.35, s0: 0.38 * s, s1: 0.06 * s, r: 1.0, g: 0.42 + Math.random() * 0.25, b: 0.1, a: 0.75, drag: 0.5 });
        if (Math.random() < 0.12) this.add.spawn({ x: f.pos.x, y: f.pos.y + 0.3 * s, z: f.pos.z, vx: (Math.random() - 0.5) * 0.8, vy: 1.5 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 0.8, life: 1.3, s0: 0.03, s1: 0.015, r: 1, g: 0.55, b: 0.15, a: 1, drag: 0.4 });
        if (f.smoke && Math.random() < 0.18) this.alpha.spawn({ x: f.pos.x, y: f.pos.y + 0.7 * s, z: f.pos.z, vx: G.uWind.value.x * 0.3, vy: 0.7 + Math.random() * 0.5, vz: G.uWind.value.y * 0.3, life: 4.5, s0: 0.35 * s, s1: 2.2 * s, r: 0.22, g: 0.21, b: 0.2, a: 0.32, fadeIn: 0.6, drag: 0.15 });
      }
    }
  }
  // --- fireflies ---
  buildFireflies() {
    const N = 240; this.ff = [];
    const pos = new Float32Array(N * 3), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.ff.push({ x: 0, y: -1e4, z: 0, vx: 0, vz: 0, vy: 0 }); ph[i] = Math.random() * 100; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this.ffU = { uT: { value: 0 }, uAmt: { value: 0 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.ffU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute float aPh; uniform float uT; varying float vB; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
        float b = pow(max(0.0, sin(uT * 1.7 + aPh)), 12.0); vB = b; gl_PointSize = (2.0 + 5.0 * b) * (60.0 / max(4.0, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAmt; varying float vB; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.0) * vB * uAmt; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 2.5, a); }` });
    this.ffMesh = new THREE.Points(g, m); this.ffMesh.frustumCulled = false; this.scene.add(this.ffMesh);
  }
  buildLeaves() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#a0713a'; x.beginPath(); x.ellipse(32, 32, 14, 26, 0, 0, 6.28); x.fill(); x.strokeStyle = '#6b4a24'; x.lineWidth = 2; x.beginPath(); x.moveTo(32, 6); x.lineTo(32, 60); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.lf = []; const N = 90;
    this.leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), N);
    this.leafMesh.frustumCulled = false; this.leafMesh.count = 0;
    for (let i = 0; i < N; i++) this.lf.push({ x: 0, y: -1e4, z: 0, ph: Math.random() * 10, s: 0.7 + Math.random() * 0.8 });
    this.scene.add(this.leafMesh);
    if (PAINTED) toonify(this.leafMesh, { outline: 0, rim: 0.3 });
  }
  updateAmbient(dt, cam, night, season, raining) {
    // fireflies: monsoon/post-monsoon nights
    const ffTarget = night * (season === 'post' ? 1 : season === 'monsoon' ? (raining ? 0.2 : 0.8) : season === 'summer' ? 0.25 : 0.05);
    this.fireflyAmt += (ffTarget - this.fireflyAmt) * Math.min(1, dt * 0.5);
    this.ffU.uT.value += dt; this.ffU.uAmt.value = this.fireflyAmt;
    this.ffMesh.visible = this.fireflyAmt > 0.02;
    if (this.fireflyAmt > 0.02) {
      const arr = this.ffMesh.geometry.attributes.position.array;
      for (let i = 0; i < this.ff.length; i++) {
        const f = this.ff[i];
        if (Math.abs(f.x - cam.x) > 35 || Math.abs(f.z - cam.z) > 35 || f.y < -1000) {
          f.x = cam.x + (Math.random() - 0.5) * 70; f.z = cam.z + (Math.random() - 0.5) * 70; f.y = groundHeight(f.x, f.z) + 0.3 + Math.random() * 2.5;
        }
        f.vx += (Math.random() - 0.5) * dt * 2; f.vz += (Math.random() - 0.5) * dt * 2; f.vy += (Math.random() - 0.5) * dt;
        f.vx *= 0.98; f.vz *= 0.98; f.vy *= 0.95;
        f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt;
        arr[i * 3] = f.x; arr[i * 3 + 1] = f.y; arr[i * 3 + 2] = f.z;
      }
      this.ffMesh.geometry.attributes.position.needsUpdate = true;
    }
    // falling leaves (dry seasons + wind)
    const lt = season === 'summer' ? 1 : season === 'winter' ? 0.55 : 0.08;
    this.leafAmt = lt * Math.min(1, 0.3 + G.uWindStrength.value);
    const n = Math.floor(this.lf.length * this.leafAmt);
    for (let i = 0; i < n; i++) {
      const L = this.lf[i];
      if (L.y < -1000 || Math.abs(L.x - cam.x) > 30 || Math.abs(L.z - cam.z) > 30 || L.y < groundHeight(L.x, L.z)) {
        L.x = cam.x + (Math.random() - 0.5) * 50; L.z = cam.z + (Math.random() - 0.5) * 50; L.y = groundHeight(L.x, L.z) + 6 + Math.random() * 12;
      }
      L.ph += dt * (2 + L.s);
      L.x += (G.uWind.value.x * G.uWindStrength.value * 1.5 + Math.sin(L.ph) * 0.6) * dt;
      L.z += (G.uWind.value.y * G.uWindStrength.value * 1.5 + Math.cos(L.ph * 0.7) * 0.6) * dt;
      L.y -= (0.6 + Math.sin(L.ph * 1.3) * 0.3) * dt;
      this.q.setFromEuler(new THREE.Euler(L.ph, L.ph * 0.7, Math.sin(L.ph) * 1.2));
      this.m4.compose(new THREE.Vector3(L.x, L.y, L.z), this.q, new THREE.Vector3(L.s, L.s, L.s));
      this.leafMesh.setMatrixAt(i, this.m4);
    }
    this.leafMesh.count = n; this.leafMesh.instanceMatrix.needsUpdate = true;
  }
  update(dt, cam, light) {
    this.alpha.u.uLightK.value = light;
    this.updateFires(dt, cam);
    this.add.update(dt); this.alpha.update(dt);
    // age decals: fresh red -> dried brown
    let ch = false;
    for (let i = 0; i < this.decals.count; i++) {
      if (this.decalAge[i] < 120) { this.decalAge[i] += dt; const k = Math.min(1, this.decalAge[i] / 120); this.decals.instanceColor.setXYZ(i, 1.4 - k * 0.8, 0.9 - k * 0.5, 0.9 - k * 0.55); ch = true; }
    }
    if (ch) this.decals.instanceColor.needsUpdate = true;
  }
}

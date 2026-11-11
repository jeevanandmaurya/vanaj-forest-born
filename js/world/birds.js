// Birds you can see, not just hear: ground flocks (spotted doves, common mynas, rose-ringed parakeets) that
// forage in the open, flush when a person or predator comes near and settle again further off; evening roost
// flights; and white-rumped vultures that gather and circle over a kill, an old sign of a tiger's meal.
import * as THREE from 'three';
import { G, patch } from '../core/shaderlib.js';
import { PAINTED } from '../core/palette.js';
import { toon, patchMore } from '../core/toon.js';
import { groundHeight } from './terrain.js';

const KINDS = {
  dove: { color: [0.62, 0.55, 0.5], size: 0.28, n: [5, 10] },
  myna: { color: [0.32, 0.22, 0.16], size: 0.25, n: [4, 8] },
  parakeet: { color: [0.32, 0.62, 0.18], size: 0.3, n: [6, 14] },
  vulture: { color: [0.22, 0.18, 0.15], size: 1.9, n: [5, 9] },
};

function birdGeometry() {
  // body + head + two wings; aWing marks wing vertices (±1 = tip side) for the flap
  const p = [], w = [], idx = [];
  const v = (x, y, z, ww) => { p.push(x, y, z); w.push(ww); return p.length / 3 - 1; };
  // body: a stretched diamond
  const b = [v(0, 0, 0.5, 0), v(0.12, 0, 0, 0), v(0, 0.1, 0, 0), v(-0.12, 0, 0, 0), v(0, -0.08, 0, 0), v(0, 0, -0.55, 0)];
  for (const [a, c] of [[1, 2], [2, 3], [3, 4], [4, 1]]) { idx.push(b[0], b[a], b[c]); idx.push(b[5], b[c], b[a]); }
  // wings
  for (const s of [1, -1]) {
    const r0 = v(0.1 * s, 0.03, 0.18, 0), r1 = v(0.1 * s, 0.03, -0.2, 0), t0 = v(0.95 * s, 0.05, 0.0, s), t1 = v(0.8 * s, 0.05, -0.32, s);
    if (s > 0) idx.push(r0, t0, r1, r1, t0, t1); else idx.push(r0, r1, t0, r1, t1, t0);
  }
  // tail
  const ta = v(0.1, 0, -0.5, 0), tb = v(-0.1, 0, -0.5, 0), tc = v(0, 0.01, -0.85, 0); idx.push(ta, tc, tb);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

export class Birds {
  constructor(scene, game) {
    this.g = game; this.scene = scene;
    this.max = 220;
    const geo = birdGeometry();
    this.phase = new Float32Array(this.max * 2); // phase, flap amount
    geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(this.phase, 2));
    const mat = PAINTED ? toon({ side: THREE.DoubleSide, rim: 0.3, key: 'birds' }) : new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
    patchMore(mat, PAINTED ? 'birds-p' : 'birds', (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute float aWing; attribute vec2 aFlap; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fl = sin(uTime * 14.0 + aFlap.x * 6.2831) * aFlap.y;
          float glide = 1.0 - aFlap.y;
          transformed.y += abs(aWing) * (fl * 0.55 + glide * 0.04);
          transformed.x *= 1.0 - abs(aWing) * abs(fl) * 0.25;`);
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.flocks = []; this.carcasses = []; this.spawnT = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }
  addCarcass(pos) { this.carcasses.push({ pos: pos.clone(), t: 0, birds: null }); if (this.carcasses.length > 4) this.carcasses.shift(); }
  spawnFlock(kind, center) {
    const K = KINDS[kind], n = K.n[0] + Math.floor(Math.random() * (K.n[1] - K.n[0] + 1));
    const birds = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 4;
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r); p.y = groundHeight(p.x, p.z);
      birds.push({ p, v: new THREE.Vector3(), yaw: Math.random() * 6.28, hop: Math.random(), ph: Math.random(), flap: 0, delay: Math.random() * 0.4 });
    }
    const f = { kind, K, birds, state: 'ground', t: 0, home: center.clone(), dest: null };
    this.flocks.push(f); return f;
  }
  // every flock on the ground within r of a point goes up (a hunter is moving there)
  scare(at, r) { for (const f of this.flocks) if (f.home && !f.air && f.kind !== 'vulture' && (f.home.x - at.x) ** 2 + (f.home.z - at.z) ** 2 < r * r) this.flush(f, at); }
  flush(f, from) {
    if (f.state !== 'ground') return;
    f.state = 'fly'; f.t = 0;
    const away = new THREE.Vector3().subVectors(f.home, from).setY(0).normalize();
    const a = (Math.random() - 0.5) * 1.2, d = 45 + Math.random() * 50;
    f.dest = new THREE.Vector3(f.home.x + (away.x * Math.cos(a) - away.z * Math.sin(a)) * d, 0, f.home.z + (away.z * Math.cos(a) + away.x * Math.sin(a)) * d);
    f.dest.y = groundHeight(f.dest.x, f.dest.z);
    const au = this.g.audio; if (au && au.ready && f.home.distanceTo(this.g.player.pos) < 60) try { const o = au.spatial(f.home, 0.5), t = au.ctx.currentTime; for (let i = 0; i < 6; i++) au.noiseBurst(o, t + i * 0.035 + Math.random() * 0.03, { f: 900 + Math.random() * 600, q: 0.7, dur: 0.06, g: 0.5, color: 'pink' }); } catch (e) { }
  }
  update(dt) {
    const g = this.g, P = g.player.pos, hour = g.time.hour, day = g.sky.day;
    // populate the open ground near the player by day
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 6;
      this.flocks = this.flocks.filter((f) => f.kind === 'vulture' || f.home.distanceTo(P) < 220);
      const ground = this.flocks.filter((f) => f.kind !== 'vulture').length;
      if (day > 0.4 && ground < 4) {
        const a = Math.random() * 6.28, r = 50 + Math.random() * 110;
        const c = new THREE.Vector3(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r);
        const kinds = ['dove', 'myna', 'parakeet'];
        this.spawnFlock(kinds[(Math.random() * 3) | 0], c);
      }
    }
    // kills draw vultures after a while; they circle, then drop to the ground round the carcass
    for (const c of this.carcasses) {
      c.t += dt;
      if (!c.birds && c.t > 25 && day > 0.3) { c.birds = this.spawnFlock('vulture', c.pos); c.birds.state = 'circle'; c.birds.home.copy(c.pos); for (const b of c.birds.birds) { b.p.set(c.pos.x + (Math.random() - 0.5) * 200, c.pos.y + 90, c.pos.z + (Math.random() - 0.5) * 200); b.ph = Math.random() * 6.28; } }
      if (c.birds && c.t > 140 && c.birds.state === 'circle') c.birds.state = 'land';
    }
    // threats: player and nearby predators flush ground flocks
    const threats = [P]; for (const a of g.eco.animals) if (!a.dead && (a.d.kind === 'predator' || a.d.kind === 'pack') && a.dist2(P) < 200 * 200) threats.push(a.pos);
    let n = 0;
    const col = this.mesh.instanceColor.array, mats = this.mesh.instanceMatrix.array;
    const roost = hour > 17.8 && hour < 18.9;
    for (const f of this.flocks) {
      f.t += dt;
      if (f.state === 'ground') {
        for (const th of threats) { const d = Math.hypot(th.x - f.home.x, th.z - f.home.z); if (d < (th === P ? (g.player.crouch ? 7 : 15) : 22)) { this.flush(f, th); break; } }
        if (roost && f.kind !== 'vulture') { this.flush(f, f.home.clone().add(new THREE.Vector3(1, 0, 0))); f.dest.y += 25; f.leaving = true; }
      }
      for (const b of f.birds) {
        if (n >= this.max) break;
        let flap = 0, pitch = 0, bank = 0;
        if (f.state === 'ground') {
          b.hop -= dt; if (b.hop < 0) { b.hop = 0.6 + Math.random() * 1.8; b.yaw += (Math.random() - 0.5) * 2; b.v.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)).multiplyScalar(0.25); }
          b.p.addScaledVector(b.v, dt); b.v.multiplyScalar(Math.max(0, 1 - dt * 6));
          if (b.p.distanceTo(f.home) > 5) b.yaw = Math.atan2(f.home.x - b.p.x, f.home.z - b.p.z);
          b.p.y = groundHeight(b.p.x, b.p.z) + 0.03 + Math.max(0, Math.sin(b.hop * 9)) * 0.04;
          pitch = Math.sin(f.t * 5 + b.ph * 7) > 0.6 ? 0.5 : 0;   // pecking
        } else if (f.state === 'fly') {
          if (f.t < b.delay) { b.p.y = groundHeight(b.p.x, b.p.z) + 0.03; }
          else {
            const to = f.dest, dx = to.x - b.p.x, dz = to.z - b.p.z, dist = Math.hypot(dx, dz);
            const want = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(f.kind === 'parakeet' ? 13 : 9);
            const arc = Math.min(1, dist / 30) * 7 + (f.leaving ? 20 : 0);
            want.y = ((to.y + arc + (b.ph - 0.5) * 3) - b.p.y) * 1.8;
            b.v.lerp(want, Math.min(1, dt * 3)); b.p.addScaledVector(b.v, dt);
            b.yaw = Math.atan2(b.v.x, b.v.z); pitch = -Math.atan2(b.v.y, Math.hypot(b.v.x, b.v.z)) * 0.6; flap = 1;
            if (dist < 2 && !f.leaving) { f.state = 'ground'; f.home.copy(to); f.t = 0; for (const bb of f.birds) bb.v.set(0, 0, 0); }
          }
        } else if (f.state === 'circle' || f.state === 'land') {
          // vultures: wide thermal circles, wings held flat, slow descent; then glide down to the carcass
          b.ph += dt * (0.18 + (b.delay * 0.1));
          const R = 22 + b.delay * 30, alt = f.state === 'land' ? Math.max(0, 40 - f.t * 0.6) : 40 + b.delay * 35;
          const tx = f.home.x + Math.cos(b.ph) * R, tz = f.home.z + Math.sin(b.ph) * R;
          const ty = groundHeight(f.home.x, f.home.z) + alt + (f.state === 'land' ? 0.4 : 0);
          b.p.x += (tx - b.p.x) * Math.min(1, dt * 0.5); b.p.z += (tz - b.p.z) * Math.min(1, dt * 0.5); b.p.y += (ty - b.p.y) * Math.min(1, dt * 0.3);
          b.yaw = b.ph + Math.PI; bank = -0.35; flap = alt < 3 ? 0.3 : 0.05;
        }
        b.flap += (flap - b.flap) * Math.min(1, dt * 5);
        if (f.leaving && f.t > 25) continue;
        this._e.set(pitch, b.yaw, bank, 'YXZ'); this._q.setFromEuler(this._e);
        const sz = f.K.size * (0.85 + b.delay * 0.4);
        this._m.compose(b.p, this._q, this._s.set(sz, sz, sz));
        this._m.toArray(mats, n * 16);
        const k = f.K.color, var_ = 0.85 + b.ph * 0.3; col[n * 3] = k[0] * var_; col[n * 3 + 1] = k[1] * var_; col[n * 3 + 2] = k[2] * var_;
        this.phase[n * 2] = b.ph; this.phase[n * 2 + 1] = b.flap;
        n++;
      }
    }
    this.flocks = this.flocks.filter((f) => !(f.leaving && f.t > 25));
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.mesh.geometry.attributes.aFlap.needsUpdate = true;
  }
}

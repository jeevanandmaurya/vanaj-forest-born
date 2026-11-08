// Soft ropes: the banyan's aerial roots and the lianas near Vanaj, as Verlet chains (Jakobsen's method: positions and
// previous positions, gravity, then several rounds of distance constraints). A root is pinned at the limb above and in
// the ground below, with a little slack, so it sways and bows; a liana hangs free from its limb, its tail dragging
// behind a swing. Both hang from a soft limb (js/world/neartree.js), so they ride its movement; Vanaj's body pushes them
// aside as he walks through, his hands pin them, and his weight pulls them out of true. Drawn as one tube mesh,
// rebuilt each frame for the ropes in range.
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';
import { groundHeight } from './terrain.js';
import { toon } from '../core/toon.js';
import { PAINTED } from '../core/palette.js';
import { BARK_COL, vineParts } from './flora.js';

const MAX_ROPES = 44, MAX_NODES = 14, SUB = 2, RAD = 6, RINGS = (MAX_NODES - 1) * SUB + 1;
const MAX_VERTS = MAX_ROPES * RINGS * (RAD + 1), ITER = 8;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _bn = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion();
const ROOT_C = new THREE.Color(BARK_COL.banyan || '#8a8070').multiplyScalar(0.8), VINE_C = new THREE.Color('#5e6a36');

class Rope {
  constructor(V, T) {
    this.V = V; this.T = T; this.fixed = !!V.fixed;
    const end = this.fixed ? V.b : _a.copy(V.a).add(_b.set(0, -V.len, 0));
    this.N = Math.max(5, Math.min(MAX_NODES, Math.round(V.len / 1.1) + 1));
    const n = this.N; this.x = new Float32Array(n * 3); this.o = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const t = i / (n - 1); for (let c = 0; c < 3; c++) { const v = V.a.getComponent(c) + (end.getComponent(c) - V.a.getComponent(c)) * t; this.x[i * 3 + c] = this.o[i * 3 + c] = v; } }
    // roots have a little slack to bow with
    this.L0 = V.len / (n - 1) * (this.fixed ? 1.0025 : 1);
    this.r0 = this.fixed ? (V.r || 0.08) * 0.8 : 0.03; this.r1 = this.fixed ? (V.r || 0.08) * 1.5 : 0.045;
    this.col = this.fixed ? ROOT_C : VINE_C;
    this.off = new THREE.Vector3(); this.ph = (V.a.x * 3.1 + V.a.z * 1.7) % 6.283;
    this.limbT = null;
  }
}

export class Ropes {
  constructor(game) {
    this.g = game; this.active = new Map(); this.t = 0;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_VERTS * 3); this.nor = new Float32Array(MAX_VERTS * 3); this.col = new Float32Array(MAX_VERTS * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(MAX_ROPES * (RINGS - 1) * RAD * 6); g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage)); this.idx = idx;
    const mat = PAINTED ? toon({ color: 0xffffff, vertexColors: true, rim: 0.4, key: 'rope' }) : new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95 });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true; game.scene.add(this.mesh);
    const parts = vineParts();
    this.leaves = new THREE.InstancedMesh(parts.leafNode, parts.leaf, 240); this.leaves.count = 0; this.leaves.frustumCulled = false; this.leaves.castShadow = false; this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage); game.scene.add(this.leaves);
  }
  of(V) { return this.active.get(V) || null; }
  // a point s metres down the rope from its top
  sample(V, s, out) {
    const R = this.active.get(V); if (!R) return null;
    const f = Math.max(0, Math.min(R.N - 1.0001, s / R.L0)), i = Math.floor(f), t = f - i, x = R.x, k = i * 3;
    return out.set(x[k] + (x[k + 3] - x[k]) * t, x[k + 1] + (x[k + 4] - x[k + 1]) * t, x[k + 2] + (x[k + 5] - x[k + 2]) * t);
  }
  // pull the rope at s with this acceleration (his weight on a root)
  pull(V, s, ax, ay, az, dt) {
    const R = this.active.get(V); if (!R) return;
    const f = s / R.L0, i0 = Math.max(1, Math.floor(f) - 1), i1 = Math.min(R.N - (R.fixed ? 2 : 1), Math.ceil(f) + 1), h = dt * dt;
    for (let i = i0; i <= i1; i++) { const w = Math.max(0, 1 - Math.abs(i - f) / 2) * h, k = i * 3; R.x[k] += ax * w; R.x[k + 1] += ay * w; R.x[k + 2] += az * w; }
  }
  list(focus) {
    const g = this.g, near = g.near, keep = new Set(), cand = [];
    for (const T of g.veg.climbNear(focus.x, focus.z, 40)) {
      if (!T.vines || !T.vines.length) continue;
      const nearSlot = near && near.slotOf(T);
      for (const V of T.vines) {
        if (V.fixed && !nearSlot) continue;   // a root is part of the instanced tree's mesh until the tree goes near
        const d = Math.hypot(V.a.x - focus.x, V.a.z - focus.z); if (d < 34) cand.push([d, V, T]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < cand.length && keep.size < MAX_ROPES; i++) {
      const [, V, T] = cand[i]; keep.add(V);
      if (!this.active.has(V)) { this.active.set(V, new Rope(V, T)); V.active = true; }
    }
    for (const [V, R] of this.active) if (!keep.has(V) && !V.held) { this.active.delete(V); V.active = false; }
  }
  update(dt, focus) {
    if (--this.t <= 0) { this.t = 15; this.list(focus); }
    const h = Math.min(1 / 30, Math.max(1 / 240, dt || 1 / 60)), g = this.g, P = g.player, near = g.near;
    const windX = G.uWind.value.x, windZ = G.uWind.value.y, st = G.uWindStrength.value, time = G.uTime.value;
    // Vanaj's body, as a segment: ropes are pushed clear of it
    const px = P.pos.x, py = P.pos.y, pz = P.pos.z, PR = 0.3;
    for (const R of this.active.values()) {
      const n = R.N, x = R.x, o = R.o, V = R.V;
      // a root takes up a little slack under his weight, enough to swing out on when he throws his weight about
      if (R.fixed) { const want = V.len / (n - 1) * (V.grabbed ? 1.016 : 1.0025); R.L0 += (want - R.L0) * Math.min(1, h * 2.5); }
      // the top rides on the soft limb
      R.off.set(0, 0, 0);
      const S = near && V.limb ? near.softOf(R.T) : null;
      if (S) { if (R.limbT === null) R.limbT = limbFrac(V.limb, V.a); S.dispAt(S.simOf(V.limb.bi), R.limbT, R.off); }
      const ax = V.a.x + R.off.x, ay = V.a.y + R.off.y, az = V.a.z + R.off.z;
      const gust = (0.5 + 0.5 * Math.sin(time * 0.33 + R.ph)) * st;
      const wf = (R.fixed ? 0.25 : 1.5) * gust * (0.6 + 0.4 * Math.sin(time * 1.3 + R.ph * 2));
      for (let i = 1; i < n; i++) {
        if (R.fixed && i === n - 1) continue;
        const dmp = V.held && i * R.L0 > (V.holdS ?? 0) ? 0.93 : 0.985, k = i * 3, vx = (x[k] - o[k]) * dmp, vy = (x[k + 1] - o[k + 1]) * dmp, vz = (x[k + 2] - o[k + 2]) * dmp;   // (the tail below his hands trails, it doesn't whip)
        o[k] = x[k]; o[k + 1] = x[k + 1]; o[k + 2] = x[k + 2];
        x[k] += vx + windX * wf * h * h * 10; x[k + 1] += vy - 9.8 * h * h; x[k + 2] += vz + windZ * wf * h * h * 10;
      }
      const hold = V.held && V.hand ? Math.max(1, Math.min(n - 1, Math.round((V.holdS ?? V.len) / R.L0))) : -1;
      for (let it = 0; it < ITER; it++) {
        x[0] = ax; x[1] = ay; x[2] = az;
        if (R.fixed) { const e = (n - 1) * 3; x[e] = V.b.x; x[e + 1] = V.b.y; x[e + 2] = V.b.z; }
        if (hold > 0) { const k = hold * 3; x[k] = V.hand.x; x[k + 1] = V.hand.y; x[k + 2] = V.hand.z; }
        for (let i = 0; i < n - 1; i++) {
          const a = i * 3, b = a + 3, dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
          const e = (d - (hold > 0 && i < hold ? V.holdS / hold : R.L0)) / d, pa = i === 0 ? 0 : 0.5, pb = (R.fixed && i === n - 2) ? 0 : (i === 0 ? 1 : 0.5);
          x[a] += dx * e * pa; x[a + 1] += dy * e * pa; x[a + 2] += dz * e * pa;
          x[b] -= dx * e * pb; x[b + 1] -= dy * e * pb; x[b + 2] -= dz * e * pb;
        }
        // a root's woody stiffness: nodes two apart resist folding
        if (R.fixed) for (let i = 1; i < n - 2; i++) {
          const a = (i - 1) * 3, b = (i + 1) * 3, dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4, want = R.L0 * 1.97;
          if (d < want) { const e = (d - want) / d * 0.12; x[a] += i > 1 ? dx * e : 0; x[a + 1] += i > 1 ? dy * e : 0; x[a + 2] += i > 1 ? dz * e : 0; x[b] -= dx * e; x[b + 1] -= dy * e; x[b + 2] -= dz * e; }
        }
      }
      // his body pushes it aside (not the node in his hands)
      if (Math.abs(V.a.x - px) < 12 && Math.abs(V.a.z - pz) < 12) for (let i = 1; i < n; i++) {
        if (i === hold || (R.fixed && i === n - 1)) continue;
        const k = i * 3, ty = Math.max(py + 0.2, Math.min(py + 1.4, x[k + 1]));
        const dx = x[k] - px, dy = x[k + 1] - ty, dz = x[k + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < PR * PR && d2 > 1e-6 && !(P.canopy.mode === 'rope' && P.canopy.rope === V)) { const d = Math.sqrt(d2), e = (PR - d) / d; x[k] += dx * e; x[k + 1] += dy * e; x[k + 2] += dz * e; }
      }
      // the free end of a liana lies on the ground rather than through it
      if (!R.fixed) { const k = (n - 1) * 3, gy = groundHeight(x[k], x[k + 2]) + 0.04; if (x[k + 1] < gy) x[k + 1] = gy; }
    }
    this.draw();
  }
  draw() {
    const { pos, nor, col, idx } = this; let v = 0, ii = 0, lf = 0, m = 0;
    const leaves = this.leaves;
    for (const R of this.active.values()) {
      if (m >= MAX_ROPES) break; m++;
      const n = R.N, x = R.x, rows = (n - 1) * SUB + 1, base = v, C = R.col;
      let nx = 1, ny = 0, nz = 0;
      for (let r = 0; r < rows; r++) {
        const f = r / SUB, i = Math.min(n - 2, Math.floor(f)), t = f - i;
        // Catmull-Rom between the nodes
        const i0 = Math.max(0, i - 1) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = Math.min(n - 1, i + 2) * 3, t2 = t * t, t3 = t2 * t;
        let px, py, pz, tx, ty, tz;
        { const c = (k) => 0.5 * (2 * x[i1 + k] + (x[i2 + k] - x[i0 + k]) * t + (2 * x[i0 + k] - 5 * x[i1 + k] + 4 * x[i2 + k] - x[i3 + k]) * t2 + (3 * x[i1 + k] - x[i0 + k] - 3 * x[i2 + k] + x[i3 + k]) * t3);
          const d = (k) => (x[i2 + k] - x[i0 + k]) + 2 * (2 * x[i0 + k] - 5 * x[i1 + k] + 4 * x[i2 + k] - x[i3 + k]) * t + 3 * (3 * x[i1 + k] - x[i0 + k] - 3 * x[i2 + k] + x[i3 + k]) * t2;
          px = c(0); py = c(1); pz = c(2); tx = d(0); ty = d(1); tz = d(2); }
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        // carry a normal down the rope
        const dot = nx * tx + ny * ty + nz * tz; nx -= tx * dot; ny -= ty * dot; nz -= tz * dot; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        const k = r / (rows - 1), rad = R.r0 + (R.r1 - R.r0) * (R.fixed ? k * k : k * 0.2) + (R.fixed ? 0.012 * Math.sin(r * 1.9 + R.ph) : 0);
        const tone = 0.86 + 0.18 * Math.sin(r * 2.3 + R.ph);
        for (let j = 0; j <= RAD; j++) {
          const a = j / RAD * 6.2832, ca = Math.cos(a), sa = Math.sin(a), ox = nx * ca + bx * sa, oy = ny * ca + by * sa, oz = nz * ca + bz * sa, w = v * 3;
          pos[w] = px + ox * rad; pos[w + 1] = py + oy * rad; pos[w + 2] = pz + oz * rad; nor[w] = ox; nor[w + 1] = oy; nor[w + 2] = oz;
          const sh = tone * (0.92 + 0.08 * ca);
          col[w] = C.r * sh; col[w + 1] = C.g * sh; col[w + 2] = C.b * sh; v++;
        }
      }
      for (let r = 0; r < rows - 1; r++) for (let j = 0; j < RAD; j++) { const a = base + r * (RAD + 1) + j, b = a + 1, c = a + RAD + 1, d = c + 1; idx[ii++] = a; idx[ii++] = c; idx[ii++] = b; idx[ii++] = b; idx[ii++] = c; idx[ii++] = d; }
      // leaves in tufts along a liana
      if (!R.fixed) for (let i = 1; i < n; i += 1) {
        if (lf >= 240) break;
        const k = i * 3; _p.set(x[k], x[k + 1], x[k + 2]); _m.compose(_p, _q.identity(), _s); leaves.setMatrixAt(lf++, _m);
      }
    }
    leaves.count = lf; leaves.instanceMatrix.needsUpdate = true;
    this.geo.index.needsUpdate = true; for (const a of ['position', 'normal', 'color']) this.geo.attributes[a].needsUpdate = true;
    this.geo.setDrawRange(0, ii);
  }
}
function limbFrac(L, p) {
  let tot = 0, best = 0, bd = Infinity, s = 0;
  for (let i = 1; i < L.pts.length; i++) tot += L.pts[i].distanceTo(L.pts[i - 1]);
  for (let i = 0; i < L.pts.length; i++) { const d = L.pts[i].distanceToSquared(p); if (d < bd) { bd = d; best = s; } if (i < L.pts.length - 1) s += L.pts[i].distanceTo(L.pts[i + 1]); }
  return best / Math.max(1e-3, tot);
}

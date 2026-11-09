// Cutting trees down. With the stone axe in hand, a strike at a trunk bites a chip out of it; enough of them, more for a thicker
// tree, and it goes over, away from him, turning about its foot under its own weight. It lies where it falls, a real thing he can
// walk round or be caught under, until he cuts it up for firewood, sticks and leaves. A stump stays, for good (it is in the save).
// The tree itself leaves the forest's own lists (Vegetation.cutTree), so nothing grows back on loading or walking away and returning.
import * as THREE from 'three';
import { groundHeight } from './terrain.js';
import { PAINTED } from '../core/palette.js';
import { toon } from '../core/toon.js';
import { clamp } from '../core/noise.js';

const MAX_R = 0.75, MAX_FALLEN = 3;
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _b = new THREE.Matrix4(), _a = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export class Felling {
  constructor(game) {
    this.g = game; this.hits = new Map(); this.fallen = []; this.stumps = [];
    const geo = new THREE.CylinderGeometry(0.86, 1.12, 1, 12, 1); geo.translate(0, 0.5, 0);
    const n = geo.attributes.normal, cols = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) { const top = n.getY(i) > 0.7, c = top ? [0.86, 0.68, 0.44] : [0.36, 0.26, 0.18]; cols.set(c, i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = PAINTED ? toon({ vertexColors: true, rim: 0.2, key: 'cutwood' }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geo, mat, 256); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    // (one out of sight until the shaders have been built, so the first stump does not stall a frame)
    this.mesh.count = 1; this.mesh.setMatrixAt(0, _m.makeTranslation(0, -500, 0)); game.scene.add(this.mesh);
  }
  ready() { this.writeStumps(); }
  writeStumps() {
    const M = this.mesh; M.count = this.stumps.length; M.visible = M.count > 0;
    this.stumps.forEach((s, i) => { _q.identity(); M.setMatrixAt(i, _m.compose(_p.set(s.x, s.y - 0.08, s.z), _q, _s.set(s.r, 0.42 + s.r * 0.25, s.r))); });
    M.instanceMatrix.needsUpdate = true;
  }
  addStump(x, y, z, r, key) {
    const s = { x, y, z, r, key }; this.stumps.push(s); if (this.stumps.length > 256) this.stumps.shift();
    const ph = this.g.phys; if (ph) s.col = ph.capsule(_a.set(x, y + 0.1, z), _c.set(x, y + 0.42, z), r * 0.8);
    this.writeStumps();
  }
  // the trunk he is facing, within a swing
  target() {
    const P = this.g.player, p = P.pos, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bs = Infinity;
    for (const T of this.g.veg.climbNear(p.x, p.z, 4)) {
      if (!T.trunk || T.trunk.r[0] < 0.05) continue;
      const a = T.trunk.pts[0], dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz), gap = d - T.trunk.r[0];
      if (gap > 1.25 || Math.abs(a.y - p.y) > 2.5) continue;
      const score = gap - (dx * fx + dz * fz) / Math.max(d, 1e-3) * 0.6;
      if (score < bs && (dx * fx + dz * fz) / Math.max(d, 1e-3) > -0.1) { bs = score; best = T; }
    }
    return best;
  }
  promptFor() {
    const P = this.g.player;
    if (P.weapon !== 'axe' || P.canopy.mode || !P.onGround) return '';
    const T = this.target(); if (!T) return '';
    return T.trunk.r[0] > MAX_R ? 'This tree is too big for a stone axe' : 'Strike to cut this tree down';
  }
  // one blow. True if there was a tree to hit.
  chop() {
    const g = this.g, P = g.player, T = this.target(); if (!T) return false;
    const a = T.trunk.pts[0], r = T.trunk.r[0], d = Math.hypot(a.x - P.pos.x, a.z - P.pos.z) || 1, ux = (a.x - P.pos.x) / d, uz = (a.z - P.pos.z) / d;
    const at = _a.set(a.x - ux * r, a.y + 0.95, a.z - uz * r);
    g.audio.impact('wood', at, 1.1); P.shake = Math.max(P.shake, 0.14); P.noise = 30;
    if (r > MAX_R) { g.ui.toast('Too big for a stone axe'); return true; }
    g.fx.dust(at, 1, [0.82, 0.64, 0.42]);
    const need = Math.ceil(3 + r * 16), n = (this.hits.get(T.key) || 0) + 1; this.hits.set(T.key, n);
    // the whole tree shivers with each blow
    { const S = g.near && g.near.softOf(T); if (S) S.kick(S.simOf(T.trunk.bi), ux * 0.5, 0, uz * 0.5); }
    if (n >= need) { this.hits.delete(T.key); this.fell(T, ux, uz); }
    return true;
  }
  fell(T, dx, dz) {
    const g = this.g, key = T.key, a = T.trunk.pts[0], r = T.trunk.r[0];
    // out of the forest's lists, and in its place a copy of itself that can move
    if (g.near) g.near.forget(key);
    g.veg.cutTree(T);
    g.player.canopy.scanT = 0; if (g.phys) g.phys.syncT = 0;
    this.addStump(a.x, groundHeight(a.x, a.z), a.z, r, key);
    const parts = g.veg.makeFalling(T), H = Math.max(3, T.top - a.y);
    // anything sitting in it comes down in a hurry
    for (const an of g.eco.animals) if (an.tree && an.tree.key === key) { an.tree = null; an.limb = null; an.tm = null; an.perch = null; an.hop = null; an.pos.y = groundHeight(an.pos.x, an.pos.z); an.threat = a.clone(); an.setState('flee', 6); }
    this.fallen.push({ T, parts, H, r, base: a.clone(), dir: new THREE.Vector3(dx, 0, dz), axis: new THREE.Vector3(dz, 0, -dx), th: 0.015, w: 0.02, down: false, col: null, base0: parts.map((m) => m.instanceMatrix.array.slice(0, 16)) });
    g.audio.impact('wood', a, 1.8);
    if (this.fallen.length > MAX_FALLEN) this.clear(this.fallen[0], true);
    g.emit('treeFalling', { tree: T });
  }
  clear(F, puff) {
    const g = this.g;
    for (const m of F.parts) { g.scene.remove(m); m.dispose(); }
    if (F.col && g.phys) g.phys.world.removeCollider(F.col, false);
    if (puff) g.fx.dust(_a.copy(F.base).addScaledVector(F.dir, F.H * 0.3), 3, [0.55, 0.45, 0.3]);
    this.fallen.splice(this.fallen.indexOf(F), 1);
  }
  update(dt) {
    for (const F of this.fallen) {
      if (F.settled) continue;
      // a rod turning about its foot, under its own weight
      F.w += (14 / F.H) * Math.sin(Math.max(F.th, 0.02)) * dt;
      F.th += F.w * dt;
      // how far it can go before it meets the ground: to the height of the ground where its crown comes down
      const lie = Math.PI / 2 - Math.atan2(F.base.y + 0.3 - groundHeight(F.base.x + F.dir.x * F.H * 0.7, F.base.z + F.dir.z * F.H * 0.7), F.H * 0.7);
      if (F.th >= lie) {
        F.th = lie;
        if (!F.down) this.landed(F);
        F.w = -F.w * 0.16;
        if (Math.abs(F.w) < 0.12) { F.w = 0; F.settled = true; }
      }
      _r.makeRotationAxis(F.axis, F.th); _t.makeTranslation(F.base.x, F.base.y + 0.3, F.base.z); _m.multiplyMatrices(_t, _r); _t.makeTranslation(-F.base.x, -(F.base.y + 0.3), -F.base.z); _m.multiply(_t);
      F.parts.forEach((p, i) => { _b.fromArray(F.base0[i]); p.setMatrixAt(0, _r.multiplyMatrices(_m, _b)); p.instanceMatrix.needsUpdate = true; });
    }
  }
  landed(F) {
    const g = this.g, P = g.player;
    F.down = true;
    g.audio.impact('wood', _a.copy(F.base).addScaledVector(F.dir, F.H * 0.5), 2.4);
    const dist = P.pos.distanceTo(F.base); P.shake = Math.max(P.shake, clamp(0.9 - dist / 40, 0, 0.9));
    for (let k = 1; k <= 4; k++) { const f = k / 4 * 0.85; _a.copy(F.base).addScaledVector(F.dir, F.H * f); _a.y = groundHeight(_a.x, _a.z) + 0.3; g.fx.dust(_a, 2.5, k < 3 ? [0.55, 0.45, 0.3] : [0.42, 0.5, 0.24]); }
    // caught under it
    { const o = _c.subVectors(P.pos, F.base), along = o.x * F.dir.x + o.z * F.dir.z, lat = Math.abs(o.x * F.dir.z - o.z * F.dir.x);
      if (along > 0.4 && along < F.H && lat < 0.9 + (along / F.H) * 1.6 && !P.canopy.mode) { P.hurt(30, F.base, { kind: 'fall', knock: 3 }); g.ui.toast('It came down on you'); } }
    // the trunk lies there as something solid
    if (g.phys) { const A = _a.copy(F.base), L = Math.min(F.H * 0.75, 9), B = _c.copy(F.base).addScaledVector(F.dir, L); A.y = groundHeight(A.x, A.z) + F.r * 0.8; B.y = groundHeight(B.x, B.z) + F.r * 0.6; F.col = g.phys.capsule(A, B, Math.max(0.08, F.r * 0.7)); }
    g.emit('treeCut', { tree: F.T });
  }
  // a fallen tree within reach, to cut up
  fallenNear(p) {
    for (const F of this.fallen) {
      if (!F.settled) continue;
      const o = _c.subVectors(p, F.base), along = clamp(o.x * F.dir.x + o.z * F.dir.z, 0, Math.min(F.H * 0.7, 9));
      if (Math.hypot(o.x - F.dir.x * along, o.z - F.dir.z * along) < 1.9) return F;
    }
    return null;
  }
  cutUp(F) {
    const g = this.g, P = g.player;
    if (!g.inv.has('axe')) { g.ui.toast('You need the axe'); return; }
    if (P.weapon !== 'axe') P.equip('axe');
    P.action = { type: 'attack', anim: 'swing', t: 0, dur: 2.2, weapon: 'axe' };
    for (let i = 0; i < 4; i++) setTimeout(() => { g.audio.impact('wood', P.pos, 0.9); g.fx.dust(_a.copy(P.pos).setY(P.pos.y + 0.4), 1, [0.82, 0.64, 0.42]); }, 250 + i * 480);
    setTimeout(() => {
      if (!this.fallen.includes(F)) return;
      this.clear(F, true);
      const n = Math.max(1, Math.ceil(F.r * 7));
      g.inv.add('log', n); g.inv.add('stick', 3); g.inv.add('leaves', 2); g.inv.add('fiber', 1);
      g.ui.toast(`+${n} Firewood, +3 Sticks, +2 Leaves, +1 Fibre`); g.emit('pickup', { item: 'log' });
    }, 2100);
  }
  toJSON() { return { cut: [...(this.g.veg.cut || [])], stumps: this.stumps.map((s) => [s.x, s.y, s.z, s.r, s.key]) }; }
  load(o) {
    this.reset(false);
    if (!o) return;
    const had = this.g.veg.cut; if ((o.cut && o.cut.length) || (had && had.size)) this.g.veg.markCut(o.cut || []);
    for (const s of o.stumps || []) this.addStump(s[0], s[1], s[2], s[3], s[4]);
  }
  reset(refill = true) {
    const g = this.g;
    while (this.fallen.length) this.clear(this.fallen[0], false);
    for (const s of this.stumps) if (s.col && g.phys) g.phys.world.removeCollider(s.col, false);
    this.stumps = []; this.hits.clear(); this.writeStumps();
    if (refill && g.veg.cut && g.veg.cut.size) g.veg.markCut([]);
  }
}

// Vanaj in the trees: free climbing on trunks, walking out along limbs, hanging and swinging from branches and
// lianas, and leaping between them.
//
// Swinging follows how Gibbon: Beyond the Trees built brachiation (Eddy Boxerman, "Physics-based animation in
// Gibbon", Game Developer 2022): the body is a point hanging from the hand like a pendulum. A grab keeps the
// velocity across the arm and loses only the part along it, so a catch with the arm square to the motion carries
// all the speed on; release flies ballistically to the next hold. Controls follow vine-swinging games: hold to
// grab, release to let go (one button), so the same scheme works on a touch screen.
//
//   on the ground   Space jumps; Space facing a trunk starts climbing it
//   in the air      hold Space to catch any branch, liana or trunk within reach
//   hanging         W pumps the swing (toward where the camera looks), release Space to let go and fly,
//                   E pulls up onto a thick branch, C drops
//   on a trunk      W/S climb, A/D go round, Space leaps off backward, W at a limb's base steps out onto it
//   on a limb       W/S walk along it, Space leaps, C lowers you to hang from it
import * as THREE from 'three';
import { groundHeight } from '../world/terrain.js';
import { clamp } from '../core/noise.js';

const GRAV = 20, ARM = 1.85, REACH = 1.6, HANDS = 1.75;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// closest point on a polyline (pts with radii r) to p: { i, t, point, r, dir }
function closestOn(L, p, out = {}) {
  let best = Infinity;
  for (let i = 0; i < L.pts.length - 1; i++) {
    const A = L.pts[i], B = L.pts[i + 1];
    _a.subVectors(B, A); const l2 = _a.lengthSq(); if (l2 < 1e-6) continue;
    const t = clamp(_b.subVectors(p, A).dot(_a) / l2, 0, 1);
    _c.copy(A).addScaledVector(_a, t);
    const d = _c.distanceToSquared(p);
    if (d < best) { best = d; out.i = i; out.t = t; out.point = (out.point || new THREE.Vector3()).copy(_c); out.r = L.r[i] + (L.r[i + 1] - L.r[i]) * t; out.dir = (out.dir || new THREE.Vector3()).copy(_a).normalize(); }
  }
  out.d = Math.sqrt(best);
  return out;
}
// a point and radius at distance s along a polyline
function along(L, s, out) {
  for (let i = 0; i < L.pts.length - 1; i++) {
    const A = L.pts[i], B = L.pts[i + 1], l = A.distanceTo(B);
    if (s <= l || i === L.pts.length - 2) { const t = clamp(s / Math.max(l, 1e-4), 0, 1); out.point.lerpVectors(A, B, t); out.r = L.r[i] + (L.r[i + 1] - L.r[i]) * t; out.dir.subVectors(B, A).normalize(); out.i = i; return out; }
    s -= l;
  }
  return out;
}
function lengthOf(L) { let s = 0; for (let i = 0; i < L.pts.length - 1; i++) s += L.pts[i].distanceTo(L.pts[i + 1]); return s; }
// trunk axis point and radius at a world height
function trunkAt(T, y, out) {
  const P = T.pts;
  for (let i = 0; i < P.length - 1; i++) {
    if (y <= P[i + 1].y || i === P.length - 2) { const t = clamp((y - P[i].y) / Math.max(1e-4, P[i + 1].y - P[i].y), 0, 1); out.point.lerpVectors(P[i], P[i + 1], t); out.r = T.r[i] + (T.r[i + 1] - T.r[i]) * t; return out; }
  }
  return out;
}

export class Canopy {
  constructor(player) {
    this.P = player; this.g = player.g;
    this.mode = null; this.trees = []; this.scanT = 0; this.cool = 0;
    this.vel = new THREE.Vector3();
    this.hold = null;           // hang: { kind, tree, limb, vine, pivot, grip, len }
    this.pose = { mode: null, gripR: new THREE.Vector3(), gripL: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), yaw: 0, phase: 0, vel: new THREE.Vector3(), trunkC: new THREE.Vector3() };
    this._q = { point: new THREE.Vector3(), dir: new THREE.Vector3(), r: 0 };
    this._hand = new THREE.Vector3(); this._vdir = new THREE.Vector3();
  }
  scan(force) {
    this.scanT -= 1;
    if (force || this.scanT <= 0) { this.scanT = 12; const p = this.P.pos; this.trees = this.g.veg.climbNear(p.x, p.z, 26); }
  }
  // ------------------------------------------------------------------ entering the trees
  // from the ground: Space while facing a trunk close by
  tryTrunk() {
    this.scan(true);
    const p = this.P.pos, fx = -Math.sin(this.P.bodyYaw), fz = -Math.cos(this.P.bodyYaw);
    for (const T of this.trees) {
      if (!T.trunk || T.trunk.r[0] < 0.12) continue;
      const c = T.trunk.pts[0], dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (d < T.trunk.r[0] + 0.9 && (dx * fx + dz * fz) / Math.max(d, 1e-3) > 0.3) { this.startTrunk(T, p.y + HANDS); return true; }
    }
    return false;
  }
  // in the air with Space held: catch the best hold within reach (ahead of the motion preferred)
  tryGrab(vel) {
    if (this.cool > 0) return false;
    this.scan(false);
    const p = this.P.pos, hand = this._hand.copy(p).addScaledVector(_up, HANDS);
    const vdir = this._vdir.copy(vel); const sp = vdir.length(); if (sp > 0.1) vdir.multiplyScalar(1 / sp);
    let best = null, bs = Infinity;
    const q = {};
    for (const T of this.trees) {
      for (const L of T.limbs) {
        closestOn(L, hand, q);
        if (q.r > 0.5 || q.r < 0.035) continue;
        const reach = q.d - q.r;
        if (reach > REACH) continue;
        const toward = sp > 0.1 ? _c.subVectors(q.point, hand).normalize().dot(vdir) : 0;
        const score = reach - toward * 0.5;
        if (score < bs) { bs = score; best = { kind: 'branch', tree: T, limb: L, point: q.point.clone(), r: q.r, dir: q.dir.clone() }; }
      }
      for (const V of T.vines) {
        const end = this.vineEnd(V, _a);
        const ab = _c.subVectors(end, V.a), t = clamp(_b.subVectors(hand, V.a).dot(ab) / ab.lengthSq(), 0.15, 1);
        const pt = _a.copy(V.a).addScaledVector(ab, t), reach = pt.distanceTo(hand);
        if (reach > REACH + 0.3) continue;
        const score = reach - 0.6;   // lianas are easier to catch
        if (score < bs) { bs = score; best = { kind: 'vine', tree: T, vine: V, point: pt.clone(), along: t * V.len }; }
      }
      if (T.trunk && T.trunk.r[0] > 0.12) {
        trunkAt(T.trunk, hand.y, this._q);
        const dx = hand.x - this._q.point.x, dz = hand.z - this._q.point.z, reach = Math.hypot(dx, dz) - this._q.r;
        if (reach < 0.8 && hand.y < T.top - 0.5 && reach - 0.2 < bs) { bs = reach - 0.2; best = { kind: 'trunk', tree: T }; }
      }
    }
    if (!best) return false;
    if (best.kind === 'trunk') this.startTrunk(best.tree, hand.y);
    else this.startHang(best, vel);
    return true;
  }
  vineEnd(V, out) {
    const ax = V.ang.x, az = V.ang.y;
    return out.set(Math.sin(az), -Math.cos(ax) * Math.cos(az), Math.sin(ax)).normalize().multiplyScalar(V.len).add(V.a);
  }
  // ------------------------------------------------------------------ modes
  startTrunk(T, gripY) {
    const p = this.P.pos;
    trunkAt(T.trunk, gripY, this._q);
    this.mode = 'trunk'; this.hold = null; this.tree = T;
    this.th = Math.atan2(p.z - this._q.point.z, p.x - this._q.point.x);
    this.gy = Math.min(gripY, T.top - 0.6);
    this.vel.set(0, 0, 0); this.pose.phase = 0;
    this.g.audio.impact('wood', p, 0.35);
  }
  startHang(h, vel) {
    const p = this.P.pos;
    this.mode = 'hang'; this.tree = h.tree; this.hold = h;
    if (h.kind === 'vine') { h.pivot = h.vine.a; h.len = h.along + ARM; h.vine.held = true; }
    else { h.pivot = h.point; h.len = ARM; }
    // keep the velocity across the arm, lose the part along it (a square catch keeps all its speed)
    const n = _a.subVectors(p, h.pivot); if (n.lengthSq() < 1e-4) n.set(0, -1, 0); n.normalize();
    this.vel.copy(vel).addScaledVector(n, -vel.dot(n));
    p.copy(h.pivot).addScaledVector(n, h.len);
    this.g.audio.impact(h.kind === 'vine' ? 'whiff' : 'wood', p, 0.4);
    this.P.stamina = Math.max(0, this.P.stamina - 2);
  }
  startLimb(T, L, s, faceOut = 1) {
    this.mode = 'limb'; this.tree = T; this.limb = L; this.s = s; this.face = faceOut; this.hold = null;
    this.limbLen = lengthOf(L); this.vel.set(0, 0, 0);
  }
  toAir(vel) { this.flight = { from: this.P.pos.clone(), swing: this.mode === 'hang' }; this.mode = 'air'; this.vel.copy(vel); if (this.hold && this.hold.vine) this.hold.vine.held = false; this.hold = null; }
  drop() { if (this.hold && this.hold.vine) this.hold.vine.held = false; this.mode = null; this.hold = null; }
  land(vy) {
    const P = this.P;
    this.drop();
    P.vel.copy(this.vel); P.vel.y = 0; P.onGround = true;
    if (vy < -13) P.hurt((-vy - 13) * 6, null, { kind: 'fall' });
    this.g.audio.footstep(P.surface(), 1.1, null, 0.5);
  }
  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const P = this.P, g = this.g, k = g.uiBlocking ? {} : input.keys, p = P.pos;
    this.cool = Math.max(0, this.cool - dt);
    this.scan(false);
    const cam = g.camera; cam.getWorldDirection(_d); const fwd = _d.setY(0).normalize().clone(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const iz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), ix = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), hold = !!k.Space;
    const pose = this.pose; pose.mode = this.mode; pose.vel.copy(this.vel);
    if (this.mode === 'trunk') this.updateTrunk(dt, input, iz, ix, right);
    else if (this.mode === 'limb') this.updateLimb(dt, input, iz, fwd);
    else if (this.mode === 'hang') this.updateHang(dt, input, iz, ix, fwd, right, hold);
    else if (this.mode === 'air') this.updateAir(dt, iz, ix, fwd, right, hold);
    if (!this.mode) return;
    P.vel.copy(this.vel); P.speed = Math.hypot(this.vel.x, this.vel.z); P.onGround = false;
    // the camera eases round behind the way Vanaj faces (on a trunk: out from the bark, so he is never hidden
    // behind it), unless the player is steering it
    if (!P.camUserT) P.yaw = P.lerpAngle(P.yaw, this.pose.yaw, Math.min(1, dt * (this.mode === 'trunk' ? 2.5 : 1.4)));
    // tiring: hanging and climbing cost stamina; standing on a limb rests you; spent, you fall
    if (this.mode === 'hang' || this.mode === 'trunk') { P.stamina -= (this.mode === 'hang' ? 2.2 : 2.8) * dt; if (P.stamina <= 0) { g.ui.toast('Arms gave out'); this.toAir(this.vel); this.cool = 1.2; } }
    else if (this.mode === 'limb') P.stamina = Math.min(100, P.stamina + 12 * dt);
  }
  updateTrunk(dt, input, iz, ix, right) {
    const P = this.P, T = this.tree, p = P.pos, q = trunkAt(T.trunk, this.gy, this._q);
    const sprint = this.g.input.keys.ShiftLeft, vUp = iz * (sprint ? 2.6 : 1.7);
    this.gy = clamp(this.gy + vUp * dt, groundHeight(q.point.x, q.point.z) + HANDS, T.top - 0.6);
    const tan = _a.set(-Math.sin(this.th), 0, Math.cos(this.th));
    this.th += ix * dt * 1.8 / (q.r + 0.32) * Math.sign(right.dot(tan) || 1);
    trunkAt(T.trunk, this.gy, q);
    const out = _b.set(Math.cos(this.th), 0, Math.sin(this.th));
    const prev = _c.copy(p);
    p.copy(q.point).addScaledVector(out, q.r + 0.32); p.y = this.gy - HANDS;
    this.vel.subVectors(p, prev).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 4);   // no spike from the snap onto the bark
    this.pose.phase += Math.abs(vUp) * dt * 1.6 + Math.abs(ix) * dt * 1.2;
    this.pose.yaw = Math.atan2(out.x, out.z);       // facing the trunk (bodyYaw convention: forward is -Z rotated by yaw)
    this.pose.trunkC.copy(q.point); this.pose.trunkR = q.r;
    this.pose.up.set(0, 1, 0);
    // hands on the bark either side, reaching up by turns as you climb
    const side = _d.set(-out.z, 0, out.x), ph = this.pose.phase * Math.PI;
    this.pose.gripR.copy(q.point).addScaledVector(out, q.r + 0.04).addScaledVector(side, -0.2); this.pose.gripR.y = this.gy + 0.12 + 0.22 * Math.sin(ph);
    this.pose.gripL.copy(q.point).addScaledVector(out, q.r + 0.04).addScaledVector(side, 0.2); this.pose.gripL.y = this.gy + 0.12 - 0.22 * Math.sin(ph);
    this.pose.out = this.pose.out || new THREE.Vector3(); this.pose.out.copy(out);
    if (iz !== 0 && Math.random() < dt * 3) this.g.audio.impact('wood', p, 0.18);
    // leap off backward, out and up
    if (input.pressed('Space')) { this.toAir(_c.copy(out).multiplyScalar(4.2).setY(4.6)); this.cool = 0.25; P.stamina -= 4; return; }
    // step out onto a limb that starts at this height, on this side of the trunk
    if (iz > 0) for (const L of T.limbs) {
      if (L.level !== 1 || L.r[0] < 0.1) continue;
      const b = L.pts[0], d1 = L.pts[Math.min(2, L.pts.length - 1)];
      const ldir = _d.subVectors(d1, b).setY(0); if (ldir.lengthSq() < 0.01) continue; ldir.normalize();
      if (Math.abs(b.y - (p.y + 0.3)) < 0.9 && ldir.dot(out) > 0.55) { this.startLimb(T, L, 0.5, 1); return; }
    }
    // down at the foot of the tree
    if (iz < 0 && p.y <= groundHeight(p.x, p.z) + 0.05) { this.drop(); P.vel.set(out.x * 1.5, 0, out.z * 1.5); P.onGround = true; }
  }
  updateLimb(dt, input, iz, fwd) {
    const P = this.P, L = this.limb, p = P.pos, q = along(L, this.s, this._q);
    // W walks on the way he faces (out along the limb when he steps onto it); S turns him round
    if (input.pressed('KeyS')) this.face = -this.face;
    const v = Math.abs(iz) * this.face * (this.g.input.keys.ShiftLeft ? 2.6 : 1.5);
    const maxS = this.limbLen - 0.3;
    this.s = clamp(this.s + v * dt, 0.3, maxS);
    along(L, this.s, q);
    if (q.r < 0.06) { this.s -= v * dt; along(L, this.s, q); }   // too thin to stand on further out
    const prev = _c.copy(p);
    p.copy(q.point); p.y += q.r;
    this.vel.subVectors(p, prev).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 4);
    const dir = _a.copy(q.dir).multiplyScalar(this.face).setY(0).normalize();
    this.pose.yaw = Math.atan2(-dir.x, -dir.z); this.pose.up.set(0, 1, 0);
    P.bodyYaw = this.pose.yaw;
    if (input.pressed('Space')) { this.toAir(_b.copy(dir).multiplyScalar(4.8).setY(5.2).add(_c.copy(this.vel).multiplyScalar(0.5))); this.cool = 0.2; P.stamina -= 4; return; }
    if (input.pressed('KeyC')) { const h = { kind: 'branch', tree: this.tree, limb: L, point: q.point.clone(), r: q.r, dir: q.dir.clone() }; p.copy(q.point); p.y -= ARM; this.startHang(h, _b.set(0, 0, 0)); }
    // back at the trunk: climb it again
    if (this.s <= 0.31 && v < 0 && this.tree.trunk) this.startTrunk(this.tree, p.y + HANDS);
  }
  updateHang(dt, input, iz, ix, fwd, right, hold) {
    const P = this.P, h = this.hold, p = P.pos, v = this.vel;
    // a branch hold can be shuffled along hand over hand
    if (h.kind === 'branch' && ix !== 0) {
      const step = _a.copy(h.dir).multiplyScalar(ix * Math.sign(right.dot(h.dir) || 1) * 1.1 * dt);
      const np = _b.copy(h.point).add(step), q = closestOn(h.limb, np, {});
      if (q.r > 0.035) h.point.copy(q.point);
    }
    if (h.kind === 'vine') { h.pivot = h.vine.a; }
    // pendulum: gravity, a pump toward where you look, light air drag, and the arm holding the length
    // pumping: a kick along the swing while it moves the way you look (like kicking on a playground swing),
    // or a pull that way from still; each half-swing then climbs higher
    v.y -= GRAV * dt;
    if (iz !== 0) {
      const hv = _c.set(v.x, 0, v.z), sp = hv.length(), dirv = sp > 0.3 ? hv.multiplyScalar(1 / sp) : null;
      if (dirv && dirv.dot(fwd) * iz > 0) v.addScaledVector(dirv, 9 * dt);
      else if (!dirv) v.addScaledVector(fwd, iz * 6 * dt);
    }
    v.multiplyScalar(1 - 0.08 * dt);
    p.addScaledVector(v, dt);
    const n = _a.subVectors(p, h.pivot); const d = n.length() || 1; n.multiplyScalar(1 / d);
    if (n.y > 0.35) { n.y = 0.35; n.normalize(); }   // the swing never goes over the top of the hold
    p.copy(h.pivot).addScaledVector(n, h.len);
    v.addScaledVector(n, -v.dot(n));
    // the hands: on the branch either side of the grip, or on the liana an arm's length above the body
    const grip = h.kind === 'vine' ? _b.copy(p).addScaledVector(n, -ARM) : h.point;
    const side = _c.set(-n.z, 0, n.x).normalize();
    if (h.kind === 'branch') side.copy(h.dir).setY(0).normalize();
    this.pose.gripR.copy(grip).addScaledVector(side, 0.11); this.pose.gripL.copy(grip).addScaledVector(side, -0.11);
    this.pose.up.copy(n).negate();
    const hv = _d.set(v.x, 0, v.z);
    if (hv.lengthSq() > 0.25) this.pose.yaw = Math.atan2(-hv.x, -hv.z); else this.pose.yaw = Math.atan2(-fwd.x, -fwd.z);
    P.bodyYaw = this.pose.yaw;
    if (h.kind === 'vine') h.vine.hand = grip.clone();
    // ground under a long liana
    const gy = groundHeight(p.x, p.z);
    if (p.y < gy) { p.y = gy; this.land(v.y); return; }
    if (input.pressed('KeyC')) { this.toAir(v); this.cool = 0.5; return; }
    if (input.pressed('KeyE') && h.kind === 'branch' && h.r > 0.09 && v.length() < 2.5) {
      const q = closestOn(h.limb, h.point, {}), s = this.sOn(h.limb, q);
      this.startLimb(h.tree, h.limb, s, 1); p.copy(q.point); p.y += q.r; return;
    }
    // let go: fly on with a lift (the release hop of vine-swinging games)
    if (!hold) {
      const sp = v.length();
      const boost = _c.copy(v).multiplyScalar(sp > 0.5 ? 0.9 / sp : 0).setY(2.4);
      this.toAir(_d.copy(v).add(boost)); this.cool = 0.22;
    }
  }
  sOn(L, q) { let s = 0; for (let i = 0; i < q.i; i++) s += L.pts[i].distanceTo(L.pts[i + 1]); return s + L.pts[q.i].distanceTo(L.pts[q.i + 1]) * q.t; }
  updateAir(dt, iz, ix, fwd, right, hold) {
    const P = this.P, p = P.pos, v = this.vel;
    // a leap thrown from a swing that carries 4 m counts as flying (the chapter-one lesson listens for it)
    const F = this.flight; if (F && F.swing && !F.told && Math.hypot(p.x - F.from.x, p.z - F.from.z) > 4) { F.told = true; this.g.emit('swung'); }
    v.y -= GRAV * dt;
    v.addScaledVector(fwd, iz * 3 * dt).addScaledVector(right, ix * 3 * dt);
    p.addScaledVector(v, dt);
    const hv = _d.set(v.x, 0, v.z); if (hv.lengthSq() > 0.25) { this.pose.yaw = Math.atan2(-hv.x, -hv.z); P.bodyYaw = this.pose.yaw; }
    this.pose.up.set(0, 1, 0);
    // land on a limb
    if (v.y < 0) for (const T of this.trees) for (const L of T.limbs) {
      const q = closestOn(L, p, {});
      if (q.r > 0.1 && q.d < q.r + 0.3 && p.y > q.point.y && p.y < q.point.y + q.r + 0.35 && Math.abs(q.dir.y) < 0.6) {
        this.startLimb(T, L, this.sOn(L, q), 1); p.copy(q.point); p.y += q.r;
        this.g.audio.footstep('rock', 0.8, null, 0.4); return;
      }
    }
    if (hold && this.tryGrab(v)) return;
    const gy = groundHeight(p.x, p.z);
    if (p.y <= gy) { p.y = gy; this.land(v.y); }
  }
}

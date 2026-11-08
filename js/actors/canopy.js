// Vanaj in the trees: free climbing on trunks, walking out along limbs, hanging and swinging from branches and
// lianas, and leaping between them.
//
// Swinging follows how Gibbon: Beyond the Trees built brachiation (Eddy Boxerman, "Physics-based animation in
// Gibbon", Game Developer 2022): the body is a point hanging from the hand like a pendulum. A grab keeps the
// velocity across the arm and loses only the part along it, so a catch with the arm square to the motion carries
// all the speed on; release flies ballistically to the next hold. Controls follow vine-swinging games: hold to
// grab, release to let go (one button), so the same scheme works on a touch screen.
//
//   on the ground   Space jumps; Space facing a trunk or a banyan's aerial root starts climbing it
//   in the air      hold Space to catch any branch, liana, root or trunk within reach
//   hanging         WASD pump the swing the way you push (relative to the camera, like leaning on a playground
//                   swing: each push in time with the swing adds height, a push against it brakes);
//                   Shift+W/S climbs up or slides down a liana; release Space to let go and fly,
//                   E pulls up onto a thick branch, C drops
//   on a trunk      W/S climb, A/D go round, Space leaps off backward, W at a limb's base steps out onto it
//   on a root       W/S climb hand over hand, A/D go round it, W at the top steps onto the limb it hangs from,
//                   Space leaps off
//   on a limb       W/S walk along it, Space leaps, C lowers you to hang from it
import * as THREE from 'three';
import { groundHeight } from '../world/terrain.js';
import { clamp } from '../core/noise.js';
import { G } from '../core/shaderlib.js';

const GRAV = 20, ARM = 1.85, REACH = 1.6, HANDS = 1.75;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3();
// how far (0..1) down a straight root from a to b the point nearest p lies
function ropeT(V, p) { _e.subVectors(V.b, V.a); return clamp(_f.subVectors(p, V.a).dot(_e) / Math.max(1e-4, _e.lengthSq()), 0, 1); }

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
    // the limb under his weight: a damped spring (droop in m at the load point), drawn by the tree shaders
    this.bend = { amt: 0, vel: 0, tree: null, limb: null, B: new THREE.Vector3(), P: new THREE.Vector3() };
  }
  // how far the limb he is on sags at the load point: a beam's droop grows with the square of the lever and falls
  // fast with the limb's thickness; swinging adds the pull of the swing (g + v^2 / length)
  updateBend(dt) {
    const b = this.bend, h = this.hold;
    let L = null, at = null, load = 1;
    if (this.mode === 'hang' && h) {
      if (h.kind === 'branch') { L = h.limb; at = h.point; } else if (h.vine.limb) { L = h.vine.limb; at = h.vine.a; }
      load = 1 + Math.min(2, this.vel.lengthSq() / (Math.max(1, h.len) * GRAV));
    } else if (this.mode === 'limb') { L = this.limb; at = this.P.pos; load = 1; }
    else if (this.mode === 'rope' && this.rope.limb) { L = this.rope.limb; at = this.rope.a; load = 0.7; }
    let target = 0;
    if (L) {
      const q = closestOn(L, at, {}), s = this.sOn(L, q);
      if (b.limb !== L) { b.limb = L; b.tree = this.tree; }
      b.B.copy(L.pts[0]); b.P.copy(q.point);
      target = clamp(0.0012 * s * s / Math.pow(Math.max(0.04, L.r[0]), 1.6), 0, 0.5) * load;
    }
    b.vel += (70 * (target - b.amt) - 4.2 * b.vel) * dt; b.amt += b.vel * dt;
    if (!L && Math.abs(b.amt) < 0.002 && Math.abs(b.vel) < 0.01) { b.amt = 0; b.vel = 0; b.limb = null; b.tree = null; }
    if (b.tree) { G.uBendTree.value.set(b.tree.x, b.tree.z); G.uBendB.value.copy(b.B); G.uBendP.value.copy(b.P); }
    G.uBendAmt.value = b.tree ? b.amt : 0;
  }
  // the sag at the limb he holds or stands on (0 elsewhere)
  sag(L) { return L && this.bend.limb === L ? this.bend.amt : 0; }
  scan(force) {
    this.scanT -= 1;
    if (force || this.scanT <= 0) { this.scanT = 12; const p = this.P.pos; this.trees = this.g.veg.climbNear(p.x, p.z, 26); }
  }
  // ------------------------------------------------------------------ entering the trees
  // from the ground: Space while facing a trunk close by
  tryTrunk() {
    this.scan(true);
    const p = this.P.pos, fx = -Math.sin(this.P.bodyYaw), fz = -Math.cos(this.P.bodyYaw);
    // a banyan's aerial root just in front: take hold of it at hand height
    let best = null, bd = Infinity;
    const hand = _g.copy(p).addScaledVector(_up, HANDS);
    for (const T of this.trees) for (const V of T.vines) {
      if (!V.fixed) continue;
      const t = ropeT(V, hand), pt = _a.copy(V.a).lerp(V.b, t);
      const dx = pt.x - p.x, dz = pt.z - p.z, d = Math.hypot(dx, dz);
      if (d < V.r + 0.85 && d < bd && pt.y > p.y + 0.8 && (dx * fx + dz * fz) / Math.max(d, 1e-3) > 0.2) { bd = d; best = { T, V, t }; }
    }
    if (best) { this.startRope(best.T, best.V, best.t * best.V.len); return true; }
    // a liana hanging within reach: take it running and swing out on your own momentum (a rope swing)
    for (const T of this.trees) for (const V of T.vines) {
      if (V.fixed) continue;
      const end = this.vineEnd(V, _a), ab = _b.subVectors(end, V.a), t = clamp(_c.subVectors(hand, V.a).dot(ab) / ab.lengthSq(), 0.2, 1);
      const pt = _c.copy(V.a).addScaledVector(ab, t);
      if (pt.distanceTo(hand) > 1.0 || Math.hypot(pt.x - p.x, pt.z - p.z) > 0.95) continue;
      // hands where the feet clear the ground by a stride all along the swing (the highest ground under the arc,
      // from behind the liana to well past it the way he runs)
      const pv = this.P.vel, sp = Math.hypot(pv.x, pv.z), dx = sp > 0.5 ? pv.x / sp : V.a.x - p.x, dz = sp > 0.5 ? pv.z / sp : V.a.z - p.z, dl = Math.hypot(dx, dz) || 1;
      let gMax = groundHeight(p.x, p.z);
      for (let k = -2; k <= 4; k++) gMax = Math.max(gMax, groundHeight(V.a.x + dx / dl * k, V.a.z + dz / dl * k));
      const along = clamp(Math.min(t * V.len, V.a.y - (gMax + 0.45 + ARM)), 0.4, V.len);
      // (a hop up onto it, not a lift: too high a rise and Space just jumps, to catch it in the air)
      if (along < 1 || V.a.y - along - ARM - p.y > 0.8) continue;
      this.startHang({ kind: 'vine', tree: T, vine: V, point: pt.clone(), along }, _d.copy(this.P.vel).setY(Math.max(0, this.P.vel.y)));
      this.flight = null; return true;
    }
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
        if (V.fixed) {   // a banyan root: grab it and climb
          const t = ropeT(V, hand), pt = _a.copy(V.a).lerp(V.b, t), reach = pt.distanceTo(hand) - V.r;
          if (reach > REACH || t > 0.97) continue;
          if (reach - 0.4 < bs) { bs = reach - 0.4; best = { kind: 'rope', tree: T, vine: V, along: t * V.len }; }
          continue;
        }
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
    else if (best.kind === 'rope') this.startRope(best.tree, best.vine, best.along);
    else this.startHang(best, vel);
    return true;
  }
  vineEnd(V, out) {
    if (V.fixed) return out.copy(V.b);
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
    if (vel.x * vel.x + vel.z * vel.z > 0.25) this.pose.yaw = Math.atan2(-vel.x, -vel.z);   // facing the way he came in
    if (h.kind === 'vine') { h.pivot = h.vine.a.clone(); h.len = h.along + ARM; h.vine.held = true; }
    else { h.pivot = h.point.clone(); h.len = ARM; }
    h.len0 = h.len;
    this.bend.vel += 0.6 + Math.min(2.5, Math.max(0, -vel.y) * 0.25);   // the limb gives as he takes it
    // keep the velocity across the arm, lose the part along it (a square catch keeps all its speed)
    const n = _a.subVectors(p, h.pivot); if (n.lengthSq() < 1e-4) n.set(0, -1, 0); n.normalize();
    this.vel.copy(vel).addScaledVector(n, -vel.dot(n));
    p.copy(h.pivot).addScaledVector(n, h.len);
    this.g.audio.impact(h.kind === 'vine' ? 'whiff' : 'wood', p, 0.4);
    this.P.stamina = Math.max(0, this.P.stamina - 2);
  }
  // a banyan root: `along` is how far down from its top the hands are
  startRope(T, V, along) {
    const p = this.P.pos;
    this.mode = 'rope'; this.tree = T; this.rope = V; this.hold = null;
    this.ra = clamp(along, 0.4, V.len);
    const g = _a.copy(V.a).lerp(V.b, this.ra / V.len);
    this.th = Math.atan2(p.z - g.z, p.x - g.x);
    this.vel.set(0, 0, 0); this.pose.phase = 0;
    this.g.audio.impact('wood', p, 0.3);
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
    P.landed(vy);
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
    else if (this.mode === 'rope') this.updateRope(dt, input, iz, ix, fwd, right);
    else if (this.mode === 'limb') this.updateLimb(dt, input, iz, fwd);
    else if (this.mode === 'hang') this.updateHang(dt, input, iz, ix, fwd, right, hold);
    else if (this.mode === 'air') this.updateAir(dt, iz, ix, fwd, right, hold);
    this.updateBend(dt);
    if (!this.mode) return;
    P.vel.copy(this.vel); P.speed = Math.hypot(this.vel.x, this.vel.z); P.onGround = false;
    // the camera eases round behind the way Vanaj faces (on a trunk: out from the bark, so he is never hidden
    // behind it), unless the player is steering it
    if (!P.camUserT) P.yaw = P.lerpAngle(P.yaw, this.pose.yaw, Math.min(1, dt * (this.mode === 'trunk' || this.mode === 'rope' ? 2.5 : 1.4)));
    // tiring: hanging and climbing cost stamina; standing on a limb rests you; spent, you fall
    if (this.mode === 'hang' || this.mode === 'trunk' || this.mode === 'rope') { P.stamina -= (this.mode === 'trunk' ? 2.8 : 2.2) * dt; if (P.stamina <= 0) { g.ui.toast('Arms gave out'); this.toAir(this.vel); this.cool = 1.2; } }
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
    p.copy(q.point).addScaledVector(out, q.r + 0.32); p.y = this.gy - HANDS + (iz !== 0 ? 0.07 * Math.sin(this.pose.phase * Math.PI * 2) : 0);   // a heave with each pull
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
  // hand over hand up a banyan's aerial root, knees gripping it (posed like trunk climbing)
  updateRope(dt, input, iz, ix, fwd, right) {
    const P = this.P, V = this.rope, T = this.tree, p = P.pos;
    const sprint = this.g.input.keys.ShiftLeft, vUp = iz * (sprint ? 2.3 : 1.45);
    const dir = _a.subVectors(V.b, V.a).divideScalar(V.len);   // down the root
    // the hands never pass the top, and the feet never go below the ground at the root's foot
    const foot = groundHeight(V.b.x, V.b.z);
    const maxA = Math.max(0.45, dir.y < -0.2 ? Math.min(V.len, (V.a.y - foot - HANDS) / -dir.y) : V.len);
    this.ra = clamp(this.ra - vUp * dt, 0.45, maxA);
    const grip = _b.copy(V.a).addScaledVector(dir, this.ra);
    const tan = _c.set(-Math.sin(this.th), 0, Math.cos(this.th));
    this.th += ix * dt * 2.2 / (V.r + 0.3) * Math.sign(right.dot(tan) || 1);
    const out = _c.set(Math.cos(this.th), 0, Math.sin(this.th));
    const prev = _d.copy(p);
    p.copy(grip).addScaledVector(out, V.r + 0.3); p.y = grip.y - HANDS + (iz !== 0 ? 0.06 * Math.sin(this.pose.phase * Math.PI * 2) : 0);
    this.vel.subVectors(p, prev).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 4);
    this.pose.phase += Math.abs(vUp) * dt * 1.8 + Math.abs(ix) * dt * 1.2;
    this.pose.mode = 'trunk';
    this.pose.yaw = Math.atan2(out.x, out.z);
    this.pose.trunkC.copy(grip); this.pose.trunkR = V.r; this.pose.up.set(0, 1, 0);
    // one hand above the other on the root, taking turns as he climbs
    const ph = this.pose.phase * Math.PI, side = _d.set(-out.z, 0, out.x);
    this.pose.gripR.copy(grip).addScaledVector(out, V.r + 0.03).addScaledVector(side, -0.05); this.pose.gripR.y += 0.12 + 0.2 * Math.sin(ph);
    this.pose.gripL.copy(grip).addScaledVector(out, V.r + 0.03).addScaledVector(side, 0.05); this.pose.gripL.y += 0.12 - 0.2 * Math.sin(ph);
    this.pose.out = this.pose.out || new THREE.Vector3(); this.pose.out.copy(out);
    if (iz !== 0 && Math.random() < dt * 2.5) this.g.audio.impact('wood', p, 0.12);
    if (input.pressed('Space')) { this.toAir(_f.copy(out).multiplyScalar(4.2).setY(4.6)); this.cool = 0.25; P.stamina -= 4; return; }
    // at the top: out onto the limb the root hangs from, facing the way the camera looks
    if (iz > 0 && this.ra <= 0.46 && V.limb) {
      const q = closestOn(V.limb, V.a, {});
      if (q.r > 0.09 && q.d < 1.6) { this.startLimb(T, V.limb, this.sOn(V.limb, q), q.dir.dot(fwd) >= 0 ? 1 : -1); p.copy(q.point); p.y += q.r; return; }
    }
    // at the foot: back on the ground
    if (iz < 0 && this.ra >= maxA - 0.01) { this.drop(); p.y = Math.max(p.y, groundHeight(p.x, p.z)); P.vel.set(out.x * 1.5, 0, out.z * 1.5); P.onGround = true; }
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
    p.copy(q.point); p.y += q.r - this.sag(L);
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
    // the hold sinks as the limb sags under him
    if (h.kind === 'vine') h.pivot.copy(h.vine.a).y -= this.sag(h.vine.limb);
    else h.pivot.copy(h.point).y -= this.sag(h.limb);
    // pendulum: gravity, the player's push, light air drag, and the arm holding the length
    v.y -= GRAV * dt;
    if (h.kind === 'vine' && this.g.input.keys.ShiftLeft && iz !== 0) {
      // Shift+W/S: hand over hand up or down the liana; the swing settles while he climbs
      h.along = clamp(h.along - iz * 1.3 * dt, 0.3, h.vine.len - 0.15); h.len = h.len0 = h.along + ARM;
      v.multiplyScalar(1 - Math.min(1, 1.6 * dt));
      this.pose.phase += 2.4 * dt;
      // at the top: up onto the limb it hangs from
      const L = h.vine.limb;
      if (iz > 0 && h.along <= 0.31 && L) {
        const q = closestOn(L, h.vine.a, {});
        if (q.r > 0.09 && q.d < 1.2) { this.drop(); this.startLimb(h.tree, L, this.sOn(L, q), q.dir.dot(fwd) >= 0 ? 1 : -1); p.copy(q.point); p.y += q.r; return; }
      }
    } else {
      // pumping, like leaning on a playground swing: holding a direction (relative to the camera; a branch
      // swings only fore and aft) pumps the swing along that line, a little higher each half-swing, and slowly
      // turns the swing round onto it; from still, it sets the swing going. Let go of the keys and the swing
      // dies away on its own.
      const push = _e.copy(fwd).multiplyScalar(iz);
      if (h.kind === 'vine') push.addScaledVector(right, ix);
      const hv = _c.set(v.x, 0, v.z), sp = hv.length();
      if (push.lengthSq() > 0) {
        push.normalize();
        if (sp > 0.3) {
          hv.multiplyScalar(1 / sp);
          const k = hv.dot(push), s = Math.sign(k) || 1;
          if (sp < 11) v.addScaledVector(hv, Math.abs(k) * 3.2 * dt);
          v.addScaledVector(_f.copy(push).multiplyScalar(s).addScaledVector(hv, -Math.abs(k)), 1.6 * dt);
        } else v.addScaledVector(push, 4 * dt);
        v.multiplyScalar(1 - 0.06 * dt);
      } else v.multiplyScalar(1 - 0.22 * dt);
    }
    v.clampLength(0, 14);
    // through the physics world: a swing into a trunk, a rock or a wall bounces off it; feet down on the ground
    // or on top of a rock, he stands
    const vy0 = v.y, hit = this.sweep(p, v, dt);
    const fast = Math.hypot(v.x, v.z) > 1.3;
    if (hit && hit.ny > 0.6 && vy0 < 0.5 && !fast) { this.land(vy0); return; }
    // feet down on the ground (or a rock) while the swing is going: he tucks his legs up and the swing runs on
    // shorter, letting the legs down again once clear
    if (hit && hit.ny > 0.6) { h.len = Math.max(ARM * 0.7, Math.min(h.len, p.distanceTo(h.pivot) - 0.05)); v.y = Math.max(v.y, 0); }
    else if (h.len < h.len0) h.len = Math.min(h.len0, h.len + 0.9 * dt);
    const n = _a.subVectors(p, h.pivot); const d = n.length() || 1; n.multiplyScalar(1 / d);
    if (n.y > 0.35) { n.y = 0.35; n.normalize(); }   // the swing never goes over the top of the hold
    p.copy(h.pivot).addScaledVector(n, h.len);
    v.addScaledVector(n, -v.dot(n));
    // the hands: on the branch either side of the grip, or on the liana an arm's length above the body
    const grip = h.kind === 'vine' ? _b.copy(p).addScaledVector(n, -ARM) : h.pivot;
    const side = _c.set(-n.z, 0, n.x).normalize();
    if (h.kind === 'branch') side.copy(h.dir).setY(0).normalize();
    this.pose.gripR.copy(grip).addScaledVector(side, 0.11); this.pose.gripL.copy(grip).addScaledVector(side, -0.11);
    // climbing the liana: one hand above the other, taking turns
    if (h.kind === 'vine' && this.g.input.keys.ShiftLeft && iz !== 0) { const s = 0.16 * Math.sin(this.pose.phase * Math.PI); this.pose.gripR.addScaledVector(n, -0.08 - s); this.pose.gripL.addScaledVector(n, -0.08 + s); }
    this.pose.up.copy(n).negate();
    // facing: along the swing, but he does not turn round at each end of it (swinging back he goes backwards,
    // as on a playground swing), so the camera behind him stays steady too
    const hv = _d.set(v.x, 0, v.z);
    if (hv.lengthSq() > 2.5) {   // (near the ends of the swing, where it hangs still, the facing holds)
      hv.normalize();
      if (hv.x * -Math.sin(this.pose.yaw) + hv.z * -Math.cos(this.pose.yaw) < 0) hv.negate();
      this.pose.yaw = P.lerpAngle(this.pose.yaw, Math.atan2(-hv.x, -hv.z), Math.min(1, dt * 3));
    }
    P.bodyYaw = this.pose.yaw;
    if (h.kind === 'vine') h.vine.hand = grip.clone();
    // ground under a long liana: legs tucked while the swing is going, standing once it has slowed
    const gy = groundHeight(p.x, p.z);
    if (p.y < gy) {
      if (!fast) { p.y = gy; this.land(v.y); return; }
      p.y = gy; h.len = Math.max(ARM * 0.7, p.distanceTo(h.pivot)); v.y = Math.max(v.y, 0);
    }
    this.pose.tuck = clamp((h.len0 - h.len) / 0.6, 0, 1);
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
  // move the feet along v*dt through the physics world (a ball at the ankles, so it meets trunks, rocks, walls and
  // the ground but not the limb the hands hold); on a hit, stop there and lose the speed into the surface with a
  // little bounce. Returns the hit (with its normal) or null.
  sweep(p, v, dt) {
    const ph = this.g.phys;
    if (!ph) { p.addScaledVector(v, dt); return null; }
    const d = _f.copy(v).multiplyScalar(dt), from = _g.copy(p); from.y += 0.3;
    const h = ph.sweepBall(from, d, 0.28);
    if (!h) { p.add(d); return null; }
    p.addScaledVector(d, Math.max(0, h.t - 0.01 / Math.max(1e-4, d.length())));
    const vn = v.x * h.nx + v.y * h.ny + v.z * h.nz;
    if (vn < 0) {
      v.x -= h.nx * vn * 1.25; v.y -= h.ny * vn * 1.25; v.z -= h.nz * vn * 1.25;
      if (vn < -2.5 && h.ny < 0.6) { this.g.audio.impact('wood', p, Math.min(1, -vn / 8)); if (vn < -9) this.P.hurt((-vn - 9) * 4, null, { kind: 'fall' }); }
    }
    return h;
  }
  // a limb close under the feet (the limb landing takes it, not the ground landing)
  limbUnder(p) {
    for (const T of this.trees) for (const L of T.limbs) { const q = closestOn(L, p, {}); if (q.r > 0.1 && q.d < q.r + 0.45 && p.y > q.point.y) return true; }
    return false;
  }
  sOn(L, q) { let s = 0; for (let i = 0; i < q.i; i++) s += L.pts[i].distanceTo(L.pts[i + 1]); return s + L.pts[q.i].distanceTo(L.pts[q.i + 1]) * q.t; }
  updateAir(dt, iz, ix, fwd, right, hold) {
    const P = this.P, p = P.pos, v = this.vel;
    // a leap thrown from a swing that carries 4 m counts as flying (the chapter-one lesson listens for it)
    const F = this.flight; if (F && F.swing && !F.told && Math.hypot(p.x - F.from.x, p.z - F.from.z) > 4) { F.told = true; this.g.emit('swung'); }
    v.y -= GRAV * dt;
    v.addScaledVector(fwd, iz * 3 * dt).addScaledVector(right, ix * 3 * dt);
    const vy0 = v.y, hit = this.sweep(p, v, dt);
    // came down on top of something that is not a limb (a rock, a roof, the tower deck, the ground): stand there
    if (hit && hit.ny > 0.6 && vy0 <= 0.5 && !this.limbUnder(p)) { this.land(vy0); return; }
    const hv = _d.set(v.x, 0, v.z); if (hv.lengthSq() > 0.25) { this.pose.yaw = Math.atan2(-hv.x, -hv.z); P.bodyYaw = this.pose.yaw; }
    this.pose.up.set(0, 1, 0);
    // land on a limb
    if (v.y < 0) for (const T of this.trees) for (const L of T.limbs) {
      const q = closestOn(L, p, {});
      if (q.r > 0.1 && q.d < q.r + 0.3 && p.y > q.point.y && p.y < q.point.y + q.r + 0.35 && Math.abs(q.dir.y) < 0.6) {
        this.startLimb(T, L, this.sOn(L, q), 1); p.copy(q.point); p.y += q.r;
        this.bend.vel += Math.min(3, -v.y * 0.3);   // the limb gives under the landing
        this.g.audio.footstep('rock', 0.8, null, 0.4); return;
      }
    }
    if (hold && this.tryGrab(v)) return;
    const gy = groundHeight(p.x, p.z);
    if (p.y <= gy) { p.y = gy; this.land(v.y); }
  }
}

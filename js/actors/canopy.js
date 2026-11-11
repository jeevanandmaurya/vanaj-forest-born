// Vanaj in the trees: free climbing on trunks, walking out along limbs, hanging and swinging from branches and
// lianas, and leaping between them.
//
// Swinging follows how Gibbon: Beyond the Trees built brachiation (Eddy Boxerman, "Physics-based animation in
// Gibbon", Game Developer 2022): the body is a point hanging from the hand like a pendulum. A grab keeps the
// velocity across the arm and loses only the part along it, so a catch with the arm square to the motion carries
// all the speed on; release flies ballistically to the next hold. Controls follow vine-swinging games: hold to
// grab, tap again to let go (one button), so the same scheme works on a touch screen with the thumb free to steer.
//
//   on the ground   Space jumps; Space facing a trunk or a banyan's aerial root starts climbing it
//   in the air      tap Space to catch any branch, liana, root or trunk within reach. He keeps hold by himself.
//   on a rope       (a liana or a banyan root) two separate things:
//                   WASD throws his weight, swinging the rope the way you push, relative to the camera; each push
//                   in time with the swing adds height, a push against it brakes
//                   Shift+W/S climbs up or down it hand over hand; at the top he steps up onto the limb
//                   He kicks with his legs the way you push. Tap Space to let go and fly. C drops.
//   on a branch     WASD swings and shuffles along it, E pulls up onto a thick one, tap Space to let go, C drops
//   on a trunk      W/S climb hand and foot all the way to the top of the tree, A/D go round, E steps out onto a limb
//                   beside you, Space leaps off backward
//   on a limb       W/S walk along it, Space leaps, C lowers you to hang from it
import * as THREE from 'three';
import { groundHeight } from '../world/terrain.js';
import { clamp } from '../core/noise.js';

const GRAV = 20, ARM = 1.85, REACH = 1.6, HANDS = 1.75;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3();
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
// Climbing is a gait: each hand or foot holds still on the wood while the body rises past it, then lets go and reaches
// up. Right hand moves with left foot, left hand with right foot. STRIDE is how far he rises per full cycle.
const STRIDE = 0.8, DUTY = 0.72, GAIT = STRIDE * DUTY / 2;
// a limb's height about its centre (+1 top of its reach, -1 bottom) at phase ph, and how far it has lifted off the wood
function gait(ph, out) {
  ph = ((ph % 1) + 1) % 1;
  if (ph < DUTY) { out.y = 1 - 2 * ph / DUTY; out.lift = 0; return out; }
  const t = (ph - DUTY) / (1 - DUTY), s = t * t * (3 - 2 * t);
  out.y = -1 + 2 * s; out.lift = Math.sin(t * Math.PI); return out;
}
const _g1 = { y: 0, lift: 0 }, _g2 = { y: 0, lift: 0 }, _bq = { point: new THREE.Vector3(), r: 0 };
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
    this.grabT = 0; this.latch = false; this.heldT = 0;   // (tap to grip: see wantGrab)
    Object.assign(this.pose, { steer: new THREE.Vector3(), free: 0, footL: new THREE.Vector3(), footR: new THREE.Vector3(), out: new THREE.Vector3(1, 0, 0), side: new THREE.Vector3(0, 0, 1), fingersR: new THREE.Vector3(0, 1, 0), fingersL: new THREE.Vector3(0, 1, 0), thumbR: new THREE.Vector3(0, 0, 1), thumbL: new THREE.Vector3(0, 0, -1), open: 0, climbing: 0, legL: 0, legR: 0 });
    this.prompt = null;
    this._q = { point: new THREE.Vector3(), dir: new THREE.Vector3(), r: 0 };
    this._hand = new THREE.Vector3(); this._vdir = new THREE.Vector3();
    this.off = new THREE.Vector3();   // how far the soft tree has carried the place he holds or stands on
  }
  // His weight on the soft tree (js/world/neartree.js): the limb he is on takes a load along the line of pull, its
  // droop growing with the square of the lever and falling fast with the limb's thickness; swinging adds the pull of
  // the swing (g + v^2 / length) and swings it sideways too. this.off is how far that has carried his hold.
  updateBend(dt) {
    this.off.set(0, 0, 0);
    if (!this.mode || !this.tree || !this.g.near) return;
    const S = this.g.near.softOf(this.tree); if (!S) return;
    const h = this.hold, p = this.P.pos, v = this.vel;
    let L = null, at = null, load = 1; const pull = _g.set(0, -1, 0);
    if (this.mode === 'hang' && h) {
      if (h.kind === 'branch') { L = h.limb; at = h.point; } else if (h.vine.limb) { L = h.vine.limb; at = h.vine.a; }
      load = 1 + Math.min(2, v.lengthSq() / (Math.max(1, h.len) * GRAV));
      if (h.pivot) pull.subVectors(p, h.pivot).normalize();
    } else if (this.mode === 'limb') { L = this.limb; at = p; }
    else if (this.mode === 'rope' && this.rope.limb) { L = this.rope.limb; at = this.rope.a; load = 0.7; }
    else if (this.mode === 'trunk' && this.tree.spine) {
      // climbing, the wood he is on leans a touch toward him, more as he gets out into the thin top of the tree
      const sp = this.tree.spine; let i = 0; while (i < sp.pts.length - 2 && sp.pts[i + 1].y < this.gy) i++;
      const s0 = S.simOf(sp.own[i].bi), t = sp.t[i], o = this.pose.out, lean = 0.012 / Math.max(0.25, sp.r[i] * 3);
      S.droop(s0, t, o.x * lean, 0, o.z * lean);
      S.dispAt(s0, t, this.off); return;
    }
    if (!L) return;
    const q = closestOn(L, at, {}), s = this.sOn(L, q), tt = s / Math.max(0.1, lengthOf(L)), si = S.simOf(L.bi);
    const d = clamp(0.00055 * s * s / Math.pow(Math.max(0.04, L.r[0]), 1.6), 0, 0.3) * load;
    S.droop(si, tt, pull.x * d, pull.y * d, pull.z * d);
    S.dispAt(si, tt, this.off);
  }
  // Is he reaching for a hold? A tap counts for a moment, so it need not land on the very frame a branch comes in reach; a held key counts too.
  // The press that jumped him off the ground is not a reach (tap again in the air to catch), and neither is the press that just let go,
  // until the key has come back up.
  wantGrab(input, dt) {
    if (!input.keys.Space) this.latch = false;
    this.grabT = Math.max(0, this.grabT - dt);
    if (input.pressed('Space') && !this.P.jumpedNow) this.grabT = 0.4;
    return this.grabT > 0 || (!!input.keys.Space && !this.latch);
  }
  // the spring of the limb at hand, for a kick when he lands on it
  kickLimb(L, vx, vy, vz) { const S = this.g.near && this.g.near.softOf(this.tree); if (S && L) S.kick(S.simOf(L.bi), vx, vy, vz); }
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
        trunkAt(T.spine, hand.y, this._q);
        const dx = hand.x - this._q.point.x, dz = hand.z - this._q.point.z, reach = Math.hypot(dx, dz) - this._q.r;
        if (reach < 0.8 && hand.y < T.top - 0.2 && reach - 0.2 < bs) { bs = reach - 0.2; best = { kind: 'trunk', tree: T }; }
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
    trunkAt(T.spine, gripY, this._q);
    this.mode = 'trunk'; this.hold = null; this.tree = T;
    this.th = Math.atan2(p.z - this._q.point.z, p.x - this._q.point.x);
    this.gy = Math.min(gripY, T.top - 0.05);
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
    this.mode = 'rope'; this.tree = T; this.rope = V; this.hold = null; V.grabbed = true;
    this.ra = clamp(along, 0.4, V.len);
    const g = _a.copy(V.a).lerp(V.b, this.ra / V.len);
    this.th = Math.atan2(p.z - g.z, p.x - g.x);
    this.vel.set(0, 0, 0); this.pose.phase = 0;
    this.g.audio.impact('wood', p, 0.3);
  }
  startLimb(T, L, s, faceOut = 1) {
    if (this.rope) this.rope.grabbed = false;
    this.mode = 'limb'; this.tree = T; this.limb = L; this.s = s; this.face = faceOut; this.hold = null;
    this.limbLen = lengthOf(L); this.vel.set(0, 0, 0);
  }
  toAir(vel) { this.latch = !!this.g.input.keys.Space; this.grabT = 0; if (this.rope) this.rope.grabbed = false; this.flight = { from: this.P.pos.clone(), swing: this.mode === 'hang' }; this.mode = 'air'; this.vel.copy(vel); if (this.hold && this.hold.vine) this.hold.vine.held = false; this.hold = null; }
  drop() { if (this.hold && this.hold.vine) this.hold.vine.held = false; if (this.rope) this.rope.grabbed = false; this.mode = null; this.hold = null; this.prompt = null; }
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
    this.cool = Math.max(0, this.cool - dt); P.jumpedNow = false;
    this.scan(false);
    const cam = g.camera; cam.getWorldDirection(_d); const fwd = _d.setY(0).normalize().clone(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const iz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), ix = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    // Hanging, the stick means a direction in the world, fixed when the thumb goes down, until it lifts. It used to be read against the
    // camera every frame, and the camera follows the way he faces, which follows the swing: so pushing a little to one side turned the
    // swing, which turned the camera, which turned what "to one side" meant, and he went round and round. Caught at speed with the
    // stick already forward, forward is the way he was flying: the swing carries the jump on.
    if (this.mode === 'hang' || this.mode === 'rope') {
      if ((iz !== 0 || ix !== 0) && !this.pushF) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        this.pushF = sp > 2 && iz > 0 ? new THREE.Vector3(this.vel.x / sp, 0, this.vel.z / sp) : fwd.clone();
        this.pushR = new THREE.Vector3(-this.pushF.z, 0, this.pushF.x);
      } else if (iz === 0 && ix === 0) this.pushF = null;
      if (this.pushF) { fwd.copy(this.pushF); right.copy(this.pushR); }
    } else this.pushF = null;
    const pose = this.pose; pose.mode = this.mode; pose.vel.copy(this.vel); this.prompt = null;
    this.heldT = this.mode === 'hang' ? this.heldT + dt : 0;
    // the stick, as his legs take it: where he is throwing his weight on a rope or a root (Shift is the hands climbing, and the legs follow those)
    { const on = (this.mode === 'hang' || this.mode === 'rope') && !k.ShiftLeft && (iz !== 0 || ix !== 0), s = Math.min(1, dt * 7);
      if (on) { _e.copy(fwd).multiplyScalar(iz).addScaledVector(right, ix).normalize(); pose.steer.lerp(_e, s); } else pose.steer.multiplyScalar(1 - s);
      pose.free += ((on && this.mode === 'rope' ? 1 : 0) - pose.free) * s; }
    const hold = this.mode === 'air' ? this.wantGrab(input, dt) : !!k.Space;
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
    if (!P.camUserT) P.yaw = P.lerpAngle(P.yaw, this.pose.yaw + (this.mode === 'limb' ? 0.7 : 0), Math.min(1, dt * (this.mode === 'trunk' || this.mode === 'rope' ? 2.5 : 1.4)));
    // tiring: hanging and climbing cost stamina; standing on a limb rests you; spent, you fall
    if (this.mode === 'hang' || this.mode === 'trunk' || this.mode === 'rope') { P.stamina -= 2.2 * dt; if (P.stamina <= 0) { g.ui.toast('Arms gave out'); this.toAir(this.vel); this.cool = 1.2; } }
    else if (this.mode === 'limb') P.stamina = Math.min(100, P.stamina + 12 * dt);
  }
  // where a hand or foot goes on the wood: on the surface at height y, `lat` metres round from straight in front of him
  onWood(T, y, out, side, lat, stand, res) {
    trunkAt(T.spine, Math.min(y, T.top), _bq);
    const a = lat / Math.max(0.2, _bq.r), r = _bq.r + stand;
    return res.copy(_bq.point).add(this.off).addScaledVector(out, r * Math.cos(a)).addScaledVector(side, r * Math.sin(a));
  }
  updateTrunk(dt, input, iz, ix, right) {
    const P = this.P, T = this.tree, p = P.pos, pz = this.pose, S = T.spine;
    const sprint = this.g.input.keys.ShiftLeft, vUp = iz * (sprint ? 2.6 : 1.7), y0 = this.gy;
    let q = trunkAt(S, this.gy, this._q);
    this.gy = clamp(this.gy + vUp * dt, groundHeight(q.point.x, q.point.z) + HANDS, T.top - 0.05);
    const risen = this.gy - y0;
    if (this.gy >= T.top - 0.06 && !this.topped) { this.topped = true; this.g.emit('treetop', { tree: T }); }
    if (this.gy < T.top - 1) this.topped = false;
    const tan = _a.set(-Math.sin(this.th), 0, Math.cos(this.th));
    this.th += ix * dt * 1.8 / (q.r + 0.32) * Math.sign(right.dot(tan) || 1);
    q = trunkAt(S, this.gy, this._q);
    const out = _b.set(Math.cos(this.th), 0, Math.sin(this.th)), side = _d.set(-out.z, 0, out.x);
    // climbing is a gait, driven by the height gained (so it runs backward coming down), and by the steps round
    pz.phase += risen / STRIDE + Math.abs(ix) * dt * 0.9;
    const g1 = gait(pz.phase, _g1), g2 = gait(pz.phase + 0.5, _g2);
    const prev = _c.copy(p);
    p.copy(q.point).add(this.off).addScaledVector(out, q.r + 0.34); p.y = this.gy - HANDS + 0.025 * Math.sin(pz.phase * Math.PI * 4);   // a heave with each pull
    this.vel.subVectors(p, prev).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 4);   // no spike from the snap onto the bark
    pz.yaw = Math.atan2(out.x, out.z);       // facing the wood (bodyYaw convention: forward is -Z rotated by yaw)
    P.bodyYaw = pz.yaw;
    pz.trunkC.copy(q.point); pz.trunkR = q.r; pz.up.set(0, 1, 0);
    pz.out.copy(out); pz.side.copy(side);
    // on his right as he faces the wood is -side. Hands and feet hold still on the bark, each reaching up in turn; the
    // right hand goes with the left foot.
    const hY = p.y + 1.36, fY = p.y + 0.3;
    this.onWood(T, hY + g1.y * GAIT, out, side, -0.17, 0.035 + g1.lift * 0.09, pz.gripR);
    this.onWood(T, hY + g2.y * GAIT, out, side, 0.17, 0.035 + g2.lift * 0.09, pz.gripL);
    this.onWood(T, fY + g1.y * GAIT, out, side, 0.11, 0.04 + g1.lift * 0.07, pz.footL);
    this.onWood(T, fY + g2.y * GAIT, out, side, -0.11, 0.04 + g2.lift * 0.07, pz.footR);
    // the hands: fingers up the bark, palms flat on it, thumbs toward each other
    const inn = _e.copy(out).negate();
    pz.fingersR.set(0, 0.9, 0).addScaledVector(inn, 0.45); pz.fingersL.copy(pz.fingersR);
    pz.thumbR.copy(side); pz.thumbL.copy(side).negate();
    pz.open = q.r > 0.14 ? 0.8 : 0.25;   // flat on a trunk, closed on a thin stem
    if (iz !== 0 && Math.random() < dt * 3) this.g.audio.impact('wood', p, 0.18);
    // leap off backward, out and up
    if (input.pressed('Space')) { this.toAir(_c.copy(out).multiplyScalar(4.2).setY(4.6)); this.cool = 0.25; P.stamina -= 4; return; }
    // a limb beside him at this height, on this side of the tree: E steps out onto it. (W always carries on climbing, to
    // the very top of the tree.)
    let L = null;
    for (const C of T.limbs) {
      if (C.r[0] < 0.1) continue;
      const b = C.pts[0], d1 = C.pts[Math.min(2, C.pts.length - 1)];
      if (Math.abs(b.y - (p.y + 0.3)) > 1.1 || Math.hypot(b.x - q.point.x, b.z - q.point.z) > q.r + 1) continue;
      const ldir = _f.subVectors(d1, b).setY(0); if (ldir.lengthSq() < 0.01) continue; ldir.normalize();
      if (ldir.dot(out) > 0.5) { L = C; break; }
    }
    if (L) {
      this.prompt = 'Step out onto the branch';
      if (input.pressed('KeyE')) { this.startLimb(T, L, 0.5, 1); return; }
    }
    // down at the foot of the tree
    if (iz < 0 && p.y <= groundHeight(p.x, p.z) + 0.05) { this.drop(); P.vel.set(out.x * 1.5, 0, out.z * 1.5); P.onGround = true; }
  }
  // on a banyan's aerial root, as on a liana, two separate things: Shift+W/S climbs hand over hand (Shift+A/D goes round
  // it); plain WASD throws his weight, and the root swings the way he pushes
  updateRope(dt, input, iz, ix, fwd, right) {
    const P = this.P, V = this.rope, T = this.tree, p = P.pos, pz = this.pose;
    const shift = !!this.g.input.keys.ShiftLeft, climb = shift ? iz : 0, round = shift ? ix : 0, vUp = climb * 1.6, ra0 = this.ra;
    const dir = _a.subVectors(V.b, V.a).divideScalar(V.len);   // down the root
    // the hands never pass the top, and the feet never go below the ground at the root's foot
    const foot = groundHeight(V.b.x, V.b.z);
    const maxA = Math.max(0.45, dir.y < -0.2 ? Math.min(V.len, (V.a.y - foot - HANDS) / -dir.y) : V.len);
    this.ra = clamp(this.ra - vUp * dt, 0.45, maxA);
    const grip = _b.copy(V.a).addScaledVector(dir, this.ra);
    // the root itself, bowed by wind and by him; his weight drags on it, and his throws swing it
    const ropes = this.g.ropes;
    if (ropes) {
      if (ropes.sample(V, this.ra, _f)) grip.copy(_f);
      const push = _e.set(0, 0, 0); if (!shift) { push.addScaledVector(fwd, iz).addScaledVector(right, ix); if (push.lengthSq() > 0) push.normalize().multiplyScalar(26); }
      ropes.pull(V, this.ra, -Math.cos(this.th) * 2.5 + push.x, -5.9, -Math.sin(this.th) * 2.5 + push.z, dt);
    }
    const tan = _c.set(-Math.sin(this.th), 0, Math.cos(this.th));
    this.th += round * dt * 2.2 / (V.r + 0.3) * Math.sign(right.dot(tan) || 1);
    const out = _c.set(Math.cos(this.th), 0, Math.sin(this.th)), side = _d.set(-out.z, 0, out.x);
    pz.phase += (ra0 - this.ra) / STRIDE + Math.abs(round) * dt * 0.9;
    const g1 = gait(pz.phase, _g1), g2 = gait(pz.phase + 0.5, _g2);
    const prev = _g.copy(p);
    p.copy(grip).addScaledVector(out, V.r + 0.3); p.y = grip.y - HANDS + (climb !== 0 ? 0.025 * Math.sin(pz.phase * Math.PI * 4) : 0);
    this.vel.subVectors(p, prev).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 9);   // (leaping off keeps the swing)
    pz.mode = 'trunk';
    pz.yaw = Math.atan2(out.x, out.z); P.bodyYaw = pz.yaw;
    pz.trunkC.copy(grip); pz.trunkR = V.r; pz.up.set(0, 1, 0);
    pz.out.copy(out); pz.side.copy(side);
    // fists one above the other, thumbs up, as you hold a pole; the feet grip it from either side, in turn with the hands
    const place = (res, along, lat, off) => { const s = clamp(along, 0.2, V.len); if (!ropes || !ropes.sample(V, s, res)) res.copy(V.a).addScaledVector(dir, s); res.addScaledVector(out, V.r + off).addScaledVector(side, lat); };
    const rel = (h) => this.ra + HANDS - h;   // metres down the root, h above his feet
    place(pz.gripR, rel(1.36 + g1.y * GAIT), -0.04, 0.03 + g1.lift * 0.08);
    place(pz.gripL, rel(1.36 + g2.y * GAIT), 0.04, 0.03 + g2.lift * 0.08);
    place(pz.footL, rel(0.32 + g1.y * GAIT), 0.07, 0.02 + g1.lift * 0.06);
    place(pz.footR, rel(0.32 + g2.y * GAIT), -0.07, 0.02 + g2.lift * 0.06);
    const inn = _e.copy(out).negate();
    pz.fingersR.copy(inn).multiplyScalar(0.9).addScaledVector(side, 0.45); pz.fingersL.copy(inn).multiplyScalar(0.9).addScaledVector(side, -0.45);
    pz.thumbR.set(0, 1, 0); pz.thumbL.set(0, 1, 0); pz.open = 0;
    if (climb !== 0 && Math.random() < dt * 2.5) this.g.audio.impact('wood', p, 0.12);
    if (input.pressed('Space')) { this.toAir(_f.copy(out).multiplyScalar(4.2).setY(4.6).addScaledVector(this.vel, 0.8)); this.cool = 0.25; P.stamina -= 4; return; }
    if (input.pressed('KeyC')) { this.toAir(_f.copy(out).multiplyScalar(1.2).addScaledVector(this.vel, 0.6)); this.cool = 0.5; return; }
    // at the top: out onto the limb the root hangs from, facing the way the camera looks
    if (climb > 0 && this.ra <= 0.46 && V.limb) {
      const q = closestOn(V.limb, V.a, {});
      if (q.r > 0.09 && q.d < 1.6) { this.startLimb(T, V.limb, this.sOn(V.limb, q), q.dir.dot(fwd) >= 0 ? 1 : -1); p.copy(q.point); p.y += q.r; return; }
    }
    // at the foot: back on the ground
    if (climb < 0 && this.ra >= maxA - 0.01) { this.drop(); p.y = Math.max(p.y, groundHeight(p.x, p.z)); P.vel.set(out.x * 1.5, 0, out.z * 1.5); P.onGround = true; }
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
    p.copy(q.point).add(this.off); p.y += q.r;
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
    if (h.kind === 'vine') h.pivot.copy(h.vine.a).add(this.off); else h.pivot.copy(h.point).add(this.off);
    // pendulum: gravity, the player's push, light air drag, and the arm holding the length
    v.y -= GRAV * dt;
    if (h.kind === 'vine' && this.g.input.keys.ShiftLeft && iz !== 0) {
      // Shift+W/S: hand over hand up or down the liana; the swing settles while he climbs
      h.along = clamp(h.along - iz * 1.3 * dt, 0.3, h.vine.len - 0.15); h.len = h.len0 = h.along + ARM;
      v.multiplyScalar(1 - Math.min(1, 1.6 * dt));
      this.pose.phase += 1.3 * iz * dt / STRIDE;
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
    // Where the rope lets him go this frame, then through the physics world with his whole body along it: a swing into a
    // trunk, a limb, a rock or a wall stops there and slides along it, and the rope only ever pulls him along a clear
    // path, so nothing can drag him through. Feet down on the ground or on top of a rock, he stands.
    const vy0 = v.y, n0 = _a.subVectors(p, h.pivot); if (n0.lengthSq() < 1e-4) n0.set(0, -1, 0); n0.normalize();
    const step = _b.copy(p).addScaledVector(v, dt).sub(h.pivot); if (step.lengthSq() < 1e-4) step.set(0, -1, 0); step.normalize();
    if (step.y > 0.35) { step.y = 0.35; step.normalize(); }   // the swing never goes over the top of the hold
    step.multiplyScalar(h.len).add(h.pivot).sub(p);
    const up0 = _e.copy(n0).negate(), hit = this.moveBody(p, v, step, up0, h.kind === 'vine' ? h.vine.limb : h.limb);
    const fast = Math.hypot(v.x, v.z) > 1.3;
    if (hit && hit.ny > 0.6 && vy0 < 0.5 && !fast) { this.land(vy0); return; }
    // feet down on the ground (or a rock) while the swing is going: he tucks his legs up and the swing runs on
    // shorter, letting the legs down again once clear
    if (hit && hit.ny > 0.6) { h.len = Math.max(ARM * 0.7, Math.min(h.len, p.distanceTo(h.pivot) - 0.05)); v.y = Math.max(v.y, 0); }
    else if (h.len < h.len0) h.len = Math.min(h.len0, h.len + 0.9 * dt);
    const n = _a.subVectors(p, h.pivot); const d = n.length() || 1; n.multiplyScalar(1 / d);
    // the rope only pulls: held taut he stays on the circle; pressed in against something it goes slack
    if (d >= h.len - 0.015) { p.copy(h.pivot).addScaledVector(n, h.len); v.addScaledVector(n, -v.dot(n)); }
    // the hands: on the branch either side of the grip, or on the liana an arm's length above the body
    const grip = h.kind === 'vine' ? _b.copy(p).addScaledVector(n, -ARM) : h.pivot;
    const side = _c.set(-n.z, 0, n.x).normalize();
    if (h.kind === 'branch') side.copy(h.dir).setY(0).normalize();
    this.pose.gripR.copy(grip).addScaledVector(side, 0.11); this.pose.gripL.copy(grip).addScaledVector(side, -0.11);
    this.pose.up.copy(n).negate();
    // how the hands sit: over the top of a branch, palms forward; on a liana, fists round it
    { const pz = this.pose, fw = _f.set(-Math.sin(pz.yaw), 0, -Math.cos(pz.yaw));
      pz.open = 0;
      pz.fingersR.copy(pz.up).multiplyScalar(0.8).addScaledVector(fw, 0.6); pz.fingersL.copy(pz.fingersR);
      if (h.kind === 'branch') { pz.thumbR.copy(side).multiplyScalar(-Math.sign(side.dot(_g.set(-fw.z, 0, fw.x))) || -1); pz.thumbL.copy(pz.thumbR).negate(); }
      else { pz.thumbR.copy(pz.up); pz.thumbL.copy(pz.up); } }
    // climbing the liana: one hand above the other, taking turns, the legs drawing up by turns with them
    this.pose.climbing = 0;
    if (h.kind === 'vine' && this.g.input.keys.ShiftLeft && iz !== 0) { const g1 = gait(this.pose.phase, _g1), g2 = gait(this.pose.phase + 0.5, _g2); this.pose.gripR.addScaledVector(n, -0.1 - g1.y * 0.2); this.pose.gripL.addScaledVector(n, -0.1 - g2.y * 0.2); this.pose.climbing = 1; this.pose.legL = 0.5 + 0.5 * g1.y; this.pose.legR = 0.5 + 0.5 * g2.y; }
    // facing: along the swing, but he does not turn round at each end of it (swinging back he goes backwards,
    // as on a playground swing), so the camera behind him stays steady too
    const hv = _d.set(v.x, 0, v.z);
    if (hv.lengthSq() > 2.5) {   // (near the ends of the swing, where it hangs still, the facing holds)
      hv.normalize();
      if (hv.x * -Math.sin(this.pose.yaw) + hv.z * -Math.cos(this.pose.yaw) < 0) hv.negate();
      this.pose.yaw = P.lerpAngle(this.pose.yaw, Math.atan2(-hv.x, -hv.z), Math.min(1, dt * 3));
    }
    P.bodyYaw = this.pose.yaw;
    if (h.kind === 'vine') { h.vine.hand = (h.vine.hand || new THREE.Vector3()).copy(grip); h.vine.holdS = h.along; }
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
    if (h.kind === 'branch' && h.r > 0.09) this.prompt = v.length() < 2.5 ? 'Pull yourself up onto the branch' : null;
    // let go, with a tap: fly on with a lift (the release hop of vine-swinging games)
    if (input.pressed('Space') && this.heldT > 0.12) {
      const sp = v.length();
      const boost = _c.copy(v).multiplyScalar(sp > 0.5 ? 0.9 / sp : 0).setY(2.4);
      this.toAir(_d.copy(v).add(boost)); this.cool = 0.22;
    }
  }
  // Move his body by `step` through the physics world, sliding along whatever it meets: on a hit he stops at the
  // surface, loses the speed going into it (with a small bounce) and carries on along it with what is left of the
  // step. `up` runs from the feet toward the hands. Returns the last hit (with its normal) or null.
  moveBody(p, v, step, up, ignore) {
    const ph = this.g.phys;
    if (!ph) { p.add(step); return null; }
    let last = null;
    for (let i = 0; i < 3; i++) {
      const l = step.length(); if (l < 1e-5) break;
      const h = ph.sweepBody(p, up, step, ignore);
      if (!h) { p.add(step); break; }
      last = h;
      const t = Math.max(0, h.t - 0.012 / l);
      p.addScaledVector(step, t);
      step.multiplyScalar(1 - t);
      const sn = step.x * h.nx + step.y * h.ny + step.z * h.nz; if (sn < 0) { step.x -= h.nx * sn; step.y -= h.ny * sn; step.z -= h.nz * sn; }
      const vn = v.x * h.nx + v.y * h.ny + v.z * h.nz;
      if (vn < 0) {
        const e = h.ny > 0.6 ? 1 : 1.2;
        v.x -= h.nx * vn * e; v.y -= h.ny * vn * e; v.z -= h.nz * vn * e;
        if (vn < -2.5 && h.ny < 0.6) { this.g.audio.impact('wood', p, Math.min(1, -vn / 8)); if (vn < -9) this.P.hurt((-vn - 9) * 4, null, { kind: 'fall' }); }
      }
    }
    return last;
  }
  sweep(p, v, dt, up) { return this.moveBody(p, v, _h.copy(v).multiplyScalar(dt), up, null); }
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
    const vy0 = v.y, hit = this.sweep(p, v, dt, _up);
    // came down on top of something that is not a limb (a rock, a roof, the tower deck, the ground): stand there
    if (hit && hit.ny > 0.6 && vy0 <= 0.5 && !this.limbUnder(p)) { this.land(vy0); return; }
    const hv = _d.set(v.x, 0, v.z); if (hv.lengthSq() > 0.25) { this.pose.yaw = Math.atan2(-hv.x, -hv.z); P.bodyYaw = this.pose.yaw; }
    this.pose.up.set(0, 1, 0);
    // land on a limb
    if (v.y < 0) for (const T of this.trees) for (const L of T.limbs) {
      const q = closestOn(L, p, {});
      if (q.r > 0.1 && q.d < q.r + 0.3 && p.y > q.point.y && p.y < q.point.y + q.r + 0.35 && Math.abs(q.dir.y) < 0.6) {
        this.startLimb(T, L, this.sOn(L, q), 1); p.copy(q.point); p.y += q.r;
        this.kickLimb(L, v.x * 0.08, v.y * 0.14, v.z * 0.08);   // the limb gives under the landing
        this.g.audio.footstep('rock', 0.8, null, 0.4); return;
      }
    }
    if (hold && this.tryGrab(v)) return;
    const gy = groundHeight(p.x, p.z);
    if (p.y <= gy) { p.y = gy; this.land(v.y); }
  }
}

// An animal's mind: what it does that instinct alone would not.
//
// Three things decide what an animal is doing, in this order:
//   1. the story    a directive from the director: lead him there, wait here, guard him, prowl round him, play
//   2. the world    rain, heat, cold, the hour, a big cat about (world.danger): shelter, bunch up, go quiet
//   3. the player   how he has treated its kind (world.rep) and this one animal (its bond): how near he may
//                   come, whether it comes to look at him, whether it goes on feeding beside him
// Anything this leaves undecided falls through to the animal's instincts (js/actors/animals.js): graze, drink,
// rest, alarm, flee, stalk, charge. Instinct always wins a fright: a directive never holds an animal in front of
// something it is running from, unless the directive says so (brave).
import { clamp, lerp } from '../core/noise.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
// kinds that can come to trust him
const GENTLE = new Set(['prey', 'bird', 'arboreal', 'livestock', 'village']);
const WARY_BIG = new Set(['defensive', 'neutral']);

export class Mind {
  constructor(a) {
    this.a = a;
    this.dir = null;            // the story's directive
    this.mode = null;           // what the world or the player has it doing: 'shelter' | 'curious'
    this.goal = { x: 0, z: 0 }; this.modeT = 0; this.cd = rnd(4, 14);
    this.emote = null; this.emoteT = 0;
    this.wag = 0; this.tilt = 0; this.sniff = 0;   // small gestures the body shows (see animateRig)
  }
  // ------------------------------------------------------------------ the story
  direct(d) { this.dir = d ? { t: 0, ...d } : null; this.mode = null; const a = this.a; a.lookAt = null; a.crouch = 0; if (!d) { a.anim.sit = 0; a.anim.lie = 0; } }
  release() { this.direct(null); }
  show(kind, sec = 2.2) { this.emote = kind; this.emoteT = sec; }
  // it has just "said" something: turn to him
  spoke(p) { this.a.lookAt = p; this.lookT = 2.5; this.show('talk', 1.6); }
  // how near he can come before it bolts
  flightDist(W) {
    const a = this.a, S = W.sim || {}, rep = (S.rep && S.rep[a.sp]) || 0;
    const trust = clamp(a.bond + Math.max(0, rep) * 0.5, 0, 1);
    // (the forest's own ease counts too: after an alarm everything is jumpier for a while, whoever he is)
    return Math.max(3.5, 45 * (1 - 0.8 * trust) * (1 + (S.danger || 0) * 0.35 + (1 - (S.calm ?? 1)) * 0.3) * (rep < 0 ? 1 - rep * 0.5 : 1));
  }
  // What should show over its head. A directive or a gesture says so itself; otherwise the state it is in.
  face() {
    const a = this.a;
    if (this.emoteT > 0) return this.emote;
    if (a.routed || a.state === 'flee') return 'sweat';
    if (a.state === 'warn' || a.state === 'charge' || a.state === 'attack' || a.state === 'stalk') return a.companion ? null : 'anger';
    if (a.state === 'alert' && a.stateT < 2) return 'alert';
    if (this.mode === 'curious') return 'ask';
    if ((a.state === 'rest' || a.anim.lie > 0.6) && a.stateT > 5) return 'sleep';
    return null;
  }
  // ------------------------------------------------------------------ each think
  // true: the mind has decided what it does this tick. false: over to instinct.
  think(dt, W) {
    const a = this.a;
    if (this.emoteT > 0) this.emoteT -= dt;
    if (this.lookT > 0) { this.lookT -= dt; if (this.lookT <= 0 && !this.dir) a.lookAt = null; }
    this.wag = lerp(this.wag, 0, Math.min(1, dt * 0.6)); this.tilt = lerp(this.tilt, 0, Math.min(1, dt * 0.8)); this.sniff = lerp(this.sniff, 0, Math.min(1, dt * 1.5));
    if (this.dir) return this.follow(dt, W);
    if (a.companion) return false;
    return this.social(dt, W);
  }
  // ------------------------------------------------------------------ directives
  follow(dt, W) {
    const a = this.a, d = this.dir, P = W.player, A = a.anim; d.t += dt;
    const scared = a.state === 'flee' || a.state === 'alert';
    if (scared && !d.brave && !a.companion) return false;
    // a companion drops what it was told to do while something is going for him, unless told to keep out of it
    if (a.companion && !d.calm && W.threatToPlayer && W.threatToPlayer(a) && a.hp > a.maxHp * 0.25 && !(a.winded > 0)) { A.sit = lerp(A.sit, 0, dt * 6); A.lie = lerp(A.lie, 0, dt * 6); return false; }
    if (a.winded > 0) return false;
    const dp = Math.sqrt(a.dist2(P.pos));
    const settle = (sit, lie) => { A.sit = lerp(A.sit, sit, Math.min(1, dt * 3)); A.lie = lerp(A.lie, lie, Math.min(1, dt * 2)); A.graze = lerp(A.graze, 0, Math.min(1, dt * 4)); };
    switch (d.type) {
      // go ahead of him to a place, and wait for him whenever he falls behind
      case 'lead': {
        const dg = Math.hypot(d.to.x - a.pos.x, d.to.z - a.pos.z);
        if (dg < (d.r || 3.5)) {
          a.targetSpeed = 0; a.faceTowards(P.pos, dt * 3); a.lookAt = P.pos; settle(dp > 5 ? 1 : 0, 0);
          if (dp < (d.near || 8) && !d.arrived) { d.arrived = true; this.wag = 1; if (d.onArrive) d.onArrive(a); }
          return true;
        }
        settle(0, 0);
        if (dp > (d.leash || 14)) {
          // he isn't coming: stop, look back, call; come back for him if he has gone a long way off
          a.lookAt = P.pos;
          if (dp > 40) a.steer(P.pos.x, P.pos.z, a.d.trot * 1.2, dt, W);
          else { a.targetSpeed = 0; a.faceTowards(P.pos, dt * 4); }
          d.callT = (d.callT ?? 1.5) - dt;
          if (d.callT <= 0) { d.callT = rnd(5, 8); this.show('come', 2.4); this.wag = 0.6; W.audio.animal(a.d.voice, a.d.voice === 'wolf' ? 'whine' : a.d.voice === 'langur' ? 'whoop' : 'call', a.pos); if (d.onWait) d.onWait(a); }
          return true;
        }
        a.lookAt = null;
        // a little faster than he is going, so it stays in front; never so fast it leaves him
        const sp = clamp(P.speed * 1.08 + (dp < 5 ? 1.4 : 0.3), a.d.walk * 1.2, a.d.run * 0.75);
        a.steer(d.to.x, d.to.z, sp, dt, W);
        return true;
      }
      // go to a spot and sit there (stay: sit where it is)
      case 'wait': case 'stay': case 'rest': {
        const at = d.at || (d.at = a.pos.clone());
        const dg = Math.hypot(at.x - a.pos.x, at.z - a.pos.z);
        if (dg > 1.4 && !d.there) { settle(0, 0); a.steer(at.x, at.z, dg > 12 ? a.d.trot * 1.2 : a.d.walk * 1.4, dt, W); return true; }
        d.there = true; a.targetSpeed = 0;
        const f = d.face === 'player' || !d.face ? P.pos : d.face;
        if (d.type !== 'rest' || d.t < 3) a.faceTowards(f, dt * 2.5);
        a.lookAt = d.type === 'rest' ? null : f;
        settle(d.type === 'rest' ? 0 : 1, d.type === 'rest' ? 1 : 0);
        return true;
      }
      // stand and look at something: the fawn's mother at the treeline, the pack on the far bank
      case 'watch': {
        a.targetSpeed = 0; const f = d.at || P.pos; a.faceTowards(f, dt * 2.5); a.lookAt = f; settle(0, 0);
        if (d.keep && dp < d.keep) { a.threat = P.pos.clone(); this.dir = null; a.setState('flee', 8); }
        return true;
      }
      // walk somewhere, then do what comes next
      case 'goto': {
        const dg = Math.hypot(d.to.x - a.pos.x, d.to.z - a.pos.z);
        settle(0, 0); a.lookAt = null;
        const sp = d.speed === 'run' ? a.d.run * 0.85 : d.speed === 'walk' ? a.d.walk * 1.3 : a.d.trot * 1.2;
        if (dg > (d.r || 2)) { a.steer(d.to.x, d.to.z, sp, dt, W); return true; }
        a.targetSpeed = 0; const then = d.then; this.dir = null;
        if (typeof then === 'function') then(a); else if (then) this.direct(then);
        return true;
      }
      // between him and what threatens him, facing it, hackles up
      case 'guard': {
        const th = d.from && d.from.pos ? d.from.pos : d.from; if (!th) { this.dir = null; return false; }
        const who = d.who || P.pos, dx = th.x - who.x, dz = th.z - who.z, l = Math.hypot(dx, dz) || 1, k = Math.min(3.2, l * 0.4);
        const gx = who.x + dx / l * k, gz = who.z + dz / l * k, dg = Math.hypot(gx - a.pos.x, gz - a.pos.z);
        settle(0, 0);
        if (dg > 1.2) a.steer(gx, gz, a.d.trot * 1.4, dt, W); else { a.targetSpeed = 0; a.faceTowards(th, dt * 4); }
        a.lookAt = th; a.anim.alertTail = 1;
        d.callT = (d.callT ?? 1) - dt; if (d.callT <= 0) { d.callT = rnd(3, 5); W.audio.animal(a.d.voice, 'snarl', a.pos); this.show('anger', 1.4); }
        return true;
      }
      // a big cat that has not made up its mind: round him at a distance, low, never looking away
      case 'prowl': {
        const c = d.around || P.pos, R = d.r || 16; d.ang = (d.ang ?? Math.atan2(a.pos.x - c.x, a.pos.z - c.z)) + dt * (d.rate || 0.12) * (d.side || 1);
        const gx = c.x + Math.sin(d.ang) * R, gz = c.z + Math.cos(d.ang) * R;
        a.crouch = 1; a.steer(gx, gz, a.d.walk * 1.5, dt, W); a.lookAt = c;
        d.callT = (d.callT ?? 3) - dt; if (d.callT <= 0) { d.callT = rnd(6, 10); W.audio.animal(a.d.voice, 'growl', a.pos); }
        return true;
      }
      // a youngster with too much energy: dash, stop, look back, dash
      case 'play': {
        const c = d.around || P.pos; d.hopT = (d.hopT ?? 0) - dt;
        if (d.hopT <= 0) { d.hopT = rnd(1.6, 3.4); const an = Math.random() * TAU, r = rnd(2.5, 6); d.gx = c.x + Math.sin(an) * r; d.gz = c.z + Math.cos(an) * r; d.pause = Math.random() < 0.4; this.wag = 1; }
        const dg = Math.hypot(d.gx - a.pos.x, d.gz - a.pos.z);
        settle(0, 0);
        if (dg > 0.8 && !d.pause) a.steer(d.gx, d.gz, a.d.trot * 1.5, dt, W);
        else { a.targetSpeed = 0; a.faceTowards(c, dt * 5); a.lookAt = c; this.sniff = d.pause ? 0 : this.sniff; this.wag = Math.max(this.wag, 0.7); this.bow = 1; }
        return true;
      }
      default: return false;
    }
  }
  // ------------------------------------------------------------------ the world and the player
  social(dt, W) {
    const a = this.a, k = a.d.kind, S = W.sim || {};
    if (!GENTLE.has(k) && !WARY_BIG.has(k)) return false;
    const calmState = a.state === 'idle' || a.state === 'graze' || a.state === 'wander' || a.state === 'rest' || a.state === 'drink';
    if (!calmState || a.tm || a.perch || a.hop) { this.mode = null; return false; }
    const P = W.player, pd = Math.sqrt(a.dist2(P.pos));
    // ---- shelter: heavy rain sends the deer under the trees, heads down, until it eases
    if (this.mode === 'shelter') {
      if ((S.rain || 0) < 0.3 || a.awareness > 1.1) { this.mode = null; a.headLow = 0; return false; }
      const dg = Math.hypot(this.goal.x - a.pos.x, this.goal.z - a.pos.z);
      a.anim.graze = lerp(a.anim.graze, 0, dt * 4); a.anim.lie = lerp(a.anim.lie, 0, dt * 3);
      if (dg > 1.6) a.steer(this.goal.x, this.goal.z, a.d.trot, dt, W); else { a.targetSpeed = 0; a.headLow = 1; }
      return true;
    }
    // ---- curious: one that trusts him comes a few steps to look, if he keeps low or still
    if (this.mode === 'curious') {
      this.modeT -= dt;
      const still = P.speed < 2.2 && !P.sprinting;
      if (this.modeT <= 0 || !still || pd > 30) { this.mode = null; a.lookAt = null; if (!still && pd < 9) { a.threat = P.pos.clone(); a.setState('alert', 0.5); } else a.setState('idle', rnd(2, 5)); return false; }
      a.lookAt = P.pos; a.anim.graze = lerp(a.anim.graze, 0, dt * 4); a.anim.lie = lerp(a.anim.lie, 0, dt * 3);
      const stop = lerp(8, 2.6, clamp(a.bond, 0, 1));
      if (pd > stop + 0.5) a.steer(P.pos.x, P.pos.z, a.d.walk * 0.9, dt, W);
      else { a.targetSpeed = 0; a.faceTowards(P.pos, dt * 2); this.sniff = 1; if (!this.met && a.bond > 0.6) { this.met = true; this.show('heart', 2.5); if (W.onGreet) W.onGreet(a); } }
      return true;
    }
    this.cd -= dt;
    if (this.cd > 0) return false;
    this.cd = rnd(2, 5);
    if ((S.rain || 0) > 0.65 && (k === 'prey' || k === 'livestock') && W.nearestShade) {
      const t = W.nearestShade(a.pos, 34);
      if (t) { const an = Math.random() * TAU, r = (t.r || 0.5) + rnd(1, 2.4); this.goal.x = t.x + Math.cos(an) * r; this.goal.z = t.z + Math.sin(an) * r; this.mode = 'shelter'; return true; }
    }
    const rep = (S.rep && S.rep[a.sp]) || 0, trust = a.bond + Math.max(0, rep) * 0.4;
    if (trust > 0.3 && pd > 4 && pd < 22 && P.speed < 1.6 && (P.crouch || P.speed < 0.3) && !P.armedThreat && (S.danger || 0) < 0.4 && (S.calm ?? 1) > 0.6 && Math.random() < 0.3 + trust * 0.4) {
      this.mode = 'curious'; this.modeT = rnd(6, 11); this.show('ask', 2);
      return true;
    }
    return false;
  }
}

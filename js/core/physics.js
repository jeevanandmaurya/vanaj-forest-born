// Physics with Rapier (lib/rapier, Apache-2.0): the static world near the player as colliders (the ground as a
// height field per 64 m terrain chunk, tree trunks and stout limbs as capsules from each tree's climb skeleton,
// stones and fallen logs as cylinders, the big props as triangle meshes), Vanaj, the animals and the villagers
// moved by Rapier's kinematic character controller (sliding along obstacles, stepping up small ledges, held to the
// ground on slopes; Vanaj shoves loose stones and sticks as he walks into them), ball sweeps for his swings and
// leaps through the trees, and ray casts for the camera boom and for arrows and spears (which knock loose things).
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { groundHeight, CHUNK } from '../world/terrain.js';

// Rapier's WASM takes 2-3 s to decode and compile: start it first thing while the rest of the world builds
let ready = null;
export function initPhysics() { return ready || (ready = RAPIER.init()); }

const CELL = 1, N = CHUNK / CELL;                     // 1 m height-field cells, 64 per chunk side
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _m = new THREE.Vector3();
const key2 = (x, z) => Math.round(x * 100) * 1e6 + Math.round(z * 100);

export class Physics {
  constructor(game) {
    this.g = game;
    const w = this.world = new RAPIER.World({ x: 0, y: -15, z: 0 });
    this.limbOf = new Map(); this.ground = new Map(); this.groundQ = []; this.trees = new Map(); this.rocks = new Map(); this.actors = new Map();
    this.syncT = 0;
    // Vanaj: steps up 45 cm, holds to the ground over 40 cm drops, climbs slopes to 50°, slides off steeper than 58°
    // (he does not step up onto loose stones and sticks: he shoves them, with the weight of a boy)
    const pc = this.pc = w.createCharacterController(0.02);
    pc.enableAutostep(0.45, 0.2, false); pc.enableSnapToGround(0.4); pc.setMaxSlopeClimbAngle(50 * Math.PI / 180); pc.setMinSlopeSlideAngle(58 * Math.PI / 180); pc.setSlideEnabled(true);
    pc.setApplyImpulsesToDynamicBodies(true); pc.setCharacterMass(45);
    // swimming: no stepping and no holding to the ground (the water holds him up), but the river bed, banks and
    // rocks still stop him
    const sc = this.sc = w.createCharacterController(0.02);
    sc.setSlideEnabled(true); sc.setApplyImpulsesToDynamicBodies(true); sc.setCharacterMass(45);
    const ac = this.ac = w.createCharacterController(0.03);
    ac.enableAutostep(0.5, 0.2, false); ac.enableSnapToGround(0.5); ac.setMaxSlopeClimbAngle(55 * Math.PI / 180); ac.setSlideEnabled(true);
    this.player = this.capsuleBody(0.28, 0.48);   // Vanaj is ~1.52 m
  }
  capsuleBody(radius, half) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const col = this.world.createCollider(RAPIER.ColliderDesc.capsule(half, radius), body);
    return { body, col, radius, half };
  }
  // ------------------------------------------------------------------ the static world near a point
  sync(focus, force = false) {
    this.syncT -= 1;
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    // ground: the 3x3 chunks round the focus, built one per frame (all at once when forced)
    const want = new Map();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) want.set(`${cx + dx},${cz + dz}`, [cx + dx, cz + dz]);
    for (const [k, c] of this.ground) if (!want.has(k)) { this.world.removeCollider(c, false); this.ground.delete(k); }
    this.groundQ = this.groundQ.filter((q) => want.has(q.k));
    for (const [k, [x, z]] of want) if (!this.ground.has(k) && !this.groundQ.some((q) => q.k === k)) this.groundQ.push({ k, x, z });
    let n = force ? 99 : 1;
    while (n-- > 0 && this.groundQ.length) { const q = this.groundQ.shift(); this.buildGround(q.x, q.z, q.k); }
    // trees and stones: re-listed a few times a second
    if (force || this.syncT <= 0) { this.syncT = 20; this.syncTrees(focus); this.syncRocks(); }
  }
  buildGround(cx, cz, k) {
    const H = new Float32Array((N + 1) * (N + 1)), x0 = cx * CHUNK, z0 = cz * CHUNK;
    // rows run along z, columns along x, column-major (checked against ray casts)
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[i + j * (N + 1)] = groundHeight(x0 + j * CELL, z0 + i * CELL);
    const d = RAPIER.ColliderDesc.heightfield(N, N, H, { x: CHUNK, y: 1, z: CHUNK }).setTranslation(x0 + CHUNK / 2, 0, z0 + CHUNK / 2).setFriction(0.8);
    this.ground.set(k, this.world.createCollider(d));
  }
  capsule(A, B, r) {
    _d.subVectors(B, A); const L = _d.length(); if (L < 0.05) return null;
    _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / L)); _m.addVectors(A, B).multiplyScalar(0.5);
    return this.world.createCollider(RAPIER.ColliderDesc.capsule(L / 2, r).setTranslation(_m.x, _m.y, _m.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
  }
  syncTrees(focus) {
    const list = this.g.veg.climbNear(focus.x, focus.z, 42), seen = new Set();
    for (const T of list) {
      const k = key2(T.x, T.z); seen.add(k);
      if (this.trees.has(k)) continue;
      const cols = [];
      const add = (L, every, minR) => { for (let i = 0; i < L.pts.length - 1; i += every) { const j = Math.min(L.pts.length - 1, i + every), r = Math.min(L.r[i], 1.6) * 0.92; if (r < minR) break; const c = this.capsule(L.pts[i], L.pts[j], r); if (c) { cols.push(c); this.limbOf.set(c.handle, L); } } };
      if (T.trunk) add(T.trunk, 2, 0.05);
      for (const L of T.limbs) if (L.r[0] > 0.1) add(L, 2, 0.08);
      this.trees.set(k, cols);
    }
    for (const [k, cols] of this.trees) if (!seen.has(k)) { for (const c of cols) { this.limbOf.delete(c.handle); this.world.removeCollider(c, false); } this.trees.delete(k); }
  }
  // stones and fallen logs (the vegetation's debris list: x, z, radius)
  syncRocks() {
    const R = this.g.veg.rocks, seen = new Set();
    for (let i = 0; i < R.length; i += 3) {
      const x = R[i], z = R[i + 1], r = R[i + 2], k = key2(x, z); seen.add(k);
      if (this.rocks.has(k)) continue;
      const hh = Math.max(0.2, r * 0.45);
      this.rocks.set(k, this.world.createCollider(RAPIER.ColliderDesc.cylinder(hh, r).setTranslation(x, groundHeight(x, z) + hh * 0.5, z)));
    }
    for (const [k, c] of this.rocks) if (!seen.has(k)) { this.world.removeCollider(c, false); this.rocks.delete(k); }
  }
  // props never move: the big ones (houses, the tower and its deck, the den's fallen tree, the shrine) as
  // triangle meshes, everything else on the props' own collision circles as upright cylinders
  buildProps(props) {
    props.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    props.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.ink) return;
      const m = o.material; if (!m || m.transparent || m.alphaTest > 0) return;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingSphere.radius * o.getWorldScale(v).x < 1.2) return;
      const p = g.attributes.position, verts = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z; }
      let idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: p.count }, (_, i) => i);
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx));
    });
    const C = props.colliders;
    for (let i = 0; i < C.length; i += 3) { const x = C[i], z = C[i + 1]; this.world.createCollider(RAPIER.ColliderDesc.cylinder(1.4, C[i + 2]).setTranslation(x, groundHeight(x, z) + 1.2, z)); }
  }
  // ------------------------------------------------------------------ characters
  // Vanaj: feet at `pos`; returns the movement Rapier allows for `delta` and whether he is on the ground
  movePlayer(pos, delta, swim = false) {
    const c = this.player, kc = swim ? this.sc : this.pc;
    c.body.setTranslation({ x: pos.x, y: pos.y + c.half + c.radius + 0.02, z: pos.z }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    kc.computeColliderMovement(c.col, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = kc.computedMovement();
    return { x: m.x, y: m.y, z: m.z, grounded: kc.computedGrounded() };
  }
  // an animal (or villager) near the player: a kinematic capsule the player bumps into, and its own horizontal
  // step slid round trunks, rocks and walls. Returns true when it was blocked.
  moveActor(a, x0, z0) {
    let c = this.actors.get(a);
    if (!c) { const r = Math.max(0.15, (a.radius || 0.3) * 0.7), h = Math.max(0.05, ((a.d ? a.d.H : 1.6) * (a.scale || 1)) * 0.5 - r); c = this.capsuleBody(r, h); this.actors.set(a, c); }
    c.seen = true;
    const p = a.pos, cy = p.y + c.half + c.radius + 0.03;
    if (x0 === undefined) { c.body.setTranslation({ x: p.x, y: cy, z: p.z }, true); return false; }
    const dx = p.x - x0, dz = p.z - z0;
    c.body.setTranslation({ x: x0, y: cy, z: z0 }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    // (animals and villagers step over loose stones and sticks rather than stopping at them)
    this.ac.computeColliderMovement(c.col, { x: dx, y: 0, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, (other) => other !== this.player.col);
    const m = this.ac.computedMovement();
    p.x = x0 + m.x; p.z = z0 + m.z;
    c.body.setTranslation({ x: p.x, y: cy, z: p.z }, true);
    return m.x * m.x + m.z * m.z < (dx * dx + dz * dz) * 0.5 && dx * dx + dz * dz > 1e-6;
  }
  // drop the capsules of actors that died, wandered off or perched in a tree
  pruneActors() {
    for (const [a, c] of this.actors) {
      if (!c.seen || a.dead || a.perch) { this.world.removeRigidBody(c.body); this.actors.delete(a); }
      else c.seen = false;
    }
  }
  // ------------------------------------------------------------------ queries
  // first hit of the static world along a ray (characters ignored): distance, or null
  rayStatic(from, dir, max) {
    const h = this.world.castRay(new RAPIER.Ray(from, dir), max, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    this.lastHit = h ? h.collider : null;
    return h ? h.timeOfImpact : null;
  }
  // the thing the last ray hit, if it is loose (a stone, a stick): knock it along `dir` with `impulse` (N s)
  // at `at`. Returns true when it was loose.
  knock(dir, impulse, at) {
    const c = this.lastHit, b = c && c.parent();
    if (!b || !b.isDynamic()) return false;
    b.applyImpulseAtPoint({ x: dir.x * impulse, y: dir.y * impulse + impulse * 0.3, z: dir.z * impulse }, at, true);
    return true;
  }
  // His body, as a capsule from just above the feet to the chest, swept along `delta` through the static world
  // (characters ignored). `up` runs from the feet toward the hands, so it tilts with a swing; the limb in his hands is
  // left out. The fraction of the way it got (0..1) and the surface normal it met, or null if the way is clear.
  sweepBody(feet, up, delta, ignore) {
    const len = Math.hypot(delta.x, delta.y, delta.z); if (len < 1e-5) return null;
    const R = 0.22, HALF = 0.43, cap = this.bodyCap || (this.bodyCap = new RAPIER.Capsule(HALF, R));
    _q.setFromUnitVectors(_up, up);
    _m.copy(feet).addScaledVector(up, 0.06 + R + HALF);
    const rot = { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, lim = this.limbOf;
    // (starting inside something and moving out of it is not a hit)
    const h = this.world.castShape(_m, rot, delta, cap, 0, 1, false, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, ignore ? (c) => lim.get(c.handle) !== ignore : undefined);
    if (!h) return null;
    // normal2 is in the capsule's own frame: turned into the world, the obstacle pushes back the other way
    _d.set(h.normal2.x, h.normal2.y, h.normal2.z).applyQuaternion(_q);
    return { t: h.time_of_impact, nx: -_d.x, ny: -_d.y, nz: -_d.z };
  }
  // is the ground collider under (x, z) built yet? (loose things wait for it before they get a body)
  hasGround(x, z) { return this.ground.has(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`); }
  step(dt) {
    this.pruneActors();
    this.world.timestep = Math.min(1 / 20, Math.max(1 / 240, dt || 1 / 60));
    this.world.step();
    if (this.debug) this.drawDebug();
  }
  // F4: the colliders as lines
  toggleDebug(scene) {
    this.debug = !this.debug;
    if (!this.lines) { this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, fog: false, depthTest: true })); this.lines.frustumCulled = false; scene.add(this.lines); }
    this.lines.visible = this.debug;
  }
  drawDebug() {
    const b = this.world.debugRender(), c = new Float32Array((b.colors.length / 4) * 3);
    for (let i = 0, j = 0; i < b.colors.length; i += 4, j += 3) { c[j] = b.colors[i]; c[j + 1] = b.colors[i + 1]; c[j + 2] = b.colors[i + 2]; }
    const g = this.lines.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(b.vertices, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
}

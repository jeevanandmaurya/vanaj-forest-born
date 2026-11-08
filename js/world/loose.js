// Loose things on the forest floor: stones and dead sticks that are real Rapier rigid bodies near the player. Vanaj
// shoves them walking into them (the character controller pushes dynamic bodies), they roll and tumble down
// slopes, and arrows and spears knock them about. Each lies where it was left: an item's resting place is kept
// when its body is dropped as the player walks away, and it gets a body again from there when he comes back.
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { groundHeight, waterAt, VILLAGE } from './terrain.js';
import { mulberry32 } from '../core/noise.js';
import { PAINTED } from '../core/palette.js';
import { toon } from '../core/toon.js';

const CELL = 32, LIVE = 26, DROP = 32, SHOW = 48;   // bodies within 26 m, dropped beyond 32, drawn to 48
const MAX_STONE = 140, MAX_STICK = 80;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class LooseThings {
  constructor(scene, phys) {
    this.phys = phys; this.cells = new Map(); this.live = new Set(); this.t = 0;
    // a stone: a squashed icosahedron, its own convex hull as the collider so it tumbles like a stone, not a ball
    const sg = new THREE.IcosahedronGeometry(1, 0); sg.scale(1, 0.62, 0.82);
    this.hull = new Float32Array(sg.attributes.position.array);
    sg.computeVertexNormals();
    const stick = new THREE.CylinderGeometry(1, 1.15, 1, 6, 1);
    const mat = (c) => PAINTED ? toon({ color: c, rim: 0.4, key: 'loose' }) : new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 });
    this.stones = new THREE.InstancedMesh(sg, mat(0x8a8478), MAX_STONE);
    this.sticks = new THREE.InstancedMesh(stick, mat(0x6a5240), MAX_STICK);
    for (const m of [this.stones, this.sticks]) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    // the stones vary a little in colour
    this.stones.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STONE * 3), 3);
  }
  // the items of one cell, made the first time it is seen (the same ones every time: seeded by the cell)
  cell(cx, cz) {
    const k = cx * 100000 + cz;
    let c = this.cells.get(k); if (c) return c;
    c = []; this.cells.set(k, c);
    const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5eed);
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const x = (cx + rng()) * CELL, z = (cz + rng()) * CELL, gy = groundHeight(x, z);
      if (waterAt(x, z) > gy - 0.2 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r * 0.5) { rng(); rng(); rng(); continue; }
      const stick = rng() < 0.4;
      const size = stick ? 0.7 + rng() * 1.1 : 0.07 + rng() * rng() * 0.28, yaw = rng() * 6.283, tone = 0.8 + rng() * 0.35;
      const q = new THREE.Quaternion();
      if (stick) q.setFromEuler(_e.set(0, yaw, Math.PI / 2)); else q.setFromEuler(_e.set(rng() * 0.4, yaw, rng() * 0.4));
      const r = stick ? 0.035 + size * 0.025 : size;
      c.push({ stick, size, r, tone, pos: new THREE.Vector3(x, gy + (stick ? r : size * 0.62) + 0.01, z), q, body: null });
    }
    return c;
  }
  makeBody(it) {
    const w = this.phys.world;
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(it.pos.x, it.pos.y, it.pos.z).setRotation({ x: it.q.x, y: it.q.y, z: it.q.z, w: it.q.w })
      .setLinearDamping(0.15).setAngularDamping(0.6).setCcdEnabled(it.stick === false && it.size < 0.2));
    let d;
    if (it.stick) d = RAPIER.ColliderDesc.capsule(it.size / 2, it.r).setDensity(650);
    else { const v = this.hull.slice(); for (let i = 0; i < v.length; i++) v[i] *= it.size; d = RAPIER.ColliderDesc.convexHull(v).setDensity(2500); }
    w.createCollider(d.setFriction(0.9).setRestitution(0.12), b);
    it.body = b;
  }
  dropBody(it) {
    const t = it.body.translation(), r = it.body.rotation();
    it.pos.set(t.x, t.y, t.z); it.q.set(r.x, r.y, r.z, r.w);
    this.phys.world.removeRigidBody(it.body); it.body = null;
  }
  update(focus) {
    const ph = this.phys;
    // every few frames: which cells are about, which items get a body and which lose theirs
    if (--this.t <= 0) {
      this.t = 15;
      const R = Math.ceil(SHOW / CELL), cx0 = Math.floor(focus.x / CELL), cz0 = Math.floor(focus.z / CELL);
      this.near = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) for (const it of this.cell(cx0 + dx, cz0 + dz)) {
        const d = Math.hypot(it.pos.x - focus.x, it.pos.z - focus.z);
        if (d < SHOW) this.near.push(it);
        if (!it.body && d < LIVE && ph.hasGround(it.pos.x, it.pos.z)) this.makeBody(it);
        else if (it.body && d > DROP) this.dropBody(it);
      }
      // bodies of cells now far off
      for (const c of this.cells.values()) for (const it of c) if (it.body && Math.hypot(it.pos.x - focus.x, it.pos.z - focus.z) > DROP + CELL) this.dropBody(it);
    }
    // draw them where the physics has them
    let ns = 0, nk = 0;
    for (const it of this.near || []) {
      if (it.body) {
        const t = it.body.translation(), r = it.body.rotation();
        it.pos.set(t.x, t.y, t.z); it.q.set(r.x, r.y, r.z, r.w);
        // fell out of the world (a ground chunk went missing under it): back on the ground
        const gy = groundHeight(t.x, t.z);
        if (t.y < gy - 1.5) { it.body.setTranslation({ x: t.x, y: gy + 0.5, z: t.z }, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
      }
      if (it.stick) { if (nk >= MAX_STICK) continue; _s.set(it.r, it.size + it.r * 2, it.r); _m.compose(it.pos, it.q, _s); this.sticks.setMatrixAt(nk++, _m); }
      else {
        if (ns >= MAX_STONE) continue;
        _s.setScalar(it.size); _m.compose(it.pos, it.q, _s); this.stones.setMatrixAt(ns, _m);
        this.stones.instanceColor.setXYZ(ns, it.tone, it.tone * 0.98, it.tone * 0.94); ns++;
      }
    }
    this.stones.count = ns; this.sticks.count = nk;
    this.stones.instanceMatrix.needsUpdate = this.sticks.instanceMatrix.needsUpdate = true;
    this.stones.instanceColor.needsUpdate = true;
  }
}

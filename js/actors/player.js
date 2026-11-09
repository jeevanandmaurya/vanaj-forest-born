// Vanaj: movement (walk/sprint/crouch/jump/swim/climb), first- and third-person cameras, first-person viewmodel,
// weapons (fists, stone knife, club, spear thrust+throw, bow, torch), melee hit zones, sneak attacks, blocking,
// dodge, projectiles that stick in flesh, finishing moves, survival stats, bleeding, sickness, animal calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHumanoid, animateHumanoid, buildWeapons, buildViewArms, skinMaterial } from './humanoid.js';
import { PAINTED } from '../core/palette.js';
import { toonify } from '../core/toon.js';
import { Canopy } from './canopy.js';
import { Pack, heldMesh } from './pack.js';
import { groundHeight, groundNormal, waterAt, biomeAt, HALF } from '../world/terrain.js';
import { clamp, lerp, damp, spring } from '../core/noise.js';
import { G } from '../core/shaderlib.js';

// The rigid pieces on each bone of a body, as one mesh per look: they are made apart, each with its own material, and never move on the bone.
function mergeOnBones(root) {
  const sets = new Map(), same = new Map();
  const hex = (c) => (c ? c.getHexString() : '');
  const alike = (m) => { const k = [m.type, m.map ? m.map.uuid : '', hex(m.color), m.vertexColors, m.side, m.alphaTest, m.flatShading, hex(m.emissive), m.customProgramCacheKey()].join('|'); if (!same.has(k)) same.set(k, m); return same.get(k); };
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData.ink || !o.parent || !o.parent.isBone || !o.visible || Array.isArray(o.material)) return;
    const g = o.geometry; o.updateMatrix();
    if (Object.keys(g.morphAttributes).length || g.groups.length || o.matrix.determinant() < 0) return;
    const m = alike(o.material), attrs = Object.keys(g.attributes).sort().map((n) => n + g.attributes[n].itemSize + g.attributes[n].array.constructor.name + g.attributes[n].normalized).join();
    const key = [o.parent.uuid, m.uuid, !!g.index, attrs].join('|');
    if (!sets.has(key)) sets.set(key, { list: [], m });
    sets.get(key).list.push(o);
  });
  for (const { list, m } of sets.values()) {
    if (list.length < 2) continue;
    const geo = mergeGeometries(list.map((o) => o.geometry.clone().applyMatrix4(o.matrix)), false);
    if (!geo) continue;
    const one = new THREE.Mesh(geo, m), first = list[0], bone = first.parent;
    one.castShadow = first.castShadow; one.receiveShadow = first.receiveShadow; one.frustumCulled = false;
    bone.add(one);
    for (const o of list) bone.remove(o);
  }
}

export const WEAPONS = {
  fists: { dmg: 7, range: 1.7, time: 0.5, hitAt: 0.24, stam: 6, anim: 'punch', bleed: 0.2, weight: 0.6, surf: 'flesh' },
  knife: { dmg: 17, range: 1.8, time: 0.46, hitAt: 0.29, stam: 7, anim: 'stab', bleed: 1.7, weight: 0.7 },
  club: { dmg: 27, range: 2.4, time: 0.85, hitAt: 0.44, stam: 15, anim: 'swing', bleed: 0.5, weight: 1.5, stun: 0.5 },
  spear: { dmg: 32, range: 3.0, time: 0.75, hitAt: 0.4, stam: 12, anim: 'thrust', bleed: 1.3, weight: 1.1, throwDmg: 58 },
  bow: { dmg: 40, range: 0, time: 0.6, stam: 4, anim: 'none', weight: 0.5 },
  torch: { dmg: 10, range: 2.1, time: 0.62, hitAt: 0.32, stam: 8, anim: 'swing', bleed: 0.1, weight: 0.9, fire: true },
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _n = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _up0 = new THREE.Vector3(0, 1, 0), _v4 = new THREE.Vector3();

export class Player {
  constructor(game) {
    const g = this.g = game;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.bodyYaw = 0;
    this.hp = 100; this.maxHp = 100; this.stamina = 100; this.hunger = 85; this.thirst = 85; this.bleed = 0; this.sick = 0; this.drunk = 0; this.exhausted = false;
    this.onGround = true; this.crouch = false; this.sprinting = false; this.swimming = false; this.dead = false; this.wading = 0;
    this.view = 'tpp'; this.speed = 0;
    this.action = null; this.aim = 0; this.draw = 0; this.blocking = false; this.blockT = 0; this.dodgeT = 0; this.iframes = 0;
    this.torchLit = false; this.calm = false; this.calmT = 0; this.noise = 10; this.visibility = 1; this.armedThreat = false;
    this.shake = 0; this.hurtFlash = 0; this.lastFoot = 0; this.fallVel = 0; this.climb = null; this.grabbed = null;
    this.projectiles = []; this.stuck = [];
    this.spawn = new THREE.Vector3();
    // Vanaj is about fifteen: a lean, half-grown boy of ~1.55 m, not a grown man
    this.body = buildHumanoid({ hair: 'shaggy', cloth: 'wrap', clothTex: g.T.ragCloth, skinColor: '#a0714e', skinKey: 'skin-player', lean: 0.95, build: 'teen', sculpt: true, proportions: 'teen', outline: 0.0055, detail: g.q.bodyDetail, scale: 0.94 });
    g.scene.add(this.body.root);
    this.bodyMats = new Set(); this.body.root.traverse((o) => { if (o.isMesh) this.bodyMats.add(o.material); });
    this.W3 = buildWeapons(g.T);
    this.canopy = new Canopy(this);   // climbing, hanging and swinging in the trees
    this.pack = this.body.j.pack ? new Pack(this.body.j.pack) : null;   // what he carries, tied on his back
    this.applyQuality();
    this.dip = { x: 0, v: 0 }; this.lean = { x: 0, v: 0 }; this.look = { t: 0, target: null, pt: new THREE.Vector3() };
    if (PAINTED) for (const k in this.W3) if (this.W3[k]) toonify(this.W3[k], { outline: 0.008, soften: 2 });
    // first-person viewmodel
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 20);
    this.vmLight = new THREE.DirectionalLight(0xffffff, 2); this.vmScene.add(this.vmLight); this.vmScene.add(this.vmLight.target);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x443322, 0.7); this.vmScene.add(this.vmHemi);
    this.vmFire = new THREE.PointLight(0xff8a3a, 0, 3, 1.5); this.vmScene.add(this.vmFire);
    this.vmSkin = skinMaterial(0xa0714e, 0.2, 'skin-vm');
    this.vm = buildViewArms(this.vmSkin); this.vmScene.add(this.vm.root);
    if (PAINTED) toonify(this.vm.root, { outline: 0, soften: 2 });   // no ink here: at the arms' tiny scale the hull swelled round the camera and inked the whole screen
    this.vmW = buildWeapons(g.T);
    this.vmFlame = this.makeVmFlame(); this.vmScene.add(this.vmFlame);
    this.equip('fists');
    this.footPhase = 0; this.bob = 0; this.vmBob = new THREE.Vector2();
    this.fov = 72; this.camDist = 3.2;
    this.camPos = new THREE.Vector3();
  }
  makeVmFlame() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    const m2 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); m.add(m2);
    m.visible = false; return m;
  }
  get weapon() { return this.g.inv.equipped; }
  equip(w) {
    const inv = this.g.inv;
    if (w !== 'fists' && !inv.has(w)) return;
    inv.equipped = w;
    const j = this.body.j;
    for (const k in this.W3) if (this.W3[k] && this.W3[k].parent) this.W3[k].parent.remove(this.W3[k]);
    for (const k in this.vmW) if (this.vmW[k] && this.vmW[k].parent) this.vmW[k].parent.remove(this.vmW[k]);
    const grip = { knife: 0.04, club: 0.08, spear: 0.55, torch: 0.12, bow: 0 };
    const attach = (Wset, handR, handL) => {
      const m = Wset[w]; if (!m) return;
      m.rotation.set(Math.PI / 2, 0, 0); m.position.set(0, -0.075, -(grip[w] || 0));
      if (w === 'bow') { m.rotation.set(Math.PI / 2, 0, 0); m.position.set(0, -0.07, 0); handL.add(m); }
      else handR.add(m);
      m.traverse((o) => { if (o.isMesh) o.castShadow = !this.g.q.lean; });
    };
    attach(this.W3, j.handR, j.handL);
    // first-person grips: the forearm points forward, so weapons run along the fingers (-y), tilted up
    const vmAng = { knife: 0.45, club: 0.75, spear: 0.12, torch: 0.85 };
    const vw = this.vmW[w];
    if (vw) {
      if (w === 'bow') { vw.rotation.set(-Math.PI / 2, Math.PI, 0); vw.position.set(0, -0.07, 0); this.vm.arms.L.hand.add(vw); }
      else {
        const th = Math.PI + (vmAng[w] || 0.4), ax = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
        vw.rotation.set(th, 0, 0); vw.position.set(0, -0.07, 0).addScaledVector(ax, -(grip[w] || 0));
        this.vm.arms.R.hand.add(vw);
      }
    }
    if (this.fire) { this.g.fx.removeFire(this.fire); this.fire = null; }
    this.torchLit = false;
    if (w === 'torch') { this.torchLit = true; this.fire = this.g.fx.addFire(new THREE.Vector3(), 0.45, { smoke: true, attach: this.W3.torch.userData.firePoint }); }
    this.vmFlame.visible = w === 'torch';
    if (this.vmFlame.visible) { this.vmW.torch.userData.firePoint.add(this.vmFlame); this.vmFlame.position.set(0, 0.03, 0); }
    this.aim = 0; this.draw = 0;
  }
  // On a lean level only the body itself casts a shadow and has an outline. His hair, clothes and pack are a dozen draw calls more, each of
  // them twice over for the shadow, and at a phone's size the outline of the body is the one that reads. The pieces of his clothes on
  // each bone are one mesh, too (they are made apart, and each never moves on its bone).
  applyQuality() {
    const low = this.g.q.lean;
    if (this.pack) this.pack.lean = low;
    if (low && !this.rigidMerged) { this.rigidMerged = true; mergeOnBones(this.body.root); }
    this.body.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.ink) o.visible = !low || (o.parent && o.parent.name === 'Body');
      else if (o.name !== 'Body') o.castShadow = !low;
    });
    for (const k in this.W3) if (this.W3[k]) this.W3[k].traverse((o) => { if (o.userData.ink) o.visible = !low; });
  }
  setView(v) {
    this.view = v;
    const fpp = v === 'fpp';
    for (const m of this.bodyMats) { m.colorWrite = !fpp; m.depthWrite = !fpp; }
    if (this.pack) this.pack.group.visible = !fpp;
    for (const k in this.W3) if (this.W3[k]) this.W3[k].traverse((o) => { if (o.isMesh) { o.material.colorWrite = true; o.visible = !fpp && !(o.userData.ink && this.g.q.lean); } });
  }
  // ----------------------------------------------------------------------------------------- update
  update(dt, input) {
    const g = this.g;
    if (this.dead) { this.updateDead(dt); return; }
    // look
    const sens = g.settings.sens * 0.0022;
    if (!g.uiBlocking) {
      if (g.dragLook && !g.touch && !document.pointerLockElement && input.cx !== undefined) { // no pointer lock (sandboxed frame): turn when the cursor rests near an edge
        const ex = input.cx < 0.08 ? -(0.08 - input.cx) / 0.08 : input.cx > 0.92 ? (input.cx - 0.92) / 0.08 : 0;
        const ey = input.cy < 0.08 ? -(0.08 - input.cy) / 0.08 : input.cy > 0.92 ? (input.cy - 0.92) / 0.08 : 0;
        input.mdx += ex * 700 * dt; input.mdy += ey * 400 * dt;
      }
      this.yaw -= input.mdx * sens; this.pitch -= input.mdy * sens * (g.settings.invert ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.35);
      this.camUserT = Math.abs(input.mdx) + Math.abs(input.mdy) > 0.5 ? 1.5 : Math.max(0, (this.camUserT || 0) - dt);
    }
    input.mdx = 0; input.mdy = 0;
    if (this.climb) { this.updateClimb(dt, input); this.postUpdate(dt, input); return; }
    if (this.canopy.mode) { this.canopy.update(dt, input); this.postUpdate(dt, input); return; }
    this.canopy.updateBend(dt);   // a limb he just left springs back
    // movement intent
    const k = g.uiBlocking ? {} : input.keys;
    let ix = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), iz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const fwd = _v1.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = _v3.set(0, 0, 0).addScaledVector(fwd, iz).addScaledVector(right, ix);
    // going over to something to pick it up; any move of his own calls it off
    if (this.pick && this.pick.stage === 0) {
      const K = this.pick, dx = K.pos.x - this.pos.x, dz = K.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      K.t += dt;
      if (wish.lengthSq() > 0) this.pick = null;
      else if (d < 0.52 || K.t > 1.4) this.beginPick();
      else wish.set(dx / d, 0, dz / d);
    }
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();
    if (this.drunk > 0.2) { const w = Math.sin(performance.now() * 0.002) * this.drunk; wish.applyAxisAngle(_n.set(0, 1, 0), w * 0.6); }
    // sprint / crouch
    if (input.pressed('KeyC') && !g.uiBlocking) this.crouch = !this.crouch;
    const wantSprint = k.ShiftLeft && moving && iz > 0 && !this.exhausted && this.stamina > 2;
    this.sprinting = wantSprint && !this.aim;
    if (this.sprinting) this.crouch = false;
    // water
    const gy = groundHeight(this.pos.x, this.pos.z), wl = waterAt(this.pos.x, this.pos.z);
    const depth = wl - gy;
    this.wading = clamp(depth / 1.2, 0, 1);
    const swim = depth > 1.25;
    if (swim && !this.swimming) { g.audio.splash(this.pos, 1); g.fx.splash(_n.set(this.pos.x, wl, this.pos.z)); }
    this.swimming = swim;
    let target = this.crouch ? 1.5 : this.sprinting ? 6 : 2.4;
    if (this.aim > 0.5) target = 1.8;
    if (this.swimming) target = this.sprinting ? 2.9 : 1.8;
    else target *= 1 - this.wading * 0.55;
    if (this.hp < 25) target *= 0.75;
    if (this.grabbed) target = 0.4;
    if (this.action && (this.action.type === 'finish' || this.action.type === 'gather' || this.action.type === 'eat' || this.action.type === 'drink')) target *= 0.15;
    // dodge
    if (this.dodgeT > 0) { this.dodgeT -= dt; }
    else if (input.pressed('Space') && this.blocking && this.onGround && this.stamina > 15) { this.dodgeT = 0.3; this.iframes = 0.35; this.stamina -= 15; const dir = moving ? wish.clone() : fwd.clone().negate(); this.vel.x = dir.x * 9; this.vel.z = dir.z * 9; g.audio.swing(0.8); }
    // integrate horizontal
    const ka = damp(this.onGround || this.swimming ? 0.055 : 0.28, dt);   // ~0.06 s to close half the gap on foot
    if (this.dodgeT <= 0) {
      this.vel.x += (wish.x * target - this.vel.x) * ka;
      this.vel.z += (wish.z * target - this.vel.z) * ka;
    }
    // slope sliding
    groundNormal(this.pos.x, this.pos.z, _n);
    if (!g.phys && this.onGround && _n.y < 0.62 && !this.swimming) { this.vel.x += _n.x * 14 * dt; this.vel.z += _n.z * 14 * dt; }
    // Space facing a trunk climbs it
    if (input.pressed('Space') && this.onGround && !this.swimming && !this.blocking && !this.aim && !g.uiBlocking && this.canopy.tryTrunk()) { this.postUpdate(dt, input); return; }
    // jump / gravity
    if (this.swimming) {
      const ty = wl - 1.3;
      this.vel.y += (ty - this.pos.y) * 6 * dt - this.vel.y * 3 * dt;
      this.onGround = false;
    } else {
      if (input.pressed('Space') && this.onGround && !this.blocking && this.stamina > 8 && !g.uiBlocking) { this.vel.y = 5.4; this.onGround = false; this.stamina -= 8; g.audio.footstep(this.surface(), 0.8); }
      this.vel.y -= 20 * dt;
    }
    // Movement through the physics world: Rapier's character controller slides Vanaj along trunks, rocks, walls,
    // animals and villagers, steps him up small ledges, holds him to the ground going down slopes and shoves loose
    // stones and sticks. Swimming keeps its own buoyancy (above) but the river bed, banks and rocks still stop him.
    let phys = null;
    if (g.phys && this.swimming) {
      const m = g.phys.movePlayer(this.pos, _v4.copy(this.vel).multiplyScalar(dt), true);
      this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
      if (dt > 0) { this.vel.x = m.x / dt; this.vel.z = m.z / dt; }
    } else if (g.phys) {
      const want = _v4.copy(this.vel).multiplyScalar(dt);
      // standing on the ground, press down only lightly: a full gravity step into a slope is slid along it by the
      // controller, and he crept downhill while standing still
      if (this.onGround && this.vel.y <= 0) want.y = -0.002;
      // No input and nearly stopped: stop. Friction here is ours to apply; the controller has none, and the small
      // corrections it returns must not count as walking.
      if (!moving && this.onGround && this.dodgeT <= 0 && this.vel.x * this.vel.x + this.vel.z * this.vel.z < 0.2 * 0.2) { this.vel.x = 0; this.vel.z = 0; want.x = 0; want.z = 0; }
      phys = g.phys.movePlayer(this.pos, want);
      if (Math.abs(want.x) + Math.abs(want.z) < 1e-5) { phys.x = 0; phys.z = 0; }
      this.pos.x += phys.x; this.pos.y += phys.y; this.pos.z += phys.z;
      // Speed only ever comes from him. The controller can take speed away (a wall, a shove against a rock) and turn
      // it along the wall, but its own corrections are never fed back in: that loop kept him creeping at 0.1 m/s
      // long after he stopped, with the idle animation playing.
      if (dt > 0) {
        const w2 = want.x * want.x + want.z * want.z, m2 = phys.x * phys.x + phys.z * phys.z;
        if (w2 > 1e-10 && m2 < w2 * 0.92) { this.vel.x = phys.x / dt; this.vel.z = phys.z / dt; }
      }
      if (this.vel.y > 0 && phys.y < this.vel.y * dt * 0.5) this.vel.y = 0;   // head against a limb
    } else {
      this.pos.addScaledVector(this.vel, dt);
      g.veg.collide(this.pos, 0.35); g.props.collide(this.pos, 0.35);
    }
    if (!g.phys) for (const n of g.npcs || []) { const dx = this.pos.x - n.pos.x, dz = this.pos.z - n.pos.z, d = Math.hypot(dx, dz); if (d < 0.6 && d > 0.01) { this.pos.x = n.pos.x + dx / d * 0.6; this.pos.z = n.pos.z + dz / d * 0.6; } }
    if (!phys) for (const a of g.eco.animals) { if (a.dead || a.perch) continue; const rr = a.radius + 0.3; const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d2 = dx * dx + dz * dz; if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); this.pos.x = a.pos.x + dx / d * rr; this.pos.z = a.pos.z + dz / d * rr; } }
    const lim = HALF - 60; this.pos.x = clamp(this.pos.x, -lim, lim); this.pos.z = clamp(this.pos.z, -lim, lim);
    let gy2 = groundHeight(this.pos.x, this.pos.z);
    // keep the player on the watchtower platform (railings)
    { const t = g.props.towerTop; if (t && this.pos.y > t.y - 0.6 && this.pos.y < t.y + 3 && Math.abs(this.pos.x - t.x) < 3 && Math.abs(this.pos.z - t.z) < 3) { this.pos.x = clamp(this.pos.x, t.x - 1.7, t.x + 1.7); this.pos.z = clamp(this.pos.z, t.z - 1.7, t.z + 1.7); } }
    const plat = g.props.platformHeight ? g.props.platformHeight(this.pos) : -1e9;
    if (plat > gy2) gy2 = plat;
    if (phys) {
      const vy = this.vel.y;
      if (phys.grounded && vy <= 0) {
        if (!this.onGround) { if (vy < -12) this.hurt((-vy - 12) * 6, null, { kind: 'fall' }); this.landed(vy); }
        this.vel.y = 0; this.onGround = true;
      } else this.onGround = false;
      if (this.pos.y < gy2 - 0.5) { this.pos.y = gy2; this.vel.y = 0; this.onGround = true; }   // never through the ground if a collider is late
    } else if (!this.swimming) {
      if (this.pos.y <= gy2) {
        if (!this.onGround && this.vel.y < -12) { const dmg = (-this.vel.y - 12) * 6; this.hurt(dmg, null, { kind: 'fall' }); }
        if (!this.onGround) this.landed(this.vel.y);
        this.pos.y = gy2; this.vel.y = 0; this.onGround = true;
      } else if (this.onGround && this.pos.y - gy2 < 0.45 && this.vel.y <= 0) { this.pos.y = gy2; this.vel.y = 0; }
      else this.onGround = false;
    } else if (this.pos.y < gy2) this.pos.y = gy2;
    // in the air with Space held: catch whatever branch, liana or trunk is in reach
    if (!this.onGround && !this.swimming && input.keys.Space && !g.uiBlocking && this.vel.y < 3.5 && this.canopy.tryGrab(this.vel)) { this.postUpdate(dt, input); return; }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed = hs;
    // facing (TPP): face move dir, or camera when aiming/attacking
    const faceCam = this.view === 'fpp' || this.aim > 0.1 || this.blocking || (this.action && this.action.type !== 'gather');
    const yaw0 = this.bodyYaw;
    if (faceCam) this.bodyYaw = this.lerpAngle(this.bodyYaw, this.yaw, damp(0.05, dt));
    else if (hs > 0.3) this.bodyYaw = this.lerpAngle(this.bodyYaw, Math.atan2(-this.vel.x, -this.vel.z), damp(0.07, dt));
    // lean into turns at speed, on a spring
    let dy = this.bodyYaw - yaw0; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    spring(this.lean, clamp(dy / Math.max(dt, 1e-3) * hs * 0.018, -0.22, 0.22), 0.12, dt);
    // stamina
    const usingStam = this.sprinting || (this.swimming && this.sprinting);
    if (this.sprinting) this.stamina -= 13 * dt;
    else if (this.swimming) this.stamina -= 3 * dt;
    else if (this.blocking) this.stamina -= 2 * dt;
    else this.stamina += (this.hunger > 20 ? 20 : 9) * dt * (this.action ? 0.3 : 1);
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0.5) this.exhausted = true; if (this.stamina > 30) this.exhausted = false;
    if (this.swimming && this.stamina <= 0) this.hurt(4 * dt, null, { kind: 'drown', silent: true });
    // combat input
    this.combat(dt, input);
    this.postUpdate(dt, input);
  }
  // touching down: the weight goes into the knees (a dip on a spring); from a real drop he absorbs it in a short
  // crouch and kicks up dust
  landed(vy) {
    const g = this.g;
    g.audio.footstep(this.surface(), 1.1, null, 0.4);
    this.dip.v += Math.max(-4, vy * 0.16);
    if (vy < -8) { this.landT = Math.min(0.45, 0.2 + (-vy - 8) * 0.03); g.fx.dust(this.pos, Math.min(2, (-vy - 6) * 0.15)); }
  }
  // true on the frame a foot plants. Each foot's height (from the animation, relative to the body root) is tracked
  // against its own recent low and high, so it works for any clip, speed and body size. Without a rig: a timer at
  // a real stride length (0.9 m walking .. 2.1 m sprinting).
  stepFeet(dt) {
    const R = this.body.rig;
    if (!R) { this.footPhase += dt * this.speed / (0.6 + this.speed * 0.21); if (this.footPhase > 1) { this.footPhase -= 1; return true; } return false; }
    const F = this._feet || (this._feet = ['DEF-footL', 'DEF-footR'].map((n) => ({ b: R.bones[n], lo: 1, hi: -1, up: false })));
    const ry = this.body.root.matrixWorld.elements[13]; let hit = false;
    for (const f of F) {
      const y = f.b.getWorldPosition(_v1).y - ry;
      f.lo = Math.min(y, f.lo + dt * 0.05); f.hi = Math.max(y, f.hi - dt * 0.05);
      const span = f.hi - f.lo; if (span < 0.015) continue;
      if (y > f.lo + span * 0.5) f.up = true;
      else if (f.up && y < f.lo + span * 0.2) { f.up = false; hit = true; }
    }
    return hit;
  }
  lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
  surface() {
    const p = this.pos;
    if (waterAt(p.x, p.z) > groundHeight(p.x, p.z) - 0.05) return 'water';
    const b = biomeAt(p.x, p.z);
    if (b.rock > 0.5) return 'rock';
    if (b.sand > 0.5) return 'mud';
    if (b.grass > 0.45 || b.field > 0.3) return 'grass';
    return G.uWetness.value > 0.5 ? 'mud' : 'leaf';
  }
  postUpdate(dt, input) {
    const g = this.g;
    // stealth values
    const night = g.sky.night;
    const cover = g.grass.coverAt(this.pos.x, this.pos.z);
    this.visibility = (this.crouch ? 0.45 : 1) * (this.crouch ? 1 - cover * 0.6 : 1 - cover * 0.2) * (night > 0.5 ? (this.torchLit ? 1.4 : 0.55) : 1) * (this.speed > 4 ? 1.25 : 1);
    this.noise = this.speed < 0.3 ? 2 : this.crouch ? 4 : this.sprinting ? 30 : this.swimming ? 12 : 11;
    if (this.action && this.action.type !== 'gather') this.noise = Math.max(this.noise, 18);
    this.armedThreat = this.weapon !== 'fists';
    if (this.calmT > 0) { this.calmT -= dt; this.calm = this.crouch || this.speed < 1; } else this.calm = false;
    // animation
    const a = this.action;
    const anim = {
      speed: this.speed, crouch: this.crouch ? 1 : 0, air: !this.onGround && !this.swimming && !this.climb, swim: this.swimming ? 1 : 0,
      weapon: this.weapon, aim: this.aim, draw: this.draw, lookPitch: this.pitch,
      action: a ? { type: a.anim || a.type, t: a.t / a.dur } : (this.blocking ? { type: 'block', t: 0.5 } : null),
      kneel: a && (a.type === 'harvest' || a.type === 'finish') ? Math.sin(Math.min(1, a.t / a.dur) * Math.PI) : 0,
    };
    if (this.climb) { anim.speed = 2; anim.air = false; }
    this.landT = Math.max(0, (this.landT || 0) - dt);
    if (this.landT > 0 && this.onGround) { anim.crouch = 1; anim.speed = Math.min(anim.speed, 1); }
    this.updatePick(dt, anim);
    if (this.pack) this.pack.refresh(g.inv);
    const cm = this.canopy.mode;
    // hands busy (climbing, hanging, swimming): the weapon goes on his back, and back in hand after
    const stow = (!!cm && cm !== 'limb') || this.swimming;
    if (stow !== !!this.stowed) {
      this.stowed = stow; const w = g.inv.equipped, m = this.W3[w];
      if (m && w !== 'fists') { if (stow && this.body.j.back) { this.body.j.back.add(m); m.position.set(0, 0, -0.3); } else this.equip(w); }
    }
    if (cm) { anim.canopy = this.canopy.pose; anim.air = cm === 'air'; anim.speed = cm === 'limb' ? this.speed : 0; anim.crouch = 0; }
    // something to watch: the nearest animal ahead, or Kaali when standing about (picked a few times a second)
    this.look.t -= dt;
    if (this.look.t <= 0) {
      this.look.t = 0.3; this.look.target = null; let bd = 16 * 16;
      const fx = -Math.sin(this.bodyYaw), fz = -Math.cos(this.bodyYaw);
      for (const an of g.eco.animals) {
        if (an.dead) continue;
        const dx = an.pos.x - this.pos.x, dz = an.pos.z - this.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < bd && dx * fx + dz * fz > -0.2 * Math.sqrt(d2) && (!an.companion || this.speed < 0.5)) { bd = d2; this.look.target = an; }
      }
    }
    const lt = this.look.target;
    if (lt && !this.view.startsWith('f') && !this.aim) anim.lookAt = lt.headPos ? lt.headPos(this.look.pt) : this.look.pt.copy(lt.pos).setY(lt.pos.y + 0.6);
    if (this.onGround && !this.swimming && !this.climb && this.pos.y - groundHeight(this.pos.x, this.pos.z) < 0.25) {
      const yawR = this.bodyYaw + Math.PI, cy = Math.cos(yawR), sy = Math.sin(yawR), px = this.pos.x, pz = this.pos.z, py = this.pos.y;
      anim.ground = (lx, lz) => groundHeight(px + lx * cy + lz * sy, pz - lx * sy + lz * cy) - py;
    }
    // place the body first, so poses aimed at world points (a grip on a branch) land this frame, not last frame's
    this.body.root.position.copy(this.pos);
    // catching a hold or stepping off one moves him straight onto it; the body eases across that gap instead of jumping
    { const V = this._vis || (this._vis = new THREE.Vector3()), L = this._visLast || (this._visLast = this.pos.clone());
      if (cm !== this._visMode) { this._visMode = cm; V.subVectors(L, this.pos); if (V.lengthSq() > 2.5 * 2.5) V.set(0, 0, 0); }
      V.multiplyScalar(1 - damp(0.075, dt)); this.body.root.position.add(V); L.copy(this.body.root.position); }
    if (this.swimming) this.body.root.position.y += 0.6;
    this.body.root.position.y += Math.min(0, spring(this.dip, 0, 0.09, dt));
    this.body.root.rotation.set(0, this.bodyYaw + Math.PI, cm ? 0 : this.lean.x);
    if (cm === 'hang') { _qt.setFromUnitVectors(_up0, this.canopy.pose.up); this.body.root.quaternion.premultiply(_qt); }   // hang along the arm
    // On a lean level his limbs are posed no oftener than 30 times a second (his body still moves every frame). In the trees it is every
    // frame, where the hands must stay on the branch. Posing him is the costliest single thing in a frame's game logic.
    this._poseDt = (this._poseDt || 0) + dt;
    const posed = cm || this._poseDt >= g.q.poseStep - 0.002;
    if (posed) { this.body.root.updateMatrixWorld(true); animateHumanoid(this.body, this._poseDt, anim); this._poseDt = 0; }
    // footsteps land when a foot does (the old timer ran at speed/0.7 a second: twice a real cadence, out of step)
    if (posed && this.onGround && !this.climb && !this.canopy.mode && this.speed > 0.6) {
      const run = clamp((this.speed - 3) / 4, 0, 1);
      if (this.stepFeet(dt)) { g.audio.footstep(this.surface(), this.crouch ? 0.35 : 0.6 + run * 0.5, null, run); if (this.sprinting && Math.random() < 0.3) g.fx.dust(this.pos, 0.5); }
    } else if (this.swimming && this.speed > 0.3) { this.footPhase += dt * 0.8; if (this.footPhase > 1) { this.footPhase = 0; g.audio.footstep('water', 0.6); } }
    // survival
    this.survival(dt);
    // camera
    this.updateCamera(dt);
    this.updateViewmodel(dt);
    this.updateProjectiles(dt);
  }
  survival(dt) {
    const g = this.g, gh = dt * g.time.rate / 3600; // game hours elapsed
    const hot = g.season === 'summer' && g.time.hour > 10 && g.time.hour < 17;
    this.hunger = clamp(this.hunger - gh * 3.2, 0, 100);
    this.thirst = clamp(this.thirst - gh * (hot ? 7.5 : 4.6) * (this.sick > 0 ? 1.6 : 1), 0, 100);
    if (this.hunger <= 0) this.hurt(dt * 0.25, null, { kind: 'starve', silent: true });
    if (this.thirst <= 0) this.hurt(dt * 0.4, null, { kind: 'thirst', silent: true });
    if (this.bleed > 0) {
      this.hp -= this.bleed * dt * 0.5; this.bleed = Math.max(0, this.bleed - dt * (this.speed < 1 ? 0.09 : 0.05));
      this.bleedDrip = (this.bleedDrip || 0) + dt * (0.5 + this.speed * 0.3);
      if (this.bleedDrip > 1.3) { this.bleedDrip = 0; g.fx.decal(this.pos.x + (Math.random() - 0.5) * 0.3, this.pos.z + (Math.random() - 0.5) * 0.3, 0.08 + this.bleed * 0.04); }
      if (this.hp <= 0) this.die('bleed');
    } else if (this.hunger > 40 && this.thirst > 40 && this.sick <= 0) this.hp = Math.min(this.maxHp, this.hp + dt * 0.35);
    if (this.sick > 0) { this.sick -= gh; this.hp -= dt * 0.08; }
    this.drunk = Math.max(0, this.drunk - dt * 0.01);
    // heartbeat when hurt, breathing when tired
    g.audio.heartRate = this.hp < 35 ? lerp(140, 70, this.hp / 35) : 0;
    g.audio.breathLevel = (100 - this.stamina) / 100 * (this.sprinting ? 1 : 0.6);
  }
  // ----------------------------------------------------------------------------------------- picking things up
  // Pick something up for real: walk over to it, bend, close the hand on it (it leaves the ground only then), lift it and
  // reach back over the shoulder, and it is tied on with the rest of the load (js/actors/pack.js). `item`: { type, pos, size,
  // grab() takes it off the ground, stow() puts it in the pouch }.
  startPick(item) { if (this.pick || this.action) return; this.pick = { ...item, stage: 0, t: 0, mesh: null }; }
  beginPick() { const K = this.pick; K.stage = 1; K.t = 0; K.dur = 1.05; this.action = { type: 'gather', anim: 'gather', t: 0, dur: K.dur }; }
  updatePick(dt, anim) {
    const K = this.pick; if (!K || K.stage === 0) return;
    const g = this.g;
    K.t += dt; const u = K.t / K.dur;
    const fy = this.bodyYaw, bx = Math.sin(fy), bz = Math.cos(fy), rx = Math.cos(fy), rz = -Math.sin(fy);   // behind him, and to his right
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const ground = _v1.copy(K.pos); ground.y += 0.03;
    const over = this.body.rig.bones['DEF-spine003'].getWorldPosition(_v2); over.x += bx * 0.13 + rx * 0.14; over.y += 0.16; over.z += bz * 0.13 + rz * 0.14;   // back over his shoulder
    const to = this._reachTo || (this._reachTo = new THREE.Vector3());
    if (u < 0.42) { to.copy(ground); anim.reach = { to, w: smooth(0.06, 0.38, u) }; }
    else { to.copy(ground).lerp(over, smooth(0.42, 0.82, u)); anim.reach = { to, w: 1 - smooth(0.84, 1, u) }; }
    if (u >= 0.4 && !K.grabbed) {
      K.grabbed = true; K.grab();
      K.mesh = heldMesh(K.type, K.size); g.scene.add(K.mesh);
      g.audio.footstep(this.surface(), 0.3, null, 0.2);
    }
    if (K.mesh) { this.body.j.handR.getWorldPosition(K.mesh.position); K.mesh.rotation.set(0.6, fy, 1.2); }
    if (u >= 0.84 && !K.stowed) {
      K.stowed = true; g.scene.remove(K.mesh); K.mesh = null; K.stow();
    }
    if (u >= 1) this.pick = null;
    // knocked out of it (a hit, a fall): nothing is left floating, and what was in his hand still gets stowed
    else if (!this.action || !this.onGround) { if (K.mesh) { g.scene.remove(K.mesh); K.mesh = null; } if (K.grabbed && !K.stowed) { K.stowed = true; K.stow(); } this.pick = null; }
  }
  // ----------------------------------------------------------------------------------------- camera
  updateCamera(dt) {
    const g = this.g, cam = g.camera;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.25, sy = (Math.random() - 0.5) * sh * 0.25;
    const targetFov = this.fov + (this.sprinting ? 7 : 0) - (this.weapon === 'bow' ? this.aim * this.draw * 22 : 0) - (this.weapon === 'spear' ? this.aim * 8 : 0);
    cam.fov = lerp(cam.fov, targetFov + (this.canopy.mode === 'hang' || this.canopy.mode === 'air' ? Math.min(8, this.vel.length() * 0.6) : 0), damp(0.12, dt)); cam.updateProjectionMatrix();
    const eyeH = this.swimming ? 0.25 : (this.crouch ? 1.0 : 1.55) * (this.body.S || 1);   // eye height follows body size
    if (this.view === 'fpp') {
      this.bob += dt * this.speed * (this.onGround ? 1.4 : 0);
      const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, this.speed / 3), bobX = Math.cos(this.bob) * 0.02 * Math.min(1, this.speed / 3);
      const hp = _v1.set(this.pos.x, this.pos.y + eyeH + bobY + (this.swimming ? 0.6 : 0), this.pos.z);
      // put eye slightly forward of the neck
      hp.x += -Math.sin(this.yaw) * 0.12 + Math.cos(this.yaw) * bobX; hp.z += -Math.cos(this.yaw) * 0.12 - Math.sin(this.yaw) * bobX;
      cam.position.copy(hp);
      cam.rotation.set(this.pitch + sy, this.yaw + sx, (this.drunk > 0.2 ? Math.sin(performance.now() * 0.0015) * this.drunk * 0.12 : 0) - this.vel.dot(_v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) * 0.006, 'YXZ');
    } else {
      const aimK = Math.max(this.aim, this.blocking ? 0.3 : 0);
      const dist = lerp(this.camDist, 1.7, aimK) * (this.swimming ? 1.2 : 1) * (this.canopy.mode === 'hang' || this.canopy.mode === 'air' ? 1.25 : 1);
      const sideOff = lerp(0.45, 0.6, aimK);
      const tgt = _v1.set(this.pos.x, this.pos.y + eyeH + 0.05 + (this.swimming ? 0.6 : 0), this.pos.z);
      tgt.x += Math.cos(this.yaw) * sideOff; tgt.z += -Math.sin(this.yaw) * sideOff;
      const dir = _v2.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      // ground collision along boom
      let d = dist;
      for (let s = 0.25; s <= 1.0; s += 0.25) {
        const px = tgt.x + dir.x * dist * s, pz = tgt.z + dir.z * dist * s, py = tgt.y + dir.y * dist * s;
        if (py < groundHeight(px, pz) + 0.35) { d = dist * (s - 0.25) + 0.3; break; }
      }
      // trunks, limbs, rocks and walls along the boom: a physics ray from the shoulder back to the camera
      if (g.phys) { const toi = g.phys.rayStatic(tgt, dir, d); if (toi !== null) d = Math.max(0.35, toi - 0.25); }
      else { const ex = tgt.x + dir.x * d, ez = tgt.z + dir.z * d;
        const f = Math.min(g.veg.segmentHit(tgt.x, tgt.z, ex, ez, 0.28), g.props.segmentHit ? g.props.segmentHit(tgt.x, tgt.z, ex, ez, 0.28) : 1);
        if (f < 1) d = Math.max(0.35, d * f); }
      const want = _v3.copy(tgt).addScaledVector(dir, d);
      const gyc = groundHeight(want.x, want.z) + 0.3; if (want.y < gyc) want.y = gyc;
      this.camPos.lerp(want, damp(this.canopy.mode ? 0.06 : 0.035, dt));
      if (this.camPos.distanceTo(want) > 14) this.camPos.copy(want);
      cam.position.copy(this.camPos);
      cam.rotation.set(this.pitch + sy, this.yaw + sx, 0, 'YXZ');
    }
    if (g.arrival) this.arrivalCamera(dt);
    cam.updateMatrixWorld();
  }
  // Arriving somewhere: the camera comes down out of the sky, through the crowns of the trees, to its place behind him.
  // It is fast high up and slows as it nears him, and the last stretch blends into the live third-person camera, so
  // there is no join when control comes back. Streaming stays on him for the whole shot, so nothing loads on the way.
  arrivalCamera(dt) {
    const g = this.g, A = g.arrival, cam = g.camera;
    if (A.warmK === undefined) A.t = Math.min(A.dur, A.t + dt * A.speed);
    const k = A.warmK ?? A.t / A.dur, u = 1 - Math.pow(1 - k, 2.3);
    const live = _v1.copy(cam.position), liveQ = _qa.copy(cam.quaternion);
    A.curve.getPoint(u, cam.position);
    { const gy = groundHeight(cam.position.x, cam.position.z) + 1.2; if (cam.position.y < gy) cam.position.y = gy; }
    const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    // looking out over the forest at first, then down to him
    _v2.copy(A.far).lerp(_v3.set(this.pos.x, this.pos.y + 1.2, this.pos.z), sm(0.1, 0.62, k));
    cam.up.set(0, 1, 0); cam.lookAt(_v2);
    cam.quaternion.slerp(liveQ, sm(0.82, 1, k));
    cam.position.lerp(live, sm(0.82, 1, k));
    if (k >= 1 && A.warmK === undefined) { g.arrival = null; if (A.done) A.done(); }
  }
  camForward(out) { return out.set(0, 0, -1).applyQuaternion(this.g.camera.quaternion); }
  isLookingAt(p, cosMin) { const c = this.g.camera.position; const f = this.camForward(_v3); const dx = p.x - c.x, dy = p.y + 0.8 - c.y, dz = p.z - c.z; const d = Math.hypot(dx, dy, dz); return (f.x * dx + f.y * dy + f.z * dz) / d > cosMin; }
  // ----------------------------------------------------------------------------------------- viewmodel
  updateViewmodel(dt) {
    const g = this.g, A = this.vm.arms;
    this.vmCam.aspect = g.camera.aspect; this.vmCam.updateProjectionMatrix();
    this.vmLight.color.copy(g.sky.sun.color); this.vmLight.intensity = g.sky.sun.intensity * 0.7 + 0.2;
    const sd = G.uSunDir.value; const camInv = _v1.copy(sd).applyQuaternion(g.camera.quaternion.clone().invert());
    this.vmLight.position.copy(camInv).multiplyScalar(5); this.vmLight.target.position.set(0, 0, 0);
    this.vmHemi.intensity = g.sky.hemi.intensity * 0.9 + 0.15; this.vmHemi.color.copy(g.sky.hemi.color); this.vmHemi.groundColor.copy(g.sky.hemi.groundColor);
    // nearby fire light
    const nf = g.fx.lights[0]; this.vmFire.intensity = this.weapon === 'torch' ? 2.5 + Math.sin(performance.now() * 0.02) * 0.4 : (nf && nf.intensity > 0 && nf.position.distanceTo(this.pos) < 8 ? 1.2 : 0);
    this.vmFire.position.set(0.2, 0.1, -0.4);
    this.vm.root.visible = this.view === 'fpp' && !this.dead && !this.swimming;
    if (!this.vm.root.visible) return;
    const w = this.weapon, t = performance.now() * 0.001;
    const sp = Math.min(1, this.speed / 7);
    const bobY = Math.sin(this.bob * 2) * 0.02 * sp, bobX = Math.cos(this.bob) * 0.018 * sp;
    const breathe = Math.sin(t * 1.8) * 0.004;
    // base poses (camera space): shoulder positions, upper arm pointing forward-down
    const R = { x: 0.2, y: -0.17, z: 0.12, ua: 1.5, uay: 0.12, uaz: 0.0, fa: 0.12 };
    const L = { x: -0.2, y: -0.17, z: 0.12, ua: 1.45, uay: -0.12, uaz: 0.0, fa: 0.12 };
    let showL = false, showR = w !== 'fists' || !!this.action;
    if (w === 'fists') { showR = true; showL = true; R.ua = 1.35; L.ua = 1.35; R.y = -0.24; L.y = -0.24; R.fa = 0.35; L.fa = 0.35; }
    if (w === 'spear') { showL = true; L.ua = 1.5; L.x = -0.08; L.y = -0.2; L.fa = 0.1; L.uay = 0.35; R.y = -0.22; R.x = 0.22; }
    if (w === 'bow') { showL = true; L.ua = 1.55; L.x = -0.12; L.y = -0.12; L.fa = 0.0; L.uay = 0.15; showR = this.aim > 0.05; }
    if (w === 'torch') { R.ua = 1.45; R.y = -0.16; R.fa = 0.2; }
    if (this.sprinting) { const pump = Math.sin(this.bob * 2); R.ua -= 0.3 + pump * 0.25; L.ua -= 0.3 - pump * 0.25; R.y -= 0.05; }
    // aim poses
    if (w === 'bow' && this.aim > 0) { const d = this.draw; R.x = lerp(0.26, 0.06, this.aim); R.ua = lerp(R.ua, 1.55, this.aim); R.fa = lerp(-0.35, -2.2 + d * 0.3, this.aim); R.z = lerp(0.12, 0.12 + d * 0.15, this.aim); R.uay = lerp(0.15, 0.9 + d * 0.3, this.aim); }
    if (w === 'spear' && this.aim > 0) { R.ua = lerp(R.ua, 2.6, this.aim); R.y = lerp(R.y, -0.15, this.aim); R.x = 0.32; R.fa = lerp(R.fa, -1.2, this.aim); showL = this.aim < 0.5; }
    if (this.blocking && w !== 'bow') { R.ua = 1.5; R.uaz = 0.6; R.fa = -1.4; R.x = 0.18; L.ua = 1.5; L.uaz = -0.6; L.fa = -1.4; L.x = -0.18; showL = true; }
    // actions
    const a = this.action;
    if (a) {
      const p = a.t / a.dur, ease = (x) => x * x * (3 - 2 * x);
      const wind = ease(clamp(p / (a.hitAt / a.dur || 0.4), 0, 1)), strike = ease(clamp((p - (a.hitAt / a.dur || 0.4) + 0.12) / 0.2, 0, 1)), rec = ease(clamp((p - 0.6) / 0.4, 0, 1));
      const k = (1 - rec);
      if (a.anim === 'swing') { R.ua += (-0.9 * wind + 1.4 * strike) * k; R.uaz += (0.7 * wind - 1.3 * strike) * k; R.y += 0.12 * wind * k; R.fa += (-0.6 * wind + 0.5 * strike) * k; }
      else if (a.anim === 'stab') { R.z += (0.15 * wind - 0.45 * strike) * k; R.fa += (-0.6 * wind + 0.6 * strike) * k; R.x -= 0.08 * strike * k; }
      else if (a.anim === 'thrust') { R.z += (0.25 * wind - 0.7 * strike) * k; L.z += (0.2 * wind - 0.55 * strike) * k; R.ua += 0.2 * strike * k; }
      else if (a.anim === 'punch') { const s = Math.sin(clamp(p * 1.7, 0, 1) * Math.PI); R.z -= s * 0.4; R.fa += s * 0.3; R.x -= s * 0.06; R.y += s * 0.08; }
      else if (a.anim === 'throw') { const s = clamp(p * 3, 0, 1); R.ua = lerp(2.6, 0.9, s); R.y = lerp(-0.15, -0.4, s); }
      else if (a.type === 'gather' || a.type === 'harvest' || a.type === 'drink' || a.type === 'eat' || a.type === 'finish') {
        const s = Math.sin(clamp(p, 0, 1) * Math.PI);
        if (a.type === 'eat') { R.ua += 0.5 * s; R.fa -= 1.2 * s; R.y += 0.12 * s; R.x -= 0.12 * s; }
        else if (a.type === 'drink') { showL = true; R.ua -= 0.3 * s; L.ua -= 0.3 * s; R.x -= 0.1 * s; L.x += 0.1 * s; R.y -= 0.1 * s; L.y -= 0.1 * s; }
        else if (a.type === 'finish' || a.type === 'harvest') { const st = Math.abs(Math.sin(p * Math.PI * (a.type === 'finish' ? 3 : 4))); R.ua -= 0.5 * s; R.z -= st * 0.3; R.y -= 0.1 * st; }
        else { R.ua -= 0.6 * s; R.y -= 0.15 * s; }
      }
    }
    // landing / hurt shake
    const sh = this.shake * 0.03;
    const place = (arm, P, show) => {
      arm.ua.visible = show;
      arm.ua.position.set(P.x + bobX + (Math.random() - 0.5) * sh, P.y + bobY + breathe + (Math.random() - 0.5) * sh, P.z);
      arm.ua.rotation.set(P.ua, P.uay, P.uaz, 'XYZ'); arm.fa.rotation.set(P.fa, 0, 0);
      arm.hand.rotation.set(-0.15, 0, 0);
    };
    place(A.R, R, showR); place(A.L, L, showL);
    // bow string draw
    if (this.vmW.bow.userData.string) {
      const s = this.vmW.bow.userData.string.geometry.attributes.position; s.setZ(1, -0.005 - this.draw * 0.45 * (this.aim > 0 ? 1 : 0)); s.needsUpdate = true;
    }
    // sway with look
    this.vm.root.rotation.set(clamp(-(this.g.input.mdyLast || 0) * 0.0006, -0.05, 0.05), clamp(-(this.g.input.mdxLast || 0) * 0.0006, -0.05, 0.05), 0);
    if (this.vmFlame.visible) { const f = 1 + Math.sin(t * 25) * 0.15 + Math.sin(t * 41) * 0.1; this.vmFlame.scale.set(f, f * 1.6, f); }
  }
  // ----------------------------------------------------------------------------------------- combat
  combat(dt, input) {
    const g = this.g, w = this.weapon, W = WEAPONS[w];
    const lmb = !g.uiBlocking && input.buttons[0], rmb = !g.uiBlocking && input.buttons[2];
    if (this.iframes > 0) this.iframes -= dt;
    // aim / block
    if (w === 'bow') {
      const canDraw = g.inv.count('arrow') > 0;
      if (lmb && canDraw && !this.action) { this.aim = Math.min(1, this.aim + dt * 5); if (this.draw === 0) g.audio.bowDraw(); this.draw = Math.min(1, this.draw + dt * 1.3); }
      else if (this.draw > 0.08 && !lmb) { this.fireArrow(); }
      else { this.aim = Math.max(0, this.aim - dt * 4); this.draw = 0; }
      if (lmb && !canDraw && input.pressedMouse(0)) g.ui.toast('No arrows');
      this.blocking = false;
    } else if (w === 'spear' && rmb) {
      this.aim = Math.min(1, this.aim + dt * 5); this.blocking = false;
      if (input.pressedMouse(0) && this.aim > 0.6) this.throwSpear();
    } else {
      this.aim = Math.max(0, this.aim - dt * 5);
      const wasBlock = this.blocking;
      this.blocking = rmb && !this.action && this.stamina > 5 && w !== 'bow';
      if (this.blocking && !wasBlock) this.blockT = 0; if (this.blocking) this.blockT += dt;
      if (input.pressedMouse(0) && !this.action && !this.blocking && w !== 'bow') this.startAttack();
    }
    // action progress
    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.hitAt && !a.hitDone && a.t >= a.hitAt) { a.hitDone = true; if (a.onHit) a.onHit(); else this.resolveMelee(a); }
      if (a.t >= a.dur) { const done = a.onDone; this.action = null; done && done(); }
    }
    // F: finishing move
    if (input.pressed('KeyF') && !this.action && !g.uiBlocking) this.tryFinish();
  }
  startAttack() {
    const w = this.weapon, W = WEAPONS[w];
    if (this.stamina < W.stam * 0.5) { this.g.ui.toast('Too tired'); return; }
    this.stamina -= W.stam;
    this.action = { type: 'attack', anim: W.anim, t: 0, dur: W.time * (this.exhausted ? 1.3 : 1), hitAt: W.hitAt, weapon: w };
    setTimeout(() => this.g.audio.swing(W.weight), W.hitAt * 600);
  }
  meleeTargets(range) {
    const g = this.g;
    const origin = this.view === 'fpp' ? g.camera.position.clone() : _v1.set(this.pos.x, this.pos.y + 1.2, this.pos.z).clone();
    const fwd = this.camForward(new THREE.Vector3());
    if (this.view === 'tpp') { fwd.y *= 0.5; fwd.normalize(); }
    let best = null, bs = 1e9, bp = null;
    const v = new THREE.Vector3();
    const cands = g.eco.animals.concat((g.npcs || []).filter((n) => n.hostile));
    for (const a of cands) {
      if (a.companion) continue;
      a.bodyPos ? a.bodyPos(v) : v.copy(a.pos).add(_v2.set(0, 1, 0));
      const r = (a.d ? a.d.L * 0.5 * a.scale : 0.4);
      const to = _v2.subVectors(v, origin);
      const d = to.length();
      if (d > range + r + 0.3) continue;
      const c = to.dot(fwd) / d;
      if (c < (d < 1.5 ? 0.2 : 0.55)) continue;
      const score = d - c * 1.5;
      if (score < bs) {
        bs = score; best = a;
        // hit point: closest point on the line to target center, moved toward target surface
        const along = clamp(to.dot(fwd), 0.3, range + r);
        bp = origin.clone().addScaledVector(fwd, along);
        // bias toward head if aiming high
        if (a.headPos) { const hp = a.headPos(new THREE.Vector3()); if (bp.distanceTo(hp) < bp.distanceTo(v)) bp.lerp(hp, 0.7); else bp.lerp(v, 0.5); }
      }
    }
    return { target: best, point: bp, dir: fwd, origin };
  }
  resolveMelee(a) {
    const g = this.g, W = WEAPONS[a.weapon];
    const { target, point, dir } = this.meleeTargets(W.range);
    if (!target) {
      // hit tree / ground for feedback
      const tr = g.veg.nearestTree(this.pos.x - Math.sin(this.yaw) * 1.2, this.pos.z - Math.cos(this.yaw) * 1.2, 1.2);
      if (tr) { g.audio.impact('wood', this.pos, 0.8); this.shake = 0.3; }
      return;
    }
    const sneak = target.awareness !== undefined && target.awareness < 0.5 && this.crouch && target.state !== 'attack';
    let dmg = W.dmg * (0.9 + Math.random() * 0.2) * (this.exhausted ? 0.7 : 1);
    if (W.fire && target.d) { dmg += 4; if (target.d.fearFire > 0.5 && !target.dead) { target.threat = this.pos.clone(); target.setState('retreat', 4); } }
    const dealt = target.takeDamage(dmg, point, dir, g.W, { by: 'player', sneak, bleed: W.bleed });
    g.audio.impact('flesh', point, dmg / 18);
    this.shake = Math.min(1, 0.25 + dmg / 60);
    g.hitstop(dmg > 25 ? 0.07 : 0.04);
    if (W.stun && target.stagger !== undefined) target.stagger = Math.max(target.stagger, W.stun);
    if (sneak) g.ui.toast('Silent strike');
    g.ui.hitmarker(target.dead);
    g.emit('hit', { target, dmg: dealt, weapon: a.weapon });
  }
  tryFinish() {
    const g = this.g;
    let best = null, bd = 2.6 * 2.6;
    for (const a of g.eco.animals) {
      const ok = a.downed || (!a.dead && a.hp < a.maxHp * 0.22 && (a.stagger > 0 || a.limp > 0.5 || a.state === 'retreat'));
      if (!ok) continue;
      const d2 = a.dist2(this.pos); if (d2 < bd) { bd = d2; best = a; }
    }
    if (!best) return false;
    if (best.onFinishChoice) return best.onFinishChoice('finish');
    this.finishTarget(best);
    return true;
  }
  finishTarget(t, onDone) {
    const g = this.g;
    t.scripted = (dt, W, an) => { an.targetSpeed = 0; an.stagger = 0.3; };
    this.action = { type: 'finish', t: 0, dur: 2.0, hitAt: 0, weapon: this.weapon };
    g.slowmo(0.45, 1.6);
    const strikes = [0.35, 0.95, 1.5];
    strikes.forEach((st, i) => setTimeout(() => {
      const hp = t.headPos(new THREE.Vector3());
      g.fx.blood(hp, new THREE.Vector3(0, 1, 0), 2.2, true); g.audio.impact('flesh', hp, 2.2); this.shake = 0.8;
      if (i === 2) { if (!t.dead) t.die(g.W, { by: 'player' }); t.scripted = null; t.downed = false; g.music.stinger('kill'); onDone && onDone(); }
    }, st * 1000));
  }
  fireArrow() {
    const g = this.g;
    if (!g.inv.take('arrow', 1)) { this.draw = 0; return; }
    const power = this.draw; this.draw = 0;
    const origin = g.camera.position.clone(); const dir = this.camForward(new THREE.Vector3());
    if (this.view === 'tpp') origin.addScaledVector(dir, 1.5);
    const m = this.W3.arrow.clone(); m.visible = true; g.scene.add(m);
    this.projectiles.push({ kind: 'arrow', mesh: m, pos: origin.clone(), vel: dir.multiplyScalar(22 + power * 42), dmg: WEAPONS.bow.dmg * (0.4 + power * 0.8), life: 6 });
    g.audio.pluck(150 + power * 40, 0.5); g.audio.arrowWhoosh();
    this.noise = 15;
  }
  throwSpear() {
    const g = this.g;
    if (!g.inv.take('spear', 1)) return;
    const origin = g.camera.position.clone(); const dir = this.camForward(new THREE.Vector3());
    if (this.view === 'tpp') origin.addScaledVector(dir, 1.2);
    const m = this.W3.spear.clone(); m.visible = true; g.scene.add(m);
    this.projectiles.push({ kind: 'spear', mesh: m, pos: origin.clone(), vel: dir.multiplyScalar(26), dmg: WEAPONS.spear.throwDmg, life: 8 });
    this.action = { type: 'attack', anim: 'throw', t: 0, dur: 0.5, weapon: 'spear' };
    g.audio.swing(1.2); this.stamina -= 12;
    this.equip(g.inv.has('spear') ? 'spear' : 'fists');
  }
  updateProjectiles(dt) {
    const g = this.g, v = new THREE.Vector3();
    for (const p of this.projectiles) {
      if (p.done) continue;
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const next = p.pos.clone().add(step);
      // animals
      let hit = null;
      for (const a of g.eco.animals) {
        if (a.companion) continue;
        a.bodyPos(v); const r = a.d.L * 0.38 * a.scale + 0.15;
        // segment-sphere test
        const seg = step, f = p.pos.clone().sub(v); const aa = seg.dot(seg), bb = 2 * f.dot(seg), cc = f.dot(f) - r * r; const disc = bb * bb - 4 * aa * cc;
        if (disc >= 0) { const t1 = (-bb - Math.sqrt(disc)) / (2 * aa); if (t1 >= 0 && t1 <= 1) { hit = a; next.copy(p.pos).addScaledVector(seg, t1); break; } }
      }
      p.pos.copy(next);
      p.mesh.position.copy(p.pos);
      const dirN = p.vel.clone().normalize();
      p.mesh.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), dirN);
      if (hit) {
        const dmg = p.dmg * (0.85 + Math.random() * 0.3);
        hit.takeDamage(dmg, p.pos.clone(), dirN, g.W, { by: 'player', bleed: p.kind === 'arrow' ? 1.5 : 2, sneak: hit.awareness < 0.4 });
        g.audio.impact('flesh', p.pos, dmg / 20);
        g.ui.hitmarker(hit.dead);
        // stick into the body
        const body = hit.J.body; body.updateMatrixWorld(); const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
        p.mesh.applyMatrix4(inv); body.add(p.mesh); p.done = true; p.stuckIn = hit;
        if (p.kind === 'spear') { p.mesh.userData.pickup = 'spear'; this.stuck.push({ mesh: p.mesh, item: 'spear', animal: hit }); }
        else this.stuck.push({ mesh: p.mesh, item: Math.random() < 0.5 ? 'arrow' : null, animal: hit });
        continue;
      }
      const gy = groundHeight(p.pos.x, p.pos.z);
      // swept test so fast arrows cannot tunnel: a physics ray through the static world (trunks, limbs, rocks,
      // props, ground), or without physics the trunk and boulder circles
      const prevX = p.pos.x - step.x, prevZ = p.pos.z - step.z, sl = step.length();
      let fT = 1;
      if (g.phys && sl > 1e-4) { const toi = g.phys.rayStatic(_v1.set(prevX, p.pos.y - step.y, prevZ), _v2.copy(step).multiplyScalar(1 / sl), sl); if (toi !== null) fT = toi / sl; }
      else if (p.pos.y < gy + 9) fT = Math.min(g.veg.segmentHit(prevX, prevZ, p.pos.x, p.pos.z, 0.02), g.props.segmentHit ? g.props.segmentHit(prevX, prevZ, p.pos.x, p.pos.z, 0.02) : 1);
      const tr = fT < 1;
      if (tr) { p.pos.set(prevX + step.x * fT, p.pos.y - step.y * (1 - fT), prevZ + step.z * fT); p.mesh.position.copy(p.pos).addScaledVector(dirN, 0.12); }
      // a loose stone or stick: knocked away, and the shaft drops to the ground beside it
      const knocked = tr && g.phys && g.phys.knock(_v2.copy(step).normalize(), p.kind === 'spear' ? 9 : 3, p.pos);
      if (knocked) { p.pos.y = gy + 0.05; p.mesh.position.copy(p.pos); p.mesh.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v3.set(dirN.x, 0.02, dirN.z).normalize()); }
      if (p.pos.y < gy || tr || p.life <= 0) {
        p.done = true;
        if (p.pos.y < gy) p.pos.y = gy + 0.1;
        g.audio.impact(knocked ? 'stone' : tr ? 'wood' : 'whiff', p.pos, 0.6);
        const wl = waterAt(p.pos.x, p.pos.z);
        if (wl > gy) { g.audio.splash(p.pos, 0.4); g.scene.remove(p.mesh); continue; }
        this.stuck.push({ mesh: p.mesh, item: p.kind === 'spear' ? 'spear' : (Math.random() < 0.7 ? 'arrow' : null), ground: p.pos.clone() });
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
    if (this.stuck.length > 40) { const s = this.stuck.shift(); s.mesh.parent && s.mesh.parent.remove(s.mesh); }
  }
  recoverNear() { // pick up arrows/spears stuck in ground or carcasses
    const g = this.g, v = new THREE.Vector3();
    for (const s of this.stuck) {
      s.mesh.getWorldPosition(v);
      if (v.distanceTo(this.pos) < 2.4 && (!s.animal || s.animal.dead)) {
        s.mesh.parent && s.mesh.parent.remove(s.mesh); this.stuck.splice(this.stuck.indexOf(s), 1);
        if (s.item) { g.inv.add(s.item, 1); g.ui.toast('+1 ' + (s.item === 'spear' ? 'Spear' : 'Arrow')); if (s.item === 'spear' && this.weapon === 'fists') this.equip('spear'); }
        return true;
      }
    }
    return false;
  }
  // ----------------------------------------------------------------------------------------- damage & death
  hurt(dmg, from, opts = {}) {
    const g = this.g;
    if (this.dead || dmg <= 0) return;
    if (this.iframes > 0 && opts.kind !== 'fall' && !opts.silent) return;
    let d = dmg;
    if (this.blocking && from && opts.kind !== 'fall') {
      const to = _v1.set(from.x - this.pos.x, 0, from.z - this.pos.z).normalize();
      const f = _v2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      if (to.dot(f) > 0.3) {
        const perfect = this.blockT < 0.3;
        d *= perfect ? 0.1 : 0.4; this.stamina -= dmg * 0.6; g.audio.impact('wood', this.pos, 1);
        if (perfect && opts.by && opts.by.stagger !== undefined) { opts.by.stagger = 0.8; g.ui.toast('Parried'); g.hitstop(0.08); }
      }
    }
    d *= 1 - (g.inv.armor || 0);
    this.hp -= d;
    if (!opts.silent) {
      this.shake = Math.min(1.2, 0.4 + d / 30); this.hurtFlash = Math.min(1, this.hurtFlash + d / 30);
      g.audio.playerPain(d > 20);
      g.ui.damage(from ? Math.atan2(from.x - this.pos.x, from.z - this.pos.z) - this.yaw : null, d);
      if (opts.bleed) this.bleed = Math.min(3, this.bleed + d * 0.03 * opts.bleed);
      g.fx.blood(_v3.set(this.pos.x, this.pos.y + 1.1, this.pos.z), from ? _v1.set(this.pos.x - from.x, 0.3, this.pos.z - from.z).normalize() : null, d / 20);
      if (opts.knock && from) { const k = _v1.set(this.pos.x - from.x, 0, this.pos.z - from.z).normalize(); this.vel.x += k.x * opts.knock; this.vel.z += k.z * opts.knock; }
      if (d > 8 && !this.action) this.action = { type: 'hit', anim: 'hit', t: 0, dur: 0.35 };
    }
    g.emit('hurt', { dmg: d, opts });
    if (this.hp <= 0) this.die(opts.kind || 'wounds');
  }
  die(cause) {
    if (this.dead) return;
    const g = this.g;
    this.dead = true; this.hp = 0; this.deadT = 0; this.deathCause = cause;
    g.audio.playerPain(true);
    g.music.stinger('death');
    this.setView('tpp');
    g.emit('death', { cause });
    setTimeout(() => g.ui.showDeath(cause), 2600);
  }
  updateDead(dt) {
    this.deadT += dt;
    animateHumanoid(this.body, dt, { speed: 0, dead: true, weapon: 'none' });
    this.body.root.position.copy(this.pos);
    const cam = this.g.camera;
    const a = this.deadT * 0.15 + this.yaw;
    cam.position.set(this.pos.x + Math.sin(a) * 4, this.pos.y + 2.5 + this.deadT * 0.3, this.pos.z + Math.cos(a) * 4);
    cam.lookAt(this.pos.x, this.pos.y + 0.3, this.pos.z);
    this.vm.root.visible = false;
  }
  // a fresh start (new game or chapter from the title): whole and rested, nothing in hand from before
  revive() {
    this.dead = false; this.hp = this.maxHp; this.bleed = 0; this.stamina = 100; this.hunger = 85; this.thirst = 85; this.sick = 0; this.drunk = 0;
    this.vel.set(0, 0, 0); this.action = null; this.grabbed = null; this.climb = null; this.canopy.drop(); this.body.dead = 0; this.exhausted = false;
    this.setView(this.g.settings.view);
  }
  respawn(at) {
    this.canopy.drop();
    this.dead = false; this.hp = 70; this.bleed = 0; this.stamina = 100; this.hunger = Math.max(this.hunger, 45); this.thirst = Math.max(this.thirst, 45); this.sick = 0;
    this.pos.copy(at || this.spawn); this.pos.y = groundHeight(this.pos.x, this.pos.z); this.vel.set(0, 0, 0);
    this.action = null; this.grabbed = null; this.body.dead = 0;
    this.setView(this.g.settings.view);
  }
  // ----------------------------------------------------------------------------------------- climbing (tower ladder)
  startClimb(bottom, top) { this.climb = { from: bottom.clone(), to: top.clone(), t: 0 }; this.vel.set(0, 0, 0); }
  updateClimb(dt, input) {
    const c = this.climb;
    const up = input.keys.KeyW ? 1 : input.keys.KeyS ? -1 : 0;
    c.t = clamp(c.t + up * dt * 0.22, 0, 1);
    this.pos.lerpVectors(c.from, c.to, c.t);
    if (c.t <= 0 && up < 0) { this.climb = null; }
    if (c.t >= 1) { this.climb = null; this.pos.copy(c.to); this.pos.x -= 1.2; this.vel.set(0, 0, 0); this.g.emit('climbed', {}); }
    this.speed = Math.abs(up) * 1.5; this.onGround = true;
    if (up !== 0 && Math.random() < dt * 3) this.g.audio.impact('wood', this.pos, 0.3);
  }
  // ----------------------------------------------------------------------------------------- calls
  call(kind) {
    const g = this.g;
    if (this.dead) return;
    const near = (r) => g.eco.near(this.pos, r);
    if (kind === 'hum') {
      g.audio.hum(); this.calmT = 6; this.action = { type: 'hum', anim: 'hum', t: 0, dur: 2.4 };
      for (const a of near(26)) {
        if (a.dead) continue;
        const unarmed = this.weapon === 'fists' || this.weapon === 'knife';
        if (this.crouch && unarmed) { a.bond = Math.min(1, a.bond + (a.sp === 'langur' || a.sp === 'bear' || a.sp === 'gaur' ? 0.22 : 0.12)); a.awareness = Math.max(0, a.awareness - 0.5); if (a.state === 'warn' || a.state === 'alert') a.setState('idle', 3); if (a.aggro && a.d.kind !== 'predator') a.aggro *= 0.5; }
      }
    } else if (kind === 'langur') {
      g.audio.mimicLangur(); this.noise = 40;
      for (const a of near(80)) if (!a.dead && ['prey', 'bird', 'arboreal', 'livestock'].includes(a.d.kind)) { a.threat = this.pos.clone().add(_v1.set((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30)); a.setState('flee', 6); }
    } else if (kind === 'roar') {
      if (this.stamina < 20) { g.ui.toast('Too tired to roar'); return; }
      this.stamina -= 25; g.audio.playerShout(); this.action = { type: 'roar', anim: 'roar', t: 0, dur: 1.1 }; this.noise = 50;
      const threat = 0.35 + (this.weapon !== 'fists' ? 0.2 : 0) + (this.torchLit ? 0.7 : 0) + (g.companion && !g.companion.dead ? 0.25 : 0) + this.hp / 250;
      for (const a of near(32)) {
        if (a.dead || a.companion) continue;
        const k = a.d.kind;
        if (k === 'prey' || k === 'bird' || k === 'arboreal' || k === 'livestock') { a.threat = this.pos.clone(); a.setState('flee', 8); }
        else { const courage = a.d.courage * (a.story ? 1.3 : 1) * (0.7 + Math.random() * 0.5); if (threat > courage || (this.torchLit && Math.random() < a.d.fearFire)) { a.threat = this.pos.clone(); a.setState('retreat', 10); a.aggro *= 0.6; g.ui.toast('It backs away'); } else g.audio.animal(a.d.voice, 'snarl', a.pos); }
      }
    } else if (kind === 'whistle') {
      g.audio.whistle();
      const c = g.companion;
      if (!c || c.dead) { g.ui.toast('No one answers'); return; }
      const { target } = this.meleeTargets(45);
      if (target && target !== c && target.d) { c.command = target; g.ui.toast((c.name || 'Companion') + ' attacks'); }
      else { c.command = null; c.target = null; g.ui.toast((c.name || 'Companion') + ' comes to you'); }
    } else if (kind === 'flute') {
      if (!g.inv.has('flute')) { g.ui.toast('You need a bamboo flute (craft it)'); return; }
      this.action = { type: 'flute', anim: 'flute', t: 0, dur: 4.5 }; this.calmT = 8;
      g.music.stinger('theme');
      for (const a of near(30)) if (!a.dead) { a.awareness = 0; if (a.d.kind !== 'predator') a.bond = Math.min(1, a.bond + 0.1); }
    }
    g.emit('call', { kind });
  }
}

// Story locations and world props: wolf den, termite mounds, rock-bee combs, mahua grove clue, axe-cut stumps,
// three-stone hearth, painted rock shelter, dhole den, sandbar cartwheel, Bada Dev shrine, forest watchtower,
// Gond village (lime-and-indigo mud houses, clay-tile roofs, cattle shed, well, millet fields), boulders, logs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, groundHeight, riverX, RIVER_W, VILLAGE, ROCKS, MAIDAN, TERMITE, biomeAt, waterAt, HALF } from './terrain.js';
import { mulberry32, clamp } from '../core/noise.js';
import { patch } from '../core/shaderlib.js';

export const SITES = {};
function site(id, x, z, name, r = 6) { SITES[id] = { id, x, z, name, r, y: height(x, z) }; return SITES[id]; }
site('den', 760, 880, 'Wolf Den');
site('denWater', 700, 985, 'Waterhole');
site('termite', 1150, 260, 'Termite Flats');
site('hive', 1110, 205, 'Rock-bee Tree');
site('mahua', 820, -220, 'Karmajhiri Mahua');
site('maidan', MAIDAN.x, MAIDAN.z, 'Alikatta Meadow');
site('stumps', 150, -740, 'Cut Wood');
site('hearth', 168, -752, 'Cold Hearth');
site('rocks', ROCKS.x, ROCKS.z, 'Piyorthadi Rocks');
site('cave', -1020, -250, 'Painted Shelter');
site('dholeDen', -480, 420, 'Dhole Den');
site('sandbar', riverX(640) + RIVER_W + 5, 640, 'Sitaghat Sandbar');
site('shrine', riverX(-1250) - 260, -1250, 'Bada Dev Shrine');
site('tower', riverX(-1400) - 140, -1400, 'Kalapahad Tower');
site('fluteSpot', riverX(-1500) - RIVER_W - 6, -1500, 'Riverbank');
site('sukhiSpot', riverX(-1500) + RIVER_W + 8, -1500, 'Far Bank');
site('fields', VILLAGE.x - 120, -1640, 'Village Fields');
site('village', VILLAGE.x, VILLAGE.z, 'Turia Village');

const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });

export class Props {
  constructor(scene, T, veg) {
    this.scene = scene; this.T = T; this.veg = veg;
    this.inter = []; // interactables
    this.colliders = []; // [x,z,r]
    this.mounds = []; this.hives = []; this.boulders = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.mats = {
      wood: std({ map: T.bark.teak, color: 0xa08868 }), darkWood: std({ map: T.bark.generic, color: 0x6a5a48 }),
      rock: std({ map: T.rock, roughness: 0.95 }), mud: std({ color: 0x7a5a3e, roughness: 1 }), termite: std({ map: T.soil, color: 0xa06a50, roughness: 1 }),
      comb: std({ color: 0x3a2a14, roughness: 0.6 }), ash: std({ color: 0x3a3634, roughness: 1 }), clay: std({ color: 0x9a4a2a, roughness: 0.85 }),
      stump: std({ map: T.stump }), iron: std({ color: 0x3a2c24, roughness: 0.7, metalness: 0.4 }), rust: std({ color: 0x6a3a1e, roughness: 0.9, metalness: 0.2 }),
      red: std({ color: 0xa01a10, roughness: 0.7 }), wall: std({ map: T.wall }), roof: std({ map: T.roof, roughness: 0.85 }), thatch: std({ map: T.thatch }),
      tin: std({ color: 0x8a8c88, roughness: 0.45, metalness: 0.7 }), cloth: std({ map: T.clothRed, side: THREE.DoubleSide }), khaki: std({ map: T.clothKhaki }),
      cave: std({ map: T.cave, roughness: 0.95 }), leafBowl: std({ map: T.leaf.teak, alphaTest: 0.4, side: THREE.DoubleSide }), bone: std({ color: 0xd8cdb4, roughness: 0.6 }),
      brass: std({ color: 0xc8a050, roughness: 0.3, metalness: 0.9 }), bottle: new THREE.MeshPhysicalMaterial({ color: 0xa8c8c0, roughness: 0.1, transmission: 0.6, transparent: true, opacity: 0.6 }),
      sand: std({ color: 0xb8a888 }), plaster: std({ color: 0xc8b8a0 }),
    };
  }
  add(mesh, x, z, y = null, rot = 0) { mesh.position.set(x, y ?? groundHeight(x, z), z); mesh.rotation.y = rot; mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); this.group.add(mesh); return mesh; }
  collider(x, z, r) { this.colliders.push(x, z, r); }
  addInteract(o) { this.inter.push(o); return o; }
  build() {
    this.buildBoulders(); this.buildMounds(); this.buildDen(); this.buildHives(); this.buildMahuaClue();
    this.buildStumps(); this.buildCave(); this.buildDholeDen(); this.buildSandbar(); this.buildShrine(); this.buildTower(); this.buildVillage(); this.buildLogs();
  }
  rockGeo(seed, r) {
    const g = new THREE.IcosahedronGeometry(r, 2), p = g.attributes.position, rng = mulberry32(seed);
    const k = [rng() * 3, rng() * 3, rng() * 3];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.22 * Math.sin(x * 3 + k[0]) * Math.cos(z * 2.6 + k[1]) + 0.12 * Math.sin(y * 5 + k[2]);
      p.setXYZ(i, x * n * (1.2 + rng() * 0.01), y * n * 0.7, z * n);
    }
    g.computeVertexNormals(); return g;
  }
  buildBoulders() {
    const rng = mulberry32(808);
    const geos = [this.rockGeo(1, 1), this.rockGeo(2, 1), this.rockGeo(3, 1)];
    const lists = [[], [], []];
    for (let i = 0; i < 2600 && lists[0].length + lists[1].length + lists[2].length < 950; i++) {
      const x = (rng() * 2 - 1) * (HALF - 100), z = (rng() * 2 - 1) * (HALF - 100);
      const b = biomeAt(x, z);
      const p = b.rock * 0.9 + b.sand * 0.25 + 0.04;
      if (rng() > p) continue;
      const s = (b.rock > 0.5 ? 1.2 + rng() * 2.6 : 0.4 + rng() * 1.2);
      const y = height(x, z);
      if (waterAt(x, z) > y + 0.6 * s) continue;
      lists[Math.floor(rng() * 3)].push([x, y - s * 0.25, z, rng() * 6.28, s]);
      if (s > 0.9) this.collider(x, z, s * 1.0);
      this.boulders.push([x, z, s]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    lists.forEach((L, k) => {
      const im = new THREE.InstancedMesh(geos[k], this.mats.rock, L.length);
      L.forEach(([x, y, z, r, s], i) => { e.set(rng() * 0.3, r, rng() * 0.3); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m4); });
      im.castShadow = true; im.receiveShadow = true; this.group.add(im);
    });
  }
  moundGeo(seed) {
    const rng = mulberry32(seed), parts = [];
    const spire = (r, h, x, z, tilt) => { const g = new THREE.CylinderGeometry(r * 0.15, r, h, 9, 8); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h + 0.5; const n = 1 + 0.32 * Math.sin(p.getY(i) * 7 + p.getX(i) * 9) * Math.cos(p.getZ(i) * 8 + y * 5) + 0.18 * Math.sin(i * 1.7); p.setX(i, p.getX(i) * n * (1 + 0.25 * Math.sin(y * 11))); p.setZ(i, p.getZ(i) * n); } g.computeVertexNormals(); g.translate(x, h / 2, z); g.rotateZ(tilt); return g; };
    parts.push(spire(1.0, 2.4, 0, 0, 0.05));
    for (let k = 0; k < 4; k++) parts.push(spire(0.3 + rng() * 0.25, 0.9 + rng() * 1.5, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2, (rng() - 0.5) * 0.3));
    const base = new THREE.SphereGeometry(1.25, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); base.scale(1, 0.35, 1); parts.push(base);
    return mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
  }
  buildMounds() {
    const rng = mulberry32(99), geo = this.moundGeo(4);
    const pts = [];
    for (let i = 0; i < 6000 && pts.length < 380; i++) {
      const x = (rng() * 2 - 1) * (HALF - 100), z = (rng() * 2 - 1) * (HALF - 100);
      const b = biomeAt(x, z);
      if (b.village > 0.05 || b.field > 0.05 || rng() > b.termite * 0.6 + b.grass * 0.025 + b.teak * 0.008) continue;
      const y = height(x, z); if (waterAt(x, z) > y - 0.5) continue;
      pts.push([x, y, z, 0.7 + rng() * 0.8]);
    }
    const im = new THREE.InstancedMesh(geo, this.mats.termite, pts.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    pts.forEach(([x, y, z, s], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6); m4.compose(new THREE.Vector3(x, y - 0.2, z), q, new THREE.Vector3(s, s * (0.8 + rng() * 0.6), s)); im.setMatrixAt(i, m4); this.collider(x, z, 0.8 * s); this.mounds.push({ x, z, y, s, broken: false }); });
    im.castShadow = true; im.receiveShadow = true; this.group.add(im); this.moundMesh = im;
  }
  buildDen() {
    const S = SITES.den, g = new THREE.Group();
    const lt = this.T.bark.saja.clone(); lt.repeat.set(3, 5); lt.needsUpdate = true;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 14, 14), std({ map: lt }));
    log.rotation.z = Math.PI / 2; log.rotation.y = 0.3; log.position.set(0, 0.8, -1.5); g.add(log);
    for (let k = 0; k < 7; k++) { const r = new THREE.Mesh(new THREE.ConeGeometry(0.18, 2.2, 6), this.mats.darkWood); const a = k / 7 * Math.PI * 2; r.position.set(-6.6 + Math.cos(a) * 0.1, 1.0 + Math.sin(a) * 0.9, -3.6 + Math.sin(a) * 0.3); r.rotation.set(0, 0.3, Math.PI / 2 + Math.cos(a) * 0.5); r.rotateX(a); g.add(r); }
    const mound = new THREE.Mesh(new THREE.SphereGeometry(3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.mud); mound.scale.set(1.4, 0.6, 1); mound.position.set(0, -0.2, -3); g.add(mound);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.0, 12), std({ color: 0x0a0806 })); hole.position.set(0, 0.55, -0.4); hole.rotation.x = -0.2; g.add(hole);
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3 + Math.random() * 0.3, 5), this.mats.bone); b.position.set((Math.random() - 0.5) * 4, 0.05, 1 + Math.random() * 2); b.rotation.set(Math.PI / 2, Math.random() * 3, 0); g.add(b); }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), this.mats.bone); skull.scale.set(1, 0.8, 1.6); skull.position.set(1.5, 0.08, 2); g.add(skull);
    this.add(g, S.x, S.z, S.y, 0.2);
    this.veg.addExclusion(S.x, S.z, 14);
    this.collider(S.x - 5, S.z - 1.5, 1.2); this.collider(S.x + 5, S.z - 1.5, 1.2); this.collider(S.x, S.z - 3, 2.5);
    // tally marks wall
    this.addInteract({ id: 'denMarks', pos: new THREE.Vector3(S.x + 0.6, S.y + 0.8, S.z - 1.5), r: 3.2, prompt: 'Look at the marks', kind: 'clue' });
  }
  buildHives() {
    // giant rock bee combs hanging under the branches of a big mahua near the termite flats
    const S = SITES.hive;
    const tree = this.veg.makeSingle('mahua', 0); tree.scale.setScalar(1.25); this.add(tree, S.x, S.z, S.y - 0.3);
    this.veg.addExclusion(S.x, S.z, 9); this.collider(S.x, S.z, 0.8);
    for (let k = 0; k < 3; k++) {
      const comb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.mats.comb);
      comb.scale.set(1.4, 1.2, 0.35);
      const a = k * 2.1;
      comb.position.set(S.x + Math.cos(a) * 3, S.y + 6.2 + k * 0.6, S.z + Math.sin(a) * 3); comb.rotation.y = a;
      comb.castShadow = true; this.group.add(comb);
      this.hives.push({ pos: comb.position.clone(), honey: 1, mesh: comb });
    }
    this.addInteract({ id: 'hive', pos: new THREE.Vector3(S.x, S.y + 1.2, S.z), r: 4, prompt: 'Smoke the hive for honey (torch)', kind: 'hive' });
  }
  buildMahuaClue() {
    const S = SITES.mahua;
    const tree = this.veg.makeSingle('mahua', 1); tree.scale.setScalar(1.3); this.add(tree, S.x, S.z, S.y - 0.3);
    this.veg.addExclusion(S.x, S.z, 10); this.collider(S.x, S.z, 0.9);
    // swept clearing
    const sw = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), std({ color: 0x8a6a4a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    sw.rotation.x = -Math.PI / 2; sw.position.set(S.x, S.y + 0.06, S.z); sw.receiveShadow = true; this.group.add(sw);
    // stitched leaf bowl (dona)
    const bowl = new THREE.Group();
    for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), this.mats.leafBowl); l.position.set(Math.cos(k * 0.9) * 0.08, 0.06, Math.sin(k * 0.9) * 0.08); l.rotation.set(-0.9, k * 0.9, 0); bowl.add(l); }
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 3), this.mats.wood); pin.rotation.z = 1.4; pin.position.y = 0.09; bowl.add(pin);
    this.add(bowl, S.x + 1.6, S.z + 0.8, S.y + 0.02);
    this.addInteract({ id: 'leafBowl', pos: new THREE.Vector3(S.x + 1.6, S.y + 0.3, S.z + 0.8), r: 2.5, prompt: 'Examine the folded leaves', kind: 'clue', mesh: bowl });
  }
  buildStumps() {
    const S = SITES.stumps;
    this.veg.addExclusion(S.x + 10, S.z - 5, 26);
    const rng = mulberry32(5);
    for (let k = 0; k < 7; k++) {
      const x = S.x + (rng() - 0.5) * 30, z = S.z + (rng() - 0.5) * 20, r = 0.3 + rng() * 0.15, h = 0.4 + rng() * 0.4;
      const g = new THREE.Group();
      const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.25, h, 12, 1, true), std({ map: this.T.bark.teak }));
      side.position.y = h / 2; g.add(side);
      const top = new THREE.Mesh(new THREE.CircleGeometry(r, 16), this.mats.stump); top.rotation.x = -Math.PI / 2 + 0.25; top.position.y = h; g.add(top);
      for (let c = 0; c < 6; c++) { const chip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.05), std({ color: 0xc8a070 })); chip.position.set((rng() - 0.5) * 1.6, 0.02, (rng() - 0.5) * 1.6); chip.rotation.y = rng() * 3; g.add(chip); }
      this.add(g, x, z, null, rng() * 6);
      this.collider(x, z, r + 0.1);
      if (k === 0) this.addInteract({ id: 'stump', pos: new THREE.Vector3(x, groundHeight(x, z) + 0.6, z), r: 2.8, prompt: 'Examine the flat-cut stump', kind: 'clue' });
      // felled log nearby
      if (k < 3) { const log = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, 6 + rng() * 4, 10), std({ map: this.T.bark.teak })); log.rotation.set(0, rng() * 3, Math.PI / 2); this.add(log, x + 3, z + 1, groundHeight(x + 3, z + 1) + r * 0.8); }
    }
    // three-stone hearth with ash and a cracked clay pot
    const H = SITES.hearth, g = new THREE.Group();
    for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(this.rockGeo(20 + k, 0.22), this.mats.rock); const a = k * 2.094; st.position.set(Math.cos(a) * 0.32, 0.1, Math.sin(a) * 0.32); g.add(st); }
    const ash = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), this.mats.ash); ash.rotation.x = -Math.PI / 2; ash.position.y = 0.03; g.add(ash);
    for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 5), std({ color: 0x1a1410 })); c.rotation.set(Math.PI / 2, k, 0); c.position.set((Math.random() - 0.5) * 0.4, 0.05, (Math.random() - 0.5) * 0.4); g.add(c); }
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 1.3, 0, Math.PI * 0.75), std({ color: 0xa0502e, side: THREE.DoubleSide })); pot.position.set(0.8, 0.12, 0.3); pot.rotation.set(1.9, 0.4, 0.2); g.add(pot);
    for (let k = 0; k < 5; k++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.06), this.mats.clay); sh.position.set(0.9 + (Math.random() - 0.5) * 0.6, 0.01, (Math.random() - 0.5) * 0.6); sh.rotation.y = Math.random() * 3; g.add(sh); }
    this.add(g, H.x, H.z);
    this.addInteract({ id: 'hearth', pos: new THREE.Vector3(H.x, H.y + 0.4, H.z), r: 2.6, prompt: 'Examine the burnt stones', kind: 'clue' });
  }
  buildCave() {
    const S = SITES.cave;
    const g = new THREE.Group();
    const back = new THREE.Mesh(this.rockGeo(77, 6), this.mats.rock); back.scale.set(1.3, 1.2, 0.9); back.position.set(0, 2, -5); g.add(back);
    const roof = new THREE.Mesh(this.rockGeo(78, 5), this.mats.rock); roof.scale.set(1.5, 0.5, 1.2); roof.position.set(0, 6.5, -1.6); g.add(roof);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5, 8, 4), this.mats.cave);
    const wp = wall.geometry.attributes.position; for (let i = 0; i < wp.count; i++) wp.setZ(i, Math.sin(wp.getX(i) * 0.6) * 0.3 + Math.cos(wp.getY(i) * 1.1) * 0.15); wall.geometry.computeVertexNormals();
    wall.position.set(0, 2.2, -1.5); g.add(wall);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 16), this.mats.sand); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.05, 0.2); g.add(floor);
    for (const sx of [-1, 1]) { const pil = new THREE.Mesh(this.rockGeo(80 + sx, 2), this.mats.rock); pil.scale.set(0.8, 1.8, 1.0); pil.position.set(sx * 4.8, 1.8, -0.5); g.add(pil); }
    const rot = Math.atan2(ROCKS.x - S.x, ROCKS.z - S.z);
    this.add(g, S.x, S.z, S.y - 0.3, rot);
    this.veg.addExclusion(S.x, S.z, 12);
    const c = Math.cos(rot), s = Math.sin(rot);
    const tw = (lx, lz) => [S.x + lx * c + lz * s, S.z - lx * s + lz * c];
    for (const [lx, lz, r] of [[0, -5, 6], [-4.8, -0.5, 1.6], [4.8, -0.5, 1.6]]) { const [x, z] = tw(lx, lz); this.collider(x, z, r); }
    const [wx, wz] = tw(0, -0.8);
    this.addInteract({ id: 'cave', pos: new THREE.Vector3(wx, S.y + 1.8, wz), r: 4, prompt: 'Look at the painted wall', kind: 'clue' });
    this.caveInside = { x: S.x, z: S.z, r: 6 };
  }
  buildDholeDen() {
    const S = SITES.dholeDen, g = new THREE.Group();
    const bank = new THREE.Mesh(this.rockGeo(91, 3), this.mats.mud); bank.scale.set(1.6, 0.7, 1.0); bank.position.set(0, 0.4, -2); g.add(bank);
    for (let k = 0; k < 3; k++) { const h = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), std({ color: 0x050403 })); h.position.set(-1.5 + k * 1.5, 0.45, -0.2); h.rotation.x = -0.35; g.add(h); }
    this.add(g, S.x, S.z, S.y, 0.4); this.veg.addExclusion(S.x, S.z, 10); this.collider(S.x, S.z - 2, 2.5);
    this.addInteract({ id: 'dholeDen', pos: new THREE.Vector3(S.x, S.y + 0.6, S.z), r: 3, prompt: 'Dig at the flooding burrow', kind: 'story' });
  }
  buildSandbar() {
    const S = SITES.sandbar;
    const tree = this.veg.makeSingle('banyan', 0); this.add(tree, S.x + 22, S.z + 8, groundHeight(S.x + 22, S.z + 8) - 0.5);
    this.veg.addExclusion(S.x + 22, S.z + 8, 16); this.collider(S.x + 22, S.z + 8, 2.2);
    // half-buried cartwheel
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 28), this.mats.rust); g.add(rim);
    for (let k = 0; k < 8; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.7 * (k % 3 === 0 ? 0.6 : 1), 5), this.mats.darkWood); sp.rotation.z = k * Math.PI / 8 * 2; sp.position.set(Math.sin(k * Math.PI / 4) * 0.35, Math.cos(k * Math.PI / 4) * 0.35, 0); sp.rotation.z = -k * Math.PI / 4; g.add(sp); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 8), this.mats.darkWood); hub.rotation.x = Math.PI / 2; g.add(hub);
    g.rotation.set(-1.15, 0.4, 0); g.position.y = 0.15;
    const sick = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 4, 12, Math.PI * 1.2), this.mats.rust); sick.position.set(1.1, 0.03, 0.4); sick.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 4, 10), this.mats.brass); ring.position.set(0.7, 0.01, -0.5); ring.rotation.x = -Math.PI / 2;
    const w = new THREE.Group(); w.add(g, sick, ring);
    this.add(w, S.x, S.z, Math.max(groundHeight(S.x, S.z), 0));
    this.addInteract({ id: 'cartwheel', pos: new THREE.Vector3(S.x, groundHeight(S.x, S.z) + 0.4, S.z), r: 3, prompt: 'Dig out the iron hoop', kind: 'clue' });
  }
  buildShrine() {
    const S = SITES.shrine;
    const tree = this.veg.makeSingle('saja', 0); this.add(tree, S.x, S.z, S.y - 0.3);
    this.veg.addExclusion(S.x, S.z, 10); this.collider(S.x, S.z, 0.6);
    const g = new THREE.Group();
    const stone = new THREE.Mesh(this.rockGeo(55, 0.35), std({ color: 0xc0281a, roughness: 0.5 })); stone.position.set(1.3, 0.25, 0.4); g.add(stone);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.25, 12), this.mats.plaster); plat.position.set(1.3, 0.1, 0.4); g.add(plat);
    const tri = new THREE.Group(); const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 5), this.mats.iron); shaft.position.y = 0.7; tri.add(shaft);
    for (const dx of [-0.12, 0, 0.12]) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.2, 4), this.mats.iron); p.position.set(dx, 1.45, 0); tri.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.02), this.mats.iron); bar.position.y = 1.32; tri.add(bar);
    tri.position.set(1.6, 0.2, 0.1); g.add(tri);
    for (let k = 0; k < 4; k++) { const horse = new THREE.Group(); const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 6), this.mats.clay); b.rotation.z = Math.PI / 2; b.position.y = 0.16; horse.add(b); const n = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.12, 5), this.mats.clay); n.position.set(0.09, 0.24, 0); n.rotation.z = -0.5; horse.add(n); for (const lx of [-0.05, 0.05]) for (const lz of [-0.03, 0.03]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), this.mats.clay); l.position.set(lx, 0.06, lz); horse.add(l); } horse.position.set(0.7 + k * 0.25, 0.22, 0.9); horse.rotation.y = 0.3; g.add(horse); }
    // red cloth strips + bangles on trunk
    for (let k = 0; k < 6; k++) { const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.5), this.mats.cloth); const a = k * 1.05; strip.position.set(Math.cos(a) * 0.42, 1.3 + (k % 2) * 0.1, Math.sin(a) * 0.42); strip.rotation.y = -a; g.add(strip); }
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.02, 4, 18), this.mats.cloth); wrap.rotation.x = Math.PI / 2; wrap.position.y = 1.5; g.add(wrap);
    for (let k = 0; k < 5; k++) { const bg = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 4, 12), k % 2 ? this.mats.red : this.mats.brass); bg.position.set(Math.cos(k) * 0.45, 1.65, Math.sin(k) * 0.45); g.add(bg); }
    this.add(g, S.x, S.z);
    this.addInteract({ id: 'shrine', pos: new THREE.Vector3(S.x + 1.3, S.y + 0.6, S.z + 0.4), r: 3, prompt: 'Look at the red stone', kind: 'clue' });
  }
  buildTower() {
    const S = SITES.tower, g = new THREE.Group(), H = 9;
    this.veg.addExclusion(S.x, S.z, 9);
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, H + 2.2, 0.22), this.mats.wood); p.position.set(x * 0.9, (H + 2.2) / 2, z * 0.9); p.rotation.set(z * -0.02, 0, x * 0.02); g.add(p);
      this.collider(S.x + x * 0.9, S.z + z * 0.9, 0.3);
    }
    for (let lv = 1; lv <= 3; lv++) for (const [ax, az, ry] of [[0, -1.5, 0], [0, 1.5, 0], [-1.5, 0, Math.PI / 2], [1.5, 0, Math.PI / 2]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), this.mats.wood); b.position.set(ax, lv * H / 3.4, az); b.rotation.set(0, ry, lv % 2 ? 0.55 : -0.55); g.add(b); }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.15, 3.8), this.mats.wood); plat.position.y = H; g.add(plat);
    for (const [x, z, ry] of [[0, -1.85, 0], [0, 1.85, 0], [-1.85, 0, Math.PI / 2]]) { const r = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 0.08), this.mats.wood); r.position.set(x, H + 0.9, z); r.rotation.y = ry; g.add(r); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.3, 4), this.mats.tin); roof.position.y = H + 2.6; roof.rotation.y = Math.PI / 4; g.add(roof);
    // ladder
    const lad = new THREE.Group();
    for (const lx of [-0.25, 0.25]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, H + 0.3, 0.06), this.mats.wood); r.position.set(lx, H / 2, 0); lad.add(r); }
    for (let k = 0; k < 22; k++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), this.mats.wood); r.position.y = 0.3 + k * 0.4; lad.add(r); }
    lad.position.set(1.85, 0, 0.6); lad.rotation.z = -0.12; g.add(lad);
    // items on platform
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.khaki); cap.position.set(-0.8, H + 0.08, 0.6); g.add(cap);
    const visor = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8, 0, Math.PI), this.mats.khaki); visor.rotation.x = -Math.PI / 2; visor.position.set(-0.8, H + 0.09, 0.71); g.add(visor);
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), this.mats.bottle); bottle.position.set(-0.4, H + 0.2, -0.6); g.add(bottle);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.035), std({ color: 0xc8a030 })); box.position.set(-0.6, H + 0.09, 0.1); g.add(box);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.03), std({ color: 0x2e5a2a })); sign.position.set(0, 1.6, 1.75); g.add(sign);
    this.add(g, S.x, S.z, S.y - 0.1);
    this.towerTop = new THREE.Vector3(S.x, S.y + H + 0.1, S.z); this.towerH = H; this.towerLadder = new THREE.Vector3(S.x + 1.85, S.y, S.z + 0.6);
    this.addInteract({ id: 'ladder', pos: new THREE.Vector3(S.x + 2.0, S.y + 1, S.z + 0.6), r: 1.8, prompt: 'Climb the ladder', kind: 'climb' });
    this.addInteract({ id: 'ladderTop', pos: new THREE.Vector3(S.x + 1.5, S.y + H + 1.0, S.z + 0.6), r: 1.6, prompt: 'Climb down', kind: 'climb' });
    this.addInteract({ id: 'towerItems', pos: new THREE.Vector3(S.x - 0.6, S.y + H + 0.3, S.z + 0.1), r: 2.2, prompt: 'Pick up the rattling box', kind: 'clue' });
  }
  house(w, d, h) {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats.wall);
    // scale UVs so the plinth band reads right
    walls.position.y = h / 2; g.add(walls);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.35, d + 0.6), this.mats.mud); plinth.position.y = 0.17; g.add(plinth);
    const roofG = new THREE.CylinderGeometry(0.01, (Math.max(w, d) * 0.75), 1.6, 4, 1); roofG.rotateY(Math.PI / 4); roofG.scale(w / Math.max(w, d) * 1.05, 1, d / Math.max(w, d) * 1.05);
    const roof = new THREE.Mesh(roofG, this.mats.roof); roof.position.y = h + 0.8; g.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.7), std({ color: 0x3a2a1a })); door.position.set(0, 0.95, d / 2 + 0.01); g.add(door);
    for (const sx of [-1, 1]) { const win = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.35), std({ color: 0x1a1410 })); win.position.set(sx * w * 0.32, 1.5, d / 2 + 0.01); g.add(win); }
    // verandah posts
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h, 6), this.mats.wood); p.position.set(sx * w * 0.45, h / 2, d / 2 + 0.7); g.add(p); }
    const ver = new THREE.Mesh(new THREE.BoxGeometry(w * 1.0, 0.06, 1.2), this.mats.roof); ver.position.set(0, h + 0.05, d / 2 + 0.6); ver.rotation.x = 0.25; g.add(ver);
    return g;
  }
  buildVillage() {
    const V = VILLAGE, rng = mulberry32(2024);
    this.veg.addExclusion(V.x, V.z, 120);
    this.houses = [];
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + rng() * 0.2, r = 34 + rng() * 22;
      const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      const w = 6 + rng() * 3, d = 4.5 + rng() * 1.5, h = 2.6 + rng() * 0.4;
      const hs = this.house(w, d, h);
      const rot = Math.atan2(V.x - x, V.z - z);
      this.add(hs, x, z, groundHeight(x, z) - 0.1, rot);
      this.collider(x, z, Math.max(w, d) * 0.55);
      this.houses.push({ x, z, rot, w, d, h, door: new THREE.Vector3(x + Math.sin(rot) * (d / 2 + 1.5), 0, z + Math.cos(rot) * (d / 2 + 1.5)) });
    }
    // cattle shed with thatch
    const shed = new THREE.Group();
    for (const [x, z] of [[-3, -2], [3, -2], [-3, 2], [3, 2]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), this.mats.wood); p.position.set(x, 1.2, z); shed.add(p); }
    const th = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.6, 4), this.mats.thatch); th.position.y = 3; th.rotation.y = Math.PI / 4; th.scale.set(1.4, 1, 1); shed.add(th);
    this.add(shed, V.x + 70, V.z + 10);
    // well
    const well = new THREE.Group(); const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.8, 16, 1, true), this.mats.plaster); ring.position.y = 0.4; well.add(ring);
    const wat = new THREE.Mesh(new THREE.CircleGeometry(1.05, 16), std({ color: 0x0c1a1a, roughness: 0.1 })); wat.rotation.x = -Math.PI / 2; wat.position.y = 0.2; well.add(wat);
    this.add(well, V.x + 8, V.z + 6); this.collider(V.x + 8, V.z + 6, 1.3);
    this.addInteract({ id: 'well', pos: new THREE.Vector3(V.x + 8, groundHeight(V.x + 8, V.z + 6) + 0.6, V.z + 6), r: 2.2, prompt: 'Drink from the well', kind: 'water' });
    // banyan in the square
    const ban = this.veg.makeSingle('banyan', 0); this.add(ban, V.x - 6, V.z - 4, groundHeight(V.x - 6, V.z - 4) - 0.4); this.collider(V.x - 6, V.z - 4, 2.2);
    const chab = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 18), this.mats.plaster); this.add(chab, V.x - 6, V.z - 4, groundHeight(V.x - 6, V.z - 4));
    // haystacks
    for (let k = 0; k < 6; k++) { const hs = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 10), this.mats.thatch); hs.position.y = 1.5; const g = new THREE.Group(); g.add(hs); const a = rng() * 6.28; this.add(g, V.x + Math.cos(a) * 75, V.z + Math.sin(a) * 75); }
    // millet fields (kodo/kutki) — rows of tufts
    const tuft = new THREE.ConeGeometry(0.16, 0.9, 5, 1, true); tuft.translate(0, 0.45, 0);
    const pts = [];
    for (let i = 0; i < 9000 && pts.length < 4200; i++) {
      const x = V.x + (rng() - 0.5) * 460, z = V.z + (rng() - 0.5) * 460;
      const b = biomeAt(x, z); if (b.field < 0.45) continue;
      const rx = Math.round(x / 1.1) * 1.1;
      pts.push([rx, z]);
    }
    this.cropMat = std({ color: 0xb8a040, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(tuft, this.cropMat, pts.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    pts.forEach(([x, z], i) => { const s = 0.8 + rng() * 0.5; m4.compose(new THREE.Vector3(x, groundHeight(x, z), z), q, new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m4); });
    im.receiveShadow = true; this.group.add(im); this.crops = im;
    // bamboo fence along the village edge
    const post = new THREE.CylinderGeometry(0.05, 0.06, 1.3, 5); post.translate(0, 0.65, 0);
    const fp = []; for (let a = 0; a < Math.PI * 2; a += 0.012) { if (Math.abs(a - 4.3) < 0.15) continue; fp.push([V.x + Math.cos(a) * 100, V.z + Math.sin(a) * 100]); }
    const fim = new THREE.InstancedMesh(post, std({ map: this.T.bark.bamboo }), fp.length);
    fp.forEach(([x, z], i) => { m4.makeTranslation(x, groundHeight(x, z), z); fim.setMatrixAt(i, m4); });
    fim.castShadow = true; this.group.add(fim);
    this.addInteract({ id: 'villageGate', pos: new THREE.Vector3(V.x + Math.cos(4.3) * 100, 0, V.z + Math.sin(4.3) * 100), r: 8, prompt: '', kind: 'trigger' });
  }
  buildLogs() {
    const rng = mulberry32(31337), geo = new THREE.CylinderGeometry(0.3, 0.36, 7, 9); geo.rotateZ(Math.PI / 2);
    const L = [];
    for (let i = 0; i < 2000 && L.length < 160; i++) { const x = (rng() * 2 - 1) * 1800, z = (rng() * 2 - 1) * 1800; const b = biomeAt(x, z); if (rng() > b.teak * 0.5) continue; const y = height(x, z); if (waterAt(x, z) > y) continue; L.push([x, y + 0.2, z, rng() * 6.28, 0.7 + rng() * 0.6]); }
    const im = new THREE.InstancedMesh(geo, std({ map: this.T.bark.teak, color: 0x8a7a68 }), L.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    L.forEach(([x, y, z, r, s], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m4); this.collider(x + Math.cos(r) * 1.5 * s, z - Math.sin(r) * 1.5 * s, 0.5); this.collider(x - Math.cos(r) * 1.5 * s, z + Math.sin(r) * 1.5 * s, 0.5); });
    im.castShadow = true; im.receiveShadow = true; this.group.add(im);
  }
  setSeason(s) {
    if (this.cropMat) this.cropMat.color.set(s === 'post' ? 0xc0a848 : s === 'monsoon' ? 0x5a8a30 : s === 'summer' ? 0x8a7050 : 0x9a9050);
  }
  collide(pos, radius) {
    const c = this.colliders; let hit = false;
    for (let i = 0; i < c.length; i += 3) {
      const dx = pos.x - c[i]; if (dx > 12 || dx < -12) continue;
      const dz = pos.z - c[i + 1]; if (dz > 12 || dz < -12) continue;
      const rr = c[i + 2] + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = c[i] + dx / d * rr; pos.z = c[i + 1] + dz / d * rr; hit = true; }
    }
    return hit;
  }
  segmentHit(ax, az, bx, bz, pad = 0.1) {
    const c = this.colliders; let best = 1; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 1e-6) return 1;
    const mx = Math.min(ax, bx) - 14, Mx = Math.max(ax, bx) + 14, mz = Math.min(az, bz) - 14, Mz = Math.max(az, bz) + 14;
    for (let i = 0; i < c.length; i += 3) {
      if (c[i] < mx || c[i] > Mx || c[i + 1] < mz || c[i + 1] > Mz) continue;
      const ox = c[i] - ax, oz = c[i + 1] - az, r = c[i + 2] + pad;
      if (ox * ox + oz * oz < r * r) continue; // the segment starts inside (standing against it): not a blocker
      const t = Math.max(0, Math.min(1, (ox * dx + oz * dz) / L2)), px = dx * t - ox, pz = dz * t - oz;
      if (px * px + pz * pz < r * r) { const back = Math.sqrt(Math.max(0, r * r - (px * px + pz * pz))) / Math.sqrt(L2); best = Math.min(best, Math.max(0, t - back)); }
    }
    return best;
  }
  platformHeight(p) {
    if (!this.towerTop) return -1e9;
    const t = this.towerTop;
    if (Math.abs(p.x - t.x) < 1.9 && Math.abs(p.z - t.z) < 1.9 && p.y > t.y - 1.2) return t.y;
    return -1e9;
  }
  nearestMound(p, r = 3) { let best = null, bd = r * r; for (const m of this.mounds) { const d = (m.x - p.x) ** 2 + (m.z - p.z) ** 2; if (d < bd) { bd = d; best = m; } } return best; }
  forageNear(p) { // bears look for termite mounds
    let best = null, bd = 120 * 120; for (const m of this.mounds) { const d = (m.x - p.x) ** 2 + (m.z - p.z) ** 2; if (d < bd && Math.random() < 0.5) { bd = d; best = m; } }
    return best ? new THREE.Vector3(best.x + 1.2, 0, best.z) : null;
  }
}

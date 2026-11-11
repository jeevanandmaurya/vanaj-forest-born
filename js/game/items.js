// Inventory, crafting recipes, food effects and world pickups (sticks, stones, flint, mahua flowers,
// ber/tendu fruit, monsoon mushrooms, feathers) scattered deterministically by biome and season.
import * as THREE from 'three';
import { PAINTED } from '../core/palette.js';
import { toonify } from '../core/toon.js';
import { mulberry32 } from '../core/noise.js';
import { biomeAt, groundHeight, waterAt } from '../world/terrain.js';

export const ITEMS = {
  stick: { name: 'Stick', desc: 'Dry teak branch.' },
  stone: { name: 'Stone', desc: 'River-rounded sandstone.' },
  flint: { name: 'Flint', desc: 'Dark glassy stone that holds a sharp edge.' },
  fiber: { name: 'Fibre', desc: 'Stripped bamboo and bark fibre for lashing.' },
  bamboo: { name: 'Bamboo', desc: 'Straight, hollow, strong.' },
  leaves: { name: 'Leaves', desc: 'Broad leaves for binding wounds and covering things.' },
  meat_raw: { name: 'River fish', desc: 'Fresh out of the Pench. Much better roasted.', food: { hunger: 14, sick: 0.25 } },
  meat_cooked: { name: 'Roasted fish', desc: 'Crisp from the fire. Fills you up and mends you.', food: { hunger: 38, hp: 14 } },
  feather: { name: 'Feather', desc: 'Peacock feather for fletching arrows.' },
  honey: { name: 'Honey', desc: 'Rock-bee honey, dark and smoky.', food: { hunger: 16, hp: 6, thirst: 2 } },
  mahua: { name: 'Mahua flowers', desc: "Sweet. Eat too many and you get drunk.", food: { hunger: 7, thirst: 5, drunk: 0.22 } },
  ber: { name: 'Ber fruit', desc: 'Small sour jujube fruit.', food: { hunger: 6, thirst: 2 } },
  tendu: { name: 'Tendu fruit', desc: 'Sweet orange pulp, summer fruit.', food: { hunger: 8, thirst: 3 } },
  mushroom: { name: 'Mushroom', desc: "Grows after rain. Some will make you sick.", food: { hunger: 8, sick: 0.15 } },
  termites: { name: 'Termites', desc: 'A handful of fat termites. Bears love them.', food: { hunger: 6 } },
  arrow: { name: 'Arrow', desc: 'Bamboo shaft, flint point, peacock fletching.' },
  knife: { name: 'Stone knife', desc: 'A sharp edge. Cuts bamboo, bark and fibre.', weapon: 'knife' },
  club: { name: 'Club', desc: 'A heavy knotted branch. Nothing with sense comes near it.', weapon: 'club' },
  spear: { name: 'Spear', desc: 'Bamboo with lashed flint. Keeps teeth at a distance, and spears fish.', weapon: 'spear' },
  axe: { name: 'Stone axe', desc: 'A flint head lashed into a split haft. Fells a tree, given time.', weapon: 'axe' },
  log: { name: 'Firewood', desc: 'Split from a tree you felled. One lights a whole fire.' },
  bow: { name: 'Bow', desc: 'A bamboo bow strung with twisted fibre.', weapon: 'bow' },
  torch: { name: 'Torch', desc: "Fire on a stick. Big cats keep back from it, and smoke calms bees.", weapon: 'torch' },
  flute: { name: 'Bamboo flute', desc: "Six holes. It can play the four notes." },
  bandage: { name: 'Leaf bandage', desc: 'Binds up a hurt.' },
  hidewrap: { name: 'Bark-cloth wrap', desc: 'Beaten bark and leaves bound over chest and arms. Softens blows.' },
  campfire: { name: 'Campfire', desc: 'Place to cook, rest and sleep.' },
  wire: { name: "Shiny vine", desc: "Thin, cold and shiny. It doesn't rot.", story: true },
  bowl: { name: 'Leaf bowl', desc: 'Leaves folded and pinned with a twig. Holds water.', story: true },
  matches: { name: 'Fire box', desc: 'Scrape a stick on the side and it burns.', story: true },
  lota: { name: 'Steel lota', desc: 'Dented. Marks scratched into the rim.', story: true },
};

export const RECIPES = [
  { id: 'knife', needs: { stone: 2 }, desc: "Hit stone on stone until one edge comes off sharp." },
  { id: 'club', needs: { stick: 2, fiber: 1 }, tool: 'knife' },
  { id: 'spear', needs: { bamboo: 1, flint: 1, fiber: 2 }, tool: 'knife' },
  { id: 'axe', needs: { stick: 1, flint: 1, fiber: 2 }, tool: 'knife', lock: 'axe', desc: 'Like whatever made the flat cuts on those stumps.' },
  { id: 'torch', needs: { stick: 1, fiber: 1, leaves: 2 } },
  { id: 'campfire', needs: { stick: 5, stone: 3 }, alt: { log: 1, stone: 3 }, desc: 'Fire-saw of bamboo, or the fire box if you have it.' },
  { id: 'bandage', needs: { leaves: 3, fiber: 1 } },
  { id: 'flute', needs: { bamboo: 1 }, tool: 'knife' },
  { id: 'bow', needs: { bamboo: 2, fiber: 3 }, tool: 'knife', lock: 'bow' },
  { id: 'arrow', needs: { stick: 2, flint: 1, feather: 1 }, tool: 'knife', makes: 5, lock: 'bow' },
  { id: 'hidewrap', needs: { fiber: 4, leaves: 4 }, tool: 'knife' },
];

export class Inventory {
  constructor() { this.items = {}; this.locks = new Set(['bow', 'axe']); this.equipped = 'fists'; this.armor = 0; }
  count(k) { return this.items[k] || 0; }
  add(k, n = 1) { this.items[k] = (this.items[k] || 0) + n; if (this.items[k] <= 0) delete this.items[k]; }
  take(k, n = 1) { if (this.count(k) < n) return false; this.add(k, -n); return true; }
  has(k) { return this.count(k) > 0; }
  canCraft(r) {
    if (r.lock && this.locks.has(r.lock)) return false;
    if (r.tool && !this.has(r.tool)) return false;
    const ok = (req) => Object.entries(req).every(([k, n]) => this.count(k) >= n);
    return ok(r.needs) || (r.alt && ok(r.alt));
  }
  craft(r) {
    if (!this.canCraft(r)) return false;
    const ok = (req) => Object.entries(req).every(([k, n]) => this.count(k) >= n);
    const use = ok(r.needs) ? r.needs : r.alt;
    for (const [k, n] of Object.entries(use)) this.take(k, n);
    this.add(r.id, r.makes || 1);
    if (r.id === 'hidewrap') this.armor = 0.2;
    return true;
  }
  weapons() { return ['fists', 'knife', 'club', 'spear', 'bow', 'torch', 'axe'].filter((w) => w === 'fists' || this.has(w)); }
  toJSON() { return { items: this.items, locks: [...this.locks], equipped: this.equipped, armor: this.armor }; }
  load(o) { this.items = o.items || {}; this.locks = new Set(o.locks || []); this.equipped = o.equipped || 'fists'; this.armor = o.armor || 0; }
}

// ------------------------------------------------------------------------------- pickups
const TYPES = ['stick', 'stone', 'flint', 'mahua', 'ber', 'tendu', 'mushroom', 'feather', 'leaves'];
export class Pickups {
  constructor(scene, T) {
    this.scene = scene; this.cells = new Map(); this.taken = new Map(); this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.season = 'winter'; this.day = 0;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
    const stick = new THREE.CylinderGeometry(0.025, 0.035, 0.9, 5); stick.rotateZ(Math.PI / 2); stick.translate(0, 0.04, 0);
    const stone = new THREE.DodecahedronGeometry(0.11, 0); stone.scale(1.2, 0.7, 1); stone.translate(0, 0.05, 0);
    const flint = new THREE.OctahedronGeometry(0.08, 0); flint.scale(1.3, 0.6, 0.9); flint.translate(0, 0.04, 0);
    const blob = (r) => { const g = new THREE.SphereGeometry(r, 6, 4); g.translate(0, r * 0.7, 0); return g; };
    const cluster = (r, n, s) => { const geos = []; const rng = mulberry32(n); for (let i = 0; i < n; i++) { const g = new THREE.SphereGeometry(r, 5, 4); g.translate((rng() - 0.5) * s, r, (rng() - 0.5) * s); geos.push(g); } return mergeSimple(geos); };
    const mush = new THREE.CylinderGeometry(0.07, 0.015, 0.06, 8); mush.translate(0, 0.1, 0); const stem = new THREE.CylinderGeometry(0.015, 0.02, 0.08, 5); stem.translate(0, 0.04, 0);
    const feather = new THREE.PlaneGeometry(0.06, 0.5); feather.rotateX(-Math.PI / 2 + 0.1); feather.translate(0, 0.02, 0);
    const leaves = new THREE.PlaneGeometry(0.5, 0.5); leaves.rotateX(-Math.PI / 2); leaves.translate(0, 0.03, 0);
    this.defs = {
      stick: { geo: stick, mat: std({ map: T.bark.teak, color: 0x9a8060 }) },
      stone: { geo: stone, mat: std({ color: 0x8a7e70 }) },
      flint: { geo: flint, mat: std({ color: 0x2c2a2a, roughness: 0.25 }) },
      mahua: { geo: cluster(0.035, 9, 0.35), mat: std({ color: 0xe6dcc0 }) },
      ber: { geo: cluster(0.03, 7, 0.25), mat: std({ color: 0xb05a20, roughness: 0.5 }) },
      tendu: { geo: cluster(0.045, 4, 0.25), mat: std({ color: 0xd08a20, roughness: 0.6 }) },
      mushroom: { geo: mergeSimple([mush, stem]), mat: std({ color: 0xd8c8a8 }) },
      feather: { geo: feather, mat: std({ color: 0x1a6a5a, side: THREE.DoubleSide, roughness: 0.5 }) },
      leaves: { geo: leaves, mat: std({ map: T.leaf.teak, alphaTest: 0.5, side: THREE.DoubleSide }) },
    };
    this.meshes = {};
    for (const k of TYPES) { const d = this.defs[k]; const m = new THREE.InstancedMesh(d.geo, d.mat, 400); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; if (PAINTED) toonify(m, { outline: 0, rim: 0.3, soften: 3 }); scene.add(m); this.meshes[k] = m; }
    this.active = []; // {key, type, x,y,z}
  }
  genCell(cx, cz) {
    const S = 16, rng = mulberry32((cx * 15485863) ^ (cz * 32452843) ^ 77);
    const b = biomeAt(cx * S + 8, cz * S + 8);
    const out = [];
    const put = (type, n) => { for (let i = 0; i < n; i++) { const x = cx * S + rng() * S, z = cz * S + rng() * S; out.push({ type, x, z, rot: rng() * 6.28 }); } };
    const r = rng;
    put('stick', Math.floor(r() * (1 + b.teak * 3 + b.bamboo)));
    put('stone', Math.floor(r() * (0.6 + b.rock * 3 + b.sand * 4)));
    if (r() < 0.08 + b.rock * 0.25 + b.sand * 0.3) put('flint', 1);
    if (r() < 0.04 + b.open * 0.05) put('feather', 1);
    if (r() < 0.12 + b.teak * 0.2) put('leaves', 1);
    const s = this.season;
    if (s === 'summer' && r() < 0.2 + b.teak * 0.15) put('mahua', 1 + Math.floor(r() * 2));
    if (s === 'summer' && r() < 0.12) put('tendu', 1);
    if ((s === 'winter' || s === 'post') && r() < 0.12 + b.open * 0.1) put('ber', 1);
    if ((s === 'monsoon' || s === 'post') && r() < 0.15 + b.teak * 0.2) put('mushroom', 1 + Math.floor(r() * 2));
    for (const o of out) { o.y = groundHeight(o.x, o.z); if (waterAt(o.x, o.z) > o.y) o.dead = true; }
    return out.filter((o) => !o.dead);
  }
  setSeason(s) { this.season = s; this.cells.clear(); this.last.set(1e9, 0, 1e9); }
  update(p, force) {
    if (!force && this.last.distanceToSquared(p) < 16) return;
    this.last.copy(p);
    const S = 16, R = this.R || 3, pcx = Math.floor(p.x / S), pcz = Math.floor(p.z / S);
    const counts = {}; for (const k of TYPES) counts[k] = 0;
    this.active.length = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = pcx + dx, cz = pcz + dz, key = cx * 100003 + cz;
      let c = this.cells.get(key); if (!c) { c = this.genCell(cx, cz); this.cells.set(key, c); }
      c.forEach((o, i) => {
        const id = key + ':' + i;
        const t = this.taken.get(id);
        if (t !== undefined && this.day - t < 3) return;
        const m = this.meshes[o.type]; const n = counts[o.type];
        if (n >= 400) return;
        q.setFromAxisAngle(up, o.rot); m4.compose(v.set(o.x, o.y, o.z), q, one); m.setMatrixAt(n, m4); counts[o.type]++;
        this.active.push({ id, type: o.type, x: o.x, y: o.y, z: o.z });
      });
    }
    // (a kind with nothing on the ground here is no draw call)
    for (const k of TYPES) { const m = this.meshes[k], A = m.instanceMatrix, n = counts[k]; m.count = n; m.visible = n > 0; A.clearUpdateRanges(); if (n) { A.addUpdateRange(0, n * 16); A.needsUpdate = true; } }
    if (this.cells.size > 2000) this.cells.clear();
  }
  // the best thing to pick up, measured from where he stands (not from the camera, which is 3 m behind him in third
  // person: from there, what lay at his feet was out of reach). Anything not behind him counts, the closest and most
  // nearly in front first.
  nearest(pos, dir, maxD = 2.2) {
    let best = null, bs = -1e9;
    for (const a of this.active) {
      const dx = a.x - pos.x, dy = a.y - pos.y, dz = a.z - pos.z, d = Math.hypot(dx, dz);
      if (d > maxD || Math.abs(dy) > 1.3) continue;
      const c = d < 0.5 ? 1 : (dx * dir.x + dz * dir.z) / d;
      const s = c * 1.2 - d;
      if ((c > -0.25 || d < 1.6) && s > bs) { bs = s; best = a; }
    }
    return best;
  }
  take(a) { this.taken.set(a.id, this.day); this.last.set(1e9, 0, 1e9); }
}

function mergeSimple(geos) {
  // tiny merge for non-indexed + indexed mixes
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

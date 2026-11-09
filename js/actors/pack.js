// What Vanaj carries, tied on his back with rope. A rope runs from the load over one shoulder, across his chest and back
// under the other arm; sticks and bamboo are bound in a bundle across his shoulders, stones hang in a net at the small of
// his back, and leaves, fibre, hide and food are tied on round them. Each part shows as soon as there is some of it in
// the pouch, and it grows with the count. Everything here sits in a group that follows his upper back (js/actors/humanrig.js),
// in metres: +z is the way he faces.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from '../core/toon.js';
import { PAINTED } from '../core/palette.js';
import { mulberry32 } from '../core/noise.js';

const mat = (c) => (PAINTED ? toon({ color: c, rim: 0.3, key: 'pack' }) : new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 }));
const ROPE = mat(0xb3986a), WOOD = mat(0x7a5c3e), BAMBOO = mat(0xa8a848), STONE = mat(0x8d857a), FLINT = mat(0x2e2c2c), LEAF = mat(0x5f8038), HIDE = mat(0x8e6238), MEAT = mat(0x7a2d24), FIBRE = mat(0xc2a973), BONE = mat(0xe0d6c0);
const tube = (pts, r, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed), closed ? 24 : 18, r, 5, closed);

export class Pack {
  constructor(parent) {
    const G = this.group = new THREE.Group(); parent.add(G);
    this.sig = '';
    const add = (geo, m, o = G) => { const x = new THREE.Mesh(geo, m); x.castShadow = true; o.add(x); return x; };
    // the rope over his right shoulder, across the chest, under the left arm and round the back
    this.strap = add(tube([[-0.04, -0.03, -0.14], [-0.115, 0.07, -0.08], [-0.13, 0.115, 0], [-0.085, 0.075, 0.098], [0.02, -0.04, 0.126], [0.12, -0.16, 0.085], [0.15, -0.22, -0.01], [0.09, -0.24, -0.12], [-0.04, -0.03, -0.14]], 0.0075), ROPE);
    // sticks: a bundle slanting across the shoulders, bound in two places
    this.sticks = [];
    const rng = mulberry32(5), stickG = new THREE.CylinderGeometry(0.013, 0.018, 0.74, 5), bambooG = new THREE.CylinderGeometry(0.02, 0.022, 1.08, 6);
    const B = this.bundle = new THREE.Group(); B.position.set(0, 0.02, -0.16); B.rotation.z = -0.95; G.add(B);
    for (let i = 0; i < 7; i++) { const a = i * 2.4, r = i ? 0.018 + (i % 3) * 0.008 : 0; const s = add(stickG, WOOD, B); s.position.set(Math.cos(a) * r, (rng() - 0.5) * 0.08, Math.sin(a) * r); s.rotation.y = rng() * 6; this.sticks.push(s); }
    this.poles = [];
    for (let i = 0; i < 3; i++) { const s = add(bambooG, BAMBOO, B); s.position.set(-0.03 + i * 0.03, 0, -0.035); this.poles.push(s); }
    this.ties = [-0.2, 0.2].map((y) => { const t = add(new THREE.TorusGeometry(0.05, 0.006, 5, 14), ROPE, B); t.rotation.x = Math.PI / 2; t.position.y = y; return t; });
    // stones: in a rope net hanging at the small of the back
    const N = this.net = new THREE.Group(); N.position.set(0.05, -0.27, -0.155); G.add(N);
    this.stones = []; const sg = new THREE.DodecahedronGeometry(0.036, 0);
    for (let i = 0; i < 6; i++) { const a = i * 2.1, s = add(sg, STONE, N); s.position.set(Math.cos(a) * 0.03, -0.03 + (i % 3) * 0.022, Math.sin(a) * 0.022); s.scale.set(1, 0.75, 0.85); s.rotation.set(i, i * 2, 0); this.stones.push(s); }
    this.flints = []; const fg = new THREE.OctahedronGeometry(0.028, 0);
    for (let i = 0; i < 3; i++) { const s = add(fg, FLINT, N); s.position.set(-0.04 + i * 0.04, 0.02, -0.03); this.flints.push(s); }
    this.netLines = [-0.045, -0.005, 0.035].map((y, i) => { const t = add(new THREE.TorusGeometry(0.066 - i * 0.008, 0.0035, 4, 12), ROPE, N); t.rotation.x = Math.PI / 2; t.position.y = y; t.scale.set(1, 0.72, 1); return t; });
    this.netTie = add(tube([[0, 0.04, 0], [-0.01, 0.1, 0.012], [-0.03, 0.15, 0.02]], 0.004), ROPE, N);
    // tied on round them
    const tied = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, tie = 0.05) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rx, ry, rz); G.add(g); add(geo, m, g); const t = add(new THREE.TorusGeometry(tie, 0.005, 4, 12), ROPE, g); t.rotation.x = Math.PI / 2; return g; };
    const leafG = new THREE.CylinderGeometry(0.06, 0.05, 0.16, 7); leafG.scale(1, 1, 0.55);
    this.leaves = tied(leafG, LEAF, -0.1, -0.2, -0.15, 0, 0, 1.3, 0.052);
    this.fibre = tied(new THREE.TorusGeometry(0.05, 0.016, 5, 12).rotateX(Math.PI / 2), FIBRE, 0.1, -0.08, -0.17, 0.5, 0, 0.2, 0.001);
    this.hide = tied(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), HIDE, 0, 0.16, -0.14, 0, 0, Math.PI / 2 + 0.1, 0.053);
    this.meat = tied(new THREE.SphereGeometry(0.058, 7, 5).scale(1.2, 0.9, 0.8), MEAT, -0.13, -0.28, -0.11, 0.2, 0.4, 0.4, 0.06);
    this.food = tied(new THREE.SphereGeometry(0.05, 7, 5).scale(0.9, 1.1, 0.7), LEAF, 0.15, -0.3, -0.09, 0, 0, -0.2, 0.05);
    this.bone = tied(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), BONE, -0.13, -0.08, -0.15, 0, 0, 0.5, 0.016);
    G.traverse((o) => { o.visible = o === G; });
  }
  // show what the pouch holds (it only changes when the counts do)
  refresh(inv) {
    const c = (k) => inv.count(k), sum = (...ks) => ks.reduce((n, k) => n + c(k), 0);
    const food = sum('mahua', 'ber', 'tendu', 'mushroom', 'termites', 'honey'), counts = [c('stick'), c('bamboo'), c('stone'), c('flint'), c('leaves'), c('fiber'), c('hide'), sum('meat_raw', 'meat_cooked'), food, c('bone')];
    const lean = this.lean, sig = counts.join() + lean;
    if (sig === this.sig) return;
    this.sig = sig;
    const [sticks, bamboo, stones, flints, leaves, fibre, hide, meat, fd, bone] = counts;
    // each piece here is a draw call of its own. On Low (lean) the load shows as a few of each, without the little ropes that tie it on
    const show = (o, on) => { o.visible = on; if (on) o.traverse((x) => { x.visible = true; }); if (on && lean && o.children[1]) o.children[1].visible = false; };
    this.sticks.forEach((s, i) => { s.visible = i < (lean ? Math.min(sticks, 2) : sticks); });
    this.poles.forEach((s, i) => { s.visible = i < (lean ? Math.min(bamboo, 1) : bamboo); });
    const load = sticks + bamboo > 0;
    this.bundle.visible = load; this.ties.forEach((t) => { t.visible = load && !lean; });
    this.stones.forEach((s, i) => { s.visible = i < (lean ? Math.min(stones, 2) : stones); });
    this.flints.forEach((s, i) => { s.visible = i < flints && !lean; });
    const net = stones + flints > 0;
    this.net.visible = net; this.netLines.forEach((t) => { t.visible = net && !lean; }); this.netTie.visible = net && !lean;
    show(this.leaves, leaves > 0); show(this.fibre, fibre > 0 && !lean); show(this.hide, hide > 0); show(this.meat, meat > 0); show(this.food, fd > 0 && !lean); show(this.bone, bone > 0 && !lean);
    this.strap.visible = counts.some((n) => n > 0);
    if (this.baked) this.baked.visible = false;
    if (lean) this.bake();
  }
  // On a lean level all that shows of the load is one mesh, its pieces' colours painted on its vertices: a dozen draw calls become one. It is
  // made again only when the load changes.
  bake() {
    const G = this.group, parts = [], up = new THREE.Matrix4(), col = new THREE.Color();
    const shown = (o) => { for (; o && o !== G; o = o.parent) if (!o.visible) return false; return true; };
    G.traverse((o) => {
      if (!o.isMesh || o === this.baked) return;
      if (shown(o)) {
        up.identity(); for (let p = o; p && p !== G; p = p.parent) { p.updateMatrix(); up.premultiply(p.matrix); }
        const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(), g = new THREE.BufferGeometry();
        g.setAttribute('position', src.attributes.position); g.setAttribute('normal', src.attributes.normal); g.applyMatrix4(up);
        col.copy(o.material.color); const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g);
      }
    });
    G.traverse((o) => { if (o.isMesh && o !== this.baked) o.visible = false; });
    if (!parts.length) return;
    if (!this.baked) { this.baked = new THREE.Mesh(new THREE.BufferGeometry(), PAINTED ? toon({ color: 0xffffff, vertexColors: true, rim: 0.4, key: 'rope' }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })); this.baked.frustumCulled = false; G.add(this.baked); }
    this.baked.geometry.dispose();
    this.baked.geometry = mergeGeometries(parts, false);
    this.baked.visible = true;
  }
}

// a thing in his hand on its way to the pack
export function heldMesh(type, size = 0) {
  const m = { stick: [new THREE.CylinderGeometry(0.018, 0.024, 0.6, 5), WOOD], stone: [new THREE.DodecahedronGeometry(size || 0.07, 0), STONE], flint: [new THREE.OctahedronGeometry(0.05, 0), FLINT], leaves: [new THREE.SphereGeometry(0.07, 6, 4).scale(1, 0.5, 1), LEAF], feather: [new THREE.PlaneGeometry(0.05, 0.4), mat(0x1a6a5a)] }[type] || [new THREE.SphereGeometry(0.05, 6, 4), mat(0xc89048)];
  const x = new THREE.Mesh(m[0], m[1]); x.castShadow = true; return x;
}

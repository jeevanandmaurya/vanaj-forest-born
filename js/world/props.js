// Story locations and world props: wolf den, termite mounds, rock-bee combs, mahua grove clue, axe-cut stumps,
// three-stone hearth, painted rock shelter, dhole den, sandbar cartwheel, Bada Dev shrine, forest watchtower,
// Gond village (lime-and-indigo mud houses, clay-tile roofs, cattle shed, well, millet fields), boulders, logs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, groundHeight, riverX, RIVER_W, VILLAGE, ROCKS, MAIDAN, TERMITE, biomeAt, waterAt, HALF } from './terrain.js';
import { mulberry32, clamp } from '../core/noise.js';
import { patch, NOISE_GLSL } from '../core/shaderlib.js';
import { PAINTED, PU } from '../core/palette.js';
import { toon, toonify } from '../core/toon.js';
import { CLEARINGS } from './flora.js';

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
  constructor(scene, T, veg, q) {
    this.scene = scene; this.T = T; this.veg = veg; this.q = q;
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
    if (PAINTED) { toonify(this.group, { outline: 0, rim: 0.3, soften: 3 }); if (this.crops) this.cropMat = this.crops.material; }   // other props: toon light, textures softened to painted patches
    // the instanced things, with all their instances kept aside for update() to choose from
    this.spread = [];
    this.group.traverse((o) => { if (o.isInstancedMesh && o.count > 1) this.spread.push({ im: o, n: o.count, m: o.instanceMatrix.array.slice(0, o.count * 16), c: o.instanceColor ? o.instanceColor.array.slice(0, o.count * 3) : null }); });
    this.applyQuality();
  }
  // Whatever was anywhere in front of the camera was drawn, even the village from two kilometres off, behind the whole forest. And boulders,
  // termite mounds, crops and fences are each one mesh of instances across the whole map, so all of them went together, and again for the
  // shadows: the termite mounds alone were 81,000 triangles at any moment. Now only what is out to where the forest is drawn, or a
  // little past it, listed again every 20 m walked.
  update(cam, force = false) {
    if (!force && this.lastCull && (cam.x - this.lastCull.x) ** 2 + (cam.z - this.lastCull.z) ** 2 < 400) return;
    this.lastCull = { x: cam.x, z: cam.z };
    const R2 = this.q.treeFar * this.q.treeFar, seen = this.q.treeFar * 1.25;
    // (what is too far off leaves the group altogether, so that a frame has hundreds of things less to walk over)
    for (const P of this.pieces || []) { const on = Math.hypot(P.x - cam.x, P.z - cam.z) - P.r < seen; if (on && !P.o.parent) this.group.add(P.o); else if (!on && P.o.parent) this.group.remove(P.o); }
    for (const S of this.spread) {
      const { im, m, c } = S, A = im.instanceMatrix, C = im.instanceColor; let k = 0;
      for (let i = 0; i < S.n; i++) {
        const o = i * 16, dx = m[o + 12] - cam.x, dz = m[o + 14] - cam.z;
        if (dx * dx + dz * dz > R2) continue;
        A.array.set(m.subarray(o, o + 16), k * 16);
        if (c) C.array.set(c.subarray(i * 3, i * 3 + 3), k * 3);
        k++;
      }
      im.count = k; im.visible = k > 0; im.boundingSphere = null;   // (three.js works it out again, for the instances now in the list)
      A.clearUpdateRanges(); if (k) { A.addUpdateRange(0, k * 16); A.needsUpdate = true; }
      if (C) { C.clearUpdateRanges(); if (k) { C.addUpdateRange(0, k * 3); C.needsUpdate = true; } }
    }
  }
  // On a lean level, only the big things cast a shadow: the walls, the den's fallen tree and the like, not the several hundred small parts of them
  applyQuality() {
    const low = !!this.q.lean, v = new THREE.Vector3();
    for (const P of this.pieces || []) if (!P.o.parent) this.group.add(P.o);
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.casts === undefined) o.userData.casts = o.castShadow;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const small = o.userData.small ?? o.geometry.boundingSphere.radius * o.getWorldScale(v).x < 1.5;
      o.castShadow = o.userData.casts && !(low && (o.isInstancedMesh || small));
    });
    this.lastCull = null;
  }
  // The den, the village and the rest are built of some four hundred separate small meshes, and each one in view is a draw call: facing the
  // den, nearly six hundred in a frame. None of them ever moves. So once the physics has read them (js/core/physics.js wants them apart),
  // those with the same material in the same 64 m square become one mesh. A piece something else keeps hold of (a hive, a clue) stays as it is.
  mergeStatic() {
    this.group.updateMatrixWorld(true);
    const sets = new Map(), v = new THREE.Vector3(), keep = new Set(), same = new Map();
    for (const it of [...this.hives, ...this.inter]) if (it.mesh) it.mesh.traverse((o) => keep.add(o));
    const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    // (each piece was made with a material of its own, many of them alike: alike, they can share one, and so a mesh)
    const hex = (c) => (c ? c.getHexString() : '');
    const alike = (m) => { const k = [m.type, m.map ? m.map.uuid : '', hex(m.color), m.vertexColors, m.side, m.alphaTest, m.flatShading, hex(m.emissive), m.emissiveIntensity, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.customProgramCacheKey()].join('|'); if (!same.has(k)) same.set(k, m); return same.get(k); };
    this.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || keep.has(o) || Array.isArray(o.material) || o.material.transparent || o.customDepthMaterial || !shown(o)) return;
      o.material = alike(o.material);
      const g = o.geometry;
      if (!g.attributes.position || Object.keys(g.morphAttributes).length || g.groups.length || o.matrixWorld.determinant() < 0) return;   // (a mirrored piece needs its own winding)
      if (!g.boundingSphere) g.computeBoundingSphere();
      const small = g.boundingSphere.radius * o.getWorldScale(v).x < 1.5;
      v.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const attrs = Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize + g.attributes[k].array.constructor.name + g.attributes[k].normalized).join();
      const key = [Math.floor(v.x / 64), Math.floor(v.z / 64), o.material.uuid, o.userData.casts, o.receiveShadow, small, !!g.index, attrs].join('|');
      if (!sets.has(key)) sets.set(key, { list: [], small });
      sets.get(key).list.push(o);
    });
    for (const { list, small } of sets.values()) {
      if (list.length < 2) continue;
      const geo = mergeGeometries(list.map((o) => o.geometry.clone().applyMatrix4(o.matrixWorld)), false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, list[0].material);
      m.receiveShadow = list[0].receiveShadow; m.matrixAutoUpdate = false; m.userData.casts = list[0].userData.casts; m.userData.small = small;
      this.group.add(m);
      for (const o of list) o.parent.remove(o);
    }
    // the groups they came out of, now empty
    const empty = []; this.group.traverse((o) => { if (o !== this.group && !o.isMesh && !o.children.length) empty.push(o); });
    for (const o of empty) o.parent.remove(o);
    // where each remaining piece stands, for update() to leave out what is too far off to see
    this.pieces = [];
    const box = new THREE.Box3(), sph = new THREE.Sphere();
    for (const o of this.group.children) {
      if (o.isInstancedMesh || !o.visible) continue;
      box.setFromObject(o); if (box.isEmpty()) continue;
      box.getBoundingSphere(sph); this.pieces.push({ o, x: sph.center.x, z: sph.center.z, r: sph.radius });
    }
    this.applyQuality();
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
  // A dead tree's wood: scanned bark with its normal map, sloughing off in patches (aBare) to show grey
  // weathered wood with grain and cracks; lichen and moss on what faces the sky, damp and dark where it lies on
  // the earth (baked into the vertex colour).
  deadwoodMaterial() {
    if (this._deadwood) return this._deadwood;
    if (PAINTED) return (this._deadwood = toon({
      color: 0x8f8272, vertexColors: true, rim: 0.4, key: 'deadwood', patch: (s) => {   // painted: flat wood, grain strokes, silver where bare
        s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
          attribute float aBare; varying float vBare; varying vec2 vDUv;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          vBare = aBare; vDUv = uv;`);
        s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
${NOISE_GLSL}
 varying float vBare; varying vec2 vDUv;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            { float st = vnoise(vec2(vDUv.x * 6.0, vDUv.y * 0.7)), w = fwidth(st) + 1e-4;
              diffuseColor.rgb *= 0.9 + 0.16 * smoothstep(0.6 - w, 0.6 + w, st) - 0.14 * smoothstep(0.68 - w, 0.68 + w, 1.0 - st);
              float bare = smoothstep(0.45, 0.55, vBare + (vnoise(vDUv * vec2(10.0, 2.0)) - 0.5) * 0.4);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.42, 0.42) * vColor, bare); }`);
      },
    }));
    const sc = this.T.scan && this.T.scan.pine, m = std({ map: sc ? sc.map : this.T.bark.saja, normalMap: sc ? sc.normal : null, color: 0x9a9088, vertexColors: true, roughness: 0.95 });
    if (sc) m.normalScale.set(1.6, 1.6);
    patch(m, 'deadwood', (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute float aBare; varying float vBare; varying vec3 vDW; varying vec3 vDN; varying vec3 vDL;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBare = aBare; vDL = position;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n vDW = (modelMatrix * vec4(transformed, 1.0)).xyz; vDN = normalize(mat3(modelMatrix) * objectNormal);');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uWetness, uSeasonGreen; varying float vBare; varying vec3 vDW; varying vec3 vDN; varying vec3 vDL;
          float dh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float dn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(dh(i), dh(i + vec2(1, 0)), f.x), mix(dh(i + vec2(0, 1)), dh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // weathered wood where the bark has fallen away: silver-grey, grain running along the trunk, cracks
            float grain = dn(vec2(vMapUv.x * 90.0, vMapUv.y * 4.0)) * 0.5 + dn(vec2(vMapUv.x * 260.0, vMapUv.y * 9.0)) * 0.5;
            vec3 wood = vec3(0.26, 0.24, 0.21) * (0.8 + 0.35 * grain);   // weathered grey wood, not bleached white
            wood *= 1.0 - 0.55 * smoothstep(0.86, 0.95, dn(vec2(vMapUv.x * 40.0, vMapUv.y * 1.2)));
            float bare = smoothstep(0.35, 0.65, vBare + (dn(vMapUv * vec2(14.0, 3.0)) - 0.5) * 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.92, 0.9, 0.88), wood, bare);
            // lichen and moss on the sky-facing side, more of both after the rains
            float up = smoothstep(0.2, 0.8, vDN.y);
            float lich = up * smoothstep(0.6, 0.8, dn(vDW.xz * 6.0 + vDW.y) * 0.6 + dn(vDW.xz * 17.0) * 0.4) * 0.35;   // small crusty blotches
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.35, 0.29), lich);
            float moss = up * smoothstep(0.62, 0.8, dn(vDW.xz * 1.1 - vDW.y * 0.7)) * (0.25 + 0.75 * uSeasonGreen);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.13, 0.05), moss * 0.45);
            diffuseColor.rgb *= mix(1.0, 0.7, uWetness);
          }`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.95, 0.6, uWetness);');
    });
    return (this._deadwood = m);
  }
  // Earth: soil texture in world space, colour and damp baked per vertex (dug earth paler, dark under roots).
  earthMaterial() {
    if (this._earth) return this._earth;
    if (PAINTED) return (this._earth = toon({ vertexColors: true, rim: 0, key: 'den-earth', patch: (s) => {
      Object.assign(s.uniforms, PU);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n uniform vec3 uGround;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= uGround * 1.15;');
    } }));
    const m = std({ map: this.T.soil, vertexColors: true, roughness: 1 });
    patch(m, 'den-earth', (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vEW;').replace('#include <fog_vertex>', '#include <fog_vertex>\n vEW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vEW; uniform float uWetness;')
        .replace('#include <map_fragment>', `
          vec3 an = abs(normalize(cross(dFdx(vEW), dFdy(vEW)))); an /= an.x + an.y + an.z;
          vec3 st = texture2D(map, vEW.zy * 0.45).rgb * an.x + texture2D(map, vEW.xz * 0.45).rgb * an.y + texture2D(map, vEW.xy * 0.45).rgb * an.z;
          // the soil tile is a red laterite; this is dun forest loam: mostly desaturated, a little warm, dusty
          float sl = dot(st, vec3(0.3, 0.55, 0.15));
          st = mix(vec3(sl), st, 0.35) * vec3(1.0, 0.9, 0.76);
          diffuseColor.rgb *= st * 1.25 * mix(1.0, 0.65, uWetness);`);
    });
    return (this._earth = m);
  }
  // A tube along a curve whose radius varies with position along it (t) and around it (a); UVs keep the bark
  // texture at a constant size, with `texM` metres per repeat. bare(t, a) sets aBare, shade(p) the vertex colour.
  logTube(curve, rad, { segs = 40, radial = 18, texM = 0.8, bare = () => 0, shade = () => 1, cap = false, splinter = 0, seed = 1 } = {}) {
    const rng = mulberry32(seed), fr = curve.computeFrenetFrames(segs, false), L = curve.getLength();
    const pos = [], uv = [], col = [], bw = [], idx = [], P = new THREE.Vector3(), d = new THREE.Vector3();
    let circ = 0;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs; curve.getPointAt(t, P);
      if (i === 0) circ = 2 * Math.PI * rad(0, 0);
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        d.copy(fr.normals[i]).multiplyScalar(c).addScaledVector(fr.binormals[i], s);
        let r = rad(t, a);
        const q = P.clone().addScaledVector(d, r);
        if (i === segs && splinter) { q.addScaledVector(fr.tangents[i], rng() * splinter); q.addScaledVector(d, -r * 0.25 * rng()); }   // splintered break
        pos.push(q.x, q.y, q.z);
        uv.push(j / radial * Math.max(1, Math.round(circ / texM)), t * L / texM);
        const sh = shade(q); col.push(sh, sh, sh); bw.push(i === segs && splinter ? 1 : bare(t, a));
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    if (cap) {   // end face: the broken or sawn wood, slightly hollowed
      curve.getPointAt(1, P); const c0 = pos.length / 3; P.addScaledVector(fr.tangents[segs], -0.06);
      pos.push(P.x, P.y, P.z); uv.push(0.5, 0.5); const sh = shade(P); col.push(sh * 0.8, sh * 0.8, sh * 0.8); bw.push(1);
      const ring = segs * (radial + 1);
      for (let j = 0; j < radial; j++) idx.push(c0, ring + j + 1, ring + j);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aBare', new THREE.Float32BufferAttribute(bw, 1));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // The wolf den: a big saja thrown by a storm years ago. It lies across the clearing on its torn-up root plate,
  // and the wolves dug their burrow into the earth bank under the trunk, the log for a roof. Fresh spoil fans out
  // from the mouth, trodden into a path; bones lie about.
  buildDen() {
    const S = SITES.den, g = new THREE.Group(), rot = 0.2, rng = mulberry32(2207);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const world = (x, z) => [S.x + x * cs + z * sn, S.z - x * sn + z * cs];          // local -> world (group yaw)
    const gy = (x, z) => { const [wx, wz] = world(x, z); return groundHeight(wx, wz) - S.y; };   // ground height, local
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const wood = this.deadwoodMaterial(), earth = this.earthMaterial();
    const nz = (x, y) => Math.sin(x * 1.7 + Math.sin(y * 1.3) * 2) * Math.cos(y * 2.1 - x * 0.6);
    // contact shadow: wood is darker and damp within a few cm of the ground
    const shadeWood = (p) => 0.55 + 0.45 * clamp((p.y - gy(p.x, p.z)) / 0.35, 0, 1);

    // trunk: base (by the root plate) raised ~1 m on its roots, sagging onto the ground toward the broken top
    const bx = -3.4, bz = -0.6, len = 12.5;
    const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8, x = bx + t * len, z = bz - t * 1.6 + Math.sin(t * 3) * 0.25; const R = 0.56 + (0.24 - 0.56) * Math.pow(t, 0.8); const lift = 1.0 * Math.pow(1 - t, 2.2); pts.push(V(x, gy(x, z) + R * 0.88 + lift, z)); }
    const trunkCurve = new THREE.CatmullRomCurve3(pts);
    const trunkR = (t, a) => {
      const R = 0.56 + (0.24 - 0.56) * Math.pow(t, 0.8);
      const lobes = 1 + 0.06 * Math.sin(3 * a + t * 5) + 0.035 * Math.sin(7 * a - t * 11);
      const butt = 0.38 * Math.exp(-t * len / 0.9) * Math.pow(Math.max(0, Math.cos(4 * a + 0.7)), 3);   // buttress flare at the base
      return R * lobes + butt;
    };
    const trunkBare = (t, a) => clamp(0.5 + 0.6 * nz(t * 9, a * 1.3) + 0.25 * Math.sin(a) + t * 0.25, 0, 1);   // bark gone more on top and toward the old crown
    g.add(new THREE.Mesh(this.logTube(trunkCurve, trunkR, { segs: 70, radial: 26, bare: trunkBare, shade: shadeWood, cap: true, splinter: 0.45, seed: 11 }), wood));

    // broken branch stubs along the trunk, and dead limbs of the old crown lying on the ground past the break
    const along = (t) => trunkCurve.getPointAt(t);
    for (const [t, ang, l, r0] of [[0.32, 1.1, 0.9, 0.12], [0.46, -0.6, 0.55, 0.1], [0.58, 2.2, 1.4, 0.11], [0.7, 0.4, 0.7, 0.08], [0.82, -1.9, 1.1, 0.07]]) {
      const p = along(t), dir = V(0.35, Math.cos(ang), Math.sin(ang)).normalize();
      const a0 = p.clone().addScaledVector(dir, trunkR(t, 0) * 0.6), a1 = a0.clone().addScaledVector(dir, l).add(V(0, -0.15 * l, 0));
      if (a1.y < gy(a1.x, a1.z) + r0) a1.y = gy(a1.x, a1.z) + r0;
      g.add(new THREE.Mesh(this.logTube(new THREE.CatmullRomCurve3([a0, a0.clone().lerp(a1, 0.5).add(V(0, 0.05, 0)), a1]), (tt) => r0 * (1 - 0.55 * tt), { segs: 8, radial: 8, bare: () => 0.8, shade: shadeWood, cap: true, splinter: 0.12, seed: Math.round(t * 100) }), wood));
    }
    const tip = along(1);
    for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6 + (rng() - 0.5) * 0.3, l = 2.2 + rng() * 2.2, x0 = tip.x + 0.3, z0 = tip.z + (rng() - 0.5) * 0.6;
      const c = []; for (let q = 0; q <= 4; q++) { const f = q / 4, x = x0 + Math.cos(a) * l * f, z = z0 + Math.sin(a) * l * f + Math.sin(f * 4 + k) * 0.2; c.push(V(x, gy(x, z) + 0.07 - 0.03 * f, z)); }
      g.add(new THREE.Mesh(this.logTube(new THREE.CatmullRomCurve3(c), (tt) => 0.09 * (1 - 0.6 * tt), { segs: 12, radial: 7, bare: () => 0.9, shade: shadeWood, seed: 40 + k }), wood));
    }

    // root plate: the disc of earth and roots the tree tore up as it fell, standing on edge at the base
    const pc = V(bx - 0.25, gy(bx, bz) + 0.75, bz);
    {
      // a lumpy, flattened clod (not a slab): thick at the centre where the root mass is, thinning and crumbling
      // to a ragged edge, its faces knobbed with clods and stones
      const plate = new THREE.SphereGeometry(1, 64, 40);
      const p = plate.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, y), rr = Math.hypot(y, z);
        const R = 2.0 * (1 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7 - 2) + 0.06 * Math.sin(a * 13) + 0.05 * Math.sin(a * 29));
        const clod = 0.1 * nz(y * 4 + x, z * 4) + 0.06 * nz(y * 11, z * 9 + x * 3);
        const th = 0.5 * Math.pow(Math.max(0, 1 - rr * rr), 0.7) + 0.05;
        p.setXYZ(i, pc.x + x * (th + Math.abs(clod)) , pc.y + y * R * (y < 0 ? 0.75 : 1) * (1 + clod * 0.3), pc.z + z * R * (1 + clod * 0.3));
        const dark = (0.45 + 0.3 * rr + 0.18 * nz(y * 6, z * 6)) * (x < 0 ? 1.1 : 0.85);   // the torn underside paler, dried
        c.push(dark, dark * 0.92, dark * 0.82);
      }
      plate.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); plate.computeVertexNormals();
      g.add(new THREE.Mesh(plate, earth));
      // torn roots: thick ones out of the plate's rim, bent down by their own weight; thin ones on its face
      for (let k = 0; k < 30; k++) {
        const a = k / 30 * Math.PI * 2 + rng() * 0.3, thick = k % 3 === 0, R = 2.0 * (0.8 + rng() * 0.2), out = thick ? 0.7 + rng() * 1.0 : 0.4 + rng() * 0.5;
        const s0 = V(pc.x + 0.05, pc.y + Math.sin(a) * 0.35, pc.z + Math.cos(a) * 0.35), s1 = V(pc.x - 0.1 + (rng() - 0.5) * 0.3, pc.y + Math.sin(a) * R, pc.z + Math.cos(a) * R);
        const s2 = s1.clone().add(V(-0.2 * rng(), Math.sin(a) * out - out * 0.6, Math.cos(a) * out));
        g.add(new THREE.Mesh(this.logTube(new THREE.CatmullRomCurve3([s0, s0.clone().lerp(s1, 0.5).add(V(-0.15, 0, 0)), s1, s2]), (tt) => (thick ? 0.11 : 0.05) * (1 - 0.8 * tt), { segs: 14, radial: 7, bare: () => 0.2, shade: () => 0.5, seed: 70 + k }), wood));
      }
      // root ends sticking out of the torn face (the side away from the trunk) and hanging rootlets
      for (let k = 0; k < 22; k++) {
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * 1.5, y0 = pc.y + Math.sin(a) * rr * (Math.sin(a) < 0 ? 0.75 : 1), z0 = pc.z + Math.cos(a) * rr;
        const s0 = V(pc.x - 0.05, y0, z0), l = 0.25 + rng() * 0.6, s1 = V(pc.x - 0.25 - l * 0.6, y0 - l * (0.4 + rng() * 0.6), z0 + (rng() - 0.5) * 0.3);
        g.add(new THREE.Mesh(this.logTube(new THREE.CatmullRomCurve3([s0, s0.clone().lerp(s1, 0.5).add(V(-0.08, 0.05, 0)), s1]), (tt) => (0.012 + rng() * 0.0 + (k % 4 === 0 ? 0.03 : 0.008)) * (1 - 0.7 * tt), { segs: 6, radial: 5, bare: () => 0.15, shade: () => 0.45, seed: 120 + k }), wood));
      }
    }

    // the den: an earth bank under the trunk with the burrow dug into its front, a real hollow that darkens
    // inward, not a painted disc; the spoil from the digging fans out in front, trodden into a path
    const dc = V(-1.0, 0, -0.45), entAz = 0.08;   // bank centre; the mouth faces +z, toward the clearing
    {
      const bank = new THREE.SphereGeometry(1, 120, 48, 0, Math.PI * 2, 0, Math.PI / 2), p = bank.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) * 2.0, y = p.getY(i) * 0.95, z = p.getZ(i) * 1.55;
        const az = Math.atan2(p.getX(i), p.getZ(i)), el = Math.asin(clamp(p.getY(i), -1, 1));
        const lump = 1 + 0.08 * nz(x * 2, z * 2) + 0.05 * nz(x * 5 + 3, y * 5);
        x *= lump; z *= lump; y *= lump;
        // the burrow: an oval mouth ~0.6 m wide and ~0.45 m high, the earth pushed back into a tunnel ~1.4 m deep
        const m = 1 - ((az - entAz) / 0.27) ** 2 - ((el - 0.28) / 0.33) ** 2;
        let dark = 1;
        if (m > 0) { const depth = 1.45 * Math.pow(m, 0.6); const n = V(x, y, z).normalize(); x -= n.x * depth; y -= n.y * depth * 0.7; z -= n.z * depth; dark = 1 - 0.93 * Math.pow(m, 0.45); }
        const wx = dc.x + x, wz = dc.z + z, base = gy(wx, wz);
        p.setXYZ(i, wx, base - 0.12 + y, wz);
        const tone = (0.8 + 0.12 * nz(x * 3, z * 3)) * dark; c.push(tone, tone * 0.93, tone * 0.85);
      }
      bank.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); bank.computeVertexNormals();
      g.add(new THREE.Mesh(bank, earth));
      // spoil apron: paler, freshly dug earth with a darker trodden path down its middle
      const ap = new THREE.CircleGeometry(1, 64, -Math.PI / 2 - 1.1, 2.2); ap.rotateX(-Math.PI / 2);
      const q = ap.attributes.position, ac = [];
      for (let i = 0; i < q.count; i++) {
        const x = q.getX(i), z = q.getZ(i), rr = Math.hypot(x, z), lx = dc.x + Math.sin(entAz) * 1.35 + x * 1.7, lz = dc.z + Math.cos(entAz) * 1.35 + z * 2.2;
        const h = 0.16 * (1 - rr) * (1 - rr * 0.5) + 0.03 * nz(lx * 4, lz * 4);
        q.setXYZ(i, lx, gy(lx, lz) + 0.02 + h, lz);
        const path = Math.exp(-((x * 1.7) ** 2) / 0.12), tone = (1.15 - path * 0.3) * (0.9 + 0.1 * nz(lx * 6, lz * 6)); ac.push(tone * 1.05, tone * 0.92, tone * 0.78);
      }
      ap.setAttribute('color', new THREE.Float32BufferAttribute(ac, 3)); ap.computeVertexNormals();
      g.add(new THREE.Mesh(ap, earth));
    }
    // bones from old meals on the apron and around the mouth
    for (let i = 0; i < 9; i++) { const bx2 = dc.x + (rng() - 0.5) * 3.4, bz2 = dc.z + 1.6 + rng() * 2.2; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.25 + rng() * 0.3, 5), this.mats.bone); b.position.set(bx2, gy(bx2, bz2) + 0.04, bz2); b.rotation.set(Math.PI / 2, rng() * 3, 0); g.add(b); }
    { const kx = dc.x + 1.6, kz = dc.z + 2.2; const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), this.mats.bone); skull.scale.set(1, 0.8, 1.6); skull.position.set(kx, gy(kx, kz) + 0.07, kz); skull.rotation.y = 0.8; g.add(skull); }
    const marks = this.buildLodge(g, { gy, world, V, wood, earth, rng, nz, S });
    this.add(g, S.x, S.z, S.y, rot);
    this.veg.addExclusion(S.x, S.z, 14);
    // colliders: along the trunk, the root plate and the bank (the mouth itself stays open to walk up to)
    for (let k = 0; k <= 8; k++) { const t = k / 8, p = trunkCurve.getPointAt(t), [wx, wz] = world(p.x, p.z); this.collider(wx, wz, Math.max(0.35, trunkR(t, 1.5) * 0.95)); }
    { const [wx, wz] = world(pc.x, pc.z); this.collider(wx, wz, 1.3); const [ex, ez] = world(pc.x, pc.z + 1.3); this.collider(ex, ez, 0.9); const [fx2, fz2] = world(pc.x, pc.z - 1.3); this.collider(fx2, fz2, 0.9); }
    { const [wx, wz] = world(dc.x - 0.9, dc.z - 0.3); this.collider(wx, wz, 1.2); const [ex, ez] = world(dc.x + 1.0, dc.z - 0.2); this.collider(ex, ez, 0.9); }
    // tally marks: scratched into the trunk's flank beside the mouth
    this.addInteract({ id: 'denMarks', pos: marks, r: 2.2, prompt: 'Look at the marks', kind: 'clue' });
  }
  // Where he lives. The wolves' burrow is too small for a boy who has grown, so over the years he has dug out the bank behind the root
  // plate into a chamber he can stand up in, roofed with bent saplings and packed earth: a low mound from outside, with a hooped passage
  // for a door. Inside, a post, the rafters, a bed of leaves and hide, a hearth, wood stacked by the wall, the old bones, and his rows
  // of scratches. Nothing in it is made by anyone but him: he has never seen a house.
  // Local to the den's group. Returns where the marks are, in the world.
  buildLodge(g, { gy, world, V, wood, earth, rng, nz, S }) {
    const cx = -11.5, cz = -1.6, RX = 6.6, RZ = 5.8, RY = 3.7, WALL = 0.6, mAz = 0.72, W = 1.3, H = 2.35;
    const Dx = Math.sin(mAz), Dz = Math.cos(mAz);   // the way out
    // a point on the dome: az round it, el up it, `inset` in from the outside
    const dome = (az, el, inset, lump) => {
      const cr = Math.pow(Math.cos(el), 0.55), sy = Math.pow(Math.sin(el), 0.9);
      let x = Math.sin(az) * cr * (RX - inset), z = Math.cos(az) * cr * (RZ - inset), y = sy * (RY - inset);
      if (lump) { const l = 1 + 0.055 * nz(x * 0.9, z * 0.9) + 0.025 * nz(x * 2.3 + 2, y * 2); x *= l; z *= l; y *= l; }
      return [cx + x, y, cz + z];
    };
    const inDoor = (x, y, z) => { const ax = (x - cx) * Dx + (z - cz) * Dz; if (ax <= 0) return false; const lat = (x - cx) * Dz - (z - cz) * Dx; return (lat / W) ** 2 + (y / H) ** 2 < 1; };
    const build = (pos, col, idx) => { const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); G.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); G.setIndex(idx); G.computeVertexNormals(); const m = new THREE.Mesh(G, earth); g.add(m); return m; };
    // the two skins of the mound, with the door cut out of them
    const shell = (inset, inner) => {
      const NA = 112, NE = 28, pos = [], col = [], idx = [], rel = [];
      for (let j = 0; j <= NE; j++) for (let i = 0; i <= NA; i++) {
        const az = i / NA * Math.PI * 2, el = j / NE * Math.PI / 2, [x, y, z] = dome(az, el, inset, !inner), base = gy(x, z);
        pos.push(x, base - 0.1 + y, z); rel.push(y);
        const n = nz(x * 1.3, z * 1.3);
        if (inner) { const near = clamp(1 - Math.hypot(x - (cx + Dx * 5), z - (cz + Dz * 5)) / 8, 0, 1), t = (0.34 + 0.2 * el + 0.08 * n) * (0.8 + near * 0.55); col.push(t, t * 0.94, t * 0.88); }
        else { const top = clamp(el * 1.3 + 0.25 * n, 0, 1), t = 0.74 + 0.14 * n; col.push(t * (1 - top * 0.22), t * (0.93 - top * 0.02), t * (0.82 - top * 0.3)); }
      }
      const at = (i, j) => j * (NA + 1) + i, cut = (a) => inDoor(pos[a * 3], rel[a], pos[a * 3 + 2]);
      for (let j = 0; j < NE; j++) for (let i = 0; i < NA; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
        if (cut(a) || cut(b) || cut(c) || cut(d)) continue;
        if (inner) { idx.push(a, c, b); if (j < NE - 1) idx.push(b, c, d); } else { idx.push(a, b, c); if (j < NE - 1) idx.push(b, d, c); }
      }
      return build(pos, col, idx);
    };
    shell(0, false); shell(WALL, true);
    // the passage: an arch of packed earth through the wall, inner and outer skins and the lips that join them
    const r0 = 1 / Math.hypot(Dx / RX, Dz / RZ), s0 = r0 - WALL - 0.75, s1 = r0 + 1.5;
    const archPt = (s, u, w, h) => { const lat = w * Math.cos(u), x = cx + Dx * s + Dz * lat, z = cz + Dz * s - Dx * lat; return [x, gy(x, z) - 0.1 + h * Math.sin(u), z]; };
    {
      const NS = 10, NU = 20, pos = [], col = [], idx = [];
      const skin = (w, h, wf, hf, inner) => {
        const o = pos.length / 3;
        for (let k = 0; k <= NS; k++) for (let i = 0; i <= NU; i++) {
          const f = k / NS, s = s0 + (s1 - s0) * f, [x, y, z] = archPt(s, i / NU * Math.PI, w + wf * (1 - f), h + hf * (1 - f)); pos.push(x, y, z);
          const n = nz(x * 2, z * 2), t = inner ? (0.42 + f * 0.42 + 0.06 * n) : 0.72 + 0.14 * n; col.push(t, t * (inner ? 0.9 : 0.92), t * (inner ? 0.78 : 0.76));
        }
        for (let k = 0; k < NS; k++) for (let i = 0; i < NU; i++) { const a = o + k * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; if (inner) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
        return o;
      };
      const oi = skin(W, H, 0, 0, true), oo = skin(W + 0.5, H + 0.42, 0.75, 0.6, false);
      // the lips at each end (both windings, for they are seen from either side)
      for (const k of [0, NS]) for (let i = 0; i < NU; i++) { const a = oi + k * (NU + 1) + i, b = a + 1, c = oo + k * (NU + 1) + i, d = c + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
      build(pos, col, idx);
    }
    // the floor: packed earth, dark at the walls, with the trodden way out through the passage
    {
      const NA = 48, NR = 9, pos = [], col = [], idx = [];
      for (let k = 0; k <= NR; k++) for (let i = 0; i <= NA; i++) {
        const f = k / NR, az = i / NA * Math.PI * 2, x = cx + Math.sin(az) * (RX - WALL + 0.1) * f, z = cz + Math.cos(az) * (RZ - WALL + 0.1) * f;
        pos.push(x, gy(x, z) + 0.05, z);
        const t = (0.62 - f * f * 0.2 + 0.05 * nz(x * 3, z * 3)); col.push(t, t * 0.9, t * 0.76);
      }
      for (let k = 0; k < NR; k++) for (let i = 0; i < NA; i++) { const a = k * (NA + 1) + i, b = a + NA + 1, c = a + 1, d = b + 1; if (k) idx.push(a, b, c); idx.push(c, b, d); }
      const o = pos.length / 3, NS = 12;
      for (let k = 0; k <= NS; k++) for (const lat of [-1.05, 0, 1.05]) {
        const s = s0 - 0.3 + (s1 + 1.4 - s0 + 0.3) * k / NS, x = cx + Dx * s + Dz * lat, z = cz + Dz * s - Dx * lat;
        pos.push(x, gy(x, z) + 0.05 + (lat === 0 ? 0.008 : 0), z); const t = lat === 0 ? 0.74 : 0.7; col.push(t, t * 0.9, t * 0.76);
      }
      for (let k = 0; k < NS; k++) for (let l = 0; l < 2; l++) { const a = o + k * 3 + l, b = a + 3, c = a + 1, d = b + 1; idx.push(a, c, b, b, c, d); }
      build(pos, col, idx);
    }
    const poleM = std({ color: 0x6a4c34, vertexColors: true });
    const log = (pts, r0_, r1_, segs = 12) => g.add(new THREE.Mesh(this.logTube(new THREE.CatmullRomCurve3(pts), (t) => r0_ + (r1_ - r0_) * t, { segs, radial: 7, shade: () => 0.85 + rng() * 0.15, seed: 300 + Math.floor(rng() * 400) }), poleM));
    // bent saplings holding up the passage
    for (const s of [s1 - 0.08, s0 + 1.05, s0 + 0.2]) { const pts = []; for (let i = 0; i <= 8; i++) { const [x, y, z] = archPt(s, i / 8 * Math.PI, W - 0.05, H - 0.05); pts.push(V(x, y, z)); } log(pts, 0.085, 0.07, 18); }
    // the post and the rafters
    const postTop = gy(cx, cz) - 0.1 + RY - WALL;
    log([V(cx, gy(cx, cz) - 0.1, cz), V(cx + 0.04, gy(cx, cz) + 1.5, cz + 0.03), V(cx, postTop + 0.08, cz)], 0.17, 0.12, 8);
    for (let k = 0; k < 9; k++) {
      const az = k / 9 * Math.PI * 2 + 0.2, [x, y, z] = dome(az, 0.62, WALL + 0.05, false), wy = gy(x, z) - 0.1 + y;
      if (inDoor(x, y, z)) continue;
      const mx = (cx + x) * 0.5, mz = (cz + z) * 0.5;
      log([V(cx, postTop - 0.1, cz), V(mx, Math.min(gy(mx, mz) + dome(az, 1.05, WALL + 0.12, false)[1] - 0.1, (postTop + wy) * 0.5 + 0.12), mz), V(x, wy, z)], 0.075, 0.06, 10);
    }
    this.collider(...world(cx, cz), 0.22);
    // the bed, on the far side from the door: a heap of dry leaves with a hide over it, another rolled up for his head
    const ang = mAz + Math.PI + 0.45, bx = cx + Math.sin(ang) * (RX - WALL) * 0.62, bz = cz + Math.cos(ang) * (RZ - WALL) * 0.62, by = gy(bx, bz);
    const lump = (r, sx, sy, sz, col, x, y, z, rot = 0, rough = 1) => { const G = new THREE.SphereGeometry(r, 14, 9); G.scale(sx, sy, sz); const p = G.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + 0.07 * nz(p.getX(i) * 7, p.getZ(i) * 7); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } G.computeVertexNormals(); const m = new THREE.Mesh(G, std({ color: col, roughness: rough })); m.position.set(x, y, z); m.rotation.y = rot; g.add(m); return m; };
    lump(1, 1.3, 0.26, 0.72, 0x8a6f3a, bx, by + 0.1, bz, ang + Math.PI / 2);
    lump(1, 1.12, 0.2, 0.58, 0x6b4a2e, bx, by + 0.2, bz, ang + Math.PI / 2);
    { const px = bx + Math.cos(ang) * 0.82, pz = bz - Math.sin(ang) * 0.82; lump(0.2, 1.5, 0.75, 1.1, 0x57402c, px, by + 0.36, pz, ang); }
    // the hearth, between the post and the door
    const hx = cx + Dx * 2.0 + Dz * 0.5, hz = cz + Dz * 2.0 - Dx * 0.5, hy = gy(hx, hz) + 0.05;
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13 + rng() * 0.04, 0), std({ color: 0x6e665c })); s.position.set(hx + Math.cos(a) * 0.48, hy + 0.05, hz + Math.sin(a) * 0.48); s.rotation.set(rng() * 3, rng() * 3, 0); g.add(s); }
    { const ash = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), std({ color: 0x241c16 })); ash.rotation.x = -Math.PI / 2; ash.position.set(hx, hy + 0.012, hz); g.add(ash); }
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4, l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), this.mats.darkWood); l.rotation.set(1.15, a, 0, 'YXZ'); l.position.set(hx, hy + 0.13, hz); g.add(l); }
    // wood stacked against the wall, and what he has kept
    { const az = mAz - 1.5, sx = cx + Math.sin(az) * (RX - WALL) * 0.83, sz = cz + Math.cos(az) * (RZ - WALL) * 0.83, sy = gy(sx, sz) + 0.05;
      for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035 + rng() * 0.02, 0.045, 1.1 + rng() * 0.3, 6), this.mats.wood), row = i < 5 ? 0 : i < 9 ? 1 : 2, off = i - [0, 5, 9][row] - [2, 1.5, 1][row]; m.rotation.set(0, az, Math.PI / 2, 'YXZ'); m.position.set(sx + Math.cos(az) * off * 0.1, sy + 0.05 + row * 0.085, sz - Math.sin(az) * off * 0.1); g.add(m); } }
    { const az = mAz + 1.35; for (let i = 0; i < 7; i++) { const x = cx + Math.sin(az + (i - 3) * 0.05) * (RX - WALL) * 0.84, z = cz + Math.cos(az + (i - 3) * 0.05) * (RZ - WALL) * 0.84, b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.24 + rng() * 0.26, 5), this.mats.bone); b.position.set(x, gy(x, z) + 0.09, z); b.rotation.set(Math.PI / 2 - 0.1, rng() * 3, 0); g.add(b); } }
    // the marks: rows of scratches on the wall by the bed, one for every night
    const t0 = ang + 1.15, geos = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 24; c++) {
      if (r === 5 && c > 15) continue;
      const az = t0 + c * 0.036 + (c % 5 === 4 ? 0.012 : 0), el = 0.2 + r * 0.075, [x, y, z] = dome(az, el, WALL - 0.012, false);
      const G = new THREE.BoxGeometry(0.016, 0.13 + (rng() - 0.5) * 0.03, 0.03); G.rotateY(az); G.rotateZ((rng() - 0.5) * 0.14); G.translate(x, gy(x, z) - 0.1 + y, z); geos.push(G);
    }
    { const m = new THREE.Mesh(mergeGeometries(geos, false), std({ color: 0x17100a })); m.castShadow = false; g.add(m); }
    // stones along the foot of the mound either side of the door
    for (let i = 0; i < 26; i++) { const az = mAz + (i < 13 ? 1 : -1) * (0.3 + (i % 13) * 0.11), x = cx + Math.sin(az) * RX * 1.02, z = cz + Math.cos(az) * RZ * 1.02, s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rng() * 0.2, 0), this.mats.rock); s.position.set(x, gy(x, z) + 0.04, z); s.rotation.set(rng() * 3, rng() * 3, rng() * 3); s.scale.y = 0.65; g.add(s); }
    // in the world
    const [wcx, wcz] = world(cx, cz), W3 = (x, y, z) => { const [a, b] = world(x, z); return new THREE.Vector3(a, S.y + y, b); };
    this.veg.addExclusion(wcx, wcz, 13.5);
    CLEARINGS.push({ x: wcx, z: wcz, r: Math.max(RX, RZ) + 0.4 });
    { const [dx, dz] = world(cx + Dx * (r0 + 0.6), cz + Dz * (r0 + 0.6)); CLEARINGS.push({ x: dx, z: dz, r: 2.6 }); }
    const hearth = W3(hx, hy + 0.1, hz), bed = W3(bx, by + 0.4, bz), door = W3(cx + Dx * (s1 + 1), gy(cx + Dx * (s1 + 1), cz + Dz * (s1 + 1)), cz + Dz * (s1 + 1));
    this.addInteract({ id: 'denBed', pos: bed, r: 2.4, prompt: 'Sleep here (until morning)', kind: 'rest' });
    const ca = Math.cos(0.2), sa = Math.sin(0.2), rx2 = (RX - 0.2) ** 2, rz2 = (RZ - 0.2) ** 2;
    this.den = { hearth, bed, door, inside: (x, z) => { const dx = x - wcx, dz = z - wcz, lx = dx * ca - dz * sa, lz = dx * sa + dz * ca; return lx * lx / rx2 + lz * lz / rz2 < 1; } };
    const [mx, , mz] = dome(t0 + 12 * 0.036, 0.4, WALL, false); return W3(mx, gy(mx, mz) + 1.0, mz);
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

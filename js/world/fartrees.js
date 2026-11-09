// Far trees on a phone: one flat picture per tree, turning about its own upright to face the camera, all of them in one draw call.
//
// Measured on a Mali-G57: what holds a phone back is the layers of leaf cards, not how they are shaded. A far tree was a stack of cards, each
// cut out by the GPU, so a far hillside was drawn many times over. A picture is one layer and two triangles.
//
// The pictures are painted from the real trees, with the real materials and the sky's own light, into a small atlas. So they have the right
// shapes, season, flowers and time of day, and they stay right, because one species is painted again every so often. The sun is always put
// off to one side of the picture, so a tree looks rounded from whichever side it is seen.
import * as THREE from 'three';
import { G, ATMOS_VARY } from '../core/shaderlib.js';

const COLS = 4, CELL = 128, SIZE = COLS * CELL, REPAINT = 0.7;   // (seconds between one species being painted again)

const VERT = /* glsl */`
  attribute vec4 aA;   // x, y, z of the foot, and the picture's size (negative: mirrored)
  attribute vec2 aB;   // the picture's cell in the atlas
  varying vec2 vUv; varying vec3 vFog; varying float vFogF;
  ${ATMOS_VARY}
  void main() {
    vec2 f = normalize(cameraPosition.xz - aA.xz + vec2(1e-3, 0.0));
    float S = abs(aA.w);
    vec3 wp = aA.xyz + vec3(f.y, 0.0, -f.x) * position.x * S + vec3(0.0, position.y * S, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    vUv = (aB + vec2(aA.w < 0.0 ? 1.0 - uv.x : uv.x, uv.y)) * ${(1 / COLS).toFixed(6)};
    atmosVary(wp, vFog, vFogF);
  }`;
const FRAG = /* glsl */`
  uniform sampler2D tMap; varying vec2 vUv; varying vec3 vFog; varying float vFogF;
  void main() {
    vec4 t = texture2D(tMap, vUv);
    if (t.a < 0.4) discard;
    gl_FragColor = vec4(mix(t.rgb / t.a, vFog, vFogF), 1.0);   // (divided by alpha: the empty part of the atlas is black, and its edge would show)
  }`;

export class FarTrees {
  // kinds: [{ key, parts: [[geometry, material], ...] }]; a kind may be null (debris, drawn no other way)
  constructor(scene, kinds, cap) {
    this.scene = scene; this.cap = cap; this.n = 0; this.nNext = 0;
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: true, samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.back = new Float32Array(cap * 6);
    const q = new THREE.PlaneGeometry(1, 1); q.translate(0, 0.5, 0);
    const g = this.geo = new THREE.InstancedBufferGeometry(); g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.aA); g.setAttribute('aB', this.aB); g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { tMap: { value: this.rt.texture }, uFogColor: G.uFogColor, uFogSun: G.uFogSun, uSunDirF: G.uSunDirF, uFogDensity: G.uFogDensity, uFogHeight: G.uFogHeight, uFogBase: G.uFogBase } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.renderOrder = 1;   // (after the near trees: what they hide costs nothing)
    scene.add(this.mesh);
    // the painting scene: its own lights, one tree at a time
    const S = this.paintScene = new THREE.Scene();
    this.sun = new THREE.DirectionalLight(); this.hemi = new THREE.HemisphereLight(); S.add(this.sun, this.sun.target, this.hemi);
    this.cam = new THREE.PerspectiveCamera(20, 1, 1, 1000);
    this.kinds = kinds.map((k, i) => {
      if (!k) return null;
      const group = new THREE.Group(), box = new THREE.Box3(); group.visible = false; S.add(group);
      for (const [geo, mat] of k.parts) {
        const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; group.add(m);
        if (!geo.boundingBox) geo.computeBoundingBox();
        box.union(geo.boundingBox);
        // (cards spread from their centre in the shader, so the box must be widened by half a card)
        if (geo.attributes.aSize) { let w = 0; const a = geo.attributes.aSize; for (let j = 0; j < a.count; j++) w = Math.max(w, a.getX(j)); box.expandByScalar(w * 0.55); }
      }
      const W = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 2, H = box.max.y - box.min.y, size = Math.max(W, H) * 1.02;
      return { group, size, base: box.min.y, mid: box.min.y + size / 2 };
    });
    this.list = this.kinds.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
    this.next = 0; this.t = 0; this.dirty = true;
    this.kinds.forEach((k, i) => { if (k) { k.u = i % COLS; k.v = Math.floor(i / COLS); } });
    if (this.kinds.length > COLS * COLS) console.error('FarTrees: more kinds than cells');
  }
  // during the list's rebuild (nothing shows until commit)
  begin() { this.nNext = 0; }
  add(kind, x, y, z, s, rnd) {
    const k = this.kinds[kind]; if (!k || this.nNext >= this.cap) return;
    const B = this.back, i = this.nNext++ * 6;
    B[i] = x; B[i + 1] = y + k.base * s; B[i + 2] = z; B[i + 3] = k.size * s * ((rnd * 7.31) % 1 < 0.5 ? -1 : 1); B[i + 4] = k.u; B[i + 5] = k.v;
  }
  commit() {
    const n = this.n = this.nNext, B = this.back, A = this.aA.array, C = this.aB.array;
    for (let i = 0, j = 0; i < n; i++, j += 6) { A[i * 4] = B[j]; A[i * 4 + 1] = B[j + 1]; A[i * 4 + 2] = B[j + 2]; A[i * 4 + 3] = B[j + 3]; C[i * 2] = B[j + 4]; C[i * 2 + 1] = B[j + 5]; }
    this.geo.instanceCount = n; this.mesh.visible = n > 0;
    for (const a of [this.aA, this.aB]) { a.clearUpdateRanges(); if (n) { a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; } }
  }
  clear() { this.nNext = 0; this.commit(); }
  // once a frame, before the scene is drawn. sky: the world's lights.
  tick(r, sky, dt) {
    if (!this.list.length) return;
    const d = sky.sun.position.clone().sub(sky.sun.target.position).normalize();
    if (this.dirty || Math.abs(d.y - (this.lastY ?? 9)) > 0.2) { this.dirty = false; this.lastY = d.y; for (const i of this.list) this.paint(r, sky, i, d); return; }
    if ((this.t += dt) < REPAINT) return;
    this.t = 0; this.next = (this.next + 1) % this.list.length;
    if (this.next === 0) this.lastY = d.y;
    this.paint(r, sky, this.list[this.next], d);
  }
  paint(r, sky, i, d) {
    const k = this.kinds[i], cam = this.cam, dist = k.size * 2.2, rt = this.rt;
    this.sun.color.copy(sky.sun.color); this.sun.intensity = sky.sun.intensity; this.hemi.color.copy(sky.hemi.color); this.hemi.groundColor.copy(sky.hemi.groundColor); this.hemi.intensity = sky.hemi.intensity;
    const side = Math.sqrt(Math.max(0.0, 1 - d.y * d.y));
    this.sun.position.set(side * 0.6, Math.abs(d.y), side * 0.8); this.sun.target.position.set(0, 0, 0); this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    cam.fov = 2 * Math.atan(0.5 * k.size / dist) * 180 / Math.PI; cam.near = dist * 0.3; cam.far = dist * 3; cam.position.set(0, k.mid, dist); cam.lookAt(0, k.mid, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    for (const K of this.kinds) if (K) K.group.visible = false;
    k.group.visible = true;
    const was = r.getRenderTarget(), auto = r.autoClear, color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha(), focus = G.uFocus.value.w; G.uFocus.value.w = 0;   // (nothing to push aside for)
    rt.viewport.set(k.u * CELL, k.v * CELL, CELL, CELL); rt.scissor.set(k.u * CELL, k.v * CELL, CELL, CELL); rt.scissorTest = true;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.autoClear = false;
    r.render(this.paintScene, cam);
    r.autoClear = auto; r.setClearColor(color, alpha); r.setRenderTarget(was); G.uFocus.value.w = focus;
  }
}

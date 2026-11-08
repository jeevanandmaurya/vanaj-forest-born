// The painted look's one shading model (docs/art-direction.md). Three soft light bands from a ramp: shade
// (lit only by the coloured sky and ground light, so shadows are blue-violet, never black), half-light and full
// light; a rim of light on edges so forms separate from the background; optional slow wind sway. Built on
// MeshToonMaterial, so shadows, fog, instancing and skinning keep working.
import * as THREE from 'three';
import { patch, WIND_VERTEX } from './shaderlib.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function ramp() {
  // x is the light's angle (0.5 = the terminator); soft steps keep it painterly rather than hard cel
  const N = 64, d = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const x = (i + 0.5) / N; d[i] = Math.round(255 * (0.5 * ss(0.44, 0.54, x) + 0.5 * ss(0.6, 0.7, x))); }
  const t = new THREE.DataTexture(d, N, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
export const RAMP = ramp();
export const RIM = { value: new THREE.Color(0.25, 0.25, 0.3) };   // set each frame from the palette

// o: color, map, vertexColors, side, alphaTest, rim (strength), wind (sway, needs aWind/aRand), key, patch(shader)
export function toon(o = {}) {
  const m = new THREE.MeshToonMaterial({ color: o.color ?? 0xffffff, map: o.map || null, gradientMap: RAMP, vertexColors: !!o.vertexColors, side: o.side ?? THREE.FrontSide, alphaTest: o.alphaTest ?? 0 });
  const rim = (o.rim ?? 1).toFixed(2);
  patch(m, `toon-${o.key || 'base'}-${rim}${o.wind ? '-w' : ''}`, (s) => {
    s.uniforms.uRim = RIM;
    if (o.wind) {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n attribute float aWind; attribute float aRand; uniform float uTime; uniform vec2 uWind; uniform float uWindStrength;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERTEX);
    }
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n uniform vec3 uRim;')
      .replace('#include <opaque_fragment>', `outgoingLight += uRim * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.0) * ${rim};\n#include <opaque_fragment>`);
    if (o.patch) o.patch(s);
  });
  return m;
}

// patch() on top of whatever the material already does (the toon patch, or the global uniforms)
export function patchMore(m, key, fn) {
  const prev = m.onBeforeCompile;
  return patch(m, key, (s, r) => { prev.call(m, s, r); fn(s, r); });
}

// Ink lines for the living (art rule 7): an inverted hull, the mesh drawn again slightly swollen along smooth
// normals with only its back faces, in a dark warm ink. Skinned meshes get a skinned hull on the same skeleton.
// The ink is unlit, so it dims with the daylight by hand (INK_LIGHT, set each frame from the sky): at a fixed colour it stayed
// brighter than the unlit body it outlines after dark, and read as a pale brown line.
export const INK_LIGHT = { value: 1 };
const INK = new THREE.Color('#2a1c16'), _ws = new THREE.Vector3(), hulls = new Map();
function hullGeometry(g) {
  if (hulls.has(g)) return hulls.get(g);
  // weld split normals (hard edges, uv seams) so the hull swells as one surface and never cracks open
  let h = g.clone(); for (const k of Object.keys(h.attributes)) if (!['position', 'skinIndex', 'skinWeight'].includes(k)) h.deleteAttribute(k);
  h = mergeVertices(h, 1e-4); h.computeVertexNormals();
  hulls.set(g, h); return h;
}
function inkMaterial(w) {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  patch(m, 'ink', (s) => {
    s.uniforms.uInk = m.userData.w; s.uniforms.uInkLight = INK_LIGHT;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n uniform float uInk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * uInk;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n uniform float uInkLight;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= uInkLight;\n#include <opaque_fragment>');
  });
  m.userData.w = { value: w };
  return m;
}
// a texture read from a blurred mip level (bias in mip steps): large painted patterns stay, photo grain goes
export function softMap(s, bias) {
  s.fragmentShader = s.fragmentShader.replace('sampledDiffuseColor = texture2D( map, vMapUv );', `sampledDiffuseColor = texture2D( map, vMapUv, ${bias.toFixed(1)} );`);
}
// Swap an object's lit materials for toon ones and give it outlines (o.outline: width in metres, 0 for none;
// o.soften: mip bias for its textures, o.rim). Every call makes its own materials, so one character's can be
// hidden (first person) without touching others.
export function toonify(root, o = {}) {
  const width = o.outline ?? 0.012, soft = o.soften || 0, conv = new Map(), inks = new Map();
  root.updateMatrixWorld(true);
  const meshes = []; root.traverse((m) => { if (m.isMesh && !m.userData.ink) meshes.push(m); });
  const swap = (src) => {
    if (!src || !(src.isMeshStandardMaterial || src.isMeshLambertMaterial || src.isMeshPhongMaterial)) return src;
    if (!conv.has(src)) {
      const sm = soft && src.map && !src.alphaTest;   // alpha-cut shapes keep their full-detail edges
      const t = toon({ color: src.color, map: src.map, vertexColors: src.vertexColors, side: src.side, alphaTest: src.alphaTest, rim: o.rim ?? 0.6, key: sm ? 'char-s' + soft : 'char', patch: sm ? (s) => softMap(s, soft) : null });
      t.transparent = src.transparent; t.opacity = src.opacity; t.depthWrite = src.depthWrite; t.flatShading = src.flatShading;
      t.emissive.copy(src.emissive || t.emissive); t.emissiveIntensity = src.emissiveIntensity ?? 1;
      t.polygonOffset = src.polygonOffset; t.polygonOffsetFactor = src.polygonOffsetFactor; t.polygonOffsetUnits = src.polygonOffsetUnits;
      conv.set(src, t);
    }
    return conv.get(src);
  };
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    const m0 = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!width || mesh.isInstancedMesh || !m0 || m0.side !== THREE.FrontSide || m0.alphaTest > 0 || m0.transparent) continue;
    const g = mesh.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    const ws = mesh.getWorldScale(_ws).x || 1;
    if (g.boundingSphere.radius * ws < 0.04) continue;   // eyes, teeth, beads: too small to ink
    const k = (width / ws).toFixed(5);
    if (!inks.has(k)) inks.set(k, inkMaterial(width / ws));
    const hull = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(hullGeometry(g), inks.get(k)) : new THREE.Mesh(hullGeometry(g), inks.get(k));
    if (mesh.isSkinnedMesh) { hull.bind(mesh.skeleton, mesh.bindMatrix); hull.bindMode = mesh.bindMode; }
    hull.userData.ink = true; hull.castShadow = hull.receiveShadow = false; hull.frustumCulled = false; hull.raycast = () => {};
    mesh.add(hull);
  }
  return root;
}

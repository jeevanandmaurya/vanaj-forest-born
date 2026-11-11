// Pench landscape: analytic height field (Satpura hills, Pench river, Totladoh reservoir, plateau, maidan,
// waterholes, village), biome fields, chunked LOD terrain with skirts + far mesh, and a splat terrain shader.
import * as THREE from 'three';
import { smoothstep, clamp, lerp } from '../core/noise.js';
import { G, patch, NOISE_GLSL, NOISE_LOOKUP } from '../core/shaderlib.js';
import { PAINTED, PU } from '../core/palette.js';
import { toon } from '../core/toon.js';

import { LAND, WATER_STATE, buildGridRaw, CHUNK, HALF, RIVER_END_Z, RIVER_W, WATERHOLES, biomeAt, buildGridGen, ckey, height, heightCache, riverX, waterAt } from './land.js';
export * from './land.js';

// (here the water's rise is the weather's own number, read live)
Object.defineProperty(LAND, 'rise', { get: () => G.uWaterRise.value, set() {} });

// a chunk's arrays, as a geometry
function toGeo(r) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
  g.setAttribute('aSplat', new THREE.BufferAttribute(r.spl, 4)); g.setAttribute('aBio', new THREE.BufferAttribute(r.bio, 4)); g.setAttribute('aField', new THREE.BufferAttribute(r.fld, 1));
  g.setIndex(new THREE.BufferAttribute(r.idx, 1)); g.computeBoundingSphere();
  return { geometry: g, hgrid: r.hgrid, step: r.step };
}
const buildGridGeometry = (...a) => toGeo(buildGridRaw(...a));

export function createTerrainMaterial(tex, far, lq = false) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0 });
  m.userData.near = { value: new THREE.Vector4(0, 0, 0, 0) };
  patch(m, (far ? 'terrain-far' : 'terrain') + (lq ? '-lq' : ''), (s) => {
    s.uniforms.tLitter = { value: tex.litter }; s.uniforms.tLitterM = { value: tex.litterMoist }; s.uniforms.tSoil = { value: tex.soil };
    s.uniforms.tRock = { value: tex.rock }; s.uniforms.tGrassG = { value: tex.grassGround }; s.uniforms.tSand = { value: tex.sand };
    s.uniforms.tRed = { value: tex.redSoil }; s.uniforms.tBlack = { value: tex.blackSoil }; s.uniforms.tAtlas = { value: tex.groundAtlas };
    s.uniforms.uNearRect = m.userData.near;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat; attribute vec4 aBio; attribute float aField;
        varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
        vSplat = aSplat; vBio = aBio; vField = aField;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        ${lq ? '#define TERRAIN_LQ' : ''}
        ${NOISE_GLSL}
        uniform sampler2D tLitter, tLitterM, tSoil, tRock, tGrassG, tSand, tRed, tBlack, tGroundAO, tAtlas; uniform vec4 uNearRect, uAORect;
        uniform float uSeasonGreen, uWetness, uDry, uTime; uniform vec2 uWind; uniform vec3 uSunDir;
        varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;
        float lum(vec3 c){ return dot(c, vec3(0.3,0.55,0.15)); }
        // ---- texture bombing: every fallen leaf, twig and pebble placed individually (no repeating tile)
        // mode 0 = mixed litter, 1 = pebbles, 2 = twigs & dry grass
        int pickSprite(float h, int mode, float moist, float lat, float grassW, float green) {
          if (mode == 1) return 12 + int(h * 2.99);
          if (mode == 2) return h < grassW ? 15 : 10 + int(fract(h * 31.0) * 1.99);
          float u = fract(h * 7.13);
          if (u < lat * 0.22) return 12 + int(fract(u * 53.0) * 2.99);
          if (moist > 0.45 && u < 0.08 + moist * 0.3) return 9;
          if (u < 0.62) { if (fract(u * 5.7) < green * 0.14) return 3; return int(fract(u * 17.3) * 2.99); }   // few fallen leaves are still green
          if (u < 0.72) return 4;
          if (u < 0.8) return 5;
          if (u < 0.92) return 6 + int(fract(u * 11.0) * 1.99);
          return 8;
        }
        vec4 bomb(vec2 g, vec2 gdx, vec2 gdy, float seed, float density, float scMin, float scMax, int mode, float moist, float lat, float grassW, float green, float wet, float dry) {
          vec4 acc = vec4(0.0);
          vec2 gi = floor(g) - 1.0;
          for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
            vec2 c = gi + vec2(float(i), float(j));
            if (hash12(c * 1.37 + seed) > density) continue;
            vec2 ctr = c + 0.5 + (vec2(hash12(c + seed + 1.7), hash12(c + seed + 3.1)) - 0.5) * 0.8;
            float ang = hash12(c + seed + 5.3) * 6.2832, cs = cos(ang), sn = sin(ang);
            float sc = mix(scMin, scMax, hash12(c + seed + 7.9));
            vec2 d = (g - ctr) / sc;
            vec2 l = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
            if (abs(l.x) > 0.5 || abs(l.y) > 0.5) continue;
            float hs = hash12(c + seed + 9.7);
            int k = pickSprite(hs, mode, moist, lat, grassW, green);
            float col = float(k - (k / 4) * 4), row = float(k / 4);
            vec2 auv = vec2((col + l.x + 0.5) * 0.25, 1.0 - (row + l.y + 0.5) * 0.25);
            vec2 rx = vec2(cs * gdx.x - sn * gdx.y, sn * gdx.x + cs * gdx.y) / sc, ry = vec2(cs * gdy.x - sn * gdy.y, sn * gdy.x + cs * gdy.y) / sc;
            vec4 t = textureGrad(tAtlas, auv, vec2(rx.x, -rx.y) * 0.25, vec2(ry.x, -ry.y) * 0.25);
            float age = hash12(c + seed + 11.3);
            vec3 tint = mix(vec3(1.06, 1.0, 0.92), vec3(0.72, 0.7, 0.66), age * age);          // fresh fall -> weathered grey
            if (mode == 0) tint *= mix(vec3(1.0), vec3(1.12, 1.04, 0.86), dry) * mix(1.0, 0.62, wet);
            t.rgb *= tint * (0.72 + 0.28 * t.a);                                                 // darker, lifted edges
            acc.rgb = mix(acc.rgb, t.rgb, t.a); acc.a = max(acc.a, t.a);
          }
          return acc;
        }`)
      .replace('#include <map_fragment>', `
        ${far ? 'if (vWP.x > uNearRect.x && vWP.x < uNearRect.z && vWP.z > uNearRect.y && vWP.z < uNearRect.w) discard;' : ''}
        vec2 uv = vWP.xz;
        float macro = fbm2(uv * 0.011);
        float n2 = vnoise(uv * 0.09);
        float hueN = vnoise(uv * 0.0065 + 3.1);
        float patchN = fbm2(uv * 0.045 + 7.3);
        float slope = 1.0 - vWN.y;
        vec4 bio = vBio; // x moisture, y canopy, z laterite, w black soil
        float fieldW = max(vField, 0.0), bedW = smoothstep(0.0, 0.6, -vField);
        const mat2 R1 = mat2(0.743, -0.669, 0.669, 0.743);
        // leaf litter, sampled at two rotated scales and blended by noise so the tile never repeats visibly
        float sel = smoothstep(0.3, 0.7, vnoise(uv * 0.06 + 11.0));
        vec3 tl = mix(texture2D(tLitter, uv * 0.21).rgb, texture2D(tLitter, R1 * uv * 0.163 + 0.31).rgb, sel);
        float camDg = length(vViewPosition);
        #ifndef TERRAIN_LQ
        float nf = 1.0 - smoothstep(16.0, 42.0, camDg);
        #else
        float nf = 1.0 - smoothstep(10.0, 24.0, camDg);
        #endif
        vec2 gdx = dFdx(uv), gdy = dFdy(uv);
        float fieldW0 = max(vField, 0.0), bedW0 = smoothstep(0.0, 0.6, -vField);
        vec4 pebL = vec4(0.0);
        #ifndef TERRAIN_LQ
        tl = mix(tl, texture2D(tLitter, uv * 0.053 + 0.37).rgb, 0.3);
        vec3 tm = mix(texture2D(tLitterM, R1 * uv * 0.2).rgb, texture2D(tLitterM, uv * 0.067 + 0.7).rgb, 0.35);
        vec3 tred = mix(texture2D(tRed, uv * 0.14).rgb, texture2D(tRed, R1 * uv * 0.045).rgb, 0.35);
        #else
        vec3 tm = texture2D(tLitterM, R1 * uv * 0.2).rgb;
        vec3 tred = texture2D(tRed, uv * 0.14).rgb;
        #endif
        vec3 ts = mix(texture2D(tSoil, uv * 0.16).rgb, texture2D(tSoil, uv * 0.041).rgb, 0.4);
        vec3 tblk = texture2D(tBlack, uv * 0.085).rgb;
        vec3 tg = mix(texture2D(tGrassG, uv * 0.19).rgb, texture2D(tGrassG, uv * 0.049 + 0.5).rgb, 0.4);
        vec3 tnd = texture2D(tSand, uv * 0.12).rgb;
        vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 tr = texture2D(tRock, vWP.zy * 0.07).rgb * bw.x + texture2D(tRock, vWP.xz * 0.07).rgb * bw.y + texture2D(tRock, vWP.xy * 0.07).rgb * bw.z;
        float green = clamp(uSeasonGreen * (0.75 + 0.5 * macro), 0.0, 1.0);
        tg *= mix(vec3(1.12, 0.95, 0.62), vec3(0.58, 0.84, 0.38), green);
        // litter character drifts across the forest: fresh golden teak fall, grey weathered litter, russet patches
        tl = mix(vec3(lum(tl)), tl, 0.72);                                  // teak litter is tan-brown, not orange
        if (nf > 0.001) {
          float slope0 = 1.0 - vWN.y;
          float cov0 = smoothstep(0.25, 0.62, fbm2(uv * 0.045 + 7.3) + vBio.y * 0.35 - slope0 * 0.9 - vBio.z * 0.18 + 0.1);
          float grass0 = vSplat.y;
          float dens = mix(0.25, 1.0, cov0) * (1.0 - bedW0) * (1.0 - fieldW0 * 0.9) * mix(1.0, 0.45, grass0) * mix(1.0, 0.75, uWetness);
          // base: the litter mat itself (broken, half-buried leaves), with bare humus where cover is thin
          vec3 humus = mix(texture2D(tSoil, uv * 0.16).rgb * vec3(0.62, 0.55, 0.48), texture2D(tBlack, uv * 0.085).rgb * 0.75, 0.45);
          humus = mix(humus, tl * 0.82, mix(0.35, 0.9, cov0));
          float gr = clamp(uSeasonGreen, 0.0, 1.0);
          vec4 Ls = bomb(uv / 0.26 + 7.1, gdx / 0.26, gdy / 0.26, 23.0, dens, 0.9, 1.6, 0, vBio.x, vBio.z, grass0, gr, uWetness, uDry);
          vec4 Lb = bomb(uv / 0.42, gdx / 0.42, gdy / 0.42, 11.0, dens * 0.95, 1.0, 1.75, 0, vBio.x, vBio.z, grass0, gr, uWetness, uDry);
          #ifndef TERRAIN_LQ
          vec4 Lt = bomb(uv / 0.9 + 3.3, gdx / 0.9, gdy / 0.9, 37.0, (0.2 + grass0 * 0.5) * (1.0 - bedW0), 0.8, 1.2, 2, vBio.x, vBio.z, grass0, gr, uWetness, uDry);
          #else
          vec4 Lt = vec4(0.0);
          #endif
          vec3 near = humus;
          near = mix(near, Ls.rgb, Ls.a);
          near = mix(near * (1.0 - Lb.a * 0.25), Lb.rgb, Lb.a);               // big leaves shade what lies under them
          near = mix(near, Lt.rgb, Lt.a);
          tl = mix(tl, near, nf);
          if (bedW0 > 0.01) pebL = bomb(uv / 0.2 + 1.9, gdx / 0.2, gdy / 0.2, 51.0, 0.72, 0.6, 1.0, 1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        }
        vec3 litTint = mix(vec3(1.08, 0.98, 0.8), vec3(0.8, 0.79, 0.77), smoothstep(0.3, 0.7, hueN));
        litTint = mix(litTint, vec3(1.06, 0.84, 0.7), smoothstep(0.6, 0.85, vnoise(uv * 0.011 - 5.0)) * 0.7);
        litTint = mix(litTint, vec3(0.62, 0.56, 0.48), smoothstep(0.62, 0.82, vnoise(uv * 0.021 + 17.0)) * 0.6);   // dark rotted patches
        litTint = mix(litTint, vec3(1.16, 1.04, 0.82), uDry * 0.45);
        tl *= litTint;
        // damp, half-rotted litter near water, in bamboo, and through the rains
        float moistW = clamp(bio.x * 1.1 + uWetness * 0.25 - uDry * 0.3 + (patchN - 0.5) * 0.5, 0.0, 1.0);
        tl = mix(tl, tm, smoothstep(0.3, 0.75, moistW) * mix(1.0, 0.3, nf));
        tl *= mix(vec3(1.05, 0.98, 0.9), vec3(0.76, 0.86, 0.6), green * 0.5);
        float sprout = green * smoothstep(0.74, 0.8, vnoise(uv * 3.1)) * (1.0 - uDry);
        tl = mix(tl, vec3(0.15, 0.25, 0.07), sprout * 0.55);
        // bare ground where the litter is thin: red laterite on ridges and slopes, black soil on flats, brown loam elsewhere
        float latW = clamp(bio.z + slope * 1.2 - 0.25, 0.0, 1.0);
        vec3 bare = mix(ts, tred, smoothstep(0.2, 0.7, latW));
        bare = mix(bare, tblk * mix(1.0, 0.7, uWetness), smoothstep(0.3, 0.7, bio.w) * (1.0 - latW * 0.6));
        float cover = smoothstep(0.32, 0.6, patchN + bio.y * 0.35 - slope * 0.9 - bio.z * 0.18 + 0.1);
        vec4 w = vSplat;
        w.z = max(w.z, smoothstep(0.38, 0.6, slope + (n2 - 0.5) * 0.2));
        w.y *= 0.6 + 0.8 * vnoise(uv * 0.05);
        vec4 hb = vec4(lum(tl), lum(tg), lum(tr), lum(tnd)) + 0.35;
        w = w * hb * hb * hb * hb; w /= (w.x + w.y + w.z + w.w + 1e-4);
        vec3 tcol = tl * w.x + tg * w.y + tr * w.z + tnd * w.w;
        tcol = mix(tcol, bare, (1.0 - cover) * w.x * 0.85 * mix(1.0, 0.45, nf));
        tcol = mix(tcol, bare, (1.0 - smoothstep(0.15, 0.45, patchN + 0.15)) * w.y * 0.45);
        vec3 fieldC = mix(vec3(0.42, 0.3, 0.19), vec3(0.36, 0.42, 0.18), green) * (0.8 + 0.4 * vnoise(vec2(uv.x * 0.6, uv.y * 0.03)));
        tcol = mix(tcol, fieldC * (0.9 + 0.2 * sin(uv.x * 2.2)), fieldW * 0.85);
        // burn scars of the summer ground fires: ash, charred litter, a few pale ash flecks
        float burn = uDry * smoothstep(0.64, 0.7, fbm2(uv * 0.006 + 9.0)) * bio.y * (1.0 - w.z) * (1.0 - w.w) * (1.0 - fieldW) * (1.0 - bedW);
        vec3 ashC = vec3(0.075, 0.07, 0.065) + vec3(0.22) * smoothstep(0.78, 0.92, vnoise(uv * 2.3));
        tcol = mix(tcol, ashC, burn * 0.85);
        tcol *= 0.84 + 0.32 * macro;
        // submerged bed: dark pebbles, silt and algae film instead of dry pale sand
        vec3 bedC = mix(tr * vec3(0.3, 0.32, 0.24), tblk * vec3(0.45, 0.5, 0.36), smoothstep(0.35, 0.65, vnoise(uv * 0.7)));
        bedC = mix(bedC, vec3(0.16, 0.2, 0.08), smoothstep(0.55, 0.8, vnoise(uv * 0.23 + 4.0)) * 0.5 * (1.0 - uWetness));
        vec3 silt = mix(vec3(0.1, 0.095, 0.07), vec3(0.15, 0.135, 0.1), vnoise(uv * 1.3)) * mix(1.0, 0.7, smoothstep(0.4, 0.7, vnoise(uv * 0.21 + 9.0)));
        bedC = mix(bedC * 0.6, silt, 0.6);
        bedC = mix(bedC, pebL.rgb * vec3(0.4, 0.42, 0.34), pebL.a * nf);
        tcol = mix(tcol, bedC, bedW * 0.9);
        // ground occlusion around trunks / rocks and shade under crowns
        vec2 aoUV = (vWP.xz - uAORect.xy) * uAORect.z;
        vec2 aoE = smoothstep(vec2(0.0), vec2(0.06), aoUV) * smoothstep(vec2(1.0), vec2(0.94), aoUV);
        float aoIn = aoE.x * aoE.y * uAORect.w;
        vec3 aoS = texture2D(tGroundAO, clamp(aoUV, 0.0, 1.0)).rgb * aoIn;
        float contact = clamp(aoS.r, 0.0, 1.0);
        float gCanopy = clamp(aoS.g * 1.7 + bio.y * 0.35 * (1.0 - aoIn), 0.0, 1.0);
        tcol *= 1.0 - contact * 0.55;
        tcol *= 1.0 - gCanopy * 0.1;
        // wetness and rain puddles on flat ground
        float flatG = smoothstep(0.06, 0.01, slope);
        float puddle = clamp(uWetness * 1.4 - 0.3, 0.0, 1.0) * smoothstep(0.6, 0.68, vnoise(uv * 0.11 + 2.0) * 0.7 + vnoise(uv * 0.5) * 0.3) * flatG * (1.0 - w.z) * (1.0 - w.w) * (1.0 - bedW);
        float wet = clamp(uWetness * (0.6 + 0.4 * n2) + w.w * 0.5 + bedW, 0.0, 1.0);
        tcol *= mix(1.0, 0.6, wet);
        tcol = mix(tcol, tcol * 0.4 + vec3(0.02, 0.022, 0.02), puddle);
        diffuseColor.rgb = tcol;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(mix(0.96, 0.42, wet), 0.05, puddle);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float bh = lum(tcol) * 3.0;
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(bh), dhy = dFdy(bh);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          float bs = 0.018 * (1.0 - smoothstep(8.0, 30.0, length(vViewPosition))) * (1.0 - puddle);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad * bs);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // dappled sun flecks under the canopy: leaf gaps projected along the sun, drifting with the wind
          vec2 sp = vWP.xz - uSunDir.xz / max(uSunDir.y, 0.25) * 9.0;
          vec2 wo = uWind * uTime * 0.35;
          float ck = vnoise(sp * 0.55 + wo) * 0.6 + vnoise(sp * 1.6 - wo * 1.7) * 0.4;
          ck = smoothstep(0.36, 0.64, ck);
          float dap = mix(1.0, 0.42 + ck * 1.0, gCanopy * 0.62);
          reflectedLight.directDiffuse *= dap; reflectedLight.directSpecular *= dap;
          reflectedLight.indirectDiffuse *= 1.0 - gCanopy * 0.16 - contact * 0.42;
          if (bedW > 0.01) {   // sunlight focused by the ripples above dances on the bed
            float bd = max(-vField, 0.0);
            vec2 cp = vWP.xz * 1.15 + uWind * uTime * 0.25;
            vec2 c1 = cell3(vec3(cp, uTime * 0.45)), c2 = cell3(vec3(cp * 1.7 + 4.0, uTime * 0.6 + 2.0));
            float ca = (1.0 - smoothstep(0.0, 0.09, c1.y - c1.x)) * 0.65 + (1.0 - smoothstep(0.0, 0.07, c2.y - c2.x)) * 0.45;
            reflectedLight.directDiffuse *= 1.0 + ca * 1.6 * bedW * exp(-bd * 0.7) * (1.0 - uWetness * 0.7);
          }
        }`);
  });
  return m;
}

// The painted look's ground (docs/art-direction.md): the season's colours laid in broad patches with two-tone
// brush strokes, crisp edges between ground types, a scatter of painted fallen leaves near the camera, cool
// (never black) contact shadows, and sun flecks under the canopy. Same attributes as the realistic shader.
export function createPaintedTerrainMaterial(far, lq = false) {
  const m = toon({
    key: (far ? 'terrain-far' : 'terrain') + (lq ? '-lq' : ''), rim: 0, patch: (s) => {
      Object.assign(s.uniforms, PU);
      s.uniforms.uNearRect = m.userData.near; s.uniforms.uTreeFar = m.userData.treeFar;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aSplat; attribute vec4 aBio; attribute float aField;
          varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
          vSplat = aSplat; vBio = aBio; vField = aField;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          ${lq ? '#define TERRAIN_LQ' : ''}
          ${NOISE_GLSL}
          ${lq ? NOISE_LOOKUP : ''}
          uniform sampler2D tGroundAO; uniform vec4 uNearRect, uAORect;
          uniform float uSeasonGreen, uWetness, uDry, uTime; uniform vec2 uWind; uniform vec3 uSunDir;
          uniform vec3 uGround, uGrassRoot, uGrassTip, uRock, uSand, uLaterite, uRiver;
          ${far ? 'uniform float uTreeFar; uniform vec3 uLeafShade, uLeafLit;' : ''}
          varying vec4 vSplat; varying vec4 vBio; varying float vField; varying vec3 vWP; varying vec3 vWN;
          float aaStep(float e, float x) { float w = fwidth(x) * 0.75 + 1e-4; return smoothstep(e - w, e + w, x); }
          // one fallen leaf per lucky cell: a flat painted oval in teak-fall colours
          vec4 leafDot(vec2 p, float dens, float dry) {
            vec2 c = floor(p), f = fract(p) - 0.5;
            if (hash12(c * 1.31) > dens) return vec4(0.0);
            vec2 o = (vec2(hash12(c + 1.7), hash12(c + 3.1)) - 0.5) * 0.36;
            float a = hash12(c + 5.3) * 6.2832, cs = cos(a), sn = sin(a);
            vec2 q = f - o; q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
            float e = length(q * vec2(1.0, 2.1));
            float h = hash12(c + 9.7);
            vec3 col = h < 0.35 ? vec3(0.62, 0.26, 0.07) : h < 0.65 ? vec3(0.7, 0.45, 0.1) : h < 0.85 ? vec3(0.4, 0.17, 0.08) : vec3(0.42, 0.27, 0.12);
            col *= (0.8 + 0.4 * hash12(c + 13.1)) * mix(vec3(1.0), vec3(1.15, 1.05, 0.8), dry);
            return vec4(col, 1.0 - aaStep(0.17, e));
          }`)
        .replace('#include <map_fragment>', `
          ${far ? 'if (vWP.x > uNearRect.x && vWP.x < uNearRect.z && vWP.z > uNearRect.y && vWP.z < uNearRect.w) discard;' : ''}
          vec2 uv = vWP.xz;
          float slope = 1.0 - vWN.y, camD = length(vViewPosition);
          vec4 bio = vBio;   // x moisture, y canopy, z laterite, w black soil
          float fieldW = max(vField, 0.0), bedW = smoothstep(0.0, 0.6, -vField);
          // (the ground is most of the screen, and noise is what its shader spends its time on: Low makes do with five lookups a pixel, not eighteen)
          #ifdef TERRAIN_LQ
          float big = vnoise(uv * 0.016) * 0.62 + vnoise(uv * 0.045 + 1.7) * 0.34, mid = vnoise(uv * 0.09 + 3.0);
          float st = vnoise(vec2((0.86 * uv.x + 0.5 * uv.y) * 0.45, (0.86 * uv.y - 0.5 * uv.x) * 0.9));
          #else
          float big = fbm2(uv * 0.016), mid = vnoise(uv * 0.09 + 3.0);
          // brush strokes: noise stretched along a slowly turning direction, cut into a light and a dark tone
          float ang = vnoise(uv * 0.015 + 7.0) * 6.2832; vec2 sdir = vec2(cos(ang), sin(ang));
          vec2 su = vec2(dot(uv, sdir), dot(uv, vec2(-sdir.y, sdir.x)));
          float st = vnoise(vec2(su.x * 0.45, su.y * 0.9)) * 0.6 + vnoise(uv * 0.5 + 4.0) * 0.4;
          #endif
          float strokeW = 1.0 - smoothstep(60.0, 160.0, camD);
          float sL = aaStep(0.66, st) * strokeW, sD = aaStep(0.68, 1.0 - st) * strokeW;
          // forest floor: the season's ground colour in warm and cool patches, red laterite on ridges and
          // slopes, dark black-cotton soil on the flats
          vec3 gnd = uGround * mix(vec3(0.82, 0.78, 0.88), vec3(1.08, 1.0, 0.9), smoothstep(0.35, 0.65, big));
          gnd = mix(gnd, gnd * vec3(1.14, 1.08, 0.94), sL * 0.4);
          gnd = mix(gnd, gnd * vec3(0.86, 0.84, 0.92), sD * 0.35);
          {
            // Under the trees the floor is three paints, cut to shapes by the noise already in hand: drifts of fallen leaf (rust in winter,
            // bleached in the hot months, dark after rain), moss and low green in the damp hollows, and pale earth where the game trails run.
            float shade = 0.4 + 0.6 * smoothstep(0.05, 0.45, bio.y);
            float drift = aaStep(0.51, (1.0 - big) * 0.65 + mid * 0.35) * shade;
            vec3 litter = mix(vec3(0.27, 0.145, 0.06), vec3(0.5, 0.33, 0.15), uDry * uDry) * mix(1.0, 0.6, uWetness) * (0.85 + 0.3 * mid);   // (linear light, like every colour here)
            gnd = mix(gnd, litter, drift * 0.6);
            float damp = clamp(bio.x * 0.9 + uSeasonGreen * 0.8 - uDry * 0.45, 0.0, 1.0);
            float moss = aaStep(0.55, big * 0.55 + (1.0 - mid) * 0.45 + damp * 0.16) * smoothstep(0.05, 0.38, damp) * (1.0 - drift * 0.8);
            vec3 mossC = mix(uGrassRoot, uGrassTip, 0.16 + 0.22 * mid) * vec3(0.9, 1.0, 0.84);
            gnd = mix(gnd, mossC, moss * 0.8);
            #ifndef TERRAIN_LQ
            float trail = (1.0 - aaStep(0.045, abs(vnoise(uv * 0.021 + 11.0) - 0.5))) * (1.0 - moss);
            gnd = mix(gnd, uGround * vec3(1.16, 1.1, 0.98), trail * 0.5);
            #endif
          }
          float latW = clamp(bio.z + slope * 1.2 - 0.25, 0.0, 1.0);
          gnd = mix(gnd, uLaterite * (0.85 + 0.25 * mid), smoothstep(0.45, 0.85, latW) * 0.6);
          gnd = mix(gnd, uGround * vec3(0.5, 0.48, 0.52), smoothstep(0.35, 0.7, bio.w) * (1.0 - latW) * 0.6);
          vec3 grass = mix(uGrassRoot, uGrassTip, 0.25 + 0.5 * smoothstep(0.3, 0.7, big + (mid - 0.5) * 0.4));
          grass = mix(grass, grass * vec3(1.12, 1.1, 0.9), sL * 0.7);
          grass = mix(grass, grass * vec3(0.82, 0.86, 0.94), sD * 0.6);
          vec3 rock = uRock * (0.8 + 0.3 * mid) * mix(vec3(1.0), vec3(1.08, 1.0, 0.9), sL);
          vec3 sand = uSand * (0.9 + 0.15 * big);
          // sharpened weights: patches meet at a painted edge, not a photographic blend
          vec4 w = vSplat;
          w.z = max(w.z, smoothstep(0.42, 0.6, slope + (mid - 0.5) * 0.15));
          #ifdef TERRAIN_LQ
          w.y *= 0.7 + 0.6 * mid;
          #else
          w.y *= 0.7 + 0.6 * vnoise(uv * 0.05);
          #endif
          w = w * w * w; w /= (w.x + w.y + w.z + w.w + 1e-5);
          vec3 tcol = gnd * w.x + grass * w.y + rock * w.z + sand * w.w;
          #ifndef TERRAIN_LQ
          float nf = 1.0 - smoothstep(18.0, 34.0, camD);
          if (nf > 0.001) {
            float dens = (0.22 + 0.3 * bio.y) * w.x * (1.0 - bedW) * (1.0 - fieldW);
            vec4 L1 = leafDot(uv / 0.85, dens, uDry), L2 = leafDot(uv / 1.15 + 17.3, dens * 0.8, uDry);
            tcol = mix(tcol, L1.rgb, L1.a * nf); tcol = mix(tcol, L2.rgb, L2.a * nf);
          }
          #endif
          vec3 fieldC = mix(uGround * vec3(1.0, 0.88, 0.7), uGrassRoot * 1.15, uSeasonGreen) * (0.88 + 0.22 * aaStep(0.5, 0.5 + 0.5 * sin(uv.x * 2.2)));
          tcol = mix(tcol, fieldC, fieldW * 0.85);
          if (uDry > 0.01) {
            float burn = uDry * smoothstep(0.64, 0.7, fbm2(uv * 0.006 + 9.0)) * bio.y * w.x * (1.0 - bedW) * (1.0 - fieldW);
            tcol = mix(tcol, vec3(0.1, 0.09, 0.1), burn * 0.7);
          }
          #ifdef TERRAIN_LQ
          vec3 bedC = mix(uRiver * vec3(0.35, 0.45, 0.4), uRock * 0.5, 0.3);
          #else
          vec3 bedC = mix(uRiver * vec3(0.35, 0.45, 0.4), uRock * 0.5, aaStep(0.55, vnoise(uv * 0.6)) * 0.6);
          #endif
          tcol = mix(tcol, bedC, bedW * 0.9);
          // contact shadow round trunks and rocks, cool rather than black; canopy weight for the sun flecks
          vec2 aoUV = (vWP.xz - uAORect.xy) * uAORect.z;
          vec2 aoE = smoothstep(vec2(0.0), vec2(0.06), aoUV) * smoothstep(vec2(1.0), vec2(0.94), aoUV);
          float aoIn = aoE.x * aoE.y * uAORect.w;
          vec3 aoS = texture2D(tGroundAO, clamp(aoUV, 0.0, 1.0)).rgb * aoIn;
          float contact = clamp(aoS.r, 0.0, 1.0);
          float gCanopy = clamp(aoS.g * 1.7 + bio.y * 0.35 * (1.0 - aoIn), 0.0, 1.0);
          tcol = mix(tcol, tcol * vec3(0.55, 0.55, 0.8), contact * 0.7);
          float wet = clamp(uWetness * 0.7 + bedW, 0.0, 1.0);
          tcol *= mix(1.0, 0.72, wet);
          if (uWetness > 0.22) {
            float puddle = clamp(uWetness * 1.4 - 0.3, 0.0, 1.0) * aaStep(0.64, vnoise(uv * 0.11 + 2.0) * 0.7 + vnoise(uv * 0.5) * 0.3) * smoothstep(0.06, 0.01, slope) * w.x * (1.0 - bedW);
            tcol = mix(tcol, vec3(0.2, 0.28, 0.4), puddle * 0.8);
          }
          ${far ? `
          // Past the last of the trees the forest is a colour on the ground, so a far hill reads as forested and not as bare earth
          float treesGone = smoothstep(uTreeFar * 0.82, uTreeFar, camD) * smoothstep(0.2, 0.55, bio.y) * (1.0 - bedW) * (1.0 - fieldW);
          tcol = mix(tcol, mix(uLeafShade, uLeafLit, 0.2 + 0.6 * smoothstep(0.3, 0.7, big)) * (0.85 + 0.3 * mid), treesGone);` : ''}
          diffuseColor.rgb = tcol;
        `)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // sun flecks under the canopy: soft-edged painted patches, drifting slowly with the wind
            vec2 sp = vWP.xz - uSunDir.xz / max(uSunDir.y, 0.25) * 9.0;
            vec2 wo = uWind * uTime * 0.12;
            #ifdef TERRAIN_LQ
            float ck = vnoise(sp * 0.5 + wo);
            #else
            float ck = vnoise(sp * 0.4 + wo) * 0.6 + vnoise(sp * 1.2 - wo * 1.5) * 0.4;
            #endif
            reflectedLight.directDiffuse *= mix(1.0, smoothstep(0.47, 0.56, ck), gCanopy * 0.7);
            reflectedLight.indirectDiffuse *= 1.0 - contact * 0.3;
          }`);
    },
  });
  m.userData.near = { value: new THREE.Vector4(0, 0, 0, 0) }; m.userData.treeFar = { value: 500 };
  return m;
}

export class TerrainManager {
  constructor(scene, tex, quality) {
    this.scene = scene; this.q = quality;
    this.tex = tex;
    const lq = this.lq = !!quality.lean;
    this.mat = PAINTED ? createPaintedTerrainMaterial(false, lq) : createTerrainMaterial(tex, false, lq);
    this.farMat = PAINTED ? createPaintedTerrainMaterial(true, lq) : createTerrainMaterial(tex, true, lq);
    this.chunks = new Map();
    this.queue = []; this.flying = new Map(); this.startWorker();
    this.center = { cx: 1e9, cz: 1e9 };
    this.R = quality.chunkR;
    // far mesh
    this.farN = quality.farSegs || 256;
    const far = buildGridGeometry(-HALF, -HALF, HALF * 2, this.farN, height, false, 1.3);
    if (this.farMat.userData.treeFar) this.farMat.userData.treeFar.value = quality.treeFar;
    this.far = new THREE.Mesh(far.geometry, this.farMat);
    this.far.receiveShadow = false; this.far.castShadow = false;
    this.far.frustumCulled = false;
    this.far.renderOrder = this.groundOrder(-1);
    scene.add(this.far);
  }
  // a new graphics level: how far chunks reach, their detail, and Low's simpler ground shader
  applyQuality() {
    this.R = this.q.chunkR; this.center = { cx: 1e9, cz: 1e9 };
    if (this.q.farSegs !== this.farN) { this.farN = this.q.farSegs; this.far.geometry.dispose(); this.far.geometry = buildGridGeometry(-HALF, -HALF, HALF * 2, this.farN, height, false, 1.3).geometry; }
    const lq = !!this.q.lean;
    if (this.farMat.userData.treeFar) this.farMat.userData.treeFar.value = this.q.treeFar;
    if (lq === this.lq) return;
    this.lq = lq;
    const oldM = this.mat, oldF = this.farMat, near = oldF.userData.near && oldF.userData.near.value;
    this.mat = PAINTED ? createPaintedTerrainMaterial(false, lq) : createTerrainMaterial(this.tex, false, lq);
    this.farMat = PAINTED ? createPaintedTerrainMaterial(true, lq) : createTerrainMaterial(this.tex, true, lq);
    if (this.farMat.userData.treeFar) this.farMat.userData.treeFar.value = this.q.treeFar;
    if (near && this.farMat.userData.near) this.farMat.userData.near.value.copy(near);
    this.far.renderOrder = this.groundOrder(-1); for (const c of this.chunks.values()) c.mesh.renderOrder = this.groundOrder(0);
    this.far.material = this.farMat;
    for (const c of this.chunks.values()) c.mesh.material = this.mat;
    oldM.dispose(); oldF.dispose();
  }
  // (fine enough round him that grass and tree roots, which stand on the true height of the land, don't show daylight under them)
  lodFor(d) { const S = this.q.chunkSegs; return d <= 1 ? S[0] : d <= 2 ? S[1] : S[2]; }
  update(px, pz, budgetMs = 6, force = false) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    if (cx !== this.center.cx || cz !== this.center.cz || force) {
      this.center = { cx, cz };
      const want = new Map();
      for (let dz = -this.R; dz <= this.R; dz++) for (let dx = -this.R; dx <= this.R; dx++) {
        const kx = cx + dx, kz = cz + dz;
        if (Math.abs(kx * CHUNK) > HALF + CHUNK || Math.abs(kz * CHUNK) > HALF + CHUNK) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        want.set(ckey(kx, kz), { kx, kz, segs: this.lodFor(d), d });
      }
      for (const [k, c] of this.chunks) {
        if (!want.has(k)) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); this.chunks.delete(k); heightCache.delete(k); }
      }
      this.queue = [];
      for (const [k, f] of this.flying) if (!(want.has(k) && want.get(k).segs === f.segs)) this.flying.delete(k);   // (what comes back for these is dropped)
      if (this.job && !(want.has(this.job.w.k) && want.get(this.job.w.k).segs === this.job.w.segs)) this.job = null;
      for (const [k, w] of want) {
        if (this.job && this.job.w.k === k) continue;
        if (this.flying.has(k) && !force) continue;
        const c = this.chunks.get(k);
        if (!c || c.segs !== w.segs) this.queue.push({ k, ...w });
      }
      this.queue.sort((a, b) => a.d - b.d);
    }
    // build chunks a slice at a time inside the frame budget (a forced update finishes everything now)
    const t0 = performance.now();
    while ((this.job || this.queue.length) && (force || performance.now() - t0 < budgetMs)) {
      if (!this.job) { const w = this.queue.shift(); this.job = { w, it: buildGridGen(w.kx * CHUNK, w.kz * CHUNK, CHUNK, w.segs, height, true) }; }
      const r = this.job.it.next();
      if (r.done) { this.buildChunk(this.job.w, toGeo(r.value)); this.job = null; }
      if (this.worker && !force) break;   // (with a worker, only a job already begun here is finished here)
    }
    if (this.worker && !force) while (this.flying.size < 2 && this.queue.length) {
      const w = this.queue.shift(); this.flying.set(w.k, w);
      this.worker.postMessage({ k: w.k, x0: w.kx * CHUNK, z0: w.kz * CHUNK, size: CHUNK, segs: w.segs, rise: LAND.rise, hole: WATER_STATE.holeOffset });
    }
    // near rect for far mesh: largest fully-loaded square
    let r = 0;
    outer: for (r = 0; r <= this.R; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const kx = cx + dx, kz = cz + dz;
        if (Math.abs(kx * CHUNK) > HALF + CHUNK || Math.abs(kz * CHUNK) > HALF + CHUNK) continue;
        if (!this.chunks.has(ckey(kx, kz))) break outer;
      }
    }
    r -= 1;
    const nr = this.farMat.userData.near.value;
    if (r >= 0) nr.set((cx - r) * CHUNK + 0.5, (cz - r) * CHUNK + 0.5, (cx + r + 1) * CHUNK - 0.5, (cz + r + 1) * CHUNK - 0.5);
    else nr.set(0, 0, 0, 0);
  }
  // The ground goes after the trees and rocks: its shader is the dearest there is, and what stands in front of it then saves all of it.
  // (Measured on a Mali-G57, 59 to 70 FPS.)
  groundOrder() { return 2; }
  // The worker: the same arithmetic on another core. It needs a browser that runs module workers; without one (or if it fails
  // for any reason) the chunks are built here a slice at a time, as they always were.
  startWorker() {
    this.flying = new Map();
    try {
      const wk = new Worker(new URL('./land-worker.js', import.meta.url), { type: 'module' });
      wk.onmessage = (e) => {
        const d = e.data, w = this.flying.get(d.k);
        if (!w || w.segs !== d.segs) return;   // no longer wanted, or wanted finer by now
        this.flying.delete(d.k);
        const c = this.chunks.get(d.k); if (c && c.segs === w.segs) return;
        this.buildChunk(w, toGeo(d));
      };
      wk.onerror = (e) => { console.warn('land worker failed, building chunks on the main thread', e.message || e); this.worker = null; for (const w of this.flying.values()) this.queue.push(w); this.flying.clear(); };
      this.worker = wk;
    } catch (e) { this.worker = null; }
  }
  buildChunk(w, res = buildGridGeometry(w.kx * CHUNK, w.kz * CHUNK, CHUNK, w.segs, height, true)) {
    const old = this.chunks.get(w.k);
    const mesh = new THREE.Mesh(res.geometry, this.mat); mesh.renderOrder = this.groundOrder(0);
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    this.chunks.set(w.k, { mesh, segs: w.segs });
    heightCache.set(w.k, { x0: w.kx * CHUNK, z0: w.kz * CHUNK, step: res.step, n: w.segs, h: res.hgrid });
  }
  pending() { return this.queue.length + (this.job ? 1 : 0) + this.flying.size; }
}

// Map image for the in-game map: an illustrated parchment map in the painted palette. Forest, meadow, rock,
// bamboo, fields and village as flat washes, soft hill shading from the north-west, a contour every 15 m, and
// water in teal with a darker edge.
export function renderMapCanvas(size = 384) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size);
  const step = (HALF * 2) / size;
  const hs = new Float32Array(size * size), wet = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -HALF + i * step, z = -HALF + j * step, h = height(x, z);
    hs[j * size + i] = h; wet[j * size + i] = waterAt(x, z) > h ? 1 : 0;
  }
  const mix = (c, d, k) => { c[0] += (d[0] - c[0]) * k; c[1] += (d[1] - c[1]) * k; c[2] += (d[2] - c[2]) * k; };
  const c = [0, 0, 0];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -HALF + i * step, z = -HALF + j * step, k = j * size + i, h = hs[k];
    const o = k * 4;
    if (wet[k]) {
      const edge = (i > 0 && !wet[k - 1]) || (i < size - 1 && !wet[k + 1]) || (j > 0 && !wet[k - size]) || (j < size - 1 && !wet[k + size]);
      const w = edge ? [52, 118, 138] : [96, 178, 186];
      img.data[o] = w[0]; img.data[o + 1] = w[1]; img.data[o + 2] = w[2]; img.data[o + 3] = 255; continue;
    }
    const b = biomeAt(x, z);
    c[0] = 214; c[1] = 192; c[2] = 146;                                   // bare earth on parchment
    mix(c, [124, 160, 88], clamp(b.teak * 1.2, 0, 1));                  // teak forest
    mix(c, [98, 138, 72], clamp((b.teak - 0.6) * 1.5, 0, 1) * 0.6);     // dense canopy
    mix(c, [206, 198, 124], clamp(b.grass, 0, 1) * 0.85);               // meadow
    mix(c, [142, 178, 98], clamp(b.bamboo, 0, 1) * 0.7);                // bamboo
    mix(c, [186, 172, 156], clamp(b.rock, 0, 1));                       // rock
    mix(c, [216, 192, 112], clamp(b.field, 0, 1) * 0.8);                // fields
    mix(c, [224, 190, 146], clamp(b.village, 0, 1) * 0.8);              // village
    const hl = hs[j * size + Math.max(0, i - 1)], hu = hs[Math.max(0, j - 1) * size + i];
    const shade = clamp(1 + (h - hl) * 0.045 + (h - hu) * 0.045, 0.82, 1.14);
    const ci = Math.floor(h / 15), contour = ci !== Math.floor(hl / 15) || ci !== Math.floor(hu / 15);
    const grain = 1 + (Math.random() - 0.5) * 0.04;
    for (let q = 0; q < 3; q++) img.data[o + q] = clamp(c[q] * shade * grain * (contour ? 0.86 : 1), 0, 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// Closest drinking spot: a waterhole edge or the river bank, as a point on dry ground just at the water line.
export function nearestWaterPoint(p) {
  let best = null, bd = Infinity;
  for (const w of WATERHOLES) {
    const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz) || 1;
    const e = d - (w.r - 2); if (e < bd) { bd = e; best = { x: w.x + dx / d * (w.r - 2), z: w.z + dz / d * (w.r - 2) }; }
  }
  const rx = riverX(p.z), side = p.x > rx ? 1 : -1, dr = Math.abs(p.x - rx) - (RIVER_W - 2);
  if (dr < bd && p.z < RIVER_END_Z) { bd = dr; best = { x: rx + side * (RIVER_W - 2), z: p.z }; }
  return best ? new THREE.Vector3(best.x, 0, best.z) : null;
}


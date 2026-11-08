// The painted look's colours (docs/art-direction.md): sky, light, shade and haze keyed by hour, foliage, grass
// and ground by season. Everything painted reads from here, so a season or time change is a colour change.
import * as THREE from 'three';

// the painted look is the game's look; ?look=real brings back the old realistic renderer for comparison
export const LOOK = new URLSearchParams(location.search).get('look') === 'real' ? 'real' : 'painted';
export const PAINTED = LOOK === 'painted';

const C = (h) => new THREE.Color(h);
// hour, sky top, horizon, sunlight, sun strength, shade (hemisphere sky), bounce (hemisphere ground), ambient strength, haze, cloud lit, cloud shade
const KEYS = [
  [0, '#0b1530', '#24345e', '#9fb3ff', 0.35, '#2e5070', '#1a2228', 0.65, '#2a3a66', '#4a5a8a', '#222c4e'],
  [4.8, '#0b1530', '#24345e', '#9fb3ff', 0.35, '#2e5070', '#1a2228', 0.65, '#2a3a66', '#4a5a8a', '#222c4e'],
  [6, '#4f6fb0', '#f3b38a', '#ffc08a', 1.6, '#7d86c4', '#6a4a3a', 0.8, '#c9a9b4', '#ffd2a8', '#8a7aa8'],
  [8.5, '#4a92d8', '#bfe0f2', '#fff1d6', 2.4, '#8fb0e0', '#7a6448', 0.9, '#b8d4e6', '#ffffff', '#a9b9d8'],
  [12, '#3d8ee0', '#cde6f4', '#fff8e8', 2.7, '#93b4e2', '#80684a', 0.95, '#c2dcec', '#ffffff', '#b4c4e0'],
  [16.5, '#5a8fd0', '#ffd49a', '#ffc070', 2.3, '#8a8fd0', '#8a5a38', 0.85, '#f0c8a0', '#ffe0b0', '#a890b8'],
  [18.3, '#2e3d78', '#f08a6a', '#ff8a5a', 1.1, '#6a5aa8', '#4a3040', 0.7, '#b07a8a', '#ffa080', '#5a4a80'],
  [19.6, '#0b1530', '#24345e', '#9fb3ff', 0.35, '#2e5070', '#1a2228', 0.65, '#2a3a66', '#4a5a8a', '#222c4e'],
  [24, '#0b1530', '#24345e', '#9fb3ff', 0.35, '#2e5070', '#1a2228', 0.65, '#2a3a66', '#4a5a8a', '#222c4e'],
].map(([h, top, hor, sun, sunI, sky, gnd, hemiI, haze, cl, cs]) => ({ h, top: C(top), hor: C(hor), sun: C(sun), sunI, sky: C(sky), gnd: C(gnd), hemiI, haze: C(haze), cl: C(cl), cs: C(cs) }));

export const SEASON_ART = {
  winter: { leafShade: C('#4f7a34'), leafLit: C('#b4c862'), grassRoot: C('#4e6b2a'), grassTip: C('#c9c96a'), ground: C('#a48c66'), mist: 0.25 },
  summer: { leafShade: C('#7a6a2c'), leafLit: C('#d8c060'), grassRoot: C('#8a6a30'), grassTip: C('#e8c878'), ground: C('#c09a68'), mist: 0.05 },
  monsoon: { leafShade: C('#24662a'), leafLit: C('#7ac04a'), grassRoot: C('#2f6a1e'), grassTip: C('#9ad050'), ground: C('#7a6448'), mist: 0.15 },
  post: { leafShade: C('#357a2c'), leafLit: C('#9ad05a'), grassRoot: C('#5a7a2a'), grassTip: C('#e8d070'), ground: C('#9a7e58'), mist: 0.2 },
};
export const ACCENT = { palash: C('#ff6a20'), mahua: C('#f0e0b0'), laterite: C('#c0603a'), river: C('#3a9aa0'), monsoonRiver: C('#8a6a40'), fire: C('#ff8a30'), firefly: C('#e8ff8a'), rock: C('#8a8a9a'), sand: C('#e0c898'), bark: C('#6a5444'), barkLit: C('#a08870') };

// shader uniforms for the season's colours, shared by every painted material
export const PU = {
  uGround: { value: new THREE.Color() }, uGrassRoot: { value: new THREE.Color() }, uGrassTip: { value: new THREE.Color() },
  uLeafShade: { value: new THREE.Color() }, uLeafLit: { value: new THREE.Color() },
  uRock: { value: ACCENT.rock }, uSand: { value: ACCENT.sand }, uLaterite: { value: ACCENT.laterite }, uRiver: { value: ACCENT.river },
};
export function setPaintedSeason(season) {
  const a = SEASON_ART[season] || SEASON_ART.winter;
  PU.uGround.value.copy(a.ground); PU.uGrassRoot.value.copy(a.grassRoot); PU.uGrassTip.value.copy(a.grassTip);
  PU.uLeafShade.value.copy(a.leafShade); PU.uLeafLit.value.copy(a.leafLit);
}
setPaintedSeason('winter');

// The keys above assume sunrise at 6:20 and sunset at 17:40. Pench days run from ~10.7 h in winter to ~13.3 h in
// summer, so the clock hour is stretched to that day first: dawn and dusk colours land on the real sunrise and
// sunset in every season. lat in radians, decl in degrees.
export function paintedHour(hour, declDeg, lat) {
  const H = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(declDeg * Math.PI / 180)))) * 12 / Math.PI;
  const rise = 12 - H, set = 12 + H;
  if (hour >= rise && hour <= set) return 12 + (hour - 12) * 5.67 / H;
  return hour > set ? 17.67 + (hour - set) : 6.33 - (rise - hour);
}

// colours for this hour (blended between keys), with the season's mist softening the sky and haze
const out = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), haze: new THREE.Color(), cl: new THREE.Color(), cs: new THREE.Color(), sunI: 1, hemiI: 1 };
const _w = new THREE.Color(1, 1, 1);
export function paintedLight(hour, season) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = (h - a.h) / Math.max(1e-6, b.h - a.h), s = t * t * (3 - 2 * t);
  for (const k of ['top', 'hor', 'sun', 'sky', 'gnd', 'haze', 'cl', 'cs']) out[k].copy(a[k]).lerp(b[k], s);
  out.sunI = a.sunI + (b.sunI - a.sunI) * s; out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * s;
  const mist = (SEASON_ART[season] || SEASON_ART.winter).mist * (h > 5 && h < 10 ? 1 : 0.4);
  out.hor.lerp(_w, mist * 0.6); out.haze.lerp(_w, mist * 0.5);
  return out;
}

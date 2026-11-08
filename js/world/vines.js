// Lianas hanging from the big trees (semal, giant arjun): drawn near the player, swaying in the wind as damped
// pendulums, and pulled toward Vanaj's hands while he swings on one (js/actors/canopy.js does the swinging).
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';
import { vineParts } from './flora.js';

const MAX = 90;
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _d = new THREE.Vector3(), _s = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);

export class VineSystem {
  constructor(scene, veg) {
    this.veg = veg; this.trees = []; this.t = 0;
    const parts = vineParts();
    const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 1, 6, 1, true).translate(0, -0.5, 0);
    this.stems = new THREE.InstancedMesh(stemGeo, parts.stem, MAX);
    this.leaves = new THREE.InstancedMesh(parts.leafGeo, parts.leaf, MAX);
    for (const m of [this.stems, this.leaves]) { m.count = 0; m.frustumCulled = false; m.castShadow = m === this.stems; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  }
  update(dt, cam) {
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.5; this.trees = this.veg.climbNear(cam.x, cam.z, 60); }
    const wind = G.uWind.value, ws = G.uWindStrength.value, time = G.uTime.value;
    let n = 0;
    for (const T of this.trees) for (const V of T.vines) {
      if (n >= MAX) break;
      if (V.held && V.hand) {
        // the liana runs straight from its anchor to the hands
        _d.subVectors(V.hand, V.a); const L = _d.length(); _d.multiplyScalar(1 / L);
        V.ang.set(Math.atan2(_d.z, -_d.y), Math.asin(Math.max(-1, Math.min(1, _d.x)))); V.vel.set(0, 0);
        _s.set(1, L + 0.35, 1);
      } else {
        // a damped pendulum, nudged by the gusts
        const gust = ws * (0.6 + 0.4 * Math.sin(time * 0.7 + V.ph)) * 0.35 / V.len, k = 9.8 / V.len;
        V.vel.x += (-k * Math.sin(V.ang.x) - 0.5 * V.vel.x + wind.y * gust) * dt; V.vel.y += (-k * Math.sin(V.ang.y) - 0.5 * V.vel.y + wind.x * gust) * dt;
        V.ang.x += V.vel.x * dt; V.ang.y += V.vel.y * dt;
        _d.set(Math.sin(V.ang.y), -Math.cos(V.ang.x) * Math.cos(V.ang.y), Math.sin(V.ang.x)).normalize();
        _s.set(1, V.len, 1);
      }
      _q.setFromUnitVectors(_down, _d);
      _m.compose(V.a, _q, _s);
      this.stems.setMatrixAt(n, _m); this.leaves.setMatrixAt(n, _m);
      n++;
    }
    this.stems.count = this.leaves.count = n;
    this.stems.instanceMatrix.needsUpdate = this.leaves.instanceMatrix.needsUpdate = true;
  }
}

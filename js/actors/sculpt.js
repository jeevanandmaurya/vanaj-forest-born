// Vanaj's body, generated in code: one continuous skin surface around the rig's skeleton, in place of the
// mannequin's jointed plates. The body is described as ~120 anatomical shapes (pelvis, ribcage, muscle
// masses, joints, fingers, toes, skull, jaw, nose, lips, ears) blended into one signed-distance field, which is
// turned into a mesh with surface nets: finer on the face, hands and feet than on the trunk. Every vertex is
// projected onto the exact surface, lit by the field's gradient, and skinned to the bones whose shapes it lies
// on, blended across joints. All coordinates are the rig's bind space (T-pose, +z forward, +x the left side).
import * as THREE from 'three';

const SPH = 0, ELL = 1, CONE = 2;
const MARGIN = 0.03;
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

function dist(p, x, y, z) {
  if (p.t === SPH) { const dx = x - p.ax, dy = y - p.ay, dz = z - p.az; return Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r1; }
  if (p.t === ELL) {
    let dx = x - p.ax, dy = y - p.ay, dz = z - p.az;
    if (p.m) { const m = p.m, lx = m[0] * dx + m[1] * dy + m[2] * dz, ly = m[3] * dx + m[4] * dy + m[5] * dz, lz = m[6] * dx + m[7] * dy + m[8] * dz; dx = lx; dy = ly; dz = lz; }
    const qx = dx / p.rx, qy = dy / p.ry, qz = dz / p.rz, k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const wx = qx / p.rx, wy = qy / p.ry, wz = qz / p.rz, k1 = Math.sqrt(wx * wx + wy * wy + wz * wz);
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(p.rx, p.ry, p.rz);
  }
  // round cone a -> b with radii r1 -> r2 (exact), its cross-section optionally squashed along unit n by f
  let px = x - p.ax, py = y - p.ay, pz = z - p.az, f = 1;
  if (p.sq) { const n = p.sq, t = px * n[0] + py * n[1] + pz * n[2], s = 1 / n[3] - 1; px += n[0] * t * s; py += n[1] * t * s; pz += n[2] * t * s; f = n[3]; }
  const bax = p.bx - p.ax, bay = p.by - p.ay, baz = p.bz - p.az, l2 = p.l2, rr = p.r1 - p.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const yv = px * bax + py * bay + pz * baz, zv = yv - l2;
  const xx = px * l2 - bax * yv, xy = py * l2 - bay * yv, xz = pz * l2 - baz * yv;
  const x2 = xx * xx + xy * xy + xz * xz, y2 = yv * yv * l2, z2 = zv * zv * l2, k = Math.sign(rr) * rr * rr * x2;
  let d;
  if (Math.sign(zv) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - p.r2;
  else if (Math.sign(yv) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - p.r1;
  else d = (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - p.r1;
  return d * f;
}
// the blended field from a candidate list (unions, then carved-out shapes, then what sits in the carving).
// Start from "nothing" and clamp at the end: starting from the clamp value would let it take part in the
// smooth blends, which shifts the surface wherever one more shape's box happens to reach, leaving ledges.
function field(L, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < L.length; i++) {
    const p = L[i], b = p.box;
    if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue;
    const di = dist(p, x, y, z);
    d = p.sub ? -smin(-d, di, p.k) : smin(d, di, p.k);
  }
  return Math.min(d, MARGIN);
}
const inBox = (b, x, y, z, e = 0) => x >= b[0] - e && x <= b[3] + e && y >= b[1] - e && y <= b[4] + e && z >= b[2] - e && z <= b[5] + e;

// ---------------------------------------------------------------------------------------------- the body
function bodyShapes(P) {
  // three passes: the body, then what is carved out of it, then what sits in the carved places (eyelids)
  const U = [], SUB = [], POST = [], v = (x, y, z) => new THREE.Vector3(x, y, z);
  const put = (p, sub) => { (p.post ? POST : sub ? SUB : U).push(p); return p; };
  const sph = (c, r, bones, k = 0.02, o = {}) => put({ t: SPH, ax: c.x, ay: c.y, az: c.z, r1: r, bones, k, ...o }, o.sub);
  const ell = (c, rx, ry, rz, bones, k = 0.02, o = {}) => {
    let m = null;
    if (o.rot) { const q = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot)).transpose().elements; m = [q[0], q[4], q[8], q[1], q[5], q[9], q[2], q[6], q[10]]; }
    return put({ t: ELL, ax: c.x, ay: c.y, az: c.z, rx, ry, rz, m, bones, k, ...o }, o.sub);
  };
  const cone = (a, b, r1, r2, bones, k = 0.02, o = {}) => put({ t: CONE, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, r1, r2, l2: a.distanceToSquared(b), sq: o.sq || null, bones, k, ...o }, o.sub);
  const lerp = (a, b, t) => a.clone().lerp(b, t);

  // a lean boy's trunk: a V from the armpits to a narrow waist, a boy's narrow pelvis (no flared hips), a flat
  // belly, and a flat chest (the rib cage as one tapered form, flattened front to back, no breast-like bulges)
  ell(v(0, 0.94, -0.02), 0.104, 0.085, 0.086, [['DEF-hips', 1]], 0.06);
  ell(v(0, 1.06, -0.012), 0.103, 0.11, 0.066, [['DEF-spine001', 1]], 0.07);
  cone(v(0, 1.15, -0.016), v(0, 1.37, -0.02), 0.104, 0.145, [['DEF-spine002', 0.5], ['DEF-spine003', 0.5]], 0.06, { sq: [0, 0, 1, 0.58] });
  ell(v(0, 1.1, 0.012), 0.07, 0.075, 0.036, [['DEF-spine001', 0.6], ['DEF-spine002', 0.4]], 0.045);   // belly wall
  for (const s of [1, -1]) {
    const SH = s > 0 ? 'DEF-shoulderL' : 'DEF-shoulderR';
    ell(v(s * 0.05, 0.885, -0.072), 0.052, 0.068, 0.056, [['DEF-hips', 1]], 0.04);                     // buttock (kept within the hips' width)
    ell(v(s * 0.075, 1.33, -0.07), 0.064, 0.085, 0.032, [['DEF-spine003', 1]], 0.04);                  // shoulder blade
    ell(v(s * 0.098, 1.285, -0.035), 0.045, 0.1, 0.058, [['DEF-spine003', 0.7], ['DEF-spine002', 0.3]], 0.05);   // lats: the back widens under the arms
    // trapezius sloping from the neck down onto the top of the shoulder
    cone(v(s * 0.02, 1.505, -0.03), v(s * 0.15, 1.447, -0.05), 0.046, 0.032, [['DEF-spine003', 0.5], ['DEF-neck', 0.15], [SH, 0.35]], 0.045, { sig: 0.02 });
    cone(v(s * 0.03, 1.45, 0.03), v(s * 0.165, 1.452, -0.035), 0.013, 0.013, [[SH, 1]], 0.025);   // collarbone
  }
  // neck: a boy's neck, about 10 cm across
  cone(v(0, 1.43, -0.022), v(0, 1.625, -0.008), 0.058, 0.051, [['DEF-neck', 1]], 0.04);
  cone(v(0, 1.47, 0.012), v(0, 1.585, 0.03), 0.026, 0.022, [['DEF-neck', 1]], 0.025);   // throat

  // arms and hands
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const sh = P('DEF-upper_arm' + S), el = P('DEF-forearm' + S), wr = P('DEF-hand' + S);
    // the shoulder: a rounded cap over the joint (the bony point and the top of the deltoid) that rides on the
    // collarbone, so it stays round when the arm hangs; the deltoid itself wraps the top of the arm and tapers
    // to its insertion a third of the way down, and moves with the arm. Wide skin blends between them.
    sph(v(sh.x - s * 0.006, sh.y + 0.014, sh.z + 0.002), 0.043, [['DEF-shoulder' + S, 0.65], ['DEF-upper_arm' + S, 0.35]], 0.04, { sig: 0.022 });
    cone(v(sh.x + s * 0.005, sh.y + 0.006, sh.z), v(sh.x + s * 0.1, sh.y - 0.004, sh.z + 0.004), 0.047, 0.03, [['DEF-upper_arm' + S, 1]], 0.035, { sig: 0.022 });
    cone(sh, el, 0.042, 0.031, [['DEF-upper_arm' + S, 1]], 0.025);
    ell(lerp(sh, el, 0.52).add(v(0, 0, 0.013)), 0.068, 0.027, 0.026, [['DEF-upper_arm' + S, 1]], 0.025);                               // biceps
    ell(lerp(sh, el, 0.42).add(v(0, 0.004, -0.016)), 0.075, 0.03, 0.026, [['DEF-upper_arm' + S, 1]], 0.025);                           // triceps
    sph(el.clone().add(v(0, 0, -0.004)), 0.029, [['DEF-upper_arm' + S, 0.5], ['DEF-forearm' + S, 0.5]], 0.02);                          // elbow
    cone(el, wr, 0.034, 0.022, [['DEF-forearm' + S, 1]], 0.02, { sq: [0, 1, 0, 0.78] });
    ell(lerp(el, wr, 0.28), 0.085, 0.031, 0.036, [['DEF-forearm' + S, 1]], 0.025);                                                       // forearm muscles
    cone(wr.clone().add(v(-s * 0.012, 0, 0)), wr.clone().add(v(s * 0.022, 0, -0.004)), 0.021, 0.022, [['DEF-forearm' + S, 0.5], ['DEF-hand' + S, 0.5]], 0.012, { sq: [0, 1, 0, 0.72], sig: 0.008 });   // wrist
    // palm, thenar pad and the back of the hand
    ell(v(wr.x + s * 0.064, wr.y - 0.001, -0.07), 0.05, 0.0155, 0.04, [['DEF-hand' + S, 1]], 0.012, { sig: 0.006 });
    ell(v(wr.x + s * 0.036, wr.y - 0.012, -0.04), 0.028, 0.015, 0.02, [['DEF-hand' + S, 0.7], ['DEF-thumb01' + S, 0.3]], 0.012, { sig: 0.006 });
    for (const [f, r] of [['index', 0.0083], ['middle', 0.0088], ['ring', 0.0082], ['pinky', 0.0071]]) {
      const b1 = P(`DEF-f_${f}01${S}`), b2 = P(`DEF-f_${f}02${S}`), b3 = P(`DEF-f_${f}03${S}`), tip = b3.clone().addScaledVector(b3.clone().sub(b2), 0.95);
      const base = b1.clone().add(v(-s * 0.012, 0, 0));
      cone(base, b2, r * 1.05, r * 0.95, [[`DEF-f_${f}01${S}`, 1]], 0.004, { sig: 0.004 });
      cone(b2, b3, r * 0.95, r * 0.87, [[`DEF-f_${f}02${S}`, 1]], 0.003, { sig: 0.004 });
      cone(b3, tip, r * 0.87, r * 0.76, [[`DEF-f_${f}03${S}`, 1]], 0.003, { sig: 0.004 });
      sph(b1.clone().add(v(0, 0.004, 0)), r * 1.12, [[`DEF-f_${f}01${S}`, 0.5], ['DEF-hand' + S, 0.5]], 0.006, { sig: 0.004 });   // knuckle
    }
    const t1 = P('DEF-thumb01' + S), t2 = P('DEF-thumb02' + S), t3 = P('DEF-thumb03' + S), tt = t3.clone().addScaledVector(t3.clone().sub(t2), 0.8);
    cone(t1, t2, 0.0125, 0.0108, [['DEF-thumb01' + S, 1]], 0.008, { sig: 0.005 });
    cone(t2, t3, 0.0108, 0.0098, [['DEF-thumb02' + S, 1]], 0.004, { sig: 0.004 });
    cone(t3, tt, 0.0098, 0.0085, [['DEF-thumb03' + S, 1]], 0.004, { sig: 0.004 });
  }

  // legs and feet
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const hp = P('DEF-thigh' + S), kn = P('DEF-shin' + S), an = P('DEF-foot' + S), ball = P('DEF-toe' + S);
    cone(hp.clone().add(v(s * 0.008, 0.01, -0.01)), kn, 0.066, 0.043, [['DEF-thigh' + S, 1]], 0.04);
    ell(v(kn.x + s * 0.004, 0.72, kn.z + 0.018), 0.047, 0.15, 0.045, [['DEF-thigh' + S, 1]], 0.035);   // quadriceps
    ell(v(kn.x, 0.75, kn.z - 0.024), 0.042, 0.14, 0.042, [['DEF-thigh' + S, 1]], 0.035);               // hamstrings
    sph(kn.clone().add(v(0, 0, 0.004)), 0.041, [['DEF-thigh' + S, 0.5], ['DEF-shin' + S, 0.5]], 0.025);
    sph(kn.clone().add(v(0, 0.012, 0.036)), 0.02, [['DEF-shin' + S, 0.6], ['DEF-thigh' + S, 0.4]], 0.015);   // kneecap
    cone(kn, an, 0.04, 0.026, [['DEF-shin' + S, 1]], 0.025);
    ell(v(kn.x + s * 0.002, 0.405, kn.z - 0.03), 0.038, 0.1, 0.036, [['DEF-shin' + S, 1]], 0.03);    // calf
    // the ankle runs down into the foot; the foot is one flattened form from heel to ball, with an instep
    cone(an, v(an.x, 0.045, an.z - 0.012), 0.026, 0.029, [['DEF-shin' + S, 0.45], ['DEF-foot' + S, 0.55]], 0.03, { sig: 0.01 });
    for (const o of [0.021, -0.019]) sph(v(an.x + s * o, an.y - 0.012, an.z + 0.002), 0.012, [['DEF-shin' + S, 0.5], ['DEF-foot' + S, 0.5]], 0.02, { sig: 0.01 });   // ankle bones
    sph(v(an.x, 0.034, an.z - 0.03), 0.029, [['DEF-foot' + S, 1]], 0.03, { sig: 0.01 });                                     // heel
    cone(v(an.x, 0.033, an.z - 0.018), v(ball.x - s * 0.004, 0.021, ball.z - 0.008), 0.032, 0.03, [['DEF-foot' + S, 1]], 0.03, { sq: [0, 1, 0, 0.66], sig: 0.01 });
    ell(v(an.x - s * 0.004, 0.047, 0.028), 0.028, 0.022, 0.05, [['DEF-foot' + S, 1]], 0.03, { sig: 0.01 });                 // instep
    ell(v(ball.x - s * 0.004, 0.022, ball.z - 0.01), 0.042, 0.019, 0.03, [['DEF-foot' + S, 0.5], ['DEF-toe' + S, 0.5]], 0.02, { sig: 0.008 });   // ball of the foot
    // toes: the big toe on the inside, each a little shorter outward
    for (const [dx, len, r] of [[-0.025, 0.048, 0.0112], [-0.007, 0.045, 0.0082], [0.008, 0.04, 0.0077], [0.021, 0.034, 0.0072], [0.032, 0.027, 0.0066]]) {
      const a = v(ball.x + s * dx, 0.017, ball.z + 0.005), b = v(ball.x + s * dx * 1.06, 0.012, ball.z + len);
      cone(a, b, r, r * 0.85, [['DEF-toe' + S, 1]], 0.005, { sig: 0.004 });
    }
  }

  // head: a teenager's head, soft-featured, built from the skull outward. O is the centre of the cranium.
  const hd = P('DEF-head'), O = v(0, hd.y + 0.142, hd.z - 0.005);
  const o = (x, y, z) => O.clone().add(v(x, y, z)), HEAD = [['DEF-head', 1]];
  ell(o(0, 0.02, -0.016), 0.074, 0.098, 0.096, HEAD, 0.045);                        // cranium
  ell(o(0, 0.028, 0.036), 0.066, 0.068, 0.062, HEAD, 0.045);                        // forehead
  ell(o(0, -0.045, 0.044), 0.056, 0.055, 0.05, HEAD, 0.035);                       // midface
  ell(o(0, -0.077, 0.02), 0.056, 0.038, 0.058, HEAD, 0.035);                       // jaw
  ell(o(0, -0.108, 0.064), 0.022, 0.019, 0.019, HEAD, 0.02);                       // chin
  for (const s of [1, -1]) {
    sph(o(s * 0.05, -0.072, -0.02), 0.021, HEAD, 0.035);                             // angle of the jaw
    sph(o(s * 0.046, -0.02, 0.058), 0.018, HEAD, 0.03);                              // cheekbone
    ell(o(s * 0.038, -0.05, 0.058), 0.019, 0.022, 0.018, HEAD, 0.03);               // cheek (lean, not full)
    // eyelids over the eyeball (centre o(±0.031, -0.005, 0.0815), r 0.0122): the upper lid's edge crosses the
    // top of the iris, the lower lid sits just under it, leaving an almond-shaped opening
    ell(o(s * 0.031, 0.0068, 0.0838), 0.0168, 0.0088, 0.0128, HEAD, 0.003, { sig: 0.004, post: true });
    ell(o(s * 0.031, -0.0172, 0.0815), 0.0148, 0.0068, 0.0118, HEAD, 0.003, { sig: 0.004, post: true });
    ell(o(s * 0.076, -0.018, -0.006), 0.011, 0.03, 0.019, HEAD, 0.01, { rot: [0, s * 0.25, 0] });   // ear
  }
  cone(o(-0.042, 0.013, 0.081), o(0.042, 0.013, 0.081), 0.0095, 0.0095, HEAD, 0.016);      // brow
  cone(o(0, 0.003, 0.092), o(0, -0.036, 0.111), 0.0075, 0.0105, HEAD, 0.01);              // bridge of the nose
  sph(o(0, -0.041, 0.11), 0.0118, HEAD, 0.01);                                             // tip
  for (const s of [1, -1]) sph(o(s * 0.0125, -0.047, 0.1), 0.0088, HEAD, 0.008);           // nostril wings
  ell(o(0, -0.068, 0.099), 0.021, 0.0062, 0.009, HEAD, 0.008, { sig: 0.004 });             // upper lip
  ell(o(0, -0.0795, 0.096), 0.018, 0.0072, 0.009, HEAD, 0.008, { sig: 0.004 });            // lower lip
  // carved: eye sockets, nostrils, the line of the mouth, the bowl of each ear
  for (const s of [1, -1]) {
    sph(o(s * 0.031, -0.005, 0.095), 0.0165, HEAD, 0.007, { sub: true });
    sph(o(s * 0.0072, -0.0525, 0.104), 0.0036, HEAD, 0.003, { sub: true });
    ell(o(s * 0.083, -0.02, 0.0), 0.006, 0.016, 0.01, HEAD, 0.004, { sub: true, rot: [0, s * 0.25, 0] });
  }
  ell(o(0, -0.0738, 0.104), 0.019, 0.0013, 0.0045, HEAD, 0.002, { sub: true });   // a closed mouth: just the line

  const eyes = [1, -1].map((s) => ({ c: o(s * 0.031, -0.005, 0.0815), r: 0.0122 }));
  return { shapes: U.concat(SUB, POST), eyes, face: O };
}

// ---------------------------------------------------------------------------------------------- surface nets
const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = []; for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) { const d = (a ^ b); if (d === 1 || d === 2 || d === 4) EDGES.push([a, b]); }

function polygonize(shapes, lo, hi, h, keep, out) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz).fill(MARGIN), at = (i, j, k) => i + nx * (j + ny * k);
  const B = 8;
  for (let bk = 0; bk < nz - 1; bk += B) for (let bj = 0; bj < ny - 1; bj += B) for (let bi = 0; bi < nx - 1; bi += B) {
    const i1 = Math.min(nx - 1, bi + B), j1 = Math.min(ny - 1, bj + B), k1 = Math.min(nz - 1, bk + B);
    const x0 = lo[0] + bi * h, y0 = lo[1] + bj * h, z0 = lo[2] + bk * h, x1 = lo[0] + i1 * h, y1 = lo[1] + j1 * h, z1 = lo[2] + k1 * h;
    const L = shapes.filter((p) => !(p.box[3] < x0 || p.box[0] > x1 || p.box[4] < y0 || p.box[1] > y1 || p.box[5] < z0 || p.box[2] > z1));
    if (!L.some((p) => !p.sub)) continue;
    for (let k = bk; k <= k1; k++) for (let j = bj; j <= j1; j++) for (let i = bi; i <= i1; i++) F[at(i, j, k)] = field(L, lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  // one vertex per cell the surface passes through, at the mean of its edge crossings
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cell = new Int32Array(cx * cy * cz).fill(-1);
  const c = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let q = 0; q < 8; q++) { const o = CORNER[q]; c[q] = F[at(i + o[0], j + o[1], k + o[2])]; if (c[q] < 0) mask |= 1 << q; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      if ((c[a] < 0) === (c[b] < 0)) continue;
      const t = c[a] / (c[a] - c[b]), A = CORNER[a], Bc = CORNER[b];
      sx += A[0] + (Bc[0] - A[0]) * t; sy += A[1] + (Bc[1] - A[1]) * t; sz += A[2] + (Bc[2] - A[2]) * t; n++;
    }
    cell[i + cx * (j + cy * k)] = out.pos.length / 3;
    out.pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  // a quad across every grid edge the surface crosses, joining the four cells round it
  const C = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) ? -1 : cell[i + cx * (j + cy * k)];
  // quads are kept whole and split into triangles at the end, once vertices sit on the true surface
  const quad = (q, inside, axis) => {
    if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[3] < 0) return;
    const P = out.pos;
    let mx = 0, my = 0, mz = 0; for (const v of q) { mx += P[v * 3]; my += P[v * 3 + 1]; mz += P[v * 3 + 2]; }
    if (!keep(mx / 4, my / 4, mz / 4)) return;
    // wind so the face points from inside (negative) to outside along the edge's axis
    const a = q[0], b = q[1], d = q[2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[d * 3] - P[a * 3], vy = P[d * 3 + 1] - P[a * 3 + 1], vz = P[d * 3 + 2] - P[a * 3 + 2];
    const nrm = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx][axis];
    out.quads.push(...((nrm > 0) === inside ? q : [q[0], q[3], q[2], q[1]]));
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const f0 = F[at(i, j, k)], in0 = f0 < 0;
    if (i < nx - 1 && in0 !== (F[at(i + 1, j, k)] < 0)) quad([C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k)], in0, 0);
    if (j < ny - 1 && in0 !== (F[at(i, j + 1, k)] < 0)) quad([C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1)], in0, 1);
    if (k < nz - 1 && in0 !== (F[at(i, j, k + 1)] < 0)) quad([C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k)], in0, 2);
  }
}

// ---------------------------------------------------------------------------------------------- build
// detail scales every cell size (1 = full; 1.5 on low quality gives roughly half the triangles)
export function sculptBody(skeleton, detail = 1) {
  const t0 = performance.now();
  const bones = skeleton.bones, bi = new Map(bones.map((b, i) => [b.name, i]));
  const bind = bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(skeleton.boneInverses[i]).invert()));
  const P = (n) => bind[bi.get(n)].clone();
  const { shapes, eyes, face } = bodyShapes(P);
  for (const p of shapes) {
    let lo, hi;
    if (p.t === SPH) { lo = [p.ax - p.r1, p.ay - p.r1, p.az - p.r1]; hi = [p.ax + p.r1, p.ay + p.r1, p.az + p.r1]; }
    else if (p.t === ELL) { const r = Math.max(p.rx, p.ry, p.rz); lo = [p.ax - r, p.ay - r, p.az - r]; hi = [p.ax + r, p.ay + r, p.az + r]; }
    else { const r = Math.max(p.r1, p.r2); lo = [Math.min(p.ax, p.bx) - r, Math.min(p.ay, p.by) - r, Math.min(p.az, p.bz) - r]; hi = [Math.max(p.ax, p.bx) + r, Math.max(p.ay, p.by) + r, Math.max(p.az, p.bz) + r]; }
    const e = p.k + MARGIN; p.box = [lo[0] - e, lo[1] - e, lo[2] - e, hi[0] + e, hi[1] + e, hi[2] + e];
    p.bw = p.bones.map(([n, w]) => [bi.get(n), w]);
  }
  // fine regions (face, hands, feet) and the coarse trunk; each keeps its own part, overlapping by a cell
  const hd = P('DEF-head'), hL = P('DEF-handL'), hR = P('DEF-handR'), fL = P('DEF-footL'), fR = P('DEF-footR');
  const R = {
    head: [[-0.1, hd.y - 0.01, -0.13], [0.1, hd.y + 0.285, 0.14], 0.0036],
    handL: [[hL.x - 0.03, hL.y - 0.1, -0.14], [hL.x + 0.26, hL.y + 0.04, 0.05], 0.0034],
    handR: [[hR.x - 0.26, hR.y - 0.1, -0.14], [hR.x + 0.03, hR.y + 0.04, 0.05], 0.0034],
    footL: [[fL.x - 0.075, -0.01, -0.11], [fL.x + 0.075, 0.14, 0.2], 0.0048],
    footR: [[fR.x - 0.075, -0.01, -0.11], [fR.x + 0.075, 0.14, 0.2], 0.0048],
  };
  for (const k in R) R[k][2] *= detail;
  const out = { pos: [], quads: [] }, hb = 0.0105 * detail;
  const inside = (r, x, y, z, e) => x > r[0][0] + e && x < r[1][0] - e && y > r[0][1] + e && y < r[1][1] - e && z > r[0][2] + e && z < r[1][2] - e;
  for (const k in R) { const r = R[k]; polygonize(shapes, r[0], r[1], r[2], (x, y, z) => inside(r, x, y, z, -1e-6), out); }
  polygonize(shapes, [-0.8, -0.02, -0.22], [0.8, 1.86, 0.24], hb, (x, y, z) => { for (const k in R) if (inside(R[k], x, y, z, hb)) return false; return true; }, out);

  // project every vertex onto the exact surface; normals from the field's gradient; skin weights from the
  // shapes it lies on (bones of shapes whose surfaces are close share it, so joints bend smoothly)
  const n = out.pos.length / 3, pos = new Float32Array(out.pos), nor = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const e = 0.0006, acc = new Map();
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const L = shapes.filter((p) => inBox(p.box, x, y, z));
    let gx = 0, gy = 1, gz = 0;
    for (let it = 0; it < 3; it++) {
      const d = field(L, x, y, z);
      gx = field(L, x + e, y, z) - field(L, x - e, y, z); gy = field(L, x, y + e, z) - field(L, x, y - e, z); gz = field(L, x, y, z + e) - field(L, x, y, z - e);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e); if (g2 < 1e-8) break;
      const s = d / g2 / (2 * e); x -= gx * s; y -= gy * s; z -= gz * s;
      if (Math.abs(d) < 1e-5) break;
    }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    const gl = Math.hypot(gx, gy, gz) || 1; nor[v * 3] = gx / gl; nor[v * 3 + 1] = gy / gl; nor[v * 3 + 2] = gz / gl;
    acc.clear(); let dmin = 1e9;
    const ds = []; for (const p of L) { if (p.sub) continue; const d = dist(p, x, y, z); ds.push([p, d]); if (d < dmin) dmin = d; }
    for (const [p, d] of ds) { const w = Math.exp(-Math.max(0, d - dmin) / (p.sig || 0.014)); if (w < 0.01) continue; for (const [b, bw] of p.bw) acc.set(b, (acc.get(b) || 0) + w * bw); }
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), tot = top.reduce((s, a) => s + a[1], 0) || 1;
    for (let q = 0; q < 4; q++) { si[v * 4 + q] = top[q] ? top[q][0] : 0; sw[v * 4 + q] = top[q] ? top[q][1] / tot : 0; }
  }
  // split each quad along whichever diagonal keeps both triangles facing the way the surface does (a fixed
  // diagonal folds some quads backwards, and a folded triangle is a pinhole)
  const idx = [], Q = out.quads;
  const facing = (a, b, c) => {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return (nx * (nor[a * 3] + nor[b * 3] + nor[c * 3]) + ny * (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) + nz * (nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2])) / l;
  };
  for (let i = 0; i < Q.length; i += 4) {
    const a = Q[i], b = Q[i + 1], c = Q[i + 2], d = Q[i + 3];
    const s1 = Math.min(facing(a, b, c), facing(a, c, d)), s2 = Math.min(facing(a, b, d), facing(b, c, d));
    if (Math.max(s1, s2) < 0) { if (Math.min(facing(a, c, b), facing(a, d, c)) >= Math.min(facing(a, d, b), facing(b, d, c))) idx.push(a, c, b, a, d, c); else idx.push(a, d, b, b, d, c); }
    else if (s1 >= s2) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  }
  // the odd triangle still folded on itself: turn it to face out, so it can't show as a hole
  for (let i = 0; i < idx.length; i += 3) if (facing(idx[i], idx[i + 1], idx[i + 2]) < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.sculpt = { ms: Math.round(performance.now() - t0), verts: n, tris: idx.length / 3 };
  return { geometry: g, eyes, face };
}

// An eye: wet sclera, a dark brown iris with fibres, a black pupil; looking along +z. The geometry is centred
// on the eye; place the mesh at e.c.
export function eyeMesh(e, patchFn, noise) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12 });
  patchFn(m, 'eye', (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vEN;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vEN = normalize(position);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vEN;\n' + noise)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float a = acos(clamp(vEN.z, -1.0, 1.0)), ang = atan(vEN.y, vEN.x);
        // a dull, slightly yellowed white with faint veins toward the corners; a dark limbal ring round the iris
        vec3 sclera = vec3(0.34, 0.29, 0.24) * (1.0 - 0.35 * smoothstep(0.7, 1.4, a)) * (1.0 - 0.15 * smoothstep(0.6, 0.9, vnoise(vec2(ang * 14.0, a * 9.0))));
        vec3 iris = vec3(0.04, 0.02, 0.01) * (0.65 + 0.7 * vnoise(vec2(ang * 9.0, a * 30.0)));
        iris *= 1.0 - 0.6 * smoothstep(0.4, 0.5, a);
        vec3 c = mix(iris, sclera, smoothstep(0.5, 0.55, a));
        c = mix(vec3(0.004), c, smoothstep(0.15, 0.19, a));
        diffuseColor.rgb = c;`);
  });
  const g = new THREE.SphereGeometry(e.r, 20, 14); g.rotateX(Math.PI / 2);   // poles front and back so the iris is round
  return { geometry: g, material: m };
}

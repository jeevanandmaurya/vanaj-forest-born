// The opening, played in the world itself: the Pench in flood at night with a log going down it, then first light on
// the sandbank where the log came to rest, and the wolf who found what was tied to it. Seven lines, forty seconds,
// and it ends on the title. Nothing is loaded for it: the river, the storm, the wolf and the child's body are the
// game's own, so it looks like the game because it is the game. Space, Enter or a tap brings the next line; Skip
// leaves it. It ends on black, ready for the first chapter.
import * as THREE from 'three';
import { groundHeight, waterAt, riverX, riverY, RIVER_W } from '../world/terrain.js';
import { SITES } from '../world/props.js';
import { buildHumanoid, animateHumanoid } from '../actors/humanoid.js';
import { toon, toonify } from '../core/toon.js';
import { PAINTED } from '../core/palette.js';

const $ = (id) => document.getElementById(id);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// each shot: when it starts (seconds), and its lines with the moment each comes up
const SHOTS = [
  { id: 'flood', dur: 12.5, lines: [[1.2, 'I was three the year the Pench broke its banks.'], [6.4, 'We were crossing in the bullock cart when the water came.']] },
  { id: 'log', dur: 13.5, lines: [[0.8, 'My mother tied me to a log with her sari. She tied my little steel lota on beside me.'], [7.2, 'She hummed four notes, so I would not be afraid. Then the river took her.']] },
  { id: 'bank', dur: 19, lines: [[1.5, "I don't remember any of it. I only remember being carried."], [7.2, 'A wolf found me on a sandbank. The same flood had taken her pups.'], [13.2, 'She picked me up by the cloth at my waist and took me home. I called her Kaali.']] },
];

export class Opening {
  constructor(g) { this.g = g; }
  // the log, with the child and the lota tied on
  build() {
    const g = this.g, root = new THREE.Group(), mat = (c, o = {}) => (PAINTED ? toon({ color: new THREE.Color(c), ...o }) : new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 2.7, 9), mat('#6a5444')); log.rotation.x = Math.PI / 2; root.add(log);
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6), mat('#5c4838')); stub.position.set(0.16, 0.2, -0.9); stub.rotation.z = -0.7; root.add(stub);
    // the child: the smallest of the game's own bodies, lying along the log under two turns of red cloth
    const kid = buildHumanoid({ build: 'child', scale: 0.62, cloth: 'dhoti', clothCol: '#e6dfce', skinColor: 0xa8744e, hair: 'short', skinKey: 'skin-npcsukhi', outline: 0.004 });
    animateHumanoid(kid, 0.016, { speed: 0, weapon: 'none', ground: () => 0 });
    kid.root.rotation.set(-Math.PI / 2, 0, 0); kid.root.position.set(0, 0.3, 0.62); root.add(kid.root); this.kid = kid;
    for (const z of [0.02, 0.24]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.045, 6, 14), mat('#a33a30')); band.position.set(0, 0.09, z); band.scale.set(1, 1.2, 1.6); root.add(band); }
    const lota = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), PAINTED ? toon({ color: new THREE.Color('#c8ccd0'), rim: 1 }) : new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.3 })); lota.scale.y = 1.15; lota.position.set(-0.1, 0.27, -0.62); root.add(lota);
    if (PAINTED) for (const m of [log, stub, lota]) toonify(m, { outline: 0.008 });
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return root;
  }
  // the world as a shot needs it, made behind black: the season and hour, then the land round the camera
  async stage(season, weather, hour, at) {
    const g = this.g;
    g.setSeason(season, weather); g.setTime(hour); g.weather.env = { ...g.weather.target };
    g.camera.position.copy(at); g.player.pos.set(at.x, groundHeight(at.x, at.z), at.z);
    await new Promise((r) => setTimeout(r, 0)); g.terrain.update(at.x, at.z, 1e9, true);
    await new Promise((r) => setTimeout(r, 0)); g.veg.update(at, true); g.grass.update(at, true); g.cover.update(at, true);
    await new Promise((r) => setTimeout(r, 0));
  }
  play() {
    const g = this.g, E = $('cine'), L = $('cine-line'), Tt = $('cine-title'), fade = $('fade');
    return new Promise((resolve) => {
      let done = false, shot = -1, t = 0, lineI = 0, busy = true, wolf = null, hummed = false;
      const raft = this.build(); g.scene.add(raft);
      const bar = SITES.sandbar, bankP = V3(bar.x, groundHeight(bar.x, bar.z), bar.z);
      // the first dry ground out from the river as it stands now (in flood the sandbank itself is under water)
      const dryBank = () => { const z = bar.z; for (let x = riverX(z) + RIVER_W - 2; x < riverX(z) + RIVER_W + 45; x += 0.5) if (groundHeight(x, z) > waterAt(x, z) + 0.3) return bankP.set(x + 1.4, groundHeight(x + 1.4, z), z); return bankP; };
      const overWater = (x, z, h) => Math.max(groundHeight(x, z), waterAt(x, z)) + h;
      const logAt = (z, tt) => {
        const x = riverX(z) + Math.sin(z * 0.05) * 3, y = Math.max(waterAt(x, z), riverY(z)) + 0.05 + Math.sin(tt * 1.7) * 0.05;
        raft.position.set(x, y, z); raft.rotation.set(Math.sin(tt * 1.3) * 0.05, 0.25 + Math.sin(tt * 0.31) * 0.3, Math.sin(tt * 2.1) * 0.07);
      };
      const say = (text) => { L.classList.remove('show'); setTimeout(() => { if (done) return; L.textContent = text; L.classList.add('show'); }, 260); };
      const setFade = (v, ms) => { fade.style.transition = `opacity ${ms}ms`; fade.style.opacity = v; return new Promise((r) => setTimeout(r, ms)); };
      const start = async (n) => {
        busy = true; L.classList.remove('show');
        if (n > 0) await setFade(1, 700);
        if (done) return;
        if (n >= SHOTS.length) return finish();
        shot = n; t = 0; lineI = 0;
        const z0 = bar.z - 150;
        if (SHOTS[n].id === 'bank') {
          dryBank();
          await this.stage('monsoon', 'mist', 5.9, V3(bankP.x - 4.5, bankP.y + 1.4, bankP.z + 3.5));
          raft.position.set(bankP.x, bankP.y + 0.17, bankP.z); raft.rotation.set(0.04, 1.1, 0.1);
          const from = V3(bankP.x + 17, 0, bankP.z - 7);
          wolf = g.eco.spawnOne('wolf', from, { persistent: true, name: 'Kaali', bond: 1 }); wolf.keep = true;
          wolf.scripted = (dt, W, a) => {
            const d = Math.hypot(raft.position.x + 1.5 - a.pos.x, raft.position.z - 0.6 - a.pos.z);
            if (t < 2.4) { a.targetSpeed = 0; a.faceTowards(raft.position, dt * 2); a.lookAt = raft.position; }   // she has seen it, and stands a moment at the trees
            else if (d > 0.5) { a.steer(raft.position.x + 1.5, raft.position.z - 0.6, d > 5 ? a.d.walk * 1.7 : a.d.walk * 0.8, dt, W); a.mind.sniff = d < 5 ? 0.6 : 0; }
            else { a.targetSpeed = 0; a.faceTowards(raft.position, dt * 3); a.mind.sniff = t < 15.5 ? 1 : 0; a.mind.wag = t > 13 ? 0.8 : 0; }
          };
        } else if (n === 0) {
          await this.stage('monsoon', 'storm', 18.35, V3(riverX(z0 + 13) + 5, riverY(z0) + 3, z0 + 13));
          logAt(z0, 0);
        }
        // a few frames behind the black, so nothing is built in view
        for (let i = 0; i < 6 && !done; i++) { tick(1 / 30); g.render(1 / 30); await new Promise((r) => setTimeout(r, 30)); }
        if (done) return;
        busy = false; g.last = performance.now();
        setFade(0, n === 0 ? 1800 : 1100);
      };
      // one frame of the shot: where the log is, where the camera is
      const tick = (dt) => {
        if (shot < 0) return;
        const S = SHOTS[shot], cam = g.camera, z0 = bar.z - 150;
        if (!busy) t += dt;
        if (S.id === 'flood') {
          // low over the brown water, the log coming down out of the rain toward us
          const z = z0 + t * 2.6; logAt(z, t);
          const cz = z0 + 13 + t * 1.9, cx = riverX(cz) + 4.6 - t * 0.14;
          cam.position.set(cx, Math.max(waterAt(cx, cz), riverY(cz)) + 2.3 + Math.sin(t * 0.5) * 0.15, cz);
          cam.lookAt(raft.position.x, raft.position.y + 1.1, raft.position.z);
        } else if (S.id === 'log') {
          // close: round the log, slowly, as it turns in the current
          const z = z0 + 12.5 * 2.6 + t * 2.2; logAt(z, t + 12.5);
          const a = 0.9 + t * 0.07, r = 3.6 - t * 0.06;
          cam.position.set(raft.position.x + Math.sin(a) * r, raft.position.y + 1.25 + t * 0.03, raft.position.z + Math.cos(a) * r);
          cam.lookAt(raft.position.x, raft.position.y + 0.35, raft.position.z);
          if (t > 8.2 && !hummed) { hummed = true; g.audio.hum(); }
        } else {
          // first light on the sandbank: the log aground, and something coming down out of the trees
          const k = sm(0, 19, t);
          const cx = bankP.x - 4.5 + k * 1.2, cz = bankP.z + 3.5 - k * 0.8;
          cam.position.set(cx, overWater(cx, cz, 1.15 + k * 0.2), cz);
          cam.lookAt(raft.position.x + 1.2, raft.position.y + 0.55, raft.position.z - 0.6);
          if (wolf && !busy) wolf.update(dt, g.W);
        }
        cam.updateMatrixWorld();
        g.player.pos.set(cam.position.x, cam.position.y - 1.4, cam.position.z);   // (the river's sound, and what streams in, follow the camera)
        if (busy) return;
        while (lineI < S.lines.length && t >= S.lines[lineI][0]) say(S.lines[lineI++][1]);
        if (t >= S.dur) start(shot + 1);
      };
      // the next line now (or the next shot, if this one has said everything)
      const hurry = () => { if (done || busy || shot < 0) return; const S = SHOTS[shot]; if (lineI < S.lines.length) t = S.lines[lineI][0]; else t = S.dur; };
      const cleanup = () => {
        g.cine = null; g.scene.remove(raft); if (wolf) g.eco.remove(wolf);
        window.removeEventListener('keydown', onKey); E.onclick = null; g.skipPrologue = null;
        E.classList.remove('show'); setTimeout(() => E.classList.remove('on'), 500);
      };
      const end = () => { cleanup(); g.audio.scene(false, 0.5); fade.style.transition = 'none'; fade.style.opacity = 1; resolve(); };
      const finish = () => {
        if (done) return; done = true; L.classList.remove('show'); Tt.classList.add('show');
        if (g.music) g.music.stinger('theme');
        setTimeout(() => { Tt.classList.remove('show'); setTimeout(end, 900); }, 3600);
      };
      const skip = g.skipPrologue = () => { if (done) return; done = true; setFade(1, 350).then(end); };
      const onKey = (e) => { if (e.code === 'Escape') skip(); else if (e.code === 'Space' || e.code === 'Enter') hurry(); };
      window.addEventListener('keydown', onKey);
      E.onclick = (e) => { if (e.target.id === 'cine-skip') skip(); else hurry(); };
      // to black, the title away, the forest's own sound up (rain, river, thunder), then the first shot
      Tt.classList.remove('show'); L.classList.remove('show'); L.textContent = '';
      E.classList.add('on'); void E.offsetWidth; E.classList.add('show');
      setFade(1, 450).then(() => { if (done) return; $('title').classList.remove('show'); g.cine = tick; g.audio.scene(true, 2); start(0); });
    });
  }
}

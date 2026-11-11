// The story engine: chapters made of objectives, the cast, villagers, and the helpers the chapters use.
// What happens in each chapter is in js/game/chapters.js. An objective is one beat of the story, and may have:
//   text            what to do, on the HUD (a string, or a function for one that counts)
//   say, after      lines spoken as it starts, and once it is done (js/game/dialogue.js)
//   cast            directives for the cast while it lasts: { kaali: { type: 'lead', to } } (js/sim/mind.js)
//   tension         0..1, how wary the forest is while it lasts (the animals read it as danger)
//   teach           skills to tick off (js/game/lessons.js)
//   marker, markerFn, reach    where the pointer goes; reach also ends it on arrival
//   check, tick, run           when it is done; something to do each frame; a script of its own
//   interact, use   something to do with E: at a place or a creature, or at one of the world's own props
//   done            what happens as it ends
import * as THREE from 'three';
import { SITES } from '../world/props.js';
import { groundHeight, VILLAGE } from '../world/terrain.js';
import { buildHumanoid, animateHumanoid, buildWeapons } from '../actors/humanoid.js';
import { PAINTED } from '../core/palette.js';
import { toonify } from '../core/toon.js';
import { CH, bindGame } from './chapters.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const FLAT = () => 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const sitePos = (k, dx = 0, dz = 0) => { const s = SITES[k]; return V3(s.x + dx, groundHeight(s.x + dx, s.z + dz), s.z + dz); };

// --------------------------------------------------------------------------------------------- villagers
// A villager has a day of their own and a view of him, both read from the world (js/sim/director.js):
//   world.phase     where they are: indoors at night, at the door at dawn, about their work by day, together at dusk
//   world.village   'far' they have not met him; 'meeting' he has just walked in: they stop, stare, keep their distance,
//                   and the children creep closer; 'home' he is one of them: a look and a word as he passes
// A scene of the story takes one over by giving it somewhere to go or something to do (scripted).
export class NPC {
  constructor(g, o) {
    this.g = g; this.name = o.name; this.role = o.role || (o.build === 'child' ? 'child' : o.age ? 'elder' : 'adult');
    // what they wear, as colours for the body paint (the old cloth textures are kept for the real-look renderer)
    const colOf = (t) => (t === g.T.clothWhite ? '#e6dfce' : t === g.T.clothKhaki ? '#a89468' : t === g.T.clothRed ? '#a33a30' : null);
    this.h = buildHumanoid({ age: o.age, clothCol: colOf(o.clothTex), topCol: colOf(o.topTex), turbanColor: new THREE.Color(colOf(o.turban) || '#d8d0bc'), scale: o.scale || 1, skinColor: o.skin || 0x9a6a4a, mud: 0.05, hair: o.hair || 'short', hairColor: o.hairColor, cloth: o.cloth || 'dhoti', clothTex: o.clothTex, topTex: o.topTex, turban: o.turban, lean: o.lean || 1, build: o.build, skinKey: 'skin-npc' + (o.skinKey || '') });
    g.scene.add(this.h.root); this.shown = true;
    this.pos = this.h.root.position; this.pos.copy(o.pos); this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.home = this.pos.clone();
    this.yaw = o.yaw || 0; this.speed = 0; this.path = []; this.state = 'idle'; this.look = null; this.up = 0; this.action = null; this.t = Math.random() * 10;
    this.radius = 0.4; this.d = { H: 1.6 * (o.scale || 1) };   // the physics capsule (solid to Vanaj, slides round trunks)
    this.scripted = !!o.scripted; this.nextT = rnd(1, 6); this.greetCD = 0; this.kneel = 0;
    if (o.flute) { const W = buildWeapons(g.T); const f = W.flute; f.rotation.set(Math.PI / 2, 0, 0); f.position.set(0, -0.08, 0); if (PAINTED) toonify(f, { outline: 0.006, soften: 2 }); this.h.j.handR.add(f); this.flute = f; }
  }
  walkTo(p, run = false) { this.path = [p.clone()]; this.run = run; }
  // their own day, and what they make of him
  think(dt) {
    const g = this.g, W = g.world, P = g.player, mood = W.village || 'far';
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    this.greetCD -= dt; this.nextT -= dt;
    if (mood === 'meeting' && d < 18) {
      // everything stops. Grown-ups hold their ground until he is close, then give way; children come to look.
      this.state = 'stare'; this.look = P.pos; this.kneel = 0;
      if (this.role === 'child') { if (d > 7.5) this.walkTo(V3(P.pos.x - dx / d * 6, 0, P.pos.z - dz / d * 6)); else this.path.length = 0; }
      else if (d < 4.2 && !this.path.length) this.walkTo(V3(this.pos.x - dx / d * 3, 0, this.pos.z - dz / d * 3));
      else if (d >= 4.2) this.path.length = 0;
      return;
    }
    if (mood === 'home' && d < 5.5 && this.greetCD <= 0 && !P.dead) {
      this.greetCD = rnd(45, 90); this.state = 'greet'; this.look = P.pos; this.path.length = 0; this.nextT = 3.5;
      g.emit('greet', { npc: this });
      return;
    }
    if (this.state === 'greet' && this.nextT > 0) return;
    if (this.nextT > 0 || this.path.length) return;
    // the day: where to be now
    const ph = W.phase, V = VILLAGE; this.look = null; this.kneel = 0;
    if (ph === 'night') { this.state = 'home'; this.walkTo(this.home); this.nextT = rnd(20, 40); }
    else if (ph === 'dusk' || (ph === 'dawn' && this.role === 'elder')) { this.state = 'gather'; const a = Math.random() * 6.28, r = rnd(3, 6); this.walkTo(V3(V.x + Math.cos(a) * r, 0, V.z + Math.sin(a) * r)); this.look = V3(V.x, 0, V.z); this.nextT = rnd(18, 40); }
    else if (ph === 'midday') { this.state = 'rest'; this.walkTo(V3(this.home.x + rnd(-1.5, 1.5), 0, this.home.z + rnd(-1.5, 1.5))); this.nextT = rnd(15, 30); this.restNext = true; }
    else { this.state = 'work'; const r = this.role === 'child' ? 22 : 14, a = Math.random() * 6.28; this.walkTo(V3(this.home.x + Math.cos(a) * rnd(4, r), 0, this.home.z + Math.sin(a) * rnd(4, r))); this.nextT = rnd(6, 16); this.workNext = Math.random() < 0.6; }
  }
  update(dt) {
    this.t += dt;
    const G = this.g;
    if (!this.scripted) this.think(dt);
    let target = 0;
    if (this.path.length) {
      const p = this.path[0]; const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.6) {
        this.path.shift();
        // arrived: bend to the work, or sit in the shade
        if (!this.scripted && !this.path.length) { this.busy = this.workNext ? 'gather' : null; this.kneel = this.restNext ? 1 : 0; this.workNext = this.restNext = false; }
      } else { this.busy = null; const want = Math.atan2(dx, dz); let df = want - this.yaw; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; this.yaw += Math.max(-dt * 5, Math.min(dt * 5, df)); target = this.run ? 5.5 : this.role === 'child' ? 2.2 : 1.4; }
    } else if (this.look) { const want = Math.atan2(this.look.x - this.pos.x, this.look.z - this.pos.z); let df = want - this.yaw; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; this.yaw += Math.max(-dt * 3, Math.min(dt * 3, df)); }
    this.speed += (target - this.speed) * Math.min(1, dt * 5);
    const x0 = this.pos.x, z0 = this.pos.z;
    this.pos.x += Math.sin(this.yaw) * this.speed * dt; this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    this.pos.y = groundHeight(this.pos.x, this.pos.z) + this.up;
    // near Vanaj a villager walks through the physics world: round trunks, rocks and walls, and solid to him
    // (held up 2.5 s with somewhere to be, say by a house wall, he passes through for a moment: a story beat
    // waiting on him must never hang)
    if (this.ghost > 0) this.ghost -= dt;
    else if (G.phys && G.player && this.pos.distanceToSquared(G.player.pos) < 45 * 45) {
      G.phys.moveActor(this, x0, z0); this.pos.y = groundHeight(this.pos.x, this.pos.z) + this.up;
      this.stuckT = target > 0 && Math.hypot(this.pos.x - x0, this.pos.z - z0) < target * dt * 0.25 ? (this.stuckT || 0) + dt : 0;
      if (this.stuckT > 2.5) { this.ghost = 3; this.stuckT = 0; }
    }
    this.h.root.rotation.y = this.yaw;
    // as for the animals: out of sight it is out of the scene and not posed, and further off it is posed less often, without its outline
    // or its shadow (a villager is a dozen draw calls and a skeleton). Indoors for the night they are not drawn at all.
    const q = G.q, d2 = G.camera.position.distanceToSquared(this.pos), indoors = !this.scripted && this.state === 'home' && !this.path.length;
    const show = !indoors && d2 < q.animalDraw * q.animalDraw && (d2 < 144 || G.eco.inView(this.pos, 2));
    if (show !== this.shown) { this.shown = show; if (show) G.scene.add(this.h.root); else G.scene.remove(this.h.root); this.animAcc = 1; }
    this.animAcc = (this.animAcc || 0) + dt;
    if (!show) return;
    const ink = d2 < q.inkDraw * q.inkDraw, sh = d2 < q.animalShadow * q.animalShadow;
    if (ink !== this.inkOn || sh !== this.shadowOn) {
      this.inkOn = ink; this.shadowOn = sh;
      this.h.root.traverse((o) => { if (o.userData.ink) o.visible = ink; else if (o.isMesh) o.castShadow = sh; });
    }
    if (this.animAcc < (d2 < 400 ? 0 : d2 < 2500 ? q.animStep : q.animStep * 2)) return;
    const pdt = Math.min(0.5, this.animAcc); this.animAcc = 0;
    const kind = this.action || this.busy, act = kind ? { type: kind, t: (this.t % 2) / 2 } : null;
    animateHumanoid(this.h, pdt, { speed: this.speed, weapon: 'none', action: act, crouch: this.up > 0 || (this.kneel > 0 && this.speed < 0.2) ? 1 : 0, ground: this.up > 0 ? undefined : FLAT, lookAt: this.look && !this.path.length ? this.look : undefined });
  }
  remove() { this.g.scene.remove(this.h.root); }
}

let S_ = null; // the story, for objective text that counts things
export const theStory = () => S_;

export class Story {
  constructor(g) {
    this.g = g; S_ = this; this.CH = CH; bindGame(g);
    this.chIndex = -1; this.objIndex = 0; this.flags = {}; this.gen = 0; this.marker = null; this.npcs = []; this.storyItems = []; this.done = false;
    g.on('drink', () => (this.flags.drank = true));
    g.on('sleep', () => (this.flags.slept = true));
    g.on('climbed', () => (this.flags.climbed = true));
    g.on('swung', () => (this.flags.swung = true));
    g.on('eat', (e) => { this.flags.ate = true; if (e.item === 'termites') this.flags.ateTermites = true; });
    g.on('clue', (e) => { this.flags['clue_' + e.id] = true; if (e.id === 'stump' && g.inv.locks.delete('axe')) g.ui.toast('You could make something that cuts like that (Bag)'); });
    g.on('*', () => this.checkNow());
  }
  // leave the current chapter (back to the title): its scripts stop, its people, items and companion go
  stop() {
    const g = this.g;
    if (this.chapter && this.chapter.cleanup) this.chapter.cleanup(g, this);
    this.gen++; this.chIndex = -1; this.objIndex = 0; this.flags = {}; this.marker = null; this.done = false; this.advancing = false;
    g.talk.clear(); g.director.reset(); g.world.village = 'far';
    for (const n of this.npcs) n.remove(); this.npcs = []; g.npcs = []; this.villageSpawned = false; this.sukhi = null; this.aaji = null;
    for (const it of this.storyItems) g.scene.remove(it.mesh); this.storyItems = [];
    if (this.restMesh) { g.scene.remove(this.restMesh); this.restMesh = null; }
    if (g.companion) { g.eco.remove(g.companion); g.companion = null; } g.companionBody = null;
  }
  get chapter() { return CH[this.chIndex]; }
  // (between one objective ending and the next beginning there is none: nothing can be done twice, or too early)
  get obj() { return this.advancing ? null : this.chapter && this.chapter.objectives[this.objIndex]; }
  objText() { const o = this.obj; if (!o) return ''; return typeof o.text === 'function' ? o.text(this.g, this) : o.text; }
  // a pause in a script: false if the chapter was left meanwhile
  async pause(gen, sec) { await this.g.wait(sec); return this.gen === gen; }
  async start(i, opts = {}) {
    const g = this.g, prev = this.chapter;
    if (prev && prev.cleanup) prev.cleanup(g, this);
    this.gen++; const gen = this.gen;
    const flow = !!(opts.flow && prev);   // straight on from the last chapter: same place, same hour, nothing put away
    this.chIndex = i; this.objIndex = 0; this.lookedNorth = false; this.lookT = 0; this.advancing = false;
    if (!flow) { this.flags = {}; g.talk.clear(); g.director.reset(); }
    const c = this.chapter;
    // Everything about a new place happens behind black, then picture and sound come up together on the way down to him
    const build = async () => {
      if (opts.onBlack) opts.onBlack();
      if (!opts.keepState && !flow) {
        g.setSeason(c.season, c.weather);
        g.setTime(c.hour);
        await g.teleportScene(sitePos(c.spawn[0], c.spawn[1], c.spawn[2]), c.spawnYaw || 0);
        // a chapter opens with him fed and watered: the story is not interrupted by his belly in its first minutes
        const P = g.player; P.hunger = Math.max(P.hunger, 72); P.thirst = Math.max(P.thirst, 72); P.hp = Math.max(P.hp, 60);
      }
      if (c.setup) c.setup(g, this);
      g.save();
    };
    this.entering = true;
    if (flow) { await build(); g.ui.card(c.title, c.act, 4.5); if (g.music) g.music.stinger('chapter'); }
    else if (opts.keepState) await build();
    else await g.enterScene(build, { dur: i === 0 && !opts.chapterSelect ? 8 : 6, title: [c.title, c.act], stinger: 'chapter' });
    if (this.gen !== gen) return;
    this.entering = false;
    if (c.intro && c.intro.length) g.talk.say(c.intro);
    this.beginObjective();
  }
  beginObjective() {
    const g = this.g, o = this.obj, gen = this.gen;
    if (!o) return this.finishChapter();
    o._doneOnce = false; if (o.interact) o.interact._used = false; if (o.use) o.use._used = false;
    g.ui.setObjective(this.chapter.title, this.objText());
    g.world.tension = o.tension || 0; g.world.quiet = !!(o.quiet || this.chapter.quiet);
    if (o.cast) for (const k in o.cast) { const d = o.cast[k]; g.director.direct(k, typeof d === 'function' ? d(g, this) : d); }
    if (o.say) g.talk.say(typeof o.say === 'function' ? o.say(g, this) : o.say);
    if (o.teach) g.lessons.teach(o.teach, o.teachTitle || '', true);
    if (o.hint) setTimeout(() => { if (this.obj === o && this.gen === gen) g.ui.toast(o.hint, 7); }, 9000);
    if (o.onStart) o.onStart(g, this);
    if (o.run) o.run(g, this, gen);
  }
  next() {
    const g = this.g, o = this.obj;
    if (!o) return;
    if (o.done) { try { o.done(g, this); } catch (e) { console.warn(e); } }   // a beat that fails must not wedge the chapter
    if (o.after) g.talk.say(typeof o.after === 'function' ? o.after(g, this) : o.after);
    g.lessons.endObjective();
    g.audio.ui('tick');
    const gen = this.gen; this.advancing = true; this.marker = null;
    g.wait(0.6).then(() => { if (this.gen !== gen) return; this.advancing = false; this.objIndex++; g.emit('beat', { chapter: this.chapter.id, index: this.objIndex }); this.beginObjective(); });
  }
  async finishChapter() {
    const g = this.g, c = this.chapter, gen = this.gen;
    if (c.ending) { c.ending(g, this); return; }
    g.ui.setObjective(c.title, '');
    g.world.tension = 0; g.world.quiet = true;
    // let whatever is being said finish, then the chapter's last words
    for (let i = 0; i < 80 && g.talk.busy && this.gen === gen; i++) await g.wait(0.5);
    if (this.gen !== gen) return;
    if (c.outro && c.outro.length) await g.talk.say(c.outro);
    await g.wait(1.2); if (this.gen !== gen) return;
    const nextI = this.chIndex + 1;
    if (nextI >= CH.length) return;
    if (c.nextSeason) {
      g.audio.scene(false, 1.2);
      await g.ui.fade(true, 1500); if (this.gen !== gen) return;
      g.ui.card('Months went by', { summer: 'The hot months', monsoon: 'The rains', post: 'After the rains' }[c.nextSeason], 3);
      await g.wait(3.4); if (this.gen !== gen) return;
      this.start(nextI);
    } else this.start(nextI, { flow: !!CH[nextI].flows });
  }
  checkNow() {
    const o = this.obj; if (!o || !o.check || this.entering) return;
    if (o._doneOnce) return;
    try { if (o.check(this.g, this)) { o._doneOnce = true; this.next(); } } catch (e) { console.warn(e); }
  }
  update(dt) {
    const g = this.g, o = this.obj;
    for (const n of this.npcs) n.update(dt);
    // compass / map marker
    this.marker = null;
    if (o && !this.entering) {
      if (o.markerFn) { const p = o.markerFn(g, this); if (p) this.marker = { x: p.x, z: p.z, y: p.y > 0 && p.isVector3 ? p.y + 1 : undefined }; }
      else if (o.marker) this.marker = { x: SITES[o.marker].x, z: SITES[o.marker].z };
      else if (o.reach) this.marker = { x: SITES[o.reach[0]].x, z: SITES[o.reach[0]].z };
      if (o.tick) o.tick(g, this, dt);
      if (o.reach) { const s = SITES[o.reach[0]]; if ((g.player.pos.x - s.x) ** 2 + (g.player.pos.z - s.z) ** 2 < o.reach[1] ** 2 && !o._doneOnce) { o._doneOnce = true; this.next(); } }
      this.chkT = (this.chkT || 0) - dt;
      if (this.chkT <= 0) { this.chkT = 0.25; this.checkNow(); if (typeof o.text === 'function') { const t = g.ui.forThumbs(this.objText()); if (t !== this._objT) { this._objT = t; g.ui.obj.innerHTML = t; } } }
    }
    // soft boundary: the village before the last act
    if (this.chapter && !this.chapter.village && !this.done) {
      const d = Math.hypot(g.player.pos.x - VILLAGE.x, g.player.pos.z - VILLAGE.z);
      if (d < 330) {
        const k = (330 - d) / 330; g.player.vel.x += (g.player.pos.x - VILLAGE.x) / d * k * 30 * dt; g.player.vel.z += (g.player.pos.z - VILLAGE.z) / d * k * 30 * dt;
        g.talk.bark('village-edge', [[['vanaj', "Smoke. Dogs. Something that isn't forest... Not yet. I'm not ready."]]], { cd: 25 });
      }
    }
  }
  // ------------------------------------------------------------------ helpers used by chapters
  cast(key, ent) { return this.g.director.enroll(key, ent); }
  ensureKaali() {
    const g = this.g;
    if (g.companion && !g.companion.dead && g.companion.name === 'Kaali') return this.cast('kaali', g.companion);
    const p = g.player.pos.clone().add(V3(2, 0, 2));
    const k = g.eco.spawnOne('wolf', p, { companion: true, persistent: true, name: 'Kaali', bond: 1, hpMul: 1.4, scale: 1.0 });
    g.setCompanion(k);
    return this.cast('kaali', k);
  }
  ensureChingari() {
    const g = this.g;
    if (g.companion && !g.companion.dead && g.companion.name === 'Chingari') return this.cast('chingari', g.companion);
    if (!g.flags.chingari) return null;
    const pup = g.eco.spawnOne('dhole', g.player.pos.clone().add(V3(2, 0, 2)), { companion: true, persistent: true, name: 'Chingari', scale: 0.9, bond: 1, hpMul: 2.4 });
    g.setCompanion(pup);
    return this.cast('chingari', pup);
  }
  spawnTornEar(pos, o = {}) {
    const g = this.g;
    for (const a of [...g.eco.animals]) if (a.story === 'tornear') g.eco.remove(a);
    const t = g.eco.spawnOne('tiger', pos, { story: 'tornear', name: 'Torn-Ear', persistent: true, aggro: o.aggro ?? 0, hpMul: o.hpMul || 1, scale: 1.12, male: true });
    if (t.J.earL) { t.J.earL.scale.set(0.55, 0.7, 1); t.J.earL.rotation.z = 0.9; }
    if (t.J.kneeRF) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 4, 16), new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 1, roughness: 0.2 })); ring.rotation.x = Math.PI / 2; ring.position.y = -0.1; t.J.kneeRF.add(ring); if (PAINTED) toonify(ring, { outline: 0 }); t.wireRing = ring; }
    t.limp = 0.35; t.keep = true;
    g.ui.seeLore('tiger');
    return this.cast('tornear', t);
  }
  // an animal leaves the scene for good: off to a far point, then out of the world
  sendAway(a, to, speed = 'run') {
    const g = this.g; if (!a || !g.eco.animals.includes(a)) return;
    a.aggro = 0; a.target = null; a.scripted = null; a.routed = false; a.keep = false;
    a.mind.direct({ type: 'goto', to, speed, brave: true, r: 6, then: (x) => g.eco.remove(x) });
    const gen = this.gen; setTimeout(() => { if (g.eco.animals.includes(a) && a.dist2(g.player.pos) > 60 * 60) g.eco.remove(a); else if (this.gen === gen) setTimeout(() => g.eco.animals.includes(a) && g.eco.remove(a), 30000); }, 30000);
  }
  addStoryItem(id, pos, prompt) {
    const g = this.g;
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 4, 20), new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 1, roughness: 0.15, emissive: 0x303438 }));
    m.position.copy(pos); m.position.y = groundHeight(pos.x, pos.z) + 0.04; m.rotation.x = -Math.PI / 2; g.scene.add(m);
    if (PAINTED) toonify(m, { outline: 0, rim: 1 });
    const it = { id, pos: m.position.clone(), mesh: m, prompt };
    this.storyItems.push(it);
    return it;
  }
  // a low mound of leaves over someone who is not getting up
  layToRest(a) {
    const g = this.g;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a7a3a, roughness: 1 }));
    m.scale.set(1.25, 0.42, 0.85); m.position.copy(a.pos); m.rotation.y = a.yaw; g.scene.add(m);
    if (PAINTED) toonify(m, { outline: 0 });
    a.root.visible = false; this.restMesh = m;
  }
  npc(o) { const n = new NPC(this.g, o); this.npcs.push(n); this.g.npcs = this.npcs; return n; }
  spawnSukhi(pos) {
    const g = this.g;
    if (this.sukhi) return this.sukhi;
    this.sukhi = this.npc({ name: 'Sukhi', pos, scale: 0.8, build: 'child', cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothKhaki, flute: true, skinKey: 'sukhi', scripted: true });
    g.director.enroll('sukhi', this.sukhi);
    return this.sukhi;
  }
  spawnVillage() {
    const g = this.g;
    if (this.villageSpawned) return; this.villageSpawned = true;
    const V = VILLAGE;
    const houses = g.props.houses || [];
    this.aaji = this.npc({ name: 'Aaji Phulwati', pos: V3(V.x + 2, 0, V.z + 3), scale: 0.9, cloth: 'sari', clothTex: g.T.clothRed, hair: 'short', hairColor: 0xd0ccc4, skinKey: 'aaji', age: 1, scripted: true });
    g.director.enroll('aaji', this.aaji);
    const looks = [
      { cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothWhite, turban: g.T.clothWhite },
      { cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothKhaki, turban: g.T.clothRed },
      { cloth: 'sari', clothTex: g.T.clothKhaki },
      { cloth: 'dhoti', clothTex: g.T.clothKhaki, topTex: g.T.clothWhite, turban: g.T.clothKhaki },
      { cloth: 'sari', clothTex: g.T.clothRed },
    ];
    for (let i = 0; i < Math.min(9, houses.length); i++) {
      const h = houses[i], L = looks[i % looks.length], child = i % 4 === 3;
      this.npc({ name: 'Villager', pos: h.door.clone(), yaw: h.rot, skinKey: child ? 'sukhi' : 'v' + (i % 3), skin: [0x9a6a4a, 0x8a5a3e, 0xa87656][i % 3], ...(child ? { build: 'child', scale: 0.78, cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothKhaki } : L) });
    }
    g.eco.spawnGroup('dog', V3(V.x + 20, 0, V.z - 10), 3);
    g.eco.spawnGroup('cow', V3(V.x - 80, 0, V.z + 60), 5, { persistent: true });
  }
  farFlute(notes, at) {
    const g = this.g, a = g.audio; if (!a.ready || !g.music) return;
    const p = at || sitePos('sukhiSpot');
    const out = a.spatial({ x: p.x, y: p.y + 1.5, z: p.z }, 3.5, { verb: 0.9, ref: 20, bus: a.music });
    g.music.flutePhrase(notes, a.ctx.currentTime + 0.1, { gain: 0.25, dest: out });
  }
}

// The story of Vanaj: prologue, twelve chapters across four seasons, epilogue. Objectives, scripted encounters
// (Torn-Ear, the Shadow, the Red Whistlers), the clue trail, villagers (Sukhi, Aaji Phulwati) and the ending.
import * as THREE from 'three';
import { SITES } from '../world/props.js';
import { groundHeight, VILLAGE, riverX } from '../world/terrain.js';
import { buildHumanoid, animateHumanoid, buildWeapons } from '../actors/humanoid.js';
import { THEME } from '../audio/music.js';
import { SP } from '../world/flora.js';
import { PAINTED } from '../core/palette.js';
import { toonify } from '../core/toon.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const sitePos = (k, dx = 0, dz = 0) => { const s = SITES[k]; return V3(s.x + dx, groundHeight(s.x + dx, s.z + dz), s.z + dz); };

// --------------------------------------------------------------------------------------------- villagers
export class NPC {
  constructor(g, o) {
    this.g = g; this.name = o.name;
    // what they wear, as colours for the body paint (the old cloth textures are kept for the real-look renderer)
    const colOf = (t) => (t === g.T.clothWhite ? '#e6dfce' : t === g.T.clothKhaki ? '#a89468' : t === g.T.clothRed ? '#a33a30' : null);
    this.h = buildHumanoid({ age: o.age, clothCol: colOf(o.clothTex), topCol: colOf(o.topTex), turbanColor: new THREE.Color(colOf(o.turban) || '#d8d0bc'), scale: o.scale || 1, skinColor: o.skin || 0x9a6a4a, mud: 0.05, hair: o.hair || 'short', hairColor: o.hairColor, cloth: o.cloth || 'dhoti', clothTex: o.clothTex, topTex: o.topTex, turban: o.turban, lean: o.lean || 1, build: o.build, skinKey: 'skin-npc' + (o.skinKey || '') });
    g.scene.add(this.h.root);
    this.pos = this.h.root.position; this.pos.copy(o.pos); this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.yaw = o.yaw || 0; this.speed = 0; this.path = []; this.state = 'idle'; this.look = null; this.up = 0; this.action = null; this.t = Math.random() * 10;
    this.radius = 0.4; this.d = { H: 1.6 * (o.scale || 1) };   // the physics capsule (solid to Vanaj, slides round trunks)
    if (o.flute) { const W = buildWeapons(g.T); const f = W.flute; f.rotation.set(Math.PI / 2, 0, 0); f.position.set(0, -0.08, 0); if (PAINTED) toonify(f, { outline: 0.006, soften: 2 }); this.h.j.handR.add(f); this.flute = f; }
  }
  walkTo(p, run = false) { this.path = [p.clone()]; this.run = run; }
  update(dt) {
    this.t += dt;
    let target = 0;
    if (this.path.length) {
      const p = this.path[0]; const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.6) this.path.shift();
      else { const want = Math.atan2(dx, dz); let df = want - this.yaw; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; this.yaw += Math.max(-dt * 5, Math.min(dt * 5, df)); target = this.run ? 5.5 : 1.4; }
    } else if (this.look) { const want = Math.atan2(this.look.x - this.pos.x, this.look.z - this.pos.z); let df = want - this.yaw; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; this.yaw += Math.max(-dt * 3, Math.min(dt * 3, df)); }
    this.speed += (target - this.speed) * Math.min(1, dt * 5);
    const x0 = this.pos.x, z0 = this.pos.z, G = this.g;
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
    const act = this.action ? { type: this.action, t: (this.t % 2) / 2 } : null;
    animateHumanoid(this.h, dt, { speed: this.speed, weapon: 'none', action: act, crouch: this.up > 0 ? 1 : 0 });
  }
  remove() { this.g.scene.remove(this.h.root); }
}

// --------------------------------------------------------------------------------------------- chapters
const CH = [];
const chapter = (o) => CH.push(o);
// a quiet beat: Vanaj kneels or sits, the lines come one by one, then the objective is done
async function sitBeat(g, S, flag, lines, opts = {}) {
  const gen = S.gen; g.player.crouch = true; g.player.action = { type: opts.anim || 'hum', anim: opts.anim || 'hum', t: 0, dur: 4 };
  if (opts.hum) g.audio.hum();
  for (const l of lines) { g.ui.narrate([l]); await g.wait(Math.max(3.5, l.length * 0.07)); if (S.gen !== gen) return; }
  if (opts.journal) g.ui.addJournal(opts.journal[0], opts.journal[1], 'story');
  S.flags[flag] = true; S.checkNow();
}
// the semal nearest the den: the tree the langurs teach Vanaj to climb
function lessonTree(g) {
  if (g._lessonTree) return g._lessonTree;
  const d = SITES.den; let best = null, bd = Infinity;
  for (const t of g.veg.climbNear(d.x, d.z, 64)) { if (t.sp !== SP.semal) continue; const k = Math.hypot(t.x - d.x, t.z - d.z); if (k < bd) { bd = k; best = t; } }
  return (g._lessonTree = best);
}
// The langur race: a chain of big trees outward from the lesson semal (each 6-32 m from the last), and on each a
// perch out on the limb that reaches furthest toward the next tree, at mid-crown
function canopyRoute(g) {
  const start = lessonTree(g); if (!start) return [];
  const pool = g.veg.climbNear(start.x, start.z, 64).filter((t) => t.trunk && (t.sp === SP.semal || t.trunk.r[0] > 0.45));
  const chain = [start], used = new Set([start]);
  while (chain.length < 6) {
    const last = chain[chain.length - 1]; let best = null, bd = Infinity;
    for (const t of pool) { if (used.has(t)) continue; const d = Math.hypot(t.x - last.x, t.z - last.z); if (d > 6 && d < 32 && d < bd) { bd = d; best = t; } }
    if (!best) break; chain.push(best); used.add(best);
  }
  return chain.map((t, i) => {
    const to = chain[i + 1] || chain[i - 1] || t, dx = to.x - t.x, dz = to.z - t.z, dd = Math.hypot(dx, dz) || 1;
    let pt = null, bs = -Infinity;
    for (const L of t.limbs) {
      if (L.level !== 1) continue;
      for (let k = 1; k < L.pts.length && L.r[k] >= 0.09; k++) {
        const p = L.pts[k], reach = ((p.x - t.x) * dx + (p.z - t.z) * dz) / dd, s = reach - Math.abs(p.y - (t.top - 8)) * 0.3;
        if (s > bs) { bs = s; pt = p.clone(); pt.y += L.r[k] + 0.05; }
      }
    }
    return pt || V3(t.x, t.top - 6, t.z);
  });
}

chapter({
  id: 'c1', title: 'Fog on the Teak', act: 'Act I · Winter', season: 'winter', weather: 'mist', hour: 7.05, spawn: ['den', 3, 6],
  setup(g, S) {
    S.ensureKaali();
    g.eco.spawnGroup('peafowl', sitePos('den', 45, 20), 3);
    g.eco.spawnGroup('chital', sitePos('den', -90, 70), 7);
    const lt = lessonTree(g); S.lessonTroop = g.eco.spawnGroup('langur', lt ? V3(lt.x + 4, 0, lt.z + 3) : sitePos('den', 30, -40), 6).members;
  },
  intro: ['Twelve winters later.', 'The fog came down the valley every morning and lay in the teak until the sun burned it off.', 'Kaali was old by then. I was not small any more.'],
  objectives: [
    { text: () => `Gather sticks (${S_.g.inv.count('stick')}/4) and stones (${S_.g.inv.count('stone')}/2) from the forest floor`, hint: 'Look down. <b>E</b> picks up what you see.', check: (g) => g.inv.count('stick') >= 4 && g.inv.count('stone') >= 2 },
    { text: 'Knap a stone knife — open your pouch with <b>Tab</b> and craft it', check: (g) => g.inv.has('knife'), done: (g) => { g.player.equip('knife'); g.ui.narrate('Stone on stone, until one edge bites.'); } },
    { text: 'Drink at the waterhole', marker: 'denWater', check: (g, S) => S.flags.drank },
    // the young langurs teach the canopy: the forest's other half, and the first joy of the game
    { text: 'The young langurs are playing in the big semal. Climb up after them', markerFn: (g) => lessonTree(g), hint: '<b>Space</b> facing a big trunk to climb · <b>W</b> up, <b>A</b>/<b>D</b> round it · keep climbing at a limb to step out onto it',
      check: (g) => !!g.player.canopy.mode && g.player.pos.y - groundHeight(g.player.pos.x, g.player.pos.z) > 7,
      done: (g) => g.ui.narrate(['From up there the forest was another country. The teak lay below me like a green sea with the fog still in it.', 'Kaali sat at the foot of the tree and barked at me, the way she did when I was small and climbed too high.']) },
    { text: 'Swing on a liana, let go, and catch the next hold', hint: 'Hold <b>Space</b> to catch a liana or branch · <b>W</b> swings higher · let go of <b>Space</b> to fly · hold it again to catch',
      check: (g, S) => S.flags.swung,
      done: (g) => { g.ui.narrate(['I flew.', 'For one breath I was not a boy and not a wolf. I was something the forest had never seen.', 'The langurs shrieked at me. I think they were laughing.']); if (g.music) g.music.stinger('clue'); } },
    // the race: one of the young langurs leads through the crowns, waiting at each tree; the ground costs nothing
    // but pride, and after a few minutes it ends kindly
    { text: 'Race the young langur through the trees', markerFn: (g, S) => S.raceAt, check: (g, S) => S.flags.raced,
      hint: 'Climb, walk out along a limb, leap and catch. The langur waits for you at each tree.',
      async run(g, S, gen) {
        const route = canopyRoute(g), P = g.player;
        const lead = (S.lessonTroop || []).find((a) => !a.dead);
        if (!lead || route.length < 2) { S.flags.raced = true; S.checkNow(); return; }
        let wp = 0, hop = null, falls = 0, wasUp = false, scold = 0;
        lead.perch = route[0]; lead.pos.copy(route[0]); lead.hop = null; S.raceAt = route[0];
        lead.scripted = (dt, W, a) => {
          a.targetSpeed = 0; a.speed = 0;
          if (hop) {
            hop.t += dt / hop.dur; const t = Math.min(1, hop.t);
            a.pos.lerpVectors(hop.from, hop.to, t); a.pos.y += Math.sin(t * Math.PI) * hop.arc;
            a.yaw = Math.atan2(hop.to.x - hop.from.x, hop.to.z - hop.from.z); a.anim.pounce = 1; a.anim.sit = 0;
            if (t >= 1) { hop = null; a.hop = null; a.perch = route[wp]; a.anim.pounce = 0; }
            return;
          }
          a.perch = route[wp]; a.pos.copy(route[wp]); a.anim.sit += (1 - a.anim.sit) * Math.min(1, dt * 3); a.faceTowards(P.pos, dt * 3);
          const up = !!P.canopy.mode, d = P.pos.distanceTo(route[wp]);
          if (up && d < 10 && wp < route.length - 1) {
            wp++; S.raceAt = route[wp];
            const dist = route[wp].distanceTo(a.pos);
            hop = a.hop = { from: a.pos.clone(), to: route[wp].clone(), t: 0, dur: Math.max(0.8, dist / 8), arc: Math.min(4, 1.5 + dist * 0.15) };
            a.perch = null; W.audio.animal('langur', 'whoop', a.pos);
          }
          scold -= dt; if (!up && scold <= 0 && wasUp) { scold = 3.5; W.audio.animal('langur', 'alarm', a.pos); }
        };
        const t0 = g.clock;
        while (S.gen === gen) {
          await g.wait(0.25);
          const up = !!P.canopy.mode;
          if (wasUp && !up && P.onGround) { falls++; if (falls === 1) g.ui.toast('The langur scolds you from the branches. Back up!', 4); }
          wasUp = up;
          if (wp === route.length - 1 && !hop && up && P.pos.distanceTo(route[wp]) < 8) break;
          if (g.clock - t0 > 240) { g.ui.narrate(['They were faster. They were always faster.', 'But I was learning.']); break; }
        }
        if (S.gen !== gen) return;
        lead.scripted = null; lead.perch = route[wp]; S.raceAt = null;
        if (g.clock - t0 <= 240) g.ui.narrate(falls === 0 ? ['Six trees, and I never touched the ground once.', 'The young langur sat beside me and picked at my hair, as if I were one of them.'] : ['I fell, and climbed, and fell, and climbed.', 'At the last tree the young langur sat beside me and picked at my hair, as if I were one of them.']);
        S.flags.raced = true; S.checkNow();
      } },
    { text: 'Hunt with Kaali. Bring down a peafowl, chital or boar', hint: '<b>C</b> crouch · strike an unaware animal for a silent kill · <b>Q</b> → Dhole whistle sends Kaali', check: (g, S) => S.flags.hunted },
    { text: 'Skin the kill with your knife (<b>E</b> at the carcass)', check: (g, S) => S.flags.harvested || g.inv.has('meat_raw') },
    { text: () => `Make a fire — craft a Campfire (sticks ${S_.g.inv.count('stick')}/5, stones ${S_.g.inv.count('stone')}/3)`, check: (g) => g.camps.length > 0, hint: 'Gather more sticks and stones if you need them.' },
    { text: 'Cook the meat at the fire (<b>E</b>)', check: (g) => g.inv.has('meat_cooked') },
    { text: 'Share the meat with Kaali (<b>E</b> near her)', check: (g, S) => S.flags.satKaali,
      interact: { at: (g) => (g.companion && !g.companion.dead ? g.companion.pos : null), r: 4.5, prompt: 'Sit with Kaali and share the meat',   // she keeps ~3 m off
        act: (g, S) => {
          g.player.action = { type: 'eat', anim: 'eat', t: 0, dur: 3 }; g.player.crouch = true;
          const k = g.companion; if (k) { k.setState('rest', 40); k.lookAt = g.player.pos; }
          g.audio.hum();
          g.ui.narrate(['She took the first piece. The old wolf always ate first.', 'Then she put her grey muzzle on my knee.', 'Her teeth were worn almost to nothing. She had carried me in them, once.']);
          setTimeout(() => { S.flags.satKaali = true; S.checkNow(); }, 9000);
        } } },
    { text: 'Eat the cooked meat (<b>Tab</b> → Eat), then sleep by the fire', check: (g, S) => S.flags.slept, hint: 'Sleeping by a fire passes the night and saves your progress.' },
  ],
  outro: ['I scratched a mark on the den wall, as I did every night.', 'I did not know why. Neither did Kaali.'],
});

chapter({
  id: 'c2', title: 'The Wire', act: 'Act I · Winter', season: 'winter', weather: 'clear', hour: 7.1, spawn: ['den', 4, 5],
  setup(g, S) { S.ensureKaali(); S.troop = g.eco.spawnGroup('langur', sitePos('den', 25, -30), 6).members; g.eco.blocked.add('tiger'); },
  intro: ['Morning. Something was wrong with the silence.'],
  objectives: [
    { text: 'Listen.', async run(g, S, gen) {
      await g.wait(4); if (S.gen !== gen) return;
      for (const l of S.troop || []) { l.alarmCD = 0; l.alarm(g.W, 'tiger'); }
      await g.wait(2.5); if (S.gen !== gen) return;
      g.audio.animal('chital', 'alarm', sitePos('den', 80, 60)); g.ui.alarmMarker(SITES.den.x + 120, SITES.den.z - 20, 'Chital');
      await g.wait(2.5); if (S.gen !== gen) return;
      g.audio.animal('sambar', 'alarm', sitePos('den', 140, -10)); g.ui.alarmMarker(SITES.den.x + 140, SITES.den.z - 10, 'Sambar');
      g.ui.narrate(['The langurs coughed. The chital barked.', 'Then the sambar — and the sambar only calls for a real cat.']);
      await g.wait(6); if (S.gen !== gen) return;
      S.next();
    } },
    { text: 'Torn-Ear is coming. Stand with Kaali — or run.', async run(g, S, gen) {
      const t = S.spawnTornEar(sitePos('den', 120, -20), { aggro: 0 });
      const kaali = g.companion;
      let phase = 'approach';
      t.scripted = (dt, W, a) => {
        if (phase === 'approach') {
          const tp = kaali && !kaali.dead ? kaali.pos : g.player.pos; a.steer(tp.x, tp.z, a.d.trot * 0.9, dt, W);
          if (a.dist2(tp) < 26 * 26) { phase = 'fight'; g.audio.animal('tiger', 'roar', a.pos, { big: true }); a.scripted = null; a.target = kaali && !kaali.dead ? kaali : 'player'; a.aggro = 1; a.setState('charge'); g.music.setCombat(1); }
        }
      };
      S.tiger = t; S.kaaliDeadAt = null; S.tigerDmg = 0;
      const offHit = g.on('hit', (e) => { if (e.target === t) S.tigerDmg += e.dmg; });
      const t0 = g.clock;
      while (S.gen === gen) {
        await g.wait(0.25);
        if (kaali && kaali.dead && !S.kaaliDeadAt) { S.kaaliDeadAt = g.clock; t.target = 'player'; t.setState('charge'); g.slowmo(0.3, 1.8); g.audio.animal('wolf', 'pain', kaali.pos); g.ui.narrate('Kaali —'); }
        if (kaali && !kaali.dead && t.target === kaali && g.clock - t0 > 30) { kaali.hp = 1; }
        const ran = g.player.pos.distanceTo(t.pos) > 110;
        if (t.dead || S.tigerDmg > 70 || (S.kaaliDeadAt && g.clock - S.kaaliDeadAt > 40) || (S.kaaliDeadAt && ran)) break;
        if (g.player.dead) return;
      }
      offHit();
      if (S.gen !== gen) return;
      S.tigerFlee(t, sitePos('den', 600, -300));
      S.flags.wirePos = t.pos.clone();
      g.audio.animal('tiger', 'roar', t.pos, { big: true });
      S.addStoryItem('wire', S.flags.wirePos, 'Pick up the shining vine');
      g.music.setCombat(0);
      if (kaali && !kaali.dead) { kaali.hp = 0; kaali.die(g.W, {}); }
      S.next();
    } },
    { text: 'Find the shining vine where Torn-Ear stood', markerFn: (g, S) => S.flags.wirePos, check: (g) => g.inv.has('wire'), done: (g) => { g.ui.addJournal('A vine that shone', 'Torn-Ear had a loop of something bright cut deep into his foreleg, so deep the flesh had grown over it. It came away in the fight. It is thin and cold and does not rot. I had never seen anything shine except water, and the lota.', 'clue'); g.music.stinger('clue'); } },
    { text: () => `Gather leaves (${S_.g.inv.count('leaves')}/3) and cover Kaali`, markerFn: (g) => g.companionBody ? g.companionBody.pos : null, check: (g, S) => S.flags.coveredKaali, hint: 'Leaves lie on the forest floor and grow on lantana shrubs (<b>E</b>).' },
    { text: 'Sit with her a while', markerFn: (g) => (g.companionBody ? g.companionBody.pos : null), check: (g, S) => S.flags.mourned,
      interact: { at: (g) => (g.companionBody ? g.companionBody.pos : null), r: 3.4, prompt: 'Sit by Kaali',
        act: async (g, S) => {
          const gen = S.gen; g.player.crouch = true; g.player.action = { type: 'hum', anim: 'hum', t: 0, dur: 6 };
          g.ui.narrate(['I sat with her until the shadows went long.']); await g.wait(4); if (S.gen !== gen) return;
          g.audio.hum(); g.ui.narrate(['I hummed the four notes. I did not know where they came from. She always lay still for them.']); await g.wait(6); if (S.gen !== gen) return;
          g.ui.narrate(['Wolves do not cry.', 'I did.']);
          g.ui.addJournal('Kaali', 'She found me on a sandbank when I was three and carried me home by the cloth at my waist. She was the only mother I remember. I covered her with teak leaves where she fell, by the den.', 'story');
          await g.wait(5); if (S.gen !== gen) return; S.flags.mourned = true; S.checkNow();
        } } },
  ],
  outro: ['The forest went quiet the way it does after a kill.', 'That night the den was too big for one.'],
  cleanup(g) { g.eco.blocked.delete('tiger'); },
});

chapter({
  id: 'c3', title: 'Alone', act: 'Act I · Winter', season: 'winter', weather: 'clear', hour: 12.5, spawn: ['den', 6, 8],
  setup(g, S) {
    S.bear = g.eco.spawnOne('bear', sitePos('termite', 10, -5), { story: 'mahua', name: 'Mahua', persistent: true, homeR: 35 });
    S.bear.state = 'forage'; S.bear.timer = 30;
    g.eco.spawnGroup('boar', sitePos('termite', -60, 80), 4);
    g.ui.seeLore('termite');
  },
  intro: ['The den smelled of tiger. Under it, still, it smelled of her.', 'I carried the embers in a clay-lined bamboo tube and walked east, into country I did not know.'],
  objectives: [
    { text: 'Travel east to the termite flats', marker: 'termite', reach: ['termite', 70] },
    { text: 'A sloth bear. Approach crouched and unarmed, and hum (hold <b>Q</b> → Calm hum)', markerFn: (g, S) => S.bear && S.bear.pos, check: (g, S) => S.bear && (S.bear.bond >= 0.6 || S.bear.dead), hint: 'Bears see and hear poorly; surprise one and it attacks. Put your weapon away (<b>1</b>).',
      done: (g, S) => { if (S.bear.dead) g.ui.narrate(['I learned what claws do.', 'Later I learned what she could have taught me.']); else { g.ui.narrate(['She huffed and turned her back on me.', 'That is how a bear says yes.']); S.bear.bond = 1; } g.ui.seeLore('bear'); } },
    { text: 'Break open a termite mound (<b>E</b>) and eat the termites', check: (g, S) => S.flags.ateTermites },
    { text: 'Craft a torch, then smoke the rock-bee comb for honey', marker: 'hive', check: (g) => g.inv.has('honey'), hint: 'Hold the torch (<b>6</b>) under the hive and press <b>E</b>. Without smoke, the bees attack.', done: (g) => g.ui.seeLore('rockbee') },
  ],
  outro: ['That night Torn-Ear roared from the old den.', 'The langurs did not sleep. Neither did I.'],
  nextSeason: 'summer',
});

chapter({
  id: 'c4', title: 'The Burning Months', act: 'Act II · Summer', season: 'summer', weather: 'hazy', hour: 9.3, spawn: ['termite', -20, -60],
  setup(g, S) { g.eco.spawnGroup('chital', sitePos('mahua', 40, 30), 8); g.eco.spawnGroup('langur', sitePos('mahua', -20, 10), 6); g.eco.spawnOne('bear', sitePos('mahua', 35, -25), { homeR: 40 }); g.ui.seeLore('teak'); g.ui.seeLore('palash'); },
  intro: ['By May the teak was bare and the forest was the colour of a fire that had gone out.', 'Water shrank to mud. Everything walked toward the river.'],
  objectives: [
    { text: 'Follow the sweet smell of mahua flowers (north)', marker: 'mahua', reach: ['mahua', 22], done: (g) => g.ui.seeLore('mahua') },
    { text: 'Something has been here. Look closely under the tree', marker: 'mahua', check: (g, S) => S.flags.clue_leafBowl,
      done: (g) => { g.inv.add('bowl', 1); g.ui.narrate(['A bowl made of leaves, folded and pinned with a twig.', 'Something folds leaves on purpose. Bears do not fold.']); g.ui.addJournal('Swept ground, a leaf bowl', 'Under the big mahua the ground was swept clean and every flower was gone. Beside the trunk: leaves folded into a bowl, pinned with a twig.', 'clue'); g.music.stinger('clue'); } },
    { text: 'A chital fawn is caught in the lantana thorns. Free it (<b>E</b>)', markerFn: (g, S) => S.fawn && !S.fawn.dead ? S.fawn.pos : null, check: (g, S) => S.flags.fawn,
      onStart: (g, S) => {
        const p = sitePos('mahua', 26, 34); S.fawn = g.eco.spawnOne('chital', p, { persistent: true, scale: 0.5, male: false });
        S.fawnMum = g.eco.spawnOne('chital', sitePos('mahua', 48, 52), { persistent: true, male: false });
        S.fawn.scripted = (dt, W, a) => { a.targetSpeed = 0; a.yaw += Math.sin(a.t * 9) * dt * 2; };   // struggling, going nowhere
        S.fawnMum.scripted = (dt, W, a) => { a.targetSpeed = 0; a.faceTowards(S.fawn.pos, dt * 2); };
        g.audio.animal('chital', 'alarm', p);
      },
      interact: { at: (g, S) => (S.fawn && !S.fawn.dead && !S.flags.fawn ? S.fawn.pos : null), r: 2.4, prompt: 'Free the fawn from the thorns',
        act: (g, S) => {
          g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 2.4 }; g.player.hurt(3, null, { kind: 'thorns', silent: true });
          setTimeout(() => {
            const f = S.fawn, m = S.fawnMum;
            f.scripted = (dt, W, a) => { a.steer(m.pos.x, m.pos.z, a.d.run * 0.6, dt, W); if (a.dist2(m.pos) < 4) { a.scripted = null; m.scripted = null; a.threat = g.player.pos.clone(); a.setState('flee', 15); m.threat = g.player.pos.clone(); m.setState('flee', 15); } };
            g.ui.narrate(['The thorns had it by the leg. They had me by the hands, by the time it came free.', 'Its mother had waited at the edge of the trees the whole time. She did not run until it reached her.', 'Kaali used to wait like that.']);
            setTimeout(() => { S.flags.fawn = true; S.checkNow(); }, 9000);
          }, 2400);
        } } },
  ],
  outro: ['I sat with the bowl for a long time.'],
});

chapter({
  id: 'c5', title: 'Cut Wood', act: 'Act II · Summer', season: 'summer', weather: 'clear', hour: 14.5, spawn: ['mahua', -40, -30],
  setup(g, S) { g.eco.spawnGroup('gaur', sitePos('maidan', 60, 40), 5, { radius: 50 }); g.eco.spawnGroup('chital', sitePos('maidan', -40, -30), 12); g.eco.spawnGroup('sambar', sitePos('maidan', -120, 60), 3); g.ui.seeLore('gaur'); },
  intro: ['I followed the swept ground west, across the open meadow the forest guards call Alikatta, where the chital graze and the gaur bull watches everything.'],
  objectives: [
    { text: 'Cross Alikatta meadow to the far treeline', marker: 'stumps', reach: ['stumps', 35], hint: 'Gaur snort before they charge. Give the bull room.' },
    { text: 'Examine the stump', marker: 'stumps', check: (g, S) => S.flags.clue_stump, done: (g) => { g.ui.narrate(['Not torn by wind. Not burnt by lightning.', 'Struck again and again at one angle, by something like my knife, but far harder.']); g.ui.addJournal('Flat-cut stumps', 'Trees cut flat, the faces smooth, chips of wood lying around like scales. A harder claw than mine.', 'clue'); g.music.stinger('clue'); } },
    { text: 'Examine the burnt stones nearby', marker: 'hearth', check: (g, S) => S.flags.clue_hearth, done: (g) => { g.ui.narrate(['Three stones in a ring, ash, burnt bones, a cracked red pot.', 'I make fire. I thought I was the only one.', 'Someone.']); g.ui.addJournal('A cold hearth', 'Three stones set in a ring. Ash. Charred bones. Pieces of a red clay pot. Someone else makes fire.', 'clue'); } },
    { text: 'Climb a tall tree and look out over the forest', hint: '<b>Space</b> facing a trunk, <b>W</b> to climb. Higher than the teak.',
      check: (g, S) => S.flags.saw,
      tick: (g, S) => { const P = g.player; if (!S.flags.saw && P.canopy.mode && P.pos.y - groundHeight(P.pos.x, P.pos.z) > 11) { S.flags.saw = true; g.ui.narrate(['From the top I saw it: a thread of smoke, far to the north, where the forest ended.', 'Someone was there.', 'I was afraid of it. And I wanted to go.']); setTimeout(() => S.checkNow(), 10000); } } },
  ],
  outro: ['I slept by the cold hearth that night.'],
});

chapter({
  id: 'c6', title: 'The Shadow on the Rocks', act: 'Act II · Summer', season: 'summer', weather: 'clear', hour: 16.8, spawn: ['stumps', -30, 10],
  setup(g, S) { g.eco.blocked.add('leopard'); g.eco.spawnGroup('langur', sitePos('rocks', 40, 40), 6); g.ui.seeLore('kulu'); },
  intro: ['The cut stumps led west, to rocks where the ghost trees grow.', 'Leopard country.'],
  objectives: [
    { text: 'Go west to the Piyorthadi rocks', marker: 'rocks', reach: ['rocks', 140] },
    { text: 'Find shelter among the rocks', marker: 'cave', check: (g, S) => S.flags.clue_cave,
      done: (g) => { g.inv.locks.delete('bow'); g.ui.narrate(['Red figures on the rock. Deer, a bison, a tiger.', 'And thin two-legged figures drawing bows. They stand like me. They hunt like me.']); g.ui.addJournal('The ochre hunters', 'In a rock shelter, paintings in red ochre: animals I know, and among them people — two legs, like me — holding something that throws a stick. The painting taught me the bow.', 'clue'); g.ui.toast('New recipes: Bow, Arrows'); g.music.stinger('clue'); } },
    { text: 'Craft a bow (<b>Tab</b>) — and arrows if you have feathers', check: (g) => g.inv.has('bow'), hint: 'Sinew from a kill, or 3 fibre. Bamboo from clumps (<b>E</b> with a knife).' },
    { text: 'The Shadow is hunting you. Survive.', async run(g, S, gen) {
      if (g.time.hour < 18.3) g.setTime(18.6);
      const p = g.player.pos;
      const lp = V3(p.x + 35, 0, p.z - 25); lp.y = groundHeight(lp.x, lp.z);
      const L = g.eco.spawnOne('leopard', lp, { story: 'shadow', name: 'The Shadow', persistent: true, aggro: 1, hpMul: 1.2 });
      L.target = 'player'; L.setState('stalk'); L.awareness = 1;
      g.audio.animal('leopard', 'saw', L.pos);
      g.ui.seeLore('leopard');
      for (const a of g.eco.animals) if (a.sp === 'langur' && a.dist2(L.pos) < 100 * 100) { a.alarmCD = 0; a.alarm(g.W, 'leopard'); }
      while (S.gen === gen) {
        await g.wait(0.25);
        if (g.player.dead) return;
        if (L.dead) break;
        if (L.hp < L.maxHp * 0.35) { L.threat = g.player.pos.clone(); L.setState('retreat', 30); L.aggro = 0; break; }
        if (L.state === 'idle' || L.state === 'wander') { L.target = 'player'; L.setState('stalk'); }
        g.music.setCombat(L.state === 'attack' || L.state === 'charge' || L.state === 'pounce' ? 1 : 0.3);
      }
      g.music.setCombat(0);
      if (S.gen !== gen) return;
      g.ui.narrate(L.dead ? ['She did not get up.'] : ['She melted back into the rocks.', 'I did not see her again that summer.']);
      setTimeout(() => { if (!L.dead) g.eco.remove(L); }, 30000);
      S.next();
    } },
    { text: 'Press your hand to the wall beside the hunters (<b>E</b>)', marker: 'cave', check: (g, S) => S.flags.hand,
      interact: { at: () => SITES.cave, r: 6, prompt: 'Press your hand to the rock', act: (g, S) => sitBeat(g, S, 'hand', ['My hand was the same shape as theirs.', 'Five fingers, a thumb that turns. Kaali\'s paw was nothing like it. I had always known that. I had never let myself look.'], { anim: 'gather' }) } },
  ],
  outro: ['I drew my own figure on the cave wall in charcoal, beside the ochre hunters.', 'Then the wind turned, and smelled of wet dust.'],
  nextSeason: 'monsoon',
  cleanup(g) { g.eco.blocked.delete('leopard'); },
});

chapter({
  id: 'c7', title: 'First Rain', act: 'Act III · Monsoon', season: 'monsoon', weather: 'storm', hour: 15.2, spawn: ['rocks', 260, 280],
  setup(g, S) { g.eco.blocked.add('dhole'); g.ui.seeLore('hawkcuckoo'); S.rainT = 0; S.rainAt = 0; },
  intro: ['The first storm broke the heat in a single afternoon.'],
  objectives: [
    { text: 'Stand still in the rain and look up', hint: 'Stop moving and look up at the sky.',
      tick: (g, S, dt) => { const P = g.player; if (P.speed < 0.4 && P.pitch > 0.45) S.rainT = (S.rainT || 0) + dt; if (S.rainT > 4 && !S.flags.rain) { S.flags.rain = true; g.ui.narrate(['I stood in it with my mouth open.', 'It ran into my eyes and down my back and I laughed, the only time I ever danced.', 'Somewhere Kaali would have shaken herself and looked at me as if I were mad.']); setTimeout(() => S.checkNow(), 9000); } },
      check: (g, S) => S.flags.rain && g.clock - (S.rainAt || (S.rainAt = g.clock)) > 8 },
    { text: 'Something is whistling in the bamboo…', async run(g, S, gen) {
      await g.wait(7); if (S.gen !== gen) return;
      const p = g.player.pos;
      const c = V3(p.x - 60, 0, p.z + 40); c.y = groundHeight(c.x, c.z);
      const pack = g.eco.spawnGroup('dhole', c, 7, { aggro: 1, persistent: true });
      S.pack = pack.members; S.pack[0].name = 'Lal'; S.pack[0].scale *= 1.12; S.pack[0].root.scale.setScalar(S.pack[0].scale); S.pack[0].hp *= 1.6; S.pack[0].maxHp = S.pack[0].hp;
      g.audio.animal('dhole', 'whistle', c); g.ui.seeLore('dhole');
      await g.wait(3); if (S.gen !== gen) return;
      pack.group.engage('player', g.W);
      S.next();
    } },
    { text: () => `Survive the Red Whistlers (${S_.pack ? S_.pack.filter((d) => d.dead).length : 0} down)`, hint: 'Back against a tree or rock. Club and spear hit hardest; a torch keeps them off.', async run(g, S, gen) {
      g.music.setCombat(1);
      while (S.gen === gen) {
        await g.wait(0.3); if (g.player.dead) return;
        const alive = S.pack.filter((d) => !d.dead);
        const lalHurt = S.pack[0].dead || S.pack[0].hp < S.pack[0].maxHp * 0.5;
        if (alive.length <= 3 || (lalHurt && alive.length <= 5)) break;
        for (const d of alive) if (d.state === 'idle' || d.state === 'wander') { d.target = 'player'; d.setState('charge'); }
        g.ui.setObjective(S.chapter.title, S.objText());
      }
      if (S.gen !== gen) return;
      for (const d of S.pack) if (!d.dead) { d.aggro = 0; d.target = null; d.threat = g.player.pos.clone(); d.setState('retreat', 25); }
      g.music.setCombat(0);
      setTimeout(() => { for (const d of S.pack || []) if (!d.dead) g.eco.remove(d); }, 25000);
      S.next();
    } },
  ],
  outro: ['Lal, their leader, took a cut across the face.', 'The pack melted into the rain.'],
  cleanup(g) { g.eco.blocked.delete('dhole'); },
});

chapter({
  id: 'c8', title: 'Chingari', act: 'Act III · Monsoon', season: 'monsoon', weather: 'rain', hour: 9.5, spawn: ['dholeDen', 90, -60],
  intro: ['It rained for days. Streams became rivers.', 'Then, under the roar of water, a sound like a small animal crying.'],
  objectives: [
    { text: 'Follow the whimpering', marker: 'dholeDen', reach: ['dholeDen', 18], async run(g, S, gen) { while (S.gen === gen && S.objIndex === 0) { g.audio.animal('dhole', 'pain', sitePos('dholeDen')); await g.wait(2.5 + Math.random() * 2); } } },
    { text: 'Dig the pup out of the flooding burrow (<b>E</b>)', marker: 'dholeDen', check: (g, S) => S.flags.rescued,
      done: (g, S) => {
        const pup = g.eco.spawnOne('dhole', sitePos('dholeDen', 1, 1.5), { companion: true, persistent: true, name: 'Chingari', scale: 0.78, bond: 1, hpMul: 2.2 });
        g.setCompanion(pup); g.flags.chingari = true;
        const pack = g.eco.spawnGroup('dhole', sitePos('dholeDen', 30, 25), 4, { aggro: 0, persistent: false }).members;
        for (const d of pack) { d.bond = 0.7; d.lookAt = g.player.pos; d.setState('idle', 8); }
        setTimeout(() => { for (const d of pack) if (!d.dead) { d.threat = g.player.pos.clone(); d.setState('flee', 20); } }, 9000);
        g.ui.narrate(['I carried her out by the scruff, the way Kaali once carried me.', 'Lal could have killed me on that bank. She didn\'t.']);
        g.ui.addJournal('Chingari', 'A dhole pup from a flooded den. A flood child saved by a flood child. She will not leave me. (Q → Dhole whistle: send her at what you look at, or call her back.)', 'story');
      } },
    { text: 'Sit with the pup until she stops shaking (<b>E</b> near her)', check: (g, S) => S.flags.calmPup,
      interact: { at: (g) => (g.companion && !g.companion.dead ? g.companion.pos : null), r: 4.5, prompt: 'Hold the pup',
        act: (g, S) => { const k = g.companion; if (k) k.setState('rest', 40); sitBeat(g, S, 'calmPup', ['She shook for a long time. Then she slept, her nose under my arm.', 'I called her Chingari. A spark. There was fire in her, even then.', 'I had been carried out of the water once. Now I had carried someone.'], { hum: true }); } } },
  ],
  outro: ['From then on I was never alone in the forest again.'],
});

chapter({
  id: 'c9', title: 'The Old Flood', act: 'Act III · Monsoon', season: 'monsoon', weather: 'cloudy', hour: 15.6, spawn: ['dholeDen', 160, 120],
  setup(g, S) { S.ensureChingari(); S.troop = g.eco.spawnGroup('langur', sitePos('sandbar', 25, 15), 6).members; g.eco.blocked.add('tiger'); },
  intro: ['The river was huge, brown, loud.', 'The langurs led me to a fig tree above a sandbar, as if they knew the place.'],
  objectives: [
    { text: 'Follow the langurs to the old sandbar', marker: 'sandbar', reach: ['sandbar', 28] },
    { text: 'Something iron is showing in the sand. Dig it out', marker: 'sandbar', check: (g, S) => S.flags.clue_cartwheel,
      done: (g) => { g.ui.narrate(['An iron hoop as tall as me, wooden spokes rotted to stubs.', 'A curved blade. A small brass ring.', 'The same kind of thing as the lota. And the lota came from water.']); g.ui.addJournal('The old sandbar', 'Under the sand: a rusted iron hoop with rotted spokes, a curved blade, a brass ring. I did not know what any of it was. I knew it was the same kind of thing as the lota.', 'clue'); g.music.stinger('clue'); } },
    { text: 'Sit by the river where the sand gave it up (<b>E</b>)', marker: 'sandbar', check: (g, S) => S.flags.river,
      interact: { at: () => SITES.sandbar, r: 9, prompt: 'Sit by the river',
        act: (g, S) => sitBeat(g, S, 'river', ['The river was loud and brown, the way it must have been that night.', 'I do not remember the water. I remember being carried.', 'I hummed the four notes to it. It did not answer.'], { hum: true, journal: ['Where the river took them', 'The cart wheel lay where the river dropped it. Somewhere in that water were the people who owned the lota. I think they were mine.'] }) } },
    { text: 'Night. Torn-Ear has come for the pups. Drive him off.', async run(g, S, gen) {
      await g.ui.fade(true, 900); g.setTime(20.3); await g.ui.fade(false, 1200); if (S.gen !== gen) return;
      const p = g.player.pos; const tp = V3(p.x + 55, 0, p.z - 40); tp.y = groundHeight(tp.x, tp.z);
      const t = S.spawnTornEar(tp, { aggro: 1 });
      t.target = 'player'; t.setState('stalk'); t.awareness = 1;
      g.audio.animal('tiger', 'roar', t.pos, { big: true });
      for (const l of S.troop || []) { l.alarmCD = 0; l.alarm(g.W, 'tiger'); }
      while (S.gen === gen) {
        await g.wait(0.25); if (g.player.dead) return;
        g.music.setCombat(t.state === 'attack' || t.state === 'charge' || t.state === 'pounce' ? 1 : 0.4);
        if (t.hp < t.maxHp * 0.55 || t.dead) break;
        if (t.state === 'idle' || t.state === 'wander' || (t.state === 'retreat' && t.timer < 1)) { t.target = 'player'; t.setState('charge'); }
      }
      if (S.gen !== gen) return;
      g.music.setCombat(0);
      if (!t.dead) S.tigerFlee(t, V3(VILLAGE.x, 0, VILLAGE.z + 500));
      g.ui.narrate('He broke away north, toward the edge of the forest, where cattle graze.');
      S.next();
    } },
  ],
  outro: [],
  nextSeason: 'post',
  cleanup(g) { g.eco.blocked.delete('tiger'); },
});

chapter({
  id: 'c10', title: 'The Tower', act: 'Act IV · After the Rains', season: 'post', weather: 'mist', hour: 6.6, spawn: ['shrine', 120, 240],
  setup(g, S) { S.ensureChingari(); g.ui.seeLore('banyan'); },
  intro: ['After the rains the grass stood over my head and mist poured down the valleys every dawn.', 'Torn-Ear\'s pugmarks went north-west.'],
  objectives: [
    { text: 'Follow the pugmarks north-west', marker: 'shrine', reach: ['shrine', 20] },
    { text: 'Look at the red stone under the saja', marker: 'shrine', check: (g, S) => S.flags.clue_shrine, done: (g) => { g.ui.narrate(['A stone painted red. An iron fork. Bangles hung on a branch, strips of red cloth tied round the trunk.', 'Someone came here to leave things, not to take them.']); g.ui.addJournal('Gifts under the saja', 'A red stone, an iron trident, little clay horses, bangles, red cloth. Gifts left, not taken.', 'clue'); } },
    { text: 'A tall wooden thing stands above the trees. Reach it', marker: 'tower', reach: ['tower', 9] },
    { text: 'Climb the ladder (<b>E</b>, then <b>W</b>)', marker: 'tower', check: (g, S) => S.flags.climbed || g.player.pos.y > SITES.tower.y + 6 },
    { text: 'Pick up the rattling box', check: (g, S) => S.flags.clue_towerItems,
      done: (g) => { g.inv.add('matches', 1); g.ui.narrate(['I shook it. It rattled. I scraped a stick on its side and it burst into flame in my hand.', 'I dropped it. I did it again.', 'I laughed. I had never made that sound before.']); g.ui.addJournal('Fire in a box', 'On the tower: a cloth cap, a bottle you can see through, and a small box of sticks that make fire when scraped. Campfires no longer need the fire-saw.', 'clue'); g.music.stinger('clue'); } },
    { text: 'Look north from the tower', check: (g, S) => S.lookedNorth, tick: (g, S, dt) => {
      const P = g.player; if (P.pos.y < SITES.tower.y + 6) { S.lookT = 0; return; }
      const ang = Math.atan2(VILLAGE.x - P.pos.x, -(VILLAGE.z - P.pos.z)), head = -P.yaw;
      let d = ang - head; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < 0.45) S.lookT = (S.lookT || 0) + dt; else S.lookT = 0;
      if (S.lookT > 1.5 && !S.lookedNorth) { S.lookedNorth = true; }
    }, done: (g) => { g.ui.narrate(['Smoke, rising straight up into the still air.', 'And beyond the trees, small square shapes with red roofs.', 'A place.']); g.ui.addJournal('A place', 'From the tower top: a line of smoke, and beyond the trees, square shapes with red roofs.', 'clue'); g.music.stinger('clue'); } },
  ],
  outro: [],
});

chapter({
  id: 'c11', title: 'The Flute', act: 'Act IV · After the Rains', season: 'post', weather: 'clear', hour: 18.2, spawn: ['tower', -6, 8],
  setup(g, S) { S.ensureChingari(); S.spawnVillage(); },
  intro: ['In the summer I had cut a whistle from bamboo.', 'For months I had been blowing the four notes into it. The four notes I hummed without knowing why.'],
  objectives: [
    { text: 'Craft a bamboo flute (<b>Tab</b>)', check: (g) => g.inv.has('flute'), hint: '1 bamboo and a knife.' },
    { text: 'Go down to the riverbank below the tower', marker: 'fluteSpot', reach: ['fluteSpot', 10] },
    { text: 'Listen.', async run(g, S, gen) {
      if (g.time.hour < 19.5) { await g.ui.fade(true, 900); g.setTime(20.2); await g.ui.fade(false, 1400); }
      if (S.gen !== gen) return;
      await g.wait(4); if (S.gen !== gen) return;
      S.farFlute([0, 2, 4, 7, 4, 2, 0].map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 2.5 : 0.7, meend: i % 2 === 1 })));
      g.ui.narrate(['Across the black water, a sound that was not a bird and not an animal.', 'A long rising breath that bent from note to note.']);
      await g.wait(9); if (S.gen !== gen) return;
      S.next();
    } },
    { text: 'Answer it. (Hold <b>Q</b> → Four notes)', check: (g, S) => S.flags.answered, async run(g, S, gen) {
      const off = g.on('call', (e) => { if (e.kind === 'flute' && g.player.pos.distanceTo(sitePos('fluteSpot')) < 40) { S.flags.played = true; } });
      while (S.gen === gen && !S.flags.played) await g.wait(0.3);
      off(); if (S.gen !== gen) return;
      await g.wait(6); if (S.gen !== gen) return;
      g.ui.narrate('The flute across the river stopped.');
      await g.wait(3); if (S.gen !== gen) return;
      S.farFlute(THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 1.6 : 0.6 })).concat([0, 2, 4, 7, 9, 7, 4, 2, 0].map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 3.5 : 0.55, meend: i % 3 === 1 }))));
      await g.wait(3); g.ui.narrate(['Then it played my four notes back. Correctly.', 'And kept going, into the rest of a song I did not know I knew.']);
      await g.wait(9);
      g.ui.narrate('I did not know it was a song. I thought it was a sound that belonged to me. It belonged to them too.');
      S.flags.answered = true;
    } },
  ],
  outro: [],
});

chapter({
  id: 'c12', title: 'Torn-Ear', act: 'Act IV · After the Rains', season: 'post', weather: 'clear', hour: 6.4, spawn: ['sukhiSpot', 30, 40],
  setup(g, S) {
    S.ensureChingari(); S.spawnVillage();
    const f = sitePos('fields');
    S.sukhi = S.npc({ name: 'Sukhi', pos: f.clone().add(V3(10, 0, 0)), scale: 0.8, build: 'child', cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothKhaki, flute: true, skinKey: 'sukhi' });
    S.cows = g.eco.spawnGroup('cow', f, 6, { persistent: true, radius: 25 }).members;
    g.eco.blocked.add('tiger');
  },
  intro: ['At first light I crossed the river and watched from the treeline.', 'A boy. Thin, small, two-legged. Real.'],
  objectives: [
    { text: 'Watch the herd boy from the treeline', marker: 'fields', reach: ['fields', 95] },
    { text: 'Protect the boy. Kill Torn-Ear.', async run(g, S, gen) {
      await g.wait(5); if (S.gen !== gen) return;
      for (const a of g.eco.animals) if (a.sp === 'langur' || a.sp === 'peafowl') { a.alarmCD = 0; a.alarm(g.W, 'tiger'); }
      g.audio.animal('cow', 'alarm', S.sukhi.pos);
      const sp = S.sukhi.pos.clone().add(V3(-70, 0, 50)); sp.y = groundHeight(sp.x, sp.z);
      const t = S.spawnTornEar(sp, { aggro: 1, hpMul: 1.3 }); t.noRetreat = true;
      g.audio.animal('tiger', 'roar', t.pos, { big: true });
      t.target = S.cows[0] || 'player'; t.setState('charge');
      // Sukhi runs to a tree and climbs
      const near = g.veg.nearestTree(S.sukhi.pos.x, S.sukhi.pos.z, 70);
      const tree = near ? V3(near.x + 0.6, 0, near.z + 0.6) : V3(VILLAGE.x - 40, 0, VILLAGE.z + 60);
      S.sukhi.walkTo(tree, true);
      const climbWhenThere = () => { if (!S.sukhi) return; if (S.sukhi.path.length) return setTimeout(climbWhenThere, 400); if (near) S.sukhi.up = 2.4; S.sukhi.look = t.pos; };
      setTimeout(climbWhenThere, 1500);
      t.downed = false;
      let downedOnce = false;
      while (S.gen === gen) {
        await g.wait(0.25); if (g.player.dead) return;
        g.music.setCombat(1);
        if (t.target !== 'player' && (t.target?.dead || g.player.pos.distanceTo(t.pos) < 30)) { t.target = 'player'; t.setState('charge'); }
        if (t.state === 'idle' || t.state === 'wander' || (t.state === 'retreat' && t.timer < 2)) { t.target = 'player'; t.setState('charge'); }
        if (!downedOnce && t.hp < t.maxHp * 0.12) {
          downedOnce = true; t.hp = 30; t.bleed = 0; t.downed = true;
          t.scripted = (dt, W, a) => { a.targetSpeed = 0; a.anim.lie = Math.min(1, a.anim.lie + dt); };
          g.music.setCombat(0);
          break;
        }
        if (t.dead) break;
      }
      if (S.gen !== gen) return;
      if (!t.dead) {
        g.ui.narrate('He lay in the grass, breathing like a bellows. The bright loop still in his leg.');
        await g.wait(3);
        const c = await g.ui.choice('Torn-Ear', 'Finish him with the knife', 'Kneel and pull the wire from his leg');
        if (c === 'a') { g.player.finishTarget(t); await g.wait(2.5); g.ui.narrate(['I did what the forest does.']); }
        else { g.ui.narrate(['I pulled the wire out of him. He did not fight me.', 'He was too old, and too tired, and it had hurt him for a long time.']); await g.wait(4); t.scripted = null; t.downed = false; t.hp = 0; t.die(g.W, {}); }
      }
      g.inv.add('wire', 0);
      g.ui.addJournal('The first clue and the last', 'The wire in Torn-Ear\'s leg. The first sign I ever found, and the last. Both made by people.', 'clue');
      g.music.setCombat(0);
      S.next();
    } },
  ],
  outro: ['Before I went to the village I walked back to the den, one last time.', 'Grass had grown up through the teak leaves where Kaali lay.', 'I told her about the boy with the flute. I think she would have liked him.'],
  cleanup(g) { g.eco.blocked.delete('tiger'); },
});

chapter({
  id: 'ep', title: 'The Name in the Steel', act: 'Epilogue', season: 'post', weather: 'clear', hour: 17.6, spawn: ['fields', -40, 30],
  setup(g, S) {
    S.ensureChingari(); S.spawnVillage();
    if (!S.sukhi) { const f = sitePos('fields'); S.sukhi = S.npc({ name: 'Sukhi', pos: f.clone().add(V3(-25, 0, 15)), scale: 0.8, build: 'child', cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothKhaki, flute: true, skinKey: 'sukhi' }); }
    S.sukhi.up = 0; g.inv.add('lota', g.inv.has('lota') ? 0 : 1);
  },
  intro: ['The boy did not run.'],
  objectives: [
    { text: 'Go to the boy', markerFn: (g, S) => S.sukhi.pos, check: (g, S) => g.player.pos.distanceTo(S.sukhi.pos) < 4,
      done: (g, S) => { S.sukhi.look = g.player.pos; S.sukhi.action = 'flute'; S.farFlute(THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 1.8 : 0.6 })), S.sukhi.pos); setTimeout(() => { g.audio.hum(); g.ui.narrate(['He held out his flute the way I held out fruit to the langurs.', 'He played the four notes. I hummed them back.', '"Vanaj," he said. Forest-born. He laughed.']); }, 5000); setTimeout(() => { S.sukhi.action = null; }, 6000); } },
    { text: 'Follow Sukhi to the village', markerFn: (g, S) => S.sukhi.pos, reach: ['village', 30], onStart: (g, S) => { S.sukhi.walkTo(V3(VILLAGE.x + 4, 0, VILLAGE.z + 10)); } },
    { text: 'Set the lota on the ground (<b>E</b>)', markerFn: (g, S) => S.aaji && S.aaji.pos, check: (g, S) => S.flags.placedLota },
  ],
  outro: [],
  async ending(g, S) {
    g.uiBlocking = true;
    await g.wait(1.5);
    g.ui.narrate(['An old woman picked it up and turned it to the lamp.', 'Scratched into the rim, the way families here have always marked their steel, was a name.']);
    await g.wait(9);
    g.ui.card('सुमित्रा', 'Sumitra', 6);
    g.ui.narrate(['Her daughter.']);
    await g.wait(6);
    g.music.stinger('ending');
    g.ui.narrate(['She looked at me for a long time. Then she hummed four notes — the lullaby every mother in that village hums.', 'I hummed the rest.']);
    await g.wait(13);
    g.ui.card('"Mangalu"', 'It was the first time I heard my name.', 7);
    await g.wait(9);
    await g.ui.fade(true, 2500);
    const E = document.getElementById('ending'); E.classList.add('show');
    await g.wait(26);
    E.classList.remove('show');
    await g.ui.fade(false, 2000);
    g.uiBlocking = false; g.requestLock();
    g.ui.setObjective('Free roam', 'The forest and the village are yours. Both sounds at once.');
    S.done = true; g.save();
  },
});

let S_ = null; // story singleton for objective text closures

export class Story {
  constructor(g) {
    this.g = g; S_ = this; this.CH = CH;
    this.chIndex = -1; this.objIndex = 0; this.flags = {}; this.gen = 0; this.marker = null; this.npcs = []; this.storyItems = []; this.done = false;
    g.on('drink', () => (this.flags.drank = true));
    g.on('kill', (e) => { if (['peafowl', 'chital', 'boar', 'sambar'].includes(e.animal.sp)) this.flags.hunted = true; });
    g.on('harvest', () => (this.flags.harvested = true));
    g.on('sleep', () => (this.flags.slept = true));
    g.on('climbed', () => (this.flags.climbed = true));
    g.on('swung', () => (this.flags.swung = true));
    g.on('eat', (e) => { if (e.item === 'termites') this.flags.ateTermites = true; });
    g.on('clue', (e) => { this.flags['clue_' + e.id] = true; });
    g.on('*', () => this.checkNow());
  }
  // leave the current chapter (back to the title): its scripts stop, its people, items and companion go
  stop() {
    const g = this.g;
    if (this.chapter && this.chapter.cleanup) this.chapter.cleanup(g);
    this.gen++; this.chIndex = -1; this.objIndex = 0; this.flags = {}; this.marker = null; this.done = false;
    g.ui.clearNarration();
    for (const n of this.npcs) n.remove(); this.npcs = []; g.npcs = [];
    for (const it of this.storyItems) g.scene.remove(it.mesh); this.storyItems = [];
    if (g.companion) { g.eco.remove(g.companion); g.companion = null; }
  }
  get chapter() { return CH[this.chIndex]; }
  get obj() { return this.chapter && this.chapter.objectives[this.objIndex]; }
  objText() { const o = this.obj; if (!o) return ''; return typeof o.text === 'function' ? o.text() : o.text; }
  async start(i, opts = {}) {
    const g = this.g;
    if (this.chapter && this.chapter.cleanup) this.chapter.cleanup(g);
    this.gen++; const gen = this.gen;
    this.chIndex = i; this.objIndex = 0; this.flags = {}; this.lookedNorth = false; this.lookT = 0;
    g.ui.clearNarration();
    const c = this.chapter;
    if (!opts.keepState) {
      g.setSeason(c.season, c.weather);
      g.setTime(c.hour);
      const sp = sitePos(c.spawn[0], c.spawn[1], c.spawn[2]);
      g.teleport(sp, c.spawnYaw || 0);
    }
    if (c.setup) c.setup(g, this);
    g.save();
    g.ui.card(c.title, c.act, 5.5);
    g.music.stinger('chapter');
    await g.wait(2.5); if (this.gen !== gen) return;
    g.ui.narrate(c.intro || []);
    this.beginObjective();
  }
  beginObjective() {
    const g = this.g, o = this.obj, gen = this.gen;
    if (!o) return this.finishChapter();
    g.ui.setObjective(this.chapter.title, this.objText());
    if (o.hint) setTimeout(() => { if (this.obj === o) g.ui.toast(o.hint, 7); }, 1500);
    if (o.onStart) o.onStart(g, this);
    if (o.run) o.run(g, this, gen);
  }
  next() {
    const g = this.g, o = this.obj;
    if (!o) return;
    if (o.done) { try { o.done(g, this); } catch (e) { console.warn(e); } }   // a beat that fails must not wedge the chapter
    this.objIndex++;
    g.audio.ui('tick');
    setTimeout(() => this.beginObjective(), 600);
  }
  async finishChapter() {
    const g = this.g, c = this.chapter, gen = this.gen;
    if (c.ending) { c.ending(g, this); return; }
    g.ui.setObjective(c.title, '');
    g.ui.narrate(c.outro || []);
    await g.wait(Math.max(4, (c.outro || []).length * 4.5)); if (this.gen !== gen) return;
    const nextI = this.chIndex + 1;
    if (nextI >= CH.length) return;
    if (c.nextSeason) {
      await g.ui.fade(true, 1500); if (this.gen !== gen) return;
      g.ui.card('Months pass', { summer: 'The burning months', monsoon: 'The rains', post: 'After the rains' }[c.nextSeason], 4);
      await g.wait(1.5);
      this.start(nextI);
      await g.wait(1); g.ui.fade(false, 2000);
    } else this.start(nextI, { keepState: false });
  }
  checkNow() {
    const o = this.obj; if (!o || !o.check) return;
    if (o._doneOnce) return;
    try { if (o.check(this.g, this)) { o._doneOnce = true; this.next(); setTimeout(() => (o._doneOnce = false), 1500); } } catch (e) { console.warn(e); }
  }
  update(dt) {
    const g = this.g, o = this.obj;
    for (const n of this.npcs) n.update(dt);
    // compass / map marker
    this.marker = null;
    if (o) {
      if (o.markerFn) { const p = o.markerFn(g, this); if (p) this.marker = { x: p.x, z: p.z }; }
      else if (o.marker) this.marker = { x: SITES[o.marker].x, z: SITES[o.marker].z };
      else if (o.reach) this.marker = { x: SITES[o.reach[0]].x, z: SITES[o.reach[0]].z };
      if (o.tick) o.tick(g, this, dt);
      if (o.reach) { const s = SITES[o.reach[0]]; if ((g.player.pos.x - s.x) ** 2 + (g.player.pos.z - s.z) ** 2 < o.reach[1] ** 2 && !o._doneOnce) { o._doneOnce = true; this.next(); setTimeout(() => (o._doneOnce = false), 1500); } }
      this.chkT = (this.chkT || 0) - dt;
      if (this.chkT <= 0) { this.chkT = 0.25; this.checkNow(); if (typeof o.text === 'function') g.ui.obj.innerHTML = this.objText(); }
    }
    // soft boundary: the village before Act IV
    if (this.chIndex >= 0 && this.chIndex < 9 && !this.done) {
      const d = Math.hypot(g.player.pos.x - VILLAGE.x, g.player.pos.z - VILLAGE.z);
      if (d < 330) {
        const k = (330 - d) / 330; g.player.vel.x += (g.player.pos.x - VILLAGE.x) / d * k * 30 * dt; g.player.vel.z += (g.player.pos.z - VILLAGE.z) / d * k * 30 * dt;
        if (!this._warned || performance.now() - this._warned > 20000) { this._warned = performance.now(); g.ui.narrate('The north smelled of smoke and dogs. Something in me would not go further. Not yet.'); }
      }
    }
  }
  // ------------------------------------------------------------------ helpers used by chapters
  ensureKaali() {
    const g = this.g;
    if (g.companion && !g.companion.dead && g.companion.name === 'Kaali') return;
    const p = g.player.pos.clone().add(V3(2, 0, 2));
    const k = g.eco.spawnOne('wolf', p, { companion: true, persistent: true, name: 'Kaali', bond: 1, hpMul: 0.45, scale: 1.0 });
    g.setCompanion(k);
  }
  ensureChingari() {
    const g = this.g;
    if (g.companion && !g.companion.dead && g.companion.name === 'Chingari') return;
    if (!g.flags.chingari) return;
    const pup = g.eco.spawnOne('dhole', g.player.pos.clone().add(V3(2, 0, 2)), { companion: true, persistent: true, name: 'Chingari', scale: 0.9, bond: 1, hpMul: 2.4 });
    g.setCompanion(pup);
  }
  spawnTornEar(pos, o = {}) {
    const g = this.g;
    for (const a of g.eco.animals) if (a.story === 'tornear') g.eco.remove(a);
    const t = g.eco.spawnOne('tiger', pos, { story: 'tornear', name: 'Torn-Ear', persistent: true, aggro: o.aggro ?? 1, hpMul: o.hpMul || 1, scale: 1.12, male: true });
    if (t.J.earL) { t.J.earL.scale.set(0.55, 0.7, 1); t.J.earL.rotation.z = 0.9; }
    if (t.J.kneeRF) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 4, 16), new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 1, roughness: 0.2 })); ring.rotation.x = Math.PI / 2; ring.position.y = -0.1; t.J.kneeRF.add(ring); if (PAINTED) toonify(ring, { outline: 0 }); }
    t.limp = 0.35;
    g.ui.seeLore('tiger');
    return t;
  }
  tigerFlee(t, to) {
    const g = this.g;
    t.aggro = 0; t.target = null;
    t.scripted = (dt, W, a) => { a.steer(to.x, to.z, a.d.run * 0.8, dt, W); if (a.dist2(g.player.pos) > 250 * 250) { a.scripted = null; g.eco.remove(a); } };
  }
  addStoryItem(id, pos, prompt) {
    const g = this.g;
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.008, 4, 20), new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 1, roughness: 0.15, emissive: 0x303438 }));
    m.position.copy(pos); m.position.y = groundHeight(pos.x, pos.z) + 0.03; m.rotation.x = -Math.PI / 2; g.scene.add(m);
    if (PAINTED) toonify(m, { outline: 0, rim: 1 });
    const it = { id, pos: m.position.clone(), mesh: m, prompt };
    this.storyItems.push(it);
    return it;
  }
  npc(o) { const n = new NPC(this.g, o); this.npcs.push(n); this.g.npcs = this.npcs; return n; }
  spawnVillage() {
    const g = this.g;
    if (this.villageSpawned) return; this.villageSpawned = true;
    const V = VILLAGE;
    const houses = g.props.houses || [];
    this.aaji = this.npc({ name: 'Aaji Phulwati', pos: V3(V.x + 2, 0, V.z + 3), scale: 0.9, cloth: 'sari', clothTex: g.T.clothRed, hair: 'short', hairColor: 0xd0ccc4, skinKey: 'aaji', age: 1 });
    const looks = [
      { cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothWhite, turban: g.T.clothWhite },
      { cloth: 'dhoti', clothTex: g.T.clothWhite, topTex: g.T.clothKhaki, turban: g.T.clothRed },
      { cloth: 'sari', clothTex: g.T.clothKhaki },
      { cloth: 'dhoti', clothTex: g.T.clothKhaki, topTex: g.T.clothWhite, turban: g.T.clothKhaki },
      { cloth: 'sari', clothTex: g.T.clothRed },
    ];
    for (let i = 0; i < Math.min(9, houses.length); i++) {
      const h = houses[i], L = looks[i % looks.length];
      const n = this.npc({ name: 'Villager', pos: h.door.clone(), yaw: h.rot, skinKey: 'v' + (i % 3), skin: [0x9a6a4a, 0x8a5a3e, 0xa87656][i % 3], ...L });
      n.wander = h.door.clone();
    }
    g.eco.spawnGroup('dog', V3(V.x + 20, 0, V.z - 10), 3);
    g.eco.spawnGroup('cow', V3(V.x - 80, 0, V.z + 60), 5, { persistent: true });
  }
  farFlute(notes, at) {
    const g = this.g, a = g.audio;
    const p = at || sitePos('sukhiSpot');
    const out = a.spatial({ x: p.x, y: p.y + 1.5, z: p.z }, 3.5, { verb: 0.9, ref: 20, bus: a.music });
    g.music.flutePhrase(notes, a.ctx.currentTime + 0.1, { gain: 0.25, dest: out });
  }
  interact(id) { // story-level interact handlers (returns true if handled)
    const g = this.g;
    if (id === 'dholeDen' && this.chapter && this.chapter.id === 'c8' && this.objIndex === 1 && !this.flags.rescued) {
      g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 4 };
      g.audio.splash(g.player.pos, 1); g.ui.toast('Digging…', 4);
      setTimeout(() => { this.flags.rescued = true; this.checkNow(); }, 4000);
      return true;
    }
    if (id === 'aaji' && this.chapter && this.chapter.id === 'ep' && this.objIndex === 2) {
      this.flags.placedLota = true; g.inv.take('lota', 1);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.3 }));
      m.position.copy(g.player.pos).add(V3(-Math.sin(g.player.yaw) * 0.8, 0.1, -Math.cos(g.player.yaw) * 0.8)); g.scene.add(m);
      if (PAINTED) toonify(m, { outline: 0.006, rim: 1 });
      this.aaji.walkTo(m.position); this.aaji.look = g.player.pos;
      this.checkNow();
      return true;
    }
    return false;
  }
}

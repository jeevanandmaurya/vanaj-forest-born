// VANAJ: the story, chapter by chapter. Four seasons, thirteen chapters and an epilogue.
//
// Who speaks, and how:
//   a plain string        the older Vanaj, remembering. Kept for the opening and close of a chapter.
//   ['vanaj', '...']      the boy, now. He talks like a fifteen-year-old who has only ever talked to animals.
//   ['kaali', '...', 'low whuff']   an animal, as he understands it, with the real call it made.
// Nobody is killed by the player and nothing bleeds: a beaten animal runs off. The one death in the story is quiet.
// Torn-Ear's last scene offers two ways to end it; both lead to the same ending.
import * as THREE from 'three';
import { SITES } from '../world/props.js';
import { groundHeight, VILLAGE } from '../world/terrain.js';
import { THEME } from '../audio/music.js';
import { SP } from '../world/flora.js';

// Delays in the story run on the game's clock, not the wall's: they wait while the game is paused, and they keep
// step with the scene however fast or slow frames are coming.
let G = null; export const bindGame = (g) => { G = g; };
const setTimeout = (fn, ms) => { G.wait(ms / 1000).then(fn); };

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const at = (k, dx = 0, dz = 0) => { const s = SITES[k]; return V3(s.x + dx, groundHeight(s.x + dx, s.z + dz), s.z + dz); };
const prop = (g, id) => g.props.inter.find((i) => i.id === id);
const count = (g, k) => g.inv.count(k);
export const CH = [];
const chapter = (o) => CH.push(o);

// a quiet beat: he kneels, the lines come one by one, then the objective is done
async function sitBeat(g, S, flag, lines, o = {}) {
  const gen = S.gen; g.player.crouch = true; g.player.action = { type: o.anim || 'hum', anim: o.anim || 'hum', t: 0, dur: 4 };
  if (o.hum) g.audio.hum();
  const ok = await g.talk.say(lines);
  if (!ok || S.gen !== gen) return;
  if (o.journal) g.ui.addJournal(o.journal[0], o.journal[1], 'story');
  S.flags[flag] = true; S.checkNow();
}
// the semal nearest the den: the tree the langurs teach him to climb
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
        const p = L.pts[k], reach = ((p.x - t.x) * dx + (p.z - t.z) * dz) / dd, s = reach - Math.abs(p.y - (t.bole - 8)) * 0.3;
        if (s > bs) { bs = s; pt = p.clone(); pt.y += L.r[k] + 0.05; }
      }
    }
    return pt || V3(t.x, t.bole - 6, t.z);
  });
}
// the nearest of the kinds of thing wanted lying about, for the pointer (looked up a few times a second)
function nearestItem(g, types) {
  if (g._itemT > g.clock) return g._item;
  g._itemT = g.clock + 0.4; const p = g.player.pos; let best = null, bd = Infinity;
  for (const a of g.pickups.active) if (types.includes(a.type)) { const d = (a.x - p.x) ** 2 + (a.z - p.z) ** 2; if (d < bd) { bd = d; best = a; } }
  for (const it of (g.loose && g.loose.near) || []) { if (it.gone || !types.includes(it.stick ? 'stick' : 'stone') || (!it.stick && it.size > 0.24)) continue; const d = (it.pos.x - p.x) ** 2 + (it.pos.z - p.z) ** 2; if (d < bd) { bd = d; best = it.pos; } }
  return (g._item = best);
}
const need = (g, list) => nearestItem(g, list.filter(([k, n]) => count(g, k) < n).map(([k]) => k));
function nearestCamp(g) { const p = g.player.pos; let best = null, bd = Infinity; for (const c of g.camps) { const d = c.pos.distanceToSquared(p); if (d < bd) { bd = d; best = c.pos; } } return best || (g.props.den && g.props.den.hearth); }
// the nearest liana, for the compass (looked up once a second)
function nearestLiana(g) {
  const now = g.clock; if (g._lianaT > now) return g._liana;
  g._lianaT = now + 1; const p = g.player.pos; let best = null, bd = Infinity;
  for (const T of g.veg.climbNear(p.x, p.z, 90)) for (const V of T.vines) { if (V.fixed) continue; const d = (V.a.x - p.x) ** 2 + (V.a.z - p.z) ** 2; if (d < bd) { bd = d; best = V.a; } }
  return (g._liana = best);
}
// the bank of the nearest water, a couple of metres back from the edge, for someone to wait at
function waterside(g, site) { const w = g.W.nearestWater(at(site)) || at(site), s = at(site), dx = s.x - w.x, dz = s.z - w.z, l = Math.hypot(dx, dz) || 1; return V3(w.x + dx / l * 2.5, 0, w.z + dz / l * 2.5); }
const companionPos = (g) => (g.companion && !g.companion.dead ? g.companion.pos : null);

// ============================================================================================ ACT I · WINTER
chapter({
  id: 'c1', title: 'Fog on the Teak', act: 'Act I · Winter', season: 'winter', weather: 'mist', hour: 6.9, spawn: ['den', 3, 6],
  setup(g, S) {
    S.ensureKaali();
    g.eco.spawnGroup('peafowl', at('den', 45, 20), 3);
    g.eco.spawnGroup('chital', at('denWater', -40, 30), 7);
    const lt = lessonTree(g); S.lessonTroop = g.eco.spawnGroup('langur', lt ? V3(lt.x + 4, 0, lt.z + 3) : at('den', 30, -40), 6).members; S.cast('langur', S.lessonTroop[0]);
  },
  intro: ['Twelve winters. That is how long the forest had me.', 'I never counted them. Kaali did, I think, in her own way.'],
  objectives: [
    { id: 'wake', text: 'Follow Kaali down to the waterhole', teach: ['move', 'look', 'run', 'jump'], teachTitle: 'Getting around', reach: ['denWater', 17],
      say: [['kaali', 'Up, cub. The fog is lifting and you are still on your back.', 'low whuff'], ['vanaj', 'I was awake. My eyes were just closed.'], ['kaali', 'Water first. Then we see about that empty belly.', 'soft growl']],
      cast: { kaali: (g) => ({ type: 'lead', to: waterside(g, 'denWater'), r: 5, leash: 15,
        onWait: () => g.talk.bark('kaali-wait', [[['kaali', 'Keep up.', 'short bark']], [['kaali', 'The water will not come to you.', 'whine']], [['kaali', 'Two legs, and still the slowest thing in the forest.', 'huff']]], { cd: 16 }) }) } },
    { id: 'drink', text: "Drink at the water's edge", teach: ['drink', 'crouch'], check: (g, S) => S.flags.drank,
      cast: { kaali: (g) => ({ type: 'wait', at: waterside(g, 'denWater') }) },
      after: [['vanaj', 'Cold!'], ['kaali', 'It is winter. You say that every winter.', 'huff']] },
    { id: 'gather', text: (g) => `Pick up sticks (${count(g, 'stick')}/4) and stones (${count(g, 'stone')}/2)`, teach: ['gather'], markerFn: (g) => need(g, [['stick', 4], ['stone', 2]]),
      check: (g) => count(g, 'stick') >= 4 && count(g, 'stone') >= 2, cast: { kaali: null },
      say: [['kaali', 'Sticks. Stones. You know what mornings are for.', 'yawn']] },
    { id: 'knife', text: 'Knock a stone knife into shape. Open your bag with <b>Tab</b>', teach: ['pouch', 'craft'], check: (g) => g.inv.has('knife'),
      done: (g) => g.player.equip('knife'),
      after: [['vanaj', 'One stone on another, until an edge comes off sharp.'], ['kaali', 'A tooth you can drop. Strange animal.', 'sniff']] },
    { id: 'fish', text: 'Feel under the bank for a fish (<b>E</b> at the water)', teach: ['fish'], marker: 'denWater', check: (g) => g.inv.has('meat_raw') || g.inv.has('meat_cooked'),
      hint: 'Fish lie in the shallows at dawn and dusk. A spear makes it easier later on.',
      cast: { kaali: (g) => ({ type: 'wait', at: waterside(g, 'denWater') }) },
      after: [['kaali', 'Hm. Small.', 'sniff'], ['vanaj', "It's bigger than the one you caught."], ['kaali', 'I did not catch one.', 'ears flat'], ['vanaj', 'Exactly.']] },
    { id: 'fire', text: (g) => `Build a fire from your bag (sticks ${count(g, 'stick')}/5, stones ${count(g, 'stone')}/3)`, teach: ['fire'], check: (g) => g.camps.length > 0,
      markerFn: (g) => need(g, [['stick', 5], ['stone', 3]]), cast: { kaali: null },
      hint: "Pick up more sticks and stones if you're short." },
    { id: 'cook', text: 'Roast the fish at the fire (<b>E</b>)', teach: ['cook'], markerFn: (g) => nearestCamp(g), check: (g) => g.inv.has('meat_cooked'),
      cast: { kaali: (g) => ({ type: 'wait', at: nearestCamp(g).clone().add(V3(1.6, 0, 1.2)) }) } },
    { id: 'share', text: 'Sit with Kaali and share it (<b>E</b> beside her)', markerFn: companionPos, check: (g, S) => S.flags.shared,
      interact: { at: companionPos, r: 4.5, prompt: 'Sit with Kaali',
        act: (g, S) => { g.director.direct('kaali', { type: 'rest', calm: true }); g.inv.take('meat_cooked', 1); g.player.hunger = Math.min(100, g.player.hunger + 30);
          sitBeat(g, S, 'shared', [['kaali', 'You first.', 'nose push'], ['vanaj', 'You always eat first.'], ['kaali', 'I am old. Old wolves get to change the rules.', 'long breath'], 'She put her chin on my knee. Her teeth were worn nearly flat.', 'Those same teeth carried me home once.'], { anim: 'eat' }); } } },
  ],
  outro: [],
});

chapter({
  id: 'c2', title: "The Langurs' Road", act: 'Act I · Winter', season: 'winter', weather: 'clear', hour: 8.6, spawn: ['den', 3, 6], flows: true,
  setup(g, S) {
    S.ensureKaali();
    if (!S.lessonTroop || !S.lessonTroop.some((a) => g.eco.animals.includes(a))) { const lt = lessonTree(g); S.lessonTroop = g.eco.spawnGroup('langur', lt ? V3(lt.x + 4, 0, lt.z + 3) : at('den', 30, -40), 6).members; }
    S.cast('langur', S.lessonTroop.find((a) => g.eco.animals.includes(a)));
  },
  objectives: [
    // the young langurs teach the canopy: the forest's other half, and the first joy of the game
    { id: 'climb', text: 'The young langurs are calling from the big semal. Climb up after them', markerFn: (g) => lessonTree(g), teach: ['climbStart', 'climbUp', 'climbRound'], teachTitle: 'Climbing',
      say: [['langur', 'Ground-boy! Ground-boy! Still down there with the old dog?', 'whoop'], ['vanaj', "She's a wolf."], ['langur', "She's slow. You're slow. Come up where it's fast!", 'whoop'], ['kaali', 'Go. I will sit here and be slow.', 'huff']],
      cast: { kaali: (g) => { const t = lessonTree(g); return t ? { type: 'wait', at: V3(t.x + 3.5, 0, t.z + 2.5) } : null; } },
      check: (g) => g.lessons.has('climbStart', 'climbUp', 'climbRound') && !!g.player.canopy.mode && g.player.pos.y - groundHeight(g.player.pos.x, g.player.pos.z) > 7,
      after: [['vanaj', 'You can see everything from up here. All the teak, with the fog still caught in it.'], ['kaali', 'Do not fall. I cannot carry you any more.', 'bark from below']] },
    { id: 'branch', text: 'Step out onto a branch and walk along it', teach: ['stepLimb', 'walkLimb'], teachTitle: 'Branches', check: (g) => g.lessons.has('stepLimb', 'walkLimb'),
      say: [['langur', 'Not the trunk, the branches! Trunks are for squirrels.', 'chatter']] },
    { id: 'swing', text: 'Find a liana. Swing on it, let go, and catch the next thing you can reach', markerFn: (g) => nearestLiana(g), teach: ['catch', 'pump', 'ropeClimb', 'letGo'], teachTitle: 'Ropes',
      check: (g, S) => S.flags.swung && g.lessons.has('catch', 'pump', 'ropeClimb', 'letGo'),
      done: (g) => { if (g.music) g.music.stinger('clue'); g.director.trust('langur', 0.3); },
      after: [['vanaj', 'I let go, and there was nothing under me. Nothing at all!'], ['vanaj', 'Again. I want to do that again.'], ['langur', 'Hoo! It flies! The ground-boy flies!', 'whoop']] },
    // the race: one of the young langurs leads through the crowns, waiting at each tree; the ground costs nothing
    // but pride, and after a few minutes it ends kindly
    { id: 'race', text: 'Race the young langur through the trees', markerFn: (g, S) => S.raceAt, check: (g, S) => S.flags.raced,
      hint: 'Climb, walk out along a branch, jump and catch. It waits for you at each tree.',
      say: [['langur', 'Six trees! First to the far one keeps the fig. Feet off the dirt!', 'whoop']],
      async run(g, S, gen) {
        const route = canopyRoute(g), P = g.player;
        const lead = (S.lessonTroop || []).find((a) => !a.dead && g.eco.animals.includes(a));
        if (!lead || route.length < 2) { S.flags.raced = true; S.checkNow(); return; }
        let wp = 0, hop = null, falls = 0, wasUp = false, scold = 0;
        lead.tm = null; lead.tree = null; lead.limb = null; lead.runTo = null; lead.perch = route[0]; lead.pos.copy(route[0]); lead.hop = null; S.raceAt = route[0];
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
            a.perch = null; W.audio.animal('langur', 'whoop', a.pos); a.mind.show('come', 2);
          }
          scold -= dt; if (!up && scold <= 0 && wasUp) { scold = 3.5; W.audio.animal('langur', 'alarm', a.pos); }
        };
        const t0 = g.clock;
        while (S.gen === gen) {
          await g.wait(0.25);
          const up = !!P.canopy.mode;
          if (wasUp && !up && P.onGround) { falls++; g.talk.bark('race-fall', [[['langur', 'Dirt! Dirt-feet! Back up, back up!', 'cough-bark']], [['langur', 'The ground is for the old dog!', 'chatter']]], { cd: 14 }); }
          wasUp = up;
          if (wp === route.length - 1 && !hop && up && P.pos.distanceTo(route[wp]) < 8) break;
          if (g.clock - t0 > 240) break;
        }
        if (S.gen !== gen) return;
        lead.scripted = null; lead.perch = route[wp]; S.raceAt = null;
        if (g.clock - t0 > 240) g.talk.say([['langur', 'Too slow! But less slow than last winter.', 'whoop'], ['vanaj', "I'm getting closer."]]);
        else g.talk.say(falls === 0 ? [['vanaj', 'Six trees. I never touched the ground!'], ['langur', 'Hm. Not bad. For a thing with no tail.', 'grunt'], 'He sat down beside me and started picking through my hair, as if I was one of them.']
          : [['vanaj', 'I fell off a lot.'], ['langur', 'You did. You fall very well.', 'grunt'], 'He sat down beside me and started picking through my hair, as if I was one of them.']);
        g.director.trust('langur', 0.3);
        S.flags.raced = true; S.checkNow();
      } },
    { id: 'home', text: 'The light is going. Follow Kaali home and sleep in the den', markerFn: (g) => prop(g, 'denBed').pos, teach: ['sleep'], check: (g, S) => S.flags.slept,
      onStart: (g) => { if (g.time.hour < 17.2) g.setTime(17.2); },
      say: [['kaali', 'Down, cub. The light is going, and night belongs to the ones with stripes.', 'two barks']],
      cast: { kaali: (g) => ({ type: 'lead', to: prop(g, 'denBed').pos.clone().add(V3(1.2, 0, 1.4)), r: 3, leash: 16 }) } },
  ],
  outro: ['I scratched another line on the den wall, the way I did every night.', "I couldn't have told you why. Kaali never asked."],
});

chapter({
  id: 'c3', title: 'The Wire', act: 'Act I · Winter', season: 'winter', weather: 'clear', hour: 6.8, spawn: ['den', 4, 5],
  setup(g, S) { S.ensureKaali(); S.troop = g.eco.spawnGroup('langur', at('den', 25, -30), 6).members; S.cast('troop', S.troop[0]); g.eco.blocked.add('tiger'); },
  intro: ['The next morning the forest was too quiet.'],
  objectives: [
    { id: 'listen', text: 'Listen', tension: 0.5, teach: ['alarms'], cast: { kaali: { type: 'stay', calm: true } },
      async run(g, S, gen) {
        if (!await S.pause(gen, 4)) return;
        for (const l of S.troop || []) { l.alarmCD = 0; l.alarm(g.W, 'tiger'); }
        g.talk.say([['troop', 'Khok! Khok! Stripes! Stripes in the nala!', 'cough-bark']]);
        if (!await S.pause(gen, 3.5)) return;
        g.audio.animal('chital', 'alarm', at('den', 80, 60)); g.ui.alarmMarker(SITES.den.x + 120, SITES.den.z - 20, 'Chital');
        if (!await S.pause(gen, 2.5)) return;
        g.audio.animal('sambar', 'alarm', at('den', 140, -10)); g.ui.alarmMarker(SITES.den.x + 140, SITES.den.z - 10, 'Sambar');
        await g.talk.say([['vanaj', 'Langurs, then chital. Now a sambar.'], ['kaali', 'A sambar does not waste her breath. It is a big cat, and it is coming here.', 'hackles up'], ['kaali', 'Fire, cub. The only thing he respects.', 'low growl']]);
        if (S.gen === gen) S.next();
      } },
    { id: 'brand', text: "Take a burning branch from the den's hearth (<b>E</b>)", tension: 0.7, markerFn: (g) => g.props.den.hearth, check: (g) => g.inv.has('torch'),
      cast: { kaali: (g) => ({ type: 'guard', from: at('den', 60, -10), calm: true }) },
      interact: { at: (g) => g.props.den.hearth, r: 3.2, prompt: 'Take a burning branch',
        act: (g) => { g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.2 }; setTimeout(() => { g.inv.add('torch', 1); g.player.equip('torch'); g.audio.pickup(); }, 900); } } },
    { id: 'stand', text: 'Stand with Kaali. Roar with the torch in your hand to drive Torn-Ear back (hold <b>Q</b>)', tension: 1, teach: ['wheel', 'roar', 'torch'], teachTitle: 'Standing your ground',
      hint: 'A tiger fears only fire. Keep the torch out and roar when he comes close.',
      async run(g, S, gen) {
        const P = g.player, kaali = g.director.actor('kaali'), den = at('den');
        const t = S.spawnTornEar(at('den', 95, -25));
        g.audio.animal('tiger', 'roar', t.pos, { big: true }); if (g.music) g.music.setCombat(0.6); S.scriptMusic = true;
        t.mind.direct({ type: 'goto', to: at('den', 26, -8), speed: 'trot', brave: true, r: 3, then: { type: 'prowl', around: P.pos, r: 15, brave: true } });
        g.director.direct('kaali', { type: 'guard', from: t, calm: true });
        g.talk.say([['tornear', 'The den. The warm den. I am old and the loop bites, and I am taking it.', 'rolling growl'], ['kaali', 'Not while I stand in it.', 'snarl']]);
        let pushes = 0, busy = false; const t0 = g.clock;
        const push = () => {
          if (busy || S.gen !== gen) return; busy = true; pushes++;
          const dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z, l = Math.hypot(dx, dz) || 1;
          g.audio.animal('tiger', 'snarl', t.pos, { big: true }); t.mind.show('sweat', 2);
          t.mind.direct({ type: 'goto', to: V3(P.pos.x + dx / l * 30, 0, P.pos.z + dz / l * 30), speed: 'run', brave: true, r: 3, then: (a) => { busy = false; a.mind.direct({ type: 'prowl', around: P.pos, r: Math.max(9, 15 - pushes * 2), brave: true, rate: 0.16 }); } });
          g.talk.bark('push' + pushes, [[pushes === 1 ? ['tornear', 'Fire. The small one carries fire.', 'hiss'] : ['kaali', 'Again, cub! He is giving ground!', 'bark']]], { cd: 1 });
        };
        const offCall = g.on('call', (e) => { if (e.kind === 'roar' && P.torchLit && t.dist2(P.pos) < 30 * 30) push(); else if (e.kind === 'roar' && !P.torchLit) g.ui.toast('Hold the torch (<b>6</b>). Your voice alone will not move him'); });
        const offHit = g.on('hit', (e) => { if (e.target === t) push(); });
        while (S.gen === gen && pushes < 3 && g.clock - t0 < 110) await g.wait(0.25);
        offCall(); offHit(); if (S.gen !== gen) return;
        // he has had enough of fire, and goes for the boy. Kaali is quicker.
        while (busy && S.gen === gen) await g.wait(0.2);
        if (S.gen !== gen) return;
        t.mind.direct({ type: 'goto', to: P.pos, speed: 'run', brave: true, r: 6, then: (a) => { a.anim.swipe = 1; } });
        g.audio.animal('tiger', 'roar', t.pos, { big: true });
        if (!await S.pause(gen, 1.1)) return;
        if (kaali) { kaali.mind.direct({ type: 'goto', to: t.pos.clone(), speed: 'run', brave: true, calm: true, r: 2.2, then: { type: 'stay', calm: true } }); }
        if (!await S.pause(gen, 1.0)) return;
        g.slowmo(0.35, 1.6); g.audio.animal('wolf', 'snarl', (kaali || P).pos); g.fx.blood(t.pos.clone().add(V3(0, 0.8, 0)), null, 1.5, true); P.shake = 0.9;
        if (kaali) { g.audio.animal('wolf', 'pain', kaali.pos); kaali.limp = 0.8; kaali.hurtBad = true; kaali.winded = 5; }
        g.talk.say([['vanaj', 'Kaali!']], { now: true });
        S.flags.wirePos = t.pos.clone();
        S.sendAway(t, at('den', 520, -260));
        if (!await S.pause(gen, 2.2)) return;
        g.audio.animal('tiger', 'roar', t.pos, { far: true });
        S.addStoryItem('wire', S.flags.wirePos, 'Pick up the shiny vine');
        if (g.music) g.music.setCombat(0); S.scriptMusic = false;
        S.next();
      } },
    { id: 'wire', quiet: true, text: 'Something bright fell where Torn-Ear stood. Pick it up', markerFn: (g, S) => S.flags.wirePos, check: (g) => g.inv.has('wire'),
      cast: { kaali: { type: 'rest', calm: true } },
      done: (g) => { g.ui.addJournal('A vine that shines', "Torn-Ear had loops of something bright cut into his front leg, so deep the skin had grown over them. One came off. It's thin and cold and it doesn't rot. The only other things I've seen shine are water and my lota.", 'clue'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', "It's a vine. But it's cold. And it shines like my lota."], ['kaali', 'It is not from the forest, cub. Nothing in the forest bites and holds on for years.', 'thin whine']] },
    { id: 'walk', quiet: true, text: 'Walk Kaali home to the den', markerFn: (g) => prop(g, 'denBed').pos,
      say: [['vanaj', 'Get up. Kaali. Please get up.'], ['kaali', 'I am up. I am only... slower.', 'thin whine']],
      cast: { kaali: (g) => ({ type: 'goto', to: prop(g, 'denBed').pos.clone().add(V3(1.0, 0, 1.2)), speed: 'walk', calm: true, r: 1.6, then: { type: 'rest', calm: true } }) },
      check: (g) => { const k = g.director.actor('kaali'), b = prop(g, 'denBed').pos; return !k || (k.pos.distanceTo(b) < 4.5 && g.player.pos.distanceTo(k.pos) < 7); } },
    { id: 'bed', quiet: true, text: (g) => `Gather leaves for her bed (${Math.min(3, count(g, 'leaves'))}/3), then lay them by her`, markerFn: (g) => (count(g, 'leaves') < 3 ? nearestItem(g, ['leaves']) : companionPos(g)), check: (g, S) => S.flags.bed,
      hint: 'Leaves lie on the ground, and lantana bushes have plenty (<b>E</b>).',
      interact: { at: (g) => (count(g, 'leaves') >= 3 ? companionPos(g) : null), r: 4, prompt: 'Lay the leaves under her',
        act: (g, S) => { g.inv.take('leaves', 3); g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 2.2 }; setTimeout(() => { S.flags.bed = true; S.checkNow(); }, 2000); } } },
    { id: 'night', quiet: true, text: 'Sit with her (<b>E</b>)', markerFn: companionPos, check: (g, S) => S.flags.night,
      onStart: async (g, S) => { const gen = S.gen; if (g.time.hour < 19 && g.time.hour > 5) { await g.ui.fade(true, 900); if (S.gen !== gen) return; g.setTime(20.4); await g.ui.fade(false, 1400); } },
      interact: { at: companionPos, r: 4, prompt: 'Sit with Kaali',
        act: async (g, S) => {
          const gen = S.gen, k = g.director.actor('kaali'); g.player.crouch = true; g.player.action = { type: 'hum', anim: 'hum', t: 0, dur: 6 };
          await g.talk.say([['kaali', 'You hum when you are afraid. You did it the night I found you.', 'slow breath'], ['vanaj', "I'm not afraid."], ['kaali', 'Hum anyway.', 'eyes closed']]);
          if (S.gen !== gen) return; g.audio.hum(); g.player.action = { type: 'hum', anim: 'hum', t: 0, dur: 6 };
          await g.talk.say([['kaali', 'Listen, cub. You stand on two legs. You make fire. You were never a wolf.', 'soft whuff'], ['vanaj', "I'm your wolf."], ['kaali', 'You are my cub. That is a different thing.', 'nose against his hand'],
            ['kaali', 'Somewhere there are others who walk the way you walk. The shining vine is theirs. Follow it.', 'soft whuff'], ['vanaj', 'And you?'], ['kaali', 'I am going to sleep. It has been a long winter.', 'long sigh']]);
          if (S.gen !== gen) return;
          await g.ui.fade(true, 2600); if (S.gen !== gen) return;
          g.setTime(6.3); if (k) { k.mind.direct(null); k.die(g.W, { quiet: true }); }
          await g.wait(1.6); if (S.gen !== gen) return;
          await g.ui.fade(false, 2600);
          await g.talk.say(["She didn't wake up."]);
          if (S.gen !== gen) return;
          g.ui.addJournal('Kaali', "She found me on a sandbank when I was three and carried me home by the cloth at my waist. She's the only mother I remember. She went in her sleep, in our den, with her nose in my hand.", 'story');
          S.flags.night = true; S.checkNow();
        } } },
    { id: 'cover', quiet: true, text: 'Cover her with teak leaves (<b>E</b>)', markerFn: (g) => (g.companionBody ? g.companionBody.pos : null), check: (g, S) => S.flags.covered,
      interact: { at: (g) => (g.companionBody ? g.companionBody.pos : null), r: 3.4, prompt: 'Cover Kaali',
        act: (g, S) => { g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 2.5 }; g.audio.footstep('leaf', 1); setTimeout(() => { S.layToRest(g.companionBody); S.flags.covered = true; S.checkNow(); }, 2200); } } },
    { id: 'hum', quiet: true, text: 'Hum the four notes for her (hold <b>Q</b> → Calm hum)', teach: ['wheel', 'hum'], markerFn: (g) => (g.companionBody ? g.companionBody.pos : null), check: (g, S) => S.flags.hummed,
      onStart: (g, S) => { const gen = S.gen, off = g.on('call', (e) => { if (S.gen !== gen) return off(); if (e.kind === 'hum') { off(); setTimeout(() => { S.flags.hummed = true; S.checkNow(); }, 4500); } }); },
      after: ['I hummed the four notes. I never knew where I got them. She always settled when I did that.', "Wolves don't cry.", 'I did.'] },
  ],
  outro: ['The den smelled of tiger now. Under that it still smelled of her. I could not stay.', "I packed embers in a bamboo tube and walked east, where I had never been."],
  nextSeason: 'summer',
  cleanup(g, S) { g.eco.blocked.delete('tiger'); S.scriptMusic = false; },
});

// ============================================================================================ ACT II · SUMMER
chapter({
  id: 'c4', title: 'East', act: 'Act II · Summer', season: 'summer', weather: 'hazy', hour: 8.4, spawn: ['termite', -90, 110],
  setup(g, S) {
    S.bear = g.eco.spawnOne('bear', at('termite', 10, -5), { story: 'mahua', name: 'Mahua', persistent: true, homeR: 30 }); S.cast('mahua', S.bear);
    S.bear.state = 'forage'; S.bear.timer = 60;
    g.eco.spawnGroup('boar', at('termite', -60, 80), 4);
    g.ui.seeLore('termite');
  },
  intro: ['By the hot months the teak had dropped every leaf, and the whole forest looked burnt.', 'I had been alone since the winter. I talked to myself a lot.'],
  objectives: [
    { id: 'travel', text: 'Cross to the termite flats', marker: 'termite', reach: ['termite', 60],
      say: [['vanaj', "Mounds. Taller than me. Kaali never brought me this far."]] },
    { id: 'bear', text: 'A sloth bear. Crouch, hands empty, and hum to her (hold <b>Q</b> → Calm hum)', teach: ['crouch', 'equip', 'wheel', 'hum'], teachTitle: 'Making friends', onStart: (g) => g.lessons.markers(), markerFn: (g, S) => S.bear && S.bear.pos,
      hint: "Bears see and hear badly. Surprise one and it charges. <b>1</b> puts your weapon away.",
      say: [['mahua', 'Hff. Something small. Something loud. Go away, I am eating.', 'huffing'], ['vanaj', 'Slow. Low. Hands where she can see them.']],
      check: (g, S) => S.bear && (S.bear.bond >= 0.6 || S.bear.routed || !g.eco.animals.includes(S.bear)),
      done: (g, S) => { if (g.eco.animals.includes(S.bear) && !S.bear.routed) { S.bear.bond = 1; g.director.trust('bear', 0.5); } g.ui.seeLore('bear'); },
      after: (g, S) => (S.bear.bond >= 1 ? [['mahua', 'You hum. Hm. Bears hum too, when the grubs are good.', 'long huff'], ['vanaj', 'Is that a yes?'], ['mahua', 'It is not a no. Eat. You are all bones.', 'snuffle']] : [['vanaj', "She's gone. I think I did that wrong."]]) },
    { id: 'termites', text: 'Break open a termite mound (<b>E</b>) and eat what the bear eats', marker: 'termite', check: (g, S) => S.flags.ateTermites,
      cast: { mahua: null },
      after: [['vanaj', 'They pop. They actually pop.'], ['mahua', 'Now you understand everything worth understanding.', 'snuffle']] },
    { id: 'follow', text: 'Mahua knows where the rock bees are. Follow her', marker: 'hive', reach: ['hive', 14],
      say: [['mahua', 'Grubs are good. Sweet is better. Come, bone-cub. You have the smoke.', 'grunt']],
      cast: { mahua: (g) => ({ type: 'lead', to: at('hive', 5, 4), r: 4, leash: 18 }) } },
    { id: 'honey', text: 'Make a torch (<b>Tab</b>) and smoke the comb for honey', marker: 'hive', teach: ['craft', 'torch', 'torchOff'], check: (g) => g.inv.has('honey'),
      hint: 'Hold the torch under the hive and press <b>E</b>. Without smoke, the bees come for you.',
      cast: { mahua: (g) => ({ type: 'wait', at: at('hive', 5, 4) }) }, done: (g) => g.ui.seeLore('rockbee') },
    { id: 'gift', text: 'Leave a piece of comb for Mahua (<b>E</b> beside her)', markerFn: (g, S) => S.bear && S.bear.pos, check: (g, S) => S.flags.gift || !g.eco.animals.includes(S.bear),
      interact: { at: (g, S) => (g.eco.animals.includes(S.bear) ? S.bear.pos : null), r: 4.5, prompt: 'Give Mahua some honey',
        act: (g, S) => { g.inv.take('honey', 1); g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.4 }; S.bear.setState('forage', 40); g.director.trust('bear', 0.4); S.flags.gift = true;
          g.talk.say([['mahua', 'Mmf. Mmmf. You may walk in my flats, bone-cub. Tell the others I said so.', 'smacking'], ['vanaj', 'There are no others.'], ['mahua', 'There are always others. You have not smelled them yet.', 'slow huff']]).then(() => S.checkNow()); } } },
  ],
  outro: ['That night I heard Torn-Ear roar, far to the west, from my old den.', "The langurs didn't sleep. Neither did I."],
});

chapter({
  id: 'c5', title: 'The Burning Months', act: 'Act II · Summer', season: 'summer', weather: 'hazy', hour: 9.3, spawn: ['mahua', 60, 150],
  setup(g, S) { g.eco.spawnGroup('chital', at('mahua', 40, 30), 8); S.troop = g.eco.spawnGroup('langur', at('mahua', -12, 8), 6).members; S.cast('troop', S.troop[0]); g.ui.seeLore('teak'); g.ui.seeLore('palash'); },
  intro: ['The pools dried to cracked mud. Everything that could walk went looking for water, or for mahua.'],
  objectives: [
    { id: 'smell', text: 'Follow the smell of mahua flowers', marker: 'mahua', reach: ['mahua', 22], done: (g) => g.ui.seeLore('mahua'),
      say: [['vanaj', 'Sweet. Like honey gone warm. Something north of here is in flower.']],
      after: [['troop', 'Ours! Our flowers! ...hic.', 'slurred whoop'], ['vanaj', "You're drunk. All of you. On flowers."]] },
    { id: 'bowl', text: "Someone has swept the ground here. Look under the tree", marker: 'mahua', check: (g, S) => S.flags.clue_leafBowl,
      done: (g) => { g.inv.add('bowl', 1); g.ui.addJournal('Swept ground, a leaf bowl', 'Someone swept the ground under the big mahua and took every flower. Beside the trunk there was a bowl made of folded leaves, pinned with a twig.', 'clue'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', 'Leaves, folded over and pinned with a twig. A bowl.'], ['vanaj', "Something did this on purpose. Bears don't fold things."]] },
    { id: 'fawn', text: 'A fawn is caught in the lantana thorns. Free it (<b>E</b>)', markerFn: (g, S) => (S.fawn && g.eco.animals.includes(S.fawn) ? S.fawn.pos : null), check: (g, S) => S.flags.fawn,
      onStart: (g, S) => {
        const p = at('mahua', 26, 34); S.fawn = g.eco.spawnOne('chital', p, { persistent: true, scale: 0.5, male: false });
        S.doe = S.cast('doe', g.eco.spawnOne('chital', at('mahua', 46, 50), { persistent: true, male: false }));
        S.fawn.scripted = (dt, W, a) => { a.targetSpeed = 0; a.yaw += Math.sin(a.t * 9) * dt * 2; };   // struggling, going nowhere
        S.doe.mind.direct({ type: 'watch', at: S.fawn.pos, brave: true });
        g.audio.animal('chital', 'alarm', p);
      },
      say: [['doe', 'Please. Please. Not that one.', 'thin bleat'], ['vanaj', "Easy. I'm not here for your fawn."]],
      interact: { at: (g, S) => (S.fawn && !S.flags.freed ? S.fawn.pos : null), r: 2.6, prompt: 'Free the fawn from the thorns',
        act: (g, S) => {
          const gen = S.gen; S.flags.freed = true;
          g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 2.4 }; g.player.hurt(3, null, { kind: 'thorns', silent: true });
          setTimeout(async () => {
            if (S.gen !== gen) return;
            const f = S.fawn, m = S.doe;
            f.scripted = (dt, W, a) => { a.steer(m.pos.x, m.pos.z, a.d.run * 0.6, dt, W); if (a.dist2(m.pos) < 5) { a.scripted = null; a.group = null; a.mind.direct({ type: 'goto', to: at('mahua', 120, 110), speed: 'trot', brave: true, then: null }); m.mind.direct({ type: 'goto', to: at('mahua', 122, 112), speed: 'trot', brave: true, then: null }); } };
            g.director.trust('chital', 0.5);
            await g.talk.say([['vanaj', "The thorns had its leg. Now they've got my hands. Ow."], ['doe', 'It gave her back. The two-legs gave her back.', 'soft bleat'], 'Its mother waited at the edge of the trees the whole time. She did not run until it reached her.', 'Kaali used to wait for me like that.']);
            if (S.gen === gen) { S.flags.fawn = true; S.checkNow(); }
          }, 2400);
        } } },
  ],
  outro: ['I sat there holding that leaf bowl for a long time.'],
});

chapter({
  id: 'c6', title: 'Cut Wood', act: 'Act II · Summer', season: 'summer', weather: 'clear', hour: 14.5, spawn: ['mahua', -40, -30],
  setup(g, S) { const h = g.eco.spawnGroup('gaur', at('maidan', 60, 40), 5, { radius: 50 }); S.cast('gaur', h.members[0]); g.eco.spawnGroup('chital', at('maidan', -40, -30), 12); g.eco.spawnGroup('sambar', at('maidan', -120, 60), 3); g.ui.seeLore('gaur'); },
  intro: ['The swept ground led west, across the big meadow the forest guards call Alikatta.'],
  objectives: [
    { id: 'meadow', text: 'Cross Alikatta meadow to the far treeline', marker: 'stumps', reach: ['stumps', 35], hint: 'A gaur snorts before it charges. Give the bull room.',
      tick: (g, S) => { const b = g.director.actor('gaur'); if (b && b.dist2(g.player.pos) < 30 * 30) g.talk.bark('gaur-warn', [[['gaur', 'Mine. The grass, the cows, the shade. Walk wide.', 'snort'], ['vanaj', 'Walking wide. Very wide.']]], { once: true }); } },
    { id: 'stump', text: 'Look at the stump', marker: 'stumps', check: (g, S) => S.flags.clue_stump,
      done: (g) => { g.ui.addJournal('Flat-cut stumps', 'Trees cut off flat, with chips of wood all over the ground. Whatever did it is a lot harder than my knife.', 'clue'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', "Wind doesn't do that. Lightning doesn't either."], ['vanaj', 'Something hit it in the same place, over and over. Like my knife, only much harder.']] },
    { id: 'hearth', text: 'Look at the burnt stones nearby', marker: 'hearth', check: (g, S) => S.flags.clue_hearth,
      done: (g) => g.ui.addJournal('A cold hearth', 'Three stones in a ring, ash, and bits of a red clay pot. Someone else makes fire.', 'clue'),
      after: [['vanaj', 'Three stones in a ring. Ash. A broken red pot.'], ['vanaj', 'I make fires like this. I thought I was the only one who did.'], ['vanaj', '...Someone.']] },
    { id: 'look', text: 'Climb a tall tree and look out over the forest', teach: ['climbUp', 'treeTop'], hint: 'Keep holding <b>W</b>. You can go right to the top.', check: (g, S) => S.flags.saw,
      tick: (g, S) => { const P = g.player; if (!S.flags.seeing && P.canopy.mode && P.pos.y - groundHeight(P.pos.x, P.pos.z) > 11) { S.flags.seeing = true; g.talk.say([['vanaj', 'Smoke. A long way north, where the trees stop.'], ['vanaj', 'So there is someone.'], ['vanaj', "That scares me. I'm going anyway."]]).then(() => { S.flags.saw = true; S.checkNow(); }); } } },
  ],
  outro: ['I slept beside that cold fire pit, as if whoever made it might come back.'],
});

chapter({
  id: 'c7', title: 'The Shadow on the Rocks', act: 'Act II · Summer', season: 'summer', weather: 'clear', hour: 16.8, spawn: ['stumps', -30, 10],
  setup(g, S) { g.eco.blocked.add('leopard'); S.troop = g.eco.spawnGroup('langur', at('rocks', 40, 40), 6).members; S.cast('troop', S.troop[0]); g.ui.seeLore('kulu'); },
  intro: ['The stumps kept going west, up to the rocks where the white ghost trees grow.', 'That is leopard country.'],
  objectives: [
    { id: 'rocks', text: 'Go west to the Piyorthadi rocks', marker: 'rocks', reach: ['rocks', 140] },
    { id: 'cave', text: 'Find shelter among the rocks', marker: 'cave', check: (g, S) => S.flags.clue_cave,
      done: (g) => { g.inv.locks.delete('bow'); g.ui.addJournal('The red hunters', 'There are red paintings in a rock shelter: animals I know, and people with two legs like mine, holding a thing that throws sticks. I worked out the bow from looking at them.', 'clue'); g.ui.toast('New to make: Bow, Arrows'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', 'Someone painted on the rock. Deer. A gaur. A tiger.'], ['vanaj', 'And thin figures on two legs, pulling back... something. A bent stick that throws a straight one.'], ['vanaj', 'They stand like me.']] },
    { id: 'bow', text: 'Make a bow (<b>Tab</b>), and arrows if you have feathers', teach: ['craft', 'bowDraw'], check: (g) => g.inv.has('bow'), hint: 'Two bamboo and three fibre. Cut bamboo from a clump with your knife (<b>E</b>). Peacocks drop feathers.' },
    { id: 'shadow', text: 'The Shadow is circling. Keep a fire or a torch between you and her until she gives up', tension: 1, teach: ['roar', 'block', 'dodge', 'torch'], teachTitle: 'Standing your ground',
      async run(g, S, gen) {
        if (g.time.hour < 18.3) g.setTime(18.6);
        const P = g.player, p = P.pos, lp = V3(p.x + 35, 0, p.z - 25);
        const L = S.cast('shadow', g.eco.spawnOne('leopard', lp, { story: 'shadow', name: 'The Shadow', persistent: true, aggro: 0, hpMul: 1.2 })); L.keep = true;
        g.audio.animal('leopard', 'saw', L.pos); g.ui.seeLore('leopard'); if (g.music) g.music.setCombat(0.4); S.scriptMusic = true;
        for (const a of S.troop || []) { a.alarmCD = 0; a.alarm(g.W, 'leopard'); }
        g.talk.say([['troop', 'Khok! Spots! Spots on the rock!', 'cough-bark'], ['shadow', 'A cub with no pack. On my rocks. At my hour.', 'sawing cough'], ['vanaj', 'Fire. Kaali said fire.']]);
        L.mind.direct({ type: 'prowl', around: P.pos, r: 17, brave: true, rate: 0.2 });
        // she tests him: each time she comes in she is met by fire, a roar or a blow, or she gets a swipe in
        let stood = 0, hits = 0; const t0 = g.clock;
        const offHit = g.on('hit', (e) => { if (e.target === L) hits++; });
        const offCall = g.on('call', (e) => { if (e.kind === 'roar' && L.dist2(P.pos) < 26 * 26) { stood++; L.mind.show('sweat', 2); g.audio.animal('leopard', 'snarl', L.pos); if (L.state !== 'idle') { L.aggro = 0; L.target = null; L.setState('idle', 1); } L.mind.direct({ type: 'prowl', around: P.pos, r: 18, brave: true, rate: 0.22 }); } });
        let nextRush = 14;
        while (S.gen === gen) {
          await g.wait(0.25); if (P.dead) { offHit(); offCall(); return; }
          const el = g.clock - t0, lit = P.torchLit || g.nearFire;
          if (L.routed || !g.eco.animals.includes(L) || stood + hits >= 4 || el > 95) break;
          // a rush: only when he has no fire up. With fire she only comes closer and thinks better of it.
          if (el > nextRush && L.mind.dir && L.mind.dir.type === 'prowl') {
            nextRush = el + 16;
            if (lit) { L.mind.direct({ type: 'prowl', around: P.pos, r: 9, brave: true, rate: 0.3 }); g.talk.bark('shadow-fire', [[['shadow', 'Fire. Always the fire with these ones.', 'hiss']]], { cd: 30 }); setTimeout(() => { if (S.gen === gen && L.mind.dir) L.mind.direct({ type: 'prowl', around: P.pos, r: 17, brave: true, rate: 0.2 }); }, 6000); }
            else { L.mind.direct(null); L.aggro = 1; L.target = 'player'; L.setState('stalk'); g.ui.toast('She is coming in. Light a torch (<b>6</b>) or roar (<b>Q</b>)', 5); setTimeout(() => { if (S.gen === gen && g.eco.animals.includes(L) && !L.routed) { L.aggro = 0; L.target = null; L.setState('idle', 1); L.mind.direct({ type: 'prowl', around: P.pos, r: 17, brave: true, rate: 0.2 }); } }, 11000); }
          }
          if (g.music) g.music.setCombat(L.state === 'attack' || L.state === 'charge' || L.state === 'pounce' ? 1 : 0.4);
        }
        offHit(); offCall(); if (g.music) g.music.setCombat(0); S.scriptMusic = false;
        if (S.gen !== gen) return;
        if (g.eco.animals.includes(L) && !L.routed) S.sendAway(L, V3(p.x + 160, 0, p.z - 160), 'trot');
        g.talk.say([['shadow', 'Not worth a burnt whisker. Keep your rock, cub. For tonight.', 'low cough'], ['vanaj', "She's gone. I'm still here. I'm still here!"]]);
        S.next();
      } },
    { id: 'hand', quiet: true, text: 'Put your hand on the wall beside the hunters (<b>E</b>)', marker: 'cave', check: (g, S) => S.flags.hand,
      interact: { at: () => SITES.cave, r: 6, prompt: 'Put your hand on the rock', act: (g, S) => sitBeat(g, S, 'hand', [['vanaj', 'My hand fits right over theirs.'], ['vanaj', "Five fingers and a thumb. Kaali's paw was nothing like that."], "I had always known it. I just never let myself think about it."], { anim: 'gather' }) } },
  ],
  outro: ['I took a burnt stick and drew myself on the wall beside them.', 'Then the wind changed. It smelled of wet dust.'],
  nextSeason: 'monsoon',
  cleanup(g, S) { g.eco.blocked.delete('leopard'); S.scriptMusic = false; },
});

// ============================================================================================ ACT III · MONSOON
chapter({
  id: 'c8', title: 'First Rain', act: 'Act III · Monsoon', season: 'monsoon', weather: 'storm', hour: 15.2, spawn: ['rocks', 260, 280],
  setup(g, S) { g.eco.blocked.add('dhole'); g.eco.spawnGroup('peafowl', g.player.pos.clone().add(V3(14, 0, -10)), 3); g.ui.seeLore('hawkcuckoo'); S.rainT = 0; },
  intro: ['The first storm broke the heat in one afternoon.'],
  objectives: [
    { id: 'rain', text: 'Stand still in the rain and look up', hint: 'Stop moving and look up.', check: (g, S) => S.flags.rain,
      tick: (g, S, dt) => { const P = g.player; if (P.speed < 0.4 && P.pitch > 0.45) S.rainT = (S.rainT || 0) + dt; if (S.rainT > 3.5 && !S.flags.raining) { S.flags.raining = true; g.talk.say([['vanaj', 'Ha! HA! It came! It actually came!'], ['peacock', 'Rain! Look at me! Everyone look at me in the rain!', 'piercing may-awe'], 'It ran in my eyes and down my back. I laughed. I think I danced.', "Kaali would have shaken herself off and looked at me as if I'd lost my mind."]).then(() => { S.flags.rain = true; S.checkNow(); }); } } },
    { id: 'whistle', text: 'Something is whistling in the bamboo...', tension: 0.7,
      async run(g, S, gen) {
        if (!await S.pause(gen, 4)) return;
        const p = g.player.pos, c = V3(p.x - 60, 0, p.z + 40);
        const pack = g.eco.spawnGroup('dhole', c, 6, { aggro: 0, persistent: true });
        S.pack = pack.members; S.packGroup = pack.group; const lal = S.cast('lal', S.pack[0]); lal.name = 'Lal'; lal.scale *= 1.12; lal.root.scale.setScalar(lal.scale); lal.hp *= 1.6; lal.maxHp = lal.hp;
        for (const d of S.pack) d.keep = true;
        g.audio.animal('dhole', 'whistle', c); g.ui.seeLore('dhole');
        await g.talk.say([['lal', 'Ours. Our bamboo, our rain, our hill. One of you, six of us. Leave.', 'rising whistle'], ['vanaj', 'Dholes. Kaali said never to run from dholes. Running is what deer do.']]);
        if (S.gen !== gen) return;
        for (const d of S.pack) d.aggro = 1;
        pack.group.engage('player', g.W);
        S.next();
      } },
    { id: 'pack', text: (g, S) => `Stand your ground against the pack (${S.pack ? S.pack.filter((d) => d.routed || !g.eco.animals.includes(d)).length : 0} run off)`, tension: 1, teach: ['block', 'dodge', 'roar', 'torch'], teachTitle: 'Standing your ground',
      hint: 'Put your back against a tree or a rock. They will not come near a torch.',
      async run(g, S, gen) {
        if (g.music) g.music.setCombat(1); S.scriptMusic = true; const t0 = g.clock, lal = S.pack[0];
        while (S.gen === gen) {
          await g.wait(0.3); if (g.player.dead) return;
          const here = S.pack.filter((d) => !d.routed && g.eco.animals.includes(d));
          const lalHurt = !here.includes(lal) || lal.hp < lal.maxHp * 0.5;
          if (here.length <= 3 || (lalHurt && here.length <= 4) || g.clock - t0 > 80) break;
          for (const d of here) if (d.state === 'idle' || d.state === 'wander') { d.target = 'player'; d.setState('charge'); }
        }
        if (S.gen !== gen) return;
        const p = g.player.pos;
        for (const d of S.pack) if (!d.routed && g.eco.animals.includes(d)) { d.aggro = 0; d.target = null; S.sendAway(d, V3(p.x - 220, 0, p.z + 160), 'run'); }
        if (g.music) g.music.setCombat(0); S.scriptMusic = false;
        g.talk.say([['lal', 'Enough. This one bites back. We remember you, two-legs.', 'falling whistle'], ['vanaj', "I'll remember you too. The one with the notch in her ear."]]);
        S.next();
      } },
  ],
  outro: ['I started calling their leader Lal.', 'Then the whole pack was simply gone, into the rain.'],
  cleanup(g, S) { g.eco.blocked.delete('dhole'); S.scriptMusic = false; },
});

chapter({
  id: 'c9', title: 'Chingari', act: 'Act III · Monsoon', season: 'monsoon', weather: 'rain', hour: 9.5, spawn: ['dholeDen', 90, -60],
  intro: ['It rained for days. Every stream became a river.', 'Then, over all that water, I heard something small crying.'],
  objectives: [
    { id: 'cry', text: 'Follow the crying', marker: 'dholeDen', reach: ['dholeDen', 18],
      async run(g, S, gen) { while (S.gen === gen && S.objIndex === 0) { g.audio.animal('dhole', 'pain', at('dholeDen')); await g.wait(2.5 + Math.random() * 2); } },
      after: [['vanaj', "A den, and the stream's coming up into it. There's a pup still in there."]] },
    { id: 'dig', text: 'Dig the pup out of the flooding burrow (<b>E</b>)', marker: 'dholeDen', check: (g, S) => S.flags.rescued,
      use: { id: 'dholeDen', prompt: 'Dig at the flooding burrow', act: (g, S) => { const gen = S.gen; g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 4 }; g.audio.splash(g.player.pos, 1); g.ui.toast('Digging…', 4); setTimeout(() => { if (S.gen === gen) { S.flags.rescued = true; S.checkNow(); } }, 4000); } },
      done: (g, S) => {
        const pup = g.eco.spawnOne('dhole', at('dholeDen', 1, 1.5), { companion: true, persistent: true, name: 'Chingari', scale: 0.6, bond: 1, hpMul: 2.2 });
        g.setCompanion(pup); g.flags.chingari = true; S.cast('chingari', pup); pup.mind.direct({ type: 'stay', calm: true });
        const pack = g.eco.spawnGroup('dhole', at('dholeDen', 30, 25), 4, { aggro: 0, persistent: true }).members; S.cast('lal', pack[0]);
        for (const d of pack) { d.bond = 0.7; d.keep = true; d.mind.direct({ type: 'watch', brave: true }); }
        const gen = S.gen; setTimeout(() => { if (S.gen === gen) for (const d of pack) S.sendAway(d, at('dholeDen', 200, 160), 'trot'); }, 16000);
        g.ui.addJournal('Chingari', "A dhole pup from a flooded den. The flood nearly got both of us, I suppose. She won't leave me alone now. (Hold Q → Dhole whistle to call her to you.)", 'story');
      },
      after: [['vanaj', 'Got you. Got you. By the scruff, the way Kaali carried me.'], ['lal', 'The two-legs. It took our pup out of the water.', 'low whistle'], ['vanaj', 'She could have had me, right there on the bank. She only watched.']] },
    { id: 'hold', quiet: true, text: 'Sit with the pup until she stops shaking (<b>E</b> beside her)', markerFn: companionPos, check: (g, S) => S.flags.calmPup,
      interact: { at: companionPos, r: 4.5, prompt: 'Hold the pup',
        act: (g, S) => { g.director.direct('chingari', { type: 'rest', calm: true }); sitBeat(g, S, 'calmPup', [['chingari', 'Cold! Cold cold cold!', 'thin squeak'], ['vanaj', "I know. I've got you."], 'She shook for a long time. Then she fell asleep with her nose under my arm.', ['vanaj', "Chingari. That's you. It means spark."], 'Someone carried me out of the water once. Now I had done it for someone else.'], { hum: true }).then(() => g.director.direct('chingari', { type: 'play' })); } },
      done: (g, S) => { const gen = S.gen; setTimeout(() => { if (S.gen === gen || g.director.actor('chingari')) g.director.direct('chingari', null); }, 14000); } },
  ],
  outro: ["I haven't been on my own since."],
});

chapter({
  id: 'c10', title: 'The Old Flood', act: 'Act III · Monsoon', season: 'monsoon', weather: 'cloudy', hour: 15.6, spawn: ['dholeDen', 160, 120],
  setup(g, S) { S.ensureChingari(); S.troop = g.eco.spawnGroup('langur', at('sandbar', 25, 15), 6).members; S.cast('troop', S.troop[0]); g.eco.blocked.add('tiger'); },
  intro: ['The river was huge now, brown and loud.', 'I followed the langurs to a fig tree that leans over a sandbar.'],
  objectives: [
    { id: 'sandbar', text: 'Follow the langurs to the old sandbar', marker: 'sandbar', reach: ['sandbar', 28],
      say: [['chingari', 'Water! Big water! Go? Go!', 'yip'], ['vanaj', 'We go round the big water, spark. Not through it.']] },
    { id: 'hoop', text: 'Something hard is sticking out of the sand. Dig it out', marker: 'sandbar', check: (g, S) => S.flags.clue_cartwheel,
      done: (g) => { g.ui.addJournal('The old sandbar', "Under the sand I found a rusty metal hoop with rotted spokes, a curved blade and a brass ring. I didn't know what any of it was, but it's the same kind of thing as my lota.", 'clue'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', 'A hoop, as tall as me, with rotted spokes. A curved blade. A little brass ring.'], ['vanaj', 'The same cold stuff as my lota. And my lota came out of this river.']] },
    { id: 'sit', quiet: true, text: 'Sit by the river where the sand gave it up (<b>E</b>)', marker: 'sandbar', check: (g, S) => S.flags.river,
      interact: { at: () => SITES.sandbar, r: 9, prompt: 'Sit by the river',
        act: (g, S) => { g.director.direct('chingari', { type: 'rest', calm: true }); sitBeat(g, S, 'river', ['It must have looked like this, that night.', "I don't remember the water. I only remember being carried.", ['vanaj', 'Whoever you were... I think you were mine.'], ['chingari', 'Sad? Lick. Better?', 'whine']], { hum: true, journal: ['Where the river took them', 'That hoop is where the river dropped it. Whoever owned the lota went into that water too. I think they were my people.'] }).then(() => g.director.direct('chingari', null)); } } },
    { id: 'night', text: 'Night. Torn-Ear has come down to the river. Drive him off with fire', tension: 1,
      async run(g, S, gen) {
        await g.ui.fade(true, 900); g.setTime(20.3); await g.ui.fade(false, 1200); if (S.gen !== gen) return;
        const P = g.player, p = P.pos, t = S.spawnTornEar(V3(p.x + 55, 0, p.z - 40));
        g.audio.animal('tiger', 'roar', t.pos, { big: true }); if (g.music) g.music.setCombat(0.6); S.scriptMusic = true;
        for (const l of S.troop || []) { l.alarmCD = 0; l.alarm(g.W, 'tiger'); }
        t.mind.direct({ type: 'prowl', around: P.pos, r: 16, brave: true, rate: 0.16 });
        g.talk.say([['tornear', 'You. The fire-cub from the den. You smell of the old wolf still.', 'rolling growl'], ['vanaj', 'She was worth ten of you.'], ['tornear', 'She was. Everything worth anything is gone. Only the loop stays.', 'groan'], ['chingari', 'Big! Too big! Bite it anyway?', 'growl-squeak']]);
        let pushes = 0, busy = false; const t0 = g.clock;
        const push = () => { if (busy || S.gen !== gen) return; busy = true; pushes++; const dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z, l = Math.hypot(dx, dz) || 1; g.audio.animal('tiger', 'snarl', t.pos, { big: true }); t.mind.show('sweat', 2);
          t.mind.direct({ type: 'goto', to: V3(P.pos.x + dx / l * 30, 0, P.pos.z + dz / l * 30), speed: 'run', brave: true, r: 3, then: (a) => { busy = false; a.mind.direct({ type: 'prowl', around: P.pos, r: Math.max(9, 15 - pushes * 2), brave: true, rate: 0.2 }); } }); };
        const offCall = g.on('call', (e) => { if (e.kind === 'roar' && (P.torchLit || g.nearFire) && t.dist2(P.pos) < 30 * 30) push(); else if (e.kind === 'roar') g.ui.toast('He only gives way to fire. Hold a torch (<b>6</b>) or stand by a campfire'); });
        const offHit = g.on('hit', (e) => { if (e.target === t) push(); });
        while (S.gen === gen && pushes < 3 && g.clock - t0 < 110) { await g.wait(0.25); if (P.dead) { offCall(); offHit(); return; } }
        offCall(); offHit(); if (S.gen !== gen) return;
        if (g.music) g.music.setCombat(0); S.scriptMusic = false;
        S.sendAway(t, V3(VILLAGE.x, 0, VILLAGE.z + 500));
        g.talk.say([['tornear', 'North, then. Where the slow fat ones stand in rows and nothing carries fire.', 'groan'], ['vanaj', 'North. He means the smoke. He means them.']]);
        S.next();
      } },
  ],
  outro: ['He went north, toward the edge of the forest, where the cattle are.', 'So did we.'],
  nextSeason: 'post',
  cleanup(g, S) { g.eco.blocked.delete('tiger'); S.scriptMusic = false; },
});

// ============================================================================================ ACT IV · AFTER THE RAINS
chapter({
  id: 'c11', title: 'The Tower', act: 'Act IV · After the Rains', season: 'post', weather: 'mist', hour: 6.6, spawn: ['shrine', 120, 240],
  setup(g, S) { S.ensureChingari(); g.ui.seeLore('banyan'); },
  intro: ['After the rains the grass grew over my head, and every morning the valleys filled with mist.', "Torn-Ear's tracks went north-west."],
  objectives: [
    { id: 'tracks', text: 'Follow the tracks north-west', marker: 'shrine', reach: ['shrine', 20] },
    { id: 'shrine', text: 'Look at the red stone under the saja', marker: 'shrine', check: (g, S) => S.flags.clue_shrine,
      done: (g) => g.ui.addJournal('Gifts under the saja', 'A red stone, a three-pointed fork, little clay horses, bangles and red cloth. Someone left these on purpose.', 'clue'),
      after: [['vanaj', 'A stone painted red. Bangles on a branch. Cloth tied round the trunk.'], ['vanaj', 'They came here to leave things. Not to take them.'], ['chingari', 'Smells of many. Many many. Not-forest.', 'sniffing']] },
    { id: 'tower', text: 'There is a tall wooden thing above the trees. Go to it', marker: 'tower', reach: ['tower', 9] },
    { id: 'ladder', text: 'Climb the ladder (<b>E</b>, then <b>W</b>)', marker: 'tower', check: (g, S) => S.flags.climbed || g.player.pos.y > SITES.tower.y + 6,
      cast: { chingari: (g) => ({ type: 'wait', at: at('tower', 3, 3) }) }, say: [['chingari', 'Up? No. No up. I wait.', 'whine']] },
    { id: 'box', text: 'Pick up the rattling box', marker: 'tower', check: (g, S) => S.flags.clue_towerItems,
      done: (g) => { g.inv.add('matches', 1); g.ui.addJournal('Fire in a box', 'On the tower I found a cloth cap, a bottle you can see through, and a little box of sticks that catch fire when you scrape them. No more sawing bamboo to start a fire.', 'clue'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', 'It rattles. Little sticks. If I scrape one on the side...'], ['vanaj', 'FIRE! In my hand! From nothing!'], 'I dropped it. Then I did it again. And again. I had never laughed like that before.'] },
    { id: 'north', text: 'Look north from the tower', check: (g, S) => S.lookedNorth,
      tick: (g, S, dt) => {
        const P = g.player; if (P.pos.y < SITES.tower.y + 6) { S.lookT = 0; return; }
        const ang = Math.atan2(VILLAGE.x - P.pos.x, -(VILLAGE.z - P.pos.z)), head = -P.yaw;
        let d = ang - head; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < 0.45) S.lookT = (S.lookT || 0) + dt; else S.lookT = 0;
        if (S.lookT > 1.5) S.lookedNorth = true;
      },
      done: (g) => { g.ui.addJournal('A place', 'From the top of the tower you can see smoke and, past the trees, square shapes with red tops.', 'clue'); if (g.music) g.music.stinger('clue'); },
      after: [['vanaj', 'Smoke, going straight up.'], ['vanaj', 'And past the trees, little square shapes with red tops.'], ['vanaj', 'They live there. They all live there, together.']] },
  ],
  outro: [],
});

chapter({
  id: 'c12', title: 'The Flute', act: 'Act IV · After the Rains', season: 'post', weather: 'clear', hour: 18.2, spawn: ['tower', -6, 8], village: true,
  setup(g, S) { S.ensureChingari(); S.spawnVillage(); },
  intro: ["Back in the summer I had started cutting whistles out of bamboo.", "I'd been trying to get the four notes out of them for months."],
  objectives: [
    { id: 'make', text: 'Make a bamboo flute (<b>Tab</b>)', check: (g) => g.inv.has('flute'), hint: 'One bamboo and a knife. Cut bamboo from a clump (<b>E</b>).' },
    { id: 'bank', text: 'Go down to the riverbank below the tower', marker: 'fluteSpot', reach: ['fluteSpot', 10] },
    { id: 'listen', quiet: true, text: 'Listen',
      async run(g, S, gen) {
        if (g.time.hour < 19.5) { await g.ui.fade(true, 900); g.setTime(20.2); await g.ui.fade(false, 1400); }
        if (S.gen !== gen || !await S.pause(gen, 3)) return;
        S.farFlute([0, 2, 4, 7, 4, 2, 0].map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 2.5 : 0.7, meend: i % 2 === 1 })));
        await g.talk.say([['chingari', 'Bird? Not bird.', 'ears up'], ['vanaj', "Not a bird. Not anything I know. It's one long breath, sliding from note to note."]]);
        if (S.gen === gen && await S.pause(gen, 3)) S.next();
      } },
    { id: 'answer', quiet: true, text: 'Answer it. (Hold <b>Q</b> → Four notes)', teach: ['wheel', 'flute'], check: (g, S) => S.flags.answered,
      async run(g, S, gen) {
        const off = g.on('call', (e) => { if (e.kind === 'flute' && g.player.pos.distanceTo(at('fluteSpot')) < 40) S.flags.played = true; });
        while (S.gen === gen && !S.flags.played) await g.wait(0.3);
        off(); if (S.gen !== gen || !await S.pause(gen, 6)) return;
        await g.talk.say([['vanaj', 'It stopped.']]);
        if (S.gen !== gen || !await S.pause(gen, 1.5)) return;
        S.farFlute(THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 1.6 : 0.6 })).concat([0, 2, 4, 7, 9, 7, 4, 2, 0].map((s, i, a) => ({ semi: s, dur: i === a.length - 1 ? 3.5 : 0.55, meend: i % 3 === 1 }))));
        if (!await S.pause(gen, 4)) return;
        await g.talk.say([['vanaj', 'My four notes. It played them back to me.'], ['vanaj', "And it kept going. There's more after them. I never knew there was more."], 'I had thought those notes were only mine. Somebody else knew them.']);
        if (S.gen === gen) { S.flags.answered = true; S.checkNow(); }
      } },
  ],
  outro: [],
});

chapter({
  id: 'c13', title: 'Torn-Ear', act: 'Act IV · After the Rains', season: 'post', weather: 'clear', hour: 6.4, spawn: ['sukhiSpot', 30, 40], village: true,
  setup(g, S) {
    S.ensureChingari(); S.spawnVillage();
    S.spawnSukhi(at('fields', 10, 0));
    S.cows = g.eco.spawnGroup('cow', at('fields'), 6, { persistent: true, radius: 25 }).members;
    g.eco.blocked.add('tiger');
  },
  intro: ['At first light I crossed the river and hid in the trees at the edge of the fields.', 'There was a boy out there with some cows. Smaller than me. Skinny. An actual person.'],
  objectives: [
    { id: 'watch', text: 'Watch the herd boy from the treeline', marker: 'fields', reach: ['fields', 95],
      say: [['vanaj', 'Two legs. Two hands. He walks like me, spark. He walks exactly like me.'], ['chingari', 'Small you! Go sniff?', 'yip'], ['vanaj', 'Not yet. Stay low.']] },
    { id: 'tiger', text: 'Torn-Ear is in the fields. Keep him off the boy and the herd', tension: 1,
      async run(g, S, gen) {
        const P = g.player, sukhi = S.sukhi;
        if (!await S.pause(gen, 4)) return;
        for (const a of g.eco.animals) if (a.sp === 'langur' || a.sp === 'peafowl') { a.alarmCD = 0; a.alarm(g.W, 'tiger'); }
        g.audio.animal('cow', 'alarm', sukhi.pos);
        const sp = sukhi.pos.clone().add(V3(-70, 0, 50));
        const t = S.spawnTornEar(sp, { aggro: 1, hpMul: 0.7 }); t.noRetreat = true; S.tiger = t;
        g.audio.animal('tiger', 'roar', t.pos, { big: true }); if (g.music) g.music.setCombat(1); S.scriptMusic = true;
        t.target = S.cows[0] || 'player'; t.setState('charge');
        // the boy runs for a tree and gets up it
        const near = g.veg.nearestTree(sukhi.pos.x, sukhi.pos.z, 70);
        sukhi.walkTo(near ? V3(near.x + 0.6, 0, near.z + 0.6) : V3(VILLAGE.x - 40, 0, VILLAGE.z + 60), true);
        const climbWhenThere = () => { if (S.gen !== gen) return; if (sukhi.path.length) return setTimeout(climbWhenThere, 400); if (near) sukhi.up = 2.4; sukhi.look = t.pos; };
        setTimeout(climbWhenThere, 1500);
        g.talk.say([['sukhi', 'Baagh! BAAGH!', 'a shout: you know that word from somewhere'], ['vanaj', "That's my tiger. That one's MINE!"]]);
        // when his nerve goes he does not run: he goes down in the grass, spent
        let down = false;
        t.onBeaten = (a) => { down = true; a.hp = 20; a.aggro = 0; a.target = null; a.keep = true; a.setState('idle', 999); a.scripted = (dt, W, an) => { an.targetSpeed = 0; an.anim.lie = Math.min(1, an.anim.lie + dt); }; return true; };
        while (S.gen === gen && !down) {
          await g.wait(0.25); if (P.dead) return;
          if (t.target !== 'player' && ((t.target && (t.target.dead || t.target.routed)) || P.pos.distanceTo(t.pos) < 30)) { t.target = 'player'; t.setState('charge'); }
          if (t.state === 'idle' || t.state === 'wander' || t.state === 'rest' || (t.state === 'retreat' && t.timer < 2)) { t.target = 'player'; t.aggro = 1; t.setState('charge'); }
        }
        if (S.gen !== gen) return;
        if (g.music) g.music.setCombat(0); S.scriptMusic = false;
        await g.talk.say([['tornear', 'Enough. I am old, cub. I was only ever hungry, and slow, because of the loop.', 'long groan'], 'He lay in the grass, breathing hard, with the bright loop still sunk in his leg.']);
        if (S.gen === gen) S.next();
      } },
    // the one choice of the story. It decides nothing but who he is.
    { id: 'choice', quiet: true, text: 'He is down. Kneel and work the wire loose (<b>E</b>), or roar him out of the valley (<b>Q</b>)', markerFn: (g, S) => S.tiger && S.tiger.pos, check: (g, S) => S.flags.chosen,
      onStart: (g, S) => { const gen = S.gen, off = g.on('call', async (e) => {
        if (S.gen !== gen || S.flags.choosing) return off();
        if (e.kind !== 'roar' || !S.tiger || S.tiger.dist2(g.player.pos) > 20 * 20) return;
        off(); S.flags.choosing = true; g.flags.tornEar = 'roar'; const t = S.tiger;
        t.scripted = null; t.onBeaten = null; t.anim.lie = 0; S.sendAway(t, at('fields', -420, 380), 'trot');
        await g.talk.say([['vanaj', 'GO! Out of this valley! Never come back!'], ['tornear', 'So. The cub has a pack to guard now.', 'low groan'], 'He dragged himself up and went, the loop still shining on his leg. I never saw him again.']);
        if (S.gen === gen) { S.flags.chosen = true; S.checkNow(); }
      }); },
      interact: { at: (g, S) => (S.tiger && !S.flags.choosing ? S.tiger.pos : null), r: 4.5, prompt: 'Kneel and work the wire loose',
        act: async (g, S) => {
          const gen = S.gen, t = S.tiger; S.flags.choosing = true; g.flags.tornEar = 'free';
          g.player.crouch = true; g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 5 };
          await g.talk.say([['vanaj', "Hold still. This is going to hurt. It's hurt you for years already."], ['tornear', '...', 'no sound at all']]);
          if (S.gen !== gen) return;
          if (t.wireRing) t.wireRing.visible = false; t.limp = 0.1; g.audio.pickup();
          await g.talk.say([['vanaj', "It's out. Look. It's out."], ['tornear', 'The loop. Twelve winters I have carried the loop.', 'long breath'], 'He got up, slowly. He looked at me for a while. Then he walked into the trees, and I never saw him again.']);
          if (S.gen !== gen) return;
          t.scripted = null; t.onBeaten = null; t.anim.lie = 0; S.sendAway(t, at('fields', -420, 380), 'walk');
          S.flags.chosen = true; S.checkNow();
        } },
      done: (g) => g.ui.addJournal("Torn-Ear's leg", "Those loops in Torn-Ear's leg were the first sign of people I ever found. People made them. He wasn't cruel. He was caught.", 'clue') },
  ],
  outro: ['Before I went to the village I walked back to the den one more time.', 'Grass had come up through the leaves where Kaali lay.', "I told her about the boy with the flute. I think she'd have liked him."],
  cleanup(g, S) { g.eco.blocked.delete('tiger'); S.scriptMusic = false; },
});

chapter({
  id: 'ep', quiet: true, title: 'The Name in the Steel', act: 'Epilogue', season: 'post', weather: 'clear', hour: 17.6, spawn: ['fields', -40, 30], village: true,
  setup(g, S) {
    S.ensureChingari(); S.spawnVillage();
    S.spawnSukhi(at('fields', -25, 15)); S.sukhi.up = 0; S.sukhi.path.length = 0;
    if (!g.inv.has('lota')) g.inv.add('lota', 1);
    g.world.village = 'meeting';
  },
  intro: ["The boy didn't run."],
  objectives: [
    { id: 'boy', text: 'Go to the boy', markerFn: (g, S) => S.sukhi.pos, check: (g, S) => g.player.pos.distanceTo(S.sukhi.pos) < 4,
      onStart: (g, S) => { S.sukhi.look = g.player.pos; },
      done: (g, S) => { S.sukhi.action = 'flute'; S.farFlute(THEME.map((s, i) => ({ semi: s, dur: i === 3 ? 1.8 : 0.6 })), S.sukhi.pos); setTimeout(() => { S.sukhi.action = null; g.audio.hum(); }, 5000); },
      after: [['sukhi', 'You chased off the tiger. I saw. From the tree. I saw all of it.', 'fast words: you catch "tiger"'], ['vanaj', '...'], 'He held his flute out to me, the way I hold fruit out to the langurs. Then he played the four notes, and I hummed them back.', ['sukhi', 'Vanaj! Forest-born. That is what you are. Come. Come on!', 'pointing at the trees, then at you'], ['chingari', 'Small you is nice! Keep?', 'tail going']] },
    { id: 'village', text: 'Follow Sukhi to the village', markerFn: (g, S) => S.sukhi.pos, reach: ['village', 30], onStart: (g, S) => { S.sukhi.walkTo(V3(VILLAGE.x + 4, 0, VILLAGE.z + 10)); },
      after: [['villager', 'Sukhi! Who is that? Whose child is that?', 'voices, all at once'], ['vanaj', "So many. I didn't know there could be so many."]] },
    { id: 'lota', text: 'Set the lota on the ground before the old woman (<b>E</b>)', markerFn: (g, S) => S.aaji && S.aaji.pos, check: (g, S) => S.flags.placedLota,
      onStart: (g, S) => { S.aaji.look = g.player.pos; },
      interact: { at: (g, S) => S.aaji && S.aaji.pos, r: 4, prompt: 'Set the lota on the ground',
        act: (g, S) => {
          g.inv.take('lota', 1); g.player.action = { type: 'gather', anim: 'gather', t: 0, dur: 1.6 };
          const P = g.player, m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.3 }));
          m.position.copy(P.pos).add(V3(-Math.sin(P.yaw) * 0.8, 0.1, -Math.cos(P.yaw) * 0.8)); g.scene.add(m); S.storyItems.push({ id: 'lotaSet', pos: m.position.clone(), mesh: m, taken: true });
          S.aaji.walkTo(m.position); S.aaji.look = P.pos; S.flags.placedLota = true; S.checkNow();
        } } },
  ],
  outro: [],
  async ending(g, S) {
    const gen = S.gen; g.uiBlocking = true;
    await g.wait(1.5);
    await g.talk.say(['An old woman picked it up and held it to the lamp.', 'There was a name scratched into the rim. Families here mark their steel that way.']);
    if (S.gen !== gen) return;
    g.ui.card('सुमित्रा', 'Sumitra', 6);
    await g.talk.say([['aaji', "Sumitra. My Sumitra's lota. The river took her twelve years ago. Her, and her husband, and...", 'a whisper'], ['aaji', '...and the little one.', 'looking at you']]);
    if (S.gen !== gen) return;
    if (g.music) g.music.stinger('ending');
    await g.talk.say(['She looked at me for a long time. Then she hummed four notes. Every mother in that village sings that lullaby.', 'I hummed the rest.', ['aaji', 'Mangalu.', 'both hands on your face']]);
    if (S.gen !== gen) return;
    g.ui.card('"Mangalu"', 'That was the first time I heard my name.', 7);
    await g.wait(8); if (S.gen !== gen) return;
    await g.ui.fade(true, 2500);
    const E = document.getElementById('ending'); E.classList.add('show');
    await g.wait(26);
    E.classList.remove('show'); g.world.village = 'home';
    for (const n of S.npcs) if (n !== S.aaji) n.scripted = false;
    await g.ui.fade(false, 2000);
    g.uiBlocking = false; g.requestLock();
    g.ui.setObjective('Free roam', `The forest and the village are both yours now. ${g.touch ? 'The leaf at the top changes the season.' : '<b>N</b> changes the season.'}`);
    S.done = true; g.save();
  },
});

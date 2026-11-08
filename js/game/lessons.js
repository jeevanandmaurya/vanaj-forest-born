// Teaching what Vanaj can do. A skill is taught by doing it: a short checklist appears under the objective, each line
// ticks itself off the moment the player does that thing, and the card goes away when it is finished. The first chapter's
// objectives walk through the basics; everything else comes up when it first matters (first time in deep water, first
// time on a rope, the first bleeding wound, the first bow). All of it stays listed in the journal.
const kbd = (k) => k.split(' ').map((x) => `<kbd>${x}</kbd>`).join('');
const swung = (P) => P.canopy.mode === 'hang' && P.canopy.vel.lengthSq() > 4;
const anyMove = (k) => k.KeyW || k.KeyA || k.KeyS || k.KeyD;

// keys, what to do, and how to tell it has been done: d(g, P, keys, L) polled each frame, or on: a game event
export const SKILLS = {
  // getting about
  move: { g: 'Moving', k: 'W A S D', t: 'Walk', d: (g, P, k) => P.onGround && P.speed > 1 && anyMove(k) },
  look: { g: 'Moving', k: 'Mouse', t: 'Look around', d: (g, P) => P.camUserT > 0 },
  run: { g: 'Moving', k: 'Shift', t: 'Hold to run. It tires you out', d: (g, P) => P.sprinting && P.speed > 4 },
  jump: { g: 'Moving', k: 'Space', t: 'Jump', d: (g, P, k, L) => !P.onGround && !P.canopy.mode && !P.swimming && P.vel.y > 2 },
  crouch: { g: 'Moving', k: 'C', t: 'Crouch. Animals notice you less', d: (g, P) => P.crouch },
  swim: { g: 'Moving', k: 'W A S D', t: 'Swim. It uses up stamina, so get out before it runs out', d: (g, P) => P.swimming && P.speed > 0.5 },
  view: { g: 'Moving', k: 'V', t: 'Switch between first and third person', d: (g, P, k, L) => P.view !== L.view0 },
  // hands
  gather: { g: 'Living', k: 'E', t: 'Pick up what you see on the ground', on: 'pickup' },
  pouch: { g: 'Living', k: 'Tab', t: 'Open your pouch', d: (g) => g.ui.open === 'inv' },
  craft: { g: 'Living', k: 'Tab', t: 'Make something from what you carry', on: 'craft' },
  drink: { g: 'Living', k: 'E', t: 'Drink at the water\'s edge', on: 'drink' },
  eatKey: { g: 'Living', k: 'B', t: 'Eat the best food you have', on: 'eat' },
  skin: { g: 'Living', k: 'E', t: 'Skin a kill with your knife', on: 'harvest' },
  fire: { g: 'Living', k: 'Tab', t: 'Make a campfire', on: 'campfire' },
  cook: { g: 'Living', k: 'E', t: 'Cook meat at a fire', on: 'cook' },
  sleep: { g: 'Living', k: 'E', t: 'Sleep by a fire. It saves your game', on: 'sleep' },
  bandage: { g: 'Living', k: 'H', t: 'Bind a bleeding wound (needs a leaf bandage)', on: 'bandaged' },
  map: { g: 'Living', k: 'M', t: 'Open the map', d: (g) => g.ui.open === 'map' },
  journal: { g: 'Living', k: 'J', t: 'Read your journal', d: (g) => g.ui.open === 'journal' },
  compass: { g: 'Living', k: 'Look', t: 'The diamond on the compass shows where to go', d: (g, P, k, L) => L.ids && L.ids.includes('compass') && L.t > 9 },
  alarms: { g: 'Living', k: 'Listen', t: 'Red marks on the compass are animal alarm calls. Something is hunting there', d: (g, P, k, L) => L.ids && L.ids.includes('alarms') && L.t > 9 },
  // fighting
  equip: { g: 'Fighting', k: '1 - 6', t: 'Switch what you\'re holding (or the mouse wheel)', d: (g, P, k, L) => g.inv.equipped !== L.held0 },
  attack: { g: 'Fighting', k: 'Left-click', t: 'Strike', d: (g, P) => P.action && /swing|stab|thrust|punch/.test(P.action.anim || P.action.type) },
  block: { g: 'Fighting', k: 'Right-click', t: 'Hold to block', d: (g, P) => P.blocking },
  dodge: { g: 'Fighting', k: 'Right-click Space', t: 'Dodge while blocking', d: (g, P) => P.dodgeT > 0 },
  sneak: { g: 'Fighting', k: 'C Left-click', t: 'Hit an animal that hasn\'t noticed you. It\'s a clean kill', on: 'kill' },
  finish: { g: 'Fighting', k: 'F', t: 'Finish off a badly hurt animal', d: (g, P) => P.action && P.action.type === 'finish' },
  spearThrow: { g: 'Fighting', k: 'Right-click Left-click', t: 'Aim the spear, then throw it', d: (g, P) => P.action && (P.action.anim || P.action.type) === 'throw' },
  bowDraw: { g: 'Fighting', k: 'Right-click Left-click', t: 'Aim the bow, hold left-click to draw, let go to shoot', d: (g, P) => P.weapon === 'bow' && P.draw > 0.5 },
  torch: { g: 'Fighting', k: '6', t: 'Hold a torch. Big cats and dholes keep back from it', d: (g) => g.inv.equipped === 'torch' },
  torchOff: { g: 'Fighting', k: 'T', t: 'Light it or put it out', d: (g, P, k, L) => g.inv.equipped === 'torch' && g.input.pressed('KeyT') },
  // calls
  wheel: { g: 'Calls', k: 'Q', t: 'Hold for the call wheel, move the mouse to pick, let go', d: (g) => g.wheelOpen },
  hum: { g: 'Calls', k: 'Q', t: 'Calm hum. Builds trust, crouched and with no weapon out', on: 'call', kind: 'hum' },
  whistle: { g: 'Calls', k: 'Q', t: 'Dhole whistle. Sends your companion at what you look at, or calls them back', on: 'call', kind: 'whistle' },
  cough: { g: 'Calls', k: 'Q', t: 'Langur cough. A false alarm that scatters prey', on: 'call', kind: 'langur' },
  roar: { g: 'Calls', k: 'Q', t: 'Roar. Drives off boar, dholes and leopards. Only fire stops a tiger', on: 'call', kind: 'roar' },
  flute: { g: 'Calls', k: 'Q', t: 'Play the four notes', on: 'call', kind: 'flute' },
  // in the trees
  climbStart: { g: 'Trees', k: 'Space', t: 'Face a big trunk and grab it', d: (g, P) => P.canopy.mode === 'trunk' },
  climbUp: { g: 'Trees', k: 'W S', t: 'Climb up or down. Shift goes faster', d: (g, P, k) => P.canopy.mode === 'trunk' && k.KeyW && P.vel.y > 0.5 },
  climbRound: { g: 'Trees', k: 'A D', t: 'Go round the trunk', d: (g, P, k) => P.canopy.mode === 'trunk' && (k.KeyA || k.KeyD) },
  treeTop: { g: 'Trees', k: 'W', t: 'Keep going, all the way to the top of the tree', on: 'treetop' },
  stepLimb: { g: 'Trees', k: 'E', t: 'Step out onto a branch beside you', d: (g, P) => P.canopy.mode === 'limb' },
  walkLimb: { g: 'Trees', k: 'W', t: 'Walk along it. S turns you round', d: (g, P) => P.canopy.mode === 'limb' && P.speed > 0.8 },
  leap: { g: 'Trees', k: 'Space', t: 'Jump off the branch', d: (g, P, k, L) => P.canopy.mode === 'air' && L.prev === 'limb' },
  lower: { g: 'Trees', k: 'C', t: 'Lower yourself to hang from the branch', d: (g, P, k, L) => P.canopy.mode === 'hang' && L.prev === 'limb' },
  catch: { g: 'Trees', k: 'Space', t: 'Hold in the air to catch a liana or branch. Keep holding or you let go', d: (g, P) => P.canopy.mode === 'hang' },
  pump: { g: 'Trees', k: 'W A S D', t: 'Throw your weight to swing the rope. Push in time with the swing', d: (g, P, k) => swung(P) && anyMove(k) && !k.ShiftLeft },
  ropeClimb: { g: 'Trees', k: 'Shift W', t: 'Hold Shift with W or S to climb up or down the rope', d: (g, P, k) => (P.canopy.mode === 'hang' || P.canopy.mode === 'rope') && k.ShiftLeft && (k.KeyW || k.KeyS) },
  letGo: { g: 'Trees', k: 'Space', t: 'Let go of Space mid-swing to fly', d: (g, P, k, L) => P.canopy.mode === 'air' && L.prev === 'hang' },
  pullUp: { g: 'Trees', k: 'E', t: 'Pull yourself up onto a thick branch', d: (g, P, k, L) => P.canopy.mode === 'limb' && L.prev === 'hang' },
  dropOff: { g: 'Trees', k: 'C', t: 'Drop', d: (g, P, k, L) => g.input.pressed('KeyC') && (L.prev === 'hang' || L.prev === 'rope') },
  rootGrab: { g: 'Trees', k: 'Space', t: 'Face a banyan root and grab it', d: (g, P) => P.canopy.mode === 'rope' },
  rootSwing: { g: 'Trees', k: 'W A S D', t: 'Throw your weight to swing the root', d: (g, P, k) => P.canopy.mode === 'rope' && anyMove(k) && !k.ShiftLeft },
  rootLeap: { g: 'Trees', k: 'Space', t: 'Jump off', d: (g, P, k, L) => P.canopy.mode === 'air' && L.prev === 'rope' },
};

// when something comes up for the first time, teach what goes with it
const MOMENTS = [
  { ids: ['swim'], title: 'Deep water', when: (g, P) => P.swimming },
  { ids: ['climbUp', 'climbRound', 'stepLimb', 'treeTop'], title: 'On a trunk', when: (g, P) => P.canopy.mode === 'trunk' },
  { ids: ['walkLimb', 'leap', 'lower'], title: 'On a branch', when: (g, P) => P.canopy.mode === 'limb' },
  { ids: ['pump', 'ropeClimb', 'letGo', 'dropOff'], title: 'On a rope', when: (g, P) => P.canopy.mode === 'hang' && P.canopy.hold && P.canopy.hold.kind === 'vine' },
  { ids: ['letGo', 'pullUp', 'dropOff'], title: 'Hanging', when: (g, P) => P.canopy.mode === 'hang' },
  { ids: ['rootSwing', 'ropeClimb', 'rootLeap'], title: 'On a banyan root', when: (g, P) => P.canopy.mode === 'rope' },
  { ids: ['bowDraw'], title: 'The bow', when: (g) => g.inv.equipped === 'bow' },
  { ids: ['spearThrow'], title: 'The spear', when: (g) => g.inv.equipped === 'spear' },
  { ids: ['torch', 'torchOff'], title: 'The torch', when: (g) => g.inv.has('torch') && g.sky.night > 0.5 },
  { ids: ['bandage'], title: 'You\'re bleeding', when: (g, P) => P.bleed > 0.2 && g.inv.has('bandage') },
  { ids: ['eatKey'], title: 'You\'re hungry', when: (g, P) => P.hunger < 45 && !g.story.entering },
  { ids: ['drink', 'compass'], title: 'You\'re thirsty', when: (g, P) => P.thirst < 45 },
  { ids: ['finish'], title: 'It\'s badly hurt', when: (g) => !!g.finishPromptFor() },
  { ids: ['wheel', 'whistle'], title: 'Your companion', when: (g, P, L) => g.companion && L.play > 240 },
  { ids: ['alarms'], title: 'Listen', when: (g) => g.ui.compassMarks.length > 0 },
  { ids: ['map', 'journal'], title: 'Finding your way', when: (g, P, L) => L.play > 300 },
  { ids: ['wheel', 'roar'], title: 'Something\'s after you', when: (g, P) => g.combatLevel > 0.4 },
];

export class Lessons {
  constructor(g) {
    this.g = g; this.done = new Set(); this.ids = null; this.title = ''; this.t = 0; this.play = 0; this.prev = null; this.seenMoment = new Set(); this.fromObjective = false; this.closeT = 0;
    const events = new Set(Object.values(SKILLS).map((s) => s.on).filter(Boolean));
    for (const ev of events) g.on(ev, (e) => {
      for (const [id, s] of Object.entries(SKILLS)) {
        if (s.on !== ev) continue;
        if (s.kind && e.kind !== s.kind) continue;
        if (id === 'sneak' && e.by !== 'player') continue;
        this.learn(id);
      }
    });
    this.el = document.getElementById('skillcard');
  }
  reset() { this.done.clear(); this.seenMoment.clear(); this.ids = null; this.fromObjective = false; this.render(); }
  has(...ids) { return ids.every((i) => this.done.has(i)); }
  // show this list until it is done (from an objective) or for a while (when something comes up)
  teach(ids, title = '', fromObjective = false) {
    if (ids.every((i) => this.done.has(i))) { if (fromObjective) { this.ids = null; this.render(); } return; }
    this.ids = ids; this.title = title; this.fromObjective = fromObjective; this.t = 0; this.closeT = 0; this.markers();
    this.render();
  }
  endObjective() { if (this.fromObjective) { this.fromObjective = false; this.t = 0; if (this.ids && this.ids.every((i) => this.done.has(i))) { this.ids = null; this.render(); } } }
  markers() { const g = this.g; this.view0 = g.player.view; this.held0 = g.inv.equipped; this.bandages = g.inv.count('bandage'); }
  learn(id) {
    if (this.done.has(id)) return;
    this.done.add(id);
    if (this.ids && this.ids.includes(id)) { this.g.audio.ui('tick'); this.render(); if (this.ids.every((i) => this.done.has(i))) this.closeT = 1.6; }
    this.g.emit('learned', { id });
  }
  update(dt) {
    const g = this.g, P = g.player, k = g.uiBlocking && !g.ui.open ? {} : g.input.keys;
    if (g.cinematic || P.dead) return;
    this.t += dt; this.play += dt;
    if (this.view0 === undefined) this.markers();
    // what the player has just done
    for (const id in SKILLS) { if (this.done.has(id)) continue; const s = SKILLS[id]; if (s.d && s.d(g, P, k, this)) this.learn(id); }
    const cm = P.canopy.mode; if (cm !== this.cur) { this.prev = this.cur || null; this.cur = cm; this.prevT = 0.4; } else if ((this.prevT -= dt) <= 0) this.prev = null;
    // what has come up
    if (!this.fromObjective || !this.ids) {
      this.momT = (this.momT || 0) - dt;
      if (this.momT <= 0) {
        this.momT = 0.3;
        for (let i = 0; i < MOMENTS.length; i++) {
          const M = MOMENTS[i]; if (this.seenMoment.has(i)) continue;
          if (M.ids.every((x) => this.done.has(x))) { this.seenMoment.add(i); continue; }
          if (M.when(g, P, this)) { this.seenMoment.add(i); this.teach(M.ids, M.title); break; }
        }
      }
    }
    // a finished card lingers a moment; one that came up unasked steps aside after a while
    if (this.ids) {
      if (this.closeT > 0 && (this.closeT -= dt) <= 0) { this.ids = null; this.fromObjective = false; this.render(); }
      else if (!this.fromObjective && this.t > 26) { this.ids = null; this.render(); }
    }
  }
  render() {
    const e = this.el; if (!e) return;
    if (!this.ids) { e.innerHTML = ''; e.classList.remove('on'); return; }
    e.classList.add('on');
    e.innerHTML = (this.title ? `<h5>${this.title}</h5>` : '') + this.ids.map((i) => { const s = SKILLS[i], d = this.done.has(i); return `<div class="sk${d ? ' done' : ''}"><i>${d ? '✓' : ''}</i>${kbd(s.k)}<span>${s.t}</span></div>`; }).join('');
  }
  // the journal's list of everything he can do
  list() {
    const groups = {}; for (const [id, s] of Object.entries(SKILLS)) (groups[s.g] = groups[s.g] || []).push([id, s]);
    return Object.entries(groups).map(([g, rows]) => `<h4>${g}</h4>` + rows.map(([id, s]) => `<div class="sk${this.done.has(id) ? ' done' : ''}"><i>${this.done.has(id) ? '✓' : ''}</i>${kbd(s.k)}<span>${s.t}</span></div>`).join('')).join('');
  }
}

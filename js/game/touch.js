// Touch controls for phones and tablets. A floating joystick on the left half (each finger tracked by its own
// touch id, the stick centred where the thumb lands, its throw clamped), drag-to-look on the right half, and
// buttons for the discrete actions. Buttons send the same keyboard and mouse events the game already handles, so
// every action has one code path. Jump/Grab is held to keep a grip in the trees and released to let go: the
// one-touch scheme of vine-swinging games.
import { icon } from './icons.js';
import { iconFor } from './ui.js';

const BTN = [
  // id, what it is called, key or mouse button, right and bottom edges and size (in units of --u, which follows the screen), hold (true = held while pressed)
  ['jump', 'Jump and grab', 'Space', 0, 0, 1.35, true],
  ['strike', 'Strike', 'mouse0', 1.5, 0.05, 1.15, true],
  ['crouch', 'Crouch', 'KeyC', 2.8, 0, 0.85, false],
  ['aim', 'Aim or block', 'mouse2', 1.45, 1.3, 0.95, true],
  ['use', 'Use', 'KeyE', 0.2, 1.5, 1, false],
  ['weapon', 'Change what you hold', 'nextWeapon', 2.6, 1.05, 0.9, false],
  ['call', 'Call', 'wheel', 2.6, 2.05, 0.8, false],
  ['climb', 'Climb', 'climb', 0.2, 2.6, 0.9, true],   // only in the trees: stick up or down with it held climbs a rope
];
const TOP = [['bag', 'Bag', 'Tab'], ['notes', 'Notes', 'KeyJ'], ['menu', 'Pause', 'Escape']];   // (the map: tap the minimap)

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || new URLSearchParams(location.search).has('touch');
}

// Full screen, on phones and computers alike. (An iPhone's browser has none. A browser only allows it from a tap or a click.)
export const canFullscreen = () => !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
export const isFullscreen = () => !!document.fullscreenElement || ['fullscreen', 'standalone'].some((m) => window.matchMedia && matchMedia(`(display-mode: ${m})`).matches);
export function goFullscreen() {
  const lock = () => { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not on this device: held by hand, then */ } };
  const p = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  return p && p.then ? p.then(lock, () => {}) : (lock(), Promise.resolve());
}

export class TouchControls {
  constructor(game) {
    this.g = game; this.stick = null; this.look = null;
    const root = this.root = document.createElement('div'); root.id = 'touch';
    root.innerHTML = '<div class="tzone tleft"></div><div class="tzone tright"></div><div class="tstick"><div class="tknob"></div></div><div class="tbtns"></div><div class="ttop"></div><div class="tmini" aria-label="Map"></div>';
    document.body.appendChild(root);
    const css = document.createElement('style');
    css.textContent = `
      body.touch { --u:clamp(46px, 15vmin, 64px); --edge:max(8px, env(safe-area-inset-left)); }
      #touch { position:fixed; inset:0; z-index:20; pointer-events:none; display:none; touch-action:none; user-select:none; -webkit-user-select:none; }
      #touch.show { display:block; }
      #touch .tzone { position:absolute; top:0; bottom:0; pointer-events:auto; }
      #touch .tleft { left:0; width:45%; } #touch .tright { right:0; width:55%; }
      /* the stick rests where the thumb expects it, and comes to the thumb wherever it lands */
      #touch .tstick { position:absolute; left:calc(var(--edge) + 76px); top:calc(100% - 92px); width:128px; height:128px; margin:-64px 0 0 -64px; border-radius:50%; border:2px solid rgba(240,230,205,.32); background:rgba(18,15,10,.2); opacity:.55; transition:opacity .15s; }
      #touch .tstick.held { opacity:1; }
      #touch .tknob { position:absolute; left:50%; top:50%; width:56px; height:56px; margin:-28px 0 0 -28px; border-radius:50%; background:rgba(240,230,205,.6); }
      #touch .tbtns { position:absolute; right:max(14px, env(safe-area-inset-right)); bottom:max(12px, env(safe-area-inset-bottom)); width:0; height:0; }
      #touch .tb { position:absolute; width:calc(var(--u) * var(--s)); height:calc(var(--u) * var(--s)); right:calc(var(--u) * var(--x)); bottom:calc(var(--u) * var(--y)); border-radius:50%; background:rgba(18,15,10,.42); border:2px solid rgba(240,230,205,.5); color:#f2e8d2; display:flex; align-items:center; justify-content:center; pointer-events:auto; }
      #touch .tb .ic { width:50%; height:50%; }
      /* (the button itself takes the touch: a picture swapped under the finger would take the finger-up with it, and the button would stay pressed for good) */
      #touch .tb *, #touch .tt * { pointer-events:none; }
      #touch .tb.on { background:rgba(232,149,58,.6); border-color:#f6d3a2; }
      #touch .tb.climb { display:none; } #touch.trees .tb.climb { display:flex; }
      /* Use wakes up when there is something to use */
      #touch .tb.use { opacity:.45; } body.can-use #touch .tb.use { opacity:1; background:rgba(232,149,58,.55); border-color:#f6d3a2; }
      #touch .tb.weapon img { width:62%; height:62%; }
      #touch .tb.weapon b { position:absolute; right:-3px; bottom:-3px; min-width:20px; height:20px; padding:0 4px; border-radius:10px; background:#e8953a; color:#201408; font:700 12px/20px Karla, sans-serif; text-align:center; }
      #touch .tb.weapon b:empty { display:none; }
      #touch .ttop { position:absolute; right:max(8px, env(safe-area-inset-right)); top:max(6px, env(safe-area-inset-top)); display:flex; gap:5px; }
      #touch .tt { pointer-events:auto; width:38px; height:38px; border-radius:10px; background:rgba(18,15,10,.5); border:1px solid rgba(240,230,205,.32); color:#f2e8d2; display:flex; align-items:center; justify-content:center; }
      #touch .tt .ic { width:21px; height:21px; } #touch .tt.on { background:rgba(232,149,58,.6); }
      /* the HUD for a phone held sideways: small, round the edges, the middle left for the game */
      /* the minimap in the corner, what to do beside it */
      body.touch #minimap, #touch .tmini { left:var(--edge); top:6px; width:96px; height:96px; } #touch .tmini { position:absolute; border-radius:50%; pointer-events:auto; }
      body.touch #objective-box { box-sizing:border-box; left:calc(var(--edge) + 102px); top:6px; max-width:min(23vw, 230px); padding:5px 9px; }
      body.touch #objective { font-size:13px; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; } body.touch #chapter { display:none; }
      body.touch #skillcard { margin-top:4px; padding-top:4px; max-height:30vh; overflow:hidden; }
      body.touch #skillcard h5, body.touch #skillcard .sk.done, body.touch #skillcard .sk i { display:none; }
      body.touch .sk { font-size:11px; margin:2px 0; } body.touch .sk kbd { display:inline-flex; font-size:10px; padding:1px 4px; } body.touch .sk kbd .ic { width:14px; height:14px; }
      body.touch #clock { right:calc(max(8px, env(safe-area-inset-right)) + 133px); top:6px; height:38px; padding:0 8px; } body.touch #clock b { font-size:13px; } body.touch #clock span { display:none; }
      body.touch #compass { top:8px; width:min(26vw, 240px); margin-left:calc(min(26vw, 240px) / -2); height:34px; }
      @media (max-width: 860px) { body.touch #objective-box { max-width:18vw; } body.touch #objective { font-size:12px; } body.touch #compass { top:48px; width:150px; margin-left:-75px; } body.touch #toasts { top:84px; } }
      body.touch #stats { left:50%; bottom:max(6px, env(safe-area-inset-bottom)); width:min(32vw, 290px); transform:translateX(-50%); padding:5px 8px; }
      body.touch #weapon { display:none; }
      body.touch #subtitle { font-size:15px; line-height:1.25; width:46vw; bottom:84px; }
      /* what Use would do, beside it */
      body.touch #prompt { font-size:13px; left:auto; top:auto; transform:none; right:calc(max(14px, env(safe-area-inset-right)) + var(--u) * 0.1); bottom:calc(var(--u) * 2.75); max-width:40vw; white-space:normal; text-align:right; }
      body.touch.in-trees #prompt { bottom:calc(var(--u) * 3.7); }
      body.touch #toasts { top:50px; bottom:auto; right:auto; left:50%; transform:translateX(-50%); width:44vw; align-items:center; font-size:12px; }
      body.touch #card h1 { font-size:34px; } body.touch #card { top:26vh; }
      body.touch #wheel { pointer-events:auto; z-index:25; }
      @media (max-height: 560px) { body.touch #wheel { transform:scale(.68); } }
      body.touch #title .foot { display:none; }
      body.touch .kbhint, body.touch kbd { display:none; }
      body.touch .sk kbd { display:inline-flex; }
      /* held upright the game goes on: the bars above the buttons, and the stick clear of them */
      @media (orientation: portrait) { body.touch #stats { bottom:calc(var(--u) * 3.3); width:64vw; } body.touch #clock { display:none; } body.touch #objective-box { left:var(--edge); top:108px; max-width:60vw; } body.touch #compass { top:64px; } body.touch #toasts { top:104px; width:80vw; } body.touch #touch .tstick { top:calc(100% - var(--u) * 5.2); } body.touch #compass { width:150px; margin-left:-75px; } body.touch #subtitle { width:84vw; bottom:calc(var(--u) * 4.4); } }
      body.touch #perf { right:max(8px, env(safe-area-inset-right)); left:auto; top:50px; bottom:auto; transform:scale(.55); transform-origin:top right; }
      /* a word, in passing, when the phone is held upright */
      #turn { position:fixed; left:50%; top:calc(max(10px, env(safe-area-inset-top)) + 96px); transform:translateX(-50%); z-index:58; display:flex; align-items:center; gap:8px; padding:5px 12px 5px 9px; border-radius:16px; background:rgba(16,15,12,.6); color:#ebe3d0; font:italic 500 15px 'Cormorant Garamond', Georgia, serif; white-space:nowrap; pointer-events:none; opacity:0; transition:opacity .6s; }
      #turn.show { opacity:1; }
      #turn svg { width:18px; height:18px; animation:vj-turn 2.2s ease-in-out infinite; }
      @keyframes vj-turn { 0%, 25% { transform:rotate(0); } 60%, 100% { transform:rotate(-90deg); } }`;
    document.head.appendChild(css);
    // (sizes in CSS, from the screen as it is now: worked out once at loading, they were wrong after going full screen or turning the phone)
    const box = root.querySelector('.tbtns');
    this.btn = {};
    for (const [id, name, key, x, y, sz, hold] of BTN) {
      const b = document.createElement('div'); b.className = 'tb ' + id; b.setAttribute('aria-label', name); b.innerHTML = icon(id === 'weapon' ? 'fist' : id);
      b.style.setProperty('--x', x); b.style.setProperty('--y', y); b.style.setProperty('--s', sz);
      box.appendChild(b); this.btn[id] = b; this.bindButton(b, key, hold);
    }
    const top = root.querySelector('.ttop');
    for (const [id, name, key] of TOP) { const b = document.createElement('div'); b.className = 'tt'; b.setAttribute('aria-label', name); b.innerHTML = icon(id); top.appendChild(b); this.bindButton(b, key, false); }
    this.bindButton(root.querySelector('.tmini'), 'KeyM', false);   // (tap the minimap for the big map)
    this.bindStick(root.querySelector('.tleft'), root.querySelector('.tstick'), root.querySelector('.tknob'));
    this.bindLook(root.querySelector('.tright'));
    document.body.classList.add('touch');
    game.touch = true;
    // (the computer's own buttons and clickable minimap, set up before it was known this is a touch screen; the touch controls have their own)
    { const bar = document.getElementById('deskbar'), mini = document.getElementById('minimap'); if (bar) bar.remove(); if (mini) { mini.classList.remove('click'); mini.onclick = mini.onmousedown = null; mini.removeAttribute('title'); } }
    const hint = document.getElementById('title-hint'); if (hint) hint.textContent = 'Tap anywhere to hear the flute';
    this.setupLandscape();
    this.setupWheel();
  }
  show(on) {
    this.root.classList.toggle('show', on);
    const P = this.g.player; if (on && P) this.root.classList.toggle('trees', !!P.canopy.mode && P.canopy.mode !== 'air');
  }
  // what the buttons show follows what he holds and what is at hand (from the HUD's slower update)
  sync() {
    const g = this.g, inv = g.inv, w = inv.equipped;
    if (w !== this._w) {
      this._w = w;
      this.btn.weapon.innerHTML = (w === 'fists' || !w ? icon('fist') : `<img src="${iconFor(w)}" alt="">`) + '<b></b>';
      this.btn.aim.innerHTML = icon(w === 'bow' || w === 'spear' ? 'aim' : 'shield');
    }
    const n = w === 'bow' ? inv.count('arrow') : w === 'spear' ? inv.count('spear') : '', b = this.btn.weapon.querySelector('b');
    if (b && n !== this._n) { b.textContent = n; this._n = n; }
    const can = !!g.ui._prompt; if (can !== this._can) { document.body.classList.toggle('can-use', can); this._can = can; }
    const tr = this.root.classList.contains('trees'); if (tr !== this._tr) { document.body.classList.toggle('in-trees', tr); this._tr = tr; }
  }
  // A phone game wants the phone sideways, but nothing stops play for it: held upright the game goes on, and a small note says so for
  // a few seconds and goes. (Full screen, which also locks the screen sideways where the browser allows it, is offered when loading
  // is done: js/main.js.) Nothing shows until then: noteTurn() is called when the title comes up.
  setupLandscape() {
    const note = document.createElement('div'); note.id = 'turn';
    note.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"><rect x="20" y="6" width="24" height="52" rx="4"/><path d="M29 50h6"/></svg><span>Turn your phone sideways</span>';
    document.body.appendChild(note);
    const portrait = window.matchMedia('(orientation: portrait)');
    let timer = 0;
    this.noteTurn = () => {
      clearTimeout(timer);
      const on = !!this.g.started && portrait.matches;
      note.classList.toggle('show', on);
      if (on) timer = setTimeout(() => note.classList.remove('show'), 6000);
    };
    if (portrait.addEventListener) portrait.addEventListener('change', this.noteTurn); else window.addEventListener('resize', this.noteTurn);
  }
  // the call wheel by touch: tap Call to open it, tap a call to make it, tap anywhere else to close it
  setupWheel() {
    const w = document.getElementById('wheel');
    const shut = () => { this.key('KeyQ', false); };
    // (a tap anywhere off it closes it too: on a short screen the wheel is drawn smaller and does not reach the edges. The finger that opened it, lifted from Call, does not count.)
    window.addEventListener('touchend', (e) => { if (!this.g.wheelOpen || w.contains(e.target) || this.root.contains(e.target)) return; this.g.ui.wheelSel = null; shut(); });
    w.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation();
      const opt = e.target.closest && e.target.closest('.wopt'), U = this.g.ui;
      U.wheelSel = opt ? U.wheelOpts.find((o) => o.el === opt) || null : null;
      shut();
    }, { passive: false });
  }
  key(code, down) {
    if (code === 'wheel') { if (down && !this.g.wheelOpen) this.key('KeyQ', true); return; }
    if (code === 'nextWeapon') { if (down) this.g.input.wheel += 1; return; }
    // Climb: Shift for the climbing, and a grip as well, since one thumb can't hold both it and Jump/Grab
    if (code === 'climb') { this.climbing = down; const k = this.g.input.keys; k.ShiftLeft = down; k.Space = down; return; }
    if (code === 'KeyE' && down && !this.g.currentInteraction && this.g.finishPromptFor && this.g.finishPromptFor()) code = 'KeyF';
    if (code.startsWith('mouse')) {
      const b = +code.slice(5), I = this.g.input;
      I.buttons[b] = down; if (down) I.mdown.add(b);
      return;
    }
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
  }
  bindButton(el, code, hold) {
    let id = null;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (id !== null) return; id = e.changedTouches[0].identifier; el.classList.add('on'); this.key(code, true); if (!hold) setTimeout(() => this.key(code, false), 60); if (navigator.vibrate) navigator.vibrate(8); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; el.classList.remove('on'); if (hold) this.key(code, false); } };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  // movement stick: centred where the thumb lands; pushed hard, it sprints
  bindStick(zone, ring, knob) {
    const R = 52;
    const set = (dx, dy) => {
      const keys = this.g.input.keys, P = this.g.player;   // (the game replaces the key table when the window loses focus)
      const m = Math.hypot(dx, dy), k = m > R ? R / m : 1, nx = dx * k / R, ny = dy * k / R;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      keys.KeyW = ny < -0.35; keys.KeyS = ny > 0.35; keys.KeyA = nx < -0.35; keys.KeyD = nx > 0.35;
      // pushed hard forward, he runs; in the trees that is the Climb button's job
      if (!this.climbing) keys.ShiftLeft = m > R * 1.15 && ny < -0.5 && !(P && P.canopy.mode);
    };
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault(); if (this.stick) return;
      const t = e.changedTouches[0]; this.stick = { id: t.identifier, x: t.clientX, y: t.clientY };
      Object.assign(ring.style, { left: t.clientX + 'px', top: t.clientY + 'px' }); ring.classList.add('held'); set(0, 0);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault(); const s = this.stick; if (!s) return;
      for (const t of e.changedTouches) if (t.identifier === s.id) set(t.clientX - s.x, t.clientY - s.y);
    }, { passive: false });
    const end = (e) => { const s = this.stick; if (!s) return; for (const t of e.changedTouches) if (t.identifier === s.id) { this.stick = null; ring.style.left = ring.style.top = ''; ring.classList.remove('held'); set(0, 0); } };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
  }
  // look: drag on the right half turns the camera, continuously while the finger moves
  bindLook(zone) {
    zone.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.look) return; const t = e.changedTouches[0]; this.look = { id: t.identifier, x: t.clientX, y: t.clientY }; }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault(); const L = this.look; if (!L) return;
      for (const t of e.changedTouches) if (t.identifier === L.id) { this.g.input.mdx += (t.clientX - L.x) * 1.6; this.g.input.mdy += (t.clientY - L.y) * 1.6; L.x = t.clientX; L.y = t.clientY; }
    }, { passive: false });
    const end = (e) => { const L = this.look; if (!L) return; for (const t of e.changedTouches) if (t.identifier === L.id) this.look = null; };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
  }
}

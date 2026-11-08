// Touch controls for phones and tablets. A floating joystick on the left half (each finger tracked by its own
// touch id, the stick centred where the thumb lands, its throw clamped), drag-to-look on the right half, and
// buttons for the discrete actions. Buttons send the same keyboard and mouse events the game already handles, so
// every action has one code path. Jump/Grab is held to keep a grip in the trees and released to let go: the
// one-touch scheme of vine-swinging games.
const BTN = [
  // id, label, key or mouse button, x/y from the bottom-right (in button units), hold (true = held while pressed)
  ['jump', 'Jump\nGrab', 'Space', 0, 0, true, 1.35],
  ['atk', 'Strike', 'mouse0', 1.25, 0.15, true, 1],
  ['aim', 'Aim', 'mouse2', 1.15, 1.25, true, 0.85],
  ['use', 'Use', 'KeyE', 0.1, 1.3, false, 0.85],
  ['crouch', 'Crouch', 'KeyC', 2.35, 0.1, false, 0.8],
  ['call', 'Call', 'wheel', 2.2, 1.2, false, 0.8],
  ['climb', 'Climb', 'climb', 0.1, 2.3, true, 0.85],   // only in the trees: stick up or down with it held climbs a rope
];
const TOP = [['bag', 'Bag', 'Tab'], ['map', 'Map', 'KeyM'], ['journal', 'Notes', 'KeyJ'], ['weapon', 'Weapon', 'nextWeapon'], ['menu', '❚❚', 'Escape']];

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || new URLSearchParams(location.search).has('touch');
}

export class TouchControls {
  constructor(game) {
    this.g = game; this.stick = null; this.look = null;
    const root = this.root = document.createElement('div'); root.id = 'touch';
    root.innerHTML = '<div class="tzone tleft"></div><div class="tzone tright"></div><div class="tstick"><div class="tknob"></div></div><div class="tbtns"></div><div class="ttop"></div>';
    document.body.appendChild(root);
    const css = document.createElement('style');
    css.textContent = `
      #touch { position:fixed; inset:0; z-index:20; pointer-events:none; display:none; touch-action:none; user-select:none; -webkit-user-select:none; }
      #touch.show { display:block; }
      #touch .tzone { position:absolute; top:0; bottom:0; pointer-events:auto; }
      #touch .tleft { left:0; width:45%; } #touch .tright { right:0; width:55%; }
      #touch .tstick { position:absolute; width:128px; height:128px; margin:-64px 0 0 -64px; border-radius:50%; border:2px solid rgba(240,230,205,.35); background:rgba(20,16,10,.18); display:none; }
      #touch .tknob { position:absolute; left:50%; top:50%; width:56px; height:56px; margin:-28px 0 0 -28px; border-radius:50%; background:rgba(240,230,205,.55); }
      #touch .tbtns { position:absolute; right:max(18px, env(safe-area-inset-right)); bottom:max(14px, env(safe-area-inset-bottom)); width:0; height:0; }
      #touch .tb.climb { display:none; } #touch.trees .tb.climb { display:flex; }
      #touch .tb { position:absolute; border-radius:50%; background:rgba(20,16,10,.38); border:2px solid rgba(240,230,205,.45); color:#f2e8d2; font:600 13px Karla, sans-serif; display:flex; align-items:center; justify-content:center; text-align:center; white-space:pre; pointer-events:auto; }
      #touch .tb.on { background:rgba(211,149,74,.55); border-color:#f2c890; }
      #touch .ttop { position:absolute; left:50%; top:max(6px, env(safe-area-inset-top)); transform:translateX(-50%); display:flex; gap:6px; }
      #touch .tt { pointer-events:auto; min-width:44px; height:34px; padding:0 8px; border-radius:8px; background:rgba(20,16,10,.45); border:1px solid rgba(240,230,205,.4); color:#f2e8d2; font:600 12px Karla, sans-serif; display:flex; align-items:center; justify-content:center; }
      /* the HUD, laid out for a phone held sideways: everything small, round the edges, the middle left for the game */
      body.touch #objective-box { left:max(8px, env(safe-area-inset-left)); top:6px; max-width:min(29vw, 260px); padding:5px 9px 6px; border-radius:9px; }
      body.touch #objective { font-size:13px; line-height:1.2; } body.touch #chapter { display:none; }
      body.touch #skillcard { margin-top:4px; padding-top:4px; max-height:44vh; overflow:hidden; }
      body.touch #skillcard h5 { display:none; }
      body.touch #skillcard .sk.done { display:none; }
      body.touch .sk { font-size:11px; margin:2px 0; } body.touch .sk i { display:none; } body.touch .sk kbd { display:inline-block; font-size:10px; padding:0 4px; }
      body.touch #clock { right:max(8px, env(safe-area-inset-right)); top:6px; padding:2px 8px 3px; } body.touch #clock b { font-size:14px; } body.touch #clock span { display:none; }
      body.touch #compass { top:44px; width:200px; margin-left:-100px; height:30px; }
      body.touch #stats { left:max(8px, env(safe-area-inset-left)); top:auto; bottom:6px; width:150px; padding:8px 8px 5px; transform:scale(.72); transform-origin:left bottom; }
      body.touch #weapon { display:none; }
      body.touch #subtitle { font-size:15px; line-height:1.25; width:58vw; bottom:12vh; }
      body.touch #prompt { font-size:12px; top:auto; bottom:30vh; }
      body.touch #toasts { top:78px; bottom:auto; right:auto; left:50%; transform:translateX(-50%); width:46vw; align-items:center; font-size:12px; }
      body.touch #card h1 { font-size:34px; } body.touch #card { top:26vh; }
      body.touch #wheel { pointer-events:auto; z-index:25; }
      @media (max-height: 560px) { body.touch #wheel { transform:scale(.68); } }
      body.touch #title .foot { display:none; }
      body.touch .kbhint, body.touch kbd { display:none; }
      body.touch .sk kbd { display:inline-block; }
      /* please turn sideways */
      #rotate { position:fixed; inset:0; z-index:70; display:none; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:24px; text-align:center; background:#efe3c8; color:#2a2018; font:400 20px Kalam, Georgia, serif; }
      #rotate.show { display:flex; }
      #rotate svg { width:84px; height:84px; animation:vj-turn 2.2s ease-in-out infinite; }
      @keyframes vj-turn { 0%, 25% { transform:rotate(0); } 60%, 100% { transform:rotate(-90deg); } }
      #rotate button { margin-top:6px; background:none; border:1px solid rgba(42,32,24,.5); border-radius:6px; color:inherit; padding:7px 14px; font:inherit; font-size:14px; }`;
    document.head.appendChild(css);
    const U = Math.min(64, Math.max(46, Math.min(innerWidth, innerHeight) * 0.15));   // buttons fit narrow phones
    const box = root.querySelector('.tbtns');
    for (const [id, label, key, x, y, hold, sz] of BTN) {
      const b = document.createElement('div'); b.className = 'tb'; b.textContent = label;
      const d = U * sz; Object.assign(b.style, { width: d + 'px', height: d + 'px', right: (x * U * 1.05) + 'px', bottom: (y * U * 1.05) + 'px' });
      box.appendChild(b); this.bindButton(b, key, hold);
    }
    const top = root.querySelector('.ttop');
    for (const [id, label, key] of TOP) { const b = document.createElement('div'); b.className = 'tt'; b.textContent = label; top.appendChild(b); this.bindButton(b, key, false); }
    box.querySelector('.tb:last-child').classList.add('climb');
    this.bindStick(root.querySelector('.tleft'), root.querySelector('.tstick'), root.querySelector('.tknob'));
    this.bindLook(root.querySelector('.tright'));
    document.body.classList.add('touch');
    game.touch = true;
    const hint = document.getElementById('title-hint'); if (hint) hint.textContent = 'Tap anywhere to hear the flute';
    this.setupLandscape();
    this.setupWheel();
  }
  show(on) {
    this.root.classList.toggle('show', on);
    const P = this.g.player; if (on && P) this.root.classList.toggle('trees', !!P.canopy.mode && P.canopy.mode !== 'air');
  }
  // A phone game wants the phone sideways. Where the browser allows it (Android), going fullscreen on the first tap lets us
  // lock the screen to landscape. Where it does not (iPhone), we ask: a card over the game until the phone is turned, with
  // the game held still behind it. (Browsers only allow fullscreen from a tap.)
  setupLandscape() {
    const g = this.g, card = document.createElement('div'); card.id = 'rotate';
    card.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><rect x="20" y="6" width="24" height="52" rx="4"/><path d="M29 51h6"/></svg><div>Turn your phone sideways to play</div><button>Stay upright</button>';
    document.body.appendChild(card);
    const portrait = window.matchMedia('(orientation: portrait)');
    let declined = false;
    const check = () => { const on = portrait.matches && !declined; card.classList.toggle('show', on); g.rotateHold = on; if (g.resize && g.composer) g.resize(); };
    if (portrait.addEventListener) portrait.addEventListener('change', check); else window.addEventListener('resize', check);
    card.querySelector('button').addEventListener('click', () => { declined = true; check(); });
    const ask = () => {
      const el = document.documentElement, go = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      const lock = () => { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not on this phone: the card asks instead */ } };
      if (go && go.then) go.then(lock).catch(lock); else lock();
    };
    window.addEventListener('touchend', ask, { once: true, capture: true });
    check();
  }
  // the call wheel by touch: tap Call to open it, tap a call to make it, tap anywhere else to close it
  setupWheel() {
    const w = document.getElementById('wheel');
    const shut = () => { this.key('KeyQ', false); };
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
      Object.assign(ring.style, { display: 'block', left: t.clientX + 'px', top: t.clientY + 'px' }); set(0, 0);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault(); const s = this.stick; if (!s) return;
      for (const t of e.changedTouches) if (t.identifier === s.id) set(t.clientX - s.x, t.clientY - s.y);
    }, { passive: false });
    const end = (e) => { const s = this.stick; if (!s) return; for (const t of e.changedTouches) if (t.identifier === s.id) { this.stick = null; ring.style.display = 'none'; set(0, 0); } };
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

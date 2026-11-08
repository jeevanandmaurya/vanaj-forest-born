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
  ['call', 'Call', 'KeyQ', 2.2, 1.2, true, 0.8],
];
const TOP = [['bag', 'Bag', 'Tab'], ['map', 'Map', 'KeyM'], ['menu', '❚❚', 'Escape']];

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
      #touch .tbtns { position:absolute; right:18px; bottom:18px; width:0; height:0; }
      #touch .tb { position:absolute; border-radius:50%; background:rgba(20,16,10,.38); border:2px solid rgba(240,230,205,.45); color:#f2e8d2; font:600 13px Karla, sans-serif; display:flex; align-items:center; justify-content:center; text-align:center; white-space:pre; pointer-events:auto; }
      #touch .tb.on { background:rgba(211,149,74,.55); border-color:#f2c890; }
      #touch .ttop { position:absolute; right:10px; top:34%; display:flex; flex-direction:column; gap:8px; }
      #touch .tt { pointer-events:auto; min-width:52px; height:40px; padding:0 10px; border-radius:8px; background:rgba(20,16,10,.45); border:1px solid rgba(240,230,205,.4); color:#f2e8d2; font:600 14px Karla, sans-serif; display:flex; align-items:center; justify-content:center; }
      body.touch #objective-box { left:12px; top:12px; max-width:56vw; } body.touch #objective { font-size:15px; }
      body.touch #clock { right:12px; top:10px; } body.touch #clock b { font-size:18px; }
      body.touch #compass { top:58px; width:240px; margin-left:-120px; }
      body.touch #stats { left:12px; top:auto; bottom:auto; top:calc(12px + 7.5em); width:170px; transform:scale(.8); transform-origin:left top; }
      body.touch #weapon { right:auto; left:50%; bottom:auto; top:96px; transform:translateX(-50%) scale(.62); transform-origin:center top; }
      body.touch #subtitle { font-size:17px; width:86vw; bottom:max(30vh, 220px); }
      body.touch #prompt { bottom:44vh; }
      body.touch #toasts { top:auto; bottom:36vh; right:auto; left:50%; transform:translateX(-50%); width:86vw; align-items:center; }
      body.touch .kbhint, body.touch kbd { display:none; }`;
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
    this.bindStick(root.querySelector('.tleft'), root.querySelector('.tstick'), root.querySelector('.tknob'));
    this.bindLook(root.querySelector('.tright'));
    document.body.classList.add('touch');
    game.touch = true;
  }
  show(on) { this.root.classList.toggle('show', on); }
  key(code, down) {
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
    const R = 52, keys = this.g.input.keys;
    const set = (dx, dy) => {
      const m = Math.hypot(dx, dy), k = m > R ? R / m : 1, nx = dx * k / R, ny = dy * k / R;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      keys.KeyW = ny < -0.35; keys.KeyS = ny > 0.35; keys.KeyA = nx < -0.35; keys.KeyD = nx > 0.35;
      keys.ShiftLeft = m > R * 1.15 && ny < -0.5;
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
    const end = (e) => { const s = this.stick; if (!s) return; for (const t of e.changedTouches) if (t.identifier === s.id) { this.stick = null; ring.style.display = 'none'; set(0, 0); keys.ShiftLeft = false; } };
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

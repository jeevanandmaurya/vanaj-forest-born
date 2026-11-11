// Talk: who says what, and how it sounds.
//
// Vanaj grew up among animals, so he understands them. An animal's line is shown the way he hears it: its name, the
// real call it made (a wolf's low whuff, a langur's cough-bark, a sambar's bell), and what that call means to him.
// Villagers speak a language he has forgotten: their lines come as the few words he catches.
//
// One queue for everything spoken or narrated, so two lines are never on screen at once:
//   say(lines)   a conversation or a beat of the story; lines play in order, each for as long as it takes to read
//   bark(...)    a passing remark; dropped if anything else is being said
// Nothing here stops play. A line can be hurried with Enter or a tap on it.
const $ = (id) => document.getElementById(id);

// name, the colour of the name plate, the species whose voice it is, and the call played when it speaks
export const CAST = {
  vanaj: { name: 'Vanaj', col: '#c9783a', face: 'boy' },
  kaali: { name: 'Kaali', col: '#8792a0', face: 'wolf', voice: ['wolf', 'whine'] },
  langur: { name: 'Young langur', col: '#9aa0a6', face: 'langur', voice: ['langur', 'whoop'] },
  troop: { name: 'Langurs', col: '#9aa0a6', face: 'langur', voice: ['langur', 'alarm'] },
  mahua: { name: 'Mahua', col: '#6b5a50', face: 'bear', voice: ['bear', 'huff'] },
  tornear: { name: 'Torn-Ear', col: '#d9792b', face: 'tiger', voice: ['tiger', 'growl'] },
  shadow: { name: 'The Shadow', col: '#c9a13a', face: 'leopard', voice: ['leopard', 'saw'] },
  lal: { name: 'Lal', col: '#c4572e', face: 'dhole', voice: ['dhole', 'whistle'] },
  chingari: { name: 'Chingari', col: '#e0703a', face: 'dhole', voice: ['dhole', 'whistle'] },
  doe: { name: 'Chital doe', col: '#b98a55', face: 'deer', voice: ['chital', 'alarm'] },
  gaur: { name: 'Gaur bull', col: '#4c4038', face: 'gaur', voice: ['gaur', 'snort'] },
  peacock: { name: 'Peacock', col: '#2f7fb0', face: 'peacock', voice: ['peafowl', 'call'] },
  sukhi: { name: 'Sukhi', col: '#4f9a7a', face: 'kid' },
  aaji: { name: 'Aaji Phulwati', col: '#b0453a', face: 'aaji' },
  villager: { name: 'Villager', col: '#8a7a5a', face: 'man' },
};

// ------------------------------------------------------------------------------------------- portraits
// Small painted heads, drawn once each. Flat shapes and an ink line, like the opening's pictures.
const faces = {};
function faceFor(kind) {
  if (faces[kind]) return faces[kind];
  const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
  x.lineJoin = x.lineCap = 'round';
  const ink = '#2a1c12';
  const fill = (col, path, line = 3) => { x.fillStyle = col; x.beginPath(); path(); x.closePath(); x.fill(); if (line) { x.strokeStyle = ink; x.lineWidth = line; x.stroke(); } };
  const oval = (cx, cy, rx, ry, rot = 0) => () => x.ellipse(cx, cy, rx, ry, rot, 0, 6.2832);
  const tri = (a, b, d) => () => { x.moveTo(...a); x.lineTo(...b); x.lineTo(...d); };
  const eye = (cx, cy, r = 4, col = ink) => { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, 6.2832); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + r * 0.3, cy - r * 0.35, r * 0.32, 0, 6.2832); x.fill(); };
  const line = (pts, w = 3, col = ink) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.moveTo(...pts[0]); for (const p of pts.slice(1)) x.lineTo(...p); x.stroke(); };
  const dog = (coat, pale, earCol) => {
    fill(earCol, tri([20, 40], [24, 8], [42, 28])); fill(earCol, tri([76, 40], [72, 8], [54, 28]));
    fill(coat, oval(48, 50, 30, 28)); fill(pale, oval(48, 64, 17, 16), 0); fill(pale, tri([34, 40], [48, 62], [62, 40]), 0);
    eye(36, 44); eye(60, 44); fill(ink, oval(48, 62, 5, 4), 0); line([[48, 66], [48, 72]], 2); line([[40, 74], [48, 72], [56, 74]], 2);
  };
  const human = (skin, hair, extra) => {
    fill(skin, oval(48, 52, 25, 28)); if (extra) extra();
    fill(hair, () => { x.moveTo(22, 46); x.quadraticCurveTo(20, 16, 48, 16); x.quadraticCurveTo(76, 16, 74, 46); x.quadraticCurveTo(62, 28, 48, 32); x.quadraticCurveTo(34, 28, 22, 46); });
    eye(38, 52, 3.6); eye(58, 52, 3.6); line([[40, 66], [48, 69], [56, 66]], 2.4);
  };
  switch (kind) {
    case 'wolf': dog('#8d95a0', '#e6e2d8', '#6c7480'); break;
    case 'dhole': dog('#c9602c', '#f0dcc0', '#3a2a22'); break;
    case 'tiger':
      fill('#e08a30', oval(24, 26, 10, 9)); fill('#e08a30', tri([62, 26], [78, 16], [72, 34]));   // the left ear whole, the right one torn
      fill('#e8922f', oval(48, 52, 31, 28)); fill('#f6ead2', oval(48, 64, 16, 13), 0);
      for (const [a, b] of [[[30, 28], [36, 38]], [[48, 24], [48, 36]], [[66, 28], [60, 38]], [[18, 50], [28, 52]], [[78, 50], [68, 52]], [[20, 62], [29, 61]], [[76, 62], [67, 61]]]) line([a, b], 4);
      eye(36, 47, 4, '#3a2a10'); eye(60, 47, 4, '#3a2a10'); fill('#b0503a', tri([43, 58], [53, 58], [48, 64]), 2); line([[40, 70], [48, 66], [56, 70]], 2);
      break;
    case 'leopard':
      fill('#d9a94a', oval(26, 26, 9, 9)); fill('#d9a94a', oval(70, 26, 9, 9)); fill('#dfb050', oval(48, 52, 29, 27)); fill('#f6ead2', oval(48, 64, 14, 12), 0);
      for (const [cx, cy] of [[30, 34], [44, 28], [58, 30], [68, 38], [22, 52], [74, 54], [26, 66], [70, 68]]) { x.strokeStyle = ink; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, 3.4, 0.4, 5.2); x.stroke(); }
      eye(37, 47, 4, '#2a3a10'); eye(59, 47, 4, '#2a3a10'); fill('#7a3a2a', tri([44, 58], [52, 58], [48, 63]), 2);
      break;
    case 'bear':
      fill('#2c2622', oval(24, 28, 11, 11)); fill('#2c2622', oval(72, 28, 11, 11)); fill('#332b26', oval(48, 52, 31, 29)); fill('#cdbfa6', oval(48, 64, 15, 14), 0);
      eye(36, 46, 3.4, '#f0e6d0'); eye(60, 46, 3.4, '#f0e6d0'); fill(ink, oval(48, 58, 6, 4.5), 0); fill('#e8dcc0', () => { x.moveTo(34, 80); x.quadraticCurveTo(48, 90, 62, 80); x.quadraticCurveTo(48, 84, 34, 80); }, 0);
      break;
    case 'langur':
      fill('#c9cdd0', oval(48, 50, 33, 31)); fill('#1e1a18', oval(48, 54, 20, 22)); eye(40, 50, 3.4, '#c88a3a'); eye(56, 50, 3.4, '#c88a3a');
      line([[42, 66], [48, 68], [54, 66]], 2, '#7a6a5a'); fill('#1e1a18', oval(15, 48, 5, 7)); fill('#1e1a18', oval(81, 48, 5, 7));
      break;
    case 'deer':
      fill('#b98450', () => { x.moveTo(20, 34); x.lineTo(6, 22); x.lineTo(28, 44); }); fill('#b98450', () => { x.moveTo(76, 34); x.lineTo(90, 22); x.lineTo(68, 44); });
      fill('#c08a52', oval(48, 52, 22, 30)); fill('#f2e6cc', oval(48, 72, 11, 9), 0);
      for (const [cx, cy] of [[38, 30], [56, 28], [48, 38], [62, 40], [34, 42]]) { x.fillStyle = '#f6eeda'; x.beginPath(); x.arc(cx, cy, 2.6, 0, 6.2832); x.fill(); }
      eye(36, 52, 4.4); eye(60, 52, 4.4); fill(ink, oval(48, 72, 5, 3.5), 0);
      break;
    case 'gaur':
      line([[20, 30], [8, 18], [16, 6]], 7, '#d8ceb0'); line([[76, 30], [88, 18], [80, 6]], 7, '#d8ceb0');
      fill('#3a302a', oval(48, 52, 29, 31)); fill('#c9bca0', oval(48, 30, 16, 8), 0); fill('#5a4c42', oval(48, 72, 15, 11), 0);
      eye(34, 50, 3.4, '#e8dcc0'); eye(62, 50, 3.4, '#e8dcc0'); fill(ink, oval(42, 74, 2.6, 2), 0); fill(ink, oval(54, 74, 2.6, 2), 0);
      break;
    case 'peacock':
      for (let i = 0; i < 5; i++) { const a = -1.1 + i * 0.55; line([[48, 26], [48 + Math.sin(a) * 18, 8 + Math.abs(Math.sin(a)) * 6]], 2, '#1f6f8a'); x.fillStyle = '#2aa0a8'; x.beginPath(); x.arc(48 + Math.sin(a) * 18, 8 + Math.abs(Math.sin(a)) * 6, 3, 0, 6.2832); x.fill(); }
      fill('#2468b8', oval(48, 54, 20, 28)); fill('#f2f0e6', oval(40, 46, 7, 4), 0); eye(41, 47, 3.2); fill('#c9b070', tri([58, 50], [78, 56], [58, 60]));
      break;
    case 'kid': human('#a8744e', '#1c1410'); break;
    case 'man': human('#9a6a4a', '#d8d0bc', () => fill('#d8d0bc', oval(48, 24, 27, 13))); break;
    case 'aaji': human('#a17250', '#d6d2ca', () => { fill('#b0453a', () => { x.moveTo(18, 60); x.quadraticCurveTo(14, 14, 48, 12); x.quadraticCurveTo(82, 14, 78, 60); x.quadraticCurveTo(70, 26, 48, 24); x.quadraticCurveTo(26, 26, 18, 60); }); line([[32, 44], [36, 42]], 1.6); line([[60, 42], [64, 44]], 1.6); fill('#b0302a', oval(48, 41, 2.4, 2.4), 0); }); break;
    default: // the boy
      human('#a66e44', '#1a120e');
      fill('#1a120e', () => { x.moveTo(24, 40); x.lineTo(30, 22); x.lineTo(38, 34); x.lineTo(46, 20); x.lineTo(54, 34); x.lineTo(64, 22); x.lineTo(72, 40); x.lineTo(48, 30); }, 0);
  }
  return (faces[kind] = c.toDataURL());
}

const readTime = (text) => { const words = text.replace(/<[^>]+>/g, '').split(/\s+/).length; return Math.max(2.4, words * 0.34 + 1.3); };

export class Talk {
  constructor(g) {
    this.g = g; this.q = []; this.cur = null; this.t = 0; this.gap = 0; this.barkCD = new Map(); this.said = new Set();
    this.box = $('talk'); this.sub = $('subtitle');
    this.face = this.box.querySelector('img'); this.name = this.box.querySelector('b'); this.call = this.box.querySelector('i'); this.text = this.box.querySelector('p');
    const hurry = (e) => { if (this.cur && this.cur.who !== 'n') { e.stopPropagation(); this.skip(); } };
    this.box.addEventListener('mousedown', hurry); this.box.addEventListener('touchstart', hurry, { passive: true });
    window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && this.cur && g.playing && !g.uiBlocking) this.skip(); });
  }
  get busy() { return !!this.cur || this.q.length > 0; }
  // lines: a string is narration (the older Vanaj, remembering); [who, text] is speech; [who, text, call] names the call it was
  say(lines, o = {}) {
    const list = [].concat(typeof lines === 'string' ? [lines] : lines).map((l) => (typeof l === 'string' ? { who: 'n', text: l } : { who: l[0], text: l[1], call: l[2] }));
    if (!list.length) return Promise.resolve(true);
    if (o.now) this.clear();
    return new Promise((done) => {
      list.forEach((l, i) => { l.batch = o.id; l.from = o.from; if (i === list.length - 1) l.done = done; this.q.push(l); });
    });
  }
  // a passing remark: once every cd seconds at most (or once ever), and never over something else
  bark(id, lines, o = {}) {
    const now = this.g.clock;
    if (this.busy || this.g.cinematic) return false;
    if (o.once && this.said.has(id)) return false;
    if ((this.barkCD.get(id) || -1e9) > now) return false;
    this.barkCD.set(id, now + (o.cd || 60)); this.said.add(id);
    // (alts: a list of alternatives, each one a list of lines as say() takes them)
    this.say(lines[Math.floor(Math.random() * lines.length)], o);
    return true;
  }
  skip() { if (this.cur) this.t = Math.min(this.t, 0.01); }
  clear() {
    for (const l of this.q) if (l.done) l.done(false);
    this.q.length = 0;
    if (this.cur && this.cur.done) this.cur.done(false);
    this.cur = null; this.t = 0; this.gap = 0;
    this.box.classList.remove('show'); this.sub.classList.remove('show');
  }
  show(l) {
    const g = this.g; this.cur = l; this.t = l.dur || readTime(l.text); this.typed = 0;
    if (l.who === 'n') {
      this.box.classList.remove('show');
      this.sub.innerHTML = `<em>${g.ui.forThumbs(l.text)}</em>`; this.sub.classList.add('show');
      return;
    }
    this.sub.classList.remove('show');
    const c = CAST[l.who] || { name: l.who, col: '#8a7a5a', face: 'man' };
    this.face.src = faceFor(c.face); this.name.textContent = c.name; this.name.style.background = c.col;
    this.call.textContent = l.call || ''; this.call.style.display = l.call ? '' : 'none';
    this.full = g.ui.forThumbs(l.text); this.text.innerHTML = this.full;
    this.box.classList.toggle('animal', !!c.voice); this.box.classList.add('show');
    // the one speaking makes its real sound, and turns to him
    const who = g.director && g.director.actor(l.who);
    if (c.voice && g.audio.ready) { const p = who ? who.pos : g.player.pos; g.audio.animal(c.voice[0], l.sound || c.voice[1], p); }
    if (who && who.mind) who.mind.spoke(g.player.pos);
    if (l.who === 'vanaj' && g.player.speak) g.player.speak(this.t);
  }
  update(dt) {
    if (this.cur) {
      this.t -= dt;
      if (this.t <= 0) {
        const l = this.cur; this.cur = null; this.gap = l.who === 'n' ? 0.5 : 0.28;
        if (!this.q.length || this.q[0].who === 'n' || l.who === 'n') { this.box.classList.remove('show'); this.sub.classList.remove('show'); }
        if (l.done) l.done(true);
      }
      return;
    }
    if (this.gap > 0) { this.gap -= dt; return; }
    if (this.q.length) this.show(this.q.shift());
  }
}

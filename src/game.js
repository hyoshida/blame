// RECOIL CLIMB — game layer (rendering, input, audio, save). Physics lives in physics.js.
(function () {
  'use strict';
  const { C } = Phys;
  const VW = 144;
  let VH = 256, scale = 2;
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const L = Phys.makeLevel(window.LEVEL_ROWS);
  const WORLD_H = L.h * 8;
  const START_TY = Math.floor(L.start.y / 8);
  const START_FEET = START_TY * 8 + 8;

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const SAVE_KEY = 'recoilclimb.save.v1', PREF_KEY = 'recoilclimb.prefs.v1', BEST_KEY = 'recoilclimb.best.v1';
  const prefs = Object.assign({ mode: 'stick', sound: true }, store.get(PREF_KEY, {}));
  let bestClear = store.get(BEST_KEY, null); // {time, falls}

  // ---------------------------------------------------------------- utils
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fmtTime = (f) => {
    const s = Math.floor(f / 60), m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const lerpHex = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  };

  // ---------------------------------------------------------------- pixel font (3x5)
  const FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
    '8': '111101111101111', '9': '111101111001111', 'm': '000000110111101', ':': '000010000010000',
    '-': '000000111000000', '+': '000010111010000', '/': '001001010100100',
  };
  function drawText(str, x, y, col, shadow = '#000') {
    for (const pass of [shadow, col]) {
      if (!pass) continue;
      const o = pass === col ? 0 : 1;
      ctx.fillStyle = pass;
      let cx = x;
      for (const ch of String(str)) {
        const g = FONT[ch];
        if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) + o, y + Math.floor(i / 3) + o, 1, 1);
        cx += 4;
      }
    }
  }
  const textW = (s) => String(s).length * 4 - 1;

  // ---------------------------------------------------------------- sprites
  function sprite(rows, map) {
    const c = document.createElement('canvas');
    c.width = rows[0].length; c.height = rows.length;
    const g = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (map[ch]) { g.fillStyle = map[ch]; g.fillRect(x, y, 1, 1); } }));
    return c;
  }
  const BODY = ['..yyyy..', '.yyyyyy.', '.oyfkfk.', '.oyffff.', '..cccc..', '.oyyyyo.'];
  const LEGS = {
    idle: ['..p..p..', '..n..n..'],
    walk1: ['..pp.p..', '.nn..n..'],
    walk2: ['..p.pp..', '..n..nn.'],
    air: ['..pppp..', '.n....n.'],
  };
  const HOOD = [['#83769c', '#5f574f'], ['#ffa300', '#ab5236'], ['#ffec27', '#ffa300']];
  const PSPR = HOOD.map(([y, o]) => {
    const out = {};
    for (const k in LEGS) out[k] = sprite(BODY.concat(LEGS[k]), { y, o, f: '#ffccaa', k: '#1d2b53', c: '#ff004d', p: '#7e2553', n: '#ab5236' });
    return out;
  });
  const CRYSTAL = sprite(['...w...', '..waa..', '.waaab.', 'waaaabb', '.aaabb.', '..abb..', '...b...'], { w: '#fff1e8', a: '#00e436', b: '#008751' });
  const CRYSTAL_OFF = sprite(['...d...', '..d.d..', '.d...d.', 'd.....d', '.d...d.', '..d.d..', '...d...'], { d: '#5f574f' });

  // ---------------------------------------------------------------- tile layer (pre-rendered)
  const SPIKE_UP = (x, y) => (y === 5 && (x === 1 || x === 5)) ? '#fff1e8'
    : (y === 6 && x !== 3 && x !== 7) ? '#c2c3c7' : (y === 7 ? '#83769c' : null);
  const tiles = (() => {
    const c = document.createElement('canvas');
    c.width = L.w * 8; c.height = WORLD_H;
    const g = c.getContext('2d');
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    for (let ty = 0; ty < L.h; ty++) for (let tx = 0; tx < L.w; tx++) {
      const ch = L.grid[ty][tx], bx = tx * 8, by = ty * 8;
      if (Phys.isSolid(ch)) {
        const s = (dx, dy) => Phys.isSolid(Phys.tileAt(L, tx + dx, ty + dy));
        const T = ty > 0 && !s(0, -1), B = ty < L.h - 1 && !s(0, 1), Lf = !s(-1, 0), R = !s(1, 0);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          if ((T && Lf && x === 0 && y === 0) || (T && R && x === 7 && y === 0) || (B && Lf && x === 0 && y === 7) || (B && R && x === 7 && y === 7)) continue;
          const h = hash(bx + x, by + y);
          let col;
          if (ch === '=') {
            if (T && y === 0) col = '#fff1e8';
            else if ((B && y === 7)) col = '#16609a';
            else if ((Lf && x === 0) || (R && x === 7)) col = '#c6ecff';
            else if ((x + y) % 6 === 0 && y < 6) col = '#c6ecff';
            else col = y < 4 ? '#29adff' : '#1f86c9';
          } else {
            if (T && y === 0) col = '#fff1e8';
            else if (T && y === 1) col = h < 0.55 ? '#fff1e8' : '#c2c3c7';
            else if (T && y === 2 && h < 0.18) col = '#c2c3c7';
            else if ((Lf && x === 0) || (R && x === 7)) col = '#83769c';
            else if (B && y === 7) col = '#3b4a7a';
            else if ((Lf && x === 1) || (R && x === 6) || (B && y === 6) || (T && y <= 3)) col = '#2b3a6b';
            else col = h < 0.07 ? '#2b3a6b' : h > 0.975 ? '#7e2553' : '#1d2b53';
          }
          px(bx + x, by + y, col);
        }
      } else if ('^v<>'.includes(ch)) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const col = ch === '^' ? SPIKE_UP(x, y) : ch === 'v' ? SPIKE_UP(x, 7 - y) : ch === '>' ? SPIKE_UP(y, 7 - x) : SPIKE_UP(y, x);
          if (col) px(bx + x, by + y, col);
        }
      }
    }
    return c;
  })();

  // ---------------------------------------------------------------- background
  const stars = [...Array(80)].map(() => ({ x: Math.floor(rnd(0, VW)), y: rnd(-WORLD_H * 0.15, 400), tw: rnd(0, 6.28), b: Math.random() }));
  const flakes = [...Array(36)].map(() => ({ x: rnd(0, VW), y: rnd(0, 400), sp: rnd(0.15, 0.5), ph: rnd(0, 6.28), big: Math.random() < 0.2 }));
  const ridge = (x, seed, amp) => Math.abs(Math.sin(x * 0.045 + seed)) * amp + Math.sin(x * 0.13 + seed * 2) * amp * 0.25 + Math.sin(x * 0.31 + seed) * 2;

  // ---------------------------------------------------------------- audio
  let actx = null;
  function audioUnlock() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function tone({ f = 440, f2 = null, d = 0.1, type = 'square', v = 0.12, delay = 0 }) {
    if (!actx || !prefs.sound) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
  }
  let noiseBuf = null;
  function noise(d, v, fc) {
    if (!actx || !prefs.sound) return;
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.3, actx.sampleRate);
      const a = noiseBuf.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    }
    const t = actx.currentTime;
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(fc, t); f.frequency.exponentialRampToValueAtTime(200, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f).connect(g).connect(actx.destination); s.start(t); s.stop(t + d);
  }
  const SFX = {
    shot() { noise(0.14, 0.4, 2600); tone({ f: 150, f2: 40, d: 0.12, v: 0.13 }); },
    click() { tone({ f: 1200, d: 0.025, v: 0.05 }); },
    land() { tone({ f: 95, f2: 50, d: 0.07, type: 'triangle', v: 0.25 }); },
    crystal() { [660, 990, 1320].forEach((f, i) => tone({ f, d: 0.09, type: 'triangle', v: 0.12, delay: i * 0.05 })); },
    spike() { tone({ f: 320, f2: 60, d: 0.22, type: 'sawtooth', v: 0.09 }); },
    fall() { tone({ f: 330, f2: 110, d: 0.5, type: 'triangle', v: 0.1 }); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, d: 0.18, v: 0.07, delay: i * 0.1 })); },
  };
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };

  // ---------------------------------------------------------------- game state
  let state = 'title';
  let p, time, falls, shots, bestH, lastGroundY, tick = 0;
  const cam = { y: WORLD_H - 256, prev: 0 };
  let shake = 0, flash = null;
  let parts = [], tracers = [], floaters = [];
  let aim = { x: 0.6, y: 0.8 }, aimShow = false, pendingFire = null;
  const keys = { left: false, right: false };
  const touches = new Map();
  let mouse = null;
  let touchUI = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  const STICK_MIN = 5;

  function surfaceAt(tx, ty) { return !Phys.isSolid(Phys.tileAt(L, tx, ty)) && Phys.isSolid(Phys.tileAt(L, tx, ty + 1)); }
  function placeAt(tx, ty) {
    p = Phys.newPlayer(tx * 8 + 1, ty * 8 + 8 - C.PH - 0.0001);
    p.grounded = true;
  }
  function newGame() {
    placeAt(Math.floor(L.start.x / 8), START_TY);
    const m = /row(\d+)/.exec(location.hash + location.search); // debug: #row60 starts near that row
    if (m) {
      outer: for (let ty = +m[1]; ty < L.h; ty++) for (let tx = 0; tx < L.w; tx++) if (surfaceAt(tx, ty)) { placeAt(tx, ty); break outer; }
    }
    time = 0; falls = 0; shots = 0; bestH = 0;
    lastGroundY = p.y;
    for (const c of L.crystals) { c.active = true; c.t = 0; }
    cam.y = clampCam(p.y - VH * 0.5);
  }
  function loadGame(s) {
    newGame();
    Object.assign(p, { x: s.x, y: s.y, vx: s.vx || 0, vy: s.vy || 0 });
    p.grounded = false;
    time = s.time || 0; falls = s.falls || 0; shots = s.shots || 0; bestH = s.bestH || 0;
    lastGroundY = s.lastGroundY != null ? s.lastGroundY : p.y;
    cam.y = clampCam(p.y - VH * 0.5);
  }
  function saveGame() {
    if (!p || p.won) return;
    store.set(SAVE_KEY, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, time, falls, shots, bestH, lastGroundY });
  }
  const heightM = () => Math.max(0, Math.round((START_FEET - (p.y + C.PH)) / 8));
  const ctrlPad = () => (touchUI ? 44 : 0); // room below the floor so the ◀▶ buttons don't cover the player
  const clampCam = (y) => Math.max(0, Math.min(WORLD_H - VH + ctrlPad(), y));

  // ---------------------------------------------------------------- particles
  function puff(x, y, n, col, spread = 1, up = 0.3, g = 0.02, life = 20) {
    for (let i = 0; i < n; i++) parts.push({ x, y, vx: rnd(-spread, spread), vy: rnd(-spread, spread) - up, g, life: life + rnd(0, 10), col, collide: false });
  }
  function updateParts() {
    for (const q of parts) {
      q.vy += q.g; q.x += q.vx; q.y += q.vy; q.life--;
      if (q.collide && Phys.isSolid(Phys.tileAt(L, Math.floor(q.x / 8), Math.floor(q.y / 8)))) {
        q.y -= q.vy; q.vy *= -0.4; q.vx *= 0.6;
      }
    }
    parts = parts.filter((q) => q.life > 0);
    tracers = tracers.filter((t) => --t.life > 0);
    floaters = floaters.filter((f) => { f.y -= 0.25; return --f.life > 0; });
    if (flash && --flash.life <= 0) flash = null;
  }

  // ---------------------------------------------------------------- input
  function moveInput() {
    let m = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    for (const t of touches.values()) if (t.role === 'move') m = t.x < 31 ? -1 : 1;
    return m;
  }
  function requestFire(d) {
    if (state !== 'play') return;
    const len = Math.hypot(d.x, d.y) || 1;
    pendingFire = { dx: d.x / len, dy: d.y / len, ttl: 6 };
  }
  function toInternal(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  const playerScreen = () => ({ x: p.x + 3, y: p.y + 4 - Math.round(cam.y) });
  const inMoveZone = (pt) => pt.x < 62 && pt.y > VH - 46;

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audioUnlock();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const pt = toInternal(e);
    if (e.pointerType === 'mouse') {
      touchUI = false;
      mouse = pt; mouseAim();
      requestFire(aim);
      return;
    }
    touchUI = true;
    if (inMoveZone(pt)) touches.set(e.pointerId, { role: 'move', x: pt.x, y: pt.y });
    else if (prefs.mode === 'tap') {
      const ps = playerScreen();
      const d = { x: pt.x - ps.x, y: pt.y - ps.y };
      if (Math.hypot(d.x, d.y) > 2) { const l = Math.hypot(d.x, d.y); aim = { x: d.x / l, y: d.y / l }; requestFire(aim); }
      touches.set(e.pointerId, { role: 'tap', x: pt.x, y: pt.y });
    } else touches.set(e.pointerId, { role: 'stick', ox: pt.x, oy: pt.y, x: pt.x, y: pt.y });
  });
  cv.addEventListener('pointermove', (e) => {
    const pt = toInternal(e);
    if (e.pointerType === 'mouse') { mouse = pt; mouseAim(); return; }
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = pt.x; t.y = pt.y;
    if (t.role === 'stick') {
      const dx = t.x - t.ox, dy = t.y - t.oy, l = Math.hypot(dx, dy);
      if (l >= STICK_MIN) aim = { x: dx / l, y: dy / l };
    }
  });
  function endTouch(e, cancelled) {
    const t = touches.get(e.pointerId);
    if (!t) return;
    touches.delete(e.pointerId);
    if (t.role === 'stick' && !cancelled) {
      const dx = t.x - t.ox, dy = t.y - t.oy;
      if (Math.hypot(dx, dy) >= STICK_MIN) requestFire(aim);
    }
  }
  cv.addEventListener('pointerup', (e) => endTouch(e, false));
  cv.addEventListener('pointercancel', (e) => endTouch(e, true));
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  function mouseAim() {
    if (!p || !mouse) return;
    const ps = playerScreen();
    const dx = mouse.x - ps.x, dy = mouse.y - ps.y, l = Math.hypot(dx, dy);
    if (l > 1) aim = { x: dx / l, y: dy / l };
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
    else if (e.code === 'Space') { audioUnlock(); requestFire(aim); }
    else if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'play') pause(); else if (state === 'pause') resume(); }
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  });

  // ---------------------------------------------------------------- update
  function onShot(d) {
    shots++;
    const cx = p.x + 3, cy = p.y + 4;
    const tipX = cx + d.dx * 7, tipY = cy + d.dy * 7;
    const hit = Phys.raycast(L, tipX, tipY, d.dx, d.dy, 220);
    tracers.push({ x0: tipX, y0: tipY, x1: hit.x, y1: hit.y, life: 5 });
    if (hit.hit) for (let i = 0; i < 6; i++) parts.push({ x: hit.x - d.dx * 2, y: hit.y - d.dy * 2, vx: -d.dx * rnd(0.3, 1.5) + rnd(-0.8, 0.8), vy: -d.dy * rnd(0.3, 1.5) + rnd(-0.8, 0.8), g: 0.08, life: rnd(8, 16), col: i % 2 ? '#ffec27' : '#fff1e8' });
    flash = { x: tipX, y: tipY, life: 3 };
    puff(tipX, tipY, 5, '#c2c3c7', 0.4, 0.2, -0.01, 18);
    parts.push({ x: cx, y: cy, vx: -d.dy * rnd(0.6, 1.2) * (Math.random() < 0.5 ? 1 : -1), vy: -1.6, g: 0.15, life: 50, col: '#ffa300', collide: true });
    shake = 4;
    SFX.shot(); buzz(12);
  }
  function update() {
    tick++;
    if (state === 'pause') return;
    updateParts();
    if (state !== 'play') { cameraFollow(0.05); return; }
    time++;
    const ev = [];
    let fire = null;
    if (pendingFire) fire = { dx: pendingFire.dx, dy: pendingFire.dy };
    Phys.step(L, p, { move: moveInput(), fire }, ev);
    let shot = false;
    for (const e of ev) {
      if (e.t === 'shot') { shot = true; onShot(e); }
      else if (e.t === 'land') {
        if (e.v > 2) { puff(p.x + 3, p.y + C.PH, 5, '#c2c3c7', 0.7, 0.3, 0.03, 12); SFX.land(); }
        const drop = p.y - lastGroundY;
        if (drop > 6 * 8) {
          falls++;
          floaters.push({ x: p.x + 3, y: p.y - 4, text: '-' + Math.round(drop / 8) + 'm', life: 70, col: '#ff77a8' });
          SFX.fall(); shake = 6;
        }
        lastGroundY = p.y;
      } else if (e.t === 'spike') {
        for (let i = 0; i < 8; i++) parts.push({ x: p.x + 3, y: p.y + 4, vx: rnd(-1.5, 1.5), vy: rnd(-1.5, 1.5), g: 0.05, life: 14, col: i % 2 ? '#ff004d' : '#fff1e8' });
        SFX.spike(); shake = 5; buzz(30);
      } else if (e.t === 'crystal') {
        for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 1.2, g: 0, life: 16, col: i % 2 ? '#00e436' : '#fff1e8' }); }
        SFX.crystal();
      } else if (e.t === 'win') win();
    }
    if (pendingFire && !shot) {
      if (p.ammo <= 0) { SFX.click(); pendingFire = null; }
      else if (--pendingFire.ttl <= 0) pendingFire = null;
    } else pendingFire = null;

    if (p.grounded && Math.abs(p.vx) > 0.5 && tick % 8 === 0) puff(p.x + 3, p.y + C.PH, 1, '#83769c', 0.3, 0.2, 0, 10);
    bestH = Math.max(bestH, heightM());
    if (mouse) mouseAim();
    if (tick % 60 === 0) saveGame();
    cameraFollow(0.12);
  }
  function cameraFollow(k) {
    if (!p) return;
    const ctrl = touchUI ? 48 : 0;
    const target = clampCam(p.y + 4 - (VH - ctrl) * 0.5);
    cam.prev = cam.y;
    cam.y += (target - cam.y) * k;
  }

  // ---------------------------------------------------------------- render
  function drawBackground(cy) {
    const t = Math.max(0, 1 - cy / Math.max(1, WORLD_H - VH)); // 0 bottom .. 1 top
    const gr = ctx.createLinearGradient(0, 0, 0, VH);
    gr.addColorStop(0, lerpHex('#0d1030', '#2a1446', t));
    gr.addColorStop(1, lerpHex('#1a2150', '#5a2458', t));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, VW, VH);
    const climb = Math.max(0, WORLD_H - VH - cy);
    for (const s of stars) {
      const y = Math.round(s.y + climb * 0.15);
      if (y < 0 || y >= VH) continue;
      const on = Math.sin(tick * 0.03 + s.tw) > -0.2;
      ctx.fillStyle = s.b > 0.85 && on ? '#fff1e8' : s.b > 0.5 ? '#83769c' : '#3b3f78';
      ctx.fillRect(s.x, y, 1, 1);
    }
    // far + near ridges scroll away as you climb
    const layers = [[0.22, 1.3, 46, '#262a5e', '#6a6a9e'], [0.4, 4.1, 30, '#31265f', '#4a3f7a']];
    for (const [par, seed, amp, col, cap] of layers) {
      const base = VH - 8 + climb * par;
      if (base - amp - 10 > VH) continue;
      for (let x = 0; x < VW; x++) {
        const top = Math.round(base - ridge(x, seed, amp));
        if (top >= VH) continue;
        ctx.fillStyle = col; ctx.fillRect(x, top, 1, VH - top);
        if (cap && ridge(x, seed, amp) > amp * 0.8) { ctx.fillStyle = cap; ctx.fillRect(x, top, 1, 2); }
      }
    }
  }
  function drawSnow() {
    const dcy = cam.y - cam.prev;
    for (const f of flakes) {
      f.y += f.sp - dcy * 0.4;
      f.x += Math.sin(tick * 0.02 + f.ph) * 0.25;
      if (f.y > VH) { f.y -= VH + 4; f.x = rnd(0, VW); }
      if (f.y < -4) f.y += VH + 4;
      if (f.x < 0) f.x += VW; if (f.x >= VW) f.x -= VW;
      ctx.fillStyle = f.big ? '#fff1e8' : '#c2c3c7';
      ctx.fillRect(Math.round(f.x), Math.round(f.y), f.big ? 2 : 1, f.big ? 2 : 1);
    }
  }
  function pixLine(x0, y0, x1, y1, col, step = 1, from = 0) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    ctx.fillStyle = col;
    for (let i = from; i <= d; i += step) ctx.fillRect(Math.round(x0 + (x1 - x0) * i / d), Math.round(y0 + (y1 - y0) * i / d), 1, 1);
  }
  function drawPlayer() {
    if (p.stun > 0 && Math.floor(tick / 3) % 2) return;
    const m = moveInput();
    let face = aim.x >= 0 ? 1 : -1;
    if (p.grounded && m && !aimShowNow()) face = m;
    const legs = !p.grounded ? 'air' : Math.abs(p.vx) > 0.3 ? (Math.floor(tick / 6) % 2 ? 'walk1' : 'walk2') : 'idle';
    const spr = PSPR[Math.max(0, Math.min(2, p.ammo))][legs];
    const x = Math.round(p.x) - 1, y = Math.round(p.y) - 1;
    ctx.save();
    if (face < 0) { ctx.translate(x + 8, y); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0); }
    else ctx.drawImage(spr, x, y);
    ctx.restore();
    // gun
    const cx = Math.round(p.x + 3), cy = Math.round(p.y + 4);
    for (let d = 2; d <= 7; d++) {
      ctx.fillStyle = d >= 6 ? '#fff1e8' : '#83769c';
      ctx.fillRect(Math.round(cx + aim.x * d), Math.round(cy + aim.y * d), 1, 1);
    }
  }
  const aimShowNow = () => mouse != null || [...touches.values()].some((t) => t.role === 'stick' && Math.hypot(t.x - t.ox, t.y - t.oy) >= STICK_MIN);
  function drawAimGuide() {
    if (!aimShowNow() || state !== 'play') return;
    const cx = p.x + 3, cy = p.y + 4;
    const reach = Phys.raycast(L, cx + aim.x * 8, cy + aim.y * 8, aim.x, aim.y, 48);
    ctx.globalAlpha = 0.55;
    pixLine(cx + aim.x * 9, cy + aim.y * 9, reach.x, reach.y, '#fff1e8', 3);
    ctx.globalAlpha = 0.8;
    // where the recoil will push you
    pixLine(cx - aim.x * 6, cy - aim.y * 6, cx - aim.x * 14, cy - aim.y * 14, p.ammo > 0 ? '#ffa300' : '#5f574f', 2);
    ctx.globalAlpha = 1;
  }
  function drawWorld() {
    ctx.drawImage(tiles, 0, 0);
    ctx.fillStyle = '#1d2b53'; ctx.fillRect(0, WORLD_H, VW, 64); // bedrock under the floor
    for (const c of L.crystals) {
      const bob = c.active ? Math.round(Math.sin(tick / 14 + c.x) * 1.5) : 0;
      ctx.drawImage(c.active ? CRYSTAL : CRYSTAL_OFF, c.x - 3, c.y - 3 + bob);
      if (c.active && tick % 40 < 3) { ctx.fillStyle = '#fff1e8'; ctx.fillRect(c.x + 2, c.y - 4 + bob, 1, 1); }
    }
    if (L.flag) {
      const { x, y } = L.flag;
      ctx.fillStyle = '#c2c3c7'; ctx.fillRect(x + 1, y, 1, 8);
      for (let i = 0; i < 5; i++) {
        const w = Math.round(Math.sin(tick / 8 - i * 0.9) * 0.8);
        ctx.fillStyle = i === 0 ? '#ff77a8' : '#ff004d';
        ctx.fillRect(x + 2 + i, y + w, 1, 3);
      }
      if (tick % 30 < 15) { ctx.fillStyle = '#ffec27'; ctx.fillRect(x + 1, y - 1, 1, 1); }
    }
    for (const t of tracers) pixLine(t.x0, t.y0, t.x1, t.y1, t.life > 3 ? '#fff1e8' : t.life > 1 ? '#ffec27' : '#ffa300');
    drawAimGuide();
    if (p) drawPlayer();
    if (flash) {
      ctx.fillStyle = '#ffec27'; ctx.fillRect(Math.round(flash.x) - 1, Math.round(flash.y) - 1, 3, 3);
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(Math.round(flash.x), Math.round(flash.y), 1, 1);
    }
    for (const q of parts) { ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); }
    for (const f of floaters) drawText(f.text, Math.round(f.x - textW(f.text) / 2), Math.round(f.y), f.col);
  }
  function drawHUD() {
    const top = 4;
    drawText(heightM() + 'm', 4, top, '#fff1e8');
    for (let i = 0; i < C.AMMO; i++) {
      const full = i < p.ammo;
      ctx.fillStyle = '#000'; ctx.fillRect(5 + i * 5, top + 9, 3, 5);
      ctx.fillStyle = full ? '#ffa300' : '#5f574f'; ctx.fillRect(4 + i * 5, top + 8, 3, 5);
      if (full) { ctx.fillStyle = '#ffec27'; ctx.fillRect(4 + i * 5, top + 8, 3, 1); }
    }
    const tt = fmtTime(time);
    drawText(tt, Math.round((VW - textW(tt)) / 2), top, '#c2c3c7');
    // progress rail on the left edge
    const r0 = 26, r1 = VH - (touchUI ? 56 : 12);
    const maxH = START_TY - 3;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(1, r0, 2, r1 - r0);
    const yAt = (h) => Math.round(r1 - (r1 - r0) * Math.min(1, h / maxH));
    ctx.fillStyle = '#ff77a8'; ctx.fillRect(0, yAt(bestH), 4, 1);
    ctx.fillStyle = '#ffec27'; ctx.fillRect(1, yAt(heightM()) - 1, 2, 3);
  }
  function drawTouchUI() {
    if (!touchUI || state !== 'play') return;
    const m = moveInput();
    const by = VH - 30;
    const btn = (x, dir, on) => {
      ctx.globalAlpha = on ? 0.9 : 0.45;
      ctx.fillStyle = '#1d2b53'; ctx.fillRect(x, by, 24, 24);
      ctx.fillStyle = on ? '#ffec27' : '#fff1e8';
      ctx.fillRect(x, by, 24, 1); ctx.fillRect(x, by + 23, 24, 1); ctx.fillRect(x, by, 1, 24); ctx.fillRect(x + 23, by, 1, 24);
      for (let i = 0; i < 6; i++) {
        const cx = dir < 0 ? x + 9 + i : x + 14 - i;
        ctx.fillRect(cx, by + 12 - i, 1, i * 2 + 1);
      }
      ctx.globalAlpha = 1;
    };
    btn(4, -1, m < 0);
    btn(34, 1, m > 0);
    for (const t of touches.values()) {
      if (t.role !== 'stick') continue;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#fff1e8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(Math.round(t.ox) + 0.5, Math.round(t.oy) + 0.5, 14, 0, 6.283); ctx.stroke();
      const dx = t.x - t.ox, dy = t.y - t.oy, l = Math.hypot(dx, dy), k = l > 14 ? 14 / l : 1;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = l >= STICK_MIN ? '#ffa300' : '#83769c';
      ctx.fillRect(Math.round(t.ox + dx * k) - 3, Math.round(t.oy + dy * k) - 3, 7, 7);
      ctx.globalAlpha = 1;
    }
  }
  function render() {
    const cy = Math.round(cam.y);
    let sx = 0, sy = 0;
    if (shake > 0) { sx = Math.round(rnd(-1, 1)); sy = Math.round(rnd(-1, 1)); shake--; }
    ctx.imageSmoothingEnabled = false;
    drawBackground(cy);
    ctx.save();
    ctx.translate(sx, sy - cy);
    drawWorld();
    ctx.restore();
    drawSnow();
    if (state === 'play' || state === 'pause') { drawHUD(); drawTouchUI(); }
  }

  // ---------------------------------------------------------------- screens
  const $ = (id) => document.getElementById(id);
  const scr = { title: $('scrTitle'), pause: $('scrPause'), clear: $('scrClear') };
  function show(name) {
    for (const k in scr) scr[k].hidden = k !== name;
    $('btnPause').hidden = name !== null;
  }
  function statsHTML(rows) { return rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join(''); }
  function refreshTitle() {
    const has = !!store.get(SAVE_KEY, null);
    $('btnCont').disabled = !has;
    $('btnCont').classList.toggle('primary', has);
    $('btnNew').classList.toggle('primary', !has);
    $('btnNew').textContent = 'はじめから';
    newArmed = false;
    const b = bestClear ? '最速クリア ' + fmtTime(bestClear.time) + '（落下 ' + bestClear.falls + '回）' : 'PCは A/D か ←→ で移動、マウスで狙ってクリック。';
    $('bestLine').textContent = b;
    syncMode();
  }
  function syncMode() {
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === prefs.mode)));
    $('btnSound').textContent = '音: ' + (prefs.sound ? 'ON' : 'OFF');
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { prefs.mode = b.dataset.mode; store.set(PREF_KEY, prefs); syncMode(); }));
  let newArmed = false;
  $('btnNew').addEventListener('click', () => {
    if (store.get(SAVE_KEY, null) && !newArmed) { newArmed = true; $('btnNew').textContent = 'セーブを消して開始'; return; }
    audioUnlock(); store.del(SAVE_KEY); newGame(); play();
  });
  $('btnCont').addEventListener('click', () => {
    const s = store.get(SAVE_KEY, null);
    if (!s) return;
    audioUnlock(); loadGame(s); play();
  });
  function play() { state = 'play'; touches.clear(); pendingFire = null; show(null); }
  function pause() {
    state = 'pause'; saveGame(); touches.clear(); keys.left = keys.right = false;
    $('pauseStats').innerHTML = statsHTML([['高さ', heightM() + 'm'], ['最高到達', bestH + 'm'], ['タイム', fmtTime(time)], ['落下', falls + '回'], ['発砲', shots + '発']]);
    syncMode(); show('pause');
  }
  function resume() { play(); }
  function win() {
    state = 'clear';
    SFX.win(); buzz(80);
    for (let i = 0; i < 40; i++) parts.push({ x: L.flag.x + 4, y: L.flag.y, vx: rnd(-2, 2), vy: rnd(-3, 0), g: 0.06, life: rnd(40, 80), col: ['#ffec27', '#ff004d', '#00e436', '#29adff', '#fff1e8'][i % 5] });
    store.del(SAVE_KEY);
    if (!bestClear || time < bestClear.time) { bestClear = { time, falls }; store.set(BEST_KEY, bestClear); }
    $('clearStats').innerHTML = statsHTML([['タイム', fmtTime(time)], ['最速', fmtTime(bestClear.time)], ['落下', falls + '回'], ['発砲', shots + '発']]);
    setTimeout(() => show('clear'), 1200);
  }
  $('btnPause').addEventListener('click', pause);
  $('btnResume').addEventListener('click', resume);
  $('btnTitle').addEventListener('click', () => { saveGame(); state = 'title'; refreshTitle(); show('title'); });
  $('btnSound').addEventListener('click', () => { prefs.sound = !prefs.sound; store.set(PREF_KEY, prefs); syncMode(); });
  $('btnAgain').addEventListener('click', () => { newGame(); play(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });
  window.addEventListener('pagehide', saveGame);

  // ---------------------------------------------------------------- layout
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (h / w < 1.3) { VH = 256; scale = h / VH; }
    else { scale = w / VW; VH = Math.round(h / scale); if (VH > 340) { VH = 340; scale = h / VH; } }
    cv.width = VW; cv.height = VH;
    cv.style.width = VW * scale + 'px';
    cv.style.height = VH * scale + 'px';
    cv.style.left = Math.round((w - VW * scale) / 2) + 'px';
    cv.style.top = Math.round((h - VH * scale) / 2) + 'px';
    if (p) cam.y = clampCam(cam.y);
  }
  window.addEventListener('resize', resize);
  resize();
  newGame();
  refreshTitle();
  show('title');

  let last = performance.now(), acc = 0;
  const DT = 1000 / 60;
  function frame(now) {
    acc += Math.min(100, now - last); last = now;
    while (acc >= DT) { update(); acc -= DT; }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

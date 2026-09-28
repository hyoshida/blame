// RECOIL CLIMB — game layer (rendering, input, audio, save). Physics lives in physics.js.
(function () {
  'use strict';
  const { C } = Phys;
  const $ = (id) => document.getElementById(id);
  const VW = 144;
  let VH = 256, scale = 2, dpr = 1;
  const cv = $('game'), ctx = cv.getContext('2d');
  const ui = $('ui'), uctx = ui.getContext('2d');
  const L = Phys.makeLevel(window.LEVEL.ROWS);
  const SIGNS = window.LEVEL.SIGNS;
  const WW = L.w * 8, WH = L.h * 8;
  const START_FEET = Math.floor(L.start.y / 8) * 8 + 8;
  const SUMMIT_FEET = L.flag.y + 8;
  const TOP_FEET = L.gate.y + 8;
  const FONT_UI = "'DotGothic16', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', monospace";

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const SAVE_KEY = 'recoilclimb.save.v3', PREF_KEY = 'recoilclimb.prefs.v1', BEST_KEY = 'recoilclimb.best.v2';
  const prefs = Object.assign({ sound: true, haptics: true }, store.get(PREF_KEY, {}));
  let best = store.get(BEST_KEY, {}); // {summit, heaven} in frames

  // ---------------------------------------------------------------- utils
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtTime = (f) => {
    const s = Math.floor(f / 60), m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const mix = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t).toString(16).padStart(2, '0');
    return '#' + ch(16) + ch(8) + ch(0);
  };

  // ---------------------------------------------------------------- pixel font (3x5, digits for the HUD)
  const FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
    '8': '111101111101111', '9': '111101111001111', 'm': '000000110111101', ':': '000010000010000',
    '/': '001001010100100', '-': '000000111000000',
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
  const LEGS = { idle: ['..p..p..', '..n..n..'], air: ['..pppp..', '.n....n.'], slide: ['.pp..pp.', 'nn....nn'] };
  const HOOD = [['#83769c', '#5f574f'], ['#ffa300', '#ab5236'], ['#ffec27', '#ffa300']];
  const PSPR = HOOD.map(([y, o]) => {
    const out = {};
    for (const k in LEGS) out[k] = sprite(BODY.concat(LEGS[k]), { y, o, f: '#ffccaa', k: '#1d2b53', c: '#ff004d', p: '#7e2553', n: '#ab5236' });
    return out;
  });
  const CRYSTAL = sprite(['...w...', '..waa..', '.waaab.', 'waaaabb', '.aaabb.', '..abb..', '...b...'], { w: '#fff1e8', a: '#00e436', b: '#008751' });
  const CRYSTAL_OFF = sprite(['...d...', '..d.d..', '.d...d.', 'd.....d', '.d...d.', '..d.d..', '...d...'], { d: '#5f574f' });
  const FEATHER = sprite(['.....w', '....ww', '...wwp', '..wwp.', '.wwp..', '.wp...', 'p.....'], { w: '#fff1e8', p: '#ff77a8' });
  const ITEM_SPR = {
    A: sprite(['.bbbbb.', '.bwbwb.', '.bybyb.', '.bybyb.', 'ooooooo', 'ooooooo', '.o...o.'], { b: '#ffa300', w: '#fff1e8', y: '#ffec27', o: '#83769c' }),
    B: sprite(['..rr...', '.rrrr..', 'rrxrrr.', 'rrrxrr.', '.rxrrr.', '..rrw..', '...w...'], { r: '#ab5236', x: '#1a1020', w: '#ffec27' }),
    K: sprite(['...w...', '..wbw..', '.wbbbw.', '..bbb..', '..bbb..', '..bbb..', '..w.w..'], { w: '#c6ecff', b: '#29adff' }),
    M: sprite(['...r...', '..rrr..', '..rwr..', '..rrr..', '.yyyyy.', '.yyyyy.', '.ooooo.'], { r: '#ff004d', w: '#ff77a8', y: '#ffa300', o: '#ab5236' }),
  };
  const SIGN = sprite(['........', '.bbbbbb.', '.bllllb.', '.bbbbbb.', '...pp...', '...pp...', '...pp...', '...pp...'], { b: '#ab5236', l: '#ffccaa', p: '#5f574f' });

  // ---------------------------------------------------------------- tile layer (pre-rendered, patched when cracks break)
  const tiles = document.createElement('canvas');
  tiles.width = WW; tiles.height = WH;
  const tg = tiles.getContext('2d');
  const SPIKE_UP = (x, y) => (y === 5 && (x === 1 || x === 5)) ? '#fff1e8'
    : (y === 6 && x !== 3 && x !== 7) ? '#c2c3c7' : (y === 7 ? '#83769c' : null);
  const CRACK = ['..#.....', '...#..#.', '...##.#.', '.#...#..', '..#..#..', '.##...#.', '#....#..', '.....#..'];
  function drawTile(tx, ty) {
    const bx = tx * 8, by = ty * 8;
    tg.clearRect(bx, by, 8, 8);
    const ch = L.grid[ty][tx];
    const px = (x, y, col) => { tg.fillStyle = col; tg.fillRect(bx + x, by + y, 1, 1); };
    const at = (dx, dy) => Phys.tileAt(L, tx + dx, ty + dy);
    const same = (dx, dy) => at(dx, dy) === ch;
    if (ch === '#' || ch === '=') {
      const s = (dx, dy) => { const c = at(dx, dy); return c === '#' || c === '=' || c === 'x' || c === 'm'; };
      const T = !s(0, -1), B = !s(0, 1), Lf = !s(-1, 0), R = !s(1, 0);
      const deep = !T && !B && !Lf && !R && s(-1, -1) && s(1, -1) && s(-1, 1) && s(1, 1);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if ((T && Lf && x === 0 && y === 0) || (T && R && x === 7 && y === 0) || (B && Lf && x === 0 && y === 7) || (B && R && x === 7 && y === 7)) continue;
        const h = hash(bx + x, by + y);
        let col;
        if (ch === '=') {
          if (T && y === 0) col = '#fff1e8';
          else if (B && y === 7) col = '#16609a';
          else if ((Lf && x === 0) || (R && x === 7)) col = '#c6ecff';
          else if ((x + y) % 6 === 0 && y < 6) col = '#c6ecff';
          else col = y < 4 ? '#29adff' : '#1f86c9';
        } else if (deep) {
          col = h < 0.1 ? '#26325f' : h < 0.14 ? '#10173a' : '#1a2350';
        } else {
          if (T && y === 0) col = '#fff1e8';
          else if (T && y === 1) col = h < 0.55 ? '#fff1e8' : '#c2c3c7';
          else if (T && y === 2 && h < 0.18) col = '#c2c3c7';
          else if ((Lf && x === 0) || (R && x === 7)) col = '#83769c';
          else if (B && y === 7) col = '#3b4a7a';
          else if ((Lf && x === 1) || (R && x === 6) || (B && y === 6) || (T && y <= 3)) col = '#2b3a6b';
          else col = h < 0.07 ? '#2b3a6b' : h > 0.975 ? '#7e2553' : '#1d2b53';
        }
        px(x, y, col);
      }
    } else if (ch === 'x') {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const edge = x === 0 || y === 0 || x === 7 || y === 7;
        px(x, y, CRACK[y][x] === '#' ? '#1a1020' : edge ? '#ab5236' : (hash(bx + x, by + y) < 0.2 ? '#8a4a3a' : '#6b3a3a'));
      }
    } else if (ch === 'm') {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let col = '#c2c3c7';
        if (y === 0 && !same(0, -1)) col = '#fff1e8';
        else if (y === 7 && !same(0, 1)) col = '#5f574f';
        else if ((x === 0 && !same(-1, 0)) || (x === 7 && !same(1, 0))) col = '#83769c';
        else if ((x === 2 || x === 5) && y === 3) col = '#83769c';
        else if (x + y === 9 || x + y === 10) col = '#e6e7ea';
        px(x, y, col);
      }
    } else if (ch === 'g') {
      tg.fillStyle = 'rgba(41,173,255,0.22)'; tg.fillRect(bx, by, 8, 8);
      for (let i = 0; i < 8; i++) {
        if (!same(0, -1)) px(i, 0, '#c6ecff');
        if (!same(0, 1)) px(i, 7, '#6fb8e8');
        if (!same(-1, 0)) px(0, i, '#c6ecff');
        if (!same(1, 0)) px(7, i, '#6fb8e8');
      }
      px(2, 2, '#fff1e8'); px(3, 1, '#fff1e8'); px(5, 5, '#c6ecff');
    } else if (ch === 'c') {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const lc = !same(-1, 0), rc = !same(1, 0);
        if ((lc && x === 0 && (y < 2 || y > 5)) || (rc && x === 7 && (y < 2 || y > 5))) continue;
        px(x, y, y > 4 ? '#ffccaa' : y === 0 ? '#ffffff' : '#fff1e8');
      }
    } else if (ch === 'd') {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let col = (x % 3 === 1) ? '#7e2553' : '#ff004d';
        if (y === 0 && !same(0, -1)) col = '#ff77a8';
        if (y === 7 && !same(0, 1)) col = '#7e2553';
        px(x, y, col);
      }
    } else if (ch === 'T' || ch === 't') {
      const hit = ch === 't';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const r = Math.hypot(x - 3.5, y - 3.5);
        const ring = r < 1.5 ? 0 : r < 2.6 ? 1 : r < 3.8 ? 2 : 3;
        const col = hit ? ['#5f574f', '#83769c', '#5f574f', '#1d2b53'][ring] : ['#ff004d', '#fff1e8', '#ff004d', '#7e2553'][ring];
        px(x, y, col);
      }
    } else if ('^v<>'.includes(ch)) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const col = ch === '^' ? SPIKE_UP(x, y) : ch === 'v' ? SPIKE_UP(x, 7 - y) : ch === '>' ? SPIKE_UP(y, 7 - x) : SPIKE_UP(7 - y, x);
        if (col) px(x, y, col);
      }
    }
  }
  function redrawAround(tx, ty) {
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++)
      if (x >= 0 && y >= 0 && x < L.w && y < L.h) drawTile(x, y);
  }
  for (let ty = 0; ty < L.h; ty++) for (let tx = 0; tx < L.w; tx++) drawTile(tx, ty);
  const origGrid = L.grid.map((r) => r.slice());
  L.onChange = (tx, ty) => redrawAround(tx, ty);
  function resetWorld() {
    while (L.changes.length) { const [tx, ty] = L.changes.pop(); L.grid[ty][tx] = origGrid[ty][tx]; redrawAround(tx, ty); }
    for (const t of L.targets) t.hit = false;
    for (const c of L.crystals) { c.active = true; c.t = 0; }
    for (const r of L.relics) r.got = false;
    for (const it of L.items) it.got = false;
  }

  // ---------------------------------------------------------------- background
  const stars = [...Array(90)].map(() => ({ x: rnd(0, 400), y: rnd(0, 900), tw: rnd(0, 6.28), b: Math.random() }));
  const flakes = [...Array(36)].map(() => ({ x: rnd(0, VW), y: rnd(0, 400), sp: rnd(0.15, 0.5), ph: rnd(0, 6.28), big: Math.random() < 0.2 }));
  const ridge = (x, seed, amp) => Math.abs(Math.sin(x * 0.045 + seed)) * amp + Math.sin(x * 0.13 + seed * 2) * amp * 0.25 + Math.sin(x * 0.31 + seed) * 2;

  // ---------------------------------------------------------------- audio
  let actx = null, noiseBuf = null;
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
    shot(pow) { noise(0.1 + pow * 0.06, 0.25 + pow * 0.2, 1600 + pow * 1400); tone({ f: 120 + pow * 40, f2: 40, d: 0.12, v: 0.13 }); },
    click() { tone({ f: 1200, d: 0.025, v: 0.05 }); },
    land() { tone({ f: 95, f2: 50, d: 0.07, type: 'triangle', v: 0.25 }); },
    crystal() { [660, 990, 1320].forEach((f, i) => tone({ f, d: 0.09, type: 'triangle', v: 0.12, delay: i * 0.05 })); },
    ping() { tone({ f: 2200, f2: 1600, d: 0.08, type: 'triangle', v: 0.08 }); },
    crumble() { noise(0.3, 0.45, 900); tone({ f: 70, f2: 40, d: 0.25, type: 'triangle', v: 0.2 }); },
    die() { tone({ f: 520, f2: 90, d: 0.35, type: 'sawtooth', v: 0.08 }); noise(0.2, 0.2, 3000); },
    respawn() { [392, 523].forEach((f, i) => tone({ f, d: 0.08, type: 'triangle', v: 0.08, delay: i * 0.06 })); },
    clank() { tone({ f: 180, f2: 150, d: 0.06, type: 'square', v: 0.07 }); tone({ f: 900, d: 0.03, type: 'square', v: 0.04 }); },
    door() { noise(0.35, 0.3, 700); [220, 330, 440].forEach((f, i) => tone({ f, d: 0.12, type: 'square', v: 0.06, delay: 0.1 + i * 0.08 })); },
    item() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ f, d: 0.12, type: 'square', v: 0.07, delay: i * 0.07 })); },
    relic() { [784, 988, 1175, 1568].forEach((f, i) => tone({ f, d: 0.14, type: 'triangle', v: 0.1, delay: i * 0.07 })); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, d: 0.18, v: 0.07, delay: i * 0.1 })); },
  };
  // ---------------------------------------------------------------- haptics
  // Android: Vibration API with patterns (durations stand in for strength).
  // iOS Safari has no Vibration API, but toggling an <input type="checkbox" switch>
  // (Safari 17.4+) plays the system tick. It is one fixed tick, most reliable inside a
  // touch handler, so pulses in a pattern become separate ticks.
  const Haptics = (() => {
    const canVibrate = typeof navigator.vibrate === 'function';
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let lastTick = 0;
    function iosTick() {
      const now = performance.now();
      if (now - lastTick < 45) return;
      lastTick = now;
      try {
        const label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        label.appendChild(input);
        document.head.appendChild(label);
        label.click();
        document.head.removeChild(label);
      } catch (e) { /* ignore */ }
    }
    function play(pattern, iosTicks) {
      if (!prefs.haptics) return;
      const arr = Array.isArray(pattern) ? pattern : [pattern];
      if (canVibrate) { try { navigator.vibrate(arr); } catch (e) { /* ignore */ } return; }
      if (!isIOS || iosTicks === 0) return;
      let t = 0, n = 0;
      const max = iosTicks == null ? 3 : iosTicks;
      for (let i = 0; i < arr.length && n < max; i += 2, n++) {
        if (t === 0) iosTick(); else setTimeout(iosTick, t);
        t += arr[i] + (arr[i + 1] || 0);
      }
    }
    return { play, supported: canVibrate || isIOS };
  })();
  // Named feel for each moment. [on, off, on, ...] in ms; second value = max iOS ticks.
  const HAPTIC = {
    aimFull: () => Haptics.play(8, 1),
    shot: (pow, magnum) => Haptics.play(Math.round(10 + pow * 16 + (magnum ? 12 : 0)), 1),
    empty: () => Haptics.play([4, 40, 4], 1),
    land: (v) => { if (v > 3.6) Haptics.play(24, 1); else if (v > 2.2) Haptics.play(10, 0); },
    crystal: () => Haptics.play([8, 30, 14], 2),
    remote: () => Haptics.play([8, 25, 8, 25, 18], 3),
    clank: () => Haptics.play(6, 0),
    crumble: () => Haptics.play([35, 25, 20], 2),
    target: () => Haptics.play([15, 50, 40], 2),
    die: () => Haptics.play([50, 30, 20], 2),
    respawn: () => Haptics.play(8, 1),
    relic: () => Haptics.play([10, 40, 10, 40, 30], 3),
    item: () => Haptics.play([20, 60, 20, 60, 20, 60, 90], 3),
    summit: () => Haptics.play([40, 60, 40, 60, 120], 3),
    heaven: () => Haptics.play([60, 80, 60, 80, 60, 80, 200], 3),
  };

  // ---------------------------------------------------------------- game state
  let state = 'title';
  let p, abil = Phys.newAbil(), time = 0, misses = 0, shots = 0, bestH = 0, summitDone = false, tick = 0;
  let hintSeen = {};
  let safe = null, deadT = 0;
  const cam = { x: 0, y: 0, px: 0, py: 0 };
  let shake = 0, flash = null;
  let parts = [], tracers = [], toasts = [];
  let aim = { x: 0.7, y: 0.7 }, pow = 1;
  let stick = null; // {id, ox, oy, x, y}
  let pendingFire = null;
  const STICK_MIN = 4, STICK_FULL = 34;

  const surfaceAt = (tx, ty) => { const c = Phys.tileAt(L, tx, ty); return !Phys.isSolid(c) && !'^v<>'.includes(c) && Phys.isSolid(Phys.tileAt(L, tx, ty + 1)); };
  function placeAt(tx, ty) { p = Phys.newPlayer(tx * 8 + 1, ty * 8 + 8 - C.PH - 0.0001, abil); p.grounded = true; }
  const heightOf = (feet) => Math.max(0, Math.round((START_FEET - feet) / 8));
  const heightM = () => heightOf(p.y + C.PH);
  const clampCamX = (x) => clamp(x, 0, WW - VW);
  const clampCamY = (y) => clamp(y, 0, WH - VH);
  function snapCam() { cam.x = clampCamX(p.x + 3 - VW / 2); cam.y = clampCamY(p.y + 4 - VH * 0.55); cam.px = cam.x; cam.py = cam.y; }

  function newGame() {
    resetWorld();
    abil = Phys.newAbil();
    hintSeen = {};
    placeAt(Math.floor(L.start.x / 8), Math.floor(L.start.y / 8));
    // debug: #row60 starts on the first ledge at/below that row, with every item found below it
    const m = /row(\d+)/.exec(location.hash);
    if (m) {
      const row = +m[1];
      L.items.forEach((it) => { if (it.y / 8 > row) { it.got = true; Phys.grantItem(abil, it.type); } });
      L.targets.forEach((t, i) => { if (t.ty > row) Phys.openTarget(L, i); });
      outer: for (let ty = row; ty < L.h; ty++) for (let tx = L.w - 1; tx >= 0; tx--) if (surfaceAt(tx, ty)) { placeAt(tx, ty); break outer; }
    }
    const at = /at(\d+),(\d+)/.exec(location.hash); // debug: #at52,165 starts on that exact tile
    if (at) placeAt(+at[1], +at[2]);
    time = 0; misses = 0; shots = 0; bestH = 0; summitDone = false;
    safe = { x: p.x, y: p.y }; deadT = 0;
    parts = []; tracers = []; toasts = [];
    snapCam();
  }
  function loadGame(s) {
    newGame();
    for (const [tx, ty] of s.cracks || []) if (L.grid[ty] && L.grid[ty][tx] === 'x') Phys.setTile(L, tx, ty, '.');
    for (const i of s.targets || []) if (L.targets[i]) Phys.openTarget(L, i);
    for (const i of s.relics || []) if (L.relics[i]) L.relics[i].got = true;
    for (const i of s.items || []) if (L.items[i]) L.items[i].got = true;
    abil = Object.assign(Phys.newAbil(), s.abil || {});
    hintSeen = s.hints || {};
    const sp = s.safe;
    p = Phys.newPlayer(sp.x, sp.y, abil);
    time = s.time || 0; misses = s.misses || 0; shots = s.shots || 0; bestH = s.bestH || 0;
    summitDone = !!s.summit;
    safe = { x: sp.x, y: sp.y };
    snapCam();
  }
  function saveGame() {
    if (!p || state === 'title' || state === 'heaven') return;
    store.set(SAVE_KEY, {
      safe, time, misses, shots, bestH, summit: summitDone, abil, hints: hintSeen,
      cracks: L.changes.filter((c) => c[2] === 'x').map((c) => [c[0], c[1]]),
      targets: L.targets.map((t, i) => (t.hit ? i : -1)).filter((i) => i >= 0),
      items: L.items.map((t, i) => (t.got ? i : -1)).filter((i) => i >= 0),
      relics: L.relics.map((r, i) => (r.got ? i : -1)).filter((i) => i >= 0),
    });
  }
  const relicCount = () => L.relics.filter((r) => r.got).length;

  // ---------------------------------------------------------------- effects
  function burst(x, y, n, cols, sp = 1.2, g = 0.05, life = 16) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = rnd(0.3, sp);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g, life: life + rnd(0, 8), col: cols[i % cols.length] });
    }
  }
  function toast(text, wx, wy, col = '#fff1e8', life = 70) { toasts.push({ text, x: wx, y: wy, col, life, max: life }); }
  function updateFx() {
    for (const q of parts) {
      q.vy += q.g; q.x += q.vx; q.y += q.vy; q.life--;
      if (q.collide && Phys.isSolid(Phys.tileAt(L, Math.floor(q.x / 8), Math.floor(q.y / 8)))) { q.y -= q.vy; q.vy *= -0.4; q.vx *= 0.6; }
    }
    parts = parts.filter((q) => q.life > 0);
    tracers = tracers.filter((t) => --t.life > 0);
    toasts = toasts.filter((t) => { t.y -= 0.2; return --t.life > 0; });
    if (flash && --flash.life <= 0) flash = null;
  }

  // ---------------------------------------------------------------- input
  function toInternal(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  function stickVec() {
    if (!stick) return null;
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, l = Math.hypot(dx, dy);
    if (l < STICK_MIN) return null;
    return { dx: dx / l, dy: dy / l, pow: C.MINPOW + (1 - C.MINPOW) * clamp((l - STICK_MIN) / (STICK_FULL - STICK_MIN), 0, 1), len: l };
  }
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audioUnlock();
    if (stick || state !== 'play') return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const pt = toInternal(e);
    stick = { id: e.pointerId, ox: pt.x, oy: pt.y, x: pt.x, y: pt.y };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!stick || e.pointerId !== stick.id) return;
    const pt = toInternal(e);
    stick.x = pt.x; stick.y = pt.y;
    const v = stickVec();
    if (v) { aim = { x: v.dx, y: v.dy }; pow = v.pow; }
    const full = !!v && v.pow >= 0.999;
    if (full && !stick.full) HAPTIC.aimFull();
    stick.full = full;
  });
  function endStick(e, cancel) {
    if (!stick || e.pointerId !== stick.id) return;
    const v = stickVec();
    stick = null;
    if (!cancel && v && state === 'play') {
      pendingFire = { dx: v.dx, dy: v.dy, pow: v.pow, ttl: 6 };
      if (p && !p.dead) { if (p.ammo > 0) HAPTIC.shot(v.pow, abil.magnum); else HAPTIC.empty(); }
    }
  }
  cv.addEventListener('pointerup', (e) => endStick(e, false));
  cv.addEventListener('pointercancel', (e) => endStick(e, true));
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'play') pause(); else if (state === 'pause') resume();
      e.preventDefault();
    }
  });
  const aiming = () => state === 'play' && !!stickVec() && !p.dead;

  // ---------------------------------------------------------------- update
  function onShot(e) {
    shots++;
    const cx = p.x + 3, cy = p.y + 4;
    const s0 = e.segs[0];
    const d0 = Math.hypot(s0.x1 - s0.x0, s0.y1 - s0.y0);
    const mz = Math.min(7, d0);
    tracers.push({ segs: e.segs, skip: mz, life: 6 });
    flash = { x: cx + e.dx * mz, y: cy + e.dy * mz, life: 3 };
    for (const h of e.hits) {
      if (h.t === 'wall') for (let i = 0; i < 6; i++) parts.push({ x: h.x - h.dx * 2, y: h.y - h.dy * 2, vx: -h.dx * rnd(0.3, 1.5) + rnd(-0.8, 0.8), vy: -h.dy * rnd(0.3, 1.5) + rnd(-0.8, 0.8), g: 0.08, life: rnd(8, 16), col: i % 2 ? '#ffec27' : '#fff1e8' });
      else if (h.t === 'ping') { burst(h.x, h.y, 4, ['#fff1e8', '#c2c3c7'], 0.8, 0, 8); SFX.ping(); }
      else if (h.t === 'break') {
        const bx = h.tx * 8 + 4, by = h.ty * 8 + 4;
        for (let i = 0; i < 14; i++) parts.push({ x: bx + rnd(-3, 3), y: by + rnd(-3, 3), vx: rnd(-1.2, 1.2), vy: rnd(-1.8, 0.3), g: 0.12, life: rnd(30, 60), col: ['#ab5236', '#6b3a3a', '#1a1020'][i % 3], collide: true });
        SFX.crumble(); shake = Math.max(shake, 5); later(HAPTIC.crumble);
      } else if (h.t === 'crystal') {
        burst(h.x, h.y, 12, ['#00e436', '#fff1e8'], 1.4, 0, 16);
        toast('補給！', h.x, h.y - 8, '#00e436', 50);
        SFX.crystal(); later(HAPTIC.remote);
      } else if (h.t === 'clank' || h.t === 'glass') {
        burst(h.x, h.y, 4, h.t === 'glass' ? ['#c6ecff', '#fff1e8'] : ['#ab5236', '#fff1e8'], 0.8, 0.05, 10);
        SFX.clank(); later(HAPTIC.clank);
        const key = h.t;
        if (!hintSeen[key]) { hintSeen[key] = 1; toast(h.t === 'glass' ? 'ガラスに弾かれた' : 'かたい…いまは壊せない', h.x, h.y - 8, '#c2c3c7', 90); }
      } else if (h.t === 'target') {
        const t = L.targets[h.i];
        burst(h.x, h.y, 10, ['#ff004d', '#fff1e8'], 1.2, 0, 16);
        for (const [dx, dy] of t.doors) burst(dx * 8 + 4, dy * 8 + 4, 5, ['#ff004d', '#7e2553', '#ff77a8'], 1, 0.08, 24);
        toast('ガコン！', h.x, h.y - 8, '#ff77a8', 60);
        const d0 = t.doors[0];
        if (d0) toast('扉が開いた', d0[0] * 8 + 16, d0[1] * 8 - 4, '#ff77a8', 90);
        SFX.door(); shake = Math.max(shake, 5); later(HAPTIC.target);
      }
    }
    burst(flash.x, flash.y, 4, ['#c2c3c7'], 0.4, -0.01, 16);
    parts.push({ x: cx, y: cy, vx: -e.dy * rnd(0.6, 1.2) * (Math.random() < 0.5 ? 1 : -1), vy: -1.6, g: 0.15, life: 50, col: '#ffa300', collide: true });
    shake = Math.max(shake, 2 + Math.round(pow * 2));
    SFX.shot(pow);
  }
  // after a shot, let the release tick finish before the follow-up pattern
  const later = (fn) => setTimeout(fn, 70);
  function isSafeSpot() {
    if (!p.grounded || Math.abs(p.vx) > 0.2) return false;
    const x0 = Math.floor(p.x / 8) - 1, x1 = Math.floor((p.x + C.PW) / 8) + 1;
    const y0 = Math.floor(p.y / 8) - 1, y1 = Math.floor((p.y + C.PH) / 8) + 1;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if ('^v<>'.includes(Phys.tileAt(L, tx, ty))) return false;
    return true;
  }
  function update() {
    tick++;
    if (state === 'pause' || state === 'title') { cameraFollow(0.05); return; }
    updateFx();
    Phys.tickWorld(L);
    if (state !== 'play') { cameraFollow(0.05); return; }
    time++;
    if (p.dead) {
      if (--deadT <= 0) {
        p = Phys.newPlayer(safe.x, safe.y, abil); p.grounded = true;
        burst(p.x + 3, p.y + 4, 10, ['#fff1e8', '#ffec27'], 1, 0, 14);
        SFX.respawn(); HAPTIC.respawn();
      }
      cameraFollow(0.08);
      return;
    }
    const ev = [];
    let fire = null;
    if (pendingFire) { fire = pendingFire; pow = pendingFire.pow; aim = { x: pendingFire.dx, y: pendingFire.dy }; }
    Phys.step(L, p, { fire }, ev);
    let shot = false;
    for (const e of ev) {
      if (e.t === 'shot') { shot = true; onShot(e); }
      else if (e.t === 'land') {
        if (e.v > 2) { burst(p.x + 3, p.y + C.PH, 5, ['#c2c3c7'], 0.7, 0.03, 12); SFX.land(); }
        HAPTIC.land(e.v);
      } else if (e.t === 'die') {
        misses++; deadT = 40;
        burst(p.x + 3, p.y + 4, 16, ['#ff004d', '#fff1e8', '#ffec27'], 1.8, 0.04, 20);
        toast('ミス', p.x + 3, p.y - 6, '#ff004d', 50);
        SFX.die(); shake = 6; HAPTIC.die();
        pendingFire = null;
      } else if (e.t === 'crystal') {
        burst(e.x, e.y, 10, ['#00e436', '#fff1e8'], 1.2, 0, 16);
        SFX.crystal(); HAPTIC.crystal();
      } else if (e.t === 'relic') {
        burst(e.x, e.y, 18, ['#fff1e8', '#ff77a8', '#ffec27'], 1.6, 0, 26);
        toast('羽根 ' + relicCount() + '/' + L.relics.length, e.x, e.y - 8, '#ff77a8', 90);
        SFX.relic(); HAPTIC.relic(); saveGame();
      } else if (e.t === 'item') {
        burst(e.x, e.y, 24, ['#ffec27', '#fff1e8', '#ffa300'], 2, 0, 30);
        SFX.item(); HAPTIC.item();
        itemGet(e.type);
      } else if (e.t === 'flag') summit();
      else if (e.t === 'heaven') heaven();
    }
    if (pendingFire && !shot) {
      if (p.ammo <= 0) { SFX.click(); toast('弾切れ', p.x + 3, p.y - 6, '#83769c', 30); pendingFire = null; }
      else if (--pendingFire.ttl <= 0) pendingFire = null;
    } else pendingFire = null;

    if (!p.dead && isSafeSpot()) { safe.x = p.x; safe.y = p.y; }
    if (p.grounded && Math.abs(p.vx) > 0.6 && tick % 4 === 0) burst(p.x + 3, p.y + C.PH, 1, ['#83769c'], 0.3, 0, 10);
    bestH = Math.max(bestH, heightM());
    if (tick % 90 === 0) saveGame();
    cameraFollow(0.12);
  }
  function cameraFollow(k) {
    if (!p) return;
    cam.px = cam.x; cam.py = cam.y;
    const look = clamp(p.vx * 10, -24, 24);
    cam.x += (clampCamX(p.x + 3 - VW / 2 + look) - cam.x) * k;
    cam.y += (clampCamY(p.y + 4 - VH * 0.55) - cam.y) * k;
  }

  // ---------------------------------------------------------------- render
  function drawBackground() {
    const alt = clamp((START_FEET - (cam.y + VH / 2)) / (START_FEET - TOP_FEET), 0, 1);
    const dawn = clamp((alt - 0.72) / 0.28, 0, 1);
    const gr = ctx.createLinearGradient(0, 0, 0, VH);
    gr.addColorStop(0, mix(mix('#0d1030', '#2a1446', alt), '#7e2553', dawn));
    gr.addColorStop(1, mix(mix('#1a2150', '#5a2458', alt), '#ffa300', dawn * 0.8));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, VW, VH);
    for (const s of stars) {
      const x = Math.round(((s.x - cam.x * 0.1) % 400 + 400) % 400) - 128;
      const y = Math.round(((s.y - cam.y * 0.1) % 900 + 900) % 900) - 300;
      if (x < 0 || x >= VW || y < 0 || y >= VH) continue;
      const on = Math.sin(tick * 0.03 + s.tw) > -0.2;
      ctx.fillStyle = s.b > 0.85 && on ? '#fff1e8' : s.b > 0.5 ? '#83769c' : '#3b3f78';
      ctx.fillRect(x, y, 1, 1);
    }
    const climb = WH - VH - cam.y;
    const layers = [[0.22, 1.3, 46, '#262a5e', '#6a6a9e', 0.2], [0.4, 4.1, 30, '#31265f', '#4a3f7a', 0.35]];
    for (const [par, seed, amp, col, cap, px] of layers) {
      const base = VH - 8 + climb * par;
      if (base - amp - 10 > VH) continue;
      for (let x = 0; x < VW; x++) {
        const wx = x + cam.x * px;
        const top = Math.round(base - ridge(wx, seed, amp));
        if (top >= VH) continue;
        ctx.fillStyle = col; ctx.fillRect(x, top, 1, VH - top);
        if (ridge(wx, seed, amp) > amp * 0.8) { ctx.fillStyle = cap; ctx.fillRect(x, top, 1, 2); }
      }
    }
  }
  function drawSnow() {
    const dx = cam.x - cam.px, dy = cam.y - cam.py;
    for (const f of flakes) {
      f.y += f.sp - dy * 0.4;
      f.x += Math.sin(tick * 0.02 + f.ph) * 0.25 - dx * 0.4;
      if (f.y > VH) { f.y -= VH + 4; f.x = rnd(0, VW); }
      if (f.y < -4) f.y += VH + 4;
      if (f.x < 0) f.x += VW; if (f.x >= VW) f.x -= VW;
      const wx = Math.floor((f.x + cam.x) / 8), wy = Math.floor((f.y + cam.y) / 8);
      if (Phys.isSolid(Phys.tileAt(L, wx, wy))) continue; // no snow drawn over rock
      ctx.fillStyle = f.big ? '#fff1e8' : '#c2c3c7';
      ctx.fillRect(Math.round(f.x), Math.round(f.y), f.big ? 2 : 1, f.big ? 2 : 1);
    }
  }
  function dotted(segs, maxLen, col, stepPx, skip = 0) {
    ctx.fillStyle = col;
    let acc = 0;
    for (const s of segs) {
      const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      for (let i = 0; i <= d; i += 1) {
        acc += 1;
        if (acc > maxLen) return;
        if (acc < skip || acc % stepPx >= 1) continue;
        ctx.fillRect(Math.round(s.x0 + (s.x1 - s.x0) * i / d), Math.round(s.y0 + (s.y1 - s.y0) * i / d), 1, 1);
      }
    }
  }
  function drawPreview() {
    const v = stickVec();
    if (!v || state !== 'play' || p.dead) return;
    const bullet = Phys.fireBullet(L, p, v.dx, v.dy, true);
    ctx.globalAlpha = 0.6;
    dotted(bullet.segs, 72, '#fff1e8', 3, 9);
    ctx.globalAlpha = 1;
    // light up whatever this shot would hit (crystals refill, targets open doors)
    const blink = Math.floor(tick / 4) % 2 === 0;
    for (const h of bullet.hits) {
      let x = null, y = null, col = null;
      if (h.t === 'crystal') { x = h.x; y = h.y; col = '#00e436'; }
      else if (h.t === 'target') { x = h.tx * 8 + 4; y = h.ty * 8 + 4; col = '#ff77a8'; }
      else if (h.t === 'break') { x = h.tx * 8 + 4; y = h.ty * 8 + 4; col = '#ffa300'; }
      if (x === null) continue;
      ctx.strokeStyle = blink ? col : '#fff1e8'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) - 5.5, Math.round(y) - 5.5, 11, 11);
    }
    if (p.ammo <= 0) return;
    // predicted flight after this shot
    const q = Object.assign({}, p);
    Phys.step(L, q, { fire: { dx: v.dx, dy: v.dy, pow: v.pow } }, null, true);
    for (let f = 1; f < 46; f++) {
      Phys.step(L, q, null, null, true);
      if (q.dead) { ctx.fillStyle = '#ff004d'; ctx.fillRect(Math.round(q.x + 1), Math.round(q.y + 2), 1, 1); ctx.fillRect(Math.round(q.x + 3), Math.round(q.y + 2), 1, 1); ctx.fillRect(Math.round(q.x + 2), Math.round(q.y + 3), 1, 1); ctx.fillRect(Math.round(q.x + 1), Math.round(q.y + 4), 1, 1); ctx.fillRect(Math.round(q.x + 3), Math.round(q.y + 4), 1, 1); break; }
      if (f % 3 === 0) {
        ctx.globalAlpha = 1 - f / 52;
        ctx.fillStyle = '#000';
        ctx.fillRect(Math.round(q.x + 3), Math.round(q.y + 4), 2, 2);
        ctx.fillStyle = f < 24 ? '#ffec27' : '#ffa300';
        ctx.fillRect(Math.round(q.x + 2), Math.round(q.y + 3), 2, 2);
        ctx.globalAlpha = 1;
      }
      if (q.grounded && f > 3) { ctx.fillStyle = '#ffec27'; ctx.fillRect(Math.round(q.x), Math.round(q.y + C.PH - 1), 6, 1); break; }
    }
  }
  function drawPlayer() {
    if (p.dead) return;
    const face = aim.x >= 0 ? 1 : -1;
    const legs = !p.grounded ? 'air' : Math.abs(p.vx) > 0.4 ? 'slide' : 'idle';
    const spr = PSPR[p.ammo <= 0 ? 0 : p.ammo >= Phys.maxAmmo(p) ? 2 : 1][legs];
    const x = Math.round(p.x) - 1, y = Math.round(p.y) - 1;
    ctx.save();
    if (face < 0) { ctx.translate(x + 8, y); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0); }
    else ctx.drawImage(spr, x, y);
    ctx.restore();
    const cx = Math.round(p.x + 3), cy = Math.round(p.y + 4);
    for (let d = 2; d <= 7; d++) {
      ctx.fillStyle = d >= 6 ? '#fff1e8' : '#83769c';
      ctx.fillRect(Math.round(cx + aim.x * d), Math.round(cy + aim.y * d), 1, 1);
    }
    // shots left, over the head (always while airborne or aiming)
    if (!p.grounded || aiming()) {
      for (let i = 0; i < Phys.maxAmmo(p); i++) {
        const has = i < p.ammo;
        const bx = Math.round(p.x) + i * 4, by = Math.round(p.y) - 5;
        ctx.fillStyle = '#000'; ctx.fillRect(bx, by, 3, 3);
        ctx.fillStyle = has ? '#ffa300' : '#5f574f'; ctx.fillRect(bx, by, 2, 2);
      }
    }
  }
  function drawWorld() {
    ctx.drawImage(tiles, 0, 0);
    for (const s of L.signs) ctx.drawImage(SIGN, s.x, s.y);
    for (const c of L.crystals) {
      const bob = c.active ? Math.round(Math.sin(tick / 14 + c.x) * 1.5) : 0;
      ctx.drawImage(c.active ? CRYSTAL : CRYSTAL_OFF, c.x - 3, c.y - 3 + bob);
      if (c.active && tick % 40 < 3) { ctx.fillStyle = '#fff1e8'; ctx.fillRect(c.x + 2, c.y - 4 + bob, 1, 1); }
    }
    for (const it of L.items) {
      if (it.got) continue;
      const bob = Math.round(Math.sin(tick / 16 + it.x) * 1.5);
      const glow = (Math.sin(tick / 10) + 1) / 2;
      ctx.globalAlpha = 0.25 + glow * 0.3;
      ctx.fillStyle = '#ffec27'; ctx.fillRect(it.x - 6, it.y - 6 + bob, 13, 13);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#5f574f'; ctx.fillRect(it.x - 4, it.y + 4, 9, 1);
      ctx.drawImage(ITEM_SPR[it.type], it.x - 3, it.y - 4 + bob);
      if (tick % 30 < 3) { ctx.fillStyle = '#fff1e8'; ctx.fillRect(it.x + 3, it.y - 6 + bob, 1, 1); }
    }
    for (const r of L.relics) {
      if (r.got) continue;
      const bob = Math.round(Math.sin(tick / 20 + r.x) * 1.5);
      ctx.drawImage(FEATHER, r.x - 3, r.y - 3 + bob);
      if (tick % 50 < 4) { ctx.fillStyle = '#ffec27'; ctx.fillRect(r.x + 3, r.y - 4 + bob, 1, 1); }
    }
    { // summit flag
      const { x, y } = L.flag;
      ctx.fillStyle = '#c2c3c7'; ctx.fillRect(x + 1, y, 1, 8);
      for (let i = 0; i < 5; i++) {
        const w = Math.round(Math.sin(tick / 8 - i * 0.9) * 0.8);
        ctx.fillStyle = summitDone ? (i === 0 ? '#ffec27' : '#ffa300') : (i === 0 ? '#ff77a8' : '#ff004d');
        ctx.fillRect(x + 2 + i, y + w, 1, 3);
      }
    }
    { // heaven gate
      const { x, y } = L.gate;
      const glow = Math.sin(tick / 15) * 0.5 + 0.5;
      ctx.globalAlpha = 0.25 + glow * 0.25;
      ctx.fillStyle = '#ffec27'; ctx.fillRect(x - 2, y - 10, 12, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffa300';
      ctx.fillRect(x, y - 6, 1, 14); ctx.fillRect(x + 7, y - 6, 1, 14);
      ctx.fillRect(x + 1, y - 8, 6, 1); ctx.fillRect(x, y - 7, 1, 1); ctx.fillRect(x + 7, y - 7, 1, 1);
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(x + 3, y - 3 + Math.round(glow * 2), 2, 2);
    }
    for (const t of tracers) dotted(t.segs, 999, t.life > 4 ? '#fff1e8' : t.life > 2 ? '#ffec27' : '#ffa300', 1, t.skip);
    drawPreview();
    if (p) drawPlayer();
    if (flash) {
      ctx.fillStyle = '#ffec27'; ctx.fillRect(Math.round(flash.x) - 1, Math.round(flash.y) - 1, 3, 3);
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(Math.round(flash.x), Math.round(flash.y), 1, 1);
    }
    for (const q of parts) { ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); }
  }
  function drawHUD() {
    const top = 4;
    drawText(heightM() + 'm', 4, top, '#fff1e8');
    for (let i = 0; i < Phys.maxAmmo(p); i++) {
      const full = i < p.ammo;
      ctx.fillStyle = '#000'; ctx.fillRect(5 + i * 5, top + 9, 3, 5);
      ctx.fillStyle = full ? '#ffa300' : '#5f574f'; ctx.fillRect(4 + i * 5, top + 8, 3, 5);
      if (full) { ctx.fillStyle = '#ffec27'; ctx.fillRect(4 + i * 5, top + 8, 3, 1); }
    }
    const tt = fmtTime(time);
    drawText(tt, Math.round((VW - textW(tt)) / 2), top, '#c2c3c7');
    const rc = relicCount() + '/' + L.relics.length;
    ctx.drawImage(FEATHER, Math.round((VW - textW(rc)) / 2) - 8, top + 8);
    drawText(rc, Math.round((VW - textW(rc)) / 2), top + 9, '#ff77a8');
    // altitude rail
    const r0 = 26, r1 = VH - 12;
    const yAt = (feet) => Math.round(r1 - (r1 - r0) * clamp((START_FEET - feet) / (START_FEET - TOP_FEET), 0, 1));
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(1, r0, 2, r1 - r0);
    ctx.fillStyle = '#ff004d'; ctx.fillRect(0, yAt(SUMMIT_FEET), 4, 1);
    ctx.fillStyle = '#ff77a8'; ctx.fillRect(1, yAt(START_FEET - bestH * 8), 2, 1);
    ctx.fillStyle = '#ffec27'; ctx.fillRect(1, yAt(p.y + C.PH) - 1, 2, 3);
  }
  function drawStick() {
    if (!stick || state !== 'play') return;
    const v = stickVec();
    const ox = Math.round(stick.ox), oy = Math.round(stick.oy);
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#fff1e8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ox + 0.5, oy + 0.5, STICK_FULL, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#fff1e8'; ctx.fillRect(ox - 1, oy - 1, 3, 3);
    if (v) {
      const l = Math.min(v.len, STICK_FULL);
      const col = v.pow > 0.95 ? '#ff004d' : v.pow > 0.6 ? '#ffa300' : '#ffec27';
      for (let i = 4; i <= l; i += 2) { ctx.fillStyle = col; ctx.fillRect(Math.round(ox + v.dx * i), Math.round(oy + v.dy * i), 2, 2); }
      ctx.fillRect(Math.round(ox + v.dx * l) - 3, Math.round(oy + v.dy * l) - 3, 7, 7);
    }
    ctx.globalAlpha = 1;
  }
  function render() {
    let sx = 0, sy = 0;
    if (shake > 0) { sx = Math.round(rnd(-1, 1)); sy = Math.round(rnd(-1, 1)); shake--; }
    ctx.imageSmoothingEnabled = false;
    drawBackground();
    ctx.save();
    ctx.translate(sx - Math.round(cam.x), sy - Math.round(cam.y));
    drawWorld();
    ctx.restore();
    drawSnow();
    if (state !== 'title') { drawHUD(); drawStick(); }
    renderUI();
  }

  // ---------------------------------------------------------------- crisp text layer (signs, toasts)
  function bubble(lines, cx, bottomY, alpha, border) {
    const fs = Math.round(13 * dpr), pad = Math.round(7 * dpr), lh = Math.round(fs * 1.45);
    uctx.font = fs + 'px ' + FONT_UI;
    const w = Math.max(...lines.map((l) => uctx.measureText(l).width)) + pad * 2;
    const h = lines.length * lh + pad * 2 - (lh - fs);
    const W = ui.width;
    const x = clamp(Math.round(cx - w / 2), 6 * dpr, W - w - 6 * dpr), y = Math.round(bottomY - h);
    uctx.globalAlpha = alpha;
    const b = Math.max(2, Math.round(2 * dpr));
    uctx.fillStyle = '#000'; uctx.fillRect(x + b, y + b, w, h);
    uctx.fillStyle = border; uctx.fillRect(x - b, y - b, w + b * 2, h + b * 2);
    uctx.fillStyle = '#0d1030'; uctx.fillRect(x, y, w, h);
    uctx.fillStyle = '#fff1e8';
    uctx.textBaseline = 'top';
    lines.forEach((l, i) => uctx.fillText(l, x + pad, y + pad + i * lh));
    uctx.globalAlpha = 1;
  }
  const signAlpha = new Map();
  function renderUI() {
    uctx.clearRect(0, 0, ui.width, ui.height);
    if (state === 'title' || !p) return;
    const k = scale * dpr;
    const toScreen = (wx, wy) => [(wx - Math.round(cam.x)) * k, (wy - Math.round(cam.y)) * k];
    // nearest sign within reach
    let near = null, nd = 1e9;
    const px = p.x + 3, py = p.y + 4;
    for (const s of L.signs) {
      const d = Math.hypot(s.x + 4 - px, s.y + 4 - py);
      if (d < 44 && d < nd) { nd = d; near = s; }
    }
    for (const s of L.signs) {
      const a = clamp((signAlpha.get(s) || 0) + (s === near && !stick ? 0.1 : -0.1), 0, 1);
      signAlpha.set(s, a);
      if (a <= 0) continue;
      const [sx, sy] = toScreen(s.x + 4, s.y - 3);
      bubble(SIGNS[s.id].split('\n'), sx, sy, a, '#ab5236');
    }
    for (const t of toasts) {
      const [sx, sy] = toScreen(t.x, t.y);
      const fs = Math.round(12 * dpr);
      uctx.font = fs + 'px ' + FONT_UI;
      uctx.textBaseline = 'middle';
      uctx.globalAlpha = clamp(t.life / 20, 0, 1);
      const w = uctx.measureText(t.text).width;
      uctx.fillStyle = '#000'; uctx.fillText(t.text, sx - w / 2 + dpr, sy + dpr);
      uctx.fillStyle = t.col; uctx.fillText(t.text, sx - w / 2, sy);
      uctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- screens
  const scr = { title: $('scrTitle'), pause: $('scrPause'), clear: $('scrClear'), heaven: $('scrHeaven'), item: $('scrItem') };
  function show(name) {
    for (const k in scr) scr[k].hidden = k !== name;
    $('btnPause').hidden = name !== null;
  }
  const statsHTML = (rows) => rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
  const baseStats = () => [['タイム', fmtTime(time)], ['ミス', misses + '回'], ['発砲', shots + '発'], ['羽根', relicCount() + ' / ' + L.relics.length]];
  function abilList() {
    const out = ['空中の弾 ' + abil.ammo + '発'];
    if (abil.breaker) out.push('砕岩弾');
    if (abil.pierce) out.push('貫通弾');
    if (abil.magnum) out.push('強装弾');
    return out.join(' / ');
  }
  function itemGet(type) {
    const info = Phys.ITEMS[type];
    state = 'item'; stick = null; pendingFire = null;
    const c = $('itemIcon'); const g = c.getContext('2d');
    g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height);
    g.drawImage(ITEM_SPR[type], 0, 0, 7, 7, 4, 4, 56, 56);
    $('itemName').textContent = info.name;
    $('itemDesc').textContent = info.desc;
    $('itemAbil').textContent = '現在の力: ' + abilList();
    saveGame();
    setTimeout(() => { if (state === 'item') show('item'); }, 350);
  }
  let newArmed = false;
  function refreshTitle() {
    const has = !!store.get(SAVE_KEY, null);
    $('btnCont').disabled = !has;
    $('btnCont').classList.toggle('primary', has);
    $('btnNew').classList.toggle('primary', !has);
    $('btnNew').textContent = 'はじめから';
    newArmed = false;
    const parts2 = [];
    if (best.summit) parts2.push('頂上 ' + fmtTime(best.summit));
    if (best.heaven) parts2.push('天国 ' + fmtTime(best.heaven));
    $('bestLine').textContent = parts2.length ? 'ベスト: ' + parts2.join(' / ') : 'PCはマウスでドラッグ。Esc でポーズ。';
    syncSound();
  }
  const syncSound = () => {
    $('btnSound').textContent = '音: ' + (prefs.sound ? 'ON' : 'OFF');
    $('btnHaptics').textContent = '振動: ' + (prefs.haptics ? 'ON' : 'OFF');
    $('btnHaptics').hidden = !Haptics.supported;
  };
  $('btnNew').addEventListener('click', () => {
    if (store.get(SAVE_KEY, null) && !newArmed) { newArmed = true; $('btnNew').textContent = 'セーブを消して開始'; return; }
    audioUnlock(); store.del(SAVE_KEY); newGame(); play();
  });
  $('btnCont').addEventListener('click', () => {
    const s = store.get(SAVE_KEY, null);
    if (!s) return;
    audioUnlock(); loadGame(s); play();
  });
  function play() { state = 'play'; stick = null; pendingFire = null; show(null); }
  function pause() {
    state = 'pause'; saveGame(); stick = null;
    $('pauseStats').innerHTML = statsHTML([['高さ', heightM() + 'm'], ['最高到達', bestH + 'm']].concat(baseStats()));
    $('pauseAbil').textContent = '現在の力: ' + abilList();
    syncSound(); show('pause');
  }
  const resume = play;
  function toTitle() { saveGame(); state = 'title'; refreshTitle(); show('title'); }
  function summit() {
    const first = !summitDone;
    summitDone = true;
    SFX.win(); HAPTIC.summit();
    burst(L.flag.x + 4, L.flag.y, 40, ['#ffec27', '#ff004d', '#00e436', '#29adff', '#fff1e8'], 2.2, 0.05, 50);
    if (!first) return;
    if (!best.summit || time < best.summit) { best.summit = time; store.set(BEST_KEY, best); }
    saveGame();
    state = 'clearing';
    setTimeout(() => {
      $('clearStats').innerHTML = statsHTML(baseStats());
      state = 'clear'; show('clear');
    }, 1200);
  }
  function heaven() {
    SFX.win(); HAPTIC.heaven();
    burst(L.gate.x + 4, L.gate.y, 60, ['#ffec27', '#fff1e8', '#ff77a8'], 2.5, 0.02, 70);
    if (!best.heaven || time < best.heaven) { best.heaven = time; store.set(BEST_KEY, best); }
    state = 'clearing';
    const rc = relicCount();
    setTimeout(() => {
      $('heavenStats').innerHTML = statsHTML(baseStats());
      $('heavenHint').textContent = rc < L.relics.length ? '羽根は、まだどこかに隠れている。（' + rc + '/' + L.relics.length + '）' : 'すべての羽根を見つけた。おめでとう！';
      store.del(SAVE_KEY);
      state = 'heaven'; show('heaven');
    }, 1500);
  }
  $('btnPause').addEventListener('click', pause);
  $('btnItemOk').addEventListener('click', play);
  $('btnResume').addEventListener('click', resume);
  $('btnTitle').addEventListener('click', toTitle);
  $('btnClearTitle').addEventListener('click', toTitle);
  $('btnExplore').addEventListener('click', play);
  $('btnHeavenTitle').addEventListener('click', () => { state = 'title'; refreshTitle(); show('title'); });
  $('btnSound').addEventListener('click', () => { prefs.sound = !prefs.sound; store.set(PREF_KEY, prefs); syncSound(); });
  $('btnHaptics').addEventListener('click', () => { prefs.haptics = !prefs.haptics; store.set(PREF_KEY, prefs); syncSound(); if (prefs.haptics) HAPTIC.item(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });
  window.addEventListener('pagehide', saveGame);

  // ---------------------------------------------------------------- layout
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (h / w < 1.3) { VH = 256; scale = h / VH; }
    else { scale = w / VW; VH = Math.round(h / scale); if (VH > 340) { VH = 340; scale = h / VH; } }
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = VW; cv.height = VH;
    const cw = VW * scale, ch = VH * scale, left = Math.round((w - cw) / 2), top = Math.round((h - ch) / 2);
    for (const el of [cv, ui]) { el.style.width = cw + 'px'; el.style.height = ch + 'px'; el.style.left = left + 'px'; el.style.top = top + 'px'; }
    ui.width = Math.round(cw * dpr); ui.height = Math.round(ch * dpr);
  }
  window.addEventListener('resize', resize);
  resize();
  newGame();
  refreshTitle();
  show('title');

  let last = performance.now(), acc = 0;
  const DT = 1000 / 60;
  function frame(now) {
    const slow = state === 'play' && p && !p.grounded && aiming() ? 0.2 : 1;
    acc += Math.min(100, now - last) * slow; last = now;
    while (acc >= DT) { update(); acc -= DT; }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

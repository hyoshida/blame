// RECOIL CLIMB — game layer (rendering, input, audio, save). Physics lives in physics.js.
(function () {
  'use strict';
  const { C } = Phys;
  const $ = (id) => document.getElementById(id);
  const VW = 144;
  let VH = 256, scale = 2, dpr = 1;
  const cv = $('game'), mainCtx = cv.getContext('2d');
  let ctx = mainCtx;
  const ui = $('ui'), uctx = ui.getContext('2d');
  const L = Phys.makeLevel(window.LEVEL.ROWS);
  const SIGNS = window.LEVEL.SIGNS;
  for (const [tx, ty, text] of window.LEVEL.EXTRA_SIGNS || []) L.signs.push({ x: tx * 8, y: ty * 8, text });
  const WPS = (window.LEVEL.WAYPOINTS || []).map(([tx, ty, name], i) => ({ i, tx, ty, name, x: tx * 8, y: ty * 8, on: false }));
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
  const SAVE_KEY = 'recoilclimb.save.v6', PREF_KEY = 'recoilclimb.prefs.v1', BEST_KEY = 'recoilclimb.best.v2';
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
  // Player: an original hooded wanderer (8x10). Glowing visor, pale jacket; a long scarf is simulated separately.
  // The visor colour shows ammo (cyan full / amber some / dark none).
  // Player (10x12): a girl with long white hair, a half-face respirator and an orange work jacket,
  // wrapped in a long red scarf (the trailing part is simulated). The respirator's filter lamps show ammo.
  const PW_SPR = 10, PH_SPR = 12;
  const BODY = ['..ssssss..', '.ssssssss.', '.sSffffSs.', '.sfeffefs.', '.smmmmmms.', '.smvmmvms.', 's.rrrrrr..', 'sgoooooog.', 's.o####o..'];
  const LEGS = { idle: ['..kk..kk..', '..kk..kk..', '.nnn..nnn.'], air: ['..kkkkkk..', '.kk....kk.', '.n......n.'], slide: ['.kk...kk..', 'kk.....kk.', 'nn.....nn.'] };
  const LAMP = ['#3a3f47', '#ffb347', '#6ff7ff'];
  const PAL = { s: '#eef1f4', S: '#aab3bd', f: '#f0d0c0', e: '#241820', m: '#2a2d33', r: '#e0303a', o: '#e06a1e', '#': '#e6e8ea', g: '#2a2d33', k: '#1d2026', n: '#101216' };
  const PSPR = LAMP.map((v) => {
    const out = {};
    for (const k in LEGS) out[k] = sprite(BODY.concat(LEGS[k]), Object.assign({}, PAL, { v }));
    return out;
  });
  function tint(img, col) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  const GHOST = {};
  for (const k in LEGS) GHOST[k] = tint(PSPR[2][k], '#3fd8ff');
  // energy cell (refill) and record shard (collectible)
  const CRYSTAL = sprite(['..fff..', '.fwccf.', '.fwccf.', '.fcccf.', '.fcccf.', '.fcccf.', '..fff..'], { f: '#4a5864', w: '#ffffff', c: '#6ff7ff' });
  const CRYSTAL_OFF = sprite(['..fff..', '.fdddf.', '.fdddf.', '.fdddf.', '.fdddf.', '.fdddf.', '..fff..'], { f: '#343b43', d: '#141a1f' });
  const FEATHER = sprite(['..w...', '.wmm..', 'wmmmm.', '.mmmmw', '..mmw.', '...w..'], { w: '#ffffff', m: '#ff5d8f' });
  const ITEM_SPR = {
    A: sprite(['.bbbbb.', '.bwbwb.', '.bybyb.', '.bybyb.', 'ooooooo', 'ooooooo', '.o...o.'], { b: '#ffa300', w: '#fff1e8', y: '#ffec27', o: '#83769c' }),
    B: sprite(['..rr...', '.rrrr..', 'rrxrrr.', 'rrrxrr.', '.rxrrr.', '..rrw..', '...w...'], { r: '#ab5236', x: '#1a1020', w: '#ffec27' }),
    K: sprite(['...w...', '..wbw..', '.wbbbw.', '..bbb..', '..bbb..', '..bbb..', '..w.w..'], { w: '#c6ecff', b: '#29adff' }),
    M: sprite(['...r...', '..rrr..', '..rwr..', '..rrr..', '.yyyyy.', '.yyyyy.', '.ooooo.'], { r: '#ff004d', w: '#ff77a8', y: '#ffa300', o: '#ab5236' }),
  };
  const RELAY_OFF = sprite(['..ff....', '.fddf...', '.fddf...', '.fddf...', '.fddf...', '.ffff...', 'ffffff..', 'ffffff..'], { f: '#2e3238', d: '#3a1418' });
  const RELAY_ON = sprite(['..ff....', '.fccf...', '.fwcf...', '.fccf...', '.fccf...', '.ffff...', 'ffffff..', 'ffffff..'], { f: '#3a3f48', c: '#3fd8ff', w: '#ffffff' });
  const SIGN = sprite(['.ffffff.', '.fllssf.', '.fssssf.', '.flllsf.', '.ffffff.', '...ff...', '...ff...', '..ffff..'], { f: '#2e3238', s: '#1f1608', l: '#ffb347' }); // wall terminal

  // ---------------------------------------------------------------- tile layer (pre-rendered, patched when cracks break)
  const tiles = document.createElement('canvas');
  tiles.width = WW; tiles.height = WH;
  const tg = tiles.getContext('2d');
  const SPIKE_UP = (x, y) => (y === 5 && (x === 1 || x === 5)) ? '#d8dce2'
    : (y === 6 && x !== 3 && x !== 7) ? '#8a9099' : (y === 7 ? '#3a3e45' : null);
  const CRACK = ['..#.....', '...#..#.', '...##.#.', '.#...#..', '..#..#..', '.##...#.', '#....#..', '.....#..'];
  const solidish = (c) => c === '#' || c === '=' || c === 'x' || c === 'm' || c === 'd' || c === 'T' || c === 't' || c === 'Y' || c === 'Z' || c === 'V';
  function drawTile(tx, ty) {
    const bx = tx * 8, by = ty * 8;
    tg.clearRect(bx, by, 8, 8);
    const ch = L.grid[ty][tx];
    const px = (x, y, col) => { tg.fillStyle = col; tg.fillRect(bx + x, by + y, 1, 1); };
    const at = (dx, dy) => Phys.tileAt(L, tx + dx, ty + dy);
    const same = (dx, dy) => at(dx, dy) === ch;
    if (ch === '#' || ch === '=') {
      const s = (dx, dy) => solidish(at(dx, dy));
      const T = !s(0, -1), B = !s(0, 1), Lf = !s(-1, 0), R = !s(1, 0);
      const deep = !T && !B && !Lf && !R && s(-1, -1) && s(1, -1) && s(-1, 1) && s(1, 1);
      const th = hash(tx * 7 + 3, ty * 13 + 1);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const wx = bx + x, wy = by + y, h = hash(wx, wy);
        let col;
        if (ch === '=') { // wet black deck plating: slippery, reflects the neon
          if (T && y === 0) col = (wx % 5 === 0) ? '#ff3fa4' : '#6ff7ff';
          else if (T && y === 1) col = '#1d3a44';
          else if (B && y === 7) col = '#050608';
          else if ((Lf && x === 0) || (R && x === 7)) col = '#1a2027';
          else if ((wx - wy) % 9 === 0 && y < 6) col = '#24495a';
          else if ((wx - wy) % 9 === 1 && y < 5) col = '#16303b';
          else col = h < 0.03 ? '#4a1d3a' : '#0e1217';
        } else if (deep) { // the endless mass of the structure
          if (wx % 32 === 0 || wy % 32 === 0) col = '#17191e';
          else if (wx % 32 === 16 && wy % 4 === 0) col = '#1b1d22';
          else col = h > 0.9985 ? '#ffb347' : h > 0.996 ? '#4a6b72' : '#22252b';
        } else { // concrete / steel panels with seams and rivets
          if (T && y === 0) col = '#a3a9b1';
          else if (T && y === 1) col = '#6f757e';
          else if (B && y === 7) col = '#1b1d22';
          else if ((Lf && x === 0) || (R && x === 7)) col = '#565c66';
          else if (wx % 16 === 0 || wy % 16 === 0) col = '#2a2e35';
          else if (wx % 16 === 2 && wy % 16 === 2) col = '#737a84';
          else if (th > 0.85 && y >= 3 && y <= 5 && x >= 2 && x <= 5) col = (x % 2) ? '#1c1f24' : '#30343b'; // vent
          else col = h < 0.025 ? '#4d3b33' : h < 0.06 ? '#343840' : '#3c4149';
        }
        px(x, y, col);
      }
    } else if (ch === 'x') { // fractured concrete panel, rebar showing: it will give way
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const h = hash(bx + x, by + y);
        if ((x === 0 && y === 0) || (x === 7 && y === 7) || (x === 7 && y === 0 && h < 0.5)) continue; // chipped corners
        let col = h < 0.3 ? '#5c6168' : '#4b5057';
        if (x === 0 || y === 0) col = '#747a82';
        if (x === 7 || y === 7) col = '#2a2d33';
        if ((y === 2 || y === 5) && x > 0 && x < 7 && CRACK[y][x] !== '#' && (x + y) % 3 !== 0) col = y === 2 ? '#7a4a30' : '#5e3a26';
        if (CRACK[y][x] === '#') col = '#08090b';
        px(x, y, col);
      }
    } else if (ch === 'X') { // reinforced fractured panel: steel bands over the cracks
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let col = hash(bx + x, by + y) < 0.3 ? '#50555c' : '#43474e';
        if (x === 0 || y === 0) col = '#6a7078';
        if (x === 7 || y === 7) col = '#22252a';
        if (CRACK[y][x] === '#') col = '#08090b';
        if (y === 2 || y === 5) col = (x % 3 === 1) ? '#8a9099' : '#5b616d';
        px(x, y, col);
      }
    } else if (ch === 'V') { // armor plate: thick grey slab with amber warning stripes and heavy bolts
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const wx = bx + x, wy = by + y;
        let col = hash(wx, wy) < 0.2 ? '#4a4f57' : '#40444b';
        if ((wx + wy) % 8 < 2 && (y === 3 || y === 4)) col = '#c98a1c';
        else if (y === 3 || y === 4) col = '#24272c';
        if (y === 0 && !same(0, -1)) col = '#8a9099';
        if (y === 7 && !same(0, 1)) col = '#191b1f';
        if ((x === 0 && !same(-1, 0)) || (x === 7 && !same(1, 0))) col = '#2e3137';
        if ((x === 1 || x === 6) && (y === 1 || y === 6)) col = '#9aa0a8';
        px(x, y, col);
      }
    } else if (ch === 'Y' || ch === 'Z') { // the superstructure: a black monolith veined with faint light
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const wx = bx + x, wy = by + y, h = hash(wx, wy);
        let col = h < 0.05 ? '#14161c' : '#0b0c10';
        if ((wx + wy * 3) % 29 === 0 || (wx % 24 === 0 && wy % 2 === 0)) col = '#1f3a44';
        if (wy % 16 === 0 && wx % 6 !== 0) col = '#16222a';
        if (!solidish(at(0, 1)) && y === 7) col = '#2c4a55';
        if (ch === 'Z') col = (x + y) % 3 === 0 ? '#3a0c12' : '#1c0608';
        px(x, y, col);
      }
    } else if (ch === 'm') { // polished steel (bullets bounce)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let col = '#a9b0b8';
        if (y === 0 && !same(0, -1)) col = '#eef1f4';
        else if (y === 7 && !same(0, 1)) col = '#4d535b';
        else if ((x === 0 && !same(-1, 0)) || (x === 7 && !same(1, 0))) col = '#737a84';
        else if (x + y === 9 || x + y === 10) col = '#d4dae0';
        px(x, y, col);
      }
    } else if (ch === 'g') { // hardened glass
      tg.fillStyle = 'rgba(111,247,255,0.12)'; tg.fillRect(bx, by, 8, 8);
      for (let i = 0; i < 8; i++) {
        if (!same(0, -1)) px(i, 0, '#8ff8ff');
        if (!same(0, 1)) px(i, 7, '#3d8f99');
        if (!same(-1, 0)) px(0, i, '#8ff8ff');
        if (!same(1, 0)) px(7, i, '#3d8f99');
      }
      px(2, 2, '#ffffff'); px(3, 1, '#c8fbff');
    } else if (ch === 'c') { // floating girder fragment
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (y > 5) continue;
        let col = y === 0 ? '#9aa0a8' : y === 5 ? '#1b1d22' : '#3a3f47';
        if ((y === 2 || y === 3) && x % 4 === 1) col = '#101216';
        px(x, y, col);
      }
    } else if (ch === 'd') { // blast shutter with hazard stripes
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let col = ((bx + x + by + y) % 6 < 3) ? '#d8a800' : '#15161a';
        if (y === 0 && !same(0, -1)) col = '#e6e8ea';
        if (y === 7 && !same(0, 1)) col = '#2a2d33';
        if ((x === 0 && !same(-1, 0)) || (x === 7 && !same(1, 0))) col = '#3a3e45';
        px(x, y, col);
      }
    } else if (ch === 'T' || ch === 't') { // sensor eye
      const hit = ch === 't';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const r = Math.hypot(x - 3.5, y - 3.5);
        const ring = r < 1.5 ? 0 : r < 2.6 ? 1 : r < 3.8 ? 2 : 3;
        const col = hit ? ['#3e434b', '#5b616d', '#2a2d33', '#1b1d22'][ring] : ['#ff3040', '#ffd6d9', '#7a1420', '#2a2d33'][ring];
        px(x, y, col);
      }
    } else if ('^v<>'.includes(ch)) { // jagged shards
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
  // soot on a wall face (side -1: the tile's left face, 1: its right face)
  function bakeScorch(tx, ty, side, seed = 0) {
    const bx = tx * 8, by = ty * 8;
    for (let y = -4; y < 12; y++) for (let d = 0; d < 4; d++) {
      const h = hash(bx * 3 + y + seed, by * 5 + d + seed);
      const r = Math.hypot(d * 1.6, y - 4) / 7;
      if (h > 1 - (1 - r) * 0.9) continue;
      const x = side < 0 ? bx + d : bx + 7 - d;
      if (!Phys.isSolid(Phys.tileAt(L, Math.floor(x / 8), Math.floor((by + y) / 8)))) continue;
      tg.fillStyle = r < 0.45 && h < 0.2 ? '#8a3a14' : r < 0.5 ? '#07070a' : '#141417';
      tg.fillRect(x, by + y, 1, 1);
    }
  }
  const EMBERS = []; // smouldering soot spots, visible in the dark
  const isWallFace = (tx, ty, side) => Phys.stopsBullet(Phys.tileAt(L, tx, ty)) && !Phys.isSolid(Phys.tileAt(L, tx + side, ty));
  for (const [tx, ty, side] of window.LEVEL.SCORCH || []) { if (!isWallFace(tx, ty, side)) continue; bakeScorch(tx, ty, side); EMBERS.push({ x: side < 0 ? tx * 8 : tx * 8 + 8, y: ty * 8 + 4, side, seed: tx * 7 + ty }); }
  const WINDS = []; // updraft columns, for the rising streaks
  for (let tx = 0; tx < L.w; tx++) for (let ty = 0; ty < L.h; ty++) if (L.grid[ty][tx] === 'w') WINDS.push({ tx, ty });
  const HIDDEN = [];
  for (let ty = 0; ty < L.h; ty++) for (let tx = 0; tx < L.w; tx++) if (L.grid[ty][tx] === 'h') HIDDEN.push({ tx, ty, t: 0 });
  function revealNear(x, y, r, t) {
    for (const hdn of HIDDEN) {
      const cx = hdn.tx * 8 + 4, cy = hdn.ty * 8 + 4;
      if ((cx - x) ** 2 + (cy - y) ** 2 < r * r) hdn.t = Math.max(hdn.t, t);
    }
  }
  const origGrid = L.grid.map((r) => r.slice());
  // Auto-placed light fixtures: lamps under overhangs, neon strips on walls. Chosen by hash so they never move.
  const LAMPS = [];
  const CRACKS = [], SLICK = [];
  {
    const COLS = ['#ffb347', '#ffb347', '#6ff7ff', '#ff3fa4'];
    const air = (x, y) => !Phys.isSolid(Phys.tileAt(L, x, y)) && !'^v<>'.includes(Phys.tileAt(L, x, y));
    for (let ty = 1; ty < L.h - 2; ty++) for (let tx = 1; tx < L.w - 1; tx++) {
      const c = L.grid[ty][tx], h = hash(tx * 31 + 7, ty * 17 + 3);
      if (c === 'x') CRACKS.push([tx, ty]);
      if (c === '=' && air(tx, ty - 1)) SLICK.push([tx, ty]);
      if (c !== '#') continue;
      if (air(tx, ty - 1) && air(tx, ty - 2) && h > 0.93 && h < 0.97) {
        LAMPS.push({ kind: 'post', x: tx * 8 + 4, y: ty * 8, col: COLS[Math.floor(h * 997) % COLS.length], r: 26, flick: h < 0.935 });
      } else if (air(tx, ty + 1) && air(tx, ty + 2) && h < 0.09) {
        LAMPS.push({ kind: 'hang', x: tx * 8 + 4, y: ty * 8 + 8, col: COLS[Math.floor(h * 1000) % COLS.length], r: 30, flick: h < 0.02 });
      } else if ((air(tx + 1, ty) || air(tx - 1, ty)) && Phys.isSolid(Phys.tileAt(L, tx, ty - 1)) && Phys.isSolid(Phys.tileAt(L, tx, ty + 1)) && h > 0.965) {
        const side = air(tx + 1, ty) ? 1 : -1;
        LAMPS.push({ kind: 'neon', x: tx * 8 + (side > 0 ? 8 : 0), y: ty * 8 + 1, side, col: h > 0.985 ? '#ff3fa4' : '#6ff7ff', r: 22, flick: h > 0.99 });
      }
    }
  }
  // shell tiles that vanish are redrawn gradually by the collapse sequence, spreading out from the core
  let coreStrain = 0; // frames of visible strain after a charged hit that fell short
  let collapseQ = [], collapseT = 0, whiteout = 0, banner = null;
  let collapsing = false, instantRedraw = false;
  L.onChange = (tx, ty) => { const o = origGrid[ty][tx]; if ((o === 'Y' || o === 'Z') && !instantRedraw) collapseQ.push([tx, ty]); else redrawAround(tx, ty); };
  function resetWorld() {
    while (L.changes.length) { const [tx, ty] = L.changes.pop(); L.grid[ty][tx] = origGrid[ty][tx]; redrawAround(tx, ty); }
    for (const t of L.targets) t.hit = false;
    for (const c of L.crystals) { c.active = true; c.t = 0; }
    for (const r of L.relics) r.got = false;
    for (const it of L.items) it.got = false;
    L.coreHP = 1; coreStrain = 0; collapsing = false; collapseQ = []; collapseT = 0; whiteout = 0; banner = null;
  }

  // ---------------------------------------------------------------- background
  // Two tiling layers of an endless megastructure, drawn once and scrolled with parallax.
  function makeLayer(w, h, seed, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    let st = seed;
    const r = () => { st = (st * 1103515245 + 12345) & 0x7fffffff; return st / 0x7fffffff; };
    paint(c.getContext('2d'), r);
    return c;
  }
  const FAR = makeLayer(192, 384, 7, (g, r) => {
    for (let i = 0; i < 14; i++) { // colossal shafts and towers
      const w = 8 + Math.floor(r() * 26), x = Math.floor(r() * 192), top = Math.floor(r() * 120);
      for (const ox of [x, x - 192]) {
        g.fillStyle = r() < 0.5 ? '#111318' : '#0e1014'; g.fillRect(ox, top, w, 384);
        g.fillStyle = '#16191f'; g.fillRect(ox, top, 1, 384);
        for (let y = top + 4; y < 384; y += 6 + Math.floor(r() * 10)) {
          if (r() < 0.35) { g.fillStyle = r() < 0.08 ? '#ffb347' : r() < 0.4 ? '#3e6970' : '#1d2228'; g.fillRect(ox + 2 + Math.floor(r() * (w - 4)), y, 1, 1); }
        }
      }
    }
    for (let i = 0; i < 9; i++) { // cross beams
      const y = Math.floor(r() * 384), hgt = 2 + Math.floor(r() * 4);
      g.fillStyle = '#131519'; g.fillRect(0, y, 192, hgt);
    }
    for (let i = 0; i < 10; i++) { // distant neon signage: columns of glyph-like marks
      const x = Math.floor(r() * 186), y = Math.floor(r() * 340), n = 3 + Math.floor(r() * 5);
      const col = r() < 0.5 ? '#ff3fa4' : r() < 0.6 ? '#3fd8ff' : '#ffb347';
      const glow = g.createRadialGradient(x + 1, y + n * 2.5, 0, x + 1, y + n * 2.5, 26);
      glow.addColorStop(0, col + '40'); glow.addColorStop(1, col + '00');
      g.fillStyle = glow; g.fillRect(x - 26, y + n * 2.5 - 26, 52, 52);
      g.fillStyle = '#0a0b0e'; g.fillRect(x - 1, y - 1, 5, n * 5 + 1);
      g.fillStyle = col;
      for (let k = 0; k < n; k++) for (let b = 0; b < 6; b++) if (r() < 0.55) g.fillRect(x + (b % 3), y + k * 5 + Math.floor(b / 3) * 2, 1, 1);
    }
  });
  const MID = makeLayer(160, 256, 21, (g, r) => {
    for (let i = 0; i < 4; i++) { // girders with rivets
      const y = Math.floor(r() * 256), hgt = 4 + Math.floor(r() * 4);
      g.fillStyle = '#1b1e24'; g.fillRect(0, y, 160, hgt);
      g.fillStyle = '#2a2e35'; g.fillRect(0, y, 160, 1);
      for (let x = 2; x < 160; x += 6) { g.fillStyle = '#30353d'; g.fillRect(x, y + 2, 1, 1); }
    }
    for (let i = 0; i < 3; i++) { // pillars
      const x = Math.floor(r() * 150), w = 4 + Math.floor(r() * 6);
      g.fillStyle = '#181b20'; g.fillRect(x, 0, w, 256);
      g.fillStyle = '#23272d'; g.fillRect(x, 0, 1, 256);
    }
    for (let i = 0; i < 6; i++) { // hanging cables
      const x0 = Math.floor(r() * 160), x1 = x0 + 20 + Math.floor(r() * 60), y0 = Math.floor(r() * 256), sag = 8 + r() * 30;
      g.fillStyle = '#0c0d10';
      for (let x = x0; x <= x1; x++) { const t = (x - x0) / (x1 - x0); g.fillRect(((x % 160) + 160) % 160, Math.round(y0 + Math.sin(t * Math.PI) * sag) % 256, 1, 1); }
    }
  });
  const dust = [...Array(40)].map(() => ({ x: rnd(0, VW), y: rnd(0, 400), sp: rnd(0.05, 0.25), ph: rnd(0, 6.28), big: Math.random() < 0.15 }));

  // ---------------------------------------------------------------- audio
  let actx = null, noiseBuf = null;
  function audioUnlock() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
    ambientStart();
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
    s.loop = true;
    s.connect(f).connect(g).connect(actx.destination); s.start(t); s.stop(t + d);
  }
  // rising whine while a charge builds; returns a handle whose stop() releases it
  function chargeLoop(rounds, heavy) {
    if (!actx || !prefs.sound) return null;
    const t = actx.currentTime, D = C.CHARGE_MS / 1000, base = 70 + rounds * 18;
    const out = actx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.09, t + 0.15);
    const o1 = actx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(base, t); o1.frequency.exponentialRampToValueAtTime(base * 4, t + D);
    const o2 = actx.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(base * 2.01, t); o2.frequency.exponentialRampToValueAtTime(base * 8.04, t + D);
    const g2 = actx.createGain(); g2.gain.value = 0.35;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(heavy ? 5200 : 3200, t + D);
    // tremolo that speeds up: the charge "throbs" faster as it fills
    const trem = actx.createGain(); trem.gain.value = 0.6;
    const lfo = actx.createOscillator(); lfo.frequency.setValueAtTime(5, t); lfo.frequency.exponentialRampToValueAtTime(heavy ? 34 : 24, t + D);
    const lfoG = actx.createGain(); lfoG.gain.value = 0.4;
    lfo.connect(lfoG).connect(trem.gain);
    o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(trem).connect(out).connect(actx.destination);
    let sub = null;
    if (heavy) { sub = actx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(38, t); sub.frequency.linearRampToValueAtTime(55, t + D); const sg = actx.createGain(); sg.gain.value = 0.9; sub.connect(sg).connect(out); sub.start(t); }
    o1.start(t); o2.start(t); lfo.start(t);
    let held = false;
    return {
      // charged: settle into a steady, quieter throb until release
      hold() { if (held) return; held = true; const n = actx.currentTime; out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0.045, n + 0.2); o1.frequency.cancelScheduledValues(n); o1.frequency.setValueAtTime(base * 4, n); o2.frequency.cancelScheduledValues(n); o2.frequency.setValueAtTime(base * 8.04, n); },
      stop() { const n = actx.currentTime; out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), n); out.gain.exponentialRampToValueAtTime(0.0001, n + 0.06); for (const o of [o1, o2, lfo, sub]) if (o) o.stop(n + 0.08); },
    };
  }
  // low hum of the structure + wind through its shafts
  let amb = null;
  function ambientStart() {
    if (!actx || amb) return;
    try {
      const out = actx.createGain(); out.gain.value = 0;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const o1 = actx.createOscillator(), o2 = actx.createOscillator();
      o1.type = o2.type = 'sawtooth'; o1.frequency.value = 41; o2.frequency.value = 41.6;
      o1.connect(lp); o2.connect(lp); lp.connect(out);
      const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), a = buf.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
      const wind = actx.createBufferSource(); wind.buffer = buf; wind.loop = true;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.6;
      const wg = actx.createGain(); wg.gain.value = 0.5;
      const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 160;
      lfo.connect(lg).connect(bp.frequency);
      wind.connect(bp).connect(wg).connect(out);
      out.connect(actx.destination);
      o1.start(); o2.start(); wind.start(); lfo.start();
      amb = out;
    } catch (e) { amb = null; }
  }
  function ambientLevel() {
    if (!amb) return;
    const v = prefs.sound && state !== 'pause' ? 0.05 : 0;
    amb.gain.setTargetAtTime(v, actx.currentTime, 0.6);
  }
  const SFX = {
    shot(pow) { noise(0.1 + pow * 0.06, 0.25 + pow * 0.2, 1600 + pow * 1400); tone({ f: 120 + pow * 40, f2: 40, d: 0.12, v: 0.13 }); },
    click() { tone({ f: 1200, d: 0.025, v: 0.05 }); },
    land() { tone({ f: 95, f2: 50, d: 0.07, type: 'triangle', v: 0.25 }); },
    fallWind() { noise(6.5, 0.18, 900); tone({ f: 220, f2: 880, d: 6, type: 'sine', v: 0.03 }); },
    titleHit() { tone({ f: 55, f2: 30, d: 1.4, type: 'sawtooth', v: 0.12 }); [131, 196, 262].forEach((f, i) => tone({ f, d: 1.6, type: 'triangle', v: 0.06, delay: i * 0.02 })); noise(0.6, 0.2, 2400); },
    impact() { noise(0.9, 0.8, 1600); tone({ f: 70, f2: 22, d: 0.9, type: 'sine', v: 0.5 }); tone({ f: 140, f2: 40, d: 0.3, type: 'square', v: 0.08 }); },
    crystal() { [660, 990, 1320].forEach((f, i) => tone({ f, d: 0.09, type: 'triangle', v: 0.12, delay: i * 0.05 })); },
    ping() { tone({ f: 2200, f2: 1600, d: 0.08, type: 'triangle', v: 0.08 }); },
    crumble() { noise(0.3, 0.45, 900); tone({ f: 70, f2: 40, d: 0.25, type: 'triangle', v: 0.2 }); },
    die() { tone({ f: 520, f2: 90, d: 0.35, type: 'sawtooth', v: 0.08 }); noise(0.2, 0.2, 3000); },
    respawn() { [392, 523].forEach((f, i) => tone({ f, d: 0.08, type: 'triangle', v: 0.08, delay: i * 0.06 })); },
    relay() { [392, 587, 784].forEach((f, i) => tone({ f, d: 0.16, type: 'triangle', v: 0.09, delay: i * 0.08 })); },
    collapse() { noise(1.8, 0.7, 1800); tone({ f: 55, f2: 20, d: 2.2, type: 'sawtooth', v: 0.22 }); tone({ f: 82, f2: 30, d: 1.8, type: 'triangle', v: 0.2, delay: 0.3 }); },
    blast() { noise(0.35, 0.55, 3800); tone({ f: 70, f2: 30, d: 0.3, type: 'sawtooth', v: 0.16 }); },
    charged(heavy) { (heavy ? [220, 330, 440, 660, 880] : [220, 330, 440, 660]).forEach((f, i) => tone({ f, d: 0.08, type: 'square', v: 0.05, delay: i * 0.04 })); },
    // a charged shot: heavier with every round; the max-output shot is a structure-breaking boom
    overdrive(out, max) {
      if (max) {
        noise(1.6, 0.9, 5200);
        tone({ f: 48, f2: 16, d: 1.6, type: 'sine', v: 0.5 });
        tone({ f: 90, f2: 24, d: 1.1, type: 'sawtooth', v: 0.26 });
        tone({ f: 2400, f2: 160, d: 0.5, type: 'square', v: 0.06 });
        tone({ f: 62, f2: 20, d: 1.2, type: 'triangle', v: 0.3, delay: 0.09 });
        tone({ f: 1320, f2: 1250, d: 0.9, type: 'triangle', v: 0.05, delay: 0.05 }); // metal ring
        tone({ f: 1870, f2: 1760, d: 0.7, type: 'triangle', v: 0.035, delay: 0.05 });
        return;
      }
      noise(0.35 + out * 0.15, 0.5 + out * 0.1, 2200 + out * 600);
      tone({ f: 70 - out * 5, f2: 24, d: 0.35 + out * 0.12, type: 'sawtooth', v: 0.16 + out * 0.03 });
      tone({ f: 1100 + out * 200, f2: 260, d: 0.22, type: 'square', v: 0.045 });
    },
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
    charged: () => Haptics.play([12, 40, 12, 40, 30], 3),
    chargeTick: (k) => Haptics.play(4 + k * 2, 0),
    impact: () => Haptics.play([90, 30, 40], 2),
    overdrive: (out, max) => Haptics.play(max ? [160, 30, 90, 30, 60, 40, 120] : [50 + out * 15, 20, 30 + out * 10, 20, 30], 3),
    shot: (pow, magnum) => Haptics.play(Math.round(10 + pow * 16 + (magnum ? 12 : 0)), 1),
    empty: () => Haptics.play([4, 40, 4], 1),
    land: (v) => { if (v > 3.6) Haptics.play(24, 1); else if (v > 2.2) Haptics.play(10, 0); },
    crystal: () => Haptics.play([8, 30, 14], 2),
    remote: () => Haptics.play([8, 25, 8, 25, 18], 3),
    clank: () => Haptics.play(6, 0),
    crumble: () => Haptics.play([35, 25, 20], 2),
    blast: () => Haptics.play([45, 20, 25], 2),
    collapse: () => Haptics.play([120, 60, 90, 60, 160, 80, 240], 3),
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
  let p, abil = Phys.newAbil(), time = 0, misses = 0, shots = 0, bestH = 0, summitDone = false, heavenDone = false, tick = 0;
  let safe = null, deadT = 0;
  const cam = { x: 0, y: 0, px: 0, py: 0 };
  let shake = 0, flash = null;
  let parts = [], tracers = [], toasts = [], ghosts = [];
  let scarf = [];
  let relicOrder = []; // record shards in the order they were found
  let inGate = false;
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
  function resetScarf() { scarf = [...Array(11)].map(() => ({ x: p.x + 3, y: p.y + 1, px: p.x + 3, py: p.y + 1 })); }
  function updateScarf() {
    if (!p || !scarf.length) return;
    const face = aim.x >= 0 ? 1 : -1;
    const a = scarf[0];
    a.x = a.px = p.x + 3 - face * 2; a.y = a.py = p.y + 1;
    for (let i = 1; i < scarf.length; i++) {
      const n = scarf[i], prev = scarf[i - 1];
      const vx = (n.x - n.px) * 0.9, vy = (n.y - n.py) * 0.9;
      n.px = n.x; n.py = n.y;
      n.x += vx - face * 0.14 + Math.sin(tick * 0.09 + i * 0.8) * 0.07;
      n.y += vy + 0.05;
      const dx = n.x - prev.x, dy = n.y - prev.y, d = Math.hypot(dx, dy) || 1, L0 = 1.5;
      n.x = prev.x + dx / d * L0; n.y = prev.y + dy / d * L0;
    }
  }
  function snapCam() { cam.x = clampCamX(p.x + 3 - VW / 2); cam.y = clampCamY(p.y + 4 - VH * 0.55); cam.px = cam.x; cam.py = cam.y; }

  function newGame() {
    resetWorld();
    abil = Phys.newAbil();
    placeAt(Math.floor(L.start.x / 8), Math.floor(L.start.y / 8));
    // debug: #row60 starts on the first ledge at/below that row, with every item found below it
    const m = /row(\d+)/.exec(location.hash);
    if (m) {
      const row = +m[1];
      L.items.forEach((it) => { if (it.y / 8 > row) { it.got = true; Phys.grantItem(abil, it.type); } });
      L.targets.forEach((t, i) => { if (t.ty > row) Phys.openTarget(L, i); });
      if (L.core && L.core.y / 8 > row) { instantRedraw = true; Phys.collapseShell(L); instantRedraw = false; }
      outer: for (let ty = row; ty < L.h; ty++) for (let tx = L.w - 1; tx >= 0; tx--) if (surfaceAt(tx, ty)) { placeAt(tx, ty); break outer; }
    }
    const at = /at(\d+),(\d+)(?:\+([ABKM]+))?/.exec(location.hash); // debug: #at52,165 starts on that tile; +AB grants items
    if (at) {
      L.items.forEach((it) => { if (!it.got && (it.y / 8 > +at[2] + 1 || (at[3] || '').includes(it.type))) { it.got = true; Phys.grantItem(abil, it.type); } });
      L.targets.forEach((t, i) => { if (t.ty > +at[2] + 1) Phys.openTarget(L, i); });
      placeAt(+at[1], +at[2]);
    }
    time = 0; misses = 0; shots = 0; bestH = 0; summitDone = false; heavenDone = false;
    safe = { x: p.x, y: p.y }; deadT = 0;
    parts = []; tracers = []; toasts = [];
    snapCam(); resetScarf(); ghosts = []; relicOrder = []; inGate = false;
    for (const w of WPS) w.on = false;
    if (m) for (const w of WPS) if (w.ty >= +m[1]) w.on = true;
    for (const hdn of HIDDEN) hdn.t = 0;
  }
  function loadGame(s) {
    newGame();
    for (const [tx, ty] of s.cracks || []) if (L.grid[ty] && 'xXV'.includes(L.grid[ty][tx])) Phys.setTile(L, tx, ty, '.');
    if (s.shellGone) { instantRedraw = true; Phys.collapseShell(L); instantRedraw = false; } 
    for (const i of s.targets || []) if (L.targets[i]) Phys.openTarget(L, i);
    for (const i of s.relics || []) if (L.relics[i]) L.relics[i].got = true;
    relicOrder = (s.relicOrder || s.relics || []).filter((i) => L.relics[i]);
    for (const i of s.relays || []) if (WPS[i]) WPS[i].on = true;
    for (const i of s.items || []) if (L.items[i]) L.items[i].got = true;
    abil = Object.assign(Phys.newAbil(), s.abil || {});
    const sp = s.safe;
    p = Phys.newPlayer(sp.x, sp.y, abil);
    time = s.time || 0; misses = s.misses || 0; shots = s.shots || 0; bestH = s.bestH || 0;
    summitDone = !!s.summit; heavenDone = !!s.heaven;
    safe = { x: sp.x, y: sp.y };
    snapCam(); resetScarf();
  }
  function saveGame() {
    if (!p || state === 'title') return;
    store.set(SAVE_KEY, {
      safe, time, misses, shots, bestH, summit: summitDone, heaven: heavenDone, abil,
      cracks: L.changes.filter((c) => c[2] === 'x' || c[2] === 'X' || c[2] === 'V').map((c) => [c[0], c[1]]), shellGone: L.coreHP <= 0, coreHP: L.coreHP,
      targets: L.targets.map((t, i) => (t.hit ? i : -1)).filter((i) => i >= 0),
      items: L.items.map((t, i) => (t.got ? i : -1)).filter((i) => i >= 0),
      relics: L.relics.map((r, i) => (r.got ? i : -1)).filter((i) => i >= 0), relicOrder,
      relays: WPS.filter((w) => w.on).map((w) => w.i),
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
  function toast(text, wx, wy, col = '#fff1e8', life = 70) {
    toasts = toasts.filter((t) => t.text !== text); // repeat hits refresh the message instead of stacking it
    toasts.push({ text, x: wx, y: wy, col, life, max: life });
  }
  function startCollapse() {
    collapsing = true; collapseT = 0; whiteout = 0.85; shake = 30;
    banner = { text: '――殻が、崩れる。', life: 220 };
    SFX.collapse(); later(HAPTIC.collapse);
    // redraw order: nearest the core first
    const c = L.core || { x: 0, y: 0 };
    collapseQ.sort((a, b) => Math.hypot(a[0] * 8 - c.x, a[1] * 8 - c.y) - Math.hypot(b[0] * 8 - c.x, b[1] * 8 - c.y));
    saveGame();
  }
  function updateCollapse() {
    if (whiteout > 0) whiteout = Math.max(0, whiteout - 0.03);
    if (banner && --banner.life <= 0) banner = null;
    if (!collapsing) return;
    collapseT++;
    const n = Math.min(collapseQ.length, collapseT < 110 ? (collapseT % 2 === 0 ? 1 : 0) + (collapseT > 50 ? 1 : 0) : 3 + Math.floor((collapseT - 110) / 8));
    for (let i = 0; i < n; i++) {
      const [tx, ty] = collapseQ.shift();
      redrawAround(tx, ty);
      for (let k = 0; k < 3; k++) parts.push({ x: tx * 8 + rnd(0, 8), y: ty * 8 + rnd(0, 8), vx: rnd(-0.6, 0.6), vy: rnd(-0.4, 0.8), g: 0.1, life: rnd(60, 120), col: k === 0 ? '#2c4a55' : '#14161c' });
      if (Math.random() < 0.05) burst(tx * 8 + 4, ty * 8 + 4, 8, ['#ffb347', '#ffffff', '#ff3040'], 1.6, 0.03, 20);
    }
    if (tick % 10 === 0) { shake = Math.max(shake, 6); SFX.crumble(); }
    if (!collapseQ.length) { collapsing = false; shake = 12; SFX.win(); }
  }
  function updateFx() {
    updateCollapse();
    ghosts = ghosts.filter((g) => --g.life > 0);
    for (const hdn of HIDDEN) if (hdn.t > 0) hdn.t--;
    if (tick % 9 === 0 && EMBERS.length) { // thin smoke curling off the soot
      const e = EMBERS[Math.floor(Math.random() * EMBERS.length)];
      if (Math.abs(e.x - cam.x - VW / 2) < VW && Math.abs(e.y - cam.y - VH / 2) < VH) parts.push({ x: e.x - e.side * 2, y: e.y - 2, vx: -e.side * 0.08, vy: -0.25, g: -0.002, life: 60, col: '#5b616d' });
    }
    if (p && !p.dead && p.grounded && Phys.tileAt(L, Math.floor((p.x + 3) / 8), Math.floor((p.y + C.PH + 1) / 8)) === 'h') revealNear(p.x + 3, p.y + C.PH + 4, 10, 24);
    if (tick % 12 === 0 && CRACKS.length) { // loose grit trickles from fractured panels
      const [tx, ty] = CRACKS[Math.floor(Math.random() * CRACKS.length)];
      if (L.grid[ty][tx] === 'x' && Math.abs(tx * 8 - cam.x - VW / 2) < VW && Math.abs(ty * 8 - cam.y - VH / 2) < VH)
        parts.push({ x: tx * 8 + rnd(1, 7), y: ty * 8 + 8, vx: rnd(-0.1, 0.1), vy: 0.2, g: 0.04, life: 40, col: '#6b7078' });
    }
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
    if (state === 'intro') { skipIntro(); return; }
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
    if (full && !stick.full) { HAPTIC.aimFull(); stick.fullAt = performance.now(); }
    if (!full) { stick.fullAt = 0; stick.charged = false; stopChargeSnd(); }
    stick.full = full;
  });
  function endStick(e, cancel) {
    if (!stick || e.pointerId !== stick.id) return;
    const v = stickVec();
    const charge = chargeLevel() >= 1;
    stick = null;
    stopChargeSnd();
    if (!cancel && v && state === 'play') {
      pendingFire = { dx: v.dx, dy: v.dy, pow: v.pow, charge, ttl: 6 };
      if (p && !p.dead) { if (charge) HAPTIC.overdrive(p.ammo, isMax(p.ammo)); else if (p.ammo > 0) HAPTIC.shot(v.pow, abil.magnum); else HAPTIC.empty(); }
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
  // charged shot: held at full power for CHARGE_WAIT, then CHARGE_MS of charging (2+ rounds left)
  const isMax = (out) => out >= C.CORE_OUT && abil.breaker && abil.magnum;
  function chargeLevel() {
    if (!stick || !stick.fullAt || !p || p.dead || !Phys.canCharge(p)) return 0;
    const t = performance.now() - stick.fullAt - C.CHARGE_WAIT;
    return t <= 0 ? 0 : clamp(t / C.CHARGE_MS, 0.001, 1);
  }
  let chargeSnd = null;
  function stopChargeSnd() { if (chargeSnd) { chargeSnd.stop(); chargeSnd = null; } }
  function updateCharge() {
    if (!stick) { stopChargeSnd(); return; }
    if (stick.full && !Phys.canCharge(p)) { stick.fullAt = 0; stick.charged = false; stick.step = 0; stopChargeSnd(); } // out of rounds: start over once refilled
    else if (stick.full && !stick.fullAt) stick.fullAt = performance.now();
    const lv = chargeLevel();
    if (lv > 0 && !chargeSnd && !stick.charged) chargeSnd = chargeLoop(p.ammo, isMax(p.ammo));
    if (lv > 0 && lv < 1) {
      const k = Math.floor(lv * 8);
      if (k !== stick.step) { stick.step = k; HAPTIC.chargeTick(k); }
      // sparks drawn in toward the player
      const n = 1 + Math.floor(lv * 3), cx = p.x + 3, cy = p.y + 4, cols = chargeCols(p.ammo);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, d = 14 + Math.random() * 10;
        parts.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: -Math.cos(a) * d / 12, vy: -Math.sin(a) * d / 12, g: 0, life: 12, col: cols[i % cols.length] });
      }
    }
    const c = lv >= 1;
    if (c && !stick.charged) { SFX.charged(isMax(p.ammo)); HAPTIC.charged(); if (chargeSnd) chargeSnd.hold(); burst(p.x + 3, p.y + 4, 14, chargeCols(p.ammo), 1.4, 0, 14); }
    stick.charged = c;
  }
  // colours of a charged shot: red, hotter with breaker (amber) and magnum (white); deeper with more rounds
  function chargeCols(out) {
    const c = [out >= 3 ? '#ff004d' : out >= 2 ? '#ff3040' : '#d8303a'];
    if (abil.breaker) c.push('#ffb347');
    if (abil.magnum) c.push('#ffffff');
    if (isMax(out)) c.push('#ffe0e0');
    return c;
  }
  const aiming = () => state === 'play' && !!stickVec() && !p.dead;

  // ---------------------------------------------------------------- update
  function onShot(e) {
    shots++;
    const cx = p.x + 3, cy = p.y + 4;
    const s0 = e.segs[0];
    const d0 = Math.hypot(s0.x1 - s0.x0, s0.y1 - s0.y0);
    const mz = Math.min(7, d0);
    if (e.charged) tracers.push({ segs: e.segs, skip: 2, life: isMax(e.out) ? 16 : 10 + e.out * 2, max: isMax(e.out), w: isMax(e.out) ? 5 : 1 + e.out, r: C.BEAM_R[Math.min(e.out, C.BEAM_R.length - 1)] + (abil.magnum ? 2 : 0), cols: chargeCols(e.out) });
    else tracers.push({ segs: e.segs, skip: mz, life: 6 });
    flash = { x: cx + e.dx * mz, y: cy + e.dy * mz, life: e.blast ? 6 : 3, big: e.blast };
    // the flash lights up hidden walkways for a moment
    revealNear(flash.x, flash.y, e.blast ? 80 : 64, 70);
    for (const sg of e.segs) {
      const d = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
      for (let i = 0; i <= d; i += 8) revealNear(sg.x0 + (sg.x1 - sg.x0) * i / d, sg.y0 + (sg.y1 - sg.y0) * i / d, 16, 60);
    }
    if (e.blast) { // pressed against the wall: louder, brighter, leaves soot
      const w = e.hits.find((h) => h.t === 'wall' || h.t === 'clank');
      if (w) { const stx = Math.floor((w.x + w.dx) / 8), sty = Math.floor(w.y / 8), sd = w.dx > 0 ? -1 : 1; if (isWallFace(stx, sty, sd)) bakeScorch(stx, sty, sd, tick); EMBERS.push({ x: sd < 0 ? stx * 8 : stx * 8 + 8, y: sty * 8 + 4, side: sd, seed: tick }); }
      burst(flash.x, flash.y, 16, ['#ffb347', '#ffffff', '#ff5a1e'], 2.2, 0.04, 18);
      SFX.blast(); later(HAPTIC.blast);
      shake = Math.max(shake, 7);
    }
    if (e.charged) { // every round left, at once
      const max = isMax(e.out), cols = chargeCols(e.out);
      burst(flash.x, flash.y, 14 + e.out * 8 + (max ? 20 : 0), cols, 2 + e.out * 0.5 + (max ? 1.2 : 0), 0.03, 22);
      flash.life = 8 + e.out * 2; flash.big = true; flash.charge = cols[0];
      toast(max ? '最大出力' : e.out >= 2 ? '全弾（' + e.out + '）' : '全弾', cx, cy - 12, max ? '#ffe0e0' : '#ff3040', 60);
      SFX.overdrive(e.out, max); shake = Math.max(shake, 6 + e.out * 3 + (max ? 8 : 0));
      if (max) whiteout = Math.max(whiteout, 0.35);
      // embers shed along the whole path
      for (const sg of e.segs) {
        const d = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
        for (let i = 6; i < d; i += max ? 3 : 7) parts.push({ x: sg.x0 + (sg.x1 - sg.x0) * i / d, y: sg.y0 + (sg.y1 - sg.y0) * i / d, vx: rnd(-0.4, 0.4), vy: rnd(-0.5, 0.2), g: 0.02, life: rnd(14, 30 + e.out * 6), col: cols[Math.floor(Math.random() * cols.length)] });
      }
      revealNear(cx, cy, 90, 70);
    }
    let nBreak = 0;
    for (const h of e.hits) {
      if (h.t === 'wall') for (let i = 0; i < 6; i++) parts.push({ x: h.x - h.dx * 2, y: h.y - h.dy * 2, vx: -h.dx * rnd(0.3, 1.5) + rnd(-0.8, 0.8), vy: -h.dy * rnd(0.3, 1.5) + rnd(-0.8, 0.8), g: 0.08, life: rnd(8, 16), col: i % 2 ? '#ffec27' : '#fff1e8' });
      else if (h.t === 'ping') { burst(h.x, h.y, 4, ['#fff1e8', '#c2c3c7'], 0.8, 0, 8); SFX.ping(); }
      else if (h.t === 'break') {
        const bx = h.tx * 8 + 4, by = h.ty * 8 + 4;
        for (let i = 0; i < 14; i++) parts.push({ x: bx + rnd(-3, 3), y: by + rnd(-3, 3), vx: rnd(-1.2, 1.2), vy: rnd(-1.8, 0.3), g: 0.12, life: rnd(30, 60), col: ['#ab5236', '#6b3a3a', '#1a1020'][i % 3], collide: true });
        if (++nBreak <= 3) { SFX.crumble(); later(HAPTIC.crumble); }
        shake = Math.max(shake, 5);
      } else if (h.t === 'crystal') {
        burst(h.x, h.y, 12, ['#6ff7ff', '#ffffff'], 1.4, 0, 16);
        toast('充填', h.x, h.y - 8, '#6ff7ff', 50);
        SFX.crystal(); later(HAPTIC.remote);
      } else if (h.t === 'clank' || h.t === 'glass') {
        burst(h.x, h.y, 4, h.t === 'glass' ? ['#c6ecff', '#fff1e8'] : ['#ab5236', '#fff1e8'], 0.8, 0.05, 10);
        SFX.clank(); later(HAPTIC.clank);
        if (h.shell && h.core && abil.breaker && abil.magnum) {
          coreStrain = Math.max(coreStrain, h.out >= 2 ? 240 : 40);
          toast(h.out >= 2 ? '核が、軋んだ。…まだ、足りない' : '核は、応えない。…持てるすべてを、一度に', h.x, h.y + 10, h.out >= 2 ? '#ff3040' : '#9aa0a8', 110);
        }
        else if (h.shell) toast(abil.breaker && abil.magnum ? '殻は硬い。…脈打つ中心を撃て' : '揺らぎもしない。…もっと重い一撃なら', h.x, h.y + 10, '#9aa0a8', 90);
        else if (h.plate) toast(Phys.maxAmmo(p) < 2 ? '傷ひとつ、つかない。…一発では' : '弾かれた。…一発では、足りない', h.x, h.y + (h.dy < 0 ? 12 : -8), '#9aa0a8', 90);
        else toast(h.t === 'glass' ? '弾が、ガラスに阻まれた' : h.heavy ? (abil.breaker ? '崩れない。…もっと強い一撃なら' : 'びくともしない。…まだ') : 'びくともしない。…まだ', h.x, h.y - 8, '#9aa0a8', 90);
      } else if (h.t === 'plate') {
        for (const [tx, ty] of h.tiles) for (let i = 0; i < 6; i++) parts.push({ x: tx * 8 + rnd(1, 7), y: ty * 8 + rnd(1, 7), vx: rnd(-1.6, 1.6), vy: rnd(-2, 0.4), g: 0.12, life: rnd(30, 70), col: ['#6b7078', '#c98a1c', '#24272c'][i % 3], collide: true });
        toast('装甲板が、砕けた', h.x, h.y + (h.ty * 8 > p.y ? -8 : 12), '#ffb347', 90);
        SFX.crumble(); SFX.door(); shake = Math.max(shake, 10); later(HAPTIC.crumble);
      } else if (h.t === 'collapse') {
        startCollapse();
      } else if (h.t === 'target') {
        const t = L.targets[h.i];
        burst(h.x, h.y, 10, ['#ff004d', '#fff1e8'], 1.2, 0, 16);
        for (const [dx, dy] of t.doors) burst(dx * 8 + 4, dy * 8 + 4, 5, ['#ff004d', '#7e2553', '#ff77a8'], 1, 0.08, 24);
        toast('認証', h.x, h.y - 8, '#ff3040', 60);
        const d0 = t.doors[0];
        if (d0) toast('隔壁が、開いた', d0[0] * 8 + 16, d0[1] * 8 - 4, '#ff3040', 90);
        SFX.door(); shake = Math.max(shake, 5); later(HAPTIC.target);
      }
    }
    burst(flash.x, flash.y, 4, ['#c2c3c7'], 0.4, -0.01, 16);
    parts.push({ x: cx, y: cy, vx: -e.dy * rnd(0.6, 1.2) * (Math.random() < 0.5 ? 1 : -1), vy: -1.6, g: 0.15, life: 50, col: '#ffa300', collide: true });
    shake = Math.max(shake, 2 + Math.round(pow * 2));
    pushGhost(10);
    SFX.shot(pow);
  }
  // after a shot, let the release tick finish before the follow-up pattern
  const later = (fn) => setTimeout(fn, 70);
  function pushGhost(life) {
    const legs = !p.grounded ? 'air' : Math.abs(p.vx) > 0.4 ? 'slide' : 'idle';
    ghosts.push({ x: Math.round(p.x) - 2, y: Math.round(p.y) - 5, face: aim.x >= 0 ? 1 : -1, legs, life, max: life });
  }
  function isSafeSpot() {
    if (!p.grounded || Math.abs(p.vx) > 0.2) return false;
    const x0 = Math.floor(p.x / 8) - 1, x1 = Math.floor((p.x + C.PW) / 8) + 1;
    const y0 = Math.floor(p.y / 8) - 1, y1 = Math.floor((p.y + C.PH) / 8) + 1;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if ('^v<>'.includes(Phys.tileAt(L, tx, ty))) return false;
    return true;
  }
  // ---------------------------------------------------------------- opening: a fall from the top of the world
  // (from just under the superstructure down the open column over the field, onto the start ledge)
  let intro = null;
  const INTRO_TOP = 30 * 8;
  function startIntro() {
    const land = { x: p.x, y: p.y };
    intro = { t: 0, v: 0.4, land, landed: 0, title: 0 };
    p.y = INTRO_TOP; p.vx = 0; p.vy = 0; p.grounded = false;
    aim = { x: 1, y: 0.2 };
    state = 'intro'; stick = null; pendingFire = null;
    show(null); $('btnPause').hidden = true;
    snapIntroCam(); resetScarf(); ghosts = [];
    SFX.fallWind();
  }
  function snapIntroCam() { cam.x = clampCamX(p.x + 3 - VW / 2); cam.y = clampCamY(p.y + 4 - VH * 0.42); cam.px = cam.x; cam.py = cam.y; }
  function introLand() {
    p.x = intro.land.x; p.y = intro.land.y; p.vy = 0; p.grounded = true;
    intro.landed = 1; intro.title = 1; // the title call comes once she is down
    shake = 16;
    for (let i = 0; i < 26; i++) parts.push({ x: p.x + 3 + rnd(-2, 2), y: p.y + C.PH, vx: rnd(-2.4, 2.4), vy: rnd(-1.6, -0.2), g: 0.08, life: rnd(20, 44), col: ['#c2c3c7', '#83769c', '#6b7078'][i % 3], collide: true });
    burst(p.x + 3, p.y + C.PH, 10, ['#ffffff', '#ffb347'], 1.8, 0.02, 12);
    SFX.impact(); HAPTIC.impact(); setTimeout(() => SFX.titleHit(), 350);
    snapIntroCam();
  }
  function introUpdate() {
    intro.t++;
    if (!intro.landed) {
      if (intro.t > 50) intro.v = Math.min(14, intro.v + 0.22);
      p.y += intro.v;
      if (intro.v > 4 && tick % 2 === 0) pushGhost(6);
      if (intro.v > 3) for (let i = 0; i < 2; i++) parts.push({ x: cam.x + rnd(0, VW), y: cam.y + VH + 4, vx: 0, vy: -intro.v * rnd(1.1, 1.6), g: 0, life: 30, col: Math.random() < 0.3 ? '#8ff8ff' : '#6b7078', streak: true });
      if (p.y >= intro.land.y) introLand();
      snapIntroCam();
    } else if (++intro.landed > 200) {
      intro = null; state = 'play'; $('btnPause').hidden = false;
      safe = { x: p.x, y: p.y }; saveGame();
      return;
    }
    if (intro.title) intro.title++;
    updateScarf();
  }
  function skipIntro() {
    if (!intro) return;
    if (!intro.landed) introLand();
    else intro.landed = 201;
  }
  function update() {
    tick++;
    if (tick % 30 === 0) ambientLevel();
    if (state === 'pause' || state === 'title') { cameraFollow(0.05); return; }
    if (state === 'intro') { updateFx(); Phys.tickWorld(L); if (intro) introUpdate(); return; }
    updateFx();
    Phys.tickWorld(L);
    if (state !== 'play') { cameraFollow(0.05); return; }
    time++;
    if (p.dead) {
      if (--deadT <= 0) {
        p = Phys.newPlayer(safe.x, safe.y, abil); p.grounded = true; resetScarf();
        burst(p.x + 3, p.y + 4, 10, ['#fff1e8', '#ffec27'], 1, 0, 14);
        SFX.respawn(); HAPTIC.respawn();
      }
      cameraFollow(0.08);
      return;
    }
    const ev = [];
    let fire = null;
    updateCharge();
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
        toast('損傷', p.x + 3, p.y - 8, '#ff3040', 50);
        SFX.die(); shake = 6; HAPTIC.die();
        pendingFire = null;
      } else if (e.t === 'crystal') {
        burst(e.x, e.y, 10, ['#6ff7ff', '#ffffff'], 1.2, 0, 16);
        SFX.crystal(); HAPTIC.crystal();
      } else if (e.t === 'relic') {
        burst(e.x, e.y, 18, ['#fff1e8', '#ff77a8', '#ffec27'], 1.6, 0, 26);
        relicOrder.push(e.i);
        SFX.relic(); HAPTIC.relic();
        showRecord(e.i);
      } else if (e.t === 'item') {
        burst(e.x, e.y, 24, ['#ffec27', '#fff1e8', '#ffa300'], 2, 0, 30);
        SFX.item(); HAPTIC.item();
        itemGet(e.type);
      } else if (e.t === 'flag') summit();
      // (the heaven gate is handled below on every entry)
    }
    if (pendingFire && !shot) {
      if (p.ammo <= 0) { SFX.click(); toast('――空だ', p.x + 3, p.y - 8, '#7a808a', 30); pendingFire = null; }
      else if (--pendingFire.ttl <= 0) pendingFire = null;
    } else pendingFire = null;

    if (!p.dead && isSafeSpot()) { safe.x = p.x; safe.y = p.y; }
    { // outside gate: every time you step into its light
      const g = L.gate, ov = p.x < g.x + 8 && p.x + C.PW > g.x && p.y < g.y + 8 && p.y + C.PH > g.y - 8;
      if (ov && !inGate && !p.dead) heaven();
      inGate = ov;
    }
    for (const w of WPS) { // relay terminals switch on when you pass them
      if (w.on || Math.abs(p.x + 3 - (w.x + 3)) > 8 || Math.abs(p.y + 4 - (w.y + 4)) > 10) continue;
      w.on = true;
      burst(w.x + 3, w.y + 2, 14, ['#3fd8ff', '#ffffff'], 1.4, 0, 20);
      toast('中継点「' + w.name + '」起動　静止画面から転移できる', w.x + 3, w.y - 10, '#6ff7ff', 150);
      SFX.relay(); HAPTIC.crystal(); saveGame();
    }
    if (Math.hypot(p.vx, p.vy) > 3 && tick % 3 === 0) pushGhost(8);
    updateScarf();
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
  function tileLayer(img, par, alpha) {
    const ox = -(((cam.x * par) % img.width) + img.width) % img.width;
    const oy = -(((cam.y * par) % img.height) + img.height) % img.height;
    ctx.globalAlpha = alpha;
    for (let y = Math.floor(oy); y < VH; y += img.height) for (let x = Math.floor(ox); x < VW; x += img.width) ctx.drawImage(img, x, y);
    ctx.globalAlpha = 1;
  }
  // how far into the open sky above the tower the view is (0 inside, 1 outside), and how high up there
  const OUT_Y = (window.LEVEL.OY || 0) * 8;
  const skyT = () => clamp((OUT_Y + 160 - (cam.y + VH / 2)) / 320, 0, 1);
  const skyH = () => clamp(1 - (cam.y + VH / 2) / Math.max(1, OUT_Y), 0, 1);
  function drawBackground() {
    const t = skyT(), h = skyH();
    const gr = ctx.createLinearGradient(0, 0, 0, VH);
    gr.addColorStop(0, mix('#07080b', mix('#141a3a', '#5a6d9a', h), t));
    gr.addColorStop(0.7, mix('#101318', mix('#3b3558', '#e0a878', h), t));
    gr.addColorStop(1, mix('#14171c', mix('#5a4058', '#f6d3a0', h), t));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, VW, VH);
    tileLayer(FAR, 0.12, 1 - t * 0.85);
    // fog between the layers, faintly tinted by the neon below
    const fog = ctx.createLinearGradient(0, 0, 0, VH);
    fog.addColorStop(0, 'rgba(20,24,30,0)'); fog.addColorStop(0.55, 'rgba(34,20,40,0.28)'); fog.addColorStop(1, 'rgba(18,40,48,0.5)');
    ctx.globalAlpha = 1 - t; ctx.fillStyle = fog; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1;
    tileLayer(MID, 0.35, 1 - t * 0.95);
    if (t > 0) { // outside: long bands of cloud drifting past
      for (let i = 0; i < 6; i++) {
        const y = ((i * 57 - cam.y * (0.15 + i * 0.05)) % (VH + 40) + VH + 40) % (VH + 40) - 20;
        const x = ((i * 91 + tick * (0.05 + i * 0.02) - cam.x * 0.2) % 260 + 260) % 260 - 60;
        ctx.globalAlpha = t * (0.10 + i * 0.03);
        ctx.fillStyle = mix('#c8c0d8', '#fff0dc', h);
        ctx.fillRect(Math.round(x), Math.round(y), 90 + i * 12, 2 + (i % 3));
        ctx.fillRect(Math.round(x) + 14, Math.round(y) - 1, 50 + i * 6, 1);
      }
      ctx.globalAlpha = 1;
    }
  }
  function drawSnow() { // drifting dust
    const dx = cam.x - cam.px, dy = cam.y - cam.py;
    for (const f of dust) {
      f.y += f.sp - dy * 0.4;
      f.x += Math.sin(tick * 0.01 + f.ph) * 0.15 - dx * 0.4;
      if (f.y > VH) { f.y -= VH + 4; f.x = rnd(0, VW); }
      if (f.y < -4) f.y += VH + 4;
      if (f.x < 0) f.x += VW; if (f.x >= VW) f.x -= VW;
      const wx = Math.floor((f.x + cam.x) / 8), wy = Math.floor((f.y + cam.y) / 8);
      if (Phys.isSolid(Phys.tileAt(L, wx, wy))) continue;
      ctx.fillStyle = f.big ? '#8a9099' : '#4d535b';
      ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
    }
  }
  // translucent wide band along a path (one stroke, so the alpha doesn't stack)
  function band(segs, w, col, skip = 0) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.beginPath();
    segs.forEach((s, i) => {
      let x0 = s.x0, y0 = s.y0;
      if (i === 0 && skip) { const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1; x0 += (s.x1 - s.x0) * Math.min(1, skip / d); y0 += (s.y1 - s.y0) * Math.min(1, skip / d); }
      if (i === 0) ctx.moveTo(x0, y0); else ctx.lineTo(x0, y0);
      ctx.lineTo(s.x1, s.y1);
    });
    ctx.stroke();
  }
  function thickLine(segs, w, col, skip = 0) {
    ctx.fillStyle = col;
    const o = Math.floor(w / 2);
    let acc = 0;
    for (const s of segs) {
      const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
      for (let i = 0; i <= d; i += 1) {
        if (++acc < skip) continue;
        ctx.fillRect(Math.round(s.x0 + (s.x1 - s.x0) * i / d) - o, Math.round(s.y0 + (s.y1 - s.y0) * i / d) - o, w, w);
      }
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
    const charge = chargeLevel() >= 1;
    const bullet = Phys.fireBullet(L, p, v.dx, v.dy, true, charge ? p.ammo : 1);
    ctx.globalAlpha = 0.6;
    if (charge) {
      ctx.globalAlpha = 0.14; band(bullet.segs, 2 * (C.BEAM_R[Math.min(p.ammo, C.BEAM_R.length - 1)] + (abil.magnum ? 2 : 0)), chargeCols(p.ammo)[0], 9);
      ctx.globalAlpha = Math.floor(tick / 4) % 2 ? 0.75 : 0.5; thickLine(bullet.segs, isMax(p.ammo) ? 3 : 2, chargeCols(p.ammo)[0], 9);
    }
    else dotted(bullet.segs, 72, '#fff1e8', 3, 9);
    ctx.globalAlpha = 1;
    // light up whatever this shot would hit (crystals refill, targets open doors)
    const blink = Math.floor(tick / 4) % 2 === 0;
    for (const h of bullet.hits) {
      let x = null, y = null, col = null;
      if (h.t === 'crystal') { x = h.x; y = h.y; col = '#6ff7ff'; }
      else if (h.t === 'target') { x = h.tx * 8 + 4; y = h.ty * 8 + 4; col = '#ff77a8'; }
      else if (h.t === 'break' || h.t === 'plate' || h.t === 'collapse') { x = h.tx != null ? h.tx * 8 + 4 : h.x; y = h.ty != null ? h.ty * 8 + 4 : h.y; col = '#ffa300'; }
      if (x === null) continue;
      ctx.strokeStyle = blink ? col : '#fff1e8'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) - 5.5, Math.round(y) - 5.5, 11, 11);
    }
    if (p.ammo <= 0) return;
    // predicted flight after this shot
    const q = Object.assign({}, p);
    Phys.step(L, q, { fire: { dx: v.dx, dy: v.dy, pow: v.pow, charge } }, null, true);
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
    const x = Math.round(p.x) - 2, y = Math.round(p.y) - 5;
    // afterimages
    for (const g of ghosts) {
      ctx.globalAlpha = (g.life / g.max) * 0.45;
      ctx.save();
      if (g.face < 0) { ctx.translate(g.x + PW_SPR, g.y); ctx.scale(-1, 1); ctx.drawImage(GHOST[g.legs], 0, 0); }
      else ctx.drawImage(GHOST[g.legs], g.x, g.y);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // scarf (behind the body)
    for (let i = 1; i < scarf.length; i++) {
      const n = scarf[i];
      ctx.fillStyle = i < 5 ? '#e0303a' : i < 8 ? '#b8252f' : '#7a161e';
      ctx.fillRect(Math.round(n.x), Math.round(n.y), 1, i < 6 ? 2 : 1);
    }
    ctx.save();
    if (face < 0) { ctx.translate(x + PW_SPR, y); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0); }
    else ctx.drawImage(spr, x, y);
    ctx.restore();
    const cx = Math.round(p.x + 3), cy = Math.round(p.y + 3);
    for (let d = 3; d <= 9; d++) {
      ctx.fillStyle = d >= 8 ? '#dfe3e8' : '#3a3f47';
      ctx.fillRect(Math.round(cx + aim.x * d), Math.round(cy + aim.y * d), 1, 1);
    }
    // shots left, over the head (always while airborne or aiming)
    if (!p.grounded || aiming()) {
      for (let i = 0; i < Phys.maxAmmo(p); i++) {
        const has = i < p.ammo;
        const bx = Math.round(p.x) + i * 4, by = Math.round(p.y) - 9;
        ctx.fillStyle = has ? '#8ff8ff' : '#3a3f47'; ctx.fillRect(bx + 1, by, 2, 1);
      }
    }
  }
  function lampOn(l) { return !l.flick || (Math.sin(tick * 0.7 + l.x) > -0.6 && (tick + l.y) % 97 > 6); }
  function drawWorld() {
    ctx.drawImage(tiles, 0, 0);
    for (const l of LAMPS) {
      if (Math.abs(l.x - cam.x - VW / 2) > VW || Math.abs(l.y - cam.y - VH / 2) > VH) continue;
      const on = lampOn(l);
      if (l.kind === 'hang') {
        ctx.fillStyle = '#15171b'; ctx.fillRect(l.x, l.y, 1, 2); ctx.fillRect(l.x - 2, l.y + 2, 5, 1);
        ctx.fillStyle = on ? l.col : '#2a2d33'; ctx.fillRect(l.x - 1, l.y + 3, 3, 1);
      } else if (l.kind === 'post') {
        ctx.fillStyle = '#15171b'; ctx.fillRect(l.x, l.y - 5, 1, 5); ctx.fillRect(l.x - 1, l.y - 1, 3, 1);
        ctx.fillStyle = on ? l.col : '#2a2d33'; ctx.fillRect(l.x - 1, l.y - 6, 3, 1);
      } else {
        ctx.fillStyle = on ? l.col : '#2a2d33'; ctx.fillRect(l.side > 0 ? l.x : l.x - 1, l.y, 1, 6);
      }
    }
    for (const [tx, ty] of SLICK) { // a glint crawling along wet floors
      if (L.grid[ty][tx] !== '=') continue;
      const gx = (Math.floor(tick / 3) + tx * 5) % 24;
      if (gx < 8) { ctx.fillStyle = '#c8fbff'; ctx.fillRect(tx * 8 + gx, ty * 8, 1, 1); }
    }
    for (const s of L.signs) ctx.drawImage(SIGN, s.x, s.y);
    for (const w of WPS) ctx.drawImage(w.on ? RELAY_ON : RELAY_OFF, w.x + 1, w.y);
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
    if (p) drawPlayer();
    for (const q of parts) { ctx.fillStyle = q.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, q.streak ? Math.max(2, Math.round(-q.vy * 0.8)) : 1); }
  }
  // drawn after the darkness: things that are themselves light
  function drawEmbers() {
    for (const e of EMBERS) {
      if (Math.abs(e.x - cam.x - VW / 2) > VW || Math.abs(e.y - cam.y - VH / 2) > VH) continue;
      for (let k = 0; k < 4; k++) {
        const on = Math.sin(tick * (0.11 + k * 0.05) + e.seed * (k + 1)) > -0.1;
        if (!on) continue;
        ctx.fillStyle = k === 0 ? '#ffd27a' : k < 3 ? '#ff7a2a' : '#b8321a';
        ctx.fillRect(e.x - e.side * (1 + (k % 2)) - (e.side > 0 ? 2 : 0), e.y - 4 + k * 2 + ((e.seed + k) % 2), k === 0 ? 2 : 1, k < 2 ? 2 : 1);
      }
    }
  }
  function drawWind() {
    for (const w of WINDS) {
      const x = w.tx * 8, y = w.ty * 8;
      if (x < cam.x - 8 || x > cam.x + VW || y < cam.y - 8 || y > cam.y + VH) continue;
      for (let k = 0; k < 2; k++) {
        const h = hash(w.tx * 13 + k, w.ty * 7), sy = y + 7 - ((tick * (1.5 + h) + h * 64) % 8);
        ctx.globalAlpha = 0.18 + h * 0.2;
        ctx.fillStyle = h > 0.6 ? '#e8f4ff' : '#9fb4c8';
        ctx.fillRect(x + Math.floor(h * 7), Math.round(sy), 1, 2 + (k === 0 ? 1 : 0));
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawCore() { // a pulsing core; cracks spread as it takes hits
    if (!L.core || L.coreHP <= 0) return;
    const x = L.core.x - 16, y = L.core.y - 8, pulse = (Math.sin(tick * 0.08) + 1) / 2;
    ctx.fillStyle = mix('#5a0c14', '#ff3040', pulse); ctx.fillRect(x + 4, y + 4, 24, 10);
    ctx.fillStyle = mix('#ff3040', '#ffe0e0', pulse); ctx.fillRect(x + 12, y + 7, 8, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 15, y + 9, 2, 2);
    if (coreStrain > 0) coreStrain--;
    ctx.fillStyle = '#08090b';
    for (let i = 0; i < Math.ceil(coreStrain / 16); i++) {
      const hx = hash(i, 7), hy = hash(i, 13);
      ctx.fillRect(x + 4 + Math.floor(hx * 24), y + 4 + Math.floor(hy * 10), 1 + (i % 2), 1);
    }
  }
  function drawWorldFX() {
    drawCore();
    drawWind();
    drawEmbers();
    for (const hdn of HIDDEN) {
      if (hdn.t <= 0) continue;
      const a = Math.min(1, hdn.t / 30), x = hdn.tx * 8, y = hdn.ty * 8;
      const same = (dx) => Phys.tileAt(L, hdn.tx + dx, hdn.ty) === 'h';
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#8ff8ff'; ctx.fillRect(x, y, 8, 1);
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = '#3fd8ff';
      for (let i = 0; i < 8; i += 2) ctx.fillRect(x + i, y + 2 + (i % 4 ? 1 : 0), 1, 1);
      if (!same(-1)) ctx.fillRect(x, y, 1, 5);
      if (!same(1)) ctx.fillRect(x + 7, y, 1, 5);
      ctx.globalAlpha = 1;
    }
    for (const t of tracers) {
      if (!t.w) { dotted(t.segs, 999, t.life > 4 ? '#ffffff' : t.life > 2 ? '#8ff8ff' : '#3fd8ff', 1, t.skip); continue; }
      // charged: a thick red beam that thins out as it fades; hot core from breaker/magnum
      const w = Math.max(1, Math.round(t.w * Math.min(1, t.life / 8)));
      if (t.r) { ctx.globalAlpha = 0.22 * Math.min(1, t.life / 8); band(t.segs, t.r * 2, t.cols[0], t.skip); ctx.globalAlpha = 1; } // the beam's full breaking width
      if (t.max) { ctx.globalAlpha = 0.35; thickLine(t.segs, w + 4, '#ff004d', t.skip); ctx.globalAlpha = 1; }
      thickLine(t.segs, w, t.cols[0], t.skip);
      if (t.cols.length > 1 && w >= 2) thickLine(t.segs, w - 1 - (w > 3 ? 1 : 0), t.cols[1], t.skip);
      if (t.cols.length > 2 && w >= 3) thickLine(t.segs, 1, t.life > 4 ? t.cols[2] : t.cols[1], t.skip);
    }
    if (flash) {
      ctx.fillStyle = '#8ff8ff'; ctx.fillRect(Math.round(flash.x) - 1, Math.round(flash.y) - 1, 3, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(flash.x), Math.round(flash.y), 1, 1);
    }
    if (p && !p.dead) { // visor glow cuts through the dark
      const sx = Math.round(p.x) - 2, sy = Math.round(p.y) - 5; // respirator filter lamps (symmetric)
      ctx.fillStyle = LAMP[p.ammo <= 0 ? 0 : p.ammo >= Phys.maxAmmo(p) ? 2 : 1];
      ctx.fillRect(sx + 3, sy + 5, 1, 1); ctx.fillRect(sx + 6, sy + 5, 1, 1);
    }
    drawPreview();
  }

  // ---------------------------------------------------------------- lighting
  const lightCv = document.createElement('canvas'), lg = lightCv.getContext('2d');
  function lightsInView() {
    const out = [];
    const add = (x, y, r, a, col) => { if (Math.abs(x - cam.x - VW / 2) < VW / 2 + r && Math.abs(y - cam.y - VH / 2) < VH / 2 + r) out.push({ x, y, r, a, col }); };
    if (p && !p.dead) add(p.x + 3, p.y + 1, 38, 0.9, LAMP[p.ammo <= 0 ? 0 : p.ammo >= Phys.maxAmmo(p) ? 2 : 1]);
    if (flash) add(flash.x, flash.y, flash.big ? 90 : 60, 1, flash.charge || (flash.big ? '#ffb347' : '#8ff8ff'));
    for (const t of tracers) {
      const s = t.segs[t.segs.length - 1];
      if (!t.w) { add(s.x1, s.y1, 16, t.life / 6, '#8ff8ff'); continue; }
      const a = Math.min(1, t.life / 8);
      for (const sg of t.segs) { const d = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0); for (let i = 0; i <= d; i += 20) add(sg.x0 + (sg.x1 - sg.x0) * i / d, sg.y0 + (sg.y1 - sg.y0) * i / d, 12 + t.w * 4, a, t.cols[0]); }
      add(s.x1, s.y1, t.max ? 60 : 30, a, t.cols[0]);
    }
    for (const l of LAMPS) if (lampOn(l)) add(l.x, l.y + (l.kind === 'hang' ? 4 : l.kind === 'post' ? -6 : 3), l.r, 0.85, l.col);
    for (const c of L.crystals) if (c.active) add(c.x, c.y, 20, 0.8, '#6ff7ff');
    for (const it of L.items) if (!it.got) add(it.x, it.y, 26, 0.9, '#ffd98a');
    for (const r of L.relics) if (!r.got) add(r.x, r.y, 12, 0.7, '#ff3fa4');
    for (const sg of L.signs) add(sg.x + 4, sg.y + 3, 16, 0.7, '#ffb347');
    for (const w of WPS) add(w.x + 3, w.y + 2, w.on ? 26 : 10, w.on ? 0.9 : 0.5, w.on ? '#3fd8ff' : '#ff3040');
    for (const e of EMBERS) add(e.x - e.side * 3, e.y, 22, 0.7 + 0.2 * Math.sin(tick * 0.2 + e.seed), '#ff7a2a');
    for (const t of L.targets) if (!t.hit) add(t.tx * 8 + 4, t.ty * 8 + 4, 14, tick % 60 < 40 ? 0.9 : 0.5, '#ff3040');
    if (L.core && L.coreHP > 0) add(L.core.x, L.core.y + 4, 40 + 10 * Math.sin(tick * 0.08), 0.9, '#ff3040');
    add(L.flag.x + 4, L.flag.y + 3, 22, 0.8, '#ff3040');
    add(L.gate.x + 4, L.gate.y, 70, 1, '#fff4dc');
    return out;
  }
  const worldCv = document.createElement('canvas'), wctx = worldCv.getContext('2d');
  function applyLighting(dark) {
    if (lightCv.width !== VW || lightCv.height !== VH) { lightCv.width = VW; lightCv.height = VH; }
    lg.globalCompositeOperation = 'source-over';
    lg.globalAlpha = 1;
    lg.fillStyle = 'rgba(2,3,6,' + dark + ')';
    lg.fillRect(0, 0, VW, VH);
    const lights = lightsInView();
    lg.globalCompositeOperation = 'destination-out';
    lg.fillStyle = '#000';
    for (const l of lights) { // stepped falloff keeps the pixel-art look
      const x = Math.round(l.x - Math.round(cam.x)), y = Math.round(l.y - Math.round(cam.y));
      for (const [k, a] of [[1, 0.35], [0.7, 0.35], [0.45, 0.4]]) {
        lg.globalAlpha = a * l.a;
        lg.beginPath(); lg.arc(x, y, l.r * k, 0, 6.283); lg.fill();
      }
    }
    lg.globalAlpha = 1;
    // darken only the foreground structure (the far city stays visible behind it)
    wctx.globalCompositeOperation = 'source-atop';
    wctx.drawImage(lightCv, 0, 0);
    wctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(worldCv, 0, 0);
    // coloured glow on top
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const x = Math.round(l.x - Math.round(cam.x)), y = Math.round(l.y - Math.round(cam.y));
      ctx.globalAlpha = 0.07 * l.a; ctx.fillStyle = l.col;
      ctx.beginPath(); ctx.arc(x, y, l.r * 0.6, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.08 * l.a;
      ctx.beginPath(); ctx.arc(x, y, l.r * 0.25, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function drawHUD() {
    const top = 4;
    drawText(heightM() + 'm', 4, top, '#cfd3d8');
    for (let i = 0; i < Phys.maxAmmo(p); i++) {
      const full = i < p.ammo;
      ctx.fillStyle = '#000'; ctx.fillRect(5 + i * 5, top + 9, 3, 5);
      ctx.fillStyle = full ? '#ffa300' : '#5f574f'; ctx.fillRect(4 + i * 5, top + 8, 3, 5);
      if (full) { ctx.fillStyle = '#ffec27'; ctx.fillRect(4 + i * 5, top + 8, 3, 1); }
    }
    const tt = fmtTime(time);
    drawText(tt, Math.round((VW - textW(tt)) / 2), top, '#5b616d');
    const rc = relicCount() + '/' + L.relics.length;
    ctx.drawImage(FEATHER, Math.round((VW - textW(rc)) / 2) - 8, top + 8);
    drawText(rc, Math.round((VW - textW(rc)) / 2), top + 9, '#ff3fa4');
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
    const ch = chargeLevel();
    if (ch > 0) { // charge ring: fills while held at full power; blinks with a pip per round once charged
      const done = ch >= 1, blink = Math.floor(tick / 3) % 2 === 0;
      ctx.globalAlpha = 0.95;
      const rc = chargeCols(p.ammo)[0];
      ctx.strokeStyle = done ? (blink ? '#ffffff' : rc) : rc; ctx.lineWidth = done ? (isMax(p.ammo) ? 3 : 2) : 1;
      ctx.beginPath(); ctx.arc(ox + 0.5, oy + 0.5, STICK_FULL + 4, -Math.PI / 2, -Math.PI / 2 + ch * 6.283); ctx.stroke();
      if (done) for (let i = 0; i < p.ammo; i++) { ctx.fillStyle = rc; ctx.fillRect(ox - (p.ammo * 4 - 1) / 2 + i * 4 | 0, oy - STICK_FULL - 10, 3, 3); }
    }
    ctx.globalAlpha = 1;
  }
  function render() {
    let sx = 0, sy = 0;
    if (shake > 0) { sx = Math.round(rnd(-1, 1)); sy = Math.round(rnd(-1, 1)); shake--; }
    ctx.imageSmoothingEnabled = false;
    drawBackground();
    if (worldCv.width !== VW || worldCv.height !== VH) { worldCv.width = VW; worldCv.height = VH; }
    wctx.imageSmoothingEnabled = false;
    wctx.clearRect(0, 0, VW, VH);
    ctx = wctx;
    ctx.save();
    ctx.translate(sx - Math.round(cam.x), sy - Math.round(cam.y));
    drawWorld();
    ctx.restore();
    ctx = mainCtx;
    const alt = clamp((START_FEET - (cam.y + VH / 2)) / (START_FEET - TOP_FEET), 0, 1);
    applyLighting(0.84 - skyT() * (0.45 + skyH() * 0.3));
    drawSnow();
    ctx.save();
    ctx.translate(sx - Math.round(cam.x), sy - Math.round(cam.y));
    drawWorldFX();
    ctx.restore();
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
    uctx.fillStyle = '#0a0c10'; uctx.fillRect(x, y, w, h);
    uctx.fillStyle = '#cfe9ec';
    uctx.textBaseline = 'top';
    lines.forEach((l, i) => uctx.fillText(l, x + pad, y + pad + i * lh));
    uctx.globalAlpha = 1;
  }
  const signAlpha = new Map();
  function renderUI() {
    uctx.clearRect(0, 0, ui.width, ui.height);
    if (state === 'title' || !p) return;
    if (whiteout > 0) { uctx.globalAlpha = Math.min(1, whiteout * 1.2); uctx.fillStyle = '#fff6e8'; uctx.fillRect(0, 0, ui.width, ui.height); uctx.globalAlpha = 1; }
    if (intro) { // letterbox + title call
      const bar = Math.round(ui.height * 0.07 * (intro.landed ? clamp(1 - (intro.landed - 160) / 40, 0, 1) : Math.min(1, intro.t / 30)));
      uctx.fillStyle = '#000'; uctx.fillRect(0, 0, ui.width, bar); uctx.fillRect(0, ui.height - bar, ui.width, bar);
      if (intro.title) {
        const t = intro.title, a = t < 30 ? t / 30 : t > 160 ? Math.max(0, 1 - (t - 160) / 40) : 1;
        if (a > 0) {
          const fs = Math.round(42 * dpr), cy = ui.height * 0.36;
          uctx.font = fs + 'px ' + FONT_UI; uctx.textBaseline = 'middle';
          const lines = ['RECOIL', 'CLIMB'];
          const jit = t < 40 && t % 6 < 2 ? 3 * dpr : 0;
          lines.forEach((l, i) => {
            const w = uctx.measureText(l).width, x = (ui.width - w) / 2, y = cy + (i - 0.5) * fs * 1.05;
            uctx.globalAlpha = a * 0.85; uctx.fillStyle = '#ff3040'; uctx.fillText(l, x - 2 * dpr - jit, y);
            uctx.globalAlpha = a * 0.7; uctx.fillStyle = '#3fd8ff'; uctx.fillText(l, x + 2 * dpr + jit, y);
            uctx.globalAlpha = a; uctx.fillStyle = '#e3e6e9'; uctx.fillText(l, x, y);
          });
          uctx.globalAlpha = 1;
        }
      }
      if (intro.t > 90 && intro.landed < 150) { const ss = Math.round(11 * dpr); uctx.font = ss + 'px ' + FONT_UI; uctx.globalAlpha = 0.5; uctx.fillStyle = '#7a808a'; const tx = 'タップで飛ばす'; uctx.fillText(tx, ui.width - uctx.measureText(tx).width - 10 * dpr, ui.height - bar - 12 * dpr); uctx.globalAlpha = 1; }
      return;
    }
    if (banner) {
      const fs = Math.round(20 * dpr);
      uctx.font = fs + 'px ' + FONT_UI; uctx.textBaseline = 'middle';
      uctx.globalAlpha = Math.min(1, banner.life / 40);
      const w = uctx.measureText(banner.text).width;
      uctx.fillStyle = '#000'; uctx.fillText(banner.text, (ui.width - w) / 2 + 2 * dpr, ui.height * 0.3 + 2 * dpr);
      uctx.fillStyle = '#ff3040'; uctx.fillText(banner.text, (ui.width - w) / 2, ui.height * 0.3);
      uctx.globalAlpha = 1;
    }
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
      bubble((s.text || SIGNS[s.id]).split('\n'), sx, sy, a, '#3d8f99');
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
  const scr = { title: $('scrTitle'), pause: $('scrPause'), clear: $('scrClear'), heaven: $('scrHeaven'), item: $('scrItem'), logs: $('scrLogs'), warp: $('scrWarp'), debug: $('scrDebug') };
  function show(name) {
    stopChargeSnd();
    for (const k in scr) scr[k].hidden = k !== name;
    $('btnPause').hidden = name !== null;
  }
  const statsHTML = (rows) => rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
  const baseStats = () => [['経過', fmtTime(time)], ['損傷', misses + '回'], ['発砲', shots + '発'], ['記録片', relicCount() + ' / ' + L.relics.length]];
  function abilList() {
    const out = ['宙の弾 ' + abil.ammo];
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
    $('itemSub').textContent = '――何かを、拾った。';
    $('itemName').textContent = info.name;
    $('itemDesc').textContent = info.desc;
    $('itemAbil').textContent = abilList() + ((type === 'B' && abil.magnum) || (type === 'M' && abil.breaker) ? '\n――二つの弾が、噛み合う気がする。' : '');
    saveGame();
    setTimeout(() => { if (state === 'item') show('item'); }, 350);
  }
  const recordKey = (i) => ((L.relics[i].x - 4) / 8) + ',' + ((L.relics[i].y - 4) / 8);
  const ORDER = (window.LEVEL.RECORD_ORDER || []).slice();
  for (let i = 0; i < L.relics.length; i++) if (!ORDER.includes(recordKey(i))) ORDER.push(recordKey(i));
  const recordNo = (i) => ORDER.indexOf(recordKey(i)) + 1;
  const recordText = (i) => (window.LEVEL.RECORDS || {})[((L.relics[i].x - 4) / 8) + ',' + ((L.relics[i].y - 4) / 8)] || '……';
  function showRecord(i) {
    state = 'item'; stick = null; pendingFire = null;
    const c = $('itemIcon'); const g = c.getContext('2d');
    g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height);
    g.drawImage(FEATHER, 0, 0, 6, 6, 8, 8, 48, 48);
    $('itemSub').textContent = '――記録片が、再生された。';
    $('itemName').textContent = '記録 ' + String(recordNo(i)).padStart(2, '0') + ' / ' + String(L.relics.length).padStart(2, '0');
    $('itemDesc').textContent = recordText(i);
    $('itemAbil').textContent = '記録は「静止」から読み返せる。';
    saveGame();
    setTimeout(() => { if (state === 'item') show('item'); }, 300);
  }
  function showLogs() {
    const list = $('logList');
    list.innerHTML = '';
    const byKey = new Map(L.relics.map((r, i) => [recordKey(i), i]));
    const head = document.createElement('p'); head.className = 'small';
    head.textContent = '回収 ' + relicCount() + ' / ' + L.relics.length;
    list.appendChild(head);
    ORDER.forEach((k, n) => {
      const i = byKey.get(k), got = i != null && L.relics[i].got;
      const d = document.createElement('div'); d.className = 'log' + (got ? '' : ' missing');
      const h = document.createElement('div'); h.className = 'logno'; h.textContent = '記録 ' + String(n + 1).padStart(2, '0');
      const t = document.createElement('div'); t.className = 'logtext'; t.textContent = got ? recordText(i) : '――未回収';
      d.appendChild(h); d.appendChild(t); list.appendChild(d);
    });
    show('logs');
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
    if (best.summit) parts2.push('最上層 ' + fmtTime(best.summit));
    if (best.heaven) parts2.push('外 ' + fmtTime(best.heaven));
    $('bestLine').textContent = parts2.length ? '最短記録　' + parts2.join('　') : '';
    syncSound();
  }
  const syncSound = () => {
    $('btnSound').textContent = '音　' + (prefs.sound ? 'ON' : 'OFF');
    $('btnHaptics').textContent = '振動　' + (prefs.haptics ? 'ON' : 'OFF');
    $('btnHaptics').hidden = !Haptics.supported;
  };
  $('btnNew').addEventListener('click', () => {
    if (store.get(SAVE_KEY, null) && !newArmed) { newArmed = true; $('btnNew').textContent = '記録を消して、はじめから'; return; }
    audioUnlock(); store.del(SAVE_KEY); newGame(); play(); if (!/row|at\d/.test(location.hash)) startIntro();
  });
  $('btnCont').addEventListener('click', () => {
    const s = store.get(SAVE_KEY, null);
    if (!s) return;
    audioUnlock(); loadGame(s); play();
  });
  function play() { state = 'play'; stick = null; pendingFire = null; show(null); }
  function pause() {
    state = 'pause'; saveGame(); stick = null;
    $('pauseStats').innerHTML = statsHTML([['高度', heightM() + 'm'], ['最高高度', bestH + 'm']].concat(baseStats()));
    $('pauseAbil').textContent = abilList();
    syncSound(); show('pause');
  }
  const resume = play;
  function toTitle() { saveGame(); state = 'title'; refreshTitle(); show('title'); }
  function summit() {
    const first = !summitDone;
    summitDone = true;
    SFX.win(); HAPTIC.summit();
    burst(L.flag.x + 4, L.flag.y, 40, ['#ff3040', '#ffffff', '#6ff7ff', '#ffb347', '#a3a9b1'], 2.2, 0.05, 50);
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
    const again = heavenDone;
    heavenDone = true;
    if (again) {
      state = 'clearing'; stick = null; pendingFire = null;
      SFX.relay();
      const rc = relicCount();
      $('heavenSub').textContent = '――また、ここに来た。';
      $('heavenStats').innerHTML = statsHTML(baseStats());
      $('heavenHint').textContent = rc < L.relics.length ? '記録片は、まだ下に眠っている。（' + rc + '/' + L.relics.length + '）' : '記録片は、すべて揃った。…それで、何が変わる？';
      setTimeout(() => { state = 'heaven'; show('heaven'); }, 400);
      return;
    }
    $('heavenSub').textContent = '外だ。誰も、ここまでは来なかった。';
    SFX.win(); HAPTIC.heaven();
    burst(L.gate.x + 4, L.gate.y, 60, ['#ffffff', '#e6dcc4', '#6ff7ff'], 2.5, 0.02, 70);
    if (!best.heaven || time < best.heaven) { best.heaven = time; store.set(BEST_KEY, best); }
    state = 'clearing';
    const rc = relicCount();
    setTimeout(() => {
      $('heavenStats').innerHTML = statsHTML(baseStats());
      $('heavenHint').textContent = rc < L.relics.length ? '記録片は、まだ下に眠っている。（' + rc + '/' + L.relics.length + '）' : '記録片は、すべて揃った。…それで、何が変わる？';
      saveGame();
      state = 'heaven'; show('heaven');
    }, 1500);
  }
  $('btnPause').addEventListener('click', pause);
  $('btnItemOk').addEventListener('click', play);
  $('btnLogs').addEventListener('click', showLogs);
  $('btnLogsBack').addEventListener('click', () => show('pause'));
  function showWarp() {
    const list = $('warpList');
    list.innerHTML = '';
    const on = WPS.filter((w) => w.on);
    if (!on.length) list.innerHTML = '<p class="small">まだ、どの中継点も起動していない。</p>';
    for (const w of on.slice().reverse()) {
      const b = document.createElement('button');
      b.className = 'act warp';
      b.innerHTML = '<span>' + w.name + '</span><span class="h">' + heightOf(w.y + 8) + 'm</span>';
      b.addEventListener('click', () => warpTo(w));
      list.appendChild(b);
    }
    show('warp');
  }
  function warpTo(w) {
    p = Phys.newPlayer(w.x + 1, w.y + 8 - C.PH - 0.0001, abil); p.grounded = true;
    safe = { x: p.x, y: p.y };
    inGate = w.ty < 6; // arriving at the gate's relay should not replay the ending
    snapCam(); resetScarf(); ghosts = [];
    burst(p.x + 3, p.y + 3, 18, ['#3fd8ff', '#ffffff'], 1.6, 0, 22);
    SFX.relay(); HAPTIC.respawn();
    saveGame();
    play();
  }
  // ---------------------------------------------------------------- debug menu (three-finger tap on the pause screen, or D)
  // spots worth jumping to: every relay (active or not), every item, and a few landmarks; bottom of the route first
  const DBG_SPOTS = (() => {
    const out = WPS.map((w) => ({ tag: '中継', name: w.name, tx: w.tx, ty: w.ty }));
    const NAMES = { A: '予備弾倉', B: '砕岩弾', K: '貫通弾', M: '強装弾' };
    for (const it of L.items) out.push({ tag: '道具', name: NAMES[it.type], tx: (it.x - 4) / 8, ty: (it.y - 4) / 8, item: true });
    out.push({ tag: '要所', name: '最上層の旗', tx: L.flag.x / 8, ty: L.flag.y / 8, item: true });
    out.push({ tag: '要所', name: '外の門', tx: L.gate.x / 8, ty: L.gate.y / 8, item: true });
    for (const k of window.LEVEL.RECORD_ORDER) { const [x, y] = k.split(',').map(Number); out.push({ tag: '記録', name: '記録 ' + String(window.LEVEL.RECORD_ORDER.indexOf(k) + 1).padStart(2, '0'), tx: x, ty: y, item: true }); }
    return out.sort((a, b) => b.ty - a.ty);
  })();
  // a standing spot at or below (tx, ty); for pickups, beside them so arriving doesn't take them
  function dbgSpot(tx, ty, beside) {
    const ok = (x, y) => x > 0 && x < L.w - 1 && surfaceAt(x, y);
    for (let dy = 0; dy < 60; dy++) {
      const y = ty + dy;
      const xs = beside ? [tx - 2, tx + 2, tx - 1, tx + 1, tx - 3, tx + 3, tx] : [tx, tx - 1, tx + 1, tx - 2, tx + 2];
      for (const x of xs) if (ok(x, y)) return [x, y];
    }
    return null;
  }
  function dbgWarp(tx, ty, beside) {
    const sp = dbgSpot(tx, ty, beside);
    if (sp) [tx, ty] = sp;
    p = Phys.newPlayer(tx * 8 + 1, ty * 8 + 8 - C.PH - 0.0001, abil);
    p.grounded = !!sp;
    if (sp) safe = { x: p.x, y: p.y };
    inGate = true; // do not replay the ending on arrival
    snapCam(); resetScarf(); ghosts = []; pendingFire = null;
    burst(p.x + 3, p.y + 3, 18, ['#ffb347', '#ffffff'], 1.6, 0, 22);
    SFX.relay();
    saveGame(); play();
  }
  // item state: the pickups in the world follow what the menu grants (magazines in route order)
  function dbgSetAbil(next) {
    Object.assign(abil, next);
    const mags = L.items.filter((it) => it.type === 'A').sort((a, b) => b.y - a.y);
    mags.forEach((it, i) => { it.got = i < abil.ammo; });
    for (const it of L.items) if (it.type !== 'A') it.got = !!abil[{ B: 'breaker', K: 'pierce', M: 'magnum' }[it.type]];
    if (p) { p.abil = abil; p.ammo = Phys.maxAmmo(p); }
    saveGame(); renderDebug();
  }
  function dbgBtn(label, on, fn) {
    const b = document.createElement('button');
    b.className = 'act' + (on ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  function renderDebug() {
    $('dbgPos').textContent = '現在地 ' + Math.floor((p.x + 3) / 8) + ',' + Math.floor((p.y + 4) / 8) + '　高度 ' + heightM() + 'm　' + abilList();
    const am = $('dbgAmmo'); am.innerHTML = '';
    for (let n = 0; n <= C.MAX_AMMO - 1; n++) am.appendChild(dbgBtn('弾倉 ' + (n + 1), abil.ammo === n, () => dbgSetAbil({ ammo: n })));
    am.appendChild(dbgBtn('全部', abil.ammo >= 2 && abil.breaker && abil.pierce && abil.magnum, () => dbgSetAbil({ ammo: 2, breaker: true, pierce: true, magnum: true })));
    const fl = $('dbgFlags'); fl.innerHTML = '';
    [['breaker', '砕岩弾'], ['pierce', '貫通弾'], ['magnum', '強装弾']].forEach(([k, n]) => fl.appendChild(dbgBtn(n, abil[k], () => dbgSetAbil({ [k]: !abil[k] }))));
    $('dbgShell').disabled = L.coreHP <= 0;
  }
  function showDebug() {
    if (state !== 'pause') return;
    const list = $('dbgList'); list.innerHTML = '';
    for (const sp of DBG_SPOTS) {
      const b = document.createElement('button');
      b.className = 'act warp';
      b.innerHTML = '<span><span class="tag">' + sp.tag + '</span>' + sp.name + '</span><span class="h">' + sp.tx + ',' + sp.ty + '</span>';
      b.addEventListener('click', () => dbgWarp(sp.tx, sp.ty, sp.item));
      list.appendChild(b);
    }
    $('dbgX').value = Math.floor((p.x + 3) / 8); $('dbgY').value = Math.floor((p.y + 4) / 8);
    renderDebug();
    HAPTIC.target();
    show('debug');
  }
  $('scrPause').addEventListener('touchstart', (e) => { if (e.touches.length >= 3) { e.preventDefault(); showDebug(); } }, { passive: false });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyD' && state === 'pause' && !scr.pause.hidden) showDebug(); });
  $('dbgGo').addEventListener('click', () => {
    const x = Math.round(+$('dbgX').value), y = Math.round(+$('dbgY').value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    dbgWarp(clamp(x, 1, L.w - 2), clamp(y, 0, L.h - 2), false);
  });
  $('dbgRelays').addEventListener('click', () => { for (const w of WPS) w.on = true; saveGame(); toastUI('中継点をすべて起動した'); });
  $('dbgShell').addEventListener('click', () => { if (L.coreHP > 0) { instantRedraw = true; Phys.collapseShell(L); instantRedraw = false; saveGame(); renderDebug(); toastUI('殻を崩した'); } });
  $('dbgRefill').addEventListener('click', () => { p.ammo = Phys.maxAmmo(p); toastUI('弾を満たした'); });
  $('dbgBack').addEventListener('click', () => show('pause'));
  function toastUI(text) { $('dbgPos').textContent = text; setTimeout(() => { if (!scr.debug.hidden) renderDebug(); }, 1200); }

  $('btnWarp').addEventListener('click', showWarp);
  $('btnWarpBack').addEventListener('click', () => show('pause'));
  $('btnResume').addEventListener('click', resume);
  $('btnTitle').addEventListener('click', toTitle);
  $('btnExplore').addEventListener('click', play);
  $('btnHeavenTitle').addEventListener('click', play);
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

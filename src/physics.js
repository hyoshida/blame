// Shared physics: used by the game (browser) and tools/solve.mjs (node).
(function (root) {
  'use strict';

  const C = {
    TILE: 8,
    G: 0.18,           // gravity px/frame^2 (60fps)
    MAXFALL: 4.2,
    RECOIL: 4.2,       // full-power shot impulse
    RECOIL_MAG: 5.6,   // ... with the magnum rounds item
    MINPOW: 0.3,       // weakest shot (short drag)
    KEEP: 0.25,        // fraction of previous velocity kept when shooting
    AIR_DRAG: 0.975,
    FRIC: 0.86,        // ground slide damping per frame
    ICE_FRIC: 0.99,
    COOLDOWN: 8,
    PW: 6,
    PH: 7,
    CRYSTAL_RESPAWN: 150,
    RANGE: 220,        // bullet range px (total, including bounces)
    BOUNCES: 3,        // metal ricochets per bullet
    HIT_R: 6,          // bullet-vs-crystal radius
    MAX_AMMO: 3,
  };

  // Ability items:  A +1 air shot   B breaker rounds (cracks)   K piercing rounds (glass)   M magnum (stronger recoil)
  const ITEMS = {
    A: { name: '予備弾倉', desc: '宙で、もう一度撃てる。' },
    B: { name: '砕岩弾', desc: '脆くなった構造を、砕ける。' },
    K: { name: '貫通弾', desc: 'ガラスの向こうへ、届く。' },
    M: { name: '強装弾', desc: '反動が、身体をもっと遠くへ運ぶ。' },
  };
  const newAbil = () => ({ ammo: 0, breaker: false, pierce: false, magnum: false });
  function grantItem(abil, type) {
    if (type === 'A') abil.ammo = Math.min(C.MAX_AMMO, abil.ammo + 1);
    else if (type === 'B') abil.breaker = true;
    else if (type === 'K') abil.pierce = true;
    else if (type === 'M') abil.magnum = true;
  }

  // Tiles: # rock  = ice  g glass  x crack  m metal (always bounces bullets)  c cloud  d door
  //        T target  t target (hit)  ^v<> spikes
  const SOLID = { '#': 1, '=': 1, g: 1, x: 1, m: 1, c: 1, d: 1, T: 1, t: 1 };
  const isSolid = (c) => SOLID[c] === 1;
  const stopsBullet = (c) => c === '#' || c === '=' || c === 'x' || c === 'm' || c === 'd' || c === 'T' || c === 't';

  function makeLevel(rows) {
    const w = Math.max(...rows.map((r) => r.length));
    const h = rows.length;
    const grid = rows.map((r) => r.padEnd(w, '#').split(''));
    const L = { w, h, grid, crystals: [], relics: [], items: [], signs: [], targets: [], flag: null, gate: null, start: null, cmap: new Map(), tmap: new Map(), changes: [], onChange: null };
    const doors = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x], px = x * 8, py = y * 8;
        if (c === 'o') L.crystals.push({ x: px + 4, y: py + 4, active: true, t: 0 });
        else if (c === '*') L.relics.push({ x: px + 4, y: py + 4, got: false });
        else if (ITEMS[c]) L.items.push({ x: px + 4, y: py + 4, type: c, got: false });
        else if (c >= '1' && c <= '9') L.signs.push({ x: px, y: py, id: +c });
        else if (c === 'F') L.flag = { x: px, y: py };
        else if (c === 'H') L.gate = { x: px, y: py };
        else if (c === 'P') L.start = { x: px + 1, y: py + 1 };
        else if (c === 'T') { L.tmap.set(y * w + x, L.targets.length); L.targets.push({ tx: x, ty: y, doors: [], hit: false }); continue; }
        else if (c === 'd') { doors.push([x, y]); continue; }
        else continue;
        grid[y][x] = '.';
      }
    }
    // each door tile belongs to the nearest target
    for (const [x, y] of doors) {
      let best = null, bd = 1e9;
      L.targets.forEach((t) => { const d = Math.hypot(t.tx - x, t.ty - y); if (d < bd) { bd = d; best = t; } });
      if (best) best.doors.push([x, y]);
    }
    L.crystals.forEach((c, i) => {
      const tx = (c.x - 4) / 8, ty = (c.y - 4) / 8;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = (ty + dy) * w + tx + dx;
        if (!L.cmap.has(k)) L.cmap.set(k, []);
        L.cmap.get(k).push(i);
      }
    });
    return L;
  }

  function tileAt(L, tx, ty) {
    if (tx < 0 || tx >= L.w || ty < 0 || ty >= L.h) return '#';
    return L.grid[ty][tx];
  }
  function setTile(L, tx, ty, c) {
    L.changes.push([tx, ty, L.grid[ty][tx]]);
    L.grid[ty][tx] = c;
    if (L.onChange) L.onChange(tx, ty);
  }
  function openTarget(L, i) {
    const t = L.targets[i];
    if (t.hit) return;
    t.hit = true;
    setTile(L, t.tx, t.ty, 't');
    for (const [x, y] of t.doors) setTile(L, x, y, '.');
  }

  function solidRect(L, x, y, w, h) {
    const x0 = Math.floor(x / 8), x1 = Math.floor((x + w - 0.001) / 8);
    const y0 = Math.floor(y / 8), y1 = Math.floor((y + h - 0.001) / 8);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (isSolid(tileAt(L, tx, ty))) return true;
    return false;
  }

  function newPlayer(x, y, abil) {
    const a = abil || newAbil();
    return { x, y, vx: 0, vy: 0, abil: a, ammo: a.ammo + 1, cd: 0, grounded: false, onIce: false, dead: false, won: false, heaven: false };
  }
  const maxAmmo = (p) => p.abil.ammo + 1; // one ground shot + air shots

  function moveX(L, p, d) {
    if (!d) return false;
    const n = Math.ceil(Math.abs(d)), inc = d / n;
    for (let i = 0; i < n; i++) {
      p.x += inc;
      if (solidRect(L, p.x, p.y, C.PW, C.PH)) {
        p.x -= inc;
        const snap = inc > 0 ? Math.ceil((p.x + C.PW) / 8) * 8 - C.PW - 0.0001 : Math.floor(p.x / 8) * 8 + 0.0001;
        if (!solidRect(L, snap, p.y, C.PW, C.PH)) p.x = snap;
        return true;
      }
    }
    return false;
  }
  function moveY(L, p, d) {
    if (!d) return false;
    const n = Math.ceil(Math.abs(d)), inc = d / n;
    for (let i = 0; i < n; i++) {
      p.y += inc;
      if (solidRect(L, p.x, p.y, C.PW, C.PH)) {
        p.y -= inc;
        const snap = inc > 0 ? Math.ceil((p.y + C.PH) / 8) * 8 - C.PH - 0.0001 : Math.floor(p.y / 8) * 8 + 0.0001;
        if (!solidRect(L, p.x, snap, C.PW, C.PH)) p.y = snap;
        return true;
      }
    }
    return false;
  }

  const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  function touchingSpikes(L, p) {
    const x0 = Math.floor(p.x / 8), x1 = Math.floor((p.x + C.PW) / 8);
    const y0 = Math.floor(p.y / 8), y1 = Math.floor((p.y + C.PH) / 8);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const c = tileAt(L, tx, ty), bx = tx * 8, by = ty * 8;
        if (c === '^' && overlap(p.x, p.y, C.PW, C.PH, bx + 1, by + 5, 6, 3)) return true;
        if (c === 'v' && overlap(p.x, p.y, C.PW, C.PH, bx + 1, by, 6, 3)) return true;
        if (c === '>' && overlap(p.x, p.y, C.PW, C.PH, bx, by + 1, 3, 6)) return true;
        if (c === '<' && overlap(p.x, p.y, C.PW, C.PH, bx + 5, by + 1, 3, 6)) return true;
      }
    return false;
  }

  // Hitscan bullet from the player's centre. Passes spikes/clouds (and glass with piercing
  // rounds); bounces off metal; with breaker it breaks cracks; hitting a target opens its
  // doors; passing through a crystal refills ammo. dry = preview: report hits, change nothing.
  function fireBullet(L, p, dx, dy, dry) {
    let x = p.x + C.PW / 2, y = p.y + 4;
    let tx = Math.floor(x / 8), ty = Math.floor(y / 8);
    let sx = x, sy = y, dist = 0, bounces = 0;
    const segs = [], hits = [];
    const STEP = 0.5;
    const seenCrystal = new Set();
    while (dist < C.RANGE) {
      const nx = x + dx * STEP, ny = y + dy * STEP;
      dist += STEP;
      const ntx = Math.floor(nx / 8), nty = Math.floor(ny / 8);
      if (ntx !== tx || nty !== ty) {
        const c = tileAt(L, ntx, nty);
        if (c === 'm') {
          let fx = ntx !== tx, fy = nty !== ty;
          if (fx && fy) {
            if (stopsBullet(tileAt(L, ntx, ty))) fy = false;
            else if (stopsBullet(tileAt(L, tx, nty))) fx = false;
          }
          if (fx) dx = -dx;
          if (fy) dy = -dy;
          segs.push({ x0: sx, y0: sy, x1: x, y1: y });
          sx = x; sy = y;
          hits.push({ t: 'ping', x, y });
          if (++bounces > C.BOUNCES) break;
          continue;
        }
        if (stopsBullet(c) || (c === 'g' && !p.abil.pierce)) {
          x = nx; y = ny;
          if (c === 'x' && p.abil.breaker) { if (!dry) setTile(L, ntx, nty, '.'); hits.push({ t: 'break', tx: ntx, ty: nty, x, y }); }
          else if (c === 'x') hits.push({ t: 'clank', x, y, dx, dy });
          else if (c === 'T') { const i = L.tmap.get(nty * L.w + ntx); if (!dry) openTarget(L, i); hits.push({ t: 'target', i, tx: ntx, ty: nty, x, y }); }
          else if (c === 'g') hits.push({ t: 'glass', x, y, dx, dy });
          else hits.push({ t: 'wall', x, y, dx, dy });
          break;
        }
        tx = ntx; ty = nty;
      }
      x = nx; y = ny;
      const near = L.cmap.get(ty * L.w + tx);
      if (near) for (const i of near) {
        const cr = L.crystals[i];
        if (cr.active && !seenCrystal.has(i) && (x - cr.x) ** 2 + (y - cr.y) ** 2 < C.HIT_R * C.HIT_R) {
          seenCrystal.add(i);
          if (!dry) { cr.active = false; cr.t = C.CRYSTAL_RESPAWN; p.ammo = maxAmmo(p); }
          hits.push({ t: 'crystal', i, x: cr.x, y: cr.y, remote: true });
        }
      }
    }
    segs.push({ x0: sx, y0: sy, x1: x, y1: y });
    return { segs, hits };
  }

  // inp: { fire: null | {dx, dy, pow} }   dry: preview simulation, no world side effects
  function step(L, p, inp, ev, dry) {
    if (p.dead) return;
    const wasGrounded = p.grounded;
    const fallSpeed = p.vy;
    if (p.cd > 0) p.cd--;

    if (inp && inp.fire && p.cd <= 0 && p.ammo > 0) {
      const { dx, dy } = inp.fire;
      const k = (p.abil.magnum ? C.RECOIL_MAG : C.RECOIL) * (inp.fire.pow == null ? 1 : inp.fire.pow);
      p.vx = -dx * k + p.vx * C.KEEP;
      p.vy = -dy * k + p.vy * C.KEEP;
      p.ammo--;
      p.cd = C.COOLDOWN;
      p.grounded = false;
      const b = fireBullet(L, p, dx, dy, dry);
      if (ev) ev.push({ t: 'shot', dx, dy, segs: b.segs, hits: b.hits });
    }

    if (p.grounded) {
      p.vx *= p.onIce ? C.ICE_FRIC : C.FRIC;
      if (Math.abs(p.vx) < 0.03) p.vx = 0;
    } else p.vx *= C.AIR_DRAG;
    p.vy = Math.min(p.vy + C.G, C.MAXFALL);

    if (moveX(L, p, p.vx)) p.vx = 0;
    if (moveY(L, p, p.vy)) p.vy = 0;

    p.grounded = p.vy >= 0 && solidRect(L, p.x, p.y + C.PH, C.PW, 1);
    if (p.grounded) {
      p.vy = 0;
      p.ammo = maxAmmo(p);
      const y = Math.floor((p.y + C.PH + 0.5) / 8);
      p.onIce = tileAt(L, Math.floor((p.x + 1) / 8), y) === '=' || tileAt(L, Math.floor((p.x + C.PW - 1) / 8), y) === '=';
      if (!wasGrounded && ev) ev.push({ t: 'land', v: fallSpeed });
    }

    if (touchingSpikes(L, p)) {
      p.dead = true;
      if (ev) ev.push({ t: 'die' });
      return;
    }
    if (dry) return;

    for (const c of L.crystals) {
      if (c.active && p.ammo < maxAmmo(p) && overlap(p.x, p.y, C.PW, C.PH, c.x - 4, c.y - 4, 8, 8)) {
        c.active = false; c.t = C.CRYSTAL_RESPAWN; p.ammo = maxAmmo(p);
        if (ev) ev.push({ t: 'crystal', x: c.x, y: c.y });
      }
    }
    L.items.forEach((it, i) => {
      if (!it.got && overlap(p.x, p.y, C.PW, C.PH, it.x - 4, it.y - 5, 8, 10)) {
        it.got = true;
        grantItem(p.abil, it.type);
        p.ammo = maxAmmo(p);
        if (ev) ev.push({ t: 'item', i, type: it.type, x: it.x, y: it.y });
      }
    });
    L.relics.forEach((r, i) => {
      if (!r.got && overlap(p.x, p.y, C.PW, C.PH, r.x - 4, r.y - 4, 8, 8)) {
        r.got = true;
        if (ev) ev.push({ t: 'relic', i, x: r.x, y: r.y });
      }
    });
    if (L.flag && !p.won && overlap(p.x, p.y, C.PW, C.PH, L.flag.x, L.flag.y, 8, 8)) {
      p.won = true;
      if (ev) ev.push({ t: 'flag' });
    }
    if (L.gate && !p.heaven && overlap(p.x, p.y, C.PW, C.PH, L.gate.x, L.gate.y - 8, 8, 16)) {
      p.heaven = true;
      if (ev) ev.push({ t: 'heaven' });
    }
  }

  function tickWorld(L) {
    for (const c of L.crystals) if (!c.active && --c.t <= 0) c.active = true;
  }

  const API = { C, ITEMS, newAbil, grantItem, makeLevel, tileAt, setTile, openTarget, isSolid, stopsBullet, solidRect, newPlayer, maxAmmo, step, tickWorld, fireBullet, touchingSpikes };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Phys = API;
})(typeof window !== 'undefined' ? window : globalThis);

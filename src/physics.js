// Shared physics: used by the game (browser) and tools/solve.mjs (node).
(function (root) {
  'use strict';

  const C = {
    TILE: 8,
    G: 0.2,           // gravity px/frame^2 (60fps)
    MAXFALL: 4.2,
    RECOIL: 4.0,      // shot impulse
    KEEP: 0.25,       // fraction of previous velocity kept when shooting
    AIR_DRAG: 0.975,
    AIR_ACC: 0.07,
    AIR_MAX: 1.0,
    WALK: 0.9,
    GROUND_ACC: 0.25,
    FRIC: 0.7,
    ICE_FRIC: 0.985,
    ICE_ACC: 0.04,
    AMMO: 2,
    COOLDOWN: 9,
    PW: 6,
    PH: 7,
    SPIKE_BOUNCE: 3.2,
    STUN: 18,
    CRYSTAL_RESPAWN: 150,
  };

  function makeLevel(rows) {
    const w = Math.max(...rows.map((r) => r.length));
    const h = rows.length;
    const grid = rows.map((r) => r.padEnd(w, '.').split(''));
    const crystals = [];
    let flag = null;
    let start = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        if (c === 'o') { crystals.push({ x: x * 8 + 4, y: y * 8 + 4, active: true, t: 0 }); grid[y][x] = '.'; }
        else if (c === 'F') { flag = { x: x * 8, y: y * 8 }; grid[y][x] = '.'; }
        else if (c === 'P') { start = { x: x * 8 + 1, y: y * 8 + 1 }; grid[y][x] = '.'; }
      }
    }
    return { w, h, grid, crystals, flag, start };
  }

  function tileAt(L, tx, ty) {
    if (tx < 0 || tx >= L.w) return '#';
    if (ty < 0) return '.';
    if (ty >= L.h) return '#';
    return L.grid[ty][tx];
  }
  const isSolid = (c) => c === '#' || c === '=';

  function solidRect(L, x, y, w, h) {
    const x0 = Math.floor(x / 8), x1 = Math.floor((x + w - 0.001) / 8);
    const y0 = Math.floor(y / 8), y1 = Math.floor((y + h - 0.001) / 8);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (isSolid(tileAt(L, tx, ty))) return true;
    return false;
  }

  function newPlayer(x, y) {
    return { x, y, vx: 0, vy: 0, ammo: C.AMMO, cd: 0, grounded: false, onIce: false, stun: 0, facing: 1, won: false };
  }

  // Move along one axis in <=1px sub-steps; snap to tile edge on contact.
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

  function checkSpikes(L, p) {
    const x0 = Math.floor(p.x / 8), x1 = Math.floor((p.x + C.PW) / 8);
    const y0 = Math.floor(p.y / 8), y1 = Math.floor((p.y + C.PH) / 8);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const c = tileAt(L, tx, ty), bx = tx * 8, by = ty * 8;
        if (c === '^' && overlap(p.x, p.y, C.PW, C.PH, bx + 1, by + 5, 6, 3)) return [0, -1];
        if (c === 'v' && overlap(p.x, p.y, C.PW, C.PH, bx + 1, by, 6, 3)) return [0, 1];
        if (c === '>' && overlap(p.x, p.y, C.PW, C.PH, bx, by + 1, 3, 6)) return [1, 0];
        if (c === '<' && overlap(p.x, p.y, C.PW, C.PH, bx + 5, by + 1, 3, 6)) return [-1, 0];
      }
    return null;
  }

  // inp: { move: -1|0|1, fire: null | {dx, dy} (unit aim vector) }
  function step(L, p, inp, ev) {
    const wasGrounded = p.grounded;
    const fallSpeed = p.vy;
    if (p.cd > 0) p.cd--;
    if (p.stun > 0) p.stun--;
    const move = p.stun > 0 ? 0 : (inp.move || 0);
    if (move) p.facing = move;

    if (inp.fire && p.cd <= 0 && p.ammo > 0) {
      const { dx, dy } = inp.fire;
      p.vx = -dx * C.RECOIL + p.vx * C.KEEP;
      p.vy = -dy * C.RECOIL + p.vy * C.KEEP;
      p.ammo--;
      p.cd = C.COOLDOWN;
      p.grounded = false;
      if (ev) ev.push({ t: 'shot', dx, dy });
    }

    if (p.grounded) {
      const ice = p.onIce;
      if (move) {
        const target = move * C.WALK;
        if (Math.sign(p.vx) === move && Math.abs(p.vx) > C.WALK) p.vx *= ice ? C.ICE_FRIC : C.FRIC;
        else {
          const acc = ice ? C.ICE_ACC : C.GROUND_ACC;
          p.vx += Math.max(-acc, Math.min(acc, target - p.vx));
        }
      } else {
        p.vx *= ice ? C.ICE_FRIC : C.FRIC;
        if (Math.abs(p.vx) < 0.02) p.vx = 0;
      }
    } else {
      p.vx *= C.AIR_DRAG;
      if (move > 0 && p.vx < C.AIR_MAX) p.vx = Math.min(p.vx + C.AIR_ACC, C.AIR_MAX);
      if (move < 0 && p.vx > -C.AIR_MAX) p.vx = Math.max(p.vx - C.AIR_ACC, -C.AIR_MAX);
    }
    p.vy = Math.min(p.vy + C.G, C.MAXFALL);

    if (moveX(L, p, p.vx)) p.vx = 0;
    if (moveY(L, p, p.vy)) p.vy = 0;

    p.grounded = p.vy >= 0 && solidRect(L, p.x, p.y + C.PH, C.PW, 1);
    if (p.grounded) {
      p.vy = 0;
      p.ammo = C.AMMO;
      const y = Math.floor((p.y + C.PH + 0.5) / 8);
      p.onIce = tileAt(L, Math.floor((p.x + 1) / 8), y) === '=' || tileAt(L, Math.floor((p.x + C.PW - 1) / 8), y) === '=';
      if (!wasGrounded && ev) ev.push({ t: 'land', v: fallSpeed });
    }

    const sp = checkSpikes(L, p);
    if (sp) {
      if (sp[1]) { p.vy = sp[1] * C.SPIKE_BOUNCE; p.vx = p.vx * 0.5 + (p.vx >= 0 ? -0.6 : 0.6); }
      if (sp[0]) { p.vx = sp[0] * C.SPIKE_BOUNCE; p.vy = Math.min(p.vy, -1); }
      p.grounded = false;
      p.stun = C.STUN;
      if (ev) ev.push({ t: 'spike' });
    }

    for (const c of L.crystals) {
      if (!c.active) { if (--c.t <= 0) c.active = true; continue; }
      if (p.ammo < C.AMMO && overlap(p.x, p.y, C.PW, C.PH, c.x - 4, c.y - 4, 8, 8)) {
        c.active = false; c.t = C.CRYSTAL_RESPAWN; p.ammo = C.AMMO;
        if (ev) ev.push({ t: 'crystal', x: c.x, y: c.y });
      }
    }

    if (L.flag && !p.won && overlap(p.x, p.y, C.PW, C.PH, L.flag.x, L.flag.y, 8, 8)) {
      p.won = true;
      if (ev) ev.push({ t: 'win' });
    }
  }

  // Hitscan: first solid point along ray from (x,y).
  function raycast(L, x, y, dx, dy, max) {
    for (let d = 0; d < max; d += 1) {
      const px = x + dx * d, py = y + dy * d;
      if (isSolid(tileAt(L, Math.floor(px / 8), Math.floor(py / 8)))) return { x: px, y: py, hit: true };
    }
    return { x: x + dx * max, y: y + dy * max, hit: false };
  }

  const API = { C, makeLevel, tileAt, isSolid, solidRect, newPlayer, step, raycast };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Phys = API;
})(typeof window !== 'undefined' ? window : globalThis);

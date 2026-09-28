// Reachability solver. From every standing spot it simulates many shot plans
// (1-4 shots, seeded random angles/power/timing plus player-like templates) and
// records where the player comes to rest. Progress runs in phases: items picked up
// and targets hit in one phase become abilities / open doors for the next, until
// nothing new is found. With breaker rounds, cracks count as already broken.
// Exits 1 if the summit flag or the heaven gate cannot be reached.
// Usage: node tools/solve.mjs [--samples 1] [--seed N] [--quiet] [--full] [--no-blast]
// Zone test: --from x,y [--abil ammo=2,breaker,pierce,magnum] [--open] [--goal ROW] [--print y0,y1,x0,x1]
//   starts at tile x,y with those abilities (items not collected), --open opens every door,
//   stops as soon as a surface at or above ROW is reached, and prints that part of the map.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Phys = require('../src/physics.js');
const { ROWS } = require('../src/level.js');
const { C } = Phys;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const MUL = arg('--samples', 1);
const QUIET = process.argv.includes('--quiet');
const FULL = process.argv.includes('--full');
const TRACE = (() => { const i = process.argv.indexOf('--trace'); return i > 0 ? process.argv[i + 1] : null; })(); // e.g. --trace 108,151
if (process.argv.includes('--no-blast')) C.BLAST = 1; // check the item-only route (player never discovers wall blasts) // re-explore everything each phase (checks backtracking feathers)
let seed = arg('--seed', 12345);
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dir = (a) => ({ dx: Math.cos(a), dy: Math.sin(a) });
const rAng = () => (rnd() < 0.8 ? (0.03 + rnd() * 0.94) * Math.PI : rnd() * Math.PI * 2); // mostly downward shots
const rDown = () => (0.5 + (rnd() - 0.5) * 0.5) * Math.PI;
const rPow = () => (rnd() < 0.4 ? 1 : C.MINPOW + rnd() * (1 - C.MINPOW));
const MAXF = 300;
const sarg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const FROM = sarg('--from'), GOAL = sarg('--goal'), ABIL = sarg('--abil'), PRINT = sarg('--print'), OPEN = process.argv.includes('--open');

const L = Phys.makeLevel(ROWS);
const base = L.grid.map((r) => r.slice());
const abil = Phys.newAbil();
if (ABIL) for (const part of ABIL.split(',')) { const [k, v] = part.split('='); abil[k] = v === undefined ? true : +v; }
const itemsGot = new Set(), targetsHit = new Set(OPEN ? L.targets.map((t, i) => i) : []);
function applyPhaseWorld() {
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    let c = base[y][x];
    if (c === 'x' && abil.breaker) c = '.';
    if (c === 'X' && abil.breaker && abil.magnum) c = '.';
    L.grid[y][x] = c;
  }
  for (const i of targetsHit) {
    const t = L.targets[i];
    t.hit = true;
    L.grid[t.ty][t.tx] = 't';
    for (const [x, y] of t.doors) L.grid[y][x] = '.';
  }
  L.targets.forEach((t, i) => { t.hit = targetsHit.has(i); });
  L.changes = [];
}
function undoSimChanges() {
  while (L.changes.length) { const [x, y, c] = L.changes.pop(); L.grid[y][x] = c; }
  L.targets.forEach((t, i) => { t.hit = targetsHit.has(i); });
}

const free = (tx, ty) => { const c = Phys.tileAt(L, tx, ty); return !Phys.isSolid(c) && !'^v<>'.includes(c); };
const surface = (tx, ty) => free(tx, ty) && Phys.isSolid(Phys.tileAt(L, tx, ty + 1));
const key = (tx, ty) => ty * L.w + tx;
function nodeOf(p) {
  const ty = Math.floor((p.y + C.PH + 0.5) / 8) - 1;
  const tx = Math.floor((p.x + C.PW / 2) / 8);
  return surface(tx, ty) ? key(tx, ty) : null;
}

// aim helpers (what a player does when they have spotted something)
function aimAtCrystal(p, s) {
  let best = null, bd = 1e9;
  const cx = p.x + C.PW / 2, cy = p.y + 4;
  for (const c of L.crystals) {
    if (!c.active) continue;
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d < bd && d < C.RANGE) { bd = d; best = c; }
  }
  if (!best) return { t: s.t, dx: 0, dy: 1, pow: s.pow };
  return { t: s.t, dx: (best.x - cx) / bd, dy: (best.y - cy) / bd, pow: s.pow };
}
function aimAtTarget(p, s) {
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2, d = dir(a);
    const b = Phys.fireBullet(L, p, d.dx, d.dy, true);
    if (b.hits.some((h) => h.t === 'target' && !L.targets[h.i].hit)) return { t: s.t, ...d, pow: s.pow };
  }
  return null;
}

let phase = 0, focusRow = L.h, focusRows = null; // focusRows: rows worth re-exploring next phase (null = everything)
const log = [];
const found = { summit: false, heaven: false, relics: new Set(), items: new Set(), targets: new Set() };
let sims = 0;
function sim(tx, ty, shots) {
  const p = Phys.newPlayer(tx * 8 + 1, ty * 8 + 8 - C.PH - 0.0001, { ...abil });
  p.grounded = true;
  for (const c of L.crystals) { c.active = true; c.t = 0; }
  for (const r of L.relics) r.got = false;
  L.items.forEach((it) => { it.got = true; }); // items only take effect between phases
  let si = 0, result = null;
  sims++;
  const maxf = shots.maxf || MAXF;
  for (let f = 0; f < maxf; f++) {
    let s = si < shots.length && shots[si].t <= f ? shots[si] : null;
    if (s && s.aim === 'crystal') s = aimAtCrystal(p, s);
    else if (s && s.aim === 'target') { s = aimAtTarget(p, s); if (!s) break; }
    const ev = [];
    Phys.step(L, p, { fire: s }, ev);
    if (s) si++;
    for (const e of ev) {
      if (e.t === 'flag') { if (!found.summit) log.push(`phase ${phase}: SUMMIT`); found.summit = true; }
      else if (e.t === 'heaven') { if (!found.heaven) log.push(`phase ${phase}: HEAVEN`); found.heaven = true; }
      else if (e.t === 'relic' && TRACE && `${(L.relics[e.i].x - 4) / 8},${(L.relics[e.i].y - 4) / 8}` === TRACE && !found.relics.has(e.i)) console.log('TRACE', { from: [tx, ty], frame: f, shots: JSON.stringify(shots.map((q) => q.aim ? q : { t: q.t, dx: +q.dx.toFixed(2), dy: +q.dy.toFixed(2), pow: +q.pow.toFixed(2) })) });
      else if (e.t === 'relic' && !found.relics.has(e.i)) { log.push(`phase ${phase}: feather @${(L.relics[e.i].x - 4) / 8},${(L.relics[e.i].y - 4) / 8}`); found.relics.add(e.i); }
      else if (e.t === 'relic') found.relics.add(e.i);
      else if (e.t === 'item') found.items.add(e.i);
      else if (e.t === 'shot') for (const h of e.hits) if (h.t === 'target') found.targets.add(h.i);
    }
    L.items.forEach((it, i) => { if (!itemsGot.has(i) && Math.abs(p.x + 3 - it.x) < 7 && Math.abs(p.y + 4 - it.y) < 8) found.items.add(i); });
    if (p.dead) break;
    if (si >= shots.length && p.grounded && p.vx === 0) { result = nodeOf(p); break; }
  }
  undoSimChanges();
  return result;
}

const nearThing = (tx, ty, list, r) => list.some((c) => Math.abs(c.x / 8 - tx) < r && Math.abs(c.y / 8 - ty) < r + 2);
const nearTarget = (tx, ty) => L.targets.some((t) => !t.hit && Math.abs(t.tx - tx) < 16 && Math.abs(t.ty - ty) < 12);
function plans(tx, ty) {
  const out = [];
  for (let i = 0; i < 48; i++) for (const pow of [0.3, 0.55, 0.8, 1]) out.push([{ t: 0, ...dir((i / 48) * Math.PI * 2), pow }]);
  const ammo = abil.ammo + 1;
  for (let i = 0; i < (ammo >= 2 ? 3000 : 300) * MUL; i++) {
    const d = 4 + Math.floor(rnd() * 40);
    out.push([{ t: 0, ...dir(rAng()), pow: rPow() }, { t: d, ...dir(rAng()), pow: rPow() }]);
  }
  for (let i = 0; i < (ammo >= 3 ? 1500 : 0) * MUL; i++) { // 3-4 shot plans (useful once the player has more ammo)
    const k = 3 + (rnd() < 0.5 ? 1 : 0), plan = [];
    let t = 0;
    for (let j = 0; j < k; j++) { plan.push({ t, ...dir(rAng()), pow: rPow() }); t += 8 + Math.floor(rnd() * 30); }
    out.push(plan);
  }
  // climb template: stack mostly-downward shots near each apex, drifting sideways at the end
  for (let i = 0; i < (ammo >= 2 ? 1500 : 0) * MUL; i++) {
    const plan = [];
    let t = 0;
    for (let j = 0; j < ammo; j++) {
      const a = j < ammo - 1 ? (0.5 + (rnd() - 0.5) * 0.15) * Math.PI : rDown();
      plan.push({ t, ...dir(a), pow: rnd() < 0.7 ? 1 : rPow() });
      t += 12 + Math.floor(rnd() * 14);
    }
    out.push(plan);
  }
  if (nearThing(tx, ty, L.crystals, 16)) {
    for (let i = 0; i < 3000 * MUL; i++) {
      const t2 = 4 + Math.floor(rnd() * 24), t3 = t2 + 6 + Math.floor(rnd() * 16), t4 = t3 + 6 + Math.floor(rnd() * 16);
      const plan = [{ t: 0, ...dir(rDown()), pow: rPow() }, { t: t2, aim: 'crystal', pow: rPow() }, { t: t3, ...dir(rDown()), pow: rPow() }];
      if (rnd() < 0.7) plan.push({ t: t4, ...dir(rDown()), pow: rPow() });
      if (rnd() < 0.4) plan.push({ t: t4 + 6 + Math.floor(rnd() * 16), aim: 'crystal', pow: rPow() }, { t: t4 + 20 + Math.floor(rnd() * 16), ...dir(rDown()), pow: rPow() });
      if (rnd() < 0.3) plan.splice(1, 0, { t: Math.max(1, t2 - 3 - Math.floor(rnd() * 8)), ...dir(rDown()), pow: rPow() });
      plan.sort((a, b) => a.t - b.t);
      out.push(plan);
    }
  }
  // wall-blast template: hop, then shoot steeply into a nearby wall to kick off it
  for (const side of [-1, 1]) {
    let near = false;
    for (let d = 1; d <= 3 && !near; d++) for (let r = 0; r <= 4; r++) if (Phys.isSolid(Phys.tileAt(L, tx + side * d, ty - r))) { near = true; break; }
    if (!near) continue;
    for (let i = 0; i < 600 * MUL; i++) {
      const t2 = 6 + Math.floor(rnd() * 24), a = 0.1 + rnd() * 3.5;
      const plan = [{ t: 0, ...dir(Math.atan2(1, side * rnd() * 0.4)), pow: rPow() }, { t: t2, ...dir(Math.atan2(a, side)), pow: rnd() < 0.6 ? 1 : rPow() }];
      if (ammo >= 3 || rnd() < 0.5) plan.push({ t: t2 + 8 + Math.floor(rnd() * 20), ...dir(rAng()), pow: rPow() });
      out.push(plan);
    }
  }
  // updraft template: ride the wind for a while, then shoot out of it (late shots, longer simulation)
  let windy = false;
  for (let dy = -14; dy <= 4 && !windy; dy++) for (let dx = -12; dx <= 12; dx++) if (Phys.tileAt(L, tx + dx, ty + dy) === 'w') { windy = true; break; }
  if (windy) for (let i = 0; i < 1200 * MUL; i++) {
    const t2 = 15 + Math.floor(rnd() * 300);
    const plan = [{ t: 0, ...dir(rnd() * Math.PI * 2), pow: rPow() }, { t: t2, ...dir(rnd() * Math.PI * 2), pow: rPow() }];
    if (rnd() < 0.6) plan.push({ t: t2 + 6 + Math.floor(rnd() * 40), ...dir(rnd() * Math.PI * 2), pow: rPow() });
    plan.maxf = 520;
    out.push(plan);
  }
  if (nearTarget(tx, ty)) {
    out.push([{ t: 0, aim: 'target', pow: C.MINPOW }]);
    for (let i = 0; i < 60; i++) out.push([{ t: 0, ...dir(rDown()), pow: rPow() }, { t: 6 + Math.floor(rnd() * 20), aim: 'target', pow: C.MINPOW }]);
  }
  return out;
}

const startNode = FROM ? key(+FROM.split(',')[0], +FROM.split(',')[1]) : key(Math.floor(L.start.x / 8), Math.floor(L.start.y / 8));
let goalHit = null;
const seen = new Set([startNode]);
const t0 = Date.now();
for (;;) {
  phase++;
  applyPhaseWorld();
  // later phases: only re-explore around/above where the newest ability or door appeared
  const near = (row) => focusRows.some((r) => Math.abs(r - row) <= 20);
  const queue = [...seen].filter((k) => FULL || phase === 1 || !focusRows || Math.floor(k / L.w) <= focusRow || near(Math.floor(k / L.w)));
  const done = new Set();
  while (queue.length) {
    const k = queue.shift();
    if (done.has(k)) continue;
    done.add(k);
    const tx = k % L.w, ty = Math.floor(k / L.w);
    if (!surface(tx, ty)) continue;
    const next = new Set();
    for (const d of [-1, 1]) if (surface(tx + d, ty)) next.add(key(tx + d, ty));
    for (const plan of plans(tx, ty)) { const r = sim(tx, ty, plan); if (r !== null) next.add(r); }
    for (const n of next) if (!seen.has(n)) { seen.add(n); queue.push(n); if (GOAL && Math.floor(n / L.w) <= +GOAL && !goalHit) goalHit = [n % L.w, Math.floor(n / L.w)]; }
    if (goalHit) break;
  }
  let changed = false;
  focusRow = -1; focusRows = [];
  const before = { ...abil };
  for (const i of found.items) if (!itemsGot.has(i)) { focusRow = Math.max(focusRow, (L.items[i].y - 4) / 8 + 16); itemsGot.add(i); Phys.grantItem(abil, L.items[i].type); changed = true; log.push(`phase ${phase}: item ${L.items[i].type} @${(L.items[i].x - 4) / 8},${(L.items[i].y - 4) / 8}`); }
  for (const i of found.targets) if (!targetsHit.has(i)) { focusRow = Math.max(focusRow, L.targets[i].ty + 16); for (const [, dy] of L.targets[i].doors) focusRows.push(dy); targetsHit.add(i); changed = true; log.push(`phase ${phase}: target @${L.targets[i].tx},${L.targets[i].ty}`); }
  // new abilities matter wherever their tiles are (this is what makes backtracking visible)
  const rowsOf = (pred) => { const r = new Set(); base.forEach((row, y) => row.forEach((c) => { if (pred(c)) r.add(y); })); return [...r]; };
  if (abil.breaker && !before.breaker) focusRows.push(...rowsOf((c) => c === 'x'));
  if (abil.breaker && abil.magnum && !(before.breaker && before.magnum)) focusRows.push(...rowsOf((c) => c === 'X'));
  if (abil.pierce && !before.pierce) focusRows.push(...rowsOf((c) => c === 'g' || c === 'T'));
  if (abil.ammo !== before.ammo || abil.magnum !== before.magnum) focusRows = null; // movement changed: look everywhere
  if (!QUIET) console.error(`phase ${phase}: ${seen.size} surfaces, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!changed || FROM) break;
}

const out = L.grid.map((r) => r.slice());
for (const k of seen) out[Math.floor(k / L.w)][k % L.w] = '@';
for (const c of L.crystals) out[(c.y - 4) / 8][(c.x - 4) / 8] = 'o';
L.relics.forEach((r, i) => { out[(r.y - 4) / 8][(r.x - 4) / 8] = found.relics.has(i) ? '*' : '?'; });
L.items.forEach((it, i) => { out[(it.y - 4) / 8][(it.x - 4) / 8] = itemsGot.has(i) ? it.type : it.type.toLowerCase(); });
if (L.flag) out[L.flag.y / 8][L.flag.x / 8] = 'F';
if (L.gate) out[L.gate.y / 8][L.gate.x / 8] = 'H';
if (PRINT) {
  const [y0, y1, x0, x1] = PRINT.split(',').map(Number);
  console.log(out.slice(y0, y1 + 1).map((r, i) => String(i + y0).padStart(3) + ' ' + r.slice(x0, x1 + 1).join('')).join('\n'));
}
if (FROM) {
  console.log(GOAL ? (goalHit ? `GOAL reached at ${goalHit}` : 'GOAL NOT reached') : '', `surfaces ${seen.size}, sims ${sims}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(!GOAL || goalHit ? 0 : 1);
}
if (!QUIET) {
  console.log('--- tower (x 114-139)');
  console.log(out.slice(0, 167).map((r, i) => String(i).padStart(3) + ' ' + r.slice(114).join('')).join('\n'));
  console.log('--- field (rows 148-171)');
  console.log(out.slice(148).map((r, i) => String(i + 148).padStart(3) + ' ' + r.slice(0, 120).join('')).join('\n'));
}
console.log('\n' + log.join('\n'));
console.log(`surfaces reached: ${seen.size}  summit: ${found.summit}  heaven: ${found.heaven}  feathers: ${found.relics.size}/${L.relics.length}  items: ${itemsGot.size}/${L.items.length}`);
console.log(`sims: ${sims}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(found.summit && found.heaven ? 0 : 1);

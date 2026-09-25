// Reachability solver: brute-forces shot plans from every standing spot and
// reports which surfaces (and whether the flag) are reachable from the start.
// Usage: node tools/solve.mjs [--angles 16]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Phys = require('../src/physics.js');
const ROWS = require('../src/level.js');
const { C } = Phys;

const L = Phys.makeLevel(ROWS);
const argAngles = process.argv.indexOf('--angles');
const NA = argAngles > 0 ? +process.argv[argAngles + 1] : 16;
const ANG = [...Array(NA)].map((_, i) => { const a = (i / NA) * Math.PI * 2; return { dx: Math.cos(a), dy: Math.sin(a) }; });
const DELAYS = [6, 12, 20, 30];
const WALKOFF = [0, 8, 18];
const MAXF = 260;

const free = (tx, ty) => !Phys.isSolid(Phys.tileAt(L, tx, ty));
const surface = (tx, ty) => free(tx, ty) && Phys.isSolid(Phys.tileAt(L, tx, ty + 1));
const key = (tx, ty) => ty * L.w + tx;

function nodeOf(p) {
  const ty = Math.floor((p.y + C.PH + 0.5) / 8) - 1;
  const tx = Math.floor((p.x + C.PW / 2) / 8);
  return surface(tx, ty) ? key(tx, ty) : null;
}

function sim(tx, ty, hold, shots) {
  const p = Phys.newPlayer(tx * 8 + 1, ty * 8 + 8 - C.PH - 0.0001);
  p.grounded = true;
  p.vx = hold * C.WALK;
  for (const c of L.crystals) { c.active = true; c.t = 0; }
  let si = 0, airborne = false, still = 0;
  for (let f = 0; f < MAXF; f++) {
    const fire = si < shots.length && shots[si].t === f ? ANG[shots[si].a] : null;
    if (fire) si++;
    const ev = [];
    Phys.step(L, p, { move: airborne ? hold : hold, fire }, ev);
    if (p.won) return 'WIN';
    if (!p.grounded) airborne = true;
    if (airborne && p.grounded && si >= shots.length) {
      if (Math.abs(p.vx) < 0.05 || ++still > 40) return nodeOf(p);
    }
  }
  return p.grounded ? nodeOf(p) : null;
}

const start = L.start;
const startNode = nodeOf({ x: start.x, y: Math.floor((start.y) / 8) * 8 + 8 - C.PH });
const seen = new Set([startNode]);
const queue = [startNode];
let win = false;
let sims = 0;
const t0 = Date.now();

function nearCrystal(tx, ty) {
  return L.crystals.some((c) => Math.abs(c.x / 8 - tx) < 10 && ty - c.y / 8 > -2 && ty - c.y / 8 < 10);
}

function walkNeighbors(k) {
  const tx = k % L.w, ty = Math.floor(k / L.w), out = [];
  for (const d of [-1, 1]) if (surface(tx + d, ty)) out.push(key(tx + d, ty));
  return out;
}

while (queue.length) {
  const k = queue.shift();
  const tx = k % L.w, ty = Math.floor(k / L.w);
  const found = new Set(walkNeighbors(k));
  for (const hold of [0, -1, 1]) {
    // walk off / drop without shooting
    const r = sim(tx, ty, hold, []); sims++;
    if (r === 'WIN') win = true; else if (r !== null) found.add(r);
    const offs = hold === 0 ? [0] : WALKOFF;
    for (const t1 of offs) for (let a1 = 0; a1 < NA; a1++) {
      const r1 = sim(tx, ty, hold, [{ t: t1, a: a1 }]); sims++;
      if (r1 === 'WIN') win = true; else if (r1 !== null) found.add(r1);
      for (const d of DELAYS) for (let a2 = 0; a2 < NA; a2++) {
        const r2 = sim(tx, ty, hold, [{ t: t1, a: a1 }, { t: t1 + d, a: a2 }]); sims++;
        if (r2 === 'WIN') win = true; else if (r2 !== null) found.add(r2);
        // Near a crystal a refill mid-air allows a third shot.
        if (nearCrystal(tx, ty)) for (const d3 of [8, 16, 26]) for (let a3 = 0; a3 < NA; a3 += 2) {
          const r3 = sim(tx, ty, hold, [{ t: t1, a: a1 }, { t: t1 + d, a: a2 }, { t: t1 + d + d3, a: a3 }]); sims++;
          if (r3 === 'WIN') win = true; else if (r3 !== null) found.add(r3);
        }
      }
    }
  }
  for (const n of found) if (!seen.has(n)) { seen.add(n); queue.push(n); }
}

// Report
let topRow = L.h;
for (const k of seen) topRow = Math.min(topRow, Math.floor(k / L.w));
const out = L.grid.map((r) => r.slice());
for (const k of seen) out[Math.floor(k / L.w)][k % L.w] = '*';
for (const c of L.crystals) out[(c.y - 4) / 8][(c.x - 4) / 8] = 'o';
if (L.flag) out[L.flag.y / 8][L.flag.x / 8] = 'F';
console.log(out.map((r, i) => String(i).padStart(3) + ' ' + r.join('')).join('\n'));
console.log(`\nreachable surfaces: ${seen.size}, highest row: ${topRow}, flag reached: ${win}`);
console.log(`sims: ${sims}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(win ? 0 : 1);

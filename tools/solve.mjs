// Reachability solver. From every standing spot it simulates many shot plans
// (1-4 shots with random angle/power/timing, seeded) and records where the player
// comes to rest. Cracks are treated as already broken (the player can always shoot
// them). Exits 1 if the summit flag or the heaven gate cannot be reached.
// Usage: node tools/solve.mjs [--samples 1] [--quiet]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Phys = require('../src/physics.js');
const { ROWS } = require('../src/level.js');
const { C } = Phys;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const MUL = arg('--samples', 1);
const QUIET = process.argv.includes('--quiet');

const L = Phys.makeLevel(ROWS.map((r) => r.replace(/x/g, '.')));
let seed = arg("--seed", 12345);
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dir = (a) => ({ dx: Math.cos(a), dy: Math.sin(a) });
// Most useful shots point downward (they push the player up), so bias toward them.
const rAng = () => (rnd() < 0.8 ? (0.03 + rnd() * 0.94) * Math.PI : rnd() * Math.PI * 2);
const rPow = () => (rnd() < 0.4 ? 1 : 0.35 + rnd() * 0.65);
const MAXF = 320;

const free = (tx, ty) => { const c = Phys.tileAt(L, tx, ty); return !Phys.isSolid(c) && !'^v<>'.includes(c); };
const surface = (tx, ty) => free(tx, ty) && Phys.isSolid(Phys.tileAt(L, tx, ty + 1));
const key = (tx, ty) => ty * L.w + tx;
function nodeOf(p) {
  const ty = Math.floor((p.y + C.PH + 0.5) / 8) - 1;
  const tx = Math.floor((p.x + C.PW / 2) / 8);
  return surface(tx, ty) ? key(tx, ty) : null;
}

// A shot aimed at the nearest active crystal (what a player does to refill remotely).
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

let summit = false, heaven = false, sims = 0;
const relicsHit = new Set();
function sim(tx, ty, offs, shots) {
  const p = Phys.newPlayer(tx * 8 + offs, ty * 8 + 8 - C.PH - 0.0001);
  p.grounded = true;
  for (const c of L.crystals) { c.active = true; c.t = 0; }
  for (const r of L.relics) r.got = false;
  let si = 0;
  sims++;
  for (let f = 0; f < MAXF; f++) {
    let s = si < shots.length && shots[si].t <= f ? shots[si] : null;
    if (s && s.aim) s = aimAtCrystal(p, s);
    const ev = [];
    Phys.step(L, p, { fire: s }, ev);
    if (s) si++;
    for (const e of ev) {
      if (e.t === 'flag') summit = true;
      else if (e.t === 'heaven') heaven = true;
      else if (e.t === 'relic') relicsHit.add(e.i);
    }
    if (p.dead) return null;
    if (si >= shots.length && p.grounded && p.vx === 0) return nodeOf(p);
  }
  return null;
}

const nearCrystal = (tx, ty) => L.crystals.some((c) => Math.abs(c.x / 8 - tx) < 14 && Math.abs(c.y / 8 - ty) < 16);
function plans(tx, ty) {
  const out = [];
  for (let i = 0; i < 48; i++) for (const pow of [0.35, 0.55, 0.8, 1]) out.push([{ t: 0, ...dir((i / 48) * Math.PI * 2), pow }]);
  const n2 = 8000 * MUL;
  for (let i = 0; i < n2; i++) {
    const d = 4 + Math.floor(rnd() * 40);
    out.push([{ t: 0, ...dir(rAng()), pow: rPow() }, { t: d, ...dir(rAng()), pow: rPow() }]);
  }
  if (nearCrystal(tx, ty)) {
    const n3 = 8000 * MUL;
    for (let i = 0; i < n3; i++) {
      const k = 3 + (rnd() < 0.5 ? 1 : 0), plan = [];
      let t = 0;
      for (let j = 0; j < k; j++) {
        plan.push(j > 0 && rnd() < 0.35 ? { t, aim: true, pow: rPow() } : { t, ...dir(rAng()), pow: rPow() });
        t += 8 + Math.floor(rnd() * 36);
      }
      out.push(plan);
    }
  }
  if (nearCrystal(tx, ty)) {
    // player-like templates: push up, refill by shooting a crystal, push up again
    const rDown = () => (0.5 + (rnd() - 0.5) * 0.5) * Math.PI;
    for (let i = 0; i < 4000 * MUL; i++) {
      const t2 = 4 + Math.floor(rnd() * 24), t3 = t2 + 6 + Math.floor(rnd() * 16), t4 = t3 + 6 + Math.floor(rnd() * 16);
      const plan = [{ t: 0, ...dir(rDown()), pow: rPow() }, { t: t2, aim: true, pow: rPow() }, { t: t3, ...dir(rDown()), pow: rPow() }];
      if (rnd() < 0.7) plan.push({ t: t4, ...dir(rDown()), pow: rPow() });
      if (rnd() < 0.3) plan.splice(1, 0, { t: Math.max(1, t2 - 3 - Math.floor(rnd() * 8)), ...dir(rDown()), pow: rPow() });
      plan.sort((a, b) => a.t - b.t);
      out.push(plan);
    }
  }
  return out;
}

const start = L.start;
const startNode = key(Math.floor(start.x / 8), Math.floor(start.y / 8));
const seen = new Set([startNode]);
const queue = [startNode];
const t0 = Date.now();
while (queue.length) {
  const k = queue.shift();
  const tx = k % L.w, ty = Math.floor(k / L.w);
  const found = new Set();
  for (const d of [-1, 1]) if (surface(tx + d, ty)) found.add(key(tx + d, ty)); // tiny nudge shots
  for (const plan of plans(tx, ty)) for (const offs of [1]) {
    const r = sim(tx, ty, offs, plan);
    if (r !== null) found.add(r);
  }
  for (const n of found) if (!seen.has(n)) { seen.add(n); queue.push(n); }
}

const out = L.grid.map((r) => r.slice());
for (const k of seen) out[Math.floor(k / L.w)][k % L.w] = '@';
for (const c of L.crystals) out[(c.y - 4) / 8][(c.x - 4) / 8] = 'o';
L.relics.forEach((r, i) => { out[(r.y - 4) / 8][(r.x - 4) / 8] = relicsHit.has(i) ? '*' : '?'; });
if (L.flag) out[L.flag.y / 8][L.flag.x / 8] = 'F';
if (L.gate) out[L.gate.y / 8][L.gate.x / 8] = 'H';
if (!QUIET) {
  console.log('--- tower (x 76-99)');
  console.log(out.slice(0, 146).map((r, i) => String(i).padStart(3) + ' ' + r.slice(76).join('')).join('\n'));
  console.log('--- band (rows 134-151)');
  console.log(out.slice(134).map((r, i) => String(i + 134).padStart(3) + ' ' + r.join('')).join('\n'));
}
console.log(`\nsurfaces reached: ${seen.size}  summit: ${summit}  heaven: ${heaven}  feathers: ${relicsHit.size}/${L.relics.length}`);
console.log(`sims: ${sims}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(summit && heaven ? 0 : 1);

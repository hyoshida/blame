// Charged-shot check: plates and the superstructure's core break only to charged shots, fired from
// spots the player actually stands on. Exits 1 if any expectation fails.  node tools/charge-check.cjs
const P = require('../src/physics.js');
const LV = require('../src/level.js');
let bad = 0;
function test(tx, ty, abil, fire, label, want) {
  const L = P.makeLevel(LV.ROWS);
  const p = P.newPlayer(tx * 8 + 1, ty * 8 + 0.9, Object.assign(P.newAbil(), abil));
  for (let i = 0; i < 5; i++) P.step(L, p, null, []);
  const ev = []; P.step(L, p, { fire }, ev);
  const s = ev.find((e) => e.t === 'shot');
  const got = s ? s.hits.map((h) => h.t)[0] : 'none';
  if (got !== want) bad++;
  console.log(got === want ? 'ok  ' : 'FAIL', label, 'ammo', p.ammo, 'out', s && s.out, s && s.hits.map((h) => h.t + (h.tiles ? h.tiles.length : '')).join(','));
}
const OY = LV.OY;
test(128, 271 + OY, { ammo: 0 }, { dx: 0, dy: -1, pow: 1, charge: true }, 'plate, 1 round:', 'clank');
test(128, 271 + OY, { ammo: 1 }, { dx: 0, dy: -1, pow: 1 }, 'plate, uncharged:', 'clank');
test(128, 271 + OY, { ammo: 1 }, { dx: 0, dy: -1, pow: 1, charge: true }, 'plate, charged 2:', 'plate');
test(133, 218, { ammo: 2 }, { dx: 0, dy: 1, pow: 1, charge: true }, 'cage roof charged:', 'plate');
const full = { ammo: 2, breaker: true, magnum: true };
test(61, 35, full, { dx: 0, dy: -1, pow: 1, charge: true }, 'core max:', 'collapse');
test(61, 35, { ...full, ammo: 1 }, { dx: 0, dy: -1, pow: 1, charge: true }, 'core 2 rounds:', 'clank');
test(61, 35, full, { dx: 0, dy: -1, pow: 1 }, 'core single:', 'clank');
// after a jump the magazine is not full, but a charge still spends what is left
{ const p = P.newPlayer(0, 0, Object.assign(P.newAbil(), { ammo: 2 })); p.ammo = 2; const ok = P.canCharge(p); p.ammo = 0; const ok0 = !P.canCharge(p); if (!ok || !ok0) bad++; console.log(ok && ok0 ? 'ok  ' : 'FAIL', 'partial magazine can charge'); }
process.exit(bad ? 1 : 0);

// Telemetry logic check with a fake clock (no browser): falls, misses, stalls, quit.  node tools/telemetry-check.cjs
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
globalThis.matchMedia = () => ({ matches: true });
require('../src/telemetry.js');
const T = globalThis.Telemetry.create('test');
let bad = 0;
const ok = (c, m) => { if (!c) bad++; console.log(c ? 'ok  ' : 'FAIL', m); };
const ctx = (t, o = {}) => Object.assign({ t, h: 0, tx: 5, ty: 100, zone: '目覚めの床', grounded: true }, o);
T.begin('new', ctx(0));
T.frame(ctx(10, { ty: 90, h: 10 }));                 // standing at row 90
T.land(ctx(20, { ty: 99 }));                          // 9 rows lower: a fall
T.land(ctx(30, { ty: 101 }));                         // 2 rows: not a fall
T.miss(ctx(40));
T.progress('item A', ctx(60 * 90));                   // 90 s after the last progress: a stall
T.progress('record', ctx(60 * 95));                   // 5 s: not a stall
T.quit('hidden', ctx(60 * 200, { h: 12 }));
const s = T.current();
ok(s.falls === 1 && s.fallRows === 9, 'falls counted (' + s.falls + ', ' + s.fallRows + ' rows)');
ok(s.misses === 1, 'misses counted');
ok(s.stalls.length === 1 && s.stalls[0].sec === 90 && s.stalls[0].endedBy === 'item A', 'stall recorded');
ok(s.quit && s.quit.reason === 'hidden' && s.quit.sinceProgressSec === 105, 'quit point with time since progress');
ok(T.all().length === 1, 'saved locally');
process.exit(bad ? 1 : 0);

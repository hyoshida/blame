// Telemetry report: where players quit, fall, get hurt and get stuck.
//   node tools/telemetry-report.mjs sessions.json            (exported from the debug menu, or several files)
//   node tools/telemetry-report.mjs "https://script.google.com/macros/s/.../exec?key=READ_KEY"
//   --all  include debug sessions
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
let sessions = [];
for (const a of args.filter((x) => !x.startsWith('--'))) {
  const data = /^https?:/.test(a) ? await (await fetch(a)).json() : JSON.parse(readFileSync(a, 'utf8'));
  sessions.push(...(Array.isArray(data) ? data : [data]));
}
if (!args.filter((x) => !x.startsWith('--')).length) { console.error('usage: node tools/telemetry-report.mjs <sessions.json | web app URL?key=...> [--all]'); process.exit(1); }
const seen = new Map();
for (const s of sessions) if (s && s.sid && (!seen.has(s.sid) || (s.updatedAt || '') > (seen.get(s.sid).updatedAt || ''))) seen.set(s.sid, s);
sessions = [...seen.values()].filter((s) => ALL || !s.debug);

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const sum = (f) => sessions.reduce((a, s) => a + (f(s) || 0), 0);
const n = sessions.length;
console.log(`sessions ${n}${ALL ? ' (debug included)' : ''}   play ${mmss(sum((s) => s.playSec))}   avg max height ${n ? Math.round(sum((s) => s.maxH) / n) : 0}m`);
console.log(`falls ${sum((s) => s.falls)} (${sum((s) => s.fallRows)} rows)   misses ${sum((s) => s.misses)}   stalled ${mmss(sum((s) => s.stalledSec))}\n`);

const by = {};
const z = (k) => (by[k || '?'] = by[k || '?'] || { quits: 0, falls: 0, rows: 0, misses: 0, stalls: 0, sec: 0 });
for (const s of sessions) {
  if (s.quit) z(s.quit.at).quits++;
  for (const f of s.fallSpots || []) { const o = z(f[4]); o.falls++; o.rows += f[2]; }
  for (const m of s.missSpots || []) z(m[3]).misses++;
  for (const st of s.stalls || []) { const o = z(st.at); o.stalls++; o.sec += st.sec; }
}
const rows = Object.entries(by).sort((a, b) => b[1].sec - a[1].sec || b[1].quits - a[1].quits);
const pad = (v, w) => String(v).padStart(w);
console.log('place (nearest relay)'.padEnd(14, ' ') + '  quit  fall  rows  miss  stall  stalled');
for (const [k, o] of rows) console.log(k.padEnd(14, '　').slice(0, 14) + pad(o.quits, 6) + pad(o.falls, 6) + pad(o.rows, 6) + pad(o.misses, 6) + pad(o.stalls, 7) + pad(mmss(o.sec), 9));

const quits = sessions.filter((s) => s.quit).sort((a, b) => (b.quit.sinceProgressSec || 0) - (a.quit.sinceProgressSec || 0)).slice(0, 10);
if (quits.length) {
  console.log('\nquit after the longest time without progress:');
  for (const s of quits) console.log(`  ${s.sid}  ${s.quit.at} (${s.quit.tx},${s.quit.ty}) ${s.quit.h}m  ${s.quit.reason}  stuck ${mmss(s.quit.sinceProgressSec || 0)}  played ${mmss(s.playSec)}`);
}

// RECOIL CLIMB telemetry receiver — Google Apps Script bound to a Google Sheet (free).
// Setup: see README "テレメトリ（GitHub Pages 版の送信先）".
//
//   doPost  : the game POSTs one session as JSON; it is upserted as one row per session id in "sessions".
//   doGet   : ?key=<READ_KEY> returns every session as JSON (for tools/telemetry-report.mjs).
//   summarize(): rebuilds the "summary" sheet (menu: RECOIL CLIMB > 集計を更新, or a time trigger).

const SESSIONS = 'sessions';
const COLS = ['sid', 'updatedAt', 'startedAt', 'build', 'kind', 'input', 'debug', 'playSec', 'startH', 'maxH',
  'misses', 'falls', 'fallRows', 'stalls', 'stalledSec', 'longestStallSec',
  'quitReason', 'quitAt', 'quitTx', 'quitTy', 'quitH', 'quitSinceProgressSec', 'lastMilestone', 'json'];

function sheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (header) { sh.appendRow(header); sh.setFrozenRows(1); } }
  return sh;
}
const out_ = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doPost(e) {
  let s;
  try { s = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false }); }
  if (!s || s.v !== 1 || !/^[a-z0-9]{6,24}$/.test(String(s.sid))) return out_({ ok: false });
  const q = s.quit || {};
  const ms = (s.milestones || [])[(s.milestones || []).length - 1];
  let json = JSON.stringify(s);
  if (json.length > 45000) json = json.slice(0, 45000); // a cell holds 50k characters
  const row = [s.sid, s.updatedAt, s.startedAt, s.build, s.kind, s.input, !!s.debug, s.playSec, s.startH, s.maxH,
    s.misses, s.falls, s.fallRows, (s.stalls || []).length, s.stalledSec, s.longestStallSec,
    q.reason || '', q.at || '', q.tx == null ? '' : q.tx, q.ty == null ? '' : q.ty, q.h == null ? '' : q.h,
    q.sinceProgressSec == null ? '' : q.sinceProgressSec, ms ? ms[0] : '', json];
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_(SESSIONS, COLS);
    const hit = sh.getRange('A:A').createTextFinder(s.sid).matchEntireCell(true).findNext();
    if (hit) sh.getRange(hit.getRow(), 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
  } finally { lock.releaseLock(); }
  return out_({ ok: true });
}

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('READ_KEY');
  if (!key || !e || !e.parameter || e.parameter.key !== key) return out_({ ok: false });
  return out_(sessions_());
}

function sessions_() {
  const sh = sheet_(SESSIONS, COLS);
  const vals = sh.getDataRange().getValues();
  const j = COLS.indexOf('json');
  return vals.slice(1).map((r) => { try { return JSON.parse(r[j]); } catch (err) { return null; } }).filter(Boolean);
}

// Where people stop, fall, get hurt and get stuck — by place (the nearest relay), debug sessions excluded.
function summarize() {
  const all = sessions_().filter((s) => !s.debug);
  const by = {};
  const z = (name) => (by[name || '?'] = by[name || '?'] || { quits: 0, falls: 0, fallRows: 0, misses: 0, stalls: 0, stallSec: 0 });
  all.forEach((s) => {
    if (s.quit) z(s.quit.at).quits++;
    (s.fallSpots || []).forEach((f) => { const o = z(f[4]); o.falls++; o.fallRows += f[2]; });
    (s.missSpots || []).forEach((m) => { z(m[3]).misses++; });
    (s.stalls || []).forEach((st) => { const o = z(st.at); o.stalls++; o.stallSec += st.sec; });
  });
  const rows = Object.keys(by).map((k) => [k, by[k].quits, by[k].falls, by[k].fallRows, by[k].misses, by[k].stalls, Math.round(by[k].stallSec / 60 * 10) / 10])
    .sort((a, b) => b[6] - a[6] || b[1] - a[1]);
  const sh = sheet_('summary');
  sh.clear();
  const n = all.length, sum = (f) => all.reduce((a, s) => a + (f(s) || 0), 0);
  sh.getRange(1, 1, 6, 2).setValues([
    ['セッション（デバッグ除く）', n],
    ['合計プレイ（分）', Math.round(sum((s) => s.playSec) / 6) / 10],
    ['平均 最高高度（m）', n ? Math.round(sum((s) => s.maxH) / n) : 0],
    ['合計 落下', sum((s) => s.falls)],
    ['合計 損傷', sum((s) => s.misses)],
    ['合計 停滞（分）', Math.round(sum((s) => s.stalledSec) / 6) / 10],
  ]);
  const head = ['場所（最寄りの中継点）', 'やめた', '落下', '落差（マス）', '損傷', '停滞 回', '停滞 分'];
  sh.getRange(8, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  if (rows.length) sh.getRange(9, 1, rows.length, head.length).setValues(rows);
  sh.getRange(1, 4).setValue('更新 ' + new Date().toLocaleString('ja-JP'));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RECOIL CLIMB').addItem('集計を更新', 'summarize').addToUi();
}

// Play telemetry: where a run stopped, how often the player fell or missed, and how long progress stalled.
// Kept per session (one run from the title screen) in localStorage and, when the page runs as a claude.ai
// artifact with the db capability, mirrored to the shared collection `telemetry/<session id>`.
// Nothing personal is recorded: a random session id, game-time seconds and tile positions only.
(function (root) {
  'use strict';
  const KEY = 'recoilclimb.telemetry.v1';
  const KEEP = 30;           // sessions kept locally
  const STALL_SEC = 60;      // game-time seconds without progress that count as a stall
  const FALL_ROWS = 6;       // landing this many tiles below where you last stood counts as a fall
  const CAP = 300;           // max entries per list

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const save = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all.slice(-KEEP))); } catch (e) { /* full or blocked */ } };
  const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const push = (arr, v) => { if (arr.length < CAP) arr.push(v); };

  function create(build) {
    let s = null, dirty = false, lastProgress = 0, groundY = null;
    // ---- optional remote sink (claude.ai artifact db)
    let db = null, writing = false, pending = false, lastWrite = 0, timer = null;
    if (root.claude && typeof root.claude.use === 'function') {
      root.claude.use('db').then((d) => { db = d; if (db && s) flush(true); }).catch(() => { db = null; });
    }
    async function writeRemote() {
      if (!db || !s) return;
      if (writing) { pending = true; return; }
      writing = true;
      try { await db.doc('telemetry/' + s.sid).set(JSON.parse(JSON.stringify(s))); lastWrite = Date.now(); }
      catch (e) { if (e && (e.code === 'invalid_argument' || e.code === 'not_granted' || e.code === 'capability_removed')) db = null; }
      writing = false;
      if (pending) { pending = false; writeRemote(); }
    }
    function flush(force) {
      if (!s || (!dirty && !force)) return;
      dirty = false;
      s.updatedAt = new Date().toISOString();
      const all = load().filter((x) => x.sid !== s.sid);
      all.push(s); save(all);
      if (force || Date.now() - lastWrite > 20000) writeRemote();
      else if (!timer) timer = setTimeout(() => { timer = null; writeRemote(); }, 20000 - (Date.now() - lastWrite)); // at most one remote write per 20s
    }
    const touch = () => { dirty = true; };

    return {
      STALL_SEC,
      // a run starts from the title: 'new' (はじめから) or 'continue'
      begin(kind, ctx) {
        if (s) this.quit('restart', ctx);
        s = {
          v: 1, sid: rid(), build, kind, startedAt: new Date().toISOString(), updatedAt: null,
          input: matchMedia && matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
          debug: !!(root.location && /row|at\d/.test(root.location.hash)), t0: ctx.t, startH: ctx.h, maxH: ctx.h, playSec: 0,
          misses: 0, missSpots: [], falls: 0, fallRows: 0, fallSpots: [],
          stalls: [], stalledSec: 0, longestStallSec: 0, milestones: [], quit: null,
        };
        lastProgress = ctx.t; groundY = null;
        touch(); flush(true);
      },
      // called every play frame with {t (frames), h (m), tx, ty, grounded, py}
      frame(ctx) {
        if (!s) return;
        s.playSec = Math.round((ctx.t - s.t0) / 60);
        if (s.quit) { s.quit = null; touch(); } // came back and kept playing
        if (ctx.h > s.maxH) { s.maxH = ctx.h; this.progress('height', ctx, true); }
        if (ctx.grounded) groundY = ctx.ty;
        if (ctx.t % 600 === 0) touch();
        if (ctx.t % 1800 === 0) flush();
      },
      land(ctx) {
        if (!s || groundY == null) return;
        const rows = ctx.ty - groundY;
        if (rows >= FALL_ROWS) { s.falls++; s.fallRows += rows; push(s.fallSpots, [ctx.tx, ctx.ty, rows, Math.round((ctx.t - s.t0) / 60)]); touch(); }
        groundY = ctx.ty;
      },
      miss(ctx) {
        if (!s) return;
        s.misses++; push(s.missSpots, [ctx.tx, ctx.ty, Math.round((ctx.t - s.t0) / 60)]); touch();
        groundY = null; // respawn is not a fall
      },
      // something moved the run forward; the gap since the last one may have been a stall
      progress(what, ctx, quiet) {
        if (!s) return;
        const gap = (ctx.t - lastProgress) / 60;
        if (gap >= STALL_SEC) {
          const sec = Math.round(gap);
          push(s.stalls, { at: ctx.zone, tx: ctx.tx, ty: ctx.ty, sec, endedBy: what, t: Math.round((ctx.t - s.t0) / 60) });
          s.stalledSec += sec; s.longestStallSec = Math.max(s.longestStallSec, sec);
          touch();
        }
        lastProgress = ctx.t;
        if (!quiet) { push(s.milestones, [what, Math.round((ctx.t - s.t0) / 60), ctx.zone]); touch(); flush(); }
      },
      markDebug() { if (s && !s.debug) { s.debug = true; touch(); } },
      // where the run stopped (page hidden, back to title, closed). The last one written wins.
      quit(reason, ctx) {
        if (!s) return;
        s.quit = { reason, at: ctx.zone, tx: ctx.tx, ty: ctx.ty, h: ctx.h, t: Math.round((ctx.t - s.t0) / 60), sinceProgressSec: Math.round((ctx.t - lastProgress) / 60) };
        touch(); flush(true);
      },
      current: () => s,
      all: load,
      clear() { save([]); },
    };
  }
  root.Telemetry = { create };
})(typeof window !== 'undefined' ? window : globalThis);

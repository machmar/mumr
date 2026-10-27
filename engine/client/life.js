// A page's LIFE LOG: one numbered line for each thing that happens to the page itself (it entered mixed reality, it was hidden, the
// tracking was reset, the socket closed and why). Each line goes to the server's log (engine/server/serverlog.py, POST /log) the moment it is
// written, with `keepalive`, so that it gets there even when the page is being hidden or closed; a post that failed is sent again with
// the next one (the server skips numbers it has). The last lines are also kept in sessionStorage, so a page that reloads shows what
// happened before. No THREE and no DOM (fetch and storage are handed in, or taken from the browser).
//
// Why: in Nudgy (2026-10-22) a recorder that read the page's frame loop went blind exactly when the headset was taken off; the bug
// was in those seconds. Logging that does not depend on the frame loop, and that is on all the time, is part of the engine.
(function (M) {
  // opts: { url ('/log'), name (who: 'Quest 3'), pid (this page's id; default: one kept in sessionStorage), keep (lines kept, 40),
  //         fetch, storage (a Storage, or null for none), now () -> ms, clock () -> Date (for the time of day) }
  function make(opts = {}) {
    const url = opts.url || '/log', keep = opts.keep || 40;
    globalThis.MUMR_STARTED = true;                  // (the page has started: all.js stops reporting errors before start)
    const fetchFn = opts.fetch !== undefined ? opts.fetch : globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
    let store = opts.storage;
    if (store === undefined) { try { store = globalThis.sessionStorage || null; } catch (e) { store = null; } }
    const get = (k, d) => { try { const v = store && store.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
    const set = (k, v) => { try { if (store) store.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked: the log goes on without it */ } };
    const pid = opts.pid || get('mumr.life.pid', null) || Math.random().toString(36).slice(2, 10);
    set('mumr.life.pid', pid);
    const state = get('mumr.life', { n: 0, lines: [] });
    let pending = [];                                // [n, text] not yet taken by the server
    let busy = false;

    function post() {
      if (!fetchFn || busy || !pending.length) return;
      const batch = pending.slice(0, 200);
      busy = true;
      const body = JSON.stringify({ pid, name: opts.name || '', n: batch[0][0], lines: batch.map((b) => b[1]) });
      let p;
      try { p = fetchFn(url, { method: 'POST', body, keepalive: body.length < 60000, headers: { 'Content-Type': 'application/json' } }); } catch (e) { busy = false; return; }
      Promise.resolve(p).then((r) => {
        busy = false;
        if (r && r.ok !== false) { pending = pending.filter((b) => b[0] > batch[batch.length - 1][0]); if (pending.length) post(); }
      }, () => { busy = false; });
    }
    function life(text) {
      const d = opts.clock ? opts.clock() : new Date();
      const line = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${text}`;
      state.n++;
      state.lines.push(`#${state.n} ${line}`);
      if (state.lines.length > keep) state.lines.splice(0, state.lines.length - keep);
      set('mumr.life', state);
      pending.push([state.n, line]);
      if (pending.length > 1000) pending.splice(0, pending.length - 1000);
      post();
      return state.n;
    }
    life.lines = () => state.lines.slice();
    life.pending = () => pending.length;
    life.flush = post;
    life.pid = pid;
    return life;
  }

  M.life = { make };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

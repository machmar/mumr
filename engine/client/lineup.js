// LINING UP: the Aligner (align.js), the anchor keeper (anchor.js), the session and saving, as one piece an app wires in. No THREE and
// no DOM.
//
// The player presses Line up (the action 'lineUp' on its menu: anybody may press it, it happens at the owner's headset), rests an index
// fingertip on cross 1 and on cross 2 for ten seconds each, and checks on cross 3. While lining up the menu shows a field for each spot
// with Create, Delete and Lock (actions p1create ... p3lock); three knobs at each spot move it a twentieth as far as the pinching hand.
// The line-up is kept against the persistent anchor (storage key `key`), so it comes back in the next session and after a put-on.
//
//   new LineUp(session, space, { keeper, store, key, say, life, aligner }); setKeeper(k) when an XR session starts
//   ACTIONS                        the ids of its buttons: add them to the session's `actions`
//   press(id)                      one of them was pressed on this page's menu -> true when it was one of ours
//   update(nowMs, dt, tips)        every frame; tips: hands.tips() of this page's own hands (floor plan)
//   given(frame)                   a frame from elsewhere (a PC rehearsal: ?frame=x,y,deg, or a shared space): lined up without spots
//   rows(), note()                 what the menu shows while lining up (menus.grid rows) and the line of text for the title
//   marks()                        what xr/players3d.js draws: this player's spots, knobs and ring, everybody's check marks
// The space's frame follows the line-up; session.setLined/setCheck tell everybody.
(function (M) {
  const ACTIONS = ['lineUp', 'p1create', 'p1delete', 'p1lock', 'p2create', 'p2delete', 'p2lock', 'p3create', 'p3delete', 'p3lock'];

  // three rows for menus.grid from Aligner.fields(): the spot's state, then Create / Delete / Lock (also for another player's menu)
  // what one spot's field says: armed (waiting for a fingertip), placed (how far up), or empty
  function stateText(f, k) {
    return f.armed ? (f.left ? `keep still: ${f.left} s` : 'rest a fingertip') : f.placed ? `placed${f.mm === null || f.mm === undefined ? '' : `, ${f.mm} mm up`}` : k < 2 ? 'empty' : 'no check mark';
  }
  function rowsFrom(fields, lined) {
    return (fields || []).map((f, k) => {
      const state = stateText(f, k);
      return [
        { label: k < 2 ? `Spot ${k + 1}` : 'Spot 3: check', value: state, span: 2, active: !!f.armed },
        { id: `p${k + 1}create`, label: f.armed ? 'Cancel' : f.placed ? 'Replace' : 'Create', active: !!f.armed, off: !!f.locked || (k === 2 && !lined) },
        { id: `p${k + 1}delete`, label: 'Delete', off: !f.placed || !!f.locked },
        { id: `p${k + 1}lock`, label: f.locked ? 'Unlock' : 'Lock', active: !!f.locked, off: !f.placed },
      ];
    });
  }

  class LineUp {
    constructor(session, space, opts = {}) {
      this.session = session; this.space = space;
      this.keeper = null; this.store = opts.store || null; this.key = opts.key || 'mumr.lineup';
      this.say = opts.say || (() => {}); this.life = opts.life || (() => {});
      this.aligner = new M.align.Aligner(opts.aligner || {});
      this.active = false; this.savedRev = -1; this.savedAt = -1e9; this.toldAt = -1e9; this.toldKey = null; this.checkKey = null;
      if (opts.keeper) this.setKeeper(opts.keeper);
    }
    // the anchor keeper of this XR session (a new one for every session; null outside mixed reality)
    setKeeper(K) {
      this.keeper = K || null;
      if (K) {
        K.on('reset', (F) => { const A = this.aligner; if (F && (A.frame || A.points[0] || A.points[1])) { A.rebase(F, M.align.IDENTITY); this.life('line-up carried along by the reset'); } });
        K.on('moved', (from, to) => { const A = this.aligner, saved = A.rev === this.savedRev; if (!A.frame && !A.points[0] && !A.points[1]) return; A.rebase(from, to); if (saved) this.savedRev = A.rev; });
        K.on('ready', (f) => this.restore(f, 'from the last visit'));
        K.on('found', (f) => this.restore(f, 'from the anchor found again', true));
        K.on('new', () => this._set(null));                 // (a new anchor: what was saved against the old one means nothing now)
      }
    }
    _get() { try { const v = this.store && this.store.getItem(this.key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    _set(v) { try { if (this.store) this.store.setItem(this.key, JSON.stringify(v)); } catch (e) { /* storage full or blocked: the line-up is not kept */ } }
    get frame() { return this.aligner.frame; }
    get lined() { return !!this.aligner.frame; }

    // a saved line-up back, as seen from the anchor's frame f. force: also over one that is there (the anchor was found again)
    restore(f, why, force = false) {
      const d = this._get(), A = this.aligner;
      if (!d || !f) return false;
      if (!force && (A.frame || A.points[0] || A.points[1])) return false;
      if (this.keeper && d.uuid !== this.keeper.uuid) { this.life('saved line-up is from another anchor: not used'); return false; }
      const was = A.points[0] ? A.points[0].slice() : null;
      if (!A.load(d, f)) { this.life('saved line-up could not be used'); return false; }
      this.savedRev = A.rev;
      const off = was && A.points[0] ? Math.hypot(A.points[0][0] - was[0], A.points[0][1] - was[1]) : null;
      this.life(`line-up put back ${why}${A.frame ? `: ${Math.round(A.frame.dist * 100)} cm apart` : ': one spot'}${off === null ? '' : `, spot 1 moved ${Math.round(off * 100)} cm`}`);
      if (!force) this.say(A.frame ? `Line-up restored (${Math.round(A.frame.dist * 100)} cm): check it on spot 3` : 'One spot restored from the last visit');
      else if (off !== null && off > 0.05) this.say('Line-up corrected from the anchor');
      this._tell(true);
      return true;
    }
    save() {
      const K = this.keeper, A = this.aligner;
      if (!K || !K.canSave) return false;
      this.savedRev = A.rev; this.savedAt = Date.now();
      if (!A.points[0] && !A.points[1]) { this._set(null); return true; }
      this._set(Object.assign({ uuid: K.uuid, at: new Date().toISOString() }, A.save(K.frame)));
      return true;
    }
    given(frame) { this.aligner.use(frame); this._tell(true); }
    // a new XR session has coordinates of its own: what was lined up means nothing in them (the keeper's 'ready' brings the saved one back)
    restart() { this.aligner.restart(); this.active = false; this.savedRev = this.aligner.rev; this._tell(true); }

    press(id) {
      const A = this.aligner;
      if (id === 'lineUp') {
        this.active = !this.active;
        if (this.active) { A.beginSession(); this.say(A.frame ? 'Line up: rest a fingertip on spot 1 to place the spots again, or use the fields' : `Line up: rest an index fingertip on spot 1 for ${A.cfg.dwell} s`); }
        else { A.endSession(); if (A.rev !== this.savedRev) this.save(); this.say(A.frame ? `Lined up on two spots ${Math.round(A.frame.dist * 100)} cm apart` : 'Not lined up: you play alone'); }
        return true;
      }
      const m = /^p([123])(create|delete|lock)$/.exec(id);
      if (!m) return false;
      if (!this.active) return true;
      const i = +m[1] - 1, n = i + 1, what = i === 2 ? 'The check mark' : `Spot ${n}`;
      if (m[2] === 'create') {
        const r = A.create(i);
        this.say(r === 'armed' ? (i === 2 ? 'Check mark: rest a fingertip on spot 3' : `Spot ${n}: rest a fingertip on the floor for ${A.cfg.dwell} s`)
          : r === 'cancelled' ? `${what}: not waiting for it any more` : r === 'locked' ? `${what} is locked: unlock it first` : 'Place spots 1 and 2 first');
      } else if (m[2] === 'delete') {
        const r = A.remove(i);
        this.say(r === 'deleted' ? (i === 2 ? 'Check mark deleted' : `Spot ${n} deleted: you are not lined up now`) : r === 'locked' ? `${what} is locked: unlock it first` : `${what} is not there`);
        if (r === 'deleted') this._tell(true);
      } else {
        const r = A.lock(i);
        this.say(r === 'locked' || r === 'unlocked' ? `${what} ${r}` : `${what} is not placed yet`);
      }
      return true;
    }

    update(nowMs, dt, tips) {
      const A = this.aligner;
      if (this.active) {
        const r = A.update(dt, tips);
        if (r === 'took1' || r === 'took2') {
          const n = r === 'took1' ? 1 : 2;
          this.say(A.frame ? `Spot ${n} placed: lined up, the spots are ${Math.round(A.frame.dist * 100)} cm apart` : `Spot ${n} placed. Now spot ${n === 1 ? 2 : 1}`);
          this._tell(true);
        } else if (r === 'tooClose') this.say('Too close to the other spot: they must be at least 15 cm apart');
        else if (r === 'check') this.say('Check mark placed: the others see whether it is on spot 3');
      }
      this.space.set(A.frame, this.space.floorY);
      this._tell(false, nowMs);
      this._check(nowMs);
      if (A.rev !== this.savedRev && Date.now() - this.savedAt > 1000) this.save();
    }
    // the line-up to everybody when it changed (at most twice a second, unless forced)
    _tell(force, nowMs = Date.now()) {
      const f = this.aligner.frame, key = f ? `${(f.dist || 0).toFixed(3)}|${f.how}` : '';
      if (key === this.toldKey && !force) return;
      if (!force && nowMs - this.toldAt < 500) return;
      this.toldAt = nowMs; this.toldKey = key;
      this.session.setLined(f ? { dist: f.dist || 0, how: f.how || 'points' } : null);
    }
    _check(nowMs) {
      const c = this.aligner.lastCheck, key = c ? c.map((v) => (+v).toFixed(4)).join(',') : '';
      if (key === this.checkKey || nowMs - (this._checkAt || -1e9) < 100) return;
      if (this.checkKey === null && !c) { this.checkKey = key; return; }
      this.checkKey = key; this._checkAt = nowMs;
      this.session.setCheck(c ? c.map((v) => +(+v).toFixed(4)) : null);
    }

    // ---- what is shown
    note() {
      const A = this.aligner;
      if (!this.active) return A.frame ? (A.frame.how === 'given' ? 'lined up (a given frame)' : `lined up, ${Math.round((A.frame.dist || 0) * 100)} cm`) : 'not lined up';
      const w = A.want(), left = Math.ceil(A.cfg.dwell * (1 - A.progress));
      return A.grabbed ? `spot ${A.grabbed.i + 1}, ${A.grabbed.axis}: ${(A.grabbed.pull * A.cfg.fine * 1000).toFixed(1)} mm` : A.progress > 0 ? `keep still: ${left} s`
        : w === 2 ? 'rest a fingertip on the check spot (spot 3)' : w !== null ? `rest a fingertip on spot ${w + 1} for ${A.cfg.dwell} s` : 'pull a knob to adjust, or press Create on a spot';
    }
    // three rows for menus.grid: the spot's state, then Create / Delete / Lock
    rows() { return rowsFrom(this.aligner.fields(), !!this.aligner.frame); }
    // what another player needs to draw this player's menu while it lines up (it goes in the menus' info)
    info() { return { lining: this.active, fields: this.active ? this.aligner.fields() : null, lined: !!this.aligner.frame, note: this.note() }; }
    marks() {
      const A = this.aligner, S = this.session, sp = this.space, f = A.frame, checks = [];
      const mine = S.me === null ? 0 : S.me, own = A.checkOwn();
      if (f && sp.ok) for (const [slot, c] of Object.entries(S.doc.checks)) { if (slot === 'me' || +slot === S.me) continue; const p = sp.fromCommon([c[0], c[1], c[2] || 0]); checks.push({ slot: +slot, x: p[0], y: p[1], z: p[2] }); }
      if (own) checks.push({ slot: mine, x: own[0], y: own[1], z: own[2] });
      // (the check marks too only while lining up, like spots 1 and 2: Marek, 2026-10-29, spot 3 stayed on the floor after the line-up)
      return { show: this.active, slot: mine, points: this.active ? A.points.concat([own]) : [null, null], knobs: this.active ? A.knobs() : [],
        held: A.held, progress: A.progress, at: A.at, checks: this.active ? checks : [] };
    }
  }

  M.lineup = { LineUp, ACTIONS, rowsFrom, stateText };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

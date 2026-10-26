// The shared DOCUMENT: everything that must be the same for everyone and must arrive (a setting, a mark, the room, who is lined up).
// No sockets (it is handed a link, see link.js), no THREE and no DOM.
//
// Every change is an EVENT: the server numbers the events and sends each to everyone, the sender too, so all apply them in one order.
// The server also keeps the newest event of each thing (see engine/server/hub.py: key, drop, clear, scope, own) and gives that to everyone who
// joins, so a newcomer has the world at once. Alone (no link, or the link is down) events apply at once: one player is a session of
// one, on the same code path.
//
// What is in the document is the app's: it registers KINDS of events. A kind says how the event changes the document (apply) and
// how the server is to keep it (keep: the key of the thing it is about, and whether it drops it, belongs to a player, is owned ...).
// Built in:
//   game     the game's settings (opts.game: name -> default), one set for everyone          { k:'game', name, value } / { k:'game', all }
//   player   each player's own settings (opts.player), by slot: what that player's menu shows { k:'player', slot, name, value } / { state }
//   frame    who is lined up and how far apart their two spots are (align.js)               { k:'frame', slot, line }
//   check    each player's check mark (the third spot), in the common frame                 { k:'check', slot, x, y, z }
//   do       a request to whoever holds a token (put the loco here, drop a ball)            { k:'do', token, what, args }
//   room     the room's scan in the common frame (room.js), kept by the server              { k:'room', data, by (slot), at (ms) }
//
// A button belongs to a menu, and a menu to its owner: press(owner, id) by anyone goes to the owner's page, which works out what it
// changes there (opts.press), or, for an action of that headset (opts.actions: leave, room setup ...), tells the app ('action').
//
// What the session says (session.on(name, fn)): join(me) leave(why) peer(slot, on) token(name, mine, slot) viewers(n) first() synced()
// game(name, value, prev, from) player(slot, name, value, from, prev) lined(slot, line) check(slot, ok) event(e, from) do(token, what,
// args, from) action(id, from) press(id, from, next) direct(m, from) ask(key, m, from) keyframe(token, data, from); and it asks
// 'keyframe?'(token) -> data when another player wants the full state of a body this page holds.
(function (M) {
  const U = () => M.util;
  const CLAIM_EVERY = 100;      // ms between two requests for the same token
  const STALE = 1000;           // ms without a sign of a player: it is shown as gone quiet
  const CLOCK_EVERY = 2000;     // ms between two reports of this page's offset to the server's clock

  const BUILTIN = {
    game: {
      keep: (e) => (e.all ? { key: 'game:*', clear: 'game:' } : { key: `game:${e.name}` }),
      apply(S, e, from) {
        const d = S.doc.game;
        const set = e.all && typeof e.all === 'object' ? e.all : { [e.name]: e.value };
        for (const [name, value] of Object.entries(set)) {
          if (!(name in S.opts.game)) continue;
          const prev = d[name];
          d[name] = value;
          if (from === S.me && S._pend.game.get(name) === value) S._pend.game.delete(name);      // (our own change is back)
          if (prev !== value) S.notify('game', name, value, prev, from);
        }
      },
    },
    player: {
      keep: (e) => (e.state ? { key: `player:${e.slot}:*`, clear: `player:${e.slot}:`, scope: 'slot' } : { key: `player:${e.slot}:${e.name}`, scope: 'slot' }),
      apply(S, e, from) {
        const mine = e.slot === S.me;
        if (!mine && !Number.isInteger(e.slot)) return;
        const st = mine ? S.mine : (S.doc.players[e.slot] = S.doc.players[e.slot] || {});
        if (e.state && typeof e.state === 'object') {
          if (!mine) for (const name of Object.keys(S.opts.player)) if (name in e.state) st[name] = e.state[name];
          S.notify('player', e.slot, null, null, from);
        } else if (e.name in S.opts.player) {
          const prev = st[e.name];
          st[e.name] = e.value;
          if (mine && S._pend.player.get(e.name) === e.value) S._pend.player.delete(e.name);
          S.notify('player', e.slot, e.name, e.value, from, prev);
        }
      },
    },
    frame: {
      keep: (e) => ({ key: `frame:${e.slot}`, scope: 'slot', drop: !e.line }),
      apply(S, e) {
        if (e.slot !== S.me) { if (!Number.isInteger(e.slot)) return; if (e.line) S.doc.lined[e.slot] = e.line; else delete S.doc.lined[e.slot]; }
        S.notify('lined', e.slot, e.line || null);
      },
    },
    check: {
      keep: (e) => ({ key: `check:${e.slot}`, scope: 'slot', drop: !(U().num(e.x) && U().num(e.y)) }),
      apply(S, e) {
        const ok = U().num(e.x) && U().num(e.y), k = Number.isInteger(e.slot) ? e.slot : 'me';
        if (ok) S.doc.checks[k] = [e.x, e.y, U().num(e.z) ? e.z : 0]; else delete S.doc.checks[k];
        S.notify('check', e.slot, ok);
      },
    },
    do: {
      apply(S, e, from) { if (typeof e.token === 'string' && S.holds(e.token)) S.notify('do', e.token, e.what, e.args, from); },
    },
    room: {
      keep: () => ({ key: 'room' }),
      apply(S, e, from) { if (!e.data || typeof e.data !== 'object') return; S.doc.room = { data: e.data, by: Number.isInteger(e.by) ? e.by : null, at: U().num(e.at) ? e.at : null }; S.notify('room', S.doc.room, from); },
    },
    // a real camera of the room (cams.js), owned by the page that aligned it: a webcam page (a viewer) or a player
    'cam+': {
      keep: (e) => ({ key: `cam:${e.id}`, own: true, gone: { k: 'cam-', id: e.id } }),
      apply(S, e, from) {
        const c = M.cams.clean(e);
        if (!c || (!S.doc.cameras[c.id] && Object.keys(S.doc.cameras).length >= M.cams.MAX)) return;
        S.doc.cameras[c.id] = Object.assign(c, { owner: from === undefined ? null : from });
        S.notify('cam', c.id, from);
      },
    },
    'cam-': {
      keep: (e) => ({ key: `cam:${e.id}`, drop: true, own: true }),
      apply(S, e, from) { if (typeof e.id === 'string' && S.doc.cameras[e.id]) { delete S.doc.cameras[e.id]; S.notify('cam', e.id, from); } },
    },
  };

  class Session {
    // link: from link.connect() (or a test's pretend link), or null (alone). opts: { game, player, actions, press, kinds, init, mine }
    //   game / player   name -> default value of each setting       actions   ids of buttons that are actions of the owner's headset
    //   press(id, state) -> the state after the button             kinds     { kind: { apply(session, e, from), keep(e) -> {...} } }
    //   init(doc)        put the app's own parts into an empty document (called again whenever the document is taken from the server)
    //   mine             this player's settings to start with (and the game's, while nobody else is there)
    constructor(link, opts = {}) {
      this.bus = new (U().Emitter)();
      this.opts = Object.assign({ game: {}, player: {}, actions: [], press: null, kinds: {}, init: null }, opts);
      this.kinds = Object.assign({}, BUILTIN);
      for (const [k, spec] of Object.entries(this.opts.kinds)) this.kind(k, spec);
      this.link = link;
      this.me = null; this.n = 0; this.role = 'player';
      this.viewers = 0;                    // how many watchers (PC world views) the server has
      this.tokens = {};                    // name -> slot (or null: nobody)
      this.peers = new Map();              // slot -> { name, seen (ms), stale }   (the others)
      this.clocks = new Map();             // slot -> that page's offset to the server's clock (ms)
      this.owners = new Map();             // key -> who owns it (an owned thing of the document: engine/server/hub.py `own`)
      const start = Object.assign({}, this.opts.game, this.opts.player, opts.mine || {});
      this.mine = {};
      for (const name of Object.keys(this.opts.player)) this.mine[name] = start[name];
      this.myLine = null;                  // { dist, how } once this player is lined up
      this.myCheck = null;
      this.doc = this._fresh();
      for (const name of Object.keys(this.opts.game)) this.doc.game[name] = start[name];
      this._claimed = {}; this._busy = {}; this._clockAt = -1e9;
      // Our own setting changes that the server has not sent back yet: what this page shows meanwhile (and what the next press starts
      // from: two quick presses of +1 must make 2). The server's order still decides: the echo replaces it.
      this._pend = { game: new Map(), player: new Map() };
      if (link) {
        link.onOpen = (hello) => this._hello(hello);
        link.onText = (m) => this._text(m);
        link.onClose = (why) => this._closed(why);
        if (link.open && link.hello) this._hello(link.hello);
      }
    }
    _fresh() {
      const d = { game: {}, players: {}, lined: {}, checks: {}, room: null, cameras: {} };
      if (this.opts.init) this.opts.init(d);
      return d;
    }
    // an app's kind of event: { apply(session, e, from), keep(e) -> { key, drop, clear, scope, own, gone } (optional) }
    kind(name, spec) {
      if (BUILTIN[name]) throw new Error(`session: ${name} is built in`);
      if (!spec || typeof spec.apply !== 'function') throw new Error(`session: kind ${name} needs apply`);
      this.kinds[name] = spec;
      return this;
    }
    // listeners: on(name, fn) (see the list at the top); notify(name, ...) tells them (an app's kinds use it too)
    on(name, fn) { this.bus.on(name, fn); return this; }
    off(name, fn) { this.bus.off(name, fn); return this; }
    notify(name, ...a) { this.bus.emit(name, ...a); }
    get connected() { return this.me !== null; }
    // the other players (the host is not one: it is in `peers`, marked host, so that lining up and sharing count it)
    get others() { let n = 0; for (const p of this.peers.values()) if (!p.host) n++; return n; }
    get hostHere() { for (const p of this.peers.values()) if (p.host) return true; return false; }
    get isHost() { return this.role === 'host'; }
    get isViewer() { return this.role === 'viewer'; }

    // ---- reading it
    // what a player's menu shows: the game's settings and that player's own
    stateOf(slot) {
      const me = slot === null || slot === undefined || slot === this.me, own = me ? this.mine : this.doc.players[slot] || {};
      const st = Object.assign({}, this.opts.game, this.opts.player, own, this.doc.game);
      for (const [k, v] of this._pend.game) st[k] = v;
      if (me) for (const [k, v] of this._pend.player) st[k] = v;
      return st;
    }
    // a game setting as this page has it now (its own change included while it is on its way)
    game(name) { return this._pend.game.has(name) ? this._pend.game.get(name) : this.doc.game[name]; }
    holds(token) { return this.me === null || this.tokens[token] === this.me; }
    holder(token) { return this.tokens[token] === undefined ? null : this.tokens[token]; }
    lined(slot) { return slot === this.me || slot === null || slot === undefined ? this.myLine : this.doc.lined[slot] || null; }
    ownerOf(key) { return this.owners.has(key) ? this.owners.get(key) : null; }
    // Is there anybody to share the world with? This player is lined up and so is another one.
    sharing() { return this.connected && !this.isViewer && !!this.myLine && Object.keys(this.doc.lined).some((k) => this.peers.has(+k)); }
    // Should this page send what it simulates and where it is? When sharing, and also when a watcher (a PC view) is there.
    sending() { return this.connected && !this.isViewer && !!this.myLine && (this.sharing() || this.viewers > 0); }

    // ---- changing it
    // e: { k, ... }. The kind's keep() adds what the server needs to keep it. Alone it applies at once.
    emit(e) {
      const kind = this.kinds[e.k];
      if (kind && kind.keep) Object.assign(e, kind.keep(e, this));
      if (this.connected) this.link.sendText({ t: 'ev', e });
      else this._apply(U().clone(e), this.me);
    }
    setGame(name, value) {
      if (this.game(name) === value) return;
      if (this.connected) this._pend.game.set(name, value);
      this.emit({ k: 'game', name, value });
    }
    setMine(name, value) {
      if ((this._pend.player.has(name) ? this._pend.player.get(name) : this.mine[name]) === value) return;
      if (this.connected) this._pend.player.set(name, value);
      this.emit({ k: 'player', slot: this.me, name, value });
    }
    setLined(line) {
      this.myLine = line ? { dist: +(+line.dist || 0).toFixed(3), how: String(line.how || 'points') } : null;
      if (this.connected) this.emit({ k: 'frame', slot: this.me, line: this.myLine });
    }
    // this player's check mark, in the common frame ([x, y, z] or null)
    setCheck(c) {
      this.myCheck = Array.isArray(c) && U().num(c[0]) && U().num(c[1]) ? [c[0], c[1], U().num(c[2]) ? c[2] : 0] : null;
      const e = this.myCheck ? { k: 'check', slot: this.me, x: this.myCheck[0], y: this.myCheck[1], z: this.myCheck[2] } : { k: 'check', slot: this.me };
      this.emit(e);
    }
    // A button on `owner`'s menu, pressed here.
    press(owner, id) {
      if (this.connected && owner !== null && owner !== undefined && owner !== this.me) { this.link.sendText({ t: 'to', to: owner, m: { k: 'press', id } }); return; }
      this._pressed(id, this.me);
    }
    _pressed(id, from) {
      if (typeof id !== 'string') return;
      if (this.opts.actions.includes(id)) { this.notify('action', id, from); return; }
      if (!this.opts.press) return;
      const cur = this.stateOf(this.me), next = this.opts.press(id, cur);
      if (!next) return;
      for (const name of Object.keys(this.opts.game)) if (next[name] !== cur[name]) this.setGame(name, next[name]);
      for (const name of Object.keys(this.opts.player)) if (next[name] !== cur[name]) this.setMine(name, next[name]);
      this.notify('press', id, from, next);
    }
    // a message for whoever owns `key` (engine/server/hub.py `ask`; the owner hears 'ask'): alone, or when it is ours, it is answered here
    request(key, m) {
      const owner = this.ownerOf(key);
      if (!this.connected || owner === this.me) { this.notify('ask', key, m, this.me); return true; }
      return !!this.link.sendText({ t: 'ask', key, m });
    }
    // A real camera of the room (cams.js) is asked to stand somewhere else (x, y on the floor, z above the common floor: the line-up knobs of a
    // headset), or to go back to where its own page worked it out. The page that owns the camera decides and announces it again (cam+).
    moveCamera(id, x, y, z) {
      const r4 = (v) => Math.round(v * 10000) / 10000;
      if (typeof id !== 'string' || ![x, y, z].every(Number.isFinite)) return false;
      return this.request(`cam:${id}`, { x: r4(x), y: r4(y), z: r4(z) });
    }
    resetCamera(id) { return typeof id === 'string' && this.request(`cam:${id}`, { reset: true }); }
    direct(slot, m) { return this.connected && this.peers.has(slot) && !!this.link.sendText({ t: 'to', to: slot, m }); }
    claim(token, nowMs) {
      if (!this.connected || this.isViewer || this.holds(token) || nowMs - (this._claimed[token] || -1e9) < CLAIM_EVERY) return false;
      this._claimed[token] = nowMs;
      return !!this.link.sendText({ t: 'claim', body: token });
    }
    setBusy(token, on) {
      on = !!on;
      if (!!this._busy[token] === on) return;
      this._busy[token] = on;
      if (this.connected && this.holds(token)) this.link.sendText({ t: 'busy', body: token, on });
    }
    release(token) { if (this.connected && this.holds(token)) this.link.sendText({ t: 'release', body: token }); }
    // a sign of life from a player (their presence came)
    seen(slot, nowMs) { const p = this.peers.get(slot); if (p) { p.seen = nowMs; p.stale = false; } }
    // a few times a second: who has gone quiet; and this page's offset to the server's clock goes out now and then
    tick(nowMs) {
      for (const p of this.peers.values()) p.stale = nowMs - p.seen > STALE;
      if (this.connected && this.link.clockOffset !== null && this.link.clockOffset !== undefined && nowMs - this._clockAt >= CLOCK_EVERY) {
        this._clockAt = nowMs;
        this.link.sendText({ t: 'clock', off: Math.round(this.link.clockOffset * 10) / 10 });
      }
    }

    // ---- the link
    _hello(h) {
      this.me = h.slot; this.n = h.n || 0; this.role = h.role || 'player'; this.viewers = h.viewers | 0;
      this.tokens = Object.assign({}, h.tokens);
      this.peers.clear();
      for (const p of h.peers || []) this.peers.set(p.slot, { name: p.name, seen: -1e9, stale: true, host: !!p.host });
      this.clocks.clear();
      for (const [k, v] of Object.entries(h.clocks || {})) if (U().num(v)) this.clocks.set(+k, v);
      this._busy = {};
      const doc = Array.isArray(h.doc) ? h.doc : [];
      if (this.isViewer || doc.length || this.peers.size) {
        // the server's world is the world: take it (the app's parts are made empty first, then the kept events are applied in order)
        const prevGame = this.doc.game;
        this.doc = this._fresh(); this.owners.clear();
        this.doc.game = Object.assign({}, prevGame);
        for (const d of doc) if (d && d.e) this._apply(d.e, d.from === undefined ? null : d.from);
        if (!this.isViewer) this._announce(false);
        this.notify('join', this.me);
        this.notify('synced');
      } else {
        // the first one here, and the server knows nothing: this page's world is the world
        this.owners.clear();
        this.doc.room = null;                // (except the room: a server without one takes this headset's scan, not an old copy: room.js)
        this._announce(true);
        this.notify('join', this.me);
        this.notify('first');
      }
      for (const [t, slot] of Object.entries(this.tokens)) this.notify('token', t, this.holds(t), slot);
      if (!this.isViewer) for (const [t, slot] of Object.entries(this.tokens)) if (slot !== null && slot !== this.me) this.direct(slot, { k: 'key?', token: t });
    }
    // tell everyone who I am: my settings, that I am lined up, my check mark (and, the first one here, the game's settings)
    _announce(withGame) {
      if (withGame) this.emit({ k: 'game', all: Object.assign({}, this.doc.game) });
      this.emit({ k: 'player', slot: this.me, state: Object.assign({}, this.mine) });
      if (this.myLine) this.emit({ k: 'frame', slot: this.me, line: this.myLine });
      if (this.myCheck) this.emit({ k: 'check', slot: this.me, x: this.myCheck[0], y: this.myCheck[1], z: this.myCheck[2] });
    }
    _closed(why) {
      const before = Object.keys(this.tokens).filter((t) => !this.holds(t)), gone = [...this.peers.keys()];
      this.me = null; this.viewers = 0;
      for (const [k, v] of this._pend.game) this.doc.game[k] = v;          // (what never came back is ours now: we are alone)
      for (const [k, v] of this._pend.player) this.mine[k] = v;
      this._pend.game.clear(); this._pend.player.clear();
      this.peers.clear(); this.clocks.clear(); this.doc.players = {}; this.doc.lined = {}; this.doc.checks = {};
      if (Object.keys(this.doc.cameras).length) { this.doc.cameras = {}; this.notify('cam', null, null); }      // (the pages that made them may be gone: they say so again when the link is back)
      for (const slot of gone) this.notify('peer', slot, false);
      for (const t of before) this.notify('token', t, true, null);      // alone again: it is all ours
      this.notify('leave', why);
    }
    _gonePlayer(slot) {
      this.peers.delete(slot); this.clocks.delete(slot);
      delete this.doc.players[slot]; delete this.doc.lined[slot]; delete this.doc.checks[slot];
    }
    _text(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ev') { if (m.n > this.n) { this.n = m.n; this._apply(m.e, m.from); } }
      else if (m.t === 'viewers') { this.viewers = m.n | 0; this.notify('viewers', this.viewers); }
      else if (m.t === 'peer') {
        if (m.on) this.peers.set(m.slot, { name: m.name, seen: -1e9, stale: true, host: !!m.host });
        else this._gonePlayer(m.slot);
        this.notify('peer', m.slot, !!m.on);
      } else if (m.t === 'token') {
        if (typeof m.body !== 'string') return;
        const was = this.holds(m.body);
        this.tokens[m.body] = m.slot === undefined ? null : m.slot;
        const now = this.holds(m.body);
        if (now) this._busy[m.body] = false;
        if (was !== now || !now) this.notify('token', m.body, now, this.tokens[m.body]);
      } else if (m.t === 'clock') { if (U().num(m.off)) this.clocks.set(m.slot, m.off); }
      else if (m.t === 'ask') this.notify('ask', m.key, m.m, m.from);
      else if (m.t === 'to' && m.m && typeof m.m === 'object') {
        const d = m.m;
        if (d.k === 'press') this._pressed(d.id, m.from);
        else if (d.k === 'key?') { const data = this.bus.ask('keyframe?', d.token); if (data !== undefined && this.holds(d.token)) this.direct(m.from, { k: 'key', token: d.token, data }); }
        else if (d.k === 'key') this.notify('keyframe', d.token, d.data, m.from);
        else this.notify('direct', d, m.from);
      }
    }
    // ---- one event, here as on every other page
    _apply(e, from) {
      if (!e || typeof e !== 'object' || typeof e.k !== 'string') return;
      if (typeof e.key === 'string') { if (e.own && !e.drop) this.owners.set(e.key, from); else if (e.drop) this.owners.delete(e.key); }
      const kind = this.kinds[e.k];
      if (kind) kind.apply(this, e, from);
      this.notify('event', e, from);
    }
  }

  M.session = { Session, BUILTIN, CLAIM_EVERY, STALE };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

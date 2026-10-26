// The whole shared world as a watcher sees it: a PC page (a world view, a webcam overlay, a recorder) uses this and nothing else to
// know what is where. No THREE and no DOM.
//
// It joins the server as a VIEWER (engine/server/hub.py): not a player, it cannot change the world, except for things it OWNS (a real camera
// that the page has aligned: announce/withdraw). It gets the document and the newest packet of every kind at once, then every event
// and every packet.
//   * the DOCUMENT is a Session (session.js) in the viewer's role, with the app's kinds: `feed.doc` has the same shape as a player's
//     `session.doc`, and what an event does is defined in one place only;
//   * what MOVES comes in the packets of wire.js. Every registered type is a stream, kept for KEEP ms per player, each sample with
//     the SERVER'S time (the sender's clock plus the sender's offset to the server), so a page can show the world as it was `d` ms
//     ago: sample(name, slot, serverNow() - d), blended with the type's own blend.
// Everything is in the common floor frame (align.js).
//
//   sample(name, slot, t)   the stream `name` of `slot` at server time t (ms; omitted: the newest); slot null: the holder of the stream's
//                           token, else whoever sent last
//   age(name, slot)         ms since the newest sample arrived
//   players()               [{ slot, name, lined, check, state }]
//   on(name, fn)            the session's (game, player, event, peer, token, lined, check, synced ...) plus 'ready', 'lost', 'packet'
(function (M) {
  const KEEP = 1500;                     // ms of history per stream

  class WorldFeed {
    // opts: { link (a link.js connection that joins as a viewer: see connect()), now (ms), session: the Session's options (the app's kinds) }
    constructor(opts = {}) {
      this.link = opts.link || null;
      this.now = opts.now || M.util.nowMs;
      this.ready = false;
      this.bufs = new Map();              // name -> slot -> [{ t, arrived, clock, data }]
      this.guard = new M.wire.Guard();
      this.counts = { packets: 0, ignored: 0, offClock: 0 };
      this.late = new Map();               // stream -> the last arrivals' lateness (ms)
      this.session = new M.session.Session(this.link, opts.session || {});
      this.doc = this.session.doc;
      const S = this.session;
      S.on('join', () => { this.doc = S.doc; this.bufs.clear(); this.guard = new M.wire.Guard(); this.ready = true; S.notify('ready'); });
      S.on('peer', (slot, on) => { if (!on) { for (const b of this.bufs.values()) b.delete(slot); this.guard.forget(slot); } });
      S.on('leave', () => { this.ready = false; S.notify('lost'); });
      if (this.link) this.link.onBin = (b) => this.receive(b);
    }
    static connect(url, opts = {}) {
      const link = M.link.connect(url, { build: opts.build, name: opts.name || 'viewer', join: { role: 'viewer' }, WebSocket: opts.WebSocket, now: opts.now });
      return new WorldFeed(Object.assign({}, opts, { link }));
    }
    on(name, fn) { this.session.on(name, fn); return this; }
    serverNow() { return this.link && this.link.serverNow ? this.link.serverNow() : null; }
    get clockQuality() { return this.link ? this.link.clockSpread : null; }
    // a thing this page owns (an event whose kind keeps it with own: true, see session.js), or its end
    announce(e) { if (!this.session.connected) return false; this.session.emit(e); return true; }
    // the one thing a webcam page says: its real camera (cams.js) is here, or has moved, or is gone. -> false when it was not sent
    announceCamera(c) { const e = M.cams.event(c); return !!e && this.announce(e); }
    withdrawCamera(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id) && this.announce({ k: 'cam-', id }); }

    // ---- what comes in
    receive(buf) {
      const p = M.wire.decode(buf), arrived = this.now();
      if (!p) { this.counts.ignored++; return null; }
      if (!this.guard.fresh(p.type, p.slot, p.clock)) { this.counts.ignored++; return null; }
      const off = this.session.clocks.get(p.slot), sn = this.serverNow();
      // the server's time of this sample: the sender's clock plus its offset; until that is known, or when it disagrees with when the packet
      // came by more than half a second (a wrong offset would show the world up to KEEP late), when it came
      let t = off !== undefined ? p.clock + off : sn !== null ? sn : arrived;
      if (off !== undefined && sn !== null && Math.abs(t - sn) > 500) { t = sn; this.counts.offClock++; }
      // how late it came by its own time stamp (the network plus any error in the sender's clock estimate): kept per stream, for status()
      if (off !== undefined && sn !== null) { const L = this.late.get(p.name) || []; L.push(sn - (p.clock + off)); if (L.length > 60) L.shift(); this.late.set(p.name, L); }
      let byName = this.bufs.get(p.name);
      if (!byName) this.bufs.set(p.name, byName = new Map());
      let buf2 = byName.get(p.slot);
      if (!buf2) byName.set(p.slot, buf2 = []);
      const last = buf2[buf2.length - 1];
      buf2.push({ t: last && t < last.t ? last.t : t, arrived, clock: p.clock, data: p.data });
      while (buf2.length > 2 && buf2[buf2.length - 1].t - buf2[0].t > KEEP) buf2.shift();
      this.counts.packets++;
      this.session.notify('packet', p);
      return p;
    }

    // ---- what is there
    _slotFor(name, slot) {
      if (slot !== null && slot !== undefined) return slot;
      const byName = this.bufs.get(name);
      if (!byName) return null;
      const s = M.wire.spec(name), holder = s && s.token ? this.session.holder(s.token) : null;
      if (holder !== null && byName.has(holder)) return holder;
      let best = null, bt = -Infinity;
      for (const [k, b] of byName) if (b.length && b[b.length - 1].t > bt) { bt = b[b.length - 1].t; best = k; }
      return best;
    }
    sample(name, slot, t) {
      slot = this._slotFor(name, slot);
      const buf = slot === null ? null : (this.bufs.get(name) || new Map()).get(slot);
      if (!buf || !buf.length) return null;
      const s = M.wire.spec(name), a = buf[buf.length - 1];
      if (t === undefined || t === null || t >= a.t) return { slot, t: a.t, data: a.data };
      if (t <= buf[0].t) return { slot, t: buf[0].t, data: buf[0].data };
      let i = buf.length - 1;
      while (i > 0 && buf[i - 1].t > t) i--;
      const x = buf[i - 1], y = buf[i], f = (t - x.t) / Math.max(1e-6, y.t - x.t);
      return { slot, t, data: s && s.blend ? s.blend(x.data, y.data, f) : x.data };
    }
    age(name, slot) {
      slot = this._slotFor(name, slot);
      const buf = slot === null ? null : (this.bufs.get(name) || new Map()).get(slot);
      return buf && buf.length ? this.now() - buf[buf.length - 1].arrived : null;
    }
    players() {
      const S = this.session, out = [];
      for (const [slot, p] of [...S.peers].sort((a, b) => a[0] - b[0])) {
        if (p.host) continue;                       // (the host is not a player)
        out.push({ slot, name: p.name, lined: S.doc.lined[slot] || null, check: S.doc.checks[slot] || null, state: S.stateOf(slot) });
      }
      return out;
    }
    status() {
      const ages = {};
      for (const [name, byName] of this.bufs) ages[name] = [...byName.keys()].map((s) => [s, Math.round(this.age(name, s))]);
      const late = {};
      for (const [name, L] of this.late) { const q = L.slice().sort((x, y) => x - y); late[name] = q.length ? Math.round(q[Math.floor(q.length / 2)]) : null; }
      return { ready: this.ready, players: this.session.peers.size, events: this.session.n, packets: this.counts.packets, ignored: this.counts.ignored, offClock: this.counts.offClock, clockSpreadMs: this.clockQuality, ages, late };
    }
  }

  M.worldfeed = { WorldFeed, KEEP };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

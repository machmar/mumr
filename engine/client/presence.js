// PRESENCE: where each player is (the head) and what their hands and feet are doing, 45 times a second, in the common frame. Only its
// owner writes it; nobody holds a token for it. The other players' hands count in every simulation (a push from another player is
// applied in the frame it happens), so this also gives the page everybody's hands in its own coordinates. No THREE and no DOM.
//
// Coordinates on this page are the floor plan (align.js Space): head [x, y, heading, height above this headset's floor, pitch];
// a source (a hand, a foot, a controller) { id, points: [{ name, x, y, z }], joints: [[x, y, z] x 25] (optional), pinch, grip, ... }.
(function (M) {
  const SEND_EVERY = 22;        // ms: 45 a second
  const FRESH = 500;            // ms: another player's hands older than this are not used
  // A hand's speed is worked out from its own headset's clock (the packet's), not from when packets arrive here: a late or a dropped packet
  // then does not make a hand look still and then fast (Marek's run, 2026-10-26: about 1 hand packet in 10 was dropped on the way to the
  // host, a slow push stalled and a quick hit launched). The speed is smoothed over TAU; between packets hands() carries a hand on along
  // it, for at most PREDICT.
  const TAU = 0.04, PREDICT = 0.05, GAP = 0.25;      // s, s, s (a gap longer than GAP starts the speed again from still)
  // smoothed speed of a point: prev { p, v }, now p, dt (s) -> v
  const speedOf = (prev, p, dt) => {
    if (!prev || !(dt > 0) || dt > GAP) return [0, 0, 0];
    const k = 1 - Math.exp(-dt / TAU), v = prev.v || [0, 0, 0];
    return [0, 1, 2].map((i) => { const raw = (p[i] - prev.p[i]) / dt; return Number.isFinite(raw) ? v[i] + (raw - v[i]) * k : v[i]; });
  };

  class Presence {
    // session: a Session; space: this page's align.Space; opts: { every (ms), fresh (ms) }
    constructor(session, space, opts = {}) {
      this.session = session; this.space = space;
      this.every = opts.every || SEND_EVERY; this.fresh = opts.fresh || FRESH;
      this.guard = new M.wire.Guard();
      this.players = new Map();          // slot -> { at (ms, ours), clock (ms, theirs), head, sources } in our coordinates
      this._sentAt = -1e9;
      this.stats = { sent: 0, got: 0, old: 0 };
      this.net = new Map();              // slot -> { n, gap (ms, their clock), ages: [ms] } since the last report()
      session.on('peer', (slot, on) => { if (!on) { this.players.delete(slot); this.guard.forget(slot); } });
      session.on('leave', () => { this.players.clear(); });
    }
    // Every frame: this page's head and hands go out when there is somebody to see them. Says whether a packet went.
    send(nowMs, head, sources) {
      const S = this.session, sp = this.space;
      if (!S.sending() || !sp.ok || nowMs - this._sentAt < this.every) return false;
      this._sentAt = nowMs;
      const h = head || [0, 0, 0, 0, 0], c = sp.toCommon([h[0], h[1], h[3]]);
      const out = (sources || []).map((s) => Object.assign({}, s, {
        points: (s.points || []).map((p) => { const q = sp.toCommon([p.x, p.y, p.z]); return { name: p.name, x: q[0], y: q[1], z: q[2] }; }),
        joints: s.joints ? s.joints.map((j) => sp.toCommon(j)) : undefined,
        yaw: Number.isFinite(s.yaw) ? sp.yawToCommon(s.yaw) : undefined,
      }));
      const ok = S.link.sendBin(M.wire.encode('presence', { head: [c[0], c[1], sp.yawToCommon(h[2]), c[2], h[4] || 0], sources: out }, nowMs));
      if (ok) this.stats.sent++;
      return !!ok;
    }
    // A presence packet came (wire.decode's result). Taken in our own coordinates; it is also the sign that the player is alive.
    receive(p, nowMs) {
      if (!p || p.name !== 'presence') return false;
      if (!this.guard.fresh(p.type, p.slot, p.clock)) { this.stats.old++; return false; }
      this.session.seen(p.slot, nowMs);
      const sp = this.space;
      if (!sp.ok) return false;
      const h = p.data.head, c = sp.fromCommon([h[0], h[1], h[3]]);
      const sources = p.data.sources.map((s) => Object.assign({}, s, {
        points: s.points.map((q) => { const o = sp.fromCommon([q.x, q.y, q.z]); return { name: q.name, x: o[0], y: o[1], z: o[2] }; }),
        joints: s.joints ? s.joints.map((j) => sp.fromCommon(j)) : undefined,
        yaw: Number.isFinite(s.yaw) ? sp.yawFromCommon(s.yaw) : undefined,
      }));
      // each point's and joint's speed (their clock), smoothed: s.points[i].v, s.jv[i]
      const was = this.players.get(p.slot), dt = was ? (p.clock - was.clock) / 1000 : 0;
      for (const src of sources) {
        const old = was && was.sources.find((q) => q.id === src.id);
        src.points.forEach((q, i) => { const o = old && old.points[i] && old.points[i].name === q.name ? old.points[i] : null; q.v = speedOf(o && { p: [o.x, o.y, o.z], v: o.v }, [q.x, q.y, q.z], dt); });
        if (src.joints) src.jv = src.joints.map((j, i) => speedOf(old && old.joints && old.joints[i] ? { p: old.joints[i], v: old.jv && old.jv[i] } : null, j, dt));
      }
      this.players.set(p.slot, { at: nowMs, clock: p.clock, head: [c[0], c[1], sp.yawFromCommon(h[2]), c[2], h[4]], sources });
      this.stats.got++;
      // for the log: how many came, the longest gap between them (their clock), and how old each was on arrival (both clocks set to the
      // server's: ours by the link's pings, theirs as the server passes it on, session.clocks)
      const st = this.net.get(p.slot) || { n: 0, gap: 0, ages: [] };
      st.n++; if (was && dt > 0) st.gap = Math.max(st.gap, dt * 1000);
      const mine = this.session.link && this.session.link.clockOffset, theirs = this.session.clocks.get(p.slot);
      if (Number.isFinite(mine) && Number.isFinite(theirs)) st.ages.push(nowMs + mine - (p.clock + theirs));
      this.net.set(p.slot, st);
      return true;
    }
    // the other players that are lined up and heard from lately: [{ slot, time (s, their clock), head, sources }]
    others(nowMs) {
      const S = this.session, out = [];
      for (const [slot, p] of this.players) if (nowMs - p.at <= this.fresh && S.lined(slot)) out.push({ slot, time: p.clock / 1000, head: p.head, sources: p.sources });
      return out;
    }
    // this page's hands and everybody else's, as one list for a simulation (ids made unique: 'p1-left'). The others' hands are carried on
    // along their speed for the time since their packet came (at most PREDICT), and keep it (points[i].v, jv) for the physics.
    hands(own, nowMs) {
      const all = (own || []).slice();
      for (const o of this.others(nowMs)) {
        const k = Math.min(PREDICT, Math.max(0, (nowMs - this.players.get(o.slot).at) / 1000)), on = (p, v) => (v ? [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k] : p);
        for (const s of o.sources) {
          const out = Object.assign({}, s, { id: `p${o.slot}-${s.id}`, slot: o.slot, time: o.time });
          out.points = s.points.map((q) => { const c = on([q.x, q.y, q.z], q.v); return Object.assign({}, q, { x: c[0], y: c[1], z: c[2] }); });
          if (s.joints) out.joints = s.joints.map((j, i) => on(j, s.jv && s.jv[i]));
          all.push(out);
        }
      }
      return all;
    }
    // what came since the last call, per player: [{ slot, perSec, gap (ms), age: { mean, max } (ms) or null }]; then it starts again
    report(nowMs) {
      const secs = this._repAt === undefined ? null : (nowMs - this._repAt) / 1000, out = [];
      this._repAt = nowMs;
      for (const [slot, st] of this.net) {
        const a = st.ages;
        out.push({ slot, perSec: secs ? st.n / secs : null, gap: Math.round(st.gap), age: a.length ? { mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length), max: Math.round(Math.max(...a)) } : null });
      }
      this.net.clear();
      return out;
    }
  }

  // The log's line on the network, every few seconds (xr/app.js and host.js): the round trip to the server, then for each other player
  // how many hand packets a second came, the longest gap between two (their clock) and how old they were on arrival (mean / most), then
  // the same for each body this page takes in. who(slot) names a slot; bodies: [{ token, r: Body.report() }].
  //   net: round trip 12 ms; hands from player 2: 44/s, gap 61 ms, age 18/54 ms; pile from host: 45/s, age 9/30 ms
  function netLine(rtt, hands, bodies, who) {
    const rate = (r) => (r.perSec === null ? '?' : Math.round(r.perSec)) + '/s', age = (a) => (a ? `age ${a.mean}/${a.max} ms` : 'age unknown');
    const parts = [`round trip ${rtt === null || rtt === undefined ? '-' : rtt} ms`];
    for (const h of hands) parts.push(`hands from ${who(h.slot)}: ${rate(h)}, gap ${h.gap} ms, ${age(h.age)}`);
    for (const b of bodies) if (b.r.perSec) parts.push(`${b.token} from ${b.from}: ${rate(b.r)}, ${age(b.r.age)}`);
    return `net: ${parts.join('; ')}`;
  }

  M.presence = { Presence, SEND_EVERY, FRESH, TAU, PREDICT, netLine };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

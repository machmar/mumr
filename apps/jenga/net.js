// What moves, on the wire: the 54 blocks and the die in ONE packet (type 23, the token 'jenga' held by the host), and the page's side of it.
// No THREE and no DOM. The packet always carries every body (a tower at rest is a 1.2 KB packet four times a second, a falling one 45 times a
// second), so a watcher (a PC view: engine worldfeed.js) can interpolate any two of them with `blend`.
//   u8 mode  u8 progress  u8 n  u8 0       then n x ( u8 body  u8 flags  3 x f32 position (m, common frame)  4 x i16 orientation (x 32767) )
//   mode: 0 live, 1 frozen (the moment the tower fell), 2 rewinding, 3 slow motion, 4 live again after the replay
//   progress: 0..255 through the part of the replay that is under way
//   flags: 1 a hand holds it, 2 the pulled block, 4 the block that toppled the tower, 8 it is asleep
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  const TYPE = 23, TOKEN = 'jenga', BODIES = S.BLOCKS + 1, ENTRY = 22;
  const F = { held: 1, handled: 2, culprit: 4, asleep: 8 };
  const MODE = { live: 0, frozen: 1, rewind: 2, slow: 3, after: 4 };

  function pack(o) {
    const items = o.items || [], b = new Uint8Array(4 + items.length * ENTRY), d = new DataView(b.buffer);
    b[0] = o.mode | 0; b[1] = Math.max(0, Math.min(255, Math.round((o.progress || 0) * 255))); b[2] = items.length;
    items.forEach((it, k) => {
      const at = 4 + k * ENTRY, q = it.q, l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      d.setUint8(at, it.i); d.setUint8(at + 1, it.flags | 0);
      for (let j = 0; j < 3; j++) d.setFloat32(at + 2 + j * 4, it.p[j], true);
      for (let j = 0; j < 4; j++) d.setInt16(at + 14 + j * 2, Math.round((q[j] / l) * 32767), true);
    });
    return b;
  }
  function unpack(d) {
    if (d.byteLength < 4) return null;
    const n = d.getUint8(2);
    if (n > BODIES || d.byteLength !== 4 + n * ENTRY) return null;
    const items = [], seen = new Set();
    for (let k = 0; k < n; k++) {
      const at = 4 + k * ENTRY, i = d.getUint8(at);
      if (i >= BODIES || seen.has(i)) return null;
      seen.add(i);
      const p = [0, 1, 2].map((j) => d.getFloat32(at + 2 + j * 4, true)), q = [0, 1, 2, 3].map((j) => d.getInt16(at + 14 + j * 2, true) / 32767);
      if (!p.every(Number.isFinite)) return null;
      items.push({ i, flags: d.getUint8(at + 1), p, q });
    }
    return { mode: d.getUint8(0), progress: d.getUint8(1) / 255, items };
  }
  // two samples of the same bodies, f of the way from a to b (a watcher shows the world a little in the past, between two packets)
  function blend(a, b, f) {
    if (!a || !b || a.items.length !== b.items.length) return b || a;
    return { mode: b.mode, progress: a.progress + (b.progress - a.progress) * f, items: b.items.map((y, k) => {
      const x = a.items[k];
      if (x.i !== y.i) return y;
      return { i: y.i, flags: y.flags, p: x.p.map((v, j) => v + (y.p[j] - v) * f), q: Q.slerp(x.q, y.q, f) };
    }) };
  }
  function register() { return M.wire.register({ type: TYPE, name: 'jenga', token: TOKEN, pack, unpack, blend }); }
  if (!M.wire.spec(TYPE)) register();

  // The page's side: the host's states with the time they were taken (its clock turned into ours: the smallest arrival-minus-clock of the
  // last 2 to 4 s, the packet that came quickest), and `at(nowMs)` the bodies as they were `delay` ms ago, between the two around then.
  class Stream {
    constructor(delay = 60) { this.delay = delay; this.buf = []; this.clk = { cur: null, prev: null, at: 0 }; this.count = 0; }
    hostTime(clock, nowMs) {
      const c = this.clk, d = nowMs - clock;
      if (nowMs - c.at > 2000) { c.prev = c.cur; c.cur = null; c.at = nowMs; }
      if (c.cur === null || d < c.cur) c.cur = d;
      return clock + Math.min(c.cur, c.prev === null ? Infinity : c.prev);
    }
    // data: unpack's result; info: body.js apply's { clock, now, first }
    feed(data, info) {
      if (info.first) this.buf = [];
      const t = this.hostTime(info.clock, info.now);
      if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return false;
      this.buf.push({ t, data });
      if (this.buf.length > 14) this.buf.shift();
      this.count++;
      return true;
    }
    get empty() { return !this.buf.length; }
    newest() { return this.buf.length ? this.buf[this.buf.length - 1].data : null; }
    at(nowMs) {
      const T = nowMs - this.delay, b = this.buf;
      if (!b.length) return null;
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t >= T) i--;
      const x = b[Math.max(0, i - 1)], y = b[i];
      if (T >= y.t || x === y || T <= x.t) return T >= y.t ? y.data : x.data;
      return blend(x.data, y.data, (T - x.t) / (y.t - x.t));
    }
  }

  // The bodies of a tower as the packet's items (the flags say who holds what and which block is the pulled one)
  function snapshot(tower, extra = {}) {
    const bodies = tower.all(), out = [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      out.push({ i, flags: (tower.heldBy(i) !== null ? F.held : 0) | (tower.handled === i ? F.handled : 0) | (extra.culprit === i ? F.culprit : 0) | (b.asleep ? F.asleep : 0), p: b.p, q: b.q });
    }
    return out;
  }

  Object.assign(J, { TYPE, TOKEN, BODIES, F, MODE, pack, unpack, blend, register, Stream, snapshot });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));

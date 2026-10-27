// Jenga's own logic, with no THREE and no DOM (the headset page, the host on the PC and the Node tests all use it):
//   * Tower: 54 wooden blocks (18 levels of 3, each level across the one below) on the engine's physics, twice the real size (3 x 5 x 15 cm:
//     a tracked hand can push one and pinch it). Fingers push, a pinch takes a block and carries it (it turns with the hand) and lets it go
//     where it opens. The room's tables and walls work (room.js): a new tower stands on the table in front of whoever asked for it.
//   * The game: whose turn it is, how many blocks were moved to the top, and when the tower fell (and whose hand touched it last). The page
//     that simulates the tower writes it into the document ('jenga'); every page reads it there.
//   * The packet (23) and the Body adapter: rule 1, one tower for everybody under one token ('tower'). The tower needs fine physics (240
//     steps a second, 12 solver rounds: coarser, a tall stack creeps and falls by itself), which a Quest cannot do for 54 blocks in a frame,
//     so the HOST on the PC simulates it whenever it is there, with everybody's hands; the headsets only draw what it sends. With no host,
//     the page whose hand is on the tower simulates it (as the lab's pile).
(function (J) {
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  const SCALE = 2, T = 0.015 * SCALE, W = 0.025 * SCALE, L = 0.075 * SCALE, LEVELS = 18, N = 3 * LEVELS, GAP = 0.0005;
  // measured in Node (2026-10-26): at 1/240 s and 12 rounds a block pushed out of the tower leaves the others within 1 cm and pulling out the
  // second block of a level brings it down; at 1/72 or 1/144 s the tower creeps by itself and falls when a block is pushed. Blocks wake when a
  // block near them moves at all (wakeV: one pulled out slowly must wake the ones that rest on it).
  const PHYSICS = { substep: 1 / 240, maxMove: 0.01, rounds: 12, wakeV: 0.01, wakeW: 0.1 };
  const SLEEP = { v: 0.01, w: 0.1, after: 0.3 };
  const BLOCK = { density: 600, friction: { s: 0.5, k: 0.4 }, restitution: 0.1 };          // (wood)
  const CFG = { touch: 0.012, grab: 0.025, spring: 20, holdSpeed: 5, breakAway: 0.12, closeNear: 0.04, reach: 0.08, busy: 0.02, handMax: 4, lastTouch: 6 };
  const TOKEN = 'tower', PACKET = { type: 23, name: 'jenga', token: TOKEN };
  const HEAD = 5, PER = 16;              // the packet: [n, base x, y, z, yaw], then per block [index, p (3), q (4), v (3), w (3), asleep, held by (slot + 1, 0: nobody)]
  const ROTATE = 6;                      // blocks at rest sent along with the moving ones in each packet (all of them come round in 9 packets)

  M.wire.register(Object.assign({}, PACKET, {
    pack: (s) => { const b = new Uint8Array(s.length * 4), d = new DataView(b.buffer); s.forEach((v, i) => d.setFloat32(i * 4, +v || 0, true)); return b; },
    unpack: (d) => {
      if (d.byteLength < HEAD * 4 || d.byteLength % 4) return null;
      const n = d.getFloat32(0, true);
      if (!Number.isInteger(n) || n < 0 || n > N || d.byteLength !== (HEAD + n * PER) * 4) return null;
      const s = []; for (let i = 0; i < HEAD + n * PER; i++) s.push(d.getFloat32(i * 4, true));
      return s.every(Number.isFinite) ? s : null;
    },
  }));

  const pt = (s, name) => (s.points || []).find((p) => p.name === name);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  class Tower {
    constructor() {
      this.pw = new M.physics.World(PHYSICS);
      this.grips = new M.grab.Grips();
      this.prev = new Map();               // source id -> [x, y, z, t]: the pinch's speed
      this.free = new Map();               // source id -> time (s) until which its hand pushes nothing: it has just let go
      this.cfg = Object.assign({}, CFG);
      this.room = null;                    // room.js local() (the common frame), or null: the floor only
      this.me = null;                      // this page's slot: the slot of its own hands (the others' carry theirs)
      this.touch = null;                   // { slot, t }: the last hand on a block
      this.sent = 0;                       // (which blocks at rest go in the next packet)
      this.build({ x: 0.6, y: 0, yaw: 0 });
    }
    // A new tower at base { x, y, yaw } (common frame), on what is under it (a table, else the floor; z: given)
    build(base) {
      for (const b of this.pw.bodies.slice()) this.pw.remove(b);
      this.pw._warm = null;
      const z = Number.isFinite(base.z) ? base.z : M.room.support(this.room, base.x, base.y, 1.3);
      this.base = { x: +base.x || 0, y: +base.y || 0, z, yaw: +base.yaw || 0 };
      const c = Math.cos(this.base.yaw), s = Math.sin(this.base.yaw), q0 = Q.fromAxisAngle([0, 0, 1], this.base.yaw), q1 = Q.mul(q0, Q.fromAxisAngle([0, 0, 1], Math.PI / 2));
      this.blocks = [];
      for (let l = 0; l < LEVELS; l++) for (let k = 0; k < 3; k++) {
        const off = (k - 1) * (W + GAP), dx = l % 2 ? off : 0, dy = l % 2 ? 0 : off;
        const body = M.physics.makeBox(Object.assign({ size: [L, W, T], p: [this.base.x + c * dx - s * dy, this.base.y + s * dx + c * dy, z + T / 2 + l * T], q: l % 2 ? q1 : q0, sleep: SLEEP }, BLOCK));
        body.asleep = true;                // (built at rest: it wakes when something touches it)
        this.pw.add(body);
        this.blocks.push({ i: this.blocks.length, body, held: null, holder: null, by: null, rest: l, d: null, at: 0 });
      }
      this.prev.clear(); this.free.clear();
      this.peak = this.top(); this.fell = null; this.touch = null; this.stillSince = null;
    }
    level(z) { return Math.round((z - this.base.z - T / 2) / T); }
    // the highest block that no hand holds (its centre)
    top() { let h = -Infinity; for (const b of this.blocks) if (!b.held && b.holder === null) h = Math.max(h, b.body.p[2]); return h; }
    moving() { return this.blocks.some((b) => b.held || b.holder !== null || !b.body.asleep); }
    // how far a point is from a block's surface (0 inside)
    dist(b, x, y, z) {
      const y0 = b.body, l = Q.rotate(Q.conj(y0.q), [x - y0.p[0], y - y0.p[1], z - y0.p[2]]);
      return Math.hypot(Math.max(0, Math.abs(l[0]) - L / 2), Math.max(0, Math.abs(l[1]) - W / 2), Math.max(0, Math.abs(l[2]) - T / 2));
    }
    // the nearest block to any point of these hands, within lim: { b, d } or null (a hand far from every block is not looked at block by block)
    nearest(sources, lim = Infinity) {
      let best = null;
      for (const s of sources || []) {
        const pts = (s.points || []).map((p) => [p.x, p.y, p.z]).concat(s.joints || []);
        for (const p of pts) {
          if (!p.every(Number.isFinite)) continue;
          for (const b of this.blocks) {
            const bp = b.body.p;
            if (Math.abs(p[0] - bp[0]) > L / 2 + lim || Math.abs(p[1] - bp[1]) > L / 2 + lim || Math.abs(p[2] - bp[2]) > L / 2 + lim) continue;
            const d = this.dist(b, p[0], p[1], p[2]);
            if (d <= lim && (!best || d < best.d)) best = { b, d, s };
          }
        }
      }
      return best;
    }
    near(sources, lim) { return !!this.nearest(sources, lim); }
    _vel(key, p, t) {
      const q = this.prev.get(key), v = q && t > q[3] ? [(p[0] - q[0]) / (t - q[3]), (p[1] - q[1]) / (t - q[3]), (p[2] - q[2]) / (t - q[3])] : [0, 0, 0];
      this.prev.set(key, [p[0], p[1], p[2], t]);
      const s = Math.hypot(...v), max = this.cfg.handMax;
      return s > max ? v.map((c) => (c * max) / s) : v;
    }
    // a hand that is closing on a block (about to pinch it) pushes nothing: the thumb and the index coming together near a block
    _closing(s) {
      const th = pt(s, 'thumb'), ix = pt(s, 'index');
      return !!th && !!ix && Math.hypot(th.x - ix.x, th.y - ix.y, th.z - ix.z) < 0.05 && this.grips.of(s.id).gesture !== 'point' && this.near([s], this.cfg.closeNear);
    }
    slotOf(s) { return s && s.slot !== undefined ? s.slot : this.me; }
    // one frame of dt seconds at time t (s) with every hand there is (common frame). Only the page (or host) that simulates the tower calls it.
    step(dt, t, sources) {
      const C = this.cfg, B = this.blocks, pw = this.pw, src = (sources || []).filter((s) => !s.foot), grips = this.grips.update(src), noHold = new Set(src.filter((s) => s.noHold).map((s) => s.id));
      const byId = new Map(src.map((s) => [s.id, s]));
      if (pw.room !== this.room) pw.setRoom(this.room);
      // a pinch starting within C.grab of a block takes it; it lasts while the pinch does, at the angle the hand had
      for (const b of B) if (b.held && !grips.some((g) => g.id === b.held.by && g.kind === 'pinch')) { this.free.set(b.held.by, t + 0.3); b.held = null; }
      for (const g of grips) {
        if (!g.start || !g.at || g.kind !== 'pinch' || noHold.has(g.id) || B.some((b) => b.held && b.held.by === g.id)) continue;
        let best = null, bd = Infinity;
        for (const b of B) { const d = this.dist(b, g.at[0], g.at[1], g.at[2]); if (!b.held && d <= C.grab && d < bd) { best = b; bd = d; } }
        if (best) {
          const s = byId.get(g.id), hq = M.physics.handQuat(s), off = sub(best.body.p, g.at);
          best.held = { by: g.id, off, hold: hq ? { loff: Q.rotate(Q.conj(hq), off), qoff: Q.mul(Q.conj(hq), best.body.q) } : null, fix: best.body.q.slice() };
          best.by = this.slotOf(s); pw.wake(best.body);
        }
      }
      // what is held follows the pinch as a motor (contacts still stop it: a block pulled out drags what rests on it); let go, it keeps its speed
      const holding = new Set();
      for (const b of B) {
        if (!b.held) { if (b.body.held) pw.release(b.body); continue; }
        const g = grips.find((q) => q.id === b.held.by), H = b.held, hq = H.hold ? M.physics.handQuat(byId.get(g.id)) : null;
        const o = hq ? Q.rotate(hq, H.hold.loff) : H.off;
        const target = { p: [g.at[0] + o[0], g.at[1] + o[1], g.at[2] + o[2]], q: hq ? Q.mul(hq, H.hold.qoff) : H.fix, v: this._vel(`${g.id}:hold`, g.at, t) };
        holding.add(H.by);
        if (pw.hold(b.body, target, { spring: C.spring, speed: C.holdSpeed, breakAway: C.breakAway }) === 'released') { this.free.set(H.by, t + 0.3); b.held = null; }
      }
      // the hands: every point and joint is a small sphere that pushes; not a hand that holds a block, has just let go, or is closing on one
      const hands = [];
      for (const s of src) {
        const quiet = holding.has(s.id) || (this.free.get(s.id) || 0) > t || this._closing(s);
        hands.push({ id: s.id, spheres: quiet ? [] : M.physics.handSpheres(s, C.touch), plate: null });
      }
      pw.setHands(hands, t);
      pw.step(dt);
      for (const b of B) b.holder = b.held ? this.slotOf(byId.get(b.held.by)) : null;
    }
    // Every page, every frame (cheap): who touched it last, and the game: a block moved up to the top, the tower fallen. -> an event for the
    // document when something happened ({ what: 'move', by } or { what: 'fell', by }), else null. t: s; sources: everybody's hands (common).
    judge(t, sources) {
      const hit = this.nearest((sources || []).filter((s) => !s.foot), 0.02);
      if (hit) this.touch = { slot: this.slotOf(hit.s), t };
      for (const b of this.blocks) if (b.holder !== null) this.touch = { slot: b.holder, t };
      if (this.fell) return null;
      const top = this.top(), lastBy = this.touch && t - this.touch.t < this.cfg.lastTouch ? this.touch.slot : null;
      // fallen: the top came down by more than two levels and a half, or three blocks lie on the table or the floor away from the tower
      const r = L / 2 + W / 2;
      const down = this.blocks.filter((b) => b.holder === null && !b.held && b.body.p[2] < this.base.z + T && Math.hypot(b.body.p[0] - this.base.x, b.body.p[1] - this.base.y) > r).length;
      if (top < this.peak - 2.5 * T || down >= 3) { this.fell = { by: lastBy, t }; return { what: 'fell', by: lastBy }; }
      if (this.moving()) { this.stillSince = null; return null; }
      if (this.stillSince === null) this.stillSince = t;
      if (t - this.stillSince < 0.5) return null;
      // all at rest for half a second: a block that is now higher than it was is a move (by whoever held it last)
      let move = null;
      for (const b of this.blocks) {
        const l = this.level(b.body.p[2]);
        if (l > b.rest && b.by !== null) move = { what: 'move', by: b.by, level: l };
        b.rest = l;
      }
      this.peak = Math.max(this.peak, top);
      return move;
    }
    // the packet: what moves (and what is held) and a few at rest in turn; all of it when nothing moves
    pack() {
      const B = this.blocks, still = !this.moving(), list = still ? B : B.filter((b) => b.held || b.holder !== null || !b.body.asleep);
      if (!still) { const rest = B.filter((b) => !list.includes(b)); for (let k = 0; k < Math.min(ROTATE, rest.length); k++) list.push(rest[(this.sent + k) % rest.length]); this.sent += ROTATE; }
      const out = [list.length, this.base.x, this.base.y, this.base.z, this.base.yaw];
      for (const b of list) {
        const y = b.body, h = b.holder;
        out.push(b.i, y.p[0], y.p[1], y.p[2], y.q[0], y.q[1], y.q[2], y.q[3], y.v[0], y.v[1], y.v[2], y.w[0], y.w[1], y.w[2], y.asleep ? 1 : 0, h === null || h === undefined ? 0 : h + 1);
      }
      return out;
    }
    // the holder's packet (s), taken in at nowMs: the blocks it names take its state (and are drawn gliding to it). -> false when it is not one
    apply(s, nowMs) {
      const n = s[0], base = { x: s[1], y: s[2], z: s[3], yaw: s[4] };
      if (Math.hypot(base.x - this.base.x, base.y - this.base.y, base.z - this.base.z) > 1e-4 || Math.abs(base.yaw - this.base.yaw) > 1e-4) this.build(base);     // (a new tower)
      for (let k = 0; k < n; k++) {
        const o = HEAD + k * PER, b = this.blocks[s[o]];
        if (!b) return false;
        const y = b.body;
        y.p = [s[o + 1], s[o + 2], s[o + 3]]; y.q = Q.normalize([s[o + 4], s[o + 5], s[o + 6], s[o + 7]]); y.v = [s[o + 8], s[o + 9], s[o + 10]]; y.w = [s[o + 11], s[o + 12], s[o + 13]];
        y.asleep = s[o + 14] > 0.5; y.calm = 0; y.held = null; b.held = null;
        b.holder = s[o + 15] > 0.5 ? Math.round(s[o + 15]) - 1 : null;
        if (b.holder !== null) b.by = b.holder;
        b.at = nowMs;
      }
      return true;
    }
    // where block b is drawn now (common frame): its state, carried on by its speed since its packet (up to 0.1 s) on a page that does not
    // simulate it, and glided to (k: 1/s) so that a packet or a change of holder is not a jump
    drawn(b, dt, nowMs, mine) {
      const y = b.body, age = mine ? 0 : Math.min(0.1, Math.max(0, (nowMs - b.at) / 1000)), aim = y.asleep ? y.p : [y.p[0] + y.v[0] * age, y.p[1] + y.v[1] * age, y.p[2] + y.v[2] * age];
      if (!b.d || Math.hypot(...sub(aim, b.d.p)) > 0.3) b.d = { p: aim.slice(), q: y.q.slice() };
      else { const f = 1 - Math.exp(-(mine ? 60 : 25) * dt); b.d.p = b.d.p.map((v, i) => v + (aim[i] - v) * f); b.d.q = Q.slerp(b.d.q, y.q, f); }
      return { p: b.d.p, q: b.d.q, held: !!b.held || b.holder !== null };
    }
  }

  // A hand source (this page's floor plan) in the common frame, which the tower is simulated in. toCommon([x, y, z]) -> [x, y, z].
  function commonSource(s, toCommon) {
    const out = Object.assign({}, s);
    if (s.points) out.points = s.points.map((p) => { const c = toCommon([p.x, p.y, p.z]); return Object.assign({}, p, { x: c[0], y: c[1], z: c[2] }); });
    if (s.joints) out.joints = s.joints.map((j) => toCommon(j));
    return out;
  }

  // ---- the tower as a Body (body.js). `common(sources)` turns this page's hands into the common frame. With a host here the host keeps
  // the tower (it is never asked for); else the page whose hand reaches for it takes it, as the lab's pile.
  function adapter(tower, S, common) {
    const C = tower.cfg;
    return {
      reach: (own) => !S.hostHere && tower.near(common(own), C.reach),
      touching: (own) => !S.hostHere && (tower.near(common(own), C.busy) || tower.blocks.some((b) => !!b.held && (own || []).some((s) => s.id === b.held.by))),
      pack: () => tower.pack(),
      apply: (s, info) => tower.apply(s, info.now),
      settle: () => {},
      do: (what, args) => { if (what !== 'build' || !args || ![args.x, args.y].every(Number.isFinite)) return false; tower.build(args); if (tower.onBuild) tower.onBuild(args); return true; },
      moving: () => tower.moving(),
    };
  }

  // ---- the game in the document: { round, state: 'standing' | 'fell', by (who touched it last when it fell), moves, turn, last }
  // Only the page that simulates the tower writes it (it is the one that sees the tower fall); everybody reads S.doc.jenga.
  const KINDS = { jenga: {
    keep: () => ({ key: 'jenga' }),
    apply(S, e) { S.doc.jenga = { round: e.round | 0, state: e.state === 'fell' ? 'fell' : 'standing', by: Number.isInteger(e.by) ? e.by : null, moves: e.moves | 0, turn: Number.isInteger(e.turn) ? e.turn : null, last: Number.isInteger(e.last) ? e.last : null }; S.notify('jenga', S.doc.jenga); },
  } };
  const game = (S) => S.doc.jenga || { round: 0, state: 'standing', by: null, moves: 0, turn: null, last: null };
  // the players here, by slot (the host is not one)
  function players(S) {
    const out = [];
    for (const [slot, p] of S.peers) if (!p.host) out.push(slot);
    if (!S.isHost && S.me !== null && S.me !== undefined) out.push(S.me);
    return out.sort((a, b) => a - b);
  }
  const after = (S, slot) => { const p = players(S); return p.length ? p.find((q) => q > slot) ?? p[0] : null; };
  // what the holder writes: a new tower (by: who asked for it, and has the first turn), a move (the turn goes on), the tower fell
  function event(S, what, by) {
    const g = game(S), by1 = Number.isInteger(by) ? by : null;
    if (what === 'build') return { k: 'jenga', round: g.round + 1, state: 'standing', by: null, moves: 0, turn: by1 !== null ? by1 : players(S)[0] ?? null, last: null };
    if (what === 'move') return Object.assign({ k: 'jenga' }, g, { moves: g.moves + 1, last: by1, turn: by1 !== null ? after(S, by1) : g.turn });
    if (what === 'fell') return Object.assign({ k: 'jenga' }, g, { state: 'fell', by: by1 });
    return null;
  }
  // one frame of the tower for a page or the host: it is simulated where the token is (or alone), judged everywhere, and the holder writes
  // what happened. hands: everybody's (common frame).
  function frame(tower, S, dt, t, hands) {
    const mine = !S.connected || S.holds(TOKEN);
    if (mine) tower.step(dt, t, hands);
    const e = tower.judge(t, hands);
    if (e && mine) { const ev = event(S, e.what, e.by); if (ev) S.emit(ev); }
    return mine;
  }
  // the tower wired to its session: a new tower is written into the document by the page that built it
  function wire(tower, S) { tower.onBuild = (args) => { if (!S.connected || S.holds(TOKEN)) S.emit(event(S, 'build', args.by)); }; }

  // ---- settings and the menu
  const GAME = {};
  const PLAYER = { ghost: true };
  const ACTIONS = ['build'];
  function press(id, st) {
    if (id === 'ghost') return Object.assign({}, st, { ghost: !st.ghost });
    return null;
  }
  const who = (slot, me) => (slot === null || slot === undefined ? 'nobody' : slot === me ? 'you' : `player ${slot + 1}`);
  // st: the menu owner's state; info.game: the document's game; info.me: the slot of the page that draws it; info.levels: the tower's height
  function menu(st, info) {
    info = info || {};
    const g = info.game || { round: 0, state: 'standing', moves: 0, turn: null, by: null }, me = info.me;
    const tower = g.state === 'fell' ? `FELL${g.by !== null ? ` (${who(g.by, me)})` : ''}` : `${info.levels || LEVELS} levels`;
    const note = g.state === 'fell' ? 'The tower fell. New tower: it stands in front of whoever presses it.'
      : 'Push a block out with a finger, or pinch it and pull. Put it on the top, across the level below. Then it is the next player\'s turn.';
    return M.menus.grid({ w: 1024, title: 'MUMR jenga', note: info.note || note,
      rows: [
        [{ label: 'Tower', value: tower, active: g.state === 'fell' }, { label: 'Turn', value: g.state === 'fell' ? '-' : who(g.turn, me), active: g.turn === me && g.state !== 'fell' }, { label: 'Moved', value: `${g.moves} block${g.moves === 1 ? '' : 's'}` }],
        [{ id: 'build', label: 'New tower', value: 'in front of me', span: 2 }, { id: 'ghost', label: 'Ghost fingers', value: st.ghost ? 'shown' : 'hidden', active: !!st.ghost }],
      ] });
  }
  const SESSION = { game: GAME, player: PLAYER, actions: ACTIONS, press, kinds: KINDS };

  Object.assign(J, { SCALE, T, W, L, LEVELS, N, PHYSICS, SLEEP, BLOCK, CFG, TOKEN, PACKET, Tower, commonSource, adapter, KINDS, game, players, event, frame, wire, GAME, PLAYER, ACTIONS, press, menu, SESSION });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = {}));

// The referee: the PC host's game. It runs the tower's physics (tower.js) with everybody's hands, reads off it what the rules (rules.js) need
// (the die has come to rest, a block has been pulled out, a block has been put on top, a block has reached the ground), runs the instant
// replay when the tower falls (replay.js), takes the board's commands, and keeps the shared state (the rules' view) in the document.
// Nobody else simulates anything: the pages draw what the host sends (net.js). No THREE and no DOM; the Node tests drive it with pretend
// hands and a pretend clock.
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec'), { Tower } = need('tower'), { Rules } = need('rules'), N = need('net'), R = need('replay');
  const T = { dieStill: 0.7, cocked: 12, aftermath: 4500, backAfter: 3, putBack: 1.2, restWait: 0.3 };      // seconds, degrees, ms
  const DEFAULT_PLACE = { x: 1.6, y: 0.6, yaw: 0 };

  class Referee {
    // opts: { Engine (the physics world class), session ({ peers: Map, emit(e), doc }), room (room.js Room: local() is the real room in the common frame), life, now (ms), seed, size }
    constructor(opts = {}) {
      this.Engine = opts.Engine || null; this.session = opts.session; this.room = opts.room || null; this.life = opts.life || (() => {});
      this.nowMs = 0; this.now = opts.now || (() => this.nowMs);
      this.rules = new Rules({ now: () => this.now(), present: (slot) => this.here().includes(slot) });
      this.rules.s.place = Object.assign({}, DEFAULT_PLACE);
      if (opts.size) this.rules.s.size = opts.size;
      this.seed = opts.seed === undefined ? 1 : opts.seed;
      this.rec = new R.Recorder(); this.replay = null; this.frozen = null; this.timer = null; this.mode = N.MODE.live; this.progress = 0; this.culprit = null;
      this.lastRev = -1; this.t = 0; this.stats = { steps: 0, ms: 0, worst: 0 };
      this.tower = null; this.makeTower();
      this.publish();
    }
    here() { const s = this.session; return s && s.peers ? [...s.peers].filter(([, p]) => !p.host).map(([k]) => k).sort((a, b) => a - b) : []; }
    nextSeed() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed; }
    // (re)build the tower at the state's size and place, with the seed the state names
    makeTower() {
      const s = this.rules.s;
      if (this.tower) this.tower.destroy();
      this.tower = new Tower({ Engine: this.Engine, size: s.size, seed: s.seed, place: s.place, room: this.realRoom() });
      this.tower.resetDie();
      this.rules.setTower(this.towerInfo());
      this.rec.clear(); this.replay = null; this.frozen = null; this.mode = N.MODE.live; this.progress = 0; this.culprit = null; this.restAt = null;
    }
    towerInfo() { const l = this.tower.levels(); return { full: l.full, top: l.top, topCount: l.topCount }; }
    realRoom() { return this.room && this.room.local ? this.room.local() : null; }
    // the state goes into the document when it has changed (every page and PC view reads it from there)
    publish() {
      const s = this.rules.s;
      if (s.rev === this.lastRev) return false;
      this.lastRev = s.rev;
      if (this.session && this.session.emit) this.session.emit({ k: 'jstate', s: this.rules.view() });
      return true;
    }
    // the document already has a state when the host starts again (it had gone away): the match goes on, with a fresh tower and a fresh round
    adopt(doc) {
      if (!doc || !doc.players) return;
      const mid = ['roll', 'pull', 'place', 'fall', 'replay', 'aftermath'].includes(doc.phase);
      Object.assign(this.rules.s, doc, mid ? { phase: 'roll', handled: null, roll: null, fall: null } : {});
      this.seed = doc.seed >>> 0;
      this.rules.s.rev = (doc.rev || 0) + 1;
      this.makeTower();
      if (mid) this.rules.say('The host came back: the tower is built again');
      this.publish();
    }
    // the link came up: the first one here publishes this state, anybody after takes the server's
    joined(first) { const d = this.session.doc && this.session.doc.jenga; if (!first && d) this.adopt(d); else { this.lastRev = -1; this.publish(); } }
    peerChanged() { if (this.rules.playerLeft()) this.tower.resetDie(); this.publish(); }

    // ---- the board's commands (anybody may press anything): -> true if it did something
    command(what, a = {}) {
      const r = this.rules, s = r.s, ph = s.phase;
      const ok = {
        start: () => { if (ph !== 'lobby' || !this.here().length) return false; r.startMatch(this.here(), this.nextSeed()); this.makeTower(); return true; },
        round: () => { if (ph !== 'round_end') return false; r.startRound(this.nextSeed(), this.here()); this.makeTower(); return true; },
        lobby: () => { if (ph !== 'match_end') return false; r.toLobby(); this.makeTower(); return true; },
        size: () => {
          if (ph !== 'lobby') return false;
          const i = S.SIZE_KEYS.indexOf(s.size); r.setSize(a.size && S.SIZES[a.size] ? a.size : S.SIZE_KEYS[(i + 1) % S.SIZE_KEYS.length]); this.makeTower(); return true;
        },
        place: () => {
          if (!['lobby', 'round_end', 'match_end'].includes(ph) || ![a.x, a.y, a.yaw].every(Number.isFinite)) return false;
          r.setPlace({ x: +a.x.toFixed(3), y: +a.y.toFixed(3), yaw: +a.yaw.toFixed(4) }); this.makeTower(); return true;
        },
        reroll: () => { if (!['roll', 'pull'].includes(ph) || s.handled) return false; r.reroll('The die is rolled again'); this.tower.resetDie(); return true; },
        skip: () => { if (!this.replay) return false; this.replay.skip(); return true; },
        back: () => { if (ph !== 'place') return false; this.tower.bringBack(); return true; },
      }[what];
      const did = ok ? ok() : false;
      if (did) this.life(`jenga: ${what}${a.size ? ` ${a.size}` : ''}`);
      this.publish();
      return did;
    }

    // ---- one host tick: dt seconds, nowMs, everybody's hands (common frame)
    step(dt, nowMs, hands) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0, tw = this.tower, r = this.rules, ph = r.phase;
      this.t += dt; this.nowMs = nowMs;
      const room = this.realRoom();
      if (room !== tw.realRoom) tw.setRoom(room);
      tw.frozen = !!this.frozen;
      tw.step(dt, this.t, hands || []);
      while (tw.log.length) this.life(`jenga: ${tw.log.shift()}`);
      if (ph === 'fall' || ph === 'replay') this.playReplay(nowMs);
      else if (ph === 'aftermath') { if (this.timer && nowMs >= this.timer) { this.timer = null; r.setPhase('round_end'); } }
      else {
        if (!this.frozen) this.rec.push(nowMs, tw.all());
        if (['roll', 'pull', 'place'].includes(ph)) this.play(dt, nowMs);
      }
      this.publish();
      if (t0) { const ms = performance.now() - t0; this.stats.steps++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms); }
    }
    // ---- a game in play: roll, pull, place; and the tower falling
    play(dt, nowMs) {
      const r = this.rules, tw = this.tower, ph = r.phase;
      const f = tw.fell();
      if (f) return this.fall(f, nowMs);
      if (ph === 'roll') {
        const d = tw.dieRead();
        if (d.moved && !d.held && d.rest >= T.dieStill) {
          if (d.up.tilt > T.cocked) { r.reroll('The die landed cocked: rolled again'); tw.resetDie(); }
          else if (!this.playable(d.up.colour)) { r.reroll(`No ${S.COLOURS[d.up.colour].label} block can be taken: roll again`); tw.resetDie(); }
          else r.rolled(d.up.colour);
        }
      }
      if ((ph === 'roll' || ph === 'pull') && tw.handled !== null) {
        const i = tw.handled, level = tw.restLevel[i];
        r.pulled({ i, colour: tw.colourOf(i), level, legal: tw.legalLevel(level) });
      } else if (ph === 'place' && tw.handled !== null) {
        const i = tw.handled, held = tw.heldBy(i) !== null, pl = tw.placed();
        if (pl) { r.placed(); tw.captureRest(); r.setTower(this.towerInfo()); tw.resetDie(); this.putBackAt = null; this.offAt = null; }
        else if (!held && tw.away(i).dist < 0.12 * tw.d.L && tw.away(i).dz < 0.3 * tw.d.H) {           // put back where it came from: the move is undone
          this.putBackAt = this.putBackAt === null || this.putBackAt === undefined ? this.t : this.putBackAt;
          if (this.t - this.putBackAt > T.putBack) { tw.handled = null; this.putBackAt = null; r.s.handled = null; r.s.phase = r.s.roll === null ? 'roll' : 'pull'; r.say('The block is back: pull again'); r._touch(); }
        } else this.putBackAt = null;
        if (!held && tw.offPlinth(i)) { this.offAt = this.offAt === null || this.offAt === undefined ? this.t : this.offAt; if (this.t - this.offAt > T.backAfter) { tw.bringBack(); this.offAt = null; r.say('The block is back on the plinth'); r._touch(); } } else this.offAt = null;
      }
    }
    // can a block of this colour be pulled (one in a level below the highest complete one)?
    playable(colour) {
      const tw = this.tower, full = tw.levels().full;
      return tw.blocks.some((b, i) => b.spec.colour === colour && tw.restLevel[i] >= 0 && tw.restLevel[i] < full);
    }
    // ---- the tower falls: freeze, then the replay
    fall(f, nowMs) {
      const r = this.rules, tw = this.tower;
      if (r.toppled({ i: f.i, level: tw.restLevel[f.i] }) === null) return;
      this.culprit = f.i;
      this.frozen = tw.all().map((b) => ({ p: b.p.slice(), q: b.q.slice(), v: b.v.slice(), w: b.w.slice() }));
      const frames = this.rec.take(nowMs, tw.all(), R.REPLAY.window);
      this.replay = new R.Replay(frames);
      r.s.fall.trail = R.trail(frames, f.i, 3);
      this.lastPlay = nowMs; this.mode = N.MODE.frozen; this.progress = 0;
      r._touch();
      this.life(`jenga: the tower fell: block ${f.i} (level ${tw.restLevel[f.i]}, ${S.COLOURS[tw.colourOf(f.i)].label}) hit the ground, ${r.name(r.s.fall.by)} toppled it`);
    }
    playReplay(nowMs) {
      const r = this.rules, tw = this.tower, dtMs = Math.min(100, Math.max(0, nowMs - (this.lastPlay || nowMs))); this.lastPlay = nowMs;
      if (!this.replay) return;
      const out = this.replay.step(dtMs);
      this.mode = out.mode; this.progress = out.progress;
      if (out.mode >= 2 && r.phase === 'fall') r.setPhase('replay');
      if (out.pose) {
        const bodies = tw.all();
        bodies.forEach((b, i) => { b.p = [out.pose[i * 7], out.pose[i * 7 + 1], out.pose[i * 7 + 2]]; b.q = [out.pose[i * 7 + 3], out.pose[i * 7 + 4], out.pose[i * 7 + 5], out.pose[i * 7 + 6]]; b.v = [0, 0, 0]; b.w = [0, 0, 0]; });
      }
      if (out.done) {
        // the world goes on from the frozen state: the collapse finishes in real time
        const bodies = tw.all();
        bodies.forEach((b, i) => { const s = this.frozen[i]; b.p = s.p; b.q = s.q; b.v = s.v; b.w = s.w; tw.world.wake(b); });
        this.frozen = null; this.replay = null; this.mode = N.MODE.after; this.progress = 0;
        r.setPhase('aftermath'); this.timer = nowMs + T.aftermath;
      }
    }

    // ---- the wire: the Body adapter's state and whether anything moves
    pack() { return { mode: this.mode, progress: this.progress, items: N.snapshot(this.tower, { culprit: this.culprit }) }; }
    moving() { return !!this.frozen || !!this.replay || this.tower.moving() > 0 || this.tower.holds.size > 0 || this.rules.phase === 'aftermath'; }
  }

  Object.assign(J, { Referee, DEFAULT_PLACE, TIMING: T });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));

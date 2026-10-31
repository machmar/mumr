// The referee: the PC host's game. It runs the tower's physics (tower.js) with everybody's hands, reads off it what the rules (rules.js) need
// (the die has come to rest, a block has been pulled out, a block has been put on top, a block has reached the ground), runs the instant
// replay when the tower falls (replay.js), takes the board's commands, and keeps the shared state (the rules' view) in the document.
// Nobody else simulates anything: the pages draw what the host sends (net.js). No THREE and no DOM; the Node tests drive it with pretend
// hands and a pretend clock.
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec'), { arrange } = need('arrange'), { decoPlan } = need('deco'), { Tower } = need('tower'), { Rules } = need('rules'), N = need('net'), R = need('replay'), Mu = need('music'), F = need('focus');
  const T = { dieStill: 0.7, cocked: 12, aftermath: 4500, backAfter: 3, putBack: 1.2, restWait: 0.3 };      // seconds, degrees, ms
  const DEFAULT_PLACE = { x: 1.6, y: 0.6, yaw: 0 };
  const DEBUG = () => typeof process !== 'undefined' && !!process.env && !!process.env.JENGA_DEBUG;

  class Referee {
    // opts: { Engine (the physics world class), session ({ peers: Map, emit(e), doc }), room (room.js Room: local() is the real room in the common frame), life, now (ms), seed, size }
    constructor(opts = {}) {
      this.Engine = opts.Engine || null; this.session = opts.session; this.room = opts.room || null; this.life = opts.life || (() => {});
      this.nowMs = 0; this.now = opts.now || (() => this.nowMs);
      this.rules = new Rules({ now: () => this.now(), present: (slot) => this.here().includes(slot) });
      { const r = this.rules, say = r.say.bind(r); r.say = (x) => { this.life(`jenga: says "${x}"`); return say(x); }; }   // (into the log too)
      if (opts.size) this.rules.s.size = opts.size;
      this.rules.s.place = this.arranged(this.headOf(DEFAULT_PLACE), DEFAULT_PLACE.yaw);
      this.seed = opts.seed === undefined ? 1 : opts.seed;
      this.rec = new R.Recorder(); this.replay = null; this.frozen = null; this.timer = null; this.mode = N.MODE.live; this.progress = 0; this.culprit = null;
      this.lastRev = -1; this.t = 0; this.stats = { steps: 0, ms: 0, worst: 0 };
      this.focus = new F.Focus(); this.tension = new Mu.Tension(); this.fAcc = 0; this.fState = null;          // the room's dim follows the game (focus.js)
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
    // ---- where the furniture stands (arrange.js): worked out from the real room for the player who put the game down, kept in the place
    // where the player stood for a place that does not say (the tower is in front of them, the usual distance away)
    headOf(pl) { const base = S.layout(this.rules.s.size).P[0]; return Number.isFinite(pl.hx) && Number.isFinite(pl.hy) ? [pl.hx, pl.hy] : [pl.x + Math.cos(pl.yaw) * base, pl.y + Math.sin(pl.yaw) * base]; }
    arranged(head, yaw) {
      const room = this.realRoom(), r = arrange({ size: this.rules.s.size, head, yaw, room });
      this.arrangedFor = room;
      this.life(`jenga: arranged for ${room ? `the room (${room.planes.length} planes)` : 'no room'}: tower ${r.place.x}, ${r.place.y}, console ${r.place.arr.c}${r.hard > 0 ? `, NOTHING FITS (collides ${r.hard.toFixed(1)})` : ''}`);
      return Object.assign(r.place, { hyaw: +yaw.toFixed(4) });
    }
    // the same player, another size or another room
    rearrange() { const pl = this.rules.s.place; this.rules.setPlace(this.arranged(this.headOf(pl), Number.isFinite(pl.hyaw) ? pl.hyaw : pl.yaw)); this.planDeco(); }
    // ---- the room's garden (deco.js): planned for the room round the game's arrangement, kept in the document. A plan that is the same as the one
    // the document has is not sent again (the garden would grow in again for nothing)
    planDeco() {
      const room = this.realRoom(), plan = decoPlan({ room, size: this.rules.s.size, place: this.rules.s.place });
      const have = this.session && this.session.doc && this.session.doc.jdeco, same = have && JSON.stringify(have.items) === JSON.stringify(plan.items);
      if (same) return false;
      const t = this.session && typeof this.session.serverNow === 'function' ? this.session.serverNow() : Date.now();
      this.deco = { at: Math.round(t), items: plan.items };
      if (this.session && this.session.emit) this.session.emit({ k: 'jdeco', d: this.deco });
      if (plan.items.length) this.life(`jenga: the room's garden: ${plan.items.map((i) => i.kind).join(', ')}`);
      return true;
    }
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
    joined(first) { const d = this.session.doc && this.session.doc.jenga; if (!first && d) this.adopt(d); else { this.lastRev = -1; this.publish(); } this.planDeco(); }
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
          const i = S.SIZE_KEYS.indexOf(s.size); r.setSize(a.size && S.SIZES[a.size] ? a.size : S.SIZE_KEYS[(i + 1) % S.SIZE_KEYS.length]); this.rearrange(); this.makeTower(); return true;
        },
        place: () => {
          if (!['lobby', 'round_end', 'match_end'].includes(ph) || ![a.x, a.y, a.yaw].every(Number.isFinite)) return false;
          // (a page sends where its player stands, hx, hy, and the tower's place in front of them; the arrangement may move the tower to where it fits)
          const head = Number.isFinite(a.hx) && Number.isFinite(a.hy) ? [a.hx, a.hy] : this.headOf(a);
          r.setPlace(this.arranged(head, a.yaw)); this.planDeco(); this.makeTower(); return true;
        },
        reroll: () => { if (!['roll', 'pull'].includes(ph) || s.handled) return false; r.reroll('The die is rolled again'); this.tower.resetDie(); return true; },
        dieback: () => { if (ph !== 'roll') return false; this.tower.resetDie(); r.say('The die is back on the tray'); r._touch(); return true; },
        skip: () => { if (!['fall', 'replay'].includes(ph)) return false; if (!this.replay) this.freezeFall(this.nowMs); this.replay.skip(); return true; },
        back: () => { if (ph !== 'place') return false; this.tower.bringBack(); return true; },
        // (rehearsals and the scene videos only: JENGA_DEBUG=1 lets a script nudge the tower, as a hand that is hard to aim in a headless browser would)
        // (JENGA_DEBUG only) a game in progress at once: n blocks from the lower levels put on top, scored for the players in turn; for the scene videos
        stage: () => {
          if (!DEBUG() || ph !== 'roll') return false;
          const tw = this.tower, n = Math.max(0, Math.min(15, a.moves | 0)), pickOrder = [];
          for (const lv of [2, 4, 6, 8, 10, 12, 14, 16, 3, 5, 7, 9, 11, 13, 15]) pickOrder.push(lv * 3 + ((lv >> 1) % 2 ? 2 : 0));         // (one block a level, the sides taking turns, the odd levels last)
          const levels = tw.levels(); let top = levels.top, count = 0;
          for (let k = 0; k < n && k < pickOrder.length; k++) {
            if (count === 0) { top++; count = 0; }
            const b = tw.blocks[pickOrder[k]].body, h = S.slotHome(top, count, tw.size, tw.top());
            b.p = S.toCommon(tw.place, h.p); b.q = S.qCommon(tw.place, h.q); b.v = [0, 0, 0]; b.w = [0, 0, 0]; tw.world.wake(b);
            if (++count === 3) count = 0;
          }
          for (const b of tw.all()) tw.world.wake(b);                       // (a block taken out from under sleeping ones leaves them floating: they must feel it)
          for (let t = 0; t < 240; t++) tw.world.step(1 / 60);
          tw.captureRest(); r.setTower(this.towerInfo());
          for (let k = 0; k < n; k++) { const p = r.s.players[k % r.s.players.length]; if (p) r.s.scores[p.slot][r.s.round - 1] += k % 3 === 0 ? 2 : 1; r.s.moves++; }
          r.s.turn = n % Math.max(1, r.s.players.length); r._touch(); return true;
        },
        setroll: () => { if (!DEBUG() || !['roll', 'pull'].includes(ph)) return false; if (ph === 'pull') { r.s.phase = 'roll'; } return r.rolled(a.colour | 0); },
        nudge: () => { if (!DEBUG()) return false; const tw = this.tower, v = a.v || 0.12, top = tw.levels().top; for (const b of tw.blocks) { const lv = tw.restLevel[b.i]; if (lv >= top - 2) { b.body.v = [v * Math.cos(tw.place.yaw), v * Math.sin(tw.place.yaw), 0]; tw.world.wake(b.body); } } return true; },
        shove: () => { if (!DEBUG()) return false; const tw = this.tower, v = a.vx || 3; for (let i = 0; i < 6; i++) { const b = tw.blocks[i].body, d = i % 2 ? 1 : -1; b.v = [d * v * Math.cos(tw.place.yaw), d * v * Math.sin(tw.place.yaw), 0]; tw.world.wake(b); } return true; },
      }[what];
      const did = ok ? ok() : false;
      if (did) this.life(`jenga: ${what}${a.size ? ` ${a.size}` : ''}`);
      this.publish();
      return did;
    }

    // ---- one host tick: dt seconds, nowMs, everybody's hands (common frame)
    step(dt, nowMs, hands) {
      // (a host that cannot keep up runs a little slow rather than taking longer steps, which cost more and fall further behind)
      dt = Math.min(dt, 0.025);
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0, r = this.rules, ph = r.phase;
      this.t += dt; this.nowMs = nowMs;
      const room = this.realRoom();
      // a new room (uploaded by a headset): the furniture is arranged for it again, between rounds (never under a game in play)
      if (room !== this.arrangedFor && ['lobby', 'round_end', 'match_end'].includes(ph)) { this.rearrange(); this.makeTower(); }
      const tw = this.tower;
      if (room !== tw.realRoom) tw.setRoom(room);
      tw.frozen = !!this.frozen; tw.awake = ['roll', 'pull', 'place'].includes(ph);
      tw.step(dt, this.t, hands || []);
      while (tw.log.length) this.life(`jenga: ${tw.log.shift()}`);
      if (ph === 'fall' || ph === 'replay') this.playReplay(nowMs);
      else if (ph === 'aftermath') { if (this.timer && nowMs >= this.timer) { this.timer = null; r.setPhase('round_end'); } }
      else {
        if (!this.frozen) this.rec.push(nowMs, tw.all());
        if (['roll', 'pull', 'place'].includes(ph)) this.play(dt, nowMs);
      }
      this.publish();
      this.logRules();
      this.focusStep(dt, nowMs);
      if (t0) { const ms = performance.now() - t0; this.stats.steps++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms); }
    }
    // ---- the log: every change of phase and everything the referee says (the turn, the roll, the score, why a round ended)
    logRules() {
      const s = this.rules.s, lg = this.lg || (this.lg = { phase: null, handled: null });
      if (s.phase !== lg.phase) { this.life(`jenga: phase ${lg.phase} -> ${s.phase} (round ${s.round}, turn ${s.players[s.turn] ? this.rules.name(s.players[s.turn].slot) : '-'}, roll ${s.roll === null ? '-' : S.COLOURS[s.roll].label}, handled ${s.handled === null || s.handled === undefined ? '-' : s.handled})`); lg.phase = s.phase; }
      const tw = this.tower;
      if (tw && tw.handled !== lg.handled) { this.life(`jenga: the pulled block is ${tw.handled === null ? 'none' : `${tw.name(tw.handled)}`}`); lg.handled = tw.handled; }
    }
    // ---- the focus: ten times a second the tension is read off the tower, and the room's dim (engine dim.js) is asked for when the look has to change
    dimLevel() { const g = this.session && this.session.game ? this.session.game('dim') : undefined; return g === undefined ? 2 : g; }
    focusStep(dt, nowMs) {
      this.fAcc += dt;
      if (this.fAcc < 0.1 || !this.session || !this.session.dim) return;
      const d = this.fAcc, view = this.rules.view(); this.fAcc = 0;
      const k = this.tension.update(view, this.pack().items, d);
      for (const w of Mu.momentsBetween(this.fState, view)) if (w === 'pulled') this.focus.pulse(nowMs);
      this.fState = view;
      const ask = this.focus.update(view, k, this.dimLevel(), nowMs);
      if (ask) { this.session.dim(ask); this.life(`jenga: the room ${ask.dark ? `dims to ${ask.dark} and greys to ${ask.mute}` : 'is as it is'} over ${ask.fade} ms (${view.phase}, tension ${k.toFixed(2)})`); }
    }
    // ---- a game in play: roll, pull, place; and the tower falling
    play(dt, nowMs) {
      const r = this.rules, tw = this.tower, ph = r.phase;
      const f = tw.fell();
      if (f) return this.fall(f, nowMs);
      if (ph === 'roll') {
        const d = tw.dieRead();
        if (d.moved && !d.held && d.rest >= T.dieStill) {
          if (d.inTower) { r.reroll('The die stuck in the tower: it is back on the tray'); tw.resetDie(); }
          else if (!d.passed) { r.reroll('Drop the die into the tower'); tw.resetDie(); }
          else if (d.up.tilt > T.cocked) { r.reroll('The die landed cocked: rolled again'); tw.resetDie(); }
          else if (!this.playable(d.up.colour)) { r.reroll(`No ${S.COLOURS[d.up.colour].label} block can be taken: roll again`); tw.resetDie(); }
          else r.rolled(d.up.colour);
        }
      }
      if ((ph === 'roll' || ph === 'pull') && tw.handled !== null) {
        const i = tw.handled, level = tw.restLevel[i];
        r.pulled({ i, colour: tw.colourOf(i), level, legal: tw.legalLevel(level) });
      } else if (ph === 'place' && tw.handled !== null) {
        const i = tw.handled, held = tw.heldBy(i) !== null, pl = tw.placed();
        // (a block that lies still and is not counted: why, once, in the log)
        if (!pl && !held && tw.stillFor > 2 && this.whyLogged !== i) { this.whyLogged = i; this.life(`jenga: block ${i} lies still and is not on top: ${tw.placedCheck().why}`); }
        if (pl) { this.whyLogged = null; r.placed(); tw.captureRest(); r.setTower(this.towerInfo()); tw.resetDie(); this.putBackAt = null; this.offAt = null; }
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
    // ---- the tower falls: it goes on falling for a moment (TIMBER), then everything freezes and the replay runs
    fall(f, nowMs) {
      const r = this.rules, tw = this.tower;
      if (r.toppled({ i: f.i, level: tw.restLevel[f.i] }) === null) return;
      this.culprit = f.i; this.fallAt = nowMs; this.replay = null; this.frozen = null; this.mode = N.MODE.live; this.progress = 0;
      r._touch();
      this.life(`jenga: the tower fell: block ${f.i} (level ${tw.restLevel[f.i]}, ${S.COLOURS[tw.colourOf(f.i)].label}) hit the ground, ${r.name(r.s.fall.by)} toppled it`);
    }
    freezeFall(nowMs) {
      const r = this.rules, tw = this.tower;
      this.frozen = tw.all().map((b) => ({ p: b.p.slice(), q: b.q.slice(), v: b.v.slice(), w: b.w.slice() }));
      const frames = this.rec.take(nowMs, tw.all(), R.REPLAY.span / 1000);
      this.replay = new R.Replay(frames, { hitAt: this.fallAt });
      if (r.s.fall) r.s.fall.trail = R.trail(frames, this.culprit, 3);
      this.lastPlay = nowMs; this.mode = N.MODE.frozen; this.progress = 0;
      r._touch();
    }
    playReplay(nowMs) {
      const r = this.rules, tw = this.tower, dtMs = Math.min(100, Math.max(0, nowMs - (this.lastPlay || nowMs))); this.lastPlay = nowMs;
      if (!this.replay) {                                                          // (still falling, recorded, until the freeze)
        this.rec.push(nowMs, tw.all());
        this.progress = Math.min(1, (nowMs - this.fallAt) / R.REPLAY.follow);
        if (nowMs - this.fallAt >= R.REPLAY.follow) this.freezeFall(nowMs);
        return;
      }
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

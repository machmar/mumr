// The focus: how much of the real room the game takes away. The engine can darken and grey the real room for everybody (the passthrough on every
// headset, the picture on every webcam page: engine/client/dim.js, `session.dim`), with the virtual world drawn over it at full strength; this
// is what the game asks of it, so that the tower, the die and the lantern are what there is to look at: the room recedes while a die is rolled,
// closes in with the tension of a pull, goes out at the moment the tower falls (the freeze) and comes back slowly after. The host asks (it sees
// every phase and every block); the document carries it, so every page is at the same look at the same moment. No THREE, no DOM.
//   look(state, tension, level, pulse) -> { dark, mute }       what the room should be now (steps of 0.05; level 0 off, 1 gentle, 2 full)
//   new Focus().update(state, tension, level, nowMs) -> { dark, mute, over, fade } to hand to session.dim, or null while nothing needs to change
//   focus.pulse(nowMs)                                          a block has just come out: a quick tightening that the room lets go of slowly
(function (J) {
  // by phase: how dark (0 the room as it is .. 1 black) and how grey (0 its own colours .. 1 grey), and how long (ms) the room takes to get there
  const LOOK = {
    lobby: { dark: 0, mute: 0, fade: 2500 },                    // the room as it is: set up, walk about, press Start
    roll: { dark: 0.3, mute: 0.2, fade: 2500 },                 // it recedes for the die
    pull: { dark: 0.45, mute: 0.3, fade: 1500 },                // and closes in on the tower, more with the tension (below)
    place: { dark: 0.45, mute: 0.3, fade: 1500 },
    fall: { dark: 0.9, mute: 1, fade: 150 },                   // the freeze: the room goes at once, the tower stays in colour
    replay: { dark: 0.85, mute: 1, fade: 700 },                 // the room stays out for the rewind and the slow motion
    aftermath: { dark: 0.35, mute: 0.5, fade: 3500 },           // and comes back slowly
    round_end: { dark: 0.15, mute: 0.1, fade: 3000 },
    match_end: { dark: 0, mute: 0, fade: 5000 },
  };
  const CFG = {
    tension: { dark: 0.35, mute: 0.45 },                        // what full tension adds while a block is pulled or put on top
    handled: { dark: 0.08, mute: 0.1 },                         // and a hand holding a block that is half out
    pulse: { dark: 0.12, mute: 0.1, ms: 1200, fadeIn: 150, fadeOut: 2500 },
    gentle: 0.5,                                                // level 1 asks this fraction of everything
    max: 0.92,                                                  // never black: a player can still see their own hands and the way to the wall
    step: 0.05,                                                 // the look is asked in steps, so that a wobbling tension does not fill the document
    every: 700,                                                 // ms between two asks within a phase
    setting: 1200,                                              // ms to the new look when the board's Room dim is changed
  };
  const quant = (v, top) => (Math.round(Math.max(0, Math.min(top, v)) / CFG.step) * Math.round(CFG.step * 100)) / 100;

  function look(state, tension, level = 2, pulse = false) {
    const ph = state && LOOK[state.phase] ? state.phase : 'lobby', b = LOOK[ph], tense = ph === 'pull' || ph === 'place';
    const t = Math.max(0, Math.min(1, tension || 0)), hand = tense && state.handled !== null && state.handled !== undefined;
    let dark = b.dark + (tense ? CFG.tension.dark * t + (hand ? CFG.handled.dark : 0) : 0) + (pulse && tense ? CFG.pulse.dark : 0);
    let mute = b.mute + (tense ? CFG.tension.mute * t + (hand ? CFG.handled.mute : 0) : 0) + (pulse && tense ? CFG.pulse.mute : 0);
    const k = level <= 0 ? 0 : level === 1 ? CFG.gentle : 1;
    return { dark: quant(dark * k, CFG.max), mute: quant(mute * k, 1) };
  }

  class Focus {
    constructor() { this.last = null; this.phase = null; this.level = null; this.pulsing = false; this.at = -1e9; this.pulseUntil = 0; }
    pulse(nowMs) { this.pulseUntil = nowMs + CFG.pulse.ms; }
    update(state, tension, level, nowMs) {
      const ph = state && LOOK[state.phase] ? state.phase : 'lobby', pulsing = nowMs < this.pulseUntil, want = look(state, tension, level, pulsing);
      const was = { ph: this.phase, level: this.level, pulsing: this.pulsing };
      this.phase = ph; this.level = level; this.pulsing = pulsing;
      const changed = ph !== was.ph || level !== was.level || pulsing !== was.pulsing, first = this.last === null;
      if (!first && want.dark === this.last.dark && want.mute === this.last.mute) return null;
      if (!first && !changed && nowMs - this.at < CFG.every) return null;                    // (a wobbling tension is not worth an event each time)
      this.last = want; this.at = nowMs;
      let fade = LOOK[ph].fade;
      if (ph === was.ph && pulsing !== was.pulsing) fade = pulsing ? CFG.pulse.fadeIn : CFG.pulse.fadeOut;
      if (was.level !== null && level !== was.level && ph === was.ph) fade = CFG.setting;            // (a player pressed the board's Room dim: it answers promptly)
      return { dark: want.dark, mute: want.mute, over: true, fade };
    }
  }

  Object.assign(J, { Focus, focusLook: look, FOCUS: Object.assign({ LOOK }, CFG) });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));

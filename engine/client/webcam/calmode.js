// The camera calibration mode as a state machine: which step it is in, what each step says, and what has been measured so far. No THREE and no DOM (webcamview.js is the page).
//
//   off -> choose -> fov -----------------> result        (field of view: sheet 4, the measurement that was there before)
//                 -> board ----------------> result        (distortion: a board of markers on the screen, snapshots of it, the lens fitted)
//                 -> aim -> latency -> result              (latency: the screen shown to the camera, flashed black and white; the aim step finds the screen's place in the picture)
//
//   const m = new CalMode();     m.open(); m.choose('distortion'); m.boardDone(fit);        or        m.choose('latency'); m.aimed(quad); m.latencyDone(verdict);
//   m.state                      { step, kind, msg, quad } (what the layer shows)       m.resultOf({ sheetFovDeg }) -> the numbers of the result step, or null before it
//   m.back()                     one step back (false at the first step: the page leaves the mode then)       m.exit()    leave from anywhere
// A call that does not fit the step it is in is ignored (it returns false); one that fits but has nothing usable in it (no screen found, a refused fit) stays and says why in `msg`.
(function (M) {
  const KINDS = ['fov', 'distortion', 'latency'];
  const WARN_PCT = 3;                                    // the field of view of the screen and of the sheet may differ by this much (percent)
  const MSG = {
    choose: 'What do you want to calibrate?',
    fov: 'Hold sheet 4 in front of the camera. Keep it steady for a moment at each place the outline shows.',
    aim: 'Point the camera at this screen so that all four corner marks are in the picture.',
    board: 'Point the camera at the screen so that the board of markers fills much of the picture. Move it nearer, then farther, then tilt it to the left and to the right. Hold it still for a moment at each place.',
    latency: 'Keep the camera on the screen and still. The screen is about to flash black and white.',
    result: 'Measured. The results are saved in the profile that is being calibrated.',
  };
  const isPt = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  const area = (q) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const num = (v) => (Number.isFinite(v) ? v : null);

  class CalMode {
    constructor() { this.reset(); }
    reset() { this.step = 'off'; this.kind = null; this.msg = ''; this.quad = null; this.fov = null; this.board = null; this.lat = null; this._stack = []; }
    get state() { return { step: this.step, kind: this.kind, msg: this.msg, quad: this.quad }; }
    _go(step) { this._stack.push(this.step); this.step = step; this.msg = MSG[step]; }

    open() { if (this.step !== 'off') return false; this.reset(); this.step = 'choose'; this.msg = MSG.choose; return true; }
    choose(kind) {
      if (this.step !== 'choose' || !KINDS.includes(kind)) return false;
      this.kind = kind; this._go(kind === 'fov' ? 'fov' : kind === 'distortion' ? 'board' : 'aim');
      return true;
    }
    // the screen as the camera sees it: its four corners in the picture (pixels), in any order that goes round
    aimed(quad) {
      if (this.step !== 'aim') return false;
      if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isPt) || Math.abs(area(quad)) < 1) { this.msg = 'The screen was not found: keep all four corner marks in the picture'; return false; }
      this.quad = quad.map((p) => p.slice());
      this._go('latency');
      return true;
    }
    // what lensfit.fit said: { ok, a1, a2, rmsBefore, rmsAfter, fovDeg, n } or { ok: false, why }
    boardDone(res) {
      if (this.step !== 'board') return false;
      if (!res || !res.ok || !Number.isFinite(res.a1) || !Number.isFinite(res.a2)) { this.msg = res && res.why ? String(res.why) : 'The distortion could not be worked out: try again'; return false; }
      this.board = { a1: res.a1, a2: res.a2, rmsBefore: num(res.rmsBefore), rmsAfter: num(res.rmsAfter), fovDeg: num(res.fovDeg), n: num(res.n) };
      this._go('result');
      return true;
    }
    // what latency.verdict said: { ok, medianMs, minMs, maxMs, n, unsteady } or { ok: false, why }
    latencyDone(res) {
      if (this.step !== 'latency') return false;
      if (!res || !res.ok || !Number.isFinite(res.medianMs)) { this.msg = res && res.why ? String(res.why) : 'The latency could not be measured: try again'; return false; }
      this.lat = { medianMs: res.medianMs, minMs: num(res.minMs), maxMs: num(res.maxMs), n: num(res.n), unsteady: !!res.unsteady };
      this._go('result');
      return true;
    }
    // the field of view measurement from sheet 4 is over: { fovDeg, shots, spread, lens } (lens: { a1, a2 } when the shots only agreed once the picture was straightened by it, else null)
    fovDone(info) {
      if (this.step !== 'fov') return false;
      if (!info || !Number.isFinite(info.fovDeg)) { this.msg = 'The field of view could not be measured: try again'; return false; }
      this.fov = { fovDeg: info.fovDeg, shots: num(info.shots), spread: num(info.spread), lens: info.lens && Number.isFinite(info.lens.a1) ? { a1: info.lens.a1, a2: Number.isFinite(info.lens.a2) ? info.lens.a2 : 0 } : null };
      this._go('result');
      return true;
    }
    back() {
      if (this.step === 'off' || !this._stack.length) return false;
      this.step = this._stack.pop(); this.msg = MSG[this.step];
      if (this.step === 'choose') { this.kind = null; this.quad = null; this.fov = null; this.board = null; this.lat = null; }
      else if (this.step === 'aim') { this.quad = null; this.lat = null; }
      else if (this.step === 'board') this.board = null;
      else if (this.step === 'latency') this.lat = null;
      return true;
    }
    exit() { const was = this.step !== 'off'; this.reset(); return was; }
    // back to the first screen (the choice) from anywhere, forgetting what this run measured -> false when the mode is not open
    home() { if (this.step === 'off') return false; this.reset(); this.step = 'choose'; this.msg = MSG.choose; return true; }

    // the numbers of the result step. sheetFovDeg: the field of view the camera has from sheet 4 (when this run did not measure it), for the cross-check
    resultOf(extra = {}) {
      if (this.step !== 'result') return null;
      const sheet = this.fov ? this.fov.fovDeg : Number.isFinite(extra.sheetFovDeg) ? extra.sheetFovDeg : null, screen = this.board ? this.board.fovDeg : null;
      const pct = sheet !== null && screen !== null ? Math.abs(screen - sheet) / sheet * 100 : null;
      return {
        kind: this.kind, fovDeg: this.fov ? this.fov.fovDeg : null, screenFovDeg: screen, sheetFovDeg: sheet, crossCheckPct: pct,
        warning: pct !== null && pct > WARN_PCT ? `The screen says ${screen.toFixed(1)} degrees and the sheet ${sheet.toFixed(1)}: they differ by ${pct.toFixed(1)} %. The sheet's value is kept; measure either again if you doubt it.` : null,
        a1: this.board ? this.board.a1 : this.fov && this.fov.lens ? this.fov.lens.a1 : null, a2: this.board ? this.board.a2 : this.fov && this.fov.lens ? this.fov.lens.a2 : null, lensFromSheet: !this.board && !!(this.fov && this.fov.lens), rmsBefore: this.board ? this.board.rmsBefore : null, rmsAfter: this.board ? this.board.rmsAfter : null,
        latencyMs: this.lat ? this.lat.medianMs : null, latencyMinMs: this.lat ? this.lat.minMs : null, latencyMaxMs: this.lat ? this.lat.maxMs : null, unsteady: this.lat ? this.lat.unsteady : false,
      };
    }
  }

  M.calmode = { CalMode, KINDS, WARN_PCT, MSG };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

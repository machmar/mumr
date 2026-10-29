// The webcam page: the camera's picture behind the 3D canvas, the clicks that place the camera, and its panel.
// The geometry is in webcam.js, the marker detector in markers.js, the stillness snapshot in fovcapture.js and what is kept for a camera in webcamcal.js;
// this file is the DOM and nothing else.
//
//   const wcv = createWebcamView({ calib, getSpots, say });
//   wcv.show(true | false)   the page is in webcam mode (or left it)
//   wcv.update()             every frame while it is: refreshes the panel and the markers
//   wcv.pose()               { x, y, z, yaw, pitch, hfov (rad), aspect } of the camera now, or null (not solved)
//   wcv.running              true while a camera (or a painted still) is giving a picture
//   wcv.measuring            true while the field of view is being measured from the printed markers (the detection loop is running)
//   wcv.start(deviceId)      open a camera; wcv.useStill(w, h, paint) a picture painted by `paint(ctx, w, h)` instead (rehearsal)
const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;

export function createWebcamView({ calib, getSpots, say, marksVisible }) {
  const marksOn = () => (marksVisible ? !!marksVisible() : true);          // the rings and crosses over the picture can be switched off (the Show menu)
  const NS = globalThis.MUMR, WC = NS.webcam, MK = NS.markers, FC = NS.fovcapture;
  const box = $('viewBox'), video = $('wcVideo'), pickCv = $('wcPick'), g = pickCv.getContext('2d');
  const el = { panel: $('wcPanel'), start: $('wcStart'), device: $('wcDevice'), status: $('wcStatus'), fov: $('wcFov'), fovBtn: $('wcFovMeasure'),
    calOpen: $('wcCalOpen'), fovClick: $('wcFovClick'), fovReset: $('wcFovReset'), fovSel: $('wcFovSel'), barH: $('wcBarH'), barV: $('wcBarV'), barReset: $('wcBarReset'), alt: $('wcAlt'), clear: $('wcClear'), spots: [0, 1, 2].map((i) => $('wcSpot' + i)) };
  const NAMES = ['spot 1', 'spot 2', 'the check spot'], COLOURS = ['#ff9f43', '#4ea1ff', '#7bd88f'];
  let on = false, stream = null, still = 0, task = null, text = '';      // task: { kind: 'spot', i } | { kind: 'fov', pts: [[u, v], ...] } (the clicks)
  // the automatic measurement of the field of view: { cap (FovCapture), markers (what the detector sees now), status, timer, busy, gray, finished }
  let auto = null;
  const grab = document.createElement('canvas'), grabCtx = grab.getContext('2d', { willReadFrequently: true });
  // the lens of this camera (lens.js): the picture is as the camera gives it; what the solver and the sheet measurement work with are ideal points (picture -> ideal), and what this page draws
  // over the picture from the solver's side (where it puts a spot, the outline of the next place) goes the other way (ideal -> picture)
  const lensOn = () => !NS.lens.isNone(calib.lens), bend = (p) => (lensOn() ? NS.lens.toPicture(calib.lens, p[0], p[1]) || p : p);
  const idealMarkers = (ms) => (lensOn() ? ms.map((m) => Object.assign({}, m, { corners: m.corners.map((p) => NS.lens.toIdeal(calib.lens, p[0], p[1])) })) : ms);
  // the calibration mode: calmode.js is the state machine, this file its layer (#calMode)
  const cal = new NS.calmode.CalMode();
  const C = { layer: $('calMode'), msg: $('calMsg'), back: $('calBack'), exit: $('calExit'), pick: $('calHome'), draw: $('calDraw'), prog: $('calProg'), fill: $('calFill'), result: $('calResult'),
    text: $('calResultText'), resultBack: $('calResultBack'), pickFov: $('calPickFov'), pickDist: $('calPickDist'), pickLat: $('calPickLat'),
    psel: $('calProfileSel'), newP: $('calNew'), rename: $('calRename'), del: $('calDelete'), parFov: $('calParFov'), parLat: $('calParLat'), parLens: $('calParLens'), grid: $('calGrid'), hint: $('calHomeHint') };
  let calStep = 'off';
  let editId = null, savedAs = null;        // the profile the calibrations are made for (the one that is chosen in the first screen of the mode), and, on the result screen, the name it was saved under
  // The picture can be shown as a mirror shows it, in the steps that show it: in the field-of-view step (the player holds sheet 4 in front of the camera and looks at the screen: a mirror is what
  // feels right) it is on at first; in the aim step (the camera looks at the screen, away from the player, as through a window) it is off at first. Only what is shown changes: the detector,
  // the clicks and the solver work on the picture as the camera gave it. Kept in this browser.
  const MIRROR_KEY = 'mumr.webcam.mirror', mirror = Object.assign({ fov: true, aim: false }, calib.store.get(MIRROR_KEY, null) || {});
  const mirrorStep = () => (cal.state.step === 'fov' || cal.state.step === 'aim' ? cal.state.step : null);
  const mirrored = () => box.classList.contains('mirror');
  // text on the 2D layer: when the layer is mirrored the letters are turned back, so that they read the right way round and start where they would
  const txt = (s, x, y) => { if (!mirrored()) { g.fillText(s, x, y); return; } g.save(); g.translate(x, y); g.scale(-1, 1); g.fillText(s, 0, 0); g.restore(); };

  const running = () => !!stream && video.videoWidth > 0;
  function layout() {
    box.classList.toggle('cam', on && running());
    box.classList.toggle('picking', on && !!task);
    document.body.classList.toggle('measuring', on && !!auto && !auto.finished);
    el.panel.hidden = !on;
    if (on && running()) { box.style.setProperty('--ratio', String(video.videoWidth / video.videoHeight)); }
  }

  function stop() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    if (still) { clearInterval(still); still = 0; }
    stream = null; video.srcObject = null; task = null; stopAuto(); closeCalibration();
    layout();
  }
  function attach(s, id) {
    stop(); stream = s; video.srcObject = s;
    video.onloadedmetadata = () => {
      calib.use(id, video.videoWidth, video.videoHeight);
      pickCv.width = video.videoWidth; pickCv.height = video.videoHeight;
      layout(); window.dispatchEvent(new Event('resize'));
    };
    video.play().catch(() => {});
  }
  async function listDevices() {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const cur = stream && stream.getVideoTracks()[0] ? stream.getVideoTracks()[0].getSettings().deviceId : '';
      el.device.innerHTML = '';
      all.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `camera ${i + 1}`; o.selected = d.deviceId === cur; el.device.appendChild(o); });
    } catch (e) { /* no list: the page still works with the default camera */ }
  }
  async function start(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This page cannot open a camera (it needs https or localhost)'); return false; }
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ width: { ideal: 1280 }, height: { ideal: 720 } }, deviceId ? { deviceId: { exact: deviceId } } : {}) });
    } catch (e) { say(e && e.name === 'NotAllowedError' ? 'The browser did not allow the camera' : `Camera: ${e && e.message ? e.message : e}`); return false; }
    attach(s, (s.getVideoTracks()[0].getSettings().deviceId || 'camera').slice(0, 16));
    listDevices();
    return true;
  }
  // A picture painted on a canvas stands in for the camera: for trying the page without one.
  // opts.fps: pictures a second (5 by default; a rehearsal of the latency step needs 30)
  function useStill(w, h, paint, opts) {
    const fps = opts && opts.fps ? opts.fps : 5;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); paint(ctx, w, h);
    const s = c.captureStream(fps);
    attach(s, 'still');
    still = setInterval(() => paint(ctx, w, h), opts && opts.fps ? Math.round(1000 / fps) : 400);
  }

  // ---- measuring the field of view from sheet 4: the picture is looked at about eight times a second for the four printed markers (markers.js); when
  // the sheet has been still for a moment a snapshot is taken and the field of view worked out of it (fovcapture.js), and the next place is suggested
  function startAuto() {
    if (!running()) { say('Start the camera first'); return; }
    stopAuto(); task = null; calib.clearFov();
    auto = { cap: new FC.FovCapture({ W: calib.W, H: calib.H, hfovDeg: calib.fovDeg, scale: () => calib.sheetScale }), markers: [], status: null, timer: 0, busy: false, gray: null, finished: false };
    auto.status = auto.cap.status();
    auto.timer = setInterval(detectTick, 125);
    layout();
  }
  function stopAuto() { if (auto) { clearInterval(auto.timer); auto = null; } }
  // the camera's picture as grey levels for the marker detector: { gray, W, H } (`h.gray` is the buffer that is kept between calls)
  function grabGray(h) {
    const W = video.videoWidth, H = video.videoHeight;
    if (grab.width !== W || grab.height !== H) { grab.width = W; grab.height = H; }
    grabCtx.drawImage(video, 0, 0, W, H);
    const d = grabCtx.getImageData(0, 0, W, H).data;
    if (!h.gray || h.gray.length !== W * H) h.gray = new Uint8Array(W * H);
    const gray = h.gray;
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return { gray, W, H };
  }
  function detectTick() {
    if (!auto || auto.busy || auto.finished || !running()) return;
    auto.busy = true;
    try {
      const { gray, W, H } = grabGray(auto);
      auto.markers = MK.detect(gray, W, H);
      const before = auto.cap.shots.length;
      auto.status = auto.cap.feed(idealMarkers(auto.markers), performance.now());
      if (auto.cap.shots.length > before) {
        const shot = auto.cap.shots[auto.cap.shots.length - 1];
        calib.addFovDeg(shot.fovDeg);
        say(`Shot ${auto.cap.shots.length}: field of view ${shot.fovDeg.toFixed(1)} degrees`);
      }
      if (auto.cap.done) { auto.finished = true; clearInterval(auto.timer); say(`Field of view ${calib.fovDeg.toFixed(1)} degrees from ${auto.cap.shots.length} shots`); }
      else if (!lensOn() && auto.cap.shots.length >= 3) {
        // the shots do not agree and the lens is not known: a camera that bends its picture does this; look for the bend that makes them agree
        const guess = auto.cap.lensGuess();
        if (guess) { auto.guess = guess; auto.finished = true; clearInterval(auto.timer); calib.setFov(guess.fovDeg); say(`The camera bends its picture: field of view ${guess.fovDeg.toFixed(1)} degrees, with a lens worked out from the sheet`); }
      }
    } catch (e) { say(`Measuring the field of view: ${e && e.message ? e.message : e}`); stopAuto(); }
    finally { if (auto) auto.busy = false; }
  }

  // ---- the calibration mode. Opened from the Webcam panel; it takes the screen (the panels go, the layer comes) and the camera until Exit or Esc. The steps: calmode.js.
  // Field of view: the measurement from sheet 4 above, with the picture and the outline showing through the layer. The other steps draw on the layer's canvas.
  // ---- the aim step (calmode.js 'aim'): the screen is dark, the camera's own picture is in the middle and the four corner markers of screencodes.js are at the screen's corners.
  // The camera sees the screen, and so also the picture inside the picture, with smaller copies of the markers: the detector keeps the LARGEST copy of each corner id, which is the
  // real screen's. When all four have been seen for half a second, in the shape of a screen, the step is over and the screen's quadrilateral in the picture is known.
  const SC = NS.screencodes, CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'], AIM_HOLD = 500;
  let aim = null;
  function startAim() { stopAim(); aim = { timer: setInterval(aimTick, 125), busy: false, gray: null, seen: new Map(), since: null, quad: null, text: 'Looking for the four corner marks...', W: 0, H: 0 }; }
  function stopAim() { if (aim) { clearInterval(aim.timer); aim = null; } }
  const centreOf = (m) => [m.corners.reduce((s, p) => s + p[0], 0) / 4, m.corners.reduce((s, p) => s + p[1], 0) / 4];
  const shoelace = (q) => { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const convex = (q) => { let sign = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (z === 0) return false; if (sign && Math.sign(z) !== sign) return false; sign = Math.sign(z); } return true; };
  function aimTick() {
    if (!aim || aim.busy || !running()) return;
    aim.busy = true;
    try {
      const { gray, W, H } = grabGray(aim);
      aim.W = W; aim.H = H;
      const found = MK.detect(gray, W, H, { codes: SC.CODES, prefer: 'largest' }).filter((m) => SC.CORNER_IDS.includes(m.id));
      aim.seen = new Map(found.map((m) => [m.id, m]));
      const missing = SC.CORNER_IDS.filter((i) => !aim.seen.has(i)), now = performance.now();
      aim.quad = null;
      if (missing.length) {
        aim.since = null;
        aim.text = `${4 - missing.length} of 4 corner marks seen. Missing: ${missing.map((i) => CORNER_NAMES[i]).join(', ')}.\nTilt the laptop, or move the camera back so that the whole screen is in the picture.`;
      } else {
        const quad = SC.CORNER_IDS.map((i) => centreOf(aim.seen.get(i))), sizes = SC.CORNER_IDS.map((i) => aim.seen.get(i).size);
        if (Math.max(...sizes) > 2.5 * Math.min(...sizes)) { aim.since = null; aim.text = 'One corner mark is much smaller than the others: it is a copy inside the picture, and the real one is cut off.\nMove the camera back so that the whole screen is in the picture.'; }
        else if (!convex(quad) || Math.abs(shoelace(quad)) < 0.04 * W * H) { aim.since = null; aim.text = 'All four marks are seen, but they do not make a screen in the picture: move the camera back, or point it at the screen.'; }
        else {
          if (aim.since === null) aim.since = now;
          aim.quad = quad; aim.text = 'The screen is found. Hold still...';
          if (now - aim.since >= AIM_HOLD) cal.aimed(quad);
        }
      }
    } catch (e) { aim.text = `Looking for the screen: ${e && e.message ? e.message : e}`; }
    finally { if (aim) aim.busy = false; }
  }
  // ---- the board step (calmode.js 'board'): the screen shows a board of markers (screencodes.board) and nothing else; the player moves the camera (or the laptop) nearer and farther and
  // tilts it, and at each steady moment a snapshot of the markers is taken (boardcapture.js). With five or more snapshots that differ enough the lens is fitted (lensfit.js).
  // The board leaves a strip at the top for the bar and one at the bottom for the progress bar, so that nothing covers a marker.
  const BC = NS.boardcapture, LF = NS.lensfit, STRIP_TOP = 64, STRIP_BOTTOM = 76;
  let bd = null;
  function boardLayout() {
    const w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight), b = SC.board({ w, h: h - STRIP_TOP - STRIP_BOTTOM });
    return Object.assign({}, b, { w, h, markers: b.markers.map((m) => Object.assign({}, m, { y: m.y + STRIP_TOP })) });
  }
  function startBoard() {
    stopBoard();
    const board = boardLayout();
    bd = { timer: setInterval(boardTick, 125), busy: false, gray: null, board, cap: new BC.BoardCapture({ ids: board.markers.map((m) => m.id), W: video.videoWidth, H: video.videoHeight }), status: null, fitted: 0, text: 'Looking for the board...' };
    document.body.classList.add('calboard');
  }
  function stopBoard() { if (bd) { clearInterval(bd.timer); bd = null; } document.body.classList.remove('calboard'); }
  function boardTick() {
    if (!bd || bd.busy || !running()) return;
    // the board on the screen is laid out for the window it was started in: when the window changes size (or had none yet) the layout is made again and the snapshots start over
    if (window.innerWidth > 0 && (Math.max(320, window.innerWidth) !== bd.board.w || Math.max(240, window.innerHeight) !== bd.board.h)) { startBoard(); return; }
    bd.busy = true;
    try {
      const { gray, W, H } = grabGray(bd);
      const found = MK.detect(gray, W, H, { codes: SC.CODES, prefer: 'largest' });
      bd.status = bd.cap.feed(found, performance.now());
      const st = bd.status, need = LF.MIN_SNAPSHOTS;
      bd.text = `${st.msg}\nMarkers seen: ${st.seen}. Snapshots: ${st.count} (at least ${need} are needed${st.next ? `; next: ${st.next.text}` : ''}).`;
      if (st.count >= need && st.count !== bd.fitted) {
        bd.fitted = st.count;
        const res = LF.fit(bd.cap.snapshots, { W, H, board: bd.board });
        if (res.ok) { cal.boardDone(res); return; }
        bd.text = `${st.msg}\n${res.why}`;
        if (bd.cap.full) { cal.boardDone(res); bd.cap.reset(); bd.fitted = 0; }
      }
    } catch (e) { bd.text = `Looking at the board: ${e && e.message ? e.message : e}`; }
    finally { if (bd) bd.busy = false; }
  }

  // ---- the latency step (calmode.js 'latency', latency.js): the screen is black, then flips white and black by a random schedule. For each flip the page notes when it set the colour,
  // and for every frame the camera gives (requestVideoFrameCallback) the mean grey of the screen's region of the picture (the aim step found it). The answer is the median of the
  // times from a flip to the first frame past half way. The bar and the progress bar are hidden while it flashes, so that nothing else is on the screen.
  const LT = NS.latency;
  let lat = null, screenLog = [];                        // screenLog: when the page set each colour, [{ t, colour }] (a rehearsal's fake camera reads it)
  const shrink = (q, f) => { const cx = q.reduce((s, p) => s + p[0], 0) / q.length, cy = q.reduce((s, p) => s + p[1], 0) / q.length; return q.map((p) => [cx + (p[0] - cx) * (1 - f), cy + (p[1] - cy) * (1 - f)]); };
  const inside = (q, x, y) => { let sign = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], z = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (z === 0) continue; if (sign && Math.sign(z) !== sign) return false; sign = Math.sign(z); } return true; };
  function startLatency() {
    stopLatency();
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) { cal.latencyDone({ ok: false, why: "This browser cannot time the camera's frames (it needs Chrome): the latency cannot be measured here." }); return; }
    const quad = cal.state.quad, W = video.videoWidth, H = video.videoHeight;
    if (!quad || !W) { cal.latencyDone({ ok: false, why: 'The screen has not been found yet: go Back and aim the camera at it.' }); return; }
    const small = document.createElement('canvas'); small.width = 160; small.height = 90;
    const region = shrink(quad, 0.35), idx = [];
    for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) if (inside(region, (x + 0.5) * W / 160, (y + 0.5) * H / 90)) idx.push(y * 160 + x);
    const t0 = performance.now();
    lat = { sched: LT.schedule(Math.random, 12), i: -1, tNext: t0 + 1500, sets: [], samples: [], colour: 'black', cb: 0, done: false, retryAt: 0, small, sg: small.getContext('2d', { willReadFrequently: true }), idx };
    screenLog = [{ t: t0, colour: 'black' }];
    if (!idx.length) { cal.latencyDone({ ok: false, why: 'The screen is too small in the picture to watch: move the camera closer, so that the screen fills more of it.' }); lat = null; return; }
    const me = lat, loop = (now) => {
      if (lat !== me || me.done) return;
      me.sg.drawImage(video, 0, 0, 160, 90);
      const d = me.sg.getImageData(0, 0, 160, 90).data; let s = 0;
      for (const j of me.idx) s += (d[j * 4] * 77 + d[j * 4 + 1] * 150 + d[j * 4 + 2] * 29) >> 8;
      me.samples.push({ t: now, v: s / me.idx.length });
      me.cb = video.requestVideoFrameCallback(loop);
    };
    lat.cb = video.requestVideoFrameCallback(loop);
    document.body.classList.add('calflash');
  }
  function stopLatency() {
    if (lat && lat.cb && video.cancelVideoFrameCallback) { try { video.cancelVideoFrameCallback(lat.cb); } catch (e) { /* gone already */ } }
    lat = null; document.body.classList.remove('calflash');
  }
  // every frame of the page while the step is open: set the next colour when it is time, and when the last flip has been held, work the answer out
  function latencyTick() {
    if (!lat) return;
    const now = performance.now();
    if (lat.done) { if (lat.retryAt && now >= lat.retryAt) startLatency(); return; }
    while (lat.i + 1 < lat.sched.length && now >= lat.tNext) {
      lat.i++; const e = lat.sched[lat.i];
      lat.colour = e.colour; lat.sets[lat.i] = now; lat.tNext = now + e.hold; screenLog.push({ t: now, colour: e.colour });
      if (screenLog.length > 60) screenLog.shift();
    }
    if (lat.i === lat.sched.length - 1 && now >= lat.tNext) finishLatency();
  }
  function finishLatency() {
    const s = lat.samples, n = lat.sched.length - 1, list = [];
    lat.done = true; document.body.classList.remove('calflash');
    if (lat.cb && video.cancelVideoFrameCallback) { try { video.cancelVideoFrameCallback(lat.cb); } catch (e) { /* gone already */ } }
    for (let k = 1; k <= n; k++) {
      const tSet = lat.sets[k], tNext = k < n ? lat.sets[k + 1] : lat.tNext, lv = LT.levels(s, tSet, tNext), t = lv ? LT.seen(s, tSet, lv) : null;
      list.push(t === null ? null : t - tSet);
    }
    let res = LT.verdict(list);
    if (LT.frozen(s)) res = { ok: false, n: 0, why: "The camera's picture never changed: is it pointed at the screen? (It must see the screen, not the room.)" };
    else if (res.ok) res.frameMs = LT.frameInterval(s);
    if (!cal.latencyDone(res)) lat.retryAt = performance.now() + 4000;
  }

  // a marker as it is shown on the screen: its white tile, then its black ring and cells
  function drawMarker(g, m, code) {
    const t = SC.tile(m), q = m.side / 6, cells = MK.cellsOf(code);
    g.fillStyle = '#fff'; g.fillRect(t.x, t.y, t.w, t.h);
    g.fillStyle = '#000';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (cells[r * 6 + c]) g.fillRect(m.x + c * q, m.y + r * q, q + 0.5, q + 0.5);
  }
  // the layer's canvas, once a frame while a step that draws on it is open (the layer is as big as the window, drawn in CSS pixels)
  function calDrawFrame(s) {
    const cv = C.draw, dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = s.step === 'latency' && lat && lat.colour === 'white' ? '#fff' : '#000'; g.fillRect(0, 0, w, h);
    if (s.step === 'board' && bd) {
      for (const m of bd.board.markers) drawMarker(g, m, SC.CODES[m.id]);
      g.fillStyle = '#fff'; g.font = '15px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      bd.text.split('\n').slice(0, 3).forEach((line, i) => g.fillText(line, w / 2, h - STRIP_BOTTOM + 22 + i * 19, w * 0.92));
    }
    if (s.step === 'aim') {
      const ratio = video.videoWidth / video.videoHeight || 16 / 9, ph = Math.min(h * 0.5, (w * 0.6) / ratio), pw = ph * ratio, px = (w - pw) / 2, py = (h - ph) / 2;
      const flip = mirror.aim, mx = (x) => (flip ? px + pw - (x - px) : x);                // (a point of the unmirrored inset -> where it is when the inset is mirrored)
      if (flip) { g.save(); g.translate(px + pw, py); g.scale(-1, 1); g.drawImage(video, 0, 0, pw, ph); g.restore(); } else g.drawImage(video, px, py, pw, ph);
      g.strokeStyle = '#333'; g.lineWidth = 1; g.strokeRect(px, py, pw, ph);
      for (const m of SC.corners({ w, h })) drawMarker(g, m, SC.CODES[m.id]);
      if (aim && aim.W) {                                              // what the detector sees in the picture, drawn on the picture's copy
        const sx = pw / aim.W, sy = ph / aim.H;
        g.lineWidth = 2; g.strokeStyle = aim.quad ? '#4cd964' : '#ffd24a';
        for (const m of aim.seen.values()) { g.beginPath(); m.corners.forEach((p, i) => (i ? g.lineTo(mx(px + p[0] * sx), py + p[1] * sy) : g.moveTo(mx(px + p[0] * sx), py + p[1] * sy))); g.closePath(); g.stroke(); }
        if (aim.quad) { g.beginPath(); aim.quad.forEach((p, i) => (i ? g.lineTo(mx(px + p[0] * sx), py + p[1] * sy) : g.moveTo(mx(px + p[0] * sx), py + p[1] * sy))); g.closePath(); g.stroke(); }
      }
    }
  }

  function openCalibration() {
    if (!running()) { say('Start the camera first'); return false; }
    task = null; stopAuto(); editId = calib.profileId; homeSig = ''; cal.open(); calSync();
    return true;
  }
  function closeCalibration() { cal.exit(); calSync(); }
  function calText(s) {
    if (s.step === 'fov' && auto && !auto.finished && auto.status) {
      const st = auto.status;
      if (st.shots >= 3 && !st.done) return `Measuring the field of view: ${st.msg}\nThe shots do not agree yet (${st.fovDeg ? `${st.fovDeg.toFixed(0)} degrees so far, ` : ''}they differ by ${st.spread.toFixed(0)} degrees): a camera that bends its picture does that. Keep going: the page is looking for a bend that makes them agree.`;
      return `Measuring the field of view: ${st.msg}\nMarkers seen: ${st.seen.length} of 4. Shots: ${st.shots}${st.fovDeg ? ` (${st.fovDeg.toFixed(1)} degrees so far)` : ''}.${st.next ? ` Next, place ${st.next.n} of ${st.next.of}: ${st.next.text}` : ''}`;
    }
    if (s.step === 'aim' && aim) return `${s.msg}\n${aim.text}`;
    if (s.step === 'latency' && lat && lat.done && lat.retryAt) return `${s.msg}\nTrying again in a few seconds (Back or Esc stops).`;
    return s.msg;
  }
  function resultText() {
    const r = cal.resultOf({ sheetFovDeg: calib.fovMeasured ? calib.fovDeg : null });
    if (!r) return '';
    const L = [];
    if (r.fovDeg !== null) L.push(`Field of view: ${r.fovDeg.toFixed(1)} degrees (from sheet 4)`);
    if (r.lensFromSheet) L.push(`The camera bends its picture: the shots only agreed with a lens of a1 ${r.a1.toFixed(3)} (a2 0), worked out from the sheet alone. It is rough: measure Distortion for a proper one.`);
    if (r.screenFovDeg !== null) L.push(`Field of view from the screen: ${r.screenFovDeg.toFixed(1)} degrees${r.sheetFovDeg !== null ? ` (the sheet says ${r.sheetFovDeg.toFixed(1)}: ${r.crossCheckPct.toFixed(1)} % apart)` : ''}`);
    if (r.warning) L.push(r.warning);
    if (r.a1 !== null && !r.lensFromSheet) L.push(Math.abs(r.a1) < 0.005 && Math.abs(r.a2) < 0.005 ? 'Lens: no measurable distortion' : `Lens: a1 ${r.a1.toFixed(3)}, a2 ${r.a2.toFixed(3)}${r.rmsBefore !== null ? ` (the markers were ${r.rmsBefore.toFixed(1)} px off a straight board, now ${r.rmsAfter.toFixed(1)} px)` : ''}`);
    if (r.latencyMs !== null) L.push(`Latency: ${Math.round(r.latencyMs)} ms (between ${Math.round(r.latencyMinMs)} and ${Math.round(r.latencyMaxMs)} ms)${r.unsteady ? '. It is unsteady: measure again' : ''}. It includes the screen's own response, about one frame.`);
    L.push(savedAs ? `Saved in the profile "${savedAs}", which this camera now uses.` : 'Not saved: there is no profile chosen to save it in.');
    return L.join('\n');
  }
  // The measurement goes into the profile that is being calibrated (and this camera takes the profile as it is now). The field of view from the screen is only a cross-check: the sheet's is kept.
  function applyResult() {
    const r = cal.resultOf({ sheetFovDeg: null });
    if (!r || !editId) return null;
    const patch = {};
    if (r.fovDeg !== null) patch.fovDeg = r.fovDeg;
    if (r.a1 !== null) patch.lens = { a1: r.a1, a2: r.a2 };
    if (r.latencyMs !== null) patch.latencyMs = Math.round(r.latencyMs);
    const u = calib.updateProfile(editId, patch, { use: true });
    libSig = ''; homeSig = '';
    return u.ok ? calib.profileName : null;
  }
  // a field of view typed or assumed in the field-of-view step goes into the profile too
  function fovToProfile() {
    if (cal.state.step !== 'fov' || !editId) return;
    calib.updateProfile(editId, { fovDeg: calib.fovMeasured ? calib.fovDeg : null }, { use: true });
    libSig = ''; homeSig = '';
  }

  // ---- the first screen of the mode: which profile is being calibrated, what it has, and the three big buttons. The profile is made, renamed and deleted here.
  let homeSig = '';
  function drawGrid(lens) {
    const cv = C.grid, w = cv.width, ratio = calib.W > 0 ? calib.H / calib.W : 9 / 16; cv.height = Math.round(w * ratio); const h = cv.height, g2 = cv.getContext('2d');
    g2.clearRect(0, 0, w, h); g2.fillStyle = '#0d0f14'; g2.fillRect(0, 0, w, h);
    g2.lineWidth = 1; g2.strokeStyle = '#2b303c'; g2.beginPath();
    for (let i = 0; i <= 8; i++) { g2.moveTo(i * w / 8, 0); g2.lineTo(i * w / 8, h); }
    for (let j = 0; j <= 6; j++) { g2.moveTo(0, j * h / 6); g2.lineTo(w, j * h / 6); }
    g2.stroke();
    if (lens) {
      const L = { a1: lens.a1, a2: lens.a2, W: 1280, H: Math.round(1280 * ratio) }, sx = w / L.W, sy = h / L.H;
      g2.save(); g2.beginPath(); g2.rect(0, 0, w, h); g2.clip(); g2.lineWidth = 1.6; g2.strokeStyle = '#4ea1ff';
      for (const line of NS.lens.gridLines(L, 8, 6, 28)) { g2.beginPath(); line.pts.forEach((p, i) => (i ? g2.lineTo(p[0] * sx, p[1] * sy) : g2.moveTo(p[0] * sx, p[1] * sy))); g2.stroke(); }
      g2.restore();
    } else { g2.fillStyle = '#9aa3b2'; g2.font = '14px system-ui, sans-serif'; g2.textAlign = 'center'; g2.fillText('not measured', w / 2, h / 2 + 5); }
    g2.strokeStyle = '#6b7385'; g2.lineWidth = 2; g2.strokeRect(1, 1, w - 2, h - 2);
  }
  function refreshHome() {
    const lib = calib.profiles();
    if (editId && !lib.some((e) => e.id === editId)) editId = null;
    const cur = lib.find((e) => e.id === editId) || null, sig = JSON.stringify([lib, editId, calib.W, calib.H]);
    if (sig === homeSig) return;
    homeSig = sig;
    const sel = C.psel; sel.innerHTML = '';
    const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
    add('', lib.length ? '(none chosen)' : '(no profiles yet)');
    for (const e of lib) add(e.id, e.name);
    sel.value = editId || '';
    C.rename.disabled = C.del.disabled = !cur;
    C.pickFov.disabled = C.pickDist.disabled = C.pickLat.disabled = !cur;
    C.hint.textContent = cur ? 'What each calibration finds is saved in this profile, and the camera uses it.' : 'Make a profile first (New...): what the calibrations find is saved in the profile that is chosen.';
    C.parFov.textContent = !cur ? '\u2013' : cur.fovDeg === null ? 'not measured\n(70 degrees assumed)' : `${cur.fovDeg.toFixed(1)} degrees`;
    C.parLat.textContent = !cur ? '\u2013' : cur.latencyMs === null ? 'not measured' : `${Math.round(cur.latencyMs)} ms`;
    const lens = cur && cur.a1 !== null ? { a1: cur.a1, a2: cur.a2, W: calib.W || 1280, H: calib.H || 720 } : null, none = lens && Math.abs(lens.a1) < 0.005 && Math.abs(lens.a2) < 0.005;
    C.parLens.textContent = !cur ? '\u2013' : !lens ? 'not measured' : none ? 'no measurable distortion' : `a1 ${lens.a1.toFixed(3)}, a2 ${lens.a2.toFixed(3)}\nthe corners of the picture are bent by ${NS.lens.cornerBend(lens).px.toFixed(0)} px (${NS.lens.cornerBend(lens).percent.toFixed(1)} % of the half diagonal)`;
    drawGrid(lens && !none ? lens : null);
    if (lens && none) { const g2 = C.grid.getContext('2d'); g2.fillStyle = '#9aa3b2'; g2.font = '14px system-ui, sans-serif'; g2.textAlign = 'center'; g2.fillText('no distortion', C.grid.width / 2, C.grid.height / 2 + 5); }
  }
  C.psel.addEventListener('change', () => {
    editId = C.psel.value || null;
    if (editId) calib.useProfile(editId); else { calib.clearFov(); calib.clearLens(); calib.clearLatency(); }
    libSig = ''; homeSig = '';
  });
  C.newP.addEventListener('click', () => {
    const name = window.prompt('Name for the new profile:', `Camera ${calib.profiles().length + 1}`);
    if (name === null) return;
    const r = calib.createProfile(name);
    if (r.ok) editId = r.entry.id; else say(r.why);
    libSig = ''; homeSig = '';
  });
  C.rename.addEventListener('click', () => {
    const cur = calib.profiles().find((e) => e.id === editId); if (!cur) return;
    const name = window.prompt('New name:', cur.name);
    if (name === null) return;
    const r = calib.renameProfile(cur.id, name);
    if (!r.ok) say(r.why);
    libSig = ''; homeSig = '';
  });
  C.del.addEventListener('click', () => {
    const cur = calib.profiles().find((e) => e.id === editId); if (!cur) return;
    if (!window.confirm(`Delete the profile "${cur.name}" and everything that was measured for it?`)) return;
    calib.removeProfile(cur.id); editId = null;
    libSig = ''; homeSig = '';
  });

  // after every change and every frame: the layer shows what the step needs, and the loops of a step start and stop with it
  function calSync() {
    if (cal.state.step === 'fov' && auto && auto.finished) cal.fovDone({ fovDeg: calib.fovDeg, shots: auto.cap.shots.length, spread: auto.cap.spread, lens: auto.guess ? { a1: auto.guess.a1, a2: auto.guess.a2 } : null });
    const s = cal.state, open = s.step !== 'off';
    if (s.step !== calStep) {
      const was = calStep; calStep = s.step;
      if (was === 'fov' && s.step !== 'result') stopAuto();
      if (s.step === 'fov') startAuto();
      if (s.step === 'aim') startAim(); else stopAim();
      if (s.step === 'latency') startLatency(); else stopLatency();
      if (s.step === 'board') startBoard(); else stopBoard();
      if (s.step === 'result') savedAs = applyResult(); else savedAs = null;
      layout();
    }
    if (s.step === 'choose') refreshHome();
    document.body.classList.toggle('calibrating', open);
    C.layer.hidden = !open; C.layer.classList.toggle('over', s.step === 'fov');
    $('calFovTools').hidden = s.step !== 'fov';
    C.pick.hidden = s.step !== 'choose'; C.draw.hidden = !['aim', 'board', 'latency'].includes(s.step); C.result.hidden = s.step !== 'result';
    const ms = mirrorStep();
    $('calMirrorWrap').hidden = !ms; if (ms) $('calMirror').checked = !!mirror[ms];
    box.classList.toggle('mirror', s.step === 'fov' && mirror.fov);
    C.layer.classList.toggle('draws', !C.draw.hidden && s.step !== 'board');            // (the board has strips of its own at the top and the bottom: the bar goes across the top there)
    C.prog.hidden = s.step !== 'aim' && s.step !== 'latency' && s.step !== 'board';
    if (s.step === 'board') C.fill.style.width = `${bd && bd.status ? bd.status.progress * 100 : 0}%`;
    if (s.step === 'aim') C.fill.style.width = `${aim && aim.since !== null ? Math.min(100, (performance.now() - aim.since) / AIM_HOLD * 100) : 0}%`;
    if (s.step === 'latency') { latencyTick(); C.fill.style.width = `${lat ? Math.max(0, lat.i) / (lat.sched.length - 1) * 100 : 0}%`; }
    if (!C.draw.hidden) calDrawFrame(s);
    const t = calText(s); if (C.msg.textContent !== t) C.msg.textContent = t;
    if (s.step === 'result') { const rt = resultText(); if (C.text.textContent !== rt) C.text.textContent = rt; }
    C.back.textContent = s.step === 'choose' ? 'Leave' : 'Back';
    if (document.body.classList.contains('calibrating') !== open) document.body.classList.toggle('calibrating', open);
  }
  el.calOpen.addEventListener('click', openCalibration);
  $('calMirror').addEventListener('change', () => { const ms = mirrorStep(); if (!ms) return; mirror[ms] = $('calMirror').checked; calib.store.set(MIRROR_KEY, mirror); calSync(); });
  C.exit.addEventListener('click', closeCalibration);
  C.back.addEventListener('click', () => { if (cal.state.step === 'result') { cal.home(); calSync(); } else if (!cal.back()) closeCalibration(); else calSync(); });
  C.pickFov.addEventListener('click', () => { cal.choose('fov'); calSync(); });
  C.pickDist.addEventListener('click', () => { cal.choose('distortion'); calSync(); });
  C.pickLat.addEventListener('click', () => { cal.choose('latency'); calSync(); });
  C.resultBack.addEventListener('click', () => { cal.home(); calSync(); });

  function pose() {
    if (!on || !running()) return null;
    const r = calib.result(getSpots());
    if (!r.ok) return null;
    return { x: r.cam.x, y: r.cam.y, z: r.cam.z, yaw: r.cam.yaw, pitch: r.cam.pitch, hfov: calib.fovDeg * D2R, aspect: calib.W / calib.H };
  }

  // clicks in the picture
  // ---- setting a point (a spot, or a corner of sheet 4): a click puts the point down for now, a zoomed box (the loupe) in the corner of the window that is furthest from the mouse shows
  // the picture round it, 4 or 8 times as big, and the point is moved with the arrow keys (a pixel at a time, a quarter with Shift) until Accept (or Enter) keeps it. The box is for looking at, not for the mouse: it keeps out of the mouse's way, and so its buttons (4x, 8x, Accept) are in a bar of their own at the bottom middle of the window (keys 4, 8, Enter).
  // Before the click the box follows the mouse, so that the place can be looked at first. Esc gives the point up.
  const LOUPE = 300;
  const lp = { box: $('wcLoupe'), bar: $('wcLoupeBar'), cv: $('wcLoupeCv'), info: $('wcLoupeInfo'), ok: $('wcLoupeOk'), z4: $('wcLoupe4'), z8: $('wcLoupe8') }, lpg = lp.cv.getContext('2d');
  let pend = null, hover = null, mouse = [0, 0], loupeZoom = 8;
  const uvOf = (ev) => { const r = pickCv.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width; return [(mirrored() ? 1 - fx : fx) * pickCv.width, (ev.clientY - r.top) / r.height * pickCv.height]; };
  const clampPt = (q) => [Math.min(pickCv.width, Math.max(0, q[0])), Math.min(pickCv.height, Math.max(0, q[1]))];
  function acceptPoint() {
    if (!task || !pend) return;
    const uv = pend; pend = null; hover = null;
    if (task.kind === 'spot') { calib.setClick(task.i, uv); task = null; }
    else {
      task.pts.push(uv);
      if (task.pts.length === 4) {
        const deg = calib.addFovShot(task.pts);
        say(deg === null ? 'That picture says nothing about the field of view: lean the sheet back further and try again' : `Field of view ${deg.toFixed(1)} degrees`);
        task = null;
      }
    }
    layout();
  }
  pickCv.addEventListener('pointerdown', (ev) => { if (!task) return; ev.preventDefault(); pend = clampPt(uvOf(ev)); });
  pickCv.addEventListener('pointermove', (ev) => { if (task) hover = uvOf(ev); });
  pickCv.addEventListener('pointerleave', () => { hover = null; });
  window.addEventListener('pointermove', (ev) => { mouse = [ev.clientX, ev.clientY]; });
  lp.ok.addEventListener('click', acceptPoint);
  lp.z4.addEventListener('click', () => { loupeZoom = 4; });
  lp.z8.addEventListener('click', () => { loupeZoom = 8; });
  window.addEventListener('keydown', (ev) => {
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (task && pend && !typing) {
      const step = ev.shiftKey ? 0.25 : 1, dir = mirrored() ? -1 : 1;
      const move = { ArrowLeft: [-step * dir, 0], ArrowRight: [step * dir, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (move) { ev.preventDefault(); pend = clampPt([pend[0] + move[0], pend[1] + move[1]]); return; }
      if (ev.key === 'Enter') { ev.preventDefault(); acceptPoint(); return; }
      if (ev.key === '4' || ev.key === '8') { loupeZoom = Number(ev.key); return; }
    }
    if (ev.key === 'Escape' && cal.state.step !== 'off') closeCalibration();
    else if (ev.key === 'Escape' && task) { task = null; pend = null; hover = null; layout(); }
  });
  // the box: where it goes (the corner furthest from the mouse; it stays where it is while the mouse is on it), and what it shows
  function drawLoupe() {
    const p = task ? (pend || hover) : null;
    lp.box.hidden = !p || !running();
    lp.bar.hidden = !(task && pend) || !running();
    if (lp.box.hidden) return;
    const w = window.innerWidth, h = window.innerHeight, m = 12, bw = lp.box.offsetWidth || LOUPE + 14, bh = lp.box.offsetHeight || LOUPE + 70, r = lp.box.getBoundingClientRect();
    if (!(mouse[0] >= r.left && mouse[0] <= r.right && mouse[1] >= r.top && mouse[1] <= r.bottom)) {
      const cs = [[m, m], [w - bw - m, m], [m, h - bh - m], [w - bw - m, h - bh - m]];
      let best = 0, bd = -1; cs.forEach((c, i) => { const d = Math.hypot(c[0] + bw / 2 - mouse[0], c[1] + bh / 2 - mouse[1]); if (d > bd) { bd = d; best = i; } });
      lp.box.style.left = `${cs[best][0]}px`; lp.box.style.top = `${cs[best][1]}px`;
    }
    const dpr = window.devicePixelRatio || 1, S = Math.round(LOUPE * dpr), z = loupeZoom, sw = LOUPE / z;
    if (lp.cv.width !== S) { lp.cv.width = lp.cv.height = S; lp.cv.style.width = lp.cv.style.height = `${LOUPE}px`; }
    const g2 = lpg; g2.setTransform(1, 0, 0, 1, 0, 0); g2.imageSmoothingEnabled = false; g2.fillStyle = '#000'; g2.fillRect(0, 0, S, S);
    g2.save();
    if (mirrored()) { g2.translate(S, 0); g2.scale(-1, 1); }
    g2.drawImage(video, p[0] - sw / 2, p[1] - sw / 2, sw, sw, 0, 0, S, S);
    if (z >= 8) {                                                      // (the pixels of the picture, faintly, when they are big enough to see)
      g2.strokeStyle = 'rgba(255, 255, 255, 0.14)'; g2.lineWidth = 1; g2.beginPath();
      const x0 = Math.floor(p[0] - sw / 2), y0 = Math.floor(p[1] - sw / 2);
      for (let i = 0; i <= sw + 1; i++) { const gx = (x0 + i - (p[0] - sw / 2)) * z * dpr, gy = (y0 + i - (p[1] - sw / 2)) * z * dpr; g2.moveTo(gx, 0); g2.lineTo(gx, S); g2.moveTo(0, gy); g2.lineTo(S, gy); }
      g2.stroke();
    }
    g2.restore();
    const c = S / 2, gap = 6 * dpr, arm = 22 * dpr;                     // the crosshair: the point is its middle
    for (const [col, wd] of [['#000', 3.5 * dpr], ['#ff4d6d', 1.5 * dpr]]) {
      g2.strokeStyle = col; g2.lineWidth = wd; g2.beginPath();
      g2.moveTo(c - arm, c); g2.lineTo(c - gap, c); g2.moveTo(c + gap, c); g2.lineTo(c + arm, c); g2.moveTo(c, c - arm); g2.lineTo(c, c - gap); g2.moveTo(c, c + gap); g2.lineTo(c, c + arm); g2.stroke();
    }
    lp.z4.classList.toggle('on', z === 4); lp.z8.classList.toggle('on', z === 8);
    lp.ok.disabled = !pend;
    lp.info.textContent = pend ? `x ${p[0].toFixed(2)}, y ${p[1].toFixed(2)}. Arrow keys move the point (a pixel; Shift: a quarter). Enter or Accept keeps it, Esc gives it up.` : 'Click to put the point down; then fine-tune it with the arrow keys.';
  }
  el.start.addEventListener('click', () => start(el.device.value || undefined));
  el.device.addEventListener('change', () => start(el.device.value));
  el.spots.forEach((b, i) => b.addEventListener('click', () => { task = { kind: 'spot', i }; layout(); }));
  el.fovBtn.addEventListener('click', () => { if (auto && !auto.finished) { stopAuto(); layout(); } else startAuto(); });
  el.fovClick.addEventListener('click', () => { stopAuto(); task = { kind: 'fov', pts: [] }; layout(); });
  el.fovReset.addEventListener('click', () => { stopAuto(); calib.clearFov(); fovToProfile(); });
  el.fov.addEventListener('change', () => { calib.setFov(+el.fov.value); fovToProfile(); });
  el.clear.addEventListener('click', () => calib.clearClicks());

  // ---- how big sheet 4 is shown (the two 100 mm bars as measured on the screen: webcamcal.js sheetBars): for a sheet shown on a phone instead of printed
  const barsChanged = () => {
    calib.setSheetBars(el.barH.value, el.barV.value);
    if (auto && !auto.finished) { say('The sheet size changed: measuring starts again'); startAuto(); }
  };
  el.barH.addEventListener('change', barsChanged); el.barV.addEventListener('change', barsChanged);
  el.barReset.addEventListener('click', () => { el.barH.value = ''; el.barV.value = ''; barsChanged(); });
  function refreshBars() {
    const b = calib.sheetBars();
    if (document.activeElement !== el.barH) el.barH.value = b.h === null ? '' : String(b.h);
    if (document.activeElement !== el.barV) el.barV.value = b.v === null ? '' : String(b.v);
  }

  // ---- the dropdown of camera profiles (webcamcal.js: profiles, saveProfile, renameProfile, deleteProfile, useProfile): a field of view, a lens and a latency under one name,
  // kept in this browser, for every camera
  let libSig = '';
  const parts = (fovDeg, a1, a2, ms) => [fovDeg === null ? '' : `${fovDeg.toFixed(1)}\u00b0`, a1 === null || a2 === null ? '' : 'lens', ms === null ? '' : `${Math.round(ms)} ms`].filter(Boolean).join(' \u00b7 ');
  function refreshLib() {
    const lib = calib.profiles(), measured = calib.fovMeasured || calib.lensMeasured || calib.latencyMeasured;
    const sig = JSON.stringify([lib, calib.profileId, measured, +calib.fovDeg.toFixed(2), calib.a1, calib.a2, calib.latencyMs]);
    if (sig === libSig) return;
    libSig = sig;
    const sel = el.fovSel; sel.innerHTML = '';
    const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
    add('', `Assumed ${NS.webcamcal.DEF_FOV} degrees, no lens, no latency`);
    for (const e of lib) add(e.id, `${e.name} \u00b7 ${parts(e.fovDeg, e.a1, e.a2, e.latencyMs)}`);
    const current = calib.profileId && lib.some((e) => e.id === calib.profileId) ? calib.profileId : measured ? '__cur' : '';
    if (current === '__cur') add('__cur', `Measured or typed \u00b7 ${parts(calib.fovDeg, calib.lensMeasured ? calib.a1 : null, calib.lensMeasured ? calib.a2 : null, calib.latencyMs)} (not saved)`);
    sel.value = current;
  }
  el.fovSel.addEventListener('change', () => {
    const v = el.fovSel.value;
    if (v === '__cur') return;
    stopAuto();
    if (v === '') { calib.clearFov(); calib.clearLens(); calib.clearLatency(); } else if (!calib.useProfile(v)) say('That profile is gone');
    libSig = '';
  });
  el.alt.addEventListener('click', () => { const r = calib.result(getSpots()); if (r.ok && r.alts) calib.setChoice((r.choice + 1) % (r.alts + 1)); });

  // the markers over the picture: a ring where the spot was clicked, a cross where the solved camera puts it
  function draw(r, spots) {
    g.clearRect(0, 0, pickCv.width, pickCv.height);
    const k = pickCv.width / 640;
    for (let i = 0; i < 3 && marksOn(); i++) {
      const c = calib.clicks[i]; if (!c) continue;
      g.strokeStyle = COLOURS[i]; g.fillStyle = COLOURS[i]; g.lineWidth = 2 * k;
      g.beginPath(); g.arc(c[0], c[1], 9 * k, 0, 2 * Math.PI); g.stroke();
      g.font = `${14 * k}px sans-serif`; txt(String(i + 1), c[0] + 12 * k, c[1] - 10 * k);
      if (r.ok && spots && spots.pts[i]) {
        const q0 = WC.project(r.cam, calib.fovDeg * D2R, calib.W, calib.H, spots.pts[i]), q = q0[2] > 0 ? bend(q0).concat([q0[2]]) : q0;
        if (q[2] > 0) { g.beginPath(); g.moveTo(q[0] - 8 * k, q[1]); g.lineTo(q[0] + 8 * k, q[1]); g.moveTo(q[0], q[1] - 8 * k); g.lineTo(q[0], q[1] + 8 * k); g.stroke(); }
      }
    }
    if (pend && task && marksOn()) {                                   // the point that is waiting to be accepted (hidden with the marks too)
      g.strokeStyle = '#ffffff'; g.lineWidth = 2 * k; g.beginPath(); g.arc(pend[0], pend[1], 9 * k, 0, 2 * Math.PI); g.moveTo(pend[0] - 14 * k, pend[1]); g.lineTo(pend[0] + 14 * k, pend[1]); g.moveTo(pend[0], pend[1] - 14 * k); g.lineTo(pend[0], pend[1] + 14 * k); g.stroke();
    }
    if (auto && !auto.finished) drawGuide(k);
    if (task && task.kind === 'fov') {
      g.strokeStyle = '#ff6b81'; g.fillStyle = '#ff6b81'; g.lineWidth = 2 * k;
      task.pts.forEach((p, i) => { g.beginPath(); g.arc(p[0], p[1], 7 * k, 0, 2 * Math.PI); g.stroke(); g.font = `${14 * k}px sans-serif`; txt(String(i + 1), p[0] + 10 * k, p[1] - 8 * k); });
    }
  }

  // while measuring: the markers the detector sees (green), where to put the sheet next (a yellow outline), and how long it has been still (a bar)
  function drawGuide(k) {
    const st = auto.status; if (!st) return;
    const poly = (P, close = true) => { g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (close) g.closePath(); g.stroke(); };
    const settling = st.state === 'settling' && st.progress > 0;
    if (st.next && !settling) {
      g.save(); g.setLineDash([9 * k, 6 * k]); g.lineWidth = 2.5 * k; g.strokeStyle = '#ffd24a'; g.fillStyle = '#ffd24a';
      const out = st.next.outline.map(bend);
      poly(out); g.lineWidth = 1.5 * k; for (const sl of st.next.slots) poly(sl.map(bend));
      g.setLineDash([]); g.font = `bold ${15 * k}px sans-serif`; txt(`${st.next.n}`, out[0][0] + 6 * k, out[0][1] + 18 * k);
      g.restore();
    }
    g.save(); g.lineWidth = 2.5 * k; g.strokeStyle = '#4cd964'; g.fillStyle = '#4cd964'; g.font = `bold ${13 * k}px sans-serif`;
    for (const m of auto.markers) { poly(m.corners); txt(String(m.id + 1), m.corners[0][0] - 2 * k, m.corners[0][1] - 5 * k); }
    g.restore();
    const bw = pickCv.width * 0.34, bx = (pickCv.width - bw) / 2, by = pickCv.height - 26 * k;
    g.save(); g.lineWidth = 1.5 * k; g.strokeStyle = '#fff'; g.strokeRect(bx, by, bw, 9 * k);
    const fw = bw * (st.state === 'taken' ? 1 : st.progress);
    g.fillStyle = st.state === 'taken' ? '#4cd964' : '#ffd24a'; g.fillRect(mirrored() ? bx + bw - fw : bx, by, fw, 9 * k);                  // (it fills from the left of the screen, mirrored or not)
    g.font = `${13 * k}px sans-serif`; g.fillStyle = '#fff'; g.textAlign = 'center'; txt(st.msg, pickCv.width / 2, by - 8 * k); g.restore();
  }

  function describe(r) {
    const lines = [];
    lines.push(running() ? `Camera: ${calib.W} x ${calib.H}` : 'Camera: not running. Press Start camera.');
    lines.push(calib.profileName ? `Field of view: ${calib.fovDeg.toFixed(1)} degrees (profile "${calib.profileName}")`
      : calib.fovMeasured ? `Field of view: ${calib.fovDeg.toFixed(1)} degrees (measured, ${calib.shots.length} ${calib.shots.length === 1 ? 'shot' : 'shots'})`
      : `Field of view: ${calib.fovDeg.toFixed(1)} degrees (assumed: measure it with sheet 4)`);
    lines.push(calib.lensMeasured ? `Lens: a1 ${calib.a1.toFixed(3)}, a2 ${calib.a2.toFixed(3)} (measured: the overlay is bent to match)` : 'Lens: not measured (the overlay is drawn without distortion)');
    lines.push(calib.latencyMeasured ? `Latency: ${Math.round(calib.latencyMs)} ms (measured)` : 'Latency: not measured (the address says, else 60 ms)');
    if (calib.sheetBars().h !== null || calib.sheetBars().v !== null) { const s = calib.sheetScale; lines.push(`Sheet shown at ${(s.sx * 100).toFixed(0)} % across and ${(s.sy * 100).toFixed(0)} % down`); }
    if (auto) {
      const st = auto.status, c = auto.cap;
      if (auto.finished) lines.push(`Field of view measured: ${calib.fovDeg.toFixed(1)} degrees from ${c.shots.length} shots (they differ by ${c.spread.toFixed(1)} degrees). Press Measure field of view to do it again.`);
      else {
        lines.push(`Measuring the field of view: ${st.msg}`);
        lines.push(`Markers seen: ${st.seen.length} of 4. Shots: ${st.shots}${st.fovDeg ? ` (${st.fovDeg.toFixed(1)} degrees so far)` : ''}. Press Measure field of view again to stop.`);
        if (st.next) lines.push(`Next, place ${st.next.n} of ${st.next.of}: ${st.next.text} (the sheet about ${Math.round(st.next.dist * 100)} cm from the lens)`);
      }
    }
    if (task) lines.push((task.kind === 'spot' ? `Click ${NAMES[task.i]} in the picture` : `Click the centre of square ${task.pts.length + 1} of sheet 4`) + (pend ? '. Now fine-tune it with the arrow keys, watching the zoomed box (Shift: smaller steps), and press Accept or Enter (Esc gives it up)' : ' (the zoomed box shows the place under the mouse; Esc cancels)'));
    else if (!running()) { /* nothing more to say yet */ }
    else if (r.ok) {
      lines.push(`The camera is at x ${r.cam.x.toFixed(2)}, y ${r.cam.y.toFixed(2)} m, ${r.cam.z.toFixed(2)} m up. Clicks are off by ${r.rms.toFixed(1)} px (rings: clicked, crosses: where the camera puts the spots)`);
      if (r.alts) lines.push(`Another place fits almost as well: if the picture is wrong, press Other fit (${r.choice + 1} of ${r.alts + 1})`);
    } else lines.push(r.why);
    return lines.join('\n');
  }

  function update() {
    if (!on) return;
    calSync();
    const spots = getSpots(), r = calib.result(spots);
    const t = describe(r);
    if (t !== text) { text = t; el.status.textContent = t; }
    if (document.activeElement !== el.fov) el.fov.value = calib.fovDeg.toFixed(1);
    refreshLib();
    refreshBars();
    el.alt.disabled = !(r.ok && r.alts);
    if (!task) { pend = null; hover = null; }
    if (running()) draw(r, spots);
    drawLoupe();
  }

  function show(v) {
    on = !!v;
    if (!on) { task = null; stopAuto(); closeCalibration(); }
    layout();
    window.dispatchEvent(new Event('resize'));
  }
  return { show, update, pose, start, useStill, stop, openCalibration, closeCalibration, get calibration() { return cal; }, get screenLog() { return screenLog; }, get calBoard() { return bd ? bd.board : null; }, get running() { return running(); }, get measuring() { return !!auto && !auto.finished; }, get capture() { return auto ? auto.cap : null; }, get task() { return task; } };
}

// The ENGINE's own menu, on the inside of the left wrist: what every MUMR app has, apart from the app's own menu (Marek, 2026-10-22: "parts
// of the menu are engine-essential ... a wrist based popup that minimizes into a wrist button"). No THREE and no DOM. Its look and its
// feel are docs/WRIST-MENU-SPEC.md (drawn by xr/panel3d.js, pressed by menus.js Poke).
//
//   folded    a 2 x 2 cm button with the logo, shown while the inside of the wrist looks at you
//   open      a 22 cm card of six fixed places (two columns, rows of 3 cm) under a 2 x 2 cm arrow that floats above it and folds it:
//             Home: Line up, Room setup, Exit (Exit asks again: Exit now, Stay)
//             Line up: Spot 1, Spot 2, Check spot, Room (upload), Cameras (when a webcam page has aligned one), Done; poking a
//             spot opens its menu: Lock, Replace, Delete, Back; Cameras opens the camera menu (Marek, 2026-10-31): which camera the knobs
//             are for (Camera 1 of 2: a press takes the next), Place in front of me, Reset position, Back
//             the home menu (Home, nothing else open) folds by itself once it has been hidden for HIDDEN ms in a row (the hand turned away
//             from the face, or not tracked; Marek, 2026-10-22). Anything else that is open (lining up) never folds by itself
// Like every menu it is shared: it goes out in the `M` packet as panel 'wrist' with its state in info.sys, the other players see it on its
// owner's wrist and may press it, and a press acts for the owner (session.press). The app's own menu is separate (the app's layout).
//
//   const sys = new SysMenu(session, lineup, { exit, roomSetup, roomUsed, room, cams, camReset, camHere, life })     room: room.js Room (its Room row and button)
//                            cams() -> { count, list: [{ id, name, x, y, z, hand }] } (the real cameras; x y z to the centimetre); camReset(id), camHere(id):
//                            the buttons, for the chosen camera.   sys.camId(): the chosen camera's id (null: none), the one whose knobs hang
//   ACTIONS                  add them to the session's actions; press(id) from the 'action' listener -> true when it was one of ours
//   info()                   what another page needs to draw this menu: { open, lining, fields, lined, dist, note, spot, asking, players, ... }
//   SysMenu.layout(info)     the layout (like menus.grid, plus `card`, `wrist`, `folded`) for anybody's wrist menu; SysMenu.width(info): its width in metres
//   place(head, jp, floorY)  where it floats this frame (a panel pose), or null while the wrist does not look at you
(function (M) {
  const OWN = ['sysOpen', 'sysClose', 'exit', 'exitYes', 'exitNo', 'roomSetup', 'spot1', 'spot2', 'spot3', 'spotBack', 'spotLock', 'spotReplace', 'spotDelete', 'camMenu', 'camNext', 'camHere', 'camReset', 'camBack'];
  const OPEN_W = 0.22, FOLDED_W = 0.02, MAP_W = 0.32;
  const HIDDEN = 5000;          // ms hidden in a row before the open home menu folds (Marek: 10 s, then 5)
  const WRIST_SIDE = 'left';

  // The card in canvas pixels, 40 per cm (22 cm = 880 px): sizes from the spec
  const PX = 40, CARD_CM = 22, MARGIN = 0.5, GAP = 0.8, BTN_H = 3, HEAD = 1.2, ARROW = 2, ARROW_GAP = 0.8;
  const BTN_W = (CARD_CM - 2 * MARGIN - GAP) / 2;
  const TOP = ARROW + ARROW_GAP, CARD_H = MARGIN + HEAD + GAP + 3 * BTN_H + 2 * GAP + MARGIN;
  const LAY_W = CARD_CM * PX, LAY_H = (2 * TOP + CARD_H) * PX;     // (the same strip under the card as above it: the card stays in the middle)
  const slotX = (i) => (MARGIN + (i % 2) * (BTN_W + GAP)) * PX, slotY = (i) => (TOP + MARGIN + HEAD + GAP + Math.floor(i / 2) * (BTN_H + GAP)) * PX;

  // One screen of the open card. slots: up to six items, each { slot (0..5), id, label, value, active, off, span }; an item that is `off` or
  // has no id is a line of text, not a button (only what can be pressed now looks pressable). title/note: the line over the buttons.
  // level: how deep in the menu this screen is (Home 0, Line up and Exit asks again 1, a spot 2): a deeper screen slides in from the right, going back slides out to the left
  function card(title, note, slots, level) {
    const buttons = [{ id: 'sysClose', label: 'Fold', arrow: true, x: (LAY_W - ARROW * PX) / 2, y: 0, w: ARROW * PX, h: ARROW * PX, face: 'card', value: '', active: false, off: false }];
    for (const s of slots) {
      const w = (s.span === 2 ? 2 * BTN_W + GAP : BTN_W) * PX, text = !s.id || s.off;
      buttons.push({ id: text ? undefined : s.id, label: s.label, value: s.value || '', active: !!s.active, off: false, text, x: slotX(s.slot), y: slotY(s.slot), w, h: BTN_H * PX });
    }
    return { w: LAY_W, h: LAY_H, wrist: true, folded: false, level, title: { text: title, note: note || '', h: HEAD * PX, y: (TOP + MARGIN) * PX }, card: { x: 0, y: TOP * PX, w: LAY_W, h: CARD_H * PX }, buttons };
  }

  // the Room place of the line-up menu: the server's room (who uploaded it, when), and, with a scan on this headset, a button that uploads it once
  function roomSlot(r) {
    r = r || {};
    const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    if (r.own) return { slot: 3, id: 'supplyRoom', label: 'Upload room', value: r.kept ? `server has ${r.n} planes` : `none yet, own scan ${r.own} planes`, active: false };
    return { slot: 3, label: 'Room', value: r.kept ? `server's: ${r.n} planes${r.by === null || r.by === undefined ? '' : ` from player ${r.by + 1}`}${r.at ? ` at ${hm(r.at)}` : ''}` : 'no room' };
  }

  // the Cameras place of the line-up menu: the real cameras of the room (cams.js) that a webcam page has aligned; it opens the camera menu
  function camSlot(c) {
    if (!c || !c.count) return { slot: 4, label: 'Cameras', value: 'none aligned' };
    const k = c.list[c.sel] || c.list[0];
    return { slot: 4, id: 'camMenu', label: 'Cameras', value: c.count > 1 ? `${c.count}: ${k.name || 'Webcam'} chosen` : k.name || 'Webcam' };
  }
  // the camera menu: which camera the knobs are for, and what to do with it (the knobs hang only at the chosen one)
  function camCard(c) {
    const k = c && c.count ? c.list[c.sel] || c.list[0] : null;
    if (!k) return card('Cameras', 'none aligned', [{ slot: 4, id: 'camBack', label: 'Back' }], 2);
    return card(k.name || 'Webcam', `${k.x}, ${k.y}, ${k.z} m${k.hand ? ', placed by hand' : ''}`, [
      c.count > 1 ? { slot: 0, id: 'camNext', label: `Camera ${c.sel + 1} of ${c.count}`, value: 'next' } : { slot: 0, label: 'Camera 1 of 1', value: k.name || 'Webcam' },
      { slot: 1, id: 'camHere', label: 'Place in front of me', value: "at arm's length" },
      { slot: 2, id: 'camReset', label: 'Reset position', value: k.hand ? 'where it was put' : 'where its clicks put it' },
      { slot: 4, id: 'camBack', label: 'Back' }], 2);
  }

  // The room picker (room.js: a scan with more than one room): a map of the rooms' floors, seen from above with the front of the headset
  // up when the scan was made; each room is a button (pick it or leave it), and Cancel / Import under the map
  function roomMap(ch) {
    const W = 768, MAP = { x: 14, y: 74, w: 740, h: 440 }, pts = ch.rooms.flatMap((r) => r.poly);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sc = 0.92 * Math.min(MAP.w / Math.max(0.5, x1 - x0), MAP.h / Math.max(0.5, y1 - y0)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const X = (x) => MAP.x + MAP.w / 2 + (x - mx) * sc, Y = (y) => MAP.y + MAP.h / 2 - (y - my) * sc;
    const shapes = ch.rooms.map((r) => ({ pts: r.poly.map((q) => [X(q[0]), Y(q[1])]), colour: r.picked ? '#111111' : '#888888', fill: r.picked ? 'rgba(17,17,17,0.18)' : 'rgba(255,255,255,0.35)' }));
    const buttons = ch.rooms.map((r) => {
      const px = r.poly.map((q) => X(q[0])), py = r.poly.map((q) => Y(q[1]));
      let bx = Math.min(...px), by = Math.min(...py), bw = Math.max(...px) - bx, bh = Math.max(...py) - by;
      if (bw < 130) { bx -= (130 - bw) / 2; bw = 130; }
      if (bh < 70) { by -= (70 - bh) / 2; bh = 70; }
      return { id: `roomPick${r.k + 1}`, label: `Room ${r.k + 1}${r.here ? ' (you)' : ''}`, value: `${r.w} x ${r.d} m`, x: bx, y: by, w: bw, h: bh, active: r.picked, off: false, ghost: true };
    });
    // (a press goes to the first button under the fingertip: the smallest room first, so a room inside a bigger one can still be picked)
    buttons.sort((a, b) => a.w * a.h - b.w * b.h);
    const n = ch.rooms.filter((r) => r.picked).length, by = MAP.y + MAP.h + 14, bh = 84;
    buttons.push({ id: 'roomCancel', label: 'Cancel', value: '', x: 14, y: by, w: 240, h: bh, active: false, off: false },
      { id: 'roomImport', label: 'Import', value: `${n} of ${ch.rooms.length} rooms`, x: 268, y: by, w: 486, h: bh, active: n > 0, off: n === 0 });
    return { w: W, h: by + bh + 14, title: { text: 'Import rooms', note: 'press a room to pick it', h: 60 }, buttons, shapes };
  }

  class SysMenu {
    constructor(session, lineup, opts = {}) {
      this.session = session; this.lineup = lineup; this.opts = opts;
      this.open = false; this.shown = false; this.pose = null;
      this.spot = null; this.asking = false;                    // the spot menu (0..2) and "Exit asks again" are open in it
      this.camOpen = false; this.camSel = null;                 // the camera menu is open; the chosen camera's id
      this.now = opts.now || M.util.nowMs; this.hiddenAt = null;
    }
    static get ACTIONS() { return OWN.concat(M.lineup.ACTIONS, M.room.ACTIONS); }
    // the open menu is the home menu (nothing else, such as lining up, is open in it): only that one folds by itself
    get home() { return this.open && !(this.lineup && this.lineup.active) && !(this.opts.room && this.opts.room.choice); }
    // the cameras, and the chosen one's place in the list (the first when none is chosen, or the chosen one went)
    _cams() {
      const c = this.opts.cams ? this.opts.cams() : null;
      if (!c || !c.list || !c.list.length) return { count: 0, list: [], sel: 0 };
      const i = Math.max(0, c.list.findIndex((k) => k.id === this.camSel));
      return { count: c.list.length, list: c.list, sel: i };
    }
    camId() { const c = this._cams(); return c.count ? c.list[c.sel].id : null; }
    _fold(why) { this.open = false; this.spot = null; this.asking = false; this.camOpen = false; this.hiddenAt = null; if (this.opts.life) this.opts.life(`wrist menu folded: ${why}`); }
    // hidden this frame: the open home menu folds once it has been hidden for HIDDEN ms in a row
    _hidden(why) {
      this.shown = false; this.pose = null;
      if (!this.home) { this.hiddenAt = null; return null; }
      if (this.hiddenAt === null) this.hiddenAt = this.now();
      else if (this.now() - this.hiddenAt >= HIDDEN) this._fold(`${why} for ${HIDDEN / 1000} s`);
      return null;
    }
    press(id) {
      if (id === 'sysOpen') { this.open = true; return true; }
      if (id === 'sysClose') { this.open = false; this.spot = null; this.asking = false; this.camOpen = false; return true; }
      if (id === 'exit') { this.asking = true; return true; }
      if (id === 'exitNo') { this.asking = false; return true; }
      if (id === 'exitYes') { this.asking = false; if (this.opts.exit) this.opts.exit(); return true; }
      if (id === 'roomSetup') { if (this.opts.roomSetup) this.opts.roomSetup(); return true; }
      if (id === 'camMenu') { if (this.lineup && this.lineup.active) { this.camOpen = true; this.spot = null; } return true; }
      if (id === 'camBack') { this.camOpen = false; return true; }
      if (id === 'camNext') { const c = this._cams(); if (c.count) this.camSel = c.list[(c.sel + 1) % c.count].id; return true; }
      if (id === 'camHere') { const k = this.camId(); if (k && this.opts.camHere) this.opts.camHere(k); return true; }
      if (id === 'camReset') { const k = this.camId(); if (k && this.opts.camReset) this.opts.camReset(k); return true; }
      const L = this.lineup, sp = /^spot([123])$/.exec(id);
      if (sp) { if (L && L.active) this.spot = +sp[1] - 1; return true; }
      if (id === 'spotBack') { this.spot = null; return true; }
      const act = { spotLock: 'lock', spotReplace: 'create', spotDelete: 'delete' }[id];
      if (act) { if (L && this.spot !== null) L.press(`p${this.spot + 1}${act}`); return true; }
      if (this.opts.room && this.opts.room.press(id)) { if (this.opts.room.choice) this.open = true; return true; }     // (the room picker must be seen)
      if (L && L.press(id)) { if (id === 'lineUp' && L.active) this.open = true; if (!L.active) { this.spot = null; this.camOpen = false; } return true; }      // (lining up: the fields must be seen)
      return false;
    }
    info() {
      const L = this.lineup, f = L ? L.frame : null, S = this.session;
      return { open: this.open, lining: !!(L && L.active), fields: L && L.active ? L.aligner.fields() : null, lined: !!f,
        dist: f && f.how !== 'given' ? +(f.dist || 0).toFixed(2) : null, note: L ? L.note() : '', roomUsed: !!this.opts.roomUsed && this.opts.roomUsed(),
        room: this.opts.room ? this.opts.room.info() : null, cam: this.opts.cams ? this._cams() : null, camOpen: !!(L && L.active && this.camOpen), spot: L && L.active ? this.spot : null, asking: this.asking, players: S && Number.isFinite(S.others) ? S.others + 1 : 1 };
    }
    static width(info) { return info && info.open ? (info.room && info.room.choice ? MAP_W : OPEN_W) : FOLDED_W; }
    static layout(info) {
      info = info || {};
      if (info.open && info.room && info.room.choice) return roomMap(info.room.choice);
      if (!info.open) return { w: ARROW * PX, h: ARROW * PX, wrist: true, folded: true, title: { text: '', note: '', h: 0, y: 0 }, card: null,
        buttons: [{ id: 'sysOpen', label: 'MUMR', logo: true, x: 0, y: 0, w: ARROW * PX, h: ARROW * PX, face: 'card', value: '', active: !!info.lining, off: false }] };
      if (info.asking) {
        return card('Leave mixed reality?', '', [{ slot: 0, label: 'This ends the session', value: 'for you only', span: 2 },
          { slot: 2, id: 'exitYes', label: 'Exit now' }, { slot: 5, id: 'exitNo', label: 'Stay' }], 1);
      }
      if (info.lining && info.camOpen) return camCard(info.cam);
      if (info.lining && info.spot !== null && info.spot !== undefined) {
        const k = info.spot, f = (info.fields || [])[k] || {}, name = k < 2 ? `Spot ${k + 1}` : 'Check spot';
        return card(name, M.lineup.stateText(f, k), [
          f.placed ? { slot: 0, id: 'spotLock', label: f.locked ? 'Unlock' : 'Lock', active: !!f.locked } : { slot: 0, label: 'Lock', value: 'not placed yet' },
          { slot: 1, id: 'spotReplace', label: f.armed ? 'Cancel' : f.placed ? 'Replace' : 'Create', active: !!f.armed, off: !!f.locked },
          f.placed && !f.locked ? { slot: 3, id: 'spotDelete', label: 'Delete' } : { slot: 3, label: 'Delete', value: f.locked ? 'locked' : 'not placed yet' },
          { slot: 4, id: 'spotBack', label: 'Back' }], 2);
      }
      if (info.lining) {
        const F = info.fields || [], st = (k) => M.lineup.stateText(F[k] || {}, k);
        return card('Line up', info.note || '', [
          { slot: 0, id: 'spot1', label: 'Spot 1', value: st(0), active: !!(F[0] && F[0].armed) },
          { slot: 1, id: 'spot2', label: 'Spot 2', value: st(1), active: !!(F[1] && F[1].armed) },
          info.lined ? { slot: 2, id: 'spot3', label: 'Check spot', value: st(2), active: !!(F[2] && F[2].armed) } : { slot: 2, label: 'Check spot', value: 'after spots 1 and 2' },
          roomSlot(info.room), camSlot(info.cam), { slot: 5, id: 'lineUp', label: 'Done' }], 1);
      }
      return card('MUMR', info.players > 1 ? `${info.players} players` : 'alone', [
        { slot: 0, id: 'lineUp', label: info.lined ? 'Lined up' : 'Line up', value: info.dist ? `${info.dist} m` : info.lined ? 'given' : 'not yet', active: !!info.lined },
        { slot: 1, id: 'roomSetup', label: 'Room setup', value: info.roomUsed ? 'restarts MR' : 'scan / edit' },
        { slot: 5, id: 'exit', label: 'Exit', value: 'asks again' }], 0);
    }
    // Where it is: a card lying on the inside of the left wrist and turning with it, as Nudgy's wrist card did (follow.js wristCard: a little up
    // the forearm, clear of the skin, its top the top for whoever looks at it); shown while that side of the wrist looks at you (with some slack,
    // so that it does not flicker at the edge). head: [x, y, heading, height above the floor, pitch]; jp: that hand's 25 joints
    // in XR space (null: the hand is not tracked). -> a panel pose { x, y, h (XR), q (its orientation in XR space) } or null
    place(head, jp, floorY) {
      if (!jp || !head) return this._hidden('the hand not tracked');
      const at = (i) => [jp[i * 3], jp[i * 3 + 1], jp[i * 3 + 2]];
      const cp = Math.cos(head[4] || 0), eye = [head[0], head[3] + floorY, -head[1]], fwd = [cp * Math.cos(head[2]), Math.sin(head[4] || 0), -cp * Math.sin(head[2])];
      const c = M.follow.wristCard({ wrist: at(0), index: at(6), middle: at(11), pinky: at(21) }, WRIST_SIDE, eye, fwd);
      if (!c) return this._hidden('the hand not tracked');
      const W = M.follow.WRIST;
      this.shown = c.dist < W.far && c.facing > (this.shown ? W.hide : W.show);
      if (!this.shown) return this._hidden('the hand turned away');
      this.hiddenAt = null;
      const p = c.pos;                                 // (open or folded, the card has its middle at the same point: it opens round the button)
      return (this.pose = { x: p[0], y: -p[2], h: p[1], yaw: 0, pitch: 0, q: M.align.quatFromBasis(c.right, c.up, c.normal) });
    }
  }

  M.sysmenu = { SysMenu, OPEN_W, FOLDED_W, WRIST_SIDE, HIDDEN, PX };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

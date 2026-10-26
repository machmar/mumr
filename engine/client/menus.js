// EVERYONE'S MENUS. A menu is a flat panel floating in the room, with buttons pressed by a fingertip going through them (no ray, no
// gesture: Nudgy rule). Every player sees every player's menus where their owners have them, and can press any button on any of them;
// a button acts for the menu's owner (session.press). No THREE and no DOM: the drawing is xr/panel3d.js.
//
//   grid(spec)           a layout of buttons in rows, on a canvas of spec.w pixels: { w, h, title, buttons: [{ id, label, value, active,
//                        off, x, y, w, h }] }. A cell without an id is text, not a button.
//   hit(lay, u, v)       the button at (u, v) (0..1 from the top left), or null
//   axes(pose)           a panel pose { x, y (floor plan), h (XR height), yaw (the way it faces), pitch (how far it leans back) } as XR
//                        vectors: pos, right, up, normal (out of its front) and ry (its turn about XR Y). THREE uses the same numbers.
//   shape(held, d)       how far a button is down and the menu pushed back, for a fingertip d metres past the surface
//   Poke                 fingertips through panels -> presses, releases, which buttons are touched (and how deep), and which panels have a hand at them
//   Menus                this page's panels out (the `M` packet, ten a second, common frame) and the other players' in
(function (M) {
  const PAD = 14, TITLE_H = 60, ROW_H = 96;

  // spec: { w (px, 1024), titleH (px, 60; 0: no title bar), rowH (px, 96), title, top: [{ id, label, active }] (buttons in the title bar, from the right), rows: [[{ id, label, value,
  // active, off, span, plate, sub }]] }
  // A cell may be a `plate` (no id: drawn like a button, but not one) with `sub` buttons inside it, from the left, at its right edge: [{ id, label, off }]
  // (a count with - and + in it). They are small, drawn centred, and the plate's text keeps clear of them (`inset`).
  function grid(spec) {
    const W = spec.w || 1024, rows = spec.rows || [], rowH = spec.rowH || ROW_H, TH = spec.titleH === undefined ? TITLE_H : spec.titleH;
    const H = TH + rows.length * (rowH + PAD) + PAD, buttons = [];
    let x = W - PAD;
    for (const b of (spec.top || [])) {
      const bw = b.w || 200;
      x -= bw;
      buttons.push(Object.assign({ value: '', active: false, off: false, top: true }, b, { x, y: 8, w: bw, h: TH - 16 }));
      x -= PAD;
    }
    rows.forEach((row, r) => {
      const units = row.reduce((a, c) => a + (c.span || 1), 0), unit = (W - PAD * (units + 1)) / units;
      let cx = PAD;
      for (const c of row) {
        const cw = unit * (c.span || 1) + PAD * ((c.span || 1) - 1);
        const cy = TH + PAD / 2 + r * (rowH + PAD), subs = c.sub || [], sh = Math.round(rowH * 0.62), sw = Math.round(sh * 1.25), SG = 10;
        const inset = subs.length ? subs.length * sw + (subs.length - 1) * SG + PAD + SG : 0;
        const cell = Object.assign({ value: '', active: false, off: false }, c, { x: cx, y: cy, w: cw, h: rowH });
        delete cell.sub; if (inset) cell.inset = inset;
        buttons.push(cell);
        subs.forEach((s, i) => buttons.push(Object.assign({ value: '', active: false, off: false, center: true, small: true }, s, { x: cx + cw - PAD - (subs.length - i) * sw - (subs.length - 1 - i) * SG, y: cy + (rowH - sh) / 2, w: sw, h: sh })));
        cx += cw + PAD;
      }
    });
    return { w: W, h: H, title: { text: spec.title || '', note: spec.note || '', h: TH }, buttons };
  }
  function hit(lay, u, v) {
    if (!lay || u < 0 || u > 1 || v < 0 || v > 1) return null;
    const x = u * lay.w, y = v * lay.h;
    for (const b of lay.buttons) if (b.id && !b.off && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    return null;
  }

  // A pose may instead carry `q`, an XR orientation [x, y, z, w] (a card on a wrist turns with the wrist): then yaw and pitch are not used.
  function axes(p) {
    if (p.q) { const A = M.align; return { pos: [p.x, p.h, -p.y], right: A.quatApply(p.q, [1, 0, 0]), up: A.quatApply(p.q, [0, 1, 0]), normal: A.quatApply(p.q, [0, 0, 1]), q: p.q }; }
    const ry = Math.atan2(Math.cos(p.yaw), -Math.sin(p.yaw)), sp = Math.sin(p.pitch || 0), cp = Math.cos(p.pitch || 0), sr = Math.sin(ry), cr = Math.cos(ry);
    return { pos: [p.x, p.h, -p.y], right: [cr, 0, -sr], up: [-sr * sp, cp, -cr * sp], normal: [sr * cp, sp, cr * cp], ry, pitch: p.pitch || 0 };
  }
  // How far an XR point is from the handle under a panel (a bar HALF either side of the middle, GAP below the bottom edge): metres
  function handleDist(pose, h, p, gap = 0.035, half = 0.07) {
    const A = axes(pose), c = [0, 1, 2].map((i) => A.pos[i] - A.up[i] * (h / 2 + gap)), d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const along = d[0] * A.right[0] + d[1] * A.right[1] + d[2] * A.right[2], k = Math.max(-half, Math.min(half, along));
    return Math.hypot(d[0] - A.right[0] * k, d[1] - A.right[1] * k, d[2] - A.right[2] * k);
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // How deep a button is pressed and how far the whole menu gives way, for a fingertip `d` metres past the menu surface (negative: in front of
  // it). Rigid blocks only (docs/WRIST-MENU-SPEC.md, "A press"): near, a button stands up 4 mm; held (pressed at 1 cm), it is down 1 cm at least,
  // follows the fingertip to 2.5 cm and stops there; each extra cm of push moves the whole menu back 1 mm. -> { top, push } in metres (top: the
  // button's face along the menu normal, + out of the surface; push: the menu moved back)
  const LIFT = 0.004, PRESS = 0.01, LIMIT = 0.025, PUSH_PER = 0.1;
  function shape(held, d) {
    if (!held) return { top: LIFT, push: 0 };
    return { top: -Math.min(LIMIT, Math.max(PRESS, d)), push: Math.max(0, d - LIMIT) * PUSH_PER };
  }

  // Where a button's middle is in XR space and how big it is (cm²), for a panel { pose, w, h, lay }: where its click comes from
  function buttonAt(pn, id) {
    const b = pn.lay.buttons.find((x) => x.id === id);
    if (!b) return null;
    const A = axes(pn.pose), lx = ((b.x + b.w / 2) / pn.lay.w - 0.5) * pn.w, ly = (0.5 - (b.y + b.h / 2) / pn.lay.h) * pn.h;
    return { pos: [0, 1, 2].map((i) => A.pos[i] + A.right[i] * lx + A.up[i] * ly), cm2: (b.w * pn.w / pn.lay.w * 100) * (b.h * pn.h / pn.lay.h * 100) };
  }

  // Fingertips through panels (docs/WRIST-MENU-SPEC.md, "A press"). A button is armed by a tip above it, in front of the menu and within 6 cm; the
  // press is that tip reaching 1 cm into the surface over the same button, once, on the way down. The button stays held (no other button can be
  // pressed, by any hand) until the tip is back up at the surface, or 7 cm to the side of it: then it lets go and activates nothing. A tip that
  // comes in from the side or from behind arms nothing, and neither does coming back after letting go.
  class Poke {
    constructor(cfg = {}) { this.cfg = Object.assign({ depth: 0.08, hover: 0.06, busy: 0.25, press: PRESS, side: 0.07, through: 0.5 }, cfg); this.tips = new Map(); }
    // panels: [{ key, owner, id, pose, w, h (metres), lay, ignore (a tip id that does not press it) }]; tips: [{ id, p: [x, y, z] (XR) }];
    // -> { presses, releases, hover, touches, busy (keys with a hand within 25 cm: a menu must not glide away from under it), at (keys with a
    //    fingertip at the card itself: within 5 cm of its face and over it, someone is using it) }
    //    presses / releases: [{ key, owner, panel, button, tip }] (a release only after a press; presses also have u, v)
    //    touches: [{ key, owner, panel, button, held, d (m past the surface), tip }] one per tip that is at a button now (near or held)
    update(panels, tips, nowMs) {
      const C = this.cfg, out = { presses: [], releases: [], hover: null, touches: [], busy: new Set(), at: new Set() };
      const byKey = new Map(), live = new Set(tips.map((t) => t.id));
      for (const pn of panels) byKey.set(pn.key, Object.assign({ A: axes(pn.pose) }, pn));
      const local = (pn, t) => { const d = sub(t.p, pn.A.pos); return { lx: dot(d, pn.A.right), ly: dot(d, pn.A.up), lz: dot(d, pn.A.normal) }; };
      const heldNow = () => { for (const s of this.tips.values()) if (s.held) return s.held; return null; };
      for (const t of tips) {
        const st = this.tips.get(t.id) || { armed: null, held: null }; this.tips.set(t.id, st);
        for (const pn of byKey.values()) {
          if (pn.ignore && pn.ignore === t.id) continue;          // (a menu on a wrist is not pressed by the fingers of that hand)
          const q = local(pn, t);
          if (Math.abs(q.lz) < C.busy && Math.abs(q.lx) < pn.w / 2 + 0.15 && Math.abs(q.ly) < pn.h / 2 + 0.15) out.busy.add(pn.key);
          if (Math.abs(q.lz) < 0.05 && Math.abs(q.lx) < pn.w / 2 + 0.02 && Math.abs(q.ly) < pn.h / 2 + 0.02) out.at.add(pn.key);
        }
        const rec = (h) => ({ key: h.key, owner: h.owner, panel: h.panel, button: h.button, tip: t.id });
        if (st.held) {                                              // a button is held by this tip: it stays until the tip is up again or aside
          const h = st.held, pn = byKey.get(h.key), b = pn && pn.lay.buttons.find((x) => x.id === h.button);
          const q = pn && b ? local(pn, t) : null, d = q ? -q.lz : 0;
          let gone = !q || q.lz >= 0 || d > C.through;
          if (q) {
            const kx = pn.w / pn.lay.w, ky = pn.h / pn.lay.h, cx = (b.x + b.w / 2) * kx - pn.w / 2, cy = pn.h / 2 - (b.y + b.h / 2) * ky;
            gone = gone || Math.hypot(Math.max(0, Math.abs(q.lx - cx) - b.w * kx / 2), Math.max(0, Math.abs(q.ly - cy) - b.h * ky / 2)) > C.side;
          }
          if (gone) { out.releases.push(rec(h)); st.held = null; st.armed = null; } else { out.touches.push(Object.assign(rec(h), { held: true, d })); continue; }
        }
        let best = null;                                            // the button under the tip: of the nearest panel
        for (const pn of byKey.values()) {
          if (pn.ignore && pn.ignore === t.id) continue;
          const q = local(pn, t);
          if (Math.abs(q.lx) > pn.w / 2 || Math.abs(q.ly) > pn.h / 2 || q.lz > C.hover || q.lz < -C.depth) continue;
          const u = q.lx / pn.w + 0.5, v = 0.5 - q.ly / pn.h, id = hit(pn.lay, u, v);
          if (id && (!best || Math.abs(q.lz) < Math.abs(best.lz))) best = { pn, id, u, v, lz: q.lz };
        }
        if (!best) { st.armed = null; continue; }
        const { pn, id } = best, same = st.armed && st.armed.key === pn.key && st.armed.button === id, other = heldNow();
        if (best.lz > 0) st.armed = { key: pn.key, button: id };
        else if (!same) continue;                                   // (in from the side or from behind: nothing)
        const tc = { key: pn.key, owner: pn.owner, panel: pn.id, button: id, held: false, d: -best.lz, tip: t.id };
        if (other) { st.armed = null; continue; }                   // (another button is held: this one does nothing)
        if (-best.lz >= C.press) {
          st.held = { key: pn.key, owner: pn.owner, panel: pn.id, button: id }; st.armed = null; tc.held = true;
          out.presses.push({ key: pn.key, owner: pn.owner, panel: pn.id, button: id, u: best.u, v: best.v, tip: t.id });
        }
        out.touches.push(tc);
        if (!out.hover) out.hover = { key: pn.key, owner: pn.owner, button: id };
      }
      for (const [k, st] of [...this.tips]) if (!live.has(k)) { if (st.held) out.releases.push({ key: st.held.key, owner: st.held.owner, panel: st.held.panel, button: st.held.button, tip: k }); this.tips.delete(k); }
      return out;
    }
  }

  // The panels of every player. send() puts this page's panel poses (XR heights) out as `M`, in the common frame, with `info`: what
  // the app needs to draw this menu for others (its mode: lining up or not, the fields ...; Nudgy M4: the other player's menu must be
  // drawn from THAT player's state and mode). receive() takes the others'; others() gives them in this page's own coordinates.
  class Menus {
    constructor(session, space, opts = {}) {
      this.session = session; this.space = space; this.every = opts.every || 100; this.fresh = opts.fresh || 1500;
      this.known = opts.known || (() => true);
      this.guard = new M.wire.Guard(); this.peers = new Map(); this._sentAt = -1e9;
      this.stats = { sent: 0, got: 0 };
      session.on('peer', (slot, on) => { if (!on) { this.peers.delete(slot); this.guard.forget(slot); } });
      session.on('leave', () => this.peers.clear());
    }
    // panels: [{ id, pose: { x, y, h, yaw, pitch } }] on the floor plan, h in XR space
    send(nowMs, panels, info) {
      const S = this.session, sp = this.space;
      if (!sp.ok || !S.sending() || nowMs - this._sentAt < this.every) return false;
      this._sentAt = nowMs;
      const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 1e4) / 1e4;
      // a row: [id, x, y, h, yaw, pitch], or [id, x, y, h, qx, qy, qz, qw] for a pose with an orientation (a wrist card)
      const rows = (panels || []).map((p) => {
        const c = sp.poseToCommon({ x: p.pose.x, y: p.pose.y, yaw: p.pose.yaw || 0, h: p.pose.h - sp.floorY });
        if (p.pose.q) return [p.id, r3(c.x), r3(c.y), r3(c.h)].concat(sp.quatToCommon(p.pose.q).map(r4));
        return [p.id, r3(c.x), r3(c.y), r3(c.h), r4(c.yaw), r4(p.pose.pitch || 0)];
      });
      const ok = S.link.sendBin(M.wire.encode('menus', { panels: rows, info: info || null }, nowMs));
      if (ok) this.stats.sent++;
      return !!ok;
    }
    receive(p, nowMs) {
      if (!p || p.name !== 'menus' || !Array.isArray(p.data.panels)) return false;
      if (!this.guard.fresh(p.type, p.slot, p.clock)) return false;
      this.peers.set(p.slot, { at: nowMs, rows: p.data.panels.slice(0, 16), info: p.data.info && typeof p.data.info === 'object' ? p.data.info : null });
      this.stats.got++;
      return true;
    }
    // [{ slot, info, panels: [{ id, pose }] }] in this page's own coordinates (floor plan, XR heights)
    others(nowMs) {
      const S = this.session, sp = this.space, out = [];
      if (!sp.ok) return out;
      for (const [slot, m] of this.peers) {
        if (nowMs - m.at > this.fresh || !S.lined(slot)) continue;
        const panels = [];
        for (const r of m.rows) {
          if (!Array.isArray(r) || r.length < 6 || typeof r[0] !== 'string' || !r.slice(1, 6).every(Number.isFinite) || !this.known(r[0])) continue;
          if (r.length >= 8 && r.slice(4, 8).every(Number.isFinite)) {
            const o = sp.poseFromCommon({ x: r[1], y: r[2], h: r[3], yaw: 0 });
            panels.push({ id: r[0], pose: { x: o.x, y: o.y, h: o.h + sp.floorY, yaw: 0, pitch: 0, q: sp.quatFromCommon(r.slice(4, 8)) } });
            continue;
          }
          const o = sp.poseFromCommon({ x: r[1], y: r[2], h: r[3], yaw: r[4] });
          panels.push({ id: r[0], pose: { x: o.x, y: o.y, h: o.h + sp.floorY, yaw: o.yaw, pitch: r[5] } });
        }
        out.push({ slot, info: m.info, panels });
      }
      return out;
    }
  }

  M.menus = { grid, hit, axes, handleDist, shape, buttonAt, Poke, Menus, TITLE_H, PAD, LIFT, PRESS, LIMIT };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

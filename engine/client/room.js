// THE ROOM: the planes a headset found (its room scan: floor, walls, tables, ...), kept by the server so that every player's world has the
// same room. No THREE and no DOM.
//
// The SERVER supplies the room (Marek, 2026-10-22): it keeps the last room it was given and every page uses that one. It is given a room
// only two ways: when it has none, the first lined-up headset that connects with a scan uploads its own (once); and the Upload button of
// the line-up menu's Room row ('supplyRoom', acts for the menu's owner) uploads that headset's scan, once, when pressed. Nothing else
// changes it: not a room setup, not a headset leaving, not a line-up moving. The room goes up in the common frame, so a headset must be
// lined up to upload. Alone, not lined up, or while the server has no room, a page uses its own scan.
// A scan may hold more than one room (Marek's held another room metres away, 2026-10-23): each room has its own floor (splitRooms).
// Then Upload first asks which rooms to import, on a map in the line-up menu (each room's floor; a press on a room picks it or leaves
// it, 'roomImport' uploads the picked ones, 'roomCancel' does not); the first upload to a server that has none takes the room this
// headset stands in (the largest when it stands in none).
//
//   const room = new Room(session, space, { life, say })
//   setScan(planes)       this headset's own scan, floor plan (fromXR); call it when it may have changed (it compares)
//   press(id)             ACTIONS: 'supplyRoom' uploads this headset's scan (or opens the room picker), 'roomPick1'..'roomPick8',
//                         'roomImport', 'roomCancel' -> true when it was one of them
//   update(nowMs, here)   every frame (the one upload to a server that has no room); here: [x, y] where this headset stands
//   local()               the room this page uses, in its floor plan: { planes: [{ l: label, v: vertical?, p: [[x, y, h], ...] }] } or null
//   info()                for the menus: { kept (the server has one), by (who uploaded it), at (when, ms), n (planes), own (planes here),
//                         choice (while picking rooms: { rooms: [{ k, w, d, n, here, picked, poly: the floor's outline }] }) }
// Planes: l the headset's label ('floor', 'wall', 'table', 'couch', 'door frame', ... or 'other'), v true for an upright plane, p the
// outline, x, y on the floor plan and h the height above the floor (this headset's, or in the common frame the common floor).
// For an app's physics: kind(plane), support(room, x, y, top), ceiling(room, x, y, bottom), pushOut(room, x, y, z0, z1, r, from),
// cast(room, from, dir, max) (what a pointing finger points at),
// walls(room), surfaces(room), blocks(room); splitRooms(room, here), pickRooms(room, rooms, picked).
//
// THE ROOM'S LIGHTS (Marek, 2026-10-28: a room may have a big ceiling light, harsh against a dimmed room): where the real lights on the ceiling
// are, so that an app can hang something over them (a paper shade) and light the room from there instead. One list for everybody, in the
// common frame (rule 1): the lamps of the scan (a plane labelled lamp or light up at the ceiling) and the ones a player marked, kept by the
// document (LIGHT_KIND): { k: 'rlight', id, a: [x, y], b: [x, y], h, w }, a strip from a to b w wide (a fluorescent tube, an LED batten) or,
// with a = b, a round fitting w across, at height h; { k: 'rlight', id, del: true } takes one away (a scan's too).
//   ceilingHeight(room) -> h               the ceiling (its plane, else the tops of the walls, else 2.5 m)
//   lights(room, marked) -> [{ id, a, b, h, w, len, round, from: 'scan' | 'mark' }]   marked: the document's rlights
//   aimUp(eye, tip, h) -> [x, y] | null    where the line from an eye through a fingertip meets the ceiling (null: not pointing up at it)
//   new LightMarker(): update(eye, sources, h, list, nowMs) -> { aim, drag, over, done }   marking with a hand: aim where the line from the eye
//     through the pinch meets the ceiling; a pinch there marks a round fitting, or takes away the light it is on; a pinch held and drawn along
//     the ceiling marks a strip from where it began to where it was let go (drag: { a, b } meanwhile). done: the event to emit, once.
(function (M) {
  const PICKS = 8, ACTIONS = ['supplyRoom', 'roomImport', 'roomCancel'].concat(Array.from({ length: PICKS }, (_, i) => `roomPick${i + 1}`));
  const r2 = (v) => Math.round(v * 100) / 100;            // (centimetres are enough for a room)

  // XR planes -> the floor plan. planes: [{ matrix (16, column-major: the plane's pose in the XR reference space), polygon: [{ x, z }] (in
  // the plane's own space), label, orientation ('horizontal' / 'vertical') }]; floorY: where this headset's floor is in XR space
  function fromXR(planes, floorY = 0) {
    const out = [];
    for (const pl of planes || []) {
      const m = pl.matrix, poly = pl.polygon || [];
      if (!m || poly.length < 3) continue;
      const p = poly.map((q) => { const X = m[0] * q.x + m[8] * q.z + m[12], Y = m[1] * q.x + m[9] * q.z + m[13], Z = m[2] * q.x + m[10] * q.z + m[14]; return [r2(X), r2(-Z), r2(Y - floorY)]; });
      const v = pl.orientation ? pl.orientation === 'vertical' : Math.abs(m[5]) < 0.5;        // (the plane's normal is its local Y)
      out.push({ l: String(pl.label || 'other'), v, p });
    }
    return out.length ? { planes: out } : null;
  }
  // two scans are the same when they have the same planes (label, upright or not, as many corners) and no corner moved more than tol (m)
  function sameScan(a, b, tol = 0.03) {
    if (!a || !b) return a === b;
    if (a.planes.length !== b.planes.length) return false;
    return a.planes.every((p, i) => {
      const q = b.planes[i];
      return p.l === q.l && p.v === q.v && p.p.length === q.p.length && p.p.every((c, k) => Math.abs(c[0] - q.p[k][0]) <= tol && Math.abs(c[1] - q.p[k][1]) <= tol && Math.abs(c[2] - q.p[k][2]) <= tol);
    });
  }
  const mapRoom = (room, fn) => (room ? { planes: room.planes.map((q) => ({ l: q.l, v: q.v, p: q.p.map((pt) => fn(pt).map(r2)) })) } : null);

  class Room {
    constructor(session, space, opts = {}) {
      this.S = session; this.space = space; this.opts = opts;
      this.own = null;
      this.tried = false;                     // this connection has had its one look at whether the server needs a room
      this.choice = null;                     // { rooms, picked: Set } while the player picks which rooms to import
      this.here = null;                       // [x, y]: where this headset stands
      this._cache = { room: null, sig: null, out: null };
      session.on('join', () => { this.tried = false; });
      session.on('room', (r) => this._life(`room: the server's room is now ${r.data.planes.length} planes, uploaded by ${r.by === null ? 'a player' : `player ${r.by + 1}`}`));
    }
    static get ACTIONS() { return ACTIONS; }
    _life(t) { if (this.opts.life) this.opts.life(t); }
    _say(t) { if (this.opts.say) this.opts.say(t); }
    // (the headset's planes shift by a centimetre or so between two reads: that is the same scan, kept as it was. Taking every read as
    // new filled the log with thousands of "scan has 40 planes" lines, 2026-10-23)
    setScan(room) {
      if (sameScan(this.own, room)) return false;
      this.own = room;
      // (a plane that is refined while you look at it moves by more than a few centimetres every few seconds: only a new count is logged)
      const n = room ? room.planes.length : 0;
      if (n !== this.loggedPlanes) { this.loggedPlanes = n; this._life(`room: this headset's scan has ${n} planes`); }
      return true;
    }
    _upload(why, scan = this.own) {
      const S = this.S, sp = this.space;
      S.emit({ k: 'room', data: mapRoom(scan, (p) => sp.toCommon(p)), by: S.me, at: Date.now() });
      this._life(`room: uploaded this headset's scan (${scan.planes.length} planes): ${why}`);
    }
    // the room this headset stands in, else the largest
    _mine(rooms) { const h = rooms.findIndex((r) => r.here); return h >= 0 ? h : rooms.reduce((b, r, k) => (r.w * r.d > rooms[b].w * rooms[b].d ? k : b), 0); }
    press(id) {
      const S = this.S;
      if (id === 'supplyRoom') {
        if (!S.connected) this._say('Alone: the room is this headset\'s own');
        else if (!this.space.ok) this._say('Line up first: the room goes to the server in the common frame');
        else if (!this.own) this._say('This headset has no room scan (Room setup makes one)');
        else {
          const rooms = splitRooms(this.own, this.here);
          if (rooms.length < 2) { this._upload('the Upload button'); this._say('The server has this headset\'s room now'); }
          else { this.choice = { rooms: rooms.slice(0, PICKS), picked: new Set([this._mine(rooms)]) }; this._say(`The scan has ${rooms.length} rooms: pick the ones to import`); }
        }
        return true;
      }
      if (id === 'roomCancel') { this.choice = null; return true; }
      if (id === 'roomImport') {
        const c = this.choice;
        if (c && c.picked.size && this.space.ok) {
          this._upload(`the Upload button, rooms ${[...c.picked].map((k) => k + 1).join(', ')} of ${c.rooms.length}`, pickRooms(this.own, c.rooms, [...c.picked]));
          this._say(`The server has ${c.picked.size} of the ${c.rooms.length} rooms now`);
          this.choice = null;
        }
        return true;
      }
      const m = /^roomPick(\d+)$/.exec(id);
      if (m) {
        const k = +m[1] - 1, c = this.choice;
        if (c && k < c.rooms.length) { if (c.picked.has(k)) c.picked.delete(k); else c.picked.add(k); }
        return true;
      }
      return false;
    }
    update(now, here) {
      const S = this.S;
      if (here) this.here = here;
      if (this.tried || !S.connected || S.isViewer || !this.space.ok || !this.own) return;
      this.tried = true;
      if (S.doc.room) return;
      const rooms = splitRooms(this.own, this.here);
      if (rooms.length < 2) this._upload('the server had no room');
      else { const k = this._mine(rooms); this._upload(`the server had no room; room ${k + 1} of the scan's ${rooms.length}, where this headset is`, pickRooms(this.own, rooms, [k])); }
    }
    local() {
      const S = this.S, sp = this.space, d = S.doc.room;
      if (!S.connected || !sp.ok || !d) return this.own;
      const f = sp.frame, sig = `${f.x},${f.y},${f.yaw},${sp.fz || 0}`, c = this._cache;
      if (c.room !== d || c.sig !== sig) { c.room = d; c.sig = sig; c.out = mapRoom(d.data, (p) => sp.fromCommon(p)); }
      return c.out;
    }
    info() {
      const S = this.S, d = S.connected ? S.doc.room : null;
      const c = this.choice;
      return { kept: !!d, by: d ? d.by : null, at: d ? d.at : null, n: d ? d.data.planes.length : 0, own: this.own ? this.own.planes.length : 0,
        choice: c ? { rooms: c.rooms.map((r, k) => ({ k, w: r2(r.w), d: r2(r.d), n: r.planes.length, here: r.here, picked: c.picked.has(k), poly: r.floor.map((q) => q.map(r2)) })) } : null };
    }
  }

  // ---- for an app's physics (any room in one frame: local() for a page)
  // What a plane is to things that move (Marek, 2026-10-22: "tables have space under them ... storage and beds" are solid to the floor):
  //   floor, ceiling   level; the floor carries things, the ceiling does nothing
  //   table            a level top with space under it: a slab TABLE_T thick; things stand on it, pass under it, and hit its edge and underside
  //   solid            any other level surface higher than SOLID_MIN (bed, couch, storage, shelf, other ...): a block from the floor up to it
  //   wall             an upright plane: nothing passes it
  //   opening          a door or window frame, wall art: not an obstacle (a doorway is a way through)
  const TABLE_T = 0.04, SOLID_MIN = 0.05;
  function kind(pl) {
    const l = String(pl.l || '').toLowerCase();
    if (pl.v) return /door|window|opening|art/.test(l) ? 'opening' : 'wall';
    if (/floor/.test(l)) return 'floor';
    if (/ceiling/.test(l)) return 'ceiling';
    if (/table|desk/.test(l)) return 'table';
    const h = pl.p.reduce((a, q) => a + q[2], 0) / pl.p.length;
    return h > SOLID_MIN ? 'solid' : 'floor';
  }
  const prepped = new WeakMap();
  function prep(room) {
    let q = prepped.get(room);
    if (q) return q;
    q = { tops: [], walls: [], blocks: [] };
    for (const pl of room.planes) {
      const k = kind(pl);
      if (k === 'floor' || k === 'table' || k === 'solid') {
        const h = pl.p.reduce((a, p) => a + p[2], 0) / pl.p.length, xs = pl.p.map((p) => p[0]), ys = pl.p.map((p) => p[1]);
        const t = { h, pts: pl.p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), l: pl.l, k };
        q.tops.push(t);
        if (k === 'table') q.blocks.push(Object.assign({ lo: h - TABLE_T, hi: h }, t));
        if (k === 'solid') q.blocks.push(Object.assign({ lo: -1, hi: h }, t));
      } else if (k === 'wall') {
        let best = -1, a = pl.p[0], b = pl.p[0];          // its two ends on the floor plan: the two points furthest apart
        for (const p of pl.p) for (const o of pl.p) { const d = (p[0] - o[0]) ** 2 + (p[1] - o[1]) ** 2; if (d > best) { best = d; a = p; b = o; } }
        const hs = pl.p.map((p) => p[2]);
        if (best > 1e-4) q.walls.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], lo: Math.min(...hs), hi: Math.max(...hs), l: pl.l });
      }
    }
    prepped.set(room, q);
    return q;
  }
  function inside(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  const inBox = (t, x, y, m = 0) => x >= t.x0 - m && x <= t.x1 + m && y >= t.y0 - m && y <= t.y1 + m;
  // the nearest point of a polygon's edge to (x, y) -> [px, py, distance]
  function edge(pts, x, y) {
    let best = [x, y, Infinity];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best[2]) best = [px, py, d];
    }
    return best;
  }
  // the height of what (x, y) stands on: the highest level surface under it no higher than `top` (+ 2 cm), else 0 (the floor)
  function support(room, x, y, top = Infinity) {
    let h = 0;
    if (!room) return h;
    for (const t of prep(room).tops) if (t.h > h && t.h <= top + 0.02 && inBox(t, x, y) && inside(t.pts, x, y)) h = t.h;
    return h;
  }
  // the lowest underside of a table above (x, y) that is higher than `bottom` (a thing under the table hits it going up), or Infinity
  function ceiling(room, x, y, bottom) {
    let c = Infinity;
    if (!room) return c;
    for (const b of prep(room).blocks) if (b.k === 'table' && b.lo > bottom && b.lo < c && inBox(b, x, y) && inside(b.pts, x, y)) c = b.lo;
    return c;
  }
  // A round thing of radius r at (x, y), from height z0 to z1, kept out of the walls, the solid objects and the edges of table tops
  // -> { x, y, nx, ny } (n: the way it was pushed) or null. `from` ([x, y], where it was a moment ago) keeps it on its own side of a wall:
  // move in steps shorter than r and nothing ever goes through.
  function pushOut(room, x, y, z0, z1, r, from) {
    if (!room) return null;
    let nx = 0, ny = 0, moved = false;
    const Q = prep(room);
    for (const w of Q.walls) {
      if (z1 < w.lo || z0 > w.hi) continue;
      const dx = w.x1 - w.x0, dy = w.y1 - w.y0, L = Math.sqrt(dx * dx + dy * dy), t = Math.max(0, Math.min(1, ((x - w.x0) * dx + (y - w.y0) * dy) / (L * L)));
      const px = w.x0 + dx * t, py = w.y0 + dy * t, ex = x - px, ey = y - py, d = Math.hypot(ex, ey);
      if (d >= r) continue;
      let ux = d > 1e-6 ? ex / d : -dy / L, uy = d > 1e-6 ? ey / d : dx / L;
      if (from && t > 0 && t < 1) {                       // (the side it came from, whatever side the centre is on now)
        const side = (dx * (from[1] - w.y0) - dy * (from[0] - w.x0)) >= 0 ? 1 : -1;
        ux = -dy / L * side; uy = dx / L * side;
        const dd = ex * ux + ey * uy;                      // (signed: below 0 means it is past the wall)
        if (dd >= r) continue;
        x += ux * (r - dd); y += uy * (r - dd);
      } else { x += ux * (r - d); y += uy * (r - d); }
      nx += ux; ny += uy; moved = true;
    }
    for (const b of Q.blocks) {
      if (z1 <= b.lo + 1e-3 || z0 >= b.hi - 5e-3 || !inBox(b, x, y, r)) continue;
      const e = edge(b.pts, x, y), ins = inside(b.pts, x, y);
      if (!ins && e[2] >= r) continue;
      const ux0 = x - e[0], uy0 = y - e[1], l = Math.hypot(ux0, uy0) || 1, ux = (ins ? -ux0 : ux0) / l, uy = (ins ? -uy0 : uy0) / l, go = ins ? r + e[2] : r - e[2];
      x += ux * go; y += uy * go; nx += ux; ny += uy; moved = true;
    }
    if (!moved) return null;
    const l = Math.hypot(nx, ny) || 1;
    return { x, y, nx: nx / l, ny: ny / l };
  }
  // What a ray hits in the room (pointing): the nearest plane of any kind, or the floor -> { t, at: [x, y, z], kind, label } or null.
  // from, dir: floor plan, dir a unit vector; max: how far to look (m).
  function cast(room, from, dir, max = 10) {
    let best = null;
    const take = (t, kind, label) => { if (t > 1e-4 && t <= max && (!best || t < best.t)) best = { t, at: [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t], kind, label }; };
    for (const pl of (room && room.planes) || []) {
      const P = pl.p;
      if (P.length < 3) continue;
      let nx = 0, ny = 0, nz = 0;                                       // (Newell: the polygon's normal, whatever its shape)
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { nx += (P[j][1] - P[i][1]) * (P[j][2] + P[i][2]); ny += (P[j][2] - P[i][2]) * (P[j][0] + P[i][0]); nz += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]); }
      const dn = nx * dir[0] + ny * dir[1] + nz * dir[2];
      if (Math.abs(dn) < 1e-9) continue;
      const t = (nx * (P[0][0] - from[0]) + ny * (P[0][1] - from[1]) + nz * (P[0][2] - from[2])) / dn;
      if (!(t > 1e-4 && t <= max)) continue;
      const q = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), [i0, i1] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2];
      if (inside(P.map((v) => [v[i0], v[i1]]), q[i0], q[i1])) take(t, kind(pl), pl.l);
    }
    if (dir[2] < -1e-6) take(-from[2] / dir[2], 'floor', 'floor');
    return best;
  }
  // A place on a wall for a flat thing of size { w, h } (a window: the hand wall's viewer). Without `near`: the middle of the longest wall,
  // its middle `h0` up. With `near` ([x, y, z], floor plan): on the wall nearest to it, where it is along the wall and how high (kept on
  // the wall: a viewer can only be put onto a wall). Off the wall by `off`, on the room's side. -> { x, y, h, yaw (the way it faces, a
  // heading on the floor plan) } or null when the room has no wall.
  function wallSpot(room, size, near, h0 = 1.35, off = 0.02) {
    const ws = room ? prep(room).walls : [];
    if (!ws.length) return null;
    const len = (w) => Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    let w, t, h;
    if (near) {
      let best = Infinity;
      for (const q of ws) {
        const dx = q.x1 - q.x0, dy = q.y1 - q.y0, L2 = dx * dx + dy * dy, u = Math.max(0, Math.min(1, ((near[0] - q.x0) * dx + (near[1] - q.y0) * dy) / L2));
        const d = Math.hypot(near[0] - (q.x0 + dx * u), near[1] - (q.y0 + dy * u));
        if (d < best) { best = d; w = q; t = u; }
      }
      h = near[2];
    } else { w = ws.reduce((a, b) => (len(b) > len(a) ? b : a)); t = 0.5; h = h0; }
    const L = len(w), m = Math.min(0.5, (size.w / 2) / L);
    t = Math.max(m, Math.min(1 - m, t));
    h = Math.max(Math.min(w.lo + size.h / 2 + 0.3, w.hi - size.h / 2), Math.min(w.hi - size.h / 2, h));
    let cx = 0, cy = 0, n = 0;                                 // (the room's side: towards the middle of everything in the room)
    for (const pl of room.planes) for (const p of pl.p) { cx += p[0]; cy += p[1]; n++; }
    cx /= n; cy /= n;
    const px = w.x0 + (w.x1 - w.x0) * t, py = w.y0 + (w.y1 - w.y0) * t;
    let nx = -(w.y1 - w.y0) / L, ny = (w.x1 - w.x0) / L;
    if (nx * (cx - px) + ny * (cy - py) < 0) { nx = -nx; ny = -ny; }
    return { x: px + nx * off, y: py + ny * off, h, yaw: Math.atan2(ny, nx) };
  }
  // the document's kind for where the viewer hangs (any page may move it; the last move stands): { k: 'wallspot', x, y, h, yaw } in the
  // common frame; createApp and a PC view add it to their session's kinds
  // and where each text window of the app hangs (the same for everybody, any page may move one): { k: 'winspot', id, x, y, h, yaw }
  const WIN_KIND = {
    keep: (e) => ({ key: `winspot:${e.id}` }),
    apply(S, e) { if (typeof e.id === 'string' && [e.x, e.y, e.h, e.yaw].every(Number.isFinite)) { S.doc.winspots = Object.assign({}, S.doc.winspots, { [e.id]: { x: e.x, y: e.y, h: e.h, yaw: e.yaw } }); S.notify('winspot', e); } },
  };
  const SPOT_KIND = {
    keep: () => ({ key: 'wallspot' }),
    apply(S, e) { if ([e.x, e.y, e.h, e.yaw].every(Number.isFinite)) { S.doc.wallspot = { x: e.x, y: e.y, h: e.h, yaw: e.yaw }; S.notify('wallspot', S.doc.wallspot); } },
  };
  // The rooms of one scan: every floor is a room (a headset's room setup gives each room its own floor), and every other plane goes with
  // each room whose floor it stands on or touches (within TOUCH: a wall between two rooms goes with both), else with the nearest.
  // -> [{ planes: indices into room.planes, floor: its outline [[x, y]], w, d (m), here (the point `here` [x, y] is on it) }]; one room
  // (the whole scan) when it has fewer than two floors.
  const TOUCH = 0.3;
  function splitRooms(room, here) {
    const P = (room && room.planes) || [], floors = [];
    const box = (pts) => { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) }; };
    P.forEach((pl, i) => { if (!pl.v && /floor/i.test(pl.l)) floors.push(i); });
    if (floors.length < 2) {
      const pts = P.flatMap((pl) => pl.p.map((q) => [q[0], q[1]])), b = pts.length ? box(pts) : { w: 0, d: 0 };
      const outline = floors.length ? P[floors[0]].p.map((q) => [q[0], q[1]]) : pts.length ? [[Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1]))], [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))]] : [];
      return [{ planes: P.map((_, i) => i), floor: outline, w: b.w, d: b.d, here: true }];
    }
    const rooms = floors.map((i) => { const poly = P[i].p.map((q) => [q[0], q[1]]), b = box(poly); return { planes: [i], floor: poly, w: b.w, d: b.d, here: !!here && inside(poly, here[0], here[1]) }; });
    P.forEach((pl, i) => {
      if (floors.includes(i)) return;
      const cx = pl.p.reduce((a, q) => a + q[0], 0) / pl.p.length, cy = pl.p.reduce((a, q) => a + q[1], 0) / pl.p.length, near = [];
      let best = 0, bd = Infinity;
      rooms.forEach((r, k) => { const d = inside(r.floor, cx, cy) ? 0 : edge(r.floor, cx, cy)[2]; if (d <= TOUCH) near.push(k); if (d < bd) { bd = d; best = k; } });
      for (const k of near.length ? near : [best]) rooms[k].planes.push(i);
    });
    return rooms;
  }
  // the scan with only the picked rooms (indices into splitRooms' list); a plane two of them share is there once
  const pickRooms = (room, rooms, picked) => ({ planes: [...new Set(picked.flatMap((k) => rooms[k].planes))].sort((a, b) => a - b).map((i) => room.planes[i]) });
  const walls = (room) => (room ? prep(room).walls : []);
  const surfaces = (room) => (room ? prep(room).tops : []);
  const blocks = (room) => (room ? prep(room).blocks : []);

  // ---- the room's lights
  const ROUND_W = 0.4, STRIP_W = 0.12, TAP = 0.25;          // m: a marked round fitting's size, a strip's width; a pinch moved less than TAP is a tap
  function ceilingHeight(room) {
    const P = (room && room.planes) || [], c = P.filter((pl) => !pl.v && kind(pl) === 'ceiling');
    if (c.length) return r2(c.reduce((s, pl) => s + pl.p.reduce((a, q) => a + q[2], 0) / pl.p.length, 0) / c.length);
    const tops = P.filter((pl) => pl.v).map((pl) => Math.max(...pl.p.map((q) => q[2])));
    const top = tops.length ? Math.max(...tops) : 0;
    return top > 1.8 ? r2(top) : 2.5;
  }
  const fin = (a) => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite);
  const LIGHT_KIND = {
    keep: (e) => ({ key: `rlight:${e.id}` }),
    apply(S, e) {
      if (typeof e.id !== 'string' || !e.id) return;
      let v = null;
      if (e.del) v = { del: true };
      else if (fin(e.a) && fin(e.b) && Number.isFinite(e.h) && e.w > 0) v = { a: e.a, b: e.b, h: e.h, w: e.w };
      if (!v) return;
      S.doc.rlights = Object.assign({}, S.doc.rlights, { [e.id]: v }); S.notify('rlight', e);
    },
  };
  function lightOf(id, a, b, h, w, from) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { id, a, b, h, w, len, round: len < 1e-6, from };
  }
  function lights(room, marked) {
    const out = [], gone = marked || {}, H = ceilingHeight(room);
    ((room && room.planes) || []).forEach((pl, i) => {
      if (pl.v || !/lamp|light/i.test(pl.l || '') || pl.p.length < 3) return;
      const h = pl.p.reduce((s, q) => s + q[2], 0) / pl.p.length, id = `scan${i}`;
      if (h < H - 0.5 || (gone[id] && gone[id].del)) return;
      // (its long way: the longest edge; its size along that and across)
      let u = [1, 0], best = -1;
      pl.p.forEach((q, k) => { const r = pl.p[(k + 1) % pl.p.length], d = Math.hypot(r[0] - q[0], r[1] - q[1]); if (d > best) { best = d; u = [(r[0] - q[0]) / d, (r[1] - q[1]) / d]; } });
      const cx = pl.p.reduce((s, q) => s + q[0], 0) / pl.p.length, cy = pl.p.reduce((s, q) => s + q[1], 0) / pl.p.length;
      let l0 = Infinity, l1 = -Infinity, w0 = Infinity, w1 = -Infinity;
      for (const q of pl.p) { const x = q[0] - cx, y = q[1] - cy, s = x * u[0] + y * u[1], t = -x * u[1] + y * u[0]; l0 = Math.min(l0, s); l1 = Math.max(l1, s); w0 = Math.min(w0, t); w1 = Math.max(w1, t); }
      const L = l1 - l0, W = w1 - w0, m = (l0 + l1) / 2, c = [cx + u[0] * m - u[1] * (w0 + w1) / 2, cy + u[1] * m + u[0] * (w0 + w1) / 2];
      if (L > 2 * W) out.push(lightOf(id, [r2(c[0] - u[0] * L / 2), r2(c[1] - u[1] * L / 2)], [r2(c[0] + u[0] * L / 2), r2(c[1] + u[1] * L / 2)], r2(h), r2(Math.max(0.05, W)), 'scan'));
      else out.push(lightOf(id, [r2(c[0]), r2(c[1])], [r2(c[0]), r2(c[1])], r2(h), r2(Math.max(0.1, L, W)), 'scan'));
    });
    for (const [id, v] of Object.entries(gone)) if (!v.del && !id.startsWith('scan')) out.push(lightOf(id, v.a, v.b, v.h, v.w, 'mark'));
    return out;
  }
  function aimUp(eye, tip, h) {
    const d = [tip[0] - eye[0], tip[1] - eye[1], tip[2] - eye[2]], l = Math.hypot(d[0], d[1], d[2]);
    if (!(l > 0.05) || d[2] / l < 0.25 || eye[2] >= h) return null;              // (not pointing up at the ceiling: at most 75 degrees off straight up)
    const k = (h - eye[2]) / d[2], p = [eye[0] + d[0] * k, eye[1] + d[1] * k];
    return Math.hypot(p[0] - eye[0], p[1] - eye[1]) > 8 ? null : p;
  }
  // which light a point on the ceiling is on (within margin of its outline), or null
  function lightAt(list, p, margin = 0.1) {
    let best = null, bd = Infinity;
    for (const L of list || []) {
      const ab = [L.b[0] - L.a[0], L.b[1] - L.a[1]], ll = ab[0] * ab[0] + ab[1] * ab[1], t = ll > 0 ? Math.max(0, Math.min(1, ((p[0] - L.a[0]) * ab[0] + (p[1] - L.a[1]) * ab[1]) / ll)) : 0;
      const d = Math.hypot(p[0] - L.a[0] - ab[0] * t, p[1] - L.a[1] - ab[1] * t) - L.w / 2;
      if (d < margin && d < bd) { bd = d; best = L; }
    }
    return best;
  }
  // the point a hand pinches at (between thumb and index), else its fingertip
  function pinchPoint(s) {
    const P = s.points || [], th = P.find((q) => q.name === 'thumb'), ix = P.find((q) => q.name === 'index') || P[0];
    if (!ix) return null;
    return th ? [(th.x + ix.x) / 2, (th.y + ix.y) / 2, (th.z + ix.z) / 2] : [ix.x, ix.y, ix.z];
  }
  class LightMarker {
    constructor() { this.aim = null; this.start = null; this.was = false; this.n = 0; }
    update(eye, sources, h, list, nowMs = 0) {
      let best = null;
      for (const s of sources || []) {
        const tip = pinchPoint(s), p = tip && eye ? aimUp(eye, tip, h) : null;
        if (!p) continue;
        const score = (s.pinch ? 10 : 0) + tip[2];                                  // (the hand that pinches, else the one held highest)
        if (!best || score > best.score) best = { p, score, pinch: !!s.pinch };
      }
      if (!best) { this.aim = null; if (!this.start) this.was = false; return { aim: null, drag: null, over: null, done: null }; }
      // (steadied a little: at the ceiling a hand's tremble is two or three times larger)
      this.aim = this.aim && Math.hypot(best.p[0] - this.aim[0], best.p[1] - this.aim[1]) < 0.6 ? [this.aim[0] + (best.p[0] - this.aim[0]) * 0.45, this.aim[1] + (best.p[1] - this.aim[1]) * 0.45] : best.p;
      const over = lightAt(list, this.aim);
      let done = null;
      if (best.pinch && !this.was) this.start = { at: this.aim.slice(), over };
      const moved = this.start ? Math.hypot(this.aim[0] - this.start.at[0], this.aim[1] - this.start.at[1]) : 0;
      if (!best.pinch && this.was && this.start) {
        const id = `m${Math.round(nowMs).toString(36)}${(this.n++).toString(36)}`, q = (v) => [r2(v[0]), r2(v[1])];
        if (moved < TAP) done = this.start.over ? { k: 'rlight', id: this.start.over.id, del: true } : { k: 'rlight', id, a: q(this.start.at), b: q(this.start.at), h: r2(h), w: ROUND_W };
        else done = { k: 'rlight', id, a: q(this.start.at), b: q(this.aim), h: r2(h), w: STRIP_W };
        this.start = null;
      }
      this.was = best.pinch;
      return { aim: this.aim, drag: this.start && moved >= TAP ? { a: this.start.at, b: this.aim } : null, over: this.start ? this.start.over : over, done };
    }
  }

  M.room = { Room, ACTIONS, fromXR, mapRoom, splitRooms, pickRooms, kind, support, ceiling, pushOut, cast, wallSpot, SPOT_KIND, WIN_KIND, walls, surfaces, blocks, TABLE_T, SOLID_MIN,
    LIGHT_KIND, ceilingHeight, lights, aimUp, lightAt, pinchPoint, LightMarker, ROUND_W, STRIP_W };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

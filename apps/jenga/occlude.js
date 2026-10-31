// The real room's walls hide what of the game is behind them (an ES module; THREE is handed in). The headset draws the virtual world over the
// passthrough, so a lamp of the garden in the next room showed through the wall between (Marek, 2026-10-29). Each wall of the server's room (the
// common frame: every headset hides the same things) is drawn into the depth buffer only, a few centimetres behind the real wall (a lamp or a strip
// of sand set against the wall is not cut), after the room's dim (which is drawn at the far end of the depth range and so is not hidden by it) and
// before everything else.
//   const occ = createOccluder({ THREE, parent });   occ.update(room, on)   (room: room.js { planes } in the common frame, or null; on: false hides it)
const BEHIND = 0.04;

export function createOccluder({ THREE, parent }) {
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.renderOrder = -98; mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'occluder';
  parent.add(mesh);
  let built = null;
  function build(room) {
    const R = window.MUMR.room, walls = R.walls(room), pos = [];
    if (walls.length) {
      // (behind: away from the middle of the room's walls)
      const cx = walls.reduce((s, w) => s + w.x0 + w.x1, 0) / (2 * walls.length), cy = walls.reduce((s, w) => s + w.y0 + w.y1, 0) / (2 * walls.length);
      for (const w of walls) {
        const dx = w.x1 - w.x0, dy = w.y1 - w.y0, l = Math.hypot(dx, dy) || 1;
        let nx = -dy / l, ny = dx / l;
        if ((w.x0 + w.x1) / 2 * nx + (w.y0 + w.y1) / 2 * ny - (cx * nx + cy * ny) < 0) { nx = -nx; ny = -ny; }
        const a = [w.x0 + nx * BEHIND, w.y0 + ny * BEHIND], b = [w.x1 + nx * BEHIND, w.y1 + ny * BEHIND], lo = w.lo - 0.05, hi = w.hi + 0.05;
        const v = (p, z) => [p[0], z, -p[1]];                                   // (floor plan -> THREE)
        pos.push(...v(a, lo), ...v(b, lo), ...v(b, hi), ...v(a, lo), ...v(b, hi), ...v(a, hi));
      }
    }
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    built = room;
  }
  return {
    mesh,
    update(room, on = true) {
      if (room !== built) build(room);
      mesh.visible = !!on && !!room;
    },
  };
}

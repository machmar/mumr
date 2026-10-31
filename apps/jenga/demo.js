// THE GHOST DEMO (Marek, 2026-10-31): the button hanging under the how-to sign plays a short demo in place of the tower, ghost blocks and ghost
// fingers: a finger pokes the middle block of a level out, thumb and finger take it by the end that sticks out, draw it out, carry it up and put
// it on top. It is the document's (`jdemo`: when it started, on the server's clock), so every headset sees the same demo at the same moment in
// the same place (Rule 1). The tower's own blocks are not drawn while it plays (draw.js); it is only played in the lobby.
//   demoAt(t, size)  where everything is t seconds in (game frame): { blocks: [{ i, p, q }], moving: { i, p, q }, thumb, index (tips: { p, back }),
//                    fade 0..1 } or null once it is over
//   createDemo({ THREE, parent, own })  -> { update(state, jdemo, nowMs), running(state, jdemo, nowMs) }
const S = window.JENGA;
export const DURATION = 14;
const LEVEL = 6;                                             // the level the block is taken from (even: along x)

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
const mix = (a, b, k) => a.map((v, j) => lerp(v, b[j], k));
// a piecewise path: keys [[t, value]], eased between them
function path(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let j = 1; j < keys.length; j++) if (t <= keys[j][0]) { const [t0, a] = keys[j - 1], [t1, b] = keys[j]; return mix(a, b, ease((t - t0) / (t1 - t0))); }
  return keys[keys.length - 1][1];
}

export function demoAt(t, size) {
  if (!(t >= 0) || t > DURATION) return null;
  const d = S.dims(size), L = S.layout(size), top = L.plinth.top, mid = LEVEL * S.PER + 1, home = S.blockHome(mid, size, top);
  const [x0, y0, z0] = home.p, E = L.d.L / 2, H = d.H, out = 0.35 * d.L;
  const topHome = S.slotHome(S.LEVELS, 1, size, top), zt = topHome.p[2];
  // the block: poked out, drawn out by its end, lifted, carried over and put on top (level 18 lies along x, as level 6 does)
  const bx = path([[2.0, [x0, y0, z0]], [3.5, [x0 + out, y0, z0]], [5.8, [x0 + out, y0, z0]], [7.4, [x0 + d.L + 0.03, y0, z0]], [8.6, [x0 + d.L + 0.03, y0, zt + 0.06]], [9.8, [topHome.p[0], topHome.p[1], zt + 0.06]], [10.6, topHome.p]], t);
  // the fingers: the index pokes the end at -x, goes round, and with the thumb takes the end sticking out at +x (thumb above, finger under it)
  const grip = [bx[0] + E - 0.014, bx[1], bx[2]], gap = path([[4.6, [0.045]], [5.6, [H + 0.012]], [10.6, [H + 0.012]], [11.4, [0.05]]], t)[0];
  const pokeAt = [x0 - E - 0.004, y0, z0];
  let index, thumb;
  if (t < 4.0) {
    const p = path([[0.6, [pokeAt[0] - 0.14, y0, z0 + 0.02]], [1.8, [pokeAt[0] - 0.01, y0, z0]], [2.0, pokeAt], [3.5, [pokeAt[0] + out, y0, z0]], [4.0, [pokeAt[0] + out - 0.07, y0, z0 + 0.02]]], t);
    index = { p, back: [-1, 0, 0.25] }; thumb = { p: [p[0] - 0.035, p[1] + 0.012, p[2] - 0.03], back: [-0.6, 0.2, -0.6] };
  } else {
    // (round the side of the tower, out at its +x end; then on with the block)
    const at = t < 5.6 ? path([[4.0, [pokeAt[0] + out - 0.07, y0 - 0.02, z0 + 0.06]], [4.6, [x0, y0 - d.L, z0 + 0.08]], [5.6, grip]], t) : t < 11.4 ? grip : path([[11.4, grip], [12.6, [grip[0] + 0.1, grip[1], grip[2] + 0.12]]], t);
    thumb = { p: [at[0], at[1], at[2] + gap / 2], back: [0.7, 0, 0.7] }; index = { p: [at[0], at[1], at[2] - gap / 2], back: [0.8, 0, -0.4] };
  }
  const blocks = [];
  for (let i = 0; i < S.BLOCKS; i++) if (i !== mid) { const h = S.blockHome(i, size, top); blocks.push({ i, p: h.p, q: h.q }); }
  const fade = Math.min(1, t / 0.7, (DURATION - t) / 1.2);
  return { blocks, moving: { i: mid, p: bx, q: home.q }, thumb, index, fade: Math.max(0, fade) };
}

export function createDemo({ THREE, parent, own = (o) => o }) {
  const root = new THREE.Group(); root.visible = false; parent.add(root);
  const ghost = own(new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending }));
  const lines = own(new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  const gold = own(new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.6, depthWrite: false }));
  const goldLines = own(new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  const finger = own(new THREE.MeshBasicMaterial({ color: 0xf6dcc8, transparent: true, opacity: 0.7, depthWrite: false }));
  let sizeBuilt = null, still = null, stillEdges = null, mover = null;
  const tipGeo = own(new THREE.CapsuleGeometry(0.0085, 0.05, 4, 10)); tipGeo.translate(0, 0.025 + 0.0085, 0);    // (from its tip, along +y)
  const tips = [new THREE.Mesh(tipGeo, finger), new THREE.Mesh(tipGeo, finger)]; tips.forEach((m) => { m.renderOrder = 4; root.add(m); });
  const toV = (p) => new THREE.Vector3(p[0], p[2], -p[1]), up = new THREE.Vector3(0, 1, 0);
  const quat = (q) => new THREE.Quaternion(q[0], q[2], -q[1], q[3]);

  function build(size, place) {
    if (still) { root.remove(still, stillEdges, mover); still.geometry.dispose(); stillEdges.geometry.dispose(); }
    const d = S.dims(size), box = new THREE.BoxGeometry(d.L, d.H * 0.96, d.W * 0.96), edges = new THREE.EdgesGeometry(box), m = new THREE.Matrix4();
    const a = demoAt(0, size), n = a.blocks.length;
    still = new THREE.InstancedMesh(box, ghost, n); still.frustumCulled = false;
    const pos = [];
    a.blocks.forEach((b, k) => {
      m.compose(toV(S.toCommon(place, b.p)), quat(S.qCommon(place, b.q)), new THREE.Vector3(1, 1, 1)); still.setMatrixAt(k, m);
      const e = edges.attributes.position; for (let j = 0; j < e.count; j++) { const v = new THREE.Vector3(e.getX(j), e.getY(j), e.getZ(j)).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
    });
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    stillEdges = new THREE.LineSegments(eg, lines); stillEdges.frustumCulled = false;
    mover = new THREE.Group(); mover.add(new THREE.Mesh(box, gold), new THREE.LineSegments(edges, goldLines)); mover.children.forEach((o) => { o.renderOrder = 3; });
    root.add(still, stillEdges, mover);
    sizeBuilt = `${size}|${place.x}|${place.y}|${place.yaw}`;
  }
  const running = (state, jd, now) => !!(state && jd && state.phase === 'lobby' && state.place && now >= jd.at && now - jd.at < DURATION * 1000);
  function update(state, jd, now) {
    if (!running(state, jd, now)) { root.visible = false; return false; }
    const pl = state.place, a = demoAt((now - jd.at) / 1000, state.size);
    if (!a) { root.visible = false; return false; }
    if (sizeBuilt !== `${state.size}|${pl.x}|${pl.y}|${pl.yaw}`) build(state.size, pl);
    root.visible = true;
    ghost.opacity = 0.05 * a.fade; lines.opacity = 0.35 * a.fade; gold.opacity = 0.6 * a.fade; goldLines.opacity = 0.9 * a.fade; finger.opacity = 0.7 * a.fade;
    mover.position.copy(toV(S.toCommon(pl, a.moving.p))); mover.quaternion.copy(quat(S.qCommon(pl, a.moving.q)));
    [a.thumb, a.index].forEach((f, k) => {
      const tip = tips[k], back = S.toCommon({ x: 0, y: 0, yaw: pl.yaw }, f.back), dir = toV(back).normalize();
      tip.position.copy(toV(S.toCommon(pl, f.p))); tip.quaternion.setFromUnitVectors(up, dir);
    });
    return true;
  }
  return { update, running };
}

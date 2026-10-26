// Drawing the other players (the hands as ghost fingers in that player's colour, a cone for the head, the feet as shoes: feet3d.js) and the marks for lining up (a
// disc with a cross and a number on a short pole at each of this player's two spots, a ring that fills while a spot is being taken, a
// disc with a 3 for every check mark, three knobs at each spot, three knobs in front of each real camera). From Nudgy (simulator/mr/players3d.js).
//
// Everything here is given on this headset's floor plan (x, y on the floor, z up): presence.js and lineup.js have already turned
// what came from the others out of the common frame. `world` is the group whose origin is on the real floor; inside it the floor
// plan (x, y, z) sits at THREE (x, z, -y). The ghost hands live in `scene` directly (XR space), as this page's own do.
import { makeShoes } from './feet3d.js';
export const PLAYER_COLOURS = [0x4ea1ff, 0xff9f43, 0x7bd88f, 0xff6b81];

export function createPlayers({ THREE, world, scene, GhostHand }) {
  const others = new Map();                       // slot -> what is drawn for that player
  const JR = new Float32Array(25).fill(0.009);    // (joint radii are not sent: a finger is about this thick)
  const toV = (x, y, z) => new THREE.Vector3(x, z, -y);
  const colour = (slot) => PLAYER_COLOURS[((slot | 0) % PLAYER_COLOURS.length + PLAYER_COLOURS.length) % PLAYER_COLOURS.length];

  function make(slot) {
    const col = colour(slot);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75 }));
    head.geometry.rotateZ(-Math.PI / 2); head.visible = false; world.add(head);
    const dots = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: col })); m.visible = false; world.add(m); return m; });
    const o = { slot, col, head, dots, hands: {}, seen: {}, feet: makeShoes(THREE, world, col) };
    others.set(slot, o);
    return o;
  }
  function drop(o) {
    world.remove(o.head); o.head.geometry.dispose(); o.head.material.dispose();
    for (const d of o.dots) { world.remove(d); d.geometry.dispose(); d.material.dispose(); }
    for (const h of Object.values(o.hands)) h.ghost.dispose();
    o.feet.dispose();
    others.delete(o.slot);
  }

  // list: [{ slot, head: [x, y, heading, height, pitch] | null, sources: [...] }] in our own frame. A source with
  // 25 joints is drawn as ghost fingers, anything else (a mouse, a controller, a shoe) as dots at its points.
  // The joints come 45 times a second and are eased, so the fingers do not step.
  function update(list, dt) {
    const k = 1 - Math.exp(-Math.max(0, dt) * 30), y0 = world.position.y, here = new Set();
    for (const p of list || []) {
      here.add(p.slot);
      const o = others.get(p.slot) || make(p.slot);
      o.head.visible = !!p.head;
      if (p.head) { o.head.position.copy(toV(p.head[0], p.head[1], p.head[3])); o.head.rotation.set(0, p.head[2], 0); }
      let nd = 0;
      const used = new Set();
      for (const s of p.sources || []) {
        if (Array.isArray(s.joints) && s.joints.length === 25) {
          used.add(s.id);
          let h = o.hands[s.id];
          if (!h) { h = o.hands[s.id] = { ghost: new GhostHand(0.55), jp: new Float32Array(75), fresh: true }; scene.add(h.ghost.mesh); }
          const far = Math.hypot(h.jp[0] - s.joints[0][0], h.jp[1] - (s.joints[0][2] + y0), h.jp[2] + s.joints[0][1]) > 0.3;
          for (let i = 0; i < 25; i++) {
            const j = s.joints[i], t = [j[0], j[2] + y0, -j[1]], e = h.fresh || far ? 1 : k;
            for (let c = 0; c < 3; c++) h.jp[i * 3 + c] += (t[c] - h.jp[i * 3 + c]) * e;
          }
          h.fresh = false;
          h.ghost.update(h.jp, JR, o.col);
        } else if (!s.foot) for (const q of s.points || []) if (nd < o.dots.length) { const d = o.dots[nd++]; d.visible = true; d.position.copy(toV(q.x, q.y, q.z)); }
      }
      for (; nd < o.dots.length; nd++) o.dots[nd].visible = false;
      o.feet.update(p.sources);                                                    // (only when that player's app turned feet on)
      for (const [id, h] of Object.entries(o.hands)) if (!used.has(id)) { h.ghost.mesh.visible = false; h.fresh = true; }
    }
    for (const o of [...others.values()]) if (!here.has(o.slot)) drop(o);
  }

  // ---- the marks for lining up
  const group = new THREE.Group(); group.visible = false; world.add(group);
  const numberTex = (n, col) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#14161c'; g.font = '700 92px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  function makeMark(n, col) {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 40), mat); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.003; g.add(disc);
    const dark = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    for (const a of [0, Math.PI / 2]) { const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.006), dark); bar.rotation.x = -Math.PI / 2; bar.rotation.z = a; bar.position.y = 0.004; g.add(bar); }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.25, 8), dark); pole.position.y = 0.125; g.add(pole);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTex(n, col), depthTest: false })); label.scale.setScalar(0.07); label.position.y = 0.29; label.renderOrder = 6; g.add(label);
    g.userData = { disc, mat }; g.visible = false; group.add(g);
    return g;
  }
  const mine = [null, null], checks = new Map();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 48, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 6; ring.visible = false; group.add(ring);
  let ringAt = -1;
  const KNOB_COL = { along: 0xff6b6b, across: 0x7bd88f, up: 0x4ea1ff };
  const makeKnob = (radius) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    ball.renderOrder = 6; ball.visible = false; group.add(ball);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const stalk = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    stalk.frustumCulled = false; stalk.renderOrder = 6; stalk.visible = false; group.add(stalk);
    return { ball, stalk };
  };
  const knobs = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => makeKnob(0.014));      // (three at each of the three spots)
  const camKnobs = [0, 1, 2, 3, 4, 5].map(() => makeKnob(0.02));        // (room for two cameras: the knobs are bigger, they hang half a metre in front of a camera)
  // m: { show, slot, points: [[x, y, z] | null, [x, y, z] | null], knobs (align.js: Aligner.knobs()), held (0, 1 or -1),
  //      (points has the check mark as a third entry while lining up, so that its knobs have a spot to hang from),
  //      progress (0..1), at: [x, y, z] | null, checks: [{ slot, x, y, z }], camKnobs (camknobs.js: CamKnobs.knobs(), up to six) }, all in our own
  //      frame (lineup.js LineUp.marks()).
  function marks(m) {
    group.visible = !!(m && m.show);
    if (!group.visible) return;
    const col = colour(m.slot);
    for (let i = 0; i < 2; i++) {
      const p = m.points && m.points[i];
      if (p && (!mine[i] || mine[i].userData.col !== col)) { if (mine[i]) group.remove(mine[i]); mine[i] = makeMark(i + 1, col); mine[i].userData.col = col; }
      if (!mine[i]) continue;
      mine[i].visible = !!p;
      if (p) { mine[i].position.copy(toV(p[0], p[1], p[2] || 0)); mine[i].scale.setScalar(m.held === i ? 1.25 : 1); mine[i].userData.mat.opacity = m.held === i ? 1 : 0.85; }
    }
    const seen = new Set();
    for (const c of m.checks || []) {
      const key = String(c.slot); seen.add(key);
      let g = checks.get(key);
      if (!g) { g = makeMark(3, colour(c.slot)); checks.set(key, g); }
      g.visible = true; g.position.copy(toV(c.x, c.y, c.z || 0));
      g.scale.setScalar(m.held === 2 && c.slot === m.slot ? 1.25 : 1); g.userData.mat.opacity = m.held === 2 && c.slot === m.slot ? 1 : 0.85;
    }
    for (const [key, g] of checks) if (!seen.has(key)) { group.remove(g); checks.delete(key); }
    ring.visible = !!(m.at && m.progress > 0.02);
    if (ring.visible) {
      const step = Math.round(m.progress * 24);
      if (step !== ringAt) { ringAt = step; ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(0.07, 0.085, 48, 1, Math.PI / 2, -Math.PI * 2 * Math.max(0.02, step / 24)); }
      ring.position.copy(toV(m.at[0], m.at[1], (m.at[2] || 0) + 0.006));
    }
    // the knobs: one for each direction at each spot, on a thin stalk from the spot. A held one is larger and yellow.
    const list = m.knobs || [];
    knobs.forEach((k, n) => {
      const q = list[n], p = q ? m.points[q.i] : null;
      k.ball.visible = k.stalk.visible = !!(q && p);
      if (!q || !p) return;
      k.ball.position.copy(toV(q.x, q.y, q.z));
      k.ball.material.color.setHex(q.held ? 0xf2c14e : KNOB_COL[q.axis]); k.ball.scale.setScalar(q.held ? 1.5 : 1);
      const a = k.stalk.geometry.attributes.position, from = toV(p[0], p[1], (p[2] || 0) + 0.02);
      a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, k.ball.position.x, k.ball.position.y, k.ball.position.z); a.needsUpdate = true;
      k.stalk.material.color.setHex(KNOB_COL[q.axis]);
    });
    // the knobs of the real cameras: the same three directions and colours, each on a thin stalk
    const cl = m.camKnobs || [];
    camKnobs.forEach((k, n) => {
      const q = cl[n];
      k.ball.visible = k.stalk.visible = !!q;
      if (!q) return;
      k.ball.position.copy(toV(q.x, q.y, q.z));
      k.ball.material.color.setHex(q.held ? 0xf2c14e : KNOB_COL[q.axis]); k.ball.scale.setScalar(q.held ? 1.5 : 1);
      const a = k.stalk.geometry.attributes.position, from = toV(q.from[0], q.from[1], q.from[2]);
      a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, k.ball.position.x, k.ball.position.y, k.ball.position.z); a.needsUpdate = true;
      k.stalk.material.color.setHex(KNOB_COL[q.axis]);
    });
  }
  function clear() { for (const o of [...others.values()]) drop(o); group.visible = false; }
  return { update, marks, clear, colour, get count() { return others.size; }, group };
}

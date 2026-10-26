// The real cameras of the room (cams.js), drawn in a 3D scene: a small, plain thing at each camera's place, looking the way the camera looks. No lines, no
// label: it is not meant to be noticed until you look for it (it is about 8 cm long, grey, with a dark lens, a thin blue ring round the lens and one green dot).
// One drawing for all pages that show the world: the headset (app.js, in its own frame), the world view (view.js, in the common frame) and the mixed view.
//
//   const marks = createCameraMarks({ THREE, group });     group: what it hangs on (the scene, or the headset's world group)
//   marks.update(list)    list: [{ id, x, y, z, yaw, pitch }] in the floor frame of that scene (x, y on the floor, z up, radians); entries that are not whole are skipped
//   marks.exclude         a Set of ids that are not drawn (a page does not draw the camera it looks through)
//   marks.group           what holds them all (switch `visible`)       marks.clear()       marks.count
// In three.js axes a floor point (x, y, z) is (x, z, -y); a thing that looks along its own +x is turned by `yaw` about the vertical and then tilted by `pitch`.
export function createCameraMarks({ THREE, group }) {
  // (an Object3D and not a Group: mixedshow.js finds view.js's room, marks and spot groups by being the first three Groups of the scene)
  const root = new THREE.Object3D(); root.name = 'cameras'; group.add(root);
  const grey = new THREE.MeshBasicMaterial({ color: 0x8a94a3 }), dark = new THREE.MeshBasicMaterial({ color: 0x1b1f27 });
  const blue = new THREE.MeshBasicMaterial({ color: 0x4ea1ff }), green = new THREE.MeshBasicMaterial({ color: 0x7bd88f });
  const bodyGeo = new THREE.BoxGeometry(0.07, 0.04, 0.055), lensGeo = new THREE.CylinderGeometry(0.017, 0.02, 0.028, 16), ringGeo = new THREE.TorusGeometry(0.0185, 0.0025, 6, 20), dotGeo = new THREE.SphereGeometry(0.006, 8, 6);
  const marks = new Map(), exclude = new Set();

  function make() {                                        // looks along its +x; the origin is the middle of the lens
    const o = new THREE.Object3D();
    const body = new THREE.Mesh(bodyGeo, grey); body.position.set(-0.04, 0, 0); o.add(body);
    const lens = new THREE.Mesh(lensGeo, dark); lens.rotation.z = -Math.PI / 2; lens.position.set(0.009, 0, 0); o.add(lens);
    const ring = new THREE.Mesh(ringGeo, blue); ring.rotation.y = Math.PI / 2; ring.position.set(0.0235, 0, 0); o.add(ring);
    const dot = new THREE.Mesh(dotGeo, green); dot.position.set(-0.055, 0.024, 0); o.add(dot);
    return o;
  }
  function update(list) {
    const seen = new Set();
    for (const c of list || []) {
      if (!c || typeof c.id !== 'string' || exclude.has(c.id) || ![c.x, c.y, c.z, c.yaw, c.pitch].every(Number.isFinite)) continue;
      let o = marks.get(c.id);
      if (!o) { o = make(); o.rotation.order = 'YZX'; root.add(o); marks.set(c.id, o); }
      o.position.set(c.x, c.z, -c.y); o.rotation.set(0, c.yaw, c.pitch, 'YZX');
      seen.add(c.id);
    }
    for (const [id, o] of [...marks]) if (!seen.has(id)) { root.remove(o); marks.delete(id); }
  }
  function clear() { update([]); }
  return { update, clear, exclude, group: root, get count() { return marks.size; } };
}

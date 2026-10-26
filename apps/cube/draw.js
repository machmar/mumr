// How the cube looks, for the headset page and the PC view alike (one drawing for both: Nudgy drew its boxes and balls differently on
// the PC, and nobody noticed for days). An ES module; the page gives it THREE.
//
// Who simulates the cube (holds its token) is shown on it: a thick outline in that player's colour (the colour of their ghost hands and
// head; an inverted shell, the cartoon-outline way) and a small label above it ("you", "player 2", "host").
export function makeCube(THREE, size) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.55, metalness: 0.05 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0x14161c }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(size * 0.18, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  dot.rotation.x = -Math.PI / 2; dot.position.y = size / 2 + 0.0005;                 // (a mark on top, so that its turning shows)
  dot.position.x = size * 0.22;
  // the outline: the same box a little larger, drawn from the inside only, in one flat colour
  const outline = new THREE.Mesh(box.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }));
  outline.scale.setScalar(1.12); outline.visible = false;
  // the label: a small sign above the cube that always faces whoever looks at it
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  label.scale.set(0.16, 0.04, 1); label.visible = false;
  g.add(box, edges, dot, outline);
  const holder = new THREE.Group(); holder.add(label);                                // (not turned with the cube)
  g.userData = { box, edges, outline, label, canvas, tex, holder, size, text: null };
  return g;
}
// d: { x, y, z, q (quaternion x y z w, floor plan) or yaw, held, pointed } on the floor plan of whatever group the cube is in (inside it the floor plan (x, y, z) is THREE (x, z, -y)).
// owner: { text, colour } of whoever simulates it now, or null. The label group must be added to the same parent as the cube once:
// parent.add(cube.userData.holder).
export function setCube(g, d, colour, owner) {
  const u = g.userData;
  g.position.set(d.x, d.z, -d.y);
  if (d.q) g.quaternion.set(d.q[0], d.q[2], -d.q[1], d.q[3]);                      // (floor plan (x, y, z) is THREE (x, z, -y), and so is the vector part of a turn)
  else g.rotation.set(0, d.yaw, 0);
  u.box.material.color.set(colour);
  u.edges.material.color.set(d.held ? 0xffffff : d.pointed ? 0xf2c14e : 0x14161c);      // (white: held; yellow: somebody points at it)
  u.outline.visible = u.label.visible = !!owner;
  if (!owner) return;
  u.outline.material.color.set(owner.colour);
  u.holder.position.set(d.x, d.z + u.size / 2 + 0.07, -d.y);
  if (u.text !== `${owner.text}|${owner.colour}`) {
    u.text = `${owner.text}|${owner.colour}`;
    const c = u.canvas.getContext('2d'), hex = '#' + (owner.colour >>> 0).toString(16).padStart(6, '0');
    c.clearRect(0, 0, 256, 64);
    c.fillStyle = 'rgba(18,20,26,0.85)'; c.beginPath(); c.roundRect(4, 4, 248, 56, 16); c.fill();
    c.lineWidth = 6; c.strokeStyle = hex; c.stroke();
    c.fillStyle = '#ece9e2'; c.font = '600 34px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(owner.text, 128, 34);
    u.tex.needsUpdate = true;
  }
}
// who simulates the cube, for setCube: slot (a player's or the host's), this page's own slot (null for the PC view), the players' colours
export function ownerOf(slot, me, colours, host = 15) {
  if (slot === null || slot === undefined) return null;
  if (slot === host) return { text: 'host', colour: 0xcfd6e2 };
  return { text: slot === me ? 'you' : `player ${slot + 1}`, colour: colours[slot % colours.length] };
}

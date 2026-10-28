// The light of the Jenga scene (an ES module; THREE is handed in), for the headset page and the PC view alike: the fonts, the reflections and
// the lights. In mixed reality the real room is behind everything, so the light is a quiet one: a warm key light from above that throws the
// tower's shadows on the sand and on the real floor, a warm sky light, and the paper lantern standing by the table, which is a real light (its flicker
// follows the server's clock, so it is the same flicker on every headset).
//
//   FONT                    { head, body }: CSS font families for canvas text (the bundled ones, then fallbacks)
//   loadFonts(base)         the bundled fonts (fonts/, SIL OFL); resolves when they can be drawn with (or failed: the fallbacks are drawn)
//   environment(THREE, renderer)   a small warm room as an environment map (PMREM), for the materials' reflections
//   createRig({ THREE, renderer, parent })   the lights, in the game frame (`parent` is the furniture group: they move with the game)
//                             rig.fit(layout): the shadow's box round the tower at this size; rig.update(t, lanternAt, dimmed)
export const FONT = {
  head: '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif',
  body: '"Zen Kaku Gothic New", system-ui, "Helvetica Neue", Arial, sans-serif',
};
const FILES = [['Shippori Mincho B1', 'shippori-mincho-b1-latin-500-normal.woff2', '500'], ['Shippori Mincho B1', 'shippori-mincho-b1-latin-700-normal.woff2', '700'],
  ['Shippori Mincho B1', 'shippori-mincho-b1-latin-800-normal.woff2', '800'], ['Zen Kaku Gothic New', 'zen-kaku-gothic-new-latin-400-normal.woff2', '400'],
  ['Zen Kaku Gothic New', 'zen-kaku-gothic-new-latin-500-normal.woff2', '500'], ['Zen Kaku Gothic New', 'zen-kaku-gothic-new-latin-700-normal.woff2', '700']];
let fontsP = null;
export function loadFonts(base = 'fonts/') {
  if (fontsP) return fontsP;
  if (typeof FontFace === 'undefined') return (fontsP = Promise.resolve(false));
  fontsP = Promise.all(FILES.map(([family, file, weight]) => fetch(base + file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(file))))
    .then((buf) => new FontFace(family, buf, { weight }).load()).then((f) => { document.fonts.add(f); return true; }).catch(() => false)))
    .then((ok) => ok.every(Boolean));
  return fontsP;
}

// ---- reflections: a dim warm room with a window of soft daylight on one side and the lantern's glow on the other
export function environment(THREE, renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), new THREE.MeshBasicMaterial({ color: 0x2a211b, side: THREE.BackSide }));
  room.position.y = 2; scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: 0x1a1410 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.49; scene.add(floor);
  const panel = (w, h, colour, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m; };
  panel(3.2, 2.2, new THREE.Color(2.2, 2.15, 2.0), -4.9, 2.2, -0.5, Math.PI / 2);               // the window: soft daylight
  panel(1.0, 1.4, new THREE.Color(4.0, 2.2, 0.9), 3.5, 1.2, 2.5, -Math.PI / 3);                  // the lantern's glow
  const top = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.82, 0.7) })); top.rotation.x = Math.PI / 2; top.position.y = 4.4; scene.add(top);
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  return rt.texture;
}

export function createRig({ THREE, renderer, parent }) {
  const group = new THREE.Group(); parent.add(group);
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0x3a2a20, 1.0); group.add(hemi);
  // the key light: high and to the side of the player who put the game here, warm; it throws the shadows of the tower and the die's tray
  const key = new THREE.DirectionalLight(0xffeedb, 1.9); group.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 2;
  // the lantern
  const lamp = new THREE.PointLight(0xffa04a, 1.6, 4.5, 1.6); group.add(lamp);
  if (renderer) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
  const at = (gx, gy, gz) => [gx, gz, -gy];
  // the shadow's box: round the tower and the floor it falls on
  function fit(L) {
    const r = Math.max(0.42, L.plinth.half * 1.5 + L.d.height * 0.9), cz = L.plinth.top + L.d.height * 0.35;
    key.position.set(...at(-r * 0.9, -r * 0.55, cz + r * 1.9)); key.target.position.set(...at(0, 0, cz));
    const cam = key.shadow.camera; cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.05; cam.far = r * 5; cam.updateProjectionMatrix();
    key.shadow.normalBias = 0.004 * Math.sqrt(L.d.k) + 0.006;
  }
  // t: seconds (the server's); lanternAt: [x, y, z] in the game frame
  function update(t, lanternAt) {
    if (lanternAt) lamp.position.set(...at(lanternAt[0], lanternAt[1], lanternAt[2]));
    const f = 0.06 * Math.sin(t * 7.3) + 0.04 * Math.sin(t * 13.1 + 1.3) + 0.03 * Math.sin(t * 2.1);
    lamp.intensity = 1.6 * (1 + f);
    return 1 + f;
  }
  return { group, hemi, key, lamp, fit, update, lampAt: null };
}

// ---- fewer draw calls: the meshes under `root` that never move on their own are merged, one mesh for each material (and shadow setting). A mesh
// with several materials, a transparent one, or one marked userData.keep stays as it is. Every merged mesh goes straight under `root` (its
// transform taken into the geometry), marked userData.own. merge: BufferGeometryUtils.mergeGeometries.
export function mergeStatic(THREE, merge, root) {
  const groups = new Map(), drop = [];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o === root || Array.isArray(o.material) || o.material.transparent || o.userData.keep || o.isInstancedMesh) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) return;
    g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, geos: [] });
    groups.get(key).geos.push(g); drop.push(o);
  });
  for (const o of drop) { o.parent.remove(o); o.geometry.dispose(); }
  const out = [];
  for (const g of groups.values()) {
    const geo = g.geos.length === 1 ? g.geos[0] : merge(g.geos, false);
    if (g.geos.length > 1) for (const x of g.geos) x.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.receive; mesh.renderOrder = g.order; mesh.userData.own = true;
    root.add(mesh); out.push(mesh);
  }
  return out;
}

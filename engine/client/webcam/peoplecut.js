// REAL PEOPLE HIDE THE WORLD on the webcam page (Marek, 2026-10-31): each player's stand-in body (bodyproxy.js, from the presence stream, drawn DELAY ms
// in the past so that it sits on the person as the picture shows them) is drawn depth-only, like the room's occluders (mixed.js occMat): invisible itself,
// but what is behind it is not drawn, which leaves the camera's picture there. It changes only what this page draws, from data it already gets (Rule 1).
//   'none'    nothing is drawn (the group is hidden: not one draw call more than before)
//   'crude'   the stand-ins as they are: a blocky outline, on the fat side
//   'ml'      the same stand-ins, fatter, each fragment kept only where the person mask of the picture (segmenter.js) says a person is: the stand-in gives the
//             depth and who it is, the mask the outline. The fragment's place on the screen is its place in the picture; with a lens (lenspass.js) the world is
//             drawn into a wider, straight target, so that place is first taken back to the ideal picture (x m), then through the lens to the picture (lens.js
//             lensPicture). The mask's rows run from the top of the picture down, gl_FragCoord's from the bottom up: v is turned over (1 - y).
// The stand-ins are spheres and open cylinders (a capsule is a cylinder with a sphere at each end), two InstancedMeshes, filled again each frame: two draw
// calls whatever the number of players, and nothing made per frame. ?people=debug in the address also draws them as wireframes in the players' colours.
//
//   const pc = createPeopleCut({ THREE, scene, feed, renderer, camera, debug })
//   pc.update(mode, { solved, delayMs, lensPlan, mask })   once a frame, before drawing: mask is the segmenter ({ ready, texture, threshold }) in 'ml' mode
//   pc.stats   { players, proxies }          pc.box   the players' union in the picture (0..1, top-left origin, padded), or null: what the segmenter may crop to
import * as THREE_NS from 'three';

const STALE = 1000;              // ms: a player whose presence has not come for this long is not covered (they left, or their headset is off)
const MAX_SPHERES = 600, MAX_TUBES = 300;
const THRESHOLD = 0.5;           // the mask's confidence above which a fragment is a person
const PAD = 0.15;                // the players' box in the picture, made this much bigger on every side (for the segmenter's crop)
const COLOURS = [0xf2c14e, 0x4ea1ff, 0xff6b6b, 0x7bd88f];

export function createPeopleCut({ THREE = THREE_NS, scene, feed, renderer, camera, debug = false }) {
  const M = window.MUMR, BP = M.bodyproxy, LN = M.lens;
  const group = new THREE.Group(); group.name = 'peoplecut'; group.visible = false; scene.add(group);
  const sphereGeo = new THREE.SphereGeometry(1, 16, 12), tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  // depth only, drawn after the room's dim and the room's occluders (-98), before the world; no polygon offset: a person wins a tie
  const crude = new THREE.MeshBasicMaterial({ colorWrite: false });
  const U = { uMask: { value: null }, uThreshold: { value: THRESHOLD }, uViewport: { value: new THREE.Vector2(1, 1) }, uLensOn: { value: 0 }, uA1: { value: 0 }, uA2: { value: 0 }, uM: { value: 1 }, uSize: { value: new THREE.Vector2(16 / 9, 1) } };
  const ml = new THREE.MeshBasicMaterial({ colorWrite: false });
  ml.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = ['uniform sampler2D uMask; uniform float uThreshold; uniform vec2 uViewport; uniform float uLensOn; uniform float uA1; uniform float uA2; uniform float uM; uniform vec2 uSize;', LN.glsl(), sh.fragmentShader].join('\n')
      .replace('void main() {', [
        'void main() {',
        '  vec2 pic = gl_FragCoord.xy / uViewport;',                                      // (the screen is the picture, without a lens)
        '  if (uLensOn > 0.5) pic = lensPicture(0.5 + (pic - 0.5) * uM, uA1, uA2, uSize);', // (with one: the wider straight target -> the ideal picture -> the picture)
        '  if (texture2D(uMask, vec2(pic.x, 1.0 - pic.y)).r < uThreshold) discard;',       // (the mask's first row is the top of the picture)
      ].join('\n'));
  };
  ml.customProgramCacheKey = () => 'mumr-peoplecut-ml';
  const spheres = new THREE.InstancedMesh(sphereGeo, crude, MAX_SPHERES), tubes = new THREE.InstancedMesh(tubeGeo, crude, MAX_TUBES);
  for (const m of [spheres, tubes]) { m.renderOrder = -97; m.frustumCulled = false; m.count = 0; group.add(m); }
  // the wireframes (?people=debug): the same instances, in the players' colours
  let wire = null;
  if (debug) {
    const wm = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.45, depthWrite: false });
    for (const m of [spheres, tubes]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * (m === spheres ? MAX_SPHERES : MAX_TUBES)), 3);
    wire = [spheres, tubes].map((m) => { const w = new THREE.InstancedMesh(m.geometry, wm, m === spheres ? MAX_SPHERES : MAX_TUBES); w.instanceMatrix = m.instanceMatrix; w.instanceColor = m.instanceColor; w.renderOrder = 10; w.frustumCulled = false; w.count = 0; group.add(w); return w; });
  }

  const pool = { items: [], n: 0 }, owner = [];       // owner[k]: the slot of pool item k
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Quaternion(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), dbs = new THREE.Vector2(), pj = new THREE.Vector3();
  const stats = { players: 0, proxies: 0 }, box = [0, 0, 0, 0];
  let boxOn = false, bx0 = 1, by0 = 1, bx1 = 0, by1 = 0;
  // (the players' box in the picture: the ends projected, without the lens; the padding covers the rest)
  const boxAdd = (v) => { pj.copy(v).project(camera); if (pj.z < 1) { const u = 0.5 + pj.x / 2, w = 0.5 - pj.y / 2; bx0 = Math.min(bx0, u); bx1 = Math.max(bx1, u); by0 = Math.min(by0, w); by1 = Math.max(by1, w); } };
  const setV = (v, p) => v.set(p[0], p[2], -p[1]);                 // (floor plan -> three.js)
  const put = (mesh, k, slot) => { mesh.setMatrixAt(k, mtx); if (debug) mesh.setColorAt(k, col.setHex(COLOURS[((slot % 4) + 4) % 4])); };

  function update(mode, ctx = {}) {
    stats.players = 0; stats.proxies = 0; boxOn = false;
    if (mode === 'none' || !ctx.solved) { group.visible = false; return; }
    const t = feed.serverNow(), at = t === null ? undefined : t - (ctx.delayMs || 0), grow = mode === 'ml' ? BP.GROW_ML : BP.GROW_CRUDE;
    pool.n = 0;
    for (const p of feed.players()) {
      const age = feed.age('presence', p.slot);
      if (age === null || age > STALE) continue;
      const pr = feed.sample('presence', p.slot, at);
      if (!pr || !pr.data) continue;
      const n0 = pool.n, n = BP.buildInto(pool, pr.data.head, pr.data.sources, { grow });
      if (!n) continue;
      for (let k = n0; k < pool.n; k++) owner[k] = p.slot;
      stats.players++;
    }
    let ns = 0, nt = 0;
    bx0 = 1; by0 = 1; bx1 = 0; by1 = 0;
    for (let k = 0; k < pool.n; k++) {
      const it = pool.items[k], slot = owner[k];
      setV(pa, it.a); if (ns < MAX_SPHERES) { mtx.compose(pa, one, sc.set(it.r, it.r, it.r)); put(spheres, ns++, slot); }
      if (it.kind === 'capsule') {
        setV(pb, it.b); if (ns < MAX_SPHERES) { mtx.compose(pb, one, sc.set(it.r, it.r, it.r)); put(spheres, ns++, slot); }
        dir.subVectors(pb, pa); const len = dir.length();
        if (len > 1e-4 && nt < MAX_TUBES) { mid.addVectors(pa, pb).multiplyScalar(0.5); q.setFromUnitVectors(up, dir.multiplyScalar(1 / len)); mtx.compose(mid, q, sc.set(it.r, len, it.r)); put(tubes, nt++, slot); }
      }
      if (ctx.wantBox) { boxAdd(pa); if (it.kind === 'capsule') boxAdd(pb); }
    }
    stats.proxies = pool.n;
    spheres.count = ns; tubes.count = nt; spheres.instanceMatrix.needsUpdate = true; tubes.instanceMatrix.needsUpdate = true;
    if (debug) { for (const m of [spheres, tubes]) m.instanceColor.needsUpdate = true; wire[0].count = ns; wire[1].count = nt; }
    if (ctx.wantBox && bx1 > bx0 && by1 > by0) { const pw = (bx1 - bx0) * PAD + 0.03, ph = (by1 - by0) * PAD + 0.03; box[0] = Math.max(0, bx0 - pw); box[1] = Math.max(0, by0 - ph); box[2] = Math.min(1, bx1 + pw); box[3] = Math.min(1, by1 + ph); boxOn = box[2] > box[0] && box[3] > box[1]; }
    // the material: depth only, trimmed by the mask once there is one
    const mask = mode === 'ml' && ctx.mask && ctx.mask.ready && ctx.mask.texture ? ctx.mask : null, mat = mask ? ml : crude;
    if (spheres.material !== mat) { spheres.material = mat; tubes.material = mat; }
    if (mask) {
      const plan = ctx.lensPlan && ctx.lensPlan.distort ? ctx.lensPlan : null;
      renderer.getDrawingBufferSize(dbs);
      if (plan) U.uViewport.value.set(Math.min(4096, Math.max(2, Math.round(dbs.x * plan.m))), Math.min(4096, Math.max(2, Math.round(dbs.y * plan.m))));      // (lenspass.js: the target's size)
      else U.uViewport.value.copy(dbs);
      U.uLensOn.value = plan ? 1 : 0; U.uA1.value = plan ? plan.a1 : 0; U.uA2.value = plan ? plan.a2 : 0; U.uM.value = plan ? plan.m : 1; U.uSize.value.set(plan ? plan.aspect : 1, 1);
      U.uMask.value = mask.texture; U.uThreshold.value = Number.isFinite(mask.threshold) ? mask.threshold : THRESHOLD;
    }
    group.visible = ns > 0 || nt > 0;
  }

  function dispose() { scene.remove(group); sphereGeo.dispose(); tubeGeo.dispose(); crude.dispose(); ml.dispose(); for (const m of [spheres, tubes]) m.dispose(); }
  return { update, dispose, stats, get box() { return boxOn ? box : null; }, group, uniforms: U };
}

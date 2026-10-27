// The mixed view: the shared world (drawn by the app's PC view) over a webcam's picture, with the camera placed from the three floor spots the player
// clicks in that picture. Ported from Nudgy (simulator/mr/mixedView.js). An app's PC page becomes a webcam page with one more tag after its view.js:
//
//   <script type="module" src="view.js"></script>
//   <script type="module" src="/mumr/webcam/start.js"></script>      (and, before them, the engine's scripts: /mumr/all.js and /mumr/webcam/all.js)
//
//   https://<pc>:8443/webcam.html?delay=100     delay: how many ms in the past the world is drawn: the webcam's latency, so that the hands in the picture and
//                                               the hands of the world agree (else the latency measured for the camera, else 60 ms)
//
// What the app's view.js hands over (window.view): { feed (a WorldFeed), scene, camera, renderer, orbit (the controls: update() is called once a frame, just
// before drawing), setDelay(ms), camMarks (xr/cammark3d.js, which it draws the real cameras with), parts (see mixedshow.js) }. This file then
//   * puts the camera's picture in as the scene's background (a VideoTexture);
//   * replaces `view.orbit.update` by a function that, when the camera is solved, puts the three.js camera where the webcam stands, and otherwise leaves the
//     page as the app's PC view is (no camera yet) or shows only the picture (a camera but no solution yet: the world would be drawn from a made-up place);
//   * announces the camera as an object of the shared world (an owned cam+, see cams.js) and moves it when a headset asks (the line-up knobs).
// The spots come from the world feed's document: spot 1 is (0, 0), spot 2 is (dist, 0), the check mark is in `doc.checks`.
import * as THREE from 'three';
import { createWebcamView } from './webcamview.js';
import { createLensPass } from './lenspass.js';
import { createDim3d } from '../xr/dim3d.js';
import { buildPage } from './page.js';

export async function startMixedView(V) {
  const M = window.MUMR, CAL = M.webcamcal, $ = (id) => document.getElementById(id);
  const { feed, scene, camera, orbit, renderer } = V;
  buildPage(renderer.domElement);
  // how far in the past the world is drawn: the address (?delay=100), else the latency measured for this camera (the calibration mode), else 60 ms (webcamcal.js delayFor)
  let DELAY = CAL.delayFor(location.search, null);

  // what this browser keeps: the calibrations of the camera, the Show menu, which panels are rolled up. The profiles that the first version
  // of this page kept under Nudgy's names come across once (they are read from the old key while the new one is empty).
  const OLD = 'nudgy.mr.webcam.', NEW = 'mumr.webcam.';
  const LS = {
    get(k, d) {
      try {
        let v = localStorage.getItem(k);
        if (v === null && k.startsWith(NEW)) v = localStorage.getItem(OLD + k.slice(NEW.length));
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: not kept */ } },
  };
  const calib = new CAL.Calib(LS);
  const SHOW_KEY = 'mumr.webcam.show', SH = M.mixedshow, show = SH.clean(LS.get(SHOW_KEY, null));        // what is shown (the Show menu): kept in this browser, it is nobody else's business
  const WCV = createWebcamView({ calib, getSpots: () => CAL.spotsFromDoc(feed.doc), say: (t) => { $('wcNote').textContent = t; }, marksVisible: () => show.marks });
  WCV.show(true);

  const video = $('wcVideo'), dark = scene.background;
  const toV = (x, y, z) => new THREE.Vector3(x, z, -y);
  let tex = null, lastInfo = 0;
  // a camera with a lens: the overlay is bent to match its picture, which is drawn as it comes (lenspass.js); with no lens in the camera's profile this does nothing
  const lensPass = createLensPass({ renderer, scene, camera, getVideo: () => tex });
  // the room's dim (dim.js), as on the headsets; this page has no hand cutouts (and its occluders must not keep it off the walls): it covers the whole picture
  const dim = createDim3d({ THREE, scene, cutouts: false });
  const viewUpdate = orbit.update.bind(orbit);

  function info(now) {
    if (now - lastInfo < 250) return;
    lastInfo = now;
    const spread = feed.clockQuality;
    const cams = Object.values(feed.doc.cameras);
    if (!$('camNote').dataset.find) $('camNote').textContent = cams.length ? `Real cameras: ${cams.map((c) => c.name).join(', ')}.` : 'No real camera is aligned.';
    $('wcExtra').textContent = `The world is drawn ${DELAY.ms} ms in the past (${DELAY.from === 'address' ? 'the address says so' : DELAY.from === 'profile' ? 'the latency measured for this camera' : 'the usual; measure the latency of the camera in the calibration mode, or put ?delay=100 in the address'}). `
      + (ADJ.moved === false ? '' : `The camera has been moved ${(ADJ.moved * 100).toFixed(1)} cm by hand from where the clicks put it${ADJ.held ? ' (kept from the last time; waiting for the spots)' : ''} (Reset: in the headset's line-up menu; or click the spots again). `)
      + (spread === null || spread === undefined ? 'Clock: not known yet.' : spread > 5 ? `Clock spread ${spread.toFixed(1)} ms: the world will slide against the picture.` : `Clock spread ${spread.toFixed(1)} ms.`);
  }

  // ---- the Show menu: one check box for each part of the picture (mixedshow.js), and the panels that roll up
  const showBoxes = {};
  for (const item of SH.ITEMS) {
    const label = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = `show_${item.id}`; cb.checked = show[item.id];
    cb.addEventListener('change', () => { show[item.id] = cb.checked; LS.set(SHOW_KEY, show); });
    label.appendChild(cb); label.appendChild(document.createTextNode(` ${item.label}`));
    $('showList').appendChild(label); showBoxes[item.id] = cb;
  }
  let showSig = null;
  function applyShow() {                                       // (once a frame, after the view has set what it shows and before it draws)
    const r = SH.apply(V, show), sig = r.missing.join(',');
    if (sig === showSig) return;
    showSig = sig;
    for (const id of SH.PARTS) showBoxes[id].disabled = r.missing.includes(id);
    $('showNote').textContent = r.missing.length ? `This app's view does not give: ${r.missing.map((id) => SH.ITEMS.find((i) => i.id === id).label).join(', ')}.` : '';
  }
  const rolled = Object.assign({ hud: false, show: true, wc: false }, LS.get('mumr.webcam.rolled', null));      // which panels are rolled up
  for (const btn of document.querySelectorAll('button.roll')) {
    const key = btn.dataset.roll, panel = btn.closest('.rollable');
    const set = (r) => { panel.classList.toggle('rolled', r); btn.innerHTML = r ? '&#9660;' : '&#9650;'; btn.title = r ? 'Keep it rolled down (it also rolls down while the mouse is over it)' : 'Roll it up (it still rolls down while the mouse is over it)'; };
    set(!!rolled[key]);
    btn.addEventListener('click', () => { rolled[key] = !panel.classList.contains('rolled'); set(rolled[key]); LS.set('mumr.webcam.rolled', rolled); });
  }

  // ---- this page's camera as a part of the world (cams.js): announced when it is aligned and whenever it moves, taken back when it is not aligned any more or when
  // the page goes (the server also takes it away when the connection goes). Every page that shows the world draws it, small, where the real camera is; this page
  // does not draw the one it looks through. (A new id each time the page loads: a reload never meets its own old camera.)
  const CAMS = M.cams, camMarks = V.camMarks;

  // ---- the real room hides the virtual world (occluders.js): a depth-only box for each wall, table top and piece of solid furniture, from the same room scan that
  // the physics crashes into. They draw nothing; what is behind one, seen from the webcam, is cut off. Always there while the camera is placed, whatever the Show menu hides
  // of the room (it is built apart from the view's own room, which the menu switches); people and hands never occlude. Off in the free view (no camera).
  const occ = new THREE.Object3D(); occ.name = 'occluders'; occ.visible = false; scene.add(occ);
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });       // (pushed back a hair: a wall drawn on the same place shows)
  const occGeo = new THREE.BoxGeometry(1, 1, 1);
  function rebuildOcc() {
    for (const m of occ.children.slice()) occ.remove(m);
    for (const b of M.occluders.list(feed.doc.room && feed.doc.room.data)) {
      const m = new THREE.Mesh(occGeo, occMat);
      m.scale.set(b.hx * 2, b.z1 - b.z0, b.hy * 2); m.position.set(b.cx, (b.z0 + b.z1) / 2, -b.cy); m.rotation.y = b.ang; m.renderOrder = -100;      // (drawn first: the rest tests against it)
      m.updateMatrix(); m.matrixAutoUpdate = false; occ.add(m);
    }
  }
  feed.on('room', rebuildOcc); feed.on('ready', rebuildOcc); rebuildOcc();
  // A headset can move this camera by hand (its line-up knobs: camknobs.js): the place changes and the camera keeps looking at the point it looked at when the
  // clicks placed it (camadjust.js). The pose we draw from and announce is the solved one, moved. Clicking the spots again, or the headset's Reset, takes the move back.
  // The move is kept for the next launch, like the camera's profile is: this camera's solved (original) pose and the place the hand gave it are saved under its own key
  // (PoseKeeper), used again from the start of the next launch (before any headset has lined up), and given up only when the clicks, the field of view or the lens change.
  // While the spots only move a little (a player took them again a bit differently) the hand's place stays: keepNear.
  const ADJ = new M.camadjust.CamAdjust({ keepNear: 0.15, spots: () => ((CAL.spotsFromDoc(feed.doc) || {}).pts || []).filter(Boolean).map((p) => [p[0], p[1]]) });
  const KEEP = new M.camadjust.PoseKeeper(ADJ, LS);
  const r1 = (v) => (Number.isFinite(v) ? +v.toFixed(1) : v);
  const camSig = () => JSON.stringify([calib.clicks.map((c) => (c ? c.map(r1) : null)), calib.choice, +calib.fovDeg.toFixed(2), calib.a1, calib.a2, calib.W, calib.H]);
  const poseNow = () => KEEP.pose(WCV.running, calib.key, camSig(), WCV.pose(), performance.now());
  const myCam = { id: `cam-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`, last: null, sentAt: 0, announced: false };
  // (a headset asks, through the server, for this camera to be moved: session.moveCamera / resetCamera; only the owner hears it)
  feed.on('ask', (key, m) => { if (key === `cam:${myCam.id}` && m && typeof m === 'object') ADJ.ask(m); });
  function publishCamera(now, P) {
    if (!P) { if (myCam.announced) { feed.withdrawCamera(myCam.id); myCam.announced = false; myCam.last = null; } return; }
    const c = CAMS.clean({ id: myCam.id, name: calib.fovName || 'Webcam', x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch, hfov: P.hfov, aspect: P.aspect });
    if (!c) return;
    const known = !!feed.doc.cameras[myCam.id];
    if (known && myCam.last && CAMS.same(myCam.last, c)) return;                    // nothing new, and the world has it
    if (now - myCam.sentAt < (known ? 100 : 1500)) return;                          // (a moving pose at most five times a second; a camera the world does not have yet is asked for again every 1.5 s)
    if (feed.announceCamera(c)) { myCam.last = c; myCam.sentAt = now; myCam.announced = true; }
  }
  window.addEventListener('pagehide', () => { if (myCam.announced) feed.withdrawCamera(myCam.id); });
  let findAt = -1;
  const say = (text) => { const n = $('camNote'); n.textContent = text; n.dataset.find = '1'; setTimeout(() => { delete n.dataset.find; }, 6000); };      // (the answer stays a few seconds, then the list of cameras is back)
  $('showFind').addEventListener('click', () => {
    const list = Object.values(feed.doc.cameras);
    if (WCV.pose()) { say('You are looking through a camera. Open the PC view, or this page in another tab without starting the camera, to look at the room.'); return; }
    if (!list.length) { say('No camera has been aligned yet.'); return; }
    findAt = (findAt + 1) % list.length;
    const c = list[findAt], target = toV(c.x, c.y, c.z), back = new THREE.Vector3(-Math.cos(c.yaw), 0, Math.sin(c.yaw)), side = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    camera.position.copy(target).addScaledVector(back, 0.9).addScaledVector(side, 0.35).add(new THREE.Vector3(0, 0.4, 0));
    orbit.target.copy(target); viewUpdate();
    say(`${c.name}: x ${c.x.toFixed(2)}, y ${c.y.toFixed(2)}, ${c.z.toFixed(2)} m up`);
  });

  function frameCamera() {
    if (!WCV.running) {                                       // no camera: the page is the app's PC view
      orbit.enabled = true; scene.background = dark; scene.visible = true;
      return viewUpdate();
    }
    if (!tex && video.videoWidth) { tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace; }
    const P = poseNow();
    orbit.enabled = false; scene.background = tex || dark;
    scene.visible = !!P;                                      // (a camera but no solution: only its picture, to click in)
    if (!P) return false;
    camera.up.set(0, 1, 0);
    const vfov = 2 * Math.atan(Math.tan(P.hfov / 2) / P.aspect) * 180 / Math.PI;
    if (camera.fov !== vfov) { camera.fov = vfov; camera.updateProjectionMatrix(); }
    camera.position.copy(toV(P.x, P.y, P.z));
    const cp = Math.cos(P.pitch);
    camera.lookAt(camera.position.x + Math.cos(P.yaw) * cp, camera.position.y + Math.sin(P.pitch), camera.position.z - Math.sin(P.yaw) * cp);
    return false;
  }
  orbit.update = function () {
    WCV.update();
    DELAY = CAL.delayFor(location.search, calib.latencyMs); V.setDelay(DELAY.ms);
    info(performance.now());
    const out = frameCamera();
    applyShow();
    const P = poseNow();
    lensPass.setPlan(P && WCV.running ? M.overlaylens.renderPlan(calib.lens, calib.W, calib.H, P.hfov, P.aspect) : null);
    occ.visible = !!(P && show.occlude);
    // the room's dim on the picture, at the moment the picture shows (DELAY ms ago); none on the PC view, which has no real room
    const sn = feed.serverNow();
    dim.linear = !!(lensPass.plan.distort && tex);                   // (the lens pass draws the world into a linear target, over the picture)
    dim.update(WCV.running ? M.dim.level(feed.doc.dim, sn === null ? null : sn - DELAY.ms) : M.dim.level(null));
    if (camMarks) { if (P) camMarks.exclude.add(myCam.id); else camMarks.exclude.delete(myCam.id); }              // (the camera this page looks through is not drawn in it)
    publishCamera(performance.now(), P);
    return out;
  };

  window.mixed = { WCV, calib, feed, get DELAY() { return DELAY; }, show, myCam, ADJ, KEEP, occ, lensPass, dim };
  return window.mixed;
}

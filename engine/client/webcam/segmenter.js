// The person mask of the webcam's picture, for the people cutout's ML mode (peoplecut.js): MediaPipe's Image Segmenter with its selfie model, run on the
// video frame the page is about to show, its confidence copied into a texture the cutout's shader reads. Loaded only when the ML mode is first chosen,
// from jsDelivr (the library, pinned) and Google's model store (the model, pinned): the page needs the internet for it. When it cannot be had (offline, no
// GPU and no CPU fallback, a WebGL problem) `failed` says why and the page draws the crude cutout instead: people are never left uncovered because of it.
//
//   const seg = createSegmenter({ THREE, video })
//   seg.run(nowMs, box)    once a frame, just before drawing: segments the frame if it is a new one (box: the players' union in the picture, 0..1, top-left
//                          origin, or null; used only with CROP on). A slow inference (more than a frame) makes it run every other frame, the last mask kept.
//   seg.ready / seg.failed (a reason, or null) / seg.texture (THREE.DataTexture, R8, the picture's size, row 0 the picture's top) / seg.ms (the last inference)
import * as THREE_NS from 'three';

const VERSION = '0.10.14';                                                  // @mediapipe/tasks-vision, a release, pinned
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
// Segment only the players' part of the picture (their union, padded), scaled up to the model's input, instead of the whole frame: people 3 or 4 m away are
// small in a 256 px input. Off until it has been measured on a real run (docs/NOTES.md, 2026-10-31).
export const CROP = false;
const SLOW_MS = 16;                                                         // an inference longer than this: every other frame

export function createSegmenter({ THREE = THREE_NS, video }) {
  const S = { ready: false, failed: null, texture: null, ms: 0, threshold: 0.5, runs: 0 };
  let seg = null, lastT = -1, busy = false, odd = false, data = null, W = 0, H = 0, lastTs = 0;
  const crop = CROP ? document.createElement('canvas') : null, cg = crop ? crop.getContext('2d', { willReadFrequently: false }) : null;

  (async () => {
    try {
      const vision = await import(`${LIB}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${LIB}/wasm`);
      const make = (delegate) => vision.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
      try { seg = await make('GPU'); } catch (e) { seg = await make('CPU'); }
      S.ready = true;
    } catch (e) { S.failed = (e && e.message ? e.message : String(e)).slice(0, 120); }
  })();

  // the texture, the size of the picture (made again only when that changes)
  function sized(w, h) {
    if (w === W && h === H && S.texture) return;
    W = w; H = h; data = new Uint8Array(w * h);
    if (S.texture) S.texture.dispose();
    S.texture = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    S.texture.minFilter = THREE.LinearFilter; S.texture.magFilter = THREE.LinearFilter; S.texture.needsUpdate = true;
  }
  // the person's confidence of a mask into the texture, at (x0, y0) of the picture, w x h of it (the whole picture without a crop)
  function copyIn(mask, x0, y0, w, h) {
    const f = mask.getAsFloat32Array(), mw = mask.width, mh = mask.height;
    if (mw === W && mh === H && x0 === 0 && y0 === 0) { for (let i = 0; i < f.length; i++) data[i] = f[i] * 255; return; }
    for (let y = 0; y < h; y++) { const my = Math.min(mh - 1, Math.floor(y * mh / h)), row = (y0 + y) * W + x0; for (let x = 0; x < w; x++) data[row + x] = f[my * mw + Math.min(mw - 1, Math.floor(x * mw / w))] * 255; }
  }

  function run(now, box = null) {
    if (!S.ready || S.failed || busy || !video || video.readyState < 2 || !video.videoWidth) return;
    if (video.currentTime === lastT) return;                               // (the same frame as last time)
    if (S.ms > SLOW_MS && (odd = !odd)) return;                             // (slow: every other frame, the last mask kept)
    lastT = video.currentTime; busy = true;
    sized(video.videoWidth, video.videoHeight);
    const ts = Math.max(lastTs + 1, Math.round(now)); lastTs = ts;          // (the timestamps must grow)
    let src = video, x0 = 0, y0 = 0, w = W, h = H;
    if (CROP && box) {
      x0 = Math.floor(box[0] * W); y0 = Math.floor(box[1] * H); w = Math.max(16, Math.ceil((box[2] - box[0]) * W)); h = Math.max(16, Math.ceil((box[3] - box[1]) * H));
      w = Math.min(w, W - x0); h = Math.min(h, H - y0);
      if (crop.width !== w || crop.height !== h) { crop.width = w; crop.height = h; }
      cg.drawImage(video, x0, y0, w, h, 0, 0, w, h); src = crop;
      data.fill(0);                                                         // (outside the players' box: nobody)
    }
    const t0 = performance.now();
    try {
      seg.segmentForVideo(src, ts, (res) => {
        const ms = res.confidenceMasks || [];
        const m = ms.length > 1 ? ms[ms.length - 1] : ms[0];               // (a model with a background mask first: the person's is the last)
        if (m) { copyIn(m, x0, y0, w, h); S.texture.needsUpdate = true; S.runs++; }
      });
    } catch (e) { S.failed = (e && e.message ? e.message : String(e)).slice(0, 120); }
    S.ms = performance.now() - t0; busy = false;
  }

  return Object.assign(S, { run, close() { if (seg) seg.close(); if (S.texture) S.texture.dispose(); } });
}

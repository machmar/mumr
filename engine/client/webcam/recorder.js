// The webcam page's recorder: the view's canvas (the camera's picture and the world drawn over it; the panels are HTML over the canvas and are not in it) into
// an HEVC .mp4 (H.264 where this browser has no HEVC encoder), at the camera's own resolution whatever the size of the window, at the frame rate chosen.
// While it records, the renderer draws W x H pixels (the camera's picture) at a pixel ratio of 1, and the view's own resizes wait until it stops.
// A frame is taken right after the scene is drawn (renderer.render, the outermost wrapper: after the lens pass), at most `fps` a second, stamped with its
// time slot, so a slow page gives a file with gaps that still plays at the real speed. Encoded with WebCodecs, put in an .mp4 by mp4-muxer; written
// straight to the file chosen in the save dialog (or, where there is none, kept in memory and downloaded at the end).
//
//   const rec = createRecorder({ renderer, scene, getSize })   getSize: () => [W, H] of the camera's picture, or null when no camera runs
//   await rec.start(fps)   rec.stop()   rec.on   rec.text (what it is doing, for the panel)
import * as THREE from 'three';

const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm';
const HEVC = ['hvc1.1.6.L153.B0', 'hvc1.1.6.L150.B0', 'hvc1.1.6.L123.B0', 'hvc1.1.6.L120.B0'];      // (Main profile; the level is only a ceiling)
const AVC = ['avc1.640033', 'avc1.640028'];

export function createRecorder({ renderer, scene, getSize }) {
  const render = renderer.render.bind(renderer), setSize = renderer.setSize.bind(renderer), setPixelRatio = renderer.setPixelRatio.bind(renderer);
  let R = null, text = '';
  const held = { size: null, ratio: null };                   // what the view asked for while recording: given back at the end

  async function pickCodec(w, h, fps) {
    for (const [list, kind, name] of [[HEVC, 'hevc', 'HEVC'], [AVC, 'avc', 'H.264']]) {
      for (const codec of list) {
        const config = { codec, width: w, height: h, framerate: fps, bitrate: Math.round(w * h * fps * 0.12), alpha: 'discard', latencyMode: 'quality' };
        if (kind === 'avc') config.avc = { format: 'avc' };
        try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, kind, name }; } catch (e) { /* not this one */ }
      }
    }
    return null;
  }

  async function start(fps) {
    if (R) return;
    const size = getSize();
    if (!size) { text = 'Start the camera first.'; return; }
    if (typeof VideoEncoder === 'undefined') { text = 'This browser cannot encode video (no WebCodecs).'; return; }
    const w = size[0] & ~1, h = size[1] & ~1;
    const pick = await pickCodec(w, h, fps);
    if (!pick) { text = `No HEVC or H.264 encoder for ${w} x ${h} at ${fps} fps.`; return; }
    const name = `webcam-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.mp4`;
    // the file first (the save dialog needs the click that started this), then the muxer
    let file = null;
    if (window.showSaveFilePicker) {
      try { file = await (await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] })).createWritable(); }
      catch (e) { if (e.name === 'AbortError') { text = ''; return; } file = null; }
    }
    let MP4;
    try { MP4 = await import(MUXER); } catch (e) { if (file) await file.abort(); text = `Could not load the muxer (${e.message}).`; return; }
    const target = file ? new MP4.FileSystemWritableFileStreamTarget(file) : new MP4.ArrayBufferTarget();
    const muxer = new MP4.Muxer({ target, video: { codec: pick.kind, width: w, height: h, frameRate: fps }, fastStart: file ? false : 'in-memory', firstTimestampBehavior: 'offset' });
    const r = { fps, w, h, name, file, target, muxer, kind: pick.name, t0: performance.now(), slot: -1, frames: 0, dropped: 0, error: null };
    r.enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { r.error = e.message; stop(); } });
    r.enc.configure(pick.config);
    R = r;
    // the camera's own resolution, whatever the window: the view's resizes are held until the end
    held.ratio = renderer.getPixelRatio(); const s = new THREE.Vector2(); renderer.getSize(s); held.size = [s.x, s.y];
    setPixelRatio(1); setSize(w, h, false);
    text = `Recording ${w} x ${h}, ${fps} fps, ${r.kind}...`;
  }

  // (the view sizes the canvas for the window: while recording, only remembered)
  renderer.setSize = function (w, h, css) { if (R) { held.size = [w, h]; return; } return setSize(w, h, css); };
  renderer.setPixelRatio = function (p) { if (R) { held.ratio = p; return; } return setPixelRatio(p); };

  renderer.render = function (s, c) {
    const out = render(s, c);
    if (R && s === scene && renderer.getRenderTarget() === null) grab(R);
    return out;
  };

  function grab(r) {
    if (r.error) return;
    const size = getSize();
    if (!size) { stop(); return; }                             // (the camera stopped)
    const slot = Math.round((performance.now() - r.t0) * r.fps / 1000);
    if (slot <= r.slot) return;
    if (r.enc.encodeQueueSize > 6) { r.dropped++; return; }    // (the encoder is behind: this frame is left out rather than the page slowing down)
    r.slot = slot;
    const frame = new VideoFrame(renderer.domElement, { timestamp: Math.round(slot * 1e6 / r.fps), duration: Math.round(1e6 / r.fps) });
    r.enc.encode(frame, { keyFrame: r.frames % (r.fps * 2) === 0 });
    frame.close();
    r.frames++;
    text = `Recording ${r.w} x ${r.h}, ${r.fps} fps, ${r.kind}: ${fmt(slot / r.fps)}${r.dropped ? `, ${r.dropped} frames left out` : ''}`;
  }

  async function stop() {
    const r = R;
    if (!r) return;
    R = null;
    setPixelRatio(held.ratio); setSize(held.size[0], held.size[1], false);
    window.dispatchEvent(new Event('resize'));                 // (the view sizes its camera again)
    text = 'Saving...';
    try {
      if (r.enc.state !== 'closed') { await r.enc.flush(); r.enc.close(); }
      r.muxer.finalize();
      if (r.file) await r.file.close();
      else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.target.buffer], { type: 'video/mp4' })); a.download = r.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      }
      text = r.error ? `Stopped: ${r.error}. Saved what was recorded.` : `Saved ${r.file ? '' : `${r.name} `}(${fmt(Math.max(0, r.slot) / r.fps)}, ${r.kind}).`;
    } catch (e) {
      text = `Could not save: ${r.error || e.message}`;
      if (r.file) { try { await r.file.abort(); } catch (e2) { /* gone */ } }
    }
  }

  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  return { start, stop, get on() { return !!R; }, get text() { return text; } };
}

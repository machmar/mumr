// The wire packet (net.js) and the replay (replay.js) with no physics.
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const N = require('./net.js');
const R = require('./replay.js');
const S = require('./spec.js');
const Q = M.physics.quat;

const items = (n = 55, f = 0) => Array.from({ length: n }, (_, i) => ({ i, flags: i % 16, p: [i * 0.01 + f, 1 - i * 0.003, 0.72 + i * 0.001], q: Q.normalize([0.1 * i, -0.2, 0.3, 0.9 - 0.01 * i]) }));
const sample = (f = 0, mode = 0, progress = 0) => ({ mode, progress, items: items(55, f) });

test('the packet carries all 55 bodies in 1.2 KB and comes out as it went in (positions to f32, orientations to 3e-5)', () => {
  const o = sample(0.5, 3, 0.4), bytes = N.pack(o);
  assert.strictEqual(bytes.length, 4 + 55 * 22);
  const d = N.unpack(new DataView(bytes.buffer));
  assert.strictEqual(d.mode, 3); assert.ok(Math.abs(d.progress - 0.4) < 1 / 255);
  assert.strictEqual(d.items.length, 55);
  d.items.forEach((it, k) => {
    assert.strictEqual(it.i, k); assert.strictEqual(it.flags, o.items[k].flags);
    it.p.forEach((v, j) => assert.ok(Math.abs(v - o.items[k].p[j]) < 1e-6));
    it.q.forEach((v, j) => assert.ok(Math.abs(v - o.items[k].q[j]) < 5e-5, `q ${k} ${j}`));
  });
});

test('a packet that is not one is refused, not drawn: a short body, a body that does not exist, one twice, a position that is not a number', () => {
  const good = N.pack(sample()), view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.ok(N.unpack(view(good)));
  assert.strictEqual(N.unpack(view(good.slice(0, 50))), null);
  const bad = good.slice(); bad[4] = 99; assert.strictEqual(N.unpack(view(bad)), null, 'body 99');
  const twice = good.slice(); twice[4 + 22] = 0; assert.strictEqual(N.unpack(view(twice)), null, 'body 0 twice');
  const nan = good.slice(); new DataView(nan.buffer).setFloat32(4 + 2, NaN, true); assert.strictEqual(N.unpack(view(nan)), null);
  assert.strictEqual(N.unpack(view(new Uint8Array(2))), null);
});

test('it is a registered wire type held by the token jenga, whole through encode and decode', () => {
  const s = M.wire.spec('jenga');
  assert.strictEqual(s.type, 23); assert.strictEqual(s.token, 'jenga');
  const buf = M.wire.encode('jenga', sample(1), 12345), p = M.wire.decode(buf);
  assert.strictEqual(p.name, 'jenga'); assert.strictEqual(p.clock, 12345); assert.strictEqual(p.data.items.length, 55);
});

test('blend: half way between two packets is half way in place and in orientation; the mode is the newer one', () => {
  const a = sample(0, 3, 0.2), b = sample(1, 4, 0.6), m = N.blend(a, b, 0.5);
  assert.strictEqual(m.mode, 4); assert.ok(Math.abs(m.progress - 0.4) < 1e-9);
  assert.ok(Math.abs(m.items[7].p[0] - (a.items[7].p[0] + 0.5)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...m.items[7].q) - 1) < 1e-6, 'a unit orientation');
  assert.strictEqual(N.blend(a, { mode: 0, progress: 0, items: [] }, 0.5).items.length, 0, 'unlike packets: the newer');
});

test('the page draws the host 60 ms in the past, between two packets, and starts again when the holder changes', () => {
  const st = new N.Stream(60);
  for (let k = 0; k < 4; k++) st.feed(sample(k), { clock: 1000 + k * 22, now: 5000 + k * 22, first: k === 0 });
  const at = (ms) => st.at(5000 + ms + 60).items[0].p[0];                              // (the host's 1000 is our 5000)
  assert.ok(Math.abs(at(11) - 0.5) < 1e-6, `between the first two: ${at(11)}`);
  assert.ok(Math.abs(at(66) - 3) < 1e-6, 'at the newest');
  assert.ok(st.at(5000).items[0].p[0] <= 0.0 + 1e-9, 'before the first: the first');
  assert.strictEqual(st.feed(sample(9), { clock: 1000, now: 5100, first: false }), false, 'a packet older than the newest is dropped');
  st.feed(sample(7), { clock: 9000, now: 9100, first: true });
  assert.strictEqual(st.buf.length, 1, 'a new holder starts the buffer again');
});

test('the recorder keeps the last seconds at 30 a second, and the last two seconds end with the exact state', () => {
  const rec = new R.Recorder(), body = (x) => [{ p: [x, 0, 0.8], q: [0, 0, 0, 1] }], keep = R.REPLAY.keepSecs;
  for (let t = 0; t < 6000; t += 11) rec.push(t, body(t / 1000));
  assert.ok(rec.frames.length <= keep * 30 + 3 && rec.frames.length >= keep * 30 - 3, `${rec.frames.length} frames`);
  assert.ok(5990 - rec.frames[0].t <= keep * 1000 + 40);
  const w = rec.take(6000, body(6), 2);
  assert.ok(w[0].t >= 4000 - 1 && w.at(-1).t === 6000);
  assert.ok(Math.abs(w.at(-1).a[0] - 6) < 1e-6, 'the last frame is the exact state');
});

test('the replay: frozen, rewound to the first frame, then forwards with a speed curve (slowest at the hit), then done; skip ends it', () => {
  const rec = new R.Recorder(), span = R.REPLAY.span;
  for (let t = 0; t <= span; t += 10) rec.push(t, [{ p: [t / 1000, 0, 1], q: [0, 0, 0, 1] }]);
  const end = span / 1000, frames = rec.take(span, [{ p: [end, 0, 1], q: [0, 0, 0, 1] }], end), hitAt = span - R.REPLAY.follow, r = new R.Replay(frames, { hitAt });
  assert.strictEqual(r.step(300).mode, 1, 'frozen at first'); assert.strictEqual(r.step(300).pose, null);
  const rw = r.step(100 + R.REPLAY.rewindMs / 2);                    // half way through the rewind
  assert.strictEqual(rw.mode, 2); assert.ok(rw.pose[0] < end - 0.3 && rw.pose[0] > 0.3, `rewinding: half way back (${rw.pose[0]})`);
  let last = r.step(R.REPLAY.rewindMs / 2 + 1), prev = -1, rates = [];
  assert.ok(last.pose[0] < 0.05, `back at the first frame (${last.pose[0]})`);
  for (let k = 0; k < 2000 && !last.done; k++) { last = r.step(20); if (last.mode === 3) { assert.ok(last.pose[0] >= prev - 1e-6, 'forwards'); prev = last.pose[0]; rates.push([last.pose[0] * 1000, last.rate]); } }
  assert.ok(last.done); assert.ok(Math.abs(last.pose[0] - end) < 1e-6, 'ends on the exact state');
  const at = (ms) => rates.reduce((b, q) => (Math.abs(q[0] - ms) < Math.abs(b[0] - ms) ? q : b))[1];
  assert.ok(at(hitAt) < at(200) && at(hitAt) < at(span - 50) && at(hitAt) < 0.3, `slowest at the hit (${at(200).toFixed(2)}, ${at(hitAt).toFixed(2)}, ${at(span - 50).toFixed(2)})`);
  assert.ok(r.slowMs > span * 1.4, `slower than it happened (${r.slowMs.toFixed(0)} ms for ${span})`);
  const s = new R.Replay(frames); s.skip(); assert.strictEqual(s.step(1).done, true);
  const tr = R.trail(frames, 0, 5);
  assert.ok(tr.length > 5 && tr[0][0] < 0.05 && Math.abs(tr.at(-1)[0] - end) < 1e-9, 'the path from the first frame to the exact last');
});

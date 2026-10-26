// The markers of the screen (screencodes.js): the dictionary keeps its distances, the corners and the board fit any screen, and the detector can pick the largest copy.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const SC = M.screencodes, MK = M.markers;

const POP = (x) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };
const turn = (code) => { let out = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((code >> (r * 4 + c)) & 1) out |= 1 << (c * 4 + (3 - r)); return out; };
const turns = (c) => { const t = [c]; for (let i = 0; i < 3; i++) t.push(turn(t[i])); return t; };
const apart = (a, b) => Math.min(...turns(b).map((t) => POP(a ^ t)));

test('the dictionary: enough codes, no two closer than 4 bits in any turn, none like its own turn, none like the printed sheet\'s', () => {
  const C = SC.CODES;
  assert.ok(C.length >= SC.BOARD_FIRST + 32, `${C.length} codes`);
  assert.strictEqual(new Set(C).size, C.length);
  for (let i = 0; i < C.length; i++) {
    assert.ok(POP(C[i]) >= 4 && POP(C[i]) <= 12, `code ${i} is neither nearly all black nor all white`);
    for (const t of turns(C[i]).slice(1)) assert.ok(POP(C[i] ^ t) >= 4, `code ${i} against its own turn`);
    for (const f of MK.FOV_CODES) assert.ok(apart(C[i], f) >= 4, `code ${i} against the printed sheet`);
    for (let j = i + 1; j < C.length; j++) assert.ok(apart(C[i], C[j]) >= 4, `codes ${i} and ${j}`);
  }
});

test('the four corner markers sit in the four corners of any screen, with their white tiles inside it, and do not overlap', () => {
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 800], [2560, 1440], [800, 600]]) {
    const c = SC.corners({ w, h });
    assert.deepStrictEqual(c.map((m) => m.id), SC.CORNER_IDS);
    assert.ok(c[0].x < w / 2 && c[0].y < h / 2 && c[1].x > w / 2 && c[1].y < h / 2 && c[2].x > w / 2 && c[2].y > h / 2 && c[3].x < w / 2 && c[3].y > h / 2, 'top left, top right, bottom right, bottom left');
    for (const m of c) { const t = SC.tile(m); assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= w && t.y + t.h <= h, `${w}x${h}: tile inside`); assert.ok(m.side >= h * 0.1, 'big enough to be seen from far away'); }
    assert.ok(c[0].x + c[0].side < c[1].x, 'the two on top do not touch');
  }
});

test('the board fills the screen with markers that have their own tiles, unique ids from BOARD_FIRST, and a quiet zone of at least one cell between them', () => {
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 800], [2560, 1440], [800, 600], [1000, 1000]]) {
    const b = SC.board({ w, h });
    assert.strictEqual(b.markers.length, b.cols * b.rows); assert.ok(b.cols >= 5 && b.cols <= 8 && b.rows === 4);
    assert.ok(SC.BOARD_FIRST + b.markers.length <= SC.CODES.length, 'there are codes for all of them');
    assert.deepStrictEqual(b.markers.map((m) => m.id), b.markers.map((_, i) => SC.BOARD_FIRST + i));
    const tiles = b.markers.map(SC.tile);
    for (const t of tiles) assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= w + 1e-9 && t.y + t.h <= h + 1e-9, `${w}x${h}: tile inside the screen`);
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], c = tiles[j];
      assert.ok(a.x + a.w <= c.x + 1e-9 || c.x + c.w <= a.x + 1e-9 || a.y + a.h <= c.y + 1e-9 || c.y + c.h <= a.y + 1e-9, `tiles ${i} and ${j} overlap`);
    }
    assert.ok(b.markers[0].side >= h / 10, `${w}x${h}: big enough: ${b.markers[0].side}`);
  }
});

test('cornerPoint gives the corners in the order markers.js uses', () => {
  const m = { id: 5, x: 10, y: 20, side: 30 };
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => SC.cornerPoint(m, i)), [[10, 20], [40, 20], [40, 50], [10, 50]]);
});

// ---- the detector with a dictionary of its own, and 'prefer: largest'
function paint(img, W, m, code, tile = true) {
  const q = m.side / 6;
  const fill = (x0, y0, x1, y1, v) => { for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) img[y * W + x] = v; };
  if (tile) fill(m.x - q, m.y - q, m.x + m.side + q, m.y + m.side + q, 235);
  const cells = MK.cellsOf(code);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (cells[r * 6 + c]) fill(m.x + c * q, m.y + r * q, m.x + (c + 1) * q, m.y + (r + 1) * q, 20);
}

test('detect with the screen dictionary finds a marker; with prefer largest the biggest copy of an id wins, by default the better read', () => {
  const W = 640, H = 400, img = new Uint8Array(W * H).fill(30);
  const big = { x: 300, y: 60, side: 120 }, small = { x: 60, y: 200, side: 48 };
  paint(img, W, big, SC.CODES[2]); paint(img, W, small, SC.CODES[2]); paint(img, W, { x: 480, y: 250, side: 60 }, SC.CODES[7]);
  const some = MK.detect(img, W, H, { codes: SC.CODES, prefer: 'largest' });
  assert.deepStrictEqual(some.map((m) => m.id), [2, 7]);
  const two = some.find((m) => m.id === 2);
  assert.ok(Math.abs(two.size - 120) < 3 && Math.abs(two.corners[0][0] - 300) < 2 && Math.abs(two.corners[0][1] - 60) < 2, `the big one: ${two.size}`);
  // a copy that is read with one wrong cell is smaller here, but the default would take the cleaner read of the small one if that one were the exact one: make the big one dirty
  const dirty = new Uint8Array(img); { const q = big.side / 6; for (let y = Math.round(big.y + 2 * q); y < Math.round(big.y + 3 * q); y++) for (let x = Math.round(big.x + 2 * q); x < Math.round(big.x + 3 * q); x++) dirty[y * W + x] = dirty[y * W + x] > 100 ? 20 : 235; }
  const byBits = MK.detect(dirty, W, H, { codes: SC.CODES }).find((m) => m.id === 2), byLarge = MK.detect(dirty, W, H, { codes: SC.CODES, prefer: 'largest' }).find((m) => m.id === 2);
  assert.ok(byBits.size < 60, 'by default the exact read of the small copy wins'); assert.ok(byLarge.size > 100, 'with prefer largest the big one wins even with a wrong cell');
});

test('the printed sheet is not mistaken for a marker of the screen, and the screen\'s markers are not read as the sheet\'s', () => {
  const W = 400, H = 300, img = new Uint8Array(W * H).fill(30);
  paint(img, W, { x: 100, y: 80, side: 90 }, MK.FOV_CODES[1]);
  assert.deepStrictEqual(MK.detect(img, W, H, { codes: SC.CODES }), []);
  const img2 = new Uint8Array(W * H).fill(30); paint(img2, W, { x: 100, y: 80, side: 90 }, SC.CODES[9]);
  assert.deepStrictEqual(MK.detect(img2, W, H), []);
});

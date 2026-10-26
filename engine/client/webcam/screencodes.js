// The markers that the calibration mode shows on the laptop's screen: the dictionary, the four corner markers of the aim step, and the board of the distortion step.
// No THREE and no DOM. A marker is 6 x 6 cells (markers.js): a black ring and 4 x 4 code cells. A screen is drawn light on dark, so every marker sits on a white tile that
// reaches one cell (a sixth of the marker's side) beyond it, which is what the detector needs round a marker.
//
//   CODES               the dictionary (index = marker id); made by tools/make_screen_codes.py 36 1: no two closer than 4 bits in any of the four turns (a marker with one wrong cell is
//                       still read right), none like a turn of the printed field-of-view sheet's codes, so the sheet is never taken for the screen
//   corners({ w, h })   the four corner markers of the aim step, ids 0 to 3: top left, top right, bottom right, bottom left; [{ id, x, y, side }] in screen pixels (x, y: the marker's top left)
//   board({ w, h })     the board: { cols, rows, pitch, side, markers: [{ id, x, y, side }] } filling a screen of w x h, ids from BOARD_FIRST on, row by row
//   tile(m)             the white tile under a marker: { x, y, w, h }
//   cornerPoint(m, i)   the marker's corner i (0 top left, 1 top right, 2 bottom right, 3 bottom left), in the same order as markers.js gives them
(function (M) {
  const CODES = [1607, 9451, 57640, 61196, 49681, 16625, 38107, 50675, 58190, 20863, 10264, 431, 26592, 43561, 32173, 49144, 21521, 52631, 46681, 11549, 63388, 25903, 15894, 353, 38282, 3102, 25473, 65108, 3876, 30980, 7561, 47397, 1298, 8054, 24788, 17606];
  const CORNER_IDS = [0, 1, 2, 3];
  const BOARD_FIRST = 4, BOARD_ROWS = 4, MIN_COLS = 5, MAX_COLS = 8;       // (8 x 4 = 32 board markers + 4 corners = 36 codes)
  const SIDE = 0.72;                                                       // the marker's side as a part of the board's pitch: the rest is the quiet zone between markers (0.28 > 2 / 6)

  const tile = (m) => { const q = m.side / 6; return { x: m.x - q, y: m.y - q, w: m.side + 2 * q, h: m.side + 2 * q }; };
  const cornerPoint = (m, i) => [[m.x, m.y], [m.x + m.side, m.y], [m.x + m.side, m.y + m.side], [m.x, m.y + m.side]][i];

  function corners({ w, h }) {
    const side = Math.round(h * 0.13), pad = Math.round(h * 0.02 + side / 6);
    return [{ id: 0, x: pad, y: pad, side }, { id: 1, x: w - pad - side, y: pad, side }, { id: 2, x: w - pad - side, y: h - pad - side, side }, { id: 3, x: pad, y: h - pad - side, side }];
  }

  function board({ w, h }) {
    const rows = BOARD_ROWS, cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(rows * w / h)));
    const pitch = Math.min(w / (cols + 0.5), h / (rows + 0.5)), side = pitch * SIDE;
    const x0 = (w - cols * pitch) / 2 + (pitch - side) / 2, y0 = (h - rows * pitch) / 2 + (pitch - side) / 2, markers = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) markers.push({ id: BOARD_FIRST + r * cols + c, x: x0 + c * pitch, y: y0 + r * pitch, side });
    return { cols, rows, pitch, side, markers };
  }

  M.screencodes = { CODES, CORNER_IDS, BOARD_FIRST, corners, board, tile, cornerPoint };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));

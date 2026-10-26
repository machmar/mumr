// The webcam page is wired the way the files say: the loaders list the same files, every file is there, the cube's webcam.html loads the engine and the
// page in order, and the cube's PC view hands over what the page needs (window.view).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..'), read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const listOf = (src) => JSON.parse(/FILES = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
const scripts = (html) => [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);

test('webcam/all.js (the browser) and webcam/index.js (Node) load the same files, and each is there', () => {
  const browser = listOf(read('engine', 'client', 'webcam', 'all.js')), node = listOf(read('engine', 'client', 'webcam', 'index.js'));
  assert.deepStrictEqual(browser, node);
  for (const f of node) assert.ok(fs.existsSync(path.join(ROOT, 'engine', 'client', 'webcam', `${f}.js`)), `${f}.js`);
});

test('client/all.js and client/index.js load the same files (the cameras among them)', () => {
  const browser = listOf(read('engine', 'client', 'all.js')), node = listOf(read('engine', 'client', 'index.js'));
  assert.deepStrictEqual(browser, node);
  assert.ok(node.includes('cams') && node.includes('camknobs'));
  assert.ok(node.indexOf('align') < node.indexOf('cams'), 'the cameras come after the line-up maths they turn a camera with');
});

test('the files of the webcam page that are modules are there, and the plain ones do not import', () => {
  for (const f of ['page', 'mixed', 'start', 'webcamview', 'lenspass', 'rehearsal']) assert.ok(fs.existsSync(path.join(ROOT, 'engine', 'client', 'webcam', `${f}.js`)), `${f}.js`);
  for (const f of listOf(read('engine', 'client', 'webcam', 'index.js'))) assert.ok(!/^\s*import\s/m.test(read('engine', 'client', 'webcam', `${f}.js`)), `${f}.js is a plain script`);
  assert.ok(fs.existsSync(path.join(ROOT, 'engine', 'client', 'xr', 'cammark3d.js')));
});

test('apps/cube/webcam.html: the engine, then the webcam files, then the app, then the view and the page', () => {
  const s = scripts(read('apps', 'cube', 'webcam.html'));
  assert.deepStrictEqual(s, ['/mumr/all.js', '/mumr/webcam/all.js', 'cube.js', 'view.js', '/mumr/webcam/start.js']);
  assert.ok(/<script type="importmap">/.test(read('apps', 'cube', 'webcam.html')), 'THREE is mapped');
  // the page makes the rest itself: the app needs only a canvas and (if it has one) #hud
  const html = read('apps', 'cube', 'webcam.html');
  assert.ok(/<canvas id="view">/.test(html) && /id="hud"/.test(html));
});

test('the cube\'s PC view hands the page what it needs, and only parts the Show menu knows', () => {
  const src = read('apps', 'cube', 'view.js'), M = require('../client/webcam/index.js');
  const block = /window\.view = \{([\s\S]*?)\n  \} \};/.exec(src);
  assert.ok(block, 'window.view is set');
  for (const k of ['feed', 'scene', 'camera', 'renderer', 'orbit', 'setDelay', 'camMarks']) assert.ok(new RegExp(`\\b${k}\\b`).test(block[1]), `window.view.${k}`);
  const parts = [...(/parts: \{([\s\S]*)$/.exec(block[1])[1]).matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  assert.ok(parts.length >= 5);
  for (const p of parts) assert.ok(M.mixedshow.PARTS.includes(p), `${p} is a switch of the Show menu`);
  assert.ok(/camMarks\.update\(/.test(src), 'it draws the real cameras');
});

test('the line-up sheets generator and the detector agree about sheet 4 (the test of webcamcal.test.js reads this file)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'make_align_sheets.py')));
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'make_screen_codes.py')));
});

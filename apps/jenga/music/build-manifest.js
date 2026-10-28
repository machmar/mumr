// Makes tracks.json from the tracks you put in the scene folders:
//   music/calm/  music/build/  music/tense/  music/danger/  music/finale/  music/win/       (any number of .mp3 .ogg .m4a .wav .flac .opus files in each)
//   node apps/jenga/music/build-manifest.js
// The pages and the host read tracks.json (the host when it changes). Several tracks in a scene are taken in turn (the same one on every headset),
// each crossfaded into the next over 30 seconds; a scene with no tracks keeps the music of the nearest one. See README.md for what belongs where.
// It also writes each track's length (s), so that the host knows when a track is about to end: an mp3's from its frames, anything else's
// from ffmpeg if it is installed (a track with no length loops on the pages).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCENES = ['calm', 'build', 'tense', 'danger', 'finale', 'win'], EXT = /\.(mp3|ogg|m4a|wav|flac|opus|aac)$/i;

// An mp3's length (s) from its frames, or null: after an ID3v2 tag, frame after frame (MPEG 1, 2 and 2.5, layers I to III); a stretch of
// something else is skipped over to the next place where two frames follow each other.
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const KBPS = { '3,3': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], '3,2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], '3,1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2,3': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], '2,2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
function frameAt(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, br = b[i + 2] >> 4, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (ver === 1 || layer === 0 || br === 0 || br === 15 || sr === 3) return null;
  const rate = RATES[ver][sr], kbps = KBPS[`${ver === 3 ? 3 : 2},${ver === 3 ? layer : layer === 3 ? 3 : 2}`][br] * 1000;
  if (layer === 3) return { len: Math.floor((12 * kbps) / rate + pad) * 4, samples: 384, rate };
  const samples = layer === 2 || ver === 3 ? 1152 : 576;
  return { len: Math.floor(((samples / 8) * kbps) / rate) + pad, samples, rate };
}
function mp3Length(b) {
  let i = 0, secs = 0, frames = 0;
  if (b.length > 10 && b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f)) + (b[5] & 0x10 ? 10 : 0);
  while (i < b.length) {
    const f = frameAt(b, i);
    if (f && f.len > 4 && (i + f.len >= b.length || frameAt(b, i + f.len) || frames > 0)) { secs += f.samples / f.rate; frames++; i += f.len; continue; }
    i++;
  }
  return frames ? secs : null;
}
// any other file's length from ffmpeg's "Duration: 00:04:12.34", or null
function ffmpegLength(file) {
  try { const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' }); const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; } catch (e) { return null; }
}
function lengthOf(file) {
  const secs = /\.mp3$/i.test(file) ? mp3Length(fs.readFileSync(file)) : ffmpegLength(file);
  return secs ? Math.round(secs * 100) / 100 : null;
}

function build(dir = __dirname) {
  const scenes = {}, lengths = {};
  for (const s of SCENES) {
    const d = path.join(dir, s);
    scenes[s] = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => EXT.test(f)).sort().map((f) => `${s}/${f}`) : [];
    for (const f of scenes[s]) { const l = lengthOf(path.join(dir, f)); if (l) lengths[f] = l; }
  }
  const old = fs.existsSync(path.join(dir, 'tracks.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tracks.json'), 'utf8')) : {};
  return Object.assign({ crossfade: old.crossfade || 30, rise: old.rise || 9, fades: old.fades || { finale: 6, win: 12 } }, old.anywhere ? { anywhere: old.anywhere } : {}, { scenes, lengths });
}
if (require.main === module) {
  const m = build();
  fs.writeFileSync(path.join(__dirname, 'tracks.json'), `${JSON.stringify(m, null, 2)}\n`);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  for (const s of SCENES) console.log(`${s.padEnd(7)} ${m.scenes[s].length ? m.scenes[s].map((f) => `${path.basename(f)} (${m.lengths[f] ? mmss(m.lengths[f]) : 'length not known: it loops'})`).join(', ') : '(no tracks)'}`);
  console.log(`crossfade ${m.crossfade} s (a tenser scene ${m.rise} s), finale ${m.fades.finale} s, win ${m.fades.win} s: tracks.json written`);
}
module.exports = { build, SCENES, mp3Length };

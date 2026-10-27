// Makes tracks.json from the tracks you put in the scene folders:
//   music/calm/  music/build/  music/tense/  music/danger/  music/finale/  music/win/       (any number of .mp3 .ogg .m4a .wav .flac .opus files in each)
//   node apps/jenga/music/build-manifest.js
// The pages read tracks.json when they load. Several tracks in a scene are taken in turn (the same one on every headset), each crossfaded into
// the next over 30 seconds; a scene with no tracks keeps the music of the nearest one. See README.md for what belongs where.
const fs = require('node:fs');
const path = require('node:path');

const SCENES = ['calm', 'build', 'tense', 'danger', 'finale', 'win'], EXT = /\.(mp3|ogg|m4a|wav|flac|opus|aac)$/i;
function build(dir = __dirname) {
  const scenes = {};
  for (const s of SCENES) {
    const d = path.join(dir, s);
    scenes[s] = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => EXT.test(f)).sort().map((f) => `${s}/${f}`) : [];
  }
  const old = fs.existsSync(path.join(dir, 'tracks.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tracks.json'), 'utf8')) : {};
  return { crossfade: old.crossfade || 30, fades: old.fades || { finale: 6, win: 12 }, scenes };
}
if (require.main === module) {
  const m = build();
  fs.writeFileSync(path.join(__dirname, 'tracks.json'), `${JSON.stringify(m, null, 2)}\n`);
  for (const s of SCENES) console.log(`${s.padEnd(7)} ${m.scenes[s].length ? m.scenes[s].join(', ') : '(no tracks)'}`);
  console.log(`crossfade ${m.crossfade} s, finale ${m.fades.finale} s, win ${m.fades.win} s: tracks.json written`);
}
module.exports = { build, SCENES };

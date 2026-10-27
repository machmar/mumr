// The template app: what an app gives MUMR (settings, buttons, a menu) on createApp, which does the rest: the scene, the headset, the
// wrist menu, lining up, the other players, the desktop rehearsal.
//   node tools/run.js jenga --http          two tabs: /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40
// Add things that move with `bodies` (docs/HOWTO-NEW-APP.md, section 3), and what you draw with `setup` and `draw`.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp } from '/mumr/xr/app.js';

const A = window.APP;

const app = await createApp({
  THREE, OrbitControls, anchorKey: 'mumr.jenga.anchor',
  session: { game: A.GAME, player: A.PLAYER, actions: A.ACTIONS, press: A.press },
  menu: A.menu,
  onAction: (id, from) => { if (id === 'hello') app.say(from === app.S.me || from === null ? 'Hello' : `Player ${from + 1} says hello`); },
  status: () => `count ${app.S.game('count')}`,
});
window.__app = app;

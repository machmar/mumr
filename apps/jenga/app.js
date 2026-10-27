// MUMR jenga: one tower of 54 wooden blocks (twice the real size) for everybody in the room. Push a block out with a finger or pinch it and
// pull, put it on the top; the menu says whose turn it is, how many blocks were moved and when the tower fell (and whose hand was last on
// it). "New tower" puts one in front of whoever pressed it, on the table there if there is one.
// The host on the PC simulates the tower (jenga.js says why); this page sends its hands and draws what the host sends. With no host, the
// page whose hand is on the tower simulates it.
//   node tools/run.js jenga                  headsets: https://<PC>:8443/
//   node tools/run.js jenga --http           two tabs: /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp, PLAYER_COLOURS } from '/mumr/xr/app.js';

const J = window.JENGA, Q = window.MUMR.physics.quat;
const tower = new J.Tower(), meshes = [];
tower.pw.budgetMs = 10;                    // (simulated here, with no host: a frame that has used 10 ms of physics runs slow instead of late)
let app = null, lastDraw = 0, mine = true, said = null;

const common = (sources) => (app.space.ok ? sources.map((s) => J.commonSource(s, (p) => app.space.toCommon(p))) : sources);
const toPlan = (p) => (app.space.ok ? app.space.fromCommon(p) : p);
const levels = () => Math.max(0, tower.level(tower.top()) + 1);
const who = (slot) => (slot === null || slot === undefined ? 'nobody' : slot === app.S.me ? 'you' : `player ${slot + 1}`);

app = await createApp({
  THREE, OrbitControls, anchorKey: 'mumr.jenga.anchor',
  session: J.SESSION,
  menu: (st, info) => J.menu(st, Object.assign({}, info, app ? { game: J.game(app.S), me: app.S.me, levels: levels() } : {})),
  handMask: true,
  ghostColour: 'grips',
  bodies: ({ S }) => [{ token: J.TOKEN, type: J.PACKET.name, adapter: J.adapter(tower, S, (s) => common(s)) }],
  setup: ({ world, S, life }) => {
    const geo = new THREE.BoxGeometry(J.L, J.T, J.W), edges = new THREE.EdgesGeometry(geo);
    for (let i = 0; i < J.N; i++) {
      const wood = new THREE.Color(0xd8b27a).offsetHSL(((i * 37) % 11 - 5) * 0.004, 0, ((i * 53) % 9 - 4) * 0.012);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: wood, roughness: 0.7, metalness: 0 }));
      m.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x5a4126, transparent: true, opacity: 0.6 })));
      m.userData.wood = wood; world.add(m); meshes.push(m);
    }
    J.wire(tower, S);
    // what happened, at every headset
    S.on('jenga', (g) => {
      if (!app) return;
      const key = `${g.round}:${g.state}:${g.moves}`;
      if (key === said) return;
      said = key;
      if (g.state === 'fell') { app.say(`The tower fell!${g.by !== null ? ` (${who(g.by)})` : ''}`); life(`jenga: round ${g.round}: the tower fell after ${g.moves} moves (last hand: ${g.by === null ? 'nobody' : `player ${g.by + 1}`})`); }
      else if (g.moves === 0) { app.say(`New tower: ${g.turn === S.me ? 'your' : `${who(g.turn)}'s`} turn`); life(`jenga: round ${g.round}: a new tower`); }
      else { app.say(`${g.last === S.me ? 'You' : who(g.last)} moved a block. ${g.turn === S.me ? 'Your' : `${who(g.turn)}'s`} turn`); life(`jenga: move ${g.moves} by player ${g.last + 1}`); }
    });
  },
  step: (dt, t, hands) => {
    const S = app.S;
    tower.me = S.me;
    tower.room = S.connected && app.space.ok ? (S.doc.room ? S.doc.room.data : null) : app.room.local();      // (the server's room is in the common frame; alone, the own scan is the plan)
    mine = J.frame(tower, S, dt, t, common(hands));
  },
  // a new tower half a metre in front of the menu's owner, its first level across their view; the page that simulates the tower builds it
  onAction: (id) => {
    if (id !== 'build') return;
    const { S, space } = app, h = app.head(), x = h[0] + Math.cos(h[2]) * 0.5, y = h[1] + Math.sin(h[2]) * 0.5, c = space.ok ? space.toCommon([x, y]) : [x, y];
    app.bodies[0].ask('build', { x: c[0], y: c[1], yaw: (space.ok ? space.yawToCommon(h[2]) : h[2]) + Math.PI / 2, by: S.me });
  },
  draw: ({ S }, now) => {
    const dt = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : 0; lastDraw = now;
    const yaw = app.space.ok ? app.space.yawFromCommon(0) : 0, turn = Q.fromAxisAngle([0, 0, 1], yaw);
    tower.blocks.forEach((b, i) => {
      const d = tower.drawn(b, dt, now, mine), p = toPlan(d.p), qp = Q.mul(turn, d.q), m = meshes[i];       // (the block's turn in the common frame, then the page's line-up)
      m.position.set(p[0], p[2], -p[1]); m.quaternion.set(qp[0], qp[2], -qp[1], qp[3]);
      // a held block takes its holder's colour
      const h = b.holder !== null ? b.holder : b.held ? S.me : null;
      if (h !== null && h !== undefined) m.material.color.copy(m.userData.wood).lerp(new THREE.Color(PLAYER_COLOURS[h % PLAYER_COLOURS.length]), 0.45);
      else m.material.color.copy(m.userData.wood);
    });
  },
  status: () => {
    const g = J.game(app.S), S = app.S;
    return `tower: ${g.state === 'fell' ? 'fell' : `${levels()} levels`}, ${g.moves} moved, turn: ${who(g.turn)}   simulated ${mine ? 'here' : `by ${app.ownerText(S.holder(J.TOKEN))}`}${tower.moving() ? ', moving' : ''}${mine && tower.pw.lagged ? ', SLOW' : ''}`;
  },
});
window.__jenga = Object.assign(app, { tower });

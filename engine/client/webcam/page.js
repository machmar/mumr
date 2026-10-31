// The webcam page's panels and styles, made by script so that every app's PC view can become a webcam page with one more tag (start.js): the
// camera's picture behind the view's canvas, the panels (World, Show, Webcam), the calibration mode's layer, the zoomed box for setting a point.
// From Nudgy (simulator/mr/mixedView.html), with the view's own canvas and #hud taken in instead of view.js's.
//
//   const el = buildPage(canvas)    canvas: the app's PC view canvas (THREE's renderer.domElement): it goes into #viewBox, over the picture
// The ids are the ones webcamview.js and mixed.js look for. The app's #hud element (the view's status text), if the page has one, moves into the World panel.
const CSS = `
  :root { --bg: #14161c; --ink: #ece9e2; --dim: #9aa3b2; --line: #39404f; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; overflow: hidden; }
  /* the box is the whole window until a camera runs, then the shape of the camera's picture (so that nothing is stretched) */
  #viewBox { position: absolute; inset: 0; margin: auto; width: 100vw; height: 100vh; }
  #viewBox.mirror { transform: scaleX(-1); }                /* (the calibration mode can show the picture as a mirror does: the picture, the outline and the markers drawn on it together) */
  #viewBox.cam { width: min(100vw, calc(100vh * var(--ratio, 1.7778))); height: min(100vh, calc(100vw / var(--ratio, 1.7778))); }
  #viewBox > canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
  #wcVideo { position: absolute; width: 2px; height: 2px; opacity: 0; pointer-events: none; }       /* (only the source of the background texture) */
  #wcPick { pointer-events: none; }
  #viewBox.picking #wcPick { pointer-events: auto; cursor: crosshair; }

  /* the panels: a title bar with a button that rolls the panel up; a rolled-up panel rolls down while the mouse is over it and up again when it leaves */
  .box { background: rgba(20, 22, 28, 0.84); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  #left { position: fixed; left: 10px; top: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: min(520px, calc(100vw - 20px)); pointer-events: none; }
  #left .box { pointer-events: auto; max-width: 100%; }
  #wcPanel { position: fixed; right: 10px; top: 10px; width: min(430px, calc(100vw - 20px)); }
  .hd { display: flex; align-items: center; gap: 10px; padding: 4px 6px 4px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); user-select: none; }
  .hd .roll { margin-left: auto; font: inherit; line-height: 1; padding: 2px 8px; border: 1px solid var(--line); border-radius: 6px; background: #1e222c; color: var(--ink); cursor: pointer; }
  .bd { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.18s ease; }
  .bd > .in { overflow: hidden; min-height: 0; padding: 0 12px 8px; transition: padding 0.18s ease; }
  .rollable.rolled .bd { grid-template-rows: 0fr; }
  .rollable.rolled .bd > .in { padding-bottom: 0; }
  .rollable.rolled:hover .bd { grid-template-rows: 1fr; }
  .rollable.rolled:hover .bd > .in { padding-bottom: 8px; }

  #hudBox #hud { position: static; left: auto; bottom: auto; margin: 0; white-space: pre-wrap; font: 12px/1.4 ui-monospace, monospace; font-variant-numeric: tabular-nums; min-width: 300px; color: var(--ink); pointer-events: none; }
  #showList { display: flex; flex-direction: column; gap: 2px; min-width: 220px; }
  #showList label { cursor: pointer; }
  #showList label:has(input:disabled) { color: var(--dim); }
  #showNote, #camNote { color: var(--dim); font-size: 12px; margin: 4px 0 0; max-width: 300px; }
  #showPanel .row { display: flex; gap: 6px; margin: 6px 0 0; }
  #showPanel button:not(.roll) { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: #1e222c; color: var(--ink); cursor: pointer; }
  body.measuring #wcPanel { opacity: 0.4; transition: opacity 0.15s; }                /* (while measuring the field of view the panel lets the picture and the outline show; hover for the text) */
  body.measuring #wcPanel:hover { opacity: 1; }
  #wcPanel .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; }
  #wcPanel button:not(.roll), #wcPanel select, #wcPanel input { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: #1e222c; color: var(--ink); }
  #wcPanel button:disabled { color: var(--dim); }
  #wcFovSel { max-width: 250px; }
  #wcStatus { white-space: pre-line; margin: 6px 0; font-size: 13px; }
  #wcExtra, #wcNote { color: var(--dim); font-size: 12px; margin: 4px 0 0; }

  /* the calibration mode: a layer over the whole page. In the field-of-view step it is see-through (the picture, the outline and the markers show) with only its bar on top;
     in the others it is black and the page draws on it */
  body.calibrating #left, body.calibrating #wcPanel { display: none; }
  #calMode { position: fixed; inset: 0; z-index: 50; background: #000; color: #fff; display: flex; flex-direction: column; }
  #calMode [hidden], #calMode[hidden] { display: none !important; }              /* (the layer's own display rules would otherwise win over the attribute) */
  #calMode.over { background: transparent; pointer-events: none; }
  /* the field-of-view step's tools: under the bar, over the picture */
  #calFovTools { position: relative; z-index: 2; pointer-events: auto; background: rgba(0, 0, 0, 0.8); padding: 6px 12px 8px; }
  #calFovTools .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0; }
  #calMode input { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: #1e222c; color: var(--ink); }
  #calBar { position: relative; z-index: 2; display: flex; gap: 10px; align-items: center; padding: 8px 12px; background: rgba(0, 0, 0, 0.8); pointer-events: auto; }
  #calMsg { flex: 1; font-size: 15px; white-space: pre-line; }
  /* while the screen is what the camera looks at, the bar sits between the two top markers instead of across them */
  body.calboard #calBar { opacity: 0.9; }
  body.calflash #calBar, body.calflash #calProg { visibility: hidden; }              /* (while the screen flashes nothing else is on it) */
  #calMode.draws #calBar { position: absolute; left: 50%; top: 0; transform: translateX(-50%); width: min(720px, 52vw); box-sizing: border-box; border-radius: 0 0 10px 10px; }
  #calMode button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: #1e222c; color: var(--ink); cursor: pointer; }
  #calMode button:disabled { color: var(--dim); cursor: default; }
  /* the zoomed box for setting a point: in the corner of the window that is furthest from the mouse */
  #wcLoupe { position: fixed; z-index: 60; width: 300px; background: rgba(20, 22, 28, 0.96); border: 1px solid var(--line); border-radius: 10px; padding: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); color: var(--ink); }
  #wcLoupe canvas { display: block; border-radius: 6px; }
  /* the buttons of the box are not in it (it moves away from the mouse): they stay at the bottom middle of the window, where the box never is */
  #wcLoupeBar { position: fixed; z-index: 61; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; background: rgba(20, 22, 28, 0.96); border: 1px solid var(--line); border-radius: 10px; padding: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); color: var(--ink); }
  #wcLoupeBar[hidden], #wcLoupe[hidden] { display: none; }   /* (display: flex above would otherwise win over the hidden attribute) */
  #wcLoupeBar button { font: inherit; padding: 4px 12px; border: 1px solid var(--line); border-radius: 8px; background: #1e222c; color: var(--ink); cursor: pointer; }
  #wcLoupeBar button.on { background: #2f6fc8; }
  #wcLoupeBar button:disabled { color: var(--dim); cursor: default; }
  #wcLoupeBar .hint { font-size: 11px; color: var(--dim); }
  #wcLoupeInfo { font-size: 11px; color: var(--dim); margin-top: 4px; line-height: 1.35; }
  #calMirrorWrap { font-size: 14px; cursor: pointer; white-space: nowrap; user-select: none; }
  #calHome { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 12px; position: relative; z-index: 2; padding: 10px; max-width: 980px; max-height: calc(100vh - 64px); overflow-y: auto; }
  #calProfileRow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
  #calParams { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
  #calParams .par { background: #14161c; border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; min-width: 170px; display: flex; flex-direction: column; gap: 6px; }
  #calParams .par.grid { flex-direction: row; align-items: center; gap: 14px; }
  #calParams .par div { display: flex; flex-direction: column; gap: 6px; }
  #calParams .par b { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); }
  #calParams .par span { font-size: 16px; white-space: pre-line; }
  #calGrid { width: min(224px, 34vw); border-radius: 6px; background: #0d0f14; }
  #calHomeHint { color: var(--dim); font-size: 13px; margin: 0; min-height: 1.2em; text-align: center; }
  #calMode select { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: #1e222c; color: var(--ink); }
  #calPick { margin: auto; display: flex; gap: 16px; position: relative; z-index: 2; }
  #calPick button { width: 230px; height: 110px; font-size: 18px; line-height: 1.3; }
  #calPick small { display: block; margin-top: 8px; font-size: 13px; color: var(--dim); }
  #calDraw { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }
  #calProg { position: absolute; left: 25%; right: 25%; bottom: 12px; height: 10px; border: 1px solid #fff; z-index: 2; }
  #calFill { height: 100%; width: 0; background: #ffd24a; }
  #calResult { margin: auto; max-width: 760px; padding: 20px; position: relative; z-index: 2; pointer-events: auto; background: rgba(20, 22, 28, 0.96); border: 1px solid var(--line); border-radius: 12px; }
  #calResultText { white-space: pre-wrap; font: 16px/1.5 system-ui, sans-serif; margin: 0 0 14px; }
`;

const HTML = `
<div id="viewBox">
  <video id="wcVideo" muted playsinline></video>
  <canvas id="wcPick" width="640" height="360"></canvas>
</div>
<div id="wcLoupe" hidden>
  <canvas id="wcLoupeCv" width="300" height="300"></canvas>
  <div id="wcLoupeInfo"></div>
</div>
<div id="wcLoupeBar" hidden><button id="wcLoupe4" title="Zoom 4 times (key 4)">4x</button><button id="wcLoupe8" title="Zoom 8 times (key 8)">8x</button><button id="wcLoupeOk" title="Accept the point where it is (Enter)">Accept</button><span class="hint">keys: 4, 8, Enter</span></div>
<div id="calMode" hidden>
  <div id="calBar"><b>Camera calibration</b><span id="calMsg"></span><label id="calMirrorWrap" hidden title="Show the camera's picture as a mirror does (left and right swapped). Only what is shown changes, not what is measured"><input type="checkbox" id="calMirror"> Mirror the picture</label><button id="calBack" title="One step back (at the first step: leave)">Back</button><button id="calExit" title="Leave the calibration (Esc)">Exit</button></div>
  <div id="calHome">
    <div id="calProfileRow"><label>Profile being calibrated <select id="calProfileSel"></select></label>
      <button id="calNew" title="Make a new, empty profile; the calibrations are saved in the one that is chosen">New...</button>
      <button id="calRename" title="Rename the chosen profile">Rename...</button>
      <button id="calDelete" title="Delete the chosen profile and what was measured for it">Delete</button></div>
    <div id="calParams">
      <div class="par"><b>Field of view</b><span id="calParFov"></span></div>
      <div class="par"><b>Latency</b><span id="calParLat"></span></div>
      <div class="par grid"><div><b>Distortion</b><span id="calParLens"></span></div><canvas id="calGrid" width="320" height="180" title="A straight grid as this camera shows it (grey: as it would be with no distortion)"></canvas></div>
    </div>
    <p id="calHomeHint"></p>
  <div id="calPick">
    <button id="calPickFov" title="Hold printed or shown sheet 4 in front of the camera">Field of view<small>sheet 4</small></button>
    <button id="calPickDist" title="Show the laptop screen to the camera: a board of markers, snapshots of it from different distances and angles, and the lens distortion worked out from them">Distortion<small>the screen shown to the camera</small></button>
    <button id="calPickLat" title="Show the laptop screen to the camera: how late the picture is">Latency only<small>the screen shown to the camera</small></button>
  </div>
  </div>
  <div id="calFovTools" hidden>
  <div class="row"><button id="wcFovMeasure" title="Hold sheet 4 in front of the camera: the page finds its four squares, takes a picture when it is steady, and shows where to put it next">Measure field of view</button>
    <button id="wcFovClick" title="If the squares are not found: click their centres in the order of their numbers">Measure by clicking</button></div>
  <div class="row"><label title="Sheet 4 shown on a screen: measure the two 100 mm bars on it, between their end lines">Sheet 4 shown on a screen: the bar as shown (mm) <input id="wcBarH" type="number" min="5" max="1000" step="0.5" placeholder="100" style="width: 5.5em"></label>
    <label>vertical bar <input id="wcBarV" type="number" min="5" max="1000" step="0.5" placeholder="100" style="width: 5.5em"></label>
    <button id="wcBarReset" title="The sheet is printed at 100 %: forget the numbers">Printed size</button></div>
  <div class="row"><label>Field of view (degrees) <input id="wcFov" type="number" min="25" max="130" step="0.1" style="width: 6em"></label>
    <button id="wcFovReset">Assume 70</button></div>
  </div>
  <canvas id="calDraw" hidden></canvas>
  <div id="calProg" hidden><div id="calFill"></div></div>
  <div id="calResult" hidden><pre id="calResultText"></pre>
    <button id="calResultBack">Back to the calibration screen</button></div>
</div>
<div id="left">
  <div id="hudBox" class="box rollable">
    <div class="hd"><span>World</span><button class="roll" data-roll="hud">&#9650;</button></div>
    <div class="bd"><div class="in"><div id="hudHost"></div></div></div>
  </div>
  <div id="showPanel" class="box rollable">
    <div class="hd"><span>Show</span><button class="roll" data-roll="show">&#9650;</button></div>
    <div class="bd"><div class="in"><div id="showList"></div><p id="showNote"></p>
      <div class="row"><button id="showFind" title="Fly the view to a real camera (when you are not looking through one)">Find a camera</button></div><p id="camNote"></p></div></div>
  </div>
</div>
<div id="wcPanel" class="box rollable">
  <div class="hd"><span>Webcam</span><button class="roll" data-roll="wc">&#9650;</button></div>
  <div class="bd"><div class="in">
  <div class="row"><button id="wcStart">Start camera</button><select id="wcDevice"></select></div>
  <div class="row">Click in the picture:
    <button id="wcSpot0">Spot 1</button><button id="wcSpot1">Spot 2</button><button id="wcSpot2">Check spot</button>
    <button id="wcClear">Clear clicks</button><button id="wcAlt" disabled>Other fit</button></div>
  <div class="row" title="For a close-up, where the spots are not all in the picture: a camera put into the room, carried by hand in a headset (the white knob on it, while lining up) to where the real camera stands, then turned by one click on a spot it sees">Or by hand:
    <button id="wcHand">Place by hand</button><span id="wcAims" hidden> then aim at <button id="wcAim0">Spot 1</button><button id="wcAim1">Spot 2</button><button id="wcAim2">Check spot</button></span></div>
  <div class="row"><label>Profile <select id="wcFovSel" title="The camera profile this camera uses (field of view, lens, latency). They are made, filled in and deleted in the camera calibration"></select></label></div>
<div class="row"><button id="wcCalOpen" title="A full-screen mode that measures the field of view, the lens distortion and the latency of this camera">Camera calibration...</button></div>
  <p id="wcStatus"></p>
  <p id="wcExtra"></p>
  <p id="wcNote"></p>
  </div></div>
</div>
`;

export function buildPage(canvas) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend', HTML);
  const box = document.getElementById('viewBox');
  box.insertBefore(canvas, document.getElementById('wcPick'));                 // (the view's picture goes between the camera's and the click layer)
  let hud = document.getElementById('hud');
  if (!hud) { hud = document.createElement('div'); hud.id = 'hud'; hud.textContent = 'connecting...'; }
  document.getElementById('hudHost').appendChild(hud);
  return { box, hud };
}

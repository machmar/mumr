# Vendored files (served at /mumr/vendor/)

Copied so that a headset needs no internet, only the PC (2026-10-26: a Quest on a network with no internet showed a white page).

- `three/`: three.js 0.170.0 from https://cdn.jsdelivr.net/npm/three@0.170.0/ (MIT, `three/LICENSE`): `build/three.module.js` and only the
  add-ons the engine and the apps import (OrbitControls; XRHandModelFactory with what it imports). An app's import map points at it:
  `"three": "/mumr/vendor/three/build/three.module.js", "three/addons/": "/mumr/vendor/three/examples/jsm/"`.
  A new add-on: copy it from the same version into the same path under `examples/jsm/`, with whatever it imports.
- `generic-hand/`: `left.glb`, `right.glb` from https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/
  (the hand masks' model, `xr/handmask.js`).

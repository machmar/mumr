# The wrist menu: design spec

The engine's own menu (`engine/client/sysmenu.js`, drawn by `engine/client/xr/panel3d.js`) is the only part of MUMR a game's player sees. This is its look and its
feel, as decided with Marek on 2026-10-22 to 2026-10-25. Built 2026-10-25 (see "Building it"); seen in the desktop rehearsal only, not yet on a headset.

The pictures: <https://claude.ai/artifact/ERSs3PH9gdcbnCJxYqJjHt> (private, Marek's account). Page "The design", the big board "The wrist menu: the full spec".
The older pages (Round 1 to 3, Logo, Menu in 3D) show how it got here. Where this file and a picture disagree, this file wins.

## Principles

- Interaction first. The menu is poked by a hand-tracked fingertip of one hand on a card that moves with the other wrist, so tracking is imprecise:
  targets are big, gaps are wide, and only things that can be pressed look pressable.
- Plain. One sans-serif, flat fills, sharp corners, no shadows, no gradients, no decoration, no accent colour. Black, white and neutral grays only.
- The menu is flat at rest. Only a nearby or pressing fingertip changes it.

## Look

| Thing | Value |
| --- | --- |
| Menu card, folded button, fold arrow | `#F0F0F0` |
| Buttons | `#DCDCDC` |
| Pressed, all text | `#111111` (text on a dark button `#F0F0F0`). A button turns black when it crosses the press threshold, not when a fingertip is near it (2026-10-25) |
| Thin lines | at least 6 px (1.5 mm) on the 40 px per cm card; thinner ones alias |
| Second line of text | `#555555` |
| Type | Inter 600 for button text (22 px on the 768 px card), Inter 500 for the second line (14 px), Inter 600 for the title (18 px) |
| Logo | `docs/brand/mumr-logo.svg` / `.png` (gray `#444444` on white), `mumr-logo-inverse.*` (white on gray) |

The logo: MU over MR in Archivo ExtraBold. M, U and R have the same width. U and R are the same height. The M is two stretched Ms at 160% (of the height
of U or R) with the overlap hidden, so one thin separation runs through all three letters. Margins and gaps are one thin unit; the logo sits centred in a square.

## Layout: design C, six fixed slots

- The card is 22 cm wide with a 0.5 cm margin. Two columns, rows of 3 cm, 8 mm between buttons and between rows.
- Every screen uses the same six places. Only buttons are drawn as buttons; a thing that cannot be pressed now is a line of text, not a grey button.
- Home: Line up, Room setup, Exit. Line up: one slot per spot (Spot 1, Spot 2, Check spot), Room (with Upload), Camera (Reset camera, when a webcam page has aligned one), Done. Spot menu (after poking a spot):
  Lock, Replace, Delete, Back, with Delete away from the others. Exit asks again, with the confirming button in another place.
- A button is at least 4 × 3 cm. Nothing smaller.

## Fold and unfold

- Folded: a 2 × 2 cm button with the logo, on the inside of the left wrist (shown while that side of the wrist looks at the player, as now).
- Fold: nothing inside the menu folds it. A 2 × 2 cm arrow floats 8 mm above the menu, pointing down. Poking it folds the menu.
- Unfold: poking the folded button makes the menu unroll (2026-10-25, instead of inflating from nothing; nothing is scaled). The top of the menu flies up with the
  button, which rises and turns into the arrow; the bottom stays at the button and rolls down to its place. A ripple runs up through the menu while it opens,
  4 mm tall (as tall as a button is when a fingertip is near). Fold is the same backwards: the menu rolls up into the arrow, the arrow goes down and turns into
  the button. The 5-second auto-fold of a hidden home menu uses the same animation.
- Layers: when the wrist menu changes layer, it slides sideways: a deeper layer (Home, then Line up or Exit asks again, then a spot) comes in from the right, going
  back goes out to the left. The arrow stays where it is.
- Durations are not decided; 0.3 s to unroll or roll up, 0.22 s for a slide, to start.

## A press

All depths are measured from the menu surface, along the push, in cm.

| State | Fingertip | The menu |
| --- | --- | --- |
| Flat | away | flat |
| Near | within 6 cm, above a button | that button stands up 4 mm (it was 2 mm; made twice as tall on 2026-10-25), as a sharp-edged block, and stays its normal colour; nothing else moves |
| Pushing | 0 to 1 cm into the button | nothing moves; the button stays at its 4 mm |
| Pressed | reaches 1 cm | the button snaps down 1 cm as one block into a square pit with sharp vertical walls, turns near-black, and activates (once, only on the way down) |
| Following | 1 to 2.5 cm | the block follows the fingertip exactly |
| Deep | past 2.5 cm | the button stops at 2.5 cm; the whole menu moves back 1 mm for every cm of extra push, in the direction of the press |
| Released | back up to the surface (0 cm) | the button disengages, the menu returns to flat, nothing is activated. The main way to let go |
| Left sideways | 5 to 10 cm away in any direction | lets go too, the same way |

- No plastic deformation: no slopes, no bowl, no curves. Only rigid blocks and vertical walls.
- At rest a button is only drawn on the card, not a block in a hole: a block flush with the card in a hole of the same size leaves a hairline round it that
  aliases (2026-10-25). A button is a block only while it stands up or is down; the card has a hole only for a pit.
- The snap is not a jump (2026-10-25: "it feels too discontinuous, like a detent button was pressed"): the block drops in about 20 ms and overshoots by under 1 mm
  (a spring at 20 Hz, damping 0.55, done in about 50 ms), and pops up the same way when it lets go. Following the finger is not delayed. The click and the
  activation happen at the moment of the press, not after the animation.
- Moving the hand up, down or sideways never moves the menu (only the push beyond 2.5 cm does).
- While a button is held, no other button can be pressed; moving the fingertip over another button does nothing until the first is released.
- A new press has to come in from the top again; letting go and coming back sideways does not activate anything.

## Sound

Two distinct clicks, a click and not a tone, rendered on the fly (Web Audio), one short voice each. Bigger button, lower click. The audio originates from the
menu or the button itself, never from the head or the hand.

- Press click: when the button snaps down (1 cm). A little lower, sharper.
- Release click: when the button lets go (0 cm, or sideways). Higher, lighter, shorter.
- Nothing plays for the hover lift, for following the finger, or for unfold and fold.
- Starting values, to tune by ear (changed 2026-10-25: "big button size is good, smaller button is too high", and less random pitch): ring frequency 2024 Hz
  × sqrt(30 / area in cm²) for a button of 30 cm² or more (a wrist menu button, 10.1 × 3 cm, rings at 2 kHz; full width about 1.4 kHz), and for a smaller button
  2024 Hz × (30 / area)^0.25 (2 × 2 cm about 3.3 kHz; the square root gave 5.5 kHz), times 0.8 for the press and 1.25 for the release, times a random 0.985
  to 1.015 (it was 0.97 to 1.03). A few ms of band-passed noise plus a damped sine; the press longer
  (about 6 ms and 35 ms) than the release (about 3 ms and 20 ms). Played from a PannerNode at the button's centre.

## Not decided

Animation durations. Whether a soft thud should play when a button reaches the 2.5 cm limit. The click frequencies and levels. The exact release distance
(5 to 10 cm) for leaving sideways. Whether the hover lift should grow as the fingertip comes closer than 6 cm (it is a flat 4 mm now).

## Building it

Where the pieces are: the press states and the held-button lock in `Poke` and `shape` (`engine/client/menus.js`), the drawing (flat card, lift, pit, whole-menu
push, arrow, folded button, the unfold ripple) in `engine/client/xr/panel3d.js`, the layout and its screens (Home, Line up, Spot, Exit asks again) in
`SysMenu.layout` (`engine/client/sysmenu.js`), the clicks in `engine/client/clicks.js`, and the wiring (what the fingertips touch, the clicks, the touches of other
players) in `engine/client/xr/app.js`. The menu is shared and other players press it, so each page sends the buttons its fingertips are at as `info.touch` in the `M`
packet (`{ o: owner slot or -1 for its own, p: panel id, b: button, h: held, d: mm past the surface }`, at most 4); every page draws them, and plays the clicks, on
the right panel.

What the first build decided where the spec was silent (change them freely):

- The card is drawn at 40 canvas px per cm (880 px for 22 cm). Text is sized as in the design picture (button text 1.1 cm high, second line 0.7 cm, title 0.9 cm,
  as `22 / 14 / 18 px` on a 440 px card): the `22 px on the 768 px card` above would be 0.6 cm, too small to read at arm's length.
- The fold arrow is centred, 8 mm above the card's top edge and in the card's plane; a strip of the same height under the card keeps the card's middle at the
  wrist point. The folded button is at the same point.
- Slots (row by row, left to right): Home: Line up, Room setup, Exit (bottom right). Line up: Spot 1, Spot 2, Check spot, Room (Upload room when this headset has a
  scan), Camera (Reset camera: the real cameras go back to where their webcam page worked them out; the text "none aligned" without one), Done (bottom right). Spot: Lock and Replace on top, Delete on its own in the middle right, Back at the bottom left. Exit asks again: Exit now (middle left), Stay (bottom right, where Exit was).
- A button is held until 7 cm sideways from it; a fingertip 50 cm behind the surface also lets go (it was 12 cm, which let go too soon; the menu has moved back 4.75 cm by then). A button that can be pressed and is `active` has a dark bar on
  its left edge, 4 mm wide.
- Every menu drawn by `panel3d.js` has the new look and the same blocks and press (the app's menu, the room picker, the windows' buttons), not only the wrist menu.
  Their clicks follow the same rule (the pitch follows the button's area).

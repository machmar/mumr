# RULE 1 OF THIS ENGINE: EVERYTHING IS SHARED AND PHYSICAL, ALWAYS

**Every thing in the world is one thing for everybody, at all times, in every app and every mode, tests and experiments included.**

- If one player sees it, every player sees it, in the same real place, turned the same way.
- If one player can touch, push, grab or move it, every player can, with their own hands.
- Any hand shown anywhere (a ghost hand, a big "hand IRL" hand) is shown in the same place on every headset, whoever's hand it is.
- Nothing is simulated or kept on one page only. A moving thing is a **Body** (a token; the holder sends its state). A placed thing
  is in the **Document**. Geometry that ties them together (a room model, a window on a wall) is worked out in the **common frame**
  from shared data (the server's room), never from a page's own floor plan or own scan.
- No "local only for a quick test" mode. A thing that is not shared is a bug, not a feature.
- The only per-player things are what a person carries and the others still see: their menu, their wrist card, their hands.

Before building, changing or reviewing anything, check it against this rule. Full text: docs/ARCHITECTURE.md, "Rule 1".
(Marek, 2026-10-26, after the lab's pile ran per page and the room model was worked out in each page's own frame.)

---

Read first: `docs/ARCHITECTURE.md`, `docs/PLAN.md`, `docs/HOWTO-NEW-APP.md`, `APPS.md`.

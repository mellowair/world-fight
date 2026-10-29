# Deidara V2 battle frames

- Canvas: 96 × 112 px, transparent RGBA PNG.
- `idle/idle_1.png`: normalized idle from the supplied `reference/迪达拉.png`.
- `skill1/`: four C4 Garuda attack frames, played in sequence. C4 chance is configured as 100% in `skills.js`.
- `hit/`: one shared frame for recoil/stun.
- `death/`: one toppled frame.
- `skill2/`: four C0 detonation frames, shown by the existing C0 warning event.
- `reference/deidara-sheet-v1.png`: generated composite source for the extracted action frames.
- `animation.json`: frame manifest and skill mapping.

The deprecated first-generation `assets/deidara/` frame set and its source archives under `reference/` have been removed. The current game uses this V2 set and the supplied `reference/迪达拉.png` idle source.

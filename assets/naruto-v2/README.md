# Naruto Q-style pixel animation assets v2

This revision fixes the previous prototype's unclear limbs: arms and hands are redrawn as separate visible shapes, the punch fist extends forward at face/chest height and does not overlap the face, and run frames alternate both arms and legs.

- Canvas: 96x112 SVG, transparent background.
- `frames/`: one SVG per pose.
- `naruto_sprite_sheet.svg`: 4x2 sprite sheet, 384x224.
- `animation.json`: frame paths and suggested playback.

## Frames
- `idle.svg`: standing idle.
- `surprised.svg`: widened eyes and open mouth.
- `hand_head.svg`: deliberate hand-to-head pose (only this pose raises a hand near the head).
- `smile_thumbs_up.svg`: smile and thumbs-up away from face.
- `run_a.svg`, `run_b.svg`: alternating run cycle with clear arm/leg movement.
- `punch.svg`: arm extended forward with fist away from face.
- `hit_x.svg`: hit reaction with pixel cross-shaped eyes.

Integrate these as frame-by-frame poses; do not use a single static image translated across the battlefield as a substitute for running. Preserve the 96x112 frame dimensions and align the foot baseline. Animation must not change combat results.

import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_VISUALS, getAnimationFrameVisualScale, getAnimationVisualOffset, getCharacterVisual } from "./visualConfig.js";
import { NORMAL_ENEMY_APPEARANCES } from "./characters.js";
import { readFileSync } from "node:fs";

test("every configured fighter uses finite, positive visual dimensions without gameplay fields", () => {
  for (const visual of Object.values(CHARACTER_VISUALS)) {
    assert.ok(Number.isFinite(visual.scale) && visual.scale > 0);
    assert.ok(Number.isFinite(visual.offsetX) && Number.isFinite(visual.offsetY));
    assert.ok(Number.isFinite(visual.frameWidth) && visual.frameWidth > 0);
    assert.ok(Number.isFinite(visual.frameHeight) && visual.frameHeight > 0);
    for (const stat of ["hp", "atk", "def", "spd", "damage"]) assert.equal(stat in visual, false);
  }
});

test("appearance and boss art select independent visual settings despite shared combat IDs", () => {
  assert.equal(getCharacterVisual({ id: "guard", appearanceId: "giant" }), CHARACTER_VISUALS.giant);
  assert.equal(getCharacterVisual({ id: "guard", appearanceId: "slime" }), CHARACTER_VISUALS.slime);
  assert.equal(getCharacterVisual({ id: "guard", visualId: "deidara" }), CHARACTER_VISUALS.deidara);
  assert.equal(getCharacterVisual({ id: "eren" }), CHARACTER_VISUALS.eren);
  assert.deepEqual(getAnimationVisualOffset({ id: "eren" }, "skill2"), { offsetX: 0, offsetY: 0 });
  assert.deepEqual(["launch", "strike", "retreat"].map((frame) => getAnimationFrameVisualScale({ id: "kaneki" }, "predator", frame)), [1, 1.55, 1.45]);
  assert.equal(getAnimationFrameVisualScale({ id: "kaneki" }, "thousandSeven", "burst"), 1.4);
  assert.equal(getAnimationFrameVisualScale({ id: "eren" }, "skill2", "skill2_1"), 1);
});

test("normal enemy appearances share foot-anchored visuals without humanoid hit eyes", () => {
  assert.equal(CHARACTER_VISUALS.slime.scale, 0.72);
  assert.equal(CHARACTER_VISUALS.slime.offsetY, 0);
  for (const appearanceId of Object.keys(NORMAL_ENEMY_APPEARANCES)) {
    assert.equal(getCharacterVisual({ id: appearanceId === "mage" ? "mage" : "guard", appearanceId }), CHARACTER_VISUALS[appearanceId]);
  }
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.sprite-visual\s*\{[^}]*transform-origin:\s*center bottom/);
  assert.match(css, /\.fighter\[data-appearance\] \.hit-eyes\s*\{\s*display:\s*none/);
  assert.match(css, /\.fighter\.is-hit-stun \.stun-stars\s*\{\s*animation:/);
});

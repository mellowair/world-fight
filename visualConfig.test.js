import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_VISUALS, getAnimationFrameFootShift, getAnimationFrameVisualScale, getAnimationVisualOffset, getBorosBeamGeometry, getCharacterVisual } from "./visualConfig.js";
import { NORMAL_ENEMY_APPEARANCES, STAGE_TWO_BOSS_DATA } from "./characters.js";
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

test("second-stage feet use measured frame padding and rear row has an independent depth", () => {
  assert.equal(CHARACTER_VISUALS.eren.stageTwoFootOffsetY, 4);
  assert.equal(getAnimationFrameFootShift({ id: "eren" }, "death", "fall"), -2);
  assert.equal(getAnimationFrameFootShift({ id: "kaneki" }, "run", "run_01"), -2);
  assert.equal(getAnimationFrameFootShift({ id: "kaneki" }, "meleeAttack", "charge"), -4);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.battle-screen\.stage-two \.fighter\[data-row="back"\]\s*\{[^}]*bottom:\s*18%;[^}]*z-index:\s*2/);
  assert.match(css, /\.battle-screen\.stage-two \.fighter\[data-row="front"\]\s*\{[^}]*bottom:\s*12%;[^}]*z-index:\s*3/);
});

test("Boros laser extends from the head to the arena boundary in either direction", () => {
  assert.deepEqual(getBorosBeamGeometry(10, 610, 480, 120), { left: 0, width: 470, flip: false });
  assert.deepEqual(getBorosBeamGeometry(10, 610, 140, 500), { left: 130, width: 470, flip: true });
  assert.deepEqual(getBorosBeamGeometry(0, 390, 290, 80), { left: 0, width: 290, flip: false });
});

test("new Boros approach frame is high-resolution RGBA and uses the existing foot-anchored renderer", () => {
  const file = STAGE_TWO_BOSS_DATA.animations.meleeAttack.frames.windup;
  const bytes = readFileSync(new URL(`./${file}`, import.meta.url));
  assert.equal(file, "assets/stage2-enemies/boros/punch_windup.png");
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.equal(bytes.readUInt32BE(16), 1254);
  assert.equal(bytes.readUInt32BE(20), 1254);
  assert.equal(bytes[25], 6, "PNG color type 6 is RGBA");
  assert.equal(getAnimationFrameVisualScale({ id: "boros" }, "meleeAttack", "windup"), 1.08);
  assert.equal(CHARACTER_VISUALS.suzuya.scale, 1.02);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.sprite-action-frame\s*\{[^}]*image-rendering:\s*pixelated/);
  assert.match(css, /\.sprite-action-frame\s*\{[^}]*object-fit:\s*contain/);
});

test("Lu Bu uses the new transparent source and both stage-two appearances keep independent foot anchors", () => {
  const source = readFileSync(new URL("./reference/普通敌人素材/吕布.png", import.meta.url));
  const deployed = readFileSync(new URL("./assets/normal-enemies/lubu.png", import.meta.url));
  assert.deepEqual(deployed, source);
  assert.equal(deployed.readUInt32BE(16), 1161);
  assert.equal(deployed.readUInt32BE(20), 1355);
  assert.equal(deployed[25], 6, "Lu Bu must remain RGBA");
  assert.deepEqual([CHARACTER_VISUALS.lubu.scale, CHARACTER_VISUALS.lubu.frameWidth, CHARACTER_VISUALS.lubu.frameHeight,
    CHARACTER_VISUALS.lubu.offsetY], [1, 128, 144, 0]);
  assert.deepEqual([CHARACTER_VISUALS.teruhashi.scale, CHARACTER_VISUALS.teruhashi.offsetY], [.88, -1]);
  assert.equal(NORMAL_ENEMY_APPEARANCES.lubu.asset, "assets/normal-enemies/lubu.png");
  assert.equal(NORMAL_ENEMY_APPEARANCES.teruhashi.asset, "assets/normal-enemies/teruhashi.png");
});

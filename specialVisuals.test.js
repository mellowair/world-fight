import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NORMAL_ENEMY_APPEARANCES, ELITE_ENEMY_DATA, EVENT_ENEMY_DATA } from "./characters.js";
import { ADVENTURE_EVENT_DATA } from "./skills.js";
import { getAnimationFrameVisualScale, getCharacterVisual } from "./visualConfig.js";

test("new formal art paths exist and stage-two appearances remain one entry per character", () => {
  const paths = [
    ...["sea_beyond_2", "old_scroll_2", "anteiku_2", "giant_rock_2"].map((id) => ADVENTURE_EVENT_DATA[id].image),
    ...["jack", "deep_sea_king", "gollum"].map((id) => NORMAL_ENEMY_APPEARANCES[id].asset),
    ...["armored-titan", "colossal-titan"].map((id) => ELITE_ENEMY_DATA.find((enemy) => enemy.id === id).asset),
    EVENT_ENEMY_DATA.suzuya.asset, EVENT_ENEMY_DATA.suzuya.animations.meleeAttack.frames.punch,
    EVENT_ENEMY_DATA.six_ear.deathAnimation.frames.down,
    EVENT_ENEMY_DATA.gilgamesh.asset, EVENT_ENEMY_DATA.gilgamesh.animations.enuma.frames.raise,
    EVENT_ENEMY_DATA.gilgamesh.skillVisualTimelines.enuma.effect,
    "assets/stage2-enemies/colossal-smoke.png", "assets/events/drip_coffee.png", "assets/events/six_ear_true_form.png",
  ];
  for (const path of paths) assert.ok(existsSync(new URL(`./${path}`, import.meta.url)), path);
  assert.equal(NORMAL_ENEMY_APPEARANCES.jack.name, "剪刀手爱德华");
  assert.equal(new Set(Object.values(NORMAL_ENEMY_APPEARANCES).map((entry) => entry.name)).size,
    Object.values(NORMAL_ENEMY_APPEARANCES).length);
});

test("special presentations are visual only and respect the configured sequence", () => {
  const gil = EVENT_ENEMY_DATA.gilgamesh;
  assert.deepEqual([gil.skillVisualTimelines.enuma.chargeMs, gil.skillVisualTimelines.enuma.launchMs,
    gil.skillVisualTimelines.enuma.fallMs, gil.skillVisualTimelines.enuma.totalMs], [700, 500, 1000, 2200]);
  assert.ok(getCharacterVisual(gil).offsetY > 0);
  assert.ok(getCharacterVisual({ id: "colossal-titan" }).scale > getCharacterVisual({ id: "armored-titan" }).scale);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /event\.gilgameshCast !== 3/);
  assert.match(app, /function startGilgameshVisual\([^]*?document\.querySelector\("\.arena"\)/);
  assert.match(app, /const actionReady = Promise\.all\(actionAssets/);
  assert.match(app, /if \(colossal && arena && !arena\.querySelector\("\.colossal-battle-smoke"\)\)/);
  assert.match(app, /colossal-battle-smoke/);
  assert.match(app, /target\.id === "six_ear" \? 1000/);
  assert.match(app, /armorPoseRound/);
  const armor = ELITE_ENEMY_DATA.find((enemy) => enemy.id === "armored-titan");
  assert.equal(armor.animations.skill1.frames.hold, "assets/stage2-enemies/armored-titan-skill.png");
  assert.ok(existsSync(new URL(`./${armor.animations.skill1.frames.hold}`, import.meta.url)));
  assert.equal(getAnimationFrameVisualScale(armor, "skill1", "hold"), 1.3);
  assert.match(app, /actor\.id === "armored-titan" \? \[actor\.animations\?\.skill1\?\.frames\?\.hold\]/);
  assert.match(app, /if \(event\.effectType === "next-round-reduction"\)[^]*?fast \? 320 : 640/);
});

test("Boros phase artwork grows from stage one to stage three while keeping one foot anchor", () => {
  const visual = getCharacterVisual({ id: "boros" });
  const phase1 = visual.scale;
  const phase2 = phase1 * getAnimationFrameVisualScale({ id: "boros" }, "phase2Idle", "stage2");
  const phase3 = phase1 * getAnimationFrameVisualScale({ id: "boros" }, "phase3Idle", "stage3");
  assert.ok(phase1 < phase2 && phase2 < phase3);
  assert.deepEqual([visual.offsetX, visual.offsetY], [0, 0]);
  assert.ok(phase1 * getAnimationFrameVisualScale({ id: "boros" }, "cannon", "charge") >= phase3);
});

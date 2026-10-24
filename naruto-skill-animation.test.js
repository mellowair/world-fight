import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHARACTER_DATA } from "./characters.js";

const naruto = CHARACTER_DATA.find((character) => character.id === "naruto");
const animationJson = JSON.parse(readFileSync(new URL("./assets/naruto-v2/skills/animation.json", import.meta.url), "utf8"));

test("Naruto V2 skill animation mappings follow animation.json order and frame durations", () => {
  assert.deepEqual(naruto.skillAnimationMap, {
    "shadow-clone-rush": "skill1_shadow_clone",
    rasengan: "skill2_rasengan",
  });
  for (const [animationName, skillData] of Object.entries(animationJson.skills)) {
    const animation = naruto.animations[animationName];
    assert.equal(animation.type, "frames");
    assert.deepEqual(Object.values(animation.frames).map((path) => path.split("/").at(-1)), skillData.frames);
    assert.deepEqual(animation.durationsMs, skillData.durationsMs);
    assert.equal(animation.loop, false);
  }
});

test("Naruto skill animation PNGs are individual transparent 96x112 RGBA frames", () => {
  for (const skillData of Object.values(animationJson.skills)) {
    for (const frameName of skillData.frames) {
      const framePath = new URL("./assets/naruto-v2/skills/" + frameName, import.meta.url);
      const png = readFileSync(framePath);
      assert.equal(png.toString("ascii", 1, 4), "PNG");
      assert.equal(png.readUInt32BE(16), 96);
      assert.equal(png.readUInt32BE(20), 112);
      assert.equal(png[25], 6, frameName + " should retain RGBA alpha");
      assert.ok(png.length > 100);
    }
  }
});

test("skill frames use the existing frame player and restore Naruto's current battle state", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /startFrameCycle\(sourceEl, attacker, skillAnimationName, skillAnimationFrames, 0, false, skillPlaybackMultiplier\)/);
  assert.match(app, /clearSpriteFrame\(sourceEl\);\s*if \(attacker\.alive\) startIdleCycle\(sourceEl, attacker\)/);
  assert.match(app, /const duration = Number\.isFinite\(authoredDuration\) \? authoredDuration : frameDuration/);
});

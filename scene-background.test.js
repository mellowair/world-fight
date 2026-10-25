import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTING_CHARACTERS } from "./characters.js";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("character selection and both ending states use the existing city panorama", () => {
  assert.match(css, /\.character-select-screen\s*\{[^}]*url\("assets\/city-night-pixel\.png"\)[^}]*cover/s);
  assert.match(css, /\.ending-screen\s*\{[^}]*url\("assets\/city-night-pixel\.png"\)[^}]*cover/s);
  assert.match(css, /\.ending-screen\.is-victory::before/);
  assert.match(css, /\.ending-screen\.is-defeat::before/);
  assert.match(app, /classList\.toggle\("is-victory", won\)/);
  assert.match(app, /classList\.toggle\("is-defeat", !won\)/);
  assert.doesNotMatch(css, /\.character-select-screen\s*\{[^}]*linear-gradient\(#9cdef0/s);
  assert.doesNotMatch(css, /\.ending-screen\s*\{[^}]*linear-gradient\(#a7e1f0/s);
});

test("all starter roles share bottom-aligned image framing and the PNG dimensions are unchanged", () => {
  assert.match(css, /\.starter-card img\s*\{[^}]*object-position:\s*center bottom/s);
  const png = readFileSync(new URL("./assets/city-night-pixel.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), 1672);
  assert.equal(png.readUInt32BE(20), 941);
  for (const character of STARTING_CHARACTERS) {
    const path = new URL("./" + character.asset, import.meta.url);
    const asset = readFileSync(path);
    if (character.asset.endsWith(".svg")) {
      const svg = asset.toString("utf8");
      assert.match(svg, /<svg/);
      assert.doesNotMatch(svg, /<rect[^>]+fill="#(?:54a76f|5ca66d|8dc878|79b86d)"/i);
    } else {
      assert.equal(asset.toString("ascii", 1, 4), "PNG");
      assert.equal(asset.readUInt32BE(16), 96);
      assert.equal(asset.readUInt32BE(20), 112);
      assert.equal(asset[25], 6, "starter sprite PNG must retain RGBA alpha");
    }
  }
  assert.match(css, /\.starter-card\s*\{[^}]*box-shadow:\s*0 3px 0 rgba\(15,22,38/);
});

test("Eren starter animation frames are separate 96x112 transparent PNG assets", () => {
  const eren = STARTING_CHARACTERS.find((character) => character.id === "eren");
  assert.ok(eren);
  assert.deepEqual(eren.poseSequence.map((pose) => pose.duration), [380, 2000]);
  assert.ok(eren.poseSequence.every((pose) => !pose.caption), "Eren entry pose has no lingering caption");
  assert.deepEqual(Object.keys(eren.animations), ["idle", "fall", "pose", "run", "meleeAttack", "hit", "dodge", "death", "skill1", "skill2"]);
  assert.deepEqual(Object.keys(eren.animations.fall.frames), ["drop_start", "impact", "rebound"]);
  assert.equal(eren.animations.fall.frames.drop_start, "assets/eren-v1/fall_2.png");
  assert.equal(eren.animations.fall.frames.impact, "assets/eren-v1/fall_1.png");
  assert.equal(eren.animations.fall.frames.rebound, "assets/eren-v1/fall_2.png");
  assert.deepEqual(eren.animations.fall.durationsMs, [2000, 680, 300]);
  assert.equal(eren.animations.fall.durationsMs[0], 2000, "fall_2 holds for one additional second before impact");
  assert.match(app, /const fallDuration = fallFrames\.length && Array\.isArray\(fallDurations\)/);
  assert.match(app, /window\.setTimeout\(runPose, fallDuration\)/);
  assert.match(app, /actor\.classList\.add\("has-landed"\);\s*actor\.classList\.remove\("is-dropping"\)/);
  assert.match(css, /\.entry-actor\.has-landed\s*\{\s*transform:\s*translateY\(0\);\s*\}/);
  assert.match(app, /actor\.classList\.remove\("is-dropping"\)/);
  assert.doesNotMatch(html, /id="entry-caption"/);
  assert.equal(eren.animations.pose.frames.landed, "assets/eren-v1/fall_2.png");
  assert.equal(eren.animations.dodge.frames.step, "assets/eren-v1/dodge.png");
  assert.equal(eren.animations.death.frames.fall, "assets/eren-v1/death.png");
  assert.deepEqual(eren.animations.meleeAttack.impactFrames, ["windup", "strike", "recover"]);
  assert.deepEqual(Object.values(eren.animations.meleeAttack.frames), [
    "assets/eren-v1/attack_windup.png", "assets/eren-v1/punch.png", "assets/eren-v1/attack_recover.png",
  ]);
  assert.deepEqual(eren.animations.meleeAttack.durationsMs, [90, 140, 90]);
  assert.equal(eren.animations.hit.frames.hurt, "assets/eren-v1/hit.png");
  assert.deepEqual(Object.keys(eren.animations.skill1.frames), ["skill1_1", "skill1_2", "skill1_3"]);
  assert.deepEqual(Object.keys(eren.animations.skill2.frames), ["skill2_1", "skill2_2"]);
  assert.deepEqual(eren.animations.skill1.durationsMs, [420, 240, 300]);
  assert.deepEqual(eren.animations.skill2.durationsMs, [420, 400]);
  assert.deepEqual(Object.keys(eren.animations.run.frames), ["run_a", "run_b"]);
  assert.deepEqual(Object.values(eren.animations.run.frames), ["assets/eren-v1/run_a.png", "assets/eren-v1/run_b.png"]);
  assert.deepEqual(eren.animations.run.durationsMs, [170, 170]);
  assert.match(app, /function startRunCycle\(fighter, character, frameDuration, durationScale = 1\)/);
  assert.match(app, /sourceEl\.classList\.add\("is-melee-running", "is-melee-returning"\)/);
  assert.match(app, /impactFrames \?\? animationFrameNames\(attacker, "meleeAttack"/);
  assert.match(css, /data-character="eren"\]\.is-melee-returning .*transform: scaleX\(-1\)/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*?data-row="front"\] \{ left: calc\(18%/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*?data-team="enemy"\]\[data-row="front"\] \{ left: calc\(66%/);
  assert.equal((app.match(/startRunCycle\(sourceEl, attacker, actionTiming\.runFrameMs, playbackMultiplier\)/g) ?? []).length, 5,
    "regular and skill melee approach/return paths should use the same two-frame run cycle and selected playback speed");
  const erenManifest = JSON.parse(readFileSync(new URL("./assets/eren-v1/animation.json", import.meta.url), "utf8"));
  assert.deepEqual(erenManifest.actions.fall.frames.map((frame) => frame.durationMs), [2000, 680, 300]);
  assert.deepEqual(erenManifest.actions.meleeAttack.sequence, ["windup", "strike", "recover"]);
  assert.deepEqual(erenManifest.actions.meleeAttack.frames.map((frame) => frame.source), ["挥拳起手.png", "punch.png", "挥拳收手.png"]);
  assert.equal(erenManifest.actions.hit.source, "受到攻击.png");
  assert.equal(erenManifest.actions.dodge.source, "闪避.png");
  assert.equal(erenManifest.actions.death.source, "death.svg");
  assert.ok(app.includes('startFrameCycle(sourceEl, attacker, "meleeAttack", punchFrames, actionTiming.punchMs / punchFrames.length, false, playbackMultiplier)'));
  assert.match(app, /startFrameCycle\(actor, character, "fall"/);
  assert.match(app, /startFrameCycle\(targetEl, target, "dodge"/);
  assert.match(app, /startFrameCycle\(targetEl, target, "hit"/);
  assert.match(app, /startFrameCycle\(targetEl, target, "death"/);
  const paths = new Set(Object.values(eren.animations).flatMap((animation) => Object.values(animation.frames ?? {})));
  for (const assetPath of paths) {
    const png = readFileSync(new URL("./" + assetPath, import.meta.url));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), 96);
    assert.equal(png.readUInt32BE(20), 112);
    assert.equal(png[25], 6);
  }
  assert.deepEqual(eren.activeSkills, ["eren-free-will", "eren-tatakae"]);
  assert.equal(eren.passiveSkillId, "eren-2000-years");
});
test("entry landing has no extended green strip or green landing dust", () => {
  assert.match(html, /class="entry-ground"/);
  assert.match(css, /\.entry-screen\s*\{[^}]*url\("assets\/city-night-pixel\.png"\)[^}]*cover/);
  assert.doesNotMatch(css, /\.entry-screen\s*\{[^}]*linear-gradient\(#9bdef1[^}]*#c9e8b7/s);
  assert.match(css, /\.entry-ground\s*\{[^}]*bottom:\s*35px[^}]*width:\s*42px[^}]*background:\s*rgba\(12,20,30/);
  assert.doesNotMatch(css, /\.entry-ground\s*\{[^}]*width:\s*88%/);
  assert.match(css, /\.entry-actor\.is-dropping::after\s*\{[^}]*background:\s*#a7a8a0/);
  assert.doesNotMatch(css, /\.entry-actor\.is-dropping::after\s*\{[^}]*background:\s*#4d8c60/);
});

test("unlearned skills keep the disabled style and use the 技 marker", () => {
  assert.match(app, /locked-skill[\s\S]*detail-skill-icon quiet">技/);
  assert.doesNotMatch(app, /detail-skill-icon quiet">锁/);
  assert.match(css, /\.detail-skill-row\.locked-skill\s*\{[^}]*opacity:\s*\.58[^}]*grayscale\(\.65\)/);
  assert.match(css, /\.detail-skill-icon\.quiet\s*\{[^}]*color:\s*#9ca69a/);
});

test("Boss distance marker follows route progress using selected art and the demon sign", () => {
  assert.match(html, /id="boss-distance-player" class="distance-portrait"/);
  assert.match(html, /class="boss-distance-icon" src="assets\/route-signs\/demon\.png"/);
  assert.doesNotMatch(html, /☠/);
  assert.match(app, /campaign\.runCharacterState\?\.characterId \?\? campaign\.playerId/);
  assert.match(app, /portrait\.src = character\.asset/);
  assert.match(app, /campaign\.step \/ ROUTE_MAP_FINAL_STEP/);
  assert.match(app, /portrait\.style\.left = `clamp\(10px,/);
  assert.doesNotMatch(css, /\.boss-distance-track\s*\{[^}]*overflow:\s*hidden/);
});

test("route signs are lowered to meet the grass foreground instead of hovering above it", () => {
  assert.match(css, /\.route-signs\s*\{[^}]*bottom:\s*21%/);
  assert.match(css, /\.route-sign-image\s*\{[^}]*object-position:\s*center bottom/);
  assert.match(css, /\.route-ground\s*\{[^}]*height:\s*26%/);
});

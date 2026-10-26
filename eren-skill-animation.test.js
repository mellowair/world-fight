import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTING_CHARACTERS } from "./characters.js";

const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");
const manifest = JSON.parse(readFileSync(new URL("./assets/eren-v1/animation.json", import.meta.url), "utf8"));

test("Eren skill animations map to the supplied individual frames and authored order", () => {
  assert.deepEqual(eren.skillAnimationMap, { "eren-free-will": "skill1", "eren-tatakae": "skill2" });
  for (const [skillId, action] of Object.entries(manifest.skills)) {
    const animation = eren.animations[action.action];
    assert.deepEqual(Object.values(animation.frames).map((path) => path.split("/").at(-1)), action.frames.map((frame) => frame.frame));
    assert.deepEqual(animation.durationsMs, action.frames.map((frame) => frame.durationMs));
    assert.equal(animation.loop, false);
    assert.match(action.sequence[0], /^skill[12]_1$/);
    assert.ok(action.sequence[1].includes("run_a/run_b_to_target"));
    assert.ok(action.sequence.at(-1).includes("run_a/run_b_return"));
  }
  assert.deepEqual(Object.keys(eren.animations.skill2.frames), ["skill2_1", "skill2_2"]);
  assert.deepEqual(eren.animations.skill2.durationsMs, [420, 400]);
});

test("all Eren skill frames are standalone 96x112 transparent RGBA PNGs", () => {
  for (const action of Object.values(manifest.skills)) {
    for (const { frame } of action.frames) {
      const png = readFileSync(new URL(`./assets/eren-v1/${frame}`, import.meta.url));
      assert.equal(png.toString("ascii", 1, 4), "PNG");
      assert.equal(png.readUInt32BE(16), 96);
      assert.equal(png.readUInt32BE(20), 112);
      assert.equal(png[25], 6, `${frame} retains RGBA transparency`);
    }
  }
});

test("Eren skill action locks movement/action frames in order and keeps combat event replay single-settlement", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /const isErenSkill = isMelee && attacker\.id === "eren"/);
  assert.match(app, /showFighterFrame\(sourceEl, attacker, skillAnimationName, skillAnimationFrames\[0\]\)/);
  assert.match(app, /erenWindupMs \+ actionTiming\.rushMs \+ erenFollowThroughMs/);
  assert.match(app, /startRunCycle\(sourceEl, attacker, actionTiming\.runFrameMs, playbackMultiplier\)/);
  assert.match(app, /sourceEl\.classList\.add\("is-melee-at-target", "is-skill-posing"\)/);
  assert.match(app, /sourceEl\.classList\.remove\("is-clone-melee-approaching", "is-melee-at-target", "is-skill-posing", "is-punching", "is-melee-running"\)/);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /data-character="eren"\]\.is-skill-posing \.sprite-action-frame \{ transform: scale\(1\.12\)/);
  assert.match(css, /\.fighter\.is-punching:not\(\.is-skill-posing\) \.sprite-action/);
  assert.match(readFileSync(new URL("./style.css", import.meta.url), "utf8"), /\.fighter\.is-melee-at-target \{ translate: var\(--melee-x, 44px\) 0; \}/);
  assert.match(app, /playEvent\(event, \(\) => playNext\(token\)\)/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEIDARA_ANIMATIONS } from "./characters.js";
import { SKILL_DATA } from "./skills.js";

const animationJson = JSON.parse(readFileSync(new URL("./assets/deidara-v2/animation.json", import.meta.url), "utf8"));

test("Deidara V2 animation frames use the requested counts and matching skill mapping", () => {
  assert.equal(SKILL_DATA["c4-garuda"].levels[1].chance, 1);
  assert.deepEqual(Object.keys(DEIDARA_ANIMATIONS.skill1.frames).map((key) => DEIDARA_ANIMATIONS.skill1.frames[key].split("/").slice(-2).join("/")), animationJson.skill1.frames);
  assert.deepEqual(Object.keys(DEIDARA_ANIMATIONS.skill2.frames).map((key) => DEIDARA_ANIMATIONS.skill2.frames[key].split("/").slice(-2).join("/")), animationJson.skill2.frames);
  assert.equal(Object.keys(DEIDARA_ANIMATIONS.hit.frames).length, 2, "hurt and dizzy reuse the same single authored hit frame");
  assert.equal(DEIDARA_ANIMATIONS.hit.frames.hurt, DEIDARA_ANIMATIONS.hit.frames.dizzy);
  assert.equal(Object.keys(DEIDARA_ANIMATIONS.death.frames).length, 1);
});

test("all Deidara V2 frame files are 96x112 transparent RGBA PNGs", () => {
  const paths = [
    ...Object.values(DEIDARA_ANIMATIONS.idle.frames),
    ...Object.values(DEIDARA_ANIMATIONS.skill1.frames),
    ...Object.values(DEIDARA_ANIMATIONS.hit.frames),
    ...Object.values(DEIDARA_ANIMATIONS.death.frames),
    ...Object.values(DEIDARA_ANIMATIONS.skill2.frames),
  ];
  for (const path of new Set(paths)) {
    const png = readFileSync(new URL("./" + path, import.meta.url));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), 96);
    assert.equal(png.readUInt32BE(20), 112);
    assert.equal(png[25], 6);
  }
});

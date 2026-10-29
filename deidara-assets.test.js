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


test("Deidara combat defaults to a bundled idle frame and failed action frames fall back to the base sprite", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const campaign = readFileSync(new URL("./campaign.js", import.meta.url), "utf8");
  assert.match(campaign, /asset: "assets\/deidara-v2\/idle\/idle_1\.png"/);
  assert.doesNotMatch(campaign, /reference\/迪达拉\.png/);
  assert.ok(app.includes('frameImage.addEventListener("error"'));
  assert.ok(app.includes('classList.remove("has-action-sprite")'));
  assert.ok(app.includes('node.dataset.requestedFrame !== frame'));
});

test("Deidara sprite scale and baseline are consistent between idle and action poses", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.fighter\.is-deidara \.sprite \{ transform: scaleX\(-1\); transform-origin: center bottom;/);
  assert.match(css, /\.fighter\.is-deidara \.sprite-action-frame \{ transform: scaleX\(-1\) scale\(\.871429\); transform-origin: center bottom;/);
  assert.match(css, /\.sprite-visual \{[^}]*transform-origin: center bottom;/);
  assert.match(css, /\.fighter\.is-deidara \.sprite-wrap \{ transform: translateY\(0\); \}/);
});


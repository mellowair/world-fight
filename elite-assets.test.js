import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANIMATION_TIMING, ELITE_ENEMY_DATA } from "./characters.js";
import { SKILL_DATA } from "./skills.js";

test("elite roster uses the four standalone transparent figure 1/2 assets", () => {
  const mahito = ELITE_ENEMY_DATA.find((entry) => entry.id === "mahito");
  const bomb = ELITE_ENEMY_DATA.find((entry) => entry.id === "bomb-demon");
  assert.ok(mahito && bomb);
  assert.deepEqual([mahito.hp, mahito.atk, mahito.def, mahito.spd], [1000, 40, 40, 60]);
  assert.deepEqual([bomb.hp, bomb.atk, bomb.def, bomb.spd], [900, 150, 40, 120]);
  assert.equal(mahito.asset, "assets/elites/mahito_idle.png");
  assert.equal(mahito.animations.domain.frames.domain, "assets/elites/mahito_domain.png");
  assert.equal(bomb.asset, "assets/elites/bomb_demon_idle.png");
  assert.equal(bomb.escapeAsset, "assets/elites/bomb_demon_escape.png");
  assert.equal(bomb.activeSkills[0], "bomb-demon-boom");
  assert.equal(bomb.skillAnimationMap["bomb-demon-boom"], "boom");
  assert.deepEqual(Object.values(bomb.animations.boom.frames), ["assets/elites/bomb_demon_boom_1.png", "assets/elites/bomb_demon_boom_2.png"]);
  assert.deepEqual(bomb.animations.boom.durationsMs, [900, 300]);
  assert.equal(bomb.animations.boom.loop, false);
  assert.equal(SKILL_DATA["bomb-demon-boom"].levels[1].chance, 0.5);
  assert.equal(SKILL_DATA["bomb-demon-boom"].levels[1].multiplier, 2.5);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.deepEqual([ANIMATION_TIMING.elite.domainDurationMs, ANIMATION_TIMING.elite.domainRevealDelayMs, ANIMATION_TIMING.elite.bombEscapeDurationMs], [2000, 500, 2000]);
  assert.match(app, /elite-passive-trigger/);
  assert.match(app, /showFighterFrame\(fighter, actor, "idle", "idle"\)/);
  assert.match(app, /showFighterFrame\(fighter, actor, "domain", "domain"\)/);
  assert.match(app, /actor\.asset = domainAsset/);
  assert.match(app, /character\?\.elitePassiveId === "mahito-domain" && character\.visualDomainActive/);
  assert.match(app, /delete character\.visualDomainActive/);
  assert.match(app, /actor\.visualDomainActive = true/);
  assert.match(app, /frame\.dataset\.requestedFrame = ""/);
  assert.match(app, /elite-escape/);
  assert.match(app, /fighter\.classList\.add\("has-escaped"\)/);
  assert.match(app, /fighter\.classList\.remove\("is-elite-escape", "has-escaped", "is-domain-active"\)/);
  assert.match(css, /\.fighter\.has-escaped \{ translate: 115vw 0; opacity: 0; pointer-events: none; \}/);
  assert.match(app, /\}, ANIMATION_TIMING\.elite\.bombEscapeDurationMs\)/);
  assert.match(app, /const isBombDemonSkill = event\.skillId === "bomb-demon-boom"/);
  assert.match(app, /: isBombDemonSkill \? skillActionMs/);
  assert.match(app, /const frameDurationScale = isBombDemonSkill\s*\? playbackMultiplier/);
  assert.match(css, /is-elite-escape \{ animation: elite-run-away var\(--elite-escape-duration, 2s\)/);
  assert.match(css, /animation: domain-banner-in var\(--domain-banner-duration, 2s\)/);
});

test("elite art frames are standalone 96x112 transparent RGBA PNGs", () => {
  for (const path of ["mahito_idle.png", "mahito_domain.png", "bomb_demon_idle.png", "bomb_demon_escape.png", "bomb_demon_boom_1.png", "bomb_demon_boom_2.png"]) {
    const png = readFileSync(new URL(`./assets/elites/${path}`, import.meta.url));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), 96);
    assert.equal(png.readUInt32BE(20), 112);
    assert.equal(png[25], 6);
  }
});

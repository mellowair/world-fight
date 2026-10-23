import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANIMATION_TIMING, CHARACTER_DATA, COMBAT_RULES, STARTING_CHARACTERS } from "./characters.js";
import { calculateDamage, chooseTarget, executeAttack, getActionOrder, getCritChance, getDodgeChance, getSkillDodgeChance, initializeBattle, simulateBattle } from "./battle.js";

test("keeps speed order and front-row targeting", () => {
  const state = initializeBattle();
  assert.deepEqual(getActionOrder(state).map((character) => character.id), ["naruto", "mage", "guard"]);
  assert.equal(chooseTarget(state, state.characters[0], () => 0.9).id, "guard");
  state.characters.find((character) => character.id === "guard").alive = false;
  state.characters.find((character) => character.id === "guard").currentHp = 0;
  assert.equal(chooseTarget(state, state.characters[0], () => 0.9).id, "mage");
});

test("uses the configured dodge, critical, and damage formulas", () => {
  const naruto = CHARACTER_DATA[0];
  const guard = CHARACTER_DATA[1];
  assert.equal(getDodgeChance(naruto), 0.05);
  assert.ok(Math.abs(getSkillDodgeChance(naruto) - 0.01) < 1e-9);
  assert.equal(getSkillDodgeChance({ spd: 9999 }), COMBAT_RULES.skillDodgeChanceCap);
  assert.equal(getDodgeChance({ spd: 9999 }), COMBAT_RULES.maxDodgeChance);
  assert.equal(getCritChance(naruto), 0.05);
  assert.equal(calculateDamage(naruto, guard), 93);
  assert.equal(calculateDamage(naruto, guard, 1.8), 168);
  assert.equal(calculateDamage(naruto, guard, COMBAT_RULES.critMultiplier), 140);
});

test("records dodges without damage and critical hits with multiplied damage", () => {
  const attacker = { id: "a", team: "ally", atk: 150, def: 0, spd: 80, currentHp: 100, alive: true, skill: null };
  const target = { id: "t", team: "enemy", atk: 1, def: 60, spd: 80, currentHp: 300, alive: true, skill: null };
  const state = { characters: [attacker, target] };
  const dodge = executeAttack(state, attacker, target, () => 0.01);
  assert.equal(dodge.dodged, true);
  assert.equal(dodge.critical, false);
  assert.equal(dodge.damage, 0);
  assert.equal(target.currentHp, 300);

  const sequence = [0.9, 0.01];
  const critical = executeAttack(state, attacker, target, () => sequence.shift());
  assert.equal(critical.dodged, false);
  assert.equal(critical.critical, true);
  assert.equal(critical.damage, 140);
  assert.equal(target.currentHp, 160);
});

test("direct damage skills use the lower skill dodge chance", () => {
  const attacker = { id: "a", team: "ally", atk: 100, spd: 80, currentHp: 100, alive: true, skill: { chance: 1, multiplier: 1.8, effectType: "damage", name: "test" } };
  const target = { id: "t", team: "enemy", def: 0, spd: 80, currentHp: 300, alive: true };
  const state = { characters: [attacker, target] };
  const values = [0, 0.02, 0.99];
  const event = executeAttack(state, attacker, target, () => values.shift());
  assert.equal(event.attackKind, "skill");
  assert.ok(Math.abs(event.dodgeChance - 0.01) < 1e-9);
  assert.equal(event.dodged, false);
});

test("a dodged direct damage skill deals zero damage and cannot crit", () => {
  const attacker = { id: "a", team: "ally", atk: 100, spd: 80, currentHp: 100, alive: true, skill: { chance: 1, multiplier: 1.8, effectType: "damage", name: "test" } };
  const target = { id: "t", team: "enemy", def: 0, spd: 80, currentHp: 300, alive: true };
  const values = [0, 0.001];
  const event = executeAttack({ characters: [attacker, target] }, attacker, target, () => values.shift());
  assert.equal(event.attackKind, "skill");
  assert.equal(event.dodged, true);
  assert.equal(event.critical, false);
  assert.equal(event.damage, 0);
  assert.equal(target.currentHp, 300);
});

test("pre-simulates an outcome and returns final HP for campaign persistence", () => {
  const result = simulateBattle(() => 0.99);
  assert.ok(["victory", "defeat"].includes(result.outcome));
  assert.ok(result.finalCharacters.every((character) => character.currentHp >= 0));
  assert.equal(result.events.at(-1).type, "battle-end");
  assert.ok(result.events.filter((event) => event.type === "attack").every((event) => "dodged" in event && "critical" in event));
});

test("records configured attack presentation and immutable hit results", () => {
  const attacker = { id: "a", team: "ally", atk: 150, spd: 80, currentHp: 100, alive: true, attackType: "melee", skill: null };
  const target = { id: "t", team: "enemy", def: 60, spd: 80, currentHp: 300, alive: true };
  const event = executeAttack({ characters: [attacker, target] }, attacker, target, () => 0.99);
  assert.equal(event.attackType, "melee");
  assert.equal(event.hit, true);
  assert.equal(event.attackerId, "a");
  assert.equal(event.targetId, "t");
  assert.equal(event.damage, 93);
  assert.equal(event.targetHp, 207);
  assert.equal(CHARACTER_DATA.find((character) => character.id === "mage").attackType, "magic");
  assert.equal(CHARACTER_DATA.find((character) => character.id === "naruto").skill.attackType, "melee");

  const skillUser = { ...attacker, skill: { chance: 1, multiplier: 1, effectType: "damage", attackType: "magic", name: "配置覆盖测试" } };
  const skillTarget = { ...target, currentHp: 300 };
  const skillValues = [0, 0.99, 0.99];
  const skillEvent = executeAttack({ characters: [skillUser, skillTarget] }, skillUser, skillTarget, () => skillValues.shift());
  assert.equal(skillEvent.attackType, "magic");
  assert.equal(skillEvent.hit, true);
});

test("keeps opening and entry animation timings centrally configured", () => {
  const naruto = STARTING_CHARACTERS.find((character) => character.id === "naruto");
  assert.equal(ANIMATION_TIMING.opening.blackMs, 400);
  assert.equal(ANIMATION_TIMING.opening.skyRedMs, 3000);
  assert.equal(naruto.poseSequence.reduce((sum, pose) => sum + pose.duration, 0), ANIMATION_TIMING.entryPoseMs);
});

test("maps Naruto v2 pose, run, attack, and hit states to individual frame assets", () => {
  const naruto = STARTING_CHARACTERS.find((character) => character.id === "naruto");
  assert.equal(naruto.asset, "assets/naruto-v2/frames/idle.svg");
  assert.equal(naruto.animations.pose.type, "frames");
  assert.deepEqual(naruto.animations.pose.frames, {
    landed: "assets/naruto-v2/frames/idle.svg",
    surprised: "assets/naruto-v2/frames/surprised.svg",
    scratch: "assets/naruto-v2/frames/hand_head.svg",
    smile: "assets/naruto-v2/frames/smile_thumbs_up.svg",
    "thumbs-up": "assets/naruto-v2/frames/smile_thumbs_up.svg",
  });
  assert.deepEqual(naruto.animations.run.frames, {
    run_a: "assets/naruto-v2/frames/run_a.svg",
    run_b: "assets/naruto-v2/frames/run_b.svg",
  });
  assert.equal(naruto.animations.meleeAttack.frames.punch, "assets/naruto-v2/frames/punch.svg");
  assert.equal(naruto.animations.hit.frames.hit_x, "assets/naruto-v2/frames/hit_x.svg");
  assert.equal(ANIMATION_TIMING.attack.melee.runFrameMs, 125);
});

test("Naruto v2 frames are separate transparent 96 by 112 SVG assets", () => {
  const frameNames = ["idle", "surprised", "hand_head", "smile_thumbs_up", "run_a", "run_b", "punch", "hit_x"];
  for (const name of frameNames) {
    const frame = readFileSync(new URL(`./assets/naruto-v2/frames/${name}.svg`, import.meta.url), "utf8");
    assert.match(frame, /^<svg[^>]*width="96"[^>]*height="112"[^>]*viewBox="0 0 96 112"/);
    assert.doesNotMatch(frame, /<rect[^>]+(?:width="96"|width="100%")/);
  }
  const runA = readFileSync(new URL("./assets/naruto-v2/frames/run_a.svg", import.meta.url), "utf8");
  const runB = readFileSync(new URL("./assets/naruto-v2/frames/run_b.svg", import.meta.url), "utf8");
  assert.notEqual(runA, runB, "run cycle must alternate between distinct poses");
});

test("opening and hit feedback use smooth sky tint and pixel eye marks rather than text symbols", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(html, /class="sky-redness"/);
  assert.equal((html.match(/class="hit-eyes"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /×\s*×/);
  assert.match(css, /\.opening-redshift \.sky-redness/);
  assert.doesNotMatch(css, /red-sky-pulses/);
  assert.doesNotMatch(css, /@keyframes naruto-run-cycle/);
  assert.match(css, /\.fighter\.has-action-sprite \.hit-eyes \{ visibility: hidden; \}/);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /showingA \? "run_a" : "run_b"/);
  assert.match(app, /showFighterFrame\(sourceEl, attacker, "meleeAttack", "punch"\)/);
  assert.match(app, /showFighterFrame\(targetEl, target, "hit", "hit_x"\)/);
});

test("central combat animation timings target about 20 seconds or 10 seconds for twelve melee actions", () => {
  const { attack } = ANIMATION_TIMING;
  const meleeActionMs = attack.melee.rushMs + attack.melee.punchMs + attack.melee.recoveryMs + attack.eventGapMs;
  const normalSeconds = (12 * meleeActionMs + attack.resultHoldMs) / 1000;
  const fastSeconds = (12 * meleeActionMs / attack.fastPlaybackMultiplier + attack.resultHoldMs / attack.fastPlaybackMultiplier) / 1000;
  assert.ok(normalSeconds >= 20 && normalSeconds < 21);
  assert.ok(fastSeconds >= 10 && fastSeconds < 11);
});

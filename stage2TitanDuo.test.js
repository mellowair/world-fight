import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ELITE_ENEMY_DATA } from "./characters.js";
import { SKILL_DATA } from "./skills.js";
import { chooseTarget, executeAttack, expireArmoredShieldAtRoundEnd, initializeBattle,
  isBattleOver, simulateBattle, triggerSteamWaveAtRoundStart } from "./battle.js";
import { CHARACTER_VISUALS } from "./visualConfig.js";

const armoredTemplate = ELITE_ENEMY_DATA.find((entry) => entry.id === "armored-titan");
const colossalTemplate = ELITE_ENEMY_DATA.find((entry) => entry.id === "colossal-titan");
const armoredSkill = { ...SKILL_DATA["reiner-sat-down"], ...SKILL_DATA["reiner-sat-down"].levels[1], level: 1 };
const hero = (id, hp = 10000, atk = 300) => ({ id, name: id, team: "ally", row: "front", hp, currentHp: hp,
  atk, def: 0, spd: 100, critChance: 0, rosterOrder: id === "a" ? 0 : 1 });
const enemy = (template, extra = {}) => ({ ...template, team: "enemy", maxHp: template.hp, currentHp: template.hp,
  critChance: 0, skills: template.id === "armored-titan" ? [armoredSkill] : [], rosterOrder: template.id === "armored-titan" ? 2 : 3, ...extra });
const duo = (...allies) => initializeBattle([...allies, enemy(armoredTemplate), enemy(colossalTemplate)]);

test("both giants have independent base data, positions, skills, and placeholder art", () => {
  assert.deepEqual([armoredTemplate.hp, armoredTemplate.atk, armoredTemplate.def, armoredTemplate.spd], [2900, 260, 250, 50]);
  assert.deepEqual([colossalTemplate.hp, colossalTemplate.atk, colossalTemplate.def, colossalTemplate.spd], [2800, 0, 110, 1]);
  assert.deepEqual([armoredTemplate.row, colossalTemplate.row], ["front", "back"]);
  assert.equal(armoredSkill.chance, .5);
  assert.equal(colossalTemplate.periodicPassive.everyRounds, 3);
  for (const entry of [armoredTemplate, colossalTemplate]) {
    assert.ok(existsSync(new URL(`./${entry.asset}`, import.meta.url)));
    assert.ok(CHARACTER_VISUALS[entry.id].scale > 0);
  }
});

test("armored skill schedules 50% final normal-damage reduction only for the next complete round", () => {
  const state = duo(hero("a"));
  const [attacker, armored] = state.characters;
  state.round = 1;
  const cast = executeAttack(state, armored, attacker, () => .9, { skill: armoredSkill });
  assert.equal(cast.type, "skill");
  assert.equal(cast.effectiveFromRound, 2);
  assert.equal(cast.effectiveUntilRound, 2);
  const sameRound = executeAttack(state, attacker, armored, () => .9, { skill: null });
  assert.equal(sameRound.damage, 85);
  assert.equal(sameRound.armorReductionApplied, false);
  state.round = 2;
  const protectedHit = executeAttack(state, attacker, armored, () => .9, { skill: null });
  assert.equal(protectedHit.damage, 42);
  assert.equal(protectedHit.armorReductionApplied, true);
  assert.equal(expireArmoredShieldAtRoundEnd(state).type, "armor-shield-expired");
  assert.equal(expireArmoredShieldAtRoundEnd(state), null);
  state.round = 3;
  assert.equal(executeAttack(state, attacker, armored, () => .9, { skill: null }).damage, 85);
});

test("armored action uses the configured 50% trigger roll and keeps normal attacks when it fails", () => {
  const castState = duo(hero("a"));
  castState.round = 1;
  const cast = executeAttack(castState, castState.characters[1], castState.characters[0], () => .49);
  assert.equal(cast.skillId, "reiner-sat-down");
  assert.equal(cast.type, "skill");
  const attackState = duo(hero("a"));
  attackState.round = 1;
  const attack = executeAttack(attackState, attackState.characters[1], attackState.characters[0], () => .51);
  assert.equal(attack.type, "attack");
  assert.equal(attack.skillId, null);
});

test("repeat cast refreshes duration without stacking and death removes armor status", () => {
  const state = duo(hero("a"));
  const [attacker, armored] = state.characters;
  state.round = 1;
  executeAttack(state, armored, attacker, () => .9, { skill: armoredSkill });
  state.round = 2;
  const refresh = executeAttack(state, armored, attacker, () => .9, { skill: armoredSkill });
  assert.deepEqual([refresh.effectiveFromRound, refresh.effectiveUntilRound], [2, 3]);
  assert.equal(executeAttack(state, attacker, armored, () => .9, { skill: null }).damage, 42);
  assert.equal(expireArmoredShieldAtRoundEnd(state), null);
  state.round = 3;
  assert.equal(executeAttack(state, attacker, armored, () => .9, { skill: null }).damage, 42);
  assert.ok(expireArmoredShieldAtRoundEnd(state));
  state.round = 4;
  attacker.atk = 100000;
  assert.equal(executeAttack(state, attacker, armored, () => .9, { skill: null }).targetDied, true);
  assert.equal(armored.armorReductionStartRound, null);
  assert.equal(armored.armorReductionUntilRound, null);
});

test("steam wave triggers once at global rounds 3, 6, 9, 12, 15 despite SPD 1", () => {
  const state = duo(hero("a"), hero("b"));
  const expected = [];
  for (let round = 1; round <= 15; round += 1) {
    state.round = round;
    const event = triggerSteamWaveAtRoundStart(state);
    if (event) {
      expected.push(round);
      assert.deepEqual(event.hits.map((hit) => [hit.targetId, hit.damage]),
        [["a", 400], ["b", 400], ["armored-titan", 100]]);
      assert.equal(event.trueDamage, true);
      assert.equal(triggerSteamWaveAtRoundStart(state), null, "one wave per global round");
    }
  }
  assert.deepEqual(expected, [3, 6, 9, 12, 15]);
  assert.deepEqual(state.characters.slice(0, 2).map((entry) => entry.currentHp), [8000, 8000]);
  assert.equal(state.characters[2].currentHp, 2400);
  assert.equal(state.characters[3].currentHp, 2800);
});

test("steam wave ignores DEF and dodge, affects living targets only, and can kill armor and players", () => {
  const state = duo(hero("a", 300), hero("b", 500));
  const [a, b, armored, colossal] = state.characters;
  a.def = 9999; a.spd = 9999;
  armored.currentHp = 90;
  state.round = 3;
  const wave = triggerSteamWaveAtRoundStart(state);
  assert.deepEqual(wave.hits.map((hit) => [hit.actualDamage, hit.targetDied]), [[300, true], [400, false], [90, true]]);
  assert.equal(a.currentHp, 0);
  assert.equal(armored.currentHp, 0);
  assert.equal(colossal.currentHp, 2800);
  assert.equal(isBattleOver(state), null, "surviving ally and Colossal keep the fight active");
  state.round = 6;
  assert.deepEqual(triggerSteamWaveAtRoundStart(state).hits.map((hit) => hit.targetId), ["b"]);
  assert.equal(isBattleOver(state), "defeat");
  state.round = 9;
  colossal.currentHp = 0; colossal.alive = false;
  assert.equal(triggerSteamWaveAtRoundStart(state), null);
});

test("normal targeting respects the armored front row and requires both giants to die for victory", () => {
  const state = duo(hero("a"));
  const [attacker, armored, colossal] = state.characters;
  assert.equal(chooseTarget(state, attacker, () => .99).id, armored.id);
  armored.currentHp = 0; armored.alive = false;
  assert.equal(isBattleOver(state), null);
  assert.equal(chooseTarget(state, attacker, () => 0).id, colossal.id);
  colossal.currentHp = 0; colossal.alive = false;
  assert.equal(isBattleOver(state), "victory");
  const result = simulateBattle([hero("a", 10000, 800), enemy(armoredTemplate), enemy(colossalTemplate)], () => .9);
  assert.equal(result.outcome, "victory");
  assert.ok(result.events.some((event) => event.type === "steam-wave"));
  assert.ok(result.events.every((event) => !(event.type === "attack" && event.attackerId === "colossal-titan")));
});

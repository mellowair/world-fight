import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ELITE_ENEMY_DATA, EVENT_ENEMY_DATA, STAGE_TWO_BOSS_DATA, STARTING_CHARACTERS } from "./characters.js";
import { getStageTwoNormalEnemyStats } from "./campaign.js";
import { createStageTwoDirectBattleCampaign } from "./dev/stage2-config.js";
import { executeAttack, initializeBattle } from "./battle.js";
import { createAdventureEventResult, createRunCharacterState, getSeaBeyondOfferDetails, resolveAdventureEvent, upgradePassiveSkill } from "./progression.js";
import { SKILL_DATA } from "./skills.js";

test("stage-two normal enemies use exact final stats at both tier boundaries", () => {
  const expected = [
    [1, [2200, 200, 110, 50], [1650, 260, 85, 60]],
    [6, [2200, 200, 110, 50], [1650, 260, 85, 60]],
    [7, [2550, 260, 125, 50], [1900, 330, 95, 60]],
    [12, [2550, 260, 125, 50], [1900, 330, 95, 60]],
    [13, [2900, 320, 145, 50], [2200, 420, 110, 60]],
    [14, [2900, 320, 145, 50], [2200, 420, 110, 60]],
  ];
  for (const [step, guard, mage] of expected) {
    const values = (id) => { const stats = getStageTwoNormalEnemyStats(id, step); return [stats.hp, stats.atk, stats.def, stats.spd]; };
    assert.deepEqual(values("guard"), guard, `front step ${step}`);
    assert.deepEqual(values("mage"), mage, `back step ${step}`);
  }
});

test("stage-two elites, Boss and two event enemies retain their final template stats", () => {
  const lookup = new Map(ELITE_ENEMY_DATA.map((enemy) => [enemy.id, enemy]));
  for (const [id, expected] of [
    ["toji", [3500, 430, 170, 220]], ["kira", [3300, 400, 120, 80]],
    ["armored-titan", [2900, 260, 250, 50]], ["colossal-titan", [2800, 0, 110, 1]],
  ]) {
    const enemy = lookup.get(id);
    assert.deepEqual([enemy.hp, enemy.atk, enemy.def, enemy.spd], expected, id);
  }
  assert.deepEqual([STAGE_TWO_BOSS_DATA.hp, STAGE_TWO_BOSS_DATA.atk, STAGE_TWO_BOSS_DATA.def, STAGE_TWO_BOSS_DATA.spd], [5500, 600, 170, 150]);
  assert.deepEqual([EVENT_ENEMY_DATA.gilgamesh.hp, EVENT_ENEMY_DATA.gilgamesh.atk, EVENT_ENEMY_DATA.gilgamesh.def, EVENT_ENEMY_DATA.gilgamesh.spd], [3500, 400, 150, 125]);
  assert.deepEqual([EVENT_ENEMY_DATA.suzuya.hp, EVENT_ENEMY_DATA.suzuya.atk, EVENT_ENEMY_DATA.suzuya.def, EVENT_ENEMY_DATA.suzuya.spd], [4400, 420, 145, 90]);
  assert.equal(lookup.get("colossal-titan").periodicPassive.everyRounds, 3);
});

test("the local developer selector uses stage-two steps directly without a global offset", () => {
  for (const localStep of [1, 7, 15]) {
    const campaign = createStageTwoDirectBattleCampaign({ heroId: "naruto", partnerId: "eren",
      encounterId: "toji", localStep, seed: 83 });
    assert.equal(campaign.stageStep, localStep);
    assert.equal(campaign.currentBattle.enemies[0], "toji");
  }
});

test("Sea Beyond displays the cached first-chapter roll and settles that same roll", () => {
  const hero = STARTING_CHARACTERS.find((character) => character.id === "naruto");
  const state = createRunCharacterState(hero);
  const beforeAtk = state.atk;
  const offer = createAdventureEventResult(state, "sea-preview", "sea_beyond", () => 0);
  const details = getSeaBeyondOfferDetails(offer);
  assert.deepEqual(details.map(({ hpLossPercent, hpLoss, rewardStat, rewardAmount }) => [hpLossPercent, hpLoss, rewardStat, rewardAmount]),
    [[20, 320, "atk", 30], [30, 480, "atk", 50], [40, 640, "atk", 70]]);
  assert.deepEqual(getSeaBeyondOfferDetails(createAdventureEventResult(state, "sea-preview", "sea_beyond", () => .99)), details,
    "reopening the same event must not redraw the offer");
  resolveAdventureEvent(state, "sea-preview", "sea_begin");
  resolveAdventureEvent(state, "sea-preview", "sea_sacrifice");
  const settled = resolveAdventureEvent(state, "sea-preview", "sea_finish");
  assert.equal(settled.result.hpLoss, details[0].hpLoss);
  assert.deepEqual(settled.result.gains, [{ stat: "atk", amount: 30 }]);
  assert.equal(state.atk, beforeAtk + 30);
  assert.deepEqual(state.eventSeries.sea.rewards, [{ stat: "atk", amount: 30 }]);
  createAdventureEventResult(state, "sea-sequel", "sea_beyond_2");
  resolveAdventureEvent(state, "sea-sequel", "sea_stay");
  assert.equal(state.atk, beforeAtk + 90, "chapter two adds twice the saved first-chapter gain");
  assert.match(readFileSync(new URL("./app.js", import.meta.url), "utf8"), /getSeaBeyondOfferDetails\(record\)/);
});

test("level-two passives use the new exact thresholds and amounts without persistent multiplication", () => {
  const naruto = STARTING_CHARACTERS.find((character) => character.id === "naruto");
  const run = createRunCharacterState(naruto);
  assert.equal(upgradePassiveSkill(run, "boss-passive").level, 2);
  assert.equal(SKILL_DATA.jinchuriki.levels[2].currentHpRatioBelow, .5);
  const self = { ...naruto, maxHp: run.maxHp, currentHp: run.maxHp / 2, passiveLevel: 2, critChance: 0 };
  const foe = { id: "dummy", team: "enemy", row: "front", maxHp: 10000, currentHp: 10000, atk: 1, def: 0, spd: 0, critChance: 0 };
  const battle = initializeBattle([self, foe], { battleId: "threshold-check", playerId: "naruto", runCharacterState: run });
  battle.round = 1;
  const [attacker, target] = battle.characters;
  executeAttack(battle, attacker, target, () => .99, { skill: null });
  assert.equal(attacker.atk, run.atk, "exactly half HP must not trigger Jinchuriki");
  attacker.currentHp -= 1;
  const triggered = executeAttack(battle, attacker, target, () => .99, { skill: null });
  assert.equal(attacker.atk, Math.floor(run.atk * 1.3));
  assert.equal(triggered.jinchurikiLifesteal, Math.floor(triggered.actualDamage * .05));
  assert.equal(run.atk, naruto.atk, "the battle bonus must not change the run stat");
  assert.equal(SKILL_DATA["kaneki-one-eye"].levels[2].healFromCalculatedDamage, .4);
  assert.equal(SKILL_DATA["eren-2000-years"].levels[2].maxHpBonus, 100);
});

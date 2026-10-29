import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { CHARACTER_DATA, EVENT_ENEMY_DATA, NORMAL_ENEMY_APPEARANCES, STAGE_TWO_BOSS_DATA, STARTING_CHARACTERS } from "./characters.js";
import { SKILL_DATA } from "./skills.js";
import { calculateDamage, detonateDueBombs, executeAttack, getDodgeChance, getSkillDodgeChance, initializeBattle, simulateBattle, summonAtRoundStart } from "./battle.js";
import { chooseRoute, claimCampaignTreasure, claimStageTwoStatReward, finishBattle, getCampaignRewardOffer, getCampaignTreasureOffer, getRouteEnemyGrowth, getRouteOptions, getStageTwoNormalEnemyStats, prepareBattle, resolveCampaignEvent, startCampaignEventBattle } from "./campaign.js";
import { claimTreasure, createAdventureEventResult, createRunCharacterState, resolveAdventureEvent, startAdventureBattle, completeAdventureBattle, upgradePassiveSkill } from "./progression.js";
import { createStageTwoTestCampaign } from "./dev/stage2-config.js";

const ally = (id, extra = {}) => ({ id, name: id, team: "ally", row: "front", hp: 3000, currentHp: 3000,
  atk: 250, def: 40, spd: 100, critChance: 0, rosterOrder: 0, ...extra });
const enemy = (id, extra = {}) => ({ id, name: id, team: "enemy", row: "front", hp: 3000, currentHp: 3000,
  atk: 100, def: 40, spd: 50, critChance: 0, rosterOrder: 1, ...extra });

test("v9 uses local stage-two growth with the confirmed ninth-step cap", () => {
  assert.deepEqual(getRouteEnemyGrowth("normal", 1, 2), { hp: .8, atk: .8, def: .8 });
  assert.deepEqual(getRouteEnemyGrowth("elite", 6, 2), { hp: 1.15, atk: 1.1, def: 1.05 });
  assert.deepEqual(getRouteEnemyGrowth("normal", 14, 2), getRouteEnemyGrowth("normal", 9, 2));
  assert.deepEqual([STAGE_TWO_BOSS_DATA.hp, STAGE_TWO_BOSS_DATA.def], [5500, 170]);
  assert.equal(STARTING_CHARACTERS.find((entry) => entry.id === "kaneki").row, "back");
});

test("v9 art and appearance registry use independent assets", () => {
  for (const id of ["lubu", "dementor", "jack", "teruhashi"])
    assert.ok(existsSync(new URL(`./${NORMAL_ENEMY_APPEARANCES[id].asset}`, import.meta.url)));
  assert.ok(existsSync(new URL("./assets/events/event_kings_treasury.png", import.meta.url)));
  assert.deepEqual(Object.keys(STAGE_TWO_BOSS_DATA.animations.meleeAttack.frames), ["windup", "punch"]);
});

test("stage-two normal nodes use one local-step early enemy and one per row from step five", () => {
  for (const localStep of [1, 4, 5, 9, 14]) {
    const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
    campaign.stageStep = localStep;
    const node = getRouteOptions(campaign).find((entry) => entry.type === "battle");
    assert.ok(node);
    const started = chooseRoute(campaign, node.id);
    assert.equal(started.battle.enemies.length, localStep < 5 ? 1 : 2);
    if (localStep >= 5) assert.deepEqual(started.battle.enemies, ["guard", "mage"]);
    const roster = prepareBattle(campaign).roster.filter((unit) => unit.team === "enemy");
    for (const unit of roster) {
      const front = unit.id === "guard";
      assert.ok((front ? ["lubu", "dementor", "deep_sea_king"] : ["jack", "teruhashi", "gollum"]).includes(unit.appearanceId));
      assert.equal(unit.row, front ? "front" : "back");
      const base = getStageTwoNormalEnemyStats(unit.id, localStep);
      assert.deepEqual([unit.maxHp, unit.atk, unit.def, unit.spd],
        [base.hp, base.atk, base.def, base.spd]);
    }
  }
});

test("treasury choice caches two real rewards and each branch is claimed once", () => {
  const run = createRunCharacterState(CHARACTER_DATA[0]);
  createAdventureEventResult(run, "treasury-a", "kings_treasury");
  const stolen = resolveAdventureEvent(run, "treasury-a", "treasury_steal", () => .1);
  assert.equal(stolen.result.treasureOffer, "small");
  assert.equal(resolveAdventureEvent(run, "treasury-a", "treasury_steal", () => .99), false);
  const smallOffer = run.eventResults["treasury-a"].data.treasureOffer;
  assert.equal(smallOffer.choices.length, 2);
  assert.equal(new Set(smallOffer.choices).size, 2);
  assert.ok(claimTreasure(run, "treasury-a", smallOffer.choices[0], run, run.characterId));
  assert.equal(claimTreasure(run, "treasury-a", smallOffer.choices[1], run, run.characterId), false);
  createAdventureEventResult(run, "treasury-b", "kings_treasury");
  const fight = resolveAdventureEvent(run, "treasury-b", "treasury_advance");
  assert.equal(fight.result.pendingBattle, true);
  assert.ok(startAdventureBattle(run, "treasury-b"));
  const result = completeAdventureBattle(run, "treasury-b", "victory", () => .2);
  assert.equal(result.status, "awaiting_reward");
  assert.equal(completeAdventureBattle(run, "treasury-b", "victory"), false);
  const royalOffer = run.eventResults["treasury-b"].data.treasureOffer;
  assert.equal(royalOffer.tier, "royal");
  assert.equal(new Set(royalOffer.choices).size, 2);
  assert.ok(claimTreasure(run, "treasury-b", royalOffer.choices[0], run, run.characterId));
  assert.equal(claimTreasure(run, "treasury-b", royalOffer.choices[1], run, run.characterId), false);
  assert.equal(EVENT_ENEMY_DATA.gilgamesh.hp, 3500);
});

test("passive upgrade is idempotent and Eren gets max HP without healing", () => {
  const eren = createRunCharacterState(STARTING_CHARACTERS.find((entry) => entry.id === "eren"));
  eren.currentHp -= 200;
  const before = [eren.currentHp, eren.maxHp];
  assert.equal(upgradePassiveSkill(eren, "boss-1").level, 2);
  assert.deepEqual([eren.currentHp, eren.maxHp], [before[0], before[1] + 100]);
  assert.equal(upgradePassiveSkill(eren, "boss-1"), false);
});

test("level-two passives apply in combat without permanently multiplying base stats", () => {
  const erenRun = createRunCharacterState(STARTING_CHARACTERS.find((entry) => entry.id === "eren"));
  upgradePassiveSkill(erenRun, "boss-eren");
  const erenState = initializeBattle([ally("eren", { hp: erenRun.maxHp, currentHp: erenRun.maxHp,
    passiveSkillId: erenRun.passiveSkillId, passiveLevel: 2 }), enemy("foe")],
    { battleId: "eren-lv2", playerId: "eren", runCharacterState: erenRun });
  erenState.round = 1;
  const incoming = () => executeAttack(erenState, erenState.characters[1], erenState.characters[0], () => .99, { skill: null });
  assert.equal(incoming().actualDamage, 0);
  assert.equal(incoming().actualDamage, 0);
  assert.ok(incoming().actualDamage > 0);

  const narutoRun = createRunCharacterState(STARTING_CHARACTERS.find((entry) => entry.id === "naruto"));
  upgradePassiveSkill(narutoRun, "boss-naruto");
  narutoRun.currentHp = Math.floor(narutoRun.maxHp * .49);
  const narutoState = initializeBattle([ally("naruto", { hp: narutoRun.maxHp, currentHp: narutoRun.currentHp,
    atk: narutoRun.atk, passiveSkillId: narutoRun.passiveSkillId, passiveLevel: 2 }),
    enemy("foe", { hp: 10000, currentHp: 10000, def: 0 })],
    { battleId: "naruto-lv2", playerId: "naruto", runCharacterState: narutoRun });
  narutoState.round = 1;
  const triggered = executeAttack(narutoState, narutoState.characters[0], narutoState.characters[1], () => .99, { skill: null });
  assert.equal(narutoState.characters[0].atk, Math.floor(narutoRun.atk * 1.30));
  assert.equal(triggered.jinchurikiLifesteal, Math.floor(triggered.actualDamage * .05));
  assert.equal(narutoRun.atk, 170, "the battle-only attack boost does not mutate run growth");

  const kaneki = initializeBattle([ally("kaneki", { hp: 1000, currentHp: 100, atk: 200, critChance: 1,
    passiveSkillId: "kaneki-one-eye", passiveLevel: 2 }), enemy("foe", { hp: 10, currentHp: 10, def: 0 })]);
  kaneki.round = 1;
  assert.equal(kaneki.characters[0].critRateBonus, .1);
  const critical = executeAttack(kaneki, kaneki.characters[0], kaneki.characters[1], () => .99, { skill: null });
  assert.equal(critical.actualDamage, 10);
  assert.equal(critical.oneEyeHealedAmount, Math.floor(critical.calculatedDamage * .4));
});

test("Kira bomb pays defense before HP and feeds actual loss to a later bomb", () => {
  const state = initializeBattle([ally("hero", { def: 100 }), enemy("kira")]);
  state.round = 4;
  state.bombs = [
    { id: "bomb-1", targetId: "hero", attachedRound: 1, dueRound: 4, accumulatedDamage: 500 },
    { id: "bomb-2", targetId: "hero", attachedRound: 2, dueRound: 4, accumulatedDamage: 100 },
  ];
  const result = detonateDueBombs(state);
  assert.deepEqual(result.map((event) => event.actualDamage), [250, 175]);
  assert.equal(state.characters[0].currentHp, 2575);
});

test("Dina's fourth living summoned giant forces defeat before actions", () => {
  const dina = { ...EVENT_ENEMY_DATA.dina, summonPassive: { ...EVENT_ENEMY_DATA.dina.summonPassive,
    unit: enemy("guard", { name: "普通巨人", hp: 500, currentHp: 500 }) } };
  const state = initializeBattle([ally("hero"), dina]);
  for (const round of [2, 8, 14, 20]) { state.round = round; summonAtRoundStart(state); }
  assert.equal(state.forcedOutcome, "defeat");
  assert.equal(state.characters.filter((unit) => unit.id.startsWith("dina-summon-")).length, 4);
});

test("Gilgamesh heals on third cast and deals true damage on fourth without a skipped round", () => {
  const boss = { ...EVENT_ENEMY_DATA.gilgamesh, skills: [{ ...SKILL_DATA["gilgamesh-enuma-elish"], ...SKILL_DATA["gilgamesh-enuma-elish"].levels[1], level: 1 }] };
  const result = simulateBattle([ally("hero", { hp: 10000, currentHp: 10000, atk: 30, def: 1000, spd: 20 }), boss], () => .9);
  assert.ok(result.events.some((event) => event.type === "gilgamesh-heal" && event.castNumber === 3));
  assert.equal(result.events.some((event) => event.type === "gilgamesh-rest"), false);
  const fourth = result.events.find((event) => event.gilgameshCast === 4);
  assert.ok(fourth?.trueDamage);
  assert.equal(fourth.damage, 5000);
  assert.ok(getDodgeChance({ spd: 100, dodgeRateBonus: .2 }) > getDodgeChance({ spd: 100 }));
});

test("Gilgamesh gains separate 20 point dodge bonuses and the third cast heals without stopping the next turn", () => {
  const gil = EVENT_ENEMY_DATA.gilgamesh;
  const plain = { spd: gil.spd };
  assert.ok(Math.abs(getDodgeChance(gil) - getDodgeChance(plain) - .2) < 1e-10);
  assert.ok(Math.abs(getSkillDodgeChance(gil) - getSkillDodgeChance(plain) - .2) < 1e-10);
  const attacker = ally("hero", { atk: 200, critChance: 0 });
  const normalState = initializeBattle([attacker, gil]);
  const normal = executeAttack(normalState, normalState.characters[0], normalState.characters[1], () => .23, { skill: null });
  assert.equal(normal.dodged, true);
  const skillState = initializeBattle([attacker, gil]);
  const magic = executeAttack(skillState, skillState.characters[0], skillState.characters[1], () => .23,
    { skill: { id: "test-skill", name: "test", type: "active", effectType: "damage", multiplier: 1 } });
  assert.equal(magic.dodged, false);

  const config = SKILL_DATA["gilgamesh-enuma-elish"];
  const skill = { ...config, ...config.levels[1], level: 1 };
  const result = simulateBattle([ally("hero", { hp: 10000, currentHp: 10000, atk: 1, def: 500, spd: 20 }),
    enemy("gilgamesh", { hp: 4200, currentHp: 4100, atk: 180, spd: 100, skills: [skill] })], () => .99);
  const heal = result.events.find((event) => event.type === "gilgamesh-heal");
  assert.ok(heal);
  assert.equal(heal.hpAfter, Math.min(4200, heal.hpBefore + 300));
  assert.equal(heal.healedAmount, heal.hpAfter - heal.hpBefore);
  assert.ok(result.events.some((event) => event.round === heal.round + 1 && event.attackerId === "gilgamesh" && event.gilgameshCast === 4));
});

test("stage-two treasury battle returns to the shared two-character reward flow", () => {
  const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
  const question = getRouteOptions(campaign).find((node) => node.type === "question");
  assert.ok(question);
  chooseRoute(campaign, question.id);
  delete campaign.runCharacterState.eventResults[question.id];
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, question.id, "kings_treasury");
  assert.equal(resolveCampaignEvent(campaign, "treasury_advance").result.pendingBattle, true);
  assert.equal(startCampaignEventBattle(campaign).battle.enemies[0], "gilgamesh");
  const roster = prepareBattle(campaign).roster;
  assert.deepEqual(roster.filter((unit) => unit.team === "enemy").map((unit) => [unit.id, unit.maxHp, unit.atk, unit.def, unit.spd]),
    [["gilgamesh", 3500, 400, 150, 125]], "Gilgamesh does not inherit normal route growth");
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp).next, "reward");
  const offer = getCampaignRewardOffer(campaign);
  assert.equal(offer.choices.length, 3);
  const partnerId = campaign.partyIds.find((id) => id !== campaign.playerId);
  assert.equal(campaign.rewardPhase, "treasure");
  const treasures = getCampaignTreasureOffer(campaign);
  assert.equal(treasures.tier, "royal");
  assert.ok(claimCampaignTreasure(campaign, treasures.choices[0], partnerId));
  assert.equal(campaign.rewardPhase, "stat");
  assert.ok(claimStageTwoStatReward(campaign, campaign.playerId, offer.choices[0]));
  assert.equal(claimStageTwoStatReward(campaign, partnerId, offer.choices[1]).status, "route");
  assert.equal(campaign.runCharacterState.eventResults[question.id].status, "completed");
  assert.equal(campaign.partyStates[partnerId].permanentEffects.filter((effect) => effect.id === treasures.choices[0]).length, 1);
});

test("Gilgamesh first cast weakens only the next round and all four casts repeat", () => {
  const config = SKILL_DATA["gilgamesh-enuma-elish"];
  const skill = { ...config, ...config.levels[1], level: 1 };
  const state = initializeBattle([ally("hero", { hp: 10000, currentHp: 10000, atk: 40, def: 30, spd: 20 }),
    enemy("gilgamesh", { hp: 3000, currentHp: 3000, atk: 180, spd: 100, skills: [skill] })]);
  state.round = 1;
  const first = executeAttack(state, state.characters[1], state.characters[0], () => .99, { skill, gilgameshCast: 1 });
  assert.equal(first.weaknessApplied, true);
  state.round = 2;
  const weakened = executeAttack(state, state.characters[0], state.characters[1], () => .99, { skill: null });
  assert.equal(weakened.damage, Math.max(1, Math.floor(calculateDamage({ atk: 40 }, { def: 40 }) * .5)));
  state.round = 3;
  const normal = executeAttack(state, state.characters[0], state.characters[1], () => .99, { skill: null });
  assert.equal(normal.damage, calculateDamage({ atk: 40 }, { def: 40 }));

  const sequence = simulateBattle([ally("player", { hp: 10000, currentHp: 10000, atk: 1, def: 500, spd: 20 }),
    enemy("gilgamesh", { hp: 3000, currentHp: 3000, atk: 180, spd: 100, skills: [skill] })], () => .99);
  assert.deepEqual(sequence.events.filter((event) => event.attackerId === "gilgamesh" && event.type === "attack")
    .slice(0, 5).map((event) => event.gilgameshCast), [1, 2, 4, 1, 2]);
  assert.ok(sequence.events.some((event) => event.type === "gilgamesh-heal" && event.castNumber === 3));
  assert.equal(sequence.events.some((event) => event.type === "gilgamesh-rest"), false);
});

test("level-four Tatakae shields every living teammate and level-four Free Will adds fifth-cast true damage", () => {
  const tatakae = { ...SKILL_DATA["eren-tatakae"], ...SKILL_DATA["eren-tatakae"].levels[4], level: 4 };
  const state = initializeBattle([ally("eren", { skills: [tatakae] }), ally("partner", { rosterOrder: 1 }),
    enemy("foe", { hp: 10000, currentHp: 10000, rosterOrder: 2 })]);
  state.round = 1;
  const shieldEvent = executeAttack(state, state.characters[0], state.characters[2], () => .99, { skill: tatakae });
  assert.deepEqual(shieldEvent.shieldsGranted.map((entry) => entry.amount), [100, 100]);
  assert.equal(state.characters[1].shieldHp, 100);
  const freeWill = { ...SKILL_DATA["eren-free-will"], ...SKILL_DATA["eren-free-will"].levels[4], level: 4 };
  const freeState = initializeBattle([ally("eren", { skills: [freeWill], hp: 10000, currentHp: 10000 }),
    enemy("foe", { hp: 10000, currentHp: 10000 })]);
  for (let round = 1; round <= 5; round += 1) {
    freeState.round = round;
    const event = executeAttack(freeState, freeState.characters[0], freeState.characters[1], () => .99, { skill: freeWill });
    assert.equal(Boolean(event.extraTrueDamage), round === 5);
    if (round === 5) assert.equal(event.extraTrueDamage.requested, Math.floor((40 + 75) * .8));
  }
});

test("level-four clone has one defense-resolved splash per other living enemy", () => {
  const base = SKILL_DATA["shadow-clone-rush"];
  const clone = { ...base, ...base.levels[4], level: 4, chance: 1 };
  const result = simulateBattle([ally("naruto", { atk: 300, hp: 5000, currentHp: 5000, skills: [clone] }),
    enemy("front", { hp: 180, currentHp: 180, def: 10 }), enemy("back", { hp: 2000, currentHp: 2000, row: "back", def: 50, rosterOrder: 2 })], () => .99);
  const primary = result.events.find((event) => event.type === "attack" && event.skillId === clone.id && !event.splash);
  const splash = result.events.find((event) => event.splash);
  assert.ok(primary && splash);
  assert.equal(splash.targetId, "back");
  assert.equal(splash.damage, calculateDamage({ atk: Math.floor(primary.calculatedDamage * .75) }, { def: 50 }));
});

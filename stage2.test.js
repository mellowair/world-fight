import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { STARTING_CHARACTERS, CAMPAIGN_BATTLES, STAGE_TWO_NORMAL_ENEMY_BASE_STATS } from "./characters.js";
import { initializeBattle, chooseTarget, simulateBattle } from "./battle.js";
import { beginStageTwo, advanceStageTransition, claimStageTwoEliteSkill, claimStageTwoEliteSkip, claimStageTwoStatReward, completeSettlement, createCampaign, finishBattle,
  getCampaignRewardOffer, getRouteEnemyGrowth, getRouteOptions, getStageTransitionChoices, getStageTwoNormalEnemyStats,
  getStageTwoCampfireOptions, prepareBattle, resolveStageTwoCampfire, selectStartingCharacter,
  startCampaign, chooseStartingSkill, beginJourney, chooseRoute } from "./campaign.js";

function stageTwoRun(seed = 21, beforeBegin = null) {
  const campaign = createCampaign(() => 0.21, { seed });
  startCampaign(campaign);
  const hero = STARTING_CHARACTERS.find((entry) => entry.id === campaign.candidateIds[0]);
  selectStartingCharacter(campaign, hero.id, null);
  chooseStartingSkill(campaign, hero.activeSkills[0]);
  beginJourney(campaign);
  campaign.step = 11; // Fixture represents ten completed encounters before the first Boss.
  campaign.status = "settlement";
  campaign.settlementNext = "victory";
  campaign.activeNode = campaign.routeMap.nodes.find((node) => node.type === "demon");
  assert.equal(completeSettlement(campaign), "stage_transition");
  assert.equal(completeSettlement(campaign), null, "Boss settlement cannot be claimed twice");
  while (campaign.stageTransition.phase !== "interlude") {
    const offer = getStageTransitionChoices(campaign);
    let choice = null;
    if (offer.skillIds) choice = offer.skillIds[0] ?? null;
    else if (offer.offer) choice = offer.offer.choices[0];
    else if (offer.candidateIds) choice = offer.candidateIds[0];
    assert.ok(advanceStageTransition(campaign, choice), `${offer.phase} must advance`);
  }
  assert.equal(campaign.partyIds.length, 2);
  const heroState = campaign.partyStates[campaign.playerId];
  const partnerId = campaign.partyIds.find((id) => id !== campaign.playerId);
  const partnerState = campaign.partyStates[partnerId];
  assert.equal(partnerState.learnedActiveSkills.length, 1);
  beforeBegin?.(campaign, heroState, partnerState);
  assert.equal(beginStageTwo(campaign), "route");
  return { campaign, heroState, partnerState, partnerId };
}

test("Boss reward and recruitment follow the ordered, idempotent state machine", () => {
  const { campaign, heroState, partnerState } = stageTwoRun();
  assert.equal(campaign.stageId, 2);
  assert.equal(campaign.stageTransition.phase, "interlude");
  assert.equal(campaign.stageTransition.skillRemaining, 0);
  assert.equal(campaign.stageTransition.statRemaining, 0);
  assert.equal(campaign.stageTransition.partnerStatRemaining, 0);
  assert.equal(campaign.stageTransition.partnerSkillRemaining, 0);
  assert.equal(heroState.passiveLevel, 2, "the first-stage Boss upgrades the hero passive once");
  assert.ok(partnerState.skillHistory.some((entry) => entry.sourceId.startsWith("stage2-partner:")));
  assert.equal(heroState.consumedActions.filter((entry) => entry.includes("stage1-boss:")).length, 1);
  assert.equal(partnerState.skillHistory.filter((entry) => entry.sourceId.startsWith("stage2-partner-upgrade-")).length, 1);
  assert.equal(Object.keys(heroState.statOffers).filter((key) => key.startsWith("stage-transition:hero-stat-")).length, 3);
  assert.equal(Object.keys(partnerState.statOffers).filter((key) => key.startsWith("stage-transition:partner-stat-")).length, 5);
  assert.equal(campaign.step, 12, "global visited-room step continues across stages");
  assert.equal(campaign.stageStep, 1);
  assert.equal(campaign.routeMap.stageId, 2);
  assert.equal(beginStageTwo(campaign), false);
});

test("stage transition heals both members once without changing growth or healing between rooms", () => {
  const { campaign, heroState, partnerState, partnerId } = stageTwoRun(21, (run, hero, partner) => {
    hero.currentHp = 17;
    partner.currentHp = 9;
    run.playerHp = 17;
  });
  assert.equal(heroState.currentHp, heroState.maxHp);
  assert.equal(partnerState.currentHp, partnerState.maxHp);
  assert.equal(campaign.playerHp, heroState.maxHp);
  assert.equal(beginStageTwo(campaign), false);
  heroState.currentHp -= 200;
  partnerState.currentHp -= 100;
  assert.equal(heroState.currentHp, heroState.maxHp - 200);
  assert.equal(campaign.partyStates[partnerId].currentHp, partnerState.maxHp - 100);
});

test("second-stage map is independent and ends in Boros, not Deidara", () => {
  const { campaign } = stageTwoRun();
  assert.equal(campaign.routeMap.startNodeId, "stage2-start");
  assert.equal(campaign.routeMap.bossNodeId, "stage2-pending-end");
  assert.ok(getRouteOptions(campaign).length > 0);
  const first = getRouteOptions(campaign)[0];
  assert.equal(chooseRoute(campaign, "boss-deidara"), null, "first-stage Boss cannot be entered in stage two");
  assert.equal(campaign.status, "route");
  assert.ok(first.id.startsWith("stage2-"));
  const boss = campaign.routeMap.nodes.find((node) => node.id === campaign.routeMap.bossNodeId);
  const parent = campaign.routeMap.nodes.find((node) => node.nextNodeIds.includes(boss.id));
  assert.ok(parent);
  campaign.routeMap.currentNodeId = parent.id;
  boss.status = "pending";
  campaign.status = "route";
  assert.ok(getRouteOptions(campaign).some((node) => node.id === boss.id));
  assert.equal(chooseRoute(campaign, boss.id).type, "battle");
  const prepared = prepareBattle(campaign);
  assert.equal(prepared.battle.type, "boss");
  assert.deepEqual(prepared.roster.filter((entry) => entry.team === "enemy").map((entry) => entry.id), ["boros"]);
  const allies = prepared.roster.filter((entry) => entry.team === "ally");
  assert.equal(finishBattle(campaign, "victory", allies[0].currentHp, [], allies).next, "victory");
  assert.equal(completeSettlement(campaign), "victory");
});

test("second-stage elite nodes draw Toji, Kira, or one shared titan duo encounter with one reward", () => {
  for (const [roll, expected] of [[0, ["toji"]], [.5, ["kira"]], [.999, ["armored-titan", "colossal-titan"]]]) {
    const { campaign } = stageTwoRun(731);
    const elite = campaign.routeMap.nodes.find((node) => node.type === "elite");
    assert.ok(elite);
    const parent = campaign.routeMap.nodes.find((node) => node.nextNodeIds.includes(elite.id));
    campaign.routeMap.currentNodeId = parent.id;
    campaign.status = "route";
    elite.status = "pending";
    campaign.random = () => roll;
    assert.ok(getRouteOptions(campaign).some((node) => node.id === elite.id));
    assert.equal(chooseRoute(campaign, elite.id).type, "battle");
    const prepared = prepareBattle(campaign);
    assert.equal(prepared.battle.type, "elite");
    assert.deepEqual(prepared.roster.filter((entry) => entry.team === "enemy").map((entry) => entry.id), expected);
    if (expected.length === 2) {
      const armored = prepared.roster.find((entry) => entry.id === "armored-titan");
      const colossal = prepared.roster.find((entry) => entry.id === "colossal-titan");
      assert.deepEqual([armored.maxHp, armored.atk, armored.def, armored.spd],
        [2900, 260, 250, 50]);
      assert.deepEqual([colossal.maxHp, colossal.atk, colossal.def, colossal.spd],
        [2800, 0, 110, 1]);
    }
    assert.equal(finishBattle(campaign, "victory", campaign.playerHp).status, "reward");
    assert.equal(finishBattle(campaign, "victory", campaign.playerHp), false, "the shared encounter cannot issue another reward");
  }
});

test("stage-two growth uses the local visited-room step and caps at step nine", () => {
  assert.deepEqual(getRouteEnemyGrowth("normal", 1, 2), { hp: .8, atk: .8, def: .8 });
  assert.deepEqual(getRouteEnemyGrowth("normal", 6, 2), { hp: 1.25, atk: 1.15, def: 1.1 });
  assert.deepEqual(getRouteEnemyGrowth("elite", 14, 2), { hp: 1.25, atk: 1.15, def: 1.1 });
  assert.deepEqual(getRouteEnemyGrowth("normal", 9, 1), { hp: 1.4, atk: 1.2, def: 1.15 });
  assert.deepEqual(getRouteEnemyGrowth("normal", 10, 2), getRouteEnemyGrowth("normal", 9, 2));
});

test("second-stage normal templates use final local-step tiers without changing stage one", () => {
  assert.deepEqual(STAGE_TWO_NORMAL_ENEMY_BASE_STATS.guard, { hp: 2200, atk: 200, def: 110, spd: 50 });
  assert.deepEqual(STAGE_TWO_NORMAL_ENEMY_BASE_STATS.mage, { hp: 1650, atk: 260, def: 85, spd: 60 });
  const { campaign } = stageTwoRun();
  for (const localStep of [1, 6, 13]) {
    campaign.step += 1;
    campaign.stageStep = localStep;
    campaign.combatLaunched = false;
    campaign.status = "combat";
    campaign.currentBattle = { type: "normal", step: campaign.step, enemies: ["guard", "mage"], enemyNames: { guard: "巨人", mage: "小法师" } };
    const roster = prepareBattle(campaign).roster;
    for (const id of ["guard", "mage"]) {
      const base = getStageTwoNormalEnemyStats(id, campaign.stageStep);
      const enemy = roster.find((entry) => entry.id === id);
      assert.deepEqual([enemy.maxHp, enemy.atk, enemy.def, enemy.spd],
        [base.hp, base.atk, base.def, base.spd]);
    }
  }
  const firstStage = createCampaign(() => .5, { seed: 271 });
  startCampaign(firstStage);
  const starter = STARTING_CHARACTERS.find((entry) => entry.id === firstStage.candidateIds[0]);
  selectStartingCharacter(firstStage, starter.id, null);
  firstStage.step = 1;
  firstStage.status = "combat";
  firstStage.currentBattle = { type: "normal", step: 1, enemies: ["guard", "mage"] };
  const oldRoster = prepareBattle(firstStage).roster;
  assert.deepEqual(oldRoster.filter((entry) => entry.team === "enemy").map((entry) => entry.maxHp), [400, 320]);
});

test("two allies both enter battle; front-row selection protects a back-row Kaneki", () => {
  const { campaign, partnerId } = stageTwoRun();
  campaign.status = "combat";
  campaign.currentBattle = { ...CAMPAIGN_BATTLES[0], type: "normal", step: campaign.step, number: 1 };
  const prepared = prepareBattle(campaign);
  const allies = prepared.roster.filter((entry) => entry.team === "ally");
  assert.deepEqual(allies.map((entry) => entry.id), campaign.partyIds);
  const enemy = prepared.roster.find((entry) => entry.team === "enemy");
  const state = initializeBattle(prepared.roster);
  const front = state.characters.find((entry) => entry.team === "ally" && entry.row === "front");
  const back = state.characters.find((entry) => entry.team === "ally" && entry.row === "back");
  assert.ok(front && back);
  assert.equal(chooseTarget(state, state.characters.find((entry) => entry.id === enemy.id), () => 0).id, front.id);
  assert.equal(chooseTarget(state, state.characters.find((entry) => entry.id === enemy.id), () => 0.99).id, front.id);
  front.currentHp = 0; front.alive = false;
  assert.equal(chooseTarget(state, state.characters.find((entry) => entry.id === enemy.id), () => 0).id, back.id);
  const result = simulateBattle(prepared.roster, () => 0.8, prepared.combatOptions);
  assert.ok(result.events.some((event) => event.type === "attack" && event.attackerId === partnerId));
});

test("second-stage normal reward uses two distinct stats and recipients without healing", () => {
  const { campaign, partnerId } = stageTwoRun();
  campaign.status = "combat";
  campaign.currentBattle = { ...CAMPAIGN_BATTLES[0], type: "normal", step: campaign.step, number: 1 };
  prepareBattle(campaign);
  const heroHp = campaign.runCharacterState.currentHp;
  const partnerHp = campaign.partyStates[partnerId].currentHp;
  assert.equal(finishBattle(campaign, "victory", heroHp).status, "reward");
  const offer = getCampaignRewardOffer(campaign);
  assert.equal(new Set(offer.choices).size, 3);
  const [first, second] = offer.choices;
  const beforeHero = campaign.runCharacterState[first];
  const beforePartner = campaign.partyStates[partnerId][second];
  assert.equal(claimStageTwoStatReward(campaign, partnerId, second), false, "partner cannot choose before hero");
  assert.ok(claimStageTwoStatReward(campaign, campaign.playerId, first));
  assert.equal(claimStageTwoStatReward(campaign, campaign.playerId, second), false);
  assert.equal(claimStageTwoStatReward(campaign, partnerId, first), false);
  assert.ok(claimStageTwoStatReward(campaign, partnerId, second));
  assert.equal(campaign.runCharacterState[first], beforeHero + (first === "maxHp" ? 100 : 10));
  assert.equal(campaign.partyStates[partnerId][second], beforePartner + (second === "maxHp" ? 100 : 10));
  assert.equal(campaign.runCharacterState.currentHp, heroHp);
  assert.equal(campaign.partyStates[partnerId].currentHp, partnerHp);
  assert.equal(claimStageTwoStatReward(campaign, partnerId, second), false);
});

test("a real second-stage battle returns to the same map after both rewards", () => {
  const { campaign, partnerId } = stageTwoRun(52);
  const originalMap = campaign.routeMap;
  const next = getRouteOptions(campaign).find((node) => node.type === "battle");
  assert.ok(next, "a normal battle must be available from the stage-two start");
  assert.equal(chooseRoute(campaign, next.id).type, "battle");
  assert.ok(prepareBattle(campaign));
  const finalCharacters = campaign.partyIds.map((id) => ({ id, team: "ally", currentHp: campaign.partyStates[id].currentHp }));
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp, [], finalCharacters).status, "reward");
  const [first, second] = getCampaignRewardOffer(campaign).choices;
  assert.equal(claimStageTwoStatReward(campaign, campaign.playerId, first).phase, "stat");
  const done = claimStageTwoStatReward(campaign, partnerId, second);
  assert.equal(done.status, "route");
  assert.equal(campaign.routeMap, originalMap);
  assert.equal(campaign.activeNode, null);
  assert.equal(next.status, "completed");
  assert.ok(getRouteOptions(campaign).length > 0);
  assert.equal(campaign.step, 13);
});

test("second-stage elite reward keeps a separate extra skill upgrade", () => {
  const { campaign, partnerId } = stageTwoRun(36);
  campaign.status = "combat";
  campaign.currentBattle = { ...CAMPAIGN_BATTLES[0], type: "elite", step: campaign.step, number: 1 };
  prepareBattle(campaign);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp).status, "reward");
  const [first, second] = getCampaignRewardOffer(campaign).choices;
  assert.ok(claimStageTwoStatReward(campaign, campaign.playerId, first));
  assert.equal(claimStageTwoStatReward(campaign, partnerId, second).phase, "bonus");
  const heroSkill = campaign.runCharacterState.learnedActiveSkills[0];
  const heroBefore = campaign.runCharacterState.skillLevels[heroSkill];
  assert.equal(claimStageTwoEliteSkill(campaign, partnerId, campaign.partyStates[partnerId].learnedActiveSkills[0]), false, "partner waits for the hero");
  assert.equal(claimStageTwoEliteSkill(campaign, campaign.playerId, heroSkill).phase, "bonus");
  assert.equal(campaign.runCharacterState.skillLevels[heroSkill], heroBefore + 1);
  const skillId = campaign.partyStates[partnerId].learnedActiveSkills[0];
  const before = campaign.partyStates[partnerId].skillLevels[skillId];
  assert.equal(claimStageTwoEliteSkill(campaign, partnerId, skillId).phase, "complete");
  assert.equal(campaign.partyStates[partnerId].skillLevels[skillId], before + 1);
  assert.equal(claimStageTwoEliteSkill(campaign, partnerId, skillId), false);
});

test("a fully upgraded learned skill teaches the unlearned active skill to that ally only", () => {
  const { campaign, partnerId } = stageTwoRun(38);
  campaign.status = "combat";
  campaign.currentBattle = { ...CAMPAIGN_BATTLES[0], type: "elite", step: campaign.step, number: 1 };
  prepareBattle(campaign);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp).status, "reward");
  const [first, second] = getCampaignRewardOffer(campaign).choices;
  assert.ok(claimStageTwoStatReward(campaign, campaign.playerId, first));
  assert.equal(claimStageTwoStatReward(campaign, partnerId, second).phase, "bonus");
  const heroSkill = campaign.runCharacterState.learnedActiveSkills[0];
  campaign.runCharacterState.skillLevels[heroSkill] = 4;
  const newHeroSkill = campaign.runCharacterState.activeSkillPool.find((id) => id !== heroSkill);
  assert.equal(claimStageTwoEliteSkip(campaign, campaign.playerId), false);
  assert.equal(claimStageTwoEliteSkill(campaign, campaign.playerId, newHeroSkill).phase, "bonus");
  assert.equal(campaign.runCharacterState.skillLevels[newHeroSkill], 1);
  assert.equal(claimStageTwoEliteSkip(campaign, campaign.playerId), false);
  const partnerSkill = campaign.partyStates[partnerId].learnedActiveSkills[0];
  assert.equal(claimStageTwoEliteSkill(campaign, partnerId, partnerSkill).phase, "complete");
  assert.equal(campaign.stageTwoReward, null);
  assert.equal(claimStageTwoEliteSkill(campaign, partnerId, partnerSkill), false);
});

test("stage-two campfire heals both or upgrades each eligible member once", () => {
  const { campaign, partnerId } = stageTwoRun();
  const camp = campaign.routeMap.nodes.find((node) => node.type === "campfire");
  campaign.status = "event"; campaign.activeEventType = "campfire"; campaign.activeNode = camp; camp.status = "in_progress";
  campaign.runCharacterState.currentHp = 1;
  campaign.partyStates[partnerId].currentHp = 1;
  const options = getStageTwoCampfireOptions(campaign);
  assert.equal(options.length, 2);
  assert.ok(resolveStageTwoCampfire(campaign, "rest"));
  assert.equal(campaign.runCharacterState.currentHp, 1 + Math.floor(campaign.runCharacterState.maxHp * .25));
  assert.equal(campaign.partyStates[partnerId].currentHp, 1 + Math.floor(campaign.partyStates[partnerId].maxHp * .25));
  assert.equal(resolveStageTwoCampfire(campaign, "rest"), false);
});

test("stage-two campfire upgrade gives each eligible member exactly one skill level", () => {
  const { campaign, partnerId } = stageTwoRun(88);
  const camp = campaign.routeMap.nodes.find((node) => node.type === "campfire");
  campaign.status = "event"; campaign.activeEventType = "campfire"; campaign.activeNode = camp; camp.status = "in_progress";
  const selections = Object.fromEntries(getStageTwoCampfireOptions(campaign).map(({ characterId, options }) =>
    [characterId, options[1].skills[0]?.skillId]));
  assert.ok(selections[campaign.playerId] && selections[partnerId]);
  const heroBefore = campaign.runCharacterState.skillLevels[selections[campaign.playerId]];
  const partnerBefore = campaign.partyStates[partnerId].skillLevels[selections[partnerId]];
  assert.ok(resolveStageTwoCampfire(campaign, "skill_upgrade", selections));
  assert.equal(campaign.runCharacterState.skillLevels[selections[campaign.playerId]], heroBefore + 1);
  assert.equal(campaign.partyStates[partnerId].skillLevels[selections[partnerId]], partnerBefore + 1);
  assert.equal(resolveStageTwoCampfire(campaign, "skill_upgrade", selections), false);
});

test("Kaneki death asset is a distinct transparent frame and stays in death animation mapping", () => {
  const kaneki = STARTING_CHARACTERS.find((entry) => entry.id === "kaneki");
  const path = kaneki.animations.death.frames.down;
  assert.equal(path, "assets/kaneki/death.png");
  assert.ok(existsSync(new URL(`./${path}`, import.meta.url)));
  const png = readFileSync(new URL(`./${path}`, import.meta.url));
  assert.equal(png[25], 6);
  assert.equal(kaneki.animations.death.loop, false);
});

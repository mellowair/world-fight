import test from "node:test";
import assert from "node:assert/strict";
import { STARTING_CHARACTERS } from "./characters.js";
import { beginJourney, chooseRoute, chooseStartingSkill, claimCampaignReward, completeLocation, completeSettlement, createCampaign, finishBattle, getCampaignRewardOffer, getRouteOptions, prepareBattle, resolveCampaignEvent, resolveRouteEvent, selectStartingCharacter, startCampaign, startCampaignEventBattle } from "./campaign.js";
import { upgradeActiveSkill } from "./progression.js";

function queued(values, fallback = 0) {
  let index = 0;
  return () => values[index++] ?? fallback;
}

function begin(campaign) {
  assert.equal(startCampaign(campaign), true);
  assert.ok(selectStartingCharacter(campaign, "naruto"));
  assert.equal(beginJourney(campaign), "route");
}

function winCurrentBattle(campaign) {
  const prepared = prepareBattle(campaign);
  assert.ok(prepared);
  assert.equal(prepareBattle(campaign), null, "a location cannot launch the same battle twice");
  const transition = finishBattle(campaign, "victory", Math.max(1, campaign.playerHp - 20));
  if (transition.status === "reward") {
    const offer = getCampaignRewardOffer(campaign);
    const stat = claimCampaignReward(campaign, offer.statChoices[0]);
    if (stat.phase === "bonus") claimCampaignReward(campaign, offer.extraChoices[0]);
    return campaign.status;
  }
  return completeSettlement(campaign);
}

test("opening moves through character choice and starts step one", () => {
  const campaign = createCampaign(() => 0.1);
  assert.equal(startCampaign(campaign), true);
  assert.equal(campaign.status, "character-select");
  assert.equal(selectStartingCharacter(campaign, "not-a-hero"), false);
  selectStartingCharacter(campaign, "naruto");
  assert.equal(beginJourney(campaign), "route");
  assert.equal(campaign.step, 1);
});

test("deferred opening skill choice blocks the route until one skill is learned exactly once", () => {
  const campaign = createCampaign(() => 0.1);
  startCampaign(campaign);
  selectStartingCharacter(campaign, "naruto", null);
  assert.equal(beginJourney(campaign), false);
  assert.deepEqual(campaign.runCharacterState.learnedActiveSkills, []);
  assert.equal(chooseStartingSkill(campaign, "rasengan").id, "rasengan");
  assert.deepEqual(campaign.runCharacterState.learnedActiveSkills, ["rasengan"]);
  assert.equal(chooseStartingSkill(campaign, "shadow-clone-rush"), false);
  assert.equal(beginJourney(campaign), "route");
});

test("growth state builds the next battle roster and syncs HP before a one-time reward", () => {
  const campaign = createCampaign(() => 0.1);
  begin(campaign);
  const run = campaign.runCharacterState;
  run.maxHp = 1300;
  run.currentHp = 800;
  run.atk = 173;
  run.def = 77;
  run.spd = 91;
  upgradeActiveSkill(run, "shadow-clone-rush", "setup-upgrade");
  const base = STARTING_CHARACTERS.find((entry) => entry.id === "naruto");
  const battleNode = getRouteOptions(campaign).find((node) => node.type === "battle");
  chooseRoute(campaign, battleNode.id);
  const { roster } = prepareBattle(campaign);
  const hero = roster.find((entry) => entry.team === "ally");
  assert.deepEqual([hero.maxHp, hero.currentHp, hero.atk, hero.def, hero.spd], [1300, 800, 173, 77, 91]);
  assert.equal(hero.skills[0].level, 2);
  assert.equal(hero.skills[0].multiplier, 1.6);
  assert.equal(base.atk, 150, "campaign upgrades do not mutate shared base character data");

  assert.equal(finishBattle(campaign, "victory", 640).status, "reward");
  assert.equal(campaign.runCharacterState.currentHp, 640);
  assert.equal(campaign.activeNode.status, "in_progress", "node stays open until its reward is applied");
  const offer = getCampaignRewardOffer(campaign);
  const claimed = claimCampaignReward(campaign, offer.statChoices[0]);
  const upgradedAtk = campaign.runCharacterState.atk;
  assert.equal(claimed.phase, "complete");
  assert.equal(campaign.status, "route");
  assert.equal(campaign.step, 2);
  assert.equal(claimCampaignReward(campaign, offer.statChoices[0]), false);

  const nextNode = getRouteOptions(campaign).find((node) => node.type === "battle");
  chooseRoute(campaign, nextNode.id);
  const nextHero = prepareBattle(campaign).roster.find((entry) => entry.team === "ally");
  assert.equal(nextHero.currentHp, 640);
  assert.equal(nextHero.atk, upgradedAtk);
  assert.equal(nextHero.skills[0].level, 2);
});

test("elite reward is a two-stage choice and cannot complete before both stages", () => {
  const campaign = createCampaign(() => 0);
  begin(campaign);
  for (let step = 1; step <= 2; step += 1) {
    chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
    winCurrentBattle(campaign);
  }
  assert.equal(campaign.step, 3);
  const elite = chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
  assert.equal(elite.battle.type, "elite");
  prepareBattle(campaign);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp - 50).status, "reward");
  const offer = getCampaignRewardOffer(campaign);
  const stat = claimCampaignReward(campaign, offer.statChoices[0]);
  assert.equal(stat.phase, "bonus");
  assert.equal(campaign.step, 3);
  assert.equal(campaign.activeNode.status, "in_progress");
  assert.equal(claimCampaignReward(campaign, offer.statChoices[0]), false);
  assert.equal(claimCampaignReward(campaign, offer.extraChoices[0]).phase, "complete");
  assert.equal(campaign.step, 4);
  assert.equal(claimCampaignReward(campaign, offer.extraChoices[0]), false);
});

test("steps one and two exclude campfires and elite fights", () => {
  const campaign = createCampaign(() => 0.1);
  begin(campaign);
  for (let step = 1; step <= 2; step += 1) {
    assert.ok(getRouteOptions(campaign).every((node) => ["battle", "question"].includes(node.type)));
    const battle = getRouteOptions(campaign).find((node) => node.type === "battle");
    assert.equal(chooseRoute(campaign, battle.id).battle.type, "normal");
    assert.equal(winCurrentBattle(campaign), "route");
    assert.equal(campaign.step, step + 1);
  }
});

test("weighted route generation samples battle, question, and campfire at steps three to eight", () => {
  const random = queued([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5]);
  const campaign = createCampaign(random);
  begin(campaign);
  chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
  winCurrentBattle(campaign);
  chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
  winCurrentBattle(campaign);
  assert.deepEqual(getRouteOptions(campaign).map((node) => node.type), ["battle", "question"]);

  const campRandom = queued([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.85, 0.95]);
  const second = createCampaign(campRandom);
  begin(second);
  chooseRoute(second, getRouteOptions(second).find((node) => node.type === "battle").id);
  winCurrentBattle(second);
  chooseRoute(second, getRouteOptions(second).find((node) => node.type === "battle").id);
  winCurrentBattle(second);
  assert.deepEqual(getRouteOptions(second).map((node) => node.type), ["campfire", "campfire"]);
});

test("a question event completes once and advances directly to a fresh route", () => {
  const campaign = createCampaign(queued([0.9, 0.9, 0.01]));
  begin(campaign);
  const oldNode = getRouteOptions(campaign).find((node) => node.type === "question");
  assert.equal(chooseRoute(campaign, oldNode.id).type, "event");
  const once = resolveRouteEvent(campaign);
  assert.ok(once);
  assert.equal(resolveRouteEvent(campaign), null);
  assert.equal(completeLocation(campaign), "route");
  assert.equal(campaign.step, 2);
  assert.notEqual(getRouteOptions(campaign)[0].id, oldNode.id);
  assert.equal(chooseRoute(campaign, oldNode.id), null);
});

test("two noncombat locations force two valid battle choices; an encounter resets the streak", () => {
  const campaign = createCampaign(queued([0.9, 0.9, 0.01, 0.9, 0.9, 0.01]));
  begin(campaign);
  for (let i = 0; i < 2; i += 1) {
    const node = getRouteOptions(campaign).find((entry) => entry.type === "question");
    chooseRoute(campaign, node.id);
    resolveRouteEvent(campaign);
    completeLocation(campaign);
  }
  assert.equal(campaign.consecutiveWithoutBattle, 2);
  assert.deepEqual(getRouteOptions(campaign).map((node) => node.type), ["battle", "battle"]);

  const encounter = createCampaign(queued([0.9, 0.9, 0.41]));
  begin(encounter);
  const question = getRouteOptions(encounter).find((node) => node.type === "question");
  assert.equal(chooseRoute(encounter, question.id).type, "event");
  assert.equal(startCampaignEventBattle(encounter).type, "battle");
  assert.equal(encounter.consecutiveWithoutBattle, 0);
});

test("elite chance is limited to steps three through eight", () => {
  const campaign = createCampaign(() => 0);
  begin(campaign);
  for (let step = 1; step <= 3; step += 1) {
    const battleNode = getRouteOptions(campaign).find((node) => node.type === "battle");
    const selected = chooseRoute(campaign, battleNode.id);
    assert.equal(selected.battle.type, step === 3 ? "elite" : "normal");
    winCurrentBattle(campaign);
  }
});

test("step nine excludes campfire and elite; step ten presents the boss sign before battle", () => {
  const campaign = createCampaign(() => 0);
  begin(campaign);
  for (let step = 1; step <= 8; step += 1) {
    chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
    winCurrentBattle(campaign);
  }
  assert.equal(campaign.step, 9);
  assert.ok(getRouteOptions(campaign).every((node) => ["battle", "question"].includes(node.type)));
  const battle = getRouteOptions(campaign).find((node) => node.type === "battle");
  assert.equal(chooseRoute(campaign, battle.id).battle.type, "normal");
  assert.equal(winCurrentBattle(campaign), "route");
  assert.equal(campaign.step, 10);
  assert.deepEqual(getRouteOptions(campaign).map((node) => node.type), ["demon"]);
  const bossNode = getRouteOptions(campaign)[0];
  assert.equal(chooseRoute(campaign, bossNode.id).battle.type, "boss");
  assert.equal(campaign.activeNode.type, "demon");
  assert.equal(chooseRoute(campaign, bossNode.id), null, "the boss sign cannot be entered twice");
  const preparedBoss = prepareBattle(campaign);
  assert.equal(preparedBoss.battle.type, "boss");
  assert.equal(preparedBoss.battle.title, "迪达拉");
  const deidara = preparedBoss.roster.find((character) => character.team === "enemy");
  assert.equal(deidara.name, "迪达拉");
  assert.equal(deidara.role, "爆破艺术家");
  assert.equal(deidara.asset, "assets/guard.svg", "no dedicated Deidara pixel art is present; retain the existing boss stand-in art");
  assert.equal(deidara.c0DamagePerRound, 100);
  assert.equal(deidara.skill.id, "c4-garuda");
  assert.equal(deidara.skill.chance, 0.5);
  assert.equal(deidara.skill.multiplier, 1.2);
  assert.equal(deidara.skill.defenseReduction, 20);
  finishBattle(campaign, "victory", campaign.playerHp - 10);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp - 10), false, "the final battle callback cannot settle twice");
  assert.equal(completeSettlement(campaign), "victory");
});

test("defeat ends the run and route actions cannot advance it", () => {
  const campaign = createCampaign(() => 0.1);
  begin(campaign);
  const battle = getRouteOptions(campaign).find((node) => node.type === "battle");
  chooseRoute(campaign, battle.id);
  prepareBattle(campaign);
  finishBattle(campaign, "defeat", 0);
  assert.equal(completeSettlement(campaign), "defeat");
  assert.equal(chooseRoute(campaign, battle.id), null);
});

test("adventure combat modifiers enter battle rosters and expire after real battles", () => {
  const campaign = createCampaign(() => 0.7);
  begin(campaign);
  const question = getRouteOptions(campaign).find((node) => node.type === "question");
  assert.equal(chooseRoute(campaign, question.id).event.eventId, "big_rock");
  assert.ok(resolveCampaignEvent(campaign));
  assert.equal(completeLocation(campaign), "route");

  for (let battleIndex = 0; battleIndex < 3; battleIndex += 1) {
    campaign.routeOptions = [{ id: `forced-battle-${battleIndex}`, step: campaign.step, type: "battle", status: "pending" }];
    chooseRoute(campaign, campaign.routeOptions[0].id);
    const prepared = prepareBattle(campaign);
    assert.equal(prepared.roster[0].spd, 60);
    finishBattle(campaign, "victory", campaign.playerHp);
    const offer = getCampaignRewardOffer(campaign);
    claimCampaignReward(campaign, offer.statChoices[0]);
  }
  assert.equal(campaign.runCharacterState.temporaryEffects.length, 0);

  const coffee = createCampaign(() => 0.9);
  begin(coffee);
  const coffeeQuestion = getRouteOptions(coffee).find((node) => node.type === "question");
  assert.equal(chooseRoute(coffee, coffeeQuestion.id).event.eventId, "coffee_shop");
  assert.ok(resolveCampaignEvent(coffee));
  completeLocation(coffee);
  coffee.routeOptions = [{ id: "coffee-battle", step: coffee.step, type: "battle", status: "pending" }];
  chooseRoute(coffee, "coffee-battle");
  assert.equal(prepareBattle(coffee).roster[0].def, 130);
  finishBattle(coffee, "defeat", 0);
  assert.equal(coffee.runCharacterState.temporaryEffects.length, 0);
  assert.equal(coffee.runCharacterState.def, 60);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { STARTING_CHARACTERS } from "./characters.js";
import { executeAttack, getCritChance, getDodgeChance, initializeBattle, simulateBattle } from "./battle.js";
import { chooseRoute, claimCampaignTreasure, finishBattle, getCampaignTreasureOffer, getRouteOptions, prepareBattle, resolveCampaignEvent, resolveStageTwoCampfire, startCampaignEventBattle } from "./campaign.js";
import { claimTreasure, createAdventureEventResult, createRunCharacterState, getCampfireOptions, getTreasureCombatModifiers, resolveAdventureEvent, resolveCampfire } from "./progression.js";
import { TREASURE_DATA } from "./skills.js";
import { createStageTwoDirectBattleCampaign, createStageTwoTestCampaign } from "./dev/stage2-config.js";

const hero = STARTING_CHARACTERS.find((entry) => entry.id === "naruto");
const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");

function offerFor(treasureId, recipient = hero) {
  const owner = createRunCharacterState(hero);
  const member = recipient === hero ? owner : createRunCharacterState(recipient);
  const sourceId = `treasure-${treasureId}`;
  createAdventureEventResult(owner, sourceId, "kings_treasury");
  const record = owner.eventResults[sourceId];
  record.status = "awaiting_treasure";
  const alternative = TREASURE_DATA[treasureId].tier === "small"
    ? treasureId === "magic_conch" ? "odm_gear" : "magic_conch"
    : treasureId === "angel_breath" ? "stone_mask" : "angel_breath";
  record.data.treasureOffer = { tier: TREASURE_DATA[treasureId].tier, choices: [treasureId, alternative], claimed: false };
  return { owner, member, sourceId };
}

test("all six treasures have stable tiers and their supplied local images", () => {
  assert.deepEqual(Object.values(TREASURE_DATA).filter((item) => item.tier === "small").map((item) => item.id),
    ["magic_conch", "sukuna_finger", "odm_gear"]);
  assert.deepEqual(Object.values(TREASURE_DATA).filter((item) => item.tier === "royal").map((item) => item.id),
    ["angel_breath", "stone_mask", "nichirin_blade"]);
  assert.ok(Object.values(TREASURE_DATA).every((item) => item.name && item.description && item.image && existsSync(item.image)));
});

test("small treasure modifies only its recipient and a second claim is rejected", () => {
  const { owner, member, sourceId } = offerFor("magic_conch", eren);
  assert.ok(claimTreasure(owner, sourceId, "magic_conch", member, member.characterId));
  assert.equal(getTreasureCombatModifiers(member).damageReduction, .05);
  assert.equal(getTreasureCombatModifiers(owner).damageReduction, 0);
  assert.equal(claimTreasure(owner, sourceId, "magic_conch", member, member.characterId), false);
  assert.equal(member.permanentEffects.length, 1);
  const battle = initializeBattle([
    { id: "foe", team: "enemy", row: "front", hp: 1000, atk: 100, def: 0, spd: 10, critChance: 0 },
    { id: "member", team: "ally", row: "front", hp: 1000, atk: 10, def: 0, spd: 10, critChance: 0, damageReductionBonus: .05 },
  ]);
  assert.equal(executeAttack(battle, battle.characters[0], battle.characters[1], () => .99).damage, 95);
});

test("Sukuna finger clamps HP, while ODM gear raises actual dodge and crit chances", () => {
  const finger = offerFor("sukuna_finger");
  finger.member.maxHp = 1600; finger.member.currentHp = 1500;
  const oldAtk = finger.member.atk;
  assert.ok(claimTreasure(finger.owner, finger.sourceId, "sukuna_finger", finger.member, finger.member.characterId));
  assert.deepEqual([finger.member.maxHp, finger.member.currentHp, finger.member.atk], [1400, 1400, oldAtk + 50]);
  const gear = offerFor("odm_gear");
  const oldCrit = gear.member.critRate;
  assert.ok(claimTreasure(gear.owner, gear.sourceId, "odm_gear", gear.member, gear.member.characterId));
  assert.equal(gear.member.critRate, oldCrit + .05);
  assert.equal(getTreasureCombatModifiers(gear.member).dodgeRateBonus, .05);
  assert.ok(Math.abs(getDodgeChance({ spd: 50, dodgeRateBonus: .05 }) - getDodgeChance({ spd: 50 }) - .05) < 1e-12);
  assert.equal(getCritChance({ critChance: gear.member.critRate }), oldCrit + .05);
});

test("stone mask gives battle lifesteal but blocks only its holder's campfire healing", () => {
  const mask = offerFor("stone_mask", eren);
  mask.member.currentHp = 500;
  assert.ok(claimTreasure(mask.owner, mask.sourceId, "stone_mask", mask.member, mask.member.characterId));
  assert.equal(getTreasureCombatModifiers(mask.member).lifesteal, .25);
  assert.equal(getCampfireOptions(mask.member)[0].healAmount, 0);
  assert.equal(resolveCampfire(mask.member, "camp-a", "rest").restored, 0);
  assert.equal(mask.member.currentHp, 500);
  mask.owner.currentHp = 500;
  assert.ok(resolveCampfire(mask.owner, "camp-a", "rest").restored > 0);
  const battle = initializeBattle([
    { id: "holder", team: "ally", row: "front", hp: 1000, currentHp: 500, atk: 100, def: 0, spd: 100, critChance: 0, lifesteal: .25 },
    { id: "foe", team: "enemy", row: "front", hp: 1000, atk: 10, def: 0, spd: 10, critChance: 0 },
  ]);
  const event = executeAttack(battle, battle.characters[0], battle.characters[1], () => .99);
  assert.equal(event.actualDamage, 100);
  assert.equal(event.treasureLifesteal, 25);
  assert.equal(battle.characters[0].currentHp, 525);
});

test("formal battle roster carries treasure modifiers, and stage-two campfire still heals the unmasked partner", () => {
  const campaign = createStageTwoDirectBattleCampaign({ heroId: "naruto", partnerId: "eren", encounterId: "toji", localStep: 6, seed: 83 });
  campaign.partyStates.naruto.permanentEffects.push({ id: "magic_conch" }, { id: "odm_gear" }, { id: "nichirin_blade" });
  campaign.partyStates.eren.permanentEffects.push({ id: "stone_mask" });
  const roster = prepareBattle(campaign).roster;
  const main = roster.find((unit) => unit.id === "naruto");
  const partner = roster.find((unit) => unit.id === "eren");
  assert.deepEqual([main.damageReductionBonus, main.dodgeRateBonus, main.normalAttackCurrentHpRatio], [.05, .05, .05]);
  assert.equal(partner.lifesteal, .25);
  const rest = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
  rest.partyStates.naruto.currentHp = 500;
  rest.partyStates.eren.currentHp = 500;
  rest.partyStates.eren.permanentEffects.push({ id: "stone_mask" });
  rest.status = "event";
  rest.activeEventType = "campfire";
  rest.activeNode = { id: "camp-test", resolution: "campfire" };
  rest.eventResolved = false;
  const resolved = resolveStageTwoCampfire(rest, "rest");
  assert.ok(resolved);
  assert.ok(rest.partyStates.naruto.currentHp > 500);
  assert.equal(rest.partyStates.eren.currentHp, 500);
});

test("Nichirin Blade creates a separate DEF-free hit based on pre-attack HP, never on dodge or skills", () => {
  const actor = { id: "holder", team: "ally", row: "front", hp: 5000, atk: 300, def: 0, spd: 100, critChance: 0, normalAttackCurrentHpRatio: .05 };
  const target = { id: "foe", team: "enemy", row: "front", hp: 2000, atk: 1, def: 0, spd: 1, critChance: 0 };
  const result = simulateBattle([actor, target], () => .99);
  const first = result.events.find((event) => event.type === "attack" && event.attackerId === "holder");
  const bonus = result.events.find((event) => event.type === "treasure-damage");
  assert.equal(first.damage, 300);
  assert.equal(first.hpBefore, 2000);
  assert.deepEqual([bonus.basisHp, bonus.requested, bonus.damage, bonus.hpBefore, bonus.hpAfter], [2000, 100, 100, 1700, 1600]);
  assert.ok(result.events.filter((event) => event.type === "treasure-damage").every((event) => event.basisHp > event.hpBefore));
  let rolls = 0;
  const dodge = simulateBattle([actor, target], () => rolls++ < 2 ? 0 : .99);
  const firstAttackIndex = dodge.events.findIndex((event) => event.type === "attack" && event.attackerId === "holder");
  assert.equal(dodge.events[firstAttackIndex].dodged, true);
  assert.notEqual(dodge.events[firstAttackIndex + 1]?.type, "treasure-damage");
  const skill = { id: "test-active", name: "技能", chance: 1, multiplier: 1.3 };
  const active = simulateBattle([{ ...actor, skills: [skill], skill }, target], () => .99);
  assert.equal(active.events.filter((event) => event.type === "treasure-damage").length, 0);
});

test("angel breath immediately fills HP and victory revives before its 10% end heal exactly once", () => {
  const angel = offerFor("angel_breath");
  angel.member.currentHp = 200;
  assert.ok(claimTreasure(angel.owner, angel.sourceId, "angel_breath", angel.member, angel.member.characterId));
  assert.equal(angel.member.currentHp, angel.member.maxHp);
  const campaign = createStageTwoDirectBattleCampaign({ heroId: "naruto", partnerId: "eren", encounterId: "toji", localStep: 6, seed: 83 });
  campaign.partyStates.naruto.permanentEffects.push({ id: "angel_breath", sourceId: "event:old" });
  prepareBattle(campaign);
  const maxHp = campaign.partyStates.naruto.maxHp;
  const result = finishBattle(campaign, "victory", 0, [], [
    { id: "naruto", team: "ally", currentHp: 0 }, { id: "eren", team: "ally", currentHp: 400 },
  ]);
  assert.equal(result.next, "victory");
  assert.equal(campaign.partyStates.naruto.currentHp, Math.max(1, Math.floor(maxHp * .05)) + Math.floor(maxHp * .10));
  assert.equal(campaign.partyStates.eren.currentHp, 400);
  assert.deepEqual(campaign.lastBattleRecovery.map((entry) => entry.kind), ["revive", "angel_breath"]);
  assert.equal(finishBattle(campaign, "victory", 0, [], []), false);
});

test("team defeat grants no revival; event battle reward tier follows its original option", () => {
  const defeated = createStageTwoDirectBattleCampaign({ heroId: "naruto", partnerId: "eren", encounterId: "toji", localStep: 6, seed: 83 });
  prepareBattle(defeated);
  assert.equal(finishBattle(defeated, "defeat", 0, [], [
    { id: "naruto", team: "ally", currentHp: 0 }, { id: "eren", team: "ally", currentHp: 0 },
  ]).next, "defeat");
  assert.deepEqual(defeated.lastBattleRecovery, []);
  const lostTreasury = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
  const lostNode = getRouteOptions(lostTreasury).find((node) => node.type === "question");
  chooseRoute(lostTreasury, lostNode.id);
  delete lostTreasury.runCharacterState.eventResults[lostNode.id];
  lostTreasury.pendingEvent = createAdventureEventResult(lostTreasury.runCharacterState, lostNode.id, "kings_treasury");
  assert.equal(resolveCampaignEvent(lostTreasury, "treasury_advance").result.pendingBattle, true);
  assert.ok(startCampaignEventBattle(lostTreasury));
  prepareBattle(lostTreasury);
  assert.equal(finishBattle(lostTreasury, "defeat", 0, [], [
    { id: "naruto", team: "ally", currentHp: 0 }, { id: "eren", team: "ally", currentHp: 0 },
  ]).next, "defeat");
  assert.equal(getCampaignTreasureOffer(lostTreasury), null);
  assert.equal(lostTreasury.runCharacterState.eventResults[lostNode.id].status, "failed");
  for (const [choice, randomValue, tier] of [["treasury_steal", .95, "small"], ["treasury_advance", .95, "royal"]]) {
    const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
    const question = getRouteOptions(campaign).find((node) => node.type === "question");
    chooseRoute(campaign, question.id);
    delete campaign.runCharacterState.eventResults[question.id];
    campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, question.id, "kings_treasury");
    campaign.random = () => randomValue;
    assert.equal(resolveCampaignEvent(campaign, choice).result.pendingBattle, true);
    assert.ok(startCampaignEventBattle(campaign));
    prepareBattle(campaign);
    assert.equal(finishBattle(campaign, "victory", campaign.playerHp).next, "reward");
    const offer = getCampaignTreasureOffer(campaign);
    assert.equal(offer.tier, tier);
    assert.equal(new Set(offer.choices).size, 2);
    assert.ok(claimCampaignTreasure(campaign, offer.choices[0], campaign.partyIds[1]));
    assert.equal(claimCampaignTreasure(campaign, offer.choices[1], campaign.partyIds[0]), false);
  }
});

test("direct 80% theft keeps the cached offer on the event node until one recipient claims", () => {
  const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
  const question = getRouteOptions(campaign).find((node) => node.type === "question");
  chooseRoute(campaign, question.id);
  delete campaign.runCharacterState.eventResults[question.id];
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, question.id, "kings_treasury");
  campaign.random = () => .1;
  assert.equal(resolveCampaignEvent(campaign, "treasury_steal").result.treasureOffer, "small");
  assert.equal(campaign.status, "event");
  assert.equal(campaign.eventResolved, false);
  const offer = getCampaignTreasureOffer(campaign);
  assert.equal(new Set(offer.choices).size, 2);
  assert.deepEqual(getCampaignTreasureOffer(campaign), offer);
  assert.ok(claimCampaignTreasure(campaign, offer.choices[0], campaign.partyIds[0]));
  assert.equal(campaign.eventResolved, true);
  assert.equal(getCampaignTreasureOffer(campaign), null);
  assert.equal(claimCampaignTreasure(campaign, offer.choices[1], campaign.partyIds[1]), false);
});

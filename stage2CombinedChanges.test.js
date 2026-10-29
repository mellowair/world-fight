import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStageTwoTestCampaign, createStageTwoDirectBattleCampaign } from "./dev/stage2-config.js";
import { claimStageTwoStatReward, claimStageTwoGiantRecipient, finishBattle, getCampaignRewardOffer,
  getRouteEnemyGrowth, prepareBattle, resolveCampaignEvent, startCampaignEventBattle } from "./campaign.js";
import { createAdventureEventResult, getAvailableAdventureEventIds, getUnlearnedActiveSkills,
  learnActiveSkill } from "./progression.js";

function stageTwoEvent(eventId, extra = {}) {
  const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 81 });
  campaign.status = "event";
  campaign.activeEventType = "adventure";
  campaign.activeNode = { id: `test:${eventId}`, type: "question", status: "in_progress" };
  Object.assign(campaign.runCharacterState, extra);
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, campaign.activeNode.id,
    eventId, () => 0, campaign.partyIds.map((id) => campaign.partyStates[id]));
  return campaign;
}

test("second-stage Anteiku and rock choices reach both members once, then expire after one battle", () => {
  for (const [eventId, choice, stat, amount] of [["coffee_shop", "coffee_leave", "def", 30], ["big_rock", "rock_move", "spd", -20]]) {
    const campaign = stageTwoEvent(eventId);
    assert.ok(resolveCampaignEvent(campaign, choice));
    assert.equal(resolveCampaignEvent(campaign, choice), false);
    for (const id of campaign.partyIds) {
      const effects = campaign.partyStates[id].temporaryEffects.filter((effect) => effect.sourceId === campaign.activeNode.id);
      assert.equal(effects.length, 1);
      assert.equal(effects[0].stat, stat);
      assert.equal(effects[0].amount, amount);
    }
  }
});

test("fall and sea keep main-only HP costs while granting stage-two positive outcomes to both", () => {
  const fall = stageTwoEvent("fall_rock", { fallRockCount: 1 });
  // Regenerate the cached record at stage two after establishing its prior stage.
  delete fall.runCharacterState.eventResults[fall.activeNode.id];
  fall.pendingEvent = createAdventureEventResult(fall.runCharacterState, fall.activeNode.id, "fall_rock");
  const partnerHp = fall.partyStates.eren.maxHp;
  const partnerAtk = fall.partyStates.eren.atk;
  assert.ok(resolveCampaignEvent(fall));
  assert.equal(fall.partyStates.eren.maxHp, partnerHp);
  assert.ok(fall.partyStates.eren.atk > partnerAtk);
  assert.equal(resolveCampaignEvent(fall), false);

  const sea = stageTwoEvent("sea_beyond");
  const seaPartnerHp = sea.partyStates.eren.maxHp;
  const seaPartnerAtk = sea.partyStates.eren.atk;
  assert.ok(resolveCampaignEvent(sea, "sea_begin"));
  assert.ok(resolveCampaignEvent(sea, "sea_sacrifice"));
  assert.ok(resolveCampaignEvent(sea, "sea_finish"));
  assert.equal(sea.partyStates.eren.maxHp, seaPartnerHp);
  assert.equal(sea.partyStates.eren.atk, seaPartnerAtk + 30);
  assert.equal(resolveCampaignEvent(sea, "sea_finish"), false);
});

test("stage-two scroll offers the recipient's own unlearned skill and cannot double-claim", () => {
  const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 82 });
  assert.ok(learnActiveSkill(campaign.runCharacterState, "rasengan", "test:full"));
  assert.equal(getUnlearnedActiveSkills(campaign.runCharacterState).length, 0);
  assert.ok(getAvailableAdventureEventIds(campaign.runCharacterState, 12,
    campaign.partyIds.map((id) => campaign.partyStates[id])).includes("scroll"));
  campaign.status = "event";
  campaign.activeEventType = "adventure";
  campaign.activeNode = { id: "test:scroll", type: "question", status: "in_progress" };
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, campaign.activeNode.id,
    "scroll", () => 0, campaign.partyIds.map((id) => campaign.partyStates[id]));
  assert.equal(resolveCampaignEvent(campaign, "eren-free-will"), false, "recipient must be chosen first");
  assert.ok(resolveCampaignEvent(campaign, "scroll_recipient|eren"));
  assert.deepEqual(campaign.pendingEvent.data.skillChoices, ["eren-tatakae"]);
  assert.ok(resolveCampaignEvent(campaign, "eren-tatakae"));
  assert.ok(campaign.partyStates.eren.learnedActiveSkills.includes("eren-tatakae"));
  assert.equal(resolveCampaignEvent(campaign, "eren-tatakae"), false);
});

test("stage-two giant spinal fluid is deferred until one selected recipient claims it", () => {
  const campaign = stageTwoEvent("giant_encirclement");
  assert.ok(resolveCampaignEvent(campaign, "giant_heart"));
  assert.ok(startCampaignEventBattle(campaign));
  prepareBattle(campaign);
  const heroBefore = [campaign.runCharacterState.atk, campaign.runCharacterState.maxHp];
  const partnerBefore = [campaign.partyStates.eren.atk, campaign.partyStates.eren.maxHp, campaign.partyStates.eren.currentHp];
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp).status, "reward");
  assert.equal(campaign.rewardPhase, "giant_recipient");
  assert.deepEqual([campaign.runCharacterState.atk, campaign.runCharacterState.maxHp], heroBefore);
  assert.ok(claimStageTwoGiantRecipient(campaign, "eren"));
  assert.equal(claimStageTwoGiantRecipient(campaign, "naruto"), false);
  assert.deepEqual([campaign.runCharacterState.atk, campaign.runCharacterState.maxHp], heroBefore);
  assert.deepEqual([campaign.partyStates.eren.atk, campaign.partyStates.eren.maxHp, campaign.partyStates.eren.currentHp],
    [partnerBefore[0] + 30, partnerBefore[1] + 300, partnerBefore[2]]);
  const offer = getCampaignRewardOffer(campaign);
  assert.equal(offer.choices.length, 3);
  assert.ok(claimStageTwoStatReward(campaign, "naruto", offer.choices[0]));
  assert.equal(claimStageTwoStatReward(campaign, "eren", offer.choices[1]).status, "route");
});

test("local direct battle uses the formal elite/Boss roster and growth once", () => {
  for (const [encounterId, ids] of [["toji", ["toji"]], ["kira", ["kira"]],
    ["titan-duo", ["armored-titan", "colossal-titan"]], ["boros", ["boros"]]]) {
    const campaign = createStageTwoDirectBattleCampaign({ heroId: "naruto", partnerId: "eren",
      encounterId, localStep: 6, seed: 83 });
    assert.equal(campaign.status, "combat");
    assert.equal(campaign.devBattleOnly, true);
    const prepared = prepareBattle(campaign);
    assert.deepEqual(prepared.roster.filter((unit) => unit.team === "enemy").map((unit) => unit.id), ids);
    if (encounterId === "toji") {
      assert.equal(prepared.roster.find((unit) => unit.id === "toji").maxHp, 3500);
    }
    if (encounterId === "boros") assert.equal(prepared.roster.find((unit) => unit.id === "boros").maxHp, 5500);
  }
  const html = readFileSync(new URL("./dev/stage2.html", import.meta.url), "utf8");
  assert.match(html, /value="titan-duo"/);
  assert.match(html, /id="local-step"/);
});

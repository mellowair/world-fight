import test from "node:test";
import assert from "node:assert/strict";
import { chooseRoute, beginJourney, completeLocation, completeSettlement, createCampaign, finishBattle, getRouteOptions, prepareBattle, resolveRouteEvent, selectStartingCharacter, startCampaign } from "./campaign.js";

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
  finishBattle(campaign, "victory", Math.max(1, campaign.playerHp - 20));
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
  const random = queued([0.1, 0.1, 0.1, 0.1, 0, 0.5]);
  const campaign = createCampaign(random);
  begin(campaign);
  chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
  winCurrentBattle(campaign);
  chooseRoute(campaign, getRouteOptions(campaign).find((node) => node.type === "battle").id);
  winCurrentBattle(campaign);
  assert.deepEqual(getRouteOptions(campaign).map((node) => node.type), ["battle", "question"]);

  const campRandom = queued([0.1, 0.1, 0.1, 0.1, 0.85, 0.95]);
  const second = createCampaign(campRandom);
  begin(second);
  chooseRoute(second, getRouteOptions(second).find((node) => node.type === "battle").id);
  winCurrentBattle(second);
  chooseRoute(second, getRouteOptions(second).find((node) => node.type === "battle").id);
  winCurrentBattle(second);
  assert.deepEqual(getRouteOptions(second).map((node) => node.type), ["campfire", "campfire"]);
});

test("a question event completes once and advances directly to a fresh route", () => {
  const campaign = createCampaign(() => 0.9);
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
  const campaign = createCampaign(() => 0.9);
  begin(campaign);
  for (let i = 0; i < 2; i += 1) {
    const node = getRouteOptions(campaign).find((entry) => entry.type === "question");
    chooseRoute(campaign, node.id);
    resolveRouteEvent(campaign);
    completeLocation(campaign);
  }
  assert.equal(campaign.consecutiveWithoutBattle, 2);
  assert.deepEqual(getRouteOptions(campaign).map((node) => node.type), ["battle", "battle"]);

  const encounter = createCampaign(queued([0.9, 0.9, 0.1]));
  begin(encounter);
  const question = getRouteOptions(encounter).find((node) => node.type === "question");
  assert.equal(chooseRoute(encounter, question.id).type, "battle");
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

test("step nine excludes campfire and elite; its completion opens the fixed boss step", () => {
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
  assert.equal(winCurrentBattle(campaign), "combat");
  assert.equal(campaign.step, 10);
  assert.equal(campaign.activeNode.type, "demon");
  assert.equal(prepareBattle(campaign).battle.type, "boss");
  finishBattle(campaign, "victory", campaign.playerHp - 10);
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

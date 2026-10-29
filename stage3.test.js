import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTING_CHARACTERS } from "./characters.js";
import { beginJourney, chooseRoute, claimCampaignReward, completeLocation, createCampaign, finishBattle, getActiveCampfireOptions, getCampaignRewardOffer, getRouteMap, getRouteOptions, prepareBattle, resolveCampaignEvent, selectStartingCharacter, startCampaign } from "./campaign.js";
import { simulateCampaigns } from "./balanceSimulator.js";

function prepareRoute(campaign, step, type) {
  const target = campaign.routeMap.nodes.find((node) => node.step === step && node.type === type);
  if (!target) throw new Error(`test map has no ${type} node at step ${step}`);
  const path = [];
  let current = campaign.routeMap.currentNodeId;
  const findPath = (id, trail = []) => {
    if (id === target.id) return trail;
    const node = campaign.routeMap.nodes.find((entry) => entry.id === id);
    for (const child of node?.nextNodeIds ?? []) {
      const found = findPath(child, [...trail, child]);
      if (found) return found;
    }
    return null;
  };
  path.push(...(findPath(current) ?? []));
  for (const id of path) {
    const result = chooseRoute(campaign, id);
    if (id === target.id) return result;
    if (campaign.status === "event") {
      const event = campaign.pendingEvent;
      const choice = (event?.eventId === "sea_beyond" ? "sea_pass" : null)
        ?? (event?.eventId === "death_note" ? "death_note_pass" : null)
        ?? (event?.eventId === "fate_gate" ? "fate_accept" : null)
        ?? (event?.eventId === "giant_encirclement" ? "giant_escape" : null)
        ?? (campaign.activeEventType === "campfire" ? "rest" : null)
        ?? event?.data?.skillChoices?.[0];
      resolveCampaignEvent(campaign, choice);
      completeLocation(campaign);
    } else if (campaign.status === "combat") {
      prepareBattle(campaign);
      const outcome = finishBattle(campaign, "victory", campaign.playerHp);
      if (outcome.status === "reward") {
        const offer = getCampaignRewardOffer(campaign);
        const first = claimCampaignReward(campaign, offer.statChoices.slice(0, 2));
        if (first.phase === "bonus") claimCampaignReward(campaign, "skill_upgrade", null, offer.upgradeableSkills[0]);
      }
    }
  }
  return null;
}

function startForEvent(random = () => 0, required = null) {
  let seed = 0;
  if (required) {
    for (; seed < 1500; seed += 1) {
      const map = createCampaign(random, { seed }).routeMap;
      if (map.nodes.some((node) => node.step === required.step && node.type === required.type)) break;
    }
  }
  const campaign = createCampaign(random, { seed });
  startCampaign(campaign);
  campaign.candidateIds = ["naruto", "eren"]; // Stage 3 tests use a fixed route hero.
  selectStartingCharacter(campaign, "naruto", STARTING_CHARACTERS[0].activeSkills[0]);
  beginJourney(campaign);
  return campaign;
}

test("route hero opens the shared growth-aware character dialog and is not a route sign", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /<button class="route-player"[^>]*data-character-detail="naruto"[^>]*aria-haspopup="dialog"/);
  assert.match(app, /querySelectorAll\("\[data-character-detail\]"\)/);
  assert.match(app, /const run = campaign\?\.partyStates\?\.\[characterId\] \?\? null/);
  assert.match(app, /route-player"\)\.dataset\.characterDetail = hero\.id/);
  assert.match(app, /function resolveVisibleEvent\([\s\S]*?return finishEventAndAdvance\(\)/);
});

test("campfire rest and skill upgrade complete and advance exactly one route step", () => {
  const restCampaign = startForEvent(() => 0, { step: 3, type: "campfire" });
  restCampaign.runCharacterState.currentHp = 500;
  prepareRoute(restCampaign, 3, "campfire");
  const rest = resolveCampaignEvent(restCampaign, "rest");
  assert.ok(rest);
  assert.equal(completeLocation(restCampaign), "route");
  assert.equal(restCampaign.step, 4);
  assert.equal(completeLocation(restCampaign), null);
  assert.equal(restCampaign.step, 4);

  const skillCampaign = startForEvent(() => 0, { step: 3, type: "campfire" });
  prepareRoute(skillCampaign, 3, "campfire");
  const options = getActiveCampfireOptions(skillCampaign);
  const skillId = options[1].skills[0].skillId;
  assert.ok(resolveCampaignEvent(skillCampaign, "skill_upgrade", skillId));
  assert.equal(completeLocation(skillCampaign), "route");
  assert.equal(skillCampaign.step, 4);
  assert.equal(completeLocation(skillCampaign), null);
});

test("noncombat multi-choice events do not advance until the selected effect is applied", () => {
  const scrollCampaign = startForEvent(() => 0, { step: 1, type: "question" });
  prepareRoute(scrollCampaign, 1, "question");
  assert.equal(scrollCampaign.pendingEvent.eventId, "scroll");
  assert.equal(completeLocation(scrollCampaign), null);
  assert.equal(resolveCampaignEvent(scrollCampaign, "not-a-skill"), false);
  assert.equal(scrollCampaign.step, 1);
  const skillId = scrollCampaign.pendingEvent.data.skillChoices[0];
  assert.ok(resolveCampaignEvent(scrollCampaign, skillId));
  assert.equal(completeLocation(scrollCampaign), "route");
  assert.equal(scrollCampaign.step, 2);
  assert.equal(completeLocation(scrollCampaign), null);
  assert.equal(scrollCampaign.step, 2);
  assert.ok(scrollCampaign.routeOptions.some((node) => node.status === "pending"));
});

test("elite combat is a map node, never an event result", () => {
  const campaign = startForEvent(() => 0.41, { step: 3, type: "elite" });
  const selected = prepareRoute(campaign, 3, "elite");
  assert.equal(selected.type, "battle");
  assert.equal(selected.battle.type, "elite");
  assert.equal(campaign.status, "combat");
  assert.equal(campaign.pendingEvent, null);
});

test("seeded simulator is reproducible and reports observations without modifying config", () => {
  const first = simulateCampaigns({ runs: 4, seed: 481516 });
  const second = simulateCampaigns({ runs: 4, seed: 481516 });
  assert.deepEqual(first, second);
  assert.equal(first.runs, 4);
  assert.equal(first.seed, 481516);
  assert.equal(first.balanceChangesApplied, false);
  assert.ok(first.observedVictoryRate >= 0 && first.observedVictoryRate <= 1);
  assert.ok(first.averageBattles > 0);
  assert.ok(Object.values(first.outcomes).reduce((sum, count) => sum + count, 0) === 4);
  assert.equal(first.observedVictoryRate, first.outcomes.victory / first.runs);
  assert.equal(STARTING_CHARACTERS.find((hero) => hero.id === "naruto").baseStats.atk, 170);
});

test("simulator rejects invalid run counts instead of silently changing the sample", () => {
  assert.throws(() => simulateCampaigns({ runs: 0 }), RangeError);
  assert.throws(() => simulateCampaigns({ runs: 1.5 }), RangeError);
});

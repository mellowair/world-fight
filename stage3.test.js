import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTING_CHARACTERS } from "./characters.js";
import { chooseRoute, completeLocation, createCampaign, getActiveCampfireOptions, resolveCampaignEvent, selectStartingCharacter, startCampaign } from "./campaign.js";
import { simulateCampaigns } from "./balanceSimulator.js";

function prepareRoute(campaign, step, type) {
  campaign.step = step;
  campaign.status = "route";
  campaign.routeOptions = [{ id: `step-${step}-test`, step, type, status: "pending" }];
  return chooseRoute(campaign, `step-${step}-test`);
}

function startForEvent(random = () => 0) {
  const campaign = createCampaign(random);
  startCampaign(campaign);
  selectStartingCharacter(campaign, "naruto", STARTING_CHARACTERS[0].activeSkills[0]);
  return campaign;
}

test("route hero opens the shared growth-aware character dialog and is not a route sign", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /<button class="route-player"[^>]*data-character-detail="naruto"[^>]*aria-haspopup="dialog"/);
  assert.match(app, /querySelectorAll\("\[data-character-detail\]"\)/);
  assert.match(app, /const run = campaign\?\.playerId === characterId \? campaign\.runCharacterState : null/);
  assert.match(app, /route-player"\)\.dataset\.characterDetail = hero\.id/);
  assert.match(app, /function resolveVisibleEvent\([\s\S]*?return finishEventAndAdvance\(\)/);
});

test("campfire rest and skill upgrade complete and advance exactly one route step", () => {
  const restCampaign = startForEvent();
  restCampaign.runCharacterState.currentHp = 500;
  prepareRoute(restCampaign, 3, "campfire");
  const rest = resolveCampaignEvent(restCampaign, "rest");
  assert.ok(rest);
  assert.equal(completeLocation(restCampaign), "route");
  assert.equal(restCampaign.step, 4);
  assert.equal(completeLocation(restCampaign), null);
  assert.equal(restCampaign.step, 4);

  const skillCampaign = startForEvent();
  prepareRoute(skillCampaign, 3, "campfire");
  const options = getActiveCampfireOptions(skillCampaign);
  const skillId = options[1].skills[0].skillId;
  assert.ok(resolveCampaignEvent(skillCampaign, "skill_upgrade", skillId));
  assert.equal(completeLocation(skillCampaign), "route");
  assert.equal(skillCampaign.step, 4);
  assert.equal(completeLocation(skillCampaign), null);
});

test("noncombat multi-choice events do not advance until the selected effect is applied", () => {
  const scrollCampaign = startForEvent(() => 0);
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

test("encounter events remain in battle state until actual battle settlement", () => {
  const campaign = startForEvent(() => 0.41); // elite
  prepareRoute(campaign, 1, "question");
  assert.equal(campaign.pendingEvent.eventId, "elite");
  assert.equal(campaign.pendingEvent.containsBattle, true);
  assert.equal(campaign.status, "event");
  assert.equal(completeLocation(campaign), null);
  assert.equal(campaign.step, 1);
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

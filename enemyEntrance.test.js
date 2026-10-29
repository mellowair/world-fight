import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ELITE_ENEMY_DATA, EVENT_ENEMY_DATA, STAGE_TWO_BOSS_DATA } from "./characters.js";
import { chooseRoute, getRouteOptions, prepareBattle, resolveCampaignEvent, startCampaignEventBattle } from "./campaign.js";
import { createAdventureEventResult } from "./progression.js";
import { createStageTwoDirectBattleCampaign, createStageTwoTestCampaign } from "./dev/stage2-config.js";
import { createEntranceCompletion, ENEMY_ENTRANCE_DURATION_MS, getEnemyEntrance } from "./enemyEntrance.js";

test("four configured titles resolve by stable encounter and enemy IDs", () => {
  const cases = [
    ["toji", "天与暴君", "#FFFFFF", "#000000", ELITE_ENEMY_DATA.find((unit) => unit.id === "toji")],
    ["boros", "宇宙霸主", "#A855F7", "#4C1D95", STAGE_TWO_BOSS_DATA],
    ["gilgamesh", "英雄王", "#FFD700", "#92400E", EVENT_ENEMY_DATA.gilgamesh],
    ["kira", "普通上班族", "#FF69B4", "#831843", ELITE_ENEMY_DATA.find((unit) => unit.id === "kira")],
  ];
  assert.equal(ENEMY_ENTRANCE_DURATION_MS, 2000);
  for (const [id, title, color, outline, actor] of cases) {
    assert.ok(actor);
    const entrance = getEnemyEntrance({ eliteId: id, enemies: [id] }, [{ ...actor, team: "enemy" }]);
    assert.deepEqual([entrance.title, entrance.titleColor, entrance.titleOutline], [title, color, outline]);
    assert.equal(entrance.actor.id, id);
    assert.ok(existsSync(new URL(`./${actor.asset}`, import.meta.url)));
  }
  const gilgamesh = getEnemyEntrance({ type: "event", enemies: ["gilgamesh"] }, [{ ...EVENT_ENEMY_DATA.gilgamesh, team: "enemy" }]);
  assert.equal(gilgamesh.title, "英雄王", "the event battle does not need an elite route node");
});

test("normal enemies and the untitled two-unit encounter use the existing entrance", () => {
  assert.equal(getEnemyEntrance({ type: "normal", enemies: ["guard"] }, [{ id: "guard", team: "enemy" }]), null);
  assert.equal(getEnemyEntrance({ type: "elite", eliteId: "titan-duo", enemies: ["armored-titan", "colossal-titan"] },
    [{ id: "armored-titan", team: "enemy" }, { id: "colossal-titan", team: "enemy" }]), null);
  assert.equal(getEnemyEntrance({ type: "elite", eliteId: "toji", enemies: ["toji"] }, [{ id: "toji", team: "ally" }]), null);
});

test("real stage-two battle preparation and the King's Treasury event resolve one encounter title", () => {
  for (const encounterId of ["toji", "kira", "boros", "titan-duo"]) {
    const campaign = createStageTwoDirectBattleCampaign({ heroId: "naruto", partnerId: "eren", encounterId, localStep: 6, seed: 83 });
    const prepared = prepareBattle(campaign);
    const entrance = getEnemyEntrance(prepared.battle, prepared.roster);
    assert.equal(entrance?.actor.id ?? null, encounterId === "titan-duo" ? null : encounterId);
  }
  const campaign = createStageTwoTestCampaign({ heroId: "naruto", partnerId: "eren", seed: 72 });
  const question = getRouteOptions(campaign).find((node) => node.type === "question");
  assert.ok(question);
  chooseRoute(campaign, question.id);
  delete campaign.runCharacterState.eventResults[question.id];
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, question.id, "kings_treasury");
  assert.equal(resolveCampaignEvent(campaign, "treasury_advance").result.pendingBattle, true);
  assert.ok(startCampaignEventBattle(campaign));
  const prepared = prepareBattle(campaign);
  assert.equal(getEnemyEntrance(prepared.battle, prepared.roster)?.title, "英雄王");
});

test("entrance completion starts combat only once and cancellation prevents late startup", () => {
  let starts = 0;
  const gate = createEntranceCompletion(() => { starts += 1; });
  assert.equal(starts, 0);
  assert.equal(gate.complete(), true);
  assert.equal(gate.complete(), false);
  assert.equal(starts, 1);
  const abandoned = createEntranceCompletion(() => { starts += 1; });
  assert.equal(abandoned.cancel(), true);
  assert.equal(abandoned.complete(), false);
  assert.equal(starts, 1);
});


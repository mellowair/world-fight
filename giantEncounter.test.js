import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVENT_ENEMY_DATA, NORMAL_ENEMY_APPEARANCES, STARTING_CHARACTERS } from "./characters.js";
import { getActionOrder, initializeBattle, isBattleOver, simulateBattle, summonAtRoundStart } from "./battle.js";
import { beginJourney, chooseRoute, claimCampaignReward, completeLocation, createCampaign, finishBattle, getCampaignRewardOffer, getRouteEnemyGrowth, getRouteMap, getRouteOptions, prepareBattle, resolveCampaignEvent, selectStartingCharacter, startCampaign, startCampaignEventBattle } from "./campaign.js";
import { chooseAdventureEventId, createAdventureEventResult, getAvailableAdventureEventIds, resolveAdventureEvent } from "./progression.js";
import { ADVENTURE_EVENT_DATA, GIANT_SPINAL_FLUID } from "./skills.js";
import { getCharacterVisual } from "./visualConfig.js";
import { createMusicController, musicTracks } from "./music.js";

function eventCampaign(step = 3, random = () => 0) {
  const campaign = createCampaign(random, { seed: 7 });
  startCampaign(campaign);
  campaign.candidateIds = ["naruto", "eren"]; // Isolate the encounter from starter draws.
  selectStartingCharacter(campaign, "naruto", "shadow-clone-rush");
  beginJourney(campaign);
  campaign.step = step;
  campaign.status = "event";
  campaign.activeEventType = "adventure";
  campaign.activeNode = { id: `giants-${step}`, type: "question", status: "in_progress" };
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, campaign.activeNode.id, "giant_encirclement");
  return campaign;
}

test("giant encounter enters the equal-weight question pool and uses real copied assets", () => {
  const campaign = eventCampaign();
  assert.equal(getAvailableAdventureEventIds(campaign.runCharacterState, 7).includes("giant_encirclement"), false);
  assert.ok(getAvailableAdventureEventIds(campaign.runCharacterState, 8).includes("giant_encirclement"));
  assert.equal(ADVENTURE_EVENT_DATA.giant_encirclement.description, "那一天，人类想起了被巨人支配的恐惧");
  assert.deepEqual([EVENT_ENEMY_DATA.dina.hp, EVENT_ENEMY_DATA.dina.atk, EVENT_ENEMY_DATA.dina.def, EVENT_ENEMY_DATA.dina.spd], [1000, 80, 60, 5]);
  assert.deepEqual([EVENT_ENEMY_DATA.dina.summonPassive.firstRound, EVENT_ENEMY_DATA.dina.summonPassive.everyRounds], [2, 6]);
  assert.equal(getCharacterVisual(EVENT_ENEMY_DATA.dina).scale, 1.7);
  for (const path of [EVENT_ENEMY_DATA.dina.asset, ADVENTURE_EVENT_DATA.giant_encirclement.image, GIANT_SPINAL_FLUID.image]) {
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
  }
});

test("giant encounter draw uses actual entered-room step and filters before sampling", () => {
  const campaign = eventCampaign();
  const run = campaign.runCharacterState;
  for (let step = 1; step <= 7; step += 1) {
    assert.equal(getAvailableAdventureEventIds(run, step).includes("giant_encirclement"), false);
    assert.notEqual(chooseAdventureEventId(run, () => 0.999, step), "giant_encirclement");
  }
  for (const step of [8, 9, 12]) {
    const candidates = getAvailableAdventureEventIds(run, step);
    const index = candidates.indexOf("giant_encirclement");
    assert.ok(index >= 0);
    assert.equal(chooseAdventureEventId(run, () => (index + 0.5) / candidates.length, step), "giant_encirclement");
  }
  const source = readFileSync(new URL("./campaign.js", import.meta.url), "utf8");
  assert.match(source, /chooseAdventureEventId\(campaign\.runCharacterState, campaign\.random, campaign\.step, partyStates, campaign\.stageId\)/);
});

test("a real late-route question opens the giant encounter and carries its choice into battle and reward", () => {
  const campaign = createCampaign(() => 0.999, { seed: 1 });
  startCampaign(campaign);
  campaign.candidateIds = ["naruto", "eren"]; // Keep this route integration test independent of the opening draw.
  selectStartingCharacter(campaign, "naruto", "shadow-clone-rush");
  beginJourney(campaign);
  const map = getRouteMap(campaign);
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  function findLateQuestion(id, path = []) {
    const node = byId.get(id);
    const nextPath = [...path, node];
    if (node.type === "question" && nextPath.length - 1 >= 8) return nextPath.slice(1);
    for (const childId of node.nextNodeIds) {
      const found = findLateQuestion(childId, nextPath);
      if (found) return found;
    }
    return null;
  }
  const path = findLateQuestion(map.startNodeId);
  assert.ok(path);
  for (const node of path) {
    assert.ok(getRouteOptions(campaign).some((option) => option.id === node.id), `node ${node.id} is selectable`);
    if (node === path.at(-1)) {
      const candidates = getAvailableAdventureEventIds(campaign.runCharacterState, campaign.step);
      const index = candidates.indexOf("giant_encirclement");
      assert.ok(index >= 0);
      campaign.random = () => (index + 0.5) / candidates.length;
    }
    const entered = chooseRoute(campaign, node.id);
    if (node === path.at(-1)) {
      assert.equal(campaign.step >= 8, true);
      assert.equal(entered.event.eventId, "giant_encirclement");
      assert.equal(campaign.pendingEvent.status, "pending");
      assert.equal(campaign.pendingEvent.containsBattle, false);
      break;
    }
    if (campaign.status === "combat") {
      assert.ok(prepareBattle(campaign));
      assert.equal(finishBattle(campaign, "victory", campaign.runCharacterState.currentHp).next, "reward");
      const offer = getCampaignRewardOffer(campaign);
      const claimed = claimCampaignReward(campaign, offer.statChoices.slice(0, 2));
      if (claimed.phase === "bonus") assert.ok(claimCampaignReward(campaign, "skill_upgrade", null, offer.upgradeableSkills[0]));
    } else {
      const eventId = campaign.pendingEvent?.eventId;
      const choice = node.type === "campfire" ? "rest" : ({ kings_treasury: "treasury_leave", sea_beyond: "sea_pass",
        sea_beyond_2: "sea_home", old_scroll_2: "scroll_not_yet", coffee_shop: "coffee_leave",
        anteiku_2: "anteiku_leave", big_rock: "rock_bypass", giant_rock_2: "rock_avoid_again",
        death_note: "death_note_pass", fate_gate: "fate_accept" })[eventId]
        ?? campaign.pendingEvent?.data?.skillChoices?.[0] ?? "scroll_leave";
      assert.ok(resolveCampaignEvent(campaign, choice));
      assert.equal(completeLocation(campaign), "route");
    }
  }
  assert.equal(resolveCampaignEvent(campaign, "giant_heart").status, "pending_battle");
  assert.equal(startCampaignEventBattle(campaign).battle.enemies[0], "dina");
  const roster = prepareBattle(campaign).roster;
  assert.deepEqual([roster[1].atk, roster[1].def, roster[1].row], [80, 60, "back"]);
  const before = [campaign.runCharacterState.atk, campaign.runCharacterState.def, campaign.runCharacterState.maxHp];
  assert.equal(finishBattle(campaign, "victory", campaign.runCharacterState.currentHp).next, "reward");
  assert.deepEqual([campaign.runCharacterState.atk - before[0], campaign.runCharacterState.def - before[1], campaign.runCharacterState.maxHp - before[2]], [30, 30, 300]);
  assert.equal(finishBattle(campaign, "victory", campaign.runCharacterState.currentHp), false);
});

test("battle nameplates sit below the shared sprite anchor and remain attached to each fighter", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(css, /\.fighter-name\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*-12px;[^}]*left:\s*50%;/);
  assert.match(css, /\.sprite-wrap\s*\{[^}]*margin-top:\s*20px;/);
  assert.match(html, /<section class="arena"[^>]*>[\s\S]*?<div class="fighter-name">巨人<\/div>/);
  assert.match(html, /<div id="hero-fighter"[^>]*>[\s\S]*?<div class="fighter-name">鸣人<\/div>/);
});

test("escape rolls once: success costs run SPD, failure waits for battle without costing SPD", () => {
  const success = eventCampaign(3, () => 0.699);
  const first = resolveCampaignEvent(success, "giant_escape");
  assert.equal(first.result.escape, "success");
  assert.equal(success.runCharacterState.spd, 75);
  assert.equal(success.status, "event");
  assert.equal(success.eventResolved, true);
  assert.equal(resolveCampaignEvent(success, "giant_escape"), false);
  assert.equal(success.runCharacterState.spd, 75);

  const failure = eventCampaign(3, () => 0.7);
  const failed = resolveCampaignEvent(failure, "giant_escape");
  assert.equal(failed.result.escape, "failed");
  assert.equal(failed.status, "pending_battle");
  assert.equal(failure.status, "event", "the UI has a chance to show the failure result");
  assert.equal(failure.runCharacterState.spd, 85);
  assert.equal(resolveCampaignEvent(failure, "giant_escape"), false);
  assert.equal(startCampaignEventBattle(failure).battle.type, "event");
  assert.equal(failure.status, "combat");
  prepareBattle(failure);
  assert.equal(finishBattle(failure, "defeat", 0).next, "defeat");
  assert.equal(failure.runCharacterState.permanentEffects.length, 0);
});

test("heart choice grants spinal fluid once on victory without healing current HP", () => {
  const campaign = eventCampaign(6);
  campaign.runCharacterState.currentHp = 800;
  assert.equal(resolveCampaignEvent(campaign, "giant_heart").status, "pending_battle");
  assert.equal(startCampaignEventBattle(campaign).battle.type, "event");
  const prepared = prepareBattle(campaign);
  assert.equal(prepared.roster.find((unit) => unit.id === "dina").maxHp, 1000);
  assert.equal(finishBattle(campaign, "victory", 800).next, "reward");
  assert.deepEqual([campaign.runCharacterState.atk, campaign.runCharacterState.def, campaign.runCharacterState.maxHp, campaign.runCharacterState.currentHp], [200, 100, 1900, 800]);
  assert.equal(campaign.runCharacterState.permanentEffects.length, 1);
  assert.equal(finishBattle(campaign, "victory", 800), false);
  assert.deepEqual([campaign.runCharacterState.atk, campaign.runCharacterState.def, campaign.runCharacterState.maxHp], [200, 100, 1900]);
  const next = createCampaign(() => 0, { seed: 8 });
  startCampaign(next);
  next.candidateIds = ["naruto", "eren"];
  selectStartingCharacter(next, "naruto", "shadow-clone-rush");
  assert.deepEqual([next.runCharacterState.atk, next.runCharacterState.def, next.runCharacterState.maxHp], [170, 70, 1600]);
});

test("winning after a failed escape keeps the normal battle reward but never grants spinal fluid", () => {
  const campaign = eventCampaign(4, () => 0.9);
  resolveCampaignEvent(campaign, "giant_escape");
  startCampaignEventBattle(campaign);
  prepareBattle(campaign);
  assert.equal(finishBattle(campaign, "victory", 700).next, "reward");
  assert.deepEqual([campaign.runCharacterState.atk, campaign.runCharacterState.def, campaign.runCharacterState.maxHp, campaign.runCharacterState.currentHp], [170, 70, 1600, 700]);
  assert.equal(campaign.runCharacterState.permanentEffects.length, 0);
});

test("Dina stays unscaled while each summoned giant gets the ordinary guard's actual-step growth once", () => {
  for (const [step, expected] of [[1, [400, 48, 32, 30]], [3, [500, 60, 40, 30]], [6, [625, 69, 44, 30]], [9, [700, 72, 46, 30]]]) {
    const campaign = eventCampaign(step);
    resolveCampaignEvent(campaign, "giant_heart");
    startCampaignEventBattle(campaign);
    const dina = prepareBattle(campaign).roster.find((unit) => unit.id === "dina");
    assert.deepEqual([dina.maxHp, dina.atk, dina.def, dina.spd], [1000, 80, 60, 5]);
    const giant = dina.summonPassive.unit;
    assert.deepEqual([giant.maxHp, giant.atk, giant.def, giant.spd], expected);
    assert.equal(giant.asset, NORMAL_ENEMY_APPEARANCES.giant.asset);
    assert.deepEqual(getRouteEnemyGrowth("normal", step), getRouteEnemyGrowth("normal", campaign.step));
  }
});

test("Dina summons at rounds 2, 8, 14, 20 and fourth living giant ends combat once", () => {
  const campaign = eventCampaign(3);
  resolveCampaignEvent(campaign, "giant_heart");
  startCampaignEventBattle(campaign);
  const prepared = prepareBattle(campaign);
  const state = initializeBattle(prepared.roster);
  const summons = [];
  for (let round = 1; round <= 20; round += 1) {
    state.round = round;
    summons.push(...summonAtRoundStart(state));
    assert.equal(summonAtRoundStart(state).length, 0, "same round cannot summon twice");
  }
  assert.deepEqual(summons.filter((event) => event.type === "summon").map((event) => event.round), [2, 8, 14, 20]);
  assert.equal(summons.filter((event) => event.type === "giant-overrun").length, 1);
  assert.equal(new Set(summons.filter((event) => event.type === "summon").map((event) => event.character.id)).size, 4);
  const freshBattle = initializeBattle(prepared.roster);
  freshBattle.round = 1;
  assert.equal(summonAtRoundStart(freshBattle).length, 0);
  freshBattle.round = 2;
  assert.equal(summonAtRoundStart(freshBattle).length, 1, "a new Dina battle restarts the summon schedule");
  assert.ok(getActionOrder(state).some((unit) => unit.id === summons[0].character.id));
  const dina = state.characters.find((unit) => unit.id === "dina");
  dina.currentHp = 0; dina.alive = false;
  assert.equal(isBattleOver(state), "defeat");
  state.round = 32;
  assert.deepEqual(summonAtRoundStart(state), []);
  state.characters.filter((unit) => unit.team === "enemy").forEach((unit) => { unit.currentHp = 0; unit.alive = false; });
  assert.equal(isBattleOver(state), "defeat", "the forced overrun outcome remains final");
});

test("summoned giants take real turns in the precomputed battle and have separate attack and HP events", () => {
  const campaign = eventCampaign(3);
  resolveCampaignEvent(campaign, "giant_heart");
  startCampaignEventBattle(campaign);
  const { roster } = prepareBattle(campaign);
  const ally = { ...roster[0], hp: 100000, maxHp: 100000, currentHp: 100000, atk: 500, skills: [], skill: null };
  const dina = { ...roster[1], hp: 3500, maxHp: 3500, currentHp: 3500 };
  const result = simulateBattle([ally, dina], () => 0.999, { playerId: ally.id });
  const summon = result.events.find((event) => event.type === "summon");
  assert.equal(summon?.round, 2);
  assert.ok(result.events.some((event) => event.type === "attack" && event.attackerId === summon.character.id));
  assert.ok(result.events.some((event) => event.type === "attack" && event.targetId === summon.character.id));
  assert.equal(result.outcome, "victory");
});

test("music stays disabled without files and one looped player handles play, pause, and switching", async () => {
  assert.ok(musicTracks.every((track) => track.src === null));
  const absent = createMusicController(musicTracks, class { constructor() { throw new Error("should not load"); } });
  assert.equal(absent.getState().available, false);
  assert.equal(await absent.play(), false);
  let instances = 0;
  class FakeAudio {
    constructor() { instances += 1; this.paused = true; this.currentTime = 0; this.listeners = {}; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    async play() { this.paused = false; this.listeners.play?.(); }
    pause() { this.paused = true; this.listeners.pause?.(); }
  }
  const controller = createMusicController([{ name: "一", src: "a.mp3" }, { name: "二", src: "b.ogg" }], FakeAudio);
  assert.equal(await controller.play(), true);
  assert.equal(await controller.select(1), true);
  assert.equal(controller.getState().playing, true);
  controller.pause();
  assert.equal(controller.getState().playing, false);
  assert.equal(instances, 1);
});

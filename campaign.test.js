import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_DATA, NORMAL_ENEMY_APPEARANCES, STARTING_CHARACTERS } from "./characters.js";
import { SKILL_DATA } from "./skills.js";
import { beginJourney, chooseRoute, chooseStartingSkill, claimCampaignReward, completeLocation, completeSettlement, createCampaign, finishBattle, getCampaignRewardOffer, getRouteEnemyGrowth, getRouteMap, getRouteOptions, prepareBattle, resolveCampaignEvent, resolveRouteEvent, selectStartingCharacter, startCampaign, startCampaignEventBattle } from "./campaign.js";
import { createAdventureEventResult, resolveAdventureEvent, upgradeActiveSkill } from "./progression.js";

test("Eren human-form first-pass stats and skill configurations are explicit", () => {
  const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");
  const naruto = STARTING_CHARACTERS.find((entry) => entry.id === "naruto");
  assert.ok(eren);
  assert.deepEqual([eren.id, eren.hp, eren.atk, eren.def, eren.spd], ["eren", 1900, 120, 90, 50]);
  assert.deepEqual([eren.baseStats.maxHp, eren.baseStats.atk, eren.baseStats.def, eren.baseStats.spd], [1900, 120, 90, 50]);
  assert.deepEqual([naruto.hp, naruto.atk, naruto.def, naruto.spd], [1600, 170, 70, 85]);
  assert.deepEqual(eren.activeSkills, ["eren-free-will", "eren-tatakae"]);
  assert.equal(eren.passiveSkillId, "eren-2000-years");
  assert.deepEqual(Object.values(SKILL_DATA["eren-free-will"].levels).map(({ chance, defenseBonus }) => [chance, defenseBonus]), [[0.5, 10], [0.55, 15], [0.6, 20], [0.7, 25]]);
  assert.deepEqual(Object.values(SKILL_DATA["eren-tatakae"].levels).map(({ chance, multiplier, attackFormula, doubleNextDamage }) => [chance, multiplier, attackFormula, doubleNextDamage]), [
    [0.3, 1.3, "atk_plus_current_def", true], [0.35, 1.4, "atk_plus_current_def", true],
    [0.4, 1.55, "atk_plus_current_def", true], [0.5, 1.7, "atk_plus_current_def", true],
  ]);
  assert.equal(SKILL_DATA["eren-2000-years"].levels[1].damageImmune, true);
});

test("Eren can choose one configured skill and prepare a battle with his passive", () => {
  const campaign = createCampaign(() => 0, { seed: 77 });
  assert.equal(startCampaign(campaign), true);
  assert.ok(selectStartingCharacter(campaign, "eren", null));
  assert.equal(campaign.startingSkillSelected, false);
  assert.deepEqual(campaign.runCharacterState.learnedActiveSkills, []);
  assert.equal(campaign.runCharacterState.passiveSkillId, "eren-2000-years");
  assert.equal(chooseStartingSkill(campaign, "eren-free-will").id, "eren-free-will");
  assert.equal(beginJourney(campaign), "route");
  campaign.step = 1;
  campaign.currentBattle = { type: "normal", step: 1, enemies: ["guard"], enemyNames: { guard: "巡逻守卫" } };
  campaign.status = "combat";
  const prepared = prepareBattle(campaign);
  assert.ok(prepared);
  assert.deepEqual(prepared.roster[0].skills.map((skill) => skill.id), ["eren-free-will"]);
  assert.equal(prepared.roster[0].attackType, "melee");
});

test("fall rock's permanent attack and critical gains enter the next battle once", () => {
  const campaign = createCampaign(() => 0, { seed: 78 });
  assert.equal(startCampaign(campaign), true);
  campaign.candidateIds = ["naruto", "eren"]; // Fixed hero for progression regression.
  assert.ok(selectStartingCharacter(campaign, "naruto"));
  assert.equal(beginJourney(campaign), "route");
  const run = campaign.runCharacterState;
  for (const sourceId of ["rock-1", "rock-2", "rock-3"]) {
    createAdventureEventResult(run, sourceId, "fall_rock");
    assert.ok(resolveAdventureEvent(run, sourceId));
  }
  campaign.currentBattle = { type: "normal", step: 3, enemies: ["guard"], enemyNames: { guard: "巡逻守卫" } };
  campaign.status = "combat";
  const roster = prepareBattle(campaign).roster;
  assert.equal(roster[0].atk, 195);
  assert.ok(Math.abs(roster[0].critChance - 0.20) < 1e-9);
  assert.equal(roster[0].maxHp, 1444);
  assert.equal(STARTING_CHARACTERS.find((entry) => entry.id === "naruto").atk, 170, "base character template remains unchanged");
});

function queued(values, fallback = 0) {
  let index = 0;
  return () => values[index++] ?? fallback;
}

function begin(campaign) {
  assert.equal(startCampaign(campaign), true);
  campaign.candidateIds = ["naruto", "eren"]; // This fixture tests routes, not the opening draw.
  assert.ok(selectStartingCharacter(campaign, "naruto"));
  assert.equal(beginJourney(campaign), "route");
}

function campaignForNode(step, type, random = () => 0) {
  for (let seed = 0; seed < 3000; seed += 1) {
    const campaign = createCampaign(random, { seed });
    begin(campaign);
    const node = getRouteMap(campaign).nodes.find((entry) => entry.step === step && entry.type === type);
    if (node) return { campaign, node };
  }
  throw new Error(`no deterministic map found with ${type} at step ${step}`);
}

function campaignForEncounterStep(step, type, random = () => 0) {
  for (let seed = 0; seed < 3000; seed += 1) {
    const campaign = createCampaign(random, { seed });
    begin(campaign);
    const node = getRouteMap(campaign).nodes.find((entry) =>
      entry.type === type && pathToNode(campaign, entry.id)?.length === step);
    if (node) return { campaign, node };
  }
  throw new Error(`no ${type} node reached as encounter step ${step}`);
}

function winCurrentBattle(campaign) {
  const prepared = prepareBattle(campaign);
  assert.ok(prepared);
  assert.equal(prepareBattle(campaign), null, "a location cannot launch the same battle twice");
  const transition = finishBattle(campaign, "victory", Math.max(1, campaign.playerHp - 20));
  if (transition.status === "reward") {
    const offer = getCampaignRewardOffer(campaign);
    const stat = claimCampaignReward(campaign, offer.statChoices.slice(0, 2));
    if (stat.phase === "bonus") claimCampaignReward(campaign, "skill_upgrade", null, offer.upgradeableSkills[0]);
    return campaign.status;
  }
  return completeSettlement(campaign);
}

function pathToNode(campaign, targetId) {
  const map = getRouteMap(campaign);
  const queue = [[map.currentNodeId, campaign.consecutiveWithoutBattle, []]];
  const seen = new Set();
  while (queue.length) {
    const [id, streak, path] = queue.shift();
    if (id === targetId) return path;
    const stateKey = `${id}:${streak}`;
    if (seen.has(stateKey)) continue;
    seen.add(stateKey);
    const node = map.nodes.find((entry) => entry.id === id);
    const children = (node?.nextNodeIds ?? []).map((nextId) => map.nodes.find((entry) => entry.id === nextId)).filter(Boolean);
    const legal = streak >= 2 ? children.filter((child) => ["battle", "elite", "demon"].includes(child.type)) : children;
    for (const child of legal) {
      const nextStreak = ["battle", "elite", "demon"].includes(child.type) ? 0 : Math.min(2, streak + 1);
      queue.push([child.id, nextStreak, [...path, child.id]]);
    }
  }
  return null;
}

function travelTo(campaign, targetId) {
  const path = pathToNode(campaign, targetId);
  assert.ok(path, "target " + targetId + " must be reachable from the current map position");
  for (const id of path) {
    const node = getRouteMap(campaign).nodes.find(entry => entry.id === id);
    assert.ok(getRouteOptions(campaign).some(entry => entry.id === id), "map edge to " + id + " must be selectable");
    const transition = chooseRoute(campaign, id);
    if (id === targetId) return transition;
    if (campaign.status === "event") {
      if (campaign.activeEventType === "campfire") resolveCampaignEvent(campaign, "rest");
      else {
        const event = campaign.pendingEvent;
        if (event.eventId === "giant_encirclement") {
          assert.ok(resolveCampaignEvent(campaign, "giant_heart"));
          assert.ok(startCampaignEventBattle(campaign));
          winCurrentBattle(campaign);
          continue;
        }
        const choice = event.eventId === "sea_beyond" ? "sea_pass" : event.eventId === "death_note" ? "death_note_pass" : event.eventId === "fate_gate" ? "fate_accept" : event.data.skillChoices?.[0] ?? "scroll_leave";
        resolveCampaignEvent(campaign, choice);
      }
      completeLocation(campaign);
    } else if (campaign.status === "combat") winCurrentBattle(campaign);
    else assert.fail("unexpected status after choosing " + node.type + ": " + campaign.status);
  }
  return null;
}

test("question draw gates giant encounter by visited-room step across real map travel", () => {
  for (const [step, eligible] of [[7, false], [8, true]]) {
    const { campaign, node } = campaignForEncounterStep(step, "question", () => 0.999);
    const transition = travelTo(campaign, node.id);
    assert.equal(transition.type, "event");
    assert.equal(campaign.step, step);
    assert.equal(campaign.pendingEvent.eventId === "giant_encirclement", eligible);
  }
});

test("opening moves through character choice and initializes a stable map before any node is entered", () => {
  const campaign = createCampaign(() => 0.1, { seed: 991 });
  const generatedMap = campaign.routeMap;
  assert.ok(generatedMap, "the map is generated when a new campaign is created");
  assert.equal(campaign.status, "intro");
  assert.equal(campaign.activeNode, null);
  assert.equal(campaign.completedBattles, 0);
  assert.equal(startCampaign(campaign), true);
  assert.equal(campaign.status, "character-select");
  assert.equal(selectStartingCharacter(campaign, "not-a-hero"), false);
  selectStartingCharacter(campaign, "naruto");
  assert.equal(beginJourney(campaign), "route");
  assert.equal(campaign.step, 1);
  assert.equal(campaign.routeMap, generatedMap, "beginning exploration must reuse the original generated map");
  assert.equal(campaign.currentBattle, null);
  assert.equal(campaign.pendingEvent, null);
  assert.equal(campaign.activeNode, null);
  const legalIds = new Set(campaign.routeMap.nodes.find((node) => node.id === campaign.routeMap.currentNodeId).nextNodeIds);
  assert.ok(getRouteOptions(campaign).length > 0);
  assert.ok(getRouteOptions(campaign).every((node) => legalIds.has(node.id) && node.status === "pending"));
  assert.equal(campaign.completedBattles, 0, "map preview does not launch combat or claim rewards");
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
  assert.equal(base.atk, 170, "campaign upgrades do not mutate shared base character data");

  assert.equal(finishBattle(campaign, "victory", 640).status, "reward");
  assert.equal(campaign.runCharacterState.currentHp, 640);
  assert.equal(campaign.activeNode.status, "in_progress", "node stays open until its reward is applied");
  const offer = getCampaignRewardOffer(campaign);
  const choices = offer.statChoices.slice(0, 2);
  const claimed = claimCampaignReward(campaign, choices);
  const upgradedAtk = campaign.runCharacterState.atk;
  assert.equal(claimed.phase, "complete");
  assert.equal(campaign.status, "route");
  assert.equal(campaign.step, 2);
  assert.equal(claimCampaignReward(campaign, choices), false);

  let nextNode, nextHero;
  while (!nextHero) {
    nextNode = getRouteOptions(campaign).find((node) => ["battle", "elite"].includes(node.type));
    if (nextNode) { chooseRoute(campaign, nextNode.id); nextHero = prepareBattle(campaign).roster.find((entry) => entry.team === "ally"); }
    else { const eventNode = getRouteOptions(campaign)[0]; assert.ok(eventNode); chooseRoute(campaign, eventNode.id); if (campaign.activeEventType === "campfire") resolveCampaignEvent(campaign, "rest"); else resolveCampaignEvent(campaign, campaign.pendingEvent.eventId === "sea_beyond" ? "sea_pass" : campaign.pendingEvent.eventId === "death_note" ? "death_note_pass" : campaign.pendingEvent.eventId === "fate_gate" ? "fate_accept" : campaign.pendingEvent.data.skillChoices?.[0] ?? "scroll_leave"); completeLocation(campaign); }
  }
  assert.equal(nextHero.currentHp, 640);
  assert.equal(nextHero.atk, upgradedAtk);
  assert.equal(nextHero.skills[0].level, 2);
});

test("route choices are graph children only, and completed nodes cannot be re-entered", () => {
  const campaign = createCampaign(() => 0, { seed: 3105 });
  begin(campaign);
  const map = getRouteMap(campaign);
  const start = map.nodes.find((node) => node.id === map.startNodeId);
  const legal = getRouteOptions(campaign);
  assert.deepEqual(legal.map((node) => node.id).sort(), [...start.nextNodeIds].sort());
  const future = map.nodes.find((node) => node.step === 4);
  assert.equal(chooseRoute(campaign, future.id), null, "cannot skip layers");
  const first = legal[0];
  chooseRoute(campaign, first.id);
  if (campaign.status === "event") {
    resolveCampaignEvent(campaign, campaign.pendingEvent.data.skillChoices?.[0] ?? null);
    completeLocation(campaign);
  } else winCurrentBattle(campaign);
  assert.equal(chooseRoute(campaign, first.id), null, "completed node cannot be entered twice");
  const current = map.nodes.find((node) => node.id === map.currentNodeId);
  assert.ok(getRouteOptions(campaign).every((node) => current.nextNodeIds.includes(node.id)));
});

test("different-length branches enter one shared room at their actual encounter steps", () => {
  const visits = [];
  for (const firstId of getRouteMap(createCampaign(() => 0, { seed: 42 })).nodes
    .find((node) => node.id === "start-konoha").nextNodeIds) {
    const campaign = createCampaign(() => 0, { seed: 42 });
    begin(campaign);
    chooseRoute(campaign, firstId);
    if (campaign.status === "combat") winCurrentBattle(campaign);
    else {
      const event = campaign.pendingEvent;
      const choice = event.eventId === "sea_beyond" ? "sea_pass" : event.eventId === "death_note" ? "death_note_pass" : event.eventId === "fate_gate" ? "fate_accept" : event.data.skillChoices?.[0] ?? "scroll_leave";
      assert.ok(resolveCampaignEvent(campaign, choice));
      completeLocation(campaign);
    }
    const selected = travelTo(campaign, "join-1");
    assert.equal(selected.battle.type, "normal");
    assert.equal(campaign.activeNode.id, "join-1");
    assert.equal(chooseRoute(campaign, "join-1"), null);
    const step = selected.battle.step;
    winCurrentBattle(campaign);
    assert.equal(campaign.history.filter((entry) => entry.id === "join-1").length, 1);
    visits.push(step);
  }
  assert.deepEqual(visits.sort(), [3, 4]);
});

test("short and long complete routes use their visited-room count for the Boss", () => {
  const seed = 42;
  const reference = getRouteMap(createCampaign(() => 0, { seed }));
  const byId = new Map(reference.nodes.map((node) => [node.id, node]));
  const paths = [];
  const walk = (id, path = []) => {
    if (id === reference.bossNodeId) { paths.push(path); return; }
    for (const child of byId.get(id).nextNodeIds) walk(child, [...path, child]);
  };
  walk(reference.startNodeId);
  paths.sort((a, b) => a.length - b.length);
  for (const path of [paths[0], paths.at(-1)]) {
    const campaign = createCampaign(() => 0, { seed });
    begin(campaign);
    path.forEach((id, index) => {
      assert.equal(campaign.step, index + 1);
      const selected = chooseRoute(campaign, id);
      assert.ok(selected);
      if (id === reference.bossNodeId) {
        assert.equal(selected.battle.step, path.length);
        assert.equal(prepareBattle(campaign).battle.step, path.length);
        assert.equal(finishBattle(campaign, "victory", campaign.playerHp).status, "settlement");
        assert.equal(completeSettlement(campaign), "victory");
        return;
      }
      if (campaign.status === "combat") winCurrentBattle(campaign);
      else {
        const event = campaign.pendingEvent;
        const choice = campaign.activeEventType === "campfire" ? "rest" : event.eventId === "sea_beyond" ? "sea_pass" : event.eventId === "death_note" ? "death_note_pass" : event.eventId === "fate_gate" ? "fate_accept" : event.data.skillChoices?.[0] ?? "scroll_leave";
        assert.ok(resolveCampaignEvent(campaign, choice));
        assert.equal(completeLocation(campaign), "route");
      }
    });
    assert.equal(campaign.history.length, path.length);
  }
  assert.deepEqual([paths[0].length, paths.at(-1).length], [11, 15]);
});

test("step one and two contain only normal battle or question nodes", () => {
  const campaign = createCampaign(() => 0, { seed: 66 });
  begin(campaign);
  for (const node of getRouteMap(campaign).nodes.filter((entry) => entry.step <= 2 && entry.step > 0)) {
    assert.ok(["battle", "question"].includes(node.type));
  }
});

test("map elite nodes enter the existing elite battle and two-stage reward flow", () => {
  let campaign;
  let eliteNode;
  for (let seed = 0; seed < 500 && !eliteNode; seed += 1) {
    campaign = createCampaign(() => 0, { seed });
    begin(campaign);
    eliteNode = getRouteMap(campaign).nodes.find((node) => node.type === "elite");
  }
  assert.ok(eliteNode, "seed search should find an elite node");
  assert.ok(eliteNode.step >= 3 && eliteNode.step <= 12);
  const selected = travelTo(campaign, eliteNode.id);
  assert.equal(selected.battle.type, "elite");
  prepareBattle(campaign);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp - 50).status, "reward");
  const offer = getCampaignRewardOffer(campaign);
  const stat = claimCampaignReward(campaign, offer.statChoices.slice(0, 2));
  assert.equal(stat.phase, "bonus");
  assert.equal(claimCampaignReward(campaign, "skill_upgrade", null, offer.upgradeableSkills[0]).phase, "complete");
  assert.equal(campaign.step, selected.battle.step + 1);
});

test("a question event completes once and advances directly to a fresh route", () => {
  const { campaign, node: oldNode } = campaignForNode(1, "question", queued([0.01]));
  assert.equal(travelTo(campaign, oldNode.id).type, "event");
  const once = resolveRouteEvent(campaign);
  assert.ok(once);
  assert.equal(resolveRouteEvent(campaign), null);
  assert.equal(completeLocation(campaign), "route");
  assert.equal(campaign.step, 2);
  assert.ok(getRouteOptions(campaign).every((node) => node.step === 2));
  assert.equal(chooseRoute(campaign, oldNode.id), null);
});

test("Sea Beyond remains the same active event through chained choices, then completes once", () => {
  let started = null;
  for (let seed = 0; seed < 3000 && !started; seed += 1) {
    const campaign = createCampaign(() => 0, { seed });
    begin(campaign);
    campaign.runCharacterState.learnedActiveSkills = ["shadow-clone-rush", "rasengan"];
    campaign.runCharacterState.skillLevels = { "shadow-clone-rush": 1, rasengan: 1 };
    const question = getRouteOptions(campaign).find(node => node.type === "question");
    if (!question) continue;
    chooseRoute(campaign, question.id);
    if (campaign.pendingEvent?.eventId === "sea_beyond") started = campaign;
  }
  assert.ok(started, "a deterministic seed should expose the Sea Beyond event");
  const sourceId = started.activeNode.id;
  assert.equal(resolveCampaignEvent(started, "sea_begin").status, "pending");
  assert.equal(started.eventResolved, false);
  assert.equal(started.pendingEvent.sourceId, sourceId);
  assert.equal(resolveCampaignEvent(started, "sea_sacrifice").status, "pending");
  assert.equal(completeLocation(started), null, "the route cannot advance midway through the event");
  const completed = resolveCampaignEvent(started, "sea_finish");
  assert.equal(completed.status, "completed");
  assert.equal(started.eventResolved, true);
  assert.equal(started.activeNode.id, sourceId);
  assert.equal(completeLocation(started), "route");
});

test("after two noncombat visits, map choices are restricted to connected battle nodes", () => {
  const campaign = createCampaign(() => 0, { seed: 611 });
  begin(campaign);
  campaign.consecutiveWithoutBattle = 2;
  const choices = getRouteOptions(campaign);
  assert.ok(choices.length > 0);
  assert.ok(choices.every((node) => ["battle", "elite", "demon"].includes(node.type)));
  assert.ok(choices.every((node) => campaign.routeMap.nodes.find((entry) => entry.id === campaign.routeMap.currentNodeId).nextNodeIds.includes(node.id)));
});

test("normal and elite route growth bands match the configured steps without compounding", () => {
  const expected = {
    normal: [[0.8, 0.8, 0.8], [1, 1, 1], [1.25, 1.15, 1.1], [1.4, 1.2, 1.15]],
    elite: [[0.9, 0.9, 0.9], [1, 1, 1], [1.15, 1.1, 1.05], [1.25, 1.15, 1.1]],
  };
  for (const [tier, steps] of Object.entries({ normal: [1, 3, 6, 9], elite: [1, 3, 6, 9] })) {
    steps.forEach((step, index) => {
      const growth = getRouteEnemyGrowth(tier, step);
      assert.deepEqual([growth.hp, growth.atk, growth.def], expected[tier][index]);
    });
  }
  assert.deepEqual(getRouteEnemyGrowth("boss", 10), { hp: 1, atk: 1, def: 1 });
  assert.deepEqual(
    CHARACTER_DATA.filter((character) => character.team === "enemy").map(({ hp, atk, def, spd }) => [hp, atk, def, spd]),
    [[500, 60, 40, 30], [400, 70, 20, 30]],
    "guard and mage retain separate ordinary-enemy baselines",
  );
});

test("ordinary battles fix a seeded giant or slime appearance while the mage stays in back", () => {
  const seen = new Set();
  for (let seed = 0; seed < 32; seed += 1) {
    let randomCalls = 0;
    const campaign = createCampaign(() => { randomCalls += 1; return 0.3; }, { seed });
    begin(campaign);
    const node = getRouteOptions(campaign).find((entry) => entry.type === "battle");
    if (!node) continue;
    const beforeSelection = randomCalls;
    chooseRoute(campaign, node.id);
    assert.equal(randomCalls, beforeSelection, "appearance selection does not consume the combat or event RNG");
    const appearanceId = campaign.currentBattle.enemyAppearanceIds.guard;
    assert.ok(["giant", "slime"].includes(appearanceId));
    const prepared = prepareBattle(campaign);
    const front = prepared.roster.find((character) => character.id === "guard");
    assert.equal(front.name, NORMAL_ENEMY_APPEARANCES[appearanceId].name);
    assert.equal(front.asset, NORMAL_ENEMY_APPEARANCES[appearanceId].asset);
    assert.equal(front.row, "front");
    assert.deepEqual([front.maxHp, front.atk, front.def, front.spd], [400, 48, 32, 30]);
    seen.add(appearanceId);
  }
  assert.deepEqual([...seen].sort(), ["giant", "slime"]);

  const { campaign, node } = campaignForNode(2, "battle", () => 0.3);
  travelTo(campaign, node.id);
  const mage = prepareBattle(campaign).roster.find((character) => character.id === "mage");
  assert.equal(mage.name, "小法师");
  assert.equal(mage.asset, NORMAL_ENEMY_APPEARANCES.mage.asset);
  assert.equal(mage.row, "back");
});

test("route growth is applied once to normal and elite battle copies", () => {
  function prepareAtStep(targetStep, randomValue) {
    let campaign, node;
    ({ campaign, node } = campaignForEncounterStep(targetStep, "battle", () => randomValue));
    assert.ok(node, "expected a normal battle route at encounter step " + targetStep);
    const selected = travelTo(campaign, node.id);
    assert.equal(selected.battle.type, "normal");
    assert.equal(selected.battle.step, targetStep);
    return { campaign, prepared: prepareBattle(campaign) };
  }

  const expectedNormal = new Map([[1, { guard: [400, 48, 32, 30], mage: [320, 56, 16, 30] }], [3, { guard: [500, 60, 40, 30], mage: [400, 70, 20, 30] }], [6, { guard: [625, 69, 44, 30], mage: [500, 80, 22, 30] }], [9, { guard: [700, 72, 46, 30], mage: [560, 84, 23, 30] }]]);
  for (const [step, expected] of expectedNormal) {
    const { prepared } = prepareAtStep(step, 0.3);
    assert.ok(prepared);
    for (const enemy of prepared.roster.filter((character) => character.team === "enemy")) {
      assert.deepEqual([enemy.maxHp, enemy.atk, enemy.def, enemy.spd], expected[enemy.id], `normal step ${step}, ${enemy.id}`);
    }
  }

  const humanEliteExpected = new Map([[3, [1100, 40, 50, 60]], [6, [1265, 44, 52, 60]], [9, [1375, 46, 55, 60]]]);
  const bombEliteExpected = new Map([[3, [900, 150, 40, 120]], [6, [1035, 165, 42, 120]], [9, [1125, 172, 44, 120]]]);
  for (const [step, expected] of humanEliteExpected) {
    const { campaign: eliteCampaign, node: eliteNode } = campaignForEncounterStep(step, "elite", () => 0);
    const eliteSelected = travelTo(eliteCampaign, eliteNode.id);
    const elitePrepared = prepareBattle(eliteCampaign);
    assert.equal(eliteSelected.battle.type, "elite");
    assert.equal(eliteSelected.battle.eliteId, "mahito");
    const elite = elitePrepared.roster.find((character) => character.team === "enemy");
    assert.equal(elite.id, "mahito");
    assert.deepEqual([elite.maxHp, elite.atk, elite.def, elite.spd], expected, `Mahito at step ${step}`);
    assert.equal(prepareBattle(eliteCampaign), null, "an elite encounter is fixed and its route growth is not compounded");
  }
  for (const [step, expected] of bombEliteExpected) {
    const { campaign: eliteCampaign, node: eliteNode } = campaignForEncounterStep(step, "elite", () => 0.99);
    const eliteSelected = travelTo(eliteCampaign, eliteNode.id);
    const elitePrepared = prepareBattle(eliteCampaign);
    assert.equal(eliteSelected.battle.eliteId, "bomb-demon");
    const elite = elitePrepared.roster.find((character) => character.team === "enemy");
    assert.equal(elite.skills[0].id, "bomb-demon-boom");
    assert.equal(elite.skills[0].chance, 0.3);
    assert.equal(elite.skills[0].multiplier, 1.8);
    assert.deepEqual([elite.maxHp, elite.atk, elite.def, elite.spd], expected, `Bomb Demon at step ${step}`);
  }
});

test("Fate Gate waits through a noncombat node and guarantees one stable learned skill for one battle", () => {
  const campaign = createCampaign(() => 0, { seed: 7 });
  begin(campaign);
  campaign.runCharacterState.learnedActiveSkills.push("rasengan");
  campaign.runCharacterState.skillLevels.rasengan = 1;
  campaign.runCharacterState.nextBattleSkillGuarantee = { sourceId: "test-fate", skillIds: ["shadow-clone-rush", "rasengan"] };

  const question = getRouteOptions(campaign).find((node) => node.type === "question");
  assert.ok(question, "seed 7 exposes a first-step noncombat question node");
  chooseRoute(campaign, question.id);
  const event = campaign.pendingEvent;
  const choice = event.eventId === "sea_beyond" ? "sea_pass" : event.eventId === "death_note" ? "death_note_pass" : event.eventId === "fate_gate" ? "fate_accept" : event.data.skillChoices?.[0] ?? "scroll_leave";
  assert.ok(resolveCampaignEvent(campaign, choice));
  completeLocation(campaign);
  assert.deepEqual(campaign.runCharacterState.nextBattleSkillGuarantee, { sourceId: "test-fate", skillIds: ["shadow-clone-rush", "rasengan"] });

  const battleNode = getRouteOptions(campaign).find((node) => node.type === "battle");
  assert.ok(battleNode);
  chooseRoute(campaign, battleNode.id);
  const prepared = prepareBattle(campaign);
  assert.equal(prepared.combatOptions.battleStartEffects[0].skillId, "shadow-clone-rush", "the campaign's fixed RNG selects the skill once at battle start");
  const clone = prepared.roster[0].skills.find((skill) => skill.id === "shadow-clone-rush");
  const rasengan = prepared.roster[0].skills.find((skill) => skill.id === "rasengan");
  assert.equal(clone.chance, 1);
  assert.equal(rasengan.chance, 0.2);
  assert.equal(campaign.runCharacterState.nextBattleSkillGuarantee, null);
  finishBattle(campaign, "defeat", 0);
  assert.equal(campaign.runCharacterState.nextBattleSkillGuarantee, null);
});

test("Rasengan kill growth is +5 once per cast, enters the next battle, and resets next run", () => {
  const campaign = createCampaign(() => 0, { seed: 42 });
  begin(campaign);
  campaign.runCharacterState.learnedActiveSkills = ["rasengan"];
  campaign.runCharacterState.skillLevels = { rasengan: 1 };
  campaign.currentBattle = { id: "rasengan-1", type: "normal", step: 3, enemies: ["guard"], enemyNames: { guard: "巨人" } };
  campaign.status = "combat";
  prepareBattle(campaign);
  const events = [
    { type: "attack", skillId: "rasengan", skillCastId: "cast-1", targetDied: true },
    { type: "attack", skillId: "rasengan", skillCastId: "cast-1", targetDied: true },
    { type: "attack", skillId: "shadow-clone-rush", skillCastId: "cast-other", targetDied: true },
    { type: "attack", skillId: "rasengan", skillCastId: "cast-2", targetDied: true },
  ];
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp, events).status, "reward");
  assert.equal(campaign.runCharacterState.spd, 95);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp, events), false);
  assert.equal(campaign.runCharacterState.spd, 95);
  campaign.currentBattle = { id: "rasengan-2", type: "normal", step: 4, enemies: ["guard"], enemyNames: { guard: "巨人" } };
  campaign.status = "combat";
  assert.equal(prepareBattle(campaign).roster[0].spd, 95);
  const fresh = createCampaign(() => 0, { seed: 42 });
  begin(fresh);
  assert.equal(fresh.runCharacterState.spd, 85);
});

test("Boss follows the shared campfire and battle tail at the actual encounter step", () => {
  const campaign = createCampaign(() => 0, { seed: 901 });
  begin(campaign);
  const map = getRouteMap(campaign);
  assert.ok(map.nodes.filter(node => node.step === 13).every(node => node.type === "campfire"));
  assert.ok(map.nodes.filter(node => node.step === 14).every(node => ["battle", "elite", "campfire"].includes(node.type)));
  const boss = map.nodes.find(node => node.type === "demon");
  assert.equal(boss.step, 15);
  const leadIn = map.nodes.find(node => node.step === 14);
  const transition = travelTo(campaign, leadIn.id);
  if (campaign.status === "event") { resolveCampaignEvent(campaign, "rest"); completeLocation(campaign); }
  else if (campaign.status === "combat") winCurrentBattle(campaign);
  assert.ok(campaign.step >= 11 && campaign.step <= 15);
  assert.deepEqual(getRouteOptions(campaign).map(node => node.type), ["demon"]);
  const bossNode = getRouteOptions(campaign)[0];
  assert.equal(chooseRoute(campaign, bossNode.id).battle.type, "boss");
  assert.equal(campaign.currentBattle.step, campaign.step);
  assert.equal(campaign.activeNode.type, "demon");
  assert.equal(chooseRoute(campaign, bossNode.id), null, "the boss sign cannot be entered twice");
  const preparedBoss = prepareBattle(campaign);
  assert.equal(preparedBoss.battle.type, "boss");
  assert.equal(preparedBoss.battle.title, "迪达拉");
  const deidara = preparedBoss.roster.find((character) => character.team === "enemy");
  assert.equal(deidara.name, "迪达拉");
  assert.equal(deidara.role, "爆破艺术家");
  assert.equal(deidara.asset, "assets/deidara-v2/idle/idle_1.png", "the boss battle uses the new Deidara sprite");
  assert.equal(deidara.c0DamagePerRound, 70);
  assert.deepEqual([deidara.maxHp, deidara.atk, deidara.def, deidara.spd], [1700, 120, 40, 75]);
  assert.equal(deidara.skill.id, "c4-garuda");
  assert.equal(deidara.skill.chance, 1);
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
  const { campaign, node: question } = campaignForNode(1, "question", () => 0.75);
  assert.equal(travelTo(campaign, question.id).event.eventId, "big_rock");
  assert.ok(resolveCampaignEvent(campaign));
  assert.equal(completeLocation(campaign), "route");

  for (const [battleIndex, rounds] of [2, 1].entries()) {
    const battleNode = getRouteOptions(campaign).find((node) => ["battle", "elite"].includes(node.type));
    assert.ok(battleNode);
    chooseRoute(campaign, battleNode.id);
    const prepared = prepareBattle(campaign);
    assert.equal(prepared.roster[0].spd, 45);
    finishBattle(campaign, "victory", campaign.playerHp, [{ type: "battle-end", round: rounds }]);
    assert.equal(campaign.runCharacterState.temporaryEffects[0]?.roundsRemaining, battleIndex === 0 ? 1 : undefined);
    const offer = getCampaignRewardOffer(campaign);
    const claimed = claimCampaignReward(campaign, offer.statChoices.slice(0, 2));
    if (claimed.phase === "bonus") claimCampaignReward(campaign, "skill_upgrade", null, offer.upgradeableSkills[0]);
  }
  assert.equal(campaign.runCharacterState.temporaryEffects.length, 0);

  const { campaign: coffee, node: coffeeQuestion } = campaignForNode(1, "question", () => 0.9);
  assert.equal(travelTo(coffee, coffeeQuestion.id).event.eventId, "coffee_shop");
  assert.ok(resolveCampaignEvent(coffee));
  completeLocation(coffee);
  const coffeeBattle = getRouteOptions(coffee).find((node) => ["battle", "elite"].includes(node.type));
  assert.ok(coffeeBattle);
  chooseRoute(coffee, coffeeBattle.id);
  assert.equal(prepareBattle(coffee).roster[0].def, 120);
  finishBattle(coffee, "defeat", 0);
  assert.equal(coffee.runCharacterState.temporaryEffects.length, 0);
  assert.equal(coffee.runCharacterState.def, 70);
});

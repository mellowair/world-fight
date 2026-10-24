import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_DATA, STARTING_CHARACTERS } from "./characters.js";
import { SKILL_DATA } from "./skills.js";
import { beginJourney, chooseRoute, chooseStartingSkill, claimCampaignReward, completeLocation, completeSettlement, createCampaign, finishBattle, getCampaignRewardOffer, getRouteEnemyGrowth, getRouteMap, getRouteOptions, prepareBattle, resolveCampaignEvent, resolveRouteEvent, selectStartingCharacter, startCampaign, startCampaignEventBattle } from "./campaign.js";
import { upgradeActiveSkill } from "./progression.js";

test("Eren human-form first-pass stats and skill configurations are explicit", () => {
  const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");
  const naruto = STARTING_CHARACTERS.find((entry) => entry.id === "naruto");
  assert.ok(eren);
  assert.deepEqual([eren.id, eren.hp, eren.atk, eren.def, eren.spd], ["eren", 1700, 110, 100, 50]);
  assert.deepEqual([eren.baseStats.maxHp, eren.baseStats.atk, eren.baseStats.def, eren.baseStats.spd], [1700, 110, 100, 50]);
  assert.deepEqual([naruto.hp, naruto.atk, naruto.def, naruto.spd], [1400, 170, 65, 85]);
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

function queued(values, fallback = 0) {
  let index = 0;
  return () => values[index++] ?? fallback;
}

function begin(campaign) {
  assert.equal(startCampaign(campaign), true);
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
  assert.ok(path, `target ${targetId} must be reachable from the current map position`);
  for (const id of path) {
    const node = getRouteMap(campaign).nodes.find((entry) => entry.id === id);
    assert.ok(getRouteOptions(campaign).some((entry) => entry.id === id), `map edge to ${id} must be selectable`);
    const transition = chooseRoute(campaign, id);
    if (id === targetId) return transition;
    if (campaign.status === "event") {
      if (campaign.activeEventType === "campfire") resolveCampaignEvent(campaign, "rest");
      else resolveCampaignEvent(campaign, campaign.pendingEvent.data.skillChoices?.[0] ?? null);
      completeLocation(campaign);
    } else if (campaign.status === "combat") winCurrentBattle(campaign);
    else assert.fail(`unexpected status after choosing ${node.type}: ${campaign.status}`);
  }
  return null;
}

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

  const nextNode = getRouteOptions(campaign).find((node) => node.type === "battle");
  chooseRoute(campaign, nextNode.id);
  const nextHero = prepareBattle(campaign).roster.find((entry) => entry.team === "ally");
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
  assert.ok(eliteNode.step >= 3 && eliteNode.step <= 8);
  const selected = travelTo(campaign, eliteNode.id);
  assert.equal(selected.battle.type, "elite");
  prepareBattle(campaign);
  assert.equal(finishBattle(campaign, "victory", campaign.playerHp - 50).status, "reward");
  const offer = getCampaignRewardOffer(campaign);
  const stat = claimCampaignReward(campaign, offer.statChoices.slice(0, 2));
  assert.equal(stat.phase, "bonus");
  assert.equal(claimCampaignReward(campaign, "skill_upgrade", null, offer.upgradeableSkills[0]).phase, "complete");
  assert.equal(campaign.step, eliteNode.step + 1);
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
    [[450, 80, 20, 50], [450, 80, 20, 50]],
    "guard and mage are the two existing ordinary-enemy templates and share one baseline",
  );
});

test("route growth is applied once to normal and elite battle copies", () => {
  function prepareAtStep(targetStep, randomValue) {
    const campaign = createCampaign(() => randomValue, { seed: Math.floor(randomValue * 1000) });
    begin(campaign);
    const node = getRouteMap(campaign).nodes.find((entry) => entry.step === targetStep && entry.type === "battle");
    assert.ok(node, `expected a normal battle route at step ${targetStep}`);
    const selected = travelTo(campaign, node.id);
    assert.equal(selected.battle.type, "normal");
    return { campaign, prepared: prepareBattle(campaign) };
  }

  const expectedNormal = new Map([[1, [360, 64, 16, 50]], [3, [450, 80, 20, 50]], [6, [562, 92, 22, 50]], [9, [630, 96, 23, 50]]]);
  for (const [step, expected] of expectedNormal) {
    const { prepared } = prepareAtStep(step, 0.3);
    assert.ok(prepared);
    for (const enemy of prepared.roster.filter((character) => character.team === "enemy")) {
      assert.deepEqual([enemy.maxHp, enemy.atk, enemy.def, enemy.spd], expected, `normal step ${step}`);
    }
  }

  const { campaign: eliteCampaign, node: eliteNode } = campaignForNode(3, "elite");
  const eliteSelected = travelTo(eliteCampaign, eliteNode.id);
  const elitePrepared = prepareBattle(eliteCampaign);
  assert.equal(eliteSelected.battle.type, "elite");
  const elite = elitePrepared.roster.find((character) => character.team === "enemy");
  assert.deepEqual([elite.maxHp, elite.atk, elite.def, elite.spd], [900, 115, 35, 65]);
});

test("step nine excludes campfire and elite; step ten presents the connected boss node before battle", () => {
  const campaign = createCampaign(() => 0, { seed: 901 });
  begin(campaign);
  const stepNine = getRouteMap(campaign).nodes.find((node) => node.step === 9 && node.type === "battle");
  assert.ok(stepNine);
  assert.ok(getRouteMap(campaign).nodes.filter((node) => node.step === 9).every((node) => ["battle", "question"].includes(node.type)));
  const battle = travelTo(campaign, stepNine.id);
  assert.equal(battle.battle.type, "normal");
  winCurrentBattle(campaign);
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
  assert.equal(deidara.asset, "assets/deidara-v2/idle/idle_1.png", "the boss battle uses the new Deidara sprite");
  assert.equal(deidara.c0DamagePerRound, 100);
  assert.deepEqual([deidara.maxHp, deidara.atk, deidara.def, deidara.spd], [2200, 120, 40, 75]);
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
  const { campaign, node: question } = campaignForNode(1, "question", () => 0.7);
  assert.equal(travelTo(campaign, question.id).event.eventId, "big_rock");
  assert.ok(resolveCampaignEvent(campaign));
  assert.equal(completeLocation(campaign), "route");

  for (let battleIndex = 0; battleIndex < 3; battleIndex += 1) {
    const battleNode = getRouteOptions(campaign).find((node) => ["battle", "elite"].includes(node.type));
    assert.ok(battleNode);
    chooseRoute(campaign, battleNode.id);
    const prepared = prepareBattle(campaign);
    assert.equal(prepared.roster[0].spd, 65);
    finishBattle(campaign, "victory", campaign.playerHp);
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
  assert.equal(prepareBattle(coffee).roster[0].def, 135);
  finishBattle(coffee, "defeat", 0);
  assert.equal(coffee.runCharacterState.temporaryEffects.length, 0);
  assert.equal(coffee.runCharacterState.def, 65);
});

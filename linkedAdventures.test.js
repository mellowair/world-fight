import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { STARTING_CHARACTERS, EVENT_ENEMY_DATA, STAGE_TWO_NORMAL_ENEMY_BASE_STATS } from "./characters.js";
import { getDodgeChance, getSkillDodgeChance, initializeBattle, executeAttack, simulateBattle } from "./battle.js";
import { createStageTwoTestCampaign } from "./dev/stage2-config.js";
import { claimCampaignSpecialReward, finishBattle, getRouteEnemyGrowth, prepareBattle,
  resolveCampaignEvent, startCampaignEventBattle, advanceEventEpilogue } from "./campaign.js";
import { advanceTemporaryEffectsAfterBattle, applyAdventurePartyOutcome, createAdventureEventResult,
  createRunCharacterState, getAvailableAdventureEventIds, getCampfireOptions, getTemporaryCombatModifiers,
  getTreasureCombatModifiers, grantAdventureSpecialReward, resolveAdventureEvent, upgradeActiveSkill } from "./progression.js";
import { ADVENTURE_EVENT_DATA } from "./skills.js";

const naruto = STARTING_CHARACTERS.find((entry) => entry.id === "naruto");
const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");
const kaneki = STARTING_CHARACTERS.find((entry) => entry.id === "kaneki");
const run = (character = naruto) => createRunCharacterState(character, character.activeSkills[0]);

function eventCampaign(eventId, series = {}, heroId = "naruto", partnerId = "eren", setup = null) {
  const campaign = createStageTwoTestCampaign({ heroId, partnerId, seed: 81 });
  campaign.status = "event";
  campaign.activeEventType = "adventure";
  campaign.activeNode = { id: `linked:${eventId}`, type: "question", status: "in_progress" };
  campaign.runCharacterState.eventSeries = structuredClone(series);
  if (setup) setup(campaign);
  campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, campaign.activeNode.id,
    eventId, () => .1, campaign.partyIds.map((id) => campaign.partyStates[id]), 2);
  assert.ok(campaign.pendingEvent, `${eventId} must be eligible`);
  return campaign;
}

test("series chapters respect choices, stage exclusions, permanent exclusions, skill levels and reset", () => {
  const state = run();
  assert.equal(getAvailableAdventureEventIds(state).includes("sea_beyond_2"), false);
  createAdventureEventResult(state, "sea-a", "sea_beyond", () => 0);
  resolveAdventureEvent(state, "sea-a", "sea_begin");
  resolveAdventureEvent(state, "sea-a", "sea_sacrifice");
  resolveAdventureEvent(state, "sea-a", "sea_finish");
  assert.deepEqual(state.eventSeries.sea.rewards, [{ stat: "atk", amount: 30 }]);
  assert.equal(getAvailableAdventureEventIds(state).includes("sea_beyond"), false);
  assert.equal(getAvailableAdventureEventIds(state).includes("sea_beyond_2"), true);
  const sequel = createAdventureEventResult(state, "sea-b", "sea_beyond_2");
  assert.equal(sequel.name, "海的那边……");
  resolveAdventureEvent(state, "sea-b", "sea_stay");
  assert.equal(state.atk, naruto.atk + 90);
  assert.equal(getAvailableAdventureEventIds(state).includes("sea_beyond_2"), false);

  const declined = run();
  createAdventureEventResult(declined, "decline", "sea_beyond");
  resolveAdventureEvent(declined, "decline", "sea_pass");
  assert.equal(getAvailableAdventureEventIds(declined).some((id) => id.startsWith("sea_beyond")), false);
  assert.deepEqual(run().eventSeries, {}, "a new run starts with no linked progress");

  const scroll = run();
  createAdventureEventResult(scroll, "scroll-a", "scroll", () => 0, [scroll], 1);
  resolveAdventureEvent(scroll, "scroll-a", "scroll_leave");
  assert.equal(getAvailableAdventureEventIds(scroll, 1, [scroll], 1).includes("scroll"), false);
  assert.equal(getAvailableAdventureEventIds(scroll, 11, [scroll], 2).includes("scroll"), true);
  createAdventureEventResult(scroll, "scroll-b", "scroll", () => 0, [scroll], 2);
  resolveAdventureEvent(scroll, "scroll-b", "rasengan");
  assert.equal(getAvailableAdventureEventIds(scroll, 11, [scroll], 2).includes("old_scroll_2"), false);
  for (let level = 2; level <= 4; level += 1) upgradeActiveSkill(scroll, "rasengan", `upgrade-${level}`);
  assert.equal(getAvailableAdventureEventIds(scroll, 11, [scroll], 2).includes("old_scroll_2"), true);
  const second = createAdventureEventResult(scroll, "scroll-c", "old_scroll_2", () => 0, [scroll], 2);
  assert.equal(second.name, "老头的卷轴");
  resolveAdventureEvent(scroll, "scroll-c", "scroll_not_yet");
  assert.equal(getAvailableAdventureEventIds(scroll, 11, [scroll], 2).includes("old_scroll_2"), false);
  assert.equal(getAvailableAdventureEventIds(scroll, 23, [scroll], 3).includes("old_scroll_2"), true);
});

test("linked adventure chapters never count the same series twice in one draw", () => {
  const chapters = [
    ["sea_beyond", "sea_beyond_2"],
    ["scroll", "old_scroll_2"],
    ["coffee_shop", "anteiku_2"],
    ["big_rock", "giant_rock_2"],
  ];
  const state = run();
  const member = run(eren);
  const available = () => getAvailableAdventureEventIds(state, 11, [state, member], 2);
  const assertSingleChapter = () => {
    const ids = available();
    for (const pair of chapters) assert.ok(pair.filter((id) => ids.includes(id)).length <= 1, pair.join(" / "));
  };
  assertSingleChapter();
  state.eventSeries.sea = { chapter1Completed: true, rewards: [{ stat: "atk", amount: 30 }] };
  state.eventSeries.scroll = { chapter1Completed: true };
  state.eventSeries.anteiku = { chapter1Completed: true, chapter2Unlocked: true };
  state.eventSeries.rock = { chapter1Completed: true, chapter2Unlocked: true };
  state.learnedActiveSkills.push("rasengan");
  state.skillLevels.rasengan = 4;
  assertSingleChapter();
  for (const [first, second] of chapters) {
    assert.equal(available().includes(first), false);
    assert.equal(available().includes(second), true);
  }
});

test("Sea sequel uses actual previous gains and its other choice raises each party member's own max HP", () => {
  const a = run();
  a.eventSeries.sea = { chapter1Completed: true, rewards: [{ stat: "spd", amount: 50 }, { stat: "def", amount: 40 }] };
  createAdventureEventResult(a, "sea-extra", "sea_beyond_2");
  const hp = a.currentHp;
  resolveAdventureEvent(a, "sea-extra", "sea_stay");
  assert.equal(a.spd, naruto.spd + 100);
  assert.equal(a.def, naruto.def + 80);
  assert.equal(a.currentHp, hp);
  assert.equal(resolveAdventureEvent(a, "sea-extra", "sea_stay"), false);

  const c = eventCampaign("sea_beyond_2", { sea: { chapter1Completed: true, rewards: [{ stat: "atk", amount: 30 }] } });
  const before = c.partyIds.map((id) => c.partyStates[id].maxHp);
  assert.ok(resolveCampaignEvent(c, "sea_home"));
  assert.deepEqual(c.partyIds.map((id) => c.partyStates[id].maxHp), before.map((hpValue) => hpValue + Math.floor(hpValue * .1)));
  assert.equal(resolveCampaignEvent(c, "sea_home"), false);
});

test("old scroll sequel requires a recipient and grants only their current learned active level sum", () => {
  const c = eventCampaign("old_scroll_2", { scroll: { chapter1Completed: true } }, "naruto", "eren",
    (campaign) => { campaign.partyStates.eren.skillLevels["eren-free-will"] = 4; });
  const mainSpd = c.partyStates.naruto.spd;
  const partnerSpd = c.partyStates.eren.spd;
  assert.equal(resolveCampaignEvent(c, "scroll_mountain").result.continued, true);
  assert.equal(resolveCampaignEvent(c, "scroll_recipient|eren").result.spdGain, 40);
  assert.equal(c.partyStates.eren.spd, partnerSpd + 40);
  assert.equal(c.partyStates.naruto.spd, mainSpd);
  assert.equal(resolveCampaignEvent(c, "scroll_recipient|eren"), false);
});

test("Anteiku and rock share only the selected next-battle effect; stage two gate is independent", () => {
  const c = eventCampaign("coffee_shop");
  for (const state of Object.values(c.partyStates)) state.currentHp = Math.floor(state.maxHp / 2);
  assert.ok(resolveCampaignEvent(c, "coffee_help"));
  assert.equal(c.runCharacterState.eventSeries.anteiku.chapter2Unlocked, true);
  assert.equal(getTemporaryCombatModifiers(c.partyStates.naruto).spd, -20);
  assert.equal(getTemporaryCombatModifiers(c.partyStates.eren).spd, -20);
  assert.equal(getAvailableAdventureEventIds(c.runCharacterState, 12, Object.values(c.partyStates), 2).includes("anteiku_2"), true);
  for (const state of Object.values(c.partyStates)) advanceTemporaryEffectsAfterBattle(state);
  assert.equal(getTemporaryCombatModifiers(c.partyStates.eren).spd, 0);
  const c2 = eventCampaign("anteiku_2", { anteiku: { chapter1Completed: true, chapter2Unlocked: true } });
  for (const state of Object.values(c2.partyStates)) state.currentHp = Math.floor(state.maxHp / 2);
  assert.ok(resolveCampaignEvent(c2, "anteiku_leave"));
  for (const state of Object.values(c2.partyStates)) {
    assert.equal(state.currentHp, Math.floor(state.maxHp / 2) + Math.floor(state.maxHp * .30));
    assert.equal(getTemporaryCombatModifiers(state).def, 30);
  }
  const rock = eventCampaign("big_rock");
  assert.ok(resolveCampaignEvent(rock, "rock_move"));
  assert.equal(getAvailableAdventureEventIds(rock.runCharacterState, 1, Object.values(rock.partyStates), 1).includes("giant_rock_2"), false);
  assert.equal(getAvailableAdventureEventIds(rock.runCharacterState, 12, Object.values(rock.partyStates), 2).includes("giant_rock_2"), true);
});

test("special enemies use their fixed stats or a detached main-character snapshot", () => {
  const suzu = eventCampaign("anteiku_2", { anteiku: { chapter1Completed: true, chapter2Unlocked: true } });
  resolveCampaignEvent(suzu, "anteiku_fight");
  assert.equal(startCampaignEventBattle(suzu).battle.enemies[0], "suzuya");
  const roster = prepareBattle(suzu).roster;
  const enemy = roster.find((entry) => entry.id === "suzuya");
  assert.deepEqual([enemy.maxHp, enemy.atk, enemy.def, enemy.spd], [4400, 420, 145, 90]);
  assert.equal(enemy.everyThirdNormalAttack.maxHpRatio, .08);

  const mimic = eventCampaign("giant_rock_2", { rock: { chapter1Completed: true, chapter2Unlocked: true } }, "kaneki", "eren");
  mimic.partyStates.kaneki.atk += 47;
  mimic.partyStates.kaneki.currentHp -= 113;
  mimic.partyStates.kaneki.skillLevels["kaneki-predator"] = 3;
  mimic.partyStates.kaneki.learnedActiveSkills.push("kaneki-1000-7");
  mimic.partyStates.kaneki.skillLevels["kaneki-1000-7"] = 2;
  resolveCampaignEvent(mimic, "rock_fight");
  assert.equal(startCampaignEventBattle(mimic).battle.enemies[0], "six_ear");
  const prepared = prepareBattle(mimic);
  const main = prepared.roster.find((entry) => entry.id === "kaneki");
  const copy = prepared.roster.find((entry) => entry.id === "six_ear");
  assert.equal(copy.team, "enemy");
  assert.deepEqual([copy.maxHp, copy.currentHp, copy.atk, copy.def, copy.spd, copy.critChance,
    copy.passiveSkillId, copy.skills[0].level, copy.asset, copy.visualId],
    [main.maxHp, main.currentHp, main.atk, main.def, main.spd, main.critChance,
      main.passiveSkillId, main.skills[0].level, main.asset, "kaneki"]);
  assert.notEqual(prepared.combatOptions.runCharacterStates.six_ear, mimic.partyStates.kaneki);
  assert.deepEqual(copy.skills.map((skill) => [skill.id, skill.level]), main.skills.map((skill) => [skill.id, skill.level]));
  prepared.combatOptions.runCharacterStates.six_ear.atk = 1;
  copy.currentHp = 1;
  assert.notEqual(mimic.partyStates.kaneki.atk, 1);
  assert.notEqual(mimic.partyStates.kaneki.currentHp, 1);
  assert.equal(EVENT_ENEMY_DATA.six_ear.hp, 1, "the source template remains a placeholder");
});

test("Jason adds an independent HP-based hit on every third landed ordinary attack", () => {
  const enemy = { ...EVENT_ENEMY_DATA.suzuya, hp: 1000, atk: 80, def: 10, spd: 20 };
  const ally = { id: "target", name: "目标", team: "ally", row: "front", hp: 2000, atk: 10, def: 300, spd: 1, rosterOrder: 0 };
  const fight = simulateBattle([enemy, { ...ally, hp: 3000, atk: 0, def: 300, spd: 1 }], () => .9);
  const procs = fight.events.filter((entry) => entry.type === "jason-damage");
  assert.ok(procs.length >= 2);
  assert.deepEqual(procs.slice(0, 2).map((entry) => entry.attackCount), [3, 6]);
  assert.ok(procs.every((entry) => entry.attackCount % 3 === 0 && entry.requested === 240));
  assert.ok(procs.every((entry) => entry.actualDamage <= entry.requested));
});

test("special rewards are one-recipient, post-victory, and campfire/anti-dodge modifiers are real", () => {
  const c = eventCampaign("anteiku_2", { anteiku: { chapter1Completed: true, chapter2Unlocked: true } });
  resolveCampaignEvent(c, "anteiku_fight"); startCampaignEventBattle(c); prepareBattle(c);
  assert.equal(finishBattle(c, "victory", c.playerHp).next, "reward");
  assert.equal(c.rewardPhase, "event_epilogue");
  assert.equal(advanceEventEpilogue(c), true);
  assert.equal(advanceEventEpilogue(c), false);
  assert.equal(claimCampaignSpecialReward(c, "eren").id, "drip_coffee");
  assert.equal(claimCampaignSpecialReward(c, "naruto"), false);
  assert.equal(getCampfireOptions(c.partyStates.eren)[0].healAmount, Math.floor(c.partyStates.eren.maxHp * .4));
  assert.equal(getCampfireOptions(c.partyStates.naruto)[0].healAmount, Math.floor(c.partyStates.naruto.maxHp * .25));
  c.partyStates.eren.permanentEffects.push({ id: "stone_mask" });
  assert.equal(getCampfireOptions(c.partyStates.eren)[0].healAmount, 0);

  const main = run(), partner = run(eren);
  assert.ok(grantAdventureSpecialReward(main, "rock-reward", "six_ear_true_form"));
  assert.equal(grantAdventureSpecialReward(main, "rock-reward", "six_ear_true_form"), false);
  assert.equal(getTreasureCombatModifiers(main).unavoidableAttack, true);
  assert.equal(getTreasureCombatModifiers(partner).unavoidableAttack, false);
  const attacker = { id: "a", team: "ally", hp: 100, atk: 20, def: 1, spd: 1, critChance: 0, unavoidableAttack: true };
  const target = { id: "b", team: "enemy", hp: 100, atk: 1, def: 1, spd: 900, dodgeRateBonus: 1 };
  const state = initializeBattle([attacker, target]);
  assert.ok(getDodgeChance(state.characters[1]) > 0);
  assert.ok(getSkillDodgeChance(state.characters[1]) > 0);
  assert.equal(executeAttack(state, state.characters[0], state.characters[1], () => 0, { skill: null }).dodged, false);
  const skillState = initializeBattle([{ ...attacker, id: "skill-a" }, { ...target, id: "skill-b" }]);
  assert.equal(executeAttack(skillState, skillState.characters[0], skillState.characters[1], () => 0,
    { skill: { id: "test-active", name: "测试技能", effectType: "damage", multiplier: 1 } }).dodged, false);
});

test("event option results remain hidden in UI and the available sea image is a real local asset", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(app, /for \(const choice of choices\) choice\.description = ""/);
  assert.match(app, /darkScene: true/);
  assert.match(style, /\.decision-screen\.is-dark-epilogue/);
  assert.ok(existsSync(new URL(`./${ADVENTURE_EVENT_DATA.sea_beyond_2.image}`, import.meta.url)));
  assert.equal(ADVENTURE_EVENT_DATA.scroll.name, "老头的卷轴");
  assert.equal(ADVENTURE_EVENT_DATA.coffee_shop.name, "安定区");
  assert.equal(ADVENTURE_EVENT_DATA.big_rock.name, "路遇巨石");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAMPAIGN_BATTLES, CHARACTER_DATA, STARTING_CHARACTERS } from "./characters.js";
import { ATTRIBUTE_UPGRADES, ADVENTURE_EVENT_DATA, SKILL_DATA } from "./skills.js";
import {
  applyAdventureBattleReward, applyBattleReward, applyStatUpgrade, completeAdventureBattle,
  createAdventureEventResult, createBattleRewardOffer, createRunCharacterState,
  createStatUpgradeChoices, evaluatePassive, getCampfireOptions, getSkillAtLevel,
  advanceTemporaryEffectsAfterBattle, chooseAdventureEventId, getAvailableAdventureEventIds,
  getTemporaryCombatModifiers, getTemporaryEffectDisplayRows, getTemporaryEffects, getUnlearnedActiveSkills, getUpgradeableSkills, healRunCharacter, learnActiveSkill,
  resolveAdventureEvent, resolveCampfire, startAdventureBattle, upgradeActiveSkill,
} from "./progression.js";
import { createCampaign, selectStartingCharacter, startCampaign } from "./campaign.js";
import { calculateDamage } from "./battle.js";

const naruto = STARTING_CHARACTERS.find((character) => character.id === "naruto");
const makeNaruto = () => createRunCharacterState(naruto);

test("run state migrates legacy stats without mutating base character data", () => {
  const run = makeNaruto();
  assert.deepEqual([run.maxHp, run.currentHp, run.atk, run.def, run.spd, run.critRate, run.critMultiplier], [1600, 1600, 170, 70, 85, 0.05, 1.5]);
  assert.deepEqual(run.learnedActiveSkills, ["shadow-clone-rush"]);
  assert.equal(run.skillLevels["shadow-clone-rush"], 1);
  assert.equal(run.passiveSkillId, "jinchuriki");
  run.atk += 10;
  assert.equal(naruto.atk, 170);
});

test("requested first-stage hero and existing enemy baseline stats are explicit", () => {
  assert.deepEqual([naruto.baseStats.maxHp, naruto.baseStats.atk, naruto.baseStats.def, naruto.baseStats.spd], [1600, 170, 70, 85]);
  const guard = CHARACTER_DATA.find((character) => character.id === "guard");
  const mage = CHARACTER_DATA.find((character) => character.id === "mage");
  assert.deepEqual([guard.hp, guard.atk, guard.def, guard.spd], [500, 60, 40, 30]);
  assert.deepEqual([mage.hp, mage.atk, mage.def, mage.spd], [400, 70, 20, 30]);
  const eren = STARTING_CHARACTERS.find((character) => character.id === "eren");
  assert.deepEqual([eren.baseStats.maxHp, eren.baseStats.atk, eren.baseStats.def, eren.baseStats.spd], [1900, 120, 90, 50]);
  assert.deepEqual(eren.activeSkills, ["eren-free-will", "eren-tatakae"]);
  assert.equal(eren.passiveSkillId, "eren-2000-years");
  assert.deepEqual([SKILL_DATA[eren.passiveSkillId].type, SKILL_DATA[eren.activeSkills[0]].type, SKILL_DATA[eren.activeSkills[1]].type], ["passive", "active", "active"]);
});

test("playable and battle character data expose stable skill and position ids", () => {
  for (const character of [...CHARACTER_DATA, ...STARTING_CHARACTERS]) {
    assert.ok(character.position === "front" || character.position === "back");
    assert.ok(character.baseStats.maxHp > 0 && character.baseStats.critRate >= 0 && character.baseStats.critMultiplier >= 1);
    assert.ok(Array.isArray(character.activeSkills));
    assert.ok(character.activeSkills.length === 0 || character.activeSkills.length === 2);
    assert.ok(character.activeSkills.every((id) => SKILL_DATA[id]?.type === "active"));
    if (character.passiveSkillId) assert.equal(SKILL_DATA[character.passiveSkillId]?.type, "passive");
  }
  assert.equal(CAMPAIGN_BATTLES.length, 4, "the obsolete generic elite guard is removed; the two configured elite templates are separate");
});

test("stat reward offers are three unique stable choices and each stat applies correctly once", () => {
  const effects = Object.fromEntries(ATTRIBUTE_UPGRADES.map((entry) => [entry.id, entry.effects]));
  for (const id of Object.keys(effects)) {
    const run = makeNaruto();
    run.currentHp = 600;
    const before = { maxHp: run.maxHp, atk: run.atk, def: run.def, spd: run.spd };
    const offer = createStatUpgradeChoices(run, "battle:1", () => id === "max_hp" ? 0.999 : 0);
    assert.equal(offer.choices.length, 3);
    assert.equal(new Set(offer.choices).size, 3);
    assert.ok(offer.choices.includes(id));
    assert.deepEqual(createStatUpgradeChoices(run, "battle:1", () => 0.1), offer);
    const oldAttackDamage = calculateDamage({ atk: run.atk }, { def: 60 });
    assert.ok(applyStatUpgrade(run, "battle:1", id));
    if (id === "attack") assert.ok(calculateDamage({ atk: run.atk }, { def: 60 }) > oldAttackDamage);
    assert.equal(applyStatUpgrade(run, "battle:1", id), false);
    for (const [stat, amount] of Object.entries(effects[id])) {
      if (stat === "currentHp") assert.equal(run.currentHp, 600);
      else if (stat === "maxHp") assert.equal(run.maxHp, 1700);
      else assert.equal(run[stat], before[stat] + amount);
    }
    assert.ok(run.currentHp <= run.maxHp);
  }
});

test("Fate Gate arms only a next-real-battle skill guarantee and no-skill runs remain safe", () => {
  const run = makeNaruto();
  const event = createAdventureEventResult(run, "fate-node", "fate_gate", () => 0);
  assert.deepEqual(event.data.skillChoices, ["shadow-clone-rush"]);
  const armed = resolveAdventureEvent(run, "fate-node", "fate_accept");
  assert.equal(armed.result.guaranteeArmed, true);
  assert.deepEqual(run.nextBattleSkillGuarantee, { sourceId: "fate-node", skillIds: ["shadow-clone-rush"] });
  assert.equal(resolveAdventureEvent(run, "fate-node", "fate_accept"), false, "event resolution is idempotent");

  const unskilled = createRunCharacterState(STARTING_CHARACTERS.find((character) => character.id === "eren"), null);
  const noSkillEvent = createAdventureEventResult(unskilled, "empty-fate", "fate_gate", () => 0);
  assert.deepEqual(noSkillEvent.data.skillChoices, []);
  const skipped = resolveAdventureEvent(unskilled, "empty-fate", "fate_accept");
  assert.equal(skipped.result.noEligibleSkills, true);
  assert.equal(unskilled.nextBattleSkillGuarantee, null);
});

test("HP upgrade raises max HP without healing and preserves current HP", () => {
  const run = makeNaruto();
  run.currentHp = 1195;
  const { choices } = createStatUpgradeChoices(run, "offer", () => 0.999);
  assert.ok(choices.includes("max_hp"));
  applyStatUpgrade(run, "offer", "max_hp");
  assert.equal(run.currentHp, 1195);
  assert.equal(run.maxHp, 1700);
  assert.ok(run.currentHp <= run.maxHp);
});

test("new campaign selection starts fresh growth state and accepts a compatible selected skill", () => {
  const campaign = createCampaign(() => 0);
  startCampaign(campaign);
  assert.ok(selectStartingCharacter(campaign, "naruto", "rasengan"));
  assert.deepEqual(campaign.runCharacterState.learnedActiveSkills, ["rasengan"]);
  assert.equal(campaign.runCharacterState.maxHp, 1600);
  const second = createCampaign(() => 0);
  startCampaign(second);
  selectStartingCharacter(second, "naruto");
  assert.deepEqual(second.runCharacterState.learnedActiveSkills, ["shadow-clone-rush"]);
  assert.deepEqual(second.runCharacterState.consumedActions, []);
  assert.equal(selectStartingCharacter(createCampaign(), "naruto", "firebolt"), false);
});

test("skill scroll learns only a second eligible active skill once", () => {
  const run = makeNaruto();
  assert.deepEqual(getUnlearnedActiveSkills(run), ["rasengan"]);
  const event = createAdventureEventResult(run, "scroll-1", "scroll");
  assert.equal(event.type, "learn_skill");
  assert.ok(resolveAdventureEvent(run, "scroll-1", "rasengan"));
  assert.deepEqual(run.learnedActiveSkills, ["shadow-clone-rush", "rasengan"]);
  assert.equal(run.skillLevels.rasengan, 1);
  assert.equal(resolveAdventureEvent(run, "scroll-1", "rasengan"), false);
  assert.deepEqual(getUnlearnedActiveSkills(run), []);
  assert.equal(createAdventureEventResult(run, "scroll-2", "scroll"), null);
});

test("skill upgrades require learning, follow configured levels through Lv.4, and stop there", () => {
  const run = makeNaruto();
  assert.equal(upgradeActiveSkill(run, "rasengan", "invalid"), false);
  for (let level = 2; level <= 4; level += 1) assert.equal(upgradeActiveSkill(run, "shadow-clone-rush", `campfire-${level}`).level, level);
  assert.equal(getSkillAtLevel(run, "shadow-clone-rush").specialEffect.kind, "clone_afterimage");
  assert.equal(upgradeActiveSkill(run, "shadow-clone-rush", "campfire-5"), false);
  assert.ok(getUpgradeableSkills(run).every((id) => id !== "shadow-clone-rush"));
});

test("skill upgrades and learning cannot be repeated under the same source", () => {
  const run = makeNaruto();
  assert.ok(upgradeActiveSkill(run, "shadow-clone-rush", "training"));
  assert.equal(upgradeActiveSkill(run, "shadow-clone-rush", "training"), false);
  assert.ok(learnActiveSkill(run, "rasengan", "scroll"));
  assert.equal(learnActiveSkill(run, "rasengan", "scroll-again"), false);
  assert.equal(learnActiveSkill(run, "firebolt", "scroll-third"), false);
});

test("legacy passive evaluator remains once-per-battle for passive skills using damage hooks", () => {
  const run = makeNaruto();
  run.passiveSkillId = "ninja-instinct";
  const first = evaluatePassive(run, "before_damage", { battleId: "battle-1", damage: 100 });
  assert.equal(first.finalDamage, 92);
  assert.equal(evaluatePassive(run, "before_damage", { battleId: "battle-1", damage: 100 }), null);
  assert.equal(evaluatePassive(run, "before_damage", { battleId: "battle-2", damage: 100 }).finalDamage, 92);
  assert.equal(run.currentHp, 1600, "passive evaluation returns an effect but never recursively applies combat damage");
  assert.equal(evaluatePassive(run, "before_attack", { battleId: "battle-1", damage: 100 }), null);
});

test("Naruto skill levels carry the requested clone count, damage multiplier, and trigger chance", () => {
  const expected = [[1, 1.3, 0.45], [2, 1.6, 0.50], [3, 1.9, 0.55], [4, 2.2, 0.65]];
  for (const [level, multiplier, chance] of expected) {
    assert.equal(SKILL_DATA["shadow-clone-rush"].levels[level].multiplier, multiplier);
    assert.equal(SKILL_DATA["shadow-clone-rush"].levels[level].cloneCount, level);
    assert.equal(SKILL_DATA["shadow-clone-rush"].levels[level].chance, chance);
  }
  assert.equal(SKILL_DATA["shadow-clone-rush"].maxLevel, 4);
});

test("Rasengan levels change trigger chance only and keep the speed formula", () => {
  const chances = [0.20, 0.24, 0.28, 0.32];
  const coefficients = [0.003, 0.006, 0.009, 0.012];
  const cloneMultipliers = [1.3, 1.6, 1.9, 2.2];
  for (let level = 1; level <= 4; level += 1) {
    const effect = SKILL_DATA.rasengan.levels[level];
    assert.equal(effect.chance, chances[level - 1]);
    assert.deepEqual(effect.multiplierFormula, { base: 1, stat: "spd", coefficient: coefficients[level - 1] });
    assert.equal(effect.multiplierFormula.base + 100 * effect.multiplierFormula.coefficient, cloneMultipliers[level - 1]);
    assert.ok(effect.multiplierFormula.base + 120 * effect.multiplierFormula.coefficient > cloneMultipliers[level - 1]);
    assert.ok(effect.multiplierFormula.base + 80 * effect.multiplierFormula.coefficient < cloneMultipliers[level - 1]);
  }
});

test("temporary-effect view returns only active effects and does not consume their duration", () => {
  const run = makeNaruto();
  run.temporaryEffects = [
    { name: "巨石减益", stat: "spd", amount: -40, roundsRemaining: 3, sourceId: "rock" },
    { name: "咖啡店增益", stat: "def", amount: 50, battlesRemaining: 1, sourceId: "coffee" },
    { name: "expired", stat: "spd", amount: -5, battlesRemaining: 0 },
  ];
  const shown = getTemporaryEffects(run);
  assert.deepEqual(shown.map(({ name, amount, roundsRemaining, battlesRemaining }) => [name, amount, roundsRemaining ?? battlesRemaining]), [
    ["巨石减益", -40, 3], ["咖啡店增益", 50, 1],
  ]);
  getTemporaryEffects(run);
  getTemporaryCombatModifiers(run);
  assert.deepEqual(run.temporaryEffects.map((effect) => effect.roundsRemaining ?? effect.battlesRemaining), [3, 1, 0]);
  assert.deepEqual(getTemporaryEffectDisplayRows(run), [
    { id: "big_rock", name: "巨石减益", statName: "速度", amount: -40, amountText: "-40", durationText: "剩余 3 个战斗回合", polarity: "debuff" },
    { id: "coffee_shop", name: "咖啡店增益", statName: "防御", amount: 50, amountText: "+50", durationText: "下一场战斗生效", polarity: "buff" },
  ]);
  run.temporaryEffects.push({ statusId: "death_note", name: "死亡笔记", effectKind: "damage_dealt_multiplier", multiplier: 2, battlesRemaining: 2 });
  const deathNoteRow = getTemporaryEffectDisplayRows(run).find(row => row.id === "death_note");
  assert.deepEqual(deathNoteRow, { id: "death_note", name: "死亡笔记", statName: "造成伤害", amount: undefined, amountText: "×2", durationText: "剩余 2 场战斗", polarity: "buff" });
  assert.equal(run.temporaryEffects.find(effect => effect.statusId === "death_note").battlesRemaining, 2, "render data does not consume the effect duration");
});

test("temporary effects power clickable status icons, while character details omit modifier rows", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(app, /getTemporaryEffectDisplayRows\(campaign\.runCharacterState\)/);
  assert.match(app, /function renderAllyStatusIcons\(\)/);
  assert.match(app, /assets\/events\/event_coffee_shop\.png/);
  assert.match(app, /assets\/events\/event_big_rock\.png/);
  assert.match(app, /assets\/events\/event_death_note\.png/);
  assert.match(app, /受到伤害.*造成伤害|isDeathNote/);
  assert.match(app, /decisionChoice\(id, "跟随老头前往妙蛙山"/);
  assert.match(app, /record\.data\.phase === "intro"/);
  assert.match(app, /sea_begin/);
  assert.match(app, /renderEventResult\(result\)/);
  assert.match(app, /assets\/jinchuriki-status\.svg/);
  assert.match(app, /assets\/c0-art-status\.svg/);
  assert.match(app, /data-status-id/);
  assert.match(html, /id="ally-status-icons"/);
  assert.match(html, /id="ally-status-detail"/);
  assert.match(css, /\.ally-status-icon\.is-debuff/);
  assert.match(css, /\.ally-status-icon\.is-buff/);
  assert.doesNotMatch(app, /detail-temporary|暂无临时效果/);
  assert.doesNotMatch(app, /防御 DEF · 当前\/基础|速度 SPD · 当前\/基础/);
  assert.match(app, /characterDialog\.open && detailCharacterId/);
  assert.match(readFileSync(new URL("./assets/jinchuriki-status.svg", import.meta.url), "utf8"), /shape-rendering="crispEdges"/);
  assert.match(readFileSync(new URL("./assets/c0-art-status.svg", import.meta.url), "utf8"), /shape-rendering="crispEdges"/);
});

test("skill upgrades expose the next level's actual chance and damage values", () => {
  const run = makeNaruto();
  const before = getSkillAtLevel(run, "shadow-clone-rush");
  assert.equal(before.chance, 0.45);
  assert.equal(before.multiplier, 1.3);
  upgradeActiveSkill(run, "shadow-clone-rush", "clone-upgrade");
  const after = getSkillAtLevel(run, "shadow-clone-rush");
  assert.equal(after.level, 2);
  assert.equal(after.chance, 0.50);
  assert.equal(after.multiplier, 1.6);
  assert.equal(after.cloneCount, 2);
});

test("campfire rest heals 25 percent of max HP, clamps, and settles once", () => {
  const run = makeNaruto();
  run.currentHp = 1000;
  const options = getCampfireOptions(run);
  assert.equal(options[0].healAmount, 400);
  assert.equal(resolveCampfire(run, "step-3-choice-1", "rest").restored, 400);
  assert.equal(run.currentHp, 1400);
  assert.equal(resolveCampfire(run, "step-3-choice-1", "rest"), false);
  run.currentHp = 1400;
  assert.equal(healRunCharacter(run, 500, "cap-test").currentHp, 1600);
  assert.equal(healRunCharacter(run, 500, "cap-test"), null);
});

test("campfire upgrades only learned skills and disables when they are all max level", () => {
  const run = makeNaruto();
  const option = getCampfireOptions(run)[1];
  assert.equal(option.enabled, true);
  assert.equal(option.skills[0].currentLevel, 1);
  assert.ok(resolveCampfire(run, "fire-1", "skill_upgrade", "shadow-clone-rush"));
  assert.equal(run.skillLevels["shadow-clone-rush"], 2);
  assert.equal(resolveCampfire(run, "fire-1", "skill_upgrade", "shadow-clone-rush"), false);
  const full = makeNaruto();
  for (let i = 2; i <= 4; i += 1) upgradeActiveSkill(full, "shadow-clone-rush", `level-${i}`);
  assert.equal(getCampfireOptions(full)[1].enabled, false);
  assert.ok(getCampfireOptions(full)[1].reason);
  assert.equal(resolveCampfire(full, "fire-full", "skill_upgrade", "shadow-clone-rush"), false);
});

test("battle reward offers persist three options, apply two stats, and block duplicate claims", () => {
  const run = makeNaruto();
  const offer = createBattleRewardOffer(run, "battle-7", "normal", () => 0.2);
  assert.equal(offer.statChoices.length, 3);
  assert.equal(offer.requiredStatSelections, 2);
  assert.deepEqual(createBattleRewardOffer(run, "battle-7", "normal", () => 0.9), offer);
  const result = applyBattleReward(run, "battle-7", offer.statChoices.slice(0, 2));
  assert.equal(result.stat.length, 2);
  assert.deepEqual(run.rewardOffers["battle-7"].selectedStatIds, offer.statChoices.slice(0, 2));
  assert.equal(applyBattleReward(run, "battle-7", offer.statChoices.slice(0, 2)), false);
  const chooseTwoRun = makeNaruto();
  const chooseTwo = createBattleRewardOffer(chooseTwoRun, "battle-8", "normal", () => 0.2);
  assert.equal(applyBattleReward(chooseTwoRun, "battle-8", chooseTwo.statChoices[0]), false);
  assert.equal(createBattleRewardOffer(run, "boss-10", "boss"), null);
});

test("elite victory reward grants two stat upgrades plus one skill upgrade", () => {
  const run = makeNaruto();
  const offer = createBattleRewardOffer(run, "elite-1", "elite", () => 0.2);
  assert.deepEqual(offer.extraChoices, ["skill_upgrade"]);
  const result = applyBattleReward(run, "elite-1", offer.statChoices.slice(0, 2), "skill_upgrade", "shadow-clone-rush");
  assert.equal(result.stat.length, 2);
  assert.ok(result.bonus);
  assert.equal(run.skillLevels["shadow-clone-rush"], 2);
  assert.equal(applyBattleReward(run, "elite-1", offer.statChoices.slice(0, 2), "skill_upgrade", "shadow-clone-rush"), false);
  const maxed = makeNaruto();
  for (let i = 2; i <= 4; i += 1) upgradeActiveSkill(maxed, "shadow-clone-rush", `max-${i}`);
  assert.deepEqual(createBattleRewardOffer(maxed, "elite-2", "elite").extraChoices, []);
});

test("adventure candidates are equally sampled and omit a fully learned scroll", () => {
  const run = makeNaruto();
  assert.deepEqual(getAvailableAdventureEventIds(run), ["scroll", "sea_beyond", "death_note", "fate_gate", "fall_rock", "big_rock", "coffee_shop"]);
  assert.deepEqual(getAvailableAdventureEventIds(run).map((_, i) => chooseAdventureEventId(run, () => i / 7)), getAvailableAdventureEventIds(run));
  assert.deepEqual(getAvailableAdventureEventIds(run, 8), ["scroll", "sea_beyond", "death_note", "fate_gate", "fall_rock", "big_rock", "coffee_shop", "giant_encirclement"]);
  createAdventureEventResult(run, "sea-once", "sea_beyond", () => 0);
  assert.equal(getAvailableAdventureEventIds(run).includes("sea_beyond"), false, "once discovered, it leaves this run's event pool");
  assert.equal(createAdventureEventResult(run, "sea-second", "sea_beyond"), null, "a second node cannot instantiate it in the same run");
  learnActiveSkill(run, "rasengan", "learn-second");
  assert.deepEqual(getAvailableAdventureEventIds(run), ["death_note", "fate_gate", "fall_rock", "big_rock", "coffee_shop"]);
  assert.deepEqual(getAvailableAdventureEventIds(run).map((_, i) => chooseAdventureEventId(run, () => i / 5)), getAvailableAdventureEventIds(run));
});

test("fall rock runs three one-time stages and then leaves this run's event pool", () => {
  const run = makeNaruto();
  run.currentHp = 800;
  const event = createAdventureEventResult(run, "fall-low", "fall_rock");
  assert.equal(event.description, ADVENTURE_EVENT_DATA.fall_rock.description);
  assert.equal(event.data.newMaxHp, 1520);
  assert.equal(resolveAdventureEvent(run, "fall-low").result.currentHp, 800);
  assert.equal(run.maxHp, 1520);
  assert.equal(run.fallRockCount, 1);
  assert.equal(resolveAdventureEvent(run, "fall-low"), false);
  run.atk = 201;
  const second = createAdventureEventResult(run, "fall-second", "fall_rock");
  assert.equal(second.description, "再次来到酋长岩，在掉落的途中你领悟到了勇气的真谛");
  assert.deepEqual(createAdventureEventResult(run, "fall-second", "fall_rock"), second);
  assert.equal(resolveAdventureEvent(run, "fall-second").result.attackGain, 30);
  assert.deepEqual([run.maxHp, run.currentHp, run.atk, run.fallRockCount], [1444, 800, 231, 2]);
  assert.equal(resolveAdventureEvent(run, "fall-second"), false);
  const third = createAdventureEventResult(run, "fall-third", "fall_rock");
  assert.equal(third.description, "你终于登上了酋长岩，此刻你一览众山小");
  const final = resolveAdventureEvent(run, "fall-third");
  assert.ok(Math.abs(final.result.critRateGain - 0.15) < 1e-9);
  assert.deepEqual([run.maxHp, run.atk, run.fallRockCount, run.fallRockCompleted], [1444, 231, 3, true]);
  assert.ok(Math.abs(run.critRate - 0.20) < 1e-9);
  assert.equal(resolveAdventureEvent(run, "fall-third"), false);
  assert.equal(getAvailableAdventureEventIds(run).includes("fall_rock"), false);
  assert.equal(createAdventureEventResult(run, "fall-fourth", "fall_rock"), null);
  assert.ok(getAvailableAdventureEventIds(run).includes("coffee_shop"));
  const restored = structuredClone(run);
  delete restored.fallRockCount;
  delete restored.fallRockCompleted;
  assert.equal(getAvailableAdventureEventIds(restored).includes("fall_rock"), false, "restored legacy state derives completed visits");
  assert.equal(getAvailableAdventureEventIds(makeNaruto()).includes("fall_rock"), true, "new runs reset the event");
});

test("fall rock clamps HP only when needed and retains all critical gains below the new cap", () => {
  const high = makeNaruto();
  high.currentHp = 1400;
  createAdventureEventResult(high, "fall-high", "fall_rock");
  resolveAdventureEvent(high, "fall-high");
  assert.deepEqual([high.maxHp, high.currentHp], [1520, 1400]);
  high.critRate = 0.45;
  createAdventureEventResult(high, "fall-second", "fall_rock");
  resolveAdventureEvent(high, "fall-second");
  createAdventureEventResult(high, "fall-third", "fall_rock");
  resolveAdventureEvent(high, "fall-third");
  assert.equal(high.critRate, 0.6);
});

test("big rock applies SPD minus 40 for three actual battle rounds and ignores noncombat actions", () => {
  const run = makeNaruto();
  const event = createAdventureEventResult(run, "rock-1", "big_rock");
  assert.deepEqual(createAdventureEventResult(run, "rock-1", "big_rock"), event);
  resolveAdventureEvent(run, "rock-1");
  assert.equal(resolveAdventureEvent(run, "rock-1"), false);
  assert.equal(getTemporaryCombatModifiers(run).spd, -40);
  getTemporaryEffectDisplayRows(run);
  createAdventureEventResult(run, "coffee-noncombat", "coffee_shop");
  resolveAdventureEvent(run, "coffee-noncombat");
  assert.equal(run.temporaryEffects.find((effect) => effect.statusId === "big_rock").roundsRemaining, 3, "viewing status and completing a noncombat event do not consume rounds");
  advanceTemporaryEffectsAfterBattle(run, 2);
  assert.equal(run.temporaryEffects.find((effect) => effect.statusId === "big_rock").roundsRemaining, 1);
  assert.equal(getTemporaryCombatModifiers(run).spd, -40);
  advanceTemporaryEffectsAfterBattle(run, 1);
  assert.equal(run.temporaryEffects.length, 0);
  assert.equal(getTemporaryCombatModifiers(run).spd, 0);
  assert.equal(run.spd, 85, "base speed is never changed by the effect");
});

test("coffee shop applies DEF plus 50 only until the next battle ends", () => {
  const run = makeNaruto();
  const event = createAdventureEventResult(run, "coffee-1", "coffee_shop");
  assert.equal(resolveAdventureEvent(run, "coffee-1").result.effect.amount, 50);
  assert.equal(resolveAdventureEvent(run, "coffee-1"), false);
  assert.equal(getTemporaryCombatModifiers(run).def, 50);
  advanceTemporaryEffectsAfterBattle(run);
  assert.equal(getTemporaryCombatModifiers(run).def, 0);
  assert.equal(run.def, 70, "the base stat remains unchanged");
});

test("event images point to copied local resources and decision UI renders them", () => {
  assert.equal(Object.keys(ADVENTURE_EVENT_DATA).length, 8);
  const app=readFileSync(new URL("./app.js",import.meta.url),"utf8"), html=readFileSync(new URL("./index.html",import.meta.url),"utf8"), css=readFileSync(new URL("./style.css",import.meta.url),"utf8");
  assert.match(app,/eventImage\.src = image/); assert.match(html,/id="decision-event-image"/); assert.match(css,/\.decision-event-image\[hidden\]\s*\{\s*display:\s*none/);
  for (const id of ["sea_beyond","death_note","fate_gate","giant_encirclement"]) { const event=ADVENTURE_EVENT_DATA[id]; assert.ok(event.image.startsWith("assets/events/")); const png=readFileSync(new URL("./"+event.image,import.meta.url)); assert.equal(png.toString("ascii",1,4),"PNG"); assert.ok(png.readUInt32BE(16)>=256); assert.ok(png.readUInt32BE(20)>=256); }
});

test("sea beyond uses three percentage sacrifice tiers and random stat rewards, then applies selected choices once", () => {
 const eren=createRunCharacterState(STARTING_CHARACTERS.find(entry=>entry.id==="eren"),"eren-free-will");
 let rollIndex=0; const rolls=[0,0.34,0.67];
 const source="sea-chain", rec=createAdventureEventResult(eren,source,"sea_beyond",()=>rolls[rollIndex++]);
 assert.equal(rec.data.phase,"intro"); assert.equal(rec.data.tiers.length,3);
 assert.equal(rec.data.startingMaxHp,1900);
 assert.deepEqual(rec.data.tiers.map(tier=>tier.hpLossFraction),[0.2,0.3,0.4]);
 assert.deepEqual(rec.data.tiers.map(({rewardStat,rewardAmount})=>({stat:rewardStat,amount:rewardAmount})),[
   {stat:"atk",amount:30},{stat:"def",amount:60},{stat:"spd",amount:100},
 ]);
 const rewardTables=[
   {roll:0,expected:[30,50,70]},
   {roll:0.5,expected:[40,60,90]},
   {roll:0.9,expected:[50,70,100]},
 ];
 for (const {roll,expected} of rewardTables) {
   const sample=createAdventureEventResult(makeNaruto(),`sea-table-${roll}`,"sea_beyond",()=>roll);
   assert.deepEqual(sample.data.tiers.map(tier=>tier.rewardAmount),expected);
 }
 assert.deepEqual(createAdventureEventResult(eren,source,"sea_beyond",()=>0),rec,"rerendering reuses the same choices and rewards");
 const initialMax=eren.maxHp, initialAtk=eren.atk, initialDef=eren.def, initialSpd=eren.spd;
 assert.equal(resolveAdventureEvent(eren,source,"sea_begin").status,"pending");
 assert.equal(resolveAdventureEvent(eren,source,"sea_sacrifice").status,"pending");
 assert.equal(resolveAdventureEvent(eren,source,"sea_sacrifice").status,"pending");
 assert.equal(eren.maxHp,initialMax,"intermediate selections do not apply effects before results are shown");
 const completed=resolveAdventureEvent(eren,source,"sea_finish");
 assert.equal(completed.status,"completed"); assert.equal(completed.result.hpLoss,950); assert.equal(completed.result.hpLossPercent,50);
 assert.deepEqual(completed.result.gains,[{stat:"atk",amount:30},{stat:"def",amount:60}]);
 assert.equal(eren.maxHp,initialMax-950); assert.equal(eren.currentHp,initialMax-950);
 assert.equal(eren.atk,initialAtk+30); assert.equal(eren.def,initialDef+60,"the legacy extra Eren DEF reward is removed"); assert.equal(eren.spd,initialSpd);
 assert.equal(resolveAdventureEvent(eren,source,"sea_sacrifice"),false,"completed chains cannot be claimed twice");
 assert.equal(rec.data.tiers.length,3);
 const narutoRun=makeNaruto();
 const allThree=createAdventureEventResult(narutoRun,"sea-all","sea_beyond",()=>0);
 resolveAdventureEvent(narutoRun,"sea-all","sea_begin");
 resolveAdventureEvent(narutoRun,"sea-all","sea_sacrifice");
 resolveAdventureEvent(narutoRun,"sea-all","sea_sacrifice");
 const final=resolveAdventureEvent(narutoRun,"sea-all","sea_sacrifice");
 assert.equal(final.status,"completed"); assert.equal(final.result.hpLoss,1440); assert.equal(final.result.hpLossPercent,90); assert.equal(final.result.choicesUsed,3);
 assert.equal(narutoRun.maxHp,160); assert.equal(narutoRun.atk,170+30+50+70); assert.equal(narutoRun.def,70);
 const declined=makeNaruto();
 createAdventureEventResult(declined,"sea-declined","sea_beyond",()=>0);
 resolveAdventureEvent(declined,"sea-declined","sea_pass");
 assert.equal(getAvailableAdventureEventIds(declined).includes("sea_beyond"),false,"declining still consumes the run's single appearance");
});

test("death note rolls once, refreshes to exactly two real battle advances, and clears", () => {
 const bad=makeNaruto(); createAdventureEventResult(bad,"death-bad","death_note",()=>0); const event=resolveAdventureEvent(bad,"death-bad","death_note_open"); assert.equal(event.result.blessing,"player_damage_increased"); assert.equal(getTemporaryCombatModifiers(bad).damageTakenMultiplier,1.5); assert.equal(getTemporaryCombatModifiers(bad).damageDealtMultiplier,1);
 const row=getTemporaryEffectDisplayRows(bad).find(effect=>effect.id==="death_note"); assert.deepEqual([row.statName,row.amountText,row.durationText,row.polarity],["受到伤害","×1.5","剩余 2 场战斗","debuff"]);
 advanceTemporaryEffectsAfterBattle(bad); assert.equal(bad.temporaryEffects[0].battlesRemaining,1); advanceTemporaryEffectsAfterBattle(bad); assert.equal(getTemporaryCombatModifiers(bad).damageTakenMultiplier,1);
 const good=makeNaruto(); createAdventureEventResult(good,"death-good","death_note",()=>0.9); resolveAdventureEvent(good,"death-good","death_note_open"); assert.equal(getTemporaryCombatModifiers(good).damageDealtMultiplier,2);
 createAdventureEventResult(good,"death-refresh","death_note",()=>0.9); resolveAdventureEvent(good,"death-refresh","death_note_open"); assert.equal(good.temporaryEffects.length,1); assert.equal(good.temporaryEffects[0].battlesRemaining,2);
});

test("Jiraiya scroll can be declined once and safely completes", () => { const run=makeNaruto(); createAdventureEventResult(run,"scroll-decline","scroll"); assert.equal(resolveAdventureEvent(run,"scroll-decline","scroll_leave").status,"completed"); assert.deepEqual(run.learnedActiveSkills,["shadow-clone-rush"]); });

test("elite challenges are independent map battles; the random event pool has no elite encounter", () => {
  assert.equal(ADVENTURE_EVENT_DATA.elite, undefined);
  assert.equal(getAvailableAdventureEventIds(makeNaruto()).includes("elite"), false);
  assert.ok(Object.values(ADVENTURE_EVENT_DATA).every((event) => event.containsBattle !== true));
  assert.ok(getAvailableAdventureEventIds(makeNaruto()).every((id) => ADVENTURE_EVENT_DATA[id].containsBattle !== true));
  const run = makeNaruto();
  const offer = createBattleRewardOffer(run, "map-elite-1", "elite", () => 0.3);
  assert.equal(offer.battleType, "elite");
  assert.deepEqual(offer.extraChoices, ["skill_upgrade"]);
});

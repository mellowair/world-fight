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
  assert.deepEqual([run.maxHp, run.currentHp, run.atk, run.def, run.spd, run.critRate, run.critMultiplier], [1400, 1400, 170, 65, 85, 0.05, 1.5]);
  assert.deepEqual(run.learnedActiveSkills, ["shadow-clone-rush"]);
  assert.equal(run.skillLevels["shadow-clone-rush"], 1);
  assert.equal(run.passiveSkillId, "jinchuriki");
  run.atk += 10;
  assert.equal(naruto.atk, 170);
});

test("requested first-stage hero and existing enemy baseline stats are explicit", () => {
  assert.deepEqual([naruto.baseStats.maxHp, naruto.baseStats.atk, naruto.baseStats.def, naruto.baseStats.spd], [1400, 170, 65, 85]);
  const guard = CHARACTER_DATA.find((character) => character.id === "guard");
  const mage = CHARACTER_DATA.find((character) => character.id === "mage");
  assert.deepEqual([guard.hp, guard.atk, guard.def, guard.spd], [450, 80, 20, 50]);
  assert.deepEqual([mage.hp, mage.atk, mage.def, mage.spd], [450, 80, 20, 50]);
  const eren = STARTING_CHARACTERS.find((character) => character.id === "eren");
  assert.deepEqual([eren.baseStats.maxHp, eren.baseStats.atk, eren.baseStats.def, eren.baseStats.spd], [1700, 110, 100, 50]);
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
  assert.equal(CAMPAIGN_BATTLES.length, 5);
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
      else if (stat === "maxHp") assert.equal(run.maxHp, 1500);
      else assert.equal(run[stat], before[stat] + amount);
    }
    assert.ok(run.currentHp <= run.maxHp);
  }
});

test("HP upgrade raises max HP without healing and preserves current HP", () => {
  const run = makeNaruto();
  run.currentHp = 1195;
  const { choices } = createStatUpgradeChoices(run, "offer", () => 0.999);
  assert.ok(choices.includes("max_hp"));
  applyStatUpgrade(run, "offer", "max_hp");
  assert.equal(run.currentHp, 1195);
  assert.equal(run.maxHp, 1500);
  assert.ok(run.currentHp <= run.maxHp);
});

test("new campaign selection starts fresh growth state and accepts a compatible selected skill", () => {
  const campaign = createCampaign(() => 0);
  startCampaign(campaign);
  assert.ok(selectStartingCharacter(campaign, "naruto", "rasengan"));
  assert.deepEqual(campaign.runCharacterState.learnedActiveSkills, ["rasengan"]);
  assert.equal(campaign.runCharacterState.maxHp, 1400);
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
  assert.equal(run.currentHp, 1400, "passive evaluation returns an effect but never recursively applies combat damage");
  assert.equal(evaluatePassive(run, "before_attack", { battleId: "battle-1", damage: 100 }), null);
});

test("Naruto skill levels carry the requested clone count, damage multiplier, and trigger chance", () => {
  const expected = [[1, 1.3, 0.25], [2, 1.6, 0.30], [3, 1.9, 0.35], [4, 2.2, 0.40]];
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
    { name: "巨石减益", stat: "spd", amount: -20, battlesRemaining: 3, sourceId: "rock" },
    { name: "咖啡店增益", stat: "def", amount: 70, battlesRemaining: 1, sourceId: "coffee" },
    { name: "expired", stat: "spd", amount: -5, battlesRemaining: 0 },
  ];
  const shown = getTemporaryEffects(run);
  assert.deepEqual(shown.map(({ name, amount, battlesRemaining }) => [name, amount, battlesRemaining]), [
    ["巨石减益", -20, 3], ["咖啡店增益", 70, 1],
  ]);
  getTemporaryEffects(run);
  getTemporaryCombatModifiers(run);
  assert.deepEqual(run.temporaryEffects.map((effect) => effect.battlesRemaining), [3, 1, 0]);
  assert.deepEqual(getTemporaryEffectDisplayRows(run), [
    { id: "big_rock", name: "巨石减益", statName: "速度", amount: -20, amountText: "-20", durationText: "剩余 3 场战斗", polarity: "debuff" },
    { id: "coffee_shop", name: "咖啡店增益", statName: "防御", amount: 70, amountText: "+70", durationText: "下一场战斗生效", polarity: "buff" },
  ]);
});

test("temporary effects power clickable status icons, while character details omit modifier rows", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(app, /getTemporaryEffectDisplayRows\(campaign\.runCharacterState\)/);
  assert.match(app, /function renderAllyStatusIcons\(\)/);
  assert.match(app, /assets\/events\/event_coffee_shop\.png/);
  assert.match(app, /assets\/events\/event_big_rock\.png/);
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
  assert.equal(before.chance, 0.25);
  assert.equal(before.multiplier, 1.3);
  upgradeActiveSkill(run, "shadow-clone-rush", "clone-upgrade");
  const after = getSkillAtLevel(run, "shadow-clone-rush");
  assert.equal(after.level, 2);
  assert.equal(after.chance, 0.30);
  assert.equal(after.multiplier, 1.6);
  assert.equal(after.cloneCount, 2);
});

test("campfire rest heals 25 percent of max HP, clamps, and settles once", () => {
  const run = makeNaruto();
  run.currentHp = 1000;
  const options = getCampfireOptions(run);
  assert.equal(options[0].healAmount, 350);
  assert.equal(resolveCampfire(run, "step-3-choice-1", "rest").restored, 350);
  assert.equal(run.currentHp, 1350);
  assert.equal(resolveCampfire(run, "step-3-choice-1", "rest"), false);
  run.currentHp = 1400;
  assert.equal(healRunCharacter(run, 500, "cap-test").currentHp, 1400);
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
  assert.deepEqual(getAvailableAdventureEventIds(run), ["scroll", "fall_rock", "big_rock", "coffee_shop"]);
  assert.deepEqual(getAvailableAdventureEventIds(run).map((_, i) => chooseAdventureEventId(run, () => i / 4)), getAvailableAdventureEventIds(run));
  learnActiveSkill(run, "rasengan", "learn-second");
  assert.deepEqual(getAvailableAdventureEventIds(run), ["fall_rock", "big_rock", "coffee_shop"]);
  assert.deepEqual(getAvailableAdventureEventIds(run).map((_, i) => chooseAdventureEventId(run, () => i / 3)), getAvailableAdventureEventIds(run));
});

test("fall rock lowers max HP by 15 percent, clamps only when required, and resolves once", () => {
  const run = makeNaruto();
  run.currentHp = 800;
  const event = createAdventureEventResult(run, "fall-low", "fall_rock");
  assert.equal(event.data.newMaxHp, 1190);
  assert.equal(resolveAdventureEvent(run, "fall-low").result.currentHp, 800);
  assert.equal(run.maxHp, 1190);
  assert.equal(resolveAdventureEvent(run, "fall-low"), false);
  const high = makeNaruto();
  high.currentHp = 1190;
  createAdventureEventResult(high, "fall-high", "fall_rock");
  resolveAdventureEvent(high, "fall-high");
  assert.equal(high.currentHp, 1190);
});

test("big rock applies SPD minus 20 for three actual battle advances exactly once each", () => {
  const run = makeNaruto();
  const event = createAdventureEventResult(run, "rock-1", "big_rock");
  assert.deepEqual(createAdventureEventResult(run, "rock-1", "big_rock"), event);
  resolveAdventureEvent(run, "rock-1");
  assert.equal(resolveAdventureEvent(run, "rock-1"), false);
  for (const remaining of [3, 2, 1]) {
    assert.equal(getTemporaryCombatModifiers(run).spd, -20);
    advanceTemporaryEffectsAfterBattle(run);
    assert.equal(run.temporaryEffects[0]?.battlesRemaining, remaining - 1 || undefined);
  }
  assert.equal(getTemporaryCombatModifiers(run).spd, 0);
});

test("coffee shop applies DEF plus 70 only until the next battle ends", () => {
  const run = makeNaruto();
  const event = createAdventureEventResult(run, "coffee-1", "coffee_shop");
  assert.equal(resolveAdventureEvent(run, "coffee-1").result.effect.amount, 70);
  assert.equal(resolveAdventureEvent(run, "coffee-1"), false);
  assert.equal(getTemporaryCombatModifiers(run).def, 70);
  advanceTemporaryEffectsAfterBattle(run);
  assert.equal(getTemporaryCombatModifiers(run).def, 0);
  assert.equal(run.def, 65, "the base stat remains unchanged");
});

test("event images point to local transparent assets with consistent dimensions", () => {
  assert.equal(Object.keys(ADVENTURE_EVENT_DATA).length, 4);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(app, /eventImage\.src = image/);
  assert.match(html, /id="decision-event-image"/);
  assert.match(css, /\.decision-event-image\[hidden\]\s*\{\s*display:\s*none/);
  for (const event of Object.values(ADVENTURE_EVENT_DATA)) {
    const png = readFileSync(new URL(`./${event.image}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png.readUInt32BE(20), 256);
    assert.equal(png[25], 6, `${event.image} should retain alpha transparency`);
  }
});

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

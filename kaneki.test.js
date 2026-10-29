import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTING_CHARACTERS, COMBAT_RULES } from "./characters.js";
import { createCampaign, startCampaign, selectStartingCharacter, chooseStartingSkill, beginJourney, prepareBattle } from "./campaign.js";
import { executeAttack, getCritChance, getDodgeChance, getSkillDodgeChance, initializeBattle } from "./battle.js";
import { learnActiveSkill, upgradeActiveSkill } from "./progression.js";
import { SKILL_DATA } from "./skills.js";

const kaneki = STARTING_CHARACTERS.find((entry) => entry.id === "kaneki");
const skillAt = (id, level) => ({ ...SKILL_DATA[id], ...SKILL_DATA[id].levels[level], level });
const rolls = (...values) => { let index = 0; return () => values[index++] ?? 0.99; };
const unit = (overrides = {}) => ({ id: "kaneki", name: "金木研", team: "ally", row: "front", hp: 1300, maxHp: 1300,
  currentHp: 1300, alive: true, atk: 200, def: 40, spd: 125, critChance: 0.05, passiveSkillId: "kaneki-one-eye", ...overrides });
const enemy = (overrides = {}) => ({ id: "enemy", team: "enemy", row: "front", hp: 1000, maxHp: 1000,
  currentHp: 1000, alive: true, atk: 100, def: 0, spd: 0, ...overrides });

test("Kaneki starter config uses the authored independent sprite frames", () => {
  assert.deepEqual([kaneki.hp, kaneki.atk, kaneki.def, kaneki.spd], [1300, 200, 40, 125]);
  assert.deepEqual(kaneki.activeSkills, ["kaneki-predator", "kaneki-1000-7"]);
  assert.equal(kaneki.passiveSkillId, "kaneki-one-eye");
  assert.equal(kaneki.asset, "assets/kaneki/idle.png");
  assert.equal(kaneki.skillAnimationMap["kaneki-predator"], "predator");
  const dimensions = (path) => {
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
    assert.equal(png[25], 6, `${path} must have an RGBA color type`);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  for (const animation of Object.values(kaneki.animations)) {
    for (const path of Object.values(animation.frames)) {
      assert.deepEqual(dimensions(path), path.includes("death.png") ? [192, 144] : path.includes("predator_02") ? [160, 176]
        : path.includes("predator_03") || path.includes("thousand_seven") ? [128, 144] : [96, 112]);
    }
  }
  assert.deepEqual(kaneki.animations.fall.durationsMs, [650, 420]);
  assert.deepEqual(Object.keys(kaneki.animations.run.frames), ["run_01", "run_02"]);
  assert.deepEqual(kaneki.animations.run.durationsMs, [120, 120]);
  assert.equal(kaneki.animations.run.loop, true);
  assert.deepEqual(kaneki.animationTiming.normalAttack, { approachMs: 420, chargeMs: 220, impactMs: 300, totalMs: 550, returnMs: 420 });
  assert.ok(kaneki.animationTiming.normalAttack.chargeMs < kaneki.animationTiming.normalAttack.impactMs);
  assert.ok(kaneki.animationTiming.normalAttack.impactMs < kaneki.animationTiming.normalAttack.totalMs);
  assert.deepEqual(kaneki.animationTiming.predator, { launchMs: 400, strikeMs: 1050, retreatMs: 450, impactMs: 900 });
  assert.equal(kaneki.animationTiming.thousandSevenMs, 1000);
});

test("the opening draw is stable within a run, unique, reproducible, and permits all three pairs", () => {
  const pairs = new Set();
  for (let seed = 0; seed < 120; seed += 1) {
    const campaign = createCampaign(() => 0.2, { seed });
    assert.equal(startCampaign(campaign), true);
    assert.equal(campaign.candidateIds.length, 2);
    assert.equal(new Set(campaign.candidateIds).size, 2);
    const before = [...campaign.candidateIds];
    assert.equal(startCampaign(campaign), false);
    assert.deepEqual(campaign.candidateIds, before);
    const replay = createCampaign(() => 0.9, { seed });
    startCampaign(replay);
    assert.deepEqual(replay.candidateIds, before, "battle/event RNG cannot alter the opening draw");
    pairs.add([...before].sort().join("+"));
    const excluded = STARTING_CHARACTERS.find((entry) => !before.includes(entry.id));
    assert.equal(selectStartingCharacter(campaign, excluded.id), false);
  }
  assert.deepEqual([...pairs].sort(), ["eren+kaneki", "eren+naruto", "kaneki+naruto"]);
});

test("Kaneki enters combat with one chosen skill and can learn the other through a scroll", () => {
  const campaign = createCampaign(() => 0, { seed: 1 });
  startCampaign(campaign);
  assert.ok(campaign.candidateIds.includes("kaneki"));
  assert.ok(selectStartingCharacter(campaign, "kaneki", null));
  assert.equal(chooseStartingSkill(campaign, "kaneki-1000-7").id, "kaneki-1000-7");
  assert.equal(beginJourney(campaign), "route");
  campaign.currentBattle = { type: "normal", step: 1, enemies: ["guard"] };
  campaign.status = "combat";
  assert.deepEqual(prepareBattle(campaign).roster[0].skills.map((skill) => skill.id), ["kaneki-1000-7"]);
  const run = campaign.runCharacterState;
  assert.equal(learnActiveSkill(run, "kaneki-predator", "scroll:1").id, "kaneki-predator");
  assert.deepEqual(run.learnedActiveSkills, ["kaneki-1000-7", "kaneki-predator"]);
  assert.equal(upgradeActiveSkill(run, "kaneki-predator", "upgrade:1").level, 2);
});

test("either opening active skill preserves One Eye on the real campaign battle roster", () => {
  for (const selectedSkill of ["kaneki-1000-7", "kaneki-predator"]) {
    const campaign = createCampaign(() => 0, { seed: 1 });
    startCampaign(campaign);
    assert.ok(selectStartingCharacter(campaign, "kaneki", null));
    assert.ok(chooseStartingSkill(campaign, selectedSkill));
    assert.equal(campaign.runCharacterState.passiveSkillId, "kaneki-one-eye");
    beginJourney(campaign);
    campaign.currentBattle = { type: "normal", step: 1, enemies: ["guard"] };
    campaign.status = "combat";
    campaign.runCharacterState.currentHp = 900;
    campaign.runCharacterState.critRate = 1;
    const prepared = prepareBattle(campaign);
    const state = initializeBattle(prepared.roster, prepared.combatOptions);
    const hero = state.characters[0];
    const foe = state.characters[1];
    assert.equal(hero.passiveSkillId, "kaneki-one-eye");
    const normalRolls = selectedSkill === "kaneki-predator" ? rolls(0.99, 0.99, 0) : rolls(0.99, 0);
    const normal = executeAttack(state, hero, foe, normalRolls);
    assert.equal(normal.critical, true);
    assert.equal(normal.oneEyeTriggered, true);
    assert.equal(normal.oneEyeHealedAmount, Math.min(400, Math.floor(normal.calculatedDamage * 0.25)));
    assert.equal(hero.currentHp, 900 + normal.oneEyeHealedAmount);
    if (selectedSkill === "kaneki-predator" && foe.alive) {
      const skillHit = executeAttack(state, hero, foe, rolls(0, 0.99, 0));
      assert.equal(skillHit.skillId, "kaneki-predator");
      assert.equal(skillHit.critical, true);
      assert.equal(skillHit.oneEyeHealedAmount, Math.min(1300 - normal.attackerHp, Math.floor(skillHit.calculatedDamage * 0.25)));
    }
  }
});

test("1000-7 critical gain contributes to later One Eye healing in battle", () => {
  const hero = unit({ currentHp: 900, skills: [skillAt("kaneki-1000-7", 1)] });
  const foe = enemy({ atk: 10, currentHp: 1000 });
  const state = initializeBattle([hero, foe]);
  const fighter = state.characters[0], opponent = state.characters[1];
  executeAttack(state, opponent, fighter, rolls(0.99, 0.99));
  const second = executeAttack(state, opponent, fighter, rolls(0.99, 0.99));
  assert.ok(second.damageSkillTriggered);
  assert.ok(Math.abs(getCritChance(fighter) - 0.12) < 1e-10);
  assert.equal(fighter.atk, 210);
  const before = fighter.currentHp;
  const counter = executeAttack(state, fighter, opponent, rolls(0.99, 0.08));
  assert.equal(counter.critical, true);
  assert.equal(counter.oneEyeHealedAmount, Math.floor(counter.calculatedDamage * 0.25));
  assert.equal(fighter.currentHp, before + counter.oneEyeHealedAmount);
});

test("One Eye heals floor 25% of calculated critical damage, including lethal overkill, without overhealing", () => {
  const attacker = unit({ currentHp: 1100, critChance: 1 });
  const target = enemy({ currentHp: 50 });
  const hit = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, rolls(0.99, 0.5));
  assert.equal(hit.actualDamage, 50);
  assert.equal(hit.oneEyeHealedAmount, Math.floor(hit.calculatedDamage * .25));
  assert.equal(attacker.currentHp, 1100 + hit.oneEyeHealedAmount);
  assert.equal(hit.targetDied, true);
  const skillUser = unit({ currentHp: 1295, skills: [skillAt("kaneki-predator", 1)] });
  const skillTarget = enemy({ currentHp: 100 });
  const skillHit = executeAttack({ characters: [skillUser, skillTarget], round: 1 }, skillUser, skillTarget, rolls(0, 0.99, 0.99));
  assert.equal(skillHit.critical, true);
  assert.equal(skillHit.oneEyeHealedAmount, 5);
  assert.equal(skillUser.currentHp, 1300);
  const missTarget = enemy();
  const miss = executeAttack({ characters: [skillUser, missTarget], round: 1 }, skillUser, missTarget, rolls(0, 0, 0));
  assert.equal(miss.dodged, true);
  assert.equal(miss.oneEyeTriggered, false);
  const overkillUser = unit({ currentHp: 800, atk: 800, critChance: 1 });
  const overkillTarget = enemy({ currentHp: 100, def: 50 });
  const overkill = executeAttack({ characters: [overkillUser, overkillTarget], round: 1 }, overkillUser, overkillTarget, rolls(.99, .5));
  assert.equal(overkill.calculatedDamage, 800);
  assert.equal(overkill.actualDamage, 100);
  assert.equal(overkill.oneEyeHealedAmount, 200);
  assert.equal(overkillUser.currentHp, 1000);
});

test("Predator levels use ATK+SPD, current pre-hit HP threshold and independent dodge", () => {
  assert.deepEqual([1, 2, 3, 4].map((level) => [SKILL_DATA["kaneki-predator"].levels[level].chance,
    SKILL_DATA["kaneki-predator"].levels[level].guaranteedCritBelowHpRatio]),
  [[0.50, 0.25], [0.55, 0.30], [0.55, 0.40], [0.60, 0.50]]);
  assert.deepEqual([1, 2, 3, 4].map((level) => SKILL_DATA["kaneki-predator"].levels[level].multiplier), [1, 1, 1, 1]);
  const attacker = unit({ skills: [skillAt("kaneki-predator", 4)] });
  const target = enemy({ currentHp: 240 });
  const hit = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, rolls(0, 0.99, 0.99));
  assert.equal(hit.skillAttackPower, 325);
  assert.equal(hit.critChance, 1);
  assert.equal(hit.critical, true);
  assert.equal(hit.damage, Math.floor(325 * COMBAT_RULES.critMultiplier));
  const boundaryAttacker = unit({ skills: [skillAt("kaneki-predator", 4)] });
  const boundaryTarget = enemy({ currentHp: 500 });
  const boundary = executeAttack({ characters: [boundaryAttacker, boundaryTarget], round: 1 },
    boundaryAttacker, boundaryTarget, rolls(0, 0.99, 0.99));
  assert.equal(boundary.critChance, 0.05);
  const dodgedAttacker = unit({ skills: [skillAt("kaneki-predator", 4)] });
  const dodgedTarget = enemy({ currentHp: 240 });
  const dodged = executeAttack({ characters: [dodgedAttacker, dodgedTarget], round: 1 }, dodgedAttacker, dodgedTarget, rolls(0, 0, 0));
  assert.equal(dodged.dodged, true);
  assert.equal(dodged.critical, false);
});

test("1000-7 reacts only to effective damage and its bonuses reset with a new battle", () => {
  for (const level of [1, 2, 3, 4]) {
    const actor = unit({ skills: [skillAt("kaneki-1000-7", level)] });
    const foe = enemy({ atk: 20 });
    const state = initializeBattle([actor, foe]);
    const hero = state.characters[0], attacker = state.characters[1];
    const first = executeAttack(state, attacker, hero, rolls(0.99, 0.99));
    assert.equal(first.damageSkillTriggered === null, level !== 4);
    assert.equal(hero.damageTakenHits, 1);
    const second = executeAttack(state, attacker, hero, rolls(0.99, 0.99));
    const effect = SKILL_DATA["kaneki-1000-7"].levels[level];
    assert.equal(hero.critRateBonus, effect.critRateBonus * (level === 4 ? 2 : 1));
    assert.equal(hero.dodgeRateBonus, effect.dodgeRateBonus * (level === 4 ? 2 : 1));
    assert.equal(hero.atk, 200 + effect.attackBonus * (level === 4 ? 2 : 1));
    assert.equal(second.damageSkillTriggered !== null, true);
    assert.equal(second.damageSkillTriggered.critRateGain, effect.critRateBonus);
    assert.equal(second.damageSkillTriggered.dodgeRateGain, effect.dodgeRateBonus);
    assert.equal(second.damageSkillTriggered.attackGain, effect.attackBonus);
    executeAttack(state, attacker, hero, rolls(0.99, 0.99));
    executeAttack(state, attacker, hero, rolls(0.99, 0.99));
    assert.equal(hero.critRateBonus, effect.critRateBonus * (level === 4 ? 4 : 2));
    assert.equal(hero.dodgeRateBonus, effect.dodgeRateBonus * (level === 4 ? 4 : 2));
    assert.equal(hero.atk, 200 + effect.attackBonus * (level === 4 ? 4 : 2));
    const next = initializeBattle([actor, foe]);
    assert.equal(next.characters[0].damageTakenHits, 0);
    assert.equal(next.characters[0].critRateBonus, 0);
    assert.equal(next.characters[0].dodgeRateBonus, 0);
    assert.equal(next.characters[0].atk, 200);
  }
  const hero = unit({ skills: [skillAt("kaneki-1000-7", 4)] });
  const foe = enemy({ atk: 20 });
  const dodge = executeAttack({ characters: [foe, hero], round: 1 }, foe, hero, rolls(0, 0));
  assert.equal(dodge.dodged, true);
  assert.equal(hero.damageTakenHits, undefined);
});

test("global crit reaches 100%, ordinary dodge reaches 99%, skill dodge stays one capped substitute roll", () => {
  assert.equal(getCritChance({ critChance: 0.8, critRateBonus: 0.4 }), 1);
  assert.equal(getDodgeChance({ spd: 1000 }), 0.395);
  assert.equal(getDodgeChance({ spd: 125, dodgeRateBonus: 0.5 }), 0.566875);
  assert.equal(getDodgeChance({ spd: 99999, dodgeRateBonus: 1 }), 0.99);
  assert.equal(COMBAT_RULES.skillDodgeChanceCap, 0.5);
  assert.equal(getSkillDodgeChance({ spd: 99999, dodgeRateBonus: 1 }), 0.5);
  assert.equal(getSkillDodgeChance({ spd: 125, dodgeRateBonus: 0.5 }), getSkillDodgeChance({ spd: 125 }));
  const skillUser = unit({ skills: [{ ...skillAt("kaneki-predator", 1), chance: 1 }] });
  const highDodgeTarget = enemy({ spd: 99999, dodgeRateBonus: 1 });
  const skillDodged = executeAttack({ characters: [skillUser, highDodgeTarget], round: 1 }, skillUser, highDodgeTarget, rolls(0, 0.49));
  assert.equal(skillDodged.dodged, true);
  const skillHit = executeAttack({ characters: [skillUser, highDodgeTarget], round: 1 }, skillUser, highDodgeTarget, rolls(0, 0.5, 0.99));
  assert.equal(skillHit.dodged, false);
  const attacker = unit({ critChance: 1, passiveSkillId: null });
  const target = enemy({ spd: 0 });
  const critical = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, rolls(0.99, 0.99));
  assert.equal(critical.critical, true);
  assert.equal(critical.damage, 300);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANIMATION_TIMING, CHARACTER_DATA, COMBAT_RULES, STARTING_CHARACTERS } from "./characters.js";
import { calculateDamage, chooseTarget, executeAttack, getActionOrder, getCritChance, getDodgeChance, getSkillDodgeChance, initializeBattle, simulateBattle } from "./battle.js";
import { createRunCharacterState, getSkillAtLevel, getTemporaryCombatModifiers } from "./progression.js";
import { SKILL_DATA } from "./skills.js";

test("keeps speed order and front-row targeting", () => {
  const state = initializeBattle();
  assert.deepEqual(getActionOrder(state).map((character) => character.id), ["naruto", "guard", "mage"]);
  assert.equal(chooseTarget(state, state.characters[0], () => 0.9).id, "guard");
  state.characters.find((character) => character.id === "guard").alive = false;
  state.characters.find((character) => character.id === "guard").currentHp = 0;
  assert.equal(chooseTarget(state, state.characters[0], () => 0.9).id, "mage");
});

test("uses the configured dodge, critical, and damage formulas", () => {
  const naruto = CHARACTER_DATA[0];
  const guard = CHARACTER_DATA[1];
  assert.ok(Math.abs(getDodgeChance(naruto) - 0.051875) < 1e-12);
  assert.ok(Math.abs(getSkillDodgeChance(naruto) - 0.010375) < 1e-9);
  assert.equal(getSkillDodgeChance({ spd: 9999 }), Math.min(COMBAT_RULES.skillDodgeChanceCap, COMBAT_RULES.maxDodgeChance * COMBAT_RULES.skillDodgeFactor));
  assert.equal(getDodgeChance({ spd: 9999 }), COMBAT_RULES.maxDodgeChance);
  assert.equal(getCritChance(naruto), 0.05);
  assert.equal(calculateDamage(naruto, guard), 121);
  assert.equal(calculateDamage(naruto, guard, 1.8), 218);
  assert.equal(calculateDamage(naruto, guard, COMBAT_RULES.critMultiplier), 182);
});

test("Death Note's negative 1.5x modifier changes actual incoming damage without changing base damage", () => {
  const attacker = { id: "enemy", team: "enemy", atk: 100, def: 0, spd: 0, currentHp: 300, alive: true, skill: null };
  const player = { id: "player", team: "ally", atk: 1, def: 0, spd: 0, currentHp: 300, alive: true, skill: null, damageTakenMultiplier: 1.5 };
  const event = executeAttack({ characters: [attacker, player], round: 1 }, attacker, player, () => 0.99);
  assert.equal(event.damage, 150);
  assert.equal(player.currentHp, 150);
  assert.equal(calculateDamage(attacker, player), 100);
});

test("records dodges without damage and critical hits with multiplied damage", () => {
  const attacker = { id: "a", team: "ally", atk: 150, def: 0, spd: 80, currentHp: 100, alive: true, skill: null };
  const target = { id: "t", team: "enemy", atk: 1, def: 60, spd: 80, currentHp: 300, alive: true, skill: null };
  const state = { characters: [attacker, target] };
  const dodge = executeAttack(state, attacker, target, () => 0.01);
  assert.equal(dodge.dodged, true);
  assert.equal(dodge.critical, false);
  assert.equal(dodge.damage, 0);
  assert.equal(target.currentHp, 300);

  const sequence = [0.9, 0.01];
  const critical = executeAttack(state, attacker, target, () => sequence.shift());
  assert.equal(critical.dodged, false);
  assert.equal(critical.critical, true);
  assert.equal(critical.damage, 140);
  assert.equal(target.currentHp, 160);
});

test("direct damage skills use the lower skill dodge chance", () => {
  const attacker = { id: "a", team: "ally", atk: 100, spd: 80, currentHp: 100, alive: true, skill: { chance: 1, multiplier: 1.8, effectType: "damage", name: "test" } };
  const target = { id: "t", team: "enemy", def: 0, spd: 80, currentHp: 300, alive: true };
  const state = { characters: [attacker, target] };
  const values = [0, 0.02, 0.99];
  const event = executeAttack(state, attacker, target, () => values.shift());
  assert.equal(event.attackKind, "skill");
  assert.ok(Math.abs(event.dodgeChance - 0.01) < 1e-9);
  assert.equal(event.dodged, false);
});

test("the configured 30% Boom active skill uses its 1.8x multiplier through the shared damage resolver", () => {
  const boom = SKILL_DATA["bomb-demon-boom"];
  const attacker = { id: "bomb-demon", team: "enemy", atk: 150, spd: 120, currentHp: 900, alive: true, skills: [{ ...boom, ...boom.levels[1] }] };
  const target = { id: "hero", team: "ally", atk: 1, def: 0, spd: 0, currentHp: 1000, alive: true };
  const rolls = [0, 0.99, 0.99];
  const event = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, () => rolls.shift() ?? 0.99);
  assert.equal(event.skillId, "bomb-demon-boom");
  assert.equal(event.skillName, "Boom");
  assert.equal(boom.levels[1].chance, 0.3);
  assert.equal(event.skillMultiplier, 1.8);
  assert.equal(event.damage, 270);
});

test("Mahito activates his passive once below half HP and gains another 80 ATK each new round", () => {
  const hero = { id: "hero", team: "ally", atk: 600, def: 10000, spd: 100, maxHp: 99999, currentHp: 99999, alive: true, critChance: 0, rosterOrder: 0 };
  const mahito = { id: "mahito", name: "真人", team: "enemy", atk: 40, def: 0, spd: 60, maxHp: 1000, currentHp: 1000, alive: true, critChance: 0, elitePassiveId: "mahito-domain", rosterOrder: 1 };
  const result = simulateBattle([hero, mahito], () => 0.99);
  const activation = result.events.find((event) => event.type === "elite-passive-trigger");
  assert.ok(activation);
  assert.equal(activation.attackBonus, 80);
  assert.equal(activation.effectiveAtk, 120);
  assert.equal(result.events.filter((event) => event.type === "elite-passive-trigger").length, 1);
  const laterGrowth = result.events.find((event) => event.type === "elite-passive-growth");
  assert.ok(laterGrowth);
  assert.equal(laterGrowth.round, activation.round + 1);
  assert.equal(laterGrowth.attackBonus, 80);
  assert.equal(laterGrowth.effectiveAtk, activation.effectiveAtk + 80);
  assert.equal(result.events.filter((event) => event.type === "elite-passive-growth" && event.round === laterGrowth.round).length, 1);
});

test("elite escape is a one-time visual event after the bomb demon is defeated", () => {
  const hero = { id: "hero", team: "ally", atk: 2000, def: 0, spd: 200, maxHp: 1000, currentHp: 1000, alive: true, critChance: 0, rosterOrder: 0 };
  const bomb = { id: "bomb-demon", name: "炸弹恶魔", team: "enemy", atk: 150, def: 40, spd: 120, maxHp: 900, currentHp: 900, alive: true, critChance: 0, escapeAsset: "assets/elites/bomb_demon_escape.png", rosterOrder: 1 };
  const result = simulateBattle([hero, bomb], () => 0.99);
  assert.equal(result.outcome, "victory");
  assert.equal(result.events.filter((event) => event.type === "elite-escape").length, 1);
  assert.equal(result.events.at(-1).type, "battle-end");
});

test("next-battle guaranteed skill is fixed in battle start state and only that skill is set to 100%", () => {
  const hero = { id: "hero", team: "ally", atk: 1, def: 0, spd: 100, maxHp: 9999, currentHp: 9999, alive: true, critChance: 0, skill: null,
    skills: [{ id: "skill-b", name: "技能乙", chance: 1, multiplier: 1, effectType: "damage" }] };
  const enemy = { id: "enemy", team: "enemy", atk: 1, def: 0, spd: 1, maxHp: 9999, currentHp: 9999, alive: true, critChance: 0 };
  const result = simulateBattle([hero, enemy], () => 0.99, {
    runCharacterState: { characterId: "hero" }, playerId: "hero", battleId: "fate-battle",
    battleStartEffects: [{ type: "skill-guarantee", skillId: "skill-b", skillName: "技能乙" }],
  });
  assert.equal(result.events[0].type, "skill-guarantee");
  assert.ok(result.events.some((event) => event.skillId === "skill-b"));
});

test("a dodged direct damage skill deals zero damage and cannot crit", () => {
  const attacker = { id: "a", team: "ally", atk: 100, spd: 80, currentHp: 100, alive: true, skill: { chance: 1, multiplier: 1.8, effectType: "damage", name: "test" } };
  const target = { id: "t", team: "enemy", def: 0, spd: 80, currentHp: 300, alive: true };
  const values = [0, 0.001];
  const event = executeAttack({ characters: [attacker, target] }, attacker, target, () => values.shift());
  assert.equal(event.attackKind, "skill");
  assert.equal(event.dodged, true);
  assert.equal(event.critical, false);
  assert.equal(event.damage, 0);
  assert.equal(target.currentHp, 300);
});

test("pre-simulates an outcome and returns final HP for campaign persistence", () => {
  const result = simulateBattle(() => 0.99);
  assert.ok(["victory", "defeat"].includes(result.outcome));
  assert.ok(result.finalCharacters.every((character) => character.currentHp >= 0));
  assert.equal(result.events.at(-1).type, "battle-end");
  assert.ok(result.events.filter((event) => event.type === "attack").every((event) => "dodged" in event && "critical" in event));
});

test("records configured attack presentation and immutable hit results", () => {
  const attacker = { id: "a", team: "ally", atk: 150, spd: 80, currentHp: 100, alive: true, attackType: "melee", skill: null };
  const target = { id: "t", team: "enemy", def: 60, spd: 80, currentHp: 300, alive: true };
  const event = executeAttack({ characters: [attacker, target] }, attacker, target, () => 0.99);
  assert.equal(event.attackType, "melee");
  assert.equal(event.hit, true);
  assert.equal(event.attackerId, "a");
  assert.equal(event.targetId, "t");
  assert.equal(event.damage, 93);
  assert.equal(event.targetHp, 207);
  assert.equal(CHARACTER_DATA.find((character) => character.id === "mage").attackType, "magic");
  assert.equal(CHARACTER_DATA.find((character) => character.id === "naruto").skill.attackType, "melee");

  const skillUser = { ...attacker, skill: { chance: 1, multiplier: 1, effectType: "damage", attackType: "magic", name: "配置覆盖测试" } };
  const skillTarget = { ...target, currentHp: 300 };
  const skillValues = [0, 0.99, 0.99];
  const skillEvent = executeAttack({ characters: [skillUser, skillTarget] }, skillUser, skillTarget, () => skillValues.shift());
  assert.equal(skillEvent.attackType, "magic");
  assert.equal(skillEvent.hit, true);
});

test("battle roster reads configured skill effects and temporary defense buffs", () => {
  const attacker = { id: "skill-user", team: "ally", atk: 100, def: 0, spd: 80, currentHp: 200, maxHp: 200, alive: true, skills: [{ id: "stance", name: "守护架势", chance: 1, effectType: "buff", defenseBonus: 50, durationTurns: 1 }] };
  const enemy = { id: "enemy", team: "enemy", atk: 100, def: 0, spd: 20, currentHp: 200, maxHp: 200, alive: true, skill: null };
  const state = { characters: [attacker, enemy], round: 1 };
  const buff = executeAttack(state, attacker, enemy, () => 0.99);
  assert.equal(buff.type, "skill");
  assert.equal(attacker.defenseBuff, 50);
  const hit = executeAttack(state, enemy, attacker, () => 0.99);
  assert.equal(hit.damage, 66, "the configured temporary DEF is used by the unchanged damage formula");

  const learned = { ...enemy, id: "learned", atk: 100, currentHp: 200, skills: [{ id: "configured", name: "测试技能", chance: 1, multiplier: 2, effectType: "damage", attackType: "magic", level: 3 }] };
  const target = { ...enemy, id: "dummy", team: "enemy", def: 0, currentHp: 400 };
  const event = executeAttack({ characters: [learned, target], round: 1 }, learned, target, () => 0.99);
  assert.equal(event.skillId, "configured");
  assert.equal(event.skillLevel, 3);
  assert.equal(event.damage, 200);
  assert.equal(event.attackType, "magic");
});

test("Naruto's Jinchuriki triggers once on the first attack below half HP and resets next battle", () => {
  const run = createRunCharacterState(STARTING_CHARACTERS.find(entry => entry.id === "naruto"));
  const enemy = { id:"enemy", team:"enemy", atk:100, def:0, spd:20, currentHp:500, maxHp:500, alive:true, skill:null };
  const hero = hp => ({ id:"naruto", team:"ally", atk:run.atk, def:65, spd:85, currentHp:hp, maxHp:run.maxHp, alive:true, skill:null });
  for (const hp of [800, 801]) {
    const atHalf = initializeBattle([enemy, hero(hp)], { runCharacterState:run, playerId:"naruto", battleId:"half-"+hp });
    const dummy={id:"dummy",team:"enemy",def:0,currentHp:5000,maxHp:5000,alive:true,spd:1}; atHalf.characters.push(dummy);
    const result=executeAttack(atHalf,atHalf.characters.find(c=>c.id==="naruto"),dummy,()=>0.99);
    assert.equal(result.jinchurikiTriggered,null, "exactly 50 percent and above do not trigger");
    atHalf.characters.find(c=>c.id==="naruto").currentHp=799;
    const triggered=executeAttack(atHalf,atHalf.characters.find(c=>c.id==="naruto"),dummy,()=>0.99);
    assert.equal(triggered.jinchurikiTriggered.effectiveAtk,212);
    assert.equal(atHalf.characters.find(c=>c.id==="naruto").atk,212);
    atHalf.characters.find(c=>c.id==="naruto").currentHp=900;
    const later=executeAttack(atHalf,atHalf.characters.find(c=>c.id==="naruto"),dummy,()=>0.99);
    assert.equal(later.jinchurikiTriggered,null); assert.equal(atHalf.characters.find(c=>c.id==="naruto").atk,212);
    assert.equal(run.atk,170,"battle buff never mutates persistent base stats");
  }
  const next=initializeBattle([enemy,hero(799)],{runCharacterState:run,playerId:"naruto",battleId:"new-battle"});
  const dummy={id:"dummy",team:"enemy",def:0,currentHp:5000,maxHp:5000,alive:true,spd:1}; next.characters.push(dummy);
  assert.equal(executeAttack(next,next.characters.find(c=>c.id==="naruto"),dummy,()=>0.99).jinchurikiTriggered.effectiveAtk,212);
});

test("Eren's 2000 Years passive blocks only his first incoming attack each battle", () => {
  const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");
  const run = createRunCharacterState(eren, "eren-free-will");
  const buildDuel = (id) => [
    { id: "enemy", team: "enemy", atk: 100, def: 0, spd: 20, currentHp: 500, maxHp: 500, alive: true },
    { id: "eren", team: "ally", atk: run.atk, def: run.def, spd: run.spd, currentHp: 800, maxHp: run.maxHp, alive: true },
  ];
  const state = initializeBattle(buildDuel("unused"), { runCharacterState: run, playerId: "eren", battleId: "eren-passive-1" });
  const attack = () => executeAttack(state, state.characters[0], state.characters[1], () => 0.99);
  const first = attack();
  assert.equal(first.damage, 0);
  assert.equal(first.passiveTriggered.skillId, "eren-2000-years");
  assert.equal(state.characters[1].currentHp, 800);
  const second = attack();
  assert.ok(second.damage > 0);
  assert.equal(second.passiveTriggered, null);
  const nextBattle = initializeBattle(buildDuel("unused"), { runCharacterState: run, playerId: "eren", battleId: "eren-passive-2" });
  const nextFirst = executeAttack(nextBattle, nextBattle.characters[0], nextBattle.characters[1], () => 0.99);
  assert.equal(nextFirst.damage, 0);
  assert.equal(nextFirst.passiveTriggered.skillId, "eren-2000-years");
});

test("Eren's Free Will levels grant a normal hit and cumulative battle-long DEF", () => {
  const expected = [[1, 0.5, 10], [2, 0.55, 15], [3, 0.6, 20], [4, 0.7, 25]];
  assert.deepEqual(expected.map(([level]) => [SKILL_DATA["eren-free-will"].levels[level].chance, SKILL_DATA["eren-free-will"].levels[level].defenseBonus]), expected.map(([, chance, bonus]) => [chance, bonus]));
  const run = createRunCharacterState(STARTING_CHARACTERS.find((entry) => entry.id === "eren"), "eren-free-will");
  const skill = { ...getSkillAtLevel(run, "eren-free-will"), chance: 1 };
  const eren = { id: "eren", team: "ally", atk: 110, def: 100, spd: 50, currentHp: 1000, maxHp: 1700, alive: true, skills: [skill] };
  const enemy = { id: "enemy", team: "enemy", atk: 100, def: 0, spd: 20, currentHp: 1000, maxHp: 1000, alive: true, skills: [] };
  const state = { characters: [eren, enemy], round: 1 };
  const makeHit = () => executeAttack(state, eren, enemy, () => 0.99);
  const first = makeHit();
  const second = makeHit();
  assert.equal(first.attackKind, "normal", "Free Will retains normal-attack dodge handling");
  assert.equal(first.damage, 110);
  assert.equal(first.defenseBonusApplied, 10);
  assert.equal(second.defenseBonusApplied, 10);
  assert.equal(eren.defenseBuff, 20, "repeated triggers accumulate rather than overwrite");
  const incoming = executeAttack(state, enemy, eren, () => 0.99);
  assert.equal(incoming.damage, 45, "the initial 100 DEF plus stacked 20 DEF applies through the existing damage formula");
  assert.equal(eren.defenseBuffUntilRound, Number.POSITIVE_INFINITY);
  assert.equal(run.def, 90, "combat-only DEF does not change run or base stats");
});

test("Free Will heals on the third and sixth actual trigger, clamps HP, and resets next battle", () => {
  const skill = { ...SKILL_DATA["eren-free-will"], ...SKILL_DATA["eren-free-will"].levels[1], id: "eren-free-will", chance: 1 };
  const eren = { id: "eren", team: "ally", atk: 10, def: 100, spd: 50, currentHp: 1000, maxHp: 1700, alive: true, skills: [skill] };
  const enemy = { id: "enemy", team: "enemy", atk: 1, def: 0, spd: 20, currentHp: 10000, maxHp: 10000, alive: true };
  const state = initializeBattle([eren, enemy]);
  const player = state.characters[0], target = state.characters[1];
  const events = Array.from({ length: 6 }, () => executeAttack(state, player, target, () => 0.99));
  assert.deepEqual(events.map((event) => event.freeWillTriggerCount), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(events.map((event) => event.healedAmount), [0, 0, 136, 0, 0, 136]);
  assert.equal(player.currentHp, 1272);
  assert.equal(player.defenseBuff, 60, "the original cumulative defense still applies");
  const full = initializeBattle([{ ...eren, currentHp: 1680 }, { ...enemy }]);
  const fullEvents = Array.from({ length: 3 }, () => executeAttack(full, full.characters[0], full.characters[1], () => 0.99));
  assert.equal(fullEvents[2].healedAmount, 20);
  assert.equal(full.characters[0].currentHp, 1700);
  assert.equal(full.characters[0].freeWillTriggers, 3, "new battle starts counting from zero");
  const inactive = initializeBattle([{ ...eren, skills: [{ ...skill, chance: 0 }] }, { ...enemy }]);
  for (let i = 0; i < 3; i += 1) assert.equal(executeAttack(inactive, inactive.characters[0], inactive.characters[1], () => 0.99).healedAmount, 0);
  assert.equal(inactive.characters[0].freeWillTriggers, 0, "ordinary attacks are not counted");
});

test("round-limited rock slowdown changes action order for exactly three real rounds", () => {
  const player = { id: "hero", team: "ally", atk: 1, def: 0, spd: 10, spdWithoutRoundEffects: 50,
    roundLimitedSpdEffects: [{ amount: -40, roundsRemaining: 3 }], maxHp: 4, currentHp: 4, alive: true, rosterOrder: 0 };
  const enemy = { id: "enemy", team: "enemy", atk: 1, def: 0, spd: 30, maxHp: 4, currentHp: 4, alive: true, rosterOrder: 1 };
  const result = simulateBattle([player, enemy], () => 0.99);
  assert.equal(result.outcome, "victory");
  assert.equal(result.rounds, 4);
  assert.deepEqual([1, 2, 3, 4].map((round) => result.events.find((event) => event.type === "attack" && event.round === round).attackerId),
    ["enemy", "enemy", "enemy", "hero"]);
  assert.equal(result.finalCharacters.find((character) => character.id === "hero").spd, 50);
});

test("Eren's Tatakae uses ATK plus current DEF, then doubles exactly the next landed damage", () => {
  const expected = [[1, 0.3, 1.3], [2, 0.35, 1.4], [3, 0.4, 1.55], [4, 0.5, 1.7]];
  assert.deepEqual(expected.map(([level]) => [SKILL_DATA["eren-tatakae"].levels[level].chance, SKILL_DATA["eren-tatakae"].levels[level].multiplier]), expected.map(([, chance, multiplier]) => [chance, multiplier]));
  const run = createRunCharacterState(STARTING_CHARACTERS.find((entry) => entry.id === "eren"), "eren-tatakae");
  const skill = { ...getSkillAtLevel(run, "eren-tatakae"), chance: 1 };
  const eren = { id: "eren", team: "ally", atk: 100, def: 40, spd: 58, currentHp: 1000, maxHp: 1320, alive: true, skills: [skill] };
  const enemy = { id: "enemy", team: "enemy", atk: 100, def: 0, spd: 20, currentHp: 1000, maxHp: 1000, alive: true, skills: [] };
  const state = { characters: [eren, enemy], round: 1 };
  const skillHit = executeAttack(state, eren, enemy, () => 0.99);
  assert.equal(skillHit.skillAttackPower, 140);
  assert.equal(skillHit.skillMultiplier, 1.3);
  assert.equal(skillHit.damage, 182);
  assert.equal(eren.doubleNextDamage, true);
  const nextHit = executeAttack(state, enemy, eren, () => 0.99);
  assert.equal(nextHit.damage, 142);
  assert.equal(nextHit.doubleDamageConsumed, true);
  assert.equal(eren.doubleNextDamage, false);
  const laterHit = executeAttack(state, enemy, eren, () => 0.99);
  assert.equal(laterHit.damage, 71, "later damage returns to normal");

  const freshBattleEren = { ...eren, currentHp: 1000, doubleNextDamage: undefined, skills: [skill] };
  const fresh = initializeBattle([freshBattleEren, { ...enemy, currentHp: 1000 }]);
  assert.equal(fresh.characters[0].doubleNextDamage, undefined, "a new battle has no leftover vulnerability marker");
});

test("Eren's immunity consumes Tatakae vulnerability without leaking the marker", () => {
  const eren = STARTING_CHARACTERS.find((entry) => entry.id === "eren");
  const run = createRunCharacterState(eren, "eren-tatakae");
  const skill = { ...getSkillAtLevel(run, "eren-tatakae"), chance: 1 };
  const state = initializeBattle([
    { id: "eren", team: "ally", atk: 100, def: 40, spd: 58, currentHp: 1000, maxHp: run.maxHp, alive: true, skills: [skill] },
    { id: "enemy", team: "enemy", atk: 100, def: 0, spd: 20, currentHp: 1000, maxHp: 1000, alive: true, skills: [] },
  ], { runCharacterState: run, playerId: "eren", battleId: "eren-penalty-immunity" });
  const [erenCopy, enemy] = state.characters;
  executeAttack(state, erenCopy, enemy, () => 0.99);
  const immune = executeAttack(state, enemy, erenCopy, () => 0.99);
  assert.equal(immune.damage, 0);
  assert.equal(immune.doubleDamageConsumed, true);
  assert.equal(erenCopy.doubleNextDamage, false);
  const later = executeAttack(state, enemy, erenCopy, () => 0.99);
  assert.equal(later.damage, 71, "the passive is once per battle and the vulnerability was consumed");
});

test("shadow clone damage at every level uses its configured multiplier in actual attack events", () => {
  const expected = [[1, 1.3], [2, 1.6], [3, 1.9], [4, 2.2]];
  for (const [level, multiplier] of expected) {
    const skill = { ...SKILL_DATA["shadow-clone-rush"], ...SKILL_DATA["shadow-clone-rush"].levels[level], level, chance: 1 };
    const attacker = { id: "a", team: "ally", atk: 100, spd: 80, currentHp: 100, alive: true, skills: [skill] };
    const target = { id: "t", team: "enemy", def: 0, currentHp: 5000, alive: true };
    const rolls = [0, 0.99, 0.99];
    const event = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, () => rolls.shift() ?? 0.99);
    assert.equal(event.skillLevel, level);
    assert.equal(event.skillMultiplier, multiplier);
    assert.equal(event.skillCloneCount, level);
    assert.equal(event.damage, Math.floor(100 * multiplier));
  }
});

test("shadow clone trigger checks use each updated level chance", () => {
  for (const [level, chance] of [[1, 0.45], [2, 0.50], [3, 0.55], [4, 0.65]]) {
    const skill = { ...SKILL_DATA["shadow-clone-rush"], ...SKILL_DATA["shadow-clone-rush"].levels[level], level };
    const makeDuel = () => {
      const state = initializeBattle([
        { id: "naruto", team: "ally", atk: 100, def: 0, spd: 85, maxHp: 1000, currentHp: 1000, skills: [skill] },
        { id: "enemy", team: "enemy", atk: 1, def: 0, spd: 1, maxHp: 10000, currentHp: 10000 },
      ]);
      return state;
    };
    const activated = makeDuel();
    assert.equal(executeAttack(activated, activated.characters[0], activated.characters[1], (() => {
      const rolls = [chance - 0.001, 0.99, 0.99]; return () => rolls.shift() ?? 0.99;
    })()).skillId, "shadow-clone-rush");
    const inactive = makeDuel();
    assert.equal(executeAttack(inactive, inactive.characters[0], inactive.characters[1], (() => {
      const rolls = [chance, 0.99, 0.99]; return () => rolls.shift() ?? 0.99;
    })()).skillId, null);
  }
});

test("Rasengan multiplier tracks skill-level coefficient and actual combat SPD", () => {
  const expected = [
    [1, 80, 1.24], [1, 100, 1.3], [1, 120, 1.36],
    [2, 80, 1.48], [2, 100, 1.6], [2, 120, 1.72],
    [3, 80, 1.72], [3, 100, 1.9], [3, 120, 2.08],
    [4, 80, 1.96], [4, 100, 2.2], [4, 120, 2.44],
  ];
  for (const [level, spd, expectedMultiplier] of expected) {
    const skill = { ...SKILL_DATA.rasengan, ...SKILL_DATA.rasengan.levels[level], id: "rasengan", level, chance: 1 };
    const attacker = { id: "a", team: "ally", atk: 100, spd, currentHp: 100, alive: true, skills: [skill] };
    const target = { id: "t", team: "enemy", def: 0, currentHp: 5000, alive: true };
    const rolls = [0, 0.99, 0.99];
    const event = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, () => rolls.shift() ?? 0.99);
    assert.equal(event.skillLevel, level);
    assert.ok(Math.abs(event.skillMultiplier - expectedMultiplier) < 1e-9);
    assert.equal(event.damage, Math.floor(100 * expectedMultiplier));
  }
  const run = createRunCharacterState(STARTING_CHARACTERS.find((entry) => entry.id === "naruto"), "rasengan");
  run.temporaryEffects.push({ stat: "spd", amount: -20, battlesRemaining: 3 });
  const modifiers = getTemporaryCombatModifiers(run);
  const skill = { ...getSkillAtLevel(run, "rasengan"), chance: 1 };
  const attacker = { id: "a", team: "ally", atk: run.atk, spd: run.spd + modifiers.spd, currentHp: 100, alive: true, skills: [skill] };
  const target = { id: "t", team: "enemy", def: 0, currentHp: 5000, alive: true };
  const rolls = [0, 0.99, 0.99];
  const event = executeAttack({ characters: [attacker, target], round: 1 }, attacker, target, () => rolls.shift() ?? 0.99);
  assert.equal(attacker.spd, 65);
  assert.equal(event.skillMultiplier, 1.195);
});

test("all Rasengan skill levels have the specified chance while multiplier stays speed-based", () => {
  assert.deepEqual([1, 2, 3, 4].map((level) => SKILL_DATA.rasengan.levels[level].chance), [0.20, 0.24, 0.28, 0.32]);
  assert.deepEqual([1, 2, 3, 4].map((level) => SKILL_DATA.rasengan.levels[level].multiplierFormula.coefficient), [0.003, 0.006, 0.009, 0.012]);
});

function makeC0Duel({ playerHp = 1100, bossHp = 500, playerSpd = 80, bossSpd = 100, playerDef = 0, bossAtk = 100, playerSkill = null } = {}) {
  const player = { id: "naruto", name: "鸣人", team: "ally", atk: 100, def: playerDef, spd: playerSpd, hp: playerHp, maxHp: playerHp, currentHp: playerHp, alive: true, rosterOrder: 0, skill: playerSkill, skills: playerSkill ? [playerSkill] : [] };
  const boss = { id: "deidara", name: "迪达拉", role: "爆破艺术家", team: "enemy", atk: bossAtk, def: 0, spd: bossSpd, hp: bossHp, maxHp: bossHp, currentHp: bossHp, alive: true, rosterOrder: 1, skill: null, c0DamagePerRound: 70 };
  return [player, boss];
}

test("C0 adds 70 only after both sides complete one damage action in a round", () => {
  const oneRound = simulateBattle(makeC0Duel({ playerHp: 600, bossHp: 100 }), () => 0.99);
  assert.equal(oneRound.c0.completedRounds, 1);
  assert.equal(oneRound.c0.damagePerRound * oneRound.c0.completedRounds, 70);
  assert.equal(oneRound.events.find((event) => event.type === "c0-charge").accumulatedDamage, 70);
  const fiveRounds = simulateBattle(makeC0Duel({ playerHp: 1100, bossHp: 500 }), () => 0.99);
  assert.equal(fiveRounds.c0.completedRounds, 5);
  assert.equal(fiveRounds.events.filter((event) => event.type === "c0-detonate").length, 1, "C0 can detonate only once");
  assert.equal(fiveRounds.events.find((event) => event.type === "c0-detonate").damage, 350);
});

test("C0 counts an attack skill as one action and does not add a round if Deidara has not acted", () => {
  const multiHitSkill = { name: "多段表现测试", chance: 1, multiplier: 3, effectType: "damage", attackType: "melee" };
  const rolls = [0.99, 0.99, 0.99, 0.99, 0, 0.99, 0.99];
  const oneAction = simulateBattle(makeC0Duel({ playerHp: 1000, bossHp: 300, playerSkill: multiHitSkill }), () => rolls.shift() ?? 0.99);
  assert.equal(oneAction.events.filter((event) => event.type === "attack" && event.attackerId === "naruto").length, 1);
  assert.equal(oneAction.c0.completedRounds, 1);
  assert.equal(oneAction.events.find((event) => event.type === "c0-detonate").damage, 70);

  const killedBeforeAction = simulateBattle(makeC0Duel({ playerHp: 1000, bossHp: 100, playerSpd: 120, bossSpd: 80 }), () => 0.99);
  assert.equal(killedBeforeAction.outcome, "victory");
  assert.equal(killedBeforeAction.c0.completedRounds, 0);
  assert.equal(killedBeforeAction.events.find((event) => event.type === "c0-detonate").damage, 0);
});

test("C0 explodes before final outcome and correctly wins or defeats at HP boundaries", () => {
  const survives = simulateBattle(makeC0Duel({ playerHp: 1100, bossHp: 500 }), () => 0.99);
  assert.equal(survives.outcome, "victory");
  assert.equal(survives.finalCharacters.find((character) => character.id === "naruto").currentHp, 250);
  const equal = simulateBattle(makeC0Duel({ playerHp: 850, bossHp: 500 }), () => 0.99);
  assert.equal(equal.finalCharacters.find((character) => character.id === "naruto").currentHp, 0);
  assert.equal(equal.outcome, "defeat");
  assert.equal(equal.events.at(-2).type, "c0-detonate");
  assert.equal(equal.events.at(-1).type, "battle-end");
  assert.equal(equal.events.at(-1).c0Detonated, true);
  const less = simulateBattle(makeC0Duel({ playerHp: 840, bossHp: 500 }), () => 0.99);
  assert.equal(less.outcome, "defeat");
  assert.equal(less.events.find((event) => event.type === "c0-detonate").damage, 350);
});

test("C0 true damage ignores DEF and does not detonate when battle ends before Deidara dies", () => {
  const result = simulateBattle(makeC0Duel({ playerHp: 1000, bossHp: 500, playerDef: 1000 }), () => 0.99);
  assert.equal(result.events.find((event) => event.type === "c0-detonate").damage, 350);
  const playerDiedFirst = simulateBattle(makeC0Duel({ playerHp: 1, bossHp: 1000, playerSpd: 50, bossSpd: 120 }), () => 0.99);
  assert.equal(playerDiedFirst.outcome, "defeat");
  assert.equal(playerDiedFirst.c0.detonated, false);
  assert.equal(playerDiedFirst.events.some((event) => event.type === "c0-detonate"), false);
});

test("C4 Garuda always triggers, deals 1.2x, and lowers DEF only on a surviving hit", () => {
  const configured = SKILL_DATA["c4-garuda"].levels[1];
  assert.equal(configured.chance, 1);
  assert.equal(configured.multiplier, 1.2);
  assert.equal(configured.defenseReduction, 20);
  const skill = { ...SKILL_DATA["c4-garuda"], ...configured, level: 1 };
  const boss = { id: "deidara", team: "enemy", atk: 100, def: 0, spd: 80, currentHp: 500, alive: true, skills: [skill] };
  const player = { id: "naruto", team: "ally", atk: 100, def: 60, spd: 80, currentHp: 1000, alive: true, skill: null };
  const rolls = [0.99, 0.99, 0.99];
  const state = { characters: [boss, player], round: 1 };
  const event = executeAttack(state, boss, player, () => rolls.shift() ?? 0.99);
  assert.equal(event.skillId, "c4-garuda");
  assert.equal(event.skillMultiplier, 1.2);
  assert.equal(event.damage, 75);
  assert.equal(event.defenseReduced, 20);
  assert.equal(event.targetDef, 40);
  const followUp = { id: "follow-up", team: "enemy", atk: 100, def: 0, spd: 80, currentHp: 100, alive: true, skill: null };
  const followUpValues = [0.99, 0.99, 0.99];
  const followUpEvent = executeAttack(state, followUp, player, () => followUpValues.shift() ?? 0.99);
  assert.equal(followUpEvent.damage, 71, "the lowered battle-copy DEF affects later damage");
  assert.equal(CHARACTER_DATA.find((character) => character.id === "naruto").def, 70, "base player DEF is unchanged");

  const lethalTarget = { ...player, currentHp: 50, def: 60 };
  const lethalBoss = { ...boss, skill: { ...skill }, skills: [{ ...skill }] };
  const lethalRolls = [0, 0.99, 0.99];
  const lethal = executeAttack({ characters: [lethalBoss, lethalTarget], round: 1 }, lethalBoss, lethalTarget, () => lethalRolls.shift() ?? 0.99);
  assert.equal(lethal.targetDied, true);
  assert.equal(lethal.defenseReduced, 0);
  assert.equal(lethalTarget.def, 60);

  const dodgedTarget = { ...player, currentHp: 1000, def: 60 };
  const dodgeRolls = [0, 0];
  const dodged = executeAttack({ characters: [boss, dodgedTarget], round: 1 }, boss, dodgedTarget, () => dodgeRolls.shift() ?? 0.99);
  assert.equal(dodged.dodged, true);
  assert.equal(dodgedTarget.def, 60);
});

test("Deidara fight warning and C0/C4 descriptions are presented at battle start", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(html, /艺术就是爆炸！要尽快击败迪达拉！/);
  assert.match(app, /boss-warning.*prepared\.battle\.type !== "boss"|prepared\.battle\.type !== "boss"/s);
  assert.match(app, /迪达拉的 C0 每个完整行动回合积累 \$\{boss\?\.c0DamagePerRound \?\? 70\} 点真实伤害/);
  assert.match(app, /积累 \$\{c0\.damagePerRound\} 点真实伤害/);
  assert.match(app, /damagePerRound: pendingResult\.c0\.damagePerRound/);
  assert.doesNotMatch(app, /迪达拉每完成一个双方行动回合积累 100 点真实伤害/);
  assert.match(app, /C4 迦楼罗有 \$\{c4Chance\}% 概率造成 1\.2 倍伤害并降低目标 DEF 20 点/);
  assert.equal(SKILL_DATA["c4-garuda"].levels[1].chance, 1);
  assert.match(app, /event\.hpAfter/);
  assert.doesNotMatch(app, /target\.currentHp\s*-=?\s*event\.damage/);
});

test("keeps opening and entry animation timings centrally configured", () => {
  const naruto = STARTING_CHARACTERS.find((character) => character.id === "naruto");
  assert.equal(ANIMATION_TIMING.opening.blackMs, 400);
  assert.equal(ANIMATION_TIMING.opening.skyRedMs, 3000);
  assert.equal(naruto.poseSequence.reduce((sum, pose) => sum + pose.duration, 0), ANIMATION_TIMING.entryPoseMs);
});

test("maps Naruto v2 pose, idle, run, attack, and hit states to the previous individual frame assets", () => {
  const naruto = STARTING_CHARACTERS.find((character) => character.id === "naruto");
  const frame = (name) => `assets/naruto-v2/frames/${name}.svg`;
  assert.equal(naruto.asset, frame("idle"));
  assert.deepEqual(naruto.animations.idle.frames, { idle: frame("idle") });
  assert.equal(naruto.animations.pose.type, "frames");
  assert.deepEqual(naruto.animations.pose.frames, {
    landed: frame("idle"),
    surprised: frame("surprised"),
    scratch: frame("hand_head"),
    smile: frame("smile_thumbs_up"),
    "thumbs-up": frame("smile_thumbs_up"),
  });
  assert.deepEqual(naruto.animations.run.frames, { run_a: frame("run_a"), run_b: frame("run_b") });
  assert.deepEqual(naruto.animations.meleeAttack.frames, {
    ready: frame("idle"), approach: frame("run_a"), punch_1: frame("punch"), recover: frame("run_b"),
  });
  assert.deepEqual(naruto.animations.hit.frames, { hurt: frame("hit_x"), dizzy: frame("hit_x"), recover: frame("idle") });
  assert.equal(naruto.animations.dodge, undefined);
  assert.equal(naruto.animations.death, undefined);
  assert.equal(ANIMATION_TIMING.attack.melee.runFrameMs, 125);
});

test("Naruto v2 action assets are standalone 96 by 112 transparent SVG frames", () => {
  const frameNames = ["idle", "surprised", "hand_head", "smile_thumbs_up", "run_a", "run_b", "punch", "hit_x"];
  for (const name of frameNames) {
    const svg = readFileSync(new URL(`./assets/naruto-v2/frames/${name}.svg`, import.meta.url), "utf8");
    assert.match(svg, /width="96" height="112" viewBox="0 0 96 112"/);
    assert.doesNotMatch(svg, /<rect[^>]*fill="(?:white|#fff(?:fff)?)"/i, `${name} must not have a white canvas background`);
  }
  const runFrames = ["run_a", "run_b"].map((name) => readFileSync(new URL(`./assets/naruto-v2/frames/${name}.svg`, import.meta.url), "utf8"));
  assert.equal(new Set(runFrames.map((frame) => frame.toString("base64"))).size, 2, "run cycle must use distinct poses");
});

test("opening and hit feedback use smooth sky tint and pixel eye marks rather than text symbols", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(html, /class="sky-redness"/);
  assert.equal((html.match(/class="hit-eyes"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /×\s*×/);
  assert.match(css, /\.opening-redshift \.sky-redness/);
  assert.doesNotMatch(css, /red-sky-pulses/);
  assert.doesNotMatch(css, /@keyframes naruto-run-cycle/);
  assert.doesNotMatch(css, /\.fighter\.has-action-sprite \.hit-eyes/);
  assert.match(css, /\.route-player img[^}]*transform: translateY\(8px\)/);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /animationFrameNames\(character, "run"\)/);
  assert.match(app, /animationFrameNames\(attacker, "meleeAttack", "punch_"\)/);
  assert.match(app, /startFrameCycle\(targetEl, target, "death"/);
  assert.match(app, /await preloadEntryAssets\(character\)/);
});

test("melee hit uses the local transparent red effect at the contact point; ranged retains its effect", () => {
  const png = readFileSync(new URL("./assets/effects/normal-attack-hit-red.png", import.meta.url));
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  assert.equal(png.readUInt32BE(16), 1524);
  assert.equal(png.readUInt32BE(20), 999);
  assert.equal(png[25], 6, "effect uses RGBA so its background stays transparent");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.impact-burst\.melee-impact[^}]*normal-attack-hit-red\.png/);
  assert.match(css, /\.impact-burst\.play\.melee-impact \{ animation-name: melee-impact-burst; \}/);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /positionMeleeImpact\(burst, sourceEl, targetEl\)/);
  assert.match(app, /event\.attackType === "melee"/);
  assert.match(css, /background: url\("assets\/effects\/impact\.png"\)/, "ranged and magic retain the existing generic hit effect");
});

test("central combat animation timings target about 20 seconds or 10 seconds for twelve melee actions", () => {
  const { attack } = ANIMATION_TIMING;
  const meleeActionMs = attack.melee.rushMs + attack.melee.punchMs + attack.melee.recoveryMs + attack.eventGapMs;
  const normalSeconds = (12 * meleeActionMs + attack.resultHoldMs) / 1000;
  const fastSeconds = (12 * meleeActionMs / attack.fastPlaybackMultiplier + attack.resultHoldMs / attack.fastPlaybackMultiplier) / 1000;
  assert.ok(normalSeconds >= 20 && normalSeconds < 21);
  assert.ok(fastSeconds >= 10 && fastSeconds < 11);
});



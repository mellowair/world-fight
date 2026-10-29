import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ELITE_ENEMY_DATA, STAGE_TWO_BOSS_DATA, STARTING_CHARACTERS } from "./characters.js";
import { SKILL_DATA } from "./skills.js";
import { advanceBorosRound, changeBorosPhase, detonateDueBombs, executeAttack, initializeBattle, resolveBitesDust, simulateBattle } from "./battle.js";
import { createCampaign, prepareBattle, getRouteEnemyGrowth } from "./campaign.js";
import { createRunCharacterState } from "./progression.js";
import { getCharacterVisual } from "./visualConfig.js";

const ally = (id, extra = {}) => ({ id, name: id, team: "ally", row: "front", hp: 5000,
  atk: 300, def: 100, spd: 80, critChance: 0, rosterOrder: 0, ...extra });
const foe = (data, extra = {}) => ({ ...data, team: "enemy", maxHp: data.hp, currentHp: data.hp,
  critChance: 0, rosterOrder: 2, ...extra });

test("stage-two enemy definitions, formal Boros assets, and skills use the latest base values", () => {
  assert.deepEqual([STAGE_TWO_BOSS_DATA.hp, STAGE_TWO_BOSS_DATA.atk, STAGE_TWO_BOSS_DATA.def, STAGE_TWO_BOSS_DATA.spd], [5500, 600, 170, 150]);
  const toji = ELITE_ENEMY_DATA.find((entry) => entry.id === "toji");
  const kira = ELITE_ENEMY_DATA.find((entry) => entry.id === "kira");
  assert.deepEqual([toji.hp, toji.atk, toji.def, toji.spd], [3500, 430, 170, 220]);
  assert.deepEqual([kira.hp, kira.atk, kira.def, kira.spd], [3300, 400, 120, 80]);
  assert.equal(SKILL_DATA["boros-meteor-burst"].levels[1].chance, 1);
  assert.equal(SKILL_DATA["boros-collapsing-star"].levels[1].chance, 1);
  assert.equal(SKILL_DATA["bites-the-dust"].levels[1].chance, .40);
  for (const enemy of [STAGE_TWO_BOSS_DATA, toji, kira]) assert.ok(existsSync(new URL(`./${enemy.asset}`, import.meta.url)));
  assert.ok(ELITE_ENEMY_DATA.filter((entry) => (entry.stageId ?? 1) === 1).every((entry) => !["toji", "kira"].includes(entry.id)));
  const art = STAGE_TWO_BOSS_DATA;
  assert.equal(art.phaseAssets[2], art.animations.phase2Idle.frames.stage2);
  assert.equal(art.phaseAssets[3], art.animations.phase3Idle.frames.stage3);
  assert.deepEqual(Object.keys(art.animations.meteor.frames), ["fly", "dash"]);
  assert.deepEqual(Object.keys(art.animations.cannon.frames), ["charge"]);
  assert.equal(art.skillVisualTimelines.cannon.totalMs, 1500);
  assert.equal(art.skillVisualTimelines.cannon.chargeMs + art.skillVisualTimelines.cannon.beamMs, 1500);
  assert.ok(art.skillVisualTimelines.cannon.chargeMs < art.skillVisualTimelines.cannon.impactMs);
  assert.ok(art.skillVisualTimelines.cannon.impactMs < art.skillVisualTimelines.cannon.totalMs);
  assert.ok(art.skillVisualTimelines.meteor.impactMs > art.skillVisualTimelines.meteor.takeoffMs + art.skillVisualTimelines.meteor.dashMs);
  for (const path of [art.asset, ...Object.values(art.phaseAssets), ...Object.values(art.animations.meteor.frames),
    art.animations.cannon.frames.charge, art.skillVisualTimelines.meteor.effect, art.skillVisualTimelines.cannon.effect]) {
    const png = readFileSync(new URL(`./${path}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
    assert.equal(png[25], 6, `${path} must have an RGBA transparent-capable pixel format`);
  }
});

test("Kira uses three separate transparent formal frames with a foot-anchored display size", () => {
  const kira = ELITE_ENEMY_DATA.find((entry) => entry.id === "kira");
  const frames = [kira.animations.idle.frames.idle, kira.animations.meleeAttack.frames.punch_1,
    kira.animations.meleeAttack.frames.stand];
  assert.equal(new Set(frames).size, 3);
  assert.equal(kira.asset, frames[0]);
  assert.equal(getCharacterVisual(kira).scale, 1.55);
  assert.equal(getCharacterVisual(kira).offsetY, -10);
  assert.ok(getCharacterVisual(kira).frameHeight > 0);
  for (const path of frames) {
    const png = readFileSync(new URL(`./${path}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png[25], 6, `${path} must retain its RGBA transparency`);
  }
});

test("Boros return and Kira stand keep their separate presentation paths", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /is-boros-punch-returning"\);\s*showFighterFrame\(sourceEl, attacker, "idle", "stage1"\)/);
  assert.match(app, /stand\.src = attacker\.animations\.meleeAttack\.frames\.stand/);
  assert.match(app, /if \(kiraStand\) scheduleBorosVisual\(\(\) => \{ kiraStand\?\.remove\(\)/);
});

test("Boros thresholds are strict, phases never reverse, and crossing both thresholds applies final stats once", () => {
  const state = initializeBattle([ally("hero"), foe(STAGE_TWO_BOSS_DATA)]);
  const boss = state.characters[1];
  state.round = 1;
  boss.currentHp = 4125;
  assert.equal(changeBorosPhase(state, boss), null);
  boss.currentHp = 4124;
  assert.equal(changeBorosPhase(state, boss).phase, 2);
  boss.currentHp = 5500;
  assert.equal(changeBorosPhase(state, boss), null);
  boss.currentHp = 1650;
  assert.equal(changeBorosPhase(state, boss), null);
  boss.currentHp = 1649;
  assert.deepEqual(changeBorosPhase(state, boss), { phase: 3, atk: 720, def: 80, spd: 250 });
  assert.equal(changeBorosPhase(state, boss), null);
  assert.deepEqual([boss.atk, boss.def, boss.spd], [720, 80, 250]);
  const skipped = initializeBattle([ally("hero"), foe(STAGE_TWO_BOSS_DATA)]);
  skipped.round = 1; skipped.characters[1].currentHp = 1000;
  assert.equal(changeBorosPhase(skipped, skipped.characters[1]).phase, 3);
  assert.deepEqual([skipped.characters[1].atk, skipped.characters[1].def, skipped.characters[1].spd], [720, 80, 250]);
});

test("Boros phase one reduces actual hit damage; phase two heals only after a later full round; phase three grows ATK", () => {
  const state = initializeBattle([ally("hero", { atk: 200 }), foe(STAGE_TWO_BOSS_DATA)]);
  const [hero, boss] = state.characters;
  state.round = 1;
  const hit = executeAttack(state, hero, boss, () => .9);
  assert.equal(hit.damage, 66); // 200 ATK through 100/(100+170), then 10% reduction.
  boss.currentHp = 2900;
  changeBorosPhase(state, boss);
  assert.deepEqual(advanceBorosRound(state), []);
  state.round = 2;
  assert.equal(advanceBorosRound(state)[0].healedAmount, 120);
  boss.currentHp = 5480;
  assert.equal(advanceBorosRound(state)[0].healedAmount, 20);
  boss.currentHp = 1000;
  changeBorosPhase(state, boss);
  assert.deepEqual(advanceBorosRound(state), []);
  state.round = 3;
  assert.equal(advanceBorosRound(state)[0].effectiveAtk, 740);
  assert.equal(boss.currentHp, 1000);
});

test("meteor casts alternate one target 1.3x and all targets 0.7x; final cannon hits all targets at 1.5x", () => {
  const heroA = ally("a", { hp: 6000, atk: 350, spd: 90 });
  const heroB = ally("b", { hp: 6000, atk: 350, spd: 70, rosterOrder: 1 });
  const phase2 = simulateBattle([heroA, heroB, foe(STAGE_TWO_BOSS_DATA, { currentHp: 3000 })], () => .49);
  const meteor = phase2.events.filter((entry) => entry.skillId === "boros-meteor-burst");
  assert.equal(meteor[0].skillCastNumber, 1);
  assert.equal(meteor[0].skillMultiplier, 1.3);
  const second = meteor.filter((entry) => entry.skillCastNumber === 2);
  assert.deepEqual(second.map((entry) => entry.targetId), ["a", "b"]);
  assert.ok(second.every((entry) => entry.skillMultiplier === .7));
  const phase3 = simulateBattle([heroA, heroB, foe(STAGE_TWO_BOSS_DATA, { currentHp: 1200 })], () => .49);
  const cannon = phase3.events.filter((entry) => entry.skillId === "boros-collapsing-star");
  assert.deepEqual(cannon.slice(0, 2).map((entry) => entry.targetId), ["a", "b"]);
  assert.ok(cannon.every((entry) => entry.skillMultiplier === 1.5));
  assert.ok(phase3.events.every((entry) => entry.type !== "boros-round-heal"));
});

test("Boros keeps taking an action in every phase and always casts the phase skills", () => {
  const result = simulateBattle([
    ally("tank", { hp: 100000, atk: 500, def: 300, spd: 50 }),
    foe(STAGE_TWO_BOSS_DATA),
  ], () => .99);
  const bossHits = result.events.filter((event) => event.type === "attack" && event.attackerId === "boros");
  const transitions = result.events.filter((event) => event.phaseChange).map((event) => event.round);
  assert.equal(result.outcome, "victory");
  assert.equal(transitions.length, 2);
  assert.ok(bossHits.filter((event) => event.round < transitions[0]).length >= 2);
  assert.ok(bossHits.filter((event) => event.round > transitions[0] && event.round < transitions[1]).length >= 2);
  assert.ok(bossHits.filter((event) => event.round > transitions[1]).length >= 2);
  assert.ok(bossHits.filter((event) => event.round > transitions[0] && event.round < transitions[1]).every((event) => event.skillId === "boros-meteor-burst"));
  assert.ok(bossHits.filter((event) => event.round > transitions[1]).every((event) => event.skillId === "boros-collapsing-star"));
  assert.ok(new Set(bossHits.map((event) => event.round)).size <= bossHits.length);
});

test("Toji locks one target per action, stacks 2 then 3 ordinary segments, and stops at death", () => {
  const toji = ELITE_ENEMY_DATA.find((entry) => entry.id === "toji");
  const result = simulateBattle([ally("a", { hp: 5000, atk: 100, spd: 80 }), ally("b", { hp: 5000, atk: 100, spd: 60, rosterOrder: 1 }), foe(toji)], () => .8);
  const strikes = result.events.filter((event) => event.attackerId === "toji" && event.type === "attack");
  assert.deepEqual(strikes.slice(0, 2).map((event) => event.segmentIndex), [1, 2]);
  assert.ok(strikes.slice(0, 2).every((event) => event.segmentCount === 2 && event.attackKind === "normal"));
  assert.deepEqual(strikes.slice(2, 5).map((event) => event.segmentIndex), [1, 2, 3]);
  assert.equal(new Set(strikes.slice(2, 5).map((event) => event.targetId)).size, 1);
  const slower = simulateBattle([ally("fast", { hp: 5000, atk: 1000, spd: 250 }), foe(toji)], () => .8);
  assert.ok(slower.events.filter((event) => event.attackerId === "toji" && event.type === "attack").every((event) => event.segmentCount === 1));
  const fragile = simulateBattle([ally("fragile", { hp: 100, atk: 1, def: 0, spd: 50 }), foe(toji)], () => .8);
  assert.equal(fragile.events.filter((event) => event.attackerId === "toji" && event.type === "attack").length, 1);
});

test("Kira attaches separate bombs only for actual damage, counts subsequent actual HP losses, and explodes after three rounds", () => {
  const kira = ELITE_ENEMY_DATA.find((entry) => entry.id === "kira");
  const state = initializeBattle([ally("hero", { hp: 1000 }), foe(kira)]);
  const [hero, enemy] = state.characters;
  state.round = 1;
  const first = executeAttack(state, enemy, hero, () => .9, { skill: null });
  assert.equal(first.bombAttached.id, "bomb-1");
  assert.equal(state.bombs[0].dueRound, 4);
  state.round = 2;
  const second = executeAttack(state, enemy, hero, () => .9, { skill: null });
  assert.equal(second.bombAttached.id, "bomb-2");
  assert.equal(state.bombs[0].accumulatedDamage, second.actualDamage);
  assert.equal(state.bombs[1].accumulatedDamage, 0);
  state.round = 3;
  assert.deepEqual(detonateDueBombs(state), []);
  state.round = 4;
  const explosion = detonateDueBombs(state);
  assert.equal(explosion.length, 1);
  assert.equal(explosion[0].actualDamage, Math.floor(second.actualDamage * 100 / (100 + hero.def)));
  assert.equal(state.bombs[0].accumulatedDamage, explosion[0].actualDamage);
  assert.equal(detonateDueBombs(state).length, 0);
});

test("dodged or immune hits cannot create a bomb, and a fresh battle has no old enemy state", () => {
  const kira = ELITE_ENEMY_DATA.find((entry) => entry.id === "kira");
  const state = initializeBattle([ally("hero", { hp: 1000, spd: 100 }), foe(kira)]);
  state.round = 1;
  const dodged = executeAttack(state, state.characters[1], state.characters[0], () => 0, { skill: null });
  assert.equal(dodged.dodged, true);
  assert.equal(dodged.bombAttached, null);
  assert.equal(state.bombs.length, 0);
  const nextBattle = initializeBattle([ally("hero"), foe(kira)]);
  assert.deepEqual(nextBattle.bombs, []);
  assert.deepEqual(nextBattle.characters[1].hpSnapshots, []);
  assert.equal(nextBattle.nextBombId, 1);
});

test("simultaneous bomb detonations use attach order and feed later bombs without making a new one", () => {
  const kira = ELITE_ENEMY_DATA.find((entry) => entry.id === "kira");
  const state = initializeBattle([ally("hero", { hp: 1000 }), foe(kira)]);
  state.round = 4;
  state.bombs = [
    { id: "bomb-1", targetId: "hero", attachedRound: 1, dueRound: 4, accumulatedDamage: 100 },
    { id: "bomb-2", targetId: "hero", attachedRound: 2, dueRound: 4, accumulatedDamage: 30 },
  ];
  const events = detonateDueBombs(state);
  assert.deepEqual(events.map((event) => [event.bombId, event.actualDamage]), [["bomb-1", 50], ["bomb-2", 40]]);
  assert.equal(state.characters[0].currentHp, 910);
  assert.equal(state.bombs.length, 0);
  assert.equal(detonateDueBombs(state).length, 0);
});

test("Bites the Dust reads the two-round-old HP snapshot, can lower HP, and advances bombs once", () => {
  const kira = ELITE_ENEMY_DATA.find((entry) => entry.id === "kira");
  const state = initializeBattle([ally("hero", { hp: 1000 }), foe(kira, { currentHp: 1500 })]);
  const enemy = state.characters[1];
  state.round = 3;
  enemy.hpSnapshots.push({ round: 1, hp: 1000 });
  state.bombs.push({ id: "bomb-1", targetId: "hero", attachedRound: 1, dueRound: 4, accumulatedDamage: 100 });
  const events = resolveBitesDust(state, enemy);
  assert.equal(enemy.currentHp, 1000);
  assert.equal(events[0].fallback, false);
  assert.equal(events[0].bombsAdvanced, 1);
  assert.equal(events[1].type, "bomb-explode");
  assert.equal(state.bombs.length, 0);
  assert.equal(resolveBitesDust(state, enemy)[0].hpAfter, 1000);
  const noHistory = initializeBattle([ally("hero"), foe(kira, { currentHp: 1500 })]);
  noHistory.round = 1;
  assert.equal(resolveBitesDust(noHistory, noHistory.characters[1])[0].fallback, true);
});

test("stage-two elite and Boss combat copies apply only the correct growth once", () => {
  const campaign = createCampaign(() => .5, { seed: 713 });
  campaign.stageId = 2; campaign.step = 17; campaign.status = "combat";
  const hero = STARTING_CHARACTERS[0];
  campaign.playerId = hero.id; campaign.partyIds = [hero.id];
  campaign.runCharacterState = createRunCharacterState(hero);
  campaign.partyStates = { [hero.id]: campaign.runCharacterState };
  campaign.stageStep = 6;
  for (const id of ["toji", "kira"]) {
    const template = ELITE_ENEMY_DATA.find((entry) => entry.id === id);
    campaign.combatLaunched = false;
    campaign.currentBattle = { type: "elite", step: 17, enemies: [id], enemyNames: { [id]: template.name } };
    const prepared = prepareBattle(campaign);
    const enemy = prepared.roster.find((entry) => entry.id === id);
    assert.deepEqual([enemy.maxHp, enemy.atk, enemy.def, enemy.spd],
      [template.hp, template.atk, template.def, template.spd]);
  }
  campaign.combatLaunched = false;
  campaign.currentBattle = { type: "boss", step: 24, enemies: ["boros"], enemyNames: { boros: "波罗斯" }, enemyGrowthExemptIds: ["boros"] };
  const boss = prepareBattle(campaign).roster.find((entry) => entry.id === "boros");
  assert.deepEqual([boss.maxHp, boss.atk, boss.def, boss.spd], [5500, 600, 170, 150]);
});

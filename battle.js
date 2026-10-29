import { CHARACTER_DATA, COMBAT_RULES } from "./characters.js";
import { evaluatePassive } from "./progression.js";
import { SKILL_DATA } from "./skills.js";

const MAHITO_ATTACK_BONUS = SKILL_DATA["mahito-domain"].levels[1].attackBonusPerRound;

export function initializeBattle(config = CHARACTER_DATA, options = {}) {
  const characters = config.map((character) => {
    const maxHp = character.maxHp ?? character.hp;
    const currentHp = Math.max(0, Math.min(maxHp, character.currentHp ?? character.hp));
    return { ...character, skill: character.skill ? { ...character.skill } : null, skills: character.skills?.map((skill) => ({ ...skill })) ?? character.skills, maxHp, currentHp, alive: currentHp > 0, elitePassiveActive: false, elitePassiveLastRound: 0, freeWillTriggers: 0, damageTakenHits: 0, critRateBonus: (character.critRateBonus ?? 0) + (character.passiveSkillId === "kaneki-one-eye" && character.passiveLevel >= 2 ? 0.10 : 0), dodgeRateBonus: character.dodgeRateBonus ?? 0, battleAttackBonus: 0, shieldHp: 0,
      ...(character.phaseSkills ? { borosPhase: 1, borosEnteredRound: 0, meteorCasts: 0 } : {}),
      ...(character.id === "eren" ? { freeWillDefenseStacks: 0 } : {}),
      ...(character.elitePassiveId === "toji-heavenly-restriction" ? { fasterActions: 0 } : {}),
      ...(character.elitePassiveId === "killer-queen" ? { hpSnapshots: [] } : {}),
      ...(character.id === "armored-titan" ? { armorReductionStartRound: null, armorReductionUntilRound: null } : {}),
      ...(character.periodicPassive?.id === "colossal-steam-wave" ? { lastSteamRound: 0 } : {}),
      ...(character.id === "gilgamesh" ? { gilgameshCasts: 0 } : {}) };
  });
  const c0Boss = characters.find((character) => Number.isFinite(character.c0DamagePerRound));
  const state = {
    characters,
    round: 0,
    status: "ready",
    runCharacterState: options.runCharacterState ?? null,
    runCharacterStates: options.runCharacterStates ?? (options.runCharacterState ? { [options.runCharacterState.characterId]: options.runCharacterState } : {}),
    playerId: options.playerId ?? options.runCharacterState?.characterId ?? null,
    battleId: options.battleId ?? null,
    battleStartEffects: options.battleStartEffects?.map((effect) => ({ ...effect })) ?? [],
    c0: c0Boss ? { bossId: c0Boss.id, damagePerRound: c0Boss.c0DamagePerRound, completedRounds: 0, detonated: false, currentRound: 0, playerActionDone: false, bossActionDone: false } : null,
    bombs: [], nextBombId: 1,
  };
  if (state.battleId) for (const player of state.characters.filter((character) => character.team === "ally"))
    player.jinchurikiTriggered = false;
  return state;
}

export function getActionOrder(state) {
  return state.characters.filter((c) => c.alive && c.currentHp > 0)
    .sort((a, b) => b.spd - a.spd || a.rosterOrder - b.rosterOrder);
}

export function chooseTarget(state, attacker, random = Math.random) {
  const candidates = state.characters.filter((c) => c.team !== attacker.team && c.alive && c.currentHp > 0);
  const frontRow = candidates.filter((c) => c.row === "front");
  const pool = frontRow.length ? frontRow : candidates;
  return pool.length ? pool[Math.floor(random() * pool.length)] : null;
}

export function skillTriggers(character, random = Math.random) {
  const skills = (character.skills?.length ? character.skills : character.skill ? [character.skill] : []).filter((skill) => skill.triggerType !== "on_damage");
  return skills.some((skill) => random() < skill.chance);
}

function triggeredSkill(character, random) {
  const phaseSkillId = character.phaseSkills?.[character.borosPhase];
  if (character.phaseSkills) {
    const config = SKILL_DATA[phaseSkillId];
    const skill = config?.levels?.[1] ? { ...config, ...config.levels[1], level: 1 } : null;
    return skill && random() < skill.chance ? skill : null;
  }
  const skills = (character.skills?.length ? character.skills : character.skill ? [character.skill] : []).filter((skill) => skill.triggerType !== "on_damage");
  for (const skill of skills) if (random() < skill.chance) return skill;
  return null;
}

export function calculateDamage(attacker, target, multiplier = 1) {
  // Negative DEF is permitted by battle debuffs; keep the divisor finite.
  const effectiveDef = Number.isFinite(target.def) ? Math.max(-99, target.def) : 0;
  const base = (attacker.atk * 100) / (100 + effectiveDef);
  return Math.max(1, Math.floor(base * multiplier));
}

function applyNormalDamageReduction(target, damage) {
  if (damage <= 0) return 0;
  return Math.max(1, Math.floor(damage * (1 - Math.min(.99, target.damageReductionBonus ?? 0))));
}

export function getDodgeChance(character) {
  const normal = Number.isFinite(character.normalDodgeRate) ? character.normalDodgeRate
    : COMBAT_RULES.baseDodgeChance + character.spd * COMBAT_RULES.dodgePerSpeed + (character.dodgeRateBonus ?? 0);
  return Math.max(0, Math.min(COMBAT_RULES.maxDodgeChance, normal));
}

export function getSkillDodgeChance(character) {
  const skill = Number.isFinite(character.skillDodgeRate) ? character.skillDodgeRate
    : (COMBAT_RULES.baseDodgeChance + character.spd * COMBAT_RULES.dodgePerSpeed) * COMBAT_RULES.skillDodgeFactor
      + (character.skillDodgeRateBonus ?? 0);
  return Math.max(0, Math.min(COMBAT_RULES.skillDodgeChanceCap, skill));
}

export function getCritChance(character) {
  return Math.max(0, Math.min(COMBAT_RULES.maxCritChance, (character.critChance ?? COMBAT_RULES.baseCritChance) + (character.critRateBonus ?? 0)));
}

export function handleDeath(character) {
  if (character.currentHp <= 0) {
    character.currentHp = 0;
    character.alive = false;
    if (character.id === "armored-titan") {
      character.armorReductionStartRound = null;
      character.armorReductionUntilRound = null;
    }
    return true;
  }
  return false;
}

export function isBattleOver(state) {
  if (state.forcedOutcome) return state.forcedOutcome;
  const livingTeams = new Set(state.characters.filter((c) => c.alive && c.currentHp > 0).map((c) => c.team));
  if (!livingTeams.has("ally")) return "defeat";
  if (!livingTeams.has("enemy")) return "victory";
  return null;
}

export function summonAtRoundStart(state) {
  const summonedEvents = [];
  for (const summoner of [...state.characters]) {
    const passive = summoner.summonPassive;
    if (!summoner.alive || !passive?.unit || state.round < passive.firstRound
      || (state.round - passive.firstRound) % passive.everyRounds !== 0
      || summoner.lastSummonedRound === state.round) continue;
    const unit = passive.unit;
    const summoned = {
      ...unit, id: `${summoner.id}-summon-${state.round}`, name: unit.name,
      maxHp: unit.maxHp ?? unit.hp, currentHp: unit.maxHp ?? unit.hp,
      alive: true, team: summoner.team, row: "front", position: "front",
      skill: unit.skill ? { ...unit.skill } : null,
    };
    summoner.lastSummonedRound = state.round;
    state.characters.push(summoned);
    summonedEvents.push({ type: "summon", round: state.round, summonerId: summoner.id,
      passiveName: passive.name, character: { ...summoned } });
  }
  if (!state.forcedOutcome && state.characters.some((unit) => unit.id === "dina") &&
    state.characters.filter((unit) => unit.id.startsWith("dina-summon-") && unit.alive && unit.currentHp > 0).length >= 4) {
    state.forcedOutcome = "defeat";
    summonedEvents.push({ type: "giant-overrun", round: state.round, text: "你被巨人淹没了...." });
  }
  return summonedEvents;
}

// Periodic passives use the global round counter, independent of SPD and action order.
// True damage follows C0 precedence: no DEF, dodge, crit, or normal damage modifiers.
export function triggerSteamWaveAtRoundStart(state) {
  const giant = state.characters.find((character) => character.periodicPassive?.id === "colossal-steam-wave");
  const passive = giant?.periodicPassive;
  if (!giant?.alive || giant.currentHp <= 0 || !passive || state.round < 1
    || state.round % passive.everyRounds !== 0 || giant.lastSteamRound === state.round) return null;
  giant.lastSteamRound = state.round;
  const targets = state.characters.filter((character) => character.alive && character.currentHp > 0 &&
    (character.team === "ally" || character.id === "armored-titan"));
  const hits = [];
  for (const target of targets) {
    const hpBefore = target.currentHp;
    const damage = target.id === "armored-titan" ? passive.armoredDamage : passive.allyDamage;
    target.currentHp = Math.max(0, hpBefore - damage);
    const actualDamage = hpBefore - target.currentHp;
    accumulateBombDamage(state, target.id, actualDamage);
    const targetDied = handleDeath(target);
    if (targetDied) state.bombs = state.bombs.filter((bomb) => bomb.targetId !== target.id);
    hits.push({ targetId: target.id, damage, actualDamage, hpBefore, hpAfter: target.currentHp, targetDied });
  }
  return { type: "steam-wave", skillId: passive.id, skillName: passive.name, attackerId: giant.id,
    round: state.round, trueDamage: true, hits };
}

export function expireArmoredShieldAtRoundEnd(state) {
  const armored = state.characters.find((character) => character.id === "armored-titan");
  if (!armored?.alive || armored.armorReductionUntilRound == null || armored.armorReductionUntilRound > state.round) return null;
  armored.armorReductionStartRound = null;
  armored.armorReductionUntilRound = null;
  return { type: "armor-shield-expired", targetId: armored.id, round: state.round };
}

export function changeBorosPhase(state, character) {
  if (!character.phaseSkills || character.currentHp <= 0) return null;
  const next = character.currentHp < character.maxHp * .30 ? 3 : character.currentHp < character.maxHp * .75 ? 2 : 1;
  if (next <= character.borosPhase) return null;
  character.borosPhase = next;
  character.borosEnteredRound = state.round;
  if (next === 3) {
    character.atk += 120;
    character.def = Math.max(-20, character.def - 90);
    character.spd += 100;
  }
  return { phase: next, atk: character.atk, def: character.def, spd: character.spd };
}

function accumulateBombDamage(state, targetId, actualDamage) {
  if (actualDamage <= 0) return;
  for (const bomb of state.bombs ?? []) if (bomb.targetId === targetId) bomb.accumulatedDamage += actualDamage;
}

function attachBomb(state, attacker, target) {
  state.bombs ??= [];
  state.nextBombId ??= 1;
  const bomb = { id: `bomb-${state.nextBombId++}`, attackerId: attacker.id, targetId: target.id,
    attachedRound: state.round, dueRound: state.round + 3, accumulatedDamage: 0 };
  state.bombs.push(bomb);
  return { id: bomb.id, targetId: target.id, attachedRound: bomb.attachedRound, dueRound: bomb.dueRound };
}

export function detonateDueBombs(state) {
  const events = [];
  // Stable order also applies when Bites the Dust makes several bombs due together.
  const due = state.bombs.filter((bomb) => bomb.dueRound <= state.round)
    .sort((a, b) => a.attachedRound - b.attachedRound || Number(a.id.slice(5)) - Number(b.id.slice(5)));
  for (const bomb of due) {
    if (!state.bombs.includes(bomb)) continue;
    state.bombs.splice(state.bombs.indexOf(bomb), 1);
    const target = state.characters.find((entry) => entry.id === bomb.targetId);
    if (!target?.alive || target.currentHp <= 0) continue;
    const hpBefore = target.currentHp;
    const effectiveDef = target.def + ((target.defenseBuffUntilRound ?? -1) >= state.round ? target.defenseBuff ?? 0 : 0);
    const damage = bomb.accumulatedDamage > 0
      ? applyNormalDamageReduction(target, calculateDamage({ atk: bomb.accumulatedDamage }, { def: effectiveDef })) : 0;
    target.currentHp = Math.max(0, hpBefore - damage);
    const actualDamage = hpBefore - target.currentHp;
    // This bomb is already removed, so its explosion only feeds other bombs.
    accumulateBombDamage(state, target.id, actualDamage);
    const died = handleDeath(target);
    if (died) state.bombs = state.bombs.filter((entry) => entry.targetId !== target.id);
    events.push({ type: "bomb-explode", round: state.round, bombId: bomb.id, targetId: target.id,
      damage, accumulatedDamage: bomb.accumulatedDamage, actualDamage, hpBefore, hpAfter: target.currentHp, targetDied: died });
  }
  return events;
}

export function resolveBitesDust(state, attacker) {
  const snapshot = attacker.hpSnapshots.find((entry) => entry.round === state.round - 2);
  const hpBefore = attacker.currentHp;
  attacker.currentHp = Math.max(0, Math.min(attacker.maxHp, snapshot?.hp ?? attacker.currentHp));
  const died = handleDeath(attacker);
  for (const bomb of state.bombs) bomb.dueRound -= 1;
  return [{ type: "bites-dust", round: state.round, attackerId: attacker.id, skillName: "败者食尘",
    hpBefore, hpAfter: attacker.currentHp, snapshotRound: snapshot?.round ?? null,
    fallback: !snapshot, targetDied: died, bombsAdvanced: state.bombs.length }, ...detonateDueBombs(state)];
}

export function executeAttack(state, attacker, target, random = Math.random, attackOptions = {}) {
  if (!attacker?.alive || attacker.currentHp <= 0 || !target?.alive || target.currentHp <= 0) return null;
  let elitePassiveTriggered = null;
  if (attacker.elitePassiveId === "mahito-domain" && !attacker.elitePassiveActive && attacker.currentHp < attacker.maxHp * 0.5) {
    attacker.elitePassiveActive = true;
    attacker.elitePassiveLastRound = state.round ?? 1;
    attacker.atk += MAHITO_ATTACK_BONUS;
    elitePassiveTriggered = { skillId: "mahito-domain", skillName: "自闭圆顿裹", attackBonus: MAHITO_ATTACK_BONUS, effectiveAtk: attacker.atk, round: state.round ?? 1 };
  }
  let jinchurikiTriggered = null;
  const attackerRun = state.runCharacterStates?.[attacker.id] ?? (attacker.id === state.playerId ? state.runCharacterState : null);
  const targetRun = state.runCharacterStates?.[target.id] ?? (target.id === state.playerId ? state.runCharacterState : null);
  if (attackerRun && state.battleId && !attacker.jinchurikiTriggered) {
    const passive = evaluatePassive(attackerRun, "before_attack", { battleId: state.battleId, currentHp: attacker.currentHp, maxHp: attacker.maxHp });
    if (passive?.skillId === "jinchuriki") {
      const originalAtk = attacker.atk;
      attacker.atk = passive.rounding === "floor" ? Math.floor(originalAtk * (1 + passive.attackBonus)) : originalAtk * (1 + passive.attackBonus);
      attacker.jinchurikiTriggered = true;
      jinchurikiTriggered = { ...passive, originalAtk, effectiveAtk: attacker.atk };
    }
  }
  const skill = Object.hasOwn(attackOptions, "skill") ? attackOptions.skill : triggeredSkill(attacker, random);
  if (skill?.effectType === "next-round-reduction") {
    const activeNow = attacker.armorReductionStartRound != null && attacker.armorReductionStartRound <= state.round
      && attacker.armorReductionUntilRound >= state.round;
    attacker.armorReductionStartRound = activeNow ? attacker.armorReductionStartRound : state.round + 1;
    attacker.armorReductionUntilRound = Math.max(attacker.armorReductionUntilRound ?? 0, state.round + 1);
    return { type: "skill", attackerId: attacker.id, targetId: attacker.id, skillId: skill.id,
      skillName: skill.name, skillLevel: skill.level, effectType: skill.effectType,
      reduction: skill.reduction, effectiveFromRound: attacker.armorReductionStartRound,
      effectiveUntilRound: attacker.armorReductionUntilRound };
  }
  if (skill?.effectType === "buff") {
    const duration = Math.max(1, Math.floor(skill.durationTurns ?? 1));
    attacker.defenseBuff = Math.max(attacker.defenseBuff ?? 0, skill.defenseBonus ?? 0);
    attacker.defenseBuffUntilRound = (state.round ?? 1) + duration - 1;
    return {
      type: "skill", attackerId: attacker.id, skillName: skill.name, skillId: skill.id,
      skillLevel: skill.level, effectType: "buff", defenseBonus: skill.defenseBonus ?? 0,
      targetId: attacker.id, targetHp: attacker.currentHp, targetMaxHp: attacker.maxHp,
    };
  }
  const defenseBonusApplied = skill?.defenseBonus && skill.stackDefenseBonus
    && (attacker.freeWillDefenseStacks ?? 0) < (skill.maxDefenseStacks ?? Infinity) ? skill.defenseBonus : 0;
  if (defenseBonusApplied) {
    attacker.defenseBuff = (attacker.defenseBuff ?? 0) + skill.defenseBonus;
    attacker.defenseBuffUntilRound = skill.defenseDuration === "battle" ? Number.POSITIVE_INFINITY : (state.round ?? 1);
    if (skill.id === "eren-free-will") attacker.freeWillDefenseStacks = (attacker.freeWillDefenseStacks ?? 0) + 1;
  }
  let healedAmount = 0;
  if (skill?.id === "eren-free-will") {
    attacker.freeWillTriggers = (attacker.freeWillTriggers ?? 0) + 1;
    if (attacker.freeWillTriggers % skill.healEveryTriggers === 0) {
      const requested = Math.floor(attacker.maxHp * skill.healMaxHpFraction);
      healedAmount = Math.max(0, Math.min(requested, attacker.maxHp - attacker.currentHp));
      attacker.currentHp += healedAmount;
    }
  }
  if (skill?.doubleNextDamage) attacker.doubleNextDamage = true;
  const shieldsGranted = [];
  if (skill?.teamShield) for (const ally of state.characters.filter((unit) => unit.team === attacker.team && unit.alive && unit.currentHp > 0)) {
    ally.shieldHp = (ally.shieldHp ?? 0) + skill.teamShield;
    shieldsGranted.push({ targetId: ally.id, amount: skill.teamShield, total: ally.shieldHp });
  }
  const directDamageSkill = skill && !skill.normalAttack && (skill.effectType ?? "damage") === "damage";
  const dodgeChance = directDamageSkill ? getSkillDodgeChance(target) : getDodgeChance(target);
  const dodged = !attacker.unavoidableAttack && random() < dodgeChance;
  const targetHpBefore = target.currentHp;
  const critChance = skill?.guaranteedCritBelowHpRatio != null && targetHpBefore < target.maxHp * skill.guaranteedCritBelowHpRatio
    ? 1 : getCritChance(attacker);
  const critical = !dodged && random() < critChance;
  const formula = skill?.multiplierFormula;
  const skillMultiplier = !skill ? 1 : formula
    ? (formula.base ?? 0) + (attacker[formula.stat] ?? 0) * (formula.coefficient ?? 0)
    : skill.multiplier ?? 1;
  const currentDefenseBonus = (attacker.defenseBuffUntilRound ?? -1) >= (state.round ?? 1) ? attacker.defenseBuff ?? 0 : 0;
  const skillAttackPower = skill?.attackFormula === "atk_plus_current_def"
    ? attacker.atk + attacker.def + currentDefenseBonus
    : skill?.attackFormula === "atk_plus_spd" ? attacker.atk + attacker.spd : attacker.atk;
  const targetEffectiveDef = target.def + ((target.defenseBuffUntilRound ?? -1) >= (state.round ?? 1) ? target.defenseBuff ?? 0 : 0);
  let damage = dodged ? 0 : calculateDamage({ ...attacker, atk: skillAttackPower }, { ...target, def: targetEffectiveDef * (1 - (skill?.ignoreDefenseFraction ?? 0)) }, skillMultiplier * (critical ? COMBAT_RULES.critMultiplier : 1));
  if (damage > 0 && Number.isInteger(attacker.weaknessRound) && attacker.weaknessRound === state.round)
    damage = Math.max(1, Math.floor(damage * .5));
  if (!dodged && attacker.damageDealtMultiplier > 1) damage = Math.floor(damage * attacker.damageDealtMultiplier);
  let passiveTriggered = null;
  let doubleDamageConsumed = false;
  if (!dodged && state.battleId) {
    if (attackerRun) {
      const passive = evaluatePassive(attackerRun, "before_attack", { battleId: state.battleId, damage });
      if (passive) damage = Math.max(1, passive.finalDamage ?? damage);
    }
    if (targetRun) {
      passiveTriggered = evaluatePassive(targetRun, "before_damage", { battleId: state.battleId, damage });
      if (passiveTriggered) damage = passiveTriggered.damageImmune ? 0 : Math.max(1, passiveTriggered.finalDamage ?? damage);
    }
  }
  if (!dodged && target.damageTakenMultiplier > 1) damage = Math.floor(damage * target.damageTakenMultiplier);
  if (!dodged && target.doubleNextDamage) {
    target.doubleNextDamage = false;
    doubleDamageConsumed = true;
    if (!passiveTriggered?.damageImmune) damage *= 2;
  }
  if (damage > 0 && target.borosPhase === 1) damage = Math.max(1, Math.floor(damage * .9));
  const armorReductionApplied = damage > 0 && target.id === "armored-titan"
    && target.armorReductionStartRound != null && state.round >= target.armorReductionStartRound
    && state.round <= target.armorReductionUntilRound;
  if (armorReductionApplied) damage = Math.max(1, Math.floor(damage * .5));
  damage = applyNormalDamageReduction(target, damage);
  const shieldAbsorbed = Math.min(damage, target.shieldHp ?? 0);
  target.shieldHp = Math.max(0, (target.shieldHp ?? 0) - shieldAbsorbed);
  damage -= shieldAbsorbed;
  target.currentHp = Math.max(0, target.currentHp - damage);
  const actualDamage = targetHpBefore - target.currentHp;
  accumulateBombDamage(state, target.id, actualDamage);
  const oneEyeTriggered = damage > 0 && actualDamage > 0 && critical && attacker.passiveSkillId === "kaneki-one-eye";
  let oneEyeHealedAmount = 0;
  if (oneEyeTriggered) {
    oneEyeHealedAmount = Math.max(0, Math.min(attacker.maxHp - attacker.currentHp, Math.floor(damage * SKILL_DATA["kaneki-one-eye"].levels[attacker.passiveLevel ?? 1].healFromCalculatedDamage)));
    attacker.currentHp += oneEyeHealedAmount;
    healedAmount += oneEyeHealedAmount;
  }
  let damageSkillTriggered = null;
  const reactiveSkill = target.skills?.find((entry) => entry.id === "kaneki-1000-7")
    ?? (target.skill?.id === "kaneki-1000-7" ? target.skill : null);
  if (actualDamage > 0 && reactiveSkill) {
    target.damageTakenHits = (target.damageTakenHits ?? 0) + 1;
    if (target.damageTakenHits % reactiveSkill.hitsPerTrigger === 0) {
      target.critRateBonus = (target.critRateBonus ?? 0) + reactiveSkill.critRateBonus;
      target.dodgeRateBonus = (target.dodgeRateBonus ?? 0) + reactiveSkill.dodgeRateBonus;
      target.battleAttackBonus = (target.battleAttackBonus ?? 0) + (reactiveSkill.attackBonus ?? 0);
      target.atk += reactiveSkill.attackBonus ?? 0;
      damageSkillTriggered = {
        skillId: reactiveSkill.id, skillName: reactiveSkill.name, hits: target.damageTakenHits,
        critRateGain: reactiveSkill.critRateBonus, dodgeRateGain: reactiveSkill.dodgeRateBonus,
        critRateBonus: target.critRateBonus, dodgeRateBonus: target.dodgeRateBonus,
        attackGain: reactiveSkill.attackBonus ?? 0, effectiveAtk: target.atk,
      };
    }
  }
  let died = !dodged && handleDeath(target);
  if (skill?.id === "gilgamesh-enuma-elish" && attackOptions.gilgameshCast === 1 && !dodged && actualDamage > 0 && !died)
    target.weaknessRound = state.round + 1;
  const phaseChange = !died ? changeBorosPhase(state, target) : null;
  if (died && state.bombs) state.bombs = state.bombs.filter((bomb) => bomb.targetId !== target.id);
  const bombAttached = actualDamage > 0 && !died && attacker.elitePassiveId === "killer-queen"
    ? attachBomb(state, attacker, target) : null;
  const defenseFloor = Number.isFinite(skill?.defenseFloor) ? skill.defenseFloor : 0;
  const nextDefense = !dodged && !died && (skill?.defenseReduction ?? 0) > 0
    ? Math.max(defenseFloor, target.def - skill.defenseReduction)
    : target.def;
  const defenseReduced = target.def - nextDefense;
  if (defenseReduced > 0) target.def = nextDefense;
  let extraTrueDamage = null;
  if (skill?.id === "eren-free-will" && skill.extraTrueDamageEvery && attacker.freeWillTriggers % skill.extraTrueDamageEvery === 0 && target.alive) {
    const requested = Math.max(0, Math.floor((attacker.def + currentDefenseBonus) * skill.extraTrueDamageDefRatio));
    const hpBefore = target.currentHp;
    const absorbed = Math.min(requested, target.shieldHp ?? 0);
    target.shieldHp -= absorbed;
    target.currentHp = Math.max(0, target.currentHp - (requested - absorbed));
    const actual = hpBefore - target.currentHp;
    accumulateBombDamage(state, target.id, actual);
    extraTrueDamage = { requested, actualDamage: actual, shieldAbsorbed: absorbed, hpBefore, hpAfter: target.currentHp, targetDied: handleDeath(target) };
    if (extraTrueDamage.targetDied) { died = true; state.bombs = state.bombs.filter((bomb) => bomb.targetId !== target.id); }
  }
  const predatorKillBonus = skill?.id === "kaneki-predator" && skill.killMaxHpBonus && !dodged && target.currentHp <= 0
    ? skill.killMaxHpBonus : 0;
  if (predatorKillBonus) {
    attacker.maxHp += predatorKillBonus;
    if (attackerRun) attackerRun.maxHp += predatorKillBonus;
  }
  const jinchurikiLifesteal = attacker.passiveSkillId === "jinchuriki" && attacker.passiveLevel >= 2 && attacker.jinchurikiTriggered && actualDamage > 0
    ? Math.min(attacker.maxHp - attacker.currentHp, Math.floor(actualDamage * (SKILL_DATA.jinchuriki.levels[2].lifesteal ?? 0))) : 0;
  if (jinchurikiLifesteal) { attacker.currentHp += jinchurikiLifesteal; healedAmount += jinchurikiLifesteal; }
  const treasureLifesteal = actualDamage > 0 && attacker.lifesteal > 0
    ? Math.min(attacker.maxHp - attacker.currentHp, Math.floor(actualDamage * attacker.lifesteal)) : 0;
  if (treasureLifesteal) { attacker.currentHp += treasureLifesteal; healedAmount += treasureLifesteal; }
  return {
    type: "attack", attackerId: attacker.id, targetId: target.id, damage, dodged,
    hit: !dodged, dodgeChance, critical, critChance, skilled: Boolean(skill),
    attackKind: directDamageSkill ? "skill" : "normal",
    attackType: skill?.attackType || attacker.attackType || "melee",
    skillId: skill?.id ?? null, skillLevel: skill?.level ?? null,
    skillName: skill?.name ?? null,
    skillCastId: skill ? [state.battleId ?? "battle", state.round, attacker.id].join(":") : null,
    skillMultiplier: skill ? skillMultiplier : null,
    skillAttackPower: skill?.attackFormula ? skillAttackPower : null,
    skillCloneCount: skill?.cloneCount ?? null,
    defenseBonusApplied,
    freeWillDefenseStacks: skill?.id === "eren-free-will" ? attacker.freeWillDefenseStacks : null,
    freeWillTriggerCount: skill?.id === "eren-free-will" ? attacker.freeWillTriggers : null,
    healedAmount, oneEyeTriggered, oneEyeHealedAmount, treasureLifesteal, actualDamage, calculatedDamage: damage, attackerHp: attacker.currentHp, damageSkillTriggered,
    hpBefore: targetHpBefore,
    shieldAbsorbed, targetShield: target.shieldHp, shieldsGranted, weaknessApplied: target.weaknessRound === state.round + 1,
    extraTrueDamage, predatorKillBonus, jinchurikiLifesteal,
    doubleDamageArmed: Boolean(skill?.doubleNextDamage), doubleDamageConsumed,
    jinchurikiTriggered,
    elitePassiveTriggered,
    passiveTriggered: passiveTriggered ? { skillId: passiveTriggered.skillId, damageImmune: Boolean(passiveTriggered.damageImmune) } : null,
    defenseReduced, armorReductionApplied,
    phaseChange, bombAttached, segmentIndex: attackOptions.segmentIndex ?? null,
    segmentCount: attackOptions.segmentCount ?? null, skillCastNumber: attackOptions.skillCastNumber ?? null,
    targetDef: target.def,
    attackerTeam: attacker.team,
    targetHp: target.currentHp, targetMaxHp: target.maxHp, targetDied: died,
  };
}

function recordC0Action(state, event) {
  const c0 = state.c0;
  if (!c0 || c0.detonated || event.type !== "attack") return null;
  if (c0.currentRound !== state.round) {
    c0.currentRound = state.round;
    c0.playerActionDone = false;
    c0.bossActionDone = false;
  }
  const actor = state.characters.find((character) => character.id === event.attackerId);
  if (actor?.team === "ally") c0.playerActionDone = true;
  if (actor?.id === c0.bossId) c0.bossActionDone = true;
  if (!c0.playerActionDone || !c0.bossActionDone) return null;
  c0.completedRounds += 1;
  c0.playerActionDone = false;
  c0.bossActionDone = false;
  return { type: "c0-charge", bossId: c0.bossId, completedRounds: c0.completedRounds, accumulatedDamage: c0.completedRounds * c0.damagePerRound };
}

function resolveTrueDamageSkill(state, attacker, target, skill, amount) {
  const hpBefore = target.currentHp;
  const shieldAbsorbed = Math.min(amount, target.shieldHp ?? 0);
  target.shieldHp = Math.max(0, (target.shieldHp ?? 0) - shieldAbsorbed);
  const damage = amount - shieldAbsorbed;
  target.currentHp = Math.max(0, hpBefore - damage);
  const actualDamage = hpBefore - target.currentHp;
  accumulateBombDamage(state, target.id, actualDamage);
  const targetDied = handleDeath(target);
  return { type: "attack", attackerId: attacker.id, attackerTeam: attacker.team, targetId: target.id,
    skillId: skill.id, skillName: skill.name, skillLevel: skill.level, skilled: true, attackKind: "skill",
    attackType: "magic", trueDamage: true, damage, actualDamage, calculatedDamage: damage,
    dodged: false, hit: true, critical: false, shieldAbsorbed, targetShield: target.shieldHp,
    targetHp: target.currentHp, targetMaxHp: target.maxHp, targetDied, attackerHp: attacker.currentHp };
}

function resolveCloneSplash(state, attacker, primary, skill, random) {
  const splash = [];
  const base = Math.floor(primary.calculatedDamage * skill.splashRatio);
  for (const target of state.characters.filter((unit) => unit.team !== attacker.team && unit.id !== primary.targetId && unit.alive && unit.currentHp > 0)) {
    const dodged = !attacker.unavoidableAttack && random() < getSkillDodgeChance(target);
    let damage = dodged ? 0 : applyNormalDamageReduction(target, calculateDamage({ atk: base }, { def: target.def + ((target.defenseBuffUntilRound ?? -1) >= state.round ? target.defenseBuff ?? 0 : 0) }));
    const shieldAbsorbed = Math.min(damage, target.shieldHp ?? 0);
    target.shieldHp = Math.max(0, (target.shieldHp ?? 0) - shieldAbsorbed);
    damage -= shieldAbsorbed;
    const hpBefore = target.currentHp;
    target.currentHp = Math.max(0, hpBefore - damage);
    const actualDamage = hpBefore - target.currentHp;
    accumulateBombDamage(state, target.id, actualDamage);
    const targetDied = handleDeath(target);
    splash.push({ type: "attack", attackerId: attacker.id, attackerTeam: attacker.team, targetId: target.id,
      skillId: skill.id, skillName: skill.name, skillLevel: skill.level, skilled: true, splash: true,
      attackKind: "skill", attackType: "magic", damage, actualDamage, calculatedDamage: damage,
      dodged, hit: !dodged, critical: false, shieldAbsorbed, targetShield: target.shieldHp,
      targetHp: target.currentHp, targetMaxHp: target.maxHp, targetDied, attackerHp: attacker.currentHp, round: state.round });
  }
  return splash;
}

function resolveNichirinBonus(state, attacker, target, attack) {
  if (!attacker.normalAttackCurrentHpRatio || attack.skilled || attack.dodged || attack.actualDamage <= 0 ||
    !target.alive || target.currentHp <= 0) return null;
  const requested = Math.floor(attack.hpBefore * attacker.normalAttackCurrentHpRatio);
  if (requested <= 0) return null;
  const hpBefore = target.currentHp;
  const shieldAbsorbed = Math.min(requested, target.shieldHp ?? 0);
  target.shieldHp = Math.max(0, (target.shieldHp ?? 0) - shieldAbsorbed);
  const damage = requested - shieldAbsorbed;
  target.currentHp = Math.max(0, hpBefore - damage);
  const actualDamage = hpBefore - target.currentHp;
  accumulateBombDamage(state, target.id, actualDamage);
  const targetDied = handleDeath(target);
  if (targetDied) state.bombs = state.bombs.filter((bomb) => bomb.targetId !== target.id);
  const phaseChange = targetDied ? null : changeBorosPhase(state, target);
  return { type: "treasure-damage", treasureId: "nichirin_blade", attackerId: attacker.id,
    targetId: target.id, round: state.round, basisHp: attack.hpBefore, requested,
    damage, actualDamage, shieldAbsorbed, targetShield: target.shieldHp,
    hpBefore, hpAfter: target.currentHp, targetDied, phaseChange };
}

function resolveJasonBonus(state, attacker, target, attack) {
  if (!attacker.everyThirdNormalAttack || attack.skilled) return null;
  attacker.normalAttackCount = (attacker.normalAttackCount ?? 0) + 1;
  if (attacker.normalAttackCount % 3 || attack.dodged || attack.actualDamage <= 0 || !target.alive) return null;
  const requested = Math.floor(target.maxHp * attacker.everyThirdNormalAttack.maxHpRatio);
  const hpBefore = target.currentHp;
  const shieldAbsorbed = Math.min(requested, target.shieldHp ?? 0);
  target.shieldHp = Math.max(0, (target.shieldHp ?? 0) - shieldAbsorbed);
  target.currentHp = Math.max(0, hpBefore - (requested - shieldAbsorbed));
  const actualDamage = hpBefore - target.currentHp;
  accumulateBombDamage(state, target.id, actualDamage);
  const targetDied = handleDeath(target);
  return { type: "jason-damage", attackerId: attacker.id, targetId: target.id, round: state.round,
    skillName: attacker.everyThirdNormalAttack.name, attackCount: attacker.normalAttackCount,
    requested, actualDamage, shieldAbsorbed, targetShield: target.shieldHp,
    hpBefore, hpAfter: target.currentHp, targetDied };
}

function detonateC0(state) {
  const c0 = state.c0;
  if (!c0 || c0.detonated) return null;
  c0.detonated = true;
  const player = state.characters.find((character) => character.id === state.playerId && character.team === "ally")
    ?? state.characters.find((character) => character.team === "ally" && character.alive);
  const damage = c0.completedRounds * c0.damagePerRound;
  const hpBefore = player?.currentHp ?? 0;
  if (player) {
    player.currentHp = Math.max(0, player.currentHp - damage);
    if (player.currentHp <= 0) {
      player.currentHp = 0;
      player.alive = false;
    }
  }
  return { type: "c0-detonate", bossId: c0.bossId, completedRounds: c0.completedRounds, damage, hpBefore, hpAfter: player?.currentHp ?? 0, targetId: player?.id ?? null, trueDamage: true };
}

// Resolve the complete battle up front. The UI only replays these immutable results,
// so animation speed cannot affect random choices or apply damage twice.
export function simulateBattle(config = CHARACTER_DATA, random = Math.random, options = {}) {
  if (typeof config === "function") {
    random = config;
    config = CHARACTER_DATA;
  }
  const state = initializeBattle(config, options);
  const events = state.battleStartEffects.map((effect) => ({ ...effect, attackerId: state.playerId }));
  let outcome = null;
  while (!outcome) {
    state.round += 1;
    for (const character of state.characters) if (character.elitePassiveId === "killer-queen" && character.alive)
      character.hpSnapshots.push({ round: state.round, hp: character.currentHp });
    // Summons join before this round's speed ordering and can act immediately.
    events.push(...summonAtRoundStart(state));
    if (state.forcedOutcome) { outcome = state.forcedOutcome; break; }
    const steamWave = triggerSteamWaveAtRoundStart(state);
    if (steamWave) events.push(steamWave);
    outcome = isBattleOver(state);
    if (outcome) break;
    for (const character of state.characters) {
      if (character.roundLimitedSpdEffects?.length) {
        character.spd = Math.max(0, character.spdWithoutRoundEffects + character.roundLimitedSpdEffects
          .filter((effect) => state.round <= effect.roundsRemaining)
          .reduce((total, effect) => total + effect.amount, 0));
      }
    }
    for (const character of state.characters) {
      if (character.elitePassiveId === "mahito-domain" && character.elitePassiveActive && character.alive && character.elitePassiveLastRound < state.round) {
        character.atk += MAHITO_ATTACK_BONUS;
        character.elitePassiveLastRound = state.round;
        events.push({ type: "elite-passive-growth", attackerId: character.id, skillId: "mahito-domain", skillName: "自闭圆顿裹", attackBonus: MAHITO_ATTACK_BONUS, effectiveAtk: character.atk, round: state.round });
      }
    }
    for (const character of state.characters) {
      if ((character.defenseBuffUntilRound ?? -1) < state.round) character.defenseBuff = 0;
    }
    for (const orderedActor of getActionOrder(state)) {
      const attacker = state.characters.find((c) => c.id === orderedActor.id);
      if (!attacker.alive || attacker.currentHp <= 0) continue;
      if (attacker.periodicPassive?.onlyPeriodicActions) continue;
      const selectedSkill = triggeredSkill(attacker, random);
      if (selectedSkill?.effectType === "rewind") {
        events.push(...resolveBitesDust(state, attacker));
        outcome = isBattleOver(state);
        if (outcome) break;
        continue;
      }
      let skill = selectedSkill;
      let skillCastNumber = null;
      let gilgameshCast = null;
      if (skill?.id === "gilgamesh-enuma-elish") {
        gilgameshCast = (++attacker.gilgameshCasts - 1) % 4 + 1;
        if (gilgameshCast === 3) {
          const hpBefore = attacker.currentHp;
          attacker.currentHp = Math.min(attacker.maxHp, hpBefore + 300);
          events.push({ type: "gilgamesh-heal", round: state.round, attackerId: attacker.id,
            skillName: skill.name, castNumber: gilgameshCast, hpBefore,
            hpAfter: attacker.currentHp, healedAmount: attacker.currentHp - hpBefore });
          continue;
        }
        if (gilgameshCast === 2) skill = { ...skill, multiplier: .9, ignoreDefenseFraction: .4 };
        if (gilgameshCast === 4) skill = { ...skill, trueDamageRatio: .5 };
      }
      if (skill?.id === "boros-meteor-burst") {
        skillCastNumber = ++attacker.meteorCasts;
        if (skillCastNumber % 2 === 0) skill = { ...skill, multiplier: skill.alternatingMultiplier };
      }
      const target = chooseTarget(state, attacker, random);
      if (!target) break;
      const allTargets = gilgameshCast === 2 || skill?.targetRule === "all_living" ||
        (skill?.id === "boros-meteor-burst" && skillCastNumber % 2 === 0);
      const targets = allTargets
        ? state.characters.filter((entry) => entry.team !== attacker.team && entry.alive && entry.currentHp > 0)
        : [gilgameshCast === 4
          ? state.characters.filter((entry) => entry.team !== attacker.team && entry.alive && entry.currentHp > 0)
            .sort((a, b) => a.currentHp - b.currentHp || a.rosterOrder - b.rosterOrder)[0]
          : target];
      const faster = attacker.elitePassiveId === "toji-heavenly-restriction" && attacker.spd > target.spd;
      if (faster) attacker.fasterActions += 1;
      const segmentCount = attacker.elitePassiveId === "toji-heavenly-restriction"
        ? faster ? 1 + attacker.fasterActions : 1 : targets.length;
      for (let index = 0; index < segmentCount; index += 1) {
        const struck = targets[attacker.elitePassiveId === "toji-heavenly-restriction" ? 0 : index];
        if (!struck?.alive || struck.currentHp <= 0) break;
        const event = gilgameshCast === 4
          ? resolveTrueDamageSkill(state, attacker, struck, skill, Math.floor(struck.maxHp * skill.trueDamageRatio))
          : executeAttack(state, attacker, struck, random, {
          skill: attacker.elitePassiveId === "toji-heavenly-restriction" ? null : skill,
          segmentIndex: index + 1, segmentCount, skillCastNumber, gilgameshCast,
        });
        if (!event) continue;
        event.round = state.round;
        if (gilgameshCast) event.gilgameshCast = gilgameshCast;
        if (event.jinchurikiTriggered) events.push({ type: "passive-trigger", ...event.jinchurikiTriggered, attackerId: attacker.id });
        if (event.elitePassiveTriggered) events.push({ type: "elite-passive-trigger", ...event.elitePassiveTriggered, attackerId: attacker.id });
        events.push(event);
        const jasonHit = event.type === "attack" ? resolveJasonBonus(state, attacker, struck, event) : null;
        if (jasonHit) events.push(jasonHit);
        const treasureHit = event.type === "attack" ? resolveNichirinBonus(state, attacker, struck, event) : null;
        if (treasureHit) events.push(treasureHit);
        if (skill?.id === "shadow-clone-rush" && skill.splashRatio && !event.dodged) {
          events.push(...resolveCloneSplash(state, attacker, event, skill, random));
        }
        const targetDied = event.targetDied || jasonHit?.targetDied || treasureHit?.targetDied;
        if (targetDied && state.characters.find((character) => character.id === event.targetId)?.escapeAsset) {
          const escaped = state.characters.find((character) => character.id === event.targetId);
          events.push({ type: "elite-escape", targetId: escaped.id, name: escaped.name, asset: escaped.escapeAsset, round: state.round });
        }
        const c0Charge = recordC0Action(state, event);
        if (c0Charge) events.push(c0Charge);
        if (targetDied && state.c0 && event.targetId === state.c0.bossId) {
          const c0Explosion = detonateC0(state);
          if (c0Explosion) events.push(c0Explosion);
        }
        outcome = isBattleOver(state);
        if (outcome || (attacker.elitePassiveId === "toji-heavenly-restriction" && targetDied)) break;
      }
      if (outcome) break;
    }
    if (outcome) break;
    events.push(...detonateDueBombs(state));
    outcome = isBattleOver(state);
    if (outcome) break;
    events.push(...advanceBorosRound(state));
    const expiredShield = expireArmoredShieldAtRoundEnd(state);
    if (expiredShield) events.push(expiredShield);
  }
  events.push({ type: "battle-end", outcome, round: state.round, c0Damage: state.c0 ? state.c0.completedRounds * state.c0.damagePerRound : 0, c0Detonated: state.c0?.detonated ?? false });
  return { events, outcome, rounds: state.round, c0: state.c0 ? { ...state.c0 } : null, finalCharacters: state.characters.map((character) => ({ ...character })) };
}

export function advanceBorosRound(state) {
  const events = [];
  for (const character of state.characters) {
    if (!character.alive || !character.phaseSkills || state.round <= character.borosEnteredRound) continue;
    if (character.borosPhase === 2) {
      const hpBefore = character.currentHp;
      character.currentHp = Math.min(character.maxHp, hpBefore + 120);
      events.push({ type: "boros-round-heal", round: state.round, targetId: character.id,
        healedAmount: character.currentHp - hpBefore, hpAfter: character.currentHp });
    } else if (character.borosPhase === 3) {
      character.atk += 20;
      events.push({ type: "boros-round-growth", round: state.round, targetId: character.id,
        attackBonus: 20, effectiveAtk: character.atk });
    }
  }
  return events;
}

export function restartBattle() {
  return initializeBattle();
}

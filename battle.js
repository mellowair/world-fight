import { CHARACTER_DATA, COMBAT_RULES } from "./characters.js";
import { evaluatePassive } from "./progression.js";
import { SKILL_DATA } from "./skills.js";

const MAHITO_ATTACK_BONUS = SKILL_DATA["mahito-domain"].levels[1].attackBonusPerRound;

export function initializeBattle(config = CHARACTER_DATA, options = {}) {
  const characters = config.map((character) => {
    const maxHp = character.maxHp ?? character.hp;
    const currentHp = Math.max(0, Math.min(maxHp, character.currentHp ?? character.hp));
    return { ...character, skill: character.skill ? { ...character.skill } : null, skills: character.skills?.map((skill) => ({ ...skill })) ?? character.skills, maxHp, currentHp, alive: currentHp > 0, elitePassiveActive: false, elitePassiveLastRound: 0, freeWillTriggers: 0, damageTakenHits: 0, critRateBonus: 0, dodgeRateBonus: 0 };
  });
  const c0Boss = characters.find((character) => Number.isFinite(character.c0DamagePerRound));
  const state = {
    characters,
    round: 0,
    status: "ready",
    runCharacterState: options.runCharacterState ?? null,
    playerId: options.playerId ?? options.runCharacterState?.characterId ?? null,
    battleId: options.battleId ?? null,
    battleStartEffects: options.battleStartEffects?.map((effect) => ({ ...effect })) ?? [],
    c0: c0Boss ? { bossId: c0Boss.id, damagePerRound: c0Boss.c0DamagePerRound, completedRounds: 0, detonated: false, currentRound: 0, playerActionDone: false, bossActionDone: false } : null,
  };
  if (state.runCharacterState && state.battleId && state.playerId) {
    const player = state.characters.find((character) => character.id === state.playerId);
    // Battle-scoped passive state resets because each initialized battle gets a unique battleId.
    if (player) { player.jinchurikiTriggered = false; }
  }
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
  const skills = (character.skills?.length ? character.skills : character.skill ? [character.skill] : []).filter((skill) => skill.triggerType !== "on_damage");
  for (const skill of skills) if (random() < skill.chance) return skill;
  return null;
}

export function calculateDamage(attacker, target, multiplier = 1) {
  const base = (attacker.atk * 100) / (100 + target.def);
  return Math.max(1, Math.floor(base * multiplier));
}

export function getDodgeChance(character) {
  return Math.max(0, Math.min(COMBAT_RULES.maxDodgeChance, COMBAT_RULES.baseDodgeChance + character.spd * COMBAT_RULES.dodgePerSpeed + (character.dodgeRateBonus ?? 0)));
}

export function getSkillDodgeChance(character) {
  return Math.min(COMBAT_RULES.skillDodgeChanceCap, getDodgeChance(character) * COMBAT_RULES.skillDodgeFactor);
}

export function getCritChance(character) {
  return Math.max(0, Math.min(COMBAT_RULES.maxCritChance, (character.critChance ?? COMBAT_RULES.baseCritChance) + (character.critRateBonus ?? 0)));
}

export function handleDeath(character) {
  if (character.currentHp <= 0) {
    character.currentHp = 0;
    character.alive = false;
    return true;
  }
  return false;
}

export function isBattleOver(state) {
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
  return summonedEvents;
}

export function executeAttack(state, attacker, target, random = Math.random) {
  if (!attacker?.alive || attacker.currentHp <= 0 || !target?.alive || target.currentHp <= 0) return null;
  let elitePassiveTriggered = null;
  if (attacker.elitePassiveId === "mahito-domain" && !attacker.elitePassiveActive && attacker.currentHp < attacker.maxHp * 0.5) {
    attacker.elitePassiveActive = true;
    attacker.elitePassiveLastRound = state.round ?? 1;
    attacker.atk += MAHITO_ATTACK_BONUS;
    elitePassiveTriggered = { skillId: "mahito-domain", skillName: "自闭圆顿裹", attackBonus: MAHITO_ATTACK_BONUS, effectiveAtk: attacker.atk, round: state.round ?? 1 };
  }
  let jinchurikiTriggered = null;
  if (state.runCharacterState && state.battleId && attacker.id === state.playerId && !attacker.jinchurikiTriggered) {
    const passive = evaluatePassive(state.runCharacterState, "before_attack", { battleId: state.battleId, currentHp: attacker.currentHp, maxHp: attacker.maxHp });
    if (passive?.skillId === "jinchuriki") {
      const originalAtk = attacker.atk;
      attacker.atk = passive.rounding === "floor" ? Math.floor(originalAtk * (1 + passive.attackBonus)) : originalAtk * (1 + passive.attackBonus);
      attacker.jinchurikiTriggered = true;
      jinchurikiTriggered = { ...passive, originalAtk, effectiveAtk: attacker.atk };
    }
  }
  const skill = triggeredSkill(attacker, random);
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
  if (skill?.defenseBonus && skill.stackDefenseBonus) {
    attacker.defenseBuff = (attacker.defenseBuff ?? 0) + skill.defenseBonus;
    attacker.defenseBuffUntilRound = skill.defenseDuration === "battle" ? Number.POSITIVE_INFINITY : (state.round ?? 1);
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
  const directDamageSkill = skill && !skill.normalAttack && (skill.effectType ?? "damage") === "damage";
  const dodgeChance = directDamageSkill ? getSkillDodgeChance(target) : getDodgeChance(target);
  const dodged = random() < dodgeChance;
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
  let damage = dodged ? 0 : calculateDamage({ ...attacker, atk: skillAttackPower }, { ...target, def: target.def + ((target.defenseBuffUntilRound ?? -1) >= (state.round ?? 1) ? target.defenseBuff ?? 0 : 0) }, skillMultiplier * (critical ? COMBAT_RULES.critMultiplier : 1));
  if (!dodged && attacker.damageDealtMultiplier > 1) damage = Math.floor(damage * attacker.damageDealtMultiplier);
  let passiveTriggered = null;
  let doubleDamageConsumed = false;
  if (!dodged && state.runCharacterState && state.battleId) {
    if (attacker.id === state.playerId) {
      const passive = evaluatePassive(state.runCharacterState, "before_attack", { battleId: state.battleId, damage });
      if (passive) damage = Math.max(1, passive.finalDamage ?? damage);
    }
    if (target.id === state.playerId) {
      passiveTriggered = evaluatePassive(state.runCharacterState, "before_damage", { battleId: state.battleId, damage });
      if (passiveTriggered) damage = passiveTriggered.damageImmune ? 0 : Math.max(1, passiveTriggered.finalDamage ?? damage);
    }
  }
  if (!dodged && target.damageTakenMultiplier > 1) damage = Math.floor(damage * target.damageTakenMultiplier);
  if (!dodged && target.doubleNextDamage) {
    target.doubleNextDamage = false;
    doubleDamageConsumed = true;
    if (!passiveTriggered?.damageImmune) damage *= 2;
  }
  target.currentHp = Math.max(0, target.currentHp - damage);
  const actualDamage = targetHpBefore - target.currentHp;
  const oneEyeTriggered = actualDamage > 0 && critical && attacker.passiveSkillId === "kaneki-one-eye";
  let oneEyeHealedAmount = 0;
  if (oneEyeTriggered) {
    oneEyeHealedAmount = Math.max(0, Math.min(attacker.maxHp - attacker.currentHp, Math.floor(actualDamage * SKILL_DATA["kaneki-one-eye"].levels[1].healFromActualDamage)));
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
      damageSkillTriggered = {
        skillId: reactiveSkill.id, skillName: reactiveSkill.name, hits: target.damageTakenHits,
        critRateGain: reactiveSkill.critRateBonus, dodgeRateGain: reactiveSkill.dodgeRateBonus,
        critRateBonus: target.critRateBonus, dodgeRateBonus: target.dodgeRateBonus,
      };
    }
  }
  const died = !dodged && handleDeath(target);
  const defenseFloor = Number.isFinite(skill?.defenseFloor) ? skill.defenseFloor : 0;
  const nextDefense = !dodged && !died && (skill?.defenseReduction ?? 0) > 0
    ? Math.max(defenseFloor, target.def - skill.defenseReduction)
    : target.def;
  const defenseReduced = target.def - nextDefense;
  if (defenseReduced > 0) target.def = nextDefense;
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
    defenseBonusApplied: skill?.stackDefenseBonus ? skill.defenseBonus : 0,
    freeWillTriggerCount: skill?.id === "eren-free-will" ? attacker.freeWillTriggers : null,
    healedAmount, oneEyeTriggered, oneEyeHealedAmount, actualDamage, attackerHp: attacker.currentHp, damageSkillTriggered,
    doubleDamageArmed: Boolean(skill?.doubleNextDamage), doubleDamageConsumed,
    jinchurikiTriggered,
    elitePassiveTriggered,
    passiveTriggered: passiveTriggered ? { skillId: passiveTriggered.skillId, damageImmune: Boolean(passiveTriggered.damageImmune) } : null,
    defenseReduced,
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
    // Summons join before this round's speed ordering and can act immediately.
    events.push(...summonAtRoundStart(state));
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
      const target = chooseTarget(state, attacker, random);
      if (!target) break;
      const event = executeAttack(state, attacker, target, random);
      if (!event) continue;
      event.round = state.round;
      if (event.jinchurikiTriggered) events.push({ type: "passive-trigger", ...event.jinchurikiTriggered, attackerId: attacker.id });
      if (event.elitePassiveTriggered) events.push({ type: "elite-passive-trigger", ...event.elitePassiveTriggered, attackerId: attacker.id });
      events.push(event);
      if (event.targetDied && state.characters.find((character) => character.id === event.targetId)?.escapeAsset) {
        const escaped = state.characters.find((character) => character.id === event.targetId);
        events.push({ type: "elite-escape", targetId: escaped.id, name: escaped.name, asset: escaped.escapeAsset, round: state.round });
      }
      const c0Charge = recordC0Action(state, event);
      if (c0Charge) events.push(c0Charge);
      if (event.targetDied && state.c0 && event.targetId === state.c0.bossId) {
        const c0Explosion = detonateC0(state);
        if (c0Explosion) events.push(c0Explosion);
      }
      outcome = isBattleOver(state);
      if (outcome) break;
    }
  }
  events.push({ type: "battle-end", outcome, round: state.round, c0Damage: state.c0 ? state.c0.completedRounds * state.c0.damagePerRound : 0, c0Detonated: state.c0?.detonated ?? false });
  return { events, outcome, rounds: state.round, c0: state.c0 ? { ...state.c0 } : null, finalCharacters: state.characters.map((character) => ({ ...character })) };
}

export function restartBattle() {
  return initializeBattle();
}

import { CHARACTER_DATA, COMBAT_RULES } from "./characters.js";

export function initializeBattle(config = CHARACTER_DATA) {
  return {
    characters: config.map((character) => {
      const maxHp = character.maxHp ?? character.hp;
      const currentHp = Math.max(0, Math.min(maxHp, character.currentHp ?? character.hp));
      return { ...character, skill: character.skill ? { ...character.skill } : null, maxHp, currentHp, alive: currentHp > 0 };
    }),
    round: 0,
    status: "ready",
  };
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
  return Boolean(character.skill && random() < character.skill.chance);
}

export function calculateDamage(attacker, target, multiplier = 1) {
  const base = (attacker.atk * 100) / (100 + target.def);
  return Math.max(1, Math.floor(base * multiplier));
}

export function getDodgeChance(character) {
  return Math.min(COMBAT_RULES.maxDodgeChance, COMBAT_RULES.baseDodgeChance + character.spd * COMBAT_RULES.dodgePerSpeed);
}

export function getSkillDodgeChance(character) {
  return Math.min(COMBAT_RULES.skillDodgeChanceCap, getDodgeChance(character) * COMBAT_RULES.skillDodgeFactor);
}

export function getCritChance(character) {
  return Math.min(COMBAT_RULES.maxCritChance, character.critChance ?? COMBAT_RULES.baseCritChance);
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

export function executeAttack(state, attacker, target, random = Math.random) {
  if (!attacker?.alive || attacker.currentHp <= 0 || !target?.alive || target.currentHp <= 0) return null;
  const skilled = skillTriggers(attacker, random);
  const directDamageSkill = skilled && (attacker.skill.effectType ?? "damage") === "damage";
  const dodgeChance = directDamageSkill ? getSkillDodgeChance(target) : getDodgeChance(target);
  const dodged = random() < dodgeChance;
  const critChance = getCritChance(attacker);
  const critical = !dodged && random() < critChance;
  const skillMultiplier = skilled ? attacker.skill.multiplier : 1;
  const damage = dodged ? 0 : calculateDamage(attacker, target, skillMultiplier * (critical ? COMBAT_RULES.critMultiplier : 1));
  target.currentHp = Math.max(0, target.currentHp - damage);
  const died = !dodged && handleDeath(target);
  return {
    type: "attack", attackerId: attacker.id, targetId: target.id, damage, dodged,
    hit: !dodged, dodgeChance, critical, critChance, skilled,
    attackKind: directDamageSkill ? "skill" : "normal",
    attackType: (skilled && attacker.skill.attackType) || attacker.attackType || "melee",
    skillName: skilled ? attacker.skill.name : null,
    targetHp: target.currentHp, targetMaxHp: target.maxHp, targetDied: died,
  };
}

// Resolve the complete battle up front. The UI only replays these immutable results,
// so animation speed cannot affect random choices or apply damage twice.
export function simulateBattle(config = CHARACTER_DATA, random = Math.random) {
  if (typeof config === "function") {
    random = config;
    config = CHARACTER_DATA;
  }
  const state = initializeBattle(config);
  const events = [];
  let outcome = null;
  while (!outcome) {
    state.round += 1;
    for (const orderedActor of getActionOrder(state)) {
      const attacker = state.characters.find((c) => c.id === orderedActor.id);
      if (!attacker.alive || attacker.currentHp <= 0) continue;
      const target = chooseTarget(state, attacker, random);
      if (!target) break;
      const event = executeAttack(state, attacker, target, random);
      event.round = state.round;
      if (event) events.push(event);
      outcome = isBattleOver(state);
      if (outcome) break;
    }
  }
  events.push({ type: "battle-end", outcome, round: state.round });
  return { events, outcome, rounds: state.round, finalCharacters: state.characters.map((character) => ({ ...character })) };
}

export function restartBattle() {
  return initializeBattle();
}

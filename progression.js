import { ADVENTURE_EVENT_DATA, ATTRIBUTE_UPGRADES, CAMPFIRE_RULES, ELITE_BONUS_REWARDS, SKILL_DATA } from "./skills.js";

const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rngIndex = (length, random) => Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999999999, finite(random(), 0))) * length));
const has = (list, value) => Array.isArray(list) && list.includes(value);

function ensureRunState(state) {
  if (!state || typeof state !== "object") throw new TypeError("runCharacterState is required");
  state.learnedActiveSkills ??= [];
  state.skillLevels ??= {};
  state.statOffers ??= {};
  state.rewardOffers ??= {};
  state.eventResults ??= {};
  state.consumedActions ??= [];
  state.completedCampfires ??= [];
  state.passiveUses ??= {};
  state.battleStartPassiveChecks ??= {};
  state.temporaryEffects ??= [];
  return state;
}

function makeActionKey(kind, sourceId) { return `${kind}:${sourceId}`; }
function actionAvailable(state, key) { return !has(state.consumedActions, key); }
function recordAction(state, key) {
  if (!actionAvailable(state, key)) return false;
  state.consumedActions.push(key);
  return true;
}
function pickThree(random) {
  const pool = ATTRIBUTE_UPGRADES.map((entry) => entry.id);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = rngIndex(i + 1, random);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}
function getMaxHp(state) { return Math.max(1, finite(state.maxHp, finite(state.hp, 1))); }

export function createRunCharacterState(character, initialSkillId) {
  if (!character?.id) throw new TypeError("character with a stable id is required");
  const source = character.baseStats ?? {
    maxHp: character.maxHp ?? character.hp,
    atk: character.atk, def: character.def, spd: character.spd,
    critRate: character.critRate ?? character.critChance ?? 0.05,
    critMultiplier: character.critMultiplier ?? 1.5,
  };
  const activeSkills = [...(character.activeSkills ?? (character.skill?.id ? [character.skill.id] : []))];
  // Omitted preserves the stage-one default; explicit null lets the stage-two
  // campaign defer the choice until after the entry pose.
  const skillId = initialSkillId === undefined ? activeSkills[0] ?? null : initialSkillId;
  if (skillId && !activeSkills.includes(skillId)) throw new RangeError(`skill ${skillId} is not available to ${character.id}`);
  if (skillId && SKILL_DATA[skillId]?.type !== "active") throw new RangeError(`skill ${skillId} is not an active skill`);
  const maxHp = Math.max(1, finite(source.maxHp, finite(character.hp, 1)));
  const currentHp = Math.max(0, Math.min(maxHp, finite(character.currentHp, maxHp)));
  return {
    characterId: character.id,
    role: character.role ?? "",
    position: character.position ?? character.row ?? "front",
    activeSkillPool: activeSkills,
    maxHp,
    currentHp,
    atk: Math.max(0, finite(source.atk, finite(character.atk))),
    def: Math.max(0, finite(source.def, finite(character.def))),
    spd: Math.max(0, finite(source.spd, finite(character.spd))),
    critRate: Math.max(0, finite(source.critRate, 0.05)),
    critMultiplier: Math.max(1, finite(source.critMultiplier, 1.5)),
    learnedActiveSkills: skillId ? [skillId] : [],
    passiveSkillId: character.passiveSkillId ?? null,
    skillLevels: skillId ? { [skillId]: 1 } : {},
    statOffers: {}, rewardOffers: {}, eventResults: {}, consumedActions: [],
    completedCampfires: [], passiveUses: {}, battleStartPassiveChecks: {}, skillHistory: [], temporaryEffects: [],
  };
}

export function getSkillAtLevel(runState, skillId) {
  ensureRunState(runState);
  const config = SKILL_DATA[skillId];
  if (!config || config.type !== "active" || !has(runState.learnedActiveSkills, skillId)) return null;
  const level = runState.skillLevels[skillId] ?? 1;
  const effect = config.levels[level];
  return effect ? { ...copy(config), ...copy(effect), level } : null;
}

export function getUpgradeableSkills(runState) {
  ensureRunState(runState);
  return runState.learnedActiveSkills.filter((id) => {
    const config = SKILL_DATA[id];
    return config?.type === "active" && (runState.skillLevels[id] ?? 1) < config.maxLevel;
  });
}

export function getUnlearnedActiveSkills(runState) {
  ensureRunState(runState);
  return runState.activeSkillPool.filter((id) => SKILL_DATA[id]?.type === "active" && !has(runState.learnedActiveSkills, id));
}

export function getAvailableAdventureEventIds(runState) {
  ensureRunState(runState);
  return Object.keys(ADVENTURE_EVENT_DATA).filter((eventId) => eventId !== "scroll" || getUnlearnedActiveSkills(runState).length > 0);
}

export function chooseAdventureEventId(runState, random = Math.random) {
  const ids = getAvailableAdventureEventIds(runState);
  return ids[rngIndex(ids.length, random)] ?? null;
}

export function getTemporaryCombatModifiers(runState) {
  ensureRunState(runState);
  return runState.temporaryEffects.reduce((modifiers, effect) => {
    if (effect.battlesRemaining > 0 && (effect.stat === "spd" || effect.stat === "def")) modifiers[effect.stat] += effect.amount;
    return modifiers;
  }, { spd: 0, def: 0 });
}

export function getTemporaryEffects(runState) {
  ensureRunState(runState);
  return copy(runState.temporaryEffects.filter((effect) => effect.battlesRemaining > 0));
}

export function getTemporaryEffectDisplayRows(runState) {
  const statNames = { atk: "攻击", def: "防御", spd: "速度", maxHp: "最大生命" };
  return getTemporaryEffects(runState).map((effect) => ({
    id: effect.statusId ?? (effect.name === "巨石减益" ? "big_rock" : effect.name === "咖啡店增益" ? "coffee_shop" : null),
    name: effect.name ?? "临时效果",
    statName: statNames[effect.stat] ?? effect.stat,
    amount: effect.amount,
    amountText: `${effect.amount > 0 ? "+" : ""}${effect.amount}`,
    durationText: effect.stat === "def" && effect.battlesRemaining === 1
      ? "下一场战斗生效"
      : `剩余 ${effect.battlesRemaining} 场战斗`,
    polarity: effect.amount > 0 ? "buff" : "debuff",
  }));
}

export function advanceTemporaryEffectsAfterBattle(runState) {
  ensureRunState(runState);
  for (const effect of runState.temporaryEffects) effect.battlesRemaining = Math.max(0, effect.battlesRemaining - 1);
  const expired = runState.temporaryEffects.filter((effect) => effect.battlesRemaining === 0);
  runState.temporaryEffects = runState.temporaryEffects.filter((effect) => effect.battlesRemaining > 0);
  return copy(expired);
}

export function createStatUpgradeChoices(runState, sourceId, random = Math.random) {
  ensureRunState(runState);
  if (!sourceId) throw new TypeError("sourceId is required to persist an offer");
  let offer = runState.statOffers[sourceId];
  if (!offer) {
    offer = { sourceId, choices: pickThree(random), status: "pending" };
    runState.statOffers[sourceId] = offer;
  }
  return copy(offer);
}

export function applyStatUpgrade(runState, sourceId, upgradeId) {
  ensureRunState(runState);
  const offer = runState.statOffers[sourceId];
  const upgrade = ATTRIBUTE_UPGRADES.find((entry) => entry.id === upgradeId);
  if (!offer || offer.status !== "pending" || !upgrade || !has(offer.choices, upgradeId)) return false;
  for (const [stat, value] of Object.entries(upgrade.effects)) runState[stat] += value;
  runState.currentHp = Math.max(0, Math.min(runState.maxHp, runState.currentHp));
  offer.status = "applied";
  offer.selectedId = upgradeId;
  recordAction(runState, makeActionKey("stat", sourceId));
  return copy(upgrade);
}

export function healRunCharacter(runState, amount, sourceId) {
  ensureRunState(runState);
  if (!sourceId || !actionAvailable(runState, makeActionKey("heal", sourceId))) return null;
  const healing = Math.max(0, Math.floor(finite(amount)));
  const before = runState.currentHp;
  runState.currentHp = Math.min(getMaxHp(runState), before + healing);
  recordAction(runState, makeActionKey("heal", sourceId));
  return { requested: healing, restored: runState.currentHp - before, currentHp: runState.currentHp, maxHp: runState.maxHp };
}

export function learnActiveSkill(runState, skillId, sourceId) {
  ensureRunState(runState);
  const config = SKILL_DATA[skillId];
  if (!sourceId || !config || config.type !== "active" || !has(runState.activeSkillPool, skillId) || has(runState.learnedActiveSkills, skillId) || runState.learnedActiveSkills.length >= 2 || !actionAvailable(runState, makeActionKey("learn", sourceId))) return false;
  runState.learnedActiveSkills.push(skillId);
  runState.skillLevels[skillId] = 1;
  runState.skillHistory.push({ skillId, level: 1, sourceId, kind: "learn" });
  recordAction(runState, makeActionKey("learn", sourceId));
  return getSkillAtLevel(runState, skillId);
}

export function upgradeActiveSkill(runState, skillId, sourceId) {
  ensureRunState(runState);
  const config = SKILL_DATA[skillId];
  const level = runState.skillLevels[skillId] ?? 1;
  if (!sourceId || !config || config.type !== "active" || !has(runState.learnedActiveSkills, skillId) || level >= config.maxLevel || !actionAvailable(runState, makeActionKey(`skill:${skillId}`, sourceId))) return false;
  runState.skillLevels[skillId] = level + 1;
  runState.skillHistory.push({ skillId, level: level + 1, sourceId, kind: "upgrade" });
  recordAction(runState, makeActionKey(`skill:${skillId}`, sourceId));
  return getSkillAtLevel(runState, skillId);
}

export function getCampfireOptions(runState) {
  ensureRunState(runState);
  const eligible = getUpgradeableSkills(runState).map((id) => ({
    skillId: id, name: SKILL_DATA[id].name, currentLevel: runState.skillLevels[id] ?? 1,
    nextLevel: (runState.skillLevels[id] ?? 1) + 1, currentEffect: getSkillAtLevel(runState, id),
    nextEffect: copy(SKILL_DATA[id].levels[(runState.skillLevels[id] ?? 1) + 1]),
  }));
  return [
    { id: CAMPFIRE_RULES.rest.id, name: CAMPFIRE_RULES.rest.name, enabled: true, healAmount: Math.floor(getMaxHp(runState) * CAMPFIRE_RULES.rest.healFraction) },
    { id: CAMPFIRE_RULES.skillUpgrade.id, name: CAMPFIRE_RULES.skillUpgrade.name, enabled: eligible.length > 0, skills: eligible, reason: eligible.length ? null : "没有可升级的已学习技能（可能均已达 Lv.4）。" },
  ];
}

export function resolveCampfire(runState, sourceId, choiceId, skillId = null) {
  ensureRunState(runState);
  if (!sourceId || has(runState.completedCampfires, sourceId)) return false;
  const options = getCampfireOptions(runState);
  if (choiceId === "rest") {
    const healing = healRunCharacter(runState, options[0].healAmount, `campfire:${sourceId}`);
    if (!healing) return false;
    runState.completedCampfires.push(sourceId);
    return { choiceId, ...healing };
  }
  if (choiceId !== "skill_upgrade" || !options[1].enabled || !options[1].skills.some((entry) => entry.skillId === skillId)) return false;
  const skill = upgradeActiveSkill(runState, skillId, `campfire:${sourceId}`);
  if (!skill) return false;
  runState.completedCampfires.push(sourceId);
  return { choiceId, skill };
}

export function createBattleRewardOffer(runState, battleId, battleType = "normal", random = Math.random) {
  ensureRunState(runState);
  if (!battleId || battleType === "boss") return null;
  const existing = runState.rewardOffers[battleId];
  if (existing) return copy(existing);
  const statOffer = createStatUpgradeChoices(runState, `battle:${battleId}`, random);
  const skillOptions = getUpgradeableSkills(runState);
  const offer = {
    battleId, battleType, status: "pending", statChoices: statOffer.choices,
    extraChoices: battleType === "elite" ? [ELITE_BONUS_REWARDS[0].id, ...(skillOptions.length ? [ELITE_BONUS_REWARDS[1].id] : [])] : [],
    upgradeableSkills: skillOptions,
  };
  runState.rewardOffers[battleId] = offer;
  return copy(offer);
}

export function applyBattleStatReward(runState, battleId, statChoiceId) {
  ensureRunState(runState);
  const offer = runState.rewardOffers[battleId];
  if (!offer || offer.status !== "pending" || !has(offer.statChoices, statChoiceId)) return false;
  const stat = applyStatUpgrade(runState, `battle:${battleId}`, statChoiceId);
  if (!stat) return false;
  offer.statChoiceId = statChoiceId;
  offer.status = offer.battleType === "elite" ? "awaiting_bonus" : "applied";
  return { stat, status: offer.status };
}

export function applyBattleBonusReward(runState, battleId, extraChoiceId, skillId = null) {
  ensureRunState(runState);
  const offer = runState.rewardOffers[battleId];
  if (!offer || offer.battleType !== "elite" || offer.status !== "awaiting_bonus" || !has(offer.extraChoices, extraChoiceId)) return false;
  if (extraChoiceId === "skill_upgrade" && !has(offer.upgradeableSkills, skillId)) return false;
  let bonus;
  if (extraChoiceId === "heal") bonus = healRunCharacter(runState, Math.floor(getMaxHp(runState) * 0.15), `elite:${battleId}`);
  else bonus = upgradeActiveSkill(runState, skillId, `elite:${battleId}`);
  if (!bonus) return false;
  offer.status = "applied";
  offer.extraChoiceId = extraChoiceId;
  offer.skillId = skillId;
  return { bonus, status: offer.status };
}

export function applyBattleReward(runState, battleId, statChoiceId, extraChoiceId = null, skillId = null) {
  ensureRunState(runState);
  const offer = runState.rewardOffers[battleId];
  if (!offer || offer.status !== "pending" || !has(offer.statChoices, statChoiceId)) return false;
  if (offer.battleType === "elite") {
    if (!has(offer.extraChoices, extraChoiceId)) return false;
    if (extraChoiceId === "skill_upgrade" && !has(offer.upgradeableSkills, skillId)) return false;
  }
  const statResult = applyBattleStatReward(runState, battleId, statChoiceId);
  if (!statResult) return false;
  let bonusResult = null;
  if (offer.battleType === "elite") {
    const bonus = applyBattleBonusReward(runState, battleId, extraChoiceId, skillId);
    if (!bonus) return false;
    bonusResult = bonus.bonus;
  }
  return { stat: statResult.stat, bonus: bonusResult };
}

export function createAdventureEventResult(runState, sourceId, eventId, random = Math.random) {
  ensureRunState(runState);
  if (!sourceId) throw new TypeError("sourceId is required");
  if (runState.eventResults[sourceId]) return copy(runState.eventResults[sourceId]);
  const config = ADVENTURE_EVENT_DATA[eventId];
  if (!config) throw new RangeError(`unknown adventure event: ${eventId}`);
  if (eventId === "scroll" && !getUnlearnedActiveSkills(runState).length) return null;
  const record = { sourceId, eventId, name: config.name, description: config.description, image: config.image, effectText: config.effectText, status: config.containsBattle ? "pending_battle" : "pending", type: config.type, containsBattle: config.containsBattle, data: {} };
  if (eventId === "scroll") {
    const choices = getUnlearnedActiveSkills(runState);
    record.type = "learn_skill";
    record.data.skillChoices = choices;
  }
  if (eventId === "fall_rock") record.data.newMaxHp = Math.max(1, Math.floor(getMaxHp(runState) * (1 - config.maxHpLossFraction)));
  if (eventId === "big_rock" || eventId === "coffee_shop") record.data.effect = {
    ...copy(config.effect), name: eventId === "big_rock" ? "巨石减益" : "咖啡店增益",
    statusId: eventId, battlesRemaining: config.effect.durationBattles, sourceId,
  };
  if (eventId === "elite") {
    record.data.battleType = config.battleType;
    record.data.bonusOptions = ["heal", ...(getUpgradeableSkills(runState).length ? ["skill_upgrade"] : [])];
  }
  runState.eventResults[sourceId] = record;
  return copy(record);
}

export function resolveAdventureEvent(runState, sourceId, choiceId = null) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "pending" || record.containsBattle) return false;
  let result;
  if (record.type === "learn_skill") {
    if (!has(record.data.skillChoices, choiceId)) return false;
    result = learnActiveSkill(runState, choiceId, `event:${sourceId}`);
  } else if (record.eventId === "fall_rock") {
    runState.maxHp = record.data.newMaxHp;
    runState.currentHp = Math.min(runState.currentHp, runState.maxHp);
    result = { maxHp: runState.maxHp, currentHp: runState.currentHp };
  } else if (record.eventId === "big_rock" || record.eventId === "coffee_shop") {
    if (runState.temporaryEffects.some((effect) => effect.sourceId === sourceId)) return false;
    runState.temporaryEffects.push(copy(record.data.effect));
    result = { effect: copy(record.data.effect) };
  } else return false;
  if (!result) return false;
  record.status = "completed";
  record.result = result;
  return copy(record);
}

export function startAdventureBattle(runState, sourceId) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "pending_battle" || !record.containsBattle) return false;
  record.status = "in_battle";
  return { battleType: record.data.battleType, sourceId };
}

export function completeAdventureBattle(runState, sourceId, outcome, random = Math.random) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "in_battle") return false;
  if (outcome !== "victory") {
    record.status = "failed";
    return { status: record.status, reward: null };
  }
  const battleId = `event:${sourceId}`;
  const reward = createBattleRewardOffer(runState, battleId, record.data.battleType, random);
  record.status = "awaiting_reward";
  record.data.rewardBattleId = battleId;
  return { status: record.status, reward };
}

export function applyAdventureBattleReward(runState, sourceId, statChoiceId, extraChoiceId = null, skillId = null) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "awaiting_reward") return false;
  const reward = applyBattleReward(runState, record.data.rewardBattleId, statChoiceId, extraChoiceId, skillId);
  if (!reward) return false;
  record.status = "completed";
  record.result = reward;
  return copy(record);
}

export function applyAdventureBattleStatReward(runState, sourceId, statChoiceId) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "awaiting_reward") return false;
  const reward = applyBattleStatReward(runState, record.data.rewardBattleId, statChoiceId);
  if (!reward) return false;
  record.result = { stat: reward.stat };
  if (reward.status === "applied") record.status = "completed";
  else record.status = "awaiting_bonus";
  return copy(record);
}

export function applyAdventureBattleBonusReward(runState, sourceId, extraChoiceId, skillId = null) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "awaiting_bonus") return false;
  const reward = applyBattleBonusReward(runState, record.data.rewardBattleId, extraChoiceId, skillId);
  if (!reward) return false;
  record.status = "completed";
  record.result = { ...record.result, bonus: reward.bonus };
  return copy(record);
}

export function evaluatePassive(runState, triggerType, context = {}) {
  ensureRunState(runState);
  const skill = SKILL_DATA[runState.passiveSkillId];
  if (!skill?.passive || skill.triggerType !== triggerType || !context.battleId) return null;
  const level = skill.levels[1] ?? {};
  const key = `${context.battleId}:${skill.id}:${triggerType}`;
  if (level.oncePerBattle && runState.passiveUses[key]) return null;
  runState.passiveUses[key] = true;
  const effect = { skillId: skill.id, ...copy(level) };
  if (triggerType === "before_damage" && Number.isFinite(context.damage)) {
    effect.originalDamage = Math.max(0, Math.floor(context.damage));
    effect.finalDamage = Math.max(0, Math.floor(effect.originalDamage * (1 - (effect.damageReduction ?? 0))));
  }
  if (triggerType === "before_attack" && Number.isFinite(context.damage)) {
    effect.originalDamage = Math.max(0, Math.floor(context.damage));
    effect.finalDamage = Math.floor(effect.originalDamage * (1 + (effect.damageBonus ?? 0)));
  }
  return effect;
}

// Evaluated once when a battle copy is initialized. The caller applies returned
// bonuses to that copy only; run/base character stats are never mutated.
export function evaluateBattleStartPassive(runState, context = {}) {
  ensureRunState(runState);
  const { battleId } = context;
  if (!battleId || runState.battleStartPassiveChecks[battleId]) return null;
  runState.battleStartPassiveChecks[battleId] = true;
  const skill = SKILL_DATA[runState.passiveSkillId];
  if (!skill?.passive || skill.triggerType !== "battle_start") return null;
  const effect = copy(skill.levels[1] ?? {});
  const maxHp = getMaxHp(runState);
  const currentHp = Math.max(0, finite(runState.currentHp, maxHp));
  if (!(currentHp < maxHp * (effect.currentHpRatioBelow ?? 0))) return null;
  const key = `${battleId}:${skill.id}:battle_start`;
  if (runState.passiveUses[key]) return null;
  runState.passiveUses[key] = true;
  return { skillId: skill.id, skillName: skill.name, currentHp, maxHp, attackBonus: effect.attackBonus ?? 0, rounding: effect.rounding ?? "floor" };
}

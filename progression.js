import { ADVENTURE_EVENT_DATA, ATTRIBUTE_UPGRADES, CAMPFIRE_RULES, ELITE_BONUS_REWARDS, GIANT_SPINAL_FLUID, SKILL_DATA, TREASURE_DATA } from "./skills.js";
import { COMBAT_RULES } from "./characters.js";

const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rngIndex = (length, random) => Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999999999, finite(random(), 0))) * length));
const has = (list, value) => Array.isArray(list) && list.includes(value);

function ensureRunState(state) {
  if (!state || typeof state !== "object") throw new TypeError("runCharacterState is required");
  state.learnedActiveSkills ??= [];
  state.skillLevels ??= {};
  state.passiveLevel ??= 1;
  state.statOffers ??= {};
  state.rewardOffers ??= {};
  state.eventResults ??= {};
  state.consumedActions ??= [];
  state.completedCampfires ??= [];
  state.passiveUses ??= {};
  state.battleStartPassiveChecks ??= {};
  state.temporaryEffects ??= [];
  state.permanentEffects ??= [];
  state.eventSeries ??= {};
  state.nextBattleSkillGuarantee ??= null;
  state.fallRockCount ??= Math.min(ADVENTURE_EVENT_DATA.fall_rock.stages.length,
    Object.values(state.eventResults).filter((event) => event.eventId === "fall_rock" && event.status === "completed").length);
  state.fallRockCompleted ??= state.fallRockCount >= ADVENTURE_EVENT_DATA.fall_rock.stages.length;
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
    passiveLevel: 1,
    skillLevels: skillId ? { [skillId]: 1 } : {},
    statOffers: {}, rewardOffers: {}, eventResults: {}, consumedActions: [],
    completedCampfires: [], passiveUses: {}, battleStartPassiveChecks: {}, skillHistory: [], temporaryEffects: [],
    fallRockCount: 0, fallRockCompleted: false, permanentEffects: [], eventSeries: {},
  };
}

export function getTreasureCombatModifiers(runState) {
  ensureRunState(runState);
  const modifiers = { damageReduction: 0, dodgeRateBonus: 0, lifesteal: 0, normalAttackCurrentHpRatio: 0, unavoidableAttack: false };
  for (const effect of runState.permanentEffects) {
    if (effect.id === "six_ear_true_form") modifiers.unavoidableAttack = true;
    const treasure = TREASURE_DATA[effect.id];
    if (!treasure) continue;
    modifiers.damageReduction += treasure.damageReduction ?? 0;
    modifiers.dodgeRateBonus += treasure.dodgeRateBonus ?? 0;
    modifiers.lifesteal += treasure.lifesteal ?? 0;
    modifiers.normalAttackCurrentHpRatio += treasure.normalAttackCurrentHpRatio ?? 0;
  }
  return modifiers;
}

export function createTreasureOffer(runState, sourceId, tier, random = Math.random) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (record?.eventId !== "kings_treasury" || !["small", "royal"].includes(tier)) return false;
  if (record.data.treasureOffer) return copy(record.data.treasureOffer);
  const pool = Object.values(TREASURE_DATA).filter((treasure) => treasure.tier === tier).map((treasure) => treasure.id);
  const choices = [];
  while (choices.length < 2) choices.push(pool.splice(rngIndex(pool.length, random), 1)[0]);
  record.data.treasureOffer = { tier, choices, claimed: false };
  return copy(record.data.treasureOffer);
}

export function claimTreasure(runState, sourceId, treasureId, recipientState, recipientId) {
  ensureRunState(runState);
  ensureRunState(recipientState);
  const record = runState.eventResults[sourceId];
  const offer = record?.data?.treasureOffer;
  const treasure = TREASURE_DATA[treasureId];
  if (record?.eventId !== "kings_treasury" || !offer || offer.claimed ||
    !offer.choices.includes(treasureId) || treasure?.tier !== offer.tier ||
    !["awaiting_treasure", "awaiting_reward"].includes(record.status) || !recipientId ||
    recipientState.characterId !== recipientId) return false;
  const key = makeActionKey("treasure", sourceId);
  if (!recordAction(recipientState, key)) return false;
  if (treasure.atk) recipientState.atk += treasure.atk;
  if (treasure.maxHp) recipientState.maxHp = Math.max(1, recipientState.maxHp + treasure.maxHp);
  recipientState.currentHp = Math.min(recipientState.currentHp, recipientState.maxHp);
  if (treasure.critRateBonus) recipientState.critRate = Math.min(COMBAT_RULES.maxCritChance, recipientState.critRate + treasure.critRateBonus);
  if (treasure.id === "angel_breath") recipientState.currentHp = recipientState.maxHp;
  recipientState.permanentEffects.push({ id: treasure.id, name: treasure.name, description: treasure.description, sourceId });
  offer.claimed = true;
  offer.treasureId = treasureId;
  offer.recipientId = recipientId;
  if (record.status === "awaiting_treasure") record.status = "completed";
  return { treasureId, recipientId, name: treasure.name, currentHp: recipientState.currentHp, maxHp: recipientState.maxHp };
}

export function getSkillAtLevel(runState, skillId) {
  ensureRunState(runState);
  const config = SKILL_DATA[skillId];
  if (!config || config.type !== "active" || !has(runState.learnedActiveSkills, skillId)) return null;
  const level = runState.skillLevels[skillId] ?? 1;
  const effect = config.levels[level];
  return effect ? { ...copy(config), ...copy(effect), level } : null;
}

export function upgradePassiveSkill(runState, sourceId) {
  ensureRunState(runState);
  const skill = SKILL_DATA[runState.passiveSkillId];
  const key = makeActionKey("passive-upgrade", sourceId);
  if (!skill?.passive || (runState.passiveLevel ?? 1) >= 2 || !recordAction(runState, key)) return false;
  runState.passiveLevel = 2;
  const maxHpBonus = skill.levels[2]?.maxHpBonus ?? 0;
  if (maxHpBonus) runState.maxHp += maxHpBonus;
  runState.currentHp = Math.min(runState.currentHp, runState.maxHp);
  return { skillId: skill.id, level: 2, maxHpBonus };
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

// A training opportunity upgrades an existing skill first; once every learned
// skill is capped, it can teach an unlearned active skill at Lv.1.
export function getSkillTrainingChoices(runState) {
  const upgradeable = getUpgradeableSkills(runState);
  return upgradeable.length ? upgradeable : getUnlearnedActiveSkills(runState);
}

function applySkillTraining(runState, skillId, sourceId) {
  return getUpgradeableSkills(runState).length
    ? upgradeActiveSkill(runState, skillId, sourceId)
    : learnActiveSkill(runState, skillId, sourceId);
}

export function getAvailableAdventureEventIds(runState, step = 1, partyStates = [runState], stageId = 1) {
  ensureRunState(runState);
  const series = runState.eventSeries;
  const eligible = (key, chapter, extra = true) => {
    const progress = series[key] ?? {};
    if (progress.permanentExcluded || progress.blockedStageId === stageId || !extra) return false;
    return chapter === 1 ? !progress.chapter1Completed : progress.chapter1Completed && !progress.chapter2Completed;
  };
  const sea = series.sea ?? {};
  return Object.keys(ADVENTURE_EVENT_DATA).filter((eventId) =>
    !ADVENTURE_EVENT_DATA[eventId].containsBattle
    && (eventId !== "kings_treasury" || stageId === 2)
    && (eventId !== "giant_encirclement" || step >= 8)
    && (eventId !== "scroll" || eligible("scroll", 1, partyStates.some((state) => getUnlearnedActiveSkills(state).length > 0)))
    && (eventId !== "old_scroll_2" || eligible("scroll", 2, partyStates.some((state) =>
      state.learnedActiveSkills.some((id) => (state.skillLevels[id] ?? 0) >= 4))))
    && (eventId !== "coffee_shop" || eligible("anteiku", 1))
    && (eventId !== "anteiku_2" || eligible("anteiku", 2, stageId <= 3 && Boolean(series.anteiku?.chapter2Unlocked)))
    && (eventId !== "big_rock" || eligible("rock", 1))
    && (eventId !== "giant_rock_2" || eligible("rock", 2, stageId >= 2 && Boolean(series.rock?.chapter2Unlocked)))
    && (eventId !== "fall_rock" || (!runState.fallRockCompleted && runState.fallRockCount < ADVENTURE_EVENT_DATA.fall_rock.stages.length))
    && (eventId !== "sea_beyond" || eligible("sea", 1) && !Object.values(runState.eventResults).some((event) => event.eventId === "sea_beyond"))
    && (eventId !== "sea_beyond_2" || eligible("sea", 2, (sea.rewards?.length ?? 0) > 0)));
}

export function chooseAdventureEventId(runState, random = Math.random, step = 1, partyStates = [runState], stageId = 1) {
  const ids = getAvailableAdventureEventIds(runState, step, partyStates, stageId);
  return ids[rngIndex(ids.length, random)] ?? null;
}

function hasTemporaryDuration(effect) {
  return (effect.roundsRemaining ?? effect.battlesRemaining ?? 0) > 0;
}

export function getTemporaryCombatModifiers(runState) {
  ensureRunState(runState);
  return runState.temporaryEffects.reduce((modifiers, effect) => {
    if (hasTemporaryDuration(effect) && (effect.stat === "spd" || effect.stat === "def")) modifiers[effect.stat] += effect.amount;
    if (hasTemporaryDuration(effect) && effect.effectKind === "damage_taken_multiplier") modifiers.damageTakenMultiplier *= effect.multiplier ?? 1;
    if (hasTemporaryDuration(effect) && effect.effectKind === "damage_dealt_multiplier") modifiers.damageDealtMultiplier *= effect.multiplier ?? 1;
    return modifiers;
  }, { spd: 0, def: 0, damageTakenMultiplier: 1, damageDealtMultiplier: 1 });
}

export function getTemporaryEffects(runState) {
  ensureRunState(runState);
  return copy(runState.temporaryEffects.filter(hasTemporaryDuration));
}

export function getTemporaryEffectDisplayRows(runState) {
  const statNames = { atk: "攻击", def: "防御", spd: "速度", maxHp: "最大生命" };
  return getTemporaryEffects(runState).map((effect) => {
    const isDamageTaken = effect.effectKind === "damage_taken_multiplier";
    const isDamageDealt = effect.effectKind === "damage_dealt_multiplier";
    return {
      id: effect.statusId ?? (effect.name === "巨石减益" ? "big_rock" : effect.name === "咖啡店增益" ? "coffee_shop" : null),
      name: effect.name ?? "临时效果",
      statName: isDamageTaken ? "受到伤害" : isDamageDealt ? "造成伤害" : statNames[effect.stat] ?? effect.stat,
      amount: effect.amount,
      amountText: isDamageTaken || isDamageDealt
        ? `×${effect.multiplier ?? 1}`
        : `${effect.amount > 0 ? "+" : ""}${effect.amount}`,
      durationText: effect.roundsRemaining > 0
        ? `剩余 ${effect.roundsRemaining} 个战斗回合`
        : effect.stat === "def" && effect.battlesRemaining === 1
        ? "下一场战斗生效"
        : `剩余 ${effect.battlesRemaining} 场战斗`,
      polarity: isDamageTaken || effect.amount < 0 ? "debuff" : "buff",
    };
  });
}

export function advanceTemporaryEffectsAfterBattle(runState, roundsPlayed = 1) {
  ensureRunState(runState);
  const completedRounds = Math.max(0, Math.floor(finite(roundsPlayed, 0)));
  for (const effect of runState.temporaryEffects) {
    if (effect.roundsRemaining !== undefined) effect.roundsRemaining = Math.max(0, effect.roundsRemaining - completedRounds);
    else effect.battlesRemaining = Math.max(0, effect.battlesRemaining - 1);
  }
  const expired = runState.temporaryEffects.filter((effect) => !hasTemporaryDuration(effect));
  runState.temporaryEffects = runState.temporaryEffects.filter(hasTemporaryDuration);
  return copy(expired);
}

export function createStatUpgradeChoices(runState, sourceId, random = Math.random, requiredSelections = 1) {
  ensureRunState(runState);
  if (!sourceId) throw new TypeError("sourceId is required to persist an offer");
  let offer = runState.statOffers[sourceId];
  if (!offer) {
    offer = { sourceId, choices: pickThree(random), requiredSelections: Math.max(1, Math.floor(finite(requiredSelections, 1))), selectedIds: [], status: "pending" };
    runState.statOffers[sourceId] = offer;
  }
  return copy(offer);
}

export function applyStatUpgrade(runState, sourceId, upgradeId) {
  ensureRunState(runState);
  const offer = runState.statOffers[sourceId];
  const upgrade = ATTRIBUTE_UPGRADES.find((entry) => entry.id === upgradeId);
  if (!offer || offer.status !== "pending" || !upgrade || !has(offer.choices, upgradeId)) return false;
  offer.selectedIds ??= offer.selectedId ? [offer.selectedId] : [];
  const requiredSelections = Math.max(1, Math.floor(finite(offer.requiredSelections, 1)));
  const actionKey = makeActionKey("stat", `${sourceId}:${upgradeId}`);
  if (offer.selectedIds.length >= requiredSelections || has(offer.selectedIds, upgradeId) || !actionAvailable(runState, actionKey)) return false;
  for (const [stat, value] of Object.entries(upgrade.effects)) runState[stat] += value;
  runState.currentHp = Math.max(0, Math.min(runState.maxHp, runState.currentHp));
  offer.selectedIds.push(upgradeId);
  offer.status = offer.selectedIds.length >= requiredSelections ? "applied" : "pending";
  if (requiredSelections === 1) offer.selectedId = upgradeId;
  recordAction(runState, actionKey);
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
  const cannotHeal = runState.permanentEffects.some((effect) => effect.id === "stone_mask");
  const healFraction = CAMPFIRE_RULES.rest.healFraction +
    (runState.permanentEffects.some((effect) => effect.id === "drip_coffee") ? .15 : 0);
  const eligible = getSkillTrainingChoices(runState).map((id) => ({
    skillId: id, name: SKILL_DATA[id].name, currentLevel: runState.skillLevels[id] ?? 0,
    nextLevel: (runState.skillLevels[id] ?? 0) + 1, currentEffect: getSkillAtLevel(runState, id),
    nextEffect: copy(SKILL_DATA[id].levels[(runState.skillLevels[id] ?? 0) + 1]),
  }));
  return [
    { id: CAMPFIRE_RULES.rest.id, name: CAMPFIRE_RULES.rest.name, enabled: true, healAmount: cannotHeal ? 0 : Math.floor(getMaxHp(runState) * healFraction), blockedBy: cannotHeal ? "stone_mask" : null },
    { id: CAMPFIRE_RULES.skillUpgrade.id, name: CAMPFIRE_RULES.skillUpgrade.name, enabled: eligible.length > 0, skills: eligible, reason: eligible.length ? null : "主动技能已全部学习并达到 Lv.4。" },
  ];
}

export function resolveCampfire(runState, sourceId, choiceId, skillId = null) {
  ensureRunState(runState);
  if (!sourceId || has(runState.completedCampfires, sourceId)) return false;
  const options = getCampfireOptions(runState);
  if (choiceId === "rest") {
    if (options[0].blockedBy) {
      runState.completedCampfires.push(sourceId);
      return { choiceId, restored: 0, currentHp: runState.currentHp, maxHp: runState.maxHp, blockedBy: options[0].blockedBy };
    }
    const healing = healRunCharacter(runState, options[0].healAmount, `campfire:${sourceId}`);
    if (!healing) return false;
    runState.completedCampfires.push(sourceId);
    return { choiceId, ...healing };
  }
  if (choiceId !== "skill_upgrade" || !options[1].enabled || !options[1].skills.some((entry) => entry.skillId === skillId)) return false;
  const skill = applySkillTraining(runState, skillId, `campfire:${sourceId}`);
  if (!skill) return false;
  runState.completedCampfires.push(sourceId);
  return { choiceId, skill };
}

export function createBattleRewardOffer(runState, battleId, battleType = "normal", random = Math.random) {
  ensureRunState(runState);
  if (!battleId || battleType === "boss") return null;
  const existing = runState.rewardOffers[battleId];
  if (existing) return copy(existing);
  const statOffer = createStatUpgradeChoices(runState, `battle:${battleId}`, random, 2);
  const skillOptions = getSkillTrainingChoices(runState);
  const offer = {
    battleId, battleType, status: "pending", statChoices: statOffer.choices, requiredStatSelections: statOffer.requiredSelections,
    selectedStatIds: [],
    extraChoices: battleType === "elite" && skillOptions.length ? [ELITE_BONUS_REWARDS[0].id] : [],
    upgradeableSkills: skillOptions,
  };
  runState.rewardOffers[battleId] = offer;
  return copy(offer);
}

export function applyBattleStatReward(runState, battleId, statChoiceIds) {
  ensureRunState(runState);
  const offer = runState.rewardOffers[battleId];
  if (!offer || offer.status !== "pending") return false;
  const choices = Array.isArray(statChoiceIds) ? statChoiceIds : [statChoiceIds];
  const selected = offer.selectedStatIds ?? [];
  const required = Math.max(1, Math.floor(finite(offer.requiredStatSelections, 1)));
  if (choices.length !== required - selected.length || new Set(choices).size !== choices.length || choices.some((id) => !has(offer.statChoices, id) || has(selected, id))) return false;
  const statOffer = runState.statOffers[`battle:${battleId}`];
  if (!statOffer || choices.some((id) => !has(statOffer.choices, id) || has(statOffer.selectedIds, id))) return false;
  const applied = [];
  for (const choice of choices) {
    const stat = applyStatUpgrade(runState, `battle:${battleId}`, choice);
    if (!stat) return false;
    applied.push(stat);
  }
  offer.selectedStatIds = [...selected, ...choices];
  const complete = offer.selectedStatIds.length >= required;
  offer.status = complete ? (offer.battleType === "elite" && offer.extraChoices.length ? "awaiting_bonus" : "applied") : "pending";
  return { stat: applied, selectedStatIds: [...offer.selectedStatIds], status: offer.status };
}

export function applyBattleBonusReward(runState, battleId, extraChoiceId, skillId = null) {
  ensureRunState(runState);
  const offer = runState.rewardOffers[battleId];
  if (!offer || offer.battleType !== "elite" || offer.status !== "awaiting_bonus" || !has(offer.extraChoices, extraChoiceId)) return false;
  if (extraChoiceId === "skill_upgrade" && !has(offer.upgradeableSkills, skillId)) return false;
  const bonus = applySkillTraining(runState, skillId, `elite:${battleId}`);
  if (!bonus) return false;
  offer.status = "applied";
  offer.extraChoiceId = extraChoiceId;
  offer.skillId = skillId;
  return { bonus, status: offer.status };
}

export function applyBattleReward(runState, battleId, statChoiceIds, extraChoiceId = null, skillId = null) {
  ensureRunState(runState);
  const offer = runState.rewardOffers[battleId];
  const choices = Array.isArray(statChoiceIds) ? statChoiceIds : [statChoiceIds];
  if (!offer || offer.status !== "pending") return false;
  if (offer.battleType === "elite") {
    if (!has(offer.extraChoices, extraChoiceId)) return false;
    if (extraChoiceId === "skill_upgrade" && !has(offer.upgradeableSkills, skillId)) return false;
  }
  const statResult = applyBattleStatReward(runState, battleId, choices);
  if (!statResult) return false;
  let bonusResult = null;
  if (offer.battleType === "elite") {
    const bonus = applyBattleBonusReward(runState, battleId, extraChoiceId, skillId);
    if (!bonus) return false;
    bonusResult = bonus.bonus;
  }
  return { stat: statResult.stat, bonus: bonusResult };
}

export function getSeaBeyondOfferDetails(record) {
  if (record?.eventId !== "sea_beyond" || !Array.isArray(record.data?.tiers)) return [];
  const maxHp = record.data.startingMaxHp;
  return record.data.tiers.map((tier, index) => ({
    index,
    hpLossPercent: Math.round(tier.hpLossFraction * 100),
    hpLoss: Math.floor(maxHp * tier.hpLossFraction),
    rewardStat: tier.rewardStat,
    rewardAmount: tier.rewardAmount,
  }));
}

export function createAdventureEventResult(runState, sourceId, eventId, random = Math.random, partyStates = [runState], stageId = 1) {
  ensureRunState(runState);
  if (!sourceId) throw new TypeError("sourceId is required");
  if (runState.eventResults[sourceId]) return copy(runState.eventResults[sourceId]);
  const config = ADVENTURE_EVENT_DATA[eventId];
  if (!config) throw new RangeError(`unknown adventure event: ${eventId}`);
  if (eventId === "scroll" && !partyStates.some((state) => getUnlearnedActiveSkills(state).length)) return null;
  if (eventId === "fall_rock" && (runState.fallRockCompleted || runState.fallRockCount >= config.stages.length)) return null;
  if (eventId === "sea_beyond" && Object.values(runState.eventResults).some((event) => event.eventId === "sea_beyond")) return null;
  if (["sea_beyond_2", "old_scroll_2", "anteiku_2", "giant_rock_2"].includes(eventId) &&
    !getAvailableAdventureEventIds(runState, 1, partyStates, stageId).includes(eventId)) return null;
  const record = { sourceId, eventId, name: config.name, description: config.description, image: config.image, effectText: config.effectText, status: config.containsBattle ? "pending_battle" : "pending", type: config.type, containsBattle: config.containsBattle, data: { stageId } };
  if (eventId === "fall_rock") {
    const stage = runState.fallRockCount + 1;
    const rule = config.stages[stage - 1];
    record.description = rule.description ?? config.description;
    record.effectText = rule.effectText ?? config.effectText;
    record.data.stage = stage;
    if (rule.maxHpLossFraction) record.data.newMaxHp = Math.max(1, Math.floor(getMaxHp(runState) * (1 - rule.maxHpLossFraction)));
  }
  if (eventId === "sea_beyond") {
    const tierRules = [
      { hpLossFraction: 0.20, rewards: { atk: 30, def: 40, spd: 50 } },
      { hpLossFraction: 0.30, rewards: { atk: 50, def: 60, spd: 70 } },
      { hpLossFraction: 0.40, rewards: { atk: 70, def: 90, spd: 100 } },
    ];
    record.data.phase = "intro";
    record.data.selectedTiers = [];
    record.data.startingMaxHp = getMaxHp(runState);
    record.data.tiers = tierRules.map((tier) => {
      const stats = Object.keys(tier.rewards);
      const rewardStat = stats[rngIndex(stats.length, random)];
      return {
        hpLossFraction: tier.hpLossFraction,
        rewardStat,
        rewardAmount: tier.rewards[rewardStat],
      };
    });
  }
  if (eventId === "sea_beyond_2") record.data.previousRewards = copy(runState.eventSeries.sea.rewards);
  if (eventId === "death_note") record.data.blessing = random() < 0.5 ? "player_vulnerable" : "enemy_vulnerable";
  if (eventId === "scroll") {
    const choices = [...new Set(partyStates.flatMap((state) => getUnlearnedActiveSkills(state)))];
    record.type = "learn_skill";
    record.data.skillChoices = choices;
    record.data.scrollPhase = "intro";
  }
  if (eventId === "fate_gate") {
    record.data.skillChoices = runState.learnedActiveSkills
      .map((skillId) => getSkillAtLevel(runState, skillId))
      .filter((skill) => skill && Number.isFinite(skill.chance))
      .map((skill) => skill.id);
  }
  runState.eventResults[sourceId] = record;
  return copy(record);
}

function nextBattleEffect(sourceId, statusId, name, stat, amount) {
  return { sourceId, statusId, name, stat, amount, battlesRemaining: 1 };
}

function applySharedEventEffect(runState, sourceId, result) {
  if (result.effect && !runState.temporaryEffects.some((effect) => effect.sourceId === sourceId))
    runState.temporaryEffects.push(copy(result.effect));
  if (result.healFraction) {
    const restored = Math.min(runState.maxHp - runState.currentHp, Math.floor(runState.maxHp * result.healFraction));
    runState.currentHp += restored;
    result.restored = restored;
    result.currentHp = runState.currentHp;
  }
  if (result.maxHpGainFraction) {
    const gain = Math.floor(runState.maxHp * result.maxHpGainFraction);
    runState.maxHp += gain;
    result.maxHpGain = gain;
    result.maxHp = runState.maxHp;
  }
  if (result.gains) for (const gain of result.gains) runState[gain.stat] += gain.amount;
}

export function resolveAdventureEvent(runState, sourceId, choiceId = null, random = Math.random, recipientState = runState) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "pending" || record.containsBattle) return false;
  let result;
  let keepPending = false;
  const series = runState.eventSeries;
  const stageId = record.data.stageId ?? 1;
  if (record.eventId === "kings_treasury") {
    if (!["treasury_leave", "treasury_steal", "treasury_advance"].includes(choiceId)) return false;
    record.data.choiceId = choiceId;
    if (choiceId === "treasury_leave") result = { skipped: true };
    else if (choiceId === "treasury_steal" && random() < .8) {
      createTreasureOffer(runState, sourceId, "small", random);
      record.status = "awaiting_treasure";
      keepPending = true;
      result = { treasureOffer: "small" };
    } else {
      record.containsBattle = true;
      record.data.battleType = "normal";
      record.status = "pending_battle";
      keepPending = true;
      result = { pendingBattle: true, encounter: "吉尔伽美什" };
    }
  } else if (record.eventId === "giant_encirclement") {
    if (choiceId !== "giant_escape" && choiceId !== "giant_heart") return false;
    record.data.choiceId = choiceId;
    if (choiceId === "giant_escape" && random() < 0.7) {
      runState.spd = Math.max(0, runState.spd - 10);
      result = { escape: "success", spdLoss: 10, currentSpd: runState.spd };
    } else {
      record.containsBattle = true;
      record.data.battleType = "normal";
      record.status = "pending_battle";
      keepPending = true;
      result = { escape: choiceId === "giant_escape" ? "failed" : null, pendingBattle: true };
    }
  } else if (record.type === "learn_skill") {
    if (choiceId === "scroll_leave") result = { skipped: true };
    else { if (!has(record.data.skillChoices, choiceId) || !getUnlearnedActiveSkills(recipientState).includes(choiceId)) return false; result = learnActiveSkill(recipientState, choiceId, "event:" + sourceId); }
    series.scroll ??= {};
    if (choiceId === "scroll_leave") series.scroll.blockedStageId = stageId;
    else { series.scroll.chapter1Completed = true; series.scroll.lastChoice = choiceId; }
  } else if (record.eventId === "sea_beyond") {
    if (record.data.phase === "intro") {
      if (choiceId === "sea_pass") {
        result = { skipped: true };
        record.status = "completed";
        series.sea = { chapter1Completed: true, permanentExcluded: true, lastChoice: choiceId };
      } else if (choiceId === "sea_begin") {
        record.data.phase = "choices";
        keepPending = true;
        result = { continued: true, choicesMade: 0 };
      } else return false;
    } else if (record.data.phase === "choices") {
      if (choiceId === "sea_sacrifice") {
        const nextTier = record.data.selectedTiers.length;
        if (nextTier >= record.data.tiers.length) return false;
        record.data.selectedTiers.push(nextTier);
        if (record.data.selectedTiers.length < record.data.tiers.length) {
          keepPending = true;
          result = { continued: true, choicesMade: record.data.selectedTiers.length };
        }
      } else if (choiceId !== "sea_finish") return false;

      if (!result) {
        const selectedTiers = record.data.selectedTiers.map(index => record.data.tiers[index]);
        if (!selectedTiers.length) result = { skipped: true };
        else {
          const hpLossPercent = selectedTiers.reduce((total, tier) => total + tier.hpLossFraction * 100, 0);
          const hpLoss = selectedTiers.reduce((total, tier) => total + Math.floor(record.data.startingMaxHp * tier.hpLossFraction), 0);
          const gains = [];
          for (const tier of selectedTiers) {
            runState[tier.rewardStat] += tier.rewardAmount;
            gains.push({ stat: tier.rewardStat, amount: tier.rewardAmount });
          }
          runState.maxHp = Math.max(1, record.data.startingMaxHp - hpLoss);
          runState.currentHp = Math.min(runState.currentHp, runState.maxHp);
          result = { hpLoss, hpLossPercent, maxHp: runState.maxHp, currentHp: runState.currentHp, gains, choicesUsed: selectedTiers.length };
          series.sea = { chapter1Completed: true, lastChoice: "sea_begin", rewards: copy(gains) };
        }
        if (!selectedTiers.length) series.sea = { chapter1Completed: true, permanentExcluded: true, lastChoice: "sea_finish" };
        record.status = "completed";
      }
    } else return false;
  } else if (record.eventId === "sea_beyond_2") {
    if (choiceId === "sea_stay") {
      result = { gains: record.data.previousRewards.map(({ stat, amount }) => ({ stat, amount: amount * 2 })) };
    } else if (choiceId === "sea_home") result = { maxHpGainFraction: .10 };
    else return false;
    applySharedEventEffect(runState, sourceId, result);
    series.sea.chapter2Completed = true;
    series.sea.lastChoice = choiceId;
  } else if (record.eventId === "old_scroll_2") {
    if (choiceId === "scroll_mountain") {
      if (!record.data.recipientId || recipientState.characterId !== record.data.recipientId) return false;
      const levelSum = recipientState.learnedActiveSkills.reduce((sum, id) => sum + (recipientState.skillLevels[id] ?? 0), 0);
      const spdGain = levelSum * 10;
      recipientState.spd += spdGain;
      result = { recipientId: recipientState.characterId, spdGain, levelSum };
      series.scroll.chapter2Completed = true;
    } else if (choiceId === "scroll_not_yet") {
      series.scroll.blockedStageId = stageId;
      result = { skipped: true };
    } else if (choiceId === "scroll_never") {
      series.scroll.permanentExcluded = true;
      result = { skipped: true };
    } else return false;
    series.scroll.lastChoice = choiceId;
  } else if (record.eventId === "coffee_shop" || record.eventId === "anteiku_2") {
    const sequel = record.eventId === "anteiku_2";
    series.anteiku ??= {};
    if (choiceId === (sequel ? "anteiku_leave" : "coffee_leave")) {
      result = { healFraction: sequel ? .30 : .15,
        effect: nextBattleEffect(sourceId, record.eventId, "安定区防御", "def", 30) };
      applySharedEventEffect(runState, sourceId, result);
    } else if (!sequel && choiceId === "coffee_help") {
      result = { effect: nextBattleEffect(sourceId, "coffee_help", "安定区帮忙", "spd", -20) };
      applySharedEventEffect(runState, sourceId, result);
    } else if (sequel && choiceId === "anteiku_fight") {
      record.containsBattle = true;
      record.data.battleType = "normal";
      record.status = "pending_battle";
      keepPending = true;
      result = { pendingBattle: true, encounter: "铃屋什造" };
    } else return false;
    if (sequel) series.anteiku.chapter2Completed = true;
    else { series.anteiku.chapter1Completed = true; series.anteiku.chapter2Unlocked = choiceId === "coffee_help"; }
    series.anteiku.lastChoice = choiceId;
  } else if (record.eventId === "big_rock" || record.eventId === "giant_rock_2") {
    const sequel = record.eventId === "giant_rock_2";
    series.rock ??= {};
    if (choiceId === (sequel ? "rock_avoid_again" : "rock_bypass")) result = { skipped: true };
    else if (!sequel && choiceId === "rock_move") {
      result = { effect: nextBattleEffect(sourceId, "big_rock", "巨石减益", "spd", -20) };
      applySharedEventEffect(runState, sourceId, result);
    } else if (sequel && choiceId === "rock_fight") {
      record.containsBattle = true;
      record.data.battleType = "normal";
      record.status = "pending_battle";
      keepPending = true;
      result = { pendingBattle: true, encounter: "六耳猕猴" };
    } else return false;
    if (sequel) series.rock.chapter2Completed = true;
    else { series.rock.chapter1Completed = true; series.rock.chapter2Unlocked = choiceId === "rock_move"; }
    series.rock.lastChoice = choiceId;
  } else if (record.eventId === "death_note") {
    if (choiceId === "death_note_pass") result = { skipped: true };
    else if (choiceId === "death_note_open") {
      const negative = record.data.blessing === "player_vulnerable";
      runState.temporaryEffects = runState.temporaryEffects.filter(effect => effect.statusId !== "death_note");
      const effect = { statusId: "death_note", name: "死亡笔记", effectKind: negative ? "damage_taken_multiplier" : "damage_dealt_multiplier", multiplier: negative ? 1.5 : 2, battlesRemaining: 2, sourceId };
      runState.temporaryEffects.push(effect); result = { blessing: negative ? "player_damage_increased" : "enemy_damage_doubled", effect };
    } else return false;
  } else if (record.eventId === "fate_gate") {
    if (choiceId !== "fate_accept") return false;
    const eligibleSkillIds = record.data.skillChoices.filter((skillId) => getSkillAtLevel(runState, skillId)?.chance !== undefined);
    if (!eligibleSkillIds.length) result = { noEligibleSkills: true };
    else {
      runState.nextBattleSkillGuarantee = { sourceId, skillIds: [...eligibleSkillIds] };
      result = { guaranteeArmed: true, skillCount: eligibleSkillIds.length };
    }
  } else if (record.eventId === "fall_rock") {
    if (record.data.stage !== runState.fallRockCount + 1) return false;
    const rule = ADVENTURE_EVENT_DATA.fall_rock.stages[record.data.stage - 1];
    if (rule.maxHpLossFraction) {
      runState.maxHp = Math.max(1, Math.floor(getMaxHp(runState) * (1 - rule.maxHpLossFraction)));
      runState.currentHp = Math.min(runState.currentHp, runState.maxHp);
    }
    const attackGain = rule.attackGainFraction ? Math.floor(runState.atk * rule.attackGainFraction) : 0;
    runState.atk += attackGain;
    const previousCritRate = runState.critRate;
    if (rule.critRateGain) runState.critRate = Math.min(COMBAT_RULES.maxCritChance, runState.critRate + rule.critRateGain);
    runState.fallRockCount += 1;
    runState.fallRockCompleted = runState.fallRockCount >= ADVENTURE_EVENT_DATA.fall_rock.stages.length;
    result = { stage: record.data.stage, maxHp: runState.maxHp, currentHp: runState.currentHp,
      attackGain, atk: runState.atk, critRateGain: runState.critRate - previousCritRate, critRate: runState.critRate };
  } else return false;
  if (!result) return false;
  if (["sea_beyond_2", "old_scroll_2", "coffee_shop", "anteiku_2", "big_rock", "giant_rock_2"].includes(record.eventId))
    record.data.choiceId = choiceId;
  if (!keepPending) record.status = "completed";
  record.result = result;
  return copy(record);
}

// Apply only the event's shared stage-two outcome to one additional party member.
// The event itself is still rolled and completed once on the main run state.
export function applyAdventurePartyOutcome(member, record) {
  ensureRunState(member);
  if (!record || record.status !== "completed" || !record.result || record.result.skipped) return false;
  const key = makeActionKey("party-event", record.sourceId);
  if (!actionAvailable(member, key)) return false;
  if (["coffee_shop", "big_rock", "anteiku_2", "giant_rock_2", "sea_beyond_2"].includes(record.eventId)) {
    if (!record.result.effect && !record.result.healFraction && !record.result.maxHpGainFraction && !record.result.gains?.length) return false;
    applySharedEventEffect(member, record.sourceId, { ...record.result, gains: copy(record.result.gains) });
  } else if (record.eventId === "fall_rock") {
    const rule = ADVENTURE_EVENT_DATA.fall_rock.stages[record.data.stage - 1];
    if (rule.attackGainFraction) member.atk += Math.floor(member.atk * rule.attackGainFraction);
    if (rule.critRateGain) member.critRate = Math.min(COMBAT_RULES.maxCritChance, member.critRate + rule.critRateGain);
    if (!rule.attackGainFraction && !rule.critRateGain) return false;
  } else if (record.eventId === "sea_beyond") {
    if (!record.result.gains?.length) return false;
    for (const { stat, amount } of record.result.gains) member[stat] += amount;
  } else return false;
  recordAction(member, key);
  return true;
}

export function grantGiantSpinalFluid(member, sourceId) {
  ensureRunState(member);
  const key = makeActionKey("giant-spinal-fluid", sourceId);
  if (!recordAction(member, key)) return false;
  const effect = { ...GIANT_SPINAL_FLUID, sourceId };
  member.atk += effect.atk;
  member.def += effect.def;
  member.maxHp += effect.maxHp;
  member.currentHp = Math.min(member.currentHp, member.maxHp);
  member.permanentEffects.push(effect);
  return effect;
}

export function grantAdventureSpecialReward(member, sourceId, rewardId) {
  ensureRunState(member);
  if (!["drip_coffee", "six_ear_true_form"].includes(rewardId) ||
    !recordAction(member, makeActionKey(`special:${rewardId}`, sourceId))) return false;
  const reward = rewardId === "drip_coffee"
    ? { id: rewardId, name: "挂耳咖啡", description: "篝火恢复额外增加最大 HP 的 15%。" }
    : { id: rewardId, name: "六耳真身", description: "本局普通攻击和主动技能攻击无法被敌人闪避。" };
  member.permanentEffects.push({ ...reward, sourceId });
  return reward;
}

export function startAdventureBattle(runState, sourceId) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "pending_battle" || !record.containsBattle) return false;
  record.status = "in_battle";
  return { battleType: record.data.battleType, sourceId };
}

export function completeAdventureBattle(runState, sourceId, outcome, random = Math.random, options = {}) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "in_battle") return false;
  if (outcome !== "victory") {
    record.status = "failed";
    return { status: record.status, reward: null };
  }
  if (record.eventId === "giant_encirclement" && record.data.choiceId === "giant_heart" && !options.deferSpinalFluid) {
    const effect = { ...GIANT_SPINAL_FLUID, sourceId };
    runState.atk += effect.atk;
    runState.def += effect.def;
    runState.maxHp += effect.maxHp;
    runState.currentHp = Math.min(runState.currentHp, runState.maxHp);
    runState.permanentEffects.push(effect);
    record.data.spinalFluidGranted = true;
  }
  if (record.eventId === "kings_treasury") {
    createTreasureOffer(runState, sourceId, record.data.choiceId === "treasury_advance" ? "royal" : "small", random);
  }
  if (record.eventId === "anteiku_2" && record.data.choiceId === "anteiku_fight") record.data.specialRewardId = "drip_coffee";
  if (record.eventId === "giant_rock_2" && record.data.choiceId === "rock_fight") record.data.specialRewardId = "six_ear_true_form";
  const battleId = `event:${sourceId}`;
  const reward = createBattleRewardOffer(runState, battleId, record.data.battleType, random);
  record.status = "awaiting_reward";
  record.data.rewardBattleId = battleId;
  return { status: record.status, reward, spinalFluidGranted: Boolean(record.data.spinalFluidGranted) };
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
  record.result = { stat: reward.stat, selectedStatIds: reward.selectedStatIds };
  if (reward.status === "applied") record.status = "completed";
  else if (reward.status === "awaiting_bonus") record.status = "awaiting_bonus";
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
  const level = skill.levels[runState.passiveLevel ?? 1] ?? skill.levels[1] ?? {};
  const key = `${context.battleId}:${skill.id}:${triggerType}`;
  if (level.oncePerBattle && runState.passiveUses[key] >= (level.immuneHits ?? 1)) return null;
  if (triggerType === "before_attack" && skill.id === "jinchuriki" && !(Math.max(0, finite(context.currentHp, getMaxHp(runState))) < Math.max(1, finite(context.maxHp, getMaxHp(runState))) * (level.currentHpRatioBelow ?? 0.5))) return null;
  runState.passiveUses[key] = (runState.passiveUses[key] ?? 0) + 1;
  const effect = { skillId: skill.id, ...copy(level) };
  if (triggerType === "before_damage" && Number.isFinite(context.damage)) {
    effect.originalDamage = Math.max(0, Math.floor(context.damage));
    effect.finalDamage = effect.damageImmune
      ? 0
      : Math.max(0, Math.floor(effect.originalDamage * (1 - (effect.damageReduction ?? 0))));
  }
  if (triggerType === "before_attack" && skill.id === "jinchuriki") {
    const maxHp = Math.max(1, finite(context.maxHp, 1));
    const currentHp = Math.max(0, finite(context.currentHp, maxHp));
    if (!(currentHp < maxHp * (level.currentHpRatioBelow ?? 0.5))) return null;
    return { skillId: skill.id, skillName: skill.name, currentHp, maxHp, attackBonus: level.attackBonus ?? 0.25, rounding: level.rounding ?? "floor" };
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

import { ADVENTURE_EVENT_DATA, ATTRIBUTE_UPGRADES, CAMPFIRE_RULES, ELITE_BONUS_REWARDS, GIANT_SPINAL_FLUID, SKILL_DATA } from "./skills.js";
import { COMBAT_RULES } from "./characters.js";

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
  state.permanentEffects ??= [];
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
    skillLevels: skillId ? { [skillId]: 1 } : {},
    statOffers: {}, rewardOffers: {}, eventResults: {}, consumedActions: [],
    completedCampfires: [], passiveUses: {}, battleStartPassiveChecks: {}, skillHistory: [], temporaryEffects: [],
    fallRockCount: 0, fallRockCompleted: false, permanentEffects: [],
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

export function getAvailableAdventureEventIds(runState, step = 1) {
  ensureRunState(runState);
  return Object.keys(ADVENTURE_EVENT_DATA).filter((eventId) =>
    !ADVENTURE_EVENT_DATA[eventId].containsBattle
    && (eventId !== "giant_encirclement" || step >= 8)
    && (eventId !== "scroll" || getUnlearnedActiveSkills(runState).length > 0)
    && (eventId !== "fall_rock" || (!runState.fallRockCompleted && runState.fallRockCount < ADVENTURE_EVENT_DATA.fall_rock.stages.length))
    && (eventId !== "sea_beyond" || !Object.values(runState.eventResults).some((event) => event.eventId === "sea_beyond")));
}

export function chooseAdventureEventId(runState, random = Math.random, step = 1) {
  const ids = getAvailableAdventureEventIds(runState, step);
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
  const statOffer = createStatUpgradeChoices(runState, `battle:${battleId}`, random, 2);
  const skillOptions = getUpgradeableSkills(runState);
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
  const bonus = upgradeActiveSkill(runState, skillId, `elite:${battleId}`);
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

export function createAdventureEventResult(runState, sourceId, eventId, random = Math.random) {
  ensureRunState(runState);
  if (!sourceId) throw new TypeError("sourceId is required");
  if (runState.eventResults[sourceId]) return copy(runState.eventResults[sourceId]);
  const config = ADVENTURE_EVENT_DATA[eventId];
  if (!config) throw new RangeError(`unknown adventure event: ${eventId}`);
  if (eventId === "scroll" && !getUnlearnedActiveSkills(runState).length) return null;
  if (eventId === "fall_rock" && (runState.fallRockCompleted || runState.fallRockCount >= config.stages.length)) return null;
  if (eventId === "sea_beyond" && Object.values(runState.eventResults).some((event) => event.eventId === "sea_beyond")) return null;
  const record = { sourceId, eventId, name: config.name, description: config.description, image: config.image, effectText: config.effectText, status: config.containsBattle ? "pending_battle" : "pending", type: config.type, containsBattle: config.containsBattle, data: {} };
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
  if (eventId === "death_note") record.data.blessing = random() < 0.5 ? "player_vulnerable" : "enemy_vulnerable";
  if (eventId === "scroll") {
    const choices = getUnlearnedActiveSkills(runState);
    record.type = "learn_skill";
    record.data.skillChoices = choices;
  }
  if (eventId === "fate_gate") {
    record.data.skillChoices = runState.learnedActiveSkills
      .map((skillId) => getSkillAtLevel(runState, skillId))
      .filter((skill) => skill && Number.isFinite(skill.chance))
      .map((skill) => skill.id);
  }
  if (eventId === "big_rock" || eventId === "coffee_shop") record.data.effect = {
    ...copy(config.effect), name: eventId === "big_rock" ? "巨石减益" : "咖啡店增益",
    statusId: eventId,
    ...(config.effect.durationRounds ? { roundsRemaining: config.effect.durationRounds } : { battlesRemaining: config.effect.durationBattles }),
    sourceId,
  };
  runState.eventResults[sourceId] = record;
  return copy(record);
}

export function resolveAdventureEvent(runState, sourceId, choiceId = null, random = Math.random) {
  ensureRunState(runState);
  const record = runState.eventResults[sourceId];
  if (!record || record.status !== "pending" || record.containsBattle) return false;
  let result;
  let keepPending = false;
  if (record.eventId === "giant_encirclement") {
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
    else { if (!has(record.data.skillChoices, choiceId)) return false; result = learnActiveSkill(runState, choiceId, "event:" + sourceId); }
  } else if (record.eventId === "sea_beyond") {
    if (record.data.phase === "intro") {
      if (choiceId === "sea_pass") {
        result = { skipped: true };
        record.status = "completed";
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
        }
        record.status = "completed";
      }
    } else return false;
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
  } else if (record.eventId === "big_rock" || record.eventId === "coffee_shop") {
    if (runState.temporaryEffects.some(effect => effect.sourceId === sourceId)) return false;
    runState.temporaryEffects.push(copy(record.data.effect)); result = { effect: copy(record.data.effect) };
  } else return false;
  if (!result) return false;
  if (!keepPending) record.status = "completed";
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
  if (record.eventId === "giant_encirclement" && record.data.choiceId === "giant_heart") {
    const effect = { ...GIANT_SPINAL_FLUID, sourceId };
    runState.atk += effect.atk;
    runState.def += effect.def;
    runState.maxHp += effect.maxHp;
    runState.currentHp = Math.min(runState.currentHp, runState.maxHp);
    runState.permanentEffects.push(effect);
    record.data.spinalFluidGranted = true;
  }
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
  const level = skill.levels[1] ?? {};
  const key = `${context.battleId}:${skill.id}:${triggerType}`;
  if (level.oncePerBattle && runState.passiveUses[key]) return null;
  if (triggerType === "before_attack" && skill.id === "jinchuriki" && !(Math.max(0, finite(context.currentHp, getMaxHp(runState))) < Math.max(1, finite(context.maxHp, getMaxHp(runState))) * (level.currentHpRatioBelow ?? 0.5))) return null;
  runState.passiveUses[key] = true;
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

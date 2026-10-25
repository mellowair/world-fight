import { ADVENTURE_EVENTS, CAMPAIGN_BATTLES, CHARACTER_DATA, DEIDARA_ANIMATIONS, ELITE_ENEMY_DATA, STARTING_CHARACTERS } from "./characters.js";
import { SKILL_DATA } from "./skills.js";
import { generateRouteMap, ROUTE_MAP_FINAL_STEP } from "./routeMap.js";
import {
  applyAdventureBattleBonusReward, applyAdventureBattleStatReward, applyBattleBonusReward,
  advanceTemporaryEffectsAfterBattle, applyBattleStatReward, chooseAdventureEventId, completeAdventureBattle, createAdventureEventResult,
  createBattleRewardOffer, createRunCharacterState, getCampfireOptions, getSkillAtLevel,
  getTemporaryCombatModifiers, learnActiveSkill, resolveAdventureEvent, resolveCampfire, startAdventureBattle,
} from "./progression.js";

const enemyTemplates = new Map(CHARACTER_DATA.filter((character) => character.team === "enemy").map((character) => [character.id, character]));
const ROUTE_LENGTH = ROUTE_MAP_FINAL_STEP;

const ROUTE_ENEMY_GROWTH = {
  normal: [
    { minStep: 1, maxStep: 2, hp: 0.8, atk: 0.8, def: 0.8 },
    { minStep: 3, maxStep: 5, hp: 1, atk: 1, def: 1 },
    { minStep: 6, maxStep: 8, hp: 1.25, atk: 1.15, def: 1.1 },
    { minStep: 9, maxStep: ROUTE_LENGTH - 1, hp: 1.4, atk: 1.2, def: 1.15 },
  ],
  elite: [
    { minStep: 1, maxStep: 2, hp: 0.9, atk: 0.9, def: 0.9 },
    { minStep: 3, maxStep: 5, hp: 1, atk: 1, def: 1 },
    { minStep: 6, maxStep: 8, hp: 1.15, atk: 1.1, def: 1.05 },
    { minStep: 9, maxStep: ROUTE_LENGTH - 1, hp: 1.25, atk: 1.15, def: 1.1 },
  ],
};

export function getRouteEnemyGrowth(type, step) {
  if (type === "boss") return { hp: 1, atk: 1, def: 1 };
  const tier = type === "elite" ? "elite" : "normal";
  const band = ROUTE_ENEMY_GROWTH[tier].find((entry) => step >= entry.minStep && step <= entry.maxStep);
  return band ? { hp: band.hp, atk: band.atk, def: band.def } : { hp: 1, atk: 1, def: 1 };
}

function legalChildren(campaign) {
  const current = campaign.routeMap.nodes.find((node) => node.id === campaign.routeMap.currentNodeId);
  if (!current) return [];
  const byId = new Map(campaign.routeMap.nodes.map((node) => [node.id, node]));
  const children = current.nextNodeIds.map((id) => byId.get(id)).filter(Boolean);
  return campaign.consecutiveWithoutBattle >= 2
    ? children.filter((node) => ["battle", "elite", "demon"].includes(node.type))
    : children;
}

function generateRouteOptions(campaign) {
  const children = legalChildren(campaign);
  campaign.routeMap.nodes.forEach((node) => {
    if (node.status === "pending") node.status = "locked";
  });
  children.forEach((node) => {
    if (node.status === "locked") node.status = "pending";
  });
  campaign.routeOptions = children;
  campaign.status = "route";
}

function encounterFor(campaign, type) {
  const step = campaign.step;
  if (type === "elite") {
    const elite = ELITE_ENEMY_DATA[Math.min(ELITE_ENEMY_DATA.length - 1, Math.floor(Math.max(0, Math.min(0.999999999, campaign.random())) * ELITE_ENEMY_DATA.length))];
    return {
      number: campaign.battleNumber + 1, step, type: "elite", eliteId: elite.id,
      title: `精英遭遇：${elite.name}`, location: "精英遭遇地点", description: `${elite.name}挡住了去路。`,
      enemies: [elite.id], enemyNames: { [elite.id]: elite.name },
      enemyBaseStats: { [elite.id]: { hp: elite.hp, atk: elite.atk, def: elite.def, spd: elite.spd } },
    };
  }
  const candidate = CAMPAIGN_BATTLES[Math.min(2, (step - 1) % 3)];
  return {
    ...candidate,
    number: campaign.battleNumber + 1,
    step,
    type,
    title: type === "elite" ? "精英遭遇" : "途中战斗",
    location: type === "elite" ? "精英遭遇地点" : "探索遭遇地点",
    // Route growth is applied once, when building the combat copy in prepareBattle.
    description: type === "elite" ? "强敌拦住了去路。" : "敌人出现在前方。",
  };
}

function enterBattle(campaign, node, type) {
  const kind = type === "boss" ? "boss" : type === "elite" ? "elite" : "normal";
  node.resolution = kind;
  node.battle = kind === "boss"
    ? { ...CAMPAIGN_BATTLES.find((entry) => entry.type === "boss"), number: campaign.completedBattles + 1, step: ROUTE_LENGTH }
    : encounterFor(campaign, kind);
  node.status = "in_progress";
  campaign.activeNode = node;
  campaign.currentBattle = node.battle;
  campaign.battleNumber = campaign.completedBattles + 1;
  campaign.consecutiveWithoutBattle = 0;
  campaign.status = "combat";
  campaign.combatLaunched = false;
  return { type: "battle", battle: campaign.currentBattle };
}

function completeActiveNode(campaign) {
  if (!campaign.activeNode || campaign.activeNode.status !== "in_progress") return false;
  campaign.activeNode.status = "completed";
  campaign.history.push({ id: campaign.activeNode.id, step: campaign.step, type: campaign.activeNode.type, resolution: campaign.activeNode.resolution, status: "completed" });
  campaign.activeNode = null;
  campaign.pendingEvent = null;
  campaign.activeEventType = null;
  campaign.routeMap.currentNodeId = campaign.history.at(-1).id;
  campaign.step += 1;
  generateRouteOptions(campaign);
  return true;
}

export function createCampaign(random = Math.random, options = {}) {
  const seed = options.seed ?? (random === Math.random ? Math.floor(Math.random() * 0x100000000) : 0);
  return {
    status: "intro", random, step: 0, battleNumber: 0, completedBattles: 0,
    playerId: null, partyIds: [], playerHp: 0, playerMaxHp: 0, runCharacterState: null, nextAttackMultiplier: 1,
    consecutiveWithoutBattle: 0, routeMap: generateRouteMap(seed), routeOptions: [], history: [], activeNode: null,
    currentBattle: null, pendingEvent: null, resolvedEvents: [], eventResolved: false, combatLaunched: false,
    startingSkillSelected: false, activeEventType: null, eventBattleSourceId: null,
    rewardBattleId: null, rewardPhase: null, rewardBattleType: null,
  };
}

export function startCampaign(campaign) {
  if (!campaign || campaign.status !== "intro") return false;
  campaign.status = "character-select";
  return true;
}

export function selectStartingCharacter(campaign, characterId, activeSkillId) {
  if (!campaign || campaign.status !== "character-select") return false;
  const character = STARTING_CHARACTERS.find((entry) => entry.id === characterId);
  if (!character) return false;
  let runCharacterState;
  try { runCharacterState = createRunCharacterState(character, activeSkillId); }
  catch { return false; }
  campaign.playerId = character.id;
  campaign.partyIds = [character.id];
  campaign.runCharacterState = runCharacterState;
  campaign.startingSkillSelected = activeSkillId !== null || (character.activeSkills ?? []).length === 0;
  campaign.playerHp = runCharacterState.currentHp;
  campaign.playerMaxHp = runCharacterState.maxHp;
  campaign.status = "entry";
  return { ...character };
}

export function chooseStartingSkill(campaign, skillId) {
  if (!campaign || campaign.status !== "entry" || campaign.startingSkillSelected || !campaign.runCharacterState) return false;
  const learned = learnActiveSkill(campaign.runCharacterState, skillId, `starting:${campaign.playerId}`);
  if (!learned) return false;
  campaign.startingSkillSelected = true;
  return learned;
}

export function beginJourney(campaign) {
  if (!campaign || campaign.status !== "entry" || !campaign.playerId || !campaign.startingSkillSelected) return false;
  campaign.step = 1;
  generateRouteOptions(campaign);
  return campaign.status;
}

export function getBattleDefinition(battleNumber) {
  return CAMPAIGN_BATTLES.find((battle) => battle.number === battleNumber) ?? null;
}

export function prepareBattle(campaign) {
  if (!campaign || campaign.status !== "combat" || campaign.combatLaunched) return null;
  const battle = campaign.currentBattle ?? CAMPAIGN_BATTLES.find((entry) => entry.type === "boss");
  if (!battle) return null;
  const playerTemplate = STARTING_CHARACTERS.find((character) => character.id === campaign.playerId);
  if (!playerTemplate) return null;
  campaign.combatLaunched = true;
  const run = campaign.runCharacterState;
  if (!run || run.characterId !== playerTemplate.id) return null;
  let skillEffects = run.learnedActiveSkills.map((id) => getSkillAtLevel(run, id)).filter(Boolean);
  const battleStartEffects = [];
  const guarantee = run.nextBattleSkillGuarantee;
  if (guarantee) {
    const eligible = skillEffects.filter((skill) => guarantee.skillIds.includes(skill.id) && Number.isFinite(skill.chance));
    if (eligible.length) {
      const selected = eligible[Math.min(eligible.length - 1, Math.floor(Math.max(0, Math.min(0.999999999, campaign.random())) * eligible.length))];
      skillEffects = skillEffects.map((skill) => skill.id === selected.id ? { ...skill, chance: 1 } : skill);
      battleStartEffects.push({ type: "skill-guarantee", skillId: selected.id, skillName: selected.name, sourceId: guarantee.sourceId });
    }
    run.nextBattleSkillGuarantee = null;
  }
  const temporaryModifiers = getTemporaryCombatModifiers(run);
  const routeGrowth = getRouteEnemyGrowth(battle.type, battle.step);
  const battleId = campaign.eventBattleSourceId ? `event:${campaign.eventBattleSourceId}` : campaign.activeNode?.id ?? `step-${campaign.step}-battle`;
  const ally = {
    ...playerTemplate,
    hp: run.maxHp, maxHp: run.maxHp, currentHp: run.currentHp,
    atk: Math.floor(run.atk * campaign.nextAttackMultiplier), def: Math.max(0, run.def + temporaryModifiers.def), spd: Math.max(0, run.spd + temporaryModifiers.spd),
    damageTakenMultiplier: temporaryModifiers.damageTakenMultiplier, damageDealtMultiplier: temporaryModifiers.damageDealtMultiplier,
    critChance: run.critRate, critMultiplier: run.critMultiplier,
    skills: skillEffects, skill: skillEffects[0] ?? null,
  };
  campaign.nextAttackMultiplier = 1;
  const enemies = battle.enemies.map((enemyId) => {
    const template = enemyTemplates.get(enemyId) ?? ELITE_ENEMY_DATA.find((entry) => entry.id === enemyId);
    if (!template) throw new RangeError(`Unknown battle enemy: ${enemyId}`);
    const baseStats = battle.enemyBaseStats?.[enemyId] ?? template;
    const baseHp = baseStats.hp ?? baseStats.maxHp;
    const maxHp = Math.max(1, Math.floor(baseHp * routeGrowth.hp));
    const isDeidaraBoss = battle.type === "boss" && battle.enemyNames?.[enemyId] === "迪达拉";
    const bossSkillConfig = SKILL_DATA["c4-garuda"];
    const bossSkill = isDeidaraBoss ? { ...bossSkillConfig, ...bossSkillConfig.levels[1], level: 1 } : null;
    const eliteSkills = (template.activeSkills ?? []).map((skillId) => {
      const config = SKILL_DATA[skillId];
      return config?.levels?.[1] ? { ...config, ...config.levels[1], level: 1 } : null;
    }).filter(Boolean);
    return {
      ...template, name: battle.enemyNames?.[enemyId] ?? template.name,
      ...(isDeidaraBoss ? {
        role: "爆破艺术家",
        asset: "assets/deidara-v2/idle/idle_1.png",
        animations: DEIDARA_ANIMATIONS,
        attackAnimation: "attack",
        skillAnimationMap: { "c4-garuda": "skill1" },
      } : {}),
      hp: maxHp, maxHp, currentHp: maxHp,
      atk: Math.max(1, Math.floor(baseStats.atk * routeGrowth.atk)),
      def: Math.max(1, Math.floor(baseStats.def * routeGrowth.def)),
      spd: Math.max(1, baseStats.spd),
      ...(template.type === "elite" ? {
        team: "enemy", row: template.row ?? "front", position: template.position ?? "front",
        skills: eliteSkills, skill: eliteSkills[0] ?? null,
        skillAnimationMap: template.skillAnimationMap ?? {},
      } : {}),
      ...(template.elitePassiveId ? { elitePassiveId: template.elitePassiveId } : {}),
      ...(template.escapeAsset ? { escapeAsset: template.escapeAsset } : {}),
      ...(isDeidaraBoss ? { skill: bossSkill, skills: [bossSkill], c0DamagePerRound: battle.enemyMechanics?.[enemyId]?.c0DamagePerRound ?? 70 } : {}),
    };
  });
  campaign.currentBattle.id = battleId;
  return {
    battle: campaign.currentBattle, roster: [ally, ...enemies],
    combatOptions: { runCharacterState: run, playerId: campaign.playerId, battleId, battleStartEffects },
  };
}

export function finishBattle(campaign, outcome, playerHp, battleEvents = []) {
  if (!campaign || campaign.status !== "combat" || !campaign.combatLaunched) return false;
  campaign.combatLaunched = false;
  campaign.playerMaxHp = campaign.runCharacterState?.maxHp ?? campaign.playerMaxHp;
  campaign.playerHp = Math.max(0, Math.min(campaign.playerMaxHp, playerHp));
  if (campaign.runCharacterState) campaign.runCharacterState.currentHp = campaign.playerHp;
  if (campaign.runCharacterState) advanceTemporaryEffectsAfterBattle(campaign.runCharacterState);
  if (campaign.runCharacterState && Array.isArray(battleEvents)) {
    const casts = new Set(battleEvents.filter(event => event?.skillId === "rasengan" && event.targetDied).map(event => event.skillCastId || [campaign.currentBattle?.id, event.round, event.attackerId].join(":")));
    for (const castId of casts) { const key = "rasengan-kill:" + castId; if (!campaign.runCharacterState.consumedActions.includes(key)) { campaign.runCharacterState.spd += 10; campaign.runCharacterState.consumedActions.push(key); } }
  }
  if (outcome !== "victory" || campaign.playerHp <= 0) {
    if (campaign.eventBattleSourceId) completeAdventureBattle(campaign.runCharacterState, campaign.eventBattleSourceId, "defeat", campaign.random);
    campaign.settlementNext = "defeat";
    campaign.status = "settlement";
    return { status: "settlement", next: "defeat" };
  }
  campaign.completedBattles += 1;
  campaign.consecutiveWithoutBattle = 0;
  if (campaign.currentBattle?.type === "boss" || campaign.activeNode?.type === "demon") {
    campaign.settlementNext = "victory";
    campaign.status = "settlement";
    return { status: "settlement", next: "victory" };
  }

  campaign.rewardBattleType = campaign.eventBattleSourceId
    ? campaign.runCharacterState.eventResults[campaign.eventBattleSourceId]?.data.battleType
    : campaign.currentBattle?.type === "elite" || campaign.activeNode?.resolution === "elite" ? "elite" : "normal";
  if (campaign.eventBattleSourceId) {
    const result = completeAdventureBattle(campaign.runCharacterState, campaign.eventBattleSourceId, "victory", campaign.random);
    if (!result || result.status !== "awaiting_reward") return false;
    campaign.rewardBattleId = campaign.runCharacterState.eventResults[campaign.eventBattleSourceId].data.rewardBattleId;
  } else {
    campaign.rewardBattleId = campaign.activeNode?.id ?? campaign.currentBattle?.id;
    createBattleRewardOffer(campaign.runCharacterState, campaign.rewardBattleId, campaign.rewardBattleType, campaign.random);
  }
  campaign.rewardPhase = "stat";
  campaign.status = "reward";
  if (campaign.activeNode) campaign.activeNode.rewardStatus = "pending";
  return { status: "reward", next: "reward", battleType: campaign.rewardBattleType };
}

export function completeSettlement(campaign) {
  if (!campaign || campaign.status !== "settlement" || !campaign.settlementNext) return null;
  const next = campaign.settlementNext;
  campaign.settlementNext = null;
  if (next === "victory" && campaign.activeNode) {
    campaign.activeNode.status = "completed";
    campaign.history.push({ id: campaign.activeNode.id, step: campaign.step, type: campaign.activeNode.type, resolution: campaign.activeNode.resolution, status: "completed" });
    campaign.activeNode = null;
  }
  campaign.status = next;
  return campaign.status;
}

function finishRewardAndAdvance(campaign) {
  campaign.playerHp = campaign.runCharacterState.currentHp;
  if (campaign.activeNode) campaign.activeNode.rewardStatus = "claimed";
  if (campaign.eventBattleSourceId) {
    const record = campaign.runCharacterState.eventResults[campaign.eventBattleSourceId];
    if (record?.status !== "completed") return false;
    campaign.eventResolved = true;
  }
  const completed = completeActiveNode(campaign);
  if (!completed) return false;
  campaign.currentBattle = null;
  campaign.rewardBattleId = null;
  campaign.rewardPhase = null;
  campaign.rewardBattleType = null;
  campaign.eventBattleSourceId = null;
  return campaign.status;
}

export function getCampaignRewardOffer(campaign) {
  if (!campaign?.runCharacterState || campaign.status !== "reward" || !campaign.rewardBattleId) return null;
  return campaign.runCharacterState.rewardOffers[campaign.rewardBattleId] ?? null;
}

export function claimCampaignReward(campaign, choiceId, extraChoiceId = null, skillId = null) {
  if (!campaign || campaign.status !== "reward" || !campaign.runCharacterState || !campaign.rewardBattleId) return false;
  const offer = getCampaignRewardOffer(campaign);
  if (!offer) return false;
  if (campaign.rewardPhase === "stat") {
    const result = campaign.eventBattleSourceId
      ? applyAdventureBattleStatReward(campaign.runCharacterState, campaign.eventBattleSourceId, choiceId)
      : applyBattleStatReward(campaign.runCharacterState, campaign.rewardBattleId, choiceId);
    if (!result) return false;
    campaign.playerHp = campaign.runCharacterState.currentHp;
    campaign.playerMaxHp = campaign.runCharacterState.maxHp;
    if (result.status === "awaiting_bonus") {
      campaign.rewardPhase = "bonus";
      if (campaign.activeNode) campaign.activeNode.rewardStatus = "awaiting_bonus";
      return { phase: "bonus", result };
    }
    if (result.status !== "applied" && result.status !== "completed") return { phase: "stat", result };
    if (campaign.activeNode) campaign.activeNode.rewardStatus = "claimed";
    return { phase: "complete", result, status: finishRewardAndAdvance(campaign) };
  }
  if (campaign.rewardPhase === "bonus") {
    const result = campaign.eventBattleSourceId
      ? applyAdventureBattleBonusReward(campaign.runCharacterState, campaign.eventBattleSourceId, choiceId, skillId)
      : applyBattleBonusReward(campaign.runCharacterState, campaign.rewardBattleId, choiceId, skillId);
    if (!result) return false;
    campaign.playerHp = campaign.runCharacterState.currentHp;
    campaign.playerMaxHp = campaign.runCharacterState.maxHp;
    if (campaign.activeNode) campaign.activeNode.rewardStatus = "claimed";
    return { phase: "complete", result, status: finishRewardAndAdvance(campaign) };
  }
  return false;
}

export function getRouteOptions(campaign) {
  return campaign?.status === "route" ? legalChildren(campaign).filter((node) => node.status === "pending") : [];
}

export function getRouteMap(campaign) {
  return campaign?.routeMap ?? null;
}

export function chooseRoute(campaign, nodeId) {
  if (!campaign || campaign.status !== "route") return null;
  const node = getRouteOptions(campaign).find((option) => option.id === nodeId && option.status === "pending");
  if (!node) return null;
  const current = campaign.routeMap.nodes.find((entry) => entry.id === campaign.routeMap.currentNodeId);
  if (!current || !current.nextNodeIds.includes(node.id)) return null;
  campaign.routeMap.visitedEdges.push({ from: current.id, to: node.id });
  node.status = "entered";
  campaign.activeNode = node;
  node.status = "in_progress";
  if (node.type === "battle") {
    return enterBattle(campaign, node, "normal");
  }
  if (node.type === "elite") return enterBattle(campaign, node, "elite");
  if (node.type === "demon") return enterBattle(campaign, node, "boss");

  if (node.type === "campfire") {
    node.resolution = "campfire";
    campaign.activeEventType = "campfire";
    campaign.pendingEvent = null;
  } else {
    const eventId = chooseAdventureEventId(campaign.runCharacterState, campaign.random);
    campaign.activeEventType = "adventure";
    campaign.pendingEvent = createAdventureEventResult(campaign.runCharacterState, node.id, eventId, campaign.random);
    node.resolution = campaign.pendingEvent.eventId;
  }
  campaign.eventResolved = false;
  campaign.status = "event";
  return { type: "event", event: campaign.pendingEvent, symbol: node.type === "question" ? "?" : "campfire" };
}

export function resolveRouteEvent(campaign) {
  if (!campaign || campaign.status !== "event" || campaign.eventResolved) return null;
  if (campaign.activeEventType === "campfire") return false;
  const record = campaign.pendingEvent;
  if (record?.containsBattle) return false;
  const choices = record?.data?.statChoices ?? record?.data?.skillChoices ?? [];
  const result = resolveCampaignEvent(campaign, choices[0] ?? null);
  return result ? { event: record, result: record.result, playerHp: campaign.playerHp } : null;
}

export function resolveCampaignEvent(campaign, choiceId = null, skillId = null) {
  if (!campaign || campaign.status !== "event" || campaign.eventResolved || !campaign.activeNode) return false;
  let result;
  if (campaign.activeEventType === "campfire") {
    result = resolveCampfire(campaign.runCharacterState, campaign.activeNode.id, choiceId, skillId);
  } else {
    result = resolveAdventureEvent(campaign.runCharacterState, campaign.activeNode.id, choiceId);
  }
  if (!result) return false;
  campaign.pendingEvent = campaign.runCharacterState.eventResults[campaign.activeNode.id] ?? campaign.pendingEvent;
  campaign.playerHp = campaign.runCharacterState.currentHp;
  campaign.playerMaxHp = campaign.runCharacterState.maxHp;
  const eventRecord = campaign.runCharacterState.eventResults[campaign.activeNode.id];
  if (campaign.activeEventType === "adventure" && eventRecord?.status === "pending") return result;
  campaign.eventResolved = true;
  campaign.activeNode.resolutionResult = result;
  campaign.resolvedEvents.push({ id: campaign.activeNode.id, title: campaign.activeEventType === "campfire" ? "篝火" : campaign.pendingEvent?.name, result });
  return result;
}

export function getActiveCampfireOptions(campaign) {
  if (!campaign || campaign.status !== "event" || campaign.activeEventType !== "campfire") return null;
  return getCampfireOptions(campaign.runCharacterState);
}

export function startCampaignEventBattle(campaign) {
  if (!campaign || campaign.status !== "event" || campaign.eventResolved || campaign.activeEventType !== "adventure" || !campaign.pendingEvent?.containsBattle || !campaign.activeNode) return false;
  const started = startAdventureBattle(campaign.runCharacterState, campaign.activeNode.id);
  if (!started) return false;
  campaign.eventBattleSourceId = campaign.activeNode.id;
  campaign.activeNode.resolution = started.battleType;
  campaign.currentBattle = encounterFor(campaign, started.battleType);
  campaign.currentBattle.id = `event:${campaign.activeNode.id}`;
  campaign.battleNumber = campaign.completedBattles + 1;
  campaign.consecutiveWithoutBattle = 0;
  campaign.status = "combat";
  campaign.combatLaunched = false;
  return { type: "battle", battle: campaign.currentBattle };
}

export function completeLocation(campaign) {
  if (!campaign || campaign.status !== "event" || !campaign.eventResolved) return null;
  campaign.consecutiveWithoutBattle += 1;
  completeActiveNode(campaign);
  return campaign.status;
}

export function restartCampaign(random = Math.random) { return createCampaign(random); }

export const CAMPAIGN_ROUTE_LENGTH = ROUTE_LENGTH;

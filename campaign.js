import { ADVENTURE_EVENTS, CAMPAIGN_BATTLES, CHARACTER_DATA, STARTING_CHARACTERS } from "./characters.js";

const enemyTemplates = new Map(CHARACTER_DATA.filter((character) => character.team === "enemy").map((character) => [character.id, character]));
const ROUTE_LENGTH = 10;

function pickIndex(length, random) { return Math.min(length - 1, Math.floor(random() * length)); }

function weightedChoice(entries, random) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let point = random() * total;
  for (const entry of entries) {
    point -= entry.weight;
    if (point < 0) return entry.value;
  }
  return entries.at(-1).value;
}

function battleKindsForStep(step) {
  return step >= 3 && step <= 8 ? ["normal", "elite"] : ["normal"];
}

function makeNode(campaign, index, type) {
  return { id: `step-${campaign.step}-choice-${index}`, step: campaign.step, type, status: "pending", resolution: null, event: null, battle: null };
}

function generateRouteOptions(campaign) {
  const step = campaign.step;
  if (step >= ROUTE_LENGTH) {
    campaign.status = "combat";
    const node = makeNode(campaign, 0, "demon");
    node.status = "in_progress";
    node.resolution = "boss";
    node.battle = { ...CAMPAIGN_BATTLES.find((entry) => entry.type === "boss"), number: campaign.completedBattles + 1, step: ROUTE_LENGTH };
    campaign.activeNode = node;
    campaign.currentBattle = node.battle;
    campaign.battleNumber = campaign.completedBattles + 1;
    campaign.routeOptions = [];
    return;
  }

  let choices;
  if (campaign.consecutiveWithoutBattle >= 2) {
    choices = ["battle", "battle"];
  } else {
    let weights;
    if (step <= 2) weights = [{ value: "battle", weight: 70 }, { value: "question", weight: 30 }];
    else if (step <= 8) weights = [{ value: "battle", weight: 50 }, { value: "question", weight: 30 }, { value: "campfire", weight: 20 }];
    else weights = [{ value: "battle", weight: 50 }, { value: "question", weight: 30 }];
    choices = [weightedChoice(weights, campaign.random), weightedChoice(weights, campaign.random)];
  }
  campaign.routeOptions = choices.map((type, index) => makeNode(campaign, index, type));
  campaign.status = "route";
}

function encounterFor(campaign, type) {
  const step = campaign.step;
  const candidate = type === "elite"
    ? CAMPAIGN_BATTLES.find((entry) => entry.type === "elite")
    : CAMPAIGN_BATTLES[Math.min(2, (step - 1) % 3)];
  const progression = 1 + Math.max(0, step - 1) * 0.025;
  return {
    ...candidate,
    number: campaign.battleNumber + 1,
    step,
    type,
    title: type === "elite" ? "精英遭遇" : "途中战斗",
    location: type === "elite" ? "精英遭遇地点" : "探索遭遇地点",
    hpScale: candidate.hpScale * progression,
    atkScale: candidate.atkScale * progression,
    description: type === "elite" ? "强敌拦住了去路。" : "敌人出现在前方。",
  };
}

function enterBattle(campaign, node, type) {
  const kind = type === "elite" && battleKindsForStep(campaign.step).includes("elite") ? "elite" : "normal";
  node.resolution = kind;
  node.battle = encounterFor(campaign, kind);
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
  campaign.history.push({ step: campaign.step, type: campaign.activeNode.type, resolution: campaign.activeNode.resolution, status: "completed" });
  campaign.activeNode = null;
  campaign.pendingEvent = null;
  campaign.step += 1;
  generateRouteOptions(campaign);
  return true;
}

export function createCampaign(random = Math.random) {
  return {
    status: "intro", random, step: 0, battleNumber: 0, completedBattles: 0,
    playerId: null, partyIds: [], playerHp: 0, playerMaxHp: 0, nextAttackMultiplier: 1,
    consecutiveWithoutBattle: 0, routeOptions: [], history: [], activeNode: null,
    currentBattle: null, pendingEvent: null, resolvedEvents: [], eventResolved: false, combatLaunched: false,
  };
}

export function startCampaign(campaign) {
  if (!campaign || campaign.status !== "intro") return false;
  campaign.status = "character-select";
  return true;
}

export function selectStartingCharacter(campaign, characterId) {
  if (!campaign || campaign.status !== "character-select") return false;
  const character = STARTING_CHARACTERS.find((entry) => entry.id === characterId);
  if (!character) return false;
  campaign.playerId = character.id;
  campaign.partyIds = [character.id];
  campaign.playerHp = character.hp;
  campaign.playerMaxHp = character.hp;
  campaign.status = "entry";
  return { ...character };
}

export function beginJourney(campaign) {
  if (!campaign || campaign.status !== "entry" || !campaign.playerId) return false;
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
  const ally = {
    ...playerTemplate,
    maxHp: campaign.playerMaxHp,
    currentHp: campaign.playerHp,
    atk: Math.floor(playerTemplate.atk * campaign.nextAttackMultiplier),
  };
  campaign.nextAttackMultiplier = 1;
  const enemies = battle.enemies.map((enemyId) => {
    const template = enemyTemplates.get(enemyId);
    const maxHp = Math.max(1, Math.floor(template.hp * battle.hpScale));
    return {
      ...template, name: battle.enemyNames?.[enemyId] ?? template.name,
      hp: maxHp, maxHp, currentHp: maxHp,
      atk: Math.max(1, Math.floor(template.atk * battle.atkScale)),
      def: Math.max(0, Math.floor(template.def * battle.defScale)),
    };
  });
  return { battle, roster: [ally, ...enemies] };
}

export function finishBattle(campaign, outcome, playerHp) {
  if (!campaign || campaign.status !== "combat" || !campaign.combatLaunched) return false;
  campaign.combatLaunched = false;
  campaign.playerHp = Math.max(0, Math.min(campaign.playerMaxHp, playerHp));
  if (outcome !== "victory" || campaign.playerHp <= 0) campaign.settlementNext = "defeat";
  else {
    campaign.completedBattles += 1;
    if (campaign.activeNode) campaign.activeNode.status = "completed";
    campaign.consecutiveWithoutBattle = 0;
    campaign.settlementNext = campaign.step === ROUTE_LENGTH ? "victory" : "route";
  }
  campaign.status = "settlement";
  return { status: "settlement", next: campaign.settlementNext };
}

export function completeSettlement(campaign) {
  if (!campaign || campaign.status !== "settlement" || !campaign.settlementNext) return null;
  const next = campaign.settlementNext;
  campaign.settlementNext = null;
  if (next === "route") {
    campaign.history.push({ step: campaign.step, type: campaign.activeNode?.type ?? "battle", resolution: campaign.activeNode?.resolution ?? "normal", status: "completed" });
    campaign.activeNode = null;
    campaign.currentBattle = null;
    campaign.step += 1;
    generateRouteOptions(campaign);
  } else {
    if (next === "victory" && campaign.activeNode) {
      campaign.history.push({ step: campaign.step, type: campaign.activeNode.type, resolution: campaign.activeNode.resolution, status: "completed" });
      campaign.activeNode = null;
    }
    campaign.status = next;
  }
  return campaign.status;
}

export function getRouteOptions(campaign) {
  return campaign?.status === "route" ? campaign.routeOptions.filter((node) => node.status === "pending") : [];
}

export function chooseRoute(campaign, nodeId) {
  if (!campaign || campaign.status !== "route") return null;
  const node = campaign.routeOptions.find((option) => option.id === nodeId && option.status === "pending");
  if (!node) return null;
  node.status = "entered";
  campaign.activeNode = node;
  node.status = "in_progress";
  if (node.type === "battle") {
    const elite = battleKindsForStep(campaign.step).includes("elite") && campaign.random() < 0.2;
    return enterBattle(campaign, node, elite ? "elite" : "normal");
  }
  if (node.type === "demon") return enterBattle(campaign, node, "boss");

  if (node.type === "question") {
    node.resolution = campaign.random() < 0.3 ? "encounter" : "event";
    if (node.resolution === "encounter") return enterBattle(campaign, node, "normal");
  } else node.resolution = "event";

  campaign.pendingEvent = node.type === "campfire"
    ? ADVENTURE_EVENTS.find((event) => event.effect === "heal")
    : ADVENTURE_EVENTS[pickIndex(ADVENTURE_EVENTS.length, campaign.random)];
  campaign.eventResolved = false;
  campaign.status = "event";
  return { type: "event", event: campaign.pendingEvent, symbol: node.type === "question" ? "?" : "campfire" };
}

export function resolveRouteEvent(campaign) {
  if (!campaign || campaign.status !== "event" || !campaign.pendingEvent || campaign.eventResolved) return null;
  const event = campaign.pendingEvent;
  let result;
  if (event.effect === "heal") {
    const before = campaign.playerHp;
    campaign.playerHp = Math.min(campaign.playerMaxHp, campaign.playerHp + event.amount);
    result = `恢复了 ${campaign.playerHp - before} 点生命，当前生命 ${campaign.playerHp}/${campaign.playerMaxHp}。`;
  } else if (event.effect === "attack") {
    campaign.nextAttackMultiplier = event.multiplier;
    result = `下一场战斗攻击力提高 ${Math.round((event.multiplier - 1) * 100)}%。`;
  } else {
    const before = campaign.playerHp;
    campaign.playerHp = Math.max(1, campaign.playerHp - event.amount);
    result = `失去 ${before - campaign.playerHp} 点生命，当前生命 ${campaign.playerHp}/${campaign.playerMaxHp}。`;
  }
  campaign.resolvedEvents ??= [];
  campaign.resolvedEvents.push({ id: event.id, title: event.title, result });
  campaign.eventResolved = true;
  campaign.activeNode.resolutionResult = result;
  return { event, result, playerHp: campaign.playerHp };
}

export function completeLocation(campaign) {
  if (!campaign || campaign.status !== "event" || !campaign.eventResolved) return null;
  campaign.consecutiveWithoutBattle += 1;
  completeActiveNode(campaign);
  return campaign.status;
}

export function restartCampaign(random = Math.random) { return createCampaign(random); }

export const CAMPAIGN_ROUTE_LENGTH = ROUTE_LENGTH;

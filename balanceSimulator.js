import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { STARTING_CHARACTERS } from "./characters.js";
import { simulateBattle } from "./battle.js";
import {
  beginJourney, chooseRoute, chooseStartingSkill, claimCampaignReward,
  completeLocation, completeSettlement, createCampaign, finishBattle,
  getActiveCampfireOptions, getCampaignRewardOffer, getRouteOptions,
  prepareBattle, resolveCampaignEvent, selectStartingCharacter,
  startCampaign, startCampaignEventBattle,
} from "./campaign.js";

const DEFAULT_RUNS = 100;
const DEFAULT_SEED = 20261024;
const MAX_RUNS = 10000;
const PLAYER_ID = STARTING_CHARACTERS[0]?.id;

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseStat(choices) {
  return choices.includes("attack") ? "attack" : choices[0];
}

function applyReward(campaign, stats) {
  const offer = getCampaignRewardOffer(campaign);
  if (!offer) throw new Error("Reward state has no offer");
  const preferred = chooseStat(offer.statChoices);
  const secondStat = offer.statChoices.find((choice) => choice !== preferred);
  const first = claimCampaignReward(campaign, [preferred, secondStat]);
  if (!first) throw new Error("Could not apply simulated battle reward");
  stats.statRewards += 2;
  if (first.phase === "bonus") {
    const skillId = offer.upgradeableSkills[0];
    const second = claimCampaignReward(campaign, "skill_upgrade", null, skillId);
    if (!second) throw new Error("Could not apply simulated elite reward");
    stats.eliteBonuses += 1;
  }
}

function resolveEvent(campaign, stats) {
  if (campaign.activeEventType === "campfire") {
    const options = getActiveCampfireOptions(campaign);
    const upgrade = options?.[1];
    const result = upgrade?.enabled
      ? resolveCampaignEvent(campaign, "skill_upgrade", upgrade.skills[0].skillId)
      : resolveCampaignEvent(campaign, "rest");
    if (!result) throw new Error("Could not resolve simulated campfire");
    stats.events.campfire = (stats.events.campfire ?? 0) + 1;
  } else {
    const event = campaign.pendingEvent;
    stats.events[event.eventId] = (stats.events[event.eventId] ?? 0) + 1;
    if (event.containsBattle) {
      if (!startCampaignEventBattle(campaign)) throw new Error("Could not start simulated encounter");
      return;
    }
    let choice = null;
    if (event.eventId === "sea_beyond") {
      let result = resolveCampaignEvent(campaign, "sea_begin");
      while (result?.status === "pending") result = resolveCampaignEvent(campaign, "sea_sacrifice");
      if (!result) throw new Error("Could not resolve simulated event: sea_beyond");
    }
    else if (event.eventId === "death_note") choice = "death_note_open";
    else if (event.eventId === "fate_gate") choice = "fate_accept";
    else if (["learn_skill", "skill_upgrade"].includes(event.type)) choice = event.data.skillChoices[0] ?? "scroll_leave";
    if (["stat_choice", "curse"].includes(event.type)) choice = chooseStat(event.data.statChoices);
    if (event.eventId !== "sea_beyond") {
      const result = resolveCampaignEvent(campaign, choice);
      if (!result) throw new Error(`Could not resolve simulated event: ${event.eventId}`);
    }
  }
  if (!completeLocation(campaign)) throw new Error("Could not advance after a resolved event");
}

function runOneCampaign(seed) {
  const random = seededRandom(seed);
  const campaign = createCampaign(random, { seed });
  const stats = { battles: 0, statRewards: 0, eliteBonuses: 0, battleTypes: {}, eliteTypes: {}, routes: {}, events: {} };
  if (!startCampaign(campaign)) throw new Error("Could not start campaign");
  const hero = STARTING_CHARACTERS.find((entry) => entry.id === PLAYER_ID);
  const openingSkill = hero?.activeSkills?.[0];
  if (!hero || !selectStartingCharacter(campaign, hero.id, null) || !chooseStartingSkill(campaign, openingSkill)) {
    throw new Error("Could not create simulated starting hero");
  }
  if (beginJourney(campaign) !== "route") throw new Error("Could not enter route");

  let transitions = 0;
  while (!["settlement", "victory", "defeat"].includes(campaign.status)) {
    if (++transitions > 500) throw new Error(`Simulation exceeded transition limit at step ${campaign.step}`);
    if (campaign.status === "route") {
      const route = getRouteOptions(campaign)[0];
      if (!route) throw new Error(`No route choices at step ${campaign.step}`);
      stats.routes[route.type] = (stats.routes[route.type] ?? 0) + 1;
      if (!chooseRoute(campaign, route.id)) throw new Error("Could not choose simulated route");
      continue;
    }
    if (campaign.status === "event") {
      resolveEvent(campaign, stats);
      continue;
    }
    if (campaign.status === "combat") {
      const prepared = prepareBattle(campaign);
      if (!prepared) throw new Error("Could not prepare simulated battle");
      const battleType = prepared.battle.type;
      const result = simulateBattle(prepared.roster, random, prepared.combatOptions);
      const heroResult = result.finalCharacters.find((entry) => entry.id === PLAYER_ID);
      stats.battles += 1;
      stats.battleTypes[battleType] = (stats.battleTypes[battleType] ?? 0) + 1;
      if (prepared.battle.eliteId) stats.eliteTypes[prepared.battle.eliteId] = (stats.eliteTypes[prepared.battle.eliteId] ?? 0) + 1;
      const transition = finishBattle(campaign, result.outcome, heroResult?.currentHp ?? 0, result.events);
      if (!transition) throw new Error("Could not settle simulated battle");
      if (transition.status === "reward") applyReward(campaign, stats);
      else if (campaign.status === "settlement") completeSettlement(campaign);
      continue;
    }
    throw new Error(`Unsupported campaign state: ${campaign.status}`);
  }

  return {
    outcome: campaign.status,
    endingStep: campaign.step,
    completedSteps: campaign.history.length,
    completedBattles: campaign.completedBattles,
    finalHp: campaign.runCharacterState.currentHp,
    ...stats,
  };
}

export function simulateCampaigns({ runs = DEFAULT_RUNS, seed = DEFAULT_SEED } = {}) {
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) throw new RangeError(`runs must be an integer from 1 to ${MAX_RUNS}`);
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  const outcomes = { victory: 0, defeat: 0 };
  const endingSteps = {};
  const battleTypes = {};
  const eliteTypes = {};
  const routeTypes = {};
  const events = {};
  let totalBattles = 0;
  let totalSteps = 0;
  let winningHp = 0;
  for (let index = 0; index < runs; index += 1) {
    const result = runOneCampaign((seed + index) >>> 0);
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    endingSteps[result.endingStep] = (endingSteps[result.endingStep] ?? 0) + 1;
    totalBattles += result.battles;
    totalSteps += result.completedSteps;
    if (result.outcome === "victory") winningHp += result.finalHp;
    for (const [key, count] of Object.entries(result.battleTypes)) battleTypes[key] = (battleTypes[key] ?? 0) + count;
    for (const [key, count] of Object.entries(result.eliteTypes)) eliteTypes[key] = (eliteTypes[key] ?? 0) + count;
    for (const [key, count] of Object.entries(result.routes)) routeTypes[key] = (routeTypes[key] ?? 0) + count;
    for (const [key, count] of Object.entries(result.events)) events[key] = (events[key] ?? 0) + count;
  }
  return {
    seed,
    runs,
    policy: "选择鸣人及角色配置中的第一项开局技能；每步选择生成列表的第一块路牌；属性强化优先攻击，篝火优先升级首项可升级技能，否则休息；精英奖励优先升级技能，否则治疗。",
    outcomes,
    observedVictoryRate: outcomes.victory / runs,
    endingSteps,
    averageBattles: totalBattles / runs,
    averageCompletedRouteSteps: totalSteps / runs,
    averageRemainingHpOnVictory: outcomes.victory ? winningHp / outcomes.victory : null,
    battleTypes,
    eliteTypes,
    routeTypes,
    events,
    balanceChangesApplied: false,
  };
}

export function formatSimulationReport(report) {
  const rows = (value) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `| ${key} | ${count} |`).join("\n") || "| — | 0 |";
  return [
    `# 第一大关可复现模拟报告`,
    ``,
    `- 种子：${report.seed}`,
    `- 局数：${report.runs}`,
    `- 决策策略：${report.policy}`,
    `- 观察到的通关比例：${(report.observedVictoryRate * 100).toFixed(1)}%（仅报告观察值，无目标阈值）`,
    `- 结局计数：通关 ${report.outcomes.victory}，战败 ${report.outcomes.defeat}`,
    `- 平均战斗数：${report.averageBattles.toFixed(2)}`,
    `- 平均完成地点数：${report.averageCompletedRouteSteps.toFixed(2)}`,
    `- 胜利局平均剩余 HP：${report.averageRemainingHpOnVictory === null ? "无胜利样本" : report.averageRemainingHpOnVictory.toFixed(1)}`,
    `- 自动调整数值：否`,
    ``,
    `## 结局步数`, `| 步数 | 局数 |`, `|---:|---:|`, rows(report.endingSteps),
    ``,
    `## 战斗类型`, `| 类型 | 次数 |`, `|---|---:|`, rows(report.battleTypes),
    ``, `## 精英敌人`, `| 精英类型 | 次数 |`, `|---|---:|`, rows(report.eliteTypes),
    ``,
    `## 路线类型`, `| 类型 | 次数 |`, `|---|---:|`, rows(report.routeTypes),
    ``,
    `## 奇遇类型`, `| 类型 | 次数 |`, `|---|---:|`, rows(report.events),
  ].join("\n");
}

function parseArgs(argv) {
  const values = { runs: DEFAULT_RUNS, seed: DEFAULT_SEED };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--runs") values.runs = Number(argv[++index]);
    else if (argv[index] === "--seed") values.seed = Number(argv[++index]);
    else if (argv[index] === "--help") return null;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return values;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args) console.log("Usage: npm run simulate -- [--runs 100] [--seed 20261024]");
    else console.log(formatSimulationReport(simulateCampaigns(args)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

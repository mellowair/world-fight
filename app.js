import { ANIMATION_TIMING, CHARACTER_DATA, COMBAT_RULES, STARTING_CHARACTERS } from "./characters.js";
import { advanceEventEpilogue, advanceStageTransition, beginJourney, beginStageTwo, chooseRoute, chooseStartingSkill, claimCampaignReward, claimCampaignSpecialReward, claimCampaignTreasure, claimStageTwoEliteSkill, claimStageTwoEliteSkip, claimStageTwoGiantRecipient, claimStageTwoStatReward, completeLocation, completeSettlement, createCampaign, finishBattle, getActiveCampfireOptions, getCampaignRewardOffer, getCampaignTreasureOffer, getRouteMap, getRouteOptions, getStageTransitionChoices, getStageTwoCampfireOptions, prepareBattle, resolveCampaignEvent, resolveStageTwoCampfire, selectStartingCharacter, startCampaign, startCampaignEventBattle, STAGE_TWO_STAT_UPGRADES } from "./campaign.js";
import { getCritChance, getDodgeChance, getSkillDodgeChance, initializeBattle, simulateBattle } from "./battle.js";
import { getSeaBeyondOfferDetails, getSkillAtLevel, getSkillTrainingChoices, getTemporaryCombatModifiers, getTemporaryEffectDisplayRows, getTreasureCombatModifiers, getUnlearnedActiveSkills } from "./progression.js";
import { ATTRIBUTE_UPGRADES, ELITE_BONUS_REWARDS, GIANT_SPINAL_FLUID, SKILL_DATA, TREASURE_DATA } from "./skills.js";
import { orderRouteOptionsByPosition, shortestRemainingRouteLength, ROUTE_MAP_FINAL_STEP } from "./routeMap.js";
import { getAnimationFrameFootShift, getAnimationFrameVisualScale, getAnimationVisualOffset, getBorosBeamGeometry, getCharacterVisual } from "./visualConfig.js";
import { createMusicController, musicTracks } from "./music.js";
import { createEntranceCompletion, ENEMY_ENTRANCE_DURATION_MS, getEnemyEntrance } from "./enemyEntrance.js";

const $ = (selector) => document.querySelector(selector);
const log = $("#battle-log");
const logPanel = $(".log-panel");
const logToggle = $("#battle-log-toggle");
const statusLabel = $("#battle-status");
const speedButton = $("#speed-btn");
const restartRunButton = $("#restart-run-btn");
const characterDialog = $("#character-dialog");
let campaign = null;
let lastPreparedBattle = null;
let restoredBattle = null;
// The local-only test page uses the same game UI and rules with a separate save.
// A public Pages hostname cannot enable this branch through a query string.
const localStageTwoTest = (() => {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname) &&
      new URLSearchParams(window.location.search).get("stage2-dev") === "1" &&
      window.sessionStorage.getItem("shanshuo-stage2-dev-session") === "1";
  } catch { return false; }
})();
const RUN_SAVE_KEY = localStageTwoTest ? "shanshuo-stage2-dev-run-v1" : "shanshuo-stage2-run-v1";
const SAVE_OWNER_KEY = `${RUN_SAVE_KEY}:owner`;
const saveOwnerId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
let viewState = initializeBattle([]);
let squadSide = "ally";
let playback = null;
let timer = null;
let effectTimer = null;
let generation = 0;
let fast = false;
let displayedEvents = 0;
let pendingResult = null;
let eventResultShown = false;
let playbackPaused = false;
let battleLogExpanded = false;
let pausedContinuation = null;
let selectedCandidateId = null;
let selectedDecisionId = null;
let decisionHandler = null;
let decisionBusy = false;
let decisionRevision = 0;
let introTimer = null;
let entryTimer = null;
let entryAnimationToken = 0;
let attackTimer = null;
let animationStageTimer = null;
let birdProjectileTimer = null;
const borosVisualTimers = new Set();
let lastBorosVisualCastId = null;
let lastGilgameshVisualCastId = null;
const spriteFrameTimers = new Map();
const spriteFrameLayers = new WeakMap();
let targetHitTimer = null;
let entranceTimer = null;
let entrancePreloadTimer = null;
let entranceImages = [];
let entranceOverlay = null;
let entranceCompletion = null;
let battleStartPhase = "idle";
let battleStartedToken = -1;
let openingSeenThisPage = false;
let detailCharacterId = null;
let selectedStatusId = null;
let battleStatusState = { jinchuriki: null, c0: null, borosPhase: null, bombs: [], armoredShield: null, currentRound: 0 };
let selectedDecisionIds = [];
let decisionSelection = { multiple: false, required: 1 };
const OPENING_SESSION_KEY = "pixel-battle-opening-seen";

function decisionChoice(id, title, description, disabled = false, image = null) {
  return { id, title, description, disabled, image };
}

function renderDecisionScreen(title, description, choices, confirmText, onConfirm, kicker = "ACT 01 · GROWTH", image = null, selection = {}) {
  decisionRevision += 1;
  decisionBusy = false;
  selectedDecisionId = null;
  selectedDecisionIds = [];
  decisionSelection = { multiple: Boolean(selection.multiple), required: Math.max(1, Math.floor(selection.required ?? 1)), autoConfirm: Boolean(selection.autoConfirm) };
  $("#decision-screen").classList.toggle("is-dark-epilogue", Boolean(selection.darkScene));
  decisionHandler = onConfirm;
  $("#decision-kicker").textContent = kicker;
  $("#decision-title").textContent = title;
  $("#decision-copy").textContent = description;
  const eventImage = $("#decision-event-image");
  eventImage.hidden = !image;
  eventImage.src = image ?? "";
  eventImage.alt = image ? title : "";
  $("#decision-step").textContent = campaign?.status === "reward" ? `第 ${campaign.step} 步结算` : `第 ${campaign?.step || 0} 步`;
  const list = $("#decision-options");
  list.classList.toggle("reward-portrait-cards", Boolean(selection.portraitCards));
  list.replaceChildren();
  const revision = decisionRevision;
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "decision-choice";
    button.dataset.choiceId = choice.id;
    button.disabled = Boolean(choice.disabled);
    button.setAttribute("aria-pressed", "false");
    const name = document.createElement("b");
    name.textContent = choice.title;
    const detail = document.createElement("span");
    detail.textContent = choice.description ?? "";
    if (choice.image) {
      const icon = document.createElement("img");
      icon.className = "decision-choice-image";
      icon.src = choice.image;
      icon.alt = "";
      button.append(icon);
    }
    button.append(name, detail);
    button.addEventListener("click", () => {
      if (decisionBusy || revision !== decisionRevision || button.disabled) return;
      if (decisionSelection.multiple) {
        selectedDecisionIds = selectedDecisionIds.includes(choice.id)
          ? selectedDecisionIds.filter((id) => id !== choice.id)
          : [...selectedDecisionIds, choice.id];
        list.querySelectorAll(".decision-choice").forEach((candidate) => {
          const selected = selectedDecisionIds.includes(candidate.dataset.choiceId);
          candidate.classList.toggle("selected", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        $("#decision-confirm").disabled = selectedDecisionIds.length !== decisionSelection.required;
        if (decisionSelection.autoConfirm && selectedDecisionIds.length === decisionSelection.required) confirmDecision();
        return;
      }
      selectedDecisionId = choice.id;
      list.querySelectorAll(".decision-choice").forEach((candidate) => {
        candidate.classList.toggle("selected", candidate === button);
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      $("#decision-confirm").disabled = false;
      if (decisionSelection.autoConfirm) confirmDecision();
    });
    list.append(button);
  }
  const confirm = $("#decision-confirm");
  confirm.textContent = confirmText;
  confirm.disabled = true;
  confirm.hidden = decisionSelection.autoConfirm;
  setScreen("decision-screen");
}

function confirmDecision() {
  const hasSelection = decisionSelection.multiple
    ? selectedDecisionIds.length === decisionSelection.required
    : selectedDecisionId !== null;
  if (decisionBusy || !hasSelection || typeof decisionHandler !== "function") return;
  decisionBusy = true;
  const revision = decisionRevision;
  const choiceId = decisionSelection.multiple ? [...selectedDecisionIds] : selectedDecisionId;
  let ok;
  try {
    ok = decisionHandler(choiceId);
  } catch (error) {
    console.error("选项结算失败", error);
    decisionBusy = false;
    $("#decision-confirm").disabled = false;
    $("#decision-copy").textContent = `${$("#decision-copy").textContent} 操作未完成，请重试。`;
    return;
  }
  if (ok === false && revision === decisionRevision) {
    decisionBusy = false;
    $("#decision-confirm").disabled = false;
  } else if (revision === decisionRevision) {
    decisionBusy = false;
    decisionHandler = null;
  }
}

function displaySkillEffect(skill, context = {}) {
  const chance = Number.isFinite(skill?.chance) ? `触发率 ${Math.round(skill.chance * 100)}%` : "自动生效";
  if (skill?.id === "kaneki-predator") return `${chance} · (ATK + SPD) × ${skill.multiplier ?? 1} · 目标 HP 严格低于 ${Math.round(skill.guaranteedCritBelowHpRatio * 100)}% 时命中必定暴击`;
  if (skill?.id === "kaneki-1000-7") return `每受到 ${skill.hitsPerTrigger} 次有效伤害：本场暴击率 +${Math.round(skill.critRateBonus * 100)} 个百分点、ATK +${skill.attackBonus ?? 0}${skill.dodgeRateBonus ? `、闪避率 +${Math.round(skill.dodgeRateBonus * 100)} 个百分点` : ""}；可累加`;
  if (skill?.id === "eren-free-will") return `${chance} · 普通攻击 · DEF +${skill.defenseBonus ?? 0}（持续本场战斗，可累积） · 每触发 ${skill.healEveryTriggers} 次恢复最大 HP 的 ${Math.round(skill.healMaxHpFraction * 100)}%`;
  if (skill?.id === "eren-tatakae") return `${chance} · 攻击力按 ATK + 当前 DEF 计算 · ${skill.multiplier ?? 1}×伤害 · 下一次受到伤害翻倍`;
  if (skill?.id === "eren-2000-years") return "每场战斗首次受到攻击时免疫该次伤害。";
  if (skill?.effectType === "buff") return `${chance} · 防御 +${skill.defenseBonus ?? 0}，持续 ${skill.durationTurns ?? 1} 回合`;
  if (skill?.id === "shadow-clone-rush") return `影分身 ${skill.cloneCount ?? skill.level ?? 1} 个 · 伤害倍率 ${skill.multiplier ?? 1}× · ${chance}`;
  if (skill?.id === "rasengan" || skill?.multiplierFormula) {
    const formula = skill.multiplierFormula;
    if (formula) {
      const spd = Number.isFinite(context.spd) ? context.spd : (Number.isFinite(skill.currentSpeed) ? skill.currentSpeed : null);
      const multiplier = spd === null ? null : formula.base + spd * formula.coefficient;
      const coefficient = Number(formula.coefficient).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      return `伤害倍率：1 + SPD × ${coefficient}${multiplier === null ? "" : ` · 当前 SPD ${spd} → ${multiplier.toFixed(2)}×`} · ${chance} · 施放击杀敌人，本局 SPD +5`;
    }
  }
  return `${chance} · 伤害倍率 ${skill?.multiplier ?? 1}×`;
}

function displayUpgrade(upgradeId) {
  const upgrade = ATTRIBUTE_UPGRADES.find((item) => item.id === upgradeId);
  return upgrade ? `${upgrade.name}：${upgrade.description}` : upgradeId;
}

function describeEventResult(result) {
  result = result?.result ?? result;
  if (!result) return "事件已完成。";
  if (result.escape === "success") return `逃跑成功！本局速度 -10，当前 SPD ${result.currentSpd}。`;
  if (result.escape === "failed") return "逃跑失败！戴娜挡住了去路。确认后开始战斗。";
  if (result.treasure) return `获得「${result.treasure}」，由${STARTING_CHARACTERS.find((entry) => entry.id === result.recipientId)?.name ?? "指定队员"}领取；效果持续至本局结束。`;
  if (Number.isFinite(result.spdGain)) return `${STARTING_CHARACTERS.find((entry) => entry.id === result.recipientId)?.name ?? "角色"}本局速度 +${result.spdGain}。`;
  if (Number.isFinite(result.maxHpGain)) return `最大生命值 +${result.maxHpGain}，当前生命值保持不变。`;
  if (result.gains?.length && !Number.isFinite(result.hpLoss)) return `本局额外获得：${result.gains.map(({ stat, amount }) => `${({ atk: "攻击", def: "防御", spd: "速度" })[stat]} +${amount}`).join("、")}，本次未扣除生命值。`;
  if (result.blessing === "player_damage_increased") return "厄运降临：接下来两场战斗中，你受到的伤害为 1.5 倍。";
  if (result.blessing === "enemy_damage_doubled") return "力量降临：接下来两场战斗中，敌人受到的伤害翻倍。";
  if (result.effect?.stat || result.healFraction) return `${result.restored ? `立即恢复 ${result.restored} HP；` : ""}${result.effect?.stat ? `下一场战斗${result.effect.stat.toUpperCase()} ${result.effect.amount > 0 ? "+" : ""}${result.effect.amount}。` : ""}`;
  if (result.skipped) return result.exhausted ? "这条道路已无法再带来新力量，你选择离开。" : "你选择离开，没有发生其他变化。";
  if (result.stage && Number.isFinite(result.critRateGain)) {
    if (result.stage === 3) return `暴击率 +${Math.round(result.critRateGain * 100)} 个百分点，当前暴击率 ${(result.critRate * 100).toFixed(1)}%。`;
    const attackText = result.stage === 2 ? `；攻击 +${result.attackGain}，当前 ATK ${result.atk}` : "";
    return `最大生命上限降至 ${result.maxHp}，当前 HP ${result.currentHp}${attackText}。`;
  }
  if (Number.isFinite(result.hpLoss)) {
    const gains = result.gains?.map(gain => `${({atk:"攻击",def:"防御",spd:"速度"})[gain.stat]} +${gain.amount}`).join("、")
      ?? `${({atk:"攻击",def:"防御",spd:"速度"})[result.stat]} +${result.amount}`;
    const loss = Number.isFinite(result.hpLossPercent) ? `-${result.hpLossPercent}%（${result.hpLoss}）` : `-${result.hpLoss}`;
    return `最大生命上限 ${loss}；获得${gains}。当前 HP ${result.currentHp}/${result.maxHp}。`;
  }
  if (result.blessing === "player_damage_increased") return "厄运降临：接下来两场战斗中，你受到的伤害为 1.5 倍。";
  if (result.blessing === "enemy_damage_doubled") return "力量降临：接下来两场战斗中，敌人受到的伤害翻倍。";
  if (result.deferred) return "命运回档暂未启用，本次安全离开。";
  if (result.guaranteeArmed) return `下一场战斗中，${result.skillCount > 1 ? "随机一个已学习技能" : "已学习技能"}的触发率提升至 100%；该效果在战斗后清除。`;
  if (result.noEligibleSkills) return "当前没有已学习且可在战斗中触发的技能，奇遇正常结束，没有生成临时效果。";
  if (Number.isFinite(result.restored)) return `恢复 ${result.restored} 点生命，当前 ${result.currentHp}/${result.maxHp}。`;
  if (Number.isFinite(result.hpCost)) return `支付 ${result.hpCost} 点生命，获得${displayUpgrade(result.stat?.id)}；当前生命 ${result.currentHp}。`;
  if (result.stat) return `获得${displayUpgrade(result.stat.id)}。`;
  if (result.skill?.name) return `技能「${result.skill.name}」提升至 Lv.${result.skill.level}。`;
  if (result.name && result.level) return `学会技能「${result.name}」Lv.${result.level}。`;
  if (result.variant === "heal" || result.heal) return `恢复生命至 ${campaign.playerHp}/${campaign.playerMaxHp}。`;
  return "事件效果已生效。";
}

function applyAnimationTiming() {
  const root = document.documentElement;
  root.style.setProperty("--opening-reveal-duration", `${ANIMATION_TIMING.opening.cityRevealMs}ms`);
  root.style.setProperty("--opening-warning-blink-duration", `${ANIMATION_TIMING.opening.warningBlinkMs}ms`);
  root.style.setProperty("--opening-red-duration", `${ANIMATION_TIMING.opening.skyRedMs}ms`);
  root.style.setProperty("--entry-drop-duration", `${ANIMATION_TIMING.entryDropMs}ms`);
  root.style.setProperty("--entry-dust-delay", `${ANIMATION_TIMING.entryDustDelayMs}ms`);
  root.style.setProperty("--attack-event-gap", `${ANIMATION_TIMING.attack.eventGapMs}ms`);
}

function applySpriteFrame(node, character, animationName, frameName) {
  const animation = character?.animations?.[animationName];
  if (!node) return false;
  const frame = animation?.frames?.[frameName];
  if (animation?.type === "frames") {
    if (typeof frame !== "string") return false;
    let layers = spriteFrameLayers.get(node);
    if (!layers) {
      layers = new Map();
      spriteFrameLayers.set(node, layers);
    }
    let frameImage = layers.get(frame);
    if (!frameImage) {
      frameImage = document.createElement("img");
      frameImage.className = "sprite-action-frame";
      frameImage.alt = "";
      frameImage.draggable = false;
      frameImage.src = frame;
      node.append(frameImage);
      layers.set(frame, frameImage);
    }
    frameImage.dataset.frameName = frameName;
    node.dataset.requestedFrame = frame;
    const reveal = () => {
      if (node.dataset.requestedFrame !== frame || !frameImage.isConnected) return;
      for (const layer of layers.values()) layer.classList.toggle("is-current", layer === frameImage);
      node.dataset.framePending = "false";
      node.classList.add("active");
      node.closest(".fighter")?.classList.add("has-action-sprite");
    };
    if (frameImage.complete && frameImage.naturalWidth > 0) reveal();
    else if (!frameImage.complete) node.dataset.framePending = "true";
    else node.dataset.framePending = "false";
    if ((!frameImage.complete || frameImage.naturalWidth === 0) && !frameImage.dataset.frameHandlers) {
      frameImage.dataset.frameHandlers = "1";
      frameImage.addEventListener("load", reveal);
      frameImage.addEventListener("error", () => {
        frameImage.remove(); layers.delete(frame);
        const hasLoadedFrame = [...layers.values()].some(image => image.complete && image.naturalWidth > 0 && image.classList.contains("is-current"));
        if (!hasLoadedFrame) { node.dataset.framePending = "false"; node.classList.remove("active"); node.closest(".fighter")?.classList.remove("has-action-sprite"); }
      }, { once: true });
    }
    if (!frameImage.complete || frameImage.naturalWidth === 0) return true;
    return true;
  }
  if (animation?.type !== "spritesheet") return false;
  if (!Number.isInteger(frame)) return false;
  const columns = animation.columns ?? 1;
  const rows = animation.rows ?? 1;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const x = columns > 1 ? (column / (columns - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  node.style.backgroundImage = `url("${animation.asset}")`;
  node.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
  node.style.backgroundPosition = `${x}% ${y}%`;
  node.classList.add("active");
  return true;
}

function showFighterFrame(fighter, character, animationName, frameName) {
  const node = fighter?.querySelector(".sprite-action");
  if (!applySpriteFrame(node, character, animationName, frameName)) return false;
  const offset = getAnimationVisualOffset(character, animationName);
  const visualLayer = fighter.querySelector(".sprite-visual");
  visualLayer?.style.setProperty("--visual-action-offset-x", `${offset.offsetX ?? 0}px`);
  visualLayer?.style.setProperty("--visual-action-offset-y", `${offset.offsetY ?? 0}px`);
  node.style.setProperty("--action-frame-scale", getAnimationFrameVisualScale(character, animationName, frameName));
  node.style.setProperty("--action-frame-foot-shift", `${fighter.closest(".battle-screen.stage-two") ? getAnimationFrameFootShift(character, animationName, frameName) : 0}px`);
  const hasLoadedCurrent = [...(spriteFrameLayers.get(node)?.values() ?? [])].some(image => image.complete && image.naturalWidth > 0 && image.classList.contains("is-current"));
  if (hasLoadedCurrent || node?.dataset.framePending !== "true") fighter.classList.add("has-action-sprite");
  return true;
}

function applyFighterVisual(fighter, character) {
  const visual = getCharacterVisual(character);
  let layer = fighter.querySelector(".sprite-visual");
  if (!layer) {
    const sprite = fighter.querySelector(".sprite");
    const action = fighter.querySelector(".sprite-action");
    if (!sprite || !action) return;
    layer = document.createElement("span");
    layer.className = "sprite-visual";
    sprite.before(layer);
    layer.append(sprite, action);
  }
  layer.style.setProperty("--visual-scale", visual.scale);
  layer.style.setProperty("--visual-offset-x", `${visual.offsetX}px`);
  layer.style.setProperty("--visual-offset-y", `${visual.offsetY}px`);
  layer.style.setProperty("--visual-stage-foot-offset-y", `${fighter.closest(".battle-screen.stage-two") ? visual.stageTwoFootOffsetY ?? 0 : 0}px`);
  layer.style.setProperty("--visual-frame-width", `${visual.frameWidth}px`);
  layer.style.setProperty("--visual-frame-height", `${visual.frameHeight}px`);
  layer.style.setProperty("--visual-action-offset-x", "0px");
  layer.style.setProperty("--visual-action-offset-y", "0px");
}

function positionMeleeImpact(burst, attackerEl, targetEl) {
  const attackerSprite = attackerEl?.querySelector(".sprite-wrap");
  const targetSprite = targetEl?.querySelector(".sprite-wrap");
  if (!burst || !attackerSprite || !targetSprite) return false;
  const attackerRect = attackerSprite.getBoundingClientRect();
  const targetRect = targetSprite.getBoundingClientRect();
  const fromRight = attackerRect.left + attackerRect.width / 2 > targetRect.left + targetRect.width / 2;
  const contactX = fromRight
    ? targetRect.left + targetRect.width * 0.68
    : targetRect.left + targetRect.width * 0.32;
  const contactY = targetRect.top + targetRect.height * 0.62;
  burst.style.left = `${contactX - targetRect.left}px`;
  burst.style.top = `${contactY - targetRect.top}px`;
  return fromRight;
}

function launchDeidaraBirdProjectile(attackerEl, targetEl, durationMs) {
  const arena = document.querySelector(".arena");
  const attackerSprite = attackerEl?.querySelector(".sprite-wrap");
  const targetSprite = targetEl?.querySelector(".sprite-wrap");
  if (!arena || !attackerSprite || !targetSprite) return null;
  const arenaRect = arena.getBoundingClientRect();
  const attackerRect = attackerSprite.getBoundingClientRect();
  const targetRect = targetSprite.getBoundingClientRect();
  const bird = document.createElement("span");
  const width = 32;
  const height = 30;
  const left = attackerRect.left - arenaRect.left + 3;
  const top = attackerRect.top - arenaRect.top + 37;
  const targetX = targetRect.left - arenaRect.left + targetRect.width * 0.68;
  const targetY = targetRect.top - arenaRect.top + targetRect.height * 0.56;
  bird.className = "deidara-bird-projectile";
  bird.setAttribute("aria-hidden", "true");
  bird.style.left = `${left}px`;
  bird.style.top = `${top}px`;
  bird.style.setProperty("--bird-flight-x", `${targetX - left - width}px`);
  bird.style.setProperty("--bird-flight-y", `${targetY - top - height / 2}px`);
  bird.style.setProperty("--bird-flight-duration", `${durationMs}ms`);
  bird.addEventListener("animationend", () => bird.remove(), { once: true });
  arena.append(bird);
  return bird;
}

function launchKiraStand(attackerEl, targetEl, attacker, durationMs) {
  const arena = $("#arena") ?? document.querySelector(".arena");
  const source = attackerEl.querySelector(".sprite-visual")?.getBoundingClientRect();
  const target = targetEl.querySelector(".sprite-visual")?.getBoundingClientRect();
  if (!arena || !source || !target) return null;
  const arenaRect = arena.getBoundingClientRect();
  const visual = getCharacterVisual(attacker);
  const width = visual.frameWidth * visual.scale;
  const height = visual.frameHeight * visual.scale;
  const startX = source.left + source.width * .2 - width / 2;
  const startY = source.bottom - height;
  // The substitute stops on the attacker's side of the target, never crossing it.
  const endX = target.right + width * .05;
  const endY = target.bottom - height;
  const stand = document.createElement("img");
  stand.className = "kira-stand";
  stand.src = attacker.animations.meleeAttack.frames.stand;
  stand.alt = "";
  stand.setAttribute("aria-hidden", "true");
  stand.style.left = `${startX - arenaRect.left}px`;
  stand.style.top = `${startY - arenaRect.top}px`;
  stand.style.width = `${width}px`;
  stand.style.height = `${height}px`;
  stand.style.setProperty("--kira-stand-x", `${endX - startX}px`);
  stand.style.setProperty("--kira-stand-y", `${endY - startY}px`);
  stand.style.setProperty("--kira-stand-duration", `${durationMs}ms`);
  arena.append(stand);
  return stand;
}

function startGilgameshVisual(fighter, actor, timeline) {
  const arena = document.querySelector(".arena");
  if (!arena) return;
  showFighterFrame(fighter, actor, "enuma", "raise");
  scheduleBorosVisual(() => {
    const image = fighter.querySelector('.sprite-action-frame.is-current');
    const box = image?.getBoundingClientRect() ?? fighter.getBoundingClientRect();
    const bounds = arena.getBoundingClientRect();
    const ratio = image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
    const artWidth = Math.min(box.width, box.height * ratio);
    const artHeight = artWidth / ratio;
    const left = box.left + (box.width - artWidth) / 2 + artWidth * timeline.beamOriginX - bounds.left;
    const top = box.bottom - artHeight * (1 - timeline.beamOriginY) - bounds.top;
    const beam = document.createElement("img");
    beam.className = "gilgamesh-visual gilgamesh-launch-beam";
    beam.src = timeline.effect;
    beam.alt = "";
    beam.style.left = `${left}px`;
    beam.style.top = `${top}px`;
    beam.style.width = `${Math.max(bounds.width * .75, 300) * timeline.beamScale}px`;
    beam.style.setProperty("--gil-angle", `${timeline.beamAngle}deg`);
    beam.style.setProperty("--gil-launch-ms", `${timeline.launchMs}ms`);
    arena.append(beam);
  }, timeline.chargeMs);
  scheduleBorosVisual(() => {
    arena.querySelector(".gilgamesh-launch-beam")?.remove();
    const allies = [...arena.querySelectorAll('.fighter[data-team="ally"]:not(.is-dead)')];
    const bounds = arena.getBoundingClientRect();
    const centers = allies.map((node) => { const box = node.getBoundingClientRect(); return box.left + box.width / 2; });
    const center = centers.length ? centers.reduce((sum, x) => sum + x, 0) / centers.length - bounds.left : bounds.width * .3;
    const beam = document.createElement("img");
    beam.className = "gilgamesh-visual gilgamesh-falling-beam";
    beam.src = timeline.effect;
    beam.alt = "";
    beam.style.left = `${center}px`;
    beam.style.width = `${Math.min(bounds.width * .8, 500) * timeline.fallScale}px`;
    beam.style.setProperty("--gil-fall-ms", `${timeline.fallMs}ms`);
    arena.append(beam);
  }, timeline.chargeMs + timeline.launchMs);
  scheduleBorosVisual(() => arena.querySelectorAll(".gilgamesh-visual").forEach((node) => node.remove()), timeline.totalMs);
}

function scheduleBorosVisual(callback, delay) {
  const token = generation;
  const timerId = window.setTimeout(() => {
    borosVisualTimers.delete(timerId);
    if (token === generation) callback();
  }, delay);
  borosVisualTimers.add(timerId);
}

function clearBorosVisuals(fighter = null) {
  document.querySelectorAll(".boros-skill-effect").forEach((effect) => effect.remove());
  for (const actor of fighter ? [fighter] : document.querySelectorAll(".fighter")) {
    actor.classList.remove("is-boros-flying", "is-boros-dashing", "is-boros-slamming", "is-boros-returning", "is-boros-charging");
    for (const property of ["--boros-lift", "--boros-dash-x", "--boros-takeoff-duration", "--boros-dash-duration", "--boros-slam-duration", "--boros-return-duration"]) actor.style.removeProperty(property);
  }
}

function startBorosSkillVisual(sourceEl, targetEl, attacker, animationName, timeline, scaled) {
  const arena = $("#arena") ?? document.querySelector(".arena");
  if (!arena) return;
  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  if (animationName === "meteor") {
    const visual = sourceEl.querySelector(".sprite-visual")?.getBoundingClientRect() ?? sourceRect;
    const lift = Math.max(65, Math.round(visual.height * .95));
    const direction = Math.sign(targetRect.left + targetRect.width / 2 - sourceRect.left - sourceRect.width / 2);
    const travel = Math.max(0, Math.abs(targetRect.left + targetRect.width / 2 - sourceRect.left - sourceRect.width / 2) - (sourceRect.width + targetRect.width) * .48);
    sourceEl.style.setProperty("--boros-lift", `${lift}px`);
    sourceEl.style.setProperty("--boros-dash-x", `${direction * travel}px`);
    sourceEl.style.setProperty("--boros-takeoff-duration", `${scaled(timeline.takeoffMs)}ms`);
    sourceEl.style.setProperty("--boros-dash-duration", `${scaled(timeline.dashMs)}ms`);
    sourceEl.style.setProperty("--boros-slam-duration", `${scaled(timeline.slamMs)}ms`);
    sourceEl.style.setProperty("--boros-return-duration", `${scaled(timeline.returnMs)}ms`);
    showFighterFrame(sourceEl, attacker, "meteor", "fly");
    sourceEl.classList.add("is-boros-flying");
    scheduleBorosVisual(() => {
      sourceEl.classList.remove("is-boros-flying");
      showFighterFrame(sourceEl, attacker, "meteor", "dash");
      sourceEl.classList.add("is-boros-dashing");
    }, scaled(timeline.takeoffMs));
    scheduleBorosVisual(() => {
      sourceEl.classList.remove("is-boros-dashing");
      sourceEl.classList.add("is-boros-slamming");
      const opponents = viewState.characters.filter((unit) => unit.team !== attacker.team && unit.alive);
      const opponentRects = opponents.map((unit) => document.querySelector(`[data-character="${unit.id}"] .sprite-visual`)?.getBoundingClientRect()).filter(Boolean);
      const targets = opponentRects.length ? opponentRects : [targetRect];
      const arenaRect = arena.getBoundingClientRect();
      const left = Math.min(...targets.map((rect) => rect.left));
      const right = Math.max(...targets.map((rect) => rect.right));
      const bottom = Math.max(...targets.map((rect) => rect.bottom));
      const width = Math.min(arenaRect.width * .78, Math.max(190, right - left + 95));
      const effect = document.createElement("img");
      effect.className = "boros-skill-effect boros-meteor-impact";
      effect.src = timeline.effect;
      effect.alt = "";
      effect.style.left = `${(left + right) / 2 - arenaRect.left}px`;
      effect.style.top = `${bottom - arenaRect.top}px`;
      effect.style.width = `${width}px`;
      effect.style.height = `${width * 1.18}px`;
      effect.style.setProperty("--meteor-drop", `${arenaRect.height + width * 1.18}px`);
      effect.style.setProperty("--meteor-fall-duration", `${scaled(timeline.impactMs - timeline.takeoffMs - timeline.dashMs)}ms`);
      arena.append(effect);
    }, scaled(timeline.takeoffMs + timeline.dashMs));
    scheduleBorosVisual(() => arena.querySelector(".boros-meteor-impact")?.remove(), scaled(timeline.impactMs + 160));
    scheduleBorosVisual(() => {
      sourceEl.classList.remove("is-boros-slamming");
      sourceEl.classList.add("is-boros-returning");
    }, scaled(timeline.takeoffMs + timeline.dashMs + timeline.slamMs));
  } else if (animationName === "cannon") {
    showFighterFrame(sourceEl, attacker, "cannon", "charge");
    sourceEl.classList.add("is-boros-charging");
    scheduleBorosVisual(() => {
      const chargeImage = sourceEl.querySelector(".sprite-action-frame.is-current");
      const chargeFrame = chargeImage?.getBoundingClientRect()
        ?? sourceEl.querySelector(".sprite-visual")?.getBoundingClientRect() ?? sourceRect;
      const aspect = chargeImage?.naturalWidth && chargeImage?.naturalHeight
        ? chargeImage.naturalWidth / chargeImage.naturalHeight : chargeFrame.width / chargeFrame.height;
      const artWidth = Math.min(chargeFrame.width, chargeFrame.height * aspect);
      const artHeight = artWidth / aspect;
      const headX = chargeFrame.left + (chargeFrame.width - artWidth) / 2 + artWidth * timeline.headAnchor.x;
      const headY = chargeFrame.bottom - artHeight * (1 - timeline.headAnchor.y);
      const allies = viewState.characters.filter((unit) => unit.team === "ally" && unit.alive);
      const alliedRects = allies.map((unit) => document.querySelector(`[data-character="${unit.id}"]`)?.getBoundingClientRect()).filter(Boolean);
      const aimX = alliedRects.length ? alliedRects.reduce((sum, rect) => sum + rect.left + rect.width / 2, 0) / alliedRects.length : targetRect.left + targetRect.width / 2;
      const arenaRect = arena.getBoundingClientRect();
      const beam = getBorosBeamGeometry(arenaRect.left, arenaRect.right, headX, aimX);
      const height = Math.max(72, Math.min(160, beam.width / 3));
      const effect = document.createElement("img");
      effect.className = "boros-skill-effect boros-cannon-beam";
      effect.src = timeline.effect;
      effect.alt = "";
      effect.style.left = `${beam.left}px`;
      effect.style.top = `${headY - arenaRect.top - height / 2}px`;
      effect.style.width = `${beam.width}px`;
      effect.style.height = `${height}px`;
      if (beam.flip) effect.style.transform = "scaleX(-1)";
      arena.append(effect);
    }, timeline.chargeMs);
  }
}

function stopSpriteFrameCycle(actor) {
  const timerId = spriteFrameTimers.get(actor);
  if (timerId) window.clearTimeout(timerId);
  spriteFrameTimers.delete(actor);
}

function clearAllSpriteFrameCycles() {
  for (const timerId of spriteFrameTimers.values()) window.clearTimeout(timerId);
  spriteFrameTimers.clear();
}

function clearSpriteFrame(actor) {
  if (!actor) return;
  stopSpriteFrameCycle(actor);
  actor.classList.remove("has-action-sprite");
  actor.querySelector(".sprite-visual")?.style.setProperty("--visual-action-offset-x", "0px");
  actor.querySelector(".sprite-visual")?.style.setProperty("--visual-action-offset-y", "0px");
  const frame = actor.querySelector(".sprite-action");
  if (!frame) return;
  frame.dataset.requestedFrame = "";
  frame.dataset.framePending = "false";
  frame.classList.remove("active");
  frame.style.removeProperty("background-image");
  frame.style.removeProperty("background-size");
  frame.style.removeProperty("background-position");
  frame.style.removeProperty("--action-frame-scale");
  frame.style.removeProperty("--action-frame-foot-shift");
}

function startFrameCycle(fighter, character, animationName, frameNames, frameDuration, loop = true, durationScale = 1, durationIndexes = null) {
  stopSpriteFrameCycle(fighter);
  const animation = character?.animations?.[animationName];
  const validFrames = frameNames.filter((name) => typeof animation?.frames?.[name] === "string");
  if (!validFrames.length) return false;
  let index = 0;
  showFighterFrame(fighter, character, animationName, validFrames[index]);
  if (validFrames.length === 1) return true;
  const scheduleNextFrame = () => {
    const authoredDuration = animation?.durationsMs?.[durationIndexes?.[index] ?? index];
    const duration = Number.isFinite(authoredDuration) ? authoredDuration : frameDuration;
    const timerId = window.setTimeout(() => {
      if (index >= validFrames.length - 1) {
        if (!loop) {
          spriteFrameTimers.delete(fighter);
          return;
        }
        index = 0;
      } else index += 1;
      showFighterFrame(fighter, character, animationName, validFrames[index]);
      scheduleNextFrame();
    }, Math.max(40, Math.round(duration / durationScale)));
    spriteFrameTimers.set(fighter, timerId);
  };
  scheduleNextFrame();
  return true;
}

function animationFrameNames(character, animationName, prefix = null) {
  const frames = Object.keys(character?.animations?.[animationName]?.frames ?? {});
  return prefix ? frames.filter((name) => name.startsWith(prefix)) : frames;
}

function startRunCycle(fighter, character, frameDuration, durationScale = 1) {
  const frames = animationFrameNames(character, "run");
  if (frames.length) startFrameCycle(fighter, character, "run", frames, frameDuration, true, durationScale);
}

function startIdleCycle(fighter, character) {
  if (!fighter || !character?.alive || character.currentHp <= 0) return;
  if (character.id === "armored-titan" && Number(fighter.dataset.armorPoseRound) === battleStatusState.currentRound && fighter.dataset.armorPoseRound) {
    showFighterFrame(fighter, character, "skill1", "hold");
    return;
  }
  if (character?.elitePassiveId === "mahito-domain" && character.visualDomainActive) {
    showFighterFrame(fighter, character, "domain", "domain");
    return;
  }
  const idleAnimation = character.phaseIdleAnimations?.[character.borosPhase ?? 1] ?? "idle";
  const frames = animationFrameNames(character, idleAnimation);
  if (!frames.length) return;
  if (character?.animations?.[idleAnimation]?.loop && frames.length > 1) {
    startFrameCycle(fighter, character, idleAnimation, frames, 360, true);
    return;
  }
  // Keep the authored idle pose stable for characters without authored idle loops.
  showFighterFrame(fighter, character, idleAnimation, frames[0]);
}

function hasOpeningPlayed() {
  if (openingSeenThisPage) return true;
  try { return sessionStorage.getItem(OPENING_SESSION_KEY) === "yes"; }
  catch { return false; }
}

function markOpeningPlayed() {
  openingSeenThisPage = true;
  try { sessionStorage.setItem(OPENING_SESSION_KEY, "yes"); }
  catch { /* The in-memory flag still prevents repeats until this page closes. */ }
}

function mountFighter(character) {
  let fighter = character.team === "ally"
    ? document.querySelector(`[data-character="${character.id}"]`)
    : document.querySelector(`[data-character="${character.id}"]`);
  if (!fighter && character.team === "ally") {
    const template = document.querySelector("#hero-fighter");
    const arena = document.querySelector(".arena");
    if (template && arena) {
      fighter = template.cloneNode(true);
      fighter.querySelectorAll(".sprite-action-frame").forEach((frame) => frame.remove());
      fighter.querySelector(".sprite-action")?.classList.remove("active");
      fighter.classList.remove("has-action-sprite");
      fighter.removeAttribute("id");
      fighter.dataset.character = character.id;
      fighter.classList.remove("fighter-naruto");
      fighter.classList.add("fighter-partner");
      arena.append(fighter);
    }
  }
  if (!fighter && character.team === "enemy") {
    const template = document.querySelector('[data-character="guard"]');
    const arena = document.querySelector(".arena");
    if (template && arena) {
      fighter = template.cloneNode(true);
      fighter.querySelectorAll(".sprite-action-frame").forEach((frame) => frame.remove());
      fighter.querySelector(".sprite-action")?.classList.remove("active");
      fighter.classList.remove("has-action-sprite");
      fighter.hidden = true;
      fighter.removeAttribute("id");
      fighter.dataset.character = character.id;
      fighter.classList.remove("fighter-guard");
      fighter.classList.add("fighter-elite");
      arena.append(fighter);
    }
  }
  if (!fighter) return null;
  fighter.dataset.character = character.id;
  fighter.dataset.team = character.team;
  fighter.dataset.row = character.row;
  if (character.appearanceId) fighter.dataset.appearance = character.appearanceId;
  else delete fighter.dataset.appearance;
  if (character.mimicSourceId) fighter.dataset.mimic = character.mimicSourceId;
  else delete fighter.dataset.mimic;
  fighter.hidden = false;
  fighter.classList.toggle("is-dead", !character.alive || character.currentHp <= 0);
  fighter.dataset.deathPose = character.deathPose || "default";
  fighter.classList.toggle("is-deidara", character.name === "迪达拉");
  fighter.classList.toggle("has-authored-hit", Boolean(character.animations?.hit?.frames));
  fighter.classList.toggle("is-elite", character.type === "elite");
  applyFighterVisual(fighter, character);
  delete character.visualDomainActive;
  fighter.classList.remove("is-elite-escape", "has-escaped", "is-domain-active");
  fighter.querySelector(".fighter-name").textContent = character.name;
  fighter.querySelector(".sprite").src = character.asset;
  fighter.querySelector(".sprite").alt = `像素${character.name}`;
  clearSpriteFrame(fighter);
  return fighter;
}

function layoutBattleFormation(characters) {
  for (const team of ["ally", "enemy"]) {
    for (const row of ["front", "back"]) {
      const group = characters.filter((character) => character.team === team && character.row === row);
      group.forEach((character, index) => {
        const fighter = document.querySelector(`[data-character="${character.id}"]`);
        if (fighter) fighter.style.setProperty("--formation-offset", `${(index - (group.length - 1) / 2) * 8}%`);
      });
    }
  }
}

function buildHealthRows(characters) {
  const allies = characters.filter((c) => c.team === "ally");
  const enemies = characters.filter((c) => c.team === "enemy");
  const render = (chars) => chars.map((c) => `<div class="health-row" data-health="${c.id}">
    <span class="health-name">${c.name}</span>
    <span class="health-track"><i class="health-fill ${c.team === "ally" ? "ally-fill" : "enemy-fill"}"></i></span>
    <span class="health-value"><b class="current-hp">${c.currentHp ?? c.hp}</b><small>/${c.maxHp ?? c.hp}</small></span>
  </div>`).join("");
  $("#health-bars").innerHTML = render(allies);
  $("#enemy-health-bars").innerHTML = render(enemies);
  for (const character of characters) mountFighter(character);
  layoutBattleFormation(characters);
  document.querySelectorAll(".fighter[data-character]").forEach((fighter) => {
    fighter.hidden = !characters.some((character) => character.id === fighter.dataset.character);
  });
  // Initialize both the numeric label and bar width from persistent HP before playback starts.
  characters.forEach(updateHealth);
}

function updateHealth(character) {
  const row = document.querySelector(`[data-health="${character.id}"]`);
  if (!row) return;
  row.querySelector(".current-hp").textContent = character.currentHp;
  row.querySelector(".health-fill").style.width = `${(character.currentHp / character.maxHp) * 100}%`;
  let shieldChip = row.querySelector(".shield-chip");
  if ((character.shieldHp ?? 0) > 0) {
    if (!shieldChip) { shieldChip = document.createElement("span"); shieldChip.className = "shield-chip"; row.append(shieldChip); }
    shieldChip.textContent = `护盾 ${character.shieldHp}`;
  } else shieldChip?.remove();
  let weaknessChip = row.querySelector(".weakness-chip");
  if (character.alive && Number.isInteger(character.weaknessRound) && battleStatusState.currentRound <= character.weaknessRound) {
    if (!weaknessChip) { weaknessChip = document.createElement("span"); weaknessChip.className = "weakness-chip"; row.append(weaknessChip); }
    weaknessChip.textContent = `虚弱 · R${character.weaknessRound} 伤害 -50%`;
  } else weaknessChip?.remove();
  row.classList.toggle("is-dead", !character.alive);
  const fighter = document.querySelector(`[data-character="${character.id}"]`);
  fighter?.classList.toggle("is-dead", !character.alive);
  if (squadSide === "enemy") renderSquad();
}

function renderAllyStatusIcons() {
  const allyContainer = $("#ally-status-icons");
  const allyDetail = $("#ally-status-detail");
  const enemyContainer = $("#enemy-status-icons");
  const enemyDetail = $("#enemy-status-detail");
  if (!allyContainer || !allyDetail || !enemyContainer || !enemyDetail) return;

  const allyStatuses = [];
  const enemyStatuses = [];
  const temporaryEffects = campaign?.runCharacterState ? getTemporaryEffectDisplayRows(campaign.runCharacterState) : [];
  for (const effect of temporaryEffects) {
    const isCafe = ["coffee_shop", "coffee_help", "anteiku_2"].includes(effect.id);
    const isDeathNote = effect.id === "death_note";
    allyStatuses.push({
      id: effect.id ?? effect.name,
      name: isDeathNote ? "死亡笔记" : isCafe ? "安定区" : "路遇巨石",
      image: isDeathNote ? "assets/events/event_death_note.png" : isCafe ? "assets/events/event_coffee_shop.png" : "assets/events/event_big_rock.png",
      tone: effect.polarity,
      description: `${effect.statName} ${effect.amountText} · ${effect.durationText}`,
    });
  }
  if (campaign?.runCharacterState?.permanentEffects?.some((effect) => effect.id === GIANT_SPINAL_FLUID.id)) {
    allyStatuses.push({ id: GIANT_SPINAL_FLUID.id, name: GIANT_SPINAL_FLUID.name,
      image: GIANT_SPINAL_FLUID.image, tone: "buff",
      description: `本局永久生效：ATK +${GIANT_SPINAL_FLUID.atk}、DEF +${GIANT_SPINAL_FLUID.def}、最大 HP +${GIANT_SPINAL_FLUID.maxHp}。` });
  }
  if (battleStatusState.jinchuriki) {
    const passive = battleStatusState.jinchuriki;
    allyStatuses.push({
      id: "jinchuriki", name: "人柱力", image: "assets/jinchuriki-status.svg", tone: "passive",
      description: `本场战斗已触发：ATK +25%（${passive.originalAtk} → ${passive.effectiveAtk}）。开战时 HP 低于最大 HP 的 50%。`,
    });
  }
  if (battleStatusState.c0) {
    const c0 = battleStatusState.c0;
    enemyStatuses.push({
      id: "c0-art", name: "C0 终极艺术", image: "assets/c0-art-status.svg", tone: "danger",
      description: c0.detonated
        ? `已引爆：造成 ${c0.accumulatedDamage} 点真实伤害（${c0.completedRounds} 个完整行动回合）。`
        : `迪达拉每完成一个双方行动回合积累 ${c0.damagePerRound} 点真实伤害；当前 ${c0.accumulatedDamage} 点（${c0.completedRounds} 回合），迪达拉被击败时引爆。`,
    });
  }
  if (battleStatusState.borosPhase) {
    enemyStatuses.push({ id: "boros-phase", name: "宇宙霸主", image: "assets/stage2-enemies/boros/stage1.png", tone: "danger",
      description: `波罗斯当前为阶段${["", "一 · 铠甲", "二 · 能量释放", "三 · 最终形态"][battleStatusState.borosPhase]}。` });
  }
  if (battleStatusState.armoredShield) {
    const shield = battleStatusState.armoredShield;
    enemyStatuses.push({ id: "armored-shield", name: "莱纳我坐了", image: "assets/stage2-enemies/armored-titan-placeholder.svg", tone: "buff",
      description: battleStatusState.currentRound < shield.startRound
        ? `第 ${shield.startRound} 回合开始，铠之巨人受到的普通伤害减少 50%。`
        : `铠之巨人受到的普通伤害减少 50%，持续至第 ${shield.untilRound} 回合结束。` });
  }
  for (const bomb of battleStatusState.bombs ?? []) {
    allyStatuses.push({ id: bomb.id, name: "杀手皇后炸弹", image: "assets/stage2-enemies/kira/idle.png", tone: "danger",
      description: `${bomb.targetName}身上已附着炸弹；剩余 ${Math.max(0, bomb.dueRound - battleStatusState.currentRound)} 个完整回合（第 ${bomb.dueRound} 回合引爆）。` });
  }

  const renderButtons = (container, statuses) => {
    container.replaceChildren(...statuses.map((status) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ally-status-icon is-${status.tone}${selectedStatusId === status.id ? " is-selected" : ""}`;
      button.dataset.statusId = status.id;
      button.setAttribute("aria-label", `${status.name}：${status.description}`);
      button.setAttribute("aria-expanded", String(selectedStatusId === status.id));
      const image = document.createElement("img");
      image.src = status.image;
      image.alt = "";
      image.draggable = false;
      button.append(image);
      return button;
    }));
    container.hidden = statuses.length === 0;
  };
  const renderDetail = (detail, selected) => {
    detail.hidden = !selected;
    if (!selected) { detail.replaceChildren(); return; }
    detail.replaceChildren();
    const title = document.createElement("b");
    title.textContent = selected.name;
    const copy = document.createElement("span");
    copy.textContent = selected.description;
    detail.append(title, copy);
  };

  renderButtons(allyContainer, allyStatuses);
  renderButtons(enemyContainer, enemyStatuses);
  const selected = [...allyStatuses, ...enemyStatuses].find((status) => status.id === selectedStatusId);
  if (!selected) selectedStatusId = null;
  renderDetail(allyDetail, selected && allyStatuses.includes(selected) ? selected : null);
  renderDetail(enemyDetail, selected && enemyStatuses.includes(selected) ? selected : null);
}
function openCharacterDetail(characterId) {
  const character = [...STARTING_CHARACTERS, ...CHARACTER_DATA].find((entry) => entry.id === characterId);
  if (!character) return;

  const run = campaign?.partyStates?.[characterId] ?? null;
  detailCharacterId = characterId;
  const stats = run ? { ...run, critChance: run.critRate } : { currentHp: character.currentHp ?? character.hp, maxHp: character.maxHp ?? character.hp, atk: character.atk, def: character.def, spd: character.spd, critChance: character.critChance };
  const temporaryModifiers = run ? getTemporaryCombatModifiers(run) : { def: 0, spd: 0 };
  const treasureModifiers = run ? getTreasureCombatModifiers(run) : { dodgeRateBonus: 0 };
  const effectiveStats = { ...stats, def: Math.max(0, stats.def + temporaryModifiers.def), spd: Math.max(0, stats.spd + temporaryModifiers.spd) };
  const battleUnit = campaign?.status === "combat" && campaign.partyIds.includes(characterId)
    ? viewState.characters.find((unit) => unit.id === characterId) : null;
  const probabilityStats = battleUnit ?? { ...effectiveStats, critChance: stats.critChance,
    critRateBonus: run?.passiveSkillId === "kaneki-one-eye" && run.passiveLevel >= 2 ? .10 : 0,
    dodgeRateBonus: treasureModifiers.dodgeRateBonus };
  const rowName = character.row === "front" ? "前排" : "后排";
  const learned = run ? run.learnedActiveSkills.map((id) => getSkillAtLevel(run, id)).filter(Boolean) : character.skill ? [character.skill] : [];
  const skillMarkup = learned.length
    ? learned.map((skill) => '<div class="detail-skill-row"><div class="detail-skill-icon">技</div><div class="detail-skill-copy"><b>' + skill.name + ' · Lv.' + skill.level + '</b><p>' + (SKILL_DATA[skill.id]?.description ?? displaySkillEffect(skill)) + ' ' + displaySkillEffect({ ...skill, currentSpeed: effectiveStats.spd }) + '</p></div></div>').join("")
    : '<div class="detail-skill-row"><div class="detail-skill-icon quiet">—</div><div class="detail-skill-copy"><b>尚未选择主动技能</b><p>完成开局技能选择后参与战斗。</p></div></div>';
  const unlearned = run ? getUnlearnedActiveSkills(run) : [];
  const lockedMarkup = unlearned.map((id) => '<div class="detail-skill-row locked-skill"><div class="detail-skill-icon quiet">技</div><div class="detail-skill-copy"><b>' + SKILL_DATA[id].name + ' · 未学习</b><p>' + SKILL_DATA[id].description + '</p></div></div>').join("");
  const passive = SKILL_DATA[run?.passiveSkillId ?? character.passiveSkillId];
  const passiveLevel = run?.passiveLevel ?? 1;
  const passiveDescription = passive?.id === "jinchuriki" && passiveLevel >= 2
    ? "当前 HP 严格低于最大 HP 的 50% 时首次攻击获得本场 ATK +30%；触发后本场吸血 5%。"
    : passive?.id === "eren-2000-years" && passiveLevel >= 2
      ? "每场战斗免疫前两次受到的攻击；升级时最大 HP 一次性 +100。"
      : passive?.id === "kaneki-one-eye" && passiveLevel >= 2
        ? "暴击按最终计算伤害恢复 40% HP，暴击率 +10 个百分点。"
        : passive?.description ?? "";
  const ownedTreasures = run?.permanentEffects?.filter((effect) => TREASURE_DATA[effect.id] || ["drip_coffee", "six_ear_true_form"].includes(effect.id)) ?? [];
  const treasureMarkup = ownedTreasures.length
    ? '<section class="detail-skill"><h3>本局宝物</h3>' + ownedTreasures.map((effect) =>
      '<div class="detail-skill-row"><div class="detail-skill-icon">宝</div><div class="detail-skill-copy"><b>' + effect.name + '</b><p>' + (TREASURE_DATA[effect.id]?.description ?? effect.description) + '</p></div></div>').join("") + '</section>'
    : '';
  $("#character-detail").innerHTML =
    '<div class="detail-profile"><div class="detail-portrait"><img src="' + character.asset +
    '" alt="' + character.name + '"></div><div class="detail-name"><h3>' + character.name +
    '</h3><p>' + character.role + ' · ' + rowName + '</p><span class="detail-team ' +
    character.team + '">' + (character.team === "ally" ? "己方角色" : "敌方角色") +
    '</span></div></div>' +
    '<div class="detail-stats" aria-label="角色属性">' +
    '<div class="stat-card"><span>生命 HP</span><b>' + stats.currentHp + ' / ' + stats.maxHp + '</b></div>' +
    '<div class="stat-card"><span>攻击 ATK</span><b>' + stats.atk + '</b></div>' +
    '<div class="stat-card"><span>防御 DEF</span><b>' + effectiveStats.def + (temporaryModifiers.def ? '<small>' + stats.def + (temporaryModifiers.def > 0 ? ' + ' : ' − ') + Math.abs(temporaryModifiers.def) + '</small>' : '') + '</b></div>' +
    '<div class="stat-card"><span>速度 SPD</span><b>' + effectiveStats.spd + (temporaryModifiers.spd ? '<small>' + stats.spd + (temporaryModifiers.spd > 0 ? ' + ' : ' − ') + Math.abs(temporaryModifiers.spd) + '</small>' : '') + '</b></div>' +
    '<div class="stat-card"><span>闪避率</span><b>' + (getDodgeChance(probabilityStats) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>技能闪避率</span><b>' + (getSkillDodgeChance(probabilityStats) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>暴击率</span><b>' + (getCritChance(probabilityStats) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>暴击倍率</span><b>' + (stats.critMultiplier ?? COMBAT_RULES.critMultiplier).toFixed(1) + '×</b></div></div>' +
    '<section class="detail-skill"><h3>主动技能</h3>' + skillMarkup + lockedMarkup +
    '<div class="detail-skill-row"><div class="detail-skill-icon quiet">被</div><div class="detail-skill-copy"><b>' + (passive?.name ?? "暂无被动技能") + ' · Lv.' + passiveLevel + '</b><p>' + passiveDescription + '</p></div></div></section>' + treasureMarkup;

  if (!characterDialog.open) {
    if (typeof characterDialog.showModal === "function") characterDialog.showModal();
    else characterDialog.setAttribute("open", "");
  }
}
function addLog(text, kind = "") {
  const item = document.createElement("li");
  item.className = `log-entry ${kind}`;
  item.innerHTML = text;
  log.append(item);
  log.scrollTop = log.scrollHeight;
  displayedEvents += 1;
  $("#log-count").textContent = playbackPaused ? `已暂停 · ${displayedEvents} 条记录` : `${displayedEvents} 条记录`;
}

function setStatus(text, state = "") {
  statusLabel.textContent = text;
  statusLabel.parentElement.classList.toggle("is-fighting", state === "fighting");
  statusLabel.parentElement.classList.toggle("is-finished", state === "finished");
}

function setScreen(id) {
  if (id !== "battle-screen" && entranceCompletion) cancelEnemyEntrance();
  document.querySelectorAll(".flow-screen").forEach((screen) => {
    screen.hidden = screen.id !== id;
  });
  updateBossProgress();
  window.scrollTo(0, 0);
}

function updateBossProgress() {
  const panel = $("#boss-distance");
  if (!panel) return;
  const visible = campaign?.stageId === 1 && ["event", "combat", "settlement"].includes(campaign.status);
  panel.hidden = !visible;
  if (!visible) return;
  const completed = campaign.history.length;
  const remaining = shortestRemainingRouteLength(campaign.routeMap);
  const progress = Math.max(0, Math.min(1, completed / Math.max(1, completed + remaining)));
  $("#boss-distance-fill").style.width = (progress * 100) + "%";
  const characterId = campaign.runCharacterState?.characterId ?? campaign.playerId;
  const character = STARTING_CHARACTERS.find((entry) => entry.id === characterId);
  const portrait = $("#boss-distance-player");
  if (character && portrait) {
    portrait.src = character.asset;
    portrait.alt = character.name;
    portrait.style.left = `clamp(10px, ${progress * 100}%, calc(100% - 10px))`;
  }
}

function setBattleControls(fighting) {
  speedButton.disabled = !fighting;
}

function updateBattleLogPanel() {
  logPanel.classList.toggle("is-expanded", battleLogExpanded);
  logToggle.setAttribute("aria-expanded", String(battleLogExpanded));
  logToggle.textContent = playbackPaused ? "继续战斗" : battleLogExpanded ? "收起记录" : "暂停并查看";
}

function pauseForBattleLog() {
  if (!playback || playbackPaused) return;
  playbackPaused = true;
  battleLogExpanded = true;
  setBattleControls(false);
  updateBattleLogPanel();
  $("#log-count").textContent = `已暂停 · ${displayedEvents} 条记录`;
}

function toggleBattleLog() {
  if (playbackPaused) {
    playbackPaused = false;
    battleLogExpanded = false;
    updateBattleLogPanel();
    setBattleControls(Boolean(playback && campaign?.status === "combat"));
    $("#log-count").textContent = `${displayedEvents} 条记录`;
    const continuation = pausedContinuation;
    pausedContinuation = null;
    if (continuation) continuation();
    else if (playback) playNext(generation);
    return;
  }
  if (playback) pauseForBattleLog();
  else {
    battleLogExpanded = !battleLogExpanded;
    updateBattleLogPanel();
  }
}

function clearEffects() {
  cancelEnemyEntrance();
  window.clearTimeout(timer);
  window.clearTimeout(effectTimer);
  window.clearTimeout(attackTimer);
  window.clearTimeout(animationStageTimer);
  window.clearTimeout(birdProjectileTimer);
  window.clearTimeout(targetHitTimer);
  for (const visualTimer of borosVisualTimers) window.clearTimeout(visualTimer);
  borosVisualTimers.clear();
  clearBorosVisuals();
  lastBorosVisualCastId = null;
  lastGilgameshVisualCastId = null;
  document.querySelectorAll(".colossal-battle-smoke, .gilgamesh-visual").forEach((node) => node.remove());
  clearAllSpriteFrameCycles();
  timer = null;
  effectTimer = null;
  attackTimer = null;
  animationStageTimer = null;
  birdProjectileTimer = null;
  targetHitTimer = null;
  document.querySelectorAll(".elite-domain-banner").forEach((banner) => banner.remove());
  document.querySelectorAll(".kira-stand").forEach((stand) => stand.remove());
  document.querySelectorAll(".fighter").forEach((fighter) => {
    delete fighter.dataset.armorPoseRound;
    fighter.classList.remove("is-attacking", "is-melee-rushing", "is-clone-melee-approaching", "is-clone-melee-returning", "is-melee-at-target", "is-melee-returning", "is-melee-running", "is-toji-approaching", "is-toji-at-target", "is-toji-returning", "is-skill-posing", "is-punching", "is-hit", "is-hit-stun", "is-hit-recoil", "is-casting", "is-dodging", "is-critical", "is-impact", "is-magic-attacking", "is-ranged-attacking", "is-elite-escape", "is-domain-active", "is-kaneki-normal-approach", "is-kaneki-normal-at-target", "is-kaneki-normal-return", "is-kaneki-predator-launch", "is-kaneki-predator-strike", "is-kaneki-predator-hold", "is-kaneki-predator-return", "is-kaneki-reactive", "is-steam-casting");
    fighter.querySelector(".impact-burst")?.classList.remove("play");
    fighter.querySelector(".impact-burst")?.classList.remove("melee-impact", "melee-from-right");
    fighter.querySelector(".impact-burst")?.style.removeProperty("left");
    fighter.querySelector(".impact-burst")?.style.removeProperty("top");
    fighter.style.removeProperty("--melee-x");
    fighter.classList.remove("is-boros-punch-approaching", "is-boros-punch-at-target", "is-boros-punch-returning");
    fighter.style.removeProperty("--boros-punch-x");
    fighter.style.removeProperty("--boros-punch-approach-duration");
    fighter.style.removeProperty("--boros-punch-return-duration");
    fighter.style.removeProperty("--kaneki-launch-x");
    fighter.style.removeProperty("--kaneki-nudge");
    fighter.style.removeProperty("--kaneki-launch-duration");
    fighter.style.removeProperty("--kaneki-approach-duration");
    fighter.style.removeProperty("--kaneki-hold-duration");
    fighter.style.removeProperty("--kaneki-return-duration");
    fighter.style.removeProperty("--kaneki-normal-duration");
    fighter.style.removeProperty("--kaneki-normal-approach-duration");
    fighter.style.removeProperty("--kaneki-normal-return-duration");
    fighter.style.removeProperty("--attack-duration");
    fighter.style.removeProperty("--approach-duration");
    fighter.style.removeProperty("--return-duration");
    fighter.style.removeProperty("--impact-duration");
    fighter.style.removeProperty("--skill-duration");
    fighter.style.removeProperty("--elite-escape-duration");
    fighter.style.removeProperty("--hit-duration");
    fighter.style.removeProperty("--hit-shake-duration");
    fighter.style.removeProperty("--dodge-duration");
    fighter.style.removeProperty("--impact-fx-duration");
    fighter.style.removeProperty("--death-duration");
    fighter.style.removeProperty("--steam-duration");
    fighter.style.removeProperty("--formation-offset");
    clearSpriteFrame(fighter);
    const damage = fighter.querySelector(".damage-number");
    if (damage) {
      damage.textContent = "";
      damage.classList.remove("pop");
    }
  });
  document.querySelectorAll(".deidara-bird-projectile").forEach((projectile) => projectile.remove());
  document.querySelectorAll(".c0-explosion-overlay").forEach((overlay) => overlay.remove());
  $("#battle-stamp").className = "battle-stamp";
  $("#battle-stamp").textContent = "";
  battleStatusState = { jinchuriki: null, c0: null, borosPhase: null, bombs: [], armoredShield: null, currentRound: 0 };
  playbackPaused = false;
  battleLogExpanded = false;
  pausedContinuation = null;
  updateBattleLogPanel();
  selectedStatusId = null;
  renderAllyStatusIcons();
}

function playEvent(event, finish) {
  if (Number.isFinite(event.round) && event.round !== battleStatusState.currentRound) {
    battleStatusState.currentRound = event.round;
    const armor = document.querySelector('[data-character="armored-titan"]');
    if (armor?.dataset.armorPoseRound && Number(armor.dataset.armorPoseRound) < event.round) {
      delete armor.dataset.armorPoseRound;
      const actor = viewState.characters.find((unit) => unit.id === "armored-titan");
      if (actor?.alive) startIdleCycle(armor, actor);
    }
    if (battleStatusState.bombs.length || battleStatusState.armoredShield) renderAllyStatusIcons();
    viewState?.characters?.forEach((character) => { if (Number.isInteger(character.weaknessRound)) updateHealth(character); });
  }
  if (event.type === "giant-overrun") {
    addLog(`<b>${event.text}</b>`, "log-death");
    const stamp = $("#battle-stamp");
    stamp.textContent = event.text;
    stamp.className = "battle-stamp skill-stamp show";
    timer = window.setTimeout(() => { stamp.classList.remove("show"); timer = null; finish(); }, fast ? 600 : 1200);
    return;
  }
  if (event.type === "gilgamesh-heal") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    if (actor) { actor.currentHp = event.hpAfter; updateHealth(actor); }
    const fighter = actor && document.querySelector(`[data-character="${actor.id}"]`);
    const number = fighter?.querySelector(".damage-number");
    if (number && event.healedAmount > 0) {
      number.textContent = `+${event.healedAmount}`;
      number.classList.remove("pop"); number.classList.add("is-heal");
      void number.offsetWidth; number.classList.add("pop");
    }
    addLog(`<b>吉尔伽美什</b> 天地乖离第三式：恢复 ${event.healedAmount} HP。`, "log-enemy");
    timer = window.setTimeout(() => { timer = null; finish(); }, fast ? 260 : 440);
    return;
  }
  if (event.type === "steam-wave") {
    const giant = viewState.characters.find((character) => character.id === event.attackerId);
    const fighter = giant && document.querySelector(`[data-character="${giant.id}"]`);
    fighter?.style.setProperty("--steam-duration", `${fast ? 325 : 650}ms`);
    fighter?.classList.add("is-steam-casting");
    $("#battle-stamp").textContent = "蒸汽波！";
    $("#battle-stamp").className = "battle-stamp skill-stamp show";
    addLog(`<span class="round-label">R${event.round}</span> <b>超大型巨人</b> 释放 <span class="skill-name">蒸汽波</span>！`, "log-enemy");
    const completeWave = () => {
      for (const hit of event.hits) {
        const target = viewState.characters.find((character) => character.id === hit.targetId);
        if (!target) continue;
        target.currentHp = hit.hpAfter;
        target.alive = hit.hpAfter > 0;
        updateHealth(target);
        const targetEl = document.querySelector(`[data-character="${target.id}"]`);
        const number = targetEl?.querySelector(".damage-number");
        if (number) { number.textContent = `-${hit.actualDamage}`; number.classList.remove("pop"); void number.offsetWidth; number.classList.add("pop"); }
        if (hit.targetDied) {
          battleStatusState.bombs = battleStatusState.bombs.filter((bomb) => bomb.targetId !== target.id);
          if (target.id === "armored-titan") battleStatusState.armoredShield = null;
          targetEl?.classList.add("is-dead");
          const deathFrames = animationFrameNames(target, "death");
          if (targetEl && deathFrames.length) startFrameCycle(targetEl, target, "death", deathFrames, ANIMATION_TIMING.attack.deathMs / deathFrames.length, false);
        }
        addLog(`<b>${target.name}</b> 受到 ${hit.actualDamage} 点真实伤害${hit.targetDied ? "，倒下了" : ""}。`, hit.targetDied ? "log-death" : "log-enemy");
      }
      fighter?.classList.remove("is-steam-casting");
      fighter?.style.removeProperty("--steam-duration");
      $("#battle-stamp").classList.remove("show");
      renderAllyStatusIcons();
      finish();
    };
    timer = window.setTimeout(() => {
      timer = null;
      if (playbackPaused) pausedContinuation = completeWave;
      else completeWave();
    }, fast ? 325 : 650);
    return;
  }
  if (event.type === "armor-shield-expired") {
    battleStatusState.armoredShield = null;
    renderAllyStatusIcons();
    addLog("<b>铠之巨人</b> 的减伤状态结束。", "log-enemy");
    return finish();
  }
  if (event.type === "bites-dust") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    if (actor) { actor.currentHp = event.hpAfter; actor.alive = event.hpAfter > 0; updateHealth(actor); }
    for (const bomb of battleStatusState.bombs) bomb.dueRound -= 1;
    renderAllyStatusIcons();
    addLog(`<b>${actor?.name ?? "吉良吉影"}</b> 使用 <span class="skill-name">败者食尘</span>：HP ${event.hpBefore} → ${event.hpAfter}${event.fallback ? "（暂无两回合前快照，保持当前 HP）" : `（回溯至第 ${event.snapshotRound} 回合）`}；${event.bombsAdvanced} 枚炸弹提前一回合。`, "log-enemy");
    return finish();
  }
  if (event.type === "bomb-explode") {
    const target = viewState.characters.find((character) => character.id === event.targetId);
    if (target) {
      target.currentHp = event.hpAfter; target.alive = event.hpAfter > 0;
      updateHealth(target);
      const fighter = document.querySelector(`[data-character="${target.id}"]`);
      const number = fighter?.querySelector(".damage-number");
      if (number) { number.textContent = `-${event.actualDamage}`; number.classList.remove("pop"); void number.offsetWidth; number.classList.add("pop"); }
      if (event.targetDied && fighter) {
        clearSpriteFrame(fighter);
        fighter.classList.add("is-dead");
        const deathFrames = animationFrameNames(target, "death");
        if (deathFrames.length) startFrameCycle(fighter, target, "death", deathFrames, ANIMATION_TIMING.attack.deathMs / deathFrames.length, false);
      }
    }
    battleStatusState.bombs = battleStatusState.bombs.filter((bomb) => bomb.id !== event.bombId && (target?.alive || bomb.targetId !== event.targetId));
    renderAllyStatusIcons();
    addLog(`<b>杀手皇后</b> 炸弹 ${event.bombId} 引爆：累计 ${event.accumulatedDamage}，经当前 DEF 结算造成 ${event.actualDamage} 点伤害。`, "log-enemy");
    return finish();
  }
  if (event.type === "treasure-damage" || event.type === "jason-damage") {
    const target = viewState.characters.find((character) => character.id === event.targetId);
    const attacker = viewState.characters.find((character) => character.id === event.attackerId);
    if (target) {
      target.currentHp = event.hpAfter;
      target.alive = event.hpAfter > 0;
      target.shieldHp = event.targetShield;
      if (event.phaseChange) {
        target.borosPhase = event.phaseChange.phase;
        target.atk = event.phaseChange.atk;
        target.def = event.phaseChange.def;
        target.spd = event.phaseChange.spd;
        if (target.phaseAssets?.[target.borosPhase]) {
          target.asset = target.phaseAssets[target.borosPhase];
          document.querySelector(`[data-character="${target.id}"] .sprite`)?.setAttribute("src", target.asset);
        }
        battleStatusState.borosPhase = event.phaseChange.phase;
      }
      updateHealth(target);
      const fighter = document.querySelector(`[data-character="${target.id}"]`);
      const number = fighter?.querySelector(".damage-number");
      if (number && event.actualDamage > 0) {
        number.textContent = `-${event.actualDamage}`;
        number.classList.remove("is-heal", "pop");
        void number.offsetWidth;
        number.classList.add("pop");
      }
      if (event.targetDied && fighter) {
        window.clearTimeout(targetHitTimer);
        targetHitTimer = null;
        clearSpriteFrame(fighter);
        fighter.classList.remove("is-hit", "is-impact", "is-hit-stun", "is-hit-recoil");
        fighter.classList.add("is-dead");
        const frames = animationFrameNames(target, "death");
        if (frames.length) startFrameCycle(fighter, target, "death", frames, ANIMATION_TIMING.attack.deathMs / frames.length, false);
      }
      if (squadSide === "enemy") renderSquad();
      renderAllyStatusIcons();
    }
    addLog(event.type === "jason-damage"
      ? `<b>${attacker?.name ?? "铃屋什造"}</b> 的杰森！第 ${event.attackCount} 次普通攻击额外扣除 <b>${event.actualDamage}</b> HP${event.targetDied ? "，目标倒下" : ""}。`
      : `<b>${attacker?.name ?? "角色"}</b> 的日轮刀：以目标攻击前 ${event.basisHp} HP 计算，额外扣除 <b>${event.actualDamage}</b> HP（无视 DEF）${event.targetDied ? "，目标倒下" : ""}。`, "log-skill");
    timer = window.setTimeout(() => { timer = null; finish(); }, fast ? 140 : 280);
    return;
  }
  if (event.type === "boros-round-heal" || event.type === "boros-round-growth") {
    const boss = viewState.characters.find((character) => character.id === event.targetId);
    if (boss && event.type === "boros-round-heal") { boss.currentHp = event.hpAfter; updateHealth(boss); }
    if (boss && event.type === "boros-round-growth") boss.atk = event.effectiveAtk;
    if (squadSide === "enemy") renderSquad();
    addLog(event.type === "boros-round-heal"
      ? `<b>波罗斯</b> 阶段二每回合恢复 ${event.healedAmount} HP。`
      : `<b>波罗斯</b> 最终形态每回合 ATK +${event.attackBonus}（当前 ${event.effectiveAtk}）。`, "log-enemy");
    return finish();
  }
  if (event.type === "summon") {
    const summoned = { ...event.character };
    if (viewState.characters.some((character) => character.id === summoned.id)) return finish();
    viewState.characters.push(summoned);
    if (squadSide === "enemy") renderSquad();
    const row = document.createElement("div");
    row.className = "health-row";
    row.dataset.health = summoned.id;
    row.innerHTML = `<span class="health-name"></span><span class="health-track"><i class="health-fill enemy-fill"></i></span><span class="health-value"><b class="current-hp"></b><small></small></span>`;
    row.querySelector(".health-name").textContent = summoned.name;
    row.querySelector(".health-value small").textContent = `/${summoned.maxHp}`;
    $("#enemy-health-bars").append(row);
    const fighter = mountFighter(summoned);
    layoutBattleFormation(viewState.characters);
    updateHealth(summoned);
    const duration = fast ? 475 : 950;
    if (fighter) {
      fighter.style.setProperty("--summon-duration", `${duration}ms`);
      fighter.classList.add("is-summoning");
    }
    addLog(`<b>戴娜</b> 触发被动 <span class="skill-name">${event.passiveName}</span>：第 ${event.round} 回合召唤一名普通巨人。`, "log-enemy");
    const completeSummon = () => {
      if (fighter) {
        fighter.classList.remove("is-summoning");
        fighter.style.removeProperty("--summon-duration");
        startIdleCycle(fighter, summoned);
      }
      finish();
    };
    timer = window.setTimeout(() => {
      timer = null;
      if (playbackPaused) pausedContinuation = completeSummon;
      else completeSummon();
    }, duration);
    return;
  }
  if (event.type === "skill-guarantee") {
    addLog(`<b>命运石之门</b>：下一场战斗中技能 <span class="skill-name">${event.skillName}</span> 的触发率提升至 100%。`, "log-skill");
    return finish();
  }
  if (event.type === "elite-passive-trigger") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    const fighter = actor && document.querySelector(`[data-character="${actor.id}"]`);
    const banner = document.createElement("div");
    banner.className = "elite-domain-banner";
    banner.setAttribute("aria-hidden", "true");
    banner.textContent = "领域展开";
    document.querySelector(".arena")?.append(banner);
    if (fighter) {
      // Hold the authored first form briefly, then reveal the domain form.
      clearSpriteFrame(fighter);
      showFighterFrame(fighter, actor, "idle", "idle");
    }
    addLog(`<b>${actor?.name ?? "真人"}</b> 被动 <span class="skill-name">自闭圆顿裹</span>触发：领域展开！本回合 ATK +${event.attackBonus}（当前 ${event.effectiveAtk}）。`, "log-enemy");
    const domainDuration = fast ? ANIMATION_TIMING.elite.domainDurationMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.elite.domainDurationMs;
    const revealDelay = fast ? ANIMATION_TIMING.elite.domainRevealDelayMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.elite.domainRevealDelayMs;
    banner.style.setProperty("--domain-banner-duration", `${domainDuration}ms`);
    if (fighter) {
      animationStageTimer = window.setTimeout(() => {
        animationStageTimer = null;
        fighter.classList.add("is-domain-active");
        showFighterFrame(fighter, actor, "domain", "domain");
      }, revealDelay);
    }
    const completeDomain = () => {
      banner.remove();
      if (fighter) {
        fighter.classList.remove("is-domain-active");
        const domainAsset = actor.animations?.domain?.frames?.domain;
        if (domainAsset) {
          actor.visualDomainActive = true;
          actor.asset = domainAsset;
          const baseSprite = fighter.querySelector(".sprite");
          if (baseSprite) {
            baseSprite.src = domainAsset;
            baseSprite.alt = `像素${actor.name}领域形态`;
          }
          showFighterFrame(fighter, actor, "domain", "domain");
        }
      }
      finish();
    };
    timer = window.setTimeout(() => {
      timer = null;
      if (playbackPaused) pausedContinuation = completeDomain;
      else completeDomain();
    }, domainDuration);
    return;
  }
  if (event.type === "elite-passive-growth") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    if (actor) actor.atk = event.effectiveAtk;
    if (squadSide === "enemy") renderSquad();
    addLog(`<b>${actor?.name ?? "真人"}</b> 的自闭圆顿裹持续增强：本回合 ATK +${event.attackBonus}（当前 ${event.effectiveAtk}）。`, "log-enemy");
    return finish();
  }
  if (event.type === "elite-escape") {
    const target = viewState.characters.find((character) => character.id === event.targetId);
    const fighter = target && document.querySelector(`[data-character="${target.id}"]`);
    if (fighter && target) {
      startFrameCycle(fighter, target, "death", ["escape"], 0, false);
      fighter.style.setProperty("--elite-escape-duration", `${ANIMATION_TIMING.elite.bombEscapeDurationMs}ms`);
      fighter.classList.add("is-elite-escape");
    }
    addLog(`<b>${event.name}</b> 化作残影，从战场右侧逃离。`, "log-death");
    const finishEscape = () => {
      if (fighter) {
        fighter.classList.remove("is-elite-escape");
        fighter.classList.add("has-escaped");
        fighter.style.removeProperty("--elite-escape-duration");
      }
      finish();
    };
    timer = window.setTimeout(() => {
      timer = null;
      if (playbackPaused) pausedContinuation = finishEscape;
      else finishEscape();
    }, ANIMATION_TIMING.elite.bombEscapeDurationMs);
    return;
  }
  if (event.type === "c0-charge") {
    if (battleStatusState.c0) {
      battleStatusState.c0.completedRounds = event.completedRounds;
      battleStatusState.c0.accumulatedDamage = event.accumulatedDamage;
      renderAllyStatusIcons();
    }
    addLog(`<b>迪达拉</b> 的 C0 正在蓄积：已完成 ${event.completedRounds} 个完整行动回合，累计 ${event.accumulatedDamage} 点真实伤害。`, "log-enemy");
    return finish();
  }
  if (event.type === "c0-detonate") {
    if (battleStatusState.c0) {
      battleStatusState.c0.completedRounds = event.completedRounds;
      battleStatusState.c0.accumulatedDamage = event.damage;
      battleStatusState.c0.warning = true;
      renderAllyStatusIcons();
    }
    $("#battle-stamp").textContent = "迪达拉倒下了！C0 终极艺术即将引爆！";
    $("#battle-stamp").className = "battle-stamp skill-stamp c0-warning show";
    const deidara = viewState.characters.find((character) => character.name === "迪达拉");
    const deidaraEl = deidara && document.querySelector(`[data-character="${deidara.id}"]`);
    const c0Frames = animationFrameNames(deidara, "skill2");
    if (deidaraEl && c0Frames.length) {
      deidaraEl.classList.add("is-c0-detonating");
      const warningDuration = fast ? ANIMATION_TIMING.boss.c0WarningMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.boss.c0WarningMs;
      startFrameCycle(deidaraEl, deidara, "skill2", c0Frames, warningDuration / c0Frames.length, false);
    }
    addLog(`<b>迪达拉倒下了，但遗留的 C0 正在引爆！</b> 即将受到 ${event.damage} 点真实伤害，请留意最终结算。`, "log-enemy");
    const resolveDetonation = () => {
      if (battleStatusState.c0) {
        battleStatusState.c0.warning = false;
        battleStatusState.c0.detonated = true;
        renderAllyStatusIcons();
      }
      const explosion = document.createElement("div");
      explosion.className = "c0-explosion-overlay";
      explosion.setAttribute("aria-hidden", "true");
      ["skill2_3.png", "skill2_4.png"].forEach((frame, index) => {
        const image = document.createElement("img");
        image.className = `c0-explosion-frame ${index === 0 ? "frame-three" : "frame-four"}`;
        image.alt = "";
        image.src = `assets/deidara-v2/skill2/${frame}`;
        explosion.append(image);
      });
      const title = document.createElement("div");
      title.className = "c0-explosion-title";
      title.textContent = "C0 · 终极艺术";
      explosion.append(title);
      document.body.append(explosion);
      const completeExplosion = () => {
        explosion.remove();
        const target = viewState.characters.find((character) => character.id === event.targetId);
        if (target) {
          if (event.hpAfter <= 0) document.querySelector(`[data-character="${target.id}"]`)?.style.setProperty("--death-duration", `${ANIMATION_TIMING.boss.defeatFallMs}ms`);
          target.currentHp = event.hpAfter;
          target.alive = event.hpAfter > 0;
          updateHealth(target);
        }
        $("#battle-stamp").textContent = "C0 引爆！";
        $("#battle-stamp").className = "battle-stamp skill-stamp show";
        addLog(`<b>C0 终极艺术引爆！</b> 造成 ${event.damage} 点真实伤害（${event.completedRounds} 个完整回合），玩家 HP ${event.hpBefore} → ${event.hpAfter}。`, "log-death");
        finish();
      };
      timer = window.setTimeout(() => {
        timer = null;
        if (playbackPaused) pausedContinuation = completeExplosion;
        else completeExplosion();
      }, ANIMATION_TIMING.boss.c0ExplosionMs);
    };
    timer = window.setTimeout(() => {
      timer = null;
      if (playbackPaused) pausedContinuation = resolveDetonation;
      else resolveDetonation();
    }, fast ? ANIMATION_TIMING.boss.c0WarningMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.boss.c0WarningMs);
    return;
  }
  if (event.type === "battle-end") {
    document.querySelectorAll(".colossal-battle-smoke, .gilgamesh-visual").forEach((node) => node.remove());
    const win = event.outcome === "victory";
    const player = pendingResult.finalCharacters.find((character) => character.team === "ally");
    const speedBeforeSettlement = campaign.runCharacterState?.spd ?? 0;
    const transition = finishBattle(campaign, pendingResult.outcome, player.currentHp, pendingResult.events, pendingResult.finalCharacters);
    if (!transition) return finish();
    for (const recovery of campaign.lastBattleRecovery ?? []) {
      const unit = viewState.characters.find((character) => character.id === recovery.characterId && character.team === "ally");
      if (unit) {
        unit.currentHp = recovery.currentHp;
        unit.alive = recovery.currentHp > 0;
        updateHealth(unit);
        const fighter = document.querySelector(`[data-character="${unit.id}"]`);
        if (fighter && unit.alive) {
          fighter.classList.remove("is-dead");
          clearSpriteFrame(fighter);
          startIdleCycle(fighter, unit);
        }
      }
      if (recovery.restored > 0) addLog(`<b>${unit?.name ?? recovery.characterId}</b> ${recovery.kind === "revive" ? "战后重新站起" : "大天使的气息"}：HP +${recovery.restored}。`, "log-skill");
    }
    const rasenganSpeedGain = (campaign.runCharacterState?.spd ?? speedBeforeSettlement) - speedBeforeSettlement;
    if (rasenganSpeedGain > 0) addLog(`螺旋丸击杀 · <b>本局 SPD +${rasenganSpeedGain}</b>`, "log-skill");
    updateProgressionDisplays();
    setStatus(win ? "战斗胜利" : "战斗失败", "finished");
    setBattleControls(false);
    $("#battle-stamp").textContent = win ? "胜利！" : "战斗失败";
    $("#battle-stamp").classList.add("show", win ? "stamp-win" : "stamp-lose");
    addLog(win ? `第 ${campaign.battleNumber} 场 · <b>胜利</b>` : `第 ${campaign.battleNumber} 场 · <b>战败，本局结束</b>`, win ? "log-win" : "log-death");
    const normalHoldMs = fast ? ANIMATION_TIMING.attack.resultHoldMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.attack.resultHoldMs;
    const defeatHoldMs = fast ? ANIMATION_TIMING.boss.defeatHoldMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.boss.defeatHoldMs;
    if (!win) {
      const deidara = viewState.characters.find((character) => character.name === "迪达拉" && character.alive);
      const deidaraEl = deidara && document.querySelector(`[data-character="${deidara.id}"]`);
      const victoryFrames = animationFrameNames(deidara, "victory");
      if (deidaraEl && victoryFrames.length) startFrameCycle(deidaraEl, deidara, "victory", victoryFrames, defeatHoldMs / victoryFrames.length, false);
    }
    let transitionApplied = false;
    const applyBattleTransition = () => {
      if (transitionApplied || !transition || !["settlement", "reward"].includes(transition.status)) return;
      transitionApplied = true;
      playback = null;
      pendingResult = null;
      battleStartPhase = "idle";
      setBattleControls(false);
      if (transition.status === "reward") renderBattleReward();
      else {
        completeSettlement(campaign);
        if (campaign.status === "stage_transition") renderStageTransition();
        else renderEnding();
      }
    };
    timer = window.setTimeout(() => {
      timer = null;
      if (playbackPaused) pausedContinuation = applyBattleTransition;
      else applyBattleTransition();
    }, win ? normalHoldMs : defeatHoldMs);
    return;
  }
  if (event.type === "skill") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    if (event.effectType === "next-round-reduction") {
      battleStatusState.armoredShield = { startRound: event.effectiveFromRound, untilRound: event.effectiveUntilRound };
      const fighter = document.querySelector('[data-character="armored-titan"]');
      if (fighter) { fighter.dataset.armorPoseRound = String(event.round); showFighterFrame(fighter, actor, "skill1", "hold"); }
      renderAllyStatusIcons();
      addLog(`<b>${actor?.name ?? "铠之巨人"}</b> 释放 <span class="skill-name">${event.skillName}</span>：第 ${event.effectiveFromRound}–${event.effectiveUntilRound} 回合减伤 50%。`, "log-skill");
      timer = window.setTimeout(() => {
        timer = null;
        if (playbackPaused) pausedContinuation = finish;
        else finish();
      }, fast ? 320 : 640);
      return;
    }
    addLog(`<b>${actor?.name ?? "角色"}</b> 触发 <span class="skill-name">${event.skillName}</span>，防御提高 ${event.defenseBonus}。`, "log-skill");
    return finish();
  }
  if (event.type === "passive-trigger") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    if (event.skillId === "jinchuriki") {
      battleStatusState.jinchuriki = { originalAtk: event.originalAtk, effectiveAtk: event.effectiveAtk };
      renderAllyStatusIcons();
    }
    addLog(`<b>${actor?.name ?? "角色"}</b> 被动 <span class="skill-name">${event.skillName}</span> 生效：ATK ${event.originalAtk} → ${event.effectiveAtk}（+${Math.round((event.attackBonus ?? .25) * 100)}%）。`, "log-skill");
    return finish();
  }
  if (event.type !== "attack") return finish();
  if (event.type === "attack" && event.splash) {
    const splashTarget = viewState.characters.find((unit) => unit.id === event.targetId);
    if (splashTarget) {
      splashTarget.currentHp = event.targetHp;
      splashTarget.alive = event.targetHp > 0;
      updateHealth(splashTarget);
      const fighter = document.querySelector(`[data-character="${splashTarget.id}"]`);
      const number = fighter?.querySelector(".damage-number");
      if (number) { number.textContent = event.dodged ? "闪避" : `-${event.actualDamage}`; number.classList.remove("pop"); void number.offsetWidth; number.classList.add("pop"); }
      if (event.targetDied) fighter?.classList.add("is-dead");
      addLog(`<b>影分身</b> 扩散命中 ${splashTarget.name}${event.dodged ? "，被闪避" : `，造成 ${event.actualDamage} 点伤害`}。`, "log-skill");
    }
    timer = window.setTimeout(() => { timer = null; finish(); }, fast ? 120 : 220);
    return;
  }
  const attacker = viewState.characters.find((c) => c.id === event.attackerId);
  const target = viewState.characters.find((c) => c.id === event.targetId);
  if (!attacker || !target) return finish();
  const sourceEl = document.querySelector(`[data-character="${attacker.id}"]`);
  const targetEl = document.querySelector(`[data-character="${target.id}"]`);
  if (!sourceEl || !targetEl) return finish();
  const sourceSide = attacker.team === "ally" ? "ally" : "enemy";
  const cloneText = event.skillId === "shadow-clone-rush" ? ` Lv.${event.skillLevel}（${event.skillCloneCount} 个分身，${event.skillMultiplier.toFixed(1)}×）` : "";
  const actionText = event.skilled ? `<span class="skill-name">${event.skillName}${cloneText}</span>` : "普通攻击";
  const resultText = event.dodged ? '<span class="dodge-text">闪避</span>' : event.passiveTriggered?.damageImmune ? '<span class="dodge-text">被动免疫</span>' : `${event.critical ? '<b class="critical-text">暴击</b> ' : ""}<span class="damage-text">-${event.damage}</span>`;
  const timings = ANIMATION_TIMING.attack;
  const playbackMultiplier = fast ? timings.fastPlaybackMultiplier : 1;
  const scaled = (ms) => Math.max(40, Math.round(ms / playbackMultiplier));
  sourceEl.style.setProperty("--skill-duration", `${scaled(560)}ms`);
  targetEl.style.setProperty("--hit-duration", `${scaled(380)}ms`);
  targetEl.style.setProperty("--hit-shake-duration", `${scaled(110)}ms`);
  targetEl.style.setProperty("--dodge-duration", `${scaled(300)}ms`);
  targetEl.style.setProperty("--impact-fx-duration", `${scaled(event.attackType === "melee" ? 260 : 340)}ms`);
  if (event.skilled) {
    sourceEl.classList.add("is-casting");
    const stamp = $("#battle-stamp");
    stamp.textContent = event.skillName;
    stamp.className = "battle-stamp skill-stamp show";
    window.clearTimeout(effectTimer);
    effectTimer = window.setTimeout(() => {
      stamp.classList.remove("show");
      effectTimer = null;
    }, scaled(520));
  }

  const isBorosPunch = attacker.id === "boros" && attacker.borosPhase === 1 && !event.skilled;
  const isKiraPunch = attacker.id === "kira" && !event.skilled;
  const presentationId = attacker.mimicSourceId ?? attacker.id;
  const isDefaultFrontApproach = attacker.team === "enemy" && attacker.row === "front" && !event.skilled && !isBorosPunch && !isKiraPunch;
  const isMelee = (event.attackType === "melee" && !(attacker.team === "enemy" && attacker.row === "back")) || isDefaultFrontApproach;
  const actionTiming = isMelee ? timings.melee : event.attackType === "magic" ? timings.magic : timings.ranged;
  const skillAnimationName = event.skilled ? attacker.skillAnimationMap?.[event.skillId] : null;
  const skillAnimationFrames = skillAnimationName ? animationFrameNames(attacker, skillAnimationName) : [];
  const borosTimeline = attacker.id === "boros" ? attacker.skillVisualTimelines?.[skillAnimationName] : null;
  const gilTimeline = attacker.id === "gilgamesh" && event.gilgameshCast !== 3 ? attacker.skillVisualTimelines?.[skillAnimationName] : null;
  const firstGilVisual = !!gilTimeline && event.skillCastId !== lastGilgameshVisualCastId;
  if (firstGilVisual) lastGilgameshVisualCastId = event.skillCastId;
  const firstBorosVisual = !!borosTimeline && event.skillCastId !== lastBorosVisualCastId;
  if (firstBorosVisual) lastBorosVisualCastId = event.skillCastId;
  const authoredSkillDurations = attacker.animations?.[skillAnimationName]?.durationsMs;
  const isBombDemonSkill = event.skillId === "bomb-demon-boom";
  const isCloneTechnique = isMelee && event.skillId === "shadow-clone-rush" && skillAnimationFrames.length > 1;
  const isErenSkill = isMelee && presentationId === "eren" && ["eren-free-will", "eren-tatakae"].includes(event.skillId) && skillAnimationFrames.length > 1;
  const isKanekiPredator = isMelee && presentationId === "kaneki" && event.skillId === "kaneki-predator" && skillAnimationFrames.length === 3;
  const isKanekiNormal = isMelee && presentationId === "kaneki" && !event.skilled;
  const isTojiCombo = isMelee && attacker.id === "toji" && event.segmentCount > 1;
  const tojiFirst = isTojiCombo && event.segmentIndex === 1;
  const tojiLast = isTojiCombo && (event.segmentIndex === event.segmentCount || event.targetDied);
  const tojiRushMs = 430;
  const tojiSegmentMs = isTojiCombo ? 1000 / event.segmentCount : 470;
  const tojiWindupMs = Math.round(tojiSegmentMs / 2);
  const tojiPunchMs = tojiSegmentMs - tojiWindupMs;
  const tojiReturnMs = 390;
  const kanekiTiming = attacker.animationTiming;
  if (isErenSkill) sourceEl.classList.add("is-skill-posing");
  const isDeidaraBirdSkill = event.skillId === "c4-garuda" && skillAnimationFrames.length > 2;
  const skillSlowdown = isBombDemonSkill ? 1 : timings.skillAnimationSlowdownMultiplier;
  const cloneSealMs = isCloneTechnique && Array.isArray(authoredSkillDurations)
    ? authoredSkillDurations[0] * skillSlowdown
    : 0;
  const cloneApproachMs = isCloneTechnique && Array.isArray(authoredSkillDurations)
    ? authoredSkillDurations.slice(1, skillAnimationFrames.length).reduce((total, duration) => total + duration, 0) * skillSlowdown
    : 0;
  const skillActionMs = skillAnimationFrames.length
    ? (Array.isArray(authoredSkillDurations)
      ? authoredSkillDurations.slice(0, skillAnimationFrames.length).reduce((total, duration) => total + duration, 0) * (isKanekiPredator ? 1 : timings.skillAnimationSlowdownMultiplier)
      : actionTiming.actionMs * skillSlowdown)
    : 0;
  const erenWindupMs = isErenSkill && Array.isArray(authoredSkillDurations) ? authoredSkillDurations[0] * skillSlowdown : 0;
  const erenFollowThroughMs = isErenSkill && Array.isArray(authoredSkillDurations) ? authoredSkillDurations.slice(1).reduce((total, durationMs) => total + durationMs, 0) * skillSlowdown : 0;
  const meleePunchMs = skillActionMs || actionTiming.punchMs;
  const actionDuration = isMelee
    ? isTojiCombo
      ? (tojiFirst ? tojiRushMs : 0) + tojiWindupMs + tojiPunchMs + (tojiLast ? tojiReturnMs : 0)
    : isKanekiPredator
      ? kanekiTiming.predator.launchMs + kanekiTiming.predator.strikeMs + kanekiTiming.predator.retreatMs
      : isKanekiNormal
        ? kanekiTiming.normalAttack.approachMs + kanekiTiming.normalAttack.totalMs + kanekiTiming.normalAttack.returnMs
      : isCloneTechnique
      ? cloneSealMs + cloneApproachMs + actionTiming.punchMs + actionTiming.recoveryMs
      : isErenSkill
        ? erenWindupMs + actionTiming.rushMs + erenFollowThroughMs + actionTiming.recoveryMs
      : actionTiming.rushMs + meleePunchMs + actionTiming.recoveryMs
    : event.skilled && skillAnimationFrames.length ? skillActionMs : actionTiming.actionMs;
  const borosVisualDuration = skillAnimationName === "meteor"
    ? borosTimeline?.takeoffMs + borosTimeline?.dashMs + borosTimeline?.slamMs + borosTimeline?.returnMs
    : borosTimeline?.totalMs;
  const duration = gilTimeline ? firstGilVisual ? gilTimeline.totalMs : 0 : isBorosPunch ? scaled(1500) : isKiraPunch ? scaled(700) : borosTimeline ? firstBorosVisual
    ? skillAnimationName === "cannon" ? borosVisualDuration : scaled(borosVisualDuration)
    : 0 : scaled(actionDuration);
  const impactDelay = gilTimeline ? firstGilVisual ? gilTimeline.impactMs : 0 : isBorosPunch ? scaled(650) : isKiraPunch ? scaled(360) : isTojiCombo ? scaled((tojiFirst ? tojiRushMs : 0) + tojiWindupMs) : borosTimeline ? firstBorosVisual
    ? skillAnimationName === "cannon" ? borosTimeline.impactMs : scaled(borosTimeline.impactMs)
    : 0 : scaled(isCloneTechnique
    ? cloneSealMs + cloneApproachMs
    : isKanekiPredator ? kanekiTiming.predator.impactMs
    : isKanekiNormal ? kanekiTiming.normalAttack.approachMs + kanekiTiming.normalAttack.impactMs
    : isErenSkill ? erenWindupMs + actionTiming.rushMs + erenFollowThroughMs
      : isBombDemonSkill ? skillActionMs
      : isDeidaraBirdSkill ? skillActionMs * 0.5 + 800
      : isMelee ? actionTiming.rushMs : Math.round(actionTiming.actionMs * 0.48));
  const eventGap = borosTimeline || isTojiCombo ? 0 : scaled(timings.eventGapMs);
  sourceEl.style.setProperty("--attack-duration", `${duration}ms`);
  sourceEl.style.setProperty("--impact-duration", `${scaled(isMelee ? meleePunchMs : actionTiming.actionMs * 0.5)}ms`);
  let kiraStand = null;
  if (isKanekiPredator) {
    showFighterFrame(sourceEl, attacker, "predator", "launch");
  } else if (isKanekiNormal) {
    startRunCycle(sourceEl, attacker, 120, playbackMultiplier);
  } else if (isCloneTechnique) {
    showFighterFrame(sourceEl, attacker, skillAnimationName, skillAnimationFrames[0]);
  } else if (isErenSkill) {
    showFighterFrame(sourceEl, attacker, skillAnimationName, skillAnimationFrames[0]);
  } else if (isMelee && (!isTojiCombo || tojiFirst)) {
    startRunCycle(sourceEl, attacker, actionTiming.runFrameMs, playbackMultiplier);
  }
  if (isMelee) {
    const sourceBox = sourceEl.getBoundingClientRect();
    const targetBox = targetEl.getBoundingClientRect();
    const delta = targetBox.left + targetBox.width / 2 - (sourceBox.left + sourceBox.width / 2);
    const stopGap = (sourceBox.width + targetBox.width) * 0.5;
    const lungeDistance = Math.max(0, Math.abs(delta) - stopGap);
    const lunge = Math.sign(delta) * lungeDistance;
    if (!isTojiCombo || tojiFirst) sourceEl.style.setProperty("--melee-x", `${lunge}px`);
    if (isTojiCombo) {
      sourceEl.style.setProperty("--toji-rush-duration", `${scaled(tojiRushMs)}ms`);
      sourceEl.style.setProperty("--toji-return-duration", `${scaled(tojiReturnMs)}ms`);
      if (tojiFirst) {
        sourceEl.classList.add("is-toji-approaching", "is-melee-running");
        animationStageTimer = window.setTimeout(() => {
          sourceEl.classList.remove("is-toji-approaching", "is-melee-running");
          sourceEl.classList.add("is-toji-at-target");
          stopSpriteFrameCycle(sourceEl);
          showFighterFrame(sourceEl, attacker, "meleeAttack", "punch_1");
          animationStageTimer = null;
        }, scaled(tojiRushMs));
      }
    } else if (isKanekiPredator) {
      const launch = Math.sign(delta) * Math.min(Math.abs(lunge), sourceBox.width * 0.5);
      sourceEl.style.setProperty("--kaneki-launch-x", `${launch}px`);
      sourceEl.style.setProperty("--kaneki-launch-duration", `${scaled(kanekiTiming.predator.launchMs)}ms`);
      sourceEl.style.setProperty("--kaneki-approach-duration", `${scaled(400)}ms`);
      sourceEl.style.setProperty("--kaneki-hold-duration", `${scaled(kanekiTiming.predator.strikeMs - 400)}ms`);
      sourceEl.style.setProperty("--kaneki-return-duration", `${scaled(kanekiTiming.predator.retreatMs)}ms`);
      sourceEl.classList.add("is-kaneki-predator-launch");
      animationStageTimer = window.setTimeout(() => {
        sourceEl.classList.remove("is-kaneki-predator-launch");
        sourceEl.classList.add("is-kaneki-predator-strike");
        startRunCycle(sourceEl, attacker, 120, playbackMultiplier);
        animationStageTimer = window.setTimeout(() => {
          sourceEl.classList.remove("is-kaneki-predator-strike");
          sourceEl.classList.add("is-kaneki-predator-hold");
          stopSpriteFrameCycle(sourceEl);
          showFighterFrame(sourceEl, attacker, "predator", "strike");
          animationStageTimer = window.setTimeout(() => {
            sourceEl.classList.remove("is-kaneki-predator-hold");
            sourceEl.classList.add("is-kaneki-predator-return");
            showFighterFrame(sourceEl, attacker, "predator", "retreat");
            animationStageTimer = null;
          }, scaled(kanekiTiming.predator.strikeMs - 400));
        }, scaled(400));
      }, scaled(kanekiTiming.predator.launchMs));
    } else if (isKanekiNormal) {
      sourceEl.style.setProperty("--kaneki-normal-approach-duration", `${scaled(kanekiTiming.normalAttack.approachMs)}ms`);
      sourceEl.style.setProperty("--kaneki-normal-return-duration", `${scaled(kanekiTiming.normalAttack.returnMs)}ms`);
      sourceEl.classList.add("is-kaneki-normal-approach", "is-attacking");
      animationStageTimer = window.setTimeout(() => {
        sourceEl.classList.remove("is-kaneki-normal-approach");
        sourceEl.classList.add("is-kaneki-normal-at-target");
        stopSpriteFrameCycle(sourceEl);
        showFighterFrame(sourceEl, attacker, "meleeAttack", "charge");
        animationStageTimer = window.setTimeout(() => {
          showFighterFrame(sourceEl, attacker, "meleeAttack", "punch");
          animationStageTimer = window.setTimeout(() => {
            sourceEl.classList.remove("is-kaneki-normal-at-target");
            sourceEl.classList.add("is-kaneki-normal-return");
            startRunCycle(sourceEl, attacker, 120, playbackMultiplier);
            animationStageTimer = null;
          }, scaled(kanekiTiming.normalAttack.totalMs - kanekiTiming.normalAttack.chargeMs));
        }, scaled(kanekiTiming.normalAttack.chargeMs));
      }, scaled(kanekiTiming.normalAttack.approachMs));
    } else if (isErenSkill) {
      sourceEl.style.setProperty("--approach-duration", `${scaled(actionTiming.rushMs)}ms`);
      sourceEl.style.setProperty("--return-duration", `${scaled(actionTiming.recoveryMs)}ms`);
      animationStageTimer = window.setTimeout(() => {
        animationStageTimer = null;
        sourceEl.classList.remove("is-skill-posing");
        startRunCycle(sourceEl, attacker, actionTiming.runFrameMs, playbackMultiplier);
        sourceEl.classList.add("is-clone-melee-approaching", "is-melee-running");
        animationStageTimer = window.setTimeout(() => {
          animationStageTimer = null;
          sourceEl.classList.remove("is-melee-running");
          sourceEl.classList.add("is-melee-at-target", "is-skill-posing");
          stopSpriteFrameCycle(sourceEl);
          startFrameCycle(
            sourceEl,
            attacker,
            skillAnimationName,
            skillAnimationFrames.slice(1),
            0,
            false,
            playbackMultiplier / skillSlowdown,
            skillAnimationFrames.slice(1).map((_, index) => index + 1),
          );
          sourceEl.classList.add("is-punching");
        }, scaled(actionTiming.rushMs));
      }, scaled(erenWindupMs));
    } else if (isCloneTechnique) {
      sourceEl.style.setProperty("--approach-duration", `${scaled(cloneApproachMs)}ms`);
      sourceEl.style.setProperty("--return-duration", `${scaled(actionTiming.recoveryMs)}ms`);
      animationStageTimer = window.setTimeout(() => {
        animationStageTimer = null;
        startFrameCycle(
          sourceEl,
          attacker,
          skillAnimationName,
          skillAnimationFrames.slice(1),
          0,
          false,
          playbackMultiplier / skillSlowdown,
          skillAnimationFrames.slice(1).map((_, index) => index + 1),
        );
        sourceEl.classList.add("is-clone-melee-approaching", "is-melee-running");
      }, scaled(cloneSealMs));
    } else {
      sourceEl.classList.add("is-melee-rushing", "is-melee-running");
    }
  } else {
    sourceEl.classList.add("is-attacking");
    if (!borosTimeline && !isBorosPunch && !isKiraPunch) sourceEl.classList.add(event.attackType === "magic" ? "is-magic-attacking" : "is-ranged-attacking");
    const configuredAnimation = event.skilled
      ? attacker.skillAnimationMap?.[event.skillId]
      : attacker.attackAnimation;
    const animationName = configuredAnimation ?? attacker.attackAnimation;
    const rangedFrames = animationFrameNames(attacker, animationName);
    if (isBorosPunch) {
      const sourceBox = sourceEl.getBoundingClientRect();
      const targetBox = targetEl.getBoundingClientRect();
      const delta = targetBox.left + targetBox.width / 2 - (sourceBox.left + sourceBox.width / 2);
      const stopGap = (sourceBox.width + targetBox.width) * .5;
      sourceEl.style.setProperty("--boros-punch-x", `${Math.sign(delta) * Math.max(0, Math.abs(delta) - stopGap)}px`);
      sourceEl.style.setProperty("--boros-punch-approach-duration", `${scaled(500)}ms`);
      sourceEl.style.setProperty("--boros-punch-return-duration", `${scaled(520)}ms`);
      sourceEl.classList.add("is-boros-punch-approaching");
      showFighterFrame(sourceEl, attacker, "meleeAttack", "windup");
      scheduleBorosVisual(() => {
        sourceEl.classList.remove("is-boros-punch-approaching");
        sourceEl.classList.add("is-boros-punch-at-target");
        showFighterFrame(sourceEl, attacker, "meleeAttack", "punch");
      }, scaled(500));
      scheduleBorosVisual(() => {
        sourceEl.classList.remove("is-boros-punch-at-target");
        sourceEl.classList.add("is-boros-punch-returning");
        showFighterFrame(sourceEl, attacker, "idle", "stage1");
      }, scaled(980));
    } else if (isKiraPunch) {
      showFighterFrame(sourceEl, attacker, "meleeAttack", "punch_1");
      scheduleBorosVisual(() => {
        if (sourceEl.isConnected && targetEl.isConnected && target.alive) {
          kiraStand = launchKiraStand(sourceEl, targetEl, attacker, scaled(210));
        }
      }, scaled(140));
    } else if (gilTimeline) {
      if (firstGilVisual) startGilgameshVisual(sourceEl, attacker, gilTimeline);
    } else if (borosTimeline) {
      if (firstBorosVisual) startBorosSkillVisual(sourceEl, targetEl, attacker, skillAnimationName, borosTimeline, skillAnimationName === "cannon" ? (ms) => ms : scaled);
    } else if (animationName && rangedFrames.length) {
      const frameSetDuration = event.skilled && skillAnimationFrames.length ? skillActionMs : actionTiming.actionMs;
      const frameDurationScale = isBombDemonSkill
        ? playbackMultiplier
        : 1;
      startFrameCycle(sourceEl, attacker, animationName, rangedFrames, scaled(frameSetDuration / rangedFrames.length), false, frameDurationScale);
    }
  }

  let birdProjectile = null;
  if (isDeidaraBirdSkill) {
    birdProjectileTimer = window.setTimeout(() => {
      birdProjectileTimer = null;
      birdProjectile = launchDeidaraBirdProjectile(sourceEl, targetEl, scaled(800));
    }, scaled(skillActionMs * 0.5));
  }

  attackTimer = window.setTimeout(() => {
    attackTimer = null;
    if (kiraStand) scheduleBorosVisual(() => { kiraStand?.remove(); kiraStand = null; }, scaled(130));
    target.currentHp = event.targetHp;
    target.alive = event.targetHp > 0;
    if (event.phaseChange) {
      target.borosPhase = event.phaseChange.phase;
      if (target.phaseAssets?.[target.borosPhase]) {
        target.asset = target.phaseAssets[target.borosPhase];
        targetEl.querySelector(".sprite").src = target.asset;
      }
      target.atk = event.phaseChange.atk;
      target.def = event.phaseChange.def;
      target.spd = event.phaseChange.spd;
      battleStatusState.borosPhase = event.phaseChange.phase;
      renderAllyStatusIcons();
      addLog(`<b>波罗斯</b> 进入阶段${event.phaseChange.phase === 2 ? "二 · 能量释放" : "三 · 最终形态"}！ATK ${target.atk}、DEF ${target.def}、SPD ${target.spd}。`, "log-enemy");
    }
    if (event.bombAttached) {
      battleStatusState.bombs.push({ ...event.bombAttached, targetName: target.name });
      renderAllyStatusIcons();
      addLog(`<b>杀手皇后</b> 在 ${target.name} 身上附加炸弹 ${event.bombAttached.id}，第 ${event.bombAttached.dueRound} 回合引爆。`, "log-enemy");
    }
    if (event.damageSkillTriggered) {
      target.damageTakenHits = event.damageSkillTriggered.hits;
      target.critRateBonus = event.damageSkillTriggered.critRateBonus;
      target.dodgeRateBonus = event.damageSkillTriggered.dodgeRateBonus;
      target.atk = event.damageSkillTriggered.effectiveAtk;
    }
    if (isMelee) {
      if (isTojiCombo) {
        stopSpriteFrameCycle(sourceEl);
        sourceEl.classList.add("is-toji-at-target", "is-punching");
        showFighterFrame(sourceEl, attacker, "meleeAttack", "punch_2");
      } else if (isKanekiPredator || isKanekiNormal) {
        // These two actions are fully staged before the precomputed hit event.
      } else if (isCloneTechnique || isErenSkill) {
        // The hand-seal and clone frames already played before impact and during the approach.
      } else {
        sourceEl.classList.remove("is-melee-running");
        stopSpriteFrameCycle(sourceEl);
      }
      if (isTojiCombo) {
        if (tojiLast) animationStageTimer = window.setTimeout(() => {
          sourceEl.classList.remove("is-punching", "is-toji-at-target");
          sourceEl.classList.add("is-toji-returning", "is-melee-running");
          startRunCycle(sourceEl, attacker, actionTiming.runFrameMs, playbackMultiplier);
          animationStageTimer = null;
        }, scaled(tojiPunchMs));
      } else if (isKanekiPredator || isKanekiNormal) {
        // Keep the authored strike frame until the configured retreat/recovery ends.
      } else if (isErenSkill) {
        sourceEl.classList.remove("is-clone-melee-approaching", "is-melee-at-target", "is-skill-posing", "is-punching", "is-melee-running");
        stopSpriteFrameCycle(sourceEl);
        sourceEl.classList.add("is-clone-melee-returning", "is-melee-running", "is-melee-returning");
        startRunCycle(sourceEl, attacker, actionTiming.runFrameMs, playbackMultiplier);
      } else if (!isCloneTechnique && skillAnimationFrames.length) {
        const skillPlaybackMultiplier = playbackMultiplier / timings.skillAnimationSlowdownMultiplier;
        startFrameCycle(sourceEl, attacker, skillAnimationName, skillAnimationFrames, 0, false, skillPlaybackMultiplier);
      } else if (!isCloneTechnique) {
        sourceEl.classList.add("is-punching");
        const punchFrames = attacker.animations?.meleeAttack?.impactFrames ?? animationFrameNames(attacker, "meleeAttack", "punch_");
        if (punchFrames.length) startFrameCycle(sourceEl, attacker, "meleeAttack", punchFrames, actionTiming.punchMs / punchFrames.length, false, playbackMultiplier);
      }
      if (!isTojiCombo && !isErenSkill && !isKanekiPredator && !isKanekiNormal) animationStageTimer = window.setTimeout(() => {
        sourceEl.classList.remove("is-punching");
        if (isCloneTechnique) {
          sourceEl.classList.remove("is-clone-melee-approaching");
          sourceEl.classList.add("is-clone-melee-returning", "is-melee-running");
          startRunCycle(sourceEl, attacker, actionTiming.runFrameMs, playbackMultiplier);
        } else {
          startRunCycle(sourceEl, attacker, actionTiming.runFrameMs, playbackMultiplier);
          sourceEl.classList.add("is-melee-running", "is-melee-returning");
        }
        animationStageTimer = null;
      }, scaled(isCloneTechnique ? actionTiming.punchMs : meleePunchMs));
    }
    const damage = targetEl.querySelector(".damage-number");
    damage.classList.remove("is-heal");
    damage.textContent = event.dodged ? "闪避" : event.critical ? `暴击 -${event.damage}` : `-${event.damage}`;
    damage.style.setProperty("--damage-duration", `${Math.max(280, duration)}ms`);
    damage.classList.remove("pop");
    void damage.offsetWidth;
    damage.classList.add("pop");
    if (event.dodged) {
      targetEl.classList.add("is-dodging");
      const dodgeFrames = animationFrameNames(target, "dodge");
      if (dodgeFrames.length) startFrameCycle(targetEl, target, "dodge", dodgeFrames, scaled(300 / dodgeFrames.length), false);
    }
    else {
      const stunned = Math.random() < 0.5;
      targetEl.classList.add("is-hit", "is-impact", stunned ? "is-hit-stun" : "is-hit-recoil");
      const hitFrames = target.animations?.hit?.frames;
      if (hitFrames && !event.damageSkillTriggered) {
        const sequence = [stunned ? "dizzy" : "hurt", "recover"].filter((name) => typeof hitFrames[name] === "string");
        if (sequence.length) startFrameCycle(targetEl, target, "hit", sequence, scaled(180), false);
      }
      if (event.critical) targetEl.classList.add("is-critical");
      const burst = targetEl.querySelector(".impact-burst");
      if (burst) {
        burst.classList.remove("play", "melee-impact", "melee-from-right");
        burst.style.removeProperty("left");
        burst.style.removeProperty("top");
        if (event.attackType === "melee") {
          burst.classList.add("melee-impact");
          if (positionMeleeImpact(burst, sourceEl, targetEl)) burst.classList.add("melee-from-right");
        }
        void burst.offsetWidth;
        burst.classList.add("play");
      }
    }
    if (Number.isFinite(event.targetDef)) target.def = event.targetDef;
    if (Number.isFinite(event.predatorKillBonus) && event.predatorKillBonus > 0) {
      attacker.maxHp += event.predatorKillBonus;
      addLog(`<b>${attacker.name}</b> 捕食者击杀：本局最大 HP +${event.predatorKillBonus}。`, "log-skill");
    }
    for (const granted of event.shieldsGranted ?? []) {
      const ally = viewState.characters.find((unit) => unit.id === granted.targetId);
      if (ally) { ally.shieldHp = granted.total; updateHealth(ally); }
    }
    if (Number.isFinite(event.targetShield)) { target.shieldHp = event.targetShield; updateHealth(target); }
    if (event.shieldsGranted?.length) addLog(`<b>${attacker.name}</b> 为存活队友各提供 ${event.shieldsGranted[0].amount} 点护盾。`, "log-skill");
    if (event.shieldAbsorbed) addLog(`<b>${target.name}</b> 的护盾吸收 ${event.shieldAbsorbed} 点伤害。`, "log-skill");
    if (event.extraTrueDamage) addLog(`<b>${attacker.name}</b> 自由意志追加 ${event.extraTrueDamage.actualDamage} 点真实伤害。`, "log-skill");
    if (event.weaknessApplied) {
      target.weaknessRound = event.round + 1;
      updateHealth(target);
      addLog(`<b>${target.name}</b> 下回合造成的伤害降低 50%。`, "log-enemy");
    }
    if (squadSide === "enemy") renderSquad();
    if (event.healedAmount > 0) {
      attacker.currentHp = event.attackerHp;
      updateHealth(attacker);
      const healingNumber = sourceEl.querySelector(".damage-number");
      if (healingNumber) {
        healingNumber.textContent = `+${event.healedAmount}`;
        healingNumber.style.setProperty("--damage-duration", `${Math.max(280, duration)}ms`);
        healingNumber.classList.remove("pop");
        healingNumber.classList.add("is-heal");
        void healingNumber.offsetWidth;
        healingNumber.classList.add("pop");
      }
    }
    const extraEffectText = [
      event.defenseReduced > 0 ? `<span class="skill-name">DEF -${event.defenseReduced}</span>` : "",
      event.defenseBonusApplied > 0 ? `<span class="skill-name">DEF +${event.defenseBonusApplied}</span>` : "",
      event.oneEyeTriggered ? `<span class="skill-name">独眼触发：${event.oneEyeHealedAmount > 0 ? `HP +${event.oneEyeHealedAmount}` : "生命值已满"}</span>` : event.healedAmount > 0 ? `<span class="skill-name">HP +${event.healedAmount}</span>` : "",
      event.damageSkillTriggered ? `<span class="skill-name">${event.damageSkillTriggered.skillName} 生效：暴击率 +${Math.round(event.damageSkillTriggered.critRateGain * 100)} 个百分点、ATK +${event.damageSkillTriggered.attackGain ?? 0}${event.damageSkillTriggered.dodgeRateGain ? `、闪避率 +${Math.round(event.damageSkillTriggered.dodgeRateGain * 100)} 个百分点` : ""}</span>` : "",
      event.doubleDamageArmed ? '<span class="skill-name">下次受伤翻倍</span>' : "",
      event.passiveTriggered?.damageImmune ? `<span class="skill-name">${event.passiveTriggered.skillId === "eren-2000-years" ? "2000年后的你免疫了这次攻击" : "被动免疫"}</span>` : "",
      event.doubleDamageConsumed && !event.passiveTriggered?.damageImmune ? '<span class="skill-name">承受双倍伤害</span>' : "",
      event.armorReductionApplied ? '<span class="skill-name">铠甲减伤 50%</span>' : "",
    ].filter(Boolean).join(" ");
    const segmentText = event.segmentCount > 1 && attacker.id === "toji" ? ` 第 ${event.segmentIndex}/${event.segmentCount} 段` : "";
    addLog(`<span class="round-label">R${event.round}</span> <b>${attacker.name}</b> ${actionText}${segmentText} → <b>${target.name}</b> ${resultText}${extraEffectText}`, event.skilled ? "log-skill" : sourceSide === "enemy" ? "log-enemy" : "");
    updateHealth(target);
    if (event.dodged) addLog(`<b>${target.name}</b> 闪开了攻击`, "log-dodge");
    if (event.targetDied) {
      if (target.id === "armored-titan") battleStatusState.armoredShield = null;
      battleStatusState.bombs = battleStatusState.bombs.filter((bomb) => bomb.targetId !== target.id);
      renderAllyStatusIcons();
      window.clearTimeout(targetHitTimer);
      targetHitTimer = null;
      clearSpriteFrame(targetEl);
      targetEl.classList.remove("is-hit", "is-dodging", "is-critical", "is-impact");
      targetEl.classList.remove("is-hit-stun", "is-hit-recoil");
      const deathDuration = target.id === "six_ear" ? 1000 : target.team === "ally" ? Math.max(scaled(timings.deathMs), scaled(ANIMATION_TIMING.boss.defeatFallMs)) : scaled(timings.deathMs);
      targetEl.style.setProperty("--death-duration", `${deathDuration}ms`);
      targetEl.classList.add("is-dead");
      const deathFrames = animationFrameNames(target, "death");
      if (deathFrames.length) startFrameCycle(targetEl, target, "death", deathFrames, deathDuration / deathFrames.length, false);
      addLog(`<b>${target.name}</b> 倒下了`, "log-death");
    } else if (!event.dodged) {
      window.clearTimeout(targetHitTimer);
      const reactiveMs = event.damageSkillTriggered && (target.mimicSourceId ?? target.id) === "kaneki"
        ? target.animationTiming?.thousandSevenMs ?? 1000 : 380;
      if (event.damageSkillTriggered && (target.mimicSourceId ?? target.id) === "kaneki") {
        targetEl.classList.add("is-kaneki-reactive");
        showFighterFrame(targetEl, target, "thousandSeven", "burst");
      }
      targetHitTimer = window.setTimeout(() => {
        clearSpriteFrame(targetEl);
        targetEl.classList.remove("is-hit", "is-impact", "is-critical", "is-hit-stun", "is-hit-recoil", "is-kaneki-reactive");
        startIdleCycle(targetEl, target);
        targetHitTimer = null;
      }, scaled(reactiveMs));
    }
  }, impactDelay);

  const reactiveHoldMs = event.damageSkillTriggered && (target.mimicSourceId ?? target.id) === "kaneki" && !event.targetDied
    ? scaled(target.animationTiming?.thousandSevenMs ?? 1000) : 0;
  const delay = Math.max(duration + eventGap, impactDelay + reactiveHoldMs + eventGap, event.targetDied && target.id === "six_ear" ? impactDelay + 1000 : 0);
  timer = window.setTimeout(() => {
    if (birdProjectileTimer) window.clearTimeout(birdProjectileTimer);
    birdProjectileTimer = null;
    birdProjectile?.remove();
    birdProjectile = null;
    kiraStand?.remove();
    kiraStand = null;
    if (gilTimeline && firstGilVisual) {
      for (const visualTimer of borosVisualTimers) window.clearTimeout(visualTimer);
      borosVisualTimers.clear();
      document.querySelectorAll(".gilgamesh-visual").forEach((node) => node.remove());
    }
    if (borosTimeline && firstBorosVisual) {
      for (const visualTimer of borosVisualTimers) window.clearTimeout(visualTimer);
      borosVisualTimers.clear();
      clearBorosVisuals(sourceEl);
    }
    sourceEl.classList.remove("is-boros-punch-approaching", "is-boros-punch-at-target", "is-boros-punch-returning");
    sourceEl.style.removeProperty("--boros-punch-x");
    sourceEl.style.removeProperty("--boros-punch-approach-duration");
    sourceEl.style.removeProperty("--boros-punch-return-duration");
    sourceEl.classList.remove("is-attacking", "is-melee-rushing", "is-clone-melee-approaching", "is-clone-melee-returning", "is-melee-at-target", "is-melee-returning", "is-melee-running", "is-skill-posing", "is-punching", "is-casting", "is-magic-attacking", "is-ranged-attacking", "is-kaneki-normal-approach", "is-kaneki-normal-at-target", "is-kaneki-normal-return", "is-kaneki-predator-launch", "is-kaneki-predator-strike", "is-kaneki-predator-hold", "is-kaneki-predator-return");
    if (!isTojiCombo || tojiLast) sourceEl.classList.remove("is-toji-approaching", "is-toji-at-target", "is-toji-returning");
    targetEl.classList.remove("is-hit", "is-dodging", "is-critical", "is-impact", "is-hit-stun", "is-hit-recoil", "is-kaneki-reactive");
    if (!isTojiCombo || tojiLast) sourceEl.style.removeProperty("--melee-x");
    sourceEl.style.removeProperty("--kaneki-launch-x");
    sourceEl.style.removeProperty("--kaneki-nudge");
    sourceEl.style.removeProperty("--kaneki-launch-duration");
    sourceEl.style.removeProperty("--kaneki-approach-duration");
    sourceEl.style.removeProperty("--kaneki-hold-duration");
    sourceEl.style.removeProperty("--kaneki-return-duration");
    sourceEl.style.removeProperty("--kaneki-normal-duration");
    sourceEl.style.removeProperty("--kaneki-normal-approach-duration");
    sourceEl.style.removeProperty("--kaneki-normal-return-duration");
    sourceEl.style.removeProperty("--attack-duration");
    sourceEl.style.removeProperty("--approach-duration");
    sourceEl.style.removeProperty("--return-duration");
    sourceEl.style.removeProperty("--impact-duration");
    sourceEl.style.removeProperty("--skill-duration");
    targetEl.style.removeProperty("--hit-duration");
    targetEl.style.removeProperty("--hit-shake-duration");
    targetEl.style.removeProperty("--dodge-duration");
    targetEl.style.removeProperty("--impact-fx-duration");
    const burst = targetEl.querySelector(".impact-burst");
    burst?.classList.remove("play");
    burst?.classList.remove("melee-impact", "melee-from-right");
    burst?.style.removeProperty("left");
    burst?.style.removeProperty("top");
    if (!event.targetDied) {
      clearSpriteFrame(targetEl);
      startIdleCycle(targetEl, target);
    }
    if (event.attackType === "melee") sourceEl.classList.remove("is-casting");
    clearSpriteFrame(sourceEl);
    if ((!isTojiCombo || tojiLast) && attacker.alive) startIdleCycle(sourceEl, attacker);
    animationStageTimer = null;
    finish();
  }, delay);
}

function playNext(token) {
  if (token !== generation || !playback || playbackPaused) return;
  if (playback.index >= playback.events.length) {
    playback = null;
    setBattleControls(false);
    return;
  }
  const event = playback.events[playback.index++];
  playEvent(event, () => playNext(token));
}

function removeEnemyEntranceVisuals() {
  window.clearTimeout(entranceTimer);
  window.clearTimeout(entrancePreloadTimer);
  entranceTimer = null;
  entrancePreloadTimer = null;
  for (const image of entranceImages) { image.onload = null; image.onerror = null; }
  entranceImages = [];
  entranceOverlay?.remove();
  entranceOverlay = null;
  $("#battle-screen")?.classList.remove("is-enemy-entrance-shaking");
}

function cancelEnemyEntrance() {
  entranceCompletion?.cancel();
  entranceCompletion = null;
  removeEnemyEntranceVisuals();
  battleStartPhase = "idle";
}

function playEnemyEntrance(entrance, token, onComplete) {
  const screen = $("#battle-screen");
  const arena = $(".arena");
  if (!screen || !arena) return onComplete();
  battleStartPhase = "entrance";
  const completion = createEntranceCompletion(onComplete);
  entranceCompletion = completion;
  const actors = entrance.actors ?? [entrance.actor];
  const assets = actors.map((actor) => Object.values(actor.animations?.idle?.frames ?? {})[0] ?? actor.asset);
  let revealed = false;
  const reveal = () => {
    if (revealed || completion.state !== "pending" || token !== generation || campaign?.status !== "combat") return;
    revealed = true;
    window.clearTimeout(entrancePreloadTimer);
    entrancePreloadTimer = null;
    const arenaRect = arena.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const portraitSizes = actors.map((actor) => {
      const visual = getCharacterVisual(actor);
      const rowScale = actor.row === "back" ? .86 : 1;
      return { width: visual.frameWidth * visual.scale * rowScale,
        height: visual.frameHeight * visual.scale * rowScale };
    });
    const portraitWidth = portraitSizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, actors.length - 1) * 10;
    const groupScale = Math.min(1, (arenaRect.width - 36) / portraitWidth);
    const titleSize = Math.min(40, Math.max(26, Math.floor((arenaRect.width - 28) / (entrance.title.length * 1.15))));
    const overlay = document.createElement("div");
    overlay.className = "enemy-entrance";
    overlay.setAttribute("role", "img");
    const displayName = actors.map((actor) => actor.name).join(" · ");
    overlay.setAttribute("aria-label", `${entrance.title}，${displayName}登场`);
    overlay.style.setProperty("--entrance-center-x", `${arenaRect.left - screenRect.left + arenaRect.width / 2}px`);
    overlay.style.setProperty("--entrance-center-y", `${arenaRect.top - screenRect.top + arenaRect.height * .44}px`);
    overlay.style.setProperty("--entrance-slide", `${arenaRect.width}px`);
    overlay.style.setProperty("--entrance-title-size", `${titleSize}px`);
    overlay.style.setProperty("--entrance-name-size", `${Math.max(14, Math.min(18, Math.round(titleSize * .45)))}px`);
    overlay.style.setProperty("--entrance-title-color", entrance.titleColor);
    overlay.style.setProperty("--entrance-outline-color", entrance.titleOutline);
    overlay.style.setProperty("--entrance-group-scale", String(groupScale));
    const scrim = document.createElement("div");
    scrim.className = "enemy-entrance-scrim";
    const flash = document.createElement("div");
    flash.className = "enemy-entrance-flash";
    const portraits = document.createElement("div");
    portraits.className = "enemy-entrance-portraits";
    actors.forEach((actor, index) => {
      const portrait = document.createElement("img");
      const visual = getCharacterVisual(actor);
      portrait.src = assets[index];
      portrait.alt = "";
      portrait.style.width = `${portraitSizes[index].width}px`;
      portrait.style.height = `${portraitSizes[index].height}px`;
      portrait.style.translate = `${visual.offsetX ?? 0}px ${visual.offsetY ?? 0}px`;
      portraits.append(portrait);
    });
    const title = document.createElement("strong");
    title.className = "enemy-entrance-title";
    title.textContent = entrance.title;
    const name = document.createElement("span");
    name.className = "enemy-entrance-name";
    name.textContent = displayName;
    overlay.append(scrim, flash, portraits, title, name);
    entranceOverlay = overlay;
    screen.append(overlay);
    screen.classList.add("is-enemy-entrance-shaking");
    entranceTimer = window.setTimeout(() => {
      if (token !== generation || campaign?.status !== "combat" || completion.state !== "pending") return cancelEnemyEntrance();
      removeEnemyEntranceVisuals();
      entranceCompletion = null;
      battleStartPhase = "fighting";
      completion.complete();
    }, ENEMY_ENTRANCE_DURATION_MS);
  };
  let remaining = assets.length;
  entranceImages = assets.map((asset) => {
    const image = new Image();
    let settledOnce = false;
    const settled = () => {
      if (settledOnce) return;
      settledOnce = true;
      remaining -= 1;
      if (remaining === 0) reveal();
    };
    image.onload = settled;
    image.onerror = settled;
    image.src = asset;
    if (image.complete) queueMicrotask(settled);
    return image;
  });
  entrancePreloadTimer = window.setTimeout(reveal, 1200);
}

function beginBattle() {
  if (battleStartPhase !== "idle" || playback || !campaign || campaign.status !== "combat") return;
  $("#battle-screen").classList.toggle("stage-two", campaign.stageId === 2);
  $("#battle-screen .brand-copy .eyebrow").textContent = `PIXEL ROGUELIKE · ACT 0${campaign.stageId}`;
  const prepared = restoredBattle?.prepared ?? prepareBattle(campaign);
  if (!prepared) return;
  if (restoredBattle) campaign.combatLaunched = true;
  lastPreparedBattle = prepared;
  generation += 1;
  const token = generation;
  clearEffects();
  battleStartPhase = "initializing";
  viewState = initializeBattle(prepared.roster);
  battleStatusState = { jinchuriki: null, c0: null, borosPhase: null, bombs: [], armoredShield: null, currentRound: 0 };
  selectedStatusId = null;
  renderSquad();
  buildHealthRows(viewState.characters);
  renderAllyStatusIcons();
  const colossal = viewState.characters.find((unit) => unit.id === "colossal-titan");
  const arena = document.querySelector(".arena");
  if (colossal && arena && !arena.querySelector(".colossal-battle-smoke")) {
    const smoke = document.createElement("img");
    smoke.className = "colossal-battle-smoke";
    smoke.src = colossal.smokeAsset;
    smoke.alt = "";
    smoke.setAttribute("aria-hidden", "true");
    arena.append(smoke);
  }
  for (const character of viewState.characters) {
    const fighter = document.querySelector(`[data-character="${character.id}"]`);
    if (fighter) startIdleCycle(fighter, character);
  }
  $("#arena-location").textContent = prepared.battle.location;
  $("#boss-warning").hidden = prepared.battle.type !== "boss";
  if (prepared.battle.type === "boss") $("#boss-warning-text").textContent = campaign.stageId === 2
    ? "⚠️ 龙级灾难：波罗斯！注意他的三阶段形态变化！"
    : "艺术就是爆炸！要尽快击败迪达拉！";
  const typeNames = { normal: "普通战", "normal-hard": "强化普通战", elite: "精英战", boss: "首领战", event: "奇遇战" };
  $("#battle-stage-label").textContent = `第 ${prepared.battle.step} 步 · ${typeNames[prepared.battle.type]}`;
  log.innerHTML = "";
  playbackPaused = false;
  battleLogExpanded = false;
  pausedContinuation = null;
  updateBattleLogPanel();
  displayedEvents = 0;
  $("#log-count").textContent = "战斗进行中";
  addLog(`第 ${prepared.battle.number} 场开始：${prepared.battle.title}`, "log-start");
  if (prepared.battle.type === "boss" && campaign.stageId === 1) {
    const boss = prepared.roster.find((character) => Number.isFinite(character.c0DamagePerRound));
    const c4Chance = Math.round((boss?.skill?.chance ?? 0) * 100);
    addLog(`迪达拉的 C0 每个完整行动回合积累 ${boss?.c0DamagePerRound ?? 70} 点真实伤害；C4 迦楼罗有 ${c4Chance}% 概率造成 1.2 倍伤害并降低目标 DEF 20 点。`, "log-enemy");
  }
  if (prepared.battle.type === "boss" && campaign.stageId === 2) {
    addLog("波罗斯阶段一受到伤害减少 10%；阶段二每完整回合恢复 120 HP；阶段三属性强化且每完整回合 ATK +20。", "log-enemy");
  }
  const startFight = () => {
    if (battleStartedToken === token || token !== generation || campaign?.status !== "combat") return;
    battleStartedToken = token;
    battleStartPhase = "fighting";
    try {
      pendingResult = restoredBattle?.result ?? simulateBattle(prepared.roster, Math.random, prepared.combatOptions);
      restoredBattle = null;
      playback = { ...pendingResult, index: 0 };
      battleStatusState.c0 = pendingResult.c0 ? { damagePerRound: pendingResult.c0.damagePerRound, completedRounds: 0, accumulatedDamage: 0, detonated: false } : null;
      battleStatusState.borosPhase = prepared.roster.some((character) => character.id === "boros") ? 1 : null;
      renderAllyStatusIcons();
    } catch (error) {
      console.error("Battle initialization failed:", error);
      setStatus("战斗启动失败", "finished");
      addLog("战斗未能启动，请重新开始本局。", "log-death");
      return;
    }
    setStatus("战斗中", "fighting");
    setBattleControls(true);
    const deidara = prepared.battle.type === "boss"
      ? viewState.characters.find((character) => character.name === "迪达拉")
      : null;
    const deidaraEl = deidara && document.querySelector(`[data-character="${deidara.id}"]`);
    const spawnFrames = animationFrameNames(deidara, "spawn");
    if (deidaraEl && spawnFrames.length) {
      const spawnDuration = spawnFrames.length * ANIMATION_TIMING.boss.deidaraSpawnFrameMs;
      startFrameCycle(deidaraEl, deidara, "spawn", spawnFrames, ANIMATION_TIMING.boss.deidaraSpawnFrameMs, false);
      timer = window.setTimeout(() => {
        timer = null;
        if (playbackPaused) pausedContinuation = () => playNext(token);
        else playNext(token);
      }, spawnDuration);
    } else playNext(token);
  };
  setScreen("battle-screen");
  setBattleControls(false);
  const entrance = restoredBattle?.result ? null : getEnemyEntrance(prepared.battle, prepared.roster);
  const actionAssets = prepared.roster.flatMap((actor) => actor.id === "gilgamesh"
    ? [actor.animations?.enuma?.frames?.raise, actor.skillVisualTimelines?.enuma?.effect]
    : actor.id === "kira" ? [actor.animations?.meleeAttack?.frames?.punch_1, actor.animations?.meleeAttack?.frames?.stand]
    : actor.id === "armored-titan" ? [actor.animations?.skill1?.frames?.hold] : []).filter(Boolean);
  const actionReady = Promise.all(actionAssets.map((src) => new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
    if (image.complete) resolve();
  })));
  const startAfterAssets = () => actionReady.then(() => { if (token === generation) startFight(); });
  if (entrance) {
    setStatus("强敌登场");
    playEnemyEntrance(entrance, token, startAfterAssets);
  } else startAfterAssets();
}

function renderRoute() {
  if (!campaign || campaign.status !== "route") return;
  const routeMap = getRouteMap(campaign);
  const options = orderRouteOptionsByPosition(routeMap, getRouteOptions(campaign));
  $("#route-progress").textContent = options.some((node) => node.type === "demon") ? "Boss" : `第 ${campaign.step} 步`;
  $("#route-screen").classList.toggle("stage-two", campaign.stageId === 2);
  $("#route-screen").setAttribute("aria-label", `第${campaign.stageId}大关路线选择`);
  $("#battle-screen").classList.toggle("stage-two", campaign.stageId === 2);
  $("#route-screen .eyebrow").textContent = `ACT 0${campaign.stageId} · EXPEDITION`;
  $("#route-health").textContent = campaign.partyIds.map((id) => {
    const member = STARTING_CHARACTERS.find((entry) => entry.id === id);
    const state = campaign.partyStates[id];
    return `${member?.name ?? id} ${state.currentHp}/${state.maxHp}`;
  }).join(" · ");
  renderSquad();
  const hero = STARTING_CHARACTERS.find((character) => character.id === campaign.playerId);
  $("#route-player-img").src = Object.values(hero.animations?.idle?.frames ?? {})[0] ?? hero.asset;
  $("#route-player-name").textContent = hero.name;
  const partnerId = campaign.partyIds.find((id) => id !== campaign.playerId);
  const routePartner = $("#route-partner");
  const partner = campaign.stageId === 2 && partnerId
    ? STARTING_CHARACTERS.find((entry) => entry.id === partnerId) : null;
  $("#route-party").classList.toggle("has-partner", Boolean(partner));
  routePartner.hidden = !partner;
  if (partner) {
    $("#route-partner-img").src = Object.values(partner.animations?.idle?.frames ?? {})[0] ?? partner.asset;
    $("#route-partner-name").textContent = partner.name;
    routePartner.dataset.characterDetail = partner.id;
    routePartner.setAttribute("aria-label", `查看${partner.name}的属性和技能`);
  }
  const partnerButton = $("#route-partner-link");
  partnerButton.hidden = !partnerId;
  if (partnerId) {
    const partner = STARTING_CHARACTERS.find((entry) => entry.id === partnerId);
    partnerButton.textContent = `查看伙伴：${partner?.name ?? partnerId}`;
    partnerButton.onclick = () => openCharacterDetail(partnerId);
  }
  $(".route-player").dataset.characterDetail = hero.id;
  $(".route-player").setAttribute("aria-label", `查看${hero.name}的属性和技能`);
  updateBossProgress();
  const signs = $("#route-signs");
  signs.replaceChildren();
  signs.classList.toggle("route-signs-single", options.length === 1);
  for (const node of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `route-sign route-sign-${node.type}`;
    button.setAttribute("aria-label", `前往${routeTypeLabel(node.type)}`);
    const image = document.createElement("img");
    image.className = "route-sign-image";
    image.src = node.type === "elite" ? "assets/route-signs/battle.png" : `assets/route-signs/${node.type}.png`;
    image.alt = "";
    button.append(image);
    if (node.type === "elite") {
      const eliteIcon = document.createElement("img");
      eliteIcon.className = "route-sign-overlay";
      eliteIcon.src = "assets/route-signs/map-elite.svg";
      eliteIcon.alt = "";
      button.append(eliteIcon);
    }
    button.addEventListener("click", () => selectRouteNode(node.id));
    signs.append(button);
  }
  setScreen("route-screen");
  if (campaign.stageId === 1 && routeMap.currentNodeId === routeMap.startNodeId) openRouteMap();
}

function selectRouteNode(nodeId) {
  const selected = chooseRoute(campaign, nodeId);
  if (!selected) return false;
  const dialog = $("#route-map-dialog");
  if (dialog.open) dialog.close();
  if (selected.type === "event") renderCampaignEvent();
  else if (selected.type === "stage2_pending_end") renderStageTwoPendingEnd();
  else beginBattle();
  return true;
}

function openRouteMap() {
  if (!campaign || campaign.status !== "route") return;
  renderRouteMap();
  const dialog = $("#route-map-dialog");
  dialog.classList.toggle("stage-two", campaign.stageId === 2);
  if (!dialog.open) dialog.showModal();
}

function routeTypeLabel(type) {
  return ({ battle: "普通战斗", elite: "精英战", question: "未知事件", campfire: "篝火", demon: campaign?.stageId === 2 ? "波罗斯 Boss 战" : "迪达拉 Boss 战" })[type] ?? "前方地点";
}

function renderRouteMap() {
  if (!campaign) return;
  const routeMap = getRouteMap(campaign);
  const world = $("#route-map-world");
  const edgeLayer = $("#route-map-edges");
  const nodeLayer = $("#route-map-nodes");
  const mapHeight = (Math.max(...routeMap.nodes.map((node) => node.layer)) + 1) * 100;
  $("#route-map-edges").setAttribute("viewBox", "0 0 1000 " + mapHeight);
  const nodePosition = (node) => {
    return { x: node.x, y: mapHeight - 60 - node.layer * 100 };
  };
  edgeLayer.replaceChildren();
  nodeLayer.replaceChildren();
  const nodeById = new Map(routeMap.nodes.map((node) => [node.id, node]));
  for (const node of routeMap.nodes) {
    const from = nodePosition(node);
    for (const nextId of node.nextNodeIds) {
      const next = nodeById.get(nextId);
      if (!next) continue;
      const to = nodePosition(next);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", from.x); line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x); line.setAttribute("y2", to.y);
      line.setAttribute("class", routeMap.visitedEdges.some((edge) => edge.from === node.id && edge.to === next.id) ? "route-edge route-edge-visited" : "route-edge");
      edgeLayer.append(line);
    }
  }
  const hero = STARTING_CHARACTERS.find((character) => character.id === campaign.playerId);
  const labels = { start: "起点", battle: "普通战斗", elite: "精英战", question: "未知事件", campfire: "篝火", demon: campaign.stageId === 2 ? "波罗斯 Boss" : "迪达拉 Boss" };
  for (const node of routeMap.nodes) {
    const position = nodePosition(node);
    const selectable = campaign.status === "route" && node.status === "pending";
    const element = document.createElement(selectable ? "button" : "div");
    const isCurrent = node.id === routeMap.currentNodeId;
    element.className = `route-map-node route-map-${node.type} route-map-${node.status}${isCurrent ? " route-map-current" : ""}${selectable ? " route-map-selectable" : ""}`;
    element.style.left = `${position.x / 10}%`;
    element.style.top = `${position.y / mapHeight * 100}%`;
    if (selectable) {
      element.type = "button";
      element.addEventListener("click", () => selectRouteNode(node.id));
    } else {
      element.setAttribute("role", "img");
    }
    element.setAttribute("aria-label", `${labels[node.type]}，地图第 ${node.layer} 排${selectable ? `，可作为第 ${campaign.step} 步进入` : isCurrent ? "，当前位置" : node.status === "completed" ? "，已完成" : "，暂不可达"}`);
    const icon = document.createElement("img");
    icon.className = "route-map-icon";
    icon.src = node.type === "start"
      ? "assets/route-signs/map-home.svg"
      : node.type === "demon"
        ? (campaign.stageId === 2 ? "assets/stage2-enemies/boros-placeholder.svg" : "assets/deidara-v2/idle/idle_1.png")
        : `assets/route-signs/map-${node.type}.svg`;
    icon.alt = "";
    element.append(icon);
    if (isCurrent && hero) {
      const avatar = document.createElement("img");
      avatar.className = "route-map-avatar";
      avatar.src = hero.asset;
      avatar.alt = "";
      element.append(avatar);
    }
    nodeLayer.append(element);
  }
  world.style.height = `${mapHeight}px`;
  const scroll = $("#route-map-scroll");
  const currentPosition = nodePosition(nodeById.get(routeMap.currentNodeId));
  requestAnimationFrame(() => { scroll.scrollTop = Math.max(0, currentPosition.y - scroll.clientHeight + 150); });
}

function renderEvent(selection = {}) {
  if (!campaign || campaign.status !== "event" || !campaign.pendingEvent) return;
  const event = campaign.pendingEvent;
  eventResultShown = false;
  $("#event-title").textContent = event.title;
  $("#event-description").textContent = event.description;
  $("#event-effect").textContent = event.effectText;
  $("#event-icon").textContent = selection.symbol === "campfire" ? "♨" : "?";
  $("#resolve-event-btn").textContent = "继续前进";
  setScreen("event-screen");
}

function renderEnding() {
  if (!campaign || !["victory", "defeat"].includes(campaign.status)) return;
  $("#ending-screen").classList.remove("stage-two-pending");
  $("#ending-screen .eyebrow").textContent = `ACT 0${campaign.stageId} · RESULT`;
  const won = campaign.status === "victory";
  $("#ending-screen").classList.toggle("is-victory", won);
  $("#ending-screen").classList.toggle("is-defeat", !won);
  $("#ending-mark").textContent = won ? "★" : "…";
  $("#ending-title").textContent = won ? (campaign.stageId === 2 ? "第二大关通关！" : "第一大关通关！") : "本局挑战结束";
  $("#ending-copy").textContent = won
    ? (campaign.stageId === 2 ? "你击败了波罗斯，完成了第二大关。" : "你战胜了遗迹首领，完成了第一大关。")
    : (STARTING_CHARACTERS.find((character) => character.id === campaign.playerId)?.name ?? "角色") + "倒下了，旅程止步于第 " + campaign.step + " 步。";
  $("#ending-count").textContent = "路线已走 " + campaign.history.length + " 步 · 完成战斗 " + campaign.completedBattles + " · 最终生命 " + campaign.playerHp + " / " + campaign.playerMaxHp;
  if (localStageTwoTest && campaign.devBattleOnly) {
    let returnLink = $("#dev-battle-return");
    if (!returnLink) {
      returnLink = document.createElement("a");
      returnLink.id = "dev-battle-return";
      returnLink.className = "primary-button";
      returnLink.href = "dev/stage2.html";
      returnLink.textContent = "返回本地测试入口";
      $("#ending-screen").append(returnLink);
    }
    returnLink.hidden = false;
  }
  setScreen("ending-screen");
}

function renderStageTwoPendingEnd() {
  $("#ending-screen").classList.remove("is-victory", "is-defeat");
  $("#ending-screen").classList.add("stage-two-pending");
  $("#ending-mark").textContent = "◇";
  $("#ending-title").textContent = "第二关终点待制作";
  $("#ending-copy").textContent = "本关 Boss、专属奇遇与终局结算尚未加入。当前队伍和已走路线已保留，可在后续版本继续扩展。";
  $("#ending-count").textContent = `累计探索 ${campaign.history.length} 个节点 · 完成战斗 ${campaign.completedBattles} 场`;
  setScreen("ending-screen");
}

function playRecruitScene(flow) {
  setScreen("stage-transition-screen");
  const hero = STARTING_CHARACTERS.find((entry) => entry.id === campaign.playerId);
  const candidates = flow.candidateIds.map((id) => STARTING_CHARACTERS.find((entry) => entry.id === id));
  $("#transition-hero img").src = hero?.asset ?? "";
  $("#transition-left img").src = candidates[0]?.asset ?? "";
  $("#transition-right img").src = candidates[1]?.asset ?? "";
  const scene = $("#stage-transition-screen");
  const choices = $("#transition-choices");
  choices.replaceChildren();
  scene.classList.remove("hero-arrived", "candidates-arrived");
  $("#transition-line").textContent = "";
  const runCycles = [];
  const startRecruitRun = (selector, character) => {
    const image = $(`${selector} img`);
    const frames = Object.values(character?.animations?.run?.frames ?? {});
    if (frames.length < 2) return;
    let index = 0;
    runCycles.push({ image, idle: character.asset, timer: window.setInterval(() => {
      if (campaign?.stageTransition !== flow || flow.phase !== "recruit") return;
      image.src = frames[index++ % frames.length];
    }, 125) });
  };
  const stopRecruitRun = (selector) => {
    const image = $(`${selector} img`);
    const cycle = runCycles.find((item) => item.image === image);
    if (cycle) { window.clearInterval(cycle.timer); image.src = cycle.idle; }
  };
  startRecruitRun("#transition-hero", hero);
  requestAnimationFrame(() => scene.classList.add("hero-arrived"));
  window.setTimeout(() => {
    if (campaign?.stageTransition !== flow || flow.phase !== "recruit") return;
    stopRecruitRun("#transition-hero");
    const line = "是一段艰辛的旅途...";
    let index = 0;
    const reveal = () => {
      if (campaign?.stageTransition !== flow || flow.phase !== "recruit") return;
      $("#transition-line").textContent = line.slice(0, ++index);
      if (index < line.length) window.setTimeout(reveal, 75);
      else window.setTimeout(() => {
        if (flow.phase !== "recruit") return;
        startRecruitRun("#transition-left", candidates[0]);
        startRecruitRun("#transition-right", candidates[1]);
        scene.classList.add("candidates-arrived");
        window.setTimeout(() => {
          if (flow.phase !== "recruit") return;
          stopRecruitRun("#transition-left");
          stopRecruitRun("#transition-right");
          const title = document.createElement("p");
          title.textContent = "选择你的伙伴";
          choices.append(title);
          for (const candidate of candidates.filter(Boolean)) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "control-btn";
            button.textContent = candidate.name;
            button.addEventListener("click", () => {
              if (!advanceStageTransition(campaign, candidate.id)) return;
              renderSquad();
              renderStageTransition();
            });
            choices.append(button);
          }
        }, 750);
      }, 300);
    };
    reveal();
  }, 950);
}

function renderStageTransition() {
  if (campaign?.status !== "stage_transition") return;
  const flow = campaign.stageTransition;
  const phase = getStageTransitionChoices(campaign);
  if (phase.phase === "recruit") return playRecruitScene(flow);
  if (phase.phase === "interlude") {
    setScreen("stage-interlude-screen");
    const line = "落叶捎来讯息，前方是未知之地";
    let index = 0;
    const reveal = () => {
      if (campaign?.status !== "stage_transition" || flow.phase !== "interlude") return;
      $("#stage-interlude-line").textContent = line.slice(0, ++index);
      if (index < line.length) window.setTimeout(reveal, 95);
      else window.setTimeout(() => {
        if (beginStageTwo(campaign)) {
          renderSquad();
          renderRoute();
        }
      }, 1100);
    };
    reveal();
    return;
  }
  if (phase.phase === "hero_skill") {
    const skill = SKILL_DATA[phase.passiveId];
    const levelTwoDescription = phase.passiveId === "jinchuriki"
      ? "当前 HP 严格低于最大 HP 的 50% 时，战斗中 ATK +30%，吸血 +5%。"
      : phase.passiveId === "eren-2000-years"
        ? "每场战斗免疫前两次受到的攻击，最大 HP 一次性 +100。"
        : phase.passiveId === "kaneki-one-eye"
          ? "暴击时按最终计算伤害的 40% 恢复 HP，暴击率 +10 个百分点。"
          : skill?.description ?? "升级角色被动技能。";
    renderDecisionScreen("主角被动升级", `第一关通关奖励 · ${skill?.name ?? "被动技能"} 升至 Lv.2`, [
      decisionChoice("upgrade_passive", `${skill?.name ?? "被动技能"} Lv.2`, levelTwoDescription),
    ], "确认升级", () => { if (!advanceStageTransition(campaign, "upgrade_passive")) return false; updateProgressionDisplays(); renderStageTransition(); return true; }, "ACT 01 · CLEAR REWARD");
    return;
  }
  if (phase.phase === "partner_upgrade" && !phase.skillIds.length) {
    advanceStageTransition(campaign);
    return renderStageTransition();
  }
  const partner = STARTING_CHARACTERS.find((entry) => entry.id === phase.partnerId);
  const owner = phase.phase.startsWith("partner") ? partner?.name ?? "伙伴" : "主角";
  if (phase.phase.endsWith("skill") || phase.phase === "partner_upgrade") {
    const skillIds = phase.phase === "partner_skill" ? phase.skillIds : phase.skillIds;
    const state = phase.phase.startsWith("partner") ? campaign.partyStates[phase.partnerId] : campaign.runCharacterState;
    const choices = skillIds.map((id) => {
      const config = SKILL_DATA[id];
      const current = state.skillLevels[id] ?? 0;
      const level = phase.phase === "partner_skill" ? 1 : current + 1;
      return decisionChoice(id, `${config.name} · Lv.${level}`, `${config.description} ${displaySkillEffect({ ...config, ...config.levels[level] })}`);
    });
    renderDecisionScreen(`${owner}${phase.phase === "partner_skill" ? "选择初始技能" : "技能升级"}`, `第一关通关培养 · 剩余 ${phase.remaining ?? 1} 次`, choices,
      "确认", (id) => { if (!advanceStageTransition(campaign, id)) return false; renderStageTransition(); return true; }, "ACT 01 · CLEAR REWARD");
    return;
  }
  if (phase.phase === "hero_stat" || phase.phase === "partner_stat") {
    const choices = phase.offer.choices.map((id) => {
      const upgrade = ATTRIBUTE_UPGRADES.find((entry) => entry.id === id);
      return decisionChoice(id, upgrade?.name ?? id, upgrade?.description ?? "属性强化");
    });
    renderDecisionScreen(`${owner}属性强化`, `剩余 ${phase.remaining} 次，仅作用于${owner}。`, choices, "应用强化",
      (id) => { if (!advanceStageTransition(campaign, id)) return false; updateProgressionDisplays(); renderStageTransition(); return true; }, "ACT 01 · CLEAR REWARD");
  }
}

function renderSquad() {
  if (!campaign) return;
  const panel = document.querySelector(".squad-panel");
  if (!panel) return;
  const inCombat = campaign.status === "combat";
  if (!inCombat) squadSide = "ally";
  for (const tab of panel.querySelectorAll(".squad-tab")) {
    tab.disabled = !inCombat && tab.dataset.squadSide === "enemy";
    tab.classList.toggle("is-active", tab.dataset.squadSide === squadSide);
    tab.setAttribute("aria-selected", String(tab.dataset.squadSide === squadSide));
    tab.onclick = () => { if (!tab.disabled) { squadSide = tab.dataset.squadSide; renderSquad(); } };
  }
  const enemies = inCombat ? viewState.characters.filter((unit) => unit.team === "enemy") : [];
  panel.querySelector(".reserve-heading span").textContent = squadSide === "enemy" ? `${enemies.length} 名敌人` : `${campaign.partyIds.length} / 4`;
  const slots = panel.querySelector(".squad-slots");
  slots.replaceChildren();
  slots.classList.toggle("is-enemy-view", squadSide === "enemy");
  if (squadSide === "enemy") {
    for (const enemy of enemies) {
      const card = document.createElement("div");
      card.className = `enemy-squad-card${enemy.alive ? "" : " is-dead"}`;
      const phase = enemy.borosPhase ? ` · 阶段 ${enemy.borosPhase}` : "";
      card.innerHTML = `<b></b><span></span><span></span>`;
      card.querySelector("b").textContent = `${enemy.name}${phase}`;
      const lines = card.querySelectorAll("span");
      lines[0].textContent = `HP ${enemy.currentHp}/${enemy.maxHp}`;
      lines[1].textContent = `ATK ${enemy.atk} · DEF ${enemy.def} · SPD ${enemy.spd}`;
      slots.append(card);
    }
    return;
  }
  for (const id of campaign.partyIds) {
    const character = STARTING_CHARACTERS.find((entry) => entry.id === id);
    if (!character) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "squad-slot active-slot";
    button.dataset.characterDetail = id;
    button.innerHTML = `<img src="${character.asset}" alt=""><span>${character.name}</span><span class="slot-hint">查看</span>`;
    button.addEventListener("click", () => openCharacterDetail(id));
    slots.append(button);
  }
  for (let index = campaign.partyIds.length; index < 4; index++) {
    const empty = document.createElement("div");
    empty.className = "squad-slot empty-slot";
    empty.innerHTML = "<b>＋</b><span>预留</span>";
    slots.append(empty);
  }
}

function renderStartingSkillSelection(character) {
  const skills = (character.activeSkills ?? []).map((id) => {
    const config = SKILL_DATA[id];
    const effect = config?.levels?.[1] ?? {};
    return decisionChoice(id, `${config?.name ?? id} · Lv.1`, `${config?.description ?? "主动技能"} ${displaySkillEffect({ ...config, ...effect })}`);
  });
  if (!skills.length) {
    campaign.startingSkillSelected = true;
    beginJourney(campaign);
    renderRoute();
    return;
  }
  renderDecisionScreen("选择一项初始主动技能", "被动技能会自动生效。确认后开始第一步探索。", skills, "学习技能并开始旅程", (skillId) => {
    if (!chooseStartingSkill(campaign, skillId)) return false;
    beginJourney(campaign);
    renderRoute();
    return true;
  }, "ACT 01 · FIRST SKILL");
}

function renderTreasureOffer() {
  const offer = getCampaignTreasureOffer(campaign);
  if (!offer) return false;
  const tierName = offer.tier === "royal" ? "王之财宝" : "小宝物";
  const choices = offer.choices.map((id) => {
    const treasure = TREASURE_DATA[id];
    return decisionChoice(id, treasure.name, `${treasure.description} 选择后指定一名队员领取。`, false, treasure.image);
  });
  renderDecisionScreen(`${tierName} · 选择宝物`, "随机展示两件不同的宝物，只能领取其中一件。", choices, "选择宝物", (treasureId) => {
    const treasure = TREASURE_DATA[treasureId];
    const recipients = campaign.partyIds.map((id) => {
      const character = STARTING_CHARACTERS.find((entry) => entry.id === id);
      return decisionChoice(id, character?.name ?? id, `领取「${treasure.name}」：${treasure.description}`);
    });
    const claim = (recipientId) => {
      const result = claimCampaignTreasure(campaign, treasureId, recipientId);
      if (!result) return false;
      updateProgressionDisplays();
      if (result.next === "stat") renderBattleReward();
      else renderEventResult({ result: { treasure: result.name, recipientId } });
      return true;
    };
    if (recipients.length === 1) return claim(recipients[0].id);
    renderDecisionScreen(`${treasure.name} · 指定领取者`, "这件宝物只授予一名队员。", recipients, "确认领取", claim, "ACT 02 · TREASURE");
    return true;
  }, "ACT 02 · TREASURE");
  return true;
}

function renderBattleReward() {
  if (!campaign || campaign.status !== "reward") return;
  if (campaign.rewardPhase === "treasure") return renderTreasureOffer();
  if (campaign.rewardPhase === "event_epilogue") {
    renderDecisionScreen("安定区", "街道逐渐暗了下来。白色的死神正在靠近…", [
      decisionChoice("__continue__", "继续", "查看战斗奖励。"),
    ], "继续", () => { if (!advanceEventEpilogue(campaign)) return false; renderBattleReward(); return true; }, "ACT 02 · ENCOUNTER", null, { darkScene: true });
    return;
  }
  if (campaign.rewardPhase === "special_recipient") {
    const record = campaign.runCharacterState.eventResults[campaign.eventBattleSourceId];
    const name = record?.data.specialRewardId === "drip_coffee" ? "挂耳咖啡" : "六耳真身";
    const description = record?.data.specialRewardId === "drip_coffee"
      ? "本局之后每次篝火回血额外增加最大 HP 的 15%；石鬼面持有者仍不能通过篝火回血。"
      : "本局普通攻击和主动技能攻击无法被敌人闪避。";
    const recipients = campaign.partyIds.map((id) => {
      const character = STARTING_CHARACTERS.find((entry) => entry.id === id);
      return decisionChoice(id, character?.name ?? id, "指定该角色领取。抽取和效果不会重复结算。");
    });
    renderDecisionScreen(`领取「${name}」`, description, recipients, "确认领取", (id) => {
      if (!claimCampaignSpecialReward(campaign, id)) return false;
      updateProgressionDisplays(); renderBattleReward(); return true;
    }, "ACT 02 · EVENT REWARD", record?.data.specialRewardId === "drip_coffee" ? "assets/events/drip_coffee.png" : "assets/events/six_ear_true_form.png");
    return;
  }
  const offer = getCampaignRewardOffer(campaign);
  if (!offer) return;
  if (campaign.rewardPhase === "giant_recipient") {
    const choices = campaign.partyIds.map((id) => {
      const character = STARTING_CHARACTERS.find((entry) => entry.id === id);
      return decisionChoice(id, character?.name ?? id, "领取巨人脊髓液：ATK +30、DEF +30、最大 HP +300");
    });
    renderDecisionScreen("选择巨人脊髓液领取者", "整份奖励仅授予一名队员，当前生命值不恢复。", choices,
      "领取奖励", (id) => {
        if (!claimStageTwoGiantRecipient(campaign, id)) return false;
        updateProgressionDisplays(); renderBattleReward(); return true;
      }, "ACT 02 · EVENT REWARD");
    return;
  }
  if (campaign.stageId === 2 && campaign.stageTwoReward) {
    if (campaign.rewardPhase === "stat") {
      const isPartnerTurn = offer.assignments.length > 0;
      const recipientId = isPartnerTurn ? campaign.partyIds.find((id) => id !== campaign.playerId) : campaign.playerId;
      const recipient = STARTING_CHARACTERS.find((item) => item.id === recipientId);
      const choices = offer.choices.map((statId) => {
        const upgrade = STAGE_TWO_STAT_UPGRADES.find((item) => item.id === statId);
        return decisionChoice(statId, upgrade.name, upgrade.description ?? `${upgrade.value > 0 ? "+" : ""}${upgrade.value}`,
          offer.assignments.some((item) => item.statId === statId));
      });
      renderDecisionScreen("第二关战后属性强化", isPartnerTurn ? `请选择伙伴${recipient?.name ?? ""}的奖励。` : `请先为主角${recipient?.name ?? ""}选择奖励。`, choices,
        "确认分配", (id) => {
          const result = claimStageTwoStatReward(campaign, recipientId, id);
          if (!result) return false;
          updateProgressionDisplays();
          if (result.phase === "complete") renderRoute(); else renderBattleReward();
          return true;
        }, "ACT 02 · BATTLE REWARD", null, { autoConfirm: true, portraitCards: true });
      return;
    }
    const recipientId = campaign.partyIds[offer.eliteAssignments?.length ?? 0];
    const recipient = STARTING_CHARACTERS.find((item) => item.id === recipientId);
    const choices = getSkillTrainingChoices(campaign.partyStates[recipientId]).map((skillId) => {
      const skill = getSkillAtLevel(campaign.partyStates[recipientId], skillId);
      return skill
        ? decisionChoice(skillId, `${skill.name} Lv.${skill.level + 1}`, displaySkillEffect({ ...skill, ...SKILL_DATA[skillId].levels[skill.level + 1] }))
        : decisionChoice(skillId, `学习 ${SKILL_DATA[skillId].name} Lv.1`, displaySkillEffect({ ...SKILL_DATA[skillId], ...SKILL_DATA[skillId].levels[1], level: 1 }));
    });
    if (!choices.length) choices.push(decisionChoice("__skip__", "主动技能均已满级", "继续为下一位结算。"));
    renderDecisionScreen(`${recipient?.name ?? "队员"} · 精英技能升级`, "每名队员各获得一次机会。", choices, "确认", (skillId) => {
      const result = skillId === "__skip__" ? claimStageTwoEliteSkip(campaign, recipientId) : claimStageTwoEliteSkill(campaign, recipientId, skillId);
      if (!result) return false;
      updateProgressionDisplays();
      if (result.phase === "complete") renderRoute(); else renderBattleReward();
      return true;
    }, "ACT 02 · ELITE REWARD");
    return;
  }
  if (campaign.rewardPhase === "stat") {
    const giantReward = campaign.eventBattleSourceId
      ? campaign.runCharacterState.eventResults[campaign.eventBattleSourceId]?.data.spinalFluidGranted
      : false;
    const choices = offer.statChoices.map((id) => {
      const upgrade = ATTRIBUTE_UPGRADES.find((entry) => entry.id === id);
      return decisionChoice(id, upgrade?.name ?? id, upgrade?.description ?? "属性强化");
    });
    renderDecisionScreen(giantReward ? "戴娜战胜利 · 巨人脊髓液" : campaign.rewardBattleType === "elite" ? "精英战胜利 · 属性加点" : "战斗胜利 · 属性加点", giantReward
      ? "已获得巨人脊髓液：本局 ATK +30、DEF +30、最大 HP +300（当前 HP 不治疗）。再从三个选项中选择两项属性强化。"
      : "从三个选项中选择两项强化，它们会影响后续战斗。", choices, "应用两项强化", (ids) => {
      const result = claimCampaignReward(campaign, ids);
      if (!result) return false;
      if (result.phase === "bonus") renderBattleReward();
      else {
        updateProgressionDisplays();
        renderRoute();
      }
      return true;
    }, "ACT 01 · BATTLE REWARD", giantReward ? GIANT_SPINAL_FLUID.image : null, { multiple: true, required: offer.requiredStatSelections ?? 2, autoConfirm: true, portraitCards: true });
    return;
  }

  if (campaign.rewardPhase === "bonus") {
    const skills = offer.upgradeableSkills.map((skillId) => {
      const current = getSkillAtLevel(campaign.runCharacterState, skillId);
      const next = SKILL_DATA[skillId].levels[(current?.level ?? 0) + 1];
      return current
        ? decisionChoice(skillId, `${current.name} · Lv.${current.level} → Lv.${current.level + 1}`, displaySkillEffect({ ...current, ...next }))
        : decisionChoice(skillId, `学习 ${SKILL_DATA[skillId].name} Lv.1`, displaySkillEffect({ ...SKILL_DATA[skillId], ...next, level: 1 }));
    });
    renderDecisionScreen("精英战胜利 · 技能升级", "属性加点已完成，选择升级技能；已学技能满级时可学习新技能。", skills, "确认", (skillId) => {
      const result = claimCampaignReward(campaign, "skill_upgrade", null, skillId);
      if (!result) return false;
      updateProgressionDisplays();
      renderRoute();
      return true;
    }, "ACT 01 · ELITE REWARD");
  }
}

function finishEventAndAdvance() {
  const next = completeLocation(campaign);
  updateProgressionDisplays();
  if (next === "route") renderRoute();
  else if (next === "combat") beginBattle();
  return next === "route" || next === "combat";
}

function renderEventResult(result) {
  const title = result?.result?.escape === "success" ? "逃跑成功"
    : campaign.activeEventType === "campfire" ? "篝火休整完成" : `${campaign.pendingEvent?.name ?? "奇遇"} · 已完成`;
  const eventId = campaign.pendingEvent?.eventId;
  const shared = campaign.stageId === 2 && campaign.pendingEvent?.data.sharedWith?.length;
  const teamDetail = shared ? eventId === "big_rock" ? "主角和伙伴下一场战斗均速度 -20。"
    : eventId === "coffee_shop" ? "主角和伙伴均获得相同的安定区效果。"
      : "本次正向属性收益同时作用于主角和伙伴；生命上限代价仅由主角承担。" : "";
  renderDecisionScreen(title, `${describeEventResult(result)}${teamDetail ? ` ${teamDetail}` : ""}`, [decisionChoice("__continue__", "继续前进", `前往第 ${campaign.step + 1} 步。`)], "继续前进", () => finishEventAndAdvance(), "ACT 01 · EVENT RESULT", campaign.pendingEvent?.image ?? null);
}

function resolveVisibleEvent(choiceId, skillId = null) {
  const result = resolveCampaignEvent(campaign, choiceId, skillId);
  if (!result) return false;
  updateProgressionDisplays();
  if (campaign.pendingEvent?.eventId === "kings_treasury" && result.result?.pendingBattle) {
    renderDecisionScreen("王之宝库", "此时，你听到一声利呵“杂修”，回头望去，一个耀眼的家伙坐在王座之上", [
      decisionChoice("__fight__", "迎战吉尔伽美什", "确认后进入战斗。"),
    ], "开始战斗", () => { if (!startCampaignEventBattle(campaign)) return false; beginBattle(); return true; }, "ACT 02 · ENCOUNTER", campaign.pendingEvent.image);
    return true;
  }
  if (campaign.pendingEvent?.eventId === "giant_encirclement") {
    const outcome = result.result;
    if (outcome?.pendingBattle) {
      if (outcome.escape === "failed") {
        renderDecisionScreen("逃跑失败", describeEventResult(outcome), [decisionChoice("__fight__", "迎战戴娜", "确认后进入战斗。")], "开始战斗", () => {
          if (!startCampaignEventBattle(campaign)) return false;
          beginBattle();
          return true;
        }, "ACT 01 · ENCOUNTER", campaign.pendingEvent.image);
      } else {
        if (!startCampaignEventBattle(campaign)) return false;
        beginBattle();
      }
      return true;
    }
    renderEventResult(result);
    return true;
  }
  if (!campaign.eventResolved) {
    renderAdventureEvent();
    return true;
  }
  if (campaign.activeEventType === "adventure" && ["sea_beyond", "sea_beyond_2", "old_scroll_2", "coffee_shop", "anteiku_2", "big_rock", "giant_rock_2", "death_note", "fate_gate", "kings_treasury"].includes(campaign.pendingEvent?.eventId)) {
    renderEventResult(result);
    return true;
  }
  return finishEventAndAdvance();
}

function renderCampfire() {
  if (campaign?.stageId === 2) {
    const members = getStageTwoCampfireOptions(campaign);
    if (!members) return;
    const healText = members.map(({ characterId, options }) => {
      const character = STARTING_CHARACTERS.find((item) => item.id === characterId);
      return options[0].blockedBy ? `${character.name}受石鬼面影响，无法通过篝火恢复` : `${character.name} +${options[0].healAmount} HP`;
    }).join("；");
    const canUpgrade = members.some(({ options }) => options[1].enabled);
    renderDecisionScreen("第二关篝火", "休息治疗全队，或每名队员分别获得一次技能训练机会。", [
      decisionChoice("rest", "全队休息", healText),
      decisionChoice("skill_upgrade", "全队技能升级", "每名符合条件的队员各升级一次。", !canUpgrade),
    ], "确认", (id) => {
      if (id === "rest") {
        const result = resolveStageTwoCampfire(campaign, "rest");
        if (!result) return false;
        updateProgressionDisplays(); renderEventResult({ result }); return true;
      }
      const eligible = members.filter(({ options }) => options[1].enabled);
      const selections = {};
      const chooseFor = (index) => {
        if (index >= eligible.length) {
          const result = resolveStageTwoCampfire(campaign, "skill_upgrade", selections);
          if (!result) return false;
          updateProgressionDisplays(); renderEventResult({ result }); return true;
        }
        const { characterId, options } = eligible[index];
        const character = STARTING_CHARACTERS.find((item) => item.id === characterId);
        renderDecisionScreen(`${character.name}技能升级`, "本次篝火每名队员最多训练一次。", options[1].skills.map((entry) =>
          decisionChoice(entry.skillId, entry.currentLevel ? `${entry.name} Lv.${entry.nextLevel}` : `学习 ${entry.name} Lv.1`, displaySkillEffect({ ...SKILL_DATA[entry.skillId], ...entry.nextEffect, level: entry.nextLevel }))),
        "确认升级", (skillId) => { selections[characterId] = skillId; return chooseFor(index + 1); }, "ACT 02 · CAMPFIRE");
        return true;
      };
      return chooseFor(0);
    }, "ACT 02 · CAMPFIRE");
    return;
  }
  const options = getActiveCampfireOptions(campaign);
  if (!options) return;
  const rest = options[0];
  const upgrade = options[1];
  renderDecisionScreen("篝火", "在此选择休息治疗，或训练一项主动技能。", [
    decisionChoice("rest", "休息治疗", rest.blockedBy ? "石鬼面阻止篝火回血。" : `恢复 ${rest.healAmount} HP（当前 ${campaign.runCharacterState.currentHp}/${campaign.runCharacterState.maxHp}）。`),
    decisionChoice("skill_upgrade", "技能升级", upgrade.enabled ? upgrade.skills.map((entry) => entry.currentLevel ? `${entry.name} Lv.${entry.currentLevel} → Lv.${entry.nextLevel}` : `学习 ${entry.name} Lv.1`).join("、") : upgrade.reason, !upgrade.enabled),
  ], "确认选择", (id) => {
    if (id === "rest") return resolveVisibleEvent("rest");
    if (id === "skill_upgrade") {
      const choices = upgrade.skills.map((entry) => decisionChoice(entry.skillId, entry.currentLevel ? `${entry.name} · Lv.${entry.currentLevel} → Lv.${entry.nextLevel}` : `学习 ${entry.name} Lv.1`, displaySkillEffect({ ...SKILL_DATA[entry.skillId], ...entry.nextEffect, level: entry.nextLevel })));
      renderDecisionScreen("选择升级技能", "已学技能满级后可学习新的主动技能。", choices, "确认", (skillId) => resolveVisibleEvent("skill_upgrade", skillId), "ACT 01 · CAMPFIRE");
      return true;
    }
    return false;
  }, "ACT 01 · CAMPFIRE");
}

function renderAdventureEvent() {
  const record = campaign?.pendingEvent;
  if (!record) return;
  if (record.eventId === "kings_treasury" && record.status === "awaiting_treasure") {
    renderTreasureOffer();
    return;
  }
  if (record.containsBattle) {
    if (record.eventId === "kings_treasury") {
      renderDecisionScreen(record.name, "此时，你听到一声利呵“杂修”，回头望去，一个耀眼的家伙坐在王座之上", [decisionChoice("start_battle", "迎战吉尔伽美什", "确认后进入战斗。")], "开始战斗", () => {
        if (!startCampaignEventBattle(campaign)) return false; beginBattle(); return true;
      }, "ACT 02 · ENCOUNTER", record.image);
      return;
    }
    if (record.eventId === "giant_encirclement") {
      renderDecisionScreen(record.data.choiceId === "giant_escape" ? "逃跑失败" : record.name,
        record.data.choiceId === "giant_escape" ? "逃跑失败！戴娜挡住了去路。" : "已决定迎战戴娜。",
        [decisionChoice("start_battle", "迎战戴娜", "确认后进入战斗。")], "开始战斗", () => {
          if (!startCampaignEventBattle(campaign)) return false;
          beginBattle(); return true;
        }, "ACT 01 · ENCOUNTER", record.image);
      return;
    }
    if (["anteiku_2", "giant_rock_2"].includes(record.eventId)) {
      const enemy = record.eventId === "anteiku_2" ? "铃屋什造" : "六耳猕猴";
      renderDecisionScreen(record.name, `${enemy}挡住了去路。`, [decisionChoice("start_battle", `迎战${enemy}`, "")], "开始战斗", () => {
        if (!startCampaignEventBattle(campaign)) return false;
        beginBattle(); return true;
      }, "ACT 02 · ENCOUNTER", record.image);
      return;
    }
    renderDecisionScreen(record.name, `${record.description} ${record.effectText}`, [decisionChoice("start_battle", "迎战精英", "战斗结果将使用当前属性和技能结算。")], "开始战斗", () => {
      const battle = startCampaignEventBattle(campaign);
      if (!battle) return false;
      beginBattle();
      return true;
    }, "ACT 01 · ENCOUNTER", record.image);
    return;
  }

  const choices = [];
  if (record.eventId === "kings_treasury") {
    choices.push(decisionChoice("treasury_leave", "转身离开", "不属于你的东西，最好还是放下。"));
    choices.push(decisionChoice("treasury_steal", "随手拿一件并偷偷溜走", ""));
    choices.push(decisionChoice("treasury_advance", "再往前走走", ""));
  } else if (record.eventId === "giant_encirclement") {
    choices.push(decisionChoice("giant_escape", "尝试逃跑", ""));
    choices.push(decisionChoice("giant_heart", "献出心脏吧！", ""));
  } else if (record.type === "learn_skill") {
    if (record.data.scrollPhase === "intro") {
      choices.push(decisionChoice("scroll_follow", "跟随老头前往妙蛙山", ""));
      choices.push(decisionChoice("scroll_leave", "看起来不像好人，溜了", ""));
    } else if (campaign.partyIds.length > 1 && !record.data.recipientId) {
      for (const id of campaign.partyIds) {
        const character = STARTING_CHARACTERS.find((entry) => entry.id === id);
        const available = campaign.partyStates[id].activeSkillPool.filter((skillId) => !campaign.partyStates[id].learnedActiveSkills.includes(skillId));
        if (available.length) choices.push(decisionChoice(`scroll_recipient|${id}`, `${character?.name ?? id}学习`, `可学习 ${available.length} 项主动技能。`));
      }
    } else {
    for (const id of record.data.skillChoices) {
      const config = SKILL_DATA[id];
      choices.push(decisionChoice(id, `${config.name} · Lv.1`, ""));
    }
    }
    if (record.data.scrollPhase !== "intro") choices.push(decisionChoice("scroll_leave", "看起来不像好人，溜了", ""));
  } else if (record.eventId === "sea_beyond") {
    const offers = getSeaBeyondOfferDetails(record);
    const statNames = { atk: "攻击", def: "防御", spd: "速度" };
    const offerText = (offer) => `第 ${offer.index + 1} 次：主角最大生命值 -${offer.hpLossPercent}%（-${offer.hpLoss}）；${campaign.partyIds.length > 1 ? "全队" : ""}${statNames[offer.rewardStat]} +${offer.rewardAmount}`;
    if (record.data.phase === "intro") {
      choices.push(decisionChoice("sea_begin", "是，我想看看海", "翻过城墙，继续向海的那边前进。接下来会连续面临选择。"));
      choices.push(decisionChoice("sea_pass", "还是留在墙内", "放弃这次探索，不承担代价。"));
    } else {
      const tierIndex = record.data.selectedTiers.length;
      choices.push(decisionChoice("sea_sacrifice", "继续前往海的另一边", offerText(offers[tierIndex])));
      choices.push(decisionChoice("sea_finish", tierIndex ? "就到这里，领取已积累的力量" : "算了，结束探索", tierIndex ? `确认之前 ${tierIndex} 次选择，并揭晓最终结果。` : "尚未承担代价，结束这次探索。"));
    }
  } else if (record.eventId === "sea_beyond_2") {
    choices.push(decisionChoice("sea_stay", "留在这里", ""));
    choices.push(decisionChoice("sea_home", "回到故乡", ""));
  } else if (record.eventId === "old_scroll_2") {
    if (record.data.awaitingRecipient) {
      for (const id of campaign.partyIds) {
        const character = STARTING_CHARACTERS.find((entry) => entry.id === id);
        choices.push(decisionChoice(`scroll_recipient|${id}`, character?.name ?? id, ""));
      }
    } else {
      choices.push(decisionChoice("scroll_mountain", "前往妙蛙山", ""));
      choices.push(decisionChoice("scroll_not_yet", "时候未到", ""));
      choices.push(decisionChoice("scroll_never", "不想再看到你这个老头了啦", ""));
    }
  } else if (record.eventId === "coffee_shop") {
    choices.push(decisionChoice("coffee_leave", "喝杯咖啡就离开吧", ""));
    choices.push(decisionChoice("coffee_help", "偶尔来这帮忙似乎也不错", ""));
  } else if (record.eventId === "anteiku_2") {
    choices.push(decisionChoice("anteiku_leave", "尊重店长，离开此地", ""));
    choices.push(decisionChoice("anteiku_fight", "兄弟，我来助你", ""));
  } else if (record.eventId === "big_rock") {
    choices.push(decisionChoice("rock_bypass", "绕路而行", ""));
    choices.push(decisionChoice("rock_move", "尝试搬动", ""));
  } else if (record.eventId === "giant_rock_2") {
    choices.push(decisionChoice("rock_avoid_again", "好奇心害死猫，反正咱也搬不动", ""));
    choices.push(decisionChoice("rock_fight", "相见即是缘，再搬搬看吧", ""));
  } else if (record.eventId === "death_note") {
    choices.push(decisionChoice("death_note_open", "打开笔记", "获得或承受一项持续两场战斗的效果；选择后会揭晓结果并显示在状态栏。"));
    choices.push(decisionChoice("death_note_pass", "路过", "不触碰笔记，继续前进。"));
  } else if (record.eventId === "fate_gate") choices.push(decisionChoice("fate_accept", "接受命运的指引", record.data.skillChoices.length ? record.effectText : "当前没有已学习且可触发的技能；确认后正常结束事件，不会生成无效效果。"));
  else choices.push(decisionChoice("__confirm__", "继续前进", record.effectText));
  // Event choices reveal outcomes only after selection; phase-two skill lists
  // are shown after the initial decision and still expose only names.
  if (record.eventId !== "sea_beyond") for (const choice of choices) choice.description = "";
  const eventDescription = record.eventId === "fate_gate"
    ? `${record.description} ${record.data.skillChoices.length ? record.effectText : "当前没有已学习且可触发的技能；确认后正常结束事件。"}`
    : record.eventId === "sea_beyond" && record.data.phase === "intro"
      ? `${record.description}\n${getSeaBeyondOfferDetails(record).map((offer) => `第 ${offer.index + 1} 次：主角最大生命值 -${offer.hpLossPercent}%（-${offer.hpLoss}）；${campaign.partyIds.length > 1 ? "全队" : ""}${({ atk: "攻击", def: "防御", spd: "速度" })[offer.rewardStat]} +${offer.rewardAmount}`).join("\n")}`
    : record.description;
  $("#decision-copy").classList.toggle("sea-offer-preview", record.eventId === "sea_beyond" && record.data.phase === "intro");
  renderDecisionScreen(record.name, eventDescription, choices, "确认选择", (id) => resolveVisibleEvent(id === "__confirm__" ? null : id), "ACT 01 · ADVENTURE", record.image);
}

function renderCampaignEvent() {
  if (!campaign || campaign.status !== "event") return;
  if (campaign.eventResolved) renderEventResult(campaign.activeNode?.resolutionResult);
  else if (campaign.activeEventType === "campfire") renderCampfire();
  else renderAdventureEvent();
}

function updateProgressionDisplays() {
  if (!campaign?.runCharacterState) return;
  campaign.playerHp = campaign.runCharacterState.currentHp;
  campaign.playerMaxHp = campaign.runCharacterState.maxHp;
  $("#route-health").textContent = `${campaign.playerHp} / ${campaign.playerMaxHp}`;
  renderSquad();
  renderAllyStatusIcons();
  if (characterDialog.open && detailCharacterId) openCharacterDetail(detailCharacterId);
}

function renderCandidateSelection() {
  if (!campaign || campaign.status !== "character-select") return;
  const container = $("#starter-candidates");
  container.innerHTML = "";
  for (const characterId of campaign.candidateIds ?? []) {
    const character = STARTING_CHARACTERS.find((entry) => entry.id === characterId);
    if (!character) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "starter-card" + (selectedCandidateId === character.id ? " selected" : "");
    card.dataset.candidateId = character.id;
    card.setAttribute("aria-pressed", String(selectedCandidateId === character.id));
    card.innerHTML = '<img src="' + character.asset + '" alt=""><b>' + character.name + '</b><span>' + character.role + '</span>';
    card.addEventListener("click", () => {
      selectedCandidateId = character.id;
      renderCandidateSelection();
    });
    container.append(card);
  }
  $("#confirm-character-btn").disabled = !selectedCandidateId;
  setScreen("character-select-screen");
}

function preloadEntryAssets(character) {
  const animationAssets = Object.values(character.animations ?? {}).flatMap((animation) => [
    animation.asset,
    ...Object.values(animation.frames ?? {}),
  ]);
  const assets = [...new Set([character.asset, ...animationAssets].filter((asset) => typeof asset === "string"))];
  return Promise.all(assets.map((src) => new Promise((resolve) => {
    const image = new Image();
    const ready = () => {
      if (typeof image.decode === "function") image.decode().catch(() => {}).then(resolve);
      else resolve();
    };
    image.onload = ready;
    image.onerror = resolve;
    image.src = src;
    if (image.complete) ready();
  })));
}

async function playEntryAnimation(character) {
  if (!campaign || campaign.status !== "entry") return;
  const animationToken = ++entryAnimationToken;
  await preloadEntryAssets(character);
  if (!campaign || campaign.status !== "entry" || animationToken !== entryAnimationToken) return;
  $("#entry-character-name").textContent = character.name;
  $("#entry-character-img").src = character.asset;
  $("#entry-character-img").alt = character.name;
  const actor = $("#entry-actor");
  actor.className = "entry-actor";
  actor.removeAttribute("data-pose");
  clearSpriteFrame(actor);
  void actor.offsetWidth;
  actor.classList.add("is-dropping");
  const fallFrames = animationFrameNames(character, "fall");
  const fallDurations = character.animations?.fall?.durationsMs;
  const fallDuration = fallFrames.length && Array.isArray(fallDurations)
    ? fallFrames.reduce((total, _, index) => total + (Number.isFinite(fallDurations[index]) ? fallDurations[index] : ANIMATION_TIMING.entryDropMs / fallFrames.length), 0)
    : ANIMATION_TIMING.entryDropMs;
  actor.style.setProperty("--entry-drop-duration", `${fallDuration}ms`);
  if (fallFrames.length) startFrameCycle(actor, character, "fall", fallFrames, ANIMATION_TIMING.entryDropMs / fallFrames.length, false);
  setScreen("entry-screen");
  const sequence = character.poseSequence ?? [{ state: "ready", caption: "准备就绪", duration: 750 }];
  let index = 0;
  const runPose = () => {
    if (index >= sequence.length) {
      if (animationToken !== entryAnimationToken) return;
        renderStartingSkillSelection(character);
      return;
    }
    const pose = sequence[index++];
    actor.classList.add("has-landed");
    actor.classList.remove("is-dropping");
    actor.style.removeProperty("--entry-drop-duration");
    actor.dataset.pose = pose.state;
    if (!showFighterFrame(actor, character, "pose", pose.state)) clearSpriteFrame(actor);
    actor.classList.remove("pose-change");
    void actor.offsetWidth;
    actor.classList.add("pose-change");
    entryTimer = window.setTimeout(runPose, pose.duration);
  };
  entryTimer = window.setTimeout(runPose, fallDuration);
}

function confirmStartingCharacter() {
  if (!campaign || campaign.status !== "character-select" || !selectedCandidateId) return;
  const character = selectStartingCharacter(campaign, selectedCandidateId, null);
  if (!character) return;
  $("#route-player-img").src = character.asset;
  $("#route-player-name").textContent = character.name;
  const squadButton = document.querySelector(".squad-slot.active-slot");
  if (squadButton) {
    squadButton.dataset.characterDetail = character.id;
    squadButton.setAttribute("aria-label", "查看" + character.name + "的属性和技能");
    squadButton.querySelector("img").src = character.asset;
    squadButton.querySelector("span:not(.slot-hint)").textContent = character.name;
  }
  const hero = $("#hero-fighter");
  hero.querySelector(".fighter-name").textContent = character.name;
  hero.querySelector(".sprite").src = character.asset;
  hero.dataset.character = character.id;
  playEntryAnimation(character);
}

function showCharacterSelectionForNewRun() {
  entryAnimationToken += 1;
  campaign = createCampaign();
  selectedCandidateId = null;
  startCampaign(campaign);
  renderCandidateSelection();
}

function playOpeningOnce() {
  window.clearTimeout(introTimer);
  window.clearTimeout(entryTimer);
  campaign = createCampaign();
  selectedCandidateId = null;
  const screen = $("#intro-screen");
  screen.classList.remove("opening-lights", "opening-city", "opening-redshift");
  setScreen("intro-screen");
  markOpeningPlayed();
  const { blackMs, warningMs, cityRevealMs, skyRedMs, transitionMs } = ANIMATION_TIMING.opening;
  const later = (delay, callback) => { introTimer = window.setTimeout(callback, delay); };
  later(blackMs, () => {
    screen.classList.add("opening-lights");
    later(warningMs, () => {
      screen.classList.add("opening-city");
      later(cityRevealMs, () => {
        screen.classList.add("opening-redshift");
        later(skyRedMs, () => {
          later(transitionMs, () => {
            if (!campaign || !startCampaign(campaign)) return;
            renderCandidateSelection();
          });
        });
      });
    });
  });
}

function initializeGame() {
  applyAnimationTiming();
  try {
    const url = new URL(window.location.href);
    if (!localStageTwoTest && url.searchParams.get("new") === "1") {
      localStorage.removeItem(RUN_SAVE_KEY);
      sessionStorage.removeItem(OPENING_SESSION_KEY);
      url.searchParams.delete("new");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    // A newly opened tab owns the current save. An older open tab must not
    // overwrite the new run with its previous in-memory campaign.
    localStorage.setItem(SAVE_OWNER_KEY, saveOwnerId);
    const saved = JSON.parse(localStorage.getItem(RUN_SAVE_KEY) || "null");
    if (saved?.campaign?.playerId && saved.version === 1) {
      campaign = saved.campaign;
      campaign.random = Math.random;
      campaign.partyStates ??= {};
      campaign.partyStates[campaign.playerId] = campaign.runCharacterState;
      if (campaign.activeNode?.id) campaign.activeNode = campaign.routeMap.nodes.find((node) => node.id === campaign.activeNode.id) ?? campaign.activeNode;
      // Older second-stage saves stopped on the placeholder end. Restore that
      // selection as an available Boss node instead of trapping the run there.
      if (campaign.stageId === 2 && campaign.status === "stage2_pending_end" && campaign.activeNode?.type === "demon") {
        const bossId = campaign.activeNode.id;
        campaign.activeNode.status = "pending";
        campaign.activeNode.resolution = null;
        campaign.routeMap.visitedEdges = campaign.routeMap.visitedEdges.filter((edge) => edge.to !== bossId);
        campaign.activeNode = null;
        campaign.status = "route";
      }
      campaign.routeOptions = (campaign.routeOptions ?? []).map((option) => campaign.routeMap.nodes.find((node) => node.id === option.id)).filter(Boolean);
      if (campaign.status === "combat") {
        campaign.combatLaunched = false;
        restoredBattle = saved.battle?.prepared ? saved.battle : null;
        beginBattle();
      } else if (campaign.status === "stage_transition") renderStageTransition();
      else if (campaign.status === "route") renderRoute();
      else if (campaign.status === "reward") renderBattleReward();
      else if (campaign.status === "event") renderCampaignEvent();
      else if (campaign.status === "stage2_pending_end") renderStageTwoPendingEnd();
      else if (campaign.status === "settlement") { completeSettlement(campaign); if (campaign.status === "stage_transition") renderStageTransition(); else renderEnding(); }
      else if (["victory", "defeat"].includes(campaign.status)) renderEnding();
      else if (campaign.status === "entry") renderStartingSkillSelection(STARTING_CHARACTERS.find((entry) => entry.id === campaign.playerId));
      else if (campaign.status === "character-select") renderCandidateSelection();
      else return showCharacterSelectionForNewRun();
      return;
    }
  } catch (error) {
    console.error("无法恢复本局进度", error);
    if (localStageTwoTest) {
      setScreen("battle-screen");
      setStatus("第二关测试加载失败", "finished");
      addLog(`第二关测试加载失败：${error.message}`, "log-death");
      return;
    }
  }
  if (hasOpeningPlayed()) showCharacterSelectionForNewRun();
  else playOpeningOnce();
}

function saveCampaign() {
  if (!campaign?.playerId || campaign.status === "intro") return;
  try {
    if (localStorage.getItem(SAVE_OWNER_KEY) !== saveOwnerId) return;
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify({ version: 1, campaign,
      battle: campaign.status === "combat" && lastPreparedBattle ? { prepared: lastPreparedBattle, result: pendingResult } : null }));
  } catch (error) { console.warn("无法保存本局进度", error); }
}
window.setInterval(saveCampaign, 400);
window.addEventListener("pagehide", saveCampaign);
window.addEventListener("pagehide", cancelEnemyEntrance);

function restartToCharacterSelection() {
  try { localStorage.removeItem(RUN_SAVE_KEY); } catch { /* storage may be unavailable */ }
  document.querySelectorAll(".fighter-partner").forEach((fighter) => fighter.remove());
  generation += 1;
  window.clearTimeout(timer);
  window.clearTimeout(effectTimer);
  window.clearTimeout(introTimer);
  window.clearTimeout(entryTimer);
  window.clearTimeout(attackTimer);
  window.clearTimeout(animationStageTimer);
  playback = null;
  pendingResult = null;
  lastPreparedBattle = null;
  restoredBattle = null;
  decisionHandler = null;
  selectedDecisionId = null;
  decisionBusy = false;
  decisionRevision += 1;
  fast = false;
  speedButton.classList.remove("is-active");
  $("#speed-label").textContent = "关";
  setBattleControls(false);
  setStatus("准备就绪");
  clearEffects();
  showCharacterSelectionForNewRun();
}

document.querySelectorAll("[data-character-detail]").forEach((button) => {
  button.addEventListener("click", () => openCharacterDetail(button.dataset.characterDetail));
});
const toggleStatusIcon = (event) => {
  const button = event.target.closest("[data-status-id]");
  if (!button) return;
  selectedStatusId = selectedStatusId === button.dataset.statusId ? null : button.dataset.statusId;
  renderAllyStatusIcons();
};
$("#ally-status-icons").addEventListener("click", toggleStatusIcon);
$("#enemy-status-icons").addEventListener("click", toggleStatusIcon);
$("#character-dialog-close").addEventListener("click", () => {
  if (typeof characterDialog.close === "function") characterDialog.close();
  else characterDialog.removeAttribute("open");
});
characterDialog.addEventListener("click", (event) => {
  if (event.target === characterDialog && typeof characterDialog.close === "function") characterDialog.close();
});
restartRunButton.addEventListener("click", restartToCharacterSelection);
$("#route-map-open").addEventListener("click", openRouteMap);
$("#route-map-close").addEventListener("click", () => $("#route-map-dialog").close());
logToggle.addEventListener("click", toggleBattleLog);
log.addEventListener("click", () => {
  if (playback) pauseForBattleLog();
  else { battleLogExpanded = !battleLogExpanded; updateBattleLogPanel(); }
});
$("#confirm-character-btn").addEventListener("click", confirmStartingCharacter);
$("#decision-confirm").addEventListener("click", confirmDecision);
speedButton.addEventListener("click", () => {
  if (!campaign || campaign.status !== "combat" || !playback || playbackPaused) return;
  fast = !fast;
  speedButton.classList.toggle("is-active", fast);
  $("#speed-label").textContent = fast ? "开" : "关";
});

const musicController = createMusicController(musicTracks, globalThis.Audio, (state) => {
  const picker = $("#music-track");
  const toggle = $("#music-toggle");
  picker.replaceChildren();
  for (const [index, track] of state.tracks.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = track.name;
    picker.append(option);
  }
  if (!state.available) picker.append(new Option("暂无音乐", ""));
  picker.disabled = !state.available;
  picker.value = state.available ? String(state.index) : "";
  toggle.disabled = !state.available;
  toggle.textContent = !state.available ? "暂无音乐" : state.playing ? "暂停" : "播放";
});
$("#music-toggle").addEventListener("click", () => {
  if (musicController.getState().playing) musicController.pause();
  else void musicController.play();
});
$("#music-track").addEventListener("change", (event) => {
  void musicController.select(Number(event.target.value));
});

setBattleControls(false);
initializeGame();
window.__pixelBattleReady = true;

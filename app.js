import { ANIMATION_TIMING, CHARACTER_DATA, COMBAT_RULES, STARTING_CHARACTERS } from "./characters.js";
import { beginJourney, chooseRoute, chooseStartingSkill, claimCampaignReward, completeLocation, completeSettlement, createCampaign, finishBattle, getActiveCampfireOptions, getCampaignRewardOffer, getRouteOptions, prepareBattle, resolveCampaignEvent, selectStartingCharacter, startCampaign, startCampaignEventBattle } from "./campaign.js";
import { getCritChance, getDodgeChance, getSkillDodgeChance, initializeBattle, simulateBattle } from "./battle.js";
import { getSkillAtLevel, getTemporaryCombatModifiers, getTemporaryEffectDisplayRows, getUnlearnedActiveSkills, getUpgradeableSkills } from "./progression.js";
import { ATTRIBUTE_UPGRADES, ELITE_BONUS_REWARDS, SKILL_DATA } from "./skills.js";

const $ = (selector) => document.querySelector(selector);
const log = $("#battle-log");
const statusLabel = $("#battle-status");
const speedButton = $("#speed-btn");
const restartRunButton = $("#restart-run-btn");
const characterDialog = $("#character-dialog");
let campaign = null;
let viewState = initializeBattle([]);
let playback = null;
let timer = null;
let effectTimer = null;
let generation = 0;
let fast = false;
let displayedEvents = 0;
let pendingResult = null;
let eventResultShown = false;
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
let runCycleTimer = null;
let targetHitTimer = null;
let openingSeenThisPage = false;
let detailCharacterId = null;
const OPENING_SESSION_KEY = "pixel-battle-opening-seen";

function decisionChoice(id, title, description, disabled = false) {
  return { id, title, description, disabled };
}

function renderDecisionScreen(title, description, choices, confirmText, onConfirm, kicker = "ACT 01 · GROWTH", image = null) {
  decisionRevision += 1;
  decisionBusy = false;
  selectedDecisionId = null;
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
  list.replaceChildren();
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
    button.append(name, detail);
    button.addEventListener("click", () => {
      if (decisionBusy || button.disabled) return;
      selectedDecisionId = choice.id;
      list.querySelectorAll(".decision-choice").forEach((candidate) => {
        candidate.classList.toggle("selected", candidate === button);
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      $("#decision-confirm").disabled = false;
    });
    list.append(button);
  }
  const confirm = $("#decision-confirm");
  confirm.textContent = confirmText;
  confirm.disabled = true;
  setScreen("decision-screen");
}

function confirmDecision() {
  if (decisionBusy || selectedDecisionId === null || typeof decisionHandler !== "function") return;
  decisionBusy = true;
  const revision = decisionRevision;
  const choiceId = selectedDecisionId;
  const ok = decisionHandler(choiceId);
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
  if (skill?.effectType === "buff") return `${chance} · 防御 +${skill.defenseBonus ?? 0}，持续 ${skill.durationTurns ?? 1} 回合`;
  if (skill?.id === "shadow-clone-rush") return `影分身 ${skill.cloneCount ?? skill.level ?? 1} 个 · 伤害倍率 ${skill.multiplier ?? 1}× · ${chance}`;
  if (skill?.id === "rasengan" || skill?.multiplierFormula) {
    const formula = skill.multiplierFormula;
    if (formula) {
      const spd = Number.isFinite(context.spd) ? context.spd : (Number.isFinite(skill.currentSpeed) ? skill.currentSpeed : null);
      const multiplier = spd === null ? null : formula.base + spd * formula.coefficient;
      const coefficient = Number(formula.coefficient).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      return `伤害倍率：1 + SPD × ${coefficient}（SPD 100 时与同级影分身倍率持平，超过 100 后更高）${multiplier === null ? "" : ` · 当前 SPD ${spd} → ${multiplier.toFixed(2)}×`} · ${chance}`;
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
    node.style.backgroundImage = `url("${frame}")`;
    node.style.backgroundSize = "100% 100%";
    node.style.backgroundPosition = "center";
    node.classList.add("active");
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
  if (!applySpriteFrame(fighter?.querySelector(".sprite-action"), character, animationName, frameName)) return false;
  fighter.classList.add("has-action-sprite");
  return true;
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

function clearSpriteFrame(actor) {
  if (!actor) return;
  actor.classList.remove("has-action-sprite");
  const frame = actor.querySelector(".sprite-action");
  if (!frame) return;
  frame.classList.remove("active");
  frame.style.removeProperty("background-image");
  frame.style.removeProperty("background-size");
  frame.style.removeProperty("background-position");
}

function stopRunCycle() {
  window.clearInterval(runCycleTimer);
  runCycleTimer = null;
}

function startRunCycle(fighter, character, frameDuration) {
  stopRunCycle();
  let showingA = false;
  const showNext = () => {
    showingA = !showingA;
    showFighterFrame(fighter, character, "run", showingA ? "run_a" : "run_b");
  };
  showNext();
  runCycleTimer = window.setInterval(showNext, Math.max(40, frameDuration));
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

function buildHealthRows(characters) {
  const allies = characters.filter((c) => c.team === "ally");
  const enemies = characters.filter((c) => c.team === "enemy");
  const render = (chars) => chars.map((c) => `<div class="health-row" data-health="${c.id}">
    <span class="health-name">${c.name}<small>${c.role}</small></span>
    <span class="health-track"><i class="health-fill ${c.team === "ally" ? "ally-fill" : "enemy-fill"}"></i></span>
    <span class="health-value"><b class="current-hp">${c.currentHp ?? c.hp}</b><small>/${c.maxHp ?? c.hp}</small></span>
  </div>`).join("");
  $("#health-bars").innerHTML = render(allies);
  $("#enemy-health-bars").innerHTML = render(enemies);
  for (const character of characters) {
    const fighter = character.team === "ally"
      ? document.querySelector("#hero-fighter")
      : document.querySelector('[data-character="' + character.id + '"]');
    if (!fighter) continue;
    fighter.dataset.character = character.id;
    fighter.dataset.team = character.team;
    fighter.dataset.row = character.row;
    fighter.hidden = false;
    fighter.classList.toggle("is-dead", !character.alive || character.currentHp <= 0);
    fighter.dataset.deathPose = character.deathPose || "default";
    fighter.querySelector(".fighter-name").textContent = character.name;
    fighter.querySelector(".sprite").src = character.asset;
    fighter.querySelector(".sprite").alt = `像素${character.name}`;
    clearSpriteFrame(fighter);
    fighter.querySelector(".position-tag").textContent = `${character.row === "front" ? "前排" : "后排"}${character.team === "ally" ? " · 战士" : ""}`;
  }
  for (const team of ["ally", "enemy"]) {
    for (const row of ["front", "back"]) {
      const group = characters.filter((character) => character.team === team && character.row === row);
      group.forEach((character, index) => {
        const fighter = document.querySelector(`[data-character="${character.id}"]`);
        if (fighter) fighter.style.setProperty("--formation-offset", `${(index - (group.length - 1) / 2) * 8}%`);
      });
    }
  }
  document.querySelectorAll(".fighter[data-character]").forEach((fighter) => {
    fighter.hidden = !characters.some((character) => character.id === fighter.dataset.character);
  });
}

function updateHealth(character) {
  const row = document.querySelector(`[data-health="${character.id}"]`);
  if (!row) return;
  row.querySelector(".current-hp").textContent = character.currentHp;
  row.querySelector(".health-fill").style.width = `${(character.currentHp / character.maxHp) * 100}%`;
  row.classList.toggle("is-dead", !character.alive);
  const fighter = character.team === "ally" ? document.querySelector("#hero-fighter") : document.querySelector(`[data-character="${character.id}"]`);
  fighter?.classList.toggle("is-dead", !character.alive);
}

function openCharacterDetail(characterId) {
  const character = [...STARTING_CHARACTERS, ...CHARACTER_DATA].find((entry) => entry.id === characterId);
  if (!character) return;

  const run = campaign?.playerId === characterId ? campaign.runCharacterState : null;
  detailCharacterId = characterId;
  const stats = run ? { ...run, critChance: run.critRate } : { currentHp: character.currentHp ?? character.hp, maxHp: character.maxHp ?? character.hp, atk: character.atk, def: character.def, spd: character.spd, critChance: character.critChance };
  const temporaryModifiers = run ? getTemporaryCombatModifiers(run) : { def: 0, spd: 0 };
  const effectiveStats = { ...stats, def: Math.max(0, stats.def + temporaryModifiers.def), spd: Math.max(0, stats.spd + temporaryModifiers.spd) };
  const rowName = character.row === "front" ? "前排" : "后排";
  const learned = run ? run.learnedActiveSkills.map((id) => getSkillAtLevel(run, id)).filter(Boolean) : character.skill ? [character.skill] : [];
  const skillMarkup = learned.length
    ? learned.map((skill) => '<div class="detail-skill-row"><div class="detail-skill-icon">技</div><div class="detail-skill-copy"><b>' + skill.name + ' · Lv.' + skill.level + '</b><p>' + (SKILL_DATA[skill.id]?.description ?? displaySkillEffect(skill)) + ' ' + displaySkillEffect({ ...skill, currentSpeed: effectiveStats.spd }) + '</p></div></div>').join("")
    : '<div class="detail-skill-row"><div class="detail-skill-icon quiet">—</div><div class="detail-skill-copy"><b>尚未选择主动技能</b><p>完成开局技能选择后参与战斗。</p></div></div>';
  const unlearned = run ? getUnlearnedActiveSkills(run) : [];
  const lockedMarkup = unlearned.map((id) => '<div class="detail-skill-row locked-skill"><div class="detail-skill-icon quiet">技</div><div class="detail-skill-copy"><b>' + SKILL_DATA[id].name + ' · 未学习</b><p>' + SKILL_DATA[id].description + '</p></div></div>').join("");
  const passive = SKILL_DATA[run?.passiveSkillId ?? character.passiveSkillId];
  const temporaryEffects = run ? getTemporaryEffectDisplayRows(run) : [];
  const temporaryEffectMarkup = temporaryEffects.length
    ? temporaryEffects.map((effect) => {
      return '<li class="temporary-effect is-' + effect.polarity + '"><b>' + effect.name + '</b><span>' + effect.statName + ' ' + effect.amountText + ' · ' + effect.durationText + '</span></li>';
    }).join("")
    : '<li class="temporary-effect-empty">暂无临时效果</li>';

  $("#character-detail").innerHTML =
    '<div class="detail-profile"><div class="detail-portrait"><img src="' + character.asset +
    '" alt="' + character.name + '"></div><div class="detail-name"><h3>' + character.name +
    '</h3><p>' + character.role + ' · ' + rowName + '</p><span class="detail-team ' +
    character.team + '">' + (character.team === "ally" ? "己方角色" : "敌方角色") +
    '</span></div></div>' +
    '<div class="detail-stats" aria-label="角色属性">' +
    '<div class="stat-card"><span>生命 HP</span><b>' + stats.currentHp + ' / ' + stats.maxHp + '</b></div>' +
    '<div class="stat-card"><span>攻击 ATK</span><b>' + stats.atk + '</b></div>' +
    '<div class="stat-card"><span>防御 DEF · 当前/基础</span><b>' + effectiveStats.def + (temporaryModifiers.def ? '<small>基础 ' + stats.def + ' · 临时 ' + (temporaryModifiers.def > 0 ? "+" : "") + temporaryModifiers.def + '</small>' : '') + '</b></div>' +
    '<div class="stat-card"><span>速度 SPD · 当前/基础</span><b>' + effectiveStats.spd + (temporaryModifiers.spd ? '<small>基础 ' + stats.spd + ' · 临时 ' + (temporaryModifiers.spd > 0 ? "+" : "") + temporaryModifiers.spd + '</small>' : '') + '</b></div>' +
    '<div class="stat-card"><span>闪避率</span><b>' + (getDodgeChance(effectiveStats) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>技能闪避率</span><b>' + (getSkillDodgeChance(effectiveStats) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>暴击率</span><b>' + (getCritChance(stats) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>暴击倍率</span><b>' + (stats.critMultiplier ?? COMBAT_RULES.critMultiplier).toFixed(1) + '×</b></div></div>' +
    '<section class="detail-skill"><h3>主动技能</h3>' + skillMarkup + lockedMarkup +
    '<div class="detail-skill-row"><div class="detail-skill-icon quiet">被</div><div class="detail-skill-copy"><b>' + (passive?.name ?? "暂无被动技能") + '</b><p>' + (passive?.description ?? "") + (passive?.id === "jinchuriki" ? " 战斗开始时判定一次，严格低于 50% HP 才触发。" : "") + '</p></div></div></section>' +
    (run ? '<section class="detail-temporary"><h3>临时效果</h3><ul>' + temporaryEffectMarkup + '</ul></section>' : "");

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
  while (log.children.length > 7) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
  displayedEvents += 1;
  $("#log-count").textContent = `${displayedEvents} 条记录`;
}

function setStatus(text, state = "") {
  statusLabel.textContent = text;
  statusLabel.parentElement.classList.toggle("is-fighting", state === "fighting");
  statusLabel.parentElement.classList.toggle("is-finished", state === "finished");
}

function setScreen(id) {
  document.querySelectorAll(".flow-screen").forEach((screen) => {
    screen.hidden = screen.id !== id;
  });
  updateBossProgress();
  window.scrollTo(0, 0);
}

function updateBossProgress() {
  const panel = $("#boss-distance");
  if (!panel) return;
  const visible = campaign && ["route", "event", "combat", "settlement"].includes(campaign.status);
  panel.hidden = !visible;
  if (!visible) return;
  const progress = Math.max(0, Math.min(1, campaign.step / 10));
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

function clearEffects() {
  window.clearTimeout(timer);
  window.clearTimeout(effectTimer);
  window.clearTimeout(attackTimer);
  window.clearTimeout(animationStageTimer);
  window.clearTimeout(targetHitTimer);
  window.clearInterval(runCycleTimer);
  timer = null;
  effectTimer = null;
  attackTimer = null;
  animationStageTimer = null;
  targetHitTimer = null;
  runCycleTimer = null;
  document.querySelectorAll(".fighter").forEach((fighter) => {
    fighter.classList.remove("is-attacking", "is-melee-rushing", "is-melee-running", "is-punching", "is-hit", "is-hit-stun", "is-hit-recoil", "is-casting", "is-dodging", "is-critical", "is-impact", "is-magic-attacking", "is-ranged-attacking");
    fighter.querySelector(".impact-burst")?.classList.remove("play");
    fighter.querySelector(".impact-burst")?.classList.remove("melee-impact", "melee-from-right");
    fighter.querySelector(".impact-burst")?.style.removeProperty("left");
    fighter.querySelector(".impact-burst")?.style.removeProperty("top");
    fighter.style.removeProperty("--melee-x");
    fighter.style.removeProperty("--attack-duration");
    fighter.style.removeProperty("--impact-duration");
    fighter.style.removeProperty("--skill-duration");
    fighter.style.removeProperty("--hit-duration");
    fighter.style.removeProperty("--hit-shake-duration");
    fighter.style.removeProperty("--dodge-duration");
    fighter.style.removeProperty("--impact-fx-duration");
    fighter.style.removeProperty("--death-duration");
    fighter.style.removeProperty("--formation-offset");
    clearSpriteFrame(fighter);
    const damage = fighter.querySelector(".damage-number");
    if (damage) {
      damage.textContent = "";
      damage.classList.remove("pop");
    }
  });
  $("#battle-stamp").className = "battle-stamp";
  $("#battle-stamp").textContent = "";
}

function playEvent(event, finish) {
  if (event.type === "c0-charge") {
    addLog(`<b>迪达拉</b> 的 C0 正在蓄积：已完成 ${event.completedRounds} 个完整行动回合，累计 ${event.accumulatedDamage} 点真实伤害。`, "log-enemy");
    return finish();
  }
  if (event.type === "c0-detonate") {
    const target = viewState.characters.find((character) => character.id === event.targetId);
    if (target) {
      target.currentHp = event.hpAfter;
      target.alive = event.hpAfter > 0;
      updateHealth(target);
    }
    $("#battle-stamp").textContent = "C0 引爆！";
    $("#battle-stamp").className = "battle-stamp skill-stamp show";
    addLog(`<b>迪达拉</b> 被击败，C0 引爆！造成 ${event.damage} 点真实伤害（${event.completedRounds} 个完整回合），玩家 HP ${event.hpBefore} → ${event.hpAfter}。`, "log-death");
    return finish();
  }
  if (event.type === "battle-end") {
    const win = event.outcome === "victory";
    const player = pendingResult.finalCharacters.find((character) => character.team === "ally");
    const transition = finishBattle(campaign, pendingResult.outcome, player.currentHp);
    updateProgressionDisplays();
    setStatus(win ? "战斗胜利" : "战斗失败", "finished");
    setBattleControls(false);
    $("#battle-stamp").textContent = win ? "胜利！" : "战斗失败";
    $("#battle-stamp").classList.add("show", win ? "stamp-win" : "stamp-lose");
    addLog(win ? `第 ${campaign.battleNumber} 场 · <b>胜利</b>` : `第 ${campaign.battleNumber} 场 · <b>战败，本局结束</b>`, win ? "log-win" : "log-death");
    const holdMs = fast ? ANIMATION_TIMING.attack.resultHoldMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.attack.resultHoldMs;
    timer = window.setTimeout(() => {
      if (!transition || !["settlement", "reward"].includes(transition.status)) return;
      playback = null;
      pendingResult = null;
      setBattleControls(false);
      if (transition.status === "reward") renderBattleReward();
      else {
        completeSettlement(campaign);
        renderEnding();
      }
    }, holdMs);
    return;
  }
  if (event.type === "skill") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    addLog(`<b>${actor?.name ?? "角色"}</b> 触发 <span class="skill-name">${event.skillName}</span>，防御提高 ${event.defenseBonus}。`, "log-skill");
    return finish();
  }
  if (event.type === "passive-trigger") {
    const actor = viewState.characters.find((character) => character.id === event.attackerId);
    addLog(`<b>${actor?.name ?? "角色"}</b> 被动 <span class="skill-name">${event.skillName}</span> 生效：ATK ${event.originalAtk} → ${event.effectiveAtk}（+25%）。`, "log-skill");
    return finish();
  }
  if (event.type !== "attack") return finish();
  const attacker = viewState.characters.find((c) => c.id === event.attackerId);
  const target = viewState.characters.find((c) => c.id === event.targetId);
  if (!attacker || !target) return finish();
  const sourceEl = document.querySelector(`[data-character="${attacker.id}"]`);
  const targetEl = document.querySelector(`[data-character="${target.id}"]`);
  if (!sourceEl || !targetEl) return finish();
  const sourceSide = attacker.team === "ally" ? "ally" : "enemy";
  const cloneText = event.skillId === "shadow-clone-rush" ? ` Lv.${event.skillLevel}（${event.skillCloneCount} 个分身，${event.skillMultiplier.toFixed(1)}×）` : "";
  const actionText = event.skilled ? `<span class="skill-name">${event.skillName}${cloneText}</span>` : "普通攻击";
  const resultText = event.dodged ? '<span class="dodge-text">闪避</span>' : `${event.critical ? '<b class="critical-text">暴击</b> ' : ""}<span class="damage-text">-${event.damage}</span>`;
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

  const isMelee = event.attackType === "melee";
  const actionTiming = isMelee ? timings.melee : event.attackType === "magic" ? timings.magic : timings.ranged;
  const actionDuration = isMelee
    ? actionTiming.rushMs + actionTiming.punchMs + actionTiming.recoveryMs
    : actionTiming.actionMs;
  const duration = scaled(actionDuration);
  const impactDelay = scaled(isMelee ? actionTiming.rushMs : Math.round(actionTiming.actionMs * 0.48));
  const eventGap = scaled(timings.eventGapMs);
  sourceEl.style.setProperty("--attack-duration", `${duration}ms`);
  sourceEl.style.setProperty("--impact-duration", `${scaled(isMelee ? actionTiming.punchMs : actionTiming.actionMs * 0.5)}ms`);
  if (isMelee) {
    startRunCycle(sourceEl, attacker, scaled(actionTiming.runFrameMs));
  }
  if (isMelee) {
    const sourceBox = sourceEl.getBoundingClientRect();
    const targetBox = targetEl.getBoundingClientRect();
    const delta = targetBox.left + targetBox.width / 2 - (sourceBox.left + sourceBox.width / 2);
    const stopGap = (sourceBox.width + targetBox.width) * 0.5;
    const lungeDistance = Math.max(0, Math.abs(delta) - stopGap);
    const lunge = Math.sign(delta) * lungeDistance;
    sourceEl.style.setProperty("--melee-x", `${lunge}px`);
    sourceEl.classList.add("is-melee-rushing", "is-melee-running");
  } else {
    sourceEl.classList.add("is-attacking", event.attackType === "magic" ? "is-magic-attacking" : "is-ranged-attacking");
  }

  attackTimer = window.setTimeout(() => {
    attackTimer = null;
    target.currentHp = event.targetHp;
    target.alive = event.targetHp > 0;
    if (isMelee) {
      sourceEl.classList.remove("is-melee-running");
      stopRunCycle();
      sourceEl.classList.add("is-punching");
      showFighterFrame(sourceEl, attacker, "meleeAttack", "punch");
      animationStageTimer = window.setTimeout(() => {
        sourceEl.classList.remove("is-punching");
        startRunCycle(sourceEl, attacker, scaled(actionTiming.runFrameMs));
        sourceEl.classList.add("is-melee-running");
        animationStageTimer = null;
      }, scaled(actionTiming.punchMs));
    }
    const damage = targetEl.querySelector(".damage-number");
    damage.textContent = event.dodged ? "闪避" : event.critical ? `暴击 -${event.damage}` : `-${event.damage}`;
    damage.style.setProperty("--damage-duration", `${Math.max(280, duration)}ms`);
    damage.classList.remove("pop");
    void damage.offsetWidth;
    damage.classList.add("pop");
    if (event.dodged) targetEl.classList.add("is-dodging");
    else {
      const stunned = Math.random() < 0.5;
      targetEl.classList.add("is-hit", "is-impact", stunned ? "is-hit-stun" : "is-hit-recoil");
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
    const extraEffectText = event.defenseReduced > 0 ? ` <span class="skill-name">DEF -${event.defenseReduced}</span>` : "";
    addLog(`<span class="round-label">R${event.round}</span> <b>${attacker.name}</b> ${actionText} → <b>${target.name}</b> ${resultText}${extraEffectText}`, event.skilled ? "log-skill" : sourceSide === "enemy" ? "log-enemy" : "");
    updateHealth(target);
    if (event.dodged) addLog(`<b>${target.name}</b> 闪开了攻击`, "log-dodge");
    if (event.targetDied) {
      window.clearTimeout(targetHitTimer);
      targetHitTimer = null;
      clearSpriteFrame(targetEl);
      targetEl.classList.remove("is-hit", "is-dodging", "is-critical", "is-impact");
      targetEl.classList.remove("is-hit-stun", "is-hit-recoil");
      targetEl.style.setProperty("--death-duration", `${scaled(timings.deathMs)}ms`);
      targetEl.classList.add("is-dead");
      addLog(`<b>${target.name}</b> 倒下了`, "log-death");
    } else if (!event.dodged) {
      window.clearTimeout(targetHitTimer);
      targetHitTimer = window.setTimeout(() => {
        clearSpriteFrame(targetEl);
        targetEl.classList.remove("is-hit", "is-impact", "is-critical", "is-hit-stun", "is-hit-recoil");
        targetHitTimer = null;
      }, scaled(380));
    }
  }, impactDelay);

  const delay = duration + eventGap;
  timer = window.setTimeout(() => {
    stopRunCycle();
    sourceEl.classList.remove("is-attacking", "is-melee-rushing", "is-melee-running", "is-punching", "is-casting", "is-magic-attacking", "is-ranged-attacking");
    targetEl.classList.remove("is-hit", "is-dodging", "is-critical", "is-impact", "is-hit-stun", "is-hit-recoil");
    sourceEl.style.removeProperty("--melee-x");
    sourceEl.style.removeProperty("--attack-duration");
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
    if (!event.targetDied) clearSpriteFrame(targetEl);
    if (event.attackType === "melee") sourceEl.classList.remove("is-casting");
    clearSpriteFrame(sourceEl);
    animationStageTimer = null;
    finish();
  }, delay);
}

function playNext(token) {
  if (token !== generation || !playback) return;
  if (playback.index >= playback.events.length) {
    playback = null;
    setBattleControls(false);
    return;
  }
  const event = playback.events[playback.index++];
  playEvent(event, () => playNext(token));
}

function beginBattle() {
  if (playback || !campaign || campaign.status !== "combat") return;
  const prepared = prepareBattle(campaign);
  if (!prepared) return;
  generation += 1;
  const token = generation;
  clearEffects();
  viewState = initializeBattle(prepared.roster);
  buildHealthRows(viewState.characters);
  $("#arena-location").textContent = prepared.battle.location;
  $("#boss-warning").hidden = prepared.battle.type !== "boss";
  const typeNames = { normal: "普通战", "normal-hard": "强化普通战", elite: "精英战", boss: "首领战" };
  $("#battle-stage-label").textContent = `第 ${prepared.battle.step} / 10 步 · ${typeNames[prepared.battle.type]}`;
  log.innerHTML = "";
  displayedEvents = 0;
  $("#log-count").textContent = "战斗进行中";
  addLog(`第 ${prepared.battle.number} 场开始：${prepared.battle.title}`, "log-start");
  if (prepared.battle.type === "boss") {
    addLog("迪达拉的 C0 每个完整行动回合积累 100 点真实伤害；C4 迦楼罗有 50% 概率造成 1.2 倍伤害并降低目标 DEF 20 点。", "log-enemy");
  }
  try {
    pendingResult = simulateBattle(prepared.roster, Math.random, prepared.combatOptions);
    playback = { ...pendingResult, index: 0 };
  } catch (error) {
    console.error("Battle initialization failed:", error);
    setStatus("战斗启动失败", "finished");
    addLog("战斗未能启动，请重新开始本局。", "log-death");
    return;
  }
  setScreen("battle-screen");
  setStatus("战斗中", "fighting");
  setBattleControls(true);
  playNext(token);
}

function renderRoute() {
  if (!campaign || campaign.status !== "route") return;
  const options = getRouteOptions(campaign);
  $("#route-progress").textContent = "第 " + campaign.step + " 步 / 10";
  $("#route-player-hp").textContent = `HP ${campaign.playerHp} / ${campaign.playerMaxHp}`;
  $("#route-health").textContent = `${campaign.playerHp} / ${campaign.playerMaxHp}`;
  const hero = STARTING_CHARACTERS.find((character) => character.id === campaign.playerId);
  $("#route-player-img").src = hero.asset;
  $("#route-player-name").textContent = hero.name;
  $(".route-player").dataset.characterDetail = hero.id;
  $(".route-player").setAttribute("aria-label", `查看${hero.name}的属性和技能`);
  updateBossProgress();
  const signs = $("#route-signs");
  signs.innerHTML = "";
  for (const node of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-sign route-" + node.type;
    button.disabled = node.status !== "pending";
    button.setAttribute("aria-label", ({ battle: "战斗", question: "未知地点", campfire: "篝火", demon: "首领" })[node.type]);
    const signImage = document.createElement("img");
    signImage.className = "route-sign-image";
    signImage.src = `assets/route-signs/${node.type}.png`;
    signImage.alt = "";
    signImage.setAttribute("aria-hidden", "true");
    button.append(signImage);
    button.addEventListener("click", () => {
      const selected = chooseRoute(campaign, node.id);
      if (!selected) return;
      if (selected.type === "event") {
        renderCampaignEvent();
      }
      else beginBattle();
    });
    signs.append(button);
  }
  setScreen("route-screen");
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
  const won = campaign.status === "victory";
  $("#ending-screen").classList.toggle("is-victory", won);
  $("#ending-screen").classList.toggle("is-defeat", !won);
  $("#ending-mark").textContent = won ? "★" : "…";
  $("#ending-title").textContent = won ? "第一大关通关！" : "本局挑战结束";
  $("#ending-copy").textContent = won
    ? "你战胜了遗迹首领，完成了第一大关。"
    : (STARTING_CHARACTERS.find((character) => character.id === campaign.playerId)?.name ?? "角色") + "倒下了，旅程止步于第 " + campaign.step + " 步。";
  $("#ending-count").textContent = "路线推进 " + Math.min(campaign.step, 10) + " / 10 · 完成战斗 " + campaign.completedBattles + " · 最终生命 " + campaign.playerHp + " / " + campaign.playerMaxHp;
  setScreen("ending-screen");
}

function renderStartingSkillSelection(character) {
  const skills = (character.activeSkills ?? []).map((id) => {
    const config = SKILL_DATA[id];
    const effect = config?.levels?.[1] ?? {};
    return decisionChoice(id, `${config?.name ?? id} · Lv.1`, `${config?.description ?? "主动技能"} ${displaySkillEffect({ ...config, ...effect })}`);
  });
  renderDecisionScreen("选择一项初始主动技能", "被动技能会自动生效。确认后开始第一步探索。", skills, "学习技能并开始旅程", (skillId) => {
    if (!chooseStartingSkill(campaign, skillId)) return false;
    beginJourney(campaign);
    renderRoute();
    return true;
  }, "ACT 01 · FIRST SKILL");
}

function renderBattleReward() {
  if (!campaign || campaign.status !== "reward") return;
  const offer = getCampaignRewardOffer(campaign);
  if (!offer) return;
  if (campaign.rewardPhase === "stat") {
    const choices = offer.statChoices.map((id) => {
      const upgrade = ATTRIBUTE_UPGRADES.find((entry) => entry.id === id);
      return decisionChoice(id, upgrade?.name ?? id, upgrade?.description ?? "属性强化");
    });
    renderDecisionScreen(campaign.rewardBattleType === "elite" ? "精英战胜利 · 属性强化" : "战斗胜利 · 属性强化", "选择一项强化，它会影响后续战斗。", choices, "应用强化", (id) => {
      const result = claimCampaignReward(campaign, id);
      if (!result) return false;
      if (result.phase === "bonus") renderBattleReward();
      else {
        updateProgressionDisplays();
        renderRoute();
      }
      return true;
    }, "ACT 01 · BATTLE REWARD");
    return;
  }

  if (campaign.rewardPhase === "bonus") {
    const choices = offer.extraChoices.map((id) => {
      if (id === "heal") return decisionChoice(id, "休整", `恢复最大生命的 15%（最多 ${Math.floor(campaign.runCharacterState.maxHp * 0.15)} HP）。`);
      const names = offer.upgradeableSkills.map((skillId) => {
        const current = getSkillAtLevel(campaign.runCharacterState, skillId);
        return `${current.name} Lv.${current.level} → Lv.${current.level + 1}`;
      }).join("、");
      return decisionChoice(id, "技能精进", names || "没有可升级技能，改为休整。", !offer.upgradeableSkills.length);
    });
    renderDecisionScreen("精英额外奖励", "属性强化已领取，再选择一项精英奖励。", choices, "选择额外奖励", (id) => {
      if (id === "skill_upgrade") {
        const skills = offer.upgradeableSkills.map((skillId) => {
          const current = getSkillAtLevel(campaign.runCharacterState, skillId);
          const next = SKILL_DATA[skillId].levels[current.level + 1];
          return decisionChoice(skillId, `${current.name} · Lv.${current.level} → Lv.${current.level + 1}`, displaySkillEffect({ ...current, ...next }));
        });
        renderDecisionScreen("选择升级技能", "技能效果按配置提升。", skills, "升级技能", (skillId) => {
          const result = claimCampaignReward(campaign, "skill_upgrade", null, skillId);
          if (!result) return false;
          updateProgressionDisplays();
          renderRoute();
          return true;
        }, "ACT 01 · ELITE REWARD");
        return true;
      }
      const result = claimCampaignReward(campaign, id);
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
  renderDecisionScreen(campaign.activeEventType === "campfire" ? "篝火休整完成" : `${campaign.pendingEvent?.name ?? "奇遇"} · 已完成`, describeEventResult(result), [decisionChoice("__continue__", "继续前进", `前往第 ${Math.min(10, campaign.step + 1)} 步。`)], "继续前进", () => finishEventAndAdvance(), "ACT 01 · EVENT RESULT");
}

function resolveVisibleEvent(choiceId, skillId = null) {
  const result = resolveCampaignEvent(campaign, choiceId, skillId);
  if (!result) return false;
  updateProgressionDisplays();
  return finishEventAndAdvance();
}

function renderCampfire() {
  const options = getActiveCampfireOptions(campaign);
  if (!options) return;
  const rest = options[0];
  const upgrade = options[1];
  renderDecisionScreen("篝火", "在此选择休息治疗，或升级一项已学习的主动技能。", [
    decisionChoice("rest", "休息治疗", `恢复 ${rest.healAmount} HP（当前 ${campaign.runCharacterState.currentHp}/${campaign.runCharacterState.maxHp}）。`),
    decisionChoice("skill_upgrade", "技能升级", upgrade.enabled ? upgrade.skills.map((entry) => `${entry.name} Lv.${entry.currentLevel} → Lv.${entry.nextLevel}`).join("、") : upgrade.reason, !upgrade.enabled),
  ], "确认选择", (id) => {
    if (id === "rest") return resolveVisibleEvent("rest");
    if (id === "skill_upgrade") {
      const choices = upgrade.skills.map((entry) => decisionChoice(entry.skillId, `${entry.name} · Lv.${entry.currentLevel} → Lv.${entry.nextLevel}`, displaySkillEffect({ ...entry.currentEffect, ...entry.nextEffect })));
      renderDecisionScreen("选择升级技能", "只列出已学习且未满级的主动技能。", choices, "升级技能", (skillId) => resolveVisibleEvent("skill_upgrade", skillId), "ACT 01 · CAMPFIRE");
      return true;
    }
    return false;
  }, "ACT 01 · CAMPFIRE");
}

function renderAdventureEvent() {
  const record = campaign?.pendingEvent;
  if (!record) return;
  if (record.containsBattle) {
    renderDecisionScreen(record.name, `${record.description} ${record.effectText}`, [decisionChoice("start_battle", "迎战精英", "战斗结果将使用当前属性和技能结算。")], "开始战斗", () => {
      const battle = startCampaignEventBattle(campaign);
      if (!battle) return false;
      beginBattle();
      return true;
    }, "ACT 01 · ENCOUNTER", record.image);
    return;
  }

  const choices = [];
  if (record.type === "learn_skill") {
    for (const id of record.data.skillChoices) {
      const config = SKILL_DATA[id];
      choices.push(decisionChoice(id, `${config.name} · Lv.1`, `${config.description} ${displaySkillEffect({ ...config, ...config.levels[1] })}`));
    }
  } else {
    choices.push(decisionChoice("__confirm__", "继续前进", record.effectText));
  }
  renderDecisionScreen(record.name, record.description, choices, "确认事件", (id) => resolveVisibleEvent(id === "__confirm__" ? null : id), "ACT 01 · ADVENTURE", record.image);
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
  $("#route-player-hp").textContent = `HP ${campaign.playerHp} / ${campaign.playerMaxHp}`;
  $("#route-health").textContent = `${campaign.playerHp} / ${campaign.playerMaxHp}`;
  if (characterDialog.open && detailCharacterId) openCharacterDetail(detailCharacterId);
}

function renderCandidateSelection() {
  if (!campaign || campaign.status !== "character-select") return;
  const container = $("#starter-candidates");
  container.innerHTML = "";
  for (const character of STARTING_CHARACTERS) {
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
  const frames = Object.values(character.animations?.pose?.frames ?? {});
  const assets = [...new Set([character.asset, ...frames].filter((asset) => typeof asset === "string"))];
  return Promise.all(assets.map((src) => new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
    if (image.complete) resolve();
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
  $("#entry-caption").textContent = "登场！";
  const actor = $("#entry-actor");
  actor.className = "entry-actor";
  actor.removeAttribute("data-pose");
  clearSpriteFrame(actor);
  void actor.offsetWidth;
  actor.classList.add("is-dropping");
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
    actor.dataset.pose = pose.state;
    if (!showFighterFrame(actor, character, "pose", pose.state)) clearSpriteFrame(actor);
    $("#entry-caption").textContent = pose.caption;
    actor.classList.remove("pose-change");
    void actor.offsetWidth;
    actor.classList.add("pose-change");
    entryTimer = window.setTimeout(runPose, pose.duration);
  };
  entryTimer = window.setTimeout(runPose, ANIMATION_TIMING.entryDropMs);
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
  hero.querySelector(".position-tag").textContent = character.row === "front" ? "前排" : "后排";
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
  if (hasOpeningPlayed()) showCharacterSelectionForNewRun();
  else playOpeningOnce();
}

function restartToCharacterSelection() {
  generation += 1;
  window.clearTimeout(timer);
  window.clearTimeout(effectTimer);
  window.clearTimeout(introTimer);
  window.clearTimeout(entryTimer);
  window.clearTimeout(attackTimer);
  window.clearTimeout(animationStageTimer);
  playback = null;
  pendingResult = null;
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
$("#character-dialog-close").addEventListener("click", () => {
  if (typeof characterDialog.close === "function") characterDialog.close();
  else characterDialog.removeAttribute("open");
});
characterDialog.addEventListener("click", (event) => {
  if (event.target === characterDialog && typeof characterDialog.close === "function") characterDialog.close();
});
restartRunButton.addEventListener("click", restartToCharacterSelection);
$("#confirm-character-btn").addEventListener("click", confirmStartingCharacter);
$("#decision-confirm").addEventListener("click", confirmDecision);
speedButton.addEventListener("click", () => {
  if (!campaign || campaign.status !== "combat" || !playback) return;
  fast = !fast;
  speedButton.classList.toggle("is-active", fast);
  $("#speed-label").textContent = fast ? "开" : "关";
});

setBattleControls(false);
initializeGame();
window.__pixelBattleReady = true;

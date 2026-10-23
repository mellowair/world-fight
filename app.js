import { ANIMATION_TIMING, CHARACTER_DATA, COMBAT_RULES, STARTING_CHARACTERS } from "./characters.js";
import { beginJourney, chooseRoute, completeLocation, completeSettlement, createCampaign, finishBattle, getRouteOptions, prepareBattle, resolveRouteEvent, selectStartingCharacter, startCampaign } from "./campaign.js";
import { getCritChance, getDodgeChance, getSkillDodgeChance, initializeBattle, simulateBattle } from "./battle.js";

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
let introTimer = null;
let entryTimer = null;
let attackTimer = null;
let animationStageTimer = null;
let runCycleTimer = null;
let targetHitTimer = null;
let openingSeenThisPage = false;
const OPENING_SESSION_KEY = "pixel-battle-opening-seen";

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

  const rowName = character.row === "front" ? "前排" : "后排";
  let skillMarkup;
  if (character.skill) {
    const chance = Math.round(character.skill.chance * 100);
    skillMarkup = '<div class="detail-skill-icon">技</div><div class="detail-skill-copy"><b>' +
      character.skill.name + '</b><p>每次行动有 ' + chance +
      '% 概率触发，本次攻击造成普通攻击基础伤害的 ' + character.skill.multiplier + ' 倍。</p></div>';
  } else {
    skillMarkup = '<div class="detail-skill-icon quiet">—</div><div class="detail-skill-copy"><b>暂无主动技能</b><p>该角色使用普通攻击参与战斗。</p></div>';
  }

  $("#character-detail").innerHTML =
    '<div class="detail-profile"><div class="detail-portrait"><img src="' + character.asset +
    '" alt="' + character.name + '"></div><div class="detail-name"><h3>' + character.name +
    '</h3><p>' + character.role + ' · ' + rowName + '</p><span class="detail-team ' +
    character.team + '">' + (character.team === "ally" ? "己方角色" : "敌方角色") +
    '</span></div></div>' +
    '<div class="detail-stats" aria-label="角色属性">' +
    '<div class="stat-card"><span>生命 HP</span><b>' + character.hp + '</b></div>' +
    '<div class="stat-card"><span>攻击 ATK</span><b>' + character.atk + '</b></div>' +
    '<div class="stat-card"><span>防御 DEF</span><b>' + character.def + '</b></div>' +
    '<div class="stat-card"><span>速度 SPD</span><b>' + character.spd + '</b></div>' +
    '<div class="stat-card"><span>闪避率</span><b>' + (getDodgeChance(character) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>技能闪避率</span><b>' + (getSkillDodgeChance(character) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>暴击率</span><b>' + (getCritChance(character) * 100).toFixed(1) + '%</b></div>' +
    '<div class="stat-card"><span>暴击倍率</span><b>' + COMBAT_RULES.critMultiplier.toFixed(1) + '×</b></div></div>' +
    '<section class="detail-skill"><h3>技能</h3><div class="detail-skill-row">' +
    skillMarkup + '</div></section>';

  if (typeof characterDialog.showModal === "function") characterDialog.showModal();
  else characterDialog.setAttribute("open", "");
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
  const party = $("#boss-distance-party");
  party.innerHTML = "";
  for (const partyId of campaign.partyIds ?? [campaign.playerId]) {
    const character = STARTING_CHARACTERS.find((entry) => entry.id === partyId);
    if (!character) continue;
    const portrait = document.createElement("img");
    portrait.src = character.asset;
    portrait.alt = character.name;
    portrait.className = "distance-portrait";
    party.append(portrait);
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
  if (event.type === "battle-end") {
    const win = event.outcome === "victory";
    const player = pendingResult.finalCharacters.find((character) => character.team === "ally");
    const transition = finishBattle(campaign, pendingResult.outcome, player.currentHp);
    setStatus(win ? "战斗胜利" : "战斗失败", "finished");
    setBattleControls(false);
    $("#battle-stamp").textContent = win ? "胜利！" : "战斗失败";
    $("#battle-stamp").classList.add("show", win ? "stamp-win" : "stamp-lose");
    addLog(win ? `第 ${campaign.battleNumber} 场 · <b>胜利</b>` : `第 ${campaign.battleNumber} 场 · <b>战败，本局结束</b>`, win ? "log-win" : "log-death");
    const holdMs = fast ? ANIMATION_TIMING.attack.resultHoldMs / ANIMATION_TIMING.attack.fastPlaybackMultiplier : ANIMATION_TIMING.attack.resultHoldMs;
    timer = window.setTimeout(() => {
      if (transition?.status !== "settlement") return;
      const nextState = completeSettlement(campaign);
      playback = null;
      pendingResult = null;
      setBattleControls(false);
      if (nextState === "route") renderRoute();
      else if (nextState === "combat") beginBattle();
      else renderEnding();
    }, holdMs);
    return;
  }
  if (event.type !== "attack") return finish();
  const attacker = viewState.characters.find((c) => c.id === event.attackerId);
  const target = viewState.characters.find((c) => c.id === event.targetId);
  if (!attacker || !target) return finish();
  const sourceEl = document.querySelector(`[data-character="${attacker.id}"]`);
  const targetEl = document.querySelector(`[data-character="${target.id}"]`);
  if (!sourceEl || !targetEl) return finish();
  const sourceSide = attacker.team === "ally" ? "ally" : "enemy";
  const actionText = event.skilled ? `<span class="skill-name">${event.skillName}</span>` : "普通攻击";
  const resultText = event.dodged ? '<span class="dodge-text">闪避</span>' : `${event.critical ? '<b class="critical-text">暴击</b> ' : ""}<span class="damage-text">-${event.damage}</span>`;
  const timings = ANIMATION_TIMING.attack;
  const playbackMultiplier = fast ? timings.fastPlaybackMultiplier : 1;
  const scaled = (ms) => Math.max(40, Math.round(ms / playbackMultiplier));
  sourceEl.style.setProperty("--skill-duration", `${scaled(560)}ms`);
  targetEl.style.setProperty("--hit-duration", `${scaled(380)}ms`);
  targetEl.style.setProperty("--hit-shake-duration", `${scaled(110)}ms`);
  targetEl.style.setProperty("--dodge-duration", `${scaled(300)}ms`);
  targetEl.style.setProperty("--impact-fx-duration", `${scaled(340)}ms`);
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
      if (stunned) showFighterFrame(targetEl, target, "hit", "hit_x");
      if (event.critical) targetEl.classList.add("is-critical");
      const burst = targetEl.querySelector(".impact-burst");
      burst?.classList.remove("play");
      if (burst) { void burst.offsetWidth; burst.classList.add("play"); }
    }
    addLog(`<span class="round-label">R${event.round}</span> <b>${attacker.name}</b> ${actionText} → <b>${target.name}</b> ${resultText}`, event.skilled ? "log-skill" : sourceSide === "enemy" ? "log-enemy" : "");
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
  const typeNames = { normal: "普通战", "normal-hard": "强化普通战", elite: "精英战", boss: "首领战" };
  $("#battle-stage-label").textContent = `第 ${prepared.battle.step} / 10 步 · ${typeNames[prepared.battle.type]}`;
  log.innerHTML = "";
  displayedEvents = 0;
  $("#log-count").textContent = "战斗进行中";
  addLog(`第 ${prepared.battle.number} 场开始：${prepared.battle.title}`, "log-start");
  try {
    pendingResult = simulateBattle(prepared.roster);
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
        renderEvent(selected);
        const result = resolveRouteEvent(campaign);
        if (!result) return;
        eventResultShown = true;
        $("#event-effect").textContent = result.result;
        $("#resolve-event-btn").textContent = "继续前进";
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
  $("#ending-mark").textContent = won ? "★" : "…";
  $("#ending-title").textContent = won ? "第一大关通关！" : "本局挑战结束";
  $("#ending-copy").textContent = won
    ? "你战胜了遗迹首领，完成了第一大关。"
    : (STARTING_CHARACTERS.find((character) => character.id === campaign.playerId)?.name ?? "角色") + "倒下了，旅程止步于第 " + campaign.step + " 步。";
  $("#ending-count").textContent = "路线推进 " + Math.min(campaign.step, 10) + " / 10 · 完成战斗 " + campaign.completedBattles + " · 最终生命 " + campaign.playerHp + " / " + campaign.playerMaxHp;
  setScreen("ending-screen");
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

function playEntryAnimation(character) {
  if (!campaign || campaign.status !== "entry") return;
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
      beginJourney(campaign);
      updateBossProgress();
      if (campaign.status === "route") renderRoute();
      else beginBattle();
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
  const character = selectStartingCharacter(campaign, selectedCandidateId);
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
$("#resolve-event-btn").addEventListener("click", () => {
  if (!eventResultShown) return;
  eventResultShown = false;
  const nextState = completeLocation(campaign);
  if (nextState === "route") renderRoute();
  else if (nextState === "combat") beginBattle();
});
speedButton.addEventListener("click", () => {
  if (!campaign || campaign.status !== "combat" || !playback) return;
  fast = !fast;
  speedButton.classList.toggle("is-active", fast);
  $("#speed-label").textContent = fast ? "开" : "关";
});

setBattleControls(false);
initializeGame();
window.__pixelBattleReady = true;

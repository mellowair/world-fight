// Centralized first-stage skill, growth, campfire, and encounter-event data.
// Level-one Naruto values preserve current combat behavior. Other starter entries are first-pass placeholders.
// Skill tuning can be replaced through this registry without scattering numbers into UI code.
export const SKILL_DATA = {
  "c4-garuda": {
    id: "c4-garuda", name: "C4 迦楼罗", type: "active", description: "造成 1.2 倍伤害；命中且目标存活时，目标 DEF 降低 20 点，持续本场战斗。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "boss", maxLevel: 1,
    levels: { 1: { chance: 0.5, multiplier: 1.2, effectType: "damage", attackType: "magic", defenseReduction: 20 } },
  },
  "shadow-clone-rush": {
    id: "shadow-clone-rush", name: "影分身突袭", type: "active", description: "触发时保留基础攻击，并由影分身各贡献 0.3 倍攻击力伤害。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.25, multiplier: 1.3, cloneCount: 1, effectType: "damage", attackType: "melee" },
      2: { chance: 0.30, multiplier: 1.6, cloneCount: 2, effectType: "damage", attackType: "melee" },
      3: { chance: 0.35, multiplier: 1.9, cloneCount: 3, effectType: "damage", attackType: "melee" },
      4: { chance: 0.40, multiplier: 2.2, cloneCount: 4, effectType: "damage", attackType: "melee", specialEffect: { kind: "clone_afterimage" } },
    },
  },
  rasengan: {
    id: "rasengan", name: "螺旋丸", type: "active", description: "伤害倍率随技能等级系数和战斗中的实际速度变化。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "scroll", maxLevel: 4,
    levels: {
      1: { chance: 0.20, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.003 }, effectType: "damage", attackType: "melee" },
      2: { chance: 0.24, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.006 }, effectType: "damage", attackType: "melee" },
      3: { chance: 0.28, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.009 }, effectType: "damage", attackType: "melee" },
      4: { chance: 0.32, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.012 }, effectType: "damage", attackType: "melee", specialEffect: { kind: "rasengan_burst" } },
    },
  },
  "ninja-instinct": {
    id: "ninja-instinct", name: "忍者直觉", type: "passive", description: "每场战斗首次受到伤害时减免 8%。",
    triggerType: "before_damage", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { oncePerBattle: true, damageReduction: 0.08 } },
  },
  jinchuriki: {
    id: "jinchuriki", name: "人柱力", type: "passive", description: "每场战斗开始时判定一次：若当前 HP 严格低于最大 HP 的 50%，本场 ATK +25%。",
    triggerType: "battle_start", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { currentHpRatioBelow: 0.5, attackBonus: 0.25, rounding: "floor" } },
  },
  "shield-bash": {
    id: "shield-bash", name: "盾击", type: "active", description: "用盾牌攻击当前优先目标。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.2, multiplier: 1.45, effectType: "damage", attackType: "melee" },
      2: { chance: 0.22, multiplier: 1.55, effectType: "damage", attackType: "melee" },
      3: { chance: 0.24, multiplier: 1.7, effectType: "damage", attackType: "melee" },
      4: { chance: 0.26, multiplier: 1.85, effectType: "damage", attackType: "melee", specialEffect: { kind: "guard_break" } },
    },
  },
  "guardian-stance": {
    id: "guardian-stance", name: "守护架势", type: "active", description: "短暂提高自身防御。",
    triggerType: "on_action", targetRule: "self", passive: false, unlockMethod: "scroll", maxLevel: 4,
    levels: {
      1: { chance: 0.16, effectType: "buff", defenseBonus: 12, durationTurns: 1 },
      2: { chance: 0.18, effectType: "buff", defenseBonus: 16, durationTurns: 1 },
      3: { chance: 0.2, effectType: "buff", defenseBonus: 21, durationTurns: 1 },
      4: { chance: 0.22, effectType: "buff", defenseBonus: 28, durationTurns: 1, specialEffect: { kind: "brace_next_hit" } },
    },
  },
  "steadfast-guard": {
    id: "steadfast-guard", name: "稳固守势", type: "passive", description: "每场战斗首次受到伤害时减免 8%。",
    triggerType: "before_damage", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { oncePerBattle: true, damageReduction: 0.08 } },
  },
  firebolt: {
    id: "firebolt", name: "火球术", type: "active", description: "发射火球造成单体魔法伤害。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.2, multiplier: 1.5, effectType: "damage", attackType: "magic" },
      2: { chance: 0.22, multiplier: 1.65, effectType: "damage", attackType: "magic" },
      3: { chance: 0.24, multiplier: 1.8, effectType: "damage", attackType: "magic" },
      4: { chance: 0.26, multiplier: 2.0, effectType: "damage", attackType: "magic", specialEffect: { kind: "ember_burst" } },
    },
  },
  "arcane-ward": {
    id: "arcane-ward", name: "奥术护幕", type: "active", description: "获得短暂防御增益。",
    triggerType: "on_action", targetRule: "self", passive: false, unlockMethod: "scroll", maxLevel: 4,
    levels: {
      1: { chance: 0.14, effectType: "buff", defenseBonus: 10, durationTurns: 1 },
      2: { chance: 0.16, effectType: "buff", defenseBonus: 14, durationTurns: 1 },
      3: { chance: 0.18, effectType: "buff", defenseBonus: 19, durationTurns: 1 },
      4: { chance: 0.2, effectType: "buff", defenseBonus: 25, durationTurns: 1, specialEffect: { kind: "ward_flash" } },
    },
  },
  "mana-spark": {
    id: "mana-spark", name: "魔力余辉", type: "passive", description: "每场战斗首次攻击时获得 5% 伤害加成。",
    triggerType: "before_attack", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { oncePerBattle: true, damageBonus: 0.05 } },
  },
};

export const ATTRIBUTE_UPGRADES = [
  { id: "max_hp", name: "强健", description: "最大 HP +100。", effects: { maxHp: 100 } },
  { id: "attack", name: "猛攻", description: "ATK +10。", effects: { atk: 10 } },
  { id: "defense", name: "坚守", description: "DEF +10。", effects: { def: 10 } },
  { id: "speed", name: "迅捷", description: "SPD +10。", effects: { spd: 10 } },
];

export const CAMPFIRE_RULES = {
  rest: { id: "rest", name: "休息", healFraction: 0.2 },
  skillUpgrade: { id: "skill_upgrade", name: "技能升级" },
};

export const ADVENTURE_EVENT_DATA = {
  scroll: {
    id: "scroll", name: "神秘卷轴", type: "learn_skill", description: "遇到一个好色的白发老人，他给了你一份神秘的卷轴！",
    image: "assets/events/event_scroll_jiraiya.png", effectText: "解锁一个尚未学习的主动技能，初始 Lv.1。",
    containsBattle: false, providesReward: true, requiresChoice: true,
  },
  fall_rock: {
    id: "fall_rock", name: "酋长岩意外", type: "max_hp_loss", description: "你突然决定去酋长岩 free solo，不慎摔落……",
    image: "assets/events/event_fall_rock.png", effectText: "最大生命值上限降低 15%，当前生命不变（超过新上限时会受限）。",
    maxHpLossFraction: 0.15, containsBattle: false, providesReward: false, requiresChoice: false,
  },
  elite: {
    id: "elite", name: "精英挑战", type: "encounter", description: "糟糕！我被怪物包围了",
    image: "assets/events/event_ghost_elite.png", effectText: "进入精英战；胜利后获得普通强化和精英额外奖励。",
    battleType: "elite", containsBattle: true, providesReward: true, requiresChoice: false,
  },
  big_rock: {
    id: "big_rock", name: "巨石阻路", type: "temporary_debuff", description: "遇到一块巨大的石头，石头下似乎还有一丝奇怪的气息。",
    image: "assets/events/event_big_rock.png", effectText: "SPD -20，持续接下来的三场实际战斗。",
    effect: { stat: "spd", amount: -20, durationBattles: 3 }, containsBattle: false, providesReward: false, requiresChoice: false,
  },
  coffee_shop: {
    id: "coffee_shop", name: "安定屋咖啡店", type: "temporary_buff", description: "你来到了一家叫做安定屋的咖啡店。",
    image: "assets/events/event_coffee_shop.png", effectText: "下一场实际战斗 DEF +70，战斗结束后移除。",
    effect: { stat: "def", amount: 70, durationBattles: 1 }, containsBattle: false, providesReward: false, requiresChoice: false,
  },
};

export const ELITE_BONUS_REWARDS = [
  { id: "heal", name: "休整", healFraction: 0.15 },
  { id: "skill_upgrade", name: "技能精进" },
];


// Centralized first-stage skill, growth, campfire, and encounter-event data.
// Level-one Naruto values preserve current combat behavior. Other starter entries are first-pass placeholders.
// Skill tuning can be replaced through this registry without scattering numbers into UI code.
export const SKILL_DATA = {
  "kaneki-one-eye": {
    id: "kaneki-one-eye", name: "独眼", type: "passive", description: "每次暴击后，按本次造成的实际 HP 伤害恢复 10% 生命值。",
    triggerType: "after_critical_hit", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { healFromActualDamage: 0.1 } },
  },
  "kaneki-predator": {
    id: "kaneki-predator", name: "捕食者", type: "active", description: "以当前 ATK + SPD 攻击；目标 HP 严格低于技能阈值时，本次命中必定暴击。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.25, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.15, effectType: "damage", attackType: "melee" },
      2: { chance: 0.25, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.20, effectType: "damage", attackType: "melee" },
      3: { chance: 0.30, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.20, effectType: "damage", attackType: "melee" },
      4: { chance: 0.40, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.25, effectType: "damage", attackType: "melee" },
    },
  },
  "kaneki-1000-7": {
    id: "kaneki-1000-7", name: "1000-7", type: "active", description: "受伤后自动计数；达到当前等级所需次数时，本场暴击率与闪避率按百分点累加。",
    triggerType: "on_damage", targetRule: "self", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { hitsPerTrigger: 2, critRateBonus: 0.08, dodgeRateBonus: 0 },
      2: { hitsPerTrigger: 2, critRateBonus: 0.08, dodgeRateBonus: 0.04 },
      3: { hitsPerTrigger: 2, critRateBonus: 0.10, dodgeRateBonus: 0.07 },
      4: { hitsPerTrigger: 1, critRateBonus: 0.05, dodgeRateBonus: 0.05 },
    },
  },
  "c4-garuda": {
    id: "c4-garuda", name: "C4 迦楼罗", type: "active", description: "造成 1.2 倍伤害；命中且目标存活时，目标 DEF 降低 20 点，持续本场战斗。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "boss", maxLevel: 1,
    levels: { 1: { chance: 1, multiplier: 1.2, effectType: "damage", attackType: "magic", defenseReduction: 20, defenseFloor: -20 } },
  },
  "bomb-demon-boom": {
    id: "bomb-demon-boom", name: "Boom", type: "active", description: "30% 概率发动爆破，造成 1.8 倍攻击伤害。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "elite", maxLevel: 1,
    levels: { 1: { chance: 0.30, multiplier: 1.8, effectType: "damage", attackType: "ranged" } },
  },
  "mahito-domain": {
    id: "mahito-domain", name: "自闭圆顿裹", type: "passive", description: "HP 低于 50% 后触发；当回合 ATK +80，之后每个新回合 ATK 再 +80。",
    triggerType: "on_action", targetRule: "self", passive: true, unlockMethod: "elite", maxLevel: 1,
    levels: { 1: { currentHpRatioBelow: 0.5, attackBonusPerRound: 80 } },
  },
  "shadow-clone-rush": {
    id: "shadow-clone-rush", name: "影分身突袭", type: "active", description: "触发时保留基础攻击，并由影分身各贡献 0.3 倍攻击力伤害。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.45, multiplier: 1.3, cloneCount: 1, effectType: "damage", attackType: "melee" },
      2: { chance: 0.50, multiplier: 1.6, cloneCount: 2, effectType: "damage", attackType: "melee" },
      3: { chance: 0.55, multiplier: 1.9, cloneCount: 3, effectType: "damage", attackType: "melee" },
      4: { chance: 0.65, multiplier: 2.2, cloneCount: 4, effectType: "damage", attackType: "melee", specialEffect: { kind: "clone_afterimage" } },
    },
  },
  rasengan: {
    id: "rasengan", name: "螺旋丸", type: "active", description: "伤害倍率随技能等级系数和战斗中的实际速度变化。每次施放击杀敌人，本局 SPD +5（同次施放只生效一次）。",
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
    id: "jinchuriki", name: "人柱力", type: "passive", description: "战斗中当前 HP 首次低于最大 HP 的 50% 时，本场 ATK +25%。",
    triggerType: "before_attack", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { oncePerBattle: true, currentHpRatioBelow: 0.5, attackBonus: 0.25, rounding: "floor" } },
  },
  "eren-2000-years": {
    id: "eren-2000-years", name: "2000年后的你", type: "passive", description: "每场战斗首次受到攻击时免疫该次伤害。",
    triggerType: "before_damage", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { oncePerBattle: true, damageImmune: true } },
  },
  "eren-free-will": {
    id: "eren-free-will", name: "自由意志", type: "active", description: "触发时进行一次普通攻击，并获得持续本场战斗的 DEF 加成；多次触发可累积。每累计成功触发 3 次，恢复最大 HP 的 8%。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.50, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 10, stackDefenseBonus: true, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
      2: { chance: 0.55, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 15, stackDefenseBonus: true, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
      3: { chance: 0.60, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 20, stackDefenseBonus: true, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
      4: { chance: 0.70, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 25, stackDefenseBonus: true, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
    },
  },
  "eren-tatakae": {
    id: "eren-tatakae", name: "塔塔开", type: "active", description: "触发时以 ATK + 当前 DEF 作为攻击力并造成倍率伤害；艾伦下一次受到的伤害翻倍。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.30, multiplier: 1.3, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
      2: { chance: 0.35, multiplier: 1.4, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
      3: { chance: 0.40, multiplier: 1.55, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
      4: { chance: 0.50, multiplier: 1.7, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
    },
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
  rest: { id: "rest", name: "休息", healFraction: 0.25 },
  skillUpgrade: { id: "skill_upgrade", name: "技能升级" },
};

export const ADVENTURE_EVENT_DATA = {
  scroll: {
    id: "scroll", name: "神秘卷轴", type: "learn_skill", description: "遇到一个好色的白发老人，他给了你一份神秘的卷轴！",
    image: "assets/events/event_scroll_jiraiya.png", effectText: "跟随白发老人学习一项新技能，或选择离开。",
    containsBattle: false, providesReward: true, requiresChoice: true,
  },
  sea_beyond: { id: "sea_beyond", name: "海的那边……", type: "sea_choice", description: "围城里的你，渴望翻过矗立的城墙去看看海。", image: "assets/events/event_sea_beyond.png", effectText: "选择前往后，会连续决定承担多少次代价；结果在结束探索后揭晓。", containsBattle: false, providesReward: true, requiresChoice: true },
  death_note: { id: "death_note", name: "死亡笔记", type: "death_note", description: "一本散发着不祥气息的笔记本……要不要打开看看呢？", image: "assets/events/event_death_note.png", effectText: "打开后可能招来厄运，也可能获得力量；效果持续两场战斗，并显示在状态栏。", containsBattle: false, providesReward: true, requiresChoice: true },
  fate_gate: { id: "fate_gate", name: "命运石之门", type: "guaranteed_skill", description: "这一切都是命运石之门的选择！", image: "assets/events/event_fate_gate.png", effectText: "下一场战斗中随机强化一个已学习且可触发的技能，使其触发率提升至 100%。", containsBattle: false, providesReward: false, requiresChoice: true },
  fall_rock: {
    id: "fall_rock", name: "酋长岩意外", type: "max_hp_loss", description: "你突然决定去酋长岩 free solo，不慎摔落……",
    image: "assets/events/event_fall_rock.png", effectText: "最大生命值上限降低 5%，当前生命不变（超过新上限时会受限）。",
    maxHpLossFraction: 0.05, containsBattle: false, providesReward: false, requiresChoice: false,
    stages: [
      { maxHpLossFraction: 0.05 },
      { description: "再次来到酋长岩，在掉落的途中你领悟到了勇气的真谛", effectText: "最大生命值上限降低 5%，攻击力提高 15%。", maxHpLossFraction: 0.05, attackGainFraction: 0.15 },
      { description: "你终于登上了酋长岩，此刻你一览众山小", effectText: "暴击率提高 15 个百分点。", critRateGain: 0.15 },
    ],
  },
  big_rock: {
    id: "big_rock", name: "巨石阻路", type: "temporary_debuff", description: "遇到一块巨大的石头，石头下似乎还有一丝奇怪的气息。",
    image: "assets/events/event_big_rock.png", effectText: "SPD -40，持续接下来的三个实际战斗回合。",
    effect: { stat: "spd", amount: -40, durationRounds: 3 }, containsBattle: false, providesReward: false, requiresChoice: false,
  },
  coffee_shop: {
    id: "coffee_shop", name: "安定屋咖啡店", type: "temporary_buff", description: "你来到了一家叫做安定屋的咖啡店。",
    image: "assets/events/event_coffee_shop.png", effectText: "下一场实际战斗 DEF +50，战斗结束后移除。",
    effect: { stat: "def", amount: 50, durationBattles: 1 }, containsBattle: false, providesReward: false, requiresChoice: false,
  },
  giant_encirclement: {
    id: "giant_encirclement", name: "糟糕，被巨人包围了！", type: "giant_encirclement",
    description: "那一天，人类想起了被巨人支配的恐惧",
    image: "assets/events/event_giant_encirclement.png", effectText: "选择如何应对眼前的巨人。",
    containsBattle: false, providesReward: true, requiresChoice: true,
  },
};

export const GIANT_SPINAL_FLUID = Object.freeze({
  id: "giant_spinal_fluid", name: "巨人脊髓液", image: "assets/events/giant_spinal_fluid.png",
  atk: 30, def: 30, maxHp: 300,
});

export const ELITE_BONUS_REWARDS = [
  { id: "skill_upgrade", name: "技能精进" },
];


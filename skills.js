// Centralized first-stage skill, growth, campfire, and encounter-event data.
// Level-one Naruto values preserve current combat behavior. Other starter entries are first-pass placeholders.
// Skill tuning can be replaced through this registry without scattering numbers into UI code.
export const SKILL_DATA = {
  "reiner-sat-down": {
    id: "reiner-sat-down", name: "莱纳我坐了", type: "active",
    description: "50% 概率释放；下一个完整战斗回合受到的最终伤害减少 50%，重复释放只刷新持续时间。",
    triggerType: "on_action", targetRule: "self", maxLevel: 1,
    levels: { 1: { chance: 0.5, effectType: "next-round-reduction", reduction: 0.5 } },
  },
  "colossal-steam-wave": {
    id: "colossal-steam-wave", name: "蒸汽波", type: "passive",
    description: "每第 3 个全局回合开始，对所有存活玩家造成 400 点真实伤害，并对存活铠之巨人造成 100 点真实伤害。",
    maxLevel: 1, levels: { 1: {} },
  },
  "boros-meteor-burst": {
    id: "boros-meteor-burst", name: "流星爆发", type: "active", description: "阶段二每次行动释放；奇数次单体 1.3 倍，偶数次全体 0.7 倍。",
    triggerType: "on_action", targetRule: "alternating", maxLevel: 1,
    levels: { 1: { chance: 1, multiplier: 1.3, alternatingMultiplier: 0.7, effectType: "damage", attackType: "ranged" } },
  },
  "boros-collapsing-star": {
    id: "boros-collapsing-star", name: "崩星咆哮炮", type: "active", description: "阶段三每次行动对所有存活敌人分别造成 1.5 倍伤害。",
    triggerType: "on_action", targetRule: "all_living", maxLevel: 1,
    levels: { 1: { chance: 1, multiplier: 1.5, effectType: "damage", attackType: "ranged" } },
  },
  "bites-the-dust": {
    id: "bites-the-dust", name: "败者食尘", type: "active", description: "40% 概率将自身 HP 设为两完整回合前的快照，并使所有未爆炸炸弹提前一回合。",
    triggerType: "on_action", targetRule: "self", maxLevel: 1,
    levels: { 1: { chance: 0.40, effectType: "rewind" } },
  },
  "toji-heavenly-restriction": {
    id: "toji-heavenly-restriction", name: "天予咒缚", type: "passive", description: "行动时速度高于目标则连击；每次满足条件，连击段数递增。",
    maxLevel: 1, levels: { 1: {} },
  },
  "killer-queen": {
    id: "killer-queen", name: "杀手皇后", type: "passive", description: "每次造成有效伤害都附加一枚炸弹；经过三个后续完整回合后引爆。",
    maxLevel: 1, levels: { 1: {} },
  },
  "boros-cosmic-overlord": {
    id: "boros-cosmic-overlord", name: "宇宙霸主", type: "passive", description: "阶段一减伤、阶段二回合回血、阶段三强化攻击和速度。",
    maxLevel: 1, levels: { 1: {} },
  },
  "gilgamesh-enuma-elish": {
    id: "gilgamesh-enuma-elish", name: "天地乖离", type: "active", description: "每次行动释放，按成功释放次数循环四种效果。",
    triggerType: "on_action", targetRule: "front_priority_random", maxLevel: 1,
    levels: { 1: { chance: 1, multiplier: 1.3, effectType: "damage", attackType: "magic" } },
  },
  "kaneki-one-eye": {
    id: "kaneki-one-eye", name: "独眼", type: "passive", description: "每次造成正伤害的暴击后，按本次最终计算伤害恢复 25% 生命值（不受目标剩余 HP 截断影响）。",
    triggerType: "after_critical_hit", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 2,
    levels: { 1: { healFromCalculatedDamage: 0.25 }, 2: { healFromCalculatedDamage: 0.40, critRateBonus: 0.10 } },
  },
  "kaneki-predator": {
    id: "kaneki-predator", name: "捕食者", type: "active", description: "以当前 ATK + SPD 攻击；目标 HP 严格低于技能阈值时，本次命中必定暴击。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.50, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.25, effectType: "damage", attackType: "melee" },
      2: { chance: 0.55, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.30, effectType: "damage", attackType: "melee" },
      3: { chance: 0.55, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.40, effectType: "damage", attackType: "melee" },
      4: { chance: 0.60, multiplier: 1, attackFormula: "atk_plus_spd", guaranteedCritBelowHpRatio: 0.50, effectType: "damage", attackType: "melee", killMaxHpBonus: 50 },
    },
  },
  "kaneki-1000-7": {
    id: "kaneki-1000-7", name: "1000-7", type: "active", description: "受伤后自动计数；达到当前等级所需次数时，本场暴击率与攻击力累加，Lv.4 还增加闪避率。",
    triggerType: "on_damage", targetRule: "self", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { hitsPerTrigger: 2, critRateBonus: 0.07, attackBonus: 10, dodgeRateBonus: 0 },
      2: { hitsPerTrigger: 2, critRateBonus: 0.07, attackBonus: 20, dodgeRateBonus: 0 },
      3: { hitsPerTrigger: 2, critRateBonus: 0.14, attackBonus: 25, dodgeRateBonus: 0 },
      4: { hitsPerTrigger: 1, critRateBonus: 0.07, attackBonus: 15, dodgeRateBonus: 0.05 },
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
      4: { chance: 0.65, multiplier: 2.2, cloneCount: 4, effectType: "damage", attackType: "melee", splashRatio: 0.75, specialEffect: { kind: "clone_afterimage" } },
    },
  },
  rasengan: {
    id: "rasengan", name: "螺旋丸", type: "active", description: "伤害倍率随技能等级系数和战斗中的实际速度变化。每次施放击杀敌人，本局 SPD +5（同次施放只生效一次）。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "scroll", maxLevel: 4,
    levels: {
      1: { chance: 0.40, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.003 }, effectType: "damage", attackType: "melee" },
      2: { chance: 0.44, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.006 }, effectType: "damage", attackType: "melee" },
      3: { chance: 0.48, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.009 }, effectType: "damage", attackType: "melee" },
      4: { chance: 0.52, multiplierFormula: { base: 1, stat: "spd", coefficient: 0.012 }, effectType: "damage", attackType: "melee", specialEffect: { kind: "rasengan_burst" } },
    },
  },
  "ninja-instinct": {
    id: "ninja-instinct", name: "忍者直觉", type: "passive", description: "每场战斗首次受到伤害时减免 8%。",
    triggerType: "before_damage", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 1,
    levels: { 1: { oncePerBattle: true, damageReduction: 0.08 } },
  },
  jinchuriki: {
    id: "jinchuriki", name: "人柱力", type: "passive", description: "战斗中当前 HP 首次低于最大 HP 的 50% 时，本场 ATK +25%。",
    triggerType: "before_attack", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 2,
    levels: { 1: { oncePerBattle: true, currentHpRatioBelow: 0.5, attackBonus: 0.25, rounding: "floor" }, 2: { oncePerBattle: true, currentHpRatioBelow: 0.5, attackBonus: 0.30, lifesteal: 0.05, rounding: "floor" } },
  },
  "eren-2000-years": {
    id: "eren-2000-years", name: "2000年后的你", type: "passive", description: "每场战斗首次受到攻击时免疫该次伤害。",
    triggerType: "before_damage", targetRule: "self", passive: true, unlockMethod: "character_passive", maxLevel: 2,
    levels: { 1: { oncePerBattle: true, damageImmune: true, immuneHits: 1 }, 2: { oncePerBattle: true, damageImmune: true, immuneHits: 2, maxHpBonus: 100 } },
  },
  "eren-free-will": {
    id: "eren-free-will", name: "自由意志", type: "active", description: "触发时进行一次普通攻击，并获得持续本场战斗的 DEF 加成，最多叠加 3 次。每累计成功触发 3 次，恢复最大 HP 的 8%。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.50, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 10, stackDefenseBonus: true, maxDefenseStacks: 3, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
      2: { chance: 0.55, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 15, stackDefenseBonus: true, maxDefenseStacks: 3, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
      3: { chance: 0.60, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 20, stackDefenseBonus: true, maxDefenseStacks: 3, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08 },
      4: { chance: 0.70, multiplier: 1, effectType: "damage", normalAttack: true, defenseBonus: 25, stackDefenseBonus: true, maxDefenseStacks: 3, defenseDuration: "battle", healEveryTriggers: 3, healMaxHpFraction: 0.08, extraTrueDamageEvery: 5, extraTrueDamageDefRatio: 0.8 },
    },
  },
  "eren-tatakae": {
    id: "eren-tatakae", name: "塔塔开", type: "active", description: "触发时以 ATK + 当前 DEF 作为攻击力并造成倍率伤害；艾伦下一次受到的伤害翻倍。",
    triggerType: "on_action", targetRule: "front_priority_random", passive: false, unlockMethod: "character_choice", maxLevel: 4,
    levels: {
      1: { chance: 0.30, multiplier: 1.3, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
      2: { chance: 0.35, multiplier: 1.4, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
      3: { chance: 0.40, multiplier: 1.55, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true },
      4: { chance: 0.50, multiplier: 1.7, attackFormula: "atk_plus_current_def", effectType: "damage", doubleNextDamage: true, teamShield: 100 },
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
    id: "scroll", name: "老头的卷轴", type: "learn_skill", description: "遇到一个好色的白发老人，他给了你一份神秘的卷轴！",
    image: "assets/events/event_scroll_jiraiya.png", effectText: "跟随白发老人学习一项新技能，或选择离开。",
    containsBattle: false, providesReward: true, requiresChoice: true,
  },
  sea_beyond: { id: "sea_beyond", name: "海的那边……", type: "sea_choice", description: "围城里的你，渴望翻过矗立的城墙去看看海。", image: "assets/events/event_sea_beyond.png", effectText: "选择前往后，会连续决定承担多少次代价；结果在结束探索后揭晓。", containsBattle: false, providesReward: true, requiresChoice: true },
  sea_beyond_2: { id: "sea_beyond_2", name: "海的那边……", type: "sea_sequel", description: "你孤身一人来到海的那边，结果却与你想象中截然不同，你所仇恨在意的一切到底是什么呢？……海浪拍打着岸边，你望向远方，下定决心。", image: "assets/events/event_sea_beyond_2.png", effectText: "你将如何选择？", containsBattle: false, providesReward: true, requiresChoice: true },
  old_scroll_2: { id: "old_scroll_2", name: "老头的卷轴", type: "scroll_sequel", description: "又遇到这个老头了，似乎手里面还拿着一本什么天堂？……", image: "assets/events/event_old_scroll_2.png", effectText: "你将如何回应？", containsBattle: false, providesReward: true, requiresChoice: true },
  anteiku_2: { id: "anteiku_2", name: "安定区", type: "anteiku_sequel", description: "再次回来时，街区已经被封锁，年迈的店长告诉你，平静的日子已经一去不返。", image: "assets/events/event_anteiku_2.png", effectText: "你将如何选择？", containsBattle: false, providesReward: true, requiresChoice: true },
  giant_rock_2: { id: "giant_rock_2", name: "路遇巨石", type: "rock_sequel", description: "兜兜转转又是这块巨石，你听到了巨石下有窸窸窣窣的声音。", image: "assets/events/event_giant_rock_2.png", effectText: "你将如何选择？", containsBattle: false, providesReward: true, requiresChoice: true },
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
    id: "big_rock", name: "路遇巨石", type: "temporary_debuff", description: "一块硕大的石头挡住了你的去路。",
    image: "assets/events/event_big_rock.png", effectText: "选择如何通过。",
    effect: { stat: "spd", amount: -20, durationBattles: 1 }, containsBattle: false, providesReward: false, requiresChoice: true,
  },
  coffee_shop: {
    id: "coffee_shop", name: "安定区", type: "temporary_buff", description: "你走进一家咖啡店，空气中弥漫着浓郁的香气，一位老人微笑招呼你坐下，端上一杯热气腾腾的咖啡。",
    image: "assets/events/event_coffee_shop.png", effectText: "选择如何停留。",
    effect: { stat: "def", amount: 30, durationBattles: 1 }, containsBattle: false, providesReward: false, requiresChoice: true,
  },
  giant_encirclement: {
    id: "giant_encirclement", name: "糟糕，被巨人包围了！", type: "giant_encirclement",
    description: "那一天，人类想起了被巨人支配的恐惧",
    image: "assets/events/event_giant_encirclement.png", effectText: "选择如何应对眼前的巨人。",
    containsBattle: false, providesReward: true, requiresChoice: true,
  },
  kings_treasury: {
    id: "kings_treasury", name: "王之宝库", type: "treasure_choice",
    description: "你在探索途中发现了一扇金色的大门，门后堆满了黄金和珍异的宝物。",
    image: "assets/events/event_kings_treasury.png", effectText: "决定如何面对王之宝库。",
    containsBattle: false, providesReward: true, requiresChoice: true,
  },
};

export const GIANT_SPINAL_FLUID = Object.freeze({
  id: "giant_spinal_fluid", name: "巨人脊髓液", image: "assets/events/giant_spinal_fluid.png",
  atk: 30, def: 30, maxHp: 300,
});

// King's Treasury rewards are data only; their effects are applied by the
// existing run-character and battle-state rules.
export const TREASURE_DATA = Object.freeze({
  magic_conch: { id: "magic_conch", tier: "small", name: "神奇海螺", image: "assets/treasures/magic-conch.png", description: "本局可减免的战斗伤害减免 +5 个百分点。", damageReduction: 0.05 },
  sukuna_finger: { id: "sukuna_finger", tier: "small", name: "宿傩手指", image: "assets/treasures/sukuna-finger.png", description: "本局 ATK +50，最大 HP -200。", atk: 50, maxHp: -200 },
  odm_gear: { id: "odm_gear", tier: "small", name: "立体机动装置", image: "assets/treasures/odm-gear.png", description: "本局闪避率 +5 个百分点，暴击率 +5 个百分点。", dodgeRateBonus: 0.05, critRateBonus: 0.05 },
  angel_breath: { id: "angel_breath", tier: "royal", name: "大天使的气息", image: "assets/treasures/angel-breath.png", description: "立即回满 HP；此后每场战斗结束恢复最大 HP 的 10%。", battleEndHealRatio: 0.10 },
  stone_mask: { id: "stone_mask", tier: "royal", name: "石鬼面", image: "assets/treasures/stone-mask.png", description: "本局吸血 +25 个百分点，但无法通过篝火恢复 HP。", lifesteal: 0.25, blocksCampfireHeal: true },
  nichirin_blade: { id: "nichirin_blade", tier: "royal", name: "日轮刀", image: "assets/treasures/nichirin-blade.png", description: "普通攻击命中后，额外扣除目标攻击前当前 HP 的 5%，无视 DEF。", normalAttackCurrentHpRatio: 0.05 },
});

export const ELITE_BONUS_REWARDS = [
  { id: "skill_upgrade", name: "技能精进" },
];


// All balance values and lineup order live here.
export const CHARACTER_DATA = [
  {
    id: "naruto", name: "鸣人", team: "ally", role: "战士", row: "front", position: "front",
    hp: 1400, atk: 170, def: 65, spd: 85, baseStats: { maxHp: 1400, atk: 170, def: 65, spd: 85, critRate: 0.05, critMultiplier: 1.5 },
    activeSkills: ["shadow-clone-rush", "rasengan"], passiveSkillId: "jinchuriki", attackType: "melee",
    skillAnimationMap: { "shadow-clone-rush": "skill1_shadow_clone", rasengan: "skill2_rasengan" },
    skill: { id: "shadow-clone-rush", name: "影分身突袭", chance: 0.25, multiplier: 1.8, effectType: "damage", attackType: "melee" }, deathPose: "cute-flop",
    asset: "assets/naruto-v2/frames/idle.svg", rosterOrder: 0,
    animations: {
      idle: { type: "frames", frames: {
        idle: "assets/naruto-v2/frames/idle.svg",
      } },
      fall: { type: "static", asset: "assets/naruto-v2/frames/idle.svg" },
      pose: { type: "frames", frames: {
        landed: "assets/naruto-v2/frames/idle.svg",
        surprised: "assets/naruto-v2/frames/surprised.svg",
        scratch: "assets/naruto-v2/frames/hand_head.svg",
        smile: "assets/naruto-v2/frames/smile_thumbs_up.svg",
        "thumbs-up": "assets/naruto-v2/frames/smile_thumbs_up.svg",
      } },
      run: { type: "frames", frames: {
        run_a: "assets/naruto-v2/frames/run_a.svg",
        run_b: "assets/naruto-v2/frames/run_b.svg",
      } },
      meleeAttack: { type: "frames", frames: {
        ready: "assets/naruto-v2/frames/idle.svg",
        approach: "assets/naruto-v2/frames/run_a.svg",
        punch_1: "assets/naruto-v2/frames/punch.svg",
        recover: "assets/naruto-v2/frames/run_b.svg",
      } },
      hit: { type: "frames", frames: {
        hurt: "assets/naruto-v2/frames/hit_x.svg",
        dizzy: "assets/naruto-v2/frames/hit_x.svg",
        recover: "assets/naruto-v2/frames/idle.svg",
      } },
      skill1_shadow_clone: { type: "frames", frames: {
        skill1_1: "assets/naruto-v2/skills/skill1_1.png",
        skill1_2: "assets/naruto-v2/skills/skill1_2.png",
        skill1_3: "assets/naruto-v2/skills/skill1_3.png",
        skill1_4: "assets/naruto-v2/skills/skill1_4.png",
      }, durationsMs: [180, 180, 220, 260], loop: false },
      skill2_rasengan: { type: "frames", frames: {
        skill2_1: "assets/naruto-v2/skills/skill2_1.png",
        skill2_2: "assets/naruto-v2/skills/skill2_2.png",
        skill2_3: "assets/naruto-v2/skills/skill2_3.png",
        skill2_4: "assets/naruto-v2/skills/skill2_4.png",
      }, durationsMs: [160, 180, 200, 260], loop: false },
    },
  },
  {
    id: "guard", name: "守卫", team: "enemy", role: "守卫", row: "front", position: "front",
    hp: 500, atk: 60, def: 40, spd: 30, baseStats: { maxHp: 500, atk: 60, def: 40, spd: 30, critRate: 0.05, critMultiplier: 1.5 },
    activeSkills: ["shield-bash", "guardian-stance"], passiveSkillId: "steadfast-guard", skill: null, attackType: "melee", deathPose: "cute-flop",
    asset: "assets/guard.svg", rosterOrder: 1,
  },
  {
    id: "mage", name: "法师", team: "enemy", role: "法师", row: "back", position: "back",
    hp: 400, atk: 70, def: 20, spd: 30, baseStats: { maxHp: 400, atk: 70, def: 20, spd: 30, critRate: 0.05, critMultiplier: 1.5 },
    activeSkills: ["firebolt", "arcane-ward"], passiveSkillId: "mana-spark", skill: null, attackType: "magic", deathPose: "cute-flop",
    asset: "assets/mage.svg", rosterOrder: 2,
  },
];

const deidaraV2Frames = (folder, names) => Object.fromEntries(
  names.map((name) => [name, `assets/deidara-v2/${folder}/${name}.png`]),
);

// Boss-only art configuration. The guard template remains the data source; battle copies use this animation set.
export const DEIDARA_ANIMATIONS = {
  idle: { type: "frames", loop: true, frames: deidaraV2Frames("idle", ["idle_1"]) },
  run: { type: "frames", frames: { run_1: "assets/deidara-v2/idle/idle_1.png" } },
  meleeAttack: { type: "frames", frames: deidaraV2Frames("skill1", ["skill1_1", "skill1_2", "skill1_3", "skill1_4"]) },
  attack: { type: "frames", frames: deidaraV2Frames("skill1", ["skill1_1", "skill1_2", "skill1_3", "skill1_4"]) },
  hit: { type: "frames", frames: {
    hurt: "assets/deidara-v2/hit/hit_1.png",
    dizzy: "assets/deidara-v2/hit/hit_1.png",
  } },
  death: { type: "frames", frames: deidaraV2Frames("death", ["death_1"]) },
  spawn: { type: "frames", frames: { spawn_1: "assets/deidara-v2/idle/idle_1.png" } },
  victory: { type: "frames", frames: { victory_1: "assets/deidara-v2/idle/idle_1.png" } },
  skill1: { type: "frames", frames: deidaraV2Frames("skill1", ["skill1_1", "skill1_2", "skill1_3", "skill1_4"]) },
  skill2: { type: "frames", frames: deidaraV2Frames("skill2", ["skill2_1", "skill2_2", "skill2_3", "skill2_4"]) },
};

// Shared combat tuning. Keep evasion and critical parameters centralized.
export const COMBAT_RULES = {
  baseDodgeChance: 0.02,
  dodgePerSpeed: 0.03 / 80,
  maxDodgeChance: 0.15,
  skillDodgeChanceCap: 0.02,
  skillDodgeFactor: 0.2,
  baseCritChance: 0.05,
  maxCritChance: 0.5,
  critMultiplier: 1.5,
};

// Timings are defined once here; app.js passes them to CSS as custom properties.
export const ANIMATION_TIMING = {
  opening: { blackMs: 400, warningMs: 1900, warningBlinkMs: 920, cityRevealMs: 1600, skyRedMs: 3000, transitionMs: 350 },
  entryDropMs: 1050,
  entryDustDelayMs: 950,
  entryPoseMs: 2000,
  boss: { c0WarningMs: 2400, c0ExplosionMs: 1600, deidaraSpawnFrameMs: 170, defeatFallMs: 1900, defeatHoldMs: 3000 },
  elite: { domainDurationMs: 2000, domainRevealDelayMs: 500, bombEscapeDurationMs: 2000 },
  attack: {
    fastPlaybackMultiplier: 2,
    skillAnimationSlowdownMultiplier: 2.4,
    eventGapMs: 330,
    melee: { rushMs: 500, punchMs: 320, recoveryMs: 500, runFrameMs: 125 },
    ranged: { actionMs: 780 },
    magic: { actionMs: 900 },
    deathMs: 520,
    resultHoldMs: 680,
  },
};

// Small initial choice for the opening flow; the broader character pool is out of scope.
export const STARTING_CHARACTERS = [
  { ...CHARACTER_DATA.find((character) => character.id === "naruto"), entryPose: "naruto",
    poseSequence: [
      { state: "landed", caption: "", duration: 220 },
      { state: "surprised", caption: "诶？", duration: 260 },
      { state: "scratch", caption: "嘿嘿……", duration: 430 },
      { state: "smile", caption: "准备好了！", duration: 370 },
      { state: "thumbs-up", caption: "出发！", duration: 370 },
      { state: "thumbs-up", caption: "出发！", duration: 350 },
    ] },
  {
    id: "eren", name: "艾伦", team: "ally", role: "调查兵", row: "front", position: "front",
    hp: 1700, atk: 110, def: 100, spd: 50, baseStats: { maxHp: 1700, atk: 110, def: 100, spd: 50, critRate: 0.05, critMultiplier: 1.5 },
    activeSkills: ["eren-free-will", "eren-tatakae"], passiveSkillId: "eren-2000-years", skill: null, attackType: "melee", deathPose: "cute-flop",
    asset: "assets/eren-v1/idle.png", rosterOrder: 0, entryPose: "steady",
    skillAnimationMap: { "eren-free-will": "skill1", "eren-tatakae": "skill2" },
    poseSequence: [
      { state: "landed", caption: "", duration: 380 },
      { state: "ready", caption: "", duration: 2000 },
    ],
    animations: {
      idle: { type: "frames", frames: { idle: "assets/eren-v1/idle.png" } },
      fall: { type: "frames", frames: {
        drop_start: "assets/eren-v1/fall_2.png",
        impact: "assets/eren-v1/fall_1.png",
        rebound: "assets/eren-v1/fall_2.png",
      }, durationsMs: [2000, 680, 300] },
      pose: { type: "frames", frames: {
        landed: "assets/eren-v1/fall_2.png",
        ready: "assets/eren-v1/idle.png",
      } },
      run: { type: "frames", frames: {
        run_a: "assets/eren-v1/run_a.png",
        run_b: "assets/eren-v1/run_b.png",
      }, durationsMs: [170, 170] },
      meleeAttack: { type: "frames", frames: {
        windup: "assets/eren-v1/attack_windup.png",
        strike: "assets/eren-v1/punch.png",
        recover: "assets/eren-v1/attack_recover.png",
      }, impactFrames: ["windup", "strike", "recover"], durationsMs: [90, 140, 90] },
      hit: { type: "frames", frames: {
        hurt: "assets/eren-v1/hit.png",
        dizzy: "assets/eren-v1/hit.png",
        recover: "assets/eren-v1/idle.png",
      } },
      dodge: { type: "frames", frames: { step: "assets/eren-v1/dodge.png" } },
      death: { type: "frames", frames: { fall: "assets/eren-v1/death.png" } },
      skill1: { type: "frames", frames: {
        skill1_1: "assets/eren-v1/skill1_1.png",
        skill1_2: "assets/eren-v1/skill1_2.png",
        skill1_3: "assets/eren-v1/skill1_3.png",
      }, durationsMs: [420, 240, 300], loop: false },
      skill2: { type: "frames", frames: {
        skill2_1: "assets/eren-v1/skill2_1.png",
        skill2_2: "assets/eren-v1/skill2_2.png",
      }, durationsMs: [420, 400], loop: false },
    },
  },
];

// Elite combat definitions are data-driven; campaign.js chooses one once when an elite node is entered.
export const ELITE_ENEMY_DATA = [
  {
    id: "mahito", name: "真人", type: "elite", role: "咒灵", row: "front", position: "front",
    hp: 1000, atk: 40, def: 40, spd: 60, critChance: 0.05, critMultiplier: 1.5,
    asset: "assets/elites/mahito_idle.png", elitePassiveId: "mahito-domain",
    animations: {
      idle: { type: "frames", frames: { idle: "assets/elites/mahito_idle.png" } },
      domain: { type: "frames", frames: { domain: "assets/elites/mahito_domain.png" } },
    },
  },
  {
    id: "bomb-demon", name: "炸弹恶魔", type: "elite", role: "爆破恶魔", row: "front", position: "front",
    hp: 900, atk: 150, def: 40, spd: 120, critChance: 0.05, critMultiplier: 1.5,
    asset: "assets/elites/bomb_demon_idle.png", activeSkills: ["bomb-demon-boom"], escapeAsset: "assets/elites/bomb_demon_escape.png",
    skillAnimationMap: { "bomb-demon-boom": "boom" },
    animations: {
      idle: { type: "frames", frames: { idle: "assets/elites/bomb_demon_idle.png" } },
      boom: { type: "frames", frames: {
        raise: "assets/elites/bomb_demon_boom_1.png",
        launch: "assets/elites/bomb_demon_boom_2.png",
      }, durationsMs: [900, 300], loop: false },
      death: { type: "frames", frames: { escape: "assets/elites/bomb_demon_escape.png" } },
    },
  },
];

// Encounter definitions scale the existing enemy templates without changing
// their base character data. The arena can reuse the existing guard/mage art.
export const CAMPAIGN_BATTLES = [
  { number: 1, type: "normal", title: "风车原野", location: "风车原野", description: "击退拦路的巡逻队。", enemies: ["guard"], enemyNames: { guard: "巡逻守卫" } },
  { number: 2, type: "normal", title: "溪谷小径", location: "溪谷小径", description: "穿过溪谷，继续前进。", enemies: ["mage"], enemyNames: { mage: "溪谷术师" } },
  { number: 3, type: "normal-hard", title: "古木关隘", location: "古木关隘", description: "更强的敌人守着关口。", enemies: ["guard", "mage"], enemyNames: { guard: "强化守卫", mage: "咒术师" } },
  { number: 5, type: "boss", title: "迪达拉", location: "迪达拉的艺术现场", description: "击败迪达拉，完成第一大关。", enemies: ["guard"], enemyNames: { guard: "迪达拉" }, enemyBaseStats: { guard: { hp: 1700, atk: 120, def: 40, spd: 75 } }, enemyMechanics: { guard: { c0DamagePerRound: 70 } } },
];

export const ADVENTURE_EVENTS = [
  { id: "spring", title: "山泉歇脚处", description: "清凉的泉水可以恢复体力。", effect: "heal", amount: 260, effectText: "恢复 260 点生命（不超过生命上限）。" },
  { id: "scroll", title: "旅人留下的卷轴", description: "卷轴记载着一招临时强化术。", effect: "attack", multiplier: 1.25, effectText: "下一场战斗攻击力提高 25%。" },
  { id: "thorn", title: "荆棘密林", description: "穿越时受了些轻伤。", effect: "damage", amount: 140, effectText: "失去 140 点生命，生命至少保留 1 点。" },
];

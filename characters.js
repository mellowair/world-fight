// All balance values and lineup order live here.
export const CHARACTER_DATA = [
  {
    id: "naruto", name: "鸣人", team: "ally", role: "战士", row: "front",
    hp: 1200, atk: 150, def: 60, spd: 80, attackType: "melee",
    skill: { id: "shadow-clone-rush", name: "影分身突袭", chance: 0.25, multiplier: 1.8, effectType: "damage", attackType: "melee" }, deathPose: "cute-flop",
    asset: "assets/naruto-v2/frames/idle.svg", rosterOrder: 0,
    animations: {
      idle: { type: "static", asset: "assets/naruto-v2/frames/idle.svg" },
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
        punch: "assets/naruto-v2/frames/punch.svg",
        recover: "assets/naruto-v2/frames/idle.svg",
      } },
      hit: { type: "frames", frames: { hit_x: "assets/naruto-v2/frames/hit_x.svg" } },
      dodge: { type: "css", baseAsset: "assets/naruto-v2/frames/idle.svg" },
      death: { type: "css", baseAsset: "assets/naruto-v2/frames/idle.svg" },
    },
  },
  {
    id: "guard", name: "守卫", team: "enemy", role: "守卫", row: "front",
    hp: 1200, atk: 100, def: 60, spd: 60, skill: null, attackType: "melee", deathPose: "cute-flop",
    asset: "assets/guard.svg", rosterOrder: 1,
  },
  {
    id: "mage", name: "法师", team: "enemy", role: "法师", row: "back",
    hp: 600, atk: 120, def: 20, spd: 80, skill: null, attackType: "magic", deathPose: "cute-flop",
    asset: "assets/mage.svg", rosterOrder: 2,
  },
];

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
  attack: {
    fastPlaybackMultiplier: 2,
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
    id: "starter-guardian", name: "木叶护卫", team: "ally", role: "守卫", row: "front",
    hp: 1320, atk: 105, def: 75, spd: 58, skill: null, attackType: "melee", deathPose: "cute-flop",
    asset: "assets/guard.svg", rosterOrder: 0, entryPose: "steady",
    poseSequence: [{ state: "ready", caption: "守护准备就绪", duration: 800 }],
  },
];

// Encounter definitions scale the existing enemy templates without changing
// their base character data. The arena can reuse the existing guard/mage art.
export const CAMPAIGN_BATTLES = [
  { number: 1, type: "normal", title: "风车原野", location: "风车原野", description: "击退拦路的巡逻队。", enemies: ["guard"], hpScale: 0.58, atkScale: 0.78, defScale: 0.8, enemyNames: { guard: "巡逻守卫" } },
  { number: 2, type: "normal", title: "溪谷小径", location: "溪谷小径", description: "穿过溪谷，继续前进。", enemies: ["mage"], hpScale: 0.82, atkScale: 0.82, defScale: 0.9, enemyNames: { mage: "溪谷术师" } },
  { number: 3, type: "normal-hard", title: "古木关隘", location: "古木关隘", description: "更强的敌人守着关口。", enemies: ["guard", "mage"], hpScale: 0.5, atkScale: 0.62, defScale: 0.75, enemyNames: { guard: "强化守卫", mage: "咒术师" } },
  { number: 4, type: "elite", title: "精英哨站", location: "精英哨站", description: "精英敌人挡住了去路。", enemies: ["guard"], hpScale: 1.05, atkScale: 0.86, defScale: 0.9, enemyNames: { guard: "精英守卫" } },
  { number: 5, type: "boss", title: "风之遗迹", location: "风之遗迹", description: "击败首领，完成第一大关。", enemies: ["guard"], hpScale: 1.35, atkScale: 0.92, defScale: 0.95, enemyNames: { guard: "遗迹首领" } },
];

export const ADVENTURE_EVENTS = [
  { id: "spring", title: "山泉歇脚处", description: "清凉的泉水可以恢复体力。", effect: "heal", amount: 260, effectText: "恢复 260 点生命（不超过生命上限）。" },
  { id: "scroll", title: "旅人留下的卷轴", description: "卷轴记载着一招临时强化术。", effect: "attack", multiplier: 1.25, effectText: "下一场战斗攻击力提高 25%。" },
  { id: "thorn", title: "荆棘密林", description: "穿越时受了些轻伤。", effect: "damage", amount: 140, effectText: "失去 140 点生命，生命至少保留 1 点。" },
];

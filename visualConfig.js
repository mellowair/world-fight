// Battle-only presentation settings. These never enter battle calculations.
// frameWidth/frameHeight describe one display frame, not the source PNG size;
// a 160x176 source can use a 160x176 frame without changing the PNG.
// Optional animationOffsets: { skill1: { offsetX: 4, offsetY: 0 } } applies
// only while that animation is visible and resets when its frame is cleared.
export const CHARACTER_VISUALS = Object.freeze({
  naruto: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  eren: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98,
    stageTwoFootOffsetY: 4,
    frameFootShifts: { death: { fall: -2 } } },
  kaneki: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98,
    frameFootShifts: {
      run: { run_01: -2, run_02: -2 },
      meleeAttack: { charge: -4, punch: -2 },
      predator: { strike: -3, retreat: -4 },
      thousandSeven: { burst: -4 },
      death: { down: -4 },
    },
    animationFrameScales: {
      predator: { launch: 1, strike: 1.55, retreat: 1.45 },
      thousandSeven: { burst: 1.4 },
      death: { down: 1.15 },
    } },
  giant: { scale: 1.05, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  slime: { scale: 0.72, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  mage: { scale: 0.86, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  lubu: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  dementor: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  jack: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  teruhashi: { scale: 0.88, offsetX: 0, offsetY: -1, frameWidth: 128, frameHeight: 144 },
  gollum: { scale: 0.6, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  gilgamesh: { scale: 1.9, offsetX: 0, offsetY: 28, frameWidth: 104, frameHeight: 112 },
  suzuya: { scale: 1.02, offsetX: 0, offsetY: 0, frameWidth: 96, frameHeight: 112 },
  six_ear: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  deep_sea_king: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  dina: { scale: 1.7, offsetX: 0, offsetY: 0, frameWidth: 160, frameHeight: 176 },
  deidara: { scale: 1.4, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  mahito: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  "bomb-demon": { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  boros: { scale: 1.3, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98,
    animationFrameScales: {
      meleeAttack: { windup: 1.08, punch: 1.1 },
      phase2Idle: { stage2: 1.22 }, phase3Idle: { stage3: 1.38 },
      meteor: { fly: 1.22, dash: 1.30 }, cannon: { charge: 1.55 },
    } },
  toji: { scale: 1.1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98,
    animationFrameScales: { meleeAttack: { punch_1: 1.24, punch_2: 1.24 } } },
  kira: { scale: 1.55, offsetX: 0, offsetY: -10, frameWidth: 104, frameHeight: 112,
    animationFrameScales: { meleeAttack: { punch_1: 1.18 } } },
  "armored-titan": { scale: 1.2, offsetX: 0, offsetY: 0, frameWidth: 104, frameHeight: 128,
    animationFrameScales: { skill1: { hold: 1.3 } } },
  "colossal-titan": { scale: 2.1, offsetX: 0, offsetY: 0, frameWidth: 150, frameHeight: 190 },
});

const DEFAULT_VISUAL = Object.freeze({ scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 });

export function getCharacterVisual(character) {
  return CHARACTER_VISUALS[character?.visualId ?? character?.appearanceId ?? character?.id] ?? DEFAULT_VISUAL;
}

export function getAnimationVisualOffset(character, animationName) {
  return getCharacterVisual(character).animationOffsets?.[animationName] ?? { offsetX: 0, offsetY: 0 };
}

export function getAnimationFrameVisualScale(character, animationName, frameName) {
  if (character?.id === "six_ear" && animationName === "death") return 1.6;
  return getCharacterVisual(character).animationFrameScales?.[animationName]?.[frameName] ?? 1;
}

export function getAnimationFrameFootShift(character, animationName, frameName) {
  return getCharacterVisual(character).frameFootShifts?.[animationName]?.[frameName] ?? 0;
}

export function getBorosBeamGeometry(arenaLeft, arenaRight, headX, allyX) {
  const towardLeft = allyX <= headX;
  const edge = towardLeft ? arenaLeft : arenaRight;
  return {
    left: Math.min(headX, edge) - arenaLeft,
    width: Math.max(1, Math.abs(headX - edge)),
    flip: !towardLeft,
  };
}

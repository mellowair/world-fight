// Battle-only presentation settings. These never enter battle calculations.
// frameWidth/frameHeight describe one display frame, not the source PNG size;
// a 160x176 source can use a 160x176 frame without changing the PNG.
// Optional animationOffsets: { skill1: { offsetX: 4, offsetY: 0 } } applies
// only while that animation is visible and resets when its frame is cleared.
export const CHARACTER_VISUALS = Object.freeze({
  naruto: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  eren: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  kaneki: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98,
    animationFrameScales: {
      predator: { launch: 1, strike: 1.55, retreat: 1.45 },
      thousandSeven: { burst: 1.4 },
    } },
  giant: { scale: 1.05, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  slime: { scale: 0.72, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  mage: { scale: 0.86, offsetX: 0, offsetY: 0, frameWidth: 128, frameHeight: 144 },
  dina: { scale: 1.7, offsetX: 0, offsetY: 0, frameWidth: 160, frameHeight: 176 },
  deidara: { scale: 1.4, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  mahito: { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
  "bomb-demon": { scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 },
});

const DEFAULT_VISUAL = Object.freeze({ scale: 1, offsetX: 0, offsetY: 0, frameWidth: 84, frameHeight: 98 });

export function getCharacterVisual(character) {
  return CHARACTER_VISUALS[character?.visualId ?? character?.appearanceId ?? character?.id] ?? DEFAULT_VISUAL;
}

export function getAnimationVisualOffset(character, animationName) {
  return getCharacterVisual(character).animationOffsets?.[animationName] ?? { offsetX: 0, offsetY: 0 };
}

export function getAnimationFrameVisualScale(character, animationName, frameName) {
  return getCharacterVisual(character).animationFrameScales?.[animationName]?.[frameName] ?? 1;
}

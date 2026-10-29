// One title sequence per encounter. An encounter can later name several unit IDs.
export const ENEMY_ENTRANCE_DURATION_MS = 2000;

export const ENEMY_ENTRANCES = Object.freeze({
  toji: Object.freeze({ enemyId: "toji", title: "天与暴君", titleColor: "#FFFFFF", titleOutline: "#000000" }),
  boros: Object.freeze({ enemyId: "boros", title: "宇宙霸主", titleColor: "#A855F7", titleOutline: "#4C1D95" }),
  gilgamesh: Object.freeze({ enemyId: "gilgamesh", title: "英雄王", titleColor: "#FFD700", titleOutline: "#92400E" }),
  kira: Object.freeze({ enemyId: "kira", title: "普通上班族", titleColor: "#FF69B4", titleOutline: "#831843" }),
});

export function getEnemyEntrance(battle, roster) {
  if (!battle || !Array.isArray(roster)) return null;
  const encounterId = battle.eliteId ?? battle.encounterId;
  const candidates = [encounterId, ...(battle.enemies ?? [])];
  for (const id of candidates) {
    const config = ENEMY_ENTRANCES[id];
    if (!config) continue;
    const actorIds = config.enemyIds ?? [config.enemyId];
    const actors = actorIds.map((actorId) => roster.find((unit) => unit.team === "enemy" && unit.id === actorId));
    if (actors.every(Boolean)) return { ...config, encounterId: encounterId ?? id, actor: actors[0], actors };
  }
  return null;
}

export function createEntranceCompletion(onComplete) {
  let state = "pending";
  return {
    complete() {
      if (state !== "pending") return false;
      state = "completed";
      onComplete();
      return true;
    },
    cancel() {
      if (state !== "pending") return false;
      state = "cancelled";
      return true;
    },
    get state() { return state; },
  };
}

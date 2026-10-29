// Logical routes and their visual rows are independent. The start is not an
// encounter; each visited room, including the Boss, counts as one step.
export const ROUTE_MAP_FINAL_STEP = 15; // Highest display row, not a fixed trip length.

function hashSeed(seed) {
  let value = 2166136261;
  for (const character of String(seed ?? 0)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0 || 1;
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function node(id, layer, x, type = null) {
  return { id, step: layer, layer, x, type, status: layer === 0 ? "completed" : "locked",
    nextNodeIds: [], resolution: null, event: null, battle: null };
}

function edge(from, to) { from.nextNodeIds.push(to.id); }

// First build only the DAG. Two different-length lanes enter each real shared
// node; no filler room is generated on the shorter lane.
function buildTopology(random) {
  const start = node("start-konoha", 0, 500, "start");
  const nodes = [start], blocks = [];
  let entry = start, firstRow = 1;
  for (const [index, lengths] of [[2, 3], [2, 3], [1, 3]].entries()) {
    const laneLengths = random() < 0.5 ? [...lengths].reverse() : lengths;
    const lanes = laneLengths.map((length, laneIndex) => {
      const lane = [];
      for (let room = 0; room < length; room += 1) {
        const next = node(`fork-${index + 1}-${laneIndex ? "right" : "left"}-${room + 1}`,
          firstRow + room, laneIndex ? 710 : 290);
        edge(lane.at(-1) ?? entry, next);
        lane.push(next); nodes.push(next);
      }
      return lane;
    });
    const join = node(`join-${index + 1}`, firstRow + Math.max(...laneLengths), 500);
    lanes.forEach((lane) => edge(lane.at(-1), join));
    nodes.push(join); blocks.push({ lanes, join });
    entry = join; firstRow = join.layer + 1;
  }
  const campfire = node("boss-approach-campfire", firstRow, 500);
  const leadIn = node("boss-approach-battle", firstRow + 1, 500);
  const boss = node("boss-deidara", firstRow + 2, 500, "demon");
  edge(entry, campfire); edge(campfire, leadIn); edge(leadIn, boss);
  nodes.push(campfire, leadIn, boss);
  nodes.sort((a, b) => a.layer - b.layer || a.x - b.x);
  return { nodes, blocks, campfire, leadIn, boss };
}

// Room assignment is a separate pass. The shared elite and campfire preserve
// the existing every-route guarantees; every individual edge is checked later.
function assignTypes(graph, random) {
  const [opening, middle, late] = graph.blocks;
  const questionLane = random() < 0.5 ? 0 : 1;
  opening.lanes.forEach((lane, index) => {
    lane[0].type = index === questionLane ? "question" : "battle";
    lane[1].type = index === questionLane ? "battle" : "question";
    if (lane[2]) {
      const roll = random();
      lane[2].type = roll < 0.12 ? "elite" : roll < 0.32 ? "campfire" : "battle";
    }
  });
  opening.join.type = "battle";
  const campLane = random() < 0.5 ? 0 : 1;
  middle.lanes.forEach((lane, index) => {
    if (index === campLane) {
      lane[0].type = random() < 0.16 ? "elite" : "battle";
      lane[1].type = "campfire";
      if (lane[2]) lane[2].type = "battle";
    } else {
      lane[0].type = "question";
      lane[1].type = "battle";
      if (lane[2]) lane[2].type = "question";
    }
  });
  middle.join.type = "elite";
  const shortLane = late.lanes.find((lane) => lane.length === 1);
  const longLane = late.lanes.find((lane) => lane.length === 3);
  shortLane[0].type = random() < 0.5 ? "battle" : "question";
  longLane[0].type = shortLane[0].type === "battle" ? "campfire" : "battle";
  longLane[1].type = longLane[0].type === "campfire" ? "battle" : "question";
  longLane[2].type = random() < 0.15 ? "elite" : longLane[1].type === "question" ? "battle" : "question";
  late.join.type = "battle";
  graph.campfire.type = "campfire";
  graph.leadIn.type = "battle";
  return { eliteStep: middle.join.layer, campfireStep: graph.campfire.layer };
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.layer - a.layer) - (b.layer - a.layer) * (c.x - a.x);
}

function crosses(a, b, c, d) {
  if ([a.id, b.id].includes(c.id) || [a.id, b.id].includes(d.id)) return false;
  return orientation(a, b, c) * orientation(a, b, d) < 0 &&
    orientation(c, d, a) * orientation(c, d, b) < 0;
}

function passesNode(a, b, target) {
  if ([a.id, b.id].includes(target.id) || target.layer <= a.layer || target.layer >= b.layer) return false;
  const fraction = (target.layer - a.layer) / (b.layer - a.layer);
  return Math.abs(a.x + fraction * (b.x - a.x) - target.x) < 42;
}

export function analyzeRouteMap(map) {
  const byId = new Map(map.nodes.map((entry) => [entry.id, entry]));
  const edges = map.nodes.flatMap((entry) => entry.nextNodeIds.map((id) => [entry, byId.get(id)]));
  const incoming = new Map(map.nodes.map((entry) => [entry.id, []]));
  edges.forEach(([from, to]) => incoming.get(to.id).push(from));
  // Expanding every shared suffix into a separate branch would create this
  // many room instances. This is a comparison baseline, not another map.
  const expandedCount = (id) => 1 + byId.get(id).nextNodeIds.reduce((sum, child) => sum + expandedCount(child), 0);
  let crossings = 0, throughNodes = 0, consecutiveCampfires = 0;
  edges.forEach(([from, to], index) => {
    if (from.type === "campfire" && to.type === "campfire") consecutiveCampfires += 1;
    for (let other = index + 1; other < edges.length; other += 1)
      if (crosses(from, to, ...edges[other])) crossings += 1;
    for (const candidate of map.nodes) if (passesNode(from, to, candidate)) throughNodes += 1;
  });
  const lengths = [], roomTotals = { battle: 0, elite: 0, question: 0, campfire: 0 };
  const beforeBoss = { battle: 0, elite: 0, question: 0, campfire: 0 };
  let invalidPaths = 0;
  function walk(id, path, seenElite, seenCampfire, streak) {
    const current = byId.get(id);
    if (!current || path.includes(id)) { invalidPaths += 1; return; }
    const visited = [...path, id];
    const elite = seenElite || current.type === "elite";
    const campfire = seenCampfire || current.type === "campfire";
    const nextStreak = ["start", "battle", "elite", "demon"].includes(current.type) ? 0 : streak + 1;
    if (nextStreak > 2) invalidPaths += 1;
    if (id === map.bossNodeId) {
      lengths.push(visited.length - 1); // Start excluded, Boss included.
      if (!elite || !campfire) invalidPaths += 1;
      for (const visitedId of visited) {
        const type = byId.get(visitedId).type;
        if (type in roomTotals) roomTotals[type] += 1;
      }
      for (const visitedId of visited.slice(-3, -1)) {
        const type = byId.get(visitedId).type;
        if (type in beforeBoss) beforeBoss[type] += 1;
        if (type === "question") invalidPaths += 1;
      }
      return;
    }
    if (!current.nextNodeIds.length) { invalidPaths += 1; return; }
    current.nextNodeIds.forEach((child) => walk(child, visited, elite, campfire, nextStreak));
  }
  walk(map.startNodeId, [], false, false, 0);
  const reachable = new Set(), stack = [map.startNodeId];
  while (stack.length) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...(byId.get(id)?.nextNodeIds ?? []));
  }
  const signatureCache = new Map();
  function signature(id) {
    if (signatureCache.has(id)) return signatureCache.get(id);
    const current = byId.get(id);
    const result = JSON.stringify([current.type, current.nextNodeIds.map(signature).sort()]);
    signatureCache.set(id, result);
    return result;
  }
  let redundantChoices = 0;
  for (const current of map.nodes) {
    const seen = new Set();
    for (const child of current.nextNodeIds) {
      const value = signature(child);
      if (seen.has(value)) redundantChoices += 1;
      seen.add(value);
    }
  }
  return {
    routeCount: lengths.length,
    averageLength: lengths.reduce((sum, length) => sum + length, 0) / (lengths.length || 1),
    shortest: Math.min(...lengths), longest: Math.max(...lengths),
    reachableNodes: reachable.size, nodeCount: map.nodes.length, edgeCount: edges.length,
    unsharedNodeCount: expandedCount(map.startNodeId),
    crossRowJoins: map.nodes.filter((entry) => new Set(incoming.get(entry.id).map((parent) => parent.layer)).size > 1).length,
    branchCounts: map.nodes.filter((entry) => entry.nextNodeIds.length > 1).map((entry) => entry.nextNodeIds.length),
    crossings, throughNodes, consecutiveCampfires, redundantChoices, invalidPaths,
    roomTotals, beforeBoss,
  };
}

export function validateRouteMap(map) {
  if (!map || new Set(map.nodes.map((entry) => entry.id)).size !== map.nodes.length) return false;
  const byId = new Map(map.nodes.map((entry) => [entry.id, entry]));
  if (byId.get(map.startNodeId)?.type !== "start" || byId.get(map.bossNodeId)?.type !== "demon") return false;
  for (const current of map.nodes) {
    if (!current.type || !Number.isInteger(current.layer) || !Number.isFinite(current.x)) return false;
    for (const id of current.nextNodeIds) {
      const child = byId.get(id);
      if (!child || child.layer <= current.layer || (current.type === "campfire" && child.type === "campfire")) return false;
    }
  }
  const stats = analyzeRouteMap(map);
  return stats.reachableNodes === map.nodes.length && stats.routeCount > 0 &&
    stats.invalidPaths === 0 && stats.consecutiveCampfires === 0 &&
    stats.shortest >= 11 && stats.longest <= 15 && Math.abs(stats.averageLength - 13) <= 0.5 &&
    stats.crossings === 0 && stats.throughNodes === 0 && stats.redundantChoices === 0;
}

export function orderRouteOptionsByPosition(map, options) {
  const byId = new Map(map.nodes.map((entry) => [entry.id, entry]));
  return [...options].sort((a, b) => (byId.get(a.id)?.x ?? 500) - (byId.get(b.id)?.x ?? 500));
}

export function shortestRemainingRouteLength(map, fromId = map.currentNodeId) {
  const byId = new Map(map.nodes.map((entry) => [entry.id, entry]));
  const memo = new Map([[map.bossNodeId, 0]]);
  function remaining(id) {
    if (memo.has(id)) return memo.get(id);
    const current = byId.get(id);
    if (!current?.nextNodeIds.length) return Infinity;
    const length = 1 + Math.min(...current.nextNodeIds.map(remaining));
    memo.set(id, length);
    return length;
  }
  return remaining(fromId);
}

export function generateRouteMap(seed = 0, options = {}) {
  const random = createSeededRandom(seed);
  const graph = buildTopology(random);
  const guarantees = assignTypes(graph, random);
  const map = { seed: String(seed), stageId: options.stageId ?? 1, startNodeId: "start-konoha", bossNodeId: "boss-deidara",
    currentNodeId: "start-konoha", ...guarantees,
    guaranteedEliteStep: guarantees.eliteStep, visitedEdges: [], nodes: graph.nodes };
  if (!validateRouteMap(map)) throw new Error("Generated route map violates route or layout constraints");
  if (options.stageId === 2) {
    const rename = (id) => `stage2-${id === "start-konoha" ? "start" : id === "boss-deidara" ? "pending-end" : id}`;
    map.nodes.forEach((entry) => {
      entry.id = rename(entry.id);
      entry.nextNodeIds = entry.nextNodeIds.map(rename);
    });
    map.startNodeId = rename(map.startNodeId);
    map.currentNodeId = map.startNodeId;
    map.bossNodeId = rename(map.bossNodeId);
  }
  return map;
}

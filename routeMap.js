export const ROUTE_MAP_FINAL_STEP = 10;
const LAYER_WIDTHS = [1, 2, 3, 2, 3, 3, 2, 3, 2, 3, 1];

function hashSeed(seed) {
  const text = String(seed ?? 0);
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
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

function addEdge(from, to) {
  if (!from.nextNodeIds.includes(to.id)) from.nextNodeIds.push(to.id);
}

function buildTopology(random) {
  const layers = LAYER_WIDTHS.map((width, step) => Array.from({ length: width }, (_, index) => ({
    id: step === 0 ? "start-konoha" : step === 10 ? "boss-deidara" : `step-${step}-node-${index + 1}`,
    step,
    type: step === 0 ? "start" : step === 10 ? "demon" : null,
    status: step === 0 ? "completed" : "locked",
    nextNodeIds: [],
    resolution: null,
    event: null,
    battle: null,
  })));

  for (let step = 0; step < layers.length - 1; step += 1) {
    const current = layers[step];
    const next = layers[step + 1];
    current.forEach((node, index) => {
      const targetIndex = Math.min(next.length - 1, Math.floor(((index + 0.5) / current.length) * next.length));
      addEdge(node, next[targetIndex]);
    });
    next.forEach((node, index) => {
      const sourceIndex = Math.min(current.length - 1, Math.floor(((index + 0.5) / next.length) * current.length));
      addEdge(current[sourceIndex], node);
    });
    current.forEach((node, index) => {
      if (next.length > 1 && random() < 0.48) {
        const base = Math.min(next.length - 1, Math.floor(((index + 0.5) / current.length) * next.length));
        const adjacent = Math.max(0, Math.min(next.length - 1, base + (random() < 0.5 ? -1 : 1)));
        addEdge(node, next[adjacent]);
      }
    });
  }
  return layers;
}

function weightedType(step, random, eliteParent) {
  const choices = step <= 2
    ? [["battle", 70], ["question", 30]]
    : step <= 8
      ? [["battle", 40], ["elite", eliteParent ? 0 : 10], ["question", 30], ["campfire", 20]]
      : [["battle", 62.5], ["question", 37.5]];
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let point = random() * total;
  for (const [type, weight] of choices) {
    point -= weight;
    if (point < 0) return type;
  }
  return "battle";
}

function assignTypes(layers, random) {
  const eliteStep = 3 + Math.floor(random() * 3);
  const campfireStep = eliteStep + 2 + Math.floor(random() * (7 - eliteStep));
  const byId = new Map(layers.flat().map((node) => [node.id, node]));
  for (let step = 1; step <= 9; step += 1) {
    for (const node of layers[step]) {
      const parents = layers[step - 1].filter((parent) => parent.nextNodeIds.includes(node.id));
      node.type = weightedType(step, random, parents.some((parent) => parent.type === "elite"));
    }
  }

  // Every complete route gets an elite layer and, later, a campfire layer.
  // The battle layer immediately before campfires keeps them reachable even
  // when the legacy consecutive-noncombat protection is active.
  for (const node of layers[eliteStep]) node.type = "elite";
  for (const node of layers[eliteStep - 1]) {
    if (node.type === "elite") node.type = "battle";
  }
  for (const node of layers[eliteStep + 1]) {
    if (node.type === "elite") node.type = "battle";
  }
  for (const node of layers[campfireStep - 1]) node.type = "battle";
  for (const node of layers[campfireStep]) node.type = "campfire";

  // Cap every possible path at two consecutive non-combat rooms. This also
  // keeps the full map from previewing a three-event run that the chooser
  // would later have to reject.
  const streaksAtNode = new Map([[layers[0][0].id, [0]]]);
  for (let step = 0; step <= 9; step += 1) {
    for (const node of layers[step]) {
      const incoming = streaksAtNode.get(node.id) ?? [];
      if (step > 0 && incoming.includes(2) && !["battle", "elite", "demon"].includes(node.type)) node.type = "battle";
      const outgoing = node.type === "start" || ["battle", "elite", "demon"].includes(node.type)
        ? [0]
        : [...new Set(incoming.map((streak) => Math.min(2, streak + 1)))];
      const children = node.nextNodeIds.map((id) => byId.get(id));
      for (const child of children) {
        const states = streaksAtNode.get(child.id) ?? [];
        streaksAtNode.set(child.id, [...new Set([...states, ...outgoing])]);
      }
    }
  }
  return { eliteStep, campfireStep };
}

export function validateRouteMap(map) {
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  if (nodes.size !== map.nodes.length) return false;
  const start = nodes.get(map.startNodeId);
  const boss = nodes.get(map.bossNodeId);
  if (!start || start.type !== "start" || !boss || boss.type !== "demon" || boss.step !== 10) return false;
  for (const node of map.nodes) {
    for (const nextId of node.nextNodeIds) {
      const next = nodes.get(nextId);
      if (!next || next.step <= node.step) return false;
    }
    if (node.id !== map.bossNodeId && node.nextNodeIds.length === 0) return false;
  }
  const visiting = new Set();
  const visited = new Set();
  function walk(id) {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const node = nodes.get(id);
    if (!node.nextNodeIds.every(walk)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  if (!walk(map.startNodeId) || visited.size !== nodes.size || !visited.has(map.bossNodeId)) return false;
  const canReachBoss = new Set([map.bossNodeId]);
  for (let step = 9; step >= 0; step -= 1) {
    for (const node of map.nodes.filter((candidate) => candidate.step === step)) {
      if (node.nextNodeIds.some((id) => canReachBoss.has(id))) canReachBoss.add(node.id);
    }
  }
  return canReachBoss.size === nodes.size;
}

// `map.nodes` is stored in visual layer order, left to right within each layer.
// Use that same order for the scene signs so the choice on the left always
// points to the left branch on the read-only map.
export function orderRouteOptionsByPosition(map, options) {
  const visualOrder = new Map(map.nodes.map((node, index) => [node.id, index]));
  return [...options].sort((left, right) =>
    (visualOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (visualOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

export function generateRouteMap(seed = 0) {
  const random = createSeededRandom(seed);
  const layers = buildTopology(random);
  const guarantees = assignTypes(layers, random);
  const map = {
    seed: String(seed),
    startNodeId: "start-konoha",
    bossNodeId: "boss-deidara",
    currentNodeId: "start-konoha",
    ...guarantees,
    guaranteedEliteStep: 3 + Math.floor(0),
    visitedEdges: [],
    nodes: layers.flat(),
  };
  if (!validateRouteMap(map)) throw new Error("Generated route map violates DAG reachability constraints");
  return map;
}

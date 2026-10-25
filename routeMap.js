export const ROUTE_MAP_FINAL_STEP = 15;

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
  const widths = [1, ...Array.from({ length: ROUTE_MAP_FINAL_STEP - 1 }, () => random() < 0.5 ? 2 : 3), 1];
  const layers = widths.map((width, step) => Array.from({ length: width }, (_, index) => ({
    id: step === 0 ? "start-konoha" : step === ROUTE_MAP_FINAL_STEP ? "boss-deidara" : "step-" + step + "-node-" + (index + 1),
    step, type: step === 0 ? "start" : step === ROUTE_MAP_FINAL_STEP ? "demon" : null,
    status: step === 0 ? "completed" : "locked", nextNodeIds: [], resolution: null, event: null, battle: null,
  })));
  for (let step = 0; step < layers.length - 1; step += 1) {
    const current = layers[step], next = layers[step + 1];
    current.forEach((node, index) => {
      const low = Math.floor(index * next.length / current.length);
      const high = Math.max(low, Math.ceil((index + 1) * next.length / current.length) - 1);
      for (let target = low; target <= high; target += 1) addEdge(node, next[target]);
    });
    next.forEach((node, index) => {
      if (!current.some(parent => parent.nextNodeIds.includes(node.id))) {
        const parent = current[Math.min(current.length - 1, Math.floor((index + 0.5) * current.length / next.length))];
        addEdge(parent, node);
      }
    });
  }
  return layers;
}

// Collapse only genuinely equivalent choices. Two rooms are equivalent when
// they have the same type and expose the same set of equivalent future paths.
// Processing from the Boss backwards makes this a stable semantic signature:
// equal-looking room sequences converge, while a different room type or a
// different future choice remains a real branch.
function mergeEquivalentChoices(layers) {
  const canonicalId = new Map();
  for (let step = layers.length - 2; step >= 1; step -= 1) {
    const layer = layers[step];
    const retained = [];
    for (const parent of layers[step - 1]) {
      parent.nextNodeIds = [...new Set(parent.nextNodeIds.map(id => canonicalId.get(id) ?? id))];
    }
    for (const node of layer) {
      node.nextNodeIds = [...new Set(node.nextNodeIds.map(id => canonicalId.get(id) ?? id))];
      // Identical room types with the same canonical future are the same
      // choice. Collapse them bottom-up so only meaningful branches remain.
      const signature = JSON.stringify([node.type, [...node.nextNodeIds].sort()]);
      const equivalent = retained.find(candidate => JSON.stringify([candidate.type, [...candidate.nextNodeIds].sort()]) === signature);
      if (equivalent) {
        canonicalId.set(node.id, equivalent.id);
      } else {
        canonicalId.set(node.id, node.id);
        retained.push(node);
      }
    }
    layers[step] = retained;
  }

  for (let step = 0; step < layers.length - 1; step += 1) {
    for (const node of layers[step]) {
      node.nextNodeIds = [...new Set(node.nextNodeIds.map(id => canonicalId.get(id) ?? id))];
    }
  }
}

function weightedType(step, random, eliteParent) {
  const choices = step <= 2
    ? [["battle", 70], ["question", 30]]
    : step < ROUTE_MAP_FINAL_STEP - 2
      ? [["battle", 42], ["elite", eliteParent ? 0 : 10], ["question", 28], ["campfire", 20]]
      : step === ROUTE_MAP_FINAL_STEP - 2 ? [["campfire", 1]]
      : [["battle", 62], ["elite", eliteParent ? 0 : 10], ["campfire", 28]];
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let point = random() * total;
  for (const [type, weight] of choices) {
    point -= weight;
    if (point < 0) return type;
  }
  return "battle";
}

function assignTypes(layers, random) {
  const eliteStep = 3 + Math.floor(random() * 5);
  const campfireStep = ROUTE_MAP_FINAL_STEP - 2;
  const byId = new Map(layers.flat().map((node) => [node.id, node]));
  for (let step = 1; step < ROUTE_MAP_FINAL_STEP; step += 1) {
    for (const node of layers[step]) {
      const parents = layers[step - 1].filter((parent) => parent.nextNodeIds.includes(node.id));
      node.type = weightedType(step, random, parents.some((parent) => parent.type === "elite"));
    }
    if (step <= 2 && !layers[step].some(node => node.type === "battle")) layers[step][0].type = "battle";
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
  for (let step = 0; step < ROUTE_MAP_FINAL_STEP; step += 1) {
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
  if (!start || start.type !== "start" || !boss || boss.type !== "demon" || boss.step !== ROUTE_MAP_FINAL_STEP) return false;
  for (const node of map.nodes) {
    for (const nextId of node.nextNodeIds) {
      const next = nodes.get(nextId);
      if (!next || next.step <= node.step) return false;
    }
    if (node.id !== map.bossNodeId && node.nextNodeIds.length === 0) return false;
  }
  const layersByStep = new Map();
  for (const node of map.nodes) { const layer = layersByStep.get(node.step) ?? []; layer.push(node); layersByStep.set(node.step, layer); }
  let crossingCount = 0;
  for (const [step, layer] of layersByStep) {
    const nextLayer = layersByStep.get(step + 1); if (!nextLayer) continue;
    const si = new Map(layer.map((node, i) => [node.id, i])), ti = new Map(nextLayer.map((node, i) => [node.id, i]));
    const edges = layer.flatMap(node => node.nextNodeIds.map(id => [si.get(node.id), ti.get(id)]));
    for (let i=0;i<edges.length;i++) for (let j=i+1;j<edges.length;j++) {
      if ((edges[i][0] < edges[j][0] && edges[i][1] > edges[j][1]) || (edges[j][0] < edges[i][0] && edges[j][1] > edges[i][1])) crossingCount += 1;
    }
  }
  // The minimum-crossing order can retain one unavoidable crossing when
  // equivalent branches converge around a distinct alternative.
  if (crossingCount > 1) return false;
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
  for (let step = ROUTE_MAP_FINAL_STEP - 1; step >= 0; step -= 1) {
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
  mergeEquivalentChoices(layers);
  const map = {
    seed: String(seed),
    startNodeId: "start-konoha",
    bossNodeId: "boss-deidara",
    currentNodeId: "start-konoha",
    ...guarantees,
    guaranteedEliteStep: guarantees.eliteStep,
    visitedEdges: [],
    nodes: layers.flat(),
  };
  if (!validateRouteMap(map)) throw new Error("Generated route map violates DAG reachability constraints");
  return map;
}

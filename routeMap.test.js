import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeRouteMap, generateRouteMap, orderRouteOptionsByPosition, shortestRemainingRouteLength, validateRouteMap } from "./routeMap.js";
import { createCampaign, getRouteMap } from "./campaign.js";

function reachableNodes(map) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const child of map.nodes.find((node) => node.id === id).nextNodeIds) visit(child);
  };
  visit(map.startNodeId);
  return seen;
}

function assertPlayableWithoutRouteDeadEnds(map) {
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const explore = (id, streak, sawElite, sawCampfire) => {
    const key = `${id}:${streak}:${sawElite}:${sawCampfire}`;
    if (seen.has(key)) return;
    seen.add(key);
    const node = byId.get(id);
    if (node.id === map.bossNodeId) {
      assert.equal(sawElite, true, "every legal route includes an elite");
      assert.equal(sawCampfire, true, "every legal route includes a campfire");
      return;
    }
    const children = node.nextNodeIds.map((childId) => byId.get(childId));
    assert.ok(children.length > 0, `${node.id} has no successor at streak ${streak}`);
    for (const child of children) {
      if (streak >= 2) assert.ok(["battle", "elite", "demon"].includes(child.type), `${child.id} would create a third consecutive noncombat node`);
      const nextStreak = ["battle", "elite", "demon"].includes(child.type) ? 0 : Math.min(2, streak + 1);
      explore(child.id, nextStreak, sawElite || child.type === "elite", sawCampfire || child.type === "campfire");
    }
  };
  explore(map.startNodeId, 0, false, false);
}

function routeSignatures(map) {
  const byId = new Map(map.nodes.map(node => [node.id, node]));
  const memo = new Map();
  const signature = node => {
    if (memo.has(node.id)) return memo.get(node.id);
    const value = JSON.stringify([
      node.type,
      node.nextNodeIds.map(id => signature(byId.get(id))).sort(),
    ]);
    memo.set(node.id, value);
    return value;
  };
  map.nodes.forEach(signature);
  return { byId, memo };
}

function countLayerCrossings(map) {
  const totalSteps = Math.max(...map.nodes.map(node => node.step));
  let count = 0;
  for (let step = 0; step < totalSteps; step += 1) {
    const parents = map.nodes.filter(node => node.step === step);
    const children = map.nodes.filter(node => node.step === step + 1);
    const parentIndex = new Map(parents.map((node, index) => [node.id, index]));
    const childIndex = new Map(children.map((node, index) => [node.id, index]));
    const edges = parents.flatMap(node => node.nextNodeIds.map(id => [parentIndex.get(node.id), childIndex.get(id)]));
    for (let left = 0; left < edges.length; left += 1) {
      for (let right = left + 1; right < edges.length; right += 1) {
        if ((edges[left][0] < edges[right][0] && edges[left][1] > edges[right][1]) ||
            (edges[right][0] < edges[left][0] && edges[right][1] > edges[left][1])) count += 1;
      }
    }
  }
  return count;
}

test("scene route signs use the same left-to-right order as map branches", () => {
  const routeMap = generateRouteMap("left-right-choice");
  const layer = routeMap.nodes.filter((node) => node.step === 1);
  const deliberatelyReversed = [...layer].reverse();
  const ordered = orderRouteOptionsByPosition(routeMap, deliberatelyReversed);

  assert.deepEqual(ordered.map((node) => node.id), layer.map((node) => node.id));
  assert.deepEqual(ordered.map((node) => node.type), layer.map((node) => node.type));
});

test("same seed produces the same full map, while different seeds vary topology or node types", () => {
  assert.deepEqual(generateRouteMap(20261025), generateRouteMap(20261025));
  assert.notDeepEqual(generateRouteMap(20261025), generateRouteMap(20261026));
});

test("route maps have meaningful different-length paths and real cross-row joins", () => {
  const topologies = new Set();
  let routes = 0, edges = 0;
  for (let seed = 0; seed < 1000; seed += 1) {
    const map = generateRouteMap(seed);
    const stats = analyzeRouteMap(map);
    assert.equal(validateRouteMap(map), true, `seed ${seed}`);
    assert.equal(reachableNodes(map).size, map.nodes.length);
    assertPlayableWithoutRouteDeadEnds(map);
    assert.equal(stats.routeCount, 8);
    assert.deepEqual([stats.shortest, stats.averageLength, stats.longest], [11, 13, 15]);
    assert.equal(stats.crossings, 0);
    assert.equal(stats.throughNodes, 0);
    assert.equal(stats.consecutiveCampfires, 0);
    assert.equal(stats.redundantChoices, 0);
    assert.equal(stats.invalidPaths, 0);
    assert.equal(stats.beforeBoss.question, 0);
    const byId = new Map(map.nodes.map((node) => [node.id, node]));
    const joins = map.nodes.filter((node) => map.nodes.filter((parent) => parent.nextNodeIds.includes(node.id)).length > 1);
    assert.ok(joins.some((join) => {
      const parents = map.nodes.filter((parent) => parent.nextNodeIds.includes(join.id));
      return new Set(parents.map((parent) => parent.layer)).size > 1;
    }), "a shared node must receive branches from different display rows");
    for (const node of map.nodes) for (const id of node.nextNodeIds) {
      assert.ok(byId.get(id).layer > node.layer);
      assert.ok(!(node.type === "campfire" && byId.get(id).type === "campfire"));
    }
    routes += stats.routeCount;
    edges += stats.edgeCount;
    topologies.add(map.nodes.map((node) => `${node.id}:${node.layer}:${node.type}`).join("|"));
  }
  assert.equal(routes, 8000);
  assert.ok(edges > 0 && topologies.size > 1);
});

test("all incoming edges reject consecutive campfires, including skipped rows and shared joins", () => {
  const ordinary = structuredClone(generateRouteMap("ordinary-campfires"));
  ordinary.nodes.find((node) => node.id === "boss-approach-battle").type = "campfire";
  assert.ok(analyzeRouteMap(ordinary).consecutiveCampfires > 0);
  assert.equal(validateRouteMap(ordinary), false);

  const crossRow = structuredClone(generateRouteMap("cross-row-campfires"));
  const byId = new Map(crossRow.nodes.map((node) => [node.id, node]));
  const skipped = crossRow.nodes.flatMap((node) => node.nextNodeIds.map((id) => [node, byId.get(id)]))
    .find(([from, to]) => to.layer - from.layer > 1);
  assert.ok(skipped);
  skipped[0].type = "campfire";
  skipped[1].type = "campfire";
  assert.ok(analyzeRouteMap(crossRow).consecutiveCampfires > 0);
  assert.equal(validateRouteMap(crossRow), false);

  const shared = structuredClone(generateRouteMap("shared-campfires"));
  const join = shared.nodes.find((node) => node.id === "join-1");
  const parents = shared.nodes.filter((node) => node.nextNodeIds.includes(join.id));
  join.type = "campfire";
  parents[0].type = "battle";
  parents[1].type = "campfire";
  assert.equal(analyzeRouteMap(shared).consecutiveCampfires, 1);
  assert.equal(validateRouteMap(shared), false);
});

test("the route progress estimate counts future rooms instead of visual rows", () => {
  const map = generateRouteMap("different-length-progress");
  assert.equal(shortestRemainingRouteLength(map), 11);
  assert.equal(shortestRemainingRouteLength(map, map.bossNodeId), 0);
  assert.equal(shortestRemainingRouteLength(map, "boss-approach-campfire"), 2);
});

test("route type rules keep elites distinct, later, and non-consecutive; Boss lead-in has campfire and no events", () => {
  for (let seed = 0; seed < 1000; seed += 1) {
    const map = generateRouteMap(seed);
    for (const node of map.nodes.filter(entry => entry.step > 0 && entry.step < 15)) {
      if (node.step <= 2) assert.ok(["battle", "question"].includes(node.type));
      if (node.type === "elite") {
        assert.ok(node.step >= 3 && node.step <= 14);
        const parents=map.nodes.filter(parent=>parent.nextNodeIds.includes(node.id));
        assert.ok(parents.every(parent=>parent.type!=="elite"));
      }
    }
  }
});

test("campaign route-map RNG is independent from campaign and combat random draws", () => {
  const first = createCampaign(() => 0.1, { seed: 145 });
  const second = createCampaign(() => 0.9, { seed: 145 });
  for (let count = 0; count < 100; count += 1) first.random();
  assert.deepEqual(getRouteMap(first), getRouteMap(second));
});

test("route map UI renders the pre-generated graph with a distinct elite icon", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const eliteIcon = readFileSync(new URL("./assets/route-signs/map-elite.svg", import.meta.url), "utf8");
  assert.match(html, /id="route-map-scroll"/);
  assert.match(html, /id="route-map-edges"/);
  assert.match(html, /id="route-map-open"/);
  assert.match(html, /class="route-map-legend"/);
  assert.match(html, /id="route-signs"/);
  assert.match(app, /getRouteMap\(campaign\)/);
  assert.match(app, /node\.type === "elite" \? "assets\/route-signs\/battle\.png"/);
  assert.match(app, /route-sign-overlay/);
  assert.match(app, /orderRouteOptionsByPosition\(routeMap, getRouteOptions\(campaign\)\)/);
  assert.match(app, /route-map-avatar/);
  assert.match(app, /const selectable = campaign\.status === "route" && node\.status === "pending"/);
  assert.match(app, /document\.createElement\(selectable \? "button" : "div"\)/);
  assert.match(app, /button\.addEventListener\("click", \(\) => selectRouteNode\(node\.id\)\)/);
  assert.match(app, /function selectRouteNode\(nodeId\)/);
  assert.match(app, /campaign\.stageId === 1 && routeMap\.currentNodeId === routeMap\.startNodeId\) openRouteMap\(\)/);
  assert.match(app, /#route-map-open.*openRouteMap/);
  assert.match(html, /点击高亮的下一节点开始探索/);
  assert.match(html, /可纵向滚动选择和查看路线地图/);
  assert.doesNotMatch(html, /继续前进请在场景中选择路牌/);
  assert.match(app, /assets\/route-signs\/map-home\.svg/);
  assert.match(app, /assets\/deidara-v2\/idle\/idle_1\.png/);
  assert.match(app, /signs\.classList\.toggle\("route-signs-single", options\.length === 1\)/);
  assert.match(app, /nodeLayer\.append\(element\)/);
  assert.match(app, /routeMap.visitedEdges/);
  assert.match(css, /.route-map-locked/);
  assert.match(css, /.route-map-current/);
  assert.match(css, /\.route-map-node\.route-map-question \.route-map-icon \{ width: 68%; height: 68%; \}/);
  assert.match(css, /\.route-screen \.route-player \{ width: 23%; bottom: 24%; \}/);
  assert.match(css, /\.fighter\.is-deidara\.is-casting \.sprite-wrap \{ transform: translateY\(0\); \}/);
  assert.match(css, /\.route-edge \{[^}]*stroke-width: 3/);
  assert.match(css, /\.route-edge-visited \{[^}]*stroke-width: 5/);
  assert.match(css, /\.route-map-completed \{[^}]*opacity: 1/);
  assert.match(eliteIcon, /viewBox="0 0 64 64"/);
  for (const icon of ["map-battle.svg", "map-elite.svg", "map-question.svg", "map-campfire.svg"]) {
    assert.match(readFileSync(new URL(`./assets/route-signs/${icon}`, import.meta.url), "utf8"), /shape-rendering="crispEdges"/);
  }
  assert.match(readFileSync(new URL("./assets/route-signs/map-question.svg", import.meta.url), "utf8"), /viewBox="0 0 64 64"/);
  assert.match(readFileSync(new URL("./assets/route-signs/map-home.svg", import.meta.url), "utf8"), /shape-rendering="crispEdges"/);
});

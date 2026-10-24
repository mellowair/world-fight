import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateRouteMap, orderRouteOptionsByPosition, validateRouteMap } from "./routeMap.js";
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

test("route maps are layered DAGs with complete start reachability and Boss reachability", () => {
  let sawBranch = false;
  let sawMerge = false;
  let sawPartialChoice = false;
  for (let seed = 0; seed < 1000; seed += 1) {
    const map = generateRouteMap(seed);
    assert.equal(validateRouteMap(map), true, `seed ${seed}`);
    assert.equal(reachableNodes(map).size, map.nodes.length, `seed ${seed} has an isolated node`);
    assertPlayableWithoutRouteDeadEnds(map);
    assert.ok(map.eliteStep >= 3 && map.eliteStep <= 5);
    assert.ok(map.campfireStep >= map.eliteStep + 2 && map.campfireStep <= 8);
    const boss = map.nodes.find((node) => node.id === map.bossNodeId);
    assert.equal(boss.step, 10);
    assert.equal(boss.type, "demon");
    assert.ok(map.nodes.filter((node) => node.step === 9).length > 0);
    for (const node of map.nodes) {
      sawBranch ||= node.nextNodeIds.length > 1;
      const parentCount = map.nodes.filter((parent) => parent.nextNodeIds.includes(node.id)).length;
      sawMerge ||= parentCount > 1;
      const nextLayerWidth = map.nodes.filter((candidate) => candidate.step === node.step + 1).length;
      sawPartialChoice ||= node.nextNodeIds.length > 0 && node.nextNodeIds.length < nextLayerWidth;
      for (const nextId of node.nextNodeIds) {
        const child = map.nodes.find((candidate) => candidate.id === nextId);
        assert.ok(child.step > node.step, `edge ${node.id} -> ${nextId} must move upward`);
      }
      if (node.step < 10) assert.ok(node.nextNodeIds.length > 0, `${node.id} is a dead end`);
    }
  }
  assert.ok(sawBranch, "maps include meaningful forks");
  assert.ok(sawMerge, "maps include later merges");
  assert.ok(sawPartialChoice, "a node does not connect to every node in the next layer");
});

test("route type rules keep elites separate, late, and non-consecutive", () => {
  const counts = { battle: 0, elite: 0, question: 0, campfire: 0 };
  for (let seed = 0; seed < 1000; seed += 1) {
    const map = generateRouteMap(seed);
    for (const node of map.nodes.filter((entry) => entry.step > 0 && entry.step < 10)) {
      counts[node.type] += 1;
      if (node.step <= 2) assert.ok(["battle", "question"].includes(node.type));
      if (node.step === 9) assert.ok(["battle", "question"].includes(node.type));
      if (node.type === "elite") assert.ok(node.step >= 3 && node.step <= 8);
      if (node.type === "elite") {
        const parents = map.nodes.filter((parent) => parent.nextNodeIds.includes(node.id));
        assert.ok(parents.every((parent) => parent.type !== "elite"));
      }
    }
  }
  assert.ok(counts.battle > counts.elite);
  assert.ok(counts.question > counts.elite);
  assert.ok(counts.campfire > 0);
  assert.ok(counts.elite > 0);
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
  assert.match(app, /if \(routeMap\.currentNodeId === routeMap\.startNodeId\) openRouteMap\(\)/);
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

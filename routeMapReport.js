import { fileURLToPath } from "node:url";
import { analyzeRouteMap, generateRouteMap } from "./routeMap.js";

export function reportRouteMaps(seedCount = 1000) {
  if (!Number.isInteger(seedCount) || seedCount < 1) throw new RangeError("seedCount must be a positive integer");
  const report = {
    seeds: seedCount, fullRoutes: 0, totalRouteSteps: 0, shortest: Infinity, longest: 0,
    nodesBeforeSharedSuffix: 0, nodesAfterSharing: 0, sharedSuffixCopiesRemoved: 0,
    redundantChoices: 0, crossRowJoins: 0, crossings: 0, linesThroughNodes: 0,
    checkedEdges: 0, consecutiveCampfireEdges: 0, invalidPaths: 0,
    deadOrIsolatedNodes: 0, branchCounts: {},
    roomsOnRoutes: { battle: 0, elite: 0, question: 0, campfire: 0 },
    twoRoomsBeforeBoss: { battle: 0, elite: 0, question: 0, campfire: 0 },
  };
  for (let seed = 0; seed < seedCount; seed += 1) {
    const stats = analyzeRouteMap(generateRouteMap(seed));
    report.fullRoutes += stats.routeCount;
    report.totalRouteSteps += stats.averageLength * stats.routeCount;
    report.shortest = Math.min(report.shortest, stats.shortest);
    report.longest = Math.max(report.longest, stats.longest);
    report.nodesBeforeSharedSuffix += stats.unsharedNodeCount;
    report.nodesAfterSharing += stats.nodeCount;
    report.redundantChoices += stats.redundantChoices;
    report.crossRowJoins += stats.crossRowJoins;
    report.crossings += stats.crossings;
    report.linesThroughNodes += stats.throughNodes;
    report.checkedEdges += stats.edgeCount;
    report.consecutiveCampfireEdges += stats.consecutiveCampfires;
    report.invalidPaths += stats.invalidPaths;
    report.deadOrIsolatedNodes += stats.nodeCount - stats.reachableNodes;
    for (const count of stats.branchCounts) report.branchCounts[count] = (report.branchCounts[count] ?? 0) + 1;
    for (const [type, count] of Object.entries(stats.roomTotals)) report.roomsOnRoutes[type] += count;
    for (const [type, count] of Object.entries(stats.beforeBoss)) report.twoRoomsBeforeBoss[type] += count;
  }
  report.averageLength = report.totalRouteSteps / report.fullRoutes;
  report.sharedSuffixCopiesRemoved = report.nodesBeforeSharedSuffix - report.nodesAfterSharing;
  delete report.totalRouteSteps;
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`))) {
  console.log(JSON.stringify(reportRouteMaps(Number(process.argv[2] ?? 1000)), null, 2));
}

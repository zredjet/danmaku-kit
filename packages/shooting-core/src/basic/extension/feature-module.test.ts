import assert from "node:assert/strict";
import test from "node:test";

import { createCounterFeature } from "../test-support/feature-modules.ts";
import { resolveFeatureModules, selectEnabledFeatureModules } from "./feature-module.ts";

test("orders registered feature modules in canonical feature order and selects the enabled ones", () => {
  const modules = resolveFeatureModules([createCounterFeature("rank"), createCounterFeature("bomb"), createCounterFeature("pickup")]);

  assert.deepEqual(modules.map((module) => module.feature), ["bomb", "rank", "pickup"]);
  assert.deepEqual(selectEnabledFeatureModules(modules, ["pickup", "bomb"]).map((module) => module.feature), ["bomb", "pickup"]);
  assert.equal(Object.isFrozen(modules), true);
  assert.equal(Object.isFrozen(createCounterFeature("rank")), true);
});

test("rejects features that were not made by defineFeature, duplicates and invalid state versions", () => {
  const forged = { feature: "rank" };
  const rank = createCounterFeature("rank");
  const symbolKey = Object.getOwnPropertySymbols(rank)[0]!;
  const withModule = (change: Record<string, unknown>) => ({
    ...rank,
    [symbolKey]: { ...(rank as unknown as Record<symbol, Record<string, unknown>>)[symbolKey], ...change },
  });

  assert.throws(() => resolveFeatureModules("rank"), /features must be an array/);
  assert.throws(() => resolveFeatureModules([forged]), /made by defineFeature/);
  assert.throws(() => resolveFeatureModules([null]), /made by defineFeature/);
  assert.throws(() => resolveFeatureModules([rank, createCounterFeature("rank")]), /Duplicate optional feature module: rank/);
  assert.throws(() => resolveFeatureModules([withModule({ feature: "lunatic" })]), /Unknown optional feature module: lunatic/);
  assert.throws(() => resolveFeatureModules([withModule({ stateVersion: 0 })]), /stateVersion must be a positive safe integer: rank/);
  assert.deepEqual(resolveFeatureModules([]), []);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createCounterFeature } from "../test-support/feature-modules.ts";
import { defineFeature, freezeFeatureState, resolveFeatureModules, selectEnabledFeatureModules } from "./feature-module.ts";
import type { FeatureModule } from "./feature-module.ts";

const validModule: FeatureModule<null> = {
  feature: "rank",
  stateVersion: 1,
  validateContent: () => ({ errors: [], warnings: [] }),
  createInitialState: () => null,
  systems: {},
  serializeState: () => null,
  hashState: () => null,
  restoreState: () => ({ ok: true, value: null, warnings: [] }),
};

test("orders registered feature modules in canonical feature order and selects the enabled ones", () => {
  const modules = resolveFeatureModules([createCounterFeature("rank"), createCounterFeature("bomb"), createCounterFeature("pickup")]);

  assert.deepEqual(modules.map((module) => module.feature), ["bomb", "rank", "pickup"]);
  assert.deepEqual(selectEnabledFeatureModules(modules, ["pickup", "bomb"]).map((module) => module.feature), ["bomb", "pickup"]);
  assert.equal(Object.isFrozen(modules), true);
  assert.equal(Object.isFrozen(createCounterFeature("rank")), true);
  assert.deepEqual(resolveFeatureModules([]), []);
});

test("rejects features that were not made by defineFeature and duplicate features", () => {
  const rank = createCounterFeature("rank");
  const copied = { ...rank };

  assert.throws(() => resolveFeatureModules("rank"), /features must be an array/);
  assert.throws(() => resolveFeatureModules([{ feature: "rank" }]), /made by defineFeature/);
  // 本物の feature の symbol を写しても、defineFeature() が作った値ではない。
  assert.throws(() => resolveFeatureModules([copied]), /made by defineFeature/);
  assert.throws(() => resolveFeatureModules([null]), /made by defineFeature/);
  assert.throws(() => resolveFeatureModules([rank, createCounterFeature("rank")]), /Duplicate optional feature module: rank/);
});

test("rejects feature modules with an unknown feature, an invalid state version or missing hooks", () => {
  const define = (change: Record<string, unknown>) => () => defineFeature({ ...validModule, ...change } as FeatureModule<null>);

  assert.doesNotThrow(define({}));
  assert.throws(define({ feature: "lunatic" }), /Unknown optional feature module: lunatic/);
  assert.throws(define({ stateVersion: 0 }), /stateVersion must be a positive safe integer: rank/);
  assert.throws(define({ stateVersion: 1.5 }), /stateVersion must be a positive safe integer: rank/);
  assert.throws(define({ restoreState: undefined }), /restoreState must be a function: rank/);
  assert.throws(define({ systems: { cleanup: () => null } }), /systems must be functions keyed by spawn or scoring: rank/);
  assert.throws(define({ systems: { spawn: "count" } }), /systems must be functions keyed by spawn or scoring: rank/);
});

test("freezes JSON-compatible feature states and rejects other values", () => {
  const state = freezeFeatureState({ list: [1, { a: "b" }] });

  assert.deepEqual(state, { list: [1, { a: "b" }] });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(freezeFeatureState(null), null);
  assert.equal(freezeFeatureState(0), 0);
  assert.equal(freezeFeatureState({ n: Number.NaN }), undefined);
  assert.equal(freezeFeatureState({ n: undefined }), undefined);
  assert.equal(freezeFeatureState(new Map()), undefined);
});

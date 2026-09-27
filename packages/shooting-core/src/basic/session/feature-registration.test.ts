import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { LoadedGame } from "../api-types.ts";
import type { EnabledFeature, GameDefinition } from "../content/types.ts";
import { createShootingCore } from "../core.ts";
import type { ShootingCoreFeature } from "../extension/feature-module.ts";
import type { HashableGameState } from "../hash/hashable-state.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { SerializedGameState } from "../serialization/types.ts";
import { COUNTER_CONTENT_ERROR, createCounterFeature } from "../test-support/feature-modules.ts";
import { enableInternalTestHooksForTestFile } from "../test-support/internal-test-hooks.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../test-support/stage-harness.ts";
import { createShootingCoreWithTestingHooksForTest } from "../testing/testing-hooks.ts";

enableInternalTestHooksForTestFile();

function definitionWith(enabledFeatures: readonly EnabledFeature[]): GameDefinition {
  return { ...createMinimumDefinition(), enabledFeatures };
}

function loadGame(features: readonly ShootingCoreFeature[], enabledFeatures: readonly EnabledFeature[]): LoadedGame {
  const loaded = createShootingCore({ features }).load(definitionWith(enabledFeatures));
  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  return loaded.value;
}

function serializeAfterTicks(game: LoadedGame, ticks: number): SerializedGameState {
  const session = startStageFromLoadedGame(game);
  for (let tick = 0; tick < ticks; tick += 1) {
    assertTickOk(session.tick(createEmptyInputFrame(tick)), `tick ${tick}`);
  }
  return assertSerializeOk(session.serialize(), `serialize after ${ticks} ticks`);
}

const counterState = (ticks: number) => ({ spawns: ticks, scorings: ticks });

test("accepts enabled features only when the core has their module", () => {
  const unregistered = createShootingCore().load(definitionWith(["rank"]));
  const otherRegistered = createShootingCore({ features: [createCounterFeature("bomb")] }).load(definitionWith(["rank", "bomb"]));

  assert.deepEqual(!unregistered.ok && unregistered.errors.map((error) => [error.code, error.targetId]), [["feature.unsupported", "rank"]]);
  assert.deepEqual(!otherRegistered.ok && otherRegistered.errors.map((error) => [error.code, error.targetId]), [
    ["feature.unsupported", "rank"],
  ]);
  assert.equal(createShootingCore({ coreVersion: "1.2.3", features: [createCounterFeature("rank")] }).coreVersion, "1.2.3");
  assert.equal(createShootingCore("1.2.3").coreVersion, "1.2.3");
});

test("runs no feature hook for registered features that the definition does not enable", () => {
  const calls: string[] = [];
  const game = loadGame([createCounterFeature("rank", { calls })], []);

  assert.deepEqual(serializeAfterTicks(game, 3).state.enabledFeatureStates, []);
  assert.deepEqual(calls, []);
});

test("returns the content errors and warnings of enabled feature modules", () => {
  const warning = Object.freeze({ code: "pattern.neverFires", message: "counter warning" });
  const failing = createShootingCore({
    features: [createCounterFeature("rank", { content: { errors: [COUNTER_CONTENT_ERROR], warnings: [warning] } })],
  }).load(definitionWith(["rank"]));
  const warned = createShootingCore({ features: [createCounterFeature("rank", { content: { errors: [], warnings: [warning] } })] })
    .load(definitionWith(["rank"]));
  const brokenBasic = createShootingCore({
    features: [createCounterFeature("rank", { content: { errors: [COUNTER_CONTENT_ERROR], warnings: [] } })],
  }).load({ ...definitionWith(["rank"]), defaultPlayerId: "player.missing" });

  assert.deepEqual(!failing.ok && failing.errors, [COUNTER_CONTENT_ERROR]);
  assert.deepEqual(warned.ok && warned.warnings, [warning]);
  // basic の検証に通らない definition には feature の規則を当てない。
  assert.deepEqual(!brokenBasic.ok && brokenBasic.errors.map((error) => error.code), ["player.defaultNotFound"]);
});

test("runs feature systems at their tick slots in canonical feature order and serializes their states", () => {
  const calls: string[] = [];
  const game = loadGame([createCounterFeature("rank", { calls }), createCounterFeature("bomb", { calls })], ["rank", "bomb"]);

  const initial = serializeAfterTicks(game, 0);
  calls.length = 0;
  const serialized = serializeAfterTicks(game, 2);

  assert.deepEqual(initial.enabledFeatures, ["bomb", "rank"]);
  assert.deepEqual(initial.state.enabledFeatureStates, [
    { feature: "bomb", stateVersion: 1, payload: counterState(0) },
    { feature: "rank", stateVersion: 1, payload: counterState(0) },
  ]);
  assert.deepEqual(calls, [
    "bomb:spawn:0", "rank:spawn:0", "bomb:scoring:0", "rank:scoring:0",
    "bomb:spawn:1", "rank:spawn:1", "bomb:scoring:1", "rank:scoring:1",
  ]);
  assert.deepEqual(serialized.state.enabledFeatureStates.map((state) => state.payload), [counterState(2), counterState(2)]);
  assert.equal(Object.isFrozen(serialized.state.enabledFeatureStates[0]!.payload), true);
});

test("puts feature states into the hashable state in canonical feature order", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest(
    "0.0.0",
    { recordHashableStateOnSerialize: (state) => hashableStates.push(state) },
    [createCounterFeature("rank"), createCounterFeature("bomb")],
  ).load(definitionWith(["bomb", "rank"]));
  assert.ok(loaded.ok);
  const session = startStageFromLoadedGame(loaded.value);
  assertTickOk(session.tick(createEmptyInputFrame(0)), "tick 0");
  assertSerializeOk(session.serialize(), "serialize");

  assert.deepEqual(hashableStates.map((state) => state.enabledFeatureStates), [[
    { feature: "bomb", stateVersion: 1, payload: counterState(1) },
    { feature: "rank", stateVersion: 1, payload: counterState(1) },
  ]]);
});

test("restores feature states through their modules and continues identically", () => {
  const game = loadGame([createCounterFeature("rank"), createCounterFeature("bomb")], ["bomb", "rank"]);
  const snapshot = serializeAfterTicks(game, 3);
  const restored = game.restore(snapshot);
  assert.ok(restored.ok, JSON.stringify(restored.ok ? null : restored.errors));
  const source = game.restore(snapshot);
  assert.ok(source.ok);

  assert.deepEqual(assertSerializeOk(restored.value.serialize(), "restored serialize"), snapshot);
  for (let tick = 3; tick < 6; tick += 1) {
    assert.deepEqual(
      assertTickOk(restored.value.tick(createEmptyInputFrame(tick)), `restored tick ${tick}`),
      assertTickOk(source.value.tick(createEmptyInputFrame(tick)), `source tick ${tick}`),
    );
  }
  assert.deepEqual(assertSerializeOk(restored.value.serialize(), "restored final").state.enabledFeatureStates.map((state) => state.payload), [
    counterState(6),
    counterState(6),
  ]);
});

test("rejects feature states that do not match the enabled feature modules or their module rules", () => {
  const game = loadGame([createCounterFeature("rank"), createCounterFeature("bomb")], ["bomb", "rank"]);
  const snapshot = serializeAfterTicks(game, 2);
  const [bomb, rank] = snapshot.state.enabledFeatureStates;
  const withFeatureStates = (enabledFeatureStates: unknown[]) => game.restore({
    ...snapshot,
    state: { ...snapshot.state, enabledFeatureStates },
  } as SerializedGameState);
  const errorOf = (restored: ReturnType<LoadedGame["restore"]>) => (
    restored.ok ? null : [restored.errors[0]!.code, restored.errors[0]!.message]
  );

  assert.deepEqual(errorOf(withFeatureStates([bomb])), [
    "state.featureMismatch",
    "state.enabledFeatureStates must have one state for each enabled feature module in canonical feature order",
  ]);
  assert.equal(errorOf(withFeatureStates([rank, bomb]))?.[0], "state.featureMismatch");
  assert.equal(errorOf(withFeatureStates([bomb, rank, rank]))?.[0], "state.featureMismatch");
  assert.deepEqual(errorOf(withFeatureStates([bomb, { ...rank, stateVersion: 2 }])), [
    "state.featureMismatch",
    "unsupported rank feature stateVersion: 2",
  ]);
  assert.deepEqual(errorOf(withFeatureStates([bomb, { ...rank, payload: counterState(1) }])), [
    "state.invalidShape",
    "rank counter state must count every tick before expectedTick",
  ]);
  // module のない feature の state は、basic core だけの content でも受け付けない。
  const basicGame = loadGame([], []);
  const basic = serializeAfterTicks(basicGame, 1);
  const withExtra = basicGame.restore({ ...basic, state: { ...basic.state, enabledFeatureStates: [bomb!] } });
  assert.equal(!withExtra.ok && withExtra.errors[0]!.code, "state.featureMismatch");
});

test("latches a failing feature system as a stage session fatal error", () => {
  const game = loadGame([createCounterFeature("rank", { failScoringAtTick: 1 })], ["rank"]);
  const session = startStageFromLoadedGame(game);

  assertTickOk(session.tick(createEmptyInputFrame(0)), "tick 0");
  const failed = session.tick(createEmptyInputFrame(1));
  assert.equal(!failed.ok && failed.errors[0]!.code, "stageSession.fatal");
  assert.match(!failed.ok ? failed.errors[0]!.message : "", /rank counter failed at tick 1/);
  assert.equal(!session.serialize().ok, true);
});

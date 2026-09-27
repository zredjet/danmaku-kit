import assert from "node:assert/strict";
import test from "node:test";

import type { HashableGameState } from "./hashable-state.ts";
import { encodeCanonicalValue, fixedStruct } from "./canonical-encoder.ts";
import { adaptHashableGameStateToCanonicalValue } from "./hashable-game-state-adapter.ts";

test("adapts hashable game state through the fixed schema tables", () => {
  const state: HashableGameState = {
    stateHashVersion: 4,
    coreVersion: "core.test",
    schemaVersion: "1",
    expectedTick: 4,
    nextEntityId: 5,
    timelineCursor: 2,
    stageStatus: "playing",
    prngState: { state: 123 },
    score: 100,
    runtimeEntities: [
      {
        id: 4,
        kind: "playerShot",
        definitionId: "playerShot.basic",
        position: { x: 3, y: 4 },
        collisionRadius: 5,
        velocity: { x: 0, y: -8 },
        remainingLifetimeTicks: 12,
        damage: 3,
      },
      {
        id: 3,
        kind: "enemyBullet",
        definitionId: "bullet.red",
        position: { x: 10, y: 11 },
        collisionRadius: 4,
        velocity: { x: 0, y: 2 },
        spawnPosition: { x: 10, y: 5 },
        ageTicks: 3,
      },
      {
        id: 2,
        kind: "enemy",
        definitionId: "enemy.red",
        position: { x: 20, y: 21 },
        collisionRadius: 6,
        hp: 12,
        scoreOnKill: 200,
        pathId: "path.down",
        patternId: "pattern.basic",
        pathRunnerState: { segmentIndex: 1, segmentStart: { x: 20, y: 5 }, segmentElapsedTicks: 7 },
      },
      {
        id: 1,
        kind: "player",
        definitionId: "player.default",
        position: { x: 192, y: 400 },
        collisionRadius: 3,
        lives: 3,
        invincibleTicksRemaining: 0,
        nextShotAllowedTick: 4,
        movement: { speed: 4, focusSpeed: 1.8 },
        shotDefinitionId: "playerShot.basic",
      },
    ],
    pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
    patternRunnerStates: [
      {
        runnerId: "patternRunner.\u{10000}",
        patternId: "pattern.basic",
        stateVersion: 1,
        payload: { b: 2, a: 1 },
      },
      {
        runnerId: "patternRunner.\uE000",
        patternId: "pattern.basic",
        stateVersion: 1,
        payload: null,
      },
    ],
    enabledFeatureStates: [
      { feature: "rank", stateVersion: 1, payload: { value: 2 } },
      { feature: "bomb", stateVersion: 1, payload: { value: 1 } },
    ],
  };
  const runtimeEntityIdsBeforeAdapt = state.runtimeEntities.map((entity) => entity.id);
  const patternRunnerIdsBeforeAdapt = state.patternRunnerStates.map((state) => state.runnerId);
  const enabledFeaturesBeforeAdapt = state.enabledFeatureStates.map((state) => state.feature);

  const canonical = adaptHashableGameStateToCanonicalValue(state);
  const expected = fixedStruct("hashableGameState", [
    4,
    "core.test",
    "1",
    4,
    5,
    2,
    "playing",
    fixedStruct("prngState", [123]),
    100,
    [
      fixedStruct("playerRuntimeEntity", [
        1,
        "player",
        "player.default",
        fixedStruct("vector2", [192, 400]),
        3,
        3,
        0,
        4,
        fixedStruct("playerMovement", [4, 1.8]),
        "playerShot.basic",
      ]),
      fixedStruct("enemyRuntimeEntity", [
        2,
        "enemy",
        "enemy.red",
        fixedStruct("vector2", [20, 21]),
        6,
        12,
        200,
        "path.down",
        "pattern.basic",
        fixedStruct("enemyPathRunnerState", [1, fixedStruct("vector2", [20, 5]), 7]),
      ]),
      fixedStruct("enemyBulletRuntimeEntity", [
        3,
        "enemyBullet",
        "bullet.red",
        fixedStruct("vector2", [10, 11]),
        4,
        fixedStruct("vector2", [0, 2]),
        fixedStruct("vector2", [10, 5]),
        3,
      ]),
      fixedStruct("playerShotRuntimeEntity", [
        4,
        "playerShot",
        "playerShot.basic",
        fixedStruct("vector2", [3, 4]),
        5,
        fixedStruct("vector2", [0, -8]),
        12,
        3,
      ]),
    ],
    [fixedStruct("pendingEvent", ["stageStarted", 0, "stage.stage_01"])],
    [
      fixedStruct("patternRunnerState", ["patternRunner.\uE000", "pattern.basic", 1, null]),
      fixedStruct("patternRunnerState", ["patternRunner.\u{10000}", "pattern.basic", 1, { b: 2, a: 1 }]),
    ],
    [
      fixedStruct("enabledFeatureState", ["bomb", 1, { value: 1 }]),
      fixedStruct("enabledFeatureState", ["rank", 1, { value: 2 }]),
    ],
  ]);

  assert.equal(Object.isFrozen(canonical), true);
  assert.deepEqual(encodeCanonicalValue(canonical), encodeCanonicalValue(expected));
  assert.deepEqual(state.runtimeEntities.map((entity) => entity.id), runtimeEntityIdsBeforeAdapt);
  assert.deepEqual(state.patternRunnerStates.map((runner) => runner.runnerId), patternRunnerIdsBeforeAdapt);
  assert.deepEqual(state.enabledFeatureStates.map((feature) => feature.feature), enabledFeaturesBeforeAdapt);
});

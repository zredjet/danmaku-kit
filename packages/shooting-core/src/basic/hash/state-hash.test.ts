import assert from "node:assert/strict";
import test from "node:test";

import type { HashableGameState } from "./hashable-state.ts";
import { hashHashableGameState, hashHashablePrngState } from "./state-hash.ts";

function createHashableState(): HashableGameState {
  return {
    stateHashVersion: 4,
    coreVersion: "core.test",
    schemaVersion: "1",
    expectedTick: 4,
    nextEntityId: 2,
    timelineCursor: 1,
    stageStatus: "playing",
    prngState: { state: 123 },
    score: 100,
    runtimeEntities: [{
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
    }],
    pendingEvents: [],
    patternRunnerStates: [],
    enabledFeatureStates: [],
  };
}

test("hashes canonical game state with the fixed xxHash64 seed", () => {
  const state = createHashableState();
  assert.equal(hashHashableGameState(state), "4ba0fdab14cca5ce");
  assert.equal(hashHashableGameState({
    ...state,
    runtimeEntities: [{
      ...state.runtimeEntities[0]!,
      position: { x: -0, y: 400 },
    }],
  }), hashHashableGameState({
    ...state,
    runtimeEntities: [{
      ...state.runtimeEntities[0]!,
      position: { x: 0, y: 400 },
    }],
  }));
  assert.notEqual(hashHashableGameState({
    ...state,
    pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
  }), hashHashableGameState(state));
});

test("hashes PRNG state with the canonical fixedStruct format", () => {
  assert.equal(hashHashablePrngState({ state: 123 }), "8e77c99ada533b2c");
  assert.notEqual(hashHashablePrngState({ state: 123 }), hashHashablePrngState({ state: 124 }));
});

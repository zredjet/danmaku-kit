import assert from "node:assert/strict";
import test from "node:test";

import { HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER } from "../entities/player/snapshot.ts";
import {
  HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER,
  HASHABLE_FIXED_STRUCT_NAME_BY_DTO,
  HASHABLE_GAME_STATE_FIELD_ORDER,
  HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER,
  HASHABLE_PENDING_EVENT_FIELD_ORDER,
  HASHABLE_PRNG_STATE_FIELD_ORDER,
  HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND,
  HASHABLE_VECTOR2_FIELD_ORDER,
} from "./hashable-state.ts";

test("fixes and freezes hashable canonical schema tables", () => {
  assert.equal(Object.isFrozen(HASHABLE_FIXED_STRUCT_NAME_BY_DTO), true);
  assert.equal(Object.isFrozen(HASHABLE_PRNG_STATE_FIELD_ORDER), true);
  assert.equal(Object.isFrozen(HASHABLE_VECTOR2_FIELD_ORDER), true);
  assert.equal(Object.isFrozen(HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER), true);
  assert.equal(Object.isFrozen(HASHABLE_GAME_STATE_FIELD_ORDER), true);
  assert.equal(Object.isFrozen(HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND), true);
  assert.equal(Object.isFrozen(HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.player), true);
  assert.equal(Object.isFrozen(HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.enemy), true);
  assert.equal(Object.isFrozen(HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.enemyBullet), true);
  assert.equal(Object.isFrozen(HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.playerShot), true);
  assert.equal(Object.isFrozen(HASHABLE_PENDING_EVENT_FIELD_ORDER), true);
  assert.equal(Object.isFrozen(HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER), true);
  assert.equal(Object.isFrozen(HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER), true);

  assert.deepEqual({
    fixedStructNames: HASHABLE_FIXED_STRUCT_NAME_BY_DTO,
    prng: HASHABLE_PRNG_STATE_FIELD_ORDER,
    vector2: HASHABLE_VECTOR2_FIELD_ORDER,
    playerMovement: HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER,
    gameState: HASHABLE_GAME_STATE_FIELD_ORDER,
    runtimeEntities: HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND,
    pendingEvent: HASHABLE_PENDING_EVENT_FIELD_ORDER,
    patternRunnerState: HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER,
    enabledFeatureState: HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER,
  }, {
    fixedStructNames: {
      gameState: "hashableGameState",
      prngState: "prngState",
      vector2: "vector2",
      playerMovement: "playerMovement",
      playerRuntimeEntity: "playerRuntimeEntity",
      enemyRuntimeEntity: "enemyRuntimeEntity",
      enemyBulletRuntimeEntity: "enemyBulletRuntimeEntity",
      playerShotRuntimeEntity: "playerShotRuntimeEntity",
      pendingEvent: "pendingEvent",
      patternRunnerState: "patternRunnerState",
      enabledFeatureState: "enabledFeatureState",
    },
    prng: ["state"],
    vector2: ["x", "y"],
    playerMovement: ["speed", "focusSpeed"],
    gameState: [
      "stateHashVersion",
      "coreVersion",
      "schemaVersion",
      "expectedTick",
      "nextEntityId",
      "timelineCursor",
      "prngState",
      "score",
      "runtimeEntities",
      "pendingEvents",
      "patternRunnerStates",
      "enabledFeatureStates",
    ],
    runtimeEntities: {
      player: [
        "id",
        "kind",
        "definitionId",
        "position",
        "collisionRadius",
        "lives",
        "invincibleTicksRemaining",
        "nextShotAllowedTick",
        "movement",
        "shotDefinitionId",
      ],
      enemy: [
        "id",
        "kind",
        "definitionId",
        "position",
        "collisionRadius",
        "hp",
        "scoreOnKill",
        "pathId",
        "patternId",
      ],
      enemyBullet: ["id", "kind", "definitionId", "position", "collisionRadius"],
      playerShot: [
        "id",
        "kind",
        "definitionId",
        "position",
        "collisionRadius",
        "velocity",
        "remainingLifetimeTicks",
        "damage",
      ],
    },
    pendingEvent: ["type", "tick", "stageId"],
    patternRunnerState: ["runnerId", "patternId", "stateVersion", "payload"],
    enabledFeatureState: ["feature", "stateVersion", "payload"],
  });

  const originalGameStateOrder = [...HASHABLE_GAME_STATE_FIELD_ORDER];
  assert.throws(
    () => (HASHABLE_GAME_STATE_FIELD_ORDER as unknown as string[]).reverse(),
    TypeError,
  );
  assert.deepEqual(HASHABLE_GAME_STATE_FIELD_ORDER, originalGameStateOrder);

  assert.throws(
    () => {
      (HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND as unknown as { player: string[] }).player = [];
    },
    TypeError,
  );
});

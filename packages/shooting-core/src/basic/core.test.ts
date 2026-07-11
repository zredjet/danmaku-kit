import assert from "node:assert/strict";
import test from "node:test";

import {
  HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER,
  HASHABLE_FIXED_STRUCT_NAME_BY_DTO,
  HASHABLE_GAME_STATE_FIELD_ORDER,
  HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER,
  HASHABLE_PENDING_EVENT_FIELD_ORDER,
  HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER,
  HASHABLE_PRNG_STATE_FIELD_ORDER,
  HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND,
  HASHABLE_VECTOR2_FIELD_ORDER,
  createShootingCore,
  createShootingCoreWithTestingHooksForInternalTest,
} from "./core.ts";
import type { HashableGameState, LoadedGame, ShootingCore, StageSession, StartStageOptions } from "./core.ts";
import type { GameDefinition } from "./content/types.ts";
import { validateGameDefinition } from "./content/validation.ts";
import { createEmptyInputFrame } from "./input/input-frame.ts";
import type { InputFrame } from "./input/input-frame.ts";
import { createShootingCoreWithTestingHooksForTest } from "./internal/testing-hooks.ts";
import { hashHashableGameState } from "./hash/state-hash.ts";
import { findFirstStateHashDivergence } from "./testing/state-hash-comparison.ts";
import type { CoreErrorCode } from "./result.ts";
import type { SerializedGameState } from "./serialization/types.ts";
import { createMinimumDefinition } from "../../../../tests/fixtures/minimum-game-definition.ts";

const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
if (testEnv) {
  testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS = "1";
}

test("loads valid minimum content and advances deterministic ticks", () => {
  const loaded = createShootingCore("0.0.0").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(loaded.ok && Object.isFrozen(loaded.warnings), true);

  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  assert.equal(Object.isFrozen(loaded.value), true);

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  assert.equal(Object.isFrozen(started), true);

  if (!started.ok) {
    assert.fail("expected stage session");
  }
  assert.equal(Object.isFrozen(started.value), true);

  const frame0 = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  assert.equal(Object.isFrozen(frame0), true);
  assert.equal(frame0.ok && frame0.value.tick, 0);
  assert.deepEqual(frame0.ok && frame0.value.events.map((event) => event.type), [
    "stageStarted",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame0.ok && frame0.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
  ]);

  const frame1 = started.value.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.equal(frame1.ok && frame1.value.state.score, 0);
});

test("serializes initial stage state with metadata and pending startup event", () => {
  const loaded = createShootingCore("core.test").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.deepEqual(serialized.value, {
    coreVersion: "core.test",
    schemaVersion: "1",
    contentVersion: "content.0",
    inputFormatVersion: "1",
    stateHashVersion: 1,
    enabledFeatures: [],
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.default",
    expectedTick: 0,
    nextEntityId: 2,
    prngState: { state: 3597787782 },
    state: {
      runtimeEntities: [{
        id: 1,
        kind: "player",
        definitionId: "player.default",
        position: { x: 192, y: 400 },
        collisionRadius: 3,
        lives: 3,
        invincibleTicksRemaining: 0,
        nextShotAllowedTick: 0,
        movement: { speed: 4, focusSpeed: 1.8 },
        shotDefinitionId: "playerShot.basic",
      }],
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
      score: 0,
      timelineCursor: 0,
      patternRunnerStates: [],
      enabledFeatureStates: [],
    },
  });
  assert.equal(Object.isFrozen(serialized.value), true);
  assert.equal(Object.isFrozen(serialized.value.state), true);
  assert.equal(Object.isFrozen(serialized.value.enabledFeatures), true);
  assert.equal(Object.isFrozen(serialized.value.prngState), true);
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities), true);
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities[0]), true);
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities[0]!.position), true);
  assert.equal(Object.isFrozen(serialized.value.state.pendingEvents), true);
  assert.equal(Object.isFrozen(serialized.value.state.pendingEvents[0]), true);
  assert.equal(Object.isFrozen(serialized.value.state.patternRunnerStates), true);
  assert.equal(Object.isFrozen(serialized.value.state.enabledFeatureStates), true);
  if (serialized.value.state.runtimeEntities[0]?.kind !== "player") {
    assert.fail("expected serialized player entity");
  }
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities[0].movement), true);

  const frameAfterSerialize = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frameAfterSerialize.ok, true);
  assert.deepEqual(frameAfterSerialize.ok && frameAfterSerialize.value.events.map((event) => event.type), [
    "stageStarted",
    "tickAdvanced",
  ]);
});

test("records hashable state from committed state without public-only metadata", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => hashableStates.push(state),
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);

  const serialized = assertSerializeOk(started.serialize(), "initial serialize with hashable state");
  assert.equal(hashableStates.length, 1);
  assert.deepEqual(hashableStates[0], {
    stateHashVersion: 1,
    coreVersion: "core.test",
    schemaVersion: "1",
    expectedTick: 0,
    nextEntityId: 2,
    timelineCursor: 0,
    prngState: { state: 3597787782 },
    score: 0,
    runtimeEntities: [{
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 0,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    }],
    pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
    patternRunnerStates: [],
    enabledFeatureStates: [],
  });
  assert.equal("contentVersion" in hashableStates[0]!, false);
  assert.equal("inputFormatVersion" in hashableStates[0]!, false);
  assert.equal("enabledFeatures" in hashableStates[0]!, false);
  assert.equal("stageId" in hashableStates[0]!, false);
  assert.equal("difficulty" in hashableStates[0]!, false);
  assert.equal("playerId" in hashableStates[0]!, false);

  const restored = loaded.value.restore(serialized);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected initial snapshot restore");
  }
  assert.deepEqual(assertSerializeOk(restored.value.serialize(), "initial restored serialize with hashable state"), serialized);
  assert.equal(hashableStates.length, 2);
  assert.deepEqual(hashableStates[1], hashableStates[0]);
});

test("serializes runtime entities after tick without drained frame events", () => {
  const started = startMinimumStage();
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.expectedTick, 1);
  assert.equal(serialized.value.nextEntityId, 3);
  assert.equal(serialized.value.prngState.state, 2919998806);
  assert.deepEqual(serialized.value.state.pendingEvents, []);
  assert.deepEqual(serialized.value.state.runtimeEntities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 3,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
      collisionRadius: 5,
      velocity: { x: 0, y: -8 },
      remainingLifetimeTicks: 3,
      damage: 5,
    },
  ]);
});

test("records identical hashable state after restore roundtrip", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => hashableStates.push(state),
  }).load(createFireOnSpawnAtZeroDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  const frame = assertTickOk(started.tick(createShotInputFrame(0)), "source tick before hashable state");
  assert.ok(frame.events.length > 0);

  const serialized = assertSerializeOk(started.serialize(), "source serialize with hashable state");
  assert.equal(hashableStates.length, 1);
  const expectedHashableState: HashableGameState = {
    stateHashVersion: 1,
    coreVersion: "core.test",
    schemaVersion: "1",
    expectedTick: 1,
    nextEntityId: 5,
    timelineCursor: 1,
    prngState: { state: 2919998806 },
    score: 0,
    runtimeEntities: [
      {
        id: 1,
        kind: "player",
        definitionId: "player.default",
        position: { x: 192, y: 400 },
        collisionRadius: 3,
        lives: 3,
        invincibleTicksRemaining: 0,
        nextShotAllowedTick: 3,
        movement: { speed: 4, focusSpeed: 1.8 },
        shotDefinitionId: "playerShot.basic",
      },
      {
        id: 2,
        kind: "enemy",
        definitionId: "enemy.scout",
        position: { x: 192, y: 80 },
        collisionRadius: 12,
        hp: 10,
        scoreOnKill: 100,
        pathId: "path.none",
        patternId: "pattern.spawn_bullet",
      },
      {
        id: 3,
        kind: "enemyBullet",
        definitionId: "bullet.red_small",
        position: { x: 192, y: 88 },
        collisionRadius: 4,
      },
      {
        id: 4,
        kind: "playerShot",
        definitionId: "playerShot.basic",
        position: { x: 192, y: 392 },
        collisionRadius: 5,
        velocity: { x: 0, y: -8 },
        remainingLifetimeTicks: 3,
        damage: 5,
      },
    ],
    pendingEvents: [],
    patternRunnerStates: [],
    enabledFeatureStates: [],
  };
  assert.deepEqual(hashableStates[0], expectedHashableState);

  const restored = loaded.value.restore(serialized);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }
  const restoredSerialized = assertSerializeOk(restored.value.serialize(), "restored serialize with hashable state");
  assert.deepEqual(restoredSerialized, serialized);
  assert.equal(hashableStates.length, 2);
  assert.deepEqual(hashableStates[1], expectedHashableState);
  assert.equal(hashHashableGameState(hashableStates[1]!), hashHashableGameState(hashableStates[0]!));
});

test("reports the first divergent tick from deterministic game-state hashes", () => {
  const inputs = [createShotInputFrame(0), createEmptyInputFrame(1)] as const;
  const expected = collectStateHashSamples(createFireOnSpawnAtZeroDefinition(), inputs);
  assert.equal(findFirstStateHashDivergence(expected, collectStateHashSamples(createFireOnSpawnAtZeroDefinition(), inputs)), null);

  const divergence = findFirstStateHashDivergence(
    expected,
    collectStateHashSamples(createFireOnSpawnAtZeroDefinition(), [createEmptyInputFrame(0), createEmptyInputFrame(1)]),
  );
  assert.notEqual(divergence, null);
  assert.equal(divergence?.tick, 0);
  assert.notEqual(divergence?.expectedHash, divergence?.actualHash);
});

test("fixes gameplay state-hash digest goldens for score and player-hit transitions", () => {
  assert.deepEqual(
    collectStateHashSamples(createCollisionScoreDefinition(), [createShotInputFrame(0), createShotInputFrame(1)])
      .map((sample) => sample.hash),
    ["2490a1ae8b02c18a", "b19bf9f28b4f72c0"],
  );
  assert.deepEqual(
    collectStateHashSamples(createEnemyBulletHitDefinition(), [createEmptyInputFrame(0), createEmptyInputFrame(1)])
      .map((sample) => sample.hash),
    ["ff1d29955eb1f798", "4cc55a8a9ff6b4e9"],
  );
});

test("keeps state-hash digests equal after restore across later ticks", () => {
  const states: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => states.push(state),
  }).load(createFireOnSpawnAtZeroDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const source = startStageFromLoadedGame(loaded.value);
  assertTickOk(source.tick(createShotInputFrame(0)), "state-hash source tick 0");
  const sourceSnapshot = serializeAndCaptureStateHash(source, states, "state-hash source snapshot");
  const restored = loaded.value.restore(sourceSnapshot.snapshot);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }

  const sourceDigests: string[] = [];
  const restoredDigests: string[] = [];
  for (const input of [createEmptyInputFrame(1), createEmptyInputFrame(2)]) {
    assertTickOk(source.tick(input), `state-hash source tick ${input.tick}`);
    sourceDigests.push(serializeAndCaptureStateHash(source, states, `state-hash source serialize ${input.tick}`).hash);

    assertTickOk(restored.value.tick(input), `state-hash restored tick ${input.tick}`);
    restoredDigests.push(serializeAndCaptureStateHash(
      restored.value,
      states,
      `state-hash restored serialize ${input.tick}`,
    ).hash);
  }
  assert.deepEqual(restoredDigests, sourceDigests);
});

test("excludes drained collision events from the restored state-hash digest", () => {
  const states: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => states.push(state),
  }).load(createCollisionScoreDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const source = startStageFromLoadedGame(loaded.value);
  const frame = assertTickOk(source.tick(createShotInputFrame(0)), "state-hash collision tick");
  assert.deepEqual(frame.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "playerShotsSpawnedBatch",
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
    "tickAdvanced",
  ]);
  const sourceSnapshot = serializeAndCaptureStateHash(source, states, "state-hash collision snapshot");
  assert.deepEqual(sourceSnapshot.snapshot.state.pendingEvents, []);

  const restored = loaded.value.restore(sourceSnapshot.snapshot);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored collision session");
  }
  const restoredSnapshot = serializeAndCaptureStateHash(restored.value, states, "state-hash restored collision snapshot");
  assert.equal(restoredSnapshot.hash, sourceSnapshot.hash);
});

test("records hashable state from committed state despite serialize-only test mutations", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    overrideCommittedNextEntityIdOnSerialize: 100,
    overrideCommittedPrngStateOnSerialize: { state: 1 },
    recordHashableStateOnSerialize: (state) => hashableStates.push(state),
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);

  const serialized = assertSerializeOk(started.serialize(), "serialize with a valid test-only override");
  assert.equal(serialized.nextEntityId, 100);
  assert.equal(serialized.prngState.state, 1);
  assert.equal(hashableStates.length, 1);
  assert.equal(hashableStates[0]?.nextEntityId, 2);
  assert.equal(hashableStates[0]?.prngState.state, 3597787782);

  const committedSerialized = assertSerializeOk(started.serialize(), "repeated serialize with a test-only override");
  assert.equal(committedSerialized.nextEntityId, 100);
  assert.equal(committedSerialized.prngState.state, 1);
  assert.equal(hashableStates.length, 2);
  assert.equal(hashableStates[1]?.nextEntityId, 2);
  assert.equal(hashableStates[1]?.prngState.state, 3597787782);
});

test("records nonzero score in hashable state after collision scoring", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => hashableStates.push(state),
  }).load(createCollisionScoreDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);

  assertTickOk(started.tick(createShotInputFrame(0)), "collision score tick before hashable state");
  assertSerializeOk(started.serialize(), "serialize collision score state");

  assert.equal(hashableStates.length, 1);
  assert.equal(hashableStates[0]?.score, 100);
  assert.deepEqual(hashableStates[0]?.runtimeEntities.map((entity) => entity.kind), ["player"]);
});

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

test("test-only hashable state hook exceptions do not latch fatal state", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: () => {
      throw new Error("hashable hook failure");
    },
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);

  assert.throws(
    () => started.serialize(),
    /hashable hook failure/,
  );
  const frame = assertTickOk(started.tick(createEmptyInputFrame(0)), "tick after throwing hashable hook");
  assert.deepEqual(frame.events.map((event) => event.type), ["stageStarted", "tickAdvanced"]);
});

test("serializes selected player and difficulty metadata", () => {
  const loaded = createShootingCore("core.test").load(createAlternatePlayerHardDifficultyDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "hard",
    playerId: "player.alt",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.difficulty, "hard");
  assert.equal(serialized.value.playerId, "player.alt");
  assert.deepEqual(serialized.value.state.runtimeEntities[0], {
    id: 1,
    kind: "player",
    definitionId: "player.alt",
    position: { x: 192, y: 400 },
    collisionRadius: 2,
    lives: 5,
    invincibleTicksRemaining: 0,
    nextShotAllowedTick: 0,
    movement: { speed: 5, focusSpeed: 2 },
    shotDefinitionId: "playerShot.basic",
  });
});

test("serializes enemy and enemy bullet runtime entities", () => {
  const started = startStageFromDefinition(createFireOnSpawnAtZeroDefinition());
  const frame = started.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  assert.deepEqual(serialized.value.state.runtimeEntities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 0,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: 80 },
      collisionRadius: 12,
      hp: 10,
      scoreOnKill: 100,
      pathId: "path.none",
      patternId: "pattern.spawn_bullet",
    },
    {
      id: 3,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 192, y: 88 },
      collisionRadius: 4,
    },
  ]);
});

test("serializes updated score and timeline cursor after collision scoring", () => {
  const started = startStageFromDefinition(createCollisionScoreDefinition());
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.expectedTick, 1);
  assert.equal(serialized.value.state.score, 100);
  assert.equal(serialized.value.state.timelineCursor, 1);
  assert.deepEqual(serialized.value.state.runtimeEntities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 3,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    },
  ]);
});

test("returns immutable serialized snapshots independent from caller-owned clones", () => {
  const started = startMinimumStage();
  const first = started.serialize();
  assert.equal(first.ok, true);
  if (!first.ok) {
    assert.fail("expected serialized state");
  }

  assert.throws(
    () => (first.value.state.runtimeEntities as unknown as unknown[]).push({}),
    TypeError,
  );
  assert.throws(
    () => (first.value.state.patternRunnerStates as unknown as unknown[]).push({}),
    TypeError,
  );
  assert.throws(
    () => (first.value.state.enabledFeatureStates as unknown as unknown[]).push({}),
    TypeError,
  );
  assert.throws(
    () => ((first.value.prngState as unknown as { state: number }).state = 0),
    TypeError,
  );
  assert.throws(
    () => ((first.value.state.pendingEvents[0] as unknown as { stageId: string }).stageId = "stage.changed"),
    TypeError,
  );
  const serializedPlayer = first.value.state.runtimeEntities[0];
  assert.equal(serializedPlayer?.kind, "player");
  if (serializedPlayer?.kind !== "player") {
    assert.fail("expected serialized player entity");
  }
  assert.throws(
    () => ((serializedPlayer.position as unknown as { x: number }).x = 0),
    TypeError,
  );
  assert.throws(
    () => ((serializedPlayer.movement as unknown as { speed: number }).speed = 0),
    TypeError,
  );

  const mutableClone = JSON.parse(JSON.stringify(first.value)) as {
    state: { runtimeEntities: Array<{ position: { x: number } }> };
  };
  mutableClone.state.runtimeEntities[0]!.position.x = 0;

  const second = started.serialize();
  assert.equal(second.ok, true);
  assert.deepEqual(second.ok && second.value, first.value);
});

test("restore rejects malformed top-level serialized state without throwing", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectInvalidShape = (state: unknown, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectInvalidShape(null, /plain data/);
  expectInvalidShape({ ...validState, extra: true }, /unknown top-level/);
  const nonEnumerableExtra = { ...validState } as Record<string, unknown>;
  Object.defineProperty(nonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectInvalidShape(nonEnumerableExtra, /plain data/);
  expectInvalidShape({ ...validState, coreVersion: 1 }, /coreVersion/);
  expectInvalidShape({ ...validState, coreVersion: "x".repeat(8_193) }, /coreVersion/);
  expectInvalidShape({ ...validState, schemaVersion: 1 }, /schemaVersion/);
  expectInvalidShape({ ...validState, contentVersion: 1 }, /contentVersion/);
  expectInvalidShape({ ...validState, inputFormatVersion: 1 }, /inputFormatVersion/);
  expectInvalidShape({ ...validState, stateHashVersion: "1" }, /stateHashVersion/);
  expectInvalidShape({ ...validState, stateHashVersion: Number.NaN }, /stateHashVersion/);
  expectInvalidShape({ ...validState, stageId: "enemy.scout" }, /stageId/);
  expectInvalidShape({ ...validState, difficulty: "lunatic" }, /difficulty/);
  expectInvalidShape({ ...validState, playerId: "enemy.scout" }, /playerId/);
  expectInvalidShape({ ...validState, expectedTick: -1 }, /expectedTick/);
  expectInvalidShape({ ...validState, expectedTick: 1.5 }, /expectedTick/);
  expectInvalidShape({ ...validState, expectedTick: Number.MAX_SAFE_INTEGER + 1 }, /expectedTick/);
  expectInvalidShape({ ...validState, expectedTick: Infinity }, /expectedTick/);
  expectInvalidShape({ ...validState, nextEntityId: 0 }, /nextEntityId/);
  expectInvalidShape({ ...validState, nextEntityId: 1.5 }, /nextEntityId/);
  expectInvalidShape({ ...validState, nextEntityId: Number.MAX_SAFE_INTEGER + 1 }, /nextEntityId/);
  expectInvalidShape({ ...validState, nextEntityId: Number.NaN }, /nextEntityId/);
  expectInvalidShape({ ...validState, prngState: null }, /prngState/);
  expectInvalidShape({ ...validState, prngState: [] }, /prngState/);
  expectInvalidShape({ ...validState, state: null }, /state must be an object/);
  expectInvalidShape({ ...validState, state: [] }, /state must be an object/);

  for (const key of Object.keys(validState)) {
    const missingFieldState = { ...validState } as Record<string, unknown>;
    delete missingFieldState[key];
    expectInvalidShape(missingFieldState, /must be|must use|unknown top-level|must contain/);
  }
});

test("restore rejects malformed enabledFeatures metadata without throwing", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectInvalidShape = (state: unknown, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectInvalidShape({ ...validState, enabledFeatures: ["bomb", 1] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: ["bomb", "bomb"] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: ["unknownFeature", "unknownFeature"] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: ["graze", "bomb"] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: Array.from({ length: 65 }, (_, index) => `unknownFeature${index}`) }, /enabledFeatures/);
  const sparseFeatures: unknown[] = [];
  sparseFeatures.length = 1;
  expectInvalidShape({ ...validState, enabledFeatures: sparseFeatures }, /enabledFeatures/);
  const invalidLengthFeatures = new Proxy([], {
    get(target, property, receiver) {
      if (property === "length") {
        return "not-a-length";
      }
      return Reflect.get(target, property, receiver);
    },
  });
  expectInvalidShape({ ...validState, enabledFeatures: invalidLengthFeatures }, /enabledFeatures/);
  const accessorFeatures = Object.defineProperty([], "0", {
    enumerable: true,
    get() {
      throw new Error("feature boom");
    },
  });
  Object.defineProperty(accessorFeatures, "length", { value: 1 });
  expectInvalidShape({ ...validState, enabledFeatures: accessorFeatures }, /enabledFeatures/);
  const customPropertyFeatures = Object.assign(["bomb"], { extra: true });
  expectInvalidShape({ ...validState, enabledFeatures: customPropertyFeatures }, /enabledFeatures/);
  const nonEnumerableFeatureProperty = ["bomb"];
  Object.defineProperty(nonEnumerableFeatureProperty, "extra", { enumerable: false, value: true });
  expectInvalidShape({ ...validState, enabledFeatures: nonEnumerableFeatureProperty }, /enabledFeatures/);
  const inheritedFeatureProperty = ["bomb"];
  Object.setPrototypeOf(inheritedFeatureProperty, { inherited: true });
  expectInvalidShape({ ...validState, enabledFeatures: inheritedFeatureProperty }, /enabledFeatures/);
  const symbolFeatures = ["bomb"] as unknown[];
  Object.defineProperty(symbolFeatures, Symbol("feature"), { enumerable: true, value: true });
  expectInvalidShape({ ...validState, enabledFeatures: symbolFeatures }, /enabledFeatures/);
  const revokedFeatures = Proxy.revocable([], {});
  revokedFeatures.revoke();
  expectInvalidShape({ ...validState, enabledFeatures: revokedFeatures.proxy }, /enabledFeatures/);
});

test("restore rejects hostile serialized state inputs without throwing", () => {
  const loaded = loadMinimumGame("core.test");

  const throwingGetter = Object.defineProperty({}, "coreVersion", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const cyclicState: Record<string, unknown> = {};
  cyclicState.self = cyclicState;
  const throwingNestedProxy = {
    ...serializeInitialStageState("core.test"),
    state: new Proxy({}, {
      getPrototypeOf() {
        throw new Error("nested boom");
      },
    }),
  };

  for (const [state, detail] of [
    [throwingGetter, /plain data/],
    [cyclicState, /coreVersion/],
    [throwingNestedProxy, /state must be an object/],
  ] as const) {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  }
});

test("restore classifies top-level compatibility mismatches", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectRestoreError = (state: SerializedGameState, code: CoreErrorCode) => {
    const restored = loaded.restore(state);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
  };

  expectRestoreError({ ...validState, coreVersion: "other.core" }, "state.coreVersionMismatch");
  expectRestoreError({ ...validState, schemaVersion: "2" }, "state.schemaVersionMismatch");
  expectRestoreError({ ...validState, inputFormatVersion: "2" }, "state.inputFormatVersionMismatch");
  expectRestoreError({ ...validState, stateHashVersion: 2 }, "state.stateHashVersionMismatch");
  expectRestoreError({ ...validState, contentVersion: "content.other" }, "state.contentMismatch");
  expectRestoreError({ ...validState, stageId: "stage.missing" }, "state.contentMismatch");
  expectRestoreError({ ...validState, difficulty: "hard" }, "state.contentMismatch");
  expectRestoreError({ ...validState, playerId: "player.missing" }, "state.contentMismatch");
  expectRestoreError({ ...validState, enabledFeatures: ["bomb"] }, "state.featureMismatch");
  expectRestoreError({ ...validState, enabledFeatures: ["unknownFeature"] } as unknown as SerializedGameState, "state.featureMismatch");
  for (const [state, code] of [
    [{ ...validState, coreVersion: "other.core", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.coreVersionMismatch"],
    [{ ...validState, coreVersion: "other.core", state: [] }, "state.coreVersionMismatch"],
    [{ ...validState, schemaVersion: "2", difficulty: "lunatic", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.schemaVersionMismatch"],
    [{ ...validState, schemaVersion: "2", futureTopLevelField: true }, "state.schemaVersionMismatch"],
    [{ ...validState, schemaVersion: "2", prngState: null }, "state.schemaVersionMismatch"],
    [{ ...validState, inputFormatVersion: "2", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.inputFormatVersionMismatch"],
    [{ ...validState, inputFormatVersion: "2", futureTopLevelField: true }, "state.inputFormatVersionMismatch"],
    [{ ...validState, stateHashVersion: 2, state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.stateHashVersionMismatch"],
    [{ ...validState, stateHashVersion: 2, futureTopLevelField: true }, "state.stateHashVersionMismatch"],
    [{ ...validState, contentVersion: "content.other", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.contentMismatch"],
    [{ ...validState, contentVersion: "content.other", futureTopLevelField: true }, "state.contentMismatch"],
    [{ ...validState, stageId: "stage.missing", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.contentMismatch"],
    [{ ...validState, stageId: "stage.missing", state: [] }, "state.contentMismatch"],
    [{ ...validState, enabledFeatures: ["unknownFeature"], state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.featureMismatch"],
    [{ ...validState, enabledFeatures: ["unknownFeature"], prngState: null }, "state.featureMismatch"],
  ] as const) {
    expectRestoreError(state as unknown as SerializedGameState, code);
  }
});

test("restore validates deterministic payload before accepting a session", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectRestoreError = (state: unknown, code: CoreErrorCode, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectRestoreError({ ...validState, prngState: { state: 0 } }, "state.prngInvalid", /prngState/);
  expectRestoreError({ ...validState, prngState: { state: "not-a-prng-state" } }, "state.prngInvalid", /prngState/);
  expectRestoreError({ ...validState, prngState: { state: 1, extra: true } }, "state.invalidShape", /prngState/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, extra: true },
  }, "state.invalidShape", /state contains unknown fields/);
  const stateWithNonEnumerableExtra = { ...validState.state };
  Object.defineProperty(stateWithNonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectRestoreError({
    ...validState,
    state: stateWithNonEnumerableExtra,
  }, "state.invalidShape", /state contains unknown fields/);
  const missingRuntimeEntities = { ...validState.state } as Record<string, unknown>;
  delete missingRuntimeEntities.runtimeEntities;
  expectRestoreError({ ...validState, state: missingRuntimeEntities }, "state.invalidShape", /runtimeEntities/);
  for (const requiredField of [
    "pendingEvents",
    "score",
    "timelineCursor",
    "patternRunnerStates",
    "enabledFeatureStates",
  ] as const) {
    const missingRequiredField = { ...validState.state } as Record<string, unknown>;
    delete missingRequiredField[requiredField];
    expectRestoreError({ ...validState, state: missingRequiredField }, "state.invalidShape", new RegExp(requiredField));
  }
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: {} },
  }, "state.invalidShape", /runtimeEntities/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      runtimeEntities: Array.from({ length: 8_494 }, () => validState.state.runtimeEntities[0]!),
    },
  }, "state.invalidShape", /runtimeEntities/);
  const sparseRuntimeEntities: unknown[] = [];
  sparseRuntimeEntities.length = 1;
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: sparseRuntimeEntities },
  }, "state.invalidShape", /runtimeEntities/);
  const runtimeEntitiesWithNonEnumerableExtra = [...validState.state.runtimeEntities];
  Object.defineProperty(runtimeEntitiesWithNonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: runtimeEntitiesWithNonEnumerableExtra },
  }, "state.invalidShape", /runtimeEntities/);
  const throwingRuntimeEntitiesLength = new Proxy([...validState.state.runtimeEntities], {
    get(target, property, receiver) {
      if (property === "length") {
        throw new Error("runtimeEntities boom");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: throwingRuntimeEntitiesLength },
  }, "state.invalidShape", /runtimeEntities/);
  const serializedPlayer = validState.state.runtimeEntities[0];
  assert.equal(serializedPlayer?.kind, "player");
  if (serializedPlayer?.kind !== "player") {
    assert.fail("expected serialized player entity");
  }
  const playerWithNonEnumerableExtra = { ...serializedPlayer };
  Object.defineProperty(playerWithNonEnumerableExtra, "hp", { enumerable: false, value: 1 });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [playerWithNonEnumerableExtra] },
  }, "state.invalidShape", /enumerable data properties/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, id: 2 }] },
  }, "state.invalidShape", /below nextEntityId/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, id: 0 }] },
  }, "state.invalidShape", /below nextEntityId/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, kind: "boss" }] },
  }, "state.invalidShape", /kind is not supported/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, collisionRadius: 0 }] },
  }, "state.invalidShape", /collisionRadius/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, collisionRadius: Number.POSITIVE_INFINITY }] },
  }, "state.invalidShape", /collisionRadius/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [] },
  }, "state.invalidShape", /initial restore state/);
  expectRestoreError({
    ...validState,
    nextEntityId: 3,
    state: {
      ...validState.state,
      runtimeEntities: [
        serializedPlayer,
        { ...serializedPlayer, id: 2 },
      ],
    },
  }, "state.invalidShape", /initial restore state/);
  expectRestoreError({
    ...validState,
    nextEntityId: 3,
    state: {
      ...validState.state,
      runtimeEntities: [
        serializedPlayer,
        {
          id: 2,
          kind: "enemy",
          definitionId: "enemy.scout",
          position: { x: 192, y: -16 },
          collisionRadius: 12,
          hp: 10,
          scoreOnKill: 100,
          pathId: "path.none",
          patternId: "pattern.none",
        },
      ],
    },
  }, "state.invalidShape", /initial restore state/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    nextEntityId: 3,
    state: {
      ...validState.state,
      timelineCursor: 0,
      pendingEvents: [],
      runtimeEntities: [
        serializedPlayer,
        {
          id: 2,
          kind: "enemy",
          definitionId: "enemy.scout",
          position: { x: 192, y: -16 },
          collisionRadius: 12,
          hp: 10,
          scoreOnKill: 100,
          pathId: "path.none",
          patternId: "pattern.none",
        },
      ],
    },
  }, "state.invalidShape", /processed timeline/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, hp: 1 }] },
  }, "state.invalidShape", /player runtime entity/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, definitionId: "player.missing" }] },
  }, "state.registryInvalid", /player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, definitionId: "not-a-player-id" }] },
  }, "state.invalidShape", /player id/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, shotDefinitionId: "playerShot.missing" }] },
  }, "state.registryInvalid", /player shot/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, shotDefinitionId: "not-a-shot-id" }] },
  }, "state.invalidShape", /playerShot id/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, position: { x: Infinity, y: 400 } }] },
  }, "state.invalidShape", /position/);
  const throwingPlayerPosition = new Proxy({ x: 192, y: 400 }, {
    get() {
      throw new Error("position should not be read directly after validation");
    },
  });
  const restoredWithThrowingPlayerPosition = loaded.restore({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, position: throwingPlayerPosition }] },
  } as SerializedGameState);
  assert.equal(restoredWithThrowingPlayerPosition.ok, true);
  if (!restoredWithThrowingPlayerPosition.ok) {
    assert.fail("expected descriptor-cloned position proxy to restore");
  }
  assert.deepEqual(restoredWithThrowingPlayerPosition.value.serialize(), { ok: true, value: validState, warnings: [] });
  const movedSession = startStageFromLoadedGame(loaded);
  const movedFrame = movedSession.tick(createMoveInputFrame(0, 1, 0, []));
  assert.equal(movedFrame.ok, true);
  const movedState = movedSession.serialize();
  assert.equal(movedState.ok, true);
  if (!movedState.ok) {
    assert.fail("expected moved player state");
  }
  const movedPlayer = movedState.value.state.runtimeEntities.find((entity) => entity.kind === "player");
  assert.equal(movedPlayer?.kind, "player");
  if (movedPlayer?.kind !== "player") {
    assert.fail("expected moved player entity");
  }
  assert.notDeepEqual(movedPlayer.position, { x: 192, y: 400 });
  const throwingMovedPlayerPosition = new Proxy({ x: movedPlayer.position.x, y: movedPlayer.position.y }, {
    get() {
      throw new Error("moved player position should be descriptor-cloned");
    },
  });
  const restoredMovedPlayer = loaded.restore({
    ...movedState.value,
    state: {
      ...movedState.value.state,
      runtimeEntities: movedState.value.state.runtimeEntities.map((entity) => (
        entity.id === movedPlayer.id ? { ...movedPlayer, position: throwingMovedPlayerPosition } : entity
      )),
    },
  } as SerializedGameState);
  assert.equal(restoredMovedPlayer.ok, true);
  if (!restoredMovedPlayer.ok) {
    assert.fail("expected descriptor-cloned moved player position proxy to restore");
  }
  assert.deepEqual(restoredMovedPlayer.value.serialize(), movedState);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, movement: { speed: 17, focusSpeed: 1.8 } }] },
  }, "state.invalidShape", /movement/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, movement: { speed: 5, focusSpeed: 1.8 } }] },
  }, "state.invalidShape", /player definition fields/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, collisionRadius: 4 }] },
  }, "state.invalidShape", /player definition fields/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, lives: -1 }] },
  }, "state.invalidShape", /player runtime counters/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, invincibleTicksRemaining: 1.5 }] },
  }, "state.invalidShape", /player runtime counters/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, nextShotAllowedTick: -1 }] },
  }, "state.invalidShape", /player runtime counters/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, position: { x: 193, y: 400 } }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, lives: 2 }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, invincibleTicksRemaining: 1 }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, nextShotAllowedTick: 1 }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, score: -1 },
  }, "state.invalidShape", /score/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, score: Number.POSITIVE_INFINITY },
  }, "state.invalidShape", /score/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    state: { ...validState.state, pendingEvents: [], score: 0.5 },
  }, "state.invalidShape", /score/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, score: 1 },
  }, "state.invalidShape", /score must be zero/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, timelineCursor: 999 },
  }, "state.invalidShape", /timelineCursor/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    state: { ...validState.state, timelineCursor: 1, pendingEvents: [] },
  }, "state.invalidShape", /timelineCursor/);
  expectRestoreError({
    ...validState,
    expectedTick: 61,
    state: { ...validState.state, timelineCursor: 0, pendingEvents: [] },
  }, "state.invalidShape", /timelineCursor/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, pendingEvents: [] },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      pendingEvents: [
        { type: "stageStarted", tick: 0, stageId: "stage.stage_01" },
        { type: "stageStarted", tick: 0, stageId: "stage.stage_01" },
      ],
    },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.missing" }],
    },
  }, "state.invalidShape", /pendingEvents/);
  const pendingEventsWithNonEnumerableExtra = [...validState.state.pendingEvents];
  Object.defineProperty(pendingEventsWithNonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, pendingEvents: pendingEventsWithNonEnumerableExtra },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      pendingEvents: Array.from({ length: 8_193 }, () => ({ type: "stageStarted", tick: 0, stageId: "stage.stage_01" })),
    },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    state: {
      ...validState.state,
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
    },
  }, "state.invalidShape", /pendingEvents/);
  const validPatternRunnerState = {
    runnerId: "patternRunner.main",
    patternId: "pattern.none",
    stateVersion: 1,
    payload: { cursor: 0, flags: [true, "ready", null] },
  };
  const validEnabledFeatureState = {
    feature: "bomb",
    stateVersion: 1,
    payload: { charges: 1 },
  };
  expectRestoreError({
    ...validState,
    state: { ...validState.state, patternRunnerStates: [validPatternRunnerState] },
  }, "state.featureMismatch", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: Array.from({ length: 129 }, (_, index) => ({
        ...validPatternRunnerState,
        runnerId: `patternRunner.${String(index).padStart(3, "0")}`,
      })),
    },
  }, "state.invalidShape", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, enabledFeatureStates: [validEnabledFeatureState] },
  }, "state.featureMismatch", /enabled feature/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, runnerId: "patternRunner." }],
    },
  }, "state.invalidShape", /runnerId/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, runnerId: `patternRunner.${"x".repeat(8_193)}` }],
    },
  }, "state.invalidShape", /runnerId/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        { ...validPatternRunnerState, runnerId: "patternRunner.z" },
        { ...validPatternRunnerState, runnerId: "patternRunner.a" },
      ],
    },
  }, "state.invalidShape", /ordered/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        { ...validPatternRunnerState, runnerId: "patternRunner.😀" },
        { ...validPatternRunnerState, runnerId: "patternRunner.あ" },
      ],
    },
  }, "state.invalidShape", /ordered/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        validPatternRunnerState,
        validPatternRunnerState,
      ],
    },
  }, "state.invalidShape", /ordered/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, patternId: "path.none" }],
    },
  }, "state.invalidShape", /pattern id/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, patternId: "pattern.missing" }],
    },
  }, "state.featureMismatch", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, stateVersion: 0 }],
    },
  }, "state.invalidShape", /stateVersion/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: Number.POSITIVE_INFINITY }],
    },
  }, "state.invalidShape", /payload/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: "\ud800" }],
    },
  }, "state.invalidShape", /lone surrogate/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: "x".repeat(8_193) }],
    },
  }, "state.invalidShape", /string budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{
        ...validPatternRunnerState,
        payload: Array.from({ length: 65 }, () => "x".repeat(4_096)),
      }],
    },
  }, "state.invalidShape", /payload budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: { ["x".repeat(8_193)]: 1 } }],
    },
  }, "state.invalidShape", /string budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: () => 0 }],
    },
  }, "state.invalidShape", /JSON-compatible/);
  const sparsePayload: unknown[] = [];
  sparsePayload.length = 1;
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: sparsePayload }],
    },
  }, "state.invalidShape", /payload/);
  const tooWidePayload = Object.fromEntries(Array.from({ length: 8_192 }, (_, index) => [`k${index}`, index]));
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: tooWidePayload }],
    },
  }, "state.invalidShape", /payload budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        { ...validPatternRunnerState, runnerId: "patternRunner.a", payload: Array.from({ length: 8_190 }, () => null) },
        { ...validPatternRunnerState, runnerId: "patternRunner.b", payload: Array.from({ length: 2 }, () => null) },
      ],
    },
  }, "state.invalidShape", /payload budget/);
  const getterPayload = {};
  Object.defineProperty(getterPayload, "value", {
    enumerable: true,
    get() {
      throw new Error("payload getter must not run");
    },
  });
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: getterPayload }],
    },
  }, "state.invalidShape", /data properties/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: Object.create({ inherited: true }) }],
    },
  }, "state.invalidShape", /plain JSON object/);
  const revokedPayload = Proxy.revocable({ value: 1 }, {});
  revokedPayload.revoke();
  for (const invalidPayload of [
    undefined,
    Symbol("payload"),
    1n,
    new Date(0),
    new Map([["value", 1]]),
    revokedPayload.proxy,
  ]) {
    expectRestoreError({
      ...validState,
      state: {
        ...validState.state,
        patternRunnerStates: [{ ...validPatternRunnerState, payload: invalidPayload }],
      },
    }, "state.invalidShape", /payload|JSON|plain/);
  }
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, payload: undefined }],
    },
  }, "state.invalidShape", /payload/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, feature: 1 }],
    },
  }, "state.invalidShape", /feature/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, feature: "x".repeat(8_193) }],
    },
  }, "state.invalidShape", /feature/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, stateVersion: 0 }],
    },
  }, "state.invalidShape", /stateVersion/);
});

test("restore validates each runtime entity kind before accepting a session", () => {
  const definition = createFireOnSpawnAtZeroDefinition();
  const loaded = createShootingCore("core.test").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  const validRestore = loaded.value.restore(serialized.value);
  assert.equal(validRestore.ok, true);
  if (!validRestore.ok) {
    assert.fail("expected valid restore");
  }
  assert.deepEqual(validRestore.value.serialize(), serialized);

  const enemy = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "enemy");
  const enemyBullet = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "enemyBullet");
  const player = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "player");
  const playerShot = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "playerShot");
  assert.equal(enemy?.kind, "enemy");
  assert.equal(enemyBullet?.kind, "enemyBullet");
  assert.equal(player?.kind, "player");
  assert.equal(playerShot?.kind, "playerShot");
  if (enemy?.kind !== "enemy" || enemyBullet?.kind !== "enemyBullet" || player?.kind !== "player" || playerShot?.kind !== "playerShot") {
    assert.fail("expected player, enemy, enemy bullet, and player shot entities");
  }

  const expectRestoreError = (runtimeEntity: Record<string, unknown>, code: CoreErrorCode, detail: RegExp) => {
    const restored = loaded.value.restore({
      ...serialized.value,
      state: {
        ...serialized.value.state,
        runtimeEntities: serialized.value.state.runtimeEntities.map((entity) => (
          entity.id === runtimeEntity.id ? runtimeEntity : entity
        )),
      },
    } as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectRestoreError({ ...enemy, projectile: {} }, "state.invalidShape", /unknown fields/);
  expectRestoreError({ ...enemy, definitionId: "enemy.missing" }, "state.registryInvalid", /enemy/);
  expectRestoreError({ ...enemy, definitionId: "not-an-enemy-id" }, "state.invalidShape", /enemy id/);
  expectRestoreError({ ...enemy, pathId: 1 }, "state.invalidShape", /pathId/);
  expectRestoreError({ ...enemy, pathId: "not-a-path-id" }, "state.invalidShape", /path id/);
  expectRestoreError({ ...enemy, pathId: "path.missing" }, "state.registryInvalid", /path/);
  expectRestoreError({ ...enemy, patternId: "not-a-pattern-id" }, "state.invalidShape", /pattern id/);
  expectRestoreError({ ...enemy, patternId: "pattern.missing" }, "state.registryInvalid", /pattern/);
  expectRestoreError({ ...enemy, hp: -1 }, "state.invalidShape", /hp/);
  expectRestoreError({ ...enemy, hp: Number.NaN }, "state.invalidShape", /hp/);
  expectRestoreError({ ...enemy, hp: 11 }, "state.invalidShape", /enemy runtime entity/);
  expectRestoreError({ ...enemy, scoreOnKill: -1 }, "state.invalidShape", /scoreOnKill/);
  expectRestoreError({ ...enemy, scoreOnKill: 1.5 }, "state.invalidShape", /scoreOnKill/);
  expectRestoreError({ ...enemy, scoreOnKill: 101 }, "state.invalidShape", /enemy runtime entity/);
  expectRestoreError({ ...enemy, collisionRadius: 13 }, "state.invalidShape", /enemy runtime entity/);
  expectRestoreError({ ...enemy, position: { x: 193, y: 80 } }, "state.invalidShape", /processed timeline/);
  const throwingEnemyPosition = new Proxy({ x: 192, y: 80 }, {
    get() {
      throw new Error("enemy position should be descriptor-cloned");
    },
  });
  const restoredWithThrowingEnemyPosition = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: serialized.value.state.runtimeEntities.map((entity) => (
        entity.id === enemy.id ? { ...enemy, position: throwingEnemyPosition } : entity
      )),
    },
  } as SerializedGameState);
  assert.equal(restoredWithThrowingEnemyPosition.ok, true);
  if (!restoredWithThrowingEnemyPosition.ok) {
    assert.fail("expected descriptor-cloned enemy position proxy to restore");
  }
  assert.deepEqual(restoredWithThrowingEnemyPosition.value.serialize(), serialized);

  expectRestoreError({ ...player, position: { x: 385, y: 400 } }, "state.invalidShape", /playfield/);
  expectRestoreError({ ...player, lives: 4 }, "state.invalidShape", /counters/);
  expectRestoreError({ ...player, invincibleTicksRemaining: 121 }, "state.invalidShape", /counters/);
  expectRestoreError({ ...player, nextShotAllowedTick: 61 }, "state.invalidShape", /counters/);

  expectRestoreError({ ...enemyBullet, projectile: {} }, "state.invalidShape", /unknown fields/);
  expectRestoreError({ ...enemyBullet, definitionId: "bullet.missing" }, "state.registryInvalid", /bullet/);
  expectRestoreError({ ...enemyBullet, definitionId: "not-a-bullet-id" }, "state.invalidShape", /bullet id/);
  expectRestoreError({ ...enemyBullet, collisionRadius: 5 }, "state.invalidShape", /bullet definition/);
  expectRestoreError({ ...enemyBullet, position: { x: 192, y: 89 } }, "state.invalidShape", /processed timeline/);

  expectRestoreError({ ...playerShot, owner: "player" }, "state.invalidShape", /unknown fields/);
  expectRestoreError({ ...playerShot, definitionId: "playerShot.missing" }, "state.registryInvalid", /player shot/);
  expectRestoreError({ ...playerShot, definitionId: "not-a-player-shot-id" }, "state.invalidShape", /playerShot id/);
  expectRestoreError({ ...playerShot, velocity: { x: 65, y: -8 } }, "state.invalidShape", /velocity/);
  expectRestoreError({ ...playerShot, velocity: { x: 0, y: -7 } }, "state.invalidShape", /player shot definition/);
  expectRestoreError({ ...playerShot, remainingLifetimeTicks: 0 }, "state.invalidShape", /remainingLifetimeTicks/);
  expectRestoreError({ ...playerShot, remainingLifetimeTicks: 4 }, "state.invalidShape", /player shot definition/);
  expectRestoreError({ ...playerShot, damage: 0 }, "state.invalidShape", /damage/);
  expectRestoreError({ ...playerShot, damage: 6 }, "state.invalidShape", /player shot definition/);

  expectRestoreError({ ...enemy, hp: 0 }, "state.invalidShape", /hp/);

  const expectEntityOrderError = (runtimeEntities: typeof serialized.value.state.runtimeEntities) => {
    const restored = loaded.value.restore({
      ...serialized.value,
      state: {
        ...serialized.value.state,
        runtimeEntities,
      },
    });
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", /below nextEntityId/);
  };
  const restoredWithShiftedPlayerId = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: serialized.value.state.runtimeEntities.map((entity) => (
        entity.kind === "player" ? { ...entity, id: 2 } : entity
      )),
    },
  });
  assert.equal(restoredWithShiftedPlayerId.ok, false);
  assert.equal(!restoredWithShiftedPlayerId.ok && restoredWithShiftedPlayerId.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithShiftedPlayerId.ok ? restoredWithShiftedPlayerId.errors[0]?.message ?? "" : "", /initial entity id/);
  const restoredWithoutPlayer = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: serialized.value.state.runtimeEntities.filter((entity) => entity.kind !== "player"),
    },
  });
  assert.equal(restoredWithoutPlayer.ok, false);
  assert.equal(!restoredWithoutPlayer.ok && restoredWithoutPlayer.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithoutPlayer.ok ? restoredWithoutPlayer.errors[0]?.message ?? "" : "", /player matching playerId/);
  const duplicateEnemyBullet = {
    ...enemyBullet,
    id: serialized.value.nextEntityId,
  };
  const restoredWithExtraEnemyBullet = loaded.value.restore({
    ...serialized.value,
    nextEntityId: serialized.value.nextEntityId + 1,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        ...serialized.value.state.runtimeEntities,
        duplicateEnemyBullet,
      ],
    },
  });
  assert.equal(restoredWithExtraEnemyBullet.ok, false);
  assert.equal(!restoredWithExtraEnemyBullet.ok && restoredWithExtraEnemyBullet.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithExtraEnemyBullet.ok ? restoredWithExtraEnemyBullet.errors[0]?.message ?? "" : "", /allocation envelope/);
  const restoredWithDuplicateEnemyBullet = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        serialized.value.state.runtimeEntities[0]!,
        enemy,
        enemyBullet,
        { ...enemyBullet, id: 4 },
      ],
    },
  } as SerializedGameState);
  assert.equal(restoredWithDuplicateEnemyBullet.ok, false);
  assert.equal(!restoredWithDuplicateEnemyBullet.ok && restoredWithDuplicateEnemyBullet.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithDuplicateEnemyBullet.ok ? restoredWithDuplicateEnemyBullet.errors[0]?.message ?? "" : "", /enemy bullet runtime entity/);
  const restoredWithExtraEnemy = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        serialized.value.state.runtimeEntities[0]!,
        enemy,
        { ...enemy, id: 3 },
        { ...enemyBullet, id: 4 },
      ],
    },
  } as SerializedGameState);
  assert.equal(restoredWithExtraEnemy.ok, false);
  assert.equal(!restoredWithExtraEnemy.ok && restoredWithExtraEnemy.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithExtraEnemy.ok ? restoredWithExtraEnemy.errors[0]?.message ?? "" : "", /enemy runtime entity/);
  const restoredWithInflatedNextEntityId = loaded.value.restore({
    ...serialized.value,
    nextEntityId: serialized.value.nextEntityId + 10,
  });
  assert.equal(restoredWithInflatedNextEntityId.ok, false);
  assert.equal(!restoredWithInflatedNextEntityId.ok && restoredWithInflatedNextEntityId.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithInflatedNextEntityId.ok ? restoredWithInflatedNextEntityId.errors[0]?.message ?? "" : "", /allocation envelope/);
  const restoredWithSwappedBulletShotIds = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        serialized.value.state.runtimeEntities[0]!,
        enemy,
        { ...playerShot, id: enemyBullet.id },
        { ...enemyBullet, id: playerShot.id },
      ],
    },
  } as SerializedGameState);
  assert.equal(restoredWithSwappedBulletShotIds.ok, false);
  assert.equal(!restoredWithSwappedBulletShotIds.ok && restoredWithSwappedBulletShotIds.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithSwappedBulletShotIds.ok ? restoredWithSwappedBulletShotIds.errors[0]?.message ?? "" : "", /player shot id/);
  expectEntityOrderError(serialized.value.state.runtimeEntities.map((entity) => (
    entity.id === enemy.id ? { ...entity, id: serialized.value.nextEntityId } : entity
  )));
  expectEntityOrderError(serialized.value.state.runtimeEntities.map((entity) => (
    entity.id === enemy.id ? { ...entity, id: enemyBullet.id } : entity
  )));
  expectEntityOrderError([
    ...serialized.value.state.runtimeEntities.slice(0, 1),
    serialized.value.state.runtimeEntities[2]!,
    serialized.value.state.runtimeEntities[1]!,
    ...serialized.value.state.runtimeEntities.slice(3),
  ]);
});

test("restore rejects same-tick allocation order spoofing", () => {
  const definition = createDoubleFireOnSpawnAtZeroDefinition();
  const loaded = createShootingCore("core.test").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  const enemies = serialized.value.state.runtimeEntities.filter((entity) => entity.kind === "enemy");
  const enemyBullets = serialized.value.state.runtimeEntities.filter((entity) => entity.kind === "enemyBullet");
  const playerShot = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "playerShot");
  assert.equal(enemies.length, 2);
  assert.equal(enemyBullets.length, 2);
  assert.equal(playerShot?.kind, "playerShot");
  const [firstEnemy, secondEnemy] = enemies;
  const [firstBullet, secondBullet] = enemyBullets;
  if (
    firstEnemy?.kind !== "enemy"
    || secondEnemy?.kind !== "enemy"
    || firstBullet?.kind !== "enemyBullet"
    || secondBullet?.kind !== "enemyBullet"
    || playerShot?.kind !== "playerShot"
  ) {
    assert.fail("expected two enemies, two enemy bullets, and one player shot");
  }
  const validRestore = loaded.value.restore(serialized.value);
  assert.equal(validRestore.ok, true);
  if (!validRestore.ok) {
    assert.fail("expected valid double-spawn snapshot to restore");
  }
  assert.deepEqual(assertSerializeOk(validRestore.value.serialize(), "valid double-spawn restore"), serialized.value);

  const restoreWithEntities = (runtimeEntities: typeof serialized.value.state.runtimeEntities) => loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities,
    },
  } as SerializedGameState);
  const expectAllocationOrderError = (
    runtimeEntities: typeof serialized.value.state.runtimeEntities,
    messagePattern: RegExp,
  ) => {
    const restored = restoreWithEntities(runtimeEntities);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", messagePattern);
  };

  const swappedEnemyIds = serialized.value.state.runtimeEntities.map((entity) => {
    if (entity.id === firstEnemy.id) {
      return { ...secondEnemy, id: firstEnemy.id };
    }
    if (entity.id === secondEnemy.id) {
      return { ...firstEnemy, id: secondEnemy.id };
    }
    return entity;
  });
  expectAllocationOrderError(swappedEnemyIds, /enemy runtime entity ids/);

  const swappedEnemyBulletIds = serialized.value.state.runtimeEntities.map((entity) => {
    if (entity.id === firstBullet.id) {
      return { ...secondBullet, id: firstBullet.id };
    }
    if (entity.id === secondBullet.id) {
      return { ...firstBullet, id: secondBullet.id };
    }
    return entity;
  });
  expectAllocationOrderError(swappedEnemyBulletIds, /enemy bullet runtime entity ids/);

  const enemyBeforeBulletOrderSpoof = [
    serialized.value.state.runtimeEntities[0]!,
    firstEnemy,
    { ...firstBullet, id: secondEnemy.id },
    { ...secondEnemy, id: firstBullet.id },
    secondBullet,
    playerShot,
  ];
  expectAllocationOrderError(enemyBeforeBulletOrderSpoof, /enemy bullet id/);
});

test("restore rejects cross-tick allocation order spoofing", () => {
  const definition = createFutureTimelineAfterRestoreDefinition();
  const loaded = createShootingCore("core.test").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  assertTickOk(started.tick(createShotInputFrame(0)), "shot tick");
  assertTickOk(started.tick(createEmptyInputFrame(1)), "advance before future spawn");
  assertTickOk(started.tick(createEmptyInputFrame(2)), "future spawn tick");
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized cross-tick state");
  }

  const validRestore = loaded.value.restore(serialized.value);
  assert.equal(validRestore.ok, true);
  if (!validRestore.ok) {
    assert.fail("expected valid cross-tick snapshot to restore");
  }
  assert.deepEqual(assertSerializeOk(validRestore.value.serialize(), "valid cross-tick restore"), serialized.value);

  const playerShot = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "playerShot");
  const futureEnemy = serialized.value.state.runtimeEntities.find((entity) => (
    entity.kind === "enemy" && entity.position.x === 128 && entity.position.y === 96
  ));
  assert.equal(playerShot?.kind, "playerShot");
  assert.equal(futureEnemy?.kind, "enemy");
  if (playerShot?.kind !== "playerShot" || futureEnemy?.kind !== "enemy") {
    assert.fail("expected earlier player shot and later enemy");
  }

  const crossTickOrderSpoof = serialized.value.state.runtimeEntities.map((entity) => {
    if (entity.id === playerShot.id) {
      return { ...futureEnemy, id: playerShot.id };
    }
    if (entity.id === futureEnemy.id) {
      return { ...playerShot, id: futureEnemy.id };
    }
    return entity;
  });
  const restored = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: crossTickOrderSpoof,
    },
  } as SerializedGameState);
  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
  assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", /allocation order across ticks/);
});

test("restore returns a session from an initial deterministic payload", () => {
  const validState = serializeInitialStageState("core.test");
  const restoreInput = toNullPrototypePlainData(validState);
  const capturedSnapshots: SerializedGameState[] = [];
  const loaded = loadGameWithRestoreCapture(createMinimumDefinition(), capturedSnapshots);
  const baseline = startStageFromLoadedGame(loaded);

  assert.notDeepEqual(restoreInput, validState);
  const restored = loaded.restore(restoreInput);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }
  assert.deepEqual(restored.value.serialize(), { ok: true, value: validState, warnings: [] });
  assertTickAndSerializeMatch(restored.value, baseline, createEmptyInputFrame(0));
  assert.deepEqual(capturedSnapshots, [validState]);
});

test("restore resumes a multi-entity deterministic payload", () => {
  const definition = createFireOnSpawnAtZeroDefinition();
  const capturedSnapshots: SerializedGameState[] = [];
  const loaded = loadGameWithRestoreCapture(definition, capturedSnapshots);
  const started = startStageFromLoadedGame(loaded);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  assert.equal(serialized.value.expectedTick, 1);
  assert.ok(serialized.value.nextEntityId > 2);
  const restoreInput = toNullPrototypePlainData(serialized.value);
  assert.notDeepEqual(restoreInput, serialized.value);
  const restored = loaded.restore(restoreInput);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }
  assert.deepEqual(restored.value.serialize(), serialized);
  assertTickAndSerializeMatch(restored.value, started, createEmptyInputFrame(1));
  assert.deepEqual(capturedSnapshots, [serialized.value]);
});

test("restore resumes through future timeline spawn deterministically", () => {
  const definition = createFutureTimelineAfterRestoreDefinition();
  const capturedSnapshots: SerializedGameState[] = [];
  const loaded = loadGameWithRestoreCapture(definition, capturedSnapshots);
  const started = startStageFromLoadedGame(loaded);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.expectedTick, 1);
  assert.equal(serialized.value.state.timelineCursor, 1);

  const restored = loaded.restore(toNullPrototypePlainData(serialized.value));
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored future timeline session");
  }

  assertTickAndSerializeMatch(restored.value, started, createEmptyInputFrame(1));
  const spawnFrame = assertTickAndSerializeMatch(restored.value, started, createEmptyInputFrame(2));
  const spawnEvent = spawnFrame.events.find((event) => event.type === "entitySpawned" && event.tick === 2);
  assert.equal(spawnEvent?.type, "entitySpawned");
  if (spawnEvent?.type !== "entitySpawned") {
    assert.fail("expected future timeline entitySpawned event");
  }
  assert.equal(spawnEvent.entityKind, "enemy");
  assert.deepEqual(spawnEvent.position, { x: 128, y: 96 });
  const afterSpawn = restored.value.serialize();
  assert.equal(afterSpawn.ok, true);
  if (!afterSpawn.ok) {
    assert.fail("expected restored snapshot after future spawn");
  }
  assert.equal(afterSpawn.value.state.timelineCursor, 2);
  const spawnedEnemy = afterSpawn.value.state.runtimeEntities.find((entity) => entity.id === spawnEvent.entityId);
  assert.equal(spawnedEnemy?.kind, "enemy");
  assert.deepEqual(spawnedEnemy?.kind === "enemy" && spawnedEnemy.position, { x: 128, y: 96 });
  assert.deepEqual(capturedSnapshots, [serialized.value]);
});

test("restore preserves score and timeline cursor while resuming", () => {
  const definition = createCollisionScoreDefinition();
  const capturedSnapshots: SerializedGameState[] = [];
  const loaded = loadGameWithRestoreCapture(definition, capturedSnapshots);
  const started = startStageFromLoadedGame(loaded);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.state.score, 100);
  assert.equal(serialized.value.state.timelineCursor, 1);

  const restoreInput = toNullPrototypePlainData(serialized.value);
  assert.notDeepEqual(restoreInput, serialized.value);
  const restored = loaded.restore(restoreInput);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }
  assert.deepEqual(restored.value.serialize(), serialized);
  assertTickAndSerializeMatch(restored.value, started, createEmptyInputFrame(1));
  assert.deepEqual(capturedSnapshots, [serialized.value]);
});

test("failed restore does not mutate loaded game or active sessions", () => {
  const loaded = loadGameWithRestoreCapture(createFireOnSpawnAtZeroDefinition(), []);
  const baseline = startStageFromLoadedGame(loaded);
  const active = startStageFromLoadedGame(loaded);

  const activeFirstFrame = assertTickOk(active.tick(createShotInputFrame(0)), "active first tick");
  assert.deepEqual(activeFirstFrame, assertTickOk(baseline.tick(createShotInputFrame(0)), "baseline first tick"));
  const validSnapshot = active.serialize();
  assert.equal(validSnapshot.ok, true);
  if (!validSnapshot.ok) {
    assert.fail("expected active snapshot");
  }

  const failedRestore = loaded.restore({
    ...validSnapshot.value,
    state: {
      ...validSnapshot.value.state,
      score: -1,
    },
  });
  assert.equal(failedRestore.ok, false);
  assert.equal(!failedRestore.ok && failedRestore.errors[0]?.code, "state.invalidShape");

  const baselineNextFrame = assertTickOk(baseline.tick(createEmptyInputFrame(1)), "baseline next tick");
  assert.deepEqual(assertTickOk(active.tick(createEmptyInputFrame(1)), "active next tick"), baselineNextFrame);
  assert.deepEqual(
    assertSerializeOk(active.serialize(), "active serialize after failed restore"),
    assertSerializeOk(baseline.serialize(), "baseline serialize after failed restore"),
  );

  const restored = loaded.restore(validSnapshot.value);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected valid restore after failed restore");
  }
  assert.deepEqual(assertTickOk(restored.value.tick(createEmptyInputFrame(1)), "restored next tick"), baselineNextFrame);
  assert.deepEqual(
    assertSerializeOk(restored.value.serialize(), "restored serialize after failed restore"),
    assertSerializeOk(baseline.serialize(), "baseline serialize after valid restore"),
  );

  const restarted = loaded.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(restarted.ok, true);
});

test("returns identical frames for identical seed and input sequence", () => {
  const first = startMinimumStage();
  const second = startMinimumStage();

  for (let tick = 0; tick <= 60; tick += 1) {
    const input = tick % 10 === 0 ? createShotInputFrame(tick) : createEmptyInputFrame(tick);
    const firstFrame = first.tick(input);
    const secondFrame = second.tick(input);

    assert.equal(firstFrame.ok, true);
    assert.equal(secondFrame.ok, true);
    assert.deepEqual(firstFrame.ok && firstFrame.value, secondFrame.ok && secondFrame.value);
  }
});

test("returns identical frames when collision and score occur", () => {
  const first = startStageFromDefinition(createCollisionScoreDefinition());
  const second = startStageFromDefinition(createCollisionScoreDefinition());

  for (const input of [createShotInputFrame(0), createEmptyInputFrame(1)]) {
    const firstFrame = first.tick(input);
    const secondFrame = second.tick(input);

    assert.equal(firstFrame.ok, true);
    assert.equal(secondFrame.ok, true);
    assert.deepEqual(firstFrame.ok && firstFrame.value, secondFrame.ok && secondFrame.value);
  }
});

test("moves player by input axes and clamps the center inside the playfield", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createMoveInputFrame(0, 1, -1, []));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected moved player frame");
  }
  assert.deepEqual(frame0.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192 + 4 * Math.SQRT1_2, y: 400 - 4 * Math.SQRT1_2 },
    },
  ]);

  const frame1 = started.tick(createMoveInputFrame(1, -1, 1, ["focus"]));
  assert.equal(frame1.ok, true);
  if (!frame1.ok) {
    assert.fail("expected focus moved player frame");
  }
  assert.deepEqual(frame1.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: {
        x: 192 + 4 * Math.SQRT1_2 - 1.8 * Math.SQRT1_2,
        y: 400 - 4 * Math.SQRT1_2 + 1.8 * Math.SQRT1_2,
      },
    },
  ]);

  let lastFrame: ReturnType<StageSession["tick"]> = frame1;
  for (let tick = 2; tick <= 20; tick += 1) {
    lastFrame = started.tick(createMoveInputFrame(tick, 1, 1, []));
    assert.equal(lastFrame.ok, true);
  }
  const playerAfterClamp = lastFrame.ok && lastFrame.value.state.entities[0];
  assert.equal(playerAfterClamp && playerAfterClamp.kind, "player");
  assert.equal(playerAfterClamp && playerAfterClamp.definitionId, "player.default");
  assert.equal(playerAfterClamp && playerAfterClamp.position.y, 448);
  assert.equal(
    playerAfterClamp && Math.abs(playerAfterClamp.position.x - (192 + 4 * Math.SQRT1_2 - 1.8 * Math.SQRT1_2 + 19 * 4 * Math.SQRT1_2)) < 1e-12,
    true,
  );
});

test("spawns player shots from the pre-movement player position on the same tick", () => {
  const started = startMinimumStage();

  const frame = started.tick(createMoveAndPressedShotInputFrame(0, 1, 0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected moving shot frame");
  }

  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 196, y: 400 },
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("spawns player shot entities from shot input deterministically", () => {
  const started = startMinimumStage();

  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected shot frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), ["stageStarted", "playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
  assert.equal(Object.isFrozen(frame.value.events), true);
  assert.equal(Object.isFrozen(frame.value.events[1]), true);
  if (frame.value.events[1]?.type !== "playerShotsSpawnedBatch") {
    assert.fail("expected playerShotsSpawnedBatch event");
  }
  assert.equal(Object.isFrozen(frame.value.events[1].shots), true);
  assert.equal(Object.isFrozen(frame.value.events[1].shots[0]), true);
  assert.equal(Object.isFrozen(frame.value.events[1].shots[0]?.position), true);
  assert.equal(Object.isFrozen(frame.value.state.entities[1]), true);
  assert.equal(Object.isFrozen(frame.value.state.entities[1]?.position), true);

  const nextFrame = started.tick(createShotInputFrame(1));
  assert.equal(nextFrame.ok, true);
  assert.deepEqual(nextFrame.ok && nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(nextFrame.ok && nextFrame.value.state.entities.map((entity) => entity.id), [1, 2]);
  assert.deepEqual(nextFrame.ok && nextFrame.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 384 },
    },
  ]);

  const intervalFrame2 = started.tick(createShotInputFrame(2));
  assert.equal(intervalFrame2.ok, true);
  assert.deepEqual(intervalFrame2.ok && intervalFrame2.value.events.map((event) => event.type), ["tickAdvanced"]);

  const intervalFrame3 = started.tick(createShotInputFrame(3));
  assert.equal(intervalFrame3.ok, true);
  assert.deepEqual(intervalFrame3.ok && intervalFrame3.value.events.map((event) => event.type), [
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(intervalFrame3.ok && intervalFrame3.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("moves player shots by content velocity and cleans them up after lifetime", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createShotInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected first shot frame");
  }
  assert.deepEqual(frame0.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  if (!frame1.ok) {
    assert.fail("expected moved shot frame");
  }
  assert.deepEqual(frame1.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 384 },
    },
  ]);

  const frame2 = started.tick(createEmptyInputFrame(2));
  assert.equal(frame2.ok, true);
  if (!frame2.ok) {
    assert.fail("expected last visible shot frame");
  }
  assert.deepEqual(frame2.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 376 },
    },
  ]);

  const frame3 = started.tick(createEmptyInputFrame(3));
  assert.equal(frame3.ok, true);
  if (!frame3.ok) {
    assert.fail("expected cleanup frame");
  }
  assert.deepEqual(frame3.value.state.entities.map((entity) => entity.kind), ["player"]);
});

test("auto-fires held shot input by content fire interval", () => {
  const started = startMinimumStage();

  const frames = [
    started.tick(createHeldShotInputFrame(0)),
    started.tick(createHeldShotInputFrame(1)),
    started.tick(createHeldShotInputFrame(2)),
    started.tick(createHeldShotInputFrame(3)),
  ];
  for (const frame of frames) {
    assert.equal(frame.ok, true);
  }

  const [frame0, frame1, frame2, frame3] = frames;
  if (!frame0?.ok || !frame1?.ok || !frame2?.ok || !frame3?.ok) {
    assert.fail("expected held shot frames");
  }
  assert.deepEqual(frame0.value.events.map((event) => event.type), ["stageStarted", "playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frame2.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frame3.value.events.map((event) => event.type), ["playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame3.value.events[0], {
    type: "playerShotsSpawnedBatch",
    tick: 3,
    shots: [
      {
        entityId: 3,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame3.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("uses player shot content fire interval instead of a fixed cooldown", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0]!,
        fire: { intervalTicks: 2 },
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with interval two shot");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected interval two stage session");
  }

  const frame0 = started.value.tick(createHeldShotInputFrame(0));
  const frame1 = started.value.tick(createHeldShotInputFrame(1));
  const frame2 = started.value.tick(createHeldShotInputFrame(2));
  assert.equal(frame0.ok, true);
  assert.equal(frame1.ok, true);
  assert.equal(frame2.ok, true);
  if (!frame0.ok || !frame1.ok || !frame2.ok) {
    assert.fail("expected interval two held shot frames");
  }

  assert.deepEqual(frame0.value.events.map((event) => event.type), ["stageStarted", "playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frame2.value.events.map((event) => event.type), ["playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame2.value.events[0], {
    type: "playerShotsSpawnedBatch",
    tick: 2,
    shots: [
      {
        entityId: 3,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
});

test("keeps a lifetime one player shot visible on its spawn frame", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0]!,
        fire: { intervalTicks: 3 },
        projectile: { velocity: { x: 0, y: -8 }, lifetimeTicks: 1 },
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected lifetime one content to load");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected lifetime one stage session");
  }

  const frame0 = started.value.tick(createShotInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected lifetime one spawn frame");
  }
  assert.deepEqual(frame0.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const frame1 = started.value.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  if (!frame1.ok) {
    assert.fail("expected lifetime one cleanup frame");
  }
  assert.deepEqual(frame1.value.state.entities.map((entity) => entity.kind), ["player"]);
});

test("spawns one player shot batch from pressed-only shot input", () => {
  const started = startMinimumStage();

  const frame = started.tick(createPressedShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected pressed shot frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
});

test("spawns one player shot batch when shot is both held and pressed", () => {
  const started = startMinimumStage();

  const frame = started.tick(createHeldAndPressedShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected held and pressed shot frame");
  }

  assert.deepEqual(frame.value.events.filter((event) => event.type === "playerShotsSpawnedBatch"), [
    {
      type: "playerShotsSpawnedBatch",
      tick: 0,
      shots: [
        {
          entityId: 2,
          definitionId: "playerShot.basic",
          position: { x: 192, y: 400 },
        },
      ],
    },
  ]);
  if (frame.value.events[1]?.type !== "playerShotsSpawnedBatch") {
    assert.fail("expected playerShotsSpawnedBatch event");
  }
  assert.equal(frame.value.events[1].shots.length, 1);
  assert.deepEqual(frame.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("uses the selected player's shot definition when spawning player shots", () => {
  const definition = createMinimumDefinition();
  const basePlayer = definition.content.players[0]!;
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [
          ...definition.content.assetKeys.keys,
          "player.alt",
          "shot.player_alt",
        ],
      },
      players: [
        ...definition.content.players,
        {
          ...basePlayer,
          id: "player.alt",
          asset: "player.alt",
          shot: { definition: "playerShot.alt" },
        },
      ],
      playerShots: [
        ...definition.content.playerShots,
        {
          id: "playerShot.alt",
          version: 1,
          asset: "shot.player_alt",
          collision: { radius: 7 },
          damage: 9,
          fire: { intervalTicks: 3 },
          projectile: { velocity: { x: 0, y: -12 }, lifetimeTicks: 3 },
        },
      ],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with alternate player");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.alt",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected alternate player stage");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected alternate player shot frame");
  }

  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.alt",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.alt",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.alt",
      position: { x: 192, y: 388 },
    },
  ]);
});

test("spawns enemy bullets from fireOnSpawn patterns deterministically", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.spawn_bullet",
            position: { x: 192, y: 80 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.spawn_bullet",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: 4, y: 8 },
        },
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with fireOnSpawn pattern");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected fireOnSpawn stage session");
  }

  const frame = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected fireOnSpawn frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[2], {
    type: "enemyBulletsSpawnedBatch",
    tick: 0,
    bullets: [
      {
        entityId: 3,
        definitionId: "bullet.red_small",
        position: { x: 196, y: 88 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: 80 },
    },
    {
      id: 3,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 196, y: 88 },
    },
  ]);
  assert.equal(Object.isFrozen(frame.value.events[2]), true);
  if (frame.value.events[2]?.type !== "enemyBulletsSpawnedBatch") {
    assert.fail("expected enemyBulletsSpawnedBatch event");
  }
  assert.equal(Object.isFrozen(frame.value.events[2].bullets), true);
  assert.equal(Object.isFrozen(frame.value.events[2].bullets[0]), true);
  assert.equal(Object.isFrozen(frame.value.events[2].bullets[0]?.position), true);

  const nextFrame = started.value.tick(createEmptyInputFrame(1));
  assert.equal(nextFrame.ok, true);
  if (!nextFrame.ok) {
    assert.fail("expected next frame without repeated fireOnSpawn");
  }
  assert.deepEqual(nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(nextFrame.value.state.entities.filter((entity) => entity.kind === "enemyBullet"), [
    {
      id: 3,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 196, y: 88 },
    },
  ]);
});

test("rejects non-finite enemy bullet positions during load", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.overflow",
            position: { x: Number.MAX_VALUE, y: 80 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.overflow",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: Number.MAX_VALUE, y: 8 },
        },
      }],
    },
  });
  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "definition.invalidConstraint",
  ]);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "stage.timeline[].action.position + pattern.fireOnSpawn.offset must produce a finite position",
  ]);
});

test("orders timeline enemy spawn and enemy bullet batch before player shot batch on the same tick", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const spawnStep = baseStage.timeline[0]!;
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...baseStage,
          timeline: [
            {
              ...spawnStep,
              tick: 0,
              action: {
                ...spawnStep.action,
                pattern: "pattern.spawn_bullet",
              },
            },
          ],
        },
      ],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.spawn_bullet",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: 0, y: 8 },
          },
        },
      ],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[1], {
    type: "entitySpawned",
    tick: 0,
    entityId: 2,
    entityKind: "enemy",
    definitionId: "enemy.scout",
    path: "path.none",
    pattern: "pattern.spawn_bullet",
    position: { x: 192, y: -16 },
  });
  assert.deepEqual(frame.value.events[2], {
    type: "enemyBulletsSpawnedBatch",
    tick: 0,
    bullets: [
      {
        entityId: 3,
        definitionId: "bullet.red_small",
        position: { x: 192, y: -8 },
      },
    ],
  });
  assert.deepEqual(frame.value.events[3], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 4,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
    position: entity.position,
  })), [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 192, y: -16 } },
    { id: 3, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 192, y: -8 } },
    { id: 4, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 192, y: 392 } },
  ]);
});

test("orders multiple timeline enemy bullet batches before player shot batch on the same tick", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...baseStage,
          timeline: [
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.scout",
                path: "path.none",
                pattern: "pattern.fire_a",
                position: { x: 180, y: -16 },
              },
            },
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.scout",
                path: "path.none",
                pattern: "pattern.fire_b",
                position: { x: 204, y: -12 },
              },
            },
          ],
        },
      ],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.fire_a",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: 1, y: 2 },
          },
        },
        {
          id: "pattern.fire_b",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: -3, y: 4 },
          },
        },
      ],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[3], {
    type: "enemyBulletsSpawnedBatch",
    tick: 0,
    bullets: [
      {
        entityId: 4,
        definitionId: "bullet.red_small",
        position: { x: 181, y: -14 },
      },
      {
        entityId: 5,
        definitionId: "bullet.red_small",
        position: { x: 201, y: -8 },
      },
    ],
  });
  assert.deepEqual(frame.value.events[4], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 6,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
    position: entity.position,
  })), [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 180, y: -16 } },
    { id: 3, kind: "enemy", definitionId: "enemy.scout", position: { x: 204, y: -12 } },
    { id: 4, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 181, y: -14 } },
    { id: 5, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 201, y: -8 } },
    { id: 6, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 192, y: 392 } },
  ]);
});

test("resolves player shot enemy collision and score in the core tick", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.none",
            position: { x: 192, y: 380 },
          },
        }],
      }],
      playerShots: [{
        ...definition.content.playerShots[0]!,
        damage: 10,
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected collision frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "playerShotsSpawnedBatch",
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[3], {
    type: "entityDestroyed",
    tick: 0,
    entityId: 3,
    entityKind: "playerShot",
    reason: "collision",
  });
  assert.deepEqual(frame.value.events[4], {
    type: "entityDestroyed",
    tick: 0,
    entityId: 2,
    entityKind: "enemy",
    reason: "defeated",
  });
  assert.deepEqual(frame.value.events[5], {
    type: "scoreChanged",
    tick: 0,
    delta: 100,
    total: 100,
    reason: "enemyDefeated",
    enemyId: "enemy.scout",
    entityId: 2,
  });
  assert.equal(frame.value.state.score, 100);
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
  ]);
});

test("resolves enemy bullet player collision in the core tick", () => {
  const loaded = createShootingCore("0.0.0").load(createEnemyBulletHitDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected player hit frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerHit",
    "entityDestroyed",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[3], {
    type: "playerHit",
    tick: 0,
    playerId: "player.default",
    sourceEntityId: 3,
    sourceEntityKind: "enemyBullet",
    livesRemaining: 2,
    invincibleTicksRemaining: 120,
  });
  assert.deepEqual(frame.value.events[4], {
    type: "entityDestroyed",
    tick: 0,
    entityId: 3,
    entityKind: "enemyBullet",
    reason: "collision",
  });
  assert.deepEqual(frame.value.state.player, {
    lives: 2,
    invincibleTicksRemaining: 120,
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: 392 },
    },
  ]);

  const nextFrame = started.value.tick(createEmptyInputFrame(1));
  assert.equal(nextFrame.ok, true);
  if (!nextFrame.ok) {
    assert.fail("expected committed player hit state");
  }
  assert.deepEqual(nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(nextFrame.value.state.player, {
    lives: 2,
    invincibleTicksRemaining: 119,
  });
  assert.deepEqual(nextFrame.value.state.entities.map((entity) => entity.kind), ["player", "enemy"]);
});

test("spawns enemy entities from the stage timeline deterministically", () => {
  const started = startMinimumStage();

  for (let tick = 0; tick < 60; tick += 1) {
    const frame = started.tick(createEmptyInputFrame(tick));
    assert.equal(frame.ok, true);
    assert.deepEqual(frame.ok && frame.value.state.entities.map((entity) => entity.kind), ["player"]);
  }

  const spawnFrame = started.tick(createEmptyInputFrame(60));
  assert.equal(spawnFrame.ok, true);
  if (!spawnFrame.ok) {
    assert.fail("expected spawn frame");
  }

  assert.deepEqual(spawnFrame.value.events.map((event) => event.type), ["entitySpawned", "tickAdvanced"]);
  assert.deepEqual(spawnFrame.value.events[0], {
    type: "entitySpawned",
    tick: 60,
    entityId: 2,
    entityKind: "enemy",
    definitionId: "enemy.scout",
    path: "path.none",
    pattern: "pattern.none",
    position: { x: 192, y: -16 },
  });
  assert.deepEqual(spawnFrame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: -16 },
    },
  ]);
  assert.equal(Object.isFrozen(spawnFrame.value.state.entities), true);
  assert.equal(Object.isFrozen(spawnFrame.value.state.entities[0]), true);
  assert.equal(Object.isFrozen(spawnFrame.value.state.entities[0]?.position), true);
  assert.equal(Object.isFrozen(spawnFrame.value.events[0]), true);
  if (spawnFrame.value.events[0]?.type !== "entitySpawned") {
    assert.fail("expected entitySpawned event");
  }
  assert.equal(Object.isFrozen(spawnFrame.value.events[0].position), true);

  const nextFrame = started.tick(createEmptyInputFrame(61));
  assert.equal(nextFrame.ok, true);
  assert.deepEqual(nextFrame.ok && nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.equal(nextFrame.ok && nextFrame.value.state.entities.length, 2);
});

test("spawns multiple enemies on the same tick in timeline order", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const spawnStep = baseStage.timeline[0]!;
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [...definition.content.assetKeys.keys, "enemy.heavy"],
      },
      enemies: [
        ...definition.content.enemies,
        { id: "enemy.heavy", version: 1, asset: "enemy.heavy", collision: { radius: 20 }, hp: 30, score: 300 },
      ],
      stages: [
        {
          ...baseStage,
          timeline: [
            { ...spawnStep, tick: 0, action: { ...spawnStep.action, position: { x: 96, y: -16 } } },
            {
              ...spawnStep,
              tick: 0,
              action: {
                ...spawnStep.action,
                enemy: "enemy.heavy",
                path: "path.swoop",
                pattern: "pattern.spread",
                position: { x: 288, y: -16 },
              },
            },
          ],
        },
      ],
      patterns: [...definition.content.patterns, { id: "pattern.spread", version: 1 }],
      paths: [...definition.content.paths, { id: "path.swoop", version: 1 }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), ["stageStarted", "entitySpawned", "entitySpawned", "tickAdvanced"]);
  assert.deepEqual(frame.value.events.flatMap((event) => (
    event.type === "entitySpawned" && event.entityKind === "enemy"
      ? [{
        entityId: event.entityId,
        definitionId: event.definitionId,
        path: event.path,
        pattern: event.pattern,
        position: event.position,
      }]
      : []
  )), [
    { entityId: 2, definitionId: "enemy.scout", path: "path.none", pattern: "pattern.none", position: { x: 96, y: -16 } },
    { entityId: 3, definitionId: "enemy.heavy", path: "path.swoop", pattern: "pattern.spread", position: { x: 288, y: -16 } },
  ]);
  assert.deepEqual(frame.value.state.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
    position: entity.position,
  })), [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 96, y: -16 } },
    { id: 3, kind: "enemy", definitionId: "enemy.heavy", position: { x: 288, y: -16 } },
  ]);
});

test("keeps a validated content snapshot after load", () => {
  const definition = createMinimumDefinition();
  const originalPlayerShot = definition.content.playerShots[0] as unknown as Record<string, unknown>;
  const originalSpawnPosition = definition.content.stages[0]!.timeline[0]!.action.position;
  const loaded = loadUnknown(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  (definition.content.stages as unknown[]).length = 0;
  (definition.content.players as unknown[]).length = 0;
  definition.content.assetKeys.keys = [];
  originalPlayerShot.id = "playerShot.mutated";
  originalPlayerShot.damage = 999;
  originalPlayerShot.collision = { radius: 99 };
  (originalSpawnPosition as { x: number; y: number }).x = 999;
  (originalSpawnPosition as { x: number; y: number }).y = 999;
  (definition.content.playerShots as unknown as Record<string, unknown>[])[0] = {
    id: "playerShot.mutated",
    version: 1,
    asset: "shot.player_basic",
    damage: 5,
  };

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected shot frame");
  }
  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });

  for (let tick = 1; tick < 60; tick += 1) {
    const emptyFrame = started.value.tick(createEmptyInputFrame(tick));
    assert.equal(emptyFrame.ok, true);
  }
  const spawnFrame = started.value.tick(createEmptyInputFrame(60));
  assert.equal(spawnFrame.ok, true);
  if (!spawnFrame.ok) {
    assert.fail("expected enemy spawn frame");
  }
  assert.deepEqual(spawnFrame.value.events[0], {
    type: "entitySpawned",
    tick: 60,
    entityId: 3,
    entityKind: "enemy",
    definitionId: "enemy.scout",
    path: "path.none",
    pattern: "pattern.none",
    position: { x: 192, y: -16 },
  });
});

test("loads minimum content after crossing a JSON parse boundary", () => {
  const parsed = JSON.parse(JSON.stringify(createMinimumDefinition()));
  const loaded = loadUnknown(parsed);

  assert.equal(loaded.ok, true);
});

test("rejects inherited or throwing content data without leaking exceptions", () => {
  const inheritedDefinition = Object.create(createMinimumDefinition());
  const inherited = loadUnknown(inheritedDefinition);
  assert.equal(inherited.ok, false);
  assert.equal(!inherited.ok && inherited.errors[0]?.code, "definition.invalidShape");

  const throwingDefinition = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      throw new Error("unexpected getter access");
    },
  });
  const throwing = loadUnknown(throwingDefinition);
  assert.equal(throwing.ok, false);
  assert.equal(!throwing.ok && throwing.errors[0]?.code, "definition.invalidShape");
  assert.deepEqual(validateGameDefinition(throwingDefinition).map((error) => error.code), ["definition.invalidShape"]);

  const definitionWithProto = createMinimumDefinition() as Record<string, unknown>;
  Object.defineProperty(definitionWithProto, "__proto__", {
    enumerable: true,
    value: { polluted: true },
  });
  const protoResult = loadUnknown(definitionWithProto);
  assert.equal(protoResult.ok, false);
  assert.equal(!protoResult.ok && protoResult.errors.some((error) => error.code === "definition.unknownField"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("rejects invalid content shapes without throwing", () => {
  const invalidCases: readonly unknown[] = [
    null,
    { schemaVersion: "1", content: null },
    { ...createMinimumDefinition(), extra: true },
    {
      ...createMinimumDefinition(),
      content: { ...createMinimumDefinition().content, players: [null] },
    },
  ];

  for (const invalidDefinition of invalidCases) {
    const loaded = loadUnknown(invalidDefinition);
    assert.equal(loaded.ok, false);
    assert.equal(Object.isFrozen(loaded), true);
    assert.equal(!loaded.ok && Object.isFrozen(loaded.errors), true);
    assert.equal(!loaded.ok && Object.isFrozen(loaded.errors[0]), true);
    assert.equal(
      !loaded.ok
        && loaded.errors.some((error) => error.code === "definition.invalidShape" || error.code === "definition.unknownField"),
      true,
    );
  }
});

test("rejects unsupported schema versions", () => {
  const loaded = loadUnknown({ ...createMinimumDefinition(), schemaVersion: "2" });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "schema.unsupportedVersion");
});

test("rejects optional feature usage in the basic core", () => {
  for (const feature of ["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"]) {
    const loaded = loadUnknown({
      ...createMinimumDefinition(),
      enabledFeatures: [feature],
    });

    assert.equal(loaded.ok, false);
    assert.equal(!loaded.ok && loaded.errors[0]?.code, "feature.unsupported");
  }
});

test("distinguishes unknown optional feature names from unsupported known features", () => {
  const loaded = loadUnknown({
    ...createMinimumDefinition(),
    enabledFeatures: ["bmob"],
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "feature.unknown");
});

test("rejects duplicate optional feature names before module setup", () => {
  const loaded = loadUnknown({
    ...createMinimumDefinition(),
    enabledFeatures: ["bomb", "bomb"],
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "feature.duplicate",
    "feature.unsupported",
  ]);
});

test("rejects disabled feature fields", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          graze: { radius: 12 },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "definition.unknownField");
});

test("rejects duplicate ids and missing assets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      enemies: [
        ...definition.content.enemies,
        { id: "enemy.scout", version: 1, asset: "enemy.missing", collision: { radius: 12 }, hp: 10, score: 10 },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(
    !loaded.ok && loaded.errors.map((error) => error.code),
    ["id.duplicate", "asset.notFound"],
  );
});

test("rejects missing player shot and stage timeline references", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          shot: { definition: "playerShot.missing" },
        },
      ],
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.missing",
                path: "path.missing",
                pattern: "pattern.missing",
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(
    !loaded.ok && loaded.errors.map((error) => error.code),
    ["playerShot.notFound", "enemy.notFound", "pattern.notFound", "path.notFound"],
  );
});

test("rejects missing pattern bullet references", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.missing_bullet",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.missing",
            offset: { x: 0, y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), ["bullet.notFound"]);
});

test("rejects malformed pattern fireOnSpawn definitions", () => {
  const definition = createMinimumDefinition();
  const shapeCases: Array<{
    codes: readonly string[];
    label: string;
    fireOnSpawn: unknown;
    messages: readonly string[];
  }> = [
    {
      codes: ["definition.invalidShape"],
      label: "non object fireOnSpawn",
      fireOnSpawn: "bullet.red_small",
      messages: ["pattern.fireOnSpawn must be an object"],
    },
    {
      codes: ["definition.unknownField"],
      label: "unknown fireOnSpawn field",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: { x: 0, y: 0 },
        extra: true,
      },
      messages: ["Unknown field at pattern.fireOnSpawn.extra"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "missing bullet",
      fireOnSpawn: {
        offset: { x: 0, y: 0 },
      },
      messages: ["pattern.fireOnSpawn.bullet must be a string"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "empty bullet",
      fireOnSpawn: {
        bullet: "",
        offset: { x: 0, y: 0 },
      },
      messages: ["pattern.fireOnSpawn.bullet must be a string"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "non string bullet",
      fireOnSpawn: {
        bullet: 1,
        offset: { x: 0, y: 0 },
      },
      messages: ["pattern.fireOnSpawn.bullet must be a string"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "missing offset",
      fireOnSpawn: {
        bullet: "bullet.red_small",
      },
      messages: ["pattern.fireOnSpawn.offset must be an object"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "non object offset",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: "0,0",
      },
      messages: ["pattern.fireOnSpawn.offset must be an object"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "invalid offset y",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: { x: 0, y: "0" },
      },
      messages: ["pattern.fireOnSpawn.offset.y must be a finite number"],
    },
    {
      codes: ["definition.unknownField"],
      label: "unknown offset field",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: { x: 0, y: 0, extra: true },
      },
      messages: ["Unknown field at pattern.fireOnSpawn.offset.extra"],
    },
  ];

  for (const shapeCase of shapeCases) {
    const loaded = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        patterns: [
          ...definition.content.patterns,
          {
            id: `pattern.bad_fire_${shapeCase.label.replaceAll(" ", "_")}`,
            version: 1,
            fireOnSpawn: shapeCase.fireOnSpawn,
          },
        ],
      },
    });

    assert.equal(loaded.ok, false, shapeCase.label);
    assert.deepEqual(
      !loaded.ok && loaded.errors.map((error) => error.code),
      shapeCase.codes,
      shapeCase.label,
    );
    assert.deepEqual(
      !loaded.ok && loaded.errors.map((error) => error.message),
      shapeCase.messages,
      shapeCase.label,
    );
  }

  const malformedOffset = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.bad_fire",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: "0", y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(malformedOffset.ok, false);
  assert.deepEqual(!malformedOffset.ok && malformedOffset.errors.map((error) => error.code), [
    "definition.invalidShape",
  ]);
  assert.deepEqual(!malformedOffset.ok && malformedOffset.errors.map((error) => error.message), [
    "pattern.fireOnSpawn.offset.x must be a finite number",
  ]);

  for (const nonJsonNumber of [Number.POSITIVE_INFINITY, Number.NaN]) {
    const malformedPlainData = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        patterns: [
          ...definition.content.patterns,
          {
            id: "pattern.bad_fire_non_json_number",
            version: 1,
            fireOnSpawn: {
              bullet: "bullet.red_small",
              offset: { x: 0, y: nonJsonNumber },
            },
          },
        ],
      },
    });

    assert.equal(malformedPlainData.ok, false);
    assert.deepEqual(!malformedPlainData.ok && malformedPlainData.errors.map((error) => error.code), [
      "definition.invalidShape",
    ]);
    assert.deepEqual(!malformedPlainData.ok && malformedPlainData.errors.map((error) => error.message), [
      "GameDefinition must be JSON-compatible plain data",
    ]);
  }

  const malformedOffsetWithMissingBullet = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.bad_fire",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.missing",
            offset: { x: "0", y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(malformedOffsetWithMissingBullet.ok, false);
  assert.deepEqual(!malformedOffsetWithMissingBullet.ok && malformedOffsetWithMissingBullet.errors.map((error) => error.code), [
    "definition.invalidShape",
  ]);
  assert.equal(
    !malformedOffsetWithMissingBullet.ok
      && malformedOffsetWithMissingBullet.errors.some((error) => error.code === "bullet.notFound"),
    false,
  );

  const malformedBullet = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.bad_fire",
          version: 1,
          fireOnSpawn: {
            bullet: "enemy.scout",
            offset: { x: 0, y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(malformedBullet.ok, false);
  assert.deepEqual(!malformedBullet.ok && malformedBullet.errors.map((error) => error.code), [
    "id.invalidNamespace",
  ]);
  assert.deepEqual(!malformedBullet.ok && malformedBullet.errors.map((error) => error.message), [
    "pattern.fireOnSpawn.bullet must reference a bullet.* id: enemy.scout",
  ]);
});

test("rejects malformed default player id before lookup", () => {
  const malformedDefault = loadUnknown({
    ...createMinimumDefinition(),
    defaultPlayerId: "enemy.scout",
  });
  assert.equal(malformedDefault.ok, false);
  assert.equal(!malformedDefault.ok && malformedDefault.errors[0]?.code, "id.invalidNamespace");

  const missingDefault = loadUnknown({
    ...createMinimumDefinition(),
    defaultPlayerId: "player.missing",
  });
  assert.equal(missingDefault.ok, false);
  assert.equal(!missingDefault.ok && missingDefault.errors[0]?.code, "player.defaultNotFound");
});

test("rejects malformed content reference ids before lookup", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          shot: { definition: "playerShot." },
        },
      ],
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy/unsafe",
                path: "path.",
                pattern: "pattern..unsafe",
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "id.invalidNamespace",
    "id.invalidNamespace",
    "id.invalidNamespace",
    "id.invalidNamespace",
  ]);
});

test("rejects invalid numeric content constraints", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          collision: { radius: 0 },
        },
      ],
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            {
              ...definition.content.stages[0]!.timeline[0]!,
              tick: 1.5,
            },
          ],
        },
      ],
      enemies: [{ ...definition.content.enemies[0], collision: { radius: -2 }, hp: -10 }],
      bullets: [{ ...definition.content.bullets[0], collision: { radius: 0 } }],
      playerShots: [{
        ...definition.content.playerShots[0],
        collision: { radius: -1 },
        projectile: { velocity: { x: Number.NaN, y: -8 }, lifetimeTicks: 0 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors.every((error) => error.code === "definition.invalidShape"), true);
});

test("rejects player focus speed that exceeds normal movement speed", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          movement: { speed: 4, focusSpeed: 8 },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "player.movement.focusSpeed must be less than or equal to player.movement.speed",
  ]);
});

test("rejects player movement speeds that exceed runtime budgets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          movement: { speed: 17, focusSpeed: 16.5 },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "player.movement.speed must be less than or equal to 16",
    "player.movement.focusSpeed must be less than or equal to 16",
  ]);
});

test("rejects invalid player shot projectile constraints in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        projectile: { velocity: { x: "fast", y: -8 }, lifetimeTicks: 0 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile.velocity.x must be a finite number",
    "playerShot.projectile.lifetimeTicks must be a positive integer",
  ]);
});

test("rejects invalid player shot fire interval constraints in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  for (const intervalTicks of [undefined, 0, 1.5, "3"] as const) {
    const loaded = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        playerShots: [{
          ...definition.content.playerShots[0],
          fire: intervalTicks === undefined ? {} : { intervalTicks },
        }],
      },
    });

    assert.equal(loaded.ok, false);
    assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
      "playerShot.fire.intervalTicks must be a positive integer",
    ]);
  }
});

test("rejects unknown player shot fire fields in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        fire: { intervalTicks: 3, extra: true },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "Unknown field at playerShot.fire.extra",
  ]);
});

test("rejects player shot fire intervals that exceed runtime budgets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        fire: { intervalTicks: 61 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.fire.intervalTicks must be at most 60",
  ]);
});

test("accepts player shot fire interval budget boundaries", () => {
  const definition = createMinimumDefinition();
  for (const intervalTicks of [1, 60] as const) {
    const loaded = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        playerShots: [{
          ...definition.content.playerShots[0],
          fire: { intervalTicks },
        }],
      },
    });

    assert.equal(loaded.ok, true);
  }
});

test("rejects missing player shot fire objects in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const playerShotWithoutFire = { ...definition.content.playerShots[0] } as Record<string, unknown>;
  delete playerShotWithoutFire.fire;
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [playerShotWithoutFire],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.fire must be an object",
  ]);
});

test("rejects missing player shot projectile objects in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const playerShotWithoutProjectile = { ...definition.content.playerShots[0] } as Record<string, unknown>;
  delete playerShotWithoutProjectile.projectile;
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [playerShotWithoutProjectile],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile must be an object",
  ]);
});

test("rejects missing player shot projectile velocity in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        projectile: { lifetimeTicks: 3 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile.velocity must be an object",
  ]);
});

test("rejects player shot projectile values that exceed runtime budgets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        projectile: { velocity: { x: 65, y: -65 }, lifetimeTicks: 301 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile.velocity.x must be between -64 and 64",
    "playerShot.projectile.velocity.y must be between -64 and 64",
    "playerShot.projectile.lifetimeTicks must be at most 300",
  ]);
});

test("rejects empty asset keys and duplicate difficulties", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [...definition.content.assetKeys.keys, "", "player.default"],
      },
      stages: [
        {
          ...definition.content.stages[0],
          difficulties: ["normal", "normal"],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "asset.invalidKey",
    "asset.duplicate",
    "definition.invalidShape",
  ]);
});

test("rejects stages that cannot be started because no difficulty is supported", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          difficulties: [],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "definition.invalidShape");
});

test("rejects unsorted stage timeline ticks", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            { ...definition.content.stages[0]!.timeline[0]!, tick: 60 },
            { ...definition.content.stages[0]!.timeline[0]!, tick: 30 },
          ],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "timeline.invalidOrder");
});

test("rejects stage timeline content that exceeds runtime budgets", () => {
  const definition = createMinimumDefinition();
  const spawnStep = definition.content.stages[0]!.timeline[0]!;
  const tooManySameTickSpawns = Array.from({ length: 101 }, () => ({ ...spawnStep, tick: 0 }));
  const sameTickLoaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          timeline: tooManySameTickSpawns,
        },
      ],
    },
  });

  assert.equal(sameTickLoaded.ok, false);
  assert.equal(
    !sameTickLoaded.ok && sameTickLoaded.errors.some((error) => error.code === "timeline.tooManySpawnsPerTick"),
    true,
  );

  const tooManySteps = Array.from({ length: 4_097 }, (_, index) => ({ ...spawnStep, tick: index }));
  const tooLongLoaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          timeline: tooManySteps,
        },
      ],
    },
  });

  assert.equal(tooLongLoaded.ok, false);
  assert.equal(!tooLongLoaded.ok && tooLongLoaded.errors.some((error) => error.code === "timeline.tooManySteps"), true);
});

test("rejects malformed namespace ids and asset keys", () => {
  const definition = createMinimumDefinition();
  const invalidAsset = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [...definition.content.assetKeys.keys, "asset/unsafe"],
      },
    },
  });
  assert.equal(invalidAsset.ok, false);
  assert.deepEqual(!invalidAsset.ok && invalidAsset.errors.map((error) => error.code), ["asset.invalidKey"]);

  const invalidId = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          id: "player.",
        },
      ],
    },
  });
  assert.equal(invalidId.ok, false);
  assert.equal(!invalidId.ok && invalidId.errors.some((error) => error.code === "id.invalidNamespace"), true);
});

test("uses the same full-length id constraint during load and startStage", () => {
  const stageId = `stage.${"a".repeat(128)}`;
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          id: stageId,
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors.some((error) => error.code === "id.invalidNamespace"), true);
});

test("rejects malformed asset references before lookup", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          asset: "player/unsafe",
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), ["asset.invalidKey"]);
});

test("rejects external input that exceeds plain-data clone budgets", () => {
  const tooDeep: Record<string, unknown> = {};
  let cursor = tooDeep;
  for (let depth = 0; depth < 64; depth += 1) {
    cursor.next = {};
    cursor = cursor.next as Record<string, unknown>;
  }

  const loaded = loadUnknown(tooDeep);
  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "definition.invalidShape");
});

test("rejects out-of-order input ticks without advancing the session", () => {
  const started = startMinimumStage();

  const mismatch = started.tick(createEmptyInputFrame(1));
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.errors[0]?.code, "input.tickMismatch");

  const recovered = started.tick(createEmptyInputFrame(0));
  assert.equal(recovered.ok, true);
  assert.equal(recovered.ok && recovered.value.tick, 0);
});

test("rejects invalid startStage and tick inputs without throwing", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const invalidStart = startStageUnknown(loaded.value, null);
  assert.equal(invalidStart.ok, false);
  assert.equal(!invalidStart.ok && invalidStart.errors[0]?.code, "startStage.invalidShape");

  const started = startMinimumStage();
  const invalidInput = tickUnknown(started, { tick: 0, axes: { moveX: 2, moveY: 0 }, held: [], pressed: [], released: [] });
  assert.equal(invalidInput.ok, false);
  assert.equal(!invalidInput.ok && invalidInput.errors[0]?.code, "input.invalidShape");

  const recovered = started.tick(createEmptyInputFrame(0));
  assert.equal(recovered.ok, true);
});

test("rejects throwing runtime inputs without leaking exceptions", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const throwingStartOptions = Object.defineProperty({}, "stageId", {
    enumerable: true,
    get() {
      throw new Error("unexpected startStage getter access");
    },
  });
  const invalidStart = startStageUnknown(loaded.value, throwingStartOptions);
  assert.equal(invalidStart.ok, false);
  assert.equal(!invalidStart.ok && invalidStart.errors[0]?.code, "startStage.invalidShape");

  const started = startMinimumStage();
  const throwingInput = new Proxy(createEmptyInputFrame(0), {
    getOwnPropertyDescriptor() {
      throw new Error("unexpected input proxy access");
    },
  });
  const invalidInput = tickUnknown(started, throwingInput);
  assert.equal(invalidInput.ok, false);
  assert.equal(!invalidInput.ok && invalidInput.errors[0]?.code, "input.invalidShape");
});

test("validates startStage seed before creating a PRNG", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const blankSeed = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "   ",
  });
  assert.equal(blankSeed.ok, false);
  assert.equal(!blankSeed.ok && blankSeed.errors[0]?.code, "startStage.invalidShape");
});

test("rejects malformed startStage ids before content lookup", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const invalidStageId = loaded.value.startStage({
    stageId: "stage.",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(invalidStageId.ok, false);
  assert.equal(!invalidStageId.ok && invalidStageId.errors[0]?.code, "startStage.invalidShape");

  const invalidPlayerId = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player/unsafe" as never,
    seed: "seed-1",
  });
  assert.equal(invalidPlayerId.ok, false);
  assert.equal(!invalidPlayerId.ok && invalidPlayerId.errors[0]?.code, "startStage.invalidShape");
});

test("rejects valid startStage ids that are not available in loaded content", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const missingStage = loaded.value.startStage({
    stageId: "stage.missing",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(missingStage.ok, false);
  assert.equal(!missingStage.ok && missingStage.errors[0]?.code, "stage.notFound");

  const missingPlayer = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.missing",
    seed: "seed-1",
  });
  assert.equal(missingPlayer.ok, false);
  assert.equal(!missingPlayer.ok && missingPlayer.errors[0]?.code, "player.notFound");

  const unsupportedDifficulty = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "hard",
    seed: "seed-1",
  });
  assert.equal(unsupportedDifficulty.ok, false);
  assert.equal(!unsupportedDifficulty.ok && unsupportedDifficulty.errors[0]?.code, "difficulty.notSupported");
});

test("canonicalizes input actions and accepts same-tick tap edges", () => {
  const sorted = startMinimumStage();
  const sortedFrame = sorted.tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["focus", "shot"],
    pressed: ["focus"],
    released: [],
  });
  assert.equal(sortedFrame.ok, true);

  const duplicated = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot", "shot"],
    pressed: [],
    released: [],
  });
  assert.equal(duplicated.ok, false);
  assert.equal(!duplicated.ok && duplicated.errors[0]?.code, "input.invalidShape");

  const crossed = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: [],
    pressed: ["shot"],
    released: ["shot"],
  });
  assert.equal(crossed.ok, true);
  if (!crossed.ok) {
    assert.fail("expected crossed tap edge frame");
  }
  assert.deepEqual(crossed.ok && crossed.value.events.map((event) => event.type), [
    "stageStarted",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(crossed.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(crossed.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const heldReleased = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot"],
    pressed: ["shot"],
    released: ["shot"],
  });
  assert.equal(heldReleased.ok, false);
  assert.equal(!heldReleased.ok && heldReleased.errors[0]?.code, "input.invalidShape");
});

test("rejects mismatch after a successful tick without duplicating pending events", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);

  const mismatch = started.tick(createEmptyInputFrame(2));
  assert.equal(mismatch.ok, false);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.deepEqual(frame1.ok && frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
});

test("recovers from a tick mismatch after spawning a player shot without duplicating ids", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createShotInputFrame(0));
  assert.equal(frame0.ok, true);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);

  const mismatch = started.tick(createShotInputFrame(3));
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.errors[0]?.code, "input.tickMismatch");

  const frame2 = started.tick(createEmptyInputFrame(2));
  assert.equal(frame2.ok, true);

  const frame3 = started.tick(createShotInputFrame(3));
  assert.equal(frame3.ok, true);
  if (!frame3.ok) {
    assert.fail("expected recovered shot frame");
  }
  assert.deepEqual(frame3.value.events, [
    {
      type: "playerShotsSpawnedBatch",
      tick: 3,
      shots: [
        {
          entityId: 3,
          definitionId: "playerShot.basic",
          position: { x: 192, y: 400 },
        },
      ],
    },
    { type: "tickAdvanced", tick: 3 },
  ]);
  assert.deepEqual(frame3.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("rolls back working state when a failure occurs after mutation", () => {
  const definition = createRollbackCollisionDefinition();
  const baseline = startStageFromDefinition(definition);
  const hooked = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    failAfterWorkingMutationTicks: [1],
  }), definition);

  const baselineFrame0 = baseline.tick(createEmptyInputFrame(0));
  const hookedFrame0 = hooked.tick(createEmptyInputFrame(0));
  assert.equal(baselineFrame0.ok, true);
  assert.equal(hookedFrame0.ok, true);
  assert.deepEqual(hookedFrame0.ok && hookedFrame0.value, baselineFrame0.ok && baselineFrame0.value);

  const failed = hooked.tick(createPressedShotInputFrame(1));
  assert.equal(failed.ok, false);
  assert.equal(!failed.ok && failed.errors[0]?.code, "testHook.failure");
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /entities=4->5/);
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /expectedTick=1->2/);
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /nextEntityId=5->6/);
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /score=0->1/);
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /timelineCursor=2->3/);

  const baselineFrame1 = baseline.tick(createPressedShotInputFrame(1));
  const recoveredFrame1 = hooked.tick(createPressedShotInputFrame(1));
  assert.equal(baselineFrame1.ok, true);
  assert.equal(recoveredFrame1.ok, true);
  assert.deepEqual(recoveredFrame1.ok && recoveredFrame1.value, baselineFrame1.ok && baselineFrame1.value);
  if (!recoveredFrame1.ok) {
    assert.fail("expected recovered collision frame");
  }
  assert.deepEqual(recoveredFrame1.value.events.map((event) => event.type), [
    "entitySpawned",
    "entitySpawned",
    "playerShotsSpawnedBatch",
    "playerHit",
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
    "tickAdvanced",
  ]);
  assert.deepEqual(recoveredFrame1.value.state.entities.map((entity) => entity.id), [1, 3]);

  const baselineFrame2 = baseline.tick(createEmptyInputFrame(2));
  const recoveredFrame2 = hooked.tick(createEmptyInputFrame(2));
  assert.equal(baselineFrame2.ok, true);
  assert.equal(recoveredFrame2.ok, true);
  assert.deepEqual(recoveredFrame2.ok && recoveredFrame2.value, baselineFrame2.ok && baselineFrame2.value);

  const baselineFrame3 = baseline.tick(createPressedShotInputFrame(3));
  const recoveredFrame3 = hooked.tick(createPressedShotInputFrame(3));
  assert.equal(baselineFrame3.ok, true);
  assert.equal(recoveredFrame3.ok, true);
  assert.deepEqual(recoveredFrame3.ok && recoveredFrame3.value, baselineFrame3.ok && baselineFrame3.value);
});

test("rolls back pending startup events when a failure occurs before the first committed frame", () => {
  const baseline = startMinimumStage();
  const hooked = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    failAfterWorkingMutationTicks: [0],
  }), createMinimumDefinition());

  const failed = hooked.tick(createEmptyInputFrame(0));
  assert.equal(failed.ok, false);
  assert.equal(!failed.ok && failed.errors[0]?.code, "testHook.failure");
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /entities=1->2/);
  assert.match(!failed.ok ? failed.errors[0]?.message ?? "" : "", /expectedTick=0->1/);

  const baselineFrame0 = baseline.tick(createEmptyInputFrame(0));
  const recoveredFrame0 = hooked.tick(createEmptyInputFrame(0));
  assert.equal(baselineFrame0.ok, true);
  assert.equal(recoveredFrame0.ok, true);
  assert.deepEqual(recoveredFrame0.ok && recoveredFrame0.value, baselineFrame0.ok && baselineFrame0.value);
  assert.deepEqual(recoveredFrame0.ok && recoveredFrame0.value.events.map((event) => event.type), [
    "stageStarted",
    "tickAdvanced",
  ]);
});

test("latches committed snapshot restore failures as fatal stage session errors", () => {
  const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    corruptCommittedPrngStateTicks: [0],
  }), createMinimumDefinition());

  const fatal = started.tick(createEmptyInputFrame(0));
  assert.equal(fatal.ok, false);
  assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
  assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", /prng\.invalidState/);

  const malformedInputAfterFatal = tickUnknown(started, {
    tick: "bad",
    axes: { moveX: 0, moveY: 0 },
    held: [],
    pressed: [],
    released: [],
  });
  assert.deepEqual(malformedInputAfterFatal, fatal);

  const futureTickAfterFatal = started.tick(createEmptyInputFrame(1));
  assert.deepEqual(futureTickAfterFatal, fatal);

  const serializedAfterFatal = started.serialize();
  assert.deepEqual(serializedAfterFatal, fatal);
});

test("latches serialize invariant failures as fatal stage session errors", () => {
  const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    overrideCommittedNextEntityIdOnSerialize: 1,
  }), createMinimumDefinition());

  const fatal = started.serialize();
  assert.equal(fatal.ok, false);
  assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
  assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", /nextEntityId must be greater/);

  assert.deepEqual(started.serialize(), fatal);
  assert.deepEqual(started.tick(createEmptyInputFrame(0)), fatal);
});

test("latches serialize-only committed snapshot invariant failures", () => {
  const expectSerializeFatal = (hooks: NonNullable<Parameters<typeof createShootingCoreWithTestingHooksForInternalTest>[1]>, detail: RegExp) => {
    const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", hooks), createMinimumDefinition());

    const fatal = started.serialize();
    assert.equal(fatal.ok, false);
    assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
    assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", detail);
    assert.deepEqual(started.serialize(), fatal);
    assert.deepEqual(started.tick(createEmptyInputFrame(0)), fatal);
  };

  expectSerializeFatal({
    overrideCommittedNextEntityIdOnSerialize: Number.MAX_SAFE_INTEGER + 1,
  }, /nextEntityId must be a positive safe integer/);
  expectSerializeFatal({
    overrideCommittedPendingEventsOnSerialize: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01", extra: "reject" }],
  }, /unsupported pending event in committed state/);
  expectSerializeFatal({
    overrideCommittedPrngStateOnSerialize: { state: 0 },
  }, /prng\.invalidState/);
});

test("latches serialize runtime entity order invariant failures", () => {
  const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    reverseCommittedEntitiesOnSerialize: true,
  }), createFireOnSpawnAtZeroDefinition());

  const frame = started.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);

  const fatal = started.serialize();
  assert.equal(fatal.ok, false);
  assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
  assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", /active entity ids must be sorted/);
  assert.deepEqual(started.serialize(), fatal);
  assert.deepEqual(started.tick(createEmptyInputFrame(1)), fatal);
});

test("keeps serialize-only test hook mutations out of committed state", () => {
  const fatalCommittedStates: unknown[] = [];
  const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    overrideCommittedNextEntityIdOnSerialize: Number.MAX_SAFE_INTEGER + 1,
    overrideCommittedPendingEventsOnSerialize: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01", extra: "reject" }],
    overrideCommittedPrngStateOnSerialize: { state: 0 },
    recordCommittedStateOnFatal: (state) => fatalCommittedStates.push(state),
  }), createMinimumDefinition());

  const fatal = started.serialize();
  assert.equal(fatal.ok, false);
  assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
  assert.equal(fatalCommittedStates.length, 1);

  const fatalCommittedState = fatalCommittedStates[0] as {
    activeEntities: Array<{ id: number }>;
    nextEntityId: number;
    pendingEvents: unknown[];
    prngState: { state: number };
  };
  assert.deepEqual(fatalCommittedState.activeEntities.map((entity) => entity.id), [1]);
  assert.equal(fatalCommittedState.nextEntityId, 2);
  assert.deepEqual(fatalCommittedState.pendingEvents, [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }]);
  assert.equal(fatalCommittedState.prngState.state, 3597787782);
});

test("latches runtime invariant failures after working state restore", () => {
  const fatalCommittedStates: unknown[] = [];
  const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    overrideCommittedNextEntityIdTicks: [{
      tick: 0,
      nextEntityId: Number.MAX_SAFE_INTEGER - 1,
    }],
    recordCommittedStateOnFatal: (state) => fatalCommittedStates.push(state),
  }), createFireOnSpawnAtZeroDefinition());

  const fatal = started.tick(createEmptyInputFrame(0));
  assert.equal(fatal.ok, false);
  assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
  assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", /entityAllocator\.invalidState/);

  const repeated = started.tick(createEmptyInputFrame(1));
  assert.deepEqual(repeated, fatal);
  assert.equal(fatalCommittedStates.length, 1);
  const fatalCommittedState = fatalCommittedStates[0] as {
    expectedTick: number;
    activeEntities: Array<{ id: number; kind: string; definitionId: string }>;
    nextEntityId: number;
    pendingEvents: unknown[];
    prngState: { state: number };
    score: number;
    timelineCursor: number;
  };
  assert.equal(fatalCommittedState.expectedTick, 0);
  assert.deepEqual(fatalCommittedState.activeEntities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
  })), [
    { id: 1, kind: "player", definitionId: "player.default" },
  ]);
  assert.equal(fatalCommittedState.nextEntityId, Number.MAX_SAFE_INTEGER - 1);
  assert.deepEqual(fatalCommittedState.pendingEvents, [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }]);
  assert.equal(fatalCommittedState.prngState.state, 3597787782);
  assert.equal(fatalCommittedState.score, 0);
  assert.equal(fatalCommittedState.timelineCursor, 0);
});

test("latches nextEntityId snapshots that would duplicate active entity ids", () => {
  const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    overrideCommittedNextEntityIdTicks: [{
      tick: 0,
      nextEntityId: 1,
    }],
  }), createMinimumDefinition());

  const fatal = started.tick(createPressedShotInputFrame(0));
  assert.equal(fatal.ok, false);
  assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
  assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", /nextEntityId must be greater/);
});

test("latches invalid committed pending event snapshots", () => {
  const expectPendingEventFatal = (pendingEvents: readonly unknown[]) => {
    const started = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
      overrideCommittedPendingEventsTicks: [{
        tick: 0,
        pendingEvents,
      }],
    }), createMinimumDefinition());

    const fatal = started.tick(createEmptyInputFrame(0));
    assert.equal(fatal.ok, false);
    assert.equal(!fatal.ok && fatal.errors[0]?.code, "stageSession.fatal");
    assert.match(!fatal.ok ? fatal.errors[0]?.message ?? "" : "", /unsupported pending event in committed state/);
    assert.deepEqual(started.tick(createEmptyInputFrame(0)), fatal);
  };

  expectPendingEventFatal([]);
  expectPendingEventFatal([{ type: "stageStarted", tick: 0, stageId: "stage.other" }]);
  expectPendingEventFatal([{ type: "stageStarted", tick: 0, stageId: "stage.stage_01", extra: "reject" }]);
  expectPendingEventFatal([
    { type: "stageStarted", tick: 0, stageId: "stage.stage_01" },
    { type: "stageStarted", tick: 0, stageId: "stage.stage_01" },
  ]);
  expectPendingEventFatal([{ type: "scoreChanged", tick: 0, delta: 1, total: 1 }]);

  const staleStartupEvent = startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
    overrideCommittedPendingEventsTicks: [{
      tick: 1,
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
    }],
  }), createMinimumDefinition());

  const frame0 = staleStartupEvent.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  const staleFatal = staleStartupEvent.tick(createEmptyInputFrame(1));
  assert.equal(staleFatal.ok, false);
  assert.equal(!staleFatal.ok && staleFatal.errors[0]?.code, "stageSession.fatal");
  assert.match(!staleFatal.ok ? staleFatal.errors[0]?.message ?? "" : "", /unsupported pending event in committed state/);
});

test("keeps testing hooks scoped to each created stage session", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("0.0.0", {
    failAfterWorkingMutationTicks: [0],
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with testing hooks");
  }

  const first = startStageFromLoadedGame(loaded.value);
  const second = startStageFromLoadedGame(loaded.value);

  const firstFailure = first.tick(createEmptyInputFrame(0));
  const secondFailure = second.tick(createEmptyInputFrame(0));
  assert.equal(firstFailure.ok, false);
  assert.equal(secondFailure.ok, false);
  assert.equal(!firstFailure.ok && firstFailure.errors[0]?.code, "testHook.failure");
  assert.equal(!secondFailure.ok && secondFailure.errors[0]?.code, "testHook.failure");
});

test("rejects duplicate testing hook override ticks", () => {
  assert.throws(
    () => startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
      overrideCommittedPendingEventsTicks: [
        { tick: 0, pendingEvents: [] },
        { tick: 0, pendingEvents: [] },
      ],
    }), createMinimumDefinition()),
    /Duplicate testing hook override tick: 0/,
  );
  assert.throws(
    () => startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
      overrideCommittedNextEntityIdTicks: [
        { tick: 0, nextEntityId: 1 },
        { tick: 0, nextEntityId: 2 },
      ],
    }), createMinimumDefinition()),
    /Duplicate testing hook override tick: 0/,
  );
});

test("rejects hook-enabled core creation without the internal test environment flag", () => {
  if (!testEnv) {
    assert.fail("expected node test environment");
  }

  const previousFlag = testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS;
  delete testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS;
  try {
    assert.throws(
      () => createShootingCoreWithTestingHooksForInternalTest("0.0.0", {
        failAfterWorkingMutationTicks: [0],
      }),
      /SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS=1/,
    );
  } finally {
    testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS = previousFlag;
  }
});

test("returns immutable event frames and drains one-shot events", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected frame");
  }
  assert.equal(Object.isFrozen(frame0.value.events), true);
  assert.equal(Object.isFrozen(frame0.value.events[0]), true);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.deepEqual(frame1.ok && frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
});

function startMinimumStage() {
  return startStageFromDefinition(createMinimumDefinition());
}

function loadMinimumGame(coreVersion = "0.0.0") {
  const loaded = createShootingCore(coreVersion).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  return loaded.value;
}

function loadGameWithRestoreCapture(
  definition: GameDefinition,
  capturedSnapshots: SerializedGameState[],
  coreVersion = "core.test",
) {
  const loaded = createShootingCoreWithTestingHooksForTest(coreVersion, {
    recordRestoreSerializedSnapshot: (snapshot) => capturedSnapshots.push(snapshot),
  }).load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  return loaded.value;
}

function toNullPrototypePlainData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => toNullPrototypePlainData(item)) as T;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const clone = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) {
    clone[key] = toNullPrototypePlainData(child);
  }

  return clone as T;
}

function serializeInitialStageState(coreVersion = "0.0.0"): SerializedGameState {
  const started = startStageFromLoadedGame(loadMinimumGame(coreVersion));
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  return serialized.value;
}

function startStageFromDefinition(definition: GameDefinition) {
  return startStageFromCoreAndDefinition(createShootingCore("0.0.0"), definition);
}

function startStageFromCoreAndDefinition(core: ShootingCore, definition: GameDefinition) {
  const loaded = core.load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  return startStageFromLoadedGame(loaded.value);
}

function startStageFromLoadedGame(loaded: LoadedGame) {
  const started = loaded.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  return started.value;
}

function assertTickAndSerializeMatch(restored: StageSession, baseline: StageSession, input: InputFrame) {
  const restoredFrame = assertTickOk(restored.tick(input), `restored tick ${input.tick}`);
  const baselineFrame = assertTickOk(baseline.tick(input), `baseline tick ${input.tick}`);
  assert.deepEqual(restoredFrame, baselineFrame);
  const restoredSnapshot = assertSerializeOk(restored.serialize(), `restored serialize ${input.tick}`);
  const baselineSnapshot = assertSerializeOk(baseline.serialize(), `baseline serialize ${input.tick}`);
  assert.deepEqual(restoredSnapshot, baselineSnapshot);
  return baselineFrame;
}

function assertTickOk(frame: ReturnType<StageSession["tick"]>, label: string) {
  if (!frame.ok) {
    assert.fail(`${label} failed: ${JSON.stringify(frame)}`);
  }

  return frame.value;
}

function assertSerializeOk(snapshot: ReturnType<StageSession["serialize"]>, label: string) {
  if (!snapshot.ok) {
    assert.fail(`${label} failed: ${JSON.stringify(snapshot)}`);
  }

  return snapshot.value;
}

/** tick 後の committed hash DTO を serialize hook から収集し、tick/hash 比較用へ変換する。 */
function collectStateHashSamples(definition: GameDefinition, inputs: readonly InputFrame[]) {
  const states: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => states.push(state),
  }).load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const session = startStageFromLoadedGame(loaded.value);
  return inputs.map((input) => {
    assertTickOk(session.tick(input), `state-hash smoke tick ${input.tick}`);
    return {
      tick: input.tick,
      hash: serializeAndCaptureStateHash(session, states, `state-hash smoke serialize ${input.tick}`).hash,
    };
  });
}

/** serialize hook が今回の serialize で hash DTO を一件だけ追加したことを検証する。 */
function serializeAndCaptureStateHash(
  session: StageSession,
  states: readonly HashableGameState[],
  label: string,
): Readonly<{ snapshot: SerializedGameState; hash: string }> {
  const stateIndex = states.length;
  const snapshot = assertSerializeOk(session.serialize(), label);
  assert.equal(states.length, stateIndex + 1, `${label} must record exactly one hashable state`);
  return Object.freeze({
    snapshot,
    hash: hashHashableGameState(states[stateIndex]!),
  });
}

function createCollisionScoreDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.none",
            position: { x: 192, y: 380 },
          },
        }],
      }],
      playerShots: [{
        ...definition.content.playerShots[0]!,
        damage: 10,
      }],
    },
  };
}

function createEnemyBulletHitDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.spawn_bullet",
            position: { x: 192, y: 392 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.spawn_bullet",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: 0, y: 8 },
        },
      }],
    },
  };
}

function createAlternatePlayerHardDifficultyDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [
          ...definition.content.assetKeys.keys,
          "player.alt",
        ],
      },
      players: [
        ...definition.content.players,
        {
          id: "player.alt",
          version: 1,
          asset: "player.alt",
          movement: { speed: 5, focusSpeed: 2 },
          collision: { radius: 2 },
          life: { initialLives: 5, invincibleTicksAfterHit: 90 },
          shot: { definition: "playerShot.basic" },
        },
      ],
      stages: [{
        ...definition.content.stages[0]!,
        difficulties: ["normal", "hard"],
      }],
    },
  };
}

function createRollbackCollisionDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          {
            tick: 1,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.none",
              position: { x: 192, y: 392 },
            },
          },
          {
            tick: 1,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.none",
              position: { x: 192, y: 392 },
            },
          },
        ],
      }],
      playerShots: [{
        ...definition.content.playerShots[0]!,
        damage: 10,
      }],
    },
  };
}

function createFireOnSpawnAtZeroDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.spawn_bullet",
            position: { x: 192, y: 80 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.spawn_bullet",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: 0, y: 8 },
        },
      }],
    },
  };
}

function createDoubleFireOnSpawnAtZeroDefinition(): GameDefinition {
  const definition = createFireOnSpawnAtZeroDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          definition.content.stages[0]!.timeline[0]!,
          {
            tick: 0,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.spawn_bullet",
              position: { x: 128, y: 96 },
            },
          },
        ],
      }],
    },
  };
}

function createFutureTimelineAfterRestoreDefinition(): GameDefinition {
  const definition = createFireOnSpawnAtZeroDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          ...definition.content.stages[0]!.timeline,
          {
            tick: 2,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.spawn_bullet",
              position: { x: 128, y: 96 },
            },
          },
        ],
      }],
    },
  };
}

function createShotInputFrame(tick: number): InputFrame {
  return createPressedShotInputFrame(tick);
}

function createHeldShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze(["shot"] as const),
    pressed: Object.freeze([] as const),
    released: Object.freeze([] as const),
  });
}

function createMoveInputFrame(
  tick: number,
  moveX: -1 | 0 | 1,
  moveY: -1 | 0 | 1,
  held: InputFrame["held"],
): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX, moveY }),
    held: Object.freeze([...held]),
    pressed: Object.freeze([] as const),
    released: Object.freeze([] as const),
  });
}

function createPressedShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze([] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

function createMoveAndPressedShotInputFrame(tick: number, moveX: -1 | 0 | 1, moveY: -1 | 0 | 1): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX, moveY }),
    held: Object.freeze([] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

function createHeldAndPressedShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze(["shot"] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

function loadUnknown(definition: unknown) {
  return createShootingCore().load(definition as GameDefinition);
}

function startStageUnknown(session: LoadedGame, options: unknown) {
  return session.startStage(options as StartStageOptions);
}

function tickUnknown(session: StageSession, input: unknown) {
  return session.tick(input as InputFrame);
}

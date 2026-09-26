import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { StageSession } from "../api-types.ts";
import type { GameDefinition } from "../content/types.ts";
import type { HashableGameState } from "../hash/hashable-state.ts";
import { hashHashableGameState } from "../hash/state-hash.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import type { SerializedGameState } from "../serialization/types.ts";
import {
  createCollisionScoreDefinition,
  createEnemyBulletHitDefinition,
  createFireOnSpawnAtZeroDefinition,
} from "../test-support/definitions.ts";
import { createShotInputFrame } from "../test-support/input-frames.ts";
import { enableInternalTestHooksForTestFile } from "../test-support/internal-test-hooks.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../test-support/stage-harness.ts";
import { findFirstStateHashDivergence } from "../testing/state-hash-comparison.ts";
import { createShootingCoreWithTestingHooksForTest } from "../testing/testing-hooks.ts";

enableInternalTestHooksForTestFile();

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

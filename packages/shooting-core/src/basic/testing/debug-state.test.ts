import assert from "node:assert/strict";
import test from "node:test";

import { createShootingCore } from "../core.ts";
import type { HashableGameState } from "../hash/hashable-state.ts";
import type { GameDefinition } from "../content/types.ts";
import { hashHashableGameState, hashHashablePrngState } from "../hash/state-hash.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import type { HeadlessDebugStateDump, HeadlessDebugStateResult } from "../instrumentation/debug-state.ts";
import { createShootingCoreWithTestingHooksForTest } from "./testing-hooks.ts";
import {
  createHeadlessDebugStateArtifactPathForTest,
  formatHeadlessDebugStateJsonForTest,
  serializeDebugStateForTest,
} from "./debug-state.ts";
import { enableInternalTestHooksForTestFile } from "../test-support/internal-test-hooks.ts";
import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";

enableInternalTestHooksForTestFile();

test("serializes immutable headless debug checkpoints without advancing the session", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    failAfterWorkingMutationTicks: [1],
    recordHashableStateOnSerialize: (state) => hashableStates.push(state),
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "debug-seed",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const initial = assertDebugDumpOk(serializeDebugStateForTest(started.value));
  assert.equal(initial.tick, 0);
  assert.equal(initial.seed, "debug-seed");
  assert.deepEqual(initial.entityCounts, {
    player: 1,
    enemy: 0,
    enemyBullet: 0,
    playerShot: 0,
  });
  assert.equal(initial.collisionCandidates, null);
  assert.equal(initial.eventCounts, null);
  assert.match(initial.stateHash, /^[0-9a-f]{16}$/);
  assert.match(initial.prngHash, /^[0-9a-f]{16}$/);
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Object.isFrozen(initial.entityCounts), true);
  const initialSerialized = started.value.serialize();
  assert.equal(initialSerialized.ok, true);
  assert.equal(hashableStates.length, 1);
  assert.equal(initial.stateHash, hashHashableGameState(hashableStates[0]!));
  assert.equal(initial.prngHash, hashHashablePrngState(hashableStates[0]!.prngState));

  const tick = started.value.tick(createEmptyInputFrame(0));
  assert.equal(tick.ok, true);
  const afterTick = assertDebugDumpOk(serializeDebugStateForTest(started.value));
  assert.equal(afterTick.tick, 1);
  assert.equal(afterTick.seed, "debug-seed");
  assert.notEqual(afterTick.stateHash, initial.stateHash);
  assert.notEqual(afterTick.prngHash, initial.prngHash);
  assert.deepEqual(afterTick.eventCounts, {
    stageStarted: 1,
    tickAdvanced: 1,
    entitySpawned: 0,
    entityDestroyed: 0,
    playerHit: 0,
    playerShotsSpawnedBatch: 0,
    enemyBulletsSpawnedBatch: 0,
    scoreChanged: 0,
  });
  assert.equal(Object.isFrozen(afterTick.eventCounts), true);

  const failedTick = started.value.tick(createEmptyInputFrame(1));
  assert.equal(failedTick.ok, false);
  assert.deepEqual(serializeDebugStateForTest(started.value), { ok: true, value: afterTick, warnings: [] });

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  const restored = loaded.value.restore(serialized.value);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }
  const restoredDump = assertDebugDumpOk(serializeDebugStateForTest(restored.value));
  assert.equal(restoredDump.tick, afterTick.tick);
  assert.equal(restoredDump.seed, null);
  assert.equal(restoredDump.stateHash, afterTick.stateHash);
  assert.equal(restoredDump.prngHash, afterTick.prngHash);
  assert.equal(restoredDump.collisionCandidates, null);
  assert.equal(restoredDump.eventCounts, null);
});

test("marks tick metrics unavailable after restoring a tick zero snapshot", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {}).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "tick-zero-restore",
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
  const restored = loaded.value.restore(serialized.value);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restored session");
  }

  const dump = assertDebugDumpOk(serializeDebugStateForTest(restored.value));
  assert.equal(dump.tick, 0);
  assert.equal(dump.collisionCandidates, null);
  assert.equal(dump.eventCounts, null);

  assert.equal(restored.value.tick(createEmptyInputFrame(0)).ok, true);
  const firstTickDump = assertDebugDumpOk(serializeDebugStateForTest(restored.value));
  assert.equal(firstTickDump.collisionCandidates, 0);
  assert.deepEqual(firstTickDump.eventCounts, {
    stageStarted: 1,
    tickAdvanced: 1,
    entitySpawned: 0,
    entityDestroyed: 0,
    playerHit: 0,
    playerShotsSpawnedBatch: 0,
    enemyBulletsSpawnedBatch: 0,
    scoreChanged: 0,
  });

  assert.equal(restored.value.tick(createEmptyInputFrame(1)).ok, true);
  const secondTickDump = assertDebugDumpOk(serializeDebugStateForTest(restored.value));
  assert.equal(secondTickDump.collisionCandidates, 0);
  assert.deepEqual(secondTickDump.eventCounts, {
    stageStarted: 0,
    tickAdvanced: 1,
    entitySpawned: 0,
    entityDestroyed: 0,
    playerHit: 0,
    playerShotsSpawnedBatch: 0,
    enemyBulletsSpawnedBatch: 0,
    scoreChanged: 0,
  });
});

test("matches the canonical state hash after score-changing gameplay", () => {
  const hashableStates: HashableGameState[] = [];
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    recordHashableStateOnSerialize: (state) => hashableStates.push(state),
  }).load(createScoreHashDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "score-hash",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }
  for (let tick = 0; tick <= 3; tick += 1) {
    assert.equal(started.value.tick(createHeldShotInputFrame(tick)).ok, true, `tick ${tick}`);
  }
  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  assert.equal(hashableStates.length, 1);
  assert.equal(hashableStates[0]!.score, 100);

  const dump = assertDebugDumpOk(serializeDebugStateForTest(started.value));
  assert.equal(dump.stateHash, hashHashableGameState(hashableStates[0]!));
  assert.equal(dump.prngHash, hashHashablePrngState(hashableStates[0]!.prngState));
});

test("records collision candidates only after a successful core tick commit", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {}).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "collision-metrics",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  for (let tick = 0; tick <= 60; tick += 1) {
    assert.equal(started.value.tick(createEmptyInputFrame(tick)).ok, true, `tick ${tick}`);
  }
  const dump = assertDebugDumpOk(serializeDebugStateForTest(started.value));
  assert.equal(dump.tick, 61);
  assert.equal(dump.collisionCandidates, 1);
  assert.deepEqual(dump.entityCounts, {
    player: 1,
    enemy: 1,
    enemyBullet: 0,
    playerShot: 0,
  });
  if (dump.eventCounts === null) {
    assert.fail("expected measured event counts");
  }
  assert.equal(dump.eventCounts.entitySpawned, 1);
  assert.equal(dump.eventCounts.tickAdvanced, 1);

  assert.equal(started.value.tick(createEmptyInputFrame(61)).ok, true);
  const quietTickDump = assertDebugDumpOk(serializeDebugStateForTest(started.value));
  assert.equal(quietTickDump.tick, 62);
  assert.deepEqual(quietTickDump.eventCounts, {
    stageStarted: 0,
    tickAdvanced: 1,
    entitySpawned: 0,
    entityDestroyed: 0,
    playerHit: 0,
    playerShotsSpawnedBatch: 0,
    enemyBulletsSpawnedBatch: 0,
    scoreChanged: 0,
  });
});

test("returns a test-only result error when debug hash encoding fails", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    failHeadlessDebugStateSerialization: true,
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "hash-failure",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  assert.deepEqual(serializeDebugStateForTest(started.value), {
    ok: false,
    errors: [{
      code: "debugState.hashFailed",
      message: "headless debug state hash could not be encoded",
    }],
  });
});

test("returns the latched fatal error instead of serializing a corrupted committed state", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("core.test", {
    corruptCommittedPrngStateTicks: [0],
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "fatal-debug-state",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const failedTick = started.value.tick(createEmptyInputFrame(0));
  assert.equal(failedTick.ok, false);
  const debugResult = serializeDebugStateForTest(started.value);
  assert.equal(debugResult.ok, false);
  if (debugResult.ok) {
    assert.fail("expected latched fatal error");
  }
  assert.equal(debugResult.errors[0]?.code, "stageSession.fatal");
});

test("rejects debug serialization for a normal public session", () => {
  const loaded = createShootingCore("core.test").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "normal-session",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  assert.throws(
    () => serializeDebugStateForTest(started.value),
    /not registered for headless debug state serialization/,
  );
});

test("formats portable debug artifact paths and stable JSON", () => {
  const dump = createSampleDump();
  assert.equal(
    createHeadlessDebugStateArtifactPathForTest("replay-smoke.case_01", dump),
    "artifacts/debug-state/replay-smoke.case_01-tick-12.json",
  );
  const maximumLengthName = "a".repeat(128);
  assert.equal(
    createHeadlessDebugStateArtifactPathForTest(maximumLengthName, { ...dump, tick: 0 }),
    `artifacts/debug-state/${maximumLengthName}-tick-0.json`,
  );
  assert.equal(
    createHeadlessDebugStateArtifactPathForTest("maximum-tick", { ...dump, tick: Number.MAX_SAFE_INTEGER }),
    `artifacts/debug-state/maximum-tick-tick-${Number.MAX_SAFE_INTEGER}.json`,
  );
  for (const invalidName of [
    "",
    "a".repeat(129),
    "Upper",
    "has space",
    "../escape",
    "a/b",
    "a\\b",
    "a--b",
  ]) {
    assert.throws(
      () => createHeadlessDebugStateArtifactPathForTest(invalidName, dump),
      RangeError,
      invalidName,
    );
  }
  for (const invalidTick of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createHeadlessDebugStateArtifactPathForTest("valid", { ...dump, tick: invalidTick }),
      RangeError,
    );
  }

  const json = formatHeadlessDebugStateJsonForTest(dump);
  const reorderedDump: HeadlessDebugStateDump = {
    eventCounts: dump.eventCounts === null ? null : {
      scoreChanged: dump.eventCounts.scoreChanged,
      enemyBulletsSpawnedBatch: dump.eventCounts.enemyBulletsSpawnedBatch,
      playerShotsSpawnedBatch: dump.eventCounts.playerShotsSpawnedBatch,
      playerHit: dump.eventCounts.playerHit,
      entityDestroyed: dump.eventCounts.entityDestroyed,
      entitySpawned: dump.eventCounts.entitySpawned,
      tickAdvanced: dump.eventCounts.tickAdvanced,
      stageStarted: dump.eventCounts.stageStarted,
    },
    collisionCandidates: dump.collisionCandidates,
    entityCounts: {
      playerShot: dump.entityCounts.playerShot,
      enemyBullet: dump.entityCounts.enemyBullet,
      enemy: dump.entityCounts.enemy,
      player: dump.entityCounts.player,
    },
    prngHash: dump.prngHash,
    stateHash: dump.stateHash,
    seed: dump.seed,
    tick: dump.tick,
    kind: dump.kind,
    schemaVersion: dump.schemaVersion,
  };
  assert.equal(json.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(json), dump);
  assert.equal(formatHeadlessDebugStateJsonForTest(reorderedDump), json);
  assert.match(json, /^\{\n  "schemaVersion": "1",\n  "kind": "headless",/);
});

/** CoreResultをtestで扱いやすい成功値へ絞り、失敗時はdiagnosticを表示する。 */
function assertDebugDumpOk(result: HeadlessDebugStateResult): HeadlessDebugStateDump {
  if (!result.ok) {
    assert.fail(`expected debug dump: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

/** artifact helper単体test用の最小headless dumpを作る。 */
function createSampleDump(): HeadlessDebugStateDump {
  return {
    schemaVersion: "1",
    kind: "headless",
    tick: 12,
    seed: null,
    stateHash: "1111111111111111",
    prngHash: "2222222222222222",
    entityCounts: { player: 1, enemy: 2, enemyBullet: 3, playerShot: 4 },
    collisionCandidates: 5,
    eventCounts: {
      stageStarted: 0,
      tickAdvanced: 1,
      entitySpawned: 2,
      entityDestroyed: 3,
      playerHit: 0,
      playerShotsSpawnedBatch: 1,
      enemyBulletsSpawnedBatch: 2,
      scoreChanged: 3,
    },
  };
}

/** score変化後のhash配線を確認できるよう、shot軌道上へ敵を配置する。 */
function createScoreHashDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  const stage = definition.content.stages[0]!;
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...stage,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.none",
            position: { x: 192, y: 392 },
          },
        }],
      }],
    },
  };
}

/** fire intervalをまたいでshotを保持する正規InputFrameを作る。 */
function createHeldShotInputFrame(tick: number): InputFrame {
  return {
    tick,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot"],
    pressed: tick === 0 ? ["shot"] : [],
    released: [],
  };
}

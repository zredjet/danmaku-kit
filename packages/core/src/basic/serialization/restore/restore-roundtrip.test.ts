import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../../tests/fixtures/minimum-game-definition.ts";
import type { StageSession } from "../../api-types.ts";
import type { GameDefinition } from "../../content/types.ts";
import { createEmptyInputFrame } from "../../input/input-frame.ts";
import type { InputFrame } from "../../input/input-frame.ts";
import {
  createCollisionScoreDefinition,
  createFireOnSpawnAtZeroDefinition,
  createFutureTimelineAfterRestoreDefinition,
} from "../../test-support/definitions.ts";
import { createShotInputFrame } from "../../test-support/input-frames.ts";
import { enableInternalTestHooksForTestFile } from "../../test-support/internal-test-hooks.ts";
import {
  assertSerializeOk,
  assertTickOk,
  serializeInitialStageState,
  startStageFromLoadedGame,
} from "../../test-support/stage-harness.ts";
import { createDanmakuCoreWithTestingHooksForTest } from "../../testing/testing-hooks.ts";
import type { SerializedGameState } from "../types.ts";

enableInternalTestHooksForTestFile();

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

function loadGameWithRestoreCapture(
  definition: GameDefinition,
  capturedSnapshots: SerializedGameState[],
  coreVersion = "core.test",
) {
  const loaded = createDanmakuCoreWithTestingHooksForTest(coreVersion, {
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

function assertTickAndSerializeMatch(restored: StageSession, baseline: StageSession, input: InputFrame) {
  const restoredFrame = assertTickOk(restored.tick(input), `restored tick ${input.tick}`);
  const baselineFrame = assertTickOk(baseline.tick(input), `baseline tick ${input.tick}`);
  assert.deepEqual(restoredFrame, baselineFrame);
  const restoredSnapshot = assertSerializeOk(restored.serialize(), `restored serialize ${input.tick}`);
  const baselineSnapshot = assertSerializeOk(baseline.serialize(), `baseline serialize ${input.tick}`);
  assert.deepEqual(restoredSnapshot, baselineSnapshot);
  return baselineFrame;
}

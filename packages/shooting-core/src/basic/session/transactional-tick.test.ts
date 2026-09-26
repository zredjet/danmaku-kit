import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { GameDefinition } from "../content/types.ts";
import { createShootingCoreWithTestingHooksForInternalTest } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createFireOnSpawnAtZeroDefinition } from "../test-support/definitions.ts";
import { createPressedShotInputFrame, createShotInputFrame } from "../test-support/input-frames.ts";
import { enableInternalTestHooksForTestFile } from "../test-support/internal-test-hooks.ts";
import {
  startMinimumStage,
  startStageFromCoreAndDefinition,
  startStageFromDefinition,
  tickUnknown,
} from "../test-support/stage-harness.ts";
import { createShootingCoreWithTestingHooksForTest } from "../testing/testing-hooks.ts";

enableInternalTestHooksForTestFile();

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

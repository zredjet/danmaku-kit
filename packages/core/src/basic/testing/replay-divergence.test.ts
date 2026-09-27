import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { LoadedGame } from "../api-types.ts";
import type { GameDefinition } from "../content/types.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { createPressedShotInputFrame } from "../test-support/input-frames.ts";
import { enableInternalTestHooksForTestFile } from "../test-support/internal-test-hooks.ts";
import {
  compareReplayTracesForTest,
  createReplayDivergenceArtifactPathForTest,
  formatReplayDivergenceReportJsonForTest,
} from "./replay-divergence.ts";
import type { ReplayComparisonResult, ReplayDivergenceReport } from "./replay-divergence.ts";
import { recordReplayTraceForTest } from "./replay-trace.ts";
import type { ReplayTrace } from "./replay-trace.ts";
import { createDanmakuCoreWithTestingHooksForTest } from "./testing-hooks.ts";

enableInternalTestHooksForTestFile();

test("matches identical replay traces checkpoint by checkpoint", () => {
  const inputs = createInputs(6, { 2: createPressedShotInputFrame(2) });
  const result = compareReplayTracesForTest(
    "identical",
    recordTrace(loadGame(), inputs),
    recordTrace(loadGame(), inputs),
  );

  assert.deepEqual(result, { kind: "match", checkpointCount: 7, warnings: [] });
});

test("reports the first divergent checkpoint with input, entity, component, and event diffs", () => {
  const report = assertDivergence(compareReplayTracesForTest(
    "shot-divergence",
    recordTrace(loadGame(), createInputs(5)),
    recordTrace(loadGame(), createInputs(5, { 2: createPressedShotInputFrame(2) })),
  ));

  assert.equal(report.artifactName, "shot-divergence-tick-3");
  assert.equal(report.firstDivergentFrameTick, 2);
  assert.equal(report.firstDivergentCheckpointTick, 3);
  assert.equal(report.expected.status, "ok");
  assert.equal(report.actual.status, "ok");
  if (report.expected.status !== "ok" || report.actual.status !== "ok") {
    assert.fail("expected both sides to be ok");
  }
  assert.notEqual(report.expected.stateHash, report.actual.stateHash);
  assert.equal(report.expected.summary.tick, 3);
  assert.equal(report.actual.summary.entityCounts.playerShot, 1);
  assert.deepEqual(report.inputDiff, [
    { path: "inputFrame.pressed[0]", expected: { kind: "missing" }, actual: "shot" },
  ]);
  assert.deepEqual(report.entityDiff.map((item) => [item.path, item.entityId, item.expected]), [
    ["state.runtimeEntities[id=2]", 2, { kind: "missing" }],
  ]);
  assert.deepEqual(
    report.componentDiff.map((item) => [item.path, item.entityId, item.component]),
    [
      ["state.runtimeEntities[id=1].nextShotAllowedTick", 1, "nextShotAllowedTick"],
      ["state.nextEntityId", undefined, "nextEntityId"],
    ],
  );
  assert.deepEqual(report.eventDiff.at(-1), {
    path: "events[1]",
    expected: { kind: "missing" },
    actual: { type: "tickAdvanced", tick: 2 },
  });
  assert.equal(report.prngStateDiff, null);
});

test("detects event-only divergence even when state hashes match", () => {
  const expected = recordTrace(loadGame(), createInputs(3));
  const actual = replaceCheckpointEvents(expected, 2, (events) => [...events, { type: "tickAdvanced", tick: 1 }]);
  const report = assertDivergence(compareReplayTracesForTest("event-only", expected, actual));

  assert.equal(report.firstDivergentCheckpointTick, 2);
  if (report.expected.status !== "ok" || report.actual.status !== "ok") {
    assert.fail("expected both sides to be ok");
  }
  assert.equal(report.expected.stateHash, report.actual.stateHash);
  assert.deepEqual(report.entityDiff, []);
  assert.deepEqual(report.componentDiff, []);
  assert.equal(report.prngStateDiff, null);
  assert.deepEqual(report.eventDiff, [
    { path: "events[1]", expected: { kind: "missing" }, actual: { type: "tickAdvanced", tick: 1 } },
  ]);
});

test("reports a missing side when one replay ends early", () => {
  const expected = recordTrace(loadGame(), createInputs(4));
  const report = assertDivergence(compareReplayTracesForTest("early-end", expected, recordTrace(loadGame(), createInputs(2))));

  assert.equal(report.firstDivergentFrameTick, 2);
  assert.equal(report.firstDivergentCheckpointTick, 3);
  assert.deepEqual(report.actual, { status: "missing", inputFrame: null });
  const expectedCheckpoint = expected.checkpoints[3]!;
  if (expectedCheckpoint.status !== "ok") {
    assert.fail("expected checkpoint 3 to be recorded");
  }
  assert.deepEqual(report.inputDiff, [
    { path: "inputFrame", expected: createEmptyInputFrame(2), actual: { kind: "missing" } },
  ]);
  assert.deepEqual(report.componentDiff, [
    { path: "stateHash", expected: expectedCheckpoint.stateHash, actual: { kind: "missing" } },
  ]);
  assert.deepEqual(report.eventDiff, [
    { path: "events", expected: expectedCheckpoint.events, actual: { kind: "missing" } },
  ]);
  assert.deepEqual(report.entityDiff, []);
  assert.equal(report.prngStateDiff, null);
  assert.equal(createReplayDivergenceArtifactPathForTest(report), "artifacts/replay-divergence/early-end-tick-3.json");
});

test("reports an error side when only one replay tick fails and stops recording it", () => {
  const inputs = createInputs(4);
  const actualTrace = recordTrace(loadGame(), inputs.map((input, index) => (index === 2 ? { ...input, tick: 7 } : input)));
  assert.equal(actualTrace.checkpoints.length, 4);
  assert.equal(actualTrace.checkpoints.at(-1)?.status, "error");

  const report = assertDivergence(compareReplayTracesForTest("tick-error", recordTrace(loadGame(), inputs), actualTrace));

  assert.equal(report.firstDivergentCheckpointTick, 3);
  assert.equal(report.actual.status, "error");
  if (report.actual.status !== "error") {
    assert.fail("expected the actual side to be an error");
  }
  assert.equal(report.actual.errors[0]?.code, "input.tickMismatch");
  assert.deepEqual(report.inputDiff, [{ path: "inputFrame.tick", expected: 2, actual: 7 }]);
  assert.deepEqual(report.componentDiff.map((item) => [item.path, item.actual]), [
    ["stateHash", { kind: "error", codes: ["input.tickMismatch"] }],
  ]);
});

test("reports initial checkpoint divergence before any frame", () => {
  const changedDefinition = createMinimumDefinition();
  const actualDefinition: GameDefinition = {
    ...changedDefinition,
    content: {
      ...changedDefinition.content,
      players: changedDefinition.content.players.map((player) => ({
        ...player,
        movement: { ...player.movement, speed: 3 },
      })),
    },
  };
  const report = assertDivergence(compareReplayTracesForTest(
    "initial-state",
    recordTrace(loadGame(), createInputs(2)),
    recordTrace(loadGame(actualDefinition), createInputs(2)),
  ));

  assert.equal(report.firstDivergentFrameTick, null);
  assert.equal(report.firstDivergentCheckpointTick, 0);
  assert.equal(report.expected.inputFrame, null);
  assert.deepEqual(report.inputDiff, []);
  assert.deepEqual(report.componentDiff, [{
    path: "state.runtimeEntities[id=1].movement.speed",
    expected: 4,
    actual: 3,
    entityId: 1,
    component: "movement",
  }]);
  assert.deepEqual(report.eventDiff, []);
});

test("compares same-major core versions with a warning and rejects incompatible replays", () => {
  const trace = recordTrace(loadGame(), createInputs(2));
  const withMetadata = (overrides: Record<string, unknown>): ReplayTrace => ({
    ...trace,
    metadata: { ...trace.metadata, ...overrides } as ReplayTrace["metadata"],
  });

  const sameMajor = compareReplayTracesForTest("core-minor", trace, withMetadata({ coreVersion: "1.2.0" }));
  assert.equal(sameMajor.kind, "match");
  assert.deepEqual(
    sameMajor.kind === "match" ? sameMajor.warnings.map((warning) => [warning.code, warning.field]) : [],
    [["replay.coreVersionMismatch", "coreVersion"]],
  );

  for (const [overrides, field] of [
    [{ coreVersion: "2.0.0" }, "coreVersion"],
    [{ seed: "other-seed" }, "seed"],
    [{ contentVersion: "shooting-sample@content.1" }, "contentVersion"],
    [{ difficulty: "hard" }, "difficulty"],
  ] as const) {
    const result = compareReplayTracesForTest("incompatible", trace, withMetadata(overrides));
    assert.equal(result.kind, "incompatible", field);
    assert.deepEqual(
      result.kind === "incompatible" ? result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.field]) : [],
      [["replay.incompatible", field]],
    );
  }
});

test("rejects non-canonical metadata and malformed traces before comparing", () => {
  const trace = recordTrace(loadGame(), createInputs(2));
  const nonCanonical = compareReplayTracesForTest("invalid", trace, {
    ...trace,
    metadata: { ...trace.metadata, enabledFeatures: ["rank", "bomb"] },
  });
  assert.deepEqual(
    nonCanonical.kind === "invalid"
      ? nonCanonical.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.side, diagnostic.field])
      : nonCanonical.kind,
    [["replay.metadataInvalid", "actual", "enabledFeatures"]],
  );

  const gapped = compareReplayTracesForTest("invalid", trace, {
    ...trace,
    checkpoints: [trace.checkpoints[0]!, trace.checkpoints[2]!],
  });
  assert.equal(gapped.kind, "invalid");
  assert.equal(
    gapped.kind === "invalid" && gapped.diagnostics.every((diagnostic) => diagnostic.code === "replay.traceInvalid"),
    true,
  );
  assert.throws(() => compareReplayTracesForTest("../escape", trace, trace), RangeError);
});

test("formats replay divergence reports as stable JSON artifacts", () => {
  const report = assertDivergence(compareReplayTracesForTest(
    "stable-json",
    recordTrace(loadGame(), createInputs(3)),
    recordTrace(loadGame(), createInputs(3, { 1: createPressedShotInputFrame(1) })),
  ));
  const json = formatReplayDivergenceReportJsonForTest(report);
  const reordered: ReplayDivergenceReport = {
    prngStateDiff: report.prngStateDiff,
    eventDiff: report.eventDiff,
    componentDiff: report.componentDiff,
    entityDiff: report.entityDiff,
    inputDiff: report.inputDiff,
    actual: report.actual,
    expected: report.expected,
    actualMetadata: report.actualMetadata,
    expectedMetadata: report.expectedMetadata,
    firstDivergentCheckpointTick: report.firstDivergentCheckpointTick,
    firstDivergentFrameTick: report.firstDivergentFrameTick,
    replayId: report.replayId,
    artifactName: report.artifactName,
    schemaVersion: report.schemaVersion,
  };

  assert.equal(json.endsWith("}\n"), true);
  assert.equal(formatReplayDivergenceReportJsonForTest(reordered), json);
  assert.match(json, /^\{\n  "schemaVersion": "1",\n  "artifactName": "stable-json-tick-2",/);
  assert.deepEqual(JSON.parse(json).expectedMetadata, {
    coreVersion: "1.0.0",
    schemaVersion: "1",
    contentVersion: "shooting-sample@content.0",
    inputFormatVersion: "1",
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.default",
    enabledFeatures: [],
    seed: "replay-seed",
  });
  assert.equal(createReplayDivergenceArtifactPathForTest(report), "artifacts/replay-divergence/stable-json-tick-2.json");
});

/** replay trace 比較に使う SemVer version の hook-enabled game を load する。 */
function loadGame(definition: GameDefinition = createMinimumDefinition()): LoadedGame {
  const loaded = createDanmakuCoreWithTestingHooksForTest("1.0.0", {}).load(definition);
  if (!loaded.ok) {
    assert.fail(`expected loaded game: ${JSON.stringify(loaded.errors)}`);
  }
  return loaded.value;
}

function recordTrace(loaded: LoadedGame, inputs: readonly unknown[]): ReplayTrace {
  const recorded = recordReplayTraceForTest(
    loaded,
    { stageId: "stage.stage_01", difficulty: "normal", seed: "replay-seed" },
    inputs,
  );
  if (!recorded.ok) {
    assert.fail(`expected replay trace: ${JSON.stringify(recorded.errors)}`);
  }
  return recorded.value;
}

/** 0 から始まる空入力列を作り、指定 tick だけ差し替える。 */
function createInputs(count: number, overrides: Readonly<Record<number, InputFrame>> = {}): InputFrame[] {
  return Array.from({ length: count }, (_, tick) => overrides[tick] ?? createEmptyInputFrame(tick));
}

/** trace を複製し、指定 checkpoint の frame event だけを置き換える。 */
function replaceCheckpointEvents(
  trace: ReplayTrace,
  checkpointTick: number,
  replace: (events: readonly unknown[]) => readonly unknown[],
): ReplayTrace {
  return {
    ...trace,
    checkpoints: trace.checkpoints.map((checkpoint) => (
      checkpoint.checkpointTick === checkpointTick && checkpoint.status === "ok"
        ? { ...checkpoint, events: replace(checkpoint.events) as typeof checkpoint.events }
        : checkpoint
    )),
  };
}

function assertDivergence(result: ReplayComparisonResult): ReplayDivergenceReport {
  if (result.kind !== "divergence") {
    assert.fail(`expected replay divergence, got ${JSON.stringify(result)}`);
  }
  return result.report;
}

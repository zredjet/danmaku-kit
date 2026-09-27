import { assertArtifactName, createTickArtifactPath } from "./artifact-path.ts";
import { projectHeadlessDebugStateForStableJson } from "./debug-state.ts";
import { diffReplayCheckpoint, isSameReplayCheckpoint } from "./replay-diff.ts";
import type { ReplayCheckpointDiff, ReplayDiffItem } from "./replay-diff.ts";
import {
  compareReplayCompatibility,
  toReplayCompatibilitySnapshot,
  validateReplayMetadataForComparison,
} from "./replay-metadata.ts";
import type { ReplayComparisonDiagnostic, ReplayCompatibilitySnapshot } from "./replay-metadata.ts";
import type { ReplayDivergenceSide, ReplayTrace, ReplayTraceCheckpoint } from "./replay-trace.ts";

const MISSING_SIDE: ReplayDivergenceSide = Object.freeze({ status: "missing", inputFrame: null });

/** first divergent checkpoint を field 単位で調べる CI artifact。 */
export type ReplayDivergenceReport = Readonly<{
  schemaVersion: "1";
  artifactName: string;
  replayId: string;
  firstDivergentFrameTick: number | null;
  firstDivergentCheckpointTick: number;
  expectedMetadata: ReplayCompatibilitySnapshot;
  actualMetadata: ReplayCompatibilitySnapshot;
  expected: ReplayDivergenceSide;
  actual: ReplayDivergenceSide;
}> & ReplayCheckpointDiff;

/**
 * 2つの replay trace の比較結果。
 *
 * `invalid` は metadata / trace の形が比較の前提を満たさない、`incompatible` は別 replay として比較できない
 * ことを表し、どちらも state divergence report を作らない。
 */
export type ReplayComparisonResult =
  | Readonly<{ kind: "match"; checkpointCount: number; warnings: readonly ReplayComparisonDiagnostic[] }>
  | Readonly<{ kind: "divergence"; report: ReplayDivergenceReport; warnings: readonly ReplayComparisonDiagnostic[] }>
  | Readonly<{ kind: "incompatible"; diagnostics: readonly ReplayComparisonDiagnostic[] }>
  | Readonly<{ kind: "invalid"; diagnostics: readonly ReplayComparisonDiagnostic[] }>;

/**
 * expected / actual の replay trace を checkpoint 順に比べ、最初に異なる checkpoint の report を返す。
 *
 * 比較前に両 metadata を検証して互換性を確認し、入力も side ごとに比べる。片側だけ replay が終わった
 * checkpoint は `missing` side、片側だけ tick が失敗した checkpoint は `error` side として report にする。
 */
export function compareReplayTracesForTest(
  replayId: string,
  expected: ReplayTrace,
  actual: ReplayTrace,
): ReplayComparisonResult {
  assertArtifactName(replayId, "replayId");
  const expectedMetadata = validateReplayMetadataForComparison(expected.metadata, "expected");
  const actualMetadata = validateReplayMetadataForComparison(actual.metadata, "actual");
  const invalid = [
    ...(expectedMetadata.ok ? [] : expectedMetadata.diagnostics),
    ...(actualMetadata.ok ? [] : actualMetadata.diagnostics),
    ...validateTraceCheckpoints(expected, "expected"),
    ...validateTraceCheckpoints(actual, "actual"),
  ];
  if (!expectedMetadata.ok || !actualMetadata.ok || invalid.length > 0) {
    return Object.freeze({ kind: "invalid", diagnostics: Object.freeze(invalid) });
  }
  const compatibility = compareReplayCompatibility(expectedMetadata.value, actualMetadata.value);
  if (compatibility.errors.length > 0) {
    return Object.freeze({ kind: "incompatible", diagnostics: compatibility.errors });
  }

  const checkpointCount = Math.max(expected.checkpoints.length, actual.checkpoints.length);
  for (let checkpointTick = 0; checkpointTick < checkpointCount; checkpointTick += 1) {
    const expectedSide = toSide(expected.checkpoints[checkpointTick]);
    const actualSide = toSide(actual.checkpoints[checkpointTick]);
    if (isSameReplayCheckpoint(expectedSide, actualSide)) {
      continue;
    }
    return Object.freeze({
      kind: "divergence",
      report: Object.freeze({
        schemaVersion: "1",
        artifactName: `${replayId}-tick-${checkpointTick}`,
        replayId,
        firstDivergentFrameTick: checkpointTick === 0 ? null : checkpointTick - 1,
        firstDivergentCheckpointTick: checkpointTick,
        expectedMetadata: toReplayCompatibilitySnapshot(expectedMetadata.value),
        actualMetadata: toReplayCompatibilitySnapshot(actualMetadata.value),
        expected: expectedSide,
        actual: actualSide,
        ...diffReplayCheckpoint(expectedSide, actualSide),
      }),
      warnings: compatibility.warnings,
    });
  }
  return Object.freeze({ kind: "match", checkpointCount, warnings: compatibility.warnings });
}

/** artifact path の tick は frame tick ではなく first divergent checkpoint tick に固定する。 */
export function createReplayDivergenceArtifactPathForTest(report: ReplayDivergenceReport): string {
  return createTickArtifactPath({
    directory: "artifacts/replay-divergence",
    name: report.replayId,
    nameLabel: "replayId",
    tick: report.firstDivergentCheckpointTick,
    tickLabel: "replay divergence checkpoint tick",
  });
}

/** report を schema 固定順、2-space indent、末尾 LF の JSON artifact にする。 */
export function formatReplayDivergenceReportJsonForTest(report: ReplayDivergenceReport): string {
  return `${JSON.stringify(projectReportForStableJson(report), null, 2)}\n`;
}

/** trace の checkpoint が tick 順に連続し、`ok` の state / summary が同じ checkpoint を指すことを確認する。 */
function validateTraceCheckpoints(trace: ReplayTrace, side: "expected" | "actual"): ReplayComparisonDiagnostic[] {
  const diagnostics: ReplayComparisonDiagnostic[] = [];
  const invalid = (message: string) => {
    diagnostics.push(Object.freeze({ code: "replay.traceInvalid", severity: "error", side, field: "checkpoints", message }));
  };
  if (trace.checkpoints.length === 0) {
    invalid("replay trace must contain the initial checkpoint");
  }
  trace.checkpoints.forEach((checkpoint, index) => {
    const expectedFrameTick = index === 0 ? null : index - 1;
    if (checkpoint.checkpointTick !== index || checkpoint.frameTick !== expectedFrameTick) {
      invalid(`checkpoint ${index} must have checkpointTick ${index} and frameTick ${String(expectedFrameTick)}`);
    }
    if (index === 0 && checkpoint.inputFrame !== null) {
      invalid("the initial checkpoint must not have an input frame");
    }
    if (checkpoint.status === "ok" && (checkpoint.state.expectedTick !== index || checkpoint.summary.tick !== index)) {
      invalid(`checkpoint ${index} state and summary must describe the post-tick checkpoint ${index}`);
    }
    if (checkpoint.status === "error" && index !== trace.checkpoints.length - 1) {
      invalid(`error checkpoint ${index} must be the last checkpoint`);
    }
  });
  return diagnostics;
}

/** trace の checkpoint から tick 情報を外した side。範囲外は replay 終了済みの `missing`。 */
function toSide(checkpoint: ReplayTraceCheckpoint | undefined): ReplayDivergenceSide {
  if (!checkpoint) {
    return MISSING_SIDE;
  }
  if (checkpoint.status === "error") {
    return Object.freeze({ status: "error", inputFrame: checkpoint.inputFrame, errors: checkpoint.errors });
  }
  return Object.freeze({
    status: "ok",
    inputFrame: checkpoint.inputFrame,
    stateHash: checkpoint.stateHash,
    summary: checkpoint.summary,
    state: checkpoint.state,
    events: checkpoint.events,
  });
}

/** caller 側の property 挿入順に依存しないよう、report / side / diff item を schema 順に投影する。 */
function projectReportForStableJson(report: ReplayDivergenceReport): ReplayDivergenceReport {
  return {
    schemaVersion: report.schemaVersion,
    artifactName: report.artifactName,
    replayId: report.replayId,
    firstDivergentFrameTick: report.firstDivergentFrameTick,
    firstDivergentCheckpointTick: report.firstDivergentCheckpointTick,
    expectedMetadata: toReplayCompatibilitySnapshotForJson(report.expectedMetadata),
    actualMetadata: toReplayCompatibilitySnapshotForJson(report.actualMetadata),
    expected: projectSideForStableJson(report.expected),
    actual: projectSideForStableJson(report.actual),
    inputDiff: report.inputDiff.map(projectDiffItemForStableJson),
    entityDiff: report.entityDiff.map(projectDiffItemForStableJson),
    componentDiff: report.componentDiff.map(projectDiffItemForStableJson),
    eventDiff: report.eventDiff.map(projectDiffItemForStableJson),
    prngStateDiff: report.prngStateDiff === null ? null : projectDiffItemForStableJson(report.prngStateDiff),
  };
}

function toReplayCompatibilitySnapshotForJson(metadata: ReplayCompatibilitySnapshot): ReplayCompatibilitySnapshot {
  return {
    coreVersion: metadata.coreVersion,
    schemaVersion: metadata.schemaVersion,
    contentVersion: metadata.contentVersion,
    inputFormatVersion: metadata.inputFormatVersion,
    stageId: metadata.stageId,
    difficulty: metadata.difficulty,
    playerId: metadata.playerId,
    enabledFeatures: metadata.enabledFeatures,
    seed: metadata.seed,
  };
}

function projectSideForStableJson(side: ReplayDivergenceSide): ReplayDivergenceSide {
  if (side.status === "missing") {
    return { status: side.status, inputFrame: side.inputFrame };
  }
  if (side.status === "error") {
    return { status: side.status, inputFrame: side.inputFrame, errors: side.errors };
  }
  return {
    status: side.status,
    inputFrame: side.inputFrame,
    stateHash: side.stateHash,
    summary: projectHeadlessDebugStateForStableJson(side.summary),
    state: side.state,
    events: side.events,
  };
}

function projectDiffItemForStableJson(item: ReplayDiffItem): ReplayDiffItem {
  return {
    path: item.path,
    expected: item.expected,
    actual: item.actual,
    ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
    ...(item.component === undefined ? {} : { component: item.component }),
  };
}

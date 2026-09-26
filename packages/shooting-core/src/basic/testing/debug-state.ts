import type { StageSession } from "../api-types.ts";
import type { HashableGameState } from "../hash/hashable-state.ts";
import { hashHashableGameState, hashHashablePrngState } from "../hash/state-hash.ts";
import type {
  HeadlessDebugCheckpoint,
  HeadlessDebugStateDump,
  HeadlessDebugStateError,
  HeadlessDebugStateResult,
  HeadlessDebugStateSerializer,
} from "../instrumentation/debug-state.ts";
import { assertInternalTestHooksEnabled } from "../instrumentation/test-hooks-guard.ts";
import { okResult } from "../result.ts";
import type { CoreWarning } from "../result.ts";
import { createTickArtifactPath } from "./artifact-path.ts";

/** committed checkpoint の hash DTO と、同じ checkpoint の headless summary dump。 */
export type HeadlessDebugCapture = Readonly<{
  state: HashableGameState;
  dump: HeadlessDebugStateDump;
}>;

/** `HeadlessDebugStateResult` と同じ error 分類で capture を返す結果型。 */
export type HeadlessDebugCaptureResult =
  | Readonly<{
    ok: true;
    value: HeadlessDebugCapture;
    warnings: readonly CoreWarning[];
  }>
  | Readonly<{
    ok: false;
    errors: readonly HeadlessDebugStateError[];
  }>;

const debugStateSerializers = new WeakMap<StageSession, HeadlessDebugStateSerializer>();

/** hook-enabled session と内部 dump serializer を test process 内だけで対応付ける。 */
export function registerHeadlessDebugStateSerializerForTest(
  session: StageSession,
  serializer: HeadlessDebugStateSerializer,
): void {
  debugStateSerializers.set(session, serializer);
}

/** hook-enabled session の committed state を進めずに headless dump を返す。 */
export function serializeDebugStateForTest(session: StageSession): HeadlessDebugStateResult {
  const captured = captureHeadlessDebugStateForTest(session);
  return captured.ok ? okResult(captured.value.dump) : captured;
}

/**
 * hook-enabled session の committed hash DTO と headless dump を、session を進めずに同時に取得する。
 *
 * replay divergence 調査が state hash と field-level diff を同じ checkpoint から作れるようにする。
 */
export function captureHeadlessDebugStateForTest(session: StageSession): HeadlessDebugCaptureResult {
  assertInternalTestHooksEnabled("serialize debug state");
  const serializer = debugStateSerializers.get(session);
  if (!serializer) {
    throw new Error("StageSession is not registered for headless debug state serialization");
  }
  const checkpoint = serializer();
  if (!checkpoint.ok) {
    return checkpoint;
  }
  const dump = hashHeadlessDebugCheckpoint(checkpoint.value);
  if (!dump.ok) {
    return dump;
  }
  return okResult(Object.freeze({ state: checkpoint.value.hashableState, dump: dump.value }));
}

/** checkpoint の hash DTO から state / PRNG digest を計算し、schema 固定の headless dump にする。 */
function hashHeadlessDebugCheckpoint(checkpoint: HeadlessDebugCheckpoint): HeadlessDebugStateResult {
  let stateHash: string;
  let prngHash: string;
  try {
    if (checkpoint.forceHashFailure) {
      throw new Error("injected headless debug state hash failure");
    }
    stateHash = hashHashableGameState(checkpoint.hashableState);
    prngHash = hashHashablePrngState(checkpoint.hashableState.prngState);
  } catch {
    return createHeadlessDebugStateHashError();
  }
  return okResult(Object.freeze({
    schemaVersion: "1",
    kind: "headless",
    tick: checkpoint.hashableState.expectedTick,
    seed: checkpoint.seed,
    stateHash,
    prngHash,
    entityCounts: checkpoint.entityCounts,
    collisionCandidates: checkpoint.metrics?.collisionCandidates ?? null,
    eventCounts: checkpoint.metrics?.eventCounts ?? null,
  }));
}

/** test-only hash failure を public CoreErrorCode へ漏らさず immutable result にする。 */
function createHeadlessDebugStateHashError(): HeadlessDebugStateResult {
  return Object.freeze({
    ok: false,
    errors: Object.freeze([
      Object.freeze({
        code: "debugState.hashFailed" as const,
        message: "headless debug state hash could not be encoded",
      }),
    ]),
  });
}

/** portable slug と checkpoint tick から repository-relative artifact path を作る。 */
export function createHeadlessDebugStateArtifactPathForTest(
  testName: string,
  dump: HeadlessDebugStateDump,
): string {
  return createTickArtifactPath({
    directory: "artifacts/debug-state",
    name: testName,
    nameLabel: "testName",
    tick: dump.tick,
    tickLabel: "debug state tick",
  });
}

/** headless dump を2-space indentと末尾LFを持つ安定したJSON artifactへ変換する。 */
export function formatHeadlessDebugStateJsonForTest(dump: HeadlessDebugStateDump): string {
  return `${JSON.stringify(projectHeadlessDebugStateForStableJson(dump), null, 2)}\n`;
}

/** caller 側の property 挿入順に依存しない schema 固定順の JSON DTO へ投影する。 */
export function projectHeadlessDebugStateForStableJson(dump: HeadlessDebugStateDump): HeadlessDebugStateDump {
  return {
    schemaVersion: dump.schemaVersion,
    kind: dump.kind,
    tick: dump.tick,
    seed: dump.seed,
    stateHash: dump.stateHash,
    prngHash: dump.prngHash,
    entityCounts: {
      player: dump.entityCounts.player,
      enemy: dump.entityCounts.enemy,
      enemyBullet: dump.entityCounts.enemyBullet,
      playerShot: dump.entityCounts.playerShot,
    },
    collisionCandidates: dump.collisionCandidates,
    eventCounts: dump.eventCounts === null ? null : {
      stageStarted: dump.eventCounts.stageStarted,
      tickAdvanced: dump.eventCounts.tickAdvanced,
      entitySpawned: dump.eventCounts.entitySpawned,
      entityDestroyed: dump.eventCounts.entityDestroyed,
      playerHit: dump.eventCounts.playerHit,
      playerShotsSpawnedBatch: dump.eventCounts.playerShotsSpawnedBatch,
      enemyBulletsSpawnedBatch: dump.eventCounts.enemyBulletsSpawnedBatch,
      scoreChanged: dump.eventCounts.scoreChanged,
    },
  };
}

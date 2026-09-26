import type { StageSession } from "../api-types.ts";
import type {
  HeadlessDebugStateDump,
  HeadlessDebugStateResult,
  HeadlessDebugStateSerializer,
} from "../internal/debug-state.ts";
import { assertInternalTestHooksEnabled } from "../internal/test-hooks-guard.ts";
const MAX_ARTIFACT_TEST_NAME_LENGTH = 128;
const ARTIFACT_TEST_NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
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
  assertInternalTestHooksEnabled("serialize debug state");
  const serializer = debugStateSerializers.get(session);
  if (!serializer) {
    throw new Error("StageSession is not registered for headless debug state serialization");
  }
  return serializer();
}

/** portable slug と checkpoint tick から repository-relative artifact path を作る。 */
export function createHeadlessDebugStateArtifactPathForTest(
  testName: string,
  dump: HeadlessDebugStateDump,
): string {
  if (
    testName.length === 0
    || testName.length > MAX_ARTIFACT_TEST_NAME_LENGTH
    || !ARTIFACT_TEST_NAME_PATTERN.test(testName)
  ) {
    throw new RangeError(
      `testName must be a lower-case artifact slug up to ${MAX_ARTIFACT_TEST_NAME_LENGTH} characters`,
    );
  }
  if (!Number.isSafeInteger(dump.tick) || dump.tick < 0) {
    throw new RangeError("debug state tick must be a non-negative safe integer");
  }
  return `artifacts/debug-state/${testName}-tick-${dump.tick}.json`;
}

/** headless dump を2-space indentと末尾LFを持つ安定したJSON artifactへ変換する。 */
export function formatHeadlessDebugStateJsonForTest(dump: HeadlessDebugStateDump): string {
  return `${JSON.stringify(projectHeadlessDebugStateForStableJson(dump), null, 2)}\n`;
}

/** caller 側の property 挿入順に依存しない schema 固定順の JSON DTO へ投影する。 */
function projectHeadlessDebugStateForStableJson(dump: HeadlessDebugStateDump): HeadlessDebugStateDump {
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

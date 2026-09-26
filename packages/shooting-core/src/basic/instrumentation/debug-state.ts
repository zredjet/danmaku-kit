import type { StageSession } from "../api-types.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import type { GameEvent } from "../events/game-event.ts";
import type { HashableGameState } from "../hash/hashable-state.ts";
import { errorResult, okResult } from "../result.ts";
import type { CoreError, CoreResult, CoreWarning } from "../result.ts";
import type { StageSessionSerializationMetadata } from "../serialization/metadata.ts";
import type { CommittedStageState } from "../state/committed-state.ts";
import { createHashableGameState } from "../state/hashable-projection.ts";

/** headless dump が固定する runtime entity kind ごとの件数。 */
export type HeadlessDebugEntityCounts = Readonly<Record<RuntimeEntityState["kind"], number>>;

/** 直前の成功 tick で frame に出した gameplay event type ごとの件数。 */
export type HeadlessDebugEventCounts = Readonly<Record<GameEvent["type"], number>>;

/**
 * state hash と同じ committed checkpoint を調査する test-only headless dump。
 *
 * tick metrics は restore 直後には復元できないため、未計測を実測ゼロと混同しないよう
 * `collisionCandidates` と `eventCounts` を `null` にする。
 */
export type HeadlessDebugStateDump = Readonly<{
  schemaVersion: "1";
  kind: "headless";
  tick: number;
  seed: string | null;
  stateHash: string;
  prngHash: string;
  entityCounts: HeadlessDebugEntityCounts;
  collisionCandidates: number | null;
  eventCounts: HeadlessDebugEventCounts | null;
}>;

/** 成功時にだけ更新する process-local な直前 tick の調査 metrics。 */
export type HeadlessDebugTickMetrics = Readonly<{
  collisionCandidates: number;
  eventCounts: HeadlessDebugEventCounts;
}>;

/** public CoreErrorCode を増やさずに test-only hash failure を表す内部 error。 */
export type HeadlessDebugStateError = CoreError | Readonly<{
  code: "debugState.hashFailed";
  message: string;
}>;

/** public CoreResult と同じ shape を保ちながら内部 error code だけを拡張した結果型。 */
export type HeadlessDebugStateResult =
  | Readonly<{
    ok: true;
    value: HeadlessDebugStateDump;
    warnings: readonly CoreWarning[];
  }>
  | Readonly<{
    ok: false;
    errors: readonly HeadlessDebugStateError[];
  }>;

/**
 * session から test helper へ渡す、digest 計算前の headless checkpoint。
 *
 * hash encoder / digest は test helper 側で計算し、通常 session の runtime module graph へ含めない。
 */
export type HeadlessDebugCheckpoint = Readonly<{
  hashableState: HashableGameState;
  seed: string | null;
  entityCounts: HeadlessDebugEntityCounts;
  metrics: HeadlessDebugTickMetrics | null;
  forceHashFailure: boolean;
}>;

/** session 内部の committed state を進めずに digest 計算前の checkpoint を返す関数。 */
export type HeadlessDebugStateSerializer = () => CoreResult<HeadlessDebugCheckpoint>;

/** test helper が session と内部 serializer を対応付ける callback。 */
export type RegisterHeadlessDebugStateSerializer = (
  session: StageSession,
  serializer: HeadlessDebugStateSerializer,
) => void;

/** committed state と process-local metrics から、digest 計算前の test-only checkpoint を作る。 */
export function createHeadlessDebugCheckpoint(
  metadata: StageSessionSerializationMetadata,
  committedState: CommittedStageState,
  seed: string | null,
  metrics: HeadlessDebugTickMetrics | null,
  forceHashFailure: boolean,
): CoreResult<HeadlessDebugCheckpoint> {
  const hashableState = createHashableGameState(metadata, committedState);
  if (!hashableState.ok) {
    return errorResult(hashableState.errors);
  }
  return okResult(Object.freeze({
    hashableState: hashableState.value,
    seed,
    entityCounts: countHeadlessDebugEntities(committedState.activeEntities),
    metrics,
    forceHashFailure,
  }));
}

/** committed entity を固定 kind ごとの件数へ集計する。 */
function countHeadlessDebugEntities(entities: readonly RuntimeEntityState[]): HeadlessDebugEntityCounts {
  const counts: Record<RuntimeEntityState["kind"], number> = {
    player: 0,
    enemy: 0,
    enemyBullet: 0,
    playerShot: 0,
  };
  for (const entity of entities) {
    counts[entity.kind] += 1;
  }
  return Object.freeze(counts);
}

/** 成功 tick に付随する非deterministic debug metrics を immutable snapshot にする。 */
export function createHeadlessDebugTickMetrics(
  collisionCandidates: number,
  events: readonly Readonly<{ type: GameEvent["type"] }>[],
): HeadlessDebugTickMetrics {
  return Object.freeze({
    collisionCandidates,
    eventCounts: countHeadlessDebugEvents(events),
  });
}

/** frame event を固定 type ごとの件数へ集計し、次の成功 commit まで保持する。 */
function countHeadlessDebugEvents(
  events: readonly Readonly<{ type: GameEvent["type"] }>[],
): HeadlessDebugEventCounts {
  const counts: Record<GameEvent["type"], number> = {
    stageStarted: 0,
    tickAdvanced: 0,
    entitySpawned: 0,
    entityDestroyed: 0,
    playerHit: 0,
    playerShotsSpawnedBatch: 0,
    enemyBulletsSpawnedBatch: 0,
    scoreChanged: 0,
  };
  for (const event of events) {
    counts[event.type] += 1;
  }
  return Object.freeze(counts);
}

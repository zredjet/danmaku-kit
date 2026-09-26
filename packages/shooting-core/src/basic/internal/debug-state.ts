import type { GameEvent } from "../events/game-event.ts";
import type { CoreError, CoreWarning } from "../result.ts";
import type { RuntimeEntityState } from "../simulation/runtime-entity.ts";
import type { StageSession } from "../core.ts";

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

/** session 内部の committed state を進めずに headless dump へ変換する関数。 */
export type HeadlessDebugStateSerializer = () => HeadlessDebugStateResult;

/** test helper が session と内部 serializer を対応付ける callback。 */
export type RegisterHeadlessDebugStateSerializer = (
  session: StageSession,
  serializer: HeadlessDebugStateSerializer,
) => void;

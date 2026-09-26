import type { EnabledFeature, PatternDefinition, StageId } from "../content/types.ts";
import { HASHABLE_ENEMY_BULLET_RUNTIME_ENTITY_FIELD_ORDER } from "../entities/enemy-bullet/snapshot.ts";
import type { HashableEnemyBulletRuntimeEntityState } from "../entities/enemy-bullet/snapshot.ts";
import { HASHABLE_ENEMY_RUNTIME_ENTITY_FIELD_ORDER } from "../entities/enemy/snapshot.ts";
import type { HashableEnemyRuntimeEntityState } from "../entities/enemy/snapshot.ts";
import type { Vector2 } from "../entities/model-common.ts";
import { HASHABLE_PLAYER_SHOT_RUNTIME_ENTITY_FIELD_ORDER } from "../entities/player-shot/snapshot.ts";
import type { HashablePlayerShotRuntimeEntityState } from "../entities/player-shot/snapshot.ts";
import { HASHABLE_PLAYER_RUNTIME_ENTITY_FIELD_ORDER } from "../entities/player/snapshot.ts";
import type { HashablePlayerRuntimeEntityState } from "../entities/player/snapshot.ts";
import type { HashableVector2 } from "../entities/snapshot-common.ts";
import type { SERIALIZED_STATE_HASH_VERSION } from "../serialization/metadata.ts";
import type {
  SerializedEnabledFeatureState,
  SerializedPatternRunnerState,
  SerializedPendingEvent,
} from "../serialization/types.ts";
import { defineFieldOrder } from "../shared/field-order.ts";
import type { SerializedPrngState } from "../simulation/prng.ts";

/** Hash 対象の PRNG snapshot。 */
export type HashablePrngState = Readonly<{ state: number }>;

/**
 * state hash 用に使う内部 deterministic snapshot。
 *
 * serialize 用の public DTO とは別に、hash version ごとの正規化済み入力として扱う。
 * public snapshot の互換性維持と hash byte stream の固定を独立させるため、この型では
 * runtime state から必要な deterministic field だけを重複なく並べる。
 */
export type HashableGameState = Readonly<{
  stateHashVersion: typeof SERIALIZED_STATE_HASH_VERSION;
  coreVersion: string;
  schemaVersion: string;
  expectedTick: number;
  nextEntityId: number;
  timelineCursor: number;
  prngState: HashablePrngState;
  score: number;
  runtimeEntities: ReadonlyArray<HashableRuntimeEntityState>;
  pendingEvents: ReadonlyArray<HashablePendingEvent>;
  patternRunnerStates: ReadonlyArray<HashablePatternRunnerState>;
  enabledFeatureStates: ReadonlyArray<HashableEnabledFeatureState>;
}>;

/** HashableGameState に含める runtime entity の内部 hash 専用 DTO。 */
export type HashableRuntimeEntityState =
  | HashablePlayerRuntimeEntityState
  | HashableEnemyRuntimeEntityState
  | HashableEnemyBulletRuntimeEntityState
  | HashablePlayerShotRuntimeEntityState;

/** Hash 対象として次 tick に持ち越す pending event。 */
export type HashablePendingEvent = Readonly<{
  type: "stageStarted";
  tick: 0;
  stageId: StageId;
}>;

/** Pattern runner の hash 対象 state。 */
export type HashablePatternRunnerState = Readonly<{
  runnerId: `patternRunner.${string}`;
  patternId: PatternDefinition["id"];
  stateVersion: number;
  payload: HashableJsonValue;
}>;

/** Optional feature module の hash 対象 state。 */
export type HashableEnabledFeatureState = Readonly<{
  feature: EnabledFeature;
  stateVersion: number;
  payload: HashableJsonValue;
}>;

/** Hash encoder が受け付ける JSON 互換 payload。 */
export type HashableJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly HashableJsonValue[]
  | { readonly [key: string]: HashableJsonValue };

type HashableFixedStructDtoKey =
  | "gameState"
  | "prngState"
  | "vector2"
  | "playerMovement"
  | "enemyPathRunnerState"
  | "playerRuntimeEntity"
  | "enemyRuntimeEntity"
  | "enemyBulletRuntimeEntity"
  | "playerShotRuntimeEntity"
  | "pendingEvent"
  | "patternRunnerState"
  | "enabledFeatureState";

/** HashableGameState adapter が参照する fixedStruct 名の実行時正本。 */
export const HASHABLE_FIXED_STRUCT_NAME_BY_DTO = Object.freeze({
  gameState: "hashableGameState",
  prngState: "prngState",
  vector2: "vector2",
  playerMovement: "playerMovement",
  enemyPathRunnerState: "enemyPathRunnerState",
  playerRuntimeEntity: "playerRuntimeEntity",
  enemyRuntimeEntity: "enemyRuntimeEntity",
  enemyBulletRuntimeEntity: "enemyBulletRuntimeEntity",
  playerShotRuntimeEntity: "playerShotRuntimeEntity",
  pendingEvent: "pendingEvent",
  patternRunnerState: "patternRunnerState",
  enabledFeatureState: "enabledFeatureState",
} as const satisfies Readonly<Record<HashableFixedStructDtoKey, string>>);

/** HashablePrngState の canonical encoding 順を固定する。 */
export const HASHABLE_PRNG_STATE_FIELD_ORDER = defineFieldOrder<HashablePrngState, SerializedPrngState>()([
  "state",
]);

/** HashableVector2 の canonical encoding 順を固定する。 */
export const HASHABLE_VECTOR2_FIELD_ORDER = defineFieldOrder<HashableVector2, Vector2>()([
  "x",
  "y",
]);

/** HashableGameState の canonical encoding 順を型と同じ場所で固定する。 */
export const HASHABLE_GAME_STATE_FIELD_ORDER = defineFieldOrder<HashableGameState>()([
  "stateHashVersion",
  "coreVersion",
  "schemaVersion",
  "expectedTick",
  "nextEntityId",
  "timelineCursor",
  "prngState",
  "score",
  "runtimeEntities",
  "pendingEvents",
  "patternRunnerStates",
  "enabledFeatureStates",
]);

/** Hashable runtime entity の kind 別 canonical encoding 順を固定する。 */
export const HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND = Object.freeze({
  player: HASHABLE_PLAYER_RUNTIME_ENTITY_FIELD_ORDER,
  enemy: HASHABLE_ENEMY_RUNTIME_ENTITY_FIELD_ORDER,
  enemyBullet: HASHABLE_ENEMY_BULLET_RUNTIME_ENTITY_FIELD_ORDER,
  playerShot: HASHABLE_PLAYER_SHOT_RUNTIME_ENTITY_FIELD_ORDER,
} as const satisfies Readonly<{
  [Kind in HashableRuntimeEntityState["kind"]]: readonly (keyof Extract<HashableRuntimeEntityState, { kind: Kind }>)[];
}>);

/** Hashable pending event の canonical encoding 順を固定する。 */
export const HASHABLE_PENDING_EVENT_FIELD_ORDER = defineFieldOrder<
  HashablePendingEvent,
  SerializedPendingEvent
>()([
  "type",
  "tick",
  "stageId",
]);

/** Hashable pattern runner state の canonical encoding 順を固定する。 */
export const HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER = defineFieldOrder<
  HashablePatternRunnerState,
  SerializedPatternRunnerState
>()([
  "runnerId",
  "patternId",
  "stateVersion",
  "payload",
]);

/** Hashable optional feature state の canonical encoding 順を固定する。 */
export const HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER = defineFieldOrder<
  HashableEnabledFeatureState,
  SerializedEnabledFeatureState
>()([
  "feature",
  "stateVersion",
  "payload",
]);

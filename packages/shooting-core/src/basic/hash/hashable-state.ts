import type {
  BulletDefinition,
  EnabledFeature,
  EnemyDefinition,
  PathId,
  PatternDefinition,
  PlayerId,
  PlayerShotDefinition,
  StageId,
} from "../content/types.ts";
import type { EnemyBulletRuntimeEntity } from "../entities/enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { Vector2 } from "../entities/model-common.ts";
import type { PlayerShotRuntimeEntity } from "../entities/player-shot/model.ts";
import type { PlayerRuntimeEntity } from "../entities/player/model.ts";
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

/** Hash 対象の 2D vector。position / velocity で共通利用する。 */
export type HashableVector2 = Readonly<{ x: number; y: number }>;

/** Hash 対象の player movement 設定。vector と別 fixedStruct として encode する。 */
export type HashablePlayerMovement = Readonly<{ speed: number; focusSpeed: number }>;

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

/** HashableGameState に含める player runtime entity の内部 hash 専用 DTO。 */
export type HashablePlayerRuntimeEntityState = Readonly<{
  id: number;
  kind: "player";
  definitionId: PlayerId;
  position: HashableVector2;
  collisionRadius: number;
  lives: number;
  invincibleTicksRemaining: number;
  nextShotAllowedTick: number;
  movement: HashablePlayerMovement;
  shotDefinitionId: PlayerShotDefinition["id"];
}>;

/** HashableGameState に含める enemy runtime entity の内部 hash 専用 DTO。 */
export type HashableEnemyRuntimeEntityState = Readonly<{
  id: number;
  kind: "enemy";
  definitionId: EnemyDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternDefinition["id"];
}>;

/** HashableGameState に含める enemy bullet runtime entity の内部 hash 専用 DTO。 */
export type HashableEnemyBulletRuntimeEntityState = Readonly<{
  id: number;
  kind: "enemyBullet";
  definitionId: BulletDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
}>;

/** HashableGameState に含める player shot runtime entity の内部 hash 専用 DTO。 */
export type HashablePlayerShotRuntimeEntityState = Readonly<{
  id: number;
  kind: "playerShot";
  definitionId: PlayerShotDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
  velocity: HashableVector2;
  remainingLifetimeTicks: number;
  damage: number;
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

/** HashablePlayerMovement の canonical encoding 順を固定する。 */
export const HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER = defineFieldOrder<
  HashablePlayerMovement,
  PlayerRuntimeEntity["movement"]
>()([
  "speed",
  "focusSpeed",
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
  player: defineFieldOrder<HashablePlayerRuntimeEntityState, PlayerRuntimeEntity>()([
    "id",
    "kind",
    "definitionId",
    "position",
    "collisionRadius",
    "lives",
    "invincibleTicksRemaining",
    "nextShotAllowedTick",
    "movement",
    "shotDefinitionId",
  ]),
  enemy: defineFieldOrder<HashableEnemyRuntimeEntityState, EnemyRuntimeEntity>()([
    "id",
    "kind",
    "definitionId",
    "position",
    "collisionRadius",
    "hp",
    "scoreOnKill",
    "pathId",
    "patternId",
  ]),
  enemyBullet: defineFieldOrder<HashableEnemyBulletRuntimeEntityState, EnemyBulletRuntimeEntity>()([
    "id",
    "kind",
    "definitionId",
    "position",
    "collisionRadius",
  ]),
  playerShot: defineFieldOrder<HashablePlayerShotRuntimeEntityState, PlayerShotRuntimeEntity>()([
    "id",
    "kind",
    "definitionId",
    "position",
    "collisionRadius",
    "velocity",
    "remainingLifetimeTicks",
    "damage",
  ]),
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

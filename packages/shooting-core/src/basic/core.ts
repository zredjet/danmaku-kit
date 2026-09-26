import { isNamespacedId } from "./content/identifier.ts";
import {
  MAX_PLAYER_MOVEMENT_SPEED,
  MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
  MAX_PLAYER_SHOT_LIFETIME_TICKS,
  MAX_PLAYER_SHOT_SPEED_PER_AXIS,
  MAX_STAGE_TIMELINE_STEPS,
  PLAYFIELD_HEIGHT,
  PLAYFIELD_WIDTH,
} from "./content/runtime-budgets.ts";
import { KNOWN_ENABLED_FEATURES } from "./content/types.ts";
import type {
  BulletDefinition,
  Difficulty,
  EnabledFeature,
  EnemyDefinition,
  GameDefinition,
  PathId,
  PathDefinition,
  PatternDefinition,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  StageDefinition,
  StageId,
} from "./content/types.ts";
import { validateGameDefinition } from "./content/validation.ts";
import { EventLog } from "./events/game-event.ts";
import type { GameEvent } from "./events/game-event.ts";
import { hashHashableGameState, hashHashablePrngState } from "./hash/state-hash.ts";
import { GAMEPLAY_ACTION_ORDER } from "./input/input-frame.ts";
import type { InputFrame } from "./input/input-frame.ts";
import type {
  HeadlessDebugEntityCounts,
  HeadlessDebugEventCounts,
  HeadlessDebugStateResult,
  HeadlessDebugStateDump,
  HeadlessDebugTickMetrics,
  RegisterHeadlessDebugStateSerializer,
} from "./internal/debug-state.ts";
import { deepFreezeClone, deepFreezePlainData } from "./internal/immutable.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import type { CoreError, CoreErrorCode, CoreResult } from "./result.ts";
import type {
  SerializedDeterministicState,
  SerializedEnabledFeatureState,
  SerializedGameState,
  SerializedPendingEvent,
  SerializedPatternRunnerState,
  SerializedRuntimeEntityState,
} from "./serialization/types.ts";
import {
  compareUtf8Lexicographic,
  createRestoreJsonBudget,
  isRestoreJsonStringWithinSingleValueBudget,
  validateRestoreJsonPayload,
} from "./serialization/restore-json.ts";
import type { RestoreJsonBudget } from "./serialization/restore-json.ts";
import { resolveCollisionAndScoring } from "./simulation/collision-system.ts";
import { EntityAllocator } from "./simulation/entity.ts";
import { resolveEnemyBulletSpawnPosition, spawnEnemyBulletsOnSpawn } from "./simulation/enemy-bullet-system.ts";
import { advancePlayerMovement } from "./simulation/player-movement-system.ts";
import { advancePlayerShotLifecycle } from "./simulation/player-shot-lifecycle-system.ts";
import { spawnPlayerShotFromInput } from "./simulation/player-shot-system.ts";
import {
  DEFAULT_PLAYER_START_POSITION,
  createEnemyRuntimeEntity,
  createPlayerRuntimeEntity,
  createRestoredEnemyBulletRuntimeEntity,
  createRestoredEnemyRuntimeEntity,
  createRestoredPlayerRuntimeEntity,
  createRestoredPlayerShotRuntimeEntity,
  toReadonlyEntityState,
} from "./simulation/runtime-entity.ts";
import type {
  EnemyBulletRuntimeEntity,
  EnemyRuntimeEntity,
  PlayerRuntimeEntity,
  PlayerShotRuntimeEntity,
  ReadonlyEntityState,
  RuntimeEntityState,
  Vector2,
} from "./simulation/runtime-entity.ts";
import { freezeEntitiesInIdOrder } from "./simulation/system-order.ts";
import { XorShift32 } from "./simulation/prng.ts";
import type { SerializedPrngState } from "./simulation/prng.ts";
import { MAX_RESTORABLE_NEXT_ENTITY_ID } from "./simulation/entity-id-budget.ts";

const MAX_SEED_LENGTH = 128;
const INTERNAL_TEST_HOOKS_ENV = "SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS";
const SERIALIZED_INPUT_FORMAT_VERSION = "1";
const SERIALIZED_STATE_HASH_VERSION = 1;

/**
 * ステージ開始時に runtime adapter から渡すオプション。
 *
 * `seed` は replay determinism の入口なので、タイトル側の乱数とは分けて
 * Core に明示的に渡す。
 */
export type StartStageOptions = {
  stageId: StageId;
  difficulty: Difficulty;
  playerId?: PlayerId;
  seed: string;
};

/**
 * 1 tick 終了時点の gameplay state。
 *
 * renderer / debug HUD が読む表示用 snapshot。HP や pattern cursor のような内部 component は、
 * serialize / state hash 用の内部 DTO 側で扱い、この型へは直接混ぜない。
 */
export type ReadonlyGameState = Readonly<{
  tick: number;
  stageId: StageId;
  playerId: PlayerId;
  player: ReadonlyPlayerState;
  score: number;
  entities: ReadonlyArray<ReadonlyEntityState>;
}>;

/** HUD / debug が event fold なしで参照できる自機の現在状態。 */
export type ReadonlyPlayerState = Readonly<{
  lives: number;
  invincibleTicksRemaining: number;
}>;

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

/** Committed state が次 tick へ持ち越してよい deterministic event。 */
type CommittedPendingEvent = HashablePendingEvent;

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

type HasDuplicateField<
  Keys extends readonly unknown[],
  Seen extends readonly unknown[] = [],
> = Keys extends readonly [infer Head, ...infer Tail]
  ? Head extends Seen[number]
    ? true
    : HasDuplicateField<Tail, readonly [...Seen, Head]>
  : false;

type ExactFieldOrder<T, Keys extends readonly (keyof T)[]> =
  Exclude<keyof T, Keys[number]> extends never
    ? HasDuplicateField<Keys> extends true
      ? never
      : Keys
    : never;

/**
 * hash DTO と runtime component の field set が一致することを検査する。
 *
 * Basic core の runtime entity は hash 対象外の cache / render state を持たないため、
 * runtime field の追加時に hash projection だけを更新し忘れることを型エラーにする。
 */
type ExactFieldSet<Left, Right> =
  Exclude<keyof Left, keyof Right> extends never
    ? Exclude<keyof Right, keyof Left> extends never
      ? unknown
      : never
    : never;

const defineFieldOrder = <T, RuntimeContract = T>() => <const Keys extends readonly (keyof T)[]>(
  keys: ExactFieldOrder<T, Keys> & ExactFieldSet<T, RuntimeContract>,
): Readonly<Keys> => Object.freeze([...keys]) as unknown as Readonly<Keys>;

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

/**
 * serialize / restore compatibility 判定に必要な session metadata。
 *
 * tick state だけからは `difficulty` や content / input format version を復元できないため、
 * startStage の時点で確定した値を session context に保持する。
 */
type StageSessionSerializationMetadata = Readonly<{
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: typeof SERIALIZED_INPUT_FORMAT_VERSION;
  stateHashVersion: typeof SERIALIZED_STATE_HASH_VERSION;
  enabledFeatures: readonly EnabledFeature[];
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
}>;

/**
 * Core から renderer / debug / replay へ渡す 1 tick 分の出力。
 *
 * `events` はこの frame で発生した gameplay event のみを含み、DOM や audio の
 * runtime event とは混ぜない。
 */
export type GameFrame = Readonly<{
  tick: number;
  state: ReadonlyGameState;
  events: ReadonlyArray<GameEvent>;
}>;

/**
 * renderer 非依存の shooting core 入口。
 *
 * `load()` は型上は `GameDefinition` を受けるが、JS や unsafe cast からの呼び出しも
 * runtime validation に通して immutable snapshot を保持する。
 */
export type ShootingCore = {
  coreVersion: string;
  load(definition: GameDefinition): CoreResult<LoadedGame>;
};

/**
 * 検証済みの game definition から stage session を開始する API。
 *
 * `LoadedGame` は load 後の content mutation に影響されない snapshot を参照する。
 */
export type LoadedGame = {
  /** serialized snapshot から stage session を復元し、不整合や未対応 snapshot は `CoreResult` error として返す。 */
  restore(state: SerializedGameState): CoreResult<StageSession>;
  /** stage id / difficulty / player / seed から新しい stage session を開始する。 */
  startStage(options: StartStageOptions): CoreResult<StageSession>;
};

/**
 * gameplay simulation の実行単位。
 *
 * 現時点では playing 中の fixed tick だけを扱う。pause / result / replay UI は
 * runtime lifecycle 側で管理する。`serialize()` は simulation を進めない読み取り API であり、
 * 成功時は restore 用の deep immutable snapshot を返す。state hash は committed state から
 * 別の内部 DTO を生成して計算する。
 * fatal state に入った後は `tick()` と同じ fatal error を返す。
 */
export type StageSession = {
  /** 次の fixed tick を実行し、frame state とその tick の event を返す。 */
  tick(input: InputFrame): CoreResult<GameFrame>;
  /** 現在の committed state を serialized snapshot として返す。 */
  serialize(): CoreResult<SerializedGameState>;
};

/**
 * Core minimum 実装を生成する。
 *
 * Phase 1A では Phaser / Vite / DOM に依存せず、Node の test runner だけで
 * load / startStage / tick を検証できることを優先している。
 */
export function createShootingCore(coreVersion = "0.0.0"): ShootingCore {
  return createShootingCoreInternal(coreVersion, {});
}

/**
 * Core の fault-injection 付きインスタンスを作る内部テスト専用 API。
 *
 * root package export には出さず、通常 runtime からは参照できない形に留める。
 */
export function createShootingCoreWithTestingHooksForInternalTest(
  coreVersion = "0.0.0",
  testingHooks: StageSessionTestingHookOptions = {},
): ShootingCore {
  assertInternalTestHooksEnabled();
  return createShootingCoreInternal(coreVersion, testingHooks);
}

function createShootingCoreInternal(
  coreVersion: string,
  testingHooks: StageSessionTestingHookOptions,
): ShootingCore {
  return Object.freeze({
    coreVersion,
    load(definition) {
      const plainDefinition = deepFreezePlainData(definition);
      if (!plainDefinition) {
        return error("definition.invalidShape", "GameDefinition must be JSON-compatible plain data");
      }
      const errors = validateGameDefinition(plainDefinition);
      if (errors.length > 0) {
        return errorResult(errors);
      }
      return okResult(createLoadedGame(createLoadedContentIndex(plainDefinition as GameDefinition), coreVersion, testingHooks));
    },
  });
}

type LoadedContentIndex = Readonly<{
  definition: GameDefinition;
  bulletsById: ReadonlyMap<string, BulletDefinition>;
  enemiesById: ReadonlyMap<string, EnemyDefinition>;
  pathsById: ReadonlyMap<string, PathDefinition>;
  patternsById: ReadonlyMap<string, PatternDefinition>;
  playerShotsById: ReadonlyMap<string, PlayerShotDefinition>;
  playersById: ReadonlyMap<string, PlayerDefinition>;
  stagesById: ReadonlyMap<string, StageDefinition>;
}>;

type StageSessionContext = {
  debugSeed: string | null;
  initialState: CommittedStageState;
  serializationMetadata: StageSessionSerializationMetadata;
  bulletsById: ReadonlyMap<string, BulletDefinition>;
  enemiesById: ReadonlyMap<string, EnemyDefinition>;
  patternsById: ReadonlyMap<string, PatternDefinition>;
  playerShotsById: ReadonlyMap<string, PlayerShotDefinition>;
  stage: StageDefinition;
  player: PlayerDefinition;
  testingHooks: ActiveStageSessionTestingHooks;
};

type CommittedStageState = Readonly<{
  expectedTick: number;
  activeEntities: readonly RuntimeEntityState[];
  nextEntityId: number;
  pendingEvents: readonly CommittedPendingEvent[];
  prngState: SerializedPrngState;
  score: number;
  timelineCursor: number;
}>;

/** restore や fault injection 直後の、PRNG / pending event 検証前 committed snapshot。 */
type UntrustedCommittedStageState = Omit<CommittedStageState, "pendingEvents" | "prngState"> & Readonly<{
  pendingEvents: readonly unknown[];
  prngState: unknown;
}>;

const MAX_RESTORE_TOP_LEVEL_STRING_LENGTH = 8_192;
const MAX_RESTORE_ENABLED_FEATURES_LENGTH = 64;
const MAX_RESTORE_ARRAY_LENGTH = 8_192;
const MAX_RESTORE_RUNTIME_ENTITIES_LENGTH = 1
  + (MAX_STAGE_TIMELINE_STEPS * 2)
  + MAX_PLAYER_SHOT_LIFETIME_TICKS;
type SerializedRestorePlayerEntity = Extract<SerializedRuntimeEntityState, { kind: "player" }>;
type SerializedRestoreEnemyEntity = Extract<SerializedRuntimeEntityState, { kind: "enemy" }>;
type SerializedRestoreEnemyBulletEntity = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;
type SerializedRestorePlayerShotEntity = Extract<SerializedRuntimeEntityState, { kind: "playerShot" }>;

const RESTORE_RUNTIME_ENTITY_COMMON_KEYS = Object.freeze([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
] as const satisfies ReadonlyArray<keyof SerializedRuntimeEntityState>);
const RESTORE_RUNTIME_PLAYER_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "lives",
  "invincibleTicksRemaining",
  "nextShotAllowedTick",
  "movement",
  "shotDefinitionId",
] as const satisfies ReadonlyArray<keyof SerializedRestorePlayerEntity>);
const RESTORE_RUNTIME_ENEMY_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "hp",
  "scoreOnKill",
  "pathId",
  "patternId",
] as const satisfies ReadonlyArray<keyof SerializedRestoreEnemyEntity>);
const RESTORE_RUNTIME_ENEMY_BULLET_KEYS: ReadonlyArray<keyof SerializedRestoreEnemyBulletEntity> =
  RESTORE_RUNTIME_ENTITY_COMMON_KEYS;
const RESTORE_RUNTIME_PLAYER_SHOT_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "velocity",
  "remainingLifetimeTicks",
  "damage",
] as const satisfies ReadonlyArray<keyof SerializedRestorePlayerShotEntity>);
const RESTORE_RUNTIME_ENTITY_ALL_KEYS = Object.freeze([
  ...new Set([
    ...RESTORE_RUNTIME_PLAYER_KEYS,
    ...RESTORE_RUNTIME_ENEMY_KEYS,
    ...RESTORE_RUNTIME_PLAYER_SHOT_KEYS,
  ]),
]);
const RESTORE_RUNTIME_ENTITY_KINDS = Object.freeze([
  "player",
  "enemy",
  "enemyBullet",
  "playerShot",
] as const satisfies ReadonlyArray<SerializedRuntimeEntityState["kind"]>);
const RESTORE_PATTERN_RUNNER_STATE_KEYS = Object.freeze([
  "runnerId",
  "patternId",
  "stateVersion",
  "payload",
] as const satisfies ReadonlyArray<keyof SerializedPatternRunnerState>);
const RESTORE_ENABLED_FEATURE_STATE_KEYS = Object.freeze([
  "feature",
  "stateVersion",
  "payload",
] as const satisfies ReadonlyArray<keyof SerializedEnabledFeatureState>);
const MAX_RESTORE_EXTENSION_STATES_LENGTH = 128;

const RESTORE_TOP_LEVEL_KEY_MAP = Object.freeze({
  coreVersion: true,
  schemaVersion: true,
  contentVersion: true,
  inputFormatVersion: true,
  stateHashVersion: true,
  enabledFeatures: true,
  stageId: true,
  difficulty: true,
  playerId: true,
  expectedTick: true,
  nextEntityId: true,
  prngState: true,
  state: true,
} satisfies Record<keyof SerializedGameState, true>);

const RESTORE_TOP_LEVEL_KEYS = Object.freeze(Object.keys(RESTORE_TOP_LEVEL_KEY_MAP)) as readonly (keyof SerializedGameState)[];

type RestoreTopLevelField = typeof RESTORE_TOP_LEVEL_KEYS[number];
type RestoreSchemaMetadata = Pick<SerializedGameState, "coreVersion" | "schemaVersion">;
type RestoreVersionMetadata = Pick<
  SerializedGameState,
  "coreVersion" | "schemaVersion" | "contentVersion" | "inputFormatVersion" | "stateHashVersion"
>;
type RestoreCompatibilityMetadata = Readonly<RestoreVersionMetadata & {
  enabledFeatures: readonly string[];
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
}>;
type ValidatedRestorePatternRunnerState = SerializedPatternRunnerState;
type ValidatedRestoreEnabledFeatureState = SerializedEnabledFeatureState;

/**
 * 復元互換性を判定する top-level serialized state。
 *
 * `enabledFeatures` は将来 feature 名を `state.featureMismatch` に分類できるよう、
 * shape guard では string array までに留める。
 */
type RestoreTopLevelState = Readonly<
  Omit<Pick<SerializedGameState, RestoreTopLevelField>, "enabledFeatures" | "prngState" | "state"> & {
    enabledFeatures: readonly string[];
    prngState: unknown;
    state: unknown;
  }
>;

type WorkingStageState = {
  expectedTick: number;
  activeEntities: RuntimeEntityState[];
  entityAllocator: EntityAllocator;
  eventLog: EventLog;
  prng: XorShift32;
  score: number;
  timelineCursor: number;
};

type ValidatedRestoreDeterministicPayload = Readonly<{
  activeEntities: readonly RuntimeEntityState[];
  enabledFeatureStates: readonly ValidatedRestoreEnabledFeatureState[];
  pendingEvents: readonly CommittedPendingEvent[];
  patternRunnerStates: readonly ValidatedRestorePatternRunnerState[];
  score: number;
  timelineCursor: number;
}>;

type StageSessionTestingHookOptions = Readonly<{
  corruptCommittedPrngStateTicks?: readonly number[];
  failAfterWorkingMutationTicks?: readonly number[];
  overrideCommittedNextEntityIdTicks?: ReadonlyArray<Readonly<{
    tick: number;
    nextEntityId: number;
  }>>;
  overrideCommittedPendingEventsTicks?: ReadonlyArray<Readonly<{
    tick: number;
    pendingEvents: readonly unknown[];
  }>>;
  reverseCommittedEntitiesOnSerialize?: boolean;
  overrideCommittedNextEntityIdOnSerialize?: number;
  overrideCommittedPendingEventsOnSerialize?: readonly unknown[];
  overrideCommittedPrngStateOnSerialize?: unknown;
  failHeadlessDebugStateSerialization?: boolean;
  recordCommittedStateOnFatal?: (state: CommittedStageState) => void;
  recordHashableStateOnSerialize?: (state: HashableGameState) => void;
  recordRestoreSerializedSnapshot?: (state: SerializedGameState) => void;
  registerHeadlessDebugStateSerializer?: RegisterHeadlessDebugStateSerializer;
}>;

type ActiveStageSessionTestingHooks = Readonly<{
  corruptCommittedPrngStateTicks: Set<number>;
  failAfterWorkingMutationTicks: Set<number>;
  overrideCommittedNextEntityIdByTick: Map<number, number>;
  overrideCommittedPendingEventsByTick: Map<number, readonly unknown[]>;
  reverseCommittedEntitiesOnSerialize: boolean;
  overrideCommittedNextEntityIdOnSerialize?: number;
  overrideCommittedPendingEventsOnSerialize?: readonly unknown[];
  overrideCommittedPrngStateOnSerialize?: unknown;
  failHeadlessDebugStateSerialization: boolean;
  recordCommittedStateOnFatal?: (state: CommittedStageState) => void;
  recordHashableStateOnSerialize?: (state: HashableGameState) => void;
  registerHeadlessDebugStateSerializer?: RegisterHeadlessDebugStateSerializer;
}>;

/** validated content を runtime lookup しやすい形へまとめる。 */
function createLoadedContentIndex(definition: GameDefinition): LoadedContentIndex {
  return {
    definition,
    bulletsById: new Map(definition.content.bullets.map((bullet) => [bullet.id, bullet])),
    enemiesById: new Map(definition.content.enemies.map((enemy) => [enemy.id, enemy])),
    pathsById: new Map(definition.content.paths.map((path) => [path.id, path])),
    patternsById: new Map(definition.content.patterns.map((pattern) => [pattern.id, pattern])),
    playerShotsById: new Map(definition.content.playerShots.map((playerShot) => [playerShot.id, playerShot])),
    playersById: new Map(definition.content.players.map((player) => [player.id, player])),
    stagesById: new Map(definition.content.stages.map((stage) => [stage.id, stage])),
  };
}

/**
 * 検証済み snapshot から `LoadedGame` を作る。
 *
 * この関数へ渡る `definition` は `load()` 済みで freeze されている前提。
 * そのため startStage ごとに再 validation せず、ID 解決と session 初期化だけを行う。
 */
function createLoadedGame(
  content: LoadedContentIndex,
  coreVersion: string,
  testingHooks: StageSessionTestingHookOptions,
): LoadedGame {
  return Object.freeze({
    restore(rawState) {
      const schemaMetadata = parseRestoreSchemaMetadata(rawState);
      if (!schemaMetadata.ok) {
        return schemaMetadata;
      }
      const schemaCompatibility = validateRestoreSchemaCompatibility(schemaMetadata.value, content, coreVersion);
      if (!schemaCompatibility.ok) {
        return schemaCompatibility;
      }
      const topLevelState = cloneRestoreTopLevelPlainRecord(rawState);
      if (!topLevelState.ok) {
        return topLevelState;
      }
      const record = topLevelState.value;
      const inputFormatVersion = parseRestoreTopLevelStringField(record, "inputFormatVersion");
      if (!inputFormatVersion.ok) {
        return inputFormatVersion;
      }
      const inputFormatCompatibility = validateRestoreInputFormatCompatibility(inputFormatVersion.value);
      if (!inputFormatCompatibility.ok) {
        return inputFormatCompatibility;
      }
      const stateHashVersion = parseRestoreStateHashVersion(record);
      if (!stateHashVersion.ok) {
        return stateHashVersion;
      }
      const stateHashCompatibility = validateRestoreStateHashVersionCompatibility(stateHashVersion.value);
      if (!stateHashCompatibility.ok) {
        return stateHashCompatibility;
      }
      const metadata = Object.freeze({
        ...schemaMetadata.value,
        contentVersion: "",
        inputFormatVersion: inputFormatVersion.value,
        stateHashVersion: stateHashVersion.value,
      });
      const compatibilityMetadata = parseRestoreCompatibilityMetadata(record, metadata);
      if (!compatibilityMetadata.ok) {
        return compatibilityMetadata;
      }
      const contentVersionCompatibility = validateRestoreContentVersionCompatibility(compatibilityMetadata.value.contentVersion, content);
      if (!contentVersionCompatibility.ok) {
        return contentVersionCompatibility;
      }
      const fullMetadata = Object.freeze({
        ...metadata,
        contentVersion: compatibilityMetadata.value.contentVersion,
      });
      const compatibility = validateRestoreContentCompatibility(compatibilityMetadata.value, content);
      if (!compatibility.ok) {
        return compatibility;
      }
      const state = parseRestoreTopLevelState(record, fullMetadata, compatibilityMetadata.value);
      if (!state.ok) {
        return state;
      }
      const prng = validateRestorePrngSnapshot(state.value.prngState);
      if (!prng.ok) {
        return prng;
      }
      const payload = parseRestoreDeterministicPayload(state.value, content);
      if (!payload.ok) {
        return payload;
      }
      const serializationMetadata = createRestoreSerializationMetadata(fullMetadata, compatibilityMetadata.value, content);
      const restoredState = createRestoreCommittedState(
        state.value,
        payload.value,
        prng.value,
        serializationMetadata,
      );
      if (!restoredState.ok) {
        return restoredState;
      }
      testingHooks.recordRestoreSerializedSnapshot?.(restoredState.value.serializedSnapshot);

      const stage = content.stagesById.get(compatibilityMetadata.value.stageId);
      const player = content.playersById.get(compatibilityMetadata.value.playerId);
      if (!stage || !player) {
        return error("state.contentMismatch", "serialized content metadata does not match the loaded content");
      }

      return okResult(createStageSession({
        bulletsById: content.bulletsById,
        debugSeed: null,
        enemiesById: content.enemiesById,
        initialState: restoredState.value.committedState,
        serializationMetadata,
        patternsById: content.patternsById,
        playerShotsById: content.playerShotsById,
        stage,
        player,
        testingHooks: createActiveStageSessionTestingHooks(testingHooks),
      }));
    },
    startStage(rawOptions) {
      const plainOptions = deepFreezePlainData(rawOptions);
      if (!plainOptions) {
        return error("startStage.invalidShape", "StartStageOptions must be JSON-compatible plain data");
      }
      const options = parseStartStageOptions(plainOptions);
      if (!options.ok) {
        return options;
      }
      // startStage の入力は runtime 側から来るため、stage/player/difficulty は毎回確認する。
      const stage = content.stagesById.get(options.value.stageId);
      const playerId = options.value.playerId ?? content.definition.defaultPlayerId;
      const player = content.playersById.get(playerId);

      if (!stage) {
        return error("stage.notFound", `Stage not found: ${options.value.stageId}`);
      }
      if (!player) {
        return error("player.notFound", `Player not found: ${playerId}`);
      }
      if (!stage.difficulties.includes(options.value.difficulty)) {
        return error("difficulty.notSupported", `Difficulty not supported: ${options.value.difficulty}`);
      }

      const entityAllocator = new EntityAllocator();
      const playerEntity = createPlayerRuntimeEntity(entityAllocator, player);
      if (!playerEntity.ok) {
        return playerEntity;
      }

      // stageStarted は最初の GameFrame で renderer/debug が初期状態を同期するための event。
      const initialState = createCommittedStageState({
        activeEntities: [playerEntity.value],
        expectedTick: 0,
        nextEntityId: entityAllocator.snapshot(),
        pendingEvents: [{ type: "stageStarted", tick: 0, stageId: stage.id }],
        prngState: new XorShift32(options.value.seed).snapshot(),
        score: 0,
        timelineCursor: 0,
      });
      return okResult(createStageSession({
        bulletsById: content.bulletsById,
        debugSeed: options.value.seed,
        enemiesById: content.enemiesById,
        initialState,
        serializationMetadata: {
          coreVersion,
          schemaVersion: content.definition.schemaVersion,
          contentVersion: content.definition.content.version,
          inputFormatVersion: SERIALIZED_INPUT_FORMAT_VERSION,
          stateHashVersion: SERIALIZED_STATE_HASH_VERSION,
          enabledFeatures: canonicalizeEnabledFeatures(content.definition.enabledFeatures),
          stageId: stage.id,
          difficulty: options.value.difficulty,
          playerId,
        },
        patternsById: content.patternsById,
        playerShotsById: content.playerShotsById,
        stage,
        player,
        testingHooks: createActiveStageSessionTestingHooks(testingHooks),
      }));
    },
  });
}

/** restore metadata を StageSession が保持する serialization metadata と同じ形へ変換する。 */
function createRestoreSerializationMetadata(
  versionMetadata: RestoreVersionMetadata,
  compatibilityMetadata: RestoreCompatibilityMetadata,
  content: LoadedContentIndex,
): StageSessionSerializationMetadata {
  return Object.freeze({
    coreVersion: versionMetadata.coreVersion,
    schemaVersion: versionMetadata.schemaVersion,
    contentVersion: versionMetadata.contentVersion,
    inputFormatVersion: SERIALIZED_INPUT_FORMAT_VERSION,
    stateHashVersion: SERIALIZED_STATE_HASH_VERSION,
    enabledFeatures: canonicalizeEnabledFeatures(content.definition.enabledFeatures),
    stageId: compatibilityMetadata.stageId,
    difficulty: compatibilityMetadata.difficulty,
    playerId: compatibilityMetadata.playerId,
  });
}

/** optional feature set を snapshot / hash 用の安定順に並べる。 */
function canonicalizeEnabledFeatures(features: readonly EnabledFeature[]): readonly EnabledFeature[] {
  return Object.freeze(KNOWN_ENABLED_FEATURES.filter((feature) => features.includes(feature)));
}

/**
 * 1 stage の simulation session を作る。
 *
 * 各 system は working state 上で実行し、frame 構築直前に成功時だけ session state へ
 * commit する。これにより ID 採番、collision、score、event 順序を deterministic に保つ。
 */
function createStageSession(options: StageSessionContext): StageSession {
  let committedState = options.initialState;
  const debugMetricsEnabled = options.testingHooks.registerHeadlessDebugStateSerializer !== undefined;
  let debugTickMetrics: HeadlessDebugTickMetrics | null = null;
  let fatalErrors: readonly CoreError[] | null = null;
  const latchFatalErrors = <T>(errors: readonly CoreError[]): CoreResult<T> => {
    options.testingHooks.recordCommittedStateOnFatal?.(deepFreezeClone(committedState));
    fatalErrors = freezeFatalErrors(errors);
    return errorResult(fatalErrors);
  };

  const session: StageSession = {
    serialize() {
      if (fatalErrors) {
        return errorResult(fatalErrors);
      }
      const serializedState = createSerializeSourceState(committedState, options.testingHooks);
      const serialized = serializeCommittedStageState(options.serializationMetadata, serializedState);
      if (!serialized.ok) {
        return latchFatalErrors(serialized.errors);
      }
      if (options.testingHooks.recordHashableStateOnSerialize) {
        const hashableState = createHashableGameState(options.serializationMetadata, committedState);
        if (!hashableState.ok) {
          return latchFatalErrors(hashableState.errors);
        }
        options.testingHooks.recordHashableStateOnSerialize(hashableState.value);
      }
      return serialized;
    },
    tick(rawInput) {
      if (fatalErrors) {
        return errorResult(fatalErrors);
      }
      const plainInput = deepFreezePlainData(rawInput);
      if (!plainInput) {
        return error("input.invalidShape", "InputFrame must be JSON-compatible plain data");
      }
      const input = parseInputFrame(plainInput);
      if (!input.ok) {
        return input;
      }
      // system order の applyInput。入力 tick のズレは状態を進める前に拒否する。
      if (input.value.tick !== committedState.expectedTick) {
        return error("input.tickMismatch", `Expected tick ${committedState.expectedTick}, got ${input.value.tick}`);
      }

      if (options.testingHooks.corruptCommittedPrngStateTicks.delete(committedState.expectedTick)) {
        committedState = {
          ...committedState,
          prngState: Object.freeze({ state: 0 }),
        };
      }
      if (options.testingHooks.overrideCommittedNextEntityIdByTick.has(committedState.expectedTick)) {
        const nextEntityId = options.testingHooks.overrideCommittedNextEntityIdByTick.get(committedState.expectedTick)!;
        options.testingHooks.overrideCommittedNextEntityIdByTick.delete(committedState.expectedTick);
        committedState = {
          ...committedState,
          nextEntityId,
        };
      }
      let workingStateSource: UntrustedCommittedStageState = committedState;
      if (options.testingHooks.overrideCommittedPendingEventsByTick.has(committedState.expectedTick)) {
        const pendingEvents = options.testingHooks.overrideCommittedPendingEventsByTick.get(committedState.expectedTick)!;
        options.testingHooks.overrideCommittedPendingEventsByTick.delete(committedState.expectedTick);
        workingStateSource = {
          ...committedState,
          pendingEvents: deepFreezeClone(pendingEvents),
        };
      }

      const working = createWorkingStageState(workingStateSource, options.stage.id);
      if (!working.ok) {
        return latchFatalErrors(working.errors);
      }
      const spawnedEnemyEntities: EnemyRuntimeEntity[] = [];

      // system order の updateStageTimeline。timeline 順に spawn event を生成する。
      while (
        working.value.timelineCursor < options.stage.timeline.length
        && options.stage.timeline[working.value.timelineCursor]!.tick === working.value.expectedTick
      ) {
        const step = options.stage.timeline[working.value.timelineCursor]!;
        if (step.action.type === "spawnEnemy") {
          const enemyDefinition = options.enemiesById.get(step.action.enemy);
          if (!enemyDefinition) {
            return latchFatalErrors([{ code: "enemy.notFound", message: `Enemy not found: ${step.action.enemy}` }]);
          }
          const entity = createEnemyRuntimeEntity(working.value.entityAllocator, enemyDefinition, step.action);
          if (!entity.ok) {
            return latchFatalErrors(entity.errors);
          }
          working.value.activeEntities.push(entity.value);
          spawnedEnemyEntities.push(entity.value);
          working.value.eventLog.push({
            type: "entitySpawned",
            tick: working.value.expectedTick,
            entityId: entity.value.id,
            entityKind: "enemy",
            definitionId: step.action.enemy,
            path: step.action.path,
            pattern: step.action.pattern,
            position: step.action.position,
          });
        }
        working.value.timelineCursor += 1;
      }

      // system order の spawnBulletsPlayerShots。enemy pattern の弾生成を player shot より先に確定する。
      const enemyBulletSpawn = spawnEnemyBulletsOnSpawn(
        working.value.entityAllocator,
        working.value.expectedTick,
        spawnedEnemyEntities,
        options.patternsById,
        options.bulletsById,
      );
      if (!enemyBulletSpawn.ok) {
        return latchFatalErrors(enemyBulletSpawn.errors);
      }
      if (enemyBulletSpawn.value) {
        working.value.activeEntities.push(...enemyBulletSpawn.value.entities);
        working.value.eventLog.push(enemyBulletSpawn.value.event);
      }

      // system order の spawnBulletsPlayerShots。pressed / held の shot intent を fire interval で間引く。
      const spawnedPlayerShotEntityIds = new Set<number>();
      const playerEntity = findPlayerEntity(working.value.activeEntities, options.player.id);
      if (!playerEntity) {
        return latchFatalErrors([{ code: "player.notFound", message: `Player entity not found: ${options.player.id}` }]);
      }
      const playerShotDefinition = options.playerShotsById.get(playerEntity.shotDefinitionId);
      if (!playerShotDefinition) {
        return latchFatalErrors([
          { code: "playerShot.notFound", message: `Player shot not found: ${playerEntity.shotDefinitionId}` },
        ]);
      }
      const playerShotSpawn = spawnPlayerShotFromInput(
        working.value.entityAllocator,
        input.value,
        playerEntity,
        playerShotDefinition,
      );
      if (!playerShotSpawn.ok) {
        return latchFatalErrors(playerShotSpawn.errors);
      }
      if (playerShotSpawn.value) {
        if (!replaceRuntimeEntity(working.value.activeEntities, playerShotSpawn.value.player)) {
          return latchFatalErrors([
            { code: "player.notFound", message: `Player entity not found: ${playerShotSpawn.value.player.definitionId}` },
          ]);
        }
        working.value.activeEntities.push(...playerShotSpawn.value.entities);
        for (const entity of playerShotSpawn.value.entities) {
          spawnedPlayerShotEntityIds.add(entity.id);
        }
        working.value.eventLog.push(playerShotSpawn.value.event);
      }

      if (options.testingHooks.failAfterWorkingMutationTicks.delete(working.value.expectedTick)) {
        return failAfterWorkingMutationForTesting(working.value);
      }

      // system order の updateMovement / updateLifetime。player は入力で、player shot は projectile 定義で進める。
      const movedEntities = advancePlayerMovement(working.value.activeEntities, input.value);
      const advancedEntities = advancePlayerShotLifecycle(movedEntities, {
        spawnedThisTickEntityIds: spawnedPlayerShotEntityIds,
      });
      const collision = resolveCollisionAndScoring(advancedEntities, {
        collectMetrics: debugMetricsEnabled,
        playerInvincibleTicksAfterHit: options.player.life.invincibleTicksAfterHit,
        score: working.value.score,
        tick: working.value.expectedTick,
      });
      for (const event of collision.events) {
        working.value.eventLog.push(event);
      }
      const resolvedEntities = collision.entities;
      const resolvedScore = collision.score;

      // PRNG はまだ event payload に出していないが、tick ごとの消費順を先に固定しておく。
      working.value.prng.nextUint32();
      working.value.eventLog.push({ type: "tickAdvanced", tick: working.value.expectedTick });

      // frame に載せる state は renderer が保持しても安全な immutable snapshot にする。
      const orderedEntities = freezeEntitiesInIdOrder(resolvedEntities);
      const resolvedPlayer = findPlayerEntity(orderedEntities, options.player.id);
      if (!resolvedPlayer) {
        return latchFatalErrors([{ code: "player.notFound", message: `Player entity not found: ${options.player.id}` }]);
      }
      const state: ReadonlyGameState = Object.freeze({
        tick: working.value.expectedTick,
        stageId: options.stage.id,
        playerId: options.player.id,
        player: toReadonlyPlayerState(resolvedPlayer),
        score: resolvedScore,
        entities: Object.freeze(orderedEntities.map((entity) => toReadonlyEntityState(entity))),
      });
      const frameEvents = working.value.eventLog.drain();
      const frame = Object.freeze({
        tick: working.value.expectedTick,
        state,
        events: frameEvents,
      });

      committedState = createCommittedStageState({
        activeEntities: orderedEntities,
        expectedTick: working.value.expectedTick + 1,
        nextEntityId: working.value.entityAllocator.snapshot(),
        pendingEvents: [],
        prngState: working.value.prng.snapshot(),
        score: resolvedScore,
        timelineCursor: working.value.timelineCursor,
      });
      if (debugMetricsEnabled && collision.collisionCandidates !== null) {
        debugTickMetrics = createHeadlessDebugTickMetrics(collision.collisionCandidates, frameEvents);
      }
      return okResult(frame);
    },
  };
  options.testingHooks.registerHeadlessDebugStateSerializer?.(
    session,
    () => fatalErrors
      ? errorResult(fatalErrors)
      : serializeHeadlessDebugState(
        options.serializationMetadata,
        committedState,
        options.debugSeed,
        debugTickMetrics,
        options.testingHooks.failHeadlessDebugStateSerialization,
      ),
  );
  return Object.freeze(session);
}

/** committed state と process-local metrics から test-only headless dump を作る。 */
function serializeHeadlessDebugState(
  metadata: StageSessionSerializationMetadata,
  committedState: CommittedStageState,
  seed: string | null,
  metrics: HeadlessDebugTickMetrics | null,
  forceHashFailure: boolean,
): HeadlessDebugStateResult {
  const hashableState = createHashableGameState(metadata, committedState);
  if (!hashableState.ok) {
    return errorResult(hashableState.errors);
  }
  let stateHash: string;
  let prngHash: string;
  try {
    if (forceHashFailure) {
      throw new Error("injected headless debug state hash failure");
    }
    stateHash = hashHashableGameState(hashableState.value);
    prngHash = hashHashablePrngState(hashableState.value.prngState);
  } catch {
    return createHeadlessDebugStateHashError();
  }
  return okResult(Object.freeze({
    schemaVersion: "1",
    kind: "headless",
    tick: committedState.expectedTick,
    seed,
    stateHash,
    prngHash,
    entityCounts: countHeadlessDebugEntities(committedState.activeEntities),
    collisionCandidates: metrics?.collisionCandidates ?? null,
    eventCounts: metrics?.eventCounts ?? null,
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

/** 成功 tick に付随する非deterministic debug metrics を immutable snapshot にする。 */
function createHeadlessDebugTickMetrics(
  collisionCandidates: number,
  events: readonly Readonly<{ type: GameEvent["type"] }>[],
): HeadlessDebugTickMetrics {
  return Object.freeze({
    collisionCandidates,
    eventCounts: countHeadlessDebugEvents(events),
  });
}

/** committed snapshot と session metadata から public serialize DTO を生成する。 */
function serializeCommittedStageState(
  metadata: StageSessionSerializationMetadata,
  committedState: UntrustedCommittedStageState,
): CoreResult<SerializedGameState> {
  const prng = XorShift32.restore(committedState.prngState);
  if (!prng.ok) {
    return prng;
  }
  const entityInvariant = validateCommittedEntityInvariants(committedState);
  if (!entityInvariant.ok) {
    return entityInvariant;
  }
  const pendingEvents = validateCommittedPendingEventInvariants(committedState, metadata.stageId);
  if (!pendingEvents.ok) {
    return pendingEvents;
  }

  const deterministicRuntimeEntities = committedState.activeEntities.map((entity) => projectRuntimeEntityForSerializedState(entity));
  const deterministicPendingEvents = pendingEvents.value.map((event) => projectPendingEventForSerializedState(event));
  const state: SerializedDeterministicState = {
    runtimeEntities: deterministicRuntimeEntities,
    pendingEvents: deterministicPendingEvents,
    score: committedState.score,
    timelineCursor: committedState.timelineCursor,
    patternRunnerStates: [],
    enabledFeatureStates: [],
  };

  return okResult(deepFreezeClone({
    coreVersion: metadata.coreVersion,
    schemaVersion: metadata.schemaVersion,
    contentVersion: metadata.contentVersion,
    inputFormatVersion: metadata.inputFormatVersion,
    stateHashVersion: metadata.stateHashVersion,
    enabledFeatures: metadata.enabledFeatures,
    stageId: metadata.stageId,
    difficulty: metadata.difficulty,
    playerId: metadata.playerId,
    expectedTick: committedState.expectedTick,
    nextEntityId: committedState.nextEntityId,
    prngState: prng.value.snapshot(),
    state,
  }));
}

/** committed snapshot から state hash 用の正規化済み内部 DTO を生成する。 */
function createHashableGameState(
  metadata: StageSessionSerializationMetadata,
  committedState: CommittedStageState,
): CoreResult<HashableGameState> {
  const prng = XorShift32.restore(committedState.prngState);
  if (!prng.ok) {
    return prng;
  }
  const entityInvariant = validateCommittedEntityInvariants(committedState);
  if (!entityInvariant.ok) {
    return entityInvariant;
  }
  const pendingEvents = validateCommittedPendingEventInvariants(committedState, metadata.stageId);
  if (!pendingEvents.ok) {
    return pendingEvents;
  }

  return okResult(deepFreezeClone({
    stateHashVersion: metadata.stateHashVersion,
    coreVersion: metadata.coreVersion,
    schemaVersion: metadata.schemaVersion,
    expectedTick: committedState.expectedTick,
    nextEntityId: committedState.nextEntityId,
    timelineCursor: committedState.timelineCursor,
    prngState: prng.value.snapshot(),
    score: committedState.score,
    runtimeEntities: committedState.activeEntities.map((entity) => projectRuntimeEntityForHashableState(entity)),
    pendingEvents: pendingEvents.value.map((event) => projectPendingEventForHashableState(event)),
    patternRunnerStates: [],
    enabledFeatureStates: [],
  }));
}

/** serialize 専用 fault injection を committed snapshot の clone へだけ反映する。 */
function createSerializeSourceState(
  committedState: CommittedStageState,
  testingHooks: ActiveStageSessionTestingHooks,
): UntrustedCommittedStageState {
  return {
    ...committedState,
    activeEntities: testingHooks.reverseCommittedEntitiesOnSerialize
      ? [...committedState.activeEntities].reverse()
      : committedState.activeEntities,
    nextEntityId: testingHooks.overrideCommittedNextEntityIdOnSerialize ?? committedState.nextEntityId,
    pendingEvents: testingHooks.overrideCommittedPendingEventsOnSerialize === undefined
      ? committedState.pendingEvents
      : deepFreezeClone(testingHooks.overrideCommittedPendingEventsOnSerialize),
    prngState: testingHooks.overrideCommittedPrngStateOnSerialize === undefined
      ? committedState.prngState
      : testingHooks.overrideCommittedPrngStateOnSerialize,
  };
}

/** runtime entity を public serialize 用 DTO に写す。 */
function projectRuntimeEntityForSerializedState(entity: RuntimeEntityState): SerializedRuntimeEntityState {
  switch (entity.kind) {
    case "player":
      return {
        id: entity.id,
        kind: "player",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        lives: entity.lives,
        invincibleTicksRemaining: entity.invincibleTicksRemaining,
        nextShotAllowedTick: entity.nextShotAllowedTick,
        movement: { speed: entity.movement.speed, focusSpeed: entity.movement.focusSpeed },
        shotDefinitionId: entity.shotDefinitionId,
      };
    case "enemy":
      return {
        id: entity.id,
        kind: "enemy",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        hp: entity.hp,
        scoreOnKill: entity.scoreOnKill,
        pathId: entity.pathId,
        patternId: entity.patternId,
      };
    case "enemyBullet":
      return {
        id: entity.id,
        kind: "enemyBullet",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
      };
    case "playerShot":
      return {
        id: entity.id,
        kind: "playerShot",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        velocity: { x: entity.velocity.x, y: entity.velocity.y },
        remainingLifetimeTicks: entity.remainingLifetimeTicks,
        damage: entity.damage,
      };
  }
}

/** runtime entity から hash 専用 DTO へ明示的に写す。 */
function projectRuntimeEntityForHashableState(entity: RuntimeEntityState): HashableRuntimeEntityState {
  switch (entity.kind) {
    case "player":
      return {
        id: entity.id,
        kind: "player",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        lives: entity.lives,
        invincibleTicksRemaining: entity.invincibleTicksRemaining,
        nextShotAllowedTick: entity.nextShotAllowedTick,
        movement: { speed: entity.movement.speed, focusSpeed: entity.movement.focusSpeed },
        shotDefinitionId: entity.shotDefinitionId,
      };
    case "enemy":
      return {
        id: entity.id,
        kind: "enemy",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        hp: entity.hp,
        scoreOnKill: entity.scoreOnKill,
        pathId: entity.pathId,
        patternId: entity.patternId,
      };
    case "enemyBullet":
      return {
        id: entity.id,
        kind: "enemyBullet",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
      };
    case "playerShot":
      return {
        id: entity.id,
        kind: "playerShot",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        velocity: { x: entity.velocity.x, y: entity.velocity.y },
        remainingLifetimeTicks: entity.remainingLifetimeTicks,
        damage: entity.damage,
      };
  }
}

/** pending queue に残せる event を public serialize 用 DTO に写す。 */
function projectPendingEventForSerializedState(event: CommittedPendingEvent): SerializedPendingEvent {
  switch (event.type) {
    case "stageStarted":
      return {
        type: "stageStarted",
        tick: event.tick,
        stageId: event.stageId,
      };
    default:
      return assertNever(event.type);
  }
}

/** committed pending event から hash 専用 DTO へ明示的に写す。 */
function projectPendingEventForHashableState(event: CommittedPendingEvent): HashablePendingEvent {
  switch (event.type) {
    case "stageStarted":
      return {
        type: "stageStarted",
        tick: event.tick,
        stageId: event.stageId,
      };
    default:
      return assertNever(event.type);
  }
}

/** committed 側で保持する値を mutable handle なしの immutable snapshot に正規化する。 */
function createCommittedStageState(state: {
  expectedTick: number;
  activeEntities: readonly RuntimeEntityState[];
  nextEntityId: number;
  pendingEvents: readonly CommittedPendingEvent[];
  prngState: SerializedPrngState;
  score: number;
  timelineCursor: number;
}): CommittedStageState {
  const orderedEntities = freezeEntitiesInIdOrder(state.activeEntities);
  return Object.freeze({
    expectedTick: state.expectedTick,
    activeEntities: deepFreezeClone(orderedEntities),
    nextEntityId: state.nextEntityId,
    pendingEvents: deepFreezeClone(state.pendingEvents),
    prngState: deepFreezeClone(state.prngState),
    score: state.score,
    timelineCursor: state.timelineCursor,
  });
}

/** 1 tick 分の作業領域を committed snapshot から復元する。 */
function createWorkingStageState(committedState: UntrustedCommittedStageState, stageId: StageId): CoreResult<WorkingStageState> {
  const restoredPrng = XorShift32.restore(committedState.prngState);
  if (!restoredPrng.ok) {
    return restoredPrng;
  }
  const restoredAllocator = EntityAllocator.restore(committedState.nextEntityId);
  if (!restoredAllocator.ok) {
    return restoredAllocator;
  }
  const entityInvariant = validateCommittedEntityInvariants(committedState);
  if (!entityInvariant.ok) {
    return entityInvariant;
  }
  const pendingEvents = validateCommittedPendingEventInvariants(committedState, stageId);
  if (!pendingEvents.ok) {
    return pendingEvents;
  }

  const eventLog = new EventLog();
  for (const event of pendingEvents.value) {
    eventLog.push(event);
  }

  return okResult({
    activeEntities: [...deepFreezeClone(committedState.activeEntities)],
    entityAllocator: restoredAllocator.value,
    eventLog,
    expectedTick: committedState.expectedTick,
    prng: restoredPrng.value,
    score: committedState.score,
    timelineCursor: committedState.timelineCursor,
  });
}

/** 内部 invariant 破壊を fatal reason として latch できる public error に畳む。 */
function freezeFatalErrors(errors: readonly CoreError[]): readonly CoreError[] {
  const detail = errors.map((error) => `${error.code}: ${error.message}`).join("; ");
  return Object.freeze([
    Object.freeze({
      code: "stageSession.fatal" as const,
      message: `Stage session entered a fatal state: ${detail}`,
    }),
  ]);
}

/** 内部テスト用 hook を stage session ごとの消費状態へ変換する。 */
function createActiveStageSessionTestingHooks(
  testingHooks: StageSessionTestingHookOptions,
): ActiveStageSessionTestingHooks {
  return Object.freeze({
    corruptCommittedPrngStateTicks: new Set(testingHooks.corruptCommittedPrngStateTicks ?? []),
    failAfterWorkingMutationTicks: new Set(testingHooks.failAfterWorkingMutationTicks ?? []),
    overrideCommittedNextEntityIdByTick: createUniqueTickOverrideMap(
      testingHooks.overrideCommittedNextEntityIdTicks ?? [],
      (override) => override.nextEntityId,
    ),
    overrideCommittedPendingEventsByTick: createUniqueTickOverrideMap(
      testingHooks.overrideCommittedPendingEventsTicks ?? [],
      (override) => override.pendingEvents,
    ),
    reverseCommittedEntitiesOnSerialize: testingHooks.reverseCommittedEntitiesOnSerialize ?? false,
    overrideCommittedNextEntityIdOnSerialize: testingHooks.overrideCommittedNextEntityIdOnSerialize,
    overrideCommittedPendingEventsOnSerialize: testingHooks.overrideCommittedPendingEventsOnSerialize,
    overrideCommittedPrngStateOnSerialize: testingHooks.overrideCommittedPrngStateOnSerialize,
    failHeadlessDebugStateSerialization: testingHooks.failHeadlessDebugStateSerialization ?? false,
    recordCommittedStateOnFatal: testingHooks.recordCommittedStateOnFatal,
    recordHashableStateOnSerialize: testingHooks.recordHashableStateOnSerialize,
    registerHeadlessDebugStateSerializer: testingHooks.registerHeadlessDebugStateSerializer,
  });
}

/** hook fixture の重複 tick を setup 時に検出し、silent overwrite を防ぐ。 */
function createUniqueTickOverrideMap<TOverride extends Readonly<{ tick: number }>, TValue>(
  overrides: readonly TOverride[],
  selectValue: (override: TOverride) => TValue,
): Map<number, TValue> {
  const map = new Map<number, TValue>();
  for (const override of overrides) {
    if (map.has(override.tick)) {
      throw new Error(`Duplicate testing hook override tick: ${override.tick}`);
    }
    map.set(override.tick, selectValue(override));
  }
  return map;
}

/** rollback regression 用に、working state を実際に汚してから失敗させる。 */
function failAfterWorkingMutationForTesting(working: WorkingStageState): CoreResult<never> {
  const beforeEntityCount = working.activeEntities.length;
  const beforeExpectedTick = working.expectedTick;
  const beforeNextEntityId = working.entityAllocator.snapshot();
  const beforeScore = working.score;
  const beforeTimelineCursor = working.timelineCursor;
  const allocatedEntity = working.entityAllocator.create();
  if (allocatedEntity.ok && working.activeEntities[0]) {
    working.activeEntities.push({ ...working.activeEntities[0], id: allocatedEntity.value.id });
  }
  working.expectedTick += 1;
  working.eventLog.push({ type: "tickAdvanced", tick: working.expectedTick });
  working.prng.nextUint32();
  working.score += 1;
  working.timelineCursor += 1;
  return error(
    "testHook.failure",
    [
      "test hook failed after mutating working stage state",
      `entities=${beforeEntityCount}->${working.activeEntities.length}`,
      `expectedTick=${beforeExpectedTick}->${working.expectedTick}`,
      `nextEntityId=${beforeNextEntityId}->${working.entityAllocator.snapshot()}`,
      `score=${beforeScore}->${working.score}`,
      `timelineCursor=${beforeTimelineCursor}->${working.timelineCursor}`,
    ].join("; "),
  );
}

/** committed snapshot の entity id と allocator snapshot の整合性を検証する。 */
function validateCommittedEntityInvariants(committedState: UntrustedCommittedStageState): CoreResult<null> {
  const restoredAllocator = EntityAllocator.restore(committedState.nextEntityId);
  if (!restoredAllocator.ok) {
    return restoredAllocator;
  }

  const ids = new Set<number>();
  let maxEntityId = 0;
  let previousEntityId = 0;

  for (const entity of committedState.activeEntities) {
    if (!Number.isSafeInteger(entity.id) || entity.id < 1) {
      return error("entityAllocator.invalidState", "active entity id must be a positive safe integer");
    }
    if (entity.id <= previousEntityId) {
      return error("entityAllocator.invalidState", "active entity ids must be sorted in strict ascending order");
    }
    if (ids.has(entity.id)) {
      return error("entityAllocator.invalidState", `active entity id must be unique: ${entity.id}`);
    }
    ids.add(entity.id);
    maxEntityId = Math.max(maxEntityId, entity.id);
    previousEntityId = entity.id;
  }

  if (committedState.nextEntityId <= maxEntityId) {
    return error(
      "entityAllocator.invalidState",
      `nextEntityId must be greater than active entity ids: nextEntityId=${committedState.nextEntityId}, maxEntityId=${maxEntityId}`,
    );
  }

  return okResult(null);
}

/** committed snapshot に持ち越された pending event が tick と stage に整合することを検証する。 */
function validateCommittedPendingEventInvariants(
  committedState: UntrustedCommittedStageState,
  stageId: StageId,
): CoreResult<readonly CommittedPendingEvent[]> {
  const pendingEvents = committedState.pendingEvents;
  if (committedState.expectedTick === 0) {
    if (
      pendingEvents.length !== 1
      || !isCommittedStageStartedEvent(pendingEvents[0], stageId)
    ) {
      return error("stageSession.fatal", "unsupported pending event in committed state");
    }
    return okResult(Object.freeze([{ type: "stageStarted", tick: 0, stageId }]));
  }

  if (pendingEvents.length > 0) {
    return error("stageSession.fatal", "unsupported pending event in committed state");
  }
  return okResult(Object.freeze([]));
}

/** 未検証の pending event が、同 stage の stageStarted event かどうかを判定する。 */
function isCommittedStageStartedEvent(value: unknown, stageId: StageId): value is CommittedPendingEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3
    || Object.getOwnPropertySymbols(value).length > 0
    || !keys.includes("type")
    || !keys.includes("tick")
    || !keys.includes("stageId")
  ) {
    return false;
  }
  const event = value as Partial<CommittedPendingEvent>;
  return event.type === "stageStarted" && event.tick === 0 && event.stageId === stageId;
}

/** source import から test hook を誤って有効化しないための最終ガード。 */
function assertInternalTestHooksEnabled(): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.[INTERNAL_TEST_HOOKS_ENV] !== "1") {
    throw new Error(`${INTERNAL_TEST_HOOKS_ENV}=1 is required to create a hook-enabled shooting core`);
  }
}

/** active entity list から現在の自機 runtime component を探す。 */
function findPlayerEntity(
  entities: readonly RuntimeEntityState[],
  playerId: PlayerId,
): PlayerRuntimeEntity | null {
  const entity = entities.find((candidate) => candidate.kind === "player" && candidate.definitionId === playerId);
  return entity?.kind === "player" ? entity : null;
}

/** runtime player component から公開 snapshot に出す状態だけを抜き出す。 */
function toReadonlyPlayerState(player: PlayerRuntimeEntity): ReadonlyPlayerState {
  return Object.freeze({
    lives: player.lives,
    invincibleTicksRemaining: player.invincibleTicksRemaining,
  });
}

/** working entity list 内の同一 ID entity を、更新済み immutable entity へ差し替える。 */
function replaceRuntimeEntity(entities: RuntimeEntityState[], replacement: RuntimeEntityState): boolean {
  const index = entities.findIndex((entity) => entity.id === replacement.id);
  if (index < 0) {
    return false;
  }
  entities[index] = replacement;
  return true;
}

/**
 * public API 境界で受け取る stage start option を検証する。
 *
 * `load()` 以外の API も runtime adapter から呼ばれるため、壊れた入力は throw ではなく
 * `CoreResult` の失敗として返す。
 */
function parseStartStageOptions(value: unknown): CoreResult<StartStageOptions> {
  const record = asRecord(value);
  if (!record) {
    return error("startStage.invalidShape", "StartStageOptions must be an object");
  }
  if (!hasOnlyKeys(record, ["stageId", "difficulty", "playerId", "seed"])) {
    return error("startStage.invalidShape", "StartStageOptions contains unknown fields");
  }
  if (typeof record.stageId !== "string") {
    return error("startStage.invalidShape", "stageId must be a string");
  }
  if (!isNamespacedId(record.stageId, "stage")) {
    return error("startStage.invalidShape", "stageId must use the stage.* namespace");
  }
  if (record.difficulty !== "normal" && record.difficulty !== "hard") {
    return error("startStage.invalidShape", "difficulty must be normal or hard");
  }
  if (typeof record.seed !== "string") {
    return error("startStage.invalidShape", "seed must be a string");
  }
  if (record.seed.trim().length === 0 || record.seed.length > MAX_SEED_LENGTH) {
    return error("startStage.invalidShape", `seed must be a non-empty string up to ${MAX_SEED_LENGTH} characters`);
  }
  if (record.playerId !== undefined && typeof record.playerId !== "string") {
    return error("startStage.invalidShape", "playerId must be a string when provided");
  }
  if (typeof record.playerId === "string" && !isNamespacedId(record.playerId, "player")) {
    return error("startStage.invalidShape", "playerId must use the player.* namespace");
  }
  return okResult(deepFreezeClone({
    stageId: record.stageId as StageId,
    difficulty: record.difficulty,
    playerId: record.playerId as PlayerId | undefined,
    seed: record.seed,
  }));
}

/** core / schema mismatch を現行 schema の key set より先に分類するための metadata だけを読む。 */
function parseRestoreSchemaMetadata(value: unknown): CoreResult<RestoreSchemaMetadata> {
  const coreVersion = readRestoreTopLevelDataProperty(value, "coreVersion");
  if (!coreVersion.ok) {
    return coreVersion;
  }
  if (!isRestoreTopLevelString(coreVersion.value)) {
    return error("state.invalidShape", "coreVersion must be a string");
  }

  const schemaVersion = readRestoreTopLevelDataProperty(value, "schemaVersion");
  if (!schemaVersion.ok) {
    return schemaVersion;
  }
  if (!isRestoreTopLevelString(schemaVersion.value)) {
    return error("state.invalidShape", "schemaVersion must be a string");
  }

  return okResult(Object.freeze({
    coreVersion: coreVersion.value,
    schemaVersion: schemaVersion.value,
  }));
}

/**
 * restore の early compatibility check 用に top-level data property だけを読む。
 *
 * schema mismatch を未知 field や deep payload shape より先に返したい一方で、
 * getter / Proxy を発火させて public API 境界から例外を漏らさないための helper。
 */
function readRestoreTopLevelDataProperty(value: unknown, key: RestoreTopLevelField): CoreResult<unknown> {
  try {
    if (!isPlainObjectContainer(value)) {
      return error("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      return error("state.invalidShape", `${key} must be provided`);
    }
    if (!("value" in descriptor) || !descriptor.enumerable) {
      return error("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }

    return okResult(descriptor.value);
  } catch {
    return error("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
  }
}

/** top-level string metadata を field 単位で読む。 */
function parseRestoreTopLevelStringField(
  record: Record<string, unknown>,
  key: keyof Pick<SerializedGameState, "contentVersion" | "inputFormatVersion" | "stageId" | "playerId">,
): CoreResult<string> {
  if (!isRestoreTopLevelString(record[key])) {
    return error("state.invalidShape", `${key} must be a string`);
  }

  return okResult(record[key]);
}

/** state hash version を field 単位で読む。 */
function parseRestoreStateHashVersion(record: Record<string, unknown>): CoreResult<number> {
  if (typeof record.stateHashVersion !== "number" || !Number.isSafeInteger(record.stateHashVersion)) {
    return error("state.invalidShape", "stateHashVersion must be a safe integer");
  }

  return okResult(record.stateHashVersion);
}

/** content / feature mismatch を payload container shape より先に分類するための metadata を読む。 */
function parseRestoreCompatibilityMetadata(
  record: Record<string, unknown>,
  metadata: RestoreVersionMetadata,
): CoreResult<RestoreCompatibilityMetadata> {
  const contentVersion = parseRestoreTopLevelStringField(record, "contentVersion");
  if (!contentVersion.ok) {
    return contentVersion;
  }
  const enabledFeatures = parseRestoreEnabledFeatures(record.enabledFeatures);
  if (!enabledFeatures.ok) {
    return enabledFeatures;
  }
  const featureContract = validateRestoreEnabledFeatureContract(enabledFeatures.value);
  if (!featureContract.ok) {
    return featureContract;
  }
  const stageId = parseRestoreTopLevelStringField(record, "stageId");
  if (!stageId.ok) {
    return stageId;
  }
  if (!isNamespacedId(stageId.value, "stage")) {
    return error("state.invalidShape", "stageId must use the stage.* namespace");
  }
  if (record.difficulty !== "normal" && record.difficulty !== "hard") {
    return error("state.invalidShape", "difficulty must be normal or hard");
  }
  const playerId = parseRestoreTopLevelStringField(record, "playerId");
  if (!playerId.ok) {
    return playerId;
  }
  if (!isNamespacedId(playerId.value, "player")) {
    return error("state.invalidShape", "playerId must use the player.* namespace");
  }

  return okResult(Object.freeze({
    ...metadata,
    contentVersion: contentVersion.value,
    enabledFeatures: enabledFeatures.value,
    stageId: stageId.value as StageId,
    difficulty: record.difficulty,
    playerId: playerId.value as PlayerId,
  }));
}

/** 現行 schema の top-level metadata と deterministic payload container の最小 shape を検証する。 */
function parseRestoreTopLevelState(
  value: unknown,
  metadata: RestoreVersionMetadata,
  compatibilityMetadata: RestoreCompatibilityMetadata,
): CoreResult<RestoreTopLevelState> {
  const record = asRecord(value);
  if (!record) {
    return error("state.invalidShape", "SerializedGameState must be an object");
  }
  if (!hasOnlyKeys(record, RESTORE_TOP_LEVEL_KEYS)) {
    return error("state.invalidShape", "SerializedGameState contains unknown top-level fields");
  }
  if (typeof record.expectedTick !== "number" || !Number.isSafeInteger(record.expectedTick) || record.expectedTick < 0) {
    return error("state.invalidShape", "expectedTick must be a non-negative safe integer");
  }
  if (
    typeof record.nextEntityId !== "number"
    || !Number.isSafeInteger(record.nextEntityId)
    || record.nextEntityId < 1
    || record.nextEntityId > MAX_RESTORABLE_NEXT_ENTITY_ID
  ) {
    return error("state.invalidShape", "nextEntityId must be a positive safe integer");
  }
  if (!isPlainObjectContainer(record.prngState)) {
    return error("state.invalidShape", "prngState must be an object");
  }
  if (!isPlainObjectContainer(record.state)) {
    return error("state.invalidShape", "state must be an object");
  }

  return okResult(Object.freeze({
    ...metadata,
    enabledFeatures: compatibilityMetadata.enabledFeatures,
    stageId: compatibilityMetadata.stageId,
    difficulty: compatibilityMetadata.difficulty,
    playerId: compatibilityMetadata.playerId,
    expectedTick: record.expectedTick,
    nextEntityId: record.nextEntityId,
    prngState: record.prngState,
    state: record.state,
  }));
}

/** core / schema mismatch は現行 schema の key set や詳細 shape より先に分類する。 */
function validateRestoreSchemaCompatibility(
  state: RestoreSchemaMetadata,
  content: LoadedContentIndex,
  coreVersion: string,
): CoreResult<null> {
  if (state.coreVersion !== coreVersion) {
    return error("state.coreVersionMismatch", `coreVersion mismatch: expected ${coreVersion}, got ${state.coreVersion}`);
  }
  if (state.schemaVersion !== content.definition.schemaVersion) {
    return error("state.schemaVersionMismatch", `schemaVersion mismatch: expected ${content.definition.schemaVersion}, got ${state.schemaVersion}`);
  }

  return okResult(null);
}

/** input format mismatch は現行 schema の key set や後続 metadata より先に分類する。 */
function validateRestoreInputFormatCompatibility(inputFormatVersion: string): CoreResult<null> {
  if (inputFormatVersion !== SERIALIZED_INPUT_FORMAT_VERSION) {
    return error("state.inputFormatVersionMismatch", `inputFormatVersion mismatch: expected ${SERIALIZED_INPUT_FORMAT_VERSION}, got ${inputFormatVersion}`);
  }

  return okResult(null);
}

/** state hash version mismatch は現行 schema の key set や後続 metadata より先に分類する。 */
function validateRestoreStateHashVersionCompatibility(stateHashVersion: number): CoreResult<null> {
  if (stateHashVersion !== SERIALIZED_STATE_HASH_VERSION) {
    return error("state.stateHashVersionMismatch", `stateHashVersion mismatch: expected ${SERIALIZED_STATE_HASH_VERSION}, got ${stateHashVersion}`);
  }

  return okResult(null);
}

/** content version mismatch は deterministic payload container shape より先に分類する。 */
function validateRestoreContentVersionCompatibility(
  contentVersion: string,
  content: LoadedContentIndex,
): CoreResult<null> {
  if (contentVersion !== content.definition.content.version) {
    return error("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }

  return okResult(null);
}

/** public error に閉じ込める current schema の content 互換性を検査する。 */
function validateRestoreContentCompatibility(
  state: RestoreCompatibilityMetadata,
  content: LoadedContentIndex,
): CoreResult<null> {
  if (!content.stagesById.has(state.stageId)
    || !content.playersById.has(state.playerId)
    || !content.stagesById.get(state.stageId)!.difficulties.includes(state.difficulty)
  ) {
    return error("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }
  const enabledFeatures = canonicalizeEnabledFeatures(content.definition.enabledFeatures);
  if (!sameOrderedValues(state.enabledFeatures, enabledFeatures)) {
    return error("state.featureMismatch", "enabledFeatures do not match the loaded content");
  }

  return okResult(null);
}

/** PRNG の復元失敗を LoadedGame.restore 用の public error に包み、committed snapshot 用に正規化する。 */
function validateRestorePrngSnapshot(prngState: unknown): CoreResult<SerializedPrngState> {
  const state = cloneRestorePlainRecord(prngState, "prngState", ["state"]);
  if (!state.ok) {
    return state;
  }
  const prng = XorShift32.restore(state.value);
  if (!prng.ok) {
    return error("state.prngInvalid", "prngState cannot be restored by the PRNG");
  }

  return okResult(prng.value.snapshot());
}

/** deterministic payload を検証し、committed 変換前 DTO へ正規化する。 */
function parseRestoreDeterministicPayload(
  state: RestoreTopLevelState,
  content: LoadedContentIndex,
): CoreResult<ValidatedRestoreDeterministicPayload> {
  const record = cloneRestorePlainRecord(state.state, "state", [
    "runtimeEntities",
    "pendingEvents",
    "score",
    "timelineCursor",
    "patternRunnerStates",
    "enabledFeatureStates",
  ]);
  if (!record.ok) {
    return record;
  }

  const runtimeEntities = cloneRestoreArray(
    record.value.runtimeEntities,
    "state.runtimeEntities",
    MAX_RESTORE_RUNTIME_ENTITIES_LENGTH,
  );
  if (!runtimeEntities.ok) {
    return runtimeEntities;
  }
  const initialEnvelope = validateRestoreInitialRuntimeEntityEnvelope(state, runtimeEntities.value.length);
  if (!initialEnvelope.ok) {
    return initialEnvelope;
  }
  const pendingEvents = cloneRestoreArray(record.value.pendingEvents, "state.pendingEvents");
  if (!pendingEvents.ok) {
    return pendingEvents;
  }
  const patternRunnerStates = cloneRestoreArray(
    record.value.patternRunnerStates,
    "state.patternRunnerStates",
    MAX_RESTORE_EXTENSION_STATES_LENGTH,
  );
  if (!patternRunnerStates.ok) {
    return patternRunnerStates;
  }
  const enabledFeatureStates = cloneRestoreArray(
    record.value.enabledFeatureStates,
    "state.enabledFeatureStates",
    MAX_RESTORE_EXTENSION_STATES_LENGTH,
  );
  if (!enabledFeatureStates.ok) {
    return enabledFeatureStates;
  }

  if (
    typeof record.value.score !== "number"
    || !Number.isSafeInteger(record.value.score)
    || record.value.score < 0
  ) {
    return error("state.invalidShape", "state.score must be a non-negative safe integer");
  }
  if (state.expectedTick === 0 && record.value.score !== 0) {
    return error("state.invalidShape", "initial restore state score must be zero");
  }
  const stage = content.stagesById.get(state.stageId);
  if (!stage) {
    return error("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }
  if (
    typeof record.value.timelineCursor !== "number"
    || !Number.isSafeInteger(record.value.timelineCursor)
    || record.value.timelineCursor < 0
    || record.value.timelineCursor > stage.timeline.length
  ) {
    return error("state.invalidShape", "state.timelineCursor must be within the stage timeline range");
  }
  const expectedTimelineCursor = findExpectedTimelineCursor(stage, state.expectedTick);
  if (record.value.timelineCursor !== expectedTimelineCursor) {
    return error("state.invalidShape", "state.timelineCursor must match expectedTick");
  }
  const pendingEventsContract = validateRestorePendingEvents(state, pendingEvents.value);
  if (!pendingEventsContract.ok) {
    return pendingEventsContract;
  }
  const runtimeEntitiesContract = validateRestoreRuntimeEntities(
    state,
    runtimeEntities.value,
    content,
    stage,
    record.value.timelineCursor,
  );
  if (!runtimeEntitiesContract.ok) {
    return runtimeEntitiesContract;
  }
  const extensionPayloadBudget = createRestoreJsonBudget();
  const patternRunnerStateContract = validateRestorePatternRunnerStates(
    patternRunnerStates.value,
    extensionPayloadBudget,
  );
  if (!patternRunnerStateContract.ok) {
    return patternRunnerStateContract;
  }
  const enabledFeatureStateContract = validateRestoreEnabledFeatureStates(
    enabledFeatureStates.value,
    extensionPayloadBudget,
  );
  if (!enabledFeatureStateContract.ok) {
    return enabledFeatureStateContract;
  }
  if (patternRunnerStates.value.length > 0) {
    return error("state.featureMismatch", "state.patternRunnerStates require a compatible pattern runner module");
  }
  if (enabledFeatureStates.value.length > 0) {
    return error("state.featureMismatch", "state.enabledFeatureStates require enabled feature modules");
  }

  return okResult(Object.freeze({
    activeEntities: runtimeEntitiesContract.value,
    enabledFeatureStates: enabledFeatureStateContract.value,
    pendingEvents: pendingEventsContract.value,
    patternRunnerStates: patternRunnerStateContract.value,
    score: record.value.score,
    timelineCursor: record.value.timelineCursor,
  }));
}

/** 検証済み restore DTO を session 初期状態へ変換し、既存 serialize 経路で再検証する。 */
function createRestoreCommittedState(
  state: RestoreTopLevelState,
  payload: ValidatedRestoreDeterministicPayload,
  prngState: SerializedPrngState,
  metadata: StageSessionSerializationMetadata,
): CoreResult<Readonly<{
  committedState: CommittedStageState;
  serializedSnapshot: SerializedGameState;
}>> {
  const committedState = toRestoreCommittedStageState(state, payload, prngState);
  const committedSnapshot = serializeCommittedStageState(metadata, committedState);
  if (!committedSnapshot.ok) {
    return error("state.invalidShape", "SerializedGameState deterministic payload cannot be committed");
  }

  return okResult(Object.freeze({
    committedState,
    serializedSnapshot: committedSnapshot.value,
  }));
}

/** 検証済み restore DTO を committed snapshot へ変換する。 */
function toRestoreCommittedStageState(
  state: RestoreTopLevelState,
  payload: ValidatedRestoreDeterministicPayload,
  prngState: SerializedPrngState,
): CommittedStageState {
  return createCommittedStageState({
    activeEntities: payload.activeEntities,
    expectedTick: state.expectedTick,
    nextEntityId: state.nextEntityId,
    pendingEvents: payload.pendingEvents,
    prngState,
    score: payload.score,
    timelineCursor: payload.timelineCursor,
  });
}

/** startStage 直後の snapshot だけが持つ entity 数と nextEntityId の不変条件を検証する。 */
function validateRestoreInitialRuntimeEntityEnvelope(
  state: RestoreTopLevelState,
  runtimeEntityCount: number,
): CoreResult<null> {
  if (state.expectedTick === 0 && (runtimeEntityCount !== 1 || state.nextEntityId !== 2)) {
    return error("state.invalidShape", "initial restore state must contain only the initial player entity");
  }

  return okResult(null);
}

/** expectedTick 時点で未処理であるべき最初の timeline index を計算する。 */
function findExpectedTimelineCursor(stage: StageDefinition, expectedTick: number): number {
  const index = stage.timeline.findIndex((step) => step.tick >= expectedTick);
  return index === -1 ? stage.timeline.length : index;
}

/** pendingEvents は startStage 直後の stageStarted 再通知だけを許可する。 */
function validateRestorePendingEvents(
  state: RestoreTopLevelState,
  pendingEvents: readonly unknown[],
): CoreResult<readonly CommittedPendingEvent[]> {
  if (state.expectedTick > 0) {
    if (pendingEvents.length !== 0) {
      return error("state.invalidShape", "state.pendingEvents must be empty after tick 0");
    }
    return okResult(Object.freeze([]));
  }
  if (pendingEvents.length !== 1) {
    return error("state.invalidShape", "state.pendingEvents must contain stageStarted at tick 0");
  }
  const event = cloneRestorePlainRecord(pendingEvents[0], "state.pendingEvents[0]", ["type", "tick", "stageId"]);
  if (!event.ok) {
    return event;
  }
  if (event.value.type !== "stageStarted" || event.value.tick !== 0 || event.value.stageId !== state.stageId) {
    return error("state.invalidShape", "state.pendingEvents[0] must be stageStarted for the restored stage");
  }

  return okResult(Object.freeze([{ type: "stageStarted", tick: 0, stageId: state.stageId }]));
}

/** runtimeEntities の ID order、kind 別 shape、registry reference を検証する。 */
function validateRestoreRuntimeEntities(
  state: RestoreTopLevelState,
  entities: readonly unknown[],
  content: LoadedContentIndex,
  stage: StageDefinition,
  timelineCursor: number,
): CoreResult<readonly RuntimeEntityState[]> {
  const spawnBudget = createRestoreSpawnBudget(stage, timelineCursor, content);
  if (!spawnBudget.ok) {
    return spawnBudget;
  }
  const allocationEnvelope = validateRestoreAllocationEnvelope(state, spawnBudget.value);
  if (!allocationEnvelope.ok) {
    return allocationEnvelope;
  }
  let previousEntityId = 0;
  let playerEntityCount = 0;
  let matchingPlayerEntityCount = 0;
  const activeEnemyMatches: RestoreMatchedSpawn[] = [];
  const activeEnemyBulletMatches: RestoreMatchedSpawn[] = [];
  const activePlayerShotMatches: RestoreMatchedPlayerShot[] = [];
  const activeEntities: RuntimeEntityState[] = [];
  for (let index = 0; index < entities.length; index += 1) {
    const entity = cloneRestorePlainRecord(entities[index], `state.runtimeEntities[${index}]`, RESTORE_RUNTIME_ENTITY_ALL_KEYS);
    if (!entity.ok) {
      return entity;
    }
    const common = validateRestoreRuntimeEntityCommon(entity.value, previousEntityId, state.nextEntityId, index);
    if (!common.ok) {
      return common;
    }
    previousEntityId = common.value.id;

    const entityKind = common.value.kind;
    switch (entityKind) {
      case "player": {
        playerEntityCount += 1;
        if (entity.value.definitionId === state.playerId) {
          matchingPlayerEntityCount += 1;
        }
        if (common.value.id !== 1) {
          return error("state.invalidShape", "player runtime entity id must be the initial entity id");
        }
        const player = validateRestorePlayerRuntimeEntity(entity.value, common.value, content, state.expectedTick);
        if (!player.ok) {
          return player;
        }
        if (state.expectedTick === 0) {
          const initialPlayer = validateRestoreInitialPlayerEntity(player.value, content);
          if (!initialPlayer.ok) {
            return initialPlayer;
          }
        }
        activeEntities.push(player.value);
        break;
      }
      case "enemy": {
        const enemy = validateRestoreEnemyRuntimeEntity(entity.value, common.value, content);
        if (!enemy.ok) {
          return enemy;
        }
        const budget = consumeRestoreEnemySpawnBudget(spawnBudget.value.enemySpawnCandidates, entity.value, common.value.position);
        if (!budget.ok) {
          return budget;
        }
        activeEnemyMatches.push(budget.value);
        activeEntities.push(enemy.value);
        break;
      }
      case "enemyBullet": {
        const bullet = validateRestoreEnemyBulletRuntimeEntity(entity.value, common.value, content);
        if (!bullet.ok) {
          return bullet;
        }
        const budget = consumeRestoreEnemyBulletBudget(spawnBudget.value.enemyBulletCandidates, entity.value, common.value.position);
        if (!budget.ok) {
          return budget;
        }
        activeEnemyBulletMatches.push(budget.value);
        activeEntities.push(bullet.value);
        break;
      }
      case "playerShot": {
        const shot = validateRestorePlayerShotRuntimeEntity(entity.value, common.value, content, state.expectedTick);
        if (!shot.ok) {
          return shot;
        }
        activePlayerShotMatches.push(Object.freeze({ id: common.value.id, spawnTick: shot.value.spawnTick }));
        activeEntities.push(shot.value.entity);
        break;
      }
      default:
        assertNever(entityKind);
    }
  }
  if (playerEntityCount !== 1 || matchingPlayerEntityCount !== 1) {
    return error("state.invalidShape", "state.runtimeEntities must contain exactly one player matching playerId");
  }
  const sameTickOrder = validateRestoreSameTickAllocationOrder(
    activeEnemyMatches,
    activeEnemyBulletMatches,
    activePlayerShotMatches,
  );
  if (!sameTickOrder.ok) {
    return sameTickOrder;
  }

  return okResult(Object.freeze(activeEntities));
}

/** pattern runner extension state の shape、順序、payload JSON 互換性を検証する。 */
function validateRestorePatternRunnerStates(
  states: readonly unknown[],
  budget: RestoreJsonBudget,
): CoreResult<readonly ValidatedRestorePatternRunnerState[]> {
  let previousRunnerId: string | null = null;
  const validatedStates: ValidatedRestorePatternRunnerState[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const state = cloneRestorePlainRecord(
      states[index],
      `state.patternRunnerStates[${index}]`,
      RESTORE_PATTERN_RUNNER_STATE_KEYS,
    );
    if (!state.ok) {
      return state;
    }
    if (typeof state.value.runnerId !== "string" || !isValidPatternRunnerId(state.value.runnerId)) {
      return error("state.invalidShape", "pattern runner state runnerId must be patternRunner.* with a non-empty suffix");
    }
    if (previousRunnerId !== null && compareUtf8Lexicographic(previousRunnerId, state.value.runnerId) >= 0) {
      return error("state.invalidShape", "state.patternRunnerStates must be ordered by unique runnerId");
    }
    previousRunnerId = state.value.runnerId;
    if (typeof state.value.patternId !== "string" || !isNamespacedId(state.value.patternId, "pattern")) {
      return error("state.invalidShape", "pattern runner state patternId must be a valid pattern id");
    }
    if (!isPositiveSafeInteger(state.value.stateVersion)) {
      return error("state.invalidShape", "pattern runner stateVersion must be a positive safe integer");
    }
    const payload = validateRestoreJsonPayload(
      state.value.payload,
      `state.patternRunnerStates[${index}].payload`,
      budget,
    );
    if (!payload.ok) {
      return payload;
    }
    validatedStates.push(Object.freeze({
      runnerId: state.value.runnerId as SerializedPatternRunnerState["runnerId"],
      patternId: state.value.patternId as SerializedPatternRunnerState["patternId"],
      stateVersion: state.value.stateVersion,
      payload: payload.value,
    }));
  }

  return okResult(Object.freeze(validatedStates));
}

/** enabled feature extension state の shape、順序、payload JSON 互換性を検証する。 */
function validateRestoreEnabledFeatureStates(
  states: readonly unknown[],
  budget: RestoreJsonBudget,
): CoreResult<readonly ValidatedRestoreEnabledFeatureState[]> {
  const validatedStates: ValidatedRestoreEnabledFeatureState[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const state = cloneRestorePlainRecord(
      states[index],
      `state.enabledFeatureStates[${index}]`,
      RESTORE_ENABLED_FEATURE_STATE_KEYS,
    );
    if (!state.ok) {
      return state;
    }
    if (
      typeof state.value.feature !== "string"
      || !isRestoreJsonStringWithinSingleValueBudget(state.value.feature)
    ) {
      return error("state.invalidShape", "enabled feature state feature must be a restore-safe string");
    }
    if (!isPositiveSafeInteger(state.value.stateVersion)) {
      return error("state.invalidShape", "enabled feature stateVersion must be a positive safe integer");
    }
    const payload = validateRestoreJsonPayload(
      state.value.payload,
      `state.enabledFeatureStates[${index}].payload`,
      budget,
    );
    if (!payload.ok) {
      return payload;
    }
    validatedStates.push(Object.freeze({
      feature: state.value.feature as SerializedEnabledFeatureState["feature"],
      stateVersion: state.value.stateVersion,
      payload: payload.value,
    }));
  }

  return okResult(Object.freeze(validatedStates));
}

/** pattern runner id は namespace prefix と空でない suffix を runtime でも保証する。 */
function isValidPatternRunnerId(value: string): boolean {
  return value.startsWith("patternRunner.")
    && value.length > "patternRunner.".length
    && isRestoreJsonStringWithinSingleValueBudget(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

type RestoreSpawnBudget = Readonly<{
  enemySpawnCandidates: RestoreEnemySpawnCandidate[];
  enemyBulletCandidates: RestoreEnemyBulletCandidate[];
}>;

type RestoreEnemySpawnCandidate = Readonly<{
  tick: number;
  allocationOrder: number;
  definitionId: string;
  pathId: string;
  patternId: string;
  position: Readonly<{ x: number; y: number }>;
}>;

type RestoreEnemyBulletCandidate = Readonly<{
  tick: number;
  allocationOrder: number;
  definitionId: string;
  position: Readonly<{ x: number; y: number }>;
}>;

type RestoreMatchedSpawn = Readonly<{
  id: number;
  tick: number;
  allocationOrder: number;
}>;

type RestoreMatchedPlayerShot = Readonly<{
  id: number;
  spawnTick: number;
}>;

type RestoreRuntimeEntityCommon = Readonly<{
  id: number;
  kind: SerializedRuntimeEntityState["kind"];
  position: Readonly<{ x: number; y: number }>;
}>;

type RestorePlayerShotValidation = Readonly<{
  entity: PlayerShotRuntimeEntity;
  spawnTick: number;
}>;

/** 処理済み timeline step から存在し得る enemy / enemyBullet の上限を作る。 */
function createRestoreSpawnBudget(
  stage: StageDefinition,
  timelineCursor: number,
  content: LoadedContentIndex,
): CoreResult<RestoreSpawnBudget> {
  const enemySpawnCandidates: RestoreEnemySpawnCandidate[] = [];
  const enemyBulletCandidates: RestoreEnemyBulletCandidate[] = [];
  for (let index = 0; index < timelineCursor; index += 1) {
    const step = stage.timeline[index];
    if (!step || step.action.type !== "spawnEnemy") {
      continue;
    }
    enemySpawnCandidates.push({
      tick: step.tick,
      allocationOrder: enemySpawnCandidates.length,
      definitionId: step.action.enemy,
      pathId: step.action.path,
      patternId: step.action.pattern,
      position: Object.freeze({ x: step.action.position.x, y: step.action.position.y }),
    });

    const pattern = content.patternsById.get(step.action.pattern);
    if (!pattern) {
      return error("state.registryInvalid", "stage timeline references an unknown pattern");
    }
    if (pattern.fireOnSpawn) {
      const position = resolveEnemyBulletSpawnPosition(
        "restore",
        step.action.position,
        pattern.id,
        pattern.fireOnSpawn,
      );
      if (!position.ok) {
        return error("state.registryInvalid", "stage timeline contains an invalid enemy bullet spawn position");
      }
      enemyBulletCandidates.push({
        tick: step.tick,
        allocationOrder: enemyBulletCandidates.length,
        definitionId: pattern.fireOnSpawn.bullet,
        position: position.value,
      });
    }
  }

  return okResult(Object.freeze({ enemySpawnCandidates, enemyBulletCandidates }));
}

/** nextEntityId が processed timeline と入力由来 shot の最大生成数から到達可能な範囲か検証する。 */
function validateRestoreAllocationEnvelope(
  state: RestoreTopLevelState,
  spawnBudget: RestoreSpawnBudget,
): CoreResult<null> {
  const maxPlayerShotAllocations = state.expectedTick;
  const maxReachableNextEntityId = 2
    + spawnBudget.enemySpawnCandidates.length
    + spawnBudget.enemyBulletCandidates.length
    + maxPlayerShotAllocations;
  if (state.nextEntityId > maxReachableNextEntityId) {
    return error("state.invalidShape", "nextEntityId exceeds the deterministic allocation envelope");
  }

  return okResult(null);
}

/** active enemy が処理済み timeline の spawn と同じ参照・位置から来ていることを検証する。 */
function consumeRestoreEnemySpawnBudget(
  candidates: RestoreEnemySpawnCandidate[],
  entity: Record<string, unknown>,
  position: Readonly<{ x: number; y: number }>,
): CoreResult<RestoreMatchedSpawn> {
  const index = candidates.findIndex((candidate) => (
    candidate.definitionId === entity.definitionId
    && candidate.pathId === entity.pathId
    && candidate.patternId === entity.patternId
    && isSameRestorePosition(candidate.position, position)
  ));
  if (index === -1) {
    return error("state.invalidShape", "enemy runtime entity must originate from a processed timeline spawn");
  }
  const [candidate] = candidates.splice(index, 1);
  if (!candidate) {
    return error("state.invalidShape", "enemy runtime entity must originate from a processed timeline spawn");
  }

  return okResult(Object.freeze({
    id: Number(entity.id),
    tick: candidate.tick,
    allocationOrder: candidate.allocationOrder,
  }));
}

/** active enemyBullet が処理済み fireOnSpawn と同じ弾・位置から来ていることを検証する。 */
function consumeRestoreEnemyBulletBudget(
  candidates: RestoreEnemyBulletCandidate[],
  entity: Record<string, unknown>,
  position: Readonly<{ x: number; y: number }>,
): CoreResult<RestoreMatchedSpawn> {
  const index = candidates.findIndex((candidate) => (
    candidate.definitionId === entity.definitionId
    && isSameRestorePosition(candidate.position, position)
  ));
  if (index === -1) {
    return error("state.invalidShape", "enemy bullet runtime entity must originate from a processed timeline spawn");
  }
  const [candidate] = candidates.splice(index, 1);
  if (!candidate) {
    return error("state.invalidShape", "enemy bullet runtime entity must originate from a processed timeline spawn");
  }

  return okResult(Object.freeze({
    id: Number(entity.id),
    tick: candidate.tick,
    allocationOrder: candidate.allocationOrder,
  }));
}

/** restore entity の position が timeline 由来の位置と完全一致することを検証する。 */
function isSameRestorePosition(
  expected: Readonly<{ x: number; y: number }>,
  actual: Readonly<{ x: number; y: number }>,
): boolean {
  return actual.x === expected.x && actual.y === expected.y;
}

/** 同じ tick では enemy、enemyBullet、playerShot の順に採番されることを検証する。 */
function validateRestoreSameTickAllocationOrder(
  enemies: readonly RestoreMatchedSpawn[],
  enemyBullets: readonly RestoreMatchedSpawn[],
  playerShots: readonly RestoreMatchedPlayerShot[],
): CoreResult<null> {
  const enemyOrder = validateRestoreSameKindAllocationOrder(enemies, "enemy");
  if (!enemyOrder.ok) {
    return enemyOrder;
  }
  const bulletOrder = validateRestoreSameKindAllocationOrder(enemyBullets, "enemy bullet");
  if (!bulletOrder.ok) {
    return bulletOrder;
  }

  for (const bullet of enemyBullets) {
    for (const enemy of enemies) {
      if (bullet.tick === enemy.tick && bullet.id < enemy.id) {
        return error("state.invalidShape", "enemy bullet id must follow same-tick enemy allocations");
      }
    }
  }
  for (const shot of playerShots) {
    for (const enemy of enemies) {
      if (shot.spawnTick === enemy.tick && shot.id < enemy.id) {
        return error("state.invalidShape", "player shot id must follow same-tick enemy allocations");
      }
    }
    for (const bullet of enemyBullets) {
      if (shot.spawnTick === bullet.tick && shot.id < bullet.id) {
        return error("state.invalidShape", "player shot id must follow same-tick enemy bullet allocations");
      }
    }
  }

  const crossTickOrder = validateRestoreCrossTickAllocationOrder(enemies, enemyBullets, playerShots);
  if (!crossTickOrder.ok) {
    return crossTickOrder;
  }

  return okResult(null);
}

/** 同 kind / 同 tick の entity id が runtime の allocation order と同じ順序か検証する。 */
function validateRestoreSameKindAllocationOrder(
  matches: readonly RestoreMatchedSpawn[],
  label: "enemy" | "enemy bullet",
): CoreResult<null> {
  const latestOrderByTick = new Map<number, number>();
  for (const match of matches) {
    const latestOrder = latestOrderByTick.get(match.tick);
    if (latestOrder !== undefined && match.allocationOrder <= latestOrder) {
      return error("state.invalidShape", `${label} runtime entity ids must follow same-tick allocation order`);
    }
    latestOrderByTick.set(match.tick, match.allocationOrder);
  }

  return okResult(null);
}

/** active entity id の昇順が tick をまたいだ allocator の生成順と一致することを検証する。 */
function validateRestoreCrossTickAllocationOrder(
  enemies: readonly RestoreMatchedSpawn[],
  enemyBullets: readonly RestoreMatchedSpawn[],
  playerShots: readonly RestoreMatchedPlayerShot[],
): CoreResult<null> {
  const allocations = [
    ...enemies.map((enemy) => ({
      id: enemy.id,
      tick: enemy.tick,
      phase: 0,
      allocationOrder: enemy.allocationOrder,
    })),
    ...enemyBullets.map((bullet) => ({
      id: bullet.id,
      tick: bullet.tick,
      phase: 1,
      allocationOrder: bullet.allocationOrder,
    })),
    ...playerShots.map((shot) => ({
      id: shot.id,
      tick: shot.spawnTick,
      phase: 2,
      allocationOrder: 0,
    })),
  ].sort((left, right) => left.id - right.id);

  let previous: (typeof allocations)[number] | null = null;
  for (const allocation of allocations) {
    if (previous && compareRestoreAllocationOrder(previous, allocation) >= 0) {
      return error("state.invalidShape", "runtime entity ids must follow deterministic allocation order across ticks");
    }
    previous = allocation;
  }

  return okResult(null);
}

/** tick、system phase、同 phase 内 order の順で allocator 順序を比較する。 */
function compareRestoreAllocationOrder(
  left: Readonly<{ tick: number; phase: number; allocationOrder: number }>,
  right: Readonly<{ tick: number; phase: number; allocationOrder: number }>,
): number {
  return left.tick - right.tick
    || left.phase - right.phase
    || left.allocationOrder - right.allocationOrder;
}

/** startStage 直後の player snapshot が一意な初期値と一致することを検証する。 */
function validateRestoreInitialPlayerEntity(
  entity: PlayerRuntimeEntity,
  content: LoadedContentIndex,
): CoreResult<null> {
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return error("state.registryInvalid", "player runtime entity references an unknown player");
  }
  if (
    !isSameRestorePosition(DEFAULT_PLAYER_START_POSITION, entity.position)
    || entity.lives !== player.life.initialLives
    || entity.invincibleTicksRemaining !== 0
    || entity.nextShotAllowedTick !== 0
  ) {
    return error("state.invalidShape", "initial player runtime entity must match startStage defaults");
  }

  return okResult(null);
}

/** runtime entity 共通 field と ID order contract を検証する。 */
function validateRestoreRuntimeEntityCommon(
  entity: Record<string, unknown>,
  previousEntityId: number,
  nextEntityId: number,
  index: number,
): CoreResult<RestoreRuntimeEntityCommon> {
  if (
    typeof entity.id !== "number"
    || !Number.isSafeInteger(entity.id)
    || entity.id <= 0
    || entity.id <= previousEntityId
    || entity.id >= nextEntityId
  ) {
    return error("state.invalidShape", `state.runtimeEntities[${index}].id must be positive, ascending, and below nextEntityId`);
  }
  if (!isRestoreRuntimeEntityKind(entity.kind)) {
    return error("state.invalidShape", `state.runtimeEntities[${index}].kind is not supported`);
  }
  if (!isRestoreTopLevelString(entity.definitionId)) {
    return error("state.invalidShape", `state.runtimeEntities[${index}].definitionId must be a string`);
  }
  const position = validateRestoreVector2(entity.position, `state.runtimeEntities[${index}].position`);
  if (!position.ok) {
    return position;
  }
  if (!isPositiveFiniteNumber(entity.collisionRadius)) {
    return error("state.invalidShape", `state.runtimeEntities[${index}].collisionRadius must be a positive finite number`);
  }

  return okResult(Object.freeze({
    id: entity.id,
    kind: entity.kind,
    position: position.value,
  }));
}

function isRestoreRuntimeEntityKind(value: unknown): value is SerializedRuntimeEntityState["kind"] {
  return typeof value === "string" && (RESTORE_RUNTIME_ENTITY_KINDS as readonly string[]).includes(value);
}

/** player entity 固有 field と registry reference を検証する。 */
function validateRestorePlayerRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
  expectedTick: number,
): CoreResult<PlayerRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_PLAYER_KEYS)) {
    return error("state.invalidShape", "player runtime entity contains unknown fields");
  }
  if (
    !isNonNegativeSafeInteger(entity.lives)
    || !isNonNegativeSafeInteger(entity.invincibleTicksRemaining)
    || !isNonNegativeSafeInteger(entity.nextShotAllowedTick)
  ) {
    return error("state.invalidShape", "player runtime counters must be non-negative safe integers");
  }
  const movement = cloneRestorePlainRecord(entity.movement, "player runtime movement", ["speed", "focusSpeed"]);
  if (!movement.ok) {
    return movement;
  }
  if (!isPositiveFiniteNumber(movement.value.speed) || movement.value.speed > MAX_PLAYER_MOVEMENT_SPEED) {
    return error("state.invalidShape", "player movement.speed exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(movement.value.focusSpeed) || movement.value.focusSpeed > MAX_PLAYER_MOVEMENT_SPEED) {
    return error("state.invalidShape", "player movement.focusSpeed exceeds the runtime budget");
  }
  if (typeof entity.shotDefinitionId !== "string") {
    return error("state.invalidShape", "player shotDefinitionId must be a string");
  }
  if (!isNamespacedId(entity.shotDefinitionId, "playerShot")) {
    return error("state.invalidShape", "player shotDefinitionId must be a valid playerShot id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "player")) {
    return error("state.invalidShape", "player definitionId must be a valid player id");
  }
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return error("state.registryInvalid", "player runtime entity references an unknown player");
  }
  const playerShot = content.playerShotsById.get(entity.shotDefinitionId);
  if (!playerShot) {
    return error("state.registryInvalid", "player runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== player.collision.radius
    || movement.value.speed !== player.movement.speed
    || movement.value.focusSpeed !== player.movement.focusSpeed
    || entity.shotDefinitionId !== player.shot.definition
  ) {
    return error("state.invalidShape", "player runtime entity must match immutable player definition fields");
  }
  if (!isPlayerPositionInsidePlayfield(common.position)) {
    return error("state.invalidShape", "player runtime position must stay inside the playfield");
  }
  if (
    entity.lives > player.life.initialLives
    || entity.invincibleTicksRemaining > player.life.invincibleTicksAfterHit
    || entity.nextShotAllowedTick > Math.max(0, expectedTick - 1 + Math.min(
      playerShot.fire.intervalTicks,
      MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
    ))
  ) {
    return error("state.invalidShape", "player runtime counters exceed restorable gameplay bounds");
  }

  return okResult(createRestoredPlayerRuntimeEntity({
    id: common.id,
    definitionId: player.id,
    position: common.position,
    movement: Object.freeze({
      speed: movement.value.speed,
      focusSpeed: movement.value.focusSpeed,
    }),
    collisionRadius: player.collision.radius,
    lives: entity.lives,
    invincibleTicksRemaining: entity.invincibleTicksRemaining,
    shotDefinitionId: player.shot.definition,
    nextShotAllowedTick: entity.nextShotAllowedTick,
  }));
}

/** player の中心座標は movement system と同じ playfield 範囲だけを restore で受け付ける。 */
function isPlayerPositionInsidePlayfield(position: Readonly<{ x: number; y: number }>): boolean {
  return position.x >= 0 && position.x <= PLAYFIELD_WIDTH && position.y >= 0 && position.y <= PLAYFIELD_HEIGHT;
}

/** enemy entity 固有 field と registry reference を検証する。 */
function validateRestoreEnemyRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
): CoreResult<EnemyRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_ENEMY_KEYS)) {
    return error("state.invalidShape", "enemy runtime entity contains unknown fields");
  }
  if (!isPositiveFiniteNumber(entity.hp) || !isNonNegativeSafeInteger(entity.scoreOnKill)) {
    return error("state.invalidShape", "enemy runtime hp must be positive and scoreOnKill must be non-negative");
  }
  if (typeof entity.pathId !== "string") {
    return error("state.invalidShape", "enemy pathId must be a string");
  }
  if (typeof entity.patternId !== "string") {
    return error("state.invalidShape", "enemy patternId must be a string");
  }
  if (!isNamespacedId(entity.pathId, "path")) {
    return error("state.invalidShape", "enemy pathId must be a valid path id");
  }
  if (!isNamespacedId(entity.patternId, "pattern")) {
    return error("state.invalidShape", "enemy patternId must be a valid pattern id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "enemy")) {
    return error("state.invalidShape", "enemy definitionId must be a valid enemy id");
  }
  const enemy = content.enemiesById.get(entity.definitionId);
  if (!enemy) {
    return error("state.registryInvalid", "enemy runtime entity references an unknown enemy");
  }
  const path = content.pathsById.get(entity.pathId);
  if (!path) {
    return error("state.registryInvalid", "enemy runtime entity references an unknown path");
  }
  const pattern = content.patternsById.get(entity.patternId);
  if (!pattern) {
    return error("state.registryInvalid", "enemy runtime entity references an unknown pattern");
  }
  if (entity.collisionRadius !== enemy.collision.radius || entity.scoreOnKill !== enemy.score || entity.hp > enemy.hp) {
    return error("state.invalidShape", "enemy runtime entity must match immutable enemy definition fields");
  }

  return okResult(createRestoredEnemyRuntimeEntity({
    id: common.id,
    definitionId: enemy.id,
    position: common.position,
    pathId: path.id,
    patternId: pattern.id,
    collisionRadius: enemy.collision.radius,
    hp: entity.hp,
    scoreOnKill: enemy.score,
  }));
}

/** enemy bullet entity 固有 field と registry reference を検証する。 */
function validateRestoreEnemyBulletRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
): CoreResult<EnemyBulletRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_ENEMY_BULLET_KEYS)) {
    return error("state.invalidShape", "enemy bullet runtime entity contains unknown fields");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "bullet")) {
    return error("state.invalidShape", "enemy bullet definitionId must be a valid bullet id");
  }
  const bullet = content.bulletsById.get(entity.definitionId);
  if (!bullet) {
    return error("state.registryInvalid", "enemy bullet runtime entity references an unknown bullet");
  }
  if (entity.collisionRadius !== bullet.collision.radius) {
    return error("state.invalidShape", "enemy bullet runtime entity must match immutable bullet definition fields");
  }

  return okResult(createRestoredEnemyBulletRuntimeEntity({
    id: common.id,
    definitionId: bullet.id,
    position: common.position,
    collisionRadius: bullet.collision.radius,
  }));
}

/** player shot entity 固有 field と registry reference を検証する。 */
function validateRestorePlayerShotRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
  expectedTick: number,
): CoreResult<RestorePlayerShotValidation> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_PLAYER_SHOT_KEYS)) {
    return error("state.invalidShape", "player shot runtime entity contains unknown fields");
  }
  const velocity = validateRestoreVector2(entity.velocity, "player shot velocity");
  if (!velocity.ok) {
    return velocity;
  }
  if (Math.abs(velocity.value.x) > MAX_PLAYER_SHOT_SPEED_PER_AXIS || Math.abs(velocity.value.y) > MAX_PLAYER_SHOT_SPEED_PER_AXIS) {
    return error("state.invalidShape", "player shot velocity exceeds the runtime budget");
  }
  const remainingLifetimeTicks = entity.remainingLifetimeTicks;
  if (
    typeof remainingLifetimeTicks !== "number"
    || !Number.isSafeInteger(remainingLifetimeTicks)
    || remainingLifetimeTicks <= 0
    || remainingLifetimeTicks > MAX_PLAYER_SHOT_LIFETIME_TICKS
  ) {
    return error("state.invalidShape", "player shot remainingLifetimeTicks exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(entity.damage)) {
    return error("state.invalidShape", "player shot damage must be a positive finite number");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "playerShot")) {
    return error("state.invalidShape", "player shot definitionId must be a valid playerShot id");
  }
  const playerShot = content.playerShotsById.get(entity.definitionId);
  if (!playerShot) {
    return error("state.registryInvalid", "player shot runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== playerShot.collision.radius
    || velocity.value.x !== playerShot.projectile.velocity.x
    || velocity.value.y !== playerShot.projectile.velocity.y
    || entity.damage !== playerShot.damage
    || remainingLifetimeTicks > playerShot.projectile.lifetimeTicks
  ) {
    return error("state.invalidShape", "player shot runtime entity must match immutable player shot definition fields");
  }
  const elapsedTicks = playerShot.projectile.lifetimeTicks - remainingLifetimeTicks;
  const spawnTick = expectedTick - 1 - elapsedTicks;
  if (!Number.isSafeInteger(spawnTick) || spawnTick < 0 || spawnTick >= expectedTick) {
    return error("state.invalidShape", "player shot remainingLifetimeTicks is not reachable from expectedTick");
  }

  return okResult(Object.freeze({
    entity: createRestoredPlayerShotRuntimeEntity({
      id: common.id,
      definitionId: playerShot.id,
      position: common.position,
      velocity: velocity.value,
      collisionRadius: playerShot.collision.radius,
      damage: playerShot.damage,
      remainingLifetimeTicks,
    }),
    spawnTick,
  }));
}

/** serialized vector2 を有限数だけに制限する。 */
function validateRestoreVector2(value: unknown, fieldName: string): CoreResult<Readonly<{ x: number; y: number }>> {
  const vector = cloneRestorePlainRecord(value, fieldName, ["x", "y"]);
  if (!vector.ok) {
    return vector;
  }
  if (typeof vector.value.x !== "number" || !Number.isFinite(vector.value.x)) {
    return error("state.invalidShape", `${fieldName}.x must be finite`);
  }
  if (typeof vector.value.y !== "number" || !Number.isFinite(vector.value.y)) {
    return error("state.invalidShape", `${fieldName}.y must be finite`);
  }

  return okResult(Object.freeze({ x: vector.value.x, y: vector.value.y }));
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseInputFrame(value: unknown): CoreResult<InputFrame> {
  const record = asRecord(value);
  if (!record) {
    return error("input.invalidShape", "InputFrame must be an object");
  }
  if (!hasOnlyKeys(record, ["tick", "axes", "held", "pressed", "released"])) {
    return error("input.invalidShape", "InputFrame contains unknown fields");
  }
  if (typeof record.tick !== "number" || !Number.isSafeInteger(record.tick) || record.tick < 0) {
    return error("input.invalidShape", "input.tick must be a non-negative safe integer");
  }

  const axes = asRecord(record.axes);
  if (!axes || !isAxisValue(axes.moveX) || !isAxisValue(axes.moveY)) {
    return error("input.invalidShape", "input.axes must contain moveX/moveY values of -1, 0, or 1");
  }
  if (!hasOnlyKeys(axes, ["moveX", "moveY"])) {
    return error("input.invalidShape", "input.axes contains unknown fields");
  }

  const held = parseActionArray(record.held);
  const pressed = parseActionArray(record.pressed);
  const released = parseActionArray(record.released);
  if (!held || !pressed || !released) {
    return error("input.invalidShape", "input action arrays must contain unique supported gameplay actions");
  }
  if (hasIntersection(held, released)) {
    return error("input.invalidShape", "input.held and input.released must not contain the same action");
  }

  return okResult(deepFreezeClone({
    tick: record.tick,
    axes: { moveX: axes.moveX, moveY: axes.moveY },
    held,
    pressed,
    released,
  }));
}

function isAxisValue(value: unknown): value is -1 | 0 | 1 {
  return value === -1 || value === 0 || value === 1;
}

/** action 配列を重複のない canonical order へ正規化する。 */
function parseActionArray(value: unknown): InputFrame["held"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const actions = new Set<InputFrame["held"][number]>();
  for (const item of value) {
    if (item !== "shot" && item !== "focus") {
      return null;
    }
    if (actions.has(item)) {
      return null;
    }
    actions.add(item);
  }
  return GAMEPLAY_ACTION_ORDER.filter((action) => actions.has(action));
}

/** same tick の押下/離上 edge と held state の矛盾を検出する。 */
function hasIntersection(left: readonly InputFrame["held"][number][], right: readonly InputFrame["held"][number][]): boolean {
  const rightActions = new Set(right);
  return left.some((action) => rightActions.has(action));
}

/** feature list など、順序まで contract の一部である配列を比較する。 */
function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** public API 境界で typo 付き field を silent accept しないための key 検査。 */
function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/** restore の top-level string は deep guard を通らないため、ここで最小 budget を守る。 */
function isRestoreTopLevelString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_RESTORE_TOP_LEVEL_STRING_LENGTH;
}

/**
 * restore 用に top-level の own data property だけを浅く clone する。
 *
 * `state` / `prngState` の deep payload はここでは読まず、後段の deterministic payload
 * validator に渡す。互換性 metadata が nested payload の shape error にマスクされないことを優先する。
 */
function cloneRestoreTopLevelPlainRecord(value: unknown): CoreResult<Record<string, unknown>> {
  try {
    if (!isPlainObjectContainer(value)) {
      return error("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }
    const record = value as Record<string, unknown>;
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(record)) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return error("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
      }
      clone[key] = descriptor.value;
    }

    return okResult(Object.freeze(clone));
  } catch {
    return error("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
  }
}

/** restore payload shell の plain object を getter なしの shallow clone にする。 */
function cloneRestorePlainRecord(
  value: unknown,
  fieldName: string,
  allowedKeys: readonly string[],
): CoreResult<Record<string, unknown>> {
  try {
    if (!isPlainObjectContainer(value)) {
      return error("state.invalidShape", `${fieldName} must be a plain object`);
    }
    const source = value as Record<string, unknown>;
    const clone = Object.create(null) as Record<string, unknown>;
    const propertyNames = Object.getOwnPropertyNames(source);
    if (propertyNames.length > allowedKeys.length) {
      return error("state.invalidShape", `${fieldName} contains unknown fields`);
    }
    const allowed = new Set(allowedKeys);
    for (const key of propertyNames) {
      if (!allowed.has(key)) {
        return error("state.invalidShape", `${fieldName} contains unknown fields`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return error("state.invalidShape", `${fieldName} must contain only enumerable data properties`);
      }
      clone[key] = descriptor.value;
    }

    return okResult(Object.freeze(clone));
  } catch {
    return error("state.invalidShape", `${fieldName} must be a plain object`);
  }
}

/** restore payload shell の配列を dense data array として shallow clone する。 */
function cloneRestoreArray(
  value: unknown,
  fieldName: string,
  maxLength = MAX_RESTORE_ARRAY_LENGTH,
): CoreResult<readonly unknown[]> {
  try {
    if (!Array.isArray(value)) {
      return error("state.invalidShape", `${fieldName} must be an array`);
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return error("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    const length = value.length;
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > maxLength
      || Object.getOwnPropertySymbols(value).length > 0
    ) {
      return error("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length > length + 1) {
      return error("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    for (const key of propertyNames) {
      if (key === "length") {
        continue;
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
        return error("state.invalidShape", `${fieldName} must be a dense data array`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return error("state.invalidShape", `${fieldName} must be a dense data array`);
      }
    }
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return error("state.invalidShape", `${fieldName} must be a dense data array`);
      }
      clone.push(descriptor.value);
    }

    return okResult(Object.freeze(clone));
  } catch {
    return error("state.invalidShape", `${fieldName} must be an array`);
  }
}

/** enabledFeatures だけは top-level metadata として one-level の dense string array に clone / freeze する。 */
function parseRestoreEnabledFeatures(value: unknown): CoreResult<readonly string[]> {
  const denseFeatures = cloneRestoreArray(value, "enabledFeatures", MAX_RESTORE_ENABLED_FEATURES_LENGTH);
  if (!denseFeatures.ok) {
    return error("state.invalidShape", "enabledFeatures must be an array of strings");
  }
  const clone: string[] = [];
  for (const feature of denseFeatures.value) {
    if (typeof feature !== "string" || feature.length > MAX_RESTORE_TOP_LEVEL_STRING_LENGTH) {
      return error("state.invalidShape", "enabledFeatures must be an array of strings");
    }
    clone.push(feature);
  }

  return okResult(Object.freeze(clone));
}

/** enabledFeatures の canonical order / duplicate だけを shape contract として検査する。 */
function validateRestoreEnabledFeatureContract(features: readonly string[]): CoreResult<null> {
  const seen = new Set<string>();
  let previousKnownIndex = -1;
  for (const feature of features) {
    if (seen.has(feature)) {
      return error("state.invalidShape", "enabledFeatures must use canonical order without duplicates");
    }
    seen.add(feature);
    const knownIndex = (KNOWN_ENABLED_FEATURES as readonly string[]).indexOf(feature);
    if (knownIndex === -1) {
      continue;
    }
    if (knownIndex <= previousKnownIndex) {
      return error("state.invalidShape", "enabledFeatures must use canonical order without duplicates");
    }
    previousKnownIndex = knownIndex;
  }

  return okResult(null);
}

/** nested payload の property は未検証なので読まず、plain object shell かだけを見る。 */
function isPlainObjectContainer(value: unknown): boolean {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.getOwnPropertySymbols(value).length === 0;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** union 型の追加時に switch の更新漏れを型エラーとして検出する。 */
function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

/** 単一エラーを `CoreResult` の失敗として返すための小さな helper。 */
function error<T>(code: CoreErrorCode, message: string): CoreResult<T> {
  return coreError(code, message);
}

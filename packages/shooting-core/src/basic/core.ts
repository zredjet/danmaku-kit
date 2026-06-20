import { isNamespacedId } from "./content/identifier.ts";
import { KNOWN_ENABLED_FEATURES } from "./content/types.ts";
import type {
  BulletDefinition,
  Difficulty,
  EnabledFeature,
  EnemyDefinition,
  GameDefinition,
  PathId,
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
import { GAMEPLAY_ACTION_ORDER } from "./input/input-frame.ts";
import type { InputFrame } from "./input/input-frame.ts";
import { deepFreezeClone, deepFreezePlainData } from "./internal/immutable.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import type { CoreError, CoreErrorCode, CoreResult } from "./result.ts";
import type {
  SerializedDeterministicState,
  SerializedGameState,
  SerializedPendingEvent,
  SerializedRuntimeEntityState,
} from "./serialization/types.ts";
import { resolveCollisionAndScoring } from "./simulation/collision-system.ts";
import { EntityAllocator } from "./simulation/entity.ts";
import { spawnEnemyBulletsOnSpawn } from "./simulation/enemy-bullet-system.ts";
import { advancePlayerMovement } from "./simulation/player-movement-system.ts";
import { advancePlayerShotLifecycle } from "./simulation/player-shot-lifecycle-system.ts";
import { spawnPlayerShotFromInput } from "./simulation/player-shot-system.ts";
import {
  createEnemyRuntimeEntity,
  createPlayerRuntimeEntity,
  toReadonlyEntityState,
} from "./simulation/runtime-entity.ts";
import type { EnemyRuntimeEntity, PlayerRuntimeEntity, ReadonlyEntityState, RuntimeEntityState } from "./simulation/runtime-entity.ts";
import { freezeEntitiesInIdOrder } from "./simulation/system-order.ts";
import { XorShift32 } from "./simulation/prng.ts";
import type { SerializedPrngState } from "./simulation/prng.ts";

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

/**
 * state hash 用に使う内部 deterministic snapshot。
 *
 * serialize 用の public DTO とは別に、hash version ごとの正規化済み入力として扱う。
 * public snapshot の互換性維持と hash byte stream の固定を独立させるため、この型では
 * runtime state から必要な deterministic field だけを重複なく並べる。
 */
type HashableGameState = Readonly<{
  stateHashVersion: typeof SERIALIZED_STATE_HASH_VERSION;
  coreVersion: string;
  schemaVersion: string;
  expectedTick: number;
  nextEntityId: number;
  timelineCursor: number;
  prngState: Readonly<{ state: number }>;
  score: number;
  runtimeEntities: ReadonlyArray<HashableRuntimeEntityState>;
  pendingEvents: ReadonlyArray<HashablePendingEvent>;
  patternRunnerStates: ReadonlyArray<HashablePatternRunnerState>;
  enabledFeatureStates: ReadonlyArray<HashableEnabledFeatureState>;
}>;

/** HashableGameState に含める runtime entity の内部 hash 専用 DTO。 */
type HashableRuntimeEntityState =
  | Readonly<{
      id: number;
      kind: "player";
      definitionId: PlayerId;
      position: Readonly<{ x: number; y: number }>;
      collisionRadius: number;
      lives: number;
      invincibleTicksRemaining: number;
      nextShotAllowedTick: number;
      movement: Readonly<{ speed: number; focusSpeed: number }>;
      shotDefinitionId: PlayerShotDefinition["id"];
    }>
  | Readonly<{
      id: number;
      kind: "enemy";
      definitionId: EnemyDefinition["id"];
      position: Readonly<{ x: number; y: number }>;
      collisionRadius: number;
      hp: number;
      scoreOnKill: number;
      pathId: PathId;
      patternId: PatternDefinition["id"];
    }>
  | Readonly<{
      id: number;
      kind: "enemyBullet";
      definitionId: BulletDefinition["id"];
      position: Readonly<{ x: number; y: number }>;
      collisionRadius: number;
    }>
  | Readonly<{
      id: number;
      kind: "playerShot";
      definitionId: PlayerShotDefinition["id"];
      position: Readonly<{ x: number; y: number }>;
      collisionRadius: number;
      velocity: Readonly<{ x: number; y: number }>;
      remainingLifetimeTicks: number;
      damage: number;
    }>;

/** Hash 対象として次 tick に持ち越す pending event。 */
type HashablePendingEvent = Readonly<{
  type: "stageStarted";
  tick: 0;
  stageId: StageId;
}>;

/** Committed state が次 tick へ持ち越してよい deterministic event。 */
type CommittedPendingEvent = HashablePendingEvent;

/** Pattern runner の hash 対象 state。 */
type HashablePatternRunnerState = Readonly<{
  runnerId: `patternRunner.${string}`;
  patternId: PatternDefinition["id"];
  stateVersion: number;
  payload: HashableJsonValue;
}>;

/** Optional feature module の hash 対象 state。 */
type HashableEnabledFeatureState = Readonly<{
  feature: EnabledFeature;
  stateVersion: number;
  payload: HashableJsonValue;
}>;

/** Hash encoder が受け付ける JSON 互換 payload。 */
type HashableJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly HashableJsonValue[]
  | { readonly [key: string]: HashableJsonValue };

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
  patternsById: ReadonlyMap<string, PatternDefinition>;
  playerShotsById: ReadonlyMap<string, PlayerShotDefinition>;
  playersById: ReadonlyMap<string, PlayerDefinition>;
  stagesById: ReadonlyMap<string, StageDefinition>;
}>;

type StageSessionContext = {
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
  recordCommittedStateOnFatal?: (state: CommittedStageState) => void;
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
  recordCommittedStateOnFatal?: (state: CommittedStageState) => void;
}>;

/** validated content を runtime lookup しやすい形へまとめる。 */
function createLoadedContentIndex(definition: GameDefinition): LoadedContentIndex {
  return {
    definition,
    bulletsById: new Map(definition.content.bullets.map((bullet) => [bullet.id, bullet])),
    enemiesById: new Map(definition.content.enemies.map((enemy) => [enemy.id, enemy])),
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

      return error(
        "state.unsupportedSnapshot",
        "SerializedGameState deterministic payload restore is not supported by this core version",
      );
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
      return okResult(createStageSession({
        bulletsById: content.bulletsById,
        enemiesById: content.enemiesById,
        initialState: createCommittedStageState({
          activeEntities: [playerEntity.value],
          expectedTick: 0,
          nextEntityId: entityAllocator.snapshot(),
          pendingEvents: [{ type: "stageStarted", tick: 0, stageId: stage.id }],
          prngState: new XorShift32(options.value.seed).snapshot(),
          score: 0,
          timelineCursor: 0,
        }),
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
      const frame = Object.freeze({
        tick: working.value.expectedTick,
        state,
        events: working.value.eventLog.drain(),
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
      return okResult(frame);
    },
  };
  return Object.freeze(session);
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

  const state: SerializedDeterministicState = {
    runtimeEntities: committedState.activeEntities.map((entity) => serializeRuntimeEntity(entity)),
    pendingEvents: pendingEvents.value.map((event) => serializePendingEvent(event)),
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

/** runtime entity を restore 用の discriminated union DTO に写す。 */
function serializeRuntimeEntity(entity: RuntimeEntityState): SerializedRuntimeEntityState {
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

/** pending queue に残せる event を public DTO へ正規化する。 */
function serializePendingEvent(event: CommittedPendingEvent): SerializedPendingEvent {
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
    recordCommittedStateOnFatal: testingHooks.recordCommittedStateOnFatal,
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
  if (typeof record.nextEntityId !== "number" || !Number.isSafeInteger(record.nextEntityId) || record.nextEntityId < 1) {
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

/** enabledFeatures だけは top-level metadata として one-level の dense string array に clone / freeze する。 */
function parseRestoreEnabledFeatures(value: unknown): CoreResult<readonly string[]> {
  try {
    if (!Array.isArray(value)) {
      return error("state.invalidShape", "enabledFeatures must be an array of strings");
    }
    const length = value.length;
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > MAX_RESTORE_ENABLED_FEATURES_LENGTH
      || Object.getOwnPropertySymbols(value).length > 0
    ) {
      return error("state.invalidShape", "enabledFeatures must be an array of strings");
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    const clone: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string") {
        return error("state.invalidShape", "enabledFeatures must be an array of strings");
      }
      if (descriptor.value.length > MAX_RESTORE_TOP_LEVEL_STRING_LENGTH) {
        return error("state.invalidShape", "enabledFeatures must be an array of strings");
      }
      clone.push(descriptor.value);
    }
    for (const key of propertyNames) {
      if (key === "length") {
        continue;
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
        return error("state.invalidShape", "enabledFeatures must be an array of strings");
      }
    }
    return okResult(Object.freeze(clone));
  } catch {
    return error("state.invalidShape", "enabledFeatures must be an array of strings");
  }
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

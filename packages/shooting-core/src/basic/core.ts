import type { LoadedGame, ReadonlyGameState, ReadonlyPlayerState, ShootingCore, StageSession } from "./api-types.ts";
import { createLoadedContentIndex } from "./content/content-index.ts";
import type { LoadedContentIndex } from "./content/content-index.ts";
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
  EnemyDefinition,
  GameDefinition,
  PatternDefinition,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  StageDefinition,
  StageId,
} from "./content/types.ts";
import { validateGameDefinition } from "./content/validation.ts";
import { parseInputFrame } from "./input/parse-input-frame.ts";
import type { HeadlessDebugTickMetrics } from "./internal/debug-state.ts";
import { createHeadlessDebugTickMetrics, serializeHeadlessDebugState } from "./internal/debug-state.ts";
import {
  asRecord,
  assertNever,
  hasOnlyKeys,
  isNonNegativeSafeInteger,
  isPlainObjectContainer,
  isPositiveFiniteNumber,
  isPositiveSafeInteger,
} from "./internal/guards.ts";
import { deepFreezeClone, deepFreezePlainData } from "./internal/immutable.ts";
import {
  createActiveStageSessionTestingHooks,
  createSerializeSourceState,
  failAfterWorkingMutationForTesting,
} from "./internal/stage-session-testing-hooks.ts";
import type {
  ActiveStageSessionTestingHooks,
  StageSessionTestingHookOptions,
} from "./internal/stage-session-testing-hooks.ts";
import { assertInternalTestHooksEnabled } from "./internal/test-hooks-guard.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import type { CoreError, CoreResult } from "./result.ts";
import {
  SERIALIZED_INPUT_FORMAT_VERSION,
  SERIALIZED_STATE_HASH_VERSION,
  canonicalizeEnabledFeatures,
} from "./serialization/metadata.ts";
import type { StageSessionSerializationMetadata } from "./serialization/metadata.ts";
import type {
  SerializedEnabledFeatureState,
  SerializedGameState,
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
import { parseStartStageOptions } from "./session/start-stage-options.ts";
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
  RuntimeEntityState,
} from "./simulation/runtime-entity.ts";
import { freezeEntitiesInIdOrder } from "./simulation/system-order.ts";
import { XorShift32 } from "./simulation/prng.ts";
import type { SerializedPrngState } from "./simulation/prng.ts";
import { MAX_RESTORABLE_NEXT_ENTITY_ID } from "./simulation/entity-id-budget.ts";
import { createCommittedStageState, createWorkingStageState } from "./state/committed-state.ts";
import type { CommittedPendingEvent, CommittedStageState, UntrustedCommittedStageState } from "./state/committed-state.ts";
import { createHashableGameState } from "./state/hashable-projection.ts";
import { serializeCommittedStageState } from "./state/serialize-projection.ts";

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
  assertInternalTestHooksEnabled("create a hook-enabled shooting core");
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
        return coreError("definition.invalidShape", "GameDefinition must be JSON-compatible plain data");
      }
      const errors = validateGameDefinition(plainDefinition);
      if (errors.length > 0) {
        return errorResult(errors);
      }
      return okResult(createLoadedGame(createLoadedContentIndex(plainDefinition as GameDefinition), coreVersion, testingHooks));
    },
  });
}

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

type ValidatedRestoreDeterministicPayload = Readonly<{
  activeEntities: readonly RuntimeEntityState[];
  enabledFeatureStates: readonly ValidatedRestoreEnabledFeatureState[];
  pendingEvents: readonly CommittedPendingEvent[];
  patternRunnerStates: readonly ValidatedRestorePatternRunnerState[];
  score: number;
  timelineCursor: number;
}>;

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
        return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
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
        return coreError("startStage.invalidShape", "StartStageOptions must be JSON-compatible plain data");
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
        return coreError("stage.notFound", `Stage not found: ${options.value.stageId}`);
      }
      if (!player) {
        return coreError("player.notFound", `Player not found: ${playerId}`);
      }
      if (!stage.difficulties.includes(options.value.difficulty)) {
        return coreError("difficulty.notSupported", `Difficulty not supported: ${options.value.difficulty}`);
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
        return coreError("input.invalidShape", "InputFrame must be JSON-compatible plain data");
      }
      const input = parseInputFrame(plainInput);
      if (!input.ok) {
        return input;
      }
      // system order の applyInput。入力 tick のズレは状態を進める前に拒否する。
      if (input.value.tick !== committedState.expectedTick) {
        return coreError("input.tickMismatch", `Expected tick ${committedState.expectedTick}, got ${input.value.tick}`);
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

/** core / schema mismatch を現行 schema の key set より先に分類するための metadata だけを読む。 */
function parseRestoreSchemaMetadata(value: unknown): CoreResult<RestoreSchemaMetadata> {
  const coreVersion = readRestoreTopLevelDataProperty(value, "coreVersion");
  if (!coreVersion.ok) {
    return coreVersion;
  }
  if (!isRestoreTopLevelString(coreVersion.value)) {
    return coreError("state.invalidShape", "coreVersion must be a string");
  }

  const schemaVersion = readRestoreTopLevelDataProperty(value, "schemaVersion");
  if (!schemaVersion.ok) {
    return schemaVersion;
  }
  if (!isRestoreTopLevelString(schemaVersion.value)) {
    return coreError("state.invalidShape", "schemaVersion must be a string");
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
      return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      return coreError("state.invalidShape", `${key} must be provided`);
    }
    if (!("value" in descriptor) || !descriptor.enumerable) {
      return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }

    return okResult(descriptor.value);
  } catch {
    return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
  }
}

/** top-level string metadata を field 単位で読む。 */
function parseRestoreTopLevelStringField(
  record: Record<string, unknown>,
  key: keyof Pick<SerializedGameState, "contentVersion" | "inputFormatVersion" | "stageId" | "playerId">,
): CoreResult<string> {
  if (!isRestoreTopLevelString(record[key])) {
    return coreError("state.invalidShape", `${key} must be a string`);
  }

  return okResult(record[key]);
}

/** state hash version を field 単位で読む。 */
function parseRestoreStateHashVersion(record: Record<string, unknown>): CoreResult<number> {
  if (typeof record.stateHashVersion !== "number" || !Number.isSafeInteger(record.stateHashVersion)) {
    return coreError("state.invalidShape", "stateHashVersion must be a safe integer");
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
    return coreError("state.invalidShape", "stageId must use the stage.* namespace");
  }
  if (record.difficulty !== "normal" && record.difficulty !== "hard") {
    return coreError("state.invalidShape", "difficulty must be normal or hard");
  }
  const playerId = parseRestoreTopLevelStringField(record, "playerId");
  if (!playerId.ok) {
    return playerId;
  }
  if (!isNamespacedId(playerId.value, "player")) {
    return coreError("state.invalidShape", "playerId must use the player.* namespace");
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
    return coreError("state.invalidShape", "SerializedGameState must be an object");
  }
  if (!hasOnlyKeys(record, RESTORE_TOP_LEVEL_KEYS)) {
    return coreError("state.invalidShape", "SerializedGameState contains unknown top-level fields");
  }
  if (typeof record.expectedTick !== "number" || !Number.isSafeInteger(record.expectedTick) || record.expectedTick < 0) {
    return coreError("state.invalidShape", "expectedTick must be a non-negative safe integer");
  }
  if (
    typeof record.nextEntityId !== "number"
    || !Number.isSafeInteger(record.nextEntityId)
    || record.nextEntityId < 1
    || record.nextEntityId > MAX_RESTORABLE_NEXT_ENTITY_ID
  ) {
    return coreError("state.invalidShape", "nextEntityId must be a positive safe integer");
  }
  if (!isPlainObjectContainer(record.prngState)) {
    return coreError("state.invalidShape", "prngState must be an object");
  }
  if (!isPlainObjectContainer(record.state)) {
    return coreError("state.invalidShape", "state must be an object");
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
    return coreError("state.coreVersionMismatch", `coreVersion mismatch: expected ${coreVersion}, got ${state.coreVersion}`);
  }
  if (state.schemaVersion !== content.definition.schemaVersion) {
    return coreError("state.schemaVersionMismatch", `schemaVersion mismatch: expected ${content.definition.schemaVersion}, got ${state.schemaVersion}`);
  }

  return okResult(null);
}

/** input format mismatch は現行 schema の key set や後続 metadata より先に分類する。 */
function validateRestoreInputFormatCompatibility(inputFormatVersion: string): CoreResult<null> {
  if (inputFormatVersion !== SERIALIZED_INPUT_FORMAT_VERSION) {
    return coreError("state.inputFormatVersionMismatch", `inputFormatVersion mismatch: expected ${SERIALIZED_INPUT_FORMAT_VERSION}, got ${inputFormatVersion}`);
  }

  return okResult(null);
}

/** state hash version mismatch は現行 schema の key set や後続 metadata より先に分類する。 */
function validateRestoreStateHashVersionCompatibility(stateHashVersion: number): CoreResult<null> {
  if (stateHashVersion !== SERIALIZED_STATE_HASH_VERSION) {
    return coreError("state.stateHashVersionMismatch", `stateHashVersion mismatch: expected ${SERIALIZED_STATE_HASH_VERSION}, got ${stateHashVersion}`);
  }

  return okResult(null);
}

/** content version mismatch は deterministic payload container shape より先に分類する。 */
function validateRestoreContentVersionCompatibility(
  contentVersion: string,
  content: LoadedContentIndex,
): CoreResult<null> {
  if (contentVersion !== content.definition.content.version) {
    return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
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
    return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }
  const enabledFeatures = canonicalizeEnabledFeatures(content.definition.enabledFeatures);
  if (!sameOrderedValues(state.enabledFeatures, enabledFeatures)) {
    return coreError("state.featureMismatch", "enabledFeatures do not match the loaded content");
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
    return coreError("state.prngInvalid", "prngState cannot be restored by the PRNG");
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
    return coreError("state.invalidShape", "state.score must be a non-negative safe integer");
  }
  if (state.expectedTick === 0 && record.value.score !== 0) {
    return coreError("state.invalidShape", "initial restore state score must be zero");
  }
  const stage = content.stagesById.get(state.stageId);
  if (!stage) {
    return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }
  if (
    typeof record.value.timelineCursor !== "number"
    || !Number.isSafeInteger(record.value.timelineCursor)
    || record.value.timelineCursor < 0
    || record.value.timelineCursor > stage.timeline.length
  ) {
    return coreError("state.invalidShape", "state.timelineCursor must be within the stage timeline range");
  }
  const expectedTimelineCursor = findExpectedTimelineCursor(stage, state.expectedTick);
  if (record.value.timelineCursor !== expectedTimelineCursor) {
    return coreError("state.invalidShape", "state.timelineCursor must match expectedTick");
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
    return coreError("state.featureMismatch", "state.patternRunnerStates require a compatible pattern runner module");
  }
  if (enabledFeatureStates.value.length > 0) {
    return coreError("state.featureMismatch", "state.enabledFeatureStates require enabled feature modules");
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
    return coreError("state.invalidShape", "SerializedGameState deterministic payload cannot be committed");
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
    return coreError("state.invalidShape", "initial restore state must contain only the initial player entity");
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
      return coreError("state.invalidShape", "state.pendingEvents must be empty after tick 0");
    }
    return okResult(Object.freeze([]));
  }
  if (pendingEvents.length !== 1) {
    return coreError("state.invalidShape", "state.pendingEvents must contain stageStarted at tick 0");
  }
  const event = cloneRestorePlainRecord(pendingEvents[0], "state.pendingEvents[0]", ["type", "tick", "stageId"]);
  if (!event.ok) {
    return event;
  }
  if (event.value.type !== "stageStarted" || event.value.tick !== 0 || event.value.stageId !== state.stageId) {
    return coreError("state.invalidShape", "state.pendingEvents[0] must be stageStarted for the restored stage");
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
          return coreError("state.invalidShape", "player runtime entity id must be the initial entity id");
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
    return coreError("state.invalidShape", "state.runtimeEntities must contain exactly one player matching playerId");
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
      return coreError("state.invalidShape", "pattern runner state runnerId must be patternRunner.* with a non-empty suffix");
    }
    if (previousRunnerId !== null && compareUtf8Lexicographic(previousRunnerId, state.value.runnerId) >= 0) {
      return coreError("state.invalidShape", "state.patternRunnerStates must be ordered by unique runnerId");
    }
    previousRunnerId = state.value.runnerId;
    if (typeof state.value.patternId !== "string" || !isNamespacedId(state.value.patternId, "pattern")) {
      return coreError("state.invalidShape", "pattern runner state patternId must be a valid pattern id");
    }
    if (!isPositiveSafeInteger(state.value.stateVersion)) {
      return coreError("state.invalidShape", "pattern runner stateVersion must be a positive safe integer");
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
      return coreError("state.invalidShape", "enabled feature state feature must be a restore-safe string");
    }
    if (!isPositiveSafeInteger(state.value.stateVersion)) {
      return coreError("state.invalidShape", "enabled feature stateVersion must be a positive safe integer");
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
      return coreError("state.registryInvalid", "stage timeline references an unknown pattern");
    }
    if (pattern.fireOnSpawn) {
      const position = resolveEnemyBulletSpawnPosition(
        "restore",
        step.action.position,
        pattern.id,
        pattern.fireOnSpawn,
      );
      if (!position.ok) {
        return coreError("state.registryInvalid", "stage timeline contains an invalid enemy bullet spawn position");
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
    return coreError("state.invalidShape", "nextEntityId exceeds the deterministic allocation envelope");
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
    return coreError("state.invalidShape", "enemy runtime entity must originate from a processed timeline spawn");
  }
  const [candidate] = candidates.splice(index, 1);
  if (!candidate) {
    return coreError("state.invalidShape", "enemy runtime entity must originate from a processed timeline spawn");
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
    return coreError("state.invalidShape", "enemy bullet runtime entity must originate from a processed timeline spawn");
  }
  const [candidate] = candidates.splice(index, 1);
  if (!candidate) {
    return coreError("state.invalidShape", "enemy bullet runtime entity must originate from a processed timeline spawn");
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
        return coreError("state.invalidShape", "enemy bullet id must follow same-tick enemy allocations");
      }
    }
  }
  for (const shot of playerShots) {
    for (const enemy of enemies) {
      if (shot.spawnTick === enemy.tick && shot.id < enemy.id) {
        return coreError("state.invalidShape", "player shot id must follow same-tick enemy allocations");
      }
    }
    for (const bullet of enemyBullets) {
      if (shot.spawnTick === bullet.tick && shot.id < bullet.id) {
        return coreError("state.invalidShape", "player shot id must follow same-tick enemy bullet allocations");
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
      return coreError("state.invalidShape", `${label} runtime entity ids must follow same-tick allocation order`);
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
      return coreError("state.invalidShape", "runtime entity ids must follow deterministic allocation order across ticks");
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
    return coreError("state.registryInvalid", "player runtime entity references an unknown player");
  }
  if (
    !isSameRestorePosition(DEFAULT_PLAYER_START_POSITION, entity.position)
    || entity.lives !== player.life.initialLives
    || entity.invincibleTicksRemaining !== 0
    || entity.nextShotAllowedTick !== 0
  ) {
    return coreError("state.invalidShape", "initial player runtime entity must match startStage defaults");
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
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].id must be positive, ascending, and below nextEntityId`);
  }
  if (!isRestoreRuntimeEntityKind(entity.kind)) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].kind is not supported`);
  }
  if (!isRestoreTopLevelString(entity.definitionId)) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].definitionId must be a string`);
  }
  const position = validateRestoreVector2(entity.position, `state.runtimeEntities[${index}].position`);
  if (!position.ok) {
    return position;
  }
  if (!isPositiveFiniteNumber(entity.collisionRadius)) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].collisionRadius must be a positive finite number`);
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
    return coreError("state.invalidShape", "player runtime entity contains unknown fields");
  }
  if (
    !isNonNegativeSafeInteger(entity.lives)
    || !isNonNegativeSafeInteger(entity.invincibleTicksRemaining)
    || !isNonNegativeSafeInteger(entity.nextShotAllowedTick)
  ) {
    return coreError("state.invalidShape", "player runtime counters must be non-negative safe integers");
  }
  const movement = cloneRestorePlainRecord(entity.movement, "player runtime movement", ["speed", "focusSpeed"]);
  if (!movement.ok) {
    return movement;
  }
  if (!isPositiveFiniteNumber(movement.value.speed) || movement.value.speed > MAX_PLAYER_MOVEMENT_SPEED) {
    return coreError("state.invalidShape", "player movement.speed exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(movement.value.focusSpeed) || movement.value.focusSpeed > MAX_PLAYER_MOVEMENT_SPEED) {
    return coreError("state.invalidShape", "player movement.focusSpeed exceeds the runtime budget");
  }
  if (typeof entity.shotDefinitionId !== "string") {
    return coreError("state.invalidShape", "player shotDefinitionId must be a string");
  }
  if (!isNamespacedId(entity.shotDefinitionId, "playerShot")) {
    return coreError("state.invalidShape", "player shotDefinitionId must be a valid playerShot id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "player")) {
    return coreError("state.invalidShape", "player definitionId must be a valid player id");
  }
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player");
  }
  const playerShot = content.playerShotsById.get(entity.shotDefinitionId);
  if (!playerShot) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== player.collision.radius
    || movement.value.speed !== player.movement.speed
    || movement.value.focusSpeed !== player.movement.focusSpeed
    || entity.shotDefinitionId !== player.shot.definition
  ) {
    return coreError("state.invalidShape", "player runtime entity must match immutable player definition fields");
  }
  if (!isPlayerPositionInsidePlayfield(common.position)) {
    return coreError("state.invalidShape", "player runtime position must stay inside the playfield");
  }
  if (
    entity.lives > player.life.initialLives
    || entity.invincibleTicksRemaining > player.life.invincibleTicksAfterHit
    || entity.nextShotAllowedTick > Math.max(0, expectedTick - 1 + Math.min(
      playerShot.fire.intervalTicks,
      MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
    ))
  ) {
    return coreError("state.invalidShape", "player runtime counters exceed restorable gameplay bounds");
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
    return coreError("state.invalidShape", "enemy runtime entity contains unknown fields");
  }
  if (!isPositiveFiniteNumber(entity.hp) || !isNonNegativeSafeInteger(entity.scoreOnKill)) {
    return coreError("state.invalidShape", "enemy runtime hp must be positive and scoreOnKill must be non-negative");
  }
  if (typeof entity.pathId !== "string") {
    return coreError("state.invalidShape", "enemy pathId must be a string");
  }
  if (typeof entity.patternId !== "string") {
    return coreError("state.invalidShape", "enemy patternId must be a string");
  }
  if (!isNamespacedId(entity.pathId, "path")) {
    return coreError("state.invalidShape", "enemy pathId must be a valid path id");
  }
  if (!isNamespacedId(entity.patternId, "pattern")) {
    return coreError("state.invalidShape", "enemy patternId must be a valid pattern id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "enemy")) {
    return coreError("state.invalidShape", "enemy definitionId must be a valid enemy id");
  }
  const enemy = content.enemiesById.get(entity.definitionId);
  if (!enemy) {
    return coreError("state.registryInvalid", "enemy runtime entity references an unknown enemy");
  }
  const path = content.pathsById.get(entity.pathId);
  if (!path) {
    return coreError("state.registryInvalid", "enemy runtime entity references an unknown path");
  }
  const pattern = content.patternsById.get(entity.patternId);
  if (!pattern) {
    return coreError("state.registryInvalid", "enemy runtime entity references an unknown pattern");
  }
  if (entity.collisionRadius !== enemy.collision.radius || entity.scoreOnKill !== enemy.score || entity.hp > enemy.hp) {
    return coreError("state.invalidShape", "enemy runtime entity must match immutable enemy definition fields");
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
    return coreError("state.invalidShape", "enemy bullet runtime entity contains unknown fields");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "bullet")) {
    return coreError("state.invalidShape", "enemy bullet definitionId must be a valid bullet id");
  }
  const bullet = content.bulletsById.get(entity.definitionId);
  if (!bullet) {
    return coreError("state.registryInvalid", "enemy bullet runtime entity references an unknown bullet");
  }
  if (entity.collisionRadius !== bullet.collision.radius) {
    return coreError("state.invalidShape", "enemy bullet runtime entity must match immutable bullet definition fields");
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
    return coreError("state.invalidShape", "player shot runtime entity contains unknown fields");
  }
  const velocity = validateRestoreVector2(entity.velocity, "player shot velocity");
  if (!velocity.ok) {
    return velocity;
  }
  if (Math.abs(velocity.value.x) > MAX_PLAYER_SHOT_SPEED_PER_AXIS || Math.abs(velocity.value.y) > MAX_PLAYER_SHOT_SPEED_PER_AXIS) {
    return coreError("state.invalidShape", "player shot velocity exceeds the runtime budget");
  }
  const remainingLifetimeTicks = entity.remainingLifetimeTicks;
  if (
    typeof remainingLifetimeTicks !== "number"
    || !Number.isSafeInteger(remainingLifetimeTicks)
    || remainingLifetimeTicks <= 0
    || remainingLifetimeTicks > MAX_PLAYER_SHOT_LIFETIME_TICKS
  ) {
    return coreError("state.invalidShape", "player shot remainingLifetimeTicks exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(entity.damage)) {
    return coreError("state.invalidShape", "player shot damage must be a positive finite number");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "playerShot")) {
    return coreError("state.invalidShape", "player shot definitionId must be a valid playerShot id");
  }
  const playerShot = content.playerShotsById.get(entity.definitionId);
  if (!playerShot) {
    return coreError("state.registryInvalid", "player shot runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== playerShot.collision.radius
    || velocity.value.x !== playerShot.projectile.velocity.x
    || velocity.value.y !== playerShot.projectile.velocity.y
    || entity.damage !== playerShot.damage
    || remainingLifetimeTicks > playerShot.projectile.lifetimeTicks
  ) {
    return coreError("state.invalidShape", "player shot runtime entity must match immutable player shot definition fields");
  }
  const elapsedTicks = playerShot.projectile.lifetimeTicks - remainingLifetimeTicks;
  const spawnTick = expectedTick - 1 - elapsedTicks;
  if (!Number.isSafeInteger(spawnTick) || spawnTick < 0 || spawnTick >= expectedTick) {
    return coreError("state.invalidShape", "player shot remainingLifetimeTicks is not reachable from expectedTick");
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
    return coreError("state.invalidShape", `${fieldName}.x must be finite`);
  }
  if (typeof vector.value.y !== "number" || !Number.isFinite(vector.value.y)) {
    return coreError("state.invalidShape", `${fieldName}.y must be finite`);
  }

  return okResult(Object.freeze({ x: vector.value.x, y: vector.value.y }));
}

/** feature list など、順序まで contract の一部である配列を比較する。 */
function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
      return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }
    const record = value as Record<string, unknown>;
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(record)) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
      }
      clone[key] = descriptor.value;
    }

    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
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
      return coreError("state.invalidShape", `${fieldName} must be a plain object`);
    }
    const source = value as Record<string, unknown>;
    const clone = Object.create(null) as Record<string, unknown>;
    const propertyNames = Object.getOwnPropertyNames(source);
    if (propertyNames.length > allowedKeys.length) {
      return coreError("state.invalidShape", `${fieldName} contains unknown fields`);
    }
    const allowed = new Set(allowedKeys);
    for (const key of propertyNames) {
      if (!allowed.has(key)) {
        return coreError("state.invalidShape", `${fieldName} contains unknown fields`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must contain only enumerable data properties`);
      }
      clone[key] = descriptor.value;
    }

    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be a plain object`);
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
      return coreError("state.invalidShape", `${fieldName} must be an array`);
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    const length = value.length;
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > maxLength
      || Object.getOwnPropertySymbols(value).length > 0
    ) {
      return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length > length + 1) {
      return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    for (const key of propertyNames) {
      if (key === "length") {
        continue;
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
        return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
      }
    }
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
      }
      clone.push(descriptor.value);
    }

    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be an array`);
  }
}

/** enabledFeatures だけは top-level metadata として one-level の dense string array に clone / freeze する。 */
function parseRestoreEnabledFeatures(value: unknown): CoreResult<readonly string[]> {
  const denseFeatures = cloneRestoreArray(value, "enabledFeatures", MAX_RESTORE_ENABLED_FEATURES_LENGTH);
  if (!denseFeatures.ok) {
    return coreError("state.invalidShape", "enabledFeatures must be an array of strings");
  }
  const clone: string[] = [];
  for (const feature of denseFeatures.value) {
    if (typeof feature !== "string" || feature.length > MAX_RESTORE_TOP_LEVEL_STRING_LENGTH) {
      return coreError("state.invalidShape", "enabledFeatures must be an array of strings");
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
      return coreError("state.invalidShape", "enabledFeatures must use canonical order without duplicates");
    }
    seen.add(feature);
    const knownIndex = (KNOWN_ENABLED_FEATURES as readonly string[]).indexOf(feature);
    if (knownIndex === -1) {
      continue;
    }
    if (knownIndex <= previousKnownIndex) {
      return coreError("state.invalidShape", "enabledFeatures must use canonical order without duplicates");
    }
    previousKnownIndex = knownIndex;
  }

  return okResult(null);
}

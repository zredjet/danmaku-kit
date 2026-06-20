import { createShootingCore } from "@shooting-sample/shooting-core";
import type {
  AssetKeyRegistry,
  BulletDefinition,
  BulletId,
  ContentRegistry,
  CoreErrorCode,
  CoreResult,
  Difficulty,
  EnabledFeature,
  EnemyDefinition,
  EnemyId,
  GameDefinition,
  GameEvent,
  InputFrame,
  LoadedGame,
  PathDefinition,
  PathId,
  PatternDefinition,
  PatternId,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  PlayerShotId,
  ReadonlyEntityState,
  ReadonlyGameState,
  ReadonlyPlayerState,
  SerializedDeterministicState,
  SerializedEntityId,
  SerializedEnabledFeatureState,
  SerializedGameState,
  SerializedJsonValue,
  SerializedPatternRunnerState,
  SerializedPendingEvent,
  SerializedPrngSnapshot,
  SerializedRuntimeEntityState,
  ShootingCore,
  StageSession,
  StageDefinition,
  StageId,
  StartStageOptions,
  StageTimelineAction,
  StageTimelineStep,
} from "@shooting-sample/shooting-core";

import { createMinimumDefinition } from "./fixtures/minimum-game-definition.ts";

// @ts-expect-error 内部 replay/hash snapshot は root public contract に含めない。
import type { HashableGameState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 PRNG snapshot は root public contract に含めない。
import type { SerializedPrngState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 feature order value は root public contract に含めない。
import { KNOWN_ENABLED_FEATURES } from "@shooting-sample/shooting-core";

// @ts-expect-error serialized runner id helper は root public contract に含めない。
import type { SerializedPatternRunnerId } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only hook factory is not part of the root public contract.
import { createShootingCoreWithTestingHooksForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only core factory is not part of the root public contract.
import { createShootingCoreWithTestingHooks } from "@shooting-sample/shooting-core";

// @ts-expect-error internal test-only core factory is not part of the root public contract.
import { createShootingCoreWithTestingHooksForInternalTest } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only hook options are not part of the root public contract.
import type { StageSessionTestingHooks } from "@shooting-sample/shooting-core";

// @ts-expect-error internal runtime component is not part of the root public contract.
import type { EnemyRuntimeEntity } from "@shooting-sample/shooting-core";

// @ts-expect-error internal enemy bullet runtime component is not part of the root public contract.
import type { EnemyBulletRuntimeEntity } from "@shooting-sample/shooting-core";

// @ts-expect-error internal runtime state is not part of the root public contract.
import type { RuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error internal player shot system result is not part of the root public contract.
import type { PlayerShotSpawnResult } from "@shooting-sample/shooting-core";

// @ts-expect-error internal enemy bullet system result is not part of the root public contract.
import type { EnemyBulletSpawnResult } from "@shooting-sample/shooting-core";

// @ts-expect-error internal collision system result is not part of the root public contract.
import type { CollisionResolutionResult } from "@shooting-sample/shooting-core";

// @ts-expect-error internal enemy bullet system is not importable through a deep package subpath.
import type { EnemyBulletSpawnResult as DeepEnemyBulletSpawnResult } from "@shooting-sample/shooting-core/src/basic/simulation/enemy-bullet-system.ts";

// @ts-expect-error internal collision system is not importable through a deep package subpath.
import type { CollisionResolutionResult as DeepCollisionResolutionResult } from "@shooting-sample/shooting-core/src/basic/simulation/collision-system.ts";

// @ts-expect-error internal core module is not importable through a deep package subpath.
import type { HashableGameState as DeepHashableGameState } from "@shooting-sample/shooting-core/src/basic/core.ts";

// @ts-expect-error internal serialization module is not importable through a deep package subpath.
import type { SerializedGameState as DeepSerializedGameState } from "@shooting-sample/shooting-core/src/basic/serialization/types.ts";

// @ts-expect-error internal validation module is not importable through a deep package subpath.
import type { validateGameDefinition as DeepValidateGameDefinition } from "@shooting-sample/shooting-core/src/basic/content/validation.ts";

// @ts-expect-error internal event module is not importable through a deep package subpath.
import type { EventLog as DeepEventLog } from "@shooting-sample/shooting-core/src/basic/events/game-event.ts";

// @ts-expect-error internal input module is not importable through a deep package subpath.
import type { GameplayActionId as DeepGameplayActionId } from "@shooting-sample/shooting-core/src/basic/input/input-frame.ts";

// @ts-expect-error internal runtime entity module is not importable through a deep package subpath.
import type { EnemyBulletRuntimeEntity as DeepEnemyBulletRuntimeEntity } from "@shooting-sample/shooting-core/src/basic/simulation/runtime-entity.ts";

// @ts-expect-error internal system order contract is not part of the root public contract.
import type { StageTickSystemStep } from "@shooting-sample/shooting-core";

// @ts-expect-error internal vector helper is not part of the root public contract.
import type { Vector2 } from "@shooting-sample/shooting-core";

const core: ShootingCore = createShootingCore("type-contract");

const definition: GameDefinition = createMinimumDefinition();

const input: InputFrame = {
  tick: 0,
  axes: { moveX: 0, moveY: 0 },
  held: [],
  pressed: [],
  released: [],
};
const loaded = core.load(definition);
const loadedAsResult: CoreResult<unknown> = loaded;
const errorCode: CoreErrorCode = "input.invalidShape";
const bulletErrorCode: CoreErrorCode = "bullet.notFound";
const invalidConstraintErrorCode: CoreErrorCode = "definition.invalidConstraint";
const playerShotErrorCode: CoreErrorCode = "playerShot.notFound";
const fatalStageSessionErrorCode: CoreErrorCode = "stageSession.fatal";
const testHookFailureErrorCode: CoreErrorCode = "testHook.failure";
const restoreInvalidShapeErrorCode: CoreErrorCode = "state.invalidShape";
const restoreCoreVersionMismatchErrorCode: CoreErrorCode = "state.coreVersionMismatch";
const restoreSchemaVersionMismatchErrorCode: CoreErrorCode = "state.schemaVersionMismatch";
const restoreInputFormatVersionMismatchErrorCode: CoreErrorCode = "state.inputFormatVersionMismatch";
const restoreStateHashVersionMismatchErrorCode: CoreErrorCode = "state.stateHashVersionMismatch";
const restoreContentMismatchErrorCode: CoreErrorCode = "state.contentMismatch";
const restoreFeatureMismatchErrorCode: CoreErrorCode = "state.featureMismatch";
const restorePrngInvalidErrorCode: CoreErrorCode = "state.prngInvalid";
const restoreRegistryInvalidErrorCode: CoreErrorCode = "state.registryInvalid";
const unsupportedSnapshotErrorCode: CoreErrorCode = "state.unsupportedSnapshot";
const difficulty: Difficulty = "normal";
const enabledFeature: EnabledFeature = "bomb";
const assetKeys: AssetKeyRegistry = { keys: ["player.default"] };
const bulletId: BulletId = "bullet.red_small";
const enemyId: EnemyId = "enemy.scout";
const pathId: PathId = "path.none";
const patternId: PatternId = "pattern.none";
const playerShotId: PlayerShotId = "playerShot.basic";
const stageId: StageId = "stage.stage_01";
const playerId: PlayerId = "player.default";
const playerDefinition: PlayerDefinition = definition.content.players[0]!;
const stageAction: StageTimelineAction = {
  type: "spawnEnemy",
  enemy: enemyId,
  path: pathId,
  pattern: patternId,
  position: { x: 192, y: -16 },
};
const stageStep: StageTimelineStep = { tick: 60, action: stageAction };
const stageDefinition: StageDefinition = definition.content.stages[0]!;
const enemyDefinition: EnemyDefinition = definition.content.enemies[0]!;
const bulletDefinition: BulletDefinition = definition.content.bullets[0]!;
const playerShotDefinition: PlayerShotDefinition = definition.content.playerShots[0]!;
// @ts-expect-error player shot definitions require projectile runtime settings.
const invalidPlayerShotWithoutProjectile: PlayerShotDefinition = {
  id: "playerShot.basic",
  version: 1,
  asset: "shot.player_basic",
  collision: { radius: 5 },
  damage: 5,
  fire: { intervalTicks: 3 },
};
// @ts-expect-error player shot definitions require fire runtime settings.
const invalidPlayerShotWithoutFire: PlayerShotDefinition = {
  id: "playerShot.basic",
  version: 1,
  asset: "shot.player_basic",
  collision: { radius: 5 },
  damage: 5,
  projectile: {
    velocity: { x: 0, y: -8 },
    lifetimeTicks: 3,
  },
};
const invalidPlayerShotFireInterval: PlayerShotDefinition = {
  id: "playerShot.basic",
  version: 1,
  asset: "shot.player_basic",
  collision: { radius: 5 },
  damage: 5,
  fire: {
    // @ts-expect-error player shot fire interval must be numeric.
    intervalTicks: "3",
  },
  projectile: {
    velocity: { x: 0, y: -8 },
    lifetimeTicks: 3,
  },
};
const invalidPlayerShotVelocity: PlayerShotDefinition = {
  id: "playerShot.basic",
  version: 1,
  asset: "shot.player_basic",
  collision: { radius: 5 },
  damage: 5,
  fire: { intervalTicks: 3 },
  projectile: {
    velocity: {
      // @ts-expect-error player shot velocity must be numeric.
      x: "fast",
      y: -8,
    },
    lifetimeTicks: 3,
  },
};
const invalidPlayerShotLifetime: PlayerShotDefinition = {
  id: "playerShot.basic",
  version: 1,
  asset: "shot.player_basic",
  collision: { radius: 5 },
  damage: 5,
  fire: { intervalTicks: 3 },
  projectile: {
    velocity: { x: 0, y: -8 },
    // @ts-expect-error player shot lifetime must be numeric.
    lifetimeTicks: "3",
  },
};
const patternDefinition: PatternDefinition = definition.content.patterns[0]!;
const fireOnSpawnPatternDefinition: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  fireOnSpawn: {
    bullet: "bullet.red_small",
    offset: { x: 0, y: 8 },
  },
};
const invalidFireOnSpawnPatternDefinition: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  fireOnSpawn: {
    // @ts-expect-error fireOnSpawn must reference an enemy bullet id.
    bullet: "enemy.scout",
    offset: { x: 0, y: 8 },
  },
};
const invalidFireOnSpawnPatternWithoutOffset: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  // @ts-expect-error fireOnSpawn requires a deterministic spawn offset.
  fireOnSpawn: {
    bullet: "bullet.red_small",
  },
};
const invalidFireOnSpawnPatternOffsetX: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  fireOnSpawn: {
    bullet: "bullet.red_small",
    offset: {
      // @ts-expect-error fireOnSpawn offset.x must be numeric.
      x: "0",
      y: 8,
    },
  },
};
const invalidFireOnSpawnPatternOffsetY: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  fireOnSpawn: {
    bullet: "bullet.red_small",
    offset: {
      x: 0,
      // @ts-expect-error fireOnSpawn offset.y must be numeric.
      y: "8",
    },
  },
};
const pathDefinition: PathDefinition = definition.content.paths[0]!;
const contentRegistry: ContentRegistry = definition.content;
const serializedEntityId: SerializedEntityId = 1;
const serializedPrngSnapshot: SerializedPrngSnapshot = { state: 1 };
const serializedJsonValue: SerializedJsonValue = { cursor: 0, nested: ["ok", true, null] };
const serializedPendingEvent: SerializedPendingEvent = { type: "stageStarted", tick: 0, stageId: "stage.stage_01" };
const serializedPatternRunnerState: SerializedPatternRunnerState = {
  runnerId: "patternRunner.main",
  patternId: "pattern.none",
  stateVersion: 1,
  payload: serializedJsonValue,
};
const serializedEnabledFeatureState: SerializedEnabledFeatureState = {
  feature: "bomb",
  stateVersion: 1,
  payload: { charges: 0 },
};
const serializedPlayerEntity: SerializedRuntimeEntityState = {
  id: 1,
  kind: "player",
  definitionId: "player.default",
  position: { x: 192, y: 400 },
  collisionRadius: 3,
  lives: 3,
  invincibleTicksRemaining: 0,
  nextShotAllowedTick: 0,
  movement: {
    speed: 4,
    focusSpeed: 1.8,
  },
  shotDefinitionId: "playerShot.basic",
};
const serializedEnemyEntity: SerializedRuntimeEntityState = {
  id: 2,
  kind: "enemy",
  definitionId: "enemy.scout",
  position: { x: 192, y: 80 },
  collisionRadius: 12,
  hp: 10,
  scoreOnKill: 100,
  pathId: "path.none",
  patternId: "pattern.none",
};
const serializedEnemyBulletEntity: SerializedRuntimeEntityState = {
  id: 3,
  kind: "enemyBullet",
  definitionId: "bullet.red_small",
  position: { x: 192, y: 120 },
  collisionRadius: 4,
};
const serializedPlayerShotEntity: SerializedRuntimeEntityState = {
  id: 4,
  kind: "playerShot",
  definitionId: "playerShot.basic",
  position: { x: 192, y: 360 },
  collisionRadius: 5,
  velocity: { x: 0, y: -8 },
  remainingLifetimeTicks: 30,
  damage: 5,
};
const serializedInitialDeterministicState: SerializedDeterministicState = {
  runtimeEntities: [serializedPlayerEntity],
  pendingEvents: [serializedPendingEvent],
  score: 0,
  timelineCursor: 0,
  patternRunnerStates: [],
  enabledFeatureStates: [],
};
const serializedDeterministicState: SerializedDeterministicState = {
  runtimeEntities: [
    serializedPlayerEntity,
    serializedEnemyEntity,
    serializedEnemyBulletEntity,
    serializedPlayerShotEntity,
  ],
  pendingEvents: [],
  score: 100,
  timelineCursor: 1,
  patternRunnerStates: [],
  enabledFeatureStates: [],
};
const serializedGameState: SerializedGameState = {
  coreVersion: "0.0.0",
  schemaVersion: "1",
  contentVersion: "1",
  inputFormatVersion: "1",
  stateHashVersion: 1,
  enabledFeatures: [],
  stageId: "stage.stage_01",
  difficulty: "normal",
  playerId: "player.default",
  expectedTick: 1,
  nextEntityId: 5,
  prngState: serializedPrngSnapshot,
  state: serializedDeterministicState,
};
const serializedInitialGameState: SerializedGameState = {
  ...serializedGameState,
  expectedTick: 0,
  nextEntityId: 2,
  state: serializedInitialDeterministicState,
};
type SerializedPlayerEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "player" }>;
type SerializedEnemyEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "enemy" }>;
type SerializedEnemyBulletEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;
type SerializedPlayerShotEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "playerShot" }>;
const entity: ReadonlyEntityState = {
  id: 1,
  kind: "enemy",
  definitionId: "enemy.scout",
  position: { x: 192, y: -16 },
};
const playerEntity: ReadonlyEntityState = {
  id: 1,
  kind: "player",
  definitionId: "player.default",
  position: { x: 192, y: 400 },
};
const invalidPublicPlayerEntityWithCooldown: ReadonlyEntityState = {
  id: 1,
  kind: "player",
  definitionId: "player.default",
  position: { x: 192, y: 400 },
  // @ts-expect-error shot cooldown is an internal runtime component field.
  nextShotAllowedTick: 0,
};
const enemyBulletEntity: ReadonlyEntityState = {
  id: 2,
  kind: "enemyBullet",
  definitionId: "bullet.red_small",
  position: { x: 192, y: 120 },
};
const playerShotEntity: ReadonlyEntityState = {
  id: 3,
  kind: "playerShot",
  definitionId: "playerShot.basic",
  position: { x: 192, y: 360 },
};
const playerState: ReadonlyPlayerState = { lives: 3, invincibleTicksRemaining: 0 };
const state: ReadonlyGameState = { tick: 0, stageId, playerId, player: playerState, score: 0, entities: [playerEntity, entity] };
const event: GameEvent = { type: "stageStarted", tick: 0, stageId };
const tickedEvent: GameEvent = { type: "tickAdvanced", tick: 0 };
const spawnedEvent: GameEvent = {
  type: "entitySpawned",
  tick: 60,
  entityId: 1,
  entityKind: "enemy",
  definitionId: "enemy.scout",
  path: "path.none",
  pattern: "pattern.none",
  position: { x: 192, y: -16 },
};
const playerShotsSpawnedEvent: GameEvent = {
  type: "playerShotsSpawnedBatch",
  tick: 0,
  shots: [
    {
      entityId: 2,
      definitionId: "playerShot.basic",
      position: { x: 192, y: 400 },
    },
  ],
};
const enemyBulletsSpawnedEvent: GameEvent = {
  type: "enemyBulletsSpawnedBatch",
  tick: 0,
  bullets: [
    {
      entityId: 2,
      definitionId: "bullet.red_small",
      position: { x: 192, y: 80 },
    },
  ],
};
const destroyedEvent: GameEvent = {
  type: "entityDestroyed",
  tick: 0,
  entityId: 2,
  entityKind: "enemy",
  reason: "defeated",
};
const shotDestroyedEvent: GameEvent = {
  type: "entityDestroyed",
  tick: 0,
  entityId: 3,
  entityKind: "playerShot",
  reason: "collision",
};
const playerHitEvent: GameEvent = {
  type: "playerHit",
  tick: 0,
  playerId: "player.default",
  sourceEntityId: 3,
  sourceEntityKind: "enemyBullet",
  livesRemaining: 2,
  invincibleTicksRemaining: 120,
};
const scoreChangedEvent: GameEvent = {
  type: "scoreChanged",
  tick: 0,
  delta: 100,
  total: 100,
  reason: "enemyDefeated",
  enemyId: "enemy.scout",
  entityId: 2,
};
const startOptions: StartStageOptions = {
  stageId: "stage.stage_01",
  difficulty: "normal",
  seed: "seed-1",
};

if (loaded.ok) {
  const publicLoadedGame: LoadedGame = loaded.value;
  const restoredFromPublicLoaded: CoreResult<StageSession> = publicLoadedGame.restore(serializedInitialGameState);
  void restoredFromPublicLoaded;

  const restoredFromSerialized: CoreResult<StageSession> = loaded.value.restore(serializedInitialGameState);
  if (restoredFromSerialized.ok) {
    const serializedAfterRestore: CoreResult<SerializedGameState> = restoredFromSerialized.value.serialize();
    void serializedAfterRestore;
  }

  const started = loaded.value.startStage(startOptions);
  if (started.ok) {
    started.value.tick(input);
    const publicStageSession: StageSession = started.value;
    const serializedFromSession: CoreResult<SerializedGameState> = publicStageSession.serialize();
    const serializedFromInferredSession: CoreResult<SerializedGameState> = started.value.serialize();
    void serializedFromSession;
    void serializedFromInferredSession;
  }
}

// @ts-expect-error load requires a GameDefinition at the public type boundary.
core.load(null);

if (loaded.ok) {
  // @ts-expect-error startStage requires StartStageOptions at the public type boundary.
  loaded.value.startStage(null);
  // @ts-expect-error restore requires SerializedGameState at the public type boundary.
  loaded.value.restore(null);
}

// @ts-expect-error stageId must use the stage.* namespace.
const invalidStartOptions: StartStageOptions = { stageId: "enemy.scout", difficulty: "normal", seed: "seed-1" };

// @ts-expect-error stageStarted event must use a StageId.
const invalidStageEvent: GameEvent = { type: "stageStarted", tick: 0, stageId: "enemy.scout" };

// @ts-expect-error serialized stageStarted events must use a StageId.
const invalidSerializedStageEvent: SerializedPendingEvent = { type: "stageStarted", tick: 0, stageId: "enemy.scout" };

// @ts-expect-error enemy id must use the enemy.* namespace.
const invalidEnemyId: EnemyId = "stage.stage_01";

// @ts-expect-error enemy entity must use an EnemyId definition id.
const invalidEnemyEntity: ReadonlyEntityState = { ...entity, definitionId: "player.default" };

// @ts-expect-error player entity must use a PlayerId definition id.
const invalidPlayerEntity: ReadonlyEntityState = { ...playerEntity, definitionId: "enemy.scout" };

// @ts-expect-error enemy bullet entity must use a BulletId definition id.
const invalidEnemyBulletEntity: ReadonlyEntityState = { ...enemyBulletEntity, definitionId: "enemy.scout" };

// @ts-expect-error player shot entity must use a PlayerShotId definition id.
const invalidPlayerShotEntity: ReadonlyEntityState = { ...playerShotEntity, definitionId: "bullet.red_small" };

// @ts-expect-error serialized player state は deterministic restore 用の shot cooldown を必須にする。
const invalidSerializedPlayerEntity: SerializedRuntimeEntityState = {
  id: 1,
  kind: "player",
  definitionId: "player.default",
  position: { x: 192, y: 400 },
  collisionRadius: 3,
  lives: 3,
  invincibleTicksRemaining: 0,
  movement: { speed: 4, focusSpeed: 1.8 },
  shotDefinitionId: "playerShot.basic",
};

// @ts-expect-error serialized enemy state は deterministic restore 用の pattern id を必須にする。
const invalidSerializedEnemyEntity: SerializedRuntimeEntityState = {
  id: 2,
  kind: "enemy",
  definitionId: "enemy.scout",
  position: { x: 192, y: 80 },
  collisionRadius: 12,
  hp: 10,
  scoreOnKill: 100,
  pathId: "path.none",
};

const invalidSerializedPlayerDefinition: SerializedPlayerEntityForContract = {
  id: 1,
  kind: "player",
  // @ts-expect-error serialized player state の definition id は PlayerId に限定する。
  definitionId: "enemy.scout",
  position: { x: 192, y: 400 },
  collisionRadius: 3,
  lives: 3,
  invincibleTicksRemaining: 0,
  nextShotAllowedTick: 0,
  movement: { speed: 4, focusSpeed: 1.8 },
  shotDefinitionId: "playerShot.basic",
};

const invalidSerializedPlayerShotReference: SerializedRuntimeEntityState = {
  id: 1,
  kind: "player",
  definitionId: "player.default",
  position: { x: 192, y: 400 },
  collisionRadius: 3,
  lives: 3,
  invincibleTicksRemaining: 0,
  nextShotAllowedTick: 0,
  movement: { speed: 4, focusSpeed: 1.8 },
  // @ts-expect-error serialized player state の shot reference は PlayerShotId に限定する。
  shotDefinitionId: "bullet.red_small",
};

const invalidSerializedEnemyDefinition: SerializedEnemyEntityForContract = {
  id: 2,
  kind: "enemy",
  // @ts-expect-error serialized enemy state の definition id は EnemyId に限定する。
  definitionId: "player.default",
  position: { x: 192, y: 80 },
  collisionRadius: 12,
  hp: 10,
  scoreOnKill: 100,
  pathId: "path.none",
  patternId: "pattern.none",
};

const invalidSerializedEnemyPath: SerializedRuntimeEntityState = {
  id: 2,
  kind: "enemy",
  definitionId: "enemy.scout",
  position: { x: 192, y: 80 },
  collisionRadius: 12,
  hp: 10,
  scoreOnKill: 100,
  // @ts-expect-error serialized enemy state の path reference は PathId に限定する。
  pathId: "pattern.none",
  patternId: "pattern.none",
};

const invalidSerializedEnemyPattern: SerializedRuntimeEntityState = {
  id: 2,
  kind: "enemy",
  definitionId: "enemy.scout",
  position: { x: 192, y: 80 },
  collisionRadius: 12,
  hp: 10,
  scoreOnKill: 100,
  pathId: "path.none",
  // @ts-expect-error serialized enemy state の pattern reference は PatternId に限定する。
  patternId: "path.none",
};

const invalidSerializedEnemyBulletDefinition: SerializedEnemyBulletEntityForContract = {
  id: 3,
  kind: "enemyBullet",
  // @ts-expect-error serialized enemy bullet state の definition id は BulletId に限定する。
  definitionId: "playerShot.basic",
  position: { x: 192, y: 120 },
  collisionRadius: 4,
};

const invalidSerializedEnemyBulletProjectile: SerializedRuntimeEntityState = {
  id: 3,
  kind: "enemyBullet",
  definitionId: "bullet.red_small",
  position: { x: 192, y: 120 },
  collisionRadius: 4,
  // @ts-expect-error Phase 1B の enemy bullet serialized state は復元不能な projectile field を持たない。
  projectile: {
    velocity: { x: 0, y: 2 },
    damage: 1,
    remainingLifetimeTicks: null,
  },
};

// @ts-expect-error player shot serialized state は remaining lifetime を必須にする。
const invalidSerializedPlayerShotEntity: SerializedRuntimeEntityState = {
  id: 4,
  kind: "playerShot",
  definitionId: "playerShot.basic",
  position: { x: 192, y: 360 },
  collisionRadius: 5,
  velocity: { x: 0, y: -8 },
  damage: 5,
};

const invalidSerializedPlayerShotDefinition: SerializedPlayerShotEntityForContract = {
  id: 4,
  kind: "playerShot",
  // @ts-expect-error serialized player shot state の definition id は PlayerShotId に限定する。
  definitionId: "bullet.red_small",
  position: { x: 192, y: 360 },
  collisionRadius: 5,
  velocity: { x: 0, y: -8 },
  remainingLifetimeTicks: 30,
  damage: 5,
};

const invalidSerializedGameStateWithTopLevelRuntimeEntities: SerializedGameState = {
  ...serializedGameState,
  // @ts-expect-error deterministic payload は nested state field 配下に置く。
  runtimeEntities: [],
};

// @ts-expect-error serialized deterministic state は deterministic restore 用の timeline cursor を必須にする。
const invalidSerializedDeterministicStateWithoutTimelineCursor: SerializedDeterministicState = {
  runtimeEntities: [],
  pendingEvents: [],
  score: 0,
  patternRunnerStates: [],
  enabledFeatureStates: [],
};

// @ts-expect-error serialized deterministic state は canonical hash input 用の pattern runner state array を必須にする。
const invalidSerializedDeterministicStateWithoutPatternStates: SerializedDeterministicState = {
  runtimeEntities: [],
  pendingEvents: [],
  score: 0,
  timelineCursor: 0,
  enabledFeatureStates: [],
};

// @ts-expect-error serialized game state は state hash version metadata を必須にする。
const invalidSerializedGameStateWithoutHashVersion: SerializedGameState = {
  coreVersion: "0.0.0",
  schemaVersion: "1",
  contentVersion: "1",
  inputFormatVersion: "1",
  enabledFeatures: [],
  stageId: "stage.stage_01",
  difficulty: "normal",
  playerId: "player.default",
  expectedTick: 1,
  nextEntityId: 5,
  prngState: serializedPrngSnapshot,
  state: serializedDeterministicState,
};

// @ts-expect-error serialized game state は nested deterministic payload を必須にする。
const invalidSerializedGameStateWithoutState: SerializedGameState = {
  coreVersion: "0.0.0",
  schemaVersion: "1",
  contentVersion: "1",
  inputFormatVersion: "1",
  stateHashVersion: 1,
  enabledFeatures: [],
  stageId: "stage.stage_01",
  difficulty: "normal",
  playerId: "player.default",
  expectedTick: 1,
  nextEntityId: 5,
  prngState: serializedPrngSnapshot,
};

const invalidSerializedStageEventTick: SerializedPendingEvent = {
  type: "stageStarted",
  // @ts-expect-error serialized stageStarted pending event は tick 0 の drain 前だけ存在する。
  tick: 1,
  stageId: "stage.stage_01",
};

const invalidSerializedEntitySpawnedPendingEvent: SerializedPendingEvent = {
  // @ts-expect-error Phase 1B の serialized pending queue は stageStarted だけを保持する。
  type: "entitySpawned",
  tick: 0,
  entityId: 2,
  entityKind: "enemy",
  definitionId: "enemy.scout",
  path: "path.none",
  pattern: "pattern.none",
  position: { x: 192, y: 80 },
};

const invalidSerializedTickAdvancedPendingEvent: SerializedPendingEvent = {
  // @ts-expect-error serialized pending queue は drain 済み frame event を含めない。
  type: "tickAdvanced",
  tick: 0,
};

const invalidSerializedPlayerEntityWithViewId: SerializedRuntimeEntityState = {
  ...serializedPlayerEntity,
  // @ts-expect-error serialized runtime entity は render-only view id を含めない。
  viewId: "sprite.player",
};

const invalidSerializedPatternRunnerPattern: SerializedPatternRunnerState = {
  runnerId: "patternRunner.main",
  // @ts-expect-error serialized pattern runner state の pattern id は PatternId に限定する。
  patternId: "path.none",
  stateVersion: 1,
  payload: { cursor: 0 },
};

const invalidSerializedPatternRunnerPayload: SerializedPatternRunnerState = {
  runnerId: "patternRunner.main",
  patternId: "pattern.none",
  stateVersion: 1,
  // @ts-expect-error serialized extension payload は JSON 互換に限定する。
  payload: () => 0,
};

const invalidSerializedPatternRunnerId: SerializedPatternRunnerState = {
  // @ts-expect-error serialized pattern runner state の runner id は patternRunner prefix を必須にする。
  runnerId: "runner.1",
  patternId: "pattern.none",
  stateVersion: 1,
  payload: { cursor: 0 },
};
// TypeScript の template literal 型では通るが、restore runtime validation では空 suffix を拒否する。
// 完全な SerializedPatternRunnerState fixture にすると正当な snapshot と誤読しやすいため、値だけを固定する。
const runtimeInvalidPatternRunnerIdWithEmptySuffix: SerializedPatternRunnerState["runnerId"] = "patternRunner.";

const invalidSerializedFeatureStateName: SerializedEnabledFeatureState = {
  // @ts-expect-error serialized feature state の feature 名は既知 feature に限定する。
  feature: "unknown",
  stateVersion: 1,
  payload: { enabled: true },
};

const invalidSerializedFeatureStateVersion: SerializedEnabledFeatureState = {
  feature: "bomb",
  // @ts-expect-error serialized feature state version は number に限定する。
  stateVersion: "1",
  payload: { enabled: true },
};

// @ts-expect-error serialized entity position は public contract 上 immutable にする。
serializedPlayerEntity.position.x = 0;

// @ts-expect-error serialized player movement は public contract 上 immutable にする。
serializedPlayerEntity.movement.speed = 5;

// @ts-expect-error serialized player shot velocity は public contract 上 immutable にする。
serializedPlayerShotEntity.velocity.y = -10;

// @ts-expect-error serialized entity array は public contract 上 immutable にする。
serializedDeterministicState.runtimeEntities.push(serializedPlayerEntity);

// @ts-expect-error serialized pending event array は public contract 上 immutable にする。
serializedDeterministicState.pendingEvents.push(serializedPendingEvent);

// @ts-expect-error serialized pattern runner state array は public contract 上 immutable にする。
serializedDeterministicState.patternRunnerStates.push(serializedPatternRunnerState);

// @ts-expect-error serialized enabled feature state array は public contract 上 immutable にする。
serializedDeterministicState.enabledFeatureStates.push(serializedEnabledFeatureState);

// @ts-expect-error serialized top-level field は public contract 上 immutable にする。
serializedGameState.expectedTick = 2;

// @ts-expect-error serialized enabled feature array は public contract 上 immutable にする。
serializedGameState.enabledFeatures.push("bomb");

// @ts-expect-error serialized deterministic state field は public contract 上 immutable にする。
serializedGameState.state.score = 200;

// @ts-expect-error serialized PRNG snapshot は public contract 上 immutable にする。
serializedPrngSnapshot.state = 2;

// @ts-expect-error event payloads are immutable through the public contract.
event.tick = 1;

// @ts-expect-error nested event payloads are immutable through the public contract.
spawnedEvent.position.x = 0;

// @ts-expect-error nested batch event payloads are immutable through the public contract.
playerShotsSpawnedEvent.shots[0]!.position.x = 0;

// @ts-expect-error batch event shot arrays are immutable through the public contract.
playerShotsSpawnedEvent.shots.push({ entityId: 3, definitionId: "playerShot.basic", position: { x: 192, y: 400 } });

// @ts-expect-error nested enemy bullet event payloads are immutable through the public contract.
enemyBulletsSpawnedEvent.bullets[0]!.position.x = 0;

// @ts-expect-error enemy bullet batch event arrays are immutable through the public contract.
enemyBulletsSpawnedEvent.bullets.push({ entityId: 3, definitionId: "bullet.red_small", position: { x: 192, y: 80 } });

// @ts-expect-error collision event payloads are immutable through the public contract.
destroyedEvent.reason = "collision";

// @ts-expect-error player state payloads are immutable through the public contract.
state.player.lives = 0;

// @ts-expect-error player hit event payloads are immutable through the public contract.
playerHitEvent.livesRemaining = 0;

// @ts-expect-error score event payloads are immutable through the public contract.
scoreChangedEvent.total = 0;

// @ts-expect-error entity.notFound is an internal invariant, not a public CoreErrorCode.
const invalidCoreErrorCode: CoreErrorCode = "entity.notFound";

// @ts-expect-error entityAllocator restore failures are normalized before becoming public restore errors.
const invalidEntityAllocatorRestoreErrorCode: CoreErrorCode = "state.entityAllocatorInvalid";

const invalidEmptyPlayerShotsBatch: GameEvent = {
  type: "playerShotsSpawnedBatch",
  tick: 0,
  // @ts-expect-error player shot batches must contain at least one shot.
  shots: [],
};

const invalidEnemyDestroyedByCollision: GameEvent = {
  type: "entityDestroyed",
  tick: 0,
  entityId: 2,
  entityKind: "enemy",
  // @ts-expect-error enemy destruction is only emitted with the defeated reason.
  reason: "collision",
};

const invalidEnemyBulletDefeated: GameEvent = {
  type: "entityDestroyed",
  tick: 0,
  entityId: 3,
  entityKind: "enemyBullet",
  // @ts-expect-error enemy bullets are only destroyed by collision in the public event contract.
  reason: "defeated",
};

const invalidPlayerShotBatchDefinition: GameEvent = {
  type: "playerShotsSpawnedBatch",
  tick: 0,
  // @ts-expect-error player shot batches require PlayerShotId definition ids.
  shots: [{ entityId: 2, definitionId: "enemy.scout", position: { x: 192, y: 400 } }],
};

const invalidPlayerShotBatchPath: GameEvent = {
  type: "playerShotsSpawnedBatch",
  tick: 0,
  shots: [{ entityId: 2, definitionId: "playerShot.basic", position: { x: 192, y: 400 } }],
  // @ts-expect-error player shot batches do not expose enemy path fields.
  path: "path.none",
};

const invalidEmptyEnemyBulletsBatch: GameEvent = {
  type: "enemyBulletsSpawnedBatch",
  tick: 0,
  // @ts-expect-error enemy bullet batches must contain at least one bullet.
  bullets: [],
};

const invalidEnemyBulletBatchDefinition: GameEvent = {
  type: "enemyBulletsSpawnedBatch",
  tick: 0,
  // @ts-expect-error enemy bullet batches require BulletId definition ids.
  bullets: [{ entityId: 2, definitionId: "playerShot.basic", position: { x: 192, y: 80 } }],
};

const invalidEnemyBulletBatchPath: GameEvent = {
  type: "enemyBulletsSpawnedBatch",
  tick: 0,
  bullets: [{ entityId: 2, definitionId: "bullet.red_small", position: { x: 192, y: 80 } }],
  // @ts-expect-error enemy bullet batches do not expose enemy path fields.
  path: "path.none",
};

const invalidEnemyBulletBatchPattern: GameEvent = {
  type: "enemyBulletsSpawnedBatch",
  tick: 0,
  bullets: [{ entityId: 2, definitionId: "bullet.red_small", position: { x: 192, y: 80 } }],
  // @ts-expect-error enemy bullet batches do not expose enemy pattern fields.
  pattern: "pattern.none",
};

// @ts-expect-error enemy spawn events require pattern.
const invalidEnemySpawnWithoutPattern: GameEvent = {
  type: "entitySpawned",
  tick: 60,
  entityId: 1,
  entityKind: "enemy",
  definitionId: "enemy.scout",
  path: "path.none",
  position: { x: 192, y: -16 },
};

const invalidPlayerShotEntitySpawnedEvent: GameEvent = {
  type: "entitySpawned",
  tick: 0,
  entityId: 2,
  // @ts-expect-error playerShot entities are announced through playerShotsSpawnedBatch.
  entityKind: "playerShot",
  // @ts-expect-error entitySpawned definition ids must be EnemyId values.
  definitionId: "playerShot.basic",
  position: { x: 192, y: 400 },
};

// @ts-expect-error readonly state entities cannot be mutated through the public contract.
state.entities[0] = entity;

// @ts-expect-error nested entity positions are immutable through the public contract.
playerEntity.position.x = 0;

function assertEventExhaustive(value: GameEvent): number {
  switch (value.type) {
    case "stageStarted":
      return value.tick;
    case "tickAdvanced":
      return value.tick;
    case "entitySpawned":
      return value.entityId;
    case "entityDestroyed":
      return value.entityId;
    case "playerHit":
      return value.livesRemaining;
    case "playerShotsSpawnedBatch":
      return value.shots.length;
    case "enemyBulletsSpawnedBatch":
      return value.bullets.length;
    case "scoreChanged":
      return value.total;
    default: {
      const neverEvent: never = value;
      return neverEvent;
    }
  }
}

if (loaded.ok) {
  const maybeStarted = loaded.value.startStage(startOptions);
  if (maybeStarted.ok) {
    // @ts-expect-error tick requires an InputFrame at the public type boundary.
    maybeStarted.value.tick({ tick: 0 });
    // @ts-expect-error serialize は引数を受け取らない。
    maybeStarted.value.serialize(input);
  }
}

void input;
void loaded;
void loadedAsResult;
void errorCode;
void bulletErrorCode;
void invalidConstraintErrorCode;
void playerShotErrorCode;
void fatalStageSessionErrorCode;
void testHookFailureErrorCode;
void restoreInvalidShapeErrorCode;
void restoreCoreVersionMismatchErrorCode;
void restoreSchemaVersionMismatchErrorCode;
void restoreInputFormatVersionMismatchErrorCode;
void restoreStateHashVersionMismatchErrorCode;
void restoreContentMismatchErrorCode;
void restoreFeatureMismatchErrorCode;
void unsupportedSnapshotErrorCode;
void difficulty;
void enabledFeature;
void assetKeys;
void bulletId;
void enemyId;
void pathId;
void patternId;
void playerShotId;
void playerDefinition;
void stageAction;
void stageStep;
void stageDefinition;
void enemyDefinition;
void bulletDefinition;
void playerShotDefinition;
void invalidPlayerShotWithoutProjectile;
void invalidPlayerShotVelocity;
void invalidPlayerShotLifetime;
void patternDefinition;
void fireOnSpawnPatternDefinition;
void invalidFireOnSpawnPatternDefinition;
void invalidFireOnSpawnPatternWithoutOffset;
void invalidFireOnSpawnPatternOffsetX;
void invalidFireOnSpawnPatternOffsetY;
void pathDefinition;
void contentRegistry;
void serializedEntityId;
void serializedPrngSnapshot;
void serializedJsonValue;
void serializedPendingEvent;
void serializedPatternRunnerState;
void serializedEnabledFeatureState;
void serializedPlayerEntity;
void serializedEnemyEntity;
void serializedEnemyBulletEntity;
void serializedPlayerShotEntity;
void serializedDeterministicState;
void serializedGameState;
void invalidSerializedPlayerEntity;
void invalidSerializedEnemyEntity;
void invalidSerializedPlayerDefinition;
void invalidSerializedPlayerShotReference;
void invalidSerializedEnemyDefinition;
void invalidSerializedEnemyPath;
void invalidSerializedEnemyPattern;
void invalidSerializedEnemyBulletDefinition;
void invalidSerializedEnemyBulletProjectile;
void invalidSerializedPlayerShotEntity;
void invalidSerializedPlayerShotDefinition;
void invalidSerializedGameStateWithTopLevelRuntimeEntities;
void invalidSerializedDeterministicStateWithoutTimelineCursor;
void invalidSerializedDeterministicStateWithoutPatternStates;
void invalidSerializedGameStateWithoutHashVersion;
void invalidSerializedGameStateWithoutState;
void invalidSerializedStageEvent;
void invalidSerializedStageEventTick;
void invalidSerializedEntitySpawnedPendingEvent;
void invalidSerializedTickAdvancedPendingEvent;
void invalidSerializedPlayerEntityWithViewId;
void invalidSerializedPatternRunnerPattern;
void invalidSerializedPatternRunnerPayload;
void invalidSerializedPatternRunnerId;
void runtimeInvalidPatternRunnerIdWithEmptySuffix;
void invalidSerializedFeatureStateName;
void invalidSerializedFeatureStateVersion;
void serializedInitialGameState;
void playerState;
void state;
void playerEntity;
void enemyBulletEntity;
void playerShotEntity;
void event;
void tickedEvent;
void spawnedEvent;
void playerShotsSpawnedEvent;
void enemyBulletsSpawnedEvent;
void destroyedEvent;
void shotDestroyedEvent;
void playerHitEvent;
void scoreChangedEvent;
void invalidStartOptions;
void invalidStageEvent;
void invalidEnemyId;
void invalidEnemyEntity;
void invalidPlayerEntity;
void invalidEnemyBulletEntity;
void invalidPlayerShotEntity;
void invalidCoreErrorCode;
void invalidEntityAllocatorRestoreErrorCode;
void restorePrngInvalidErrorCode;
void restoreRegistryInvalidErrorCode;
void invalidEmptyPlayerShotsBatch;
void invalidEnemyDestroyedByCollision;
void invalidEnemyBulletDefeated;
void invalidPlayerShotBatchDefinition;
void invalidPlayerShotBatchPath;
void invalidEmptyEnemyBulletsBatch;
void invalidEnemyBulletBatchDefinition;
void invalidEnemyBulletBatchPath;
void invalidEnemyBulletBatchPattern;
void invalidEnemySpawnWithoutPattern;
void invalidPlayerShotEntitySpawnedEvent;
void assertEventExhaustive;
void KNOWN_ENABLED_FEATURES;
void (undefined as unknown as HashableGameState);
void (undefined as unknown as SerializedPrngState);
void (undefined as unknown as SerializedPatternRunnerId);
void (undefined as unknown as EnemyRuntimeEntity);
void (undefined as unknown as EnemyBulletRuntimeEntity);
void (undefined as unknown as RuntimeEntityState);
void (undefined as unknown as PlayerShotSpawnResult);
void (undefined as unknown as EnemyBulletSpawnResult);
void (undefined as unknown as CollisionResolutionResult);
void (undefined as unknown as DeepEnemyBulletSpawnResult);
void (undefined as unknown as DeepCollisionResolutionResult);
void (undefined as unknown as DeepHashableGameState);
void (undefined as unknown as DeepSerializedGameState);
void (undefined as unknown as DeepValidateGameDefinition);
void (undefined as unknown as DeepEventLog);
void (undefined as unknown as DeepGameplayActionId);
void (undefined as unknown as DeepEnemyBulletRuntimeEntity);
void (undefined as unknown as StageTickSystemStep);
void (undefined as unknown as Vector2);

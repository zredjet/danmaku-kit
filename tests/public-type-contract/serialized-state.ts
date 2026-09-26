// SerializedGameState と restore payload DTO の shape と readonly 性を固定する。

import type {
  SerializedDeterministicState,
  SerializedEnabledFeatureState,
  SerializedEntityId,
  SerializedGameState,
  SerializedJsonValue,
  SerializedPatternRunnerState,
  SerializedPendingEvent,
  SerializedPrngSnapshot,
  SerializedRuntimeEntityState,
} from "@shooting-sample/shooting-core";

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
  pathRunnerState: { segmentIndex: 0, segmentStart: { x: 192, y: 80 }, segmentElapsedTicks: 0 },
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
  stateHashVersion: 2,
  enabledFeatures: [],
  stageId: "stage.stage_01",
  difficulty: "normal",
  playerId: "player.default",
  expectedTick: 1,
  nextEntityId: 5,
  prngState: serializedPrngSnapshot,
  state: serializedDeterministicState,
};
export const serializedInitialGameState: SerializedGameState = {
  ...serializedGameState,
  expectedTick: 0,
  nextEntityId: 2,
  state: serializedInitialDeterministicState,
};
type SerializedPlayerEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "player" }>;
type SerializedEnemyEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "enemy" }>;
type SerializedEnemyBulletEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;
type SerializedPlayerShotEntityForContract = Extract<SerializedRuntimeEntityState, { kind: "playerShot" }>;

// @ts-expect-error serialized stageStarted events must use a StageId.
const invalidSerializedStageEvent: SerializedPendingEvent = { type: "stageStarted", tick: 0, stageId: "enemy.scout" };

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
  pathRunnerState: { segmentIndex: 0, segmentStart: { x: 192, y: 80 }, segmentElapsedTicks: 0 },
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
  pathRunnerState: { segmentIndex: 0, segmentStart: { x: 192, y: 80 }, segmentElapsedTicks: 0 },
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
  pathRunnerState: { segmentIndex: 0, segmentStart: { x: 192, y: 80 }, segmentElapsedTicks: 0 },
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
  pathRunnerState: { segmentIndex: 0, segmentStart: { x: 192, y: 80 }, segmentElapsedTicks: 0 },
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
  stateHashVersion: 2,
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

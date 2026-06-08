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
  ShootingCore,
  StageDefinition,
  StageId,
  StartStageOptions,
  StageTimelineAction,
  StageTimelineStep,
} from "@shooting-sample/shooting-core";

import { createMinimumDefinition } from "./fixtures/minimum-game-definition.ts";

// @ts-expect-error internal replay/hash snapshot is not part of the root public contract.
import type { HashableGameState } from "@shooting-sample/shooting-core";

// @ts-expect-error internal PRNG snapshot is not part of the root public contract.
import type { SerializedPrngState } from "@shooting-sample/shooting-core";

// @ts-expect-error internal runtime component is not part of the root public contract.
import type { EnemyRuntimeEntity } from "@shooting-sample/shooting-core";

// @ts-expect-error internal runtime state is not part of the root public contract.
import type { RuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error internal player shot system result is not part of the root public contract.
import type { PlayerShotSpawnResult } from "@shooting-sample/shooting-core";

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
const playerShotErrorCode: CoreErrorCode = "playerShot.notFound";
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
const pathDefinition: PathDefinition = definition.content.paths[0]!;
const contentRegistry: ContentRegistry = definition.content;
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
const state: ReadonlyGameState = { tick: 0, stageId, playerId, score: 0, entities: [playerEntity, entity] };
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
const startOptions: StartStageOptions = {
  stageId: "stage.stage_01",
  difficulty: "normal",
  seed: "seed-1",
};

if (loaded.ok) {
  const started = loaded.value.startStage(startOptions);
  if (started.ok) {
    started.value.tick(input);
  }
}

// @ts-expect-error load requires a GameDefinition at the public type boundary.
core.load(null);

if (loaded.ok) {
  // @ts-expect-error startStage requires StartStageOptions at the public type boundary.
  loaded.value.startStage(null);
}

// @ts-expect-error stageId must use the stage.* namespace.
const invalidStartOptions: StartStageOptions = { stageId: "enemy.scout", difficulty: "normal", seed: "seed-1" };

// @ts-expect-error stageStarted event must use a StageId.
const invalidStageEvent: GameEvent = { type: "stageStarted", tick: 0, stageId: "enemy.scout" };

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

// @ts-expect-error event payloads are immutable through the public contract.
event.tick = 1;

// @ts-expect-error nested event payloads are immutable through the public contract.
spawnedEvent.position.x = 0;

// @ts-expect-error nested batch event payloads are immutable through the public contract.
playerShotsSpawnedEvent.shots[0]!.position.x = 0;

// @ts-expect-error batch event shot arrays are immutable through the public contract.
playerShotsSpawnedEvent.shots.push({ entityId: 3, definitionId: "playerShot.basic", position: { x: 192, y: 400 } });

// @ts-expect-error entity.notFound is an internal invariant, not a public CoreErrorCode.
const invalidCoreErrorCode: CoreErrorCode = "entity.notFound";

const invalidEmptyPlayerShotsBatch: GameEvent = {
  type: "playerShotsSpawnedBatch",
  tick: 0,
  // @ts-expect-error player shot batches must contain at least one shot.
  shots: [],
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
    case "playerShotsSpawnedBatch":
      return value.shots.length;
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
  }
}

void input;
void loaded;
void loadedAsResult;
void errorCode;
void playerShotErrorCode;
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
void pathDefinition;
void contentRegistry;
void state;
void playerEntity;
void enemyBulletEntity;
void playerShotEntity;
void event;
void tickedEvent;
void spawnedEvent;
void playerShotsSpawnedEvent;
void invalidStartOptions;
void invalidStageEvent;
void invalidEnemyId;
void invalidEnemyEntity;
void invalidPlayerEntity;
void invalidEnemyBulletEntity;
void invalidPlayerShotEntity;
void invalidCoreErrorCode;
void invalidEmptyPlayerShotsBatch;
void invalidPlayerShotBatchDefinition;
void invalidPlayerShotBatchPath;
void invalidEnemySpawnWithoutPattern;
void invalidPlayerShotEntitySpawnedEvent;
void assertEventExhaustive;
void (undefined as unknown as HashableGameState);
void (undefined as unknown as SerializedPrngState);
void (undefined as unknown as EnemyRuntimeEntity);
void (undefined as unknown as RuntimeEntityState);
void (undefined as unknown as PlayerShotSpawnResult);
void (undefined as unknown as StageTickSystemStep);
void (undefined as unknown as Vector2);

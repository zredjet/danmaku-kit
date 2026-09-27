// ReadonlyGameState / ReadonlyEntityState と GameEvent の公開 shape と readonly 性を固定する。

import type {
  EnemyId,
  GameEvent,
  ReadonlyEntityState,
  ReadonlyFeatureFrameState,
  ReadonlyGameState,
  ReadonlyPickupState,
  ReadonlyPlayerState,
} from "@shooting-sample/shooting-core";
import { playerId, stageId } from "./content-definitions.ts";

// Phase 2B-6: pickup feature が有効な content の frame は `state.features.pickups` を持つ。
const pickupState: ReadonlyPickupState = { id: 4, definitionId: "pickup.score_small", position: { x: 182, y: 380 }, attracted: false };
const featureFrame: ReadonlyFeatureFrameState = { pickups: [pickupState] };
// @ts-expect-error frame pickups reference pickup ids.
const invalidPickupState: ReadonlyPickupState = { ...pickupState, definitionId: "enemy.scout" };
const pickupCollectedEvent: GameEvent = { type: "pickupCollected", tick: 7, entityId: 5, definitionId: "pickup.score_small" };
const pickupScoreEvent: GameEvent = {
  type: "scoreChanged",
  tick: 7,
  delta: 100,
  total: 200,
  reason: "pickupCollected",
  pickupId: "pickup.score_small",
  entityId: 5,
};
// @ts-expect-error pickup score changes name the pickup, not an enemy.
const invalidPickupScoreEvent: GameEvent = { ...pickupScoreEvent, enemyId: "enemy.scout" };
void featureFrame;
void invalidPickupState;
void pickupCollectedEvent;
void invalidPickupScoreEvent;

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
const state: ReadonlyGameState = {
  tick: 0,
  stageId,
  playerId,
  status: "playing",
  player: playerState,
  score: 0,
  entities: [playerEntity, entity],
};
const endedState: ReadonlyGameState = { ...state, status: "gameOver" };
// @ts-expect-error frame status is playing, stageCleared or gameOver.
const invalidStatusState: ReadonlyGameState = { ...state, status: "paused" };
const stageClearedEvent: GameEvent = { type: "stageCleared", tick: 600, stageId };
const gameOverEvent: GameEvent = { type: "gameOver", tick: 240, stageId };
// @ts-expect-error stage end events carry the stage id.
const invalidGameOverEvent: GameEvent = { type: "gameOver", tick: 240 };
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
    case "stageCleared":
    case "gameOver":
      return value.tick;
    case "pickupsSpawnedBatch":
      return value.pickups.length;
    case "pickupCollected":
      return value.entityId;
    default: {
      const neverEvent: never = value;
      return neverEvent;
    }
  }
}

void playerState;
void state;
void endedState;
void invalidStatusState;
void stageClearedEvent;
void gameOverEvent;
void invalidGameOverEvent;
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
void invalidStageEvent;
void invalidEnemyId;
void invalidEnemyEntity;
void invalidPlayerEntity;
void invalidEnemyBulletEntity;
void invalidPlayerShotEntity;
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

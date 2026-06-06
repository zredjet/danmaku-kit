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

// @ts-expect-error internal runtime components are not part of the root public contract.
import type { EnemyRuntimeEntity, RuntimeEntityState, Vector2 } from "@shooting-sample/shooting-core";

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
void invalidStartOptions;
void invalidStageEvent;
void invalidEnemyId;
void invalidEnemyEntity;
void invalidPlayerEntity;
void invalidEnemyBulletEntity;
void invalidPlayerShotEntity;
void assertEventExhaustive;
void (undefined as unknown as HashableGameState);
void (undefined as unknown as SerializedPrngState);
void (undefined as unknown as EnemyRuntimeEntity);
void (undefined as unknown as RuntimeEntityState);
void (undefined as unknown as Vector2);

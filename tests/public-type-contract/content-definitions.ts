// GameDefinition / ContentRegistry と content definition の公開型を固定する。

import type {
  AssetKeyRegistry,
  BulletDefinition,
  BulletId,
  ContentRegistry,
  Difficulty,
  EnabledFeature,
  EnemyDefinition,
  EnemyId,
  GameDefinition,
  PathDefinition,
  PathId,
  PatternDefinition,
  PatternId,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  PlayerShotId,
  StageDefinition,
  StageId,
  StageTimelineAction,
  StageTimelineStep,
} from "@shooting-sample/shooting-core";
import { createMinimumDefinition } from "../fixtures/minimum-game-definition.ts";

export const definition: GameDefinition = createMinimumDefinition();

const difficulty: Difficulty = "normal";
const enabledFeature: EnabledFeature = "bomb";
const assetKeys: AssetKeyRegistry = { keys: ["player.default"] };
const bulletId: BulletId = "bullet.red_small";
const enemyId: EnemyId = "enemy.scout";
const pathId: PathId = "path.none";
const patternId: PatternId = "pattern.none";
const playerShotId: PlayerShotId = "playerShot.basic";
export const stageId: StageId = "stage.stage_01";
export const playerId: PlayerId = "player.default";
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

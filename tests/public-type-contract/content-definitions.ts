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
const movingFireOnSpawnPatternDefinition: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  fireOnSpawn: {
    bullet: "bullet.red_small",
    offset: { x: 0, y: 8 },
    velocity: { x: 0, y: 3 },
  },
};
const invalidFireOnSpawnPatternVelocity: PatternDefinition = {
  id: "pattern.spawn_bullet",
  version: 1,
  fireOnSpawn: {
    bullet: "bullet.red_small",
    offset: { x: 0, y: 8 },
    velocity: {
      x: 0,
      // @ts-expect-error fireOnSpawn velocity.y must be numeric.
      y: "3",
    },
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
const stepsPatternDefinition: PatternDefinition = {
  id: "pattern.scout_three_way",
  version: 1,
  steps: [
    { wait: 20 },
    {
      fire: {
        bullet: "bullet.red_small",
        origin: "self",
        aim: "player",
        fan: { count: 3, spreadDeg: 24 },
        speed: 2.4,
      },
    },
    { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 3 } },
    { wait: 50 },
    { loop: 0 },
  ],
};
// Phase 2B-2: repeat（load 時に展開）、radial（1 周を等分）、stream（速さを段階的に変えて重ねる）。
const repeatRadialStreamPatternDefinition: PatternDefinition = {
  id: "pattern.gunship_burst",
  version: 1,
  steps: [
    {
      repeat: {
        count: 3,
        steps: [
          { fire: { bullet: "bullet.red_small", angleDeg: 90, radial: { count: 12 }, stream: { count: 2, speedStep: 0.5 }, speed: 1.5 } },
          { wait: 10 },
        ],
      },
    },
    { wait: 60 },
    { loop: 0 },
  ],
};
const invalidPatternRepeatCount: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error repeat count must be a number.
    { repeat: { count: "3", steps: [{ wait: 1 }] } },
  ],
};
const invalidPatternStream: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error stream needs the speed step between bullets.
    { fire: { bullet: "bullet.red_small", aim: "player", speed: 2, stream: { count: 3 } } },
  ],
};
const invalidPatternFireWithAimAndAngle: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error fire aims at the player or uses a fixed angle, not both.
    { fire: { bullet: "bullet.red_small", aim: "player", angleDeg: 90, speed: 3 } },
  ],
};
const invalidPatternFireWithoutDirection: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error fire requires aim or angleDeg.
    { fire: { bullet: "bullet.red_small", speed: 3 } },
  ],
};
const invalidPatternFireOrigin: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error fire origin supports only the firing enemy.
    { fire: { bullet: "bullet.red_small", origin: "player", aim: "player", speed: 3 } },
  ],
};
const invalidPatternFireBullet: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error fire must reference an enemy bullet id.
    { fire: { bullet: "enemy.scout", aim: "player", speed: 3 } },
  ],
};
const invalidPatternWait: PatternDefinition = {
  id: "pattern.invalid",
  version: 1,
  steps: [
    // @ts-expect-error wait must be a tick count.
    { wait: "20" },
  ],
};
const pathDefinition: PathDefinition = definition.content.paths[0]!;
const velocityPathDefinition: PathDefinition = {
  id: "path.down",
  version: 1,
  segments: [
    { type: "velocity", duration: 60, velocity: { x: 0, y: 2 } },
    { type: "velocity", duration: 30, velocity: { x: 1.5, y: 0 } },
  ],
};
const sinePathDefinition: PathDefinition = {
  id: "path.wave",
  version: 1,
  segments: [
    {
      type: "velocity",
      duration: 120,
      velocity: { x: 0, y: 1.5 },
      offset: { type: "sine", axis: "x", amplitude: 32, periodTicks: 120 },
    },
  ],
};
const invalidPathSineOffsetAxis: PathDefinition = {
  id: "path.wave",
  version: 1,
  segments: [
    {
      type: "velocity",
      duration: 120,
      velocity: { x: 0, y: 1.5 },
      // @ts-expect-error sine offsets move along the x or y axis only.
      offset: { type: "sine", axis: "z", amplitude: 32, periodTicks: 120 },
    },
  ],
};
const invalidPathSegmentType: PathDefinition = {
  id: "path.sine",
  version: 1,
  segments: [
    // @ts-expect-error path segments support only velocity segments.
    { type: "sine", duration: 60, velocity: { x: 0, y: 2 } },
  ],
};
const invalidPathSegmentDuration: PathDefinition = {
  id: "path.down",
  version: 1,
  segments: [
    // @ts-expect-error path segment duration must be numeric.
    { type: "velocity", duration: "60", velocity: { x: 0, y: 2 } },
  ],
};
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
void movingFireOnSpawnPatternDefinition;
void invalidFireOnSpawnPatternVelocity;
void stepsPatternDefinition;
void repeatRadialStreamPatternDefinition;
void invalidPatternRepeatCount;
void invalidPatternStream;
void invalidPatternFireWithAimAndAngle;
void invalidPatternFireWithoutDirection;
void invalidPatternFireOrigin;
void invalidPatternFireBullet;
void invalidPatternWait;
void pathDefinition;
void velocityPathDefinition;
void sinePathDefinition;
void invalidPathSineOffsetAxis;
void invalidPathSegmentType;
void invalidPathSegmentDuration;
void contentRegistry;

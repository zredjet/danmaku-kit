import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { GameDefinition } from "../content/types.ts";

export function createCollisionScoreDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.none",
            position: { x: 192, y: 380 },
          },
        }],
      }],
      playerShots: [{
        ...definition.content.playerShots[0]!,
        damage: 10,
      }],
    },
  };
}

export function createEnemyBulletHitDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.spawn_bullet",
            position: { x: 192, y: 392 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.spawn_bullet",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: 0, y: 8 },
        },
      }],
    },
  };
}

export function createFireOnSpawnAtZeroDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.spawn_bullet",
            position: { x: 192, y: 80 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.spawn_bullet",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: 0, y: 8 },
        },
      }],
    },
  };
}

export function createFutureTimelineAfterRestoreDefinition(): GameDefinition {
  const definition = createFireOnSpawnAtZeroDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          ...definition.content.stages[0]!.timeline,
          {
            tick: 2,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.spawn_bullet",
              position: { x: 128, y: 96 },
            },
          },
        ],
      }],
    },
  };
}

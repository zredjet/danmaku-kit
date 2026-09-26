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

/**
 * path で動く enemy を 2 体出す definition。
 *
 * tick 0 の enemy は `path.descend` で 5 tick 動いて playfield 内に止まり、spawn tick に `fireOnSpawn` で敵弾を出す。tick 2 の enemy は
 * `path.exit` で 10 tick 上へ動き、path を終えた tick に cleanup 余白（64 px）の外に出る。
 */
export function createEnemyPathDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          {
            tick: 0,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.descend",
              pattern: "pattern.spawn_bullet",
              position: { x: 100, y: -16 },
            },
          },
          {
            tick: 2,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.exit",
              pattern: "pattern.none",
              position: { x: 40, y: 40 },
            },
          },
        ],
      }],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.spawn_bullet",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: 0, y: 8 },
          },
        },
      ],
      paths: [
        ...definition.content.paths,
        {
          id: "path.descend",
          version: 1,
          segments: [
            { type: "velocity", duration: 3, velocity: { x: 0, y: 2 } },
            { type: "velocity", duration: 2, velocity: { x: 1.5, y: 0 } },
          ],
        },
        {
          id: "path.exit",
          version: 1,
          segments: [{ type: "velocity", duration: 10, velocity: { x: 0, y: -16 } }],
        },
      ],
    },
  };
}

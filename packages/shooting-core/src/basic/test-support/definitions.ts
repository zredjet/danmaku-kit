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

/**
 * tick 0 に動く敵弾を 2 発出す definition。
 *
 * (192, 100) の enemy は下向き（0, 6）の敵弾を (192, 108) から撃ち、敵弾は tick 47 に自機（192, 400）へ当たる。(50, 100) の enemy は
 * 上向き（0, -8）の敵弾を撃ち、敵弾は 17 tick 目（tick 16）に cleanup 余白（32 px）の外に出る。
 */
export function createMovingEnemyBulletDefinition(): GameDefinition {
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
              path: "path.none",
              pattern: "pattern.down",
              position: { x: 192, y: 100 },
            },
          },
          {
            tick: 0,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.up",
              position: { x: 50, y: 100 },
            },
          },
        ],
      }],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.down",
          version: 1,
          fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 8 }, velocity: { x: 0, y: 6 } },
        },
        {
          id: "pattern.up",
          version: 1,
          fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 0 }, velocity: { x: 0, y: -8 } },
        },
      ],
    },
  };
}

type TimelineSpawnPatternId = `pattern.${string}`;

function spawnScoutAt(tick: number, pattern: TimelineSpawnPatternId, position: { x: number; y: number }) {
  return {
    tick,
    action: { type: "spawnEnemy", enemy: "enemy.scout", path: "path.none", pattern, position },
  } as const;
}

/**
 * PatternProgram の steps で撃つ enemy を出す definition。
 *
 * tick 0 に `pattern.aimed_three_way`（2 tick 待ってから自機狙いの 3-way を 3 tick ごと、id 2）と `pattern.ring`（spawn tick から
 * 4 方向を 4 tick ごと、id 3）の enemy を出す。tick 4 に fireOnSpawn の enemy（id 11）と `pattern.ring` の enemy（id 12）を出し、
 * 同じ tick の fireOnSpawn と pattern の採番順と、runnerId の UTF-8 順を確かめる。
 */
export function createEnemyPatternDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          spawnScoutAt(0, "pattern.aimed_three_way", { x: 192, y: 100 }),
          spawnScoutAt(0, "pattern.ring", { x: 100, y: 50 }),
          spawnScoutAt(4, "pattern.spawn_down", { x: 300, y: 60 }),
          spawnScoutAt(4, "pattern.ring", { x: 250, y: 80 }),
        ],
      }],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.aimed_three_way",
          version: 1,
          steps: [
            { wait: 2 },
            { fire: { bullet: "bullet.red_small", aim: "player", fan: { count: 3, spreadDeg: 24 }, speed: 2 } },
            { wait: 3 },
            { loop: 1 },
          ],
        },
        {
          id: "pattern.ring",
          version: 1,
          steps: [
            { fire: { bullet: "bullet.red_small", angleDeg: 90, fan: { count: 4, spreadDeg: 90 }, speed: 1 } },
            { wait: 4 },
            { loop: 0 },
          ],
        },
        {
          id: "pattern.spawn_down",
          version: 1,
          fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 8 }, velocity: { x: 0, y: 3 } },
        },
      ],
    },
  };
}

const DOWNWARD_STREAM_STEPS = Object.freeze([
  { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 1 } },
  { wait: 1 },
  { loop: 0 },
] as const);

/** 自機の shot で spawn tick に撃破される enemy（`createCollisionScoreDefinition`）が、spawn tick から毎 tick 真下へ撃つ definition。 */
export function createDestroyedPatternEnemyDefinition(): GameDefinition {
  const definition = createCollisionScoreDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [spawnScoutAt(0, "pattern.down_stream", { x: 192, y: 380 })],
      }],
      patterns: [...definition.content.patterns, { id: "pattern.down_stream", version: 1, steps: DOWNWARD_STREAM_STEPS }],
    },
  };
}

/**
 * 6 tick で上へ抜ける enemy が、spawn tick から毎 tick 真下へ撃つ definition。
 *
 * path を終えた tick 5 に y = 24 - 96 = -72 で cleanup 余白（64 px）を越えて取り除かれるため、tick 5 の発射が最後になる。
 */
export function createExitingPatternEnemyDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: { type: "spawnEnemy", enemy: "enemy.scout", path: "path.rise", pattern: "pattern.down_stream", position: { x: 40, y: 24 } },
        }],
      }],
      paths: [
        ...definition.content.paths,
        { id: "path.rise", version: 1, segments: [{ type: "velocity", duration: 6, velocity: { x: 0, y: -16 } }] },
      ],
      patterns: [...definition.content.patterns, { id: "pattern.down_stream", version: 1, steps: DOWNWARD_STREAM_STEPS }],
    },
  };
}

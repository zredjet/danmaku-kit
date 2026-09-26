import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../../tests/fixtures/minimum-game-definition.ts";
import type { LoadedGame } from "../../api-types.ts";
import type { GameDefinition } from "../../content/types.ts";
import { createShootingCore } from "../../core.ts";
import { createEmptyInputFrame } from "../../input/input-frame.ts";
import { createMovingEnemyBulletDefinition } from "../../test-support/definitions.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../test-support/stage-harness.ts";
import type { SerializedGameState, SerializedRuntimeEntityState } from "../types.ts";

type SerializedEnemyBullet = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;

function loadGame(definition: GameDefinition): LoadedGame {
  const loaded = createShootingCore("0.0.0").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  return loaded.value;
}

function serializeAt(game: LoadedGame, ticks: number): SerializedGameState {
  const session = startStageFromLoadedGame(game);
  for (let tick = 0; tick < ticks; tick += 1) {
    assertTickOk(session.tick(createEmptyInputFrame(tick)), `tick ${tick}`);
  }
  return assertSerializeOk(session.serialize(), `serialize at ${ticks}`);
}

/** runtimeEntities の enemy bullet id を差し替えた snapshot を作る。 */
function withBullet(state: SerializedGameState, id: number, change: (bullet: SerializedEnemyBullet) => unknown): unknown {
  return {
    ...state,
    state: {
      ...state.state,
      runtimeEntities: state.state.runtimeEntities.map((entity) => (
        entity.kind === "enemyBullet" && entity.id === id ? change(entity) : entity
      )),
    },
  };
}

function expectInvalidShape(game: LoadedGame, state: unknown, message: RegExp): void {
  const restored = game.restore(state as SerializedGameState);
  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
  assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", message);
}

test("serializes the motion of moving enemy bullets and restores it", () => {
  const game = loadGame(createMovingEnemyBulletDefinition());
  const state = serializeAt(game, 10);

  assert.deepEqual(
    state.state.runtimeEntities.flatMap((entity) => entity.kind === "enemyBullet"
      ? [[entity.id, entity.position, entity.velocity, entity.spawnPosition, entity.ageTicks]]
      : []),
    [
      [4, { x: 192, y: 168 }, { x: 0, y: 6 }, { x: 192, y: 108 }, 10],
      [5, { x: 50, y: 20 }, { x: 0, y: -8 }, { x: 50, y: 100 }, 10],
    ],
  );
  assert.equal(game.restore(state).ok, true);
});

test("rejects enemy bullet motion that does not follow from the processed fireOnSpawn", () => {
  const game = loadGame(createMovingEnemyBulletDefinition());
  const state = serializeAt(game, 10);
  const moveFromSpawn = /must move from a processed timeline spawn/;

  // 1 tick 前の位置と経過 tick は等速直線運動としては正しいが、生成 tick から expectedTick までの tick 数と合わない。
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({ ...bullet, position: { x: 192, y: 162 }, ageTicks: 9 })), moveFromSpawn);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({ ...bullet, position: { x: 192, y: 169 } })), moveFromSpawn);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({
    ...bullet,
    velocity: { x: 0, y: 5 },
    position: { x: 192, y: 158 },
  })), moveFromSpawn);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({
    ...bullet,
    spawnPosition: { x: 192, y: 110 },
    position: { x: 192, y: 170 },
  })), moveFromSpawn);
});

test("rejects malformed enemy bullet motion fields", () => {
  const game = loadGame(createMovingEnemyBulletDefinition());
  const state = serializeAt(game, 10);

  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({ ...bullet, ageTicks: 0 })), /ageTicks must be a positive safe integer/);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({ ...bullet, ageTicks: 1.5 })), /ageTicks must be a positive safe integer/);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({ ...bullet, velocity: { x: 0, y: 8.5 } })), /velocity exceeds the runtime budget/);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => ({ ...bullet, velocity: { x: 0 } })), /enemy bullet velocity/);
  expectInvalidShape(game, withBullet(state, 4, (bullet) => {
    const { spawnPosition: _spawnPosition, ...withoutSpawn } = bullet;
    return withoutSpawn;
  }), /enemy bullet spawnPosition/);
});

test("rejects an enemy bullet that should have been cleaned up after leaving the playfield", () => {
  const game = loadGame(createMovingEnemyBulletDefinition());
  const state = serializeAt(game, 20);
  assert.equal(state.state.runtimeEntities.some((entity) => entity.id === 5), false);

  const bullet4 = state.state.runtimeEntities.find((entity) => entity.kind === "enemyBullet" && entity.id === 4);
  assert.ok(bullet4?.kind === "enemyBullet");
  expectInvalidShape(game, {
    ...state,
    state: {
      ...state.state,
      runtimeEntities: [
        ...state.state.runtimeEntities,
        { ...bullet4, id: 5, position: { x: 50, y: -60 }, velocity: { x: 0, y: -8 }, spawnPosition: { x: 50, y: 100 }, ageTicks: 20 },
      ],
    },
  }, /must move from a processed timeline spawn/);
});

test("rejects an enemy bullet that was outside the cleanup margin after its first move even if it is inside now", () => {
  const definition = createMinimumDefinition();
  // (100, -50) から下へ 8 px/tick で動く敵弾は、生成 tick に y=-42 で cleanup 余白（-32）の外にいるため取り除かれる。
  const game = loadGame({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: { type: "spawnEnemy", enemy: "enemy.scout", path: "path.none", pattern: "pattern.down", position: { x: 100, y: -50 } },
        }],
      }],
      patterns: [
        ...definition.content.patterns,
        { id: "pattern.down", version: 1, fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 0 }, velocity: { x: 0, y: 8 } } },
      ],
    },
  });
  const state = serializeAt(game, 10);
  assert.equal(state.state.runtimeEntities.some((entity) => entity.kind === "enemyBullet"), false);

  expectInvalidShape(game, {
    ...state,
    state: {
      ...state.state,
      runtimeEntities: [
        ...state.state.runtimeEntities,
        {
          id: 3,
          kind: "enemyBullet",
          definitionId: "bullet.red_small",
          position: { x: 100, y: 30 },
          collisionRadius: 4,
          velocity: { x: 0, y: 8 },
          spawnPosition: { x: 100, y: -50 },
          ageTicks: 10,
        },
      ],
    },
  }, /must move from a processed timeline spawn/);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { LoadedGame } from "../../api-types.ts";
import { createShootingCore } from "../../core.ts";
import { createEmptyInputFrame } from "../../input/input-frame.ts";
import { createEnemyPathDefinition } from "../../test-support/definitions.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../test-support/stage-harness.ts";
import type { SerializedGameState, SerializedRuntimeEntityState } from "../types.ts";

type SerializedEnemy = Extract<SerializedRuntimeEntityState, { kind: "enemy" }>;

function loadEnemyPathGame(): LoadedGame {
  const loaded = createShootingCore("0.0.0").load(createEnemyPathDefinition());
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

/** runtimeEntities の enemy id を差し替えた snapshot を作る。値は JSON 互換の plain data として渡す。 */
function withEnemy(state: SerializedGameState, id: number, change: (enemy: SerializedEnemy) => unknown): unknown {
  return {
    ...state,
    state: {
      ...state.state,
      runtimeEntities: state.state.runtimeEntities.map((entity) => (
        entity.kind === "enemy" && entity.id === id ? change(entity) : entity
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

test("restores the serialized path runner state of moving enemies", () => {
  const game = loadEnemyPathGame();
  const state = serializeAt(game, 4);

  assert.deepEqual(
    state.state.runtimeEntities.flatMap((entity) => entity.kind === "enemy" ? [[entity.id, entity.position, entity.pathRunnerState]] : []),
    [
      [2, { x: 101.5, y: -10 }, { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 1 }],
      [4, { x: 40, y: 8 }, { segmentIndex: 0, segmentStart: { x: 40, y: 40 }, segmentElapsedTicks: 2 }],
    ],
  );
  assert.equal(game.restore(state).ok, true);
});

test("rejects path runner states that do not follow the path from the processed spawn", () => {
  const game = loadEnemyPathGame();
  const state = serializeAt(game, 4);
  const followPath = /follow its path from a processed timeline spawn/;

  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, segmentElapsedTicks: 0 },
  })), followPath);
  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, segmentStart: { x: 101, y: -10 } },
  })), followPath);
  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({ ...enemy, position: { x: 101.5, y: -9 } })), followPath);
  // 1 tick 前の runner と位置は path 上では正しいが、spawn tick から expectedTick までの tick 数と合わない。
  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({
    ...enemy,
    position: { x: 100, y: -10 },
    pathRunnerState: { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 0 },
  })), followPath);
  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({ ...enemy, pathId: "path.exit" })), followPath);
});

test("rejects malformed path runner states before matching the spawn", () => {
  const game = loadEnemyPathGame();
  const state = serializeAt(game, 4);

  expectInvalidShape(game, withEnemy(state, 2, (enemy) => {
    const { pathRunnerState: _pathRunnerState, ...withoutRunner } = enemy;
    return withoutRunner;
  }), /pathRunnerState must be a plain object/);
  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, phase: 0 },
  })), /pathRunnerState contains unknown fields/);
  for (const pathRunnerState of [
    { segmentIndex: 3, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 0 },
    { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: -1 },
    { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 0.5 },
  ]) {
    expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({ ...enemy, pathRunnerState })), /within the path segments/);
  }
  expectInvalidShape(game, withEnemy(state, 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, segmentStart: { x: Number.POSITIVE_INFINITY, y: -10 } },
  })), /segmentStart\.x must be finite/);
});

test("rejects an enemy that should have been cleaned up after finishing its path", () => {
  const game = loadEnemyPathGame();
  const state = serializeAt(game, 12);
  assert.equal(state.state.runtimeEntities.some((entity) => entity.id === 4), false);

  const enemy2 = state.state.runtimeEntities.find((entity) => entity.kind === "enemy" && entity.id === 2);
  assert.ok(enemy2?.kind === "enemy");
  expectInvalidShape(game, {
    ...state,
    state: {
      ...state.state,
      runtimeEntities: [
        ...state.state.runtimeEntities,
        {
          ...enemy2,
          id: 4,
          pathId: "path.exit",
          patternId: "pattern.none",
          position: { x: 40, y: -120 },
          pathRunnerState: { segmentIndex: 1, segmentStart: { x: 40, y: -120 }, segmentElapsedTicks: 0 },
        },
      ],
    },
  }, /follow its path from a processed timeline spawn/);
});

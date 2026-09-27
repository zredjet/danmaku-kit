import assert from "node:assert/strict";
import test from "node:test";

import { createEnemyPathDefinition } from "../../test-support/definitions.ts";
import {
  expectRestoreInvalidShape,
  loadGameFromDefinition,
  serializeAfterEmptyTicks,
  withRuntimeEntity,
} from "../../test-support/restore-harness.ts";

test("restores the serialized path runner state of moving enemies", () => {
  const game = loadGameFromDefinition(createEnemyPathDefinition());
  const state = serializeAfterEmptyTicks(game, 4);

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
  const game = loadGameFromDefinition(createEnemyPathDefinition());
  const state = serializeAfterEmptyTicks(game, 4);
  const followPath = /follow its path from a processed timeline spawn/;

  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, segmentElapsedTicks: 0 },
  })), followPath);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, segmentStart: { x: 101, y: -10 } },
  })), followPath);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({ ...enemy, position: { x: 101.5, y: -9 } })), followPath);
  // 1 tick 前の runner と位置は path 上では正しいが、spawn tick から expectedTick までの tick 数と合わない。
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({
    ...enemy,
    position: { x: 100, y: -10 },
    pathRunnerState: { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 0 },
  })), followPath);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({ ...enemy, pathId: "path.exit" })), followPath);
});

test("rejects malformed path runner states before matching the spawn", () => {
  const game = loadGameFromDefinition(createEnemyPathDefinition());
  const state = serializeAfterEmptyTicks(game, 4);

  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => {
    const { pathRunnerState: _pathRunnerState, ...withoutRunner } = enemy;
    return withoutRunner;
  }), /pathRunnerState must be a plain object/);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, phase: 0 },
  })), /pathRunnerState contains unknown fields/);
  for (const pathRunnerState of [
    { segmentIndex: 3, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 0 },
    { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: -1 },
    { segmentIndex: 1, segmentStart: { x: 100, y: -10 }, segmentElapsedTicks: 0.5 },
  ]) {
    expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({ ...enemy, pathRunnerState })), /within the path segments/);
  }
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemy", 2, (enemy) => ({
    ...enemy,
    pathRunnerState: { ...enemy.pathRunnerState, segmentStart: { x: Number.POSITIVE_INFINITY, y: -10 } },
  })), /segmentStart\.x must be finite/);
});

test("rejects an enemy that should have been cleaned up after finishing its path", () => {
  const game = loadGameFromDefinition(createEnemyPathDefinition());
  const state = serializeAfterEmptyTicks(game, 12);
  assert.equal(state.state.runtimeEntities.some((entity) => entity.id === 4), false);

  const enemy2 = state.state.runtimeEntities.find((entity) => entity.kind === "enemy" && entity.id === 2);
  assert.ok(enemy2?.kind === "enemy");
  expectRestoreInvalidShape(game, {
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

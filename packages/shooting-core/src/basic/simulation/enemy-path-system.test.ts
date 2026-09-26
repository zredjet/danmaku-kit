import assert from "node:assert/strict";
import test from "node:test";

import type { PathDefinition } from "../content/types.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import { advanceEnemyPaths, isOutsideEnemyCleanupBounds } from "./enemy-path-system.ts";
import { createPathRunnerState } from "./path-runner.ts";

const pathsById: ReadonlyMap<string, PathDefinition> = new Map<string, PathDefinition>([
  ["path.none", { id: "path.none", version: 1 }],
  ["path.down", { id: "path.down", version: 1, segments: [{ type: "velocity", duration: 2, velocity: { x: 0, y: 3 } }] }],
]);

function createEnemy(id: number, pathId: EnemyRuntimeEntity["pathId"], position: { x: number; y: number }): EnemyRuntimeEntity {
  return Object.freeze({
    id,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: Object.freeze(position),
    pathId,
    patternId: "pattern.none",
    collisionRadius: 12,
    hp: 10,
    scoreOnKill: 100,
    pathRunnerState: createPathRunnerState(position),
  });
}

function advance(entities: readonly RuntimeEntityState[]): readonly RuntimeEntityState[] {
  const result = advanceEnemyPaths(entities, pathsById);
  assert.equal(result.ok, true);
  if (!result.ok) {
    assert.fail("expected enemy path advance");
  }
  return result.value;
}

test("moves enemies along their path and keeps other kinds and finished enemies as they are", () => {
  const moving = createEnemy(2, "path.down", { x: 50, y: 50 });
  const still = createEnemy(3, "path.none", { x: 60, y: 60 });
  const bullet: RuntimeEntityState = Object.freeze({
    id: 4,
    kind: "enemyBullet",
    definitionId: "bullet.red_small",
    position: Object.freeze({ x: 1, y: 1 }),
    collisionRadius: 4,
  });

  const advanced = advance([moving, still, bullet]);

  assert.deepEqual(advanced[0], {
    ...moving,
    position: { x: 50, y: 53 },
    pathRunnerState: { segmentIndex: 0, segmentStart: { x: 50, y: 50 }, segmentElapsedTicks: 1 },
  });
  assert.equal(advanced[1], still);
  assert.equal(advanced[2], bullet);
  assert.equal(Object.isFrozen(advanced) && Object.isFrozen(advanced[0]), true);
});

test("removes only enemies that finished their path beyond the cleanup margin", () => {
  const offscreenFinished = createEnemy(2, "path.none", { x: 50, y: -65 });
  const marginFinished = createEnemy(3, "path.none", { x: 50, y: -64 });
  const offscreenMoving = createEnemy(4, "path.down", { x: 50, y: -200 });

  assert.deepEqual(advance([offscreenFinished, marginFinished, offscreenMoving]).map((entity) => entity.id), [3, 4]);
  assert.deepEqual([
    isOutsideEnemyCleanupBounds({ x: -64, y: -64 }),
    isOutsideEnemyCleanupBounds({ x: 448, y: 512 }),
    isOutsideEnemyCleanupBounds({ x: -64.5, y: 0 }),
    isOutsideEnemyCleanupBounds({ x: 448.5, y: 0 }),
    isOutsideEnemyCleanupBounds({ x: 0, y: 512.5 }),
  ], [false, false, true, true, true]);
});

test("returns an error for an enemy whose path is not loaded", () => {
  const result = advanceEnemyPaths([createEnemy(2, "path.missing", { x: 0, y: 0 })], pathsById);

  assert.deepEqual(result, { ok: false, errors: [{ code: "path.notFound", message: "Path not found: path.missing" }] });
});

import assert from "node:assert/strict";
import test from "node:test";

import type { EnemyBulletRuntimeEntity } from "../entities/enemy-bullet/model.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import {
  advanceEnemyBullets,
  isOutsideEnemyBulletCleanupBounds,
  resolveEnemyBulletPositionAt,
} from "./enemy-bullet-movement-system.ts";
import { createPathRunnerState } from "./path-runner.ts";

function createBullet(id: number, spawnPosition: { x: number; y: number }, velocity: { x: number; y: number }): EnemyBulletRuntimeEntity {
  return Object.freeze({
    id,
    kind: "enemyBullet",
    definitionId: "bullet.red_small",
    position: Object.freeze({ ...spawnPosition }),
    collisionRadius: 4,
    velocity: Object.freeze({ ...velocity }),
    spawnPosition: Object.freeze({ ...spawnPosition }),
    ageTicks: 0,
  });
}

test("moves enemy bullets as spawnPosition + velocity * ageTicks without accumulating additions", () => {
  let entities: readonly RuntimeEntityState[] = [createBullet(3, { x: 100, y: 0 }, { x: 0, y: 0.1 })];
  let accumulatedY = 0;
  for (let tick = 0; tick < 10; tick += 1) {
    entities = advanceEnemyBullets(entities);
    accumulatedY += 0.1;
  }
  const bullet = entities[0];
  assert.ok(bullet?.kind === "enemyBullet");

  assert.equal(bullet.ageTicks, 10);
  // 0.1 を 10 回足すと 0.9999999999999999 になるが、spawnPosition + velocity * ageTicks は 1 になる。
  assert.deepEqual(bullet.position, { x: 100, y: 1 });
  assert.notEqual(bullet.position.y, accumulatedY);
  assert.deepEqual(bullet.position, resolveEnemyBulletPositionAt(bullet.spawnPosition, bullet.velocity, 10));
  assert.equal(Object.isFrozen(entities) && Object.isFrozen(bullet), true);
});

test("keeps stationary bullets and other kinds in place", () => {
  const stationary = createBullet(3, { x: 10, y: 20 }, { x: 0, y: 0 });
  const enemy: RuntimeEntityState = Object.freeze({
    id: 2,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: Object.freeze({ x: 1, y: 1 }),
    pathId: "path.none",
    patternId: "pattern.none",
    collisionRadius: 12,
    hp: 10,
    scoreOnKill: 100,
    pathRunnerState: createPathRunnerState({ x: 1, y: 1 }),
  });

  const advanced = advanceEnemyBullets([enemy, stationary]);

  assert.equal(advanced[0], enemy);
  assert.deepEqual(advanced[1], { ...stationary, ageTicks: 1 });
});

test("removes bullets whose moved position is beyond the cleanup margin", () => {
  const advanced = advanceEnemyBullets([
    createBullet(3, { x: 100, y: -24 }, { x: 0, y: -8 }),
    createBullet(4, { x: 100, y: -25 }, { x: 0, y: -8 }),
    createBullet(5, { x: 408, y: 100 }, { x: 8, y: 0 }),
    createBullet(6, { x: 409, y: 100 }, { x: 8, y: 0 }),
  ]);

  assert.deepEqual(advanced.map((entity) => entity.id), [3, 5]);
  assert.deepEqual([
    isOutsideEnemyBulletCleanupBounds({ x: -32, y: -32 }),
    isOutsideEnemyBulletCleanupBounds({ x: 416, y: 480 }),
    isOutsideEnemyBulletCleanupBounds({ x: -32.5, y: 0 }),
    isOutsideEnemyBulletCleanupBounds({ x: 0, y: 480.5 }),
  ], [false, false, true, true]);
});

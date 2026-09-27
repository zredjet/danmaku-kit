import assert from "node:assert/strict";
import test from "node:test";

import { createPathRunnerState } from "./path-runner.ts";
import { freezeEntitiesInIdOrder, STAGE_TICK_SYSTEM_ORDER } from "./system-order.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";

test("locks the basic core tick system order", () => {
  assert.deepEqual(STAGE_TICK_SYSTEM_ORDER, [
    "applyInput",
    "updatePlayerIntent",
    "resolveImmediatePlayerDefensiveActions",
    "updateStageTimeline",
    "updateEnemyBehaviorPattern",
    "spawnBulletsPlayerShots",
    "updateMovement",
    "updateLifetime",
    "broadPhaseCollision",
    "narrowPhaseCollision",
    "collisionResolution",
    "scoring",
    "cleanupDestroyedEntities",
    "buildImmutableGameFrame",
  ]);
  assert.equal(Object.isFrozen(STAGE_TICK_SYSTEM_ORDER), true);
});

test("freezes runtime entities in id order without mutating the source order", () => {
  const entities: RuntimeEntityState[] = [
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 400 },
      velocity: { x: 0, y: -8 },
      collisionRadius: 5,
      damage: 5,
      remainingLifetimeTicks: 3,
    },
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      movement: { speed: 4, focusSpeed: 1.8 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      shotDefinitionId: "playerShot.basic",
      nextShotAllowedTick: 0,
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: -16 },
      pathId: "path.none",
      patternId: "pattern.none",
      collisionRadius: 12,
      hp: 10,
      scoreOnKill: 100,
      pathRunnerState: createPathRunnerState({ x: 192, y: -16 }),
    },
  ];

  const sorted = freezeEntitiesInIdOrder(entities);

  assert.deepEqual(sorted.map((entity) => entity.id), [1, 2, 3]);
  assert.deepEqual(entities.map((entity) => entity.id), [3, 1, 2]);
  assert.equal(Object.isFrozen(sorted), true);
});

test("keeps already ordered runtime entities in id order", () => {
  const entities: RuntimeEntityState[] = [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      movement: { speed: 4, focusSpeed: 1.8 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      shotDefinitionId: "playerShot.basic",
      nextShotAllowedTick: 0,
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 400 },
      velocity: { x: 0, y: -8 },
      collisionRadius: 5,
      damage: 5,
      remainingLifetimeTicks: 3,
    },
  ];

  const ordered = freezeEntitiesInIdOrder(entities);

  assert.deepEqual(ordered.map((entity) => entity.id), [1, 2]);
  assert.notEqual(ordered, entities);
  assert.equal(Object.isFrozen(ordered), true);
});

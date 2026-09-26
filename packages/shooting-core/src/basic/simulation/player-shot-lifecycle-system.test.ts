import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import { advancePlayerShotLifecycle } from "./player-shot-lifecycle-system.ts";

test("moves player shots by velocity and decrements lifetime", () => {
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

  const advanced = advancePlayerShotLifecycle(entities);

  assert.deepEqual(advanced, [
    entities[0],
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
      velocity: { x: 0, y: -8 },
      collisionRadius: 5,
      damage: 5,
      remainingLifetimeTicks: 2,
    },
  ]);
  assert.deepEqual(entities[1]?.position, { x: 192, y: 400 });
  assert.equal(Object.isFrozen(advanced), true);
  assert.equal(Object.isFrozen(advanced[1]), true);
  assert.equal(advanced[1]?.kind === "playerShot" && Object.isFrozen(advanced[1].position), true);
  assert.equal(advanced[1]?.kind === "playerShot" && Object.isFrozen(advanced[1].velocity), true);
});

test("removes player shots whose lifetime expires", () => {
  const shot: RuntimeEntityState = {
    id: 2,
    kind: "playerShot",
    definitionId: "playerShot.basic",
    position: { x: 192, y: 400 },
    velocity: { x: 0, y: -8 },
    collisionRadius: 5,
    damage: 5,
    remainingLifetimeTicks: 1,
  };

  const advanced = advancePlayerShotLifecycle([shot]);

  assert.deepEqual(advanced, []);
  assert.equal(Object.isFrozen(advanced), true);
});

test("moves newly spawned player shots without decrementing lifetime on the spawn tick", () => {
  const shot: RuntimeEntityState = {
    id: 2,
    kind: "playerShot",
    definitionId: "playerShot.basic",
    position: { x: 192, y: 400 },
    velocity: { x: 0, y: -8 },
    collisionRadius: 5,
    damage: 5,
    remainingLifetimeTicks: 1,
  };

  const advanced = advancePlayerShotLifecycle([shot], { spawnedThisTickEntityIds: new Set([2]) });

  assert.deepEqual(advanced, [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
      velocity: { x: 0, y: -8 },
      collisionRadius: 5,
      damage: 5,
      remainingLifetimeTicks: 1,
    },
  ]);
});

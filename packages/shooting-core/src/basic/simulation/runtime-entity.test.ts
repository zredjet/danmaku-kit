import assert from "node:assert/strict";
import test from "node:test";

import {
  createEnemyBulletRuntimeEntity,
  createEnemyRuntimeEntity,
  createPlayerRuntimeEntity,
  createPlayerShotRuntimeEntity,
  toReadonlyEntityState,
} from "./runtime-entity.ts";
import { EntityAllocator } from "./entity.ts";
import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";

test("creates player runtime components from player content", () => {
  const definition = createMinimumDefinition();
  const player = definition.content.players[0]!;
  const entity = createPlayerRuntimeEntity(new EntityAllocator(), player);

  assert.equal(entity.ok, true);
  if (!entity.ok) {
    assert.fail("expected player entity");
  }
  assert.deepEqual(entity.value, {
    id: 1,
    kind: "player",
    definitionId: "player.default",
    position: { x: 192, y: 400 },
    movement: { speed: 4, focusSpeed: 1.8 },
    collisionRadius: 3,
    lives: 3,
    invincibleTicksRemaining: 0,
    shotDefinitionId: "playerShot.basic",
  });
  assert.equal(Object.isFrozen(entity.value), true);
  assert.equal(Object.isFrozen(entity.value.position), true);
  assert.equal(Object.isFrozen(entity.value.movement), true);
});

test("creates enemy runtime components from enemy content and spawn action", () => {
  const definition = createMinimumDefinition();
  const enemy = definition.content.enemies[0]!;
  const action = definition.content.stages[0]!.timeline[0]!.action;
  const entity = createEnemyRuntimeEntity(new EntityAllocator(), enemy, action);

  assert.equal(entity.ok, true);
  if (!entity.ok) {
    assert.fail("expected enemy entity");
  }
  assert.deepEqual(entity.value, {
    id: 1,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: { x: 192, y: -16 },
    pathId: "path.none",
    patternId: "pattern.none",
    collisionRadius: 12,
    hp: 10,
    scoreOnKill: 100,
  });
  assert.equal(Object.isFrozen(entity.value), true);
  assert.equal(Object.isFrozen(entity.value.position), true);
});

test("creates bullet and player shot runtime components from content hitboxes", () => {
  const definition = createMinimumDefinition();
  const allocator = new EntityAllocator();
  const bullet = createEnemyBulletRuntimeEntity(allocator, definition.content.bullets[0]!, { x: 100, y: 120 });
  const shot = createPlayerShotRuntimeEntity(allocator, definition.content.playerShots[0]!, { x: 200, y: 360 });

  assert.equal(bullet.ok, true);
  assert.equal(shot.ok, true);
  if (!bullet.ok || !shot.ok) {
    assert.fail("expected projectile entities");
  }
  assert.deepEqual(bullet.value, {
    id: 1,
    kind: "enemyBullet",
    definitionId: "bullet.red_small",
    position: { x: 100, y: 120 },
    collisionRadius: 4,
  });
  assert.deepEqual(shot.value, {
    id: 2,
    kind: "playerShot",
    definitionId: "playerShot.basic",
    position: { x: 200, y: 360 },
    velocity: { x: 0, y: -8 },
    collisionRadius: 5,
    damage: 5,
    remainingLifetimeTicks: 3,
  });
});

test("projects runtime components to public readonly snapshots without leaking internals", () => {
  const definition = createMinimumDefinition();
  const runtime = createEnemyRuntimeEntity(
    new EntityAllocator(),
    definition.content.enemies[0]!,
    definition.content.stages[0]!.timeline[0]!.action,
  );

  assert.equal(runtime.ok, true);
  if (!runtime.ok) {
    assert.fail("expected enemy entity");
  }
  const snapshot = toReadonlyEntityState(runtime.value);
  assert.deepEqual(snapshot, {
    id: 1,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: { x: 192, y: -16 },
  });
  assert.equal("hp" in snapshot, false);
  assert.equal("pathId" in snapshot, false);
  assert.equal("collisionRadius" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.position), true);
});

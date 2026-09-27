import assert from "node:assert/strict";
import test from "node:test";

import type { BulletDefinition, PatternDefinition } from "../content/types.ts";
import { EntityAllocator } from "./entity.ts";
import { spawnEnemyBullets } from "./enemy-bullet-system.ts";
import { createPathRunnerState } from "./path-runner.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";

test("spawns enemy bullets from fireOnSpawn patterns in enemy order", () => {
  const allocator = new EntityAllocator();
  const result = spawnEnemyBullets(
    allocator,
    4,
    [
      createEnemy({ id: 10, patternId: "pattern.fire_a", position: { x: 100, y: 50 } }),
      createEnemy({ id: 11, patternId: "pattern.fire_b", position: { x: 200, y: 70 } }),
    ],
    [],
    new Map([
      ["pattern.fire_a", createPattern("pattern.fire_a", "bullet.red_small", { x: 1, y: 2 })],
      ["pattern.fire_b", createPattern("pattern.fire_b", "bullet.blue_small", { x: -4, y: 8 }, { x: 1, y: 3 })],
    ]),
    new Map([
      ["bullet.red_small", createBullet("bullet.red_small")],
      ["bullet.blue_small", createBullet("bullet.blue_small")],
    ]),
    0,
  );

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) {
    assert.fail("expected enemy bullet spawn");
  }

  assert.deepEqual(result.value.entities, [
    {
      id: 1,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 101, y: 52 },
      collisionRadius: 4,
      velocity: { x: 0, y: 0 },
      spawnPosition: { x: 101, y: 52 },
      ageTicks: 0,
    },
    {
      id: 2,
      kind: "enemyBullet",
      definitionId: "bullet.blue_small",
      position: { x: 196, y: 78 },
      collisionRadius: 4,
      velocity: { x: 1, y: 3 },
      spawnPosition: { x: 196, y: 78 },
      ageTicks: 0,
    },
  ]);
  assert.deepEqual(result.value.spawnedBullets, [
    {
      entityId: 1,
      definitionId: "bullet.red_small",
      position: { x: 101, y: 52 },
    },
    {
      entityId: 2,
      definitionId: "bullet.blue_small",
      position: { x: 196, y: 78 },
    },
  ]);
  assert.deepEqual(result.value.event, {
    type: "enemyBulletsSpawnedBatch",
    tick: 4,
    bullets: [
      {
        entityId: 1,
        definitionId: "bullet.red_small",
        position: { x: 101, y: 52 },
      },
      {
        entityId: 2,
        definitionId: "bullet.blue_small",
        position: { x: 196, y: 78 },
      },
    ],
  });
  assert.equal(allocator.snapshot(), 3);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.entities), true);
  assert.equal(Object.isFrozen(result.value.entities[0]), true);
  assert.equal(Object.isFrozen(result.value.entities[0]?.position), true);
  assert.equal(Object.isFrozen(result.value.spawnedBullets), true);
  assert.equal(Object.isFrozen(result.value.spawnedBullets[0]), true);
  assert.equal(Object.isFrozen(result.value.spawnedBullets[0]?.position), true);
  assert.equal(Object.isFrozen(result.value.event), true);
  if (result.value.event.type !== "enemyBulletsSpawnedBatch") {
    assert.fail("expected enemy bullet batch event");
  }
  assert.equal(Object.isFrozen(result.value.event.bullets), true);
  assert.equal(Object.isFrozen(result.value.event.bullets[0]), true);
  assert.equal(Object.isFrozen(result.value.event.bullets[0]?.position), true);
});

test("returns null without consuming ids when no fireOnSpawn pattern exists", () => {
  const allocator = new EntityAllocator();
  const result = spawnEnemyBullets(
    allocator,
    0,
    [createEnemy({ id: 10, patternId: "pattern.none", position: { x: 100, y: 50 } })],
    [],
    new Map([["pattern.none", Object.freeze({ id: "pattern.none", version: 1 })]]),
    new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
    0,
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value, null);
  assert.equal(allocator.snapshot(), 1);
});

test("skips non-firing enemies and spawns later fireOnSpawn bullets", () => {
  const allocator = new EntityAllocator();
  const result = spawnEnemyBullets(
    allocator,
    2,
    [
      createEnemy({ id: 10, patternId: "pattern.none", position: { x: 100, y: 50 } }),
      createEnemy({ id: 11, patternId: "pattern.fire", position: { x: 200, y: 70 } }),
    ],
    [],
    new Map([
      ["pattern.none", Object.freeze({ id: "pattern.none", version: 1 })],
      ["pattern.fire", createPattern("pattern.fire", "bullet.red_small", { x: -4, y: 8 })],
    ]),
    new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
    0,
  );

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) {
    assert.fail("expected later fireOnSpawn bullet spawn");
  }

  assert.deepEqual(result.value.spawnedBullets, [
    {
      entityId: 1,
      definitionId: "bullet.red_small",
      position: { x: 196, y: 78 },
    },
  ]);
  assert.equal(allocator.snapshot(), 2);
});

test("does not consume ids when a later enemy bullet reference fails", () => {
  const allocator = new EntityAllocator();
  const result = spawnEnemyBullets(
    allocator,
    0,
    [
      createEnemy({ id: 10, patternId: "pattern.valid", position: { x: 100, y: 50 } }),
      createEnemy({ id: 11, patternId: "pattern.missing_bullet", position: { x: 200, y: 70 } }),
    ],
    [],
    new Map([
      ["pattern.valid", createPattern("pattern.valid", "bullet.red_small", { x: 1, y: 2 })],
      ["pattern.missing_bullet", createPattern("pattern.missing_bullet", "bullet.missing", { x: 0, y: 0 })],
    ]),
    new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
    0,
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errors[0]?.code, "bullet.notFound");
  assert.equal(allocator.snapshot(), 1);
});

test("does not consume ids when an enemy pattern reference is missing", () => {
  const allocator = new EntityAllocator();
  const result = spawnEnemyBullets(
    allocator,
    0,
    [createEnemy({ id: 10, patternId: "pattern.missing", position: { x: 100, y: 50 } })],
    [],
    new Map([["pattern.other", createPattern("pattern.other", "bullet.red_small", { x: 1, y: 2 })]]),
    new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
    0,
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errors[0]?.code, "pattern.notFound");
  assert.equal(allocator.snapshot(), 1);
});

test("does not consume ids when allocator cannot allocate the full bullet batch", () => {
  const allocator = EntityAllocator.restore(Number.MAX_SAFE_INTEGER - 1);
  assert.equal(allocator.ok, true);
  if (!allocator.ok) {
    assert.fail("expected allocator near max id");
  }

  const result = spawnEnemyBullets(
    allocator.value,
    0,
    [
      createEnemy({ id: 10, patternId: "pattern.fire_a", position: { x: 100, y: 50 } }),
      createEnemy({ id: 11, patternId: "pattern.fire_b", position: { x: 200, y: 70 } }),
    ],
    [],
    new Map([
      ["pattern.fire_a", createPattern("pattern.fire_a", "bullet.red_small", { x: 1, y: 2 })],
      ["pattern.fire_b", createPattern("pattern.fire_b", "bullet.red_small", { x: -4, y: 8 })],
    ]),
    new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
    0,
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errors[0]?.code, "entityAllocator.invalidState");
  assert.equal(allocator.value.snapshot(), Number.MAX_SAFE_INTEGER - 1);
});

test("rejects non-finite generated bullet positions without consuming ids", () => {
  const allocator = new EntityAllocator();
  const result = spawnEnemyBullets(
    allocator,
    0,
    [createEnemy({ id: 10, patternId: "pattern.overflow", position: { x: Number.MAX_VALUE, y: 50 } })],
    [],
    new Map([["pattern.overflow", createPattern("pattern.overflow", "bullet.red_small", { x: Number.MAX_VALUE, y: 0 })]]),
    new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
    0,
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errors[0]?.code, "definition.invalidConstraint");
  assert.equal(allocator.snapshot(), 1);
});

test("fails without consuming ids when the batch would exceed the active enemy bullet budget", () => {
  const spawn = (activeEnemyBulletCount: number) => {
    const allocator = new EntityAllocator();
    const result = spawnEnemyBullets(
      allocator,
      0,
      [
        createEnemy({ id: 10, patternId: "pattern.fire", position: { x: 100, y: 50 } }),
        createEnemy({ id: 11, patternId: "pattern.fire", position: { x: 200, y: 70 } }),
      ],
      [],
      new Map([["pattern.fire", createPattern("pattern.fire", "bullet.red_small", { x: 0, y: 8 })]]),
      new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
      activeEnemyBulletCount,
    );
    return { result, nextEntityId: allocator.snapshot() };
  };

  const atBudget = spawn(1_998);
  const overBudget = spawn(1_999);

  assert.equal(atBudget.result.ok, true);
  assert.equal(atBudget.nextEntityId, 3);
  assert.equal(overBudget.result.ok, false);
  assert.deepEqual(!overBudget.result.ok && overBudget.result.errors, [{
    code: "enemyBullet.budgetExceeded",
    message: "Active enemy bullets would exceed 2000: 1999 + 2",
  }]);
  assert.equal(overBudget.nextEntityId, 1);
});

test("appends pattern bullets after fireOnSpawn bullets in one batch and counts them against the budget", () => {
  const spawn = (activeEnemyBulletCount: number) => {
    const allocator = EntityAllocator.restore(5);
    assert.ok(allocator.ok);
    const result = spawnEnemyBullets(
      allocator.value,
      7,
      [createEnemy({ id: 5, patternId: "pattern.fire", position: { x: 100, y: 50 } })],
      [
        { bullet: createBullet("bullet.blue_small"), position: { x: 40, y: 60 }, velocity: { x: 0, y: 2 } },
        { bullet: createBullet("bullet.blue_small"), position: { x: 40, y: 60 }, velocity: { x: 1, y: 0 } },
      ],
      new Map([["pattern.fire", createPattern("pattern.fire", "bullet.red_small", { x: 0, y: 8 })]]),
      new Map([["bullet.red_small", createBullet("bullet.red_small")]]),
      activeEnemyBulletCount,
    );
    return { result, nextEntityId: allocator.value.snapshot() };
  };

  const spawned = spawn(1_997);
  assert.equal(spawned.result.ok, true);
  assert.deepEqual(spawned.result.ok && spawned.result.value?.event, {
    type: "enemyBulletsSpawnedBatch",
    tick: 7,
    bullets: [
      { entityId: 5, definitionId: "bullet.red_small", position: { x: 100, y: 58 } },
      { entityId: 6, definitionId: "bullet.blue_small", position: { x: 40, y: 60 } },
      { entityId: 7, definitionId: "bullet.blue_small", position: { x: 40, y: 60 } },
    ],
  });
  assert.deepEqual(spawned.result.ok && spawned.result.value?.entities.map((entity) => entity.velocity), [
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 1, y: 0 },
  ]);
  const overBudget = spawn(1_998);
  assert.deepEqual(!overBudget.result.ok && overBudget.result.errors.map((error) => error.message), [
    "Active enemy bullets would exceed 2000: 1998 + 3",
  ]);
  assert.equal(overBudget.nextEntityId, 5);
});

function createEnemy(options: {
  id: number;
  patternId: EnemyRuntimeEntity["patternId"];
  position: EnemyRuntimeEntity["position"];
}): EnemyRuntimeEntity {
  return Object.freeze({
    id: options.id,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: Object.freeze({
      x: options.position.x,
      y: options.position.y,
    }),
    pathId: "path.none",
    patternId: options.patternId,
    collisionRadius: 12,
    hp: 10,
    scoreOnKill: 100,
    pathRunnerState: createPathRunnerState(options.position),
  });
}

function createPattern(
  id: PatternDefinition["id"],
  bullet: BulletDefinition["id"],
  offset: { x: number; y: number },
  velocity?: { x: number; y: number },
): PatternDefinition {
  return Object.freeze({
    id,
    version: 1,
    fireOnSpawn: Object.freeze({
      bullet,
      offset: Object.freeze({
        x: offset.x,
        y: offset.y,
      }),
      ...(velocity === undefined ? {} : { velocity: Object.freeze({ x: velocity.x, y: velocity.y }) }),
    }),
  });
}

function createBullet(id: BulletDefinition["id"]): BulletDefinition {
  return Object.freeze({
    id,
    version: 1,
    asset: id,
    collision: Object.freeze({ radius: 4 }),
  });
}

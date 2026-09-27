import assert from "node:assert/strict";
import test from "node:test";

import type { EnemyDefinition, EnemyId, StageTimelineStep } from "../content/types.ts";
import { EntityAllocator } from "./entity.ts";
import { MAX_RESTORABLE_NEXT_ENTITY_ID } from "./entity-id-budget.ts";
import { advanceStageTimeline } from "./stage-timeline-system.ts";

const enemiesById = new Map<string, EnemyDefinition>([
  ["enemy.scout", createEnemy("enemy.scout", 10, 100)],
  ["enemy.heavy", createEnemy("enemy.heavy", 40, 500)],
]);

const timeline: readonly StageTimelineStep[] = [
  createSpawnStep(3, "enemy.scout", { x: 10, y: 20 }),
  createSpawnStep(5, "enemy.heavy", { x: 30, y: 40 }),
  createSpawnStep(5, "enemy.scout", { x: 50, y: 60 }),
  createSpawnStep(9, "enemy.scout", { x: 70, y: 80 }),
];

test("spawns every timeline step for the tick in timeline order", () => {
  const allocator = EntityAllocator.restore(4);
  assert.equal(allocator.ok, true);
  if (!allocator.ok) {
    assert.fail("expected allocator");
  }

  const result = advanceStageTimeline(allocator.value, 5, timeline, 1, enemiesById);

  assert.equal(result.ok, true);
  if (!result.ok) {
    assert.fail("expected timeline advance");
  }
  assert.equal(result.value.timelineCursor, 3);
  assert.equal(allocator.value.snapshot(), 6);
  assert.deepEqual(result.value.entities.map((entity) => [entity.id, entity.definitionId, entity.position, entity.hp]), [
    [4, "enemy.heavy", { x: 30, y: 40 }, 40],
    [5, "enemy.scout", { x: 50, y: 60 }, 10],
  ]);
  assert.deepEqual(result.value.events, [
    {
      type: "entitySpawned",
      tick: 5,
      entityId: 4,
      entityKind: "enemy",
      definitionId: "enemy.heavy",
      path: "path.none",
      pattern: "pattern.none",
      position: { x: 30, y: 40 },
    },
    {
      type: "entitySpawned",
      tick: 5,
      entityId: 5,
      entityKind: "enemy",
      definitionId: "enemy.scout",
      path: "path.none",
      pattern: "pattern.none",
      position: { x: 50, y: 60 },
    },
  ]);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.entities), true);
  assert.equal(Object.isFrozen(result.value.events), true);
  assert.equal(Object.isFrozen(result.value.events[0]), true);
});

test("leaves the cursor and allocator unchanged when no step is due", () => {
  const allocator = new EntityAllocator();

  const beforeFirstStep = advanceStageTimeline(allocator, 2, timeline, 0, enemiesById);
  const betweenSteps = advanceStageTimeline(allocator, 7, timeline, 3, enemiesById);
  const afterLastStep = advanceStageTimeline(allocator, 10, timeline, 4, enemiesById);

  for (const [result, cursor] of [[beforeFirstStep, 0], [betweenSteps, 3], [afterLastStep, 4]] as const) {
    assert.deepEqual(result.ok && result.value, { entities: [], events: [], timelineCursor: cursor });
  }
  assert.equal(allocator.snapshot(), 1);
});

test("returns an error when a due step cannot be spawned", () => {
  const missingEnemy = advanceStageTimeline(new EntityAllocator(), 3, timeline, 0, new Map());
  assert.equal(missingEnemy.ok, false);
  assert.deepEqual(!missingEnemy.ok && missingEnemy.errors, [
    { code: "enemy.notFound", message: "Enemy not found: enemy.scout" },
  ]);

  const exhaustedAllocator = EntityAllocator.restore(MAX_RESTORABLE_NEXT_ENTITY_ID);
  assert.equal(exhaustedAllocator.ok, true);
  if (!exhaustedAllocator.ok) {
    assert.fail("expected allocator");
  }
  const exhausted = advanceStageTimeline(exhaustedAllocator.value, 3, timeline, 0, enemiesById);
  assert.equal(!exhausted.ok && exhausted.errors[0]?.code, "entityAllocator.invalidState");
});

function createEnemy(id: EnemyId, hp: number, score: number): EnemyDefinition {
  return { id, version: 1, asset: id, collision: { radius: 12 }, hp, score };
}

function createSpawnStep(tick: number, enemy: EnemyId, position: { x: number; y: number }): StageTimelineStep {
  return {
    tick,
    action: { type: "spawnEnemy", enemy, path: "path.none", pattern: "pattern.none", position },
  };
}

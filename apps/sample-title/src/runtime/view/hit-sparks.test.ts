import assert from "node:assert/strict";
import test from "node:test";

import type { GameEvent } from "@shooting-sample/shooting-core";

import { HitSparks } from "./hit-sparks.ts";

const BUDGET = { maxActive: 4, maxSpawnsPerFrame: 2, lifetimeMs: 100 };

function defeated(entityId: number): GameEvent {
  return { type: "entityDestroyed", tick: 10, entityId, entityKind: "enemy", reason: "defeated" } as GameEvent;
}

const positionOf = (entityId: number) => ({ x: entityId * 10, y: entityId * 20 });

test("shows a spark where each defeated enemy was last drawn and ages it out", () => {
  const sparks = new HitSparks(BUDGET);

  sparks.update(16, [
    defeated(1),
    { type: "entityDestroyed", tick: 10, entityId: 2, entityKind: "enemyBullet", reason: "collision" } as GameEvent,
    { type: "tickAdvanced", tick: 10 },
  ], positionOf);
  assert.deepEqual(sparks.active, [{ x: 10, y: 20, progress: 0 }]);

  sparks.update(25, [], positionOf);
  assert.deepEqual(sparks.active, [{ x: 10, y: 20, progress: 0.25 }]);

  sparks.update(75, [], positionOf);
  assert.deepEqual(sparks.active, []);
});

test("skips enemies that were never drawn without counting them as dropped", () => {
  const sparks = new HitSparks(BUDGET);

  sparks.update(16, [defeated(1), defeated(2)], (entityId) => entityId === 2 ? positionOf(entityId) : null);

  assert.deepEqual(sparks.active, [{ x: 20, y: 40, progress: 0 }]);
  assert.equal(sparks.droppedTotal, 0);
});

test("drops sparks over the per-frame and active budgets and counts them", () => {
  const sparks = new HitSparks(BUDGET);

  sparks.update(16, [defeated(1), defeated(2), defeated(3)], positionOf);
  sparks.update(16, [defeated(4), defeated(5), defeated(6)], positionOf);
  sparks.update(16, [defeated(7)], positionOf);

  assert.deepEqual(sparks.active.map((spark) => spark.x), [10, 20, 40, 50]);
  assert.equal(sparks.droppedTotal, 3);
});

test("does not age sparks for a zero or invalid delta and clears them for a new stage", () => {
  const sparks = new HitSparks(BUDGET);
  sparks.update(0, [defeated(1)], positionOf);

  sparks.update(Number.NaN, [], positionOf);
  sparks.update(-5, [], positionOf);
  assert.deepEqual(sparks.active, [{ x: 10, y: 20, progress: 0 }]);

  sparks.clear();
  assert.deepEqual(sparks.active, []);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ReadonlyEntityState, ReadonlyGameState } from "@shooting-sample/shooting-core";

import { countEntitiesByKind, countGameStateEntities } from "./entity-counts.ts";

const entity = (id: number, kind: ReadonlyEntityState["kind"]) => ({ id, kind, position: { x: 0, y: 0 } }) as ReadonlyEntityState;

test("counts every kind including the ones with no entities", () => {
  assert.deepEqual(countEntitiesByKind([]), { player: 0, enemy: 0, enemyBullet: 0, playerShot: 0, pickup: 0 });
  assert.deepEqual(
    countEntitiesByKind([entity(1, "player"), entity(2, "enemy"), entity(3, "enemyBullet"), entity(4, "enemyBullet"), entity(5, "playerShot")]),
    { player: 1, enemy: 1, enemyBullet: 2, playerShot: 1, pickup: 0 },
  );
});

test("counts the pickups of the frame state with the Core entities", () => {
  const pickup = { id: 9, definitionId: "pickup.score_small", position: { x: 0, y: 0 }, attracted: false } as const;
  const state = { entities: [entity(1, "player")], features: { pickups: [pickup, { ...pickup, id: 10 }] } } as unknown as ReadonlyGameState;

  assert.deepEqual(countGameStateEntities(state), { player: 1, enemy: 0, enemyBullet: 0, playerShot: 0, pickup: 2 });
  assert.deepEqual(countGameStateEntities(null), { player: 0, enemy: 0, enemyBullet: 0, playerShot: 0, pickup: 0 });
});

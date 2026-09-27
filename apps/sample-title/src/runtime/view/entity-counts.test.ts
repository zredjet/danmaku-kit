import assert from "node:assert/strict";
import test from "node:test";

import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";

import { countEntitiesByKind } from "./entity-counts.ts";

const entity = (id: number, kind: ReadonlyEntityState["kind"]) => ({ id, kind, position: { x: 0, y: 0 } }) as ReadonlyEntityState;

test("counts every kind including the ones with no entities", () => {
  assert.deepEqual(countEntitiesByKind([]), { player: 0, enemy: 0, enemyBullet: 0, playerShot: 0 });
  assert.deepEqual(
    countEntitiesByKind([entity(1, "player"), entity(2, "enemy"), entity(3, "enemyBullet"), entity(4, "enemyBullet"), entity(5, "playerShot")]),
    { player: 1, enemy: 1, enemyBullet: 2, playerShot: 1 },
  );
});

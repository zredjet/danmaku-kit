import assert from "node:assert/strict";
import test from "node:test";

import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";

import { diffEntityViews } from "./entity-view-diff.ts";

const player: ReadonlyEntityState = { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } };
const enemy: ReadonlyEntityState = { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 192, y: 96 } };
const shot: ReadonlyEntityState = { id: 4, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 192, y: 392 } };

test("spawns a view for every entity of the first frame", () => {
  assert.deepEqual(diffEntityViews([], [player, enemy]), { spawned: [player, enemy], updated: [], destroyedIds: [] });
});

test("updates existing views, spawns new entities and destroys views whose entity left the frame", () => {
  const diff = diffEntityViews(new Set([7, 2, 1, 3]), [player, shot]);

  assert.deepEqual(diff, { spawned: [shot], updated: [player], destroyedIds: [2, 3, 7] });
  assert.equal(Object.isFrozen(diff) && Object.isFrozen(diff.spawned) && Object.isFrozen(diff.destroyedIds), true);
});

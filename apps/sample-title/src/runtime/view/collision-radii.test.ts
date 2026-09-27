import assert from "node:assert/strict";
import test from "node:test";

import { loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import { collectCollisionRadii } from "./collision-radii.ts";

test("looks up the collision radius of every rendered definition by id", async () => {
  const radii = collectCollisionRadii(await loadSampleTitleDefinition());

  assert.deepEqual(Object.fromEntries(radii), {
    "player.default": 3,
    "enemy.drone": 10,
    "enemy.gunship": 22,
    "enemy.scout": 12,
    "bullet.blue_large": 6,
    "bullet.red_small": 4,
    "playerShot.basic": 5,
  });
});

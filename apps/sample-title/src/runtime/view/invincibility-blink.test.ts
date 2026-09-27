import assert from "node:assert/strict";
import test from "node:test";

import { isPlayerVisible, isPlayerVisibleWhileInvincible } from "./invincibility-blink.ts";

test("keeps the player visible outside invincibility", () => {
  assert.equal(isPlayerVisibleWhileInvincible(0), true);
});

test("alternates hidden and visible every four remaining ticks while invincible", () => {
  const phases = Array.from({ length: 12 }, (_, index) => isPlayerVisibleWhileInvincible(120 - index));

  assert.deepEqual(phases, [false, true, true, true, true, false, false, false, false, true, true, true]);
  assert.deepEqual([7, 4, 3, 1].map(isPlayerVisibleWhileInvincible), [true, true, false, false]);
});

test("blinks only while playing so a paused or ended stage shows the player", () => {
  assert.equal(isPlayerVisibleWhileInvincible(120), false);
  assert.deepEqual(
    (["playing", "paused", "stageCleared", "gameOver"] as const).map((lifecycle) => isPlayerVisible(lifecycle, 120)),
    [false, true, true, true],
  );
  assert.equal(isPlayerVisible("playing", 119), true);
});

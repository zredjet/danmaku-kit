import assert from "node:assert/strict";
import test from "node:test";

import { STAGE_START_DURATION_MS, StageStartTimer } from "./stage-start-timer.ts";

test("finishes after the start duration of render time", () => {
  const timer = new StageStartTimer();

  assert.equal(STAGE_START_DURATION_MS, 1_000);
  assert.deepEqual([timer.advance(400), timer.advance(400), timer.advance(199), timer.advance(1)], [false, false, false, true]);
});

test("does not count the frame that returns from a focus loss and ignores invalid deltas", () => {
  const timer = new StageStartTimer(100);

  timer.suspend();
  assert.equal(timer.advance(5_000), false);
  assert.deepEqual([timer.advance(Number.NaN), timer.advance(-50), timer.advance(99), timer.advance(1)], [false, false, false, true]);
});

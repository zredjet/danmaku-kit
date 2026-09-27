import assert from "node:assert/strict";
import test from "node:test";

import { STAGE_START_DURATION_MS, StageStartTimer } from "./stage-start-timer.ts";

test("finishes after the start duration of render time", () => {
  const timer = new StageStartTimer();

  assert.equal(STAGE_START_DURATION_MS, 1_000);
  assert.deepEqual([timer.advance(400), timer.advance(400), timer.advance(199), timer.advance(1)], [false, false, false, true]);
});

test("stays stopped while suspended and drops the first frame after resuming", () => {
  const timer = new StageStartTimer(100);

  timer.suspend();
  // focus だけを失って window が表示されている間も render frame は届くが、timer は進めない。
  assert.deepEqual([timer.advance(5_000), timer.advance(5_000)], [false, false]);
  timer.resume();
  assert.equal(timer.advance(5_000), false);
  assert.deepEqual([timer.advance(Number.NaN), timer.advance(-50), timer.advance(99), timer.advance(1)], [false, false, false, true]);
});

test("ignores a resume without a suspend", () => {
  const timer = new StageStartTimer(100);

  timer.resume();
  assert.equal(timer.advance(100), true);
});

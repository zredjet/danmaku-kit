import assert from "node:assert/strict";
import test from "node:test";

import { FixedTickClock, MAX_CATCH_UP_TICKS_PER_FRAME } from "./fixed-tick-clock.ts";

const TICK_MS = 1000 / 60;

test("turns variable frame deltas into whole fixed ticks and carries the remainder", () => {
  const clock = new FixedTickClock();

  assert.deepEqual(clock.advance(10), { ticks: 0, droppedTicks: 0 });
  assert.deepEqual(clock.advance(10), { ticks: 1, droppedTicks: 0 });
  assert.deepEqual(clock.advance(TICK_MS), { ticks: 1, droppedTicks: 0 });
  assert.deepEqual(clock.advance(50), { ticks: 3, droppedTicks: 0 });
  assert.deepEqual(
    Array.from({ length: 60 }, () => clock.advance(TICK_MS).ticks).reduce((sum, ticks) => sum + ticks, 0),
    60,
  );
});

test("caps catch-up per frame and drops the excess instead of carrying it", () => {
  const clock = new FixedTickClock();

  assert.deepEqual(clock.advance(TICK_MS * MAX_CATCH_UP_TICKS_PER_FRAME), { ticks: 5, droppedTicks: 0 });
  assert.deepEqual(clock.advance(TICK_MS * 8.5), { ticks: 5, droppedTicks: 3 });
  assert.deepEqual(clock.advance(0), { ticks: 0, droppedTicks: 0 });
  assert.deepEqual(clock.advance(1000), { ticks: 5, droppedTicks: 55 });
  assert.equal(clock.droppedTicksTotal, 58);
});

test("discards paused time on reset and ignores non-finite or negative deltas", () => {
  const clock = new FixedTickClock();

  assert.deepEqual(clock.advance(TICK_MS * 0.9), { ticks: 0, droppedTicks: 0 });
  clock.reset();
  assert.deepEqual(clock.advance(TICK_MS * 0.9), { ticks: 0, droppedTicks: 0 });
  assert.deepEqual(clock.advance(Number.NaN), { ticks: 0, droppedTicks: 0 });
  assert.deepEqual(clock.advance(Number.POSITIVE_INFINITY), { ticks: 0, droppedTicks: 0 });
  assert.deepEqual(clock.advance(-TICK_MS), { ticks: 0, droppedTicks: 0 });
  assert.deepEqual(clock.advance(TICK_MS * 0.2), { ticks: 1, droppedTicks: 0 });
  assert.equal(clock.droppedTicksTotal, 0);
});

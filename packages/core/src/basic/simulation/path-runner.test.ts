import assert from "node:assert/strict";
import test from "node:test";

import type { PathSegmentDefinition } from "../content/types.ts";
import { sinOfAngleSteps } from "./deterministic-trig.ts";
import {
  advancePathRunner,
  createPathRunnerState,
  isPathRunnerFinished,
  resolvePathRunnerAt,
} from "./path-runner.ts";
import type { PathRunnerAdvance } from "./path-runner.ts";

const segments: readonly PathSegmentDefinition[] = [
  { type: "velocity", duration: 3, velocity: { x: 0, y: 1.4 } },
  { type: "velocity", duration: 2, velocity: { x: 0.1, y: -2.2 } },
];

function runTicks(count: number): PathRunnerAdvance[] {
  const steps: PathRunnerAdvance[] = [];
  let state = createPathRunnerState({ x: 192, y: -16 });
  let position = { x: 192, y: -16 };
  for (let tick = 0; tick < count; tick += 1) {
    const step = advancePathRunner(state, position, segments);
    steps.push(step);
    state = step.state;
    position = step.position;
  }
  return steps;
}

test("moves along each segment from its start position and hands the end position to the next segment", () => {
  const steps = runTicks(7);

  assert.deepEqual(steps.map((step) => [step.state.segmentIndex, step.state.segmentElapsedTicks, step.finished]), [
    [0, 1, false],
    [0, 2, false],
    [1, 0, false],
    [1, 1, false],
    [2, 0, true],
    [2, 0, true],
    [2, 0, true],
  ]);
  assert.deepEqual(steps.map((step) => step.position), [
    { x: 192, y: -16 + 1.4 },
    { x: 192, y: -16 + 1.4 * 2 },
    { x: 192, y: -16 + 1.4 * 3 },
    { x: 192 + 0.1, y: -16 + 1.4 * 3 + -2.2 },
    { x: 192 + 0.1 * 2, y: -16 + 1.4 * 3 + -2.2 * 2 },
    { x: 192 + 0.1 * 2, y: -16 + 1.4 * 3 + -2.2 * 2 },
    { x: 192 + 0.1 * 2, y: -16 + 1.4 * 3 + -2.2 * 2 },
  ]);
  assert.deepEqual(steps[2]!.state.segmentStart, steps[2]!.position);
  assert.equal(steps[5]!.state, steps[4]!.state);
});

test("treats a path without segments as already finished at the spawn position", () => {
  const state = createPathRunnerState({ x: 10, y: 20 });
  const step = advancePathRunner(state, { x: 10, y: 20 }, []);

  assert.equal(isPathRunnerFinished(state, []), true);
  assert.deepEqual(step, { state, position: { x: 10, y: 20 }, finished: true });
  assert.deepEqual(resolvePathRunnerAt({ x: 10, y: 20 }, [], 50), step);
});

test("resolves the same runner state and position as advancing tick by tick", () => {
  const steps = runTicks(8);

  assert.deepEqual(resolvePathRunnerAt({ x: 192, y: -16 }, segments, 0), {
    state: createPathRunnerState({ x: 192, y: -16 }),
    position: { x: 192, y: -16 },
    finished: false,
  });
  for (const [index, step] of steps.entries()) {
    assert.deepEqual(resolvePathRunnerAt({ x: 192, y: -16 }, segments, index + 1), step, `progress ${index + 1}`);
  }
});

test("adds a table-based sine offset whose phase floors t * 1440 / periodTicks", () => {
  const sineSegments: readonly PathSegmentDefinition[] = [
    { type: "velocity", duration: 120, velocity: { x: 0, y: 1 }, offset: { type: "sine", axis: "x", amplitude: 32, periodTicks: 120 } },
    { type: "velocity", duration: 14, velocity: { x: 0, y: 0 }, offset: { type: "sine", axis: "y", amplitude: 10, periodTicks: 7 } },
  ];
  const spawn = { x: 100, y: 0 };
  const at = (progressTicks: number) => resolvePathRunnerAt(spawn, sineSegments, progressTicks).position;

  assert.deepEqual([30, 60, 90].map(at), [{ x: 132, y: 30 }, { x: 100, y: 60 }, { x: 68, y: 90 }]);
  assert.deepEqual(at(1), { x: 100 + 32 * sinOfAngleSteps(12), y: 1 });
  // 周期 120 tick の segment は t = 120 で位相 1,440 step（sin 0）に戻るため、次の segment は変位なしの位置から始まる。
  assert.deepEqual(resolvePathRunnerAt(spawn, sineSegments, 120).state.segmentStart, { x: 100, y: 120 });
  // 1,440 を割り切らない周期 7 の位相は floor(1 * 1440 / 7) = 205 step になる。
  assert.deepEqual(at(121), { x: 100, y: 120 + 10 * sinOfAngleSteps(205) });

  let state = createPathRunnerState(spawn);
  let position: { x: number; y: number } = spawn;
  for (let tick = 1; tick <= 140; tick += 1) {
    const step = advancePathRunner(state, position, sineSegments);
    assert.deepEqual(step, resolvePathRunnerAt(spawn, sineSegments, tick), `progress ${tick}`);
    state = step.state;
    position = step.position;
  }
});

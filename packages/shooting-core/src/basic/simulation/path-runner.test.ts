import assert from "node:assert/strict";
import test from "node:test";

import type { PathSegmentDefinition } from "../content/types.ts";
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

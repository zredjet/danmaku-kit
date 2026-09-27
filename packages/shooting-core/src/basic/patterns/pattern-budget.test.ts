import assert from "node:assert/strict";
import test from "node:test";

import type { PatternDefinition, PatternStepDefinition } from "../content/types.ts";
import { analyzePatternProgram } from "./pattern-budget.ts";
import { compilePatternProgram } from "./pattern-program.ts";

function analyze(steps: readonly PatternStepDefinition[]) {
  const pattern: PatternDefinition = { id: "pattern.test", version: 1, steps };
  return analyzePatternProgram(compilePatternProgram(pattern, "normal")!);
}

const fire = (count = 1): PatternStepDefinition => ({
  fire: { bullet: "bullet.red_small", aim: "player", speed: 2, ...(count > 1 ? { fan: { count, spreadDeg: count - 1 } } : {}) },
});

test("measures the first fire, the repeating cycle and the largest run of a looping pattern", () => {
  assert.deepEqual(analyze([{ wait: 20 }, fire(3), { wait: 50 }, { loop: 1 }]), {
    maxBulletsPerRun: 3,
    maxCommandsPerRun: 3,
    firstFireTicks: 20,
    cycle: { durationTicks: 50, bullets: 3 },
    unreachableSteps: [],
  });
});

test("adds up every fire of one run and stops at the end without a cycle", () => {
  assert.deepEqual(analyze([{ wait: 5 }, fire(4), fire(2), fire()]), {
    maxBulletsPerRun: 7,
    maxCommandsPerRun: 3,
    firstFireTicks: 5,
    cycle: null,
    unreachableSteps: [],
  });
  assert.equal(analyze([fire()]).firstFireTicks, 0);
});

test("finds steps after a loop that no run from the spawn executes", () => {
  const budget = analyze([{ wait: 10 }, fire(), { wait: 5 }, { loop: 0 }, { wait: 3 }, fire()]);

  assert.deepEqual(budget.unreachableSteps, [4, 5]);
  assert.deepEqual(budget.cycle, { durationTicks: 15, bullets: 1 });
});

test("reports no first fire for a pattern that only waits", () => {
  assert.deepEqual(analyze([{ wait: 10 }, { loop: 0 }]), {
    maxBulletsPerRun: 0,
    maxCommandsPerRun: 2,
    firstFireTicks: null,
    cycle: { durationTicks: 10, bullets: 0 },
    unreachableSteps: [],
  });
});

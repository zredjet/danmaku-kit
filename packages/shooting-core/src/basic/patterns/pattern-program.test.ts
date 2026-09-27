import assert from "node:assert/strict";
import test from "node:test";

import type { PatternDefinition, PatternStepDefinition } from "../content/types.ts";
import { compilePatternProgram } from "./pattern-program.ts";
import type { PatternFireCommand } from "./pattern-program.ts";

function compile(steps: readonly PatternStepDefinition[]) {
  const program = compilePatternProgram({ id: "pattern.test", version: 1, steps });
  assert.ok(program);
  return program;
}

const aimedThreeWay: PatternFireCommand = {
  bullet: "bullet.red_small",
  speed: 2.5,
  direction: { kind: "aimAtPlayer" },
  fanOffsetSteps: [-48, 0, 48],
};

test("returns null for patterns without steps", () => {
  const fireOnSpawn: PatternDefinition = {
    id: "pattern.spawn",
    version: 1,
    fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 8 } },
  };

  assert.equal(compilePatternProgram({ id: "pattern.none", version: 1 }), null);
  assert.equal(compilePatternProgram(fireOnSpawn), null);
});

test("normalizes fire directions and spreads fan bullets evenly around the base step", () => {
  const program = compile([
    { fire: { bullet: "bullet.red_small", aim: "player", speed: 2.5, fan: { count: 3, spreadDeg: 24 } } },
    { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 3 } },
    { fire: { bullet: "bullet.red_small", angleDeg: -45, speed: 1, fan: { count: 4, spreadDeg: 1.5 } } },
    { fire: { bullet: "bullet.red_small", angleDeg: 0, speed: 1, fan: { count: 2, spreadDeg: 0 } } },
  ]);

  assert.deepEqual(program.runs[0]!.fires, [
    aimedThreeWay,
    { bullet: "bullet.red_small", speed: 3, direction: { kind: "angle", angleSteps: 360 }, fanOffsetSteps: [0] },
    { bullet: "bullet.red_small", speed: 1, direction: { kind: "angle", angleSteps: -180 }, fanOffsetSteps: [-3, -1, 1, 3] },
    { bullet: "bullet.red_small", speed: 1, direction: { kind: "angle", angleSteps: 0 }, fanOffsetSteps: [0, 0] },
  ]);
  assert.equal(program.runs[0]!.bulletCount, 10);
  assert.equal(Object.is(program.runs[0]!.fires[3]!.fanOffsetSteps[0], -0), false);
});

test("resolves each cursor's run up to the next wait or the end", () => {
  const program = compile([
    { wait: 20 },
    { fire: { bullet: "bullet.red_small", aim: "player", speed: 2.5, fan: { count: 3, spreadDeg: 24 } } },
    { wait: 50 },
    { loop: 1 },
  ]);

  assert.equal(program.length, 4);
  assert.deepEqual(program.runs, [
    { fires: [], bulletCount: 0, executedCommands: 1, executedSteps: [0], next: { cursor: 1, waitTicks: 20 } },
    { fires: [aimedThreeWay], bulletCount: 3, executedCommands: 2, executedSteps: [1, 2], next: { cursor: 3, waitTicks: 50 } },
    { fires: [], bulletCount: 0, executedCommands: 1, executedSteps: [2], next: { cursor: 3, waitTicks: 50 } },
    { fires: [aimedThreeWay], bulletCount: 3, executedCommands: 3, executedSteps: [1, 2, 3], next: { cursor: 3, waitTicks: 50 } },
    { fires: [], bulletCount: 0, executedCommands: 0, executedSteps: [], next: null },
  ]);
  assert.equal(Object.isFrozen(program.runs[1]!.fires), true);
});

test("follows nested loops back through their waits and runs off the end without a loop", () => {
  const fire = { bullet: "bullet.red_small", angleDeg: 90, speed: 1 } as const;
  const program = compile([
    { fire },
    { wait: 2 },
    { fire },
    { loop: 1 },
    { fire },
  ]);
  const ending = compile([{ fire }, { fire }]);

  assert.deepEqual(program.runs.map((run) => [run.fires.length, run.executedCommands, run.next]), [
    [1, 2, { cursor: 2, waitTicks: 2 }],
    [0, 1, { cursor: 2, waitTicks: 2 }],
    [1, 3, { cursor: 2, waitTicks: 2 }],
    [0, 2, { cursor: 2, waitTicks: 2 }],
    [1, 1, null],
    [0, 0, null],
  ]);
  assert.deepEqual(ending.runs.map((run) => [run.bulletCount, run.executedCommands, run.next]), [
    [2, 2, null],
    [1, 1, null],
    [0, 0, null],
  ]);
});

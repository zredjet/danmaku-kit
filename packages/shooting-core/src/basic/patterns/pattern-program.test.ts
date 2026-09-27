import assert from "node:assert/strict";
import test from "node:test";

import type { Difficulty, PatternDefinition, PatternStepDefinition } from "../content/types.ts";
import { compilePatternProgram } from "./pattern-program.ts";
import type { PatternFireCommand } from "./pattern-program.ts";

function compile(steps: readonly PatternStepDefinition[], difficulty: Difficulty = "normal") {
  const program = compilePatternProgram({ id: "pattern.test", version: 1, steps }, difficulty);
  assert.ok(program);
  return program;
}

/** 同じ速さで `offsets` の向きへ撃つ発射命令の弾。 */
const bulletsAt = (speed: number, offsets: readonly number[]) => offsets.map((offsetSteps) => ({ offsetSteps, speed }));

const aimedThreeWay: PatternFireCommand = {
  bullet: "bullet.red_small",
  direction: { kind: "aimAtPlayer" },
  bullets: bulletsAt(2.5, [-48, 0, 48]),
};

test("returns null for patterns without steps", () => {
  const fireOnSpawn: PatternDefinition = {
    id: "pattern.spawn",
    version: 1,
    fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 8 } },
  };

  assert.equal(compilePatternProgram({ id: "pattern.none", version: 1 }, "normal"), null);
  assert.equal(compilePatternProgram(fireOnSpawn, "normal"), null);
});

test("normalizes fire directions and spreads fan bullets evenly around the base step", () => {
  const program = compile([
    { fire: { bullet: "bullet.red_small", aim: "player", speed: 2.5, fan: { count: 3, spreadDeg: 24 } } },
    { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 3 } },
    { fire: { bullet: "bullet.red_small", angleDeg: -45, speed: 1, fan: { count: 4, spreadDeg: 1.5 } } },
    { fire: { bullet: "bullet.red_small", angleDeg: 0, speed: 1, fan: { count: 2, spreadDeg: 0 } } },
  ]);

  assert.deepEqual(program.runs.get(0)!.fires, [
    aimedThreeWay,
    { bullet: "bullet.red_small", direction: { kind: "angle", angleSteps: 360 }, bullets: bulletsAt(3, [0]) },
    { bullet: "bullet.red_small", direction: { kind: "angle", angleSteps: -180 }, bullets: bulletsAt(1, [-3, -1, 1, 3]) },
    { bullet: "bullet.red_small", direction: { kind: "angle", angleSteps: 0 }, bullets: bulletsAt(1, [0, 0]) },
  ]);
  assert.equal(program.runs.get(0)!.bulletCount, 10);
  assert.equal(Object.is(program.runs.get(0)!.fires[3]!.bullets[0]!.offsetSteps, -0), false);
});

test("resolves each cursor's run up to the next wait or the end", () => {
  const program = compile([
    { wait: 20 },
    { fire: { bullet: "bullet.red_small", aim: "player", speed: 2.5, fan: { count: 3, spreadDeg: 24 } } },
    { wait: 50 },
    { loop: 1 },
  ]);

  assert.equal(program.length, 4);
  // run を始められるのは cursor 0、wait の直後（1 と 3）、末尾（4）だけ。
  assert.deepEqual([...program.runs], [
    [0, { fires: [], bulletCount: 0, executedCommands: 1, executedSteps: [0], next: { cursor: 1, waitTicks: 20 } }],
    [1, { fires: [aimedThreeWay], bulletCount: 3, executedCommands: 2, executedSteps: [1, 2], next: { cursor: 3, waitTicks: 50 } }],
    [3, { fires: [aimedThreeWay], bulletCount: 3, executedCommands: 3, executedSteps: [1, 2, 3], next: { cursor: 3, waitTicks: 50 } }],
    [4, { fires: [], bulletCount: 0, executedCommands: 0, executedSteps: [], next: null }],
  ]);
  assert.equal(Object.isFrozen(program.runs.get(1)!.fires), true);
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

  assert.deepEqual([...program.runs].map(([cursor, run]) => [cursor, run.fires.length, run.executedCommands, run.next]), [
    [0, 1, 2, { cursor: 2, waitTicks: 2 }],
    [2, 1, 3, { cursor: 2, waitTicks: 2 }],
    [5, 0, 0, null],
  ]);
  assert.deepEqual([...ending.runs].map(([cursor, run]) => [cursor, run.bulletCount, run.executedCommands, run.next]), [
    [0, 2, 2, null],
    [2, 0, 0, null],
  ]);
});

test("expands repeat into consecutive commands and points loops at the start of the target step", () => {
  const fire = { bullet: "bullet.red_small", angleDeg: 90, speed: 1 } as const;
  const program = compile([
    { wait: 3 },
    { repeat: { count: 2, steps: [{ fire }, { wait: 5 }] } },
    { wait: 10 },
    { loop: 1 },
  ]);

  // wait, fire, wait, fire, wait, wait, loop の 7 命令に展開し、loop は repeat の最初の命令（cursor 1）へ戻る。
  assert.deepEqual([program.stepCount, program.length], [4, 7]);
  assert.deepEqual([...program.runs].map(([cursor, run]) => [cursor, run.bulletCount, run.executedSteps, run.next]), [
    [0, 0, [0], { cursor: 1, waitTicks: 3 }],
    [1, 1, [1], { cursor: 3, waitTicks: 5 }],
    [3, 1, [1], { cursor: 5, waitTicks: 5 }],
    [5, 0, [2], { cursor: 6, waitTicks: 10 }],
    [6, 1, [1, 3], { cursor: 3, waitTicks: 5 }],
    [7, 0, [], null],
  ]);
});

test("spreads radial bullets around the circle from the base direction and stacks stream speeds per direction", () => {
  const program = compile([
    { fire: { bullet: "bullet.red_small", angleDeg: 90, radial: { count: 4 }, speed: 2 } },
    { fire: { bullet: "bullet.red_small", aim: "player", fan: { count: 2, spreadDeg: 10 }, stream: { count: 3, speedStep: -0.5 }, speed: 3 } },
  ]);

  assert.deepEqual(program.runs.get(0)!.fires.map((fire) => fire.bullets), [
    bulletsAt(2, [0, 360, 720, 1080]),
    [
      { offsetSteps: -20, speed: 3 },
      { offsetSteps: -20, speed: 2.5 },
      { offsetSteps: -20, speed: 2 },
      { offsetSteps: 20, speed: 3 },
      { offsetSteps: 20, speed: 2.5 },
      { offsetSteps: 20, speed: 2 },
    ],
  ]);
  assert.equal(program.runs.get(0)!.bulletCount, 10);
});

test("expands the difficulty branch of if and counts a branch without commands as passed", () => {
  const fire = { bullet: "bullet.red_small", angleDeg: 90, speed: 1 } as const;
  const steps: readonly PatternStepDefinition[] = [
    { if: { difficulty: ["hard"], then: [{ fire }, { fire }] } },
    { wait: 4 },
    { if: { difficulty: ["hard"], then: [{ wait: 2 }], else: [{ repeat: { count: 3, steps: [{ fire }] } }] } },
    { loop: 0 },
  ];
  const normal = compile(steps, "normal");
  const hard = compile(steps, "hard");

  // normal は最初の `if` が空になり、`loop` は空の step の位置（cursor 0 の wait）へ戻る。
  assert.deepEqual([normal.stepCount, normal.length], [4, 5]);
  assert.deepEqual([...normal.runs].map(([cursor, run]) => [cursor, run.bulletCount, run.executedSteps, run.next]), [
    [0, 0, [0, 1], { cursor: 1, waitTicks: 4 }],
    [1, 3, [0, 1, 2, 3], { cursor: 1, waitTicks: 4 }],
    [5, 0, [], null],
  ]);
  assert.deepEqual([hard.stepCount, hard.length], [4, 5]);
  assert.deepEqual([...hard.runs].map(([cursor, run]) => [cursor, run.bulletCount, run.executedSteps, run.next]), [
    [0, 2, [0, 1], { cursor: 3, waitTicks: 4 }],
    [3, 0, [2], { cursor: 4, waitTicks: 2 }],
    [4, 2, [0, 1, 3], { cursor: 3, waitTicks: 4 }],
    [5, 0, [], null],
  ]);
});

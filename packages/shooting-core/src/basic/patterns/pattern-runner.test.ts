import assert from "node:assert/strict";
import test from "node:test";

import type { PatternStepDefinition } from "../content/types.ts";
import { compilePatternProgram } from "./pattern-program.ts";
import type { PatternProgram } from "./pattern-program.ts";
import {
  advancePatternRunner,
  createEnemyPatternRunner,
  patternRunnerIdOfEnemy,
  projectPatternRunnerPayload,
} from "./pattern-runner.ts";
import type { PatternRunnerState } from "./pattern-runner.ts";
import { countPatternBulletsThrough, createPatternSchedule, patternRunAt, patternRunnerStateAt } from "./pattern-schedule.ts";

const aimed = { bullet: "bullet.red_small", aim: "player", speed: 2 } as const;
const threeWay = { ...aimed, fan: { count: 3, spreadDeg: 24 } } as const;

function compile(steps: readonly PatternStepDefinition[]): PatternProgram {
  const program = compilePatternProgram({ id: "pattern.test", version: 1, steps });
  assert.ok(program);
  return program;
}

function runTicks(program: PatternProgram, ticks: number) {
  const history: { state: PatternRunnerState; bullets: number; ran: boolean }[] = [];
  let state = createEnemyPatternRunner(2, "pattern.test").state;
  for (let tick = 0; tick < ticks; tick += 1) {
    const advance = advancePatternRunner(program, state);
    state = advance.state;
    history.push({ state, bullets: advance.run?.bulletCount ?? 0, ran: (advance.run?.executedCommands ?? 0) > 0 });
  }
  return history;
}

test("runs from the spawn tick and resumes N ticks after wait: N", () => {
  const program = compile([{ wait: 3 }, { fire: threeWay }, { wait: 2 }, { loop: 1 }]);
  const history = runTicks(program, 9);

  assert.deepEqual(history.map(({ state, bullets }) => [state.cursor, state.waitRemaining, bullets]), [
    [1, 3, 0],
    [1, 2, 0],
    [1, 1, 0],
    [3, 2, 3],
    [3, 1, 0],
    [3, 2, 3],
    [3, 1, 0],
    [3, 2, 3],
    [3, 1, 0],
  ]);
  assert.deepEqual(history.map(({ ran }) => ran), [true, false, false, true, false, true, false, true, false]);
});

test("stops at the end of the program and keeps a finished runner idle", () => {
  const program = compile([{ fire: aimed }, { wait: 2 }, { fire: aimed }]);
  const history = runTicks(program, 5);

  assert.deepEqual(history.map(({ state, bullets }) => [state.cursor, state.waitRemaining, bullets]), [
    [2, 2, 1],
    [2, 1, 0],
    [3, 0, 1],
    [3, 0, 0],
    [3, 0, 0],
  ]);
});

test("names runners after their enemy and projects the state as the serialized payload", () => {
  const runner = createEnemyPatternRunner(12, "pattern.test");

  assert.deepEqual(runner, { enemyId: 12, patternId: "pattern.test", state: { cursor: 0, waitRemaining: 0 } });
  assert.equal(patternRunnerIdOfEnemy(12), "patternRunner.enemy.12");
  assert.deepEqual(projectPatternRunnerPayload({ cursor: 3, waitRemaining: 7 }), { cursor: 3, waitRemaining: 7 });
});

test("resolves the same runner state, runs and bullet counts from the schedule as advancing tick by tick", () => {
  const programs = [
    compile([{ wait: 20 }, { fire: threeWay }, { wait: 50 }, { loop: 0 }]),
    compile([{ fire: aimed }, { wait: 2 }, { fire: threeWay }, { loop: 1 }, { fire: aimed }]),
    compile([{ fire: aimed }, { wait: 3 }, { fire: threeWay }, { wait: 5 }, { fire: aimed }, { wait: 1 }, { loop: 2 }]),
    compile([{ fire: aimed }, { wait: 7 }, { fire: threeWay }]),
    compile([{ fire: threeWay }]),
    compile([{ wait: 1 }, { loop: 0 }]),
    compile([{ wait: 4 }, { fire: aimed }, { wait: 2 }, { wait: 3 }, { loop: 3 }]),
    compile([{ repeat: { count: 3, steps: [{ fire: threeWay }, { wait: 2 }] } }, { wait: 5 }, { loop: 0 }]),
    compile([
      { wait: 1 },
      { repeat: { count: 2, steps: [{ fire: aimed }, { repeat: { count: 2, steps: [{ wait: 1 }, { fire: threeWay }] } }] } },
      { wait: 4 },
      { loop: 1 },
    ]),
  ];

  for (const [programIndex, program] of programs.entries()) {
    const schedule = createPatternSchedule(program);
    const history = runTicks(program, 400);
    let bullets = 0;
    assert.deepEqual(patternRunnerStateAt(schedule, 0), { cursor: 0, waitRemaining: 0 });
    for (const [elapsed, entry] of history.entries()) {
      bullets += entry.bullets;
      const label = `program ${programIndex} elapsed ${elapsed}`;
      assert.deepEqual(patternRunnerStateAt(schedule, elapsed + 1), entry.state, label);
      assert.equal((patternRunAt(schedule, elapsed)?.executedCommands ?? 0) > 0, entry.ran, label);
      assert.equal(patternRunAt(schedule, elapsed)?.bulletCount ?? 0, entry.bullets, label);
      assert.equal(countPatternBulletsThrough(schedule, elapsed), bullets, label);
    }
  }
});

test("finds runs far beyond the first cycle without stepping through each tick", () => {
  const schedule = createPatternSchedule(compile([{ wait: 20 }, { fire: threeWay }, { wait: 50 }, { loop: 0 }]));

  // 最初の wait の後から fire、wait、loop → wait の 70 tick 周期に入る。
  assert.deepEqual(schedule.cycle, { startIndex: 1, durationTicks: 70, bullets: 3 });
  assert.equal(patternRunAt(schedule, 20 + 70 * 100_000)?.bulletCount, 3);
  assert.equal(patternRunAt(schedule, 21 + 70 * 100_000), null);
  assert.equal(countPatternBulletsThrough(schedule, 20 + 70 * 100_000), 3 * 100_001);
  assert.deepEqual(patternRunnerStateAt(schedule, 21 + 70 * 100_000), { cursor: 3, waitRemaining: 50 });
  assert.throws(() => patternRunAt(schedule, -1), RangeError);
});

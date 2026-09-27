import type { PatternProgram } from "./pattern-program.ts";
import { createPatternSchedule } from "./pattern-schedule.ts";

/**
 * PatternProgram を spawn から実行したときの静的な予算（design 21.3）。load の意味の検証に使う。
 *
 * 命令列に分岐や乱数はないため、spawn から実行する run の並び（時刻表）は load 時に決まる。
 */
export type PatternStaticBudget = Readonly<{
  /** 1 run（1 tick）に撃つ弾数の最大。 */
  maxBulletsPerRun: number;
  /** 1 run に実行する命令数の最大。 */
  maxCommandsPerRun: number;
  /** spawn から最初に撃つ tick までの経過 tick。一度も撃たない pattern は null。 */
  firstFireTicks: number | null;
  /** 繰り返しに入る pattern の 1 周の tick 数と弾数。末尾で止まる pattern は null。 */
  cycle: Readonly<{ durationTicks: number; bullets: number }> | null;
  /** spawn からどの run でも実行されない step の index（昇順）。 */
  unreachableSteps: readonly number[];
}>;

/** program を spawn から実行する run だけを見て、静的な予算と到達しない step を求める。 */
export function analyzePatternProgram(program: PatternProgram): PatternStaticBudget {
  const schedule = createPatternSchedule(program);
  const runs = schedule.runs.map((scheduled) => ({ scheduled, run: program.runs.get(scheduled.cursor)! }));
  const reached = new Set(runs.flatMap(({ run }) => run.executedSteps));
  const firstFire = runs.find(({ run }) => run.bulletCount > 0);
  return Object.freeze({
    maxBulletsPerRun: Math.max(0, ...runs.map(({ run }) => run.bulletCount)),
    maxCommandsPerRun: Math.max(0, ...runs.map(({ run }) => run.executedCommands)),
    firstFireTicks: firstFire?.scheduled.elapsedTicks ?? null,
    cycle: schedule.cycle ? Object.freeze({ durationTicks: schedule.cycle.durationTicks, bullets: schedule.cycle.bullets }) : null,
    unreachableSteps: Object.freeze(Array.from({ length: program.stepCount }, (_, index) => index).filter((index) => !reached.has(index))),
  });
}

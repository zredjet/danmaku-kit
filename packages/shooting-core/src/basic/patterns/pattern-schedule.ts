import type { PatternProgram, PatternRun } from "./pattern-program.ts";
import { INITIAL_PATTERN_RUNNER_STATE, patternRunnerStateAfterRun } from "./pattern-runner.ts";
import type { PatternRunnerState } from "./pattern-runner.ts";

/** run を実行する経過 tick（spawn tick が 0）と cursor、それより前の run が撃った弾数。 */
type PatternScheduleRun = Readonly<{
  elapsedTicks: number;
  cursor: number;
  bulletsBefore: number;
}>;

/**
 * spawn tick から runner を進めたときの run の時刻表。restore が tick を 1 つずつ進めずに runner の進行を求めるのに使う。
 *
 * run の次の cursor と待ち tick 数は cursor だけで決まるため、run を始める cursor の列は命令数 + 1 回以内に繰り返しに入る。最初の
 * 繰り返しまでの run と、繰り返し 1 周の tick 数・弾数を持ち、任意の経過 tick の run を周期から求める。
 */
export type PatternSchedule = Readonly<{
  program: PatternProgram;
  runs: readonly PatternScheduleRun[];
  cycle: Readonly<{ startIndex: number; durationTicks: number; bullets: number }> | null;
}>;

/** program の run の時刻表を作る。 */
export function createPatternSchedule(program: PatternProgram): PatternSchedule {
  const runs: PatternScheduleRun[] = [];
  const runIndexByCursor = new Map<number, number>();
  let elapsedTicks = 0;
  let cursor = 0;
  let bullets = 0;
  for (;;) {
    const repeatedIndex = runIndexByCursor.get(cursor);
    if (repeatedIndex !== undefined) {
      const repeated = runs[repeatedIndex]!;
      return freezeSchedule(program, runs, {
        startIndex: repeatedIndex,
        durationTicks: elapsedTicks - repeated.elapsedTicks,
        bullets: bullets - repeated.bulletsBefore,
      });
    }
    runIndexByCursor.set(cursor, runs.length);
    runs.push(Object.freeze({ elapsedTicks, cursor, bulletsBefore: bullets }));
    const run = program.runs[cursor]!;
    bullets += run.bulletCount;
    if (!run.next) {
      return freezeSchedule(program, runs, null);
    }
    elapsedTicks += run.next.waitTicks;
    cursor = run.next.cursor;
  }
}

/** 経過 tick `elapsedTicks` に実行する run を返す。その tick に run がなければ null。 */
export function patternRunAt(schedule: PatternSchedule, elapsedTicks: number): PatternRun | null {
  const located = locateLatestRun(schedule, elapsedTicks);
  return located.elapsedTicks === elapsedTicks ? schedule.program.runs[located.cursor]! : null;
}

/** 経過 tick 0〜`elapsedTicks` の run が撃つ弾数の合計を返す。 */
export function countPatternBulletsThrough(schedule: PatternSchedule, elapsedTicks: number): number {
  const located = locateLatestRun(schedule, elapsedTicks);
  return located.bulletsBefore + schedule.program.runs[located.cursor]!.bulletCount;
}

/** spawn tick から `advancedTicks` tick 進めた runner state を返す。`advancePatternRunner()` を同じ回数呼んだ結果と一致する。 */
export function patternRunnerStateAt(schedule: PatternSchedule, advancedTicks: number): PatternRunnerState {
  if (advancedTicks === 0) {
    return INITIAL_PATTERN_RUNNER_STATE;
  }
  const located = locateLatestRun(schedule, advancedTicks - 1);
  const state = patternRunnerStateAfterRun(schedule.program, schedule.program.runs[located.cursor]!);
  if (state.waitRemaining === 0) {
    return state;
  }
  return Object.freeze({
    cursor: state.cursor,
    waitRemaining: state.waitRemaining - (advancedTicks - 1 - located.elapsedTicks),
  });
}

/** 経過 tick `elapsedTicks` 以前で最後に実行した run の経過 tick、cursor、それより前の弾数を返す。 */
function locateLatestRun(schedule: PatternSchedule, elapsedTicks: number): PatternScheduleRun {
  if (!Number.isSafeInteger(elapsedTicks) || elapsedTicks < 0) {
    throw new RangeError("elapsed ticks must be a non-negative safe integer");
  }
  const { runs, cycle } = schedule;
  const cycleStart = cycle ? runs[cycle.startIndex]! : null;
  if (!cycle || !cycleStart || elapsedTicks < cycleStart.elapsedTicks) {
    return findLatestRun(runs, 0, runs.length, elapsedTicks);
  }
  const repeats = Math.floor((elapsedTicks - cycleStart.elapsedTicks) / cycle.durationTicks);
  const run = findLatestRun(runs, cycle.startIndex, runs.length, elapsedTicks - repeats * cycle.durationTicks);
  return Object.freeze({
    elapsedTicks: run.elapsedTicks + repeats * cycle.durationTicks,
    cursor: run.cursor,
    bulletsBefore: run.bulletsBefore + repeats * cycle.bullets,
  });
}

/** `runs[start, end)` のうち経過 tick が `elapsedTicks` 以下の最後の run を二分探索する。`runs[start]` は条件を満たす。 */
function findLatestRun(
  runs: readonly PatternScheduleRun[],
  start: number,
  end: number,
  elapsedTicks: number,
): PatternScheduleRun {
  let low = start;
  let high = end;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (runs[middle]!.elapsedTicks <= elapsedTicks) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return runs[low]!;
}

function freezeSchedule(
  program: PatternProgram,
  runs: readonly PatternScheduleRun[],
  cycle: PatternSchedule["cycle"],
): PatternSchedule {
  return Object.freeze({
    program,
    runs: Object.freeze([...runs]),
    cycle: cycle ? Object.freeze(cycle) : null,
  });
}

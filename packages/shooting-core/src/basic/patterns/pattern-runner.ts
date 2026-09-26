import type { PatternId } from "../content/types.ts";
import type { EntityId } from "../simulation/entity.ts";
import type { PatternProgram, PatternRun } from "./pattern-program.ts";

/** serialized state の `patternRunnerStates[].stateVersion`。payload の形を変えたら上げる。 */
export const PATTERN_RUNNER_STATE_VERSION = 1;

/**
 * PatternProgram 上の実行位置。
 *
 * `cursor` は次の run を始める命令の index（命令列の末尾まで実行した runner は命令数）、`waitRemaining` は次の run までに進める
 * tick 数で、1 なら次の tick に run を実行する。0 は待たずに実行する生成直後の runner と、末尾まで実行した runner だけが持つ。
 */
export type PatternRunnerState = Readonly<{
  cursor: number;
  waitRemaining: number;
}>;

/** enemy 1 体が spawn tick から実行する pattern runner。enemy がいなくなった tick の終わりに破棄する。 */
export type EnemyPatternRunner = Readonly<{
  enemyId: EntityId;
  patternId: PatternId;
  state: PatternRunnerState;
}>;

/** runner を 1 tick 進めた結果。`run` はその tick に実行した命令のまとまりで、待っている tick は null。 */
export type PatternRunnerAdvance = Readonly<{
  state: PatternRunnerState;
  run: PatternRun | null;
}>;

/** spawn した enemy の、まだ命令を実行していない runner を作る。 */
export function createEnemyPatternRunner(enemyId: EntityId, patternId: PatternId): EnemyPatternRunner {
  return Object.freeze({
    enemyId,
    patternId,
    state: Object.freeze({ cursor: 0, waitRemaining: 0 }),
  });
}

/**
 * runner を 1 tick 進める。
 *
 * 次の run まで 2 tick 以上残っていれば待ち tick を 1 減らすだけにし、それ以外は cursor から次の `wait` か末尾まで命令を実行する。
 * `wait: N` で止まった run の次の run は N tick 後に実行する。
 */
export function advancePatternRunner(program: PatternProgram, state: PatternRunnerState): PatternRunnerAdvance {
  if (state.waitRemaining > 1) {
    return Object.freeze({
      state: Object.freeze({ cursor: state.cursor, waitRemaining: state.waitRemaining - 1 }),
      run: null,
    });
  }
  const run = program.runs[state.cursor];
  if (!run) {
    throw new RangeError("pattern runner cursor must be within the program");
  }
  return Object.freeze({ state: patternRunnerStateAfterRun(program, run), run });
}

/** run を実行した tick の終わりの runner state を返す。末尾まで実行した runner は cursor を命令数にして止まる。 */
export function patternRunnerStateAfterRun(program: PatternProgram, run: PatternRun): PatternRunnerState {
  return run.next
    ? Object.freeze({ cursor: run.next.cursor, waitRemaining: run.next.waitTicks })
    : Object.freeze({ cursor: program.length, waitRemaining: 0 });
}

/** serialized state で enemy の runner を指す `runnerId`。 */
export function patternRunnerIdOfEnemy(enemyId: EntityId): `patternRunner.${string}` {
  return `patternRunner.enemy.${enemyId}`;
}

/** serialize / hash の payload に写す runner state。 */
export function projectPatternRunnerPayload(state: PatternRunnerState): Readonly<{ cursor: number; waitRemaining: number }> {
  return Object.freeze({ cursor: state.cursor, waitRemaining: state.waitRemaining });
}

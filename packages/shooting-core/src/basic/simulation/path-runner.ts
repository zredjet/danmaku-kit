import type { PathSegmentDefinition } from "../content/types.ts";
import type { Vector2 } from "../entities/model-common.ts";

/**
 * path 上の進行状態（design 9.8 の PathRunner）。
 *
 * 位置は現在の segment の開始位置 `p0` と経過 tick `t` から `p0 + velocity * t` として毎 tick 求め直し、tick ごとの加算誤差を
 * 積まない。segment を終えた tick の位置を次 segment の `p0` にする。`segmentIndex` が segment 数と等しい runner は path を
 * 終えており、それ以降は位置を変えない。
 */
export type PathRunnerState = Readonly<{
  segmentIndex: number;
  segmentStart: Vector2;
  segmentElapsedTicks: number;
}>;

/** path runner を 1 tick 進めた結果。 */
export type PathRunnerAdvance = Readonly<{
  state: PathRunnerState;
  position: Vector2;
  finished: boolean;
}>;

/** spawn 位置から最初の segment を始める runner を作る。 */
export function createPathRunnerState(spawnPosition: Vector2): PathRunnerState {
  return Object.freeze({
    segmentIndex: 0,
    segmentStart: Object.freeze({ x: spawnPosition.x, y: spawnPosition.y }),
    segmentElapsedTicks: 0,
  });
}

/** runner が path の全 segment を終えているかを返す。 */
export function isPathRunnerFinished(state: PathRunnerState, segments: readonly PathSegmentDefinition[]): boolean {
  return state.segmentIndex >= segments.length;
}

/**
 * runner を 1 tick 進め、次の runner と位置を返す。
 *
 * path を終えている runner は同じ state と位置をそのまま返す。segment の最後の tick では、その位置を次 segment の開始位置にして
 * 経過 tick を 0 に戻す。
 */
export function advancePathRunner(
  state: PathRunnerState,
  position: Vector2,
  segments: readonly PathSegmentDefinition[],
): PathRunnerAdvance {
  const segment = segments[state.segmentIndex];
  if (!segment) {
    return Object.freeze({ state, position, finished: true });
  }

  const elapsedTicks = state.segmentElapsedTicks + 1;
  const nextPosition = moveAlongSegment(state.segmentStart, segment, elapsedTicks);
  if (elapsedTicks < segment.duration) {
    return Object.freeze({
      state: Object.freeze({
        segmentIndex: state.segmentIndex,
        segmentStart: state.segmentStart,
        segmentElapsedTicks: elapsedTicks,
      }),
      position: nextPosition,
      finished: false,
    });
  }
  const nextState = Object.freeze({
    segmentIndex: state.segmentIndex + 1,
    segmentStart: nextPosition,
    segmentElapsedTicks: 0,
  });
  return Object.freeze({
    state: nextState,
    position: nextPosition,
    finished: isPathRunnerFinished(nextState, segments),
  });
}

/**
 * spawn 位置から `progressTicks` tick 進んだ runner と位置を、segment 単位で求める。
 *
 * `advancePathRunner()` を `progressTicks` 回呼んだ結果と同じ値になる（segment の終点は同じ `p0 + velocity * duration`、
 * segment 内は同じ `p0 + velocity * t` で計算する）。restore が現在座標から逆算せずに runner state を検証するために使う。
 */
export function resolvePathRunnerAt(
  spawnPosition: Vector2,
  segments: readonly PathSegmentDefinition[],
  progressTicks: number,
): PathRunnerAdvance {
  let segmentIndex = 0;
  let segmentStart: Vector2 = Object.freeze({ x: spawnPosition.x, y: spawnPosition.y });
  let remainingTicks = progressTicks;
  while (segmentIndex < segments.length && remainingTicks >= segments[segmentIndex]!.duration) {
    const segment = segments[segmentIndex]!;
    segmentStart = moveAlongSegment(segmentStart, segment, segment.duration);
    remainingTicks -= segment.duration;
    segmentIndex += 1;
  }

  const segment = segments[segmentIndex];
  const elapsedTicks = segment ? remainingTicks : 0;
  const state = Object.freeze({ segmentIndex, segmentStart, segmentElapsedTicks: elapsedTicks });
  return Object.freeze({
    state,
    position: segment && elapsedTicks > 0 ? moveAlongSegment(segmentStart, segment, elapsedTicks) : segmentStart,
    finished: segment === undefined,
  });
}

function moveAlongSegment(start: Vector2, segment: PathSegmentDefinition, elapsedTicks: number): Vector2 {
  return Object.freeze({
    x: start.x + segment.velocity.x * elapsedTicks,
    y: start.y + segment.velocity.y * elapsedTicks,
  });
}

import type { Vector2 } from "../entities/model-common.ts";
import { ANGLE_STEPS_PER_TURN } from "../shared/angle-steps.ts";
import { QUARTER_WAVE_SINE_TABLE, SINE_TABLE_SCALE } from "./sine-table.ts";

const QUARTER_TURN_STEPS = ANGLE_STEPS_PER_TURN / 4;
const HALF_TURN_STEPS = ANGLE_STEPS_PER_TURN / 2;

/**
 * 角度 step の sine を生成済みの表から引く（design 10）。
 *
 * tick 中に host の `Math.sin` を使わず、0〜90° の表を対称性で 1 周へ広げる。補間しないので、角度は整数 step で渡す。
 * 角度は画面座標系で +x を 0、+y（下）へ回る向きを正とする。
 */
export function sinOfAngleSteps(steps: number): number {
  if (!Number.isSafeInteger(steps)) {
    throw new RangeError("angle steps must be a safe integer");
  }
  const normalized = ((steps % ANGLE_STEPS_PER_TURN) + ANGLE_STEPS_PER_TURN) % ANGLE_STEPS_PER_TURN;
  const quadrant = Math.floor(normalized / QUARTER_TURN_STEPS);
  const offset = normalized % QUARTER_TURN_STEPS;
  const fixed = QUARTER_WAVE_SINE_TABLE[quadrant % 2 === 0 ? offset : QUARTER_TURN_STEPS - offset]!;
  // 180° の sine を -0 にしないよう、0 は符号を付けずに返す。
  if (fixed === 0) {
    return 0;
  }
  return (quadrant < 2 ? fixed : -fixed) / SINE_TABLE_SCALE;
}

/** 角度 step の cosine を、90° ずらした sine として引く。 */
export function cosOfAngleSteps(steps: number): number {
  return sinOfAngleSteps(steps + QUARTER_TURN_STEPS);
}

/** 角度 step の向きを持つ単位 vector を返す。 */
export function unitVectorAtAngleSteps(steps: number): Vector2 {
  return Object.freeze({ x: cosOfAngleSteps(steps), y: sinOfAngleSteps(steps) });
}

/**
 * vector の向きに最も近い角度 step（0〜1,439）を返す。`aim: player` の向きを表の方向へそろえるのに使う。
 *
 * host の `Math.atan2` を使わず、0〜90° の表の方向との外積の符号で二分探索し、隣り合う 2 step のうち内積が大きい方を選ぶ。
 * 演算は四則演算と比較だけなので host によらず同じ step になる。零 vector は真下を向く。
 */
export function angleStepsOfVector(vector: Vector2): number {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    throw new RangeError("vector components must be finite");
  }
  const absX = Math.abs(vector.x);
  const absY = Math.abs(vector.y);
  const scale = Math.max(absX, absY);
  if (scale === 0) {
    return QUARTER_TURN_STEPS;
  }
  // 表の整数と掛けても overflow しないよう、長い方の成分を 1 にそろえる。
  const step = nearestQuarterWaveStep(absX / scale, absY / scale);
  if (vector.x >= 0) {
    return vector.y >= 0 ? step : (ANGLE_STEPS_PER_TURN - step) % ANGLE_STEPS_PER_TURN;
  }
  return vector.y >= 0 ? HALF_TURN_STEPS - step : HALF_TURN_STEPS + step;
}

/** 第 1 象限の向き `(x, y)` に最も近い 0〜360 の step を返す。 */
function nearestQuarterWaveStep(x: number, y: number): number {
  // 向きが step 以上になる（step の方向との外積が負でない）最大の step を探す。high は条件を満たさない番兵。
  let low = 0;
  let high = QUARTER_TURN_STEPS + 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (crossWithQuarterWaveStep(middle, x, y) >= 0) {
      low = middle;
    } else {
      high = middle;
    }
  }
  if (low === QUARTER_TURN_STEPS) {
    return low;
  }
  return dotWithQuarterWaveStep(low + 1, x, y) > dotWithQuarterWaveStep(low, x, y) ? low + 1 : low;
}

/** step の方向と `(x, y)` の外積を表の整数のまま求める。 */
function crossWithQuarterWaveStep(step: number, x: number, y: number): number {
  return QUARTER_WAVE_SINE_TABLE[QUARTER_TURN_STEPS - step]! * y - QUARTER_WAVE_SINE_TABLE[step]! * x;
}

/** step の方向と `(x, y)` の内積を表の整数のまま求める。 */
function dotWithQuarterWaveStep(step: number, x: number, y: number): number {
  return QUARTER_WAVE_SINE_TABLE[QUARTER_TURN_STEPS - step]! * x + QUARTER_WAVE_SINE_TABLE[step]! * y;
}

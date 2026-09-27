/** 決定的な角度計算で 1 周を分ける step 数。1 step は 0.25°。 */
export const ANGLE_STEPS_PER_TURN = 1_440;

/** 1° あたりの step 数。 */
export const ANGLE_STEPS_PER_DEGREE = 4;

/**
 * 度数を角度 step に変換する。0.25° の倍数でない値と有限でない値は null を返す。
 *
 * 4 倍は 2 の冪の乗算なので丸めを伴わず、0.25° の倍数は必ず整数 step になる。content validation は null になる角度を拒否する。
 */
export function angleStepsFromDegrees(degrees: number): number | null {
  const steps = degrees * ANGLE_STEPS_PER_DEGREE;
  return Number.isSafeInteger(steps) ? steps : null;
}

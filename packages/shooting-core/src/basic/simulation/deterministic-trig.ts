import type { Vector2 } from "../entities/model-common.ts";
import { ANGLE_STEPS_PER_TURN } from "../shared/angle-steps.ts";
import { QUARTER_WAVE_SINE_TABLE, SINE_TABLE_SCALE } from "./sine-table.ts";

const QUARTER_TURN_STEPS = ANGLE_STEPS_PER_TURN / 4;

/** 真下（+y）を向く単位 vector。目標と同じ位置から狙うときの向きに使う。 */
const STRAIGHT_DOWN: Vector2 = Object.freeze({ x: 0, y: 1 });

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

/** vector を角度 step だけ回転する。fan の各弾の向きを基準の向きから作るときに使う。 */
export function rotateByAngleSteps(vector: Vector2, steps: number): Vector2 {
  const cos = cosOfAngleSteps(steps);
  const sin = sinOfAngleSteps(steps);
  return Object.freeze({
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  });
}

/**
 * `from` から `to` へ向かう単位 vector を返す。`aim: player` の向きに使う。
 *
 * 長さは `Math.sqrt(dx * dx + dy * dy)` で求める。ECMAScript は `Math.sqrt` を正確な平方根の丸め（𝔽）と定めており host 差が
 * ないが、`Math.hypot` は implementation-approximated なので使わない。同じ位置なら真下を向く。
 */
export function directionToward(from: Vector2, to: Vector2): Vector2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) {
    return STRAIGHT_DOWN;
  }
  return Object.freeze({ x: dx / length, y: dy / length });
}

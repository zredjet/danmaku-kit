/** gameplay simulation が直接読む action ID。UI 操作とは分離する。 */
export type GameplayActionId = "shot" | "focus";

/** gameplay action を canonical に並べる順序。replay 入力の差分比較にも使う。 */
export const GAMEPLAY_ACTION_ORDER: readonly GameplayActionId[] = ["shot", "focus"];

/**
 * 1 fixed tick 分の入力 snapshot。
 *
 * keyboard / gamepad / replay file などの入力元は runtime adapter 側で吸収し、
 * Core には tick、正規化済み移動 axis、gameplay action の state / edge を渡す。
 */
export type InputFrame = {
  tick: number;
  axes: {
    moveX: -1 | 0 | 1;
    moveY: -1 | 0 | 1;
  };
  held: readonly GameplayActionId[];
  pressed: readonly GameplayActionId[];
  released: readonly GameplayActionId[];
};

/** 入力がない tick を明示的に進めるための helper。 */
export function createEmptyInputFrame(tick: number): InputFrame {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("tick must be a non-negative safe integer");
  }
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze([]),
    pressed: Object.freeze([]),
    released: Object.freeze([]),
  });
}

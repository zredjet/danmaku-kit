import type { InputFrame } from "../input/input-frame.ts";

export function createShotInputFrame(tick: number): InputFrame {
  return createPressedShotInputFrame(tick);
}

export function createMoveInputFrame(
  tick: number,
  moveX: -1 | 0 | 1,
  moveY: -1 | 0 | 1,
  held: InputFrame["held"],
): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX, moveY }),
    held: Object.freeze([...held]),
    pressed: Object.freeze([] as const),
    released: Object.freeze([] as const),
  });
}

export function createPressedShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze([] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

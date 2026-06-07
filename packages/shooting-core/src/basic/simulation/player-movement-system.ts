import type { InputFrame } from "../input/input-frame.ts";
import type { RuntimeEntityState, Vector2 } from "./runtime-entity.ts";

const PLAYFIELD_WIDTH = 384;
const PLAYFIELD_HEIGHT = 448;
const DIAGONAL_NORMALIZER = Math.SQRT1_2;

/**
 * 入力 axis から player movement を 1 tick 進める。
 *
 * diagonal 入力は斜め移動だけ速くならないよう正規化し、自機中心は playfield 内へ
 * clamp する。runtime entity は immutable として扱い、player だけ新しい entity へ写す。
 */
export function advancePlayerMovement(
  entities: readonly RuntimeEntityState[],
  input: InputFrame,
): readonly RuntimeEntityState[] {
  const advancedEntities: RuntimeEntityState[] = [];

  for (const entity of entities) {
    if (entity.kind !== "player") {
      advancedEntities.push(entity);
      continue;
    }

    const speed = input.held.includes("focus") ? entity.movement.focusSpeed : entity.movement.speed;
    const nextPosition = movePlayerPosition(entity.position, input.axes.moveX, input.axes.moveY, speed);
    advancedEntities.push(Object.freeze({
      ...entity,
      position: Object.freeze(nextPosition),
      movement: Object.freeze({
        speed: entity.movement.speed,
        focusSpeed: entity.movement.focusSpeed,
      }),
    }));
  }

  return Object.freeze(advancedEntities);
}

/** axis と速度から clamp 済みの次 player position を求める。 */
function movePlayerPosition(position: Vector2, moveX: -1 | 0 | 1, moveY: -1 | 0 | 1, speed: number): Vector2 {
  if (moveX === 0 && moveY === 0) {
    return { x: position.x, y: position.y };
  }

  const normalizer = moveX !== 0 && moveY !== 0 ? DIAGONAL_NORMALIZER : 1;
  return {
    x: clamp(position.x + moveX * speed * normalizer, 0, PLAYFIELD_WIDTH),
    y: clamp(position.y + moveY * speed * normalizer, 0, PLAYFIELD_HEIGHT),
  };
}

/** value を min/max の範囲へ丸める。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

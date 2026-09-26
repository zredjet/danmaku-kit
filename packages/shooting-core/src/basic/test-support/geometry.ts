import type { Vector2 } from "../entities/model-common.ts";
import { unitVectorAtAngleSteps } from "../simulation/deterministic-trig.ts";

/** 表の単位 vector に速さを掛けた速度。pattern の敵弾の期待値を runtime の実装から独立に作る。 */
export function tableVelocity(steps: number, speed: number): Vector2 {
  const direction = unitVectorAtAngleSteps(steps);
  return { x: direction.x * speed, y: direction.y * speed };
}

/** collision system の narrow phase と同じ円判定。broad phase の test の参照に使う。 */
export function circlesOverlap(
  left: Readonly<{ position: Vector2; collisionRadius: number }>,
  right: Readonly<{ position: Vector2; collisionRadius: number }>,
): boolean {
  const dx = left.position.x - right.position.x;
  const dy = left.position.y - right.position.y;
  const radius = left.collisionRadius + right.collisionRadius;
  return dx * dx + dy * dy <= radius * radius;
}

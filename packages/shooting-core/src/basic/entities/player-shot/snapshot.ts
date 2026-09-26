import type { PlayerShotId } from "../../content/types.ts";
import type { SerializedRuntimeEntityBase, SerializedVector2 } from "../snapshot-common.ts";
import type { PlayerShotRuntimeEntity } from "./model.ts";

/**
 * restore に必要な player shot runtime state。
 *
 * Phase 1B-5 で追加する restore は velocity / collisionRadius / damage を PlayerShotDefinition
 * と一致させ、remainingLifetimeTicks は正の safe integer かつ definition lifetime 内、
 * expectedTick から逆算した spawn tick が到達可能な値として検証する。
 */
export type SerializedPlayerShotRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "playerShot";
  definitionId: PlayerShotId;
  velocity: SerializedVector2;
  remainingLifetimeTicks: number;
  damage: number;
}>;

/** player shot runtime entity を public serialize 用 DTO に写す。 */
export function projectPlayerShotRuntimeEntityForSerializedState(
  entity: PlayerShotRuntimeEntity,
): SerializedPlayerShotRuntimeEntityState {
  return {
    id: entity.id,
    kind: "playerShot",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    velocity: { x: entity.velocity.x, y: entity.velocity.y },
    remainingLifetimeTicks: entity.remainingLifetimeTicks,
    damage: entity.damage,
  };
}

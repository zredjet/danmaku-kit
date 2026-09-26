import type { PlayerId, PlayerShotId } from "../../content/types.ts";
import type { SerializedRuntimeEntityBase } from "../snapshot-common.ts";
import type { PlayerRuntimeEntity } from "./model.ts";

/**
 * restore に必要な player runtime state。render-only 情報は含めない。
 *
 * Phase 1B-5 で追加する restore は PlayerDefinition と一致する collision / movement /
 * shotDefinitionId を要求し、position は playfield 内、lives / invincibleTicksRemaining /
 * nextShotAllowedTick は非負 safe integer かつ gameplay から到達可能な上限内として検証する。
 */
export type SerializedPlayerRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "player";
  definitionId: PlayerId;
  lives: number;
  invincibleTicksRemaining: number;
  nextShotAllowedTick: number;
  movement: Readonly<{
    speed: number;
    focusSpeed: number;
  }>;
  shotDefinitionId: PlayerShotId;
}>;

/** player runtime entity を public serialize 用 DTO に写す。 */
export function projectPlayerRuntimeEntityForSerializedState(
  entity: PlayerRuntimeEntity,
): SerializedPlayerRuntimeEntityState {
  return {
    id: entity.id,
    kind: "player",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    lives: entity.lives,
    invincibleTicksRemaining: entity.invincibleTicksRemaining,
    nextShotAllowedTick: entity.nextShotAllowedTick,
    movement: { speed: entity.movement.speed, focusSpeed: entity.movement.focusSpeed },
    shotDefinitionId: entity.shotDefinitionId,
  };
}

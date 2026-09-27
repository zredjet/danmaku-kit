import type { PlayerShotDefinition, PlayerShotId } from "../../content/types.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import type { HashableVector2, SerializedRuntimeEntityBase, SerializedVector2 } from "../snapshot-common.ts";
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

/** HashableGameState に含める player shot runtime entity の内部 hash 専用 DTO。 */
export type HashablePlayerShotRuntimeEntityState = Readonly<{
  id: number;
  kind: "playerShot";
  definitionId: PlayerShotDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
  velocity: HashableVector2;
  remainingLifetimeTicks: number;
  damage: number;
}>;

/** player shot runtime entity の hash DTO field を canonical encoding 順に固定する。 */
export const HASHABLE_PLAYER_SHOT_RUNTIME_ENTITY_FIELD_ORDER = defineFieldOrder<
  HashablePlayerShotRuntimeEntityState,
  PlayerShotRuntimeEntity
>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
  "velocity",
  "remainingLifetimeTicks",
  "damage",
]);

/** player shot runtime entity を hash 専用 DTO へ明示的に写す。 */
export function projectPlayerShotRuntimeEntityForHashableState(
  entity: PlayerShotRuntimeEntity,
): HashablePlayerShotRuntimeEntityState {
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

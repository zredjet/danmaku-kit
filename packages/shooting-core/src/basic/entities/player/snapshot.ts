import type { PlayerId, PlayerShotDefinition, PlayerShotId } from "../../content/types.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import type { HashableVector2, SerializedRuntimeEntityBase } from "../snapshot-common.ts";
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

/** Hash 対象の player movement 設定。vector と別 fixedStruct として encode する。 */
export type HashablePlayerMovement = Readonly<{ speed: number; focusSpeed: number }>;

/** HashableGameState に含める player runtime entity の内部 hash 専用 DTO。 */
export type HashablePlayerRuntimeEntityState = Readonly<{
  id: number;
  kind: "player";
  definitionId: PlayerId;
  position: HashableVector2;
  collisionRadius: number;
  lives: number;
  invincibleTicksRemaining: number;
  nextShotAllowedTick: number;
  movement: HashablePlayerMovement;
  shotDefinitionId: PlayerShotDefinition["id"];
}>;

/** HashablePlayerMovement の canonical encoding 順を固定する。 */
export const HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER = defineFieldOrder<
  HashablePlayerMovement,
  PlayerRuntimeEntity["movement"]
>()([
  "speed",
  "focusSpeed",
]);

/** player runtime entity の hash DTO field を canonical encoding 順に固定する。 */
export const HASHABLE_PLAYER_RUNTIME_ENTITY_FIELD_ORDER = defineFieldOrder<
  HashablePlayerRuntimeEntityState,
  PlayerRuntimeEntity
>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
  "lives",
  "invincibleTicksRemaining",
  "nextShotAllowedTick",
  "movement",
  "shotDefinitionId",
]);

/** player runtime entity を hash 専用 DTO へ明示的に写す。 */
export function projectPlayerRuntimeEntityForHashableState(
  entity: PlayerRuntimeEntity,
): HashablePlayerRuntimeEntityState {
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

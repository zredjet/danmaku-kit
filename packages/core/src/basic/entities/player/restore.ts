import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import {
  MAX_PLAYER_MOVEMENT_SPEED,
  MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
  PLAYFIELD_HEIGHT,
  PLAYFIELD_WIDTH,
} from "../../content/runtime-budgets.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { cloneRestorePlainRecord } from "../../serialization/restore-plain-data.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import { hasOnlyKeys, isNonNegativeSafeInteger, isPositiveFiniteNumber } from "../../shared/guards.ts";
import { RESTORE_RUNTIME_ENTITY_COMMON_KEYS, isSameRestorePosition } from "../restore-common.ts";
import type { RestoreRuntimeEntityCommon } from "../restore-common.ts";
import { DEFAULT_PLAYER_START_POSITION, createRestoredPlayerRuntimeEntity } from "./model.ts";
import type { PlayerRuntimeEntity } from "./model.ts";
import type { SerializedPlayerRuntimeEntityState } from "./snapshot.ts";

/** player runtime entity の restore で受け付ける key。public DTO と runtime component の field 集合に一致させる。 */
export const RESTORE_RUNTIME_PLAYER_KEYS = defineFieldOrder<
  SerializedPlayerRuntimeEntityState,
  PlayerRuntimeEntity
>()([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "lives",
  "invincibleTicksRemaining",
  "nextShotAllowedTick",
  "movement",
  "shotDefinitionId",
]);

/** player entity 固有 field と registry reference を検証する。 */
export function validateRestorePlayerRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
  expectedTick: number,
): CoreResult<PlayerRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_PLAYER_KEYS)) {
    return coreError("state.invalidShape", "player runtime entity contains unknown fields");
  }
  if (
    !isNonNegativeSafeInteger(entity.lives)
    || !isNonNegativeSafeInteger(entity.invincibleTicksRemaining)
    || !isNonNegativeSafeInteger(entity.nextShotAllowedTick)
  ) {
    return coreError("state.invalidShape", "player runtime counters must be non-negative safe integers");
  }
  const movement = cloneRestorePlainRecord(entity.movement, "player runtime movement", ["speed", "focusSpeed"]);
  if (!movement.ok) {
    return movement;
  }
  if (!isPositiveFiniteNumber(movement.value.speed) || movement.value.speed > MAX_PLAYER_MOVEMENT_SPEED) {
    return coreError("state.invalidShape", "player movement.speed exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(movement.value.focusSpeed) || movement.value.focusSpeed > MAX_PLAYER_MOVEMENT_SPEED) {
    return coreError("state.invalidShape", "player movement.focusSpeed exceeds the runtime budget");
  }
  if (typeof entity.shotDefinitionId !== "string") {
    return coreError("state.invalidShape", "player shotDefinitionId must be a string");
  }
  if (!isNamespacedId(entity.shotDefinitionId, "playerShot")) {
    return coreError("state.invalidShape", "player shotDefinitionId must be a valid playerShot id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "player")) {
    return coreError("state.invalidShape", "player definitionId must be a valid player id");
  }
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player");
  }
  const playerShot = content.playerShotsById.get(entity.shotDefinitionId);
  if (!playerShot) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== player.collision.radius
    || movement.value.speed !== player.movement.speed
    || movement.value.focusSpeed !== player.movement.focusSpeed
    || entity.shotDefinitionId !== player.shot.definition
  ) {
    return coreError("state.invalidShape", "player runtime entity must match immutable player definition fields");
  }
  if (!isPlayerPositionInsidePlayfield(common.position)) {
    return coreError("state.invalidShape", "player runtime position must stay inside the playfield");
  }
  if (
    entity.lives > player.life.initialLives
    || entity.invincibleTicksRemaining > player.life.invincibleTicksAfterHit
    || entity.nextShotAllowedTick > Math.max(0, expectedTick - 1 + Math.min(
      playerShot.fire.intervalTicks,
      MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
    ))
  ) {
    return coreError("state.invalidShape", "player runtime counters exceed restorable gameplay bounds");
  }

  return okResult(createRestoredPlayerRuntimeEntity({
    id: common.id,
    definitionId: player.id,
    position: common.position,
    movement: Object.freeze({
      speed: movement.value.speed,
      focusSpeed: movement.value.focusSpeed,
    }),
    collisionRadius: player.collision.radius,
    lives: entity.lives,
    invincibleTicksRemaining: entity.invincibleTicksRemaining,
    shotDefinitionId: player.shot.definition,
    nextShotAllowedTick: entity.nextShotAllowedTick,
  }));
}

/** player の中心座標は movement system と同じ playfield 範囲だけを restore で受け付ける。 */
function isPlayerPositionInsidePlayfield(position: Readonly<{ x: number; y: number }>): boolean {
  return position.x >= 0 && position.x <= PLAYFIELD_WIDTH && position.y >= 0 && position.y <= PLAYFIELD_HEIGHT;
}

/** startStage 直後の player snapshot が一意な初期値と一致することを検証する。 */
export function validateRestoreInitialPlayerEntity(
  entity: PlayerRuntimeEntity,
  content: LoadedContentIndex,
): CoreResult<null> {
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player");
  }
  if (
    !isSameRestorePosition(DEFAULT_PLAYER_START_POSITION, entity.position)
    || entity.lives !== player.life.initialLives
    || entity.invincibleTicksRemaining !== 0
    || entity.nextShotAllowedTick !== 0
  ) {
    return coreError("state.invalidShape", "initial player runtime entity must match startStage defaults");
  }

  return okResult(null);
}

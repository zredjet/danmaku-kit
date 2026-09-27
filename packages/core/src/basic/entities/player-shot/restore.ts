import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { MAX_PLAYER_SHOT_LIFETIME_TICKS, MAX_PLAYER_SHOT_SPEED_PER_AXIS } from "../../content/runtime-budgets.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import { hasOnlyKeys, isPositiveFiniteNumber } from "../../shared/guards.ts";
import { RESTORE_RUNTIME_ENTITY_COMMON_KEYS, validateRestoreVector2 } from "../restore-common.ts";
import type { RestoreRuntimeEntityCommon } from "../restore-common.ts";
import { createRestoredPlayerShotRuntimeEntity } from "./model.ts";
import type { PlayerShotRuntimeEntity } from "./model.ts";
import type { SerializedPlayerShotRuntimeEntityState } from "./snapshot.ts";

/** player shot runtime entity の restore で受け付ける key。public DTO と runtime component の field 集合に一致させる。 */
export const RESTORE_RUNTIME_PLAYER_SHOT_KEYS = defineFieldOrder<
  SerializedPlayerShotRuntimeEntityState,
  PlayerShotRuntimeEntity
>()([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "velocity",
  "remainingLifetimeTicks",
  "damage",
]);

export type RestorePlayerShotValidation = Readonly<{
  entity: PlayerShotRuntimeEntity;
  spawnTick: number;
}>;

/** player shot entity 固有 field と registry reference を検証する。 */
export function validateRestorePlayerShotRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
  expectedTick: number,
): CoreResult<RestorePlayerShotValidation> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_PLAYER_SHOT_KEYS)) {
    return coreError("state.invalidShape", "player shot runtime entity contains unknown fields");
  }
  const velocity = validateRestoreVector2(entity.velocity, "player shot velocity");
  if (!velocity.ok) {
    return velocity;
  }
  if (Math.abs(velocity.value.x) > MAX_PLAYER_SHOT_SPEED_PER_AXIS || Math.abs(velocity.value.y) > MAX_PLAYER_SHOT_SPEED_PER_AXIS) {
    return coreError("state.invalidShape", "player shot velocity exceeds the runtime budget");
  }
  const remainingLifetimeTicks = entity.remainingLifetimeTicks;
  if (
    typeof remainingLifetimeTicks !== "number"
    || !Number.isSafeInteger(remainingLifetimeTicks)
    || remainingLifetimeTicks <= 0
    || remainingLifetimeTicks > MAX_PLAYER_SHOT_LIFETIME_TICKS
  ) {
    return coreError("state.invalidShape", "player shot remainingLifetimeTicks exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(entity.damage)) {
    return coreError("state.invalidShape", "player shot damage must be a positive finite number");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "playerShot")) {
    return coreError("state.invalidShape", "player shot definitionId must be a valid playerShot id");
  }
  const playerShot = content.playerShotsById.get(entity.definitionId);
  if (!playerShot) {
    return coreError("state.registryInvalid", "player shot runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== playerShot.collision.radius
    || velocity.value.x !== playerShot.projectile.velocity.x
    || velocity.value.y !== playerShot.projectile.velocity.y
    || entity.damage !== playerShot.damage
    || remainingLifetimeTicks > playerShot.projectile.lifetimeTicks
  ) {
    return coreError("state.invalidShape", "player shot runtime entity must match immutable player shot definition fields");
  }
  const elapsedTicks = playerShot.projectile.lifetimeTicks - remainingLifetimeTicks;
  const spawnTick = expectedTick - 1 - elapsedTicks;
  if (!Number.isSafeInteger(spawnTick) || spawnTick < 0 || spawnTick >= expectedTick) {
    return coreError("state.invalidShape", "player shot remainingLifetimeTicks is not reachable from expectedTick");
  }

  return okResult(Object.freeze({
    entity: createRestoredPlayerShotRuntimeEntity({
      id: common.id,
      definitionId: playerShot.id,
      position: common.position,
      velocity: velocity.value,
      collisionRadius: playerShot.collision.radius,
      damage: playerShot.damage,
      remainingLifetimeTicks,
    }),
    spawnTick,
  }));
}

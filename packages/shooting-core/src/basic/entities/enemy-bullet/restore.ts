import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { MAX_ENEMY_BULLET_SPEED_PER_AXIS } from "../../content/runtime-budgets.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import { hasOnlyKeys } from "../../shared/guards.ts";
import { RESTORE_RUNTIME_ENTITY_COMMON_KEYS, validateRestoreVector2 } from "../restore-common.ts";
import type { RestoreRuntimeEntityCommon } from "../restore-common.ts";
import { createRestoredEnemyBulletRuntimeEntity } from "./model.ts";
import type { EnemyBulletRuntimeEntity } from "./model.ts";
import type { SerializedEnemyBulletRuntimeEntityState } from "./snapshot.ts";

/** enemy bullet runtime entity の restore で受け付ける key。public DTO と runtime component の field 集合に一致させる。 */
export const RESTORE_RUNTIME_ENEMY_BULLET_KEYS = defineFieldOrder<
  SerializedEnemyBulletRuntimeEntityState,
  EnemyBulletRuntimeEntity
>()([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "velocity",
  "spawnPosition",
  "ageTicks",
]);

/**
 * enemy bullet entity 固有 field と registry reference を検証する。
 *
 * 生成位置・速度・経過 tick と spawn との一致は、spawn を特定できる restore の allocation 検証で確かめる。
 */
export function validateRestoreEnemyBulletRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
): CoreResult<EnemyBulletRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_ENEMY_BULLET_KEYS)) {
    return coreError("state.invalidShape", "enemy bullet runtime entity contains unknown fields");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "bullet")) {
    return coreError("state.invalidShape", "enemy bullet definitionId must be a valid bullet id");
  }
  const bullet = content.bulletsById.get(entity.definitionId);
  if (!bullet) {
    return coreError("state.registryInvalid", "enemy bullet runtime entity references an unknown bullet");
  }
  if (entity.collisionRadius !== bullet.collision.radius) {
    return coreError("state.invalidShape", "enemy bullet runtime entity must match immutable bullet definition fields");
  }
  const velocity = validateRestoreVector2(entity.velocity, "enemy bullet velocity");
  if (!velocity.ok) {
    return velocity;
  }
  if (
    Math.abs(velocity.value.x) > MAX_ENEMY_BULLET_SPEED_PER_AXIS
    || Math.abs(velocity.value.y) > MAX_ENEMY_BULLET_SPEED_PER_AXIS
  ) {
    return coreError("state.invalidShape", "enemy bullet velocity exceeds the runtime budget");
  }
  const spawnPosition = validateRestoreVector2(entity.spawnPosition, "enemy bullet spawnPosition");
  if (!spawnPosition.ok) {
    return spawnPosition;
  }
  // 生成 tick の update movement で 1 になるため、committed state の敵弾は 1 tick 以上動いている。
  if (typeof entity.ageTicks !== "number" || !Number.isSafeInteger(entity.ageTicks) || entity.ageTicks < 1) {
    return coreError("state.invalidShape", "enemy bullet ageTicks must be a positive safe integer");
  }

  return okResult(createRestoredEnemyBulletRuntimeEntity({
    id: common.id,
    definitionId: bullet.id,
    position: common.position,
    collisionRadius: bullet.collision.radius,
    velocity: velocity.value,
    spawnPosition: spawnPosition.value,
    ageTicks: entity.ageTicks,
  }));
}

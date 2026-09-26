import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import type { SerializedRuntimeEntityState } from "../../serialization/types.ts";
import { hasOnlyKeys } from "../../shared/guards.ts";
import { RESTORE_RUNTIME_ENTITY_COMMON_KEYS } from "../restore-common.ts";
import type { RestoreRuntimeEntityCommon } from "../restore-common.ts";
import { createRestoredEnemyBulletRuntimeEntity } from "./model.ts";
import type { EnemyBulletRuntimeEntity } from "./model.ts";

type SerializedRestoreEnemyBulletEntity = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;

const RESTORE_RUNTIME_ENEMY_BULLET_KEYS: ReadonlyArray<keyof SerializedRestoreEnemyBulletEntity> =
  RESTORE_RUNTIME_ENTITY_COMMON_KEYS;

/** enemy bullet entity 固有 field と registry reference を検証する。 */
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

  return okResult(createRestoredEnemyBulletRuntimeEntity({
    id: common.id,
    definitionId: bullet.id,
    position: common.position,
    collisionRadius: bullet.collision.radius,
  }));
}

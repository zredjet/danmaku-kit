import type { BulletId } from "../../content/types.ts";
import type { SerializedRuntimeEntityBase } from "../snapshot-common.ts";
import type { EnemyBulletRuntimeEntity } from "./model.ts";

/**
 * restore に必要な enemy bullet runtime state。
 *
 * Phase 1B-3 では現行 `EnemyBulletRuntimeEntity` に存在する state だけに限定する。
 * velocity / damage / lifetime を Core が所有するまでは、public DTO に未復元の
 * `projectile` state を受け入れない。
 */
export type SerializedEnemyBulletRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemyBullet";
  definitionId: BulletId;
}>;

/** enemy bullet runtime entity を public serialize 用 DTO に写す。 */
export function projectEnemyBulletRuntimeEntityForSerializedState(
  entity: EnemyBulletRuntimeEntity,
): SerializedEnemyBulletRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemyBullet",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
  };
}

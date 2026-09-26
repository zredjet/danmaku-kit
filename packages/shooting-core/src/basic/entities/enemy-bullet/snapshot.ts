import type { BulletDefinition, BulletId } from "../../content/types.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import type { HashableVector2, SerializedRuntimeEntityBase } from "../snapshot-common.ts";
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

/** HashableGameState に含める enemy bullet runtime entity の内部 hash 専用 DTO。 */
export type HashableEnemyBulletRuntimeEntityState = Readonly<{
  id: number;
  kind: "enemyBullet";
  definitionId: BulletDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
}>;

/** enemy bullet runtime entity の hash DTO field を canonical encoding 順に固定する。 */
export const HASHABLE_ENEMY_BULLET_RUNTIME_ENTITY_FIELD_ORDER = defineFieldOrder<
  HashableEnemyBulletRuntimeEntityState,
  EnemyBulletRuntimeEntity
>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
]);

/** enemy bullet runtime entity を hash 専用 DTO へ明示的に写す。 */
export function projectEnemyBulletRuntimeEntityForHashableState(
  entity: EnemyBulletRuntimeEntity,
): HashableEnemyBulletRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemyBullet",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
  };
}

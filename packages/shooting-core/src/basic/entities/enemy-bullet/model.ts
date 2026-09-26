import type { BulletDefinition, BulletId } from "../../content/types.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { EntityAllocator } from "../../simulation/entity.ts";
import type { EntityId } from "../../simulation/entity.ts";
import type { Vector2 } from "../model-common.ts";

/** 敵弾の runtime component。発射 system 追加時に速度や collider を拡張する。 */
export type EnemyBulletRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "enemyBullet";
  definitionId: BulletId;
  position: Vector2;
  collisionRadius: number;
}>;

/** 検証済み snapshot から enemy bullet runtime entity を復元するための入力。 */
type RestoredEnemyBulletRuntimeEntityInput = Omit<EnemyBulletRuntimeEntity, "kind">;

/** BulletDefinition から enemy bullet runtime entity を作る。 */
export function createEnemyBulletRuntimeEntity(
  allocator: EntityAllocator,
  bullet: BulletDefinition,
  position: Vector2,
): CoreResult<EnemyBulletRuntimeEntity> {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return coreError("definition.invalidConstraint", `Enemy bullet position must be finite: ${bullet.id}`);
  }

  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(createRestoredEnemyBulletRuntimeEntity({
    id: entity.value.id,
    definitionId: bullet.id,
    position: Object.freeze({ x: position.x, y: position.y }),
    collisionRadius: bullet.collision.radius,
  }));
}

/** restore 済み enemy bullet component を runtime が使う immutable entity に戻す。 */
export function createRestoredEnemyBulletRuntimeEntity(
  input: RestoredEnemyBulletRuntimeEntityInput,
): EnemyBulletRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "enemyBullet",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    collisionRadius: input.collisionRadius,
  });
}

import type { BulletDefinition, BulletId } from "../../content/types.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { EntityAllocator } from "../../simulation/entity.ts";
import type { EntityId } from "../../simulation/entity.ts";
import type { Vector2 } from "../model-common.ts";

/**
 * 敵弾の runtime component。
 *
 * 位置は `spawnPosition + velocity * ageTicks` として毎 tick 求め直し、tick ごとの加算誤差を積まない。`ageTicks` は生成してから
 * 動いた tick 数で、生成 tick の update movement で 1 になる。
 */
export type EnemyBulletRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "enemyBullet";
  definitionId: BulletId;
  position: Vector2;
  collisionRadius: number;
  velocity: Vector2;
  spawnPosition: Vector2;
  ageTicks: number;
}>;

/** 検証済み snapshot から enemy bullet runtime entity を復元するための入力。 */
type RestoredEnemyBulletRuntimeEntityInput = Omit<EnemyBulletRuntimeEntity, "kind">;

/** BulletDefinition から、生成位置で止まっている（まだ動いていない）enemy bullet runtime entity を作る。 */
export function createEnemyBulletRuntimeEntity(
  allocator: EntityAllocator,
  bullet: BulletDefinition,
  position: Vector2,
  velocity: Vector2,
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
    position,
    collisionRadius: bullet.collision.radius,
    velocity,
    spawnPosition: position,
    ageTicks: 0,
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
    velocity: Object.freeze({ x: input.velocity.x, y: input.velocity.y }),
    spawnPosition: Object.freeze({ x: input.spawnPosition.x, y: input.spawnPosition.y }),
    ageTicks: input.ageTicks,
  });
}

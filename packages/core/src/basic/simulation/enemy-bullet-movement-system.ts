import { ENEMY_BULLET_CLEANUP_PLAYFIELD_MARGIN, PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../content/runtime-budgets.ts";
import type { Vector2 } from "../entities/model-common.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";

/**
 * enemy bullet を velocity で 1 tick 動かし、playfield 外の余白より外に出た敵弾を取り除く。
 *
 * system order の updateMovement / updateLifetime にあたる。生成 tick でも動かし、cleanup は player shot の lifetime 切れと同じく
 * event を出さない。位置は `spawnPosition + velocity * ageTicks` として求め直す。
 */
export function advanceEnemyBullets(entities: readonly RuntimeEntityState[]): readonly RuntimeEntityState[] {
  const advancedEntities: RuntimeEntityState[] = [];
  for (const entity of entities) {
    if (entity.kind !== "enemyBullet") {
      advancedEntities.push(entity);
      continue;
    }
    const ageTicks = entity.ageTicks + 1;
    const position = resolveEnemyBulletPositionAt(entity.spawnPosition, entity.velocity, ageTicks);
    if (isOutsideEnemyBulletCleanupBounds(position)) {
      continue;
    }
    advancedEntities.push(Object.freeze({ ...entity, position, ageTicks }));
  }

  return Object.freeze(advancedEntities);
}

/** 生成位置から `ageTicks` tick 動いた敵弾の位置を返す。restore も同じ演算で位置を検証する。 */
export function resolveEnemyBulletPositionAt(spawnPosition: Vector2, velocity: Vector2, ageTicks: number): Vector2 {
  return Object.freeze({
    x: spawnPosition.x + velocity.x * ageTicks,
    y: spawnPosition.y + velocity.y * ageTicks,
  });
}

/** 敵弾の中心が playfield を cleanup 余白より外れているかを返す。restore も同じ境界で到達不能な state を拒否する。 */
export function isOutsideEnemyBulletCleanupBounds(position: Vector2): boolean {
  return position.x < -ENEMY_BULLET_CLEANUP_PLAYFIELD_MARGIN
    || position.x > PLAYFIELD_WIDTH + ENEMY_BULLET_CLEANUP_PLAYFIELD_MARGIN
    || position.y < -ENEMY_BULLET_CLEANUP_PLAYFIELD_MARGIN
    || position.y > PLAYFIELD_HEIGHT + ENEMY_BULLET_CLEANUP_PLAYFIELD_MARGIN;
}

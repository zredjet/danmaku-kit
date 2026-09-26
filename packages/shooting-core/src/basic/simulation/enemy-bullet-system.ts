import { MAX_ACTIVE_ENEMY_BULLETS } from "../content/runtime-budgets.ts";
import type { BulletDefinition, PatternDefinition } from "../content/types.ts";
import { createEnemyBulletRuntimeEntity } from "../entities/enemy-bullet/model.ts";
import type { EnemyBulletRuntimeEntity } from "../entities/enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { GameEvent } from "../events/game-event.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "./entity.ts";

type EnemyBulletSpawnEventItem = Readonly<{
  entityId: EnemyBulletRuntimeEntity["id"];
  definitionId: BulletDefinition["id"];
  position: EnemyBulletRuntimeEntity["position"];
}>;

type EnemyBulletSpawnPlan = Readonly<{
  bullet: BulletDefinition;
  position: EnemyBulletRuntimeEntity["position"];
  velocity: EnemyBulletRuntimeEntity["velocity"];
}>;

const STATIONARY_VELOCITY: EnemyBulletRuntimeEntity["velocity"] = Object.freeze({ x: 0, y: 0 });

/** 敵弾生成 system が tick へ返す差分。 */
export type EnemyBulletSpawnResult = Readonly<{
  entities: readonly [EnemyBulletRuntimeEntity, ...EnemyBulletRuntimeEntity[]];
  spawnedBullets: readonly [EnemyBulletSpawnEventItem, ...EnemyBulletSpawnEventItem[]];
  event: GameEvent;
}>;

/**
 * spawn 直後の enemy pattern から敵弾を 1 batch 生成する。
 *
 * pattern DSL 全体はまだ実行せず、`fireOnSpawn` だけを deterministic な enemy bullet 生成経路として扱う。生成すると active な
 * enemy bullet が `MAX_ACTIVE_ENEMY_BULLETS` を超える場合は、entity を落とさず error を返し、呼び出し側で fatal として扱う。
 */
export function spawnEnemyBulletsOnSpawn(
  allocator: EntityAllocator,
  tick: number,
  spawnedEnemies: readonly EnemyRuntimeEntity[],
  patternsById: ReadonlyMap<string, PatternDefinition>,
  bulletsById: ReadonlyMap<string, BulletDefinition>,
  activeEnemyBulletCount: number,
): CoreResult<EnemyBulletSpawnResult | null> {
  const plans: EnemyBulletSpawnPlan[] = [];

  for (const enemy of spawnedEnemies) {
    const pattern = patternsById.get(enemy.patternId);
    if (!pattern) {
      return coreError("pattern.notFound", `Pattern not found: ${enemy.patternId}`);
    }
    const fireOnSpawn = pattern.fireOnSpawn;
    if (!fireOnSpawn) {
      continue;
    }

    const bullet = bulletsById.get(fireOnSpawn.bullet);
    if (!bullet) {
      return coreError("bullet.notFound", `Bullet not found: ${fireOnSpawn.bullet}`);
    }
    const position = resolveEnemyBulletSpawnPosition(enemy.id, enemy.position, pattern.id, fireOnSpawn);
    if (!position.ok) {
      return position;
    }

    plans.push(Object.freeze({
      bullet,
      position: position.value,
      velocity: resolveEnemyBulletSpawnVelocity(fireOnSpawn),
    }));
  }

  if (plans.length === 0) {
    return okResult(null);
  }

  if (activeEnemyBulletCount + plans.length > MAX_ACTIVE_ENEMY_BULLETS) {
    return coreError(
      "enemyBullet.budgetExceeded",
      `Active enemy bullets would exceed ${MAX_ACTIVE_ENEMY_BULLETS}: ${activeEnemyBulletCount} + ${plans.length}`,
    );
  }
  const capacity = allocator.canAllocate(plans.length);
  if (!capacity.ok) {
    return capacity;
  }

  const entities: EnemyBulletRuntimeEntity[] = [];
  const spawnedBullets: EnemyBulletSpawnEventItem[] = [];

  for (const plan of plans) {
    const entity = createEnemyBulletRuntimeEntity(allocator, plan.bullet, plan.position, plan.velocity);
    if (!entity.ok) {
      return entity;
    }

    entities.push(entity.value);
    spawnedBullets.push(Object.freeze({
      entityId: entity.value.id,
      definitionId: plan.bullet.id,
      position: Object.freeze({
        x: entity.value.position.x,
        y: entity.value.position.y,
      }),
    }));
  }

  const frozenBullets = Object.freeze(spawnedBullets) as readonly [
    EnemyBulletSpawnEventItem,
    ...EnemyBulletSpawnEventItem[],
  ];
  return okResult(Object.freeze({
    entities: Object.freeze(entities) as readonly [EnemyBulletRuntimeEntity, ...EnemyBulletRuntimeEntity[]],
    spawnedBullets: frozenBullets,
    event: buildEnemyBulletsSpawnedBatchEvent(tick, frozenBullets),
  }));
}

/** 敵弾生成差分から public gameplay event を作る。 */
function buildEnemyBulletsSpawnedBatchEvent(
  tick: number,
  bullets: readonly [EnemyBulletSpawnEventItem, ...EnemyBulletSpawnEventItem[]],
): GameEvent {
  return Object.freeze({
    type: "enemyBulletsSpawnedBatch",
    tick,
    bullets: Object.freeze([...bullets]) as typeof bullets,
  });
}

/**
 * enemy spawn 位置と `fireOnSpawn.offset` から敵弾生成位置を決める。
 *
 * restore validation も同じ座標規則を使うため、runtime entity 生成前の spawn 位置から
 * 計算できる小さな helper として公開する。
 */
export function resolveEnemyBulletSpawnPosition(
  enemyId: EnemyRuntimeEntity["id"] | "restore",
  enemyPosition: EnemyRuntimeEntity["position"],
  patternId: PatternDefinition["id"],
  fireOnSpawn: NonNullable<PatternDefinition["fireOnSpawn"]>,
): CoreResult<EnemyBulletRuntimeEntity["position"]> {
  const x = enemyPosition.x + fireOnSpawn.offset.x;
  const y = enemyPosition.y + fireOnSpawn.offset.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return coreError(
      "definition.invalidConstraint",
      `Enemy bullet spawn position must be finite: ${enemyId}:${patternId}`,
    );
  }

  return okResult(Object.freeze({ x, y }));
}

/** `fireOnSpawn` の敵弾速度を返す。velocity を省略した敵弾は動かない。restore の spawn 候補も同じ値を使う。 */
export function resolveEnemyBulletSpawnVelocity(
  fireOnSpawn: NonNullable<PatternDefinition["fireOnSpawn"]>,
): EnemyBulletRuntimeEntity["velocity"] {
  return fireOnSpawn.velocity
    ? Object.freeze({ x: fireOnSpawn.velocity.x, y: fireOnSpawn.velocity.y })
    : STATIONARY_VELOCITY;
}

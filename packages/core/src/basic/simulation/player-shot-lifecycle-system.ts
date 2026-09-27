import type { RuntimeEntityState } from "../entities/runtime-entity.ts";

type PlayerShotLifecycleOptions = Readonly<{
  /**
   * この tick で生成された player shot の id。
   *
   * 生成 tick でも movement は適用するが、content 制作者が期待する表示・判定寿命を
   * 1 tick 失わないよう、lifetime decrement は次 tick から始める。
   */
  spawnedThisTickEntityIds?: ReadonlySet<number>;
}>;

/**
 * player shot の movement / lifetime / cleanup を 1 tick 進める。
 *
 * runtime entity は immutable として扱い、更新が必要な player shot だけ新しい entity へ写す。
 */
export function advancePlayerShotLifecycle(
  entities: readonly RuntimeEntityState[],
  options: PlayerShotLifecycleOptions = {},
): readonly RuntimeEntityState[] {
  const advancedEntities: RuntimeEntityState[] = [];

  for (const entity of entities) {
    if (entity.kind !== "playerShot") {
      advancedEntities.push(entity);
      continue;
    }

    const remainingLifetimeTicks = options.spawnedThisTickEntityIds?.has(entity.id)
      ? entity.remainingLifetimeTicks
      : entity.remainingLifetimeTicks - 1;
    if (remainingLifetimeTicks <= 0) {
      continue;
    }

    advancedEntities.push(Object.freeze({
      ...entity,
      position: Object.freeze({
        x: entity.position.x + entity.velocity.x,
        y: entity.position.y + entity.velocity.y,
      }),
      velocity: Object.freeze({
        x: entity.velocity.x,
        y: entity.velocity.y,
      }),
      remainingLifetimeTicks,
    }));
  }

  return Object.freeze(advancedEntities);
}

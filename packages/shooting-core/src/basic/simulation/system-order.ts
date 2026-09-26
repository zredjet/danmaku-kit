import type { RuntimeEntityState } from "../entities/runtime-entity.ts";

/** 1 tick 内の system 実行順。 */
export const STAGE_TICK_SYSTEM_ORDER = Object.freeze([
  "applyInput",
  "updatePlayerIntent",
  "resolveImmediatePlayerDefensiveActions",
  "updateStageTimeline",
  "updateEnemyBehaviorPattern",
  "spawnBulletsPlayerShots",
  "updateMovement",
  "updateLifetime",
  "broadPhaseCollision",
  "narrowPhaseCollision",
  "collisionResolution",
  "scoring",
  "cleanupDestroyedEntities",
  "buildImmutableGameFrame",
] as const);

/**
 * Core basic が 1 tick 内で実行する system step。
 *
 * ここに並ぶ順序は replay determinism の契約なので、後続 system はこの順序へ挿入する。
 */
export type StageTickSystemStep = (typeof STAGE_TICK_SYSTEM_ORDER)[number];

/** entity id 昇順の deterministic tie-breaker。 */
export function compareEntityIdAscending(left: Pick<RuntimeEntityState, "id">, right: Pick<RuntimeEntityState, "id">): number {
  return left.id - right.id;
}

/** active entity の参照を entity id 昇順の frozen array として返す。 */
export function freezeEntitiesInIdOrder(entities: readonly RuntimeEntityState[]): readonly RuntimeEntityState[] {
  const orderedEntities = isSortedByEntityId(entities)
    ? [...entities]
    : [...entities].sort(compareEntityIdAscending);
  return Object.freeze(orderedEntities);
}

/** entity 配列がすでに id 昇順かを O(n) で確認する。 */
function isSortedByEntityId(entities: readonly RuntimeEntityState[]): boolean {
  for (let index = 1; index < entities.length; index += 1) {
    if (entities[index - 1]!.id > entities[index]!.id) {
      return false;
    }
  }
  return true;
}

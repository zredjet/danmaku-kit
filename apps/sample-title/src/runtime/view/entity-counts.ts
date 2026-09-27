import type { ReadonlyEntityState, ReadonlyGameState } from "@danmaku-kit/core";

import type { ViewEntity, ViewKind } from "./view-entities.ts";

export type EntityKind = ViewKind;

/** debug HUD と browser dump に出す kind の並び（Core の entity の kind と pickup）。 */
export const ENTITY_KINDS = Object.freeze(["player", "enemy", "enemyBullet", "playerShot", "pickup"] as const satisfies readonly EntityKind[]);

// Core に entity kind が増えたとき、並びへの追加漏れを型エラーにする。
true satisfies [Exclude<ReadonlyEntityState["kind"] | "pickup", (typeof ENTITY_KINDS)[number]>] extends [never] ? true : false;

/** 描画する entity を kind ごとに数える。 */
export function countEntitiesByKind(entities: readonly ViewEntity[]): Readonly<Record<EntityKind, number>> {
  const counts: Record<EntityKind, number> = { player: 0, enemy: 0, enemyBullet: 0, playerShot: 0, pickup: 0 };
  for (const entity of entities) {
    counts[entity.kind] += 1;
  }
  return Object.freeze(counts);
}

/** frame の state の entity と pickup を kind ごとに数える。 */
export function countGameStateEntities(state: ReadonlyGameState | null): Readonly<Record<EntityKind, number>> {
  const counts = { ...countEntitiesByKind(state?.entities ?? []) };
  counts.pickup += state?.features?.pickups?.length ?? 0;
  return Object.freeze(counts);
}

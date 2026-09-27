import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";

export type EntityKind = ReadonlyEntityState["kind"];

/** debug HUD と browser dump に出す kind の並び。 */
export const ENTITY_KINDS = Object.freeze(["player", "enemy", "enemyBullet", "playerShot"] as const satisfies readonly EntityKind[]);

// Core に entity kind が増えたとき、並びへの追加漏れを型エラーにする。
true satisfies [Exclude<EntityKind, (typeof ENTITY_KINDS)[number]>] extends [never] ? true : false;

/** frame の entity を kind ごとに数える。 */
export function countEntitiesByKind(entities: readonly ReadonlyEntityState[]): Readonly<Record<EntityKind, number>> {
  const counts: Record<EntityKind, number> = { player: 0, enemy: 0, enemyBullet: 0, playerShot: 0 };
  for (const entity of entities) {
    counts[entity.kind] += 1;
  }
  return Object.freeze(counts);
}
